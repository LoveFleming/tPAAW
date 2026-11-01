/**
 * feature-map-store.mjs — feature map 歸類合併（2026-10-22 delta 制）
 *
 * 背景：RR feature-map 檢查要求 delta 檔案都能對到功能。歸類是純衛生動作，
 * 但 agent 直改 .paaw/features/*.json 有三個問題：跨專案寫入被 cwd 白名單擋
 * （正確防護）、無格式驗證（手滑寫壞整個 map）、無審計。
 * 本模組 = 唯一合法寫入路徑（agent 走 feature_map_update 工具、UI 走 API）：
 * server 代寫、驗證、備份、留 updatedAt。
 *
 * 哲學同 qa-results：agent 提供判斷（哪個檔案屬於哪個功能），程式保證寫入安全。
 */

import { readDoc, writeDoc } from "./coding-db/docs.repo.mjs";
import { saveFeatures as dbSaveFeatures } from "./coding-db/index.mjs"; // db 單一真相（2026-11-01）
import { loadFeatures as registryLoadFeatures } from "./feature-registry.mjs";

const FID_RE = /^F\d{8}-\d{3}$/;

/** 相對路徑安全檢查：不吃絕對路徑、不吃 .. 逃逸 */
function _safeRel(file) {
  const f = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!f || f.startsWith("/") || /^[a-zA-Z]:/.test(f) || f.split("/").includes("..")) return null;
  return f;
}

/**
 * 合併 file→feature 歸類進 feature map（FILE-FEATURES.json + FEATURES.json）
 * @param {string} projectRoot 專案根目錄（agent 工具帶 cwd；UI 帶 project path）
 * @param {Array<{file: string, featureId: string, featureName?: string}>} entries
 * @param {string} by 操作者（agentId / "human"）
 * @returns {{merged: number, files: string[], featureIds: string[], newFeatures: string[], backups: string[], skipped: Array<{file: string, reason: string}>}}
 */
export function mergeFeatureMappings(projectRoot, entries = [], by = "human") {
  // 2026-11-01：讀寫全走 coding.db（ru_docs + features 表），不再碰 .paaw/features/*.json
  const ff = readDoc(projectRoot, "fileFeatures", { files: {}, updatedAt: null });
  const regFeatures = (() => { try { return registryLoadFeatures(projectRoot) ?? []; } catch { return []; } })();
  const reg = { features: Array.isArray(regFeatures) ? regFeatures : [] };
  ff.files = ff.files && typeof ff.files === "object" ? ff.files : {};
  reg.features = Array.isArray(reg.features) ? reg.features : [];

  const regById = new Map(reg.features.map(f => [String(f.id), f]));
  const skipped = [];
  const changed = new Set();
  const already = new Set();
  const newFeatures = [];
  const now = new Date().toISOString();

  for (const e of entries) {
    const file = _safeRel(e?.file);
    const fid = String(e?.featureId || "").trim();
    if (!file) { skipped.push({ file: String(e?.file ?? ""), reason: "不合法路徑（絕對路徑/.. 逃逸）" }); continue; }
    if (!FID_RE.test(fid)) { skipped.push({ file, reason: `featureId 格式不對（要 F{YYYYMMDD}-{NNN}，收到 ${fid || "(空)"}）` }); continue; }

    const arr = Array.isArray(ff.files[file]) ? ff.files[file] : [];
    if (arr.some(x => x && x.id === fid)) { already.add(file); continue; } // 冪等：已歸類過，不觸發寫檔

    // 功能名解析：registry 既有 > 傳入 featureName > 用 id；新功能只在實際寫入時登記
    let name = regById.get(fid)?.name || e.featureName || fid;
    if (!regById.has(fid)) {
      reg.features.push({ id: fid, name, status: "active", description: `feature_map_update registered ${now.slice(0, 10)}` });
      regById.set(fid, reg.features[reg.features.length - 1]);
      newFeatures.push(fid);
    } else if (e.featureName && regById.get(fid).name === fid) {
      regById.get(fid).name = name = e.featureName; // 第一個傳入的名字補上
    }

    arr.push({ id: fid, name, tags: [] });
    ff.files[file] = arr;
    changed.add(file);
  }

  if (changed.size === 0) {
    return { merged: 0, files: [], featureIds: [], newFeatures, backups: [], skipped, already: [...already] };
  }

  // 寫 db（交易式；saveFeatures 的全量替換即安全邊界，取代舊檔案備份）
  ff.updatedAt = now; reg.updatedAt = now;
  writeDoc(projectRoot, "fileFeatures", ff);
  dbSaveFeatures(projectRoot, reg.features);

  const featureIds = [...new Set([...changed].flatMap(f => (ff.files[f] || []).map(x => x.id)))];
  return {
    merged: changed.size,
    files: [...changed].sort(),
    featureIds: [...featureIds].sort(),
    newFeatures,
    backups: [], // db 制：備份概念由交易式寫入取代（2026-11-01）
    skipped,
    already: [...already],
    by,
  };
}
