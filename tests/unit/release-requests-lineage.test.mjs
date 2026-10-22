/**
 * release-requests-lineage.test.mjs — RR lineage 制（2026-10-22 Task A/B）測試
 *
 * 源起：tpaaw-gateway 0.2.2 release 卡四天（RR-20261018-1738-6f2e）。
 *   - 修復 30 commits 落地但 target 凍結 → 證據與靶心脫鉤
 *   - v0.2.1 舊 QA fail（qr-20261011）永久污染 qa-records auto=fail
 *
 * 本檔用真臨時 git repo 驗證：
 *   A1. refresh：HEAD 是 target 後代 → target 自動前進 + suggested 作廢
 *   A2. refresh：HEAD 非 target 後代（分岔）→ 不前進，history 記 blocked
 *   A3. refresh：targetLocked → 不前進，history 記 skipped
 *   A4. suggestVerdicts：建議前自動刷新（對新樹建議，不對凍結靶心）
 *   A5. setTargetLock：冪等 + history
 *   B1. qa-records：headSha 在 baseline..target 內的 open fail → fail（計入）
 *   B2. qa-records：無 headSha 舊記錄 → 隔離（warn，不 fail）
 *   B3. qa-records：headSha 樹外（舊 release 樹）→ 隔離（warn，不 fail）
 *   B4. qa-records：TTL — 落後 ≥2 個 release → expired（不計入）
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import {
  createReleaseRequest, refreshReleaseRequest, suggestVerdicts, setTargetLock,
  getReleaseRequest,
} from "@server/lib/release-requests.mjs";
import { saveQaResult, updateQaResult } from "@server/lib/qa-results.mjs";

let root = "";

function git(args) {
  execSync(`git ${args}`, { cwd: root, timeout: 15000 });
}
function commitFile(name, content = "x") {
  writeFileSync(join(root, name), content + "\n");
  git(`add -A`);
  git(`commit -m "commit ${name}" --no-gpg-sign`);
}
function head() {
  return execSync("git rev-parse HEAD", { cwd: root, timeout: 10000 }).toString().trim();
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "rr-lineage-"));
  git("init -q -b main");
  git('config user.email "t@t"');
  git('config user.name "T"');
  // 隔離 RU runtime 檔（RR/QA json 會被 refresh 改寫；進 git 會擋分支切換、污染 fixture）
  writeFileSync(join(root, ".gitignore"), ".paaw/\n");
  commitFile("a.txt", "init");
  mkdirSync(join(root, ".paaw"), { recursive: true });
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("Task A — RR target lineage 自動前進", () => {
  it("A1: HEAD 是 target 後代 → refresh 自動前進 + suggested 作廢", async () => {
    const rr = await createReleaseRequest(root, { title: "lineage-test", baseline: "auto" });
    expect(rr.status).toBe("draft");
    const t0 = rr.target.sha;

    // 先建議（舊樹）→ 落新 commit → refresh → target 前進 + 建議作廢
    await suggestVerdicts(root, rr.id, [{ itemId: "tests", verdict: "pass", reason: "舊樹建議" }], "rm-agent");
    const afterSuggest = await getReleaseRequest(root, rr.id);
    expect(afterSuggest.suggested?.tests?.verdict).toBe("pass");

    commitFile("fix.txt", "fix");
    const h = head();
    expect(h).not.toBe(t0);

    const refreshed = await refreshReleaseRequest(root, rr.id);
    expect(refreshed.target.sha).toBe(h);
    expect(refreshed.suggested).toBeFalsy(); // 舊建議作廢
    const ev = refreshed.history.filter(x => x.event === "target-advanced").pop();
    expect(ev?.note).toContain("lineage 自動前進");
  });

  it("A2: 分岔（非 target 後代）→ 不前進，history 記 blocked", async () => {
    const rr = await getReleaseRequest(root, await currentRrId());
    const t = rr.target.sha;

    // orphan 分支與原線無 ancestry — refresh 時 HEAD 停在 fork 上
    git("checkout -q --orphan fork");
    execSync('git rm -rq --cached . || true', { cwd: root });
    writeFileSync(join(root, "fork.txt"), "fork\n");
    git("add -A");
    git('commit -m "fork commit" --no-gpg-sign');
    const forkHead = head();
    expect(forkHead).not.toBe(t);

    // 還在 fork 上刷新 → 非後代 → 擋下
    const refreshed = await refreshReleaseRequest(root, rr.id);
    expect(refreshed.target.sha).toBe(t);
    const ev = refreshed.history.filter(x => x.event === "target-advance-blocked").pop();
    expect(ev).toBeTruthy();
    expect(ev.note).toContain("不是");

    // 回主線，順手驗「同 head 不重複記」
    const again = await refreshReleaseRequest(root, rr.id);
    expect(again.history.filter(x => x.event === "target-advance-blocked").length)
      .toBe(refreshed.history.filter(x => x.event === "target-advance-blocked").length);
    git("checkout -q main");
    git("branch -q -D fork");
  });

  it("A3: targetLocked → refresh 不前進", async () => {
    const id = await currentRrId();
    const rr = await getReleaseRequest(root, id);
    const t = rr.target.sha;
    commitFile("more.txt", "more"); // main 線新 commit（是後代）
    const h = head();

    await setTargetLock(root, id, true);
    const locked = await refreshReleaseRequest(root, id);
    expect(locked.targetLocked).toBe(true);
    expect(locked.target.sha).toBe(t); // 鎖定 → 不前進（即使 HEAD 是後代）
    const ev = locked.history.filter(x => x.event === "target-advance-skipped").pop();
    expect(ev).toBeTruthy();

    // 解鎖後 refresh → 前進
    await setTargetLock(root, id, false);
    const unlocked = await refreshReleaseRequest(root, id);
    expect(unlocked.target.sha).toBe(h);
  });

  it("A4: suggestVerdicts 先刷新 — 建議永遠對最新樹", async () => {
    const id = await currentRrId();
    commitFile("late.txt", "late");
    const h = head();
    await suggestVerdicts(root, id, [{ itemId: "tests", verdict: "pass", reason: "對新樹建議" }], "rm-agent");
    const rr = await getReleaseRequest(root, id);
    expect(rr.target.sha).toBe(h); // suggest 順手把 target 帶到 HEAD
    expect(rr.suggested?.tests?.verdict).toBe("pass");
  });

  it("A5: setTargetLock 冪等", async () => {
    const id = await currentRrId();
    const once = await setTargetLock(root, id, true);
    const twice = await setTargetLock(root, id, true);
    expect(twice.targetLocked).toBe(true);
    const locks = twice.history.filter(x => x.event === "target-locked");
    expect(locks.length).toBe(once.history.filter(x => x.event === "target-locked").length); // 不重複記
    await setTargetLock(root, id, false);
  });
});

describe("Task B — qa-records scope 綁定 + 隔離", () => {
  // 共用：目前 RR（main 線，target=HEAD）
  async function qaAuto() {
    const id = await currentRrId();
    const rr = await refreshReleaseRequest(root, id);
    return { id, rr, qa: rr.checklist.find(c => c.id === "qa-records").auto };
  }

  it("B1: headSha 在 scope 內的 open fail → 計入（fail）", async () => {
    const { rr } = await qaAuto();
    const rec = saveQaResult(root, {
      verdict: "fail", target: "in-scope fail", summary: "scope 內失敗",
      headSha: rr.target.sha, // 測試樹 = target → 在 (baseline, target] 內
    });
    const { qa } = await qaAuto();
    expect(qa.status).toBe("fail");
    expect(qa.detail).toContain(rec.id);
    updateQaResult(root, rec.id, { status: "resolved" }, "test");
  });

  it("B2: 無 headSha 舊記錄 → 隔離不 fail（warn）", async () => {
    const rec = saveQaResult(root, { verdict: "fail", target: "legacy fail（無綁樹）", summary: "舊格式" });
    const { qa } = await qaAuto();
    expect(qa.status).not.toBe("fail"); // 隔離 → 不擋
    expect(qa.detail).toContain(rec.id); // 但看得到（不靜默消失）
    expect(qa.detail).toContain("未綁樹");
    updateQaResult(root, rec.id, { status: "resolved" }, "test");
  });

  it("B3: headSha 樹外（舊 release 樹）→ 隔離不 fail", async () => {
    // 造一棵「舊樹」：baseline 本身（=== baseline 不在 (baseline, target] 內）
    const { rr } = await qaAuto();
    const rec = saveQaResult(root, {
      verdict: "fail", target: "old-tree fail", summary: "測於舊 release 樹",
      headSha: rr.baseline.sha,
    });
    const { qa } = await qaAuto();
    expect(qa.status).not.toBe("fail");
    expect(qa.detail).toContain("樹外");
    updateQaResult(root, rec.id, { status: "resolved" }, "test");
  });

  it("B4: TTL — 落後 ≥2 個 release → expired 不計入", async () => {
    // 兩個 release 的 releasedAt 都晚於 QR ts？不行 — QR 是現在建立的。
    // 反向造：QR 綁現在樹，但補兩張「未來 releasedAt」的 REL（模擬兩個 release 已過）→ TTL expired。
    const { rr } = await qaAuto();
    const rec = saveQaResult(root, {
      verdict: "fail", target: "ttl fail", summary: "應被 TTL 隔離",
      headSha: rr.target.sha, // 即使樹在 scope 內
    });
    const relDir = join(root, ".paaw", "releases");
    mkdirSync(relDir, { recursive: true });
    const future = new Date(Date.now() + 86400e3).toISOString();
    writeFileSync(join(relDir, "REL-TEST-1.json"), JSON.stringify({ id: "REL-TEST-1", releasedAt: future }));
    writeFileSync(join(relDir, "REL-TEST-2.json"), JSON.stringify({ id: "REL-TEST-2", releasedAt: future }));

    const { qa } = await qaAuto();
    expect(qa.status).not.toBe("fail");
    expect(qa.detail).toContain("TTL expired");

    updateQaResult(root, rec.id, { status: "resolved" }, "test");
  });
});

// ── helper：拿到本測試群建立的 RR id（list 第一張 draft）──
async function currentRrId() {
  const { listReleaseRequests } = await import("@server/lib/release-requests.mjs");
  const list = await listReleaseRequests(root);
  const open = list.find(r => r.status === "draft" || r.status === "reviewing");
  if (!open) throw new Error("no open RR in test fixture");
  return open.id;
}
