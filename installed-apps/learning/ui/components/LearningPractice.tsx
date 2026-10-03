/**
 * LearningPractice — 每日練習 v1（2026-09-19 Wave 2）
 * 平板友善全螢幕作答頁：題目裁切圖 + 選答 + 即時回饋 + 今日進度。
 * 蓋在學習中心（LearningSpace）裡，鐵律：學生端零 shell、判定靠 server deterministic API。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@paaw-ui/i18n";

type Question = {
  questionKey: string;
  type: string;
  yearRoc?: number;
  questionNumber?: number;
  bookletPage?: number;
  crops: string[];
  isReview?: boolean;
};

type Theme = { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string };

function getSessionId(): string {
  try {
    const stored = localStorage.getItem("lp_session_id");
    if (stored) return stored;
    const id = (crypto as any).randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("lp_session_id", id);
    return id;
  } catch {
    return "s-anon";
  }
}

const CHOICES = ["A", "B", "C", "D"];

export default function LearningPractice({ rootPath, visible, theme, subjectOverride }: { rootPath?: string; visible: boolean; theme: Theme; subjectOverride?: string }) {
  const { t } = useI18n();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [textAns, setTextAns] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; correctChoice: string } | null>(null);
  const [results, setResults] = useState<{ questionKey: string; isCorrect: boolean }[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qStartRef = useRef<number>(Date.now());
  const loadKeyRef = useRef<string>("");

  const subject = subjectOverride || (() => {
    const parts = String(rootPath || "").split(/[\\/]/).filter(Boolean);
    const i = parts.lastIndexOf("subjects");
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
    return "math";
  })();

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDone(false);
    setResults([]);
    setIdx(0);
    setFeedback(null);
    setPicked(null);
    setTextAns("");
    try {
      const r = await fetch(`/api/learning/practice/today?subject=${encodeURIComponent(subject)}&count=10`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setQuestions(d.questions || []);
      loadKeyRef.current = `${d.date}-${subject}`;
      qStartRef.current = Date.now();
    } catch (e: any) {
      setError(e.message);
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  }, [subject]);

  useEffect(() => {
    if (visible && !loadKeyRef.current) loadToday();
  }, [visible, loadToday]);

  const q = questions[idx];

  const submit = async (answer: string) => {
    if (!q || submitting || feedback) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/learning/practice/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionKey: q.questionKey,
          answer,
          durationMs: Date.now() - qStartRef.current,
          sessionId: getSessionId(),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setFeedback({ isCorrect: d.isCorrect, correctChoice: d.correctChoice });
      setResults(prev => [...prev, { questionKey: q.questionKey, isCorrect: d.isCorrect }]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    setFeedback(null);
    setPicked(null);
    setTextAns("");
    qStartRef.current = Date.now();
    if (idx + 1 >= questions.length) setDone(true);
    else setIdx(idx + 1);
  };

  const correctCount = results.filter(r => r.isCorrect).length;

  // ── 載入中 / 錯誤 ──
  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm" style={{ color: theme.text }}>{t("practice.state.loading", "出題中…")}</div>;
  }
  if (error && !questions.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: theme.text }}>
        <div className="text-sm">{t("practice.state.loadError", "題組載入失敗")}：{error}</div>
        <button onClick={loadToday} className="px-4 py-2 rounded-lg text-sm" style={{ background: theme.accent, color: theme.accentBg }}>{t("practice.state.retry", "重試")}</button>
      </div>
    );
  }
  if (!questions.length) {
    return <div className="flex-1 flex items-center justify-center text-sm" style={{ color: theme.text }}>{t("practice.state.noQuestions", "這科還沒有題庫")}</div>;
  }

  // ── 完成畫面 ──
  if (done) {
    const pct = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6" style={{ color: theme.text }}>
        <div className="text-5xl">{pct >= 80 ? "🎉" : pct >= 60 ? "💪" : "🌱"}</div>
        <div className="text-xl font-bold">{t("practice.state.doneTitle", "今日練習完成！")}</div>
        <div className="text-base">{correctCount} / {questions.length}（{pct}%）</div>
        <div className="text-sm" style={{ opacity: 0.75 }}>{t("practice.hint.reviewNote", "答錯的題目會在 1 / 3 / 7 天後自動排入複習")}</div>
        <button onClick={loadToday} className="mt-2 px-5 py-2.5 rounded-xl text-sm font-medium" style={{ background: theme.accent, color: theme.accentBg }}>
          {t("practice.state.again", "再練一輪")}
        </button>
      </div>
    );
  }

  // ── 作答畫面 ──
  const progress = ((idx + (feedback ? 1 : 0)) / questions.length) * 100;
  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ color: theme.text }}>
      {/* 頂部進度 */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <span className="text-sm font-medium shrink-0">📝 {t("practice.header.title", "每日練習")}</span>
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: theme.bgMuted }}>
          <div className="h-full transition-all" style={{ width: `${progress}%`, background: theme.accent }} />
        </div>
        <span className="text-sm shrink-0" style={{ opacity: 0.7 }}>{idx + 1} / {questions.length}</span>
      </div>

      {error && <div className="px-4 pb-1 text-sm" style={{ color: "#e5484d" }}>{error}</div>}

      {/* 題目卡 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col items-center gap-4">
        <div className="w-full max-w-2xl rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
          <div className="flex items-center gap-2 text-sm" style={{ opacity: 0.7 }}>
            {q.isReview && <span className="px-1.5 py-0.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent }}>🔁 {t("practice.label.reviewTag", "複習")}</span>}
            {q.yearRoc ? <span>CAP {q.yearRoc}</span> : null} {/* nosemgrep: jsx-not-internationalized — CAP 會考縮寫＋民國年份字面 */}
            {q.bookletPage ? <span>· P.{q.bookletPage}</span> : null}
          </div>
          {q.crops.map((c, i) => (
            <img key={i} src={c} alt={`Q${idx + 1}-${i + 1}`} className="w-full rounded-lg" style={{ background: "#fff" }} draggable={false} />
          ))}
        </div>

        {/* 作答區 */}
        {q.type === "SINGLE_CHOICE" ? (
          <div className="w-full max-w-2xl grid grid-cols-2 gap-3">
            {CHOICES.map(ch => {
              const isPicked = picked === ch;
              const showRight = feedback && ch === feedback.correctChoice;
              const showWrong = feedback && isPicked && !feedback.isCorrect;
              return (
                <button
                  key={ch}
                  disabled={!!feedback || submitting}
                  onClick={() => { setPicked(ch); submit(ch); }}
                  className="py-4 rounded-xl text-sm font-semibold border-2 transition-active:scale-[0.98]"
                  style={{
                    borderColor: showRight ? "#30a46c" : showWrong ? "#e5484d" : isPicked ? theme.accent : theme.borderLight,
                    background: showRight ? "#30a46c22" : showWrong ? "#e5484d22" : isPicked ? theme.accentBg : theme.bg,
                    color: showRight ? "#30a46c" : showWrong ? "#e5484d" : theme.text,
                  }}
                >
                  {ch}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="w-full max-w-2xl flex gap-2">
            <input
              value={textAns}
              onChange={e => setTextAns(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && textAns.trim() && !feedback && !submitting) submit(textAns); }}
              disabled={!!feedback || submitting}
              placeholder={t("practice.form.answerPlaceholder", "輸入答案後按 Enter")}
              className="flex-1 px-4 py-3 rounded-xl border-2 text-sm outline-none"
              style={{ borderColor: theme.borderLight, background: theme.bg, color: theme.text }}
            />
            <button
              disabled={!textAns.trim() || !!feedback || submitting}
              onClick={() => submit(textAns)}
              className="px-5 rounded-xl text-sm font-medium disabled:opacity-40"
              style={{ background: theme.accent, color: theme.accentBg }}
            >
              {t("practice.action.submit", "送出")}
            </button>
          </div>
        )}

        {/* 即時回饋 */}
        {feedback && (
          <div className="w-full max-w-2xl rounded-2xl px-4 py-3 flex items-center justify-between" style={{ background: feedback.isCorrect ? "#30a46c22" : "#e5484d22" }}>
            <div className="text-base font-medium" style={{ color: feedback.isCorrect ? "#30a46c" : "#e5484d" }}>
              {feedback.isCorrect ? `✅ ${t("practice.state.correct", "答對了！")}` : `❌ ${t("practice.state.wrong", "答錯了")}　${t("practice.label.answerIs", "正解")}: ${feedback.correctChoice}`}
            </div>
            <button onClick={next} className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: theme.accent, color: theme.accentBg }}>
              {idx + 1 >= questions.length ? t("practice.state.finish", "完成") : t("practice.action.next", "下一題")} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
