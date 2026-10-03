/**
 * module shim — 讓原封搬來的 route 檔 import ./shared.mjs 不改碼。
 * PAAW_ROOT 指向模組資料根（data/installed-apps/learning），形狀同 learning-space repo 根：
 *   <root>/data/learning.db、<root>/data/exam-papers/、<root>/subjects/、<root>/raw/、<root>/scripts/
 * readBody 等 helper 沿用 tPAAW 本體（同源）。
 */
export { readBody } from "../../../../packages/server/src/routes/shared.mjs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const _here = dirname(fileURLToPath(import.meta.url));
export const PAAW_ROOT = resolve(_here, "../../../..", "data", "installed-apps", "learning");
