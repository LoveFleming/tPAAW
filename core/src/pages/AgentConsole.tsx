import Icon from "../components/Icon";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Card, cn } from "../components/ui/shared";
import { Skill } from "../types";

interface AgentConsoleProps {
    selectedEmployee?: Skill | null;
    systemPrompt?: string;
    initialMessage?: string;
    className?: string;
    disableCard?: boolean;
    selectedModel?: string;
    permissionMode?: string;
    onLoadConversation?: (convId: string) => void;
    currentConvId?: string;
    loadedConvMessages?: Array<{ role: string; text: string }> | null;
    loadedConvId?: string;
}

export interface ConsoleMessage {
    role: "user" | "assistant" | "system";
    text: string;
    /** Intermediate thinking/reasoning output from the model */
    thinking?: string;
    id: string;
}

const QWEN_API = "http://127.0.0.1:4097";

/** Collapsible block for model thinking/reasoning output */
function ThinkingBlock({ thinking }: { thinking: string }) {
    const [expanded, setExpanded] = useState(false);
    const preview = thinking.length > 80 ? thinking.slice(0, 80) + "..." : thinking;
    return (
        <div className="ml-6 border-l-2 border-purple-700/40 pl-3 py-1 my-1">
            <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
                <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
                <span className="flex items-center gap-1"><Icon name="brain" size={12} /> Thinking {expanded ? "(hide)" : `— ${preview}`}</span>
            </button>
            {expanded && (
                <pre className="mt-1.5 text-xs text-stone-500 whitespace-pre-wrap font-mono leading-relaxed">
                    {thinking}
                </pre>
            )}
        </div>
    );
}

function buildFullSystemPrompt(basePrompt: string | undefined, employee: Skill | null | undefined): string | undefined {
    if (basePrompt) return basePrompt;
    if (employee) return `You are ${employee.codename}, a specialized AI employee (${employee.title}).\n\nRole description: ${employee.description}\n\nStay in character and assist the user specifically using your skills and role boundaries.`;
    return undefined;
}

/**
 * Given the already-accumulated text and a new full-turn string,
 * return only the suffix that hasn't been accumulated yet.
 * Handles the case where the SDK re-sends text that was already streamed via deltas.
 */
function suffixAfter(accumulated: string, turnText: string): string {
    if (!turnText) return "";
    if (!accumulated) return turnText;
    // If turnText starts with what we already have, return the remainder
    if (turnText.startsWith(accumulated)) {
        return turnText.slice(accumulated.length);
    }
    // If turnText is a suffix of accumulated, nothing new
    if (accumulated.endsWith(turnText)) {
        return "";
    }
    // If turnText is entirely contained in accumulated, nothing new
    if (accumulated.includes(turnText)) {
        return "";
    }
    // Otherwise append the full text (new turn / new content)
    return turnText;
}

interface ApprovalRequest {
    queryId: string;
    requestId: string;
    toolName: string;
    toolInput: unknown;
}

export default function AgentConsole({ selectedEmployee, systemPrompt, initialMessage, className, disableCard, selectedModel, permissionMode, onLoadConversation, currentConvId, loadedConvMessages, loadedConvId }: AgentConsoleProps) {
    const [messages, setMessages] = useState<ConsoleMessage[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [connected, setConnected] = useState(false);
    const [activeApproval, setActiveApproval] = useState<ApprovalRequest | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const queryIdRef = useRef<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const initialSentRef = useRef(false);
    const convIdRef = useRef(currentConvId);
    const messagesRef = useRef(messages);

    // Keep refs in sync
    useEffect(() => { convIdRef.current = currentConvId; }, [currentConvId]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // Save conversation to server
    const selectedEmployeeRef = useRef(selectedEmployee);
    useEffect(() => { selectedEmployeeRef.current = selectedEmployee; }, [selectedEmployee]);
    const selectedModelRef = useRef(selectedModel);
    useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
    const systemPromptRef2 = useRef(systemPrompt);
    useEffect(() => { systemPromptRef2.current = systemPrompt; }, [systemPrompt]);

    const saveConversation = useCallback(async (msgs: ConsoleMessage[], convId?: string) => {
        const emp = selectedEmployeeRef.current;
        if (!emp || msgs.length === 0) return;
        const id = convId || convIdRef.current || `conv-${Date.now()}`;
        if (!convIdRef.current) convIdRef.current = id;

        // Build title from first user message
        const firstUserMsg = msgs.find(m => m.role === "user");
        const title = firstUserMsg
            ? firstUserMsg.text.slice(0, 60) + (firstUserMsg.text.length > 60 ? "..." : "")
            : id;

        try {
            await fetch(`${QWEN_API}/api/conversations/${emp.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id,
                    title,
                    messages: msgs.map(m => ({ role: m.role, text: m.text })),
                    model: selectedModelRef.current || "",
                    systemPrompt: systemPromptRef2.current || "",
                }),
            });
        } catch {
            // Silently fail — conversations are best-effort
        }
    }, []);

    // Auto-save when messages change (debounced, 3s)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => {
        if (messages.length === 0) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveConversation(messages);
        }, 3000);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [messages]);

    // Load conversation
    const loadConversation = useCallback(async (convId: string) => {
        if (!selectedEmployee) return;
        try {
            const res = await fetch(`${QWEN_API}/api/conversations/${selectedEmployee.id}/${convId}`);
            if (!res.ok) return;
            const data = await res.json();
            convIdRef.current = convId;
            const loaded: ConsoleMessage[] = (data.messages || []).map((m: any, i: number) => ({
                role: m.role,
                text: m.text,
                id: `${m.role}-${i}-${Date.now()}`,
            }));
            setMessages(loaded);
            initialSentRef.current = true; // Don't auto-send initial message
        } catch {
            // Silently fail
        }
    }, [selectedEmployee]);

    // Expose loadConversation to parent
    useEffect(() => {
        if (onLoadConversation) {
            // We use a custom event pattern instead
        }
    }, [onLoadConversation]);

    // Check API connectivity
    useEffect(() => {
        const check = async () => {
            try {
                const res = await fetch(QWEN_API, { method: "OPTIONS" });
                setConnected(res.ok);
            } catch {
                setConnected(false);
            }
        };
        check();
        const interval = setInterval(check, 10000);
        return () => clearInterval(interval);
    }, []);

    // Reset on employee change
    useEffect(() => {
        setMessages([]);
        setActiveApproval(null);
        initialSentRef.current = false;
        convIdRef.current = undefined;
    }, [selectedEmployee?.id]);

    // Load conversation messages when provided
    useEffect(() => {
        if (loadedConvMessages && loadedConvMessages.length > 0) {
            const loaded: ConsoleMessage[] = loadedConvMessages.map((m, i) => ({
                role: m.role as "user" | "assistant" | "system",
                text: m.text,
                id: `loaded-${i}-${Date.now()}`,
            }));
            setMessages(loaded);
            initialSentRef.current = true;
            // Set convId so auto-save updates the same conversation
            if (loadedConvId) convIdRef.current = loadedConvId;
        }
    }, [loadedConvMessages, loadedConvId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Use refs to always have latest values in closures
    const systemPromptRef = useRef(systemPrompt);
    useEffect(() => { systemPromptRef.current = systemPrompt; }, [systemPrompt]);
    const employeeRef = useRef(selectedEmployee);
    useEffect(() => { employeeRef.current = selectedEmployee; }, [selectedEmployee]);

    const sendQuery = async (promptText: string, overrideSystemPrompt?: string) => {
        // Abort any previous request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Track accumulated text in a ref so the stream handler can read current state synchronously
        const accumulatedRef = { text: "", thinking: "" };

        const userMsg: ConsoleMessage = {
            role: "user",
            text: promptText,
            id: `user-${Date.now()}`,
        };
        setMessages(prev => [...prev, userMsg]);
        setIsLoading(true);

        const assistantId = `asst-${Date.now()}`;
        setMessages(prev => [...prev, { role: "assistant", text: "", id: assistantId }]);

        const sp = buildFullSystemPrompt(overrideSystemPrompt || systemPromptRef.current, employeeRef.current);

        try {
            const res = await fetch(`${QWEN_API}/api/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                    prompt: promptText,
                    systemPrompt: sp,
                    ...(permissionMode ? { permissionMode } : {}),
                    ...(selectedModel ? { model: selectedModel } : {}),
                }),
            });

            if (!res.ok || !res.body) {
                throw new Error(`API error: ${res.status}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();

                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                }
                if (done) {
                    buffer += decoder.decode();
                }

                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.type === "done") {
                            setIsLoading(false);
                            setActiveApproval(null);
                            continue;
                        }
                        if (msg.type === "error") {
                            setActiveApproval(null);
                            setMessages(prev => prev.map(m =>
                                m.id === assistantId ? { ...m, text: m.text + `\n❌ Error: ${msg.data?.message || "Unknown error"}` } : m
                            ));
                            continue;
                        }
                        // Handle approval requests from the server
                        if (msg.type === "approval_request") {
                            const { queryId, requestId, toolName, toolInput } = msg.data || {};
                            queryIdRef.current = queryId;
                            setActiveApproval({ queryId, requestId, toolName, toolInput });
                            continue;
                        }

                        const data = msg.data;
                        let chunk = "";
                        let thinkingChunk = "";

                        if (msg.type === "stream_event" && data?.event) {
                            const evt = data.event;
                            if (evt.type === "content_block_delta" && evt.delta) {
                                if (evt.delta.type === "text_delta" && evt.delta.text) {
                                    chunk = evt.delta.text;
                                } else if (evt.delta.type === "thinking_delta" && evt.delta.thinking) {
                                    thinkingChunk = evt.delta.thinking;
                                }
                            }
                        }
                        else if (msg.type === "assistant" && data?.message?.content) {
                            let turnText = "";
                            let turnThinking = "";
                            for (const block of data.message.content) {
                                if (block.type === "text" && block.text) {
                                    turnText += block.text;
                                } else if (block.type === "thinking" && block.thinking) {
                                    turnThinking += block.thinking;
                                }
                            }
                            // Only append the suffix that isn't already accumulated
                            if (turnText) {
                                chunk = suffixAfter(accumulatedRef.text, turnText);
                            }
                            if (turnThinking) {
                                thinkingChunk = suffixAfter(accumulatedRef.thinking, turnThinking);
                            }
                        }
                        else if (msg.type === "result") {
                            if (data?.result) {
                                chunk = suffixAfter(accumulatedRef.text, String(data.result));
                            }
                            setIsLoading(false);
                        }

                        if (chunk || thinkingChunk) {
                            if (chunk) accumulatedRef.text += chunk;
                            if (thinkingChunk) accumulatedRef.thinking += thinkingChunk;
                            setMessages(prev => prev.map(m =>
                                m.id === assistantId ? {
                                    ...m,
                                    text: accumulatedRef.text,
                                    thinking: accumulatedRef.thinking || undefined,
                                } : m
                            ));
                        }
                    } catch {
                        // skip malformed lines
                    }
                }

                if (done) break;
            }
        } catch (err: any) {
            if (err.name === "AbortError") {
                setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, text: m.text || "⏹️ 已中斷" } : m
                ));
            } else {
                setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, text: m.text || `❌ Connection failed: ${err.message}\n\nMake sure qwen-code-api is running on port 4097.` } : m
                ));
            }
        } finally {
            setIsLoading(false);
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
            }
        }
    };

    // Auto-send initial message with current system prompt
    useEffect(() => {
        if (initialMessage && connected && !initialSentRef.current) {
            initialSentRef.current = true;
            sendQuery(initialMessage, systemPromptRef.current);
        }
    }, [initialMessage, connected]);

    const handleApproval = async (approved: boolean) => {
        if (!activeApproval) return;
        const { queryId, requestId, toolName } = activeApproval;
        setActiveApproval(null);
        try {
            await fetch(`${QWEN_API}/api/approve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ queryId, requestId, approved }),
            });
            if (!approved) {
                setMessages(prev => [...prev, {
                    role: "system",
                    text: `⛔ Denied: ${toolName}`,
                    id: `sys-deny-${Date.now()}`,
                }]);
            }
        } catch {
            // Approval send failed — query may have ended
        }
    };

    const handleSubmit = async () => {
        if (!input.trim() || isLoading) return;
        const text = input.trim();
        setInput("");
        await sendQuery(text);
    };

    const handleAbort = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsLoading(false);
        }
    };

    // Handle new chat
    const handleNewChat = () => {
        // Save current before clearing
        if (messagesRef.current.length > 0) {
            saveConversation(messagesRef.current);
        }
        setMessages([]);
        convIdRef.current = undefined;
        initialSentRef.current = false;
    };

    const content = (
        <>
            {!disableCard && (
                <div className="text-sm text-zinc-600">
                    {selectedEmployee ? selectedEmployee.description : "AI Employee Console"}
                </div>
            )}
            <div className={cn("rounded-xl bg-slate-900 p-4 font-mono text-sm text-stone-300 flex flex-col gap-4 min-h-0", className)}>
                <div className="flex items-center justify-between border-b border-stone-700 pb-3 mb-1 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-stone-400">Agent:</span>
                        <span className="text-orange-400 font-bold">
                            {selectedEmployee?.codename ?? "unknown"}
                        </span>
                        <span
                            className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`}
                            title={connected ? "Connected" : "Offline"}
                        />
                    </div>
                    <button
                        onClick={handleNewChat}
                        className="bg-stone-800 hover:bg-stone-700 text-stone-300 px-3 py-1 rounded-lg text-xs border border-stone-600 transition-colors flex items-center gap-1 active:scale-95"
                        title="Clear conversation"
                    >
                        <span>+</span> New Chat
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 pb-2 min-h-0">
                    {messages.length === 0 && (
                        <div className="text-stone-500 italic">
                            {connected
                                ? "Connected to Qwen Code API. Send a prompt to start."
                                : "⚠️ Qwen Code API not detected on port 4097. Start it with: node server/qwen-code-api.mjs"
                            }
                        </div>
                    )}
                    {messages.map((msg) => (
                        <div key={msg.id} className="flex gap-2 leading-tight">
                            <span className={
                                msg.role === "user"
                                    ? "text-blue-400 font-bold shrink-0"
                                    : msg.role === "system"
                                        ? "text-zinc-500 font-bold shrink-0"
                                        : "text-[#ffbd2e] font-bold shrink-0"
                            }>
                                {msg.role === "user" ? "USER" : msg.role === "system" ? "SYS" : "AGENT"}<Icon name="arrow" size={10} />
                            </span>
                            {msg.role === "assistant" && msg.text === "" && !msg.thinking ? null : (
                                <span className="whitespace-pre-wrap">{msg.text}</span>
                            )}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex items-center gap-2 py-0.5">
                            {activeApproval ? (
                                <>
                                    <span className="text-amber-400">⏳</span>
                                    <span className="text-amber-300 text-xs animate-pulse">Waiting for approval...</span>
                                </>
                            ) : messages.some(m => m.role === "assistant" && !m.text && !m.thinking) || messages.length === 0 ? (
                                <>
                                    <span className="text-amber-400"><Icon name="brain" size={14} /></span>
                                    <span className="text-amber-300 text-xs animate-pulse">Thinking...</span>
                                </>
                            ) : messages.some(m => m.role === "assistant" && m.thinking && !m.text) ? (
                                <>
                                    <span className="text-amber-400"><Icon name="thinking" size={14} /></span>
                                    <span className="text-amber-300 text-xs animate-pulse">Reasoning... (thinking output available)</span>
                                </>
                            ) : (
                                <>
                                    <span className="text-green-400"><Icon name="gear" size={14} /></span>
                                    <span className="text-green-300 text-xs animate-pulse">Working...</span>
                                </>
                            )}
                        </div>
                    )}
                    {/* Show thinking blocks for assistant messages */}
                    {messages.filter(m => m.role === "assistant" && m.thinking).map((msg) => (
                        <ThinkingBlock key={`thinking-${msg.id}`} thinking={msg.thinking!} />
                    ))}
                    <div ref={messagesEndRef} />
                </div>
                {activeApproval && (
                    <div className="shrink-0 border-t border-amber-700/50 bg-amber-950/30 px-4 py-3">
                        <div className="flex items-start gap-3">
                            <span className="text-amber-400 text-lg"><Icon name="warning" size={18} /></span>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold text-amber-300 mb-1">Approval Required</div>
                                <div className="text-xs text-stone-400 mb-1">Tool: <span className="text-amber-200 font-mono">{activeApproval.toolName}</span></div>
                                <pre className="text-xs text-stone-500 whitespace-pre-wrap font-mono leading-relaxed max-h-[120px] overflow-y-auto bg-black/20 rounded px-2 py-1 mb-2">{typeof activeApproval.toolInput === "string" ? activeApproval.toolInput : JSON.stringify(activeApproval.toolInput, null, 2)}</pre>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleApproval(true)}
                                        className="px-4 py-1.5 rounded-lg text-xs font-bold bg-green-800/60 text-green-300 border border-green-600 hover:bg-green-700/70 transition-colors"
                                    >
                                        <Icon name="success" size={14} /> Allow
                                    </button>
                                    <button
                                        onClick={() => handleApproval(false)}
                                        className="px-4 py-1.5 rounded-lg text-xs font-bold bg-red-900/50 text-red-300 border border-red-700 hover:bg-red-800/60 transition-colors"
                                    >
                                        <Icon name="cross" size={14} /> Deny
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <div className="flex items-end gap-2 border-t border-stone-700 pt-4 shrink-0">
                    <span className="text-green-400 mt-1"><Icon name="arrow" size={12} /></span>
                    <textarea
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
                        disabled={isLoading || !connected}
                        placeholder={`Type your prompt for ${selectedEmployee?.codename ?? "agent"}... (Shift+Enter for newline)`}
                        className="flex-1 bg-transparent outline-none disabled:opacity-50 resize-none min-h-[24px] max-h-[120px] overflow-y-auto leading-normal py-0"
                        rows={1}
                    />
                    {isLoading ? (
                        <button
                            onClick={handleAbort}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-900/50 text-red-300 border border-red-700 hover:bg-red-800/60 transition-colors shrink-0"
                            title="中斷"
                        >
                            ⏹ 中斷
                        </button>
                    ) : (
                        <button
                            onClick={handleSubmit}
                            disabled={!input.trim() || !connected}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-stone-800 text-stone-300 border border-stone-600 hover:bg-stone-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                            title="送出"
                        >
                            ▶ 送出
                        </button>
                    )}
                </div>
            </div>
        </>
    );

    if (disableCard) {
        return <div className="flex-1 flex flex-col overflow-hidden">{content}</div>;
    }

    return (
        <Card title={selectedEmployee ? `Collaborating with ${selectedEmployee.codename}` : "AI Console"}>
            {content}
        </Card>
    );
}
