/**
 * stable-hash.mjs — Content-addressed 写入的地基（2026-08-22 Fleming 定調）
 *
 * 概念同 git blob：內容 = hash = identity。
 *   - stableStringify(): key 遞迴排序 + 陣列按 canonical form 排序
 *     → 同樣的資料（不管怎麼生出來）永遠序列化成同一個字串
 *   - hashObject(): sha256 前 16 碼，當內容指紋
 *   - diffWriteJson(): 寫檔前比指紋 — 相同就 skip（mtime 不動 → git 零 diff）
 *
 * 用途：Release Unit Model + CU 機械層 JSON 的「全量生成 + 增量寫入」—
 * 每次重掃照舊全量重建（不漂的保證），但只有實質變更才落盤。
 *
 * ⚠️ 陣列會被 canonical 排序 — 只用於「比對」與「指紋」；
 *    diffWriteJson 寫出的檔案仍是 builder 原始順序（順序不是資訊，
 *    但消費端依賴順序時（如 changes 時間軸）builder 自己要保證決定性）。
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";

/** 遞迴 canonical 序列化：object key 排序、array 依 canonical 字串排序 */
export function stableStringify(value) {
  return _canon(value);
}

function _canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) {
    const parts = v.map(_canon);
    parts.sort(); // 陣列順序不是指紋的一部分（order-only change ≠ 內容變更）
    return "[" + parts.join(",") + "]";
  }
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + _canon(v[k])).join(",") + "}";
}

/** 內容指紋：sha256 前 16 碼（251 entries 全算 = 毫秒級） */
export function hashObject(obj) {
  return createHash("sha256").update(_canon(obj)).digest("hex").slice(0, 16);
}

/** 淺層摘除指定 top-level key（不改原物件）— 拿掉 generatedAt 這類時間戳用 */
export function sansKeys(obj, keys = []) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * 差異寫入：內容（canonical 比對，可指定忽略 top-level key）相同 → skip 不寫。
 * @returns {boolean} true = 有實質變更已寫檔；false = 內容不變 skip（mtime 不動）
 */
export function diffWriteJson(filePath, data, { ignoreKeys = [] } = {}) {
  let old = null;
  if (existsSync(filePath)) {
    try { old = JSON.parse(readFileSync(filePath, "utf-8")); } catch { old = null; }
  }
  const fingerprintNew = hashObject(ignoreKeys.length ? sansKeys(data, ignoreKeys) : data);
  if (old !== null) {
    const fingerprintOld = hashObject(ignoreKeys.length ? sansKeys(old, ignoreKeys) : old);
    if (fingerprintOld === fingerprintNew) return false; // 內容不變 → git 零 diff
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return true;
}
