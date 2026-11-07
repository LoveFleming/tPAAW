/**
 * Vision Phase 3 測試 — browser 截圖進 agent message + vision 自動路由 + requiresVision 派工
 * 跑法：node packages/server/test/vision-phase3.test.mjs
 * 全部 PASS 才算 Phase 3 完成（2026-08-30 Fleming 紀律：改 LLM 互動不要帶 bug）
 */
import { strict as assert } from "assert";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  extractImageMarkers,
  imageFileToDataUrl,
  buildImageAttachmentMessage,
  resolveVisionLlmConfig,
  visionAvailable,
} from "../src/lib/vision-content.mjs";

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

// ── extractImageMarkers ──
console.log("─ extractImageMarkers");
t("無 marker → 原字串、空陣列", () => {
  const r = extractImageMarkers("📸 Screenshot saved: /tmp/shot.png\n描述文字");
  assert.equal(r.text, "📸 Screenshot saved: /tmp/shot.png\n描述文字");
  assert.deepEqual(r.imagePaths, []);
});
t("單 marker → 抽出、清乾淨", () => {
  const r = extractImageMarkers("📸 saved: /tmp/a.png\n[[PAAW_IMAGE:/tmp/a.vision.jpg]]\ntail");
  assert.deepEqual(r.imagePaths, ["/tmp/a.vision.jpg"]);
  assert.ok(!r.text.includes("[[PAAW_IMAGE"), "marker 應被移除");
  assert.ok(r.text.includes("📸 saved: /tmp/a.png"));
  assert.ok(r.text.includes("tail"));
});
t("多 marker → 全抽出（未來多圖 tool）", () => {
  const r = extractImageMarkers("[[PAAW_IMAGE:/x/1.jpg]][[PAAW_IMAGE:/x/2.jpg]]");
  assert.deepEqual(r.imagePaths, ["/x/1.jpg", "/x/2.jpg"]);
  assert.equal(r.text.trim(), "");
});
t("路徑含空白/中文 → 仍可抽出", () => {
  const r = extractImageMarkers("[[PAAW_IMAGE:/Users/steward/App/我的 截圖.vision.jpg]]");
  assert.equal(r.imagePaths.length, 1);
  assert.ok(r.imagePaths[0].includes("我的"));
});

// ── imageFileToDataUrl ──
console.log("─ imageFileToDataUrl");
const _tmp = mkdtempSync(join(tmpdir(), "vision3-"));
const _jpg = join(_tmp, "shot.vision.jpg");
writeFileSync(_jpg, Buffer.from("/9j/4AAQSkZJRgABAQAAAgAAAgA=" ,"base64")); // 假 jpeg 內容
t("存在檔案 → data:image/jpeg URI", () => {
  const du = imageFileToDataUrl(_jpg);
  assert.ok(du.startsWith("data:image/jpeg;base64,"), du.slice(0, 30));
});
t("png 副檔名 → data:image/png", () => {
  const p = join(_tmp, "shot.png");
  writeFileSync(p, Buffer.from("iVBORw0KGgo=","base64"));
  const du = imageFileToDataUrl(p);
  assert.ok(du.startsWith("data:image/png;base64,"));
});
t("不存在 → null", () => {
  assert.equal(imageFileToDataUrl(join(_tmp, "nope.jpg")), null);
});
t("超過大小上限 → null（不炸）", () => {
  assert.equal(imageFileToDataUrl(_jpg, 4), null); // maxBytes=4 必超
});

// ── buildImageAttachmentMessage ──
console.log("─ buildImageAttachmentMessage");
t("一般 → user role + text part + image part", () => {
  const m = buildImageAttachmentMessage([_jpg], "📸 browser screenshot");
  assert.equal(m.role, "user");
  assert.ok(Array.isArray(m.content));
  assert.equal(m.content[0].type, "text");
  assert.equal(m.content[1].type, "image_url");
  assert.ok(m.content[1].image_url.url.startsWith("data:image/jpeg;base64,"));
});
t("空路徑陣列 → null（不推空訊息）", () => {
  assert.equal(buildImageAttachmentMessage([]), null);
});
t("含壞檔 → 只附好檔", () => {
  const m = buildImageAttachmentMessage([join(_tmp, "nope.jpg"), _jpg]);
  assert.equal(m.content.filter(p => p.type === "image_url").length, 1);
});

// ── resolveVisionLlmConfig / visionAvailable ──
console.log("─ resolveVisionLlmConfig（fixture providers.json）");
const _provFile = join(_tmp, "providers.json");
writeFileSync(_provFile, JSON.stringify({
  defaultModel: "glm-5.1",
  visionModel: "zai/glm-4.6v",
  providers: {
    zai: { baseURL: "https://api.z.ai/v1", apiKey: "sk-test", models: [
      { id: "glm-5.1", maxTokens: 65536 },
      { id: "glm-4.6v", vision: true, maxTokens: 8192 },
    ]},
    openrouter: { baseURL: "https://openrouter.ai/api/v1", apiKey: "sk-or-test", models: [] },
  },
}));
const _baseLlm = {
  apiUrl: "https://api.z.ai/v1/chat/completions",
  headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
  model: "glm-5.1", providerId: "zai", maxTokens: 65536, contextWindow: 262144,
  fallbacks: [],
};
t("無圖訊息 → null（不換）", () => {
  assert.equal(resolveVisionLlmConfig(_baseLlm, false, _provFile), null);
});
t("有圖 + visionModel 可用 → 換 config（maxTokens clamp 到 vision 上限）", () => {
  const c = resolveVisionLlmConfig(_baseLlm, true, _provFile);
  assert.ok(c, "應回傳 swapped config");
  assert.equal(c.model, "glm-4.6v");
  assert.equal(c.apiUrl, "https://api.z.ai/v1/chat/completions");
  assert.equal(c.providerId, "zai");
  // fixture：glm-4.6v maxTokens 8192、llm.maxTokens 65536、cap 32768 → 8192
  assert.equal(c.maxTokens, 8192);
  assert.equal(c.visionSwapped, true);
});
t("maxTokens hard cap 32768（e2e 實證：zai glm-4.6v 上限 32768，繼承 65536 會 400）", () => {
  writeFileSync(_provFile, JSON.stringify({
    visionModel: "zai/glm-4.6v",
    providers: { zai: { baseURL: "https://api.z.ai/v1", apiKey: "sk-test", models: [
      { id: "glm-4.6v", vision: true, maxTokens: 65536 },
    ]}},
  }));
  const c = resolveVisionLlmConfig(_baseLlm, true, _provFile);
  assert.equal(c.maxTokens, 32768);
});
t("modelDef 沒 maxTokens → 預設 16384（不繼承主 model 的大額度）", () => {
  writeFileSync(_provFile, JSON.stringify({
    visionModel: "zai/glm-4.6v",
    providers: { zai: { baseURL: "https://api.z.ai/v1", apiKey: "sk-test", models: [
      { id: "glm-4.6v", vision: true },
    ]}},
  }));
  const c = resolveVisionLlmConfig(_baseLlm, true, _provFile);
  assert.equal(c.maxTokens, 16384);
});
t("active model 已是 vision → null（不用換）", () => {
  const visionLlm = { ..._baseLlm, model: "glm-4.6v" };
  assert.equal(resolveVisionLlmConfig(visionLlm, true, _provFile), null);
});
t("visionModel provider 沒 key → null（寧可走原 model 被佔位保護）", () => {
  writeFileSync(_provFile, JSON.stringify({
    visionModel: "zai/glm-4.6v",
    providers: { zai: { baseURL: "https://api.z.ai/v1", apiKey: "na", models: [{ id: "glm-4.6v", vision: true }] } },
  }));
  assert.equal(resolveVisionLlmConfig(_baseLlm, true, _provFile), null);
});
t("沒設 visionModel → null", () => {
  writeFileSync(_provFile, JSON.stringify({ providers: { zai: { baseURL: "https://x", apiKey: "k", models: [] } } }));
  assert.equal(resolveVisionLlmConfig(_baseLlm, true, _provFile), null);
});
t("openrouter vision model → 帶 OR 專屬 headers", () => {
  writeFileSync(_provFile, JSON.stringify({
    visionModel: "openrouter/qwen/qwen3-vl-plus",
    providers: {
      zai: { baseURL: "https://api.z.ai/v1", apiKey: "sk", models: [] },
      openrouter: { baseURL: "https://openrouter.ai/api/v1", apiKey: "sk-or", models: [] },
    },
  }));
  const c = resolveVisionLlmConfig(_baseLlm, true, _provFile);
  assert.ok(c);
  assert.equal(c.headers["HTTP-Referer"], "https://paaw.ai");
  assert.equal(c.headers["X-Title"], "PAAW");
});
// 還原正常 fixture 供下面用
writeFileSync(_provFile, JSON.stringify({
  defaultModel: "glm-5.1",
  visionModel: "zai/glm-4.6v",
  providers: {
    zai: { baseURL: "https://api.z.ai/v1", apiKey: "sk-test", models: [
      { id: "glm-5.1", maxTokens: 65536 },
      { id: "glm-4.6v", vision: true, maxTokens: 8192 },
    ]},
  },
}));

console.log("─ visionAvailable（attach 前的閘門）");
t("active model vision-capable → true", () => {
  assert.equal(visionAvailable({ ..._baseLlm, model: "glm-4.6v" }, _provFile), true);
});
t("active 非 vision 但 visionModel 已設 → true（會被路由）", () => {
  assert.equal(visionAvailable(_baseLlm, _provFile), true);
});
t("都沒有 → false（marker 降級為文字提示）", () => {
  writeFileSync(_provFile, JSON.stringify({ providers: { zai: { baseURL: "https://x", apiKey: "k", models: [{ id: "glm-5.1" }] } } }));
  assert.equal(visionAvailable(_baseLlm, _provFile), false);
});

rmSync(_tmp, { recursive: true, force: true });
console.log(`\n═══ Vision Phase 3: ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
