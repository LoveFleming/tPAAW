/**
 * Quiz Session — 模擬考組卷引擎 P1（2026-09-26，ADR-004）
 *
 * Routes:
 *   GET  /api/learning/quiz/scope-options — curriculum 樹 + 各節點可用題數（只計 PUBLISHED）+ CAP 各科可用 MC 題數
 *   POST /api/learning/quiz               — 建卷（mode=unit|cap；seeded shuffle 以 exam id 為種子；定稿寫快照）
 *   GET  /api/learning/quiz/:id           — 讀卷（讀 quiz_item 快照，恆一致）
 *
 * P2（TASK-010，2026-09-26）：
 *   POST  /api/learning/quiz/:id/start     — 起考（記 started_at 起算限時，status→ongoing；重複 start=續考不重置）
 *   PATCH /api/learning/quiz/:id/answer    — 逐題存 draft（不判定，可斷線續存）
 *   POST  /api/learning/quiz/:id/submit    — SQL 批改（is_correct 對照 correct_choice）+ learner_attempt 回寫
 *                                           （正確/錯誤都寫；錯題含未作答自動排入 1/3/7 天複習佇列）+ overtime 標記
 *   GET  /api/learning/quiz/:id/report     — ongoing 回進度（絕不含答案）；finished 回分數/section 答對率/
 *                                           單元掌握度（紅<50/黃<80/綠其他）/逐題明細（我的答案 vs 正確答案 vs provider）
 *   GET  /api/learning/quiz                — 歷史清單
 *   DELETE /api/learning/quiz/:id          — 僅 draft/abandoned 可刪（finished 歷史考卷永久留存，ADR-004）
 *
 * 鐵律（ADR-004）：
 *   - 題目快照制：建卷當下題面完整快照進 quiz_item.snapshot_json；correct 只存 DB（correct_choice 欄），
 *     作答期間任何 API 回應「絕不」包含 correct_choice —— 回應組裝只走明確欄位白名單，不 spread DB row。
 *     答案相關欄位比照（TASK-013）：snapshot.explanationMd 直述正解，作答期間由 snapshotForClient 白名單剔除，收卷後開放。
 *   - 出題只抽 status='PUBLISHED'；mode=cap 只出有 correct_choice 的 MC 題（NON_MC / concept-quiz 鏡像列不出）。
 *   - seeded shuffle 以 exam id 為種子（mulberry32 + FNV-1a）→ 同 id 恆同序；定稿後由 DB 快照保證恆一致。
 *   - schema idempotent（同 exam-vault.mjs 慣例）：CREATE TABLE IF NOT EXISTS + ALTER 前先 PRAGMA 檢查；不動 seed.mjs。
 *
 * correct_choice 儲存約定：CAP 題存字母（'A'~'D'）；concept 題存選項索引字串（'0'~'3'，0-based，
 * 與 learning-practice submit 對 cq: 題「Number(answer) === correct」的判讀一致）。
 */

import { existsSync } from "fs";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";
import { PAAW_ROOT, readBody } from "./shared.mjs";

const DB_PATH = join(PAAW_ROOT, "data", "learning.db");

/** 科目顯示名（DB 中文）→ URL key（同 learning-practice SUBJECT_KEYS） */
const SUBJECT_KEYS = {
  "數學": "math", "國文": "chinese", "英文": "english", "歷史": "history",
  "地理": "geography", "公民": "civic", "地科": "earth-science",
  "理化": "physics-chemistry", "生物": "biology",
};
const SUBJECT_NAMES = Object.fromEntries(Object.entries(SUBJECT_KEYS).map(([n, k]) => [k, n]));

let _db = null;
function db() {
  if (_db) return _db;
  if (!existsSync(DB_PATH)) {
    throw Object.assign(new Error("learning.db not found — run scripts/seed.mjs first"), { status: 503 });
  }
  _db = new DatabaseSync(DB_PATH);
  ensureQuizSchema(_db);
  return _db;
}

/** SQLite 無 ADD COLUMN IF NOT EXISTS — 先 PRAGMA 檢查再 ALTER（冪等） */
function ensureColumns(dbx, table, cols) {
  const have = new Set(dbx.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [col, ddl] of Object.entries(cols)) {
    if (!have.has(col)) dbx.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function ensureQuizSchema(dbx) {
  // ② 舊表補欄（ADR-004 provenance 體系）
  ensureColumns(dbx, "concept_question", {
    origin_type: "origin_type TEXT DEFAULT 'builtin'",
    origin_ref: "origin_ref TEXT",
    status: "status TEXT DEFAULT 'PUBLISHED'",
  });
  ensureColumns(dbx, "question", {
    explanation_md: "explanation_md TEXT", // CAP AI 解說用（背景批次補全，標示於 origin）
  });
  // P2（TASK-010）：收卷時記逾時標記（逾時仍收卷，僅標記不拒收）
  ensureColumns(dbx, "quiz_session", { overtime: "overtime INTEGER" });

  // ① 模擬考三表 + ③ question_flag
  dbx.exec(`
    CREATE TABLE IF NOT EXISTS quiz_session (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('unit','cap','remedial')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ongoing','finished','abandoned')),
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      duration_limit_sec INTEGER
    );
    CREATE TABLE IF NOT EXISTS quiz_section (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id TEXT NOT NULL REFERENCES quiz_session(id),
      seq INTEGER NOT NULL,
      subject TEXT,
      scope_json TEXT,
      question_count INTEGER NOT NULL DEFAULT 0,
      duration_limit_sec INTEGER
    );
    CREATE TABLE IF NOT EXISTS quiz_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id TEXT NOT NULL REFERENCES quiz_session(id),
      section_id INTEGER NOT NULL REFERENCES quiz_section(id),
      seq INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      correct_choice TEXT,
      answer TEXT,
      answered_at TEXT,
      duration_ms INTEGER,
      is_correct INTEGER,
      pass_rate REAL
    );
    CREATE TABLE IF NOT EXISTS question_flag (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_ref TEXT NOT NULL,
      reason_category TEXT,
      reason_text TEXT,
      flagged_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_section_exam ON quiz_section(exam_id);
    CREATE INDEX IF NOT EXISTS idx_quiz_item_exam ON quiz_item(exam_id);
    CREATE INDEX IF NOT EXISTS idx_quiz_item_section ON quiz_item(section_id);
    CREATE INDEX IF NOT EXISTS idx_question_flag_ref ON question_flag(question_ref);
  `);
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("invalid JSON body"), { status: 400 }); }
}
const now = () => new Date().toISOString();

// ── Seeded shuffle（mulberry32 + FNV-1a；同 examId → 恆同排列）──
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** @template T @param {T[]} arr @param {string} examId @returns {T[]} */
function seededShuffle(arr, examId) {
  const out = [...arr];
  const rnd = mulberry32(fnv1a(examId));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const newExamId = () =>
  `quiz-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6)}`;

/** 題數夾 1~50；限時夾 60~14400 秒（不吃就存 null） */
const clampCount = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(50, Math.max(1, Math.round(n))) : dflt;
};
const clampDuration = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(14400, Math.max(60, Math.round(n))) : null;
};

// ── 快照組裝（只放題面 + 出處 metadata，絕不含答案）──
function capSnapshot(q) {
  let crops = [];
  try { crops = JSON.parse(q.crops || "[]"); } catch { crops = []; }
  return {
    provider: q.provider,
    questionKey: q.question_key,
    questionMd: null, // CAP 題面在 crops 圖裡（無文字題面）
    options: [],
    crops,
    cropUrls: crops.map((p) => `/api/learning/crop?p=${encodeURIComponent(p)}`),
    yearRoc: q.year_roc,
    questionNumber: q.question_number,
    perfCode: q.perf_code,
    contentCode: q.content_code,
    grade: q.grade,
    passRate: q.pass_rate,
    bookletPage: q.booklet_page,
    subject: q.subject,
    unitName: null, // CAP 題尚未對接課綱單元（ADR-004 背景調查：official_content_code 全空）
  };
}

function conceptSnapshot(cq) {
  let options = [];
  try { options = JSON.parse(cq.options_json || "[]"); } catch { options = []; }
  return {
    provider: "concept-quiz",
    questionKey: `cq:${cq.id}`,
    conceptQuestionId: cq.id,
    questionMd: cq.question_md,
    options,
    // 解說常直述正解（QA qr-20260926-043232 實證 cq:1760）→ 仍入快照供考後檢討，
    // 但作答期間一律由 snapshotForClient 白名單剔除，絕不隨 create/start/GET 下發（TASK-013）
    explanationMd: cq.explanation_md,
    crops: [],
    cropUrls: [],
    yearRoc: null,
    questionNumber: cq.seq,
    perfCode: null,
    contentCode: null,
    grade: null,
    passRate: null,
    bookletPage: null,
    subject: cq.subject_name,
    unitName: cq.unit_name,
    conceptName: cq.concept_name,
    originType: cq.origin_type || "builtin",
    originRef: cq.origin_ref || null,
  };
}

// ── 出題池 ──
/** unit 模式：指定 curriculum_unit 下的 concept_question（PUBLISHED only） */
function unitPool(unitId) {
  return db().prepare(`
    SELECT cq.*, cc.name AS concept_name, cc.seq AS concept_seq,
           u.name AS unit_name, u.subject AS subject_name
    FROM concept_question cq
    JOIN curriculum_concept cc ON cc.id = cq.concept_id
    JOIN curriculum_unit u ON u.id = cc.unit_id
    WHERE cc.unit_id = ? AND cq.status = 'PUBLISHED'
    ORDER BY cq.id
  `).all(unitId);
}

/** cap 模式：有 correct_choice 的 MC 題（排除 concept-quiz 鏡像列與 NON_MC），PUBLISHED only */
function capPool(subjectKey) {
  return db().prepare(`
    SELECT * FROM question
    WHERE LOWER(subject) = ?
      AND correct_choice IS NOT NULL
      AND status = 'PUBLISHED'
      AND provider != 'concept-quiz'
    ORDER BY question_key
  `).all(String(subjectKey).toLowerCase());
}

// ── 回應組裝（白名單欄位 — 絕不帶 correct_choice / answer / is_correct）──
function parseSnapshot(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
/**
 * 客戶端快照（TASK-013 MAJOR）— 白名單「複製」，絕不用刪除法（防未來快照加欄位自動漏出）：
 *   作答期間（status != finished）只放題面 + 出處 metadata；explanationMd 直述正解，收卷前一律剔除。
 *   finished 後原樣回（考後檢討用；report items[].explanationMd 同一開放時點）。
 */
const CLIENT_SNAPSHOT_FIELDS = [
  "provider", "questionKey", "conceptQuestionId", "questionMd", "options",
  "crops", "cropUrls", "yearRoc", "questionNumber", "perfCode", "contentCode",
  "grade", "passRate", "bookletPage", "subject", "unitName", "conceptName",
  "originType", "originRef",
];
function snapshotForClient(snapshot, status) {
  if (status === "finished") return snapshot; // 已收卷 — 解說開放供考後檢討
  const out = {};
  for (const k of CLIENT_SNAPSHOT_FIELDS) out[k] = snapshot?.[k];
  return out;
}

function examResponse(sessionRow, sectionRows, itemRows) {
  return {
    exam: {
      id: sessionRow.id,
      title: sessionRow.title,
      mode: sessionRow.mode,
      status: sessionRow.status,
      createdAt: sessionRow.created_at,
      startedAt: sessionRow.started_at,
      finishedAt: sessionRow.finished_at,
      durationLimitSec: sessionRow.duration_limit_sec,
    },
    sections: sectionRows.map((sec) => ({
      seq: sec.seq,
      subject: sec.subject,
      scope: parseSnapshot(sec.scope_json),
      questionCount: sec.question_count,
      durationLimitSec: sec.duration_limit_sec,
      questions: itemRows
        .filter((it) => it.section_id === sec.id)
        .map((it) => ({
          seq: it.seq,
          questionKey: it.question_key,
          // 白名單快照 — 作答期間剔除 explanationMd 等答案直述欄位（TASK-013）
          snapshot: snapshotForClient(parseSnapshot(it.snapshot_json), sessionRow.status),
        })),
    })),
  };
}


// ══════════ P2 helpers（TASK-010，ADR-004）══════════

/** 出處標籤（provider 五值體系，ADR-004） */
const PROVIDER_LABELS = {
  CAP: "會考考古題",
  "concept-quiz": "單元概念題",
  "ai-variant": "AI 衍生題",
  web: "網路收藏題",
  "school-exam": "校內考題",
};

/**
 * 批改（deterministic SQL 對照，無 LLM）— 與 learning-practice submit 同判讀：
 *   cq: 題（concept-quiz）correct_choice 存 0-based 選項索引字串 → Number 比對
 *   CAP 題存 'A'~'D' → 字串 trim+upperCase 比對
 *   未作答（answer NULL / 空字串）→ is_correct = 0
 */
const normAnswer = (s) => String(s ?? "").trim().toUpperCase();
function gradeItem(it) {
  if (it.answer == null || String(it.answer).trim() === "") return 0;
  return it.question_key.startsWith("cq:")
    ? (Number(it.answer) === Number(it.correct_choice) ? 1 : 0)
    : (normAnswer(it.answer) === normAnswer(it.correct_choice) ? 1 : 0);
}

/** 單元掌握度分檔：紅 <50%、黃 <80%、綠 其他（ADR-004 v1 落點） */
function masteryLevel(pct) {
  return pct < 50 ? "red" : pct < 80 ? "yellow" : "green";
}

const pct1 = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

export default async function quizSessionRoute(req, res) {
  const url = req.url || "";
  const path = url.split("?")[0];
  if (path !== "/api/learning/quiz" && !path.startsWith("/api/learning/quiz/")) return false;

  try {
    const seg = path.split("/").filter(Boolean); // ['api', 'learning', 'quiz', ...]
    const method = req.method;

    // ── GET /api/learning/quiz/scope-options ──
    if (method === "GET" && seg[3] === "scope-options") {
      const rows = db().prepare(`
        SELECT u.id AS unit_id, u.subject, u.grade, u.semester, u.seq AS unit_seq, u.name AS unit_name,
               cc.id AS concept_id, cc.seq AS concept_seq, cc.name AS concept_name,
               COUNT(cq.id) AS q_count
        FROM curriculum_unit u
        LEFT JOIN curriculum_concept cc ON cc.unit_id = u.id
        LEFT JOIN concept_question cq ON cq.concept_id = cc.id AND cq.status = 'PUBLISHED'
        GROUP BY u.id, cc.id
        ORDER BY u.subject, u.grade, u.semester, u.seq, cc.seq
      `).all();

      const bySubject = new Map();
      for (const r of rows) {
        if (!bySubject.has(r.subject)) {
          bySubject.set(r.subject, {
            key: SUBJECT_KEYS[r.subject] || r.subject,
            name: r.subject,
            unitCount: 0,
            availableQuestions: 0,
            units: [],
          });
        }
        const subj = bySubject.get(r.subject);
        let unit = subj.units.find((u) => u.id === r.unit_id);
        if (!unit) {
          unit = {
            id: r.unit_id, grade: r.grade, semester: r.semester, seq: r.unit_seq, name: r.unit_name,
            availableQuestions: 0, concepts: [],
          };
          subj.units.push(unit);
          subj.unitCount += 1;
        }
        if (r.concept_id != null) {
          unit.concepts.push({ id: r.concept_id, seq: r.concept_seq, name: r.concept_name, availableQuestions: r.q_count });
          unit.availableQuestions += r.q_count;
          subj.availableQuestions += r.q_count;
        }
      }

      const capPoolCounts = db().prepare(`
        SELECT LOWER(subject) AS key, COUNT(*) AS n
        FROM question
        WHERE correct_choice IS NOT NULL AND status = 'PUBLISHED' AND provider != 'concept-quiz'
        GROUP BY LOWER(subject)
      `).all().map((r) => ({ key: r.key, name: SUBJECT_NAMES[r.key] || r.key, availableQuestions: r.n }));

      return json(res, 200, { subjects: [...bySubject.values()], capPool: capPoolCounts }), true;
    }

    // ── POST /api/learning/quiz — 建卷 ──
    if (method === "POST" && seg.length === 3) {
      const body = await readJson(req);
      const mode = String(body.mode || "").trim();
      if (mode !== "unit" && mode !== "cap") {
        return json(res, 400, { error: "mode 必須是 unit 或 cap（remedial 之後開放）" }), true;
      }

      let pool, sectionSubject, scope, defaultCount, title;
      if (mode === "unit") {
        const unitId = Number(body.unitId);
        if (!Number.isInteger(unitId) || unitId <= 0) {
          return json(res, 400, { error: "unitId 必須是正整數" }), true;
        }
        const unit = db().prepare(
          "SELECT id, subject, grade, semester, seq, name FROM curriculum_unit WHERE id = ?"
        ).get(unitId);
        if (!unit) return json(res, 404, { error: `curriculum_unit ${unitId} 不存在` }), true;
        pool = unitPool(unitId);
        if (!pool.length) return json(res, 400, { error: `單元「${unit.name}」沒有可用的 PUBLISHED 題目` }), true;
        sectionSubject = unit.subject;
        scope = {
          mode: "unit", unitId: unit.id, unitName: unit.name,
          subject: unit.subject, subjectKey: SUBJECT_KEYS[unit.subject] || null,
          grade: unit.grade, semester: unit.semester,
        };
        defaultCount = 10;
        title = String(body.title || "").trim() || `${unit.subject}｜${unit.name} 單元測驗`;
      } else {
        const subjectKey = String(body.subject || "").trim().toLowerCase();
        if (!subjectKey) return json(res, 400, { error: "cap 模式必須指定 subject（例：math）" }), true;
        pool = capPool(subjectKey);
        if (!pool.length) {
          return json(res, 400, { error: `科目 ${subjectKey} 沒有可用的 CAP MC 題（需有 correct_choice 且 PUBLISHED）` }), true;
        }
        sectionSubject = SUBJECT_NAMES[subjectKey] || subjectKey;
        scope = { mode: "cap", subject: subjectKey };
        defaultCount = 25;
        title = String(body.title || "").trim() || `會考模擬・${sectionSubject}`;
      }

      const requested = clampCount(body.questionCount, defaultCount);
      const duration = clampDuration(body.durationLimitSec);
      const examId = newExamId();
      const picked = seededShuffle(pool, examId).slice(0, Math.min(requested, pool.length));

      const dbx = db();
      dbx.exec("BEGIN");
      try {
        dbx.prepare(`
          INSERT INTO quiz_session (id, title, mode, status, created_at, duration_limit_sec)
          VALUES (?, ?, ?, 'draft', ?, ?)
        `).run(examId, title, mode, now(), duration);

        const sectionId = Number(dbx.prepare(`
          INSERT INTO quiz_section (exam_id, seq, subject, scope_json, question_count, duration_limit_sec)
          VALUES (?, 1, ?, ?, ?, ?)
        `).run(examId, sectionSubject, JSON.stringify(scope), picked.length, duration).lastInsertRowid);

        const insItem = dbx.prepare(`
          INSERT INTO quiz_item (exam_id, section_id, seq, question_key, snapshot_json, correct_choice, pass_rate)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        picked.forEach((q, i) => {
          const snapshot = mode === "unit" ? conceptSnapshot(q) : capSnapshot(q);
          const correct = mode === "unit" ? String(q.correct) : q.correct_choice;
          insItem.run(examId, sectionId, i + 1, snapshot.questionKey, JSON.stringify(snapshot), correct, q.pass_rate ?? null);
        });
        dbx.exec("COMMIT");
      } catch (err) {
        dbx.exec("ROLLBACK");
        console.error("[quiz-session] build failed:", { examId, mode, error: err.message });
        throw err;
      }

      const session = dbx.prepare("SELECT * FROM quiz_session WHERE id = ?").get(examId);
      const section = dbx.prepare("SELECT * FROM quiz_section WHERE exam_id = ? ORDER BY seq").all(examId);
      const items = dbx.prepare("SELECT id, section_id, seq, question_key, snapshot_json FROM quiz_item WHERE exam_id = ? ORDER BY seq").all(examId);
      return json(res, 201, examResponse(session, section, items)), true;
    }

    // ══════════ P2（TASK-010，ADR-004）：作答 / 批改 / 報告 ══════════

    // ── POST /api/learning/quiz — 建卷 ──（P1，略）

    // ── GET /api/learning/quiz — 歷史清單 ──
    if (method === "GET" && seg.length === 3) {
      const rows = db().prepare(`
        SELECT s.*,
               COUNT(i.id) AS total,
               SUM(CASE WHEN i.answer IS NOT NULL AND TRIM(i.answer) != '' THEN 1 ELSE 0 END) AS answered,
               SUM(CASE WHEN i.is_correct = 1 THEN 1 ELSE 0 END) AS correct
        FROM quiz_session s
        LEFT JOIN quiz_item i ON i.exam_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at DESC
        LIMIT 100
      `).all();
      // 白名單組裝 — 不 spread DB row（answer/correct_choice 絕不出此層）
      return json(res, 200, {
        exams: rows.map((r) => ({
          id: r.id,
          title: r.title,
          mode: r.mode,
          status: r.status,
          createdAt: r.created_at,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          durationLimitSec: r.duration_limit_sec,
          overtime: r.overtime === 1,
          total: r.total,
          answered: r.answered,
          correct: r.status === "finished" ? r.correct : null, // 批改結果僅 finished 揭露
        })),
      }), true;
    }

    // ── POST /api/learning/quiz/:id/start — 起考（記 started_at，status→ongoing；重複 start=續考不重置計時）──
    if (method === "POST" && seg.length === 5 && seg[4] === "start") {
      const examId = seg[3];
      const s = db().prepare("SELECT * FROM quiz_session WHERE id = ?").get(examId);
      if (!s) return json(res, 404, { error: `quiz_session ${examId} 不存在` }), true;
      if (s.status === "finished") return json(res, 409, { error: "此卷已收卷（finished），無法重新起考" }), true;
      if (s.status === "abandoned") return json(res, 409, { error: "此卷已廢棄（abandoned），請重新建卷" }), true;
      if (s.status === "draft") {
        db().prepare("UPDATE quiz_session SET status = 'ongoing', started_at = ? WHERE id = ?").run(now(), examId);
      } // ongoing：冪等續考 — 保留原 started_at 與已存草稿（斷線續考）

      const session = db().prepare("SELECT * FROM quiz_session WHERE id = ?").get(examId);
      const section = db().prepare("SELECT * FROM quiz_section WHERE exam_id = ? ORDER BY seq").all(examId);
      const items = db().prepare("SELECT id, section_id, seq, question_key, snapshot_json FROM quiz_item WHERE exam_id = ? ORDER BY seq").all(examId);
      const drafts = db().prepare(`
        SELECT seq, answer, answered_at, duration_ms FROM quiz_item WHERE exam_id = ? AND answer IS NOT NULL ORDER BY seq
      `).all(examId);
      const elapsed = Date.now() - Date.parse(session.started_at);
      const remaining = session.duration_limit_sec != null
        ? Math.max(0, session.duration_limit_sec - Math.floor(elapsed / 1000))
        : null;
      // 白名單：examResponse + 我方草稿 + 剩餘時間 — 絕不含 correct_choice / is_correct
      return json(res, 200, {
        ...examResponse(session, section, items),
        myAnswers: drafts.map((d) => ({ seq: d.seq, answer: d.answer, answeredAt: d.answered_at, durationMs: d.duration_ms })),
        timing: { startedAt: session.started_at, durationLimitSec: session.duration_limit_sec, remainingSec: remaining },
      }), true;
    }

    // ── PATCH /api/learning/quiz/:id/answer — 逐題存 draft（不判定；斷線續考不斷覆寫）──
    if (method === "PATCH" && seg.length === 5 && seg[4] === "answer") {
      const examId = seg[3];
      const body = await readJson(req);
      const { itemId, seq, answer, durationMs } = body;
      const s = db().prepare("SELECT * FROM quiz_session WHERE id = ?").get(examId);
      if (!s) return json(res, 404, { error: `quiz_session ${examId} 不存在` }), true;
      if (s.status !== "ongoing") {
        return json(res, 409, { error: `目前狀態 ${s.status} — 僅 ongoing 可作答（draft 請先 start，finished 不可再答）` }), true;
      }
      // 逾時防護（TASK-013 MINOR-3）：remainingSec 歸零即不再收 draft（防無限拖延）— 收卷走 submit，逾時收卷僅標 overtime 不拒收
      if (s.duration_limit_sec != null && s.started_at &&
          (Date.now() - Date.parse(s.started_at)) > s.duration_limit_sec * 1000) {
        return json(res, 409, { error: "作答時間已截止 — 不再接受草稿更新，請收卷（POST submit；逾時收卷僅標記 overtime）" }), true;
      }
      if (itemId == null && seq == null) return json(res, 400, { error: "itemId 或 seq 擇一必填" }), true;
      if (answer == null || String(answer).trim() === "") return json(res, 400, { error: "answer 必填（字串）" }), true;

      // 驗證 item 屬於該卷（同時用 exam_id 綁定，防止跨卷寫入）
      const item = db().prepare("SELECT id, seq, question_key FROM quiz_item WHERE exam_id = ? AND (id = ? OR seq = ?)").get(
        examId, Number(itemId ?? -1), Number(seq ?? -1)
      );
      if (!item) return json(res, 404, { error: "此題不屬於該卷（itemId/seq 無效）" }), true;

      const normalized = normAnswer(answer); // 同 learning-practice 儲存正規化（trim + uppercase）
      const dm = Number(durationMs);
      db().prepare(`
        UPDATE quiz_item SET answer = ?, answered_at = ?, duration_ms = COALESCE(?, duration_ms) WHERE id = ?
      `).run(normalized, now(), Number.isFinite(dm) && dm >= 0 ? Math.round(dm) : null, item.id);

      return json(res, 200, { ok: true, examId, seq: item.seq, questionKey: item.question_key, answer: normalized, answeredAt: now() }), true;
    }

    // ── POST /api/learning/quiz/:id/submit — SQL 批改 + learner_attempt 回寫 + status→finished ──
    if (method === "POST" && seg.length === 5 && seg[4] === "submit") {
      const examId = seg[3];
      const s = db().prepare("SELECT * FROM quiz_session WHERE id = ?").get(examId);
      if (!s) return json(res, 404, { error: `quiz_session ${examId} 不存在` }), true;
      if (s.status !== "ongoing") {
        return json(res, 409, { error: `目前狀態 ${s.status} — 僅 ongoing 可收卷（draft 請先 start）` }), true;
      }

      const overtime = s.duration_limit_sec != null &&
        (Date.now() - Date.parse(s.started_at)) > s.duration_limit_sec * 1000 ? 1 : 0; // 逾時仍收卷，僅標記

      const dbx = db();
      dbx.exec("BEGIN");
      try {
        const items = dbx.prepare("SELECT id, seq, section_id, question_key, correct_choice, answer, duration_ms FROM quiz_item WHERE exam_id = ? ORDER BY seq").all(examId);
        const updItem = dbx.prepare("UPDATE quiz_item SET is_correct = ? WHERE id = ?");
        // learner_attempt 欄位格式比照 learning-practice submit：
        //   (question_key, answer, is_correct, used_hint=0, confidence=null, duration_ms, session_id=examId)
        //   正確/錯誤都寫；未作答視為錯（answer=''）— 錯題（含未作答）自動排入 1/3/7 天複習佇列
        //   （機制：learning-practice reviewDueQuestions 取「最後一次 attempt 錯」在 +1/+3/+7 天到期）
        const insAttempt = dbx.prepare(`
          INSERT INTO learner_attempt (question_key, answer, is_correct, used_hint, confidence, duration_ms, session_id)
          VALUES (?, ?, ?, 0, NULL, ?, ?)
        `);
        let correct = 0, answered = 0;
        for (const it of items) {
          const ok = gradeItem(it); // DB 內批改（correct_choice 只在本交易讀，絕不進回應）
          if (it.answer != null && String(it.answer).trim() !== "") answered += 1;
          if (ok) correct += 1;
          updItem.run(ok, it.id);
          insAttempt.run(
            it.question_key,
            it.answer != null && String(it.answer).trim() !== "" ? it.answer : "", // NOT NULL 欄 — 未作答存空字串
            ok,
            Number.isFinite(it.duration_ms) ? it.duration_ms : null,
            examId.slice(0, 64)
          );
        }
        dbx.prepare("UPDATE quiz_session SET status = 'finished', finished_at = ?, overtime = ? WHERE id = ?").run(now(), overtime, examId);
        dbx.exec("COMMIT");

        const wrong = items.length - correct;
        return json(res, 200, {
          id: examId,
          status: "finished",
          overtime: overtime === 1,
          finishedAt: now(),
          score: {
            total: items.length,
            answered,
            correct,
            wrong,
            unanswered: items.length - answered,
            scorePct: pct1(correct, items.length),
          },
          reviewQueued: wrong, // 錯題（含未作答）已隨 learner_attempt 排入 1/3/7 天複習佇列
        }), true; // 逐題明細（含正確答案）走 report — submit 回應維持摘要級
      } catch (err) {
        dbx.exec("ROLLBACK");
        console.error("[quiz-session] submit failed:", { examId, error: err.message });
        throw err;
      }
    }

    // ── GET /api/learning/quiz/:id/report — 進度（未 finished，絕不含答案）/ 成績報告（finished）──
    if (method === "GET" && seg.length === 5 && seg[4] === "report") {
      const examId = seg[3];
      const s = db().prepare("SELECT * FROM quiz_session WHERE id = ?").get(examId);
      if (!s) return json(res, 404, { error: `quiz_session ${examId} 不存在` }), true;

      const sectionRows = db().prepare("SELECT * FROM quiz_section WHERE exam_id = ? ORDER BY seq").all(examId);
      const itemRows = db().prepare("SELECT id, section_id, seq, question_key, snapshot_json, answer, answered_at, is_correct, duration_ms FROM quiz_item WHERE exam_id = ? ORDER BY seq").all(examId);
      const examMeta = {
        id: s.id, title: s.title, mode: s.mode, status: s.status,
        createdAt: s.created_at, startedAt: s.started_at, finishedAt: s.finished_at,
        durationLimitSec: s.duration_limit_sec,
      };

      // ── 未收卷（draft/ongoing）：只回進度 — 任何回應絕不含 correct_choice / is_correct ──
      if (s.status !== "finished") {
        const answered = itemRows.filter((it) => it.answer != null && String(it.answer).trim() !== "").length;
        const elapsed = s.started_at ? Date.now() - Date.parse(s.started_at) : null;
        return json(res, 200, {
          exam: examMeta,
          progress: { total: itemRows.length, answered, unanswered: itemRows.length - answered },
          timing: {
            remainingSec: s.duration_limit_sec != null && s.started_at
              ? Math.max(0, s.duration_limit_sec - Math.floor(elapsed / 1000))
              : null,
          },
          note: "作答中 — 批改結果與正確答案於收卷（submit）後提供",
        }), true;
      }

      // ── finished：完整報告（此時作答已結束，correct_choice 才允許出現在回應）──
      const correctMap = new Map(
        db().prepare("SELECT id, correct_choice FROM quiz_item WHERE exam_id = ?").all(examId).map((r) => [r.id, r.correct_choice])
      );
      const sections = sectionRows.map((sec) => {
        const secItems = itemRows.filter((it) => it.section_id === sec.id);
        const correct = secItems.filter((it) => it.is_correct === 1).length;
        const secScope = parseSnapshot(sec.scope_json);
        return {
          seq: sec.seq,
          // 顯示名（TASK-013 MINOR-2）：CAP 卷 section.subject 缺值 → 從 scope 組「會考數學」，避免前端顯示空白
          name: sec.subject
            || (secScope.mode === "cap" && secScope.subject ? `會考${SUBJECT_NAMES[secScope.subject] || secScope.subject}` : null)
            || "未命名段落",
          subject: sec.subject,
          scope: secScope,
          questionCount: secItems.length,
          correct,
          accuracyPct: pct1(correct, secItems.length),
        };
      });

      // 單元掌握度：範圍內各單元正確率（unit 模式取快照 unitName；CAP 題 fallback 科目名）
      const byUnit = new Map();
      for (const it of itemRows) {
        const snap = parseSnapshot(it.snapshot_json);
        // CAP 快照 subject 存原始碼（如 MATH）→ 經 SUBJECT_NAMES 在地化；concept 題 unitName 本身即中文（TASK-013 MINOR-1）
        const raw = snap.unitName || snap.subject || "未分類";
        const key = SUBJECT_NAMES[String(raw).toLowerCase()] || raw;
        if (!byUnit.has(key)) byUnit.set(key, { total: 0, correct: 0 });
        const u = byUnit.get(key);
        u.total += 1;
        if (it.is_correct === 1) u.correct += 1;
      }
      const mastery = [...byUnit.entries()].map(([name, u]) => {
        const p = pct1(u.correct, u.total);
        return { name, total: u.total, correct: u.correct, accuracyPct: p, level: masteryLevel(p) };
      });

      const correct = itemRows.filter((it) => it.is_correct === 1).length;
      const answered = itemRows.filter((it) => it.answer != null && String(it.answer).trim() !== "").length;

      return json(res, 200, {
        exam: { ...examMeta, overtime: s.overtime === 1 },
        score: {
          total: itemRows.length,
          answered,
          correct,
          wrong: itemRows.length - correct,
          unanswered: itemRows.length - answered,
          scorePct: pct1(correct, itemRows.length),
        },
        sections,
        mastery,
        items: itemRows.map((it) => {
          const snap = parseSnapshot(it.snapshot_json);
          return {
            seq: it.seq,
            questionKey: it.question_key,
            provider: snap.provider || null,
            providerLabel: PROVIDER_LABELS[snap.provider] || snap.provider || "未知出處",
            myAnswer: it.answer,
            correctAnswer: correctMap.get(it.id) ?? null,
            isCorrect: it.is_correct === 1,
            answeredAt: it.answered_at,
            durationMs: it.duration_ms,
            explanationMd: snap.explanationMd || null,
            unitName: snap.unitName || null,
            conceptName: snap.conceptName || null,
          };
        }),
      }), true;
    }

    // ── DELETE /api/learning/quiz/:id — 僅 draft/abandoned 可刪（finished 歷史考卷永久留存，ADR-004）──
    if (method === "DELETE" && seg.length === 4) {
      const examId = seg[3];
      const s = db().prepare("SELECT * FROM quiz_session WHERE id = ?").get(examId);
      if (!s) return json(res, 404, { error: `quiz_session ${examId} 不存在` }), true;
      if (s.status === "ongoing") return json(res, 409, { error: "作答中（ongoing）不可刪 — 請先收卷（submit）" }), true;
      if (s.status === "finished") return json(res, 409, { error: "歷史考卷永久留存（ADR-004），不可刪除" }), true;
      const dbx = db();
      dbx.exec("BEGIN");
      try {
        dbx.prepare("DELETE FROM quiz_item WHERE exam_id = ?").run(examId);
        dbx.prepare("DELETE FROM quiz_section WHERE exam_id = ?").run(examId);
        dbx.prepare("DELETE FROM quiz_session WHERE id = ?").run(examId);
        dbx.exec("COMMIT");
        return json(res, 200, { ok: true, deleted: examId, status: s.status }), true;
      } catch (err) {
        dbx.exec("ROLLBACK");
        throw err;
      }
    }

    // ── GET /api/learning/quiz/:id — 讀卷（快照回放，恆一致）──
    if (method === "GET" && seg.length === 4 && seg[3] !== "scope-options") {
      const examId = seg[3];
      const session = db().prepare("SELECT * FROM quiz_session WHERE id = ?").get(examId);
      if (!session) return json(res, 404, { error: `quiz_session ${examId} 不存在` }), true;
      const section = db().prepare("SELECT * FROM quiz_section WHERE exam_id = ? ORDER BY seq").all(examId);
      const items = db().prepare("SELECT id, section_id, seq, question_key, snapshot_json FROM quiz_item WHERE exam_id = ? ORDER BY seq").all(examId);
      return json(res, 200, examResponse(session, section, items)), true;
    }

    return json(res, 404, { error: "unknown quiz route" }), true;
  } catch (err) {
    if (err?.status) return json(res, err.status, { error: err.message }), true;
    console.error("[quiz-session] error:", err);
    return json(res, 500, { error: err.message }), true;
  }
}
