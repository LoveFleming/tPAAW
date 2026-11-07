/**
 * shell-exec 跨平台 shell 挑選測試（2026-10-13）
 * 背景：公司 Linux 沙箱/dev-server 舊碼 fallback "/bin/zsh" → Linux 多半沒 zsh，
 * server 由 launchd/systemd/pm2 啟動時 $SHELL 常為空 → spawn ENOENT，整條掛掉。
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { posixShellBin, getShell, IS_WIN } from "../../packages/server/src/lib/shell-exec.mjs";

describe("posixShellBin / getShell（跨平台 shell）", () => {
  it("回傳的 shell 一定存在（或合理的 /bin/sh 後備）", () => {
    const bin = posixShellBin();
    expect(typeof bin).toBe("string");
    expect(bin.length).toBeGreaterThan(0);
    expect(existsSync(bin), `不存在：${bin}`).toBe(true);
  });

  it("getShell 與 posixShellBin 一致（POSIX）", () => {
    const s = getShell();
    if (IS_WIN) expect(s.bin).toBe(process.env.ComSpec || "cmd.exe");
    else expect(s.bin).toBe(posixShellBin());
  });

  it("非 Windows：絕不回傳不存在的路徑", () => {
    if (IS_WIN) return;
    expect(existsSync(posixShellBin())).toBe(true);
  });
});
