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
