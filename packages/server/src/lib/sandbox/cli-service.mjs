/**
 * CLI Service — External CLI execution service
 *
 * Runs OUTSIDE the sandbox (on host). PAAW server calls this via HTTP/WS.
 * This service owns all node-pty / child_process spawns.
 *
 * Endpoints:
 *   GET  /health                  — Health check
 *   GET  /api/clis                — List installed CLIs
 *   POST /api/exec                — Non-interactive CLI execution
 *   WS   /pty/:sessionId          — Interactive PTY session
 *
 * Security: In production, this runs inside Docker sandbox container.
 *           PAAW server talks to it via network API only.
 */

import { createServer } from "http";
import { WebSocketServer } from "ws";
import { spawn as ptySpawn } from "node-pty";
import { execFile } from "child_process";
import { stat } from "fs/promises";
import { resolve } from "path";

// ── Config ──────────────────────────────────────────────

const PORT = parseInt(process.env.CLI_SERVICE_PORT || "4099", 10);
const HOST = process.env.CLI_SERVICE_HOST || "0.0.0.0";

// ── CLI Configs (same as paaw-server, kept independent) ──

const CLI_CONFIGS = {
  qwen: {
    name: "Qwen Code",
    bins: { darwin: "/opt/homebrew/bin/qwen", linux: "qwen", win32: "qwen.cmd" },
    envBin: "QWEN_BIN",
    buildArgs: (opts) => {
      const args = [];
      if (opts.model) args.push("-m", opts.model);
      if (opts.approvalMode === "yolo") args.push("-y");
      else if (opts.approvalMode) args.push("--approval-mode", opts.approvalMode);
      return args;
    },
  },
  claude: {
    name: "Claude Code",
    bins: { darwin: "claude", linux: "claude", win32: "claude.cmd" },
    envBin: "CLAUDE_BIN",
    buildArgs: (opts) => {
      const args = [];
      if (opts.model) args.push("--model", opts.model);
      if (opts.approvalMode === "yolo") args.push("--dangerously-skip-permissions", "--allow-dangerously-skip-permissions");
      else if (opts.approvalMode === "auto-edit") args.push("--permission-mode", "acceptEdits");
      else if (opts.approvalMode === "plan") args.push("--permission-mode", "plan");
      else if (opts.approvalMode) args.push("--permission-mode", opts.approvalMode);
      return args;
    },
  },
  opencode: {
    name: "OpenCode",
    bins: { darwin: "opencode", linux: "opencode", win32: "opencode.cmd" },
    envBin: "OPENCODE_BIN",
    buildArgs: (opts) => {
      const args = [];
      if (opts.model && opts.model.includes("/")) {
        args.push("-m", opts.model);
      }
      if (opts.serverPort) {
        args.push("--port", String(opts.serverPort));
      }
      return args;
    },
  },
};

// ── Binary resolution ──

function resolveBin(cliType) {
  const config = CLI_CONFIGS[cliType];
  if (!config) throw new Error(`Unknown CLI: ${cliType}`);

  const platform = process.platform;
  const binKey = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";
  const bin = process.env[config.envBin] || config.bins[binKey];
  return bin;
}

function spawnCli(opts) {
  const cliType = opts.cli || "qwen";
  const config = CLI_CONFIGS[cliType];
  if (!config) throw new Error(`Unknown CLI: ${cliType}`);

  const bin = resolveBin(cliType);
  const args = config.buildArgs(opts);
  const resolvedCwd = opts.cwd || process.cwd();

  const ptyOpts = {
    name: "xterm-256color",
    cols: opts.cols || 120,
    rows: opts.rows || 30,
    cwd: resolvedCwd,
    env: { ...process.env, ...(opts.env || {}) },
  };

  const platform = process.platform;

  // Windows: .cmd files need cmd.exe wrapper
  if (platform === "win32" && bin.endsWith(".cmd")) {
    const cmdBin = process.env.COMSPEC || "cmd.exe";
    const cmdArgs = ["/c", bin, ...args];
    console.log(`[CLI-SVC] Spawning ${config.name}: ${cmdBin} ${cmdArgs.join(" ")} (cwd: ${resolvedCwd})`);
    return { pty: ptySpawn(cmdBin, cmdArgs, ptyOpts), bin, args };
  }

  console.log(`[CLI-SVC] Spawning ${config.name}: ${bin} ${args.join(" ")} (cwd: ${resolvedCwd})`);
  return { pty: ptySpawn(bin, args, ptyOpts), bin, args };
}

// ── Check installed CLIs ──

async function checkInstalledClis() {
  const results = {};
  const platform = process.platform;
  const cmd = platform === "win32" ? "where" : "which";

  for (const [key, config] of Object.entries(CLI_CONFIGS)) {
    const binKey = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";
    const bin = process.env[config.envBin] || config.bins[binKey];
    try {
      await new Promise((res, rej) => {
        execFile(cmd, [bin], (err) => err ? rej(err) : res(true));
      });
      results[key] = { installed: true, bin, name: config.name };
    } catch {
      results[key] = { installed: false, bin, name: config.name };
    }
  }
  return results;
}

// ── HTTP Server ─────────────────────────────────────────

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // ── Health check ──
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "cli-service", port: PORT }));
    return;
  }

  // ── List installed CLIs ──
  if (req.method === "GET" && url.pathname === "/api/clis") {
    const clis = await checkInstalledClis();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(clis));
    return;
  }

  // ── Non-interactive CLI execution ──
  if (req.method === "POST" && url.pathname === "/api/exec") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    const { cli = "qwen", args = [], cwd, env, timeout = 60000 } = body;
    try {
      const bin = resolveBin(cli);
      const ptyOpts = {
        name: "xterm-256color",
        cols: 200,
        rows: 50,
        cwd: cwd || process.cwd(),
        env: { ...process.env, ...(env || {}) },
      };

      const result = await new Promise((resolveExec, rejectExec) => {
        const pty = ptySpawn(bin, args, ptyOpts);
        let stdout = "";
        let timer;

        if (timeout > 0) {
          timer = setTimeout(() => {
            pty.kill();
            rejectExec(new Error(`CLI execution timeout after ${timeout}ms`));
          }, timeout);
        }

        pty.onData((data) => { stdout += data; });
        pty.onExit(({ exitCode }) => {
          if (timer) clearTimeout(timer);
          resolveExec({ stdout, exitCode });
        });
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── 404 ──
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", path: url.pathname }));
});

// ── WebSocket Server for PTY ────────────────────────────

const wss = new WebSocketServer({ server, path: "/pty" });
const ptySessions = new Map();

wss.on("connection", (ws, req) => {
  const sessionId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`[CLI-SVC] PTY session: ${sessionId}`);

  let spawned = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      // Raw input — forward to PTY
      const session = ptySessions.get(ws);
      if (session?.pty) session.pty.write(raw.toString());
      return;
    }

    // ── Spawn CLI ──
    if (msg.type === "spawn") {
      if (spawned) {
        console.log(`[CLI-SVC] Ignoring duplicate spawn for ${sessionId}`);
        return;
      }
      spawned = true;

      const old = ptySessions.get(ws);
      if (old?.pty) old.pty.kill();

      const opts = msg.options || {};
      if (opts.cli === "opencode") {
        opts.serverPort = 4199 + Math.floor(Math.random() * 100);
      }

      try {
        const { pty, bin, args: spawnArgs } = spawnCli(opts);
        const cliType = opts.cli || "qwen";
        ptySessions.set(ws, { pty, id: sessionId, cliType, serverPort: opts.serverPort });

        // CLI ready detection patterns
        let cliReadyFired = false;
        let cliDoneFired = false;
        const cliReadyPatterns = {
          qwen: /(?:YOLO mode|Plan mode|Auto-edit mode|Default mode|Type your message)/,
          claude: /(?:\?>|^>?\s*$)/m,
          opencode: /(?:Welcome to OpenCode|opencode.*ready)/i,
        };
        const stripAnsi = (s) =>
          s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "");

        pty.onData((data) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "data", data }));
          }

          // CLI ready detection
          if (!cliReadyFired) {
            const plain = stripAnsi(data);
            const pattern = cliReadyPatterns[cliType];
            if (pattern && pattern.test(plain)) {
              cliReadyFired = true;
              console.log(`[CLI-SVC] CLI ready: ${cliType} (${sessionId})`);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "cliReady" }));
              }
            }
          }

          // CLI done detection
          if (cliReadyFired && !cliDoneFired) {
            const plain = stripAnsi(data);
            if (/\bDONE\b|已完成|完成！|✅.*完成|^完成$|Task completed|finished/i.test(plain)) {
              cliDoneFired = true;
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "cliDone" }));
              }
              setTimeout(() => { cliDoneFired = false; }, 3000);
            }
          }
        });

        pty.onExit(({ exitCode }) => {
          console.log(`[CLI-SVC] PTY exit: ${sessionId} (code: ${exitCode})`);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "exit", exitCode }));
          }
          ptySessions.delete(ws);
        });

        ws.send(JSON.stringify({
          type: "ready",
          sessionId,
          platform: process.platform,
          cli: cliType,
          bin,
          args: spawnArgs,
        }));
      } catch (err) {
        console.error(`[CLI-SVC] Spawn failed:`, err.message);
        ws.send(JSON.stringify({ type: "error", message: `Failed to start CLI: ${err.message}` }));
      }
      return;
    }

    // ── Input ──
    if (msg.type === "input") {
      const session = ptySessions.get(ws);
      if (session?.pty) {
        session.pty.write(msg.text || "");
      }
      return;
    }

    // ── Resize ──
    if (msg.type === "resize") {
      const session = ptySessions.get(ws);
      if (session?.pty && msg.cols && msg.rows) {
        session.pty.resize(msg.cols, msg.rows);
      }
      return;
    }

    // ── Kill ──
    if (msg.type === "kill") {
      const session = ptySessions.get(ws);
      if (session?.pty) {
        session.pty.kill();
        ptySessions.delete(ws);
      }
      return;
    }
  });

  ws.on("close", () => {
    const session = ptySessions.get(ws);
    if (session?.pty) {
      console.log(`[CLI-SVC] Connection closed, killing: ${session.id}`);
      session.pty.kill();
      ptySessions.delete(ws);
    }
  });

  ws.on("error", (err) => {
    console.error(`[CLI-SVC] WebSocket error:`, err.message);
  });
});

// ── Helpers ──

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolveBody(data));
    req.on("error", rejectBody);
  });
}

// ── Start ──

server.listen(PORT, HOST, () => {
  console.log(`[CLI-SVC] Listening on http://${HOST}:${PORT}`);
  console.log(`[CLI-SVC] PTY WebSocket on ws://${HOST}:${PORT}/pty`);
});
