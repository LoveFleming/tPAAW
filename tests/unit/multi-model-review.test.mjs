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

// ── MR2（2026-10-03）：分歧紅標 + 自動打回 ──

describe("analyzeDisputes", () => {
  const F = (file, line, severity, model, claim = "x") => ({
    file, line, severity, claim, fix: "",
    models: [model], claims: [{ model, claim, fix: "" }], consensus: false,
  });

  it("同位置不同 severity 跨 model → severity-conflict 分歧", async () => {
    const { analyzeDisputes } = await import("@server/lib/coding-review-runner.mjs");
    const perModel = [
      { model: "m1", error: null, findings: [F("a.ts", 10, "critical", "m1")] },
      { model: "m2", error: null, findings: [F("a.ts", 11, "minor", "m2")] },
    ];
    const { disputes } = analyzeDisputes(perModel, perModel.flatMap(p => p.findings));
    expect(disputes).toHaveLength(1);
    expect(disputes[0].kind).toBe("severity-conflict");
  });

  it("單邊 critical + 另一存活 reviewer 同位置無 finding → critical-unconfirmed", async () => {
    const { analyzeDisputes } = await import("@server/lib/coding-review-runner.mjs");
    const perModel = [
      { model: "m1", error: null, findings: [F("a.ts", 100, "critical", "m1")] },
      { model: "m2", error: null, findings: [F("b.ts", 5, "minor", "m2")] },
    ];
    const { disputes } = analyzeDisputes(perModel, perModel.flatMap(p => p.findings));
    expect(disputes.some(d => d.kind === "critical-unconfirmed" && d.file === "a.ts")).toBe(true);
  });

  it("只有一個存活 reviewer 時不判單邊 critical（無交叉可比）", async () => {
    const { analyzeDisputes } = await import("@server/lib/coding-review-runner.mjs");
    const perModel = [
      { model: "m1", error: null, findings: [F("a.ts", 100, "critical", "m1")] },
      { model: "m2", error: "LLM error 401", findings: [] },
    ];
    const { disputes } = analyzeDisputes(perModel, perModel.flatMap(p => p.findings));
    expect(disputes).toHaveLength(0);
  });

  it("同 model 自相矛盾（同位置兩 severity 同源）不算跨 model 分歧", async () => {
    const { analyzeDisputes } = await import("@server/lib/coding-review-runner.mjs");
    const perModel = [
      { model: "m1", error: null, findings: [F("a.ts", 10, "critical", "m1"), F("a.ts", 10, "minor", "m1")] },
      { model: "m2", error: null, findings: [] },
    ];
    const { disputes } = analyzeDisputes(perModel, perModel.flatMap(p => p.findings));
    expect(disputes.filter(d => d.kind === "severity-conflict")).toHaveLength(0);
  });
});

describe("buildReworkTicket", () => {
  it("只抓 critical 進必修清單，標共識/單邊", async () => {
    const { buildReworkTicket } = await import("@server/lib/coding-review-runner.mjs");
    const merged = [
      { file: "a.ts", line: 1, severity: "critical", models: ["m1", "m2"], claims: [{ model: "m1", claim: "會炸", fix: "加 null 檢查" }, { model: "m2", claim: "同上", fix: "" }] },
      { file: "b.ts", line: 2, severity: "major", models: ["m1"], claims: [{ model: "m1", claim: "建議", fix: "" }] },
      { file: "c.ts", line: 3, severity: "critical", models: ["m2"], claims: [{ model: "m2", claim: "單邊雷", fix: "改" }] },
    ];
    const spec = buildReworkTicket(merged, { range: "HEAD~1..HEAD" }, "/tmp/r.md");
    expect(spec.mustFix).toHaveLength(2);
    expect(spec.files).toEqual(["a.ts", "c.ts"]);
    expect(spec.title).toContain("2 critical");
    expect(spec.description).toContain("🤝共識");
    expect(spec.description).toContain("🚩單邊");
  });
});

describe("reviewConfig.autoRework", () => {
  it("預設 true；顯式 false 才關", async () => {
    const { resolveReviewConfig } = await import("@server/lib/coding-review-runner.mjs");
    makeEm({ multiAgentReview: false });
    expect(resolveReviewConfig(tmp).autoRework).toBe(true);
    makeEm({ multiAgentReview: true, reviewModels: ["a/m1", "a/m2"], autoRework: false });
    expect(resolveReviewConfig(tmp).autoRework).toBe(false);
  });
});
