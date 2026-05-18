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
    onReady?: () => void;
    onExit?: (code: number) => void;
}

const WS_PORT = 4098;

export default function TerminalConsole({
    cwd,
    cli = "qwen",
    model,
    approvalMode = "yolo",
    systemPrompt,
    initialPrompt,
    onReady,
    onExit,
}: TerminalConsoleProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [input, setInput] = useState("");
    const [connected, setConnected] = useState(false);
    const [ready, setReady] = useState(false);
    const [directMode, setDirectMode] = useState(true);
    // Refs for stable access in closures
    const directModeRef = useRef(true);
    const wsRef = useRef<WebSocket | null>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const initialSentRef = useRef(false);
    const mountedRef = useRef(true);

    // Stable options ref so closures always see latest props
    const optsRef = useRef({ cwd, cli, model, approvalMode, systemPrompt });
    optsRef.current = { cwd, cli, model, approvalMode, systemPrompt };

    // Send a string to PTY via WebSocket
    const sendToPty = useCallback((text: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "input", text }));
        }
    }, []);

    // Send text to PTY
    const sendInput = useCallback((text: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const hasNewlines = text.includes("\n");
        if (hasNewlines) {
            // Multi-line: use bracketed paste so the CLI treats it as a single paste,
            // then send Enter to submit
            wsRef.current.send(JSON.stringify({
                type: "input",
                text: `\x1b[200~${text}\x1b[201~`,
            }));
            // Send Enter separately with a small delay to ensure CLI processes paste first
            setTimeout(() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: "input", text: "\r" }));
                }
            }, 150);
        } else {
            // Single-line: send text then Enter
            wsRef.current.send(JSON.stringify({ type: "input", text: text + "\r" }));
        }
    }, []);

    // Init terminal + WS + PTY (once on mount)
    useEffect(() => {
        mountedRef.current = true;
        const el = containerRef.current;
        if (!el) return;

        // 1. Create terminal
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
            fontSize: 13,
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

        // 2. Direct keyboard input: every keystroke in xterm → PTY
        // This enables arrow keys, Tab, interactive menus, etc.
        const dataDisposable = term.onData((data) => {
            if (directModeRef.current) {
                sendToPty(data);
            }
        });

        // Fit on resize
        const onResize = () => { try { fit.fit(); } catch { /* */ } };
        window.addEventListener("resize", onResize);
        const observer = new ResizeObserver(onResize);
        observer.observe(el);

        // 3. Connect WebSocket
        const wsUrl = `ws://${window.location.hostname}:${WS_PORT}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!mountedRef.current) return;
            setConnected(true);
            // Spawn PTY with current options
            const opts = optsRef.current;
            ws.send(JSON.stringify({
                type: "spawn",
                options: {
                    cwd: opts.cwd || undefined,
                    cli: opts.cli || undefined,
                    model: opts.model || undefined,
                    approvalMode: opts.approvalMode || "yolo",
                    systemPrompt: opts.systemPrompt || undefined,
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
                ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
                onReady?.();
            } else if (msg.type === "exit") {
                // CLI exited — keep WS alive, user can click Restart
                term.write("\r\n\x1b[33m⚠️ Qwen CLI exited. Click 🔄 Restart to start a new session.\x1b[0m\r\n");
                setReady(false);
                // Keep connected=true so terminal stays alive and buttons work
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

        // 4. Cleanup
        return () => {
            mountedRef.current = false;
            dataDisposable.dispose();
            observer.disconnect();
            window.removeEventListener("resize", onResize);
            ws.close();
            wsRef.current = null;
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Mount once

    // Auto-send initial prompt when ready
    // Waits for the CLI to fully initialize before sending.
    // Uses a longer delay because Qwen/Claude CLI needs time to load.
    useEffect(() => {
        if (!ready || !initialPrompt || initialSentRef.current) return;
        initialSentRef.current = true;
        const delay = 4000;
        const timer = setTimeout(() => {
            sendInput(initialPrompt);
        }, delay);
        return () => clearTimeout(timer);
    }, [ready, initialPrompt, sendInput]);

    const handleSubmit = () => {
        const text = input.trim();
        if (!text) return;
        sendInput(text);
        setInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";
    };

    const handleRestart = () => {
        // Kill current PTY
        if (wsRef.current) {
            wsRef.current.send(JSON.stringify({ type: "kill" }));
            wsRef.current.close();
            wsRef.current = null;
        }
        if (termRef.current) {
            termRef.current.clear();
            termRef.current.write("\x1b[33m🔄 Restarting...\x1b[0m\r\n");
        }
        initialSentRef.current = false;
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
                    if (termRef.current) ws.send(JSON.stringify({ type: "resize", cols: termRef.current.cols, rows: termRef.current.rows }));
                }
                else if (msg.type === "exit") { setReady(false); setConnected(false); }
                else if (msg.type === "error" && termRef.current) termRef.current.write(`\r\n\x1b[31m❌ ${msg.message}\x1b[0m\r\n`);
            };
            ws.onclose = () => { setConnected(false); setReady(false); };
            ws.onerror = () => { setConnected(false); };
        }, 500);
    };

    const toggleMode = () => {
        const newMode = !directMode;
        directModeRef.current = newMode;
        setDirectMode(newMode);
        if (newMode && termRef.current) {
            termRef.current.focus();
        }
        if (!newMode && inputRef.current) {
            inputRef.current.focus();
        }
    };

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

            {/* Input area */}
            <div className="shrink-0 border-t border-stone-700 bg-[#1a1a2e] px-3 py-2 rounded-b-lg">
                {!directMode ? (
                    /* Textarea input mode */
                    <div className="flex items-end gap-2">
                        <span className="text-green-400 mt-1 text-sm shrink-0"><Icon name="arrow" size={12} /></span>
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={(e) => {
                                setInput(e.target.value);
                                e.target.style.height = "auto";
                                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit();
                                    e.currentTarget.style.height = "auto";
                                }
                            }}
                            disabled={!connected}
                            placeholder={
                                !connected ? "Connecting..." :
                                !ready ? "Starting Qwen CLI..." :
                                "Type your prompt... (Shift+Enter for newline)"
                            }
                            className="flex-1 bg-transparent outline-none text-stone-200 text-sm disabled:opacity-50 resize-none min-h-[24px] max-h-[120px] overflow-y-auto leading-normal py-0 placeholder-stone-600"
                            rows={1}
                        />
                        <div className="flex gap-1.5 shrink-0">
                            <button
                                onClick={handleSubmit}
                                disabled={!connected || !input.trim()}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-stone-800 text-stone-300 border border-stone-600 hover:bg-stone-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                ▶ Send
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Direct mode hint */
                    <div className="flex items-center gap-2">
                        <span className="text-green-400 text-sm">⌨️</span>
                        <span className="text-stone-500 text-xs">
                            Click here and type directly — arrow keys, Tab, and interactive menus work.
                        </span>
                    </div>
                )}
                {/* Bottom bar: status + buttons */}
                <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${connected && ready ? "bg-green-500" : connected ? "bg-yellow-500 animate-pulse" : "bg-red-500"}`} />
                        <span className="text-[10px] text-stone-500">
                            {connected && ready ? `${cli === 'claude' ? 'Claude Code' : cli === 'opencode' ? 'OpenCode' : 'Qwen CLI'} ready (${approvalMode})` :
                             connected ? `Starting ${cli === 'claude' ? 'Claude Code' : cli === 'opencode' ? 'OpenCode' : 'Qwen CLI'}...` : "Disconnected"}
                        </span>
                    </div>
                    <div className="flex gap-1.5">
                        <button
                            onClick={toggleMode}
                            className="px-2 py-1 rounded text-[10px] font-bold bg-stone-800 text-stone-400 border border-stone-600 hover:bg-stone-700 hover:text-stone-200 transition-colors"
                            title={directMode ? "Switch to textarea input" : "Switch to direct terminal input"}
                        >
                            {directMode ? <><Icon name="document" size={12} /> Textarea</> : <><Icon name="keyboard" size={12} /> Direct</>}
                        </button>
                        {/* Stop: interrupt current LLM response (Ctrl+C) */}
                        <button
                            onClick={() => sendToPty("\x03")}
                            disabled={!connected || !ready}
                            className="px-2 py-1 rounded text-[10px] font-bold bg-red-900 text-red-300 border border-red-700 hover:bg-red-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Stop current response (Ctrl+C)"
                        >
                            ⏹ Stop
                        </button>
                        {/* Resume: send 'continue' to resume the conversation */}
                        <button
                            onClick={() => sendInput("continue")}
                            disabled={!connected || !ready}
                            className="px-2 py-1 rounded text-[10px] font-bold bg-green-900 text-green-300 border border-green-700 hover:bg-green-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Resume conversation"
                        >
                            ▶ Resume
                        </button>
                        {/* Restart: kill PTY and start fresh */}
                        <button
                            onClick={handleRestart}
                            className="px-2 py-1 rounded text-[10px] font-bold bg-stone-800 text-stone-400 border border-stone-600 hover:bg-stone-700 hover:text-stone-200 transition-colors"
                            title="Kill and restart session"
                        >
                            <Icon name="restart" size={14} /> Restart
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
