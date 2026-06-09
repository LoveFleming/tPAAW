/**
 * Workflow routes — CRUD + execution + history
 */
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { spawn } from "node-pty";
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

  // POST /api/paaw/skill-exec — execute a single skill via CLI
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

      // Load app-level SYSTEM.md if exists
      let appSystemPrompt = "";
      try { appSystemPrompt = await readFile(join(PATHS.APPS_ROOT, appId, "SYSTEM.md"), "utf-8"); } catch {}

      // Parse skill frontmatter
      const { parseSkillFrontmatter } = await import("./context.mjs");
      const parsed = parseSkillFrontmatter(raw);

      // Build prompt — replace {{key}} with input values
      let prompt = parsed.body || "";
      if (typeof input === "object") {
        for (const [k, v] of Object.entries(input)) {
          prompt = prompt.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), typeof v === "string" ? v : JSON.stringify(v));
        }
      }

      // Build full system prompt
      let fullSystem = "";
      if (appSystemPrompt) fullSystem += appSystemPrompt + "\n\n";
      fullSystem += `你是「${appId}」App 的 Skill 執行引擎。嚴格按照 Skill 定義處理，只輸出結果，不加解釋。`; 

      // Execute via CLI (same approach as tools/index.mjs skillExec)
      const resolvedBin = process.env.QWEN_BIN || "/opt/homebrew/bin/qwen";
      const cliArgs = ["--approval-mode", "yolo", "-o", "text", "--max-tool-calls", "10", prompt];
      const appDir = resolve(PATHS.APPS_ROOT, appId);

      let fullOutput;
      try {
        fullOutput = await new Promise((pResolve, reject) => {
          let output = "";
          const proc = spawn(resolvedBin, cliArgs, {
            name: "xterm-256color",
            cols: 200,
            rows: 30,
            cwd: appDir,
            env: { ...process.env, HOME: process.env.HOME, QWEN_CODE_SUPPRESS_YOLO_WARNING: "1", FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
          });
          proc.onData((data) => { output += data; });
          proc.onExit(({ exitCode }) => {
            if (exitCode === 0) pResolve(output);
            else reject(new Error(`CLI exited with code ${exitCode}`));
          });
          setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("Timeout (90s)")); }, 90000);
        });
      } catch (err) {
        json(res, { error: `執行失敗：${err.message}` }, 500);
        return true;
      }

      // Clean ANSI escape codes from output
      const cleanOutput = fullOutput
        .replace(/\x1b\[[0-9;]*[mGKH]/g, "")
        .replace(/^\s+|\s+$/g, "");

      // Try to parse as JSON for structured output
      let result;
      const jsonMatch = cleanOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { result = JSON.parse(jsonMatch[0]); } catch { result = { text: cleanOutput.slice(0, 1500) }; }
      } else {
        result = { text: cleanOutput.slice(0, 1500) || "執行完成但無輸出" };
      }
      json(res, { result });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  return false;
}
