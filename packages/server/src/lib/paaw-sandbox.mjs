// ── paaw-sandbox v2：srt（@anthropic-ai/sandbox-runtime）沙箱（2026-10-09 Fleming 23:15 拍板）──
// Anthropic 開源沙箱：macOS Seatbelt / Linux bubblewrap / Windows WFP，代理式 domain 白名單。
// 效果：AI bash 之外連不出去（除白名單 domain）、機密檔讀不到（~/.ssh/.env/providers.json）、
//       專案外寫不進去 — 混淆 payload 在 OS 層死，不靠 pattern 猜。
// npm install 在沙箱內完整可用（registry 在白名單、allowWrite 含專案+~/.npm）— 實測通。
// 逃生口：PAAW_SANDBOX=off 環境變數（debug 用）。
// 不可用時自動退回原樣執行（script-guard pattern 掃描仍在）。

let _SM = null;
let _inited = false;
let _unavailable = false;

const ALLOWED_DOMAINS = [
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
      allowedDomains: ALLOWED_DOMAINS,
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
