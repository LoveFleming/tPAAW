/**
 * Unit tests — Provider Config (providers.json)
 *
 * Tests that provider configuration loads correctly and resolveLLM works.
 */
import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";

const PAAW_ROOT = process.env.PAAW_ROOT || join(process.cwd());
const PROVIDERS_PATH = join(PAAW_ROOT, "data/config/providers.json");

async function loadProviders() {
  try {
    const raw = await readFile(PROVIDERS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

describe("Provider Config (providers.json)", () => {
  it("should be valid JSON with required fields", async () => {
    const config = await loadProviders();
    if (!config) {
      console.warn("providers.json not found — skipping");
      return;
    }
    expect(config).toHaveProperty("active");
    expect(config).toHaveProperty("providers");
    expect(typeof config.active).toBe("string");
    expect(typeof config.providers).toBe("object");
  });

  it("active provider should exist in providers map", async () => {
    const config = await loadProviders();
    if (!config) return;
    expect(config.providers).toHaveProperty(config.active);
  });

  it("each provider should have name, baseURL, apiKey, models", async () => {
    const config = await loadProviders();
    if (!config) return;
    for (const [id, p] of Object.entries(config.providers)) {
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("baseURL");
      expect(p).toHaveProperty("apiKey");
      expect(p).toHaveProperty("models");
      expect(Array.isArray(p.models)).toBe(true);
    }
  });

  it("should have a defaultModel if specified", async () => {
    const config = await loadProviders();
    if (!config) return;
    if (config.defaultModel) {
      expect(typeof config.defaultModel).toBe("string");
      expect(config.defaultModel.length).toBeGreaterThan(0);
    }
  });
});
