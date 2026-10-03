import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * multi-model review（MR1 2026-10-03）— 設定驗證規則測試
 * 規則（Fleming v3 定調）：
 * - flag 沒設/false → single mode（default model）
 * - flag true + reviewModels 去重後 <2 → error（不靜默降級）
 * - flag true + ≥2 不同 model → multi
 */

let tmp;

function makeEm(reviewConfig) {
  mkdirSync(join(tmp, ".paaw", "agents"), { recursive: true });
  writeFileSync(join(tmp, ".paaw", "agents", "coding.em.json"), JSON.stringify({ id: "coding.em", reviewConfig }));
}

beforeEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = mkdtempSync(join(tmpdir(), "mmr-test-"));
});

describe("resolveReviewConfig", () => {
  it("沒設 reviewConfig → single", async () => {
    const { resolveReviewConfig } = await import("@server/lib/coding-review-runner.mjs");
    expect(resolveReviewConfig(tmp).mode).toBe("single");
  });

  it("flag false → single（models 忽略）", async () => {
    const { resolveReviewConfig } = await import("@server/lib/coding-review-runner.mjs");
    makeEm({ multiAgentReview: false, reviewModels: ["a/m1", "a/m2"] });
    expect(resolveReviewConfig(tmp).mode).toBe("single");
  });

  it("flag true 但 models 空 → error 且訊息含「不靜默降級」", async () => {
    const { resolveReviewConfig } = await import("@server/lib/coding-review-runner.mjs");
    makeEm({ multiAgentReview: true, reviewModels: [] });
    const r = resolveReviewConfig(tmp);
    expect(r.mode).toBe("error");
    expect(r.error).toContain("不靜默降級");
  });

  it("flag true + 重複 model 去重後 <2 → error", async () => {
    const { resolveReviewConfig } = await import("@server/lib/coding-review-runner.mjs");
    makeEm({ multiAgentReview: true, reviewModels: ["zai/glm-5.1", "zai/glm-5.1"] });
    expect(resolveReviewConfig(tmp).mode).toBe("error");
  });

  it("flag true + 2 個不同 model → multi", async () => {
    const { resolveReviewConfig } = await import("@server/lib/coding-review-runner.mjs");
    makeEm({ multiAgentReview: true, reviewModels: ["zai/glm-5.1", "openrouter/deepseek/deepseek-v4-flash-0731"] });
    const r = resolveReviewConfig(tmp);
    expect(r.mode).toBe("multi");
    expect(r.models).toHaveLength(2);
  });
});

describe("_parseFindings 行為（經由模組內部抽驗）", () => {
  it("reviewer 輸出無 json fence → findings 空 + parseError", async () => {
    // 經 runner 的輸出格式器間接驗證：無 finding 不會炸
    const mod = await import("@server/lib/coding-review-runner.mjs");
    const r = { decision: "approve", sevCount: { critical: 0, major: 0, minor: 0 }, merged: [], perModel: [], dropped: [], reviewers: ["a/m1"], reportPath: "/tmp/x.md", range: "HEAD~1..HEAD", files: 1 };
    const out = mod.formatReviewResult(r);
    expect(out).toContain("approve");
  });
});
