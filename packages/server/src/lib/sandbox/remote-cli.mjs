/**
 * RemoteCli — Client for the external CLI Service
 *
 * Replaces direct node-pty spawn with HTTP/WS calls to CLI Service.
 * Drop-in replacement for paaw-server's PTY WebSocket handler.
 *
 * Usage:
 *   const remote = new RemoteCli("http://localhost:4099");
 *   await remote.health();
 *   const result = await remote.exec({ cli: "qwen", args: [...], cwd: "/path" });
 *   const ws = remote.connectPty();  // returns a WebSocket that proxies to CLI Service PTY
 */

const CLI_SERVICE_URL = process.env.CLI_SERVICE_URL || "http://localhost:4099";

// ── RemoteCli Client ────────────────────────────────────

export class RemoteCli {
  constructor(baseUrl = CLI_SERVICE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  // ── Health ──

  async health() {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      const data = await res.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  // ── List installed CLIs ──

  async listClis() {
    const res = await fetch(`${this.baseUrl}/api/clis`);
    return res.json();
  }

  // ── Non-interactive exec ──

  /**
   * Execute a CLI command non-interactively.
   * @param {{ cli?: string, args?: string[], cwd?: string, env?: object, timeout?: number }} opts
   * @returns {Promise<{ stdout: string, exitCode: number }>}
   */
  async exec(opts = {}) {
    const res = await fetch(`${this.baseUrl}/api/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cli: opts.cli || "qwen",
        args: opts.args || [],
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeout || 60000,
      }),
    });
    return res.json();
  }

  /**
   * Connect to a PTY session via WebSocket proxy.
   *
   * Returns a standard WebSocket that speaks the same protocol
   * as paaw-server's PTY WS:
   *   → { type: "spawn", options: {...} }
   *   → { type: "input", text: "..." }
   *   → { type: "resize", cols, rows }
   *   → { type: "kill" }
   *   ← { type: "ready", sessionId, ... }
   *   ← { type: "data", data: "..." }
   *   ← { type: "cliReady" }
   *   ← { type: "cliDone" }
   *   ← { type: "exit", exitCode }
   *
   * So paaw-server can use this as a transparent proxy: browser WS ↔ CLI Service WS.
   *
   * @returns {WebSocket}
   */
  connectPty() {
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/pty";
    return new WebSocket(wsUrl);
  }
}

// ── PTY Proxy Middleware ────────────────────────────────

/**
 * Creates a WS proxy between a browser client and the CLI Service.
 *
 * Use this in paaw-server's WebSocket handler:
 *
 *   wss.on("connection", (ws, req) => {
 *     createPtyProxy(ws);
 *   });
 *
 * It transparently forwards all messages between browser ↔ CLI Service.
 */
export function createPtyProxy(clientWs, remoteCli) {
  const remote = remoteCli || new RemoteCli();
  let remoteWs = null;
  let connected = false;

  // Try to connect to CLI Service
  try {
    remoteWs = remote.connectPty();
  } catch (err) {
    clientWs.send(JSON.stringify({ type: "error", message: `CLI Service unavailable: ${err.message}` }));
    return;
  }

  // ── Remote → Client ──

  remoteWs.addEventListener("open", () => {
    connected = true;
    console.log("[PTY-PROXY] Connected to CLI Service");
  });

  remoteWs.addEventListener("message", (event) => {
    if (clientWs.readyState === 1) {
      clientWs.send(event.data);
    }
  });

  remoteWs.addEventListener("close", () => {
    console.log("[PTY-PROXY] CLI Service closed connection");
    if (clientWs.readyState === 1) {
      clientWs.close();
    }
  });

  remoteWs.addEventListener("error", (err) => {
    console.error("[PTY-PROXY] CLI Service error:", err.message);
    if (clientWs.readyState === 1) {
      clientWs.send(JSON.stringify({ type: "error", message: "CLI Service connection error" }));
    }
  });

  // ── Client → Remote ──

  clientWs.on("message", (raw) => {
    if (remoteWs && remoteWs.readyState === 1) {
      remoteWs.send(raw.toString());
    }
  });

  clientWs.on("close", () => {
    if (remoteWs && remoteWs.readyState === 1) {
      remoteWs.close();
    }
  });

  clientWs.on("error", (err) => {
    console.error("[PTY-PROXY] Client WS error:", err.message);
    if (remoteWs && remoteWs.readyState === 1) {
      remoteWs.close();
    }
  });

  return {
    get connected() { return connected; },
    close() {
      if (remoteWs && remoteWs.readyState === 1) remoteWs.close();
    },
  };
}

// ── Export singleton ──

export const remoteCli = new RemoteCli();
