/**
 * context-truncation.mjs — Shared tool result truncation utilities
 *
 * Smart head+tail truncation that preserves error messages, stack traces,
 * and test results at the end of tool output. Used by ALL agent surfaces:
 *   - paaw-agent-loop.mjs (coding, EM, crew)
 *   - a2a.mjs (ChatView)
 *   - helpdesk.mjs
 *   - auto-dispatch-shared.mjs / auto-dispatch-manager.mjs
 *
 * Key principle: never blindly slice(0, N) — always preserve the tail
 * where errors, exceptions, and summaries live.
 */

// ── Configuration ──

/** Default max chars for a single tool result before truncation */
const DEFAULT_MAX_TOOL_RESULT_CHARS = 12_000;

/** Minimum chars to keep from the head */
const MIN_HEAD_CHARS = 5_000;

/** Minimum chars to keep from the tail (errors live here!) */
const MIN_TAIL_CHARS = 8_000;

/** Patterns that indicate important content at the end of output */
const TAIL_IMPORTANT_PATTERNS = [
  /error/i, /exception/i, /traceback/i, /failed/i, /fail\b/i,
  /✗/i, /✘/i, /assert/i, /expected/i, /received/i,
  /exit code/i, /status:/i, /result:/i, /summary:/i,
  /\d+\s+(passed|failed|skipped)/i,
  /npm err/i, /pnpm err/i, /yarn err/i,
  /cannot find/i, /not found/i, /undefined/i, /null/i,
  /warning/i, /deprecated/i,
];

// ── Token Estimation ──

/**
 * Fast token estimation: ~4 chars per token for English/code.
 * More accurate than char count for budget calculations.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  // Rough heuristic: CJK chars ≈ 1 token each, Latin ≈ 4 chars/token
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latinChars = text.length - cjkCount;
  return Math.ceil(cjkCount * 1.5 + latinChars / 4);
}

// ── Head + Tail Truncation ──

/**
 * Check if the tail of a string contains important patterns (errors, summaries).
 * @param {string} text - Full text to check
 * @param {number} tailChars - How many chars from the end to check
 * @returns {boolean}
 */
function tailHasImportantContent(text, tailChars = MIN_TAIL_CHARS) {
  if (text.length <= tailChars) return false;
  const tail = text.slice(-tailChars);
  return TAIL_IMPORTANT_PATTERNS.some(p => p.test(tail));
}

/**
 * Smart truncation: keeps head + tail, replaces middle with omission marker.
 *
 * This is the KEY function — instead of blindly slicing tool output at N chars,
 * we preserve both the beginning (context) and the end (errors, results).
 *
 * @param {string} text - Tool result text
 * @param {number} maxChars - Maximum chars to keep (default 30000)
 * @param {Object} [opts]
 * @param {number} [opts.minHead=5000] - Minimum head chars
 * @param {number} [opts.minTail=8000] - Minimum tail chars
 * @param {boolean} [opts.alwaysKeepTail=false] - Force keeping tail even if no patterns match
 * @returns {string} Truncated text with middle omission marker if needed
 */
export function smartTruncateToolResult(text, maxChars = DEFAULT_MAX_TOOL_RESULT_CHARS, opts = {}) {
  if (!text || typeof text !== "string") return text || "";
  if (text.length <= maxChars) return text;

  const minHead = opts.minHead ?? MIN_HEAD_CHARS;
  const minTail = opts.minTail ?? MIN_TAIL_CHARS;
  const alwaysKeepTail = opts.alwaysKeepTail ?? false;

  // Budget: split remaining between head and tail
  const budget = maxChars - 100; // reserve for omission marker
  const shouldKeepTail = alwaysKeepTail || tailHasImportantContent(text, minTail * 2);

  if (shouldKeepTail) {
    // Head + tail strategy
    let headChars = Math.max(minHead, Math.floor(budget * 0.5));
    let tailChars = Math.max(minTail, Math.floor(budget * 0.5));
    // Ensure head + tail <= budget
    if (headChars + tailChars > budget) {
      // Scale down proportionally
      const ratio = budget / (headChars + tailChars);
      headChars = Math.floor(headChars * ratio);
      tailChars = Math.floor(tailChars * ratio);
    }
    const head = text.slice(0, headChars);
    const tail = text.slice(-tailChars);
    const omitted = text.length - headChars - tailChars;
    return `${head}\n\n⚠️ [... ${omitted.toLocaleString()} chars omitted (middle content truncated) ...]\n\n${tail}`;
  }

  // Head-only truncation (tail has no important patterns)
  const head = text.slice(0, budget);
  return `${head}\n\n⚠️ [... ${((text.length - budget).toLocaleString())} chars truncated ...]`;
}

// ── Batch Tool Result Truncation ──

/**
 * Truncate all tool messages in a conversation to fit within budget.
 * Processes messages in reverse (most recent first) to preserve recent context.
 *
 * @param {Array} messages - Array of {role, content, ...} messages
 * @param {number} maxCharsPerResult - Max chars per tool result (default 30000)
 * @param {number} totalBudgetChars - Overall budget for tool results (default: 40% of 128k context ≈ 50000)
 * @returns {Array} Messages with truncated tool results
 */
export function truncateToolResultsInMessages(messages, maxCharsPerResult = DEFAULT_MAX_TOOL_RESULT_CHARS, totalBudgetChars = 30_000) {
  const toolMsgIndexes = [];

  // Build a map: tool_call_id → tool name (from preceding assistant messages)
  const toolNameMap = new Map();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id) toolNameMap.set(tc.id, tc.function?.name || "");
      }
    }
  }

  // Identify tool messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "tool") {
      toolMsgIndexes.push(i);
    }
  }

  // ── 3-tier truncation strategy ──
  // Goal: recent reads stay FULL, old stuff gets aggressively compressed
  //
  // Tier 1 (last 2 turns): read_file FULL (up to 36K), other tools 12K each
  // Tier 2 (turns 3-6):    read_file 12K, other tools 4K
  // Tier 3 (turn 7+):      everything 2K (just summary/preview)

  const result = [...messages];

  // Figure out turn boundaries: count assistant messages with tool_calls
  const turnBoundaries = []; // indexes into toolMsgIndexes
  let lastAssistantIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "assistant" && messages[i].tool_calls?.length > 0) {
      lastAssistantIdx = i;
    }
    if (messages[i].role === "tool" && lastAssistantIdx >= 0) {
      // This tool belongs to the current assistant turn
      if (!turnBoundaries.length || turnBoundaries[turnBoundaries.length - 1] !== lastAssistantIdx) {
        turnBoundaries.push(lastAssistantIdx);
      }
    }
  }
  const totalTurns = turnBoundaries.length;

  // Assign each tool message to a turn number
  const toolTurnMap = new Map(); // msgIndex → turnNumber (0=oldest, N=newest)
  let turnIdx = 0;
  for (let i = 0; i < messages.length; i++) {
    if (i === turnBoundaries[turnIdx + 1]) turnIdx++;
    if (messages[i].role === "tool") {
      toolTurnMap.set(i, turnIdx);
    }
  }

  let totalToolChars = 0;

  for (const msgIdx of toolMsgIndexes) {
    const msg = result[msgIdx];
    const content = msg.content || "";
    const toolName = toolNameMap.get(msg.tool_call_id) || "";
    const isReadFile = toolName === "read_file";
    const turnNum = toolTurnMap.get(msgIdx) ?? 0;
    const turnsAgo = totalTurns - turnNum;

    let cap;
    if (turnsAgo <= 2) {
      // Tier 1: recent — read_file gets full content, others get normal cap
      cap = isReadFile ? 36_000 : 12_000;
    } else if (turnsAgo <= 6) {
      // Tier 2: medium — read_file gets compressed, others get tight
      cap = isReadFile ? 12_000 : 4_000;
    } else {
      // Tier 3: old — everything gets a preview only
      cap = 2_000;
    }

    if (content.length > cap) {
      result[msgIdx] = {
        ...msg,
        content: smartTruncateToolResult(content, cap, { alwaysKeepTail: turnsAgo <= 3 }),
      };
    }
    totalToolChars += (result[msgIdx].content || "").length;
  }

  return result;
}

// ── Conversation History Limiting ──

/**
 * Limit conversation history to most recent N user turns.
 * Always preserves system prompt + first user message.
 *
 * @param {Array} messages - Full message array
 * @param {number} maxUserTurns - Max user messages to keep (default 10)
 * @returns {Array} Trimmed messages
 */
export function limitHistoryTurns(messages, maxUserTurns = 10) {
  if (messages.length <= 4) return messages;

  // Always keep system + first user
  const head = [];
  let headEnd = 0;
  for (let i = 0; i < messages.length; i++) {
    head.push(messages[i]);
    headEnd = i + 1;
    if (messages[i].role === "user") break;
  }

  const tail = messages.slice(headEnd);

  // Count user turns in tail (most recent first)
  const userTurnIndexes = [];
  for (let i = tail.length - 1; i >= 0; i--) {
    if (tail[i].role === "user") userTurnIndexes.push(i);
    if (userTurnIndexes.length >= maxUserTurns) break;
  }

  if (userTurnIndexes.length < maxUserTurns) {
    return messages; // Under limit, no trimming needed
  }

  // Find cutoff point: keep from the oldest "kept" user turn onwards
  const oldestKeptUserIdx = userTurnIndexes[userTurnIndexes.length - 1];
  // Move back to include any preceding assistant/tool messages up to the user turn
  let cutoff = oldestKeptUserIdx;
  while (cutoff > 0 && tail[cutoff - 1].role !== "user") {
    cutoff--;
  }

  const keptTail = tail.slice(cutoff);
  const evictedCount = tail.length - keptTail.length;

  if (evictedCount === 0) return messages;

  // Build brief summary of evicted messages
  const evicted = tail.slice(0, cutoff);
  const summaryParts = evicted
    .filter(m => m.role === "assistant" || m.role === "user")
    .map(m => {
      const content = (m.content || "").slice(0, 200);
      const role = m.role === "assistant" ? "AI" : "User";
      return `[${role}] ${content}`;
    });

  const summaryMsg = {
    role: "system",
    content: `[Earlier conversation (${evictedCount} messages) trimmed to manage context]\n${summaryParts.join("\n").slice(0, 2000)}\n[End of summary]`,
  };

  return [...head, summaryMsg, ...keptTail];
}
