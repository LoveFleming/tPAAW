/**
 * Phase C（Feature First v2，2026-11-01）：
 * C1 kind 分類軸（deterministic）· C4 Identity 遷移報告（合併 union / 待歸屬不猜）
 */
import { describe, it, expect } from "vitest";
import {
  computeFeatureKind, ensureFeatureKinds, mergeFeaturesWithIdentityReport,
} from "../../packages/server/src/lib/feature-registry.mjs";

describe("C1: computeFeatureKind — 證據說話，不推測", () => {
  it("http 入口 → api", () => {
    expect(computeFeatureKind({ evidence: { kinds: { http: 12 } } })).toBe("api");
  });
  it("ui 入口 → ui", () => {
    expect(computeFeatureKind({ evidence: { kinds: { ui: 7 } } })).toBe("ui");
  });
  it("http+ui → api+ui", () => {
    expect(computeFeatureKind({ evidence: { kinds: { http: 3, ui: 5 } } })).toBe("api+ui");
  });
  it("grade=utility / orphan / llm-grouping → utility", () => {
    expect(computeFeatureKind({ grade: "utility" })).toBe("utility");
    expect(computeFeatureKind({ evidence: { kinds: { orphan: 9 } } })).toBe("utility");
    expect(computeFeatureKind({ evidence: { method: "llm-grouping" } })).toBe("utility");
  });
  it("無入口無 apis → module；legacy 手建帶 apis → api", () => {
    expect(computeFeatureKind({ evidence: { method: "label-propagation" } })).toBe("module");
    expect(computeFeatureKind({ apis: [{ method: "GET", path: "/x" }] })).toBe("api");
  });
  it("ensureFeatureKinds 冪等回填", () => {
    const fs = [{ id: "A", evidence: { kinds: { http: 1 } } }, { id: "B", kind: "ui" }];
    const n1 = ensureFeatureKinds(fs);
    expect(n1).toBe(1);
    expect(fs[0].kind).toBe("api");
    expect(ensureFeatureKinds(fs)).toBe(0); // 冪等
  });
});

describe("C4: mergeFeaturesWithIdentityReport — S8 全量重跑不失聯", () => {
  const old = (id, files, extra = {}) => ({
    id, name: `舊-${id}`, status: "active", codeFiles: files, apis: [],
    severityDecisions: [{ by: "fleming", severity: "S1" }],
    createdAt: "2026-09-01T00:00:00.000Z", ...extra,
  });
  let seq = 0;
  const makeId = () => `F20261101-${String(++seq).padStart(3, "0")}`;

  it("合併：兩個舊 feature ≥50% 命中同一新 cluster → best 繼承 ID，另一個 mergedFrom（union 不退休）", () => {
    seq = 0;
    const existing = [
      old("F-A", ["a.mjs", "b.mjs", "c.mjs"]),
      old("F-B", ["d.mjs", "e.mjs", "f.mjs"]),
    ];
    // 新 cluster 同時吃下兩邊全部（各 3/6 = 50% → 兩個都 ≥ 門檻）
    const fresh = [{ name: "合體", codeFiles: ["a.mjs", "b.mjs", "c.mjs", "d.mjs", "e.mjs", "f.mjs"], apis: [] }];
    const { features, report } = mergeFeaturesWithIdentityReport(fresh, existing, makeId);
    const f = features.find(x => x.name === "合體");
    expect(f.id).toBe("F-A"); // 最佳重疊繼承
    expect(f.identity.mergedFrom).toEqual(["F-B"]);
    expect(f.identity.note).toContain("合併自");
    expect(features.filter(x => x.id === "F-B")).toHaveLength(0); // 不出現退休副本
    expect(report.mergedFrom).toEqual([{ into: "F-A", from: ["F-B"] }]);
    expect(report.retired).toEqual([]);
  });

  it("待歸屬：部分重疊 <50% → 新 ID、不綁人員欄位、報告標 pending", () => {
    seq = 100;
    const existing = [old("F-C", ["a.mjs", "b.mjs", "c.mjs", "d.mjs"])];
    const fresh = [{ name: "半生不熟", codeFiles: ["a.mjs", "z1.mjs", "z2.mjs", "z3.mjs"], apis: [] }]; // 25%
    const { features, report } = mergeFeaturesWithIdentityReport(fresh, existing, makeId);
    const f = features.find(x => x.name === "半生不熟");
    expect(f.id).toMatch(/^F20261101-/);
    expect(f.severityDecisions).toBeUndefined(); // 程式絕不猜綁定
    expect(report.pendingAssignment).toEqual([{ featureId: f.id, bestRatio: 0.25, reason: expect.any(String) }]);
    expect(report.retired).toEqual(["F-C"]); // 舊的退休
  });

  it("乾淨繼承：≥50% 一對一 → ID 穩定 + 人員欄位保留（原 merge 鐵律不變）", () => {
    seq = 200;
    const existing = [old("F-D", ["a.mjs", "b.mjs", "c.mjs"])];
    const fresh = [{ name: "新名", codeFiles: ["a.mjs", "b.mjs", "c.mjs"], apis: [] }];
    const { features, report } = mergeFeaturesWithIdentityReport(fresh, existing, makeId);
    expect(features.find(x => x.name === "新名").id).toBe("F-D");
    expect(features.find(x => x.name === "新名").severityDecisions).toHaveLength(1);
    expect(report.inherited).toHaveLength(1);
    expect(features.find(x => x.name === "新名").identity).toBeUndefined();
  });

  it("報告 summary 計數正確", () => {
    seq = 300;
    const existing = [old("F-E", ["a.mjs"]), old("F-F", ["gone.mjs"])];
    const fresh = [{ name: "Keep", codeFiles: ["a.mjs"], apis: [] }, { name: "New", codeFiles: ["n.mjs"], apis: [] }];
    const { report } = mergeFeaturesWithIdentityReport(fresh, existing, makeId);
    expect(report.inherited).toHaveLength(1);
    expect(report.created).toHaveLength(1);
    expect(report.retired).toEqual(["F-F"]);
    expect(report.summary).toContain("繼承 1");
    expect(report.summary).toContain("retired 1");
  });
});
