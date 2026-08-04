/**
 * Shared state for coding crew agent tracking.
 * Extracted to avoid circular imports between coding.mjs and coding-tasks.mjs.
 */

/** agentId → { abortController, res, startedAt, source } */
export const runningCodingAgents = new Map();
