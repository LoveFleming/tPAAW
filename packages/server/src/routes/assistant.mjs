/**
 * PAAW Personal Assistant APIs
 * Routes: /api/paaw/* (user, avatar, providers, workspaces, knowledge,
 *          ui-state, app-rules, app import/export, file-write,
 *          file-write)
 */

import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { DATA_HOME } from "../data-home.mjs";
import {
  PAAW_ROOT, PAAW_DATA_DIR, PAAW_USER_FILE, PAAW_CHAT_DIR,
  PAAW_WORKSPACES_FILE, PAAW_KNOWLEDGE_DIR, UI_STATE_FILE,
  APP_RULES_PATH, APPS_ROOT,
  readBody, yaml,
} from "./shared.mjs";
import { sanitizeId, sendPathTraversalError } from "../lib/coding-security.mjs";

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

  // ── PAAW Root ──

  // GET /api/paaw-root — return PAAW_ROOT absolute path（原址 workflow.mjs，功能與 workflow 無關）
  if (req.method === "GET" && path === "/api/paaw-root") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ paawRoot: PAAW_ROOT }));
    return true;
  }

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
      await mkdir(resolve(DATA_HOME, "config"), { recursive: true });
      await writeFile(APP_RULES_PATH, body, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Rules updated" }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── App Import/Export ──

  // GET /api/paaw/apps/:id/export
  const appExportMatch = req.method === "GET" && path.match(/^\/api\/paaw\/apps\/([\w.-]+)\/export$/);
  if (appExportMatch) {
    let appId;
    try { appId = sanitizeId(appExportMatch[1]); } catch (err) { sendPathTraversalError(res, err); return true; }
    const bundle = {
      manifest: "paaw-app-v1",
      exportedAt: new Date().toISOString(),
      app: null,
      skills: {},
      html: null,
      data: null,
    };
    try {
      bundle.app = JSON.parse(await readFile(resolve(DATA_HOME, "apps", `${appId}.json`), "utf-8"));
    } catch {}
    if (!bundle.app) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `App not found: ${appId}` }));
      return true;
    }
    try {
      const skillsDir = resolve(DATA_HOME, "apps", appId, "skills");
      const skillDirs = await readdir(skillsDir);
      for (const sd of skillDirs) {
        try { bundle.skills[sd] = await readFile(resolve(skillsDir, sd, "SKILL.md"), "utf-8"); } catch {}
      }
    } catch {}
    try { bundle.html = await readFile(resolve(DATA_HOME, "apps", appId, "app.html"), "utf-8"); } catch {}
    try { bundle.data = JSON.parse(await readFile(resolve(DATA_HOME, "app-data", `${appId}.json`), "utf-8")); } catch {}

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
      await writeFile(resolve(DATA_HOME, "apps", `${app.id}.json`), JSON.stringify(app, null, 2), "utf-8");
      if (bundle.skills) {
        for (const [skillName, skillContent] of Object.entries(bundle.skills)) {
          const skillDir = resolve(DATA_HOME, "apps", app.id, "skills", skillName);
          await mkdir(skillDir, { recursive: true });
          await writeFile(resolve(skillDir, "SKILL.md"), skillContent, "utf-8");
        }
      }
      if (bundle.html) {
        const appDir = resolve(DATA_HOME, "apps", app.id);
        await mkdir(appDir, { recursive: true });
        await writeFile(resolve(appDir, "app.html"), bundle.html, "utf-8");
      }
      if (bundle.data) {
        await writeFile(resolve(DATA_HOME, "app-data", `${app.id}.json`), JSON.stringify(bundle.data, null, 2), "utf-8");
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

  // ── 網路白名單（2026-10-10）：srt 沙箱對外域名 — data/config/network-whitelist.json ──
  if (path === "/api/paaw/network-whitelist" && req.method === "GET") {
    const { builtinAllowedDomains, customAllowedDomains } = await import("../lib/paaw-sandbox.mjs");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ builtin: builtinAllowedDomains(), custom: customAllowedDomains(), sandboxNote: "AI bash 沙箱只允許連這些域名（內建=系統必要不可刪；自訂=加你需要的 API）" }));
    return true;
  }
  if (path === "/api/paaw/network-whitelist" && req.method === "PUT") {
    const body = JSON.parse(await readBody(req) || "{}");
    const { builtinAllowedDomains } = await import("../lib/paaw-sandbox.mjs");
    const builtinSet = new Set(builtinAllowedDomains());
    const clean = [...new Set((Array.isArray(body.domains) ? body.domains : [])
      .map((d) => String(d || "").trim().toLowerCase())
      .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !builtinSet.has(d)))]; // 域名形狀 + 內建去重
    const cfgDir = resolve(PAAW_DATA_DIR, "config");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(resolve(cfgDir, "network-whitelist.json"), JSON.stringify({ domains: clean, _note: "AI bash 沙箱對外白名單（Settings UI 管理）" }, null, 2) + "\n", "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, custom: clean }));
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
      res.end(JSON.stringify({ active: "", defaultModel: "", fallbacks: [], configured: false, providers: {} }));
    }
    return true;
  }

  // PUT /api/paaw/providers
  if (req.method === "PUT" && path === "/api/paaw/providers") {
    try {
      const filePath = resolve(PAAW_DATA_DIR, "config/providers.json");
      // 全新機器第一次設定（onboarding）：providers.json 可能還不存在 — 建立初始空結構
      let config;
      try {
        config = JSON.parse(await readFile(filePath, "utf-8"));
      } catch {
        config = { active: "", defaultModel: "", fallbacks: [], providers: {} };
      }
      const body = JSON.parse(await readBody(req));
      if (!Array.isArray(config.fallbacks)) config.fallbacks = [];
      if (!config.providers) config.providers = {};
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
      const { mkdir } = await import("fs/promises");
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
      const safe = { ok: true, active: config.active, defaultModel: config.defaultModel, fallbacks: config.fallbacks || [], providers: {} };
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

  // ── File Write ──

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
