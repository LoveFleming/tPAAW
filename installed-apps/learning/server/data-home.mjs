/** module shim — DATA_HOME 指模組資料根（v1 模組自帶 AI 金鑰，v2 再接 PAAW provider 體系） */
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const _here = dirname(fileURLToPath(import.meta.url));
export const DATA_HOME = resolve(_here, "../../..", "data", "installed-apps", "learning");
