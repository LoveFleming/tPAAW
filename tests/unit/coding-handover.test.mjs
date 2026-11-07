/**
 * Coding Handover brief/remarks 單元測試（2026-10-10）
 * - remark CRUD（人員注記：獨立檔，永久保留）
 * - brief 讀取（懶生成：GET 不觸發 LLM）
 * - ⚠️ POST brief 會打真 LLM — 不在 unit 測（live 驗證）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// route handler 直接注入 mock req/res（不開 server）
import handoverRoutes from "../../packages/server/src/routes/coding-handover.mjs";

function mockReq(method, url, body) {
  const bodyStr = body ? JSON.stringify(body) : "";
  return {
    method, url,
    on(ev, cb) {
      if (ev === "data" && bodyStr) cb(bodyStr);
      if (ev === "end") cb();
      if (ev === "error") cb();
    },
  };
}
function mockRes() {
  const r = { code: 0, body: null };
  r.writeHead = (c) => { r.code = c; return r; };
  r.end = (b) => { r.body = String(b || ""); return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (j) => { if (!r.code) r.code = 200; r.body = JSON.stringify(j); return r; };
  return r;
}

let dir;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "handover-test-"));
  // 最小 .paaw 結構
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(dir, ".paaw"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "PROJECT.md"), "# test project");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("handover remarks（人員注記 — 作者資產）", () => {
  it("PUT remark → 落地 handover-remarks.json", async () => {
    const res = mockRes();
    await handoverRoutes(
      mockReq("PUT", `/api/coding-handover/remark?path=${encodeURIComponent(dir)}`, { text: "改 db 前先看 DECISIONS.md 第三條", target: "general" }),
      res,
    );
    expect(res.code).toBe(200);
    const j = JSON.parse(res.body);
    expect(j.ok).toBe(true);
    expect(j.remarks).toHaveLength(1);
    expect(j.remarks[0].text).toContain("DECISIONS.md");
    expect(existsSync(join(dir, ".paaw", "handover-remarks.json"))).toBe(true);
  });

  it("GET brief → 讀回 remarks（brief 未生成 = null，不觸發 LLM）", async () => {
    const res = mockRes();
    await handoverRoutes(mockReq("GET", `/api/coding-handover/brief?path=${encodeURIComponent(dir)}`), res);
    expect(res.code).toBe(200);
    const j = JSON.parse(res.body);
    expect(j.brief).toBeNull();
    expect(j.remarks).toHaveLength(1);
  });

  it("DELETE remark → 清空，檔案仍在（空陣列）", async () => {
    const id = JSON.parse(readFileSync(join(dir, ".paaw", "handover-remarks.json"), "utf-8"))[0].id;
    const res = mockRes();
    await handoverRoutes(mockReq("DELETE", `/api/coding-handover/remark?path=${encodeURIComponent(dir)}&id=${id}`), res);
    expect(res.code).toBe(200);
    expect(JSON.parse(res.body).remarks).toHaveLength(0);
  });

  it("PUT 空 text → 400", async () => {
    const res = mockRes();
    await handoverRoutes(mockReq("PUT", `/api/coding-handover/remark?path=${encodeURIComponent(dir)}`, { text: "   " }), res);
    expect(res.code).toBe(400);
  });

  it(" remarks 與 brief 完全獨立 — brief 檔不存在時 remarks 照常運作", async () => {
    expect(existsSync(join(dir, ".paaw", "handover-brief.json"))).toBe(false);
    const res = mockRes();
    await handoverRoutes(mockReq("PUT", `/api/coding-handover/remark?path=${encodeURIComponent(dir)}`, { text: "另一條注記" }), res);
    expect(res.code).toBe(200);
    expect(JSON.parse(res.body).remarks).toHaveLength(1);
  });
});

describe("handover bundle（deterministic 交接包 — 原版行為不回歸）", () => {
  it("GET bundle → initialized + knowledge.project", async () => {
    const res = mockRes();
    await handoverRoutes(mockReq("GET", `/api/coding-handover/bundle?path=${encodeURIComponent(dir)}`), res);
    expect(res.code).toBe(200);
    const j = JSON.parse(res.body);
    expect(j.initialized).toBe(true);
    expect(j.hasKnowledge).toBe(true);
    expect(j.knowledge.project).toContain("test project");
  });

  it("path 不存在 → 400", async () => {
    const res = mockRes();
    await handoverRoutes(mockReq("GET", `/api/coding-handover/bundle?path=/nonexistent-xyz`), res);
    expect(res.code).toBe(400);
  });
});
