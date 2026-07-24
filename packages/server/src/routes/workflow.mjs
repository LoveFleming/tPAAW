/**
 * Workflow routes — CRUD + execution + history
 */
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { PATHS, readBody, json, urlPath } from "./context.mjs";
import { runAgentLoop, resolveLLMConfig, callLLM } from "../lib/paaw-agent-loop.mjs";

const PAAW_ROOT = process.env.PAAW_ROOT || PATHS.PAAW_ROOT;

// ── Topological sort (matches UI version) ──
function topoSort(nodes, edges) {
  const indeg = {};
  const adj = {};
  for (const n of nodes) { indeg[n.id] = 0; adj[n.id] = []; }
  for (const e of edges) {
    if (adj[e.source] && indeg[e.target] !== undefined) {
      adj[e.source].push(e.target);
      indeg[e.target]++;
    }
  }
  const q = nodes.filter(n => indeg[n.id] === 0);
  const sorted = [];
  while (q.length) {
    const n = q.shift();
    sorted.push(n);
    for (const tgt of (adj[n.id] || [])) {
      indeg[tgt]--;
      if (indeg[tgt] === 0) {
        const nd = nodes.find(nn => nn.id === tgt);
        if (nd) q.push(nd);
      }
    }
  }
  return sorted;
}

// ── Direct Skill Execution (single LLM call, no agent loop) ──
// Loads ALL context upfront — no tool calls, no multi-turn exploration.
async function runSkillDirect({ skillPath, input, appId, systemContext, model }) {
  const skillDir = resolve(skillPath, "..");
  const skillDirName = skillDir.split(/[\/]/).pop();

  // 1. Load SKILL.md
  const raw = await readFile(skillPath, "utf-8");
  const { parseSkillFrontmatter } = await import("./context.mjs");
  const parsed = parseSkillFrontmatter(raw);
  let prompt = parsed.body || "";

  // 2. Replace {{key}} placeholders with input values
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) {
      prompt = prompt.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), typeof v === "string" ? v : JSON.stringify(v));
    }
  }

  // 3. Pre-load ALL context: system msg + entire skill directory + app context
  const contextParts = [
    "你是 PAAW Skill 執行引擎。嚴格按照 Skill 定義處理，只輸出結果，不加解釋。",
  ];

  // ── Load ALL files from skill directory (scripts, samples, references, etc.) ──
  // SKILL.md frontmatter is already parsed → load everything ELSE as context
  contextParts.push(`━━━ Skill: ${parsed.meta?.id || skillDirName} ━━━`);
  if (parsed.meta && Object.keys(parsed.meta).length > 0) {
    contextParts.push(`Frontmatter:\n${JSON.stringify(parsed.meta, null, 2)}`);
  }

  // Recursively scan skill directory for all files
  const loadedFiles = [];
  function scanSkillDir(dir, relPath = "") {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip SKILL.md (already parsed), hidden files, sessions, memory logs
      if (entry.name === "SKILL.md") continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name.startsWith("_cron_inputs")) continue;
      if (entry.name === ".paaw") continue;

      const fullPath = join(dir, entry.name);
      const relFilePath = relPath ? `${relPath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        scanSkillDir(fullPath, relFilePath);
      } else if (entry.isFile()) {
        loadedFiles.push({ relPath: relFilePath, fullPath });
      }
    }
  }
  try { scanSkillDir(skillDir); } catch {}

  // Load each file's content
  for (const file of loadedFiles) {
    try {
      const content = readFileSync(file.fullPath, "utf-8");
      const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
      let label = `📄 ${file.relPath}`;
      if (ext === "md") label = `📖 ${file.relPath}`;
      else if (ext === "js" || ext === "mjs" || ext === "ts" || ext === "tsx") label = `📜 ${file.relPath}`;
      else if (ext === "json") label = `⚙️ ${file.relPath}`;
      contextParts.push(`--- ${label} ---\n${content}`);
    } catch {}
  }

  // ── App-level context ──
  if (appId) {
    try {
      const appSystem = await readFile(join(PATHS.APPS_ROOT, appId, "SYSTEM.md"), "utf-8");
      contextParts.push(`--- App SYSTEM.md ---\n${appSystem}`);
    } catch {}

    // App knowledge files
    const appKnowledgeDir = join(PATHS.APPS_ROOT, appId, "knowledge");
    if (existsSync(appKnowledgeDir)) {
      try {
        const files = readdirSync(appKnowledgeDir);
        for (const f of files) {
          if (f.endsWith(".md") || f.endsWith(".txt")) {
            const content = await readFile(join(appKnowledgeDir, f), "utf-8");
            contextParts.push(`--- App Knowledge: ${f} ---\n${content}`);
          }
        }
      } catch {}
    }
  }

  // Extra system context from caller (e.g. workflow context)
  if (systemContext) {
    contextParts.push(systemContext);
  }

  contextParts.push("━━━ End of Context — 嚴格按照 SKILL.md 定義執行 ━━━");

  // 4. Resolve LLM config
  const llm = resolveLLMConfig(PAAW_ROOT, model);
  if (!llm.apiUrl || !llm.model) {
    throw new Error("LLM not configured");
  }

  // 5. Single LLM call — all context pre-loaded, no tools, no multi-turn
  const messages = [
    { role: "system", content: contextParts.join("\n\n") },
    { role: "user", content: prompt },
  ];

  const response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, null, false, null);
  const content = response.choices?.[0]?.message?.content || "";

  // Clean output
  const clean = content.replace(/\x1b\[[0-9;]*[mGKH]/g, "").trim();

  // Parse as JSON if possible
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }
  return { text: clean.slice(0, 2000) || "執行完成但無輸出" };
}


export default async function workflowRoutes(req, res) {
  const path = urlPath(req);

  // GET /api/paaw-root — return PAAW_ROOT absolute path
  if (req.method === "GET" && path === "/api/paaw-root") {
    json(res, { paawRoot: PATHS.PAAW_ROOT });
    return true;
  }

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
      // Resolve relative paths against PAAW_ROOT
      const absPath = filePath.startsWith("/") ? filePath : resolve(PATHS.PAAW_ROOT, filePath);
      await mk(dirname(absPath), { recursive: true });
      await writeFile(absPath, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf-8");
      json(res, { ok: true, path: absPath });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // POST /api/paaw/skill-exec — execute a single skill (single LLM call, all context pre-loaded)
  if (req.method === "POST" && path === "/api/paaw/skill-exec") {
    try {
      const { appId, skillId, input, model, useAgentLoop } = JSON.parse(await readBody(req));

      // Find skill path
      let skillPath = appId
        ? join(PATHS.APPS_ROOT, appId, "skills", skillId, "SKILL.md")
        : join(PATHS.SKILL_POOL_ROOT || resolve(PAAW_ROOT, "data/skills/physical-skill"), skillId, "SKILL.md");
      if (!existsSync(skillPath)) {
        // Try skill pool root
        skillPath = join(PATHS.SKILL_POOL_ROOT || resolve(PAAW_ROOT, "data/skills/physical-skill"), skillId, "SKILL.md");
      }
      if (!existsSync(skillPath)) {
        // Try physical-skill dir
        skillPath = resolve(PAAW_ROOT, `data/skills/physical-skill/${skillId}/SKILL.md`);
      }
      if (!existsSync(skillPath)) { json(res, { error: `Skill not found: ${skillId}` }, 404); return true; }

      // Use direct execution by default (single LLM call, all context pre-loaded)
      // Set useAgentLoop=true to use the full agent loop (with tools, multi-turn)
      if (useAgentLoop) {
        // Legacy mode: full agent loop with tools
        const { contextEngine } = await import("../context-engine.mjs");
        const ctx = await contextEngine.build({ target: "skill-exec", appId, skillId, skillPath, input });
        const { loadAgentConfig } = await import("./context.mjs");
        const agentCfg = await loadAgentConfig();
        const appDir = resolve(PATHS.APPS_ROOT, appId || ".");
        const agentResult = await runAgentLoop({
          prompt: ctx.prompt || "", cwd: appDir, systemPrompt: ctx.systemPrompt || "",
          model: model || undefined, maxTurns: agentCfg.maxTurns, timeout: agentCfg.timeoutSeconds, rootDir: PATHS.PAAW_ROOT,
        });
        const cleanOutput = (agentResult.content || "").replace(/\x1b\[[0-9;]*[mGKH]/g, "").trim();
        const jm = cleanOutput.match(/\{[\s\S]*\}/);
        const result = jm ? (() => { try { return JSON.parse(jm[0]); } catch { return { text: cleanOutput.slice(0, 1500) }; } })() : { text: cleanOutput.slice(0, 1500) };
        json(res, { result });
      } else {
        // Direct mode: single LLM call, all context pre-loaded, no tools
        const result = await runSkillDirect({ skillPath, input, appId, model });
        json(res, { result });
      }
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // POST /api/paaw/tool-exec — execute a tool provider tool
  if (req.method === "POST" && path === "/api/paaw/tool-exec") {
    try {
      const { toolName, input } = JSON.parse(await readBody(req));
      if (!toolName) { json(res, { error: "toolName is required" }, 400); return true; }

      const { toolRegistry } = await import("../lib/tool-registry.mjs");
      const handler = toolRegistry.getHandler(toolName);
      if (!handler) { json(res, { error: `Tool '${toolName}' not found` }, 404); return true; }

      const result = await handler(input || {}, { toolName });
      json(res, { result: result || { text: "（無輸出）" } });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/paaw/tools — list available tool providers (for workflow editor)
  if (req.method === "GET" && path === "/api/paaw/tools") {
    try {
      const { listProviderTools } = await import("../tools/provider-loader.mjs");
      const tools = listProviderTools();
      json(res, { tools });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // POST /api/paaw/workflow-trigger — trigger a workflow by ID (for cron)
  if (req.method === "POST" && path === "/api/paaw/workflow-trigger") {
    try {
      const { workflowId, input } = JSON.parse(await readBody(req));
      if (!workflowId) { json(res, { error: "workflowId is required" }, 400); return true; }

      const wfPath = join(PATHS.WORKFLOWS_ROOT, `${workflowId}.json`);
      if (!existsSync(wfPath)) { json(res, { error: "Workflow not found" }, 404); return true; }

      const wf = JSON.parse(readFileSync(wfPath, "utf-8"));

      // Execute workflow synchronously and return result
      const { toolRegistry } = await import("../lib/tool-registry.mjs");
      const ctx = { workflow: { input: input || {} }, node: {} };

      // Topological sort
      const skillNodes = (wf.nodes || []).filter(n => n.type === "skill" || n.type === "tool");
      const edges = (wf.edges || []).filter(e => {
        const sn = (wf.nodes || []).find(n => n.id === e.source);
        const tn = (wf.nodes || []).find(n => n.id === e.target);
        return (sn?.type === "skill" || sn?.type === "tool") && (tn?.type === "skill" || tn?.type === "tool");
      });

      const sorted = topoSort(skillNodes, edges);
      const results = [];
      let lastOutput = null;

      for (const node of sorted) {
        const ri = {};
        for (const [k, t] of Object.entries(node.config?.inputMapping || {})) {
          ri[k] = resolveTemplateStr(t, ctx);
        }

        let output;
        if (node.type === "tool" && node.toolName) {
          // Execute tool provider
          const handler = toolRegistry.getHandler(node.toolName);
          if (!handler) { results.push({ node: node.name, error: `Tool '${node.toolName}' not found` }); break; }
          output = await handler(ri, { toolName: node.toolName });
        } else if (node.skillId) {
          // Execute skill (direct mode — single LLM call)
          const appId = node.appName;
          let skillPathResolved = appId
            ? join(PATHS.APPS_ROOT, appId, "skills", node.skillId, "SKILL.md")
            : null;
          if (!skillPathResolved || !existsSync(skillPathResolved)) {
            skillPathResolved = resolve(PAAW_ROOT, `data/skills/physical-skill/${node.skillId}/SKILL.md`);
          }
          if (!existsSync(skillPathResolved)) {
            skillPathResolved = resolve(PAAW_ROOT, `data/skills/building/${node.skillId}/package/SKILL.md`);
          }
          if (!existsSync(skillPathResolved)) { results.push({ node: node.name, error: `Skill not found: ${node.skillId}` }); break; }
          output = await runSkillDirect({ skillPath: skillPathResolved, input: ri, appId, model });
        }

        ctx.node[node.id] = { output };
        lastOutput = output;
        results.push({ node: node.name, status: "success", durationMs: 0 });
      }

      // Handle output
      const endCfg = (wf.nodes || []).find(n => n.type === "end")?.config;
      if (lastOutput && endCfg?.outputTarget === "chat") {
        try {
          const outputText = typeof lastOutput === "string" ? lastOutput : JSON.stringify(lastOutput, null, 2);
          await fetch(`http://127.0.0.1:${process.env.PORT || 3148}/api/paaw/workflow-output-chat`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId: "default", content: outputText, workflowName: wf.name }),
          });
        } catch {}
      }

      json(res, { status: "completed", workflowName: wf.name, results, output: lastOutput });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  return false;
}

// ── Helper: resolve template string ──
function resolveTemplateStr(template, ctx) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const parts = key.trim().split(".");
    if (parts[0] === "workflow" && parts[1] === "input") return ctx.workflow.input[parts[2]] ?? `{{${key}}}`;
    if (parts[0] === "node" && parts[1]) {
      const nodeCtx = ctx.node[parts[1]];
      if (!nodeCtx) return `{{${key}}}`;
      if (parts[2] === "output") return typeof nodeCtx.output === "string" ? nodeCtx.output : JSON.stringify(nodeCtx.output);
      return nodeCtx[parts[2]] ?? `{{${key}}}`;
    }
    return `{{${key}}}`;
  });
}
