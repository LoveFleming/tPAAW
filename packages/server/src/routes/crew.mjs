/**
 * Crew CRUD, Conversations, Saved Inputs, Work Log, Skill Test, CLI Run,
 * File Browser / Tree, Factory Content, Project Dashboard, FS Watch SSE
 */

import { readdir, readFile, writeFile, mkdir, unlink, rm, stat } from "fs/promises";
import { existsSync } from "fs";
import {
  join, resolve, dirname,
} from "path";
import {
  PAAW_ROOT, CONVERSATIONS_ROOT, CREWS_ROOT, DOCS_ROOT,
  projectPathHash, getConvDir, readBody, factoryDir, getFactoryId, buildTree, startWatcher,
} from "./shared.mjs";
import { runAgentLoop } from "../lib/paaw-agent-loop.mjs";

export default async function crewRoute(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // ── GET /api/paaw/skill-config ──
  if (req.method === "GET" && path === "/api/paaw/skill-config") {
    try {
      const filePath = resolve(PAAW_ROOT, "data/data", "skill-config.json");
      const data = await readFile(filePath, "utf-8").catch(() => null);
      const config = data ? JSON.parse(data) : { testTimeout: 600, maxToolCalls: 50 };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(config));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ testTimeout: 600, maxToolCalls: 50 }));
    }
    return true;
  }

  // ── POST /api/paaw/skill-config ──
  if (req.method === "POST" && path === "/api/paaw/skill-config") {
    try {
      const body = JSON.parse(await readBody(req));
      await writeFile(resolve(PAAW_ROOT, "data/data", "skill-config.json"), JSON.stringify(body, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── POST /api/skill-test/run — PAAW Agent Loop test ──
  if (req.method === "POST" && req.url === "/api/skill-test/run") {
    const body = JSON.parse(await readBody(req));
    const { skillId, prompt, cwd, timeout = 120, maxToolCalls = 10 } = body;
    const relTestDir = `data/skills/building/${skillId || "unknown"}/test-output`;
    const testDir = resolve(PAAW_ROOT, relTestDir);
    try { await rm(testDir, { recursive: true, force: true }); } catch {}
    await mkdir(testDir, { recursive: true });

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    const sendEvent = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };

    const hasOutputPath = /輸出路徑|output_path|輸出目錄|請將.*輸出/i.test(prompt);
    const fullPrompt = hasOutputPath
      ? prompt
      : `${prompt}\n\n### 輸出目錄\n請將所有輸出檔案放到這個目錄：${relTestDir}\n如果有多個輸出，分別存成不同檔案（JSON、Markdown、HTML 等都可以）。`;

    sendEvent({ type: "debug", engine: "paaw-agent-loop", cwd: cwd || PAAW_ROOT, testDir: relTestDir });
    console.log(`[skill-test] running via PAAW Agent Loop, skillId=${skillId}, testDir=${testDir}`);

    const heartbeat = setInterval(() => sendEvent({ type: "heartbeat" }), 5000);
    try {
      const agentResult = await runAgentLoop({
        prompt: fullPrompt,
        cwd: cwd || PAAW_ROOT,
        maxTurns: maxToolCalls,
        timeout,
        rootDir: PAAW_ROOT,
        onEvent: (evt) => {
          if (evt.type === "tool_start") sendEvent({ type: "stdout", data: `🔧 ${evt.name}...\n` });
          if (evt.type === "tool_end") sendEvent({ type: "stdout", data: `✅ ${evt.name}: ${evt.result || ""}\n` });
          if (evt.type === "assistant_thinking") sendEvent({ type: "stdout", data: `💭 ${evt.content}\n` });
        },
      });
      clearInterval(heartbeat);

      const files = [];
      const scanDirs = [testDir];
      const outputPathMatch = prompt.match(/輸出路徑:\s*(.+)/);
      if (outputPathMatch) {
        const userPath = outputPathMatch[1].trim();
        const userDir = resolve(PAAW_ROOT, userPath);
        if (!scanDirs.includes(userDir)) scanDirs.unshift(userDir);
      }
      for (const scanDir of scanDirs) {
        try {
          const entries = await readdir(scanDir);
          for (const name of entries) {
            if (name === "_prompt.txt") continue;
            const fp = join(scanDir, name);
            const s = await stat(fp);
            if (s.isFile()) {
              const ext = name.split(".").pop()?.toLowerCase() || "";
              let type = "text";
              if (["json", "jsonl"].includes(ext)) type = "json";
              else if (["html", "htm"].includes(ext)) type = "html";
              else if (["md", "markdown"].includes(ext)) type = "markdown";
              else if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) type = "image";
              else if (["csv"].includes(ext)) type = "csv";
              else if (["yaml", "yml"].includes(ext)) type = "yaml";
              files.push({ name, path: fp, size: s.size, type, ext });
            }
          }
        } catch {}
      }

      if (files.length === 0 && agentResult.content.trim()) {
        const fallbackFile = join(testDir, "output.md");
        await writeFile(fallbackFile, agentResult.content, "utf-8");
        files.push({ name: "output.md", path: fallbackFile, size: Buffer.byteLength(agentResult.content), type: "markdown", ext: "md" });
      }

      sendEvent({ type: "done", exitCode: agentResult.success ? 0 : 1, testDir, files, stdout: agentResult.content.slice(-2000), stderr: "", debug: `Agent Loop: ${agentResult.turns} turns, ${agentResult.toolCalls.length} tool calls, ${agentResult.durationMs}ms` });
      try { res.end(); } catch {}
    } catch (err) {
      clearInterval(heartbeat);
      console.error(`[skill-test] error:`, err);
      sendEvent({ type: "error", message: `Agent Loop 執行失敗: ${err.message}` });
      try { res.end(); } catch {}
    }
    return true;
  }

  // ── GET /api/skill-test/file-content ──
  if (req.method === "GET" && req.url?.startsWith("/api/skill-test/file-content")) {
    try {
      const qs = new URL(req.url, "http://localhost").searchParams;
      const filePath = qs.get("path");
      if (!filePath) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing path" })); return true; }
      const content = await readFile(resolve(filePath), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, content }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── POST /api/cli-run — run via PAAW Agent Loop ──
  if (req.method === "POST" && req.url === "/api/cli-run") {
    let bodyStr = "";
    for await (const chunk of req) bodyStr += chunk;
    try {
      const { prompt, cwd: runCwd, maxToolCalls = 10, timeout = 120, stream: wantStream = false } = JSON.parse(bodyStr);
      if (!prompt) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing prompt" })); return true; }

      const workCwd = runCwd || PAAW_ROOT;

      if (wantStream) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        const sendSSE = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };
        try {
          const agentResult = await runAgentLoop({
            prompt, cwd: workCwd, maxTurns: maxToolCalls, timeout,
            rootDir: PAAW_ROOT,
            onEvent: (evt) => {
              if (evt.type === "tool_start") sendSSE({ type: "stdout", data: `🔧 ${evt.name}...\n` });
              if (evt.type === "tool_end") sendSSE({ type: "stdout", data: `✅ ${evt.name}: ${evt.result || ""}\n` });
              if (evt.type === "assistant_thinking") sendSSE({ type: "stdout", data: `💭 ${evt.content}\n` });
            },
          });
          sendSSE({ type: "done", exitCode: agentResult.success ? 0 : 1, output: agentResult.content });
          res.end();
        } catch (err) {
          sendSSE({ type: "error", message: err.message });
          res.end();
        }
      } else {
        const agentResult = await runAgentLoop({
          prompt, cwd: workCwd, maxTurns: maxToolCalls, timeout,
          rootDir: PAAW_ROOT,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, exitCode: agentResult.success ? 0 : 1, output: agentResult.content, stderr: "" }));
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return true;
  }

  // ── GET /api/models ──
  const modelsMatch = req.method === "GET" && req.url?.match(/^\/api\/models(?:\?(.*))?$/);
  if (modelsMatch) {
    try {
      const { readFileSync: _rsf } = await import("fs");
      const providerConfig = JSON.parse(_rsf(resolve(PAAW_ROOT, "data/config/providers.json"), "utf-8"));
      const providerId = providerConfig.active;
      const provider = providerConfig.providers[providerId];
      const models = (provider?.models || []).map(m => ({ id: m.id || m, name: m.name || m.id || m, current: m.id === providerConfig.defaultModel }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models, current: providerConfig.defaultModel }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [], current: "" }));
    }
    return true;
  }

  // ── Crew CRUD endpoints ──

  function crewDirForRequest() { return factoryDir(getFactoryId(req.url), "crews"); }

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
    return true;
  }

  // GET /api/crew/:id
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
        return true;
      }
      const content = await readFile(join(crewDirForRequest(), target), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/crew
  if (req.method === "POST" && req.url?.match(/^\/api\/crew(?:\?.*)?$/)) {
    let parsed;
    try { parsed = JSON.parse(await readBody(req)); } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return true; }
    if (!parsed.id) { res.writeHead(400); res.end("Missing 'id'"); return true; }
    if (!parsed.title) { res.writeHead(400); res.end("Missing 'title'"); return true; }

    try {
      const files = await listCrewFiles();
      for (const f of files) {
        const raw = await readFile(join(crewDirForRequest(), f), "utf-8");
        const existing = JSON.parse(raw);
        if (existing.id === parsed.id) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Crew id '${parsed.id}' already exists` }));
          return true;
        }
      }

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
    return true;
  }

  // PUT /api/crew/:id
  const crewPutMatch = req.method === "PUT" && req.url?.match(/^\/api\/crew\/([\w.-]+)(?:\?.*)?$/);
  if (crewPutMatch) {
    const crewId = crewPutMatch[1];
    let parsed;
    try { parsed = JSON.parse(await readBody(req)); } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return true; }

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
        return true;
      }
      parsed.id = crewId;
      await writeFile(join(crewDirForRequest(), targetFile), JSON.stringify(parsed, null, 4), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crew: parsed }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/crew/:id
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
        return true;
      }
      await unlink(join(crewDirForRequest(), targetFile));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── Conversation endpoints ──

  // GET /api/conversations/:employeeId
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
    return true;
  }

  // GET /api/conversations/:employeeId/:convId
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
    return true;
  }

  // POST /api/conversations/:employeeId
  const convSaveMatch = req.method === "POST" && req.url?.match(/^\/api\/conversations\/([\w.-]+)(?:\?.*)?$/);
  if (convSaveMatch) {
    const employeeId = convSaveMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    let parsed;
    const convBody = await readBody(req);
    try { parsed = JSON.parse(convBody); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const { id, title, messages, model, systemPrompt } = parsed;
    if (!id) { res.writeHead(400); res.end("Missing 'id'"); return true; }
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
        const fileStats = await Promise.all(jsonFiles.map(async f => {
          try {
            const raw = await readFile(join(convDir, f), "utf-8");
            const d = JSON.parse(raw);
            return { name: f, updatedAt: d.updatedAt || d.createdAt || "" };
          } catch {
            return { name: f, updatedAt: "" };
          }
        }));
        fileStats.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        const toDelete = fileStats.slice(5);
        for (const f of toDelete) {
          try { await unlink(join(convDir, f.name)); } catch { /* ignore */ }
        }
      }
    } catch { /* cleanup is best-effort */ }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id }));
    return true;
  }

  // DELETE /api/conversations/:employeeId/:convId
  const convDeleteMatch = req.method === "DELETE" && req.url?.match(/^\/api\/conversations\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
  if (convDeleteMatch) {
    const [, employeeId, convId] = convDeleteMatch;
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const filePath = join(getConvDir(employeeId, root), `${convId}.json`);
    try {
      await unlink(filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Conversation not found" }));
    }
    return true;
  }

  // ── Saved Inputs endpoints ──

  // GET /api/saved-inputs/:employeeId
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
    return true;
  }

  // POST /api/saved-inputs/:employeeId
  const savedInputsPostMatch = req.method === "POST" && req.url?.match(/^\/api\/saved-inputs\/([\w.-]+)(?:\?.*)?$/);
  if (savedInputsPostMatch) {
    const employeeId = savedInputsPostMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    let parsed;
    const siBody = await readBody(req);
    try { parsed = JSON.parse(siBody); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const { hash: inputHash, skillId, data } = parsed;
    if (!inputHash) { res.writeHead(400); res.end("Missing 'hash'"); return true; }

    const pHash = projectPathHash(root);
    const dir = resolve(CONVERSATIONS_ROOT, pHash, employeeId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "saved-inputs.json");

    let existing = { inputs: [] };
    try {
      const raw = await readFile(filePath, "utf-8");
      existing = JSON.parse(raw);
    } catch { /* first time */ }

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
    return true;
  }

  // ── Work Log endpoints ──

  // GET /api/work-log/:employeeId
  const workLogGetMatch = req.method === "GET" && req.url?.match(/^\/api\/work-log\/([\w.-]+)(?:\?.*)?$/);
  if (workLogGetMatch) {
    const employeeId = workLogGetMatch[1];
    const u = new URL(req.url, "http://localhost");
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
    return true;
  }

  // POST /api/work-log/:employeeId
  const workLogPostMatch = req.method === "POST" && req.url?.match(/^\/api\/work-log\/([\w.-]+)(?:\?.*)?$/);
  if (workLogPostMatch) {
    const employeeId = workLogPostMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root");
    const dir = root
      ? join(CONVERSATIONS_ROOT, projectPathHash(root), employeeId)
      : join(factoryDir(getFactoryId(req.url), "crews"), "conversation", employeeId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "work-log.json");

    let wlBody = "";
    for await (const chunk of req) wlBody += chunk;
    const { skillIds, inputSummary, cli, inputData } = JSON.parse(wlBody);

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

    existing.entries = existing.entries.filter((entry, idx, arr) => {
      if (idx === 0) return true;
      const prev = arr.findIndex(e => e.inputSummary === entry.inputSummary && e.cli === entry.cli);
      if (prev < idx) {
        const timeDiff = new Date(entry.timestamp).getTime() - new Date(arr[prev].timestamp).getTime();
        if (Math.abs(timeDiff) < 3000) return false;
      }
      return true;
    });

    if (existing.entries.length > 50) existing.entries = existing.entries.slice(0, 50);

    await writeFile(filePath, JSON.stringify(existing, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── FS Browser endpoints ──

  // GET /api/fs/pick-folder
  if (req.method === "GET" && req.url?.startsWith("/api/fs/pick-folder")) {
    try {
      const { execFile } = await import("child_process");
      const platform = process.platform;
      let result;

      if (platform === "darwin") {
        result = await new Promise((resolve, reject) => {
          execFile("osascript", ["-e", 'set chosenFolder to choose folder with prompt "Select a project folder"\nreturn POSIX path of chosenFolder'], (err, stdout) => {
            if (err) reject(err); else resolve(stdout.toString().trim());
          });
        });
      } else if (platform === "linux") {
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
    return true;
  }

  // GET /api/fs/browse-files?path=...
  if (req.method === "GET" && req.url?.startsWith("/api/fs/browse-files")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const dirPath = params.get("path") || "";
    const absPath = dirPath ? resolve(dirPath) : resolve(process.env.USERPROFILE || process.env.HOME || "/");
    try {
      const s = await stat(absPath);
      if (!s.isDirectory()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not a directory" }));
        return true;
      }
      const entries = await readdir(absPath, { withFileTypes: true });
      const IGNORED = new Set([".git", "node_modules", ".DS_Store", ".cache", ".Trash", ".npm", ".vite"]);
      const visible = entries.filter(e => !IGNORED.has(e.name) && !e.name.startsWith(".")).sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      const dirs = visible.filter(e => e.isDirectory()).map(e => ({ name: e.name, path: join(absPath, e.name), type: "dir" }));
      const files = visible.filter(e => !e.isDirectory()).map(e => ({ name: e.name, path: join(absPath, e.name), type: "file" }));
      const parent = (absPath !== "/" && !/^[A-Za-z]:\\$/.test(absPath)) ? dirname(absPath) : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ currentPath: absPath, parent, directories: dirs, files }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message, currentPath: absPath, parent: null, directories: [], files: [] }));
    }
    return true;
  }

  // GET /api/fs/browse?path=...
  if (req.method === "GET" && req.url?.startsWith("/api/fs/browse") && !req.url?.startsWith("/api/fs/browse-files")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const dirPath = params.get("path") || "";
    const absPath = dirPath ? resolve(dirPath) : resolve(process.env.USERPROFILE || process.env.HOME || "/");
    try {
      const s = await stat(absPath);
      if (!s.isDirectory()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not a directory" }));
        return true;
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
    return true;
  }

  // GET /api/fs/tree?root=...
  if (req.method === "GET" && req.url?.startsWith("/api/fs/tree") && !req.url?.startsWith("/api/fs/tree-deep")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const root = params.get("root");
    if (!root) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'root' query param" }));
      return true;
    }
    const absRoot = resolve(root);
    if (!absRoot.startsWith("/") && !/^[A-Za-z]:/.test(absRoot)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Only absolute paths allowed" }));
      return true;
    }
    try {
      const tree = await buildTree(absRoot, absRoot, 15);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/fs/file?path=...
  if (req.method === "GET" && req.url?.startsWith("/api/fs/file")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const filePath = params.get("path");
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'path' query param" }));
      return true;
    }
    const absPath = resolve(PAAW_ROOT, filePath);
    try {
      const s = await stat(absPath);
      const ext = absPath.split(".").pop()?.toLowerCase() ?? "";
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
      const isImage = imageExts.includes(ext);
      if (isImage && s.size > 10 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Image too large (max 10MB)" }));
        return true;
      }
      if (!isImage && s.size > 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File too large (max 1MB)" }));
        return true;
      }
      if (isImage) {
        const mimeMap = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
          bmp: "image/bmp", ico: "image/x-icon",
        };
        const data = await readFile(absPath);
        res.writeHead(200, {
          "Content-Type": mimeMap[ext] || "application/octet-stream",
          "Content-Length": s.size,
          "Cache-Control": "public, max-age=3600",
        });
        res.end(data);
      } else {
        const content = await readFile(absPath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: absPath, content, size: s.size }));
      }
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
    }
    return true;
  }

  // GET /api/fs/tree-deep?root=...&subpath=...
  if (req.method === "GET" && req.url?.startsWith("/api/fs/tree-deep")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const root = params.get("root");
    const subpath = params.get("subpath") || "";
    if (!root) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'root' query param" }));
      return true;
    }
    const absDir = resolve(join(root, subpath));
    try {
      const children = await buildTree(absDir, absDir, 15);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(children));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/fs/mkdir
  if (req.method === "POST" && req.url?.startsWith("/api/fs/mkdir")) {
    let mkBody = "";
    for await (const chunk of req) mkBody += chunk;
    try {
      const { path: dirPath } = JSON.parse(mkBody);
      if (!dirPath) throw new Error("Missing path");
      const abs = resolve(dirPath);
      await mkdir(abs, { recursive: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: abs }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/fs/create-file
  if (req.method === "POST" && req.url?.startsWith("/api/fs/create-file")) {
    let cfBody = "";
    for await (const chunk of req) cfBody += chunk;
    try {
      const { path: fPath, content = "" } = JSON.parse(cfBody);
      if (!fPath) throw new Error("Missing path");
      const abs = resolve(fPath);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: abs }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/fs/rename
  if (req.method === "POST" && req.url?.startsWith("/api/fs/rename")) {
    let rnBody = "";
    for await (const chunk of req) rnBody += chunk;
    try {
      const { oldPath, newPath } = JSON.parse(rnBody);
      if (!oldPath || !newPath) throw new Error("Missing oldPath or newPath");
      const absOld = resolve(oldPath);
      const absNew = resolve(newPath);
      const { rename } = await import("fs/promises");
      await rename(absOld, absNew);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, oldPath: absOld, newPath: absNew }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/fs/copy
  if (req.method === "POST" && req.url?.startsWith("/api/fs/copy")) {
    let cpBody = "";
    for await (const chunk of req) cpBody += chunk;
    try {
      const { srcPath, destPath } = JSON.parse(cpBody);
      if (!srcPath || !destPath) throw new Error("Missing srcPath or destPath");
      const absSrc = resolve(srcPath);
      const absDest = resolve(destPath);
      const { cp } = await import("fs/promises");
      await cp(absSrc, absDest, { recursive: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, srcPath: absSrc, destPath: absDest }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/fs/item?path=...
  if (req.method === "DELETE" && req.url?.startsWith("/api/fs/item")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const targetPath = params.get("path");
    if (!targetPath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'path' query param" }));
      return true;
    }
    const absPath = resolve(targetPath);
    if (!absPath.startsWith("/") && !/^[A-Za-z]:/.test(absPath)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Only absolute paths allowed" }));
      return true;
    }
    try {
      const s = await stat(absPath);
      if (s.isDirectory()) {
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
    return true;
  }

  // GET /api/fs/watch — SSE file watcher
  if (req.method === "GET" && req.url?.startsWith("/api/fs/watch")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const watchRoot = params.get("root") || PAAW_ROOT;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    const watcher = startWatcher(watchRoot, res);
    req.on("close", () => { watcher.close(); });
    return true;
  }

  // ── Crew Photo endpoint ──

  // GET /api/factory/:factoryId/crews-pic/:filename
  const crewPicMatch = req.method === "GET" && req.url?.match(/^\/api\/factory\/([\w.-]+)\/crews-pic\/(.+)$/);
  if (crewPicMatch) {
    const [, , picName] = crewPicMatch;
    const picPath = join(CREWS_ROOT, "pic", picName);
    try {
      const s = await stat(picPath);
      if (!s.isFile()) throw new Error("Not a file");
      const ext = picName.split(".").pop()?.toLowerCase();
      const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
      res.writeHead(200, { "Content-Type": mimeMap[ext] || "application/octet-stream" });
      const { createReadStream } = await import("fs");
      createReadStream(picPath).pipe(res);
    } catch {
      const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRUEFTkSuQmCC", "base64");
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
      res.end(transparentPng);
    }
    return true;
  }

  // ── Factory Content endpoints ──

  // GET /api/factory-content/:name
  const singleFileMatch = req.method === "GET" && req.url?.match(/^\/api\/factory-content\/([\w.-]+)(?:\?.*)?$/);
  if (singleFileMatch) {
    const name = singleFileMatch[1];
    const filePath = join(DOCS_ROOT, name);
    try {
      const content = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ filename: name, content }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
    }
    return true;
  }

  // GET /api/factory-content
  const factoryContentListMatch = req.method === "GET" && req.url?.match(/^\/api\/factory-content(?:\?.*)?$/);
  if (factoryContentListMatch) {
    try {
      const files = await readdir(DOCS_ROOT);
      const result = files.sort().map(f => ({ filename: f }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return true;
  }

  // GET /api/project-dashboard
  if (req.method === "GET" && req.url?.startsWith("/api/project-dashboard")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const root = u.searchParams.get("root");
      if (!root) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing root param" }));
        return true;
      }
      const dashFile = join(root, ".aieoc", "dashboard.json");
      const content = await readFile(dashFile, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(null));
    }
    return true;
  }

  return false;
}
