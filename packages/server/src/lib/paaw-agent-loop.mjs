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
import { PaawSnapshot } from "./paaw-snapshot.mjs";
import { resolveDefaultModel } from "./llm-utils.mjs";

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

export function resolveLLMConfig(rootDir, modelOverride) {
  const config = loadProviderConfig(rootDir);
  if (!config) throw new Error("No provider config found");

  // Parse "providerId/modelId" format (from ModelSelector)
  let providerId = config.active;
  let model = modelOverride || resolveDefaultModel(config);
  if (modelOverride && modelOverride.includes("/")) {
    const firstSlash = modelOverride.indexOf("/");
    providerId = modelOverride.slice(0, firstSlash);
    model = modelOverride.slice(firstSlash + 1);
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

  // Build fallback chain: zai → openrouter → deepseek
  const fallbacks = [];
  if (providerId !== "openrouter" && config.providers.openrouter) {
    const orP = config.providers.openrouter;
    const orHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${orP.apiKey}`, "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" };
    fallbacks.push({ providerId: "openrouter", apiUrl: `${orP.baseURL.replace(/\/+$/, "")}/chat/completions`, headers: orHeaders, model: `z-ai/${model}` });
  }
  if (providerId !== "deepseek" && config.providers.openrouter) {
    // Use openrouter deepseek as last fallback
    fallbacks.push({ providerId: "openrouter", apiUrl: `${config.providers.openrouter.baseURL.replace(/\/+$/, "")}/chat/completions`, headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.providers.openrouter.apiKey}`, "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" }, model: "deepseek/deepseek-v4-flash" });
  }

  return { apiUrl, headers, model, providerId, fallbacks };
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

  // ── Project Knowledge Read Tools (structured .paaw/ access) ──
  {
    type: "function",
    function: {
      name: "project_context",
      description: "Get the full .paaw/ project context: PROJECT.md, ARCHITECTURE.md, STATUS.md, CODING-STANDARDS.md. Use this FIRST to understand the project before doing any work. Do NOT read_file these directly.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_decisions",
      description: "Read architectural decisions (ADRs) from .paaw/DECISIONS.md. Returns structured decision records. Use this to understand why certain technical choices were made.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_standards",
      description: "List and read coding standards from .paaw/standards/. Returns available standard names and their content. Use this to check project conventions before writing code.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Specific standard to read (e.g. 'coding-style'). If omitted, lists all available standards." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_changelog",
      description: "Read the project changelog from .paaw/CHANGELOG.md. Returns recent changes organized by type. Use this to understand what was recently changed.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_issues",
      description: "List project issues from .paaw/issues/ISSUES.json. Supports filtering by status and priority. Use this to find known bugs and tasks instead of reading the JSON file directly.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status: open, in-progress, resolved, closed, wontfix (comma-separated for multiple)" },
          priority: { type: "string", description: "Filter by priority: critical, high, medium, low (comma-separated)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_sessions",
      description: "List recent coding sessions from .paaw/sessions/. Returns session filenames and dates. Use this to see what work was done previously.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max sessions to return (default: 5)" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "project_features",
      description: "List all project features with their code files, APIs, tests, runbooks, and linked issues. Use this to understand what features exist and how they map to code. Do NOT read .paaw/features/ directly.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Search features by name or description" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_feature_detail",
      description: "Get full detail of a single feature including AI understanding, documentation, code files, APIs, tests, runbooks, and linked issues.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Feature ID (e.g. F-001)" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_feature_update_docs",
      description: "Update the documentation for a feature. Use this when you've made code changes and need to update the feature's docs to reflect the changes.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Feature ID (e.g. F-001)" },
          documentation: { type: "string", description: "New documentation content in markdown" },
        },
        required: ["id", "documentation"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "project_feature_update_mapping",
      description: "Update a feature's file mappings (codeFiles, apis, tests, runbooks) after you've added, renamed, moved, or deleted files related to that feature. ALWAYS call this when your code changes affect a feature's structure.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Feature ID (e.g. F-001)" },
          codeFiles: { type: "array", items: { type: "string" }, description: "Updated list of code file paths" },
          apis: { type: "array", items: { type: "object" }, description: "Updated API endpoints [{method, path, file}]" },
          tests: { type: "array", items: { type: "string" }, description: "Updated list of test file paths" },
          runbooks: { type: "array", items: { type: "string" }, description: "Updated list of runbook file paths" },
        },
        required: ["id"],
      },
    },
  },

  // ── Test Intelligence ──
  {
    type: "function",
    function: {
      name: "project_test_map",
      description: "Get test intelligence: which tests cover a given file, and what to run when you change a file. Use this BEFORE making code changes to know which tests will be affected.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Production file path to check which tests cover it. If omitted, returns overall test stats." },
          feature: { type: "string", description: "Feature ID (e.g. F-001) to list all tests for that feature." },
        },
      },
    },
  },

  // ── Security Intelligence ──
  {
    type: "function",
    function: {
      name: "project_security",
      description: "Get security scan results (Semgrep). Lists findings by severity, file, and CWE. Use this to check for known vulnerabilities before making security-sensitive changes.",
      parameters: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["error", "warning", "info"], description: "Filter by severity. If omitted, returns all." },
          file: { type: "string", description: "Filter findings by file path." },
        },
      },
    },
  },

  // ── Change Intelligence ──
  {
    type: "function",
    function: {
      name: "project_recent_changes",
      description: "Get recent change intelligence: what was recently modified, which features/APIs were touched, and impact analysis. Use this FIRST when picking up a task to understand what recently happened.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Check impact of a specific changed file — which other files depend on it." },
          days: { type: "number", description: "How many days back to look (default: 30)." },
        },
      },
    },
  },

  // ── Action Log (Agent Memory / Handoff) ──
  {
    type: "function",
    function: {
      name: "action_log_add",
      description: "Record your action to the project action log. This is the handoff log between agents — write after completing a task so other agents know what you did.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["review", "fix", "decide", "support", "create", "refactor"], description: "Action type" },
          summary: { type: "string", description: "One-line summary of what you did" },
          details: { type: "string", description: "Detailed description (optional)" },
          affectedFiles: { type: "array", items: { type: "string" }, description: "Files that were affected" },
          result: { type: "string", enum: ["fixed", "suggestions", "adr", "clarified", "created"], description: "Result type" },
          priority: { type: "string", enum: ["high", "medium", "low"], description: "Priority level" },
        },
        required: ["action", "summary", "result"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "action_log_list",
      description: "Read recent action log entries. This shows what other agents (and you) have done recently — the project handoff log.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Filter by agent ID (e.g. 'architect', 'helpdesk')" },
          limit: { type: "number", description: "Max entries to return (default 15)" },
        },
      },
    },
  },

  // ── Agent Long-term Memory ──
  {
    type: "function",
    function: {
      name: "agent_memory_save",
      description: "Save important insights or decisions to your long-term memory file. This persists across conversations.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Markdown content to save (will replace existing memory)" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_memory_load",
      description: "Load your long-term memory. Returns insights and decisions saved from previous conversations.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

// ── Shell Execution Helper ──

const IS_WIN = process.platform === "win32";

// Module-level agent config defaults (used by runShell + executeTool)
const _agentCfgDefaults = { maxTurns: 60, timeoutSeconds: 1800, bashTimeoutSeconds: 600, shellTimeoutMs: 1200000 };
let _agentCfg = { ..._agentCfgDefaults };
export function setAgentConfig(cfg) { _agentCfg = { ..._agentCfgDefaults, ...cfg }; }

function runShell(command, cwd, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const shellOpt = IS_WIN ? "powershell.exe" : true;
    const child = execCb(command, {
      cwd,
      timeout: Math.min(timeoutMs, _agentCfg.shellTimeoutMs || 600_000),
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
async function executeTool(call, cwd, rootDir, onEvent, agentId) {
  const { name, arguments: argsStr } = call.function;
  let args;
  try { args = JSON.parse(argsStr); } catch { return `Error: invalid JSON arguments`; }
  // Inject agentId for action log / memory tools
  if (agentId && ["action_log_add", "action_log_list", "agent_memory_save", "agent_memory_load"].includes(name)) {
    args._agentId = agentId;
  }

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
  // Read:  cwd + rootDir + workspaceDirs
  // Write: cwd + workspaceDirs (cwd = project root, AI must be able to write project code)
  const isPathAllowed = (p, write = false) => {
    const abs = resolvePath(p);
    // Normalize for cross-platform: use split to compare path segments
    const startsWith = (target, prefix) => {
      const t = target.split(/[\\/]/);
      const p = prefix.split(/[\\/]/);
      if (p.length > t.length) return false;
      return p.every((seg, i) => seg.toLowerCase() === t[i].toLowerCase());
    };
    if (write) {
      // Write: cwd (project root) + workspace directories
      return startsWith(abs, cwd) || workspaceDirs.some((d) => startsWith(abs, d));
    }
    // Read: cwd + rootDir + workspace directories
    return startsWith(abs, cwd) || startsWith(abs, rootDir) || workspaceDirs.some((d) => startsWith(abs, d));
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
        const timeoutSec = Math.min(args.timeout || 30, _agentCfg.bashTimeoutSeconds || 300);
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

      // ══════════════════════════════════════════
      // ── Project Knowledge Read Tools (structured .paaw/ access) ──
      // ══════════════════════════════════════════

      case "project_context": {
        const paaw = createPaawProject(cwd);
        if (!paaw.exists) return "⚠️ .paaw/ not initialized for this project.";
        const ctx = await paaw.loadContextText();
        if (onEvent) onEvent({ type: "tool_end", name, result: ctx ? `${ctx.length} chars` : "empty" });
        return ctx || "(No project context found)";
      }

      case "project_decisions": {
        const paaw = createPaawProject(cwd);
        if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
        try {
          const content = await paaw.readFile("DECISIONS.md");
          if (onEvent) onEvent({ type: "tool_end", name, result: content ? `${content.length} chars` : "empty" });
          return content || "(No decisions recorded yet)";
        } catch {
          return "(No DECISIONS.md found)";
        }
      }

      case "project_standards": {
        const paaw = createPaawProject(cwd);
        if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
        if (args.name) {
          const content = await paaw.readStandard(args.name);
          if (onEvent) onEvent({ type: "tool_end", name, result: content ? `${content.length} chars` : "not found" });
          return content || `Standard '${args.name}' not found.`;
        }
        const standards = await paaw.listStandards();
        const list = standards.map(s => `- ${s.name} (${s.size} bytes)`).join("\n");
        if (onEvent) onEvent({ type: "tool_end", name, result: `${standards.length} standards` });
        return `Available standards:\n${list || "(none)"}`;
      }

      case "project_changelog": {
        const paaw = createPaawProject(cwd);
        if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
        try {
          const content = await paaw.readFile("CHANGELOG.md");
          if (onEvent) onEvent({ type: "tool_end", name, result: content ? `${content.length} chars` : "empty" });
          return content || "(No changelog yet)";
        } catch {
          return "(No CHANGELOG.md found)";
        }
      }

      case "project_issues": {
        const issuesFile = join(cwd, ".paaw", "issues", "ISSUES.json");
        if (!existsSync(issuesFile)) return "(No issues tracking initialized)";
        try {
          const data = JSON.parse(readSync(issuesFile, "utf-8"));
          let issues = data.issues || [];
          if (args.status) {
            const statuses = args.status.split(",").map(s => s.trim());
            issues = issues.filter(i => statuses.includes(i.status));
          }
          if (args.priority) {
            const priorities = args.priority.split(",").map(p => p.trim());
            issues = issues.filter(i => priorities.includes(i.priority));
          }
          if (onEvent) onEvent({ type: "tool_end", name, result: `${issues.length} issues` });
          if (issues.length === 0) return "(No matching issues found)";
          const summary = issues.map(i => `[${i.id}] ${i.status} | ${i.priority} | ${i.title}${i.labels?.length ? ` [${i.labels.join(",")}]` : ""}`).join("\n");
          return `Issues (${issues.length}):
${summary}`;
        } catch (err) {
          return `Error reading issues: ${err.message}`;
        }
      }

      case "project_sessions": {
        const paaw = createPaawProject(cwd);
        if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
        const sessions = await paaw.listSessions();
        const limit = args.limit || 5;
        const recent = sessions.slice(0, limit);
        const list = recent.map(s => `- ${s.filename || s.name} (${s.date || "unknown"})`).join("\n");
        if (onEvent) onEvent({ type: "tool_end", name, result: `${recent.length} sessions` });
        return `Recent sessions (${recent.length} of ${sessions.length}):
${list || "(none)"}`;
      }

      case "project_features": {
        const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
        if (!existsSync(featuresFile)) return "(No features registered yet. Use the Feature Map tab in Coding IDE to create features.)";
        try {
          const data = JSON.parse(readSync(featuresFile, "utf-8"));
          let features = data.features || [];
          if (args.search) {
            const s = args.search.toLowerCase();
            features = features.filter(f =>
              f.name?.toLowerCase().includes(s) ||
              f.description?.toLowerCase().includes(s)
            );
          }
          if (onEvent) onEvent({ type: "tool_end", name, result: `${features.length} features` });
          if (features.length === 0) return "(No matching features found)";
          const list = features.map(f => {
            const parts = [`[${f.id}] ${f.name} (${f.status})`];
            if (f.description) parts.push(`  ${f.description}`);
            if (f.codeFiles?.length) parts.push(`  Code: ${f.codeFiles.join(", ")}`);
            if (f.apis?.length) parts.push(`  API: ${f.apis.map(a => `${a.method} ${a.path}`).join(", ")}`);
            if (f.tests?.length) parts.push(`  Tests: ${f.tests.join(", ")}`);
            if (f.issues?.length) parts.push(`  Issues: ${f.issues.join(", ")}`);
            if (f.aiUnderstanding) parts.push(`  AI Understanding: ✅ (${f.aiUnderstandingAt})`);
            if (f.documentation) parts.push(`  Docs: ✅ (${f.docsUpdatedAt})`);
            return parts.join("\n");
          }).join("\n\n");
          return `Features (${features.length}):\n\n${list}`;
        } catch (err) {
          return `Error reading features: ${err.message}`;
        }
      }

      case "project_feature_detail": {
        const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
        if (!existsSync(featuresFile)) return "(No features registered)";
        try {
          const data = JSON.parse(readSync(featuresFile, "utf-8"));
          const feature = (data.features || []).find(f => f.id === args.id);
          if (!feature) return `Feature ${args.id} not found`;
          if (onEvent) onEvent({ type: "tool_end", name, result: feature.name });
          const parts = [
            `# Feature: ${feature.name} (${feature.id})`,
            `Status: ${feature.status}`,
            ``,
            `## Description`,
            feature.description || "(no description)",
          ];
          if (feature.codeFiles?.length) {
            parts.push(``, `## Code Files`, feature.codeFiles.map(f => `- ${f}`).join("\n"));
          }
          if (feature.apis?.length) {
            parts.push(``, `## API Endpoints`, feature.apis.map(a => `- ${a.method} ${a.path} (${a.file})`).join("\n"));
          }
          if (feature.tests?.length) {
            parts.push(``, `## Tests`, feature.tests.map(f => `- ${f}`).join("\n"));
          }
          if (feature.runbooks?.length) {
            parts.push(``, `## Runbooks`, feature.runbooks.map(f => `- ${f}`).join("\n"));
          }
          if (feature.issues?.length) {
            parts.push(``, `## Linked Issues`, feature.issues.join(", "));
          }
          if (feature.aiUnderstanding) {
            parts.push(``, `## AI Understanding`, `*Generated: ${feature.aiUnderstandingAt}*`, feature.aiUnderstanding);
          }
          if (feature.documentation) {
            parts.push(``, `## Documentation`, `*Updated: ${feature.docsUpdatedAt}*`, feature.documentation);
          }
          return parts.join("\n");
        } catch (err) {
          return `Error: ${err.message}`;
        }
      }

      case "project_feature_update_docs": {
        const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
        if (!existsSync(featuresFile)) return "⚠️ No features registered.";
        try {
          const data = JSON.parse(readSync(featuresFile, "utf-8"));
          const features = data.features || [];
          const idx = features.findIndex(f => f.id === args.id);
          if (idx < 0) return `Feature ${args.id} not found`;
          features[idx].documentation = args.documentation;
          features[idx].docsUpdatedAt = new Date().toISOString();
          features[idx].updatedAt = new Date().toISOString();
          await writeFile(featuresFile, JSON.stringify({ features, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
          if (onEvent) onEvent({ type: "tool_end", name, result: `updated ${args.id}` });
          return `✅ Documentation updated for feature ${features[idx].name} (${args.id})`;
        } catch (err) {
          return `Error updating docs: ${err.message}`;
        }
      }

      case "project_feature_update_mapping": {
        const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
        if (!existsSync(featuresFile)) return "⚠️ No features registered.";
        try {
          const data = JSON.parse(readSync(featuresFile, "utf-8"));
          const features = data.features || [];
          const idx = features.findIndex(f => f.id === args.id);
          if (idx < 0) return `Feature ${args.id} not found`;
          const changes = [];
          if (args.codeFiles) { features[idx].codeFiles = args.codeFiles; changes.push("codeFiles"); }
          if (args.apis) { features[idx].apis = args.apis; changes.push("apis"); }
          if (args.tests) { features[idx].tests = args.tests; changes.push("tests"); }
          if (args.runbooks) { features[idx].runbooks = args.runbooks; changes.push("runbooks"); }
          features[idx].updatedAt = new Date().toISOString();
          await writeFile(featuresFile, JSON.stringify({ features, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
          if (onEvent) onEvent({ type: "tool_end", name, result: `updated ${args.id}: ${changes.join(", ")}` });
          return `✅ Mapping updated for ${features[idx].name} (${args.id}): ${changes.join(", ")}`;
        } catch (err) {
          return `Error updating mapping: ${err.message}`;
        }
      }

      // ══════════════════════════════════════════
      // ── Test / Security / Change Intelligence ──
      // ══════════════════════════════════════════

      case "project_test_map": {
        const tiFile = join(cwd, ".paaw", "code-intelligence", "test-intelligence.json");
        if (!existsSync(tiFile)) {
          if (onEvent) onEvent({ type: "tool_end", name, result: "not found" });
          return "⚠️ Test Intelligence not found. Run Code Understanding → Test Intelligence step first.";
        }
        try {
          const ti = JSON.parse(readSync(tiFile, "utf-8"));
          if (args.file) {
            const norm = args.file.replace(/\\\\/g, "/");
            const entry = ti.codeToTest?.[norm];
            if (!entry || entry.length === 0) {
              if (onEvent) onEvent({ type: "tool_end", name, result: "no tests" });
              return `No tests found covering \`${norm}\`. This file has NO test coverage — consider adding tests.`;
            }
            const lines = entry.map(t => `  - ${t.testFile} (${t.testType})${t.testedFunctions?.length ? " — covers: " + t.testedFunctions.join(", ") : ""}`);
            if (onEvent) onEvent({ type: "tool_end", name, result: `${entry.length} tests` });
            return `Tests covering \`${norm}\`:\n${lines.join("\n")}`;
          }
          if (args.feature) {
            const ft = ti.featureToTests?.find(f => f.featureId === args.feature);
            if (!ft) {
              if (onEvent) onEvent({ type: "tool_end", name, result: "no tests" });
              return `No tests found for feature ${args.feature}.`;
            }
            if (onEvent) onEvent({ type: "tool_end", name, result: `${ft.tests.length} tests` });
            return `Tests for ${ft.featureName} (${ft.featureId}):\n${ft.tests.map(t => `  - ${t}`).join("\n")}`;
          }
          // Overall stats
          const s = ti.stats;
          if (onEvent) onEvent({ type: "tool_end", name, result: `${s.totalTestFiles} tests` });
          return `Test Intelligence Summary:\n- Total test files: ${s.totalTestFiles}\n- Unit: ${s.byType.unit}, Integration: ${s.byType.integration}, E2E: ${s.byType.e2e}\n- Test→Code mappings: ${s.totalMappings}\n- Coverage rate: ${s.coverageRate}\n- Files without tests: ${s.coverageGapFiles}\n- Features with tests: ${s.featureTestCoverage}`;
        } catch (err) {
          return `Error reading test intelligence: ${err.message}`;
        }
      }

      case "project_security": {
        const secFile = join(cwd, ".paaw", "security", "scan-results.json");
        if (!existsSync(secFile)) {
          if (onEvent) onEvent({ type: "tool_end", name, result: "not found" });
          return "⚠️ Security scan results not found. Run Code Understanding → Security Scan step first.";
        }
        try {
          const sec = JSON.parse(readSync(secFile, "utf-8"));
          let findings = sec.findings || [];
          if (args.severity) findings = findings.filter(f => f.severity === args.severity);
          if (args.file) {
            const norm = args.file.replace(/\\\\/g, "/");
            findings = findings.filter(f => f.file?.replace(/\\\\/g, "/").includes(norm));
          }
          if (findings.length === 0) {
            if (onEvent) onEvent({ type: "tool_end", name, result: "clean" });
            return args.file || args.severity
              ? `No ${args.severity || ""} findings${args.file ? ` for \`${args.file}\`` : ""}. ✅ Clean!`
              : "No security findings. ✅ All clean!";
          }
          const lines = findings.map(f => `- [${f.severity.toUpperCase()}] ${f.file}:${f.line || "?"} — ${f.message}\n  CWE: ${f.cwe || "N/A"} | Fix: ${f.fix || "See references"}`);
          if (onEvent) onEvent({ type: "tool_end", name, result: `${findings.length} findings` });
          return `Security Findings (${findings.length}):\n${lines.join("\n")}`;
        } catch (err) {
          return `Error reading security results: ${err.message}`;
        }
      }

      case "project_recent_changes": {
        const ciFile = join(cwd, ".paaw", "changes", "change-intelligence.json");
        if (!existsSync(ciFile)) {
          // Try to build on-the-fly
          try {
            const { buildChangeIntelligence } = await import("./change-intelligence.mjs");
            const days = args.days || 30;
            await buildChangeIntelligence(cwd, { days, maxCommits: 50 });
          } catch {
            if (onEvent) onEvent({ type: "tool_end", name, result: "not found" });
            return "⚠️ Change Intelligence not available. Ensure this is a git repository.";
          }
        }
        try {
          const ci = JSON.parse(readSync(ciFile, "utf-8"));
          if (args.file) {
            const norm = args.file.replace(/\\\\/g, "/");
            const impact = ci.impactAnalysis?.find(i => i.changedFile === norm || i.changedFile?.includes(norm));
            if (!impact) {
              if (onEvent) onEvent({ type: "tool_end", name, result: "no impact data" });
              return `No impact data for \`${norm}\`. It may not have been recently changed, or no other files depend on it.`;
            }
            if (onEvent) onEvent({ type: "tool_end", name, result: `${impact.affectedFiles.length} affected` });
            return `Impact of changing \`${norm}\` (impact: ${impact.impactLevel}):\nAffected files (${impact.affectedFiles.length}):\n${impact.affectedFiles.map(f => `  - ${f}`).join("\n")}`;
          }
          const s = ci.summary;
          const topFiles = ci.recentFiles?.slice(0, 10).map(f => `  - ${f.file} (${f.changeCount}x, last: ${f.lastChanged.slice(0,10)})`).join("\n") || "";
          const topFeatures = ci.recentFeatures?.slice(0, 5).map(f => `  - ${f.name} (${f.changeCount} changes)`).join("\n") || "";
          const changedApis = ci.recentApis?.slice(0, 10).map(a => `  - ${a.method} ${a.path} (${a.file})`).join("\n") || "";
          if (onEvent) onEvent({ type: "tool_end", name, result: `${s.totalCommits} commits` });
          return `Recent Changes (${s.period}):
- ${s.totalCommits} commits, ${s.totalFilesChanged} files changed
- ${s.totalFeaturesChanged} features changed, ${s.totalApisChanged} APIs changed
- ${s.highImpactChanges} high-impact changes

Top Changed Files:
${topFiles}

Recently Changed Features:
${topFeatures}

Recently Changed APIs:
${changedApis}`;
        } catch (err) {
          return `Error reading change intelligence: ${err.message}`;
        }
      }

      // ══════════════════════════════════════════
      // ── Project Knowledge Write Tools ──
      // ══════════════════════════════════════════

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

      // ── Action Log Tools ──
      case "action_log_add": {
        const { addActionLog } = await import("./action-log.mjs");
        const entry = { ...args, agent: args._agentId || rootDir?.split("/").pop() || "agent" };
        const record = await addActionLog(entry, cwd);
        if (onEvent) onEvent({ type: "tool_end", name, result: record.summary });
        return `✅ Action logged: ${record.agent}/${record.action}: ${record.summary}`;
      }

      case "action_log_list": {
        const { listActionLog } = await import("./action-log.mjs");
        const { entries, text } = await listActionLog({ cwd, agent: args.agent, limit: args.limit || 15 });
        if (onEvent) onEvent({ type: "tool_end", name, result: `${entries.length} entries` });
        return text || "(No action log entries yet)";
      }

      // ── Agent Memory Tools ──
      case "agent_memory_save": {
        const { saveAgentMemory } = await import("./action-log.mjs");
        const agentId = args._agentId || rootDir?.split("/").pop() || "agent";
        await saveAgentMemory(agentId, args.content, cwd);
        if (onEvent) onEvent({ type: "tool_end", name, result: `${agentId}.md` });
        return `✅ Memory saved for ${agentId}`;
      }

      case "agent_memory_load": {
        const { loadAgentMemory } = await import("./action-log.mjs");
        const agentId = args._agentId || rootDir?.split("/").pop() || "agent";
        const content = await loadAgentMemory(agentId, cwd);
        if (onEvent) onEvent({ type: "tool_end", name, result: content ? `${content.length} chars` : "empty" });
        return content || "(No saved memory yet)";
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

export async function callLLM(apiUrl, headers, model, messages, tools, stream = false, onEvent = null) {
  console.log(`[callLLM] model=${model}, stream=${stream}, apiUrl=${apiUrl}, messages=${messages.length}`);
  const body = {
    model,
    messages,
    tools,
    tool_choice: "auto",
    max_tokens: 8192,
    stream,
  };

  // ── LLM Request Logging ──
  try {
    const { appendFile: af } = await import("fs/promises");
    const { join: j } = await import("path");
    const logDir = j(cwd, ".paaw", "coding-memory");
    const { mkdirSync: ms } = await import("fs");
    ms(logDir, { recursive: true });
    const logPath = j(logDir, "llm-log.jsonl");
    const logEntry = {
      ts: new Date().toISOString(),
      agentId: agentId || "unknown",
      model: body.model,
      stream,
      messageCount: body.messages?.length,
      messagesPreview: body.messages?.map(m => ({ role: m.role, len: m.content?.length || 0, preview: (m.content || "").slice(0, 200) })),
      toolsCount: body.tools?.length,
      toolNames: body.tools?.map(t => t.function?.name),
    };
    await af(logPath, JSON.stringify(logEntry, null, 2) + "\n---\n");
  } catch (_logErr) {}

  if (stream) {
    // 串流模式：用 fetchStreamWithRetry 取得連線，回傳 raw response
    const { fetchStreamWithRetry } = await import("./llm-utils.mjs");
    const resp = await fetchStreamWithRetry(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, { timeoutMs: 90_000, maxRetries: 2, onRetry: (info) => {
      if (onEvent) onEvent("info", { message: `⏳ API 暫時不可用 (HTTP ${info.status}), ${info.delayMs / 1000}s 後重試...` });
    } });

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
    onRetry: (info) => {
      if (onEvent) onEvent("info", { message: `⏳ API 暫時不可用 (HTTP ${info.status}), ${info.delayMs / 1000}s 後重試...` });
    },
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
  parts.push(`\n## Your Tools\n### Project Knowledge (use these FIRST, not read_file for .paaw/ files)\n- **project_context** — Get PROJECT.md, ARCHITECTURE.md, STATUS.md, CODING-STANDARDS.md\n- **project_decisions** — Read ADRs from DECISIONS.md\n- **project_standards** — List/read coding standards\n- **project_changelog** — Read recent changes\n- **project_issues** — List/filter project issues (bugs, tasks)\n- **project_sessions** — List recent coding sessions\n- **project_features** — List all features (summary auto-injected in system prompt)\n- **project_feature_detail** — Get full detail of one feature\n- **project_feature_update_docs** — Update a feature's documentation\n- **project_feature_update_mapping** — Update feature mapping after code changes (REQUIRED when files change)\n### Intelligence (use before making changes)\n- **project_test_map** — Check which tests cover a file, or what to run when you change something. Use BEFORE code changes.\n- **project_security** — Check known security findings (Semgrep). Use before security-sensitive changes.\n- **project_recent_changes** — See what was recently changed and impact analysis. Use FIRST when picking up a task.\n### File Operations\n- **read_file** — Read source files (NOT for .paaw/ — use project_* tools)\n- **write_file** — Write or create files\n- **edit_file** — Precise text replacement\n- **glob** — Find files by pattern\n- **grep** — Search file contents\n### Git & Shell\n- **diff** — Show differences\n- **git** — Run git commands\n- **bash** — Run shell commands\n### Project Write\n- **record_decision** — Record ADR to DECISIONS.md\n- **update_changelog** — Add changelog entry\n- **update_docs** — Update .paaw/ docs\n### Agent Collaboration\n- **action_log_add** — Record your action for other agents\n- **action_log_list** — Read what other agents did\n- **agent_memory_save** — Save to your long-term memory\n- **agent_memory_load** — Read your long-term memory\n### Other\n- **ask_user** — Ask for clarification`);

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
    agentId = null,
  } = config;

  // Load agent config for defaults (with fallback)
  let agentCfg = { ..._agentCfgDefaults };
  try {
    const { loadAgentConfig } = await import("../routes/context.mjs");
    agentCfg = await loadAgentConfig(); setAgentConfig(agentCfg);
  } catch {}

  const effectiveMaxTurns = maxTurns ?? agentCfg.maxTurns;
  const effectiveTimeout = timeout ?? agentCfg.timeoutSeconds;

  const startTime = Date.now();
  const timeoutMs = effectiveTimeout * 1000;
  const toolCallLog = [];
  let snapshotTaken = false; // auto-snapshot before first file write

  // Resolve LLM config
  const llm = resolveLLMConfig(rootDir, modelOverride);

  if (onEvent) onEvent({ type: "start", model: llm.model, cwd, maxTurns: effectiveMaxTurns });

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

  // Allow pre-built messages (for A2A conversation history injection)
  const messages = config.messages || [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  let finalContent = "";
  let turns = 0;
  let emptyRetryCount = 0;

  for (let i = 0; i < maxTurns; i++) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      finalContent += `\n\n---\n⏱️ 任務超時 (${effectiveTimeout}s)，但已完成 ${turns} 個步驟。\n已修改的檔案已保存。\n你可以跟我說「繼續」來接著完成。\n---`;
      // Save progress so we can resume
      try {
        const paaw2 = createPaawProject(cwd);
        if (paaw2.exists) {
          await paaw2.addActionLog({
            agent: agentId || "unknown",
            action: "timeout",
            summary: `任務超時，已完成 ${turns}/${effectiveMaxTurns} 步。已部分完成，可續接。`,
            result: "partial",
          });
        }
      } catch {}
      if (onEvent) onEvent({ type: "timeout", turns, maxTurns: effectiveMaxTurns });
      break;
    }

    turns++;

    if (onEvent) onEvent({ type: "turn_start", turn: i + 1 });

    // Call LLM
    let response;
    try {
      response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, PAAW_TOOLS, false, (evt, data) => {
        if (onEvent) onEvent({ type: evt, ...data });
      });
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
      // 防禦：如果 content 是空的或只有隱藏字元，重試一次
      if (!isMeaningfulContent(content)) {
        if (emptyRetryCount < 1) {
          emptyRetryCount++;
          console.warn(`[Agent Loop] LLM returned empty/whitespace response, retrying... (attempt ${emptyRetryCount})`);
          if (onEvent) onEvent({ type: "info", message: "⚠️ AI 回應為空，重新呼叫中..." });
          // 移除剛加的 assistant message
          messages.pop();
          i--; // retry same turn
          continue;
        }
        finalContent = "[LLM 回應為空或僅含隱藏字元，重試後仍失敗]";
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
      const toolResult = await executeTool(call, cwd, rootDir, onEvent, agentId);
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
      // Auto-generate changelog if there were file changes
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
    agentId = null,
  } = config;

  let agentCfg = { ..._agentCfgDefaults };
  try {
    const { loadAgentConfig } = await import("../routes/context.mjs");
    agentCfg = await loadAgentConfig(); setAgentConfig(agentCfg);
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

  // Build system prompt (load .paaw/ project context first)
  let paawContext = null;
  try {
    const paaw = createPaawProject(cwd);
    if (paaw.exists) {
      paawContext = await paaw.loadContextText();
    }
  } catch {}
  const systemPrompt = buildSystemPrompt({ cwd, skillMd, customPrompt, params, paawContext });
  // Allow pre-built messages (for conversation history injection)
  // If provided, use them directly; otherwise build from prompt + systemPrompt
  const messages = config.messages || [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  let turns = 0;
  let contentEmitted = false;
  let streamEmptyRetryCount = 0;

  for (let i = 0; i < maxTurns; i++) {
    if (Date.now() - startTime > timeoutMs) {
      sendSSE("error", { error: "Agent loop timed out" });
      break;
    }

    turns++;
    sendSSE("turn", { turn: i + 1 });

    // Call LLM with fallback chain on 429/rate-limit
    let response;
    let usedLlm = llm;
    try {
      response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, PAAW_TOOLS, false, sendSSE);
    } catch (err) {
      const is429 = err.message && (err.message.includes("429") || err.message.includes("overloaded") || err.message.includes("rate"));
      if (is429 && llm.fallbacks && llm.fallbacks.length > 0) {
        for (const fb of llm.fallbacks) {
          console.log(`[callLLM] 429 rate-limited, trying fallback: ${fb.providerId}/${fb.model}`);
          sendSSE("info", { message: `⏳ ${llm.providerId} 限流，切換到 ${fb.providerId}/${fb.model}` });
          try {
            response = await callLLM(fb.apiUrl, fb.headers, fb.model, messages, PAAW_TOOLS, false, sendSSE);
            usedLlm = fb;
            break;
          } catch (fbErr) {
            console.log(`[callLLM] fallback ${fb.providerId} also failed:`, fbErr.message);
            continue;
          }
        }
        if (!response) {
          sendSSE("error", { error: `All providers failed: ${err.message}` });
          break;
        }
      } else {
        sendSSE("error", { error: err.message });
        break;
      }
    }

    const choice = response.choices?.[0];
    if (!choice) { sendSSE("error", { error: "Empty LLM response" }); break; }

    const assistantMsg = choice.message;
    const content = sanitizeContent(assistantMsg.content || "");
    const toolCalls = assistantMsg.tool_calls;

    const historyMsg = { role: "assistant", content };
    if (toolCalls) historyMsg.tool_calls = toolCalls;
    messages.push(historyMsg);

    // Final text response — check for empty/whitespace, retry once
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop") {
      if (!isMeaningfulContent(content)) {
        if (streamEmptyRetryCount < 1) {
          streamEmptyRetryCount++;
          console.warn(`[Agent Loop Streaming] LLM returned empty/whitespace response, retrying... (attempt ${streamEmptyRetryCount})`);
          sendSSE("info", { message: "⚠️ AI 回應為空，重新呼叫中..." });
          messages.pop();
          i--;
          continue;
        }
        sendSSE("content", { content: "[AI 回應為空或僅含隱藏字元，重試後仍失敗]", done: true });
        contentEmitted = true;
        break;
      }
      sendSSE("content", { content, done: true });
      contentEmitted = true;
      break;
    }

    // Intermediate thinking
    if (content) sendSSE("thinking", { content });

    // Execute tools
    for (const call of toolCalls) {
      let args;
      try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
      sendSSE("tool", { name: call.function.name, args });

      const toolResult = await executeTool(call, cwd, rootDir, null, agentId);
      sendSSE("tool_result", { name: call.function.name, result: toolResult.slice(0, 2000) });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult,
      });
    }
  }

  // If we exhausted maxTurns without a final content response, force one
  if (!contentEmitted) {
    try {
      messages.push({
        role: "user",
        content: "你已經收集了足夠的資訊。現在請根據你看到的內容，直接給出完整的回答。不要使用任何工具。",
      });
      const finalResponse = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, [], false, sendSSE);
      const finalContent = finalResponse.choices?.[0]?.message?.content || "";
      if (finalContent) {
        sendSSE("content", { content: finalContent, done: true });
      }
    } catch (err) {
      sendSSE("error", { error: `Final summary failed: ${err.message}` });
    }
  }

  sendSSE("done", { turns, durationMs: Date.now() - startTime });
}
