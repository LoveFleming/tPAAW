import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@paaw-ui/i18n";
import type { ExamResponse, QuizReportData, QuizTheme } from "./types";
import { CHOICES, decodeAnswer } from "./types";

type Props = {
  examId: string;
  visible: boolean;
  theme: QuizTheme;
  onBack: () => void;
  /** 弱單元 jump → CurriculumView 聯動（同 openCurriculum(subjectKey, unitId?)） */
  onJumpCurriculum: (subjectKey: string, unitId?: number) => void;
};

const PROVIDER_BADGES: Record<string, { icon: string; i18nKey: string }> = {
  CAP: { icon: "🏛️", i18nKey: "quiz.provider.cap" },
  "concept-quiz": { icon: "📗", i18nKey: "quiz.provider.concept" },
  "ai-variant": { icon: "🤖", i18nKey: "quiz.provider.ai" },
  web: { icon: "🌐", i18nKey: "quiz.provider.web" },
  "school-exam": { icon: "🏫", i18nKey: "quiz.provider.school" },
};

const LEVEL_COLORS = { red: "#e5484d", yellow: "#f5a524", green: "#30a46c" } as const;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * ③ 成績報告（ADR-004 P3）：總分卡 + 各科卡 + 單元熱圖（弱單元 jump CurriculumView）
 * + 逐題回顧（題圖 / 我的答案 vs 正確 / 解說 / 出處徽章）+ flag 按鈕位（P4）
 * + 「錯題已排入 1/3/7 天複習」提示。
 */
export default function QuizReport({ examId, visible, theme, onBack, onJumpCurriculum }: Props) {
  const { t: tt } = useI18n();
  const [report, setReport] = useState<QuizReportData | null>(null);
  const [exam, setExam] = useState<ExamResponse | null>(null); // 快照（題圖/選項，finished 開放）
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [rR, rE] = await Promise.all([
        fetch(`/api/learning/quiz/${encodeURIComponent(examId)}/report`),
        fetch(`/api/learning/quiz/${encodeURIComponent(examId)}`),
      ]);
      const dR = await rR.json();
      if (!rR.ok) throw new Error(dR.error || `HTTP ${rR.status}`);
      setReport(dR as QuizReportData);
      if (rE.ok) {
        const dE = await rE.json();
        if (dE?.exam) setExam(dE as ExamResponse);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => { if (visible) void load(); }, [visible, load]);

  // questionKey → snapshot（題圖 / options / provider 顯示輔助）
  const snapMap = useMemo(() => {
    const m = new Map<string, ExamResponse["sections"][number]["questions"][number]["snapshot"]>();
    for (const sec of exam?.sections || []) {
      for (const q of sec.questions || []) m.set(q.questionKey, q.snapshot);
    }
    return m;
  }, [exam]);

  // jump 目標：unit 卷 → scope.subjectKey + unitId；cap 卷 → scope.subject（key）
  const jumpTarget = useMemo(() => {
    const scope = exam?.sections?.[0]?.scope;
    if (!scope) return null;
    if (scope.mode === "unit") return { subjectKey: scope.subjectKey || "", unitId: scope.unitId };
    if (scope.mode === "cap") return { subjectKey: scope.subject || "", unitId: undefined };
    return null;
  }, [exam]);

  if (loading && !report) {
    return <div className="flex-1 flex items-center justify-center text-sm" style={{ color: theme.text }}>{tt("quiz.state.loading")}</div>;
  }
  if (error && !report) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ color: theme.text }}>
        <div className="text-sm">{tt("quiz.state.loadFail")}：{error}</div>
        <div className="flex gap-2">
          <button onClick={() => void load()} className="px-4 py-2 rounded-lg text-sm" style={{ background: theme.accent, color: theme.accentBg }}>{tt("quiz.action.retry")}</button>
          <button onClick={onBack} className="px-4 py-2 rounded-lg text-sm" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>{tt("quiz.action.backToList")}</button>
        </div>
      </div>
    );
  }
  if (!report) return null;

  // 未 finished（防禦：list 只對 finished 開報告）
  if (report.exam.status !== "finished") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ color: theme.text }}>
        <div className="text-sm">{tt("quiz.modal.notFinished")}</div>
        <button onClick={onBack} className="px-4 py-2 rounded-lg text-sm" style={{ background: theme.accent, color: theme.accentBg }}>{tt("quiz.action.backToList")}</button>
      </div>
    );
  }

  const { score, sections, mastery, items } = report;
  const durationSec = report.exam.startedAt && report.exam.finishedAt
    ? Math.round((Date.parse(report.exam.finishedAt) - Date.parse(report.exam.startedAt)) / 1000)
    : null;
  const card = { background: theme.bgMuted, border: `1px solid ${theme.borderLight}` };
  const chip = { border: `1px solid ${theme.borderLight}`, background: theme.bgMuted };

  return (
    <div className="flex-1 overflow-y-auto" style={{ color: theme.text }}>
      {/* 頂條 */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5" style={{ background: theme.bg, borderBottom: `1px solid ${theme.borderLight}` }}>
        <button onClick={onBack} className="px-2.5 py-1.5 rounded-lg text-xs" style={chip}>← {tt("quiz.action.backToList")}</button>
        <span className="text-sm font-bold truncate px-2">{report.exam.title} · {tt("quiz.report.reportTitle")}</span>
        <span className="text-xs opacity-60">{fmtDate(report.exam.finishedAt)}</span>
      </div>

      <div className="px-4 py-5 mx-auto max-w-3xl flex flex-col gap-5">
        {/* 錯題複習提示（learner_attempt → 1/3/7 天佇列，P2 已回寫） */}
        {score.wrong > 0 && (
          <div className="rounded-xl px-4 py-3 text-sm flex items-center gap-2" style={{ background: "#30a46c18", color: "#30a46c" }}>
            <span>🔁</span>
            <span>{tt("quiz.report.reviewQueued")}</span>
            <b>{score.wrong}</b>
          </div>
        )}

        {/* 總分卡 */}
        <div className="rounded-2xl p-5 flex items-center gap-5" style={card}>
          <div className="text-center shrink-0">
            <div className="text-4xl font-black tabular-nums" style={{ color: theme.accent }}>{score.scorePct}</div>
            <div className="text-xs opacity-60 mt-1">{tt("quiz.report.scoreLabel")}</div>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <div>{tt("quiz.report.correctCount")} <b>{score.correct}</b> / {score.total}</div>
            <div className="opacity-70">{tt("quiz.report.unansweredCount")} {score.unanswered}</div>
            {durationSec != null && <div className="opacity-70">⏱ {fmtDuration(durationSec)}{report.exam.overtime ? ` · ${tt("quiz.report.overtimeBadge")}` : ""}</div>}
            {report.exam.overtime && <span className="self-start px-2 py-0.5 rounded-full text-[11px]" style={{ background: "#f5a52422", color: "#e8590c" }}>{tt("quiz.report.overtimeBadge")}</span>}
          </div>
        </div>

        {/* 各科卡 */}
        {sections.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold opacity-80">{tt("quiz.report.sectionsTitle")}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.map(sec => (
                <div key={sec.seq} className="rounded-2xl p-4 flex items-center justify-between" style={card}>
                  <div>
                    <div className="font-bold">{sec.subject}</div>
                    <div className="text-xs opacity-60 mt-0.5">{tt("quiz.report.correctCount")} {sec.correct} / {sec.questionCount}</div>
                  </div>
                  <div className="text-2xl font-black tabular-nums" style={{ color: sec.accuracyPct >= 60 ? "#30a46c" : sec.accuracyPct >= 40 ? "#f5a524" : "#e5484d" }}>
                    {sec.accuracyPct}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 單元熱圖（弱單元 jump CurriculumView） */}
        {mastery.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold opacity-80">{tt("quiz.report.masteryTitle")}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {mastery.map(m => (
                <div key={m.name} className="rounded-2xl p-4" style={{ borderLeft: `4px solid ${LEVEL_COLORS[m.level]}`, ...card }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-sm truncate">{m.name}</div>
                    <div className="text-sm font-bold tabular-nums shrink-0" style={{ color: LEVEL_COLORS[m.level] }}>{m.accuracyPct}%</div>
                  </div>
                  <div className="text-xs opacity-60 mt-1">{tt("quiz.report.correctCount")} {m.correct} / {m.total}</div>
                  {m.level !== "green" && jumpTarget?.subjectKey && (
                    <button onClick={() => onJumpCurriculum(jumpTarget.subjectKey, jumpTarget.unitId)}
                      className="mt-2 px-3 py-1.5 rounded-lg text-xs" style={chip}>
                      📖 {tt("quiz.report.jumpCurriculum")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 逐題回顧 */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold opacity-80">{tt("quiz.report.itemsTitle")}</h3>
          {items.map(it => {
            const snap = snapMap.get(it.questionKey);
            const hasOptions = Array.isArray(snap?.options) && (snap?.options?.length ?? 0) > 0;
            const my = decodeAnswer(it.myAnswer, hasOptions);
            const correct = decodeAnswer(it.correctAnswer, hasOptions);
            const badge = it.provider ? PROVIDER_BADGES[it.provider] : undefined;
            const open = openItem === it.seq;
            return (
              <div key={it.questionKey} className="rounded-2xl overflow-hidden" style={card}>
                <button onClick={() => setOpenItem(open ? null : it.seq)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-full text-xs font-bold"
                    style={{ background: it.isCorrect ? "#30a46c" : it.myAnswer ? "#e5484d" : theme.bg, color: it.isCorrect || it.myAnswer ? "#fff" : theme.text, border: `1px solid ${theme.borderLight}` }}>
                    {it.seq}
                  </span>
                  <span className="text-xs opacity-70 truncate flex-1">
                    {it.unitName || it.conceptName || ""}
                  </span>
                  <span className="text-xs font-bold shrink-0" style={{ color: it.isCorrect ? "#30a46c" : "#e5484d" }}>
                    {it.isCorrect ? "✓" : it.myAnswer ? "✗" : "—"}
                  </span>
                  {badge && <span className="text-xs shrink-0" title={it.providerLabel}>{badge.icon}</span>}
                  <span className="opacity-40 text-xs shrink-0">{open ? "▾" : "▸"}</span>
                </button>

                {open && (
                  <div className="px-4 pb-4 flex flex-col gap-3" style={{ borderTop: `1px solid ${theme.borderLight}` }}>
                    {/* 題面快照（題圖 + 文字題面 + 選項） */}
                    {(snap?.cropUrls || []).map((c, i) => (
                      <img key={i} src={c} alt={`Q${it.seq}-${i + 1}`} className="max-w-full rounded-xl" style={{ border: `1px solid ${theme.borderLight}` }} />
                    ))}
                    {snap?.questionMd && <div className="text-sm whitespace-pre-wrap leading-relaxed">{snap.questionMd}</div>}
                    {snap?.options && (
                      <ol className="text-sm list-none flex flex-col gap-1">
                        {snap.options.map((op, i) => {
                          const letter = CHOICES[i];
                          const isMy = my === letter;
                          const isCorrect = correct === letter;
                          return (
                            <li key={i} className="px-3 py-2 rounded-lg flex gap-2 items-start"
                              style={{
                                background: isCorrect ? "#30a46c18" : isMy ? "#e5484d18" : "transparent",
                                border: `1px solid ${isCorrect ? "#30a46c55" : isMy ? "#e5484d55" : theme.borderLight}`,
                              }}>
                              <b className="shrink-0">{letter}.</b>
                              <span>{op}</span>
                              {isMy && !isCorrect && <span className="ml-auto shrink-0 text-xs" style={{ color: "#e5484d" }}>{tt("quiz.report.myAnswer")}</span>}
                              {isCorrect && <span className="ml-auto shrink-0 text-xs" style={{ color: "#30a46c" }}>{tt("quiz.report.correctAnswer")}</span>}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                    {!snap?.options && (
                      <div className="flex gap-3 text-sm flex-wrap">
                        <span className="px-3 py-1.5 rounded-lg" style={{ background: my ? "#e5484d18" : theme.bg, border: `1px solid ${my ? "#e5484d55" : theme.borderLight}` }}>
                          {tt("quiz.report.myAnswer")}：{my ?? tt("quiz.report.noAnswer")}
                        </span>
                        <span className="px-3 py-1.5 rounded-lg" style={{ background: "#30a46c18", border: "1px solid #30a46c55" }}>
                          {tt("quiz.report.correctAnswer")}：{correct ?? "—"}
                        </span>
                      </div>
                    )}

                    {/* 出處徽章 + 解說 */}
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span className="px-2 py-1 rounded-full" style={chip}>
                        {badge ? `${badge.icon} ${tt(badge.i18nKey)}` : `❔ ${it.providerLabel}`}
                      </span>
                      {snap?.yearRoc != null && <span className="px-2 py-1 rounded-full" style={chip}>{snap.yearRoc}</span>}
                    </div>
                    {it.explanationMd && (
                      <div className="rounded-xl px-3 py-2.5 text-sm leading-relaxed" style={{ background: theme.bg, border: `1px solid ${theme.borderLight}` }}>
                        <b className="text-xs opacity-70 block mb-1">{tt("quiz.report.explanation")}</b>
                        <span className="whitespace-pre-wrap">{it.explanationMd}</span>
                      </div>
                    )}

                    {/* flag 按鈕位（P4 question_flag，先留殼） */}
                    <div className="flex justify-end">
                      <button disabled title={tt("quiz.report.flagSoon")} className="px-3 py-1.5 rounded-lg text-xs opacity-40 cursor-not-allowed" style={chip}>
                        ⚠️ {tt("quiz.report.flagIssue")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
