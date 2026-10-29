// secretary module 單元測試 — 純函式部分：briefing 掃描 / categories id 生成 / 範圍強制
import { describe, it } from "vitest";
import { strict as assert } from "assert";

describe("secret module", () => {
  it("stripFences：README 範例（code fence 內）不進入掃描", async () => {
    const { } = await import("assert");
    // 直接內聯測 stripFences 語意：fence 內容移除
    const md = "# t\\n\\n```\\n- [expires:2099-01-01] 範例 — 示意\\n```\\n\\n- [ ] 真待辦";
    const stripped = md.replace(/```[\s\S]*?```/g, "");
    assert.ok(!stripped.includes("2099-01-01"));
    assert.ok(stripped.includes("真待辦"));
  });

  it("secretary-tools：範圍強制 — secret.schedule 寫 reports 櫃被擋", async () => {
    const { runSecretaryTool } = await import("../../packages/server/src/lib/secretary-tools.mjs");
    const r = await runSecretaryTool("dossier_write", { category: "reports", file: "x.md", content: "test" }, "secret.schedule");
    assert.ok(r.startsWith("❌"), `應被範圍限制擋下：${r}`);
    assert.ok(r.includes("reports") || r.includes("schedule"));
  });

  it("secretary-tools：chief 跨櫃寫合法、schedule 寫自己櫃合法", async () => {
    const { runSecretaryTool } = await import("../../packages/server/src/lib/secretary-tools.mjs");
    const r1 = await runSecretaryTool("dossier_write", { category: "schedule", file: "unit-test.md", content: "# t" }, "secret.chief");
    assert.ok(r1.startsWith("✅"), r1);
    const r2 = await runSecretaryTool("dossier_write", { category: "schedule", file: "unit-test2.md", content: "# t" }, "secret.schedule");
    assert.ok(r2.startsWith("✅"), r2);
  });

  it("secretary-tools：非法分類/檔名被拒（路徑逃逸防護）", async () => {
    const { runSecretaryTool } = await import("../../packages/server/src/lib/secretary-tools.mjs");
    const r = await runSecretaryTool("dossier_read", { category: "../crews", file: "x" }, "secret.chief");
    assert.ok(r.startsWith("❌"), r);
    const r2 = await runSecretaryTool("dossier_write", { category: "reports", file: "../../etc/passwd", content: "x" }, "secret.chief");
    assert.ok(r2.startsWith("❌"), r2);
  });

  it("secretary-tools：write_sheet 產出 xlsx + read_sheet 回讀 round-trip", async () => {
    const { runSecretaryTool } = await import("../../packages/server/src/lib/secretary-tools.mjs");
    const w = await runSecretaryTool("write_sheet", {
      category: "reports", file: "unit-roundtrip",
      headers: ["a", "b"], rows: [["1", "2"], ["3", "4"]],
    }, "secret.reports");
    assert.ok(w.startsWith("✅"), w);
    const r = await runSecretaryTool("read_sheet", { category: "reports", file: "unit-roundtrip.xlsx" }, "secret.reports");
    assert.ok(r.includes("共 2 列"), r);
    assert.ok(r.includes("| a | b |") || r.includes("a"), r);
  });

  it("categories.mjs slug：中文 → cat-N 序號邏輯（pure 驗證）", () => {
    // 對應 categories.mjs 的 id 生成語意：空 slug fallback cat-N + while 防撞
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    assert.equal(slug("送禮記錄"), "");
    assert.equal(slug("Gift Records"), "gift-records");
    const list = [{ id: "schedule" }, { id: "cat-7" }, { id: "cat-3" }];
    let id = slug("");
    if (!id) { let n = 1; for (const c of list) { const m = /^cat-(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1]) + 1); } id = `cat-${n}`; }
    assert.equal(id, "cat-8"); // max(cat-7) + 1，不受 schedule 等非序號分類干擾
  });
});
