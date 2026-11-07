/**
 * api-map.mjs — API-first 掃描共用入口（2026-11-01 Fleming 定案：feature map 退役）
 *
 * 產出 api_features 表（一列 = 一個後端進入點）+ fileApiMap 反向索引 + api-map.json marker。
 * 使用者：CU api-map 步驟（coding.mjs）、auto-dispatch api-map-refresh（refreshApiMap）。
 */
import { join } from "path";
import { readFileSync } from "fs";
import { readDoc, writeDoc } from "./coding-db/docs.repo.mjs";
import { openCodingDb } from "./coding-db/connection.mjs";
import { saveApiFeatures, buildFileApiMap } from "./coding-db/api-features.repo.mjs";
import { todayStamp } from "./feature-registry.mjs";

/** apiId 存在驗證（task 開單歸屬用） */
export function apiExists(projRoot, apiId) {
  try {
    const db = openCodingDb(projRoot);
    return !!db.prepare("SELECT 1 FROM api_features WHERE id=?").get(apiId);
  } catch { return false; }
}

/** 讀 gen-api-map prompt（.paaw override > ai-settings > data/prompts） */
export function loadApiMapPrompt(projRoot, dataHome) {
  const candidates = [
    join(projRoot, ".paaw", "prompts", "code-understanding", "gen-api-map.md"),
    join(dataHome, "ai-settings", "coding", "gen-api-map.md"),
    join(dataHome, "prompts", "code-understanding", "gen-api-map.md"),
  ];
  for (const p of candidates) { try { return readFileSync(p, "utf-8"); } catch {} }
  return "";
}

/** LLM 輸出 → api feature 陣列（entry 去重、白名單清洗、A-id 派號） */
export function normalizeApiFeatures(apis, repairFn) {
  let list = apis;
  if (!Array.isArray(list)) list = [];
  const prefix = `A${todayStamp()}-`;
  const now = new Date().toISOString();
  const seen = new Set();
  const clean = [];
  for (const a of list) {
    if (!a || typeof a.entry !== "string" || !a.entry.trim()) continue;
    const entry = a.entry.trim();
    if (seen.has(entry)) continue;
    seen.add(entry);
    clean.push({
      id: a.id && /^A\d{8}-\d{3}$/.test(a.id) ? a.id : `${prefix}${String(clean.length + 1).padStart(3, "0")}`,
      category: a.category || "uncategorized",
      entry,
      name: a.name || entry,
      description: a.description || null,
      bizLogic: a.bizLogic || null,
      processFlow: Array.isArray(a.processFlow) ? a.processFlow : [],
      validation: Array.isArray(a.validation) ? a.validation : [],
      dataTouch: Array.isArray(a.dataTouch) ? a.dataTouch : [],
      aiUnderstanding: a.aiUnderstanding || "",
      codeFiles: Array.isArray(a.codeFiles) ? a.codeFiles : [],
      tests: Array.isArray(a.tests) ? a.tests : [],
      severity: a.severity || null,
      custom: a.custom && typeof a.custom === "object" ? a.custom : {},
      createdAt: a.createdAt || now,
      updatedAt: now,
    });
  }
  return clean;
}

/** 完整 api-map 產出（tree-sitter + prompt + LLM + parse + save）。callLLM(messages, opts) 由呼叫者注入。 */
export async function generateApiMap({ projRoot, dataHome, paawWriteFile, callLLM, parseProjectFn, formatCondensedFn, formatForAIFn, repairJsonArrayFn, onProgress }) {
  const prompt = loadApiMapPrompt(projRoot, dataHome);
  if (!prompt) throw new Error("gen-api-map.md prompt 不存在");
  let fullPrompt = prompt;
  let tsStats = null;
  if (parseProjectFn && formatCondensedFn) {
    try {
      onProgress?.("Tree-sitter 掃描中...");
      const tsResult = await parseProjectFn(projRoot);
      tsStats = tsResult.stats;
      const condensed = formatCondensedFn(tsResult);
      const trimmed = condensed.length > 80_000 ? condensed.slice(0, 80_000) + "\n... (truncated)" : condensed;
      if (trimmed) fullPrompt += `\n\n--- SOURCE ANALYSIS (Tree-sitter) ---\n${trimmed}`;
      if (paawWriteFile && formatForAIFn) { try { await paawWriteFile("features/tree-sitter-analysis.txt", formatForAIFn(tsResult)); } catch {} }
    } catch (e) { onProgress?.(`Tree-sitter failed (non-fatal): ${e.message}`); }
  }
  onProgress?.("LLM 產出 API Map 中...");
  const result = await callLLM([{ role: "user", content: fullPrompt }], { temperature: 0 });
  const content = result.content || "";
  let apis = null;
  try { apis = JSON.parse(content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim()); } catch {}
  if (!Array.isArray(apis) && repairJsonArrayFn) apis = repairJsonArrayFn(content);
  if (!Array.isArray(apis) || apis.length === 0) throw new Error("API Map 解析失敗（非 JSON array）");
  const clean = normalizeApiFeatures(apis);
  if (!clean.length) throw new Error("API Map 無有效 entry");
  const now = new Date().toISOString();
  saveApiFeatures(projRoot, clean);
  writeDoc(projRoot, "fileApiMap", { files: buildFileApiMap(clean), updatedAt: now });
  if (paawWriteFile) { try { await paawWriteFile("api-map.json", JSON.stringify(clean, null, 2)); } catch {} }
  return { apis: clean, stats: tsStats };
}

// （formatForAI 由呼叫者注入 tree-sitter-parser 的實作）
