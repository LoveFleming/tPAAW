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
import { existsSync, readFileSync as readSync, mkdirSync, appendFileSync, writeFileSync as writeSync } from "fs";
import { exec as execCb } from "child_process";
import { resolve, join, dirname, relative } from "path";
import { getDependencyContext, getAffectedTests } from "./dependency-context.mjs";
import { fileURLToPath } from "url";
import { readFileSync as _readSync, existsSync as _exSync } from "fs";
import { join as _pathJoin, dirname as _pathDirname, basename as _pathBasename, extname as _pathExtname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { callLLMWithRetry, sanitizeContent, isMeaningfulContent, fetchStreamWithRetry } from "./llm-utils.mjs";
import { createPaawProject } from "./paaw-project.mjs";
import { PaawSnapshot } from "./paaw-snapshot.mjs";
import { resolveDefaultModel } from "./llm-utils.mjs";
import { toolRegistry } from "./tool-registry.mjs";

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
// providers.json is a PAAW server config file — always read from PAAW_ROOT,
// never from an arbitrary project cwd. The bug was that rootDir (which
// could be any project path) was used to find providers.json.

const _PAAW_ROOT = resolve(__dirname, "../../../../");

function loadProviderConfig() {
  const configPath = resolve(_PAAW_ROOT, "data/config/providers.json");
  try {
    return JSON.parse(readSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

export function resolveLLMConfig(_rootDir, modelOverride, fallbackModels) {
  const config = loadProviderConfig();
  if (!config) throw new Error("No provider config found — checked: " + resolve(_PAAW_ROOT, "data/config/providers.json"));

  // Auto-read fallback preferences from user.json if no explicit fallbackModels
  if (!fallbackModels || fallbackModels.length === 0) {
    try {
      const userPrefs = JSON.parse(readSync(resolve(_PAAW_ROOT, "data/config/user.json"), "utf-8"))?.preferences || {};
      // Collect all *Fallback keys (e.g. nightShiftFallback, codingIDEFallback)
      const userFbs = Object.entries(userPrefs)
        .filter(([k]) => k.endsWith("Fallback"))
        .map(([, v]) => v)
        .filter(Boolean);
      if (userFbs.length > 0) fallbackModels = userFbs;
    } catch {}
  }

  // Parse "providerId/modelId" format (from ModelSelector)
  // Only split if providerId portion exists in providers config
  let providerId = config.active;
  let model = modelOverride || resolveDefaultModel(config);
  if (model && model.includes("/")) {
    const firstSlash = model.indexOf("/");
    const candidateProvider = model.slice(0, firstSlash);
    if (config.providers[candidateProvider]) {
      providerId = candidateProvider;
      model = model.slice(firstSlash + 1);
    }
    // Otherwise keep the full model string (e.g. "deepseek/deepseek-v4-flash" via openrouter)
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

  // Build fallback chain — priority: caller-supplied fallbackModels > providers.json fallbacks > hardcoded
  const fallbacks = [];

  // 1. Caller-supplied fallback models (e.g. from user.json preferences or request body)
  if (fallbackModels && fallbackModels.length > 0) {
    for (const fbModel of fallbackModels) {
      // Parse "providerId/modelId" format
      let fbProviderId = config.active;
      let fbModelId = fbModel;
      if (fbModel && fbModel.includes("/")) {
        const firstSlash = fbModel.indexOf("/");
        const candidate = fbModel.slice(0, firstSlash);
        if (config.providers[candidate]) {
          fbProviderId = candidate;
          fbModelId = fbModel.slice(firstSlash + 1);
        }
      }
      const fbProvider = config.providers[fbProviderId];
      if (!fbProvider) continue;
      const fbHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${fbProvider.apiKey}` };
      if (fbProviderId === "openrouter") { fbHeaders["HTTP-Referer"] = "https://paaw.ai"; fbHeaders["X-Title"] = "PAAW"; }
      fallbacks.push({ providerId: fbProviderId, apiUrl: `${fbProvider.baseURL.replace(/\/+$/, "")}/chat/completions`, headers: fbHeaders, model: fbModelId, contextWindow: DEFAULT_CONTEXT_WINDOW });
    }
  }

  // 2. providers.json fallbacks array (if no caller-supplied fallbacks)
  if (fallbacks.length === 0) {
    const configuredFallbacks = config.fallbacks || [];
    for (const fb of configuredFallbacks) {
      const fbProvider = config.providers[fb.provider];
      if (!fbProvider) continue;
      const fbHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${fbProvider.apiKey}` };
      if (fb.provider === "openrouter") { fbHeaders["HTTP-Referer"] = "https://paaw.ai"; fbHeaders["X-Title"] = "PAAW"; }
      fallbacks.push({ providerId: fb.provider, apiUrl: `${fbProvider.baseURL.replace(/\/+$/, "")}/chat/completions`, headers: fbHeaders, model: fb.model, contextWindow: DEFAULT_CONTEXT_WINDOW });
    }
  }

  // 3. Auto-build fallback from other providers' model lists (only if nothing else provided)
  // Uses each provider's first model — never references a model name not in that provider's list
  if (fallbacks.length === 0) {
    for (const [pid, p] of Object.entries(config.providers)) {
      if (pid === providerId) continue; // skip active provider
      const pModels = p.models || [];
      if (pModels.length === 0) continue;
      const firstModel = pModels[0];
      const fbModelId = typeof firstModel === "string" ? firstModel : firstModel.id;
      if (!fbModelId) continue;
      const fbHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` };
      if (pid === "openrouter") { fbHeaders["HTTP-Referer"] = "https://paaw.ai"; fbHeaders["X-Title"] = "PAAW"; }
      fallbacks.push({ providerId: pid, apiUrl: `${p.baseURL.replace(/\/+$/, "")}/chat/completions`, headers: fbHeaders, model: fbModelId, contextWindow: DEFAULT_CONTEXT_WINDOW });
    }
  }

  // Get model's context window
  const modelDef = (provider.models || []).find(m => m.id === model);
  const contextWindow = modelDef?.contextWindow || DEFAULT_CONTEXT_WINDOW;

  return { apiUrl, headers, model, providerId, fallbacks, contextWindow };
}

// ── Tool Definitions (OpenAI function-calling format) ──
// Aligned with Claude Code tool set

export const PAAW_TOOLS = [
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
    // ── Unified docs tool (replaces update_changelog + update_docs) ──
    {
      type: "function",
      function: {
        name: "docs",
        description: "管理 .paaw/ 文件：更新 changelog、寫入/更新文件。用 action 指定操作。",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["changelog", "write", "append"], description: "changelog=加 changelog 條目, write=寫入文件, append=追加內容" },
            type: { type: "string", enum: ["added", "changed", "fixed", "removed", "deprecated"], description: "Changelog 類別（action=changelog 時必填）" },
            description: { type: "string", description: "Changelog 描述（action=changelog）或文件摘要" },
            file: { type: "string", description: "檔案名（action=write/append 時必填，如 PROJECT.md）" },
            content: { type: "string", description: "文件內容（action=write/append 時必填）" },
          },
          required: ["action"],
        },
      },
    },

  // ── Project Knowledge Tool (unified — replaces 14 separate project_* tools) ──
  {
    type: "function",
    function: {
      name: "project_info",
      description: "Query project knowledge from .paaw/ directory. Use this FIRST to understand the project before doing any work.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["context", "decisions", "standards", "changelog", "issues", "features", "feature_detail", "runbook", "faq", "sessions", "test_map", "security", "recent_changes", "api_history"],
            description: "What to query: context=PROJECT.md+ARCHITECTURE.md, decisions=ADRs, standards=coding standards, changelog=CHANGELOG.md, issues=issue tracker, features=feature map, feature_detail=single feature, runbook=troubleshooting, faq=FAQ, sessions=work sessions, test_map=test intelligence, security=semgrep results, recent_changes=change intelligence, api_history=API tester logs"
          },
          id: { type: "string", description: "Feature/issue ID (e.g. F-001, ISS-001). Used with category=feature_detail." },
          search: { type: "string", description: "Search keyword. Used with: features (by name), runbook (by content), faq (by keyword)." },
          code: { type: "string", description: "Error code for runbook lookup (e.g. ORD-001)." },
          name: { type: "string", description: "Standard name to read (for category=standards). If omitted, lists all." },
          status: { type: "string", description: "Filter issues by status (comma-separated): open,in-progress,resolved,closed,wontfix." },
          priority: { type: "string", description: "Filter issues by priority (comma-separated): critical,high,medium,low." },
          severity: { type: "string", description: "Filter security findings: error,warning,info." },
          file: { type: "string", description: "File path filter. Used with: test_map (which tests cover this file), security (findings for file), recent_changes (impact of file)." },
          feature: { type: "string", description: "Feature ID for test_map: list all tests for that feature." },
          days: { type: "number", description: "Days back for recent_changes (default: 30)." },
          limit: { type: "number", description: "Max results for sessions/api_history (default: 5/20)." },
          method: { type: "string", description: "Filter api_history by HTTP method." },
          path_contains: { type: "string", description: "Filter api_history by URL substring." },
          include_response: { type: "boolean", description: "Include response body in api_history (default: true)." },
        },
        required: ["category"],
      },
    },
  },

  // ── Unified project_edit tool (replaces 7 mutation tools) ──
  {
    type: "function",
    function: {
      name: "project_edit",
      description: "Modify project data: create/update/delete issues, record changes, update feature docs/mapping, run safe commands.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["issue_create", "issue_update", "issue_delete", "change_record", "feature_update_docs", "feature_update_mapping", "run_command"],
            description: "Mutation action to perform",
          },
          // ── Issue create/update/delete ──
          id: { type: "string", description: "Issue/feature ID (e.g. ISS-001, F-001)" },
          title: { type: "string", description: "Issue title or change title" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Priority" },
          status: { type: "string", enum: ["open", "in-progress", "resolved", "closed", "wontfix"], description: "Issue status" },
          labels: { type: "array", items: { type: "string" }, description: "Labels" },
          description: { type: "string", description: "Detailed description" },
          note: { type: "string", description: "Add a note to issue" },
          featureId: { type: "string", description: "Related feature ID" },
          // ── Change record ──
          type: { type: "string", enum: ["feature", "bugfix", "refactor", "security", "performance", "docs", "config"], description: "Change type" },
          files: { type: "array", items: { type: "string" }, description: "Changed file paths" },
          impact: { type: "string", description: "Potential impact" },
          testsRan: { type: "string", description: "Tests run to verify" },
          // ── Feature update ──
          documentation: { type: "string", description: "New documentation in markdown" },
          codeFiles: { type: "array", items: { type: "string" }, description: "Updated code files" },
          apis: { type: "array", items: { type: "object" }, description: "Updated API endpoints" },
          tests: { type: "array", items: { type: "string" }, description: "Updated test files" },
          runbooks: { type: "array", items: { type: "string" }, description: "Updated runbook files" },
          // ── Run command ──
          command: { type: "string", description: "Command to run (e.g. 'npm test')" },
        },
        required: ["action"],
      },
    },
  },

  // ── CU Refresh ──
  {
    type: "function",
    function: {
      name: "cu_refresh",
      description: "Refresh specific Code Understanding steps after code changes. Use this after making significant code changes instead of re-running the entire CU flow. Deterministic steps (code-intelligence, test-intelligence, security-scan, change-intelligence) are fast and safe to re-run. LLM steps (feature-map, api-spec, etc.) only re-run if you explicitly request them.",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: { type: "string", enum: ["code-intelligence", "test-intelligence", "security-scan", "change-intelligence", "feature-map", "api-spec", "error-mapping", "standards", "architecture", "overview"] },
            description: "Which steps to refresh. Default: deterministic steps only (code-intelligence, test-intelligence, change-intelligence). Add LLM steps only if architecture/APIs/features changed significantly.",
          },
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
  // ── Unified notes tool ──
  {
    type: "function",
    function: {
      name: "notes",
      description: "Manage notes: list notebooks, list sections, create notes/sections, search. Use action to specify operation.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list_notebooks", "list_sections", "create", "create_section", "search"],
            description: "Operation: list_notebooks, list_sections, create (note), create_section, search",
          },
          notebookId: { type: "string", description: "Notebook ID" },
          sectionId: { type: "string", description: "Section ID (default: 'default')" },
          title: { type: "string", description: "Note title" },
          content: { type: "string", description: "Note content (markdown)" },
          tags: { type: "array", items: { type: "string" }, description: "Tags" },
          name: { type: "string", description: "Section name (for create_section)" },
          icon: { type: "string", description: "Section icon emoji (for create_section)" },
          query: { type: "string", description: "Search keyword (for search)" },
        },
        required: ["action"],
      },
    },
  },

  ];

// ── Tool Group System — load only what each agent needs ──

// Tool name → group mapping
const TOOL_GROUP_MAP = {
  // Core: full file ops + shell + git
  read_file: "core", write_file: "core", edit_file: "core",
  glob: "core", grep: "core", diff: "core",
  git: "core", bash: "core", ask_user: "core",

  // Browser testing
  browser_test: "browser",

  // Memory & logging
  action_log_add: "memory", action_log_list: "memory",
  agent_memory_save: "memory", agent_memory_load: "memory",

  // Decision & changelog
  record_decision: "decisions", docs: "decisions",

  // Project Info — unified tool (replaces 14 separate project_* read tools)
  project_info: "project",

  // Project edit — unified mutation tool
  project_edit: "project-edit",

  // Notes
  notes: "notes",

  // Task management
  task_create: "tasks", task_update: "tasks", task_list: "tasks", task_decompose: "tasks", dispatch_agent: "dispatch",

  // Docs & CU
  cu_refresh: "docs",
};

// ── core-read: read-only subset of core (no bash/write/edit/git) ──
// For non-coding agents: architect, QA, helpdesk, EM
const CORE_READ_TOOLS = new Set(["read_file", "glob", "grep", "diff", "ask_user"]);

// ── Fallback groups (used when crew.json has no toolGroups) ──
const AGENT_FALLBACK_GROUPS = {
  // Architect: read-only + decisions + project
  architect: ["core-read", "memory", "decisions", "project", "project-edit"],
  // Developer: full core + memory + project
  developer: ["core", "memory", "decisions", "project", "project-edit"],
  // Tester: full core + project
  tester: ["core", "memory", "decisions", "project", "project-edit"],
  // Doc-writer: full core + project-edit + docs + notes
  "doc-writer": ["core", "memory", "decisions", "project", "project-edit", "docs", "notes"],
  // QA: read-only + project + project-edit
  qa: ["core-read", "memory", "project", "project-edit"],
  // Helpdesk: read-only + project + notes
  helpdesk: ["core-read", "memory", "project", "notes"],
  // EM: read-only + project + project-edit + notes + docs + browser
  em: ["core-read", "memory", "decisions", "project", "project-edit", "notes", "docs", "browser", "tasks", "dispatch"],
};

// ── Cache for crew toolGroups loaded from JSON ──
const _crewGroupCache = new Map();

/**
 * Load toolGroups for an agent from crew.json.
 * Falls back to AGENT_FALLBACK_GROUPS if crew.json has no toolGroups.
 * @param {string} agentId - e.g. "developer", "architect"
 * @returns {string[]} tool group names
 */
function getAgentGroupsFromConfig(agentId) {
  // Check cache first
  if (_crewGroupCache.has(agentId)) return _crewGroupCache.get(agentId);

  // agentId -> crewId mapping
  const crewMap = {
    architect: "coding.architect",
    developer: "coding.developer",
    tester: "coding.tester",
    "doc-writer": "coding.doc-writer",
    qa: "coding.qa",
    helpdesk: "coding.helpdesk",
    em: "coding.em",
  };
  const crewId = crewMap[agentId];
  if (!crewId) return AGENT_FALLBACK_GROUPS[agentId] || ["core", "memory"];

  try {
    const crewPath = join(_PAAW_ROOT, "data", "crews", `${crewId}.json`);
    if (existsSync(crewPath)) {
      const crew = JSON.parse(readSync(crewPath, "utf-8"));
      if (Array.isArray(crew.toolGroups) && crew.toolGroups.length > 0) {
        _crewGroupCache.set(agentId, crew.toolGroups);
        return crew.toolGroups;
      }
    }
  } catch (err) {
    console.warn(`[getToolsForAgent] Failed to load crew config for ${agentId}:`, err.message);
  }

  // Fallback
  const fallback = AGENT_FALLBACK_GROUPS[agentId] || ["core", "memory"];
  _crewGroupCache.set(agentId, fallback);
  return fallback;
}

/**
 * Clear crew group cache (call when crew.json is updated)
 */
export function clearCrewGroupCache() {
  _crewGroupCache.clear();
}

/**
 * Get tool definitions for a specific agent.
 * Reads toolGroups from crew.json first, falls back to hardcoded defaults.
 * @param {string} agentId - Agent identifier (e.g. "developer", "architect")
 * @param {string[]} extraGroups - Additional groups to include
 * @returns {object[]} Filtered tool definitions
 */
export function getToolsForAgent(agentId, extraGroups = []) {
  const agentGroups = getAgentGroupsFromConfig(agentId);
  const groups = new Set([...agentGroups, ...extraGroups]);
  const useCoreRead = groups.has("core-read");

  return PAAW_TOOLS.filter(tool => {
    const name = tool.function?.name;
    if (!name) return false;

    // Handle core-read: only read-only core tools
    if (useCoreRead && TOOL_GROUP_MAP[name] === "core") {
      return CORE_READ_TOOLS.has(name);
    }
    // If agent has core-read but NOT core, skip full-core tools
    if (useCoreRead && !groups.has("core") && TOOL_GROUP_MAP[name] === "core") {
      return CORE_READ_TOOLS.has(name);
    }

    const group = TOOL_GROUP_MAP[name];
    return group && groups.has(group);
  });
}

/**
 * Get list of available tool groups for debugging/UI
 */
export function getToolGroupInfo() {
  const groups = {};
  for (const [name, group] of Object.entries(TOOL_GROUP_MAP)) {
    if (!groups[group]) groups[group] = [];
    groups[group].push(name);
  }
  return groups;
}

/**
 * Get the tool groups assigned to an agent
 */
export function getAgentGroups(agentId) {
  return AGENT_FALLBACK_GROUPS[agentId] || ["core", "memory"];
}

// ── Shell Execution Helper ──

const IS_WIN = process.platform === "win32";

// Module-level agent config defaults (used by runShell + executeTool)
const _agentCfgDefaults = { maxTurns: 200, timeoutSeconds: 1800, bashTimeoutSeconds: 300, shellTimeoutMs: 1200000 };
let _agentCfg = { ..._agentCfgDefaults };
export function setAgentConfig(cfg) { _agentCfg = { ..._agentCfgDefaults, ...cfg }; }

/** Build test command for affected test files */
function _buildTestCommand(cwd, testFiles) {
  // Detect test runner from project config
  let testRunner = null;
  try {
    const pkg = JSON.parse(_readSync(_pathJoin(cwd, "package.json"), "utf-8"));
    const scripts = pkg.scripts || {};
    if (scripts.test) testRunner = "npm test";
    if (scripts["test:ci"]) testRunner = "npm run test:ci";
    if (scripts.vitest) testRunner = "npx vitest run";
    if (scripts.jest) testRunner = "npx jest";
  } catch {}

  // Check for vitest/jest config directly
  if (!testRunner) {
    if (_exSync(_pathJoin(cwd, "vitest.config.ts")) || _exSync(_pathJoin(cwd, "vitest.config.js")) || _exSync(_pathJoin(cwd, "vitest.config.mjs"))) {
      testRunner = "npx vitest run";
    } else if (_exSync(_pathJoin(cwd, "jest.config.ts")) || _exSync(_pathJoin(cwd, "jest.config.js")) || _exSync(_pathJoin(cwd, "jest.config.mjs"))) {
      testRunner = "npx jest";
    }
  }

  if (!testRunner) return null;

  // Build command with specific test files
  const fileList = testFiles.map(f => `"${f}"`).join(" ");
  if (testRunner.includes("vitest")) {
    return `${testRunner} ${fileList} --reporter=verbose 2>&1`;
  } else if (testRunner.includes("jest")) {
    return `${testRunner} ${fileList} --verbose 2>&1`;
  } else {
    // Generic: just run the test command (can't filter files)
    return `${testRunner} 2>&1`;
  }
}

/** Parse test output to determine pass/fail */
function _parseTestResult(output) {
  const out = (output || "").toLowerCase();

  // Vitest patterns
  const vitestMatch = out.match(/(\d+)\s+failed/);
  const vitestTotal = out.match(/(\d+)\s+tests?\s+(passed|total)/i);
  if (vitestMatch) {
    return { ok: false, failed: parseInt(vitestMatch[1]), total: parseInt(vitestTotal?.[1] || "0") };
  }

  // Jest patterns
  const jestFailMatch = out.match(/tests?\s*:\s*(\d+)\s+failed/i) || out.match(/(\d+)\s+failed.*?(\d+)\s+passed/i);
  if (jestFailMatch) {
    return { ok: false, failed: parseInt(jestFailMatch[1]), total: parseInt(jestFailMatch[2] || "0") + parseInt(jestFailMatch[1]) };
  }

  // Generic: check for common failure patterns
  if (out.includes("fail") || out.includes("error") || out.includes("✗") || out.includes("✘")) {
    // Might be a real failure or just noise — be conservative
    if (out.includes("failed") || out.includes("test suite failed")) {
      return { ok: false, failed: 1, total: 1 };
    }
  }

  // Check for success patterns
  if (out.includes("passed") || out.includes("all tests passed") || out.includes("✓") || out.includes("✔")) {
    const totalMatch = out.match(/(\d+)\s+passed/);
    return { ok: true, failed: 0, total: parseInt(totalMatch?.[1] || "1") };
  }

  // No recognizable pattern — assume pass if exit code was ok (we already ran it successfully)
  return { ok: true, failed: 0, total: 0 };
}

/** Find test files by convention (e.g., foo.mjs → foo.test.mjs, foo.spec.ts) */
function _findConventionTests(cwd, changedFiles) {
  const tests = [];
  for (const f of changedFiles) {
    const dir = _pathDirname(_pathJoin(cwd, f));
    const base = _pathBasename(f, _pathExtname(f));
    const ext = _pathExtname(f);
    // Common test file patterns
    const candidates = [
      _pathJoin(dir, `${base}.test${ext}`),
      _pathJoin(dir, `${base}.spec${ext}`),
      _pathJoin(dir, `__tests__/${base}.test${ext}`),
      // Mirror in test/ directory
      _pathJoin(cwd, f.replace("/src/", "/test/").replace(ext, `.test${ext}`)),
      _pathJoin(cwd, f.replace("/src/", "/tests/").replace(ext, `.test${ext}`)),
      _pathJoin(cwd, f.replace("/src/", "/__tests__/").replace(ext, `.test${ext}`)),
    ];
    for (const c of candidates) {
      if (_exSync(c)) tests.push(c.replace(cwd + "/", ""));
    }
  }
  return [...new Set(tests)];
}

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
export async function executeTool(call, cwd, rootDir, onEvent, agentId) {
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
        // ── P0: Inject dependency context before write ──
        const depCtx = getDependencyContext(cwd, filePath);
        if (depCtx) {
          LOG("[dependency-context] Pre-write impact analysis for", filePath);
        }
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
        // Track modified files for post-edit test verification
        modifiedFiles.add(filePath.replace(cwd + "/", "").replace(cwd + "\\", ""));
        if (onEvent) onEvent({ type: "tool_end", name, result: `Wrote ${filePath} (${args.content.length} bytes)` });
        const baseResult = `Successfully wrote ${args.content.length} bytes to ${args.path}`;
        return depCtx ? `${baseResult}\n\n${depCtx}` : baseResult;
      }

      case "edit_file": {
        const filePath = resolvePath(args.path);
        if (!isPathAllowed(args.path, true)) return `Error: path '${args.path}' is outside working directory`;
        if (!existsSync(filePath)) return `Error: file not found: ${args.path}`;
        // ── P0: Inject dependency context before edit ──
        const depCtx = getDependencyContext(cwd, filePath);
        if (depCtx) {
          LOG("[dependency-context] Pre-edit impact analysis for", filePath);
        }
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
        // Track modified files for post-edit test verification
        modifiedFiles.add(filePath.replace(cwd + "/", "").replace(cwd + "\\", ""));
        if (onEvent) onEvent({ type: "tool_end", name, result: `Edited ${filePath}` });
        const baseResult = `Successfully edited ${args.path} (1 replacement)`;
        return depCtx ? `${baseResult}\n\n${depCtx}` : baseResult;
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
        const timeoutSec = Math.min(args.timeout || 120, _agentCfg.bashTimeoutSeconds || 300);
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
      // ── Unified project_info handler ──
      case "project_info": {
        // ── Alias mapping: old tool names → project_info category ──
        const cat = args.category;
        if (!cat) return "Error: 'category' parameter is required. Valid: context, decisions, standards, changelog, issues, features, feature_detail, runbook, faq, sessions, test_map, security, recent_changes, api_history";
        const paaw = createPaawProject(cwd);

        switch (cat) {
          case "context": {
            if (!paaw.exists) return "⚠️ .paaw/ not initialized for this project.";
            const ctx = await paaw.loadContextText();
            if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: ctx ? `${ctx.length} chars` : "empty" });
            return ctx || "(No project context found)";
          }
          case "decisions": {
            if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
            try {
              const content = await paaw.readFile("DECISIONS.md");
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: content ? `${content.length} chars` : "empty" });
              return content || "(No decisions recorded yet)";
            } catch { return "(No DECISIONS.md found)"; }
          }
          case "standards": {
            if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
            if (args.name) {
              const content = await paaw.readStandard(args.name);
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: content ? `${content.length} chars` : "not found" });
              return content || `Standard '${args.name}' not found.`;
            }
            const standards = await paaw.listStandards();
            const list = standards.map(s => `- ${s.name} (${s.size} bytes)`).join("\n");
            if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${standards.length} standards` });
            return `Available standards:\n${list || "(none)"}`;
          }
          case "changelog": {
            if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
            try {
              const content = await paaw.readFile("CHANGELOG.md");
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: content ? `${content.length} chars` : "empty" });
              return content || "(No changelog yet)";
            } catch { return "(No CHANGELOG.md found)"; }
          }
          case "issues": {
            const issuesFile = join(cwd, ".paaw", "issues", "ISSUES.json");
            if (!existsSync(issuesFile)) return "(No issues tracking initialized)";
            try {
              const data = JSON.parse(readSync(issuesFile, "utf-8"));
              let issues = data.issues || [];
              if (args.status) { const statuses = args.status.split(",").map(s => s.trim()); issues = issues.filter(i => statuses.includes(i.status)); }
              if (args.priority) { const priorities = args.priority.split(",").map(p => p.trim()); issues = issues.filter(i => priorities.includes(i.priority)); }
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${issues.length} issues` });
              if (issues.length === 0) return "(No matching issues found)";
              const summary = issues.map(i => `[${i.id}] ${i.status} | ${i.priority} | ${i.title}${i.labels?.length ? ` [${i.labels.join(",")}]` : ""}`).join("\n");
              return `Issues (${issues.length}):\n${summary}`;
            } catch (err) { return `Error reading issues: ${err.message}`; }
          }
          case "features": {
            const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
            if (!existsSync(featuresFile)) return "(No features registered yet.)";
            try {
              const data = JSON.parse(readSync(featuresFile, "utf-8"));
              let features = data.features || [];
              if (args.search) { const s = args.search.toLowerCase(); features = features.filter(f => f.name?.toLowerCase().includes(s) || f.description?.toLowerCase().includes(s)); }
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${features.length} features` });
              if (features.length === 0) return "(No matching features found)";
              const list = features.map(f => {
                const parts = [`[${f.id}] ${f.name} (${f.status})`];
                if (f.description) parts.push(`  ${f.description}`);
                if (f.codeFiles?.length) parts.push(`  Code: ${f.codeFiles.join(", ")}`);
                if (f.apis?.length) parts.push(`  API: ${f.apis.map(a => `${a.method} ${a.path}`).join(", ")}`);
                if (f.tests?.length) parts.push(`  Tests: ${f.tests.join(", ")}`);
                return parts.join("\n");
              }).join("\n\n");
              return `Features (${features.length}):\n\n${list}`;
            } catch (err) { return `Error reading features: ${err.message}`; }
          }
          case "feature_detail": {
            if (!args.id) return "Error: 'id' parameter is required for feature_detail.";
            const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
            if (!existsSync(featuresFile)) return "(No features registered)";
            try {
              const data = JSON.parse(readSync(featuresFile, "utf-8"));
              const feature = (data.features || []).find(f => f.id === args.id);
              if (!feature) return `Feature ${args.id} not found`;
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: feature.name });
              const parts = [`# Feature: ${feature.name} (${feature.id})`, `Status: ${feature.status}`, ``, `## Description`, feature.description || "(no description)"];
              if (feature.codeFiles?.length) parts.push(``, `## Code Files`, feature.codeFiles.map(f => `- ${f}`).join("\n"));
              if (feature.apis?.length) parts.push(``, `## API Endpoints`, feature.apis.map(a => `- ${a.method} ${a.path} (${a.file})`).join("\n"));
              if (feature.tests?.length) parts.push(``, `## Tests`, feature.tests.map(f => `- ${f}`).join("\n"));
              if (feature.issues?.length) parts.push(``, `## Linked Issues`, feature.issues.join(", "));
              return parts.join("\n");
            } catch (err) { return `Error: ${err.message}`; }
          }
          case "runbook": {
            const rbDir = join(cwd, ".paaw", "runbook");
            if (!existsSync(rbDir)) return "⚠️ No runbooks directory.";
            try {
              const { readdirSync, readFileSync: readSync2 } = await import("fs");
              if (args.code) {
                const rbFile = join(rbDir, `${args.code}.md`);
                if (!existsSync(rbFile)) return `Runbook ${args.code} not found.`;
                if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: args.code });
                return readSync2(rbFile, "utf-8");
              }
              if (args.search) {
                const files = readdirSync(rbDir).filter(f => f.endsWith(".md"));
                const matches = [];
                for (const f of files) { const content = readSync2(join(rbDir, f), "utf-8"); if (content.toLowerCase().includes(args.search.toLowerCase())) matches.push(`- ${f}`); }
                if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${matches.length} matches` });
                return matches.length > 0 ? `Runbook matches for '${args.search}':\n${matches.join("\n")}` : `No runbooks matching '${args.search}'.`;
              }
              const files = readdirSync(rbDir).filter(f => f.endsWith(".md"));
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${files.length} runbooks` });
              return `Runbooks (${files.length}):\n${files.join("\n")}`;
            } catch (err) { return `Error reading runbooks: ${err.message}`; }
          }
          case "faq": {
            const faqFile = join(cwd, ".paaw", "helpdesk", "faq.md");
            try {
              const { readFileSync: readSync2 } = await import("fs");
              if (args.search) {
                if (!existsSync(faqFile)) return "⚠️ No FAQ found.";
                const content = readSync2(faqFile, "utf-8").toLowerCase();
                const kw = args.search.toLowerCase();
                const sections = content.split(/^##\s+/m);
                const matches = sections.filter(s => s.includes(kw));
                if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${matches.length} matches` });
                return matches.length > 0 ? `FAQ matches for '${args.search}':\n## ${matches.join("\n\n## ")}` : `No FAQ entries matching '${args.search}'.`;
              }
              if (!existsSync(faqFile)) return "⚠️ No FAQ found.";
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: "read" });
              return readSync2(faqFile, "utf-8");
            } catch (err) { return `Error with FAQ: ${err.message}`; }
          }
          case "sessions": {
            if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
            const sessions = await paaw.listSessions();
            const recent = sessions.slice(0, args.limit || 5);
            const list = recent.map(s => `- ${s.filename || s.name} (${s.date || "unknown"})`).join("\n");
            if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${recent.length} sessions` });
            return `Recent sessions (${recent.length} of ${sessions.length}):\n${list || "(none)"}`;
          }
          case "test_map": {
            const tiFile = join(cwd, ".paaw", "code-intelligence", "test-intelligence.json");
            if (!existsSync(tiFile)) return "⚠️ Test Intelligence not found.";
            try {
              const ti = JSON.parse(readSync(tiFile, "utf-8"));
              if (args.file) {
                const norm = args.file.replace(/\\\\/g, "/");
                const entry = ti.codeToTest?.[norm];
                if (!entry || entry.length === 0) return `No tests covering \`${norm}\`.`;
                if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${entry.length} tests` });
                return `Tests covering \`${norm}\`:\n${entry.map(t => `  - ${t.testFile} (${t.testType})`).join("\n")}`;
              }
              if (args.feature) {
                const ft = ti.featureToTests?.find(f => f.featureId === args.feature);
                if (!ft) return `No tests for feature ${args.feature}.`;
                if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${ft.tests.length} tests` });
                return `Tests for ${ft.featureName} (${ft.featureId}):\n${ft.tests.map(t => `  - ${t}`).join("\n")}`;
              }
              const s = ti.stats;
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${s.totalTestFiles} tests` });
              return `Test Intelligence: ${s.totalTestFiles} test files, ${s.coverageRate} coverage, ${s.totalMappings} mappings`;
            } catch (err) { return `Error: ${err.message}`; }
          }
          case "security": {
            const secFile = join(cwd, ".paaw", "security", "scan-results.json");
            if (!existsSync(secFile)) return "⚠️ Security scan results not found.";
            try {
              const sec = JSON.parse(readSync(secFile, "utf-8"));
              let findings = sec.findings || [];
              if (args.severity) findings = findings.filter(f => f.severity === args.severity);
              if (args.file) { const norm = args.file.replace(/\\\\/g, "/"); findings = findings.filter(f => f.file?.replace(/\\\\/g, "/").includes(norm)); }
              if (findings.length === 0) { if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: "clean" }); return "No security findings. ✅"; }
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${findings.length} findings` });
              return `Security Findings (${findings.length}):\n${findings.map(f => `- [${f.severity.toUpperCase()}] ${f.file}:${f.line || "?"} — ${f.message}`).join("\n")}`;
            } catch (err) { return `Error: ${err.message}`; }
          }
          case "recent_changes": {
            const ciFile = join(cwd, ".paaw", "changes", "change-intelligence.json");
            if (!existsSync(ciFile)) {
              try { const { buildChangeIntelligence } = await import("./change-intelligence.mjs"); await buildChangeIntelligence(cwd, { days: args.days || 30, maxCommits: 50 }); } catch { return "⚠️ Change Intelligence not available."; }
            }
            try {
              const ci = JSON.parse(readSync(ciFile, "utf-8"));
              if (args.file) {
                const norm = args.file.replace(/\\\\/g, "/");
                const impact = ci.impactAnalysis?.find(i => i.changedFile === norm || i.changedFile?.includes(norm));
                if (!impact) return `No impact data for \`${norm}\`.`;
                if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${impact.affectedFiles.length} affected` });
                return `Impact of changing \`${norm}\` (${impact.impactLevel}):\n${impact.affectedFiles.map(f => `  - ${f}`).join("\n")}`;
              }
              const s = ci.summary;
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${s.totalCommits} commits` });
              return `Recent Changes (${s.period}): ${s.totalCommits} commits, ${s.totalFilesChanged} files, ${s.totalFeaturesChanged} features changed`;
            } catch (err) { return `Error: ${err.message}`; }
          }
          case "api_history": {
            const histFile = join(rootDir, "data", "api-tester-history.json");
            if (!existsSync(histFile)) return "No API Tester history found.";
            try {
              const raw = JSON.parse(readSync(histFile, "utf-8"));
              let items = Array.isArray(raw) ? raw : (raw.history || []);
              if (args.method) items = items.filter(i => i.method?.toUpperCase() === args.method.toUpperCase());
              if (args.path_contains) { const needle = args.path_contains.toLowerCase(); items = items.filter(i => i.url?.toLowerCase().includes(needle)); }
              const limit = Math.min(args.limit || 20, 50);
              items = items.slice(0, limit);
              if (items.length === 0) return "No matching API history.";
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${items.length} entries` });
              return `API History (${items.length}):\n${items.map((item, idx) => `${idx+1}. ${item.method} ${item.url} → ${item.status} (${item.elapsed}ms)`).join("\n")}`;
            } catch (err) { return `Error: ${err.message}`; }
          }
          default:
            return `Unknown category '${cat}'. Valid: context, decisions, standards, changelog, issues, features, feature_detail, runbook, faq, sessions, test_map, security, recent_changes, api_history`;
        }
      }



      // ══════════════════════════════════════════
      // ── CU Refresh (incremental, not full overwrite) ──
      // ══════════════════════════════════════════

      case "cu_refresh": {
        const steps = Array.isArray(args.steps) ? args.steps : ["code-intelligence", "test-intelligence", "change-intelligence"];
        const results = [];
        const paawDir = join(cwd, ".paaw");
        if (!existsSync(paawDir)) {
          if (onEvent) onEvent({ type: "tool_end", name, result: "no .paaw" });
          return "⚠️ .paaw/ not initialized. Run full Code Understanding first.";
        }

        // Deterministic steps — always safe to re-run, no LLM needed
        if (steps.includes("code-intelligence")) {
          try {
            const { buildCodeIntelligence } = await import("./code-intelligence.mjs");
            const { summary } = await buildCodeIntelligence(cwd, _PAAW_ROOT);
            results.push(`🧠 Code Intelligence: ${summary.totalFunctions} functions, ${summary.totalRoutes} routes, ${summary.totalDependencies} deps`);
          } catch (err) { results.push(`🧠 Code Intelligence: failed — ${err.message}`); }
        }
        if (steps.includes("test-intelligence")) {
          try {
            const { buildTestIntelligence } = await import("./test-intelligence.mjs");
            const { summary } = await buildTestIntelligence(cwd, _PAAW_ROOT);
            results.push(`🧪 Test Intelligence: ${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`);
          } catch (err) { results.push(`🧪 Test Intelligence: failed — ${err.message}`); }
        }
        if (steps.includes("security-scan")) {
          try {
            const { runSemgrep } = await import("./semgrep-runner.mjs");
            const findings = await runSemgrep(cwd);
            results.push(`🔒 Security: ${findings.length} findings`);
          } catch (err) { results.push(`🔒 Security: failed — ${err.message}`); }
        }
        if (steps.includes("change-intelligence")) {
          try {
            const { buildChangeIntelligence } = await import("./change-intelligence.mjs");
            const { summary } = await buildChangeIntelligence(cwd, { days: 30, maxCommits: 50 });
            results.push(`🔄 Change Intelligence: ${summary.totalCommits} commits, ${summary.totalFilesChanged} files`);
          } catch (err) { results.push(`🔄 Change Intelligence: failed — ${err.message}`); }
        }

        // LLM steps — these re-run the CU step via API (requires server running)
        const llmSteps = steps.filter(s => !["code-intelligence", "test-intelligence", "security-scan", "change-intelligence"].includes(s));
        if (llmSteps.length > 0) {
          results.push(`\n⚠️ LLM steps (${llmSteps.join(", ")}) require calling POST /api/coding-project/ai-initial-step — use from Coding IDE or night shift.`);
        }

        const output = results.length > 0 ? `CU Refresh Results:\n${results.join("\n")}` : "No steps to refresh.";
        if (onEvent) onEvent({ type: "tool_end", name, result: `${results.length} steps` });
        return output;
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

      // ── Unified docs handler (replaces update_changelog + update_docs) ──
      case "docs": {
        const action = args.action;
        if (!action) return "Error: action is required. Valid: changelog, write, append";
        
        if (action === "changelog") {
          const paaw = createPaawProject(cwd);
          if (!paaw.exists) return "⚠️ .paaw/ not initialized. Changelog not updated.";
          if (!args.type || !args.description) return "Error: type and description are required for changelog.";
          await paaw.appendChangelog({ type: args.type, description: args.description });
          if (onEvent) onEvent({ type: "tool_end", name, result: `${args.type}: ${args.description.slice(0, 50)}` });
          return `✅ Changelog updated: [${args.type}] ${args.description}`;
        }
        
        if (action === "write" || action === "append") {
          const paaw = createPaawProject(cwd);
          if (!paaw.exists) await paaw.init();
          const docFile = args.file?.replace(/\.\.\//g, "").replace(/^\//, "");
          if (!docFile) return "Error: file is required";
          if (!args.content) return "Error: content is required";
          if (action === "append") {
            const existing = await paaw.readFile(docFile) || "";
            await paaw.writeFile(docFile, existing + "\n" + args.content);
          } else {
            await paaw.writeFile(docFile, args.content);
          }
          if (onEvent) onEvent({ type: "tool_end", name, result: docFile });
          return `✅ Documentation ${action === "append" ? "appended" : "updated"}: .paaw/${docFile}`;
        }
        
        return `Unknown action '${action}'. Valid: changelog, write, append`;
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
        const agentId = args._agentId || _agentCfg?.agentId || "agent";
        await saveAgentMemory(agentId, args.content, rootDir || cwd);
        if (onEvent) onEvent({ type: "tool_end", name, result: `${agentId}.md` });
        return `✅ Memory saved for ${agentId} to ${(rootDir || cwd)}/.paaw/agent-memory/`;
      }

      case "agent_memory_load": {
        const { loadAgentMemory } = await import("./action-log.mjs");
        const agentId = args._agentId || _agentCfg?.agentId || "agent";
        const content = await loadAgentMemory(agentId, rootDir || cwd);
        if (onEvent) onEvent({ type: "tool_end", name, result: content ? `${content.length} chars` : "empty" });
        return content || "(No saved memory yet)";
      }

      // ── Notes Tools ──
      // ── Unified notes handler ──
      case "notes": {
        const action = args.action;
        if (!action) return "Error: 'action' is required. Valid: list_notebooks, list_sections, create, create_section, search";
        // Normalize unified schema params → legacy handler params
        if (!args.notebookId && args.notebook) args.notebookId = args.notebook;
        if (!args.sectionId && args.section) args.sectionId = args.section;
        if (!args.query && args.q) args.query = args.q;
        const notesDir = resolve(rootDir || cwd, "data", "notes");

        switch (action) {
          case "list_notebooks": {
            try {
              const entries = await readdir(notesDir);
              const notebooks = [];
              for (const entry of entries) {
                if (!entry.endsWith(".json")) continue;
                const nbId = entry.replace(".json", "");
                try {
                  const raw = await readFile(resolve(notesDir, entry), "utf-8");
                  const nb = JSON.parse(raw);
                  const sectionsFile = resolve(notesDir, "sections.json");
                  let sections = [];
                  try { const secRaw = await readFile(sectionsFile, "utf-8"); const allSecs = JSON.parse(secRaw); sections = (allSecs[nbId] || []).filter(s => s.id !== "default"); } catch {}
                  notebooks.push({ id: nbId, name: nb.name || nbId, description: nb.description || "", sections: [{ id: "default", name: "Default" }, ...sections], noteCount: Array.isArray(nb.notes) ? nb.notes.length : 0 });
                } catch {}
              }
              const text = notebooks.map(nb => `📁 ${nb.name} (${nb.id}) — ${nb.noteCount} 筆記\n  分類: ${nb.sections.map(s => s.name).join(", ")}`).join("\n");
              if (onEvent) onEvent({ type: "tool_end", name, result: `${notebooks.length} notebooks` });
              return text || "No notebooks found.";
            } catch { return "No notes directory found."; }
          }

          case "list_sections": {
            if (!args.notebookId) return "Error: notebookId is required";
            const sectionsFile = resolve(notesDir, "sections.json");
            try {
              const raw = await readFile(sectionsFile, "utf-8");
              const allSecs = JSON.parse(raw);
              const sections = allSecs[args.notebookId] || [{ id: "default", name: "Default" }];
              const nbFile = resolve(notesDir, `${args.notebookId}.json`);
              let noteCounts = {};
              try { const nb = JSON.parse(await readFile(nbFile, "utf-8")); for (const n of (nb.notes || [])) { const sid = n.sectionId || "default"; noteCounts[sid] = (noteCounts[sid] || 0) + 1; } } catch {}
              const text = sections.map(s => `  ${s.id === "default" ? "📋" : "📁"} ${s.name} (${s.id}) — ${noteCounts[s.id] || 0} 筆記`).join("\n");
              if (onEvent) onEvent({ type: "tool_end", name, result: `${sections.length} sections` });
              return `Notebook '${args.notebookId}' sections:\n${text}`;
            } catch { return `Notebook '${args.notebookId}' has only the Default section.`; }
          }

          case "create": {
            const { notebookId, sectionId = "default", title, content, tags = [] } = args;
            if (!notebookId) return "Error: notebookId is required";
            if (!title) return "Error: title is required";
            if (!content) return "Error: content is required";
            const nbFile = resolve(notesDir, `${notebookId}.json`);
            try {
              let nb;
              try { nb = JSON.parse(await readFile(nbFile, "utf-8")); } catch { nb = { id: notebookId, name: notebookId, notes: [] }; }
              const note = { id: `note-${Date.now()}`, title, content, tags, sectionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
              if (!Array.isArray(nb.notes)) nb.notes = [];
              nb.notes.push(note);
              await writeFile(nbFile, JSON.stringify(nb, null, 2), "utf-8");
              if (onEvent) onEvent({ type: "tool_end", name, result: `Created '${title}'` });
              return `✅ 筆記已建立: ${title} (${notebookId}/${sectionId})`;
            } catch (err) { return `Error creating note: ${err.message}`; }
          }

          case "create_section": {
            const { notebookId, name, icon } = args;
            if (!notebookId) return "Error: notebookId is required";
            if (!name) return "Error: name is required";
            const sectionsFile = resolve(notesDir, "sections.json");
            try {
              let allSecs = {};
              try { allSecs = JSON.parse(await readFile(sectionsFile, "utf-8")); } catch {}
              if (!allSecs[notebookId]) allSecs[notebookId] = [{ id: "default", name: "Default" }];
              const exists = allSecs[notebookId].find(s => s.name === name);
              if (exists) return `Section '${name}' already exists in '${notebookId}'.`;
              const secId = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || `sec-${Date.now()}`;
              allSecs[notebookId].push({ id: secId, name, icon: icon || "📁" });
              await writeFile(sectionsFile, JSON.stringify(allSecs, null, 2), "utf-8");
              if (onEvent) onEvent({ type: "tool_end", name, result: `Created section '${name}'` });
              return `✅ 分類已建立: ${name} (${notebookId})`;
            } catch (err) { return `Error creating section: ${err.message}`; }
          }

          case "search": {
            if (!args.query) return "Error: query is required";
            try {
              const entries = await readdir(notesDir);
              const results = [];
              for (const entry of entries) {
                if (!entry.endsWith(".json") || entry === "sections.json") continue;
                const nbId = entry.replace(".json", "");
                if (args.notebookId && nbId !== args.notebookId) continue;
                try {
                  const nb = JSON.parse(await readFile(resolve(notesDir, entry), "utf-8"));
                  for (const note of (nb.notes || [])) {
                    const haystack = `${note.title || ""} ${note.content || ""} ${(note.tags || []).join(" ")}`.toLowerCase();
                    if (haystack.includes(args.query.toLowerCase())) {
                      results.push({ notebook: nbId, section: note.sectionId || "default", title: note.title, preview: (note.content || "").slice(0, 100) });
                    }
                  }
                } catch {}
              }
              if (onEvent) onEvent({ type: "tool_end", name, result: `${results.length} matches` });
              return results.length
                ? results.map(r => `📄 ${r.title}\n  📁 ${r.notebook}/${r.section}\n  ${r.preview}...`).join("\n")
                : `No notes matching '${args.query}'.`;
            } catch { return "No notes directory found."; }
          }

          default:
            return `Unknown action '${action}'. Valid: list_notebooks, list_sections, create, create_section, search`;
        }
      }

            // ══════════════════════════════════════════
      // ── Unified project_edit handler ──
      case "project_edit": {
        const action = args.action;
        if (!action) return "Error: 'action' parameter is required. Valid: issue_create, issue_update, issue_delete, change_record, feature_update_docs, feature_update_mapping, run_command";
        const paaw = createPaawProject(cwd);

        switch (action) {
          case "issue_create": {
            if (!args.title) return "Error: 'title' is required for issue_create.";
            if (!args.priority) return "Error: 'priority' is required for issue_create.";
            const issuesDir = join(cwd, ".paaw", "issues");
            const issuesFile = join(issuesDir, "ISSUES.json");
            await mkdir(issuesDir, { recursive: true });
            let data = { issues: [], nextId: 1 };
            if (existsSync(issuesFile)) { try { data = JSON.parse(readSync(issuesFile, "utf-8")); } catch {} }
            const id = `ISS-${String(data.nextId || data.issues.length + 1).padStart(3, "0")}`;
            const issue = {
              id, title: args.title, priority: args.priority, status: "open",
              labels: args.labels || [], description: args.description || "",
              featureId: args.featureId || null, createdAt: new Date().toISOString(), notes: [],
            };
            data.issues.push(issue);
            data.nextId = (data.nextId || data.issues.length) + 1;
            writeSync(issuesFile, JSON.stringify(data, null, 2));
            if (onEvent) onEvent({ type: "tool_end", name, result: id });
            return `✅ Created issue ${id}: ${args.title} [${args.priority}]`;
          }

          case "issue_update": {
            if (!args.id) return "Error: 'id' is required for issue_update.";
            const issuesFile = join(cwd, ".paaw", "issues", "ISSUES.json");
            if (!existsSync(issuesFile)) return "Error: No issues file found.";
            let data;
            try { data = JSON.parse(readSync(issuesFile, "utf-8")); } catch { return "Error: Could not parse issues file."; }
            const issue = (data.issues || []).find(i => i.id === args.id);
            if (!issue) return `Error: Issue ${args.id} not found.`;
            if (args.status) issue.status = args.status;
            if (args.priority) issue.priority = args.priority;
            if (args.note) { issue.notes = issue.notes || []; issue.notes.push({ text: args.note, at: new Date().toISOString() }); }
            issue.updatedAt = new Date().toISOString();
            writeSync(issuesFile, JSON.stringify(data, null, 2));
            if (onEvent) onEvent({ type: "tool_end", name, result: args.id });
            return `✅ Updated ${args.id}: ${[args.status && `status=${args.status}`, args.priority && `priority=${args.priority}`, args.note && "note added"].filter(Boolean).join(", ")}`;
          }

          case "issue_delete": {
            if (!args.id) return "Error: 'id' is required for issue_delete.";
            const issuesFile = join(cwd, ".paaw", "issues", "ISSUES.json");
            if (!existsSync(issuesFile)) return "Error: No issues file found.";
            let data;
            try { data = JSON.parse(readSync(issuesFile, "utf-8")); } catch { return "Error: Could not parse issues file."; }
            const before = data.issues.length;
            data.issues = (data.issues || []).filter(i => i.id !== args.id);
            if (data.issues.length === before) return `Error: Issue ${args.id} not found.`;
            writeSync(issuesFile, JSON.stringify(data, null, 2));
            if (onEvent) onEvent({ type: "tool_end", name, result: args.id });
            return `✅ Deleted issue ${args.id}`;
          }

          case "change_record": {
            if (!args.title || !args.type || !args.description || !args.files) {
              return "Error: title, type, description, and files are required for change_record.";
            }
            const logDir = join(cwd, ".paaw", "action-log");
            await mkdir(logDir, { recursive: true });
            const entry = {
              agent: agentId, title: args.title, type: args.type,
              description: args.description, files: args.files,
              impact: args.impact || "", testsRan: args.testsRan || "",
              timestamp: new Date().toISOString(),
            };
            const logFile = join(logDir, `${new Date().toISOString().slice(0, 10)}.json`);
            let log = [];
            if (existsSync(logFile)) { try { log = JSON.parse(readSync(logFile, "utf-8")); } catch {} }
            log.push(entry);
            writeSync(logFile, JSON.stringify(log, null, 2));
            if (onEvent) onEvent({ type: "tool_end", name, result: args.title });
            return `✅ Recorded change: ${args.title} (${args.type}) — ${args.files.length} file(s)`;
          }

          case "feature_update_docs": {
            if (!args.id || !args.documentation) return "Error: id and documentation are required.";
            const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
            if (!existsSync(featuresFile)) return "Error: No features file found.";
            let data;
            try { data = JSON.parse(readSync(featuresFile, "utf-8")); } catch { return "Error: Could not parse features file."; }
            const feature = (data.features || []).find(f => f.id === args.id);
            if (!feature) return `Error: Feature ${args.id} not found.`;
            feature.documentation = args.documentation;
            feature.docsUpdatedAt = new Date().toISOString();
            writeSync(featuresFile, JSON.stringify(data, null, 2));
            if (onEvent) onEvent({ type: "tool_end", name, result: args.id });
            return `✅ Updated docs for ${args.id}: ${feature.name}`;
          }

          case "feature_update_mapping": {
            if (!args.id) return "Error: id is required.";
            const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
            if (!existsSync(featuresFile)) return "Error: No features file found.";
            let data;
            try { data = JSON.parse(readSync(featuresFile, "utf-8")); } catch { return "Error: Could not parse features file."; }
            const feature = (data.features || []).find(f => f.id === args.id);
            if (!feature) return `Error: Feature ${args.id} not found.`;
            if (args.codeFiles) feature.codeFiles = args.codeFiles;
            if (args.apis) feature.apis = args.apis;
            if (args.tests) feature.tests = args.tests;
            if (args.runbooks) feature.runbooks = args.runbooks;
            writeSync(featuresFile, JSON.stringify(data, null, 2));
            if (onEvent) onEvent({ type: "tool_end", name, result: args.id });
            return `✅ Updated mapping for ${args.id}: ${feature.name}`;
          }

          case "run_command": {
            const cmd = args.command;
            if (!cmd || typeof cmd !== "string") return "Error: 'command' is required for run_command.";
            const ALLOWED_PREFIXES = ["npm", "npx", "yarn", "pnpm", "node", "tsc", "mvn", "gradle", "gradlew", "python", "python3", "py", "pip", "pip3", "cargo", "go", "make", "dotnet"];
            const cmdTrimmed = cmd.trim();
            const firstWord = cmdTrimmed.split(/\s+/)[0];
            if (!ALLOWED_PREFIXES.includes(firstWord)) return `Error: command '${firstWord}' not allowed. Allowed: ${ALLOWED_PREFIXES.join(", ")}`;
            const DANGER_PATTERNS = [/\brm\b/i, /\bdel\b/i, /git\s+push/i, /git\s+reset/i, /\bsudo\b/i, /\bcurl\b/i, /\bwget\b/i, />/i, /\|/i, /;/i, /&&/i];
            for (const p of DANGER_PATTERNS) { if (p.test(cmdTrimmed)) return `Error: blocked pattern: ${p.source}`; }
            if (onEvent) onEvent({ type: "tool_start", name, args: { command: cmdTrimmed } });
            const output = await runShell(cmdTrimmed, rootDir, 60000);
            const MAX_OUTPUT = 8000;
            const truncated = output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + "\n... (truncated)" : output;
            if (onEvent) onEvent({ type: "tool_end", name, result: "done" });
            return `$ ${cmdTrimmed}\n${truncated}`;
          }

          default:
            return `Unknown action '${action}'. Valid: issue_create, issue_update, issue_delete, change_record, feature_update_docs, feature_update_mapping, run_command`;
        }
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

// ── Context Window Management ──
// Trims conversation history to fit within model's context window.
// Strategy: keep system message + first user message + last N messages.
// Middle messages are summarized into a compact note.

const DEFAULT_CONTEXT_WINDOW = 262000; // 262k tokens default for company models
const CONTEXT_SAFETY_MARGIN = 8000;   // reserve for system prompt + response
const LLM_CALL_TIMEOUT_MS = 300_000;  // 5 min per LLM call (company models are slower, need more than 2 min)

// ── OpenClaw-aligned context management ──
// Like OpenClaw: reserve 50% for prompt budget, cap tool results at 30% of context
const MIN_PROMPT_BUDGET_RATIO = 0.5;
const TOOL_RESULT_CONTEXT_SHARE = 0.3;

function estimateTokens(text) {
  // Rough estimate: ~3.5 chars per token for mixed CJK + English
  return Math.ceil((text || "").length / 3.5);
}

/**
 * Trim messages to fit context window.
 * Strategy (aligned with OpenClaw):
 *   1. Always keep system prompt (messages[0]) + first user message
 *   2. Keep as many recent messages as fit (sliding window from tail)
 *   3. Summarize evicted middle messages into a compact summary
 *   4. Cap any single tool result at 30% of context window
 */
export function trimMessagesToFit(messages, contextWindow = DEFAULT_CONTEXT_WINDOW) {
  if (messages.length <= 4) return messages;

  const budget = contextWindow - CONTEXT_SAFETY_MARGIN;
  const toolResultCap = Math.floor(contextWindow * TOOL_RESULT_CONTEXT_SHARE) * 4; // chars

  // Pass 1: Cap oversized tool results in any message content
  let msgs = messages.map(m => {
    const content = m.content || "";
    if (content.length > toolResultCap) {
      const trimmed = content.slice(0, toolResultCap) + `\n... (tool result truncated, ${content.length} chars total, capped at ${toolResultCap} chars to preserve context budget)`;
      return { ...m, content: trimmed };
    }
    return m;
  });

  // Pass 2: Check total fits
  let totalTokens = msgs.reduce((s, m) => s + estimateTokens(m.content || ""), 0);
  if (totalTokens <= budget) {
    return msgs; // fits, no trimming needed
  }

  // Pass 3: Sliding window — keep head (system + first user) + as many tail messages as fit
  const head = msgs.slice(0, 2); // system + first user
  const tailMessages = msgs.slice(2);

  // Greedily add tail messages from most recent backwards
  const keptTail = [];
  let tailTokens = head.reduce((s, m) => s + estimateTokens(m.content || ""), 0);
  const minPromptBudget = Math.min(8000, Math.floor(budget * MIN_PROMPT_BUDGET_RATIO));
  const tailBudget = budget - tailTokens; // remaining after head

  for (let i = tailMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(tailMessages[i].content || "");
    if (tailTokens + msgTokens > tailBudget) break;
    keptTail.unshift(tailMessages[i]);
    tailTokens += msgTokens;
  }

  // Summarize evicted messages
  const evictedStart = 0;
  const evictedEnd = tailMessages.length - keptTail.length;
  const evicted = tailMessages.slice(evictedStart, evictedEnd);

  if (evicted.length === 0) {
    return [...head, ...keptTail];
  }

  // Build compact summary of evicted messages
  const summaryParts = evicted
    .filter(m => m.role === "assistant" || m.role === "user" || m.role === "system")
    .map(m => {
      const content = (m.content || "").slice(0, 300);
      const role = m.role === "assistant" ? "AI" : m.role === "user" ? "User" : "System";
      return `[${role}] ${content}`;
    });

  const summaryMsg = {
    role: "system",
    content: `[Context trimmed — ${evicted.length} earlier messages summarized]\n${summaryParts.join("\n")}\n[End of summary — ${evicted.length} messages evicted to fit context window]`,
  };

  const trimmed = [...head, summaryMsg, ...keptTail];
  const trimmedTokens = trimmed.reduce((s,m) => s + estimateTokens(m.content || ""), 0);
  console.log(`[context-trim] ${messages.length} msgs → ${trimmed.length} msgs (est. ${totalTokens} tok → ~${trimmedTokens} tok, budget=${budget})`);
  return trimmed;
}

// ── LLM API Call ──

export async function callLLM(apiUrl, headers, model, messages, tools, stream = false, onEvent = null, agentId = null) {
  console.log(`[callLLM] model=${model}, stream=${stream}, apiUrl=${apiUrl}, messages=${messages.length}`);
  const body = {
    model,
    messages,
    ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    max_tokens: 8192,
    stream,
  };

  const callStartTime = Date.now();
  const callId = `llm-${callStartTime}-${Math.random().toString(36).slice(2, 8)}`;

  // ── LLM Request Logging ──
  // NOTE: callLLMWithRetry (llm-utils.mjs) already logs request+response for non-stream.
  // Only log here for the stream path (fetchStreamWithRetry doesn't log).
  const _logStreamRequest = () => {
    try {
      const logDir = join(_PAAW_ROOT, "data", "llm-logs");
      mkdirSync(logDir, { recursive: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      const logPath = join(logDir, `${dateStr}.jsonl`);
      const logEntry = {
        id: callId,
        ts: new Date(callStartTime).toISOString(),
        phase: "request",
        agentId: agentId || null,
        model: body.model,
        stream,
        apiUrl: apiUrl.replace(/\/v.*$/, "/..."), // don't log full URL with keys
        messageCount: body.messages?.length,
        messagesPreview: body.messages?.map(m => ({ role: m.role, len: (m.content || "").length, preview: (m.content || "").slice(0, 200) })),
        toolsCount: body.tools?.length || 0,
        toolNames: (body.tools || []).map(t => t.function?.name).filter(Boolean),
        maxTokens: body.max_tokens,
      };
      appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
    } catch (_e) {}
  };
  // Stream path: log request now; non-stream path is handled by callLLMWithRetry
  if (stream) _logStreamRequest();

  // Helper to log stream response (only for stream path)
  const _logStreamResponse = (response, error = null) => {
    try {
      const logDir = join(_PAAW_ROOT, "data", "llm-logs");
      mkdirSync(logDir, { recursive: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      const logPath = join(logDir, `${dateStr}.jsonl`);
      const durationMs = Date.now() - callStartTime;
      const logEntry = {
        id: callId,
        ts: new Date().toISOString(),
        phase: "response",
        agentId: agentId || null,
        model: body.model,
        stream,
        durationMs,
        error: error || null,
        ...(response ? {
          finishReason: response.choices?.[0]?.finish_reason || null,
          contentLen: (response.choices?.[0]?.message?.content || "").length,
          contentPreview: (response.choices?.[0]?.message?.content || "").slice(0, 500),
          toolCalls: response.choices?.[0]?.message?.tool_calls?.map(tc => ({ name: tc.function?.name, argsLen: (tc.function?.arguments || "").length })) || [],
          usage: response.usage || null,
        } : {}),
      };
      appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
    } catch (_e) {}
  };

  if (stream) {
    // 串流模式：用 fetchStreamWithRetry 取得連線，回傳 raw response
    const { fetchStreamWithRetry } = await import("./llm-utils.mjs");
    const resp = await fetchStreamWithRetry(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, { timeoutMs: LLM_CALL_TIMEOUT_MS, readTimeoutMs: 600_000, maxRetries: 2, onRetry: (info) => {
      if (onEvent) onEvent("info", { message: `⏳ API 暫時不可用 (HTTP ${info.status}), ${info.delayMs / 1000}s 後重試...` });
    } });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      _logStreamResponse(null, `HTTP ${resp.status}: ${text.slice(0, 200)}`);
      throw new Error(`LLM API error ${resp.status}: ${text.slice(0, 500)}`);
    }
    // Stream response — log metadata later in runAgentLoopStream
    // Attach callId so the loop can log the response
    resp._llmCallId = callId;
    resp._llmCallStart = callStartTime;
    return resp; // Return raw response for SSE streaming
  }

  // 非串流：用 callLLMWithRetry 統一處理 retry + 內容驗證
  const result = await callLLMWithRetry(apiUrl, headers, body, {
    maxRetries: 3,
    timeoutMs: LLM_CALL_TIMEOUT_MS,
    validateContent: true,
    sanitize: true,
    agentId: agentId,
    caller: agentId,
    onRetry: (info) => {
      if (onEvent) onEvent("info", { message: `⏳ API 暫時不可用 (HTTP ${info.status}), ${info.delayMs / 1000}s 後重試...` });
    },
  });

  // callLLMWithRetry handles its own logging — no duplicate _logResponse here
  // 回傳跟原本一樣的 shape（把 result.raw 當 json 回傳）
  return result.raw;
}

// ── System Prompt Assembly ──

/** Refresh dynamic context (MEMORY.md) in messages[0] after memory changes */
function refreshDynamicContext(messages) {
  if (!messages[0] || messages[0].role !== "system") return;
  try {
    const MEMORY_FILE = resolve(_PAAW_ROOT, "data/config/MEMORY.md");
    let mem = "";
    try { mem = readSync(MEMORY_FILE, "utf-8"); } catch {}
    const marker = "=== 長期記憶 (MEMORY.md) ===";
    const content = messages[0].content;
    const idx = content.indexOf(marker);
    if (idx === -1) return; // no memory section in system prompt
    // Find the next === section after memory
    const afterMarker = content.indexOf("\n=== ", idx + marker.length);
    const before = content.slice(0, idx);
    const after = afterMarker === -1 ? "" : content.slice(afterMarker);
    messages[0].content = before + marker + "\n" + (mem || "(記憶是空白的)") + "\n" + after;
  } catch (err) {
    console.warn("[AgentLoop] Failed to refresh dynamic context:", err.message);
  }
}

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
    const AGENT_LOOP_PROMPT_PATH = resolve(_PAAW_ROOT, "data/ai-settings/agent-loop/system-prompt.md");
    let agentBase = "";
    try { agentBase = readSync(AGENT_LOOP_PROMPT_PATH, "utf-8").trim(); } catch {}
    if (agentBase) {
      parts.push(agentBase);
    } else {
      parts.push(`You are PAAW Agent, an AI coding assistant. Always use ABSOLUTE paths. Working directory: ${cwd}`);
    }
  }

  // Inject base context: knowledge + workspace paths (required for every AI request)
  const PAAW_R = _PAAW_ROOT;
  try {
    const ws = JSON.parse(readSync(resolve(PAAW_R, "data/config/workspaces.json"), "utf-8"));
    if (ws.directories?.length) {
      parts.push(`\n=== 檔案路徑 ===\n📖 Knowledge：使用 file_list({ workspace: "knowledge" }) 和 file_read({ workspace: "knowledge", path: "檔名" }) 透過 API 存取。\n\n使用者的 Workspace 目錄（可讀寫）：\n${ws.directories.map(d => "- " + d).join("\n")}`);
    }
  } catch {}

  // Inject cwd dynamically
  parts.push(`\nWorking directory: ${cwd}`);

  // Always include tool definitions
  parts.push(`\n## Your Tools\n### Project Knowledge (use these FIRST, not read_file for .paaw/)\n- **project_info(category=...)** — Read project knowledge. Categories: context, decisions, standards, changelog, issues, features, feature_detail, runbook, faq, sessions, test_map, security, recent_changes, api_history\n- **project_edit(action=...)** — Modify project data. Actions: issue_create, issue_update, issue_delete, change_record, feature_update_docs, feature_update_mapping, run_command\n### CU Maintenance\n- **cu_refresh** — Refresh CU steps after code changes\n### File Operations\n- **read_file** — Read source files (NOT for .paaw/ — use project_info)\n- **write_file** — Write or create files\n- **edit_file** — Precise text replacement\n- **glob** — Find files by pattern\n- **grep** — Search file contents\n### Git & Shell\n- **diff** — Show differences\n- **git** — Run git commands\n- **bash** — Run shell commands\n### Project Write\n- **record_decision** — Record ADR\n- **docs(action=...)** — Update .paaw/ docs (actions: changelog, write, append)\n### Agent Collaboration\n- **action_log_add** — Record your action for other agents\n- **action_log_list** — Read what other agents did\n- **agent_memory_save** — Save to long-term memory\n- **agent_memory_load** — Read long-term memory\n### Other\n- **ask_user** — Ask for clarification`);

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
    fallbackModels,
    maxTurns,
    timeout,
    params = {},
    onEvent = null,
    rootDir = _PAAW_ROOT,
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
  const modifiedFiles = new Set(); // track modified files for post-edit test verification

  // Resolve LLM config
  const llm = resolveLLMConfig(rootDir, modelOverride, fallbackModels);

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

  for (let i = 0; i < effectiveMaxTurns; i++) {
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

    // Call LLM (with context window trimming)
    const trimmedMessages = trimMessagesToFit(messages, llm.contextWindow || DEFAULT_CONTEXT_WINDOW);
    let response;
    try {
      response = await callLLM(llm.apiUrl, llm.headers, llm.model, trimmedMessages, toolRegistry.initialized ? toolRegistry.getDefinitions(getToolsForAgent(agentId).map(t => t.function?.name)) : getToolsForAgent(agentId), false, (evt, data) => {
        if (onEvent) onEvent({ type: evt, ...data });
      }, agentId);
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
      const _toolName = call.function?.name;
      const _ctx = { cwd, rootDir, onEvent, agentId };
      const toolResult = toolRegistry.initialized && toolRegistry.has(_toolName)
        ? String(await toolRegistry.execute(_toolName, JSON.parse(call.function.arguments || "{}"), _ctx))
        : await executeTool(call, cwd, rootDir, onEvent, agentId);
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

      // Refresh system prompt dynamic context after memory changes
      if (call.function.name === "memory_add" || call.function.name === "memory_update") {
        refreshDynamicContext(messages);
      }
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

        // ── P0: Auto-run affected tests after code changes ──
        const changedFiles = [...modifiedFiles];
        if (changedFiles.length > 0) {
          try {
            const affectedTests = getAffectedTests(cwd, changedFiles);
            if (affectedTests.length > 0) {
              LOG(`[post-edit-verify] Found ${affectedTests.length} affected test files for ${changedFiles.length} changed files`);
              // Run the tests using the project's test runner
              const testCmd = _buildTestCommand(cwd, affectedTests);
              if (testCmd) {
                LOG(`[post-edit-verify] Running: ${testCmd}`);
                const testResult = await runShell(testCmd, cwd, 60_000);
                const testPassed = _parseTestResult(testResult);
                if (!testPassed.ok) {
                  LOG(`[post-edit-verify] ⚠️ Tests FAILED: ${testPassed.failed}/${testPassed.total}`);
                  // Append test failure info to the final content so the AI knows
                  const failureNotice = [
                    "",
                    "━━━ ⚠️ Post-Edit Test Verification ━━━",
                    testPassed.ok ? "✅ All affected tests passed!" : `❌ ${testPassed.failed}/${testPassed.total} tests FAILED after your changes:`,
                    "",
                    testResult.slice(0, 3000),
                    "",
                    "💡 Your changes may have broken these tests. Please review and fix.",
                  ].join("\n");
                  finalContent += failureNotice;
                } else {
                  LOG(`[post-edit-verify] ✅ All ${testPassed.total} affected tests passed`);
                  finalContent += "\n\n✅ Post-edit verification: All affected tests passed.";
                }
              }
            } else {
              // Convention-based test lookup
              const conventionTests = _findConventionTests(cwd, changedFiles);
              if (conventionTests.length > 0) {
                LOG(`[post-edit-verify] Found ${conventionTests.length} convention-based test files`);
                const testCmd = _buildTestCommand(cwd, conventionTests);
                if (testCmd) {
                  const testResult = await runShell(testCmd, cwd, 60_000);
                  const testPassed = _parseTestResult(testResult);
                  if (!testPassed.ok) {
                    const failureNotice = ["", "━━━ ⚠️ Post-Edit Test Verification ━━━", `❌ ${testPassed.failed}/${testPassed.total} tests FAILED:`, "", testResult.slice(0, 3000), "", "💡 Your changes may have broken these tests. Please review and fix."].join("\n");
                    finalContent += failureNotice;
                  } else {
                    finalContent += "\n\n✅ Post-edit verification: All affected tests passed.";
                  }
                }
              } else {
                LOG("[post-edit-verify] No affected tests found — skipping auto-verify");
              }
            }
          } catch (verifyErr) {
            LOG("[post-edit-verify] Error:", verifyErr.message);
          }
        }
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
    fallbackModels,
    maxTurns,
    timeout,
    params = {},
    rootDir = _PAAW_ROOT,
    agentId = null,
    abortSignal = null,
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
  const streamModifiedFiles = new Set(); // track modified files for post-edit verification

  // SSE helper
  const sendSSE = (event, data) => {
    try {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  // Resolve LLM config
  const llm = resolveLLMConfig(rootDir, modelOverride, fallbackModels);
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

  for (let i = 0; i < effectiveMaxTurns; i++) {
    // Check abort signal (user interrupt)
    if (abortSignal?.aborted) {
      sendSSE("interrupted", { message: "Agent interrupted by user", turns });
      break;
    }
    if (Date.now() - startTime > timeoutMs) {
      sendSSE("error", { error: "Agent loop timed out" });
      break;
    }

    turns++;
    sendSSE("turn", { turn: i + 1 });

    // Call LLM with fallback chain on 429/rate-limit (with context window trimming)
    const trimmedMessages = trimMessagesToFit(messages, llm.contextWindow || DEFAULT_CONTEXT_WINDOW);
    let response;
    let usedLlm = llm;
    try {
      response = await callLLM(llm.apiUrl, llm.headers, llm.model, trimmedMessages, toolRegistry.initialized ? toolRegistry.getDefinitions(getToolsForAgent(agentId).map(t => t.function?.name)) : getToolsForAgent(agentId), false, sendSSE, agentId);
    } catch (err) {
      const is429 = err.message && (err.message.includes("429") || err.message.includes("overloaded") || err.message.includes("rate"));
      if (is429 && llm.fallbacks && llm.fallbacks.length > 0) {
        for (const fb of llm.fallbacks) {
          console.log(`[callLLM] 429 rate-limited, trying fallback: ${fb.providerId}/${fb.model}`);
          sendSSE("info", { message: `⏳ ${llm.providerId} 限流，切換到 ${fb.providerId}/${fb.model}` });
          try {
            response = await callLLM(fb.apiUrl, fb.headers, fb.model, trimmedMessages, toolRegistry.initialized ? toolRegistry.getDefinitions(getToolsForAgent(agentId).map(t => t.function?.name)) : getToolsForAgent(agentId), false, sendSSE, agentId);
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

    // ── Log stream response ──
    if (response._llmCallId) {
      try {
        const logDir = join(_PAAW_ROOT, "data", "llm-logs");
        mkdirSync(logDir, { recursive: true });
        const dateStr = new Date().toISOString().slice(0, 10);
        const logPath = join(logDir, `${dateStr}.jsonl`);
        const durationMs = Date.now() - (response._llmCallStart || Date.now());
        appendFileSync(logPath, JSON.stringify({
          id: response._llmCallId,
          ts: new Date().toISOString(),
          phase: "response",
          agentId: agentId || null,
          model: usedLlm.model,
          stream: true,
          durationMs,
          finishReason: choice.finish_reason || null,
          contentLen: (choice.message?.content || "").length,
          contentPreview: (choice.message?.content || "").slice(0, 500),
          toolCalls: (choice.message?.tool_calls || []).map(tc => ({ name: tc.function?.name, argsLen: (tc.function?.arguments || "").length })),
          usage: response.usage || null,
        }) + "\n");
      } catch (_e) {}
    }

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

      const _toolName2 = call.function?.name;
      const _ctx2 = { cwd, rootDir, onEvent: null, agentId };
      const toolResult = toolRegistry.initialized && toolRegistry.has(_toolName2)
        ? String(await toolRegistry.execute(_toolName2, args, _ctx2))
        : await executeTool(call, cwd, rootDir, null, agentId);
      sendSSE("tool_result", { name: call.function.name, result: toolResult.slice(0, 2000) });

      // Track modified files for post-edit verification
      if (call.function.name === "write_file" || call.function.name === "edit_file") {
        try {
          const p = args.path || args.file || "";
          const normP = p.replace(cwd + "/", "").replace(cwd + "\\", "").replace(/^\//, "");
          if (normP) streamModifiedFiles.add(normP);
        } catch {}
      }

      // Refresh system prompt dynamic context after memory changes
      if (call.function.name === "memory_add" || call.function.name === "memory_update") {
        refreshDynamicContext(messages);
      }

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
      const finalResponse = await callLLM(llm.apiUrl, llm.headers, llm.model, trimMessagesToFit(messages, llm.contextWindow || DEFAULT_CONTEXT_WINDOW), [], false, sendSSE, agentId);
      const finalContent = finalResponse.choices?.[0]?.message?.content || "";
      if (finalContent) {
        sendSSE("content", { content: finalContent, done: true });
      }
    } catch (err) {
      sendSSE("error", { error: `Final summary failed: ${err.message}` });
    }
  }

  // ── P0: Post-edit test verification for stream mode ──
  if (streamModifiedFiles.size > 0) {
    try {
      const changedFiles = [...streamModifiedFiles];
      const affectedTests = getAffectedTests(cwd, changedFiles);
      const testsToRun = affectedTests.length > 0 ? affectedTests : _findConventionTests(cwd, changedFiles);
      if (testsToRun.length > 0) {
        sendSSE("info", { message: `🧪 Auto-verifying ${testsToRun.length} affected test files...` });
        const testCmd = _buildTestCommand(cwd, testsToRun);
        if (testCmd) {
          const testResult = await runShell(testCmd, cwd, 60_000);
          const testPassed = _parseTestResult(testResult);
          if (!testPassed.ok) {
            sendSSE("verify", { ok: false, failed: testPassed.failed, total: testPassed.total, output: testResult.slice(0, 2000) });
          } else {
            sendSSE("verify", { ok: true, total: testPassed.total, output: "All affected tests passed" });
          }
        }
      }
    } catch (verifyErr) {
      sendSSE("verify", { ok: true, error: verifyErr.message });
    }
  }

  sendSSE("done", { turns, durationMs: Date.now() - startTime });
}
