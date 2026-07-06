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
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { callLLMWithRetry, sanitizeContent, isMeaningfulContent, fetchStreamWithRetry } from "./llm-utils.mjs";
import { createPaawProject } from "./paaw-project.mjs";
import { generateText, streamText, tool as aiTool, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { PaawSnapshot } from "./paaw-snapshot.mjs";

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

  // Parse "providerId/modelId" format (from ModelSelector)
  // Model ID may contain "/" (e.g. "deepseek/deepseek-v4-flash")
  let providerId = config.active;
  let model = modelOverride || config.defaultModel || "glm-5.1";
  // Only treat first segment as providerId if it matches a known provider
  if (modelOverride && modelOverride.includes("/")) {
    const firstSlash = modelOverride.indexOf("/");
    const possibleProvider = modelOverride.slice(0, firstSlash);
    if (config.providers[possibleProvider]) {
      providerId = possibleProvider;
      model = modelOverride.slice(firstSlash + 1);
    }
  }

  const provider = config.providers[providerId];
  if (!provider) throw new Error(`Provider '${providerId}' not found`);

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

// ── Vercel AI SDK Helpers ──

/** Create AI SDK OpenAI provider from PAAW provider config */
function createAIProvider(rootDir, modelOverride) {
  const config = loadProviderConfig(rootDir);
  if (!config) throw new Error("No provider config found");

  let providerId = config.active;
  let model = modelOverride || config.defaultModel || "glm-5.1";
  // Only treat first segment as providerId if it matches a known provider
  if (modelOverride && modelOverride.includes("/")) {
    const firstSlash = modelOverride.indexOf("/");
    const possibleProvider = modelOverride.slice(0, firstSlash);
    if (config.providers[possibleProvider]) {
      providerId = possibleProvider;
      model = modelOverride.slice(firstSlash + 1);
    }
  }

  const provider = config.providers[providerId];
  if (!provider) throw new Error(`Provider '${providerId}' not found`);

  const openai = createOpenAI({
    baseURL: provider.baseURL.replace(/\/+$/, ""),
    apiKey: provider.apiKey,
    headers: providerId === "openrouter"
      ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" }
      : undefined,
  });

  return { model: openai(model), providerId, modelName: model };
}

/** Convert PAAW_TOOLS array to AI SDK tool map */
function buildAISdkTools(cwd, rootDir, onEvent) {
  const tools = {};
  for (const td of PAAW_TOOLS) {
    const fn = td.function;
    tools[fn.name] = aiTool({
      description: fn.description || fn.name,
      parameters: jsonSchema(fn.parameters || { type: "object", properties: {} }),
      execute: async (args) => {
        // Wrap args into the format executeTool expects
        const call = {
          function: {
            name: fn.name,
            arguments: JSON.stringify(args),
          },
        };
        const result = await executeTool(call, cwd, rootDir, onEvent);
        return result;
      },
    });
  }
  return tools;
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
    {
      type: "function",
      function: {
        name: "browser_test",
      description: "Test a web page by fetching its URL and checking the response. Use for verifying endpoints, checking if dev server is running, or inspecting page content. Returns status code, headers, and first 2000 chars of body.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to test (e.g. http://localhost:5173)" },
          expectStatus: { type: "number", description: "Expected HTTP status code (default: 200)" },
          expectText: { type: "string", description: "Text that should appear in the response body" },
        },
        required: ["url"],
      },
    },
  },
    {
      type: "function",
      function: {
        name: "record_decision",
        description: "Record an architectural or technical decision (ADR) to .paaw/DECISIONS.md. Use when you make a non-trivial design choice, pick a library, or decide on a pattern.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title for the decision" },
            context: { type: "string", description: "Why this decision is being considered" },
            decision: { type: "string", description: "What was decided" },
            consequences: { type: "string", description: "Impact and trade-offs" },
          },
          required: ["title", "decision"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_changelog",
        description: "Add an entry to .paaw/CHANGELOG.md after making code changes. Call this after writing/editing files.",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["added", "changed", "fixed", "removed", "deprecated"], description: "Category of change" },
            description: { type: "string", description: "What changed (one line summary)" },
          },
          required: ["type", "description"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_docs",
        description: "Update or create documentation in .paaw/ (PROJECT.md, ARCHITECTURE.md, etc.). Use after significant architectural changes.",
        parameters: {
          type: "object",
          properties: {
            file: { type: "string", description: "Filename to update (e.g. PROJECT.md, ARCHITECTURE.md)" },
            content: { type: "string", description: "Full file content to write" },
            append: { type: "boolean", description: "If true, append to existing content instead of replacing" },
          },
          required: ["file", "content"],
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

  // Load workspace directories (read + write allowed)
  const workspaceDirs = [];
  try {
    const wsPath = resolve(rootDir, "data/workspaces.json");
    if (existsSync(wsPath)) {
      const ws = JSON.parse(readSync(wsPath, "utf-8"));
      if (Array.isArray(ws.directories)) workspaceDirs.push(...ws.directories);
    }
  } catch {}

  // Security: check path is within allowed dirs
  // Read:  rootDir + workspaceDirs
  // Write: workspaceDirs only (rootDir is read-only, knowledge is API-only)
  const isPathAllowed = (p, write = false) => {
    const abs = resolvePath(p);
    if (write) {
      // Write: only workspace directories
      return workspaceDirs.some((d) => abs.startsWith(d));
    }
    // Read: rootDir + workspace directories
    return abs.startsWith(rootDir) || workspaceDirs.some((d) => abs.startsWith(d));
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
        // Auto-snapshot before first modification
        if (!snapshotTaken && paaw?.exists) {
          try {
            const snap = new PaawSnapshot(cwd, paaw.paawDir);
            await snap.createPreEdit(filePath);
            snapshotTaken = true;
          } catch {}
        }
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, args.content, "utf-8");
        if (onEvent) onEvent({ type: "tool_end", name, result: `Wrote ${filePath} (${args.content.length} bytes)` });
        return `Successfully wrote ${args.content.length} bytes to ${args.path}`;
      }

      case "edit_file": {
        const filePath = resolvePath(args.path);
        if (!isPathAllowed(args.path, true)) return `Error: path '${args.path}' is outside working directory`;
        if (!existsSync(filePath)) return `Error: file not found: ${args.path}`;
        // Auto-snapshot before first modification
        if (!snapshotTaken && paaw?.exists) {
          try {
            const snap = new PaawSnapshot(cwd, paaw.paawDir);
            await snap.createPreEdit(filePath);
            snapshotTaken = true;
          } catch {}
        }
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

      case "browser_test": {
        const testUrl = args.url;
        const expectStatus = args.expectStatus || 200;
        const expectText = args.expectText;

        if (!testUrl) return "Error: url is required for browser_test";

        if (onEvent) onEvent({ type: "tool_start", name, args: testUrl });

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);
          const res = await fetch(testUrl, {
            signal: controller.signal,
            redirect: "follow",
          });
          clearTimeout(timeout);

          const text = await res.text();
          const headers = {};
          res.headers.forEach((v, k) => { headers[k] = v; });

          let report = `URL: ${testUrl}\n`;
          report += `Status: ${res.status} ${res.statusText}\n`;
          report += `Content-Type: ${headers["content-type"] || "(none)"}\n`;
          report += `Body length: ${text.length} chars\n`;

          // Status check
          if (res.status === expectStatus) {
            report += `✅ Status ${res.status} matches expected ${expectStatus}\n`;
          } else {
            report += `❌ Status ${res.status} does NOT match expected ${expectStatus}\n`;
          }

          // Text check
          if (expectText) {
            if (text.includes(expectText)) {
              report += `✅ Found expected text: "${expectText.slice(0, 60)}"\n`;
            } else {
              report += `❌ Expected text not found: "${expectText.slice(0, 60)}"\n`;
            }
          }

          // Body preview
          report += `\n--- Body (first 2000 chars) ---\n${text.slice(0, 2000)}`;
          if (text.length > 2000) report += `\n... (${text.length - 2000} more chars)`;

          if (onEvent) onEvent({ type: "tool_end", name, result: `${res.status} ${res.statusText}` });
          return report;
        } catch (fetchErr) {
          const errMsg = fetchErr.name === "AbortError"
            ? `Request to ${testUrl} timed out after 10s`
            : `Failed to fetch ${testUrl}: ${fetchErr.message}`;
          if (onEvent) onEvent({ type: "tool_error", name, error: errMsg });
          return `❌ ${errMsg}\n\nThis usually means the dev server is not running. Check the port and try again.`;
        }
      }

      case "record_decision": {
        const paaw = createPaawProject(cwd);
        if (!paaw.exists) {
          return "⚠️ .paaw/ not initialized. Decision not recorded. (This is OK — the decision is still captured in the session log.)";
        }
        const result = await paaw.addDecision({
          title: args.title,
          context: args.context,
          decision: args.decision,
          consequences: args.consequences,
        });
        if (onEvent) onEvent({ type: "tool_end", name, result: `ADR-${result.adrNum}` });
        return `✅ Decision recorded as ADR-${result.adrNum} in .paaw/DECISIONS.md\nTitle: ${args.title}`;
      }

      case "update_changelog": {
        const paaw = createPaawProject(cwd);
        if (!paaw.exists) {
          return "⚠️ .paaw/ not initialized. Changelog not updated.";
        }
        await paaw.appendChangelog({
          type: args.type,
          description: args.description,
        });
        if (onEvent) onEvent({ type: "tool_end", name, result: `${args.type}: ${args.description.slice(0, 50)}` });
        return `✅ Changelog updated: [${args.type}] ${args.description}`;
      }

      case "update_docs": {
        const paaw = createPaawProject(cwd);
        if (!paaw.exists) await paaw.init();
        const docFile = args.file?.replace(/\.\.\//g, "").replace(/^\//, ""); // sanitize
        if (!docFile) return "Error: file is required";
        if (args.append) {
          const existing = await paaw.readFile(docFile) || "";
          await paaw.writeFile(docFile, existing + "\n" + args.content);
        } else {
          await paaw.writeFile(docFile, args.content);
        }
        if (onEvent) onEvent({ type: "tool_end", name, result: docFile });
        return `✅ Documentation updated: .paaw/${docFile}`;
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
  console.log(`[callLLM] model=${model}, stream=${stream}, apiUrl=${apiUrl}, messages=${messages.length}`);
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

function buildSystemPrompt({ cwd, skillMd, customPrompt, params, paawContext }) {
  const parts = [];

  // ── Inject .paaw/ project context (pre-loaded by caller) ──
  if (paawContext) {
    parts.push(paawContext);
  }

  // If customPrompt is provided, it replaces the default agent prompt entirely
  // (customPrompt comes from contextEngine — e.g. skill-builder rules)
  if (customPrompt) {
    parts.push(customPrompt);
  } else {
    // Load agent loop system prompt from ai-settings
    const AGENT_LOOP_PROMPT_PATH = resolve(__dirname, "../../../data/ai-settings/agent-loop/system-prompt.md");
    let agentBase = "";
    try { agentBase = readSync(AGENT_LOOP_PROMPT_PATH, "utf-8").trim(); } catch {}
    if (agentBase) {
      parts.push(agentBase);
    } else {
      parts.push(`You are PAAW Agent, an AI coding assistant. Always use ABSOLUTE paths. Working directory: ${cwd}`);
    }
  }

  // Inject base context: knowledge + workspace paths (required for every AI request)
  const PAAW_R = resolve(__dirname, "../../../");
  try {
    const ws = JSON.parse(readSync(resolve(PAAW_R, "data/config/workspaces.json"), "utf-8"));
    if (ws.directories?.length) {
      parts.push(`\n=== 檔案路徑 ===\n📖 Knowledge：使用 file_list({ workspace: "knowledge" }) 和 file_read({ workspace: "knowledge", path: "檔名" }) 透過 API 存取。\n\n使用者的 Workspace 目錄（可讀寫）：\n${ws.directories.map(d => "- " + d).join("\n")}`);
    }
  } catch {}

  // Inject cwd dynamically
  parts.push(`\nWorking directory: ${cwd}`);

  // Always include tool definitions
  parts.push(`\n## Your Tools\n- **read_file** — Read file contents\n- **write_file** — Write or create files\n- **edit_file** — Precise text replacement\n- **glob** — Find files by pattern\n- **grep** — Search file contents\n- **diff** — Show differences\n- **git** — Run git commands\n- **bash** — Run shell commands\n- **ask_user** — Ask for clarification`);

  if (skillMd) {
    parts.push(`\n## Skill Instructions\n\n${skillMd}`);
  }

  if (params && Object.keys(params).length > 0) {
    parts.push(`\n## User Parameters\n\n${JSON.stringify(params, null, 2)}`);
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
  const toolCallLog = [];

  // Resolve LLM via Vercel AI SDK
  const aiProvider = createAIProvider(rootDir, modelOverride);

  if (onEvent) onEvent({ type: "start", model: aiProvider.modelName, cwd, maxTurns: effectiveMaxTurns });

  // Build system prompt (load .paaw/ project context first)
  let paawContext = null;
  let paaw = null;
  try {
    paaw = createPaawProject(cwd);
    if (paaw.exists) {
      paawContext = await paaw.loadContextText();
    }
  } catch {}

  const systemPrompt = buildSystemPrompt({ cwd, skillMd, customPrompt, params, paawContext });

  // Build AI SDK tools from PAAW_TOOLS + executeTool
  const aiSdkTools = buildAISdkTools(cwd, rootDir, (evt) => {
    if (onEvent) onEvent(evt);
  });

  let finalContent = "";
  let turns = 0;

  try {
    const result = await generateText({
      model: aiProvider.model,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      tools: aiSdkTools,
      maxSteps: effectiveMaxTurns,
      maxOutputTokens: 8192,
      onStepFinish: ({ toolCalls, toolResults, finishReason }) => {
        turns++;
        if (onEvent) onEvent({ type: "turn_start", turn: turns });
        if (toolCalls) {
          for (const tc of toolCalls) {
            toolCallLog.push({
              turn: turns,
              name: tc.toolName,
              args: JSON.stringify(tc.args),
              result: typeof toolResults?.[0]?.result === "string"
                ? toolResults[0].result.slice(0, 1000)
                : JSON.stringify(toolResults?.[0]?.result || "").slice(0, 1000),
            });
          }
        }
      },
    });

    finalContent = result.text || "";
    if (!isMeaningfulContent(finalContent)) {
      finalContent = "[LLM returned empty or whitespace-only response after retries]";
    }
  } catch (err) {
    finalContent = `LLM API error: ${err.message}`;
    if (onEvent) onEvent({ type: "error", error: err.message });
  }

  const durationMs = Date.now() - startTime;

  if (onEvent) onEvent({ type: "end", turns, durationMs, toolCalls: toolCallLog.length });
  if (onEvent && finalContent) onEvent({ type: "assistant", content: finalContent });

  // ── Record session to .paaw/sessions/ ──
  if (paaw && paaw.exists) {
    try {
      await paaw.recordSession({
        task: prompt.slice(0, 200),
        prompt,
        success: !finalContent.includes("[Agent loop timed out]") && !finalContent.startsWith("LLM API error"),
        content: finalContent,
        toolCalls: toolCallLog,
        durationMs,
      });
      if (toolCallLog.some(tc => tc.name === "write_file" || tc.name === "edit_file")) {
        await paaw.generateChangelogFromSession({
          task: prompt.slice(0, 200),
          toolCalls: toolCallLog,
        });
      }
    } catch (e) {
      console.error("[paaw-project] Failed to record session:", e.message);
    }
  }

  return {
    success: !finalContent.includes("[Agent loop timed out]") && !finalContent.startsWith("LLM API error"),
    content: finalContent,
    turns,
    toolCalls: toolCallLog,
    durationMs,
  };
}

/**
 * Run agent loop with streaming (SSE) support via Vercel AI SDK streamText.
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

  const startTime = Date.now();

  // SSE helper
  const sendSSE = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  // Resolve LLM via Vercel AI SDK
  const aiProvider = createAIProvider(rootDir, modelOverride);
  sendSSE("start", { model: aiProvider.modelName, cwd, maxTurns: effectiveMaxTurns });

  // Build system prompt
  let paawContext = null;
  try {
    const paaw = createPaawProject(cwd);
    if (paaw.exists) {
      paawContext = await paaw.loadContextText();
    }
  } catch {}
  const systemPrompt = buildSystemPrompt({ cwd, skillMd, customPrompt, params, paawContext });

  // Build AI SDK tools
  const aiSdkTools = buildAISdkTools(cwd, rootDir, null);

  let turns = 0;

  try {
    const result = streamText({
      model: aiProvider.model,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      tools: aiSdkTools,
      maxSteps: effectiveMaxTurns,
      maxOutputTokens: 8192,
      onStepFinish: ({ toolCalls, toolResults }) => {
        turns++;
        sendSSE("turn", { turn: turns });
        if (toolCalls) {
          for (const tc of toolCalls) {
            sendSSE("tool", { name: tc.toolName, args: tc.args });
            if (toolResults) {
              for (const tr of toolResults) {
                const resultText = typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result);
                sendSSE("tool_result", { name: tc.toolName, result: resultText.slice(0, 2000) });
              }
            }
          }
        }
      },
    });

    // Stream text chunks as SSE content events
    for await (const chunk of result.textStream) {
      sendSSE("content", { content: chunk, done: false });
    }

    // Wait for completion
    const finalResult = await result;
    sendSSE("content", { content: "", done: true });
    sendSSE("done", { turns, durationMs: Date.now() - startTime });
  } catch (err) {
    sendSSE("error", { message: err.message });
  }
}
