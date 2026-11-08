/**
 * e2e-inventory.mjs — E2E 測試盤點引擎（deterministic，2026-11-07 Fleming 大 feature）
 *
 * North Star：LLM 只推理，事實靠程式。這裡全部 deterministic：
 * 1. 走訪測試檔（多語言慣例：*.test.ts / *_test.go / test_*.py / XxxTests.java / tests/ 目錄）
 * 2. 抽每支測試的「測試名」+「打到的 URL/路徑」（字面值，regex 抽取）
 * 3. URL ↔ API entry 雙向關聯（參數段相容 :id / {id} / <id>；後綴降級）
 * 4. 對不上任何 API 的 = 孤兒測試（黑盒缺口可見化）
 *
 * 輸出餵 GET /api/coding-releases/e2e-inventory → Release Manager「🧪 E2E 盤點」表
 */

import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { isTestFileName } from "./cu-source-scan.mjs";

const TEST_DIR = new Set(["tests", "test", "e2e", "__tests__", "spec"]);
const TEST_CODE_EXT = new Set(["js", "cjs", "mjs", "ts", "tsx", "jsx", "py", "go", "rs", "java", "rb", "kt", "cs", "php"]);
const SKIP_DIR = new Set(["node_modules", "dist", "build", "target", "coverage", "vendor", ".git", ".paaw", "venv", ".venv", "__pycache__"]);

function isTestFilePath(relPath) {
  const segs = relPath.split(/[\\/]/);
  const ext = (segs[segs.length - 1] || "").split(".").pop()?.toLowerCase() || "";
  if (!TEST_CODE_EXT.has(ext)) return false; // 2026-11-08 修：.md 文件被 test/ 目錄誤判成測試檔
  if (segs.slice(0, -1).some((s) => TEST_DIR.has(s))) return true;
  // 不在測試目錄時只認強慣例檔名 — test-xxx.mjs 函式庫（test-runner 等）不算測試
  const name = segs[segs.length - 1] || "";
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || /_test\.(go|py|rs|java)$/.test(name) || /^test_.*\.py$/.test(name);
}

/** 測試名抽取（Playwright/Vitest/Jest `test("x")`、pytest `def test_x`、Go `func TestX`、JUnit `void x()`+@Test） */
function extractTestNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:^|\n)\s*(?:test|it)\(\s*["'`]([^"'`\n]{2,120})["'`]/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*def\s+(test_\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*func\s+(Test\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/@Test\b[\s\S]{0,200}?\s(?:public\s+)?void\s+(\w+)\s*\(/g)) names.add(m[1]);
  return [...names].slice(0, 200);
}

/** URL/路徑抽取：引號內以 / 開頭的路徑字面值 + f-string 變數後綴（FastAPI `f"{settings.API_V1_STR}/items/"` → /items/） */
function extractUrls(src) {
  const urls = new Set();
  const add = (u) => {
    u = u.replace(/\.(js|ts|py|go|java|css|html|json|png|jpg|svg)$/i, ""); // 檔案 import 降噪
    if (u && u.length >= 3) urls.add(u);
  };
  for (const m of src.matchAll(/["'`](\/[A-Za-z0-9_\-{}.:]{2,160}(?:\/[A-Za-z0-9_\-{}.:]*)*)["'`]/g)) add(m[1]);
  for (const m of src.matchAll(/\}(\/[A-Za-z0-9_\-{}.:]{2,160}(?:\/[A-Za-z0-9_\-{}.:]*)*)/g)) add(m[1]); // f-string / 字串拼接後綴
  return [...urls].slice(0, 120);
}

function isParamSeg(seg) {
  return seg.startsWith(":") || /^\{[^}/]+\}$/.test(seg) || /^<[^/>]+>$/.test(seg);
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** url 是否命中 API entry（雙向）：url 匹配 api 樣式、或共用足夠長的字面後綴 */
function urlMatchesApi(url, entry) {
  const entryPath = entry.split(/\s+/).length > 1 ? entry.split(/\s+/).slice(1).join(" ") : entry; // "GET /api/x" → "/api/x"
  if (!entryPath.startsWith("/")) return false;
  const uSegs = url.replace(/\/+$/, "").split("/").filter(Boolean);
  const aSegs = entryPath.replace(/\/+$/, "").split("/").filter(Boolean);
  if (!aSegs.length || !uSegs.length) return false;
  // 1) 逐段：參數段相容（url 實值 ↔ api :id/{id}/<id>，或兩邊同為字面 placeholder）
  const segEq = (u, a) => {
    if (u === a) return true;
    if (isParamSeg(a)) return !isParamSeg(u) || u === a; // api 參數段吃 url 實值或同名字面
    if (isParamSeg(u)) return u === a;
    return false;
  };
  // 全路徑（url 可能多一段尾斜線內容）
  if (uSegs.length === aSegs.length && uSegs.every((s, i) => segEq(s, aSegs[i]))) return true;
  // 2) 後綴降級：最後 k 段（k>=2、api 側全字面）url 是 api 的延長（url 更具體）或等長後綴
  for (let k = 2; k <= Math.min(aSegs.length, uSegs.length); k++) {
    const aSuf = aSegs.slice(-k);
    if (aSuf.some(isParamSeg)) continue;
    const uSuf = uSegs.slice(-k);
    if (uSuf.every((s, i) => s === aSuf[i])) return true;
  }
  // 單段後綴（k=1）：url 只剩一段（f-string 全前綴被吃掉的 FastAPI 型）且段名夠長（≥4 字）避免誤中
  if (uSegs.length === 1 && aSegs[aSegs.length - 1] === uSegs[0] && !isParamSeg(uSegs[0]) && uSegs[0].length >= 4) return true;
  // 3) api 比 url 長（測試打父路徑，API 是子路徑）— 需 api 尾段全字面且 >=2 段對齊
  return false;
}

/**
 * 建 E2E 盤點
 * @param {string} root 專案根
 * @param {Array<{entry:string,name?:string}>} apis API Map rows
 * @returns {{files:Array, summary:object}}
 */
export function buildE2EInventory(root, apis = [], opts = {}) {
  const maxDepth = opts.maxDepth ?? 10;
  const maxFiles = opts.maxFiles ?? 400;
  const files = [];
  const apiEntries = apis.map((a) => ({ entry: a.entry, name: a.name || a.entry }));

  const walk = (dir, depth, prefix) => {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith(".") || SKIP_DIR.has(e.name)) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1, rel);
      else if (e.isFile() && isTestFilePath(rel)) {
        try {
          const c = readFileSync(full, "utf-8");
          if (c.length > 800000) continue;
          const tests = extractTestNames(c).map((name) => {
            // 測試級關聯：整檔 URL 先抽，測試級抽不到就 inherits file-level（v1 以檔為主、測試名盤點）
            return { name };
          });
          const urls = extractUrls(c).map((u) => ({
            url: u,
            apis: apiEntries.filter((a) => urlMatchesApi(u, a.entry)).map((a) => a.entry),
          }));
          files.push({ file: rel, tests, urls, testCount: tests.length, urlCount: urls.length });
        } catch { /* 讀不了就跳過 */ }
      }
    }
  };
  walk(root, 0, "");
  // 2026-11-08 修：零訊號檔（沒測試名也沒 URL）純噪音（test-runner.mjs 之類函式庫），不列
  const signalFiles = files.filter((f) => f.testCount > 0 || f.urlCount > 0);

  const linkedUrls = files.flatMap((f) => f.urls).filter((u) => u.apis.length > 0);
  const orphanFiles = signalFiles.filter((f) => !f.urls.some((u) => u.apis.length));
  const coveredApis = new Set(linkedUrls.flatMap((u) => u.apis));
  return {
    files: signalFiles,
    summary: {
      testFiles: files.length,
      totalTests: files.reduce((n, f) => n + f.testCount, 0),
      totalUrls: files.reduce((n, f) => n + f.urlCount, 0),
      linkedUrls: linkedUrls.length,
      orphanTestFiles: orphanFiles.length,
      coveredApis: coveredApis.size,
      apiTotal: apiEntries.length,
    },
  };
}
