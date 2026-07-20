/**
 * ShellTerminal — Real shell terminal via WebSocket + xterm.js
 *
 * Works like a native terminal (cmd.exe / PowerShell / bash/zsh).
 *
 * Key behaviors:
 * - Each instance has its own PTY session (separate WebSocket)
 * - Tab switch preserves content (no reflow / no cursor jump)
 * - Ctrl+C sends SIGINT; Ctrl+D sends EOF (unless text selected → copy)
 * - windowsMode: handles Win32 console \r\n line endings correctly
 * - Auto-fit cols/rows when container resizes or becomes visible
 * - Zero-dimension guard prevents content corruption when hidden
 * - Focus on activate so cursor is always in the right place
 */

import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const WS_PORT = import.meta.env.VITE_PAAW_WS_PORT || (parseInt(window.location.port || "4097", 10) + 1);

// Detect Windows-like environment (browser doesn't tell us the OS,
// but we can check the server's platform from the spawn response)
let _isWindows = false;

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

  // ── On active change: refit + focus (don't touch terminal content) ──
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const ws = wsRef.current;
    if (!term || !fit || !containerRef.current) return;
    requestAnimationFrame(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      try {
        fit.fit();
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {}
      term.focus();
    });
  }, [active]);

  // ── Main effect: create terminal + WebSocket (mount once) ──
  useEffect(() => {
    if (!containerRef.current) return;

    const isWindowsShell = _isWindows;

    const term = new Terminal({
      fontSize,
      // Use widely available monospace fonts that render well on all platforms
      fontFamily: "'Cascadia Code', 'Consolas', 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      lineHeight: 1.0,
      theme: {
        background: "#0c0c0c",
        foreground: "#cccccc",
        cursor: "#ffffff",
        selectionBackground: "#ffffff40",
        black: "#0c0c0c",
        red: "#c50f1f",
        green: "#13a10e",
        yellow: "#c19c00",
        blue: "#0037da",
        magenta: "#881798",
        cyan: "#3a96dd",
        white: "#cccccc",
        brightBlack: "#767676",
        brightRed: "#e74856",
        brightGreen: "#16c60c",
        brightYellow: "#f9f1a5",
        brightBlue: "#3b78ff",
        brightMagenta: "#b4009e",
        brightCyan: "#61d6d6",
        brightWhite: "#f2f2f2",
      },
      cursorBlink: true,
      scrollback: 9999,
      allowProposedApi: true,
      // windowsMode set dynamically after platform detection (not a typed option)
      // convertEol: false — PTY sends correct sequences, no double conversion
      convertEol: false,
    });

    // ── Key handler: Ctrl+C / Ctrl+D pass-through ──
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
        // Raw data — write directly
        term.write(event.data as string);
        return;
      }
      switch (msg.type) {
        case "ready":
          // Detect platform from server response
          if (msg.platform === "win32") {
            _isWindows = true;
            try { (term as any).options.windowsMode = true; } catch {}
          }
          break;
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
    const resizeObserver = new ResizeObserver(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
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
  }, []); // mount once

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ backgroundColor: "#0c0c0c", padding: "4px", overflow: "hidden" }}
    />
  );
}
