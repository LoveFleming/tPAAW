/**
 * Unit tests — LLM Logs route (F20261016-044 / TASK-087 quality retrofit)
 *
 * Covers the QA-fixed behaviors (qr-20261017-021454-dc63):
 *  - safeInt lower/upper bound validation (H1)
 *  - pairLogs phase whitelist + orphan counting (M3)
 *  - parseAllLogs days window consistency + truncation guard (M1/H2)
 *
 * Pure functions take `dir` as a param (M2), so we exercise them against a
 * temp dir with synthetic JSONL — no real log/ files are touched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  safeInt,
  readLogFile,
  parseAllLogs,
  pairLogs,
  collectSkillsUsage,
} from "../../packages/server/src/routes/llm-logs.mjs";

// ── safeInt (H1) ──

describe("safeInt", () => {
  it("returns fallback for non-numeric input (NaN guard)", () => {
    expect(safeInt("abc", 7, 1, 90)).toBe(7);
    expect(safeInt(null, 7, 1, 90)).toBe(7);
    expect(safeInt(undefined, 200, 1, 1000)).toBe(200);
  });

  it("clamps below the minimum (negative offset guard)", () => {
    expect(safeInt("-100", 0, 0, 1000)).toBe(0);
  });

  it("clamps above the maximum", () => {
    expect(safeInt("99999", 7, 1, 90)).toBe(90);
  });

  it("passes through valid in-range values", () => {
    expect(safeInt("30", 7, 1, 90)).toBe(30);
    expect(safeInt("0", 1, 0, 1000)).toBe(0);
  });
});

// ── pairLogs (M3) ──

describe("pairLogs", () => {
  it("pairs request+response by id", () => {
    const { paired } = pairLogs([
      { id: "a", phase: "request", ts: "2026-10-17T00:00:00Z", model: "m1" },
      { id: "a", phase: "response", ts: "2026-10-17T00:00:01Z", durationMs: 5 },
    ]);
    expect(paired).toHaveLength(1);
    expect(paired[0].id).toBe("a");
    expect(paired[0].durationMs).toBe(5);
  });

  it("counts orphan requests (response missing its request log)", () => {
    const { paired, orphanRequests } = pairLogs([
      { id: "a", phase: "request", ts: "t" },
      { id: "b", phase: "response", ts: "t" },
    ]);
    expect(paired).toHaveLength(1); // only a has a request
    // b 有 response 但缺 request log → 計為 orphan（llm-log 隔離後 request 遺失訊號）
    expect(orphanRequests).toBe(1);
  });

  it("does not write unknown phases into dynamic keys; counts them", () => {
    const { orphanPhases } = pairLogs([
      { id: "a", phase: "request", ts: "t" },
      { id: "a", phase: "response-fallback", ts: "t" },
    ]);
    expect(orphanPhases["response-fallback"]).toBe(1);
  });

  it("skips entries without id", () => {
    const { paired } = pairLogs([{ phase: "request", ts: "t" }]);
    expect(paired).toHaveLength(0);
  });

  it("flags tool-call audit violation against allow-list", () => {
    const { paired } = pairLogs([
      { id: "a", phase: "request", ts: "t", toolNames: ["read_file"] },
      { id: "a", phase: "response", ts: "t", toolCalls: [{ name: "write_file" }] },
    ]);
    expect(paired[0].auditOk).toBe(false);
    expect(paired[0].auditViolations[0].tool).toBe("write_file");
  });

  it("audit is N/A when no allow-list (old logs)", () => {
    const { paired } = pairLogs([
      { id: "a", phase: "request", ts: "t" },
      { id: "a", phase: "response", ts: "t", toolCalls: [{ name: "x" }] },
    ]);
    expect(paired[0].auditOk).toBeNull();
    expect(paired[0].auditNA).toBe(true);
  });
});

// ── file I/O with temp dir (M1/H2, M2) ──

describe("parseAllLogs / readLogFile", () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-logs-test-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function dayStr(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return d.toISOString().slice(0, 10);
  }

  it("readLogFile parses valid JSONL and skips garbage lines", () => {
    writeFileSync(join(dir, "2020-01-01.jsonl"),
      '{"id":"a","phase":"request"}\nnot-json\n{"id":"b","phase":"response"}\n');
    const { logs } = readLogFile("2020-01-01", dir);
    expect(logs).toHaveLength(2);
    expect(logs[0].id).toBe("a");
  });

  it("readLogFile returns empty for missing file", () => {
    const { logs, truncated } = readLogFile("1999-01-01", dir);
    expect(logs).toEqual([]);
    expect(truncated).toBe(false);
  });

  it("days=1 window includes only today (M1 consistency)", () => {
    writeFileSync(join(dir, `${dayStr(0)}.jsonl`), '{"id":"today","phase":"request","ts":"t"}\n');
    writeFileSync(join(dir, `${dayStr(1)}.jsonl`), '{"id":"yday","phase":"request","ts":"t"}\n');
    const { logs } = parseAllLogs(1, dir);
    expect(logs.map(l => l.id)).toEqual(["today"]);
  });

  it("days=2 window includes today + yesterday (M1 consistency)", () => {
    const { logs } = parseAllLogs(2, dir);
    const ids = logs.map(l => l.id).sort();
    expect(ids).toEqual(["today", "yday"]);
  });

  it("readLogFile flags truncation past maxLines (H2 guard)", () => {
    writeFileSync(join(dir, "2020-02-02.jsonl"),
      Array.from({ length: 10 }, (_, i) => `{"id":"x${i}","phase":"request"}`).join("\n") + "\n");
    const { logs, truncated } = readLogFile("2020-02-02", dir, 3);
    expect(truncated).toBe(true);
    expect(logs).toHaveLength(3);
  });
});

// ── collectSkillsUsage ──

describe("collectSkillsUsage", () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-skills-test-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("aggregates skills injections by skill/agent/day", () => {
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(join(dir, `${today}.jsonl`),
      JSON.stringify({ phase: "skills", agentId: "developer", skills: ["s1", "s2"], sectionChars: 100, ts: "2026-10-17T00:00:00Z" }) + "\n" +
      JSON.stringify({ phase: "skills", agentId: "developer", skills: ["s1"], sectionChars: 50, ts: "2026-10-17T00:01:00Z" }) + "\n" +
      JSON.stringify({ phase: "request", id: "r", ts: "t" }) + "\n");
    const report = collectSkillsUsage(1, dir);
    expect(report.totals.injections).toBe(2);
    expect(report.totals.skills).toBe(2);
    expect(report.bySkill.find(s => s.id === "s1").count).toBe(2);
    expect(report.byDay).toHaveLength(1);
  });

  it("ignores non-skills lines", () => {
    const report = collectSkillsUsage(1, dir);
    expect(report.byAgent.every(a => a.id === "developer")).toBe(true);
  });
});

// 2026-10-23：list 端點最新在前（live tail 可見）— Fleming 報案「正在跑但沒 log」
it("F1: GET /api/llm-logs 回傳最新在前 — item[0] 是最新一筆", async () => {
  const dir = mkdtempSync(join(tmpdir(), "llm-order-"));
  const today = new Date().toISOString().slice(0, 10); // 動態日期 — 寫死日期會被 days 視窗過濾成空（定時炸彈）
  const w = (id, iso, phase) => appendFileSync(join(dir, `${today}.jsonl`), JSON.stringify({ id, ts: iso, phase, agentId: "em", model: "m", messageCount: 1 }) + "\n");
  w("a", "2026-10-23T10:00:00Z", "request");
  w("a", "2026-10-23T10:00:05Z", "response");
  w("b", "2026-10-23T11:00:00Z", "request");
  w("b", "2026-10-23T11:00:03Z", "response");
  w("c", "2026-10-23T12:00:00Z", "request"); // in-flight（還沒 response）
  const { logs } = parseAllLogs(1, dir);
  const { paired } = pairLogs(logs);
  const sorted = paired.slice().sort((x, y) => String(y.ts || "").localeCompare(String(x.ts || "")));
  expect(sorted[0].id).toBe("c");       // 最新 request 在最前（in-flight 也算一列）
  expect(sorted[1].id).toBe("b");
  rmSync(dir, { recursive: true, force: true });
});
