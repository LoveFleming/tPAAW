/**
 * mergeFeaturesWithExisting — CU 重掃 merge 鐵律（2026-10-10 19:29 Fleming 拍板）
 * 智能層重跑不再毀滅性重建：繼承人員欄位、穩定 ID、消失標 retired。
 */

import { describe, it, expect } from "vitest";
import { mergeFeaturesWithExisting, FEATURE_INHERIT_FIELDS } from "../../packages/server/src/lib/feature-registry.mjs";

const now = "2026-10-10T19:30:00.000Z";
let seq = 0;
const makeId = () => `F20261010-${String(++seq).padStart(3, "0")}`;

const oldFeature = (id, files, extra = {}) => ({
  id,
  name: "舊名",
  status: "active",
  codeFiles: files,
  apis: ["GET /old"],
  createdAt: "2026-09-05T00:00:00.000Z",
  severityDecisions: [{ id: "sd-1", by: "fleming", at: "2026-10-10T18:20:00Z", severity: "S2", remark: "會刪檔" }],
  severitySuggested: "S1",
  severitySuggestedBy: "ai",
  riskProfile: { computedSeverity: "S1" },
  knowledgeGaps: ["缺 doc"],
  documentation: "人寫的文件",
  ...extra,
});

describe("mergeFeaturesWithExisting", () => {
  it("完全重疊 → 繼承 ID + 所有人員欄位（decisions/severity/status/createdAt…）", () => {
    seq = 0;
    const old = [oldFeature("F20260905-001", ["a.mjs", "b.mjs", "c.mjs"])];
    const fresh = [{ name: "新名", status: "active", codeFiles: ["a.mjs", "b.mjs", "c.mjs"], apis: ["GET /new"], tests: [] }];
    const out = mergeFeaturesWithExisting(fresh, old, makeId);
    expect(out).toHaveLength(1);
    const f = out[0];
    expect(f.id).toBe("F20260905-001");            // 穩定 ID
    expect(f.severityDecisions).toHaveLength(1);   // 判定歷史保留
    expect(f.severityDecisions[0].by).toBe("fleming");
    expect(f.severitySuggested).toBe("S1");
    expect(f.riskProfile.computedSeverity).toBe("S1");
    expect(f.knowledgeGaps).toEqual(["缺 doc"]);
    expect(f.documentation).toBe("人寫的文件");
    expect(f.createdAt).toBe("2026-09-05T00:00:00.000Z"); // createdAt 繼承
    expect(f.name).toBe("新名");                   // AI 長肉用新值
    expect(f.apis).toEqual(["GET /new"]);          // 骨架用新值
    expect(f.status).toBe("active");
  });

  it("≥50% 重疊 → 繼承；<50% → 發新 ID（人員欄位不帶）", () => {
    seq = 100;
    const old = [oldFeature("F20260905-002", ["a.mjs", "b.mjs", "c.mjs", "d.mjs"])];
    // 3/4 = 75% 重疊 → 繼承
    const hi = [{ name: "HI", codeFiles: ["a.mjs", "b.mjs", "c.mjs", "x.mjs"], apis: [] }];
    // 1/4 = 25% → 新
    const lo = [{ name: "LO", codeFiles: ["d.mjs", "y.mjs", "z.mjs", "w.mjs"], apis: [] }];
    const out = mergeFeaturesWithExisting([...hi, ...lo], old, makeId);
    expect(out).toHaveLength(2); // HI（繼承 F-002）+ LO（新 ID）；F-002 被繼承 → 無 retired 副本
    const hiF = out.find(f => f.name === "HI");
    const loF = out.find(f => f.name === "LO");
    expect(hiF.id).toBe("F20260905-002");
    expect(hiF.severityDecisions).toHaveLength(1);
    expect(loF.id).toMatch(/^F20261010-/);          // 新 ID
    expect(loF.severityDecisions).toBeUndefined();  // 不帶舊的人員欄位
    // 舊 feature 被繼承 → 不會再出現 retired 副本
    expect(out.filter(f => f.id === "F20260905-002")).toHaveLength(1);
  });

  it("拆分：兩個新 cluster 匹配同一舊 feature → 最佳者拿 ID，次者發新 ID", () => {
    seq = 200;
    const old = [oldFeature("F20260905-003", ["a.mjs", "b.mjs", "c.mjs", "d.mjs"])];
    const c1 = { name: "C1", codeFiles: ["a.mjs", "b.mjs", "c.mjs"], apis: [] }; // 100%
    const c2 = { name: "C2", codeFiles: ["c.mjs", "d.mjs", "e.mjs"], apis: [] }; // 67%
    const out = mergeFeaturesWithExisting([c1, c2], old, makeId);
    expect(out).toHaveLength(2);
    const ids = out.map(f => f.id);
    expect(ids.filter(x => x === "F20260905-003")).toHaveLength(1); // ID 一對一
    const c2f = out.find(f => f.name === "C2");
    expect(c2f.id).toMatch(/^F20261010-/);
  });

  it("舊 feature 消失 → 標 retired 不刪（引用不斷鏈）", () => {
    seq = 300;
    const old = [
      oldFeature("F20260905-004", ["gone.mjs"]),
      oldFeature("F20260905-005", ["stay.mjs"]),
    ];
    const fresh = [{ name: "Stay", codeFiles: ["stay.mjs"], apis: [] }];
    const out = mergeFeaturesWithExisting(fresh, old, makeId);
    expect(out).toHaveLength(2);
    const gone = out.find(f => f.id === "F20260905-004");
    expect(gone.status).toBe("retired");
    expect(gone.retiredAt).toBeTruthy();
    expect(gone.severityDecisions).toHaveLength(1); // 資產照留
    expect(out.find(f => f.id === "F20260905-005").status).toBe("active");
  });

  it("retired 舊 feature 被重新匹配 → 復活 active", () => {
    seq = 400;
    const old = [oldFeature("F20260905-006", ["back.mjs"], { status: "retired" })];
    const fresh = [{ name: "Back", codeFiles: ["back.mjs"], apis: [] }];
    const out = mergeFeaturesWithExisting(fresh, old, makeId);
    expect(out[0].id).toBe("F20260905-006");
    expect(out[0].status).toBe("active"); // 不繼承 retired
  });

  it("冪等：同輸入跑兩次，ID 與人員欄位一致", () => {
    seq = 500;
    const old = [oldFeature("F20260905-007", ["a.mjs", "b.mjs"])];
    const fresh = [{ name: "X", codeFiles: ["a.mjs", "b.mjs"], apis: [] }];
    const out1 = mergeFeaturesWithExisting(fresh, old, makeId);
    const out2 = mergeFeaturesWithExisting(fresh, old, makeId);
    expect(out1[0].id).toBe(out2[0].id);
    expect(out1[0].severityDecisions).toEqual(out2[0].severityDecisions);
  });

  it("空 existing → 全部發新 ID", () => {
    seq = 600;
    const fresh = [{ name: "N1", codeFiles: ["a.mjs"], apis: [] }, { name: "N2", codeFiles: ["b.mjs"], apis: [] }];
    const out = mergeFeaturesWithExisting(fresh, [], makeId);
    expect(out).toHaveLength(2);
    expect(new Set(out.map(f => f.id)).size).toBe(2);
  });

  it("FEATURE_INHERIT_FIELDS 覆蓋關鍵欄位", () => {
    const need = ["severityDecisions", "severity", "severitySuggested", "riskProfile", "status", "knowledgeGaps", "documentation", "createdAt"];
    for (const k of need) expect(FEATURE_INHERIT_FIELDS).toContain(k);
  });
});
