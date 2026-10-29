// pm module 單元測試 — 範圍強制 / 掃描標記 / scaffold 語意
import { describe, it } from "vitest";
import { strict as assert } from "assert";

describe("pm module", () => {
  it("runPmTool：專案管家寫他櫃被擋、寫自己櫃合法", async () => {
    const { runPmTool } = await import("../../packages/server/src/lib/secretary-tools.mjs");
    const r = await runPmTool("project_write", { project: "_global", file: "x.md", content: "t" }, "pm.ai-portal");
    assert.ok(r.startsWith("❌"), `應被範圍限制擋下：${r}`);
    const r2 = await runPmTool("project_write", { project: "ai-portal", file: "unit-test.md", content: "# t" }, "pm.ai-portal");
    assert.ok(r2.startsWith("✅"), r2);
  });

  it("runPmTool：pm.reports 寫專案櫃被擋、寫 _global 合法", async () => {
    const { runPmTool } = await import("../../packages/server/src/lib/secretary-tools.mjs");
    const r = await runPmTool("project_write", { project: "ai-portal", file: "x.md", content: "t" }, "pm.reports");
    assert.ok(r.startsWith("❌") && r.includes("_global"), r);
    const r2 = await runPmTool("project_write_sheet", { project: "_global", file: "unit-r", headers: ["a"], rows: [["1"]] }, "pm.reports");
    assert.ok(r2.startsWith("✅"), r2);
  });

  it("runPmTool：chief 跨櫃寫合法", async () => {
    const { runPmTool } = await import("../../packages/server/src/lib/secretary-tools.mjs");
    const r = await runPmTool("project_write", { project: "ai-portal", file: "unit-chief.md", content: "# t" }, "pm.chief");
    assert.ok(r.startsWith("✅"), r);
  });

  it("runPmTool：非法專案/檔名被拒（路徑逃逸防護）", async () => {
    const { runPmTool } = await import("../../packages/server/src/lib/secretary-tools.mjs");
    const r = await runPmTool("project_read", { project: "../crews", file: "x" }, "pm.chief");
    assert.ok(r.startsWith("❌"), r);
    const r2 = await runPmTool("project_write", { project: "ai-portal", file: "../../etc/passwd", content: "x" }, "pm.chief");
    assert.ok(r2.startsWith("❌"), r2);
  });

  it("project_list：_global 永遠在列", async () => {
    const { runPmTool } = await import("../../packages/server/src/lib/secretary-tools.mjs");
    const r = await runPmTool("project_list", {}, "pm.chief");
    assert.ok(r.includes("_global"), r);
    assert.ok(r.includes("ai-portal"), r);
  });

  it("掃描標記 regex：due/milestone/expires 三型都可解析（briefing 引擎語意）", () => {
    const RE = /\[(due|milestone|expires):(2\d{3}-\d{2}-\d{2})\]\s*(.+)/g;
    const md = "- R1 [due:2026-10-05] 供應商報價｜機率:中\n- [milestone:2026-10-10] POC demo — 原型\n- [expires:2026-11-01] 保約";
    const found = [...md.matchAll(RE)];
    assert.equal(found.length, 3);
    assert.deepEqual(found.map(m => m[1]), ["due", "milestone", "expires"]);
    assert.equal(found[0][2], "2026-10-05");
  });

  it("proj-N id 生成 max+1 防撞（projects.mjs 語意）", () => {
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const list = [{ id: "ai-portal" }, { id: "proj-3" }];
    let id = slug("");
    if (!id) { let n = 1; for (const c of list) { const m = /^proj-(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1]) + 1); } id = `proj-${n}`; }
    assert.equal(id, "proj-4");
  });
});
