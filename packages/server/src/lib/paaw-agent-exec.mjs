// paaw-agent-exec.mjs — 2026-11-07 從 paaw-agent-loop.mjs 機械抽取（不改行為）
// 工具執行層：executeTool + shell/test/glob/grep helpers + timeout 控制 + agent config
import { _PAAW_ROOT } from "./paaw-agent-loop.mjs"; // live binding（循環引用安全：僅 runtime 存取）
import { readFile, writeFile, readdir, stat, mkdir, rm } from "fs/promises";
import { cleanupProjectTempFiles } from "./temp-janitor.mjs";
import { existsSync, readFileSync as readSync, mkdirSync, appendFileSync, writeFileSync as writeSync, readdirSync, statSync } from "fs";
import { getModuleCrew } from "./module-registry.mjs";
import { loadFeatureData, matchFeaturesForFiles, buildContextBoundary } from "./feature-boundary.mjs";
import { exec as execCb } from "child_process";
import { runShellGrouped, runContextALS, sweepRunProcesses } from "./proc-ledger.mjs";
import { shellExec, IS_WIN, IS_WIN as IS_WIN_SHARED } from "./shell-exec.mjs";
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

const APPROVAL_WAIT_BUDGET_MS = Math.max(10_000, Number(process.env.PAAW_APPROVAL_WAIT_MS) || 180_000);

function toolExecTimeoutMs(toolName, args, agentCfg) {
  const n = String(toolName || "");
  if (n === "bash") return Math.min(((args?.timeout || 120) * 1000), (agentCfg?.bashTimeoutSeconds || 300) * 1000, 300_000) + APPROVAL_WAIT_BUDGET_MS;
  if (n === "test_run" || n === "security_scan" || n === "handover_refresh" || n === "release_prep_status" || n === "ru_model_refresh") return 660_000;
  if (n === "api_test" || n === "multi_model_review") return 180_000;
  if (n === "browser_navigate") return 60_000;
  if (n.startsWith("browser_")) return 45_000;
  if (n === "dev_server" || n === "dev_log") return 60_000;
  // 2026-10-17 Fleming：修復型單實測 developer 200~400s（TASK-047 R4 = 234s）、QA 重審可達 956s —
  // 舊預設 120s 必逾時（不是 agent 能力問題）。dispatch_agent 上限改 30 分鐘（引擎內部 em-foreman 路徑本來就 2h，不受此限）。
  if (n === "dispatch_agent") return 1_800_000;
  return 120_000;
}

/** 讓工具執行可被 abortSignal 立即中斷（底層 op 可能還在跑，但 loop 不再等它）*/
function raceAbortTool(promise, abortSignal, toolName) {
  if (!abortSignal) return promise;
  return new Promise((resolve, reject) => {
    const mk = () => Object.assign(new Error(`Tool '${toolName}' aborted by user`), { name: "AbortError" });
    if (abortSignal.aborted) return reject(mk());
    const onAbort = () => reject(mk());
    abortSignal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (v) => { abortSignal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { abortSignal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

const TOOL_GROUP_MAP = {
  // Core: full file ops + shell + git
  read_file: "core", write_file: "core", edit_file: "core",
  glob: "core", grep: "core", diff: "core",
  reference_read: "core",
  git: "core", bash: "core", ask_user: "core",

  // Dev Server Controller(2026-09-10)- core:developer/tester 可用;core-read 只給 dev_log(唯讀)
  dev_server: "core", dev_log: "core",
  // 2026-09-12:API Tester tool - developer/tester 都在 core group,可直接打 API 並存入 UI 共用歷史
  api_test: "core",

  // Browser testing
  browser_test: "browser",
  browser_navigate: "browser",
  browser_read: "browser",
  browser_screenshot: "browser",
  browser_click: "browser",
  browser_type: "browser",
  browser_select: "browser",

  // Handover 沉澱（handover agent 專用）
  handover_write: "handover",

  // TS Guide 沉澱（ops/helpdesk agent — 2026-10-10）
  trouble_write: "trouble",

  // Memory & logging
  action_log_add: "memory", action_log_list: "memory",
  agent_memory_save: "memory", agent_memory_load: "memory",
  conversation_history: "memory", // 2026-09-06:聊天記錄查詢(memory group → 全 crew 可用)

  // Decision & changelog
  record_decision: "decisions", docs: "decisions",

  // Multi-model code review (MR1 2026-10-03) — qa-records group：QA/EM/architect 可用
  multi_model_review: "qa-records",

  // QA Results - QA 記錄共享存儲(2026-09-17 Fleming:qa agent 留記錄、其他 agent 讀寫)
  qa_record_save: "qa-records", qa_record_list: "qa-records", qa_record_update: "qa-records",

  // Release Requests - v3(2026-09-18):RM agent 讀 RR 證據、寫建議 verdict(人確認)
  rr_list: "release-requests", rr_get: "release-requests", rr_suggest: "release-requests", rr_create: "release-requests",

  // Release Prep - v4(2026-09-18):EM「準備 release」自動補證據(受控工具,不開 bash)
  release_prep_status: "release-prep", test_run: "release-prep", security_scan: "release-prep", handover_refresh: "release-prep", ru_model_refresh: "release-prep",
  // API map 歸類（2026-11-01 API-first）— 同 release-prep 哲學：受控寫入，不開直改檔案
  api_map_update: "release-prep",

  // Staged summary (agents record why they staged files)
  staged_summary: "core",

  // Project Info - unified tool (replaces 14 separate project_* read tools)
  project_info: "project",

  // Project edit - unified mutation tool
  project_edit: "project-edit",

  // Project Board - 維護 data/projects/ 專案看板(RU 對應 project)
  project_board: "project-board",

  // Notes
  notes: "notes",

  // Task management
  task_create: "tasks", task_update: "tasks", task_list: "tasks", task_decompose: "tasks", dispatch_agent: "dispatch", auto_dispatch: "dispatch",

  // Security - 網路白名單管理（EM 自動解除沙箱阻擋，2026-10-11）
  network_allow: "security",

  // Docs & CU
  cu_refresh: "docs",

  // Release Unit tools - 2026-09-18 修復:這四個一直沒掛進 TOOL_GROUP_MAP,
  // release-unit group 是空的 → ru_verify 對所有 agent 都不可見(含 fallback 列了它的 em/developer/qa)
  ru_context: "release-unit", ru_dependencies: "release-unit", ru_impact_analysis: "release-unit", ru_verify: "release-unit",
};

// ── core-read: read-only subset of core (no bash/write/edit/git) ──
// For non-coding agents: architect, QA, helpdesk, EM
// 2026-10-22 Fleming 報案：EM/QA 等 core-read agent 被人要求「寫 http request 進 API Tester collection」，
// 但 api_test 在 core group 看不到 → LLM 幻覺「已寫入」。對策：api_test 納入 core-read
//（打 API 測試/存 collection 是通用能力；每次呼叫都落 history 帶 🤖 agent 標記，人看得到）
const CORE_READ_TOOLS = new Set(["read_file", "reference_read", "glob", "grep", "diff", "ask_user", "dev_log", "api_test"]);

// ── Fallback groups (used when crew.json has no toolGroups) ──
const AGENT_FALLBACK_GROUPS = {
  // Architect: read-only + decisions + project + project-board(維護 RU project)+ tasks(security 修復開 task - 2026-09-06)
  architect: ["core-read", "memory", "decisions", "project", "project-edit", "project-board", "tasks", "release-unit", "qa-records"],
  // Developer: full core + memory + project + tasks
  developer: ["core", "memory", "decisions", "project", "project-edit", "tasks", "release-unit", "qa-records"],
  // Tester: full core + project
  tester: ["core", "memory", "decisions", "project", "project-edit", "release-unit", "qa-records"],
  // Doc-writer: full core + project-edit + docs
  "doc-writer": ["core", "memory", "decisions", "project", "project-edit", "docs", "qa-records"],
  // CU feature 長肉 agent(feature-map v2.1):純唯讀分析 - read_file/glob/grep/diff,無寫檔無 shell
  "cu-feature": ["core-read"],
  // QA: read-only + project + project-edit + tasks(security findings 開修復 task - 2026-09-06)
  qa: ["core-read", "memory", "project", "project-edit", "tasks", "release-unit", "qa-records"],
  // Helpdesk: read-only + project
  helpdesk: ["core-read", "memory", "decisions", "project", "project-edit", "qa-records"],
  // RM(fallback):v3(2026-09-18)+ release-requests(審 RR 證據、寫建議 verdict)
  rm: ["core-read", "memory", "decisions", "project", "docs", "release-requests", "release-prep"],
  // EM: read-only + project + project-edit + docs + tasks + dispatch (no notes/browser)
  em: ["core-read", "memory", "decisions", "project", "project-edit", "project-board", "docs", "tasks", "dispatch", "release-unit", "qa-records", "release-requests", "release-prep"],
};

// ── Cache for crew toolGroups loaded from JSON ──
export const _crewGroupCache = new Map();
// ── Cache for crew toolsDeny（2026-10-09：per-crew 工具黑名單 — 代碼保證，不靠 prompt 自律）──
const _crewDenyCache = new Map();
/** agentId → crewId。2026-10-13：未註冊的 `<module>.<name>` 動態 agent（如 sre.*）視為同名 crew。 */

const LOG = (...args) => { if (process.env.PAAW_DEBUG) console.log("[agent-loop]", ...args); };

// Module-level agent config defaults (used by runShell + executeTool)
const _agentCfgDefaults = { maxTurns: 200, timeoutSeconds: 0, bashTimeoutSeconds: 300, shellTimeoutMs: 1200000 };
let _agentCfg = { ..._agentCfgDefaults };
function setAgentConfig(cfg) { _agentCfg = { ..._agentCfgDefaults, ...cfg }; }

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
    // Might be a real failure or just noise - be conservative
    if (out.includes("failed") || out.includes("test suite failed")) {
      return { ok: false, failed: 1, total: 1 };
    }
  }

  // Check for success patterns
  if (out.includes("passed") || out.includes("all tests passed") || out.includes("✓") || out.includes("✔")) {
    const totalMatch = out.match(/(\d+)\s+passed/);
    return { ok: true, failed: 0, total: parseInt(totalMatch?.[1] || "1") };
  }

  // No recognizable pattern - assume pass if exit code was ok (we already ran it successfully)
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

// ── Native Node.js helpers (Windows-safe, no shell) ──

async function _nativeGlob(basePath, pattern, maxResults = 100, cwd = basePath) {
  const results = [];
  const normPattern = pattern.replace(/\*\*\//g, "").replace(/\*\*/g, "*").replace(/\*/g, ".*").replace(/\?/g, ".");
  const regex = new RegExp(normPattern + "$", "i");  // nosemgrep: detect-non-literal-regexp
  const skipDirs = new Set(["node_modules", ".git", "dist", ".next", ".paaw", "__pycache__", ".cache", ".turbo"]);
  // Normalize cwd for relative path calculation (handle Windows backslashes)
  const normCwd = cwd.replace(/\\/g, "/");
  async function walk(dir, depth) {
    if (results.length >= maxResults || depth > 15) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= maxResults) return;
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) await walk(join(dir, e.name), depth + 1);
      } else if (regex.test(e.name)) {
        // Return relative path from cwd (use forward slashes for cross-platform)
        const full = join(dir, e.name).replace(/\\/g, "/");
        const rel = full.startsWith(normCwd + "/") ? full.slice(normCwd.length + 1) : e.name;
        results.push(rel);
      }
    }
  }
  await walk(basePath, 0);
  return results.join("\n") || "(no files found)";
}

async function _nativeGrep(searchPath, pattern, include, maxResults = 50, ignoreCase = true, cwd = searchPath) {
  const results = [];
  const flags = ignoreCase ? "i" : "";
  let regex;
  try { regex = new RegExp(pattern, flags); } catch { regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags); }  // nosemgrep: detect-non-literal-regexp
  const includeRegex = include ? new RegExp(include.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i") : null;  // nosemgrep: detect-non-literal-regexp
  const skipDirs = new Set(["node_modules", ".git", "dist", ".next", ".paaw", "__pycache__", ".cache", ".turbo"]);
  const normCwd = cwd.replace(/\\/g, "/");
  async function walk(dir, depth) {
    if (results.length >= maxResults || depth > 15) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= maxResults) return;
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) await walk(join(dir, e.name), depth + 1);
      } else {
        if (includeRegex && !includeRegex.test(e.name)) continue;
        try {
          const content = await readFile(join(dir, e.name), "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            if (regex.test(lines[i])) {
              const full = join(dir, e.name).replace(/\\/g, "/");
              const rel = full.startsWith(normCwd + "/") ? full.slice(normCwd.length + 1) : e.name;
              results.push(`${rel}:${i + 1}:${lines[i].trim().slice(0, 200)}`);
            }
          }
        } catch {}
      }
    }
  }
  await walk(searchPath, 0);
  return results.join("\n") || "(no matches)";
}

async function runShell(command, cwd, timeoutMs = 30_000, opts = {}) {
  try {
    // Runtime log 中央目錄注入(2026-09-06):agents 在 RU 目錄跑,但要能寫 log/<sub>/<ru>/
    // - $PAAW_LOG_HOME           → log/ 根(generic)
    // - $PAAW_TMP                → log/tmp/<ru-slug>/(agent scratch,session 自動清)
    // - $PAAW_APP_CONSOLE_DIR    → log/app-console/<ru-slug>/(developer 啟動 app 的 nohup 輸出)
    const _ruSlug = logSlug(cwd);
    // 2026-09-27 OOM 治本：改走 proc-ledger 的 process group 執行 —
    // timeout 殺整棵樹（不留孤兒）；背景殘留記帳，agent run 結束時精準掃殺
    // （runId 由 proc-ledger 從 AsyncLocalStorage 讀 — runAgentLoop 進場時掛的）
    // ── 沙箱 v4（2026-10-13 Fleming：MXC 單後端，macOS 也走 MXC — 一套邏輯跨平台一致）──
    // MXC 可用 → execSandboxed：fs default-deny allowlist + egress deny-by-default
    //   （npm/pip/git 等命令 needsNetworkAllow → allow，執行後 scanCommandOutput 審計）
    //   ⚠️ MXC 路徑不走 proc-ledger 記帳（MXC SDK 自管 timeout 殺整組）
    // 不可用（未裝／🛠 開發模式／PAAW_SANDBOX=off）→ 下方 runShellGrouped 原樣執行（pattern 掃描仍在）
    try {
      const { mxcAvailable, execSandboxed, needsNetworkAllow } = await import("./paaw-sandbox.mjs");
      if (await mxcAvailable()) {
        const r = await execSandboxed(command, {
          cwd,
          timeoutMs: Math.min(timeoutMs, _agentCfg.shellTimeoutMs || 600_000),
          env: {
            PAAW_LOG_HOME: LOG_HOME,
            PAAW_TMP: join(LOG_HOME, "tmp", _ruSlug),
            PAAW_APP_CONSOLE_DIR: join(LOG_HOME, "app-console", _ruSlug),
          },
          network: needsNetworkAllow(command) ? "allow" : "deny",
          // 2026-10-24（RU 隔離模型）：File Mounts 宣告目錄 → MXC 唯讀掛載（bash 也能 RO 讀）
          // 2026-11-04 fix：runShell 是 module-level 函式看不到 runAgentLoop 的 externalReadOnlyDirs
          //（原本 ReferenceError 被 catch 吃掉 → MXC 沙箱路徑整個靜默跳過）→ 改由 opts 傳入
          readonlyDirs: opts.readonlyDirs || [],
        });
        let out = (r.stdout || "") + (r.stderr ? "\n" + r.stderr : "");
        if (r.timedOut) out += (out ? "\n" : "") + "⏱ 沙箱內逾時（MXC）";
        if (r.code !== 0) out += (out ? "\n" : "") + `Exit code: ${r.code ?? 1}`;
        // 2026-10-13：沙箱標記只給 user 可見的 bash tool（opts.marker）——
        // glob/grep/diff/git/test_run 等等是**結構化輸出消費端**，多一行標記會被當成檔案/匹配行。
        return opts.marker ? (out || "(no output)") + "\n🛡沙箱內（MXC）" : (out || "(no output)");
      }
    } catch { /* MXC 失敗 → 原樣執行（不擋路） */ }
    // 無沙箱原樣執行（proc-ledger process group 記帳，timeout 殺整棵樹）
    const _cmd = command;
    const { stdout, stderr, code } = await runShellGrouped(_cmd, {
      cwd,
      timeoutMs: Math.min(timeoutMs, _agentCfg.shellTimeoutMs || 600_000),
      env: {
        PAAW_LOG_HOME: LOG_HOME,
        PAAW_TMP: join(LOG_HOME, "tmp", _ruSlug),
        PAAW_APP_CONSOLE_DIR: join(LOG_HOME, "app-console", _ruSlug),
      },
      ruSlug: _ruSlug,
    });
    let out = (stdout || "") + (stderr ? "\n" + stderr : "");
    if (code !== 0) out += (out ? "\n" : "") + `Exit code: ${code ?? 1}`;
    return out || "(no output)";
  } catch (e) {
    let output = e.stdout || "";
    if (e.stderr) output += (output ? "\n" : "") + e.stderr;
    output += (output ? "\n" : "") + `Exit code: ${e.code || 1}`;
    return output || "(no output)";
  }
}

// ── Tool Execution ──

/**
 * Execute a tool call and return the result string.
 * All paths are resolved relative to cwd for safety.
 */
async function executeTool(call, cwd, rootDir, onEvent, agentId, featureBoundary = null) {
  const { name, arguments: argsStr } = call.function;
  let args;
  try { args = JSON.parse(argsStr); } catch { return `Error: invalid JSON arguments`; }
  // Inject agentId for action log / memory tools
  if (agentId && ["action_log_add", "action_log_list", "agent_memory_save", "agent_memory_load", "conversation_history"].includes(name)) {
    args._agentId = agentId;
  }
  // 2026-09-07:EM 派工/任務工具必須落在「呼叫者的專案」(coding app import 的 release unit path),
  // 不是 PAAW workspaces[0] - 否則跨專案派工時 QA cwd / task / action log 全落在錯的專案
  if (["dispatch_agent", "task_create", "task_update", "task_list"].includes(name)) {
    args._callerPath = cwd;
  }

  // Resolve relative paths against cwd
  const resolvePath = (p) => {
    if (!p) return cwd;
    // Cross-platform: detect absolute paths on both Unix (/...) and Windows (C:\..., C:/...)
    if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return p;
    return resolve(cwd, p);
  };

  // Load workspace directories (read + write allowed)
  const workspaceDirs = [];
  try {
    const wsPath = resolve(rootDir, "data/workspaces.json");
    if (existsSync(wsPath)) {
      const ws = JSON.parse(readSync(wsPath, "utf-8"));
      // ⚠️ 2026-10-13：只採「本機真的存在」的目錄。workspaces.json 曾被版控帶到別台機器
      // （Mac 絕對路徑 /Users/... 在公司 Linux 不存在）→ 否則 reference_read/path 檢查會鬼打牆。
      if (Array.isArray(ws.directories)) {
        workspaceDirs.push(...ws.directories.filter((d) => {
          try { return typeof d === "string" && existsSync(d); } catch { return false; }
        }));
      }
    }
  } catch {}

  // Security: check path is within allowed dirs
  // Read:  cwd + rootDir + workspaceDirs + knowledge
  // Write: ONLY cwd (project directory)
  //        rootDir blacklist + knowledge + external workspace dirs = read-only
  const externalReadOnlyDirs = workspaceDirs
    .map(d => d.replace(/\\/g, "/"))
    .filter(d => d.toLowerCase() !== cwd.replace(/\\/g, "/").toLowerCase());
  const WRITE_BLACKLIST = [
    // PAAW 自身原始碼/資產保護 — 一律相對「真正的 PAAW root（_PAAW_ROOT）」比對。
    // ⚠️ 2026-10-24 修正：以前相對 caller 傳入的 rootDir，但 coding app 傳的是專案根
    // （coding.mjs rootDir: projRoot）→ 專案本身若是 packages/ monorepo（如 learning-space），
    // 寫 packages/** 會被誤擋成「cwd 外」（audit run-mvlomdns-kfwzx9 事件）
    "/packages/",
    "/core/",
    "/node_modules/",
    "/.git/",
    "/dist/",
    "/.next/",
    "/data/knowledge/",  // knowledge is read-only for agents
  ];
  const WRITE_BLACKLIST_EXTS = new Set([
    // Never allow writing these file types to rootDir (but OK in cwd/data dirs)
    "exe", "dll", "bat", "cmd", "ps1", "sh",
  ]);

  // ── Write 檢查（2026-10-24 重構）：回傳 null=允許、字串=拒絕理由 ──
  // 拒絕理由會進 audit + tool error，說清楚是哪條規則擋的（以前一律印「cwd 外」會誤導）
  const writeDenialReason = (p) => {
    const norm = (s) => s.replace(/\\/g, "/");
    const abs = norm(resolvePath(p));
    const normCwd = norm(cwd);
    const startsWith = (target, prefix) => {
      const t = target.split("/");
      const p2 = prefix.split("/");
      if (p2.length > t.length) return false;
      return p2.every((seg, i) => seg.toLowerCase() === t[i].toLowerCase());
    };
    // Write: must be inside cwd
    if (!startsWith(abs, normCwd)) return `不在 cwd 內（cwd='${cwd}'，resolved='${abs}'）`;
    // PAAW 自身保護黑名單：相對 _PAAW_ROOT（不是 caller 的 rootDir）
    const normPaaw = norm(_PAAW_ROOT);
    const relToPaaw = abs.startsWith(normPaaw + "/") ? abs.slice(normPaaw.length) : "";
    for (const bl of WRITE_BLACKLIST) {
      if (relToPaaw.toLowerCase().startsWith(bl.toLowerCase())) return `PAAW 保護目錄黑名單（${bl} 相對 PAAW root '${normPaaw}'）`;
    }
    // Block writes to external workspace dirs (read-only references)
    for (const rd of externalReadOnlyDirs) {
      if (startsWith(abs, rd)) return `外部 workspace 目錄唯讀（${rd}）`;
    }
    // Block dangerous extensions at PAAW root top-level
    const ext = (p.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || "";
    const inPaawTop = relToPaaw.startsWith("/") && !relToPaaw.slice(1).includes("/");
    if (inPaawTop && (ext === "js" || ext === "mjs" || ext === "cjs")) return `PAAW root 頂層禁止寫入 .${ext}`;
    if (WRITE_BLACKLIST_EXTS.has(ext)) return `禁寫副檔名 .${ext}`;
    return null;
  };

  const isPathAllowed = (p, write = false) => {
    if (write) return writeDenialReason(p) === null;
    const norm = (s) => s.replace(/\\/g, "/");
    const abs = norm(resolvePath(p));
    const normCwd = norm(cwd);
    const normRoot = norm(rootDir);
    const startsWith = (target, prefix) => {
      const t = target.split("/");
      const p2 = prefix.split("/");
      if (p2.length > t.length) return false;
      return p2.every((seg, i) => seg.toLowerCase() === t[i].toLowerCase());
    };
    // Read: cwd + rootDir + workspace directories + PAAW knowledge
    const normPaaw = norm(_PAAW_ROOT);
    const inPaawKnowledge = startsWith(abs, normPaaw + "/data/knowledge");
    return startsWith(abs, normCwd) || startsWith(abs, normRoot) || workspaceDirs.some((d) => startsWith(abs, norm(d))) || inPaawKnowledge;
  };

  // ── Feature Boundary helpers (must be BEFORE switch - const in switch causes TDZ) ──
  const _checkBoundary = (filePath) => {
    if (!featureBoundary || !featureBoundary.allowedFiles) return null; // no boundary active
    const rel = filePath.replace(/\\/g, "/").replace(cwd.replace(/\\/g, "/").replace(/\/+$/, "") + "/", "");
    // New file - always allow
    if (!existsSync(filePath)) return null;
    // File is in allowed scope
    if (featureBoundary.allowedFiles.some(f => f.replace(/\\/g, "/") === rel)) return null;
    // File is outside boundary - return violation
    return rel;
  };
  const _recordViolation = (file, tool) => {
    if (!featureBoundary) return;
    if (!featureBoundary._violations) featureBoundary._violations = [];
    featureBoundary._violations.push({ file, tool, ts: new Date().toISOString() });
  };

  // Emit tool event for SSE
  if (onEvent) onEvent({ type: "tool_start", name, args });

  try {
    switch (name) {

      // ══════════════════════════════════════════
      // ── File Operations ──
      // ══════════════════════════════════════════

      // ── Reference Read Tool (workspace/ and knowledge/) ──
      case "reference_read": {
        // Always use PAAW_ROOT for knowledge/workspace - not cwd/rootDir
        // because these directories live in the PAAW installation, not the project
        const paawRoot = _PAAW_ROOT;
        let configuredDirs = [];
        if (args.source === "knowledge") {
          configuredDirs = [resolve(paawRoot, "data/knowledge")];
        } else {
          // 2026-10-24（Fleming RU 隔離模型）：workspace 來源 = per-project workspaces.json
          // （RU 自己宣告的 📁 File Mounts）優先；沒有才 fallback PAAW 全域那份
          // （rootDir = PAAW root 時兩者同檔，行為不變）
          try {
            const projWsPath = resolve(rootDir, "data/workspaces.json");
            const wsPath = existsSync(projWsPath) ? projWsPath : resolve(paawRoot, "data/workspaces.json");
            const ws = JSON.parse(readSync(wsPath, "utf-8"));
            configuredDirs = Array.isArray(ws.directories) ? ws.directories : [];
          } catch { configuredDirs = []; }
        }
        // 🔴 2026-11-03 Fleming bug 回報修復：原本 find(...) 只取第一個存在的目錄 → 多掛載時
        // AI 只讀得到第一個 File Mount。改成 refBases 全部載入；path 可帶 <掛載目錄名>/ 前綴指定，
        // 沒帶就逐一試（第一個存在的命中）。
        const refBases = configuredDirs.filter((d) => { try { return typeof d === "string" && existsSync(d); } catch { return false; } });
        const resolveInBases = (p) => {
          if (!p) return null;
          const norm = String(p).replace(/\\/g, "/").replace(/^\/+/, "");
          const firstSeg = norm.split("/")[0].toLowerCase();
          for (const b of refBases) { // ① <掛載目錄 basename>/... 前綴直接命中
            const bn = _pathBasename(b).toLowerCase();
            if (bn && bn === firstSeg) {
              const rest = norm.slice(firstSeg.length).replace(/^\/+/, "");
              return { base: b, path: rest ? resolve(b, rest) : resolve(b) };
            }
          }
          for (const b of refBases) { // ② 沒帶前綴 → 逐一試，用第一個存在的
            const fp = resolve(b, norm);
            if (existsSync(fp)) return { base: b, path: fp };
          }
          return refBases.length ? { base: refBases[0], path: resolve(refBases[0], norm) } : null; // ③ 都不在 → 用第一個 base 報 not found
        };
        if (!refBases.length) {
          if (onEvent) onEvent({ type: "tool_end", name, result: `workspace not mounted` });
          const seen = configuredDirs.length
            ? `已設定但本機都不存在：${configuredDirs.join("、")}`
            : `尚未設定任何目錄`;
          return `(workspace/ 沒有可存取的掛載目錄 — ${seen}。請到「設定 → 📁 File Mounts」加入本機存在的資料夾後再試；knowledge/ 不受影響。)`;
        }

        if (args.action === "list") {
          // 2026-11-03：多掛載支援 — 沒帶 path 列出所有掛載根；有帶 path 先解析到具體 base
          if (!args.path) {
            const mountLines = [];
            for (const b of refBases) {
              try {
                const { readdirSync: rd, statSync: st } = await import("fs");
                const n = rd(b).length;
                mountLines.push(`📁 ${_pathBasename(b)}/ (${n} items) — ${b}`);
              } catch (e) { mountLines.push(`📁 ${_pathBasename(b)}/ — ${e.message}`); }
            }
            const hdr = `${args.source}/ 共 ${refBases.length} 個掛載（list <掛載名>/ 看内容）`;
            if (onEvent) onEvent({ type: "tool_end", name, result: `${refBases.length} mounts` });
            return `${hdr}\n${mountLines.join("\n")}`;
          }
          const hit = resolveInBases(args.path);
          if (!hit) return `Error: path '${args.path}' is outside ${args.source}/`;
          const subDir = hit.path;
          if (!subDir.startsWith(hit.base)) {
            return `Error: path '${args.path}' is outside ${args.source}/`;
          }
          try {
            const { readdirSync, statSync } = await import("fs");
            const entries = readdirSync(subDir).sort();
            const lines = entries.map(e => {
              const fp = join(subDir, e);
              const stat = statSync(fp);
              const rel = args.path ? `${args.path}/${e}` : e;
              if (stat.isDirectory()) return `📁 ${rel}/`;
              const sizeStr = stat.size > 1024 ? `${(stat.size/1024).toFixed(1)}KB` : `${stat.size}B`;
              return `📄 ${rel} (${sizeStr})`;
            });
            const header = `${args.source}/${args.path ? args.path + "/" : ""} (${entries.length} items)`;
            if (onEvent) onEvent({ type: "tool_end", name, result: `${entries.length} items` });
            return `${header}\n${lines.join("\n")}`;
          } catch (e) {
            return `Error listing ${args.source}/${args.path || ""}: ${e.message}`;
          }
        }

        if (args.action === "read") {
          if (!args.path) return `Error: 'path' is required for read action.`;
          const hit = resolveInBases(args.path);
          if (!hit) return `Error: path '${args.path}' is outside ${args.source}/`;
          const filePath = hit.path;
          if (!filePath.startsWith(hit.base)) {
            return `Error: path '${args.path}' is outside ${args.source}/`;
          }
          const _tryPaths = [filePath];
          for (const b of refBases) if (b !== hit.base) _tryPaths.push(resolve(b, args.path)); // 同名檔在其他掛載也試
          const filePathFinal = _tryPaths.find((p) => existsSync(p)) || filePath;
          if (!existsSync(filePathFinal)) {
            return `Error: file not found: ${args.source}/${args.path}`;
          }
          try {
            const content = await readFile(filePathFinal, "utf-8");
            const maxLen = 100_000;
            // 2026-09-14: cutSafeStart 不切 surrogate pair(emoji 切半 → 孤兒 \ud83d → LLM 500)
            const result = content.length > maxLen
              ? cutSafeStart(content, maxLen) + `\n... (truncated, ${content.length} bytes total)`
              : content;
            if (onEvent) onEvent({ type: "tool_end", name, result: `${args.source}/${args.path} (${content.length} bytes)` });
            return result;
          } catch (e) {
            return `Error reading ${args.source}/${args.path}: ${e.message}`;
          }
        }

        if (args.action === "search") {
          if (!args.path) return `Error: 'path' (search query) is required for search action.`;
          const query = args.path.toLowerCase();
          const maxResults = args.maxResults || 20;
          const results = [];
          const { readdirSync, readFileSync: readSync2, statSync } = await import("fs");
          const searchDir = (dir, relBase) => {
            if (results.length >= maxResults) return;
            let entries;
            try { entries = readdirSync(dir); } catch { return; }
            for (const e of entries) {
              if (results.length >= maxResults) return;
              const fp = join(dir, e);
              const rel = relBase ? `${relBase}/${e}` : e;
              let stat;
              try { stat = statSync(fp); } catch { continue; }
              if (stat.isDirectory()) {
                searchDir(fp, rel);
              } else {
                const ext = (e.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || "";
                if (["png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip"].includes(ext)) continue;
                try {
                  const content = readSync2(fp, "utf-8").toLowerCase();
                  if (content.includes(query)) {
                    const idx = content.indexOf(query);
                    const start = Math.max(0, idx - 50);
                    const snippet = content.slice(start, idx + query.length + 50).replace(/\n/g, " ");
                    results.push(`${rel}: ...${snippet}...`);
                  }
                } catch {}
              }
            }
          };
          for (const b of refBases) searchDir(b, ""); // 2026-11-03：投逼所有掛載
          const header = `Search '${args.path}' in ${args.source}/ (${results.length} matches, max ${maxResults})`;
          if (onEvent) onEvent({ type: "tool_end", name, result: `${results.length} matches` });
          return results.length > 0 ? `${header}\n${results.join("\n")}` : `${header}\n(No matches found)`;
        }

        return `Error: unknown action '${args.action}'. Use list, read, or search.`;
      }

      case "read_file": {
        const filePath = resolvePath(args.path);
        if (!isPathAllowed(args.path)) {
          logAuditEvent({ kind: "path_violation", severity: "warn", tool: "read_file", command: args.path, reason: `讀取路徑不在允許範圍：${filePath}`, agentId, cwd });
          return `Error: path '${args.path}' resolves to '${filePath}' which is outside all allowed roots. cwd='${cwd}'. Allowed roots: project dir (cwd), PAAW root${workspaceDirs.length ? ", workspaces: " + workspaceDirs.join(", ") : " (no extra workspaces mounted)"}, knowledge. Note: relative vs absolute doesn't matter - the resolved path must be INSIDE an allowed root. If you need a sibling directory, ask the user to add it to data/workspaces.json.`;
        }
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
        // 2026-10-22 Fleming：100K→150K — 讀檔被截斷回報（工具層；context 層見 context-truncation tiers）
        const maxLen = 150_000;
        // 2026-09-14: cutSafeStart 不切 surrogate pair(emoji 切半 → 孤兒 \ud83d → LLM 500)
        const result = content.length > maxLen
          ? cutSafeStart(content, maxLen) + `\n... (truncated, ${content.length} bytes total)`
          : content;
        if (onEvent) onEvent({ type: "tool_end", name, result: `Read ${filePath} (${content.length} bytes)` });
        return result;
      }

      case "write_file": {
        const filePath = resolvePath(args.path);
        if (!args.path) return `Error: write_file requires 'path' argument`;
        if (args.content === undefined || args.content === null) return `Error: write_file requires 'content' argument. You must provide the file content as a string.`;
        // ── script-guard A（2026-10-09）：執行入口檔案（git hooks/launchd/shell rc/ssh）AI 不可寫 ──
        const { persistentEntryBlock } = await import("./script-guard.mjs");
        const persistBlock = persistentEntryBlock(filePath);
        if (persistBlock) {
          logAuditEvent({ kind: "script_guard_entry", severity: "block", tool: "write_file", command: args.path, reason: persistBlock.message.split("\n")[0], agentId, cwd });
          if (onEvent) onEvent({ type: "tool_end", name, result: persistBlock.message.slice(0, 500) });
          return persistBlock.message;
        }
        const wdeny = writeDenialReason(args.path);
        if (wdeny) {
          const hint = `cwd='${cwd}'. Use a path relative to cwd. Do NOT use Windows absolute paths like 'C:\\...'.`;
          logAuditEvent({ kind: "path_violation", severity: "block", tool: "write_file", command: args.path, reason: `寫入被拒：${wdeny}：${filePath}`, agentId, cwd });
          return `Error: path '${args.path}' is not writable — ${wdeny}. ${hint}`;
        }
        // ── Change Boundary: warn if outside feature scope, but allow ──
        const boundaryViolation = _checkBoundary(filePath);
        if (boundaryViolation) {
          _recordViolation(boundaryViolation, "write_file");
          if (onEvent) onEvent({ type: "boundary_violation", file: boundaryViolation, tool: "write_file" });
        }
        try {
          // ── P0: Inject dependency context before write ──
          const depCtx = getDependencyContext(cwd, filePath);
          if (depCtx) {
            LOG("[dependency-context] Pre-write impact analysis for", filePath);
          }
          const wasNew = !existsSync(filePath);
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, args.content, "utf-8");
          // Track modified files for post-edit test verification
          const relPath = filePath.replace(cwd + "/", "").replace(cwd + "\\", "");
          if (onEvent) onEvent({ type: "tool_end", name, result: `Wrote ${filePath} (${args.content.length} bytes)${wasNew ? " [NEW]" : ""}` });
          const baseResult = `Successfully wrote ${args.content.length} bytes to ${args.path}${wasNew ? " [NEW FILE]" : ""}${boundaryViolation ? `\n\n⚠️ **Feature Boundary**: \`${boundaryViolation}\` is outside your assigned feature scope (features: ${featureBoundary.featureIds?.join(", ") || "unknown"}). This change is recorded for human review.` : ""}`;
          return depCtx ? `${baseResult}\n\n${depCtx}` : baseResult;
        } catch (writeErr) {
          const errMsg = `write_file error: ${writeErr.message}. path='${args.path}', resolved='${filePath}', cwd='${cwd}'`;
          if (onEvent) onEvent({ type: "tool_end", name, result: errMsg });
          return errMsg;
        }
      }

      case "edit_file": {
        const filePath = resolvePath(args.path);
        if (!args.path) return `Error: edit_file requires 'path' argument`;
        if (!args.old_text) return `Error: edit_file requires 'old_text' argument`;
        if (args.new_text === undefined || args.new_text === null) return `Error: edit_file requires 'new_text' argument`;
        // ── script-guard A：執行入口檔案攔截（同 write_file）──
        {
          const { persistentEntryBlock } = await import("./script-guard.mjs");
          const pb = persistentEntryBlock(filePath);
          if (pb) {
            logAuditEvent({ kind: "script_guard_entry", severity: "block", tool: "edit_file", command: args.path, reason: pb.message.split("\n")[0], agentId, cwd });
            if (onEvent) onEvent({ type: "tool_end", name, result: pb.message.slice(0, 500) });
            return pb.message;
          }
        }
        const edeny = writeDenialReason(args.path);
        if (edeny) {
          const hint = `cwd='${cwd}'. Use a path relative to cwd. Do NOT use Windows absolute paths like 'C:\\...'.`;
          logAuditEvent({ kind: "path_violation", severity: "block", tool: "edit_file", command: args.path, reason: `寫入被拒：${edeny}：${filePath}`, agentId, cwd });
          return `Error: path '${args.path}' is not writable — ${edeny}. ${hint}`;
        }
        if (!existsSync(filePath)) return `Error: file not found: ${args.path}`;
        // ── Change Boundary: warn if outside feature scope, but allow ──
        const editBoundaryViolation = _checkBoundary(filePath);
        if (editBoundaryViolation) {
          _recordViolation(editBoundaryViolation, "edit_file");
          if (onEvent) onEvent({ type: "boundary_violation", file: editBoundaryViolation, tool: "edit_file" });
        }
        try {
          // ── P0: Inject dependency context before edit ──
          const depCtx = getDependencyContext(cwd, filePath);
          if (depCtx) {
            LOG("[dependency-context] Pre-edit impact analysis for", filePath);
          }
          const content = await readFile(filePath, "utf-8");
          const occurrences = content.split(args.old_text).length - 1;
          if (occurrences === 0) return `Error: old_text not found in ${args.path}`;
          if (occurrences > 1) return `Error: old_text found ${occurrences} times in ${args.path} - must be unique`;
          const newContent = content.replace(args.old_text, args.new_text);
          await writeFile(filePath, newContent, "utf-8");
          if (onEvent) onEvent({ type: "tool_end", name, result: `Edited ${filePath}` });
          const baseResult = `Successfully edited ${args.path} (1 replacement)${editBoundaryViolation ? `\n\n⚠️ **Feature Boundary**: \`${editBoundaryViolation}\` is outside your assigned feature scope (features: ${featureBoundary.featureIds?.join(", ") || "unknown"}). This change is recorded for human review.` : ""}`;
          return depCtx ? `${baseResult}\n\n${depCtx}` : baseResult;
        } catch (editErr) {
          const errMsg = `edit_file error: ${editErr.message}. path='${args.path}', resolved='${filePath}', cwd='${cwd}'`;
          if (onEvent) onEvent({ type: "tool_end", name, result: errMsg });
          return errMsg;
        }
      }

      // ══════════════════════════════════════════
      // ── Search & Discovery ──
      // ══════════════════════════════════════════

      case "glob": {
        const basePath = resolvePath(args.path);
        if (!isPathAllowed(args.path || ".")) return `Error: path '${args.path}' resolves outside all allowed roots (cwd='${cwd}'${workspaceDirs.length ? ", workspaces: " + workspaceDirs.join(", ") : ""}). Ask user to add the directory to data/workspaces.json if needed.`;
        const pattern = args.pattern;
        let result;
        // 跨平台 native-first(2026-09-12:公司 Linux 沒裝 rg → agent 拿到 command not found。
        //   純 Node.js 遞迴,不依賴 rg/find/grep;rg 只在「有裝」時當加強 - command -v 靜默探測,agent 永遠不會看到 command not found)
        result = await _nativeGlob(basePath, pattern, 100, cwd);
        if (result === "(no files found)" || result.length < 10) {
          const cmd = `command -v rg >/dev/null 2>&1 && rg --files --glob "${pattern}" --max-depth 15 "${basePath}"`;
          const rgResult = await runShell(cmd, cwd, 8_000);
          if (!rgResult.includes("not recognized") && !rgResult.includes("command not found") && !rgResult.includes("(no output)") && rgResult.length > result.length) {
            // Convert rg absolute paths to relative, forward-slash paths
            const normCwd = cwd.replace(/\\/g, "/");
            result = rgResult.split("\n").filter(l => l.trim()).map(l => {
              const norm = l.replace(/\\/g, "/");
              return norm.startsWith(normCwd + "/") ? norm.slice(normCwd.length + 1) : l;
            }).join("\n");
          }
        }
        // Smart truncate (head+tail, preserves errors at end)
        const truncated = smartTruncateToolResult(result, 12_000);
        const count = truncated.split("\n").filter(l => l.trim()).length;
        if (onEvent) onEvent({ type: "tool_end", name, result: `Found ${count} files matching '${pattern}'` });
        return truncated;
      }

      case "grep": {
        const searchPath = resolvePath(args.path);
        if (!isPathAllowed(args.path || ".")) return `Error: path '${args.path}' resolves outside all allowed roots (cwd='${cwd}'${workspaceDirs.length ? ", workspaces: " + workspaceDirs.join(", ") : ""}). Ask user to add the directory to data/workspaces.json if needed.`;
        const maxResults = args.max_results || 50;
        const caseFlag = args.case_sensitive ? "" : "-i";
        let result;
        // 跨平台 native-first(2026-09-12 同 glob:不依賴 rg/grep;rg 有裝才加強,靜默探測)
        result = await _nativeGrep(searchPath, args.pattern, args.include, maxResults, !args.case_sensitive, cwd);
        if (result === "(no matches)" || result.length < 10) {
          const includeFlag = args.include ? `--glob '${args.include}'` : "";
          const cmd = `command -v rg >/dev/null 2>&1 && rg ${caseFlag} ${includeFlag} --max-count ${maxResults} --line-number --no-heading '${args.pattern}' '${searchPath}'`;
          const rgResult = await runShell(cmd, cwd, 10_000);
          if (!rgResult.includes("not recognized") && !rgResult.includes("command not found") && !rgResult.includes("(no output)") && rgResult.length > result.length) {
            result = rgResult.split("\n").filter(l => l.trim()).map(l => {
              const colonIdx = l.indexOf(":");
              if (colonIdx > 0) {
                const norm = l.slice(0, colonIdx).replace(/\\/g, "/");
                const rel = norm.startsWith(cwd.replace(/\\/g, "/") + "/") ? norm.slice(cwd.replace(/\\/g, "/").length + 1) : l.slice(0, colonIdx);
                return rel + l.slice(colonIdx);
              }
              return l;
            }).join("\n");
          }
        }
        // Smart truncate (head+tail - preserves grep matches at end)
        const truncated = smartTruncateToolResult(result, 12_000);
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
        // Git diff - git works on both platforms
        const diffPath = args.path ? resolvePath(args.path) : cwd;
        const against = args.against || "HEAD";
        if (IS_WIN) {
          const cmd = `git diff "${against}"${args.path ? ` -- "${diffPath}"` : ""}`;
          const result = await runShell(cmd, cwd, 15_000);
          const truncated = smartTruncateToolResult(result, 12_000);
          if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 300) });
          return truncated || "(no changes)";
        }
        const cmd = `git diff '${against}'${args.path ? ` -- '${diffPath}'` : ""}`;
        const result = await runShell(cmd, cwd, 15_000);
        const truncated = smartTruncateToolResult(result, 12_000);
        if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 300) });
        return truncated || "(no changes)";
      }

      case "git": {
        // All git operations go through this tool
        const cmd = `git ${args.command}`;
        const timeoutMs = Math.min((args._timeout || 30) * 1000, 60_000);
        const result = await runShell(cmd, cwd, timeoutMs);
        const maxLen = 30_000;
        const truncated = smartTruncateToolResult(result, 12_000);
        if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 300) });
        return truncated;
      }

      // ══════════════════════════════════════════
      // ── Shell ──
      // ══════════════════════════════════════════

      case "bash": {
        // 🚧 鐵律(Fleming 2026-09-13):process 控制只限本 RU dev server(用 dev_server 工具),
        // 外面的一律不可碰 -- 尤其 PAAW coding app 本身。硬防護見 lib/shell-guard.mjs
        const { guardShellProcessScope } = await import("./shell-guard.mjs");
        const guard = await guardShellProcessScope(args.command, cwd);
        if (guard.blocked) {
          // 🔴 審計（2026-10-10）：AI 犯傻 = process 越界 → audit log + ES paaw-audit-*
          logAuditEvent({ kind: "shell_guard", severity: "block", tool: "bash", command: args.command, reason: guard.message, agentId, cwd });
          if (onEvent) onEvent({ type: "tool_end", name, result: guard.message.slice(0, 500) });
          return guard.message;
        }
        // ── script-guard C（2026-10-09）：AI 寫的 script 執行前掃內容（危險 pattern 才攔，正常 coding 零摩擦）──
        const { guardScriptExecution } = await import("./script-guard.mjs");
        const { devModeOn } = await import("./security-mode.mjs");
        const _devMode = devModeOn(); // 🛠 開發模式（2026-10-13）
        const sGuard = guardScriptExecution(args.command, cwd);
        if (sGuard.blocked && _devMode) {
          // 🛠 開發模式：不跳審批卡、不擋，直接放行 — 但留審計（事後可查「開發模式期間 AI 做了什麼」）
          logAuditEvent({ kind: "script_guard_bypassed", severity: "warn", tool: "bash", command: args.command, reason: sGuard.message.split("\n")[0], detail: { devMode: true }, agentId, cwd });
          if (onEvent) onEvent({ type: "security_notice", kind: "script_guard_bypassed", message: `🛠 開發模式：略過安全審批 — ${sGuard.message.split("\n")[0]}` });
        } else if (sGuard.blocked) {
          // ── 審批卡（2026-10-09）：使用者已核准（once/always）= 放行重試 ──
          const { consumeApproval, requestApproval, waitForDecision } = await import("./exec-approvals.mjs");
          const approved = consumeApproval(args.command, cwd);
          if (approved) {
            if (onEvent) onEvent({ type: "tool_end", name, result: `✅ 已依使用者核准（${approved}）放行：${args.command.slice(0, 120)}` });
            // 跳過攔截繼續執行（落到下面 runShell）
          } else {
            const aprId = requestApproval(args.command, cwd, sGuard.message.split("\n")[0].slice(0, 200), agentId);
            // 🔴 審計（2026-10-10）：危險指令被攔 + 送審批卡
            logAuditEvent({ kind: "script_guard", severity: "block", tool: "bash", command: args.command, reason: sGuard.message.split("\n")[0], agentId, cwd });
            logAuditEvent({ kind: "approval_request", severity: "info", tool: "bash", command: args.command, reason: sGuard.message.split("\n")[0], detail: { approvalId: aprId }, agentId, cwd });
            // agentId（2026-10-13）：審批卡的歸屬 agent —— UI 只在其所属 crew 的視窗顯示
            if (onEvent) onEvent({ type: "approval_request", id: aprId, command: String(args.command).slice(0, 300), reason: sGuard.message.split("\n")[0].slice(0, 300), agentId: agentId || null });
            // ⏳ 2026-10-13 Fleming：審批卡要「真的暫停」agent loop（以前只是通知卡，agent 早跑掉了）
            const _waitMin = Math.round(APPROVAL_WAIT_BUDGET_MS / 60000);
            if (onEvent) onEvent({ type: "tool_end", name, result: `⏳ 已送出審批卡 ${aprId} — agent 暫停中，等待你的決定（最長 ${_waitMin} 分鐘）…` });
            const decision = await waitForDecision(aprId, APPROVAL_WAIT_BUDGET_MS);
            const okNow = (decision === "once" || decision === "always") ? decision : consumeApproval(args.command, cwd);
            if (okNow) {
              logAuditEvent({ kind: "approval_granted", severity: "info", tool: "bash", command: args.command, detail: { approvalId: aprId, decision: okNow }, agentId, cwd });
              if (onEvent) onEvent({ type: "tool_end", name, result: `✅ 使用者已核准（${okNow}）— 執行中…` });
              // 落到下面 runShell 真的執行
            } else {
              const _why = decision === "timeout"
                ? `審批逾時（${_waitMin} 分鐘內未決策）`
                : (decision === "deny" ? "使用者拒絕" : "審批未成立");
              if (onEvent) onEvent({ type: "tool_end", name, result: sGuard.message.slice(0, 400) });
              return sGuard.message + `\n（${_why}，指令未執行。審批卡 ${aprId}）`;
            }
          }
        }
        // 🌐 2026-10-13 Fleming：對外網路請求不再跳審批卡 — 沙箱（MXC deny-by-default）
        // 才是守門；這裡只記審計 + 告知使用者（不中斷開發）。
        if (!sGuard.blocked && sGuard.network) {
          logAuditEvent({ kind: "network_notice", severity: "warn", tool: "bash", command: args.command, reason: String(sGuard.network), agentId, cwd });
          if (onEvent) onEvent({ type: "security_notice", kind: "network_notice", message: `🌐 對外網路請求（不擋，交給沙箱把關）：${String(sGuard.network).slice(0, 120)}` });
        }
        const timeoutSec = Math.min(args.timeout || 120, _agentCfg.bashTimeoutSeconds || 300);
        const timeoutMs = timeoutSec * 1000;
        const result = await runShell(args.command, cwd, timeoutMs, { marker: true, readonlyDirs: externalReadOnlyDirs });
        // ── 安全審計（2026-10-10 Fleming）：輸出掃描 — 白名單阻擋/沙箱拒絕 →
        //    agent 引導（去安全 tab 設定）+ 使用者 security_notice + ES paaw-audit-* ──
        let finalResult = result;
        try {
          const { effectiveAllowedDomains, sandboxAvailable } = await import("./paaw-sandbox.mjs");
          const secHit = scanCommandOutput({ command: args.command, output: result, allowedDomains: effectiveAllowedDomains(), agentId, cwd, tool: "bash", sandboxActive: await sandboxAvailable() });
          if (secHit) {
            finalResult = result + secHit.agentNotice;
            if (onEvent) onEvent({ type: "security_notice", kind: secHit.type, domains: secHit.domains, message: secHit.userNotice });
            // 2026-10-11：結構化安全訊號 — 呼叫端（dispatch_agent）收集後回報 EM，不靠關鍵字撈
            if (onEvent) onEvent({ type: "security_hit", kind: secHit.type, domains: secHit.domains || [], command: String(args.command || "").slice(0, 300), stopRun: !!secHit.stopRun });
            // 明知故犯第 3 次（被擋後仍重試）→ 停這個 run（2026-10-11 Fleming：白名單不可自我解除）
            if (secHit.stopRun) { try { const _st = runContextALS.getStore(); if (_st) _st.stopReason = `重複嘗試已被沙箱/白名單擋下的資源（${secHit.type}）`; } catch { /* no ALS */ } }
          }
        } catch { /* 審計掃描失敗不影響工具結果 */ }
        // Smart truncate (head+tail - preserves build errors/test results at end)
        const truncated = smartTruncateToolResult(finalResult, 12_000, { alwaysKeepTail: true });
        if (onEvent) onEvent({ type: "tool_end", name, result: truncated.slice(0, 500) });
        return truncated;
      }

      // ══════════════════════════════════════════
      // ── Dev Server Controller(2026-09-10 Phase 1)──
      // 長駐程序管理:start/stop/restart/status + log 讀取(lib/dev-server.mjs)
      // ══════════════════════════════════════════

      case "dev_server": {
        const { devServerAction } = await import("./dev-server.mjs");
        const out = await devServerAction(cwd, args);
        if (onEvent) onEvent({ type: "tool_end", name, result: out.slice(0, 500) });
        return out;
      }

      case "dev_log": {
        const { readDevLog } = await import("./dev-server.mjs");
        const out = await readDevLog(cwd, args);
        // log tail 可能很長 - smart truncate 保尾(error 通常在尾端)
        const truncated = smartTruncateToolResult(out, 10_000, { alwaysKeepTail: true });
        if (onEvent) onEvent({ type: "tool_end", name, result: `tail ${args.lines || 100} lines` });
        return truncated;
      }

      // ══════════════════════════════════════════
      // ── Release Unit Tools(三防線:context / impact / verify)──
      // ══════════════════════════════════════════

      case "ru_context": {
        const { detectTechStack } = await import("./release-unit/adapters.mjs");
        const tech = await detectTechStack(cwd);
        const readDoc = async (rel) => {
          const f = resolve(cwd, ".paaw", rel);
          if (!existsSync(f)) return null;
          try { return readSync(f, "utf-8"); } catch { return null; }
        };
        // 2026-09-20 Fleming：不想維護 PROJECT.md — 專案知識主軸 = Feature Map；
        // PROJECT.md 不列（內容透過 project_info(context) 給，含 CU 自動初稿），只列其餘人寫文件
        const docs = ["ARCHITECTURE.md", "DECISIONS.md", "CONTEXT.md"];
        const found = [];
        for (const d of docs) {
          if (await readDoc(d)) found.push(d);
        }
        let out = `【Release Unit context】${cwd.split(/[\\/]/).pop()}\n技術桡：${tech.language} / ${tech.packageManager} / ${(tech.frameworks || []).join(", ") || "-"}\n人寫文件：${found.length ? found.join(", ") : "無"}\n`;
        // Feature Map 可用性提示 - CU 做完 agent 就該用它定位功能,不要從 raw code 開始讀
        try {
          const { loadFeatures: _lf } = await import("./feature-registry.mjs"); // coding.db
          const n = (_lf(cwd) || []).length;
          if (n > 0) out += `Feature Map:✅ 已建立(${n} features)- 用 project_info(category=context) 取得專案全貌(feature → files + file → feature),定位功能從這裡開始\n`;
        } catch {}
        if (args.withDocs) {
          for (const d of ["PROJECT.md", "ARCHITECTURE.md", "DECISIONS.md"]) {
            const c = await readDoc(d);
            if (c) out += `\n【${d}】\n${smartTruncateToolResult(c, 6000, { alwaysKeepTail: false })}`; // nosemgrep: missing-template-string-indicator
          }
        }
        if (onEvent) onEvent({ type: "tool_end", name, result: `context ${found.length}/5 docs` });
        return out;
      }

      case "ru_dependencies": {
        const { buildDependencyGraph, queryGraph } = await import("./release-unit/dependencies.mjs");
        const graph = await buildDependencyGraph(cwd);
        const r = queryGraph(graph, args.file, "both");
        if (!r.found) return `檔案不在依賴圖中:${args.file}(掃描 ${graph.fileCount} 檔,adapter=${graph.adapter})。可用相對路徑或檔名重試。`;
        const fmt = (list, label) => list?.length ? `\n【${label}】(${list.length})\n` + list.map(f => `  ${f}`).join("\n") : `\n【${label}】(0)`;
        if (onEvent) onEvent({ type: "tool_end", name, result: `${r.file}: fwd ${r.forward?.length || 0} / rev ${r.reverse?.length || 0}` });
        return `檔案:${r.file}${fmt(r.forward, "我 import 誰")}${fmt(r.reverse, "誰 import 我")}${fmt(r.externals, "外部套件")}`;
      }

      case "ru_impact_analysis": {
        const { impactAnalysis } = await import("./release-unit/impact.mjs");
        const r = await impactAnalysis(cwd, args.files, { changeType: args.changeType });
        if (r.unresolved.length) {
          return `這些檔案不在依賴圖中,無法分析:${r.unresolved.join(", ")}。請確認路徑(相對於專案根)。`;
        }
        const lines = r.affected.map(a => `  d${a.depth} ${a.file}`);
        if (onEvent) onEvent({ type: "tool_end", name, result: `affected ${r.affectedCount}` });
        return `【影響分析】改動 ${r.changed.length} 檔(${r.changeType})→ 受影響 ${r.affectedCount} 檔\n` +
          (lines.length ? lines.join("\n") : "(無內部依賴者 - 安全)") +
          (r.hotspots.length ? `\n【樞紐熱點(改動需特別小心)】\n` + r.hotspots.slice(0, 5).map(h => `  ${h.file}(${h.dependents} 依賴者)`).join("\n") : "");
      }

      case "ru_verify": {
        const { runVerify } = await import("./release-unit/verify.mjs");
        if (onEvent) onEvent({ type: "tool_end", name, result: "verify running..." });
        const report = await runVerify(cwd, { checks: args.checks });
        const lines = report.checks.map(c =>
          `${c.ok ? "✅" : "❌"} ${c.check}(${Math.round(c.durationMs / 100) / 10}s)${c.ok ? "" : "\n" + (c.output || "").slice(-1500)}`);
        if (onEvent) onEvent({ type: "tool_end", name, result: `verify ${report.overall}` });
        return `【驗證結果】${report.overall.toUpperCase()}(${report.ran.join(", ") || "無可執行關卡"})\n${lines.join("\n")}`;
      }

      // ── Release Prep tools(2026-09-18)──
      case "release_prep_status": {
        const { execSync } = await import("child_process");
        const { existsSync, readFileSync, statSync } = await import("fs");
        const { join } = await import("path");
        const git = (c) => { try { return execSync(`git ${c}`, { cwd, encoding: "utf-8", timeout: 15000 }).trim(); } catch { return ""; } };
        const dirty = git("status --porcelain").split("\n").filter(Boolean);
        const unpushed = git("log @{u}..HEAD --oneline").split("\n").filter(Boolean);
        // open tasks
        let openTasks = [];
        try {
          const tp = join(cwd, ".paaw", "tasks", "TASKS.json");
          if (existsSync(tp)) {
            const all = JSON.parse(readFileSync(tp, "utf-8")).tasks || [];
            openTasks = all.filter(t => !["close", "released"].includes(t.status)).map(t => `${t.id}(${t.status})${t.title ? " " + t.title.slice(0, 40) : ""}`);
          }
        } catch {}
        // 證據快照
        const ev = [];
        const evPush = (label, ok, note) => ev.push(`${ok ? "✅" : "⚠️"} ${label}:${note}`);
        try {
          const { readLastTestRun } = await import("./test-runner.mjs");
          const t = readLastTestRun(cwd);
          if (t) {
            const staleNote = t.headSha && git(`merge-base --is-ancestor ${t.headSha} HEAD`) !== "" && git(`rev-parse HEAD`) !== t.headSha ? ";落後 HEAD - 用 test_run 重跑" : "";
            evPush("tests", t.status === "pass" && !staleNote, `${t.id} ${t.status} @ ${t.finishedAt || "?"}(${(t.summary || {}).passed ?? "?"}✓/${(t.summary || {}).failed ?? "?"}✗)${staleNote}`); // nosemgrep: missing-template-string-indicator
          } else evPush("tests", false, "從未跑過 - 用 test_run 補");
        } catch { evPush("tests", false, "讀取失敗"); }
        try {
          const sp = join(cwd, ".paaw", "security", "scan-results.json");
          if (existsSync(sp)) {
            const s = JSON.parse(readFileSync(sp, "utf-8"));
            const sev = (s.stats || {}).bySeverity || {};
            const when = s.scannedAt || new Date(statSync(sp).mtime).toISOString();
            const staleRaw = git(`rev-list --count HEAD --since="${(when || "").slice(0, 19).replace("T", " ")} +0000"`);
            const stale = parseInt(staleRaw || "0", 10) > 0
              ? String(git(`log --since="${(when || "").slice(0, 19).replace("T", " ")} +0000" --name-only --pretty=format:%H`) || "")
                  .split("\n").some((l) => { const t = l.trim(); return t && !/^[0-9a-f]{40}$/.test(t) && !t.startsWith(".paaw/"); }) ? staleRaw : "0"
              : "0";
            evPush("security", !(sev.ERROR > 0) && !(parseInt(stale || "0") > 0), `ERROR ${sev.ERROR || 0} / WARNING ${sev.WARNING || 0} @ ${when}${parseInt(stale || "0") > 0 ? `;掃描後又有 ${stale} commits` : ""}`);
          } else evPush("security", false, "從未掃過 - 用 security_scan 補");
        } catch { evPush("security", false, "讀取失敗"); }
        try {
          // CU 新鮮度(2026-09-18 Fleming 點出):RR scope 的 features/apis 統計靠
          // release-unit-model.json(feature map)+ code-intelligence(變更情報)- 舊了 scope 失真
          const rup = join(cwd, ".paaw", "release-unit-model.json");
          if (existsSync(rup)) {
            const ru = JSON.parse(readFileSync(rup, "utf-8"));
            const when = ru.generatedAt || new Date(statSync(rup).mtime).toISOString();
            const stale = git(`rev-list --count HEAD --since="${(when || "").slice(0, 19).replace("T", " ")} +0000"`);
            evPush("feature map(RU model)", !(parseInt(stale || "0") > 0), `features ${ru.features?.length ?? "?"} / apis ${ru.apis?.length ?? "?"} @ ${when}${parseInt(stale || "0") > 0 ? `;落後 ${stale} commits - 用 ru_model_refresh 補` : ""}`);
          } else evPush("feature map(RU model)", false, "尚無 - 用 ru_model_refresh 建");
        } catch { evPush("feature map(RU model)", false, "讀取失敗"); }
        try {
          const vp = join(cwd, ".paaw", "verify-last.json");
          if (existsSync(vp)) {
            const v = JSON.parse(readFileSync(vp, "utf-8"));
            evPush("verify", v.overall === "pass", `${v.overall} @ ${v.generatedAt || "?"}`);
          } else evPush("verify", false, "從未驗證 - 用 ru_verify 補");
        } catch { evPush("verify", false, "讀取失敗"); }
        try {
          const hp = join(cwd, ".paaw", "handover-state.json");
          if (existsSync(hp)) {
            const h = JSON.parse(readFileSync(hp, "utf-8"));
            const when = h.generatedAt || new Date(statSync(hp).mtime).toISOString();
            const stale = git(`rev-list --count HEAD --since="${(when || "").slice(0, 19).replace("T", " ")} +0000"`);
            evPush("handover", !(parseInt(stale || "0") > 0), `@ ${when}${parseInt(stale || "0") > 0 ? `;落後 ${stale} commits - 用 handover_refresh 補` : ";新鮮"}`);
          } else evPush("handover", false, "尚無 - 用 handover_refresh 補");
        } catch { evPush("handover", false, "讀取失敗"); }
        if (onEvent) onEvent({ type: "tool_end", name, result: `prep status:dirty ${dirty.length} / 證據 ${ev.length}` });
        return `【Release 準備盤點】\n📦 git:${dirty.length ? `⚠️ ${dirty.length} 個未 commit 檔案` : "✅ 乾淨"}${unpushed.length ? `;⚠️ ${unpushed.length} 個未推 commit` : ";已推"}\n📋 open tasks(${openTasks.length}):${openTasks.length ? "\n  - " + openTasks.join("\n  - ") : "無"}\n🧪 證據:\n  ${ev.join("\n  ")}\n💡 下一步:先收未 commit 的 code(dispatch developer),全部 push 後再跑證據工具。`;
      }

      case "test_run": {
        const { startTestRun, getRunState, readLastTestRun } = await import("./test-runner.mjs");
        if (onEvent) onEvent({ type: "tool_end", name, result: "測試執行中(含 e2e 可能數分鐘,等完成)..." });
        try {
          const started = await startTestRun(cwd, { includeE2e: args.includeE2e !== false });
          if (started.noRunner) return `【測試結果】⚠️ 未偵測到測試 runner(${JSON.stringify(started.detected || {}).slice(0, 200)})`; // nosemgrep: missing-template-string-indicator
          // 同步等完成(3s 輪詢,上限 10 分鐘)- EM 派工流程需要結果才能往下走
          const deadline = Date.now() + 600_000;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            if (!getRunState(cwd)) break;
          }
          const r = await readLastTestRun(cwd);
          const s = (r && r.summary) || {};
          if (onEvent) onEvent({ type: "tool_end", name, result: `test ${r?.status || "unknown"}` });
          return `【測試結果】${r?.status === "pass" ? "✅" : "❌"} ${r?.id || "?"} - ${s.passed ?? "?"}✓ / ${s.failed ?? "?"}✗ @ ${r?.finishedAt || "?"}${r?.status !== "pass" ? "\n(有失敗 - dispatch developer 修完重跑)" : ""}`;
        } catch (e) {
          return `【測試結果】❌ 執行失敗:${e.message}`;
        }
      }

      case "multi_model_review": {
        const { runMultiModelReview, formatReviewResult } = await import("./coding-review-runner.mjs");
        try {
          if (onEvent) onEvent({ type: "tool_end", name, result: `multi-model review 啟動（${args.ref || "HEAD~1..HEAD"}）...` });
          const r = await runMultiModelReview({
            projectDir: cwd,
            ref: args.ref,
            pathFilter: args.path,
            onProgress: (m) => { if (onEvent) onEvent({ type: "tool_end", name, result: m }); },
          });
          if (onEvent) onEvent({ type: "tool_end", name, result: `review 完成：${r.decision}` });
          return formatReviewResult(r);
        } catch (e) {
          return `【Multi-Model Review】❌ ${e.message}`;
        }
      }

      case "security_scan": {
        const { runSemgrep } = await import("./semgrep-runner.mjs");
        if (onEvent) onEvent({ type: "tool_end", name, result: "semgrep 掃描中..." });
        try {
          const r = await runSemgrep(cwd);
          const sev = (r.stats || {}).bySeverity || {};
          if (onEvent) onEvent({ type: "tool_end", name, result: `scan: E${sev.ERROR || 0}/W${sev.WARNING || 0}` });
          return `【安全掃描】${(sev.ERROR || 0) > 0 ? "❌" : "✅"} ERROR ${sev.ERROR || 0} / WARNING ${sev.WARNING || 0} / INFO ${sev.INFO || 0}(落檔 .paaw/security/scan-results.json)${(sev.ERROR || 0) > 0 ? "\n(有 ERROR - dispatch developer 修完重掃)" : ""}`;
        } catch (e) {
          return `【安全掃描】❌ 執行失敗:${e.message}`;
        }
      }

      case "ru_model_refresh": {
        try {
          const { buildReleaseUnitModel } = await import("./release-unit/model.mjs");
          if (onEvent) onEvent({ type: "tool_end", name, result: "RU model 重建中(含依賴掃描)..." });
          const m = await buildReleaseUnitModel(cwd, { persist: true });
          if (onEvent) onEvent({ type: "tool_end", name, result: `RU model: ${m?.features?.length ?? "?"} features` });
          return `【RU Model】✅ 已重建 - features ${m?.features?.length ?? "?"} / apis ${m?.apis?.length ?? "?"} @ ${m?.generatedAt}(.paaw/release-unit-model.json)`;
        } catch (e) {
          return `【RU Model】❌ 重建失敗:${e.message}`;
        }
      }

      case "handover_refresh": {
        try {
          const { writeHandoverState } = await import("./release-unit/handover-state.mjs");
          const h = await writeHandoverState(cwd);
          if (onEvent) onEvent({ type: "tool_end", name, result: "handover refreshed" });
          return `【Handover】✅ 已刷新 @ ${h.generatedAt}(head ${((h.currentState || {}).headSha || "").slice(0, 8)})`; // nosemgrep: missing-template-string-indicator
        } catch (e) {
          return `【Handover】❌ 刷新失敗:${e.message}`;
        }
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

      // ═════════════════════════════════════════
      // ── API Tester(2026-09-12)──
      // developer agent 直接打 API:任5意 method/headers/body,
      // 每次呼叫存入 data/api-tester-history.json(跟 UI 🌐 API Tester 同一份),
      // 人從 UI 📜 History 看得到(帶 🤖 標記)、可點回來 replay。
      // ═════════════════════════════════════════
      case "api_test": {
        // ── 2026-09-24 collection 三模式：list / run-by-name / save（Fleming：使用者可請 AI 新增 payload by collection）──
        // 2026-09-29 Fleming：collections/history 屬於 RU → 存 {cwd}/.paaw/api-tester/（讀 fallback 舊全域、寫自動遷入）
        const _atHelpers = await import("../routes/api-tester.mjs");
        const _ruRoot = cwd || null;
        const _collectionsFile = () => _atHelpers._collectionsFileFor(_ruRoot);
        const _loadCols = () => _atHelpers._loadCollectionsFor(_ruRoot);
        const tCollection = String(args.collection || "").trim();
        const tPayloadName = String(args.name || "").trim();
        const tUrl0 = String(args.url || "").trim();
        const tMethod0 = String(args.method || "GET").toUpperCase();

        // (1) listCollections：列全部 collection + payload 摘要
        if (args.listCollections) {
          const cols = _loadCols();
          const names = Object.keys(cols);
          if (names.length === 0) return "(No collections yet - use save=true + collection + name + url to create the first one)";
          return "Collections (" + names.length + "):\n" + names.map(n => {
            const ps = cols[n].payloads || [];
            return `📁 ${n} (${ps.length} payloads)\n` + ps.map(p => `  - ${p.name} [${p.method}] ${p.url}`).join("\n");
          }).join("\n\n");
        }

        // (2) save：把這次要的 payload 存進 collection（同名覆蓋）
        if (args.save) {
          if (!tCollection || !tPayloadName || !tUrl0) return "Error: save requires collection + name + url (method/headers/body optional)";
          if (!/^https?:\/\//i.test(tUrl0)) return "Error: url must start with http:// or https://";
          const rawH = (args.headers && typeof args.headers === "object" && !Array.isArray(args.headers)) ? args.headers : {};
          const headerArr = Object.entries(rawH).map(([k, v]) => ({ key: k, value: v, enabled: true }));
          const cols = _loadCols();
          if (!cols[tCollection]) cols[tCollection] = { name: tCollection, createdAt: new Date().toISOString(), payloads: [] };
          const col = cols[tCollection];
          const entry = {
            id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: tPayloadName,
            method: tMethod0,
            url: tUrl0,
            headers: headerArr,
            body: args.body !== undefined && args.body !== null ? String(args.body) : "",
            streamMode: false,
            createdAt: new Date().toISOString(),
          };
          const idx = col.payloads.findIndex(x => x.name === tPayloadName);
          if (idx >= 0) { entry.id = col.payloads[idx].id; entry.createdAt = col.payloads[idx].createdAt; col.payloads[idx] = entry; }
          else col.payloads.push(entry);
          col.updatedAt = new Date().toISOString();
          try { _atHelpers._saveCollectionsFor(_ruRoot, cols); } catch (e) { return `Error saving collection: ${e.message}`; }
          return `💾 Saved "${tPayloadName}" [${tMethod0}] into collection "${tCollection}" (${col.payloads.length} payloads) - the human can see/replay it in API Tester → Collections tab.`;
        }

        // (3) run by collection+name（無 url）：從 collection 讀 payload 執行
        let tUrl = tUrl0, tMethod = tMethod0, ranFromCollection = null;
        if (!tUrl && tCollection && tPayloadName) {
          const cols = _loadCols();
          const col = cols[tCollection];
          if (!col) return `Error: collection "${tCollection}" not found. Use listCollections=true to see available collections.`;
          const p = (col.payloads || []).find(x => x.name === tPayloadName);
          if (!p) return `Error: payload "${tPayloadName}" not found in collection "${tCollection}". Available: ${(col.payloads || []).map(x => x.name).join(", ") || "(none)"}`;
          tUrl = String(p.url || "").trim();
          tMethod = String(p.method || "GET").toUpperCase();
          // headers: [{key,value,enabled}] → object
          const hdrs = {};
          for (const h of (p.headers || [])) { if (h && h.key && h.enabled !== false) hdrs[h.key] = h.value; }
          args = { ...args, headers: hdrs, body: p.body !== undefined && p.body !== null ? String(p.body) : args.body };
          ranFromCollection = tCollection;
        }
        if (!tUrl) return "Error: url is required for api_test (or provide collection + name to run a saved payload)";
        if (!/^https?:\/\//i.test(tUrl)) return "Error: url must start with http:// or https://";

        if (onEvent) onEvent({ type: "tool_start", name, args: `${tMethod} ${tUrl}` });

        // headers: object → 略過 content-length 之類會被 fetch 拒統的
        const rawHeaders = (args.headers && typeof args.headers === "object" && !Array.isArray(args.headers)) ? args.headers : {};
        const reqHeaders = {};
        for (const [k, v] of Object.entries(rawHeaders)) {
          const lk = String(k).toLowerCase();
          if (lk === "content-length" || lk === "host") continue; // fetch 會拒絕/覆寫
          reqHeaders[String(k)] = String(v);
        }
        const tBody = args.body !== undefined && args.body !== null ? String(args.body) : undefined;
        const expectStatus = args.expectStatus || null;
        const expectText = args.expectText || null;

        const startTime = Date.now();
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 20_000);
          const fetchOpts = { method: tMethod, headers: reqHeaders, redirect: "follow", signal: controller.signal };
          if (tBody && tMethod !== "GET" && tMethod !== "HEAD") fetchOpts.body = tBody;
          const tRes = await fetch(tUrl, fetchOpts);
          clearTimeout(timer);
          const elapsed = Date.now() - startTime;

          const respHeaders = {};
          tRes.headers.forEach((v, k) => { respHeaders[k] = v; });
          const contentType = tRes.headers.get("content-type") || "";
          let respBody;
          if (contentType.includes("json") || contentType.includes("text") || contentType.includes("xml") || contentType.includes("html") || contentType.includes("javascript")) {
            respBody = await tRes.text();
          } else {
            const buf = await tRes.arrayBuffer();
            respBody = `[Binary data: ${buf.byteLength} bytes]`;
          }

          // ── 存入共用 API Tester history(跟 UI 同一份檔、同一形狀)──
          // UI 存的 headers 是 [{key,value,enabled}] - 沿用同形狀,人點回來才能 replay
          const headerArr = Object.entries(reqHeaders).map(([k, v]) => ({ key: k, value: v, enabled: true }));
          const histItem = {
            id: `req-${Date.now()}`,
            ts: new Date().toISOString(),
            method: tMethod,
            url: tUrl,
            status: tRes.status,
            elapsed,
            headers: headerArr,
            body: tBody || "",
            streamMode: false,
            response: { status: tRes.status, statusText: tRes.statusText, headers: respHeaders, body: respBody, elapsed, size: respBody.length },
            source: "agent",
            agent: agentId || undefined,
            collection: ranFromCollection || undefined,
          };
          try {
            // 2026-09-29：RU-scoped（{cwd}/.paaw/api-tester/history.json）
            let hist = _atHelpers._loadHistoryFor(_ruRoot);
            hist.unshift(histItem);
            if (hist.length > 100) hist = hist.slice(0, 100);
            _atHelpers._saveHistoryFor(_ruRoot, hist);
          } catch {}

          // ── Report ──
          let report = `${tMethod} ${tUrl}\n`;
          if (ranFromCollection) report = `📁 collection "${ranFromCollection}"
` + report;
          report += `Status: ${tRes.status} ${tRes.statusText}\n`;
          report += `Elapsed: ${elapsed}ms · Body: ${respBody.length} chars\n`;
          if (expectStatus !== null) {
            report += tRes.status === expectStatus
              ? `✅ Status ${tRes.status} matches expected ${expectStatus}\n`
              : `❌ Status ${tRes.status} does NOT match expected ${expectStatus}\n`;
          }
          if (expectText) {
            report += respBody.includes(expectText)
              ? `✅ Found expected text: "${expectText.slice(0, 60)}"\n`
              : `❌ Expected text not found: "${expectText.slice(0, 60)}"\n`;
          }
          report += `\n📜 Saved to API Tester history (visible in UI 🌐 API Tester → 📜).\n\n--- Body (first 2500 chars) ---\n${respBody.slice(0, 2500)}`;
          if (respBody.length > 2500) report += `\n... (${respBody.length - 2500} more chars)`;

          if (onEvent) onEvent({ type: "tool_end", name, result: `${tRes.status} ${tRes.statusText} (${elapsed}ms)` });
          return report;
        } catch (err) {
          const elapsed = Date.now() - startTime;
          const errMsg = err.name === "AbortError" ? `timed out after 20s` : String(err.message || err);
          // 失敗也記錄(status 0)- 人看得到 agent 打了什麼失敗
          try {
            const histFile = resolve(DATA_HOME, "api-tester-history.json");
            let hist = [];
            try { hist = JSON.parse(readSync(histFile, "utf-8")); } catch {}
            hist.unshift({
              id: `req-${Date.now()}`, ts: new Date().toISOString(), method: tMethod, url: tUrl,
              status: 0, elapsed, headers: Object.entries(reqHeaders).map(([k, v]) => ({ key: k, value: v, enabled: true })),
              body: tBody || "", streamMode: false,
              response: { status: 0, statusText: "Network Error", headers: {}, body: errMsg, elapsed, size: 0, error: true },
              source: "agent", agent: agentId || undefined,
            });
            if (hist.length > 100) hist = hist.slice(0, 100);
            writeSync(histFile, JSON.stringify(hist, null, 2));
          } catch {}
          if (onEvent) onEvent({ type: "tool_error", name, error: errMsg });
          return `❌ ${tMethod} ${tUrl} failed after ${elapsed}ms: ${errMsg}\n(Also saved to API Tester history with status 0.)`;
        }
      }

      // ══════════════════════════════════════════
      // ── Real Browser Tools (Playwright) ──
      case "browser_navigate": {
        const url = assertSafeUrl(args.url);
        if (onEvent) onEvent({ type: "tool_start", name, args: url });
        try {
          const page = await getBrowserPage(resolveBrowserKey(cwd));
          trackPage(resolveBrowserKey(cwd), page);
          await page.goto(url, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(args.waitMs ?? 800);
          const title = await page.title().catch(() => "(no title)");
          const excerpt = (await readPageText(page, 1500)) || "(empty page)";
          const nvShot = await takeActionShot(resolveBrowserKey(cwd), page).catch(() => null);
          recordBrowserAction(resolveBrowserKey(cwd), { actor: "agent", kind: "navigate", summary: `載入「${title}」`, url: page.url(), shot: nvShot });
          if (onEvent) onEvent({ type: "tool_end", name, result: title });
          return `✅ Loaded: ${title}\nURL: ${page.url()}\n\n--- Text excerpt ---\n${excerpt}\n\nUse browser_read for full content, browser_screenshot for visual capture.`;
        } catch (navErr) {
          const hint = /playwright|Cannot find module/i.test(navErr?.message || "") ? `\n\n${PLAYWRIGHT_INSTALL_HINT}` : "";
          if (onEvent) onEvent({ type: "tool_error", name, error: navErr.message });
          return `❌ browser_navigate failed: ${navErr.message}${hint}`;
        }
      }
      case "browser_read": {
        if (onEvent) onEvent({ type: "tool_start", name, args: {} });
        try {
          const page = await getBrowserPage(resolveBrowserKey(cwd));
          trackPage(resolveBrowserKey(cwd), page);
          const text = await readPageText(page, Math.min(args.maxLength || 8000, 20000));
          recordBrowserAction(resolveBrowserKey(cwd), { actor: "agent", kind: "read", summary: `讀取頁面文字(${text.length} 字)`, url: page.url() });
          if (onEvent) onEvent({ type: "tool_end", name, result: `${text.length} chars` });
          return `URL: ${page.url()}\n\n${text || "(empty page)"}`;
        } catch (readErr) {
          const hint = /playwright|Cannot find module/i.test(readErr?.message || "") ? `\n\n${PLAYWRIGHT_INSTALL_HINT}` : "";
          if (onEvent) onEvent({ type: "tool_error", name, error: readErr.message });
          return `❌ browser_read failed: ${readErr.message}${hint}`;
        }
      }
      case "browser_screenshot": {
        if (onEvent) onEvent({ type: "tool_start", name, args: {} });
        try {
          const page = await getBrowserPage(resolveBrowserKey(cwd));
          trackPage(resolveBrowserKey(cwd), page);
          const path = await takeScreenshot(resolveBrowserKey(cwd), page);
          // Vision Phase 3(2026-08-30):多拍一張 jpeg q80 給 LLM 看(png 留給 IDE Browser tab 人看)
          // 標記由 agent loop 攔截 → 圖進 message;沒 vision 能力時降級為文字提示
          recordBrowserAction(resolveBrowserKey(cwd), { actor: "agent", kind: "screenshot", summary: "截圖存證", url: page.url() });
          let visionMarker = "";
          try {
            const shotDir = browserShotDir(resolveBrowserKey(cwd));
            const visionPath = join(shotDir, `shot-${Date.now()}.vision.jpg`);
            await page.screenshot({ path: visionPath, type: "jpeg", quality: 80, fullPage: false });
            visionMarker = `\n[[PAAW_IMAGE:${visionPath.split(/[\\/]/).join("/")}]]`;
          } catch { /* vision copy 失敗不影響主截圖 */ }
          if (onEvent) onEvent({ type: "tool_end", name, result: path });
          return `📸 Screenshot saved: ${path}${visionMarker}\nPNG 存檔(人看):IDE Browser tab。若 vision 可用,畫面已直接附在你的上下文裡 - 請描述你看到的內容做視覺驗證;看不到圖就用 browser_read 讀文字。`;
        } catch (shotErr) {
          const hint = /playwright|Cannot find module/i.test(shotErr?.message || "") ? `\n\n${PLAYWRIGHT_INSTALL_HINT}` : "";
          if (onEvent) onEvent({ type: "tool_error", name, error: shotErr.message });
          return `❌ browser_screenshot failed: ${shotErr.message}${hint}`;
        }
      }
      case "browser_click": {
        if (onEvent) onEvent({ type: "tool_start", name, args });
        try {
          const page = await getBrowserPage(resolveBrowserKey(cwd));
          trackPage(resolveBrowserKey(cwd), page);
          const target = locateTarget(page, args);
          if (getVisualMode(resolveBrowserKey(cwd))) {
            await visualClick(page, target); // 真人節奏:高亮 → 滑行 → 按壓(fallback 內建)
          } else {
            await target.click({ timeout: 10_000 });
          }
          await page.waitForTimeout(600);
          const ckShot = await takeActionShot(resolveBrowserKey(cwd), page).catch(() => null);
          recordBrowserAction(resolveBrowserKey(cwd), { actor: "agent", kind: "click", summary: `點擊 ${args.selector || JSON.stringify(args.text)}`, url: page.url(), shot: ckShot });
          const excerpt = (await readPageText(page, 1200)) || "(empty)";
          if (onEvent) onEvent({ type: "tool_end", name, result: `clicked @ ${page.url()}` });
          return `✅ Clicked (${args.selector || JSON.stringify(args.text)})\nURL now: ${page.url()}\n\n--- Text excerpt ---\n${excerpt}`;
        } catch (clickErr) {
          const hint = /playwright|Cannot find module/i.test(clickErr?.message || "") ? `\n\n${PLAYWRIGHT_INSTALL_HINT}` : "";
          if (onEvent) onEvent({ type: "tool_error", name, error: clickErr.message });
          return `❌ browser_click failed: ${clickErr.message}${hint}`;
        }
      }
      case "browser_type": {
        if (onEvent) onEvent({ type: "tool_start", name, args });
        try {
          const page = await getBrowserPage(resolveBrowserKey(cwd));
          trackPage(resolveBrowserKey(cwd), page);
          const input = page.locator(args.selector).first();
          if (getVisualMode(resolveBrowserKey(cwd))) {
            // 真人節奏:游標滑到欄位點進去 → 清空 → 逐字打字(字間帶隨機延遲)
            await visualClick(page, input);
            await input.fill("", { timeout: 10_000 });
            await input.pressSequentially(String(args.text), { delay: 55 + Math.floor(Math.random() * 35) });
          } else {
            await input.fill(String(args.text), { timeout: 10_000 });
          }
          if (args.submit) await input.press("Enter");
          await page.waitForTimeout(600);
          recordBrowserAction(resolveBrowserKey(cwd), { actor: "agent", kind: "type", summary: `輸入 ${args.selector} ← "${String(args.text).slice(0, 40)}"${args.submit ? " +Enter" : ""}`, url: page.url() });
          const excerpt = (await readPageText(page, 1200)) || "(empty)";
          if (onEvent) onEvent({ type: "tool_end", name, result: `typed into ${args.selector}` });
          return `✅ Typed into ${args.selector}${args.submit ? " + Enter" : ""}\nURL now: ${page.url()}\n\n--- Text excerpt ---\n${excerpt}`;
        } catch (typeErr) {
          const hint = /playwright|Cannot find module/i.test(typeErr?.message || "") ? `\n\n${PLAYWRIGHT_INSTALL_HINT}` : "";
          if (onEvent) onEvent({ type: "tool_error", name, error: typeErr.message });
          return `❌ browser_type failed: ${typeErr.message}${hint}`;
        }
      }
      // 2026-09-12:native select 下拉操作 - selectOption(label 或 value 二選一)
      case "browser_select": {
        if (onEvent) onEvent({ type: "tool_start", name, args: `${args.selector} → ${args.label || args.value}` });
        try {
          const page = await getBrowserPage(resolveBrowserKey(cwd));
          trackPage(resolveBrowserKey(cwd), page);
          const sel = page.locator(args.selector).first();
          // 列出選項讓 agent 看得到有哪些(沒給 label/value 時直接回清單)
          if (!args.label && !args.value) {
            const opts = await sel.locator("option").evaluateAll(os => os.map(o => ({ value: o.value, label: o.textContent.trim(), selected: o.selected })));
            if (onEvent) onEvent({ type: "tool_end", name, result: `${opts.length} options` });
            return `Options in ${args.selector} (${opts.length}):\n${opts.map(o => `${o.selected ? "*" : " "} [${o.value}] ${o.label}`).join("\n")}\n(call again with label= or value= to select)`;
          }
          const choice = args.label !== undefined ? { label: String(args.label) } : { value: String(args.value) };
          await sel.selectOption(choice, { timeout: 10_000 });
          await page.waitForTimeout(400);
          const chosen = await sel.inputValue();
          const slShot = await takeActionShot(resolveBrowserKey(cwd), page).catch(() => null);
          recordBrowserAction(resolveBrowserKey(cwd), { actor: "agent", kind: "select", summary: `下拉選 ${args.label || args.value}`, url: page.url(), shot: slShot });
          const excerpt = (await readPageText(page, 1000)) || "(empty)";
          if (onEvent) onEvent({ type: "tool_end", name, result: `selected ${chosen}` });
          return `✅ Selected ${args.label || args.value} in ${args.selector} (current value: ${chosen})\nURL: ${page.url()}\n\n--- Text excerpt ---\n${excerpt.slice(0, 600)}`;
        } catch (selErr) {
          const hint = /playwright|Cannot find module/i.test(selErr?.message || "") ? `\n\n${PLAYWRIGHT_INSTALL_HINT}` : "";
          if (onEvent) onEvent({ type: "tool_error", name, error: selErr.message });
          return `❌ browser_select failed: ${selErr.message}${hint}`;
        }
      }

      // ══════════════════════════════════════════
      // ── Staged Summary Tool ──
      case "staged_summary": {
        try {
          const summaryPath = join(cwd, ".paaw", "staged-changes.json");
          const summaryData = {
            createdAt: new Date().toISOString(),
            agent: agentId || "unknown",
            task: args.task || "",
            taskId: args.taskId || "",
            summary: args.summary || "",
            files: args.files || [],
            howToTest: args.howToTest || "",
            risk: args.risk || "無",
          };
          await mkdir(dirname(summaryPath), { recursive: true });
          await writeFile(summaryPath, JSON.stringify(summaryData, null, 2) + "\n", "utf-8");
          if (onEvent) onEvent({ type: "tool_end", name, result: `Staged summary saved to .paaw/staged-changes.json (${summaryData.files.length} files)` });
          return `✅ Staged summary saved. ${summaryData.files.length} files recorded.\nHuman will see this in Git tab.`;
        } catch (err) {
          return `Error saving staged summary: ${err.message}`;
        }
      }

      // ══════════════════════════════════════════
      // ── Project Knowledge Read Tools (structured .paaw/ access) ──
      // ── Unified project_info handler ──
      case "project_info": {
        // ── Alias mapping: old tool names → project_info category ──
        const cat = args.category;
        if (!cat) return "Error: 'category' parameter is required. Valid: context, issues, features, feature_detail, runbook, sessions, test_map, recent_changes, api_history, project_read, error_codes, c4_model, security, decisions, changelog";
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
          case "changelog": {
            if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
            try {
              const content = await paaw.readFile("CHANGELOG.md");
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: content ? `${content.length} chars` : "empty" });
              return content || "(No changelog yet)";
            } catch { return "(No CHANGELOG.md found)"; }
          }
          case "project_read": {
            if (!paaw.exists) return "⚠️ .paaw/ not initialized.";
            const proj = await paaw.readFile("PROJECT.md");
            if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: proj ? `${proj.length} chars` : "empty" });
            return proj || "(No PROJECT.md found)";
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
          // 2026-11-08 Fleming：coding agent 的 project_info 補上 API Map（API-first）— 只有 chat 側 tools/index 有，agent 側查不到
          case "api_map": {
            try {
              const { readApiFeatures } = await import("./coding-db/reads.mjs");
              const apis = readApiFeatures(cwd);
              if (!apis.length) return "(API Map 空 — 先跑 CU api-map 步驟)";
              const byCat = {};
              for (const a of apis) (byCat[a.category] ??= []).push(a);
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${apis.length} apis` });
              return "API Map (" + apis.length + " entries, API-first):\n" + Object.entries(byCat).map(([cat, list]) =>
                `## ${cat} (${list.length})\n` + list.map(a => `- [${a.id}] ${a.entry} — ${a.name}${a.codeFiles?.length ? ` (${a.codeFiles.length} files)` : ""}`).join("\n")
              ).join("\n\n");
            } catch (err) { return `Error: ${err.message}`; }
          }
          case "api_detail": {
            try {
              const { readApiFeatures } = await import("./coding-db/reads.mjs");
              const apis = readApiFeatures(cwd);
              const key = String(args.entry || args.id || "").trim().toUpperCase();
              const a = apis.find(x => x.id === (args.id || args.entry) || x.entry.toUpperCase() === key || x.entry.toUpperCase().includes(key));
              if (!a) return `找不到 API：${args.entry || args.id}（先 project_info(category="api_map") 查清單）`;
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: a.entry });
              return `## ${a.id} ${a.entry}\n分類: ${a.category} | ${a.name}\n${a.description ? `描述: ${a.description}\n` : ""}${a.bizLogic ? `業務邏輯: ${a.bizLogic}\n` : ""}${(a.processFlow?.length) ? `\n### Process Flow\n${a.processFlow.map(s => `${s.step}. ${s.action} — ${s.detail || ""}${s.file ? ` (${s.file})` : ""}`).join("\n")}\n` : ""}${(a.validation?.length) ? `\n### Validation\n${a.validation.map(v => `- ${v.field}: ${v.rule} (on ${v.on || "?"}, fail ${v.fail || "?"})`).join("\n")}\n` : ""}${(a.dataTouch?.length) ? `\n### Data Touch\n${a.dataTouch.map(d => `- ${d.table}: ${(d.ops || []).join(",")}`).join("\n")}\n` : ""}${(a.codeFiles?.length) ? `\n檔案: ${a.codeFiles.join(", ")}` : ""}`;
            } catch (err) { return `Error: ${err.message}`; }
          }
          case "features": {
            try {
              const { loadFeatures: _lf } = await import("./feature-registry.mjs"); // coding.db
              let features = _lf(cwd) || [];
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
          case "error_codes": { // 2026-09-05 v2:LLM 語意整理 - agent 寫碼前查既有 error 處理、helpdesk 從 code 追 feature
            const ecFile = join(cwd, ".paaw", "error-codes.json");
            if (!existsSync(ecFile)) return "(No error-codes.json - CU error-codes 步驟未跑。請跑 CU 或請人類在 FeatureMap panel 🔢 整理。注意:整理會花 LLM token。)";
            try {
              const data = JSON.parse(readSync(ecFile, "utf-8"));
            if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${data.stats?.uniqueCodes || 0} codes` });
              // 🔍 反查(debug 入口):錯誤碼/訊息片段 → feature + file:line
              if (args.search) {
                const q = String(args.search).toLowerCase();
                const hit = (c) => (c.code || "").toLowerCase().includes(q) || (c.message || "").toLowerCase().includes(q) || (c.file || "").toLowerCase().includes(q);
                const groups = [];
                for (const g of data.byFeature || []) {
                  const matched = (g.codes || []).filter(hit);
                  if (matched.length) groups.push({ g, matched });
                }
                const unmappedHits = (data.unmapped || []).filter(hit);
                if (!groups.length && !unmappedHits.length) {
                  return `🔍 沒有 hit「${args.search}」。建議:換更短的穩定片段(code 前綴或訊息關鍵字,避開變數值),或不帶 search 列出全部。`;
                }
                const lines = [`🔍 error codes 反查「${args.search}」:`];
                for (const { g, matched } of groups.slice(0, 10)) {
                  lines.push(``, `[${g.featureId}] ${g.featureName}${g.summary ? ` - ${g.summary.slice(0, 80)}` : ""}`);
                  for (const c of matched.slice(0, 8)) {
                    lines.push(`  ${c.code || `(無code)`}${c.message ? `「${c.message}」` : ""} @${c.file}${c.line ? ":" + c.line : ""}${c.httpStatus ? ` [HTTP ${c.httpStatus}]` : ""}${c.kind === "throw" ? " (throw)" : ""}`);
                  }
                }
                if (unmappedHits.length) {
                  lines.push(``, `(unmapped - 不屬於任何 feature:)`);
                  for (const c of unmappedHits.slice(0, 5)) lines.push(`  ${c.code || `(無code)`}${c.message ? `「${c.message}」` : ""} @${c.file}${c.line ? ":" + c.line : ""}`);
                }
                return lines.join("\n");
              }
              if (args.feature) {
                const g = (data.byFeature || []).find(f => f.featureId === args.feature || f.featureName?.toLowerCase().includes(String(args.feature).toLowerCase()));
                if (!g) return `(No error codes found for feature '${args.feature}')`;
                const lines = (g.codes || []).map(c => `  ${c.code || `(無code) ${c.message}`} - ${c.file}${c.line ? ":" + c.line : ""}${c.httpStatus ? ` [HTTP ${c.httpStatus}]` : ""}${c.kind === "throw" ? " (throw)" : ""}`);
                return `Error handling for [${g.featureId}] ${g.featureName} (${g.uniqueCount} unique)${g.summary ? `\n摘要:${g.summary}` : ""}\n${lines.join("\n")}`;
              }
              const head = (data.byFeature || []).slice(0, args.limit ? Number(args.limit) : 15).map(g =>
                `[${g.featureId}] ${g.featureName}: ${g.uniqueCount || (g.codes || []).length} codes`);
              const extra = (data.byFeature || []).length > 15 ? `\n... 共 ${data.byFeature.length} 個 feature(帶 feature 參數看單一 feature)` : "";
              const rec = data.recommendation?.suggest ? `\n⚠️ 建議導入 Error Code Rules v1(plan 詳見 error-codes.json / FeatureMap panel)` : "";
              return `Error codes by feature (${data.stats?.uniqueCodes || 0} unique / ${data.byFeature?.length || 0} features / conventions: ${data.conventions || "unknown"})${data.conventionNote ? `\n慣例:${data.conventionNote}` : ""}${rec}\n${head.join("\n")}${extra}\nunmapped: ${(data.unmapped || []).length}`;
            } catch (err) { return `Error reading error-codes: ${err.message}`; }
          }
          case "c4_model": { // 2026-09-05:對外連線全景 - ops/handover/architect 查 RU 連哪些 DB/服務
            const c4File = join(cwd, ".paaw", "c4-model.json");
            if (!existsSync(c4File)) return "(No c4-model.json - CU c4-model 步驟未跑。請跑 CU 或請人類在 Code Intel → Architecture tab 整理。注意:組裝會花 LLM token。)";
            try {
              const data = JSON.parse(readSync(c4File, "utf-8"));
            if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${data.stats?.external || 0} external` });
              const fmt = (c) => `  ${c.name} [${c.type || "?"}]${c.technology ? ` (${c.technology})` : ""} - ${c.description || ""}${c.evidence?.length ? ` | 證據: ${c.evidence.slice(0, 3).join("; ")}` : ""}`;
              if (args.search) {
                const q = String(args.search).toLowerCase();
                const hit = (c) => [c.name, c.type, c.technology, c.description, ...(c.evidence || [])].join(" ").toLowerCase().includes(q);
                const cont = (data.containers || []).filter(hit);
                const ext = (data.externalSystems || []).filter(hit);
                const rel = (data.relationships || []).filter(r => `${r.from} ${r.to} ${r.protocol} ${r.description}`.toLowerCase().includes(q));
                if (!cont.length && !ext.length && !rel.length) return `🔍 c4 沒有 hit「${args.search}」。試更短的關鍵字(如 redis、db、佇列)。`;
                const lines = [`🔍 C4 搜尋「${args.search}」:`];
                if (cont.length) { lines.push(``, `Containers:`); cont.forEach(c => lines.push(fmt(c))); }
                if (ext.length) { lines.push(``, `External systems:`); ext.forEach(c => lines.push(fmt(c))); }
                if (rel.length) { lines.push(``, `Relationships:`); rel.forEach(r => lines.push(`  ${r.from} → ${r.to} (${r.protocol || "?"}) - ${r.description || ""}`)); }
                return lines.join("\n");
              }
              const lines = [`# C4 對外連線:${data.system?.name || ""}`, data.system?.description || "", "", "## Containers", ...(data.containers || []).map(fmt), "", "## External systems", ...(data.externalSystems || []).map(fmt), "", "## Relationships", ...(data.relationships || []).map(r => `  ${r.from} → ${r.to} (${r.protocol || "?"}) - ${r.description || ""}`)];
              if (data.notes) lines.push("", `Notes: ${data.notes}`);
              return lines.join("\n");
            } catch (err) { return `Error reading c4-model: ${err.message}`; }
          }
          case "feature_detail": {
            if (!args.id) return "Error: 'id' parameter is required for feature_detail.";
            try {
              const { loadFeatures: _lf } = await import("./feature-registry.mjs"); // coding.db
              const feature = (_lf(cwd) || []).find(f => f.id === args.id);
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
            // 2026-09-06 Fleming:QA/SA 要能看到 security scan 明細並開 task 單 - 補 cwe/snippet/references/feature 對應
            const secFile = join(cwd, ".paaw", "security", "scan-results.json");
            if (!existsSync(secFile)) return "⚠️ Security scan results not found - 先跑 Security Scan(EM dashboard 或 CU security-scan step)。";
            try {
              const sec = JSON.parse(readSync(secFile, "utf-8"));
              const total = (sec.findings || []).length;
              let findings = sec.findings || [];
              if (args.severity) {
                const want = String(args.severity).toLowerCase();
                findings = findings.filter(f => String(f.severity).toLowerCase() === want);
              }
              if (args.file) { const norm = args.file.replace(/\\/g, "/"); findings = findings.filter(f => f.file?.replace(/\\/g, "/").includes(norm)); }
              if (args.search) { const q = String(args.search).toLowerCase(); findings = findings.filter(f => `${f.message || ""} ${f.id || ""} ${Array.isArray(f.cwe) ? f.cwe.join(" ") : f.cwe || ""}`.toLowerCase().includes(q)); }
              if (findings.length === 0) { if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: "clean" }); return `No security findings${total ? " matching filter" : ""}. ✅`; }
              // feature 對照(開 task 單掛 featureId 用)- FILE-FEATURES.json repo-relative key
              let fileFeatures = {};
              try { fileFeatures = readDocDb(cwd, "fileFeatures")?.files || {}; } catch {}
              const cwdN = cwd.replace(/\\/g, "/");
              const rel = (p) => { const n = String(p || "").replace(/\\/g, "/"); return n.startsWith(cwdN + "/") ? n.slice(cwdN.length + 1) : n; };
              const header = `Security Findings(${findings.length}/${total},scanned ${sec.scannedAt || "(unknown)"}${sec.stats?.bySeverity ? `,severity ${JSON.stringify(sec.stats.bySeverity)}` : ""})`;
              const lines = findings.map(f => {
                const rf = rel(f.file);
                const rule = String(f.id || "").split(".").pop();
                const cwe = Array.isArray(f.cwe) ? f.cwe.join("; ") : f.cwe;
                const feats = (fileFeatures[rf] || []).map(x => x.id).join(",");
                const snip = String(f.snippet || "").replace(/\s+/g, " ").slice(0, 120);
                const refs = (f.references || []).slice(0, 1).join("");
                return `- [${String(f.severity || "?").toUpperCase()}] ${rf}:${f.line || "?"}${cwe ? `|${cwe}` : ""}${feats ? `|feature: ${feats}` : ""}${f.confidence ? `|confidence ${f.confidence}` : ""}\n  rule: ${rule}|${f.message}${snip ? `\n  code: ${snip}` : ""}${refs ? `\n  ref: ${refs}` : ""}`;
              }).join("\n");
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${findings.length} findings` });
              return `${header}\n${lines}\n(開 task 修復時掛對應 featureId;severity/file/search 可過濾)`;
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
            // 2026-09-12:單一事實來源(跟 api-tester route / api_test tool 同檔);
            // 2026-09-29：RU-scoped 讀取
            // 加 source 過濾 + detail 模式(回傳完整 headers/body - 拿人輸入過的資料產 e2e script)
            try {
            const _atH = await import("../routes/api-tester.mjs");
            const raw = _atH._loadHistoryFor(cwd || null);
            let items = Array.isArray(raw) ? raw : (raw.history || []);
              if (args.source) items = items.filter(i => (i.source || "human") === args.source);
              if (args.method) items = items.filter(i => i.method?.toUpperCase() === args.method.toUpperCase());
              if (args.path_contains) { const needle = args.path_contains.toLowerCase(); items = items.filter(i => i.url?.toLowerCase().includes(needle)); }
              // detail 模式:回傳單筆完整 request(headers/body/response)- e2e script 產生用
              if (args.detail !== undefined && args.detail !== null && args.detail !== "") {
                const d = args.detail;
                const item = (typeof d === "string" && d.startsWith("req-"))
                  ? items.find(i => i.id === d)
                  : items[Number(d) - 1];
                if (!item) return `No history entry for detail='${d}' (use api_history without detail to list).`;
                const hArr = Array.isArray(item.headers) ? item.headers : Object.entries(item.headers || {}).map(([k, v]) => ({ key: k, value: String(v), enabled: true }));
                const full = {
                  id: item.id, ts: item.ts, source: item.source || "human", agent: item.agent,
                  method: item.method, url: item.url, status: item.status, elapsed: item.elapsed,
                  headers: hArr, body: item.body,
                  response: item.response ? { status: item.response.status, statusText: item.response.statusText, body: String(item.response.body || "").slice(0, 2000) } : (item.streamResponse ? { status: item.status, body: String(item.streamResponse).slice(0, 2000) } : undefined),
                };
                if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${item.method} ${item.url}` });
                return `API History Entry (full request - for e2e script generation):\n${JSON.stringify(full, null, 2)}`;
              }
              const limit = Math.min(args.limit || 20, 50);
              items = items.slice(0, limit);
              if (items.length === 0) return "No matching API history.";
              if (onEvent) onEvent({ type: "tool_end", name: "project_info", result: `${items.length} entries` });
              return `API History (${items.length}):\n${items.map((item, idx) => `${idx+1}. [${item.source === "agent" ? "agent" : "human"}] ${item.method} ${item.url} → ${item.status} (${item.elapsed}ms)`).join("\n")}\n(tip: detail=<N or req-id> 回傳完整 headers/body - 拿人輸入過的資料產 e2e Playwright script;source=human|agent 過濾)`;
            } catch (err) { return `Error: ${err.message}`; }
          }
          default:
            return `Unknown category '${cat}'. Valid: context, issues, features, feature_detail, runbook, sessions, test_map, recent_changes, api_history, project_read`;
        }
      }



      // ══════════════════════════════════════════
      // ── Project Board(維護 data/projects/ - 一個 RU 對應一個 project)──
      // ══════════════════════════════════════════

      case "project_board": {
        const PROJECTS_DIR = join(DATA_HOME, "projects");
        const action = args.action;

        const _loadProject = (pid) => {
          const f = join(PROJECTS_DIR, `${pid}.json`);
          if (!existsSync(f)) return null;
          try { return JSON.parse(readSync(f, "utf-8")); } catch { return null; }
        };
        const _saveProject = (p) => {
          writeSync(join(PROJECTS_DIR, `${p.id}.json`), JSON.stringify(p, null, 2));
        };

        if (action === "status") {
          const files = existsSync(PROJECTS_DIR) ? (await readdir(PROJECTS_DIR)).filter(f => f.endsWith(".json")).sort() : [];
          if (files.length === 0) return "No projects found.";
          const lines = [];
          for (const f of files) {
            const p = _loadProject(f.replace(/\.json$/, ""));
            if (!p) continue;
            const cats = p.categories || [];
            const allTasks = cats.flatMap(c => c.tasks || []);
            const done = allTasks.filter(t => t.status === "done").length;
            const pct = allTasks.length ? Math.round((done / allTasks.length) * 100) : 0;
            lines.push(`📦 ${p.name} (${p.id}) ${p.icon || ""} [${p.status || "?"}] ${pct}% (${done}/${allTasks.length})
   目標日: ${p.targetDate || "-"} | categories: ${cats.map(c => `${c.name}(${(c.tasks||[]).length})`).join(", ") || "none"}`);
          }
          if (onEvent) onEvent({ type: "tool_end", name, result: `${files.length} projects` });
          return lines.join("\n");
        }

        if (action === "create") {
          if (!args.id || !args.name) return "Error: 'id' and 'name' are required for create.";
          if (!/^[a-z0-9][a-z0-9-_]*$/.test(args.id)) return "Error: id must be lowercase letters/digits/dash/underscore.";
          if (_loadProject(args.id)) return `Error: project '${args.id}' already exists.`;
          const proj = {
            id: args.id, name: args.name, icon: args.icon || "📦", description: args.description || "",
            status: "planning", startDate: args.startDate || new Date().toISOString().slice(0, 10),
            targetDate: args.targetDate || "", repo: args.repo || "", aliases: args.aliases || [],
            categories: [], milestones: [], createdAt: new Date().toISOString(),
          };
          await mkdir(PROJECTS_DIR, { recursive: true });
          _saveProject(proj);
          if (onEvent) onEvent({ type: "tool_end", name, result: args.id });
          return `✅ Created project ${args.id}: ${args.name}\n⚠️ 記得設定 aliases(本機資料夾名)讓 agent 執行紀錄能對應 RU 成本。`;
        }

        // 以下 actions 都需要 projectId
        if (!args.projectId) return "Error: 'projectId' is required for this action.";
        const proj = _loadProject(args.projectId);
        if (!proj) return `Error: project '${args.projectId}' not found.`;

        if (action === "update") {
          for (const k of ["name", "icon", "description", "status", "startDate", "targetDate", "repo"]) {
            if (args[k] !== undefined) proj[k] = args[k];
          }
          if (Array.isArray(args.aliases)) proj.aliases = args.aliases;
          _saveProject(proj);
          if (onEvent) onEvent({ type: "tool_end", name, result: "updated" });
          return `✅ Updated project ${proj.id}.`;
        }

        if (action === "category_create") {
          if (!args.name) return "Error: 'name' is required for category_create.";
          proj.categories = proj.categories || [];
          const cat = { id: `cat_${Date.now().toString(36)}`, name: args.name, icon: args.icon || "📁", description: args.description || "", tasks: [] };
          proj.categories.push(cat);
          _saveProject(proj);
          if (onEvent) onEvent({ type: "tool_end", name, result: cat.id });
          return `✅ Added category '${args.name}' to ${proj.id}.`;
        }

        if (action === "task_create") {
          if (!args.name) return "Error: 'name' is required for task_create.";
          proj.categories = proj.categories || [];
          if (proj.categories.length === 0) return "Error: project has no categories. Create one with category_create first.";
          const cat = args.categoryId ? proj.categories.find(c => c.id === args.categoryId) : proj.categories[proj.categories.length - 1];
          if (!cat) return `Error: category '${args.categoryId}' not found.`;
          cat.tasks = cat.tasks || [];
          const task = {
            id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            name: args.name, status: "todo", priority: args.priority || "medium",
            start: args.start || "", end: args.end || "",
          };
          cat.tasks.push(task);
          _saveProject(proj);
          if (onEvent) onEvent({ type: "tool_end", name, result: task.id });
          return `✅ Added task '${args.name}' (${task.id}) to ${proj.id}/${cat.name}.`;
        }

        if (action === "task_update") {
          if (!args.taskId) return "Error: 'taskId' is required for task_update.";
          let found = null;
          for (const c of (proj.categories || [])) {
            const t = (c.tasks || []).find(t => t.id === args.taskId);
            if (t) { found = t; break; }
          }
          if (!found) return `Error: task '${args.taskId}' not found in ${proj.id}.`;
          for (const k of ["name", "status", "priority", "start", "end"]) {
            if (args[k] !== undefined) found[k] = args[k];
          }
          _saveProject(proj);
          if (onEvent) onEvent({ type: "tool_end", name, result: args.taskId });
          return `✅ Updated task ${args.taskId}: ${found.name} [${found.status}]`;
        }

        if (action === "milestone_create") {
          if (!args.name || !args.date) return "Error: 'name' and 'date' are required for milestone_create.";
          proj.milestones = proj.milestones || [];
          proj.milestones.push({ id: `ms_${Date.now().toString(36)}`, name: args.name, date: args.date, description: args.description || "" });
          _saveProject(proj);
          if (onEvent) onEvent({ type: "tool_end", name, result: "created" });
          return `✅ Added milestone '${args.name}' (${args.date}) to ${proj.id}.`;
        }

        return `Unknown action '${action}'.`;
      }



      // ══════════════════════════════════════════
      // ── CU Refresh (incremental, not full overwrite) ──
      // ══════════════════════════════════════════

      case "cu_refresh": {
        const steps = Array.isArray(args.steps) ? args.steps : ["code-intelligence", "test-intelligence"];
        const results = [];
        const paawDir = join(cwd, ".paaw");
        if (!existsSync(paawDir)) {
          if (onEvent) onEvent({ type: "tool_end", name, result: "no .paaw" });
          return "⚠️ .paaw/ not initialized. Run full Code Understanding first.";
        }

        // Deterministic steps - always safe to re-run, no LLM needed
        if (steps.includes("code-intelligence")) {
          try {
            const { buildCodeIntelligence } = await import("./code-intelligence.mjs");
            const { summary } = await buildCodeIntelligence(cwd, _PAAW_ROOT);
            results.push(`🧠 Code Intelligence: ${summary.totalFunctions} functions, ${summary.totalRoutes} routes, ${summary.totalDependencies} deps`);
          } catch (err) { results.push(`🧠 Code Intelligence: failed - ${err.message}`); }
        }
        if (steps.includes("test-intelligence")) {
          try {
            const { buildTestIntelligence } = await import("./test-intelligence.mjs");
            const { summary } = await buildTestIntelligence(cwd, _PAAW_ROOT);
            results.push(`🧪 Test Intelligence: ${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`);
          } catch (err) { results.push(`🧪 Test Intelligence: failed - ${err.message}`); }
        }

        // LLM steps - these re-run the CU step via API (requires server running)
        const llmSteps = steps.filter(s => !["code-intelligence", "test-intelligence"].includes(s));
        if (llmSteps.length > 0) {
          results.push(`\n⚠️ LLM steps (${llmSteps.join(", ")}) require calling POST /api/coding-project/ai-initial-step - use from Coding IDE or auto dispatch.`);
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
          return "⚠️ .paaw/ not initialized. Decision not recorded. (This is OK - the decision is still captured in the session log.)";
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

      // ── API Map 歸類（2026-11-01 API-first）──
      case "api_map_update": {
        const { mergeApiMappings } = await import("./coding-db/api-features.repo.mjs");
        const { writeDoc } = await import("./coding-db/docs.repo.mjs");
        try {
          const r = mergeApiMappings(cwd, args.entries || [], writeDoc);
          if (r.merged === 0) {
            return `⚠ 0 筆合併（全部冪等或被跳過）。${r.skipped.length ? `跳過：${r.skipped.slice(0, 3).map(s => `${s.file}（${s.reason}）`).join("、")}${r.skipped.length > 3 ? "…" : ""}` : "（皆已歸類過）"}`;
          }
          const skipPart = r.skipped.length ? `；${r.skipped.length} 筆跳過（${r.skipped[0].reason}…）` : "";
          return `✅ 歸類 ${r.merged} 檔 → api_features.codeFiles${skipPart}\ncoding.db 代寫 + fileApiMap 反向索引重建。下一步：rr_get 確認 api-map 轉綠。`;
        } catch (e) {
          return `❌ api_map_update failed: ${e.message}`;
        }
      }

      case "qa_record_save": {
        const { saveQaResult } = await import("./qa-results.mjs");
        try {
          // 2026-10-22 lineage 制：自動綁樹 — 記錄當下 HEAD（RR qa-records scope 綁定靠這個判定「測於哪棵樹」）
          let headSha = args.headSha || null;
          if (!headSha && cwd) {
            try {
              const { shellExec } = await import("./shell-exec.mjs");
              const { stdout } = await shellExec("git rev-parse HEAD", { cwd, timeout: 5000 });
              headSha = (stdout || "").trim() || null;
            } catch { /* 非 git repo → 不綁（舊行為） */ }
          }
          const record = saveQaResult(cwd, { ...args, headSha, actor: agentId || "human" });
          if (onEvent) onEvent({ type: "tool_end", name, result: `${record.verdict} - ${record.target}` });
          return `✅ QA result recorded: ${record.id} [${record.verdict}] ${record.target}\nStatus: ${record.status} | Issues: ${record.issues.length} | Tree: ${record.headSha ? record.headSha.slice(0, 8) : "unbound"}\nSaved to .paaw/coding-memory/qa-results.jsonl - visible to all agents and the human.`;
        } catch (e) {
          return `❌ qa_record_save failed: ${e.message}`;
        }
      }
      case "qa_record_list": {
        const { listQaResults } = await import("./qa-results.mjs");
        const list = listQaResults(cwd, { ...args, limit: args.limit || 10 });
        if (list.length === 0) return "No QA results found (adjust filters, or the log is empty - record tests with qa_record_save).";
        return list.map((r) => {
          const issues = (r.issues || []).map(x => `    [${x.severity}]${x.status === "open" ? "🔴" : "✅"} ${x.desc}`).join("\n");
          return `${r.id} [${r.verdict}/${r.status}] ${r.type} · ${r.target}\n   ${new Date(r.ts).toLocaleString()} by ${r.actor} - ${r.summary.slice(0, 150)}${issues ? "\n" + issues : ""}`;
        }).join("\n\n");
      }
      case "qa_record_update": {
        const { updateQaResult } = await import("./qa-results.mjs");
        const rec = updateQaResult(cwd, args.id, args, agentId || "human");
        if (!rec) return `❌ QA result not found: ${args.id} (use qa_record_list to find the id)`;
        if (onEvent) onEvent({ type: "tool_end", name, result: `${rec.id} → ${rec.status}` });
        return `✅ Updated ${rec.id}: status=${rec.status}\nIssues: ${(rec.issues || []).map(x => `${x.status === "open" ? "🔴" : "✅"} ${x.desc.slice(0, 60)}`).join(" | ")}`;
      }

      // ── Release Request Tools(v3 2026-09-18:RM agent 審證據、寫建議,人類確認)──
      case "rr_list": {
        const { listReleaseRequests } = await import("./release-requests.mjs");
        let list = await listReleaseRequests(cwd);
        if (args.status) list = list.filter(r => r.status === args.status);
        if (list.length === 0) return "No release requests found. (Create one from the Release Manager UI - 📋 Release Requests section.)";
        return list.map(r =>
          `${r.id} [${r.status}] ${r.title}\n   ${r.baseline?.short || "?"} → ${r.target?.short || "?"} · ${r.scope?.commits ?? 0} commits / ${r.scope?.files ?? 0} files / ${r.scope?.tasks ?? 0} tasks\n   checklist: ${(r.checklist || []).map(c => `${c.id}=${c.verdict}(auto:${c.auto})`).join(" · ")}${r.releaseId ? `\n   → ${r.releaseId}` : ""}`
        ).join("\n\n");
      }
      case "rr_get": {
        // 2026-10-22 lineage 制：agent 讀單一律先刷新（target 前進 + auto 重跑）—
        // 刷新是 deterministic 記帳不是 verdict；從此 agent 眼中的證據永遠是新樹，不再對凍結靶心報告
        const { refreshReleaseRequest } = await import("./release-requests.mjs");
        const rr = await refreshReleaseRequest(cwd, args.id);
        if (!rr) return `❌ Release request not found: ${args.id} (use rr_list)`;
        const cl = (rr.checklist || []).map(c =>
          `  [${c.id}] verdict=${c.verdict} · auto=${c.auto?.status || "?"}\n    detail: ${c.auto?.detail || "-"}${c.note ? `\n    note: ${c.note}` : ""}${rr.suggested?.[c.id] ? `\n    🤖 suggested: ${rr.suggested[c.id].verdict} - ${rr.suggested[c.id].reason}` : ""}`
        ).join("\n");
        const feats = (rr.scope?.features || []).map(f => `  ${f.id} ${f.name}${f.hasTests ? "" : " (NO TESTS)"}${f.apiImpact ? " [API impact]" : ""}`).join("\n");
        return [
          `${rr.id} [${rr.status}] ${rr.title}`,
          `baseline: ${rr.baseline?.short}(${rr.baseline?.source})${rr.baseline?.subject || ""}`,
          `target:  ${rr.target?.short} ${rr.target?.subject || ""}${rr.targetLocked ? " 🔒 locked（不自動前進）" : "（lineage 自動前進中）"}`,
          `scope:   ${rr.scope?.commits?.count ?? 0} commits · ${(rr.scope?.files || []).length} files · ${(rr.scope?.features || []).length} features · ${(rr.scope?.apis || []).length} APIs · ${(rr.scope?.taskIds || []).length} pending tasks`,
          `authors: ${(rr.scope?.commits?.authors || []).join(", ")}`,
          "",
          "Checklist (auto = deterministic evidence):",
          cl,
          "",
          "Changed features:",
          feats || "  (none)",
          "",
          "Recent commits:",
          (rr.scope?.commits?.subjects || []).slice(0, 10).map(s => `  ${s}`).join("\n") || "  (none)",
          "",
          "Scope pending tasks (will batch-release on close):",
          (rr.scope?.taskIds || []).map(x => `  ${typeof x === "string" ? x : `${x.id} ${x.title}`}`).join("\n") || "  (none)",
        ].join("\n");
      }
      case "rr_suggest": {
        const { suggestVerdicts } = await import("./release-requests.mjs");
        try {
          const rr = await suggestVerdicts(cwd, args.id, args.items, agentId || "rm-agent");
          if (onEvent) onEvent({ type: "tool_end", name, result: `${rr.id}: ${args.items.length} items` });
          return `✅ Suggestions recorded on ${rr.id} (${args.items.map(it => `${it.itemId}:${it.verdict}`).join(", ")}).\nThe human will confirm in the Release Manager UI - you suggested, you did NOT decide.`;
        } catch (e) {
          return `❌ rr_suggest failed: ${e.message}`;
        }
      }

      case "rr_create": {
        const { createReleaseRequest, listReleaseRequests } = await import("./release-requests.mjs");
        try {
          const existing = (await listReleaseRequests(cwd)).filter(r => r.status === "draft" || r.status === "reviewing");
          if (existing.length > 0) {
            return `⚠️ 已有進行中的 RR,不自動多開(避免重複放行範圍):
${existing.map(r => `${r.id} [${r.status}] ${r.title}`).join("\n")}

請人類決定:用這張繼續(rr_get 看證據 → rr_suggest 給建議),或先在 UI 處理掉再建新的。`;
          }
          const rr = await createReleaseRequest(cwd, {
            title: args.title,
            baseline: args.baseline || "auto",
            createdBy: `agent:${agentId || "em"}`,
          });
          if (onEvent) onEvent({ type: "tool_end", name, result: `${rr.id} draft` });
          return `✅ 已建立 RR 草稿:${rr.id} 「${rr.title}」
baseline ${rr.baseline?.short}(${rr.baseline?.source})→ target ${rr.target?.short} · ${rr.scope?.commits?.count ?? 0} commits / ${(rr.scope?.files || []).length} files

下一步:rr_get ${rr.id} 讀證據 → rr_suggest 給建議 → 人類在 Release Manager UI 確認結案(你只建議,不放行)。`;
        } catch (e) {
          return `❌ rr_create failed: ${e.message}`;
        }
      }

      // ── Action Log Tools ──
      case "handover_write": {
        // 交接沉澱寫入（2026-10-09）：僅 handover agent（group 掛載）+ 使用者同意後呼叫
        const { dirname } = await import("node:path");
        const target = join(cwd || rootDir || process.cwd(), ".paaw", "HANDOVER.md");
        const dir = dirname(target);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        if (existsSync(target)) writeSync(target + ".bak", readSync(target, "utf-8")); // 自動備份
        const content = String(args.content || "");
        writeSync(target, content, "utf-8");
        if (onEvent) onEvent({ type: "tool_end", name, result: `${content.length} bytes` });
        return `✅ Handover written: ${target} (${content.length} bytes, 舊檔已備份 .bak)`;
      }

      case "trouble_write": {
        // TS Guide 條目沉澱（2026-10-10）：add → status=human（重生成永不覆蓋）；update → 補 SOP
        const tsgPath = join(cwd || rootDir || process.cwd(), ".paaw", "troubleshooting", "TSGUIDE.json");
        let guide;
        try { guide = JSON.parse(readSync(tsgPath, "utf-8")); }
        catch { guide = { version: 1, generatedAt: null, entries: [], gaps: [] }; }
        const { dirname } = await import("node:path");
        if (!existsSync(dirname(tsgPath))) mkdirSync(dirname(tsgPath), { recursive: true }); // nosemgrep: detect-non-literal-fs-filename — local-first
        const action = String(args.action || "add");
        const symptom = String(args.symptom || "").trim().slice(0, 300);
        if (!symptom) return "❌ symptom 必填";
        const fixSteps = Array.isArray(args.fixSteps) ? args.fixSteps.map(x => String(x).slice(0, 240)).filter(Boolean).slice(0, 10) : [];
        const evidence = args.evidenceText ? [{ type: "human", ref: String(args.evidenceText).slice(0, 160) }] : [];
        if (action === "update") {
          const entry = (guide.entries || []).find(e => e.id === String(args.id || ""));
          if (!entry) return `❌ 找不到條目 id=${args.id}（action=update 需先讀 TSGUIDE.json 拿 id）`;
          if (symptom) entry.symptom = symptom;
          if (args.cause) entry.cause = String(args.cause).slice(0, 400);
          if (fixSteps.length) entry.fixSteps = fixSteps;
          if (evidence.length) entry.evidence = [...(entry.evidence || []), ...evidence];
          entry.lastEditAt = new Date().toISOString(); entry.lastEditBy = args._agentId || "agent";
        } else {
          guide.entries.push({
            id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            symptom, cause: String(args.cause || "").slice(0, 400), fixSteps,
            feature: args.feature ? String(args.feature).slice(0, 80) : null,
            evidence, status: "human",
            createdBy: args._agentId || "agent", createdAt: new Date().toISOString(),
          });
        }
        writeSync(tsgPath, JSON.stringify(guide, null, 2) + "\n", "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first
        if (onEvent) onEvent({ type: "tool_end", name, result: `${action} ${symptom.slice(0, 40)}` });
        return `✅ TS Guide ${action === "update" ? "更新" : "新增"}條目：${symptom.slice(0, 60)}（${guide.entries.length} 條）`;
      }

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
      // 2026-09-07 修正:coding crew 的 memory 跟專案走(cwd),不是 PAAW root
      // (之前 rootDir||cwd → crew chat 的 rootDir=PAAW_ROOT → memory 存到 PAAW 根,
      //   EM auto-dispatch 讀專案根 → 永遠讀不到,agentMemoryInjected 永遠 (none))
      case "agent_memory_save": {
        const { saveAgentMemory } = await import("./action-log.mjs");
        const agentId2 = args._agentId || _agentCfg?.agentId || agentId || "agent";
        const memRoot = (typeof agentId2 === "string" && agentId2.startsWith("coding.")) ? cwd : (rootDir || cwd);
        await saveAgentMemory(agentId2, args.content, memRoot);
        if (onEvent) onEvent({ type: "tool_end", name, result: `${agentId2}.md` });
        return `✅ Memory saved for ${agentId2} to ${memRoot}/.paaw/agent-memory/`;
      }

      case "agent_memory_load": {
        const { loadAgentMemory } = await import("./action-log.mjs");
        const agentId2 = args._agentId || _agentCfg?.agentId || agentId || "agent";
        const memRoot = (typeof agentId2 === "string" && agentId2.startsWith("coding.")) ? cwd : (rootDir || cwd);
        const content = await loadAgentMemory(agentId2, memRoot);
        if (onEvent) onEvent({ type: "tool_end", name, result: content ? `${content.length} chars` : "empty" });
        return content || "(No saved memory yet)";
      }

      case "conversation_history": {
        // 2026-09-06 Fleming:每個 agent 都能查過去聊天記錄(.paaw/coding-memory/conversations/)
        // RU 開發紀錄全保留 - active.json 為進行中,s-*.json 為封存 session
        // 2026-10-09 修：對話屬於 RU（agent 的專案 cwd，如 tpaaw-gateway），不是 PAAW root —
        // 之前 base=rootDir 永遠指到 tPAAW，跨 RU 查不到（coding app 開 tpaaw-gateway 時 AI 說「查無記錄」）
        const base = cwd;
        const convRoot = join(base, ".paaw", "coding-memory", "conversations");
        const myAgentId = args._agentId || _agentCfg?.agentId || "agent";
        const safe = (s) => /^[a-zA-Z0-9._-]+$/.test(s); // 防 path traversal
        const targetCrew = args.crewId && safe(args.crewId) ? args.crewId : (myAgentId.startsWith("coding.") ? myAgentId : `coding.${myAgentId}`);
        const readSess = (dir, f) => {
          try { return JSON.parse(readSync(join(dir, f), "utf-8")); } catch { return null; }
        };
        const fmtTime = (t) => (t || "").slice(0, 16).replace("T", " ");

        if (args.action === "list") {
          const dir = join(convRoot, targetCrew);
          if (!existsSync(dir)) return `(尚無 ${targetCrew} 的對話記錄)`;
          const items = [];
          const act = readSess(dir, "active.json");
          if (act?.messages?.length) items.push({ id: "active", meta: act._meta, msgs: act.messages });
          const sessFiles = existsSync(dir) ? readdirSync(dir).filter(f => f.startsWith("s-") && f.endsWith(".json")).sort().reverse() : [];
          for (const f of sessFiles) {
            const d = readSess(dir, f);
            if (d?.messages?.length) items.push({ id: f.replace(".json", ""), meta: d._meta, msgs: d.messages });
          }
          if (!items.length) return "(尚無對話記錄)";
          const lines = items.map(it => `  ${it.id.padEnd(24)} ${fmtTime(it.meta?.lastUpdated || it.meta?.archivedAt)}  ${String(it.msgs.length).padStart(3)}則  ${(it.meta?.title || "").slice(0, 40)}`);
          if (onEvent) onEvent({ type: "tool_end", name, result: `${items.length} sessions` });
          return `📁 ${targetCrew} sessions(時間序):\n${lines.join("\n")}\n\n用 conversation_history(action="load", sessionId="s-...") 讀完整內容`;
        }

        if (args.action === "load") {
          if (!args.sessionId || !safe(args.sessionId)) return "Error: load 需要 sessionId(先 list 取得;active=目前對話)";
          const dir = join(convRoot, targetCrew);
          const file = args.sessionId === "active" ? "active.json" : `${args.sessionId}.json`;
          if (!existsSync(join(dir, file))) return `找不到 session ${args.sessionId}(先 list 看有哪些)`;
          const d = readSess(dir, file);
          if (!d?.messages?.length) return "(空 session)";
          const lines = d.messages.map(m => {
            const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return `[${fmtTime(m.ts)}] ${m.role === "user" ? "👤" : "🤖"}: ${c.slice(0, 600)}`;
          });
          if (onEvent) onEvent({ type: "tool_end", name, result: `${d.messages.length} msgs` });
          return `📜 ${targetCrew}/${args.sessionId}(${d.messages.length} 則)\n${lines.join("\n")}`.slice(0, 12000);
        }

        if (args.action === "search") {
          if (!args.query) return "Error: search 需要 query";
          if (!existsSync(convRoot)) return "(尚無任何對話記錄)";
          const crews = args.crewId && safe(args.crewId) ? [args.crewId] : readdirSync(convRoot).filter(safe);
          const hits = [];
          const q = String(args.query).toLowerCase();
          for (const crew of crews) {
            const dir = join(convRoot, crew);
            if (!existsSync(dir)) continue;
            for (const f of ["active.json", ...readdirSync(dir).filter(x => x.startsWith("s-") && x.endsWith(".json")).sort().reverse()]) {
              const d = readSess(dir, f);
              if (!d?.messages?.length) continue;
              for (let i = 0; i < d.messages.length; i++) {
                const c = typeof d.messages[i].content === "string" ? d.messages[i].content : "";
                const idx = c.toLowerCase().indexOf(q);
                if (idx >= 0) {
                  hits.push(`${crew}/${f.replace(".json", "")} #${i} ${d.messages[i].role}: ...${c.slice(Math.max(0, idx - 60), idx + 120)}...`);
                  if (hits.length >= 40) break;
                }
              }
            }
          }
          if (onEvent) onEvent({ type: "tool_end", name, result: `${hits.length} hits` });
          return hits.length ? `🔍 「${args.query}」找到 ${hits.length} 筆:\n${hits.join("\n")}` : `🔍 「${args.query}」沒有找到`;
        }
        return "Error: action 必須是 list / load / search";
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
              const text = notebooks.map(nb => `📁 ${nb.name} (${nb.id}) - ${nb.noteCount} 筆記\n  分類: ${nb.sections.map(s => s.name).join(", ")}`).join("\n");
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
              const text = sections.map(s => `  ${s.id === "default" ? "📋" : "📁"} ${s.name} (${s.id}) - ${noteCounts[s.id] || 0} 筆記`).join("\n");
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
        if (!action) return "Error: 'action' parameter is required. Valid: issue_create, issue_update, issue_delete, change_record, feature_update_docs, feature_update_mapping, feature_delete, run_command";
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
            return `✅ Recorded change: ${args.title} (${args.type}) - ${args.files.length} file(s)`;
          }

          case "feature_update_docs": {
            if (!args.id || !args.documentation) return "Error: id and documentation are required.";
            try {
              const { loadFeatures: _lf, saveFeatures: _sf } = await import("./feature-registry.mjs"); // coding.db
              const features = _lf(cwd) || [];
              const feature = features.find(f => f.id === args.id);
              if (!feature) return `Error: Feature ${args.id} not found.`;
              feature.documentation = args.documentation;
              feature.docsUpdatedAt = new Date().toISOString();
              _sf(cwd, features);
              if (onEvent) onEvent({ type: "tool_end", name, result: args.id });
              return `✅ Updated docs for ${args.id}: ${feature.name}`;
            } catch (e) { return `Error: ${e.message}`; }
          }

          // ── feature_delete:移除 feature 記錄(2026-09-06 Fleming:刪 feature 走 agent tool,人不在 UI 手刪)──
          // 標準流程:SA(architect)開 task 叫 developer 刪掉相關程式碼並 stage → SA 確認後才刪 feature 記錄 → 程式與 feature map 同步
          case "feature_delete": {
            if (!args.id) return "Error: id is required(featureId,如 F20260901-001)";
            const { loadFeatures, saveFeatures } = await import("./feature-registry.mjs");
            const features = await loadFeatures(cwd);
            const idx = features.findIndex(f => f.id === args.id);
            if (idx < 0) return `Error: Feature ${args.id} not found(先 project_info(category="features") 確認 id)`;
            const deleted = features.splice(idx, 1)[0];
            await saveFeatures(cwd, features);
            const fileCount = (deleted.codeFiles || []).length;
            if (onEvent) onEvent({ type: "tool_end", name, result: `feature ${args.id} deleted` });
            return `已刪除 feature ${args.id}「${deleted.name || ""}」(原映射 ${fileCount} 個檔案)。\n⚠️ 請確認:相關程式碼是否已由 developer 移除(task 已 stage/commit)?若還沒,請先開 task 處理,程式與 feature map 才會同步。`;
          }

          case "feature_update_mapping": {
            if (!args.id) return "Error: id is required.";
            try {
              const { loadFeatures: _lf, saveFeatures: _sf } = await import("./feature-registry.mjs"); // coding.db
              const features = _lf(cwd) || [];
              const feature = features.find(f => f.id === args.id);
              if (!feature) return `Error: Feature ${args.id} not found.`;
              if (args.codeFiles) feature.codeFiles = args.codeFiles;
              if (args.apis) feature.apis = args.apis;
              if (args.tests) feature.tests = args.tests;
              if (args.runbooks) feature.runbooks = args.runbooks;
              _sf(cwd, features);
              if (onEvent) onEvent({ type: "tool_end", name, result: args.id });
              return `✅ Updated mapping for ${args.id}: ${feature.name}`;
            } catch (e) { return `Error: ${e.message}`; }
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

      // ── Task Management Tools ──
      case "task_list": {
        const tasksFile = join(cwd, ".paaw", "tasks", "TASKS.json");
        if (!existsSync(tasksFile)) {
          if (onEvent) onEvent({ type: "tool_end", name, result: "no tasks file" });
          return "(No tasks initialized. Use task_create to create the first task.)";
        }
        try {
          const data = JSON.parse(readSync(tasksFile, "utf-8"));
          let tasks = data.tasks || [];
          // Normalize old statuses for display
          const norm = s => { const st = String(s||"").trim().toLowerCase().replace(/[\s-]+/g,"_"); if (st==="open"||st==="todo") return "open"; if (["in_progress","review","testing","pending","awaiting_human"].includes(st)) return "pending"; if (["done","completed","resolved","closed","close"].includes(st)) return "close"; if (["skipped","wontfix","ignore"].includes(st)) return "ignore"; return "open"; };
          const normType = t => { const ty = String(t||"").toLowerCase(); if (ty==="test"||ty==="testing") return "test"; if (ty==="docs"||ty==="doc"||ty==="documentation") return "docs"; return "dev"; };
          // Single task by ID
          if (args.id) {
            const task = tasks.find(t => t.id === args.id);
            if (!task) return `Task ${args.id} not found.`;
            return JSON.stringify(task, null, 2);
          }
          // Filters
          if (args.status) tasks = tasks.filter(t => norm(t.status) === args.status);
          if (args.type) tasks = tasks.filter(t => normType(t.type) === args.type);
          if (args.featureId) tasks = tasks.filter(t => t.featureId === args.featureId);
          if (args.priority) tasks = tasks.filter(t => t.priority === args.priority);
          if (tasks.length === 0) {
            if (onEvent) onEvent({ type: "tool_end", name, result: "0 tasks" });
            return "(No matching tasks found)";
          }
          const lines = tasks.map(t => {
            const s = norm(t.status);
            const icon = s === "open" ? "🟡" : s === "pending" ? "🔵" : s === "close" ? "✅" : "⏭️";
            const ty = normType(t.type);
            const fid = t.featureId || "(no feature)";
            return `[${t.id}] ${icon} ${s} | ${ty} | ${t.priority} | ${fid}\n  ${t.title}`;
          }).join("\n\n");
          if (onEvent) onEvent({ type: "tool_end", name, result: `${tasks.length} tasks` });
          return `Tasks (${tasks.length}):
${lines}`;
        } catch (e) {
          return `Error reading tasks: ${e.message}`;
        }
      }

      case "task_create": {
        // Feature-first:featureId 必填,status 只有 open/close/pending/ignore,type 只有 dev/test/docs
        if (!args.featureId) {
          return "Error: featureId is required. Every task must belong to a feature (misc work → 'Utility & Platform Misc' feature).";
        }
        const normType = t => { const ty = String(t||"").toLowerCase(); if (ty==="test"||ty==="testing") return "test"; if (ty==="docs"||ty==="doc"||ty==="documentation") return "docs"; return "dev"; };
        const tasksFile = join(cwd, ".paaw", "tasks", "TASKS.json");
        const tasksDir = join(cwd, ".paaw", "tasks");
        if (!existsSync(tasksDir)) await mkdir(tasksDir, { recursive: true });
        let data = { tasks: [], updatedAt: new Date().toISOString() };
        if (existsSync(tasksFile)) {
          try { data = JSON.parse(readSync(tasksFile, "utf-8")); } catch {}
        }
        const now = new Date().toISOString();
        const nums = data.tasks.map(t => parseInt((t.id || "").replace(/^TASK-/, "")) || 0);
        const nextNum = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
        const id = `TASK-${String(nextNum).padStart(3, "0")}`;
        const task = {
          id,
          featureId: args.featureId,
          title: args.title || "(untitled)",
          type: normType(args.type),
          status: "open",
          priority: args.priority || "medium",
          parentId: args.parentId || null,
          description: args.description || "",
          labels: args.labels || [],
          assignee: null,
          createdAt: now,
          updatedAt: now,
          createdBy: "agent",
          source: { type: args.source || "manual" },
          notes: [],
          result: null,
          git: null,
          timeoutSeconds: 0,
          resolvedAt: null,
        };
        data.tasks.push(task);
        data.updatedAt = now;
        await writeFile(tasksFile, JSON.stringify(data, null, 2), "utf-8");
        // touch feature updatedAt
        try { const { touchFeature } = await import("./feature-registry.mjs"); touchFeature(cwd, args.featureId, now); } catch {}
        if (onEvent) onEvent({ type: "tool_end", name, result: id });
        return `✅ Task created: ${id} "${task.title}"
Feature: ${task.featureId} | Type: ${task.type} | Priority: ${task.priority} | Status: open`;
      }

      case "task_update": {
        // Feature-first:no pipeline, 4 statuses, 3 types
        const TASK_STATUSES = ["open", "close", "pending", "ignore"];
        const normStatus = s => { const st = String(s||"").trim().toLowerCase().replace(/[\s-]+/g,"_"); if (st==="open"||st==="todo") return "open"; if (["in_progress","review","testing","pending","awaiting_human"].includes(st)) return "pending"; if (["done","completed","resolved","closed","close"].includes(st)) return "close"; if (["skipped","wontfix","ignore"].includes(st)) return "ignore"; return "open"; };
        const normType = t => { const ty = String(t||"").toLowerCase(); if (ty==="test"||ty==="testing") return "test"; if (ty==="docs"||ty==="doc"||ty==="documentation") return "docs"; return "dev"; };
        const tasksFile = join(cwd, ".paaw", "tasks", "TASKS.json");
        if (!existsSync(tasksFile)) return "Error: No tasks file. Create tasks first.";
        const data = JSON.parse(readSync(tasksFile, "utf-8"));
        const task = data.tasks.find(t => t.id === args.id);
        if (!task) return `Error: Task ${args.id} not found.`;
        const now = new Date().toISOString();
        const action = args.action;

        if (action === "update") {
          if (args.title) task.title = args.title;
          if (args.status) {
            if (!TASK_STATUSES.includes(args.status)) return `Error: Invalid status '${args.status}'. Must be one of: ${TASK_STATUSES.join(", ")}`;
            task.status = args.status;
            if (args.status === "close" && !task.resolvedAt) task.resolvedAt = now;
            if (args.status === "open" || args.status === "pending") task.resolvedAt = null;
          }
          if (args.type) task.type = normType(args.type);
          if (args.featureId) task.featureId = args.featureId;
          if (args.priority) task.priority = args.priority;
          if (args.result) task.result = args.result;
          task.updatedAt = now;
          // touch feature on close
          if (task.status === "close" && task.featureId) {
            try { const { touchFeature } = await import("./feature-registry.mjs"); touchFeature(cwd, task.featureId, now); } catch {}
          }
        } else if (action === "note") {
          if (!task.notes) task.notes = [];
          task.notes.push({ by: "agent", at: now, content: args.note || "" });
          task.updatedAt = now;
        } else if (action === "assign") {
          task.assignee = args.assignTo;
          task.status = "pending"; // 派工 = pending(等人/agent處理)
          if (!task.notes) task.notes = [];
          task.notes.push({ by: "agent", at: now, content: `Assigned to ${args.assignTo}` });
          task.updatedAt = now;
        } else {
          return `Error: Unknown action '${action}'. Valid: update, note, assign.`;
        }

        await writeFile(tasksFile, JSON.stringify(data, null, 2), "utf-8");
        if (onEvent) onEvent({ type: "tool_end", name, result: `${args.id} ${action}` });
        return `✅ Task ${args.id} updated (${action}). Status: ${task.status}${task.featureId ? ` | Feature: ${task.featureId}` : ""}`;
      }

      case "task_decompose": {
        const { getHandlers } = await import("../tools/index.mjs");
        const handlers = await getHandlers();
        if (handlers.task_decompose) {
          const result = await handlers.task_decompose(args);
          const resultText = typeof result === "string" ? result : result.text || JSON.stringify(result);
          if (onEvent) onEvent({ type: "tool_end", name, result: resultText });
          return resultText;
        }
        return "Error: task_decompose handler not available";
      }

      case "dispatch_agent": {
        const { getHandlers: getH2 } = await import("../tools/index.mjs");
        const handlers2 = await getH2();
        if (handlers2.dispatch_agent) {
          if (onEvent) onEvent({ type: "tool_start", name, args: JSON.stringify(args) });
          const result = await handlers2.dispatch_agent(args);
          const resultText = typeof result === "string" ? result : result.text || JSON.stringify(result);
          if (onEvent) onEvent({ type: "tool_end", name, result: resultText });
          return resultText;
        }
        return "Error: dispatch_agent handler not available";
      }

      case "network_allow": {
        const { getHandlers: getHNet } = await import("../tools/index.mjs");
        const hNet = await getHNet();
        if (hNet.network_allow) {
          if (onEvent) onEvent({ type: "tool_start", name, args: JSON.stringify(args) });
          const res = await hNet.network_allow(args);
          const txt = typeof res === "string" ? res : res.text || JSON.stringify(res);
          if (onEvent) onEvent({ type: "tool_end", name, result: txt });
          return txt;
        }
        return "Error: network_allow handler not available";
      }

      case "auto_dispatch": {
        // task-driven 自動派工(preview/start/stop)- handler 在 tools/index.mjs,一律走 API
        const { getHandlers: getH3 } = await import("../tools/index.mjs");
        const handlers3 = await getH3();
        if (handlers3.auto_dispatch) {
          if (onEvent) onEvent({ type: "tool_start", name, args: JSON.stringify(args) });
          const result = await handlers3.auto_dispatch({ ...args, cwd: args.cwd || cwd });
          const resultText = typeof result === "string" ? result : result.text || JSON.stringify(result);
          if (onEvent) onEvent({ type: "tool_end", name, result: resultText });
          return resultText;
        }
        return "Error: auto_dispatch handler not available";
      }

      default:
        const unknownMsg = `Error: unknown tool '${name}'. Available tools: read_file, write_file, edit_file, glob, grep, diff, git, bash, ask_user, project_info, project_edit, staged_summary, record_decision, docs, action_log_add, action_log_list, task_list, task_create, task_update, task_decompose, task_retrofit, dispatch_agent, auto_dispatch.`;
        if (onEvent) onEvent({ type: "tool_end", name, result: unknownMsg });
        return unknownMsg;
    }
  } catch (err) {
    const errMsg = `Error in ${name}: ${err.message}`;
    if (onEvent) onEvent({ type: "tool_end", name, result: errMsg });
    return errMsg;
  }
}

// ── Context Window Management ──
// Trims conversation history to fit within model's context window.
// Strategy: keep system message + first user message + last N messages.
// Middle messages are summarized into a compact note.

export const DEFAULT_CONTEXT_WINDOW = 262000; // 262k tokens default for company models
const CONTEXT_SAFETY_MARGIN = 8000;   // reserve for system prompt + response
const LLM_CALL_TIMEOUT_MS = 300_000;  // 5 min per LLM call (company models are slower, need more than 2 min)

// ── OpenClaw-aligned context management ──
// Like OpenClaw: reserve 50% for prompt budget, cap tool results at 30% of context
const MIN_PROMPT_BUDGET_RATIO = 0.5;
const TOOL_RESULT_CONTEXT_SHARE = 0.3;

// estimateTokens is now imported from context-truncation.mjs (shared)
// (previously a local function - removed to avoid duplication)

/**
 * Trim messages to fit context window.
 * Strategy (aligned with OpenClaw):
 *   1. Always keep system prompt (messages[0]) + first user message
 *   2. Keep as many recent messages as fit (sliding window from tail)
 *   3. Summarize evicted middle messages into a compact summary
 *   4. Cap any single tool result at 30% of context window
 */
/**
 * Enhanced trimMessagesToFit - now uses shared context-truncation.mjs
 *
 * Pipeline: smart tool result truncation (head+tail) → history limiting → token budget check
 * Auto-compaction (LLM summarization) is handled separately in the agent loop.
 */

export { TOOL_GROUP_MAP, CORE_READ_TOOLS, AGENT_FALLBACK_GROUPS, _crewDenyCache, CONTEXT_SAFETY_MARGIN, LLM_CALL_TIMEOUT_MS, executeTool, toolExecTimeoutMs, raceAbortTool, setAgentConfig, _agentCfg, _agentCfgDefaults, APPROVAL_WAIT_BUDGET_MS, runShell, _nativeGlob, _nativeGrep, _buildTestCommand, _parseTestResult, _findConventionTests, LOG };
