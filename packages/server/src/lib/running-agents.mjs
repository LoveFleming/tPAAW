/**
 * Shared state for coding crew agent tracking.
 * Extracted to avoid circular imports between coding.mjs and coding-tasks.mjs.
 */

/** agentId::projRoot → { abortController, res, startedAt, source }
 *  2026-09-15：key 從 agentId 改 agentId::projRoot — 多 RU 併發同 agent 不互蓋（busy check / interrupt / close cleanup 都精準到該 RU）*/
export const runningCodingAgents = new Map();
