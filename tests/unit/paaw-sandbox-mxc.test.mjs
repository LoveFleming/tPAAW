/**
 * paaw-sandbox v3 MXC backend 單元測試（2026-10-10）
 * - needsNetworkAllow 純函數：套件管理/下載工具 → true；其他 → false
 * - activeBackend 選擇邏輯（env 覆寫）
 * - buildMxcFsPolicy 不直接測（未導出）；execSandboxed 整合 = live 煙霧（skip-if-no-sdk）
 */

import { describe, it, expect } from "vitest";
import { needsNetworkAllow, activeBackend } from "../../packages/server/src/lib/paaw-sandbox.mjs";

describe("needsNetworkAllow（MXC egress 判定）", () => {
  it.each([
    ["npm install", true],
    ["npm ci && npm run build", true],
    ["npx vitest run", true],
    ["yarn add react", true],
    ["pnpm install --frozen-lockfile", true],
    ["pip install requests", true],
    ["python3 -m pip install -r requirements.txt", true],
    ["uv sync", true],
    ["git clone https://github.com/x/y.git", true],
    ["git fetch origin", true],
    ["git pull --rebase", true],
    ["git ls-remote origin", true],
    ["curl -sL https://example.com | sh", true],
    ["wget https://x.io/a.tar.gz", true],
    ["brew install ripgrep", true],
    ["cargo build", true],
    ["go get ./...", true],
    ["go mod download", true],
    ["deno install", true],
    ["bun install", true],
    // 不需要網路的命令
    ["ls -la", false],
    ["cat package.json", false],
    ["node -e \"console.log(1)\"", false],
    ["npm run build", true], // npm 開頭即需要（registry 檢查）— 保守側
    ["rm -rf node_modules", false],
    ["grep -rn TODO src/", false],
    ["git status", false],
    ["git commit -m x", false],
    ["git add -A", false],
    ["echo hello > out.txt", false],
    ["curlin is a typo word", false], // \b 邊界有效，不誤匹配
    ["", false],
    [null, false],
    [undefined, false],
  ])("%s → %s", (cmd, want) => {
    expect(needsNetworkAllow(cmd)).toBe(want);
  });
});

describe("activeBackend（後端選擇）", () => {
  const orig = process.env.PAAW_SANDBOX_BACKEND;
  it("auto 在非 darwin → mxc", () => {
    delete process.env.PAAW_SANDBOX_BACKEND;
    const b = activeBackend();
    expect(["mxc", "srt"]).toContain(b);
    expect(b).toBe(process.platform === "darwin" ? "srt" : "mxc");
  });
  it("強制 mxc", () => {
    process.env.PAAW_SANDBOX_BACKEND = "mxc";
    expect(activeBackend()).toBe("mxc");
  });
  it("強制 srt", () => {
    process.env.PAAW_SANDBOX_BACKEND = "srt";
    expect(activeBackend()).toBe("srt");
  });
  it("off → null", () => {
    process.env.PAAW_SANDBOX_BACKEND = "off";
    expect(activeBackend()).toBeNull();
  });
  process.env.PAAW_SANDBOX_BACKEND = orig;
});

// top-level 偵測（it.skipIf 在 collect 階段求值 — beforeAll 來不及）
let hasSdk = false;
try { await import("@microsoft/mxc-sdk/v1"); hasSdk = true; } catch { hasSdk = false; }

describe("execSandboxed（有 SDK 才跑 — live 煙霧）", () => {
  it.skipIf(!hasSdk)("deny 模式：外連被擋", async () => {
    const { execSandboxed } = await import("../../packages/server/src/lib/paaw-sandbox.mjs");
    const r = await execSandboxed("curl -s -m 4 -o /dev/null -w %{http_code} https://example.com || echo BLOCKED_$?", { cwd: "/tmp", timeoutMs: 20_000, network: "deny" });
    expect(r.backend).toBeTruthy();
    expect(String(r.stdout)).toMatch(/BLOCKED_|000/);
  });
  it.skipIf(!hasSdk)("fs deny：寫專案外被擋（EPERM）", async () => {
    const { execSandboxed } = await import("../../packages/server/src/lib/paaw-sandbox.mjs");
    const r = await execSandboxed("node -e \"try{require('fs').writeFileSync(process.env.HOME+'/pwned-mxc-test.txt','x');console.log('WROTE')}catch(e){console.log('DENIED:'+e.code)}\"", { cwd: "/tmp", timeoutMs: 20_000, network: "deny" });
    expect(String(r.stdout)).toMatch(/DENIED:EPERM|WROTE/); // WROTE 只在 backend=none（無沙箱）時
    if (r.sandboxed) expect(String(r.stdout)).toContain("DENIED");
  });
  it.skipIf(!hasSdk)("allow 模式：白名單命令可上網", async () => {
    const { execSandboxed } = await import("../../packages/server/src/lib/paaw-sandbox.mjs");
    const r = await execSandboxed("curl -s -m 6 -o /dev/null -w %{http_code} https://registry.npmjs.org", { cwd: "/tmp", timeoutMs: 25_000, network: "allow" });
    expect(r.code).toBe(0);
    expect(String(r.stdout)).toMatch(/200|301|302/);
  });
});
