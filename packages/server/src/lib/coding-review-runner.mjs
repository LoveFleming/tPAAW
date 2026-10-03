/**
 * coding-review-runner.mjs — 多 model 並行 code review（MR1, 2026-10-03）
 *
 * Fleming 定調（v3 設計）：
 * - 設定居所 = EM（coding.em.json / .paaw/agents/coding.em.json 覆蓋鏈）的 reviewConfig
 *   { multiAgentReview: bool, reviewModels: ["providerId/modelId", ...] }
 * - 沒設 / false → 單 model（server default）
 * - true 但 reviewModels 去重後 < 2 → 啟動報錯，不靜默降級（品質幻覺比報錯危險）
 *
 * 流程：diff（程式組，事實）→ N 個 reviewer 並行（runAgentLoop in-process，
 * 各帶 modelOverride）→ 行號驗證（防幻覺）→ deterministic 彙總（共識/分歧）
 * → report 落檔 .paaw/review-board/
 *
 * 鐵律：LLM 只推理，事實靠程式 — reviewer 只看程式組好的 diff，
 * finding 行號不在 diff 檔案內 = 自動退件。
 */

import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { readProjectAgent } from "./project-crew.mjs";

const MAX_DIFF_CHARS = 160000; // diff 注入上限（超過截斷標註）

function _git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.trim() : "";
}

/** 讀 EM reviewConfig（.paaw 專案覆蓋 → data/crews global，走既有 readProjectAgent 鏈） */
export function resolveReviewConfig(projectDir) {
  let em = null;
  try { em = readProjectAgent(projectDir, "coding.em"); } catch { /* read fail → 預設關 */ }
  const rc = (em && em.reviewConfig) || {};
  const flag = !!rc.multiAgentReview;
  const models = Array.isArray(rc.reviewModels)
    ? [...new Set(rc.reviewModels.filter(m => typeof m === "string" && m.trim()))]
    : [];
  if (!flag) return { mode: "single", flag, models: [] };
  if (models.length < 2) {
    return {
      mode: "error", flag, models,
      error: "❌ reviewConfig.multiAgentReview 已開啟，但 reviewModels 去重後不足 2 個不同 model。請在 EM 設定（coding.em.json reviewConfig.reviewModels）補齊後重試。不靜默降級為單 model — 你以為有交叉驗證實際沒有，比報錯危險。",
    };
  }
  return { mode: "multi", flag, models };
}

/** 組 deterministic context：commit range 的 changed files + diff（截斷保護） */
function _buildDiffContext(projectDir, ref, pathFilter) {
  const range = ref || "HEAD~1..HEAD";
  const pathArgs = pathFilter ? ["--", pathFilter] : [];
  const nameOut = _git(projectDir, ["diff", "--name-status", range, ...pathArgs]);
  if (!nameOut) {
    const head = _git(projectDir, ["rev-parse", "--short", "HEAD"]);
    throw new Error(`git diff ${range} 沒有輸出（range 不存在或沒有變更${head ? `，HEAD=${head}` : ""}）。可用參數 ref 指定例如 "HEAD~3..HEAD"，或先 commit。`);
  }
  const changed = nameOut.split("\n").map(l => l.split("\t"));
  const files = changed.map(c => c[c.length - 1]).filter(Boolean);
  let diff = _git(projectDir, ["diff", range, ...pathArgs]);
  let truncated = false;
  if (diff.length > MAX_DIFF_CHARS) { diff = diff.slice(0, MAX_DIFF_CHARS); truncated = true; }
  return { range, files, diff, truncated, stat: _git(projectDir, ["diff", "--stat", range, ...pathArgs]) };
}

function _reviewerPrompt(ctx, modelLabel) {
  return `# 任務：Code Review（reviewer：${modelLabel}）

以下是一段 commit 變更（deterministic 事實，由程式提供）。請從三個視角審查：
1. **架構（SA）**：設計一致性、介面契約、職責邊界
2. **實作（Dev）**：邏輯正確性、邊界條件、錯誤處理、可讀性
3. **測試（QA）**：測試覆蓋、可測性、error path

## 規則（鐵律）
- finding **只能**針對 diff 內出現的檔案，行號必須落在該檔的 diff hunk 範圍內
- 需要上下文時可以讀檔案確認，但結論必須落在 diff 檔案上
- severity：critical（必修，會壞）/ major（應修，品質或風險）/ minor（建議）
- 沒有值得講的問題就回空陣列 —— 不要為了交卷硬擠 finding
- 本次任務**只輸出審查結論**：不要寫 qa 記錄、不要開 task、不要改任何檔案

## 變更統計
\`\`\`
${ctx.stat || "(無)"}
\`\`\`
${ctx.truncated ? "\n⚠️ diff 過長已截斷（只審你看到的部分，其餘標 minor 註記即可）\n" : ""}
## Diff
\`\`\`diff
${ctx.diff}
\`\`\`

## 輸出格式（最後必須輸出這個，前面可加簡短說明）
\`\`\`json
[
  {"file":"packages/server/src/...","line":123,"severity":"critical","claim":"一句話問題","evidence":"diff 行號+代碼片段佐證","fix":"建議修法"}
]
\`\`\``;
}

/** 從 reviewer 回覆抽 findings JSON：優先 ```json fence，退化取第一個 [ 到最後一個 ] */
function _parseFindings(text) {
  if (!text || !text.trim()) return { findings: [], parseError: "empty response" };
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i--) {
    try {
      const arr = JSON.parse(fences[i][1].trim());
      if (Array.isArray(arr)) return { findings: arr, parseError: null };
    } catch { /* try next fence */ }
  }
  // 退化：裸 JSON 陣列（模型偶爾不包 fence）
  const s = text.indexOf("[");
  const e = text.lastIndexOf("]");
  if (s >= 0 && e > s) {
    try {
      const arr = JSON.parse(text.slice(s, e + 1));
      if (Array.isArray(arr)) return { findings: arr, parseError: null };
    } catch { /* fallthrough */ }
  }
  return { findings: [], parseError: "no json array found" };
}

function _normPath(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * 主入口：多 model 並行 review
 * @param {object} opts
 * @param {string} opts.projectDir — 專案根
 * @param {string} [opts.ref] — git range，預設 HEAD~1..HEAD
 * @param {string} [opts.pathFilter] — 限定路徑（可選）
 * @param {function} [opts.onProgress] — (msg) 進度回報
 */
export async function runMultiModelReview(opts = {}) {
  const { projectDir, ref, pathFilter, onProgress = () => {} } = opts;
  const cfg = resolveReviewConfig(projectDir);
  if (cfg.mode === "error") throw new Error(cfg.error);

  const ctx = _buildDiffContext(projectDir, ref, pathFilter);
  onProgress(`📋 diff ${ctx.range}：${ctx.files.length} 檔，${ctx.diff.length.toLocaleString()} 字${ctx.truncated ? "（截斷）" : ""}`);

  // reviewer model 清單：multi = reviewModels；single = default（不帶 override）
  const reviewers = cfg.mode === "multi" ? cfg.models : [null];
  const fileSet = new Set(ctx.files.map(_normPath));

  // MR1 實測教訓（2026-10-03）：reviewer 走 agent loop 會拿工具讀檔讀到撞 maxTurns、
  // 結論沒寫出來（glm 14 輪全 tool call）→ 改直接 LLM 呼叫：無工具、單回應、diff 全量在 prompt。
  // 不帶跨 provider fallback — 多 model 交叉驗證的價值在「模型身分固定」，掉線就標錯誤不頂替。
  const { resolveLLMConfig } = await import("./paaw-agent-loop.mjs");
  const { callLLMWithRetry } = await import("./llm-utils.mjs");

  const results = await Promise.allSettled(reviewers.map(async (m) => {
    const label = m || "default";
    const t0 = Date.now();
    try {
      const llm = resolveLLMConfig(projectDir, m || undefined, []);
      const r = await callLLMWithRetry(llm.apiUrl, llm.headers, {
        model: llm.model,
        messages: [
          { role: "system", content: "你是嚴謹的資深 code reviewer。只看使用者給的 diff 事實，不虚構行號。回覆必須以 ```json 陣列結尾。" },
          { role: "user", content: _reviewerPrompt(ctx, label) },
        ],
        temperature: 0.2,
        max_tokens: 16384,
      }, { maxRetries: 2, timeoutMs: 240000, caller: "mm-review", agentId: "coding.qa" });
      const text = r?.content || "";
      const { findings, parseError } = _parseFindings(text);
      return { model: label, ms: Date.now() - t0, findings, parseError, raw: text };
    } catch (e) {
      // 失敗不 throw：帶 model 標籤回報（多 model 交叉驗證要知道是誰掉線）
      return { model: label, ms: Date.now() - t0, findings: [], parseError: `LLM error: ${String(e.message || e).slice(0, 160)}`, raw: "" };
    }
  }));

  // ── 驗證 + 彙總（deterministic）──
  const dropped = [];
  const perModel = [];
  for (const res of results) {
    const rv = res.status === "fulfilled" ? res.value : { model: "(crashed)", error: String(res.reason?.message || res.reason || "reviewer crashed"), findings: [], ms: 0, dropped: 0, parseError: null };
    const valid = [];
    for (const f of rv.findings || []) {
      const fp = _normPath(f.file);
      if (fileSet.has(fp)) valid.push({ ...f, file: fp, line: Number(f.line) || 0, severity: ["critical", "major", "minor"].includes(f.severity) ? f.severity : "minor" });
      else dropped.push({ model: rv.model, file: f.file, line: f.line, claim: String(f.claim || "").slice(0, 80) });
    }
    perModel.push({ model: rv.model, error: rv.parseError && !(rv.findings || []).length ? rv.parseError : null, findings: valid, ms: rv.ms, dropped: (rv.findings || []).length - valid.length });
  }

  // 共識判定：同 file + 同行（±3 行內）+ 同 severity → 併成一條，記 models[]
  const merged = [];
  for (const pm of perModel) {
    for (const f of pm.findings) {
      const hit = merged.find(g => g.file === f.file && Math.abs(g.line - f.line) <= 3 && g.severity === f.severity);
      if (hit) { hit.models.push(pm.model); hit.claims.push({ model: pm.model, claim: f.claim, fix: f.fix }); }
      else merged.push({ ...f, models: [pm.model], claims: [{ model: pm.model, claim: f.claim, fix: f.fix }] });
    }
  }
  const multiModel = perModel.filter(p => !p.error).length > 1;
  for (const g of merged) g.consensus = multiModel && g.models.length > 1;

  const sevCount = { critical: 0, major: 0, minor: 0 };
  for (const g of merged) sevCount[g.severity]++;
  const decision = sevCount.critical > 0 ? "request-changes" : sevCount.major > 0 ? "review-notes" : "approve";

  // ── report 落檔 ──
  const stamp = new Date();
  const ts = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}-${String(stamp.getHours()).padStart(2, "0")}${String(stamp.getMinutes()).padStart(2, "0")}${String(stamp.getSeconds()).padStart(2, "0")}`;
  const outDir = join(projectDir, ".paaw", "review-board");
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, `${ts}-${ctx.range.replace(/[^\w.-]/g, "_")}.md`);
  const sevIcon = { critical: "🔴", major: "🟠", minor: "🟡" };
  const reportMd = [
    `# Multi-Model Code Review Report`,
    ``,
    `- 時間：${stamp.toISOString()}`,
    `- Range：\`${ctx.range}\`${pathFilter ? `（path: \`${pathFilter}\`）` : ""}`,
    `- 檔案數：${ctx.files.length}${ctx.truncated ? "（diff 截斷）" : ""}`,
    `- Reviewers：${perModel.map(p => `\`${p.model}\`${p.error ? " ⚠️" : ""}`).join("、")}`,
    `- 結論：**${decision}**（critical ${sevCount.critical} / major ${sevCount.major} / minor ${sevCount.minor}）`,
    ``,
    `## Findings`,
    ``,
    ...(merged.length === 0 ? ["（無 finding — 全數 reviewer 通過）"] : merged
      .sort((a, b) => ({ critical: 0, major: 1, minor: 2 })[a.severity] - ({ critical: 0, major: 1, minor: 2 })[b.severity] || a.file.localeCompare(b.file))
      .map(g => [
        `### ${sevIcon[g.severity]} ${g.file}:${g.line} ${g.consensus ? "🤝 共識" : "◇ 單獨"}`,
        `- **severity**：${g.severity}　**models**：${g.models.map(m => `\`${m}\``).join("、")}`,
        ...g.claims.map(c => `- \`${c.model}\`：${c.claim}${c.fix ? `　→ 修法：${c.fix}` : ""}`),
        ``,
      ].join("\n"))),
    ``,
    `## 各 Reviewer 明細`,
    ``,
    ...perModel.map(p => `- \`${p.model}\`：${p.findings.length} findings${p.dropped ? `、⚠️ ${p.dropped} 筆退件（行號不在 diff 內）` : ""}${p.error ? `、⚠️ ${p.error}` : ""}（${(p.ms / 1000).toFixed(0)}s）`),
    ...(dropped.length ? [``, `## 退件的幻覺 findings（未採計）`, ``, ...dropped.map(d => `- [${d.model}] ${d.file}:${d.line} ${d.claim}`)] : []),
  ].join("\n");
  writeFileSync(reportPath, reportMd, "utf8");

  return {
    decision, sevCount, merged, perModel, dropped,
    reviewers: perModel.map(p => p.model),
    reportPath, range: ctx.range, files: ctx.files.length,
  };
}

/** 給 agent loop tool 用的精簡文字輸出 */
export function formatReviewResult(r) {
  const lines = [
    `【Multi-Model Review】${r.decision === "approve" ? "✅ approve" : r.decision === "review-notes" ? "🟠 review-notes" : "🔴 request-changes"}`,
    `range ${r.range}｜${r.files} 檔｜reviewers：${r.reviewers.join("、")}`,
    `critical ${r.sevCount.critical} / major ${r.sevCount.major} / minor ${r.sevCount.minor}${r.dropped.length ? `｜⚠️ 幻覺退件 ${r.dropped.length}` : ""}`,
  ];
  for (const g of r.merged.slice(0, 12)) {
    lines.push(`- ${g.severity === "critical" ? "🔴" : g.severity === "major" ? "🟠" : "🟡"} ${g.file}:${g.line} ${g.consensus ? "[共識] " : ""}${(g.claims[0]?.claim || "").slice(0, 100)}`);
  }
  if (r.merged.length > 12) lines.push(`- ...共 ${r.merged.length} 條，詳見 report`);
  lines.push(`📄 完整 report：${r.reportPath}`);
  return lines.join("\n");
}
