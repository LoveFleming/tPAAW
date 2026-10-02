/**
 * proc-ledger.mjs — agent bash 殘留程序帳本 + 精準掃殺（2026-09-27 OOM 治本）
 *
 * 問題（2026-09-27 兩台機器同日中獎：Mac mini jetsam 砍 Chrome + 公司 Linux OOM 砍 Chrome/VSCode）：
 *   agent 用 bash 起背景程序（test harness / verify server / fake server），
 *   exec() 的 shell 退出（或 timeout 被殼）後孫程序變孤兒，跨任務、跨日累積 →
 *   RAM 見底 → kernel OOM killer / macOS jetsam 挑最大戶砍（Chrome、VSCode 全滅）。
 *   另一個洞：exec(timeout) 只殼 shell 本體，殺不到整棵 process 樹。
 *
 * 解法：
 *   1. runShellGrouped()：bash 指令改用「獨立 process group」spawn（POSIX detached / Windows cmd.exe）。
 *      指令結束後若 group 還有成員活著（背景殘留）→ 記入帳本（ruSlug + runId + pgid）。
 *      timeout 時殺「整個 group」（TERM → 1.5s → KILL），不再留孤兒。
 *   2. agent run 結束時 sweepRunProcesses(runId)：精準掃殺本 run 記錄的殘留 group。
 *   3. 老化保險絲：殘留超過 2 小時的 entry 由背景 sweeper 收掉
 *      （run 中途 crash / server 重啟沒走到結尾的 case，確保殭屍不跨日）。
 *
 * 安全邊界（絕不誤殺 — Fleming 2026-09-13 鐵律的延伸）：
 *   - 只殺「自己 spawn 的 process group」（帳本裡的 pgid）— 絕不 pkill/killall pattern
 *   - dev_server 工具起的程序（lib/dev-server.mjs 自己 spawn、自帶生命週期）不經帳本 → 不受影響
 *   - PAAW coding app 自身 / 使用者 Chrome / VSCode 永遠不可能出現在帳本 group 裡
 *
 * 跨平台：
 *   - POSIX（macOS/Linux）：detached spawn → pgid = shell pid → process.kill(-pgid) 群殺
 *   - Windows：cmd.exe /c spawn；exit 後孤兒仍認 dead parent 的 PPID，
 *     sweep 時用 PowerShell CIM 沿 PPID 樹找孤兒 → taskkill /T /F（best-effort）
 */

import { spawn, execSync } from "child_process";
import { AsyncLocalStorage } from "async_hooks";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { LOG_HOME } from "../data-home.mjs";

const IS_WIN = process.platform === "win32";

/** 本 agent run 的 context（runAgentLoop 進場時 enterWith）— bash 殘留歸屬哪個 run */
export const runContextALS = new AsyncLocalStorage(); // { runId, ruSlug }

// ── 帳本：key → entry ──
// entry = { key, runId, ruSlug, pgid, command, at }
//   key     = `${runId || "orphan"}#${pgid}`（唯一；同 runId 重複記同 pgid 會覆蓋）
//   pgid    = POSIX process group id（= spawn 的 shell pid）；Windows 記 shell pid（PPID 查詢用）
const _entries = new Map();

// ── 持久化：PAAW server 重啟後帳本歸零 → 重啟前的孤兒沒人管 ──
// 記帳/掃殺時同步落盤；module init 時重新領養（group 還活著的 entry）。
// 進守跨平台紀律：路徑操作一律 fileURLToPath / normalize。
const _STATE_PATH = join(LOG_HOME, "tmp", "proc-ledger-state.json");
function _saveState() {
  try {
    mkdirSync(dirname(_STATE_PATH), { recursive: true });
    const arr = [..._entries.values()].map((e) => ({
      runId: e.runId, ruSlug: e.ruSlug, pgid: e.pgid,
      command: String(e.command).slice(0, 300), at: e.at,
    }));
    writeFileSync(_STATE_PATH, JSON.stringify(arr));
  } catch {}
}
function _loadState() {
  try {
    if (!existsSync(_STATE_PATH)) return;
    const arr = JSON.parse(readFileSync(_STATE_PATH, "utf-8"));
    if (!Array.isArray(arr)) return;
    let adopted = 0;
    for (const e of arr) {
      if (!e || typeof e.pgid !== "number") continue;
      // 只領養 group 還活著的（server 重啟期間自然退出的就不算了）
      const alive = IS_WIN ? true /* Windows 孤兒採掃時才查，先收 */ : (() => { try { process.kill(-e.pgid, 0); return true; } catch (err) { return err.code === "EPERM"; } })();
      if (!alive) continue;
      _entries.set(`${e.runId || "orphan"}#${e.pgid}`, {
        key: `${e.runId || "orphan"}#${e.pgid}`,
        runId: e.runId || null, ruSlug: e.ruSlug, pgid: e.pgid,
        command: e.command, at: e.at || _now(),
      });
      adopted++;
    }
    if (adopted > 0) console.log(`[proc-ledger] ♻️ 重啟領養 ${adopted} 個殘留 process group（帳本狀態從 ${dirname(_STATE_PATH).split(/[\\/]/).pop()}/proc-ledger-state.json 恢復）`);
  } catch {}
}
_loadState();

const _now = () => Date.now();
const _ts = () => new Date().toISOString();

/** 殘留老化上限（保險絲：run 沒走到結尾掃殺的，最多活 2 小時） */
const AGE_LIMIT_MS = 2 * 60 * 60 * 1000;
const AGE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// ── pid / group 存活探測 ──
function _alive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}
/** group（pgid）裡還有沒有成員活著 */
function _groupAlive(pgid) {
  if (!pgid) return false;
  try { process.kill(-pgid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}

function _record(runId, ruSlug, pgid, command) {
  const key = `${runId || "orphan"}#${pgid}`;
  _entries.set(key, { key, runId: runId || null, ruSlug, pgid, command, at: _now() });
  _saveState();
}

/** 指令結束後檢查殘留並記帳（小延遲避開 spawn race） */
async function _checkLinger(shellPid, { runId, ruSlug, command }) {
  await new Promise((r) => setTimeout(r, 150));
  if (IS_WIN) {
    // Windows：查 dead shell 的孤兒子孫（PPID 持續指向已死 parent）
    const kids = _winChildrenOf(shellPid);
    if (kids.length > 0) _record(runId, ruSlug, shellPid, command);
    return;
  }
  if (_groupAlive(shellPid)) _record(runId, ruSlug, shellPid, command);
}

/** Windows：沿 PPID 樹找直屬+孫輩 pid（Get-CimInstance；孤兒的 PPID 仍指 dead parent） */
function _winChildrenOf(rootPid, maxDepth = 3) {
  if (!IS_WIN) return [];
  try {
    const ps = [
      `$frontier=@(${rootPid}); $found=@()`,
      `for($i=0; $i -lt ${maxDepth} -and $frontier.Count -gt 0; $i++){`,
      `  $next=@()`,
      '  foreach($p in $frontier){ $next += Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId }',
      `  $found += $next; $frontier=@($next)`,
      `}`,
      `$found -join ','`,
    ].join(" ");
    const out = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '`"')}"`, { timeout: 10_000, encoding: "utf-8" }).trim();  // nosemgrep: detect-child-process — powershell 查自己 spawn 的 pgid（內部帳本）
    return out ? out.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)) : [];
  } catch { return []; }
}

/** 殺一個帳本 entry（POSIX 群殺 / Windows 樹殺）。回傳 true = 確定殺到 */
async function _killEntry(entry, signal = "SIGTERM") {
  if (IS_WIN) {
    // 孤兒樹殺：先沿 PPID 擴散找全部後代，逐一 taskkill /T /F
    const pids = _winChildrenOf(entry.pgid);
    let any = false;
    for (const pid of pids) {
      try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore", timeout: 10_000 }); any = true; } catch {}  // nosemgrep: detect-child-process — taskkill 帳本內 pid（Windows 分支）
    }
    return any;
  }
  try { process.kill(-entry.pgid, signal); return true; }
  catch {
    try { process.kill(entry.pgid, signal); return true; } catch { return false; }
  }
}

/**
 * 帶 process group 的 shell 執行（取代 runShell 裡的 promisify(exec)）。
 * 回傳 { stdout, stderr, code, timedOut }（不 throw — 呼叫端組字串）。
 * code：數字 exit code；`signal:XXX`；`timeout`；-1（spawn error）
 */
export function runShellGrouped(command, opts = {}) {
  const {
    cwd,
    timeoutMs = 30_000,
    env = {},
    maxBufferBytes = 10 * 1024 * 1024,
  } = opts;
  const ctx = runContextALS.getStore() || {};
  const runId = opts.runId || ctx.runId || null;
  const ruSlug = opts.ruSlug || ctx.ruSlug || "unknown-ru";
  const mergedEnv = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb", ...env };

  return new Promise((resolve) => {
    let child;
    try {
      if (IS_WIN) {
        child = spawn("cmd.exe", ["/d", "/s", "/c", command], {
          cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: mergedEnv, windowsHide: true,
        });
      } else {
        const shellBin = process.env.SHELL || "/bin/zsh";
        child = spawn(shellBin, ["-c", command], {
          cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: mergedEnv,
        });
      }
    } catch (err) {
      resolve({ stdout: "", stderr: `spawn error: ${err.message}`, code: -1, timedOut: false });
      return;
    }

    // 輸出收集（bytes cap，防爆記憶體；截斷加註記）
    const outBufs = [], errBufs = [];
    let outLen = 0, errLen = 0;
    child.stdout?.on("data", (b) => { if (outLen < maxBufferBytes) { outBufs.push(b); outLen += b.length; } });
    child.stderr?.on("data", (b) => { if (errLen < maxBufferBytes) { errBufs.push(b); errLen += b.length; } });

    let settled = false;
    let timedOut = false;
    let killTimer = null, forceTimer = null, graceTimer = null;

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer); clearTimeout(forceTimer); clearTimeout(graceTimer);
      const stdout = Buffer.concat(outBufs).toString("utf-8") + (outLen >= maxBufferBytes ? "\n[proc-ledger] output truncated" : "");
      const stderr = Buffer.concat(errBufs).toString("utf-8") + (errLen >= maxBufferBytes ? "\n[proc-ledger] output truncated" : "");
      const result = {
        stdout,
        stderr,
        code: timedOut ? "timeout" : (signal ? `signal:${signal}` : code),
        timedOut,
      };
      // 殘留檢查 + 記帳（不擋回傳）
      _checkLinger(child.pid, { runId, ruSlug, command }).catch(() => {});
      resolve(result);
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer); clearTimeout(forceTimer);
      resolve({ stdout: "", stderr: String(err.message), code: -1, timedOut: false });
    });
    child.on("exit", (code, signal) => finish(code, signal));

    if (timeoutMs > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        // 整個 group 殺：TERM → 1.5s → KILL（exit event 會觸發 finish）
        const killAll = (sig) => {
          if (IS_WIN) { try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore", timeout: 10_000 }); } catch {} }  // nosemgrep: detect-child-process — taskkill 整棵 group（帳本 pid）
          else { try { process.kill(-child.pid, sig); } catch { try { process.kill(child.pid, sig); } catch {} } }
        };
        killAll("SIGTERM");
        forceTimer = setTimeout(() => killAll("SIGKILL"), 1500);
        // 保險：3 秒後沒等到 exit event 也要 resolve（agent 不能乾等）
        graceTimer = setTimeout(() => finish(null, "SIGKILL"), 3000);
        if (forceTimer.unref) forceTimer.unref();
        if (graceTimer.unref) graceTimer.unref();
      }, timeoutMs);
    }
  });
}

/**
 * 掃殺某個 agent run 記錄的殘留 process group。
 * 回傳 [{ pgid, command }]（有掃到的）；agent-loop 結尾呼叫 + log 摘要。
 */
export async function sweepRunProcesses(runId, { reason = "run-end" } = {}) {
  if (!runId) return [];
  return _sweep((e) => e.runId === runId, reason);
}

/** 掃殺某個 RU 的全部殘留（保險用 — 例如 RU 移除時） */
export async function sweepRuProcesses(ruSlug, { reason = "ru-sweep" } = {}) {
  if (!ruSlug) return [];
  return _sweep((e) => e.ruSlug === ruSlug, reason);
}

async function _sweep(matchFn, reason) {
  const targets = [..._entries.values()].filter(matchFn);
  const swept = [];
  for (const entry of targets) {
    const aliveBefore = IS_WIN ? _winChildrenOf(entry.pgid).length > 0 : _groupAlive(entry.pgid);
    if (!aliveBefore) { _entries.delete(entry.key); continue; }
    await _killEntry(entry, "SIGTERM");
    // 1.5 秒 grace → 還活著就 KILL
    await new Promise((r) => setTimeout(r, 1500));
    const aliveAfter = IS_WIN ? _winChildrenOf(entry.pgid).length > 0 : _groupAlive(entry.pgid);
    if (aliveAfter) await _killEntry(entry, "SIGKILL");
    _entries.delete(entry.key);
    swept.push({ pgid: entry.pgid, command: entry.command });
    try {
      console.log(`[proc-ledger] 🧹 swept pgid=${entry.pgid} reason=${reason} cmd="${String(entry.command).slice(0, 80)}"`);
    } catch {}
  }
  _saveState();
  return swept;
}

/** 帳本現況（debug / 監控用） */
export function ledgerStats() {
  const list = [..._entries.values()].map((e) => ({
    runId: e.runId, ruSlug: e.ruSlug, pgid: e.pgid,
    command: String(e.command).slice(0, 80), at: new Date(e.at).toISOString(),
  }));
  return { count: list.length, entries: list };
}

// ── 老化保險絲：殘留 > 2h 的 entry 定期收掉（run crash / server 重啟沒掃到的）──
let _ageTimerStarted = false;
function _startAgeSweeper() {
  if (_ageTimerStarted) return;
  _ageTimerStarted = true;
  const t = setInterval(() => {
    const cutoff = _now() - AGE_LIMIT_MS;
    const stale = [..._entries.values()].filter((e) => e.at < cutoff);
    if (stale.length === 0) return;
    console.log(`[proc-ledger] ⏰ 老化掃除：${stale.length} 個殘留超過 2 小時（${stale.map((s) => s.ruSlug).join(",")}）`);
    _sweep((e) => e.at < cutoff, "age-limit").catch(() => {});
  }, AGE_SWEEP_INTERVAL_MS);
  if (t.unref) t.unref();
}
_startAgeSweeper();
