/**
 * parse-model-reference.test.mjs — model 參照解析單元測試（2026-09-14 fix）
 *
 * 回歸場景（Fleming 回報）：coding app 選 model id 如 anthropic/claude-opus-4.8 時
 * LLM API 回 400。根因：server 端「第一段是已知 provider 就剝 prefix」把自帶
 * provider 前綴的 full-path model id 剝過頭（→ claude-opus-4.8 → unknown model）。
 *
 * 權威解析：parseModelReference（llm-utils.mjs）— 與 UI ModelSelector.parseValue 同邏輯。
 */
import { describe, it, expect } from "vitest";
import { parseModelReference } from "../../packages/server/src/lib/llm-utils.mjs";

const CONFIG = {
  active: "zai",
  defaultModel: "glm-5.1",
  providers: {
    zai: { baseURL: "https://api.z.ai/api/coding/paas/v4", apiKey: "k", models: [{ id: "glm-5.1" }, { id: "glm-5" }] },
    openrouter: { baseURL: "https://openrouter.ai/api/v1", apiKey: "k", models: [{ id: "moonshotai/kimi-k2.6" }, { id: "z-ai/glm-5.1" }] },
    // Fleming 機器配置：OpenAI 相容 gateway，model id 是 full-path
    anthropic: { baseURL: "https://gw.example.com/v1", apiKey: "k", models: [{ id: "anthropic/opus4.6" }, { id: "anthropic/claude-opus-4.8" }] },
  },
};

describe("parseModelReference", () => {
  it("一般：provider + 短 model id", () => {
    expect(parseModelReference(CONFIG, "zai/glm-5.1")).toEqual({ providerId: "zai", model: "glm-5.1" });
  });

  it("🔴 回歸案例：full-path model id 列在 provider 清單 → 保留整串（不剝過頭）", () => {
    expect(parseModelReference(CONFIG, "anthropic/claude-opus-4.8")).toEqual({
      providerId: "anthropic",
      model: "anthropic/claude-opus-4.8",
    });
  });

  it("full-path 風格 provider + 未列出的自訂 model → 保留整串", () => {
    expect(parseModelReference(CONFIG, "anthropic/brand-new-model")).toEqual({
      providerId: "anthropic",
      model: "anthropic/brand-new-model",
    });
  });

  it("openrouter + 列在清單的 full-path model id", () => {
    expect(parseModelReference(CONFIG, "openrouter/moonshotai/kimi-k2.6")).toEqual({
      providerId: "openrouter",
      model: "moonshotai/kimi-k2.6",
    });
  });

  it("openrouter + 未列的 full-path model id（清單無 openrouter/ 前綴風格）→ 整串保留", () => {
    expect(parseModelReference(CONFIG, "openrouter/anthropic/claude-opus-4.8")).toEqual({
      providerId: "openrouter",
      model: "anthropic/claude-opus-4.8",
    });
  });

  it("純 model id → active provider", () => {
    expect(parseModelReference(CONFIG, "glm-5.1")).toEqual({ providerId: "zai", model: "glm-5.1" });
  });

  it("第一段非已知 provider → 整串 model id 走 active", () => {
    expect(parseModelReference(CONFIG, "deepseek/deepseek-v4-flash")).toEqual({
      providerId: "zai",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("已知 provider + custom model（清單非 full-path 風格）→ 剝 prefix（舊行為）", () => {
    expect(parseModelReference(CONFIG, "zai/custom-xyz")).toEqual({ providerId: "zai", model: "custom-xyz" });
  });
});

describe("parseModelReference — 2026-09-23 bare id 跨 provider 自動路由（公司 gpt5.6 事件）", () => {
  const CFG2 = {
    active: "glm",
    defaultModel: "glm5.2",
    providers: {
      glm: { baseURL: "https://gw/v1", apiKey: "k", models: [{ id: "glm5.2" }] },
      gpt: { baseURL: "https://gw2/v1", apiKey: "k", models: [{ id: "gpt5.6" }, { id: "gpt5.6-mini" }] },
    },
  };

  it("🔴 回歸案例：bare id 在非 active provider → 自動路由到擁有者（不再送錯 provider 400）", () => {
    expect(parseModelReference(CFG2, "gpt5.6")).toEqual({ providerId: "gpt", model: "gpt5.6" });
  });

  it("bare id 在 active provider 清單 → 照舊走 active（不誤路由）", () => {
    expect(parseModelReference(CFG2, "glm5.2")).toEqual({ providerId: "glm", model: "glm5.2" });
  });

  it("bare id 沒有任何 provider 擁有 → 照舊走 active（custom id 直送）", () => {
    expect(parseModelReference(CFG2, "aigw_gpt5.6-terra")).toEqual({ providerId: "glm", model: "aigw_gpt5.6-terra" });
  });

  it("整串 full-path（第一段非 provider）恰為某 provider 的 model id → 路由過去", () => {
    expect(parseModelReference(CFG2, "gpt/gpt5.6")).toEqual({ providerId: "gpt", model: "gpt5.6" });
  });
});
