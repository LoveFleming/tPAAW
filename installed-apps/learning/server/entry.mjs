/**
 * learning module — server entry
 * 三條 route 原封不動（fork 同源簽名），URL 前綴維持原樣：
 * /api/exam-vault/*、/api/learning/quiz/*、/api/learning/curriculum|practice/*
 */
import examVault from "./routes/exam-vault.mjs";
import quizSession from "./routes/quiz-session.mjs";
import learningPractice from "./routes/learning-practice.mjs";

export default async function handler(req, res) {
  if (await examVault(req, res)) return true;
  if (await quizSession(req, res)) return true;
  if (await learningPractice(req, res)) return true;
  return false;
}
