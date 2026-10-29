/**
 * Unit tests — test-runner 覆蓋率旗標（2026-10-27 Fleming：vitest or jest 都要抓得到行覆蓋率）
 *
 * 鎖三件事：
 *   1. vitest + @vitest/coverage-v8 → cmd 帶 --coverage（json-summary → coverage/coverage-summary.json）
 *   2. vitest 缺 @vitest/coverage-v8 → 不帶（帶了會炸「coverage provider not found」）
 *   3. jest（內建 istanbul 免裝套件）→ cmd 永遠帶 --coverage + json-summary
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detectTestGroups, startTestRun, getRunState } from "../../packages/server/src/lib/test-runner.mjs";
import { testReportSummary } from "../../packages/server/src/lib/test-report-reader.mjs";
import { writeFileSync, readdirSync, readFileSync } from "fs";

let dir;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "tr-cov-")); });
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp */ } });

function fixture(pkg) {
  const p = join(dir, `f-${Math.random().toString(36).slice(2)}`);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "package.json"), JSON.stringify(pkg, null, 2));
  return p;
}

describe("detectTestGroups — coverage 旗標", () => {
  it("vitest + @vitest/coverage-v8 → 帶 --coverage + json-summary reporter", () => {
    const p = fixture({
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "^4.1.9", "@vitest/coverage-v8": "^4.1.9" },
    });
    const g = detectTestGroups(p);
    const vit = g.find(x => x.runner === "vitest");
    expect(vit, "vitest group 應被偵測").toBeTruthy();
    expect(vit.cmd.join(" ")).toContain("--coverage");
    expect(vit.cmd.join(" ")).toContain("--coverage.reporter=json-summary");
    expect(vit.cmd.join(" ")).toContain("--coverage.reportOnFailure=true");
  });

  it("vitest 缺 @vitest/coverage-v8 → 不帶 --coverage（帶了會 provider not found 炸）", () => {
    const p = fixture({
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "^4.1.9" },
    });
    const vit = detectTestGroups(p).find(x => x.runner === "vitest");
    expect(vit).toBeTruthy();
    expect(vit.cmd.join(" ")).not.toContain("--coverage");
  });

  it("jest（免裝套件，內建 istanbul）→ 帶 --coverage + json-summary + coverageDirectory", () => {
    const p = fixture({
      scripts: { test: "jest" },
      devDependencies: { jest: "^29.7.0" },
    });
    const j = detectTestGroups(p).find(x => x.runner === "jest");
    expect(j, "jest group 應被偵測").toBeTruthy();
    const cmd = j.cmd.join(" ");
    expect(cmd).toContain("--coverage");
    expect(cmd).toContain("--coverageReporters=json-summary");
    expect(cmd).toContain("--coverageDirectory=coverage");
    // json 結果檔照舊（runGroup 解析 passed/failed 用）
    expect(cmd).toContain("--outputFile=.paaw/test-runs/.jest.json");
  });

  it("非 node 專案 → 空 groups（不炸）", () => {
    const g = detectTestGroups(dir);
    expect(Array.isArray(g)).toBe(true);
  });

  it("go 專案（go.mod）→ 帶 -coverprofile=coverage.out（reader go-cover 慣例路徑）", () => {
    const p = fixture({ name: "go-demo", private: true }); // go 偵測看 go.mod 不看 package.json
    writeFileSync(join(p, "go.mod"), "module demo\n\ngo 1.22\n");
    const g = detectTestGroups(p).find(x => x.runner === "go");
    expect(g, "go group 應被偵測").toBeTruthy();
    expect(g.cmd.join(" ")).toContain("-coverprofile=coverage.out");
  });

  it("reader 全鏈：go coverprofile（標準格式）→ coverage measured + statement 行覆蓋", () => {
    const p = fixture({ name: "go-cover-demo", private: true });
    // 標準 go coverprofile：mode 行 + file:start.end numStmt count（4 stmt 覆 3 → 75%）
    writeFileSync(join(p, "coverage.out"), [
      "mode: set",
      "demo/math.go:10.13,12.2 2 1",
      "demo/math.go:14.13,16.2 1 0",
      "demo/util.go:3.20,5.2 1 1",
      "",
    ].join("\n"));
    const tr = testReportSummary(p);
    expect(tr.found).toBeGreaterThanOrEqual(1);
    const cov = tr.mergedCoverage;
    expect(cov, "mergedCoverage 應存在").toBeTruthy();
    expect(cov.totalLinePct).toBe(75);
    expect(cov.linesCovered).toBe(3);
    expect(cov.linesTotal).toBe(4);
  });
});

describe("startTestRun — commit 後自動重跑（pendingReRun 合併突发）", () => {
  it("跑中途再請求 → requeued；跑完自動補跑一次（runs/ 出現兩筆）", async () => {
    const p = fixture({
      name: "slow-demo",
      private: true,
      // sh-safe 目 slow script：-e 的程式碼必須引號包住（裸 () 會被 sh -c 當 subshell 語法炸 — 2026-10-27 假綠教訓）
      scripts: { test: 'node -e "setTimeout(()=>process.exit(0),1500)"' },
    });
    const r1 = await startTestRun(p);
    expect(r1.started).toBe(true);
    // 跑途中再達請求（模擬 commit 落地後的自動重跑請求）→ 不重跌，掛 pendingReRun
    const r2 = await startTestRun(p);
    expect(r2.alreadyRunning, "第一輪至少 1.5s，此時必在跑").toBe(true);
    expect(r2.requeued).toBe(true);
    // 等第一輪 + 補跑輪結束（runs/ 兩筆 RUN-*.json 且都 pass）
    const t0 = Date.now();
    let files = [];
    while (Date.now() - t0 < 20000) {
      await new Promise(r => setTimeout(r, 500));
      try { files = readdirSync(join(p, ".paaw/test-runs/runs")).filter(f => /^RUN-.*\.json$/.test(f)); } catch { /* 尚未建 */ }
      if (files.length >= 2 && !getRunState(p)) break;
    }
    expect(files.length, `應補跑出第二筆（實際 ${files.length}）`).toBeGreaterThanOrEqual(2);
    const last = JSON.parse(readFileSync(join(p, ".paaw/test-runs/last.json"), "utf-8"));
    expect(last.status, "慢 script 端 exit 0，補跑輪應 pass").toBe("pass");
  }, 25000);
});
