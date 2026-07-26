/**
 * Workflow routes — CRUD + execution + history + agentic workflow runner
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, extname } from "path";
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

// ── Skill Mini Loop ──
// 全 context 預載 + 只有 run_script 一個 tool + 無 turn 上限 + timeout 兜底
//
// 跟 Full Agent Loop 差別：
//   - 拿掉 read_file / bash / project_info 等探索工具
//   - 只有 run_script（python3 / node / bash）
//   - Context 全預載（SKILL.md + 整個目錄 + app context）
//   - 通常 1-3 turn 就 DONE

const SCRIPT_RUNNER_MAP = { ".py": "python3", ".js": "node", ".mjs": "node", ".sh": "bash", ".ts": "npx tsx" };
const SKIP_DIRS = new Set([".paaw", "node_modules", ".git", "__pycache__", ".cache"]);
const SKIP_FILES = new Set(["_cron_inputs.json", "Thumbs.db", ".DS_Store"]);

function scanSkillDir(skillRoot, base = "") {
  const results = [];
  const dir = base ? join(skillRoot, base) : skillRoot;
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    if (SKIP_FILES.has(entry)) continue;
    const rel = base ? `${base}/${entry}` : entry;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      results.push(...scanSkillDir(skillRoot, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

function runScript(skillDir, scriptRel, args = []) {
  const ext = extname(scriptRel).toLowerCase();
  const runner = SCRIPT_RUNNER_MAP[ext];
  if (!runner) return { ok: false, error: `Unknown script type: ${ext}` };
  const fullPath = resolve(skillDir, scriptRel);
  // 安全：script 必須在 skill 目錄內
  if (!fullPath.startsWith(resolve(skillDir))) {
    return { ok: false, error: "Script path escapes skill directory" };
  }
  if (!existsSync(fullPath)) {
    return { ok: false, error: `Script not found: ${scriptRel}` };
  }
  try {
    const output = execFileSync(runner.split(" ")[0], [...(runner.includes(" ") ? runner.split(" ").slice(1) : []), fullPath, ...args], {
      cwd: skillDir,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    return { ok: true, output: output || "(no output)" };
  } catch (err) {
    return { ok: false, error: err.stderr || err.stdout || err.message };
  }
}

const RUN_SCRIPT_TOOL = {
  type: "function",
  function: {
    name: "run_script",
    description: "執行 skill 目錄內的 script（python / node / bash）。用來取得真實資料或執行 deterministic step。每次只跑一個 script。",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "Script 相對路徑，例如 scripts/fetch.py" },
        args: { type: "array", items: { type: "string" }, description: "命令列參數", default: [] },
      },
      required: ["script"],
    },
  },
};

async function runSkillMiniLoop({ skillPath, input, appId, systemContext, model, timeoutMs = 180000, agentId = 'workflow' }) {
  const skillDir = resolve(skillPath, "..");
  const skillDirName = skillDir.split(/[\\/]/).pop();
  const startTime = Date.now();

  // ── 1. 讀 SKILL.md ──
  const raw = await readFile(skillPath, "utf-8");
  const { parseSkillFrontmatter } = await import("./context.mjs");
  const parsed = parseSkillFrontmatter(raw);
  let prompt = parsed.body || "";

  // Replace {{key}} placeholders
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) {
      prompt = prompt.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), typeof v === "string" ? v : JSON.stringify(v));
    }
  }

  // ── 2. 掃整個 skill 目錄，全部預載 ──
  const contextParts = [
    "你是 PAAW Skill 執行引擎。嚴格按照 Skill 定義處理，只輸出結果，不加解釋。",
    "",
    `━━━ Skill: ${parsed.meta?.id || skillDirName} ━━━`,
  ];
  if (parsed.meta && Object.keys(parsed.meta).length > 0) {
    contextParts.push(`Frontmatter:\n${JSON.stringify(parsed.meta, null, 2)}`);
  }

  const allFiles = scanSkillDir(skillDir);
  for (const rel of allFiles) {
    try {
      const content = readFileSync(join(skillDir, rel), "utf-8");
      const ext = extname(rel).toLowerCase().slice(1) || "";
      let icon = "📄";
      if (ext === "md") icon = "📖";
      else if (["js", "mjs", "ts", "tsx"].includes(ext)) icon = "📜";
      else if (ext === "json") icon = "⚙️";
      else if (ext === "py") icon = "🐍";
      else if (ext === "sh") icon = "🔧";
      const truncated = content.length > 50000 ? content.slice(0, 50000) + "\n... (truncated)" : content;
      contextParts.push(`--- ${icon} ${rel} ---\n${truncated}`);
    } catch {}
  }

  // ── 3. App context ──
  if (appId) {
    try {
      const appSystem = await readFile(join(PATHS.APPS_ROOT, appId, "SYSTEM.md"), "utf-8");
      contextParts.push(`--- App SYSTEM.md ---\n${appSystem}`);
    } catch {}
    const appKnowledgeDir = join(PATHS.APPS_ROOT, appId, "knowledge");
    if (existsSync(appKnowledgeDir)) {
      try {
        for (const f of readdirSync(appKnowledgeDir)) {
          if (f.endsWith(".md") || f.endsWith(".txt")) {
            const content = await readFile(join(appKnowledgeDir, f), "utf-8");
            contextParts.push(`--- App Knowledge: ${f} ---\n${content}`);
          }
        }
      } catch {}
    }
  }

  if (systemContext) contextParts.push(systemContext);
  contextParts.push("━━━ End of Context — 嚴格按照 SKILL.md 定義執行 ━━━");
  contextParts.push("");
  contextParts.push("你可以用 run_script tool 執行 skill 目錄內的 script 來取得真實資料。不需要探索檔案，所有內容已在 context 中。處理完畢直接輸出結果。");

  // ── 4. Resolve LLM ──
  const llm = resolveLLMConfig(PAAW_ROOT, model);
  if (!llm.apiUrl || !llm.model) {
    throw new Error("LLM not configured");
  }

  // ── 5. Mini Loop ──
  const messages = [
    { role: "system", content: contextParts.join("\n\n") },
    { role: "user", content: prompt },
  ];

  let turns = 0;
  let finalContent = "";

  while (true) {
    if (Date.now() - startTime > timeoutMs) {
      finalContent += "\n\n(⚠️ Skill 執行超時)";
      break;
    }

    turns++;
    const response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, [RUN_SCRIPT_TOOL], false, null, agentId);
    const choice = response.choices?.[0];
    if (!choice) break;

    const msg = choice.message;
    const toolCalls = msg.tool_calls || [];

    // 沒有 tool call = LLM 出結果了
    if (toolCalls.length === 0 || choice.finish_reason === "stop") {
      finalContent = msg.content || "";
      break;
    }

    // 有 tool call → 加 assistant message → 跑 script → 加 tool result → 繼續
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });

    for (const tc of toolCalls) {
      if (tc.function?.name === "run_script") {
        let parsedArgs;
        try { parsedArgs = JSON.parse(tc.function.arguments); } catch { parsedArgs = {}; }
        const result = runScript(skillDir, parsedArgs.script || "", parsedArgs.args || []);
        const resultText = result.ok ? result.output : `ERROR: ${result.error}`;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultText.slice(0, 50000),
        });
      } else {
        messages.push({ role: "tool", tool_call_id: tc.id, content: "Unknown tool" });
      }
    }
  }

  // ── 6. Clean output ──
  const clean = finalContent.replace(/\x1b\[[0-9;]*[mGKH]/g, "").trim();
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
        // Mini loop: all context pre-loaded + run_script tool, no turn cap
        const result = await runSkillMiniLoop({ skillPath, input, appId, model });
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

  // GET /api/paaw/tools — no external tool providers (removed)
  if (req.method === "GET" && path === "/api/paaw/tools") {
    json(res, { tools: [] });
    return true;
  }

  // POST /api/paaw/workflow-trigger — trigger a workflow by ID (for cron)
  if (req.method === "POST" && path === "/api/paaw/workflow-trigger") {
    try {
      const { workflowId, input, model } = JSON.parse(await readBody(req));
      if (!workflowId) { json(res, { error: "workflowId is required" }, 400); return true; }
      const wfModel = model || "deepseek/deepseek-v4-flash";

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
          output = await runSkillMiniLoop({ skillPath: skillPathResolved, input: ri, appId, model: wfModel });
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

  // ─────────────────────────────────────────────────────────
  // ── AGENTIC WORKFLOW ─────────────────────────────────────
  // ─────────────────────────────────────────────────────────

  // POST /api/paaw/agentic-workflow-run — run an agentic workflow
  if (req.method === "POST" && path === "/api/paaw/agentic-workflow-run") {
    try {
      const { workflowId, input } = JSON.parse(await readBody(req));
      if (!workflowId) { json(res, { error: "workflowId is required" }, 400); return true; }

      const wfPath = join(PATHS.WORKFLOWS_ROOT, `${workflowId}.json`);
      if (!existsSync(wfPath)) { json(res, { error: "Workflow not found" }, 404); return true; }

      const wf = JSON.parse(readFileSync(wfPath, "utf-8"));
      if (wf.mode !== "agentic") { json(res, { error: `Workflow mode is '${wf.mode}', expected 'agentic'` }, 400); return true; }

      const result = await runAgenticWorkflow(wf, input || {}, PAAW_ROOT);
      json(res, result);
    } catch (err) {
      console.error("[agentic-workflow] Error:", err);
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // POST /api/paaw/agentic-workflow-send-message — inject a user message into a chat (for demo: simulate replies)
  if (req.method === "POST" && path === "/api/paaw/agentic-workflow-send-message") {
    try {
      const { chatId, content, role = "user" } = JSON.parse(await readBody(req));
      if (!chatId || !content) { json(res, { error: "chatId and content are required" }, 400); return true; }

      const chatFile = join(PATHS.CHAT_DIR, `${chatId}.json`);
      let chat;
      try { chat = JSON.parse(await readFile(chatFile, "utf-8")); } catch {
        chat = { id: chatId, title: "Workflow 聊天", messages: [], createdAt: new Date().toISOString() };
      }
      chat.messages.push({ role, content, timestamp: new Date().toISOString() });
      chat.updatedAt = new Date().toISOString();
      await writeFile(chatFile, JSON.stringify(chat, null, 2), "utf-8");
      json(res, { ok: true });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/paaw/agentic-workflow-active — list currently running agentic workflows
  if (req.method === "GET" && path === "/api/paaw/agentic-workflow-active") {
    json(res, { active: Array.from(_activeAgenticWorkflows.values()) });
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────
// ── Agentic Workflow Runner ─────────────────────────────
// ─────────────────────────────────────────────────────────

/** Active agentic workflow runs (in-memory) */
const _activeAgenticWorkflows = new Map();

/**
 * Run an agentic workflow.
 * The workflow definition specifies:
 *   - goal: natural language description of what to achieve
 *   - tools: which tools the agent can use
 *   - rules: constraints / business rules
 *   - inputSchema: what inputs are expected
 *
 * The agent orchestrates the flow dynamically using LLM function calling.
 */
async function runAgenticWorkflow(wf, input, paawRoot) {
  const { resolveLLMConfig, callLLM } = await import("../lib/paaw-agent-loop.mjs");
  const llm = resolveLLMConfig(paawRoot, wf.config?.model || null);

  const runId = `aw-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const maxTurns = wf.config?.maxTurns || 15;
  const timeoutMs = (wf.config?.timeoutSeconds || 300) * 1000;

  // Build system prompt
  const systemParts = [
    `你是 PAAW Agentic Workflow 執行引擎。`,
    ``,
    `## 任務目標`,
    wf.goal || "按照使用者指示完成任務。",
    ``,
  ];

  if (wf.rules && wf.rules.length > 0) {
    systemParts.push(`## 規則`);
    for (const rule of wf.rules) systemParts.push(`- ${rule}`);
    systemParts.push(``);
  }

  if (wf.config?.systemContext) {
    systemParts.push(`## 額外 context`);
    systemParts.push(wf.config.systemContext);
    systemParts.push(``);
  }

  // Available tools
  const tools = _buildAgenticTools(wf.tools || ["chat_send", "chat_read", "wait", "finish"]);
  systemParts.push(`## 可用工具`);
  for (const t of tools) {
    systemParts.push(`- **${t.function.name}**: ${t.function.description}`);
  }
  systemParts.push(``);
  systemParts.push(`按照任務目標，使用工具一步步完成。每次只呼叫一個工具。`);
  systemParts.push(``);
  systemParts.push(`### 執行策略`);
  systemParts.push(`1. 一開始用 chat_send 發布資訊`);
  systemParts.push(`2. 用 wait 等待回覆（每次 30 秒）`);
  systemParts.push(`3. 用 chat_read 讀取新回覆`);
  systemParts.push(`4. 如果有問題，用 chat_reply 回覆`);
  systemParts.push(`5. 重複 wait → read 最多 3-4 輪`);
  systemParts.push(`6. 用 finish 結束並彙總`);
  systemParts.push(``);
  systemParts.push(`⚠️ 不要超過 4 輪 wait/read。收集到的訂單要在 finish 時彙總。`);

  // Build initial user message with input
  const inputDesc = JSON.stringify(input, null, 2);
  const messages = [
    { role: "system", content: systemParts.join("\n") },
    { role: "user", content: `輸入參數：\n${inputDesc}\n\n請開始執行任務。` },
  ];

  // Track state
  const state = {
    runId,
    workflowId: wf.id,
    workflowName: wf.name,
    status: "running",
    startedAt,
    turns: 0,
    toolCalls: [],
    chatMessages: {},  // chatId -> messages sent/read
    result: null,
  };
  _activeAgenticWorkflows.set(runId, state);

  console.log(`[agentic-workflow] START runId=${runId} workflow=${wf.id}`);

  try {
    const startTime = Date.now();

    for (let turn = 0; turn < maxTurns; turn++) {
      if (Date.now() - startTime > timeoutMs) {
        state.result = { summary: "⏱️ Workflow 超時結束", orders: [], details: state.toolCalls };
        break;
      }

      state.turns = turn + 1;
      const response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, tools, false, null, `agentic-${wf.id}`);
      const choice = response.choices?.[0];
      if (!choice) break;

      const msg = choice.message;
      const toolCalls = msg.tool_calls || [];

      // No tool call = agent is done (or thinking)
      if (toolCalls.length === 0 || choice.finish_reason === "stop") {
        state.result = { summary: msg.content || "完成", details: state.toolCalls };
        break;
      }

      // Add assistant message with tool calls
      messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });

      // Execute each tool call
      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

        console.log(`[agentic-workflow] turn=${turn + 1} tool=${tc.function.name} args=${JSON.stringify(args).slice(0, 200)}`);
        const toolResult = await _executeAgenticTool(tc.function.name, args, state, paawRoot);
        state.toolCalls.push({ tool: tc.function.name, args, result: toolResult });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
        });

        // If finish was called, extract result
        if (tc.function.name === "finish") {
          state.result = { summary: args.summary || "完成", details: state.toolCalls };
        }
      }

      if (state.result) break;
    }

    if (!state.result) {
      state.result = { summary: "達到最大輪數限制", details: state.toolCalls };
    }
  } catch (err) {
    state.status = "failed";
    state.result = { summary: `❌ 執行失敗: ${err.message}`, details: state.toolCalls };
  } finally {
    state.status = state.status === "failed" ? "failed" : "completed";
    state.completedAt = new Date().toISOString();
    _activeAgenticWorkflows.delete(runId);
  }

  console.log(`[agentic-workflow] END runId=${runId} status=${state.status} turns=${state.turns}`);

  // Write exec history
  try {
    const histDir = join(PATHS.WORKFLOWS_ROOT, "_exec-history");
    await mkdir(histDir, { recursive: true });
    const histFile = join(histDir, `${wf.id}.json`);
    let history = [];
    try { history = JSON.parse(await readFile(histFile, "utf-8")); } catch {}
    history.unshift({
      runId, workflowId: wf.id, workflowName: wf.name,
      status: state.status, startedAt, completedAt: state.completedAt,
      turns: state.turns, result: state.result,
    });
    if (history.length > 50) history = history.slice(0, 50);
    await writeFile(histFile, JSON.stringify(history, null, 2), "utf-8");
  } catch {}

  return {
    runId,
    workflowId: wf.id,
    workflowName: wf.name,
    status: state.status,
    turns: state.turns,
    startedAt,
    completedAt: state.completedAt,
    result: state.result,
    toolCalls: state.toolCalls,
  };
}

// ── Agentic Tool Definitions ──

function _buildAgenticTools(toolNames) {
  const allTools = {
    chat_send: {
      type: "function",
      function: {
        name: "chat_send",
        description: "發送訊息到指定的 PAAW 聊天視窗。訊息會顯示在該聊天的對話中。",
        parameters: {
          type: "object",
          properties: {
            chatId: { type: "string", description: "目標聊天視窗 ID（例如 crew member 的 chat ID）" },
            message: { type: "string", description: "要發送的訊息內容（支援 Markdown）" },
          },
          required: ["chatId", "message"],
        },
      },
    },
    chat_read: {
      type: "function",
      function: {
        name: "chat_read",
        description: "讀取指定聊天視窗的新回覆（自上次讀取後的訊息）。回傳 user 角色的回覆內容。",
        parameters: {
          type: "object",
          properties: {
            chatId: { type: "string", description: "聊天視窗 ID" },
          },
          required: ["chatId"],
        },
      },
    },
    chat_reply: {
      type: "function",
      function: {
        name: "chat_reply",
        description: "回覆使用者在聊天視窗中的問題。",
        parameters: {
          type: "object",
          properties: {
            chatId: { type: "string", description: "聊天視窗 ID" },
            message: { type: "string", description: "回覆內容" },
          },
          required: ["chatId", "message"],
        },
      },
    },
    wait: {
      type: "function",
      function: {
        name: "wait",
        description: "等待指定秒數（讓使用者有時間回覆）。預設 30 秒。",
        parameters: {
          type: "object",
          properties: {
            seconds: { type: "number", description: "等待秒數（最大 120）", default: 30 },
          },
        },
      },
    },
    finish: {
      type: "function",
      function: {
        name: "finish",
        description: "完成任務，回報最終結果。",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "任務完成的摘要報告" },
          },
          required: ["summary"],
        },
      },
    },
  };

  return toolNames.map(name => allTools[name]).filter(Boolean);
}

// ── Agentic Tool Execution ──

async function _executeAgenticTool(toolName, args, state, paawRoot) {
  switch (toolName) {
    case "chat_send":
    case "chat_reply": {
      const { chatId, message } = args;
      if (!chatId || !message) return { error: "chatId and message are required" };

      // Write to chat file
      const chatDir = PATHS.CHAT_DIR;
      await mkdir(chatDir, { recursive: true });
      const chatFile = join(chatDir, `${chatId}.json`);

      let chat;
      try { chat = JSON.parse(await readFile(chatFile, "utf-8")); } catch {
        chat = { id: chatId, title: "Workflow 訊息", messages: [], createdAt: new Date().toISOString() };
      }

      const role = toolName === "chat_reply" ? "assistant" : "assistant";
      const prefix = toolName === "chat_send" ? "🔌 **[Workflow]** " : "🔌 **[Workflow 回覆]** ";
      chat.messages.push({ role, content: prefix + message, timestamp: new Date().toISOString(), _workflow: true });
      chat.updatedAt = new Date().toISOString();
      await writeFile(chatFile, JSON.stringify(chat, null, 2), "utf-8");

      // Track in state
      if (!state.chatMessages[chatId]) state.chatMessages[chatId] = { sent: 0, lastReadIndex: chat.messages.length - 1 };
      state.chatMessages[chatId].sent++;
      state.chatMessages[chatId].lastReadIndex = chat.messages.length - 1;

      console.log(`[agentic-tool] chat_send → ${chatId}: ${message.slice(0, 100)}...`);
      return { ok: true, chatId, messageSent: message.slice(0, 200) };
    }

    case "chat_read": {
      const { chatId } = args;
      if (!chatId) return { error: "chatId is required" };

      const chatFile = join(PATHS.CHAT_DIR, `${chatId}.json`);
      if (!existsSync(chatFile)) return { replies: [], note: "聊天視窗不存在" };

      const chat = JSON.parse(readFileSync(chatFile, "utf-8"));
      const messages = chat.messages || [];

      // Find the last index we read
      const lastRead = state.chatMessages[chatId]?.lastReadIndex ?? -1;

      // Get new user messages (role=user, not from workflow)
      const newReplies = messages
        .map((m, i) => ({ ...m, _idx: i }))
        .filter(m => m._idx > lastRead && m.role === "user" && !m._workflow);

      // Update last read index
      if (!state.chatMessages[chatId]) state.chatMessages[chatId] = {};
      state.chatMessages[chatId].lastReadIndex = messages.length - 1;

      const replies = newReplies.map(m => ({ content: m.content, timestamp: m.timestamp }));
      console.log(`[agentic-tool] chat_read ← ${chatId}: ${replies.length} new replies`);
      return { replies, count: replies.length };
    }

    case "wait": {
      const seconds = Math.min(args.seconds || 30, 120);
      await new Promise(r => setTimeout(r, seconds * 1000));
      return { waited: seconds };
    }

    case "finish": {
      return { ok: true, finished: true, summary: args.summary };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ── Helper: resolve template string ──
function resolveTemplateStr(template, ctx) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    // workflow.input.xxx
    if (trimmed.startsWith("workflow.input.")) {
      const k = trimmed.slice("workflow.input.".length);
      return ctx.workflow.input[k] ?? `{{${key}}}`;
    }
    // node-X.output or node-X.output.field
    const nodeMatch = trimmed.match(/^(node-[\w-]+)\.output(\.(.+))?$/);
    if (nodeMatch) {
      const nodeId = nodeMatch[1];
      const nodeCtx = ctx.node[nodeId];
      if (!nodeCtx) return `{{${key}}}`;
      const out = nodeCtx.output;
      if (nodeMatch[3]) {
        // drill into a specific field
        const val = typeof out === "object" ? out?.[nodeMatch[3]] : undefined;
        return val !== undefined ? (typeof val === "string" ? val : JSON.stringify(val)) : `{{${key}}}`;
      }
      return typeof out === "string" ? out : JSON.stringify(out);
    }
    return `{{${key}}}`;
  });
}
