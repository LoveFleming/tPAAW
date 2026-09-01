/**
 * Feature Registry — Feature-first 任務模型的單一事實來源
 *
 * 2026-09-01 Fleming 定調：
 *  - Release Unit 下一層以 Feature 為主：測試/文件/派工/release 都從 feature 出發
 *  - Feature ID 規則：F + YYYYMMDD + 當日序號（F20260901-001）
 *  - type: frontend | backend | ""（不分）— 由檔案路徑 heuristic 自動填，人可改
 *  - createdAt / updatedAt 必有；UI 可 by updatedAt 排序
 *  - 雜項 task 一定要掛 featureId — 沒有歸屬的用 "Utility & Platform Misc" 收容
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

export const FEATURE_STATUSES = ["active", "deprecated", "planned", "retired"];

export function featuresFile(projRoot) {
  return join(projRoot, ".paaw", "features", "FEATURES.json");
}

export function loadFeatures(projRoot) {
  const file = featuresFile(projRoot);
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"));
    const feats = Array.isArray(data) ? data : (data.features || []);
    return Object.values(feats); // 支援 dict 形狀
  } catch {
    return [];
  }
}

export function saveFeatures(projRoot, features) {
  const file = featuresFile(projRoot);
  mkdirSync(join(projRoot, ".paaw", "features"), { recursive: true });
  writeFileSync(file, JSON.stringify({ features, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

// ── ID 規則：F + YYYYMMDD + 當日序號 ──
export function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function nextFeatureId(projRoot) {
  const stamp = todayStamp();
  const prefix = `F${stamp}-`;
  const feats = loadFeatures(projRoot);
  let max = 0;
  for (const f of feats) {
    if (typeof f.id === "string" && f.id.startsWith(prefix)) {
      const n = parseInt(f.id.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

// ── type heuristic：packages/ui → frontend、packages/server → backend、共用 → "" ──
export function inferFeatureType(files = []) {
  let fe = 0, be = 0;
  for (const f of files) {
    const p = String(f || "");
    if (/(^|\/)(ui|client|web|frontend|browser|src\/components?|packages\/ui)\//.test(p) || /\.(tsx|vue|svelte|css)$/.test(p)) fe++;
    if (/(^|\/)(server|api|backend|packages\/server)\//.test(p)) be++;
  }
  if (fe > 0 && be === 0) return "frontend";
  if (be > 0 && fe === 0) return "backend";
  return ""; // 混合或無法判斷 = 不分
}

// ── updatedAt touch — task 結案/更新時讓 feature 排序反映活動 ──
export function touchFeature(projRoot, featureId, at = null) {
  if (!featureId) return false;
  try {
    const feats = loadFeatures(projRoot);
    const f = feats.find(x => x.id === featureId);
    if (!f) return false;
    f.updatedAt = at || new Date().toISOString();
    saveFeatures(projRoot, feats);
    return true;
  } catch {
    return false;
  }
}

// ── 收容 feature：沒有明確歸屬的雜項工作 ──
export const MISC_FEATURE_NAME = "Utility & Platform Misc";

export function ensureMiscFeature(projRoot) {
  const feats = loadFeatures(projRoot);
  let misc = feats.find(f => f.name === MISC_FEATURE_NAME);
  if (misc) return misc;
  const now = new Date().toISOString();
  misc = {
    id: nextFeatureId(projRoot),
    name: MISC_FEATURE_NAME,
    description: "雜項收容：utility / platform / 不屬於其他 feature 的工作（跨切面、建置、基礎設施）",
    status: "active",
    type: "",
    codeFiles: [],
    tags: ["utility", "platform", "misc"],
    createdAt: now,
    updatedAt: now,
  };
  feats.push(misc);
  saveFeatures(projRoot, feats);
  return misc;
}

// ── featureId 是否存在（task_create 驗證用；FEATURES.json 不存在時放行 — 專案還沒掃過）──
export function featureExists(projRoot, featureId) {
  const feats = loadFeatures(projRoot);
  if (feats.length === 0) return true; // 未初始化的專案不擋
  return feats.some(f => f.id === featureId || f.legacyId === featureId);
}
