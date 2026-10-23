/**
 * subfeature-refine.test.mjs — L2 內生判準（穩定共識 + 語義分離）+ template 偵測
 * 驗收：記憶體決定論（byte-level）、無檔數門檻、小群不拆、hub 歸 shared、同型重複偵測
 */
import { describe, it, expect } from "vitest";
import { refineOneFeature, detectTemplateOrphans, cnmPartition, stabilityConsensus, vocabTokensOfFile, refinementFingerprint, computeSubFeatureRefinement } from "../../packages/server/src/lib/feature-subfeature.mjs";

const infoOf = (tokens) => ({ functions: tokens.map((t) => ({ name: t })), classes: [], exports: [], routes: [] });

function buildTwoCliques(n = 5) {
  const files = [];
  const edges = new Map();
  const mk = (prefix) => {
    for (let i = 1; i <= n; i++) files.push(`${prefix}${i}.ts`);
    for (let i = 1; i <= n; i++) {
      const targets = [];
      for (let j = 1; j <= n; j++) if (j !== i) targets.push(`${prefix}${j}.ts`);
      edges.set(`${prefix}${i}.ts`, targets);
    }
  };
  mk("a"); mk("b");
  return { files, edges };
}

describe("cnmPartition（參數自由 k 湧現）", () => {
  it("雙 clique 無擾動 → k=2 湧現", () => {
    const { files, edges } = buildTwoCliques(5);
    const idx = new Map(files.map((f, i) => [f, i]));
    const base = new Map();
    const indeg = new Array(files.length).fill(0);
    for (const [f, ts] of edges) for (const t of ts) indeg[idx.get(t)]++;
    const idf = indeg.map((d) => Math.log((files.length + 1) / (d + 1)));
    for (const [f, ts] of edges) for (const t of ts) {
      const i = idx.get(f), j = idx.get(t);
      const key = Math.min(i, j) + "," + Math.max(i, j);
      base.set(key, (base.get(key) || 0) + idf[j]);
    }
    const wAt = (i, j) => base.get(Math.min(i, j) + "," + Math.max(i, j)) || 0;
    const comms = cnmPartition(files.length, wAt);
    expect(comms).toHaveLength(2);
    expect(comms.every((c) => c.length === 5)).toBe(true);
  });
  it("無邊圖 → 全孤點（不硬合）", () => {
    expect(cnmPartition(4, () => 0)).toEqual([[0], [1], [2], [3]]);
  });
});

describe("refineOneFeature（三道內生閘門）", () => {
  const twoDoms = () => {
    const files = ["a1.ts","a2.ts","a3.ts","a4.ts","a5.ts","b1.ts","b2.ts","b3.ts","b4.ts","b5.ts","hub.ts"];
    const edges = new Map([
      ["a1.ts", ["a2.ts","a3.ts","a5.ts"]], ["a2.ts", ["a3.ts","a4.ts"]], ["a3.ts", ["a4.ts","a5.ts"]],
      ["a4.ts", ["a1.ts"]], ["a5.ts", ["a2.ts"]],
      ["b1.ts", ["b2.ts","b3.ts","b5.ts"]], ["b2.ts", ["b3.ts","b4.ts"]], ["b3.ts", ["b4.ts","b5.ts"]],
      ["b4.ts", ["b1.ts"]], ["b5.ts", ["b2.ts"]],
      ["hub.ts", ["a1.ts","b1.ts"]],
    ]);
    const info = (p) => p[0] === "a" ? infoOf(["alphaHandler" + p]) : p[0] === "b" ? infoOf(["betaWorker" + p]) : infoOf(["sharedContext"]);
    return { files, edges, info };
  };

  it("雙領域 + hub → 拆 2 群，hub 歸 internalShared（不是子 feature）", () => {
    const { files, edges, info } = twoDoms();
    const r = refineOneFeature(files, edges, info);
    expect(r.split).toBe(true);
    expect(r.subFeatures).toHaveLength(2);
    expect(r.subFeatures.every((s) => s.codeFiles.length === 5)).toBe(true);
    expect(r.internalShared).toEqual(["hub.ts"]);
  });

  it("決定論：同輸入兩跑 fingerprint 一致", () => {
    const { files, edges, info } = twoDoms();
    const r1 = refineOneFeature(files, edges, info);
    const r2 = refineOneFeature(files, edges, info);
    expect(refinementFingerprint([r1])).toBe(refinementFingerprint([r2]));
  });

  it("單一鏈（同詞彙單能力）→ 不拆", () => {
    const files = ["x1.ts","x2.ts","x3.ts","x4.ts","x5.ts"];
    const edges = new Map([["x1.ts",["x2.ts"]],["x2.ts",["x3.ts"]],["x3.ts",["x4.ts"]],["x4.ts",["x5.ts"]]]);
    const info = () => infoOf(["sameDomainHandler"]);
    const r = refineOneFeature(files, edges, info);
    expect(r.split).toBe(false);
    expect(r.evidence.reason).toBeTruthy();
  });

  it("微型 feature（N=2-3）→ 不拆（不誤拆小群）", () => {
    const edges = new Map([["p.ts", ["q.ts","r.ts"]], ["q.ts", ["r.ts"]]]);
    const info = () => infoOf(["tinyThing"]);
    expect(refineOneFeature(["p.ts","q.ts","r.ts"], edges, info).split).toBe(false);
    expect(refineOneFeature(["p.ts","q.ts"], new Map([["p.ts",["q.ts"]]]), info).split).toBe(false);
  });

  it("證據含 method/kMedian/separation — 可審計", () => {
    const { files, edges, info } = twoDoms();
    const r = refineOneFeature(files, edges, info);
    expect(r.evidence.method).toBe("stability-consensus-v1");
    expect(typeof r.evidence.kMedian).toBe("number");
    expect(r.evidence.separation).toBeGreaterThanOrEqual(1.2);
    expect(r.subFeatures[0].vocabTop.length).toBeGreaterThan(0);
  });
});

describe("detectTemplateOrphans（同型重複，零 token）", () => {
  it("兄弟目錄同檔名模式 ×3 → 一個決定論群；雜訊不入", () => {
    const orphans = [
      "src/providers/openai/api.ts","src/providers/openai/index.ts",
      "src/providers/anthropic/api.ts","src/providers/anthropic/index.ts",
      "src/providers/moonshot/api.ts","src/providers/moonshot/index.ts",
      "src/misc/foo.ts",
    ];
    const t = detectTemplateOrphans(orphans);
    expect(t.templateGroups).toHaveLength(1);
    expect(t.templateGroups[0].files).toHaveLength(6);
    expect(t.templateGroups[0].dirs).toHaveLength(3);
    expect(t.remaining).toEqual(["src/misc/foo.ts"]);
  });
  it("只 2 個同型目錄 → 不成 template（避免過度泛化）", () => {
    const orphans = ["src/x/a.ts","src/x/b.ts","src/y/a.ts","src/y/b.ts","src/other.ts"];
    const t = detectTemplateOrphans(orphans);
    expect(t.templateGroups).toHaveLength(0);
    expect(t.remaining).toHaveLength(5);
  });
});

describe("computeSubFeatureRefinement（整合層）", () => {
  it("空 features → 空結果；不炸", () => {
    expect(computeSubFeatureRefinement({ features: [], graph: { edges: new Map() } }, { files: [] })).toEqual([]);
  });
  it("對齊 features 順序", () => {
    const dm = {
      features: [
        { codeFiles: ["x1.ts","x2.ts"] },
        { codeFiles: ["y1.ts","y2.ts"] },
      ],
      graph: { edges: new Map([["x1.ts",["x2.ts"]],["y1.ts",["y2.ts"]]]) },
    };
    const refs = computeSubFeatureRefinement(dm, { files: [] });
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => r.split === false)).toBe(true);
  });
});

describe("vocabTokensOfFile", () => {
  it("camelCase 切詞、過濾停用詞", () => {
    const toks = vocabTokensOfFile({ functions: [{ name: "rateLimitHandler" }], classes: [], exports: [], routes: [] });
    expect(toks).toContain("rate");
    expect(toks).toContain("limit");
    expect(toks).toContain("handler");
  });
});
