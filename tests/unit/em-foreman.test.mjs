/**
 * Unit tests — EM 工頭（em-foreman）三柱架構（2026-10-01）
 *
 * 柱一 em-task-store.mjs：任務檔狀態機（progress log / digest / resumable / 開單）
 * 柱二 em-orchestrator.mjs：open_ticket + QA 鐵律 + bug 保險絲 + 治本規則
 * 柱三 em-job-entrypoints.mjs：四條 deterministic 工作入口 + triage 開單
 *
 * 策略：fixtures 用 tmp 目錄（每 test 獨立）；orchestrator 用 decisionOverride
 * 注入決策序列（不叫 LLM）、_deps.a2aCallAgent stub 派工結果。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  genTaskId, createTicket, appendProgress, getProgress, buildTaskDigest,
  hydrateFromProgress, shouldForceQA, bugFuseVerdict, rootCauseVerdict,
  resolveFeatureForFiles, loadTasksFile,
} from "../../packages/server/src/lib/em-task-store.mjs";
import { orchestrateTask } from "../../packages/server/src/lib/em-orchestrator.mjs";
import { runJobEntrypoint, triageToTickets, readJobTypesConfig } from "../../packages/server/src/lib/em-job-entrypoints.mjs";

// ── fixture helpers ──

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "em-foreman-"));
  mkdirSync(join(root, ".paaw", "tasks"), { recursive: true });
  mkdirSync(join(root, ".paaw", "features"), { recursive: true });
  mkdirSync(join(root, ".paaw", "security"), { recursive: true });
  mkdirSync(join(root, ".paaw", "code-intelligence"), { recursive: true });
  mkdirSync(join(root, ".paaw", "auto-dispatch"), { recursive: true });

  writeFileSync(join(root, ".paaw", "features", "FEATURES.json"), JSON.stringify({
    features: [
      { id: "F-001", name: "Alpha", status: "active", codeFiles: ["src/a.ts"], testFiles: [], docFiles: [] },
      { id: "F-002", name: "Beta", status: "active", codeFiles: ["src/b.ts"], testFiles: ["src/b.test.ts"], docFiles: ["docs/b.md"] },
      { id: "F-003", name: "Gamma", status: "planned", codeFiles: [], testFiles: [], docFiles: [] },
    ],
  }));
  writeFileSync(join(root, ".paaw", "features", "FILE-FEATURES.json"), JSON.stringify({
    files: { "src/a.ts": [{ id: "F-001", name: "Alpha" }], "src/b.ts": [{ id: "F-002", name: "Beta" }] },
  }));
  writeFileSync(join(root, ".paaw", "tasks", "TASKS.json"), JSON.stringify({ tasks: [], updatedAt: new Date().toISOString() }));
  return root;
}

function seedTask(root, overrides = {}) {
  const { data, tasks } = loadTasksFile(root);
  const task = {
    id: "TASK-100", featureId: "F-001", type: "dev", title: "測試任務", parentId: null,
    status: "open", priority: "high", labels: [], assignee: null,
    description: "## 目標\n做某功能\n\n## 驗收標準\n1. 功能可用 2. 測試過",
    relatedFiles: [], notes: [], progressLog: [], result: null, git: null, timeoutSeconds: 0,
    spec: { tests: true, review: true, docs: false }, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), resolvedAt: null, createdBy: "test", source: null,
    ...overrides,
  };
  tasks.push(task);
  writeFileSync(join(root, ".paaw", "tasks", "TASKS.json"), JSON.stringify({ ...data, tasks }, null, 2));
  return task;
}

const OK_AGENT = async () => ({ success: true, content: "✅ 完成：改了 X 檔", usage: { total_tokens: 100 } });
const MODEL = "zai/glm-5.1";
const FALLBACKS = ["openrouter/deepseek/deepseek-v4-flash-0731"];

// decision sequencer：依序吐決策，序列用完就 escalate（防無限迴圈）
function seqDecisions(list) {
  let i = 0;
  return async () => (i < list.length ? list[i++] : { action: "escalate", reason: "測試序列用盡" });
}

// ══════════════════════════════════════════
// 柱一：em-task-store
// ══════════════════════════════════════════

describe("柱一：em-task-store 狀態機", () => {
  let root;
  beforeEach(() => { root = makeFixture(); });

  it("genTaskId 遞增不重疊", () => {
    expect(genTaskId([])).toBe("TASK-001");
    expect(genTaskId([{ id: "TASK-007" }, { id: "TASK-003" }])).toBe("TASK-008");
    expect(genTaskId([{ id: "TASK-999" }])).toBe("TASK-1000");
  });

  it("createTicket：featureId 明給（存在）→ 直用", () => {
    const r = createTicket(root, { title: "t", description: "d", acceptance: "a", featureId: "F-002" });
    expect(r.ok).toBe(true);
    expect(r.task.featureId).toBe("F-002");
    expect(r.task.status).toBe("open");
    expect(r.task.description).toContain("## 驗收標準");
  });

  it("createTicket：featureId 不存在 → affectedFiles 反查 FILE-FEATURES", () => {
    const r = createTicket(root, { title: "t", description: "d", featureId: "F-999", affectedFiles: ["src/b.ts"] });
    expect(r.ok).toBe(true);
    expect(r.task.featureId).toBe("F-002");
  });

  it("createTicket：無 featureId 無檔案 → fallback 第一個 feature（不擋開單）", () => {
    const r = createTicket(root, { title: "t", description: "d" });
    expect(r.ok).toBe(true);
    expect(r.task.featureId).toBe("F-001");
  });

  it("createTicket：title/description 必填", () => {
    expect(createTicket(root, { title: "" }).ok).toBe(false);
    expect(createTicket(root, { title: "t", description: " " }).ok).toBe(false);
  });

  it("resolveFeatureForFiles：絕對路徑轉相對後命中", () => {
    expect(resolveFeatureForFiles(root, [join(root, "src/a.ts")])).toBe("F-001");
    expect(resolveFeatureForFiles(root, ["src/unknown.ts"])).toBeNull();
  });

  it("appendProgress 落檔 + getProgress 讀回", () => {
    seedTask(root);
    appendProgress(root, "TASK-100", { round: 1, agent: "developer", action: "dispatch", outcome: "✅ done" });
    const log = getProgress(root, "TASK-100");
    expect(log).toHaveLength(1);
    expect(log[0].agent).toBe("developer");
    expect(log[0].at).toBeTruthy();
  });

  it("appendProgress：上限 80 筆（保留前 10 + 最新）", () => {
    seedTask(root);
    for (let i = 1; i <= 90; i++) appendProgress(root, "TASK-100", { round: i, agent: "developer", action: "dispatch", outcome: `✅ r${i}` });
    const log = getProgress(root, "TASK-100");
    expect(log.length).toBeLessThanOrEqual(80);
    expect(log[0].outcome).toContain("r1"); // 前 10 保留
    expect(log[log.length - 1].outcome).toContain("r90");
  });

  it("buildTaskDigest：bug 統計 + pattern 計數 + progress 行", () => {
    const task = seedTask(root);
    appendProgress(root, "TASK-100", { round: 1, agent: "em", action: "open_ticket", ticketType: "bug", patternTag: "path", outcome: "🎫 開單" });
    appendProgress(root, "TASK-100", { round: 2, agent: "em", action: "open_ticket", ticketType: "bug", patternTag: "path", outcome: "🎫 開單" });
    appendProgress(root, "TASK-100", { round: 3, agent: "developer", action: "dispatch", outcome: "✅ ok", devRange: { short: "abc1234..def5678", log: [], stat: "1 file" } });
    const d = buildTaskDigest(loadTasksFile(root).tasks.find(t => t.id === "TASK-100"));
    expect(d.bugTicketsOpened).toBe(2);
    expect(d.bugPatterns.path).toBe(2);
    expect(d.lastDevRange.short).toBe("abc1234..def5678");
    expect(d.progress.length).toBe(3);
    expect(d.acceptance).toContain("功能可用");
  });

  it("hydrateFromProgress：developer 成功 → devNeedsQA=true；qa 後解除", () => {
    const task = seedTask(root);
    appendProgress(root, "TASK-100", { round: 1, agent: "developer", action: "dispatch", outcome: "✅ done", devRange: { short: "a..b", log: [], stat: "" } });
    let h = hydrateFromProgress(loadTasksFile(root).tasks.find(t => t.id === "TASK-100"));
    expect(h.devNeedsQA).toBe(true);
    expect(h.runs.developer).toBe(1);
    expect(h.lastDevRange.short).toBe("a..b");
    appendProgress(root, "TASK-100", { round: 2, agent: "qa", action: "dispatch", outcome: "✅ 通過" });
    h = hydrateFromProgress(loadTasksFile(root).tasks.find(t => t.id === "TASK-100"));
    expect(h.devNeedsQA).toBe(false);
  });

  it("柱二純函數：shouldForceQA / bugFuseVerdict / rootCauseVerdict", () => {
    expect(shouldForceQA({ devNeedsQA: true })).toBe(true);
    expect(shouldForceQA({ devNeedsQA: false })).toBe(false);
    expect(bugFuseVerdict({ bugCount: 0 }).fuse).toBe(false);
    expect(bugFuseVerdict({ bugCount: 1 }).fuse).toBe(false); // 第 2 張還能開
    expect(bugFuseVerdict({ bugCount: 2 }).fuse).toBe(true);  // 第 3 次打回 = 燒保險絲
    expect(bugFuseVerdict({ bugCount: 2 }).reason).toContain("3 次打回");
    expect(rootCauseVerdict({ patternTags: new Map([["path", 1]]) }).needsParent).toBe(false);
    expect(rootCauseVerdict({ patternTags: new Map([["path", 2]]) })).toEqual({ needsParent: true, pattern: "path" });
  });
});

// ══════════════════════════════════════════
// 柱二：em-orchestrator（decisionOverride 注入，不叫 LLM）
// ══════════════════════════════════════════

describe("柱二：em-orchestrator 工頭迴圈", () => {
  let root;
  beforeEach(() => { root = makeFixture(); });

  it("QA 鐵律：developer 成功後 complete 被攔 → 強制 dispatch qa → qa 過了才 complete", async () => {
    seedTask(root);
    const result = await orchestrateTask({
      rootDir: root, task: { id: "TASK-100", title: "測試任務", type: "dev", description: "d", spec: {} },
      baseUrl: "http://127.0.0.1:1", modelOverride: MODEL, fallbackModels: FALLBACKS,
      sendSSE: () => {}, maxLoops: 10,
      decisionOverride: seqDecisions([
        { action: "dispatch", agent: "developer", instruction: "做 A" },
        { action: "complete", summary: "提前想結案" },      // ← 鐵律攔下
        { action: "complete", summary: "QA 已過，結案" },   // ← 這次放行
      ]),
      _deps: { a2aCallAgent: OK_AGENT },
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("done");
    expect(result.chain).toEqual(["developer", "qa"]); // complete 被換成 qa
    const log = getProgress(root, "TASK-100");
    expect(log.some(e => e.action === "force_qa")).toBe(true);
  }, 30000);

  it("qa 指令自動帶 git 證據區塊（QA 看碼不是看自述）", async () => {
    seedTask(root);
    const calls = [];
    const spyAgent = async (_b, agent, prompt) => { calls.push({ agent, prompt }); return { success: true, content: "✅", usage: {} }; };
    await orchestrateTask({
      rootDir: root, task: { id: "TASK-100", title: "t", type: "dev", description: "d", spec: {} },
      baseUrl: "http://127.0.0.1:1", modelOverride: MODEL, fallbackModels: FALLBACKS,
      sendSSE: () => {}, maxLoops: 10,
      decisionOverride: seqDecisions([
        { action: "dispatch", agent: "developer", instruction: "做 A" },
        { action: "dispatch", agent: "qa", instruction: "QA 審查" },
        { action: "complete", summary: "ok" },
      ]),
      _deps: { a2aCallAgent: spyAgent },
    });
    const qaCall = calls.find(c => c.agent === "qa");
    expect(qaCall.prompt).toContain("程式證據"); // 程式附加的證據區塊
    // fixture 無 git → 證據顯示無新 commit，但區塊存在（機制在）
  }, 30000);

  it("open_ticket：bug 單落地 + 同 patternTag 第二張 → 治本 parent 單自動開", async () => {
    seedTask(root);
    const result = await orchestrateTask({
      rootDir: root, task: { id: "TASK-100", title: "t", type: "dev", description: "d", spec: {} },
      baseUrl: "http://127.0.0.1:1", modelOverride: MODEL, fallbackModels: FALLBACKS,
      sendSSE: () => {}, maxLoops: 10,
      decisionOverride: seqDecisions([
        { action: "open_ticket", title: "路徑炸了", description: "X 檔 path traversal", acceptance: "修復+測試", type: "bug", patternTag: "path-handling", affectedFiles: ["src/a.ts"] },
        { action: "open_ticket", title: "路徑又炸了", description: "Y 檔同款", acceptance: "修復", type: "bug", patternTag: "path-handling", affectedFiles: ["src/a.ts"] },
        { action: "escalate", reason: "結束測試" },
      ]),
      _deps: { a2aCallAgent: OK_AGENT },
    });
    expect(result.status).toBe("blocked"); // escalate 收尾（測試用）
    const { tasks } = loadTasksFile(root);
    const bugs = tasks.filter(t => (t.labels || []).includes("bug"));
    expect(bugs).toHaveLength(2);
    expect(bugs[0].title).toContain("[bug]");
    expect(bugs[0].parentId).toBe("TASK-100");
    const rootCause = tasks.find(t => (t.labels || []).includes("root-cause"));
    expect(rootCause).toBeTruthy();
    expect(rootCause.title).toContain("治本");
    expect(rootCause.title).toContain("path-handling");
  }, 30000);

  it("bug 保險絲：第 3 張 bug 單前攔下 → blocked 升級人類（帶證據鏈）", async () => {
    seedTask(root);
    const result = await orchestrateTask({
      rootDir: root, task: { id: "TASK-100", title: "t", type: "dev", description: "d", spec: {} },
      baseUrl: "http://127.0.0.1:1", modelOverride: MODEL, fallbackModels: FALLBACKS,
      sendSSE: () => {}, maxLoops: 10,
      decisionOverride: seqDecisions([
        { action: "open_ticket", title: "b1", description: "d", type: "bug", patternTag: "p1" },
        { action: "open_ticket", title: "b2", description: "d", type: "bug", patternTag: "p1" },
        { action: "open_ticket", title: "b3", description: "d", type: "bug", patternTag: "p1" }, // ← fuse
      ]),
      _deps: { a2aCallAgent: OK_AGENT },
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.escalateReason).toContain("保險絲");
    const { tasks } = loadTasksFile(root);
    expect(tasks.filter(t => (t.labels || []).includes("bug"))).toHaveLength(2); // 第 3 張沒開成
  }, 30000);

  it("complete 自動結案 orchestration 開的 bug 單", async () => {
    seedTask(root);
    await orchestrateTask({
      rootDir: root, task: { id: "TASK-100", title: "t", type: "dev", description: "d", spec: {} },
      baseUrl: "http://127.0.0.1:1", modelOverride: MODEL, fallbackModels: FALLBACKS,
      sendSSE: () => {}, maxLoops: 10,
      decisionOverride: seqDecisions([
        { action: "dispatch", agent: "developer", instruction: "做" },
        { action: "dispatch", agent: "qa", instruction: "QA", },
        { action: "open_ticket", title: "bug found", description: "d", type: "bug", patternTag: "x" },
        { action: "dispatch", agent: "developer", instruction: "修 bug" },
        { action: "dispatch", agent: "qa", instruction: "回歸" },
        { action: "complete", summary: "全過" },
      ]),
      _deps: { a2aCallAgent: OK_AGENT },
    });
    const { tasks } = loadTasksFile(root);
    const bug = tasks.find(t => (t.labels || []).includes("bug"));
    expect(bug.status).toBe("close");
    expect(bug.resolvedAt).toBeTruthy();
  }, 30000);

  it("resumable：progressLog 有 developer 成功紀錄 → 新一輪 complete 仍被鐵律攔下", async () => {
    seedTask(root);
    // 模擬上一輪掛掉前的紀錄
    appendProgress(root, "TASK-100", { round: 1, agent: "developer", action: "dispatch", outcome: "✅ done", devRange: { short: "a..b", log: [], stat: "" } });
    const result = await orchestrateTask({
      rootDir: root, task: { id: "TASK-100", title: "t", type: "dev", description: "d", spec: {} },
      baseUrl: "http://127.0.0.1:1", modelOverride: MODEL, fallbackModels: FALLBACKS,
      sendSSE: () => {}, maxLoops: 10,
      decisionOverride: seqDecisions([
        { action: "complete", summary: "上輪做完想結案" }, // ← hydrate 恢復 devNeedsQA → 攔
        { action: "complete", summary: "QA 過了" },
      ]),
      _deps: { a2aCallAgent: OK_AGENT },
    });
    expect(result.ok).toBe(true);
    expect(result.chain).toEqual(["qa"]); // 第一個決策被換成 qa
  }, 30000);
});

// ══════════════════════════════════════════
// 柱三：em-job-entrypoints
// ══════════════════════════════════════════

describe("柱三：em-job-entrypoints", () => {
  let root;
  beforeEach(() => { root = makeFixture(); });

  it("未知 type → ok:false", async () => {
    const r = await runJobEntrypoint(root, "no-such");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("未知");
  });

  it("security-fix：掃描不存在 → needsRescan finding", async () => {
    const r = await runJobEntrypoint(root, "security-fix");
    expect(r.ok).toBe(true);
    expect(r.meta.needsRescan).toBe(true);
    expect(r.findings[0].kind).toBe("security-scan-stale");
  });

  it("security-fix：findings 按 severity×檔案分組（ERROR 先）", async () => {
    writeFileSync(join(root, ".paaw", "security", "scan-results.json"), JSON.stringify({
      findings: [
        { severity: "WARNING", file: join(root, "src/a.ts"), line: 1, cwe: ["CWE-22: x"], message: "w1" },
        { severity: "ERROR", file: join(root, "src/b.ts"), line: 2, cwe: ["CWE-89: y"], message: "e1" },
        { severity: "INFO", file: join(root, "src/c.ts"), line: 3, cwe: [], message: "i-ignored" },
      ],
    }));
    const r = await runJobEntrypoint(root, "security-fix");
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(2); // INFO 不開單
    expect(r.findings[0].file).toBe("src/b.ts"); // ERROR 排前
    expect(r.findings[0].error).toBe(1);
    expect(r.findings[1].warning).toBe(1);
  });

  it("test-gen：coverageGaps 取 functionCount 前幾大", async () => {
    writeFileSync(join(root, ".paaw", "code-intelligence", "test-intelligence.json"), JSON.stringify({
      coverageGaps: [
        { file: "src/small.ts", functionCount: 3 },
        { file: "src/big.ts", functionCount: 40, exportCount: 12 },
        { file: "src/mid.ts", functionCount: 10 },
      ],
      stats: { totalTestFiles: 5, coverageRate: "10%", coverageGapFiles: 3 },
    }));
    const r = await runJobEntrypoint(root, "test-gen");
    expect(r.ok).toBe(true);
    expect(r.findings[0].file).toBe("src/big.ts");
    expect(r.summary).toContain("10%");
  });

  it("cu-scan：feature 缺測試/文件 findings（skip 重掃）", async () => {
    const r = await runJobEntrypoint(root, "cu-scan", { runRescan: false });
    expect(r.ok).toBe(true);
    expect(r.meta.activeFeatures).toBe(2); // planned 不算
    expect(r.findings.some(f => f.kind === "feature-no-tests" && f.featureId === "F-001")).toBe(true);
    expect(r.findings.some(f => f.kind === "feature-no-docs" && f.featureId === "F-001")).toBe(true);
    expect(r.findings.some(f => f.featureId === "F-002")).toBe(false); // Beta 齊全
  });

  it("release-prep：無 RR → no-active-rr finding", async () => {
    seedTask(root);
    const r = await runJobEntrypoint(root, "release-prep");
    expect(r.ok).toBe(true);
    expect(r.findings.some(f => f.kind === "no-active-rr")).toBe(true);
    expect(r.findings.some(f => f.kind === "open-tasks")).toBe(true);
  });

  it("triageToTickets：dryRun 不寫檔；run 寫檔 + dedupe 防重開", async () => {
    const result = { ok: true, summary: "s", findings: [{ kind: "security-fix-group", file: "a.ts", error: 1 }] };
    const llm = async () => ([{ title: "修 a.ts", description: "d", acceptance: "a", type: "dev", priority: "high", dedupeKey: "sec:a.ts" }]);

    const prev = await triageToTickets({ rootDir: root, type: "security-fix", result, _llmCall: llm, dryRun: true, sendSSE: () => {} });
    expect(prev.tickets).toHaveLength(1);
    expect(loadTasksFile(root).tasks).toHaveLength(0); // dry-run 沒寫檔

    const run1 = await triageToTickets({ rootDir: root, type: "security-fix", result, _llmCall: llm, sendSSE: () => {} });
    expect(run1.tickets).toHaveLength(1);
    const created = run1.tickets[0];
    expect(created.labels).toContain("entry:security-fix");

    // 再跑一次同 dedupeKey → 跳過
    const run2 = await triageToTickets({ rootDir: root, type: "security-fix", result, _llmCall: llm, sendSSE: () => {} });
    expect(run2.tickets).toHaveLength(0);
    expect(run2.skipped).toBe(1);
  });

  it("triageToTickets：entrypoint 失敗 → ok:false 不炸", async () => {
    const r = await triageToTickets({ rootDir: root, type: "security-fix", result: { ok: false, error: "boom" }, sendSSE: () => {} });
    expect(r.ok).toBe(false);
  });

  it("readJobTypesConfig：讀 config jobTypes + 過濾非法值", async () => {
    writeFileSync(join(root, ".paaw", "auto-dispatch", "config.json"), JSON.stringify({ jobTypes: ["cu-scan", "hacked"] }));
    expect(readJobTypesConfig(root)).toEqual(["cu-scan"]);
    const root2 = makeFixture();
    expect(readJobTypesConfig(root2)).toEqual([]); // 無 config
  });
});
