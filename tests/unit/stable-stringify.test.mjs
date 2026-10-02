import { describe, it, expect } from "vitest";
import { stableStringify } from "../../packages/server/src/lib/stable-stringify.mjs";

describe("stableStringify — deterministic JSON（sorted keys）", () => {
  it("同內容不同插入順序 → 字串相等（等值比較的正確性）", () => {
    const a = stableStringify({ x: 1, y: { b: 2, a: 3 } });
    const b = stableStringify({ y: { a: 3, b: 2 }, x: 1 });
    expect(a).toBe(b);
  });

  it("原始 JSON.stringify 順序敏感（對照組 — 這正是 helper 存在的原因）", () => {
    const a = JSON.stringify({ x: 1, y: 2 });
    const b = JSON.stringify({ y: 2, x: 1 });
    expect(a).not.toBe(b);
  });

  it("array 順序保持不變（只有 object key 排序）", () => {
    expect(stableStringify({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it("深層巢狀全部排序", () => {
    const out = stableStringify({ z: { c: { b: 1, a: 2 } }, a: 0 });
    expect(out).toBe('{"a":0,"z":{"c":{"a":2,"b":1}}}');
  });

  it("primitives 與 null/undefined 行為對齊 JSON.stringify", () => {
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hi")).toBe('"hi"');
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe(undefined);
  });

  it("tableHashes 等值比較場景（release-unit/model 真實用法）", () => {
    const oldModel = { tableHashes: { users: "h1", notes: "h2" } };
    const newModel = { tableHashes: { notes: "h2", users: "h1" } };
    expect(stableStringify(oldModel.tableHashes)).toBe(stableStringify(newModel.tableHashes));
    newModel.tableHashes.users = "changed";
    expect(stableStringify(oldModel.tableHashes)).not.toBe(stableStringify(newModel.tableHashes));
  });
});
