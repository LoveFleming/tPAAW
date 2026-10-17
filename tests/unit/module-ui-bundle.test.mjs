/**
 * module-ui-bundle 測試（2026-10-17，TASK-102 / F20261016-059）

 * 背景：Module UI Runtime Loader 讓 installed-apps/<id>/ui/pages/*.tsx 免 rebuild 載入。
 * server 端以 esbuild 即時 bundle（module-ui-bundle.mjs），前端 moduleRuntime.ts 消費。
 *
 * 本測試覆蓋 server 端 bundle 的：
 *   1. 輸入驗證（id / page 白名單）— 安全護欄，防路徑穿越與非法輸入
 *   2. 檔案不存在 → 明確錯誤
 *   3. 主要路徑：成功 bundle 真實模組頁，且回傳 { ok, js, specifiers } 契約
 *      — 契約若變動，前端 moduleRuntime.ts 會直接壞掉（B4 缺測試的核心風險）
 *   4. external 改寫：react / @paaw-ui/* 應被標成 paaw-sdk: specifier
 *   5. mtime 快取：同檔重複呼叫回同一物件（deterministic，不重跑 esbuild）
 */
import { describe, it, expect } from "vitest";
import { bundleModuleUi } from "../../packages/server/src/lib/module-ui-bundle.mjs";

describe("bundleModuleUi — 輸入驗證（安全護欄）", () => {
  it("非法 id（路徑穿越 / 大寫 / 空白）一律擋下", async () => {
    for (const bad of ["../etc", "Learning", "a b", "", "UPPER", "id/../x", null, undefined]) {
      const r = await bundleModuleUi(bad, "Main");
      expect(r.ok, `id=${bad}`).toBe(false);
      expect(typeof r.error).toBe("string");
    }
  });

  it("非法 page（穿越 / 小寫 / dash）一律擋下", async () => {
    for (const bad of ["../Main", "main", "Main-Page", "", null, undefined]) {
      const r = await bundleModuleUi("learning", bad);
      expect(r.ok, `page=${bad}`).toBe(false);
      expect(typeof r.error).toBe("string");
    }
  });

  it("合法 id/page 但檔案不存在 → 明確錯誤（非 throw）", async () => {
    const r = await bundleModuleUi("learning", "NoSuchPage");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("NoSuchPage");
  });
});

describe("bundleModuleUi — 主要路徑（真實模組頁）", () => {
  it("learning/LearningSpace 成功 bundle，回傳 { ok, js, specifiers } 契約", async () => {
    const r = await bundleModuleUi("learning", "LearningSpace");
    expect(r.ok).toBe(true);
    // 前端 moduleRuntime.ts 直接依賴這三個欄位
    expect(typeof r.js).toBe("string");
    expect(r.js.length).toBeGreaterThan(0);
    expect(Array.isArray(r.specifiers)).toBe(true);
  });

  it("react / @paaw-ui/* 被標成 paaw-sdk: external（保證單一 React 實例）", async () => {
    const r = await bundleModuleUi("learning", "LearningSpace");
    expect(r.ok).toBe(true);
    // specifiers 內應含 react 與（若有使用）@paaw-ui/*，且 js 中已改寫為 paaw-sdk: 前綴
    expect(r.specifiers.some((s) => s === "react" || s.startsWith("react"))).toBe(true);
    expect(r.js).toContain("paaw-sdk:");
  });

  it("mtime 快取：同檔連續兩次回同一物件（不重跑 esbuild）", async () => {
    const a = await bundleModuleUi("learning", "LearningSpace");
    const b = await bundleModuleUi("learning", "LearningSpace");
    expect(a).toBe(b);
  });
});
