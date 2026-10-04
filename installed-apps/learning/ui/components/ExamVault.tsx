/**
 * ExamVault — 國王考卷寶庫（docs/exam-vault-design.md）
 * 收卷 → AI 解析 → 校對（角色中立，誰做都行 — 2026-09-26 定調）→ 入庫 → 錯題本。
 * 原圖 + exam.json 住 data/exam-papers/（進 git）；單元只能選 curriculum 既有（server 驗證）；錯題入庫不可刪。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@paaw-ui/i18n";
import { uiConfirm } from "@paaw-ui/components/ui/uiFeedback";
import TeacherChatPanel from "./TeacherChatPanel";
import SplitChatLayout from "./SplitChatLayout";
import { SUBJECT_TEACHER } from "./CurriculumView";

type Theme = { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string };

type Subject = { id: string; name: string; status: string };
type Unit = { name: string; grade: number; semester: number; concepts: string[] };
type Exam = {
  id: string; subject: string; title: string | null; exam_date: string | null;
  grade: number | null; semester: number | null; status: string; page_count: number;
  score: string | null; parse_note: string | null; created_at: string; published_at: string | null;
  total_questions?: number; wrong_count?: number; pending_count?: number;
};
type Q = {
  id: string; exam_id: string; qno: number | null; page: number;
  unit: string | null; concept: string | null; question_text: string | null;
  student_answer: string | null; correct_answer: string | null;
  is_correct: number | null; error_type: string | null;
  confidence: number | null; evidence: string | null;
  review_status: string; review_note: string | null;
};
type WrongRow = Q & { exam_subject: string; exam_title: string | null; exam_date: string | null };
type Page = { name: string; dataUrl: string; preview: string };

const ERROR_TYPES = ["概念錯", "計算錯", "粗心", "題意看錯", "未學過"];
const MAX_EDGE = 1800;

/** 任何瀏覽器讀得到的圖（含 HEIC/Safari）→ 統一壓成 jpeg，長邊 ≤1800 */
async function normalizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

export default function ExamVault({ visible, theme, jump }: { visible: boolean; theme: Theme; jump?: { subject: string; unit: string; seq: number } | null }) {
  const { t } = useI18n();
  const [view, setView] = useState<"inbox" | "exams" | "review" | "wrong">("inbox");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subject, setSubject] = useState("math");
  const [units, setUnits] = useState<Unit[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [reviewExam, setReviewExam] = useState<{ exam: Exam; questions: Q[] } | null>(null);
  const [wrong, setWrong] = useState<WrongRow[]>([]);
  const [wrongUnit, setWrongUnit] = useState("");
  const [wrongConcept, setWrongConcept] = useState("");
  const [wrongErr, setWrongErr] = useState("");
  // 原圖對照 modal（錯題本 → 點開看原卷那一頁）
  const [wrongImg, setWrongImg] = useState<{ exam: string; page: number; pageCount: number; q: WrongRow } | null>(null);
  // 該科老師 chat（錯題 → 講解 / 變形題，P3）
  const [teacherChat, setTeacherChat] = useState<{ agentId: string; unitLabel: string; kickoff: { text: string; seq: number } } | null>(null);
  // 林雨晴常駐右欄（功能頁標準布局：main | splitter | chat，寬度拖曳自調）
  const [assistOpen, setAssistOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 收件表單
  const [title, setTitle] = useState("");
  const [examDate, setExamDate] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [urls, setUrls] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 審核頁圖
  const [pageNum, setPageNum] = useState(1);
  // 疑點優先排序（校對不綁人：佇列自動排，誰接手都看同一份待辦）
  const [suspectFirst, setSuspectFirst] = useState(true);

  const flash = (m: string | null, e?: string | null) => { setMsg(m || null); setErr(e || null); };

  const loadExams = useCallback(async () => {
    try {
      const d = await api(`/api/exam-vault/exams?subject=${encodeURIComponent(subject)}`);
      setExams(d.exams || []);
      return d.exams || [];
    } catch (e: any) { setErr(e.message); return []; }
  }, [subject]);

  useEffect(() => { (async () => { try { const d = await api("/api/exam-vault/subjects"); setSubjects(d.subjects || []); } catch {} })(); }, []);
  useEffect(() => { (async () => { try { const d = await api(`/api/exam-vault/units?subject=${encodeURIComponent(subject)}`); setUnits(d.units || []); } catch {} })(); [subject]; }, [subject]);
  useEffect(() => { if (visible) loadExams(); }, [visible, loadExams]);

  // 解析中輪詢
  useEffect(() => {
    if (!visible) return;
    if (!exams.some(e => e.status === "parsing")) return;
    const timer = setInterval(() => { loadExams(); }, 4000);
    return () => clearInterval(timer);
  }, [visible, exams, loadExams]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr(null);
    try {
      const next: Page[] = [];
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        const dataUrl = await normalizeImage(f);
        next.push({ name: f.name, dataUrl, preview: dataUrl });
      }
      setPages(ps => [...ps, ...next]);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitInbox = async () => {
    setBusy(true); flash(null, null);
    try {
      const urlList = urls.split("\n").map(s => s.trim()).filter(Boolean);
      if (pages.length) {
        const d = await api("/api/exam-vault/upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, title, examDate, pages: pages.map(p => ({ name: p.name, dataUrl: p.dataUrl })) }),
        });
        flash(t("exam-vault.state.submitted"));
      } else if (urlList.length) {
        const d = await api("/api/exam-vault/url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, title, examDate, urls: urlList }),
        });
        flash(t("exam-vault.state.submitted"));
      } else { setErr(t("exam-vault.empty.noPages")); setBusy(false); return; }
      setPages([]); setUrls(""); setTitle(""); setExamDate("");
      await loadExams();
      setView("exams");
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  const openReview = async (id: string) => {
    setBusy(true);
    try {
      const d = await api(`/api/exam-vault/exams/${id}`);
      setReviewExam(d); setPageNum(1); setSuspectFirst(d.questions.length > 0); setView("review");
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  const saveQ = async (qid: string, patch: Record<string, unknown>) => {
    try {
      await api(`/api/exam-vault/questions/${qid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (reviewExam) {
        const d = await api(`/api/exam-vault/exams/${reviewExam.exam.id}`);
        setReviewExam(d);
      }
    } catch (e: any) { setErr(e.message); }
  };

  const saveExamMeta = async (id: string, patch: Record<string, unknown>) => {
    try {
      await api(`/api/exam-vault/exams/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const d = await api(`/api/exam-vault/exams/${id}`);
      setReviewExam(d);
    } catch (e: any) { setErr(e.message); }
  };

  const publish = async (id: string) => {
    setBusy(true);
    try {
      await api(`/api/exam-vault/exams/${id}/publish`, { method: "POST" });
      flash(t("exam-vault.state.publishedOk"));
      await loadExams();
      await openReview(id);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  const delExam = async (id: string) => {
    if (!(await uiConfirm({ message: t("exam-vault.action.delConfirm"), danger: true }))) return;
    try {
      await api(`/api/exam-vault/exams/${id}`, { method: "DELETE" });
      await loadExams();
    } catch (e: any) { setErr(e.message); }
  };

  const loadWrong = useCallback(async (opts?: { subject?: string; unit?: string; concept?: string }) => {
    try {
      const qs = new URLSearchParams({ subject: opts?.subject ?? subject });
      const u = opts?.unit ?? wrongUnit;
      const c = opts?.concept !== undefined ? opts.concept : wrongConcept;
      if (u) qs.set("unit", u);
      if (wrongErr) qs.set("errorType", wrongErr);
      if (c) qs.set("concept", c);
      const d = await api(`/api/exam-vault/wrong?${qs}`);
      setWrong(d.wrong || []);
    } catch (e: any) { setErr(e.message); }
  }, [subject, wrongUnit, wrongConcept, wrongErr]);

  useEffect(() => { if (visible && view === "wrong") loadWrong(); }, [visible, view, loadWrong]);

  // 教室頁「本單元錯 N 題」跳進來：切到錯題本 + 帶過濾（seq 遞增觸發同單元重跳）
  useEffect(() => {
    if (!visible || !jump) return;
    setSubject(jump.subject);
    setWrongUnit(jump.unit); setWrongConcept(""); setWrongErr("");
    setView("wrong");
    loadWrong({ subject: jump.subject, unit: jump.unit, concept: "" });
  }, [visible, jump]); // eslint-disable-line react-hooks/exhaustive-deps

  const doBackup = async () => {
    setBusy(true); flash(null, null);
    try {
      const d = await api("/api/exam-vault/backup", { method: "POST" });
      const parsed = JSON.parse((d.stdout || "").split("\n").pop() || "{}");
      flash(parsed.pushed ? t("exam-vault.state.backupPushed") : parsed.ok ? t("exam-vault.state.backupLocal") : t("exam-vault.error.backupFail"));
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  // 錯題卡 → 原圖對照（抓 exam detail 拿 page_count，再開 modal）
  const openWrongImg = async (w: WrongRow) => {
    try {
      const d = await api(`/api/exam-vault/exams/${w.exam_id}`);
      setWrongImg({ exam: w.exam_id, page: w.page, pageCount: d?.exam?.page_count || w.page, q: w });
    } catch (e: any) { setErr(e.message); }
  };

  // 錯題 → 找該科老師（講解 / 變形題）— 帶原題 + 她的錯答 + 單元/知識點脈絡，開面板自動送出
  const askTeacher = (w: WrongRow, mode: "explain" | "variants") => {
    const subjName = subjects.find(s => s.id === w.exam_subject)?.name || w.exam_subject;
    const agentId = SUBJECT_TEACHER[subjName];
    if (!agentId) { setErr(t("exam-vault.empty.noTeacher")); return; }
    const ctx = [
      `${t(mode === "explain" ? "exam-vault.action.askKick" : "exam-vault.action.variantsKick")}`,
      ``,
      `${t("exam-vault.stats.q")}：${w.question_text || `（第 ${w.qno} 題）`}`,
      `${t("exam-vault.stats.her")}：${w.student_answer || "—"}`,
      `${t("exam-vault.stats.ans")}：${w.correct_answer || "—"}`,
      w.unit ? `${t("exam-vault.stats.unit")}：${w.unit}${w.concept ? ` · ${w.concept}` : ""}` : "",
      w.error_type ? `${t("exam-vault.stats.err")}：${w.error_type}` : "",
      `${t("exam-vault.stats.exam")}：${w.exam_title || t("exam-vault.label.untitled")}${w.exam_date ? `（${w.exam_date}）` : ""}`,
    ].filter(Boolean).join("\n");
    setTeacherChat({
      agentId,
      unitLabel: `❌ ${t("exam-vault.stats.qSuffix")} ${w.qno ?? "?"}${w.unit ? ` · ${w.unit}` : ""}`,
      kickoff: { text: ctx, seq: Date.now() },
    });
  };

  if (!visible) return null;

  const statusBadge = (s: string) => s === "parsing" ? "🔵" : s === "pending_review" ? "🟡" : s === "published" ? "🟢" : "🔴";
  const statusText = (s: string) => s === "parsing" ? t("exam-vault.status.parsing") : s === "pending_review" ? t("exam-vault.status.review") : s === "published" ? t("exam-vault.status.published") : s === "parse_failed" ? t("exam-vault.status.failed") : s;

  // 疑點分數：讀不清（is_correct null）最重，低信心次之；同分則逐頁逐題
  const suspectScore = (q: Q) => (q.is_correct == null ? 2 : 0) + (q.confidence == null || q.confidence < 0.7 ? 1 : 0);
  const reviewQuestions = reviewExam
    ? (suspectFirst
        ? [...reviewExam.questions].sort((a, b) => suspectScore(b) - suspectScore(a) || a.page - b.page || (a.qno || 0) - (b.qno || 0))
        : reviewExam.questions)
    : [];
  // 分數對照（校對流程的鐗：AI 判讀 vs 卷面分數，對不上 = 一定有讀錯）
  const stats = reviewExam
    ? {
        ok: reviewExam.questions.filter(q => q.is_correct === 1).length,
        wrong: reviewExam.questions.filter(q => q.is_correct === 0).length,
        unknown: reviewExam.questions.filter(q => q.is_correct == null).length,
      }
    : null;
  const scoreNum = reviewExam ? parseFloat(reviewExam.exam.score || "") : NaN;
  const impliedScore = stats && stats.ok + stats.wrong > 0 ? Math.round((stats.ok / (stats.ok + stats.wrong)) * 100) : null;
  const scoreMismatch = Number.isFinite(scoreNum) && impliedScore != null && Math.abs(scoreNum - impliedScore) > 10;

  const card = { background: theme.bg, border: `1px solid ${theme.borderLight}` };
  const btn = "px-3 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50";
  const input = "px-3 py-2 rounded-lg text-sm border outline-none";

  return (
    <div className="flex-1 flex flex-col min-h-0 relative" style={{ background: theme.bg, color: theme.text }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap" style={{ borderColor: theme.borderLight }}>
        <span className="text-lg">📜</span>
        <div className="flex gap-1">
          {([["inbox", "📥"], ["exams", "📚"], ["wrong", "❌"]] as const).map(([v, icon]) => (
            <button key={v} onClick={() => { setView(v === "exams" ? "exams" : v); if (v === "wrong") loadWrong(); }}
              className={`${btn} ${view === v || (v === "exams" && view === "review") ? "" : "opacity-60"}`}
              style={view === v || (v === "exams" && view === "review") ? { background: theme.accentBg, color: theme.accent } : {}}>
              {icon} {t(`exam-vault.tabs.${v}`)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <select value={subject} onChange={e => setSubject(e.target.value)} className={input} style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={() => setAssistOpen(v => !v)} className={btn}
          style={assistOpen ? { background: theme.accentBg, color: theme.accent } : { background: theme.bgMuted }}>🌤️ {t("exam-vault.ai.assist")}</button>
        <button onClick={doBackup} disabled={busy} className={btn} style={{ background: theme.bgMuted }}>☁️ {t("exam-vault.action.backup")}</button>
      </div>

      {(msg || err) && (
        <div className={`px-4 py-2 text-sm ${err ? "text-red-500" : "text-emerald-500"}`} onClick={() => flash(null, null)}>
          {err || msg} ▷ click to dismiss
        </div>
      )}

      <SplitChatLayout
        chatOpen={assistOpen}
        storageKey="examVault.assistWidth"
        borderLight={theme.borderLight}
        chat={
          <TeacherChatPanel
            agentId="my.assistant"
            unitLabel={t("exam-vault.ai.assistCtx")}
            fitContainer
            onClose={() => setAssistOpen(false)}
          />
        }
      >
      <div className="flex-1 overflow-auto p-4">
        {/* ═══ INBOX ═══ */}
        {view === "inbox" && (
          <div className="space-y-4">
            <div className="rounded-xl p-4 space-y-3" style={card}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("exam-vault.placeholder.title")} className={input} style={{ borderColor: theme.borderLight, background: theme.bgMuted }} />
                <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} className={input} style={{ borderColor: theme.borderLight, background: theme.bgMuted }} />
                <div className="text-xs self-center text-slate-400">{t("exam-vault.hint.inboxHint")}</div>
              </div>
              <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                onClick={() => fileRef.current?.click()}
                className="rounded-xl border-2 border-dashed p-8 text-center cursor-pointer"
                style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
                <div className="text-3xl mb-2">📷</div>
                <div className="text-sm">{t("exam-vault.hint.dropHint")}</div>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
              </div>
              {pages.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {pages.map((p, i) => (
                    <div key={i} className="relative w-20 h-28 rounded-lg overflow-hidden" style={{ border: `1px solid ${theme.borderLight}` }}>
                      <img src={p.preview} className="w-full h-full object-cover" />
                      <button onClick={e => { e.stopPropagation(); setPages(ps => ps.filter((_, j) => j !== i)); }}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs">✕</button>
                      <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center">{i + 1}</span>
                    </div>
                  ))}
                </div>
              )}
              <textarea value={urls} onChange={e => setUrls(e.target.value)} placeholder={t("exam-vault.placeholder.url")}
                rows={2} className={input + " w-full"} style={{ borderColor: theme.borderLight, background: theme.bgMuted }} />
              <button onClick={submitInbox} disabled={busy} className={`${btn} text-white`} style={{ background: theme.accent }}>
                {busy ? "…" : `🤖 ${t("exam-vault.action.submit")}`}
              </button>
            </div>
            <p className="text-xs text-slate-400 text-center">{t("exam-vault.hint.pipelineHint")}</p>
          </div>
        )}

        {/* ═══ EXAMS ═══ */}
        {(view === "exams" || view === "review") && (
          view === "review" && reviewExam ? null : (
            <div className="space-y-3">
              {exams.length === 0 && <p className="text-center text-sm text-slate-400 py-8">{t("exam-vault.empty.emptyExams")}</p>}
              {exams.map(e => (
                <div key={e.id} className="rounded-xl p-4 flex items-center gap-3 flex-wrap" style={card}>
                  <span className="text-xl">{statusBadge(e.status)}</span>
                  <div className="flex-1 min-w-[180px]">
                    <div className="font-medium text-sm">{e.title || t("exam-vault.label.untitled")} <span className="text-xs text-slate-400">{e.exam_date || ""}</span></div>
                    <div className="text-xs text-slate-400">
                      {statusText(e.status)}
                      {e.total_questions != null && ` · ${t("exam-vault.stats.qCount")}: ${e.total_questions}`}
                      {e.wrong_count != null && ` · ${t("exam-vault.stats.wrongCount")}: ${e.wrong_count}`}
                      {e.pending_count != null && e.pending_count > 0 && ` · ${t("exam-vault.stats.pendingCount")}: ${e.pending_count}`}
                      {e.score && ` · ${e.score}${t("exam-vault.stats.pts")}`}
                    </div>
                    {e.parse_note && <div className="text-xs text-slate-400 mt-0.5">{e.parse_note}</div>}
                  </div>
                  {e.status !== "published" && <button onClick={() => openReview(e.id)} className={`${btn} text-white`} style={{ background: theme.accent }}>{t("exam-vault.action.review")}</button>}
                  {e.status === "published" && <button onClick={() => openReview(e.id)} className={btn} style={{ background: theme.bgMuted }}>{t("exam-vault.action.view")}</button>}
                  {e.status !== "published" && <button onClick={async () => { await api(`/api/exam-vault/exams/${e.id}/reparse`, { method: "POST" }); loadExams(); }} className={btn} style={{ background: theme.bgMuted }}>🔄</button>}
                  {e.status !== "published" && <button onClick={() => delExam(e.id)} className={btn} style={{ background: theme.bgMuted }}>🗑</button>}
                </div>
              ))}
            </div>
          )
        )}

        {/* ═══ REVIEW ═══ */}
        {view === "review" && reviewExam && (
          <div className="max-w-6xl mx-auto space-y-3">
            <div className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={card}>
              <button onClick={() => setView("exams")} className={btn} style={{ background: theme.bgMuted }}>←</button>
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium text-sm">{statusBadge(reviewExam.exam.status)} {reviewExam.exam.title || t("exam-vault.label.untitled")} <span className="text-xs text-slate-400">{reviewExam.exam.exam_date || ""}</span></div>
                {reviewExam.exam.parse_note && <div className="text-xs text-slate-400">{reviewExam.exam.parse_note}</div>}
                {/* 分數對照：AI 判讀統計 vs 卷面分數（對不上 = 一定有讀錯，逐頁核） */}
                {stats && (
                  <div className={`text-xs mt-0.5 ${scoreMismatch ? "text-amber-500 font-medium" : "text-slate-400"}`}>
                    ✅ {stats.ok} · ❌ {stats.wrong} · ❓ {stats.unknown}
                    {impliedScore != null && <> · AI {t("exam-vault.stats.impliedScore")}: {impliedScore}{t("exam-vault.stats.pts")}</>}
                    {scoreMismatch && <> · ⚠️ {t("exam-vault.error.scoreMismatch")} {impliedScore} ≠ {Math.round(scoreNum)}</>}
                  </div>
                )}
              </div>
              {/* 卷面分數（校對可改；入庫後修正會同步 exam.json） */}
              <input value={reviewExam.exam.score || ""} onChange={e => setReviewExam({ ...reviewExam, exam: { ...reviewExam.exam, score: e.target.value } })}
                onBlur={e => e.target.value !== (reviewExam.exam.score || "") && saveExamMeta(reviewExam.exam.id, { score: e.target.value })}
                placeholder={t("exam-vault.placeholder.score")} className={input + " !w-24 text-center"} style={{ borderColor: theme.borderLight, background: theme.bgMuted }} />
              {reviewExam.questions.length > 0 && (
                <button onClick={() => setSuspectFirst(v => !v)} className={btn}
                  style={suspectFirst ? { background: theme.accentBg, color: theme.accent } : { background: theme.bgMuted }}
                  title={t("exam-vault.hint.suspectHint")}>
                  🧐 {t("exam-vault.label.suspectFirst")} {suspectFirst ? "ON" : "OFF"}
                </button>
              )}
              {reviewExam.exam.status !== "published" && (
                <button onClick={() => publish(reviewExam.exam.id)} disabled={busy || (reviewExam.questions.some(q => q.review_status === "pending") && reviewExam.questions.length > 0)}
                  className={`${btn} text-white`} style={{ background: theme.accent }}>
                  ✅ {t("exam-vault.action.publish")}{reviewExam.questions.filter(q => q.review_status === "pending").length > 0 ? ` (${t("exam-vault.stats.pendingCount")}: ${reviewExam.questions.filter(q => q.review_status === "pending").length})` : ""}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* 左：原卷頁圖 */}
              <div className="rounded-xl p-3" style={card}>
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setPageNum(p => Math.max(1, p - 1))} className={btn} style={{ background: theme.bgMuted }}>◀</button>
                  <span className="text-xs text-slate-400">{t("exam-vault.label.page")} {pageNum} / {reviewExam.exam.page_count}</span>
                  <button onClick={() => setPageNum(p => Math.min(reviewExam.exam.page_count, p + 1))} className={btn} style={{ background: theme.bgMuted }}>▶</button>
                </div>
                <img src={`/api/exam-vault/img?exam=${reviewExam.exam.id}&page=${pageNum}`} className="w-full rounded-lg" style={{ border: `1px solid ${theme.borderLight}` }} />
              </div>

              {/* 右：題目清單（校對合議 — 誰做都行） */}
              <div className="space-y-2">
                {reviewExam.questions.length === 0 && <p className="text-sm text-slate-400 p-4 text-center" style={card}>{t("exam-vault.empty.noQuestions")}</p>}
                {reviewQuestions.map(q => <QuestionCard key={q.id} q={q} units={units} theme={theme} t={t} onSave={saveQ} examPublished={reviewExam.exam.status === "published"} />)}
              </div>
            </div>
          </div>
        )}

        {/* ═══ WRONG ═══ */}
        {view === "wrong" && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <select value={wrongUnit} onChange={e => { setWrongUnit(e.target.value); setWrongConcept(""); }} className={input} style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
                <option value="">{t("exam-vault.filter.allUnits")}</option>
                {[...new Set(units.map(u => u.name))].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <select value={wrongConcept} onChange={e => setWrongConcept(e.target.value)} disabled={!wrongUnit} className={input} style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
                <option value="">{t("exam-vault.filter.allConcepts")}</option>
                {(units.find(u => u.name === wrongUnit)?.concepts || []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={wrongErr} onChange={e => setWrongErr(e.target.value)} className={input} style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
                <option value="">{t("exam-vault.error.allErrors")}</option>
                {ERROR_TYPES.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <button onClick={() => loadWrong()} className={btn} style={{ background: theme.bgMuted }}>🔄</button>
            </div>
            {wrong.length === 0 && <p className="text-center text-sm text-slate-400 py-8">{t("exam-vault.empty.emptyWrong")}</p>}
            {wrong.map(w => (
              <div key={w.id} className="rounded-xl p-3" style={card}>
                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
                  <span className="font-medium text-sm" style={{ color: theme.text }}>{w.exam_title || t("exam-vault.label.untitled")}</span>
                  {w.exam_date && <span>{w.exam_date}</span>}
                  {w.unit && <span className="px-2 py-0.5 rounded-full" style={{ background: theme.accentBg, color: theme.accent }}>{w.unit}</span>}
                  {w.concept && <span className="px-2 py-0.5 rounded-full" style={{ background: theme.bgMuted }}>·{w.concept}</span>}
                  {w.error_type && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-600">{w.error_type}</span>}
                  <button onClick={() => openWrongImg(w)} className="px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: theme.accentBg, color: theme.accent }}>🖼 {t("exam-vault.action.viewOriginal")}</button>
                  {SUBJECT_TEACHER[subjects.find(s => s.id === w.exam_subject)?.name || ""] && (
                    <>
                      <button onClick={() => askTeacher(w, "explain")} className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: theme.accentBg, color: theme.accent }}>📖 {t("exam-vault.action.askTeacher")}</button>
                      <button onClick={() => askTeacher(w, "variants")} className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: theme.bgMuted }}>🧬 {t("exam-vault.label.variants")}</button>
                    </>
                  )}
                </div>
                <div className="text-sm mt-2 line-clamp-3">#{w.qno ?? "?"} {w.question_text || `（第 ${w.qno} 題）`}</div>
                <div className="text-sm mt-1">✍️ {w.student_answer || "—"} → ✅ {w.correct_answer || "—"}</div>
                {w.evidence && <div className="text-xs text-slate-400 mt-1">🔎 {w.evidence}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
      </SplitChatLayout>

      {/* 老師 chat 浮動面板（錯題講解/變形題 — 與教室同款，不推走內容） */}
      {teacherChat && (
        <div className="absolute inset-y-0 right-0 z-30">
          <TeacherChatPanel
            key={teacherChat.kickoff.seq}
            agentId={teacherChat.agentId}
            unitLabel={teacherChat.unitLabel}
            kickoff={teacherChat.kickoff}
            onClose={() => setTeacherChat(null)}
          />
        </div>
      )}

      {/* 原圖對照 modal — 錯題 ↔ 原卷那一頁（點外部關閉） */}
      {wrongImg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setWrongImg(null)}>
          <div className="max-w-4xl w-full max-h-full flex flex-col rounded-2xl p-3 gap-2" style={{ background: theme.bg, color: theme.text }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium truncate flex-1">{wrongImg.q.exam_title || t("exam-vault.label.untitled")} · #{wrongImg.q.qno ?? "?"}{wrongImg.q.unit ? ` · ${wrongImg.q.unit}` : ""}</span>
              <button onClick={() => setWrongImg(p => p && { ...p, page: Math.max(1, p.page - 1) })} className={btn} style={{ background: theme.bgMuted }}>◀</button>
              <span className="text-xs text-slate-400">{t("exam-vault.label.page")} {wrongImg.page}/{wrongImg.pageCount}</span>
              <button onClick={() => setWrongImg(p => p && { ...p, page: Math.min(p.pageCount, p.page + 1) })} className={btn} style={{ background: theme.bgMuted }}>▶</button>
              <button onClick={() => setWrongImg(null)} className={btn} style={{ background: theme.bgMuted }}>✕</button>
            </div>
            <div className="flex-1 overflow-auto rounded-lg" style={{ border: `1px solid ${theme.borderLight}` }}>
              <img src={`/api/exam-vault/img?exam=${wrongImg.exam}&page=${wrongImg.page}`} className="w-full" />
            </div>
            <div className="text-sm">✍️ {wrongImg.q.student_answer || "—"} → ✅ {wrongImg.q.correct_answer || "—"}{wrongImg.q.error_type ? ` · ${wrongImg.q.error_type}` : ""}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionCard({ q, units, theme, t, onSave, examPublished }: {
  q: Q; units: Unit[]; theme: Theme; t: (k: string) => string;
  onSave: (qid: string, patch: Record<string, unknown>) => void; examPublished: boolean;
}) {
  const [unit, setUnit] = useState(q.unit || "");
  const [text, setText] = useState(q.question_text || "");
  const [sa, setSa] = useState(q.student_answer || "");
  const [ca, setCa] = useState(q.correct_answer || "");
  const [et, setEt] = useState(q.error_type || "");
  const [cpt, setCpt] = useState(q.concept || "");
  const reviewed = q.review_status !== "pending";
  const isCorrectVal = q.is_correct === 1 ? "1" : q.is_correct === 0 ? "0" : "";
  const suspect = (q.is_correct == null ? 2 : 0) + (q.confidence == null || q.confidence < 0.7 ? 1 : 0);

  const input = "px-2 py-1 rounded-md text-sm border outline-none w-full";
  const sel = { borderColor: theme.borderLight, background: theme.bgMuted };

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: theme.bg, border: `1px solid ${reviewed ? theme.accent : theme.borderLight}` }}>
      <div className="flex items-center gap-2">
        <span className="font-bold text-sm">#{q.qno ?? "?"}</span>
        <span className="text-xs text-slate-400">p{q.page}</span>
        {q.confidence != null && <span className="text-[10px] text-slate-400" title={q.evidence || ""}>{/* nosemgrep: jsx-not-internationalized — AI 品牌縮寫＋數據徽章（無翻譯意義） */}AI {Math.round((q.confidence || 0) * 100)}%</span>}
        {suspect > 0 && !reviewed && <span className="text-[10px] text-amber-500" title={t("exam-vault.hint.suspectHint")}>🧐</span>}
        <div className="flex-1" />
        {/* 對錯三態：校對定案（誰做都行 — 定調 2026-09-26） */}
        <select value={isCorrectVal} onChange={e => onSave(q.id, { isCorrect: e.target.value === "" ? null : e.target.value === "1" }) }
          className="px-2 py-1 rounded-md text-sm border" style={sel} disabled={examPublished}>
          <option value="">{t("exam-vault.state.unknown")}</option>
          <option value="1">✅ {t("exam-vault.label.correct")}</option>
          <option value="0">❌ {t("exam-vault.label.wrong")}</option>
        </select>
        {!examPublished && (
          <button onClick={() => onSave(q.id, { reviewStatus: "approved" })} disabled={reviewed && q.review_status === "approved"}
            className="px-2 py-1 rounded-md text-xs" style={{ background: reviewed ? theme.accentBg : theme.accent, color: reviewed ? theme.accent : "#fff" }}>
            {q.review_status === "approved" ? "✓" : t("exam-vault.action.approve")}
          </button>
        )}
        {reviewed && <span className="text-[10px] text-slate-400">{q.review_status === "approved" ? t("exam-vault.state.approved") : t("exam-vault.state.corrected")}</span>}
      </div>
      <input value={text} onChange={e => setText(e.target.value)} onBlur={() => text !== (q.question_text || "") && onSave(q.id, { questionText: text })}
        placeholder={t("exam-vault.placeholder.question")} className={input} style={sel} readOnly={examPublished} />
      <div className="grid grid-cols-3 gap-2">
        <select value={unit} onChange={e => setUnit(e.target.value)} onBlur={() => unit !== (q.unit || "") && onSave(q.id, { unit })}
          className={input} style={sel} disabled={examPublished}>
          <option value="">{t("exam-vault.placeholder.unit")}</option>
          {units.map(u => <option key={u.name} value={u.name}>{u.name}</option>)}
        </select>
        <input value={sa} onChange={e => setSa(e.target.value)} onBlur={() => sa !== (q.student_answer || "") && onSave(q.id, { studentAnswer: sa })}
          placeholder={t("exam-vault.placeholder.student")} className={input} style={sel} readOnly={examPublished} />
        <input value={ca} onChange={e => setCa(e.target.value)} onBlur={() => ca !== (q.correct_answer || "") && onSave(q.id, { correctAnswer: ca })}
          placeholder={t("exam-vault.placeholder.correct")} className={input} style={sel} readOnly={examPublished} />
      </div>
      <div className="flex gap-2 items-center">
        <select value={et} onChange={e => { setEt(e.target.value); onSave(q.id, { errorType: e.target.value }); }}
          className={input} style={sel} disabled={examPublished}>
          <option value="">{t("exam-vault.placeholder.error")}</option>
          {ERROR_TYPES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        {/* 知識點：跟著單元走（先選單元，這裡才亮）— server 驗證只能選 curriculum 既有 */}
        <select value={cpt} onChange={e => { setCpt(e.target.value); onSave(q.id, { concept: e.target.value }); }}
          disabled={!unit || examPublished} className={input} style={sel}>
          <option value="">{t("exam-vault.placeholder.concept")}</option>
          {(units.find(u => u.name === unit)?.concepts || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {q.evidence && <span className="text-[10px] text-slate-400 truncate flex-1" title={q.evidence}>🔎 {q.evidence}</span>}
      </div>
    </div>
  );
}
