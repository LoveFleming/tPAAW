/**
 * PAAW Agent Loop — Self-owned runtime for AI coding tasks
 *
 * Replaces external CLI agents (qwen code, opencode, claude code) with a
 * lightweight tool-calling loop that runs against PAAW's configured LLM API.
 *
 * Core flow:
 *   1. Assemble system prompt (skill + context)
 *   2. Send to LLM API with tool definitions (function calling)
 *   3. LLM responds with tool_calls → execute tools → feed results back
 *   4. LLM responds with text → done
 *   5. Repeat 2-4 until maxTurns
 *
 * Security: All tools are PAAW-owned. Every action is audit-logged.
 * Future: wrap in Docker container for sandbox isolation.
 */

import { readFile, writeFile, readdir, stat, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { exec as execCb } from "child_process";
import { resolve, join, dirname, relative, extname } from "path";
import { readFileSync } from "fs";

// ── Types ──

/**
 * @typedef {Object} AgentRunConfig
 * @property {string} prompt - User's task/prompt
 * @property {string} [cwd] - Working directory (defaults to PAAW_ROOT)
 * @property {string} [skillMd] - SKILL.md content to inject as system context
 * @property {string} [systemPrompt] - Custom system prompt override
 * @property {string} [model] - Model override (defaults to provider defaultModel)
 * @property {number} [maxTurns=20] - Max agent loop iterations
 * @property {number} [timeout=120] - Overall timeout in seconds
 * @property {Object} [params] - Additional params to inject as context
 * @property {Function} [onEvent] - Callback for streaming events (SSE)
 * @property {string} [rootDir] - PAAW_ROOT for provider config
 */

/**
 * @typedef {Object} AgentRunResult
 * @property {boolean} success
 * @property {string} content - Final LLM text response
 * @property {number} turns - Number of loop iterations
 * @property {Array} toolCalls - Log of all tool calls made
 * @property {number} durationMs
 * @property {string} [error]
 */

// ── Provider Resolution ──

function loadProviderConfig(rootDir) {
  const configPath = resolve(rootDir, "data/config/providers.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

function resolveLLMConfig(rootDir, modelOverride) {
  const config = loadProviderConfig(rootDir);
  if (!config) throw new Error("No provider config found");

  const providerId = config.active;
  const provider = config.providers[providerId];
  if (!provider) throw new Error(`Provider '${providerId}' not found`);

  const model = modelOverride || config.defaultModel || provider.models?.[0]?.id || "glm-5.1";
  const baseURL = provider.baseURL.replace(/\/+$/, "");
  const apiUrl = `${baseURL}/chat/completions`;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };

  // OpenRouter requires extra headers
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://paaw.ai";
    headers["X-Title"] = "PAAW";
  }

  return { apiUrl, headers, model, providerId };
}

// ── Tool Definitions (OpenAI function-calling format) ──

const PAAW_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file. Returns the text content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative to cwd or absolute)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file. Creates parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative to cwd or absolute)" },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Edit a file by replacing exact text matches. Safer than rewriting entire files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          old_text: { type: "string", description: "Exact text to find (must be unique in file)" },
          new_text: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and directories in a path. Returns names, types, and sizes.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path (defaults to cwd)" },
          recursive: { type: "boolean", description: "List recursively (default: false)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec",
      description: "Run a shell command and return stdout/stderr. Use for building, testing, git operations, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in seconds (default: 30)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description: "Ask the user a question when you need clarification or confirmation. Use sparingly.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "Question to ask the user" },
        },
        required: ["question"],
      },
    },
  },
];

// ── Tool Execution ──

/**
 * Execute a tool call and return the result string.
 * All paths are resolved relative to cwd for safety.
 */
async function executeTool(call, cwd, rootDir, onEvent) {
  const { name, arguments: argsStr } = call.function;
  let args;
  try { args = JSON.parse(argsStr); } catch { return `Error: invalid JSON arguments`; }

  // Resolve relative paths against cwd
  const resolvePath = (p) => {
    if (!p) return cwd;
    return p.startsWith("/") ? p : resolve(cwd, p);
  };

  // Emit tool event for SSE
  if (onEvent) onEvent({ type: "tool_start", name, args });

  try {
    switch (name) {
      // ── read_file ──
      case "read_file": {
        const filePath = resolvePath(args.path);
        // Security: only allow reading under cwd or rootDir
        if (!filePath.startsWith(cwd) && !filePath.startsWith(rootDir)) {
          return `Error: path '${args.path}' is outside allowed directory`;
        }
        if (!existsSync(filePath)) return `Error: file not found: ${args.path}`;
        const content = await readFile(filePath, "utf-8");
        // Truncate very large files
        const maxLen = 100_000;
        const result = content.length > maxLen
          ? content.slice(0, maxLen) + `\n... (truncated, ${content.length} bytes total)`
          : content;
        if (onEvent) onEvent({ type: "tool_end", name, result: `Read ${filePath} (${content.length} bytes)` });
        return result;
      }

      // ── write_file ──
      case "write_file": {
        const filePath = resolvePath(args.path);
        // Security: only allow writing under cwd
        if (!filePath.startsWith(cwd)) {
          return `Error: path '${args.path}' is outside working directory`;
        }
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, args.content, "utf-8");
        if (onEvent) onEvent({ type: "tool_end", name, result: `Wrote ${filePath} (${args.content.length} bytes)` });
        return `Successfully wrote ${args.content.length} bytes to ${args.path}`;
      }

      // ── edit_file ──
      case "edit_file": {
        const filePath = resolvePath(args.path);
        if (!filePath.startsWith(cwd)) {
          return `Error: path '${args.path}' is outside working directory`;
        }
        if (!existsSync(filePath)) return `Error: file not found: ${args.path}`;
        const content = await readFile(filePath, "utf-8");
        const occurrences = content.split(args.old_text).length - 1;
        if (occurrences === 0) return `Error: old_text not found in ${args.path}`;
        if (occurrences > 1) return `Error: old_text found ${occurrences} times in ${args.path} — must be unique`;
        const newContent = content.replace(args.old_text, args.new_text);
        await writeFile(filePath, newContent, "utf-8");
        if (onEvent) onEvent({ type: "tool_end", name, result: `Edited ${filePath}` });
        return `Successfully edited ${args.path} (1 replacement)`;
      }

      // ── list_dir ──
      case "list_dir": {
        const dirPath = resolvePath(args.path);
        if (!dirPath.startsWith(cwd) && !dirPath.startsWith(rootDir)) {
          return `Error: path is outside allowed directory`;
        }
        if (!existsSync(dirPath)) return `Error: directory not found: ${args.path || "."}`;
        const entries = await readdir(dirPath, { withFileTypes: true });
        const items = [];
        for (const entry of entries) {
          // Skip common noise
          if (entry.name.startsWith(".") && entry.name !== ".env") continue;
          if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
          try {
            const s = await stat(join(dirPath, entry.name));
            items.push({
              name: entry.name,
              type: entry.isDirectory() ? "dir" : "file",
              size: s.size,
            });
          } catch { items.push({ name: entry.name, type: "unknown" }); }
        }
        // Recursive listing
        if (args.recursive) {
          const subDirs = items.filter(i => i.type === "dir");
          for (const sub of subDirs.slice(0, 20)) { // limit depth
            try {
              const subEntries = await readdir(join(dirPath, sub.name), { withFileTypes: true });
              for (const se of subEntries) {
                if (se.name.startsWith(".")) continue;
                items.push({
                  name: `${sub.name}/${se.name}`,
                  type: se.isDirectory() ? "dir" : "file",
                });
              }
            } catch {}
          }
        }
        const result = items.map(i => `${i.type === "dir" ? "📁" : "📄"} ${i.name}${i.size ? ` (${i.size}B)` : ""}`).join("\n");
        if (onEvent) onEvent({ type: "tool_end", name, result: `Listed ${items.length} items in ${dirPath}` });
        return result || "(empty directory)";
      }

      // ── exec ──
      case "exec": {
        const timeoutMs = (args.timeout || 30) * 1000;
        const result = await new Promise((resolve) => {
          const child = execCb(args.command, {
            cwd,
            timeout: timeoutMs,
            maxBuffer: 5 * 1024 * 1024,
            env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
          }, (err, stdout, stderr) => {
            let output = "";
            if (stdout) output += stdout;
            if (stderr) output += (output ? "\n" : "") + stderr;
            if (err && !output.includes(err.message)) output += (output ? "\n" : "") + `Exit code: ${err.code || 1}`;
            resolve(output || "(no output)");
          });
        });
        // Truncate large output
        const maxLen = 50_000;
        const truncated = result.length > maxLen
          ? result.slice(0, maxLen) + `\n... (truncated, ${result.length} bytes total)`
          : result;
        if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 500) });
        return truncated;
      }

      // ── ask_user ──
      case "ask_user": {
        // In non-interactive mode, we can't ask — return as hint to LLM
        if (onEvent) onEvent({ type: "tool_end", name, result: `Asked: ${args.question}` });
        return `[User interaction not available in agent loop. Please make your best judgment and proceed. Question was: ${args.question}]`;
      }

      default:
        return `Error: unknown tool '${name}'`;
    }
  } catch (err) {
    const errMsg = `Error in ${name}: ${err.message}`;
    if (onEvent) onEvent({ type: "tool_error", name, error: err.message });
    return errMsg;
  }
}

// ── LLM API Call ──

async function callLLM(apiUrl, headers, model, messages, tools, stream = false) {
  const body = {
    model,
    messages,
    tools,
    tool_choice: "auto",
    max_tokens: 8192,
    stream,
  };

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`LLM API error ${resp.status}: ${text.slice(0, 500)}`);
  }

  if (stream) {
    return resp; // Return raw response for SSE streaming
  }

  return await resp.json();
}

// ── System Prompt Assembly ──

function buildSystemPrompt({ cwd, skillMd, customPrompt, params }) {
  const parts = [];

  parts.push(`You are PAAW Agent, an AI coding assistant. You help users write, edit, and debug code.

## Your Capabilities
- Read, write, and edit files in the working directory
- List directory contents
- Execute shell commands (build, test, git, etc.)
- Ask questions when you need clarification

## Rules
1. Always resolve file paths relative to the working directory: ${cwd}
2. Before writing code, read existing files to understand the project structure
3. Use edit_file for small changes, write_file for new files or large rewrites
4. Run tests/builds after making changes to verify correctness
5. Be concise and focused — complete the task efficiently
6. If something is unclear, use ask_user
7. Never delete files unless explicitly asked
8. Keep changes minimal — don't rewrite entire files for small edits`);

  if (skillMd) {
    parts.push(`\n## Skill Instructions\n\n${skillMd}`);
  }

  if (params && Object.keys(params).length > 0) {
    parts.push(`\n## User Parameters\n\n${JSON.stringify(params, null, 2)}`);
  }

  if (customPrompt) {
    parts.push(`\n## Additional Instructions\n\n${customPrompt}`);
  }

  return parts.join("\n");
}

// ── Main Agent Loop ──

/**
 * Run the PAAW agent loop.
 *
 * @param {AgentRunConfig} config
 * @returns {Promise<AgentRunResult>}
 */
export async function runAgentLoop(config) {
  const {
    prompt,
    cwd = process.cwd(),
    skillMd = "",
    systemPrompt: customPrompt = "",
    model: modelOverride,
    maxTurns = 20,
    timeout = 120,
    params = {},
    onEvent = null,
    rootDir = cwd,
  } = config;

  const startTime = Date.now();
  const timeoutMs = timeout * 1000;
  const toolCallLog = [];

  // Resolve LLM config
  const llm = resolveLLMConfig(rootDir, modelOverride);

  if (onEvent) onEvent({ type: "start", model: llm.model, cwd, maxTurns });

  // Build system prompt
  const systemPrompt = buildSystemPrompt({ cwd, skillMd, customPrompt, params });

  // Initialize messages
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  let finalContent = "";
  let turns = 0;

  for (let i = 0; i < maxTurns; i++) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      finalContent += "\n\n[Agent loop timed out]";
      break;
    }

    turns++;

    if (onEvent) onEvent({ type: "turn_start", turn: i + 1 });

    // Call LLM
    let response;
    try {
      response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, PAAW_TOOLS);
    } catch (err) {
      finalContent = `LLM API error: ${err.message}`;
      if (onEvent) onEvent({ type: "error", error: err.message });
      break;
    }

    // Parse response
    const choice = response.choices?.[0];
    if (!choice) {
      finalContent = "LLM returned empty response";
      break;
    }

    const assistantMsg = choice.message;
    const content = assistantMsg.content || "";
    const toolCalls = assistantMsg.tool_calls;

    // Add assistant message to history
    const historyMsg = { role: "assistant", content };
    if (toolCalls) historyMsg.tool_calls = toolCalls;
    messages.push(historyMsg);

    // If LLM just responded with text (no tool calls), we're done
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop") {
      finalContent = content;
      if (onEvent) onEvent({ type: "assistant", content });
      break;
    }

    // LLM wants to call tools
    if (content && onEvent) onEvent({ type: "assistant_thinking", content });

    // Execute each tool call
    for (const call of toolCalls) {
      const toolResult = await executeTool(call, cwd, rootDir, onEvent);
      toolCallLog.push({
        turn: i + 1,
        name: call.function.name,
        args: call.function.arguments,
        result: toolResult.slice(0, 1000),
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult,
      });
    }
  }

  const durationMs = Date.now() - startTime;

  if (onEvent) onEvent({ type: "end", turns, durationMs, toolCalls: toolCallLog.length });

  return {
    success: !finalContent.includes("[Agent loop timed out]") && !finalContent.startsWith("LLM API error"),
    content: finalContent,
    turns,
    toolCalls: toolCallLog,
    durationMs,
  };
}

/**
 * Run agent loop with streaming (SSE) support.
 * Returns the raw fetch Response for the caller to pipe as SSE.
 */
export async function runAgentLoopStream(config, res) {
  const {
    prompt,
    cwd = process.cwd(),
    skillMd = "",
    systemPrompt: customPrompt = "",
    model: modelOverride,
    maxTurns = 20,
    timeout = 120,
    params = {},
    rootDir = cwd,
  } = config;

  const startTime = Date.now();
  const timeoutMs = timeout * 1000;

  // SSE helper
  const sendSSE = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  // Resolve LLM config
  const llm = resolveLLMConfig(rootDir, modelOverride);
  sendSSE("start", { model: llm.model, cwd, maxTurns });

  // Build system prompt
  const systemPrompt = buildSystemPrompt({ cwd, skillMd, customPrompt, params });
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  let turns = 0;

  for (let i = 0; i < maxTurns; i++) {
    if (Date.now() - startTime > timeoutMs) {
      sendSSE("error", { message: "Agent loop timed out" });
      break;
    }

    turns++;
    sendSSE("turn", { turn: i + 1 });

    // Call LLM (non-streaming for now — tool calling needs complete response)
    let response;
    try {
      response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, PAAW_TOOLS);
    } catch (err) {
      sendSSE("error", { message: err.message });
      break;
    }

    const choice = response.choices?.[0];
    if (!choice) { sendSSE("error", { message: "Empty LLM response" }); break; }

    const assistantMsg = choice.message;
    const content = assistantMsg.content || "";
    const toolCalls = assistantMsg.tool_calls;

    const historyMsg = { role: "assistant", content };
    if (toolCalls) historyMsg.tool_calls = toolCalls;
    messages.push(historyMsg);

    // Final text response — stream it
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop") {
      sendSSE("content", { content, done: true });
      break;
    }

    // Intermediate thinking
    if (content) sendSSE("thinking", { content });

    // Execute tools
    for (const call of toolCalls) {
      let args;
      try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
      sendSSE("tool", { name: call.function.name, args });

      const toolResult = await executeTool(call, cwd, rootDir, null);
      sendSSE("tool_result", { name: call.function.name, result: toolResult.slice(0, 2000) });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult,
      });
    }
  }

  sendSSE("done", { turns, durationMs: Date.now() - startTime });
}
