/**
 * Learning Practice — 每日練習 v1（2026-09-19 Wave 2，Fleming 定調：做在學習中心裡）
 *
 * Routes:
 *   GET  /api/learning/practice/today?subject=math&count=10 — 今日題組（複習 1/3/7 優先 + 新題補滿）
 *   POST /api/learning/practice/submit                       — 判定 + 寫 learner_attempt
 *   GET  /api/learning/practice/stats?subject=math           — 今日進度 / 累計 / 複習佇列
 *   GET  /api/learning/crop?p=cap-115/crops/math/q01.png     — 題目裁切圖（raw/ 下，防路徑逃逸）
 *
 * 鐵律：判定與選題全 deterministic（SQL），無 LLM；correct_choice 永遠不進 today 回應。
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve, sep, extname } from "path";
import { DatabaseSync } from "node:sqlite";
import { PAAW_ROOT, readBody } from "./shared.mjs";

const DB_PATH = join(PAAW_ROOT, "data", "learning.db");
const RAW_DIR = join(PAAW_ROOT, "raw");

let _db = null;
function db() {
  if (_db) return _db;
  if (!existsSync(DB_PATH)) {
    throw Object.assign(new Error("learning.db not found — run scripts/seed.mjs first"), { status: 503 });
  }
  _db = new DatabaseSync(DB_PATH);
  return _db;
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** 科目顯示名（DB 中文）→ URL key（practice?subject= 用，DB question.subject 小寫比對） */
const SUBJECT_KEYS = {
  "數學": "math", "國文": "chinese", "英文": "english", "歷史": "history",
  "地理": "geography", "公民": "civic", "地科": "earth-science",
  "理化": "physics-chemistry", "生物": "biology",
};

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/** 今日要複習的題：最後一次作答錯，且那天剛好是 1/3/7 天前（間隔複習） */
function reviewDueQuestions(subject, limit) {
  return db().prepare(`
    WITH last AS (
      SELECT la.question_key, la.is_correct, date(la.attempted_at) AS d
      FROM learner_attempt la
      WHERE la.id = (SELECT MAX(id) FROM learner_attempt WHERE question_key = la.question_key)
    )
    SELECT q.question_key FROM question q
    JOIN last l ON l.question_key = q.question_key
    WHERE LOWER(q.subject) = ? AND q.status = 'PUBLISHED' AND q.correct_choice IS NOT NULL
      AND l.is_correct = 0
      AND l.d IN (date('now','localtime','-1 day'), date('now','localtime','-3 day'), date('now','localtime','-7 day'))
    ORDER BY q.question_number
    LIMIT ?
  `).all(subject, limit);
}

/** 沒作答過的新題（依題本順序），不夠再用最久沒練的補（間隔重練） */
function newQuestions(subject, limit) {
  const fresh = db().prepare(`
    SELECT q.question_key FROM question q
    WHERE LOWER(q.subject) = ? AND q.status = 'PUBLISHED' AND q.correct_choice IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM learner_attempt a WHERE a.question_key = q.question_key)
    ORDER BY q.question_number
    LIMIT ?
  `).all(subject, limit);
  if (fresh.length >= limit) return fresh;
  const seen = fresh.map(r => r.question_key);
  const fill = db().prepare(`
    SELECT q.question_key FROM question q
    WHERE LOWER(q.subject) = ? AND q.status = 'PUBLISHED' AND q.correct_choice IS NOT NULL
      ${seen.length ? `AND q.question_key NOT IN (${seen.map(() => "?").join(",")})` : ""}
    ORDER BY (SELECT MAX(attempted_at) FROM learner_attempt a WHERE a.question_key = q.question_key) ASC
    LIMIT ?
  `).all(subject, ...seen, limit - fresh.length);
  return [...fresh, ...fill];
}

function questionPayload(rows) {
  const keys = rows.map(r => r.question_key);
  if (!keys.length) return [];
  const qs = keys.map(() => "?").join(",");
  const meta = db().prepare(`
    SELECT question_key, type, year_roc, question_number, booklet_page, crops
    FROM question WHERE question_key IN (${qs})
  `).all(...keys);
  const byKey = Object.fromEntries(meta.map(m => [m.question_key, m]));
  return keys.map(k => {
    const m = byKey[k];
    if (!m) return null;
    let crops = [];
    try { crops = JSON.parse(m.crops || "[]"); } catch { crops = []; }
    return {
      questionKey: k,
      type: m.type,
      yearRoc: m.year_roc,
      questionNumber: m.question_number,
      bookletPage: m.booklet_page,
      crops: crops.map(p => `/api/learning/crop?p=${encodeURIComponent(p)}`),
    };
  }).filter(Boolean);
}

export default async function learningPracticeRoute(req, res) {
  const url = req.url || "";
  const path = url.split("?")[0];

  // Prefix guard：只處理 /api/learning/**，其他路徑交還給主路由（否則會吞掉 UI 靜態頁）
  if (!path.startsWith("/api/learning/")) return false;

  try {
    // ── GET /api/learning/curriculum — 科目目錄樹（curriculum_unit × curriculum_concept 全量）──
    if (req.method === "GET" && path === "/api/learning/curriculum") {
      const units = db().prepare(`
        SELECT u.id, u.subject, u.grade, u.semester, u.seq, u.name AS unit_name
        FROM curriculum_unit u
        ORDER BY u.subject, u.grade, u.semester, u.seq
      `).all();
      const concepts = db().prepare(`
        SELECT id, unit_id, name FROM curriculum_concept ORDER BY unit_id, seq
      `).all();
      const byUnit = new Map();
      for (const c of concepts) {
        if (!byUnit.has(c.unit_id)) byUnit.set(c.unit_id, []);
        byUnit.get(c.unit_id).push({ id: c.id, name: c.name });
      }
      const subjects = [];
      const sIdx = new Map();
      for (const u of units) {
        if (!sIdx.has(u.subject)) {
          const s = { key: SUBJECT_KEYS[u.subject] || u.subject, name: u.subject,
                      unitCount: 0, conceptCount: 0, units: [] };
          sIdx.set(u.subject, s); subjects.push(s);
        }
        const s = sIdx.get(u.subject);
        const cs = byUnit.get(u.id) || [];
        s.unitCount += 1; s.conceptCount += cs.length;
        s.units.push({ id: u.id, grade: u.grade, semester: u.semester, seq: u.seq,
                       name: u.unit_name, conceptCount: cs.length, concepts: cs });
      }
      return json(res, 200, { subjects });
    }

    // ── GET /api/learning/concept/:id — 單一知識點含教學內容（markdown）──
    const conceptMatch = path.match(/^\/api\/learning\/concept\/(\d+)$/);
    if (req.method === "GET" && conceptMatch) {
      const row = db().prepare(`
        SELECT c.id, c.name, c.content_md, u.id AS unit_id, u.subject, u.grade, u.semester, u.seq AS unit_seq, u.name AS unit_name
        FROM curriculum_concept c JOIN curriculum_unit u ON u.id = c.unit_id
        WHERE c.id = ?
      `).get(Number(conceptMatch[1]));
      if (!row) return json(res, 404, { error: "concept not found" });
      return json(res, 200, {
        id: row.id, name: row.name, unitId: row.unit_id,
        subject: row.subject, grade: row.grade, semester: row.semester,
        unitSeq: row.unit_seq, unitName: row.unit_name,
        contentMd: row.content_md || null,
      });
    }

    // ── GET /api/learning/concept/:id/questions — 知識點隨堂考題（不含答案）──
    const cqMatch = path.match(/^\/api\/learning\/concept\/(\d+)\/questions$/);
    if (req.method === "GET" && cqMatch) {
      const rows = db().prepare(`
        SELECT id, seq, question_md, options_json, explanation_md IS NOT NULL AND explanation_md != '' has_explanation
        FROM concept_question WHERE concept_id = ? ORDER BY seq
      `).all(Number(cqMatch[1]));
      return json(res, 200, {
        total: rows.length,
        questions: rows.map(r => ({
          questionKey: `cq:${r.id}`,
          seq: r.seq,
          question: r.question_md,
          options: JSON.parse(r.options_json),
          hasExplanation: !!r.has_explanation,
        })),
      });
    }

    // ── GET /api/learning/crop — 題目裁切圖 ──
    if (req.method === "GET" && path === "/api/learning/crop") {
      const q = new URL(url, "http://x").searchParams;
      const rel = String(q.get("p") || "").replace(/^\/+/, "");
      if (!/^[\w\-][\w\-\/\.]*\.(png|jpe?g|webp)$/i.test(rel) || rel.includes("..")) {
        return json(res, 400, { error: "bad crop path" });
      }
      const abs = resolve(RAW_DIR, rel);
      if (!abs.startsWith(resolve(RAW_DIR) + sep) || !existsSync(abs)) { // nosemgrep — detect-non-literal-fs-filename: rel 經 regex 白名單（副檔名+禁 ..）且 abs 經 startsWith(RAW_DIR) 前綴檢查（同雙重真防護）
        return json(res, 404, { error: "crop not found" });
      }
      const buf = readFileSync(abs); // nosemgrep — detect-non-literal-fs-filename: abs 同前（regex 白名單+RAW_DIR 前綴雙重防護）
      res.writeHead(200, { "Content-Type": MIME[extname(abs).toLowerCase()] || "image/png", "Cache-Control": "public, max-age=86400" }); // nosemgrep — detect-non-literal-fs-filename: abs 同上（白名單+前綴檢查）
      return res.end(buf);
    }

    // ── GET /api/learning/practice/today — 今日題組 ──
    if (req.method === "GET" && path === "/api/learning/practice/today") {
      const q = new URL(url, "http://x").searchParams;
      const subject = (q.get("subject") || "math").toLowerCase();
      const count = Math.min(Math.max(parseInt(q.get("count") || "10", 10) || 10, 3), 30);

      const review = reviewDueQuestions(subject, count);
      const fresh = newQuestions(subject, count - review.length);
      const questions = questionPayload([...review, ...fresh]);
      const reviewKeys = new Set(review.map(r => r.question_key));

      return json(res, 200, {
        date: new Date().toLocaleDateString("sv-SE"), // YYYY-MM-DD（local）
        subject,
        total: questions.length,
        questions: questions.map(q2 => ({ ...q2, isReview: reviewKeys.has(q2.questionKey) })),
      });
    }

    // ── GET /api/learning/practice/last?keys=cq:1,cq:2 — 每題最後一次作答狀態（章節測驗重進還原用；2026-10-04 Gap 補）──
    if (req.method === "GET" && path === "/api/learning/practice/last") {
      const q = new URL(url, "http://x").searchParams;
      const keys = (q.get("keys") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 50);
      if (keys.length === 0) return json(res, 400, { error: "keys required" });
      const ph = keys.map(() => "?").join(",");
      const rows = db().prepare(`
        SELECT la.question_key, la.answer, la.is_correct, la.attempted_at
        FROM learner_attempt la
        WHERE la.question_key IN (${ph})
          AND la.id = (SELECT MAX(id) FROM learner_attempt WHERE question_key = la.question_key)
          AND TRIM(la.answer) <> ''
      `).all(...keys);
      const out = {};
      for (const r of rows) {
        const item = { answer: r.answer, isCorrect: !!r.is_correct, attemptedAt: r.attempted_at };
        if (r.question_key.startsWith("cq:")) {
          const cq = db().prepare("SELECT correct, explanation_md FROM concept_question WHERE id = ?").get(Number(r.question_key.slice(3)));
          if (cq) { item.correctChoice = cq.correct; item.explanation = cq.explanation_md || null; }
        }
        out[r.question_key] = item;
      }
      return json(res, 200, { status: out });
    }

    // ── POST /api/learning/practice/submit — 判定 + 記錄 ──
    if (req.method === "POST" && path === "/api/learning/practice/submit") {
      const body = await readBody(req);
      const { questionKey, answer, durationMs, usedHint, confidence, sessionId } =
        typeof body === "string" ? JSON.parse(body || "{}") : (body || {});
      if (!questionKey || answer === undefined || answer === null || String(answer).trim() === "") {
        return json(res, 400, { error: "questionKey and answer required" });
      }
      let row = db().prepare(
        "SELECT correct_choice correct FROM question WHERE question_key = ? AND status = 'PUBLISHED'"
      ).get(questionKey);
      let correctChoice = row ? row.correct : null;
      let explanation = null;
      const cq = questionKey.startsWith("cq:")
        ? db().prepare("SELECT correct, explanation_md FROM concept_question WHERE id = ?").get(Number(questionKey.slice(3)))
        : null;
      if (cq) { correctChoice = cq.correct; explanation = cq.explanation_md; }
      if (!row && !cq) return json(res, 404, { error: "question not found" });
      if (correctChoice == null) {
        return json(res, 422, { error: "NON_MC needs self-grade (v1 skipped)" });
      }
      const norm = s => String(s || "").trim().toUpperCase();
      const isCorrect = cq
        ? (Number(answer) === correctChoice ? 1 : 0)
        : (norm(answer) === norm(correctChoice) ? 1 : 0);
      db().prepare(`
        INSERT INTO learner_attempt (question_key, answer, is_correct, used_hint, confidence, duration_ms, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        questionKey, String(answer).trim().toUpperCase(), isCorrect,
        usedHint ? 1 : 0,
        ["sure", "unsure"].includes(confidence) ? confidence : null,
        Number.isFinite(Number(durationMs)) ? Math.max(0, Math.round(Number(durationMs))) : null,
        sessionId ? String(sessionId).slice(0, 64) : null,
      );
      return json(res, 200, {
        questionKey,
        isCorrect: !!isCorrect,
        correctChoice, // 提交後才揭露
        explanation, // concept 隨堂題附詳解（考古題無）
        answered: cq ? String(answer) : String(answer).trim().toUpperCase(),
      });
    }

    // ── GET /api/learning/practice/stats — 進度統計 ──
    if (req.method === "GET" && path === "/api/learning/practice/stats") {
      const q = new URL(url, "http://x").searchParams;
      const subject = (q.get("subject") || "math").toLowerCase();
      const today = db().prepare(`
        SELECT COUNT(*) AS attempted, COALESCE(SUM(is_correct), 0) AS correct
        FROM learner_attempt a JOIN question q ON q.question_key = a.question_key
        WHERE LOWER(q.subject) = ? AND date(a.attempted_at) = date('now','localtime')
      `).get(subject);
      const total = db().prepare(`
        SELECT COUNT(*) AS attempted, COALESCE(SUM(is_correct), 0) AS correct, COUNT(DISTINCT a.question_key) AS questions
        FROM learner_attempt a JOIN question q ON q.question_key = a.question_key
        WHERE LOWER(q.subject) = ?
      `).get(subject);
      const bank = db().prepare(
        "SELECT COUNT(*) AS n FROM question WHERE LOWER(subject) = ? AND status = 'PUBLISHED' AND correct_choice IS NOT NULL"
      ).get(subject);
      const review = reviewDueQuestions(subject, 100);
      return json(res, 200, {
        subject,
        today: { attempted: today.attempted, correct: today.correct },
        allTime: { attempted: total.attempted, correct: total.correct, questionsTouched: total.questions, bankSize: bank.n },
        reviewDue: review.length,
      });
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    if (err?.status) return json(res, err.status, { error: err.message });
    console.error("[learning-practice] error:", err);
    return json(res, 500, { error: err.message });
  }
}
