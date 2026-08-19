/**
 * WebSocket handler for PTY sessions and PAAW Agent Loop mode.
 * Creates a standalone WebSocketServer on a separate port (4098 by default).
 */

import { WebSocketServer } from "ws";
import { spawn as ptySpawn } from "node-pty";
import { runAgentLoop } from "../lib/paaw-agent-loop.mjs";
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

const WS_PORT = parseInt(process.env.PAAW_WS_PORT || "4098", 10);

export function setupWebSocket() {
  const wss = new WebSocketServer({ port: WS_PORT, host: "0.0.0.0" });
  const ptySessions = new Map(); // ws -> { pty, id }
  const agentSessions = new Map(); // ws -> agent state for paaw-agent mode
  const runningAgents = new Map(); // ws -> { abortController } for interrupt

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
          console.log(`[PTY] Agent mode session: ${sessionId} (cwd: ${opts.cwd || PAAW_ROOT}, systemPrompt: ${(opts.systemPrompt || "").length} chars)`);
          const agentCwd = opts.cwd || resolve(PAAW_ROOT, "data", "vibe-sessions", sessionId);
          try { mkdirSync(agentCwd, { recursive: true }); } catch {}
          const agentState = {
            id: sessionId,
            mode: "paaw-agent",
            cwd: agentCwd,
            model: opts.model || null,
            systemPrompt: opts.systemPrompt || null,
            busy: false,
            history: [],
            createdAt: new Date().toISOString(),
          };
          agentSessions.set(ws, agentState);

          // Vibe session logging
          const vibeLogDir = resolve(PAAW_ROOT, "logs/vibe-sessions");
          mkdirSync(vibeLogDir, { recursive: true });
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

          ws.send(JSON.stringify({ type: "ready", sessionId, platform: process.platform }));
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
        // ── Abort running agent ──
        const running = runningAgents.get(ws);
        if (running) {
          running.aborted = true;
          running.controller?.abort(); // 即時殺 in-flight LLM 呼叫
          runningAgents.delete(ws);
          console.log(`[Agent] Interrupt received for session ${running.id}`);
        }
        const agentState = agentSessions.get(ws);
        if (agentState) {
          agentState.busy = false;
          ws.send(JSON.stringify({ type: "agent_done", content: "⏹️ Agent 已中斷。", turns: 0, toolCalls: 0, success: false, interrupted: true }));
        }
      }
      else if (msg.type === "input") {
        // ── Agent mode: run PAAW Agent Loop ──
        const agentState = agentSessions.get(ws);
        if (agentState) {
          const userText = (msg.text || "").trim();
          if (!userText || agentState.busy) {
            if (agentState.busy) ws.send(JSON.stringify({ type: "agent_busy" }));
            return;
          }
          agentState.busy = true;
          const runAbort = new AbortController();
          const runCtx = { id: agentState.id, aborted: false, controller: runAbort };
          runningAgents.set(ws, runCtx);
          ws.send(JSON.stringify({ type: "agent_running" }));

          agentState.history.push({ role: "user", content: userText });

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
              const providersFile = join(PAAW_ROOT, "data", "config", "providers.json");
              const providerConfig = JSON.parse(readFileSync(providersFile, "utf8"));
              const activeProvider = providerConfig.providers[providerConfig.active || "zai"];
              if (activeProvider?.fallbackModels) fallbackModels = activeProvider.fallbackModels;
            } catch {}

            const agentResult = await runAgentLoop({
              prompt: userText,
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
                  try { ws.send(JSON.stringify({ type: "agent_event", event: "tool_start", name: evt.name, args: evt.args })); } catch {}
                }
                if (evt.type === "tool_end") {
                  try { ws.send(JSON.stringify({ type: "agent_event", event: "tool_end", name: evt.name, result: (evt.result || "").slice(0, 500) })); } catch {}
                }
                if (evt.type === "assistant_thinking") {
                  try { ws.send(JSON.stringify({ type: "agent_event", event: "thinking", content: evt.content })); } catch {}
                }
                if (evt.type === "assistant") {
                  try { ws.send(JSON.stringify({ type: "agent_event", event: "response", content: evt.content })); } catch {}
                }
              },
            });

            agentState.history.push({ role: "assistant", content: agentResult.content });

            if (agentState.vibeLogFile) {
              try { appendFileSync(agentState.vibeLogFile, `\n## Assistant\n${agentResult.content.slice(0, 5000)}\n`); } catch {}
            }

            if (!runCtx.aborted) {
              ws.send(JSON.stringify({
                type: "agent_done",
                content: agentResult.content,
                turns: agentResult.turns,
                toolCalls: agentResult.toolCalls?.length || 0,
                success: agentResult.success,
              }));

              const donePatterns = /\bDONE\b|已完成|完成！|✅.*完成|Task completed|finished|已寫入|已生成|創建完成|建立完成/i;
              if (donePatterns.test(agentResult.content)) {
                ws.send(JSON.stringify({ type: "cliDone" }));
              }
            }

          } catch (err) {
            if (err.message === "Agent interrupted by user") {
              console.log(`[Agent] Interrupted for session ${agentState.id}`);
              ws.send(JSON.stringify({ type: "agent_done", content: "⏹️ Agent 已中斷。", turns: 0, toolCalls: 0, success: false, interrupted: true }));
            } else {
              console.error(`[Agent] Error for session ${agentState.id}:`, err.message);
              ws.send(JSON.stringify({ type: "agent_error", message: err.message }));
            }
          }

          agentState.busy = false;
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
        console.log(`[Agent] Connection closed: ${agentState.id}`);
        agentSessions.delete(ws);
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
