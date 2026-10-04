import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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

describe("analyzeDisputes 邊界（reviewer 自查意見補測）", () => {
  const F = (file, line, severity, model, claim = "x") => ({
    file, line, severity, claim, fix: "",
    models: [model], claims: [{ model, claim, fix: "" }], consensus: false,
  });

  it("同 model 自己在critical 位置也報 minor → 不算其他 model 打破靜默 → 仍判 critical-unconfirmed", async () => {
    const { analyzeDisputes } = await import("@server/lib/coding-review-runner.mjs");
    const perModel = [
      { model: "m1", error: null, findings: [F("a.ts", 100, "critical", "m1"), F("a.ts", 101, "minor", "m1")] },
      { model: "m2", error: null, findings: [] },
    ];
    const { disputes } = analyzeDisputes(perModel, perModel.flatMap(p => p.findings));
    expect(disputes.some(d => d.kind === "critical-unconfirmed" && d.file === "a.ts")).toBe(true);
  });

  it("位移恰好 4 行（±3 邊界外）→ 不判 severity-conflict", async () => {
    const { analyzeDisputes } = await import("@server/lib/coding-review-runner.mjs");
    const perModel = [
      { model: "m1", error: null, findings: [F("a.ts", 10, "critical", "m1")] },
      { model: "m2", error: null, findings: [F("a.ts", 14, "minor", "m2")] },
    ];
    const { disputes } = analyzeDisputes(perModel, perModel.flatMap(p => p.findings));
    expect(disputes.filter(d => d.kind === "severity-conflict")).toHaveLength(0);
  });
});


// ── TASK-049（2026-10-03 review 打回）：全數 reviewer 失敗不得回 approve ──

describe("resolveDecision（TASK-049 回歸）", () => {
  const SEV0 = { critical: 0, major: 0, minor: 0 };

  it("全數 reviewer 失敗（LLM error / parse error）→ inconclusive，絕不 approve", async () => {
    const { resolveDecision } = await import("@server/lib/coding-review-runner.mjs");
    const perModel = [
      { model: "zai/glm-5.1", error: "LLM error 500", findings: [] },
      { model: "openrouter/deepseek", error: "no json array found", findings: [] },
    ];
    expect(resolveDecision(perModel, SEV0)).toBe("inconclusive");
  });

  it("single mode 唯一 reviewer 失敗 → inconclusive", async () => {
    const { resolveDecision } = await import("@server/lib/coding-review-runner.mjs");
    expect(resolveDecision([{ model: "default", error: "LLM error 401", findings: [] }], SEV0)).toBe("inconclusive");
  });

  it("crashed reviewer（error 字串）也算失敗 → 全失敗仍 inconclusive", async () => {
    const { resolveDecision } = await import("@server/lib/coding-review-runner.mjs");
    expect(resolveDecision([{ model: "(crashed)", error: "reviewer crashed", findings: [] }], SEV0)).toBe("inconclusive");
  });

  it("部分失敗但至少一位成功且無 finding → approve（該 reviewer 真的看過 diff）", async () => {
    const { resolveDecision } = await import("@server/lib/coding-review-runner.mjs");
    const perModel = [
      { model: "m1", error: "LLM error 401", findings: [] },
      { model: "m2", error: null, findings: [] },
    ];
    expect(resolveDecision(perModel, SEV0)).toBe("approve");
  });

  it("有 critical → request-changes；只有 major → review-notes", async () => {
    const { resolveDecision } = await import("@server/lib/coding-review-runner.mjs");
    const ok = [{ model: "m1", error: null, findings: [] }];
    expect(resolveDecision(ok, { critical: 1, major: 0, minor: 0 })).toBe("request-changes");
    expect(resolveDecision(ok, { critical: 0, major: 2, minor: 0 })).toBe("review-notes");
  });
});

describe("formatReviewResult：inconclusive 呈現（TASK-049 回歸）", () => {
  it("decision=inconclusive → 明確標 ⛔ 不得視為通過", async () => {
    const mod = await import("@server/lib/coding-review-runner.mjs");
    const r = {
      decision: "inconclusive", sevCount: { critical: 0, major: 0, minor: 0 }, merged: [],
      perModel: [{ model: "m1", error: "LLM error 401" }], dropped: [], disputes: [],
      reviewers: ["m1"], reportPath: "/tmp/x.md", range: "HEAD~1..HEAD", files: 1,
    };
    const out = mod.formatReviewResult(r);
    expect(out).toContain("inconclusive");
    expect(out).toContain("⛔");
  });
});

// ── TASK-049 鞏固：runMultiModelReview 端到端（mock LLM，不發真請求）──
// 覆蓋聚合層整合行為：全數失敗不得 approve；部分成功 → 只採計存活 reviewer 的 findings。
// runner 內以 await import("./llm-utils.mjs") / await import("./paaw-agent-loop.mjs")
// 動態引入 — vi.mock 攔 module registry，dynamic import 同樣命中。

vi.mock("@server/lib/llm-utils.mjs", () => ({ callLLMWithRetry: vi.fn() }));
vi.mock("@server/lib/paaw-agent-loop.mjs", () => ({
  // 回傳 model = reviewer id，讓 mock 實作可依 body.model 分流「誰成功誰失敗」
  resolveLLMConfig: vi.fn((_dir, m) => ({ apiUrl: "http://mock", headers: {}, model: m || "default" })),
}));

describe("runMultiModelReview 端到端（TASK-049 鞏固）", () => {
  /** 建臨時 git repo：commit1 建 a.ts，commit2 改 a.ts → HEAD~1..HEAD 有 diff */
  function makeGitRepo() {
    const g = (...args) => spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
    g("init", "-q");
    g("config", "user.email", "t@t");
    g("config", "user.name", "t");
    writeFileSync(join(tmp, "a.ts"), "line1\n");
    g("add", "-A"); g("commit", "-qm", "c1");
    writeFileSync(join(tmp, "a.ts"), "line1\nline2\n");
    g("add", "-A"); g("commit", "-qm", "c2");
  }

  /** multi 模式：m/ok + m/fail 兩位 reviewer，autoRework 關（不碰 task store） */
  function setup() {
    makeEm({ multiAgentReview: true, reviewModels: ["m/ok", "m/fail"], autoRework: false });
    makeGitRepo();
  }

  const FINDING_JSON = (file, line, severity, claim) =>
    "```json\n" + JSON.stringify([{ file, line, severity, claim, fix: "" }]) + "\n```";
  const EMPTY_JSON = "```json\n[]\n```";

  const run = () =>
    import("@server/lib/coding-review-runner.mjs").then(m =>
      m.runMultiModelReview({ projectDir: tmp, onProgress: () => {} }));

  beforeEach(async () => {
    const { callLLMWithRetry } = await import("@server/lib/llm-utils.mjs");
    callLLMWithRetry.mockReset();
  });

  it("全數 reviewer LLM 失敗（401/500）→ decision=inconclusive，絕不 approve", async () => {
    setup();
    const { callLLMWithRetry } = await import("@server/lib/llm-utils.mjs");
    callLLMWithRetry.mockRejectedValue(new Error("LLM error 500"));
    const r = await run();
    expect(r.decision).toBe("inconclusive");
    expect(r.decision).not.toBe("approve");
    expect(r.merged).toHaveLength(0);
    expect(r.perModel.every(p => p.error && p.error.includes("LLM error"))).toBe(true);
  });

  it("全數 reviewer 回覆無 JSON（parse error）→ inconclusive，error 標記含 no json array", async () => {
    setup();
    const { callLLMWithRetry } = await import("@server/lib/llm-utils.mjs");
    callLLMWithRetry.mockResolvedValue({ content: "我看過 diff 了，看起來沒問題。" });
    const r = await run();
    expect(r.decision).toBe("inconclusive");
    expect(r.perModel.every(p => p.error)).toBe(true);
    expect(r.perModel.some(p => p.error.includes("no json array"))).toBe(true);
  });

  it("部分成功：m/fail 401、m/ok 報 critical → 正常聚合為 request-changes，findings 只採計存活者", async () => {
    setup();
    const { callLLMWithRetry } = await import("@server/lib/llm-utils.mjs");
    callLLMWithRetry.mockImplementation(async (_u, _h, body) => {
      if (body.model === "m/ok") return { content: FINDING_JSON("a.ts", 2, "critical", "會炸") };
      throw new Error("LLM error 401");
    });
    const r = await run();
    expect(r.decision).toBe("request-changes");
    expect(r.sevCount).toEqual({ critical: 1, major: 0, minor: 0 });
    expect(r.merged).toHaveLength(1);
    expect(r.merged[0]).toMatchObject({ file: "a.ts", line: 2, severity: "critical", models: ["m/ok"] });
    expect(r.merged[0].consensus).toBe(false); // 僅 1 位存活，不構成共識
    const failed = r.perModel.find(p => p.model === "m/fail");
    const ok = r.perModel.find(p => p.model === "m/ok");
    expect(failed.error).toContain("LLM error 401");
    expect(ok.error).toBeNull();
    expect(r.reworkTicket).toBeNull(); // autoRework 關閉不開單
  });

  it("部分成功：存活者真正看過 diff 回空 findings → approve（非全數失敗，允許 approve）", async () => {
    setup();
    const { callLLMWithRetry } = await import("@server/lib/llm-utils.mjs");
    callLLMWithRetry.mockImplementation(async (_u, _h, body) => {
      if (body.model === "m/ok") return { content: EMPTY_JSON };
      throw new Error("LLM error 401");
    });
    const r = await run();
    expect(r.decision).toBe("approve");
    expect(r.merged).toHaveLength(0);
  });

  it("存活者回 diff 外的幻覺檔案 → finding 退件進 dropped，不進 merged 不計 severity", async () => {
    setup();
    const { callLLMWithRetry } = await import("@server/lib/llm-utils.mjs");
    callLLMWithRetry.mockImplementation(async (_u, _h, body) => {
      if (body.model === "m/ok") return { content: FINDING_JSON("nonexist.ts", 99, "critical", "幻覺") };
      return { content: EMPTY_JSON };
    });
    const r = await run();
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]).toMatchObject({ model: "m/ok", file: "nonexist.ts" });
    expect(r.merged).toHaveLength(0);
    expect(r.sevCount.critical).toBe(0);
    expect(r.decision).toBe("approve");
  });
});
