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

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from "fs";
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
  // 2026-09-05：寫入前自動輪替備份（教訓：architect 整頓 34→3 直接覆蓋，無法回復）
  try {
    if (existsSync(file)) {
      const backupDir = join(projRoot, ".paaw", "features", "backups");
      mkdirSync(backupDir, { recursive: true });
      copyFileSync(file, join(backupDir, `FEATURES-${Date.now()}.json`));
      // 只留最近 5 份
      const olds = readdirSync(backupDir).filter(f => f.startsWith("FEATURES-")).sort();
      while (olds.length > 5) rmSync(join(backupDir, olds.shift()), { force: true });
    }
  } catch { /* 備份失敗不擋寫入 */ }
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

/** 批次產生 count 個同日連號新 feature id（接續現有 FEATURES.json 最大號）
 *  CU feature-map step 一次重建整份清單時用（2026-09-04：修 CU 產出 F-001 舊格式問題） */
export function nextFeatureIds(projRoot, count = 1) {
  const first = nextFeatureId(projRoot);
  const n = Math.max(1, count);
  const m = first.match(/^(F\d{8})-(\d+)$/);
  if (!m) return Array.from({ length: n }, () => first); // 非預期格式 fallback（同名去重交給 loader）
  const prefix = m[1];
  const start = parseInt(m[2], 10);
  return Array.from({ length: n }, (_, i) => `${prefix}-${String(start + i).padStart(3, "0")}`);
}

// ── CU 重掃 merge 鐵律（2026-10-10 19:29 Fleming 拍板）──
// 智能層 feature-map 重跑不再是毀滅性重建：新 cluster × 舊 feature by 檔案交集匹配，
// 匹配者繼承舊 ID + 所有人員欄位（severityDecisions/severity/status/knowledgeGaps/…
// 跟 TSGuide confirmed / handover-remarks 同哲學：人的輸入是資產，程式只負責不丟）。
// 消失的舊 feature 標 retired 不刪。寫入一律走 saveFeatures（備份輪替生效）。

/** 人員/權威欄位 — 重掃永遠繼承，絕不用空值洗掉 */
export const FEATURE_INHERIT_FIELDS = [
  "severityDecisions", "severity", "severitySuggested", "severitySuggestedReason",
  "severitySuggestedNotes", "severitySuggestedBy", "severitySuggestedAt", "severityComputed",
  "severityConfirmedAt", "severityConfirmedBy", "riskProfile",
  "status", "type", "knowledgeGaps", "runbooks", "documentation", "docsUpdatedAt",
  "aiUnderstanding", "aiUnderstandingAt", "createdAt", "createdBy", "assignee",
];

const _norm = (f) => String(f || "").replace(/\\/g, "/");

/**
 * mergeFeaturesWithExisting — CU 重掃合併（純函式，冪等）
 * @param {Array} newFeatures CU 新產出（無 id；具 codeFiles + AI 長肉欄位）
 * @param {Array} existing 現有 FEATURES.json（可能空）
 * @param {Function} makeId (idx) => 新 ID（延遲配置：只有需要時才拿號）
 * @returns {Array} 合併後 features（匹配繼承 + 新 ID + 舊的標 retired 排尾）
 *
 * 匹配規則：新 cluster 的檔案有 ≥50% 來自某舊 feature → 同一 feature（取 overlap 最高者）。
 * ID 繼承一對一（每舊 ID 最多被繼承一次 — 拆分時主體拿 ID，分出去的發新 ID）。
 */
export function mergeFeaturesWithExisting(newFeatures, existing, makeId) {
  const now = new Date().toISOString();
  // 舊 feature 索引：檔案集合
  const oldList = (existing || []).map(f => ({
    f,
    files: new Set((f.codeFiles || []).map(_norm)),
    size: (f.codeFiles || []).length,
  }));

  const merged = [];
  const claimed = new Set(); // 已被繼承的舊 feature id（一對一）

  newFeatures.forEach((nf, i) => {
    const nfFiles = new Set((nf.codeFiles || []).map(_norm));
    if (nfFiles.size === 0) {
      merged.push({ ...nf, id: makeId(i), createdAt: now, updatedAt: now });
      return;
    }
    // 找 overlap 最高的舊 feature（新 cluster 檔案歸屬比例）
    let best = null, bestRatio = 0;
    for (const o of oldList) {
      if (claimed.has(o.f.id) || o.size === 0) continue;
      let hit = 0;
      for (const x of nfFiles) if (o.files.has(x)) hit++;
      const ratio = hit / nfFiles.size;
      if (ratio > bestRatio) { bestRatio = ratio; best = o; }
    }
    if (best && bestRatio >= 0.5) {
      // 繼承：舊 ID + 人員欄位；骨架（codeFiles/apis/tests/grade/evidence）+ AI 長肉用新值
      const inherited = {};
      for (const k of FEATURE_INHERIT_FIELDS) {
        if (best.f[k] !== undefined && best.f[k] !== null && !(Array.isArray(best.f[k]) && best.f[k].length === 0)) inherited[k] = best.f[k];
      }
      // status 繼承但 retired 不繼承（回來的 feature 復活為 active）
      if (inherited.status === "retired") inherited.status = "active";
      merged.push({ ...nf, ...inherited, id: best.f.id, updatedAt: now });
      claimed.add(best.f.id);
    } else {
      merged.push({ ...nf, id: makeId(i), createdAt: now, updatedAt: now });
    }
  });

  // 消失的舊 feature → retired（不刪，歷史保留；qa-results/handover 引用不斷鏈）
  for (const o of oldList) {
    if (!claimed.has(o.f.id)) {
      merged.push({ ...o.f, status: "retired", retiredAt: now, updatedAt: now });
    }
  }
  return merged;
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
