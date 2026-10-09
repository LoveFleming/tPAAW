// ── paaw-sandbox：AI bash 的網路沙箱（2026-10-09 v4，Fleming「只能透過受控通道連出去」）──
// macOS sandbox-exec（Seatbelt）：deny network*，只放行 localhost loopback。
// 效果：外部 URL 外傳 / 混淆 payload（base64+eval、字串拼接）/ DNS 外解 — 全部在網路層死，
//       不再依賴 pattern 掃描猜意圖。本地開發（npm test / git commit / localhost API / 起 dev server）零影響。
// 安裝類指令（npm install 等）需要網路 → 不包沙箱（由 script-guard 掃 package.json scripts 補防）。
// 非 macOS（公司 Windows/Linux）：本層不生效，退回 pattern 掃描防護。

import { existsSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PROFILE = `(version 1)
(allow default)
(deny network*)
(allow network-outbound (remote ip "localhost:*"))
(allow network-outbound (remote unix-socket (path "*")))
(allow network-inbound (local ip "localhost:*"))
`;

let _profilePath = null;

export function sandboxProfilePath() {
  if (_profilePath) return _profilePath;
  const dir = join(tmpdir(), "paaw-sandbox");
  try { mkdirSync(dir, { recursive: true }); } catch { return null; }
  const p = join(dir, "agent-net-off.sb");
  try { writeFileSync(p, PROFILE, "utf-8"); } catch { return null; }
  _profilePath = p;
  return p;
}

export function sandboxAvailable() {
  return process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && !!sandboxProfilePath();
}

// 需要網路的指令（安裝/套件下載/git 遠端）→ 不包沙箱；其餘全包。
// git push 雖列在此（需要網路才能失敗得清楚），但 script-guard v3 已一律擋。
const EGRESS_CMD =
  /\b(npm|yarn|pnpm|bun)\s+(install|i|ci|update|add)\b|\bpip3?\s+install\b|\bnpx\b|\bgit\s+(clone|fetch|pull|push)\b|\bbrew\s+(install|update|upgrade|search)\b/;

export function needsNetworkEgress(cmd) {
  return EGRESS_CMD.test(String(cmd || ""));
}

// POSIX 單引號跳脫，roundtrip 安全
const sq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

export function wrapSandboxCommand(cmd, shellBin = process.env.SHELL || "/bin/zsh") {
  const profile = sandboxProfilePath();
  if (!profile) return cmd;
  return `sandbox-exec -f ${sq(profile)} ${sq(shellBin)} -c ${sq(cmd)}`;
}
