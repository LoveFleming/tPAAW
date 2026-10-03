import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@paaw-ui/i18n";
import type { QuizMode, QuizTheme, ScopeOptions } from "./types";

type Props = {
  visible: boolean;
  theme: QuizTheme;
  onCreated: (examId: string) => void;
  onCancel: () => void;
};

type ScopePick =
  | { kind: "unit"; unitId: number; name: string; subjectKey: string; subjectName: string; available: number }
  | { kind: "cap"; subjectKey: string; name: string; available: number };

const DURATION_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 45, 60]; // 分鐘（0 = 不限時）

/**
 * ① 組卷精靈（ADR-004 P3）：模式 → 範圍（curriculum 樹 / CAP 科目）→ 題數/限時 → 建卷。
 * 一卷一 section（P2 API 契約：unit 單元卷 or cap 單科卷；多科組卷待後續 API 擴充）。
 * 題數不足擋建卷（spec：可用題數 < 設定題數 → disable）。
 */
export default function QuizComposer({ visible, theme, onCreated, onCancel }: Props) {
  const { t: tt } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<QuizMode>("unit");
  const [opts, setOpts] = useState<ScopeOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<ScopePick | null>(null);
  const [questionCount, setQuestionCount] = useState(10);
  const [durationMin, setDurationMin] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true); setLoadError(null);
    fetch("/api/learning/quiz/scope-options")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (alive) { setOpts(d); if (d.subjects?.length) setExpanded(new Set([d.subjects[0].key])); } })
      .catch(e => { if (alive) setLoadError(String(e.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [visible]);

  const chooseMode = useCallback((m: QuizMode) => {
    setMode(m); setPick(null); setStep(2); setCreateError(null);
    if (m === "unit") setQuestionCount(10);
    if (m === "cap") setQuestionCount(25);
  }, []);

  const toggleSubject = useCallback((key: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }, []);

  const canNextScope = pick !== null;
  const available = pick?.available ?? 0;
  const countShort = pick !== null && questionCount > available;

  const createExam = useCallback(async () => {
    if (!pick || countShort || creating) return;
    setCreating(true); setCreateError(null);
    try {
      const body: Record<string, unknown> = {
        mode: pick.kind,
        questionCount,
        durationLimitSec: durationMin > 0 ? durationMin * 60 : null,
      };
      if (pick.kind === "unit") body.unitId = pick.unitId;
      else body.subject = pick.subjectKey;
      const r = await fetch("/api/learning/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onCreated(d.exam.id);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [pick, questionCount, durationMin, countShort, creating, onCreated]);

  const card = (selected: boolean) => ({
    border: `1px solid ${selected ? theme.accent : theme.borderLight}`,
    background: selected ? theme.accentBg : theme.bg,
  });
  const chip = { border: `1px solid ${theme.borderLight}`, background: theme.bgMuted };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5" style={{ color: theme.text }}>
      <div className="mx-auto max-w-2xl flex flex-col gap-5">
        {/* 步驟指示 */}
        <div className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
          {([1, 2, 3] as const).map(n => (
            <div key={n} className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-full w-6 h-6 text-[11px] font-bold"
                style={{ background: step >= n ? theme.accent : theme.bgMuted, color: step >= n ? theme.accentBg : theme.text, border: `1px solid ${step >= n ? theme.accent : theme.borderLight}` }}>
                {n}
              </span>
              <span className={step === n ? "font-bold" : "opacity-60"}>
                {n === 1 ? tt("quiz.steps.stepMode") : n === 2 ? tt("quiz.steps.stepScope") : tt("quiz.steps.stepConfig")}
              </span>
              {n < 3 && <span className="opacity-30 mx-1">→</span>}
            </div>
          ))}
        </div>

        {/* Step 1 — 模式 */}
        {step === 1 && (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">{tt("quiz.steps.stepMode")}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <button onClick={() => chooseMode("unit")} className="rounded-2xl p-4 text-left transition hover:opacity-90" style={card(false)}>
                <div className="text-2xl">📘</div>
                <div className="font-bold mt-1">{tt("quiz.mode.unit")}</div>
                <div className="text-xs opacity-70 mt-1">{tt("quiz.mode.unitHint")}</div>
              </button>
              <button onClick={() => chooseMode("cap")} className="rounded-2xl p-4 text-left transition hover:opacity-90" style={card(false)}>
                <div className="text-2xl">🏛️</div>
                <div className="font-bold mt-1">{tt("quiz.mode.cap")}</div>
                <div className="text-xs opacity-70 mt-1">{tt("quiz.mode.capHint")}</div>
              </button>
              <div className="rounded-2xl p-4 opacity-50 cursor-not-allowed" style={card(false)}>
                <div className="text-2xl">🔁</div>
                <div className="font-bold mt-1">{tt("quiz.mode.remedial")}</div>
                <div className="text-xs mt-1 flex items-center gap-1">
                  <span className="px-1.5 py-0.5 rounded text-[10px]" style={chip}>{tt("quiz.hint.remedialSoon")}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2 — 範圍 */}
        {step === 2 && loading && <div className="text-sm py-8 text-center">{tt("quiz.state.loading")}</div>}
        {step === 2 && loadError && (
          <div className="flex flex-col items-center gap-3 py-8 text-sm">
            <div>{tt("quiz.state.loadFail")}：{loadError}</div>
            <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg text-sm" style={{ background: theme.accent, color: theme.accentBg }}>{tt("quiz.action.back")}</button>
          </div>
        )}
        {step === 2 && !loading && !loadError && opts && (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">
              {mode === "unit" ? tt("quiz.pick.unit") : tt("quiz.pick.subject")}
            </h2>
            <div className="text-xs opacity-60">{mode === "unit" ? tt("quiz.pick.unitHint") : tt("quiz.pick.subjectHint")}</div>

            {mode === "unit" && (
              <div className="flex flex-col gap-2">
                {(opts.subjects || []).filter(s => s.units?.length > 0).map(s => (
                  <div key={s.key} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.borderLight}` }}>
                    <button onClick={() => toggleSubject(s.key)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold"
                      style={{ background: theme.bgMuted }}>
                      <span>{s.name} <span className="opacity-60 font-normal">· {s.unitCount} {tt("quiz.config.unitCountLabel")}</span></span>
                      <span className="opacity-60">{expanded.has(s.key) ? "▾" : "▸"}</span>
                    </button>
                    {expanded.has(s.key) && (
                      <div className="flex flex-col">
                        {s.units.map(u => {
                          const selected = pick?.kind === "unit" && pick.unitId === u.id;
                          return (
                            <button key={u.id} onClick={() => setPick({ kind: "unit", unitId: u.id, name: u.name, subjectKey: s.key, subjectName: s.name, available: u.availableQuestions })}
                              className="flex items-center justify-between px-4 py-2.5 text-sm text-left" style={card(selected)}>
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="opacity-50 shrink-0">{u.grade}-{u.semester}</span>
                                <span className="truncate">{u.seq}. {u.name}</span>
                              </span>
                              <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px]" style={chip}>{tt("quiz.config.questionsAvailable")}{u.availableQuestions}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {mode === "cap" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {(opts.capPool || []).map(c => {
                  const selected = pick?.kind === "cap" && pick.subjectKey === c.key;
                  const empty = c.availableQuestions <= 0;
                  return (
                    <button key={c.key} disabled={empty} onClick={() => setPick({ kind: "cap", subjectKey: c.key, name: c.name, available: c.availableQuestions })}
                      className={`rounded-2xl p-4 text-left ${empty ? "opacity-40 cursor-not-allowed" : "transition hover:opacity-90"}`} style={card(selected)}>
                      <div className="font-bold">{c.name}</div>
                      <div className="text-xs opacity-70 mt-1">{tt("quiz.config.questionsAvailable")}{c.availableQuestions}</div>
                    </button>
                  );
                })}
                {!opts.capPool?.length && <div className="text-sm opacity-60 py-4 text-center">{tt("quiz.config.noCapPool")}</div>}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg text-sm" style={chip}>{tt("quiz.action.back")}</button>
              <button disabled={!canNextScope} onClick={() => setStep(3)}
                className={`px-5 py-2 rounded-lg text-sm font-bold ${canNextScope ? "" : "opacity-40 cursor-not-allowed"}`}
                style={{ background: theme.accent, color: theme.accentBg }}>{tt("quiz.action.next")}</button>
            </div>
          </div>
        )}

        {/* Step 3 — 題數 / 限時 */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">{tt("quiz.steps.stepConfig")}</h2>
            <div className="rounded-xl p-4 text-sm flex flex-col gap-3" style={{ border: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
              <div className="flex items-center justify-between">
                <span className="opacity-70">{tt("quiz.config.scopeLabel")}</span>
                <span className="font-bold">{pick ? `${pick.kind === "unit" ? `${pick.subjectName}｜${pick.name}` : pick.name}` : ""}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="opacity-70">{tt("quiz.config.questionsAvailable")}</span>
                <span className="font-bold">{available}</span>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-bold">{tt("quiz.config.questionCount")}</span>
              <input type="number" min={1} max={Math.max(available, 1)} value={questionCount}
                onChange={e => { const v = Number(e.target.value); setQuestionCount(Number.isFinite(v) && v > 0 ? Math.floor(v) : 1); }}
                className="px-3 py-2 rounded-lg w-32" style={{ background: theme.bg, border: `1px solid ${theme.borderLight}`, color: theme.text }} />
              {countShort && <span className="text-xs" style={{ color: "#e5484d" }}>{tt("quiz.config.questionsShort")} {available} {tt("quiz.config.questionsUnit")}</span>}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-bold">{tt("quiz.config.durationLimit")}</span>
              <select value={durationMin} onChange={e => setDurationMin(Number(e.target.value))}
                className="px-3 py-2 rounded-lg w-40" style={{ background: theme.bg, border: `1px solid ${theme.borderLight}`, color: theme.text }}>
                {DURATION_OPTIONS.map(m => (
                  <option key={m} value={m}>{m === 0 ? tt("quiz.config.noLimit") : `${m} ${tt("quiz.config.minutes")}`}</option>
                ))}
              </select>
            </label>

            {createError && <div className="text-sm rounded-lg px-3 py-2" style={{ color: "#e5484d", background: theme.bgMuted }}>{tt("quiz.state.createFail")}：{createError}</div>}

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => setStep(2)} className="px-4 py-2 rounded-lg text-sm" style={chip}>{tt("quiz.action.back")}</button>
              <button disabled={creating || !pick || countShort} onClick={createExam}
                className={`px-5 py-2 rounded-lg text-sm font-bold ${creating || !pick || countShort ? "opacity-40 cursor-not-allowed" : ""}`}
                style={{ background: theme.accent, color: theme.accentBg }}>
                {creating ? tt("quiz.state.creating") : tt("quiz.action.createExam")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
