/**
 * coding-db repos — dual-write（Phase A）+ 查詢入口
 * 全部 best-effort：db 掛了不能擋原檔案路徑（Phase B 切讀後才以 db 為準）
 */
import { openCodingDb } from "./connection.mjs";
import { saveTasks } from "./tasks.repo.mjs";
import { saveFeatures } from "./features.repo.mjs";
import {
  appendDispatchRecord, appendActionRecord, appendQaResult, appendExecApproval,
  saveConversation, archiveConversation, setKv, setGates, setHandover, saveIssue, saveReleaseRequest,
} from "./stores.repo.mjs";

export {
  appendDispatchRecord, appendActionRecord, appendQaResult, appendExecApproval,
  saveConversation, archiveConversation, deleteConversationSession,
  setKv, setGates, setHandover, saveIssue, saveReleaseRequest,
} from "./stores.repo.mjs";
export { saveTasks } from "./tasks.repo.mjs";
export { saveFeatures } from "./features.repo.mjs";
export { openCodingDb } from "./connection.mjs";

// Phase B 讀取函式
export {
  readFeatures, readTasks, readActionLog,
  readConversationAgents, readConversationSessions, readConversation,
} from "./reads.mjs";

/** list 查詢範例：某 RU 最近 dispatch */
export function recentDispatch(ruRoot, { limit = 50, taskId } = {}) {
  const db = openCodingDb(ruRoot);
  if (taskId) return db.prepare("SELECT * FROM dispatch_log WHERE task_id=? ORDER BY id DESC LIMIT ?").all(taskId, limit);
  return db.prepare("SELECT * FROM dispatch_log ORDER BY id DESC LIMIT ?").all(limit);
}

export function taskHistory(ruRoot, taskId) {
  const db = openCodingDb(ruRoot);
  return {
    task: db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId),
    notes: db.prepare("SELECT * FROM task_notes WHERE task_id=? ORDER BY id").all(taskId),
    dispatch: db.prepare("SELECT * FROM dispatch_log WHERE task_id=? ORDER BY id").all(taskId),
    qa: db.prepare("SELECT * FROM qa_results WHERE task_id=? ORDER BY id").all(taskId),
  };
}
