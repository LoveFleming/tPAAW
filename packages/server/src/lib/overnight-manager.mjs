/**
 * Overnight Manager — Engineering Manager 自動調度
 *
 * 設計原則：
 *   收集和執行用決定性程式，規劃用 LLM prompt
 *
 * 流程：
 *   1. 【決定性】收集 context（git diff, action log, .paaw/ TODO）
 *   2. 【決定性】整理成「現況摘要」
 *   3. 【LLM】讀摘要 → 規劃工作清單
 *   4. 【決定性】逐一 A2A message/send → agent 執行
 *   5. 【決定性】收集結果 → 寫報告
 */

import { listActionLog, addActionLog } from "./action-log.mjs";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { PaawProject } from "./paaw-project.mjs";

// ── A2A Client ──

export async function a2aCallAgent(baseUrl, agentId, message, opts = {}) {
  const { cwd, timeout = 1800000 } = opts;

  const body = {
    jsonrpc: "2.0",
    method: "message/send",
    params: {
      message: { role: "user", parts: [{ type: "text", text: message }] },
      context: { cwd },
    },
    id: `em-${agentId}-${Date.now()}`,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`${baseUrl}/a2a/${agentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();

    if (data.error) return { success: false, content: "", error: data.error.message };
    const artifacts = data.result?.artifacts || [];
    const texts = artifacts.flatMap(a => a.parts || []).filter(p => p.type === "text" || p.kind === "text").map(p => p.text);
    return { success: true, content: texts.join("\n") || "(no output)" };
  } catch (err) {
    return { success: false, content: "", error: err.message };
  }
}

// ── Layer 1: Deterministic Context Gathering ──

async function gatherContext(rootDir) {
  const { execSync } = await import("child_process");
  const safeDir = JSON.stringify(rootDir);
  const summary = {};

  // 1. Git status (what changed, what's uncommitted)
  try {
    summary.gitStatus = execSync(`cd ${safeDir} && git status --short`, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch { summary.gitStatus = ""; }

  // 2. Git diff stat (what files changed, how much)
  try {
    summary.gitDiffStat = execSync(`cd ${safeDir} && git diff --stat HEAD~5`, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch { summary.gitDiffStat = ""; }

  // 3. Recent commits
  try {
    summary.recentCommits = execSync(`cd ${safeDir} && git log --oneline -10`, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch { summary.recentCommits = ""; }

  // 4. Unpushed commits
  try {
    summary.unpushed = execSync(`cd ${safeDir} && git log --oneline origin/dev..HEAD 2>/dev/null || echo ""`, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch { summary.unpushed = ""; }

  // 5. Action log (change water level — only real changes)
  const actionLog = await listActionLog({ cwd: rootDir, limit: 20, maxChars: 3000 });
  summary.actionLog = actionLog.text;

  // 6. .paaw/ context files
  const paaw = new PaawProject(rootDir);
  summary.paawContext = "";
  for (const f of ["PROJECT.md", "STATUS.md", "DECISIONS.md", "CODING-STANDARDS.md", "CHANGELOG.md", "KNOWN-ISSUES.md", "NEXT-ACTIONS.md", "AI-OPERATING-GUIDE.md"]) {
    const fp = paaw._resolvePath(f);
    if (existsSync(fp)) {
      const content = readFileSync(fp, "utf-8").slice(0, 2000);
      summary.paawContext += `\n### ${f}\n${content}\n`;
    }
  }

  // 7. Build health (quick check)
  try {
    execSync(`cd ${safeDir} && node -e "require('./packages/server/src/paaw-server.mjs')" 2>&1 || true`, { encoding: "utf-8", timeout: 15000 });
    summary.buildHealth = "OK (server module loads)";
  } catch {
    summary.buildHealth = "Check needed";
  }

  return summary;
}

// ── Layer 1: Build "現況摘要" (deterministic) ──

function buildSituationReport(ctx) {
  let report = `## 專案現況摘要\n\n`;

  if (ctx.gitStatus) {
    report += `### Git Status（未提交變更）\n\`\`\`\n${ctx.gitStatus}\n\`\`\`\n\n`;
  } else {
    report += `### Git Status\n工作目錄乾淨，沒有未提交變更。\n\n`;
  }

  if (ctx.gitDiffStat) {
    report += `### 最近 5 commit 的 diff stat\n\`\`\`\n${ctx.gitDiffStat}\n\`\`\`\n\n`;
  }

  if (ctx.recentCommits) {
    report += `### 最近 10 個 commit\n\`\`\`\n${ctx.recentCommits}\n\`\`\`\n\n`;
  }

  if (ctx.unpushed) {
    report += `### ⚠️ 未 Push 的 commit\n\`\`\`\n${ctx.unpushed}\n\`\`\`\n\n`;
  }

  if (ctx.actionLog) {
    report += `### Action Log（Change 水位 — 最近 20 條 agent 變更紀錄）\n${ctx.actionLog}\n\n`;
  } else {
    report += `### Action Log\n目前沒有 agent 變更紀錄。\n\n`;
  }

  if (ctx.paawContext) {
    report += `### 專案知識\n${ctx.paawContext}\n`;
  }

  return report;
}

// ── Layer 2: LLM Work Planning ──

async function planWorkList(situationReport, rootDir) {
  const { resolveLLMConfig, callLLM } = await import("./paaw-agent-loop.mjs");
  const llm = resolveLLMConfig(rootDir);

  const EM_PROMPT = `你是 AI Coding Team 的 Engineering Manager (武大安)。

## 你的角色
你是技術主管，不是執行者。你讀現況摘要，判斷什麼需要做，分配給合適的 agent。
你不寫程式、不跑測試。你規劃、分配、追蹤。

## 可調度的 Agent 及能力
- **architect** — 架構審查、技術決策（ADR）、風險評估、模組邊界規劃
- **developer** — 寫程式、修 bug、refactor、實作功能、全端開發
- **tester** — 撰寫單元測試/整合測試/E2E、跑測試、覆蓋率分析
- **doc-writer** — 寫 README、API docs、changelog、技術文件
- **helpdesk** — 技術支援、排查問題、操作指引

## 規劃原則
1. **從 change 水位出發** — 看 action log 裡最近的變更，找出未完成的工作或遺漏
2. **有未 push 的 commit** → 優先指派 developer 確認 + push
3. **有未提交的變更** → 評估是否需要 developer 補完
4. **缺少測試** → 指派 tester 補測試
5. **缺少文檔** → 指派 doc-writer 補文檔
6. **架構有風險** → 指派 architect 審查
7. 每項任務必須**具體、可執行** — agent 拿到就能直接做
8. 3-5 項，不要太多。品質 > 數量

## 任務描述規則
- ❌ "改善程式碼品質"（太空泛）
- ✅ "為 packages/ui/src/components/SidebarFileTree.tsx 的 openFile 函數寫單元測試"
- ❌ "更新文檔"（太模糊）
- ✅ "根據最近 5 個 commit 更新 .paaw/CHANGELOG.md"

## 輸出格式（嚴格 JSON array，不要其他文字）
[
  {
    "agent": "developer",
    "task": "具體任務描述，agent 拿到就能執行",
    "priority": "high",
    "reason": "為什麼需要這項工作（一句話）"
  }
]`;

  const messages = [
    { role: "system", content: EM_PROMPT },
    { role: "user", content: situationReport },
  ];

  try {
    const response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, []);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const list = JSON.parse(match[0]);
      // Validate
      return list.filter(item => item.agent && item.task);
    }
    return [];
  } catch (err) {
    console.error("[EM] planWorkList error:", err.message);
    return [];
  }
}

// ── Main: Run EM Session ──

export async function runEMSession(opts = {}) {
  const { rootDir, baseUrl = "http://127.0.0.1:4097" } = opts;
  const sendSSE = opts.sendSSE || (() => {});

  // ── Phase 1: Deterministic gathering ──
  sendSSE("info", { message: "🎖️ EM 啟動，收集專案狀態..." });
  const ctx = await gatherContext(rootDir);
  const situationReport = buildSituationReport(ctx);
  sendSSE("info", { message: `📊 現況摘要收集完成` });

  if (ctx.unpushed) {
    sendSSE("warning", { message: `⚠️ 發現 ${ctx.unpushed.split("\n").length} 個未 push 的 commit` });
  }

  // ── Phase 2: LLM planning ──
  sendSSE("info", { message: "🧠 規劃工作清單中..." });
  const workList = await planWorkList(situationReport, rootDir);

  if (!workList.length) {
    sendSSE("info", { message: "✅ 目前沒有需要調度的工作，專案狀態良好。" });
    const report = generateReport([], [], situationReport);
    await saveReport(rootDir, report);
    return { report, workList: [], results: [] };
  }

  sendSSE("plan", { workList });
  sendSSE("info", { message: `📋 規劃了 ${workList.length} 項工作：` });
  for (const w of workList) {
    sendSSE("info", { message: `  • [${w.priority}] ${w.agent}: ${w.task}${w.reason ? ` — ${w.reason}` : ""}` });
  }

  // ── Phase 3: Deterministic execution ──
  const results = [];
  for (let i = 0; i < workList.length; i++) {
    const task = workList[i];
    sendSSE("task_start", { index: i + 1, total: workList.length, ...task });

    const result = await a2aCallAgent(baseUrl, task.agent, task.task, {
      cwd: rootDir,
      timeout: 1800000,
    });

    results.push({ ...task, ...result });

    if (result.success) {
      sendSSE("task_done", { index: i + 1, agent: task.agent, preview: result.content.slice(0, 200) });
    } else {
      sendSSE("task_error", { index: i + 1, agent: task.agent, error: result.error });
    }
  }

  // ── Phase 4: Deterministic reporting ──
  sendSSE("info", { message: "📝 產生報告中..." });
  const report = generateReport(workList, results, situationReport);
  await saveReport(rootDir, report);
  sendSSE("report", { report });

  // EM records a summary change
  await addActionLog({
    agent: "em",
    action: "decide",
    summary: `EM session 完成：調度 ${workList.length} 項工作，成功 ${results.filter(r => r.success).length} 項`,
    details: workList.map(w => `${w.priority}/${w.agent}: ${w.task}`).join("\n"),
    affectedFiles: [],
    result: "adr",
    priority: "high",
  }, rootDir);

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  sendSSE("done", { totalTasks: workList.length, succeeded, failed });

  return { report, workList, results };
}

// ── Report Generation ──

function generateReport(workList, results, situationReport) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  let report = `# 🎖️ Engineering Manager 報告\n\n`;
  report += `**日期：** ${dateStr}\n`;
  report += `**時間：** ${now.toTimeString().slice(0, 8)}\n`;
  report += `**結果：** ✅ ${succeeded} 成功 / ❌ ${failed} 失敗 / ${workList.length} 總計\n\n`;
  report += `---\n\n## 📊 專案現況\n\n${situationReport}\n\n---\n\n## 📋 工作清單\n\n`;

  for (let i = 0; i < workList.length; i++) {
    const w = workList[i];
    const r = results[i];
    const icon = r.success ? "✅" : "❌";
    report += `### ${i + 1}. ${icon} [${w.priority}] ${w.agent} — ${w.task}\n`;
    if (w.reason) report += `> ${w.reason}\n`;
    report += `\n`;
    if (r.success) {
      report += `**結果：**\n\`\`\`\n${r.content.slice(0, 1500)}\n\`\`\`\n\n`;
    } else {
      report += `**錯誤：** ${r.error}\n\n`;
    }
  }

  report += `---\n\n*由 PAAW Engineering Manager 自動產生*\n`;
  return report;
}

async function saveReport(rootDir, report) {
  const dir = join(rootDir, ".paaw", "overnight-reports");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, `${dateStr}.md`), report, "utf-8");
}
