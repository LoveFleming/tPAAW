/**
 * dispatch-verifier.mjs — Dispatch deterministic 驗收（2026-09-20 Fleming）
 *
 * 背景：EM 派工假成功 — agent 宣稱完成但零 commit 零 diff（大檔任務 turn
 * 用盡，收尾硬報成功）。對策：LLM 只推理、事實靠程式 — 派工收尾時用 git
 * 證據驗收，不信 agent 嘴。
 *
 * 三條派工路徑共用：
 *   1. routes/coding.mjs — POST /api/coding-crew/dispatch（HTTP SSE）
 *   2. lib/auto-dispatch-manager.mjs — executeEMSession（EM task-driven）
 *   3. tools/index.mjs — dispatch_agent handler（EM chat 工具）
 *
 * 用法：
 *   const snap = await takeDispatchSnapshot(projRoot);
 *   ...run agent...
 *   const verdict = await verifyDispatchWork(projRoot, snap);
 *   if (!verdict.pass) { ...retry once with retrySuffix()... }
 */

import { shellExec } from "./shell-exec.mjs";

async function _gitOut(cwd, args) {
  try {
    const r = await shellExec(`git ${args}`, { cwd });
    return `${r.stdout || ""}${r.stderr || ""}`;
  } catch { return ""; }
}

/** 派工前快照（目前只記 HEAD；未來可擴 staged hash） */
export async function takeDispatchSnapshot(projRoot) {
  const preHead = (await _gitOut(projRoot, "rev-parse HEAD")).trim();
  return { preHead, at: Date.now() };
}

// runtime 自動寫檔噪音（chat/session/memory/log/config）不算工作證據；
// .paaw/specs、.paaw/tasks 等 agent 真產出不排除（architect 寫 spec 不誤殺）
const NOISE_RE = /\s\.paaw\/(chats|coding-memory|agent-memory|action-log|memory|sessions|logs)\/|\s\.paaw\/project\/PROJECT\.md|\sdata\/config\//;

/**
 * 驗收：新 commit 或 working diff（排除噪音）→ pass；零證據 → fail（假成功）
 * @returns {{pass: boolean, why: string, files?: string[]}}
 */
export async function verifyDispatchWork(projRoot, snap) {
  const postHead = (await _gitOut(projRoot, "rev-parse HEAD")).trim();
  if (postHead && snap?.preHead && postHead !== snap.preHead) {
    return { pass: true, why: "new-commit" };
  }
  // -uall：untracked 展開到檔案級，否則整目錄一列（?? .paaw/）噪音過濾失效
  const st = await _gitOut(projRoot, "status --porcelain -uall");
  const changed = st.split("\n").filter(l => l.trim() && !NOISE_RE.test(l));
  if (changed.length > 0) {
    return { pass: true, why: "working-diff", files: changed.slice(0, 5) };
  }
  return { pass: false, why: "no-commit-no-diff" };
}

/** retry 輪的 prompt 附加說明（帶大檔分塊策略） */
export function dispatchRetrySuffix(verdict, attempt = 1) {
  return `

⚠️【Deterministic 驗收退回（第 ${attempt} 次嘗試失敗，原因：${verdict?.why || "no-commit-no-diff"}）】
你上一輪宣稱完成，但程式驗收發現：零新 commit、零 working diff — 任務沒有實際產出。
請重做，並遵守：
1. 大檔案（>1000 行）分塊處理：先 grep 定位、逐段 edit_file，不要一次 read_file 全文
2. 每完成一個區塊就驗證（grep 確認刪除/修改生效）
3. 完成後必須留下實際產出（commit 或 working tree 變更）
4. 若真的做不到，誠實回報做不到與原因 — 絕不宣稱成功`;
}
