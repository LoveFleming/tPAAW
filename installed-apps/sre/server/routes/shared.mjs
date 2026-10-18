/**
 * module shim — PAAW_ROOT 指向模組資料根（data/installed-apps/sre）
 * readBody 為帶 5MB 上限的包裝（QA M1：防無限 buffer OOM）。目錄形狀：
 *   <root>/services.json、<root>/dossiers/<serviceId>/（含固定 _global 櫃）、
 *   <root>/config/grafana.json、<root>/config/expirations.json、<root>/reports/
 */
import { normalizePath } from "../../../../packages/server/src/routes/shared.mjs";
export { normalizePath };
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const _here = dirname(fileURLToPath(import.meta.url));

/** request body 上限（bytes）— 超過即拒絕，不無限 buffer */
export const BODY_LIMIT = 5 * 1024 * 1024;

/** readBody（帶大小上限）：核心版無上限，這裡包一層防護（QA M1） */
export function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on("data", (c) => {
      if (rejected) return;
      size += c.length;
      if (size > BODY_LIMIT) {
        rejected = true;
        req.removeAllListeners("data");
        req.removeAllListeners("end");
        reject(Object.assign(new Error(`request body 超過 ${BODY_LIMIT / 1024 / 1024}MB 上限`), { statusCode: 413, code: "SYS_CTRL_REQUEST_BODY_TOO_LARGE" }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!rejected) resolveBody(Buffer.concat(chunks).toString()); });
    req.on("error", (e) => { if (!rejected) reject(e); });
  });
}

/** 模組資料根（每台機器自帶，不隨出貨） */
export const PAAW_ROOT = resolve(_here, "../../../..", "data", "installed-apps", "sre");
/** tPAAW repo 根（寫 data/crews 用） */
export const TPAW_REPO_ROOT = resolve(_here, "../../../..");
/** 模組本體目錄（installed-apps/sre）— 內含 crews/ 模板 */
export const MODULE_DIR = resolve(_here, "../..");
