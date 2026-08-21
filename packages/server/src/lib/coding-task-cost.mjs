/**
 * coding-task-cost.mjs — Coding task 成本寫回（R3）
 *
 * EM / auto-dispatch 執行完 coding task 後，把 tokenUsage + costUsd
 * 累加寫回 {projectRoot}/.paaw/tasks/TASKS.json 的對應 task：
 *   task.tokenUsage  { prompt, completion, total }  ← 累加
 *   task.costUsd     number                          ← 累加
 *   task.costLog[]   { at, model, tokens, costUsd, source } ← 附錄（上限 50 筆）
 *
 * 讀-改-寫每次重讀檔案（與 route 的 saveTasks 競爭視窗最小化）。
 * 找不到 task 或檔案不存在 → 靜默 no-op（cost 歸集是 best-effort，不該炸主流程）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COST_LOG_LIMIT = 50;

/**
 * @param {string} projectRoot — 專案 root（TASKS.json 所在）
 * @param {string} taskRef — task id（TASK-XXX）或含 TASK-XXX 的標題
 * @param {{prompt:number, completion:number, total:number}} tokens
 * @param {number} costUsd
 * @param {string|null} model
 * @param {string} source — 呼叫來源標籤（em / parallel / manual …）
 * @returns {boolean} 是否成功寫入
 */
export function addCostAttribution(projectRoot, taskRef, tokens, costUsd, model = null, source = "em") {
  try {
    const m = String(taskRef || "").match(/\bTASK-([0-9]{1,4})\b/i);
    if (!m) return false;
    const ref = `TASK-${String(m[1]).padStart(3, "0")}`;

    const file = join(projectRoot, ".paaw", "tasks", "TASKS.json");
    if (!existsSync(file)) return false;
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    const isWrapped = Array.isArray(raw?.tasks);
    const arr = isWrapped ? raw.tasks : raw;
    if (!Array.isArray(arr)) return false;

    const t = arr.find(x => x && x.id === ref);
    if (!t) return false;

    const p = Number(tokens?.prompt) || 0;
    const c = Number(tokens?.completion) || 0;
    const tot = Number(tokens?.total) || (p + c);
    if (p === 0 && c === 0 && !Number.isFinite(Number(costUsd))) return false;

    if (!t.tokenUsage) t.tokenUsage = { prompt: 0, completion: 0, total: 0 };
    t.tokenUsage.prompt += p;
    t.tokenUsage.completion += c;
    t.tokenUsage.total += tot;
    t.costUsd = round6((Number(t.costUsd) || 0) + (Number(costUsd) || 0));
    if (!Array.isArray(t.costLog)) t.costLog = [];
    t.costLog.push({
      at: new Date().toISOString(),
      model: model || null,
      tokens: { prompt: p, completion: c, total: tot },
      costUsd: round6(Number(costUsd) || 0),
      source,
    });
    if (t.costLog.length > COST_LOG_LIMIT) t.costLog.splice(0, t.costLog.length - COST_LOG_LIMIT);

    writeFileSync(file, JSON.stringify(isWrapped ? { ...raw, tasks: arr } : arr, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

function round6(n) { return Math.round((n || 0) * 1e6) / 1e6; }
