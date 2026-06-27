/**
 * API Tool Registry — API Contract → Skill Tool 生成與管理
 *
 * 提供：
 *   GET  /api/tool-registry         — 列出所有可用工具
 *   GET  /api/tool-registry/:id     — 取得單一工具合約
 *   POST /api/tool-registry/:id/generate — 從 API Contract 產生 SKILL.md
 *   GET  /api/tool-registry/skills  — 列出已產生的 skill tools
 *   PUT  /api/tool-registry/:id     — 更新工具設定（enabled/autoTool）
 */
import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = process.env.PAAW_ROOT || resolve(__dirname, "../../../");
const REGISTRY_DIR = resolve(PAAW_ROOT, "data/api-registry");
const TOOLS_DIR = resolve(PAAW_ROOT, "data/skills/tools");

// Ensure registry dir exists (tools dir is created on-demand only)
await mkdir(REGISTRY_DIR, { recursive: true });

// ── Helpers ──
async function loadRegistryIndex() {
  try {
    const raw = await readFile(resolve(REGISTRY_DIR, "_index.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: "1.0", routes: [] };
  }
}

async function loadContract(routeId) {
  try {
    const raw = await readFile(resolve(REGISTRY_DIR, `${routeId}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveContract(routeId, contract) {
  await writeFile(resolve(REGISTRY_DIR, `${routeId}.json`), JSON.stringify(contract, null, 2), "utf-8");
}

async function listGeneratedSkills() {
  try {
    const dirs = await readdir(TOOLS_DIR, { withFileTypes: true });
    return dirs.filter(d => d.isDirectory()).map(d => d.name);
  } catch {
    return [];
  }
}

// ── Generate SKILL.md from API Contract ──
function generateSkillMarkdown(contract) {
  const { routeId, route, name, description, parameters } = contract;
  const [method, path] = route.split(" ");
  
  // Build input schema from parameters
  const inputFields = [];
  if (parameters.query) {
    for (const [key, info] of Object.entries(parameters.query)) {
      inputFields.push(`- ${key}: ${info.type || "string"} ${info.required ? "(required)" : "(optional)"} — ${info.description || ""}`);
    }
  }
  if (parameters.body) {
    for (const [key, info] of Object.entries(parameters.body)) {
      inputFields.push(`- ${key}: ${info.type || "string"} ${info.required ? "(required)" : "(optional)"} — ${info.description || ""}`);
    }
  }
  
  const inputSchema = inputFields.length > 0 
    ? inputFields.join("\n") 
    : "- (no parameters required)";

  // Build query string template
  const queryParams = parameters.query ? Object.keys(parameters.query) : [];
  const queryTemplate = queryParams.length > 0
    ? `?${queryParams.map(p => `${p}={input.${p}}`).join("&")}`
    : "";

  return `# Skill: ${name}

## Purpose
${description || `${method} ${path}`}

## Inputs
${inputSchema}

## Deterministic Script

### Tool Access
- HTTP API: \`${method} ${path}${queryTemplate ? queryTemplate.replace(/\{input\./g, "{").replace(/\}/g, "}") : ""}\`

### Execution Steps
1. 根據 input 組裝 API 請求
2. 呼叫 \`${method} http://127.0.0.1:4097${path}${queryTemplate ? queryTemplate.replace(/\{input\./g, "{${input.").replace(/\}/g, "}}") : ""}\`
3. 回傳 API 回應的 JSON 內容

### Business Rules
- 所有參數必須符合 API Contract 的型別要求
- API 回傳錯誤時，將錯誤訊息回傳給使用者

### Error Handling
- 400: 參數錯誤 — 檢查 input 是否符合 schema
- 404: 資源不存在
- 500: 伺服器錯誤 — 回傳錯誤訊息

## Guardrails
- 只呼叫已註冊的 API endpoint
- 不洩漏敏感資訊

## Output Contract
回傳 API 回應的 JSON 物件

## Validation
- 確認所有 required 參數都有值
- 確認參數型別正確
`;
}

// ── Route Handler ──
export default async function toolRegistryRoutes(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }

  // GET /api/tool-registry — list all tools
  if (req.method === "GET" && path === "/api/tool-registry") {
    const index = await loadRegistryIndex();
    const generated = await listGeneratedSkills();
    const enriched = index.routes.map(r => ({
      ...r,
      generated: generated.includes(r.routeId),
      skillPath: generated.includes(r.routeId) ? `data/skills/tools/${r.routeId}/SKILL.md` : null,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: index.version, routes: enriched }));
    return true;
  }

  // GET /api/tool-registry/:id — single contract
  if (req.method === "GET" && path.startsWith("/api/tool-registry/") && !path.endsWith("/generate") && !path.endsWith("/skills")) {
    const routeId = path.split("/").pop();
    const contract = await loadContract(routeId);
    if (!contract) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(contract));
    return true;
  }

  // PUT /api/tool-registry/:id — update settings
  if (req.method === "PUT" && path.startsWith("/api/tool-registry/") && !path.endsWith("/generate")) {
    const routeId = path.split("/").pop();
    const contract = await loadContract(routeId);
    if (!contract) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    
    const body = JSON.parse(await readBody(req));
    if (body.enabled !== undefined) contract.enabled = body.enabled;
    if (body.autoTool !== undefined) contract.autoTool = body.autoTool;
    if (body.description !== undefined) contract.description = body.description;
    if (body.parameters !== undefined) contract.parameters = body.parameters;
    if (body.sampleData !== undefined) contract.sampleData = body.sampleData;
    
    await saveContract(routeId, contract);
    
    // Update index
    const index = await loadRegistryIndex();
    const idx = index.routes.findIndex(r => r.routeId === routeId);
    if (idx >= 0) {
      index.routes[idx].enabled = contract.enabled;
      index.routes[idx].autoTool = contract.autoTool;
    }
    await writeFile(resolve(REGISTRY_DIR, "_index.json"), JSON.stringify(index, null, 2), "utf-8");
    
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, contract }));
    return true;
  }

  // POST /api/tool-registry/:id/generate — generate SKILL.md
  if (req.method === "POST" && path.startsWith("/api/tool-registry/") && path.endsWith("/generate")) {
    const routeId = path.split("/")[3]; // /api/tool-registry/:id/generate
    const contract = await loadContract(routeId);
    if (!contract) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    
    const skillDir = resolve(TOOLS_DIR, routeId);
    await mkdir(skillDir, { recursive: true });
    
    const skillMd = generateSkillMarkdown(contract);
    await writeFile(resolve(skillDir, "SKILL.md"), skillMd, "utf-8");
    
    // Also write a metadata JSON for the tool
    const meta = {
      routeId,
      route: contract.route,
      name: contract.name,
      category: contract.category,
      generatedAt: new Date().toISOString(),
      skillPath: `data/skills/tools/${routeId}/SKILL.md`,
    };
    await writeFile(resolve(skillDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
    
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, skillPath: meta.skillPath, skillMd }));
    return true;
  }

  // GET /api/tool-registry/skills — list generated skills
  if (req.method === "GET" && path === "/api/tool-registry/skills") {
    const generated = await listGeneratedSkills();
    const skills = [];
    for (const id of generated) {
      try {
        const metaRaw = await readFile(resolve(TOOLS_DIR, id, "meta.json"), "utf-8");
        skills.push(JSON.parse(metaRaw));
      } catch {
        skills.push({ routeId: id, name: id });
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ skills }));
    return true;
  }

  // DELETE /api/tool-registry/skills/:id — remove generated skill
  if (req.method === "DELETE" && path.startsWith("/api/tool-registry/skills/")) {
    const routeId = path.split("/").pop();
    const skillDir = resolve(TOOLS_DIR, routeId);
    try {
      await unlink(resolve(skillDir, "SKILL.md"));
      await unlink(resolve(skillDir, "meta.json"));
      // Try to remove dir (may fail if not empty)
      try { await unlink(skillDir); } catch {}
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  return false;
}

// Helper
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}
