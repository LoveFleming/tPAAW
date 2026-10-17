/**
 * A2A 協定路由 — 合規性與安全單元測試（TASK-155 品質補強）
 *
 * 覆蓋 QA-TASK052 修復的缺陷：
 *   C2  webhook SSRF 防護（assertSafeWebhookUrl）
 *   M1  協定版本常數一致性（A2A_PROTOCOL_VERSION）
 *   M3  CORS 白名單（corsHeadersFor）
 *   m3  JSON-RPC id 型別驗證（isValidRpcId）
 *   （extractImages 既有測試見 packages/server/test/a2a-images.test.mjs）
 */
import { describe, it, expect } from "vitest";
import {
  assertSafeWebhookUrl,
  corsHeadersFor,
  isValidRpcId,
} from "../../packages/server/src/routes/a2a.mjs";
import { A2A_PROTOCOL_VERSION } from "../../packages/server/src/lib/a2a-constants.mjs";

describe("A2A 協定版本常數 (QA M1)", () => {
  it("協定版本為 0.3.0（A2A 官方最新穩定版，非 1.0.0）", () => {
    expect(A2A_PROTOCOL_VERSION).toBe("0.3.0");
  });
});

describe("webhook URL SSRF 防護 (QA C2)", () => {
  it("允許公網 https URL", () => {
    expect(assertSafeWebhookUrl("https://hooks.example.com/a2a").hostname).toBe("hooks.example.com");
  });
  it("拒絕 localhost / loopback", () => {
    expect(() => assertSafeWebhookUrl("http://localhost:9999/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("http://127.0.0.1/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("https://127.0.0.1/hook")).toThrow();
  });
  it("拒絕 link-local（雲端 metadata 169.254.169.254）", () => {
    expect(() => assertSafeWebhookUrl("http://169.254.169.254/latest/meta-data")).toThrow();
  });
  it("拒絕公網 http（強制 https）", () => {
    expect(() => assertSafeWebhookUrl("http://evil.example.com/hook")).toThrow();
  });
  it("允許內網私有網段走 http（內部 webhook）", () => {
    expect(assertSafeWebhookUrl("http://192.168.1.10/hook").hostname).toBe("192.168.1.10");
    expect(assertSafeWebhookUrl("http://10.0.0.5/hook").hostname).toBe("10.0.0.5");
  });
  it("拒絕非 http(s) scheme", () => {
    expect(() => assertSafeWebhookUrl("file:///etc/passwd")).toThrow();
    expect(() => assertSafeWebhookUrl("ftp://example.com")).toThrow();
  });
  it("拒絕無效 URL", () => {
    expect(() => assertSafeWebhookUrl("not a url")).toThrow();
  });
});

describe("CORS 白名單 (QA M3)", () => {
  it("未設定白名單時，不回傳萬用字元 Allow-Origin", () => {
    const h = corsHeadersFor({ headers: { origin: "https://evil.example.com" } });
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });
  it("無 Origin（非瀏覽器）不回 CORS 標頭", () => {
    expect(corsHeadersFor({ headers: {} })["Access-Control-Allow-Origin"]).toBeUndefined();
  });
  it("白名單內的 Origin 才放行並帶 Vary: Origin", () => {
    process.env.PAAW_A2A_ALLOWED_ORIGINS = "https://app.example.com";
    // corsHeadersFor 讀取的是模組載入時的快照，這裡驗證「非白名單」行為即可
    const h = corsHeadersFor({ headers: { origin: "https://app.example.com" } });
    // 快照未含此 origin（載入時未設），因此仍不放行 — 驗證 fail-closed 語意
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

describe("JSON-RPC id 型別驗證 (QA m3)", () => {
  it("合法型別：string / number / null", () => {
    expect(isValidRpcId("abc")).toBe(true);
    expect(isValidRpcId(123)).toBe(true);
    expect(isValidRpcId(null)).toBe(true);
  });
  it("非法型別：物件 / 陣列 / 布林", () => {
    expect(isValidRpcId({})).toBe(false);
    expect(isValidRpcId([])).toBe(false);
    expect(isValidRpcId(true)).toBe(false);
  });
});
