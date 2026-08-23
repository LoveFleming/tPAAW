/**
 * PAAW data 根目錄 — 單一事實來源
 *
 * 預設 = repo 的 data/（開發模式不變）。
 * 設 PAAW_DATA_HOME 環境變數可把 data 指到版本目錄之外 —
 * tpaaw-gateway 用這個讓 versions/<v>/ 裡的 code 讀寫 HOME/data（更新永不覆蓋使用者資料）。
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

export const DATA_HOME = process.env.PAAW_DATA_HOME
  ? resolve(process.env.PAAW_DATA_HOME)
  : resolve(REPO_ROOT, "data");
