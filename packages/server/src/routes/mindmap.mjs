/**
 * Mind Map API — AI 生成心智圖
 *
 * POST /api/mindmap/generate
 *   body: { files: string[], prompt: string }
 *   讀取檔案內容 → 送 LLM → 回傳 mind map JSON tree
 *
 * POST /api/mindmap/from-text
 *   body: { text: string, prompt: string }
 *   直接從文字 → 送 LLM → 回傳 mind map JSON tree
 *
 * GET  /api/mindmap/list
 *   列出已存檔的心智圖
 *
 * POST /api/mindmap/save
 *   body: { name: string, data: MindMapNode }
 *   儲存心智圖
 */

import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { resolve, join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { callLLMWithRetry, sanitizeContent, isMeaningfulContent } from "../lib/llm-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../../");
const MINDMAP_DIR = resolve(PAAW_ROOT, "data/mindmaps");

// ── System Prompt ──

const MINDMAP_SYSTEM_PROMPT = `你是心智圖產生器。你會收到一份文件或資料的內容，請將其整理成結構化的心智圖。

## 輸出格式（嚴格遵守）

只輸出一個 JSON 物件，不要加任何 markdown 格式標記、不要加說明文字。

JSON 結構：
\`\`\`
{
  "root": {
    "title": "主題名稱",
    "color": "#4F46E5",
    "children": [
      {
        "title": "主要分支 1",
        "color": "#3B82F6",
        "children": [
          {
            "title": "子主題",
            "color": "#60A5FA",
            "children": []
          }
        ]
      },
      {
        "title": "主要分支 2",
        "color": "#10B981",
        "children": []
      }
    ]
  },
  "summary": "一句話描述這張心智圖的核心內容"
}
\`\`\`

## 規則

1. **root.title** 是最核心的主題
2. 第一層 children 是主要分類（3-7 個）
3. 第二層是子主題（每個分支 2-5 個）
4. 第三層如果內容豐富才加，否則不要硬塞
5. **每個節點都要有 color**（hex 格式）
6. title 要簡潔（通常 2-8 個字），不要長句子
7. 如果內容有多個維度（例如時間、分類、重要性），選最自然的分類方式
8. summary 用一句話總結
9. **只輸出 JSON，不要加 \`\`\`json 標記**

## 顏色建議

- root: 深色（#4F46E5, #1E40AF, #7C3AED）
- 第一層：每個分支不同色系
  - 藍 #3B82F6, 綠 #10B981, 橙 #F59E0B, 紅 #EF4444, 紫 #8B5CF6, 青 #06B6D4, 粉 #EC4899
- 第二層之後：父節點顏色的淺色變體`;

// ── 檔案讀取 ──

const READABLE_EXTS = new Set([
  ".md", ".txt", ".json", ".js", ".mjs", ".ts", ".tsx", ".jsx",
  ".yaml", ".yml", ".html", ".css", ".xml", ".csv", ".svg",
  ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h",
]);

const MAX_FILE_SIZE = 100 * 1024; // 100KB per file
const MAX_TOTAL_SIZE = 500 * 1024; // 500KB total
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
        results.push(`\n--- 達到總大小上限 (${MAX_TOTAL_SIZE / 1024}KB)，停止讀取後續檔案 ---`);
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

// ── 解析 LLM 回應 ──

function parseMindMapResponse(content) {
  if (!content) return null;

  let cleaned = sanitizeContent(content);

  // 移除可能的 markdown code fence
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

  // 找 JSON 起始
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) return null;

  const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.root || !parsed.root.title) return null;
    return parsed;
  } catch {
    // 嘗試修復常見的 JSON 問題
    try {
      const fixed = jsonStr
        .replace(/,\s*}/g, "}")   // trailing comma
        .replace(/,\s*]/g, "]")   // trailing comma in array
        .replace(/\n/g, " ")       // newline in strings
        ;
      const parsed = JSON.parse(fixed);
      if (!parsed.root || !parsed.root.title) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

// ── Provider 解析（跟 distill.mjs 一樣的 pattern）──

function loadProviderConfig() {
  const configPath = resolve(PAAW_ROOT, "data/config/providers.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

function resolveLLM() {
  const config = loadProviderConfig();
  if (!config) throw new Error("No provider config found");

  const providerId = config.active;
  const provider = config.providers?.[providerId];
  if (!provider) throw new Error(`Provider '${providerId}' not found`);

  const model = config.defaultModel || provider.models?.[0]?.id || "glm-5.1";
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

// ── Route Handler ──

export async function handleMindMapRoutes(req, res) {
  // POST /api/mindmap/generate
  if (req.method === "POST" && req.url?.startsWith("/api/mindmap/generate")) {
    let body;
    try {
      const raw = await new Promise(resolve => {
        let d = "";
        req.on("data", c => d += c);
        req.on("end", () => resolve(d));
      });
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const { files = [], dir, prompt = "請整理這份內容的知識結構" } = body;

    try {
      // 讀取內容
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

      // call LLM
      const llm = resolveLLM();
      const userPrompt = `${prompt}\n\n---\n以下是要整理的內容：\n\n${content}`;

      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, {
        model: llm.model,
        messages: [
          { role: "system", content: MINDMAP_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
      }, {
        maxRetries: 3,
        timeoutMs: 90_000,
        validateContent: true,
        sanitize: true,
      });

      const mindMap = parseMindMapResponse(result.content);

      if (!mindMap) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "AI 回應無法解析為心智圖 JSON",
          raw: result.content.slice(0, 500),
        }));
        return true;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, mindMap }));
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
      const raw = await new Promise(resolve => {
        let d = "";
        req.on("data", c => d += c);
        req.on("end", () => resolve(d));
      });
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const { text, prompt = "請整理這份內容的知識結構" } = body;

    if (!text || text.trim().length < 10) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "文字內容太短" }));
      return true;
    }

    try {
      const llm = resolveLLM();
      const userPrompt = `${prompt}\n\n---\n以下是要整理的內容：\n\n${text.slice(0, MAX_TOTAL_SIZE)}`;

      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, {
        model: llm.model,
        messages: [
          { role: "system", content: MINDMAP_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
      }, {
        maxRetries: 3,
        timeoutMs: 90_000,
        validateContent: true,
        sanitize: true,
      });

      const mindMap = parseMindMapResponse(result.content);

      if (!mindMap) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "AI 回應無法解析為心智圖 JSON",
          raw: result.content.slice(0, 500),
        }));
        return true;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, mindMap }));
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
      const raw = await new Promise(resolve => {
        let d = "";
        req.on("data", c => d += c);
        req.on("end", () => resolve(d));
      });
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    const { name, mindMap, summary } = body;
    if (!name || !mindMap) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing name or mindMap" }));
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
        summary: summary || "",
        mindMap,
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
