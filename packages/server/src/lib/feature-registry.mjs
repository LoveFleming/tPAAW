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

import { join } from "path";
import { existsSync } from "fs";
import { readFeatures as dbReadFeatures, readFileFeatures as dbReadFileFeatures } from "./coding-db/reads.mjs";
import { saveFeatures as dbSaveFeatures } from "./coding-db/index.mjs";

export const FEATURE_STATUSES = ["active", "deprecated", "planned", "retired"];

export function featuresFile(projRoot) {
  return join(projRoot, ".paaw", "features", "FEATURES.json");
}

// 2026-11-01 Fleming 定案：coding.db 是唯一真相（結束 dual-write 過渡期）
// 讀：db 為準；db 空且 FEATURES.json 存在 → 一次性 bootstrap 匯入，之後不再讀檔
// 寫：只寫 db（saveFeatures 為交易式全量替換，安全性取代舊檔案備份輪替）
export function loadFeatures(projRoot) {
  try {
    const fromDb = dbReadFeatures(projRoot);
    if (fromDb && fromDb.length) return fromDb;
  } catch (e) { console.error("[coding-db] read features failed:", e.message); return []; }
  // 一次性 bootstrap：舊檔案資料進 db
  if (existsSync(featuresFile(projRoot))) {
    const feats = dbReadFileFeatures(projRoot);
    if (feats.length) {
      try { dbSaveFeatures(projRoot, feats); return feats; } catch (e) { console.error("[coding-db] bootstrap features failed:", e.message); }
    }
  }
  return [];
}

export function saveFeatures(projRoot, features) {
  if (Array.isArray(features)) ensureFeatureKinds(features); // Phase C：kind 自癒回填
  if (Array.isArray(features)) ensureFeatureKinds(features); // Phase C：kind 自癒回填
  dbSaveFeatures(projRoot, features); // 唯一寫入路徑（交易式）
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
  "status", "type", "category", "knowledgeGaps", "runbooks", "documentation", "docsUpdatedAt",
  "aiUnderstanding", "aiUnderstandingAt", "createdAt", "createdBy", "assignee",
];

const _norm = (f) => String(f || "").replace(/\\/g, "/");

// ── Kind 分類軸（Feature First v2 2026-10-30 定稿，Phase C 2026-11-01）：API / UI / Module / Utility ──
// deterministic：證據說話，不推測。evidence.kinds（http/ui/orphan）+ grade=utility；
// legacy 手建 feature（無 evidence）用 apis 有無當 fallback 訊號。
export function computeFeatureKind(f) {
  const ev = f?.evidence || {};
  const kinds = Object.keys(ev.kinds || {});
  const isUtility = f?.grade === "utility" || kinds.includes("orphan") || ev.method === "llm-grouping" || ev.method === "template-pattern";
  const hasHttp = kinds.includes("http");
  const hasUi = kinds.includes("ui");
  if (isUtility) return "utility";
  if (hasHttp && hasUi) return "api+ui";
  if (hasHttp) return "api";
  if (hasUi) return "ui";
  if ((f?.apis || []).length > 0 && !ev.method) return "api"; // legacy 手建帶 apis
  return "module";
}

// ── Category 歸類鍵（Phase C+ 2026-11-01 Fleming：Category → Feature → Sub-feature 三層）──
// deterministic：同區域的 feature 歸同一 category；名字交 LLM。規則：
// packages/*、src/*、app/* 取前兩段，其他取頂層目錄；root 檔 → "(root)"。
export function categoryKeyOf(files = []) {
  let best = null, bestN = 0;
  const counts = new Map();
  for (const f of files || []) {
    const segs = String(f || "").replace(/\\/g, "/").split("/").filter(Boolean);
    if (segs.length === 0) continue;
    const key = ["packages", "src", "app", "libs", "modules"].includes(segs[0]) && segs.length > 1
      ? segs.slice(0, 2).join("/")
      : segs[0];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best || "(root)";
}

// 自癒回填：任何 saveFeatures 都保證每個 feature 有 kind（冪等）
export function ensureFeatureKinds(features) {
  let n = 0;
  for (const f of features || []) {
    if (!f.kind) { f.kind = computeFeatureKind(f); n++; }
  }
  return n;
}

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
  return mergeFeaturesWithIdentityReport(newFeatures, existing, makeId).features;
}

/**
 * mergeFeaturesWithIdentityReport — Phase C（2026-11-01，Feature First v2 S8：全量重跑不失聯）
 * 在原 merge 鐵律（≥50% 繼承穩定 ID、人員欄位不丟、消失標 retired）之上加：
 * - 合併：多個舊 feature 同時 ≥50% 命中同一新 cluster → best 繼承 ID，其餘帶進 identity.mergedFrom
 *   （「合併自 A+B」，資料 union 不刪，不出現退休副本）
 * - 遷移報告：inherited / merged / created / retired / pendingAssignment（0<ratio<50% 的新 cluster —
 *   待歸屬，寧可空著不猜；程式絕不猜綁定）
 */
export function mergeFeaturesWithIdentityReport(newFeatures, existing, makeId) {
  const now = new Date().toISOString();
  const oldList = (existing || []).map(f => ({
    f,
    files: new Set((f.codeFiles || []).map(_norm)),
    size: (f.codeFiles || []).length,
  }));

  const merged = [];
  const claimed = new Set(); // 已被繼承/合併帶走的舊 feature id
  const report = { at: now, inherited: [], mergedFrom: [], created: [], retired: [], pendingAssignment: [] };

  newFeatures.forEach((nf, i) => {
    const nfFiles = new Set((nf.codeFiles || []).map(_norm));
    if (nfFiles.size === 0) {
      const id = makeId(i);
      merged.push({ ...nf, id, createdAt: now, updatedAt: now });
      report.created.push({ featureId: id, bestRatio: 0 });
      return;
    }
    // 所有舊 feature 按重疊比例排序（合併判定要用全部 ≥50% 者，不只最佳）
    const ranked = [];
    for (const o of oldList) {
      if (claimed.has(o.f.id) || o.size === 0) continue;
      let hit = 0;
      for (const x of nfFiles) if (o.files.has(x)) hit++;
      const ratio = hit / nfFiles.size;
      if (ratio >= 0.5) ranked.push({ o, ratio });
    }
    ranked.sort((a, b) => b.ratio - a.ratio || a.o.f.id.localeCompare(b.o.f.id));

    if (ranked.length > 0) {
      const best = ranked[0];
      const inherited = {};
      for (const k of FEATURE_INHERIT_FIELDS) {
        if (best.o.f[k] !== undefined && best.o.f[k] !== null && !(Array.isArray(best.o.f[k]) && best.o.f[k].length === 0)) inherited[k] = best.o.f[k];
      }
      if (inherited.status === "retired") inherited.status = "active";
      // 合併：第 2 個以後的 ≥50% 舊 feature → identity.mergedFrom（union 帶過，不退休、不複製）
      const mergedFromIds = ranked.slice(1).map(r => r.o.f.id);
      const identity = mergedFromIds.length > 0
        ? { mergedFrom: mergedFromIds, mergedAt: now, note: `合併自 ${[best.o.f.id, ...mergedFromIds].join(" + ")}` }
        : undefined;
      const out = { ...nf, ...inherited, id: best.o.f.id, updatedAt: now };
      if (identity) out.identity = identity;
      merged.push(out);
      claimed.add(best.o.f.id);
      for (const id of mergedFromIds) claimed.add(id);
      report.inherited.push({ featureId: best.o.f.id, oldId: best.o.f.id, ratio: Number(best.ratio.toFixed(3)) });
      if (mergedFromIds.length > 0) report.mergedFrom.push({ into: best.o.f.id, from: mergedFromIds });
      ranked.slice(1).forEach(r => claimed.add(r.o.f.id));
    } else {
      // 待歸屬判定：有部分重疊（0<ratio<50%）但不到繼承門檻 → 新 ID、不綁任何人員欄位，報告標 pending
      let bestPartial = 0;
      for (const o of oldList) {
        if (o.size === 0) continue;
        let hit = 0;
        for (const x of nfFiles) if (o.files.has(x)) hit++;
        bestPartial = Math.max(bestPartial, hit / nfFiles.size);
      }
      const id = makeId(i);
      merged.push({ ...nf, id, createdAt: now, updatedAt: now });
      report.created.push({ featureId: id, bestRatio: Number(bestPartial.toFixed(3)) });
      if (bestPartial > 0) report.pendingAssignment.push({ featureId: id, bestRatio: Number(bestPartial.toFixed(3)), reason: "部分重疊未達 50% — 寧可空著不猜" });
    }
  });

  // 消失的舊 feature → retired（不刪，歷史保留；qa-results/handover 引用不斷鏈）
  for (const o of oldList) {
    if (!claimed.has(o.f.id)) {
      merged.push({ ...o.f, status: "retired", retiredAt: now, updatedAt: now });
      report.retired.push(o.f.id);
    }
  }
  report.summary = `繼承 ${report.inherited.length} · 合併 ${report.mergedFrom.length} · 新設 ${report.created.length}（待歸屬 ${report.pendingAssignment.length}）· retired ${report.retired.length}`;
  return { features: merged, report };
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
