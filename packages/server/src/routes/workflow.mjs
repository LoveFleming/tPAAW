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
  // ── AGENTIC WORKFLOW (Async + Tool Provider) ─────────────
  // ─────────────────────────────────────────────────────────

  // POST /api/paaw/agentic-workflow-run — launch async agentic workflow
  if (req.method === "POST" && path === "/api/paaw/agentic-workflow-run") {
    try {
      const { workflowId, input } = JSON.parse(await readBody(req));
      if (!workflowId) { json(res, { error: "workflowId is required" }, 400); return true; }

      const wfPath = join(PATHS.WORKFLOWS_ROOT, `${workflowId}.json`);
      if (!existsSync(wfPath)) { json(res, { error: "Workflow not found" }, 404); return true; }

      const wf = JSON.parse(readFileSync(wfPath, "utf-8"));
      if (wf.mode !== "agentic") { json(res, { error: `Workflow mode is '${wf.mode}', expected 'agentic'` }, 400); return true; }

      // Launch async — return runId immediately
      const runId = await launchAgenticWorkflow(wf, input || {}, PAAW_ROOT);
      json(res, { runId, workflowId: wf.id, status: "running", message: "Workflow launched. Poll /agentic-workflow-status/" + runId });
    } catch (err) {
      console.error("[agentic-workflow] Launch error:", err);
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/paaw/agentic-workflow-status/{runId} — poll workflow status
  if (req.method === "GET" && path.startsWith("/api/paaw/agentic-workflow-status/")) {
    const runId = path.split("/api/paaw/agentic-workflow-status/")[1];
    const state = _activeAgenticWorkflows.get(runId);
    if (!state) { json(res, { error: "Run not found", runId }, 404); return true; }
    json(res, state);
    return true;
  }

  // GET /api/paaw/agentic-workflow-active — list all active runs
  if (req.method === "GET" && path === "/api/paaw/agentic-workflow-active") {
    const runs = Array.from(_activeAgenticWorkflows.values()).map(s => ({
      runId: s.runId, workflowId: s.workflowId, workflowName: s.workflowName,
      status: s.status, turns: s.turns, toolCallCount: s.toolCalls.length,
      startedAt: s.startedAt, lastTool: s.toolCalls.at(-1)?.tool || null,
    }));
    json(res, { active: runs, count: runs.length });
    return true;
  }

  // POST /api/paaw/agentic-workflow-send-message — inject a user message into a chat
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

  // GET /api/paaw/tool-providers — list registered tool providers
  if (req.method === "GET" && path === "/api/paaw/tool-providers") {
    const { listProviders } = await import("../lib/tool-provider.mjs");
    json(res, { providers: listProviders() });
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────
// ── Agentic Workflow Runner (Async) ──────────────────────
// ─────────────────────────────────────────────────────────

/** Active + completed agentic workflow runs (in-memory, recent) */
const _activeAgenticWorkflows = new Map();

/** Launch an agentic workflow — returns runId immediately */
async function launchAgenticWorkflow(wf, input, paawRoot) {
  const { loadToolProviders, getToolDefinitions, executeToolCall } = await import("../lib/tool-provider.mjs");

  // Ensure providers are loaded
  await loadToolProviders(join(paawRoot, "data", "tools"));

  const runId = `aw-${Date.now()}`;
  const startedAt = new Date().toISOString();

  const state = {
    runId,
    workflowId: wf.id,
    workflowName: wf.name,
    status: "running",
    startedAt,
    turns: 0,
    toolCalls: [],
    result: null,
    completedAt: null,
  };
  _activeAgenticWorkflows.set(runId, state);

  // Fire and forget — runs in background
  _runAgenticLoop(runId, wf, input, paawRoot, state, { getToolDefinitions, executeToolCall }).catch(err => {
    state.status = "failed";
    state.result = { summary: `❌ ${err.message}`, details: state.toolCalls };
    state.completedAt = new Date().toISOString();
    console.error(`[agentic-workflow] CRASH runId=${runId}:`, err);
  });

  console.log(`[agentic-workflow] LAUNCHED runId=${runId} workflow=${wf.id}`);
  return runId;
}

/** Inner loop — runs in background */
async function _runAgenticLoop(runId, wf, input, paawRoot, state, toolRegistry) {
  const { resolveLLMConfig, callLLM } = await import("../lib/paaw-agent-loop.mjs");
  const { getToolDefinitions, executeToolCall } = toolRegistry;

  const llm = resolveLLMConfig(paawRoot, wf.config?.model || null);
  const maxTurns = wf.config?.maxTurns || 20;
  const timeoutMs = (wf.config?.timeoutSeconds || 600) * 1000;

  // ── Build system prompt with preloaded skill context ──
  const systemParts = [
    `你是 PAAW Agentic Workflow 執行引擎。`,
    ``,
    `## 任務目標`,
    wf.goal || "按照使用者指示完成任務。",``,
  ];

  // Preload skill context if workflow references skills
  if (wf.config?.preloadSkills?.length > 0) {
    systemParts.push(`## 技能知識（Preloaded Skill Context）`);
    for (const skillRef of wf.config.preloadSkills) {
      const [appId, skillId] = skillRef.split("/");
      try {
        const skillPath = join(paawRoot, "data", "skills", appId, `${skillId}.md`);
        if (existsSync(skillPath)) {
          const skillContent = readFileSync(skillPath, "utf-8");
          systemParts.push(`### ${skillRef}`);
          systemParts.push(skillContent.slice(0, 2000));  // cap at 2000 chars per skill
          systemParts.push(``);
        }
      } catch {}
    }
  }

  if (wf.rules?.length > 0) {
    systemParts.push(`## 規則`);
    for (const rule of wf.rules) systemParts.push(`- ${rule}`);
    systemParts.push(``);
  }

  if (wf.config?.systemContext) {
    systemParts.push(`## 額外 context`);
    systemParts.push(wf.config.systemContext);
    systemParts.push(``);
  }

  // ── Resolve tools from Tool Provider Registry ──
  const requestedTools = wf.tools || [];
  const tools = getToolDefinitions(requestedTools);

  systemParts.push(`## 可用工具`);
  for (const t of tools) {
    systemParts.push(`- **${t.function.name}**: ${t.function.description}`);
  }
  systemParts.push(``);
  systemParts.push(`### 執行策略`);
  systemParts.push(`1. 用 send 工具發布資訊到目標聊天室`);
  systemParts.push(`2. 用 wait 等待回覆（每次 30 秒）`);
  systemParts.push(`3. 用 read 工具讀取新回覆`);
  systemParts.push(`4. 有問題就用 reply 回覆`);
  systemParts.push(`5. 重複 wait → read 最多 3-4 輪`);
  systemParts.push(`6. 用 finish 結束並彙總`);
  systemParts.push(``);
  systemParts.push(`⚠️ 不要超過 4 輪 wait/read。`);

  const inputDesc = JSON.stringify(input, null, 2);
  const messages = [
    { role: "system", content: systemParts.join("\n") },
    { role: "user", content: `輸入參數：\n${inputDesc}\n\n請開始執行任務。` },
  ];

  console.log(`[agentic-workflow] START runId=${runId} workflow=${wf.id} tools=${tools.map(t => t.function.name).join(",")}`);

  const startTime = Date.now();
  const execContext = { paawRoot, chatDir: join(paawRoot, "data", "chats") };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (Date.now() - startTime > timeoutMs) {
      state.result = { summary: "⏱️ Workflow 超時結束", details: state.toolCalls };
      break;
    }

    state.turns = turn + 1;
    const response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, tools, false, null, `agentic-${wf.id}`);
    const choice = response.choices?.[0];
    if (!choice) break;

    const msg = choice.message;
    const toolCalls = msg.tool_calls || [];

    if (toolCalls.length === 0 || choice.finish_reason === "stop") {
      state.result = { summary: msg.content || "完成", details: state.toolCalls };
      break;
    }

    messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });

    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

      console.log(`[agentic-workflow] turn=${turn + 1} tool=${tc.function.name} args=${JSON.stringify(args).slice(0, 200)}`);

      // Execute via Tool Provider Registry
      const toolResult = await executeToolCall(tc.function.name, args, execContext);
      state.toolCalls.push({ tool: tc.function.name, args, result: toolResult, turn: turn + 1, timestamp: new Date().toISOString() });

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
      });

      if (tc.function.name === "finish") {
        state.result = { summary: args.summary || "完成", details: state.toolCalls };
      }
    }

    if (state.result) break;
  }

  if (!state.result) {
    state.result = { summary: "達到最大輪數限制", details: state.toolCalls };
  }

  state.status = "completed";
  state.completedAt = new Date().toISOString();
  console.log(`[agentic-workflow] END runId=${runId} status=completed turns=${state.turns}`);

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

  // Keep in memory for 5 minutes after completion for polling
  setTimeout(() => _activeAgenticWorkflows.delete(runId), 5 * 60 * 1000);
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
