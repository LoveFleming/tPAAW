/**
 * feature-map-store.test.mjs — mergeFeatureMappings（2026-10-22 delta 制）
 *
 * 驗證：合併+寫檔、冪等、新功能自動登記、備份、不合法輸入跳過。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mergeFeatureMappings } from "../../packages/server/src/lib/feature-map-store.mjs";

let root = null;
const featDir = () => join(root, ".paaw", "features");

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fm-store-"));
  mkdirSync(join(root, ".paaw", "features"), { recursive: true });
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe("mergeFeatureMappings", () => {
  it("M1: 合併歸類並寫入兩個檔案；既有功能沿用 registry 名", async () => {
    writeFileSync(join(featDir(), "FEATURES.json"), JSON.stringify({
      features: [{ id: "F20261009-002", name: "維運平台", status: "active" }],
    }));
    const r = mergeFeatureMappings(root, [
      { file: "tests/unit/auth.test.mjs", featureId: "F20261009-002" },
      { file: "src/new-thing.mjs", featureId: "F20261022-001", featureName: "新功能" },
    ], "em");
    expect(r.merged).toBe(2);
    expect(r.newFeatures).toContain("F20261022-001");
    const ff = JSON.parse(readFileSync(join(featDir(), "FILE-FEATURES.json"), "utf-8"));
    expect(ff.files["tests/unit/auth.test.mjs"][0].name).toBe("維運平台"); // registry 名優先
    expect(ff.files["src/new-thing.mjs"][0].name).toBe("新功能");
    const reg = JSON.parse(readFileSync(join(featDir(), "FEATURES.json"), "utf-8"));
    expect(reg.features.some(f => f.id === "F20261022-001" && f.status === "active")).toBe(true);
    expect(r.backups.length).toBeGreaterThanOrEqual(1); // FEATURES.json 有舊檔 → 有備份
  });

  it("M2: 冪等 — 同檔同功能再跑不重複、merged=0", () => {
    const r = mergeFeatureMappings(root, [
      { file: "tests/unit/auth.test.mjs", featureId: "F20261009-002" },
    ]);
    expect(r.merged).toBe(0);
    const ff = JSON.parse(readFileSync(join(featDir(), "FILE-FEATURES.json"), "utf-8"));
    expect(ff.files["tests/unit/auth.test.mjs"]).toHaveLength(1);
  });

  it("M3: 一檔可屬多功能（append）", () => {
    mergeFeatureMappings(root, [{ file: "src/shared.mjs", featureId: "F20261009-002" }]);
    const r = mergeFeatureMappings(root, [{ file: "src/shared.mjs", featureId: "F20261022-001" }]);
    expect(r.merged).toBe(1);
    const ff = JSON.parse(readFileSync(join(featDir(), "FILE-FEATURES.json"), "utf-8"));
    expect(ff.files["src/shared.mjs"].map(x => x.id).sort()).toEqual(["F20261009-002", "F20261022-001"]);
  });

  it("M4: 不合法輸入跳過不寫檔 — 絕對路徑/..逃逸/壞 featureId", () => {
    const r = mergeFeatureMappings(root, [
      { file: "/etc/passwd", featureId: "F20261009-002" },
      { file: "../outside.mjs", featureId: "F20261009-002" },
      { file: "src/ok-but-bad-id.mjs", featureId: "F-001" },
      { file: "C:\\win\\abs.mjs", featureId: "F20261009-002" },
    ]);
    expect(r.merged).toBe(0);
    expect(r.skipped).toHaveLength(4);
    const ff = JSON.parse(readFileSync(join(featDir(), "FILE-FEATURES.json"), "utf-8"));
    expect(ff.files["src/ok-but-bad-id.mjs"]).toBeUndefined();
  });

  it("M5: 備份檔落在 .paaw/features/backups/", () => {
    mergeFeatureMappings(root, [{ file: "src/another.mjs", featureId: "F20261022-001" }]);
    const backupsDir = join(featDir(), "backups");
    expect(existsSync(backupsDir)).toBe(true);
    const ff = JSON.parse(readFileSync(join(featDir(), "FILE-FEATURES.json"), "utf-8"));
    expect(ff.updatedAt).toBeTruthy();
  });
});
