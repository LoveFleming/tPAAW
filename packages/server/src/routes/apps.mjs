/**
 * Apps CRUD + App Data + App Run + Reports
 * Routes: /api/apps, /api/app-data/*, /api/app-run/*, /api/app/*,
 *         /api/report-train, /api/report-preview, /api/report-publish,
 *         /api/report-templates
 */

import { readdir, readFile, writeFile, mkdir, unlink, rm, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";
import {
  PAAW_ROOT, APPS_ROOT, INPUT_PROMPT_ROOT, PHYSICAL_SKILL_ROOT,
  readBody, extractHtml,
} from "./shared.mjs";
import { parseSkillFrontmatter } from "./skills-api.mjs";
import { runAgentLoop, runAgentLoopStream } from "../lib/paaw-agent-loop.mjs";
import { safeResolve } from "../lib/coding-security";

export default async function appsRoute(req, res) {
  // ── GET /api/apps — list apps ──
  if (req.method === "GET" && req.url?.match(/^\/api\/apps(?:\?.*)?$/)) {
    try {
      await mkdir(APPS_ROOT, { recursive: true });
      const dirs = await readdir(APPS_ROOT);
      const apps = [];
      for (const dir of dirs) {
        try {
          const s = await stat(safeResolve(APPS_ROOT, dir));
          if (!s.isDirectory()) continue;
          const entries = await readdir(safeResolve(APPS_ROOT, dir));
          const hasHtml = entries.includes("app.html");
          let meta = {};
          try { meta = JSON.parse(await readFile(safeResolve(APPS_ROOT, dir, "app.json"), "utf-8")); } catch {}
          apps.push({
            id: dir, name: meta.name || dir, description: meta.description || "",
            icon: meta.icon || "", template: meta.template || "", skillId: meta.skillId || "",
            hasApp: hasHtml, generatedAt: meta.generatedAt || "", status: meta.status || "published",
            dataShape: meta.dataShape || "array", schema: meta.schema || {}, aiPrompt: meta.aiPrompt || "",
            type: meta.type || "data", cli: meta.cli || "qwen", triggers: meta.triggers || [], skills: meta.skills || [],
          });
        } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(apps));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── POST /api/apps — create new app ──
  if (req.method === "POST" && req.url === "/api/apps") {
    const rawBody = await readBody(req);
    let params;
    try { params = JSON.parse(rawBody); } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return true; }
    if (!params.id || !/^[a-z][a-z0-9_]*$/.test(params.id)) {
      res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "App ID must be lowercase alphanumeric starting with a letter" })); return true;
    }  // nosemgrep: path-join-resolve-traversal
    const appDir = safeResolve(APPS_ROOT, params.id);
// nosemgrep: path-join-resolve-traversal
    const dataDir = resolve(PAAW_ROOT, "data/app-data");
    try {
      await mkdir(appDir, { recursive: true });
      const appMeta = {
        id: params.id, name: params.name || params.id, icon: params.icon || "📦",
        description: params.description || "", type: params.type || "data",
        dataShape: params.dataShape || "array", schema: params.schema || {},
        execSchema: params.execSchema || null, triggers: params.triggers || [],
        aiPrompt: params.aiPrompt || "", status: "published", createdAt: new Date().toISOString(),  // nosemgrep: path-join-resolve-traversal
      };
// nosemgrep: path-join-resolve-traversal
      await writeFile(join(appDir, "app.json"), JSON.stringify(appMeta, null, 2), "utf-8");  // nosemgrep: path-join-resolve-traversal
      await mkdir(dataDir, { recursive: true });
      const initialData = appMeta.dataShape === "object" ? {} : [];
      await writeFile(safeResolve(dataDir, `${params.id}.json`), JSON.stringify(initialData, null, 2), "utf-8");
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, app: appMeta }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── PATCH /api/apps/:id — update metadata ──
  const appPatchMatch = req.method === "PATCH" && req.url?.match(/^\/api\/apps\/([\w.-]+)$/);
  if (appPatchMatch) {
    const appId = appPatchMatch[1];
    const patchBody = await readBody(req);
    let changes;  // nosemgrep: path-join-resolve-traversal
    try { changes = JSON.parse(patchBody); } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return true; }
    try {
      const jsonPath = safeResolve(APPS_ROOT, appId, "app.json");
      let current = {};
      try { current = JSON.parse(await readFile(jsonPath, "utf-8")); } catch {}
      for (const [key, val] of Object.entries(changes)) {
        if (val !== undefined) current[key] = val;
      }
      current.updatedAt = new Date().toISOString();
      await writeFile(jsonPath, JSON.stringify(current, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, app: current }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── App Data CRUD ──

  // GET /api/app-data/:appId
  {
    const m = req.method === "GET" && req.url?.match(/^\/api\/app-data\/([\w.-]+)(?:\?.*)?$/);
    if (m) {
      const appId = m[1];
// nosemgrep: path-join-resolve-traversal
      const dataDir = resolve(PAAW_ROOT, "data/app-data");
      await mkdir(dataDir, { recursive: true });
      try {
        const data = await readFile(safeResolve(dataDir, `${appId}.json`), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("[]");
      }
      return true;
    }
  }

  // PUT /api/app-data/:appId
  {
    const m = req.method === "PUT" && req.url?.match(/^\/api\/app-data\/([\w.-]+)(?:\?.*)?$/);
    if (m) {  // nosemgrep: path-join-resolve-traversal
      const appId = m[1];
// nosemgrep: path-join-resolve-traversal
      const dataDir = resolve(PAAW_ROOT, "data/app-data");
      await mkdir(dataDir, { recursive: true });
      const filePath = safeResolve(dataDir, `${appId}.json`);
      try {
        const raw = await readBody(req);
        JSON.parse(raw);
        await writeFile(filePath, raw, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // POST /api/app-data/:appId
  {
    const m = req.method === "POST" && req.url?.match(/^\/api\/app-data\/([\w.-]+)(?:\?.*)?$/);  // nosemgrep: path-join-resolve-traversal
    if (m) {
      const appId = m[1];
// nosemgrep: path-join-resolve-traversal
      const dataDir = resolve(PAAW_ROOT, "data/app-data");
      await mkdir(dataDir, { recursive: true });
      const filePath = safeResolve(dataDir, `${appId}.json`);
      try {
        let items = [];
        try { items = JSON.parse(await readFile(filePath, "utf-8")); } catch {}
        const newItem = JSON.parse(await readBody(req));
        for (const key of Object.keys(newItem)) {
          if (newItem[key] === "N/A" || newItem[key] === "n/a" || newItem[key] === "") delete newItem[key];
        }
        if (!newItem.id) newItem.id = `${appId}_${Date.now().toString(36)}`;
        if (!newItem.createdAt) newItem.createdAt = new Date().toISOString();
        items.push(newItem);
        await writeFile(filePath, JSON.stringify(items, null, 2), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(newItem));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // DELETE /api/app-data/:appId/:itemId
  {  // nosemgrep: path-join-resolve-traversal
    const m = req.method === "DELETE" && req.url?.match(/^\/api\/app-data\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
    if (m) {
      const [, appId, itemId] = m;
// nosemgrep: path-join-resolve-traversal
      const dataDir = resolve(PAAW_ROOT, "data/app-data");
      await mkdir(dataDir, { recursive: true });
      const filePath = safeResolve(dataDir, `${appId}.json`);
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
      return true;
    }
  }

  // PATCH /api/app-data/:appId/:itemId  // nosemgrep: path-join-resolve-traversal
  {
    const m = req.method === "PATCH" && req.url?.match(/^\/api\/app-data\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
    if (m) {
      const [, appId, itemId] = m;
// nosemgrep: path-join-resolve-traversal
      const dataDir = resolve(PAAW_ROOT, "data/app-data");
      await mkdir(dataDir, { recursive: true });
      const filePath = safeResolve(dataDir, `${appId}.json`);
      try {
        let items = [];
        try { items = JSON.parse(await readFile(filePath, "utf-8")); } catch {}
        const idx = items.findIndex(i => i.id === itemId);
        if (idx < 0) { res.writeHead(404); res.end("Item not found"); return true; }
        const patch = JSON.parse(await readBody(req));
        for (const key of Object.keys(patch)) {
          if (patch[key] === "N/A" || patch[key] === "n/a" || patch[key] === "") delete patch[key];
        }
        items[idx] = { ...items[idx], ...patch, id: itemId };
        await writeFile(filePath, JSON.stringify(items, null, 2), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(items[idx]));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }  // nosemgrep: path-join-resolve-traversal
  }

  // ── POST /api/apps/:appId/exec — generic skill execution ──
  {
    const m = req.method === "POST" && req.url?.match(/^\/api\/apps\/([\w.-]+)\/exec(?:\?.*)?$/);
    if (m) {
      const appId = m[1];
      const appDir = safeResolve(APPS_ROOT, appId);  // nosemgrep: path-join-resolve-traversal
      const result = { appId, output: "", error: null, exitCode: null };
      try {  // nosemgrep: path-join-resolve-traversal
        const raw = await readBody(req);
        let args = {};
        try { args = JSON.parse(raw); } catch {}
        const wantStream = req.headers.accept === "application/x-ndjson";
        let appMeta = {};
// nosemgrep: path-join-resolve-traversal
        try { appMeta = JSON.parse(await readFile(join(appDir, "app.json"), "utf-8")); } catch {}

// nosemgrep: path-join-resolve-traversal
        const skillsDir = join(appDir, "skills");
        const skillContents = [];
        try {
          const skillDirs = await readdir(skillsDir);
          for (const sd of skillDirs) {
            try {
              const content = await readFile(safeResolve(skillsDir, sd, "SKILL.md"), "utf-8");
              const sBody = content.replace(/^---[\s\S]*?---\n*/, "").replace(/\{\{PAAW_ROOT\}\}/g, PAAW_ROOT);
              skillContents.push({ name: sd, body: sBody });
            } catch {}
          }
        } catch {}

        if (skillContents.length === 0) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `No skills found for app: ${appId}` }));
          return true;
        }

        const skillsSection = skillContents.map(s => `## === Skill: ${s.name} ===\n${s.body}`).join("\n\n");
        const inputSection = Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join("\n");

        // Build context via contextEngine (includes knowledge + workspace paths)
        let baseContext = "";
        try {
          const { contextEngine } = await import("../context-engine.mjs");
          const ctx = await contextEngine.build({ target: "app-exec", appName: appMeta.name || appId, skillsSection, inputSection });
          baseContext = ctx.systemPrompt || "";
        } catch {}
        const systemPrompt = baseContext || `你是「${appMeta.name || appId}」App 的執行引擎。你必須嚴格按照以下 Skill 定義（deterministic script）來處理。\n\n${skillsSection}\n\n## === 輸入參數 ===\n${inputSection}\n\n## === 輸出指示 ===\n只輸出結果。如果是結構化資料，輸出 JSON（不要加 markdown code block）。不要加解釋。`;

        if (wantStream) {
          res.writeHead(200, { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked", "X-Accel-Buffering": "no", "Cache-Control": "no-cache" });
          res.write(JSON.stringify({ type: "status", data: { message: `${appMeta.name || appId}: skill 執行中...` } }) + "\n");
          try {
            const agentResult = await runAgentLoop({
              prompt: systemPrompt, cwd: appDir, maxTurns: 15, timeout: 900, rootDir: PAAW_ROOT,
              onEvent: (evt) => {
                if (evt.type === "tool_end") { try { res.write(JSON.stringify({ type: "stdout", data: `🔧 ${evt.name}: ${evt.result || ""}\n` }) + "\n"); } catch {} }
              },
            });
            let parsedResult = null;
            const jsonMatch = agentResult.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) { try { parsedResult = JSON.parse(jsonMatch[0]); } catch {} }
            res.write(JSON.stringify({ type: "result", data: parsedResult || { output: agentResult.content } }) + "\n");
            res.write(JSON.stringify({ type: "done", data: { exitCode: agentResult.success ? 0 : 1 } }) + "\n");
            res.end();
          } catch (err) {
            res.write(JSON.stringify({ type: "error", message: err.message }) + "\n");
            res.end();
          }
          return true;
        }

        try {
          const agentResult = await runAgentLoop({ prompt: systemPrompt, cwd: appDir, maxTurns: 15, timeout: 900, rootDir: PAAW_ROOT });
          result.output = agentResult.content;
          result.exitCode = agentResult.success ? 0 : 1;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          result.error = err.message;
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
        return true;
      } catch (err) {
        result.error = err.message;
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return true;
      }
    }
  }

  // ── POST /api/app-run/:id — AI generate app content ──
  {
    const m = req.method === "POST" && req.url?.match(/^\/api\/app-run\/([\w.-]+)(?:\?.*)?$/);
    if (m) {
      const appId = m[1];
      const raw = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(raw); } catch {}
      const { prompt: userPrompt } = parsed;
      const outDir = safeResolve(APPS_ROOT, appId);
      await mkdir(outDir, { recursive: true });

      // Gather skill data for the prompt
      let skillData = [];
      try {
        const dirs = await readdir(INPUT_PROMPT_ROOT);
        for (const dir of dirs) {
          try {
            const raw = await readFile(safeResolve(INPUT_PROMPT_ROOT, dir, "SKILL.md"), "utf-8");
            const p = parseSkillFrontmatter(raw);
            skillData.push({ id: dir, kind: "input-prompt", name: p.name || dir, description: p.description || "", category: p.category || "" });
          } catch {}
        }
      } catch {}
      try {
        const dirs = await readdir(PHYSICAL_SKILL_ROOT);
        for (const dir of dirs) {
          try {
            const raw = await readFile(safeResolve(PHYSICAL_SKILL_ROOT, dir, "SKILL.md"), "utf-8");
            const p = parseSkillFrontmatter(raw);
            skillData.push({ id: dir, kind: "physical-skill", name: p.name || dir, description: p.description || "", category: p.category || "" });
          } catch {}
        }
      } catch {}

      let appData = [];
      try {
        const dirs = await readdir(APPS_ROOT);
        for (const dir of dirs) {
          try { const s = await stat(safeResolve(APPS_ROOT, dir)); if (!s.isDirectory()) continue; } catch { continue; }
          let meta = {};
          try { meta = JSON.parse(await readFile(safeResolve(APPS_ROOT, dir, "app.json"), "utf-8")); } catch {}
          appData.push({ id: dir, name: meta.name || dir, status: meta.status || "published" });
        }
      } catch {}

      const summary = {
        totalSkills: skillData.length,
        inputPromptSkills: skillData.filter(s => s.kind === 'input-prompt').length,
        physicalSkills: skillData.filter(s => s.kind === 'physical-skill').length,
        totalApps: appData.length,
        categories: (() => { const m = {}; skillData.forEach(s => { const c = s.category || 'Other'; m[c] = (m[c] || 0) + 1; }); return m; })(),
      };
// nosemgrep: path-join-resolve-traversal
      const dataFile = join(outDir, "_skill_data.json");
      await writeFile(dataFile, JSON.stringify({ skills: skillData, apps: appData }, null, 2), "utf-8");

      // Build context via contextEngine (includes knowledge + workspace paths + data-analyst rules)
      let baseSystem = "";
      try {
        const { contextEngine } = await import("../context-engine.mjs");
        const ctx = await contextEngine.build({ target: "app-exec" });
        baseSystem = ctx.systemPrompt || "";
      } catch {}

// nosemgrep: path-join-resolve-traversal
      const dynamicData = `## 摘要\n- Total Skills: ${summary.totalSkills}\n- Input-Prompt Skills: ${summary.inputPromptSkills}\n- Physical Skills: ${summary.physicalSkills}\n- Apps: ${summary.totalApps}\n- Categories: ${JSON.stringify(summary.categories)}\n\n先讀取 ${dataFile} 取得完整資料，再生成 HTML。\n使用 write_file 將完整 HTML 寫到 ${join(outDir, "app.html")}`;

      const systemPrompt = baseSystem
        ? baseSystem + "\n\n" + dynamicData + (userPrompt ? `\n\n額外指示: ${userPrompt}` : "")
        : `你是 PAAW 的數據分析師。請讀取 ${dataFile} 中的即時資料，生成一份完整的 Skill Counting Report (HTML 頁面)。\n\n${dynamicData}\n\n## 輸出要求\n- 生成完整的 HTML 頁面 (<!DOCTYPE html>...</html>)\n- 包含統計卡片：Total Skills, Input-Prompt Skills, Physical Skills, Apps\n- 包含圓餅圖 (skill kind 分佈) 和長條圖 (category 分佈)，使用 Chart.js\n- 包含完整 skill 清單表格，可搜尋、排序\n- 樣式：Stone 色系，圓角卡片，現代感 UI\n- 所有數字必須來自資料檔案，不可編造\n- 標題顯示「載入時間」為現在${userPrompt ? `\n\n額外指示: ${userPrompt}` : ""}`;

      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked", "X-Accel-Buffering": "no", "Cache-Control": "no-cache" });
      res.write(JSON.stringify({ type: "status", data: { message: `Agent Loop 正在計算 ${appId}...` } }) + "\n");

      try {
        const agentResult = await runAgentLoop({
          prompt: systemPrompt, cwd: outDir, maxTurns: 25, timeout: 900, rootDir: PAAW_ROOT,
          onEvent: (evt) => {
            if (evt.type === "tool_start") { try { res.write(JSON.stringify({ type: "stdout", data: `🔧 ${evt.name}...\n` }) + "\n"); } catch {} }
            if (evt.type === "tool_end") { try { res.write(JSON.stringify({ type: "stdout", data: `✅ ${evt.name}: ${(evt.result || "").slice(0, 200)}\n` }) + "\n"); } catch {} }
            if (evt.type === "assistant_thinking") { try { res.write(JSON.stringify({ type: "stdout", data: `💭 ${evt.content}\n` }) + "\n"); } catch {} }
          },
        });

        let htmlContent = null;
// nosemgrep: path-join-resolve-traversal
        try { htmlContent = await readFile(join(outDir, "app.html"), "utf-8"); } catch {}
        if (!htmlContent) htmlContent = extractHtml(agentResult.content);

        if (htmlContent && htmlContent.includes("<html")) {
// nosemgrep: path-join-resolve-traversal
          await writeFile(join(outDir, "app.html"), htmlContent, "utf-8");
          res.write(JSON.stringify({ type: "done", data: { appId, exitCode: 0 } }) + "\n");
        } else {
          res.write(JSON.stringify({ type: "error", data: { message: `Agent Loop 完成，但未產出有效 HTML (${agentResult.content.length} chars)`, rawOutput: agentResult.content.slice(-2000) } }) + "\n");
        }
        res.end();
      } catch (err) {
        try { res.write(JSON.stringify({ type: "error", data: { message: err.message } }) + "\n"); res.end(); } catch {}
      }
      return true;
    }
  }

  // ── GET/HEAD /api/app/:id — serve app.html ──
  {
    const m = (req.method === "GET" || req.method === "HEAD") && req.url?.match(/^\/api\/app\/([\w.-]+)(?:\?.*)?$/);
    if (m) {
      const appId = m[1];
      try {
        const html = await readFile(safeResolve(APPS_ROOT, appId, "app.html"), "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate" });
        res.end(req.method === "HEAD" ? "" : html);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "App not found: " + appId }));
      }
      return true;
    }
  }

  // ── DELETE /api/app/:id — unpublish ──
  {
    const m = req.method === "DELETE" && req.url?.match(/^\/api\/app\/([\w.-]+)(?:\?.*)?$/);
    if (m) {
      const appId = m[1];
      const appDir = safeResolve(APPS_ROOT, appId);
      try {
// nosemgrep: path-join-resolve-traversal
        await unlink(join(appDir, "app.html")).catch(() => {});
// nosemgrep: path-join-resolve-traversal
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
      return true;
    }
  }

  // ── DELETE /api/paaw/apps/:id — hard delete (remove entire directory) ──
  {
    const m = req.method === "DELETE" && req.url?.match(/^\/api\/paaw\/apps\/([\w.-]+)$/);
    if (m) {
      const appId = m[1];
      const appDir = safeResolve(APPS_ROOT, appId);
      try {
        if (!existsSync(appDir)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `App '${appId}' not found` }));
          return true;
        }
        await rm(appDir, { recursive: true, force: true });
        console.log(`[apps] Hard deleted app: ${appId}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, appId, deleted: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // ── App builder chat GET/PUT ──
  {
    const m = req.method === "GET" && req.url?.match(/^\/api\/paaw\/app-chat\/([\w.-]+)$/);
    if (m) {
      const appId = m[1];
      try {
        const chatPath = safeResolve(APPS_ROOT, appId, "builder-chat.json");
        const data = await readFile(chatPath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages: [] }));
      }
      return true;
    }
  }
  {
    const m = req.method === "PUT" && req.url?.match(/^\/api\/paaw\/app-chat\/([\w.-]+)$/);
    if (m) {
      const appId = m[1];
      try {
        const body = JSON.parse(await readBody(req));
        const appDir = safeResolve(APPS_ROOT, appId);
        await mkdir(appDir, { recursive: true });
// nosemgrep: path-join-resolve-traversal
        await writeFile(join(appDir, "builder-chat.json"), JSON.stringify({ messages: body.messages || [] }, null, 2), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // ── POST /api/app/:id/publish ──
  {
    const m = req.method === "POST" && req.url?.match(/^\/api\/app\/([\w.-]+)\/publish(?:\?.*)?$/);
    if (m) {
      const appId = m[1];
      const appDir = safeResolve(APPS_ROOT, appId);
      try {
// nosemgrep: path-join-resolve-traversal
        const jsonPath = join(appDir, "app.json");
        let meta = {};
        try { meta = JSON.parse(await readFile(jsonPath, "utf-8")); } catch {}
        let extra = {};
        try { extra = JSON.parse(await readBody(req)); } catch {}
        meta = { ...meta, ...extra, status: "published", publishedAt: new Date().toISOString() };
        await writeFile(jsonPath, JSON.stringify(meta, null, 2), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, appId, ...meta }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // ── GET /api/app/:id/status ──
  {
    const m = req.method === "GET" && req.url?.match(/^\/api\/app\/([\w.-]+)\/status(?:\?.*)?$/);
    if (m) {
      const appId = m[1];
      try {
        const filePath = safeResolve(APPS_ROOT, appId, "app.html");
        const s = await stat(filePath);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ exists: true, mtime: s.mtimeMs, size: s.size }));
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ exists: false, mtime: null, size: 0 }));
      }
      return true;
    }
  }

  // ── GET /api/report-templates ──
  if (req.method === "GET" && req.url?.match(/^\/api\/report-templates(?:\?.*)?$/)) {
    const templates = [
      { id: "dashboard", name: "Dashboard", icon: "📊", description: "KPI cards + charts，適合概覽" },
      { id: "table", name: "Table Report", icon: "📋", description: "純表格數據報表" },
      { id: "chart", name: "Chart Only", icon: "📈", description: "單一圖表" },
      { id: "mixed", name: "Mixed Report", icon: "🧩", description: "圖表 + 表格 + AI 分析" },
    ];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(templates));
    return true;
  }

  // ── POST /api/report-train ──
  if (req.method === "POST" && req.url === "/api/report-train") {
    let parsed;
    try { parsed = JSON.parse(await readBody(req)); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const { skillId, reportName, template, prompt, runId } = parsed;
    const reportId = (reportName || skillId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || skillId;
    const outDir = safeResolve(PHYSICAL_SKILL_ROOT, reportId);
    await mkdir(outDir, { recursive: true });
// nosemgrep: path-join-resolve-traversal
    const htmlOutFile = join(outDir, "app.html");

    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked", "X-Accel-Buffering": "no", "Cache-Control": "no-cache" });
    res.write(JSON.stringify({ type: "status", data: { message: `Training ${reportId} via Agent Loop...`, runId } }) + "\n");

    try {
      const fullPrompt = `${prompt}\n\n### 輸出指示\n請將完整的 HTML 頁面使用 write_file 寫到 ${htmlOutFile}\n檔案必須是完整的 <!DOCTYPE html>...<\/html> 頁面。`;
      const agentResult = await runAgentLoop({
        prompt: fullPrompt, cwd: outDir, maxTurns: 20, timeout: 900, rootDir: PAAW_ROOT,
        onEvent: (evt) => {
          if (evt.type === "tool_start") { try { res.write(JSON.stringify({ type: "stdout", data: `🔧 ${evt.name}...\n` }) + "\n"); } catch {} }
          if (evt.type === "tool_end") { try { res.write(JSON.stringify({ type: "stdout", data: `✅ ${evt.name}: ${(evt.result || "").slice(0, 200)}\n` }) + "\n"); } catch {} }
          if (evt.type === "assistant_thinking") { try { res.write(JSON.stringify({ type: "stdout", data: `💭 ${evt.content}\n` }) + "\n"); } catch {} }
        },
      });

      let htmlContent = null;
      try { htmlContent = await readFile(htmlOutFile, "utf-8"); } catch {}
      if (!htmlContent) htmlContent = extractHtml(agentResult.content);

      if (htmlContent && htmlContent.includes("<html")) {
        await writeFile(htmlOutFile, htmlContent, "utf-8");
        const reportMeta = { template, status: "trained", generatedFrom: skillId, generatedAt: new Date().toISOString(), reportName };
// nosemgrep: path-join-resolve-traversal
        await writeFile(join(outDir, "report.json"), JSON.stringify(reportMeta, null, 2), "utf-8");
        res.write(JSON.stringify({ type: "done", data: { reportId, htmlPath: htmlOutFile, exitCode: 0 } }) + "\n");
      } else {
        res.write(JSON.stringify({ type: "error", data: { message: `Agent Loop 完成，但未產出有效 HTML (${agentResult.content.length} chars)`, rawOutput: agentResult.content.slice(-2000) } }) + "\n");
      }
      res.end();
    } catch (err) {
      try { res.write(JSON.stringify({ type: "error", data: { message: err.message } }) + "\n"); res.end(); } catch {}
    }
    return true;
  }

  // ── GET /api/report-preview ──
  if (req.method === "GET" && req.url?.match(/^\/api\/report-preview\?/)) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const htmlPath = urlObj.searchParams.get("path");
    if (!htmlPath || !htmlPath.startsWith("/")) { res.writeHead(400); res.end("Missing path"); return true; }
    if (!htmlPath.includes("/paaw/") && !htmlPath.includes(PHYSICAL_SKILL_ROOT)) { res.writeHead(403); res.end("Forbidden"); return true; }
    try {
      const html = await readFile(htmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch { res.writeHead(404); res.end("Not found"); }
    return true;
  }

  // ── POST /api/report-publish ──
  if (req.method === "POST" && req.url === "/api/report-publish") {
    let parsed;
    try { parsed = JSON.parse(await readBody(req)); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const { htmlPath, skillId, reportName } = parsed;
    if (!htmlPath || !htmlPath.includes("/paaw/")) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid path" })); return true; }
    try {
      const html = await readFile(htmlPath, "utf-8");
      const reportDir = dirname(htmlPath);
// nosemgrep: path-join-resolve-traversal
      const reportJsonPath = join(reportDir, "report.json");
      let meta = {};
      try { meta = JSON.parse(await readFile(reportJsonPath, "utf-8")); } catch {}
      meta.status = "published";
      meta.publishedAt = new Date().toISOString();
      await writeFile(reportJsonPath, JSON.stringify(meta, null, 2), "utf-8");

      const reportId = (reportName || skillId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || skillId;
      const appDir = safeResolve(APPS_ROOT, reportId);
      await mkdir(appDir, { recursive: true });
// nosemgrep: path-join-resolve-traversal
      await writeFile(join(appDir, "app.html"), html, "utf-8");
      const appJson = {
        name: reportName || reportId, skillId, template: meta.template || "",
        generatedAt: meta.generatedAt || new Date().toISOString(), publishedAt: meta.publishedAt, status: "published",
      };
// nosemgrep: path-join-resolve-traversal
      await writeFile(join(appDir, "app.json"), JSON.stringify(appJson, null, 2), "utf-8");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: htmlPath, appId: reportId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}
