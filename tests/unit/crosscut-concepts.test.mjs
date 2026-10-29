import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCrosscutConcepts } from "../../packages/server/src/lib/crosscut-concepts.mjs";

function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "cc-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

describe("computeCrosscutConcepts", () => {
  it("偵測橫切概念並產生 gap report（Budget 散在多 feature）", () => {
    const files = {
      "a/x.ts": `const q1 = quota;\n`,
      "b/y.ts": `const q2 = quota; // budget limit\n`,
      "c/z.ts": `function charge() { return quota; }\n`,
      "d/w.ts": `const unrelated = 42;\n`,
    };
    const root = makeRepo(files);
    const parsed = { files: Object.keys(files).map((f) => ({ file: f })) };
    const features = [
      { id: "F1", name: "A", codeFiles: ["a/x.ts"] },
      { id: "F2", name: "B", codeFiles: ["b/y.ts"] },
      { id: "F3", name: "C", codeFiles: ["c/z.ts"] },
      { id: "F4", name: "D", codeFiles: ["d/w.ts"] },
    ];
    const r = computeCrosscutConcepts(root, parsed, { features });
    const budget = r.concepts.find((c) => c.key === "quota-budget");
    expect(budget).toBeTruthy();
    expect(budget.kind).toBe("overlay");
    expect(budget.crossFeatureCount).toBe(3); // F1..F3，不含 D
    expect(budget.evidence.length).toBeGreaterThan(0);
    expect(budget.evidence[0].file).toMatch(/^[abc]\//);
    // gap report 應含 Budget
    expect(r.gapReport.some((g) => g.conceptId === budget.id)).toBe(true);
  });

  it("單一 feature 獨佔的概念不算 gap", () => {
    const files = {
      "a/x.ts": `const c1 = cacheGet();\nconst c2 = cacheSet();\n`,
      "a/y.ts": `const c3 = cacheDelete();\n`,
      "b/z.ts": `const plain = 1;\n`,
    };
    const root = makeRepo(files);
    const parsed = { files: Object.keys(files).map((f) => ({ file: f })) };
    const features = [
      { id: "F1", name: "A", codeFiles: ["a/x.ts", "a/y.ts"] },
      { id: "F2", name: "B", codeFiles: ["b/z.ts"] },
    ];
    const r = computeCrosscutConcepts(root, parsed, { features });
    const cache = r.concepts.find((c) => c.key === "caching");
    expect(cache.crossFeatureCount).toBe(1);
    expect(r.gapReport.some((g) => g.conceptId === cache.id)).toBe(false);
  });

  it("retired feature 不計入", () => {
    const files = { "a/x.ts": `quota;\n`, "b/y.ts": `quota;\n`, "c/z.ts": `quota;\n` };
    const root = makeRepo(files);
    const parsed = { files: Object.keys(files).map((f) => ({ file: f })) };
    const features = [
      { id: "F1", name: "A", codeFiles: ["a/x.ts"] },
      { id: "F2", name: "B", codeFiles: ["b/y.ts"], status: "retired" },
      { id: "F3", name: "C", codeFiles: ["c/z.ts"] },
    ];
    const r = computeCrosscutConcepts(root, parsed, { features, minFeatures: 2 });
    const budget = r.concepts.find((c) => c.key === "quota-budget");
    expect(budget.crossFeatureCount).toBe(2);
    expect(budget.features).not.toContain("F2");
  });

  it("輸出為確定論（重跑一致）", () => {
    const files = { "a/x.ts": `const a = rateLimit;\n`, "b/y.ts": `const b = rateLimiter;\n`, "c/z.ts": `const c = throttle;\n` };
    const root = makeRepo(files);
    const parsed = { files: Object.keys(files).map((f) => ({ file: f })) };
    const features = [
      { id: "F1", name: "A", codeFiles: ["a/x.ts"] },
      { id: "F2", name: "B", codeFiles: ["b/y.ts"] },
      { id: "F3", name: "C", codeFiles: ["c/z.ts"] },
    ];
    const a = computeCrosscutConcepts(root, parsed, { features });
    const b = computeCrosscutConcepts(root, parsed, { features });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
