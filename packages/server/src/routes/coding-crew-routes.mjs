// coding-crew-routes.mjs — 2026-11-07 從 routes/coding.mjs 機械抽取（不改行為）
// /api/coding-crew/* 子分派：crew 定義/chat/EM dispatch/會話持久化/action-log/em-plan/em-execute/interrupt/running/memory/export-import
import { PAAW_ROOT } from "./coding-helpers.mjs";

export async function crewRoutes({ req, res, method, url, q, projectPath }) {


// ── GET /api/coding-crew/:crewId — Load crew definition (no project required) ──
// Exclude /running and /interrupt which are separate API endpoints
const crewMatch = url.match(/^\/api\/coding-crew\/([^/?]+)$/);
if (crewMatch && method === "GET" && !['running', 'interrupt', 'dispatch', 'chat', 'conversations', 'context-window', 'action-log', 'qa-results'].includes(crewMatch[1])) {
  const crewId = decodeURIComponent(crewMatch[1]);
  try {
    // 2026-10-09 Module Registry：crew 本體在 packages/modules（firmware）→ .paaw override → user crew；
    // 偏好（頭像/顯示名/開場白/語氣）疊加 — 側欄與 chat header 直接吃到
    const { resolveCrew, applyCrewPrefs } = await import("../lib/module-registry.mjs");
    const resolved = resolveCrew(crewId, projectPath ? resolve(projectPath) : null);
    if (resolved) {
      const crew = applyCrewPrefs(resolved.crew || resolved);
      // If crew has injectProjectContext and we have a project path, append .paaw/ context
      if (crew.injectProjectContext && projectPath) {
        const projRoot = resolve(projectPath);
        const projPaaw = createPaawProject(projRoot);
        const ctx = await projPaaw.loadContext();
        if (ctx) crew._projectContext = ctx;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(crew));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Crew not found", crewId }));
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// ── POST /api/coding-crew/chat — Chat via A2A domain agent dispatch ──
if (url === "/api/coding-crew/chat" && method === "POST") {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return true;
  }
  const { crewId, message, model, cwd, context, conversationHistory } = body;
  if (!crewId || !message) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing crewId or message" }));
    return true;
  }

  // Resolve project root from cwd (the coding project being worked on)
  const projRoot = cwd ? resolve(cwd) : resolve(projectPath || PAAW_ROOT);

  // Resolve agentId from crewId
  const { getAgentByCrewId, buildSystemPrompt } = await import("../lib/domain-agent-registry.mjs");
  const { listActionLog, loadAgentMemory } = await import("../lib/action-log.mjs");
  const agent = getAgentByCrewId(crewId);
  if (!agent) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `No domain agent for crewId: ${crewId}` }));
    return true;
  }

  try {
    // Build system prompt from crew + context providers + action log + agent memory
    const actionLogText = (await listActionLog({ cwd: projRoot, limit: 10 })).text;
    const agentMemoryText = await loadAgentMemory(agent.agentId, projRoot);
    const systemPrompt = await buildSystemPrompt(agent.agentId, {
      cwd: cwd || undefined,
      clientContext: context || {},
    });

    // Inject action log and agent memory into system prompt
    const extraContext = [];
    if (actionLogText) extraContext.push(`\n## Recent Action Log (跨 Agent 交接紀錄)\n${actionLogText}`);
    if (agentMemoryText) extraContext.push(`\n## Your Long-term Memory (你的長期記憶)\n${agentMemoryText}`);
    // Inject API Map（API-first，2026-11-01）：category 分組的後端進入點清單
    {
      try {
        const { readApiFeatures } = await import("../lib/coding-db/reads.mjs");
        const apis = readApiFeatures(projRoot);
        if (apis.length > 0) {
          const byCat = {};
          for (const a of apis) (byCat[a.category] ??= []).push(a);
          const catLines = Object.entries(byCat).map(([cat, list]) => {
            const rows = list.map(a => `  - [${a.id}] ${a.entry} — ${a.name}${a.codeFiles?.length ? ` (${a.codeFiles.length} files)` : ""}`).join("\n");
            return `### ${cat} (${list.length})\n${rows}`;
          }).join("\n");
          extraContext.push(`\n## API Map（API-first，${apis.length} 個後端進入點）\nUse project_info(category=api_detail, entry=...) for process flow / validation.\n${catLines}`);
        }
      } catch {}
    }

    // Inject Code Intelligence SUMMARY (not full 200-file dump — too fat)
    const ciFile = join(projRoot, ".paaw", "code-intelligence", "code-intelligence.json");
    if (existsSync(ciFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      try {
        const ci = JSON.parse(readSync(ciFile, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
        if (ci.files?.length) {
          // Summary: top-level dirs + file count + key entry points
          const dirCount = {};
          const keyFiles = [];
          for (const f of ci.files) {
            const dir = (f.path || "").split("/").slice(0, 2).join("/");
            dirCount[dir] = (dirCount[dir] || 0) + 1;
            // Key files: have many exports or are index/main entry points
            if ((f.exports?.length || 0) > 3 || /index\.|main\.|app\./i.test(f.path)) {
              keyFiles.push(`- ${f.path} (exports: ${(f.exports || []).slice(0, 5).join(", ")})`);
            }
          }
          const dirLines = Object.entries(dirCount).sort((a,b) => b[1] - a[1]).map(([d, c]) => `  ${d}/ (${c} files)`).join("\n");
          const keyLines = keyFiles.slice(0, 20).join("\n");
          extraContext.push(`\n## Code Intelligence (${ci.files.length} files)\nDirectories:\n${dirLines}\nKey files:\n${keyLines}\n(用 read_file 查完整 exports/imports，或 grep 搜尋 symbol)`);
        }
      } catch {}
    }

    // Inject Security scan summary (last scan)
    const secFile = join(projRoot, ".paaw", "security", "scan-results.json");
    if (existsSync(secFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      try {
        const sec = JSON.parse(readSync(secFile, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
        if (sec.stats?.total > 0) {
          // 舊格式没 scannedAt → 檔案 mtime fallback（2026-09-06：agent 反映 scanned unknown 無法判時效性）
          let scannedAt = sec.scannedAt;
          if (!scannedAt) { try { scannedAt = new Date(statSync(secFile).mtimeMs).toISOString(); } catch { scannedAt = "unknown"; } } // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          extraContext.push(`\n## Security Scan Summary (${sec.stats.total} findings, scanned ${scannedAt})\nBy severity: ${JSON.stringify(sec.stats.bySeverity)}\nBy category: ${JSON.stringify(sec.stats.byCategory)}\n（明細查詢：project_info(category="security") — file:line + CWE + snippet + feature 對應；QA/SA 評估後可開 task 修復）`);
        }
      } catch {}
    }
    extraContext.push(AGENT_RULES);
    extraContext.push(SECURITY_RULES);
    const fullSystemPrompt = systemPrompt + extraContext.join("");

    // Build messages array with conversation history
    const messages = [];
    if (fullSystemPrompt) messages.push({ role: "system", content: fullSystemPrompt });

    // Inject conversation history — clean then let trimMessagesToFit handle context window
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      // Filter: only user/assistant, skip thinking bubbles, include tool call context
      const cleanHistory = conversationHistory
        .filter(m => m.role === "user" || m.role === "assistant")
        .filter(m => !m._thinking)
        .map(m => {
          let content = (m.content || "").replace(/^💭 /, "");
          // Append tool call info so LLM knows what it did before
          if (m._toolCalls?.length) {
            const toolLines = m._toolCalls.map(tc => {
              if (tc.result) return `[tool:${tc.name}] result: ${tc.result.slice(0, 300)}`;
              return `[tool:${tc.name}] args: ${typeof tc.args === "string" ? tc.args.slice(0, 200) : "..."}`;
            });
            content += "\n" + toolLines.join("\n");
          }
          return { role: m.role, content };
        });

      for (const m of cleanHistory) {
        messages.push({ role: m.role, content: m.content });
      }
    }

    // Add current user message
    messages.push({ role: "user", content: message });

    // ── Apply context window trimming (aligned with A2A agent loop: 262K budget) ──
    const { trimMessagesToFit } = await import("../lib/paaw-agent-loop.mjs");
    const finalMessages = trimMessagesToFit(messages);

    // ── Dispatch Logging ──
    // Write full dispatch context to .paaw/coding-memory/dispatch-log.jsonl
    try {
      const logPath = join(cwd || PAAW_ROOT, ".paaw", "coding-memory", "dispatch-log.jsonl");
      const logEntry = {
        ts: new Date().toISOString(),
        agentId: agent.agentId,
        crewId,
        model: model || "default",
        systemPromptLength: fullSystemPrompt.length,
        systemPromptPreview: fullSystemPrompt.slice(0, 500),
        actionLogInjected: actionLogText ? actionLogText.slice(0, 300) : "(none)",
        agentMemoryInjected: agentMemoryText ? agentMemoryText.slice(0, 300) : "(none)",
        conversationHistoryCount: conversationHistory?.length || 0,
        cleanHistoryCount: conversationHistory?.filter(m => m.role === "user" || m.role === "assistant").filter(m => !m._thinking).length || 0,
        currentMessage: message,
        totalMessages: finalMessages.length,
        messagesSummary: finalMessages.map(m => ({ role: m.role, contentLength: m.content?.length || 0, preview: (m.content || "").slice(0, 120) })),
      };
      await appendFile(logPath, JSON.stringify(logEntry, null, 2) + "\n---\n");
      try { codingDb.appendDispatchRecord(cwd || PAAW_ROOT, logEntry); } catch {} // dual-write
    } catch (logErr) {
      console.error("[dispatch-log] write failed:", logErr.message);
    }

    // SSE streaming
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

    const { runAgentLoopStream } = await import("../lib/paaw-agent-loop.mjs");
    // Register running agent for busy check + interrupt support（2026-09-15：key 帶 projRoot — 多 RU 不互蓋）
    const chatAbort = new AbortController();
    const chatKey = `${agent.agentId}::${projRoot}`;
    runningCodingAgents.set(chatKey, { abortController: chatAbort, res, startedAt: Date.now(), source: "chat", projRoot });
    const cleanupChatAgent = () => { runningCodingAgents.delete(chatKey); };
    res.on("close", cleanupChatAgent);

    // Feature boundary for Change Boundary (chat path)
    let chatFeatureBoundary = null;
    try {
      const { buildContextBoundary } = await import("../lib/feature-boundary.mjs");
      const stagedResp = await fetch(`http://localhost:${PORT}/api/staged-changes?path=${encodeURIComponent(projRoot)}`).catch(() => null);
      const stagedData = stagedResp?.ok ? await stagedResp.json() : null;
      const stagedPaths = stagedData?.files?.map(f => f.path) || [];
      if (stagedPaths.length > 0) {
        const boundary = buildContextBoundary(projRoot, stagedPaths);
        if (boundary.featureIds.length > 0) {
          chatFeatureBoundary = { allowedFiles: boundary.allowedFiles, featureIds: boundary.featureIds };
        }
      }
    } catch {}

    await runAgentLoopStream({
      prompt: "", // handled by messages array
      systemPrompt: "", // handled by messages array
      messages: finalMessages, // trimmed with 262K budget, same as A2A
      model: model || undefined,
      featureBoundary: chatFeatureBoundary,
      cwd: cwd || undefined,
      maxTurns: agent.maxTurns,
      timeout: 0, // no timeout — complex tasks may take arbitrarily long
      rootDir: projRoot,
      // 2026-10-15：傳 crewId（非短版 agentId）— skillBindings 以 crewId 為 key，短版 lookup 永遠 miss
      agentId: crewId,
      abortSignal: chatAbort.signal,
    }, res);
    cleanupChatAgent();

    if (!res.writableEnded) res.end();
    console.log(`[CodingCrew:chat] ${agent.agentId} stream completed`);
  } catch (err) {
    console.error(`[CodingCrew:chat] error:`, err);
    if (res.headersSent && !res.writableEnded) {
      try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); } catch {} // nosemgrep: missing-template-string-indicator
    } else if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
  return true;
}

// ── POST /api/coding-crew/dispatch — EM dispatch: trigger another agent to run a task ──
if (url === "/api/coding-crew/dispatch" && method === "POST") {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return true;
  }
  const { agentId, task, cwd, model, priority = "medium", taskId, subTaskId, taskTimeout } = body;
  if (!agentId || !task) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing agentId or task" }));
    return true;
  }

  const projRoot = cwd ? resolve(cwd) : resolve(projectPath || PAAW_ROOT);

  // Resolve crew config for the target agent
  const agentMap = {
    architect: "coding.architect",
    developer: "coding.developer",
    tester: "coding.tester",
    "doc-writer": "coding.doc-writer",
    qa: "coding.qa",
    helpdesk: "coding.helpdesk",
  };
  const crewId = agentMap[agentId] || agentId;
  const crewFile = join(DATA_HOME, "crews", `${crewId}.json`);
  if (!existsSync(crewFile)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Agent '${agentId}' not found` }));
    return true;
  }

  try {
    const crewDef = JSON.parse(readSync(crewFile, "utf-8"));
    // 2026-09-12 Fleming：crew agent 也要知道時間/時區（rolePrompt 是靜態 json，不會有時間）
    const systemPrompt = dateTimeContextBlock() + "\n" + (crewDef.rolePrompt || "");

    // Build context same as chat endpoint (feature map, code intel, action log, agent memory)
    const extraContext = [];

    // Load context helpers
    const { listActionLog, loadAgentMemory } = await import("../lib/action-log.mjs");
    const loadProviderConfig = (await import("../context-engine.mjs")).loadProviderConfig;

    // Context Boundary — inject feature file tree if task mentions features or files
    try {
      const { buildContextBoundary } = await import("../lib/feature-boundary.mjs");
      // Try to extract file references from task description
      const taskFiles = task.match(/[\w/.-]+\.(ts|tsx|mjs|js|jsx|json)/g) || [];
      if (taskFiles.length > 0) {
        const boundary = buildContextBoundary(projRoot, taskFiles);
        if (boundary.featureIds.length > 0) {
          extraContext.push(boundary.boundaryText);
        }
      }
    } catch {}

    // Code intelligence — summary only (not full file dump)
    const ciFile = join(projRoot, ".paaw", "code-intelligence", "code-intelligence.json");
    if (existsSync(ciFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      try {
        const ci = JSON.parse(readSync(ciFile, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
        if (ci.files?.length) {
          const dirCount = {};
          const keyFiles = [];
          for (const f of ci.files) {
            const dir = (f.path || "").split("/").slice(0, 2).join("/");
            dirCount[dir] = (dirCount[dir] || 0) + 1;
            if ((f.exports?.length || 0) > 3 || /index\.|main\.|app\./i.test(f.path)) {
              keyFiles.push(`- ${f.path} (exports: ${(f.exports || []).slice(0, 5).join(", ")})`);
            }
          }
          const dirLines = Object.entries(dirCount).sort((a,b) => b[1] - a[1]).map(([d, c]) => `  ${d}/ (${c} files)`).join("\n");
          const keyLines = keyFiles.slice(0, 20).join("\n");
          extraContext.push(`\n## Code Intelligence (${ci.files.length} files)\nDirectories:\n${dirLines}\nKey files:\n${keyLines}`);
        }
      } catch {}
    }

    // Action log（2026-09-07 修正：listActionLog 簽名是 opts 物件，之前傳字串 → fallback PAAW 根永遠讀不到；欄位是 details 非 detail）
    const { entries: actionLog } = await listActionLog({ cwd: projRoot, limit: 200 });
    if (actionLog.length > 0) {
      const recent = actionLog.slice(-10).map(e => `- [${e.agent}] ${e.action}${e.details ? ": " + e.details : ""} (${e.ts})`).join("\n");
      extraContext.push(`\n## Recent Action Log\n${recent}`);
    }

    // Agent memory
    const agentMemoryText = await loadAgentMemory(agentId, projRoot);
    if (agentMemoryText) extraContext.push(`\n## Your Long-term Memory\n${agentMemoryText}`);

    extraContext.push(AGENT_RULES);
    extraContext.push(SECURITY_RULES);
    const fullSystemPrompt = systemPrompt + extraContext.join("");

    const messages = [
      { role: "system", content: fullSystemPrompt },
      { role: "user", content: task },
    ];

    // Load provider config
    // Resolve LLM config (same as agent loop)
    const { resolveLLMConfig } = await import("../lib/paaw-agent-loop.mjs");
    const llm = resolveLLMConfig(projRoot, model);
    const useModel = llm.model;

    // Run the agent via runAgentLoopStream — it handles SSE and tool loop internally
    // Busy check — reject if agent is already running（2026-09-15：同 RU 才算 busy — 另一個 RU 跑同一個 agent 不再擋這邊派工）
    const busyKey = `${agentId}::${projRoot}`;
    if (runningCodingAgents.has(busyKey)) {
      const running = runningCodingAgents.get(busyKey);
      const elapsed = Math.round((Date.now() - running.startedAt) / 1000);
      if (!res.headersSent) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: `Agent '${agentId}' is busy in this RU (running for ${elapsed}s, source: ${running.source})`, busy: true, agentId, cwd: projRoot }));
      }
      return true;
    }

    const { runAgentLoopStream } = await import("../lib/paaw-agent-loop.mjs");
    // Register dispatched agent
    const dispatchAbort = new AbortController();
    const dispatchKey = `${agentId}::${projRoot}`;
    runningCodingAgents.set(dispatchKey, { abortController: dispatchAbort, res, startedAt: Date.now(), source: "dispatch", projRoot });
    const cleanupDispatch = () => { runningCodingAgents.delete(dispatchKey); };
    res.on("close", cleanupDispatch);

    // Use task timeout if specified, otherwise 60 min safety net
    const effectiveTimeout = taskTimeout || 3600; // 60 min default

    // Feature boundary for Change Boundary (dispatch path)
    let dispatchFeatureBoundary = null;
    try {
      const { buildContextBoundary } = await import("../lib/feature-boundary.mjs");
      const stagedResp2 = await fetch(`http://localhost:${PORT}/api/staged-changes?path=${encodeURIComponent(projRoot)}`).catch(() => null);
      const stagedData2 = stagedResp2?.ok ? await stagedResp2.json() : null;
      const stagedPaths2 = stagedData2?.files?.map(f => f.path) || [];
      if (stagedPaths2.length > 0) {
        const boundary2 = buildContextBoundary(projRoot, stagedPaths2);
        if (boundary2.featureIds.length > 0) {
          dispatchFeatureBoundary = { allowedFiles: boundary2.allowedFiles, featureIds: boundary2.featureIds };
        }
      }
    } catch {}

    // ── Deterministic 驗收基準（2026-09-20 Fleming：EM 派工假成功偵測）──
    // 共用模組 lib/dispatch-verifier.mjs — 三條派工路徑（dispatch endpoint /
    // auto-dispatch / dispatch_agent tool）同一套驗收規則
    const { takeDispatchSnapshot, verifyDispatchWork, dispatchRetrySuffix } = await import("../lib/dispatch-verifier.mjs");
    const verifySnap = await takeDispatchSnapshot(projRoot);
    const verifyWork = () => verifyDispatchWork(projRoot, verifySnap);

    let attempts = 1;
    let loopStats = await runAgentLoopStream({
      systemPrompt: fullSystemPrompt,
      messages,
      cwd: projRoot,
      featureBoundary: dispatchFeatureBoundary,
      // 2026-10-15：傳完整 crewId（coding.developer 等）— skillBindings 用這個 key，
      // 之前傳原始 agentId（developer）→ appendSkillBindings lookup 永遠 miss，skill 全部沒注入
      agentId: crewId,
      model: useModel,
      // 2026-09-17 Fleming：派工上限 30 → 300（大任務會被砍斷）
      maxTurns: 300,
      timeout: effectiveTimeout,
      abortSignal: dispatchAbort.signal,
    }, res);

    let verdict = taskId ? await verifyWork() : { pass: true, why: "no-task-skip-verify" };

    // ── 驗收退回 → 自動重派一次（2026-09-20 Fleming：第二次通常會成功；重做不該由人觸發，
    //    server 內建機械重試，兩次都失敗才判 FAILED 交 EM 協調）──
    if (taskId && !verdict.pass && !dispatchAbort.signal.aborted && !res.destroyed) {
      attempts = 2;
      try { res.write(`data: ${JSON.stringify({ type: "dispatch_retry", attempts, message: `⚠️ Deterministic 驗收退回：${verdict.why}（零 commit 零 diff）— 自動重派第 2 次` })}\n\n`); } catch {}
      loopStats = await runAgentLoopStream({
        systemPrompt: fullSystemPrompt,
        messages: [
          { role: "system", content: fullSystemPrompt },
          { role: "user", content: `${task}${dispatchRetrySuffix(verdict, 1)}` },
        ],
        cwd: projRoot,
        featureBoundary: dispatchFeatureBoundary,
        // 2026-10-15：同上 — 重派也要傳完整 crewId，skill 注入才會生效
        agentId: crewId,
        model: useModel,
        maxTurns: 300,
        timeout: effectiveTimeout,
        abortSignal: dispatchAbort.signal,
      }, res);
      verdict = await verifyWork();
    }

    cleanupDispatch();

    // ── 驗收結果通知 EM（SSE 尾事件；EM 讀到 fail 會知道要協調）──
    try { res.write(`data: ${JSON.stringify({ type: "dispatch_verdict", pass: verdict.pass, attempts, why: verdict.why, files: verdict.files || [] })}\n\n`); } catch {} // nosemgrep: missing-template-string-indicator

    // ── Post-dispatch: record result to task — 驗收 PASS 才 close（feature-first 簡化後語意）──
    if (taskId) {
      try {
        const tasksDir = join(projRoot, ".paaw", "tasks");
        const tasksFile = join(tasksDir, "TASKS.json");
        if (existsSync(tasksFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          const allData = JSON.parse(readSync(tasksFile, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          const allTasks = allData.tasks || [];
          const tIdx = allTasks.findIndex(t => t.id === taskId);
          if (tIdx >= 0) {
            if (!Array.isArray(allTasks[tIdx].notes)) allTasks[tIdx].notes = [];
            if (verdict.pass) {
              allTasks[tIdx].notes.push({
                by: agentId,
                at: new Date().toISOString(),
                content: `✅ Agent ${agentId} completed dispatched task（deterministic 驗收 PASS：${verdict.why}，嘗試 ${attempts} 次）`,
              });
              allTasks[tIdx].status = "close";
            } else {
              // 兩次都零證據 → 判 FAILED（2026-09-20 Fleming：再失敗再判 fail，交 EM/人協調；不自動 close 假成功）
              allTasks[tIdx].notes.push({
                by: "system-verifier",
                at: new Date().toISOString(),
                content: `❌ Deterministic 驗收 FAILED（${attempts} 次嘗試皆零 commit 零 diff）— agent 宣稱完成但無實際產出，判定假成功。等 EM 協調（拆小任務重派）或人處理。`,
              });
              allTasks[tIdx].status = "pending";
            }
            if (verdict.pass && !allTasks[tIdx].resolvedAt) allTasks[tIdx].resolvedAt = new Date().toISOString();
            allTasks[tIdx].updatedAt = new Date().toISOString();
            allData.tasks = allTasks;
            const { writeFileSync } = await import("node:fs");
            writeFileSync(tasksFile, JSON.stringify(allData, null, 2), "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          try { codingDb.saveTasks(projRoot, allData); } catch {} // dual-write
          }
        }
      } catch (e) { console.error("post-dispatch task update error:", e.message); }
    }

    // ── Sub-task completion → 驗收 PASS 才 close；全部子任務 close → parent close（feature-first：無 chain、無 advance）──
    if (subTaskId && taskId) {
      try {
        const tasksFile = join(projRoot, ".paaw", "tasks", "TASKS.json");
        if (existsSync(tasksFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          const allData = JSON.parse(readSync(tasksFile, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          const allTasks = allData.tasks || [];
          const sub = allTasks.find(t => t.id === subTaskId);
          if (sub) {
            if (verdict.pass) {
              sub.status = "close";
              if (!sub.resolvedAt) sub.resolvedAt = new Date().toISOString();
              sub.updatedAt = new Date().toISOString();
            } else {
              sub.status = "pending";
              sub.updatedAt = new Date().toISOString();
              if (!Array.isArray(sub.notes)) sub.notes = [];
              sub.notes.push({ by: "system-verifier", at: new Date().toISOString(), content: `❌ Deterministic 驗收 FAILED（${attempts} 次皆零 commit 零 diff）— 假成功退回，等 EM/人協調` });
            }
          }
          const parent = allTasks.find(t => t.id === taskId);
          if (parent && parent.id !== subTaskId) {
            const subs = allTasks.filter(t => t.parentId === taskId);
            if (subs.length > 0 && subs.every(s => s.status === "close" || s.status === "ignore")) {
              parent.status = "close";
              if (!parent.resolvedAt) parent.resolvedAt = new Date().toISOString();
              parent.updatedAt = new Date().toISOString();
              if (!Array.isArray(parent.notes)) parent.notes = [];
              parent.notes.push({ by: "system", at: new Date().toISOString(), content: `✅ All ${subs.length} sub-tasks completed` });
            }
          }
          allData.tasks = allTasks;
          const { writeFileSync } = await import("node:fs");
          writeFileSync(tasksFile, JSON.stringify(allData, null, 2), "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          try { codingDb.saveTasks(projRoot, allData); } catch {} // dual-write
        }
      } catch (e) { console.error("sub-task completion update error:", e.message); }
    }

    return true;

  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    } else {
      try { res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`); res.end(); } catch {} // nosemgrep: missing-template-string-indicator
    }
    // Record timeout/error to task
    if (taskId) {
      try {
        const tasksDir = join(projRoot, ".paaw", "tasks");
        const tasksFile = join(tasksDir, "TASKS.json");
        if (existsSync(tasksFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          const allData = JSON.parse(readSync(tasksFile, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          const allTasks = allData.tasks || [];
          const tIdx = allTasks.findIndex(t => t.id === taskId);
          if (tIdx >= 0) {
            if (!Array.isArray(allTasks[tIdx].notes)) allTasks[tIdx].notes = [];
            allTasks[tIdx].notes.push({
              by: agentId,
              at: new Date().toISOString(),
              content: `⚠️ Agent ${agentId} ended with error: ${err.message.slice(0, 200)}. Work may be partially done.`,
            });
            allTasks[tIdx].status = "pending"; // 失敗 → pending，寫明原因，等人處理（不自動重試）
            allTasks[tIdx].updatedAt = new Date().toISOString();
            allData.tasks = allTasks;
            const { writeFileSync } = await import("node:fs");
            writeFileSync(tasksFile, JSON.stringify(allData, null, 2), "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          try { codingDb.saveTasks(projRoot, allData); } catch {} // dual-write
          }
        }
      } catch (e) { console.error("post-dispatch error task update:", e.message); }
    }

  }
  return true;
}

// ── Crew Conversation Persistence ──
// ── Conversation / Session APIs ──
// ══ QA Results — QA 記錄共享存儲（2026-09-17 Fleming：qa agent 留記錄、其他 agent 讀寫）══
// 儲存 <cwd>/.paaw/coding-memory/qa-results.jsonl；設計文件見 OpenClaw memory/qa-results-api-design.md
//
// GET    /api/coding-crew/qa-results?cwd=&verdict=&status=&actor=&type=&taskId=&feature=&q=&limit= — 列表（新→舊）
// POST   /api/coding-crew/qa-results {cwd, actor?, type?, target, url?, taskId?, feature?, verdict, summary, issues?, evidence?, durationMs?}
// GET    /api/coding-crew/qa-results/:id?cwd=   — 單筆
// PATCH  /api/coding-crew/qa-results/:id {cwd, status?, issueIndex?|issueDesc?, issueStatus?, note?, summary?, addEvidence?, by?}
// DELETE /api/coding-crew/qa-results/:id?cwd=   — 刪除（清理用）
// GET    /api/coding-crew/qa-results?cwd=&stats=1 — 統計（total/open/failOpen/byVerdict）
const qaResultsMatch = url.match(/^\/api\/coding-crew\/qa-results\/([^/?]+)$/);
if (qaResultsMatch && (method === "GET" || method === "PATCH" || method === "DELETE")) {
  let id;
  try { id = sanitizeId(decodeURIComponent(qaResultsMatch[1])); } catch (err) { return sendPathTraversalError(res, err); }
  let cwd = q.cwd || PAAW_ROOT;
  if (method === "PATCH") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    if (body.cwd) cwd = body.cwd;
    const rec = updateQaResult(cwd, id, body, body.by || body.actor || "human");
    if (!rec) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "QA result not found", id }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, record: rec }));
    }
    return true;
  }
  if (method === "DELETE") {
    const ok = deleteQaResult(cwd, id);
    res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok }));
    return true;
  }
  const rec = getQaResult(cwd, id);
  if (!rec) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "QA result not found", id }));
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, record: rec }));
  }
  return true;
}
if (url === "/api/coding-crew/qa-results" && method === "GET") {
  const cwd = q.cwd === "@paaw" ? PAAW_ROOT : (q.cwd || PAAW_ROOT); // "@paaw" = 全域 chat（project-ai/notes-ai）的虛擬 cwd
  if (q.stats === "1" || q.stats === "true") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, stats: qaStats(cwd) }));
    return true;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, results: listQaResults(cwd, q) }));
  return true;
}
if (url === "/api/coding-crew/qa-results" && method === "POST") {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return true;
  }
  try {
    // 2026-10-22 lineage 制：自動綁樹 — 記錄當下 HEAD（RR qa-records scope 綁定用）
    const qaCwd = body.cwd || q.cwd || PAAW_ROOT;
    let headSha = body.headSha || null;
    if (!headSha) {
      try {
        const { shellExec } = await import("../lib/shell-exec.mjs");
        const { stdout } = await shellExec("git rev-parse HEAD", { cwd: qaCwd, timeout: 5000 });
        headSha = (stdout || "").trim() || null;
      } catch { /* 非 git 目錄 → 不綁 */ }
    }
    const record = saveQaResult(qaCwd, { ...body, headSha });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, record }));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
  return true;
}

// New structure: .paaw/coding-memory/conversations/{agentId}/active.json + s-*.json history
//
// GET    /api/coding-crew/conversations?cwd=...                              — List all agents with conversations
// GET    /api/coding-crew/conversations/:crewId?cwd=...                     — Load active conversation
// POST   /api/coding-crew/conversations/:crewId?cwd=...                     — Save active conversation
// DELETE /api/coding-crew/conversations/:crewId?cwd=...                     — Clear active conversation
// POST   /api/coding-crew/conversations/:crewId/new-session?cwd=...         — Archive active + start new (like /new)
// GET    /api/coding-crew/conversations/:crewId/sessions?cwd=...            — List all sessions (active + history)
// GET    /api/coding-crew/conversations/:crewId/sessions/:sessionId?cwd=... — Load specific session
// DELETE /api/coding-crew/conversations/:crewId/sessions/:sessionId?cwd=... — Delete a session
// POST   /api/coding-crew/conversations/:crewId/switch/:sessionId?cwd=...  — Switch to a history session

// Helper: resolve conversation paths for an agent
function getConvPaths(cwd, crewId) {
  const agentDir = join(cwd, ".paaw", "coding-memory", "conversations", crewId);
  return {
    agentDir,
    activeFile: join(agentDir, "active.json"),
  };
}

// ── Security: validate crewId / sessionId against path traversal ──
// sanitizeId / sendPathTraversalError now come from ../lib/coding-security.mjs

// Helper: read conversation from file (handles both old flat + new dir format)
async function readConvFile(filePath) {
  if (!existsSync(filePath)) return { messages: [], _meta: {} };
  try {
    const data = JSON.parse(readSync(filePath, "utf-8"));
    if (Array.isArray(data)) return { messages: data, _meta: {} };
    return { messages: data.messages || [], _meta: data._meta || {} };
  } catch {
    return { messages: [], _meta: {} };
  }
}

// ── Migrate old flat files → new directory structure ──
async function migrateFlatConversations(cwd) {
  const convDir = join(cwd, ".paaw", "coding-memory", "conversations");
  if (!existsSync(convDir)) return;
  const entries = await readdir(convDir);
  for (const entry of entries) {
    const entryPath = join(convDir, entry);
    const stat = await import("fs").then(fs => fs.statSync(entryPath));
    // If it's a .json file (old flat format), move to {agentId}/active.json
    if (entry.endsWith(".json") && stat.isFile()) {
      const agentId = entry.replace(".json", "");
      const agentDir = join(convDir, agentId);
      const newFile = join(agentDir, "active.json");
      if (!existsSync(agentDir)) await mkdir(agentDir, { recursive: true });
      if (!existsSync(newFile)) {
        const { rename } = await import("fs/promises");
        await rename(entryPath, newFile);
        console.log(`[conv-migrate] ${entry} → ${agentId}/active.json`);
      } else {
        await unlink(entryPath); // new file already exists, remove old
      }
    }
    // If it's old .archive directory, move each archive .json to parent as s-*.json
    if (entry.endsWith(".archive") && stat.isDirectory()) {
      const agentId = entry.replace(".archive", "");
      const agentDir = join(convDir, agentId);
      if (!existsSync(agentDir)) await mkdir(agentDir, { recursive: true });
      try {
        const archiveFiles = await readdir(entryPath);
        for (const af of archiveFiles.filter(f => f.endsWith(".json"))) {
          const src = join(entryPath, af);
          const data = JSON.parse(readSync(src, "utf-8"));
          const archivedAt = data._meta?.archivedAt || new Date().toISOString();
          const tsStr = archivedAt.replace(/[:.]/g, "-").slice(0, 19);
          const dest = join(agentDir, `s-${tsStr}.json`);
          if (!existsSync(dest)) {
            const { rename } = await import("fs/promises");
            await rename(src, dest);
          } else {
            await unlink(src);
          }
        }
        // Remove empty .archive directory
        const { rmdir } = await import("fs/promises");
        try { await rmdir(entryPath); } catch {} // not empty = ok
      } catch (e) {
        console.error(`[conv-migrate] Failed to migrate archive ${entry}:`, e.message);  // nosemgrep: unsafe-formatstring
      }
    }
  }
}

// Run migration on first request
await migrateFlatConversations(q.cwd || PAAW_ROOT);

// ── Console log 輪詢已移到 routes/janitor.mjs（GET /api/logs/console — 本檔 gate 擋不到）──


// GET /api/coding-crew/conversations/:crewId?cwd=... — load active conversation
const convLoadMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/?]+)(?:\?.*)?$/);
if (convLoadMatch && method === "GET") {
  let crewId;
  try {
    crewId = sanitizeId(decodeURIComponent(convLoadMatch[1]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  const cwd = q.cwd === "@paaw" ? PAAW_ROOT : (q.cwd || PAAW_ROOT); // "@paaw" = 全域 chat（project-ai/notes-ai）的虛擬 cwd
  const { activeFile } = getConvPaths(cwd, crewId);
  // Phase B：先讀 coding.db，無資料 fallback 檔案
  try {
    const doc = codingDb.readConversation(cwd, crewId, "active");
    if (doc && doc.messages.length) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: doc.messages, crewId }));
      return true;
    }
  } catch { /* db 掛了走檔案 */ }
  try {
    const data = await readConvFile(activeFile);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ messages: data.messages, crewId }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// POST /api/coding-crew/conversations/:crewId?cwd=... — save active conversation
if (convLoadMatch && method === "POST") {
  let crewId;
  try {
    crewId = sanitizeId(decodeURIComponent(convLoadMatch[1]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  const cwd = q.cwd === "@paaw" ? PAAW_ROOT : (q.cwd || PAAW_ROOT); // "@paaw" = 全域 chat（project-ai/notes-ai）的虛擬 cwd
  const { agentDir, activeFile } = getConvPaths(cwd, crewId);
  let body;
  try { body = JSON.parse(await readBody(req)); } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return true;
  }
  try {
    await mkdir(agentDir, { recursive: true }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    const payload = {
      _meta: {
        crewId,
        lastUpdated: new Date().toISOString(),
        messageCount: (body.messages || []).length,
      },
      messages: body.messages || [],
    };
    await writeFile(activeFile, JSON.stringify(payload, null, 2), "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    try { codingDb.saveConversation(cwd || PAAW_ROOT, crewId, payload); } catch {} // dual-write
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, crewId, messageCount: payload.messages.length }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// DELETE /api/coding-crew/conversations/:crewId?cwd=... — clear active conversation
if (convLoadMatch && method === "DELETE") {
  let crewId;
  try {
    crewId = sanitizeId(decodeURIComponent(convLoadMatch[1]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  const cwd = q.cwd === "@paaw" ? PAAW_ROOT : (q.cwd || PAAW_ROOT); // "@paaw" = 全域 chat（project-ai/notes-ai）的虛擬 cwd
  const { activeFile } = getConvPaths(cwd, crewId);
  try {
    if (existsSync(activeFile)) { await unlink(activeFile); } // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, crewId }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// POST /api/coding-crew/conversations/:crewId/new-session?cwd=... — archive active + start new (like /new)
const newSessionMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/new-session(?:\?.*)?$/);
if (newSessionMatch && method === "POST") {
  let crewId;
  try {
    crewId = sanitizeId(decodeURIComponent(newSessionMatch[1]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  const cwd = q.cwd === "@paaw" ? PAAW_ROOT : (q.cwd || PAAW_ROOT); // "@paaw" = 全域 chat（project-ai/notes-ai）的虛擬 cwd
  const { agentDir, activeFile } = getConvPaths(cwd, crewId);
  try {
    const data = await readConvFile(activeFile);
    if (data.messages.length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crewId, archived: false, message: "Empty conversation" }));
      return true;
    }
    // Move active.json → s-{timestamp}.json
    const ts = new Date();
    // 2026-10-01 治本：帶毫秒 — 同秒兩次歸檔檔名碰撞會靜默覆蓋（實測踩到）
    const tsStr = ts.toISOString().replace(/[:.]/g, "-").slice(0, 23);
    const firstUser = data.messages.find(m => m.role === "user");
    const preview = firstUser ? firstUser.content.slice(0, 40).replace(/[^\w\u4e00-\u9fff -]/g, "").trim() : "conversation";
    const sessionFile = join(agentDir, `s-${tsStr}.json`);
    // Update meta before saving as session
    data._meta.archivedAt = ts.toISOString();
    data._meta.title = firstUser ? firstUser.content.slice(0, 60) : "對話";
    data._meta.sessionId = `s-${tsStr}`;
    await writeFile(sessionFile, JSON.stringify(data, null, 2), "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    try { codingDb.saveConversation(cwd || PAAW_ROOT, crewId, data, { session: `s-${tsStr}` }); } catch {} // dual-write
    // Clear active
    await unlink(activeFile); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, crewId, archived: true, sessionId: `s-${tsStr}`, messageCount: data.messages.length }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// GET /api/coding-crew/conversations/:crewId/sessions?cwd=... — list all sessions
const sessionsListMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/sessions(?:\?.*)?$/);
if (sessionsListMatch && method === "GET") {
  let crewId;
  try {
    crewId = sanitizeId(decodeURIComponent(sessionsListMatch[1]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  const cwd = q.cwd === "@paaw" ? PAAW_ROOT : (q.cwd || PAAW_ROOT); // "@paaw" = 全域 chat（project-ai/notes-ai）的虛擬 cwd
  const { agentDir, activeFile } = getConvPaths(cwd, crewId);
  // Phase B：先讀 coding.db，無資料 fallback 檔案
  try {
    const sessions = [];
    for (const s of codingDb.readConversationSessions(cwd, crewId)) {
      const doc = codingDb.readConversation(cwd, crewId, s.sessionId);
      if (!doc || !doc.messages.length) continue;
      sessions.push({
        sessionId: s.sessionId,
        title: doc._meta?.title || doc.messages.find(m => m.role === "user")?.content.slice(0, 60) || (s.active ? "目前對話" : "對話"),
        messageCount: doc.messages.length,
        lastUpdated: doc._meta?.lastUpdated || null,
        isActive: s.active,
      });
    }
    if (sessions.length) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions }));
      return true;
    }
  } catch { /* db 掛了走檔案 */ }
  try {
    const sessions = [];
    // Active session
    const activeData = await readConvFile(activeFile);
    if (activeData.messages.length > 0) {
      sessions.push({
        sessionId: "active",
        title: activeData._meta?.title || activeData.messages.find(m => m.role === "user")?.content.slice(0, 60) || "目前對話",
        messageCount: activeData.messages.length,
        lastUpdated: activeData._meta?.lastUpdated || null,
        isActive: true,
      });
    }
    // History sessions
    if (existsSync(agentDir)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      const files = await readdir(agentDir); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      for (const f of files.filter(f => f.startsWith("s-") && f.endsWith(".json")).sort().reverse()) {
        try {
          const data = JSON.parse(readSync(join(agentDir, f), "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
          sessions.push({
            sessionId: f.replace(".json", ""),
            title: data._meta?.title || data.messages?.find(m => m.role === "user")?.content?.slice(0, 60) || "對話",
            messageCount: data._meta?.messageCount || data.messages?.length || 0,
            lastUpdated: data._meta?.archivedAt || data._meta?.lastUpdated || null,
            isActive: false,
          });
        } catch {}
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessions }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// GET /api/coding-crew/conversations/:crewId/sessions/:sessionId?cwd=... — load specific session
const sessionLoadMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/sessions\/([^?]+)/);
if (sessionLoadMatch && method === "GET") {
  let crewId;
  try {
    crewId = sanitizeId(decodeURIComponent(sessionLoadMatch[1]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  let sessionId;
  try {
    sessionId = sanitizeId(decodeURIComponent(sessionLoadMatch[2]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  const cwd = q.cwd === "@paaw" ? PAAW_ROOT : (q.cwd || PAAW_ROOT); // "@paaw" = 全域 chat（project-ai/notes-ai）的虛擬 cwd
  const { agentDir, activeFile } = getConvPaths(cwd, crewId);
  // Phase B：先讀 coding.db，無資料 fallback 檔案
  if (sessionId === "active" || sessionId.startsWith("s-")) {
    try {
      const doc = codingDb.readConversation(cwd, crewId, sessionId);
      if (doc && doc.messages.length) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages: doc.messages, meta: doc._meta, crewId, sessionId }));
        return true;
      }
    } catch { /* db 掛了走檔案 */ }
  }
  try {
    const filePath = sessionId === "active" ? activeFile : join(agentDir, `${sessionId}.json`);
    const data = await readConvFile(filePath);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ messages: data.messages, meta: data._meta, crewId, sessionId }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// DELETE /api/coding-crew/conversations/:crewId/sessions/:sessionId?cwd=... — delete a history session
if (sessionLoadMatch && method === "DELETE") {
  let crewId;
  try {
    crewId = sanitizeId(decodeURIComponent(sessionLoadMatch[1]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  let sessionId;
  try {
    sessionId = sanitizeId(decodeURIComponent(sessionLoadMatch[2]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  const cwd = q.cwd === "@paaw" ? PAAW_ROOT : (q.cwd || PAAW_ROOT); // "@paaw" = 全域 chat（project-ai/notes-ai）的虛擬 cwd
  const { agentDir } = getConvPaths(cwd, crewId);
  try {
    if (sessionId === "active") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Cannot delete active session, use DELETE /conversations/:crewId" }));
      return true;
    }
    const filePath = join(agentDir, `${sessionId}.json`);
    if (existsSync(filePath)) { await unlink(filePath); } // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    try { codingDb.deleteConversationSession(cwd, crewId, sessionId); } catch {} // dual-write
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, crewId, sessionId }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// POST /api/coding-crew/conversations/:crewId/switch/:sessionId?cwd=... — switch to a history session
const switchSessionMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/switch\/([^?]+)/);
if (switchSessionMatch && method === "POST") {
  let crewId;
  try {
    crewId = sanitizeId(decodeURIComponent(switchSessionMatch[1]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  let sessionId;
  try {
    sessionId = sanitizeId(decodeURIComponent(switchSessionMatch[2]));
  } catch (err) {
    return sendPathTraversalError(res, err);
  }
  const cwd = q.cwd === "@paaw" ? PAAW_ROOT : (q.cwd || PAAW_ROOT); // "@paaw" = 全域 chat（project-ai/notes-ai）的虛擬 cwd
  const { agentDir, activeFile } = getConvPaths(cwd, crewId);
  try {
    if (sessionId === "active") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Already on active session" }));
      return true;
    }
    // 🛡 2026-10-21：先確認目標 session 存在再動 active —
    // 舊碼先歸檔 active 才讀目標；目標檔不存在時 srcData 為空 → active 被歸檔後清空（原對話雖存檔但目前對話消失）
    const srcFile = join(agentDir, `${sessionId}.json`);
    if (!existsSync(srcFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Session not found: ${sessionId}` }));
      return true;
    }
    // Archive current active if it has messages
    const activeData = await readConvFile(activeFile);
    if (activeData.messages.length > 0) {
      const ts = new Date();
      // 2026-10-01 治本：帶毫秒 — 同秒兩次歸檔檔名碰撞會靜默覆蓋
      const tsStr = ts.toISOString().replace(/[:.]/g, "-").slice(0, 23);
      activeData._meta.archivedAt = ts.toISOString();
      activeData._meta.sessionId = `s-${tsStr}`;
      const archiveFile = join(agentDir, `s-${tsStr}.json`);
      await writeFile(archiveFile, JSON.stringify(activeData, null, 2), "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      await unlink(activeFile); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    }
    // Load target session → make it active（srcFile 已在上方防呆宣告）
    const srcData = await readConvFile(srcFile);
    // Write as active
    srcData._meta.lastUpdated = new Date().toISOString();
    delete srcData._meta.archivedAt;
    srcData._meta.sessionId = "active";
    await writeFile(activeFile, JSON.stringify(srcData, null, 2), "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    // Remove old session file
    await unlink(srcFile); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    try {
      if (activeData.messages.length > 0) codingDb.saveConversation(cwd, crewId, activeData, { session: activeData._meta.sessionId });
      codingDb.saveConversation(cwd, crewId, srcData); // 寫成新 active（會自動把舊 active 歸零）
      codingDb.deleteConversationSession(cwd, crewId, sessionId);
    } catch {} // dual-write
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, crewId, switchedTo: "active", messageCount: srcData.messages.length }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// POST /api/coding-crew/context-window — build optimized context window
// Body: { messages, maxTokens, systemPromptLength }
// Returns: { messages, stats: { totalInput, trimmed, summaryCreated } }
if (url === "/api/coding-crew/context-window" && method === "POST") {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return true;
  }
  const { messages = [], maxTokens = 8000, systemPromptLength = 0 } = body;
  
  // Filter: only user/assistant, skip thinking bubbles
  const clean = messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .filter(m => !m._thinking)
    .map(m => ({ role: m.role, content: (m.content || "").replace(/^💭 /, "") }));
  
  // Rough token estimate: ~4 chars per token for mixed CJK/English
  const estimateTokens = (text) => Math.ceil((text || "").length / 4);
  
  // Reserve tokens for system prompt + current message + response
  const reservedTokens = systemPromptLength + 2000; // system + response budget
  const budget = maxTokens - reservedTokens;
  
  // Greedy fill from most recent backwards
  const selected = [];
  let usedTokens = 0;
  for (let i = clean.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(clean[i].content);
    if (usedTokens + msgTokens > budget && selected.length > 0) break;
    selected.unshift(clean[i]);
    usedTokens += msgTokens;
  }
  
  // If we trimmed messages, create a summary of what was cut
  const trimmedCount = clean.length - selected.length;
  let summary = null;
  if (trimmedCount > 0) {
    const trimmedMessages = clean.slice(0, trimmedCount);
    // Build a compact summary of trimmed messages
    const summaryParts = trimmedMessages.map(m => {
      const role = m.role === "user" ? "👤" : "🤖";
      return `${role} ${m.content.slice(0, 150)}`;
    });
    summary = `[Earlier conversation summary (${trimmedCount} messages trimmed)]:\n${summaryParts.join("\n")}`;
  }
  
  const result = {
    messages: summary ? [{ role: "system", content: summary }, ...selected] : selected,
    stats: {
      totalInput: clean.length,
      included: selected.length,
      trimmed: trimmedCount,
      estimatedTokens: usedTokens + (summary ? estimateTokens(summary) : 0),
      summaryCreated: summary !== null,
    },
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
  return true;
}

// ── GET /api/coding-crew/action-log — Read action log ──
// ── GET /api/coding-project/ru-log — 讀 RU 的 app console log（人 UI + agent 經由 api 同源）──
// 2026-09-12 Fleming：agent 經由 api 看目前 RU 的 log，幫開發/看開發時產生的問題
if (url === "/api/coding-project/ru-log" && method === "GET") {
  const { readDevLog } = await import("../lib/dev-server.mjs");
  const ruRoot = projectPath ? resolve(projectPath) : PAAW_ROOT;
  const out = await readDevLog(ruRoot, {
    lines: q.lines || 100,
    grep: q.grep || undefined,
    date: q.date || undefined,
    list: q.list === "1" || q.list === "true",
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, ru: ruRoot, text: out }));
  return true;
}

if (url.startsWith("/api/coding-crew/action-log") && method === "GET") {
  const { listActionLog } = await import("../lib/action-log.mjs");
  const params = new URL(url, `http://localhost`).searchParams;
  const agent = params.get("agent") || undefined;
  const limit = parseInt(params.get("limit") || "20");
  const { entries, text } = await listActionLog({ cwd: projectPath || PAAW_ROOT, agent, limit });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ entries, text }));
  return true;
}

// ── POST /api/coding-crew/em-plan — EM Plan only (no execute) ──
if (url === "/api/coding-crew/em-plan" && method === "POST") {
  const body = await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); });
  const { cwd, since, model } = JSON.parse(body || "{}");
  const rootDir = cwd || projectPath || PAAW_ROOT;

  let nsConfig = null;
  try {
    const nsConfigPath = join(rootDir, ".paaw", "auto-dispatch", "config.json");
    if (existsSync(nsConfigPath)) nsConfig = JSON.parse(readSync(nsConfigPath, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
  } catch {}
  const modelOverride = model || nsConfig?.model?.primary || undefined;
  const fallbackModels = nsConfig?.model?.fallbacks || [];

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

  const sendSSE = (type, data) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  try {
    const { planEMSession } = await import("../lib/auto-dispatch-manager.mjs");
    sendSSE("start", { message: "🎖️ EM 規劃啟動", ts: new Date().toISOString() });
    const { workList, situationReport } = await planEMSession({ rootDir, sendSSE, since, modelOverride, fallbackModels });
    sendSSE("plan_ready", { workList, situationReport });
  } catch (err) {
    console.error("[EM-Plan] error:", err);
    sendSSE("error", { message: `❌ EM 規劃失敗：${err.message}`, isError: true });
  }
  if (!res.writableEnded) res.end();
  return true;
}

// ── POST /api/coding-crew/em-execute — EM Execute with confirmed workList ──
if (url === "/api/coding-crew/em-execute" && method === "POST") {
  const body = await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); });
  const { cwd, workList, situationReport, model } = JSON.parse(body || "{}");
  const rootDir = cwd || projectPath || PAAW_ROOT;

  let nsConfig = null;
  try {
    const nsConfigPath = join(rootDir, ".paaw", "auto-dispatch", "config.json");
    if (existsSync(nsConfigPath)) nsConfig = JSON.parse(readSync(nsConfigPath, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
  } catch {}
  const modelOverride = model || nsConfig?.model?.primary || undefined;
  const fallbackModels = nsConfig?.model?.fallbacks || [];

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

  const sendSSE = (type, data) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  try {
    const { executeEMSession } = await import("../lib/auto-dispatch-manager.mjs");
    sendSSE("start", { message: "🎖️ EM 開始執行", ts: new Date().toISOString() });
    const { report, results } = await executeEMSession({ rootDir, workList, situationReport, modelOverride, fallbackModels, sendSSE, projectPhase: nsConfig?.projectPhase || 'bootstrap' });
    sendSSE("complete", { workList, results, report });
  } catch (err) {
    console.error("[EM-Execute] error:", err);
    sendSSE("error", { message: `❌ EM 執行失敗：${err.message}`, isError: true });
  }
  if (!res.writableEnded) res.end();
  return true;
}

// ── POST /api/coding-crew/interrupt — Terminate a running agent ──
// Must be BEFORE projectPath check — interrupt doesn't need a project path
// 2026-09-15：body 可帶 cwd 精準中斷該 RU 的 run；帶了 cwd 沒命中就不動（不誤殺其他 RU），沒帶 cwd 掃 agentId prefix（舊行為相容）
if (url === "/api/coding-crew/interrupt" && method === "POST") {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
  const { agentId: aid, cwd: icwd } = body;
  if (!aid) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "Missing agentId" })); return true; }

  let hit = null; // { key, info }
  if (icwd) {
    const k = `${aid}::${resolve(icwd)}`;
    const v = runningCodingAgents.get(k);
    if (v) hit = { key: k, info: v };
  } else {
    for (const [k, v] of runningCodingAgents) {
      if (k.startsWith(`${aid}::`)) { hit = { key: k, info: v }; break; }
    }
  }

  if (!hit) {
    // Also check A2A running streams（cwd-aware — 帶 cwd 精準、沒帶掃 prefix）
    let a2aHit = null;
    try {
      const a2aMod = await import("./a2a.mjs");
      a2aHit = a2aMod.findRunningStream(aid, icwd);
      if (a2aHit) {
        a2aHit.stream.abortController.abort();
        try { if (!a2aHit.stream.res.writableEnded) { a2aHit.stream.res.write("event: interrupted\ndata: " + JSON.stringify({ message: "Interrupted by user", agentId: aid }) + "\n\n"); a2aHit.stream.res.end(); } } catch {}
        a2aMod.runningStreams.delete(a2aHit.key);
      }
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: `No coding agent '${aid}' running${a2aHit ? ` (interrupted via A2A: ${a2aHit.key})` : ""}` }));
    return true;
  }
  hit.info.abortController.abort();
  try {
    if (!hit.info.res.writableEnded) {
      hit.info.res.write("event: interrupted\ndata: " + JSON.stringify({ message: "Agent terminated by user", agentId: aid }) + "\n\n");
      hit.info.res.end();
    }
  } catch {}
  runningCodingAgents.delete(hit.key);
  console.log(`[CodingCrew] Interrupted agent '${hit.key}'`);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, message: `Agent '${hit.key}' terminated` }));
  return true;
}

// ── GET /api/coding-crew/running — List running agents ──
// Must be BEFORE projectPath check
if (url === "/api/coding-crew/running" && method === "GET") {
  const agents = [];
  for (const [id, info] of runningCodingAgents.entries()) {
    const sep = id.indexOf("::"); // 2026-09-15：compound key agentId::projRoot 拆回兩欄
    const agentId = sep > 0 ? id.slice(0, sep) : id;
    const cwd = sep > 0 ? id.slice(sep + 2) : info.projRoot || null;
    agents.push({ agentId, cwd, source: info.source, startedAt: info.startedAt, elapsed: Math.round((Date.now() - info.startedAt) / 1000) });
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, agents }));
  return true;
}

// ════════════════════════════════════════════════════════
// ── Per-Project Crew Management (Phase 1: Data Layer) ──
// ════════════════════════════════════════════════════════

// ── CU step skill 綁定 — GET 讀綁定 / PUT 更新（用 crew.json skillBindings["cu.<stepId>"]）──
if (url.startsWith("/api/coding-project/cu-skills") && (req.method === "GET" || req.method === "PUT" || req.method === "POST")) {
  const { readJson, getConfigPath, DEFAULT_CU_STEP_SKILLS } = await import("../lib/project-crew.mjs");
  const { updateAgentSkills } = await import("../lib/project-crew.mjs");
  const config = readJson(getConfigPath(projectPath), null) || {};
  // GET：回有效綁定（explicit 專案設定 > DEFAULT_CU_STEP_SKILLS 預設），並標記哪些是預設
  const bindings = {};
  const defaultsApplied = {};
  for (const stepId of Object.keys(DEFAULT_CU_STEP_SKILLS)) {
    const explicit = config.skillBindings?.[`cu.${stepId}`];
    if (Array.isArray(explicit)) {
      if (explicit.length > 0) bindings[stepId] = explicit;
    } else {
      bindings[stepId] = DEFAULT_CU_STEP_SKILLS[stepId];
      defaultsApplied[stepId] = true;
    }
  }
  // 舊行為相容：其他有設定的 cu.* 也照回
  for (const [k, v] of Object.entries(config.skillBindings || {})) {
    if (k.startsWith("cu.") && Array.isArray(v) && v.length > 0) bindings[k.slice(3)] = v;
  }
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ bindings, defaultsApplied }));
    return true;
  }
  const body = JSON.parse(await readBody(req) || "{}");
  const stepId = body.stepId;
  if (!stepId) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "stepId required" })); return true; }
  const result = updateAgentSkills(projectPath, cuStepSkillKey(stepId), body.skills || body.skillIds || []);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, ...result }));
  return true;
}

// ── GET /api/coding-project/skills — List all available skills for SkillPicker ──
if (url.startsWith("/api/coding-project/skills") && req.method === "GET") {
  try {
    const { readdirSync, readFileSync: rf, existsSync: exists } = await import("fs");
    const { join, resolve: resv } = await import("path");
    const skillsRoot = resv(DATA_HOME, "skills");
    const skills = [];

    // Scan physical-skill and input-prompt dirs
    const scanDirs = [
      { dir: join(skillsRoot, "physical-skill"), kind: "physical" },
      { dir: join(skillsRoot, "input-prompt"), kind: "input-prompt" },
    ];
    const seen = new Set();
    for (const { dir, kind } of scanDirs) {
      if (!exists(dir)) continue;
      let dirs;
      try { dirs = readdirSync(dir); } catch { continue; }
      for (const d of dirs) {
        if (seen.has(d)) continue;
        let name = d, description = "", category = "";
        // Try SKILL.md
        const skillMd = join(dir, d, "SKILL.md");
        const inputsJson = join(dir, d, "inputs.json");
        try {
          const raw = rf(skillMd, "utf-8");
          const nm = raw.match(/^name:\s*(.+)$/m);
          const ds = raw.match(/^description:\s*(.+)$/m);
          const ct = raw.match(/^category:\s*(.+)$/m);
          if (nm) name = nm[1].trim();
          if (ds) description = ds[1].trim();
          if (ct) category = ct[1].trim();
          seen.add(d);
        } catch {
          try {
            const ij = JSON.parse(rf(inputsJson, "utf-8"));
            name = ij.name || d;
            description = ij.description || "";
            seen.add(d);
          } catch {}
        }
        skills.push({ id: d, name, description, category, kind });
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ skills }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// ── Agent Memory endpoints ──
// GET /api/coding-project/agent-memory?path=...&agentId=coding.architect
if (url.startsWith("/api/coding-project/agent-memory") && req.method === "GET") {
  try {
    const projectDir = q.path || "";
    const agentId = q.agentId || "";
    if (!projectDir || !agentId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path and agentId required" }));
      return true;
    }
    const { loadAgentMemory } = await import("../lib/action-log.mjs");
    const content = await loadAgentMemory(agentId, projectDir, 999999);
    // Get file stats — check both full and short form filenames
    const shortId = agentId.replace(/^(coding\.|custom\.)/, "");
    const memPaths = [
      join(projectDir, ".paaw", "agent-memory", `${agentId}.md`),
      join(projectDir, ".paaw", "agent-memory", `${shortId}.md`),
    ];
    let updatedAt = null, size = 0;
    for (const mp of memPaths) {
      try { const stat = await fsStat(mp); updatedAt = stat.mtime; size = stat.size; break; } catch {}
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ agentId, content, updatedAt, size }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// PUT /api/coding-project/agent-memory — Save agent memory
if (url.startsWith("/api/coding-project/agent-memory") && req.method === "PUT") {
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    const { path: projectDir, agentId, content } = body;
    if (!projectDir || !agentId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path and agentId required" }));
      return true;
    }
    const { saveAgentMemory } = await import("../lib/action-log.mjs");
    await saveAgentMemory(agentId, content, projectDir);
    const memPath = join(projectDir, ".paaw", "agent-memory", `${agentId}.md`);
    let updatedAt = null, size = 0;
    try { const stat = await fsStat(memPath); updatedAt = stat.mtime; size = stat.size; } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, agentId, updatedAt, size }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// DELETE /api/coding-project/agent-memory — Clear agent memory
if (url.startsWith("/api/coding-project/agent-memory") && req.method === "DELETE") {
  try {
    const projectDir = q.path || "";
    const agentId = q.agentId || "";
    if (!projectDir || !agentId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path and agentId required" }));
      return true;
    }
    const shortId = agentId.replace(/^(coding\.|custom\.)/, "");
    const memPaths = [
      join(projectDir, ".paaw", "agent-memory", `${agentId}.md`),
      join(projectDir, ".paaw", "agent-memory", `${shortId}.md`),
    ];
    for (const mp of memPaths) {
      try { await unlink(mp); } catch {} // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, agentId }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// ── Crew Export/Import endpoints ──
// GET /api/coding-project/crew-export?path=...
if (url.startsWith("/api/coding-project/crew-export") && req.method === "GET") {
  try {
    const projectDir = q.path || "";
    if (!projectDir) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path required" }));
      return true;
    }
    const { readProjectCrew, readProjectSkills } = await import("../lib/project-crew.mjs");
    const { agents, config } = readProjectCrew(projectDir);
    const skillBindings = {};
    for (const a of agents) {
      const skills = readProjectSkills(projectDir, a.id);
      if (skills.length > 0) skillBindings[a.id] = skills.map(s => s.id);
    }
    // Read all agent memories
    const memDir = join(projectDir, ".paaw", "agent-memory");
    const memories = {};
    try {
      const memFiles = await readdir(memDir); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      for (const f of memFiles) {
        if (f.endsWith(".md")) {
          const agentId = f.replace(/\.md$/, "");
          memories[agentId] = await readFile(join(memDir, f), "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
        }
      }
    } catch {}
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      agents: agents.map(({ _source, _clonedAt, _updatedAt, _createdAt, _resetAt, ...rest }) => rest),
      config,
      skillBindings,
      memories,
    };
    res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=crew-export.json" });
    res.end(JSON.stringify(exportData, null, 2));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// POST /api/coding-project/crew-import — Import crew config
if (url.startsWith("/api/coding-project/crew-import") && req.method === "POST") {
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    const { path: projectDir, data } = body;
    if (!projectDir || !data) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path and data required" }));
      return true;
    }
    const { initProjectCrew, updateProjectAgent, updateAgentModel, updateAgentSkills } = await import("../lib/project-crew.mjs");
    const { saveAgentMemory } = await import("../lib/action-log.mjs");
    // Initialize crew structure
    initProjectCrew(projectDir);
    let imported = 0, skipped = 0;
    // Import agents (only non-default fields are patched)
    if (data.agents) {
      for (const agent of data.agents) {
        try {
          // Only patch fields that differ from defaults
          const patch = {};
          const skipKeys = new Set(["id", "_source", "_clonedAt", "_updatedAt", "_createdAt", "_resetAt"]);
          for (const [k, v] of Object.entries(agent)) {
            if (!skipKeys.has(k) && v !== undefined) patch[k] = v;
          }
          if (Object.keys(patch).length > 0) {
            updateProjectAgent(projectDir, agent.id, patch);
            imported++;
          } else {
            skipped++;
          }
        } catch { skipped++; }
      }
    }
    // Import models
    if (data.config?.models) {
      for (const [agentId, modelCfg] of Object.entries(data.config.models)) {
        try { updateAgentModel(projectDir, agentId, modelCfg); } catch {}
      }
    }
    // Import skill bindings
    if (data.skillBindings) {
      for (const [agentId, skills] of Object.entries(data.skillBindings)) {
        try { updateAgentSkills(projectDir, agentId, skills); } catch {}
      }
    }
    // Import memories
    if (data.memories) {
      for (const [agentId, content] of Object.entries(data.memories)) {
        try { await saveAgentMemory(agentId, content, projectDir); } catch {}
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, imported, skipped }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
  return true;
}

// These must come before the generic /create route
if (url.startsWith("/api/coding-project/crew")) {
  const { initProjectCrew, readProjectCrew, readProjectAgent, updateProjectAgent, createCustomAgent, deleteCustomAgent, resetProjectAgent, updateAgentModel, updateAgentSkills } = await import("../lib/project-crew.mjs");
  const crewUrl = url.replace(/^\/api\/coding-project\/crew/, "") || "/";
  const crewPathParts = crewUrl.replace(/^\//, "").split("/");
  const agentIdParam = crewPathParts[0] ? decodeURIComponent(crewPathParts[0]) : null;
  const cwd = q.path || projectPath || PAAW_ROOT;
  const projectDir = resolve(cwd);
  const isSub = crewPathParts.length > 1; // /crew/:agentId/reset|model|skills
  const subAction = isSub ? crewPathParts[1] : null;

  // POST /api/coding-project/crew/init — Initialize project crew from global templates
  if (crewUrl === "/init" && method === "POST") {
    const body = JSON.parse(await readBody(req) || "{}");
    try {
      const result = initProjectCrew(projectDir, { force: body.force || false });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/coding-project/crew — List all agents (merged global + project + custom)
  if ((method === "GET") && !agentIdParam) {
    try {
      const result = readProjectCrew(projectDir);
      // 2026-10-11 Fleming：每個 agent「可用工具」唯讀呈現（firmware toolGroups → 實際工具清單）
      // 純檢視用途 — 只加到回應，不寫回 crew json（PATCH 白名單不含 tools）
      try {
        const { getAgentByCrewId } = await import("../lib/domain-agent-registry.mjs");
        const { getToolsForAgent } = await import("../lib/paaw-agent-loop.mjs");
        for (const a of result.agents) {
          const ag = getAgentByCrewId(a.id);
          if (!ag) continue;
          try {
            a.tools = getToolsForAgent(ag.agentId, [], projectDir).map(t => t.function?.name).filter(Boolean);
          } catch { a.tools = null; }
        }
      } catch { /* 工具清單非必要 — 失敗不影響 crew 讀取 */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/coding-project/crew — Create new custom agent
  if (method === "POST" && !agentIdParam) {
    const body = JSON.parse(await readBody(req) || "{}");
    try {
      const created = createCustomAgent(projectDir, body);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(created));
    } catch (err) {
      res.writeHead(err.message.includes("exists") || err.message.includes("must start") ? 400 : 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Routes with :agentId
  if (agentIdParam) {
    // POST /api/coding-project/crew/:agentId/reset — Reset to global default
    if (subAction === "reset" && method === "POST") {
      try {
        const result = resetProjectAgent(projectDir, agentIdParam);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(err.message.includes("No global") ? 404 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // PATCH /api/coding-project/crew/:agentId/model — Update per-agent model
    if (subAction === "model" && method === "PATCH") {
      const body = JSON.parse(await readBody(req) || "{}");
      try {
        const result = updateAgentModel(projectDir, agentIdParam, body);
        // 2026-10-11（B）：清 crew 快取（含 _crewReasoningCache）→ reasoning/model 改完免重啟即生效
        try { (await import("../lib/paaw-agent-loop.mjs")).clearCrewGroupCache(); } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // PUT /api/coding-project/crew/:agentId/skills — Update skill bindings
    if (subAction === "skills" && (method === "PUT" || method === "POST")) {
      const body = JSON.parse(await readBody(req) || "{}");
      try {
        const result = updateAgentSkills(projectDir, agentIdParam, body.skills || body.skillIds || []);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // GET /api/coding-project/crew/:agentId — Read single agent
    if (method === "GET" && !subAction) {
      try {
        const agent = readProjectAgent(projectDir, agentIdParam);
        if (!agent) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Agent not found: ${agentIdParam}` }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(agent));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // PATCH /api/coding-project/crew/:agentId — Update agent
    if (method === "PATCH" && !subAction) {
      const body = JSON.parse(await readBody(req) || "{}");
      try {
        const updated = updateProjectAgent(projectDir, agentIdParam, body);
        // 2026-09-06：crew 變更（含 toolGroups / rolePrompt）→ 清 agent-loop 的 group 快取，免重啟生效
        const { clearCrewGroupCache } = await import("../lib/paaw-agent-loop.mjs");
        clearCrewGroupCache();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(updated));
      } catch (err) {
        res.writeHead(err.message.includes("not found") ? 404 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // DELETE /api/coding-project/crew/:agentId — Delete custom agent
    if (method === "DELETE" && !subAction) {
      try {
        const result = deleteCustomAgent(projectDir, agentIdParam);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(err.message.includes("Only custom") || err.message.includes("not found") ? 400 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }
}

  return false;
}
