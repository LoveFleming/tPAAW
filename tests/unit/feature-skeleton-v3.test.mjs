/**
 * Feature Map 全新骨架 v3 測試（2026-10-23）
 *
 * 背景：Fleming 回報 portkey-gateway 的 feature map「最重要功能全找不到」
 * （provider routing / budget control / guardrails / request processing）。
 * 屍檢根因（舊 deterministic-v2）：
 *   ① barrel 邊刪除 → 只透過 barrel 可達的整層變孤兒（portkey providers/ 205 檔）
 *   ② shared 黑洞（239 檔 41% 無名）— 請求生命週期核心本質上被所有入口共用 → 必進黑洞
 *   ③ cluster = 入口點社群（Jaccard），不是業務功能 → 護欄框架與 handlers 黏成 121 檔
 *   ④ 無輸出健檢 → 垃圾名 F024「直呼測試名」desc="d" 全放行
 *
 * 新骨架 deterministic-v3：Tier 分流 → barrel 塌縮 → Label Propagation（100% 覆蓋）
 *   → 目錄切分/寬目錄 roll-up → 入口標註。不變式：source tier 每檔恰落一條 feature。
 *
 * 本測試驗證：多語言（ts/py/go/java/rust）+ 不變式（coverage 100% / shared 0 / orphans 0）
 *   + tier 分流（example 不喧賓奪主、深層套件名 samples 不誤判）+ barrel 塌縮 + 寬目錄 roll-up。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseProject } from "../../packages/server/src/lib/tree-sitter-parser.mjs";
import { buildDeterministicFeatureMap, classifyTier } from "../../packages/server/src/lib/code-graph.mjs";

const PAAW_ROOT = process.cwd();

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "fm-v3-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
async function mapOf(root) {
  const parsed = await parseProject(root, PAAW_ROOT, { maxFiles: 0, maxBytes: 500_000 });
  return buildDeterministicFeatureMap(parsed);
}

describe("v3 骨架 — 不變式（任何 repo 都成立）", () => {
  it("coverage=100%、shared=0、orphans=0（無黑洞、無孤兒）", async () => {
    const root = fixture({
      "src/a/x.ts": "export function ax() { return 1; }\n",
      "src/a/y.ts": "import { ax } from './x';\nexport function ay() { return ax(); }\n",
      "src/b/z.ts": "import { ay } from '../a/y';\nexport function bz() { return ay(); }\n",
      "src/index.ts": "export * from './a/x';\nexport * from './a/y';\nexport * from './b/z';\n",
    });
    try {
      const dm = await mapOf(root);
      expect(dm.stats.coverage).toBe(100);
      expect(dm.stats.shared).toBe(0);
      expect(dm.stats.orphans).toBe(0);
      expect(dm.orphans.length).toBe(0);
      // 每個 source 檔恰落一條 feature
      const seen = new Map();
      for (const f of dm.features) for (const cf of f.codeFiles) seen.set(cf, (seen.get(cf) || 0) + 1);
      expect([...seen.values()].every(v => v === 1)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("barrel 塌縮：只透過 index.ts 可達的檔案不再變孤兒", async () => {
    const root = fixture({
      "src/lib/deep.ts": "export const DEEP = 42;\n",
      "src/lib/index.ts": "export * from './deep';\n",
      "src/app/main.ts": "import { DEEP } from '../lib';\nconsole.log(DEEP);\n",
    });
    try {
      const dm = await mapOf(root);
      const covered = new Set(dm.features.flatMap(f => f.codeFiles));
      expect(covered.has("src/lib/deep.ts")).toBe(true); // 舊版：因刪 barrel 邊而孤兒
      expect(dm.stats.orphans).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("v3 骨架 — Tier 分流", () => {
  it("頂層 examples/ 目錄 → grade=example，且 roll-up 成單一 feature（不喧賓奪主）", async () => {
    const root = fixture({
      "src/core/a.ts": "export function a() { return 1; }\n",
      "src/core/b.ts": "import { a } from './a';\nexport function b() { return a(); }\n",
      "examples/demo1/x.ts": "export function x() { return 1; }\n",
      "examples/demo1/y.ts": "export function y() { return 2; }\n",
      "examples/demo2/z.ts": "export function z() { return 3; }\n",
    });
    try {
      const dm = await mapOf(root);
      const ex = dm.features.filter(f => f.grade === "example");
      expect(ex.length).toBe(1); // 兩個 demo 目錄 → 一條 example feature
      expect(ex[0].codeFiles.length).toBe(3);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("深層套件名 samples（Java org.x.samples.y）不被誤判 example tier", () => {
    expect(classifyTier("src/main/java/org/springframework/samples/petclinic/Owner.java")).toBe("source");
    expect(classifyTier("examples/demo/a.ts")).toBe("example");
    expect(classifyTier("docs/guide.md")).toBe("docs");
    expect(classifyTier("scripts/build.mjs")).toBe("tooling");
  });
});

describe("v3 骨架 — 多語言", () => {
  it("Python 套件 → 檔案全數歸屬（無孤兒）", async () => {
    const root = fixture({
      "requests/__init__.py": "from .api import get\nfrom .models import Response\n",
      "requests/api.py": "def get(url):\n    return url\n",
      "requests/models.py": "class Response:\n    pass\n",
      "requests/sessions.py": "from .api import get\nclass Session:\n    def send(self):\n        return get('x')\n",
    });
    try {
      const dm = await mapOf(root);
      expect(dm.stats.coverage).toBe(100);
      expect(dm.stats.orphans).toBe(0);
      const covered = new Set(dm.features.flatMap(f => f.codeFiles));
      expect(covered.has("requests/api.py")).toBe(true);
      expect(covered.has("requests/sessions.py")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("Go：同 package 多檔歸屬、無孤兒", async () => {
    const root = fixture({
      "go.mod": "module example.com/m\n\ngo 1.21\n",
      "handler/handler.go": "package handler\n\nfunc Serve() {}\n",
      "handler/routes.go": "package handler\n\nfunc Routes() { Serve() }\n",
      "util/str.go": "package util\n\nfunc Trim(s string) string { return s }\n",
    });
    try {
      const dm = await mapOf(root);
      expect(dm.stats.orphans).toBe(0);
      const covered = new Set(dm.features.flatMap(f => f.codeFiles));
      expect(covered.has("handler/handler.go")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("Java：Spring 分層（controller/service/repo）歸屬、無孤兒", async () => {
    const root = fixture({
      "src/main/java/com/x/app/OwnerController.java":
        "package com.x.app;\nclass OwnerController { OwnerService s; }\n",
      "src/main/java/com/x/app/OwnerService.java":
        "package com.x.app;\nclass OwnerService { OwnerRepository r; }\n",
      "src/main/java/com/x/app/OwnerRepository.java":
        "package com.x.app;\nclass OwnerRepository {}\n",
    });
    try {
      const dm = await mapOf(root);
      expect(dm.stats.orphans).toBe(0);
      expect(dm.stats.coverage).toBe(100);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("Rust：crate 內模組歸屬、無孤兒", async () => {
    const root = fixture({
      "src/main.rs": "mod app;\nmod util;\nfn main() { app::run(); }\n",
      "src/app.rs": "use crate::util;\npub fn run() { util::help(); }\n",
      "src/util.rs": "pub fn help() {}\n",
    });
    try {
      const dm = await mapOf(root);
      expect(dm.stats.orphans).toBe(0);
      const covered = new Set(dm.features.flatMap(f => f.codeFiles));
      expect(covered.has("src/util.rs")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("v3 骨架 — 寬目錄 roll-up（集合型模組）", () => {
  it("一個目錄下 ≥15 個同質子目錄 → roll-up 成單一 feature（不碎片化）", async () => {
    const files = { "src/index.ts": "export const V = 1;\n" };
    for (let i = 0; i < 16; i++) {
      files[`src/adapters/p${i}/index.ts`] = `export const P${i} = ${i};\n`;
      files[`src/adapters/p${i}/impl.ts`] = `import { P${i} } from './index';\nexport const impl${i} = P${i};\n`;
    }
    const root = fixture(files);
    try {
      const dm = await mapOf(root);
      // 舊版：16+ 條碎片；新版 roll-up 後絕大多數歸於同一 feature
      const adapterFeats = dm.features.filter(f => f.codeFiles.some(cf => cf.startsWith("src/adapters/")));
      expect(adapterFeats.length).toBeLessThanOrEqual(2);
      const biggest = Math.max(...adapterFeats.map(f => f.codeFiles.filter(cf => cf.startsWith("src/adapters/")).length));
      expect(biggest).toBeGreaterThanOrEqual(28);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
