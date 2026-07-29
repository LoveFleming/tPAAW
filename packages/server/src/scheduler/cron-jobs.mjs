/**
 * Cron Job Scheduler + Agent Loop API + Vibe Sessions API
 * Routes: /api/cron-jobs/*, /api/cron-result, /api/agent-run,
 *         /api/agent-run/stream, /api/vibe-sessions/*
 */

import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, statSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import {
  PAAW_ROOT, CRON_JOBS_FILE, CRON_LOGS_DIR, CRON_RESULTS_DIR, CRON_CHAT_DIR,
  VIBE_SESSIONS_DIR, readBody, PORT,
} from "../routes/shared.mjs";
import { runAgentLoop, runAgentLoopStream } from "../lib/paaw-agent-loop.mjs";
import { callLLMWithRetry, isMeaningfulContent } from "../lib/llm-utils.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";

// Lazy-load distill module
let _distillMod = null;
async function getDistillModule() {
  if (!_distillMod) { try { _distillMod = await import("../routes/distill.mjs"); } catch { _distillMod = {}; } }
  return _distillMod;
}

// ── Cron expression parser ──
function matchesCron(expr, date) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mMin, mHour, mDay, mMon, mDow] = parts;

  const check = (val, spec) => {
    if (spec === "*") return true;
    for (const s of spec.split(",")) {
      if (s.includes("/")) {
        const [range, stepStr] = s.split("/");
        const step = parseInt(stepStr);
        if (!(step > 0)) continue;
        let lo, hi;
        if (range === "*") { lo = 0; hi = 59; }
        else if (range.includes("-")) { [lo, hi] = range.split("-").map(Number); }
        else { lo = 0; hi = parseInt(range); }
        if (val >= lo && val <= hi && (val - lo) % step === 0) return true;
        continue;
      }
      if (s.includes("-")) {
        const [lo, hi] = s.split("-").map(Number);
        if (val >= lo && val <= hi) return true;
        continue;
      }
      if (parseInt(s) === val) return true;
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

  // ── Deliver result to a chat session ──
  async function deliverToChat(chatId, content) {
    const chatPath = resolve(CRON_CHAT_DIR, chatId.endsWith(".json") ? chatId : `${chatId}.json`);
    try {
      let chat;
      try { chat = JSON.parse(await readFile(chatPath, "utf-8")); } catch { return false; }
      chat.messages = chat.messages || [];
      chat.messages.push({
        role: "assistant",
        content,
        timestamp: new Date().toISOString(),
      });
      chat.updatedAt = new Date().toISOString();
      await writeFile(chatPath, JSON.stringify(chat, null, 2), "utf-8");
      console.log(`[cron] Delivered to chat: ${chatId}`);
      return true;
    } catch (err) {
      console.error(`[cron] Failed to deliver to chat ${chatId}:`, err.message);
      return false;
    }
  }

  // ── System Backup type ──
  if (job._systemBackup) {
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/backup/run`, { method: "POST" });
      const data = await resp.json();
      if (data.ok) {
        console.log(`[cron] System backup done: ${data.backup?.filename} (${(data.backup?.size / 1024 / 1024).toFixed(1)} MB)`);
        await appendCronLog(job.id, { runId, status: "done", result: data.backup?.filename });
      } else {
        console.error(`[cron] System backup failed:`, data.error);
        await appendCronLog(job.id, { runId, status: "error", error: data.error });
      }
    } catch (err) {
      console.error(`[cron] System backup error:`, err.message);
      await appendCronLog(job.id, { runId, status: "error", error: err.message });
    }
    job.lastRun = new Date().toISOString();
    job.lastStatus = "done";
    await saveCronJobs(await loadCronJobs().then(jobs => jobs.map(j => j.id === job.id ? job : j)));
    return;
  }

  // ── System Log Purge type ──
  if (job._systemLogPurge) {
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/llm-logs/purge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 7 }),
      });
      const data = await resp.json();
      console.log(`[cron] Log purge done: deleted ${data.deleted} files (${data.retentionDays}-day retention)`);
      await appendCronLog(job.id, { runId, status: "done", result: `deleted ${data.deleted}` });
    } catch (err) {
      console.error(`[cron] Log purge error:`, err.message);
      await appendCronLog(job.id, { runId, status: "error", error: err.message });
    }
    job.lastRun = new Date().toISOString();
    job.lastStatus = "done";
    await saveCronJobs(await loadCronJobs().then(jobs => jobs.map(j => j.id === job.id ? job : j)));
    return;
  }

  // ── Reminder type ──
  if (job.type === "reminder") {
    const reminderContent = `⏰ **提醒**：${job.reminderText || job.name}`;
    try {
      const target = job.outputTarget || "chat";
      if (target === "path" && job.outputPath) {
        const outputDir = resolve(job.outputPath);
        await mkdir(outputDir, { recursive: true });
        const outFile = join(outputDir, `reminder-${runTs}.md`);
        await writeFile(outFile, `# ${job.name}\n\n${reminderContent}\n\n_${new Date().toISOString()}_`, "utf-8");
        console.log(`[cron] Reminder saved to: ${outFile}`);
      } else if (job.chatId) {
        // Deliver to specific chat
        const ok = await deliverToChat(job.chatId, reminderContent);
        if (!ok) console.log(`[cron] Reminder chat not found: ${job.chatId}`);
      } else {
        // Legacy: deliver to latest chat
        const files = await readdir(CRON_CHAT_DIR);
        const chatFiles = files.filter(f => f.endsWith(".json"));
        let latestChat = null;
        let latestPath = null;
        let latestTime = "";
        for (const f of chatFiles) {
          try {
            const p = resolve(CRON_CHAT_DIR, f);
            const raw = JSON.parse(await readFile(p, "utf-8"));
            const t = raw.updatedAt || raw.createdAt || "";
            if (t > latestTime) { latestTime = t; latestChat = raw; latestPath = p; }
          } catch {}
        }
        if (latestChat && latestPath) {
          latestChat.messages.push({
            role: "assistant",
            content: reminderContent,
            timestamp: new Date().toISOString(),
          });
          latestChat.updatedAt = new Date().toISOString();
          await writeFile(latestPath, JSON.stringify(latestChat, null, 2), "utf-8");
          console.log(`[cron] Reminder delivered to chat: ${latestPath}`);
        } else {
          console.log(`[cron] No chat found to deliver reminder`);
        }
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

  // ── Report type: run via PAAW Agent Loop ──
  try {
    const skillId = job.skillId || job.reportAppId;
    const skillDir = resolve(PAAW_ROOT, "data/skills/physical-skill", skillId);
    console.log(`[cron] Skill ${skillId}: workDir=${skillDir}`);

    let skillMd = "";
    try { skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8"); skillMd = skillMd.replace(/\{\{PAAW_ROOT\}\}/g, PAAW_ROOT); } catch {}

    const inputsFileName = "_cron_inputs.json";
    if (job.params && Object.keys(job.params).length > 0) {
      await writeFile(join(skillDir, inputsFileName), JSON.stringify(job.params, null, 2), "utf-8");
    }
    const prompt = `Please use skill ${skillId} with user inputs from ${inputsFileName}`;

    console.log(`[cron] Skill ${skillId}: running via PAAW Agent Loop`);

    const { loadAgentConfig } = await import("../routes/context.mjs");
    const agentCfg = await loadAgentConfig();

    // Build full system context via context-engine
    let cronSystemPrompt = "";
    try {
      const { contextEngine } = await import("../context-engine.mjs");
      const ctx = await contextEngine.build({ target: "skill-exec", skillId, skillPath: join(skillDir, "SKILL.md") });
      cronSystemPrompt = ctx.systemPrompt || "";
    } catch {}

    const result = await runAgentLoop({
      prompt, cwd: skillDir, skillMd, systemPrompt: cronSystemPrompt,
      maxTurns: agentCfg.maxTurns, timeout: agentCfg.timeoutSeconds, params: job.params || {},
      rootDir: PAAW_ROOT, agentId: `cron:${job.id}`,
    });

    const output = result.content || "";

    const resultDir = join(CRON_RESULTS_DIR, job.id);
    await mkdir(resultDir, { recursive: true });

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
    await writeFile(join(resultDir, `${runTs}.txt`), output, "utf-8");

    // ── Deliver to chat if chatId specified ──
    if (job.chatId) {
      const summary = output.length > 2000
        ? output.slice(0, 1000) + "\n\n... (結果已截斷，完整內容請見 cron output) ..." + output.slice(-500)
        : output;
      await deliverToChat(job.chatId, `📊 **${job.name}** 執行完成\n\n${summary}`);
    }

    await appendCronLog(job.id, { runId, status: result.success ? "done" : "error", outputLength: output.length, hasHtml, resultFile: `${runTs}.${hasHtml ? "html" : "txt"}`, turns: result.turns, via: "paaw-agent-loop" });

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

// ── Cron scheduler (check every 60s) ──
const lastCronMin = { min: -1 };
setInterval(async () => {
  const now = new Date();
  if (now.getMinutes() === lastCronMin.min) return;
  lastCronMin.min = now.getMinutes();
  try {
    const jobs = await loadCronJobs();
    for (const job of jobs) {
      if (!job.enabled) continue;
      if (matchesCron(job.schedule, now)) {
        runCronJob(job).catch(() => {});
      }
    }
  } catch {}
}, 30_000);

console.log("[cron] Scheduler started, checking every 60s");

// ── Auto-distill scheduler ──
const lastDistillDate = { date: "" };
setInterval(async () => {
  try {
    const mod = await getDistillModule();
    const config = mod.loadConfig ? mod.loadConfig() : null;
    if (!config?.enabled || !config?.autoDistill) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    if (mod.matchesCron && mod.matchesCron(config.autoDistillSchedule, now) && lastDistillDate.date !== dateStr) {
      lastDistillDate.date = dateStr;
      console.log(`[distill] Running auto-distill for ${dateStr}`);
      mod.distillAll().catch(err => console.error("[distill] Error:", err.message));
    }
  } catch {}
}, 60_000);
console.log("[distill] Auto-distill scheduler started");

// ── Cron API Handler ──
async function cronApiHandler(req, res) {
  const _readBody = () => new Promise((ok, fail) => {
    let d = "";
    req.on("data", c => d += c);
    req.on("end", () => { try { ok(JSON.parse(d)); } catch { fail(new Error("Invalid JSON")); } });
    req.on("error", fail);
  });

  // GET /api/cron-jobs
  if (req.method === "GET" && req.url?.match(/^\/api\/cron-jobs(?:\?.*)?$/)) {
    const jobs = await loadCronJobs();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jobs));
    return true;
  }
  // POST /api/cron-jobs
  if (req.method === "POST" && req.url === "/api/cron-jobs") {
    let parsed;
    try { parsed = await _readBody(); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const jobs = await loadCronJobs();
    const job = {
      id: parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `cron-${Date.now()}`,
      name: parsed.name,
      type: parsed.type || "report",
      reminderText: parsed.reminderText || "",
      skillId: parsed.skillId || parsed.reportAppId || "",
      schedule: parsed.schedule || "0 * * * *",
      prompt: parsed.prompt || "",
      params: parsed.params || {},
      outputTarget: parsed.outputTarget || "chat",
      outputPath: parsed.outputPath || "",
      chatId: parsed.chatId || "", // Deliver result to specific chat session (e.g. "rainy-afternoon-tea")
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
    let patch;
    try { patch = await _readBody(); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const jobs = await loadCronJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx < 0) { res.writeHead(404); res.end("Not found"); return true; }
    if (patch.enabled !== undefined) jobs[idx].enabled = patch.enabled;
    if (patch.schedule) jobs[idx].schedule = patch.schedule;
    if (patch.name) jobs[idx].name = patch.name;
    if (patch.type) jobs[idx].type = patch.type;
    if (patch.reminderText !== undefined) jobs[idx].reminderText = patch.reminderText;
    if (patch.skillId !== undefined) jobs[idx].skillId = patch.skillId;
    if (patch.prompt !== undefined) jobs[idx].prompt = patch.prompt;
    if (patch.params) jobs[idx].params = patch.params;
    if (patch.reportAppId) jobs[idx].reportAppId = patch.reportAppId;
    if (patch.outputTarget !== undefined) jobs[idx].outputTarget = patch.outputTarget;
    if (patch.outputPath !== undefined) jobs[idx].outputPath = patch.outputPath;
    if (patch.chatId !== undefined) jobs[idx].chatId = patch.chatId;
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
  // GET /api/cron-jobs/:id/results
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
  // GET /api/cron-result?path=...
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
  // POST /api/cron-jobs/:id/run
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

  // GET /api/chats — list chat sessions (for chat picker)
  if (req.method === "GET" && req.url?.match(/^\/api\/chats(?:\?.*)?$/)) {
    const files = await readdir(CRON_CHAT_DIR).catch(() => []);
    const chats = [];
    for (const f of files.filter(f => f.endsWith(".json"))) {
      try {
        const raw = JSON.parse(await readFile(resolve(CRON_CHAT_DIR, f), "utf-8"));
        chats.push({
          id: raw.id || f.replace(".json", ""),
          title: raw.title || raw.messages?.[0]?.content?.slice(0, 40) || f,
          updatedAt: raw.updatedAt || raw.createdAt || "",
          messageCount: raw.messages?.length || 0,
        });
      } catch {}
    }
    chats.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(chats));
    return true;
  }

  return false;
}

// ── Agent Loop API Handler ──
async function agentLoopHandler(req, res) {
  const _readBody = () => new Promise((ok, fail) => {
    let d = "";
    req.on("data", c => d += c);
    req.on("end", () => ok(d));
    req.on("error", fail);
  });

  // POST /api/agent-run
  if (req.method === "POST" && req.url === "/api/agent-run") {
    let body;
    try { body = JSON.parse(await _readBody()); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return true; }

    const { prompt, cwd, skillId, systemPrompt, model, maxTurns, timeout, params } = body;
    if (!prompt) { res.writeHead(400); res.end(JSON.stringify({ error: "prompt is required" })); return true; }

    const { loadAgentConfig } = await import("../routes/context.mjs");
    const agentCfg = await loadAgentConfig();

    const workDir = cwd || resolve(PAAW_ROOT, "data", "cron-output", `${Date.now()}`);
    try { mkdirSync(workDir, { recursive: true }); } catch {}
    let skillMd = "";
    let autoSystemPrompt = systemPrompt;
    if (skillId) {
      const skillPath = resolve(PAAW_ROOT, "data/skills/physical-skill", skillId, "SKILL.md");
      try { skillMd = await readFile(skillPath, "utf-8"); skillMd = skillMd.replace(/\{\{PAAW_ROOT\}\}/g, PAAW_ROOT); } catch {}
    }

    // If no systemPrompt provided, build full system context via context-engine
    if (!autoSystemPrompt) {
      try {
        const { contextEngine } = await import("../context-engine.mjs");
        const target = skillId ? "skill-exec" : "chat";
        const ctx = await contextEngine.build({ target, skillId, skillPath: skillMd });
        autoSystemPrompt = ctx.systemPrompt || "";
      } catch {}
    }

    try {
      const result = await runAgentLoop({
        prompt, cwd: workDir, skillMd, systemPrompt: autoSystemPrompt, model,
        maxTurns: maxTurns || agentCfg.maxTurns, timeout: timeout || agentCfg.timeoutSeconds, params, rootDir: PAAW_ROOT, agentId: `cron:${job.id}`,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return true;
  }

  // POST /api/agent-run/stream
  if (req.method === "POST" && req.url === "/api/agent-run/stream") {
    let body;
    try { body = JSON.parse(await _readBody()); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }

    const { prompt, cwd, skillId, systemPrompt, model, maxTurns, timeout, params } = body;
    if (!prompt) { res.writeHead(400); res.end("prompt is required"); return true; }

    const { loadAgentConfig } = await import("../routes/context.mjs");
    const agentCfg = await loadAgentConfig();

    const workDir = cwd || resolve(PAAW_ROOT, "data", "cron-output", `${Date.now()}`);
    try { mkdirSync(workDir, { recursive: true }); } catch {}
    let skillMd = "";
    let autoSystemPrompt = systemPrompt;
    if (skillId) {
      const skillPath = resolve(PAAW_ROOT, "data/skills/physical-skill", skillId, "SKILL.md");
      try { skillMd = await readFile(skillPath, "utf-8"); skillMd = skillMd.replace(/\{\{PAAW_ROOT\}\}/g, PAAW_ROOT); } catch {}
    }

    // If no systemPrompt provided, build full system context
    if (!autoSystemPrompt) {
      try {
        const { contextEngine } = await import("../context-engine.mjs");
        const target = skillId ? "skill-exec" : "chat";
        const ctx = await contextEngine.build({ target, skillId, skillPath: skillMd });
        autoSystemPrompt = ctx.systemPrompt || "";
      } catch {}
    }

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });

    try {
      await runAgentLoopStream({
        prompt, cwd: workDir, skillMd, systemPrompt: autoSystemPrompt, model,
        maxTurns: maxTurns || agentCfg.maxTurns, timeout: timeout || agentCfg.timeoutSeconds, params, rootDir: PAAW_ROOT, agentId: `cron:${job.id}`,
      }, res);
    } catch (err) {
      try { res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`); } catch {}
    }
    try { res.end(); } catch {}
    return true;
  }

  return false;
}

// ── Vibe Sessions API Handler ──
async function vibeSessionsApiHandler(req, res) {
  const url = req.url || "";

  // GET /api/vibe-sessions
  if (req.method === "GET" && url.match(/^\/api\/vibe-sessions(?:\?.*)?$/)) {
    try {
      mkdirSync(VIBE_SESSIONS_DIR, { recursive: true });
      const files = readdirSync(VIBE_SESSIONS_DIR).filter(f => f.endsWith(".json"));
      const sessions = [];
      for (const f of files) {
        try {
          const meta = JSON.parse(readFileSync(resolve(VIBE_SESSIONS_DIR, f), "utf8"));
          const logFile = resolve(VIBE_SESSIONS_DIR, f.replace(".json", ".log"));
          let logSize = 0;
          try { logSize = statSync(logFile).size; } catch {}
          sessions.push({ ...meta, logSize });
        } catch {}
      }
      sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/vibe-sessions/:id/log
  const logMatch = url.match(/^\/api\/vibe-sessions\/([\w.-]+)\/log(?:\?.*)?$/);
  if (req.method === "GET" && logMatch) {
    try {
      const id = logMatch[1];
      const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
      if (!existsSync(logPath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Log not found" }));
        return true;
      }
      const content = readFileSync(logPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/vibe-sessions/:id
  const oneMatch = url.match(/^\/api\/vibe-sessions\/([\w.-]+)(?:\?.*)?$/);
  if (req.method === "GET" && oneMatch) {
    try {
      const id = oneMatch[1];
      const metaPath = resolve(VIBE_SESSIONS_DIR, `${id}.json`);
      if (!existsSync(metaPath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return true;
      }
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
      try { meta.logSize = statSync(logPath).size; } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(meta));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/vibe-sessions/:id/distill
  const distillMatch = url.match(/^\/api\/vibe-sessions\/([\w.-]+)\/distill(?:\?.*)?$/);
  if (req.method === "POST" && distillMatch) {
    try {
      const id = distillMatch[1];
      const metaPath = resolve(VIBE_SESSIONS_DIR, `${id}.json`);
      const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
      if (!existsSync(metaPath) || !existsSync(logPath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return true;
      }

      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      let logContent = readFileSync(logPath, "utf8");
      if (logContent.length > 30000) {
        logContent = "... (前半省略) ...\n\n" + logContent.slice(-30000);
      }

      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}

      const distillPrompt = body.prompt || `你是程式開發知識蒸餾器。請分析以下 AI CLI coding session 的完整 log，精煉出：

1. **任務摘要**：做了什麼、為什麼做
2. **關鍵決策**：選擇了什麼方案、為什麼
3. **技術要點**：用到的技術、工具、技巧
4. **遇到的問題與解法**：bug、error、如何解決
5. **產出的成果**：建立了哪些檔案、功能
6. **可復用的模式**：值得記住的模式、最佳實踐

請用 Markdown 格式輸出，簡潔但有價值。這個摘要會存入知識庫供未來參考。`;

      const fullPrompt = `${distillPrompt}\n\n---\nSession: ${meta.cli} | CWD: ${meta.cwd} | Mode: ${meta.approvalMode}\nDate: ${meta.createdAt}\n\n<log>\n${logContent}\n</log>`;

      let distilled = null;
      try {
        const providerConfig = JSON.parse(readFileSync(resolve(PAAW_ROOT, "data/config/providers.json"), "utf8"));
        const providerId = providerConfig.active;
        const provider = providerConfig.providers[providerId];
        if (provider?.apiKey && provider.apiKey !== "na") {
          const model = resolveDefaultModel(providerConfig);
          const apiUrl = `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;
          const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
            ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
          };
          const reqBody = {
            model,
            messages: [
              { role: "system", content: distillPrompt },
              { role: "user", content: fullPrompt },
            ],
            max_tokens: 4096,
          };
          const result = await callLLMWithRetry(apiUrl, headers, reqBody, {
            maxRetries: 3,
            timeoutMs: 300_000,
            validateContent: true,
            sanitize: true,
            caller: "cron-distill",
            agentId: "cron",
          });
          distilled = isMeaningfulContent(result.content) ? result.content : null;
        }
      } catch (err) {
        console.error(`[cron-jobs] LLM distill call failed after retries: ${err.message}`);
      }

      if (!distilled || distilled.length < 50) {
        distilled = `# Coding Session 摘要\n\n**Session:** ${meta.id}\n**CLI:** ${meta.cli}\n**工作目錄:** ${meta.cwd}\n**時間:** ${meta.createdAt}\n\n> ⚠️ 自動蒸餾失敗，原始 log 已保存。你可以手動貼到 AI 做摘要。\n\n---\n\n${logContent.slice(0, 5000)}${logContent.length > 5000 ? "\n\n... (截斷)" : ""}`;
      }

      const knowledgeDir = resolve(PAAW_ROOT, "knowledge/vibe-sessions");
      mkdirSync(knowledgeDir, { recursive: true });
      const dateStr = meta.createdAt.replace(/[:.]/g, "-").slice(0, 19);
      const distillFile = resolve(knowledgeDir, `${dateStr}-${meta.cli}-session.md`);
      const md = `# Coding Session 摘要\n\n**Session ID:** ${meta.id}\n**CLI:** ${meta.cli} ${meta.model ? "(" + meta.model + ")" : ""}\n**工作目錄:** ${meta.cwd}\n**執行模式:** ${meta.approvalMode}\n**時間:** ${meta.createdAt}\n\n---\n\n${distilled}\n\n---\n*蒸餾時間: ${new Date().toISOString()}*`;
      writeFileSync(distillFile, md);

      meta.distilled = true;
      meta.distillFile = distillFile;
      meta.distilledAt = new Date().toISOString();
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, file: distillFile, content: md }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/vibe-sessions/:id
  const delMatch = url.match(/^\/api\/vibe-sessions\/([\w.-]+)(?:\?.*)?$/);
  if (req.method === "DELETE" && delMatch) {
    try {
      const id = delMatch[1];
      const metaPath = resolve(VIBE_SESSIONS_DIR, `${id}.json`);
      const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
      try { unlinkSync(metaPath); } catch {}
      try { unlinkSync(logPath); } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

// ── Combined default export: try cron → agent loop → vibe sessions ──
export default async function schedulerRoute(req, res) {
  if (await cronApiHandler(req, res)) return true;
  if (await agentLoopHandler(req, res)) return true;
  if (await vibeSessionsApiHandler(req, res)) return true;
  return false;
}
