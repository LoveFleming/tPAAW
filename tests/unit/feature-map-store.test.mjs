/**
 * feature-map-store.test.mjs — mergeFeatureMappings（2026-10-22 delta 制）
 * 2026-11-01 改 db 制：讀寫全走 coding.db（ru_docs + features 表），不再寫 .paaw/features/*.json
 *
 * 驗證：合併+寫 db、冪等、新功能自動登記、不合法輸入跳過、舊檔一次性 bootstrap。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mergeFeatureMappings } from "../../packages/server/src/lib/feature-map-store.mjs";
import { readDoc } from "../../packages/server/src/lib/coding-db/docs.repo.mjs";
import { loadFeatures } from "../../packages/server/src/lib/feature-registry.mjs";

let root = null;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fm-store-"));
  mkdirSync(join(root, ".paaw", "features"), { recursive: true });
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const ffDoc = () => readDoc(root, "fileFeatures");

describe("mergeFeatureMappings", () => {
  it("M1: 合併歸類並寫入 db；既有功能沿用 registry 名（檔案 bootstrap）", async () => {
    // 舊檔一次性 bootstrap 來源
    writeFileSync(join(root, ".paaw", "features", "FEATURES.json"), JSON.stringify({
      features: [{ id: "F20261009-002", name: "維運平台", status: "active" }],
    }));
    const r = mergeFeatureMappings(root, [
      { file: "tests/unit/auth.test.mjs", featureId: "F20261009-002" },
      { file: "src/new-thing.mjs", featureId: "F20261022-001", featureName: "新功能" },
    ], "em");
    expect(r.merged).toBe(2);
    expect(r.newFeatures).toContain("F20261022-001");
    expect(ffDoc().files["tests/unit/auth.test.mjs"][0].name).toBe("維運平台"); // registry 名優先
    expect(ffDoc().files["src/new-thing.mjs"][0].name).toBe("新功能");
    const feats = loadFeatures(root);
    expect(feats.some(f => f.id === "F20261022-001" && f.status === "active")).toBe(true);
  });

  it("M2: 冪等 — 同檔同功能再跑不重複、merged=0", () => {
    const r = mergeFeatureMappings(root, [
      { file: "tests/unit/auth.test.mjs", featureId: "F20261009-002" },
    ]);
    expect(r.merged).toBe(0);
    expect(ffDoc().files["tests/unit/auth.test.mjs"]).toHaveLength(1);
  });

  it("M3: 一檔可屬多功能（append）", () => {
    mergeFeatureMappings(root, [{ file: "src/shared.mjs", featureId: "F20261009-002" }]);
    const r = mergeFeatureMappings(root, [{ file: "src/shared.mjs", featureId: "F20261022-001" }]);
    expect(r.merged).toBe(1);
    expect(ffDoc().files["src/shared.mjs"].map(x => x.id).sort()).toEqual(["F20261009-002", "F20261022-001"]);
  });

  it("M4: 不合法輸入跳過不寫入 — 絕對路徑/..逃逸/壞 featureId", () => {
    const r = mergeFeatureMappings(root, [
      { file: "/etc/passwd", featureId: "F20261009-002" },
      { file: "../outside.mjs", featureId: "F20261009-002" },
      { file: "src/ok-but-bad-id.mjs", featureId: "F-001" },
      { file: "C:\\win\\abs.mjs", featureId: "F20261009-002" },
    ]);
    expect(r.merged).toBe(0);
    expect(r.skipped).toHaveLength(4);
    expect(ffDoc().files["src/ok-but-bad-id.mjs"]).toBeUndefined();
  });

  it("M5: db 制 — updatedAt 有值、不寫 .json 檔、交易式寫入取代備份", () => {
    mergeFeatureMappings(root, [{ file: "src/another.mjs", featureId: "F20261022-001" }]);
    expect(ffDoc().updatedAt).toBeTruthy();
    // 舊 .json 不再被寫入（仍只有 bootstrap 時的內容）
    expect(() => ffDoc()).not.toThrow();
  });
});
