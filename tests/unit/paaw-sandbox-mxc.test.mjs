/**
 * paaw-sandbox v3 MXC backend 單元測試（2026-10-10）
 * - needsNetworkAllow 純函數：套件管理/下載工具 → true；其他 → false
 * - activeBackend 選擇邏輯（env 覆寫）
 * - buildMxcFsPolicy 不直接測（未導出）；execSandboxed 整合 = live 煙霧（skip-if-no-sdk）
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { needsNetworkAllow, activeBackend, buildMxcFsPolicy, sandboxTempRoots } from "../../packages/server/src/lib/paaw-sandbox.mjs";

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
  afterEach(() => {
    // ⚠️ 原本寫在 describe body 尾端（collect 時就跑完 = 沒清到），導致後續 execSandboxed 測試
    // 拿到 PAAW_SANDBOX_BACKEND="off" → 沙箱整組關掉、live 煙霧測試變成驗 raw。
    if (orig === undefined) delete process.env.PAAW_SANDBOX_BACKEND;
    else process.env.PAAW_SANDBOX_BACKEND = orig;
  });
  it("auto → mxc（v4 單後端：macOS 也走 MXC）", () => {
    delete process.env.PAAW_SANDBOX_BACKEND;
    expect(activeBackend()).toBe("mxc");
  });
  it("強制 mxc", () => {
    process.env.PAAW_SANDBOX_BACKEND = "mxc";
    expect(activeBackend()).toBe("mxc");
  });
  it("舊值 srt 一律回 mxc（相容）", () => {
    process.env.PAAW_SANDBOX_BACKEND = "srt";
    expect(activeBackend()).toBe("mxc");
  });
  it("off → null", () => {
    process.env.PAAW_SANDBOX_BACKEND = "off";
    expect(activeBackend()).toBeNull();
  });
});

// 2026-10-13 公司 Linux 回歸：bwrap bind 來源不存在會硬錯（Can't find source path /private/tmp）
// → MXC fs policy 與 temp roots 只能放「本機真的存在」的路徑。
describe("buildMxcFsPolicy（跨平台路徑過濾）", () => {
  const cwd = "/tmp";
  const pol = buildMxcFsPolicy(cwd);
  it("所有 fs policy 路徑都存在（bwrap bind 來源必須存在）", () => {
    for (const p of [...pol.readonlyPaths, ...pol.readwritePaths]) {
      expect(existsSync(p), `不存在：${p}`).toBe(true);
    }
  });
  it("非 darwin 不得出現 macOS 專屬路徑（/private/*、/opt/homebrew）", () => {
    if (process.platform === "darwin") return;
    const all = [...pol.readonlyPaths, ...pol.readwritePaths, ...pol.deniedPaths];
    for (const p of all) {
      expect(p.startsWith("/private/"), `macOS 路徑外洩：${p}`).toBe(false);
      expect(p.startsWith("/opt/homebrew")).toBe(false);
      expect(p.includes("/Library/Caches")).toBe(false);
    }
  });
  it("RU cwd 一定在 readwritePaths（coding app 要能寫 packages）", () => {
    expect(pol.readwritePaths).toContain(cwd);
  });
  // 2026-10-13（公司 Linux 第二修）：readwrite 若被 readonly 祖先/自身蓋掉 → cwd 變 EROFS
  it("readonly 與 readwrite 絕不重疊（自身/祖先/子孫都不行）", () => {
    const home = os.homedir();
    for (const cwd of [home, "/tmp", join(home, ".npm")]) {
      const p = buildMxcFsPolicy(cwd);
      const ov = p.readonlyPaths.filter((r) =>
        p.readwritePaths.some((w) => r === w || r.startsWith(w + "/") || w.startsWith(r + "/")));
      expect(ov, `${cwd} 重疊：${ov.join(",")}`).toEqual([]);
    }
  });
  it("cwd 在 home 底下：home 不整包 ro（防蓋掉 cwd），cwd 本身不在 readonly", () => {
    const home = os.homedir();
    const p = buildMxcFsPolicy(home);
    expect(p.readonlyPaths).not.toContain(home);
    expect(p.readwritePaths).toContain(home);
  });

  it("sandboxTempRoots 全部存在，且非 darwin 不含 /private/tmp", () => {
    const roots = sandboxTempRoots();
    for (const p of roots) expect(existsSync(p), `不存在：${p}`).toBe(true);
    if (process.platform !== "darwin") expect(roots).not.toContain("/private/tmp");
  });
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

// 2026-10-13 bug #4 回歸守門：沙箱標記不得污染結構化工具輸出
describe("runShell 沙箱標記守門", () => {
  it("標記只在 opts.marker（bash tool）分支出現", async () => {
    const src = await readFile(new URL("../../packages/server/src/lib/paaw-agent-loop.mjs", import.meta.url), "utf8");
    assert.match(src, /opts\.marker \?/, "runShell 應有 opts.marker 守門");
    const hits = [...src.matchAll(/🛡沙箱[內内]（MXC）/g)];
    assert.ok(hits.length <= 2, `標記字串出現 ${hits.length} 次，疑似又加回到共用路徑`);
  });
});
