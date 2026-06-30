/**
 * WebSocket handler for PTY sessions and PAAW Agent Loop mode.
 * Creates a standalone WebSocketServer on a separate port (4098 by default).
 */

import { WebSocketServer } from "ws";
import { spawn as ptySpawn } from "node-pty";
import { runAgentLoop } from "../lib/paaw-agent-loop.mjs";
import {
  PAAW_ROOT, readFileSync, writeFileSync, appendFileSync, resolve, mkdirSync,
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

  wss.on("connection", (ws, req) => {
    const sessionId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[PTY] New session: ${sessionId}`);

    let spawned = false;

    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch {
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
          console.log(`[PTY] Agent mode session: ${sessionId} (cwd: ${opts.cwd || PAAW_ROOT})`);
          const agentCwd = opts.cwd || PAAW_ROOT;
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
          const shellBin = process.platform === "win32"
            ? (process.env.COMSPEC || "powershell.exe")
            : (process.env.SHELL || "/bin/zsh");
          const resolvedCwd = opts.cwd || process.env.QWEN_CWD || PAAW_ROOT;
          const pty = ptySpawn(shellBin, [], {
            name: "xterm-256color", cols: 120, rows: 30,
            cwd: resolvedCwd,
            env: { ...process.env },
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
          ws.send(JSON.stringify({ type: "agent_running" }));

          agentState.history.push({ role: "user", content: userText });

          if (agentState.vibeLogFile) {
            try { appendFileSync(agentState.vibeLogFile, `\n## User\n${userText}\n`); } catch {}
          }

          console.log(`[Agent] Running for session ${agentState.id}, prompt length: ${userText.length}`);

          try {
            const { loadAgentConfig } = await import("../routes/context.mjs");
            const agentCfg = await loadAgentConfig();
            const agentResult = await runAgentLoop({
              prompt: userText,
              cwd: agentState.cwd,
              systemPrompt: agentState.systemPrompt || undefined,
              model: agentState.model || undefined,
              maxTurns: agentCfg.maxTurns,
              timeout: agentCfg.timeoutSeconds,
              rootDir: PAAW_ROOT,
              onEvent: (evt) => {
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

          } catch (err) {
            console.error(`[Agent] Error for session ${agentState.id}:`, err.message);
            ws.send(JSON.stringify({ type: "agent_error", message: err.message }));
          }

          agentState.busy = false;

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
