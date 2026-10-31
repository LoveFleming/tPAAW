/**
 * coding-db API — Phase B MVP
 *
 *   GET /api/coding-release/evidence?cwd=        — release 證據包（AI 出貨前一次拿齊）
 *   GET /api/coding-db/status?cwd=               — 各表 row count（健康檢查）
 *   GET /api/coding-db/query?cwd=&table=&limit=  — 泛用白名單查詢（agent 走 API 讀結構化資料）
 *   GET /api/coding-db/task/:taskId?cwd=         — 單 task 完整時間線（dispatch/qa/notes）
 *   GET /api/coding-db/feature/:featureId?cwd=   — 單 feature + 檔案/API/tests
 *   GET /api/coding-db/conversations?cwd=&agent= — agent 對話 sessions
 *
 * 設計原則（Fleming 2026-10-31）：agent 走 API tool 讀結構化資料，取代整包讀程式碼。
 */
import { resolve } from "path";
import { fileURLToPath } from "url";
import { readBody } from "./shared.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PAAW_ROOT = resolve(__dirname, "../../../..");

const QUERY_TABLES = new Set([
  "tasks", "task_notes", "features", "feature_files", "feature_apis", "feature_tests", "feature_tags",
  "gates", "handover", "issues", "release_requests", "conversation_sessions",
  "dispatch_log", "action_log", "qa_results", "exec_approvals", "kv", "ru_info",
]);

const LIMIT_MAX = 500;

export default async function codingDbRoute(req, res) {
  const url = req.url || "";
  const method = req.method || "GET";
  const q = Object.fromEntries(new URL(url, "http://x").searchParams.entries());

  const _json = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  // ── helpers ──
  // 與 coding.mjs 同規：localhost 單人工具，cwd 直接 resolve（@paaw = 全域）
  const root = async () => {
    if (q.cwd === "@paaw" || !q.cwd) return PAAW_ROOT;
    return resolve(q.cwd);
  };

  const mod = () => import("../lib/coding-db/index.mjs");

  // GET /api/coding-release/evidence?cwd=
  if (url.startsWith("/api/coding-release/evidence") && method === "GET") {
    try {
      const ruRoot = await root();
      const { openCodingDb, taskHistory } = await mod();
      const db = openCodingDb(ruRoot);
      const ru = ruRoot.split("/").pop();

      const gates = db.prepare("SELECT gate, state, updated_at FROM gates WHERE ru=?").all(ru);
      const openTasks = db.prepare("SELECT id, title, status, priority, assignee, updated_at FROM tasks WHERE ru=? AND status NOT IN ('close','ignore') ORDER BY updated_at DESC LIMIT 50").all(ru);
      const recentClosed = db.prepare("SELECT id, title, updated_at FROM tasks WHERE ru=? AND status='close' ORDER BY updated_at DESC LIMIT 20").all(ru);
      const qaStats = db.prepare(`SELECT verdict, COUNT(*) c FROM qa_results WHERE ru=? GROUP BY verdict`).all(ru);
      const qaTotal = qaStats.reduce((s, x) => s + x.c, 0);
      const qaPass = (qaStats.find(x => x.verdict === "pass")?.c || 0);
      const rr = db.prepare("SELECT id, payload, state, created_at FROM release_requests WHERE ru=? ORDER BY created_at DESC LIMIT 5").all(ru)
        .map(r => ({ id: r.id, state: r.state, createdAt: r.created_at, checklist: JSON.parse(r.payload || "{}")?.checklist ?? null }));
      const ho = db.prepare("SELECT kind, updated_at FROM handover WHERE ru=?").all(ru);
      const lastDispatch = db.prepare("SELECT ts, agent_id, task_id, event FROM dispatch_log WHERE ru=? ORDER BY id DESC LIMIT 10").all(ru);
      const untrackedTasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE ru=? AND (feature_id IS NULL OR feature_id='')").get(ru).c;
      const featuresTotal = db.prepare("SELECT COUNT(*) c FROM features WHERE ru=?").get(ru).c;

      _json(200, {
        ru,
        generatedAt: new Date().toISOString(),
        summary: {
          openTasks: openTasks.length,
          closedRecent: recentClosed.length,
          features: featuresTotal,
          tasksWithoutFeature: untrackedTasks,
          qa: { total: qaTotal, pass: qaPass, passRate: qaTotal ? Math.round(qaPass / qaTotal * 100) + "%" : null },
        },
        gates, openTasks, recentClosed, releaseRequests: rr, handover: ho, lastDispatch,
      });
    } catch (err) {
      _json(500, { error: err.message });
    }
    return true;
  }

  // ── ru_info：一 RU 一行專案基本資訊（Fleming 2026-10-31 極簡版）──
  // GET /api/coding-db/ru-info?cwd=
  if (url.startsWith("/api/coding-db/ru-info") && !url.includes("/ru-info/") && method === "GET") {
    try {
      const ruRoot = await root();
      const { readRuInfo, upsertRuInfo } = await import("../lib/coding-db/ru-info.repo.mjs");
      let info = readRuInfo(ruRoot);
      if (!info) info = upsertRuInfo(ruRoot, {}); // 沒有就建（舊 RU 首次開卡）
      _json(200, info);
    } catch (err) { _json(500, { error: err.message }); }
    return true;
  }

  // PUT /api/coding-db/ru-info?cwd= — 人寫欄位（name / description）
  if (url.startsWith("/api/coding-db/ru-info") && !url.includes("/ru-info/") && method === "PUT") {
    try {
      const ruRoot = await root();
      const body = JSON.parse(await readBody(req) || "{}");
      const { saveRuInfoFields } = await import("../lib/coding-db/ru-info.repo.mjs");
      _json(200, saveRuInfoFields(ruRoot, { name: body.name, description: body.description }));
    } catch (err) { _json(400, { error: err.message }); }
    return true;
  }

  // POST /api/coding-db/ru-info/ai-adjust?cwd= — AI 輔助調整 ai_* 欄（只碰 ai_*，蓋不到事實欄）
  if (url.startsWith("/api/coding-db/ru-info/ai-adjust") && method === "POST") {
    try {
      const ruRoot = await root();
      const body = JSON.parse(await readBody(req) || "{}");
      const instruction = String(body.instruction || "").trim();
      if (!instruction) { _json(400, { error: "Missing instruction" }); return true; }
      const { generateRuAiFields } = await import("../lib/coding-db/ru-info.repo.mjs");
      const updated = await generateRuAiFields(ruRoot, { instruction });
      _json(200, updated);
    } catch (err) { _json(500, { error: err.message }); }
    return true;
  }

  // GET /api/coding-db/status?cwd=
  if (url.startsWith("/api/coding-db/status") && method === "GET") {
    try {
      const ruRoot = await root();
      const { openCodingDb } = await mod();
      const db = openCodingDb(ruRoot);
      const tables = {};
      for (const t of QUERY_TABLES) {
        try { tables[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { tables[t] = -1; }
      }
      _json(200, { ru: ruRoot.split("/").pop(), tables });
    } catch (err) {
      _json(500, { error: err.message });
    }
    return true;
  }

  // GET /api/coding-db/query?cwd=&table=&limit=&where=(簡單欄位=值)
  const qm = url.match(/^\/api\/coding-db\/query(?:\?|$)/);
  if (qm && method === "GET") {
    if (!QUERY_TABLES.has(q.table)) {
      _json(400, { error: `Unknown table: ${q.table}`, allowed: [...QUERY_TABLES] });
      return true;
    }
    const limit = Math.min(parseInt(q.limit || "50", 10) || 50, LIMIT_MAX);
    try {
      const ruRoot = await root();
      const { openCodingDb } = await mod();
      const db = openCodingDb(ruRoot);
      let sql = `SELECT * FROM ${q.table}`;
      const args = [];
      const cols = {};
      for (const [k, v] of Object.entries(q)) {
        if (["cwd", "table", "limit"].includes(k)) continue;
        cols[k] = v;
      }
      const conds = Object.entries(cols).map(([c, v]) => {
        args.push(v);
        return `${c} = ?`;
      });
      if (conds.length) sql += " WHERE " + conds.join(" AND ");
      sql += " ORDER BY rowid DESC LIMIT ?";
      args.push(limit);
      const rows = db.prepare(sql).all(...args);
      _json(200, { table: q.table, count: rows.length, rows });
    } catch (err) {
      _json(400, { error: err.message });
    }
    return true;
  }

  // GET /api/coding-db/task/:taskId?cwd=
  const tm = url.match(/^\/api\/coding-db\/task\/([^/?]+?)(?:\?|$)/);
  if (tm && method === "GET") {
    try {
      const ruRoot = await root();
      const { taskHistory } = await mod();
      const r = taskHistory(ruRoot, decodeURIComponent(tm[1]));
      if (!r.task) { _json(404, { error: "task not found" }); return true; }
      _json(200, r);
    } catch (err) {
      _json(500, { error: err.message });
    }
    return true;
  }

  // GET /api/coding-db/feature/:featureId?cwd=
  const fm = url.match(/^\/api\/coding-db\/feature\/([^/?]+?)(?:\?|$)/);
  if (fm && method === "GET") {
    try {
      const ruRoot = await root();
      const { openCodingDb } = await mod();
      const db = openCodingDb(ruRoot);
      const fid = decodeURIComponent(fm[1]);
      const feature = db.prepare("SELECT * FROM features WHERE id=?").get(fid);
      if (!feature) { _json(404, { error: "feature not found" }); return true; }
      const files = db.prepare("SELECT file_path FROM feature_files WHERE feature_id=?").all(fid).map(r => r.file_path);
      const apis = db.prepare("SELECT method, path, file_path FROM feature_apis WHERE feature_id=?").all(fid);
      const tests = db.prepare("SELECT test_file FROM feature_tests WHERE feature_id=?").all(fid).map(r => r.test_file);
      const tasks = db.prepare("SELECT id, title, status, updated_at FROM tasks WHERE feature_id=? ORDER BY updated_at DESC LIMIT 30").all(fid);
      _json(200, { feature, files, apis, tests, tasks });
    } catch (err) {
      _json(500, { error: err.message });
    }
    return true;
  }

  // GET /api/coding-db/conversations?cwd=&agent=
  const cm = url.match(/^\/api\/coding-db\/conversations(?:\?|$)/);
  if (cm && method === "GET") {
    try {
      const ruRoot = await root();
      const { readConversationAgents, readConversationSessions } = await mod();
      if (q.agent) {
        _json(200, { agent: q.agent, sessions: readConversationSessions(ruRoot, q.agent) });
      } else {
        _json(200, { agents: readConversationAgents(ruRoot) });
      }
    } catch (err) {
      _json(500, { error: err.message });
    }
    return true;
  }

  return false;
}
