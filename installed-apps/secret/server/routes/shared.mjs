/**
 * module shim — PAAW_ROOT 指向模組資料根（data/installed-apps/secret）
 * readBody 沿用 tPAAW 本體。目錄形狀：
 *   <root>/categories.json、<root>/dossiers/<category>/、<root>/config/expirations.json
 */
export { readBody } from "../../../../packages/server/src/routes/shared.mjs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const _here = dirname(fileURLToPath(import.meta.url));
export const PAAW_ROOT = resolve(_here, "../../../..", "data", "installed-apps", "secret");
/** tPAAW repo 根（crew scaffold 寫 data/crews/ 用） */
export const TPAW_REPO_ROOT = resolve(_here, "../../../..");
