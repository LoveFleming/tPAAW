/**
 * Mind Map API — AI 生成心智圖
 *
 * AI 輸出 Markdown，前端用 markmap-view 渲染。
 *
 * POST /api/mindmap/generate   — 從檔案/目錄產生
 * POST /api/mindmap/from-text  — 從文字產生
 * GET  /api/mindmap/list       — 列出已存檔
 * GET  /api/mindmap/get?id=    — 載入
 * POST /api/mindmap/save       — 儲存
 */

import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { resolve, join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { callLLMWithRetry, sanitizeContent, isMeaningfulContent } from "../lib/llm-utils.mjs";
import { readBody } from "./shared.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../../");
const MINDMAP_DIR = resolve(PAAW_ROOT, "data/mindmaps");
const SYSTEM_PROMPT_PATH = resolve(PAAW_ROOT, "data/ai-settings/mindmap/system-prompt.md");

// ── 載入系統提示詞 ──

function getSystemPrompt() {
  try {
    return readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  } catch {
    return "你是心智圖產生器。請將收到的內容整理成 Markdown 格式的心智圖。只輸出 Markdown。";
  }
}

// ── 檔案讀取 ──

const READABLE_EXTS = new Set([
  ".md", ".txt", ".json", ".js", ".mjs", ".ts", ".tsx", ".jsx",
  ".yaml", ".yml", ".html", ".css", ".xml", ".csv", ".svg",
  ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h",
]);

const MAX_FILE_SIZE = 100 * 1024;
const MAX_TOTAL_SIZE = 500 * 1024;
const MAX_FILES = 20;

async function readFilesForMindmap(files) {
  const results = [];
  let totalSize = 0;
  for (const filePath of files.slice(0, MAX_FILES)) {
    const absPath = resolve(filePath);
    const ext = extname(absPath).toLowerCase();
    if (!READABLE_EXTS.has(ext)) {
      results.push(`--- ${filePath} （略過：不支援的格式 ${ext}）---\n`);
      continue;
    }
    try {
      const content = await readFile(absPath, "utf-8");
      const truncated = content.length > MAX_FILE_SIZE
        ? content.slice(0, MAX_FILE_SIZE) + "\n... (截斷)"
        : content;
      totalSize += truncated.length;
      results.push(`--- ${filePath} ---\n${truncated}\n`);
      if (totalSize > MAX_TOTAL_SIZE) {
        results.push(`\n--- 達到總大小上限 (${MAX_TOTAL_SIZE / 1024}KB)，停止讀取 ---`);
        break;
      }
    } catch (err) {
      results.push(`--- ${filePath} （讀取失敗：${err.message}）---\n`);
    }
  }
  return results.join("\n");
}

async function readDirectoryForMindmap(dirPath) {
  const absPath = resolve(dirPath);
  const files = [];
  async function scan(dir, depth) {
    if (depth > 3) return;
    const IGNORED = new Set([".git", "node_modules", ".DS_Store", ".cache", ".vite", "dist", "build"]);
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath, depth + 1);
      } else if (READABLE_EXTS.has(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  await scan(absPath, 0);
  return readFilesForMindmap(files);
}

// ── 清理 LLM 回應 ──

function cleanMarkdownResponse(content) {
  if (!content) return "";
  let cleaned = sanitizeContent(content);
  // 移除可能的 markdown code fence（保留內容）
  cleaned = cleaned.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  return cleaned.trim();
}

// ── Provider 解析 ──

function loadProviderConfig() {
  const configPath = resolve(PAAW_ROOT, "data/config/providers.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

function resolveLLM(modelOverride) {
  const config = loadProviderConfig();
  if (!config) throw new Error("No provider config found");
  let providerId = config.active;
  let modelId = modelOverride || resolveDefaultModel(config);
  if (modelOverride && modelOverride.includes("/")) {
    const idx = modelOverride.indexOf("/");
    providerId = modelOverride.slice(0, idx);
    modelId = modelOverride.slice(idx + 1);
  } else if (!modelOverride && modelId.includes("/")) {
    // defaultModel has no provider prefix — use active provider
    modelId = modelId.includes("/") ? modelId.split("/").pop() : modelId;
  }
  const provider = config.providers?.[providerId];
  if (!provider) throw new Error(`Provider '${providerId}' not found`);
  const model = modelId;
  const baseURL = provider.baseURL.replace(/\/+$/, "");
  const apiUrl = `${baseURL}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://paaw.ai";
    headers["X-Title"] = "PAAW";
  }
  return { apiUrl, headers, model };
}

// ── 呼叫 LLM 產生心智圖 ──

async function generateMindMap(userPrompt, content, modelOverride) {
  const llm = resolveLLM(modelOverride);
  const fullPrompt = `${userPrompt}\n\n---\n以下是要整理的內容：\n\n${content}`;

  // Build full system context + mindmap-specific prompt
  let systemPrompt = getSystemPrompt();
  try {
    const { contextEngine } = await import("../context-engine.mjs");
    const ctx = await contextEngine.build({ target: "mindmap" });
    systemPrompt = ctx.systemPrompt || systemPrompt;
  } catch {}

  const result = await callLLMWithRetry(llm.apiUrl, llm.headers, {
    model: llm.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: fullPrompt },
    ],
    max_tokens: 4096,
  }, {
    maxRetries: 3,
    timeoutMs: 900_000,
    validateContent: true,
    sanitize: true,
    caller: "mindmap",
    agentId: "assistant",
    fallbacks: llm.fallbacks || [],
  });

  const markdown = cleanMarkdownResponse(result.content);
  if (!markdown || !markdown.startsWith("#")) {
    throw new Error("AI 回應格式不正確，無法解析為心智圖");
  }
  return markdown;
}

// ── Route Handler ──

async function handleMindMapRoutes(req, res) {
  // POST /api/mindmap/preview — show final prompts without calling LLM
  if (req.method === "POST" && req.url?.startsWith("/api/mindmap/preview")) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }
    const { text, prompt = "請整理這份內容的知識結構，做成心智圖", model } = body;
    try {
      const llm = resolveLLM(model);
      const fullUserPrompt = `${prompt}\n\n---\n以下是要整理的內容：\n\n${(text || "(未提供內容)").slice(0, MAX_TOTAL_SIZE)}`;
      let systemPrompt = getSystemPrompt();
      try {
        const { contextEngine } = await import("../context-engine.mjs");
        const ctx = await contextEngine.build({ target: "mindmap" });
        systemPrompt = ctx.systemPrompt || systemPrompt;
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, systemPrompt, userPrompt: fullUserPrompt, model: `${llm.apiUrl} → ${llm.model}` }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/mindmap/generate
  if (req.method === "POST" && req.url?.startsWith("/api/mindmap/generate")) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const { files = [], dir, prompt = "請整理這份內容的知識結構，做成心智圖", model } = body;

    try {
      let content;
      if (dir) {
        content = await readDirectoryForMindmap(dir);
      } else if (files.length > 0) {
        content = await readFilesForMindmap(files);
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "請提供 files 或 dir 參數" }));
        return true;
      }

      if (!content || content.trim().length < 10) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "讀取到的內容為空" }));
        return true;
      }

      const markdown = await generateMindMap(prompt, content, model);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, markdown }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/mindmap/from-text
  if (req.method === "POST" && req.url?.startsWith("/api/mindmap/from-text")) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const { text, prompt = "請整理這份內容的知識結構，做成心智圖" } = body;

    if (!text || text.trim().length < 10) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "文字內容太短" }));
      return true;
    }

    try {
      const markdown = await generateMindMap(prompt, text.slice(0, MAX_TOTAL_SIZE), body.model);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, markdown }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/mindmap/chat — AI chat with mindmap + source context
  if (req.method === "POST" && req.url?.startsWith("/api/mindmap/chat")) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }
    const { message, history = [], sourceContent = "", mindmapMarkdown = "", model } = body;
    if (!message || !message.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing message" }));
      return true;
    }
    try {
      const llm = resolveLLM(model);
      let systemPrompt = getSystemPrompt();
      try {
        const { contextEngine } = await import("../context-engine.mjs");
        const ctx = await contextEngine.build({ target: "mindmap" });
        systemPrompt = ctx.systemPrompt || systemPrompt;
      } catch {}
      // Append context: mindmap + source data
      const contextParts = [];
      if (mindmapMarkdown) {
        contextParts.push(`--- 當前心智圖結構 ---\n${mindmapMarkdown}`);
      }
      if (sourceContent) {
        const truncated = sourceContent.length > 20000 ? sourceContent.slice(0, 20000) + "\n...(截斷)" : sourceContent;
        contextParts.push(`--- 原始資料 ---\n${truncated}`);
      }
      const fullSystem = systemPrompt + (contextParts.length ? "\n\n以下是目前的討論背景資料：\n\n" + contextParts.join("\n\n") : "") + "\n\n請根據以上資料回答使用者的問題。可以引用心智圖結構或原始資料的內容來支持你的回答。";
      const messages = [
        { role: "system", content: fullSystem },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: message },
      ];
      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, {
        model: llm.model,
        messages,
        max_tokens: 4096,
      }, {
        maxRetries: 2,
        timeoutMs: 120_000,
        validateContent: true,
        sanitize: true,
        caller: "mindmap-chat",
        agentId: "assistant",
        fallbacks: llm.fallbacks || [],
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, content: result.content }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/mindmap/list
  if (req.method === "GET" && req.url?.startsWith("/api/mindmap/list")) {
    try {
      if (!existsSync(MINDMAP_DIR)) {
        await mkdir(MINDMAP_DIR, { recursive: true });
      }
      const files = await readdir(MINDMAP_DIR);
      const mindmaps = [];
      for (const f of files.filter(f => f.endsWith(".json"))) {
        try {
          const data = JSON.parse(await readFile(join(MINDMAP_DIR, f), "utf-8"));
          mindmaps.push({
            id: f.replace(".json", ""),
            name: data.name || f,
            summary: data.summary || "",
            createdAt: data.createdAt,
          });
        } catch {}
      }
      mindmaps.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ mindmaps }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/mindmap/save
  if (req.method === "POST" && req.url?.startsWith("/api/mindmap/save")) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const { name, markdown } = body;
    if (!name || !markdown) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing name or markdown" }));
      return true;
    }

    try {
      if (!existsSync(MINDMAP_DIR)) {
        await mkdir(MINDMAP_DIR, { recursive: true });
      }
      const id = name.replace(/[^\w\u4e00-\u9fff-]/g, "_").slice(0, 50);
      const filePath = join(MINDMAP_DIR, `${id}.json`);
      const data = {
        id,
        name,
        markdown,
        createdAt: new Date().toISOString(),
      };
      await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, id, path: filePath }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/mindmap/get?id=...
  if (req.method === "GET" && req.url?.startsWith("/api/mindmap/get")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const id = params.get("id");
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing id" }));
      return true;
    }
    try {
      const filePath = join(MINDMAP_DIR, `${id}.json`);
      const data = JSON.parse(await readFile(filePath, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Mind map not found" }));
    }
    return true;
  }

  return false;
}

export default handleMindMapRoutes;
