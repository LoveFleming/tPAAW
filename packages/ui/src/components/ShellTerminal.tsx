/**
 * ShellTerminal — Real shell terminal via WebSocket + xterm.js
 *
 * VSCode-style integrated terminal behavior:
 * - Each instance has its own PTY session (separate WebSocket)
 * - Tab switch preserves content (no reflow / no cursor jump)
 * - Ctrl+C sends SIGINT; Ctrl+D sends EOF (unless text selected → copy)
 * - Auto-fit cols/rows when container resizes or becomes visible
 * - Zero-dimension guard prevents content corruption when hidden
 */

import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const WS_PORT = import.meta.env.VITE_PAAW_WS_PORT || 4098;

interface ShellTerminalProps {
  cwd?: string;
  fontSize?: number;
  active?: boolean; // whether this terminal is the active tab
}

export default function ShellTerminal({ cwd, fontSize = 13, active = true }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeRef = useRef(active);

  // Keep activeRef in sync without re-running the main effect
  useEffect(() => {
    activeRef.current = active;
    if (active && termRef.current && fitRef.current && containerRef.current) {
      // Tab just became active — refit and focus after DOM updates
      requestAnimationFrame(() => {
        const term = termRef.current;
        const fit = fitRef.current;
        const ws = wsRef.current;
        if (!term || !fit || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          try {
            fit.fit();
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
            }
          } catch {}
        }
        term.focus();
      });
    }
  }, [active]);

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

    // ── Ctrl+C → SIGINT, Ctrl+D → EOF (unless text selected) ──
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "c" && !e.shiftKey && !e.altKey && !e.metaKey) {
        const sel = term.getSelection();
        if (sel && sel.length > 0) {
          term.clearSelection();
          return true; // allow copy
        }
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send("\x03");
        }
        return false;
      }
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
    termRef.current = term;
    fitRef.current = fitAddon;

    // Initial fit after DOM settles
    requestAnimationFrame(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        try { fitAddon.fit(); } catch {}
      }
    });

    // ── WebSocket connect ──
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
        term.write(event.data as string);
        return;
      }
      switch (msg.type) {
        case "ready":
        case "cliReady":
          break;
        case "data":
        case "stdout":
        case "stderr":
          if (msg.data) term.write(msg.data);
          break;
        case "exit":
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

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[WebSocket connection error]\x1b[0m\r\n");
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[33m[disconnected]\x1b[0m\r\n");
    };

    // ── Input → PTY ──
    const inputData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // ── Resize: guard against 0x0 (hidden container) ──
    // This is the critical fix: when container is display:none, dimensions are 0.
    // Calling fit() with 0 dimensions corrupts xterm buffer → content moves.
    const resizeObserver = new ResizeObserver(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return; // skip hidden
      try {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {}
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      inputData.dispose();
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, []); // mount once — cwd used only for initial spawn

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ backgroundColor: "#1e1e2e", padding: "4px", overflow: "hidden" }}
    />
  );
}
