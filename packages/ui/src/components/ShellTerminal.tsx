/**
 * ShellTerminal — Real shell terminal via WebSocket + xterm.js
 *
 * Like VSCode's integrated terminal. Connects to ws-handler shell mode,
 * supports interactive commands (node, java, python, etc).
 *
 * Fixes:
 * - Ctrl+C sends \x03 to PTY (not swallowed by browser)
 * - Reconnects when cwd changes
 * - Refits cursor/cols/rows when tab becomes visible again
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
  const cwdRef = useRef(cwd);

  useEffect(() => {
    if (!containerRef.current) return;
    cwdRef.current = cwd;

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

    // ── Allow Ctrl+C / Ctrl+D to pass through to PTY ──
    // Browser may intercept Ctrl+C as "copy" — we need it to reach the PTY as \x03
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Ctrl+C — send SIGINT to PTY, don't let browser copy
      if (e.ctrlKey && e.key === "c" && !e.shiftKey && !e.altKey && !e.metaKey) {
        // Check if there's a text selection — if so, allow copy (like VS Code)
        const sel = term.getSelection();
        if (sel && sel.length > 0) {
          term.clearSelection();
          // Allow default copy behavior
          return true;
        }
        // No selection — pass Ctrl+C to PTY as \x03
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send("\x03");
        }
        return false; // prevent default
      }
      // Ctrl+D — send EOF
      if (e.ctrlKey && e.key === "d" && !e.shiftKey && !e.altKey && !e.metaKey) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send("\x04");
        }
        return false;
      }
      return true;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    // Delay fit slightly to let DOM layout settle
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    // ── Connect WebSocket ──
    const wsUrl = `ws://${window.location.hostname}:${WS_PORT}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "spawn",
        options: {
          cli: "shell",
          cwd: cwdRef.current || undefined,
          cols: term.cols,
          rows: term.rows,
        },
      }));
    };

    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data as string); } catch {
        // Raw data — write directly
        term.write(event.data as string);
        return;
      }

      switch (msg.type) {
        case "ready":
        case "cliReady":
          break;
        case "stdout":
        case "data":
          if (msg.data) term.write(msg.data);
          break;
        case "stderr":
          if (msg.data) term.write(msg.data);
          break;
        case "pty_exit":
          term.write("\r\n\x1b[33m[process exited]\x1b[0m\r\n");
          break;
        case "error":
          if (msg.text) term.write(`\r\n\x1b[31m${msg.text}\x1b[0m\r\n`);
          break;
        default:
          if (typeof event.data === "string") {
            try { JSON.parse(event.data); } catch { term.write(event.data); }
          }
      }
    };

    // ── Send user input to PTY (except Ctrl+C/D handled above) ──
    const inputData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // ── Handle resize via ResizeObserver ──
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {}
    });
    resizeObserver.observe(containerRef.current);

    // ── Refit when container becomes visible (tab switch) ──
    // ResizeObserver doesn't fire when going from display:none → display:block
    // Use IntersectionObserver to detect visibility changes
    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > 0) {
          // Container just became visible — refit
          requestAnimationFrame(() => {
            try {
              fitAddon.fit();
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
              }
              // Focus terminal so cursor is in the right place
              term.focus();
            } catch {}
          });
        }
      }
    }, { threshold: 0.1 });
    intersectionObserver.observe(containerRef.current);

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[WebSocket connection error]\x1b[0m\r\n");
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[33m[disconnected]\x1b[0m\r\n");
    };

    return () => {
      inputData.dispose();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [cwd]); // ← re-run when cwd changes (reconnect with new working directory)

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ backgroundColor: "#1e1e2e", padding: "4px" }}
    />
  );
}
