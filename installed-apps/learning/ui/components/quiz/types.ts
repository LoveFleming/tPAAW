/**
 * Quiz types — 模擬考（ADR-004 P3，TASK-011）
 * 對接後端 packages/server/src/routes/quiz-session.mjs（P2，TASK-010）。
 * 鐵律：correct 只存 DB，作答期間 API 白名單快照不含 explanationMd（TASK-013）。
 */

export type QuizStatus = "draft" | "ongoing" | "finished" | "abandoned";
export type QuizMode = "unit" | "cap" | "remedial";

export type QuizTheme = {
  bg: string;
  bgMuted: string;
  borderLight: string;
  accent: string;
  accentBg: string;
  text: string;
};

/** GET /api/learning/quiz/scope-options */
export type ScopeOptions = {
  subjects: Array<{
    key: string;
    name: string;
    unitCount: number;
    availableQuestions: number;
    units: Array<{
      id: number;
      grade: number;
      semester: number;
      seq: number;
      name: string;
      availableQuestions: number;
      concepts: Array<{ id: number; seq: number; name: string; availableQuestions: number }>;
    }>;
  }>;
  capPool: Array<{ key: string; name: string; availableQuestions: number }>;
};

/** quiz_item.snapshot_json 的客戶端白名單形狀（作答期間無 explanationMd） */
export type QuizSnapshot = {
  provider?: string | null;
  questionKey: string;
  questionMd?: string | null;
  options?: string[] | null;
  crops?: string[] | null;
  cropUrls?: string[] | null;
  yearRoc?: number | null;
  questionNumber?: number | null;
  bookletPage?: number | null;
  subject?: string | null;
  unitName?: string | null;
  conceptName?: string | null;
  explanationMd?: string | null; // 僅 finished 後（考後檢討）
};

/** GET /api/learning/quiz/:id ＋ POST /:id/start 的 examResponse */
export type ExamResponse = {
  exam: {
    id: string;
    title: string;
    mode: string;
    status: QuizStatus;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    durationLimitSec: number | null;
  };
  sections: Array<{
    seq: number;
    subject: string;
    scope: {
      mode: string;
      unitId?: number;
      unitName?: string;
      subject?: string;
      subjectKey?: string | null;
      grade?: number;
      semester?: number;
    };
    questionCount: number;
    durationLimitSec: number | null;
    questions: Array<{ seq: number; questionKey: string; snapshot: QuizSnapshot }>;
  }>;
};

/** POST /:id/start 的附加欄位 */
export type StartResponse = ExamResponse & {
  myAnswers: Array<{ seq: number; answer: string | null; answeredAt: string | null }>;
  timing: { startedAt: string; durationLimitSec: number | null; remainingSec: number | null };
};

/** GET /api/learning/quiz 歷史清單列 */
export type QuizExamRow = {
  id: string;
  title: string;
  mode: string;
  status: QuizStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationLimitSec: number | null;
  overtime: boolean | null;
  total: number;
  answered: number | null;
  correct: number | null;
};

/** POST /:id/submit 摘要 */
export type SubmitSummary = {
  id: string;
  status: "finished";
  overtime: boolean;
  finishedAt: string;
  score: {
    total: number;
    answered: number;
    correct: number;
    wrong: number;
    unanswered: number;
    scorePct: number;
  };
  reviewQueued: number;
};

/** GET /:id/report（finished） */
export type QuizReportData = {
  exam: { id: string; title: string; mode: string; status: QuizStatus; startedAt: string | null; finishedAt: string | null; durationLimitSec: number | null; overtime: boolean };
  score: { total: number; answered: number; correct: number; wrong: number; unanswered: number; scorePct: number };
  sections: Array<{ seq: number; subject: string; questionCount: number; answered: number; correct: number; accuracyPct: number }>;
  mastery: Array<{ name: string; total: number; correct: number; accuracyPct: number; level: "red" | "yellow" | "green" }>;
  items: Array<{
    seq: number;
    questionKey: string;
    provider: string | null;
    providerLabel: string;
    myAnswer: string | null;
    correctAnswer: string | null;
    isCorrect: boolean;
    answeredAt: string | null;
    durationMs: number | null;
    explanationMd: string | null;
    unitName: string | null;
    conceptName: string | null;
  }>;
};

export const CHOICES = ["A", "B", "C", "D"];

/**
 * 答案編碼（P2 契約）：concept 題（有 options）存 0-based 索引字串；CAP 題存字母。
 * hasOptions 以快照判斷（CAP options = null）。
 */
export function encodeAnswer(hasOptions: boolean, letter: string): string {
  return hasOptions ? String(CHOICES.indexOf(letter)) : letter;
}

/** 對 answers API 回傳值反解為顯示字母（'0'→'A'；'A'→'A'） */
export function decodeAnswer(raw: string | null | undefined, hasOptions: boolean): string | null {
  if (raw == null || raw === "") return null;
  if (!hasOptions) return raw;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < CHOICES.length ? CHOICES[n] : raw;
}
