/**
 * release-evidence（Evidence Matrix）單元測試（2026-10-10）
 * - severity join（confirmed vs 未確認）
 * - semgrep findings × feature files
 * - review-board md 解析（reviewers/decision/findingFiles）
 * - 分級 gaps（S2 全要 / S1 擇一 / S0 基本 / 未確認）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSeverityMap, loadSecurityScan, sgForFeature, loadReviewBoard,
  aiReviewForFeature, evidenceGaps, buildEvidenceMatrix,
} from "../../packages/server/src/lib/release-evidence.mjs";

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ev-test-"));
  // FEATURES.json（severity 確認態）
  mkdirSync(join(dir, ".paaw", "features"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "features", "FEATURES.json"), JSON.stringify([
    { id: "F-001", name: "sandbox", severity: "S2", severitySuggested: "S2" },
    { id: "F-002", name: "docs", severitySuggested: "S0", severitySuggestedBy: "scan" }, // AI 判定預設生效
  ]));
  // semgrep 掃描結果
  mkdirSync(join(dir, ".paaw", "security"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "security", "scan-results.json"), JSON.stringify({
    scannedAt: "2026-10-10T01:00:00Z",
    findings: [
      { file: "src/sandbox.mjs", severity: "ERROR", id: "rule.x" },
      { file: "src/docs.tsx", severity: "WARNING", id: "rule.y" },
    ],
  }));
  // review-board 報告
  mkdirSync(join(dir, ".paaw", "review-board"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "review-board", "20261010-120000-HEAD_1-HEAD.md"), [
    "# Multi-Model Code Review Report", "",
    "- 時間：2026-10-10T12:00:00.000Z",
    "- Range：`HEAD~1..HEAD`",
    "- Reviewers：`glm-5.1`、`deepseek-v4.1`",
    "- 結論：**request-changes**（critical 1 / major 0 / minor 0）", "",
    "## Findings", "",
    "### 🔴 src/sandbox.mjs:42 🤝 共識",
    "- **severity**：critical　**models**：`glm-5.1`、`deepseek-v4.1`",
    "- `glm-5.1`：這裡有洞",
    "", "## 各 Reviewer 明細", "",
    "- `glm-5.1`：1 findings（10s）",
    "- `deepseek-v4.1`：1 findings（8s）",
    "",
  ].join("\n"));
  // qa-results（需給 qa-results 真實結構 — 直接寫其存儲檔）
  mkdirSync(join(dir, ".paaw", "coding-memory"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "coding-memory", "qa-results.jsonl"), [
    { id: "q1", ts: "2026-10-10T10:00:00Z", actor: "ai", type: "smoke", feature: "sandbox", verdict: "pass", summary: "smoke ok", issues: [], evidence: [] },
    { id: "q2", ts: "2026-10-10T11:00:00Z", actor: "human", type: "manual", feature: "sandbox", verdict: "pass", summary: "人測過三平台", issues: [], evidence: [] },
  ].map(x => JSON.stringify(x)).join("\n"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("severity join", () => {
  it("生效順序：人覆寫 > AI 落地（Fleming 18:08：預設信任 AI，人後改）", async () => {
    const m = await loadSeverityMap(dir);
    expect(m.get("F-001")).toMatchObject({ severity: "S2", source: "human" });   // 人覆寫最高
    expect(m.get("F-002")).toMatchObject({ severity: "S0", source: "scan" });    // AI/掃描落地直接生效
  });
});

describe("semgrep × feature", () => {
  it("high finding 命中 feature → not ok；warning only → ok", async () => {
    const scan = await loadSecurityScan(dir);
    const hit = sgForFeature(scan, ["src/sandbox.mjs"]);
    expect(hit.ok).toBe(false); // ERROR severity
    expect(hit.high).toBe(1);
    const warn = sgForFeature(scan, ["src/docs.tsx"]);
    expect(warn.ok).toBe(true);
    expect(warn.total).toBe(1);
    expect(sgForFeature(null, []).ok).toBe(false); // 未掃描
  });
});

describe("review-board 解析", () => {
  it("reviewers/decision/findingFiles 解析正確", async () => {
    const board = await loadReviewBoard(dir);
    expect(board).toBeTruthy();
    expect(board.latest.reviewers).toEqual(["glm-5.1", "deepseek-v4.1"]);
    expect(board.latest.decision).toBe("request-changes");
    expect(board.latest.findingFiles).toContain("src/sandbox.mjs");
  });
  it("feature 檔案被審到 → ok=false（request-changes）；未觸及 → notRun", async () => {
    const board = await loadReviewBoard(dir);
    const rv = aiReviewForFeature(board, ["src/sandbox.mjs"]);
    expect(rv.ok).toBe(false); // decision=request-changes
    expect(rv.models).toEqual(["glm-5.1", "deepseek-v4.1"]);
    const rv2 = aiReviewForFeature(board, ["src/other.ts"]);
    expect(rv2.ok).toBe(false);
    expect(rv2.reason).toContain("未觸及");
    expect(aiReviewForFeature(null, ["x"]).ok).toBe(false); // 無 board
  });
});

describe("分級 gaps", () => {
  const evFull = {
    unit: { ok: true }, e2e: { ok: true }, sg: { ok: true }, qa: { ok: true },
    aiReview: { ok: true }, human: { ok: true },
  };
  it("S2 全過 → 無缺", () => {
    expect(evidenceGaps("S2", evFull).missing).toEqual([]);
  });
  it("S2 缺 aiReview → 列出", () => {
    expect(evidenceGaps("S2", { ...evFull, aiReview: { ok: false } }).missing).toEqual(["aiReview"]);
  });
  it("S1 擇一：qa 有 aiReview 沒 → 不算缺", () => {
    expect(evidenceGaps("S1", { ...evFull, aiReview: { ok: false } }).missing).toEqual([]);
  });
  it("S1 兩者都缺 → 缺一項（擇一）", () => {
    expect(evidenceGaps("S1", { ...evFull, qa: { ok: false }, aiReview: { ok: false } }).missing.length).toBe(1);
  });
  it("無 severity 防禦從嚴 S1（unit+e2e+sg+擇一）", () => {
    const g = evidenceGaps(null, evFull);
    expect(g.missing).toEqual([]);
    expect(evidenceGaps(null, { ...evFull, qa: { ok: false }, aiReview: { ok: false } }).missing.length).toBe(1);
  });
});

describe("buildEvidenceMatrix（整合）", () => {
  it("S2 feature：qa/human 有記錄、sg 有 ERROR → gaps 含 sg；board request-changes → aiReview 缺", async () => {
    const mx = await buildEvidenceMatrix(dir, [
      { id: "F-001", name: "sandbox", changedFiles: ["src/sandbox.mjs"], hasTests: true, tests: [{ file: "t.test.mjs" }], apiImpact: false, e2eCoveredApis: 0, apis: [] },
    ], { lastTestRunGreen: true });
    const f = mx.features[0];
    expect(f.severity).toBe("S2");
    expect(f.evidence.qa.ok).toBe(true);
    expect(f.evidence.human.ok).toBe(true); // human 證據欄（= qa 記錄裡 actor=human 的 verdict）
    expect(f.evidence.sg.ok).toBe(false);
    expect(f.evidence.aiReview.ok).toBe(false);
    expect(f.gaps.missing).toContain("sg");
    expect(f.gaps.missing).toContain("aiReview");
    expect(mx.summary.bySeverity.S2).toBe(1);
  });
  it("AI 判定預設生效：F-002（S0 scan）直接算分級，humanOverride/aiDefault 統計", async () => {
    const mx = await buildEvidenceMatrix(dir, [
      { id: "F-002", name: "docs", changedFiles: ["src/docs.tsx"], hasTests: true, tests: [], apiImpact: false, e2eCoveredApis: 0, apis: [] },
    ], {});
    expect(mx.features[0].severity).toBe("S0"); // AI 落地值直接生效
    expect(mx.features[0].severitySource).toBe("scan");
    expect(mx.features[0].gaps.missing).toEqual(["qa"]); // S0 = unit+qa → unit✓（hasTests+綠燈）；qa 無記錄→缺
    expect(mx.summary.bySeverity.aiDefault).toBe(1);
    expect(mx.summary.bySeverity.humanOverride).toBe(0);
  });
});
