/**
 * AI SDK Helpers — Shared utilities for Vercel AI SDK across PAAW routes.
 *
 * Replaces raw fetch + callLLMWithRetry patterns with AI SDK generateText.
 */
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { readFile } from "fs/promises";
import { resolve } from "path";

/**
 * Load provider config from PAAW data dir.
 */
export async function loadProviderConfig(rootDir) {
  const configPath = resolve(rootDir, "data/config/providers.json");
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Create an AI SDK model from PAAW provider config.
 * Returns { model, providerId, modelName }
 */
export async function createAIModel(rootDir, modelOverride) {
  const config = await loadProviderConfig(rootDir);

  let providerId = config.active;
  let model = modelOverride || config.defaultModel || "glm-5.1";

  // Handle "providerId/modelId" format — only if first segment is a known provider
  if (model.includes("/")) {
    const idx = model.indexOf("/");
    const possibleProvider = model.slice(0, idx);
    if (config.providers[possibleProvider]) {
      providerId = possibleProvider;
      model = model.slice(idx + 1);
    }
    // else: leave model as-is (e.g. "deepseek/deepseek-v4-flash" under openrouter)
  }

  const provider = config.providers[providerId];
  if (!provider) throw new Error(`Provider '${providerId}' not found`);
  if (!provider.apiKey || provider.apiKey === "na") {
    throw new Error(`No API key for provider: ${providerId}`);
  }

  const openai = createOpenAI({
    baseURL: provider.baseURL.replace(/\/+$/, ""),
    apiKey: provider.apiKey,
    headers: providerId === "openrouter"
      ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" }
      : undefined,
  });

  return { model: openai(model), providerId, modelName: model };
}

/**
 * Simple LLM call via AI SDK — drop-in replacement for callLLMWithRetry.
 *
 * @param {string} rootDir - PAAW root dir
 * @param {object|string} input - { system, messages } or just messages array, or a prompt string
 * @param {object} options - { model, temperature, maxOutputTokens }
 * @returns {Promise<string>} - generated text
 */
export async function paawGenerate(rootDir, input, options = {}) {
  const { model: aiModel } = await createAIModel(rootDir, options.model);

  let system = undefined;
  let messages = [];

  if (typeof input === "string") {
    messages = [{ role: "user", content: input }];
  } else if (Array.isArray(input)) {
    // Extract system message (AI SDK requires it separately)
    messages = input.filter(m => {
      if (m.role === "system") {
        system = (system || "") + (system ? "\n" : "") + m.content;
        return false;
      }
      return true;
    });
  } else if (input.system || input.messages) {
    system = input.system;
    messages = input.messages || [];
  }

  const { text } = await generateText({
    model: aiModel,
    system,
    messages,
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: options.maxOutputTokens ?? 4096,
  });

  return text || "";
}
