/**
 * CurriculumView — 課程內容檢視器（learning fork 2026-09-20）
 *
 * 側欄科目目錄樹點擊 → 開 curriculum tab 顯示三層內容：
 *   Subject（科目總覽）→ Unit（單元）→ Concept（知識點）
 *
 * 資料來自 LearningSpace 已抓取的 curriculum state（GET /api/learning/curriculum），零新增 API。
 * 一科一 tab（id = curr:{subjectKey}）；側欄重複點同一科的其他層級時，
 * LearningSpace 會更新 tab.data，本元件以 prop target 同步內部 view 狀態。
 */
import React, { useEffect, useMemo, useState } from "react";
import MarkdownText from "@paaw-ui/components/MarkdownText";
import TeacherChatPanel from "./TeacherChatPanel";
import SplitChatLayout from "./SplitChatLayout";
import { useI18n } from "@paaw-ui/i18n";

// ═══ 隨堂測驗（concept_question；題目來自 GET /api/learning/concept/:id/questions，提交判定走 practice/submit）═══
type QuizQ = { questionKey: string; seq: number; question: string; options: string[]; hasExplanation: boolean };
type QuizResult = { isCorrect: boolean; correctChoice: number; explanation: string | null };
const CHOICE_LABELS = ["A", "B", "C", "D"];

function QuizPanel({ conceptId }: { conceptId: number }) {
  const [questions, setQuestions] = useState<QuizQ[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [results, setResults] = useState<Record<string, QuizResult>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setQuestions(null); setAnswers({}); setResults({});
    fetch(`/api/learning/concept/${conceptId}/questions`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => { if (!cancelled) setQuestions(d.questions || []); })
      .catch(() => { if (!cancelled) setQuestions([]); });
    return () => { cancelled = true; };
  }, [conceptId]);

  if (questions === null) return null;
  if (questions.length === 0) return null;
  const answeredCount = Object.keys(results).length;
  const correctCount = Object.values(results).filter(r => r.isCorrect).length;

  const pick = async (q: QuizQ, choice: number) => {
    if (results[q.questionKey] || busy) return;
    setBusy(true);
    setAnswers(a => ({ ...a, [q.questionKey]: choice }));
    try {
      const r = await fetch("/api/learning/practice/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionKey: q.questionKey, answer: String(choice), confidence: "sure" }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setResults(rs => ({ ...rs, [q.questionKey]: { isCorrect: d.isCorrect, correctChoice: d.correctChoice, explanation: d.explanation || null } }));
    } catch {
      setAnswers(a => { const c = { ...a }; delete c[q.questionKey]; return c; }); // 失敗退選，可重試
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 px-5 py-4 mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-amber-800">🧪 隨堂測驗（{questions.length} 題）</div>
        {answeredCount > 0 && (
          <div className="text-sm text-amber-700">{answeredCount}/{questions.length} 已答 · 答對 {correctCount}</div>
        )}
      </div>
      <div className="space-y-4">
        {questions.map((q, qi) => {
          const res = results[q.questionKey];
          const picked = answers[q.questionKey];
          return (
            <div key={q.questionKey} className="rounded-lg bg-white border border-amber-100 px-4 py-3">
              <div className="text-base text-stone-800 font-medium mb-2">{qi + 1}. {q.question}</div>
              <div className="grid gap-1.5">
                {q.options.map((opt, oi) => {
                  const isPicked = picked === oi;
                  const isCorrectOpt = res && res.correctChoice === oi;
                  const cls = !res
                    ? isPicked
                      ? "border-blue-300 bg-blue-50 text-blue-800"
                      : "border-stone-200 bg-white text-stone-700 hover:border-blue-300 hover:text-blue-700"
                    : isCorrectOpt
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-medium"
                      : isPicked
                        ? "border-rose-300 bg-rose-50 text-rose-700"
                        : "border-stone-100 bg-white text-stone-400";
                  return (
                    <button key={oi} disabled={!!res || busy} onClick={() => pick(q, oi)}
                      className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors disabled:cursor-default ${cls}`}>
                      <span className="inline-block w-5 font-semibold">{CHOICE_LABELS[oi]}.</span>{opt}
                      {res && isCorrectOpt && <span className="ml-1.5">✓</span>}
                      {res && isPicked && !isCorrectOpt && <span className="ml-1.5">✗</span>}
                    </button>
                  );
                })}
              </div>
              {res && res.explanation && (
                <div className="mt-2 text-sm text-stone-600 bg-stone-50 border border-stone-100 rounded-lg px-3 py-2">
                  <span className="font-semibold">💡 詳解：</span>{res.explanation}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type CurriculumConcept = { id: number; name: string };
export type CurriculumUnit = { id: number; grade: number; semester: number; seq: number; name: string; conceptCount: number; concepts: CurriculumConcept[] };
export type CurriculumSubject = { key: string; name: string; unitCount: number; conceptCount: number; units: CurriculumUnit[] };
export type CurriculumTarget = { subjectKey: string; unitId?: number; conceptId?: number };

export const SUBJECT_EMOJI: Record<string, string> = {
  "數學": "📐", "國文": "📖", "英文": "🔤", "歷史": "🏺", "地理": "🌍",
  "公民": "⚖️", "地科": "🌋", "理化": "⚗️", "生物": "🧬",
};

// 科目 → 該科老師 crew（教室功能列第一位成員）
export const SUBJECT_TEACHER: Record<string, string> = {
  "數學": "teacher.math",
  "國文": "teacher.chinese",
  "英文": "teacher.english",
  "歷史": "teacher.history",
  "地理": "teacher.geography",
  "公民": "teacher.civics",
  "理化": "teacher.science",
  "地科": "teacher.science",
  "生物": "teacher.science",
};

const GRADE_LABELS: Record<number, string> = { 7: "七年級", 8: "八年級", 9: "九年級" };
function gradeLabel(g: number) { return GRADE_LABELS[g] || `G${g}`; }
function semLabel(s: number) { return s === 1 ? "上學期" : s === 2 ? "下學期" : `學期 ${s}`; }

interface Props {
  curriculum: CurriculumSubject[];
  target: CurriculumTarget;
  visible: boolean;
  /** 開該科練習本（呼叫 LearningSpace 的 openPractice） */
  onPractice: (subjectKey: string, subjectName: string) => void;
  /** 開檔（repo 相對路徑，如 subjects/math/README.md → file viewer tab） */
  onOpenFile: (path: string) => void;
  /** 試卷金庫錯題數（key = `${subjectKey}|${unitName}`，入庫卷累積） */
  wrongCounts?: Record<string, number>;
  /** 點「本單元錯 N 題」→ 開錯題本（帶科目+單元過濾） */
  onOpenWrongBook?: (subjectKey: string, unitName: string) => void;
  /** 專案根（傳給 TeacherChatPanel 啟用對話持久化；空 = 純記憶體聊天） */
  rootPath?: string;
}

/** 麵包屑節點（可點 vs 純文字） */
function Crumb({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  if (!onClick) return <span className="text-sm text-stone-500">{children}</span>;
  return (
    <button onClick={onClick}
      className="text-sm text-stone-500 hover:text-blue-600 hover:bg-blue-50 rounded px-1.5 py-0.5 -mx-1.5 transition-colors">
      {children}
    </button>
  );
}

/** 單元列表列（科目總覽與單元檢視共用視覺）— 有錯題加 ❌N 徽章（點徽章直開錯題本） */
function UnitRow({ u, onClick, wrongCount, onWrong }: { u: CurriculumUnit; onClick: () => void; wrongCount?: number; onWrong?: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-blue-50">
      <span className="text-sm text-stone-400 shrink-0 w-8 text-right">{u.seq}</span>
      <span className="text-sm text-stone-700 flex-1 truncate">{u.name}</span>
      {!!wrongCount && (
        <span onClick={e => { e.stopPropagation(); onWrong?.(); }}
          className="shrink-0 px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-[10px] font-medium hover:bg-red-100 transition-colors">❌{wrongCount}</span>
      )}
      <span className="text-sm text-stone-400 shrink-0">{u.concepts.length} 知識點</span>
      <span className="text-sm text-stone-300">›</span>
    </button>
  );
}

/** 上/下一單元導覽列 */
function UnitPager({ prev, next, goUnit }: { prev?: CurriculumUnit; next?: CurriculumUnit; goUnit: (id: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm border-t border-stone-100 pt-4">
      {prev ? (
        <button onClick={() => goUnit(prev.id)} className="text-stone-500 hover:text-blue-600 truncate max-w-[45%]">
          ← {gradeLabel(prev.grade)}{prev.semester === 1 ? "上" : "下"}·{prev.seq} {prev.name}
        </button>
      ) : <span />}
      {next ? (
        <button onClick={() => goUnit(next.id)} className="text-stone-500 hover:text-blue-600 truncate max-w-[45%] text-right">
          {gradeLabel(next.grade)}{next.semester === 1 ? "上" : "下"}·{next.seq} {next.name} →
        </button>
      ) : <span />}
    </div>
  );
}

export default function CurriculumView({ curriculum, target, visible, onPractice, onOpenFile, wrongCounts, onOpenWrongBook, rootPath }: Props) {
  const { t } = useI18n();
  // 內部導覽狀態：同一 tab 內點單元/知識點不換 tab；prop target 變動（側欄點擊）時同步
  const [view, setView] = useState<CurriculumTarget>(target);
  const [teacherOpen, setTeacherOpen] = useState(false);   // 教室功能列：老師 chat 面板
  useEffect(() => { setView(target); }, [target.subjectKey, target.unitId, target.conceptId]);

  const subject = useMemo(() => curriculum.find(s => s.key === view.subjectKey), [curriculum, view.subjectKey]);
  const units = useMemo(
    () => (subject ? [...subject.units].sort((a, b) => a.grade - b.grade || a.semester - b.semester || a.seq - b.seq) : []),
    [subject]
  );
  const unitIdx = useMemo(() => units.findIndex(u => u.id === view.unitId), [units, view.unitId]);
  const unit = unitIdx >= 0 ? units[unitIdx] : undefined;
  const concept = unit?.concepts.find(c => c.id === view.conceptId);
  // 該單元錯題數（試卷金庫入庫卷累積）
  const wrongCount = (u?: CurriculumUnit) => (wrongCounts && u ? wrongCounts[`${subject?.key}|${u.name}`] || 0 : 0);
  const openWrong = (u: CurriculumUnit) => onOpenWrongBook?.(subject?.key || "", u.name);

  // ── 知識點教學內容（GET /api/learning/concept/:id；content_md 由 sync-content 同步進 DB）──
  const [conceptMd, setConceptMd] = useState<string | null>(null);
  const [conceptLoading, setConceptLoading] = useState(false);
  const conceptId = unit && concept ? concept.id : undefined;
  useEffect(() => {
    if (conceptId == null) { setConceptMd(null); return; }
    let cancelled = false;
    setConceptLoading(true); setConceptMd(null);
    fetch(`/api/learning/concept/${conceptId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => { if (!cancelled) setConceptMd(d.contentMd || ""); })
      .catch(() => { if (!cancelled) setConceptMd(""); })
      .finally(() => { if (!cancelled) setConceptLoading(false); });
    return () => { cancelled = true; };
  }, [conceptId]);

  // ── 學期分組（grade × semester，依排序後順序去重）──
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ grade: number; semester: number; units: CurriculumUnit[] }> = [];
    for (const u of units) {
      const k = `${u.grade}-${u.semester}`;
      if (!seen.has(k)) { seen.add(k); out.push({ grade: u.grade, semester: u.semester, units: [] }); }
      out[out.length - 1].units.push(u);
    }
    return out;
  }, [units]);

  if (!visible) return null;

  if (!subject) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-sm text-stone-400">找不到科目（{view.subjectKey}）— 課程資料可能尚在載入</div>
      </div>
    );
  }

  const emoji = SUBJECT_EMOJI[subject.name] || "📘";
  const goSubject = () => setView({ subjectKey: subject.key });
  const goUnit = (unitId: number) => setView({ subjectKey: subject.key, unitId });
  const goConcept = (unitId: number, conceptId: number) => setView({ subjectKey: subject.key, unitId, conceptId });
  const practiceBtn = (
    <button onClick={() => onPractice(subject.key, subject.name)}
      className="text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-medium transition-colors">
      📝 開始練習（{subject.name}）
    </button>
  );

  // ═══ 老師 chat 上下文（學生正在看的頁面 → 注入對話；換頁即更新）═══
  const teacherId = SUBJECT_TEACHER[subject.name];
  const pageLabel = unit && concept
    ? `${emoji} ${subject.name} · ${unit.name} · ${concept.name}`
    : unit
      ? `${emoji} ${subject.name} · ${gradeLabel(unit.grade)}${semLabel(unit.semester)} 第 ${unit.seq} 單元 ${unit.name}`
      : `${emoji} ${subject.name} · 科目總覽`;
  const pageMd = (() => {
    if (unit && concept) {
      const head = `# ${concept.name}（${gradeLabel(unit.grade)} ${semLabel(unit.semester)} 第 ${unit.seq} 單元 ${unit.name}）`;
      return conceptLoading
        ? `${head}

（學生正要開啟此頁，內容載入中…）`
        : `${head}

${conceptMd || "（此知識點尚無教學內容）"}`;
    }
    if (unit) {
      const list = unit.concepts.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
      return `# 單元：${unit.name}（${gradeLabel(unit.grade)} ${semLabel(unit.semester)} 第 ${unit.seq} 單元）

本單元包含 ${unit.concepts.length} 個知識點：
${list}`;
    }
    return `# 科目：${subject.name}

學生目前在科目總覽頁：共 ${subject.unitCount} 個單元、${subject.conceptCount} 個知識點。`;
  })();

  // ═══ 三層內容（IIFE）— 外層共用 SplitChatLayout：老師 chat 跨 L1/L2/L3 保活不消失 ═══
  const contentEl = (() => {
  // ═══ Level 3：知識點 ═══
  if (unit && concept) {
    return (
      <div className="flex-1 overflow-y-auto bg-white" style={{ scrollbarWidth: "thin" }}>
        <div className="px-6 md:px-10 py-6">
          <div className="flex items-center gap-1.5 mb-1 text-sm text-stone-400">
            <Crumb onClick={goSubject}>{emoji} {subject.name}</Crumb>
            <span>›</span>
            <Crumb onClick={() => goUnit(unit.id)}>{gradeLabel(unit.grade)}{unit.semester === 1 ? "上" : "下"}·{unit.seq} {unit.name}</Crumb>
          </div>
          <h1 className="text-xl font-bold text-stone-800 mb-1">{concept.name}</h1>
          <div className="text-sm text-stone-400 mb-5">知識點 · 屬於「{unit.name}」（{gradeLabel(unit.grade)} {semLabel(unit.semester)} 第 {unit.seq} 單元）</div>

          <div className="mb-6">{practiceBtn}</div>

          {/* 教學內容（content_md）*/}
          {conceptLoading ? (
            <div className="text-sm text-stone-400 py-6 text-center">內容載入中…</div>
          ) : conceptMd ? (
            <div className="rounded-xl border border-stone-200 px-5 py-4 mb-8">
              <MarkdownText>{conceptMd}</MarkdownText>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-stone-200 px-5 py-6 mb-8 text-center text-sm text-stone-400">
              📝 此知識點向未匯入教學內容
            </div>
          )}

          <QuizPanel conceptId={concept.id} />

          <div className="text-sm font-semibold text-stone-400 mb-2">本單元其他知識點</div>
          <div className="flex flex-wrap gap-2 mb-8">
            {unit.concepts.map(c => (
              <button key={c.id}
                onClick={() => goConcept(unit.id, c.id)}
                className={`text-sm px-2.5 py-1.5 rounded-full border transition-colors ${
                  c.id === concept.id
                    ? "bg-blue-50 text-blue-700 border-blue-200 font-medium"
                    : "bg-white text-stone-600 border-stone-200 hover:border-blue-300 hover:text-blue-600"
                }`}>
                {c.name}
              </button>
            ))}
          </div>

          <UnitPager prev={unitIdx > 0 ? units[unitIdx - 1] : undefined}
            next={unitIdx < units.length - 1 ? units[unitIdx + 1] : undefined} goUnit={goUnit} />
        </div>
      </div>
    );
  }

  // ═══ Level 2：單元（教室）— bar 與老師 chat 已提升至外層共用 ═══
  if (unit) {
    return (
      <div className="flex-1 relative min-w-0 bg-white">
        <div className="absolute inset-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          <div className="px-6 md:px-10 py-6">
            <div className="flex items-center gap-1.5 mb-1 text-sm text-stone-400">
              <Crumb onClick={goSubject}>{emoji} {subject.name}</Crumb>
              <span>›</span>
              <span className="text-sm text-stone-400">{gradeLabel(unit.grade)} {semLabel(unit.semester)}</span>
            </div>
            <h1 className="text-xl font-bold text-stone-800 mb-1">{unit.name}</h1>
            <div className="text-sm text-stone-400 mb-5">
              單元 {unit.seq} · {gradeLabel(unit.grade)} {semLabel(unit.semester)} · {unit.concepts.length} 個知識點
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-2">{practiceBtn}
              {wrongCount(unit) > 0 && onOpenWrongBook && (
                <button onClick={() => openWrong(unit)}
                  className="text-sm px-4 py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors">
                  ❌ {t("exam-vault.hint.unitWrong")} {wrongCount(unit)} {t("exam-vault.stats.qSuffix")} → {t("exam-vault.tabs.wrong")}
                </button>
              )}
            </div>

            <div className="text-sm font-semibold text-stone-400 mb-2">知識點（點擊查看）</div>
            <div className="rounded-xl border border-stone-200 overflow-hidden mb-8">
              {unit.concepts.map((c, i) => (
                <button key={c.id} onClick={() => goConcept(unit.id, c.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    i > 0 ? "border-t border-stone-100" : ""
                  } hover:bg-blue-50`}>
                  <span className="text-sm text-stone-300 shrink-0 w-6 text-right">{i + 1}</span>
                  <span className="text-sm text-stone-700 flex-1">{c.name}</span>
                  <span className="text-sm text-stone-300">›</span>
                </button>
              ))}
            </div>

            <UnitPager prev={unitIdx > 0 ? units[unitIdx - 1] : undefined}
              next={unitIdx < units.length - 1 ? units[unitIdx + 1] : undefined} goUnit={goUnit} />
          </div>
        </div>
      </div>
    );
  }

  // ═══ Level 1：科目總覽 ═══
  return (
    <div className="flex-1 overflow-y-auto bg-white" style={{ scrollbarWidth: "thin" }}>
      <div className="px-6 md:px-10 py-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-3xl">{emoji}</span>
          <h1 className="text-xl font-bold text-stone-800">{subject.name}</h1>
        </div>
        <div className="text-sm text-stone-400 mb-5">{subject.unitCount} 個單元 · {subject.conceptCount} 個知識點</div>

        <div className="flex flex-wrap items-center gap-2 mb-8">
          {practiceBtn}
          <button onClick={() => onOpenFile(`subjects/${subject.key}/README.md`)}
            className="text-sm px-4 py-2 rounded-lg bg-stone-50 text-stone-600 border border-stone-200 hover:bg-stone-100 transition-colors">
            📄 科目說明（README）
          </button>
        </div>

        {groups.length === 0 && (
          <div className="text-sm text-stone-400 py-8 text-center">此科目尚無課綱資料</div>
        )}

        {groups.map(g => (
          <div key={`${g.grade}-${g.semester}`} className="mb-6">
            <div className="text-sm font-semibold text-stone-400 mb-2">
              {gradeLabel(g.grade)}・{semLabel(g.semester)}
            </div>
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              {g.units.map(u => <UnitRow key={u.id} u={u} onClick={() => goUnit(u.id)} wrongCount={wrongCount(u)} onWrong={() => openWrong(u)} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  })();

  return (
    <SplitChatLayout
      chatOpen={teacherOpen && !!teacherId}
      storageKey="curriculum.teacherChatWidth"
      borderLight="#e7e5e4"
      chat={teacherId ? (
        <TeacherChatPanel key={teacherId} fitContainer agentId={teacherId} unitLabel={pageLabel} pageMd={pageMd} rootPath={rootPath} onClose={() => setTeacherOpen(false)} />
      ) : null}
    >
      {/* 🏫 教室功能列 — 固定頂部（三層共通）：捲動教學內容不會把它捲走 */}
      <div className="shrink-0 flex items-center gap-2 px-4 md:px-6 h-12 border-b border-stone-100 bg-white">
        <span className="text-[11px] text-stone-300">🏫</span>
        {teacherId && (
          <button onClick={() => setTeacherOpen(v => !v)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors shrink-0 ${
              teacherOpen
                ? "bg-sky-600 text-white border-sky-600"
                : "bg-white text-stone-700 border-stone-200 hover:border-sky-300 hover:text-sky-700"
            }`}>
            <span>{emoji}</span>
            <span>{subject.name}{t("classroom.label.teacher")}</span>
          </button>
        )}
        <span className="text-xs text-stone-400 truncate hidden sm:inline">{pageLabel}</span>
        <span className="ml-auto text-[10px] text-stone-300 shrink-0">{t("classroom.label.bar")}</span>
      </div>
      {contentEl}
    </SplitChatLayout>
  );
}
