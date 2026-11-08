// paaw-agent-tools.mjs — 2026-11-07 從 paaw-agent-loop.mjs 機械抽取（不改行為）
// PAAW_TOOLS：agent 可用工具的 schema 定義（純資料）
import { readFile, writeFile, readdir, stat, mkdir, rm } from "fs/promises";
import { cleanupProjectTempFiles } from "./temp-janitor.mjs";
import { existsSync, readFileSync as readSync, mkdirSync, appendFileSync, writeFileSync as writeSync, readdirSync, statSync } from "fs";
import { getModuleCrew } from "./module-registry.mjs";
import { loadFeatureData, matchFeaturesForFiles, buildContextBoundary } from "./feature-boundary.mjs";
import { exec as execCb } from "child_process";
import { runShellGrouped, runContextALS, sweepRunProcesses } from "./proc-ledger.mjs";
import { shellExec, IS_WIN as IS_WIN_SHARED } from "./shell-exec.mjs";
import { resolve, join, dirname, relative } from "path";
import { getDependencyContext, getAffectedTests } from "./dependency-context.mjs";
import { runTaskRetrofit } from "./task-retrofit.mjs";
import { fileURLToPath } from "url";
import { readFileSync as _readSync, existsSync as _exSync } from "fs";
import { join as _pathJoin, dirname as _pathDirname, basename as _pathBasename, extname as _pathExtname } from "path";
import { callLLMWithRetry, sanitizeContent, isMeaningfulContent, fetchStreamWithRetry } from "./llm-utils.mjs";
import { smartTruncateToolResult, truncateToolResultsInMessages, limitHistoryTurns, estimateTokens } from "./context-truncation.mjs";
import { compactIfNeeded, estimateMessageTokens, shouldCompact } from "./context-compaction.mjs";
import { messagesForModel, isVisionModel, hasImages, extractImageMarkers, buildImageAttachmentMessage, resolveVisionLlmConfig, visionAvailable } from "./vision-content.mjs";
import { startAgentLog } from "./agent-exec-logger.mjs";
import { createPaawProject } from "./paaw-project.mjs";
import { PaawSnapshot } from "./paaw-snapshot.mjs";
import { resolveDefaultModel, parseModelReference, jsonStringifySafe, cutSafeStart } from "./llm-utils.mjs";
import { toolRegistry } from "./tool-registry.mjs";
import { DATA_HOME, LOG_HOME, ASSET_LOGS_ROOT, logSlug } from "../data-home.mjs";
import { getBrowserPage, takeScreenshot, trackPage, readPageText, locateTarget, assertSafeUrl, browserState, PLAYWRIGHT_INSTALL_HINT, resolveBrowserKey, recordBrowserAction, takeActionShot, browserShotDir, getVisualMode, visualClick, } from "./browser-session.mjs";

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
          against: { type: "string", description: "Git ref to diff against (e.g. 'HEAD', 'main', 'dev') - defaults to working tree vs HEAD" },
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
      description: "Run a shell command and return stdout/stderr. Use for build, test, install, npm, pip, and any general shell operations. Timeout default: 30s. PROCESS RULE (hard-enforced): you may only manage the CURRENT release unit's dev server via the dev_server tool - pkill/killall/taskkill are blocked, kill only allows this RU's tracked dev-server pid, and the PAAW coding app itself (paaw-server, tPAAW vite, ports 4097/4098/4100/5173) must NEVER be started or stopped.",
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

  // ── Dev Server Controller(2026-09-10 Phase 1)──
  {
    type: "function",
    function: {
      name: "dev_server",
      description: "Manage this Release Unit's dev server (long-running process like `npm run dev` or `mvn spring-boot:run`). Detached background process - returns immediately, survives the agent session. Output goes to log/app-console/<ru>/app-console-YYYY-MM-DD.log which the human watches live in CodingIDE Terminal → Console → App view. Actions: start / stop / restart / status. restart has a crash-loop guard (max 5 per 10min). Hard-scoped to the CURRENT RU only - outside processes and the PAAW coding app itself can never be touched here. CRITICAL: after start/restart, ALWAYS call dev_log to verify the server actually booted (look for port listening / errors) before claiming success.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "stop", "restart", "status"], description: "What to do" },
          command: { type: "string", description: "Command to run for start/restart (default: npm run dev). Ignored for stop/status." },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dev_log",
      description: "Read this Release Unit's app console log (dev server output, app stdout/stderr). Use after dev_server start/restart to verify boot, or when debugging runtime issues. Modes: (1) plain tail - last N lines; (2) grep=KEYWORD - filter lines containing keyword (e.g. grep=error, grep=EADDRINUSE) and show the last N matches - the fastest way to find dev-time problems; (3) date=YYYY-MM-DD - read a specific day's log (history); (4) list=true - list available log files. Same source as the human's CodingIDE Terminal → Console → App view.",
      parameters: {
        type: "object",
        properties: {
          lines: { type: "number", description: "Number of tail lines / matches to return (default 100, max 400)" },
          grep: { type: "string", description: "Keyword filter (case-insensitive substring) - e.g. \"error\", \"exception\", \"fail\" to find dev-time problems fast" },
          date: { type: "string", description: "Read a specific day's log file (YYYY-MM-DD). Default: latest." },
          list: { type: "boolean", description: "List available log files (dates + sizes) instead of reading" },
        },
        required: [],
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
  // ── API Tester(2026-09-12 Fleming:developer agent 可用 API Tester,紀錄進 UI 歷史)──
  {
    type: "function",
    function: {
      name: "api_test",
      description: "Send an HTTP request via the built-in API Tester - same as the human's 🌐 API Tester tab. Every call is saved to the shared API Tester history (📜 in UI) with a 🤖 agent marker, so the human sees what you tested and can replay it. Use this instead of bash curl for API testing. Collections (2026-09-24): (1) listCollections=true lists all collections and their payloads; (2) run a saved payload by collection+name without url; (3) save=true with collection+name+method+url(+headers/body) saves a payload into a collection so the human can replay/organize it in the Collections tab - use this when the human asks you to add API test payloads. E2E workflow (tester): use project_info category=api_history to look up past requests (source=human shows what the human manually tested - detail=<N> returns the full headers/body they entered), then use those real payloads as seed data for e2e Playwright scripts, and use api_test to verify each API call the script will make.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], description: "HTTP method (default GET)" },
          url: { type: "string", description: "Full URL to request (e.g. http://localhost:4318/api/crew). Omit when running a saved payload via collection+name" },
          headers: { type: "object", description: "Request headers as key-value object (e.g. {\"Content-Type\":\"application/json\", \"Authorization\":\"Bearer x\"})" },
          body: { type: "string", description: "Request body (send JSON as string)" },
          collection: { type: "string", description: "Collection name - with name: run that saved payload; with save=true: target collection to store into" },
          name: { type: "string", description: "Payload name within the collection" },
          save: { type: "boolean", description: "true = save this request (method/url/headers/body) into collection+name instead of sending it. Overwrites same-name payload" },
          listCollections: { type: "boolean", description: "true = list all collections with their payloads (names/methods/urls)" },
          expectStatus: { type: "number", description: "Expected HTTP status code - report ✅/❌ pass/fail" },
          expectText: { type: "string", description: "Text expected in response body - report ✅/❌ pass/fail" },
        },
        required: [],
      },
    },
  },
  // ── Real Browser Tools (Playwright, JS-rendered pages, docs lookup, UI self-verification) ──
  {
    type: "function",
    function: {
      name: "browser_navigate",
      description: "Open a URL in the built-in headless Chromium browser (JS-rendered pages supported, unlike browser_test). Use for reading docs, npm/GitHub pages, or opening the local dev server preview to verify UI you built. Login sessions persist across runs. Returns page title + text excerpt. IMPORTANT: this browser is bound to the current release unit - open THE RELEASE UNIT'S own web pages (e.g. its dev server), NEVER the PAAW coding app's own UI. The human watches your steps as recorded replays, so navigate deliberately.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to open (http/https only)" },
          waitMs: { type: "number", description: "Extra ms to wait for JS rendering after load (default 800)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_read",
      description: "Read the visible text content of the current browser page (after JS rendering). Use after browser_navigate or actions to read page content.",
      parameters: {
        type: "object",
        properties: {
          maxLength: { type: "number", description: "Max chars to return (default 8000)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_screenshot",
      description: "Take a screenshot of the current browser page. Saved to data/logs/browser/ and shown in the IDE Browser tab. If a vision model is configured, the screenshot is ALSO attached to your context as an image so you can visually verify the page. Use to verify UI you built.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_click",
      description: "Click an element on the current browser page. Identify by CSS selector or by visible text. Returns page text excerpt after click.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector (e.g. \"button.submit\", \"#login\")" },
          text: { type: "string", description: "Visible text to click (e.g. \"Sign in\")" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_type",
      description: "Type text into an input field on the current browser page. Optionally press Enter to submit. Returns page text excerpt after typing.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the input (e.g. \"input[name=q]\")" },
          text: { type: "string", description: "Text to type" },
          submit: { type: "boolean", description: "Press Enter after typing (default false)" },
        },
        required: ["selector", "text"],
      },
    },
  },
  // 2026-09-12 Fleming:下拉式選單(native <select>)agent 竒操作 - 搭配 screencast 客製面板
  {
    type: "function",
    function: {
      name: "browser_select",
      description: "Select an option in a native <select> dropdown on the current browser page. Provide the CSS selector of the <select> and either the visible option label or the option value. Returns page text excerpt after selecting.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the <select> element (e.g. \"select#country\", \"select[name=locale]\")" },
          label: { type: "string", description: "Visible text of the option to select (e.g. \"Taiwan\")" },
          value: { type: "string", description: "Value attribute of the option to select" },
        },
        required: ["selector"],
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
    // ── QA Results - QA 記錄共享存儲(2026-09-17 Fleming:qa agent 留記錄、其他 agent 讀寫)──
    {
      type: "function",
      function: {
        name: "qa_record_save",
        description: "Save a QA result record to the shared QA log (.paaw/coding-memory/qa-results.jsonl) - visible to ALL agents and the human. Use after ANY testing/verification work: browser QA, smoke test, API test, code review verdict, e2e run. Records verdict (pass/fail), issues found (with severity + evidence like screenshot paths), and links to task/feature. This is the team's QA memory - ALWAYS record your test results here, never let them evaporate into chat history. IMPORTANT: the `feature` param must be copied VERBATIM from project_info(category=\"features\") name field - the Release Evidence Matrix joins on exact feature name; a paraphrased/blank/mistyped feature = that feature's QA evidence is LOST (shows ✗ even if you said PASS in chat).",
        parameters: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["pass", "fail", "warn", "blocked"], description: "Test verdict" },
            target: { type: "string", description: "What was tested (page/feature/API name, e.g. 'Login - RBAC redirect')" },
            summary: { type: "string", description: "One-paragraph conclusion of the test" },
            type: { type: "string", enum: ["browser", "smoke", "api", "review", "e2e", "manual"], description: "Test type" },
            url: { type: "string", description: "Tested URL (if applicable)" },
            taskId: { type: "string", description: "Related task id in the task pipeline (if applicable)" },
            feature: { type: "string", description: "Feature name copied VERBATIM from project_info(category=\"features\") name field (evidence matrix joins on exact name; do NOT paraphrase, abbreviate, or use the feature id)" },
            issues: {
              type: "array",
              description: "Issues found (empty for pass)",
              items: {
                type: "object",
                properties: {
                  severity: { type: "string", enum: ["critical", "major", "minor"] },
                  desc: { type: "string", description: "Issue description" },
                  evidence: { type: "string", description: "Evidence path (screenshot path, log line, API response)" },
                },
                required: ["desc"],
              },
            },
            evidence: { type: "array", items: { type: "string" }, description: "Evidence references (screenshot paths, api-tester ids)" },
            durationMs: { type: "number", description: "Test duration in ms (if known)" },
          },
          required: ["verdict", "target", "summary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "qa_record_list",
        description: "Search the shared QA results log (.paaw/coding-memory/qa-results.jsonl). Use before retesting (check what was already tested and its verdict), when fixing a bug (find related open issues), or when the human asks about QA status/history. Returns records newest-first with id, verdict, target, summary, open issues.",
        parameters: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["pass", "fail", "warn", "blocked"] },
            status: { type: "string", enum: ["open", "resolved", "wontfix"], description: "Filter by record status (open = has unresolved issues)" },
            actor: { type: "string", description: "Filter by who recorded it (qa/tester/developer/...)" },
            taskId: { type: "string" },
            feature: { type: "string" },
            q: { type: "string", description: "Free-text search in target/summary/issues" },
            limit: { type: "number", description: "Max records (default 10)" },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "qa_record_update",
        description: "Update an existing QA result record - mark an issue resolved/wontfix (after fixing it), change record status, or append a note (goes into history trail). Get the id from qa_record_list.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Record id (qr-...)" },
            issueIndex: { type: "number", description: "Issue index to update (0-based, from list output)" },
            issueStatus: { type: "string", enum: ["resolved", "wontfix", "open"] },
            status: { type: "string", enum: ["open", "resolved", "wontfix"], description: "Override record-level status (default: auto-resolved when all issues resolved)" },
            note: { type: "string", description: "Note for the history trail (e.g. 'fixed in commit abc123')" },
          },
          required: ["id"],
        },
      },
    },
    // ── Release Requests - v3(2026-09-18):RM agent 審 RR 證據、建議 verdict,人類做最終決定 ──
    {
      type: "function",
      function: {
        name: "rr_list",
        description: "List release requests (RR) for this project - the formal batch-release path. Returns id, title, status (draft/reviewing/released/cancelled), baseline→target, scope counts, checklist verdicts. Use when the human asks about release requests or which RR is in review.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["draft", "reviewing", "released", "cancelled"], description: "Filter by status" },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rr_get",
        description: "Get ONE release request with full evidence: scope (commits/files/features/APIs/tasks) + checklist with deterministic auto-check details (tests run numbers, gates status, open QA fails, risk reasons). Use BEFORE suggesting verdicts - your suggestions must be grounded in this evidence (No answer without evidence).",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "RR id (RR-...), from rr_list" },
          },
          required: ["id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rr_suggest",
        description: "Write suggested verdicts for a release request's checklist items (pass/fail/waived + reason each). This records SUGGESTIONS ONLY - the human confirms in the Release Manager UI; you never decide a release. Every suggestion MUST have a reason grounded in rr_get evidence. waive suggestions need a justification of why it is safe to ship despite the signal.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "RR id (RR-...)" },
            items: {
              type: "array",
              description: "One entry per checklist item you want to suggest on",
              items: {
                type: "object",
                properties: {
                  itemId: { type: "string", enum: ["tests", "gates", "qa-records", "risk"], description: "Checklist item id" },
                  verdict: { type: "string", enum: ["pass", "fail", "waived"], description: "Suggested verdict" },
                  reason: { type: "string", description: "Why - grounded in rr_get evidence (required)" },
                },
                required: ["itemId", "verdict", "reason"],
              },
            },
          },
          required: ["id", "items"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rr_create",
        description: "Create a NEW release request (RR) in draft status - the formal batch-release path. Baseline auto-resolves (last release > first commit). Agent may create the draft and review evidence, but NEVER apply/confirm/close - sign-off is human-only in the Release Manager UI. Refuses if a draft/reviewing RR already exists (use that one).",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "RR title, e.g. 'tpaaw-gateway 0.2.1 - Server Log 面板 + ISS-001'. Auto-generated if omitted." },
            baseline: { type: "string", enum: ["auto", "first-commit", "last-release"], description: "Baseline resolution (default auto)" },
          },
          required: [],
        },
      },
    },
    // ── API Map 歸類（2026-11-01 API-first，接棒 feature_map_update）— agent 給判斷，程式代寫 db ──
    {
      type: "function",
      function: {
        name: "api_map_update",
        description: "Register file→API mappings in THIS project's api_features table (API-first feature map). Use when RR api-map check lists unmapped delta files, or after creating files that belong to an API. The server writes coding.db (validated, idempotent) — never edit api data directly. apiId format A{YYYYMMDD}-{NNN} (get real ids from project_info(category=api_map)). After mapping, rr_get to confirm the api-map item turned green.",
        parameters: {
          type: "object",
          properties: {
            entries: {
              type: "array",
              description: "One per file to classify",
              items: {
                type: "object",
                properties: {
                  file: { type: "string", description: "Project-relative path, e.g. 'server.mjs'" },
                  apiId: { type: "string", description: "A{YYYYMMDD}-{NNN} — real id from project_info(category=api_map), never invent" },
                },
                required: ["file", "apiId"],
              },
            },
          },
          required: ["entries"],
        },
      },
    },
    // ── Unified docs tool (replaces update_changelog + update_docs) ──
    {
      type: "function",
      function: {
        name: "docs",
        description: "管理 .paaw/ 文件:更新 changelog、寫入/更新文件。用 action 指定操作。",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["changelog", "write", "append"], description: "changelog=加 changelog 條目, write=寫入文件, append=追加內容" },
            type: { type: "string", enum: ["added", "changed", "fixed", "removed", "deprecated"], description: "Changelog 類別(action=changelog 時必填)" },
            description: { type: "string", description: "Changelog 描述(action=changelog)或文件摘要" },
            file: { type: "string", description: "檔案名(action=write/append 時必填,如 PROJECT.md)" },
            content: { type: "string", description: "文件內容(action=write/append 時必填)" },
          },
          required: ["action"],
        },
      },
    },
    // ── Staged Summary Tool (for agents to record why they staged files) ──
    {
      type: "function",
      function: {
        name: "staged_summary",
        description: "記錄你這輪做了什麼、為什麼、怎麼測試。每次 git add / commit 前必須呼叫此工具(人類和 QA Agent 在 Git tab 看這份摘要決定可不可以 push)。",
        parameters: {
          type: "object",
          properties: {
            task: { type: "string", description: "原始任務描述(人類叫你做什麼)" },
            summary: { type: "string", description: "Work Summary 完整內容" },
            files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string", description: "檔案路徑" },
                  reason: { type: "string", description: "這個檔案為什麼改,一句話" },
                },
                required: ["path", "reason"],
              },
              description: "你改了哪些檔案 + 每個檔案為什麼改",
            },
            howToTest: { type: "string", description: "具體測試步驟,讓非寫碼的人也能照著做" },
            risk: { type: "string", description: "風險注意,沒有寫「無」" },
          },
          required: ["task", "summary", "files", "howToTest"],
        },
      },
    },
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
            enum: ["context", "issues", "features", "feature_detail", "api_map", "api_detail", "runbook", "sessions", "test_map", "recent_changes", "api_history", "project_read", "error_codes", "c4_model", "security", "decisions", "changelog"],
            description: "What to query: api_map=API Map（API-first）全部後端進入點（id+entry+分類；改碼/寫測試前先看這個）, api_detail=單一 API 的 process flow/validation/data touch/對應檔案（帶 entry=\"POST /api/xxx\"）, context=專案全貌（Feature Map + file→feature mapping + 自動摘要）— 了解專案/定位功能的第一步, features=feature map, feature_detail=single feature, runbook=troubleshooting, sessions=work sessions, test_map=test intelligence, recent_changes=change intelligence, api_history=API tester logs, project_read=PROJECT.md 全文（CU 自動初稿或人寫筆記，可能過期；以 feature map 為準）, error_codes=error codes by feature（寫碼前查既有 codes 不重複；debug 時帶 search=錯誤碼/訊息穩定片段反查 feature+file:line；帶 feature 看單一 feature）, c4_model=C4 對外連線全景（containers/external systems/relationships；帶 search 查特定服務）, security=security scan findings 明細（file:line + CWE + snippet + feature 對應；QA/SA 看 security 結果與開 task 的入口；帶 severity/file/search 過濾）, decisions=架構決策記錄 DECISIONS.md（ADR 清單與内文）, changelog=CHANGELOG.md 版本變更記錄"
          },
          id: { type: "string", description: "Feature/issue ID (正式格式 F{YYYYMMDD}-{NNN},如 F20260904-001;issue 為 ISS-001). 一律用 project_info 查現況,勿自編. Used with category=feature_detail." },
          entry: { type: "string", description: "API entry (e.g. \"POST /api/xxx\") — used with category=api_detail." },
          search: { type: "string", description: "Search keyword. Used with: features (by name), runbook (by content), faq (by keyword), error_codes (錯誤碼/訊息片段反查 - debug 入口), c4_model (服務名/技術,如 redis)." },
          code: { type: "string", description: "Error code for runbook lookup (e.g. ORD-001)." },
          name: { type: "string", description: "Standard name to read (for category=standards). If omitted, lists all." },
          status: { type: "string", description: "Filter issues by status (comma-separated): open,in-progress,resolved,closed,wontfix." },
          priority: { type: "string", description: "Filter issues by priority (comma-separated): critical,high,medium,low." },
          severity: { type: "string", description: "Filter security findings (case-insensitive): critical,error,warning,info." },
          file: { type: "string", description: "File path filter. Used with: test_map (which tests cover this file), security (findings for file), recent_changes (impact of file)." },
          feature: { type: "string", description: "Feature ID. Used with: test_map (list all tests for that feature), error_codes (codes for that feature)." },
          days: { type: "number", description: "Days back for recent_changes (default: 30)." },
          limit: { type: "number", description: "Max results for sessions/api_history (default: 5/20)." },
          method: { type: "string", description: "Filter api_history by HTTP method." },
          source: { type: "string", enum: ["human", "agent"], description: "Filter api_history by who ran it: human (manually in API Tester UI) or agent (via api_test tool)." },
          detail: { type: "string", description: "api_history only: entry number (1-based) or req-id - returns the FULL request (headers/body/response) for e2e script generation." },
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
            enum: ["issue_create", "issue_update", "issue_delete", "change_record", "feature_update_docs", "feature_update_mapping", "feature_delete", "run_command"],
            description: "Mutation action to perform",
          },
          // ── Issue create/update/delete ──
          id: { type: "string", description: "Issue/feature ID (ISS-001;feature 正式格式 F{YYYYMMDD}-{NNN} 如 F20260904-001,勿自編)" },
          title: { type: "string", description: "Issue title or change title" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Priority" },
          status: { type: "string", enum: ["open", "in-progress", "resolved", "closed", "wontfix"], description: "Issue status" },
          labels: { type: "array", items: { type: "string" }, description: "Labels" },
          description: { type: "string", description: "Detailed description" },
          note: { type: "string", description: "Add a note to issue" },
          featureId: { type: "string", description: "Related feature ID" },
          // ── Change record ──
          type: { type: "string", enum: ["feature", "bugfix", "refactor", "security", "performance", "test", "docs", "config"], description: "Change type" },
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

  // ── Project Board tool(維護 data/projects/ 的專案看板 - 一個 release unit 對應一個 project)──
  {
    type: "function",
    function: {
      name: "project_board",
      description: "維護 PAAW Project Board(data/projects/)。一個 release unit 對應一個 project。新 RU 開始時用 create 建 project,之後用 task_create/task_update 維護任務進度。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["status", "create", "update", "category_create", "task_create", "task_update", "milestone_create"],
            description: "status=查看全部專案現況, create=建新 project(新 RU), update=改專案欄位, category_create=加分類, task_create=加任務, task_update=改任務, milestone_create=加里程碑",
          },
          projectId: { type: "string", description: "目標 project ID(status/create 以外必填)" },
          // create / update
          id: { type: "string", description: "(create) 新 project ID,英文小寫" },
          name: { type: "string", description: "(create/update) 專案名稱;task_create/task_update 為任務名稱" },
          icon: { type: "string", description: "(create/category_create) emoji icon" },
          description: { type: "string", description: "(create/update/category_create) 描述" },
          status: { type: "string", description: "(update) planning|in-progress|completed|on-hold|cancelled;(task_update) todo|progress|done" },
          startDate: { type: "string", description: "(create) YYYY-MM-DD" },
          targetDate: { type: "string", description: "(create/update) YYYY-MM-DD" },
          repo: { type: "string", description: "(create) GitHub repo URL" },
          aliases: { type: "array", items: { type: "string" }, description: "(create) 本機資料夾名 alias(跨機器對應 RU 用,例如 ['tPAAW'])" },
          // category
          categoryId: { type: "string", description: "(task_create) 放進哪個分類,省略放第一個" },
          // task
          taskId: { type: "string", description: "(task_update) 任務 ID" },
          priority: { type: "string", enum: ["high", "medium", "low"], description: "(task_create/task_update) 優先級" },
          start: { type: "string", description: "(task_create) YYYY-MM-DD" },
          end: { type: "string", description: "(task_create) YYYY-MM-DD" },
          // milestone
          date: { type: "string", description: "(milestone_create) YYYY-MM-DD" },
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
      description: "Refresh specific Code Understanding steps after code changes. Use this after making significant code changes instead of re-running the entire CU flow. Deterministic steps (code-intelligence, test-intelligence) are fast and safe to re-run. Add feature-map to re-run the feature map (LLM).",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: { type: "string", enum: ["code-intelligence", "test-intelligence", "feature-map"] },
            description: "Which steps to refresh. Default: deterministic steps (code-intelligence, test-intelligence). Add feature-map only if features/APIs changed significantly (costs LLM).",
          },
        },
      },
    },
  },

  // ── Handover 沉澱寫入（2026-10-09 Fleming：AI 對話式把盤點/地雷圖寫進 HANDOVER.md，需使用者同意）──
  {
    type: "function",
    function: {
      name: "handover_write",
      description: "將交接沉澱（接手者地雷圖、風險盤點、接手指南）寫入 .paaw/HANDOVER.md。僅在使用者明確同意後呼叫；寫入前自動備份舊檔（.bak）。內容會整檔覆寫。",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "完整 markdown 內容" },
        },
        required: ["content"],
      },
    },
  },

  // ── TS Guide 沉澱（ops/helpdesk agent — 2026-10-10 Fleming：AI 漏寫 SOP 隨時補）──
  {
    type: "function",
    function: {
      name: "trouble_write",
      description: "新增或更新 TS Guide 排障條目（.paaw/troubleshooting/TSGUIDE.json）。action=add 新增（status=human 人工權威，重新生成永不覆蓋）；action=update 補修既有條目的 SOP（symptom/fixSteps）。使用者說「把這個修法加進 TS guide」「補一下這條的步驟」時呼叫。fixSteps 每一步是陣列一項。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "update"], description: "add=新條目 / update=改既有（需 id）" },
          id: { type: "string", description: "update 時的條目 id" },
          symptom: { type: "string", description: "症狀 — 使用者看得到的（錯誤訊息/異常行為）" },
          cause: { type: "string", description: "根本原因" },
          fixSteps: { type: "array", items: { type: "string" }, description: "修復步驟（每步一項）" },
          evidenceText: { type: "string", description: "證據出處（git hash / 今天修的 / 對話脈絡 — 沒有就寫來源描述）" },
          feature: { type: "string", description: "相關 feature 名（選填）" },
        },
        required: ["action", "symptom"],
      },
    },
  },

  // ── Action Log (Agent Memory / Handoff) ──
  {
    type: "function",
    function: {
      name: "action_log_add",
      description: "Record your action to the project action log. This is the handoff log between agents - write after completing a task so other agents know what you did.",
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
      description: "Read recent action log entries. This shows what other agents (and you) have done recently - the project handoff log.",
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
  // ── Conversation History(2026-09-06 Fleming:每個 agent 都能查過去聊天記錄,RU 開發紀錄全保留)──
  {
    type: "function",
    function: {
      name: "conversation_history",
      description: "查過去的聊天記錄(跨 session,含已封存)。action: list=列出自己的對話 sessions;load=讀某 session 完整內容;search=關鍵字搜尋對話(預設搜全部 agent)。找「之前聊過什麼、決定了什麼」用這個。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "load", "search"], description: "list=列出 sessions;load=讀完整對話;search=關鍵字搜尋" },
          sessionId: { type: "string", description: "load 時要讀的 session id(來自 list 結果;active=目前對話)" },
          query: { type: "string", description: "search 時的關鍵字" },
          crewId: { type: "string", description: "選配:指定查其他 agent(如 coding.em);search 未指定時搜全部" },
        },
        required: ["action"],
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

  // ── Task Management Tools ──
  {
    type: "function",
    function: {
      name: "reference_read",
      description: "Browse and read reference files from knowledge/ and project workspace directories (read-only). Use this to find existing code examples, architecture docs, templates, and reference materials. knowledge = data/knowledge/ (shared docs), workspace = directories declared in this project's 📁 File Mounts (data/workspaces.json; falls back to PAAW global mounts). Multi-mount supported: workspace list shows all mounts by directory name; read/list/search with '<mount-name>/' prefix targets a specific mount; without prefix, each mount is tried in order. Cross-RU reference = declare it in File Mounts first.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "read", "search"], description: "list: browse files in a directory, read: read a specific file, search: search file contents" },
          source: { type: "string", enum: ["workspace", "knowledge"], description: "knowledge = data/knowledge/ project docs, workspace = project root directory with source code" },
          path: { type: "string", description: "For list: subdirectory path (e.g. 'Pics' or ''). For read: file path. For search: search query." },
          maxResults: { type: "number", description: "For search: max results (default 20)" },
        },
        required: ["action", "source"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_list",
      description: "List coding tasks (feature-first). Filter by status, type, featureId, or priority. Read single task by ID. Status: open|close|pending|ignore. Type: dev|test|docs.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Get a single task by ID (e.g. 'TASK-014')" },
          status: { type: "string", description: "Filter by status: open, close, pending, ignore" },
          type: { type: "string", description: "Filter by type: dev, test, docs" },
          featureId: { type: "string", description: "Filter by feature ID (e.g. 'F20260901-001')" },
          priority: { type: "string", description: "Filter by priority: critical, high, medium, low" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_create",
      description: "Create a new coding task. Every task MUST have a featureId (all work belongs to a feature). Status: open|close|pending|ignore. Type: dev|test|docs.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          featureId: { type: "string", description: "REQUIRED. Feature this task belongs to (e.g. 'F20260901-001'). Misc work → use 'Utility & Platform Misc' feature." },
          type: { type: "string", enum: ["dev", "test", "docs"], description: "Task type: dev (code/bugfix/refactor), test, docs" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Priority level" },
          description: { type: "string", description: "Detailed description of what needs to be done" },
          parentId: { type: "string", description: "Parent task ID (for subtasks from decompose)" },
          source: { type: "string", enum: ["vibe", "discussion", "pm", "issue", "security", "manual"], description: "Where this task came from" },
          labels: { type: "array", items: { type: "string" }, description: "Labels/tags" },
        },
        required: ["title", "featureId", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_update",
      description: "Update a coding task. Actions: update (change fields), note (add note), assign (assign agent). No pipeline - use status directly (open|close|pending|ignore).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task ID to update" },
          action: { type: "string", enum: ["update", "note", "assign"], description: "What to do: update fields, add note, or assign agent" },
          title: { type: "string", description: "New title (action=update)" },
          status: { type: "string", description: "New status (action=update): open, close, pending, ignore" },
          type: { type: "string", description: "New type (action=update): dev, test, docs" },
          featureId: { type: "string", description: "Reassign to different feature (action=update)" },
          priority: { type: "string", description: "New priority (action=update)" },
          result: { type: "string", description: "Execution result summary (action=update)" },
          note: { type: "string", description: "Note content (action=note)" },
          assignTo: { type: "string", description: "Assign to agent (action=assign): developer, tester, doc-writer, architect" },
        },
        required: ["id", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_decompose",
      description: "將一個大 Task 拆分成多個子任務。子任務繼承父任務的 featureId。",
      parameters: {
        type: "object",
        properties: {
          parentId: { type: "string", description: "要拆分的父 Task ID" },
          subTasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "子任務標題" },
                type: { type: "string", enum: ["dev", "test", "docs"], description: "子任務類型" },
                priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                assignee: { type: "string", description: "指派對象" },
                description: { type: "string", description: "子任務詳細說明" },
              },
              required: ["title"],
            },
            description: "拆分後的子任務列表",
          },
        },
        required: ["parentId", "subTasks"],
      },
    },
  },
    {
    type: "function",
    function: {
      name: "dispatch_agent",
      description: "派工給其他 agent 執行任務。一次只派一個 agent,等結果回來再派下一個。",
      parameters: {
        type: "object",
        properties: {
          agentId: {
            type: "string",
            enum: ["architect", "developer", "tester", "doc-writer", "qa", "helpdesk"],
            description: "目標 agent",
          },
          task: {
            type: "string",
            description: "具體任務說明(要明確:哪個檔案、哪個函數、要做什麼)",
          },
          taskId: {
            type: "string",
            description: "對應的 TASK-XXX ID(如果有)",
          },
        },
        required: ["agentId", "task"],
      },
    },
  },

  // ── 網路白名單自動放行（2026-10-11 Fleming）：沙箱擋住時 EM 自行解除，避免夜間自動卡住 ──
  {
    type: "function",
    function: {
      name: "network_allow",
      description: "把目標網域加入 PAAW 沙箱對外白名單（自訂層）— 人類專用，未授權任何 agent；白名單不可自我解除（Fleming 2026-10-11）。",
      parameters: {
        type: "object",
        properties: {
          host: { type: "string", description: "要放行的網域（host），例如 api.example.com" },
          reason: { type: "string", description: "為什麼要放行（會寫入 audit）" },
        },
        required: ["host"],
      },
    },
  },

  // ── Auto Dispatch(task-driven,EM 自然語言確認制派工,2026-08-29)──
  // 一律走 API(/preview、/start、/stop)- 跟 cron / panel / EM chat 同一條路
  {
    type: "function",
    function: {
      name: "auto_dispatch",
      description: "自動派工(task-driven):掃 TASKS.json 的 open task,背景逐一派給 agent 執行(每個 task 獨立 context,可長時間跑完,最後統整報告)。流程:action=preview 先看範圍(不執行)→ 向使用者展示待確認 → 使用者確認後 action=start 開始 → 要停就 action=stop(安全中斷點)。大範圍派工優先用這個,不要逐個 dispatch_agent。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["preview", "start", "stop"], description: "preview=看派工範圍(不執行);start=背景開始執行;stop=中斷(目前 task 完成後停止)" },
          cwd: { type: "string", description: "專案 root 絕對路徑(帶 system prompt 裡 Current Project Root 的值)" },
        },
        required: ["action"],
      },
    },
  },

  // ── Release Unit Tools(Tool 化三防線:context / impact / verify)──
  {
    type: "function",
    function: {
      name: "ru_context",
      description: "Release Unit context - 讀專案技術桡 + .paaw 三大文件(PROJECT/ARCHITECTURE/DECISIONS)。改碼前必讀。",
      parameters: {
        type: "object",
        properties: {
          withDocs: { type: "boolean", description: "是否帶入文件全文(預設只回清單+規範)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ru_dependencies",
      description: "查檔案依賴:我 import 誰(forward)、誰 import 我(reverse)、用了哪些外部套件。",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "檔案路徑(相對/絕對/檔名皆可)" },
        },
        required: ["file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ru_impact_analysis",
      description: "改動影響分析(改前必跑):給定檔案清單,回傳直接/間接受影響的檔案(含深度)與樞紐熱點。",
      parameters: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" }, description: "預計改動的檔案清單" },
          changeType: { type: "string", enum: ["modify", "add", "delete"], description: "改動類型(預設 modify)" },
        },
        required: ["files"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ru_verify",
      description: "驗證(改完必跑):執行 build/lint/type-check/test,回傳每關結果與失敗輸出。",
      parameters: {
        type: "object",
        properties: {
          checks: { type: "array", items: { type: "string", enum: ["build", "lint", "type-check", "test"] }, description: "指定關卡(預設全部)" },
        },
      },
    },
  },

  // ── Release Prep(2026-09-18 Fleming:跟 EM 說「準備 release」→ 自動派工補齊證據)──
  {
    type: "function",
    function: {
      name: "release_prep_status",
      description: "Release 準備盤點:git 乾淨度、open tasks、七項證據現況(測試/QA/掃描/verify/handover)一次看。準備 release 的第一步。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "test_run",
      description: "跑全套測試(unit + e2e),結果落檔 .paaw(Release Request tests 項證據)。",
      parameters: {
        type: "object",
        properties: {
          includeE2e: { type: "boolean", description: "含 e2e(預設 true)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "multi_model_review",
      description: "🏛️ 召開 review 委員會 — 多位 AI 資深 reviewer（EM reviewConfig.reviewModels 指定，沒開 multiAgentReview 就單席）各自獨立審同一段 code，互不通氣；程式當仲裁：行號驗證退件幻覺、同位置 ±3 行併合標「🤝共識」、跨 model 意見相左標「🚩分歧」待人裁。判 critical → 自動開打回單派給 developer 帶必修清單。report 落檔 .paaw/review-board/。使用者說「審一下 / 委員會 review / review board / 幫我 review 這個 commit」就開會，預設審最後一個 commit。",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "git range，預設 HEAD~1..HEAD（最後一個 commit）。例：HEAD~3..HEAD" },
          path: { type: "string", description: "限定審查路徑（可選），例 packages/server/" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "security_scan",
      description: "semgrep 安全掃描,結果落檔 .paaw/security/scan-results.json(Release Request security 項證據)。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "ru_model_refresh",
      description: "重建 release-unit model(feature map - features/apis 結構)。Release Request scope 的 features/apis 統計靠它,release 準備時先刷新再跑證據。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "handover_refresh",
      description: "刷新 handover state(.paaw/handover-state.json 對齊當下 HEAD - Release Request handover 項證據)。",
      parameters: { type: "object", properties: {} },
    },
  },

  ];

// ── Tool Group System - load only what each agent needs ──

// Tool name → group mapping
// ── 工具執行逾時 / 中斷競速（2026-10-11 Fleming：browser_click 卡死且無法中斷）──
// stream 路徑原本完全沒有工具逾時 → 工具一卡（Playwright 卡在 dialog/導航）= run 永遠卡死；
// 且 abortSignal 只傳給 callLLM，工具在跑時「中斷」等於沒按。
/** 2026-10-13：審批卡等待預算 — bash 工具執行上限要額外加上「等人按鈕」的時間，
 *  否則 120s 的 tool timeout 會在等待中途把 agent 砍掉。與 exec-approvals.waitForDecision 同口徑。*/
const APPROVAL_WAIT_BUDGET_MS = Math.max(10_000, Number(process.env.PAAW_APPROVAL_WAIT_MS) || 180_000);

export { PAAW_TOOLS };
