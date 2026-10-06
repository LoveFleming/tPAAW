/**
 * error-code-scan.mjs — Error Codes by Feature（2026-09-05 v2 — Fleming 方向修正）
 *
 * ❌ v1 教訓：regex 只認 SYS|BIZ|EXT 慣例 → OSS/別家 project 掃出來永遠 0，沒用
 * ✅ v2 分工：
 *   - 程式：收集「error 訊號行」（throw/raise/Error/status 4xx-5xx…不認任何命名）
 *   - LLM：語意整理 — 每 feature 的 error 處理現況、既有慣例判讀
 *   - 全新 RU 沒系統性慣例 → LLM 在 recommendation 建議導入 Error Code Rules v1
 *
 * 產出：{ru}/.paaw/error-codes.json
 *   { scannedAt, method:"llm-v2", conventions, conventionNote,
 *     recommendation: { suggest, plan },
 *     byFeature: [{ featureId, featureName, summary, codes:[{code|null, message, kind,
 *                httpStatus|null, file, line, note?}], uniqueCount }],
 *     unmapped: [...same codes shape], stats: { total, uniqueCodes, featureCount } }
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve, relative, extname } from "path";
import { DATA_HOME } from "../data-home.mjs";
import { loadProjectIgnore } from "./cu-source-scan.mjs";
import { stableStringify } from "./stable-stringify.mjs";

// ── 語言泛用的 error 訊號（不認任何命名慣例） ──
const SIGNAL_RULES = [
  { kind: "throw", re: /\bthrow\b|\braise\b|panic\(/ },
  { kind: "http", re: /status(?:Code)?\s*[:(=]\s*["']?[45]\d\d|\.status\(\s*[45]\d\d/i },
  { kind: "error-call", re: /new\s+[A-Za-z_$][\w$]*Error\b|errors?\.New\b|fmt\.Errorf|Exception\(|Errorf\(/ },
  { kind: "error-ref", re: /\breject\s*\(|err(?:no|code|_code)\b|error[_A-Z]|Error\b/ },
];

const SOURCE_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".java",
  ".kt", ".kts", ".rs", ".rb", ".php", ".cs", ".swift", ".scala",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".paaw", "dist", "build", "out", "coverage",
  ".next", ".nuxt", "vendor", "target", "__pycache__", ".venv", "venv",
  "semgrep-rules", "fixtures", ".cache",
]);

const MAX_PER_FILE = 40;    // 單檔訊號上限（防爆）
const MAX_PER_FEATURE = 14; // 單 feature 餵 LLM 的訊號上限
const MAX_GLOBAL = 700;     // 總量上限（單次 LLM call 的素材量）
const MAX_TEXT = 160;

function* _walk(dir, root, ignore) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") continue;
    const p = join(dir, e.name);
    // 2026-09-06：支援 .gitignore（tpaaw-gateway versions/ 12000+ 備份檔不再污染 error 訊號）
    const rel = relative(root, p).replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (ignore.shouldIgnore(rel, true)) continue;
      yield* _walk(p, root, ignore);
    } else if (e.isFile() && SOURCE_EXTS.has(extname(e.name)) && !e.name.endsWith(".d.ts")) {
      if (ignore.shouldIgnore(rel, false)) continue;
      yield p;
    }
  }
}

/**
 * 收集 error 訊號 → 按 Feature Map 歸屬（純 deterministic、零 token、不認命名）
 * 回傳 prompt 用素材（compact keys 省 token）
 */
export function collectErrorSignals(root) {
  const projectRoot = resolve(root);

  // file → features
  const fileToFeatures = new Map();
  let featureOrder = [];
  try {
    const fm = JSON.parse(readFileSync(join(projectRoot, ".paaw", "features", "FEATURES.json"), "utf-8"));
    const features = Array.isArray(fm) ? fm : (fm.features || []);
    featureOrder = features.map(f => ({ id: f.id || f.name, name: f.name }));
    for (const f of features) {
      for (const cf of [...(f.codeFiles || []), ...(f.tests || [])]) {
        const rel = String(cf).replace(/\\/g, "/").replace(/^\.\//, "");
        if (!fileToFeatures.has(rel)) fileToFeatures.set(rel, []);
        fileToFeatures.get(rel).push(f.id || f.name);
      }
    }
  } catch { /* 沒 feature map → 全進 unmapped，照樣可整理 */ }

  const featMap = new Map(); // featureId → signals[]
  const unmapped = [];
  let totalSignals = 0;

  for (const filePath of _walk(projectRoot, projectRoot, loadProjectIgnore(projectRoot))) {
    let lines;
    try { lines = readFileSync(filePath, "utf-8").split("\n"); } catch { continue; }
    const rel = relative(projectRoot, filePath).replace(/\\/g, "/");
    let fileCount = 0;
    const seen = new Set();
    for (let i = 0; i < lines.length && fileCount < MAX_PER_FILE; i++) {
      const raw = lines[i];
      if (!raw || raw.length > 300) continue; // 空行/minified 跳過
      const text = raw.trim();
      if (!text || text.startsWith("//") || text.startsWith("#") || text.startsWith("*")) continue;
      const key = text.slice(0, 80);
      if (seen.has(key)) continue;
      let kind = null;
      for (const r of SIGNAL_RULES) { if (r.re.test(text)) { kind = r.kind; break; } }
      if (!kind) continue;
      // 「catch (e) {」這種零訊息行跳過 — 對 LLM 沒價值
      if (kind === "error-ref" && text.length < 12) continue;
      seen.add(key);
      fileCount++;
      totalSignals++;
      const sig = { f: rel, l: i + 1, t: text.slice(0, MAX_TEXT), k: kind };
      const feats = fileToFeatures.get(rel) || [];
      if (feats.length === 0) unmapped.push(sig);
      else for (const fid of feats) {
        if (!featMap.has(fid)) featMap.set(fid, []);
        featMap.get(fid).push(sig);
      }
    }
  }

  // 壓成 prompt 素材：throw 優先，per-feature 上限，全域上限
  const capFeature = (sigs) =>
    [...sigs].sort((a, b) => KIND_RANK[a.k] - KIND_RANK[b.k]).slice(0, MAX_PER_FEATURE);
  const features = [];
  let used = 0;
  const orderedIds = new Set(featureOrder.map(f => f.id));
  const allIds = [...new Set([...orderedIds, ...featMap.keys()])];
  for (const fid of allIds) {
    const sigs = featMap.get(fid) || [];
    if (!sigs.length) continue;
    const capped = capFeature(sigs).slice(0, Math.max(0, MAX_GLOBAL - used));
    if (!capped.length) break;
    used += capped.length;
    const meta = featureOrder.find(f => f.id === fid);
    features.push({ featureId: fid, featureName: meta?.name || fid, signals: capped, signalCount: sigs.length });
  }

  return {
    projectRoot,
    totalSignals,
    features,
    unmappedCount: unmapped.length,
    unmappedSample: unmapped.slice(0, 8),
    truncated: totalSignals > MAX_GLOBAL,
  };
}
const KIND_RANK = { throw: 0, http: 1, "error-call": 2, "error-ref": 3 };

/** 載入 prompt 模板（per-RU 可覆蓋：.paaw/prompts/code-understanding/error-codes.md） */
export function loadEcPromptTemplate(projectRoot) {
  const override = join(projectRoot, ".paaw", "prompts", "code-understanding", "error-codes.md");
  if (existsSync(override)) { try { return readFileSync(override, "utf-8"); } catch {} }
  try { return readFileSync(join(DATA_HOME, "prompts", "code-understanding", "error-codes.md"), "utf-8"); } catch { return ""; }
}

function _normCode(c) {
  if (!c || typeof c !== "object") return null;
  const file = typeof c.file === "string" ? c.file.replace(/\\/g, "/") : null;
  if (!file) return null; // 沒檔案 = LLM 空想 → 丟棄（No answer without evidence）
  const code = typeof c.code === "string" && c.code.trim() ? c.code.trim() : null;
  const message = typeof c.message === "string" ? c.message.slice(0, 200) : (code ? "" : "(no message)");
  return {
    code, message,
    kind: ["throw", "http", "reference", "error-call"].includes(c.kind) ? c.kind : "reference",
    httpStatus: Number.isFinite(+c.httpStatus) && +c.httpStatus >= 400 && +c.httpStatus <= 599 ? +c.httpStatus : null,
    file, line: Number.isFinite(+c.line) ? +c.line : null,
    note: typeof c.note === "string" ? c.note.slice(0, 200) : undefined,
  };
}

/**
 * 完整整理：收集 → LLM 語意整理 → normalize → 寫 .paaw/error-codes.json
 * @param callLLM async ({messages, temperature, thinking}) => {content}
 */
/**
 * 截斷 JSON 修復：LLM 回應被 max_tokens 砍半時，從最後一個完整元素切斷、
 * 補上未閉合的 }/]，儘量救回已完成的部分。回傳 null = 救不回來。
 */
function repairTruncatedJson(txt) {
  const CLOSER = { "{": "}", "[": "]" };
  const stack = [];
  let inStr = false, esc = false;
  const safePos = [0]; // 可安全截斷的位置（完整元素/逗號之後）
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') { inStr = false; safePos.push(i + 1); }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") { stack.pop(); safePos.push(i + 1); }
    else if (ch === ",") safePos.push(i);
  }
  // 從最後一個安全位置往回試：切斷 → 砍殘尾 → 補 closers → parse；第一個成功的就採用
  for (let k = safePos.length - 1; k >= 0; k--) {
    let out = txt.slice(0, safePos[k]).replace(/,\s*$/, "");
    // 尾端殘留半個 key（"xxx" 後面沒有 : value）也砍掉
    out = out.replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/, "");
    const closers = [...stack].reverse().map(c => CLOSER[c]).join("");
    try {
      const v = JSON.parse(out + closers);
      if (v && typeof v === "object") return v;
    } catch { /* 往前一個安全點再試 */ }
  }
  return null;
}

export async function organizeErrorCodes(root, { callLLM, onProgress, timeoutMs = 600_000 } = {}) {
  const material = collectErrorSignals(root);
  if (!material.totalSignals) {
    return { skipped: true, reason: "no error signals found", stats: { total: 0, uniqueCodes: 0, featureCount: 0 } };
  }
  const template = loadEcPromptTemplate(resolve(root));
  if (!template) throw new Error("prompt template error-codes.md not found");

  const userContent = template
    + `\n\n--- ERROR SIGNALS（機器收集，可能含雜訊 — 由你判讀過濾）---\n`
    + stableStringify({
        features: material.features,
        unmappedCount: material.unmappedCount,
        unmappedSample: material.unmappedSample,
        truncated: material.truncated,
      });

  onProgress?.(`LLM organizing ${material.features.length} features / ${material.totalSignals} signals...`);
  const res = await callLLM({
    messages: [{ role: "user", content: userContent }],
    temperature: 0,
    thinking: { type: "disabled" },
    timeoutMs,
  });
  let txt = String(res?.content || "").trim();
  if (!txt) throw new Error("empty LLM response");
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) txt = fence[1].trim();
  // 2026-10-06：LLM 回應被 max_tokens 截斷 → JSON.parse 炸 "Unterminated string at position N"；先原樣試，失敗用截斷修復救回已完成部分
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch (firstErr) {
    parsed = repairTruncatedJson(txt);
    if (!parsed) {
      throw new Error(`error-codes LLM JSON parse failed: ${firstErr.message}（回應可能被 max_tokens 截斷 — 調高 providers.json 的 model maxTokens 或縮小掃描範圍後重試）`);
    }
    console.warn(`[error-code-scan] LLM JSON truncated — repaired partial result (original error: ${firstErr.message})`);
  }

  // normalize + 驗證：只留素材中存在的 featureId；codes 必須帶 file
  const validIds = new Set(material.features.map(f => f.featureId));
  const byFeature = [];
  for (const g of Array.isArray(parsed.byFeature) ? parsed.byFeature : []) {
    if (!g || !validIds.has(g.featureId)) continue;
    const codes = (Array.isArray(g.codes) ? g.codes : []).map(_normCode).filter(Boolean);
    if (!codes.length && !g.summary) continue;
    byFeature.push({
      featureId: g.featureId,
      featureName: String(g.featureName || g.featureId).slice(0, 120),
      summary: String(g.summary || "").slice(0, 400),
      codes,
      uniqueCount: new Set(codes.map(c => c.code || c.message)).size,
    });
  }
  byFeature.sort((a, b) => b.uniqueCount - a.uniqueCount);
  const unmapped = (Array.isArray(parsed.unmapped) ? parsed.unmapped : []).map(_normCode).filter(Boolean);
  const allCodes = byFeature.flatMap(g => g.codes);
  const result = {
    scannedAt: new Date().toISOString(),
    method: "llm-v2",
    conventions: ["none", "systematic", "mixed"].includes(parsed.conventions) ? parsed.conventions : "unknown",
    conventionNote: String(parsed.conventionNote || "").slice(0, 500),
    recommendation: {
      suggest: parsed.recommendation?.suggest === true,
      plan: String(parsed.recommendation?.plan || "").slice(0, 2000),
    },
    stats: {
      total: allCodes.length,
      uniqueCodes: new Set(allCodes.map(c => c.code || c.message)).size,
      featureCount: byFeature.length,
    },
    byFeature,
    unmapped,
  };
  const outPath = join(resolve(root), ".paaw", "error-codes.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  return result;
}
