// ── paaw-sandbox v2：srt（@anthropic-ai/sandbox-runtime）沙箱（2026-10-09 Fleming 23:15 拍板）──
// Anthropic 開源沙箱：macOS Seatbelt / Linux bubblewrap / Windows WFP，代理式 domain 白名單。
// 效果：AI bash 之外連不出去（除白名單 domain）、機密檔讀不到（~/.ssh/.env/providers.json）、
//       專案外寫不進去 — 混淆 payload 在 OS 層死，不靠 pattern 猜。
// npm install 在沙箱內完整可用（registry 在白名單、allowWrite 含專案+~/.npm）— 實測通。
// 逃生口：PAAW_SANDBOX=off 環境變數（debug 用）。
// 不可用時自動退回原樣執行（script-guard pattern 掃描仍在）。

import { readFileSync } from "fs";
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
