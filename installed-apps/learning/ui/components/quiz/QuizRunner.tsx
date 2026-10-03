import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@paaw-ui/i18n";
import type { QuizTheme, StartResponse } from "./types";
import { CHOICES, encodeAnswer, decodeAnswer } from "./types";

type Props = {
  examId: string;
  visible: boolean;
  theme: QuizTheme;
  onDone: (examId: string) => void; // 交卷完成 → 前往報告
  onExit: () => void; // 返回清單（draft/ongoing 保留，之後可續考）
};

type FlatQ = {
  seq: number;
  sectionSubject: string;
  questionKey: string;
  hasOptions: boolean;
  questionMd: string | null;
  options: string[] | null;
  cropUrls: string[];
  yearRoc: number | null;
  questionNumber: number | null;
};

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * ② 作答頁（ADR-004 P3）— 重用 LearningPractice 平板作答樣式，考試模式：
 * 無即時回饋、可跳題回改（draft 逐題 PATCH /answer）、計時條（client 顯示、
 * 剩餘秒數以 server started_at 計算的 timing.remainingSec 為基準）、交卷確認對話框。
 */
export default function QuizRunner({ examId, visible, theme, onDone, onExit }: Props) {
  const { t: tt } = useI18n();
  const [exam, setExam] = useState<StartResponse | null>(null);
  const [questions, setQuestions] = useState<FlatQ[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const deadlineRef = useRef<number | null>(null); // local epoch ms；由 server remainingSec 換算
  const startedLocalRef = useRef<number | null>(null);

  // 載入卷 → start（draft 首考 / ongoing 冪等續考；abandoned 409 由錯誤處理顯示）
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/learning/quiz/${encodeURIComponent(examId)}/start`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const sr = d as StartResponse;
      setExam(sr);
      const flat: FlatQ[] = [];
      for (const sec of sr.sections || []) {
        for (const q of sec.questions || []) {
          flat.push({
            seq: q.seq,
            sectionSubject: sec.subject,
            questionKey: q.questionKey,
            hasOptions: Array.isArray(q.snapshot?.options) && q.snapshot.options.length > 0,
            questionMd: q.snapshot?.questionMd ?? null,
            options: q.snapshot?.options ?? null,
            cropUrls: q.snapshot?.cropUrls ?? [],
            yearRoc: q.snapshot?.yearRoc ?? null,
            questionNumber: q.snapshot?.questionNumber ?? null,
          });
        }
      }
      flat.sort((a, b) => a.seq - b.seq);
      setQuestions(flat);
      const m = new Map<number, string>();
      for (const a of sr.myAnswers || []) if (a.answer != null && a.answer !== "") m.set(a.seq, a.answer);
      setAnswers(m);
      // 計時基準：server timing（started_at + duration_limit 計算的 remainingSec）
      if (sr.timing && sr.timing.durationLimitSec && sr.timing.remainingSec != null) {
        deadlineRef.current = Date.now() + sr.timing.remainingSec * 1000;
        startedLocalRef.current = Date.now() - (sr.timing.durationLimitSec - sr.timing.remainingSec) * 1000;
      } else {
        deadlineRef.current = null;
        startedLocalRef.current = Date.now();
      }
      // 第一個未作答題定位（續考體驗）
      const firstUnanswered = flat.find(q => !m.has(q.seq));
      setIdx(firstUnanswered ? flat.indexOf(firstUnanswered) : 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => { if (visible) void load(); }, [visible, load]);

  // 計時 tick
  useEffect(() => {
    if (!visible) return;
    const h = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(h);
  }, [visible]);

  const remainingSec = useMemo(() => {
    if (deadlineRef.current == null) return null;
    return Math.max(0, Math.round((deadlineRef.current - nowMs) / 1000));
  }, [nowMs]);
  const elapsedSec = useMemo(() => {
    if (startedLocalRef.current == null) return 0;
    return Math.max(0, Math.round((nowMs - startedLocalRef.current) / 1000));
  }, [nowMs]);
  const timeUp = remainingSec !== null && remainingSec <= 0;

  const q = questions[idx];
  const answeredCount = answers.size;
  const total = questions.length;

  // 選答（本地即時 + PATCH draft；考試模式無對錯回饋）
  const pick = useCallback((letter: string) => {
    if (!q || submitting) return;
    setAnswers(prev => { const n = new Map(prev); n.set(q.seq, encodeAnswer(q.hasOptions, letter)); return n; });
    setSaveErr(null);
    fetch(`/api/learning/quiz/${encodeURIComponent(examId)}/answer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seq: q.seq, answer: encodeAnswer(q.hasOptions, letter) }),
    }).then(r => r.json().then(d => ({ ok: r.ok, d }))).then(({ ok, d }) => {
      if (!ok) setSaveErr(d.error || `HTTP ${d.status ?? ""}`);
    }).catch(() => setSaveErr(tt("quiz.state.saveFail")));
  }, [q, examId, submitting, tt]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try {
      const r = await fetch(`/api/learning/quiz/${encodeURIComponent(examId)}/submit`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onDone(examId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }, [examId, onDone, submitting]);

  // ── 載入中 / 錯誤 ──
  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm" style={{ color: theme.text }}>{tt("quiz.state.loading")}</div>;
  }
  if (error && !questions.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ color: theme.text }}>
        <div className="text-sm">{tt("quiz.state.loadFail")}：{error}</div>
        <div className="flex gap-2">
          <button onClick={() => void load()} className="px-4 py-2 rounded-lg text-sm" style={{ background: theme.accent, color: theme.accentBg }}>{tt("quiz.action.retry")}</button>
          <button onClick={onExit} className="px-4 py-2 rounded-lg text-sm" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>{tt("quiz.action.backToList")}</button>
        </div>
      </div>
    );
  }
  if (!q || !exam) {
    return <div className="flex-1 flex items-center justify-center text-sm" style={{ color: theme.text }}>{tt("quiz.empty.noQuestions")}</div>;
  }

  const myLetter = q.hasOptions ? decodeAnswer(answers.get(q.seq), true) : (answers.get(q.seq) ?? null);
  const danger = timeUp || (remainingSec !== null && remainingSec <= 60);
  const bar = { border: `1px solid ${theme.borderLight}`, background: theme.bgMuted };
  const chip = { border: `1px solid ${theme.borderLight}`, background: theme.bgMuted };

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ color: theme.text }}>
      {/* 頂條：標題 + 計時 + 交卷 */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onExit} className="px-2.5 py-1.5 rounded-lg text-xs shrink-0" style={chip}>← {tt("quiz.action.backToList")}</button>
          <span className="text-sm font-bold truncate">{exam.exam.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {remainingSec !== null ? (
            <span className={`px-3 py-1.5 rounded-lg text-sm font-bold tabular-nums ${danger ? "animate-pulse" : ""}`}
              style={{ background: timeUp ? "#e5484d" : danger ? "#f5a52422" : theme.bgMuted, color: timeUp ? "#fff" : danger ? "#e8590c" : theme.text, border: `1px solid ${theme.borderLight}` }}>
              ⏱ {timeUp ? tt("quiz.modal.timeUp") : fmtClock(remainingSec)}
            </span>
          ) : (
            <span className="px-3 py-1.5 rounded-lg text-sm tabular-nums" style={chip}>⏱ {fmtClock(elapsedSec)}</span>
          )}
          <button onClick={() => setConfirming(true)} disabled={submitting}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold ${submitting ? "opacity-40" : ""}`}
            style={{ background: theme.accent, color: theme.accentBg }}>{tt("quiz.action.submitExam")}</button>
        </div>
      </div>

      {/* 題目導航（跳題 / 回改） */}
      <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto shrink-0" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
        {questions.map((qq, i) => {
          const answered = answers.has(qq.seq);
          const cur = i === idx;
          return (
            <button key={qq.seq} onClick={() => setIdx(i)}
              className="w-8 h-8 shrink-0 rounded-lg text-xs font-bold transition"
              style={{
                border: `1px solid ${cur ? theme.accent : theme.borderLight}`,
                background: cur ? theme.accent : answered ? theme.accentBg : theme.bgMuted,
                color: cur ? theme.accentBg : theme.text,
              }}>
              {qq.seq}
            </button>
          );
        })}
        <span className="text-xs opacity-60 ml-2 shrink-0">{tt("quiz.report.answeredCount")} {answeredCount}/{total}</span>
      </div>

      {timeUp && (
        <div className="px-4 py-2 text-xs shrink-0" style={{ background: "#e5484d22", color: "#e5484d" }}>{tt("quiz.modal.timeUpHint")}</div>
      )}
      {saveErr && (
        <div className="px-4 py-2 text-xs shrink-0" style={{ background: "#f5a52422", color: "#e8590c" }}>{tt("quiz.state.saveError")}：{saveErr}</div>
      )}
      {error && (
        <div className="px-4 py-2 text-xs shrink-0" style={{ background: "#e5484d22", color: "#e5484d" }}>{error}</div>
      )}

      {/* 題面（平板大按鈕樣式，重用 LearningPractice 風格） */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl flex flex-col gap-5">
          <div className="flex items-center gap-2 text-xs opacity-60">
            <span className="px-2 py-0.5 rounded-full" style={chip}>{q.sectionSubject}</span>
            <span>{tt("quiz.config.questionSeq")} {q.seq} / {total}</span>
            {q.yearRoc != null && <span>· {q.yearRoc}</span>}
          </div>

          <div className="rounded-2xl p-5" style={{ background: theme.bg, border: `1px solid ${theme.borderLight}` }}>
            <div className="text-base font-bold mb-3">{q.seq}. {tt("quiz.view.pickOne")}</div>
            {q.questionMd && <div className="text-sm whitespace-pre-wrap mb-3 leading-relaxed">{q.questionMd}</div>}
            {q.cropUrls.map((c, i) => (
              <img key={i} src={c} alt={`Q${q.seq}-${i + 1}`} className="max-w-full rounded-xl mb-2" style={{ border: `1px solid ${theme.borderLight}` }} />
            ))}
            {q.options && (
              <div className="text-xs opacity-60 mt-1">{tt("quiz.view.optionsHint")}</div>
            )}
          </div>

          {/* 選項 — 考試模式：選中 = accent，無對錯色 */}
          <div className={`grid gap-3 ${q.options ? "grid-cols-1" : "grid-cols-2"}`}>
            {CHOICES.map((letter, i) => {
              const sel = myLetter === letter;
              return (
                <button key={letter} onClick={() => pick(letter)}
                  className="rounded-2xl px-4 py-4 text-left text-base transition flex items-start gap-3"
                  style={{
                    border: `2px solid ${sel ? theme.accent : theme.borderLight}`,
                    background: sel ? theme.accentBg : theme.bg,
                  }}>
                  <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm"
                    style={{ background: sel ? theme.accent : theme.bgMuted, color: sel ? theme.accentBg : theme.text }}>
                    {letter}
                  </span>
                  {q.options?.[i] && <span className="leading-relaxed">{q.options[i]}</span>}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-1 pb-8">
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold ${idx === 0 ? "opacity-30 cursor-not-allowed" : ""}`} style={bar}>
              ← {tt("quiz.nav.prevQ")}
            </button>
            {idx + 1 < total ? (
              <button onClick={() => setIdx(i => Math.min(total - 1, i + 1))}
                className="px-5 py-2.5 rounded-xl text-sm font-bold" style={{ background: theme.accent, color: theme.accentBg }}>
                {tt("quiz.nav.nextQ")} →
              </button>
            ) : (
              <button onClick={() => setConfirming(true)}
                className="px-5 py-2.5 rounded-xl text-sm font-bold" style={{ background: theme.accent, color: theme.accentBg }}>
                {tt("quiz.action.submitExam")} ✓
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 交卷確認對話框 */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={e => { if (e.target === e.currentTarget && !submitting) setConfirming(false); }}>
          <div className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-4" style={{ background: theme.bg, border: `1px solid ${theme.borderLight}`, color: theme.text }}>
            <div className="text-base font-bold">{tt("quiz.modal.submitConfirmTitle")}</div>
            <div className="text-sm opacity-80">
              {tt("quiz.modal.submitConfirmBody")}
              <br />
              {tt("quiz.report.answeredCount")} <b>{answeredCount}</b> / {total}
              {total - answeredCount > 0 && <span style={{ color: "#e8590c" }}>（{tt("quiz.report.unansweredCount")}{total - answeredCount}）</span>}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} disabled={submitting} className="px-4 py-2 rounded-lg text-sm" style={chip}>{tt("quiz.action.cancel")}</button>
              <button onClick={() => void submit()} disabled={submitting}
                className={`px-4 py-2 rounded-lg text-sm font-bold ${submitting ? "opacity-40" : ""}`}
                style={{ background: theme.accent, color: theme.accentBg }}>
                {submitting ? tt("quiz.state.submitting") : tt("quiz.action.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
