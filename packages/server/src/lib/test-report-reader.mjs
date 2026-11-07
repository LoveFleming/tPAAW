/**
 * test-report-reader — 真實測試 report 讀取器（2026-10-10 21:14 Fleming）
 *
 * > 「像 java 就要讀 jacoco unit test report, or 找到 playwright e2e report 的
 * > result 來看。找沒有就顯示沒有，不要用亂編的答案」
 *
 * No answer without evidence — coverage/測試狀態只信工具真實產出，
 * 啟發式推測永不冒充事實。找不到 report = 誠實顯示「無」。
 *
 * 支援格式（per-language/per-runner 標準輸出）：
 *   JS/TS    coverage/coverage-summary.json（istanbul — vitest/jest --coverage 標準落地）
 *   JS/TS    coverage/lcov.info（lcov — 广泛通用）
 *   e2e      Playwright JSON（--reporter=json 落地 or playwright-report/*.json）
 *   Java     JaCoCo XML（target/site/jacoco/jacoco.xml、根目錄 jacoco*.xml — Maven/Gradle）
 *   Java/通用 JUnit XML（TEST-*.xml — surefire/gradle test；pytest 也能出）
 *   Python   Cobertura XML（coverage.py 的 coverage.xml）+ JUnit XML（pytest --junitxml）
 *   Go       原生 coverprofile（go test -coverprofile=coverage.out）+ JUnit XML（go-junit-report）
 *   Rust     Cobertura XML（tarpaulin/llvm-cov）+ JUnit XML（cargo-nextest）+ LCOV（llvm-cov）
 *
 * 全部 deterministic、只讀不寫、每源獨立 try/catch（一個壞檔不擋其他）。
 */

import { existsSync, readFileSync, statSync, readdirSync } from "fs";
import { join, relative } from "path";

const MAX_XML_BYTES = 20 * 1024 * 1024; // 單檔 20MB cap（jacoco 大專案可達數 MB）

// ── 標準 report 路徑偵測（照慣例，不含 node_modules）──
const CANDIDATES = [
  // Istanbul/vitest/jest coverage
  { kind: "coverage-summary", file: "coverage/coverage-summary.json", runner: "vitest/jest" },
  { kind: "lcov", file: "coverage/lcov.info", runner: "vitest/jest" },
  { kind: "coverage-summary", file: "packages/ui/coverage/coverage-summary.json", runner: "jest" },
  // Playwright
  { kind: "playwright-json", file: "playwright-report/results.json", runner: "playwright" },
  { kind: "playwright-json", file: "e2e-results.json", runner: "playwright" },
  { kind: "playwright-json", file: "test-results.json", runner: "playwright" },
  // JaCoCo（Maven/Gradle 慣例）
  { kind: "jacoco", file: "target/site/jacoco/jacoco.xml", runner: "jacoco" },
  { kind: "jacoco", file: "build/reports/jacoco/test/jacocoTestReport.xml", runner: "jacoco" },
  // JUnit XML（Gradle/Maven/surefire 慣例 — dir 收 TEST-*.xml）
  { kind: "junit", file: "build/test-results/test", runner: "junit", dir: true },
  { kind: "junit", file: "target/surefire-reports", runner: "junit", dir: true },
  // JUnit XML 單檔（pytest --junitxml / go-junit-report / cargo-nextest）
  { kind: "junit-file", file: "report.xml", runner: "junit" },
  { kind: "junit-file", file: "junit.xml", runner: "junit" },
  { kind: "junit-file", file: "test-results.xml", runner: "junit" },
  { kind: "junit-file", file: "target/nextest/ci/junit.xml", runner: "junit (nextest)" },
  // Cobertura XML（Python coverage.py / Rust tarpaulin・llvm-cov）
  { kind: "cobertura", file: "coverage.xml", runner: "cobertura" },
  { kind: "cobertura", file: "cobertura.xml", runner: "cobertura" },
  { kind: "cobertura", file: "target/cobertura.xml", runner: "cobertura" },
  // .NET coverlet（msbuild 預設落地點）
  { kind: "cobertura", file: "coverage.cobertura.xml", runner: "coverlet (.NET)" },
  // Go 原生 coverprofile（go test -coverprofile=coverage.out）
  { kind: "go-cover", file: "coverage.out", runner: "go" },
  { kind: "go-cover", file: "cover.out", runner: "go" },
  { kind: "go-cover", file: "coverage.txt", runner: "go" },
  // PAAW 自身的測試執行結果（test-runner.mjs → .paaw/test-runs/last.json）
  // 2026-10-11：這是 PAAW 內部真實跑過的結果，比外部慣例路徑更該優先顯示
  { kind: "run", file: ".paaw/test-runs/last.json", runner: "PAAW test-run" },
  // 2026-10-21：node --test 專案（無 istanbul）→ test-runner 從 Node 原生覆蓋率表格轉出的 summary
  { kind: "coverage-summary", file: ".paaw/test-runs/coverage-summary.json", runner: "node --test" },
];

/** 找出專案實際存在的 report（deterministic 掃標準路徑） */
export function findTestReports(projectRoot) {
  const found = [];
  for (const c of CANDIDATES) {
    const p = join(projectRoot, c.file);
    try {
      if (!existsSync(p)) continue;
      if (c.dir) {
        // JUnit dir：收 TEST-*.xml
        const xmls = readdirSync(p).filter(f => /^TEST-.*\.xml$/.test(f)).slice(0, 50);
        if (xmls.length) found.push({ ...c, path: p, files: xmls.map(f => join(p, f)) });
      } else {
        const st = statSync(p);
        if (st.isFile() && st.size > 0) found.push({ ...c, path: p, size: st.size, mtime: st.mtime.toISOString() });
      }
    } catch { /* 路徑不可讀 = 沒有 */ }
  }
  // 根目錄掃 jacoco*.xml / playwright-report/*.json（約定俗成 fallback，cap 淺層）
  try {
    for (const f of readdirSync(projectRoot).slice(0, 500)) {
      if (/^jacoco.*\.xml$/i.test(f)) found.push({ kind: "jacoco", file: f, path: join(projectRoot, f), runner: "jacoco" });
    }
  } catch { /* ignore */ }
  // ── 2026-10-22 深掃（Fleming：各語言/前後端混合 RU 的 report 位置不同）──
  // 掃子目錄 + 孫目錄的 coverage 慣例落地點（server/coverage/…、web/coverage/…、packages/*/
  // coverage/…、<svc>/target/site/jacoco/…）。cap：最多 60 個目錄、20 份 report，跳過 node_modules/.git/dist。
  const SUBDIR_COVERAGE = [
    { kind: "coverage-summary", rel: "coverage/coverage-summary.json", runner: "vitest/jest" },
    { kind: "lcov", rel: "coverage/lcov.info", runner: "lcov" },
    { kind: "jacoco", rel: "target/site/jacoco/jacoco.xml", runner: "jacoco" },
    { kind: "cobertura", rel: "coverage.xml", runner: "cobertura" },
    { kind: "cobertura", rel: "coverage.cobertura.xml", runner: "coverlet (.NET)" },
    { kind: "go-cover", rel: "coverage.out", runner: "go" },
  ];
  const SKIP = new Set(["node_modules", ".git", "dist", ".paaw", "playwright-report", "test-results"]);
  const seenPaths = new Set(found.map(f => f.path));
  let dirBudget = 60, foundBudget = 20;
  try {
    const level1 = readdirSync(projectRoot, { withFileTypes: true }).filter(d => d.isDirectory() && !SKIP.has(d.name)).slice(0, 30);
    for (const d1 of level1) {
      const dirsToCheck = [[d1.name]];
      // 孫目錄（packages/*/ui 這種 monorepo layout）：只開一層，控制掃描量
      try {
        const level2 = readdirSync(join(projectRoot, d1.name), { withFileTypes: true }).filter(d => d.isDirectory() && !SKIP.has(d.name)).slice(0, 15);
        for (const d2 of level2) dirsToCheck.push([d1.name, d2.name]);
      } catch { /* ignore */ }
      for (const parts of dirsToCheck) {
        if (dirBudget-- <= 0 || foundBudget <= 0) break;
        for (const pat of SUBDIR_COVERAGE) {
          const rel = [...parts, pat.rel].join("/");
          const p = join(projectRoot, rel);
          if (seenPaths.has(p)) continue;
          try {
            const st = statSync(p);
            if (st.isFile() && st.size > 0) {
              found.push({ ...pat, file: rel, path: p, size: st.size, mtime: st.mtime.toISOString() });
              seenPaths.add(p); foundBudget--;
            }
          } catch { /* 無 = 跳過 */ }
        }
      }
    }
  } catch { /* ignore */ }
  return found;
}

// ── Istanbul coverage-summary.json ──
// { total: { lines: { pct: 87.5 }, ... }, "abs/path/file.ts": { lines: { pct: 100 } } }
function parseCoverageSummary(projectRoot, filePath, runner = null) {
  const j = JSON.parse(readFileSync(filePath, "utf-8"));
  const out = { runner: runner ? `${runner} (istanbul 格式)` : "vitest/jest (istanbul)", kind: "coverage", at: statSync(filePath).mtime.toISOString(), fileCoverage: {}, totalLinePct: null, linesCovered: null, linesTotal: null };
  for (const [k, v] of Object.entries(j)) {
    if (k === "total") {
      out.totalLinePct = v?.lines?.pct ?? null;
      // 2026-10-22：絕對行數（加權合併用 — 前後端混合 RU 多份 coverage 不能平均百分比）
      const cv = v?.lines?.covered, tt = v?.lines?.total;
      if (Number.isFinite(cv) && Number.isFinite(tt) && tt > 0) { out.linesCovered = cv; out.linesTotal = tt; }
      continue;
    }
    const rel = relative(projectRoot, k).replace(/\\/g, "/");
    if (!rel.startsWith("..")) out.fileCoverage[rel] = v?.lines?.pct ?? null;
  }
  return out;
}

// ── lcov.info（SF:<file> ... LF:<total> LH:<hit>）──
function parseLcov(projectRoot, filePath) {
  const text = readFileSync(filePath, "utf-8");
  const out = { runner: "lcov", kind: "coverage", at: statSync(filePath).mtime.toISOString(), fileCoverage: {}, totalLinePct: null };
  let cur = null, lf = 0, lh = 0, tlf = 0, tlh = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) { cur = relative(projectRoot, line.slice(3).trim()).replace(/\\/g, "/"); lf = 0; lh = 0; }
    else if (line.startsWith("LF:")) lf = parseInt(line.slice(3), 10) || 0;
    else if (line.startsWith("LH:")) lh = parseInt(line.slice(3), 10) || 0;
    else if (line.startsWith("end_of_record") && cur !== null) {
      out.fileCoverage[cur] = lf > 0 ? Math.round((lh / lf) * 1000) / 10 : null;
      tlf += lf; tlh += lh; cur = null;
    }
  }
  if (tlf > 0) { out.totalLinePct = Math.round((tlh / tlf) * 1000) / 10; out.linesCovered = tlh; out.linesTotal = tlf; } // 2026-10-22：絕對行數供加權合併
  return out;
}

// ── Playwright JSON（{ suites: [{ suites: [{ specs: [{ tests: [{ results: [{ status }] }] }] }] }] }）──
function parsePlaywrightJson(filePath) {
  const j = JSON.parse(readFileSync(filePath, "utf-8"));
  const out = { runner: "playwright", kind: "e2e", at: statSync(filePath).mtime.toISOString(), total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, suites: [] };
  const walk = (suites, path) => {
    for (const s of suites || []) {
      const name = [...path, s.title].filter(Boolean).join(" › ");
      for (const spec of s.specs || []) {
        for (const t of spec.tests || []) {
          const last = t.results?.[t.results.length - 1];
          const status = last?.status || "unknown";
          out.total++;
          if (status === "passed") out.passed++;
          else if (status === "flaky") { out.flaky++; out.passed++; }
          else if (status === "skipped") out.skipped++;
          else out.failed++;
          if (status !== "passed" && status !== "skipped" && out.suites.length < 20) out.suites.push(`${name} › ${spec.title} [${status}]`);
        }
      }
      walk(s.suites, [...path, s.title]);
    }
  };
  walk(j.suites, []);
  return out;
}

// ── JUnit XML（<testsuite tests="12" failures="2" errors="0" skipped="1">）──
function parseJunitXml(filePath) {
  const st = statSync(filePath);
  if (st.size > MAX_XML_BYTES) return null;
  const xml = readFileSync(filePath, "utf-8");
  const out = { runner: "junit", kind: "unit", at: st.mtime.toISOString(), total: 0, passed: 0, failed: 0, skipped: 0, source: relative(process.cwd(), filePath) };
  const suites = [...xml.matchAll(/<testsuite\s[^>]*>/g)];
  for (const m of suites) {
    const tag = m[0];
    const num = (a) => parseInt((tag.match(new RegExp(`${a}="([0-9]+)"`)) || [])[1], 10) || 0;
    out.total += num("tests");
    out.failed += num("failures") + num("errors");
    out.skipped += num("skipped");
  }
  out.passed = out.total - out.failed - out.skipped;
  if (out.total === 0) return null; // 空/壞檔不算數
  return out;
}

// ── JaCoCo XML（<counter type="LINE" missed="120" covered="340"/>）──
function parseJacocoXml(filePath) {
  const st = statSync(filePath);
  if (st.size > MAX_XML_BYTES) return null;
  const xml = readFileSync(filePath, "utf-8");
  // 整包 line counter（report 直屬的 package/class 之外也有 per-class 的 — 取全域：所有 reportlevel counter 的加總
  // 簡化且可靠：第一個 <report …> 後最後出現的 LINE counter = 報告總計（jacoco 產出慣例：總 counter 在尾段）
  const counters = [...xml.matchAll(/<counter type="LINE" missed="(\d+)" covered="(\d+)"\/>/g)];
  if (!counters.length) return null;
  // per-package counters 也會被抓 — 用 missed+covered 最大的那組（總計 ≥ 任何子集）
  let best = null;
  for (const m of counters) {
    const missed = +m[1], covered = +m[2];
    if (!best || missed + covered > best.missed + best.covered) best = { missed, covered };
  }
  const total = best.missed + best.covered;
  return {
    runner: "jacoco", kind: "coverage",
    at: st.mtime.toISOString(),
    totalLinePct: total > 0 ? Math.round((best.covered / total) * 1000) / 10 : null,
    linesCovered: best.covered, linesMissed: best.missed,
  };
}

// ── Cobertura XML（Python coverage.py / Rust tarpaulin・llvm-cov）──
// <coverage line-rate="0.85"><packages><package><classes><class filename="a.py" line-rate="1.0">
function parseCoberturaXml(projectRoot, filePath) {
  const st = statSync(filePath);
  if (st.size > MAX_XML_BYTES) return null;
  const xml = readFileSync(filePath, "utf-8");
  const out = { runner: "cobertura", kind: "coverage", at: st.mtime.toISOString(), fileCoverage: {}, totalLinePct: null, linesCovered: null, linesTotal: null };
  const g = xml.match(/<coverage\b[^>]*\bline-rate="([0-9.]+)"/);
  if (g) out.totalLinePct = Math.round(parseFloat(g[1]) * 1000) / 10;
  // 2026-10-22：cobertura 標準屬性 lines-valid / lines-covered（加權合併用）
  const lv = xml.match(/<coverage\b[^>]*\blines-valid="(\d+)"/);
  const lc = xml.match(/<coverage\b[^>]*\blines-covered="(\d+)"/);
  if (lv && lc && +lv[1] > 0) { out.linesTotal = +lv[1]; out.linesCovered = +lc[1]; }
  // 逐檔：屬性子順序不定（filename / line-rate 誰先都可能）→ 整 tag 抽
  for (const m of xml.matchAll(/<class\b[^>]*>/g)) {
    const tag = m[0];
    const fn = (tag.match(/filename="([^"]+)"/) || [])[1];
    if (!fn) continue;
    const lr = (tag.match(/line-rate="([0-9.]+)"/) || [])[1];
    // filename 可能已是相對路徑（coverage.py 慣例）或絕對路徑 → 兩種都要處理
    const isAbs = fn.startsWith("/") || /^[A-Za-z]:[\\/]/.test(fn);
    const rel = (isAbs ? relative(projectRoot, fn) : fn).replace(/\\/g, "/");
    out.fileCoverage[rel] = lr != null ? Math.round(parseFloat(lr) * 1000) / 10 : null;
  }
  // 找不到全域 line-rate 時，用逐檔平均還沒意义 — 只信 XML 自帶的總計
  if (out.totalLinePct === null && !Object.keys(out.fileCoverage).length) return null;
  return out;
}

// ── Go coverprofile（go test -coverprofile=coverage.out）──
// mode: atomic\npath/a.go:3.14,5.2 3 1  （file:start.end numStmt count）
function parseGoCoverprofile(filePath) {
  const st = statSync(filePath);
  if (st.size > MAX_XML_BYTES) return null;
  const text = readFileSync(filePath, "utf-8");
  if (!text.startsWith("mode:")) return null; // 不是 coverprofile 格式
  const out = { runner: "go", kind: "coverage", at: st.mtime.toISOString(), fileCoverage: {}, totalLinePct: null, stmtsCovered: 0, stmtsTotal: 0 };
  const perFile = {};
  let covered = 0, total = 0, lines = 0;
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("mode:")) continue;
    const m = line.match(/^(.*?):\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)\s*$/);
    if (!m) continue;
    const f = m[1], numStmt = +m[2], count = +m[3];
    perFile[f] = perFile[f] || { c: 0, t: 0 };
    perFile[f].t += numStmt;
    if (count > 0) perFile[f].c += numStmt;
    total += numStmt;
    if (count > 0) covered += numStmt;
    lines++;
  }
  if (total === 0) return null;
  for (const [f, v] of Object.entries(perFile)) out.fileCoverage[f] = v.t > 0 ? Math.round((v.c / v.t) * 1000) / 10 : null;
  out.stmtsCovered = covered; out.stmtsTotal = total;
  out.linesCovered = covered; out.linesTotal = total; // 2026-10-22：go 是 statement 覆蓋率，當行數近似供加權合併
  out.totalLinePct = Math.round((covered / total) * 1000) / 10;
  return out;
}

// ── PAAW 自身測試執行（.paaw/test-runs/last.json — test-runner.mjs 產出）──
// { id, finishedAt, headSha, status, durationMs, includeE2e, summary:{passed,failed,skipped,total},
//   byKind, groups:[{kind,runner,cmd,status,passed,failed,skipped}] }
function parsePaawTestRun(filePath) {
  const j = JSON.parse(readFileSync(filePath, "utf-8"));
  const s = j.summary || {};
  const total = s.total ?? null;
  if (total === null && !j.groups?.length) return null; // 空/壞檔不算數
  return {
    runner: "PAAW test-run",
    kind: "run",
    at: j.finishedAt || null,
    status: j.status || ((s.failed ?? 0) > 0 ? "fail" : "pass"),
    total, passed: s.passed ?? null, failed: s.failed ?? null, skipped: s.skipped ?? null,
    durationMs: j.durationMs ?? null,
    id: j.id || null,
    headSha: j.headSha ? String(j.headSha).slice(0, 7) : null,
    includeE2e: !!j.includeE2e,
    byKind: j.byKind || null,
    commands: [...new Set((j.groups || []).map(g => g.cmd).filter(Boolean))].slice(0, 6),
  };
}

/**
 * readTestReports — 讀全部找得到的 report → 標準化清單
 * 一個壞檔 try/catch 跳過，絕不炸整批。
 */export function readTestReports(projectRoot) {
  const found = findTestReports(projectRoot);
  const reports = [];
  for (const f of found) {
    try {
      if (f.kind === "run") { const r = parsePaawTestRun(f.path); if (r) reports.push(r); }
      else if (f.kind === "coverage-summary") reports.push(parseCoverageSummary(projectRoot, f.path, f.runner));
      else if (f.kind === "lcov") reports.push(parseLcov(projectRoot, f.path));
      else if (f.kind === "playwright-json") reports.push(parsePlaywrightJson(f.path));
      else if (f.kind === "cobertura") { const r = parseCoberturaXml(projectRoot, f.path); if (r) reports.push(r); }
      else if (f.kind === "go-cover") { const r = parseGoCoverprofile(f.path); if (r) reports.push(r); }
      else if (f.kind === "junit") for (const x of f.files) { const r = parseJunitXml(x); if (r) reports.push(r); }
      else if (f.kind === "junit-file") { const r = parseJunitXml(f.path); if (r) reports.push({ ...r, runner: f.runner }); }
      else if (f.kind === "jacoco") { const r = parseJacocoXml(f.path); if (r) reports.push(r); }
    } catch { /* 壞檔 = 這份不算 */ }
  }
  return reports;
}

/**
 * mergeCoverage — 多份 coverage 的行數加權合併（2026-10-22 Fleming：前後端混合 RU）
 *
 * 各語言/前後端各出一份 report（vitest + jacoco、前端 istanbul + 後端 go…）時：
 * - 有絕對行數的來源：Σcovered / Σtotal 加權合併（不是平均百分比 — 80%×100 行 + 40%×1000 行 ≠ 60%）
 * - 只有一份：原值帶 merged:false
 * - 多份但缺絕對行數（無法加權）：回最高那份 + merged:false + 全部 sources（UI 顯示清單不冒充）
 */
export function mergeCoverage(reports) {
  const covs = (reports || []).filter(r => r && r.kind === "coverage");
  if (covs.length === 0) return null;
  const sources = covs.map(c => ({ runner: c.runner, at: c.at, totalLinePct: c.totalLinePct ?? null, file: c.file ?? null }));
  if (covs.length === 1) {
    const c = covs[0];
    return { totalLinePct: c.totalLinePct ?? null, linesCovered: c.linesCovered ?? null, linesTotal: c.linesTotal ?? null, sources, merged: false, at: c.at ?? null };
  }
  let covered = 0, total = 0, absCount = 0;
  for (const c of covs) {
    if (Number.isFinite(c.linesCovered) && Number.isFinite(c.linesTotal) && c.linesTotal > 0) { covered += c.linesCovered; total += c.linesTotal; absCount++; }
    else if (Number.isFinite(c.linesMissed) && Number.isFinite(c.linesCovered)) { covered += c.linesCovered; total += c.linesCovered + c.linesMissed; absCount++; } // jacoco
  }
  if (absCount >= 2 && total > 0) {
    const latestAt = sources.map(s => s.at).filter(Boolean).sort().pop() ?? null;
    return { totalLinePct: Math.round((covered / total) * 1000) / 10, linesCovered: covered, linesTotal: total, sources, merged: true, at: latestAt };
  }
  const best = [...covs].sort((a, b) => (b.totalLinePct ?? -1) - (a.totalLinePct ?? -1))[0];
  const latestAt = sources.map(s => s.at).filter(Boolean).sort().pop() ?? null;
  return { totalLinePct: best?.totalLinePct ?? null, linesCovered: null, linesTotal: null, sources, merged: false, at: latestAt };
}

/** 產生 UI 摘要（找到什麼、數字、時間；找不到 = 無 — 誠實） */
export function testReportSummary(projectRoot) {
  const reports = readTestReports(projectRoot);
  const pick = (pred) => reports.filter(pred);
  return {
    found: reports.length,
    // 2026-10-22：前後端混合 RU — 合併行覆蓋率（加權）；消費端優先吃這個，不再只看 coverage[0]
    mergedCoverage: mergeCoverage(reports),
    reports: reports.map(r => ({
      runner: r.runner, kind: r.kind, at: r.at,
      total: r.total ?? null, passed: r.passed ?? null, failed: r.failed ?? null, skipped: r.skipped ?? null,
      totalLinePct: r.totalLinePct ?? null,
      // PAAW 自身執行（kind=run）額外欄位
      status: r.status ?? null, durationMs: r.durationMs ?? null, id: r.id ?? null,
      headSha: r.headSha ?? null, includeE2e: r.includeE2e ?? null, commands: r.commands ?? null,
      byKind: r.byKind ?? null, // 2026-10-21：per-kind（unit/e2e）執行數字給 UI 顯示 UT/E2E 分別的結果
    })),
    run: pick(r => r.kind === "run"),
    coverage: pick(r => r.kind === "coverage"),
    e2e: pick(r => r.kind === "e2e"),
    unit: pick(r => r.kind === "unit"),
    _note: "真實工具 report（deterministic 讀取）。啟發式檔案對映為獨立欄位，不冒充真實覆蓋。",
  };
}
