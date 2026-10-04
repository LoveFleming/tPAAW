/**
 * Exam Vault — 國王考卷寶庫 V0（2026-09-22，設計 docs/exam-vault-design.md v1.2）
 *
 * 收卷 → AI(vision) 解析 → 校對（角色中立，誰做都行 — 2026-09-26 定調）→ 入庫 → 錯題本
 * 鐵律：
 *   - LLM 只推理：單元名只能選 curriculum 既有（程式驗證），對錯/錯因由校對者定案
 *   - 原圖永不刪，住在 data/exam-papers/<id>/（⚠️ 重要資產一定要進 git — 2026-09-26 Fleming 定調，跟 learning.db 相反）；published 後不可刪
 *   - 入庫時寫 exam.json 快照（校對成果也進 git）+ 自動 push GitHub 備份（scripts/vault-backup.mjs，best-effort）
 *
 * Routes:
 *   GET  /api/exam-vault/subjects
 *   GET  /api/exam-vault/units?subject=math
 *   GET  /api/exam-vault/exams?subject=&status=
 *   GET  /api/exam-vault/exams/:id
 *   PATCH /api/exam-vault/exams/:id                  — 改 title/examDate/score
 *   DELETE /api/exam-vault/exams/:id                 — 僅未發布可刪（誤傳照片用）
 *   POST /api/exam-vault/upload                      — {subject,title?,examDate?,pages:[{name,dataUrl}]}
 *   POST /api/exam-vault/url                         — {subject,...,urls:[...]}
 *   POST /api/exam-vault/exams/:id/reparse
 *   PATCH /api/exam-vault/questions/:qid             — 家長合議（unit/答案/對錯/錯因/核可）
 *   POST /api/exam-vault/exams/:id/publish
 *   GET  /api/exam-vault/wrong?subject=&unit=&errorType=&concept=
 *   GET  /api/exam-vault/wrong/counts              — 各單元錯題數（教室頁聯動用）
 *   GET  /api/exam-vault/img?exam=:id&page=N
 *   POST /api/exam-vault/backup                      — 手動一鍵 GitHub 備份
 */

import { readFileSync, existsSync } from "fs";
import { readFile, writeFile, mkdir, readdir, rm } from "fs/promises";
import { join, resolve, basename } from "path";
import { spawn } from "child_process";
import { stableStringify } from "../lib/stable-hash.mjs";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import { PAAW_ROOT, readBody } from "./shared.mjs";
import { DATA_HOME } from "../data-home.mjs";
import { safeResolve, sanitizeId } from "../lib/coding-security.mjs";

const DB_PATH = join(PAAW_ROOT, "data", "learning.db");
const SUBJECTS_DIR = join(PAAW_ROOT, "subjects");
// 原圖歸檔處（2026-09-26 政策：重要資產，一定要進 git — .gitignore 已註解鎖死）
const EXAM_PAPERS_DIR = join(PAAW_ROOT, "data", "exam-papers");

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const ALLOWED_EXT = new Set(Object.keys(MIME));
const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const MAX_URL_BYTES = 12 * 1024 * 1024;

// ── DB（learning.db 同庫，schema idempotent）──
let _db = null;
function db() {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS exam (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      title TEXT,
      exam_date TEXT,
      grade INTEGER, semester INTEGER,
      source TEXT DEFAULT 'upload',
      source_url TEXT,
      raw_dir TEXT,
      page_count INTEGER DEFAULT 0,
      score TEXT,
      status TEXT DEFAULT 'parsing',
      parse_note TEXT,
      created_at TEXT,
      published_at TEXT
    );
    CREATE TABLE IF NOT EXISTS exam_question (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      qno INTEGER,
      page INTEGER,
      unit TEXT, concept TEXT,
      question_text TEXT,
      student_answer TEXT,
      correct_answer TEXT,
      is_correct INTEGER,
      error_type TEXT,
      confidence REAL,
      evidence TEXT,
      review_status TEXT DEFAULT 'pending',
      review_note TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_exam_q_exam ON exam_question(exam_id);
    CREATE INDEX IF NOT EXISTS idx_exam_status ON exam(status);
  `);
  return _db;
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
/** readBody 回 raw string — 這包 parse + 空 body 容錯 */
async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("invalid JSON body"), { status: 400 }); }
}
const now = () => new Date().toISOString();
const rid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// ── Subjects / curriculum units（事實靠程式）──
async function listSubjects() {
  try {
    const entries = await readdir(SUBJECTS_DIR, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const mf = join(SUBJECTS_DIR, e.name, "subject.json");
      if (!existsSync(mf)) continue;
      try {
        const m = JSON.parse(await readFile(mf, "utf-8"));
        out.push({ id: m.id || e.name, name: m.name || e.name, status: m.status || "unknown" });
      } catch { /* manifest 壞掉跳過 */ }
    }
    return out;
  } catch { return []; }
}

/** 該科所有合法單元名（grade/semester 標註）；normalize 後比對 */
async function subjectUnits(subjectId) {
  // SECURITY NOTE: real fix — subjectId may arrive from ?subject= query; sanitizeId gate + safeResolve containment.
  const sid = (() => { try { return sanitizeId(String(subjectId)); } catch { return null; } })();
  if (!sid) return [];
  const sdir = safeResolve(SUBJECTS_DIR, sid);
  const mf = safeResolve(sdir, "subject.json");
  if (!existsSync(mf)) return []; // nosemgrep: detect-non-literal-fs-filename — sid sanitizeId-validated, safeResolve containment
  let curRel = "curriculum/kangxuan.json";
  try { curRel = JSON.parse(readFileSync(mf, "utf-8")).curriculum || curRel; } catch {} // nosemgrep: detect-non-literal-fs-filename — safeResolve containment
  const curPath = safeResolve(sdir, curRel);
  if (!existsSync(curPath)) return []; // nosemgrep: detect-non-literal-fs-filename — curRel from trusted subject.json, safeResolve containment
  try {
    const cur = JSON.parse(readFileSync(curPath, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — safeResolve containment
    const units = [];
    for (const g of cur.grades || []) {
      for (const u of g.units || []) {
        units.push({ name: u.name, grade: g.grade, semester: g.semester, concepts: u.concepts || [] });
      }
    }
    return units;
  } catch { return []; }
}

const norm = (s) => String(s || "").replace(/\s+/g, "").replace(/[（）()]/g, "");
/** 單元驗證：AI 只能選既有單元名（normalize 完全比對），對不上 = null（校對者指定） */
function validateUnit(units, guess) {
  if (!guess) return null;
  const g = norm(guess);
  if (!g) return null;
  const hit = units.find(u => norm(u.name) === g);
  return hit ? hit.name : null;
}
/** 知識點驗證：只能選該單元 curriculum 既有 concept（normalize 比對）；對不上回 null */
function validateConcept(units, unitName, guess) {
  if (!guess) return null;
  const u = units.find(x => x.name === unitName);
  if (!u) return null;
  const g = norm(guess);
  const hit = (u.concepts || []).find(c => norm(c) === g);
  return hit ?? null;
}

// ── Vision LLM 呼叫（providers.json → visionModel）──
function providerConfig() {
  const f = resolve(DATA_HOME, "config", "providers.json");
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf-8")); } catch { return null; }
}

function resolveVision(cfg) {
  const vm = cfg?.visionModel;
  if (!vm || typeof vm !== "string" || !vm.includes("/")) return null;
  const i = vm.indexOf("/");
  const pid = vm.slice(0, i), model = vm.slice(i + 1);
  const p = cfg.providers?.[pid];
  if (!p?.apiKey || p.apiKey === "na" || !p.baseURL) return null;
  return { pid, model, baseURL: p.baseURL.replace(/\/+$/, ""), apiKey: p.apiKey };
}

const PARSE_SYSTEM = `你是國中考卷的檔案官。使用者是台灣國中生（小元寶國王），照片是她的紙本考卷，上面有她的手寫作答與老師的批改痕跡（打叉、打勾、分數、訂正）。 // nosemgrep: missing-template-string-indicator — internal constant prompt, literal JSON braces below are prose (not interpolation)
你的任務：讀出這一頁的每一題，輸出嚴格 JSON（不要任何其他文字、不要 markdown 圍籬）。
規則：
- qno：題號（整數）。無法辨識題號的雜項（姓名欄、分數欄）不要輸出。
- questionText：題目文字（盡量全文；太長可節錄前半）。
- studentAnswer：她的作答（選項字母或算式/文字；沒寫就 ""）。
- correctAnswer：正確答案。卷上有老師訂正/正解就用它；沒有就靠你自己解題判斷；完全無法判斷就 ""。
- marking：這題的批改痕跡 — "correct"（打勾/沒記號且看起來全對）/"wrong"（打叉/圈錯）/"partial"（半對）/"none"（看不出）。
- isCorrect：marking=correct→true；wrong/partial→false；none→null。
- errorType：錯題才填，候選：「概念錯/計算錯/粗心/題意看錯/未學過」，無法判斷 ""。
- unit：從提供的單元清單裡選最貼近的一個（一字不改地複製單元名）；都不像就 ""。
- confidence：0~1 你對這題整體判讀的信心。
- evidence：一句話證據，例如「第3題左上有紅色打叉」「卷尾答案欄顯示正解B」。
輸出格式：{"header":{"title":"","examDate":"","score":""},"questions":[{"qno":1,"questionText":"","studentAnswer":"","correctAnswer":"","marking":"wrong","isCorrect":false,"errorType":"","unit":"","confidence":0.8,"evidence":""}]}
header 只在第一頁或看得出來時填。`;

async function parsePageImage(vision, dataUrl, { subjectName, unitNames }) {
  const task = `這是「${subjectName}」考卷的一頁。\n可用單元清單（unit 只能從這裡選）：${unitNames.join("、") || "（無清單，unit 填空）"}\n請輸出 JSON。`;
  const body = {
    model: vision.model,
    temperature: 0.1,
    max_tokens: 8000,
    messages: [
      { role: "system", content: PARSE_SYSTEM },
      { role: "user", content: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: task },
      ] },
    ],
  };
  const r = await fetch(`${vision.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${vision.apiKey}` },
    body: stableStringify(body),
  });
  if (!r.ok) throw new Error(`vision API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  let txt = d?.choices?.[0]?.message?.content || "";
  txt = txt.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = txt.indexOf("{"), end = txt.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("vision 回應不是 JSON");
  const parsed = JSON.parse(txt.slice(start, end + 1));
  return { header: parsed.header || {}, questions: Array.isArray(parsed.questions) ? parsed.questions : [] };
}

// ── 解析管線（fire-and-forget，狀態寫 DB，UI 輪詢）──
async function runParse(examId) {
  const dbx = db();
  const exam = dbx.prepare("SELECT * FROM exam WHERE id = ?").get(examId);
  if (!exam) return;
  const cfg = providerConfig();
  const vision = cfg && resolveVision(cfg);
  if (!vision) {
    dbx.prepare("UPDATE exam SET status='parse_failed', parse_note=? WHERE id=?")
      .run("沒有可用的 vision model（providers.json 的 visionModel/apiKey），請到 AI 設定確認後重新解析", examId);
    return;
  }
  try {
    const units = await subjectUnits(exam.subject);
    const unitNames = units.map(u => u.name);
    const sName = (await listSubjects()).find(s => s.id === exam.subject)?.name || exam.subject;

    const rawDir = safeResolve(EXAM_PAPERS_DIR, String(exam.id));
    const files = (await readdir(rawDir)).filter(f => /^p\d+\.(jpg|jpeg|png|webp)$/i.test(f)).sort(); // nosemgrep: detect-non-literal-fs-filename — internal dir (DB-created), safeResolve containment
    const merged = [];
    let header = {};
    for (let i = 0; i < files.length; i++) {
      const buf = await readFile(safeResolve(rawDir, files[i])); // nosemgrep: detect-non-literal-fs-filename — filenames regex-filtered pNN.ext, safeResolve containment
      const mime = MIME["." + files[i].split(".").pop().toLowerCase()] || "image/jpeg";
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      const page = i + 1;
      let out;
      try {
        out = await parsePageImage(vision, dataUrl, { subjectName: sName, unitNames });
      } catch (err) {
        merged.push({ __pageError: page, error: err.message });
        continue;
      }
      if (page === 1) header = out.header || {};
      for (const q of out.questions) {
        const qno = Number(q.qno);
        if (!Number.isFinite(qno)) continue;
        merged.push({
          qno, page,
          questionText: String(q.questionText || "").slice(0, 2000),
          studentAnswer: String(q.studentAnswer || "").slice(0, 500),
          correctAnswer: String(q.correctAnswer || "").slice(0, 500),
          isCorrect: q.isCorrect === true ? 1 : q.isCorrect === false ? 0 : null,
          errorType: String(q.errorType || "").slice(0, 40),
          unit: validateUnit(units, q.unit),   // ← 程式驗證，AI 不能發明單元
          confidence: Number.isFinite(Number(q.confidence)) ? Number(q.confidence) : null,
          evidence: String(q.evidence || "").slice(0, 500),
        });
      }
    }

    const pageErrors = merged.filter(m => m.__pageError);
    const qs = merged.filter(m => !m.__pageError);

    dbx.prepare("DELETE FROM exam_question WHERE exam_id = ?").run(examId);
    const ins = dbx.prepare(`INSERT INTO exam_question (id, exam_id, qno, page, unit, question_text, student_answer, correct_answer, is_correct, error_type, confidence, evidence, review_status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`);
    for (const q of qs) {
      ins.run(`eq-${examId}-p${q.page}-${q.qno}`, examId, q.qno, q.page, q.unit, q.questionText, q.studentAnswer, q.correctAnswer, q.is_correct === null ? null : q.isCorrect, q.errorType, q.confidence, q.evidence, now());
    }

    const title = exam.title || (header.title ? String(header.title).slice(0, 120) : null);
    const note = [
      qs.length ? `解析出 ${qs.length} 題` : "⚠️ 沒有解析出任何題目（照片是否清晰？）",
      pageErrors.length ? `第 ${pageErrors.map(e => e.__page).join(", ")} 頁解析失敗：${pageErrors[0].error}` : "",
    ].filter(Boolean).join("；");
    dbx.prepare("UPDATE exam SET status='pending_review', title=?, exam_date=COALESCE(NULLIF(?,''), exam_date), score=COALESCE(NULLIF(?,''), score), parse_note=? WHERE id=?")
      .run(title, String(header.examDate || "").slice(0, 20), String(header.score || "").slice(0, 20), note, examId);
  } catch (err) {
    dbx.prepare("UPDATE exam SET status='parse_failed', parse_note=? WHERE id=?").run(String(err.message).slice(0, 500), examId);
  }
}

// ── 入庫快照：exam.json（metadata + 校對後題目）— 讓校對成果跟原圖一起進 git ──
async function writeExamSnapshot(examId) {
  const dbx = db();
  const exam = dbx.prepare("SELECT * FROM exam WHERE id = ?").get(examId);
  if (!exam) return;
  const questions = dbx.prepare("SELECT * FROM exam_question WHERE exam_id = ? ORDER BY page, qno").all(examId);
  const snapshot = {
    id: exam.id, subject: exam.subject, title: exam.title, examDate: exam.exam_date,
    grade: exam.grade, semester: exam.semester, source: exam.source,
    score: exam.score, status: exam.status, publishedAt: exam.published_at,
    questions: questions.map(q => ({
      no: q.qno, page: q.page, unit: q.unit,
      question: q.question_text, herAnswer: q.student_answer,
      correctAnswer: q.correct_answer, result: q.is_correct === 1 ? "correct" : q.is_correct === 0 ? "wrong" : "unknown",
      errorType: q.error_type, concept: q.concept, evidence: q.evidence, reviewStatus: q.review_status,
    })),
  };
  await writeFile(safeResolve(safeResolve(EXAM_PAPERS_DIR, exam.id), "exam.json"), JSON.stringify(snapshot, null, 2)); // nosemgrep: detect-non-literal-fs-filename — exam.id internally generated (ex-YYYYMMDD-xxxx), safeResolve containment
}

// ── 入庫後自動 GitHub 備份（best-effort，不阻塞）──
function triggerBackup() {
  const script = join(PAAW_ROOT, "scripts", "vault-backup.mjs");
  if (!existsSync(script)) return;
  const child = spawn(process.execPath, [script], { cwd: PAAW_ROOT, stdio: "ignore", detached: true });
  child.unref();
}

// ── 檔案儲存 ──
async function saveDataUrl(dataUrl, dir, idx) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) throw new Error("只接受 jpg/png/webp 圖片");
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length) throw new Error("空檔案");
  if (buf.length > MAX_PAGE_BYTES) throw new Error("單頁圖超過 6MB（請先壓縮）");
  const name = `p${String(idx).padStart(2, "0")}.${ext}`;
  await writeFile(safeResolve(dir, name), buf); // nosemgrep: detect-non-literal-fs-filename — name internally patterned (pNN.ext), safeResolve containment
  return name;
}

async function fetchImageUrl(url, dir, idx) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`下載失敗 HTTP ${r.status}`);
  const ct = String(r.headers.get("content-type") || "").split(";")[0].trim();
  const extByCt = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const ext = extByCt[ct];
  if (!ext) throw new Error(`不支援的內容類型：${ct}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_URL_BYTES) throw new Error("圖片超過 12MB");
  const name = `p${String(idx).padStart(2, "0")}.${ext}`;
  await writeFile(safeResolve(dir, name), buf); // nosemgrep: detect-non-literal-fs-filename — name internally patterned (pNN.ext), safeResolve containment
  return name;
}

async function createExam({ subject, title, examDate, grade, semester, source, sourceUrl, pages }) {
  if (!subject || !/^[a-z0-9-]+$/i.test(subject)) throw Object.assign(new Error("subject 必填"), { status: 400 });
  if (!Array.isArray(pages) || !pages.length) throw Object.assign(new Error("沒有頁面"), { status: 400 });
  const id = `ex-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = join(EXAM_PAPERS_DIR, id); // 進 git（2026-09-26 政策）
  await mkdir(dir, { recursive: true });
  let saved = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.dataUrl) await saveDataUrl(p.dataUrl, dir, saved + 1);
    else if (p.url) await fetchImageUrl(p.url, dir, saved + 1);
    else continue;
    saved++;
  }
  if (!saved) { await rm(dir, { recursive: true, force: true }); throw Object.assign(new Error("沒有可儲存的頁面"), { status: 400 }); }
  db().prepare(`INSERT INTO exam (id, subject, title, exam_date, grade, semester, source, source_url, raw_dir, page_count, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'parsing', ?)`)
    .run(id, subject, title ? String(title).slice(0, 120) : null, examDate ? String(examDate).slice(0, 20) : null,
      Number.isFinite(Number(grade)) ? Number(grade) : null, Number.isFinite(Number(semester)) ? Number(semester) : null,
      source, sourceUrl || null, dir, saved, now());
  runParse(id); // fire-and-forget
  return id;
}

// ── Route handler ──
export default async function examVaultRoutes(req, res) {
  const url = req.url || "";
  const path = url.split("?")[0];
  const q = Object.fromEntries(new URL(url, "http://x").searchParams);
  if (!path.startsWith("/api/exam-vault")) return false;
  const seg = path.slice("/api/exam-vault".length).split("/").filter(Boolean);
  const method = req.method;

  try {
    // GET /subjects
    if (method === "GET" && seg[0] === "subjects") {
      return json(res, 200, { subjects: await listSubjects() }), true;
    }

    // GET /units?subject=
    if (method === "GET" && seg[0] === "units") {
      const units = await subjectUnits(String(q.subject || ""));
      return json(res, 200, { units }), true;
    }

    // GET /exams
    if (method === "GET" && seg[0] === "exams" && !seg[1]) {
      const rows = db().prepare(`
        SELECT e.*, (SELECT COUNT(*) FROM exam_question q WHERE q.exam_id = e.id) AS total_questions,
          (SELECT COUNT(*) FROM exam_question q WHERE q.exam_id = e.id AND q.is_correct = 0) AS wrong_count,
          (SELECT COUNT(*) FROM exam_question q WHERE q.exam_id = e.id AND q.review_status = 'pending') AS pending_count
        FROM exam e
        WHERE (? IS NULL OR e.subject = ?) AND (? IS NULL OR e.status = ?)
        ORDER BY e.created_at DESC`).all(q.subject || null, q.subject || null, q.status || null, q.status || null);
      return json(res, 200, { exams: rows }), true;
    }

    // GET /exams/:id
    if (method === "GET" && seg[0] === "exams" && seg[1]) {
      const exam = db().prepare("SELECT * FROM exam WHERE id = ?").get(seg[1]);
      if (!exam) return json(res, 404, { error: "exam not found" }), true;
      const questions = db().prepare("SELECT * FROM exam_question WHERE exam_id = ? ORDER BY page, qno").all(exam.id);
      return json(res, 200, { exam, questions }), true;
    }

    // PATCH /exams/:id（title/examDate/score）
    if (method === "PATCH" && seg[0] === "exams" && seg[1] && !seg[2]) {
      const b = await readJson(req);
      db().prepare("UPDATE exam SET title=COALESCE(?, title), exam_date=COALESCE(?, exam_date), score=COALESCE(?, score) WHERE id=?")
        .run(b.title != null ? String(b.title).slice(0, 120) : null, b.examDate != null ? String(b.examDate).slice(0, 20) : null, b.score != null ? String(b.score).slice(0, 20) : null, seg[1]);
      const ex0 = db().prepare("SELECT status FROM exam WHERE id=?").get(seg[1]);
      if (ex0?.status === "published") await writeExamSnapshot(seg[1]); // 分數/卷名修正 → 快照同步
      return json(res, 200, { ok: true }), true;
    }

    // DELETE /exams/:id（僅未發布可刪 — 誤傳照片用；錯題鐵律：published 不可刪）
    if (method === "DELETE" && seg[0] === "exams" && seg[1] && !seg[2]) {
      const exam = db().prepare("SELECT * FROM exam WHERE id = ?").get(seg[1]);
      if (!exam) return json(res, 404, { error: "exam not found" }), true;
      if (exam.status === "published") return json(res, 409, { error: "已入庫的考卷不可刪（錯題鐵律）" }), true;
      db().prepare("DELETE FROM exam_question WHERE exam_id = ?").run(exam.id);
      db().prepare("DELETE FROM exam WHERE id = ?").run(exam.id);
      await rm(safeResolve(EXAM_PAPERS_DIR, exam.id), { recursive: true, force: true }); // nosemgrep: detect-non-literal-fs-filename — path rebuilt from root+internal id (ignores stored raw_dir), safeResolve containment
      return json(res, 200, { ok: true }), true;
    }

    // POST /upload
    if (method === "POST" && seg[0] === "upload") {
      const b = await readJson(req);
      const id = await createExam({ subject: b.subject, title: b.title, examDate: b.examDate, grade: b.grade, semester: b.semester, source: "upload", pages: b.pages || [] });
      return json(res, 200, { ok: true, id }), true;
    }

    // POST /url
    if (method === "POST" && seg[0] === "url") {
      const b = await readJson(req);
      const urls = (Array.isArray(b.urls) ? b.urls : String(b.urls || "").split(/[\n,]/)).map(s => String(s).trim()).filter(Boolean);
      const id = await createExam({ subject: b.subject, title: b.title, examDate: b.examDate, grade: b.grade, semester: b.semester, source: "url", sourceUrl: urls[0] || null, pages: urls.map(u => ({ url: u })) });
      return json(res, 200, { ok: true, id }), true;
    }

    // POST /exams/:id/reparse
    if (method === "POST" && seg[0] === "exams" && seg[1] && seg[2] === "reparse") {
      const exam = db().prepare("SELECT * FROM exam WHERE id = ?").get(seg[1]);
      if (!exam) return json(res, 404, { error: "exam not found" }), true;
      db().prepare("UPDATE exam SET status='parsing', parse_note=NULL WHERE id=?").run(exam.id);
      runParse(exam.id);
      return json(res, 200, { ok: true }), true;
    }

    // PATCH /questions/:qid — 校對修正（角色中立：Fleming / 小元寶 / AI 二審，誰改都一樣）
    if (method === "PATCH" && seg[0] === "questions" && seg[1]) {
      const row = db().prepare("SELECT * FROM exam_question WHERE id = ?").get(seg[1]);
      if (!row) return json(res, 404, { error: "question not found" }), true;
      const b = await readJson(req);
      let unit = b.unit !== undefined ? b.unit : row.unit;
      if (b.unit) {
        const units = await subjectUnits(db().prepare("SELECT subject FROM exam WHERE id=?").get(row.exam_id)?.subject || "");
        unit = validateUnit(units, b.unit); // 校對者也只能選既有單元（一致性）
        if (!unit) return json(res, 400, { error: "單元名不存在於 curriculum（請從清單選）" }), true;
      }
      // 知識點：只能選該題單元底下的既有 concept（空字串 = 清除）；沒單元就不能設知識點
      let concept = "concept" in b ? b.concept : row.concept;
      if (concept != null && String(concept) !== "") {
        const examSubj = db().prepare("SELECT subject FROM exam WHERE id=?").get(row.exam_id)?.subject || "";
        const units2 = await subjectUnits(examSubj);
        concept = validateConcept(units2, unit || row.unit, String(concept));
        if (!concept) return json(res, 400, { error: "知識點不存在於該單元 curriculum（先選單元，再從清單選知識點）" }), true;
      } else concept = null;
      const isCorrect = b.isCorrect === true ? 1 : b.isCorrect === false ? 0 : b.isCorrect === null && "isCorrect" in b ? null : row.is_correct;
      // 校對者動過任何實質欄位 → corrected；按核可 → approved
      const reviewStatus = b.reviewStatus === "approved" ? "approved"
        : (b.unit !== undefined || b.questionText !== undefined || b.studentAnswer !== undefined || b.correctAnswer !== undefined || b.isCorrect !== undefined || b.errorType !== undefined || b.concept !== undefined) ? "corrected"
        : row.review_status;
      db().prepare(`UPDATE exam_question SET unit=?, concept=?, question_text=COALESCE(?, question_text), student_answer=COALESCE(?, student_answer),
        correct_answer=COALESCE(?, correct_answer), is_correct=?, error_type=COALESCE(?, error_type), review_status=?, review_note=COALESCE(?, review_note) WHERE id=?`)
        .run(unit, concept, b.questionText != null ? String(b.questionText).slice(0, 2000) : null,
          b.studentAnswer != null ? String(b.studentAnswer).slice(0, 500) : null,
          b.correctAnswer != null ? String(b.correctAnswer).slice(0, 500) : null,
          isCorrect, b.errorType != null ? String(b.errorType).slice(0, 40) : null,
          reviewStatus, b.reviewNote != null ? String(b.reviewNote).slice(0, 500) : null, seg[1]);
      const ex = db().prepare("SELECT status FROM exam WHERE id=?").get(row.exam_id);
      if (ex?.status === "published") await writeExamSnapshot(row.exam_id); // 入庫後修正 → 快照同步進 git
      return json(res, 200, { ok: true }), true;
    }

    // POST /exams/:id/publish — 全部審完才可入庫
    if (method === "POST" && seg[0] === "exams" && seg[1] && seg[2] === "publish") {
      const exam = db().prepare("SELECT * FROM exam WHERE id = ?").get(seg[1]);
      if (!exam) return json(res, 404, { error: "exam not found" }), true;
      if (exam.status === "published") return json(res, 200, { ok: true, already: true }), true;
      const pending = db().prepare("SELECT COUNT(*) AS n FROM exam_question WHERE exam_id=? AND review_status='pending'").get(exam.id).n;
      if (pending > 0) return json(res, 409, { error: `還有 ${pending} 題未審（核可或修正後才能入庫）` }), true;
      db().prepare("UPDATE exam SET status='published', published_at=? WHERE id=?").run(now(), exam.id);
      await writeExamSnapshot(exam.id); // 校對成果快照進 git
      triggerBackup(); // 入庫自動 GitHub 備份（best-effort）
      return json(res, 200, { ok: true }), true;
    }

    // GET /wrong/counts — 各科各單元錯題數（教室頁「本單元錯 N 題」用；key=`subject|unit`）
    if (method === "GET" && seg[0] === "wrong" && seg[1] === "counts") {
      const rows = db().prepare(`
        SELECT e.subject AS subject, q.unit AS unit, COUNT(*) AS n
        FROM exam_question q JOIN exam e ON e.id = q.exam_id
        WHERE e.status='published' AND q.is_correct = 0 AND q.unit IS NOT NULL AND q.unit != ''
        GROUP BY e.subject, q.unit`).all();
      return json(res, 200, { counts: rows }), true;
    }

    // GET /wrong — 錯題本（只有入庫考卷的錯題）
    if (method === "GET" && seg[0] === "wrong") {
      const rows = db().prepare(`
        SELECT q.*, e.subject AS exam_subject, e.title AS exam_title, e.exam_date, e.status AS exam_status
        FROM exam_question q JOIN exam e ON e.id = q.exam_id
        WHERE e.status='published' AND q.is_correct = 0
          AND (? IS NULL OR e.subject = ?) AND (? IS NULL OR q.unit = ?) AND (? IS NULL OR q.error_type = ?) AND (? IS NULL OR q.concept = ?)
        ORDER BY e.exam_date DESC, e.created_at DESC, q.page, q.qno`)
        .all(q.subject || null, q.subject || null, q.unit || null, q.unit || null, q.errorType || null, q.errorType || null, q.concept || null, q.concept || null);
      return json(res, 200, { wrong: rows }), true;
    }

    // GET /img?exam=&page= — 頁圖（防路徑逃逸：只允許 pNN.{jpg,png,webp}）
    if (method === "GET" && seg[0] === "img") {
      const exam = db().prepare("SELECT * FROM exam WHERE id = ?").get(String(q.exam || ""));
      const page = Number(q.page || 1);
      if (!exam || !Number.isFinite(page)) return json(res, 404, { error: "not found" }), true;
      const name = `p${String(Math.max(1, Math.min(99, page))).padStart(2, "0")}`;
      const rawDir = safeResolve(EXAM_PAPERS_DIR, String(exam.id));
      for (const ext of ["jpg", "png", "webp", "jpeg"]) {
        const f = safeResolve(rawDir, `${name}.${ext}`);
        if (existsSync(f)) { // nosemgrep: detect-non-literal-fs-filename — name clamped p01-p99 + fixed ext list, safeResolve containment
          const buf = await readFile(f); // nosemgrep: detect-non-literal-fs-filename — name clamped p01-p99 + fixed ext list, safeResolve containment
          res.writeHead(200, { "Content-Type": MIME[ext === "jpeg" ? ".jpeg" : "." + ext] || "image/jpeg", "Cache-Control": "public, max-age=86400" });
          res.end(buf);
          return true;
        }
      }
      return json(res, 404, { error: "page image not found" }), true;
    }

    // POST /backup — 手動一鍵 GitHub 備份
    if (method === "POST" && seg[0] === "backup") {
      const script = join(PAAW_ROOT, "scripts", "vault-backup.mjs");
      if (!existsSync(script)) return json(res, 500, { error: "scripts/vault-backup.mjs 不存在" }), true;
      const { execFile } = await import("child_process");
      const out = await new Promise((resolve_) => {
        execFile(process.execPath, [script], { cwd: PAAW_ROOT, timeout: 120000 }, (err, stdout, stderr) =>
          resolve_({ ok: !err, stdout: String(stdout).trim(), stderr: String(stderr).trim(), error: err?.message }));
      });
      return json(res, out.ok ? 200 : 500, out), true;
    }

    return json(res, 404, { error: "unknown exam-vault route" }), true;
  } catch (err) {
    console.error("[exam-vault] error:", err.message);
    return json(res, err.status || 500, { error: err.message }), true;
  }
}
