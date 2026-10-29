/**
 * test-report-reader — 真實 report 讀取（2026-10-10 21:14 Fleming）
 * 找不到就顯示沒有 — 驗證 parse 正確 + 空專案 found=0。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTestReports, findTestReports, testReportSummary, mergeCoverage } from "../../packages/server/src/lib/test-report-reader.mjs";

let dir, emptyDir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "trr-"));
  emptyDir = mkdtempSync(join(tmpdir(), "trr-empty-"));
  // istanbul coverage-summary
  mkdirSync(join(dir, "coverage"), { recursive: true });
  writeFileSync(join(dir, "coverage", "coverage-summary.json"), JSON.stringify({
    total: { lines: { pct: 84.2 } },
    [`${dir}/src/a.ts`]: { lines: { pct: 100 } },
  }));
  // jacoco xml
  mkdirSync(join(dir, "target/site/jacoco"), { recursive: true });
  writeFileSync(join(dir, "target/site/jacoco/jacoco.xml"), `<report name="x"><package name="p"><counter type="LINE" missed="20" covered="80"/></package><counter type="LINE" missed="30" covered="170"/></report>`);
  // junit xml
  mkdirSync(join(dir, "build/test-results/test"), { recursive: true });
  writeFileSync(join(dir, "build/test-results/test/TEST-x.xml"), `<testsuites><testsuite tests="12" failures="2" errors="1" skipped="1"></testsuite></testsuites>`);
  // playwright json
  writeFileSync(join(dir, "e2e-results.json"), JSON.stringify({
    suites: [{ title: "login", specs: [{ title: "ok", tests: [{ results: [{ status: "passed" }] }] }, { title: "bad", tests: [{ results: [{ status: "failed" }] }] }] }],
  }));
  // cobertura xml（Python coverage.py / Rust）
  writeFileSync(join(dir, "coverage.xml"), `<coverage line-rate="0.87" version="7"><packages><package name="app"><classes><class filename="app/main.py" line-rate="0.9"></class></classes></package></packages></coverage>`);
  // go coverprofile
  writeFileSync(join(dir, "coverage.out"), `mode: atomic
app/a.go:3.14,5.2 3 1
app/a.go:8.1,9.5 2 0
app/b.go:1.1,2.2 5 5\n`);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); rmSync(emptyDir, { recursive: true, force: true }); });

describe("test-report-reader", () => {
  it("空專案 → 找不到 report（誠實顯示無）", () => {
    expect(findTestReports(emptyDir)).toEqual([]);
    expect(readTestReports(emptyDir)).toEqual([]);
    const sum = testReportSummary(emptyDir);
    expect(sum.found).toBe(0);
  });

  it("istanbul coverage-summary → totalLinePct + per-file", () => {
    const r = readTestReports(dir).find(x => x.runner.includes("istanbul"));
    expect(r.totalLinePct).toBe(84.2);
    expect(r.fileCoverage["src/a.ts"]).toBe(100);
  });

  it("jacoco xml → 取最大 counter（報告總計）", () => {
    const r = readTestReports(dir).find(x => x.runner === "jacoco");
    expect(r.linesCovered).toBe(170);
    expect(r.linesMissed).toBe(30);
    expect(r.totalLinePct).toBe(85); // 170/200
  });

  it("junit xml → tests/failures/errors/skipped", () => {
    const r = readTestReports(dir).find(x => x.runner === "junit");
    expect(r.total).toBe(12);
    expect(r.failed).toBe(3); // failures 2 + errors 1
    expect(r.skipped).toBe(1);
    expect(r.passed).toBe(8);
  });

  it("playwright json → passed/failed", () => {
    const r = readTestReports(dir).find(x => x.runner === "playwright");
    expect(r.total).toBe(2);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
  });

  it("cobertura xml（Python/Rust）→ line-rate + per-file", () => {
    const r = readTestReports(dir).find(x => x.runner === "cobertura");
    expect(r.totalLinePct).toBe(87);
    expect(r.fileCoverage["app/main.py"]).toBe(90);
  });

  it("go coverprofile → statement 覆蓋率", () => {
    const r = readTestReports(dir).find(x => x.runner === "go");
    // app/a.go: 3 stmts covered + 2 not = 3/5; app/b.go: 5/5
    expect(r.fileCoverage["app/a.go"]).toBe(60);
    expect(r.fileCoverage["app/b.go"]).toBe(100);
    expect(r.totalLinePct).toBe(80); // covered 8 / total 10
  });

  it("summary 分段（coverage/e2e/unit）", () => {
    const sum = testReportSummary(dir);
    expect(sum.found).toBeGreaterThanOrEqual(4);
    expect(sum.coverage.length).toBeGreaterThanOrEqual(2); // istanbul + jacoco
    expect(sum.unit.length).toBeGreaterThanOrEqual(1);
    expect(sum.e2e.length).toBeGreaterThanOrEqual(1);
  });

  it("壞檔不炸整批（1 個壞 report，其他照讀）", () => {
    const d2 = mkdtempSync(join(tmpdir(), "trr-bad-"));
    mkdirSync(join(d2, "coverage"), { recursive: true });
    writeFileSync(join(d2, "coverage", "coverage-summary.json"), "{ not json");
    mkdirSync(join(d2, "build/test-results/test"), { recursive: true });
    writeFileSync(join(d2, "build/test-results/test/TEST-ok.xml"), `<testsuite tests="3" failures="0" errors="0" skipped="0"/>`);
    const reps = readTestReports(d2);
    expect(reps.length).toBe(1); // 壞的 istanbul 跳過，junit 成功
    expect(reps[0].runner).toBe("junit");
    rmSync(d2, { recursive: true, force: true });
  });
});

// ── 2026-10-22：前後端混合 RU — 深掃 + 行數加權合併 ──
describe("mergeCoverage + 深掃（前後端混合 RU）", () => {
  let mixDir;
  beforeAll(() => {
    mixDir = mkdtempSync(join(tmpdir(), "trr-mix-"));
    // 前端：web/coverage/coverage-summary.json（istanbul 帶絕對行數）80% × 100 行
    mkdirSync(join(mixDir, "web/coverage"), { recursive: true });
    writeFileSync(join(mixDir, "web/coverage/coverage-summary.json"), JSON.stringify({
      total: { lines: { pct: 80, covered: 80, total: 100 } },
      [`${mixDir}/web/src/a.tsx`]: { lines: { pct: 80 } },
    }));
    // 後端：server/target/site/jacoco/jacoco.xml 40% × 1000 行
    mkdirSync(join(mixDir, "server/target/site/jacoco"), { recursive: true });
    writeFileSync(join(mixDir, "server/target/site/jacoco/jacoco.xml"),
      `<report><package><counter type="LINE" missed="600" covered="400"/></package></report>`);
  });
  afterAll(() => rmSync(mixDir, { recursive: true, force: true }));

  it("深掃找到子目錄的前後端兩份 coverage", () => {
    const found = findTestReports(mixDir);
    const rels = found.map(f => f.file).sort();
    expect(rels).toContain("server/target/site/jacoco/jacoco.xml");
    expect(rels).toContain("web/coverage/coverage-summary.json");
  });

  it("mergeCoverage：行數加權合併（不是平均）— (80+400)/(100+1000) = 43.6%", () => {
    const sum = testReportSummary(mixDir);
    const m = sum.mergedCoverage;
    expect(m.merged).toBe(true);
    expect(m.totalLinePct).toBe(43.6);
    expect(m.linesCovered).toBe(480);
    expect(m.linesTotal).toBe(1100);
    expect(m.sources.length).toBe(2);
  });

  it("單份 coverage → merged:false 原值", () => {
    const one = [{ kind: "coverage", runner: "x", at: "t", totalLinePct: 55.5, linesCovered: 111, linesTotal: 200 }];
    const m = mergeCoverage(one);
    expect(m.merged).toBe(false);
    expect(m.totalLinePct).toBe(55.5);
  });

  it("多份但缺絕對行數 → 不合併（誠實 fallback 最高一份 + 全 sources）", () => {
    const m = mergeCoverage([
      { kind: "coverage", runner: "a", at: "t1", totalLinePct: 30 },
      { kind: "coverage", runner: "b", at: "t2", totalLinePct: 90 },
    ]);
    expect(m.merged).toBe(false);
    expect(m.totalLinePct).toBe(90);
    expect(m.sources.length).toBe(2);
  });
});
