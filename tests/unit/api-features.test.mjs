/**
 * api-features.test.mjs — API-first api_features 表（2026-11-01 Fleming 定案）
 *
 * 驗證：saveApiFeatures 全量替換 + entry 去重（無 entry 跳過）、readApiFeatures reconstruct 原形、
 * buildFileApiMap 檔案→API 反向索引。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveApiFeatures, buildFileApiMap } from "../../packages/server/src/lib/coding-db/api-features.repo.mjs";
import { readApiFeatures } from "../../packages/server/src/lib/coding-db/reads.mjs";

let root = null;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "api-feat-"));
  mkdirSync(join(root, ".paaw"), { recursive: true });
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const sample = [
  {
    id: "A20261101-001", category: "每日練習", entry: "POST /api/learning/practice/submit",
    name: "提交作答", description: "d", bizLogic: "b",
    processFlow: [{ step: 1, action: "解析參數", detail: "grade", file: "server.mjs:120" }],
    validation: [{ field: "grade", rule: "整數 1-9", on: "body", fail: "400" }],
    dataTouch: [{ table: "learner_attempt", ops: ["insert"] }],
    aiUnderstanding: "", codeFiles: ["server.mjs", "db.mjs"], tests: ["t.test.mjs"],
    severity: null, custom: {}, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
  },
  { entry: "GET /api/learning/practice/today", name: "今日題目", category: "每日練習", codeFiles: ["db.mjs"] },
];

describe("api-features repo", () => {
  it("A1: 存入 + 讀回原形（JSON 欄位 round-trip）", () => {
    saveApiFeatures(root, sample);
    const apis = readApiFeatures(root);
    expect(apis).toHaveLength(2);
    const a = apis.find(x => x.entry === "POST /api/learning/practice/submit");
    expect(a.id).toBe("A20261101-001");
    expect(a.category).toBe("每日練習");
    expect(a.processFlow[0].action).toBe("解析參數");
    expect(a.validation[0].fail).toBe("400");
    expect(a.dataTouch[0].table).toBe("learner_attempt");
    expect(a.codeFiles).toEqual(["server.mjs", "db.mjs"]);
    expect(a.tests).toEqual(["t.test.mjs"]);
  });

  it("A2: 全量替換 — 第二次存只留新內容", () => {
    saveApiFeatures(root, [{ entry: "GET /api/health", name: "健康檢查", category: "框架核心" }]);
    const apis = readApiFeatures(root);
    expect(apis).toHaveLength(1);
    expect(apis[0].entry).toBe("GET /api/health");
    expect(apis[0].category).toBe("框架核心");
  });

  it("A3: 無 entry 的列跳過（entry 是唯一必要識別）", () => {
    saveApiFeatures(root, [{ name: "沒進入點", category: "x" }, { entry: "POST /api/x", name: "有" }]);
    const apis = readApiFeatures(root);
    expect(apis).toHaveLength(1);
    expect(apis[0].entry).toBe("POST /api/x");
  });

  it("A4: buildFileApiMap — 檔案→API 反向索引（多 API 共用 utility）", () => {
    const map = buildFileApiMap(sample);
    expect(map["db.mjs"]).toHaveLength(2); // 共用 utility → 兩個 API 都列
    expect(map["server.mjs"][0].entry).toBe("POST /api/learning/practice/submit");
    expect(map["t.test.mjs"]).toHaveLength(1);
  });

  it("A5: entry 重複 → unique index 擋（saveApiFeatures 應 throw，資料不變）", () => {
    saveApiFeatures(root, [{ entry: "GET /api/health", name: "第一個" }]);
    expect(() => saveApiFeatures(root, [
      { entry: "GET /api/a", name: "a" },
      { entry: "GET /api/a", name: "重複" }, // 同批重複 entry
    ])).toThrow();
    expect(readApiFeatures(root)).toHaveLength(1); // rollback 生效
  });
});
