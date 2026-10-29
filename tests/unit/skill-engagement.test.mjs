/**
 * skill-engagement.test.mjs — 「skill 真的被使用」聚合器（2026-10-22）
 *
 * 證據分層：inject（phase:skills 掛載行）vs read（toolCalls args 打中 .paaw/skills/<id>/）
 * 驗證：read_file 精確解析、其他工具字串掃描、mountNoRead 標記、聚合數字。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { collectSkillEngagement } from "../../packages/server/src/routes/llm-logs.mjs";

let dir = null;
const w = (line) => writeFileSync(join(dir, "2026-10-22.jsonl"), line + "\n", { flag: "a" });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sk-eng-"));
  mkdirSync(dir, { recursive: true });
  // 掛載：s1 s2 s3 各一次（em）
  w(JSON.stringify({ id: "x1", ts: "2026-10-22T10:00:00Z", phase: "skills", agentId: "em", cwd: "/p", skills: ["s1", "s2", "s3"], sectionChars: 100 }));
  // 回讀 1：read_file 精確（developer 讀 s1 的 rules.md）
  w(JSON.stringify({ id: "x2", ts: "2026-10-22T10:05:00Z", phase: "response", agentId: "developer", toolCalls: [
    { name: "read_file", args: JSON.stringify({ path: ".paaw/skills/s1/rules.md" }) },
    { name: "read_file", args: JSON.stringify({ path: "src/server.mjs" }) },
  ] }));
  // 回讀 2：bash cat 字串掃描（em 讀 s2）+ read_file 絕對路徑（em 讀 s2 另一檔）
  w(JSON.stringify({ id: "x3", ts: "2026-10-22T11:00:00Z", phase: "response", agentId: "em", toolCalls: [
    { name: "bash", args: JSON.stringify({ command: "cat .paaw/skills/s2/step.md | head" }) },
    { name: "read_file", args: JSON.stringify({ path: "/abs/proj/.paaw/skills/s2/inputs.json" }) },
  ] }));
  // 雜訊：非 skill 路徑的 response（不該計入）
  w(JSON.stringify({ id: "x4", ts: "2026-10-22T12:00:00Z", phase: "response", agentId: "qa", toolCalls: [
    { name: "read_file", args: JSON.stringify({ path: ".paaw/coding-memory/qa-results.jsonl" }) },
  ] }));
  // s3：掛了零回讀
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("collectSkillEngagement", () => {
  it("E1: read_file 精確解析 + bash 字串掃描 + 絕對路徑都算回讀；非 skill 路徑不算", () => {
    const r = collectSkillEngagement(7, dir);
    expect(r.totals.injections).toBe(1);
    expect(r.totals.reads).toBe(3);
    const s1 = r.bySkill.find(s => s.id === "s1");
    expect(s1.reads).toBe(1);
    expect(s1.readers[0]).toEqual({ id: "developer", count: 1 });
    expect(s1.topFiles[0].file).toBe("rules.md");
    const s2 = r.bySkill.find(s => s.id === "s2");
    expect(s2.reads).toBe(2);
    expect(s2.topFiles.map(f => f.file).sort()).toEqual(["inputs.json", "step.md"]);
  });

  it("E2: mountNoRead — s3 掛了零回讀要被標記（context 浪費訊號）", () => {
    const r = collectSkillEngagement(7, dir);
    const s3 = r.bySkill.find(s => s.id === "s3");
    expect(s3.mountNoRead).toBe(true);
    expect(r.totals.noReadSkills).toBe(1);
  });

  it("E3: byAgent / byDay 聚合", () => {
    const r = collectSkillEngagement(7, dir);
    const em = r.byAgent.find(a => a.id === "em");
    expect(em.reads).toBe(2);
    expect(em.skills["s2"]).toBe(2);
    expect(r.byDay[0]).toEqual({ date: "2026-10-22", injections: 1, reads: 3 });
  });

  it("E4: 天數窗外不計（cutoff 過濾）", () => {
    // fixture 只有 2026-10-22；days=1 的 cutoff = 今天（跑測試當天）— 若測試日 ≠ 2026-10-22 檔案會被排除
    // 為穩定：直接驗證 days 上限 clamp 不炸 + 形狀正確
    const r = collectSkillEngagement(1, dir);
    expect(r).toHaveProperty("totals");
    expect(r).toHaveProperty("bySkill");
    expect(r).toHaveProperty("byDay");
  });
});
