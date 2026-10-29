/**
 * EM Orchestrator v3 — EM 工頭自決編制（2026-10-01 工頭架構升級）
 *
 * v2（2026-09-05）：EM 決策迴圈 — 每輪一次結構化 LLM 決策（dispatch/complete/escalate）。
 * v3（2026-10-01，memory/em-foreman-design.md 三柱架構）：
 *   柱一 單=檔案=狀態機：每輪派工結果 append 進 task.progressLog；決策只讀 digest；
 *        掛掉下輪從檔案恢復（resumable）— 長時間自主不爆 context 的真正實作。
 *   柱二 開單紀律 + QA 看碼：新 action open_ticket（有單可循）；
 *        developer 完成 → 必排 qa（鐵律，程式強制）；QA prompt 自動帶 git commit
 *        diff 範圍（程式抓證據，非 agent 自述）；
 *        bug 單迴圈保險絲：同 task 第 3 張 bug 單 → 停手升級人類；
 *        治本規則：同 patternTag 第二張 bug 單 → 程式自動開 parent 單（refactor/回歸測試）。
 *
 * 保底不變：決策 LLM 連續失敗 2 次 → deterministic chain（v1 行為）跑完，不讓 task 卡死。
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

import {
  appendProgress,
  buildTaskDigest,
  hydrateFromProgress,
  bugFuseVerdict,
  rootCauseVerdict,
  createTicket,
  loadTasksFile,
  saveTasksFile,
  completionGate,
  taskNeedsTests,
} from "./em-task-store.mjs";
import { shellExec } from "./shell-exec.mjs";
import { takeDispatchSnapshot } from "./dispatch-verifier.mjs";

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
    if (type === "dev") chain.push("qa", "tester"); // 雙門檻保底：qa 看碼 + tester 鞏固
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

// ── 柱二：QA 證據（程式抓 git commit diff 範圍，非 agent 自述）──

async function _git(rootDir, args) {
  try {
    const r = await shellExec(`git ${args}`, { cwd: rootDir });
    return `${r.stdout || ""}${r.stderr || ""}`;
  } catch { return ""; }
}

/** preHead..HEAD 的證據（commits + diff stat，容量有上限 — 進 prompt 用） */
async function _gitEvidence(rootDir, preHead) {
  if (!preHead || !/^[0-9a-f]{7,40}$/i.test(preHead)) return null;
  const cur = (await _git(rootDir, "rev-parse HEAD")).trim();
  if (!cur || cur === preHead) return null;
  const logLines = (await _git(rootDir, `log --oneline -n 20 ${preHead}..${cur}`)).split("\n").filter(Boolean).slice(0, 20);
  const stat = (await _git(rootDir, `diff --stat ${preHead}..${cur}`)).split("\n").filter(Boolean).join("\n").slice(0, 2000);
  return { short: `${preHead.slice(0, 7)}..${cur.slice(0, 7)}`, log: logLines, stat };
}

function _evidenceBlock(range) {
  if (!range) return "";
  return `

## 程式證據（deterministic — 程式抓的 git 範圍，不是 developer 自述）
本次 developer 派工的 commit 範圍：${range.short}
commits：
${(range.log || []).join("\n") || "(無新 commit — 看 working diff)"}

diff stat：
${range.stat || "(空)"}

請以這個範圍的 diff 為審查對象，不要只看 developer 的自我報告。`;
}

function _forcedQAInstruction(task, range) {
  return `QA 回歸驗收（EM 鐵律強制 — developer 完成後未經 QA 看碼不得結案）
Task：${task.id} ${task.title || ""}
${(task.description || "").slice(0, 1200)}
${_evidenceBlock(range)}

請：
1. 對照 task 驗收標準逐項檢查上述 diff
2. 檢查明顯 bug（邏輯錯誤、邊界、路徑處理、錯誤處理）
3. 輸出格式：一行 verdict — 「✅ 通過」或「❌ 未過」，❌ 時列問題清單（每項：檔案/位置/嚴重度/復現方式/建議修法）`;
}

function _forcedTestInstruction(task, range) {
  return `測試鞏固（EM 鐵律強制 — dev 型任務寫好的程式必須用 UT + E2E 鞏固才能結案）
Task：${task.id} ${task.title || ""}
${(task.description || "").slice(0, 1200)}
${_evidenceBlock(range)}

請把這次完成的程式用測試鞏固起來：
1. 先跑專案既有測試套件（如 vitest）— 確認現況全綠，紀錄失敗項
2. 為本次新增/變更的功能補單元測試（UT）：覆蓋驗收標準的每個行為，含邊界與錯誤路徑
3. 補 E2E/整合測試：按專案既有的 e2e 慣例驗證完整使用流程（若專案無 e2e 框架，寫可直接用 node 跑的整合腳本並註明）
4. 全部測試跑過全綠
5. 輸出格式：一行 verdict — 「✅ 鞏固完成」或「❌ 未過」，接著列測試檔清單（每項：檔案/覆蓋行為/UT或E2E）與最終通過率；發現 bug 不要自己修，列出來（檔案/位置/復現方式），交回 developer 修`;
}

import { dateTimeContextBlock } from "./llm-utils.mjs";

function _controllerSystemPrompt() {
  return `${dateTimeContextBlock()}
你是 EM（Engineering Manager）工頭，指揮一組 agent 完成一張 task。你看不到 agent 的完整對話，只看得到任務檔 digest（每輪派工結果的結構化摘要）— 這是你的決策證據。所有工作有單可循。

## 每輪只輸出一個 JSON 決策（四選一）

派工：
{"action":"dispatch","agent":"<AGENT ROSTER 內的短 id>","instruction":"<給該 agent 的自包含指令>","reason":"<一句話理由>"}
開單（發現沒單的工作：bug、後續補強、QA 發現的問題）：
{"action":"open_ticket","title":"<單標題>","description":"<目標+context，自包含>","acceptance":"<可執行的驗收標準>","type":"dev|test|docs|bug","priority":"high|medium|low","patternTag":"<bug 類別短標籤，bug 單必填，例如 path-handling>","affectedFiles":["<相關檔案路徑>"],"reason":"<為什麼開這張單>"}
驗收通過：
{"action":"complete","summary":"<這張 task 的完成摘要：做了什麼、由誰做的、驗收依據>"}
升級給人：
{"action":"escalate","reason":"<卡在哪/為什麼需要人類>"}

## 編制原則
- instruction 必須自包含：agent 看不到你的對話，也看不到其他 agent 的輸出 — 該帶的 context（task 描述、前人結果要點、檔案線索）要寫進 instruction
- spec 是開單時的建議，不是硬性編制 — 你看 task 性質決定真正需要誰、什麼順序、要不要多輪
- 順序派工：一次一個 agent loop，等結果回來再決定下一步
- 同一個 agent 可以重派（帶新指令/反饋）；review 打回就帶著具體問題重派 developer
- 看成果辦事：digest 說完成不代表完成 — 對照 task 目標判斷；證據不足就再派一個驗證
- developer 連續失敗 2 次 → escalate，不要無限重試
- 需要人類決策（刪資料、破壞性變更、外部服務帳密、方向不明）→ escalate

## 驗收雙門檻鐵律（程式強制）
developer 成功後，兩關都過才能 complete（缺哪關程式就攔下你並強制補派）：
1. **qa 看碼回歸** — 派 qa 對照驗收標準審 diff；程式自動附上 developer 派工的 git commit diff 範圍，QA 看的是碼不是 developer 自述
2. **tester 鞏固（dev 型任務）** — 派 tester 把寫好的程式用 UT + E2E 鞏固起來：跑既有套件、補單元測試、補 E2E/整合測試、全綠。不是只有開發 and qa — 沒測試鞏固的完成不算完成
- 你直接 complete 的話，程式會依序強制派 qa → tester
- tester 發現 bug → 跟 QA 打回一樣：open_ticket(type:"bug") 帶復現方式 → 派 developer 修 → 修完重跑 qa + tester

## Bug 單迴圈
- QA 審查發現問題（❌ 未過）→ open_ticket(type:"bug", patternTag 填 bug 類別) 帶 QA 證據（復現方式+位置）→ 派 developer 修這張 bug 單 → 修完再派 qa 回歸
- 保險絲（程式強制）：同一張 task 開到第 3 張 bug 單 → 自動停手升級人類（問題通常在更深層）
- 治本（程式自動）：同 patternTag 第二張 bug 單 → 程式自動開治本 parent 單（refactor/回歸測試）— 你專心修 bug，治本單之後派工處理

## 驗收標準
- task 核心目標達成，且雙門檻已過（qa 看碼 ✓ + dev 型任務 tester UT/E2E 鞏固 ✓）→ complete（程式會自動結案本次 orchestration 開的 bug 單）
- 無法再推進 → escalate（寫清楚卡在哪、已試過什麼）`;
}

function _roundUserPrompt(task, rosterText, digest) {
  const spec = task.spec || {};
  const specText = Object.keys(spec).length
    ? `tests=${!!spec.tests} docs=${!!spec.docs} review=${!!spec.review}（開單建議，可調整）`
    : "(無 spec — 編制完全由你判斷)";
  const prog = digest.progress?.length
    ? digest.progress.join("\n")
    : "(尚無派工紀錄)";
  const bugLine = digest.bugTicketsOpened > 0
    ? `\n已開 bug 單：${digest.bugTicketsOpened} 張${Object.keys(digest.bugPatterns).length ? `（pattern: ${Object.entries(digest.bugPatterns).map(([k, v]) => `${k}×${v}`).join(", ")}）` : ""} — 保險絲上限 3 張`
    : "";
  const rangeLine = digest.lastDevRange ? `\ndeveloper 最新 diff 範圍：${digest.lastDevRange.short}（派 qa/tester 時程式自動附證據）` : "";
  const gate = digest.gate ? `\n完成門檻（程式強制）：qa 看碼 ${digest.gate.needQA ? "❌ 未過" : "✅"} / tester UT+E2E 鞏固 ${digest.gate.needTests ? "❌ 未過" : "✅ 或不需"}` : "";
  return `## TASK
id: ${task.id}
title: ${task.title || "(無標題)"}
type: ${task.type || "dev"}
spec: ${specText}

描述：
${task.description || "(無描述)"}

## AGENT ROSTER（可派工的 agent）
${rosterText}

## 進度 digest（來自任務檔 progress log — 唯一事實來源；掛掉重跑也從這裡恢復）
${prog}${bugLine}${rangeLine}${gate}

## 你的決策（一個 JSON）`;
}

/**
 * EM 自決編制協調一張 task（v3：progress log 狀態機 + open_ticket + QA 鐵律 + bug 保險絲）
 * @returns {ok, status: "done"|"blocked"|"max_loops"|"stopped", chain: string[], loopCount, results, decidedBy, tokenUsage, summary?, escalateReason?, openedTickets?}
 */
export async function orchestrateTask({ rootDir, task, baseUrl, modelOverride, fallbackModels = [], sendSSE = (() => {}), maxLoops = 30, decisionOverride, _deps = {} }) {
  const a2aCallAgent = _deps.a2aCallAgent || (await import("./auto-dispatch-manager.mjs")).a2aCallAgent;
  const { resolveAgentModel, resolveAgentFallbacks, getDispatchableAgents } = await import("./project-crew.mjs");
  const { resolveLLMConfig } = await import("./paaw-agent-loop.mjs");
  const { callLLMWithRetry } = await import("./llm-utils.mjs");

  const taskId = task.id;

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
  // 2026-09-30 fix：caller 沒帶 fallbacks 時用預設鏈（user.json *Fallback / providers.json fallbacks）
  let _fbm = (fallbackModels || []).filter(Boolean);
  if (_fbm.length === 0) {
    try { _fbm = resolveLLMConfig(rootDir).fallbacks.map(f => `${f.providerId}/${f.model}`); } catch {}
  }
  const fallbackCfgs = _fbm.map(m => resolveLLMConfig(rootDir, m));

  const { addActionLog } = await import("./action-log.mjs");
  const _log = (msg) => console.log(`[EM-Orch] [${taskId}] ${msg}`);
  const _act = (entry) => { addActionLog(entry, rootDir).catch(() => {}); };
  const _t0 = Date.now();

  // ── 柱一：resumable — 從任務檔 progressLog 重建狀態（上輪掛掉 → 這輪從檔案恢復）──
  const task0 = readTask(rootDir, taskId) || task; // 重新讀檔（progressLog 可能已被上輪寫入）
  const hydrated = hydrateFromProgress(task0);
  const resumed = hydrated.history.length > 0;

  const history = [...hydrated.history];  // [{round, agent, outcome}]
  const results = {};                     // agent → 最後一次結果
  const agents = { ...hydrated.agents };  // shortId → status
  const runs = { ...hydrated.runs };      // shortId → 次數
  const chain = [];
  const tokenUsage = { prompt: 0, completion: 0, total: 0 };
  const openedTickets = [];               // 本次 orchestration 開的單（complete 時結案 bug 單）
  const ORCH_LABEL = `em-orch:${taskId}`; // 治單標籤 — 結案時用（跨輪恢復也找得到）
  let loopCount = 0;
  let decisionFails = 0;
  // 柱二狀態（live 更新，也是 force/fuse 判定來源）
  const state = {
    bugCount: hydrated.bugCount,
    patternTags: new Map(hydrated.patternTags),
    devNeedsQA: hydrated.devNeedsQA,
    devNeedsTests: hydrated.devNeedsTests,
    lastDevRange: hydrated.lastDevRange,
  };

  const _addTokens = (u) => {
    if (!u || typeof u !== "object") return;
    tokenUsage.prompt += u.prompt_tokens || u.prompt || 0;
    tokenUsage.completion += u.completion_tokens || u.completion || 0;
    tokenUsage.total += u.total_tokens || u.total || 0;
  };

  updateTaskOrchestration(rootDir, taskId, { decidedBy: "em", agents, runs, loopCount, status: "running", startedAt: new Date().toISOString() }, `🎖️ EM 開始自決編制協調（roster: ${roster.map(r => r.id).join(", ")}）${resumed ? `— 🔁 從 progress log 恢復（已有 ${hydrated.history.length} 輪紀錄）` : ""}`);
  _log(`🎖️ EM 自決編制開始：「${task.title || taskId}」（roster ${roster.length} agents，max ${maxLoops} 輪）${resumed ? `🔁 resume（${hydrated.history.length} 輪）` : ""}`);

  while (loopCount < maxLoops) {
    if (loopCount > 0 && _stopRequested(rootDir)) {
      updateTaskOrchestration(rootDir, taskId, { status: "stopped", loopCount }, "⏹️ 使用者中斷 — EM 協調停止");
      return { ok: false, status: "stopped", chain, loopCount, results, decidedBy: "em", tokenUsage, openedTickets };
    }
    loopCount++;

    // ── 決策 prompt：digest（柱一 — 不讀整段對話）──
    const digest = buildTaskDigest(readTask(rootDir, taskId) || task, { maxLines: 40 });
    // 完成門檻現況（供 EM 決策與人類除錯）
    digest.gate = { needQA: state.devNeedsQA, needTests: taskNeedsTests(task0) && state.devNeedsTests };

    // ── EM 決策（每輪一次結構化 call；decisionOverride 供測試注入）──
    let decision = null;
    if (typeof decisionOverride === "function") {
      try { decision = await decisionOverride({ round: loopCount, digest, state }); } catch {}
    } else {
      try {
        const body = {
          model: llm.model || llm.defaultModel,
          messages: [
            { role: "system", content: _controllerSystemPrompt() },
            { role: "user", content: _roundUserPrompt(task0, rosterText, digest) },
          ],
          temperature: 0,
        };
        const res = await callLLMWithRetry(llm.apiUrl, llm.headers, body, {
          maxRetries: 2, timeoutMs: 300_000, agentId: "em-orchestrator", disableThinking: true, fallbacks: fallbackCfgs,
        });
        _addTokens(res?.usage);
        decision = _extractDecision(res?.content);
      } catch {}
    }
    if (!decision || typeof decision.action !== "string") {
      decisionFails++;
      if (decisionFails >= 2) {
        sendSSE("info", { message: `⚠️ [${taskId}] EM 決策 LLM 連續失敗 — 降級 deterministic chain 保底` });
        return await _fallbackChain({ rootDir, task, baseUrl, modelOverride, fallbackModels, sendSSE, history, results, agents, runs, chain, loopCount, tokenUsage, a2aCallAgent, resolveAgentModel, resolveAgentFallbacks });
      }
      continue; // 重試決策
    }
    decisionFails = 0;

    // ── 柱二：bug 保險絲（程式強制 — 第 3 張 bug 單前攔下）──
    if (decision.action === "open_ticket" && String(decision.type || "").toLowerCase() === "bug") {
      const fuse = bugFuseVerdict(state);
      if (fuse.fuse) {
        const evidence = digest.progress.slice(-8).join("\n");
        const reason = `${fuse.reason}\n\n證據鏈（最後 8 輪）：\n${evidence}`;
        appendProgress(rootDir, taskId, { round: loopCount, agent: "em", action: "bug_fuse", outcome: `🧯 保險絲燒斷：第 ${state.bugCount + 1} 次打回達上限 — 升級人類` });
        updateTaskOrchestration(rootDir, taskId, { agents, runs, status: "blocked", loopCount, escalateReason: reason }, `🧯 Bug 保險絲：第 ${state.bugCount + 1} 次打回 — 停手升級人類`);
        _log(`🧯 Bug 保險絲燒斷（第 ${state.bugCount + 1} 次打回）— 升級人類`);
        _act({ agent: "em", action: "escalate", summary: `[${taskId}] bug 保險絲燒斷（第 ${state.bugCount + 1} 次打回）`, details: reason, affectedFiles: [], result: "blocked", priority: "high" });
        sendSSE("task_error", { index: 0, agent: "em", subtaskId: taskId, error: `bug-fuse: ${reason.slice(0, 200)}` });
        return { ok: false, status: "blocked", chain, loopCount, results, decidedBy: "em", tokenUsage, escalateReason: reason, openedTickets };
      }
    }

    // ── 柱二：驗收雙門檻鐵律（程式強制 — developer 成功後 qa 看碼 + tester UT/E2E 鞏固，兩關都過才能 complete）──
    if (decision.action === "complete") {
      const gate = completionGate(state, task0);
      if (gate.blocked) {
        let forced = gate.forcedAgent;
        if (forced === "qa" && !rosterIds.has("qa")) forced = rosterIds.has("tester") ? "tester" : null;
        if (forced === "tester" && !rosterIds.has("tester")) forced = rosterIds.has("qa") ? "qa" : null;
        if (forced) {
          const instruction = forced === "qa"
            ? _forcedQAInstruction(task0, state.lastDevRange)
            : _forcedTestInstruction(task0, state.lastDevRange);
          decision = { action: "dispatch", agent: forced, instruction, reason: gate.reason, _evidenceAttached: true };
          appendProgress(rootDir, taskId, { round: loopCount, agent: "em", action: forced === "qa" ? "force_qa" : "force_test", outcome: `🔒 ${gate.reason} — 程式強制 dispatch ${forced}` });
          _log(`🔒 R${loopCount} 鐵律強制：complete 被攔下 → dispatch ${forced}（${gate.needQA ? "qa 未過" : "tester 未過"}${gate.needQA && gate.needTests ? "+tester 未過" : ""}）`);
          sendSSE("info", { message: `🔒 [${taskId}] 鐵律：${gate.forcedAgent === "qa" ? "developer 完成必排 QA 看碼" : "dev 完成必排 tester 鞏固"} — 強制派 ${forced}` });
          // 落到下方 dispatch 處理（不 return）
        }
      }
    }

    // ── 執行決策 ──
    if (decision.action === "complete") {
      const summary = String(decision.summary || "task 完成").slice(0, 600);
      // 程式結案：本次 orchestration 開的 bug 單（有 ORCH_LABEL 標籤且仍 open）→ close
      const closedBugs = _closeOrchestratedBugTickets(rootDir, taskId, ORCH_LABEL, summary);
      appendProgress(rootDir, taskId, { round: loopCount, agent: "em", action: "complete", outcome: `🏁 完成：${summary.slice(0, 200)}${closedBugs ? `（結案 ${closedBugs} 張 bug 單）` : ""}` });
      updateTaskOrchestration(rootDir, taskId, { agents, runs, status: "done", loopCount }, `🏁 Task 完成（${loopCount - 1} 次派工）：${summary}`);
      _log(`🏁 驗收完成（${chain.length} 次派工：${chain.join("→")}，${((Date.now() - _t0) / 1000).toFixed(0)}s）：${summary.slice(0, 200)}${closedBugs ? `；結案 ${closedBugs} 張 bug 單` : ""}`);
      _act({ agent: "em", action: "decide", summary: `[${taskId}] 驗收完成（${chain.join("→")}）`, details: summary, affectedFiles: [], result: "ok", priority: "high" });
      sendSSE("task_done", { index: 0, agent: "em", subtaskId: taskId, preview: `🏁 ${taskId} 完成（${chain.length} 派工）：${summary.slice(0, 180)}` });
      return { ok: true, status: "done", chain, loopCount, results, decidedBy: "em", tokenUsage, summary, openedTickets };
    }
    if (decision.action === "escalate") {
      const reason = String(decision.reason || "需要人類介入").slice(0, 400);
      appendProgress(rootDir, taskId, { round: loopCount, agent: "em", action: "escalate", outcome: `🚨 升級給人：${reason.slice(0, 200)}` });
      updateTaskOrchestration(rootDir, taskId, { agents, runs, status: "blocked", loopCount, escalateReason: reason }, `🚨 升級給人：${reason}`);
      _log(`🚨 升級給人：${reason}`);
      _act({ agent: "em", action: "escalate", summary: `[${taskId}] 升級給人（${chain.length} 次派工後）`, details: reason, affectedFiles: [], result: "blocked", priority: "high" });
      sendSSE("task_error", { index: 0, agent: "em", subtaskId: taskId, error: `escalate: ${reason}` });
      return { ok: false, status: "blocked", chain, loopCount, results, decidedBy: "em", tokenUsage, escalateReason: reason, openedTickets };
    }
    if (decision.action === "open_ticket") {
      const title = String(decision.title || "").trim();
      const desc = String(decision.description || "").trim();
      const type = String(decision.type || "dev").toLowerCase();
      const isBug = type === "bug";
      if (!title || !desc) {
        history.push({ round: loopCount, agent: "em", outcome: `⚠️ open_ticket 無效（title/description 空）— 重新決策` });
        continue;
      }
      const created = createTicket(rootDir, {
        title: isBug ? `[bug] ${title}` : title,
        description: desc,
        acceptance: String(decision.acceptance || "").trim() || "照 description 目標驗收；bug 單：修復後 QA 回歸通過",
        type: isBug ? "dev" : type,
        priority: decision.priority || (isBug ? "high" : "medium"),
        parentId: taskId,
        affectedFiles: decision.affectedFiles || [],
        labels: [ORCH_LABEL, ...(isBug ? ["bug"] : []), ...(decision.patternTag ? [`pattern:${decision.patternTag}`] : [])],
        createdBy: "em",
        source: "em-foreman",
        note: `EM orchestration 開單（${taskId} R${loopCount}）：${String(decision.reason || "").slice(0, 200)}`,
      });
      if (!created.ok) {
        history.push({ round: loopCount, agent: "em", outcome: `⚠️ open_ticket 失敗：${created.error}` });
        continue;
      }
      const t = created.task;
      openedTickets.push(t.id);
      if (isBug) {
        state.bugCount++;
        const tag = String(decision.patternTag || "general").slice(0, 40);
        state.patternTags.set(tag, (state.patternTags.get(tag) || 0) + 1);
        // 治本規則（程式自動）：同 patternTag 第二張 bug 單 → 自動開 parent 單
        const rc = rootCauseVerdict(state);
        if (rc.needsParent) {
          const rcTicket = createTicket(rootDir, {
            title: `[治本] ${rc.pattern} 重複出現 — refactor + 回歸測試`,
            description: `同類 bug（pattern: ${rc.pattern}）在 ${taskId} 的 orchestration 中重複出現 ${state.patternTags.get(rc.pattern)} 次。\n請分析根源並治本：重構問題模式 + 補回歸測試防止再發。相關 bug 單：${openedTickets.filter(id => id).join(", ")}（見 TASKS.json notes/labels）`,
            acceptance: "1) 根源分析寫入 notes 2) refactor 完成 3) 回歸測試覆蓋該 pattern 且全過",
            type: "dev",
            priority: "high",
            parentId: taskId,
            labels: [ORCH_LABEL, "root-cause", `pattern:${rc.pattern}`],
            createdBy: "em",
            source: "em-foreman-root-cause",
            note: `🧬 治本規則自動開單：pattern ${rc.pattern} × ${state.patternTags.get(rc.pattern)}`,
          });
          if (rcTicket.ok) {
            openedTickets.push(rcTicket.task.id);
            appendProgress(rootDir, taskId, { round: loopCount, agent: "em", action: "open_ticket", ticketId: rcTicket.task.id, ticketType: "root-cause", patternTag: rc.pattern, outcome: `🧬 治本單自動開立：${rcTicket.task.id}（pattern ${rc.pattern} × ${state.patternTags.get(rc.pattern)}）` });
            _log(`🧬 R${loopCount} 治本規則：pattern "${rc.pattern}" 重複 → 自動開 parent 單 ${rcTicket.task.id}`);
            sendSSE("info", { message: `🧬 [${taskId}] 同類 bug 重複（${rc.pattern}）— 自動開治本單 ${rcTicket.task.id}` });
          }
        }
      }
      appendProgress(rootDir, taskId, { round: loopCount, agent: "em", action: "open_ticket", ticketId: t.id, ticketType: isBug ? "bug" : type, patternTag: isBug ? String(decision.patternTag || "general").slice(0, 40) : undefined, outcome: `🎫 開單 ${t.id}${isBug ? "（bug）" : ""}：${title.slice(0, 120)}${isBug ? ` — 保險絲 ${state.bugCount}/2` : ""}` });
      history.push({ round: loopCount, agent: "em", outcome: `🎫 開單 ${t.id}${isBug ? "（bug）" : ""}：${title.slice(0, 120)}` });
      updateTaskOrchestration(rootDir, taskId, { agents, runs, loopCount, openedTickets: openedTickets.length }, `🎫 R${loopCount} 開單 ${t.id}${isBug ? "（bug 單）" : ""}：${title.slice(0, 140)}`);
      _act({ agent: "em", action: "open_ticket", summary: `[${taskId}] R${loopCount} 開單 ${t.id}${isBug ? "（bug）" : ""}`, details: `${title}\n${desc.slice(0, 400)}`, affectedFiles: decision.affectedFiles || [], result: "ok", priority: isBug ? "high" : "medium" });
      sendSSE("info", { message: `🎫 [${taskId}] EM 開單 ${t.id}${isBug ? `（bug，第 ${state.bugCount} 次打回，上限 2）` : ""}：${title.slice(0, 100)}` });
      continue;
    }
    if (decision.action === "dispatch") {
      const agent = _shortAgentId(decision.agent || "");
      const instruction = String(decision.instruction || "").trim();
      if (!rosterIds.has(agent) || !instruction) {
        history.push({ round: loopCount, agent: agent || "(invalid)", outcome: `⚠️ 決策無效（agent 不在 roster 或 instruction 空）— 重新決策` });
        continue;
      }

      // 柱二：QA 看碼 — 派 qa/tester 自動帶 developer 的 git 證據（強制 QA 指令已内建則不重複）
      const isVerifier = agent === "qa" || agent === "tester";
      const isDev = agent === "developer";
      const evidence = isVerifier && !decision._evidenceAttached ? _evidenceBlock(state.lastDevRange) : "";

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

      const prompt = `${instruction}${evidence}\n\n（Task ${taskId}：${task0.title || ""}。完整描述：${(task0.description || "").slice(0, 2000)}。可先讀 .paaw/tasks/TASKS.json 中 ${taskId} 的 notes/progressLog 看前人執行紀錄。）`;
      const _loopStart = Date.now();
      // 柱二：developer 派工前 git 快照（QA 證據鏈起點）
      const snap = isDev ? await takeDispatchSnapshot(rootDir) : null;
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
        // 柱一：progress log 落檔（含 devRange 證據 — resumable 的載體）
        if (isDev) {
          state.devNeedsQA = true;
          state.devNeedsTests = true;
          state.lastDevRange = await _gitEvidence(rootDir, snap?.preHead) || { short: "(無新 commit — working diff)", log: [], stat: "" };
          appendProgress(rootDir, taskId, { round: loopCount, agent, action: "dispatch", outcome: `✅ ${brief || "(空回報)"}`, durationMs: _loopDur, tokens: _loopTokens, devRange: state.lastDevRange });
        } else {
          if (agent === "qa") state.devNeedsQA = false;           // qa 過 → 看碼門檻解除
          if (agent === "tester") state.devNeedsTests = false;     // tester 過 → 鞏固門檻解除
          appendProgress(rootDir, taskId, { round: loopCount, agent, action: "dispatch", outcome: `✅ ${brief || "(空回報)"}`, durationMs: _loopDur, tokens: _loopTokens });
        }
        history.push({ round: loopCount, agent, outcome: `✅ ${brief || "(空回報)"}` });
        updateTaskOrchestration(rootDir, taskId, { agents: { ...agents } }, `✅ R${loopCount} ${agent} 完成${isDev ? "（待 QA 回歸）" : ""}：${brief.slice(0, 160)}`);
        sendSSE("task_done", { index: chain.length, agent, subtaskId: taskId, preview: brief.slice(0, 200), durationMs: result.durationMs || 0 });
      } else {
        const failCount = runs[agent];
        agents[agent] = failCount >= 2 ? "blocked" : "failed";
        appendProgress(rootDir, taskId, { round: loopCount, agent, action: "dispatch", outcome: `❌ 失敗（第 ${failCount} 次）：${String(result.error || "unknown").slice(0, 200)}`, durationMs: _loopDur, tokens: _loopTokens });
        history.push({ round: loopCount, agent, outcome: `❌ 失敗（第 ${failCount} 次）：${String(result.error || "unknown").slice(0, 200)}` });
        updateTaskOrchestration(rootDir, taskId, { agents: { ...agents } }, `❌ R${loopCount} ${agent} 失敗（第 ${failCount} 次）：${String(result.error || "unknown").slice(0, 160)}`);
        sendSSE("task_error", { index: chain.length, agent, subtaskId: taskId, error: result.error || "unknown" });
      }
      continue;
    }

    // 未知 action → 記一筆重決策
    history.push({ round: loopCount, agent: "-", outcome: `⚠️ 未知 action "${decision.action}" — 重新決策` });
  }

  appendProgress(rootDir, taskId, { round: loopCount, agent: "em", action: "max_loops", outcome: `⚠️ 超過 ${maxLoops} 輪上限` });
  updateTaskOrchestration(rootDir, taskId, { agents, runs, status: "max_loops", loopCount }, `⚠️ 超過 ${maxLoops} 輪上限，需人工介入。`);
  sendSSE("warning", { message: `⚠️ [${taskId}] 超過 ${maxLoops} 輪上限，需人工介入。` });
  return { ok: false, status: "max_loops", chain, loopCount, results, decidedBy: "em", tokenUsage, openedTickets };
}

// ── 程式結案：orchestration 開的 bug 單（label em-orch:<taskId> 且 open）→ close ──
function _closeOrchestratedBugTickets(rootDir, taskId, label, summary) {
  try {
    const { data, tasks } = loadTasksFile(rootDir);
    const now = new Date().toISOString();
    let closed = 0;
    for (const t of tasks) {
      if (t.status === "open" && Array.isArray(t.labels) && t.labels.includes(label)) {
        t.status = "close";
        t.resolvedAt = now;
        t.updatedAt = now;
        (t.notes ||= []).push({ by: "em", at: now, content: `✅ parent task ${taskId} 驗收完成 — bug 單連帶結案。${summary ? `（${summary.slice(0, 150)}）` : ""}` });
        closed++;
      }
    }
    if (closed > 0) saveTasksFile(rootDir, data, tasks);
    return closed;
  } catch { return 0; }
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
    appendProgress(rootDir, taskId, { round: chain.length, agent, action: "dispatch", outcome: `${result.success ? "✅（保底鏈）" : "❌（保底鏈）"} ${String(result.content || result.error || "").slice(0, 200)}` });
    updateTaskOrchestration(rootDir, taskId, { agents: { ...agents } }, result.success ? `✅（保底鏈）${agent} 完成` : `❌（保底鏈）${agent} 失敗：${result.error || "?"}`);
    if (result.success) sendSSE("task_done", { index: chain.length, agent, subtaskId: taskId, preview: String(result.content || "").slice(0, 200) });
    else sendSSE("task_error", { index: chain.length, agent, subtaskId: taskId, error: result.error || "unknown" });
    if (!result.success) return { ok: false, status: "blocked", chain, loopCount, results, decidedBy: "fallback-chain", tokenUsage, openedTickets: [] };
  }
  appendProgress(rootDir, taskId, { round: chain.length, agent: "em", action: "complete", outcome: `🏁（保底鏈）Task 完成：${seq.join(" → ")}` });
  updateTaskOrchestration(rootDir, taskId, { status: "done" }, `🏁（保底鏈）Task 完成：${seq.join(" → ")}`);
  return { ok: true, status: "done", chain, loopCount, results, decidedBy: "fallback-chain", tokenUsage, openedTickets: [] };
}
