/**
 * EM Orchestrator — 一張 task 的多 agent 多輪協調引擎
 *
 * 2026-09-02 Fleming 定調：coding app 最重要功能 —
 *   EM 協調不同 agent 把一張 task 做完，開發→測試→review→文件 來回多輪。
 *
 * 來源：
 *   - task 由 SA 自然語言開單（task tool），開單時勾 spec（要不要測試/文件/review）
 *   - EM 走 API 撈 open task → 讀 spec → 決定派誰、順序 → 多輪協調
 *   - 每輪派一個 agent（A2A）→ 收結果 → 寫回 task 狀態看板
 *   - review 打回 → 重跑 developer → 再測 → 再 review（loop）
 *   - 上限 30 輪（不限制把工作做好，但設安全上限）
 *
 * 狀態寫回 task：
 *   task.orchestration = {
 *     agents: { developer: "done", tester: "pending", qa: "pending", "doc-writer": "pending" },
 *     loopCount: 3,
 *     currentStep: "qa",
 *     startedAt, updatedAt, status: "running" | "done" | "blocked" | "max_loops"
 *   }
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// 依 spec 決定 agent 執行鏈（順序）
export function buildAgentChain(spec = {}, type = "dev") {
  const chain = [];
  // 實作永遠第一（developer）
  chain.push("developer");
  if (spec.tests) chain.push("tester");
  if (spec.review) chain.push("qa");
  if (spec.docs) chain.push("doc-writer");
  // 純 test/docs 型 task 沒勾 spec → 依 type 補
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
  const t = tasks[idx];
  t.orchestration = { ...(t.orchestration || {}), ...patch, updatedAt: now };
  if (note) {
    if (!Array.isArray(t.notes)) t.notes = [];
    t.notes.push({ by: "em", at: now, content: note });
  }
  t.updatedAt = now;
  if (isArray) {
    writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), "utf-8");
  } else {
    writeFileSync(tasksFile, JSON.stringify({ ...data, tasks, updatedAt: now }, null, 2), "utf-8");
  }
  return true;
}

/**
 * 協調一張 task：依 spec 依序派 agent，多輪直到完成。
 * @returns {{ ok: boolean, status: string, chain: string[], loopCount: number, results: object }}
 */
export async function orchestrateTask({ rootDir, task, baseUrl, modelOverride, fallbackModels = [], sendSSE = (() => {}), maxLoops = 30 }) {
  const { a2aCallAgent } = await import("./auto-dispatch-manager.mjs");
  const { resolveAgentModel, resolveAgentFallbacks } = await import("./project-crew.mjs");

  const spec = task.spec || {};
  const chain = buildAgentChain(spec, task.type);
  const taskId = task.id;

  // 初始化 orchestration 狀態
  const agents = {};
  for (const a of chain) agents[a] = "pending";
  updateTaskOrchestration(rootDir, taskId, { agents, loopCount: 0, currentStep: chain[0], status: "running", chain, startedAt: new Date().toISOString() }, `🚀 EM 開始協調：agent 鏈 ${chain.join(" → ")}`);

  const results = {};
  let loopCount = 0;
  let status = "running";

  // 依 spec 決定「通過」標準
  const needReview = !!spec.review;
  const needTests = !!spec.tests;
  const needDocs = !!spec.docs;

  // 執行鏈：從頭跑，被打回就重頭（developer 修 → 再測 → 再 review）
  while (loopCount < maxLoops) {
    loopCount++;
    let advanced = false;

    for (const agent of chain) {
      const crewId = `coding.${agent}`;
      const agentModel = resolveAgentModel(rootDir, crewId, "em", modelOverride || "");
      const agentFallbacks = resolveAgentFallbacks(rootDir, crewId, fallbackModels);

      // 若這 agent 這輪已 done（例如 review 通過後不用重跑 developer 之前的），跳過
      if (agents[agent] === "done") continue;

      // 派工中：送結構化 task_start — EM Chat 顯示「▶️ developer 開始執行」
      sendSSE("task_start", { index: chain.indexOf(agent) + 1, total: chain.length, agent, subtaskId: taskId, task: `${taskId} (loop ${loopCount})` });
      updateTaskOrchestration(rootDir, taskId, { currentStep: agent, loopCount, agents: { ...agents, [agent]: "running" } });

      // 依 agent 角色給不同 prompt（帶 task context + spec）
      const prompt = buildAgentPrompt(task, agent, spec, loopCount);
      const result = await a2aCallAgent(baseUrl, agent, prompt, {
        cwd: rootDir,
        timeout: 7200000, // 2h per agent
        modelOverride: agentModel,
        fallbackModels: agentFallbacks,
      });

      results[agent] = { success: result.success, content: (result.content || "").slice(0, 4000), error: result.error || null, loopCount };

      if (result.success) {
        agents[agent] = "done";
        updateTaskOrchestration(rootDir, taskId, { agents: { ...agents } }, `✅ ${agent} 完成（loop ${loopCount}）`);
        sendSSE("task_done", { index: chain.indexOf(agent) + 1, agent, subtaskId: taskId, preview: (result.content || "").slice(0, 200), durationMs: result.durationMs || 0 });
        advanced = true;
      } else {
        // agent 失敗 → blocked，升級給人
        agents[agent] = "blocked";
        updateTaskOrchestration(rootDir, taskId, { agents: { ...agents }, status: "blocked", currentStep: agent }, `🚨 ${agent} 失敗：${result.error || "unknown"}。已標 blocked，等人介入。`);
        status = "blocked";
        sendSSE("task_error", { index: chain.indexOf(agent) + 1, agent, subtaskId: taskId, error: result.error || "unknown" });
        return { ok: false, status, chain, loopCount, results };
      }
    }

    // 一輪跑完：若 review 有打回（qa 回傳需要修改），重跑 developer
    if (needReview && results.qa && results.qa.success) {
      const qaOutput = results.qa.content || "";
      const needsFix = /需修改|打回|❌|reject|需要調整|問題|fix|修改/i.test(qaOutput);
      if (needsFix) {
        // 打回 → developer 重跑，qa/tester 重置
        sendSSE("info", { message: `🔄 [${taskId}] QA 打回，重跑 developer 修（loop ${loopCount}）` });
        updateTaskOrchestration(rootDir, taskId, { loopCount }, `🔄 QA 打回：${qaOutput.slice(0, 200)}。重跑 developer 修。`);
        agents.developer = "pending";
        if (agents.tester) agents.tester = "pending";
        agents.qa = "pending";
        continue; // 重跑一輪
      }
    }

    // 全部 agent done → 完成
    const allDone = chain.every(a => agents[a] === "done");
    if (allDone) {
      status = "done";
      updateTaskOrchestration(rootDir, taskId, { agents, status: "done", loopCount }, `🏁 Task 完成（${loopCount} 輪）：${chain.join(" → ")} 全部 done`);
      sendSSE("task_done", { index: 0, agent: "em", subtaskId: taskId, preview: `🏁 ${taskId} 協調完成（${loopCount} 輪）：${chain.join(" → ")} 全部 done` });
      return { ok: true, status, chain, loopCount, results };
    }

    // 沒打回也全 done → 完成（防呆）
    if (!advanced) break;
  }

  // 超過 maxLoops
  status = "max_loops";
  updateTaskOrchestration(rootDir, taskId, { agents, status: "max_loops", loopCount }, `⚠️ 超過 ${maxLoops} 輪上限，需人工介入。`);
  sendSSE("warning", { message: `⚠️ [${taskId}] 超過 ${maxLoops} 輪上限，需人工介入。` });
  return { ok: false, status, chain, loopCount, results };
}

// 依 agent 角色組 prompt（帶 task context + spec）
function buildAgentPrompt(task, agent, spec, loopCount) {
  const base = `執行 ${task.id}（${task.title || "無標題"}）。\n\nTask 描述：\n${task.description || "(無描述)"}\n\nSpec（SA 勾選）：\ntests=${!!spec.tests} docs=${!!spec.docs} review=${!!spec.review}\n\n請先讀 .paaw/tasks/TASKS.json 中 ${task.id} 的 notes 看前人的執行紀錄，再開始。`;
  const roleHint = {
    developer: "你是 developer：實作這個 task。若這是被打回重修的輪次，請先看 notes 裡 QA 的反饋，針對性地修，不要重做。修完自我驗收。",
    tester: "你是 tester：為這個 task 的實作補測試。跑測試，確保通過。",
    qa: "你是 qa：code review 這個 task 的實作。若發現問題，明確列出「需修改：...」清單（會打回 developer 修）。若沒問題，明確寫「通過」。",
    "doc-writer": "你是 doc-writer：為這個 task 補文件（README/API/ADR/changelog）。",
  }[agent] || "";
  return `${roleHint}\n\n${base}`;
}