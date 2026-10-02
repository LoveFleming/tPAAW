import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import {
  takeDispatchSnapshot,
  verifyDispatchWork,
  dispatchRetrySuffix,
} from "../../packages/server/src/lib/dispatch-verifier.mjs";

// ── 真 git repo 沙箱：驗收邏輯吃 git 真實輸出，不 mock ──
let repo;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "paaw-dispatch-verify-"));
  const git = (cmd) => execSync(cmd, { cwd: repo, encoding: "utf-8" });
  git("git init -q");
  git("git config user.email t@t");
  git("git config user.name t");
  writeFileSync(join(repo, "seed.txt"), "seed");
  git("git add -A && git commit -qm seed");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("verifyDispatchWork — deterministic 假成功偵測", () => {
  it("零 commit 零 diff → fail（no-commit-no-diff）", async () => {
    const snap = await takeDispatchSnapshot(repo);
    const v = await verifyDispatchWork(repo, snap);
    expect(v.pass).toBe(false);
    expect(v.why).toBe("no-commit-no-diff");
  });

  it("新 commit → pass（new-commit）", async () => {
    const snap = await takeDispatchSnapshot(repo);
    writeFileSync(join(repo, "work.txt"), "done");
    execSync("git add -A && git commit -qm work", { cwd: repo });
    const v = await verifyDispatchWork(repo, snap);
    expect(v.pass).toBe(true);
    expect(v.why).toBe("new-commit");
  });

  it("runtime 噪音 diff（.paaw/chats、data/config）不算證據 → fail", async () => {
    const snap = await takeDispatchSnapshot(repo);
    execSync("mkdir -p .paaw/chats data/config", { cwd: repo });
    writeFileSync(join(repo, ".paaw/chats/s1.json"), "{}");
    writeFileSync(join(repo, "data/config/user.json"), "{}");
    const v = await verifyDispatchWork(repo, snap);
    expect(v.pass).toBe(false);
  });

  it("真實 working diff（程式檔）→ pass（working-diff）且列出檔案", async () => {
    const snap = await takeDispatchSnapshot(repo);
    execSync("git clean -qfd", { cwd: repo }); // 清掉上一輪噪音檔
    writeFileSync(join(repo, "src-feature.tsx"), "export const x = 1;");
    const v = await verifyDispatchWork(repo, snap);
    expect(v.pass).toBe(true);
    expect(v.why).toBe("working-diff");
    expect(v.files.some(f => f.includes("src-feature.tsx"))).toBe(true);
  });
});

describe("dispatchRetrySuffix — 退回 prompt", () => {
  it("帶原因與次數", () => {
    const s = dispatchRetrySuffix({ why: "no-commit-no-diff" }, 2);
    expect(s).toContain("第 2 次嘗試失敗");
    expect(s).toContain("no-commit-no-diff");
    expect(s).toContain("分塊");
  });

  it("無 verdict 時 fallback 文字不炸", () => {
    const s = dispatchRetrySuffix(undefined);
    expect(s).toContain("no-commit-no-diff");
  });
});
