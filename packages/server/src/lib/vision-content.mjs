/**
 * Vision / 多模態內容處理（2026-08-30 Phase 1 地基）
 *
 * 設計文件：memory/paaw-docs/architecture/VISION_MULTIMODAL_DESIGN.md
 *
 * 職責（單一事實來源 — 所有處理 content array 的地方都用這裡）：
 * 1. contentToText() — array content → 純文字（估算/摘要/log 用）
 * 2. hasImages() — 訊息陣列是否含圖
 * 3. estimateContentTokens() — string/array 通吃（圖一張 ~1600 tok，q80 1568px 壓縮檔的經驗值）
 * 4. messagesForModel() — 非 vision model 收到含圖歷史 → 圖換佔位文字（防 400）
 * 5. isVisionModel() — 查 providers.json 的 model.vision flag
 *
 * ⚠️ 這裡不改 chat 訊息本身（storage 保持原樣），只在送 LLM 前的瞬間轉換
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { DATA_HOME } from "../data-home.mjs";
import { estimateTokens } from "./context-truncation.mjs";

/** 每張圖的 token 估算（client 端已壓縮：長邊 1568px jpeg q80 ≈ 1100-1700 tok） */
const IMAGE_TOKEN_ESTIMATE = 1600;

/**
 * OpenAI vision content array → 純文字表示
 * [{type:"text",text}, {type:"image_url",image_url:{url}}] → "text [+N 張圖]"
 * string 直接回傳。null/undefined → ""
 */
export function contentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = [];
    let images = 0;
    for (const part of content) {
      if (part?.type === "text" && part.text) parts.push(part.text);
      else if (part?.type === "image_url") images++;
    }
    const text = parts.join("\n");
    return images > 0 ? (text ? `${text} [+${images} 張圖]` : `[+${images} 張圖]`) : text;
  }
  return String(content);
}

/** 訊息陣列中任何一則的 content array 含 image_url part → true */
export function hasImages(messages) {
  return (messages || []).some(m => Array.isArray(m?.content) && m.content.some(p => p?.type === "image_url"));
}

/** 數 content 的 token（string 或 array；array 會把每張圖算 IMAGE_TOKEN_ESTIMATE） */
export function estimateContentTokens(content) {
  if (content == null) return 0;
  if (typeof content === "string") return estimateTokens(content);
  if (Array.isArray(content)) {
    let t = 0;
    for (const part of content) {
      if (part?.type === "text" && part.text) t += estimateTokens(part.text);
      else if (part?.type === "image_url") t += IMAGE_TOKEN_ESTIMATE;
    }
    return t;
  }
  return 0;
}

/**
 * 送 LLM 前的最後一關：
 * - model 支援 vision → 原封不動
 * - 不支援但歷史有圖 → 每個 image part 換成文字佔位（防 API 400）
 * 回傳新陣列（淺拷貝，不動原訊息）
 */
export function messagesForModel(messages, modelSupportsVision) {
  if (modelSupportsVision || !Array.isArray(messages) || !hasImages(messages)) return messages;
  return messages.map(m => {
    if (!Array.isArray(m?.content)) return m;
    return {
      ...m,
      content: m.content.map(p =>
        p?.type === "image_url"
          ? { type: "text", text: "[圖片：此模型不支援影像輸入，已省略]" }
          : p
      ),
    };
  });
}

/**
 * 查 model 是否 vision-capable。
 * 掃所有 provider 的 model 清單找 id === model 且 vision === true
 * （callLLM 只有 model 字串，沒有 providerId — id 對得上就用）
 */
export function isVisionModel(model, providersFile = null) {
  if (!model) return false;
  const path = providersFile || resolve(DATA_HOME, "config", "providers.json");
  try {
    const cfg = JSON.parse(readFileSync(path, "utf-8"));
    for (const p of Object.values(cfg.providers || {})) {
      for (const m of p.models || []) {
        if (typeof m === "object" && m.id === model && m.vision === true) return true;
      }
    }
  } catch {}
  return false;
}

/** 讀全域 vision 路由目標（"providerId/modelId"），沒設回 null */
export function getVisionModel(providersFile = null) {
  const path = providersFile || resolve(DATA_HOME, "config", "providers.json");
  try {
    const cfg = JSON.parse(readFileSync(path, "utf-8"));
    return cfg.visionModel || null;
  } catch { return null; }
}
