/**
 * Overnight Manager — Engineering Manager 自動調度 + Night Shift Parallel
 *
 * 設計原則：
 *   收集和執行用決定性程式，規劃用 LLM prompt
 *
 * 兩種模式：
 *   mode: "em"       → EM 先讀現況 → LLM 規劃 → A2A 調度 agent（聰明但慢）
 *   mode: "parallel" → 全員平行跑，固定 6 agent（快但固定）
 *
 * 共用邏輯在 night-shift-shared.mjs
 *
 * 流程（EM 模式）：
 *   1. 【決定性】收集 context
 *   2. 【決定性】整理成「現況摘要」
 *   3. 【LLM】讀摘要 → 規劃工作清單
 *   4. 【決定性】逐一 A2A message/send → agent 執行
 *   5. 【決定性】收集結果 → 寫報告
 *
 * 流程（Parallel 模式）：
 *   1. 【決定性】收集 context
 *   2. 【決定性】所有 agent 平行跑（用 runAgentLoop）
 *   3. 【決定性】收集結果 → 寫報告
 */

import { addActionLog } from "./action-log.mjs";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  gatherContext,
  buildSituationReport,
  refreshFeatureMapping,
  validateFeatureMap,
  saveNightShiftReport,
} from "./night-shift-shared.mjs";

// ── A2A Client ──

export async function a2aCallAgent(baseUrl, agentId, message, opts = {}) {
  const { cwd, timeout = 0, modelOverride } = opts; // 0 = no HTTP timeout, agent loop handles its own

  const params = {
    message: { role: "user", parts: [{ type: "text", text: message }] },
    context: { cwd },
  };
  // Pass model override so A2A agents use the configured model, not the global default
  if (modelOverride) {
    params.metadata = { model: modelOverride };
  }

  const body = {
    jsonrpc: "2.0",
    method: "message/send",
    params,
    id: `em-${agentId}-${Date.now()}`,
  };

  const url = `${baseUrl}/a2a/${agentId}`;

  // Retry on fetch errors (network glitches, transient connection resets)
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (timer) clearTimeout(timer);
      const data = await res.json();

      if (data.error) return { success: false, content: "", error: data.error.message };
      const artifacts = data.result?.artifacts || [];
      const texts = artifacts.flatMap(a => a.parts || []).filter(p => p.type === "text" || p.kind === "text").map(p => p.text);
      return { success: true, content: texts.join("\n") || "(no output)" };
    } catch (err) {
      const isFetchErr = err.message && (err.message.includes("fetch failed") || err.message.includes("ECONNRESET") || err.message.includes("aborted"));
      if (isFetchErr && attempt < maxRetries) {
        console.log(`[EM] a2aCallAgent ${agentId}: fetch failed (attempt ${attempt + 1}), retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      return { success: false, content: "", error: err.message };
    }
  }
  return { success: false, content: "", error: "Max retries exceeded" };
}

// ── LLM Work Planning（EM 模式用） ──

async function planWorkList(situationReport, rootDir, modelOverride, fallbackModels = [], sendSSE = (() => {}), projectPhase = 'bootstrap') {
  const { resolveLLMConfig } = await import("./paaw-agent-loop.mjs");
  const { callLLMWithRetry } = await import("./llm-utils.mjs");

  // ── Read EM config for planning behavior ──
  let emConfig = null;
  try {
    const { readEMConfig } = await import("./em-config.mjs");
    emConfig = readEMConfig(rootDir);
  } catch { /* em-config not available */ }

  // Resolve planning model: EM config > param > global default
  const planningModel = emConfig?.model?.planning || modelOverride;
  const llm = resolveLLMConfig(rootDir, planningModel);

  // ── Build dynamic agent list from project crew ──
  const { getDispatchableAgents } = await import("./project-crew.mjs");
  const dispatchable = getDispatchableAgents(rootDir);
  const agentListText = dispatchable.map(a => {
    const shortId = a.id.replace(/^(coding\.|custom\.)/, "");
    return `- **${shortId}** — ${a.expertise || a.title || "(no expertise listed)"}`;
  }).join("\n");

  // ── Build EM config-driven prompt sections ──
  const strategy = emConfig?.dispatchStrategy || 'balanced';
  const maxSubs = emConfig?.taskDecomposition?.maxSubtasks || 15;
  const defaultEffort = emConfig?.taskDecomposition?.defaultEffort || 'S';
  const requireEstimate = emConfig?.taskDecomposition?.requireEstimate ?? true;
  const reportFormat = emConfig?.reporting?.format || 'summary';
  const scope = emConfig?.planningScope || {};

  // Strategy description
  const strategyDesc = {
    conservative: '【保守模式】只規劃，不自動執行。每項工作都要人工確認後才執行。',
    balanced: '【平衡模式】規劃完成後等待人工確認，確認後逐一執行。',
    aggressive: '【積極模式】規劃完成後直接執行，不需人工確認。盡量多做。',
  }[strategy] || '【平衡模式】規劃完成後等待人工確認。';

  // ── Project phase constraints ──
  const phaseConstraints = {
    bootstrap: `【🏗️ Bootstrap 階段】
- ✅ 只指派 developer 和 architect（寫碼、修 bug、評估架構）
- ❌ 不要指派 tester、qa、doc-writer（初期先衝功能，測試文件之後再補）
- 重點：快速推進功能開發，不追求測試覆蓋率和文檔完整性`,
    mvp: `【📦 MVP 階段】
- ✅ 主要指派 developer 和 architect
- ✅ 如果有明確的安全隱患可指派 qa 做基本審查
- ❌ 不要指派 tester、doc-writer（功能還在快速變動）
- 重點：核心功能優先，品質靠人工把關`,
    growth: `【📈 Growth 階段】
- ✅ 全部 agent 都可以指派
- ⚠️ tester 可以開始寫關鍵模組的測試
- ⚠️ doc-writer 可以開始補核心 API 文件
- 重點：開始建立品質基礎，但開發仍是主線`,
    stable: `【✅ Stable 階段】
- ✅ 全部 agent 都可以指派
- ⚠️ 重視測試覆蓋率、文檔完整性、安全修復
- 重點：品質維護和文檄建設與開發並重`,
    refactor: `【🔧 Refactor 階段】
- ✅ 全部 agent 都可以指派
- ⚠️ 每個變更都需要 review 和回歸測試
- 重點：不要打壞現有功能，每步都要謹慎`,
  }[projectPhase] || phaseConstraints.bootstrap;

  // Planning scope sections (dynamic)
  const scopeSections = [];
  if (scope.gitChanges !== false) scopeSections.push(`### 1. Git Changes（程式碼變更）
- 最近 commit 改了什麼？有沒有遺漏？
- 有未 push 的 commit → 報告中標注，但**不指派 push**
- 有未提交的變更 → 評估是否需要 developer 補完`);
  if (scope.openIssues !== false) scopeSections.push(`### 2. Open Issues（已知問題）
- 每個 open issue 都要評估是否在這次處理
- high priority issue → 優先指派 agent 修復
- 需要先有 architect 評估的 → 指派 architect`);
  if (scope.openTasks !== false) scopeSections.push(`### 3. Open Tasks（待辦任務）
- 已經建立但未完成的 task
- 有 assignee 的 → 確認是否方向正確
- security 類 task → 高優先級`);
  if (scope.securityFindings !== false) scopeSections.push(`### 4. Security Findings（安全掃描）
- WARNING+ 以上的 finding 要認真處理
- 最常見的檔案優先修復
- 可以一次修多個 → 一個 developer task 處理一個檔案`);
  if (scope.codeIntelligence) scopeSections.push(`### 5. Code Intelligence（程式碼智慧）
- 分析模組依賴關係和架構風險
- 複雜度過高的函式 → 指派 architect 評估`);
  if (scope.testCoverage !== false) scopeSections.push(`### ${scope.codeIntelligence ? '6' : '5'}. Code Quality（程式碼品質）
- 缺少測試的模組 → 指派 tester
- 缺少文檔的功能 → 指派 doc-writer
- 架構有風險 → 指派 architect`);
  const scopeText = scopeSections.join('\n\n');

  const EM_PROMPT = `你是 AI Coding Team 的 Engineering Manager (陳哲宇 Ethan)。

## 你的角色
你是技術主管，不是執行者。你讀現況摘要，判斷什麼需要做，分配給合適的 agent。
你不寫程式、不跑測試。你規劃、分配、追蹤。

## 可調度的 Agent 及能力
${agentListText}

## 調度策略
${strategyDesc}

## 專案階段限制
${phaseConstraints}

## 規劃範圍

你需要統整以下面向來規劃工作，不要只看 git change：

${scopeText}

## 長時間調度策略

這是長時間的調度任務，一次可能要跑 ${Math.min(maxSubs, 5)}-${maxSubs} 項工作。規劃時注意：

1. **批次設計** — 相關工作分在同一批次（例如 3 個 security fix 都指派給 developer）
2. **順序相依** — 如果 A 的結果影響 B，A 要排在前面
3. **獨立性** — 每個 task 要能獨立執行，不能依賴另一個 task 的結果
4. **不要重複** — 同一個檔案的修復合併成一個 task
5. **每個 task 要具體、可執行** — agent 拿到就能直接做

## Context 管理規則

每個 agent 都是獨立 session，看不到其他 agent 的對話。所以：
- task 描述要包含所有必要 context（檔案路徑、問題描述、預期結果）
- 不要假設 agent 知道之前的 task 做了什麼
- 如果 task 需要參考某個文件 → 在 task 中指明（例如「參考 .paaw/CODING-STANDARDS.md 的路徑規範」）

## 任務描述規則
- ❌ "改善程式碼品質"（太空泛）
- ✅ "修復 packages/ui/src/components/DirectoryExplorer.tsx 的 ~ 路徑展開問題：手動輸入 ~/App 時 server 端 resolve() 產生錯誤路徑。在 crew.mjs 的 /api/fs/browse handler 加入 ~ 展開邏輯"
- ❌ "更新文檔"（太模糊）
- ✅ "根據最近 5 個 commit 更新 .paaw/CHANGELOG.md，包含 DirectoryExplorer 修復和 EM header 統一"
- ❌ "修 security"（太模糊）
- ✅ "修復 packages/server/src/routes/coding.mjs 的 path traversal 風險（CWE-22）：line 1340 的 date 參數未做路徑驗證"

## 數量指引
- 上限：${maxSubs} 項（不要超過）
- 少量高品質：${Math.min(Math.floor(maxSubs/2), 5)}-${Math.min(maxSubs-2, 8)} 項
- 每項都要能切實完成
${requireEstimate ? '- 每項必須附預估 effort（' + defaultEffort + ' 为默认）' : ''}

## 報告偏好
- 格式：${reportFormat}${reportFormat === 'executive' ? '（簡潔决策導向）' : reportFormat === 'detailed' ? '（完整細節）' : '（摘要）'}

## 輸出格式（嚴格 JSON array，不要其他文字）
\`\`\`json
[
  {
    "agent": "developer",
    "task": "具體任務描述，包含檔案路徑、問題、預期結果。agent 看到就能獨立執行",
    "priority": "high",
    "reason": "為什麼需要這項工作（一句話）"
  }
]
\`\`\`

 priorities: high / medium / low`;

  const messages = [
    { role: "system", content: EM_PROMPT },
    { role: "user", content: situationReport },
  ];

  // ── LLM call with model fallback ──
  async function callWithFallback(body, opts = {}) {
    const models = [planningModel, ...fallbackModels].filter(Boolean);
    if (models.length === 0) {
      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, body, {
        maxRetries: 3,
        timeoutMs: 60000,
        validateContent: true,
        sanitize: true,
        caller: "overnight",
        agentId: "overnight",
        ...opts,
      });
      return result;
    }
    for (let i = 0; i < models.length; i++) {
      try {
        const m = resolveLLMConfig(rootDir, models[i]);
        const result = await callLLMWithRetry(m.apiUrl, m.headers, { ...body, model: m.model || m.defaultModel }, {
          maxRetries: 2,
          timeoutMs: 60000,
          validateContent: true,
          sanitize: true,
          caller: "overnight",
          agentId: "overnight",
          ...opts,
        });
        if (result) return result;
      } catch (err) {
        console.log(`[EM] Model ${models[i]} failed: ${err.message.slice(0, 100)}`);
        if (i === models.length - 1) throw err;
      }
    }
    return null;
  }

  try {
    const body = {
      model: llm.model,
      messages,
      max_tokens: llm.maxTokens || 16384,
      stream: false,
    };
    sendSSE("llm_start", { message: "📡 呼叫 LLM 規劃中...", model: llm.model || planningModel || "default", contextLength: situationReport.length });
    console.log(`[EM] planWorkList: calling LLM (model=${llm.model || planningModel || "default"}, context=${situationReport.length} chars, strategy=${strategy}, maxSubs=${maxSubs})`);
    const result = await callWithFallback(body);
    const text = result?.content || "";
    console.log("[EM] planWorkList LLM response length:", text.length);
    console.log("[EM] planWorkList LLM response preview:", text.slice(0, 500));
    sendSSE("llm_done", { message: `✅ LLM 回覆 ${text.length} chars`, preview: text.slice(0, 200) });
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const list = JSON.parse(match[0]);
        console.log("[EM] planWorkList parsed:", list.length, "items");
        return list.filter(item => item.agent && item.task);
      } catch (parseErr) {
        console.error("[EM] planWorkList JSON parse failed:", parseErr.message);
        return [];
      }
    }
    console.error("[EM] planWorkList: no JSON array found in LLM response");
    return [];
  } catch (err) {
    console.error("[EM] planWorkList error:", err.message);
    return [];
  }
}

// ── Phase 0: Feature Map Refresh + Validation（共用） ──

async function runPhase0(rootDir, modelOverride, fallbackModels, sendSSE) {
  console.log("[NightShift] ═══ Phase 0: Feature Map Refresh + Validation ═══");
  // Feature Map refresh
  sendSSE("info", { message: "🗺️ Phase 0: 更新 Feature Map..." });
  try {
    const refreshed = await refreshFeatureMapping(rootDir, modelOverride, fallbackModels, sendSSE);
    if (refreshed.ok) {
      console.log(`[NightShift] Phase 0: Feature Map updated ${refreshed.updated}/${refreshed.total}`);
    } else {
      console.log(`[NightShift] Phase 0: Feature Map failed: ${refreshed.error}`);
      sendSSE("warning", { message: `🗺️ Feature Map 更新失敗：${refreshed.error || 'unknown'}` });
    }
  } catch (err) {
    console.log(`[NightShift] Phase 0: Feature Map skipped: ${err.message}`);
    sendSSE("warning", { message: `🗺️ Feature Map 更新略過：${err.message}` });
  }

  // L3 Validation
  console.log("[NightShift] Phase 0: Validating Feature Map...");
  sendSSE("info", { message: "🔍 Phase 0: 驗證 Feature Map..." });
  await validateFeatureMap(rootDir, sendSSE);
  console.log("[NightShift] Phase 0: Done ✓");
}

// ── EM Mode: Run EM Session ──

// ── EM Plan only (Phase 0-2): gather context + LLM planning ──
export async function planEMSession(opts = {}) {
  const { rootDir, since, modelOverride, fallbackModels = [], sendSSE = (() => {}) } = opts;

  // ── Read EM config for planning model ──
  let emPlanningModel = null;
  try {
    const { readEMConfig } = await import("./em-config.mjs");
    const emConfig = readEMConfig(rootDir);
    emPlanningModel = emConfig?.model?.planning || null;
  } catch { /* em-config not available */ }

  const effectiveModel = emPlanningModel || modelOverride;

  console.log("[NightShift] 🎖️═══ EM Plan (no execute) ═══🎖️");
  console.log(`[NightShift] rootDir=${rootDir}, since=${since || "today"}, model=${effectiveModel || "default"}${emPlanningModel ? " (from EM config)" : ""}`);

  // ── Phase 0 ──
  await runPhase0(rootDir, effectiveModel, fallbackModels, sendSSE);

  // ── Phase 1: Deterministic gathering ──
  console.log("[NightShift] ═══ Phase 1: Context Gathering ═══");
  sendSSE("info", { message: "🎖️ EM 啟動，收集專案狀態..." });
  const ctx = await gatherContext(rootDir, since);
  const situationReport = buildSituationReport(ctx);
  console.log(`[NightShift] Phase 1: ${ctx.commitCount} commits, ${ctx.changedFiles.length} files changed, ${ctx.unpushed ? ctx.unpushed.split("\n").length + " unpushed" : "all pushed"}`);
  sendSSE("info", { message: `📊 現況摘要收集完成` });

  if (ctx.unpushed) {
    sendSSE("warning", { message: `⚠️ 發現 ${ctx.unpushed.split("\n").length} 個未 push 的 commit（push 由人決定）` });
  }

  // ── Phase 2: LLM planning ──
  console.log("[NightShift] ═══ Phase 2: LLM Work Planning ═══");
  sendSSE("info", { message: "🧠 規劃工作清單中..." });
  const workList = await planWorkList(situationReport, rootDir, effectiveModel, fallbackModels, sendSSE, opts.projectPhase || 'bootstrap');
  console.log(`[NightShift] Phase 2: EM planned ${workList.length} tasks`);

  return { workList, situationReport };
}

// ── EM Execute only (Phase 3-4): dispatch agents + report ──
export async function executeEMSession(opts = {}) {
  const { rootDir, workList, situationReport = "", baseUrl = `http://127.0.0.1:${process.env.PAAW_PORT || 4097}`, modelOverride, fallbackModels = [], sendSSE = (() => {}) } = opts;

  // ── Read EM config for execution behavior ──
  let emConfig = null;
  try {
    const { readEMConfig } = await import("./em-config.mjs");
    emConfig = readEMConfig(rootDir);
  } catch { /* em-config not available */ }

  // ── Per-agent model resolution ──
  const { resolveAgentModel, resolveAgentFallbacks } = await import("./project-crew.mjs");

  if (!workList || workList.length === 0) {
    sendSSE("info", { message: "✅ 目前沒有需要調度的工作，專案狀態良好。" });
    const report = generateEMReport([], [], situationReport);
    saveNightShiftReport(rootDir, report, "em");
    sendSSE("done", { totalTasks: 0, succeeded: 0, failed: 0, empty: true });
    return { report, workList: [], results: [] };
  }

  // ── Conservative strategy: just show plan, don't execute ──
  if (emConfig?.dispatchStrategy === 'conservative') {
    sendSSE("info", { message: "📋 保守模式：僅顯示計畫，不自動執行。" });
    sendSSE("plan", { workList });
    sendSSE("done", { totalTasks: workList.length, succeeded: 0, failed: 0, skipped: true, reason: 'conservative' });
    const report = generateEMReport(workList, [], situationReport, { skipped: true, format: emConfig?.reporting?.format, includeCodeChanges: emConfig?.reporting?.includeCodeChanges, includeActionLog: emConfig?.reporting?.includeActionLog });
    saveNightShiftReport(rootDir, report, "em");
    return { report, workList, results: [] };
  }

  // ── Filter work list by autoExecute rules ──
  const autoExec = emConfig?.autoExecute || {};
  const safeWorkList = workList.filter(task => {
    // Determine category from task content
    const content = (task.task || '').toLowerCase();
    let category = null;
    if (/breaking|\bbreak\b|remove.*api|deprecat/i.test(content)) category = 'breakingChange';
    else if (/security|vulnerability|cwe-|injection|xss|csrf/i.test(content)) category = 'securityFix';
    else if (/refactor|rename|restructure|move.*to/i.test(content)) category = 'refactor';
    else if (/test|coverage|spec/i.test(content)) category = 'tests';
    else if (/doc|readme|changelog|comment/i.test(content)) category = 'docs';

    if (category && !autoExec[category]) {
      task._skipped = category;
      return false;
    }
    return true;
  });

  const skippedTasks = workList.filter(t => t._skipped);
  if (skippedTasks.length > 0) {
    sendSSE("warning", { message: `⚠️ ${skippedTasks.length} 項工作需人工確認（${[...new Set(skippedTasks.map(t => t._skipped))].join(', ')}）`, skipped: skippedTasks.map(t => ({ agent: t.agent, task: t.task.slice(0, 80), category: t._skipped })) });
  }

  const execList = safeWorkList;
  if (execList.length === 0) {
    sendSSE("info", { message: "📋 所有工作都需人工確認。" });
    sendSSE("plan", { workList });
    sendSSE("done", { totalTasks: 0, succeeded: 0, failed: 0, skipped: true });
    const report = generateEMReport(workList, [], situationReport, { skipped: true, skippedReasons: skippedTasks, format: emConfig?.reporting?.format, includeCodeChanges: emConfig?.reporting?.includeCodeChanges, includeActionLog: emConfig?.reporting?.includeActionLog });
    saveNightShiftReport(rootDir, report, "em");
    return { report, workList, results: [] };
  }

  sendSSE("plan", { workList: execList, skipped: skippedTasks.length > 0 ? skippedTasks : undefined });

  // ── Phase 3: Deterministic execution ──
  console.log(`[NightShift] ═══ Phase 3: Agent Dispatch (serial, ${execList.length}/${workList.length} tasks) ═══`);
  const results = [];
  for (let i = 0; i < execList.length; i++) {
    const task = execList[i];
    // Resolve per-agent EM model (falls back to global modelOverride or EM dispatch model)
    const crewId = task.crewId || `coding.${task.agent}`;
    const dispatchModel = emConfig?.model?.dispatch || modelOverride;
    const agentModel = resolveAgentModel(rootDir, crewId, "em", dispatchModel || "");
    const agentFallbacks = resolveAgentFallbacks(rootDir, crewId, fallbackModels);

    console.log(`[NightShift] Phase 3: [${i + 1}/${execList.length}] → ${task.agent}${agentModel ? ` (model: ${agentModel})` : ""}: ${task.task.slice(0, 80)}...`);
    sendSSE("task_start", { index: i + 1, total: execList.length, ...task });

    const result = await a2aCallAgent(baseUrl, task.agent, task.task, {
      cwd: rootDir,
      timeout: 1800000,
      modelOverride: agentModel || dispatchModel,
      fallbackModels: agentFallbacks,
    });

    results.push({ ...task, ...result });

    if (result.success) {
      console.log(`[NightShift] Phase 3: [${i + 1}/${execList.length}] ✅ ${task.agent} done (${result.content.length} chars)`);
      sendSSE("task_done", { index: i + 1, agent: task.agent, preview: result.content.slice(0, 200) });
    } else {
      console.log(`[NightShift] Phase 3: [${i + 1}/${execList.length}] ❌ ${task.agent} failed: ${result.error}`);
      sendSSE("task_error", { index: i + 1, agent: task.agent, error: result.error });
    }
  }

  // ── Phase 4: Report ──
  console.log("[NightShift] ═══ Phase 4: Report Generation ═══");
  sendSSE("info", { message: "📝 產生報告中..." });
  const reportOpts = {};
  if (emConfig?.reporting) {
    reportOpts.format = emConfig.reporting.format;
    reportOpts.includeCodeChanges = emConfig.reporting.includeCodeChanges;
    reportOpts.includeActionLog = emConfig.reporting.includeActionLog;
  }
  if (skippedTasks.length > 0) {
    reportOpts.skipped = skippedTasks;
  }
  const report = generateEMReport(execList, results, situationReport, reportOpts);
  saveNightShiftReport(rootDir, report, "em");
  console.log(`[NightShift] Phase 4: Report saved (${report.length} chars)`);
  sendSSE("report", { report });

  await addActionLog({
    agent: "em",
    action: "decide",
    summary: `EM session 完成：調度 ${execList.length}/${workList.length} 項工作（${skippedTasks.length} 項需人工確認），成功 ${results.filter(r => r.success).length} 項`,
    details: [...execList.map(w => `${w.priority}/${w.agent}: ${w.task}`), ...skippedTasks.map(w => `⚠️ SKIPPED(${w._skipped})/${w.agent}: ${w.task}`)].join("\n"),
    affectedFiles: [],
    result: "adr",
    priority: "high",
  }, rootDir);

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`[NightShift] 🎖️ EM Session complete: ${succeeded}✅ ${failed}❌ / ${execList.length} executed, ${skippedTasks.length} skipped`);
  sendSSE("done", { totalTasks: execList.length, succeeded, failed, skipped: skippedTasks.length });

  return { report, workList, results };
}


// ── Parallel Mode: Run all agents in parallel ──

export async function runParallelSession(opts = {}) {
  const { rootDir, since, modelOverride, fallbackModels = [], sendSSE = (() => {}) } = opts;
  const { resolve } = await import("path");
  const { fileURLToPath } = await import("url");
  const PAAW_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

  // ── Phase 0 ──
  await runPhase0(rootDir, modelOverride, fallbackModels, sendSSE);

  // ── Phase 1: Gather context ──
  sendSSE("info", { message: "🌙 Night Shift 啟動，收集變更..." });
  const ctx = await gatherContext(rootDir, since);

  if (ctx.changedFiles.length === 0 && !ctx.gitLog) {
    sendSSE("info", { message: "ℹ️ 沒有變更，無需審查。" });
    const report = `# 🌙 Night Shift Report\n\n**Date:** ${new Date().toISOString().slice(0, 10)}\n\nℹ️ No changes today. Nothing to review.`;
    saveNightShiftReport(rootDir, report, "parallel");
    sendSSE("done", { totalTasks: 0, succeeded: 0, failed: 0, empty: true });
    return { report, results: [] };
  }

  sendSSE("info", { message: `📊 ${ctx.changedFiles.length} files changed, ${ctx.commitCount} commits` });

  // ── Phase 2: Load prompts + run all agents in parallel ──
  const { getPromptsFile } = await import("../routes/coding-night-shift-prompts.mjs");
  const prompts = await getPromptsFile(rootDir);
  const { runAgentLoop } = await import("./paaw-agent-loop.mjs");
  const { loadAgentMemory, listActionLog } = await import("./action-log.mjs");
  const { readFileSync } = await import("fs");

  const agentRoles = Object.entries(prompts);
  sendSSE("info", { message: `🚀 啟動 ${agentRoles.length} 個 agent...` });

  // ── Per-agent model resolution ──
  const { resolveAgentModel, resolveAgentFallbacks } = await import("./project-crew.mjs");
  const { readProjectCrew } = await import("./project-crew.mjs");

  // Build dynamic crew labels from project crew
  const { agents: crewAgents } = readProjectCrew(PAAW_ROOT);
  const dynamicCrewLabels = {};
  for (const a of crewAgents) {
    const shortId = a.id.replace(/^(coding\.|custom\.)/, "");
    dynamicCrewLabels[shortId] = `${a.emoji || "🤖"} ${a.codename || shortId}`;
  }

  const effectiveModel = modelOverride || undefined;

  const results = await Promise.allSettled(agentRoles.map(async ([role, config]) => {
    const crewId = config.crewId || `coding.${role}`;
    // Resolve per-agent nightShift model
    const nsModel = resolveAgentModel(rootDir, crewId, "nightShift", effectiveModel || "");
    const nsFallbacks = resolveAgentFallbacks(rootDir, crewId, fallbackModels);

    // Load crew from project layer (overrides global)
    const { loadCrew } = await import("./domain-agent-registry.mjs");
    const crew = await loadCrew(crewId, rootDir);

    const fileList = ctx.changedFiles.map(f => `- ${f}`).join("\n");
    const taskPrompt = (config.task || "")
      .replace(/\{\{gitLog\}\}/g, ctx.gitLog || "(none)")
      .replace(/\{\{changedFiles\}\}/g, fileList)
      .replace(/\{\{featuresSummary\}\}/g, ctx.featuresSummary || "(none)");

    // Load agent memory + action log
    let memoryText = "";
    try { memoryText = await loadAgentMemory(rootDir, config.crewId) || ""; } catch {}
    let actionLogText = "";
    try { actionLogText = (await listActionLog(rootDir, 5)).map(e => `- ${e.agentId}: ${e.action}`).join("\n"); } catch {}

    const systemPrompt = (crew?.rolePrompt || "") +
      (crew?.expertise ? `\n\n## 專業範圍\n${crew.expertise}` : "") +
      (crew?.guardrails?.redirectRules ? `\n\n## 護欄\n### 轉介規則\n${crew.guardrails.redirectRules}` : "") +
      (memoryText ? `\n\n## Your Long-term Memory\n${memoryText}` : "") +
      (actionLogText ? `\n\n## Recent Action Log\n${actionLogText}` : "");

    try {
      const result = await runAgentLoop({
        prompt: taskPrompt,
        cwd: rootDir,
        rootDir: PAAW_ROOT,
        systemPrompt,
        agentId: config.crewId,
        model: nsModel || effectiveModel,
        fallbackModels: nsFallbacks,
        maxTurns: 15,
        timeout: 0, // no timeout — let agent complete task
        onEvent: (event) => {
          if (event.type === "tool_call") {
            console.log(`[NightShift:${role}] tool: ${event.name}`);
          }
        },
      });

      // Read agent's report file if it wrote one
      const reportFile = join(rootDir, ".paaw", "night-shift", `${role}-report.md`);
      let agentReport = "";
      if (existsSync(reportFile)) {
        agentReport = readFileSync(reportFile, "utf-8");
      }

      return {
        role,
        status: "completed",
        codename: crew?.codename || dynamicCrewLabels[role]?.replace(/^[^ ]+ /, "") || role,
        result: typeof result === "string" ? result.slice(-500) : "ok",
        report: agentReport.slice(0, 2000) || (typeof result === "string" ? result.slice(-500) : "done"),
      };
    } catch (err) {
      console.error(`[NightShift:${role}] failed:`, err.message);
      return { role, status: "failed", codename: crew?.codename || role, error: err.message };
    }
  }));

  // ── Phase 3: Generate report ──
  sendSSE("info", { message: "📝 產生報告中..." });
  const agentResults = results.map(r => r.status === "fulfilled" ? r.value : { role: "unknown", status: "failed", error: r.reason?.message });
  console.log(`[NightShift] Phase 2: Results: ${agentResults.filter(r => r.status === "completed").length}✅ ${agentResults.filter(r => r.status === "failed").length}❌`);

  // ── Phase 4: Documentation (Doc Writer → Help Desk review loop) ──
  const docResult = await runDocPhase(rootDir, PAAW_ROOT, modelOverride, fallbackModels, effectiveModel, sendSSE).catch(err => {
    console.error(`[NightShift] Phase 4: Doc phase failed:`, err.message);
    return { summary: `❌ Doc phase failed: ${err.message}`, reviewed: false, iterations: 0 };
  });

  const report = generateParallelReport(agentResults, ctx, dynamicCrewLabels) +
    (docResult.summary ? `\n\n---\n\n## 📝 文檔更新\n\n${docResult.summary}\n` : "");
  saveNightShiftReport(rootDir, report, "parallel");
  console.log(`[NightShift] Phase 3: Report saved (${report.length} chars)`);
  sendSSE("report", { report });

  const succeeded = agentResults.filter(r => r.status === "completed").length;
  const failed = agentResults.filter(r => r.status === "failed").length;
  console.log(`[NightShift] 🌙 Night Shift complete: ${succeeded}✅ ${failed}❌ / ${agentResults.length} total`);
  sendSSE("done", { totalTasks: agentResults.length, succeeded, failed });

  return { report, results: agentResults };
}

// ── Phase 4: Documentation Review Loop (Doc Writer → Help Desk, max 3 rounds) ──
async function runDocPhase(rootDir, paawRoot, modelOverride, fallbackModels, effectiveModel, sendSSE) {
  const { resolve } = await import("path");
  const { getUndocumentedCommits, updateDocCoverage } = await import("./doc-coverage.mjs");
  const { runGit } = await import("../routes/vibe-fs.mjs");
  const { loadCrew } = await import("./domain-agent-registry.mjs");
  const { runAgentLoop } = await import("./paaw-agent-loop.mjs");
  const { resolveAgentModel, resolveAgentFallbacks } = await import("./project-crew.mjs");

  // Check for undocumented commits
  const { commits, lastDocumented, currentHead } = await getUndocumentedCommits(rootDir, runGit);
  if (commits.length === 0) {
    console.log("[NightShift] Phase 4: All commits documented, skipping");
    sendSSE("info", { message: "📝 文檔已是最新，無需更新" });
    return { summary: "✅ 所有 commit 已有對應文件", reviewed: true, iterations: 0 };
  }

  console.log(`[NightShift] Phase 4: ${commits.length} undocumented commits since ${lastDocumented || "start"}`);
  sendSSE("info", { message: `📝 文檔階段啟動：${commits.length} 筆未文件化 commit` });

  // Get full diff for context
  const diffRange = lastDocumented ? `${lastDocumented}..HEAD` : "HEAD~10..HEAD";
  const diffResult = await runGit(["diff", "--stat", diffRange], rootDir);
  const gitLogResult = await runGit(["log", "--oneline", diffRange], rootDir);

  // ── Step 1: Doc Writer writes docs ──
  const docCrew = await loadCrew("coding.doc-writer", rootDir);
  const docModel = resolveAgentModel(rootDir, "coding.doc-writer", "nightShift", effectiveModel || "");
  const docFallbacks = resolveAgentFallbacks(rootDir, "coding.doc-writer", fallbackModels);

  const docTask = `夜班文檔掃描任務

以下是尚未文件化的 commit 清單：

${gitLogResult.stdout}

變更統計：
${diffResult.stdout}

請依照「夜班文檔掃描模式」流程執行：
1. 判斷哪些 commit 需要補文件
2. 寫好文件並 git add
3. 輸出 Doc Update Report

當前 commit 範圍：${lastDocumented || "(首次)"} → ${currentHead}`;

  sendSSE("info", { message: "📝 Doc Writer (Megan) 撰寫文件中..." });
  let docOutput = "";
  try {
    docOutput = await runAgentLoop({
      prompt: docTask,
      cwd: rootDir,
      rootDir: paawRoot,
      systemPrompt: docCrew?.rolePrompt || "",
      agentId: "coding.doc-writer",
      model: docModel || effectiveModel,
      fallbackModels: docFallbacks,
      maxTurns: 15,
      timeout: 0,
    });
    docOutput = typeof docOutput === "string" ? docOutput : JSON.stringify(docOutput);
  } catch (err) {
    console.error(`[NightShift] Phase 4: Doc Writer failed: ${err.message}`);
    return { summary: `❌ Doc Writer 失敗: ${err.message}`, reviewed: false, iterations: 0 };
  }
  console.log(`[NightShift] Phase 4: Doc Writer done (${docOutput.length} chars)`);

  // ── Step 2: Help Desk reviews (max 3 rounds) ──
  const hdCrew = await loadCrew("coding.helpdesk", rootDir);
  const hdModel = resolveAgentModel(rootDir, "coding.helpdesk", "nightShift", effectiveModel || "");
  const hdFallbacks = resolveAgentFallbacks(rootDir, "coding.helpdesk", fallbackModels);

  // Get staged diff for review
  const stagedDiff = await runGit(["diff", "--cached"], rootDir);
  let currentDocOutput = docOutput;
  let reviewRounds = 0;
  const maxRounds = 3;
  let finalVerdict = "";

  while (reviewRounds < maxRounds) {
    reviewRounds++;
    const currentStaged = await runGit(["diff", "--cached"], rootDir);

    const reviewTask = `文件審核任務（第 ${reviewRounds}/${maxRounds} 輪）

以下是 Doc Writer (Megan) 剛 stage 的文件變更：

${currentStaged.stdout.slice(0, 12000) || "(無 staged 變更)"}

Doc Writer 的報告：
${currentDocOutput.slice(0, 2000)}

請依照「文件審核模式」流程審核，輸出 Doc Review Verdict。`;

    sendSSE("info", { message: `🌸 Help Desk (小春) 文件審核中...（第 ${reviewRounds} 輪）` });
    let reviewOutput = "";
    try {
      reviewOutput = await runAgentLoop({
        prompt: reviewTask,
        cwd: rootDir,
        rootDir: paawRoot,
        systemPrompt: hdCrew?.rolePrompt || "",
        agentId: "coding.helpdesk",
        model: hdModel || effectiveModel,
        fallbackModels: hdFallbacks,
        maxTurns: 10,
        timeout: 0,
      });
      reviewOutput = typeof reviewOutput === "string" ? reviewOutput : JSON.stringify(reviewOutput);
    } catch (err) {
      console.error(`[NightShift] Phase 4: Help Desk review failed: ${err.message}`);
      break;
    }
    console.log(`[NightShift] Phase 4: Help Desk review round ${reviewRounds} done`);

    // Check verdict
    const passed = /verdict.*通過|✅.*通過|Verdict.*✅/i.test(reviewOutput) && !/❌|⚠️.*需修改/i.test(reviewOutput.split('\n').slice(0, 5).join(''));
    const needsFix = /⚠️|需修改|反饋|問題/i.test(reviewOutput);

    if (passed || !needsFix) {
      finalVerdict = reviewOutput.slice(0, 500);
      console.log(`[NightShift] Phase 4: ✅ Doc approved (round ${reviewRounds})`);
      sendSSE("info", { message: `✅ 文件審核通過（第 ${reviewRounds} 輪）` });
      break;
    }

    if (reviewRounds < maxRounds) {
      // ── Send feedback to Doc Writer for fixing ──
      sendSSE("info", { message: `📝 Doc Writer 修改文件中...（第 ${reviewRounds + 1} 輪）` });
      const fixTask = `文件審核反饋

Help Desk (小春) 審核了你的文件，以下是反饋：

${reviewOutput}

請根據反饋修改文件，修改後重新 git add，並輸出修正摘要。`;
      try {
        currentDocOutput = await runAgentLoop({
          prompt: fixTask,
          cwd: rootDir,
          rootDir: paawRoot,
          systemPrompt: docCrew?.rolePrompt || "",
          agentId: "coding.doc-writer",
          model: docModel || effectiveModel,
          fallbackModels: docFallbacks,
          maxTurns: 10,
          timeout: 0,
        });
        currentDocOutput = typeof currentDocOutput === "string" ? currentDocOutput : JSON.stringify(currentDocOutput);
      } catch (err) {
        console.error(`[NightShift] Phase 4: Doc Writer fix failed: ${err.message}`);
        break;
      }
    } else {
      finalVerdict = reviewOutput.slice(0, 500);
      console.log(`[NightShift] Phase 4: ⚠️ Max rounds reached, needs manual review`);
      sendSSE("info", { message: `⚠️ 文件審核 ${maxRounds} 輪未通過，需人工確認` });
    }
  }

  // ── Update doc coverage ──
  updateDocCoverage(rootDir, currentHead, commits.map(c => c.split(" ")[0]));

  // ── Build summary ──
  const approved = /✅.*通過|Verdict.*✅/i.test(finalVerdict);
  const summary = `### 📝 文檔更新報告

**掃描範圍：** ${commits.length} 筆 commit${lastDocumented ? `（自 ${lastDocumented.slice(0, 8)}）` : "（首次）"}
**審核結果：** ${approved ? "✅ 審核通過" : "⚠️ 需人工確認"}
**審核輪數：** ${reviewRounds}/${maxRounds}

**Doc Writer 摘要：**
${currentDocOutput.slice(0, 1000)}

**Help Desk 審核：**
${finalVerdict || "(未產生審核結果)"}

${reviewRounds >= maxRounds && !approved ? "⚠️ **此文件變更需要人工審核後再 push。**" : ""}`;

  console.log(`[NightShift] Phase 4: Done (${approved ? "approved" : "manual"}, ${reviewRounds} rounds)`);
  return { summary, reviewed: approved, iterations: reviewRounds };
}

// ── Report Generators ──

function generateEMReport(workList, results, situationReport, opts = {}) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success && !r._skipped).length;
  const skipped = opts.skipped || [];
  const format = opts.format || 'summary';

  let report = `# 🎖️ Engineering Manager 報告\n\n`;
  report += `**日期：** ${dateStr}\n`;
  report += `**時間：** ${now.toTimeString().slice(0, 8)}\n`;
  if (skipped.length > 0) {
    report += `**結果：** ✅ ${succeeded} 成功 / ❌ ${failed} 失敗 / ⏸️ ${skipped.length} 待確認 / ${workList.length} 執行\n`;
  } else {
    report += `**結果：** ✅ ${succeeded} 成功 / ❌ ${failed} 失敗 / ${workList.length} 總計\n`;
  }
  report += `**模式：** EM 智慧調度${opts.skipped ? '（部分工作需人工確認）' : ''}\n\n---\n\n`;

  // Executive format: skip full situation report
  if (format !== 'executive') {
    report += `## 📊 專案現況\n\n${situationReport}\n\n---\n\n`;
  } else {
    // Executive: just a one-line summary
    report += `## 📊 摘要\n\n${workList.length} 項工作，${succeeded} 項成功。\n\n---\n\n`;
  }

  report += `## 📋 工作清單\n\n`;

  for (let i = 0; i < workList.length; i++) {
    const w = workList[i];
    const r = results[i];
    const icon = r?.success ? "✅" : (r?.error ? "❌" : "⏳");
    report += `### ${i + 1}. ${icon} [${w.priority}] ${w.agent} — ${w.task}\n`;
    if (w.reason) report += `> ${w.reason}\n`;
    report += `\n`;
    if (r?.success) {
      // Detailed format includes full output; summary/executive truncates more
      const maxLen = format === 'detailed' ? 3000 : (format === 'executive' ? 200 : 800);
      report += `**結果：**\n\`\`\`\n${r.content.slice(0, maxLen)}\n\`\`\`\n\n`;
    } else if (r?.error) {
      report += `**錯誤：** ${r.error}\n\n`;
    }
  }

  // Skipped tasks section
  if (skipped.length > 0) {
    report += `---\n\n## ⏸️ 需人工確認的工作\n\n`;
    for (const s of skipped) {
      report += `- **[${s._skipped}]** ${s.agent}: ${s.task.slice(0, 120)}\n`;
    }
    report += `\n`;
  }

  report += `---\n\n*由 PAAW Engineering Manager 自動產生*\n`;
  return report;
}

function generateParallelReport(agentResults, ctx, dynamicLabels = null) {
  const now = new Date();

  // Use dynamic labels if provided, otherwise build from results
  const crewLabels = dynamicLabels || {};
  if (Object.keys(crewLabels).length === 0) {
    for (const r of agentResults) {
      if (!crewLabels[r.role]) crewLabels[r.role] = `🤖 ${r.codename || r.role}`;
    }
  }

  const succeeded = agentResults.filter(r => r.status === "completed").length;
  const failed = agentResults.filter(r => r.status === "failed").length;

  let report = `# 🌙 Night Shift Report\n\n`;
  report += `**Date:** ${now.toLocaleDateString("zh-TW")}\n`;
  report += `**Time:** ${now.toTimeString().slice(0, 8)}\n`;
  report += `**Result:** ✅ ${succeeded} 成功 / ❌ ${failed} 失敗 / ${agentResults.length} 總計\n`;
  report += `**Mode:** 全員平行\n\n`;
  report += `**Changes:** ${ctx.changedFiles.length} files, ${ctx.commitCount} commits since ${ctx.since || "today"}\n\n---\n\n`;

  for (const [role, label] of Object.entries(crewLabels)) {
    const agentResult = agentResults.find(r => r.role === role);
    if (!agentResult) {
      report += `### ${label}\n⚠️ Not executed.\n\n---\n\n`;
      continue;
    }
    const icon = agentResult.status === "completed" ? "✅" : agentResult.status === "failed" ? "❌" : "⏭️";
    report += `### ${label} ${icon}\n`;
    if (agentResult.report) {
      report += `${agentResult.report}\n\n`;
    } else if (agentResult.error) {
      report += `Error: ${agentResult.error}\n\n`;
    } else {
      report += `${agentResult.result || "No output"}\n\n`;
    }
    report += `---\n\n`;
  }

  // Git info
  if (ctx.gitLog) {
    report += `## 📋 Commits\n\`\`\`\n${ctx.gitLog}\n\`\`\`\n`;
  }
  if (ctx.changedFiles.length > 0) {
    report += `\n## 📁 Changed Files\n${ctx.changedFiles.map(f => `- \`${f}\``).join("\n")}\n`;
  }
  if (ctx.unpushed) {
    report += `\n## ⚠️ 未 Push 的 Commit\n\`\`\`\n${ctx.unpushed}\n\`\`\`\n\n**Push 由人決定，AI 不自動 push。**\n`;
  }

  return report;
}

// ── Main entry: run session by mode ──

/**
 * @param {object} opts
 * @param {string} opts.mode - "em" | "parallel" (default: "em")
 * @param {string} opts.rootDir - Project root
 * @param {string} opts.baseUrl - A2A base URL (EM mode only)
 * @param {string} opts.since - Since date
 * @param {string} opts.modelOverride - Model override
 * @param {string[]} opts.fallbackModels - Fallback models
 * @param {function} opts.sendSSE - SSE callback
 */
export async function runNightShift(opts = {}) {
  const mode = opts.mode || "em";
  if (mode === "parallel") {
    return runParallelSession(opts);
  }
  // EM mode: plan + execute in sequence
  const { workList, situationReport } = await planEMSession(opts);
  if (!workList.length) {
    opts.sendSSE?.("info", { message: "✅ 沒有需要調度的工作。" });
    const report = generateEMReport([], [], situationReport);
    saveNightShiftReport(opts.rootDir, report, "em");
    opts.sendSSE?.("done", { totalTasks: 0, succeeded: 0, failed: 0, empty: true });
    return { report, workList: [], results: [] };
  }
  return executeEMSession({ ...opts, workList, situationReport });
}
