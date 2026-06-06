/**
 * tAgent Server
 *
 * HTTP + WebSocket server for tAgent Personal AI Assistant.
 * Uses node-pty for CLI interaction.
 *
 * Key endpoints:
 *   POST /api/report-train   — Run CLI to generate app.html
 *   POST /api/report-publish — Publish app to apps/ directory
 *   WebSocket :4098         — PTY sessions for employee consoles
 */

import { createServer } from "http";
import { readdir, readFile, writeFile, mkdir, unlink, rm } from "fs/promises";
import { readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { spawn as ptySpawn } from "node-pty";
import { tmpdir } from "os";
import { exec as execCb } from "child_process";
import yaml from "js-yaml";
import { promisify } from "util";
import { getToolsAndHandlers, invalidateCache } from "./tools/index.mjs";
import chokidar from "chokidar";
const execAsync = promisify(execCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DASHBOARD_ROOT = resolve(__dirname, "../../ui");
const TAGENT_ROOT = resolve(__dirname, "../../../");
const CONVERSATIONS_ROOT = resolve(TAGENT_ROOT, "data/crews/conversation");
const CREWS_ROOT = resolve(TAGENT_ROOT, "data/crews");
const SKILLS_ROOT = resolve(TAGENT_ROOT, "data/skills");
const DOCS_ROOT = resolve(TAGENT_ROOT, "docs");
const INPUT_PROMPT_ROOT = resolve(SKILLS_ROOT, "input-prompt");
const PHYSICAL_SKILL_ROOT = resolve(SKILLS_ROOT, "physical-skill");
const APPS_ROOT = resolve(TAGENT_ROOT, "data/apps");

const PORT = parseInt(process.env.TAGENT_PORT || "4097", 10);

// Simple path hash: replace non-alphanumeric with underscore
function projectPathHash(path) {
  if (!path) return "_default";
  return path.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "_default";
}

function getConvDir(employeeId, root) {
  const hash = projectPathHash(root);
  return resolve(CONVERSATIONS_ROOT, hash, employeeId);
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // tAgent API
  const tagentHandled = await tagentApiHandler(req, res);
  if (tagentHandled) return;

  // Cron API
  const handled = await cronApiHandler(req, res);
  if (handled) return;

  // Helper: resolve directory (tAgent has flat structure, no factory nesting)
  function factoryDir(_factoryId, subdir) {
    if (subdir === "crews") return CREWS_ROOT;
    if (subdir === "docs") return DOCS_ROOT;
    return resolve(TAGENT_ROOT, subdir);
  }

  // Helper: get factoryId from query param (kept for backward compat)
  function getFactoryId(url) {
    return "default";
  }

  // ── Skills API (global, top-level) ──

  // Helper: parse YAML frontmatter from SKILL.md (simple parser for arrays/objects)
  function parseSkillFrontmatter(raw) {
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return { body: raw };
    const body = raw.slice(fmMatch[0].length).trim();
    const fm = fmMatch[1];

    // Use js-yaml for full YAML support (|, >, nested arrays, multiline strings)
    try {
      const parsed = yaml.load(fm, { schema: yaml.DEFAULT_SCHEMA });
      if (typeof parsed === 'object' && parsed !== null) {
        return { ...parsed, body };
      }
    } catch (err) {
      // silently skip malformed frontmatter
    }

    // Fallback: return body only
    return { body };
  }

  // GET /api/skills — list all skills (input-prompt + physical-skill)
  if (req.method === "GET" && req.url?.match(/^\/api\/skills(?:\?.*)?$/)) {
    try {
      const skills = [];
      // Helper to scan a skill directory
      const scanSkillsDir = async (root, kind) => {
        await mkdir(root, { recursive: true });
        const dirs = await readdir(root);
        for (const dir of dirs) {
          try {
            const stat = await import("fs/promises").then(m => m.stat(join(root, dir)));
            if (!stat.isDirectory()) continue;
            const skillPath = join(root, dir, "SKILL.md");
            const raw = await readFile(skillPath, "utf-8");
            const parsed = parseSkillFrontmatter(raw);
            skills.push({
              id: dir,
              kind,
              name: parsed.name || dir,
              description: parsed.description || "",
              version: parsed.version || "1.0.0",
              category: parsed.category || "",
              skillPrompt: parsed.body || "",
              useSkills: Array.isArray(parsed.useSkills) ? parsed.useSkills : [],
              usePhysicalSkills: Array.isArray(parsed.usePhysicalSkills) ? parsed.usePhysicalSkills : [],
              userInputs: Array.isArray(parsed.userInputs) ? parsed.userInputs : [],
              fullContent: raw,
            });
          } catch { /* skip invalid */ }
        }
      };
      await scanSkillsDir(INPUT_PROMPT_ROOT, "input-prompt");
      await scanSkillsDir(PHYSICAL_SKILL_ROOT, "physical-skill");
      // Check hasApp for each skill
      for (const sk of skills) {
        try {
          const base = sk.kind === "physical-skill" ? PHYSICAL_SKILL_ROOT : INPUT_PROMPT_ROOT;
          await import("fs/promises").then(m => m.access(join(base, sk.id, "app.html")));
          sk.hasApp = true;
        } catch { sk.hasApp = false; }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(skills));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/skills/:id — get single skill definition
  const skillGetMatch = req.method === "GET" && req.url?.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/);
  if (skillGetMatch) {
    const skillId = skillGetMatch[1];
    // Search in both input-prompt and physical-skill
    const roots = [INPUT_PROMPT_ROOT, PHYSICAL_SKILL_ROOT];
    let found = null;
    for (const root of roots) {
      const skillPath = join(root, skillId, "SKILL.md");
      try {
        const raw = await readFile(skillPath, "utf-8");
        const parsed = parseSkillFrontmatter(raw);
        const kind = root === INPUT_PROMPT_ROOT ? "input-prompt" : "physical-skill";
        found = {
          id: skillId,
          kind,
          name: parsed.name || skillId,
          description: parsed.description || "",
          version: parsed.version || "1.0.0",
          category: parsed.category || "",
          skillPrompt: parsed.body || "",
          useSkills: Array.isArray(parsed.useSkills) ? parsed.useSkills : [],
          usePhysicalSkills: Array.isArray(parsed.usePhysicalSkills) ? parsed.usePhysicalSkills : [],
          userInputs: Array.isArray(parsed.userInputs) ? parsed.userInputs : [],
          fullContent: raw,
        };
        break;
      } catch { /* not found in this root */ }
    }
    if (found) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(found));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Skill not found" }));
    }
    return;
  }

  // ── Skill Save API ──

  // PUT /api/skills/:id — create or update a skill (input-prompt by default)
  if (req.method === "PUT" && req.url?.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/)) {
    const skillId = req.url.match(/^\/api\/skills\/([\w.-]+)/)?.[1];
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body);
      const content = payload.content;
      const kind = payload.kind || "input-prompt";
      if (!content || !skillId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing content or skillId" }));
        return;
      }
      const baseRoot = kind === "physical-skill" ? PHYSICAL_SKILL_ROOT : INPUT_PROMPT_ROOT;
      const skillDir = join(baseRoot, skillId);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: skillId, kind }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/skills/:id — delete a skill (searches both dirs)
  if (req.method === "DELETE" && req.url?.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/)) {
    const skillId = req.url.match(/^\/api\/skills\/([\w.-]+)/)?.[1];
    try {
      const roots = [INPUT_PROMPT_ROOT, PHYSICAL_SKILL_ROOT];
      let deleted = false;
      for (const root of roots) {
        const skillDir = join(root, skillId);
        try {
          await rm(skillDir, { recursive: true, force: true });
          deleted = true;
        } catch { /* not in this root */ }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const skillAppMatch = req.method === "GET" && req.url?.match(/^\/api\/skill-app\/([\w.-]+)(?:\?.*)?$/);
  if (skillAppMatch) {
    const skillId = skillAppMatch[1];
    const roots = [PHYSICAL_SKILL_ROOT, INPUT_PROMPT_ROOT];
    try {
      for (const root of roots) {
        const appPath = join(root, skillId, "app.html");
        try {
          const content = await readFile(appPath, "utf-8");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(content);
          return;
        } catch { /* not in this root */ }
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "app.html not found for skill: " + skillId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/apps — list apps from apps/ directory
  if (req.method === "GET" && req.url?.match(/^\/api\/apps(?:\?.*)?$/)) {
    try {
      await mkdir(APPS_ROOT, { recursive: true });
      const dirs = await readdir(APPS_ROOT);
      const apps = [];
      for (const dir of dirs) {
        try {
          const stat = await import("fs/promises").then(m => m.stat(join(APPS_ROOT, dir)));
          if (!stat.isDirectory()) continue;
          const entries = await readdir(join(APPS_ROOT, dir));
          const hasHtml = entries.includes("app.html");
          let meta = {};
          try { meta = JSON.parse(await readFile(join(APPS_ROOT, dir, "app.json"), "utf-8")); } catch {}
          apps.push({
            id: dir,
            name: meta.name || dir,
            description: meta.description || "",
            icon: meta.icon || "",
            template: meta.template || "",
            skillId: meta.skillId || "",
            hasApp: hasHtml,
            generatedAt: meta.generatedAt || "",
            status: meta.status || "published",
            dataShape: meta.dataShape || "array",
            schema: meta.schema || {},
            aiPrompt: meta.aiPrompt || "",
          });
        } catch { /* skip */ }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(apps));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── App Data API (persistent storage per app) ──

  // Helper: read request body inline (readBody may not be in scope yet)
  const _readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });

  // GET /api/app-data/:appId — read app data
  const appDataGetMatch = req.method === "GET" && req.url?.match(/^\/api\/app-data\/([\w.-]+)(?:\?.*)?$/);
  if (appDataGetMatch) {
    const appId = appDataGetMatch[1];
    const dataDir = resolve(TAGENT_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      const data = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    }
    return;
  }

  // PUT /api/app-data/:appId — save app data (full replace)
  const appDataPutMatch = req.method === "PUT" && req.url?.match(/^\/api\/app-data\/([\w.-]+)(?:\?.*)?$/);
  if (appDataPutMatch) {
    const appId = appDataPutMatch[1];
    const dataDir = resolve(TAGENT_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      const body = await _readBody(req);
      JSON.parse(body); // validate JSON
      await writeFile(filePath, body, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/app-data/:appId — add item to app data array
  const appDataPostMatch = req.method === "POST" && req.url?.match(/^\/api\/app-data\/([\w.-]+)(?:\?.*)?$/);
  if (appDataPostMatch) {
    const appId = appDataPostMatch[1];
    const dataDir = resolve(TAGENT_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      let items = [];
      try { items = JSON.parse(await readFile(filePath, "utf-8")); } catch {}
      const newItem = JSON.parse(await _readBody(req));
      if (!newItem.id) newItem.id = `todo_${Date.now()}`;
      if (!newItem.createdAt) newItem.createdAt = new Date().toISOString();
      items.push(newItem);
      await writeFile(filePath, JSON.stringify(items, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(newItem));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/app-data/:appId/:itemId — delete item
  const appDataDelMatch = req.method === "DELETE" && req.url?.match(/^\/api\/app-data\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
  if (appDataDelMatch) {
    const [, appId, itemId] = appDataDelMatch;
    const dataDir = resolve(TAGENT_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      let items = [];
      try { items = JSON.parse(await readFile(filePath, "utf-8")); } catch {}
      const before = items.length;
      items = items.filter(i => i.id !== itemId);
      await writeFile(filePath, JSON.stringify(items, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted: before - items.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // PATCH /api/app-data/:appId/:itemId — update item
  const appDataPatchMatch = req.method === "PATCH" && req.url?.match(/^\/api\/app-data\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
  if (appDataPatchMatch) {
    const [, appId, itemId] = appDataPatchMatch;
    const dataDir = resolve(TAGENT_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      let items = [];
      try { items = JSON.parse(await readFile(filePath, "utf-8")); } catch {}
      const idx = items.findIndex(i => i.id === itemId);
      if (idx < 0) { res.writeHead(404); res.end("Item not found"); return; }
      const patch = JSON.parse(await _readBody(req));
      items[idx] = { ...items[idx], ...patch, id: itemId };
      await writeFile(filePath, JSON.stringify(items, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(items[idx]));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/app-run/:id — run AI to generate app content on-the-fly
  const appRunMatch = req.method === "POST" && req.url?.match(/^\/api\/app-run\/([\w.-]+)(?:\?.*)?$/);
  if (appRunMatch) {
    const appId = appRunMatch[1];
    const body = await readBody(req);
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    const { prompt: userPrompt, cli: cliType } = parsed;
    const cliName = cliType || "qwen";

    const outDir = join(APPS_ROOT, appId);
    await mkdir(outDir, { recursive: true });

    // Build the prompt: fetch live skill data and ask AI to generate a report
    let skillData = [];
    try {
      const dirs = await readdir(INPUT_PROMPT_ROOT);
      for (const dir of dirs) {
        try {
          const raw = await readFile(join(INPUT_PROMPT_ROOT, dir, "SKILL.md"), "utf-8");
          const parsed = parseSkillFrontmatter(raw);
          skillData.push({ id: dir, kind: "input-prompt", name: parsed.name || dir, description: parsed.description || "", category: parsed.category || "" });
        } catch {}
      }
    } catch {}
    try {
      const dirs = await readdir(PHYSICAL_SKILL_ROOT);
      for (const dir of dirs) {
        try {
          const raw = await readFile(join(PHYSICAL_SKILL_ROOT, dir, "SKILL.md"), "utf-8");
          const parsed = parseSkillFrontmatter(raw);
          skillData.push({ id: dir, kind: "physical-skill", name: parsed.name || dir, description: parsed.description || "", category: parsed.category || "" });
        } catch {}
      }
    } catch {}

    let appData = [];
    try {
      const dirs = await readdir(APPS_ROOT);
      for (const dir of dirs) {
        try { const s = await import("fs/promises").then(m => m.stat(join(APPS_ROOT, dir))); if (!s.isDirectory()) continue; } catch { continue; }
        let meta = {};
        try { meta = JSON.parse(await readFile(join(APPS_ROOT, dir, "app.json"), "utf-8")); } catch {}
        appData.push({ id: dir, name: meta.name || dir, status: meta.status || "published" });
      }
    } catch {}

    // Summarize data to keep prompt short — pass full data as a JSON file instead
    const summary = {
      totalSkills: skillData.length,
      inputPromptSkills: skillData.filter(s => s.kind === 'input-prompt').length,
      physicalSkills: skillData.filter(s => s.kind === 'physical-skill').length,
      totalApps: appData.length,
      categories: (() => { const m = {}; skillData.forEach(s => { const c = s.category || 'Other'; m[c] = (m[c] || 0) + 1; }); return m; })(),
    };
    const dataFile = join(outDir, "_skill_data.json");
    await writeFile(dataFile, JSON.stringify({ skills: skillData, apps: appData }, null, 2), "utf-8");

    const systemPrompt = `你是 tAgent 的數據分析師。請讀取 ${dataFile} 中的即時資料，生成一份完整的 Skill Counting Report (HTML 頁面)。

## 摘要
- Total Skills: ${summary.totalSkills}
- Input-Prompt Skills: ${summary.inputPromptSkills}
- Physical Skills: ${summary.physicalSkills}
- Apps: ${summary.totalApps}
- Categories: ${JSON.stringify(summary.categories)}

## 輸出要求
- 生成完整的 HTML 頁面 (<!DOCTYPE html>...<\/html>)
- 包含統計卡片：Total Skills, Input-Prompt Skills, Physical Skills, Apps
- 包含圓餅圖 (skill kind 分佈) 和長條圖 (category 分佈)，使用 Chart.js
- 包含完整 skill 清單表格，可搜尋、排序
- 樣式：Stone 色系，圓角卡片，現代感 UI
- 所有數字必須來自資料檔案，不可編造
- 標題顯示「載入時間」為現在
- 先讀取 ${dataFile} 取得完整資料，再生成 HTML
${userPrompt ? `\n額外指示: ${userPrompt}` : ""}`;

    // Write prompt to temp file to avoid CLI arg length limit
    const promptFile = join(outDir, "_prompt.txt");
    await writeFile(promptFile, systemPrompt, "utf-8");

    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked", "X-Accel-Buffering": "no", "Cache-Control": "no-cache" });
    res.write(JSON.stringify({ type: "status", data: { message: `AI 正在計算 ${appId}...` } }) + "\n");

    const cliBins = {
      qwen: { darwin: "/opt/homebrew/bin/qwen", linux: "qwen", win32: "qwen.cmd" },
      claude: { darwin: "claude", linux: "claude", win32: "claude.cmd" },
      opencode: { darwin: "opencode", linux: "opencode", win32: "opencode.cmd" },
    };
    const cliEnvBins = { qwen: "QWEN_BIN", claude: "CLAUDE_BIN", opencode: "OPENCODE_BIN" };
    const _platform = process.platform;
    const _binKey = _platform === "win32" ? "win32" : _platform === "darwin" ? "darwin" : "linux";
    const resolvedBin = process.env[cliEnvBins[cliName] || "QWEN_BIN"] || (cliBins[cliName] || cliBins.qwen)[_binKey];

    // Use prompt via file to avoid arg length limits
    let cliArgs;
    if (cliName === "qwen") {
      cliArgs = ["--approval-mode", "yolo", "-o", "text", "--max-tool-calls", "30", systemPrompt];
    } else if (cliName === "claude") {
      cliArgs = ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "-p", systemPrompt, "--output-format", "text"];
    } else if (cliName === "opencode") {
      cliArgs = ["--non-interactive", "-p", systemPrompt];
    } else {
      cliArgs = [systemPrompt];
    }

    const ptyProc = ptySpawn(resolvedBin, cliArgs, {
      name: "xterm-256color",
      cols: 200,
      rows: 50,
      cwd: outDir,
      env: { ...process.env, HOME: process.env.HOME, QWEN_CODE_SUPPRESS_YOLO_WARNING: "1", FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
    });

    let fullOutput = "";
    ptyProc.onData((data) => {
      fullOutput += data;
      res.write(JSON.stringify({ type: "stdout", data }) + "\n");
    });

    ptyProc.onExit(async ({ exitCode }) => {
      let htmlContent = fullOutput;
      const codeBlockMatch = htmlContent.match(/```(?:html)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) htmlContent = codeBlockMatch[1].trim();
      let htmlMatch = htmlContent.match(/<!DOCTYPE\s+html[^>]*>[\s\S]*<\/html>/i);
      if (htmlMatch) htmlContent = htmlMatch[0];
      else {
        htmlMatch = htmlContent.match(/<html[\s\S]*<\/html>/i);
        if (htmlMatch) htmlContent = htmlMatch[0];
      }

      if (htmlContent.includes("<html")) {
        await writeFile(join(outDir, "app.html"), htmlContent, "utf-8");
        res.write(JSON.stringify({ type: "done", data: { appId, exitCode } }) + "\n");
      } else {
        res.write(JSON.stringify({ type: "error", data: { message: `AI 回應中找不到有效 HTML (${fullOutput.length} chars)`, rawOutput: fullOutput.slice(-2000) } }) + "\n");
      }
      res.end();
    });

    setTimeout(() => { try { ptyProc.kill(); } catch {} }, 180_000);
    return;
  }

  // GET /api/app/:id — serve app.html from apps/ directory
  const appServeMatch = (req.method === "GET" || req.method === "HEAD") && req.url?.match(/^\/api\/app\/([\w.-]+)(?:\?.*)?$/);
  if (appServeMatch) {
    const appId = appServeMatch[1];
    try {
      const html = await readFile(join(APPS_ROOT, appId, "app.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(req.method === "HEAD" ? "" : html);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "App not found: " + appId }));
    }
    return;
  }

  // DELETE /api/app/:id — unpublish/remove an app
  const appDeleteMatch = req.method === "DELETE" && req.url?.match(/^\/api\/app\/([\w.-]+)(?:\?.*)?$/);
  if (appDeleteMatch) {
    const appId = appDeleteMatch[1];
    const appDir = join(APPS_ROOT, appId);
    try {
      // Just remove app.html, keep app.json with status=draft
      const htmlPath = join(appDir, "app.html");
      await unlink(htmlPath).catch(() => {});
      // Update app.json status
      const jsonPath = join(appDir, "app.json");
      let meta = {};
      try { meta = JSON.parse(await readFile(jsonPath, "utf-8")); } catch {}
      meta.status = "draft";
      await writeFile(jsonPath, JSON.stringify(meta, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, appId, status: "draft" }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/app/:id/publish — publish/update app.json metadata
  const appPublishMatch = req.method === "POST" && req.url?.match(/^\/api\/app\/([\w.-]+)\/publish(?:\?.*)?$/);
  if (appPublishMatch) {
    const appId = appPublishMatch[1];
    const appDir = join(APPS_ROOT, appId);
    try {
      const jsonPath = join(appDir, "app.json");
      let meta = {};
      try { meta = JSON.parse(await readFile(jsonPath, "utf-8")); } catch {}
      const body = await readBody(req);
      let extra = {};
      try { extra = JSON.parse(body); } catch {}
      meta = { ...meta, ...extra, status: "published", publishedAt: new Date().toISOString() };
      await writeFile(jsonPath, JSON.stringify(meta, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, appId, ...meta }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/app/:id/status — check if app.html exists and its mtime
  const appStatusMatch = req.method === "GET" && req.url?.match(/^\/api\/app\/([\w.-]+)\/status(?:\?.*)?$/);
  if (appStatusMatch) {
    const appId = appStatusMatch[1];
    try {
      const { stat } = await import("fs/promises");
      const filePath = join(APPS_ROOT, appId, "app.html");
      const s = await stat(filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ exists: true, mtime: s.mtimeMs, size: s.size }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ exists: false, mtime: null, size: 0 }));
    }
    return;
  }

  // GET /api/report-templates — list available report templates
  if (req.method === "GET" && req.url?.match(/^\/api\/report-templates(?:\?.*)?$/)) {
    const templates = [
      { id: "dashboard", name: "Dashboard", icon: "📊", description: "KPI cards + charts，適合概覽" },
      { id: "table", name: "Table Report", icon: "📋", description: "純表格數據報表" },
      { id: "chart", name: "Chart Only", icon: "📈", description: "單一圖表" },
      { id: "mixed", name: "Mixed Report", icon: "🧩", description: "圖表 + 表格 + AI 分析" },
    ];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(templates));
    return;
  }

  // POST /api/report-train — run CLI to generate app.html, stream output
  if (req.method === "POST" && req.url === "/api/report-train") {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { skillId, reportName, template, prompt, runId, cli: cliType } = parsed;
    const cliName = cliType || "qwen";

    // Prepare output dir
    const reportId = (reportName || skillId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || skillId;
    const outDir = join(PHYSICAL_SKILL_ROOT, reportId);
    await mkdir(outDir, { recursive: true });

    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked", "X-Accel-Buffering": "no", "Cache-Control": "no-cache" });

    // Write prompt to a temp file so CLI can read it
    const promptFile = join(outDir, "_prompt.txt");
    await writeFile(promptFile, prompt, "utf-8");

    // Use qwen CLI to generate
    const htmlOutFile = join(outDir, "app.html");

    // Resolve CLI binary and args
    const cliBins = {
      qwen: { darwin: "/opt/homebrew/bin/qwen", linux: "qwen", win32: "qwen.cmd" },
      claude: { darwin: "claude", linux: "claude", win32: "claude.cmd" },
      opencode: { darwin: "opencode", linux: "opencode", win32: "opencode.cmd" },
    };
    const cliEnvBins = { qwen: "QWEN_BIN", claude: "CLAUDE_BIN", opencode: "OPENCODE_BIN" };
    const _platform = process.platform;
    const _binKey = _platform === "win32" ? "win32" : _platform === "darwin" ? "darwin" : "linux";
    const resolvedBin = process.env[cliEnvBins[cliName] || "QWEN_BIN"] || (cliBins[cliName] || cliBins.qwen)[_binKey];

    // Build CLI-specific args
    let cliArgs;
    if (cliName === "qwen") {
      cliArgs = ["--approval-mode", "yolo", "-o", "text", "--max-tool-calls", "20", prompt];
    } else if (cliName === "claude") {
      cliArgs = ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "-p", prompt, "--output-format", "text"];
    } else if (cliName === "opencode") {
      cliArgs = ["--non-interactive", "-p", prompt];
    } else {
      cliArgs = [prompt];
    }

    console.log(`[report-train] Spawning ${cliName} (${resolvedBin}) for ${reportId}, template=${template}`);

    // Use node-pty so CLI thinks it's on a real terminal → stdout flushes immediately
    // Plain child_process.spawn causes qwen -o text to buffer everything until exit
    const ptyProc = ptySpawn(resolvedBin, cliArgs, {
      name: "xterm-256color",
      cols: 200,
      rows: 50,
      cwd: outDir,
      env: { ...process.env, HOME: process.env.HOME, QWEN_CODE_SUPPRESS_YOLO_WARNING: "1", FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
    });

    // Send initial status so frontend knows connection is alive
    res.write(JSON.stringify({ type: "status", data: { message: `Training ${reportId} with ${cliName}...`, runId } }) + "\n");

    let fullOutput = "";

    ptyProc.onData((data) => {
      fullOutput += data;
      res.write(JSON.stringify({ type: "stdout", data }) + "\n");
    });

    ptyProc.onExit(async ({ exitCode }) => {
      // Extract HTML from CLI output
      let htmlContent = fullOutput;
      const codeBlockMatch = htmlContent.match(/```(?:html)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) htmlContent = codeBlockMatch[1].trim();
      let htmlMatch = htmlContent.match(/<!DOCTYPE\s+html[^>]*>[\s\S]*<\/html>/i);
      if (htmlMatch) htmlContent = htmlMatch[0];
      else {
        htmlMatch = htmlContent.match(/<html[\s\S]*<\/html>/i);
        if (htmlMatch) htmlContent = htmlMatch[0];
      }

      if (htmlContent.includes("<html")) {
        await writeFile(htmlOutFile, htmlContent, "utf-8");

        // Write report.json
        const reportMeta = { template, status: "trained", generatedFrom: skillId, generatedAt: new Date().toISOString(), reportName };
        await writeFile(join(outDir, "report.json"), JSON.stringify(reportMeta, null, 2), "utf-8");

        res.write(JSON.stringify({ type: "done", data: { reportId, htmlPath: htmlOutFile, exitCode } }) + "\n");
      } else {
        res.write(JSON.stringify({ type: "error", data: { message: `CLI finished (code=${exitCode}) but no valid HTML found in output (${fullOutput.length} chars)` } }) + "\n");
      }

      // Cleanup prompt file
      try { await unlink(promptFile); } catch {}
      res.end();
    });

    // No 'error' event on PTY, but handle spawn failures
    // 180s timeout
    setTimeout(() => { try { ptyProc.kill(); } catch {} }, 180_000);
    return;
  }

  // GET /api/report-preview — serve generated HTML for preview
  if (req.method === "GET" && req.url?.match(/^\/api\/report-preview\?/)) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const htmlPath = urlObj.searchParams.get("path");
    if (!htmlPath || !htmlPath.startsWith("/")) {
      res.writeHead(400); res.end("Missing path"); return;
    }
    // Safety: only allow reading from tAgent paths
    if (!htmlPath.includes("/tagent/") && !htmlPath.includes(PHYSICAL_SKILL_ROOT)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    try {
      const html = await readFile(htmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  // POST /api/report-publish — publish trained report to skill's app.html
  if (req.method === "POST" && req.url === "/api/report-publish") {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { htmlPath, skillId, reportName } = parsed;

    if (!htmlPath || !htmlPath.includes("/tagent/")) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid path" })); return;
    }

    try {
      const html = await readFile(htmlPath, "utf-8");
      // Update report.json status
      const reportDir = dirname(htmlPath);
      const reportJsonPath = join(reportDir, "report.json");
      let meta = {};
      try { meta = JSON.parse(await readFile(reportJsonPath, "utf-8")); } catch {}
      meta.status = "published";
      meta.publishedAt = new Date().toISOString();
      await writeFile(reportJsonPath, JSON.stringify(meta, null, 2), "utf-8");

      // Also copy to apps/ directory
      const reportId = (reportName || skillId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || skillId;
      const appDir = join(APPS_ROOT, reportId);
      await mkdir(appDir, { recursive: true });
      await writeFile(join(appDir, "app.html"), html, "utf-8");
      const appJson = {
        name: reportName || reportId,
        skillId,
        template: meta.template || "",
        generatedAt: meta.generatedAt || new Date().toISOString(),
        publishedAt: meta.publishedAt,
        status: "published",
      };
      await writeFile(join(appDir, "app.json"), JSON.stringify(appJson, null, 2), "utf-8");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: htmlPath, appId: reportId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Factory CRUD ──

  // GET /api/factories — return single default "factory" (backward compat)
  if (req.method === "GET" && req.url?.match(/^\/api\/factories(?:\?.*)?$/)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{
      id: "default", name: "tAgent", description: "Personal AI Assistant",
      icon: "🐾", version: "2.0.0", createdAt: new Date().toISOString()
    }]));
    return;
  }

  // POST/DELETE /api/factories — disabled in tAgent (single team)
  if (req.url?.startsWith("/api/factories") && (req.method === "POST" || req.method === "DELETE")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, note: "tAgent uses flat crew structure" }));
    return;
  }

  // GET /api/pick-directory — native OS directory picker (macOS/Windows/Linux)
  if (req.method === "GET" && req.url === "/api/pick-directory") {
    try {
      const { execFile } = await import("child_process");
      const platform = process.platform;
      let path;

      if (platform === "darwin") {
        // macOS: osascript choose folder
        path = await new Promise((resolve, reject) => {
          execFile("osascript", ["-e", `POSIX path of (choose folder with prompt "Select Working Base")`], (err, stdout) => {
            if (err) { reject(err); return; }
            resolve(stdout.trim().replace(/\/$/, ""));
          });
        });
      } else if (platform === "win32") {
        // Windows: PowerShell FolderBrowserDialog
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$fb = New-Object System.Windows.Forms.FolderBrowserDialog
$fb.Description = 'Select Working Base'
if ($fb.ShowDialog() -eq 'OK') { $fb.SelectedPath } else { '' }
`.trim();
        path = await new Promise((resolve, reject) => {
          execFile("powershell", ["-NoProfile", "-Command", psScript], (err, stdout) => {
            if (err) { reject(err); return; }
            const p = stdout.trim();
            resolve(p || null);
          });
        });
      } else {
        // Linux: zenity or kdialog
        const { execSync } = await import("child_process");
        let cmd;
        try { execSync("which zenity", { stdio: "ignore" }); cmd = "zenity"; } catch {
          try { execSync("which kdialog", { stdio: "ignore" }); cmd = "kdialog"; } catch { cmd = null; }
        }
        if (cmd === "zenity") {
          path = await new Promise((resolve, reject) => {
            execFile("zenity", ["--file-selection", "--directory", "--title=Select Working Base"], (err, stdout) => {
              if (err) { reject(err); return; }
              resolve(stdout.trim() || null);
            });
          });
        } else if (cmd === "kdialog") {
          path = await new Promise((resolve, reject) => {
            execFile("kdialog", ["--getexistingdirectory", ".", "Select Working Base"], (err, stdout) => {
              if (err) { reject(err); return; }
              resolve(stdout.trim() || null);
            });
          });
        } else {
          path = null;
        }
      }

      if (path) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: null, error: "Cancelled or no dialog available" }));
      }
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: null, error: "Cancelled or not supported" }));
    }
    return;
  }

  // GET /api/skill-lab/build-files — list skill build files
  if (req.method === "GET" && req.url?.startsWith("/api/skill-lab/build-files")) {
    try {
      const skillsDir = join(TAGENT_ROOT, "data/skills");
      const results = [];
      // Scan skills/building/ directory for build-*.md files
      try {
        const buildingDir = join(skillsDir, "building");
        await mkdir(buildingDir, { recursive: true });
        const bEntries = await readdir(buildingDir);
        for (const f of bEntries) {
          if (/\.md$/i.test(f) && !f.startsWith("_")) {
            results.push({ name: "building/" + f, path: join(buildingDir, f) });
          }
        }
      } catch { /* building dir optional */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/report-lab/training-files — list report training files
  if (req.method === "GET" && req.url?.startsWith("/api/report-lab/training-files")) {
    try {
      const skillsDir = join(TAGENT_ROOT, "data/skills");
      const results = [];
      // Scan skills/training/ for report-*.md files
      const trainingDir = join(skillsDir, "training");
      try {
        const tStat = await import("fs/promises").then(m => m.stat(trainingDir));
        if (tStat.isDirectory()) {
          const tEntries = await readdir(trainingDir);
          for (const f of tEntries) {
            if (/\.md$/i.test(f) && !f.startsWith("_") && /report/i.test(f)) {
              results.push({ name: "training/" + f, path: join(trainingDir, f) });
            }
          }
        }
      } catch { /* training dir optional */ }
      // Also scan for any training files that contain report keywords
      try {
        const ipDir = join(skillsDir, "input-prompt");
        await mkdir(ipDir, { recursive: true });
        const dirs = await readdir(ipDir);
        for (const dir of dirs) {
          try {
            const stat = await import("fs/promises").then(m => m.stat(join(ipDir, dir)));
            if (!stat.isDirectory()) continue;
            const entries = await readdir(join(ipDir, dir));
            for (const f of entries) {
              if (/report/i.test(f) && /\.md$/i.test(f)) {
                results.push({ name: `input-prompt/${dir}/${f}`, path: join(ipDir, dir, f) });
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // PUT /api/fs/file?path=... — write file content
  if (req.method === "PUT" && req.url?.startsWith("/api/fs/file")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const filePath = params.get("path");
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'path' query param" }));
      return;
    }
    const absPath = resolve(filePath);
    if (!absPath.startsWith("/") && !/^[A-Za-z]:/.test(absPath)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Only absolute paths allowed" }));
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { content } = JSON.parse(body);
      await writeFile(absPath, content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/tagent-root — return tAgent base path
  if (req.method === "GET" && req.url === "/api/tagent-root") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tagentRoot: TAGENT_ROOT }));
    return;
  }

  // GET /api/factory-root — return tAgent root path
  const factoryRootMatch = req.method === "GET" && req.url?.match(/^\/api\/factory-root(?:\?(.*))?$/);
  if (factoryRootMatch) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ factoryRoot: TAGENT_ROOT, factoryId: "default" }));
    return;
  }

async function tagentApiHandler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // GET /api/tagent/cli-config — get CLI defaults
  if (req.method === "GET" && path === "/api/tagent/cli-config") {
    try {
      const filePath = resolve(TAGENT_DATA_DIR, "cli-config.json");
      const data = JSON.parse(await readFile(filePath, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ configured: false }));
    }
    return true;
  }

  // POST /api/tagent/cli-config — save CLI defaults
  if (req.method === "POST" && path === "/api/tagent/cli-config") {
    try {
      const body = JSON.parse(await readBody(req));
      body.configured = true;
      await writeFile(resolve(TAGENT_DATA_DIR, "cli-config.json"), JSON.stringify(body, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/clis — list installed CLI tools
  if (req.method === "GET" && req.url === "/api/clis") {
    try {
      const clis = await checkInstalledClis();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(clis));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/models — list available models for a CLI
  // ?cli=qwen|claude|opencode (default: qwen)
  const modelsMatch = req.method === "GET" && req.url?.match(/^\/api\/models(?:\?(.*))?$/);
  if (modelsMatch) {
    const qs = new URLSearchParams(modelsMatch[1] || "");
    const cliType = qs.get("cli") || "qwen";
    try {
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      const models = [];
      let currentModel = "";

      if (cliType === "qwen") {
        // Qwen has no CLI list command — read from settings
        const settingsPath = join(homeDir, ".qwen/settings.json");
        try {
          const raw = await readFile(settingsPath, "utf-8");
          const settings = JSON.parse(raw);
          const providers = settings.modelProviders || {};
          currentModel = settings.model?.name || "";
          for (const [, list] of Object.entries(providers)) {
            if (!Array.isArray(list)) continue;
            for (const m of list) {
              models.push({
                id: m.id, name: m.name,
                contextWindowSize: m.generationConfig?.contextWindowSize,
                vision: m.capabilities?.vision || false,
                current: m.id === currentModel,
              });
            }
          }
        } catch {}
      } else if (cliType === "claude") {
        // Claude has no CLI list command — try reading config for current model
        try {
          const raw = await readFile(join(homeDir, ".claude.json"), "utf-8");
          const cs = JSON.parse(raw);
          if (cs.model) currentModel = cs.model;
        } catch {}
        const claudeModels = [
          { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
          { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
          { id: "claude-haiku-4-20250506", name: "Claude Haiku 4" },
          { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet" },
          { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
        ];
        for (const m of claudeModels) {
          models.push({ id: m.id, name: m.name, current: m.id === currentModel });
        }
      } else if (cliType === "opencode") {
        // OpenCode: read ~/.config/opencode/opencode.json for model config
        // Provider config has: models (custom defs), whitelist (only show these)
        // Agent config has: model (default)
        // Path is the same on Mac, Linux, and Windows (via %APPDATA% or %USERPROFILE%\.config)
        const configPaths = [
          join(homeDir, ".config/opencode/opencode.json"),
          // Windows fallback
          join(process.env.APPDATA || join(homeDir, "AppData/Roaming"), "opencode/opencode.json"),
        ];
        let opencodeConfig = null;
        for (const cp of configPaths) {
          try {
            const raw = await readFile(cp, "utf-8");
            opencodeConfig = JSON.parse(raw);
            break;
          } catch {}
        }

        if (opencodeConfig) {
          // Get default model from agent config
          const agents = opencodeConfig.agent || opencodeConfig.agents || {};
          if (agents.model) currentModel = agents.model;

          // Collect models from provider configs
          const providers = opencodeConfig.provider || opencodeConfig.providers || {};
          for (const [provName, provConf] of Object.entries(providers)) {
            const pc = provConf;
            // If whitelist is set, only show those models
            if (Array.isArray(pc.whitelist)) {
              for (const m of pc.whitelist) {
                const id = typeof m === "string" ? m : m.id;
                models.push({ id, name: id, current: id === currentModel });
              }
            }
            // Also include custom model definitions
            if (pc.models && typeof pc.models === "object") {
              for (const [modelId, modelDef] of Object.entries(pc.models)) {
                const md = modelDef;
                if (!models.find(m => m.id === modelId)) {
                  models.push({ id: modelId, name: md.name || modelId, current: modelId === currentModel });
                }
              }
            }
          }
        }

        if (models.length === 0) {
          // Fallback: execute `opencode models` to get live model list
          const config = CLI_CONFIGS.opencode;
          const platform = process.platform;
          const binKey = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";
          const bin = process.env[config.envBin] || config.bins[binKey];
          try {
            const { stdout } = await execAsync(`"${bin}" models 2>&1`, { timeout: 15000 });
            const lines = (stdout || "").split("\n").map(l => l.trim()).filter(Boolean);
            const seen = new Set();
            for (const line of lines) {
              if (!seen.has(line)) {
                seen.add(line);
                models.push({ id: line, name: line, current: false });
              }
            }
          } catch (err) {
            console.log(`[Models] opencode models fallback failed: ${err.message}`);
          }
        }

        if (models.length === 0) {
          models.push({ id: "default", name: "OpenCode Default", current: true });
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tagentRoot: TAGENT_ROOT, models, currentModel }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tagentRoot: TAGENT_ROOT, models: [], currentModel: "", error: err.message }));
    }
    return;
  }

  // POST /api/opencode/prompt — send prompt to OpenCode via term.paste
  if (req.method === "POST" && req.url === "/api/opencode/prompt") {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    // This API just signals the frontend to use term.paste()
    // The actual paste is done client-side after health check confirms ready
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, text: parsed.text || "" }));
    return;
  }

  // PATCH /api/opencode/config — switch model via OpenCode server
  if (req.method === "PATCH" && req.url === "/api/opencode/config") {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const ocSession = [...ptySessions.values()].find(s => s.cliType === "opencode");
    const port = ocSession?.serverPort || 4199;
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await resp.text();
      res.writeHead(resp.status, { "Content-Type": "application/json" });
      res.end(data);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `OpenCode server not ready: ${err.message}` }));
    }
    return;
  }

  // GET /api/opencode/health — check if OpenCode server is up
  if (req.method === "GET" && req.url === "/api/opencode/health") {
    const ocSession = [...ptySessions.values()].find(s => s.cliType === "opencode");
    const port = ocSession?.serverPort || 4199;
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(3000) });
      const data = await resp.json();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ healthy: false }));
    }
    return;
  }

  // ── Crew CRUD endpoints (factory-scoped) ──

    // Helper: resolve CREW_DIR per request with factory scope
  function crewDirForRequest() { return factoryDir(getFactoryId(req.url), "crews"); }

  // Helper: list all crew JSON files
  async function listCrewFiles() {
    const dir = crewDirForRequest();
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    return files.filter(f => f.endsWith(".json") && !f.includes("conversation")).sort();
  }

  // GET /api/crew — list all crew members
  if (req.method === "GET" && req.url?.match(/^\/api\/crew(?:\?.*)?$/)) {
    try {
      const files = await listCrewFiles();
      const crew = await Promise.all(
        files.map(async (name) => {
          try {
            const raw = await readFile(join(crewDirForRequest(), name), "utf-8");
            return JSON.parse(raw);
          } catch { return null; }
        })
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(crew.filter(Boolean)));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/crew/:id — get single crew member
  const crewGetMatch = req.method === "GET" && req.url?.match(/^\/api\/crew\/([\w.-]+)(?:\?.*)?$/);
  if (crewGetMatch) {
    const crewId = crewGetMatch[1];
    try {
      const files = await listCrewFiles();
      let target = null;
      for (const f of files) {
        try {
          const raw = await readFile(join(crewDirForRequest(), f), "utf-8");
          const data = JSON.parse(raw);
          if (data.id === crewId) { target = f; break; }
        } catch { /* skip */ }
      }
      if (!target) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Crew not found" }));
        return;
      }
      const content = await readFile(join(crewDirForRequest(), target), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/crew — create new crew member
  if (req.method === "POST" && req.url?.match(/^\/api\/crew(?:\?.*)?$/)) {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    if (!parsed.id) { res.writeHead(400); res.end("Missing 'id'"); return; }
    if (!parsed.title) { res.writeHead(400); res.end("Missing 'title'"); return; }

    try {
      // Check for duplicate id
      const files = await listCrewFiles();
      for (const f of files) {
        const raw = await readFile(join(crewDirForRequest(), f), "utf-8");
        const existing = JSON.parse(raw);
        if (existing.id === parsed.id) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Crew id '${parsed.id}' already exists` }));
          return;
        }
      }

      // Determine next file number
      const numPrefix = files.length > 0
        ? String(Math.max(...files.map(f => parseInt(f.split("-")[0]) || 0)) + 1).padStart(2, "0")
        : "00";
      const filename = `${numPrefix}-${parsed.id}.json`;
      await writeFile(join(crewDirForRequest(), filename), JSON.stringify(parsed, null, 4), "utf-8");
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, filename, crew: parsed }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // PUT /api/crew/:id — update crew member
  const crewPutMatch = req.method === "PUT" && req.url?.match(/^\/api\/crew\/([\w.-]+)(?:\?.*)?$/);
  if (crewPutMatch) {
    const crewId = crewPutMatch[1];
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }

    try {
      const files = await listCrewFiles();
      let targetFile = null;
      for (const f of files) {
        const raw = await readFile(join(crewDirForRequest(), f), "utf-8");
        const existing = JSON.parse(raw);
        if (existing.id === crewId) { targetFile = f; break; }
      }
      if (!targetFile) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Crew not found" }));
        return;
      }
      // Ensure id is not changed
      parsed.id = crewId;
      await writeFile(join(crewDirForRequest(), targetFile), JSON.stringify(parsed, null, 4), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crew: parsed }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/crew/:id — delete crew member
  const crewDeleteMatch = req.method === "DELETE" && req.url?.match(/^\/api\/crew\/([\w.-]+)(?:\?.*)?$/);
  if (crewDeleteMatch) {
    const crewId = crewDeleteMatch[1];
    try {
      const files = await listCrewFiles();
      let targetFile = null;
      for (const f of files) {
        const raw = await readFile(join(crewDirForRequest(), f), "utf-8");
        const existing = JSON.parse(raw);
        if (existing.id === crewId) { targetFile = f; break; }
      }
      if (!targetFile) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Crew not found" }));
        return;
      }
      const { unlink } = await import("fs/promises");
      await unlink(join(crewDirForRequest(), targetFile));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── End Crew CRUD endpoints ──

  // ── Conversation endpoints ──

  // GET /api/conversations/:employeeId — list conversations
  const convListMatch = req.method === "GET" && req.url?.match(/^\/api\/conversations\/([\w.-]+)(?:\?.*)?$/);
  if (convListMatch) {
    const employeeId = convListMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const convDir = getConvDir(employeeId, root);
    try {
      await mkdir(convDir, { recursive: true });
      const files = await readdir(convDir);
      const jsonFiles = files.filter(f => f.endsWith(".json")).sort().reverse();
      const conversations = await Promise.all(
        jsonFiles.map(async (name) => {
          try {
            const raw = await readFile(join(convDir, name), "utf-8");
            const data = JSON.parse(raw);
            return {
              id: name.replace(/\.json$/, ""),
              title: data.title || name.replace(/\.json$/, ""),
              createdAt: data.createdAt,
              updatedAt: data.updatedAt || data.createdAt,
              messageCount: data.messages?.length || 0,
              model: data.model || "",
            };
          } catch { return null; }
        })
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(conversations.filter(Boolean)));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // GET /api/conversations/:employeeId/:convId — load a conversation
  const convGetMatch = req.method === "GET" && req.url?.match(/^\/api\/conversations\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
  if (convGetMatch) {
    const [, employeeId, convId] = convGetMatch;
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const filePath = join(getConvDir(employeeId, root), `${convId}.json`);
    try {
      const content = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Conversation not found" }));
    }
    return;
  }

  // POST /api/conversations/:employeeId — save a conversation
  const convSaveMatch = req.method === "POST" && req.url?.match(/^\/api\/conversations\/([\w.-]+)(?:\?.*)?$/);
  if (convSaveMatch) {
    const employeeId = convSaveMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { id, title, messages, model, systemPrompt } = parsed;
    if (!id) { res.writeHead(400); res.end("Missing 'id'"); return; }
    const convDir = getConvDir(employeeId, root);
    await mkdir(convDir, { recursive: true });
    const filePath = join(convDir, `${id}.json`);
    const data = {
      id,
      employeeId,
      title: title || id,
      messages,
      model: model || "",
      systemPrompt: systemPrompt || "",
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

    // Cleanup: keep only the 5 most recent conversations
    try {
      const files = await readdir(convDir);
      const jsonFiles = files.filter(f => f.endsWith(".json"));
      if (jsonFiles.length > 5) {
        // Get all files with their timestamps
        const fileStats = await Promise.all(jsonFiles.map(async f => {
          try {
            const raw = await readFile(join(convDir, f), "utf-8");
            const d = JSON.parse(raw);
            return { name: f, updatedAt: d.updatedAt || d.createdAt || "" };
          } catch {
            return { name: f, updatedAt: "" };
          }
        }));
        // Sort by updatedAt descending, delete the oldest ones
        fileStats.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        const toDelete = fileStats.slice(5);
        for (const f of toDelete) {
          try { await unlink(join(convDir, f.name)); } catch { /* ignore */ }
        }
      }
    } catch { /* cleanup is best-effort */ }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id }));
    return;
  }

  // DELETE /api/conversations/:employeeId/:convId — delete a conversation
  const convDeleteMatch = req.method === "DELETE" && req.url?.match(/^\/api\/conversations\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
  if (convDeleteMatch) {
    const [, employeeId, convId] = convDeleteMatch;
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const filePath = join(getConvDir(employeeId, root), `${convId}.json`);
    const { unlink } = await import("fs/promises");
    try {
      await unlink(filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Conversation not found" }));
    }
    return;
  }

  // ── End Conversation endpoints ──

  // ── Saved Inputs endpoints ──

  // GET /api/saved-inputs/:employeeId — list saved inputs
  const savedInputsGetMatch = req.method === "GET" && req.url?.match(/^\/api\/saved-inputs\/([\w.-]+)(?:\?.*)?$/);
  if (savedInputsGetMatch) {
    const employeeId = savedInputsGetMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const hash = projectPathHash(root);
    const dir = resolve(CONVERSATIONS_ROOT, hash, employeeId);
    const filePath = join(dir, "saved-inputs.json");
    try {
      const content = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ inputs: [] }));
    }
    return;
  }

  // POST /api/saved-inputs/:employeeId — save an input
  const savedInputsPostMatch = req.method === "POST" && req.url?.match(/^\/api\/saved-inputs\/([\w.-]+)(?:\?.*)?$/);
  if (savedInputsPostMatch) {
    const employeeId = savedInputsPostMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { hash: inputHash, skillId, data } = parsed;
    if (!inputHash) { res.writeHead(400); res.end("Missing 'hash'"); return; }

    const pHash = projectPathHash(root);
    const dir = resolve(CONVERSATIONS_ROOT, pHash, employeeId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "saved-inputs.json");

    let existing = { inputs: [] };
    try {
      const raw = await readFile(filePath, "utf-8");
      existing = JSON.parse(raw);
    } catch { /* first time */ }

    // Check for duplicate hash
    if (!existing.inputs.some(i => i.hash === inputHash)) {
      existing.inputs.push({
        hash: inputHash,
        skillId: skillId || "",
        data: data || {},
        savedAt: new Date().toISOString(),
      });
      await writeFile(filePath, JSON.stringify(existing, null, 2), "utf-8");
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, inputs: existing.inputs }));
    return;
  }

  // ── End Saved Inputs endpoints ──

  // ── Work Log endpoints ──

  // GET /api/work-log/:employeeId — list work log entries
  const workLogGetMatch = req.method === "GET" && req.url?.match(/^\/api\/work-log\/([\w.-]+)(?:\?.*)?$/);
  if (workLogGetMatch) {
    const employeeId = workLogGetMatch[1];
    const u = new URL(req.url, `http://localhost`);
    const root = u.searchParams.get("root");
    const dir = root
      ? join(CONVERSATIONS_ROOT, projectPathHash(root), employeeId)
      : join(factoryDir(getFactoryId(req.url), "crews"), "conversation", employeeId);
    const filePath = join(dir, "work-log.json");
    try {
      const raw = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(raw);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ entries: [] }));
    }
    return;
  }

  // POST /api/work-log/:employeeId — save a work log entry
  const workLogPostMatch = req.method === "POST" && req.url?.match(/^\/api\/work-log\/([\w.-]+)(?:\?.*)?$/);
  if (workLogPostMatch) {
    const employeeId = workLogPostMatch[1];
    const u = new URL(req.url, `http://localhost`);
    const root = u.searchParams.get("root");
    const dir = root
      ? join(CONVERSATIONS_ROOT, projectPathHash(root), employeeId)
      : join(factoryDir(getFactoryId(req.url), "crews"), "conversation", employeeId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "work-log.json");

    let body = "";
    for await (const chunk of req) body += chunk;
    const { skillIds, inputSummary, cli, inputData } = JSON.parse(body);

    let existing = { entries: [] };
    try {
      const raw = await readFile(filePath, "utf-8");
      existing = JSON.parse(raw);
    } catch { /* first time */ }

    existing.entries.unshift({
      id: `work-${Date.now()}`,
      skillIds: skillIds || [],
      inputSummary: inputSummary || "",
      cli: cli || "",
      inputData: inputData || {},
      timestamp: new Date().toISOString(),
    });

    // Deduplicate: remove entries with same inputSummary + cli within 2 seconds
    existing.entries = existing.entries.filter((entry, idx, arr) => {
      if (idx === 0) return true;
      const prev = arr.findIndex(e => e.inputSummary === entry.inputSummary && e.cli === entry.cli);
      if (prev < idx) {
        const timeDiff = new Date(entry.timestamp).getTime() - new Date(arr[prev].timestamp).getTime();
        if (Math.abs(timeDiff) < 3000) return false; // duplicate within 3s
      }
      return true;
    });

    // Keep last 50 entries
    if (existing.entries.length > 50) existing.entries = existing.entries.slice(0, 50);

    await writeFile(filePath, JSON.stringify(existing, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── End Work Log endpoints ──

  // GET /api/fs/pick-folder — native OS folder picker (macOS / Linux / Windows)
  if (req.method === "GET" && req.url?.startsWith("/api/fs/pick-folder")) {
    try {
      const { execFile, exec } = await import("child_process");
      const platform = process.platform; // 'darwin' | 'linux' | 'win32'
      let result;

      if (platform === "darwin") {
        // macOS — osascript
        result = await new Promise((resolve, reject) => {
          execFile("osascript", ["-e", 'set chosenFolder to choose folder with prompt "Select a project folder"\nreturn POSIX path of chosenFolder'], (err, stdout) => {
            if (err) reject(err); else resolve(stdout.toString().trim());
          });
        });
      } else if (platform === "linux") {
        // Linux — try zenity first, fallback to kdialog
        try {
          result = await new Promise((resolve, reject) => {
            execFile("zenity", ["--file-selection", "--directory", "--title=Select a project folder"], (err, stdout) => {
              if (err) reject(err); else resolve(stdout.toString().trim());
            });
          });
        } catch {
          result = await new Promise((resolve, reject) => {
            execFile("kdialog", ["--getexistingdirectory", process.env.HOME || process.env.USERPROFILE || "/", "Select a project folder"], (err, stdout) => {
              if (err) reject(err); else resolve(stdout.toString().trim());
            });
          });
        }
      } else if (platform === "win32") {
        // Windows — PowerShell FolderBrowserDialog
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          $fb = New-Object System.Windows.Forms.FolderBrowserDialog
          $fb.Description = 'Select a project folder'
          $fb.ShowNewFolderButton = $false
          if ($fb.ShowDialog() -eq 'OK') { $fb.SelectedPath } else { exit 1 }
        `;
        result = await new Promise((resolve, reject) => {
          import("child_process").then(({ exec }) => {
            exec(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $fb = New-Object System.Windows.Forms.FolderBrowserDialog; $fb.Description = 'Select a project folder'; $fb.ShowNewFolderButton = $false; if ($fb.ShowDialog() -eq 'OK') { $fb.SelectedPath } else { exit 1 }"`, { maxBuffer: 1024*1024 }, (err, stdout) => {
              if (err) reject(err); else resolve(stdout.toString().trim());
            });
          }).catch(reject);
        });
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: result }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: null, error: "Folder picker cancelled or unavailable" }));
    }
    return;
  }

  // GET /api/fs/browse?path=... — list immediate subdirectories for folder picker
  if (req.method === "GET" && req.url?.startsWith("/api/fs/browse")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const dirPath = params.get("path") || "";
    const absPath = dirPath ? resolve(dirPath) : resolve(process.env.USERPROFILE || process.env.HOME || "/");
    try {
      const stat = await import("fs").then(m => m.promises.stat(absPath));
      if (!stat.isDirectory()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not a directory" }));
        return;
      }
      const entries = await readdir(absPath, { withFileTypes: true });
      const IGNORED = new Set([".git", "node_modules", ".DS_Store", ".cache", ".Trash", ".npm", ".vite"]);
      const dirs = entries
        .filter(e => e.isDirectory() && !IGNORED.has(e.name) && !e.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(e => ({ name: e.name, path: join(absPath, e.name) }));
      const parent = (absPath !== "/" && !/^[A-Za-z]:\\$/.test(absPath)) ? dirname(absPath) : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ currentPath: absPath, parent, directories: dirs }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message, currentPath: absPath, parent: null, directories: [] }));
    }
    return;
  }

  // GET /api/fs/tree?root=... — directory tree for release unit
  if (req.method === "GET" && req.url?.startsWith("/api/fs/tree") && !req.url?.startsWith("/api/fs/tree-deep")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const root = params.get("root");
    if (!root) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'root' query param" }));
      return;
    }
    const absRoot = resolve(root);
    // Safety: only allow absolute paths (Unix: /... or Windows: C:\... / X:/...)
    if (!absRoot.startsWith("/") && !/^[A-Za-z]:/.test(absRoot)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Only absolute paths allowed" }));
      return;
    }
    try {
      const tree = await buildTree(absRoot, absRoot, 2);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/fs/file?path=... — read file content
  if (req.method === "GET" && req.url?.startsWith("/api/fs/file")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const filePath = params.get("path");
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'path' query param" }));
      return;
    }
    const absPath = resolve(filePath);
    if (!absPath.startsWith("/") && !/^[A-Za-z]:/.test(absPath)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Only absolute paths allowed" }));
      return;
    }
    try {
      const stat = await import("fs").then(m => m.promises.stat(absPath));
      const ext = absPath.split(".").pop()?.toLowerCase() ?? "";
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
      const isImage = imageExts.includes(ext);
      if (isImage && stat.size > 10 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Image too large (max 10MB)" }));
        return;
      }
      if (!isImage && stat.size > 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File too large (max 1MB)" }));
        return;
      }
      if (isImage) {
        // Binary image file — return raw bytes
        const mimeMap = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
          bmp: "image/bmp", ico: "image/x-icon",
        };
        const data = await readFile(absPath); // buffer
        res.writeHead(200, {
          "Content-Type": mimeMap[ext] || "application/octet-stream",
          "Content-Length": stat.size,
          "Cache-Control": "public, max-age=3600",
        });
        res.end(data);
      } else {
        const content = await readFile(absPath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: absPath, content, size: stat.size }));
      }
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
    }
    return;
  }

  // GET /api/fs/tree-deep?root=...&subpath=... — lazy-load one directory level
  if (req.method === "GET" && req.url?.startsWith("/api/fs/tree-deep")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const root = params.get("root");
    const subpath = params.get("subpath") || "";
    if (!root) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'root' query param" }));
      return;
    }
    const absDir = resolve(join(root, subpath));
    try {
      const children = await buildTree(absDir, absDir, 1);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(children));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/fs/item?path=... — delete file or folder (recursive)
  if (req.method === "DELETE" && req.url?.startsWith("/api/fs/item")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const targetPath = params.get("path");
    if (!targetPath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'path' query param" }));
      return;
    }
    const absPath = resolve(targetPath);
    // Safety: only allow absolute paths
    if (!absPath.startsWith("/") && !/^[A-Za-z]:/.test(absPath)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Only absolute paths allowed" }));
      return;
    }
    // Safety: refuse to delete project root itself
    try {
      const stat = await import("fs").then(m => m.promises.stat(absPath));
      if (stat.isDirectory()) {
        await rm(absPath, { recursive: true, force: true });
      } else {
        await unlink(absPath);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: absPath }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/factory/:factoryId/crews-pic/:filename — serve crew photo
  const crewPicMatch = req.method === "GET" && req.url?.match(/^\/api\/factory\/([\w.-]+)\/crews-pic\/(.+)$/);
  if (crewPicMatch) {
    const [, , picName] = crewPicMatch;
    const picPath = join(CREWS_ROOT, "pic", picName);
    try {
      const { stat } = await import("fs/promises");
      const s = await stat(picPath);
      if (!s.isFile()) throw new Error("Not a file");
      const ext = picName.split(".").pop()?.toLowerCase();
      const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
      res.writeHead(200, { "Content-Type": mimeMap[ext] || "application/octet-stream" });
      const { createReadStream } = await import("fs");
      createReadStream(picPath).pipe(res);
    } catch {
      // Fallback: return 1x1 transparent PNG instead of 404
      const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRUEFTkSuQmCC", "base64");
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
      res.end(transparentPng);
    }
    return;
  }

  // GET /api/factory-content/:name — single file
  const singleFileMatch = req.method === "GET" && req.url?.match(/^\/api\/factory-content\/([\w.-]+)(?:\?.*)?$/);
  if (singleFileMatch) {
    const name = singleFileMatch[1];
    const fId = getFactoryId(req.url);
    const factoryDir = DOCS_ROOT;
    const filePath = join(factoryDir, name);
    try {
      const content = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ filename: name, content }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
    }
    return;
  }

  // GET /api/factory-content — list all files in factory directory
  const factoryContentListMatch = req.method === "GET" && req.url?.match(/^\/api\/factory-content(?:\?.*)?$/);
  if (factoryContentListMatch) {
    const fId = getFactoryId(req.url);
    const factoryDirPath = DOCS_ROOT;
    try {
      const files = await readdir(factoryDirPath);
      const result = files.sort().map(f => ({ filename: f }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // GET /api/project-dashboard — read .aieoc/dashboard.json from any project
  if (req.method === "GET" && req.url?.startsWith("/api/project-dashboard")) {
    try {
      const u = new URL(req.url, `http://localhost`);
      const root = u.searchParams.get("root");
      if (!root) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing root param" }));
        return;
      }
      const dashFile = join(root, ".aieoc", "dashboard.json");
      const content = await readFile(dashFile, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(null));
    }
    return;
  }

  // POST /api/hello-world — Hello World AI Node Demo
  if (req.method === "POST" && req.url === "/api/hello-world") {
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        errorCode: "BIZ_HELLO_WORLD_REQUEST_INVALID",
        errorType: "VALIDATION",
        message: "Invalid JSON format"
      }));
      return;
    }

    const { traceId, name, language } = parsed;

    // Validate Input Contract
    if (!traceId || typeof traceId !== "string" || traceId.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        errorCode: "BIZ_HELLO_WORLD_REQUEST_INVALID",
        errorType: "VALIDATION",
        message: "traceId is required and must be a non-empty string"
      }));
      return;
    }

    // Process greeting
    const greetings = {
      en: "Hello",
      zh: "你好",
      ja: "こんにちは",
      es: "¡Hola",
    };

    const lang = language || "en";
    const greeting = greetings[lang] || greetings["en"];
    const displayName = (name || "World").trim();

    // Build Output Contract response
    const response = {
      traceId,
      greeting,
      message: `${greeting}, ${displayName}! Welcome to AI Software Factory 🏭`,
      language: lang,
      timestamp: new Date().toISOString(),
      nodeInfo: {
        nodeId: "hello-world-node",
        version: "1.0.0",
        factory: "ai-factory",
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
    return;
  }

  // GET /api/hello-world — Health check
  if (req.method === "GET" && req.url === "/api/hello-world") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "healthy",
      nodeId: "hello-world-node",
      version: "1.0.0",
      factory: "ai-factory",
    }));
    return;
  }

  // SSE: File watcher
  if (req.method === "GET" && req.url?.startsWith("/api/fs/watch")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const root = params.get("root");
    if (!root) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing root" }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("\n"); // kick the stream
    const watcher = startWatcher(root, res);
    req.on("close", () => {
      watcher.close();
      res.end();
    });
    return;
  }

async function buildTree(absRoot, currentPath, maxDepth) {
  const IGNORED = new Set([".git", "node_modules", ".DS_Store", "__pycache__", ".next", "dist", ".cache", ".turbo"]);
  const result = { name: currentPath === absRoot ? basename(absRoot) : basename(currentPath), path: currentPath, type: "dir", children: [] };
  if (maxDepth <= 0) { result.children = undefined; result.lazy = true; return result; }
  let entries;
  try { entries = await readdir(currentPath, { withFileTypes: true }); } catch { return result; }
  // Sort: dirs first, then files, both alphabetical
  const sorted = entries
    .filter(e => !IGNORED.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
  // Cap at 200 entries per directory to avoid perf issues
  const capped = sorted.slice(0, 200);
  if (sorted.length > 200) {
    result.children.push({ name: `... and ${sorted.length - 200} more`, path: "__truncated__", type: "file" });
  }
  for (const entry of capped) {
    const fullPath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      const child = await buildTree(absRoot, fullPath, maxDepth - 1);
      result.children.push(child);
    } else {
      result.children.push({ name: entry.name, path: fullPath, type: "file" });
    }
  }
  return result;
}

function basename(p) {
  // Handle both Unix (/) and Windows (\) separators
  const parts = p.replace(/[\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ── File Watcher (SSE) ──
// Each SSE client gets its own watcher, supporting multiple roots simultaneously
function startWatcher(root, sseRes) {
  const w = chokidar.watch(root, {
    ignored: /node_modules|\.git|dist|__pycache__|\.next|\.nuxt|target|build/,
    persistent: true,
    ignoreInitial: true,
    depth: 8,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  const send = (type, path) => {
    try {
      sseRes.write(`data: ${JSON.stringify({ type, path })}\n\n`);
    } catch { /* client gone */ }
  };
  w.on("add", (p) => send("add", p));
  w.on("unlink", (p) => send("unlink", p));
  w.on("change", (p) => send("change", p));
  w.on("addDir", (p) => send("addDir", p));
  w.on("unlinkDir", (p) => send("unlinkDir", p));
  console.log(`[Watcher] Watching ${root} (client ${sseRes.socket?.remotePort})`);
  return w;
}


// ── tAgent Personal Assistant APIs ──

const TAGENT_DATA_DIR = resolve(TAGENT_ROOT, "data");
const TAGENT_USER_FILE = resolve(TAGENT_DATA_DIR, "user.json");
const TAGENT_CHAT_DIR = resolve(TAGENT_DATA_DIR, "chats");

await mkdir(TAGENT_DATA_DIR, { recursive: true });
await mkdir(TAGENT_CHAT_DIR, { recursive: true });

  // GET /api/tagent/user — get user profile
  if (req.method === "GET" && path === "/api/tagent/user") {
    try {
      const data = JSON.parse(await readFile(TAGENT_USER_FILE, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(null)); // not onboarded yet
    }
    return true;
  }

  // POST /api/tagent/user — save user profile (onboarding)
  if (req.method === "POST" && path === "/api/tagent/user") {
    const body = JSON.parse(await readBody(req));
    await writeFile(TAGENT_USER_FILE, JSON.stringify(body, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // POST /api/tagent/avatar — upload assistant avatar
  if (req.method === "POST" && path === "/api/tagent/avatar") {
    try {
      const body = JSON.parse(await readBody(req));
      const { data: base64Data, filename } = body;
      if (!base64Data) { res.writeHead(400); res.end(JSON.stringify({ error: "no data" })); return true; }
      const avatarDir = resolve(TAGENT_DATA_DIR, "avatars");
      await mkdir(avatarDir, { recursive: true });
      const ext = (filename || "").split(".").pop() || "png";
      const avatarName = `assistant.${ext}`;
      const avatarPath = resolve(avatarDir, avatarName);
      const buffer = Buffer.from(base64Data, "base64");
      await writeFile(avatarPath, buffer);
      // Update user profile with avatar path
      let userProfile;
      try { userProfile = JSON.parse(readFileSync(TAGENT_USER_FILE, "utf-8")); } catch { userProfile = {}; }
      userProfile.assistantAvatar = `/api/tagent/avatar/assistant`;
      await writeFile(TAGENT_USER_FILE, JSON.stringify(userProfile, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: `/api/tagent/avatar/assistant` }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/tagent/avatar/assistant — serve assistant avatar
  if (req.method === "GET" && path === "/api/tagent/avatar/assistant") {
    try {
      const avatarDir = resolve(TAGENT_DATA_DIR, "avatars");
      const files = await readdir(avatarDir);
      const avatarFile = files.find(f => f.startsWith("assistant."));
      if (avatarFile) {
        const data = await readFile(resolve(avatarDir, avatarFile));
        const ext = avatarFile.split(".").pop();
        res.writeHead(200, { "Content-Type": `image/${ext === "jpg" ? "jpeg" : ext}` });
        res.end(data);
      } else {
        res.writeHead(404); res.end("Not found");
      }
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return true;
  }

  // GET /api/tagent/chats — list all chat sessions
  if (req.method === "GET" && path === "/api/tagent/chats") {
    try {
      const files = await readdir(TAGENT_CHAT_DIR);
      const chats = [];
      for (const f of files.filter(f => f.endsWith(".json")).sort().reverse()) {
        try {
          const raw = JSON.parse(await readFile(resolve(TAGENT_CHAT_DIR, f), "utf-8"));
          chats.push({ id: raw.id, title: raw.title || "新對話", createdAt: raw.createdAt, updatedAt: raw.updatedAt });
        } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(chats));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return true;
  }

  // GET /api/tagent/chats/:id — get single chat
  if (req.method === "GET" && path.startsWith("/api/tagent/chats/")) {
    const chatId = path.split("/").pop().replace(".json", "");
    try {
      const data = JSON.parse(await readFile(resolve(TAGENT_CHAT_DIR, `${chatId}.json`), "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return true;
  }

  // POST /api/tagent/chats — create new chat
  if (req.method === "POST" && path === "/api/tagent/chats") {
    const body = JSON.parse(await readBody(req));
    const chatId = body.id || `chat_${Date.now()}`;
    const chatData = { id: chatId, title: body.title || "新對話", messages: body.messages || [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeFile(resolve(TAGENT_CHAT_DIR, `${chatId}.json`), JSON.stringify(chatData, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(chatData));
    return true;
  }

  // PUT /api/tagent/chats/:id — update chat (add messages, rename)
  if (req.method === "PUT" && path.startsWith("/api/tagent/chats/")) {
    const chatId = path.split("/").pop().replace(".json", "");
    const filePath = resolve(TAGENT_CHAT_DIR, `${chatId}.json`);
    let existing;
    try {
      existing = JSON.parse(await readFile(filePath, "utf-8"));
    } catch {
      existing = { id: chatId, title: "新對話", messages: [], createdAt: new Date().toISOString() };
    }
    const body = JSON.parse(await readBody(req));
    const updated = { ...existing, ...body, updatedAt: new Date().toISOString() };
    await writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(updated));
    return true;
  }

  // DELETE /api/tagent/chats/:id — delete chat
  if (req.method === "DELETE" && path.startsWith("/api/tagent/chats/")) {
    const chatId = path.split("/").pop().replace(".json", "");
    try { await unlink(resolve(TAGENT_CHAT_DIR, `${chatId}.json`)); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Provider / Model APIs ──

  // GET /api/tagent/providers — list providers + models (mask apiKey)
  if (req.method === "GET" && path === "/api/tagent/providers") {
    try {
      const config = JSON.parse(await readFile(resolve(TAGENT_DATA_DIR, "providers.json"), "utf-8"));
      const hasAnyKey = Object.values(config.providers).some((p) => p.apiKey && p.apiKey.length > 0);
      const safe = { active: config.active, defaultModel: config.defaultModel, configured: hasAnyKey, providers: {} };
      for (const [k, v] of Object.entries(config.providers)) {
        safe.providers[k] = { ...v, apiKey: v.apiKey ? v.apiKey.slice(0, 8) + "..." : "" };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(safe));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: "", defaultModel: "", configured: false, providers: {} }));
    }
    return true;
  }

  // PUT /api/tagent/providers — update provider config
  if (req.method === "PUT" && path === "/api/tagent/providers") {
    try {
      const filePath = resolve(TAGENT_DATA_DIR, "providers.json");
      const config = JSON.parse(await readFile(filePath, "utf-8"));
      const body = JSON.parse(await readBody(req));
      if (body.active) config.active = body.active;
      if (body.defaultModel) config.defaultModel = body.defaultModel;
      // Update provider fields (apiKey, baseURL, models)
      if (body.provider && body.providerId) {
        const pid = body.providerId;
        if (config.providers[pid]) {
          if (body.provider.apiKey !== undefined) config.providers[pid].apiKey = body.provider.apiKey;
          if (body.provider.baseURL !== undefined) config.providers[pid].baseURL = body.provider.baseURL;
          if (body.provider.models) config.providers[pid].models = body.provider.models;
        }
      }
      // Update all providers at once
      if (body.providers) {
        for (const [pid, pdata] of Object.entries(body.providers)) {
          if (!config.providers[pid]) config.providers[pid] = { name: pid, baseURL: "", apiKey: "", models: [] };
          const p = pdata;
          if (p.apiKey !== undefined) config.providers[pid].apiKey = p.apiKey;
          if (p.baseURL !== undefined) config.providers[pid].baseURL = p.baseURL;
          if (p.models) config.providers[pid].models = p.models;
          if (p.name) config.providers[pid].name = p.name;
        }
      }
      await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
      // Return masked version
      const safe = { ok: true, active: config.active, defaultModel: config.defaultModel, providers: {} };
      for (const [k, v] of Object.entries(config.providers)) {
        safe.providers[k] = { ...v, apiKey: v.apiKey ? v.apiKey.slice(0, 8) + "..." : "" };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(safe));
    } catch (err) {
      console.error("[tAgent] Provider update error:", err);
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to update providers" }));
    }
    return true;
  }

  // ── Workspaces API ──
  const TAGENT_WORKSPACES_FILE = resolve(TAGENT_DATA_DIR, "workspaces.json");

  // GET /api/tagent/workspaces
  if (req.method === "GET" && path === "/api/tagent/workspaces") {
    try {
      const data = JSON.parse(await readFile(TAGENT_WORKSPACES_FILE, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ directories: [] }));
    }
    return true;
  }

  // POST /api/tagent/workspaces — add directory
  if (req.method === "POST" && path === "/api/tagent/workspaces") {
    try {
      let data;
      try { data = JSON.parse(await readFile(TAGENT_WORKSPACES_FILE, "utf-8")); } catch { data = { directories: [] }; }
      const body = JSON.parse(await readBody(req));
      const dir = body.directory;
      if (!dir) { res.writeHead(400); res.end(JSON.stringify({ error: "directory required" })); return true; }
      if (!data.directories.includes(dir)) {
        data.directories.push(dir);
        await writeFile(TAGENT_WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf-8");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to add workspace" }));
    }
    return true;
  }

  // DELETE /api/tagent/workspaces?dir=... — remove directory
  if (req.method === "DELETE" && path === "/api/tagent/workspaces") {
    try {
      const dir = url.searchParams.get("dir");
      let data;
      try { data = JSON.parse(await readFile(TAGENT_WORKSPACES_FILE, "utf-8")); } catch { data = { directories: [] }; }
      data.directories = data.directories.filter((d) => d !== dir);
      await writeFile(TAGENT_WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to remove workspace" }));
    }
    return true;
  }

  // ── Chat completion (SSE streaming) ──

  // POST /api/tagent/chat — chat completion with streaming + tool calling
  if (req.method === "POST" && path === "/api/tagent/chat") {
    try {
      const body = JSON.parse(await readBody(req));
      const { messages, model: requestedModel, provider: requestedProvider } = body;

      const config = JSON.parse(await readFile(resolve(TAGENT_DATA_DIR, "providers.json"), "utf-8"));
      const providerId = requestedProvider || config.active;
      const provider = config.providers[providerId];
      if (!provider) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown provider: ${providerId}` }));
        return true;
      }

      const model = requestedModel || config.defaultModel || "glm-5.1";
      const baseURL = provider.baseURL.replace(/\/+$/, "");
      const apiUrl = `${baseURL}/chat/completions`;

      const userProfile = (() => {
        try { return JSON.parse(readFileSync(TAGENT_USER_FILE, "utf-8")); } catch { return null; }
      })();

      const workspaces = (() => {
        try {
          const ws = JSON.parse(readFileSync(resolve(TAGENT_DATA_DIR, "workspaces.json"), "utf-8"));
          return ws.directories || [];
        } catch { return []; }
      })();

      const workspaceInfo = workspaces.length > 0
        ? `\n\n使用者的 Workspace 目錄：\n${workspaces.map(d => `- ${d}`).join("\n")}`
        : "";

      const assistantName = userProfile?.assistantName || "林語晴";

      // Load MEMORY.md (assistant's long-term memory)
      let memoryContent = "";
      try {
        memoryContent = await readFile(resolve(TAGENT_DATA_DIR, "MEMORY.md"), "utf-8");
      } catch {}

      // Build app instructions
      const { tools: toolDefinitions, handlers: toolHandlers, appInstructions } = await getToolsAndHandlers();

      const systemPrompt = `你是${assistantName}，一個友善、聰明的個人 AI 助理。大家都叫你 Sunny。你不只能聊天，還能幫使用者做事。你有工具可以操作各種 App。當使用者提出需要操作的請求時，使用對應的工具來完成。

回答時使用繁體中文，技術術語保留英文。語氣親切專業，像一位值得信賴的同事。

=== 使用者資訊 ===
- 名字：${userProfile?.name || "未知"}
- 介紹：${userProfile?.intro || ""}
- 偏好風格：${userProfile?.style || "casual"}${workspaceInfo}

=== 你的長期記憶 (MEMORY.md) ===
每次對話都會載入這份記憶。如果使用者說「記住」「幫我記」，使用 memory_add 工具更新。
${memoryContent || "(記憶是空白的)"}

=== 可用的 App ===
${appInstructions}

=== 回覆規則 ===
- 用中文回覆，風格自然友善
- 使用者問「我有什麼 App」→ 用 app_list 工具查詢，不要猜
- 使用者要求做事時，用對應 App 的工具完成，然後告訴使用者結果
- 主動運用記憶中的資訊（偏好、過去的決策、人際關係）
- 如果學到新東西（偏好、決策、重要資訊），主動用 memory_add 記下來
- 使用者想建新 App 時，用 app_create 幫他建立
- Workspace 是檔案目錄，App 是資料工具，兩者不同
- 不確定的事情就用工具查，不要用猜的
- 使用 Markdown 格式`;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const apiHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${provider.apiKey}`,
        ...(providerId === "openrouter" ? { "HTTP-Referer": "https://tagent.ai", "X-Title": "tAgent" } : {}),
      };

      const apiMessages = [
        { role: "system", content: systemPrompt },
        ...(messages || [])
      ];

      // Tool calling loop (max 5 rounds)
      const MAX_TOOL_ROUNDS = 5;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const requestPayload = {
          model,
          messages: apiMessages,
          max_tokens: 4096,
          stream: true,
          tools: toolDefinitions,
          tool_choice: "auto",
        };

        const apiResp = await fetch(apiUrl, {
          method: "POST",
          headers: apiHeaders,
          body: JSON.stringify(requestPayload),
        });

        if (!apiResp.ok) {
          const errText = await apiResp.text();
          res.write(`data: ${JSON.stringify({ error: true, message: `API error ${apiResp.status}: ${errText.slice(0, 200)}` })}\n\n`);
          res.end();
          return true;
        }

        const reader = apiResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";
        let toolCalls = [];
        let currentToolCall = null;
        let finishReason = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const data = trimmed.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const choice = parsed.choices?.[0];
                if (!choice) continue;
                if (choice.finish_reason) finishReason = choice.finish_reason;
                const delta = choice.delta?.content;
                if (delta) {
                  fullContent += delta;
                  res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
                }
                const tcDeltas = choice.delta?.tool_calls;
                if (tcDeltas) {
                  for (const tc of tcDeltas) {
                    if (tc.id) {
                      currentToolCall = { id: tc.id, name: tc.function?.name || "", arguments: tc.function?.arguments || "" };
                      toolCalls.push(currentToolCall);
                    } else if (currentToolCall && tc.function?.arguments) {
                      currentToolCall.arguments += tc.function.arguments;
                    }
                  }
                }
              } catch {}
            }
          }
        } catch (err) {
          console.error("[tAgent] Stream error:", err.message);
        }

        if (toolCalls.length === 0 || finishReason !== "tool_calls") {
          break;
        }

        // Execute tool calls
        apiMessages.push({
          role: "assistant",
          content: fullContent || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments }
          }))
        });

        for (const tc of toolCalls) {
          let args = {};
          try { args = JSON.parse(tc.arguments); } catch { args = { raw: tc.arguments }; }
          res.write(`data: ${JSON.stringify({ tool_call: { name: tc.name, args, status: "executing" } })}\n\n`);

          let result;
          try {
            const handler = toolHandlers[tc.name];
            result = handler ? await handler(args) : { text: `未知工具: ${tc.name}`, error: true };
          } catch (err) {
            result = { text: `工具執行錯誤: ${err.message}`, error: true };
          }

          res.write(`data: ${JSON.stringify({ tool_result: { name: tc.name, result } })}\n\n`);
          // Invalidate cache if app was created/edited so tools refresh
          if (tc.name === "app_create" || tc.name === "app_edit") invalidateCache();
          apiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          });
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      console.error("[tAgent] Chat error:", err.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.write(`data: ${JSON.stringify({ error: true, message: err.message })}\n\n`);
        res.end();
      }
    }
    return true;
  }

  return false;
}

  // Main handler catch-all
  if (!res.headersSent) {
    res.writeHead(404);
    res.end("Not found");
  }

});

server.listen(PORT, () => {
  console.log(`[tAgent] Listening on http://127.0.0.1:${PORT}`);
});

// ── WebSocket server for PTY (Qwen CLI) ──
const WS_PORT = parseInt(process.env.TAGENT_WS_PORT || "4098", 10);
const wss = new WebSocketServer({ port: WS_PORT, host: "0.0.0.0" });
const ptySessions = new Map(); // ws -> { pty, id }

// ── Multi-CLI spawn system ──
// Supports: qwen, claude, opencode
// Each CLI has its own binary name, flags, and platform resolution

const CLI_CONFIGS = {
  qwen: {
    name: "Qwen Code",
    bins: { darwin: "/opt/homebrew/bin/qwen", linux: "qwen", win32: "qwen.cmd" },
    envBin: "QWEN_BIN",
    buildArgs: (opts) => {
      const args = [];
      if (opts.model) args.push("-m", opts.model);
      if (opts.approvalMode === "yolo") args.push("-y");
      else if (opts.approvalMode) args.push("--approval-mode", opts.approvalMode);
      return args;
    },
  },
  claude: {
    name: "Claude Code",
    bins: { darwin: "claude", linux: "claude", win32: "claude.cmd" },
    envBin: "CLAUDE_BIN",
    buildArgs: (opts) => {
      const args = [];
      if (opts.model) args.push("--model", opts.model);
      // Claude Code permission modes
      if (opts.approvalMode === "yolo") args.push("--dangerously-skip-permissions", "--allow-dangerously-skip-permissions");
      else if (opts.approvalMode === "auto-edit") args.push("--permission-mode", "acceptEdits");
      else if (opts.approvalMode === "plan") args.push("--permission-mode", "plan");
      else if (opts.approvalMode) args.push("--permission-mode", opts.approvalMode);
      return args;
    },
  },
  opencode: {
    name: "OpenCode",
    bins: { darwin: "opencode", linux: "opencode", win32: "opencode.cmd" },
    envBin: "OPENCODE_BIN",
    buildArgs: (opts) => {
      const args = [];
      if (opts.model && opts.model.includes("/")) {
        args.push("-m", opts.model);
      }
      // Fixed port for health check + future SDK API use
      if (opts.serverPort) {
        args.push("--port", String(opts.serverPort));
      }
      return args;
    },
  },
};

function spawnCli(ptySpawn, opts) {
  const cliType = opts.cli || "qwen";
  const config = CLI_CONFIGS[cliType];
  if (!config) throw new Error(`Unknown CLI: ${cliType}`);

  const platform = process.platform;
  const binKey = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";
  let bin = process.env[config.envBin] || config.bins[binKey];
  const args = config.buildArgs(opts);
  const resolvedCwd = opts.cwd || process.env.QWEN_CWD || TAGENT_ROOT;

  const ptyOpts = {
    name: "xterm-256color", cols: 120, rows: 30,
    cwd: resolvedCwd,
    env: { ...process.env },
  };

  // Windows: .cmd files need to be spawned via cmd.exe
  if (platform === "win32" && bin.endsWith(".cmd")) {
    const cmdBin = process.env.COMSPEC || "cmd.exe";
    const cmdArgs = ["/c", bin, ...args];
    console.log(`[PTY] Spawning ${config.name}: ${cmdBin} ${cmdArgs.join(" ")} (cwd: ${resolvedCwd})`);
    try {
      return ptySpawn(cmdBin, cmdArgs, ptyOpts);
    } catch (e) {
      // Fallback: try without cmd.exe wrapper
      console.log(`[PTY] cmd.exe spawn failed, trying direct: ${bin} ${args.join(" ")}`);
      return ptySpawn(bin, args, ptyOpts);
    }
  }

  return ptySpawn(bin, args, ptyOpts);
}

// ── Check which CLIs are installed ──
async function checkInstalledClis() {
  const results = {};
  for (const [key, config] of Object.entries(CLI_CONFIGS)) {
    const platform = process.platform;
    const binKey = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";
    const bin = process.env[config.envBin] || config.bins[binKey];
    const { stat } = await import("fs/promises");
    try {
      // For PATH-based binaries, check if they resolve
      const { execFile } = await import("child_process");
      await new Promise((res, rej) => {
        const cmd = platform === "win32" ? "where" : "which";
        execFile(cmd, [bin], (err) => err ? rej(err) : res(true));
      });
      results[key] = { installed: true, bin, name: config.name };
    } catch {
      results[key] = { installed: false, bin, name: config.name };
    }
  }
  return results;
}

// ── WebSocket connection handler ──

wss.on("connection", (ws, req) => {
  const sessionId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`[PTY] New session: ${sessionId}`);

  let spawned = false;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      const session = ptySessions.get(ws);
      if (session?.pty) session.pty.write(raw.toString());
      return;
    }

    if (msg.type === "spawn") {
      if (spawned) {
        console.log(`[PTY] Ignoring duplicate spawn for ${sessionId}`);
        return;
      }
      spawned = true;
      const old = ptySessions.get(ws);
      if (old?.pty) { old.pty.kill(); }

      const opts = msg.options || {};
      if (opts.cli === "opencode") {
        opts.serverPort = 4199 + Math.floor(Math.random() * 100);
      }

      try {
        const pty = spawnCli(ptySpawn, opts);
        const cliType = opts.cli || "qwen";
        ptySessions.set(ws, { pty, id: sessionId, cliType, serverPort: opts.serverPort });

        // ── Detect when CLI is truly ready (not just PTY spawned) ──
        let cliReadyFired = false;
        const ptyStartTime = Date.now();
        const cliReadyPatterns = {
          qwen: /(?:YOLO mode|Plan mode|Auto-edit mode|Default mode|Type your message)/,
          claude: /(?:\?>|^>?\s*$)/m,
          opencode: /(?:Welcome to OpenCode|opencode.*ready)/i,
        };
        // Strip ANSI codes for pattern matching
        const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "");

        pty.onData((data) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "data", data }));
          }
          // Detect CLI ready from output
          if (!cliReadyFired) {
            const plain = stripAnsi(data);
            const pattern = cliReadyPatterns[cliType];
            if (pattern && pattern.test(plain)) {
              cliReadyFired = true;
              console.log(`[PTY] CLI ready detected: ${cliType} (${sessionId})`);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "cliReady" }));
              }
            }
          }
        });

        pty.onExit(({ exitCode }) => {
          console.log(`[PTY] Exited: ${sessionId} (code: ${exitCode})`);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "exit", exitCode }));
          }
          ptySessions.delete(ws);
        });

        ws.send(JSON.stringify({ type: "ready", sessionId, platform: process.platform }));
      } catch (err) {
        console.error(`[PTY] Spawn failed:`, err.message);
        ws.send(JSON.stringify({ type: "error", message: `Failed to start CLI: ${err.message}` }));
      }
    }
    else if (msg.type === "input") {
      const session = ptySessions.get(ws);
      if (session?.pty) {
        session.pty.write(msg.text || "");
      }
    }
    else if (msg.type === "multiline") {
      // Legacy: Windows multi-line fallback (no longer sent by frontend)
      const session = ptySessions.get(ws);
      if (!session?.pty) return;
      try {
        session.pty.write((msg.text || "").replace(/\n/g, "\r\n") + "\r");
      } catch {}
    }
    else if (msg.type === "resize") {
      const session = ptySessions.get(ws);
      if (session?.pty && msg.cols && msg.rows) {
        session.pty.resize(msg.cols, msg.rows);
      }
    }
    else if (msg.type === "kill") {
      const session = ptySessions.get(ws);
      if (session?.pty) {
        session.pty.kill();
        ptySessions.delete(ws);
      }
    }
  });

  ws.on("close", () => {
    const session = ptySessions.get(ws);
    if (session?.pty) {
      console.log(`[PTY] Connection closed, killing: ${session.id}`);
      session.pty.kill();
      ptySessions.delete(ws);
    }
  });

  ws.on("error", (err) => {
    console.error(`[PTY] WebSocket error:`, err.message);
  });
});

console.log(`[PTY-WS] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);

// ── Cron Job Scheduler ──
const CRON_JOBS_FILE = resolve(TAGENT_ROOT, "factories/default/cron-jobs.json");
const CRON_LOGS_DIR = resolve(TAGENT_ROOT, "logs/cron");
const CRON_RESULTS_DIR = resolve(TAGENT_ROOT, "logs/cron-results");

// Simple cron expression parser: "min hour day month dow"
function matchesCron(expr, date) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mMin, mHour, mDay, mMon, mDow] = parts;
  const check = (val, spec) => {
    if (spec === "*") return true;
    for (const s of spec.split(",")) {
      if (s.includes("-")) {
        const [lo, hi] = s.split("-").map(Number);
        if (val >= lo && val <= hi) return true;
      } else if (parseInt(s) === val) return true;
    }
    return false;
  };
  return check(date.getMinutes(), mMin) && check(date.getHours(), mHour) && check(date.getDate(), mDay) && check(date.getMonth() + 1, mMon) && check(date.getDay(), mDow);
}

async function loadCronJobs() {
  try {
    const raw = await readFile(CRON_JOBS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch { return []; }
}

async function saveCronJobs(jobs) {
  await mkdir(dirname(CRON_JOBS_FILE), { recursive: true });
  await writeFile(CRON_JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
}

async function appendCronLog(jobId, entry) {
  await mkdir(join(CRON_LOGS_DIR, jobId), { recursive: true });
  const logFile = join(CRON_LOGS_DIR, jobId, "history.jsonl");
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n";
  await writeFile(logFile, line, { flag: "a" });
}

async function runCronJob(job) {
  const runTs = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runId = `${job.id}-${runTs}`;
  console.log(`[cron] Running job: ${job.name} (${job.id}) run=${runId}`);

  await appendCronLog(job.id, { runId, status: "started" });

  // ── Reminder type: inject message into chat ──
  if (job.type === "reminder") {
    try {
      const files = await readdir(TAGENT_CHAT_DIR);
      const chatFiles = files.filter(f => f.endsWith(".json")).sort().reverse();
      if (chatFiles.length > 0) {
        const chatPath = resolve(TAGENT_CHAT_DIR, chatFiles[0]);
        const chat = JSON.parse(await readFile(chatPath, "utf-8"));
        chat.messages.push({
          role: "assistant",
          content: `⏰ **提醒**：${job.reminderText || job.name}`,
          timestamp: new Date().toISOString(),
        });
        chat.updatedAt = new Date().toISOString();
        await writeFile(chatPath, JSON.stringify(chat, null, 2), "utf-8");
      }
      await appendCronLog(job.id, { runId, status: "done", reminderDelivered: true });
      const jobs = await loadCronJobs();
      const idx = jobs.findIndex(j => j.id === job.id);
      if (idx >= 0) {
        jobs[idx].lastRun = new Date().toISOString();
        jobs[idx].lastStatus = "done";
        await saveCronJobs(jobs);
      }
      console.log(`[cron] Reminder ${job.id} delivered`);
    } catch (err) {
      await appendCronLog(job.id, { runId, status: "error", error: err.message });
      const jobs = await loadCronJobs();
      const idx = jobs.findIndex(j => j.id === job.id);
      if (idx >= 0) {
        jobs[idx].lastRun = new Date().toISOString();
        jobs[idx].lastStatus = "error";
        await saveCronJobs(jobs);
      }
    }
    return;
  }

  // ── Report type: run CLI ──
  try {
    const { spawn } = await import("child_process");
    // Build prompt with params
    let prompt = job.prompt || `Execute report app ${job.reportAppId}`;
    if (job.params && Object.keys(job.params).length > 0) {
      prompt += `\n\nParameters:\n${Object.entries(job.params).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
    }

    const appDir = resolve(TAGENT_ROOT, "skills/physical-skill", job.reportAppId);
    const child = spawn("qwen", ["--approval-mode", "yolo", "-o", "text", "--max-tool-calls", "20", prompt], {
      cwd: appDir,
      env: { ...process.env, HOME: process.env.HOME, QWEN_CODE_SUPPRESS_YOLO_WARNING: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", c => { output += c.toString(); });
    child.stderr.on("data", c => { output += c.toString(); });

    await new Promise((resolve, reject) => {
      child.on("close", resolve);
      child.on("error", reject);
    });

    // Save result snapshot
    const resultDir = join(CRON_RESULTS_DIR, job.id);
    await mkdir(resultDir, { recursive: true });

    // Extract HTML from output if present
    let htmlContent = output;
    const codeBlockMatch = htmlContent.match(/```(?:html)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) htmlContent = codeBlockMatch[1].trim();
    let htmlMatch = htmlContent.match(/<!DOCTYPE\s+html[^>]*>[\s\S]*<\/html>/i);
    if (htmlMatch) htmlContent = htmlMatch[0];
    else {
      htmlMatch = htmlContent.match(/<html[\s\S]*<\/html>/i);
      if (htmlMatch) htmlContent = htmlMatch[0];
    }

    const hasHtml = htmlContent.includes("<html");
    if (hasHtml) {
      await writeFile(join(resultDir, `${runTs}.html`), htmlContent, "utf-8");
    }

    // Also save raw text output
    await writeFile(join(resultDir, `${runTs}.txt`), output, "utf-8");

    await appendCronLog(job.id, { runId, status: "done", outputLength: output.length, hasHtml, resultFile: `${runTs}.${hasHtml ? "html" : "txt"}` });

    // Update job's lastRun
    const jobs = await loadCronJobs();
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      jobs[idx].lastRun = new Date().toISOString();
      jobs[idx].lastStatus = "done";
      await saveCronJobs(jobs);
    }
    console.log(`[cron] Job ${job.id} done, hasHtml=${hasHtml}`);
  } catch (err) {
    await appendCronLog(job.id, { runId, status: "error", error: err.message });
    const jobs = await loadCronJobs();
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      jobs[idx].lastRun = new Date().toISOString();
      jobs[idx].lastStatus = "error";
      await saveCronJobs(jobs);
    }
    console.log(`[cron] Job ${job.id} error:`, err.message);
  }
}

// Check every 60s
const lastCronMin = { min: -1 };
setInterval(async () => {
  const now = new Date();
  if (now.getMinutes() === lastCronMin.min) return; // already checked this minute
  lastCronMin.min = now.getMinutes();

  try {
    const jobs = await loadCronJobs();
    for (const job of jobs) {
      if (!job.enabled) continue;
      if (matchesCron(job.schedule, now)) {
        runCronJob(job).catch(() => {}); // fire and forget
      }
    }
  } catch {}
}, 30_000);

console.log("[cron] Scheduler started, checking every 60s");

// Cron API endpoints (registered inside server handler)
const cronApiHandler = async (req, res) => {
  // GET /api/cron-jobs
  if (req.method === "GET" && req.url?.match(/^\/api\/cron-jobs(?:\?.*)?$/)) {
    const jobs = await loadCronJobs();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jobs));
    return true;
  }
  // POST /api/cron-jobs
  if (req.method === "POST" && req.url === "/api/cron-jobs") {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const jobs = await loadCronJobs();
    const job = {
      id: parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `cron-${Date.now()}`,
      name: parsed.name,
      type: parsed.type || "report", // "report" or "reminder"
      reminderText: parsed.reminderText || "",
      reportAppId: parsed.reportAppId || "",
      schedule: parsed.schedule || "0 * * * *",
      prompt: parsed.prompt || "",
      params: parsed.params || {},
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      lastStatus: null,
    };
    jobs.push(job);
    await saveCronJobs(jobs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(job));
    return true;
  }
  // PATCH /api/cron-jobs/:id
  if (req.method === "PATCH" && req.url?.match(/^\/api\/cron-jobs\/[^/]+$/)) {
    const id = req.url.split("/").pop();
    const body = await readBody(req);
    let patch;
    try { patch = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const jobs = await loadCronJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx < 0) { res.writeHead(404); res.end("Not found"); return true; }
    if (patch.enabled !== undefined) jobs[idx].enabled = patch.enabled;
    if (patch.schedule) jobs[idx].schedule = patch.schedule;
    if (patch.prompt) jobs[idx].prompt = patch.prompt;
    if (patch.name) jobs[idx].name = patch.name;
    if (patch.params) jobs[idx].params = patch.params;
    if (patch.reportAppId) jobs[idx].reportAppId = patch.reportAppId;
    await saveCronJobs(jobs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jobs[idx]));
    return true;
  }
  // DELETE /api/cron-jobs/:id
  if (req.method === "DELETE" && req.url?.match(/^\/api\/cron-jobs\/[^/]+$/)) {
    const id = req.url.split("/").pop();
    let jobs = await loadCronJobs();
    jobs = jobs.filter(j => j.id !== id);
    await saveCronJobs(jobs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }
  // GET /api/cron-jobs/:id/logs
  if (req.method === "GET" && req.url?.match(/^\/api\/cron-jobs\/[^/]+\/logs$/)) {
    const parts = req.url.split("/");
    const id = parts[parts.length - 2];
    const logFile = join(CRON_LOGS_DIR, id, "history.jsonl");
    try {
      const raw = await readFile(logFile, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(lines.slice(-50)));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return true;
  }
  // GET /api/cron-jobs/:id/results — list result files
  if (req.method === "GET" && req.url?.match(/^\/api\/cron-jobs\/[^/]+\/results$/)) {
    const parts = req.url.split("/");
    const id = parts[parts.length - 2];
    const resultDir = join(CRON_RESULTS_DIR, id);
    try {
      const files = await readdir(resultDir);
      const results = [];
      for (const f of files.sort().reverse()) {
        if (f.endsWith(".html") || f.endsWith(".txt")) {
          results.push({ file: f, name: f.replace(/\.(html|txt)$/, ""), type: f.endsWith(".html") ? "html" : "text" });
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results.slice(0, 50)));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return true;
  }
  // GET /api/cron-result?path=... — serve a specific result file
  if (req.method === "GET" && req.url?.match(/^\/api\/cron-result\?/)) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const filePath = urlObj.searchParams.get("path");
    if (!filePath || !filePath.includes("/cron-results/")) {
      res.writeHead(403); res.end("Forbidden"); return true;
    }
    try {
      const content = await readFile(filePath, "utf-8");
      const isHtml = filePath.endsWith(".html");
      res.writeHead(200, { "Content-Type": isHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
      res.end(content);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return true;
  }
  // POST /api/cron-jobs/:id/run — manual trigger
  if (req.method === "POST" && req.url?.match(/^\/api\/cron-jobs\/[^/]+\/run$/)) {
    const parts = req.url.split("/");
    const id = parts[parts.length - 2];
    const jobs = await loadCronJobs();
    const job = jobs.find(j => j.id === id);
    if (!job) { res.writeHead(404); res.end("Not found"); return true; }
    runCronJob(job).catch(() => {});
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Job triggered" }));
    return true;
  }
  return false;
};

// Log installed CLIs on startup
checkInstalledClis().then(clis => {
  for (const [key, info] of Object.entries(clis)) {
    console.log(`[CLI] ${info.name}: ${info.installed ? `✅ ${info.bin}` : "❌ not found"}`);
  }
}).catch(() => {});
