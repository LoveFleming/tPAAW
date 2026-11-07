/**
 * dispatch-stream-state — 讓「別處啟動的派工 run」在 UI 看得到（2026-09-29）
 *
 * 問題：dispatch_agent / auto_dispatch 的 child run 走 runAgentLoop（非 stream），
 *       不註冊 a2a streamStates → 使用者切到該 agent 的 tab（如 Developer）時
 *       stream-state poller 拿到 exists:false → 畫面完全靜默（沒指示器、沒 ⚡ 面板）。
 *
 * 修法：child run 開跑時在 streamStates 註冊一個 entry，把 onEvent 事件轉成
 *       a2a 同款 wire 格式（event:tool / tool_result / thinking），UI 的接回
 *       poller 就能重播事件重建 ⚡ Tool Calls 面板。
 *
 * ⚠️ 純顯示用途：
 *   - done 時 finalContent 保持 null — 派工結果走 task update / EM 報告，
 *     不落地進該 agent 的直接對話（poller done-path 看到 null 不加訊息）
 *   - 不提供 abortController — 中斷 child run 維持既有行為（本來就殺不到）
 *   - 任何錯誤靜默降級，絕不影響派工本身
 */

const MAX_EVENTS = 300; // 對齊 a2a STREAM_STATE_MAX_EVENTS
const TTL_MS = 15 * 60 * 1000; // 對齊 a2a STREAM_STATE_TTL_MS

/**
 * 建立 dispatch child run 的可見性 entry。
 * @param {string} crewId agent 識別（coding.developer 或 developer 皆可 — 自動正規化）
 * @param {string} cwd 專案根（stream key 用，須跟 UI poller 帶的 cwd 一致）
 * @returns {Promise<{ onEvent: (evt:any)=>void, finish: (error?:any)=>void }>}
 */
export async function attachDispatchVisibility(crewId, cwd) {
  try {
    if (!crewId || !cwd) return _noop();
    const agentId = String(crewId).replace(/^(coding|custom)\./, "");
    // 動態 import 打斷模組循環（a2a → paaw-agent-loop → tools → a2a）
    const { streamStates } = await import("../routes/a2a.mjs");
    const key = `${agentId}::${cwd}`;
    const prev = streamStates.get(key);
    if (prev?.timer) clearTimeout(prev.timer);
    const st = {
      agentId, cwd,
      startedAt: new Date().toISOString(),
      seq: 0,
      events: [],
      finalContent: null, // 刻意 null：不污染直接對話
      done: false,
      error: null,
      timer: null,
      dispatch: true, // 標記來源（debug 用）
    };
    streamStates.set(key, st);
    const push = (event, data) => {
      st.seq += 1;
      st.events.push({ seq: st.seq, event, data });
      if (st.events.length > MAX_EVENTS) st.events.splice(0, st.events.length - MAX_EVENTS);
    };
    return {
      onEvent: (evt) => {
        try {
          if (!evt || st.done) return;
          if (evt.type === "tool_start" && evt.name) {
            push("tool", { name: evt.name, args: evt.args });
          } else if (evt.type === "tool_end" && evt.name) {
            const r = typeof evt.result === "string" ? evt.result : (() => { try { return JSON.stringify(evt.result); } catch { return String(evt.result); } })();
            push("tool_result", { name: evt.name, result: (r || "").slice(0, 500) });
          } else if ((evt.type === "assistant_thinking" || evt.type === "thinking") && evt.content) {
            push("thinking", { content: String(evt.content).slice(0, 300) });
          }
        } catch { /* 顯示用途 — 絕不拋 */ }
      },
      finish: (error = null) => {
        try {
          st.done = true;
          st.error = error ? String(error).slice(0, 300) : null;
          if (st.timer) clearTimeout(st.timer);
          st.timer = setTimeout(() => { try { streamStates.delete(key); } catch {} }, TTL_MS);
        } catch {}
      },
    };
  } catch {
    return _noop(); // a2a 模組不可用 — 靜默降級
  }
}

function _noop() {
  return { onEvent: () => {}, finish: () => {} };
}
