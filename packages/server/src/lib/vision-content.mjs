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

// ══════════════════════════════════════════════════════════════
// Phase 3（2026-08-30）— tool 截圖進 agent message + agent loop vision 路由
// ══════════════════════════════════════════════════════════════

/** tool result 裡的圖片附件標記：[[PAAW_IMAGE:<絕對路徑>]]（支援多個） */
export const IMAGE_MARKER_RE = /\[\[PAAW_IMAGE:([^\]\n]+?)\]\]/g;

/** 附加圖大小上限（base64 前的原始檔；jpeg q80 viewport 截圖通常 < 500KB） */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 副檔名 → data URI mime（未知副檔名不夾） */
function _imageMime(p) {
  const m = /\.(jpe?g|png|webp|gif)$/i.exec(p || "");
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return `image/${ext}`;
}

/**
 * 從 tool result 字串抽出圖片標記。
 * 回傳 { text, imagePaths }：text 是移除標記後的乾淨結果、imagePaths 是標記路徑陣列。
 */
export function extractImageMarkers(text) {
  const src = String(text || "");
  if (!src.includes("[[PAAW_IMAGE:")) return { text: src, imagePaths: [] };
  const imagePaths = [];
  const text2 = src.replace(IMAGE_MARKER_RE, (_, p) => {
    imagePaths.push(p.trim());
    return "";
  });
  // 清掉標記行留下的空行殘渣（只壓標記造成的連續空行，不動原文格式）
  return { text: text2.replace(/\n{3,}/g, "\n\n").trimEnd(), imagePaths };
}

/** 讀圖檔 → data URI。不存在/副檔名不認/超過 maxBytes → null（不 throw） */
export function imageFileToDataUrl(absPath, maxBytes = MAX_IMAGE_BYTES) {
  try {
    const mime = _imageMime(absPath);
    if (!mime) return null;
    const buf = readFileSync(absPath);
    if (!buf || buf.length === 0 || buf.length > maxBytes) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

/**
 * 把圖檔包成 agent message（user role + array content — OpenAI vision 格式）。
 * 一張讀不進來就略過那張；全部失敗/空陣列 → null。
 * label 是給模型看的文字說明（標明這是系統附圖，不是使用者說的話）。
 */
export function buildImageAttachmentMessage(absPaths, label = "📸 [系統附圖]") {
  const parts = [{ type: "text", text: label }];
  let n = 0;
  for (const p of absPaths || []) {
    const du = imageFileToDataUrl(p);
    if (du) { parts.push({ type: "image_url", image_url: { url: du } }); n++; }
  }
  if (n === 0) return null;
  return { role: "user", content: parts };
}

/**
 * agent loop 的 vision 路由（Phase 3）：
 * 訊息含圖 + active model 非 vision + providers.json 有設 visionModel（provider 有 key）
 * → 回傳替換用 LLM config（apiUrl/headers/model/maxTokens 繼承）。
 * 其他情況回 null（照原 model 走 — 含圖歷史由 messagesForModel 佔位保護）。
 *
 * @param {object} llm 現行 resolveLLMConfig 結果
 * @param {boolean} messagesHaveImages hasImages(messages) 的結果
 * @param {string|null} providersFile 測試用 fixture 路徑
 */
export function resolveVisionLlmConfig(llm, messagesHaveImages, providersFile = null) {
  if (!llm || !messagesHaveImages) return null;
  if (isVisionModel(llm.model, providersFile)) return null; // 已是 vision model，不用換
  const vm = getVisionModel(providersFile);
  if (!vm || !vm.includes("/")) return null;
  const path = providersFile || resolve(DATA_HOME, "config", "providers.json");
  let config;
  try { config = JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
  const i = vm.indexOf("/");
  const providerId = vm.slice(0, i);
  const model = vm.slice(i + 1);
  const p = config.providers?.[providerId];
  if (!p?.baseURL || !p.apiKey || p.apiKey === "na") return null;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` };
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://paaw.ai";
    headers["X-Title"] = "PAAW";
  }
  const modelDef = (p.models || []).find(m => (typeof m === "string" ? m : m.id) === model);
  // Vision model 實測 API 上限普遍較低（zai glm-4.6v = 32768，2026-08-30 e2e 實證 400 code 1210）
  // 策略：modelDef.maxTokens 優先，永遠 clamp 到 cap；沒設就給 16384（視覺描述輪不需要大輸出）
  const VISION_OUTPUT_CAP = 32768;
  const defMax = (typeof modelDef === "object" ? modelDef?.maxTokens : null) || 16384;
  const maxTokens = Math.min(defMax, llm.maxTokens || defMax, VISION_OUTPUT_CAP);
  return {
    apiUrl: `${p.baseURL.replace(/\/+$/, "")}/chat/completions`,
    headers, model, providerId,
    maxTokens,
    contextWindow: llm.contextWindow,
    fallbacks: llm.fallbacks, // 429 fallback 鏈照舊（非 vision fallback 由佔位保護接手）
    visionSwapped: true,
  };
}

/**
 * attach 前的閘門：這個 run 有沒有「看圖能力」。
 * active model 是 vision，或 visionModel 可路由 → true。
 * false 時 tool 的圖片標記降級為純文字提示（不白附 base64）。
 */
export function visionAvailable(llm, providersFile = null) {
  if (isVisionModel(llm?.model, providersFile)) return true;
  const vm = getVisionModel(providersFile);
  if (!vm || !vm.includes("/")) return false;
  // 確認 provider 有 key（跟 resolveVisionLlmConfig 同步的判斷）
  const path = providersFile || resolve(DATA_HOME, "config", "providers.json");
  try {
    const config = JSON.parse(readFileSync(path, "utf-8"));
    const p = config.providers?.[vm.slice(0, vm.indexOf("/"))];
    return !!(p?.baseURL && p.apiKey && p.apiKey !== "na");
  } catch { return false; }
}
