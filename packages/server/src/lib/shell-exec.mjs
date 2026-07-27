/**
 * shell-exec.mjs — 跨平台 shell 執行 helper
 *
 * 核心問題：Node.js 在 Windows 上 exec() 預設用 PowerShell，
 * PowerShell 把 < > | $ " 當特殊字元，導致 LLM 產生的命令全部炸。
 *
 * 解法：所有 exec 調用統一走這裡，Windows 強制用 cmd.exe。
 *
 * 使用方式：
 *   import { shellExec, shellExecSync } from "./shell-exec.mjs";
 *   const { stdout, stderr } = await shellExec("git status", { cwd });
 *   const out = shellExecSync("git status", { cwd });
 */

import { exec as execCb, execSync } from "child_process";
import { promisify } from "util";

const IS_WIN = process.platform === "win32";

// Windows 用 cmd.exe，Mac/Linux 用系統 shell
const SHELL_OPT = IS_WIN ? "cmd.exe" : true;

/**
 * Async exec — 跨平台安全
 * @param {string} command
 * @param {object} options - { cwd, timeout, maxBuffer, env, ... }
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export async function shellExec(command, options = {}) {
  const opts = {
    shell: SHELL_OPT,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
    ...options,
  };
  return promisify(execCb)(command, opts);
}

/**
 * Sync exec — 跨平台安全
 * @param {string} command
 * @param {object} options
 * @returns {string} stdout
 */
export function shellExecSync(command, options = {}) {
  const opts = {
    encoding: "utf-8",
    shell: SHELL_OPT,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
    ...options,
  };
  return execSync(command, opts);
}

/**
 * 回傳目前平台的 shell 名稱（給 spawn/terminal 用）
 */
export function getShell() {
  if (IS_WIN) return { bin: "cmd.exe", args: [] };
  return { bin: process.env.SHELL || "/bin/zsh", args: [] };
}

export { IS_WIN };
