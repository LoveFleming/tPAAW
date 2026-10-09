/**
 * Module Registry — module-owned crew definitions (firmware)
 *
 * 2026-10-09 Fleming 拍板架構：
 *   - 官方 crew prompt 跟著 module 更新（packages/modules/<id>/crews/*.json），不放 data/
 *   - 多人 release：使用者不可編 firmware crew（行為/toolGroups/toolsDeny），
 *     只可編外觀偏好（data/crew-preferences.json）與 .paaw append
 *   - 讀取鏈：module 本體 → .paaw/agents append（rolePromptAppend/model/顯示欄位；
 *     治理欄位 toolGroups/toolsDeny 蓋不掉）→ legacy rolePrompt 整份覆蓋（向後相容，標 deprecated）
 *
 * 員工互動面在 module UI（coding app side chat 等）；全域 AICrew 頁 = 組織圖（唯讀總覽）。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PAAW_ROOT } from "../routes/shared.mjs";

const MODULES_ROOT = resolve(PAAW_ROOT, "packages", "modules");

/** @type {Map<string, any>} moduleId → manifest */
const _moduleCache = new Map();
/** @type {Map<string, any>} crewId → { crew, moduleId } */
const _crewCache = new Map();
let _scanned = false;

function _scanModules() {
  if (_scanned) return;
  _moduleCache.clear();
  _crewCache.clear();
  try {
    for (const entry of readdirSync(MODULES_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(MODULES_ROOT, entry.name, "module.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        manifest._dir = join(MODULES_ROOT, entry.name);
        _moduleCache.set(manifest.id || entry.name, manifest);
      } catch { /* bad manifest → skip */ }
    }
  } catch { /* modules dir missing → no modules */ }
  _scanned = true;
}

/** List all modules（掃描 crews/*.json 補齊，manifest crews 清單僅備援） */
export function listModules() {
  _scanModules();
  const out = [];
  for (const [id, m] of _moduleCache) {
    const crews = _listModuleCrewIds(m);
    out.push({ id, name: m.name || id, icon: m.icon || "📦", version: m.version || "0.0.0", crewCount: crews.length, _builtin: true });
  }
  return out;
}

function _listModuleCrewIds(manifest) {
  try {
    const crewsDir = join(manifest._dir, "crews");
    return readdirSync(crewsDir)
      .filter(f => f.endsWith(".json"))
      .map(f => f.slice(0, -5))
      .sort();
  } catch { return []; }
}

/** List crews of a module（含 locked 標記） */
export function listModuleCrews(modId) {
  _scanModules();
  const m = _moduleCache.get(modId);
  if (!m) return null;
  return _listModuleCrewIds(m).map(cid => {
    const crew = getModuleCrew(cid)?.crew || { id: cid };
    return { ...crew, id: cid, locked: true, moduleId: modId, source: "module" };
  });
}

/** Get firmware crew definition by crewId → { crew, moduleId } | null */
export function getModuleCrew(crewId) {
  _scanModules();
  if (_crewCache.has(crewId)) return _crewCache.get(crewId);
  for (const [modId, m] of _moduleCache) {
    const f = join(m._dir, "crews", `${crewId}.json`);
    if (existsSync(f)) {
      try {
        const crew = JSON.parse(readFileSync(f, "utf-8"));
        const rec = { crew, moduleId: modId };
        _crewCache.set(crewId, rec);
        return rec;
      } catch { return null; }
    }
  }
  _crewCache.set(crewId, null);
  return null;
}

/** 是 firmware crew？（模組擁有） */
export function isFirmwareCrew(crewId) {
  return getModuleCrew(crewId) !== null;
}

/** 讀 project-level .paaw override（存在才讀，不存在 null） */
export function readProjectOverride(crewId, projectDir) {
  if (!projectDir) return null;
  const p = join(resolve(projectDir), ".paaw", "agents", `${crewId}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

/**
 * 解析 crew（完整鏈）：
 *   module firmware base + .paaw 疊加規則（新 append 制 / legacy 整份覆蓋相容）
 * 回傳 { crew, moduleId, legacyOverride, sources }
 */
export function resolveCrew(crewId, projectDir = null) {
  const mod = getModuleCrew(crewId);
  const base = mod ? { ...mod.crew } : null;
  const override = readProjectOverride(crewId, projectDir);
  const sources = [mod ? `module:${mod.moduleId}` : "data"].filter(Boolean);
  if (override) sources.push("paaw-override");

  if (!base) {
    // user crew（data/crews）— 由呼叫端自行讀；這裡只回 override 疊加結果
    return { crew: override ? { ...override, id: crewId } : null, moduleId: null, legacyOverride: false, sources };
  }

  if (!override) {
    return { crew: { ...base, id: crewId }, moduleId: mod.moduleId, legacyOverride: false, sources };
  }

  // 新制：rolePromptAppend / model / 顯示欄位；治理欄位（toolGroups/toolsDeny）一律忽略
  const hasLegacyPrompt = typeof override.rolePrompt === "string" && override.rolePrompt.trim().length > 0;
  if (hasLegacyPrompt && !("rolePromptAppend" in override)) {
    // legacy：整份覆蓋（向後相容既有 RU override），標記供 UI 警告
    const { rolePrompt, ...rest } = override;
    return {
      crew: { ...base, ...rest, rolePrompt, id: crewId },
      moduleId: mod.moduleId,
      legacyOverride: true,
      sources,
    };
  }

  // append 制
  const merged = { ...base };
  const allowed = ["model", "title", "codename", "imageUrl", "description", "chatConfig", "skillIds", "expertise", "guardrails"];
  for (const k of allowed) if (k in override) merged[k] = override[k];
  if (typeof override.rolePromptAppend === "string" && override.rolePromptAppend.trim()) {
    merged.rolePrompt = `${base.rolePrompt || ""}\n\n${override.rolePromptAppend}`.trim();
  }
  return { crew: { ...merged, id: crewId }, moduleId: mod.moduleId, legacyOverride: false, sources };
}

/** 清快取（dev 熱載入用） */
// ── 使用者偏好層（2026-10-09 Fleming：外觀設定與功能無關，data/crew-preferences.json）──
// 讓 crew.mjs（全域組織圖）、coding.mjs（chat profile）、project-crew.mjs（側欄列表）共用同一份疊加
import { writeFileSync } from "node:fs";
const PREFS_FILE = resolve(PAAW_ROOT, "data", "crew-preferences.json");
export function loadCrewPrefs() {
  try { return JSON.parse(readFileSync(PREFS_FILE, "utf-8")); } catch { return {}; }
}
export function saveCrewPrefs(prefs) {
  writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), "utf-8");
}
export function applyCrewPrefs(crew) {
  if (!crew) return crew;
  const p = loadCrewPrefs()[crew.id];
  if (!p || Object.keys(p).length === 0) return { ...crew, prefs: undefined };  // 空物件視為無偏好
  return {
    ...crew,
    displayName: p.displayName || undefined,  // 2026-10-09：不可 fallback crew.title（只有 tone/notes 的偏好會讓名字變 title）；未設定就交給 codename
    imageUrl: p.avatarUrl || crew.imageUrl,
    greeting: p.greeting,
    tone: p.tone,
    userNotes: p.notes,
    _hasPrefs: true,
  };
}

export function clearRegistryCache() {
  _moduleCache.clear();
  _crewCache.clear();
  _scanned = false;
}
