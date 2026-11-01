/**
 * C3: computeUtilityConsumers — Utility 證據模型（Phase C 2026-11-01）
 * consumers = import graph 反向：誰 import 進 Utility 的檔案。零 token、全程式判定。
 */
import { describe, it, expect } from "vitest";
import { computeUtilityConsumers } from "../../packages/server/src/lib/crosscut-concepts.mjs";

const features = [
  { id: "F-API", name: "API 功能", kind: "api", codeFiles: ["src/routes/api.mjs"] },
  { id: "F-UI", name: "UI 功能", kind: "ui", codeFiles: ["src/ui/page.tsx"] },
  { id: "F-UTIL", name: "共用工具", kind: "utility", codeFiles: ["src/lib/util.mjs", "src/lib/db.mjs"] },
  { id: "F-UTIL2", name: "無人用工具", kind: "utility", codeFiles: ["src/lib/orphan-util.mjs"] },
];

// 模擬 tree-sitter parsed 結構（buildCodeGraph 吃 parsed.files[].file/imports）
const parsed = {
  files: [
    { file: "src/routes/api.mjs", language: "javascript", imports: [{ source: "../lib/util.mjs" }, { source: "../lib/db.mjs" }] },
    { file: "src/ui/page.tsx", language: "typescript", imports: [{ source: "../lib/util.mjs" }] },
    { file: "src/lib/util.mjs", language: "javascript", imports: [] },
    { file: "src/lib/db.mjs", language: "javascript", imports: [] },
    { file: "src/lib/orphan-util.mjs", language: "javascript", imports: [] },
  ],
};

describe("C3: computeUtilityConsumers", () => {
  it("API+UI 都 import util → consumers 依 import 數排序", async () => {
    const { consumers, stats } = await computeUtilityConsumers("/fake", parsed, features);
    expect(stats.utilities).toBe(2);
    expect(stats.crossFeatureImportEdges).toBe(3);
    const util = consumers["F-UTIL"];
    expect(util.map(c => c.featureId)).toEqual(["F-API", "F-UI"]); // 2 imports > 1 import
    expect(util[0].imports).toBe(2);
    expect(util[0].name).toBe("API 功能");
  });

  it("沒人 import 的 utility → consumers 空陣列（誠實：無消費者回歸）", async () => {
    const { consumers } = await computeUtilityConsumers("/fake", parsed, features);
    expect(consumers["F-UTIL2"]).toEqual([]);
  });

  it("無 utility → 空 stats 不炸", async () => {
    const r = await computeUtilityConsumers("/fake", parsed, [features[0]]);
    expect(r.stats.utilities).toBe(0);
    expect(r.consumers).toEqual({});
  });
});
