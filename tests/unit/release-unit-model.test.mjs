/**
 * release-unit-model.test.mjs — Release Unit Model 查詢函式測試
 *
 * 覆蓋 TASK-090 修復的契約：
 *   M-2 queryModelByApi — 空字串不誤回、前綴比對需在路徑邊界
 *   M-1 queryModelByFile — 查無關聯時回 null（與 feature/api 分支契約一致）
 */
import { describe, it, expect } from "vitest";
import { queryModelByApi, queryModelByFile, queryModelByFeature } from "@server/lib/release-unit/model.mjs";

const MODEL = {
  features: [
    { id: "F-001", name: "Alpha", files: ["src/a.mjs"], knowledgeGaps: [] },
    { id: "F-002", name: "Beta", files: ["src/b.mjs"] },
  ],
  apis: [
    { method: "GET", path: "/api/ru/model", file: "src/a.mjs", featureIds: ["F-001"] },
    { method: "GET", path: "/api/ru/overview", file: "src/b.mjs", featureIds: ["F-002"] },
  ],
  tests: [
    { testFile: "tests/a.test.mjs", productionFile: "src/a.mjs", featureIds: ["F-001"] },
  ],
  changes: [
    { hash: "abc", featureIds: ["F-001"] },
  ],
};

describe("queryModelByApi", () => {
  it("matches exact path", () => {
    const r = queryModelByApi(MODEL, "GET", "/api/ru/model");
    expect(r).toBeTruthy();
    expect(r.path).toBe("/api/ru/model");
  });

  it("does NOT return first API on empty routePath (M-2)", () => {
    expect(queryModelByApi(MODEL, "GET", "")).toBeNull();
    expect(queryModelByApi(MODEL, "GET", undefined)).toBeNull();
  });

  it("does NOT prefix-pollute: /model must not match /api/ru/model (M-2)", () => {
    expect(queryModelByApi(MODEL, "GET", "/model")).toBeNull();
  });

  it("matches when query is a suffix at a segment boundary", () => {
    const r = queryModelByApi(MODEL, "GET", "/ru/overview");
    expect(r).toBeTruthy();
    expect(r.path).toBe("/api/ru/overview");
  });

  it("returns null for unknown api", () => {
    expect(queryModelByApi(MODEL, "POST", "/api/ru/nope")).toBeNull();
  });
});

describe("queryModelByFile", () => {
  it("returns relations when file is known", () => {
    const r = queryModelByFile(MODEL, "src/a.mjs");
    expect(r).toBeTruthy();
    expect(r.featureIds).toContain("F-001");
    expect(r.apis).toContain("GET /api/ru/model");
  });

  it("returns null when file has no relations (M-1)", () => {
    expect(queryModelByFile(MODEL, "src/unknown.mjs")).toBeNull();
  });
});

describe("queryModelByFeature", () => {
  it("returns null for unknown feature", () => {
    expect(queryModelByFeature(MODEL, "NOPE")).toBeNull();
  });

  it("enriches with recent changes and related apis", () => {
    const r = queryModelByFeature(MODEL, "F-001");
    expect(r.changeCount).toBe(1);
    expect(r.relatedApis).toContain("GET /api/ru/model");
  });
});
