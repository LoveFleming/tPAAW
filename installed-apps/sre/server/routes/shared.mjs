/**
 * module shim — PAAW_ROOT 指向模組資料根（data/installed-apps/sre）
 * readBody 沿用 tPAAW 本體。目錄形狀：
 *   <root>/services.json、<root>/dossiers/<serviceId>/（含固定 _global 櫃）、
 *   <root>/config/grafana.json、<root>/config/expirations.json、<root>/reports/
 */
export { readBody, normalizePath } from "../../../../packages/server/src/routes/shared.mjs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const _here = dirname(fileURLToPath(import.meta.url));
/** 模組資料根（每台機器自帶，不隨出貨） */
export const PAAW_ROOT = resolve(_here, "../../../..", "data", "installed-apps", "sre");
/** tPAAW repo 根（寫 data/crews 用） */
export const TPAW_REPO_ROOT = resolve(_here, "../../../..");
/** 模組本體目錄（installed-apps/sre）— 內含 crews/ 模板 */
export const MODULE_DIR = resolve(_here, "../..");
