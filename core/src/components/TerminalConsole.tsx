import React, { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import Icon from "./Icon";

interface TerminalConsoleProps {
    cwd?: string;
    cli?: string;
    model?: string;
    approvalMode?: string;
    systemPrompt?: string;
    initialPrompt?: string;
    /** Increment to trigger a hot-restart (re-spawn PTY with current props without remounting the component). */
    restartTrigger?: number;
    onReady?: () => void;
    onExit?: (code: number) => void;
}

/** Imperative handle exposed via ref */
export interface TerminalConsoleHandle {
    /** Send text to the PTY as if the user typed it (adds Enter) */
    sendPrompt: (text: string) => void;
}

const WS_PORT = 4098;

const TerminalConsoleInner = React.forwardRef<TerminalConsoleHandle, TerminalConsoleProps>(function TerminalConsoleInner({
    cwd,
    cli = "qwen",
    model,
    approvalMode = "yolo",
    systemPrompt,
    initialPrompt,
    restartTrigger,
    onReady,
    onExit,
}: TerminalConsoleProps, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [connected, setConnected] = useState(false);
    const [ready, setReady] = useState(false);
    const cliReadyRef = useRef(false);
    const platformRef = useRef<string>("");
    const wsRef = useRef<WebSocket | null>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const initialSentRef = useRef(false);
    const mountedRef = useRef(true);

    // Stable options ref so closures always see latest props
    const optsRef = useRef({ cwd, cli, model, approvalMode, systemPrompt, initialPrompt });
    optsRef.current = { cwd, cli, model, approvalMode, systemPrompt, initialPrompt };

    // Send a string to PTY via WebSocket
    const sendToPty = useCallback((text: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "input", text }));
        }
    }, []);

    // Send text to PTY — always appends Enter to submit
    const sendInput = useCallback((text: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        if (text.includes("\n")) {
            // Multi-line: use xterm paste (simulates real Ctrl+V), then Enter
            const term = termRef.current;
            if (term) {
                term.paste(text);
                // Send Enter immediately after paste settles
                setTimeout(() => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: "input", text: "\r" }));
                    }
                }, 150);
            }
        } else {
            // Single-line: send text + Enter
            wsRef.current.send(JSON.stringify({ type: "input", text: text + "\r" }));
        }
    }, []);

    // Expose sendPrompt to parent via ref
    React.useImperativeHandle(ref, () => ({
        sendPrompt: (text: string) => {
            if (!text.trim()) return;
            const term = termRef.current;
            if (!term || !wsRef.current?.readyState) return;
            if (text.includes("\n")) {
                // Multi-line: paste then Enter after settling
                term.paste(text);
                setTimeout(() => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: "input", text: "\r" }));
                    }
                }, 600);
            } else {
                // Single-line: type + Enter
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: "input", text: text + "\r" }));
                }
            }
        },
    }), [sendInput]);

    // ── Init terminal + WebSocket (mount once) ──
    useEffect(() => {
        mountedRef.current = true;
        const el = containerRef.current;
        if (!el) return;

        const term = new Terminal({
            theme: {
                background: "#1a1a2e",
                foreground: "#e0e0e0",
                cursor: "#ffbd2e",
                cursorAccent: "#1a1a2e",
                selectionBackground: "#444466",
                black: "#1a1a2e",
                red: "#ff6b6b",
                green: "#51cf66",
                yellow: "#ffbd2e",
                blue: "#5c9eff",
                magenta: "#cc78fa",
                cyan: "#56d4dd",
                white: "#e0e0e0",
                brightBlack: "#666680",
                brightRed: "#ff8787",
                brightGreen: "#69db7c",
                brightYellow: "#ffd43b",
                brightBlue: "#74b0ff",
                brightMagenta: "#d49bfa",
                brightCyan: "#66e0e8",
                brightWhite: "#ffffff",
            },
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
            fontSize: 14,
            lineHeight: 1.2,
            cursorBlink: true,
            cursorStyle: "bar",
            scrollback: 10000,
            convertEol: true,
        });

        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(el);
        setTimeout(() => { try { fit.fit(); } catch { /* */ } }, 50);

        termRef.current = term;
        fitRef.current = fit;

        // Direct keyboard input: xterm keystrokes → PTY
        // Escape key is NOT forwarded (it would corrupt CLI state)
        const dataDisposable = term.onData((data) => {
            // Filter out bare Escape — it causes issues with CLI menus
            // Ctrl+C (\x03) is the proper way to interrupt
            if (data === "\x1b") return;
            sendToPty(data);
        });

        // Fit on resize
        const onResize = () => { try { fit.fit(); } catch { /* */ } };
        window.addEventListener("resize", onResize);
        const observer = new ResizeObserver(onResize);
        observer.observe(el);

        // Connect WebSocket
        const wsUrl = `ws://${window.location.hostname}:${WS_PORT}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!mountedRef.current) return;
            setConnected(true);
            const opts = optsRef.current;
            ws.send(JSON.stringify({
                type: "spawn",
                options: {
                    cwd: opts.cwd || undefined,
                    cli: opts.cli || undefined,
                    model: opts.model || undefined,
                    approvalMode: opts.approvalMode || "yolo",
                    systemPrompt: opts.systemPrompt || undefined,
                    initialPrompt: opts.initialPrompt || undefined,
                },
            }));
        };

        ws.onmessage = (event) => {
            if (!mountedRef.current) return;
            let msg;
            try { msg = JSON.parse(event.data as string); } catch { return; }

            if (msg.type === "data") {
                term.write(msg.data);
            } else if (msg.type === "ready") {
                setReady(true);
                if (msg.platform) platformRef.current = msg.platform;
                ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
                onReady?.();
            } else if (msg.type === "cliReady") {
                // Server detected CLI is truly initialized (saw ready pattern in output)
                cliReadyRef.current = true;
            } else if (msg.type === "exit") {
                term.write("\r\n\x1b[33m⚠️ CLI exited. Click 🔄 Restart to start a new session.\x1b[0m\r\n");
                setReady(false);
                onExit?.(msg.exitCode || 0);
            } else if (msg.type === "error") {
                term.write(`\r\n\x1b[31m❌ Error: ${msg.message}\x1b[0m\r\n`);
            }
        };

        ws.onclose = () => {
            if (!mountedRef.current) return;
            setConnected(false);
            setReady(false);
        };

        ws.onerror = () => {
            if (!mountedRef.current) return;
            setConnected(false);
            term.write("\r\n\x1b[31m❌ WebSocket connection failed.\x1b[0m\r\n");
        };

        return () => {
            mountedRef.current = false;
            dataDisposable.dispose();
            observer.disconnect();
            window.removeEventListener("resize", onResize);
            if (ws.readyState === WebSocket.CONNECTING) {
                ws.onopen = () => ws.close(); // close after connect to avoid error
            } else {
                ws.close();
            }
            wsRef.current = null;
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Auto-send initial prompt when CLI is ready ──
    // Strategy: poll cliReadyRef every 200ms (server detects ready pattern in PTY output)
    // Fallback: max 15s timeout (in case pattern detection misses)
    useEffect(() => {
        if (!ready || !initialPrompt || initialSentRef.current) return;
        initialSentRef.current = true;

        const doSend = () => {
            const term = termRef.current;
            if (!term || !initialPrompt) return;
            if (cli === "opencode") {
                navigator.clipboard?.writeText(initialPrompt).catch(() => {});
                term.paste(initialPrompt);
                setTimeout(() => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: "input", text: "\r" }));
                    }
                }, 800);
            } else {
                // Qwen / Claude: paste prompt + Enter
                term.paste(initialPrompt);
                setTimeout(() => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: "input", text: "\r" }));
                    }
                }, 150);
            }
        };

        // Poll until cliReadyRef is true or timeout
        let sent = false;
        const pollInterval = setInterval(() => {
            if (cliReadyRef.current && !sent) {
                sent = true;
                clearInterval(pollInterval);
                clearTimeout(fallbackTimer);
                // Small delay after detection to ensure input field is focused
                setTimeout(doSend, 300);
            }
        }, 200);

        // Fallback: if pattern detection doesn't fire within 15s, send anyway
        const fallbackTimer = setTimeout(() => {
            if (!sent) {
                sent = true;
                clearInterval(pollInterval);
                console.log("[TerminalConsole] cliReady timeout, sending prompt anyway");
                doSend();
            }
        }, 15000);

        return () => { clearInterval(pollInterval); clearTimeout(fallbackTimer); };
    }, [ready, initialPrompt, sendInput, cli]);

    // ── Hot-restart: re-spawn PTY when restartTrigger changes ──
    const prevRestartRef = useRef(restartTrigger);
    useEffect(() => {
        if (restartTrigger === undefined || restartTrigger === prevRestartRef.current) return;
        prevRestartRef.current = restartTrigger;
        cliReadyRef.current = false;
        restartSession();
    }, [restartTrigger]);

    // Shared restart logic
    const restartSession = useCallback(() => {
        // Kill current PTY and WebSocket
        if (wsRef.current) {
            wsRef.current.send(JSON.stringify({ type: "kill" }));
            wsRef.current.close();
            wsRef.current = null;
        }
        // Clear terminal cleanly
        if (termRef.current) {
            termRef.current.reset();
            termRef.current.clear();
            termRef.current.write("\x1b[33m🔄 Restarting...\x1b[0m\r\n");
        }
        initialSentRef.current = false;
        cliReadyRef.current = false;
        setReady(false);
        setConnected(false);

        // Reconnect after short delay
        setTimeout(() => {
            if (!mountedRef.current) return;
            const term = termRef.current;
            if (!term) return;

            const wsUrl = `ws://${window.location.hostname}:${WS_PORT}`;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                setConnected(true);
                const opts = optsRef.current;
                ws.send(JSON.stringify({
                    type: "spawn",
                    options: {
                        cwd: opts.cwd || undefined,
                        cli: opts.cli || undefined,
                        model: opts.model || undefined,
                        approvalMode: opts.approvalMode || "yolo",
                        systemPrompt: opts.systemPrompt || undefined,
                        initialPrompt: opts.initialPrompt || undefined,
                    },
                }));
            };

            ws.onmessage = (event) => {
                if (!mountedRef.current) return;
                let msg;
                try { msg = JSON.parse(event.data as string); } catch { return; }
                if (msg.type === "data" && termRef.current) termRef.current.write(msg.data);
                else if (msg.type === "ready") {
                    setReady(true);
                    if (msg.platform) platformRef.current = msg.platform;
                    if (termRef.current) ws.send(JSON.stringify({ type: "resize", cols: termRef.current.cols, rows: termRef.current.rows }));
                }
                else if (msg.type === "cliReady") {
                    cliReadyRef.current = true;
                }
                else if (msg.type === "exit") { setReady(false); setConnected(true); }
                else if (msg.type === "error" && termRef.current) termRef.current.write(`\r\n\x1b[31m❌ ${msg.message}\x1b[0m\r\n`);
            };
            ws.onclose = () => { setConnected(false); setReady(false); };
            ws.onerror = () => { setConnected(false); };
        }, 500);
    }, []);

    return (
        <div className="flex flex-col h-full">
            {/* Terminal display */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 bg-[#1a1a2e] rounded-t-lg overflow-hidden"
                style={{ padding: "4px 4px 0 4px" }}
                onClick={() => {
                    if (termRef.current) termRef.current.focus();
                }}
            />

            {/* Status bar */}
            <div className="shrink-0 bg-[#0d1117] px-3 py-2 rounded-b-lg" style={{ borderTop: '1px solid #30363d' }}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${connected && ready ? "bg-emerald-500" : connected ? "bg-yellow-500 animate-pulse" : "bg-red-500"}`} />
                        <span className="text-[10px] text-[#8b949e]">
                            {connected && ready ? `${cli === 'claude' ? 'Claude Code' : cli === 'opencode' ? 'OpenCode' : 'Qwen CLI'} ready (${approvalMode})` :
                             connected ? `Starting ${cli === 'claude' ? 'Claude Code' : cli === 'opencode' ? 'OpenCode' : 'Qwen CLI'}...` : "Disconnected"}
                        </span>
                    </div>
                    <div className="flex gap-1.5">
                        <button
                            onClick={restartSession}
                            className="px-2 py-1 rounded text-[10px] font-bold text-[#8b949e] hover:text-white transition-colors"
                            style={{ backgroundColor: '#21262d', border: '1px solid #30363d' }}
                            title="Kill and restart session"
                        >
                            <Icon name="restart" size={14} /> Restart
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default TerminalConsoleInner;
