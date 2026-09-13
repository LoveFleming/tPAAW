/**
 * shell-guard.mjs — bash 工具的 process 範圍防護（Fleming 2026-09-13 鐵律）
 *
 * 規則：coding app agent 只能操作「本 release unit 的 dev server」（dev_server 工具），
 * 不行操作外面的任何 process —— 尤其 PAAW coding app 本身（paaw-server / tPAAW vite / 其 port）。
 *
 * 三層防護：
 *  1. PAAW 自身：任何 kill/start 指令碰到 paaw 關鍵字或 PAAW port → 擋
 *  2. 啟動 PAAW 本身（node paaw-server / PAAW root 裡 npm run dev）→ 擋
 *  3. pkill/killall/taskkill/fuser -k 一律擋（無法保證只打到本 RU）；
 *     kill <pid> 只放行本 RU 受控 dev-server 的 pid
 *
 * 攔截的是「process 生命週期控制」；build/test/git/npm install 等一般操作不受影響。
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAAW_ROOT = resolve(__dirname, "../../../../");

// PAAW coding app 自身的關鍵字與 port（server 4097/4098/4100、bridge 4312/4412、UI vite 5173）
const PAAW_SELF_RE = /paaw|tpaaw|paaw-server|coding[-_]?app/i;
const PAAW_PORT_RE = /\b(4097|4098|4100|4312|4412|5173)\b/;

/**
 * 檢查 bash 指令是否越界操作 process。
 * @returns {{blocked: boolean, message?: string}}
 */
export async function guardShellProcessScope(command, cwd) {
  const cmd = String(command || "");
  if (!cmd) return { blocked: false };
  const procCtl = /\b(pkill|killall|taskkill|fuser\s+-k|kill)\b/i.test(cmd);

  // 1) PAAW coding app 自身：kill/查殺碰到關鍵字或 port → 擋
  if (procCtl && (PAAW_SELF_RE.test(cmd) || PAAW_PORT_RE.test(cmd))) {
    return {
      blocked: true,
      message: "🚫【鐵律】不可操作 PAAW coding app 自身的 process（paaw-server / tPAAW vite / port 4097/4098/4100/5173 等）。Agent 只能管本 release unit 的 dev server — 請改用 dev_server 工具。（Fleming 2026-09-13）",
    };
  }

  // 2) 啟動 PAAW 本身：node paaw-server.mjs、或在 PAAW root 跑 npm run dev/start
  if (/paaw-server\.mjs/i.test(cmd) ||
      (/npm\s+run\s+(dev|start)/i.test(cmd) && resolve(cwd || PAAW_ROOT) === PAAW_ROOT)) {
    return {
      blocked: true,
      message: "🚫【鐵律】不可啟動 PAAW coding app 本身（會跑出第二份 coding app 互搶 port）。bash 只做本 RU 的 build / test / 查詢類操作。（Fleming 2026-09-13）",
    };
  }

  // 3) 廣域 process 殺手（pkill/killall/taskkill/fuser -k）：一律擋 — 不可保證只打到本 RU
  if (/\b(pkill|killall|taskkill|fuser\s+-k)\b/i.test(cmd)) {
    return {
      blocked: true,
      message: "🚫 bash 禁用 pkill / killall / taskkill（可能誤殺 PAAW 或其他專案的 process）。本 RU dev server 的啟停請用 dev_server 工具（start/stop/restart/status，只作用於本 RU）；外部 process 一律不碰。（Fleming 2026-09-13）",
    };
  }

  // 4) kill <pid>：只放行「本 RU 受控 dev-server pid」；管線殺（lsof|pgrep → xargs kill/$()）一律擋
  if (/\bkill\b/i.test(cmd)) {
    const { devServerPid } = await import("./dev-server.mjs");
    const allowed = devServerPid(cwd);
    const pipeKill = /(lsof|pgrep)[^|;]*\|\s*xargs\s+kill|\$\(\s*(lsof|pgrep)/i.test(cmd);
    // 抓出 kill 子句裡所有數字 pid（含 kill -9 123 456 形式）
    const pids = [];
    for (const m of cmd.matchAll(/\bkill\s+((?:-[A-Za-z0-9]+\s+)*[\d\s]+)/gi)) {
      for (const n of m[1].matchAll(/\d+/g)) pids.push(Number(n[0]));
    }
    const bad = pipeKill || pids.length === 0 || pids.some((p) => !allowed || p !== allowed);
    if (bad) {
      return {
        blocked: true,
        message: `🚫 kill 只允許本 RU 受控 dev-server 的 pid${allowed ? `（目前 = ${allowed}）` : "（目前沒有在跑）"}，其他 process 不可動。本 RU dev server 請用 dev_server 工具；外部 process 一律不碰。（Fleming 2026-09-13）`,
      };
    }
  }

  return { blocked: false };
}
