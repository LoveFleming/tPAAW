/**
 * ru_info repo — 一 RU 一行專案基本資訊（coding-db v2 前置，Fleming 2026-10-31 定案極簡版）
 *
 * 分工：repo_path/imported_at 程式寫；name/description 人寫；ai_* 只 AI 寫。
 * 程式寫入不覆蓋人的欄位；AI 更新只碰 ai_* + ai_updated_at。
 */
import { basename } from "path";
import { openCodingDb } from "./connection.mjs";

export function readRuInfo(ruRoot) {
  const db = openCodingDb(ruRoot);
  const ru = basename(ruRoot);
  return db.prepare("SELECT * FROM ru_info WHERE ru = ?").get(ru) || null;
}

/** 程式端 upsert：import / 建專案時呼叫。不覆蓋既有 name/description/ai_*。 */
export function upsertRuInfo(ruRoot, { name, description } = {}) {
  const db = openCodingDb(ruRoot);
  const ru = basename(ruRoot);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ru_info (ru, name, repo_path, description, imported_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(ru) DO UPDATE SET
      repo_path = excluded.repo_path,
      imported_at = COALESCE(ru_info.imported_at, excluded.imported_at)
  `).run(ru, name || ru, ruRoot, description || null, now);
  return readRuInfo(ruRoot);
}

/** 人寫欄位更新（UI 存檔） */
export function saveRuInfoFields(ruRoot, { name, description } = {}) {
  const db = openCodingDb(ruRoot);
  const ru = basename(ruRoot);
  upsertRuInfo(ruRoot, {});
  if (name !== undefined) db.prepare("UPDATE ru_info SET name = ? WHERE ru = ?").run(String(name), ru);
  if (description !== undefined) db.prepare("UPDATE ru_info SET description = ? WHERE ru = ?").run(String(description), ru);
  return readRuInfo(ruRoot);
}

/** AI 欄更新（只碰 ai_*，永遠蓋不到事實欄與人的欄位） */
export function saveRuAiFields(ruRoot, { ai_overview, ai_architecture } = {}) {
  const db = openCodingDb(ruRoot);
  const ru = basename(ruRoot);
  upsertRuInfo(ruRoot, {});
  const now = new Date().toISOString();
  if (ai_overview !== undefined) db.prepare("UPDATE ru_info SET ai_overview = ?, ai_updated_at = ? WHERE ru = ?").run(String(ai_overview), now, ru);
  if (ai_architecture !== undefined) db.prepare("UPDATE ru_info SET ai_architecture = ?, ai_updated_at = ? WHERE ru = ?").run(String(ai_architecture), now, ru);
  return readRuInfo(ruRoot);
}

/**
 * AI 產生 ai_overview/ai_architecture（CU 收尾 & ru-info ai-adjust 共用，2026-10-31）
 * 回傳更新後的 ru_info row；失敗 throw。
 */
export async function generateRuAiFields(ruRoot, { instruction = "初次掃描：請根據 repo 上下文產生兩個欄位", extraContext = "" } = {}) {
  const info = readRuInfo(ruRoot) || upsertRuInfo(ruRoot, {});
  let ctx = "";
  if (extraContext) ctx = extraContext + "\n";
  try {
    const { readFile, readdir } = await import("fs/promises");
    try { ctx += "package.json:\n" + (await readFile(ruRoot + "/package.json", "utf-8")).slice(0, 2000) + "\n"; } catch {}
    try { ctx += "頂層目錄: " + (await readdir(ruRoot)).filter(f => !f.startsWith(".")).slice(0, 30).join(", ") + "\n"; } catch {}
    try { ctx += "README 開頭:\n" + (await readFile(ruRoot + "/README.md", "utf-8")).slice(0, 1500); } catch {}
  } catch {}
  const { resolveLLMConfig } = await import("../../paaw-agent-loop.mjs");
  const { callLLMWithRetry } = await import("../../llm-utils.mjs");
  const llm = resolveLLMConfig(ruRoot, undefined, []);
  const r = await callLLMWithRetry(llm.apiUrl, llm.headers, {
    model: llm.model,
    messages: [
      { role: "system", content: "你是專案資訊卡助理。根據現值、使用者的調整指示與 repo 上下文，重寫專案的 ai_overview（一段話：這是什麼、做什麼用）與 ai_architecture（架構摘要，可用短列點）。只輸出 JSON：{\"ai_overview\": \"...\", \"ai_architecture\": \"...\"}，不要其他文字。除非指示特別說只改一個，兩個欄位都要輸出（沒必要的就沿用現值）。" },
      { role: "user", content: `現值：\nai_overview: ${info.ai_overview || "（空）"}\nai_architecture: ${info.ai_architecture || "（空）"}\ndescription（人寫的需求說明）: ${info.description || "（空）"}\n\nrepo 上下文：\n${ctx || "（無）"}\n\n調整指示：${instruction}` },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  }, { maxRetries: 2, timeoutMs: 180000, caller: "ru-info-ai", agentId: "coding.developer", disableThinking: true });
  const text = r?.content || "";
  const jm = text.match(/\{[\s\S]*\}/);
  if (!jm) throw new Error("AI 回覆不是 JSON");
  const parsed = JSON.parse(jm[0]);
  return saveRuAiFields(ruRoot, {
    ai_overview: parsed.ai_overview,
    ai_architecture: parsed.ai_architecture,
  });
}
