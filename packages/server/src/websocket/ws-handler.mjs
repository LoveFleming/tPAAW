/**
 * WebSocket handler for PTY sessions and PAAW Agent Loop mode.
 * Creates a standalone WebSocketServer on a separate port (4098 by default).
 */

import { WebSocketServer } from "ws";
import { spawn as ptySpawn } from "node-pty";
import { runAgentLoop } from "../lib/paaw-agent-loop.mjs";
import { DATA_HOME } from "../data-home.mjs";
import {
  PAAW_ROOT, readFileSync, writeFileSync, appendFileSync, resolve, join, mkdirSync,
} from "../routes/shared.mjs";

// Lazy-load distill module for vibe session logging
let _distillMod = null;
async function getDistillModule() {
  if (!_distillMod) {
    try { _distillMod = await import("../routes/distill.mjs"); } catch { _distillMod = { recordVibeOutput: () => {} }; }
  }
  return _distillMod;
}

// PAAW_WS_PORT env 優先；否則跟 PAAW_PORT+1 慣例（前端 fallback 同邏輯：頁面 port+1）
const WS_PORT = parseInt(process.env.PAAW_WS_PORT || String(parseInt(process.env.PAAW_PORT || "4097", 10) + 1), 10);

export function setupWebSocket() {
  const wss = new WebSocketServer({ port: WS_PORT, host: "0.0.0.0" });
  const ptySessions = new Map(); // ws -> { pty, id }
  const agentSessions = new Map(); // ws -> agent state for paaw-agent mode
  const runningAgents = new Map(); // ws -> { abortController } for interrupt
  // ── 2026-09-11 治本：斷線可回復的 agent session（Chrome refresh/斷網後 resumeSessionId 接回）──
  const resumableAgentSessions = new Map(); // sessionId -> { state, timer }
  const RESUME_TTL_MS = 10 * 60 * 1000;
  const _stashResumable = (state) => {
    if (!state?.id) return;
    const old = resumableAgentSessions.get(state.id);
    if (old?.timer) clearTimeout(old.timer);
    resumableAgentSessions.set(state.id, {
      state,
      timer: setTimeout(() => { resumableAgentSessions.delete(state.id); }, RESUME_TTL_MS),
    });
  };
  const _dropResumable = (sessionId) => {
    const old = resumableAgentSessions.get(sessionId);
    if (old?.timer) clearTimeout(old.timer);
    resumableAgentSessions.delete(sessionId);
  };

  wss.on("connection", (ws, req) => {
    const sessionId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[PTY] New session: ${sessionId}`);

    let spawned = false;

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
        // ⚠️ xterm onData 逐字元送 raw text：'7' 是合法 JSON（number），會被解析成 7 然後因無 type 被丟棄
        // 只允許 JSON object 進控制訊息流程，其他（number/boolean/null/array）一律當 raw 終端輸入
        if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
          throw new Error("raw terminal input");
        }
      } catch {
        const session = ptySessions.get(ws);
        if (session?.pty) session.pty.write(raw.toString());
        return;
      }

      if (msg.type === "spawn") {
        if (spawned) {
          console.log(`[PTY] Ignoring duplicate spawn for ${sessionId}`);
          return;
        }
        spawned = true;
        const old = ptySessions.get(ws);
        if (old?.pty) { old.pty.kill(); }

        const opts = msg.options || {};

        // ════════════════════════════════════════════════════════════
        // PAAW Agent Mode — no CLI spawn, uses runAgentLoop
        // ════════════════════════════════════════════════════════════
        if (opts.engine === "paaw-agent" || opts.cli === "paaw-agent") {
          // ── 2026-09-11 Resume：client 帶 resumeSessionId 且該 session 還在（斷線 10 分鐘內）→ 接回原 session（history/記憶體保留）──
          let resumed = null;
          if (opts.resumeSessionId && resumableAgentSessions.has(opts.resumeSessionId)) {
            resumed = resumableAgentSessions.get(opts.resumeSessionId).state;
            _dropResumable(opts.resumeSessionId);
            resumed.ws = ws; // 之後事件改送新 ws
            console.log(`[PTY] Agent session resumed: ${resumed.id} (history ${resumed.history.length} msgs, busy=${resumed.busy})`);
          }
          console.log(`[PTY] Agent mode session: ${sessionId} (cwd: ${opts.cwd || PAAW_ROOT}, systemPrompt: ${(opts.systemPrompt || "").length} chars${resumed ? `, resumed from ${resumed.id}` : ""})`);
          const agentCwd = opts.cwd || resolve(DATA_HOME, "vibe-sessions", sessionId);
          try { mkdirSync(agentCwd, { recursive: true }); } catch {}
          const agentState = resumed || {
            id: sessionId,
            mode: "paaw-agent",
            cwd: agentCwd,
            model: opts.model || null,
            systemPrompt: opts.systemPrompt || null,
            busy: false,
            history: [],
            createdAt: new Date().toISOString(),
          };
          agentState.ws = ws;
          // resume 時更新 model/systemPrompt（新頁面帶新設定）
          if (resumed) {
            if (opts.model) agentState.model = opts.model;
            if (opts.systemPrompt) agentState.systemPrompt = opts.systemPrompt;
          }
          agentSessions.set(ws, agentState);

          // Vibe session logging（resume：沿用原 session 的 log 檔，只加 resume 標記，不覆蓋 meta）
          const vibeLogDir = resolve(PAAW_ROOT, "logs/vibe-sessions");
          mkdirSync(vibeLogDir, { recursive: true });
          if (resumed) {
            if (!agentState.vibeLogFile) agentState.vibeLogFile = resolve(vibeLogDir, `${agentState.id}.log`);
            if (!agentState.vibeMetaFile) agentState.vibeMetaFile = resolve(vibeLogDir, `${agentState.id}.json`);
            try { appendFileSync(agentState.vibeLogFile, `\n# [${new Date().toISOString()}] Session resumed from ${agentState.id} (conn ${sessionId})\n\n`); } catch {}
          } else {
            const vibeLogFile = resolve(vibeLogDir, `${sessionId}.log`);
            const vibeMetaFile = resolve(vibeLogDir, `${sessionId}.json`);
            writeFileSync(vibeMetaFile, JSON.stringify({
              id: sessionId, cli: "paaw-agent", model: opts.model || null,
              cwd: agentCwd, approvalMode: opts.approvalMode || null,
              systemPrompt: opts.systemPrompt || null,
              createdAt: new Date().toISOString(), lastActive: new Date().toISOString(),
            }, null, 2));
            appendFileSync(vibeLogFile, `# PAAW Agent Session: ${sessionId}\n`);
            appendFileSync(vibeLogFile, `# Engine: paaw-agent | CWD: ${agentCwd} | Mode: ${opts.approvalMode || 'default'}\n`);
            appendFileSync(vibeLogFile, `# Started: ${new Date().toISOString()}\n\n`);
            agentState.vibeLogFile = vibeLogFile;
            agentState.vibeMetaFile = vibeMetaFile;
          }

          // ready 围回原 session id（resume 時 client 端續用同一個 id，下次斷線還能接回）
          // 2026-09-11：resume 帶回 history/busy — client 重連後重建對話、接回執行中狀態
          ws.send(JSON.stringify({
            type: "ready", sessionId: agentState.id, platform: process.platform,
            ...(resumed ? { resumed: true, busy: !!agentState.busy, history: (agentState.history || []).slice(-50) } : {}),
          }));
          ws.send(JSON.stringify({ type: "cliReady" }));
          return;
        }

        // ════════════════════════════════════════════════════════════
        // Shell Mode (system shell only — legacy CLI modes removed)
        // ════════════════════════════════════════════════════════════
        const cliType = opts.cli || "shell";
        if (cliType !== "shell") {
          ws.send(JSON.stringify({ type: "error", text: `Legacy CLI mode '${cliType}' is no longer supported. Use paaw-agent engine instead.` }));
          return;
        }

        try {
          // ── Windows: prefer PowerShell (better UTF-8 + ANSI support than cmd) ──
          // ── Mac/Linux: use user's shell ──
          let shellBin, shellArgs;
          if (process.platform === "win32") {
            shellBin = process.env.PAAW_SHELL || "powershell.exe";
            shellArgs = process.env.PAAW_SHELL ? [] : ["-NoLogo"];
          } else {
            shellBin = process.env.SHELL || "/bin/zsh";
            shellArgs = [];
          }
          const resolvedCwd = opts.cwd || process.env.QWEN_CWD || PAAW_ROOT;
          // Build env: ensure UTF-8 on Windows, inherit everything else
          // CRITICAL: Strip PAAW port env vars so child processes read their own .env
          // Without this, `npm run dev` in the terminal inherits parent's ports → EADDRINUSE
          const PAAW_ENV_KEYS = [
            "PAAW_PORT", "PAAW_WS_PORT", "BRIDGE_PORT", "VITE_PORT",
            "PAAW_ENV", "PAAW_CONTAINER", "PAAW_ROOT",
          ];
          const shellEnv = { ...process.env };
          for (const k of PAAW_ENV_KEYS) delete shellEnv[k];
          if (process.platform === "win32") {
            shellEnv.PYTHONUTF8 = "1";
            shellEnv.PYTHONIOENCODING = "utf-8";
          }
          const pty = ptySpawn(shellBin, shellArgs, {
            name: "xterm-256color",
            cols: opts.cols || 120,
            rows: opts.rows || 30,
            cwd: resolvedCwd,
            env: shellEnv,
            useConpty: process.platform === "win32",  // Use ConPTY for proper ANSI/cursor support
          });
          ptySessions.set(ws, { pty, id: sessionId, cliType, serverPort: opts.serverPort });

          // ── Session logging for Coding ──
          const vibeLogDir = resolve(PAAW_ROOT, "logs/vibe-sessions");
          mkdirSync(vibeLogDir, { recursive: true });
          const vibeLogFile = resolve(vibeLogDir, `${sessionId}.log`);
          const vibeMetaFile = resolve(vibeLogDir, `${sessionId}.json`);
          let vibeLogSize = 0;
          const stripAnsiForLog = (s) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "").replace(/\x1b\[\?\d+[hl]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          writeFileSync(vibeMetaFile, JSON.stringify({
            id: sessionId, cli: cliType, model: opts.model || null,
            cwd: opts.cwd || null, approvalMode: opts.approvalMode || null,
            systemPrompt: opts.systemPrompt || null,
            createdAt: new Date().toISOString(), lastActive: new Date().toISOString(),
          }, null, 2));
          appendFileSync(vibeLogFile, `# Coding Session: ${sessionId}\n`);
          appendFileSync(vibeLogFile, `# CLI: ${cliType} | CWD: ${opts.cwd || PAAW_ROOT} | Mode: ${opts.approvalMode || 'default'}\n`);
          appendFileSync(vibeLogFile, `# Started: ${new Date().toISOString()}\n\n`);

          // ── Detect when CLI is truly ready ──
          let cliReadyFired = false;
          let cliDoneFired = false;
          const ptyStartTime = Date.now();
          const cliReadyPatterns = {
            qwen: /(?:YOLO mode|Plan mode|Auto-edit mode|Default mode|Type your message)/,
            claude: /(?:\?>|^>?\s*$)/m,
            opencode: /(?:Welcome to OpenCode|opencode.*ready)/i,
          };
          const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "");

          pty.onData((data) => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "data", data }));
            }
            // ── Log to vibe session file ──
            try {
              const plain = stripAnsiForLog(data);
              if (plain.trim()) {
                appendFileSync(vibeLogFile, plain);
                vibeLogSize += plain.length;
                if (vibeLogSize % 4000 < plain.length) {
                  getDistillModule().then(m => m.recordVibeOutput({
                    sessionId,
                    cli: cliType,
                    cwd: opts.cwd || null,
                    output: plain.slice(-2000),
                  })).catch(() => {});
                }
              }
            } catch {}
            // Detect CLI ready from output
            if (!cliReadyFired) {
              const plain = stripAnsi(data);
              const pattern = cliReadyPatterns[cliType];
              if (!pattern || pattern.test(plain)) {
                cliReadyFired = true;
                console.log(`[PTY] CLI ready detected: ${cliType} (${sessionId})`);
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: "cliReady" }));
                }
              }
            }
            const readyOrTimeout = cliReadyFired || (Date.now() - ptyStartTime > 15000);
            if (readyOrTimeout && !cliDoneFired) {
              const plain = stripAnsi(data);
              if (/\bDONE\b|已完成|完成！|✅.*完成|^完成$|Task completed|finished|已寫入|已生成|創建完成|建立完成|app\.html.*(saved|written|created|updated)|generation.*(complete|done|finished)/i.test(plain)) {
                cliDoneFired = true;
                console.log(`[PTY] CLI done detected (${sessionId})`);
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: "cliDone" }));
                }
                setTimeout(() => { cliDoneFired = false; }, 3000);
              }
            }
          });

          pty.onExit(({ exitCode }) => {
            console.log(`[PTY] Exited: ${sessionId} (code: ${exitCode})`);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "exit", exitCode }));
            }
            ptySessions.delete(ws);
          });

          ws.send(JSON.stringify({ type: "ready", sessionId, platform: process.platform }));
          if (cliType === "shell") {
            cliReadyFired = true;
            ws.send(JSON.stringify({ type: "cliReady" }));
          }
        } catch (err) {
          console.error(`[PTY] Spawn failed:`, err.message);
          ws.send(JSON.stringify({ type: "error", message: `Failed to start CLI: ${err.message}` }));
        }
      }
      else if (msg.type === "interrupt") {
        // ── Abort running agent（resume 後 runCtx 在 agentState 上 — 2026-09-11）──
        const agentState = agentSessions.get(ws);
        const running = runningAgents.get(ws) || agentState?.runCtx;
        if (running) {
          running.aborted = true;
          running.controller?.abort(); // 即時殺 in-flight LLM 呼叫
          runningAgents.delete(ws);
          if (agentState) agentState.runCtx = null;
          console.log(`[Agent] Interrupt received for session ${running.id}`);
        }
        if (agentState) {
          agentState.busy = false;
          try { (agentState.ws || ws).send(JSON.stringify({ type: "agent_done", content: "⏹️ Agent 已中斷。", turns: 0, toolCalls: 0, success: false, interrupted: true })); } catch {}
        }
      }
      else if (msg.type === "input") {
        // ── Agent mode: run PAAW Agent Loop ──
        const agentState = agentSessions.get(ws);
        if (agentState) {
          // session-aware send：resume 後 state.ws 指向新連線（2026-09-11）
          const asend = (obj) => { try { (agentState.ws || ws).send(JSON.stringify(obj)); } catch {} };
          const userText = (msg.text || "").trim();
          // 👁 2026-09-06：AI Crew console 貼圖 — images: uploads/ 相對路徑（白名單防穿越，上限 4）
          const imgPaths = Array.isArray(msg.images)
            ? [...new Set(msg.images)].filter((p) => typeof p === "string" && /^(paaw-)?uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p)).slice(0, 4)
            : [];
          if ((!userText && imgPaths.length === 0) || agentState.busy) {
            if (agentState.busy) asend({ type: "agent_busy" });
            return;
          }
          agentState.busy = true;
          const runAbort = new AbortController();
          const runCtx = { id: agentState.id, aborted: false, controller: runAbort };
          runningAgents.set(ws, runCtx);
          agentState.runCtx = runCtx; // resume 後 interrupt 用（2026-09-11）
          asend({ type: "agent_running" });

          // 圖 → vision attachment message（僅本輪帶入，不留在 history — 避免 data URI 灌爆後續輪）
          let imageAttachment = null;
          if (imgPaths.length > 0) {
            try {
              const { buildImageAttachmentMessage } = await import("../lib/vision-content.mjs");
              const { resolveUploadRef } = await import("../routes/uploads.mjs");
              const abs = (await Promise.all(imgPaths.map((p) => resolveUploadRef(p)))).filter(Boolean);
              imageAttachment = buildImageAttachmentMessage(abs, "使用者貼的圖（AI Crew console）");
            } catch { /* 讀檔失敗降級純文字 */ }
          }
          const historyText = userText || "請看這張圖";
          agentState.history.push({ role: "user", content: historyText });

          if (agentState.vibeLogFile) {
            try { appendFileSync(agentState.vibeLogFile, `\n## User\n${userText}\n`); } catch {}
          }

          console.log(`[Agent] Running for session ${agentState.id}, prompt length: ${userText.length}`);

          try {
            const { loadAgentConfig } = await import("../routes/context.mjs");
            const { resolveLLMConfig } = await import("../lib/paaw-agent-loop.mjs");
            const agentCfg = await loadAgentConfig();
            const agentId = `sre-${agentState.id}`;

            // Resolve fallback models from provider config
            let fallbackModels;
            try {
              const { resolveDefaultModel } = await import("../lib/llm-utils.mjs");
              const providersFile = join(DATA_HOME, "config", "providers.json");
              const providerConfig = JSON.parse(readFileSync(providersFile, "utf8"));
              const activeProvider = providerConfig.providers[providerConfig.active || "zai"];
              if (activeProvider?.fallbackModels) fallbackModels = activeProvider.fallbackModels;
            } catch {}

            const agentResult = await runAgentLoop({
              ...(imageAttachment
                ? { prompt: "", messages: [...agentState.history, imageAttachment] }
                : { prompt: userText }),
              cwd: agentState.cwd,
              systemPrompt: agentState.systemPrompt || undefined,
              model: agentState.model || undefined,
              fallbackModels,
              maxTurns: agentCfg.maxTurns || 100,
              timeout: 0, // no timeout — let agent run until done or interrupted
              rootDir: PAAW_ROOT,
              agentId,
              abortSignal: runAbort.signal,
              onEvent: (evt) => {
                // Check if agent was interrupted
                if (runCtx.aborted) throw new Error("Agent interrupted by user");

                if (evt.type === "tool_start") {
                  asend({ type: "agent_event", event: "tool_start", name: evt.name, args: evt.args });
                }
                if (evt.type === "tool_end") {
                  asend({ type: "agent_event", event: "tool_end", name: evt.name, result: (evt.result || "").slice(0, 500) });
                }
                if (evt.type === "assistant_thinking") {
                  asend({ type: "agent_event", event: "thinking", content: evt.content });
                }
                if (evt.type === "assistant") {
                  asend({ type: "agent_event", event: "response", content: evt.content });
                }
              },
            });

            agentState.history.push({ role: "assistant", content: agentResult.content });

            if (agentState.vibeLogFile) {
              try { appendFileSync(agentState.vibeLogFile, `\n## Assistant\n${agentResult.content.slice(0, 5000)}\n`); } catch {}
            }

            if (!runCtx.aborted) {
              asend({
                type: "agent_done",
                content: agentResult.content,
                turns: agentResult.turns,
                toolCalls: agentResult.toolCalls?.length || 0,
                success: agentResult.success,
              });

              const donePatterns = /\bDONE\b|已完成|完成！|✅.*完成|Task completed|finished|已寫入|已生成|創建完成|建立完成/i;
              if (donePatterns.test(agentResult.content)) {
                asend({ type: "cliDone" });
              }
            }

          } catch (err) {
            if (err.message === "Agent interrupted by user") {
              console.log(`[Agent] Interrupted for session ${agentState.id}`);
              asend({ type: "agent_done", content: "⏹️ Agent 已中斷。", turns: 0, toolCalls: 0, success: false, interrupted: true });
            } else {
              console.error(`[Agent] Error for session ${agentState.id}:`, err.message);
              asend({ type: "agent_error", message: err.message });
            }
          }

          agentState.busy = false;
          agentState.runCtx = null;
          runningAgents.delete(ws);

          if (agentState.vibeMetaFile) {
            try {
              const meta = JSON.parse(readFileSync(agentState.vibeMetaFile, "utf8"));
              meta.lastActive = new Date().toISOString();
              writeFileSync(agentState.vibeMetaFile, JSON.stringify(meta, null, 2));
            } catch {}
          }
          return;
        }

        // ── Legacy CLI mode: forward to PTY ──
        const session = ptySessions.get(ws);
        if (session?.pty) {
          session.pty.write(msg.text || "");
          try {
            const vibeLogDir2 = resolve(PAAW_ROOT, "logs/vibe-sessions");
            const metaFile = resolve(vibeLogDir2, `${session.id}.json`);
            const meta = JSON.parse(readFileSync(metaFile, "utf8"));
            meta.lastActive = new Date().toISOString();
            writeFileSync(metaFile, JSON.stringify(meta, null, 2));
          } catch {}
        }
      }
      else if (msg.type === "multiline") {
        const session = ptySessions.get(ws);
        if (!session?.pty) return;
        try {
          session.pty.write((msg.text || "").replace(/\n/g, "\r\n") + "\r");
        } catch {}
      }
      else if (msg.type === "set_system_prompt") {
        // Update systemPrompt for an active agent session (e.g. Skill Builder rebuild)
        const agentState = agentSessions.get(ws);
        if (agentState) {
          agentState.systemPrompt = msg.systemPrompt || null;
          console.log(`[Agent] Updated systemPrompt for session ${agentState.id} (${(msg.systemPrompt || "").length} chars)`);
        }
      }
      else if (msg.type === "resize") {
        const session = ptySessions.get(ws);
        if (session?.pty && msg.cols && msg.rows) {
          session.pty.resize(msg.cols, msg.rows);
        }
      }
      else if (msg.type === "kill") {
        const agentState = agentSessions.get(ws);
        if (agentState) {
          console.log(`[Agent] Killing session: ${agentState.id}`);
          _dropResumable(agentState.id); // 明確殺掉的不給 resume
          agentSessions.delete(ws);
          return;
        }
        const session = ptySessions.get(ws);
        if (session?.pty) {
          session.pty.kill();
          ptySessions.delete(ws);
        }
      }
    });

    ws.on("close", () => {
      const agentState = agentSessions.get(ws);
      if (agentState) {
        console.log(`[Agent] Connection closed: ${agentState.id} (busy=${agentState.busy}, history=${agentState.history.length}) → resumable ${RESUME_TTL_MS / 60000}min`);
        agentState.ws = null;
        agentSessions.delete(ws);
        runningAgents.delete(ws);
        // 2026-09-11 治本：斷線不丟 session — stash 起來等 client 帶 resumeSessionId 接回
        _stashResumable(agentState);
        return;
      }
      const session = ptySessions.get(ws);
      if (session?.pty) {
        console.log(`[PTY] Connection closed, killing: ${session.id}`);
        session.pty.kill();
        ptySessions.delete(ws);
      }
    });

    ws.on("error", (err) => {
      console.error(`[PTY] WebSocket error:`, err.message);
    });
  });

  console.log(`[PTY-WS] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);
}
