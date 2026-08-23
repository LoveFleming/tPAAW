/**
 * PAAW Personal Assistant APIs
 * Routes: /api/paaw/* (user, avatar, providers, workspaces, knowledge,
 *          ui-state, app-rules, app-skills, app import/export, workflows,
 *          skills inputs, workflow-output-chat, file-write)
 */

import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import {
  PAAW_ROOT, PAAW_DATA_DIR, PAAW_USER_FILE, PAAW_CHAT_DIR,
  PAAW_WORKSPACES_FILE, PAAW_KNOWLEDGE_DIR, UI_STATE_FILE,
  APP_RULES_PATH, APPS_ROOT, WORKFLOWS_ROOT,
  readBody, yaml,
} from "./shared.mjs";

// Invalidate cache helper — re-export from apps module if needed
let _invalidateCacheFn = null;
async function invalidateCache() {
  if (!_invalidateCacheFn) {
    try {
      const m = await import("./apps.mjs");
      // apps module may export an invalidateCache function; if not, noop
      _invalidateCacheFn = m.invalidateCache || (() => {});
    } catch { _invalidateCacheFn = () => {}; }
  }
  _invalidateCacheFn();
}

// ── UI State helpers ──
async function loadUiState() {
  try {
    return JSON.parse(await readFile(UI_STATE_FILE, "utf-8"));
  } catch {
    return { recentProjects: [], projectPaths: {} };
  }
}

async function saveUiState(state) {
  await writeFile(UI_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export default async function assistantRoute(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // ── User profile ──

  // GET /api/paaw/user
  if (req.method === "GET" && path === "/api/paaw/user") {
    try {
      const data = JSON.parse(await readFile(PAAW_USER_FILE, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(null));
    }
    return true;
  }

  // POST /api/paaw/user
  if (req.method === "POST" && path === "/api/paaw/user") {
    const body = JSON.parse(await readBody(req));
    await writeFile(PAAW_USER_FILE, JSON.stringify(body, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Avatar ──

  // POST /api/paaw/avatar
  if (req.method === "POST" && path === "/api/paaw/avatar") {
    try {
      const body = JSON.parse(await readBody(req));
      const { data: base64Data, filename } = body;
      if (!base64Data) { res.writeHead(400); res.end(JSON.stringify({ error: "no data" })); return true; }
      const avatarDir = resolve(PAAW_DATA_DIR, "avatars");
      await mkdir(avatarDir, { recursive: true });
      const ext = (filename || "").split(".").pop() || "png";
      const avatarName = `assistant.${ext}`;
      const avatarPath = resolve(avatarDir, avatarName);
      const buffer = Buffer.from(base64Data, "base64");
      await writeFile(avatarPath, buffer);
      let userProfile;
      try { userProfile = JSON.parse(readFileSync(PAAW_USER_FILE, "utf-8")); } catch { userProfile = {}; }
      userProfile.assistantAvatar = `/api/paaw/avatar/assistant`;
      await writeFile(PAAW_USER_FILE, JSON.stringify(userProfile, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: `/api/paaw/avatar/assistant` }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/paaw/avatar/assistant
  if (req.method === "GET" && path === "/api/paaw/avatar/assistant") {
    try {
      const avatarDir = resolve(PAAW_DATA_DIR, "avatars");
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

  // ── App Builder Rules ──

  // GET /api/paaw/app-rules
  if (req.method === "GET" && path === "/api/paaw/app-rules") {
    try {
      const rules = await readFile(APP_RULES_PATH, "utf-8");
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      res.end(rules);
    } catch {
      res.writeHead(404);
      res.end("App builder rules not found");
    }
    return true;
  }

  // PUT /api/paaw/app-rules
  if (req.method === "PUT" && path === "/api/paaw/app-rules") {
    try {
      const body = await readBody(req);
      await mkdir(resolve(PAAW_ROOT, "data/config"), { recursive: true });
      await writeFile(APP_RULES_PATH, body, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Rules updated" }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── App Skills for Workflow Builder ──

  // GET /api/paaw/app-skills
  if (req.method === "GET" && path === "/api/paaw/app-skills") {
    try {
      const appFiles = await readdir(APPS_ROOT);
      const result = [];
      for (const f of appFiles) {
        if (!f.endsWith(".json")) continue;
        try {
          const app = JSON.parse(await readFile(resolve(APPS_ROOT, f), "utf-8"));
          const skills = [];
          const appSkillsDir = resolve(APPS_ROOT, app.id, "skills");
          try {
            const dirs = await readdir(appSkillsDir);
            for (const d of dirs) {
              if (existsSync(resolve(appSkillsDir, d, "SKILL.md"))) skills.push(d);
            }
          } catch {}
          result.push({ id: app.id, name: app.name || app.id, icon: app.icon || "📦", skills });
        } catch {}
      }
      const poolSkills = [];
      try {
        const dirs = await readdir(resolve(PAAW_ROOT, "data/skills/pool"));
        for (const d of dirs) {
          if (existsSync(resolve(PAAW_ROOT, "data/skills/pool", d, "SKILL.md"))) poolSkills.push(d);
        }
      } catch {}
      if (poolSkills.length > 0) {
        result.push({ id: "_pool", name: "Skill Pool", icon: "🗂️", skills: poolSkills });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── App Import/Export ──

  // GET /api/paaw/apps/:id/export
  const appExportMatch = req.method === "GET" && path.match(/^\/api\/paaw\/apps\/([\w.-]+)\/export$/);
  if (appExportMatch) {
    const appId = appExportMatch[1];
    const bundle = {
      manifest: "paaw-app-v1",
      exportedAt: new Date().toISOString(),
      app: null,
      skills: {},
      html: null,
      data: null,
    };
    try {
      bundle.app = JSON.parse(await readFile(resolve(PAAW_ROOT, "data/apps", `${appId}.json`), "utf-8"));
    } catch {}
    if (!bundle.app) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `App not found: ${appId}` }));
      return true;
    }
    try {
      const skillsDir = resolve(PAAW_ROOT, "data/apps", appId, "skills");
      const skillDirs = await readdir(skillsDir);
      for (const sd of skillDirs) {
        try { bundle.skills[sd] = await readFile(resolve(skillsDir, sd, "SKILL.md"), "utf-8"); } catch {}
      }
    } catch {}
    try { bundle.html = await readFile(resolve(PAAW_ROOT, "data/apps", appId, "app.html"), "utf-8"); } catch {}
    try { bundle.data = JSON.parse(await readFile(resolve(PAAW_ROOT, "data/app-data", `${appId}.json`), "utf-8")); } catch {}

    res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${appId}-bundle.json"` });
    res.end(JSON.stringify(bundle, null, 2));
    return true;
  }

  // POST /api/paaw/apps/import
  if (req.method === "POST" && path === "/api/paaw/apps/import") {
    try {
      const bundle = JSON.parse(await readBody(req));
      if (bundle.manifest !== "paaw-app-v1") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid bundle format. Expected manifest: paaw-app-v1" }));
        return true;
      }
      const app = bundle.app;
      if (!app?.id) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing app.id" }));
        return true;
      }
      await writeFile(resolve(PAAW_ROOT, "data/apps", `${app.id}.json`), JSON.stringify(app, null, 2), "utf-8");
      if (bundle.skills) {
        for (const [skillName, skillContent] of Object.entries(bundle.skills)) {
          const skillDir = resolve(PAAW_ROOT, "data/apps", app.id, "skills", skillName);
          await mkdir(skillDir, { recursive: true });
          await writeFile(resolve(skillDir, "SKILL.md"), skillContent, "utf-8");
        }
      }
      if (bundle.html) {
        const appDir = resolve(PAAW_ROOT, "data/apps", app.id);
        await mkdir(appDir, { recursive: true });
        await writeFile(resolve(appDir, "app.html"), bundle.html, "utf-8");
      }
      if (bundle.data) {
        await writeFile(resolve(PAAW_ROOT, "data/app-data", `${app.id}.json`), JSON.stringify(bundle.data, null, 2), "utf-8");
      }
      invalidateCache();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `App「${app.name}」imported successfully`, app }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── Provider / Model APIs ──

  // GET /api/version — PAAW 版本（pack.mjs 打包時寫在 package.json）
  if (req.method === "GET" && path === "/api/version") {
    try {
      const pkg = JSON.parse(await readFile(resolve(PAAW_ROOT, "package.json"), "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: pkg.version || "0.0.0" }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "0.0.0" }));
    }
    return true;
  }

  // GET /api/paaw/providers
  if (req.method === "GET" && path === "/api/paaw/providers") {
    try {
      const config = JSON.parse(await readFile(resolve(PAAW_DATA_DIR, "config/providers.json"), "utf-8"));
      const hasAnyKey = Object.values(config.providers).some((p) => p.apiKey && p.apiKey.length > 0);
      const safe = { active: config.active, defaultModel: config.defaultModel, fallbacks: config.fallbacks || [], configured: hasAnyKey, providers: {} };
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

  // PUT /api/paaw/providers
  if (req.method === "PUT" && path === "/api/paaw/providers") {
    try {
      const filePath = resolve(PAAW_DATA_DIR, "config/providers.json");
      const config = JSON.parse(await readFile(filePath, "utf-8"));
      const body = JSON.parse(await readBody(req));
      if (body.active) config.active = body.active;
      if (body.defaultModel) config.defaultModel = body.defaultModel;
      // Fallback chain（UI 可編輯，按序使用）
      if (Array.isArray(body.fallbacks)) config.fallbacks = body.fallbacks;
      // 明確刪除（UI 的刪除/rename 需要 — PUT 本身不刪不在 body 裡的 provider）
      if (Array.isArray(body.removedProviderIds) && body.removedProviderIds.length > 0) {
        for (const pid of body.removedProviderIds) delete config.providers[pid];
        if (config.active && body.removedProviderIds.includes(config.active) && Object.keys(config.providers).length > 0) {
          config.active = Object.keys(config.providers)[0];
        }
        if (Array.isArray(config.fallbacks)) {
          config.fallbacks = config.fallbacks.filter((f) => !body.removedProviderIds.includes(f.provider));
        }
      }
      if (body.provider && body.providerId) {
        const pid = body.providerId;
        if (config.providers[pid]) {
          // apiKey 以 "..." 結尾 = GET 回傳的截斷版未變更，不覆蓋真 key
          if (body.provider.apiKey !== undefined && !body.provider.apiKey.endsWith("...")) config.providers[pid].apiKey = body.provider.apiKey;
          if (body.provider.baseURL !== undefined) config.providers[pid].baseURL = body.provider.baseURL;
          if (body.provider.models) config.providers[pid].models = body.provider.models;
        }
      }
      if (body.providers) {
        for (const [pid, pdata] of Object.entries(body.providers)) {
          if (!config.providers[pid]) config.providers[pid] = { name: pid, baseURL: "", apiKey: "", models: [] };
          const p = pdata;
          if (p.apiKey !== undefined && !p.apiKey.endsWith("...")) config.providers[pid].apiKey = p.apiKey;
          if (p.baseURL !== undefined) config.providers[pid].baseURL = p.baseURL;
          if (p.models) config.providers[pid].models = p.models;
          if (p.name) config.providers[pid].name = p.name;
        }
      }
      await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
      const safe = { ok: true, active: config.active, defaultModel: config.defaultModel, providers: {} };
      for (const [k, v] of Object.entries(config.providers)) {
        safe.providers[k] = { ...v, apiKey: v.apiKey ? v.apiKey.slice(0, 8) + "..." : "" };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(safe));
    } catch (err) {
      console.error("[PAAW] Provider update error:", err);
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to update providers" }));
    }
    return true;
  }

  // ── Workspaces ──

  // GET /api/paaw/workspaces
  if (req.method === "GET" && path === "/api/paaw/workspaces") {
    try {
      const data = JSON.parse(await readFile(PAAW_WORKSPACES_FILE, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ directories: [] }));
    }
    return true;
  }

  // POST /api/paaw/workspaces
  if (req.method === "POST" && path === "/api/paaw/workspaces") {
    try {
      let data;
      try { data = JSON.parse(await readFile(PAAW_WORKSPACES_FILE, "utf-8")); } catch { data = { directories: [] }; }
      const body = JSON.parse(await readBody(req));
      const dir = body.directory;
      if (!dir) { res.writeHead(400); res.end(JSON.stringify({ error: "directory required" })); return true; }
      if (!data.directories.includes(dir)) {
        data.directories.push(dir);
        await writeFile(PAAW_WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf-8");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to add workspace" }));
    }
    return true;
  }

  // DELETE /api/paaw/workspaces?dir=...
  if (req.method === "DELETE" && path === "/api/paaw/workspaces") {
    try {
      const dir = url.searchParams.get("dir");
      let data;
      try { data = JSON.parse(await readFile(PAAW_WORKSPACES_FILE, "utf-8")); } catch { data = { directories: [] }; }
      data.directories = data.directories.filter((d) => d !== dir);
      await writeFile(PAAW_WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to remove workspace" }));
    }
    return true;
  }

  // ── Knowledge Paths ──
  if (req.method === "GET" && path === "/api/paaw/knowledge-paths") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ directories: [PAAW_KNOWLEDGE_DIR] }));
    return true;
  }

  // ── UI State ──

  // GET /api/paaw/ui-state
  if (req.method === "GET" && path === "/api/paaw/ui-state") {
    const state = await loadUiState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state));
    return true;
  }

  // PUT /api/paaw/ui-state
  if (req.method === "PUT" && path === "/api/paaw/ui-state") {
    try {
      const body = JSON.parse(await readBody(req));
      await saveUiState(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // PATCH /api/paaw/ui-state
  if (req.method === "PATCH" && path === "/api/paaw/ui-state") {
    try {
      const patch = JSON.parse(await readBody(req));
      const state = await loadUiState();
      for (const [key, val] of Object.entries(patch)) {
        state[key] = val;
      }
      await saveUiState(state);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── Workflow API ──

  // GET /api/paaw/workflows
  if (req.method === "GET" && path === "/api/paaw/workflows") {
    try {
      await mkdir(WORKFLOWS_ROOT, { recursive: true });
      const files = await readdir(WORKFLOWS_ROOT);
      const wfs = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const data = JSON.parse(await readFile(resolve(WORKFLOWS_ROOT, f), "utf-8"));
          wfs.push(data);
        } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(wfs));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/paaw/workflows/:id
  const wfGetMatch = req.method === "GET" && path.match(/^\/api\/paaw\/workflows\/([\w.-]+)$/);
  if (wfGetMatch) {
    try {
      const wfId = wfGetMatch[1];
      const data = JSON.parse(await readFile(resolve(WORKFLOWS_ROOT, `${wfId}.json`), "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(404); res.end(JSON.stringify({ error: "Workflow not found" }));
    }
    return true;
  }

  // PUT /api/paaw/workflows/:id
  const wfPutMatch = req.method === "PUT" && path.match(/^\/api\/paaw\/workflows\/([\w.-]+)$/);
  if (wfPutMatch) {
    try {
      const wfId = wfPutMatch[1];
      const body = JSON.parse(await readBody(req));
      await mkdir(WORKFLOWS_ROOT, { recursive: true });
      await writeFile(resolve(WORKFLOWS_ROOT, `${wfId}.json`), JSON.stringify(body, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/paaw/workflows
  if (req.method === "POST" && path === "/api/paaw/workflows") {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.id || !body.name) {
        res.writeHead(400); res.end(JSON.stringify({ error: "id and name required" }));
        return true;
      }
      await mkdir(WORKFLOWS_ROOT, { recursive: true });
      await writeFile(resolve(WORKFLOWS_ROOT, `${body.id}.json`), JSON.stringify(body, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/paaw/workflows/:id
  const wfDelMatch = req.method === "DELETE" && path.match(/^\/api\/paaw\/workflows\/([\w.-]+)$/);
  if (wfDelMatch) {
    try {
      const wfId = wfDelMatch[1];
      const fp = resolve(WORKFLOWS_ROOT, `${wfId}.json`);
      await unlink(fp);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(404); res.end(JSON.stringify({ error: "Workflow not found" }));
    }
    return true;
  }

  // ── Workflow Execution History ──

  // GET /api/paaw/workflows/:id/exec-history
  const wfExecMatch = path.match(/^\/api\/paaw\/workflows\/([^/]+)\/exec-history$/);
  if (req.method === "GET" && wfExecMatch) {
    try {
      const wfId = wfExecMatch[1];
      const histDir = resolve(WORKFLOWS_ROOT, "_exec-history");
      await mkdir(histDir, { recursive: true });
      const histFile = resolve(histDir, wfId + ".json");
      let history = [];
      try { history = JSON.parse(await readFile(histFile, "utf-8")); } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(history));
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return true;
  }

  // POST /api/paaw/workflows/:id/exec-history
  if (req.method === "POST" && wfExecMatch) {
    try {
      const wfId = wfExecMatch[1];
      const entry = JSON.parse(await readBody(req));
      const histDir = resolve(WORKFLOWS_ROOT, "_exec-history");
      await mkdir(histDir, { recursive: true });
      const histFile = resolve(histDir, wfId + ".json");
      let history = [];
      try { history = JSON.parse(await readFile(histFile, "utf-8")); } catch {}
      history.unshift(entry);
      if (history.length > 50) history = history.slice(0, 50);
      await writeFile(histFile, JSON.stringify(history, null, 2));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return true;
  }

  // ── Skill Inputs ──

  // GET /api/paaw/skills/:appId/:skillId/inputs
  const skillInputsMatch = path.match(/^\/api\/paaw\/skills\/([^/]+)\/([^/]+)\/inputs$/);
  if (req.method === "GET" && skillInputsMatch) {
    try {
      const [, appId, skillId] = skillInputsMatch;
      let skillPath = resolve(PAAW_ROOT, "data/apps", appId, "skills", skillId, "SKILL.md");
      let content;
      try { content = await readFile(skillPath, "utf-8"); } catch {
        skillPath = resolve(PAAW_ROOT, "data/skills/pool", skillId, "SKILL.md");
        try { content = await readFile(skillPath, "utf-8"); } catch {
          res.writeHead(404); res.end(JSON.stringify({ error: "Skill not found" })); return true;
        }
      }
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let userInputs = [];
      if (fmMatch) {
        const fm = yaml.load(fmMatch[1]);
        userInputs = fm.userInputs || [];
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ skillId, appId, userInputs }));
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return true;
  }

  // ── Workflow Output Chat ──

  // POST /api/paaw/workflow-output-chat
  if (req.method === "POST" && path === "/api/paaw/workflow-output-chat") {
    try {
      const { chatId, content: msgContent, workflowName } = JSON.parse(await readBody(req));
      const cid = chatId || "default";
      const filePath = resolve(PAAW_CHAT_DIR, `${cid}.json`);
      let chat;
      try { chat = JSON.parse(await readFile(filePath, "utf-8")); } catch {
        chat = { id: cid, title: "PAAW 交談", messages: [], createdAt: new Date().toISOString() };
      }
      const text = typeof msgContent === "string" ? msgContent : JSON.stringify(msgContent, null, 2);
      chat.messages.push({ role: "assistant", content: `🔗 **Workflow: ${workflowName || "未命名"}**\n\n${text}`, timestamp: new Date().toISOString() });
      chat.updatedAt = new Date().toISOString();
      await writeFile(filePath, JSON.stringify(chat, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, chatId: cid }));
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return true;
  }

  // POST /api/paaw/file-write
  if (req.method === "POST" && path === "/api/paaw/file-write") {
    try {
      const { path: filePath, content } = JSON.parse(await readBody(req));
      if (!filePath) { res.writeHead(400); res.end(JSON.stringify({ error: "path required" })); return true; }
      const dir = dirname(filePath);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: filePath }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}
