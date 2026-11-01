/**
 * release-requests-delta.test.mjs — delta 制兩個檢查項（2026-10-22；2026-11-01 API-first 改版）
 *
 * api-map：delta 檔案都要對到 API（未歸類 → fail；歸類後 refresh 自動轉綠）
 * qa-delta：每個 impacted API 要有「本 release 樹上」的 QA pass 證據（缺 → warn；樹外不算覆蓋）
 *
 * 真 git repo fixture（同 release-requests-lineage.test.mjs 哲學：git 事實用真 git 驗）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { execSync } from "child_process";
import {
  createReleaseRequest,
  refreshReleaseRequest,
  getReleaseRequest,
} from "../../packages/server/src/lib/release-requests.mjs";
import { saveQaResult } from "../../packages/server/src/lib/qa-results.mjs";

let root = null;
const git = (a) => execSync(`git ${a}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
const head = () => execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
const commitFile = (n, msg = "c") => {
  mkdirSync(dirname(join(root, n)), { recursive: true });
  writeFileSync(join(root, n), `content-${Date.now()}\n`);
  git("add -A"); git(`commit -m "${msg}" --no-gpg-sign`);
};
const item = (rr, id) => rr.checklist.find(c => c.id === id);
let rrId = null;

async function writeFeatureMap(filesMap) {
  // 2026-11-01 API-first：歸類記錄 = coding.db api_features + fileApiMap（feature map / RU model 退役）
  const { saveApiFeatures } = await import("../../packages/server/src/lib/coding-db/api-features.repo.mjs");
  const { writeDoc } = await import("../../packages/server/src/lib/coding-db/docs.repo.mjs");
  const apis = {};
  const files = {};
  for (const [file, list] of Object.entries(filesMap)) {
    files[file] = list.map(f => ({ id: f.id, entry: f.entry, name: f.name }));
    for (const f of list) {
      apis[f.id] = apis[f.id] || { id: f.id, category: "測試域", entry: f.entry, name: f.name, codeFiles: [], tests: [], processFlow: [] };
      apis[f.id].codeFiles.push(file);
    }
  }
  saveApiFeatures(root, Object.values(apis));
  writeDoc(root, "fileApiMap", { files });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "rr-delta-"));
  git("init -q -b main");
  git('config user.email "t@t"'); git('config user.name "T"');
  writeFileSync(join(root, ".gitignore"), ".paaw/\n");
  commitFile("a.txt", "init");
  mkdirSync(join(root, ".paaw"), { recursive: true });
  const rr = await createReleaseRequest(root, { title: "delta fixture" });
  rrId = rr.id;
});

afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe("api-map — delta 檔案歸類", () => {
  it("D1: 動到的檔案已歸類 → pass", async () => {
    await writeFeatureMap({ "src/feat1.mjs": [{ id: "A20261101-001", entry: "GET /api/feat1", name: "功能一" }] });
    commitFile("src/feat1.mjs", "feat1");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/feat1.mjs"), "v2\n"); git("add -A"); git('commit -m "feat1b" --no-gpg-sign');
    const rr = await refreshReleaseRequest(root, rrId);
    const fm = item(rr, "api-map");
    expect(fm).toBeTruthy();
    expect(fm.auto.status).toBe("pass");
    expect(fm.auto.detail).toContain("歸類完成");
  });

  it("D2: 未歸類檔案 → fail 且列出；.paaw/ 與 lock 檔不要求", async () => {
    mkdirSync(join(root, "src"), { recursive: true });
    commitFile("src/orphan.mjs", "orphan");
    writeFileSync(join(root, "package-lock.json"), "{}\n"); git("add -A"); git('commit -m "lock" --no-gpg-sign');
    const rr = await refreshReleaseRequest(root, rrId);
    const fm = item(rr, "api-map");
    expect(fm.auto.status).toBe("fail");
    expect(fm.auto.detail).toContain("src/orphan.mjs");
    expect(fm.auto.unmapped).toContain("src/orphan.mjs");
    // .paaw/ 與 lock 檔不要求歸類（unmapped 清單不含它們；detail 的修復指引本來就會提 .paaw/features 路徑）
    expect(fm.auto.unmapped.some(f => f.startsWith(".paaw/") || f.endsWith("package-lock.json"))).toBe(false);
  });

  it("D3: 歸類後 refresh 自動轉綠（衛生修復不需人為介入）", async () => {
    await writeFeatureMap({
      "src/feat1.mjs": [{ id: "A20261101-001", entry: "GET /api/feat1", name: "功能一" }],
      "src/orphan.mjs": [{ id: "A20261101-001", entry: "GET /api/feat1", name: "功能一" }],
    });
    const rr = await refreshReleaseRequest(root, rrId);
    expect(item(rr, "api-map").auto.status).toBe("pass");
  });
});

describe("qa-delta — delta APIs 的 QA 覆蓋", () => {
  it("D4: feature 在 delta 但無本版樹上的 QA pass → warn 列出", async () => {
    const rr = await refreshReleaseRequest(root, rrId);
    const qd = item(rr, "qa-delta");
    expect(qd).toBeTruthy();
    expect(qd.auto.status).toBe("warn");
    expect(qd.auto.detail).toContain("A20261101-001");
  });

  it("D5: 樹上 pass 記錄（open 也算 — 證明測過）→ pass；feature 欄填「純名稱」也對得上（Evidence Matrix 同 join 法）", async () => {
    await saveQaResult(root, {
      feature: "功能一",  // 純名稱 join（name 對得上即可 — Evidence Matrix 同 join 法）
      verdict: "pass", summary: "delta 覆蓋", type: "manual",
      headSha: head(),
    });
    const rr = await refreshReleaseRequest(root, rrId);
    const qd = item(rr, "qa-delta");
    expect(qd.auto.status).toBe("pass");
    expect(qd.auto.detail).toContain("覆蓋完整");
  });

  it("D6: 樹外（baseline 樹）的 pass 不算覆蓋 → 回到 warn", async () => {
    const rr0 = await getReleaseRequest(root, rrId);
    await saveQaResult(root, {
      feature: "A20261101-001", verdict: "pass", summary: "舊樹", type: "manual",
      headSha: rr0.baseline.sha,
    });
    // 刪掉 D5 那筆（HEAD 樹）記錄 — 只剩 baseline 樹上的 pass，不構成覆蓋
    const { deleteQaResult } = await import("../../packages/server/src/lib/qa-results.mjs");
    const lines = readFileSync(join(root, ".paaw/coding-memory/qa-results.jsonl"), "utf-8").trim().split("\n");
    const headTreeId = lines.map(l => JSON.parse(l)).find(r => r.headSha && r.headSha !== rr0.baseline.sha).id;
    expect(headTreeId).toBeTruthy();
    deleteQaResult(root, headTreeId);
    const rr2 = await refreshReleaseRequest(root, rrId);
    const qd = item(rr2, "qa-delta");
    expect(qd.auto.status).toBe("warn");
    expect(qd.auto.missing?.some?.(x => String(x.id || x).includes("A20261101-001")) ?? String(qd.auto.missing).includes("A20261101-001")).toBe(true);
  });
});
