/**
 * release-unit-impact.test.mjs — 改動影響分析測試
 *
 * 覆蓋 TASK-090：
 *   L-1 BFS 護欄 — 異常稠密圖不無界展開（depth/節點上限）
 *   H-1 deps-cache 目錄自動建立（writeFile 不因缺父目錄而 ENOENT 被吞）
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { impactAnalysis } from "@server/lib/release-unit/impact.mjs";
import { buildDependencyGraph } from "@server/lib/release-unit/dependencies.mjs";
import { LOG_HOME, logSlug } from "@server/data-home.mjs";

function tmpProject(files) {
  const root = mkdtempSync(join(tmpdir(), "ru-impact-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

let roots = [];
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots = []; });

describe("impactAnalysis", () => {
  it("finds reverse dependents of a changed file", async () => {
    const root = tmpProject({
      "src/a.mjs": "export const a = 1;",
      "src/b.mjs": 'import { a } from "./a.mjs";\nexport const b = a + 1;',
      "src/c.mjs": 'import { b } from "./b.mjs";\nexport const c = b;',
    });
    roots.push(root);
    const r = await impactAnalysis(root, ["src/a.mjs"], { refresh: true });
    const affectedFiles = (r.affected || []).map(x => x.file);
    expect(affectedFiles).toContain("src/b.mjs");
    expect(affectedFiles).toContain("src/c.mjs");
  });

  it("terminates on a self/cyclic graph without infinite loop (L-1 guard)", async () => {
    // a → b → a 循環依賴
    const root = tmpProject({
      "src/a.mjs": 'import { b } from "./b.mjs";\nexport const a = b;',
      "src/b.mjs": 'import { a } from "./a.mjs";\nexport const b = a;',
    });
    roots.push(root);
    const r = await impactAnalysis(root, ["src/a.mjs"], { refresh: true });
    expect(Array.isArray(r.affected)).toBe(true);
  });

  it("reports unresolved files", async () => {
    const root = tmpProject({ "src/a.mjs": "export const a = 1;" });
    roots.push(root);
    const r = await impactAnalysis(root, ["does/not/exist.mjs"], { refresh: true });
    expect((r.unresolved || []).length).toBeGreaterThan(0);
  });
});

describe("dependencies cache", () => {
  it("writes deps-cache.json creating parent dirs (H-1)", async () => {
    const root = tmpProject({ "src/a.mjs": "export const a = 1;" });
    roots.push(root);
    const cacheFile = join(LOG_HOME, "cache", logSlug(root), "deps-cache.json");
    rmSync(cacheFile, { force: true });
    await buildDependencyGraph(root, { refresh: true });
    expect(existsSync(cacheFile)).toBe(true);
  });
});
