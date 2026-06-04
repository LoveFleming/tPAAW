/**
 * tClaw Server
 *
 * HTTP + WebSocket server for tClaw Personal AI Assistant.
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
import chokidar from "chokidar";
const execAsync = promisify(execCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DASHBOARD_ROOT = resolve(__dirname, "..");
const AIOC_ROOT = resolve(__dirname, "../../");
const CONVERSATIONS_ROOT = resolve(AIOC_ROOT, "core/conversations");
const FACTORIES_ROOT = resolve(AIOC_ROOT, "factories");
const SKILLS_ROOT = resolve(AIOC_ROOT, "skills");
const INPUT_PROMPT_ROOT = resolve(SKILLS_ROOT, "input-prompt");
const PHYSICAL_SKILL_ROOT = resolve(SKILLS_ROOT, "physical-skill");
const APPS_ROOT = resolve(AIOC_ROOT, "apps");
const DEFAULT_FACTORY = "default";

const PORT = parseInt(process.env.TCLAW_PORT || "4097", 10);

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

  // tClaw API
  const tclawHandled = await tclawApiHandler(req, res);
  if (tclawHandled) return;

  // Cron API
  const handled = await cronApiHandler(req, res);
  if (handled) return;

  // Helper: resolve factory-scoped directory
  function factoryDir(factoryId, subdir) {
    return resolve(FACTORIES_ROOT, factoryId, subdir);
  }

  // Helper: get factoryId from query param, fallback to default
  function getFactoryId(url) {
    const u = new URL(url, "http://localhost");
    return u.searchParams.get("factory") || DEFAULT_FACTORY;
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
            template: meta.template || "",
            skillId: meta.skillId || "",
            hasApp: hasHtml,
            generatedAt: meta.generatedAt || "",
            status: meta.status || "published",
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

    const systemPrompt = `你是 AIOC 的數據分析師。請讀取 ${dataFile} 中的即時資料，生成一份完整的 Skill Counting Report (HTML 頁面)。

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
    // Safety: only allow reading from AIOC paths
    if (!htmlPath.includes("/aioc/") && !htmlPath.includes(PHYSICAL_SKILL_ROOT)) {
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

    if (!htmlPath || !htmlPath.includes("/aioc/")) {
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

  // GET /api/factories — list all factories
  if (req.method === "GET" && req.url?.match(/^\/api\/factories(?:\?.*)?$/)) {
    try {
      await mkdir(FACTORIES_ROOT, { recursive: true });
      const dirs = await readdir(FACTORIES_ROOT);
      const factories = [];
      for (const dir of dirs) {
        try {
          const stat = await import("fs/promises").then(m => m.stat(join(FACTORIES_ROOT, dir)));
          if (!stat.isDirectory()) continue;
          const configPath = join(FACTORIES_ROOT, dir, "factory.json");
          const raw = await readFile(configPath, "utf-8");
          factories.push(JSON.parse(raw));
        } catch { /* skip invalid */ }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(factories));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/factories — create new factory
  if (req.method === "POST" && req.url === "/api/factories") {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    if (!parsed.id) { res.writeHead(400); res.end("Missing 'id'"); return; }
    if (!parsed.name) { res.writeHead(400); res.end("Missing 'name'"); return; }

    const factoryPath = join(FACTORIES_ROOT, parsed.id);
    try {
      await mkdir(factoryPath, { recursive: true });
      await mkdir(join(factoryPath, "crews", "pic"), { recursive: true });
      await mkdir(join(factoryPath, "docs"), { recursive: true });

      const factoryJson = {
        id: parsed.id,
        name: parsed.name,
        description: parsed.description || "",
        icon: parsed.icon || "🏭",
        version: "1.0.0",
        createdAt: new Date().toISOString(),
        settings: { defaultCli: parsed.defaultCli || "qwen" },
      };
      await writeFile(join(factoryPath, "factory.json"), JSON.stringify(factoryJson, null, 2), "utf-8");

      // Always clone from 'default' factory (copyFrom overrides if specified)
      const cloneSource = parsed.copyFrom || "default";
      const srcCrews = join(FACTORIES_ROOT, cloneSource, "crews");
      const srcDocs = join(FACTORIES_ROOT, cloneSource, "docs");
      try {
        const { cpSync } = await import("fs");
        try { cpSync(srcCrews, join(factoryPath, "crews"), { recursive: true }); } catch {}
        try { cpSync(srcDocs, join(factoryPath, "docs"), { recursive: true }); } catch {}
      } catch {
        // cpSync not available (Node < 16.7), skip copy
      }

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, factory: factoryJson }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/factories/:id — delete a factory
  const factoryDeleteMatch = req.method === "DELETE" && req.url?.match(/^\/api\/factories\/([\w.-]+)$/);
  if (factoryDeleteMatch) {
    const fId = factoryDeleteMatch[1];
    if (fId === "default") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Cannot delete the default factory" }));
      return;
    }
    try {
      const { rm } = await import("fs/promises");
      await rm(join(FACTORIES_ROOT, fId), { recursive: true, force: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
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

  // GET /api/skill-lab/training-files — list training skill files
  if (req.method === "GET" && req.url?.startsWith("/api/skill-lab/training-files")) {
    try {
      const skillsDir = join(AIOC_ROOT, "skills");
      const results = [];
      const scanDir = async (root, kind) => {
        await mkdir(root, { recursive: true });
        const dirs = await readdir(root);
        for (const dir of dirs) {
          try {
            const stat = await import("fs/promises").then(m => m.stat(join(root, dir)));
            if (!stat.isDirectory()) continue;
            const entries = await readdir(join(root, dir));
            for (const f of entries) {
              // Match *-training.md or *-training.skill.md or training*.md
              if (/training/i.test(f) && /\.md$/i.test(f)) {
                results.push({ name: `${kind}/${dir}/${f}`, path: join(root, dir, f) });
              }
            }
          } catch { /* skip */ }
        }
      };
      await scanDir(join(skillsDir, "input-prompt"), "input-prompt");
      await scanDir(join(skillsDir, "physical-skill"), "physical-skill");
      // Also scan skills/training/ directory
      try {
        const trainingDir = join(skillsDir, "training");
        const tStat = await import("fs/promises").then(m => m.stat(trainingDir));
        if (tStat.isDirectory()) {
          const tEntries = await readdir(trainingDir);
          for (const f of tEntries) {
            if (/.md$/i.test(f) && !f.startsWith("_")) {
              results.push({ name: "training/" + f, path: join(trainingDir, f) });
            }
          }
        }
      } catch { /* training dir optional */ }
      // Also check skills root
      try {
        const rootEntries = await readdir(skillsDir);
        for (const f of rootEntries) {
          if (/training/i.test(f) && /\.md$/i.test(f)) {
            results.push({ name: f, path: join(skillsDir, f) });
          }
        }
      } catch { /* skip */ }
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
      const skillsDir = join(AIOC_ROOT, "skills");
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

  // GET /api/aioc-root — return AIOC base path
  if (req.method === "GET" && req.url === "/api/aioc-root") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ aiocRoot: AIOC_ROOT }));
    return;
  }

  // GET /api/factory-root — return active factory root path
  const factoryRootMatch = req.method === "GET" && req.url?.match(/^\/api\/factory-root(?:\?(.*))?$/);
  if (factoryRootMatch) {
    const fId = getFactoryId(req.url);
    const fRoot = join(FACTORIES_ROOT, fId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ factoryRoot: fRoot, factoryId: fId }));
    return;
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
      res.end(JSON.stringify({ aiocRoot: AIOC_ROOT, models, currentModel }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ aiocRoot: AIOC_ROOT, models: [], currentModel: "", error: err.message }));
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
      const tree = await buildTree(absRoot, absRoot, 10);
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

  // GET /api/factory/:factoryId/crews-pic/:filename — serve crew photo from factory directory
  const crewPicMatch = req.method === "GET" && req.url?.match(/^\/api\/factory\/([\w.-]+)\/crews-pic\/(.+)$/);
  if (crewPicMatch) {
    const [, fId, picName] = crewPicMatch;
    const picPath = join(FACTORIES_ROOT, fId, "crews", "pic", picName);
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
    const factoryDir = join(FACTORIES_ROOT, fId, "docs");
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
    const factoryDirPath = join(FACTORIES_ROOT, fId, "docs");
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

  res.writeHead(404);
  res.end("Not found");
});

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
  for (const entry of sorted) {
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


// ── tClaw Personal Assistant APIs ──

const TCLAW_DATA_DIR = resolve(AIOC_ROOT, "data");
const TCLAW_USER_FILE = resolve(TCLAW_DATA_DIR, "user.json");
const TCLAW_CHAT_DIR = resolve(TCLAW_DATA_DIR, "chats");

await mkdir(TCLAW_DATA_DIR, { recursive: true });
await mkdir(TCLAW_CHAT_DIR, { recursive: true });

async function tclawApiHandler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // GET /api/tclaw/user — get user profile
  if (req.method === "GET" && path === "/api/tclaw/user") {
    try {
      const data = JSON.parse(await readFile(TCLAW_USER_FILE, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(null)); // not onboarded yet
    }
    return true;
  }

  // POST /api/tclaw/user — save user profile (onboarding)
  if (req.method === "POST" && path === "/api/tclaw/user") {
    const body = JSON.parse(await readBody(req));
    await writeFile(TCLAW_USER_FILE, JSON.stringify(body, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // POST /api/tclaw/avatar — upload assistant avatar
  if (req.method === "POST" && path === "/api/tclaw/avatar") {
    try {
      const body = JSON.parse(await readBody(req));
      const { data: base64Data, filename } = body;
      if (!base64Data) { res.writeHead(400); res.end(JSON.stringify({ error: "no data" })); return true; }
      const avatarDir = resolve(TCLAW_DATA_DIR, "avatars");
      await mkdir(avatarDir, { recursive: true });
      const ext = (filename || "").split(".").pop() || "png";
      const avatarName = `assistant.${ext}`;
      const avatarPath = resolve(avatarDir, avatarName);
      const buffer = Buffer.from(base64Data, "base64");
      await writeFile(avatarPath, buffer);
      // Update user profile with avatar path
      let userProfile;
      try { userProfile = JSON.parse(readFileSync(TCLAW_USER_FILE, "utf-8")); } catch { userProfile = {}; }
      userProfile.assistantAvatar = `/api/tclaw/avatar/assistant`;
      await writeFile(TCLAW_USER_FILE, JSON.stringify(userProfile, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: `/api/tclaw/avatar/assistant` }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/tclaw/avatar/assistant — serve assistant avatar
  if (req.method === "GET" && path === "/api/tclaw/avatar/assistant") {
    try {
      const avatarDir = resolve(TCLAW_DATA_DIR, "avatars");
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

  // GET /api/tclaw/chats — list all chat sessions
  if (req.method === "GET" && path === "/api/tclaw/chats") {
    try {
      const files = await readdir(TCLAW_CHAT_DIR);
      const chats = [];
      for (const f of files.filter(f => f.endsWith(".json")).sort().reverse()) {
        try {
          const raw = JSON.parse(await readFile(resolve(TCLAW_CHAT_DIR, f), "utf-8"));
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

  // GET /api/tclaw/chats/:id — get single chat
  if (req.method === "GET" && path.startsWith("/api/tclaw/chats/")) {
    const chatId = path.split("/").pop().replace(".json", "");
    try {
      const data = JSON.parse(await readFile(resolve(TCLAW_CHAT_DIR, `${chatId}.json`), "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return true;
  }

  // POST /api/tclaw/chats — create new chat
  if (req.method === "POST" && path === "/api/tclaw/chats") {
    const body = JSON.parse(await readBody(req));
    const chatId = body.id || `chat_${Date.now()}`;
    const chatData = { id: chatId, title: body.title || "新對話", messages: body.messages || [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeFile(resolve(TCLAW_CHAT_DIR, `${chatId}.json`), JSON.stringify(chatData, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(chatData));
    return true;
  }

  // PUT /api/tclaw/chats/:id — update chat (add messages, rename)
  if (req.method === "PUT" && path.startsWith("/api/tclaw/chats/")) {
    const chatId = path.split("/").pop().replace(".json", "");
    const filePath = resolve(TCLAW_CHAT_DIR, `${chatId}.json`);
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

  // DELETE /api/tclaw/chats/:id — delete chat
  if (req.method === "DELETE" && path.startsWith("/api/tclaw/chats/")) {
    const chatId = path.split("/").pop().replace(".json", "");
    try { await unlink(resolve(TCLAW_CHAT_DIR, `${chatId}.json`)); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Provider / Model APIs ──

  // GET /api/tclaw/providers — list providers + models (mask apiKey)
  if (req.method === "GET" && path === "/api/tclaw/providers") {
    try {
      const config = JSON.parse(await readFile(resolve(TCLAW_DATA_DIR, "providers.json"), "utf-8"));
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

  // PUT /api/tclaw/providers — update provider config
  if (req.method === "PUT" && path === "/api/tclaw/providers") {
    try {
      const filePath = resolve(TCLAW_DATA_DIR, "providers.json");
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
      console.error("[tClaw] Provider update error:", err);
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to update providers" }));
    }
    return true;
  }

  // ── Workspaces API ──
  const TCLAW_WORKSPACES_FILE = resolve(TCLAW_DATA_DIR, "workspaces.json");

  // GET /api/tclaw/workspaces
  if (req.method === "GET" && path === "/api/tclaw/workspaces") {
    try {
      const data = JSON.parse(await readFile(TCLAW_WORKSPACES_FILE, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ directories: [] }));
    }
    return true;
  }

  // POST /api/tclaw/workspaces — add directory
  if (req.method === "POST" && path === "/api/tclaw/workspaces") {
    try {
      let data;
      try { data = JSON.parse(await readFile(TCLAW_WORKSPACES_FILE, "utf-8")); } catch { data = { directories: [] }; }
      const body = JSON.parse(await readBody(req));
      const dir = body.directory;
      if (!dir) { res.writeHead(400); res.end(JSON.stringify({ error: "directory required" })); return true; }
      if (!data.directories.includes(dir)) {
        data.directories.push(dir);
        await writeFile(TCLAW_WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf-8");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to add workspace" }));
    }
    return true;
  }

  // DELETE /api/tclaw/workspaces?dir=... — remove directory
  if (req.method === "DELETE" && path === "/api/tclaw/workspaces") {
    try {
      const dir = url.searchParams.get("dir");
      let data;
      try { data = JSON.parse(await readFile(TCLAW_WORKSPACES_FILE, "utf-8")); } catch { data = { directories: [] }; }
      data.directories = data.directories.filter((d) => d !== dir);
      await writeFile(TCLAW_WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to remove workspace" }));
    }
    return true;
  }

  // ── Chat completion (SSE streaming) ──

  // POST /api/tclaw/chat — chat completion with streaming
  if (req.method === "POST" && path === "/api/tclaw/chat") {
    try {
      const body = JSON.parse(await readBody(req));
      const { messages, model: requestedModel, provider: requestedProvider } = body;

      // Load provider config
      const config = JSON.parse(await readFile(resolve(TCLAW_DATA_DIR, "providers.json"), "utf-8"));
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

      // Build system prompt
      const userProfile = (() => {
        try { return JSON.parse(readFileSync(TCLAW_USER_FILE, "utf-8")); } catch { return null; }
      })();

      // Load workspaces
      const workspaces = (() => {
        try {
          const ws = JSON.parse(readFileSync(resolve(TCLAW_DATA_DIR, "workspaces.json"), "utf-8"));
          return ws.directories || [];
        } catch { return []; }
      })();

      const workspaceInfo = workspaces.length > 0
        ? `\n\n使用者的 Workspace 目錄：\n${workspaces.map((d, i) => `- ${d}`).join("\n")}`
        : "";

      const assistantName = userProfile?.assistantName || "林語晴";
      const systemPrompt = `你是${assistantName}，一個友善、聰明的個人 AI 助理。

使用者資訊：
- 名字：${userProfile?.name || "未知"}
- 介紹：${userProfile?.intro || ""}
- 偏好風格：${userProfile?.style || "casual"}${workspaceInfo}

回覆規則：
- 用中文回覆
- 風格自然、友善
- 不要太囉唆，也不要太簡短
- 有自己的想法和意見
- 使用 Markdown 格式
- 當使用者問到檔案或程式相關的問題時，可以參考 Workspace 目錄`;

      const apiMessages = [
        { role: "system", content: systemPrompt },
        ...(messages || []).map((m) => ({ role: m.role, content: m.content }))
      ];

      // Set up SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Stream from provider API
      const apiResp = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.apiKey}`,
          ...(providerId === "openrouter" ? { "HTTP-Referer": "https://tclaw.ai", "X-Title": "tClaw" } : {}),
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: true,
          max_tokens: 4096,
        }),
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
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
              }
            } catch {}
          }
        }
      } catch (err) {
        console.error("[tClaw] Stream error:", err.message);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      console.error("[tClaw] Chat error:", err.message);
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

server.listen(PORT, () => {
  console.log(`[tClaw] Listening on http://127.0.0.1:${PORT}`);
});

// ── WebSocket server for PTY (Qwen CLI) ──
const WS_PORT = parseInt(process.env.TCLAW_WS_PORT || "4098", 10);
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
  const resolvedCwd = opts.cwd || process.env.QWEN_CWD || AIOC_ROOT;

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
const CRON_JOBS_FILE = resolve(AIOC_ROOT, "factories/default/cron-jobs.json");
const CRON_LOGS_DIR = resolve(AIOC_ROOT, "logs/cron");
const CRON_RESULTS_DIR = resolve(AIOC_ROOT, "logs/cron-results");

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

  try {
    const { spawn } = await import("child_process");
    // Build prompt with params
    let prompt = job.prompt || `Execute report app ${job.reportAppId}`;
    if (job.params && Object.keys(job.params).length > 0) {
      prompt += `\n\nParameters:\n${Object.entries(job.params).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
    }

    const appDir = resolve(AIOC_ROOT, "skills/physical-skill", job.reportAppId);
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
