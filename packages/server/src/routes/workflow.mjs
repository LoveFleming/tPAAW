/**
 * Workflow routes — CRUD + execution + history
 */
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { PATHS, readBody, json, urlPath } from "./context.mjs";

export default async function workflowRoutes(req, res) {
  const path = urlPath(req);

  // GET /api/paaw/workflows — list all
  if (req.method === "GET" && path === "/api/paaw/workflows") {
    try {
      await mkdir(PATHS.WORKFLOWS_ROOT, { recursive: true });
      const files = await readdir(PATHS.WORKFLOWS_ROOT);
      const wfs = [];
      for (const f of files) {
        if (!f.endsWith(".json") || f.startsWith("_")) continue;
        try { const raw = await readFile(join(PATHS.WORKFLOWS_ROOT, f), "utf-8"); wfs.push(JSON.parse(raw)); } catch {}
      }
      json(res, wfs);
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // GET /api/paaw/workflows/:id
  const getMatch = path.match(/^\/api\/paaw\/workflows\/([\w.-]+)$/);
  if (req.method === "GET" && getMatch && !path.includes("exec-history")) {
    try {
      const raw = await readFile(join(PATHS.WORKFLOWS_ROOT, `${getMatch[1]}.json`), "utf-8");
      json(res, JSON.parse(raw));
    } catch { json(res, { error: "Not found" }, 404); }
    return true;
  }

  // PUT /api/paaw/workflows/:id — update
  const putMatch = path.match(/^\/api\/paaw\/workflows\/([\w.-]+)$/);
  if (req.method === "PUT" && putMatch) {
    try {
      const data = JSON.parse(await readBody(req));
      await mkdir(PATHS.WORKFLOWS_ROOT, { recursive: true });
      await writeFile(join(PATHS.WORKFLOWS_ROOT, `${putMatch[1]}.json`), JSON.stringify(data, null, 2), "utf-8");
      json(res, { ok: true });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // POST /api/paaw/workflows — create
  if (req.method === "POST" && path === "/api/paaw/workflows") {
    try {
      const data = JSON.parse(await readBody(req));
      const id = data.id || `wf-${Date.now()}`;
      data.id = id;
      await mkdir(PATHS.WORKFLOWS_ROOT, { recursive: true });
      await writeFile(join(PATHS.WORKFLOWS_ROOT, `${id}.json`), JSON.stringify(data, null, 2), "utf-8");
      json(res, { ok: true, id });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // DELETE /api/paaw/workflows/:id
  const delMatch = path.match(/^\/api\/paaw\/workflows\/([\w.-]+)$/);
  if (req.method === "DELETE" && delMatch) {
    try {
      const { unlink } = await import("fs/promises");
      await unlink(join(PATHS.WORKFLOWS_ROOT, `${delMatch[1]}.json`));
      json(res, { ok: true });
    } catch { json(res, { error: "Not found" }, 404); }
    return true;
  }

  // GET /api/paaw/workflows/:id/exec-history
  const histGetMatch = path.match(/^\/api\/paaw\/workflows\/([\w.-]+)\/exec-history$/);
  if (req.method === "GET" && histGetMatch) {
    try {
      const histDir = join(PATHS.WORKFLOWS_ROOT, "_exec-history");
      await mkdir(histDir, { recursive: true });
      const f = join(histDir, `${histGetMatch[1]}.json`);
      try { json(res, JSON.parse(await readFile(f, "utf-8"))); } catch { json(res, []); }
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // POST /api/paaw/workflows/:id/exec-history
  const histPostMatch = path.match(/^\/api\/paaw\/workflows\/([\w.-]+)\/exec-history$/);
  if (req.method === "POST" && histPostMatch) {
    try {
      const entry = JSON.parse(await readBody(req));
      const histDir = join(PATHS.WORKFLOWS_ROOT, "_exec-history");
      await mkdir(histDir, { recursive: true });
      const f = join(histDir, `${histPostMatch[1]}.json`);
      let history = [];
      try { history = JSON.parse(await readFile(f, "utf-8")); } catch {}
      history.unshift(entry);
      if (history.length > 50) history = history.slice(0, 50);
      await writeFile(f, JSON.stringify(history, null, 2), "utf-8");
      json(res, { ok: true });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // POST /api/paaw/workflow-output-chat
  if (req.method === "POST" && path === "/api/paaw/workflow-output-chat") {
    try {
      const { chatId, content: msgContent, workflowName } = JSON.parse(await readBody(req));
      const cid = chatId || "default";
      const { mkdir: mk } = await import("fs/promises");
      await mkdir(PATHS.CHAT_DIR, { recursive: true });
      const filePath = join(PATHS.CHAT_DIR, `${cid}.json`);
      let chat;
      try { chat = JSON.parse(await readFile(filePath, "utf-8")); } catch {
        chat = { id: cid, title: "PAAW 交談", messages: [], createdAt: new Date().toISOString() };
      }
      const text = typeof msgContent === "string" ? msgContent : JSON.stringify(msgContent, null, 2);
      chat.messages.push({ role: "assistant", content: `🔗 **Workflow: ${workflowName || "未命名"}**\n\n${text}`, timestamp: new Date().toISOString() });
      chat.updatedAt = new Date().toISOString();
      await writeFile(filePath, JSON.stringify(chat, null, 2), "utf-8");
      json(res, { ok: true, chatId: cid });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // POST /api/paaw/file-write
  if (req.method === "POST" && path === "/api/paaw/file-write") {
    try {
      const { path: filePath, content } = JSON.parse(await readBody(req));
      const { mkdir: mk } = await import("fs/promises");
      const { dirname } = await import("path");
      await mk(dirname(filePath), { recursive: true });
      await writeFile(filePath, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf-8");
      json(res, { ok: true });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // POST /api/paaw/skill-exec — execute a single skill
  if (req.method === "POST" && path === "/api/paaw/skill-exec") {
    try {
      const { appId, skillId, input } = JSON.parse(await readBody(req));
      // Load skill SKILL.md
      let skillPath = join(PATHS.APPS_ROOT, appId, "skills", skillId, "SKILL.md");
      let raw;
      try { raw = await readFile(skillPath, "utf-8"); } catch {
        skillPath = join(PATHS.SKILL_POOL_ROOT, skillId, "SKILL.md");
        try { raw = await readFile(skillPath, "utf-8"); } catch { json(res, { error: "Skill not found" }, 404); return true; }
      }

      // Load SYSTEM.md if exists
      let systemPrompt = "";
      const sysPath = skillPath.replace("SKILL.md", "SYSTEM.md");
      try { systemPrompt = await readFile(sysPath, "utf-8"); } catch {}

      // Load app-level SYSTEM.md
      let appSystemPrompt = "";
      try { appSystemPrompt = await readFile(join(PATHS.APPS_ROOT, appId, "SYSTEM.md"), "utf-8"); } catch {}

      const { parseSkillFrontmatter, readSystemPrompt } = await import("./context.mjs");
      const globalSystem = await readSystemPrompt("global");
      const parsed = parseSkillFrontmatter(raw);

      // Build prompt
      let prompt = parsed.body || "";
      if (typeof input === "object") {
        for (const [k, v] of Object.entries(input)) {
          prompt = prompt.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), typeof v === "string" ? v : JSON.stringify(v));
        }
      }

      // Find provider/model from config
      let providerConfig = null;
      try {
        const config = JSON.parse(await readFile(join(PATHS.CONFIG_ROOT, "providers.json"), "utf-8"));
        providerConfig = config.providers?.[0];
      } catch {}

      const apiKey = providerConfig?.apiKey || process.env.OPENAI_API_KEY || "";
      const model = providerConfig?.model || process.env.PAAW_MODEL || "gpt-4o-mini";
      const baseUrl = providerConfig?.baseUrl || "https://api.openai.com/v1";

      if (!apiKey) { json(res, { error: "No API key configured. Set PAAW_MODEL_API_KEY or add provider in Settings." }, 400); return true; }

      // Call LLM
      const messages = [];
      if (globalSystem) messages.push({ role: "system", content: globalSystem });
      if (appSystemPrompt) messages.push({ role: "system", content: appSystemPrompt });
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: prompt });

      const llmRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature: 0.7 }),
      });
      const llmData = await llmRes.json();
      if (llmData.error) { json(res, { error: llmData.error.message || "LLM error" }, 500); return true; }

      const content = llmData.choices?.[0]?.message?.content || "";
      // Try parse as JSON
      let result;
      try { result = JSON.parse(content); } catch { result = { text: content }; }
      json(res, { result, model, usage: llmData.usage });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  return false;
}
