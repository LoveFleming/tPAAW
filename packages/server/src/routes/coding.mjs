/**
 * Project Route — .paaw/ project knowledge API
 *
 * Endpoints:
 *   GET    /api/coding-project/context?path=...        — Get full .paaw/ context
 *   POST   /api/coding-project/init?path=...           — Initialize .paaw/ directory
 *   POST   /api/coding-project/create                   — Create new project directory + .paaw/ init + git init
 *   GET    /api/coding-project/tree?path=...           — Get .paaw/ directory tree
 *   GET    /api/coding-project/sessions?path=...       — List sessions
 *   GET    /api/coding-project/sessions/:filename?path=... — Read specific session
 *   GET    /api/coding-project/decisions?path=...      — Read decisions
 *   POST   /api/coding-project/decisions?path=...      — Add decision
 *   GET    /api/coding-project/changelog?path=...      — Read changelog
 *   GET    /api/coding-project/file?path=...&file=...  — Read any .paaw/ file
 *   PUT    /api/coding-project/file?path=...&file=...  — Write any .paaw/ file
 *   POST   /api/coding-project/generate-overview?path=... — Auto-generate PROJECT.md
 *   GET    /api/coding-project/security-scan?path=...   — Run Semgrep security scan
 *   GET    /api/coding-project/security-scan/results?path=... — Load last scan results
 *
 * Crew Conversation Persistence:
 *   GET    /api/coding-crew/conversations?cwd=...              — List all crew conversations
 *   GET    /api/coding-crew/conversations/:crewId?cwd=...     — Load crew conversation
 *   POST   /api/coding-crew/conversations/:crewId?cwd=...     — Save crew conversation
 *   DELETE /api/coding-crew/conversations/:crewId?cwd=...     — Clear crew conversation
 *   POST   /api/coding-crew/context-window                    — Build optimized context window
 *
 * Crew Conversation Archiving:
 *   POST   /api/coding-crew/conversations/:crewId/archive?cwd=... — Archive current + start new
 *   GET    /api/coding-crew/conversations/:crewId/archives?cwd=... — List archived conversations
 *   GET    /api/coding-crew/conversations/:crewId/archives/:id?cwd=... — Load archived conversation
 */

import { readFile, writeFile, readdir, mkdir, unlink, appendFile, stat as fsStat } from "fs/promises";
import { todayStamp } from "../lib/feature-registry.mjs"; // API-first（2026-11-01）：todayStamp 給 api-map A-id 用
import { writeDoc, readDoc } from "../lib/coding-db/docs.repo.mjs"; // 2026-11-01：feature docs 進 coding.db
import { existsSync, readFileSync as readSync, readdirSync, statSync, openSync, readSync as fsReadSync, closeSync as fsCloseSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { exec as execCb } from "child_process";
import { shellExec, IS_WIN } from "../lib/shell-exec.mjs";
import { createPaawProject, maybeWriteProjectDraft } from "../lib/paaw-project.mjs";
import { parseProjectMd, buildProjectMd, regenerateProjectMd, USER_START, USER_END, AI_START, AI_END } from "../lib/project-md.mjs";
import { callLLMWithRetry, dateTimeContextBlock, parseModelReference } from "../lib/llm-utils.mjs";
import { normalizePath, readBody, PORT } from "./shared.mjs"; // 2026-11-04：PORT 供 localhost API 自呼（paawPort 未定義修復）
import { sanitizeId, sendPathTraversalError } from "../lib/coding-security.mjs";
import { logAuditEvent } from "../lib/audit-log.mjs"; // 審批決策審計（2026-10-10）
import * as codingDb from "../lib/coding-db/index.mjs"; // dual-write Phase A（2026-10-31）
import { parseProject, formatForAI, formatCondensed } from "../lib/tree-sitter-parser.mjs";
import { runSemgrep } from "../lib/semgrep-runner.mjs";
import { buildCodeIntelligence, buildContextPackage } from "../lib/code-intelligence.mjs";
import { buildTestIntelligence } from "../lib/test-intelligence.mjs";
import { saveQaResult, listQaResults, getQaResult, updateQaResult, deleteQaResult, qaStats } from "../lib/qa-results.mjs"; // QA 記錄共享存儲（2026-09-17 Fleming）
import { buildChangeIntelligence } from "../lib/change-intelligence.mjs";
import { rescanMechanicalLayer } from "../lib/cu-mechanical.mjs";

// ── PAAW root directory (cross-platform safe) ──
// fileURLToPath handles Windows drive-letter URLs correctly,
// unlike new URL(import.meta.url).pathname which adds a leading /
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");
// 2026-11-02 Fleming：CU prompt 屬於程式的一部分 → 隨 packages 走（packages/server/src/prompts/）。
// data/prompts/code-understanding/ 保留為向後相容的覆蓋點（舊安裝自訂過的還能用）。
// 載入優先序：.paaw/prompts（RU 覆蓋） > ai-settings/coding > data/prompts（舊） > packages 內建
const BUNDLED_PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "code-understanding");

// ── CU lifecycle raw materials — 輕量掃 source file 數（純 node fs，跨平台，不碰 node_modules）──
// 用途：判斷「代碼尚少（no-code）」— 剛建立/剛 import 的專案 code 還沒成形，
// Code Understanding 沒東西可分析，UI 不該催
// ⚠️ 定義已抽到 lib/cu-source-scan.mjs（單一事實來源 — paaw-project 的 CU watermark 同一套規則）
import { countSourceFiles, walkSourceFiles, changedSourceFilesSince } from "../lib/cu-source-scan.mjs";

// ── CU staleness — 智能層知識過期偵測（純 mtime 比對，免 token）──
// step 產出檔比 code 最新 mtime 舊 → 過期（快照是舊地圖）
// 與 UI CU_STEPS 的 file 對應（保持同步）— Slim CU：只保留 4 個 steps + 人寫檔案
const CU_STEP_FILES = {
  scan: "scan.json",
  "feature-map": "features/FEATURES.json", // 2026-11-05 復活：feature map 產出（staleness 增量判斷用）
  "api-map": "api-map.json",
  "ui-map": "ui-map.json",
  "code-intelligence": "code-intelligence/summary.json",
  "test-intelligence": "code-intelligence/test-intelligence.json",
  "error-codes": "error-codes.json",
  "c4-model": "c4-model.json",
  // 人寫的非自動 step（給健康檢查參考）
  overview: "project/PROJECT.md", // ⚠️ FILE_MAP 映射：PaawProject 讀寫 PROJECT.md 實際落在 project/ 子目錄（含自動遷移）— staleness 要看實體路徑
};
const CU_MECHANICAL_STEPS = new Set(["code-intelligence", "test-intelligence"]);
const CU_MANUAL_STEPS = new Set(["standards"]); // 2026-10-09：overview 改 AI 生成（每次 CU 重寫 AI 區、USER 區保護），不再是人寫文件
const STALE_TOLERANCE_MS = 2000; // 同步競態容差
// 2026-10-30：內容導向 staleness（git diff 程式碼過濾）— 純 mtime 會被 git pull/checkout
// 刷新全檔 mtime誤報（內容零變化也報「結構已變更」）。git repo 改看
// watermark commit..HEAD 實際變更檔，只認 walker 同一套 source 規則（cu-source-scan 單一事實來源）；
// 純 doc/圖/locale 變更不觸發。非 git / 無 watermark commit / git 失敗 → 逐步驟 fallback mtime。
const _mechanicalRescanBusy = new Set(); // cu-status 觸發的背景機械層重掃（同 root 防重入）
// 2026-11-08 Fleming：智慧層（LLM 步驟）也自動化 — 偵測 stale 就背景自呼 ai-initial 增量重跑，不再用 UI 訊息叫人按鈕
const _smartRerunBusy = new Set();
const _smartRerunLast = new Map(); // root → last trigger ms（失敗 cooldown 10 分鐘防重試風暴）

export async function computeCuStaleness(root, steps, codeLastModifiedMs) {
  // 逐步驟 git watermark（codeCommit）：所有 done step 取最大共用一次 git diff 快取
  const gitSteps = Object.entries(CU_STEP_FILES).filter(([id]) => steps[id]?.status === "done" && steps[id]?.codeCommit)
    .map(([id]) => steps[id]); // 取 step 物件（entries 第二元素是産出路徑，不是 step）
  let changedFilesByCommit = new Map(); // commit → changed source 檔清單（null = fallback）
  if (gitSteps.length > 0) {
    for (const s of gitSteps) {
      const commit = s.codeCommit;
      if (!changedFilesByCommit.has(commit)) {
        changedFilesByCommit.set(commit, await changedSourceFilesSince(root, commit));
      }
    }
  }
  const staleSteps = [];
  for (const [id, rel] of Object.entries(CU_STEP_FILES)) {
    if (steps[id]?.status !== "done") continue; // 沒跑過的叫 pending 不叫過期
    const flag = () => staleSteps.push({ id, mechanical: CU_MECHANICAL_STEPS.has(id), manual: CU_MANUAL_STEPS.has(id) });
    // ── 內容導向：有 codeCommit watermark + git 可用 → 只認實際程式碼變更 ──
    const commit = steps[id]?.codeCommit;
    if (commit && changedFilesByCommit.has(commit)) {
      const changed = changedFilesByCommit.get(commit);
      if (changed !== null) {
        // 產出檔被刪 → 永遠過期（空產出要重建，增量重掃會 skip 它）
        if (!existsSync(join(root, ".paaw", rel)) || changed.length > 0) flag();
        continue;
      }
      // changed === null → git 失敗/commit 消失，落入 mtime fallback
    }
    // ── fallback：mtime（非 git 專案 / 舊 cu-status 無 codeCommit 欄位）──
    try {
      const st = statSync(join(root, ".paaw", rel));
      // ⚠️ content-addressed 寫入（diffWriteJson）：內容沒變 → skip → 檔案 mtime 不動。
      // 純 mtime 比對會把「重掃確認無變更」誤判成永遠 stale（2026-08-30 Fleming 回報）
      // → watermark：step 完成時記下當時 source 最新 mtime（codeMtime）存進 cu-status，
      //   重掃無變更也會刷新 watermark = 「這版 code 我確認過」→ badge 正確消失
      const watermark = Number(steps[id]?.codeMtime) || 0;
      const basis = Math.max(st.mtimeMs, watermark);
      if (codeLastModifiedMs > basis + STALE_TOLERANCE_MS) {
        staleSteps.push({ id, mechanical: CU_MECHANICAL_STEPS.has(id), manual: CU_MANUAL_STEPS.has(id) });
      }
    } catch {
      // 2026-09-06 review：產出檔不存在（.paaw 被部分清理/手動刪）但 status=done → 也算過期
      // 否則增量重掃會 skip 它，空產出永遠不重建
      staleSteps.push({ id, mechanical: CU_MECHANICAL_STEPS.has(id), manual: CU_MANUAL_STEPS.has(id) });
    }
  }
  return staleSteps;
}

import { crewRoutes } from "./coding-crew-routes.mjs"; // 2026-11-07 抽出
// Debug logger for Code Understanding — writes to log/cu-debug.log
// （不可寫產品根目錄 .paaw — 執行程式不能在安裝目錄長 .paaw）
import { appendFileSync, existsSync as existsSyncSync, mkdirSync } from "fs";
import { cuLog, diffWriteFile, _stripCodeFence, _sanitizeMd, cuStepSkillKey, loadCuStepSkills, parseQuery, _extractJsonArray, backfillApiTests, _buildManifestContext, callProjectLLM, CU_LLM_OPTS } from "./coding-helpers.mjs"; // 2026-11-07 抽出（+callProjectLLM/CU_LLM_OPTS 補回）
import { DATA_HOME, LOG_HOME, logSlug } from "../data-home.mjs"; // 2026-11-07 補回：Phase 2 拆分時誤抽走（ai-initial runtime 炸 DATA_HOME is not defined）
import { runShellCmd, scanProjectFiles, collectProjectHealth } from "./coding-health.mjs"; // 2026-11-07 抽出

export default async function projectRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = parseQuery(rawUrl);
  const isWin = process.platform === "win32";

  // All routes start with /api/coding-project
  if (!url.startsWith("/api/coding-project") && !url.startsWith("/api/coding-crew")) return false;

  const projectPath = q.path;

  // ── GET /api/coding-project/api-features — API-first feature map（api_features 表）──
  if (url === "/api/coding-project/api-features" && method === "GET") {
    try {
      const { readApiFeatures } = await import("../lib/coding-db/reads.mjs");
      const apis = readApiFeatures(projectPath ? resolve(projectPath) : PAAW_ROOT);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ apis, count: apis.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── GET /api/coding-project/ui-features — 前端 route-first feature map（ui_features 表）──
  if (url === "/api/coding-project/ui-features" && method === "GET") {
    try {
      const { readUiFeatures } = await import("../lib/coding-db/reads.mjs");
      const uis = readUiFeatures(projectPath ? resolve(projectPath) : PAAW_ROOT);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ uis, count: uis.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── /api/coding-crew/* 子分派（2026-11-07 抽出到 coding-crew-routes.mjs）──
  if (await crewRoutes({ req, res, method, url, q, projectPath })) return true;

  // ── POST /api/coding-project/create — does NOT need ?path= (project doesn't exist yet) ──
  if (url.startsWith("/api/coding-project/create") && method === "POST") {
    const norm = normalizePath;
    const body = JSON.parse(await readBody(req) || "{}");
    const parentDir = body.parentDir;
    const projectName = (body.name || "").trim();
    const initGit = body.initGit !== false; // default true
    const initPaaw = body.initPaaw !== false; // default true

    if (!parentDir || !projectName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing parentDir or name" }));
      return true;
    }

    // Validate project name (no path traversal)
    if (projectName.includes("/") || projectName.includes("\\") || projectName.includes("..")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid project name" }));
      return true;
    }

    const projectDir = join(resolve(parentDir), projectName);

    // Check if already exists
    if (existsSync(projectDir)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Directory already exists", path: norm(projectDir) }));
      return true;
    }

    // Create directory
    await mkdir(projectDir, { recursive: true });

    // Initialize .paaw/
    if (initPaaw) {
      const newPaaw = createPaawProject(projectDir);
      await newPaaw.init();
    }

    // Initialize git
    if (initGit) {
      try {
        await runShellCmd("git init", projectDir);
      } catch (e) {
        console.error("[project create] git init failed:", e.message);
      }
    }

    // ru_info：一 RU 一行基本資訊（description = 需求草稿）
    try { const { upsertRuInfo } = await import("../lib/coding-db/ru-info.repo.mjs"); upsertRuInfo(projectDir, { name: projectName, description: body.description || null }); } catch {}

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: norm(projectDir), name: projectName }));
    return true;
  }

    // ── POST /api/coding-project/exec-approval（2026-10-09 審批卡決策）──
    if (url.startsWith("/api/coding-project/exec-approval") && method === "POST") {
      const body = await readBody(req);
      const { id, action, path: bodyPath, hash } = JSON.parse(body || "{}");
      const { decideApproval, listPending, listAlways, revokeAlways, listApprovalHistory } = await import("../lib/exec-approvals.mjs");
      const qPath = new URL(rawUrl, "http://localhost").searchParams.get("path");
      const aprPath = bodyPath || qPath || null;
      if (action === "list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ pending: listPending() }));
        return true;
      }
      // ── D. 永久准許清單 / 撤銷（2026-10-11 Fleming）──
      if (action === "list-always") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, path: aprPath, items: aprPath ? listAlways(aprPath) : [] }));
        return true;
      }
      if (action === "revoke") {
        if (!aprPath) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "缺少 path" })); return true; }
        const rv = revokeAlways(aprPath, String(hash || ""));
        if (rv.ok) logAuditEvent({ kind: "approval_decision", severity: "info", tool: "bash", command: rv.command, reason: "使用者撤銷永久准許", detail: { hash: rv.hash, action: "revoke" }, cwd: aprPath });
        res.writeHead(rv.ok ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rv));
        return true;
      }
      // ── E. 審批紀錄（ reload 後仍可看到當時准了什麼）──
      if (action === "history") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, path: aprPath, items: aprPath ? listApprovalHistory(aprPath, 50) : [] }));
        return true;
      }
      const r = decideApproval(String(id || ""), String(action || ""));
      // 🔴 審計（2026-10-10）：使用者的審批決策也進 audit log（誰准了什麼指令）
      if (r.ok) {
        logAuditEvent({ kind: "approval_decision", severity: "info", tool: "bash", command: r.command, reason: `使用者決策：${action}`, detail: { approvalId: id, action }, cwd: r.cwd });
      }
      res.writeHead(r.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r));
      return true;
    }


  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  // Normalize path separators (Windows backslash → forward slash)
  const norm = normalizePath;
  const root = resolve(projectPath);
  const paaw = createPaawProject(root);

  try {
    // ── GET /api/coding-project/context ──
    if (url.startsWith("/api/coding-project/context") && method === "GET") {
      const ctx = await paaw.loadContext();
      if (!ctx) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized", initialized: false }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ initialized: true, ...ctx }));
      return true;
    }

    // ── POST /api/coding-project/init ──
    if (url.startsWith("/api/coding-project/init") && !url.startsWith("/api/coding-project/initial") && method === "POST") {
      const result = await paaw.init();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/coding-project/dev-config?path=... — Read dev-config.json ──
    if (url.startsWith("/api/coding-project/dev-config") && method === "GET") {
      const devConfigPath = join(root, ".paaw", "dev-config.json");
      if (existsSync(devConfigPath)) {
        try {
          const config = JSON.parse(readSync(devConfigPath, "utf-8"));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(config));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
      }
      return true;
    }

    // ── GET /api/coding-project/tree ──
    if (url.startsWith("/api/coding-project/tree") && method === "GET") {
      const tree = await paaw.listTree();
      if (!tree) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized" }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
      return true;
    }

    // ── GET /api/coding-project/sessions/:filename ──
    const sessionMatch = url.match(/^\/api\/project\/sessions\/([^?]+)/);
    if (sessionMatch && method === "GET") {
      const content = await paaw.readSession(decodeURIComponent(sessionMatch[1]));
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── GET /api/coding-project/sessions ──
    if (url.startsWith("/api/coding-project/sessions") && method === "GET") {
      const sessions = await paaw.listSessions();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
      return true;
    }

    // ── GET /api/coding-project/decisions ──
    if (url.startsWith("/api/coding-project/decisions") && method === "GET") {
      // 2026-08-30: 讀取前先觸發 flat 遺產搬移（舊版寫 .paaw/DECISIONS.md → decisions/DECISIONS.md）
      await paaw._migrateFlatLegacy("DECISIONS.md").catch(() => {});
      const content = await paaw.readFile("DECISIONS.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── POST /api/coding-project/decisions ──
    if (url.startsWith("/api/coding-project/decisions") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const result = await paaw.addDecision(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/coding-project/changelog ──
    if (url.startsWith("/api/coding-project/changelog") && method === "GET") {
      await paaw._migrateFlatChangelog().catch(() => {});
      const content = await paaw.readFile("CHANGELOG.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── GET /api/coding-project/file ──
    if (url.startsWith("/api/coding-project/file") && method === "GET" && q.file) {
      const content = await paaw.readFile(q.file);
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── PUT /api/coding-project/file ──
    if (url.startsWith("/api/coding-project/file") && method === "PUT" && q.file) {
      const body = await readBody(req);
      const result = await paaw.writeFile(q.file, body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/coding-project/security-scan/results ──
    // Load last scan results (without re-running) — MUST check before the scan endpoint
    if (url.startsWith("/api/coding-project/security-scan/results") && method === "GET") {
      const resultsFile = join(root, ".paaw", "security", "scan-results.json");
      if (!existsSync(resultsFile)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No scan results found. Run a scan first." }));
        return true;
      }
      try {
        const data = await readFile(resultsFile, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to read scan results" }));
      }
      return true;
    }

    // ── GET /api/coding-project/security-scan ──
    // Run Semgrep scan directly — just run it, show install instructions if it fails
    if (url.startsWith("/api/coding-project/security-scan") && !url.includes("/results") && method === "GET") {
      try {
        const scanResult = await runSemgrep(root, { timeoutMs: 1_800_000 });
        // Save to .paaw/security/（帮 scannedAt — 2026-09-06 前没記，agent 端看到 scanned unknown 無法判時效性）
        const secDir = join(root, ".paaw", "security");
        if (!existsSync(secDir)) await mkdir(secDir, { recursive: true });
        await writeFile(join(secDir, "scan-results.json"), JSON.stringify({ ...scanResult, scannedAt: new Date().toISOString() }, null, 2), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(scanResult));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/test-intelligence ──
    if (url.startsWith("/api/coding-project/test-intelligence") && method === "GET") {
      try {
        const { summary, data } = await buildTestIntelligence(root, PAAW_ROOT, { persist: false }); // 2026-09-06：GET 讀取純算不落檔 — 否則 CU 還沒跑就有 test-intelligence.json、檔案推斷誤判 step done
        // detail=1 → 帶明細（Tests 頁用：testToCode 對照 + coverageGaps）
        const wantsDetail = new URL(rawUrl, "http://localhost").searchParams.get("detail") === "1";
        res.writeHead(200, { "Content-Type": "application/json" });
        const summaryWithReports = { ...summary, testReports: data.testReports || null }; // 2026-10-10：真實 report 段 — UI 誠實顯示（找不到 = 無）
        res.end(JSON.stringify(wantsDetail
          ? { summary: summaryWithReports, testToCode: data.testToCode || [], coverageGaps: (data.coverageGaps || []).slice(0, 100), featureToTests: data.featureToTests || [] }
          : summaryWithReports));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/change-intelligence ──
    if (url.startsWith("/api/coding-project/change-intelligence") && method === "GET") {
      try {
        const { summary } = await buildChangeIntelligence(root, { days: 30, maxCommits: 50 }, { persist: false }); // 2026-09-06：GET 純算不落檔
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/code-intelligence ──
    // Build and return full code intelligence (call graph, dependency graph, etc.)
    if (url.startsWith("/api/coding-project/code-intelligence") && method === "GET") {
      try {
        const { summary } = await buildCodeIntelligence(root, PAAW_ROOT, { persist: false }); // 2026-09-06：GET 純算不落檔（防 CU 檔案推斷誤判）
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/code-intelligence/context-package ──
    // Build a Code Context Package for a specific query (file, function, route, feature)
    if (url.startsWith("/api/coding-project/code-intelligence/context-package") && method === "GET") {
      try {
        const queryParams = new URLSearchParams(url.split("?")[1] || "");
        const query = {};
        if (queryParams.get("file")) query.filePath = queryParams.get("file");
        if (queryParams.get("function")) query.functionName = queryParams.get("function");
        if (queryParams.get("route")) query.routePath = queryParams.get("route");
        if (queryParams.get("feature")) query.featureName = queryParams.get("feature");
        const contextPkg = await buildContextPackage(root, PAAW_ROOT, query);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(contextPkg));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/code-intelligence/:type ──
    // Load a specific intelligence file (call-graph, dependency-graph, etc.)
    const ciMatch = url.match(/^\/api\/coding-project\/code-intelligence\/([a-z-]+)\??/);
    if (ciMatch && method === "GET") {
      const ciType = ciMatch[1];
      const validTypes = ["call-graph", "api-function-map", "dependency-graph", "test-code-map", "symbol-index", "file-map", "summary"];
      if (validTypes.includes(ciType)) {
        const ciFile = join(root, ".paaw", "code-intelligence", `${ciType}.json`);
        if (!existsSync(ciFile)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `${ciType}.json not found. Run code intelligence first.` }));
          return true;
        }
        try {
          const data = await readFile(ciFile, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(data);
        } catch {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Failed to read ${ciType}.json` }));
        }
        return true;
      }
    }

    // ── PROJECT.md（schema v2 — User Remarks + AI Overview）2026-10-09 ──
    // GET：讀兩區內容；POST：只寫 User Remarks 區（AI 區保留）；POST /regenerate：重寫 AI 區
    if (url.startsWith("/api/coding-project/project-md") && method === "GET") {
      if (!paaw.exists) await paaw.init();
      const md = await paaw.readFile("PROJECT.md");
      const respond = (obj) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (md == null) {
        respond({ exists: false, userSection: "", aiSection: "" });
      } else {
        const parsed = parseProjectMd(md);
        respond({ exists: true, ...parsed, full: md });
      }
      return true;
    }
    if (url.startsWith("/api/coding-project/project-md/regenerate") && method === "POST") {
      if (!paaw.exists) await paaw.init();
      let modelOverride = null;
      try { const b = JSON.parse(await readBody(req) || "{}"); modelOverride = b.model || null; } catch {}
      const r = await regenerateProjectMd(root, { callLLM: (b) => callProjectLLM({ ...b, model: b.model || modelOverride || undefined }, { caller: "cu-overview", timeoutMs: 120_000, maxRetries: 2 }) });
      try { await paaw.setCuStepStatus("overview", "done", { summary: `${r.features} features（${r.aiSource}）` }); } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r));
      return true;
    }
    if (url.startsWith("/api/coding-project/project-md") && method === "POST") {
      if (!paaw.exists) await paaw.init();
      const body = JSON.parse(await readBody(req) || "{}");
      const md = await paaw.readFile("PROJECT.md");
      const parsed = parseProjectMd(md);
      // 檔名：package.json name > root basename
      let name = root.split(/[\\/]/).pop() || "Project";
      try { const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8")); if (pkg.name) name = pkg.name; } catch {}
      const next = buildProjectMd(name, String(body.userSection ?? ""), parsed.aiSection);
      await paaw.writeFile("PROJECT.md", next);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // ── POST /api/coding-project/generate-overview ──
    if (url.startsWith("/api/coding-project/generate-overview") && method === "POST") {
      // Ensure .paaw/ exists first
      if (!paaw.exists) await paaw.init();
      const content = await paaw.generateProjectOverview();
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content);
      return true;
    }

    // ── GET /api/coding-project/all ──
    // Returns everything needed for the right-panel tabs in one call
    if (url.startsWith("/api/coding-project/all") && method === "GET") {
      if (!paaw.exists) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ initialized: false }));
        return true;
      }
      const [context, sessions, decisions, changelog] = await Promise.all([
        paaw.loadContext(),
        paaw.listSessions(),
        paaw.readFile("DECISIONS.md"),
        paaw.readFile("CHANGELOG.md"),
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        initialized: true,
        context,
        sessions,
        decisions,
        changelog,
      }));
      return true;
    }

    // ── GET /api/coding-project/health ──
    if (url.startsWith("/api/coding-project/health") && method === "GET") {
      const health = await collectProjectHealth(root, paaw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
      return true;
    }

    // ── Snapshot endpoints ──

    // POST /api/coding-project/snapshot — create manual snapshot
    if (url.startsWith("/api/coding-project/snapshot") && method === "POST" && !url.includes("/restore")) {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      if (!paaw.exists) await paaw.init();
      const body = JSON.parse(await readBody(req) || "{}");
      const result = await snap.create(body.label || "manual");
      await snap.cleanup(50);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // GET /api/coding-project/snapshots — list snapshots
    if (url.startsWith("/api/coding-project/snapshots") && method === "GET") {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      const list = await snap.list();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
      return true;
    }

    // POST /api/coding-project/snapshot/restore — restore file from snapshot
    if (url.startsWith("/api/coding-project/snapshot/restore") && method === "POST") {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      const body = JSON.parse(await readBody(req));
      const result = await snap.restoreFile(body.snapshot, body.file);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── Git tracking strategy ──

    // GET /api/coding-project/git-strategy — get .paaw gitignore status
    if (url.startsWith("/api/coding-project/git-strategy") && method === "GET") {
      const gitignorePath = join(root, ".gitignore");
      let paawTracked = true;
      let gitignoreContent = "";
      if (existsSync(gitignorePath)) {
        gitignoreContent = readSync(gitignorePath, "utf-8");
        paawTracked = !gitignoreContent.includes(".paaw/");
      }
      // Check if .paaw/ is already committed
      let committed = false;
      try {
        const check = await runShellCmd(`git ls-files .paaw/`, root, 5000);
        committed = check.trim().length > 0;
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ paawTracked, committed, gitignoreHasPaaw: !paawTracked }));
      return true;
    }

    // PUT /api/coding-project/git-strategy — set strategy
    if (url.startsWith("/api/coding-project/git-strategy") && method === "PUT") {
      const body = JSON.parse(await readBody(req));
      const strategy = body.strategy; // "track" | "ignore" | "branch"
      const gitignorePath = join(root, ".gitignore");
      let gitignoreContent = existsSync(gitignorePath) ? readSync(gitignorePath, "utf-8") : "";

      if (strategy === "ignore") {
        if (!gitignoreContent.includes(".paaw/")) {
          gitignoreContent = gitignoreContent.trimEnd() + "\n# PAAW AI-Native IDE\n.paaw/\n";
          await writeFile(gitignorePath, gitignoreContent, "utf-8");
        }
      } else if (strategy === "track") {
        // Remove .paaw/ from gitignore if present
        gitignoreContent = gitignoreContent
          .replace(/^\.paaw\/$/gm, "")
          .replace(/^# PAAW AI-Native IDE$/gm, "")
          .replace(/\n{3,}/g, "\n\n");
        await writeFile(gitignorePath, gitignoreContent, "utf-8");
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, strategy }));
      return true;
    }

    // ── AI Initialize — multi-step project knowledge auto-fill ──

    // POST /api/coding-project/ai-initial-step — run a single Code Understanding step
    if (url.startsWith("/api/coding-project/ai-initial-step") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const stepId = body.step;
      const skipContext = body.skipContext === true; // if true, don't load accumulated context
      const cuModelOverride = body.model || null;

      const ALL_STEPS = [
        { id: "scan", name: "🔍 掃描專案結構", promptFile: "scan-project.md" },
        { id: "feature-map", name: "🗺️ 產出 Feature Map v2（決定論骨架＋AI 長肉）", promptFile: null },
        { id: "api-map", name: "🌐 產出 API Map（API-first）", promptFile: "gen-api-map.md" },
        { id: "ui-map", name: "🖥️ 產出 UI Map（前端 route-first）", promptFile: "gen-ui-map.md" },
        { id: "code-intelligence", name: "🧠 Code Intelligence", promptFile: null },
        { id: "test-intelligence", name: "🧪 Test Intelligence", promptFile: null },
        { id: "error-codes", name: "🔢 Error Codes by Feature", promptFile: null },
        { id: "c4-model", name: "🏛️ C4 Model（對外連線）", promptFile: null },
      ];
      const step = ALL_STEPS.find(s => s.id === stepId);
      if (!step) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown step: ${stepId}` }));
        return true;
      }

      // SSE stream
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const sendEvent = (event, data) => { if (res.writableEnded || res.destroyed) return; try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };

      try {
        await paaw.init();

        // Gather project context
        let projectContext = `Project root: ${root}\n`;
        try {
          const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
          projectContext += `Package: ${pkg.name || "unknown"}\nDependencies: ${Object.keys(pkg.dependencies || {}).join(", ")}\n`; // nosemgrep: missing-template-string-indicator
        } catch {}
        try {
          const treeOutput = await scanProjectFiles(root);
          projectContext += `\nFile tree:\n${treeOutput}`;
        } catch {}
        try {
          const gitLog = await runShellCmd("git log --oneline -20", root);
          projectContext += `\nRecent git log:\n${gitLog}`;
        } catch {}

        // Load prompt
        const promptsDir = join(DATA_HOME, "prompts", "code-understanding");
        const aiSettingsDir = join(DATA_HOME, "ai-settings", "coding");
        const loadPrompt = (filename) => {
          // Priority: ai-settings/coding/ > prompts/code-understanding/
          try { return readSync(resolve(aiSettingsDir, filename), "utf-8"); } catch {}
          try { return readSync(resolve(promptsDir, filename), "utf-8"); } catch {}
          try { return readSync(resolve(BUNDLED_PROMPTS_DIR, filename), "utf-8"); } catch { return ""; } // 2026-11-02：packages 內建 fallback
        };
        const loadProjectPrompt = (filename) => {
          // Priority: .paaw/prompts/ > ai-settings/coding/ > prompts/code-understanding/
          const overridePath = join(root, ".paaw", "prompts", "code-understanding", filename);
          if (existsSync(overridePath)) { try { return readSync(overridePath, "utf-8"); } catch {} }
          return loadPrompt(filename);
        };

        sendEvent("step_start", { step: step.id, name: step.name });

        // Special handling: security-scan runs Semgrep (no LLM needed)
        if (step.id === "security-scan") {
          try {
            cuLog(step.id, "Running Semgrep scan...");
            const scanResult = await runSemgrep(root, { timeoutMs: 1_800_000 });
            if (scanResult.error && scanResult.findings.length === 0) {
              sendEvent("step_error", { step: step.id, name: step.name, error: scanResult.error });
              sendEvent("done", { message: "Semgrep scan failed" });
              if (!res.writableEnded) res.end();
              return true;
            }
            // Save results
            const secDir = join(root, ".paaw", "security");
            if (!existsSync(secDir)) await mkdir(secDir, { recursive: true });
            await writeFile(join(secDir, "scan-results.json"), JSON.stringify(scanResult, null, 2), "utf-8");
            cuLog(step.id, `Semgrep done: ${scanResult.stats.total} findings, ${scanResult.stats.filesAffected || 0} files affected`);
            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              summary: `${scanResult.stats.total} findings (${JSON.stringify(scanResult.stats.bySeverity)})`,
              stats: scanResult.stats,
              findings: (scanResult.findings || []).map(f => ({
                id: f.id,
                severity: f.severity,
                file: f.file,
                line: f.line,
                message: f.message,
                snippet: f.snippet,
                fix: f.fix,
                category: f.category,
              })),
            });
            try { await paaw.setCuStepStatus(step.id, "done", { summary: `${scanResult.stats.total} findings` }); } catch {}
          } catch (err) {
            cuLog(step.id, `Semgrep failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
            sendEvent("done", { message: "Security scan failed" });
            if (!res.writableEnded) res.end();
            return true;
          }
          sendEvent("done", { message: "Security scan complete" });
          if (!res.writableEnded) res.end();
          return true;
        }

        // Special handling: code-intelligence runs Tree-sitter analysis (no LLM needed)
        if (step.id === "code-intelligence") {
          try {
            cuLog(step.id, "Building code intelligence (call graph, dependency graph, etc.)...");
            const { summary } = await buildCodeIntelligence(root, PAAW_ROOT, { onProgress: (done, total) => { sendEvent("step_progress", { step: step.id, name: step.name, message: `Tree-sitter 分析中 ${done}/${total} 檔（無上限完整掃）` }); } });
            cuLog(step.id, `Code intelligence done: ${summary.callGraph.totalFunctions} functions, ${summary.callGraph.totalCalls} calls, ${summary.dependencyGraph.totalEdges} dependencies`);
            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              summary: `${summary.callGraph.totalFunctions} functions, ${summary.callGraph.totalCalls} calls, ${summary.symbolIndex.total} symbols`,
              stats: summary,
              codeIntelligenceSummary: {
                totalFunctions: summary.callGraph?.totalFunctions || 0,
                totalCalls: summary.callGraph?.totalCalls || 0,
                totalDependencies: summary.dependencyGraph?.totalEdges || 0,
                totalSymbols: summary.symbolIndex?.total || 0,
                topFunctions: (summary.callGraph?.topFunctions || []).slice(0, 20).map((f) => `${f.name} (${f.file}:${f.line}, called ${f.callCount}x)`),
                topDependencies: (summary.dependencyGraph?.topEdges || []).slice(0, 15).map((e) => `${e.from} → ${e.to}`),
              },
            });
            try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.callGraph.totalFunctions} functions` }); } catch {}
          } catch (err) {
            cuLog(step.id, `Code intelligence failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          }
          sendEvent("done", { message: "Code intelligence complete" });
          res.end();
          return true;
        }

        // Special handling: test-intelligence runs static analysis (no LLM needed)
        if (step.id === "test-intelligence") {
          try {
            cuLog(step.id, "Building test intelligence...");
            const { summary, data: tiData } = await buildTestIntelligence(root, PAAW_ROOT);
            cuLog(step.id, `Test intelligence done: ${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`);
            const tiEnriched = await backfillApiTests(root); // 2026-11-01 API-first：tests 回寫 api_features
            if (tiEnriched > 0) cuLog(step.id, `Backfilled tests into ${tiEnriched} API(s)`);
            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              summary: `${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`,
              stats: summary,
              testIntelligenceSummary: {
                totalTestFiles: summary.totalTestFiles || 0,
                coverageRate: summary.coverageRate || "N/A",
                untestedFiles: (summary.untestedFiles || []).slice(0, 20),
                lowCoverageFiles: (summary.lowCoverageFiles || []).slice(0, 15).map((f) => `${f.file} (${f.coverage || "0%"})`),
              },
            });
            try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.totalTestFiles} tests` }); } catch {}
          } catch (err) {
            cuLog(step.id, `Test intelligence failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          }
          sendEvent("done", { message: "Test intelligence complete" });
          res.end();
          return true;
        }

        // Special handling: error-codes — by-feature LLM 語意整理（2026-09-05 v2：不認命名慣例，OSS/任意 project 都能用）
        if (step.id === "error-codes") {
          try {
            cuLog(step.id, "Collecting error signals + LLM organizing...");
            const { organizeErrorCodes } = await import("../lib/error-code-scan.mjs");
            const ecResult = await organizeErrorCodes(root, {
              callLLM: (body) => callProjectLLM({ ...body, model: body.model || cuModelOverride || undefined }, { ...CU_LLM_OPTS, timeoutMs: 600_000, maxRetries: 3 }),
              onProgress: (msg) => { cuLog(step.id, msg); sendEvent("step_progress", { step: step.id, name: step.name, message: msg }); },
            });
            if (ecResult.skipped) {
              cuLog(step.id, `Skipped: ${ecResult.reason}`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: "no error signals" });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: "no error signals" }); } catch {}
            } else {
              cuLog(step.id, `Error codes done: ${ecResult.stats.uniqueCodes} codes / ${ecResult.stats.featureCount} features / conventions=${ecResult.conventions}${ecResult.recommendation.suggest ? " (建議導入 Rules v1)" : ""}`);
              sendEvent("step_done", {
                step: step.id,
                name: step.name,
                summary: `${ecResult.stats.uniqueCodes} codes, ${ecResult.stats.featureCount} features, conventions: ${ecResult.conventions}`,
                stats: { ...ecResult.stats, conventions: ecResult.conventions, suggest: ecResult.recommendation.suggest },
              });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${ecResult.stats.uniqueCodes} codes / conventions=${ecResult.conventions}` }); } catch {}
            }
          } catch (err) {
            cuLog(step.id, `Error codes failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
            try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
          }
          sendEvent("done", { message: "Error codes complete" });
          res.end();
          return true;
        }
        // Special handling: c4-model — 對外連線全景（機器收證據 + LLM 組 C4）
        if (step.id === "c4-model") {
          try {
            cuLog(step.id, "Collecting external signals + LLM assembling C4...");
            const { organizeC4Model } = await import("../lib/c4-model-scan.mjs");
            const c4Result = await organizeC4Model(root, {
              callLLM: (body) => callProjectLLM({ ...body, model: body.model || cuModelOverride || undefined }, { ...CU_LLM_OPTS, timeoutMs: 600_000, maxRetries: 3 }),
              onProgress: (msg) => { cuLog(step.id, msg); sendEvent("step_progress", { step: step.id, name: step.name, message: msg }); },
            });
            cuLog(step.id, `C4 done: ${c4Result.stats.containers} containers / ${c4Result.stats.external} external / ${c4Result.stats.relationships} relationships`);
            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              summary: `${c4Result.stats.containers} containers, ${c4Result.stats.external} external systems`,
            });
            try { await paaw.setCuStepStatus(step.id, "done", { summary: `${c4Result.stats.external} external / ${c4Result.stats.containers} containers` }); } catch {}
          } catch (err) {
            cuLog(step.id, `C4 model failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
            try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
          }
          sendEvent("done", { message: "C4 model complete" });
          res.end();
          return true;
        }

        // Special handling: change-intelligence runs git log analysis (no LLM needed)
        if (step.id === "change-intelligence") {
          try {
            cuLog(step.id, "Building change intelligence...");
            const { summary } = await buildChangeIntelligence(root, { days: 30, maxCommits: 50 }, { persist: false }); // 2026-09-06：GET 純算不落檔
            cuLog(step.id, `Change intelligence done: ${summary.totalCommits} commits, ${summary.totalFilesChanged} files changed`);
            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              summary: `${summary.totalCommits} commits, ${summary.totalFilesChanged} files, ${summary.highImpactChanges} high-impact`,
              stats: summary,
            });
            try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.totalCommits} commits` }); } catch {}
          } catch (err) {
            cuLog(step.id, `Change intelligence failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          }
          sendEvent("done", { message: "Change intelligence complete" });
          res.end();
          return true;
        }

        const promptTemplate = loadProjectPrompt(step.promptFile);
        if (!promptTemplate) {
          sendEvent("step_skip", { step: step.id, name: step.name, reason: "Prompt template not found" });
          sendEvent("done", { message: "Step skipped" });
          res.end();
          return true;
        }

          // Load accumulated context from existing .paaw/ files (unless skipContext)
        let fullPrompt = promptTemplate;
        fullPrompt += `\n\n--- PROJECT CONTEXT ---\n${projectContext}`;
        // 2026-11-07：ui-map 前置 deterministic route 盤點（page-inventory 引擎）— LLM 不可發明 route，只能補語意
        if (step.id === "ui-map") {
          try {
            const { buildPageInventory } = await import("../lib/page-inventory.mjs");
            const inv = buildPageInventory(root, [], {});
            if (inv.summary.totalRoutes > 0) {
              const lines = inv.rows.slice(0, 80).map((r) => `- ${r.route}（${r.kind} · page: ${r.page} · 組件 ${r.componentCount} 檔 · unit ${r.unitTestedCount}）`).join("\n");
              fullPrompt += `\n\n--- DETERMINISTIC PAGE ROUTES（程式已 parse，以這些為準 — 不可發明不存在的 route；每筆都要產出；tab/無 route 的進入點可另補）---\n${lines}`;
            } else {
              fullPrompt += `\n\n--- DETERMINISTIC PAGE ROUTES ---\n（程式 parse 到 0 條 router route — 本專案可能是 tab-based UI：以主要 view/tabs 當進入點，route 欄填主要檔案路徑）`;
            }
          } catch (e) { cuLog("ui-map", `page-inventory 失敗（略過注入）: ${e.message}`); }
        }
        if (!skipContext) {
          const loadCtx = async (file, label, maxLen = 3000) => {
            try {
              const content = await paaw.readFile(file);
              if (content && content.trim()) {
                fullPrompt += `\n\n--- ${label} ---\n${content.slice(0, maxLen)}`;
              }
            } catch {}
          };
          // scan.json is always loaded as context for all steps (except scan itself)
          if (step.id !== "scan") {
            await loadCtx("scan.json", "SCAN RESULTS", 6000);
          }
          if (step.id !== "scan" && step.id !== "architecture") {
            await loadCtx("ARCHITECTURE.md", "ARCHITECTURE");
          }
          if (step.id === "test-payload" || step.id === "overview" || step.id === "api-map" || step.id === "ui-map") {
            await loadCtx("specs/api-contract.md", "API SPEC");
          }
          if (step.id === "overview" || step.id === "api-map" || step.id === "ui-map") {
            await loadCtx("specs/error-codes.md", "ERROR MAPPING");
          }
          if (step.id === "overview" || step.id === "api-map" || step.id === "ui-map") {
            await loadCtx("DECISIONS.md", "DECISIONS", 2000);
          }
        }

          // CU step skill 外掛：專案 .paaw/crew.json skillBindings["cu.<stepId>"] 綁的 PAAW skill
          const cuSkills = await loadCuStepSkills(root, step.id);
          if (cuSkills.length > 0) {
            fullPrompt += `\n\n--- CU SKILL DIRECTIVES（${step.id} 方法論指令，優先於預設 prompt 的做法但不可違反輸出格式）---`;
            for (const sk of cuSkills) {
              fullPrompt += `\n\n### Skill: ${sk.name}${sk.path ? `\n（源路徑: ${sk.path}）` : ""}\n${sk.prompt}`;
            }
            cuLog(step.id, `Applied ${cuSkills.length} skill(s): ${cuSkills.map(x => x.id).join(", ")}`);
            sendEvent?.("step_progress", { step: step.id, name: step.name, message: `套用 skill：${cuSkills.map(x => x.name).join("、")}` });
          }

        // Call LLM with longer timeout for single step
        try {
          const result = await callProjectLLM({
            model: body.model || cuModelOverride || undefined,
            messages: [{ role: "user", content: fullPrompt }],
            temperature: 0,
            thinking: { type: "disabled" }, // 關思考 — 實證必要：thinking 開著會燒光輸出額度（reasoning_tokens=15989 實例）
          }, { ...CU_LLM_OPTS, timeoutMs: 600_000, maxRetries: 3 }); // 10 min timeout for single step

          const content = result.content || "";
          cuLog(step.id, `LLM response: contentLen=${content.length} finishReason=${result.finishReason} attempts=${result.attempts}`);
          if (!content.trim()) {
            sendEvent("step_error", { step: step.id, name: step.name, error: "Empty response from LLM" });
            sendEvent("done", { message: "Step failed" });
            res.end();
            return true;
          }

          // Sanitize markdown before saving — prevent broken markdown from crashing frontend
          const sanitized = _sanitizeMd(content);
          if (sanitized !== content) {
            cuLog(step.id, `Markdown sanitized: ${content.length} → ${sanitized.length} chars`);
          }

          // Save output to .paaw/
          try {
            if (step.id === "scan") {
              await paaw.writeFile("scan.json", _stripCodeFence(content));
            } else if (step.id === "architecture") {
              await diffWriteFile(paaw, "ARCHITECTURE.md", sanitized);
            } else if (step.id === "api-spec") {
              await diffWriteFile(paaw, "specs/api-contract.md", sanitized);
              // Extract api-examples from ```json-examples block
              const examplesMatch = content.match(/```json-examples\s*\n([\s\S]*?)\n```/);
              if (examplesMatch) {
                try {
                  const examples = JSON.parse(examplesMatch[1].trim());
                  if (Array.isArray(examples)) {
                    await paaw.writeFile("code-intelligence/api-examples.json", JSON.stringify(examples, null, 2));
                    cuLog(step.id, `Saved ${examples.length} API examples`);
                  }
                } catch (e) {
                  cuLog(step.id, `Failed to parse api-examples: ${e.message}`);
                }
              }
            } else if (step.id === "error-mapping") {
              await diffWriteFile(paaw, "specs/error-codes.md", sanitized);
              const runbookMatches = [...content.matchAll(/## Runbook[:\s]+(\d+).*?\n([\s\S]*?)(?=\n## Runbook|\n---|$)/g)];
              for (const rm of runbookMatches) {
                await paaw.writeFile(`runbook/${rm[1]}.md`, `# Runbook: ${rm[1]}\n\n${rm[2].trim()}`);
              }
            } else if (step.id === "decisions") {
              await diffWriteFile(paaw, "DECISIONS.md", sanitized);
            } else if (step.id === "test-payload") {
              await paaw.writeFile("test-payloads/all-payloads.json", content);
              try {
                const payloads = JSON.parse(content);
                if (Array.isArray(payloads)) {
                  for (const p of payloads) {
                    const slug = (p.endpoint || p.name || "unknown").replace(/[^a-zA-Z0-9-]/g, "-");
                    await paaw.writeFile(`test-payloads/${slug}.json`, JSON.stringify(p, null, 2));
                  }
                }
              } catch {}
            } else if (step.id === "overview") {
              await diffWriteFile(paaw, "PROJECT.md", sanitized);
            } else if (step.id === "api-map") {
              // API-first（2026-11-01 Fleming）：LLM 輸出 → api_features 表 + fileApiMap + marker 檔
              try {
                const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
                if (!cleanJson) throw new Error("AI 回應為空，無法產生 API Map");
                const apis = _extractJsonArray(content);
                if (!Array.isArray(apis) || apis.length === 0) throw new Error("API Map 解析失敗（非 JSON array）");
                const { todayStamp } = await import("../lib/feature-registry.mjs");
                const prefix = `A${todayStamp()}-`;
                const now = new Date().toISOString();
                const seen = new Set();
                const clean = [];
                for (const a of apis) {
                  if (!a || typeof a.entry !== "string" || !a.entry.trim()) continue;
                  const entry = a.entry.trim();
                  if (seen.has(entry)) continue;
                  seen.add(entry);
                  clean.push({
                    id: `${prefix}${String(clean.length + 1).padStart(3, "0")}`,
                    category: a.category || "uncategorized",
                    entry, name: a.name || entry,
                    description: a.description || null, bizLogic: a.bizLogic || null,
                    processFlow: Array.isArray(a.processFlow) ? a.processFlow : [],
                    validation: Array.isArray(a.validation) ? a.validation : [],
                    dataTouch: Array.isArray(a.dataTouch) ? a.dataTouch : [],
                    aiUnderstanding: "",
                    codeFiles: Array.isArray(a.codeFiles) ? a.codeFiles : [],
                    tests: Array.isArray(a.tests) ? a.tests : [],
                    severity: a.severity || null, custom: {},
                    createdAt: now, updatedAt: now,
                  });
                }
                if (!clean.length) throw new Error("API Map 無有效 entry");
                const { saveApiFeatures, buildFileApiMap } = await import("../lib/coding-db/api-features.repo.mjs");
                saveApiFeatures(root, clean);
                writeDoc(root, "fileApiMap", { files: buildFileApiMap(clean), updatedAt: now });
                await paaw.writeFile("api-map.json", JSON.stringify(clean, null, 2));
                cuLog(step.id, `Saved ${clean.length} API features + file→API reverse index`);
              } catch (apiErr) {
                cuLog(step.id, `api-map failed: ${apiErr.message}`);
                sendEvent("step_error", { step: step.id, name: step.name, error: apiErr.message });
                try { await paaw.setCuStepStatus(step.id, "error", { error: apiErr.message }); } catch {}
                res.end();
                return true;
              }
            } else if (step.id === "ui-map") {
              // 前端 route-first（2026-11-01 Fleming）：LLM 輸出 → ui_features 表 + marker 檔
              try {
                const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
                if (!cleanJson) throw new Error("AI 回應為空，無法產生 UI Map");
                const uis = _extractJsonArray(content);
                // 2026-11-02：純後端專案（無前端 route）→ LLM 回非 JSON 說明文 → 合法結果：空 UI Map 標 done，不報錯（guardrail-hub 實案例）
                if (!Array.isArray(uis) || uis.length === 0) {
                  const _bareUi = content.replace(/```(?:json)?/g, "").trim(); // 2026-11-03：剥所有 code fence 再比對（同 bulk 版）
                  if (_bareUi === "[]" || !content.includes("[") && content.trim().length < 300 /* 2026-11-03 同 bulk：短回應且無 JSON 陣列 = backend-only */ || /沒有|無|no\s+(frontend|ui|route|page)|backend[- ]?only|not found|純後端|後端(專案|項目|服務)/i.test(content)) {
                    const { saveUiFeatures } = await import("../lib/coding-db/ui-features.repo.mjs");
                    saveUiFeatures(root, []);
                    await paaw.writeFile("ui-map.json", "[]");
                    cuLog(step.id, `Saved 0 UI features（backend-only 專案）`);
                    sendEvent("step_done", { step: step.id, name: step.name, size: 2, preview: "[]" });
                    try { await paaw.setCuStepStatus(step.id, "done", { size: 2, summary: "0 UI features（backend-only）" }); } catch {}
                    res.end();
                    return true;
                  }
                  throw new Error("UI Map 解析失敗（非 JSON array）");
                }
                const { todayStamp } = await import("../lib/feature-registry.mjs");
                const prefix = `U${todayStamp()}-`;
                const now = new Date().toISOString();
                const seen = new Set();
                const clean = [];
                for (const u of uis) {
                  if (!u || typeof u.route !== "string" || !u.route.trim()) continue;
                  const route = u.route.trim();
                  if (seen.has(route)) continue;
                  seen.add(route);
                  clean.push({
                    id: `${prefix}${String(clean.length + 1).padStart(3, "0")}`,
                    category: u.category || "uncategorized",
                    route, name: u.name || route,
                    description: u.description || null,
                    uiFlow: Array.isArray(u.uiFlow) ? u.uiFlow : [],
                    components: Array.isArray(u.components) ? u.components : [],
                    stateMgmt: u.stateMgmt || null,
                    apiCalls: Array.isArray(u.apiCalls) ? u.apiCalls : [],
                    codeFiles: Array.isArray(u.codeFiles) ? u.codeFiles : [],
                    backendFiles: Array.isArray(u.backendFiles) ? u.backendFiles : [],
                    tests: Array.isArray(u.tests) ? u.tests : [],
                    severity: u.severity || null, custom: {},
                    createdAt: now, updatedAt: now,
                  });
                }
                if (!clean.length) throw new Error("UI Map 無有效 route");
                // 2026-11-07：merge deterministic page evidence（unit/e2e/API/components）進 custom.pageEvidence
                try {
                  const { buildPageInventory } = await import("../lib/page-inventory.mjs");
                  const { readApiFeatures } = await import("../lib/coding-db/reads.mjs");
                  const inv = buildPageInventory(root, readApiFeatures(root), {});
                  const byRoute = new Map(inv.rows.map((r) => [r.route, r]));
                  for (const c of clean) {
                    const hit = byRoute.get(c.route);
                    if (hit) c.custom = { ...(c.custom || {}), pageEvidence: { kind: hit.kind, page: hit.page, componentCount: hit.componentCount, unitTestedCount: hit.unitTestedCount, e2eFiles: hit.e2eFiles, apiCalls: hit.apiCalls } };
                  }
                  cuLog(step.id, `pageEvidence merged: ${clean.filter((c) => c.custom?.pageEvidence).length}/${clean.length}`);
                } catch (peErr) { cuLog(step.id, `pageEvidence merge failed（不影響 UI Map）: ${peErr.message}`); }
                const { saveUiFeatures } = await import("../lib/coding-db/ui-features.repo.mjs");
                saveUiFeatures(root, clean);
                await paaw.writeFile("ui-map.json", JSON.stringify(clean, null, 2));
                cuLog(step.id, `Saved ${clean.length} UI features`);
              } catch (uiErr) {
                cuLog(step.id, `ui-map failed: ${uiErr.message}`);
                sendEvent("step_error", { step: step.id, name: step.name, error: uiErr.message });
                try { await paaw.setCuStepStatus(step.id, "error", { error: uiErr.message }); } catch {}
                res.end();
                return true;
              }
            }
            cuLog(step.id, `wrote file OK (${content.length} chars)`);
          } catch (writeErr) {
            cuLog(step.id, `FAILED to write file: ${writeErr.message}`);
          }

          sendEvent("step_done", { step: step.id, name: step.name, size: content.length, preview: content.slice(0, 200) });
          cuLog(step.id, `sendEvent step_done (${content.length} chars)`);
          try { await paaw.setCuStepStatus(step.id, "done", { size: content.length }); } catch {}
        } catch (err) {
          sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
        }
        // CU 收尾：api-map 完成後 PROJECT.md 重生成（feature map 已退役，2026-11-01 Fleming API-first）
        if (stepId === "api-map") {
          // CU 收尾：PROJECT.md 重生成（2026-10-09 Fleming — schema v2：AI 區每次重寫、USER 區絕不覆蓋）
          try {
            const draft = await regenerateProjectMd(root, { callLLM: (b) => callProjectLLM({ ...b, model: body.model || cuModelOverride || undefined }, { caller: "cu-overview", timeoutMs: 120_000, maxRetries: 2 }) });
            try { await paaw.setCuStepStatus("overview", "done", { summary: `${draft.features} features（${draft.aiSource}）` }); } catch {}
            if (draft.written) {
              cuLog("overview", `PROJECT.md ${draft.reason} (${draft.features} features, ${draft.aiSource})`);
              sendEvent("info", { message: `📝 PROJECT.md 已更新（${draft.reason}，${draft.features} features，${draft.aiSource === "llm" ? "AI 生成" : "確定性骨架"}）— User Remarks 區不受影響` });
            }
          } catch (e) { cuLog("overview", `regenerate failed: ${e.message}`); }
        }
        sendEvent("done", { message: "Step complete" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }
      res.end();
      return true;
    }

    // POST /api/coding-project/ai-initial (Code Understanding)
    // ?force=1 to re-run all steps even if already done
    if (url.startsWith("/api/coding-project/ai-initial") && method === "POST") {
      const forceRerun = q.force === "1" || q.force === "true";
      const steps = [
        { id: "scan", name: "🔍 掃描專案結構", promptFile: "scan-project.md" },
        { id: "feature-map", name: "🗺️ 產出 Feature Map v2（決定論骨架＋AI 長肉）", promptFile: null },
        { id: "api-map", name: "🌐 產出 API Map（API-first）", promptFile: "gen-api-map.md" },
        { id: "ui-map", name: "🖥️ 產出 UI Map（前端 route-first）", promptFile: "gen-ui-map.md" },
        { id: "code-intelligence", name: "🧠 Code Intelligence", promptFile: null },
        { id: "test-intelligence", name: "🧪 Test Intelligence", promptFile: null },
        { id: "error-codes", name: "🔢 Error Codes by Feature", promptFile: null },
        { id: "c4-model", name: "🏛️ C4 Model（對外連線）", promptFile: null },
      ];

      // SSE stream — send progress as each step completes
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event, data) => {
        if (res.writableEnded || res.destroyed) return;
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
      };

      try {
        // Ensure .paaw/ exists
        await paaw.init();

        // Read model override from request body
        let cuModelOverride = null;
        try { const cuBody = JSON.parse(await readBody(req) || "{}"); cuModelOverride = cuBody.model || null; } catch {}
        // 2026-11-08 Fleming 公司報案：log 看到的 model 跟 EM UI 選的不一樣 — 明講用哪個（body 沒帶 = providers defaultModel）
        cuLog("bulk", `model = ${cuModelOverride || "(未指定 → providers.json defaultModel)"}`);
        // 2026-11-08 追修：記住本 RU 最後用的 CU model — 背景自動增量重跑沿用同一個（不會因背景無 UI context 退回 defaultModel）
        if (cuModelOverride) {
          try { await writeFile(join(root, ".paaw", "cu-model.json"), JSON.stringify({ model: cuModelOverride, ts: new Date().toISOString() }, null, 2), "utf-8"); } catch {}
        }

        // Gather project info for context
        // 2026-11-07 多語言：不只 package.json — go.mod / Cargo.toml / pom.xml / build.gradle / requirements.txt / pyproject.toml
        let projectContext = `Project root: ${root}\n`;
        try {
          projectContext += _buildManifestContext(root);
        } catch {}

        // Get file tree
        try {
          const treeOutput = await scanProjectFiles(root);
          projectContext += `\nFile tree:\n${treeOutput}`;
        } catch {}

        // Get recent git log
        try {
          const gitLog = await runShellCmd("git log --oneline -20", root);
          projectContext += `\nRecent git log:\n${gitLog}`;
        } catch {}

        // Load prompt templates
        const promptsDir = join(DATA_HOME, "prompts", "code-understanding");
        const aiSettingsDir = join(DATA_HOME, "ai-settings", "coding");
        const loadPrompt = (filename) => {
          // Priority: ai-settings/coding/ > prompts/code-understanding/
          try { return readSync(resolve(aiSettingsDir, filename), "utf-8"); } catch {}
          try { return readSync(resolve(promptsDir, filename), "utf-8"); } catch {}
          try { return readSync(resolve(BUNDLED_PROMPTS_DIR, filename), "utf-8"); } catch { return ""; } // 2026-11-02：packages 內建 fallback
        };

        // Check project-level overrides in .paaw/prompts/code-understanding/
        const loadProjectPrompt = (filename) => {
          // Priority: .paaw/prompts/ > ai-settings/coding/ > prompts/code-understanding/
          const overridePath = join(root, ".paaw", "prompts", "code-understanding", filename);
          if (existsSync(overridePath)) {
            try { return readSync(overridePath, "utf-8"); } catch {}
          }
          return loadPrompt(filename);
        };

        // ── Check which steps are already done — skip them ──
        const cuStatus = await paaw.getCuStatus();
        const cuSteps = cuStatus.steps || {};

        // 2026-09-06 Fleming：增量重掃 — 只重跑「有變更」的步驟
        // watermark 機制：每個 step 完成時記下當時 source mtime（cu-status codeMtime），
        // code 有新變更（lastModifiedMs > watermark）的 step 才重跑；沒變的 done step 照舊 skip 省 token
        const { lastModifiedMs: _codeMtime } = countSourceFiles(root);
        const staleStepIds = new Set((await computeCuStaleness(root, cuSteps, _codeMtime)).map(s => s.id));
        cuLog("bulk", `Incremental plan: stale=[${[...staleStepIds].join(",") || "none"}] force=${forceRerun}`);

        // Accumulate context from previous steps
        let scanResult = "";
        let architectureResult = "";
        let apiSpecResult = "";
        let errorMappingResult = "";
        let decisionsResult = "";

        for (const step of steps) {
          // ── Skip if this step is done AND up-to-date (unless force rerun) ──
          // 2026-09-06：done 但過期（code 有變更）的 step 不再 skip — 增量重跑它
          if (!forceRerun && cuSteps[step.id]?.status === "done" && !staleStepIds.has(step.id)) {
            cuLog(step.id, `Skipping — done & no changes since last scan`);
            sendEvent("step_skip", { step: step.id, name: step.name, reason: "已最新（無變更）" });
            continue;
          }

          sendEvent("step_start", { step: step.id, name: step.name });

          // Special handling: security-scan runs Semgrep (no LLM needed)
          if (step.id === "security-scan") {
            try {
              cuLog(step.id, "[bulk] Running Semgrep scan...");
              const scanResult = await runSemgrep(root, { timeoutMs: 1_800_000 });
              if (scanResult.error && scanResult.findings.length === 0) {
                sendEvent("step_skip", { step: step.id, name: step.name, reason: scanResult.error.split('\n')[0] });
                continue;
              }
              const secDir = join(root, ".paaw", "security");
              if (!existsSync(secDir)) await mkdir(secDir, { recursive: true });
              await writeFile(join(secDir, "scan-results.json"), JSON.stringify(scanResult, null, 2), "utf-8");
              cuLog(step.id, `[bulk] Semgrep done: ${scanResult.stats.total} findings`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${scanResult.stats.total} findings`, stats: scanResult.stats });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${scanResult.stats.total} findings` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] Semgrep failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

          // Special handling: feature-map v2 — 決定論骨架 + per-feature agent loop 長肉（2026-11-05 復活：
          // Slim CU 拔掉 feature-map step 後 organizeFeatureMapV2 變死碼，新專案生不出 FEATURES.json
          // → coding.db features 0 → RU model 0 → Evidence Matrix 永遠空。接回 pipeline）
          if (step.id === "feature-map") {
            try {
              cuLog(step.id, "[bulk] Building feature map v2...");
              const { organizeFeatureMapV2 } = await import("../lib/feature-map-v2.mjs");
              const fmResult = await organizeFeatureMapV2(root, {
                callLLM: (body) => callProjectLLM({ ...body, model: body.model || cuModelOverride || undefined }, { ...CU_LLM_OPTS, timeoutMs: 600_000, maxRetries: 2 }),
                onProgress: (msg) => { cuLog(step.id, `[bulk] ${msg}`); sendEvent("step_progress", { step: step.id, name: step.name, message: msg }); },
                paawRoot: PAAW_ROOT,
              });
              const nFeatures = fmResult?.features || fmResult?.summary?.features || 0;
              cuLog(step.id, `[bulk] Feature map done: ${nFeatures} features`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${nFeatures} features` });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${nFeatures} features (v2)` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] Feature map failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

          // Special handling: code-intelligence runs Tree-sitter analysis (no LLM needed)
          if (step.id === "code-intelligence") {
            try {
              cuLog(step.id, "[bulk] Building code intelligence...");
              const { summary } = await buildCodeIntelligence(root, PAAW_ROOT, { onProgress: (done, total) => { sendEvent("step_progress", { step: step.id, name: step.name, message: `Tree-sitter 分析中 ${done}/${total} 檔（無上限完整掃）` }); } });
              cuLog(step.id, `[bulk] Code intelligence done: ${summary.callGraph.totalFunctions} functions, ${summary.callGraph.totalCalls} calls`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${summary.callGraph.totalFunctions} functions, ${summary.symbolIndex.total} symbols`, stats: summary });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.callGraph.totalFunctions} functions` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] Code intelligence failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

          // Special handling: test-intelligence (no LLM)
          if (step.id === "test-intelligence") {
            try {
              cuLog(step.id, "[bulk] Building test intelligence...");
              const { summary, data: tiData } = await buildTestIntelligence(root, PAAW_ROOT);
              cuLog(step.id, `[bulk] Test intelligence: ${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`);
              const tiEnriched = await backfillApiTests(root); // 2026-11-01 API-first：tests 回寫 api_features
              if (tiEnriched > 0) cuLog(step.id, `[bulk] Backfilled tests into ${tiEnriched} API(s)`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`, stats: summary });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.totalTestFiles} tests` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] Test intelligence failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

          // Special handling: error-codes — by-feature LLM 語意整理（v2）
          if (step.id === "error-codes") {
            try {
              cuLog(step.id, "[bulk] Collecting error signals + LLM organizing...");
              const { organizeErrorCodes } = await import("../lib/error-code-scan.mjs");
              const ecResult = await organizeErrorCodes(root, {
                callLLM: (body) => callProjectLLM({ ...body, model: body.model || cuModelOverride || undefined }, { ...CU_LLM_OPTS, timeoutMs: 600_000, maxRetries: 3 }),
                onProgress: (msg) => { cuLog(step.id, `[bulk] ${msg}`); sendEvent("step_progress", { step: step.id, name: step.name, message: msg }); },
              });
              if (ecResult.skipped) {
                sendEvent("step_done", { step: step.id, name: step.name, summary: "no error signals" });
                try { await paaw.setCuStepStatus(step.id, "done", { summary: "no error signals" }); } catch {}
              } else {
                cuLog(step.id, `[bulk] Error codes: ${ecResult.stats.uniqueCodes} codes / ${ecResult.stats.featureCount} features / conventions=${ecResult.conventions}`);
                sendEvent("step_done", { step: step.id, name: step.name, summary: `${ecResult.stats.uniqueCodes} codes, ${ecResult.stats.featureCount} features, conventions: ${ecResult.conventions}` });
                try { await paaw.setCuStepStatus(step.id, "done", { summary: `${ecResult.stats.uniqueCodes} codes / conventions=${ecResult.conventions}` }); } catch {}
              }
            } catch (err) {
              cuLog(step.id, `[bulk] Error codes failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

          // Special handling: c4-model — 對外連線全景（bulk）
          if (step.id === "c4-model") {
            try {
              cuLog(step.id, "[bulk] Collecting external signals + LLM assembling C4...");
              const { organizeC4Model } = await import("../lib/c4-model-scan.mjs");
              const c4Result = await organizeC4Model(root, {
                callLLM: (body) => callProjectLLM({ ...body, model: body.model || cuModelOverride || undefined }, { ...CU_LLM_OPTS, timeoutMs: 600_000, maxRetries: 3 }),
                onProgress: (msg) => { cuLog(step.id, `[bulk] ${msg}`); sendEvent("step_progress", { step: step.id, name: step.name, message: msg }); },
              });
              cuLog(step.id, `[bulk] C4: ${c4Result.stats.containers} containers / ${c4Result.stats.external} external`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${c4Result.stats.containers} containers, ${c4Result.stats.external} external systems` });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${c4Result.stats.external} external / ${c4Result.stats.containers} containers` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] C4 model failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }


          // Special handling: change-intelligence (no LLM)
          if (step.id === "change-intelligence") {
            try {
              cuLog(step.id, "[bulk] Building change intelligence...");
              const { summary } = await buildChangeIntelligence(root, { days: 30, maxCommits: 50 }, { persist: false }); // 2026-09-06：GET 純算不落檔
              cuLog(step.id, `[bulk] Change intelligence: ${summary.totalCommits} commits, ${summary.totalFilesChanged} files`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${summary.totalCommits} commits, ${summary.totalFilesChanged} files`, stats: summary });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.totalCommits} commits` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] Change intelligence failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

          const promptTemplate = loadProjectPrompt(step.promptFile);
          if (!promptTemplate) {
            // 2026-11-02：靜默 skip 是公司端大踩雷（UI 顯示 skip 但 log/console 完全無痕）→ 加 log
            cuLog(step.id, `[bulk] SKIPPED: prompt template not found (data/prompts/code-understanding/${step.promptFile}) — deploy 包沒帶 data/ 或檔案遺失`);
            sendEvent("step_skip", { step: step.id, name: step.name, reason: `Prompt template not found: ${step.promptFile}` });
            continue;
          }

          // Build full prompt with accumulated context
          let fullPrompt = promptTemplate;
          fullPrompt += `\n\n--- PROJECT CONTEXT ---\n${projectContext}`;
          if (scanResult) fullPrompt += `\n\n--- SCAN RESULTS ---\n${scanResult}`;
          if (architectureResult && (step.id === "decisions" || step.id === "api-spec" || step.id === "overview" || step.id === "api-map" || step.id === "ui-map")) {
            const archLimit = (step.id === "api-map" || step.id === "ui-map") ? 8000 : 3000;
            fullPrompt += `\n\n--- ARCHITECTURE ---\n${architectureResult.slice(0, archLimit)}`;
          }
          if (apiSpecResult && (step.id === "test-payload" || step.id === "overview" || step.id === "api-map")) {
            fullPrompt += `\n\n--- API SPEC ---\n${apiSpecResult}`;
          }
          if (errorMappingResult && (step.id === "overview" || step.id === "api-map")) {
            fullPrompt += `\n\n--- ERROR MAPPING ---\n${errorMappingResult}`;
          }
          if (decisionsResult && (step.id === "overview" || step.id === "api-map")) {
            fullPrompt += `\n\n--- DECISIONS ---\n${decisionsResult.slice(0, 2000)}`;
          }

          // CU step skill 外掛：專案 .paaw/crew.json skillBindings["cu.<stepId>"] 綁的 PAAW skill
          const cuSkills = await loadCuStepSkills(root, step.id);
          if (cuSkills.length > 0) {
            fullPrompt += `\n\n--- CU SKILL DIRECTIVES（${step.id} 方法論指令，優先於預設 prompt 的做法但不可違反輸出格式）---`;
            for (const sk of cuSkills) {
              fullPrompt += `\n\n### Skill: ${sk.name}${sk.path ? `\n（源路徑: ${sk.path}）` : ""}\n${sk.prompt}`;
            }
            cuLog(step.id, `Applied ${cuSkills.length} skill(s): ${cuSkills.map(x => x.id).join(", ")}`);
            sendEvent?.("step_progress", { step: step.id, name: step.name, message: `套用 skill：${cuSkills.map(x => x.name).join("、")}` });
          }

          // Tree-sitter source analysis for api-map / ui-map step（API-first / route-first）
          if (step.id === "api-map" || step.id === "ui-map") {
            try {
              cuLog(step.id, "Running Tree-sitter source analysis...");
              // 2026-11-03：加上限 5000 檔 + 進度 callback — 大 repo 無上限掃描在公司端像「卡死」；達上限時 walker 自動截斷並記錄
              const tsResult = await parseProject(root, PAAW_ROOT, { maxFiles: 5000, maxBytes: 500_000, onProgress: (done, total) => { sendEvent?.("step_progress", { step: step.id, name: step.name, message: `Tree-sitter 分析中 ${done}/${total} 檔` }); } });
              cuLog(step.id, `Tree-sitter: ${tsResult.stats.parsedFiles}/${tsResult.stats.totalFiles} files parsed, ${tsResult.stats.errors} errors`);
              if (tsResult.stats.totalFiles >= 5000) cuLog(step.id, `⚠️ 達 5000 檔上限，已截斷（其餘檔案未分析）`);
              const condensed = formatCondensed(tsResult);
              // api-map：routes 是主信號（prompt 已排除前端）；ui-map：前端 route/元件是主信號（排除後端路由檔）
              const isUi = step.id === "ui-map";
              const filterSrc = isUi
                ? condensed.split("\n").filter(l => !/packages\/server\/src\/routes\/|\.mjs \(/.test(l)).join("\n")
                : condensed;
              const trimmed = filterSrc.length > 80_000 ? filterSrc.slice(0, 80_000) + "\n... (truncated)" : filterSrc;
              if (trimmed) fullPrompt += `\n\n--- SOURCE ANALYSIS (Tree-sitter) ---\n${trimmed}`;
              const fullAnalysis = formatForAI(tsResult);
              await paaw.writeFile("features/tree-sitter-analysis.txt", fullAnalysis);
            } catch (tsErr) {
              cuLog(step.id, `Tree-sitter failed (non-fatal): ${tsErr.message}`);
            }
          }

          // Call LLM
          try {
            const _llmStart = Date.now();
            // 2026-11-03：LLM 前先發進度事件（最長 10 分鐘，不發事件的話 UI 像卡死）；map 類步驟降 maxRetries=1 避免最壞 40 分鐘無回饋
            const isMapStep = step.id === "api-map" || step.id === "ui-map";
            if (isMapStep) sendEvent("step_progress", { step: step.id, name: step.name, message: "LLM 生成中（大專案最長 10 分鐘，請勿關閉）..." });
            const result = await callProjectLLM({
              model: cuModelOverride || undefined, // 2026-10-23 修：bulk handler 無 body
              messages: [{ role: "user", content: fullPrompt }],
              temperature: 0,
              thinking: { type: "disabled" }, // 關思考 — 實證必要：thinking 開著會燒光輸出額度
            }, { ...CU_LLM_OPTS, timeoutMs: 600_000, maxRetries: isMapStep ? 1 : undefined }); // 10 min per step in bulk mode
            cuLog(step.id, `[bulk] LLM done in ${Math.round((Date.now() - _llmStart) / 1000)}s (${(result.content || "").length} chars)`);

            const content = result.content || "";
            const sanitized = _sanitizeMd(content);
            try {
              if (step.id === "scan") {
                scanResult = content;
                await paaw.writeFile("scan.json", _stripCodeFence(content));
              } else if (step.id === "architecture") {
                architectureResult = content;
                await diffWriteFile(paaw, "ARCHITECTURE.md", sanitized);
              } else if (step.id === "api-spec") {
                apiSpecResult = content;
                await diffWriteFile(paaw, "specs/api-contract.md", sanitized);
              } else if (step.id === "error-mapping") {
                errorMappingResult = content;
                await diffWriteFile(paaw, "specs/error-codes.md", sanitized);
                const runbookMatches = [...content.matchAll(/## Runbook[:\s]+(\d+).*?\n([\s\S]*?)(?=\n## Runbook|\n---|$)/g)];
                for (const rm of runbookMatches) {
                  await paaw.writeFile(`runbook/${rm[1]}.md`, `# Runbook: ${rm[1]}\n\n${rm[2].trim()}`);
                }
              } else if (step.id === "decisions") {
                decisionsResult = content;
                await diffWriteFile(paaw, "DECISIONS.md", sanitized);
              } else if (step.id === "test-payload") {
                await paaw.writeFile("test-payloads/all-payloads.json", content);
                try {
                  const payloads = JSON.parse(content);
                  if (Array.isArray(payloads)) {
                    for (const p of payloads) {
                      const slug = (p.endpoint || p.name || "unknown").replace(/[^a-zA-Z0-9-]/g, "-");
                      await paaw.writeFile(`test-payloads/${slug}.json`, JSON.stringify(p, null, 2));
                    }
                  } else if (payloads.endpoint) {
                    const slug = payloads.endpoint.replace(/[^a-zA-Z0-9-]/g, "-");
                    await paaw.writeFile(`test-payloads/${slug}.json`, JSON.stringify(payloads, null, 2));
                  }
                } catch {}
              } else if (step.id === "api-map") {
                // API-first（2026-11-01 Fleming）：解析 LLM 輸出 → api_features 表 + file→API 反向索引
                try {
                  const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
                  if (!cleanJson) throw new Error("AI 回應為空，無法產生 API Map");
                  const apis = _extractJsonArray(content);
                  if (!Array.isArray(apis) || apis.length === 0) throw new Error("API Map 解析失敗（非 JSON array）");
                  const { todayStamp } = await import("../lib/feature-registry.mjs");
                  const prefix = `A${todayStamp()}-`;
                  const now = new Date().toISOString();
                  const seen = new Set();
                  const clean = [];
                  for (const a of apis) {
                    if (!a || typeof a.entry !== "string" || !a.entry.trim()) continue;
                    const entry = a.entry.trim();
                    if (seen.has(entry)) continue; // entry 去重（unique index 同義）
                    seen.add(entry);
                    clean.push({
                      id: `${prefix}${String(clean.length + 1).padStart(3, "0")}`,
                      category: a.category || "uncategorized",
                      entry,
                      name: a.name || entry,
                      description: a.description || null,
                      bizLogic: a.bizLogic || null,
                      processFlow: Array.isArray(a.processFlow) ? a.processFlow : [],
                      validation: Array.isArray(a.validation) ? a.validation : [],
                      dataTouch: Array.isArray(a.dataTouch) ? a.dataTouch : [],
                      aiUnderstanding: "",
                      codeFiles: Array.isArray(a.codeFiles) ? a.codeFiles : [],
                      tests: Array.isArray(a.tests) ? a.tests : [],
                      severity: a.severity || null,
                      custom: {},
                      createdAt: now,
                      updatedAt: now,
                    });
                  }
                  if (!clean.length) throw new Error("API Map 無有效 entry");
                  const { saveApiFeatures, buildFileApiMap } = await import("../lib/coding-db/api-features.repo.mjs");
                  saveApiFeatures(root, clean);
                  writeDoc(root, "fileApiMap", { files: buildFileApiMap(clean), updatedAt: now });
                  cuLog(step.id, `[bulk] Saved ${clean.length} API features + file→API reverse index`);
                } catch (apiErr) {
                  cuLog(step.id, `[bulk] api-map failed: ${apiErr.message}`);
                  sendEvent("step_error", { step: step.id, name: step.name, error: apiErr.message });
                  try { await paaw.setCuStepStatus(step.id, "error", { error: apiErr.message }); } catch {}
                  continue; // 2026-11-03：失敗就結束此步 — 不要再落入下方通用 step_done（曾造成 error+done 雙事件）
                }
              } else if (step.id === "ui-map") {
                // 前端 route-first（2026-11-01 Fleming）：解析 LLM 輸出 → ui_features 表 + marker 檔
                try {
                  const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
                  if (!cleanJson) throw new Error("AI 回應為空，無法產生 UI Map");
                  const uis = _extractJsonArray(content);
                  // 2026-11-02：純後端專案 → 空 UI Map 標 done（同單步版）
                  if (!Array.isArray(uis) || uis.length === 0) {
                    const _bareUi = content.replace(/```(?:json)?/g, "").trim(); // 2026-11-03：剥掉所有 code fence 再比對（content="[]\n```json\n[]\n```" 應判定 backend-only）
                    if (_bareUi === "[]" || content.trim().length < 300 /* 2026-11-03：解析失敗的短回應一律 backend-only（關鍵字/格式列舉不完；真 JSON 截斷必然 >300 字 */ || /沒有|無|no\s+(frontend|ui|route|page)|backend[- ]?only|not found|純後端|後端(專案|項目|服務)/i.test(content)) {
                      const { saveUiFeatures } = await import("../lib/coding-db/ui-features.repo.mjs");
                      saveUiFeatures(root, []);
                      await paaw.writeFile("ui-map.json", "[]");
                      cuLog(step.id, `Saved 0 UI features（backend-only 專案）`);
                      sendEvent("step_done", { step: step.id, name: step.name, size: 2, preview: "[]" });
                      try { await paaw.setCuStepStatus(step.id, "done", { size: 2, summary: "0 UI features（backend-only）" }); } catch {}
                      continue; // 🔴 2026-11-03 真兇修正：原本寫 return — 直接結束整個 bulk CU run，code-intelligence/test-intelligence/error-codes/c4 全部不跑（公司端「api-map 綠燈後全部不動」根因）
                    }
                    throw new Error("UI Map 解析失敗（非 JSON array）");
                  }
                  const { todayStamp } = await import("../lib/feature-registry.mjs");
                  const prefix = `U${todayStamp()}-`;
                  const now = new Date().toISOString();
                  const seen = new Set();
                  const clean = [];
                  for (const u of uis) {
                    if (!u || typeof u.route !== "string" || !u.route.trim()) continue;
                    const route = u.route.trim();
                    if (seen.has(route)) continue;
                    seen.add(route);
                    clean.push({
                      id: `${prefix}${String(clean.length + 1).padStart(3, "0")}`,
                      category: u.category || "uncategorized",
                      route,
                      name: u.name || route,
                      description: u.description || null,
                      uiFlow: Array.isArray(u.uiFlow) ? u.uiFlow : [],
                      components: Array.isArray(u.components) ? u.components : [],
                      stateMgmt: u.stateMgmt || null,
                      apiCalls: Array.isArray(u.apiCalls) ? u.apiCalls : [],
                      codeFiles: Array.isArray(u.codeFiles) ? u.codeFiles : [],
                      backendFiles: Array.isArray(u.backendFiles) ? u.backendFiles : [],
                      tests: Array.isArray(u.tests) ? u.tests : [],
                      severity: u.severity || null,
                      custom: {},
                      createdAt: now,
                      updatedAt: now,
                    });
                  }
                  if (!clean.length) throw new Error("UI Map 無有效 route");
                  const { saveUiFeatures } = await import("../lib/coding-db/ui-features.repo.mjs");
                  saveUiFeatures(root, clean);
                  await paaw.writeFile("ui-map.json", JSON.stringify(clean, null, 2));
                  cuLog(step.id, `[bulk] Saved ${clean.length} UI features`);
                } catch (uiErr) {
                  cuLog(step.id, `[bulk] ui-map failed: ${uiErr.message} (content preview: ${String(content).slice(0, 120)})`);
                  sendEvent("step_error", { step: step.id, name: step.name, error: uiErr.message });
                  try { await paaw.setCuStepStatus(step.id, "error", { error: uiErr.message }); } catch {}
                  continue; // 2026-11-03：同 api-map — 失敗不再落入通用 step_done（error+done 雙事件根因）
                }
              } else if (step.id === "overview") {
                await diffWriteFile(paaw, "PROJECT.md", sanitized);
              }
              cuLog(step.id, `[bulk] wrote file OK (${content.length} chars)`);
            } catch (writeErr) {
              cuLog(step.id, `[bulk] FAILED to write: ${writeErr.message}`);
            }

            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              size: content.length,
              preview: content.slice(0, 200),
            });
            try { await paaw.setCuStepStatus(step.id, "done", { size: content.length }); } catch {}
          } catch (err) {
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
            try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
          }
        }


        // CU 收尾：PROJECT.md 重生成（2026-10-09 Fleming — schema v2：AI 區每次重寫、USER 區絕不覆蓋）
        try {
          const draft = await regenerateProjectMd(root, { callLLM: (b) => callProjectLLM({ ...b, model: b.model || cuModelOverride || undefined }, { caller: "cu-overview", timeoutMs: 120_000, maxRetries: 2 }) });
          try { await paaw.setCuStepStatus("overview", "done", { summary: `${draft.features} features（${draft.aiSource}）` }); } catch {}
          if (draft.written) {
            cuLog("overview", `PROJECT.md ${draft.reason} (${draft.features} features, ${draft.aiSource})`);
            sendEvent("info", { message: `📝 PROJECT.md 已更新（${draft.reason}，${draft.features} features，${draft.aiSource === "llm" ? "AI 生成" : "確定性骨架"}）— User Remarks 區不受影響` });
          }
        } catch (e) { cuLog("overview", `regenerate failed: ${e.message}`); }

        // CU → SQLite：跑完自動 re-import（2026-10-31 Fleming：v2 全進 table，CU 產出即時落庫）
        try {
          const { importCodingDb } = await import("../lib/coding-db/import.mjs");
          const counts = importCodingDb(root);
          const tables = (counts && counts.tables) || counts || {};
          const total = Object.values(tables).reduce((a, b) => a + (Number(b) || 0), 0);
          cuLog("import", `coding-db re-imported: ${total} rows (${Object.entries(tables).map(([k, v]) => k + "=" + v).join(", ")})`);
          sendEvent("info", { message: `💾 已匯入 SQLite：${total} rows（features/tasks/gates…）` });
        } catch (e) { cuLog("import", `coding-db import failed: ${e.message}`); }

        // CU 收尾自動填 ru_info ai_*（2026-10-31 Fleming：CU 產 ru_info）— ai 欄空才填，不覆蓋既有
        try {
          const { readRuInfo, generateRuAiFields } = await import("../lib/coding-db/ru-info.repo.mjs");
          const info = readRuInfo(root);
          if (!info || !info.ai_overview || !info.ai_architecture) {
            let projectCtx = "";
            try { const { readFile: rf } = await import("fs/promises"); projectCtx = "PROJECT.md:\n" + (await rf(join(root, ".paaw", "PROJECT.md"), "utf-8")).slice(0, 6000); } catch {}
            await generateRuAiFields(root, { instruction: "CU 初次掃描完成：請根據 repo 上下文與 PROJECT.md 產生兩個欄位（繁體中文）", extraContext: projectCtx });
            cuLog("ru-info", "ai_overview/ai_architecture 已自動填寫");
            sendEvent("info", { message: "🗂️ 專案資訊卡（ru_info）AI 摘要已自動填寫" });
          }
        } catch (e) { cuLog("ru-info", `ai fields generate failed: ${e.message}`); }

        sendEvent("done", { message: "Code Understanding complete" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }

      res.end();
      return true;
    }

// ── Domain AI — specialized AI per area ──

    // POST /api/coding-project/domain-ai — run a domain AI
    if (url.startsWith("/api/coding-project/domain-ai") && method === "POST") {
      const { domain, prompt, history, model: modelOverride, images } = JSON.parse(await readBody(req));
      const validDomains = ["spec", "test", "bug", "docs", "maintain"];
      if (!validDomains.includes(domain)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Invalid domain: ${domain}. Valid: ${validDomains.join(", ")}` }));
        return true;
      }

      // SSE stream
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event, data) => {
        if (res.writableEnded || res.destroyed) return;
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
      };

      try {
        // Load domain system prompt
        // Priority: .paaw/prompts/{domain}-ai/ → ai-settings/domain-ai/{domain}/ → prompts/{domain}-ai/
        const aiSettingsBase = join(DATA_HOME, "ai-settings", "domain-ai");
        const legacyPromptsBase = join(DATA_HOME, "prompts");
        const domainPromptDir = join(legacyPromptsBase, `${domain}-ai`);
        const aiSettingsDomainDir = join(aiSettingsBase, domain);
        const systemPromptFile = resolve(aiSettingsBase, "system-prompt.md");
        const legacySystemPromptFile = resolve(legacyPromptsBase, "domain-ai-system.md");
        let systemPrompt = "";
        try { systemPrompt = readSync(systemPromptFile, "utf-8"); } catch {
          try { systemPrompt = readSync(legacySystemPromptFile, "utf-8"); } catch {}
        }

        // Load all domain prompts (from ai-settings first, then legacy prompts/)
        let domainContext = "";
        const loadedFiles = new Set();
        try {
          const aiFiles = await readdir(aiSettingsDomainDir);
          for (const f of aiFiles.filter(f => f.endsWith(".md")).sort()) {
            loadedFiles.add(f);
            domainContext += `\n--- ${f} ---\n${readSync(resolve(aiSettingsDomainDir, f), "utf-8")}`;
          }
        } catch {}
        try {
          const domainFiles = await readdir(domainPromptDir);
          for (const f of domainFiles.filter(f => f.endsWith(".md")).sort()) {
            if (!loadedFiles.has(f)) {
              domainContext += `\n--- ${f} ---\n${readSync(resolve(domainPromptDir, f), "utf-8")}`;
            }
          }
        } catch {}

        // Check project-level overrides
        const projectPromptDir = join(root, ".paaw", "prompts", `${domain}-ai`);
        if (existsSync(projectPromptDir)) {
          try {
            const pFiles = await readdir(projectPromptDir);
            for (const f of pFiles.filter(f => f.endsWith(".md")).sort()) {
              domainContext += `\n--- PROJECT OVERRIDE: ${f} ---\n${readSync(resolve(projectPromptDir, f), "utf-8")}`;
            }
          } catch {}
        }

        // Load relevant .paaw/ context based on domain
        let paawContext = "";
        const domainPaawFiles = {
          spec: ["specs/api-contract.md", "specs/error-codes.md", "specs/node-contract.md", "specs/flow-spec.md"],
          test: ["specs/api-contract.md", "test-payloads/all-payloads.json"],
          bug: ["specs/error-codes.md", "DECISIONS.md"],
          docs: ["PROJECT.md", "helpdesk/faq.md", "CHANGELOG.md"],
          maintain: ["DECISIONS.md"],
        };
        for (const f of domainPaawFiles[domain] || []) {
          const content = await paaw.readFile(f);
          if (content) paawContext += `\n=== ${f} ===\n${content.slice(0, 3000)}\n`;
        }

        // Load runbooks for bug
        if (domain === "bug") {
          const rbDir = join(paaw.paawDir, "runbook");
          if (existsSync(rbDir)) {
            try {
              const rbFiles = await readdir(rbDir);
              for (const rf of rbFiles.filter(f => f.endsWith(".md")).slice(0, 10)) {
                const c = await readFile(join(rbDir, rf), "utf-8");
                paawContext += `\n=== runbook/${rf} ===\n${c.slice(0, 1000)}\n`;
              }
            } catch {}
          }
        }

        // Build full system prompt
        const fullSystemPrompt = `${systemPrompt}\n\n## Your Domain: ${domain.toUpperCase()}\n${domainContext}\n\n## Project Knowledge\n${paawContext}`;

        // Build messages
        const messages = [{ role: "system", content: fullSystemPrompt }];
        // Add history
        if (Array.isArray(history)) {
          for (const m of history.slice(-10)) {
            messages.push({ role: m.role, content: m.content });
          }
        }
        messages.push({ role: "user", content: prompt });

        // 👁 2026-09-06：domain AI 貼圖 — 有圖 → vision content array + 自動切 visionModel（沒設定則降級純文字附註）
        let effectiveModel = modelOverride;
        const imgPaths = Array.isArray(images)
          ? [...new Set(images)].filter((p) => typeof p === "string" && /^(paaw-)?uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p)).slice(0, 4)
          : [];
        if (imgPaths.length > 0) {
          try {
            const { imageFileToDataUrl, getVisionModel, visionAvailable } = await import("../lib/vision-content.mjs");
            const { resolveUploadRef } = await import("./uploads.mjs");
            if (visionAvailable(null)) {
              const parts = [{ type: "text", text: prompt }];
              for (const p of imgPaths) {
                const absPath = await resolveUploadRef(p);
                if (!absPath) continue;
                const du = imageFileToDataUrl(absPath);
                if (du) parts.push({ type: "image_url", image_url: { url: du } });
              }
              if (parts.length > 1) {
                messages[messages.length - 1] = { role: "user", content: parts };
                effectiveModel = getVisionModel();
              }
            } else {
              messages[messages.length - 1] = { role: "user", content: `${prompt}\n\n（附了 ${imgPaths.length} 張圖，但未設定 visionModel — 此模型看不到圖）` };
            }
          } catch { /* 讀檔失敗降級純文字 */ }
        }

        // Call LLM
        const result = await callProjectLLM({
          model: effectiveModel || undefined,
          messages,
          temperature: 0.3,
        }, CU_LLM_OPTS); // 對話型 0.3；maxTokens 走 providers.json

        sendEvent("done", { content: result.content || "" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }
      res.end();
      return true;
    }

    // GET /api/coding-project/cu-status — CU step statuses
    if (url.startsWith("/api/coding-project/cu-status") && method === "GET") {
      try {
        // 開專案 lazy re-import（2026-10-31 Fleming：v2 全進 SQLite）— FEATURES.json 有貨且比 db 新就同步
        try {
          const { openCodingDb } = await import("../lib/coding-db/connection.mjs");
          const db = openCodingDb(root);
          const inDb = db.prepare("SELECT COUNT(*) c FROM features WHERE ru=?").get(root.split("/").pop())?.c || 0;
          if (inDb === 0 && existsSync(join(root, ".paaw", "features", "FEATURES.json"))) {
            const { importCodingDb } = await import("../lib/coding-db/import.mjs");
            importCodingDb(root);
          }
        } catch {}
        const cuStatus = await paaw.getCuStatus();
        const steps = cuStatus.steps || {};
        const doneCount = Object.values(steps).filter(s => s?.status === "done").length;
        const errorCount = Object.values(steps).filter(s => s?.status === "error").length;
        const { count: sourceFiles, lastModifiedMs } = countSourceFiles(root);
        const staleSteps = await computeCuStaleness(root, steps, lastModifiedMs);
        // 機械層自動重掃（2026-10-31 Fleming）：純 fs 零 token — 偵測 stale 就背景掃，不勞人按鈕
        const staleMechanical = staleSteps.filter(s => s.mechanical).length;
        let mechanicalAutoRescan = false;
        if (staleMechanical > 0 && !_mechanicalRescanBusy.has(root)) {
          mechanicalAutoRescan = true;
          _mechanicalRescanBusy.add(root);
          (async () => {
            try {
              const { rescanMechanicalLayer } = await import("../lib/cu-mechanical.mjs");
              await rescanMechanicalLayer(root, PAAW_ROOT);
              const { importCodingDb } = await import("../lib/coding-db/import.mjs");
              importCodingDb(root);
            } catch (e) {
              console.warn(`[cu] auto mechanical rescan failed (${root}):`, e.message);
            } finally { _mechanicalRescanBusy.delete(root); }
          })();
        }
        // 智慧層自動增量重跑（2026-11-08 Fleming）：CU/code tree 過期不勞人 — 背景 localhost 自呼 ai-initial（增量：只重跑 stale 步驟）
        const staleSmartNow = staleSteps.filter(s => !s.mechanical && !s.manual).length;
        if (staleSmartNow > 0 && !_smartRerunBusy.has(root) && Date.now() - (_smartRerunLast.get(root) || 0) > 10 * 60_000) {
          _smartRerunBusy.add(root); _smartRerunLast.set(root, Date.now());
          (async () => {
            try {
              // 2026-11-08 追修：背景重跑沿用該 RU 最後指定的 CU model（沒記錄才退 defaultModel）
              let _bgModel = null;
              try { _bgModel = JSON.parse(readSync(join(root, ".paaw", "cu-model.json"), "utf-8"))?.model || null; } catch {}
              console.log(`[cu] 🧠 智慧層自動增量重跑（背景）：${root} stale=${staleSmartNow} model=${_bgModel || "(default)"}`);
              const { Agent } = await import("undici");
              const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
              const r = await fetch(`http://127.0.0.1:${PORT}/api/coding-project/ai-initial?path=${encodeURIComponent(root)}`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: _bgModel || undefined }), dispatcher,
              });
              if (r.body) { const rd = r.body.getReader(); while (true) { const { done } = await rd.read(); if (done) break; } }
              const { importCodingDb } = await import("../lib/coding-db/import.mjs");
              importCodingDb(root);
              console.log(`[cu] 🧠 智慧層自動重跑完成：${root}`);
            } catch (e) {
              console.warn(`[cu] smart auto rerun failed (${root}):`, e.message);
            } finally { _smartRerunBusy.delete(root); }
          })();
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        // CU lifecycle 原料：前端據此算 phase（missing/no-code/ready/partial/done/stale）
        res.end(JSON.stringify({
          ...cuStatus,
          hasPaaw: existsSync(join(root, ".paaw")),
          sourceFiles,
          doneCount,
          errorCount,
          codeLastModified: lastModifiedMs > 0 ? new Date(lastModifiedMs).toISOString() : null,
          staleSteps,
          staleCount: staleSteps.length,
          mechanicalAutoRescan,
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // POST /api/coding-project/cu-rescan-mechanical — 手動重掃機械層（免 token 秒級）
    // 智能層（LLM 生成的文檔）永遠不在此自動重跑 — 過期時 UI 提醒人決定
    if (url.startsWith("/api/coding-project/cu-rescan-mechanical") && method === "POST") {
      try {
        await paaw.init(); // 確保 .paaw 存在（無 .paaw 時先建骨架）
        const result = await rescanMechanicalLayer(root, PAAW_ROOT);
        // 重掃成功 → 直接重建 Release Unit Model（不等 read-path self-heal；
        // 否則 RU 樹 stale badge 停在舊狀態，體感「按了沒發生任何事」2026-08-22）
        let ruModel = null;
        try {
          const { buildReleaseUnitModel } = await import("../lib/release-unit/model.mjs");
          ruModel = await buildReleaseUnitModel(root);
          result.ruModel = { ok: true, headSha: ruModel.headSha, apis: ruModel.summary?.apis, features: ruModel.summary?.features };
          // Content-addressed rescan report：哪些 table 實質變更 / model 是否重寫（2026-08-22）
          const rs = ruModel._rescan;
          if (rs) {
            const totals = rs.diff
              ? Object.entries(rs.diff).reduce((acc, [t, d]) => {
                  acc[t] = d.added + d.removed + d.modified;
                  return acc;
                }, {})
              : null;
            result.ruDiff = { written: rs.written, changed: rs.changed, headChanged: rs.headChanged, tables: rs.diff, totals };
          }
        } catch (e) {
          result.ruModel = { ok: false, error: e.message };
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    if (url.startsWith("/api/coding-project/prompts") && method === "GET" && !url.includes("/prompts/")) {
      const promptsDir = BUNDLED_PROMPTS_DIR; // 2026-11-02：prompt 內建於 packages（隨部署走）
      const projectPromptsDir = join(root, ".paaw", "prompts", "code-understanding");
      try {
        const files = existsSync(promptsDir) ? await readdir(promptsDir) : [];
        const prompts = [];
        for (const f of files.filter(f => f.endsWith(".md")).sort()) {
          const content = readSync(resolve(promptsDir, f), "utf-8");
          const hasOverride = existsSync(resolve(projectPromptsDir, f));
          let overrideContent = null;
          if (hasOverride) {
            try { overrideContent = readSync(resolve(projectPromptsDir, f), "utf-8"); } catch {}
          }
          prompts.push({
            filename: f,
            name: f.replace(/\.md$/, ""),
            defaultContent: content,
            customContent: overrideContent,
            activeContent: overrideContent || content,
            hasOverride,
            size: (overrideContent || content).length,
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(prompts));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // GET /api/coding-project/prompts/:filename — read specific prompt
    if (url.match(/\/api\/coding-project\/prompts\/[\w-]+\.md$/) && method === "GET") {
      const filename = url.split("/prompts/").pop();
      const projectPromptsDir = join(root, ".paaw", "prompts", "code-understanding");
      const projectFile = resolve(projectPromptsDir, filename);
      if (existsSync(projectFile)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ filename, content: readSync(projectFile, "utf-8"), source: "project" }));
      } else {
        const defaultDir = join(DATA_HOME, "prompts", "code-understanding");
        const defaultFile = resolve(defaultDir, filename);
        if (existsSync(defaultFile)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ filename, content: readSync(defaultFile, "utf-8"), source: "default" }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Prompt not found" }));
        }
      }
      return true;
    }

    // PUT /api/coding-project/prompts/:filename — save custom prompt
    if (url.match(/\/api\/coding-project\/prompts\/[\w-]+\.md$/) && method === "PUT") {
      const filename = url.split("/prompts/").pop();
      const { content } = JSON.parse(await readBody(req));
      if (!content) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing content" }));
        return true;
      }
      const projectPromptsDir = join(root, ".paaw", "prompts", "code-understanding");
      await mkdir(projectPromptsDir, { recursive: true });
      await writeFile(resolve(projectPromptsDir, filename), content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, filename, source: "project" }));
      return true;
    }

    // DELETE /api/coding-project/prompts/:filename — remove custom prompt (revert to default)
    if (url.match(/\/api\/coding-project\/prompts\/[\w-]+\.md$/) && method === "DELETE") {
      const filename = url.split("/prompts/").pop();
      const projectPromptsDir = join(root, ".paaw", "prompts", "code-understanding");
      const projectFile = resolve(projectPromptsDir, filename);
      if (existsSync(projectFile)) {
        try { await unlink(projectFile); } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, filename, reverted: true }));
      return true;
    }

  } catch (err) {
    console.error("[project route] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
    return true;
  }

  return false;
}

// ── Read request body ──

// ── readBody imported from shared.mjs ──

// ── Generate Standards from Codebase ──
// generateStandardsFromCodebase 已移除（2026-09-06：standards dir 系統退役 — Fleming）
