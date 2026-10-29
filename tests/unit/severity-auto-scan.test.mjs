/**
 * autoScanAllFeatureSeverities — CU 後 severity 自動落地（2026-10-10 20:52）
 * 零 token 構成面全量掃描；by:ai 深度建議保留；retired/無檔 skip。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoScanAllFeatureSeverities } from "../../packages/server/src/lib/feature-risk-scan.mjs";
import { loadFeatures } from "../../packages/server/src/lib/feature-registry.mjs";

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sevauto-"));
  // 真原始碼：含 SQL insert（構成面信號 → S1）
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "svc.mjs"), `db.run("INSERT INTO t (a) VALUES (?)", [x]);fetch("https://api.example.com/push", { method: "POST" });\n`);
  writeFileSync(join(dir, "src", "pure.mjs"), `export const add = (a, b) => a + b;\n`);
  mkdirSync(join(dir, ".paaw", "features"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "features", "FEATURES.json"), JSON.stringify({ features: [
    { id: "F-1", name: "empty", status: "active", codeFiles: ["src/svc.mjs"] },                    // 空 → 落地 scan
    { id: "F-2", name: "aiKept", status: "active", codeFiles: ["src/pure.mjs"],
      severitySuggested: "S2", severitySuggestedBy: "ai", severitySuggestedReason: "AI 深度建議" }, // by:ai → 保留
    { id: "F-3", name: "scanRefresh", status: "active", codeFiles: ["src/svc.mjs"],
      severitySuggested: "S0", severitySuggestedBy: "scan" },                                       // by:scan → 更新
    { id: "F-4", name: "retired", status: "retired", codeFiles: ["src/svc.mjs"] },                  // retired → skip
    { id: "F-5", name: "noFiles", status: "active", codeFiles: [] },                                // 無檔 → skip
  ] }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("autoScanAllFeatureSeverities", () => {
  it("空 → 落地 by:scan；by:ai 保留；by:scan 更新；retired/無檔 skip", async () => {
    const r1 = await autoScanAllFeatureSeverities(dir);
    expect(r1.updated).toBe(3); // F-1/F-2/F-3（F-4/F-5 skip）
    const feats = Object.fromEntries(loadFeatures(dir).map(f => [f.name, f]));

    // F-1 空 → 落地（insert+POST → S1）
    expect(feats.empty.severitySuggestedBy).toBe("scan");
    expect(feats.empty.severitySuggested).toBe("S1");
    expect(feats.empty.riskProfile.computedSeverity).toBe("S1");
    expect(feats.empty.severitySuggestedAt).toBeTruthy();

    // F-2 by:ai → severitySuggested 保留、riskProfile 照樣重算
    expect(feats.aiKept.severitySuggested).toBe("S2");
    expect(feats.aiKept.severitySuggestedBy).toBe("ai");
    expect(feats.aiKept.severitySuggestedReason).toBe("AI 深度建議");
    expect(feats.aiKept.riskProfile.computedSeverity).toBe("S0"); // pure.mjs → S0（重算了）

    // F-3 by:scan → 更新為新掃描值
    expect(feats.scanRefresh.severitySuggested).toBe("S1");

    // F-4 retired → 不掃
    expect(feats.retired.riskProfile).toBeUndefined();
    // F-5 無 codeFiles → 不掃
    expect(feats.noFiles.riskProfile).toBeUndefined();
  });

  it("冪等：再跑一次結果一致", async () => {
    await autoScanAllFeatureSeverities(dir);
    await autoScanAllFeatureSeverities(dir);
    const feats = Object.fromEntries(loadFeatures(dir).map(f => [f.name, f]));
    expect(feats.empty.severitySuggested).toBe("S1");
    expect(feats.aiKept.severitySuggested).toBe("S2"); // ai 仍在
  });
});
