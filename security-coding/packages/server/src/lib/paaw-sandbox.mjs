// ── paaw-sandbox v4：MXC 單後端（2026-10-13 Fleming：macOS 也走 MXC，全面移除 srt）──
// 動機：一套 sandbox 邏輯、跨平台一致，由 Microsoft MXC 當唯一 adapter →
//      macOS seatbelt / Linux bubblewrap / Windows ProcessContainer，之後維護更單純。
// v3：雙後端（srt + MXC）；v2：srt 後端。
// MXC egress：只能全開/全關（deny-by-default）；命令需要網路（npm/pip/git/curl…needsNetworkAllow）
//      → 該次 allow + 執行後輸出審計（scanCommandOutput）。
// MXC filesystem：allowlist 模式（未列路徑 = 讀不到），機密路徑 deny（~/.ssh/.env/providers.json）。
// npm install 在沙箱內實測可用（readwritePaths 含專案 + ~/.npm；egress allow）。
// 逃生口：PAAW_SANDBOX=off（debug）／🛠 開發模式。
// MXC 不可用時自動退回原樣執行（script-guard pattern 掃描仍在）。

import { readFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join } from "path";
import { DATA_HOME, LOG_HOME } from "../data-home.mjs";
import { posixShellBin } from "./shell-exec.mjs";
import { devModeOn } from "./security-mode.mjs"; // 🛠 開發模式總開關（2026-10-13）


// 確保沙箱 TMPDIR（$PAAW_TMP 上層）存在 — mktemp 對不存在的 TMPDIR 也是硬錯
function ensureSandboxTmp() {
  try { mkdirSync(resolve(LOG_HOME, "tmp"), { recursive: true }); } catch {}
}

/**
 * 沙箱可寫的「暫存根」—— MXC readwritePaths 用
 *   - $PAAW_TMP 上層（log/tmp）：agent 指定暫存區，session 結束 + janitor 每日清
 *   - 宿主 TMPDIR/TMP/TEMP 與 os.tmpdir()：各平台真正的 temp 根
 *     （Linux 通常 /tmp；Windows %TEMP% = C:\Users\…\AppData\Local\Temp）
 *   - macOS 再加 /var/folders：/usr/bin/mktemp **無 template 時硬走
 *     _CS_DARWIN_USER_TEMP_DIR**（/var/folders/…），TMPDIR 設了也照去（2026-10-11 實測）
 */
export function sandboxTempRoots() {
  ensureSandboxTmp(); // 先建 $PAAW_TMP 上層，否則下面的存在性過濾會把它濾掉
  const roots = new Set([resolve(LOG_HOME, "tmp")]);
  for (const k of ["TMPDIR", "TMP", "TEMP"]) {
    const v = process.env[k];
    if (v && v.trim()) { roots.add(v.trim()); roots.add(resolve(v.trim())); }
  }
  try { const t = tmpdir(); if (t) { roots.add(t); roots.add(resolve(t)); } } catch {}
  if (process.platform === "darwin") { roots.add("/var/folders"); roots.add("/private/var/folders"); }
  if (process.platform !== "win32") { roots.add("/tmp"); }
  if (process.platform === "darwin") { roots.add("/private/tmp"); } // macOS 專屬（Linux 無 /private/*）
  // ⚠️ 2026-10-13：只留真正存在的路徑 — bwrap bind 來源不存在會硬錯
  // （公司 Linux 實測：bwrap: Can't find source path /private/tmp）。
  return [...roots].filter((p) => p && existsSync(p));
}

// ── 白名單分兩層（2026-10-10 Fleming：不要寫死，data/ 可設 + Settings UI 管理）──
// 內建 = 系統必要（npm/pip/git/localhost），碼裡保底不能被 UI 刪掉
// 自訂 = data/config/network-whitelist.json { domains: [...] }，即時生效（每次讀）
const BUILTIN_DOMAINS = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "github.com",
  "objects.githubusercontent.com", // npm/git tarball CDN
  "codeload.github.com",
  "pypi.org",
  "files.pythonhosted.org",
  "localhost",
  "127.0.0.1",
];

function loadCustomWhitelist() {
  try {
    const cfg = JSON.parse(readFileSync(resolve(DATA_HOME, "config/network-whitelist.json"), "utf-8"));
    return Array.isArray(cfg?.domains) ? cfg.domains.filter(d => typeof d === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d.trim())) : [];
  } catch { return []; } // 無檔/壞檔 = 空自訂（內建照常）
}

// 對外 API 用：內建 + 自訂（去重）
export function effectiveAllowedDomains() {
  return [...new Set([...BUILTIN_DOMAINS, ...loadCustomWhitelist()])];
}
export function builtinAllowedDomains() { return [...BUILTIN_DOMAINS]; }
export function customAllowedDomains() { return loadCustomWhitelist(); }

export function sandboxKillSwitchOn() {
  if (process.env.PAAW_SANDBOX === "off") return true;
  // 🛠 開發模式總開關（2026-10-13 Fleming）：Settings → 安全 → 開發模式；也可 data/config/security.json
  if (devModeOn()) return true;
  return false;
}

// 沙箱可用性 = MXC 可用性（v4 單後端；函式名保留，呼叫端不需改）
export async function sandboxAvailable() {
  return await mxcAvailable();
}

// ═══════════════════════════════════════════════════════════════════
// MXC backend（v3，2026-10-10）— Microsoft @microsoft/mxc-sdk
// 動機：公司端 Linux+Windows 原本完全沒有攔截層；v4 起 macOS 也統一走 MXC。
// MXC stable 預設後端：Windows ProcessContainer / Linux bubblewrap / macOS seatbelt。
// 實測（Mac mini spike 2026-10-10）：filesystem default-deny allowlist（未列路徑一律 EPERM）、
// deniedPaths 優先於 readonlyPaths、bash -c 包裝 pipe/redirect 可用、egress 只能全開/全關
// （allow 規則 seatbelt 不支援 — 白名單 per-domain 在 MXC 模式由 needsNetworkAllow + 事後審計把關）。
// ═══════════════════════════════════════════════════════════════════

let _MXC = null;
let _mxcUnavailable = false;
let _mxcWarned = false;

async function loadMXC() {
  if (_MXC) return _MXC;
  const mod = await import("@microsoft/mxc-sdk/v1");
  _MXC = mod;
  return mod;
}

export async function mxcAvailable() {
  if (sandboxKillSwitchOn()) return false;
  if (_mxcUnavailable) return false;
  try {
    const m = await loadMXC();
    const plat = await m.getPlatformSupport();
    if (!plat?.isSupported) { _mxcUnavailable = true; return false; }
    return true;
  } catch {
    _mxcUnavailable = true; // 套件未裝（optionalDependencies 裝失敗等）
    return false;
  }
}

// 後端（v4：只有一種 = MXC）。PAAW_SANDBOX_BACKEND=off 可關；其餘值一律 mxc（相容舊 srt 設定）
export function activeBackend() {
  if (sandboxKillSwitchOn()) return null;
  const v = (process.env.PAAW_SANDBOX_BACKEND || "auto").toLowerCase();
  if (v === "off") return null;
  return "mxc";
}

// 命令是否需要網路（MXC deny-by-default 的逃生判定）— 粗粒度白名單：
// 套件管理/版本庫/下載工具 → egress allow（執行後仍有 scanCommandOutput 審計）
const NET_NEED_RE = /(^|[\s;&|(])(npm|npx|yarn|pnpm|bun|pip3?|uv|cargo|gradle|mvn|go)\b|git\s+(clone|fetch|pull|ls-remote|remote\s+update|submodule)\b|\b(curl|wget|brew|apt|apt-get|yum|dnf)\b|python3?\s+-m\s+pip\b|go\s+(get|mod\s+download)\b|deno\s+(install|add|cache)\b/i;
export function needsNetworkAllow(command) {
  return NET_NEED_RE.test(String(command || ""));
}

// MXC filesystem policy：allowlist 模式（未列路徑 = 讀不到 — 比舊黑名單式更嚴）
export function buildMxcFsPolicy(cwd) {
  // 註：匯出供單元測試（tests/unit/paaw-sandbox-mxc.test.mjs）驗證跨平台路徑過濾
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const nodeDir = resolve(process.execPath, "..");
  const cwdReal = resolve(cwd || process.cwd());
  const isMac = process.platform === "darwin";
  // ⚠️ 2026-10-13（公司 Linux 修正）：跨平台安全清單只放「本機真的存在」的路徑 +
  // macOS 專屬路徑只在 darwin 列。bwrap（MXC Linux 後端）bind 一個不存在的來源 =
  // 硬錯「Can't find source path ...」→ 整個沙箱指令失敗 → coding app 無法對 packages 寫入。
  const keep = (arr) => [...new Set(arr.map((p) => {
    if (!p) return null;
    try { return existsSync(p) ? p : null; } catch { return null; }
  }).filter(Boolean))];
  // ⚠️ /private/var 不可列入 — 實測（2026-10-10 bisect）：列入後 MXC 內建的系統服務 socket
  // 通道（mDNSResponder）被覆蓋，DNS 全死（ENOTFOUND）；不列反而保留內建通道
  const sep = process.platform === "win32" ? "\\" : "/";
  const inside = (child, parent) => !!child && !!parent &&
    (child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep));
  const baseReadonly = keep([
    "/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc",
    isMac ? "/private/etc" : null,
    "/opt", "/usr/local",
    isMac ? "/opt/homebrew" : null,
    nodeDir,       // node 執行檔目錄（nvm/brew 裝的都在 home 或 /opt）
  ]);
  const readwritePaths = keep([
    cwdReal,       // 專案可寫（RU 工作區）
    ...sandboxTempRoots(), // $PAAW_TMP 上層 + 各平台 temp 根（含 Windows %TEMP%）— 2026-10-11
    home ? join(home, ".npm") : null,          // 2026-10-13：join 防 Windows 混用分隔符
    home ? join(home, ".cache") : null,
    isMac && home ? join(home, "Library", "Caches") : null, // macOS npm cache
    home ? join(home, ".cargo") : null,        // cargo 下載快取
  ]);
  // 機密一律擋（同舊 srt 黑名單語意；MXC 無 glob — 列具體路徑，default-deny 已保底其餘）
  const deniedPaths = keep([
    home ? join(home, ".ssh") : null,
    home ? join(home, ".openclaw") : null, // gateway config（含 token）
    home ? join(home, ".aws") : null,
    home ? join(home, ".gnupg") : null,
    join(cwdReal, ".env"),
    join(cwdReal, "data", "config", "providers.json"), // PAAW AI 金鑰
  ]);
  // ⚠️ 2026-10-13（公司 Linux 第二修—cwd 變唯讀）：MXC 把這些清單變成**掛載**；若 readwrite
  // 路徑落在某個 readonly 路徑底下（或同一路徑同時在兩邊），後套用的 ro 掛載會蓋掉 rw
  // → 工作目錄變 RO（"Read-only file system"）。規則：
  //   1) readonly 不得含 readwrite 的自身/祖先/子孫
  //   2) HOME 若包含任何 rw 路徑 → 展開成「子項目」逐一 ro（~/.gitconfig 等仍可讀），
  //      不再整包 ro home（否則會蓋掉 cwd）
  const homeRo = (() => {
    if (!home || !existsSync(home)) return [];
    if (!readwritePaths.some((p) => inside(p, home))) return [home];
    try { return readdirSync(home).map((n) => join(home, n)); }
    catch { return [home]; }
  })();
  const overlapsRw = (p) => readwritePaths.some((rw) => inside(p, rw) || inside(rw, p));
  const readonlyPaths = keep([...baseReadonly, ...homeRo])
    .filter((p) => !overlapsRw(p))
    .filter((p) => !deniedPaths.some((d) => inside(p, d)));
  return { readonlyPaths, readwritePaths, deniedPaths };
}

function posixQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// MXC command：完整 shell 字串包進 bash -c（pipe/redirect/env 展開都要 shell）
// win32：MXC ProcessContainer 用 cmd 解譯（公司端命令本就以該 shell 為準）
function wrapForMxc(command) {
  if (process.platform === "win32") return command; // ProcessContainer 自帶 shell 解譯
  return `${posixQuote(posixShellBin())} -c ${posixQuote(command)}`; // 2026-10-13：不硬寫 /bin/bash（極簡 Linux 可能沒有）
}

function buildMxcEnv(extraEnv = {}) {
  // 2026-10-11：沙箱內 TMPDIR/TMP/TEMP 一律導到 $PAAW_TMP（log/tmp，已授權可寫）—
  // 宿主 temp 根不在 readwritePaths 時暫存寫入會 EPERM（macOS /var/folders、Windows %TEMP%）；
  // 這個目錄 agent loop 每 session 清、janitor 每日再保險清（Fleming 2026-10-11：放外面可以，記得清）。
  const sbTmp = resolve(LOG_HOME, "tmp");
  return {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: process.env.HOME || process.env.USERPROFILE || "", // Windows 需要 USERPROFILE fallback
    TMPDIR: sbTmp,
    TMP: sbTmp,
    TEMP: sbTmp,
    LANG: process.env.LANG || "en_US.UTF-8",
    ...extraEnv,
  };
}

// ── 統一沙箱執行入口（v4：MXC 單後端）──
// 回傳 { code, stdout, stderr, timedOut, sandboxed, backend: "mxc"|"none" }
// ⚠️ MXC 路徑不走 proc-ledger 記帳（MXC SDK 自管 timeout 殺整組）；不可用時 raw fallback。
export async function execSandboxed(command, opts = {}) {
  const { cwd = process.cwd(), timeoutMs = 600_000, env = {}, network = "deny" } = opts;
  const cap = Math.min(Number(timeoutMs) || 600_000, 900_000);

  if (activeBackend() === "mxc" && await mxcAvailable()) {
    try {
      ensureSandboxTmp();
      const m = await loadMXC();
      const egress = network === "allow" ? "allow" : "deny";
      const child = await m.spawn({
        command: wrapForMxc(command),
        filesystem: buildMxcFsPolicy(cwd),
        network: { egress: { default: egress } },
        timeoutMs: cap,
        workingDirectory: resolve(cwd),
        environment: buildMxcEnv(env),
      });
      let stdout = "", stderr = "";
      child.standardOutput?.on("data", (c) => { stdout += c; if (stdout.length > 16 * 1024 * 1024) child.standardOutput.destroy(); });
      child.standardError?.on("data", (c) => { stderr += c; if (stderr.length > 4 * 1024 * 1024) child.standardError.destroy(); });
      const w = await child.wait();
      return {
        code: w.exitCode, stdout, stderr, timedOut: !!w.timedOut,
        sandboxed: true, backend: "mxc",
      };
    } catch (e) {
      // 2026-10-13：MXC 啟動失敗 → 退回原樣執行（可用性優先），但**不能安靜** —
      // 至少印一次警告，否則「以為有沙箱、其實沒有」= 最危險的假安全。
      if (!_mxcWarned) {
        _mxcWarned = true;
        console.warn(`[sandbox] MXC 啟動失敗，改為原樣執行（無沙箱）：${e?.message || e}`);
      }
    }
  }
  return await rawShellExec(command, { cwd, timeoutMs: cap, env });
}

// raw：無沙箱原樣執行（跟 v2 不可用時行為一致 — pattern 掃描/審計仍在消費端）
async function rawShellExec(command, { cwd, timeoutMs, env }) {
  const isWin = process.platform === "win32";
  const shellBin = posixShellBin(); // Windows→ComSpec/cmd.exe；POSIX→存在的 shell（bash→sh→zsh）
  const args = isWin ? ["/c", command] : ["-c", command];
  return await new Promise((res) => {
    execFile(shellBin, args, {
      cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...env },
    }, (err, stdout, stderr) => {
      res({
        code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || ""),
        timedOut: !!(err && err.killed), sandboxed: false, backend: "none",
      });
    });
  });
}
