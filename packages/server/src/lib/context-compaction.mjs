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
import { cutSafeStart } from "./llm-utils.mjs"; // 2026-09-14: 截斷不切 surrogate pair
import { contentToText, estimateContentTokens } from "./vision-content.mjs"; // vision array content 相容（2026-08-30 Phase 1）
import { stableStringify } from "./stable-stringify.mjs";

// ── Configuration ──

/** Trigger compaction when messages exceed this fraction of context window */
const COMPACTION_TRIGGER_RATIO = 0.55;

/** Keep this fraction of context for the tail (recent messages, never compacted) */
const TAIL_KEEP_RATIO = 0.35;

/** Min messages before compaction makes sense */
const MIN_MESSAGES_FOR_COMPACTION = 8;

/** Max tokens for the summary itself */
const MAX_SUMMARY_TOKENS = 2048;

/** 2026-10-24 doom-loop 修復：compaction 預算的輸出預留上限 —
 * max_tokens 再大，預算計算最多只保留這麼多。實測 agent 步輸出 <3k tokens；
 * glm-5.1 maxTokens=65536 曾把 128k context 的 prompt 預算砍剩 62k，
 * tail 永遠裝不下 → 每步重壓縮（每步多一次 30s 全額摘要 call + 打壞 prompt cache）。 */
const COMPACT_RESERVE_CAP = 32768;

/** 估算保險係數：內部估算 vs API 實收常差 ~10%（tool result / 格式 overhead）—
 * 低估會讓 tail 保護區膨脹失真，用 1.15 收斂 */
const ESTIMATE_FUDGE = 1.15;

/** tail squeeze 時 tail 至少保留的訊息數（最後這幾則永遠不丟） */
const TAIL_KEEP_MIN = 8;

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
    // Content tokens（string 或 vision array — 圖一張 ~1600 tok）
    total += estimateContentTokens(msg.content);

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

/** 保守估算（2026-10-24）：預算決策專用 — 乘保險係數收斂低估 */
export function estimateMessageTokensConservative(messages) {
  return Math.ceil(estimateMessageTokens(messages) * ESTIMATE_FUDGE);
}

/** Compaction 預算的輸出預留（2026-10-24 doom-loop 修復）：contextWindow − min(maxTokens, cap) */
export function compactBudget(contextWindow, maxOutputTokens) {
  return contextWindow - Math.min(maxOutputTokens, COMPACT_RESERVE_CAP);
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
  const currentTokens = estimateMessageTokensConservative(messages);
  const budget = compactBudget(contextWindow, maxOutputTokens);
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
  const tailTokenBudget = Math.floor(compactBudget(contextWindow, maxOutputTokens) * TAIL_KEEP_RATIO);
  const tail = [];
  let tailTokens = 0;

  // Walk backwards from end, accumulating tail（保守估算 — 低估會讓 tail 膨脹失真）
  let tailStart = messages.length;
  for (let i = messages.length - 1; i >= idx; i--) {
    const msgTokens = estimateMessageTokensConservative([messages[i]]);
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
    const content = cutSafeStart(contentToText(m.content), 2000); // 2026-09-14 cutSafe + Cap each message's contribution（vision array → 文字+圖片標記）
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
${originalPrompt ? `- The user's original task was: "${cutSafeStart(originalPrompt, 500)}"` : ""}

Conversation to summarize:
${messageText}

Output a structured summary in markdown:`;

  try {
    const response = await fetch(llmConfig.apiUrl, {
      method: "POST",
      headers: llmConfig.headers,
      signal: AbortSignal.timeout(120_000), // 2026-10-24：摘要卡死不葬整個 agent run
      body: stableStringify({
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
    // 2026-10-24：zai coding 端點 thinking 模型偶爾把成品放 reasoning_content、content 回空 → 兩邊都看
    const summary = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content;

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
        return `[${role}] ${cutSafeStart(contentToText(m.content), 300)}`;
      });

    return `Fallback summary (${messages.length} messages, LLM summarization failed: ${err.message}):\n${cutSafeStart(fallbackParts.join("\n"), 5000)}`;
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
    // 2026-10-24：overflow 但中段沒得壓（tail 吃光中段 / head+tail 本身就超）→
    // 不早退！直接 tail squeeze（無摘要 — 沒東西可摘要），否則溢出永遠没人處理。
    if (decision.reason.startsWith("overflow")) {
      const marker = {
        role: "system",
        content: `📋 [Auto-compaction: context overflow — middle too small to summarize (${messages.length} messages). Oldest recent messages dropped below to fit budget.]`,
      };
      let finalMessages = [...head, marker, ...tail];
      const prefixLen = head.length + 1;
      let tailSqueezed = 0;
      while (finalMessages.length > prefixLen + TAIL_KEEP_MIN &&
             estimateMessageTokensConservative(finalMessages) > decision.budget) {
        finalMessages.splice(prefixLen, 1);
        tailSqueezed++;
      }
      if (tailSqueezed === 0) {
        return { messages, compacted: false, summary: null, stats: { currentTokens: decision.currentTokens, budget: decision.budget, reason: "overflow but nothing squeezable" } };
      }
      finalMessages = _fixOrphanToolRefs(finalMessages);
      const afterTokens = estimateMessageTokensConservative(finalMessages);
      const stillOverBudget = afterTokens > decision.budget;
      console.log(`[compaction] Overflow-only squeeze (no middle to summarize): dropped ${tailSqueezed} tail msgs, est ${decision.currentTokens} → ~${afterTokens}${stillOverBudget ? " STILL OVER" : ""}`);
      if (onEvent) onEvent({ type: "info", message: `✅ 壓縮完成：丢棄 ${tailSqueezed} 則較舊訊息以符合 context 預算` });
      return {
        messages: finalMessages,
        compacted: true,
        summary: null,
        stats: { beforeTokens: decision.currentTokens, afterTokens, savedTokens: decision.currentTokens - afterTokens, messagesBefore: messages.length, messagesAfter: finalMessages.length, compactedCount: 0, tailSqueezed, stillOverBudget },
      };
    }
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

  // Summarize compactable messages using the main model
  // (cheap models like deepseek can't summarize coding context well)
  const summaryLlmConfig = {
    apiUrl: llmConfig.apiUrl,
    headers: llmConfig.headers,
    model: llmConfig.model,
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

  // ── 收尾自檢（2026-10-24 doom-loop 修復）：壓完仍超預算 → tail 前端讓位 ──
  // 中段榨不出空間時，最舊的 tail 訊息（多為大型 tool result）也要丟，
  // 否則永遠壓不進預算 → 每步重觸發 compaction（每步多一次全額摘要 call + 打壞 prompt cache）。
  // 直接丟訊息、不再叫 LLM；保留最後 TAIL_KEEP_MIN 則；tool 配對完整性事後修復。
  let finalMessages = compactedMessages;
  let tailSqueezed = 0;
  if (estimateMessageTokensConservative(finalMessages) > decision.budget) {
    const prefixLen = head.length + 1; // head + summaryMsg
    while (finalMessages.length > prefixLen + TAIL_KEEP_MIN &&
           estimateMessageTokensConservative(finalMessages) > decision.budget) {
      finalMessages.splice(prefixLen, 1); // tail 最舊端
      tailSqueezed++;
    }
    if (tailSqueezed > 0) {
      finalMessages = _fixOrphanToolRefs(finalMessages);
      // 在 summary 訊息補記丟棄數（模型要知道中間有洞）
      const sIdx = head.length;
      finalMessages[sIdx] = {
        ...finalMessages[sIdx],
        content: finalMessages[sIdx].content + `\n\n[Additionally, ${tailSqueezed} older recent messages were dropped to fit the context window.]`,
      };
      console.log(`[compaction] Tail squeeze: dropped ${tailSqueezed} oldest tail messages to fit budget`);
    }
  }

  // ── 2026-10-24 順手修：孤兒 tool 配對防護（無條件跑）——
  // partition 可能把 tool result 劃進 tail、它的 assistant tool_call 卻在中段被摘要掉
  // → 壓完出現孤兒 tool 訊息（OpenAI 格式嚴格端點會 400）。摘要/丢棄後一律修復。─
  const beforeFixup = finalMessages.length;
  finalMessages = _fixOrphanToolRefs(finalMessages);
  if (finalMessages.length !== beforeFixup) {
    console.log(`[compaction] Orphan tool refs fixed: ${beforeFixup} → ${finalMessages.length} msgs`);
  }

  const stillOverBudget = estimateMessageTokensConservative(finalMessages) > decision.budget;

  const afterTokens = estimateMessageTokensConservative(finalMessages);
  const savedTokens = decision.currentTokens - afterTokens;

  console.log(`[compaction] Done: ${messages.length} msgs → ${finalMessages.length} msgs (est. ${decision.currentTokens} tok → ~${afterTokens} tok, saved ~${savedTokens} tok${stillOverBudget ? ", STILL OVER BUDGET" : ""})`);

  if (onEvent) onEvent({
    type: "info",
    message: `✅ 壓縮完成：${messages.length} → ${finalMessages.length} 訊息（省 ~${savedTokens} tokens）`,
  });

  return {
    messages: finalMessages,
    compacted: true,
    summary,
    stats: {
      beforeTokens: decision.currentTokens,
      afterTokens,
      savedTokens,
      messagesBefore: messages.length,
      messagesAfter: finalMessages.length,
      compactedCount: compactable.length,
      tailSqueezed,
      stillOverBudget,
    },
  };
}

/** 2026-10-24：丟訊息後修復 tool 配對（OpenAI 格式 API 對孤兒會 400）—
 * 1. tool result 的配對 assistant tool_call 被丟 → tool result 也要丟
 * 2. assistant tool_call 的 result 被丟 → 該 tool_call 移除（訊息本體保留） */
function _fixOrphanToolRefs(messages) {
  // 收集「有後續 tool result」的 tool_call id（result 必須緊跟在 assistant 後）
  const idsWithResult = new Set();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      for (let j = i + 1; j < messages.length && messages[j].role === "tool"; j++) {
        if (messages[j].tool_call_id) idsWithResult.add(messages[j].tool_call_id);
      }
    }
  }
  const out = [];
  for (const m of messages) {
    if (m.role === "tool") {
      if (m.tool_call_id && idsWithResult.has(m.tool_call_id)) out.push(m);
      continue;
    }
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const kept = m.tool_calls.filter(tc => idsWithResult.has(tc.id));
      if (kept.length !== m.tool_calls.length) {
        out.push({ ...m, ...(kept.length ? { tool_calls: kept } : {}) });
        continue;
      }
    }
    out.push(m);
  }
  return out;
}
