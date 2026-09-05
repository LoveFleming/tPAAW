/**
 * EM Orchestrator v2 — EM 大總管自決編制（2026-09-05 21:17 Fleming 定調）
 *
 * 「以一個 release unit 開的 task 展開工作；開幾個 agent loop 由 EM 看 task 自己決定；
 *   每個 agent loop 順序做；EM 大總管一次順序完成多個 tasks」
 *
 * v1（2026-09-02）是寫死鏈：buildAgentChain(spec) 勾了什麼跑什麼 + regex 判打回。
 * v2：EM 決策迴圈 — 每輪一次結構化 LLM 決策（dispatch/complete/escalate），
 *     派工結果成為下一輪決策的證據。agent 鏈、輪數、打回重派全部 EM 自己判斷。
 *
 * 架構（同 CU feature-map v2.1 的原則 — 工作拆單元，不累積大 context）：
 *   task（一張 RU task）
 *     → EM 決策迴圈（每輪只看：task + roster + 各 agent 結果摘要）
 *       → dispatch = 一個完整 agent loop（a2aCallAgent：多輪 + tool call）
 *     → complete / escalate 收斂
 *   保底：決策 LLM 連續失敗 2 次 → deterministic chain（v1 行為）跑完，不讓 task 卡死
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ── v1 deterministic chain（保底用）──
export function buildAgentChain(spec = {}, type = "dev") {
  const chain = [];
  chain.push("developer");
  if (spec.tests) chain.push("tester");
  if (spec.review) chain.push("qa");
  if (spec.docs) chain.push("doc-writer");
  if (chain.length === 1) {
    if (type === "test") chain.push("tester");
    if (type === "docs") chain.push("doc-writer");
  }
  return chain;
}

// 讀單一 task
export function readTask(rootDir, taskId) {
  const tasksFile = join(rootDir, ".paaw", "tasks", "TASKS.json");
  if (!existsSync(tasksFile)) return null;
  const data = JSON.parse(readFileSync(tasksFile, "utf-8"));
  const tasks = Array.isArray(data) ? data : (data.tasks || []);
  return tasks.find(t => String(t.id).toLowerCase() === String(taskId).toLowerCase()) || null;
}

// 寫回 task 狀態（orchestration + notes 一筆）
export function updateTaskOrchestration(rootDir, taskId, patch, note) {
  const tasksFile = join(rootDir, ".paaw", "tasks", "TASKS.json");
  if (!existsSync(tasksFile)) return false;
  const data = JSON.parse(readFileSync(tasksFile, "utf-8"));
  const isArray = Array.isArray(data);
  const tasks = isArray ? data : (data.tasks || []);
  const idx = tasks.findIndex(t => String(t.id).toLowerCase() === String(taskId).toLowerCase());
  if (idx < 0) return false;
  const now = new Date().toISOString();
  const cur = tasks[idx].orchestration || {};
  tasks[idx].orchestration = { ...cur, ...patch, updatedAt: now };
  (tasks[idx].notes ||= []).push({ at: now, agent: "em", note: note || "" });
  writeFileSync(tasksFile, JSON.stringify(isArray ? tasks : { ...data, tasks }, null, 2));
  return true;
}

function _stopRequested(rootDir) {
  try {
    const st = JSON.parse(readFileSync(join(rootDir, ".paaw", "auto-dispatch", "status.json"), "utf-8"));
    return st.stopRequested === true && st.status === "running";
  } catch { return false; }
}

function _shortAgentId(id) { return String(id).replace(/^(coding\.|custom\.)/, ""); }

// 從 EM 決策回覆抽 JSON（fence 優先，退而求其次第一個 {...}）
function _extractDecision(text) {
  let t = String(text || "").trim();
  if (!t) return null;
  const fences = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1].trim());
  for (const c of [...fences.reverse(), t]) {
    try { return JSON.parse(c); } catch {}
    const m = c.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
  }
  return null;
}

function _controllerSystemPrompt() {
  return `你是 EM（Engineering Manager）大總管，指揮一組 agent 完成一張 task。你看不到 agent 的完整對話，只看得到他們的結果摘要 — 這是你的決策證據。

## 每輪只輸出一個 JSON 決策（三選一）

派工：
{"action":"dispatch","agent":"<AGENT ROSTER 內的短 id>","instruction":"<給該 agent 的具體指令>","reason":"<一句話理由>"}
驗收通過：
{"action":"complete","summary":"<這張 task 的完成摘要：做了什麼、由誰做的、驗收依據>"}
升級給人：
{"action":"escalate","reason":"<卡在哪/為什麼需要人類>"}

## 編制原則
- instruction 必須自包含：agent 看不到你的對話，也看不到其他 agent 的輸出 — 該帶的 context（task 描述、前人結果要點、檔案線索）要寫進 instruction
- spec 是開單時的建議，不是硬性編制 — 你看 task 性質決定真正需要誰、什麼順序、要不要多輪
- 順序派工：一次一個 agent loop，等結果回來再決定下一步
- 同一個 agent 可以重派（帶新指令/反饋）；review 打回就帶著具體問題重派 developer
- 看成果辦事：摘要說完成不代表完成 — 對照 task 目標判斷；證據不足就再派一個驗證（例如 qa/tester）
- developer 連續失敗 2 次 → escalate，不要無限重試
- 需要人類決策（刪資料、破壞性變更、外部服務帳密、方向不明）→ escalate

## 驗收標準
- task 核心目標達成，且最後派工結果支持這個結論 → complete
- 無法再推進 → escalate（寫清楚卡在哪、已試過什麼）`;
}

function _roundUserPrompt(task, rosterText, history) {
  const spec = task.spec || {};
  const specText = Object.keys(spec).length
    ? `tests=${!!spec.tests} docs=${!!spec.docs} review=${!!spec.review}（開單建議，可調整）`
    : "(無 spec — 編制完全由你判斷)";
  const hist = history.length
    ? "\n## 進度（你的派工歷史）\n" + history.map(h => `R${h.round} dispatch ${h.agent} → ${h.outcome}`).join("\n")
    : "";
  return `## TASK
id: ${task.id}
title: ${task.title || "(無標題)"}
type: ${task.type || "dev"}
spec: ${specText}

描述：
${task.description || "(無描述)"}

## AGENT ROSTER（可派工的 agent）
${rosterText}
${hist}

## 你的決策（一個 JSON）`;
}

/**
 * EM 自決編制協調一張 task
 * @returns {ok, status: "done"|"blocked"|"max_loops"|"stopped", chain: string[], loopCount, results, decidedBy}
 */
export async function orchestrateTask({ rootDir, task, baseUrl, modelOverride, fallbackModels = [], sendSSE = (() => {}), maxLoops = 30 }) {
  const { a2aCallAgent } = await import("./auto-dispatch-manager.mjs");
  const { resolveAgentModel, resolveAgentFallbacks, getDispatchableAgents } = await import("./project-crew.mjs");
  const { resolveLLMConfig } = await import("./paaw-agent-loop.mjs");
  const { callLLMWithRetry } = await import("./llm-utils.mjs");

  const taskId = task.id;
  const spec = task.spec || {};

  // ── Roster ──
  let roster = [];
  try { roster = getDispatchableAgents(rootDir).map(a => ({ id: _shortAgentId(a.id), expertise: a.expertise || a.title || "" })); } catch {}
  if (!roster.length) roster = [
    { id: "developer", expertise: "寫碼實作" }, { id: "tester", expertise: "測試" },
    { id: "qa", expertise: "code review" }, { id: "doc-writer", expertise: "文件" },
    { id: "architect", expertise: "架構評估" },
  ];
  const rosterText = roster.map(a => `- ${a.id} — ${a.expertise}`).join("\n");
  const rosterIds = new Set(roster.map(a => a.id));

  // ── 決策模型設定 ──
  const llm = resolveLLMConfig(rootDir, modelOverride);
  const fallbackCfgs = (fallbackModels || []).filter(Boolean).map(m => resolveLLMConfig(rootDir, m));

  // 2026-09-05 Fleming：console + action log 都要清楚看到每個 agent loop 的開始與結束
  const { addActionLog } = await import("./action-log.mjs");
  const _log = (msg) => console.log(`[EM-Orch] [${taskId}] ${msg}`);
  const _act = (entry) => { addActionLog(entry, rootDir).catch(() => {}); };
  const _t0 = Date.now();

  updateTaskOrchestration(rootDir, taskId, { decidedBy: "em", agents: {}, runs: {}, loopCount: 0, status: "running", startedAt: new Date().toISOString() }, `🎖️ EM 開始自決編制協調（roster: ${roster.map(r => r.id).join(", ")}）`);
  _log(`🎖️ EM 自決編制開始：「${task.title || taskId}」（roster ${roster.length} agents，max ${maxLoops} 輪）`);

  const history = [];         // [{round, agent, outcome}]
  const results = {};         // agent → 最後一次結果
  const agents = {};          // shortId → status（"done"|"running"|"blocked"）
  const runs = {};            // shortId → 次數
  const chain = [];           // 實際派工序列
  const tokenUsage = { prompt: 0, completion: 0, total: 0 };
  let loopCount = 0;
  let decisionFails = 0;

  const _addTokens = (u) => {
    if (!u || typeof u !== "object") return;
    tokenUsage.prompt += u.prompt_tokens || u.prompt || 0;
    tokenUsage.completion += u.completion_tokens || u.completion || 0;
    tokenUsage.total += u.total_tokens || u.total || 0;
  };

  while (loopCount < maxLoops) {
    if (loopCount > 0 && _stopRequested(rootDir)) {
      updateTaskOrchestration(rootDir, taskId, { status: "stopped", loopCount }, "⏹️ 使用者中斷 — EM 協調停止");
      return { ok: false, status: "stopped", chain, loopCount, results, decidedBy: "em", tokenUsage };
    }
    loopCount++;

    // ── EM 決策（每輪一次結構化 call）──
    let decision = null;
    try {
      const body = {
        model: llm.model || llm.defaultModel,
        messages: [
          { role: "system", content: _controllerSystemPrompt() },
          { role: "user", content: _roundUserPrompt(task, rosterText, history) },
        ],
        temperature: 0,
      };
      const res = await callLLMWithRetry(llm.apiUrl, llm.headers, body, {
        maxRetries: 2, timeoutMs: 300_000, agentId: "em-orchestrator", disableThinking: true, fallbacks: fallbackCfgs,
      });
      _addTokens(res?.usage);
      decision = _extractDecision(res?.content);
      if (!decision || typeof decision.action !== "string") decision = null;
    } catch {}
    if (!decision) {
      decisionFails++;
      if (decisionFails >= 2) {
        // 保底：deterministic chain（v1 行為）跑完，不讓 task 卡死
        sendSSE("info", { message: `⚠️ [${taskId}] EM 決策 LLM 連續失敗 — 降級 deterministic chain 保底` });
        return await _fallbackChain({ rootDir, task, baseUrl, modelOverride, fallbackModels, sendSSE, history, results, agents, runs, chain, loopCount, tokenUsage, a2aCallAgent, resolveAgentModel, resolveAgentFallbacks });
      }
      continue; // 重試決策
    }
    decisionFails = 0;

    // ── 執行決策 ──
    if (decision.action === "complete") {
      const summary = String(decision.summary || "task 完成").slice(0, 600);
      updateTaskOrchestration(rootDir, taskId, { agents, runs, status: "done", loopCount }, `🏁 Task 完成（${loopCount - 1} 次派工）：${summary}`);
      _log(`🏁 驗收完成（${chain.length} 次派工：${chain.join("→")}，${((Date.now() - _t0) / 1000).toFixed(0)}s）：${summary.slice(0, 200)}`);
      _act({ agent: "em", action: "decide", summary: `[${taskId}] 驗收完成（${chain.join("→")}）`, details: summary, affectedFiles: [], result: "ok", priority: "high" });
      sendSSE("task_done", { index: 0, agent: "em", subtaskId: taskId, preview: `🏁 ${taskId} 完成（${chain.length} 派工）：${summary.slice(0, 180)}` });
      return { ok: true, status: "done", chain, loopCount, results, decidedBy: "em", tokenUsage, summary };
    }
    if (decision.action === "escalate") {
      const reason = String(decision.reason || "需要人類介入").slice(0, 400);
      updateTaskOrchestration(rootDir, taskId, { agents, runs, status: "blocked", loopCount, escalateReason: reason }, `🚨 升級給人：${reason}`);
      _log(`🚨 升級給人：${reason}`);
      _act({ agent: "em", action: "escalate", summary: `[${taskId}] 升級給人（${chain.length} 次派工後）`, details: reason, affectedFiles: [], result: "blocked", priority: "high" });
      sendSSE("task_error", { index: 0, agent: "em", subtaskId: taskId, error: `escalate: ${reason}` });
      return { ok: false, status: "blocked", chain, loopCount, results, decidedBy: "em", tokenUsage, escalateReason: reason };
    }
    if (decision.action === "dispatch") {
      const agent = _shortAgentId(decision.agent || "");
      const instruction = String(decision.instruction || "").trim();
      if (!rosterIds.has(agent) || !instruction) {
        history.push({ round: loopCount, agent: agent || "(invalid)", outcome: `⚠️ 決策無效（agent 不在 roster 或 instruction 空）— 重新決策` });
        continue;
      }

      // 派工 = 一個完整 agent loop（多輪 + tool call）
      const crewId = `coding.${agent}`;
      const agentModel = resolveAgentModel(rootDir, crewId, "em", modelOverride || "");
      const agentFallbacks = resolveAgentFallbacks(rootDir, crewId, fallbackModels);
      _log(`🎖️ R${loopCount} 決策：dispatch ${agent}#${(runs[agent] || 0) + 1} — ${String(decision.reason || "").slice(0, 120)}`);
      chain.push(agent);
      runs[agent] = (runs[agent] || 0) + 1;
      agents[agent] = "running";
      updateTaskOrchestration(rootDir, taskId, { agents: { ...agents }, runs: { ...runs }, currentStep: agent, loopCount }, `▶️ R${loopCount} 派工 ${agent}#${runs[agent]}：${String(decision.reason || instruction).slice(0, 160)}`);
      sendSSE("task_start", { index: chain.length, total: chain.length, agent, subtaskId: taskId, task: `${taskId} (R${loopCount} ${agent}#${runs[agent]})` });

      const prompt = `${instruction}\n\n（Task ${taskId}：${task.title || ""}。完整描述：${(task.description || "").slice(0, 2000)}。可先讀 .paaw/tasks/TASKS.json 中 ${taskId} 的 notes 看前人執行紀錄。）`;
      const _loopStart = Date.now();
      _log(`▶️ R${loopCount} ${agent} agent loop 開始（#${runs[agent]}，model: ${agentModel || modelOverride || "default"}）`);
      let result;
      try {
        result = await a2aCallAgent(baseUrl, agent, prompt, {
          cwd: rootDir, timeout: 7200000, modelOverride: agentModel || modelOverride, fallbackModels: agentFallbacks,
        });
      } catch (e) {
        result = { success: false, content: "", error: e.message };
      }
      const _loopDur = Date.now() - _loopStart;
      const _loopTokens = (result?.usage?.total_tokens || result?.usage?.total || 0);
      _log(`${result.success ? "✅" : "❌"} R${loopCount} ${agent} agent loop 結束（${(_loopDur / 1000).toFixed(0)}s, ${_loopTokens} tokens, 輸出 ${String(result.content || "").length} 字${result.success ? "" : `，錯誤：${String(result.error || "?").slice(0, 120)}`}）`);
      _act({ agent: "em", action: "dispatch", summary: `[${taskId}] R${loopCount} 派工 ${agent}#${runs[agent]} — ${result.success ? "✅" : "❌"} ${(_loopDur / 1000).toFixed(0)}s`, details: `指令：${instruction.slice(0, 500)}\n\n結果：${String(result.content || result.error || "").slice(0, 600)}`, affectedFiles: [], result: result.success ? "ok" : "fail", priority: "medium" });
      result.durationMs = _loopDur;
      _addTokens(result?.usage || result?.tokenUsage);
      results[agent] = { success: !!result.success, content: String(result.content || "").slice(0, 4000), error: result.error || null, round: loopCount };

      if (result.success) {
        agents[agent] = "done";
        const brief = String(result.content || "").replace(/\s+/g, " ").slice(0, 300);
        history.push({ round: loopCount, agent, outcome: `✅ ${brief || "(空回報)"}` });
        updateTaskOrchestration(rootDir, taskId, { agents: { ...agents } }, `✅ R${loopCount} ${agent} 完成：${brief.slice(0, 160)}`);
        sendSSE("task_done", { index: chain.length, agent, subtaskId: taskId, preview: brief.slice(0, 200), durationMs: result.durationMs || 0 });
      } else {
        const failCount = runs[agent];
        agents[agent] = failCount >= 2 ? "blocked" : "failed";
        history.push({ round: loopCount, agent, outcome: `❌ 失敗（第 ${failCount} 次）：${String(result.error || "unknown").slice(0, 200)}` });
        updateTaskOrchestration(rootDir, taskId, { agents: { ...agents } }, `❌ R${loopCount} ${agent} 失敗（第 ${failCount} 次）：${String(result.error || "unknown").slice(0, 160)}`);
        sendSSE("task_error", { index: chain.length, agent, subtaskId: taskId, error: result.error || "unknown" });
      }
      continue;
    }

    // 未知 action → 記一筆重決策
    history.push({ round: loopCount, agent: "-", outcome: `⚠️ 未知 action "${decision.action}" — 重新決策` });
  }

  updateTaskOrchestration(rootDir, taskId, { agents, runs, status: "max_loops", loopCount }, `⚠️ 超過 ${maxLoops} 輪上限，需人工介入。`);
  sendSSE("warning", { message: `⚠️ [${taskId}] 超過 ${maxLoops} 輪上限，需人工介入。` });
  return { ok: false, status: "max_loops", chain, loopCount, results, decidedBy: "em", tokenUsage };
}

// ── 保底：deterministic chain（v1 行為）— 決策 LLM 掛掉時不讓 task 卡死 ──
async function _fallbackChain({ rootDir, task, baseUrl, modelOverride, fallbackModels, sendSSE, history, results, agents, runs, chain, loopCount, tokenUsage, a2aCallAgent, resolveAgentModel, resolveAgentFallbacks }) {
  const { resolveLLMConfig } = await import("./paaw-agent-loop.mjs");
  const { callLLMWithRetry } = await import("./llm-utils.mjs");
  void resolveLLMConfig; void callLLMWithRetry; // 決策不用了 — 純序列派工
  const spec = task.spec || {};
  const taskId = task.id;
  const seq = buildAgentChain(spec, task.type);
  for (const agent of seq) {
    chain.push(agent);
    runs[agent] = (runs[agent] || 0) + 1;
    const crewId = `coding.${agent}`;
    const agentModel = resolveAgentModel(rootDir, crewId, "em", modelOverride || "");
    const agentFallbacks = resolveAgentFallbacks(rootDir, crewId, fallbackModels);
    updateTaskOrchestration(rootDir, taskId, { currentStep: agent, agents: { ...agents, [agent]: "running" }, runs: { ...runs }, decidedBy: "fallback-chain" }, `▶️（保底鏈）派工 ${agent}`);
    sendSSE("task_start", { index: chain.length, total: chain.length, agent, subtaskId: taskId, task: `${taskId} (fallback ${agent})` });
    const roleHint = {
      developer: "你是 developer：實作這個 task。",
      tester: "你是 tester：為這個 task 的實作補測試並跑過。",
      qa: "你是 qa：code review 這個 task 的實作，明確寫「通過」或「需修改：...」。",
      "doc-writer": "你是 doc-writer：為這個 task 補文件。",
    }[agent] || "";
    const prompt = `${roleHint}\n\n執行 ${taskId}（${task.title || "無標題"}）。\n描述：\n${task.description || ""}`;
    let result;
    try { result = await a2aCallAgent(baseUrl, agent, prompt, { cwd: rootDir, timeout: 7200000, modelOverride: agentModel || modelOverride, fallbackModels: agentFallbacks }); }
    catch (e) { result = { success: false, content: "", error: e.message }; }
    if (result.usage || result.tokenUsage) {
      const u = result.usage || result.tokenUsage;
      tokenUsage.prompt += u.prompt_tokens || u.prompt || 0;
      tokenUsage.completion += u.completion_tokens || u.completion || 0;
      tokenUsage.total += u.total_tokens || u.total || 0;
    }
    results[agent] = { success: !!result.success, content: String(result.content || "").slice(0, 4000), error: result.error || null, round: chain.length };
    agents[agent] = result.success ? "done" : "blocked";
    updateTaskOrchestration(rootDir, taskId, { agents: { ...agents } }, result.success ? `✅（保底鏈）${agent} 完成` : `❌（保底鏈）${agent} 失敗：${result.error || "?"}`);
    if (result.success) sendSSE("task_done", { index: chain.length, agent, subtaskId: taskId, preview: String(result.content || "").slice(0, 200) });
    else sendSSE("task_error", { index: chain.length, agent, subtaskId: taskId, error: result.error || "unknown" });
    if (!result.success) return { ok: false, status: "blocked", chain, loopCount, results, decidedBy: "fallback-chain", tokenUsage };
  }
  updateTaskOrchestration(rootDir, taskId, { status: "done" }, `🏁（保底鏈）Task 完成：${seq.join(" → ")}`);
  return { ok: true, status: "done", chain, loopCount, results, decidedBy: "fallback-chain", tokenUsage };
}
