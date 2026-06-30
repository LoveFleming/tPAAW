/**
 * ShellTerminal — Real shell terminal via WebSocket + xterm.js
 *
 * Like VSCode's integrated terminal. Connects to ws-handler shell mode,
 * supports interactive commands (node, java, python, etc).
 */

import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const WS_PORT = import.meta.env.VITE_PAAW_WS_PORT || 4098;

interface ShellTerminalProps {
  cwd?: string;
  fontSize?: number;
}

export default function ShellTerminal({ cwd, fontSize = 13 }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontSize,
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b7066",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // Connect WebSocket
    const wsUrl = `ws://${window.location.hostname}:${WS_PORT}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "spawn",
        options: {
          cli: "shell",
          cwd: cwd || undefined,
          cols: term.cols,
          rows: term.rows,
        },
      }));
    };

    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data as string); } catch {
        // Raw binary — write directly
        term.write(event.data as string);
        return;
      }

      switch (msg.type) {
        case "ready":
        case "cliReady":
          // Terminal ready
          break;
        case "stdout":
        case "data":
          if (msg.data) term.write(msg.data);
          break;
        case "stderr":
          if (msg.data) term.write(msg.data);
          break;
        case "pty_exit":
          // Process exited — reconnect shell
          term.write("\r\n\x1b[33m[process exited]\x1b[0m\r\n");
          break;
        case "error":
          if (msg.text) term.write(`\r\n\x1b[31m${msg.text}\x1b[0m\r\n`);
          break;
        default:
          // Unknown message — try as raw data
          if (typeof event.data === "string") {
            try { JSON.parse(event.data); } catch { term.write(event.data); }
          }
      }
    };

    // Send user input to PTY
    const inputData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data); // raw input — ws-handler handles non-JSON as PTY write
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {}
    });
    resizeObserver.observe(containerRef.current);

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[WebSocket connection error]\x1b[0m\r\n");
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[33m[disconnected]\x1b[0m\r\n");
    };

    return () => {
      inputData.dispose();
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [cwd, fontSize]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ backgroundColor: "#1e1e2e", padding: "4px" }}
    />
  );
}
