/**
 * RU runtime 層退出版控 — 2026-09-19 Fleming 定調
 *
 * 原則：「會自己變的 = 運行狀態，退出版控；刻意寫下的決定/定義 = 資產，留在版控」
 *
 * RU 註冊（POST /api/ru/workspaces）時 ensureRuntimeIgnores()：
 *   1. .gitignore 追加標準 runtime 排除區塊（idempotent，靠 marker 辨識）
 *   2. 已被追蹤的 runtime 檔 → git rm -r --cached（檔案留磁碟、stage 刪除，
 *      隨下一次收尾 commit 一起進版）— 不自動 commit，避免捲走使用者 staged 的東西
 *
 * 排除（自動生成、每次跑就覆蓋；證據摘要內嵌 RR，放行夠用）：
 *   .paaw/sessions/ .paaw/auto-dispatch/ .paaw/test-runs/ .paaw/changes/ .paaw/security/
 *   .paaw/cu-status.json .paaw/scan.json .paaw/gates.json .paaw/verify-last.json
 *
 * 保留資產（跟 release unit 走、人定時 push）：
 *   agents/ coding-memory/ skills/ em/ decisions/ project/ tasks/ issues/
 *   features/ code-intelligence/ changelog/ HANDOVER.md handover-state.json
 *   release-requests/ release-unit-model.json c4-model.json error-codes.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { shellExecSync } from "./shell-exec.mjs";

const MARKER = "PAAW runtime 層";
const RUNTIME_PATHS = [
  ".paaw/sessions/",
  ".paaw/auto-dispatch/",
  ".paaw/test-runs/",
  ".paaw/changes/",
  ".paaw/security/",
  ".paaw/cu-status.json",
  ".paaw/scan.json",
  ".paaw/gates.json",
  ".paaw/verify-last.json",
];

const IGNORE_BLOCK = [
  `# ── ${MARKER}不進版控（2026-09-19 平台管理：資產進版控，runtime 機器自己消化；證據摘要內嵌 RR）──`,
  ...RUNTIME_PATHS,
  `# ── PAAW runtime 層結束 ──`,
].join("\n");

/**
 * 確保專案的 .gitignore 含 runtime 排除區塊，且 runtime 檔不在 git 追蹤。
 * 非 git repo → skip。任何 git 失敗不丟例外（註冊流程不阻斷）。
 * @returns {{ skipped?: string, gitignoreAdded: boolean, untrackedCount: number, error?: string }}
 */
export function ensureRuntimeIgnores(projectPath) {
  const out = { gitignoreAdded: false, untrackedCount: 0 };
  try {
    if (!existsSync(join(projectPath, ".git"))) {
      out.skipped = "not a git repo";
      return out;
    }

    // 1) .gitignore 追加區塊（冪等）
    const giPath = join(projectPath, ".gitignore");
    let gi = existsSync(giPath) ? readFileSync(giPath, "utf-8") : "";
    if (!gi.includes(MARKER)) {
      gi = gi.replace(/\n*$/, "\n") + "\n" + IGNORE_BLOCK + "\n";
      writeFileSync(giPath, gi, "utf-8");
      out.gitignoreAdded = true;
    }

    // 2) 已追蹤的 runtime 檔 → 退出 index（檔案留磁碟）
    const spec = RUNTIME_PATHS.join(" ");
    const tracked = String(shellExecSync(`git ls-files -- ${spec}`, { cwd: projectPath, timeout: 10000 }) || "").trim();
    if (tracked) {
      shellExecSync(`git rm -r -q --cached -- ${spec}`, { cwd: projectPath, timeout: 15000 });
      out.untrackedCount = tracked.split("\n").filter(Boolean).length;
    }
    return out;
  } catch (e) {
    out.error = String(e && e.message || e);
    return out;
  }
}
