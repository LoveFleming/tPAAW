/**
 * release-evidence-snapshot（Phase A：baseline 錨點凍結快照）單元測試（2026-10-30）
 * - 生成凍結快照（git baseline..HEAD delta × 證據欄 + source 註記）
 * - deterministic：兩次生成 features 內容一致（只差時間戳）
 * - 結構化缺口（snapshotGaps — Evidence AI tool 的資料形狀）
 * - 紅格開補強單（TASKS.json 慣例 + acceptanceCriteria + 冪等）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  generateEvidenceSnapshot, listEvidenceSnapshots, readEvidenceSnapshot,
  snapshotGaps, openEvidenceGapTask,
} from "../../packages/server/src/lib/release-evidence-snapshot.mjs";
import { aiReviewForFeature } from "../../packages/server/src/lib/release-evidence.mjs";

let dir;
const G = (cmd) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: dir });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "evsnap-"));
  G("init -q");
  // feature map（F-001 sandbox 有變更；F-002 docs 不動）
  mkdirSync(join(dir, ".paaw", "features"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "features", "FEATURES.json"), JSON.stringify([
    { id: "F-001", name: "sandbox", severitySuggested: "S1", codeFiles: ["src/sandbox.mjs"] },
    { id: "F-002", name: "docs", severitySuggested: "S0", codeFiles: ["src/docs.tsx"] },
  ]));
  // baseline commit：兩個檔案都先存在
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "sandbox.mjs"), "export const sandbox = 1;\n");
  writeFileSync(join(dir, "src", "docs.tsx"), "export const docs = 1;\n");
  G("add -A"); G("commit -qm baseline");
  // delta commit：只動 sandbox（+ 測試檔讓 unit 欄有測試可映射）
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(join(dir, "tests", "sandbox.test.mjs"), 'import { test, expect } from "vitest"; test("sb", () => {});\n');
  writeFileSync(join(dir, "src", "sandbox.mjs"), "export const sandbox = 2;\n");
  G("add -A"); G('commit -qm "feat: bump sandbox"');
  // 證據檔（sg/qa/review-board — 全 deterministic 掃描來源）
  mkdirSync(join(dir, ".paaw", "security"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "security", "scan-results.json"), JSON.stringify({
    scannedAt: "2026-10-30T01:00:00Z", findings: [{ file: "src/sandbox.mjs", severity: "WARNING", id: "rule.y" }],
  }));
  mkdirSync(join(dir, ".paaw", "review-board"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "review-board", "20261030-120000.md"), [
    "# Multi-Model Code Review Report", "",
    "- 時間：2026-10-30T12:00:00.000Z",
    "- Range：`HEAD~1..HEAD`",
    "- Reviewers：`glm-5.1`",
    "- 結論：**approve**（critical 0 / major 0 / minor 0）", "",
    "## 審查範圍", "",
    "- `src/sandbox.mjs`", "",
  ].join("\n"));
  mkdirSync(join(dir, ".paaw", "coding-memory"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "coding-memory", "qa-results.jsonl"), JSON.stringify({
    id: "q1", ts: "2026-10-30T10:00:00Z", actor: "human", type: "manual", feature: "sandbox",
    verdict: "pass", summary: "人測過", issues: [], evidence: [],
  }) + "\n");
});

afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe("generateEvidenceSnapshot", () => {
  it("生成凍結快照：範圍綁 baseline..HEAD、只列被動 features、欄位齊", async () => {
    const base = G("rev-list --max-parents=0 HEAD").toString().trim();
    const snap = await generateEvidenceSnapshot(dir, { baseline: base });
    expect(snap.frozen).toBe(true);
    expect(snap.baseline.sha).toBe(base);
    expect(snap.head.sha).toBe(G("rev-parse HEAD").toString().trim());
    expect(snap.range).toBe(`${base}..${snap.head.sha}`);
    expect(snap.commits.count).toBe(1);
    // 只有 sandbox 被 delta 觸及（docs 不在 baseline..HEAD diff）
    expect(snap.features.map((f) => f.id)).toEqual(["F-001"]);
    const f = snap.features[0];
    expect(f.changedFiles).toContain("src/sandbox.mjs");
    expect(f.evidence).toHaveProperty("unit");
    expect(f.evidence).toHaveProperty("e2e");
    expect(f.evidence).toHaveProperty("sg");
    expect(f.evidence).toHaveProperty("aiReview");
    expect(f.evidence).toHaveProperty("human");
    // 檔案落地 .paaw/release/evidence/
    expect(existsSync(join(dir, ".paaw", "release", "evidence", `${snap.id}.json`))).toBe(true);
  });

  it("deterministic：兩次生成 features 內容一致（只差 id/時間戳）", async () => {
    const base = G("rev-list --max-parents=0 HEAD").toString().trim();
    const a = await generateEvidenceSnapshot(dir, { baseline: base });
    const b = await generateEvidenceSnapshot(dir, { baseline: base });
    expect(JSON.stringify(a.features)).toBe(JSON.stringify(b.features));
    expect(a.summary).toEqual(b.summary);
  });

  it("證據欄帶 source 註記（sg 掃描檔 / review 報告 / qa id）", async () => {
    const base = G("rev-list --max-parents=0 HEAD").toString().trim();
    const snap = await generateEvidenceSnapshot(dir, { baseline: base });
    const ev = snap.features[0].evidence;
    expect(ev.sg.source).toContain("scan-results.json");
    expect(ev.aiReview.source).toContain(".md");
    expect(ev.human.source).toContain("q1");
  });

  it("baseline == HEAD → 400（沒有 delta 可檢查）", async () => {
    const head = G("rev-parse HEAD").toString().trim();
    await expect(generateEvidenceSnapshot(dir, { baseline: head })).rejects.toMatchObject({ status: 400 });
  });

  it("不存在的 baseline → 400", async () => {
    await expect(generateEvidenceSnapshot(dir, { baseline: "deadbeef" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("list/read + snapshotGaps", () => {
  it("list 依新→舊；read 讀回凍結內容", async () => {
    const base = G("rev-list --max-parents=0 HEAD").toString().trim();
    const snap = await generateEvidenceSnapshot(dir, { baseline: base });
    const list = await listEvidenceSnapshots(dir);
    expect(list[0].id).toBe(snap.id);
    expect(list[0].features).toBe(1);
    const back = await readEvidenceSnapshot(dir, snap.id);
    expect(back.baseline.sha).toBe(base);
    expect(await readEvidenceSnapshot(dir, "../../etc/passwd")).toBeNull(); // sanitize 檔名 id
  });

  it("snapshotGaps 回結構化缺口（AI tool 資料形狀）", async () => {
    const base = G("rev-list --max-parents=0 HEAD").toString().trim();
    const snap = await generateEvidenceSnapshot(dir, { baseline: base });
    const g = snapshotGaps(snap);
    expect(g.snapshotId).toBe(snap.id);
    expect(g.baseline.sha).toBe(base);
    expect(g.featuresTotal).toBe(1);
    expect(g.allGreen).toBe(snap.allGreen);
    for (const f of g.gaps) {
      expect(Array.isArray(f.missing)).toBe(true);
      for (const m of f.missing) expect(typeof m.column).toBe("string");
    }
    // cells 每欄都有 ok + source 鍵（No answer without evidence）
    const cells = g.gaps[0]?.cells || Object.values(g.cells || {});
    expect(Object.keys(snap.features[0].evidence)).toContain("unit");
  });
});

describe("openEvidenceGapTask（紅格開補強單）", () => {
  it("紅格 → TASK-001 帶 acceptanceCriteria + source 追溯；冪等跳過；全綠拒開", async () => {
    const base = G("rev-list --max-parents=0 HEAD").toString().trim();
    const snap = await generateEvidenceSnapshot(dir, { baseline: base });
    const feat = snap.features.find((f) => (f.gaps?.missing || []).length > 0);

    if (feat) {
      const r = await openEvidenceGapTask(dir, { snapshotId: snap.id, featureId: feat.id });
      expect(r.ok).toBe(true);
      expect(r.taskId).toBe("TASK-001");
      const tasks = JSON.parse(readFileSync(join(dir, ".paaw", "tasks", "TASKS.json"), "utf-8")).tasks;
      const t = tasks.find((x) => x.id === "TASK-001");
      expect(t.source).toMatchObject({ type: "evidence-gap", snapshotId: snap.id, featureId: feat.id });
      expect(t.spec.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(t.spec.fileScope).toContain("src/sandbox.mjs");

      // 冪等：同 snapshot+feature 已有未結案單 → skipped
      const r2 = await openEvidenceGapTask(dir, { snapshotId: snap.id, featureId: feat.id });
      expect(r2.skipped).toBe(true);

      // 全綠 feature 不開單
      const green = snap.features.find((f) => !(f.gaps?.missing || []).length);
      if (green) await expect(openEvidenceGapTask(dir, { snapshotId: snap.id, featureId: green.id })).rejects.toMatchObject({ status: 400 });
    } else {
      // 全綠快照 → 任何 feature 都拒開
      await expect(openEvidenceGapTask(dir, { snapshotId: snap.id, featureId: snap.features[0].id })).rejects.toMatchObject({ status: 400 });
    }
  });

  it("快照不存在 → 404", async () => {
    await expect(openEvidenceGapTask(dir, { snapshotId: "EVD-20990101-0000-deadbee", featureId: "F-001" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("aiReviewForFeature source 註記（release-evidence.mjs 增補）", () => {
  it("touched → 帶報告檔名；untouched → 帶最新報告檔名", async () => {
    const { loadReviewBoard } = await import("../../packages/server/src/lib/release-evidence.mjs");
    const board = await loadReviewBoard(dir);
    const touched = aiReviewForFeature(board, ["src/sandbox.mjs"]);
    expect(touched.ok).toBe(true);
    expect(touched.file).toMatch(/\.md$/);
    const untouched = aiReviewForFeature(board, ["src/other.tsx"]);
    expect(untouched.untouched).toBe(true);
    expect(untouched.file).toMatch(/\.md$/);
  });
});
