import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@paaw-ui/i18n";
import { uiAlert, uiConfirm } from "@paaw-ui/components/ui/uiFeedback";
import type { QuizExamRow, QuizStatus, QuizTheme } from "./types";
import QuizComposer from "./QuizComposer";
import QuizRunner from "./QuizRunner";
import QuizReport from "./QuizReport";

type Props = {
  visible: boolean;
  theme: QuizTheme;
  /** 弱單元 jump → CurriculumView（LearningSpace.openCurriculum 聯動） */
  onJumpCurriculum: (subjectKey: string, unitId?: number) => void;
};

type View = { kind: "list" } | { kind: "compose" } | { kind: "run"; examId: string } | { kind: "report"; examId: string };

const STATUS_STYLE: Record<QuizStatus, { i18nKey: string; bg: string; color: string }> = {
  draft: { i18nKey: "quiz.status.draft", bg: "#8b8d9818", color: "#8b8d98" },
  ongoing: { i18nKey: "quiz.status.ongoing", bg: "#f5a52422", color: "#e8590c" },
  finished: { i18nKey: "quiz.status.finished", bg: "#30a46c18", color: "#30a46c" },
  abandoned: { i18nKey: "quiz.status.abandoned", bg: "#e5484d18", color: "#e5484d" },
};

const MODE_ICON: Record<string, string> = { unit: "📘", cap: "🏛️", remedial: "🔁" };

/**
 * 模擬考 workspace（ADR-004 P3，TASK-011）— quiz tab 進入點：
 * ④ 首屏歷史清單（點進報告、draft 可刪）＋ ①②③ 子頁路由。
 */
export default function QuizWorkspace({ visible, theme, onJumpCurriculum }: Props) {
  const { t: tt } = useI18n();
  const [view, setView] = useState<View>({ kind: "list" });
  const [rows, setRows] = useState<QuizExamRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/learning/quiz");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setRows(d.exams || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (visible && view.kind === "list") void loadList(); }, [visible, view.kind, loadList]);

  const deleteDraft = useCallback(async (id: string) => {
    if (!(await uiConfirm({ message: tt("quiz.action.deleteConfirm"), danger: true }))) return;
    try {
      const r = await fetch(`/api/learning/quiz/${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setRows(prev => prev.filter(x => x.id !== id));
    } catch (e: unknown) {
      uiAlert(e instanceof Error ? e.message : String(e), { error: true });
    }
  }, [tt]);

  const btn = { border: `1px solid ${theme.borderLight}`, background: theme.bgMuted };
  const chip = { border: `1px solid ${theme.borderLight}`, background: theme.bgMuted };

  // ── 子頁路由 ──
  if (view.kind === "compose") {
    return (
      <QuizComposer visible={visible} theme={theme}
        onCreated={examId => setView({ kind: "run", examId })}
        onCancel={() => setView({ kind: "list" })} />
    );
  }
  if (view.kind === "run") {
    return (
      <QuizRunner key={view.examId} examId={view.examId} visible={visible} theme={theme}
        onDone={examId => setView({ kind: "report", examId })}
        onExit={() => { setView({ kind: "list" }); void loadList(); }} />
    );
  }
  if (view.kind === "report") {
    return (
      <QuizReport key={view.examId} examId={view.examId} visible={visible} theme={theme}
        onBack={() => { setView({ kind: "list" }); void loadList(); }}
        onJumpCurriculum={onJumpCurriculum} />
    );
  }

  // ── ④ 首屏：歷史清單 ──
  return (
    <div className="flex-1 overflow-y-auto" style={{ color: theme.text }}>
      <div className="px-4 py-5 mx-auto max-w-3xl flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">🎯 {tt("quiz.header.title")}</h2>
            <p className="text-xs opacity-60 mt-0.5">{tt("quiz.empty.emptyHint")}</p>
          </div>
          <button onClick={() => setView({ kind: "compose" })}
            className="px-4 py-2 rounded-xl text-sm font-bold shrink-0" style={{ background: theme.accent, color: theme.accentBg }}>
            ＋ {tt("quiz.action.newExam")}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-3 text-sm rounded-xl px-3 py-2" style={{ background: "#e5484d18", color: "#e5484d" }}>
            <span className="flex-1">{tt("quiz.state.loadFail")}：{error}</span>
            <button onClick={() => void loadList()} className="px-3 py-1.5 rounded-lg text-xs" style={btn}>{tt("quiz.action.retry")}</button>
          </div>
        )}

        {loading && !rows.length && <div className="text-sm py-8 text-center opacity-60">{tt("quiz.state.loading")}</div>}

        {!loading && !rows.length && !error && (
          <div className="flex flex-col items-center gap-2 py-12 text-center opacity-70">
            <div className="text-3xl">🎯</div>
            <div className="text-sm">{tt("quiz.empty.emptyTitle")}</div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {rows.map(row => {
            const st = STATUS_STYLE[row.status] ?? STATUS_STYLE.draft;
            const modeIcon = MODE_ICON[row.mode] ?? "📘";
            return (
              <div key={row.id} className="rounded-2xl p-4 flex items-center gap-3 flex-wrap"
                style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>
                <div className="text-2xl shrink-0">{modeIcon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold truncate">{row.title}</span>
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px]" style={{ background: st.bg, color: st.color }}>{tt(st.i18nKey)}</span>
                    {row.overtime && <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px]" style={{ background: "#f5a52422", color: "#e8590c" }}>{tt("quiz.report.overtimeBadge")}</span>}
                  </div>
                  <div className="text-xs opacity-60 mt-1 flex items-center gap-2 flex-wrap">
                    <span>{new Date(row.createdAt).toLocaleString()}</span>
                    {row.total > 0 && <span>· {row.total} {tt("quiz.config.questionsUnit")}</span>}
                    {row.status === "finished" && row.correct != null && (
                      <span>· {tt("quiz.report.correctCount")} {row.correct}/{row.total}</span>
                    )}
                    {row.status === "ongoing" && row.answered != null && (
                      <span>· {tt("quiz.report.answeredCount")} {row.answered}/{row.total}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {row.status === "draft" && (
                    <>
                      <button onClick={() => setView({ kind: "run", examId: row.id })}
                        className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: theme.accent, color: theme.accentBg }}>
                        {tt("quiz.action.startExam")}
                      </button>
                      <button onClick={() => void deleteDraft(row.id)} className="px-3 py-2 rounded-lg text-xs" style={btn}>{tt("quiz.action.delete")}</button>
                    </>
                  )}
                  {row.status === "ongoing" && (
                    <button onClick={() => setView({ kind: "run", examId: row.id })}
                      className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: theme.accent, color: theme.accentBg }}>
                      {tt("quiz.action.continueExam")}
                    </button>
                  )}
                  {row.status === "finished" && (
                    <button onClick={() => setView({ kind: "report", examId: row.id })}
                      className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: theme.accent, color: theme.accentBg }}>
                      {tt("quiz.action.viewReport")}
                    </button>
                  )}
                  {row.status === "abandoned" && (
                    <button onClick={() => void deleteDraft(row.id)} className="px-3 py-2 rounded-lg text-xs" style={btn}>{tt("quiz.action.delete")}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
