// 🛠 開發模式總開關（2026-10-13）— 關沙箱 + 關安全審批，趕碼用；有空再開回來測
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FILE = join(process.cwd(), "data/config/security.json");
const hadFile = existsSync(FILE);
const backup = hadFile ? readFileSync(FILE, "utf-8") : null;

const sm = await import("../../packages/server/src/lib/security-mode.mjs");
const sb = await import("../../packages/server/src/lib/paaw-sandbox.mjs");

function restore() {
  if (backup !== null) writeFileSync(FILE, backup);
  else if (existsSync(FILE)) rmSync(FILE, { force: true });
}
afterAll(restore);

beforeEach(() => { delete process.env.PAAW_DEV_MODE; delete process.env.PAAW_SANDBOX; });

describe("security-mode", () => {
  it("預設（沒設定檔）= 關閉，安全全開", () => {
    if (existsSync(FILE)) rmSync(FILE, { force: true });
    expect(sm.devModeOn()).toBe(false);
    expect(sb.sandboxKillSwitchOn()).toBe(false);
    expect(sb.activeBackend()).toBe("mxc");
  });

  it("setDevMode(true) → devModeOn 且沙箱整個關掉（activeBackend=null、mxcAvailable=false）", async () => {
    sm.setDevMode(true);
    expect(sm.devModeOn()).toBe(true);
    expect(sb.sandboxKillSwitchOn()).toBe(true);
    expect(sb.activeBackend()).toBeNull();
    await expect(sb.mxcAvailable()).resolves.toBe(false);
    // 檔案有落 + 有時間戳（可事後查什麼時候開的）
    const j = JSON.parse(readFileSync(FILE, "utf-8"));
    expect(j.devMode).toBe(true);
    expect(typeof j.updatedAt).toBe("string");
  });

  it("setDevMode(false) → 恢復（沙箱回來）", () => {
    sm.setDevMode(true);
    sm.setDevMode(false);
    expect(sm.devModeOn()).toBe(false);
    expect(sb.activeBackend()).toBe("mxc");
  });

  it("壞掉的 JSON → 視為關閉（fail-safe：壞檔不可等於關防護）", () => {
    writeFileSync(FILE, "{ this is not json");
    expect(sm.devModeOn()).toBe(false);
  });

  it("環境變數覆寫優先於檔案：PAAW_DEV_MODE=on / off", () => {
    sm.setDevMode(false);
    process.env.PAAW_DEV_MODE = "on";
    expect(sm.devModeOn()).toBe(true);
    sm.setDevMode(true);
    process.env.PAAW_DEV_MODE = "off";
    expect(sm.devModeOn()).toBe(false);
    delete process.env.PAAW_DEV_MODE;
  });

  it("PAAW_SANDBOX=off 仍是獨立逃生口（即使 devMode 關）", () => {
    sm.setDevMode(false);
    process.env.PAAW_SANDBOX = "off";
    expect(sb.sandboxKillSwitchOn()).toBe(true);
    expect(sb.activeBackend()).toBeNull();
  });
});
