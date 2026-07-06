/**
 * llm-fetch.mjs — Raw Chat Completions API helper with tool support.
 *
 * 為什麼不用 AI SDK？
 * - AI SDK maxSteps 在 OpenRouter/DeepSeek 上不做多步
 * - AI SDK v4 拒絕 OpenAI 原生 tool message 格式
 * - 直接 fetch Chat Completions API，完全可控
 *
 * 純文字路徑請用 paawGenerate()（ai-sdk-helpers.mjs）
 * 這裡專門處理「有 tool call 的多步對話」
 */

import { readFile } from "fs/promises";
import { resolve } from "path";

/**
 * Load provider config from data/config/providers.json
 */
export async function loadProviderConfig(rootDir) {
  const cfgPath = resolve(rootDir, "data/config/providers.json");
  const raw = await readFile(cfgPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Resolve provider details and model.
 * Returns { baseURL, apiKey, model, headers, providerId }
 */
export async function resolveProvider(rootDir, modelOverride) {
  const cfg = await loadProviderConfig(rootDir);
  const providerId = cfg.active;
  const provider = cfg.providers[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const model = modelOverride || cfg.defaultModel;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://paaw.ai";
    headers["X-Title"] = "PAAW";
  }

  return {
    baseURL: provider.baseURL.replace(/\/+$/, ""),
    apiKey: provider.apiKey,
    model,
    headers,
    providerId,
  };
}

/**
 * Build OpenAI-format tool definitions from PAAW tool definitions.
 * PAAW tool def: { function: { name, description, parameters } }
 * OpenAI tool:   { type: "function", function: { name, description, parameters } }
 */
export function toOpenAITools(paawToolDefs) {
  if (!paawToolDefs || paawToolDefs.length === 0) return undefined;
  return paawToolDefs.map(td => ({
    type: "function",
    function: td.function || td,
  }));
}

/**
 * Call Chat Completions API (single call, no multi-step).
 * Returns the raw response JSON.
 */
export async function chatCompletion(conn, body) {
  const url = `${conn.baseURL}/chat/completions`;
  const payload = {
    model: conn.model,
    ...body,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: conn.headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM API ${res.status}: ${errText.slice(0, 500)}`);
  }

  return res.json();
}

/**
 * Run a multi-step tool loop using raw Chat Completions API.
 *
 * @param {object}   conn        - resolveProvider() result
 * @param {object}   opts
 * @param {string}   opts.system - System prompt
 * @param {array}    opts.messages - Initial messages
 * @param {array}    opts.tools  - OpenAI-format tool defs (from toOpenAITools)
 * @param {object}   opts.handlers - Map: { toolName: async (args) => string }
 * @param {number}   opts.maxRounds - Max tool rounds (default 5)
 * @param {number}   opts.maxOutputTokens - default 4096
 * @param {number}   opts.temperature - default 0.7
 * @param {function} opts.onToolCall - async callback ({ name, args }) called before execution
 * @param {function} opts.onToolResult - async callback ({ name, result }) called after execution
 * @param {function} opts.onText - callback (text) called when final text is generated
 * @returns {object} { text, toolsUsed, rounds }
 */
export async function runToolLoop(conn, opts) {
  const {
    system,
    messages: initMessages,
    tools,
    handlers = {},
    maxRounds = 5,
    maxOutputTokens = 4096,
    temperature = 0.7,
    onToolCall,
    onToolResult,
    onText,
  } = opts;

  const allMessages = [...initMessages];
  const toolsUsed = [];
  let finalText = "";

  for (let round = 0; round < maxRounds; round++) {
    // Build request body
    const body = {
      messages: system
        ? [{ role: "system", content: system }, ...allMessages]
        : allMessages,
      temperature,
      max_tokens: maxOutputTokens,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const data = await chatCompletion(conn, body);
    const choice = data.choices[0];
    if (!choice) throw new Error("LLM returned no choices");

    const msg = choice.message;
    const finishReason = choice.finish_reason;

    // Case 1: LLM generated text (no tool calls) → final answer
    if (msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
      finalText = msg.content;
      if (onText) onText(finalText);
      break;
    }

    // Case 2: LLM called tools
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Add assistant message (with tool_calls) to conversation
      allMessages.push({
        role: "assistant",
        content: msg.content || "",
        tool_calls: msg.tool_calls,
      });

      // Execute each tool call
      for (const tc of msg.tool_calls) {
        const fnName = tc.function.name;
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {}

        toolsUsed.push(fnName);
        if (onToolCall) await onToolCall({ name: fnName, args });

        // Execute
        let result;
        try {
          const handler = handlers[fnName];
          if (handler) {
            const handlerResult = await handler(args);
            // PAAW handlers return { text, data?, record? }
            if (typeof handlerResult === "string") result = handlerResult;
            else if (handlerResult?.text) result = handlerResult.text;
            else result = JSON.stringify(handlerResult);
          } else {
            result = `Error: unknown tool "${fnName}"`;
          }
        } catch (err) {
          result = `Tool error: ${err.message}`;
        }

        if (onToolResult) await onToolResult({ name: fnName, result });

        // Add tool result message (OpenAI native format — works because WE control the API call)
        allMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      // Continue to next round — LLM will see tool results and generate text
      continue;
    }

    // Case 3: Empty response with no tool calls
    if (round === maxRounds - 1) {
      finalText = msg.content || "";
      if (onText) onText(finalText);
    }
  }

  return { text: finalText, toolsUsed, rounds: toolsUsed.length };
}
