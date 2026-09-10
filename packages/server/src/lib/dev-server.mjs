/**
 * dev-server.mjs — Dev Server Controller（2026-09-10 Fleming 定調，Phase 1）
 *
 * 給 coding agents 的長駐程序控制器：start / stop / restart / status + log 讀取。
 * 設計原則（memory/2026-09-10.md）：
 * - 不共享 PTY — `npm run dev` 不需要 TTY，需要的是「程序活著 + log 讀得到 + 能重啟」
 * - log 寫 log/app-console/<ru-slug>/app-console-YYYY-MM-DD.log（既有 convention，
 *   janitor.mjs / ConsoleLogView 的 📦 App 檢視器讀同一份）→ 人零 UI 改動同步看得到
 * - detached spawn：agent session 結束程序不死；PAAW server 重啟後靠 state.json 偵測孤兒
 * - 跨平台：Windows 用 cmd.exe /c + taskkill /T /F 樹殺；macOS/Linux 用 process group kill
 *   （⚠️ 不用 node-pty detached — ConPTY flaky，dev server 不需要 TTY）
 * - 重啟保護：10 分鐘滑動窗口內最多 5 次 restart，超過擋下（防 crash loop 燒 token）
 * - EADDRINUSE 防護：strip PAAW 自己的 port env（同 ws-handler.mjs 的教訓）
 *
 * 使用（paaw-agent-loop executeTool）：
 *   import { devServerAction, readDevLog } from "./dev-server.mjs";
 *   const out = await devServerAction(cwd, { action: "start", command: "npm run dev" });
 *   const tail = await readDevLog(cwd, { lines: 100 });
 */

import { spawn, execSync } from "child_process";
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
  closeSync, openSync, writeSync, statSync, readSync,
} from "fs";
import { join } from "path";
import { LOG_HOME, logSlug } from "../data-home.mjs";

const IS_WIN = process.platform === "win32";

// ── ws-handler.mjs 同款：strip PAAW 自己的 port/root env，讓子程序讀自己的 .env（防 EADDRINUSE）──
const PAAW_ENV_KEYS = [
  "PAAW_PORT", "PAAW_WS_PORT", "BRIDGE_PORT", "VITE_PORT",
  "PAAW_ENV", "PAAW_CONTAINER", "PAAW_ROOT",
];

// ── Registry：ru slug → 目前受控的 dev server（in-memory；server 重啟後靠 state.json 偵測孤兒）──
const _reg = new Map();

// ── 重啟保護 ──
const RESTART_WINDOW_MS = 10 * 60 * 1000; // 10 分鐘滑動窗口
const RESTART_MAX = 5;

function _ymd() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function _ts() { return new Date().toISOString(); }

function _slug(ruRoot) { return logSlug(ruRoot); }

function _dir(ruRoot) { return join(LOG_HOME, "app-console", _slug(ruRoot)); }

function _statePath(ruRoot) { return join(_dir(ruRoot), "dev-server-state.json"); }

/** 今天（本地日）的 log 檔 — 照 janitor.mjs 的 convention：app-console-YYYY-MM-DD.log */
function _todayLogPath(ruRoot) { return join(_dir(ruRoot), `app-console-${_ymd()}.log`); }

function _readState(ruRoot) {
  try { return JSON.parse(readFileSync(_statePath(ruRoot), "utf-8")); } catch { return null; }
}

function _writeState(ruRoot, obj) {
  try {
    mkdirSync(_dir(ruRoot), { recursive: true });
    writeFileSync(_statePath(ruRoot), JSON.stringify(obj, null, 2));
  } catch {}
}

/** pid 是否還活著（signal 0 探測；EPERM = 活著但不歸我們管） */
function _pidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}

/** 取得受控狀態（registry 優先；無 registry 但 state.json 有活 pid → 孤兒） */
function _getEntry(ruRoot) {
  const slug = _slug(ruRoot);
  const entry = _reg.get(slug);
  if (entry) return entry;
  const st = _readState(ruRoot);
  if (st?.pid && _pidAlive(st.pid)) {
    return {
      orphan: true, pid: st.pid, command: st.command,
      logPath: st.logPath, startedAt: st.startedAt, restarts: [],
      exited: null,
    };
  }
  return null;
}

function _statusObj(ruRoot, entry) {
  if (!entry) {
    const st = _readState(ruRoot);
    return {
      running: false,
      lastExit: st?.lastExit || null,
      logDir: _dir(ruRoot),
    };
  }
  const running = entry.orphan ? true : (entry.child && entry.child.exitCode === null && !entry.exited);
  return {
    running,
    orphan: !!entry.orphan,
    pid: entry.pid,
    command: entry.command,
    logPath: entry.logPath,
    startedAt: entry.startedAt,
    exited: entry.exited || null,
    restarts: (entry.restarts || []).length,
  };
}

/** 把 status 物件格式化成 agent 友善的字串 */
function _fmtStatus(s) {
  let out = `【dev_server status】`;
  if (s.running) {
    out += `running${s.orphan ? "（孤兒 — PAAW server 重啟過，程序還活著；用 stop/restart 可重新納管）" : ""}\n`;
    out += `command: ${s.command}\npid: ${s.pid}\nstartedAt: ${s.startedAt}\nlog: ${s.logPath}`;
    if (s.restarts) out += `\nrestarts(10min): ${s.restarts}`;
  } else if (s.exited) {
    out += `stopped（exit code ${s.exited.code} at ${s.exited.at}）`;
  } else if (s.lastExit) {
    out += `stopped（last exit code ${s.lastExit.code} at ${s.lastExit.at}）`;
  } else {
    out += `not running`;
  }
  if (s.logDir) out += `\nlogDir: ${s.logDir}`;
  return out;
}

/**
 * 啟動 dev server（detached，立即回傳）。
 */
export async function devServerStart(ruRoot, opts = {}) {
  const command = opts.command || "npm run dev";
  const slug = _slug(ruRoot);

  const existing = _getEntry(ruRoot);
  if (existing) {
    const s = _statusObj(ruRoot, existing);
    return `【dev_server】已在執行中，不重複啟動。${_fmtStatus(s)}\n要換指令或吃新 code 請用 action="restart"。`;
  }

  // log 檔：沿用今天的 convention 檔名（人類在 📜 Console → 📦 App 看同一份）
  mkdirSync(_dir(ruRoot), { recursive: true });
  const logPath = _todayLogPath(ruRoot);
  const fd = openSync(logPath, "a");

  // env：strip PAAW port env + 關顏色（log 檔乾淨，ConsoleLogView 好讀）
  const env = { ...process.env };
  for (const k of PAAW_ENV_KEYS) delete env[k];
  env.FORCE_COLOR = "0";
  env.NO_COLOR = "1";
  env.TERM = "dumb";

  appendToFd(fd, `\n[dev-server] === start === ${_ts()} command="${command}" cwd="${ruRoot}"\n`);

  // 跨平台 detached spawn：
  // - Windows: cmd.exe /c <command>（cmd 解析 npm.cmd / .bat）；taskkill /T 負責樹殺
  // - macOS/Linux: $SHELL -c <command>；detached → 新 process group（pgid = pid）→ kill(-pid) 群殺
  let child;
  if (IS_WIN) {
    child = spawn("cmd.exe", ["/c", command], {
      cwd: ruRoot, detached: true, stdio: ["ignore", fd, fd], env,
    });
  } else {
    const shellBin = process.env.SHELL || "/bin/zsh";
    child = spawn(shellBin, ["-c", command], {
      cwd: ruRoot, detached: true, stdio: ["ignore", fd, fd], env,
    });
  }
  child.unref();

  const entry = {
    child, pid: child.pid, command, logPath, fd,
    startedAt: _ts(), restarts: [], exited: null, orphan: false,
  };
  _reg.set(slug, entry);

  // 自然退出（crash / 跑完 / 被殺）→ log 落墓碑 + 更新 state，讓 agent status 看得到
  child.on("exit", (code, signal) => {
    const reason = signal ? `signal=${signal}` : `code=${code}`;
    appendToFd(fd, `\n[dev-server] === exited === ${reason} at=${_ts()}\n`);
    try { closeSync(fd); } catch {}
    entry.exited = { code: signal ? `signal:${signal}` : code, at: _ts() };
    _writeState(ruRoot, {
      pid: null, command, cwd: ruRoot, logPath,
      startedAt: entry.startedAt, lastExit: entry.exited,
    });
  });
  child.on("error", (err) => {
    appendToFd(fd, `\n[dev-server] === spawn error === ${err.message} at=${_ts()}\n`);
    try { closeSync(fd); } catch {}
    entry.exited = { code: -1, at: _ts() };
  });

  _writeState(ruRoot, { pid: child.pid, command, cwd: ruRoot, logPath, startedAt: entry.startedAt });

  // 給程序一點時間偵測即炸（command not found / port occupied 通常 1 秒內噴）
  await new Promise((r) => setTimeout(r, 1200));

  return `【dev_server】started\ncode: ${command}\npid: ${child.pid}\nlog: ${normalize(logPath)}\nstatus: ${entry.exited ? `已退出（code=${entry.exited.code}）— 用 dev_log 看原因` : "running"}\n下一步：dev_log 讀輸出確認起來了（找 port listening / error）。人在 CodingIDE Terminal → 📜 Console → 📦 App 看得到。`;
}

function appendToFd(fd, text) {
  try { writeSync(fd, text); } catch {}
}

/**
 * 停止 dev server（跨平台樹殺）。
 */
export async function devServerStop(ruRoot) {
  const entry = _getEntry(ruRoot);
  if (!entry) return `【dev_server】目前沒有在執行（狀態：${_fmtStatus(_statusObj(ruRoot, null))}）`;

  const pid = entry.pid;
  let killed = true;
  if (IS_WIN) {
    // taskkill /T = 連子程序整棵樹，/F = 強制（npm → node 樹）
    try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" }); }
    catch { killed = false; }
  } else {
    // 群殺（detached 讓 child 是 group leader）；fallback 單殺
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
    // 等最多 3 秒，還活著就 SIGKILL
    for (let i = 0; i < 30 && _pidAlive(pid); i++) await new Promise((r) => setTimeout(r, 100));
    if (_pidAlive(pid)) {
      try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
    }
  }

  // 清 registry + state（孤兒 case 沒有 registry entry）
  const slug = _slug(ruRoot);
  const regEntry = _reg.get(slug);
  if (regEntry) {
    if (regEntry.fd) { try { closeSync(regEntry.fd); } catch {} }
    _reg.delete(slug);
  }
  const st = _readState(ruRoot) || {};
  _writeState(ruRoot, { ...st, pid: null, stoppedAt: _ts() });

  return `【dev_server】stopped（pid ${pid}${killed ? "" : " — kill 訊號送出但無法確認，可用 status 驗證"}）`;
}

/**
 * 重啟（含 crash-loop 保護：10 分鐘內最多 5 次）。
 */
export async function devServerRestart(ruRoot, opts = {}) {
  const slug = _slug(ruRoot);
  const entry = _reg.get(slug) || { restarts: [] };

  // 滑動窗口過濾
  const now = Date.now();
  entry.restarts = (entry.restarts || []).filter((t) => now - t < RESTART_WINDOW_MS);
  if (entry.restarts.length >= RESTART_MAX) {
    const oldest = entry.restarts[0];
    const waitSec = Math.ceil((RESTART_WINDOW_MS - (now - oldest)) / 1000);
    return `【dev_server】⚠️ 重啟保護觸發：10 分鐘內已重啟 ${entry.restarts.length} 次。連續 crash 通常代表 bug 還沒修好 — 先 dev_log 讀 log 找根因，修好再重啟。${waitSec > 0 ? `（約 ${waitSec} 秒後冷卻結束）` : ""}`;
  }
  entry.restarts.push(now);

  await devServerStop(ruRoot);
  // 給 OS 一點時間釋放 port
  await new Promise((r) => setTimeout(r, 800));
  const out = await devServerStart(ruRoot, opts);
  return out.replace("【dev_server】started", `【dev_server】restarted（10min 內第 ${entry.restarts.length}/${RESTART_MAX} 次）`);
}

/**
 * 讀 app console log tail（registry 的現役 log 優先；否則挑目錄裡最新一份 dated log — 同 janitor.mjs 邏輯）。
 */
export async function readDevLog(ruRoot, opts = {}) {
  const lines = Math.min(Math.max(parseInt(opts.lines, 10) || 100, 1), 400);
  const dir = _dir(ruRoot);

  let file = null;
  const entry = _getEntry(ruRoot);
  if (entry?.logPath && existsSync(entry.logPath)) file = entry.logPath;
  else {
    try {
      const dated = readdirSync(dir).filter((f) => /^app-console-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
      if (dated.length > 0) file = join(dir, dated[dated.length - 1]);
      else file = join(dir, "app-console.log"); // janitor 同款 fallback
    } catch {}
  }
  if (!file || !existsSync(file)) {
    return `【dev_log】沒有 log 可讀（${normalize(dir)} 不存在或沒有 app-console-*.log）。先 dev_server(action="start") 啟動。`;
  }

  // 只讀檔尾 256KB（dev log 可能很大；console 不需要全讀）
  const st = statSync(file);
  const len = Math.min(st.size, 256 * 1024);
  const start = st.size - len;
  const fd = openSync(file, "r");
  const buf = Buffer.alloc(len);
  try { readSync(fd, buf, 0, len, start); } finally { try { closeSync(fd); } catch {} }
  const text = buf.toString("utf-8");

  const all = text.split(/\r?\n/);
  const tail = all.slice(-lines).join("\n");
  return `【dev_log】${normalize(file)} 最後 ${Math.min(lines, all.length)} 行：\n${tail}`;
}

/**
 * dev_server tool 的 action 分派入口。
 */
export async function devServerAction(ruRoot, args = {}) {
  const action = args.action;
  switch (action) {
    case "start": return devServerStart(ruRoot, args);
    case "stop": return devServerStop(ruRoot);
    case "restart": return devServerRestart(ruRoot, args);
    case "status": {
      const entry = _getEntry(ruRoot);
      return _fmtStatus(_statusObj(ruRoot, entry));
    }
    default:
      return `【dev_server】未知 action "${action}"（可用：start / stop / restart / status）`;
  }
}

/** 給 log 顯示用的跨平台路徑（\ → /） */
function normalize(p) { return (p || "").toString().replace(/\\/g, "/"); }
