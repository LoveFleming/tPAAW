/**
 * Coding Features Route — Feature-centric code understanding
 *
 * Endpoints:
 *   GET    /api/coding-features?path=...                    — List all features
 *   GET    /api/coding-features/:id?path=...                — Get single feature with full detail
 *   POST   /api/coding-features?path=...                    — Create feature
 *   PUT    /api/coding-features/:id?path=...                — Update feature
 *   DELETE /api/coding-features/:id?path=...                — Delete feature
 *   POST   /api/coding-features/:id/understand?path=...     — AI generate/update understanding for feature
 *   POST   /api/coding-features/:id/link-issue?path=...     — Link an issue to a feature
 *   POST   /api/coding-features/:id/unlink-issue?path=...   — Unlink an issue
 *   GET    /api/coding-features/stats?path=...              — Summary stats
 *   PUT    /api/coding-features/:id/docs?path=...           — Update feature documentation (markdown)
 */

import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { readBody, normalizePath } from "./shared.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";

function getMaxTokens(providerConfig, providerId, model) {
  const provider = providerConfig.providers?.[providerId];
  const models = provider?.models || [];
  for (const m of models) {
    if (typeof m === "object" && m.id === model) return m.maxTokens || 16384;
  }
  return 16384;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

// ── Helpers ──

function parseQuery(rawUrl) {
  const qIdx = rawUrl.indexOf("?");
  if (qIdx < 0) return {};
  const params = {};
  for (const part of rawUrl.slice(qIdx + 1).split("&")) {
    const [k, v] = part.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return params;
}

function genId(existing) {
  const nums = existing
    .map(f => parseInt(f.id?.replace(/^F-/, ""), 10))
    .filter(n => !isNaN(n));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `F-${String(next).padStart(3, "0")}`;
}

function now() {
  return new Date().toISOString();
}

function getFeaturesDir(projectPath) {
  return join(projectPath, ".paaw", "features");
}

function getFeaturesFile(projectPath) {
  return join(getFeaturesDir(projectPath), "FEATURES.json");
}

async function loadFeatures(projectPath) {
  const file = getFeaturesFile(projectPath);
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(await readFile(file, "utf-8"));
    return Array.isArray(data.features) ? data.features : [];
  } catch {
    return [];
  }
}

async function saveFeatures(projectPath, features) {
  const dir = getFeaturesDir(projectPath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const file = getFeaturesFile(projectPath);
  await writeFile(file, JSON.stringify({ features, updatedAt: now() }, null, 2), "utf-8");
}

// ── Load related data for feature detail ──

async function loadIssueSummaries(projectPath, issueIds) {
  const issuesFile = join(projectPath, ".paaw", "issues", "ISSUES.json");
  if (!existsSync(issuesFile) || !issueIds?.length) return [];
  try {
    const data = JSON.parse(readSync(issuesFile, "utf-8"));
    const allIssues = data.issues || [];
    return allIssues
      .filter(i => issueIds.includes(i.id))
      .map(i => ({ id: i.id, title: i.title, status: i.status, priority: i.priority }));
  } catch {
    return [];
  }
}

// ── LLM Call for AI Understanding ──

async function generateUnderstanding(projectPath, feature, providersFile) {
  let providerConfig;
  try { providerConfig = JSON.parse(readSync(providersFile, "utf-8")); } catch { return null; }
  const providerId = providerConfig.active || "zai";
  const model = resolveDefaultModel(providerConfig);
  const provider = providerConfig.providers?.[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") return null;

  const apiUrl = `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
  };

  // Read code files content
  const codeSnippets = [];
  for (const filePath of (feature.codeFiles || [])) {
    const absPath = resolve(projectPath, filePath);
    if (existsSync(absPath)) {
      try {
        const content = await readFile(absPath, "utf-8");
        codeSnippets.push(`### ${filePath}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
      } catch {}
    }
  }

  // Read test files
  const testSnippets = [];
  for (const filePath of (feature.tests || [])) {
    const absPath = resolve(projectPath, filePath);
    if (existsSync(absPath)) {
      try {
        const content = await readFile(absPath, "utf-8");
        testSnippets.push(`### ${filePath}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``);
      } catch {}
    }
  }

  // Read runbooks
  const runbookSnippets = [];
  for (const filePath of (feature.runbooks || [])) {
    const absPath = resolve(projectPath, filePath);
    if (existsSync(absPath)) {
      try {
        const content = await readFile(absPath, "utf-8");
        runbookSnippets.push(`### ${filePath}\n${content.slice(0, 1000)}`);
      } catch {}
    }
  }

  const prompt = `You are a senior code analyst. Analyze the following feature and provide a comprehensive understanding.

## Feature: ${feature.name}
${feature.description || ""}

## Code Files
${codeSnippets.join("\n\n") || "(no code files mapped)"}

## Tests
${testSnippets.join("\n\n") || "(no tests mapped)"}

## Runbooks
${runbookSnippets.join("\n\n") || "(no runbooks mapped)"}

## API Endpoints
${(feature.apis || []).map(a => `- ${a.method} ${a.path} (${a.file})`).join("\n") || "(no APIs mapped)"}

Please provide:
1. **Overview** — What this feature does and why it exists
2. **Architecture** — How the code is structured, key patterns used
3. **Data Flow** — How data moves through this feature (request → response)
4. **Key Decisions** — Important design choices and their rationale
5. **Test Coverage** — What's tested, what's missing
6. **Known Risks** — Potential issues, tech debt, security concerns
7. **Dependencies** — What this feature depends on and what depends on it

Write in clear, concise markdown. Use the project's context if available.`;

  const reqBody = {
    model,
    messages: [
      { role: "system", content: "You are a senior code analyst. Provide clear, actionable code understanding in markdown." },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 3000,
  };

  try {
    const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(reqBody) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

// ── Route Handler ──

export default async function codingFeaturesRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = parseQuery(rawUrl);

  if (!url.startsWith("/api/coding-features")) return false;

  const projectPath = q.path;
  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  const projRoot = resolve(projectPath);
  const providersFile = join(PAAW_ROOT, "data", "config", "providers.json");

  // ── GET /api/coding-features/file-map ──
  if (url === "/api/coding-features/file-map" && method === "GET") {
    const fileMapPath = join(getFeaturesDir(projRoot), "FILE-FEATURES.json");
    if (!existsSync(fileMapPath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "FILE-FEATURES.json not found — run Code Understanding first" }));
      return true;
    }
    try {
      const data = JSON.parse(await readFile(fileMapPath, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to parse FILE-FEATURES.json" }));
    }
    return true;
  }

  // ── GET /api/coding-features/validate — Layer 3 validation ──
  if (url === "/api/coding-features/validate" && method === "GET") {
    try {
      const { runFullValidation } = await import("../lib/feature-map-validator.mjs");
      const result = await runFullValidation(projRoot);
      res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── GET /api/coding-features/stats ──
  if (url === "/api/coding-features/stats" && method === "GET") {
    const features = await loadFeatures(projRoot);
    const stats = {
      total: features.length,
      active: features.filter(f => f.status === "active").length,
      deprecated: features.filter(f => f.status === "deprecated").length,
      withUnderstanding: features.filter(f => f.aiUnderstanding).length,
      withTests: features.filter(f => (f.tests || []).length > 0).length,
      withIssues: features.filter(f => (f.issues || []).length > 0).length,
      totalCodeFiles: features.reduce((sum, f) => sum + (f.codeFiles || []).length, 0),
      totalApis: features.reduce((sum, f) => sum + (f.apis || []).length, 0),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
    return true;
  }

  // ── POST /api/coding-features/:id/understand ──
  const understandMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/understand$/);
  if (understandMatch && method === "POST") {
    const id = decodeURIComponent(understandMatch[1]);
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    const understanding = await generateUnderstanding(projRoot, features[idx], providersFile);
    if (understanding) {
      features[idx].aiUnderstanding = understanding;
      features[idx].aiUnderstandingAt = now();
      features[idx].updatedAt = now();
      await saveFeatures(projRoot, features);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, understanding, feature: features[idx] }));
    return true;
  }

  // ── POST /api/coding-features/:id/link-issue ──
  const linkMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/link-issue$/);
  if (linkMatch && method === "POST") {
    const id = decodeURIComponent(linkMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    if (!features[idx].issues) features[idx].issues = [];
    if (!features[idx].issues.includes(body.issueId)) {
      features[idx].issues.push(body.issueId);
      features[idx].updatedAt = now();
      await saveFeatures(projRoot, features);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, feature: features[idx] }));
    return true;
  }

  // ── POST /api/coding-features/:id/unlink-issue ──
  const unlinkMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/unlink-issue$/);
  if (unlinkMatch && method === "POST") {
    const id = decodeURIComponent(unlinkMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    features[idx].issues = (features[idx].issues || []).filter(i => i !== body.issueId);
    features[idx].updatedAt = now();
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, feature: features[idx] }));
    return true;
  }

  // ── PUT /api/coding-features/:id/docs ──
  const docsMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/docs$/);
  if (docsMatch && method === "PUT") {
    const id = decodeURIComponent(docsMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    features[idx].documentation = body.documentation || "";
    features[idx].docsUpdatedAt = now();
    features[idx].updatedAt = now();
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, feature: features[idx] }));
    return true;
  }

  // ── GET /api/coding-features/:id ──
  const singleMatch = url.match(/^\/api\/coding-features\/([^/?]+)$/);
  if (singleMatch && method === "GET") {
    const id = decodeURIComponent(singleMatch[1]);
    const features = await loadFeatures(projRoot);
    const feature = features.find(f => f.id === id);
    if (!feature) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    // Enrich with issue summaries
    const issueSummaries = await loadIssueSummaries(projRoot, feature.issues || []);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...feature, _issueSummaries: issueSummaries }));
    return true;
  }

  // ── PUT /api/coding-features/:id (update) ──
  if (singleMatch && method === "PUT") {
    const id = decodeURIComponent(singleMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    const updated = {
      ...features[idx],
      ...body,
      id: features[idx].id,
      updatedAt: now(),
    };
    features[idx] = updated;
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(updated));
    return true;
  }

  // ── DELETE /api/coding-features/:id ──
  if (singleMatch && method === "DELETE") {
    const id = decodeURIComponent(singleMatch[1]);
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    const deleted = features.splice(idx, 1)[0];
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted }));
    return true;
  }

  // ── GET /api/coding-features (list) ──
  if (url === "/api/coding-features" && method === "GET") {
    let features = await loadFeatures(projRoot);
    console.log(`[coding-features] GET list: projRoot=${projRoot}, loaded=${features.length}, file=${getFeaturesFile(projRoot)}, exists=${existsSync(getFeaturesFile(projRoot))}`);
    // Filter
    if (q.status) {
      features = features.filter(f => f.status === q.status);
    }
    if (q.search) {
      const s = q.search.toLowerCase();
      features = features.filter(f =>
        f.name?.toLowerCase().includes(s) ||
        f.description?.toLowerCase().includes(s) ||
        f.id?.toLowerCase().includes(s)
      );
    }
    // Attach issue summaries (lightweight)
    const enriched = await Promise.all(features.map(async f => {
      const issueSummaries = await loadIssueSummaries(projRoot, f.issues || []);
      return { ...f, _issueSummaries: issueSummaries };
    }));
    res.writeHead(200, { "Content-Type": "application/json", "X-Features-Path": getFeaturesFile(projRoot), "X-Features-Count": String(enriched.length), "X-Features-Exists": String(existsSync(getFeaturesFile(projRoot))) });
    res.end(JSON.stringify({ features: enriched }));
    return true;
  }

  // ── POST /api/coding-features (create) ──
  if (url === "/api/coding-features" && method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    if (!body.name?.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Name is required" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const newFeature = {
      id: genId(features),
      name: body.name.trim(),
      description: body.description || "",
      status: body.status || "active",
      codeFiles: body.codeFiles || [],
      apis: body.apis || [],
      tests: body.tests || [],
      runbooks: body.runbooks || [],
      issues: body.issues || [],
      tags: body.tags || [],
      aiUnderstanding: "",
      aiUnderstandingAt: null,
      documentation: "",
      docsUpdatedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    features.push(newFeature);
    await saveFeatures(projRoot, features);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(newFeature));
    return true;
  }

  // ── POST /api/coding-features/refresh-mapping — AI re-scan & update all feature mappings ──
  if (url === "/api/coding-features/refresh-mapping" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const features = await loadFeatures(projRoot);
    if (features.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No features to update. Run Code Understanding first." }));
      return true;
    }

    // Load provider config
    let providerConfig;
    try { providerConfig = JSON.parse(readSync(providersFile, "utf-8")); } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Provider config not found" }));
      return true;
    }
    const providerId = providerConfig.active || "zai";
    const model = resolveDefaultModel(providerConfig);
    const provider = providerConfig.providers?.[providerId];
    if (!provider?.apiKey || provider.apiKey === "na") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No AI provider configured" }));
      return true;
    }

    // Scan codebase: list all source files
    const { exec: execCb } = await import("child_process");
    const isWin = process.platform === "win32";
    const scanCmd = isWin
      ? `node -e "const{readdirSync:r,statSync:s}=require('fs');const{join:j}=require('path');function walk(d,a){for(const e of r(d)){const p=j(d,e);try{if(s(p).isDirectory()){if(!e.includes('node_modules')&&!e.includes('dist')&&!e.startsWith('.'))walk(p,a)}else if(/\.(ts|tsx|mjs|js|jsx)$/.test(e))a.push(p.replace(/\\\\/g,'/'))}}catch{}}const f=[];walk('.',f);console.log(f.join('\\n'))"`
      : "find . -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' -o -name '*.jsx' \\) -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.paaw/*'";
    const scanFiles = () => new Promise((resolve) => {
      execCb(scanCmd, { cwd: projRoot, maxBuffer: 10*1024*1024 }, (err, stdout) => {
        resolve(stdout.trim().split("\n").filter(Boolean));
      });
    });
    const allFiles = await scanFiles();

    // Read API contract if exists
    let apiContract = "";
    const apiSpecFile = join(projRoot, ".paaw", "specs", "api-contract.md");
    if (existsSync(apiSpecFile)) {
      try { apiContract = (await readFile(apiSpecFile, "utf-8")).slice(0, 3000); } catch {}
    }

    const prompt = `You are a code analyst. Update the file mappings for existing features based on the current codebase.

## Current Features
${JSON.stringify(features.map(f => ({ id: f.id, name: f.name, description: f.description, currentCodeFiles: f.codeFiles, currentApis: f.apis, currentTests: f.tests, currentRunbooks: f.runbooks })), null, 2)}

## All Source Files in Codebase
${allFiles.join("\n")}

## API Contract
${apiContract || "(not available)"}

## Task
For EACH feature, review its current file mappings and update them based on what files actually exist now.

Rules:
1. If files were renamed/moved, update the paths
2. If new files belong to this feature, add them
3. If mapped files no longer exist, remove them
4. Check API endpoints — add new ones, remove deleted ones
5. Check test files — add new ones, remove deleted ones
6. Check runbooks — same
7. Do NOT change feature id, name, description, or status
8. Do NOT invent files that don't exist in the file list above

Output a JSON array with updated mappings. Each element:
{ "id": "F-001", "codeFiles": [...], "apis": [{"method":"GET","path":"/api/x","file":"src/x.mjs"}], "tests": [...], "runbooks": [...] }

Output ONLY the JSON array, no markdown fences.`;

    const apiUrl = `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
    };

    try {
      const llmRes = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: getMaxTokens(providerConfig, providerId, model) }),
      });
      const llmData = await llmRes.json();
      const content = llmData.choices?.[0]?.message?.content || "";
      const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
      if (!cleanJson) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "AI 回應為空，無法更新 Feature Map。請重新執行。" }));
        return true;
      }
      let updates;
      try {
        updates = JSON.parse(cleanJson);
      } catch (parseErr) {
        // Recovery: find last complete object (AI output may be truncated)
        let lastComplete = 0, braceCount = 0, inStr = false, esc = false;
        for (let i = 0; i < cleanJson.length; i++) {
          const c = cleanJson[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === '{') braceCount++;
          if (c === '}') { braceCount--; if (braceCount === 0) lastComplete = i; }
        }
        if (lastComplete === 0) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `AI refresh failed: no valid JSON in response (${parseErr.message})` }));
          return true;
        }
        const recovered = cleanJson.substring(0, lastComplete + 1).trim() + '\n]';
        try {
          updates = JSON.parse(recovered);
        } catch (recoverErr) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `AI refresh failed: truncated JSON (parse: ${parseErr.message}, recovery: ${recoverErr.message})` }));
          return true;
        }
      }

      if (!Array.isArray(updates)) throw new Error("AI did not return an array");

      // Apply updates
      let updatedCount = 0;
      for (const upd of updates) {
        const idx = features.findIndex(f => f.id === upd.id);
        if (idx < 0) continue;
        if (upd.codeFiles) features[idx].codeFiles = upd.codeFiles;
        if (upd.apis) features[idx].apis = upd.apis;
        if (upd.tests) features[idx].tests = upd.tests;
        if (upd.runbooks) features[idx].runbooks = upd.runbooks;
        features[idx].updatedAt = now();
        updatedCount++;
      }
      await saveFeatures(projRoot, features);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, updated: updatedCount, total: features.length, features }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `AI refresh failed: ${err.message}` }));
    }
    return true;
  }

  // ── POST /api/coding-features/discover — AI discovers new features from orphan files ──
  if (url === "/api/coding-features/discover" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const features = await loadFeatures(projRoot);

    // Load provider config
    let providerConfig;
    try { providerConfig = JSON.parse(readSync(providersFile, "utf-8")); } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Provider config not found" }));
      return true;
    }
    const providerId = providerConfig.active || "zai";
    const model = body.model || resolveDefaultModel(providerConfig);
    const provider = providerConfig.providers?.[providerId];
    if (!provider?.apiKey || provider.apiKey === "na") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No AI provider configured" }));
      return true;
    }

    // Find orphan files using L3 validator
    const { checkCoverage, scanAllSourceFiles } = await import("../lib/feature-map-validator.mjs");
    const coverage = checkCoverage(projRoot, features);
    const orphans = coverage.orphans;

    if (orphans.length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "No orphan files — all source files are mapped", created: 0 }));
      return true;
    }

    // Get existing feature names so AI doesn't duplicate
    const existingNames = features.map(f => ({ id: f.id, name: f.name, description: f.description }));
    const nextId = `F-${String(features.length + 1).padStart(3, "0")}`;

    const prompt = `You are a software architect analyzing unmapped source files in a codebase.

## Existing Features (DO NOT duplicate these)
${JSON.stringify(existingNames, null, 2)}

## Unmapped Source Files (${orphans.length} files)
${orphans.join("\n")}

## Task
Group these unmapped files into NEW features. Each feature should be a coherent functional unit.

Rules:
1. Group files that work together into the same feature
2. Give each feature a clear name and 1-sentence description
3. DO NOT create a feature that overlaps with existing features
4. Small related files can share a feature
5. Don't over-split — prefer fewer features with more files over many tiny features
6. Config files, utils, and shared types can be grouped as "Shared Infrastructure"
7. Every unmapped file MUST appear in exactly one new feature

Output a JSON array of new features:
[
  {
    "name": "Feature Name",
    "description": "What this feature does",
    "codeFiles": ["path/to/file.ts", ...],
    "tests": ["path/to/test.ts", ...],
    "tags": ["tag1", "tag2"]
  }
]

Output ONLY the JSON array, no markdown fences.`;

    const apiUrl = `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
    };

    try {
      const llmRes = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: getMaxTokens(providerConfig, providerId, model) }),
      });
      const llmData = await llmRes.json();
      const content = llmData.choices?.[0]?.message?.content || "";
      const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

      if (!cleanJson) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "AI 回應為空" }));
        return true;
      }

      let newFeatures;
      try {
        newFeatures = JSON.parse(cleanJson);
      } catch (parseErr) {
        // Recovery: find last complete object
        let lastComplete = 0, braceCount = 0, inStr = false, esc = false;
        for (let i = 0; i < cleanJson.length; i++) {
          const c = cleanJson[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === '{') braceCount++;
          if (c === '}') { braceCount--; if (braceCount === 0) lastComplete = i; }
        }
        if (lastComplete === 0) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `AI discovery failed: no valid JSON (${parseErr.message})` }));
          return true;
        }
        const recovered = cleanJson.substring(0, lastComplete + 1).trim() + '\n]';
        try {
          newFeatures = JSON.parse(recovered);
        } catch (recoverErr) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `AI discovery failed: truncated JSON (${recoverErr.message})` }));
          return true;
        }
      }

      if (!Array.isArray(newFeatures)) throw new Error("AI did not return an array");

      // Create new features
      let createdCount = 0;
      const allFiles = new Set(scanAllSourceFiles(projRoot));
      for (const nf of newFeatures) {
        // Validate: all codeFiles must exist on disk (L3 check before writing!)
        const validFiles = (nf.codeFiles || []).filter(f => {
          const norm = f.replace(/^\.\//, "").replace(/\\/g, "/");
          return allFiles.has(norm);
        });
        const validTests = (nf.tests || []).filter(f => {
          const norm = f.replace(/^\.\//, "").replace(/\\/g, "/");
          return allFiles.has(norm);
        });

        const fid = `F-${String(features.length + 1).padStart(3, "0")}`;
        features.push({
          id: fid,
          name: nf.name || "Unnamed Feature",
          description: nf.description || "",
          status: "active",
          codeFiles: validFiles,
          apis: [],
          tests: validTests,
          runbooks: [],
          issues: [],
          tags: nf.tags || [],
          aiUnderstanding: "",
          aiUnderstandingAt: null,
          documentation: "",
          docsUpdatedAt: null,
          createdAt: now(),
          updatedAt: now(),
        });
        createdCount++;
      }

      await saveFeatures(projRoot, features);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, created: createdCount, totalFeatures: features.length, orphansBefore: orphans.length, features: newFeatures }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `AI discovery failed: ${err.message}` }));
    }
    return true;
  }

  return false;
}
