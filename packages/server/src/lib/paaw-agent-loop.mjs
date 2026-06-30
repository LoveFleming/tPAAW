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
 * Tool set aligned with Claude Code:
 *   read_file, write_file, edit_file, glob, grep, diff, git, bash, ask_user
 *
 * Security: All tools are PAAW-owned. Every action is audit-logged.
 * Future: wrap in Docker container for sandbox isolation.
 */

import { readFile, writeFile, readdir, stat, mkdir, rm } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { exec as execCb } from "child_process";
import { resolve, join, dirname, relative } from "path";
import { callLLMWithRetry, sanitizeContent, isMeaningfulContent, fetchStreamWithRetry } from "./llm-utils.mjs";

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
    return JSON.parse(readSync(configPath, "utf-8"));
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
// Aligned with Claude Code tool set

const PAAW_TOOLS = [
  // ── File Operations ──
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read file contents. Supports offset/limit for reading specific line ranges of large files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative to cwd or absolute)" },
          offset: { type: "number", description: "Starting line number (1-indexed, default: 1)" },
          limit: { type: "number", description: "Number of lines to read (default: all)" },
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
      description: "Edit a file by replacing exact text matches. Safer than rewriting entire files. old_text must be unique in the file.",
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

  // ── Search & Discovery ──
  {
    type: "function",
    function: {
      name: "glob",
      description: "Find files matching a glob pattern. Returns matching file paths relative to cwd. Use to discover project structure, find config files, etc.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. '**/*.tsx', 'src/**/*.test.*', '*.json')" },
          path: { type: "string", description: "Base directory to search (defaults to cwd)" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search file contents using ripgrep (rg). Returns matching lines with file paths and line numbers. Supports regex patterns.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex supported by ripgrep)" },
          path: { type: "string", description: "Directory or file to search (defaults to cwd)" },
          include: { type: "string", description: "File glob to include (e.g. '*.tsx', '*.mjs')" },
          case_sensitive: { type: "boolean", description: "Case-sensitive search (default: false)" },
          max_results: { type: "number", description: "Max number of results (default: 50)" },
        },
        required: ["pattern"],
      },
    },
  },

  // ── Diff & Git ──
  {
    type: "function",
    function: {
      name: "diff",
      description: "Show differences. Can diff two files, show git working-tree changes, or compare against a commit. Essential for reviewing changes before committing.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File or directory to diff (for git diff)" },
          against: { type: "string", description: "Git ref to diff against (e.g. 'HEAD', 'main', 'dev') — defaults to working tree vs HEAD" },
          file_a: { type: "string", description: "First file path (for file-to-file diff)" },
          file_b: { type: "string", description: "Second file path (for file-to-file diff)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git",
      description: "Run a git command. Common: status, log, diff, add, commit, push, branch, checkout. Returns stdout/stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Git subcommand and args (e.g. 'status', 'log --oneline -5', 'add -A', 'commit -m \"fix: typo\"')" },
        },
        required: ["command"],
      },
    },
  },

  // ── Shell ──
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command and return stdout/stderr. Use for build, test, install, npm, pip, and any general shell operations. Timeout default: 30s.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in seconds (default: 30, max: 120)" },
        },
        required: ["command"],
      },
    },
  },

  // ── User Interaction ──
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

// ── Shell Execution Helper ──

const IS_WIN = process.platform === "win32";

function runShell(command, cwd, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const shellOpt = IS_WIN ? "powershell.exe" : true;
    const child = execCb(command, {
      cwd,
      timeout: Math.min(timeoutMs, agentCfg.shellTimeoutMs || 600_000),
      maxBuffer: 5 * 1024 * 1024,
      shell: shellOpt,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
    }, (err, stdout, stderr) => {
      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n" : "") + stderr;
      if (err && !output.includes(err.message)) output += (output ? "\n" : "") + `Exit code: ${err.code || 1}`;
      resolve(output || "(no output)");
    });
  });
}

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

  // Security: check path is within allowed dirs
  const isPathAllowed = (p, write = false) => {
    const abs = resolvePath(p);
    if (write && !abs.startsWith(cwd)) return false;
    if (!abs.startsWith(cwd) && !abs.startsWith(rootDir)) return false;
    return true;
  };

  // Emit tool event for SSE
  if (onEvent) onEvent({ type: "tool_start", name, args });

  try {
    switch (name) {

      // ══════════════════════════════════════════
      // ── File Operations ──
      // ══════════════════════════════════════════

      case "read_file": {
        const filePath = resolvePath(args.path);
        if (!isPathAllowed(args.path)) return `Error: path '${args.path}' is outside allowed directory`;
        if (!existsSync(filePath)) return `Error: file not found: ${args.path}`;
        const content = await readFile(filePath, "utf-8");
        // Line-based reading with offset/limit
        if (args.offset || args.limit) {
          const lines = content.split("\n");
          const start = (args.offset || 1) - 1;
          const end = args.limit ? start + args.limit : lines.length;
          const selected = lines.slice(start, end);
          const result = selected.join("\n");
          if (onEvent) onEvent({ type: "tool_end", name, result: `Read ${filePath} lines ${start+1}-${Math.min(end, lines.length)} of ${lines.length}` });
          return result + (end < lines.length ? `\n... (lines ${end+1}-${lines.length} omitted)` : "");
        }
        // Truncate very large files
        const maxLen = 100_000;
        const result = content.length > maxLen
          ? content.slice(0, maxLen) + `\n... (truncated, ${content.length} bytes total)`
          : content;
        if (onEvent) onEvent({ type: "tool_end", name, result: `Read ${filePath} (${content.length} bytes)` });
        return result;
      }

      case "write_file": {
        const filePath = resolvePath(args.path);
        if (!isPathAllowed(args.path, true)) return `Error: path '${args.path}' is outside working directory`;
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, args.content, "utf-8");
        if (onEvent) onEvent({ type: "tool_end", name, result: `Wrote ${filePath} (${args.content.length} bytes)` });
        return `Successfully wrote ${args.content.length} bytes to ${args.path}`;
      }

      case "edit_file": {
        const filePath = resolvePath(args.path);
        if (!isPathAllowed(args.path, true)) return `Error: path '${args.path}' is outside working directory`;
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

      // ══════════════════════════════════════════
      // ── Search & Discovery ──
      // ══════════════════════════════════════════

      case "glob": {
        const basePath = resolvePath(args.path);
        if (!isPathAllowed(args.path || ".")) return `Error: path is outside allowed directory`;
        const pattern = args.pattern;
        // ripgrep is cross-platform (rg.exe on Windows)
        let result;
        if (IS_WIN) {
          // Windows: PowerShell-compatible command
          const cmd = `rg --files --glob "${pattern}" --max-depth 20 "${basePath}"`;
          result = await runShell(cmd, cwd, 10_000);
          if (result.includes("not recognized") || result.includes("command not found")) {
            // Fallback: PowerShell Get-ChildItem with -Recurse
            const psCmd = `Get-ChildItem -Path "${basePath}" -Recurse -Filter "${pattern.replace('**/', '').replace('**', '*')}" -File | Select-Object -First 100 -ExpandProperty FullName`;
            result = await runShell(psCmd, cwd, 10_000);
          }
        } else {
          // Unix: use rg with glob, fallback to find
          const cmd = `rg --files --glob '${pattern}' --max-depth 20 '${basePath}'`;
          result = await runShell(cmd, cwd, 10_000);
          if (result.includes("command not found")) {
            const findCmd = `find '${basePath}' -name '${pattern}' -not -path '*/node_modules/*' -not -path '*/.git/*' -type f | head -100`;
            result = await runShell(findCmd, cwd, 10_000);
          }
        }
        // Truncate
        const maxLen = 20_000;
        const truncated = result.length > maxLen
          ? result.slice(0, maxLen) + `\n... (truncated)`
          : result;
        const count = truncated.split("\n").filter(l => l.trim()).length;
        if (onEvent) onEvent({ type: "tool_end", name, result: `Found ${count} files matching '${pattern}'` });
        return truncated;
      }

      case "grep": {
        const searchPath = resolvePath(args.path);
        if (!isPathAllowed(args.path || ".")) return `Error: path is outside allowed directory`;
        const maxResults = args.max_results || 50;
        const caseFlag = args.case_sensitive ? "" : "-i";
        let result;
        if (IS_WIN) {
          // Windows: rg.exe is cross-platform
          const includeFlag = args.include ? `--glob "${args.include}"` : "";
          const cmd = `rg ${caseFlag} ${includeFlag} --max-count ${maxResults} --line-number --no-heading "${args.pattern}" "${searchPath}"`;
          result = await runShell(cmd, cwd, 15_000);
          if (result.includes("not recognized") || result.includes("command not found")) {
            // Fallback: PowerShell Select-String
            const psInclude = args.include ? `-Include "${args.include}"` : "";
            const psCmd = `Get-ChildItem -Path "${searchPath}" -Recurse ${psInclude} -File | Select-String -Pattern "${args.pattern}" ${args.case_sensitive ? "" : "-SimpleMatch"} | Select-Object -First ${maxResults}`;
            result = await runShell(psCmd, cwd, 15_000);
          }
        } else {
          // Unix: rg with fallback to grep
          const includeFlag = args.include ? `--glob '${args.include}'` : "";
          const cmd = `rg ${caseFlag} ${includeFlag} --max-count ${maxResults} --line-number --no-heading '${args.pattern}' '${searchPath}'`;
          result = await runShell(cmd, cwd, 15_000);
          if (result.includes("command not found")) {
            const grepInclude = args.include ? `--include='${args.include}'` : "";
            const grepCmd = `grep -rn ${caseFlag} ${grepInclude} --max-count=${maxResults} '${args.pattern}' '${searchPath}'`;
            result = await runShell(grepCmd, cwd, 15_000);
          }
        }
        // Truncate
        const maxLen = 30_000;
        const truncated = result.length > maxLen
          ? result.slice(0, maxLen) + `\n... (truncated, ${result.length} bytes total)`
          : result;
        if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 300) });
        return truncated;
      }

      // ══════════════════════════════════════════
      // ── Diff & Git ──
      // ══════════════════════════════════════════

      case "diff": {
        // File-to-file diff
        if (args.file_a && args.file_b) {
          const fileA = resolvePath(args.file_a);
          const fileB = resolvePath(args.file_b);
          if (!isPathAllowed(args.file_a) || !isPathAllowed(args.file_b)) return `Error: path outside allowed directory`;
          if (IS_WIN) {
            // Windows: fc.exe (file compare) is always available
            const cmd = `fc "${fileA}" "${fileB}"`;
            const result = await runShell(cmd, cwd, 10_000);
            if (onEvent) onEvent({ type: "tool_end", name, result: result.slice(0, 300) });
            return result;
          }
          const result = await runShell(`diff '${fileA}' '${fileB}'`, cwd, 10_000);
          if (onEvent) onEvent({ type: "tool_end", name, result: result.slice(0, 300) });
          return result;
        }
        // Git diff — git works on both platforms
        const diffPath = args.path ? resolvePath(args.path) : cwd;
        const against = args.against || "HEAD";
        if (IS_WIN) {
          const cmd = `git diff "${against}"${args.path ? ` -- "${diffPath}"` : ""}`;
          const result = await runShell(cmd, cwd, 15_000);
          const maxLen = 30_000;
          const truncated = result.length > maxLen ? result.slice(0, maxLen) + `\n... (truncated)` : result;
          if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 300) });
          return truncated || "(no changes)";
        }
        const cmd = `git diff '${against}'${args.path ? ` -- '${diffPath}'` : ""}`;
        const result = await runShell(cmd, cwd, 15_000);
        const maxLen = 30_000;
        const truncated = result.length > maxLen ? result.slice(0, maxLen) + `\n... (truncated)` : result;
        if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 300) });
        return truncated || "(no changes)";
      }

      case "git": {
        // All git operations go through this tool
        const cmd = `git ${args.command}`;
        const timeoutMs = Math.min((args._timeout || 30) * 1000, 60_000);
        const result = await runShell(cmd, cwd, timeoutMs);
        const maxLen = 30_000;
        const truncated = result.length > maxLen
          ? result.slice(0, maxLen) + `\n... (truncated, ${result.length} bytes total)`
          : result;
        if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 300) });
        return truncated;
      }

      // ══════════════════════════════════════════
      // ── Shell ──
      // ══════════════════════════════════════════

      case "bash": {
        const timeoutSec = Math.min(args.timeout || 30, agentCfg.bashTimeoutSeconds || 300);
        const timeoutMs = timeoutSec * 1000;
        const result = await runShell(args.command, cwd, timeoutMs);
        // Truncate large output
        const maxLen = 50_000;
        const truncated = result.length > maxLen
          ? result.slice(0, maxLen) + `\n... (truncated, ${result.length} bytes total)`
          : result;
        if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 500) });
        return truncated;
      }

      // ══════════════════════════════════════════
      // ── User Interaction ──
      // ══════════════════════════════════════════

      case "ask_user": {
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

  if (stream) {
    // 串流模式：用 fetchStreamWithRetry 取得連線，回傳 raw response
    const { fetchStreamWithRetry } = await import("./llm-utils.mjs");
    const resp = await fetchStreamWithRetry(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, { timeoutMs: 90_000 });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`LLM API error ${resp.status}: ${text.slice(0, 500)}`);
    }
    return resp; // Return raw response for SSE streaming
  }

  // 非串流：用 callLLMWithRetry 統一處理 retry + 內容驗證
  const result = await callLLMWithRetry(apiUrl, headers, body, {
    maxRetries: 3,
    timeoutMs: 90_000,
    validateContent: true,
    sanitize: true,
  });

  // 回傳跟原本一樣的 shape（把 result.raw 當 json 回傳）
  return result.raw;
}

// ── System Prompt Assembly ──

function buildSystemPrompt({ cwd, skillMd, customPrompt, params }) {
  const parts = [];

  parts.push(`You are PAAW Agent, an AI coding assistant. You help users write, edit, and debug code.

## Your Tools (aligned with Claude Code)
- **read_file** — Read file contents, with optional line offset/limit for large files
- **write_file** — Write or create files (auto-creates parent dirs)
- **edit_file** — Precise text replacement in existing files (old_text must be unique)
- **glob** — Find files by name pattern (e.g. '**/*.tsx', '*.json')
- **grep** — Search file contents with ripgrep (regex, line numbers, file filtering)
- **diff** — Show differences: file-to-file or git diff against a branch/commit
- **git** — Run git commands (status, log, add, commit, push, branch, checkout...)
- **bash** — Run any shell command (build, test, npm, pip, curl...)
- **ask_user** — Ask for clarification when needed

## Rules
1. Always use ABSOLUTE paths when reading or writing files. The working directory is: ${cwd}
2. Before writing code, read existing files and use glob/grep to understand the project structure
3. Use edit_file for small changes, write_file for new files or large rewrites
4. Use grep to find relevant code before making changes
5. Use diff to review your changes before committing
6. Run tests/builds after making changes to verify correctness (bash)
7. Be concise and focused — complete the task efficiently
8. If something is unclear, use ask_user
9. Never delete files unless explicitly asked
10. Keep changes minimal — don't rewrite entire files for small edits
11. Cross-platform: your tools work on both Windows and Linux/macOS. When using bash for shell commands, prefer cross-platform commands (git, npm, node) or use platform-appropriate syntax.
12. When referencing data files in prompts or configs, always use absolute paths starting from the project root: ${cwd}`);

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
    maxTurns,
    timeout,
    params = {},
    onEvent = null,
    rootDir = cwd,
  } = config;

  // Load agent config for defaults (with fallback)
  let agentCfg = { maxTurns: 20, timeoutSeconds: 120, bashTimeoutSeconds: 300, shellTimeoutMs: 600000 };
  try {
    const { loadAgentConfig } = await import("../routes/context.mjs");
    agentCfg = await loadAgentConfig();
  } catch {}

  const effectiveMaxTurns = maxTurns ?? agentCfg.maxTurns;
  const effectiveTimeout = timeout ?? agentCfg.timeoutSeconds;

  const startTime = Date.now();
  const timeoutMs = effectiveTimeout * 1000;
  const toolCallLog = [];

  // Resolve LLM config
  const llm = resolveLLMConfig(rootDir, modelOverride);

  if (onEvent) onEvent({ type: "start", model: llm.model, cwd, maxTurns: effectiveMaxTurns });

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
      if (onEvent) onEvent({ type: "error", error: "LLM returned no choices" });
      break;
    }

    const assistantMsg = choice.message;
    // sanitize content（清隱藏字元）
    let content = sanitizeContent(assistantMsg.content || "");
    const toolCalls = assistantMsg.tool_calls;

    // Add assistant message to history
    const historyMsg = { role: "assistant", content };
    if (toolCalls) historyMsg.tool_calls = toolCalls;
    messages.push(historyMsg);

    // If LLM just responded with text (no tool calls), we're done
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop") {
      // 防禦：如果 content 是空的或只有隱藏字元，標記為失敗
      if (!isMeaningfulContent(content)) {
        finalContent = "[LLM returned empty or whitespace-only response after retries]";
        if (onEvent) onEvent({ type: "assistant", content: finalContent });
      } else {
        finalContent = content;
        if (onEvent) onEvent({ type: "assistant", content });
      }
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
    maxTurns,
    timeout,
    params = {},
    rootDir = cwd,
  } = config;

  let agentCfg = { maxTurns: 20, timeoutSeconds: 120, bashTimeoutSeconds: 300, shellTimeoutMs: 600000 };
  try {
    const { loadAgentConfig } = await import("../routes/context.mjs");
    agentCfg = await loadAgentConfig();
  } catch {}

  const effectiveMaxTurns = maxTurns ?? agentCfg.maxTurns;
  const effectiveTimeout = timeout ?? agentCfg.timeoutSeconds;

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
