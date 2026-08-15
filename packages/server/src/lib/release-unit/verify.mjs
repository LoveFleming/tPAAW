/**
 * release-unit/verify.mjs — 驗證執行器（build / lint / test / type-check）
 *
 * 從 adapter.verifyCommands(root) 拿指令（自動偵測 package manager），
 * 在專案根執行、限時、擷取輸出，結果寫 .paaw/verify-last.json 供
 * gates / analyze / UI 讀取。
 *
 * 這是「改完碼必跑」的第三層防線（總計畫 §2：改後 verify）。
 */

import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { detectAdapter } from "./adapters.mjs";
import { shellExec } from "../shell-exec.mjs";

const ALL_CHECKS = ["build", "lint", "type-check", "test"];

/** tail 輸出，避免回傳幾 MB 的 build log */
function tail(text, max = 4000) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `...（前略）\n${s.slice(-max)}`;
}

/**
 * 執行驗證
 * @param {string} root 專案根目錄
 * @param {object} opts { checks?: string[], timeoutMs?: number, skip?: string[] }
 * @returns { overall: "pass"|"fail"|"error", checks: [{check, command, ok, durationMs, output}], generatedAt }
 */
export async function runVerify(root, opts = {}) {
  const adapter = await detectAdapter(root);
  const cmds = await adapter.verifyCommands(root);
  const available = Object.keys(cmds);
  const skip = new Set(opts.skip || []);

  let selected = opts.checks?.length
    ? opts.checks.filter(c => ALL_CHECKS.includes(c))
    : available;
  selected = selected.filter(c => !skip.has(c) && cmds[c]);

  const started = Date.now();
  const results = [];
  for (const check of selected) {
    const cmd = cmds[check];
    const t0 = Date.now();
    try {
      const { stdout, stderr } = await shellExec(cmd, {
        cwd: root,
        timeout: opts.timeoutMs || 5 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const out = tail([stdout, stderr].filter(Boolean).join("\n"));
      results.push({ check, command: cmd, ok: true, exitCode: 0, durationMs: Date.now() - t0, output: out.slice(-2000) });
    } catch (e) {
      const out = tail([e.stdout, e.stderr, e.message].filter(Boolean).join("\n"));
      results.push({
        check, command: cmd, ok: false,
        exitCode: e.code ?? null,
        durationMs: Date.now() - t0,
        output: out,
        timedOut: e.killed || e.signal === "SIGTERM",
      });
    }
  }

  const report = {
    root: String(root),
    adapter: adapter.id,
    overall: results.length === 0 ? "error" : results.every(r => r.ok) ? "pass" : "fail",
    ran: results.map(r => r.check),
    skipped: available.filter(c => !selected.includes(c)).concat(skip),
    checks: results,
    totalDurationMs: Date.now() - started,
    generatedAt: new Date().toISOString(),
  };

  // 寫入 .paaw/verify-last.json（gates / analyze / UI 會讀）
  try {
    const paawDir = join(root, ".paaw");
    if (!existsSync(paawDir)) await mkdir(paawDir, { recursive: true });
    await writeFile(join(paawDir, "verify-last.json"), JSON.stringify(report, null, 2), "utf-8");
  } catch { /* 寫檔失敗不影響回傳 */ }

  return report;
}

/** 讀上次 verify 結果（沒跑過回 null） */
export async function readLastVerify(root) {
  try {
    const f = join(root, ".paaw", "verify-last.json");
    if (!existsSync(f)) return null;
    return JSON.parse(await readFile(f, "utf-8"));
  } catch { return null; }
}
