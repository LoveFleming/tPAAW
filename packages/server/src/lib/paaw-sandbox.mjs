// ── paaw-sandbox v3：srt + MXC 雙後端（2026-10-10 Fleming 拍板：公司 Linux+Windows 統一攔截層）──
// v2（2026-10-09）：srt（@anthropic-ai/sandbox-runtime）沙箱。
// v3：新增 Microsoft MXC（@microsoft/mxc-sdk）後端 — Windows ProcessContainer / Linux bubblewrap。
//     auto 模式：macOS→srt（per-domain 白名單較精細、已實測）；win32/linux→mxc（fallback srt→原樣）。
//     MXC egress：deny-by-default；命令需要網路（npm/pip/git/curl…needsNetworkAllow）→ allow + 事後審計。
// Anthropic 開源沙箱：macOS Seatbelt / Linux bubblewrap / Windows WFP，代理式 domain 白名單。
// 效果：AI bash 之外連不出去（除白名單 domain）、機密檔讀不到（~/.ssh/.env/providers.json）、
//       專案外寫不進去 — 混淆 payload 在 OS 層死，不靠 pattern 猜。
// npm install 在沙箱內完整可用（registry 在白名單、allowWrite 含專案+~/.npm）— 實測通。
// 逃生口：PAAW_SANDBOX=off 環境變數（debug 用）。
// 不可用時自動退回原樣執行（script-guard pattern 掃描仍在）。

import { readFileSync } from "fs";
import { execFile } from "node:child_process";
import { resolve } from "path";
import { DATA_HOME } from "../data-home.mjs";

let _SM = null;
let _inited = false;
let _unavailable = false;

// ── 白名單分兩層（2026-10-10 Fleming：不要寫死，data/ 可設 + Settings UI 管理）──
// 內建 = 系統必要（npm/pip/git/localhost），碼裡保底不能被 UI 刪掉
// 自訂 = data/config/network-whitelist.json { domains: [...] }，即時生效（buildConfig 每次讀）
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

const DENY_READ = [
  "~/.ssh",
  ".env",
  "**/.env",
  "**/providers.json",
  "~/.openclaw", // gateway config（含 token）
  "~/.aws",
  "~/.gnupg",
];

async function loadSM() {
  if (_SM) return _SM;
  const mod = await import("@anthropic-ai/sandbox-runtime");
  _SM = mod.SandboxManager;
  return _SM;
}

export function sandboxKillSwitchOn() {
  return process.env.PAAW_SANDBOX === "off";
}

export async function sandboxAvailable() {
  if (sandboxKillSwitchOn()) return false;
  if (_unavailable) return false;
  try {
    const SM = await loadSM();
    return !!SM.isSupportedPlatform();
  } catch {
    _unavailable = true; // 套件不存在（公司端未裝）等
    return false;
  }
}

// 包指令：cwd = RU 專案目錄（allowWrite 主體）。失敗 = 回原指令（上層 pattern 掃描仍在）。
export async function wrapWithSrt(command, cwd) {
  if (sandboxKillSwitchOn()) return command;
  try {
    const SM = await loadSM();
    if (!_inited) {
      await SM.initialize(buildConfig(cwd));
      _inited = true;
    }
    // per-call 完整 config（allowWrite 隨 RU cwd 變）
    return await SM.wrapWithSandbox(command, process.env.SHELL || "/bin/zsh", buildConfig(cwd));
  } catch {
    return command;
  }
}

function buildConfig(cwd) {
  return {
    network: {
      allowedDomains: effectiveAllowedDomains(),
      deniedDomains: [],
      allowLocalBinding: true,   // dev server bind + loopback 測試
      allowAllUnixSockets: true, // 本地 IPC（docker socket 等）
    },
    filesystem: {
      denyRead: DENY_READ,
      allowWrite: [cwd, "/tmp", "/private/tmp", "~/.npm", "~/Library/Caches", "~/.cache"], // macOS /tmp 是 /private/tmp symlink — Seatbelt 看真實路徑
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// MXC backend（v3，2026-10-10）— Microsoft @microsoft/mxc-sdk
// 動機：公司端 Linux+Windows 原本完全沒有攔截層（srt 未裝/未驗證）。
// MXC stable 預設後端：Windows ProcessContainer / Linux bubblewrap / macOS seatbelt。
// 實測（Mac mini spike 2026-10-10）：filesystem default-deny allowlist（未列路徑一律 EPERM）、
// deniedPaths 優先於 readonlyPaths、bash -c 包裝 pipe/redirect 可用、egress 只能全開/全關
// （allow 規則 seatbelt 不支援 — 白名單 per-domain 在 MXC 模式由 needsNetworkAllow + 事後審計把關）。
// ═══════════════════════════════════════════════════════════════════

let _MXC = null;
let _mxcUnavailable = false;

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

// 後端選擇：PAAW_SANDBOX_BACKEND=auto|mxc|srt|off（auto=darwin→srt，其他→mxc）
export function activeBackend() {
  if (sandboxKillSwitchOn()) return null;
  const v = (process.env.PAAW_SANDBOX_BACKEND || "auto").toLowerCase();
  if (v === "off") return null;
  if (v === "mxc" || v === "srt") return v;
  return process.platform === "darwin" ? "srt" : "mxc";
}

// 命令是否需要網路（MXC deny-by-default 的逃生判定）— 粗粒度白名單：
// 套件管理/版本庫/下載工具 → egress allow（執行後仍有 scanCommandOutput 審計）
const NET_NEED_RE = /(^|[\s;&|(])(npm|npx|yarn|pnpm|bun|pip3?|uv|cargo|gradle|mvn|go)\b|git\s+(clone|fetch|pull|ls-remote|remote\s+update|submodule)\b|\b(curl|wget|brew|apt|apt-get|yum|dnf)\b|python3?\s+-m\s+pip\b|go\s+(get|mod\s+download)\b|deno\s+(install|add|cache)\b/i;
export function needsNetworkAllow(command) {
  return NET_NEED_RE.test(String(command || ""));
}

// MXC filesystem policy：allowlist 模式（未列路徑 = 讀不到 — 跟 srt 黑名單相反，預設更嚴）
function buildMxcFsPolicy(cwd) {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const nodeDir = resolve(process.execPath, "..");
  const tmp = process.env.TMPDIR || "/tmp";
  const cwdReal = resolve(cwd || process.cwd());
  // ⚠️ /private/var 不可列入 — 實測（2026-10-10 bisect）：列入後 MXC 內建的系統服務 socket
  // 通道（mDNSResponder）被覆蓋，DNS 全死（ENOTFOUND）；不列反而保留內建通道
  const readonlyPaths = [...new Set([
    "/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/private/etc",
    "/opt", "/usr/local", "/opt/homebrew",
    nodeDir,       // node 執行檔目錄（nvm/brew 裝的都在 home 或 /opt）
    home,          // HOME readonly（敏感子路徑用 deniedPaths 蓋 — 實測 denied 優先）
    cwdReal,       // 專案根 readonly
  ])].filter(Boolean);
  const readwritePaths = [...new Set([
    cwdReal,       // 專案可寫（RU 工作區）
    tmp, "/tmp", "/private/tmp",
    home ? `${home}/.npm` : null,
    home ? `${home}/.cache` : null,
    home ? `${home}/Library/Caches` : null, // macOS npm cache
    home ? `${home}/.cargo` : null,         // cargo 下載快取
  ])].filter(Boolean);
  // 機密一律擋（同 srt DENY_READ 語意；MXC 無 glob — 列具體路徑，default-deny 已保底其餘）
  const deniedPaths = [...new Set([
    home ? `${home}/.ssh` : null,
    home ? `${home}/.openclaw` : null,      // gateway config（含 token）
    home ? `${home}/.aws` : null,
    home ? `${home}/.gnupg` : null,
    `${cwdReal}/.env`,
    `${cwdReal}/data/config/providers.json`, // PAAW AI 金鑰
  ])].filter(Boolean);
  return { readonlyPaths, readwritePaths, deniedPaths };
}

function posixQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// MXC command：完整 shell 字串包進 bash -c（pipe/redirect/env 展開都要 shell）
// win32：MXC ProcessContainer 用 cmd 解譯（公司端命令本就以該 shell 為準）
function wrapForMxc(command) {
  if (process.platform === "win32") return command; // ProcessContainer 自帶 shell 解譯
  return `/bin/bash -c ${posixQuote(command)}`;
}

function buildMxcEnv(extraEnv = {}) {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: process.env.HOME || "",
    TMPDIR: process.env.TMPDIR || "/tmp",
    LANG: process.env.LANG || "en_US.UTF-8",
    ...extraEnv,
  };
}

// ── 統一沙箱執行入口（v3）──
// 回傳 { code, stdout, stderr, timedOut, sandboxed, backend: "mxc"|"srt"|"none" }
// backend 選擇：activeBackend() → 可用性偵測 → fallback 鏈 mxc→srt→raw
export async function execSandboxed(command, opts = {}) {
  const { cwd = process.cwd(), timeoutMs = 600_000, env = {}, network = "deny" } = opts;
  const cap = Math.min(Number(timeoutMs) || 600_000, 900_000);
  const backend = activeBackend();

  if (backend === "mxc" || (backend !== "srt" && process.platform !== "darwin")) {
    if (await mxcAvailable()) {
      try {
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
      } catch { /* MXC 啟動失敗 → fallback 下方 srt/raw */ }
    }
  }
  if (backend === "mxc") {
    // 強制 mxc 但不可用 → raw（維持可用性優先）
    return await rawShellExec(command, { cwd, timeoutMs: cap, env });
  }

  // srt 路徑（macOS 預設；mxc 啟動失敗的 fallback）
  if (await sandboxAvailable()) {
    try {
      const quoted = command; // bash 工具傳入已是完整 shell 字串
      const wrapped = await wrapWithSrt(quoted, cwd);
      if (wrapped && wrapped !== quoted) {
        return await new Promise((res) => {
          execFile("/bin/zsh", ["-c", wrapped], {
            cwd, timeout: cap, maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`, ...env },
          }, (err, stdout, stderr) => {
            res({
              code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || ""),
              timedOut: !!(err && err.killed), sandboxed: true, backend: "srt",
            });
          });
        });
      }
    } catch { /* fallback raw */ }
  }
  return await rawShellExec(command, { cwd, timeoutMs: cap, env });
}

// raw：無沙箱原樣執行（跟 v2 不可用時行為一致 — pattern 掃描/審計仍在消費端）
async function rawShellExec(command, { cwd, timeoutMs, env }) {
  const isWin = process.platform === "win32";
  const shellBin = isWin ? (process.env.ComSpec || "cmd.exe") : "/bin/bash";
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
