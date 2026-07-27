/**
 * context-compaction.mjs — Auto conversation compaction via LLM summarization
 *
 * When context window is getting full, automatically summarize older messages
 * using a cheap/fast model. Preserves recent messages untouched.
 *
 * This is the PAAW equivalent of OpenClaw's compaction system.
 * Used by ALL agent surfaces that have long conversations:
 *   - paaw-agent-loop.mjs (coding, EM, crew)
 *   - a2a.mjs (ChatView)
 *   - helpdesk.mjs
 *
 * Compaction strategy:
 *   1. Estimate total tokens in messages
 *   2. If approaching context window limit → trigger compaction
 *   3. Split messages into: head (system+first user) + compactable + tail (recent)
 *   4. Send compactable portion to LLM for summarization
 *   5. Replace compactable messages with single system summary message
 *   6. Continue conversation with much smaller context
 */

import { estimateTokens } from "./context-truncation.mjs";

// ── Configuration ──

/** Trigger compaction when messages exceed this fraction of context window */
const COMPACTION_TRIGGER_RATIO = 0.75;

/** Keep this fraction of context for the tail (recent messages, never compacted) */
const TAIL_KEEP_RATIO = 0.35;

/** Min messages before compaction makes sense */
const MIN_MESSAGES_FOR_COMPACTION = 12;

/** Max tokens for the summary itself */
const MAX_SUMMARY_TOKENS = 2048;

/** Default model for summarization (cheap/fast) */
const DEFAULT_SUMMARY_MODEL = "deepseek-chat";

// ── Token Budget Estimation ──

/**
 * Calculate total estimated tokens for a message array.
 * Includes tool_calls and tool_call_id overhead.
 */
export function estimateMessageTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    // Content tokens
    total += estimateTokens(msg.content || "");

    // Tool call overhead
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function?.name || "");
        total += estimateTokens(tc.function?.arguments || "");
      }
    }

    // Role + metadata overhead (~10 tokens per message)
    total += 10;

    // Tool call ID reference (~5 tokens)
    if (msg.tool_call_id) total += 5;
  }
  return total;
}

// ── Compaction Decision ──

/**
 * Determine if compaction should be triggered.
 * @param {Array} messages - Current message array
 * @param {number} contextWindow - Model's context window in tokens
 * @param {number} [maxOutputTokens=16384] - Reserved for model output
 * @returns {{ shouldCompact: boolean, currentTokens: number, budget: number, reason: string }}
 */
export function shouldCompact(messages, contextWindow, maxOutputTokens = 16384) {
  const currentTokens = estimateMessageTokens(messages);
  const budget = contextWindow - maxOutputTokens;
  const triggerThreshold = Math.floor(budget * COMPACTION_TRIGGER_RATIO);

  if (currentTokens > budget) {
    return {
      shouldCompact: true,
      currentTokens,
      budget,
      reason: `overflow (${currentTokens} > ${budget} budget)`,
    };
  }

  if (currentTokens > triggerThreshold && messages.length >= MIN_MESSAGES_FOR_COMPACTION) {
    return {
      shouldCompact: true,
      currentTokens,
      budget,
      reason: `approaching limit (${Math.round(currentTokens / budget * 100)}% of ${budget} budget, ${messages.length} messages)`,
    };
  }

  return {
    shouldCompact: false,
    currentTokens,
    budget,
    reason: `healthy (${Math.round(currentTokens / budget * 100)}% of ${budget} budget)`,
  };
}

// ── Message Partitioning ──

/**
 * Split messages into head / compactable / tail sections.
 *
 * @param {Array} messages - Full message array
 * @param {number} contextWindow - Context window size
 * @param {number} maxOutputTokens - Output token budget
 * @returns {{ head: Array, compactable: Array, tail: Array }}
 */
export function partitionMessages(messages, contextWindow, maxOutputTokens = 16384) {
  if (messages.length <= 4) {
    return { head: messages, compactable: [], tail: [] };
  }

  // Head: system prompt(s) + first user message
  const head = [];
  let idx = 0;
  for (; idx < messages.length; idx++) {
    head.push(messages[idx]);
    if (messages[idx].role === "user") {
      idx++;
      break;
    }
  }

  // Calculate tail budget: keep recent messages that fit in TAIL_KEEP_RATIO of context
  const tailTokenBudget = Math.floor((contextWindow - maxOutputTokens) * TAIL_KEEP_RATIO);
  const tail = [];
  let tailTokens = 0;

  // Walk backwards from end, accumulating tail
  let tailStart = messages.length;
  for (let i = messages.length - 1; i >= idx; i--) {
    const msgTokens = estimateMessageTokens([messages[i]]);
    if (tailTokens + msgTokens > tailTokenBudget && tail.length >= 6) {
      break;
    }
    tail.unshift(messages[i]);
    tailStart = i;
    tailTokens += msgTokens;
  }

  // Compactable: everything between head and tail
  const compactable = messages.slice(idx, tailStart);

  return { head, compactable, tail };
}

// ── LLM Summarization ──

/**
 * Use a cheap LLM to summarize older conversation messages.
 * Falls back to simple text truncation if LLM call fails.
 *
 * @param {Array} messages - Messages to summarize
 * @param {Object} llmConfig - { apiUrl, headers, model }
 * @param {string} [originalPrompt] - Original user task for context
 * @returns {Promise<string>} Summary text
 */
async function summarizeMessages(messages, llmConfig, originalPrompt) {
  // Build a compact representation of the messages
  const messageText = messages.map(m => {
    const role = m.role === "assistant" ? "Assistant" : m.role === "user" ? "User" : m.role === "tool" ? "Tool Result" : "System";
    const content = (m.content || "").slice(0, 2000); // Cap each message's contribution
    let text = `[${role}]`;
    if (m.tool_calls?.length) {
      text += ` (called ${m.tool_calls.map(tc => tc.function?.name).join(", ")})`;
    }
    return `${text} ${content}`;
  }).join("\n\n");

  const summaryPrompt = `You are a conversation compactor. Summarize the following conversation history into a concise but complete summary.

Requirements:
- Preserve all key decisions, file paths, code changes, and technical details
- Note what tools were called and their key findings
- Keep error messages and solutions
- Note what was accomplished and what remains to be done
- Be concise but lose no important information
${originalPrompt ? `- The user's original task was: "${originalPrompt.slice(0, 500)}"` : ""}

Conversation to summarize:
${messageText}

Output a structured summary in markdown:`;

  try {
    const response = await fetch(llmConfig.apiUrl, {
      method: "POST",
      headers: llmConfig.headers,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: "system", content: "You are a helpful assistant that summarizes conversations. You are concise, accurate, and never lose important technical details." },
          { role: "user", content: summaryPrompt },
        ],
        temperature: 0.1,
        max_tokens: MAX_SUMMARY_TOKENS,
      }),
    });

    if (!response.ok) {
      throw new Error(`Summary LLM call failed: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content;

    if (!summary || summary.length < 50) {
      throw new Error("Summary too short or empty");
    }

    return summary;
  } catch (err) {
    console.warn(`[compaction] LLM summarization failed: ${err.message}, falling back to text extraction`);

    // Fallback: extract key information from messages
    const fallbackParts = messages
      .filter(m => m.role === "assistant" || m.role === "user")
      .map(m => {
        const role = m.role === "assistant" ? "AI" : "User";
        return `[${role}] ${(m.content || "").slice(0, 300)}`;
      });

    return `Fallback summary (${messages.length} messages, LLM summarization failed: ${err.message}):\n${fallbackParts.join("\n").slice(0, 5000)}`;
  }
}

// ── Main Compaction Function ──

/**
 * Compact conversation messages if context window is getting full.
 * Uses LLM to summarize older messages, preserving recent ones.
 *
 * @param {Array} messages - Full message array
 * @param {Object} llmConfig - { apiUrl, headers, model, contextWindow, maxTokens }
 * @param {Object} [opts]
 * @param {string} [opts.originalPrompt] - Original user task
 * @param {Function} [opts.onEvent] - SSE callback: ({ type, ...data })
 * @param {boolean} [opts.force=false] - Force compaction even if under threshold
 * @returns {Promise<{ messages: Array, compacted: boolean, summary: string|null, stats: Object }>}
 */
export async function compactIfNeeded(messages, llmConfig, opts = {}) {
  const { originalPrompt, onEvent, force = false } = opts;
  const contextWindow = llmConfig.contextWindow || 262_000;
  const maxOutputTokens = llmConfig.maxTokens || 16384;

  const decision = shouldCompact(messages, contextWindow, maxOutputTokens);

  if (!decision.shouldCompact && !force) {
    return {
      messages,
      compacted: false,
      summary: null,
      stats: {
        currentTokens: decision.currentTokens,
        budget: decision.budget,
        reason: decision.reason,
      },
    };
  }

  // Partition messages
  const { head, compactable, tail } = partitionMessages(messages, contextWindow, maxOutputTokens);

  if (compactable.length < 4) {
    // Not enough to compact
    return {
      messages,
      compacted: false,
      summary: null,
      stats: {
        currentTokens: decision.currentTokens,
        budget: decision.budget,
        reason: "not enough compactable messages",
      },
    };
  }

  if (onEvent) onEvent({ type: "info", message: `📦 自動壓縮對話 (${decision.reason})，整理 ${compactable.length} 條舊訊息...` });

  console.log(`[compaction] Triggered: ${decision.reason}`);
  console.log(`[compaction] Partition: head=${head.length}, compactable=${compactable.length}, tail=${tail.length}`);

  // Summarize compactable messages
  // Use the configured model for summarization (could use a cheaper model in future)
  const summaryLlmConfig = {
    apiUrl: llmConfig.apiUrl,
    headers: llmConfig.headers,
    model: llmConfig.model, // Use same model — future: use cheaper model for summary
    contextWindow,
    maxTokens: MAX_SUMMARY_TOKENS,
  };

  const summary = await summarizeMessages(compactable, summaryLlmConfig, originalPrompt);

  // Build compacted message array
  const summaryMsg = {
    role: "system",
    content: `📋 [Auto-compacted conversation summary — ${compactable.length} messages compressed]\n\n${summary}\n\n[End of compaction summary. Recent messages continue below.]`,
  };

  const compactedMessages = [...head, summaryMsg, ...tail];

  const afterTokens = estimateMessageTokens(compactedMessages);
  const savedTokens = decision.currentTokens - afterTokens;

  console.log(`[compaction] Done: ${messages.length} msgs → ${compactedMessages.length} msgs (est. ${decision.currentTokens} tok → ~${afterTokens} tok, saved ~${savedTokens} tok)`);

  if (onEvent) onEvent({
    type: "info",
    message: `✅ 壓縮完成：${messages.length} → ${compactedMessages.length} 訊息（省 ~${savedTokens} tokens）`,
  });

  return {
    messages: compactedMessages,
    compacted: true,
    summary,
    stats: {
      beforeTokens: decision.currentTokens,
      afterTokens,
      savedTokens,
      messagesBefore: messages.length,
      messagesAfter: compactedMessages.length,
      compactedCount: compactable.length,
    },
  };
}
