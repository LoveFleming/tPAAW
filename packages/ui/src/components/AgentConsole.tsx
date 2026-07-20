import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../utils";
import Icon from "./Icon";
import MarkdownText from "./MarkdownText";

// ── Types ──

interface AgentConsoleProps {
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  initialPrompt?: string;
  restartTrigger?: number;
  onReady?: () => void;
  onDone?: () => void;
}

export interface AgentConsoleHandle {
  sendPrompt: (text: string, newSystemPrompt?: string) => void;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  events?: AgentEvent[];
  timestamp: number;
}

interface AgentEvent {
  type: "tool_start" | "tool_end" | "thinking" | "response";
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  content?: string;
}

const WS_PORT = import.meta.env.VITE_PAAW_WS_PORT || (parseInt(window.location.port || "4097", 10) + 1);

// ── Component ──

const AgentConsole = React.forwardRef<AgentConsoleHandle, AgentConsoleProps>(function AgentConsole({
  cwd,
  model,
  systemPrompt,
  initialPrompt,
  restartTrigger,
  onReady,
  onDone,
}, ref) {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [currentEvents, setCurrentEvents] = useState<AgentEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const initialSentRef = useRef(false);
  const busyRef = useRef(false);
  const optsRef = useRef({ cwd, model, systemPrompt, initialPrompt });
  optsRef.current = { cwd, model, systemPrompt, initialPrompt };

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentEvents]);

  // Expose sendPrompt to parent
  React.useImperativeHandle(ref, () => ({
    sendPrompt: (text: string, newSystemPrompt?: string) => {
      if (!text.trim()) return;
      // If systemPrompt changed, update it on the agent session
      if (newSystemPrompt && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "set_system_prompt", systemPrompt: newSystemPrompt }));
      }
      sendMessage(text.trim());
    },
  }), []);

  // Connect WebSocket
  useEffect(() => {
    mountedRef.current = true;
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
          engine: "paaw-agent",
          cwd: opts.cwd || undefined,
          model: opts.model || undefined,
          systemPrompt: opts.systemPrompt || undefined,
        },
      }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      let msg: any;
      try { msg = JSON.parse(event.data as string); } catch { return; }

      switch (msg.type) {
        case "ready":
          setReady(true);
          onReady?.();
          break;
        case "cliReady":
          // Agent is ready
          break;
        case "agent_running":
          setBusy(true);
          busyRef.current = true;
          setCurrentEvents([]);
          break;
        case "agent_event":
          setCurrentEvents(prev => [...prev, {
            type: msg.event,
            name: msg.name,
            args: msg.args,
            result: msg.result,
            content: msg.content,
          }]);
          break;
        case "agent_done": {
          setBusy(false);
          busyRef.current = false;
          // Add assistant message with events
          const assistantMsg: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: "assistant",
            content: msg.content || "",
            events: [...currentEvents],
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, assistantMsg]);
          setCurrentEvents([]);
          if (msg.success !== false) onDone?.();
          break;
        }
        case "agent_busy":
          // Agent is busy, ignore
          break;
        case "agent_error":
          setBusy(false);
          busyRef.current = false;
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}`,
            role: "system",
            content: `❌ Error: ${msg.message}`,
            timestamp: Date.now(),
          }]);
          setCurrentEvents([]);
          break;
        case "cliDone":
          onDone?.();
          break;
        case "exit":
          setReady(false);
          break;
        case "error":
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}`,
            role: "system",
            content: `❌ ${msg.message}`,
            timestamp: Date.now(),
          }]);
          break;
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
    };

    return () => {
      mountedRef.current = false;
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
      wsRef.current = null;
    };
  }, []);

  // Auto-send initial prompt
  useEffect(() => {
    if (!ready || !initialPrompt || initialSentRef.current) return;
    initialSentRef.current = true;
    sendMessage(initialPrompt);
  }, [ready, initialPrompt]);

  // Restart trigger
  const prevRestartRef = useRef(restartTrigger);
  useEffect(() => {
    if (restartTrigger === undefined || restartTrigger === prevRestartRef.current) return;
    prevRestartRef.current = restartTrigger;
    restartSession();
  }, [restartTrigger]);

  const restartSession = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "kill" }));
      wsRef.current.close();
      wsRef.current = null;
    }
    setReady(false);
    setConnected(false);
    setBusy(false);
    busyRef.current = false;
    setMessages([]);
    setCurrentEvents([]);
    initialSentRef.current = false;

    setTimeout(() => {
      if (!mountedRef.current) return;
      const wsUrl = `ws://${window.location.hostname}:${WS_PORT}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        const opts = optsRef.current;
        ws.send(JSON.stringify({
          type: "spawn",
          options: {
            engine: "paaw-agent",
            cwd: opts.cwd || undefined,
            model: opts.model || undefined,
            systemPrompt: opts.systemPrompt || undefined,
          },
        }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        let msg: any;
        try { msg = JSON.parse(event.data as string); } catch { return; }
        // Re-use same message handling by dispatching to a shared handler
        // For simplicity, we just handle the critical ones here
        if (msg.type === "ready") { setReady(true); onReady?.(); }
        else if (msg.type === "agent_running") { setBusy(true); busyRef.current = true; setCurrentEvents([]); }
        else if (msg.type === "agent_event") {
          setCurrentEvents(prev => [...prev, {
            type: msg.event, name: msg.name, args: msg.args,
            result: msg.result, content: msg.content,
          }]);
        }
        else if (msg.type === "agent_done") {
          setBusy(false); busyRef.current = false;
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}`, role: "assistant",
            content: msg.content || "", events: [...currentEvents], timestamp: Date.now(),
          }]);
          setCurrentEvents([]);
        }
        else if (msg.type === "agent_error") {
          setBusy(false); busyRef.current = false;
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}`, role: "system",
            content: `❌ Error: ${msg.message}`, timestamp: Date.now(),
          }]);
          setCurrentEvents([]);
        }
        else if (msg.type === "cliDone") onDone?.();
      };

      ws.onclose = () => { setConnected(false); setReady(false); };
      ws.onerror = () => { setConnected(false); };
    }, 500);
  }, [currentEvents]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || busyRef.current) return;
    // Add user message to chat
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    // Send to agent via WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", text: text.trim() }));
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage(input.trim());
    setInput("");
  };

  // ── Render helpers ──

  const renderEvent = (evt: AgentEvent, idx: number) => {
    switch (evt.type) {
      case "tool_start":
        return (
          <div key={idx} className="flex items-center gap-1.5 text-sm text-amber-400 py-0.5">
            <span className="w-3 h-3 border-[1.5px] border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="font-mono font-medium">{evt.name}</span>
            {evt.args && <span className="text-stone-500 truncate max-w-[200px]">{JSON.stringify(evt.args).slice(0, 80)}</span>}
          </div>
        );
      case "tool_end":
        return (
          <div key={idx} className="flex items-center gap-1.5 text-sm text-emerald-400 py-0.5">
            <span>✅</span>
            <span className="font-mono font-medium">{evt.name}</span>
            {evt.result && <span className="text-stone-500 truncate max-w-[300px]">{evt.result.slice(0, 100)}</span>}
          </div>
        );
      case "thinking":
        return (
          <div key={idx} className="flex items-center gap-1.5 text-sm text-blue-400 py-0.5">
            <span>💭</span>
            <span className="italic truncate">{evt.content?.slice(0, 150)}</span>
          </div>
        );
      case "response":
        return null; // response is shown as the main content
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-900 rounded-lg overflow-hidden">
        {/* Busy banner */}
        {busy && (
          <div className="shrink-0 px-4 py-2 bg-gradient-to-r from-amber-900/40 to-orange-900/40 border-b border-amber-700 flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-sm font-medium text-amber-400">Agent 工作中</span>
            {currentEvents.length > 0 && (
              <span className="text-xs text-amber-500 ml-1">· {currentEvents.filter(e => e.type === 'tool_start').length} 個工具已執行</span>
            )}
          </div>
        )}

      {/* Chat messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1" style={{ scrollbarWidth: "thin" }}>
        {/* Welcome message */}
        {messages.length === 0 && !busy && (
          <div className="flex items-center justify-center h-full text-stone-500 text-base">
            <div className="text-center">
              <div className="text-4xl mb-2">🤖</div>
              <div className="font-medium text-stone-400">PAAW Agent</div>
              <div className="text-sm mt-1">輸入訊息開始對話</div>
            </div>
          </div>
        )}
        {messages.map(msg => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end mb-3">
                <div className="bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%] text-base whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            );
          }
          if (msg.role === "system") {
            return (
              <div key={msg.id} className="flex justify-center mb-3">
                <div className="bg-red-900/30 text-red-400 rounded-lg px-4 py-2 text-sm">
                  {msg.content}
                </div>
              </div>
            );
          }
          // Assistant message
          return (
            <div key={msg.id} className="flex justify-start mb-3">
              <div className="bg-stone-800 border border-stone-700 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%]">
                {/* Tool events */}
                {msg.events && msg.events.length > 0 && (
                  <div className="mb-2 pb-2 border-b border-stone-700 space-y-0.5">
                    {msg.events.filter(e => e.type !== "response").map((evt, i) => renderEvent(evt, i))}
                  </div>
                )}
                {/* Content */}
                {msg.content && (
                  <div className="text-base text-stone-200 break-words">
                    <MarkdownText className="md-dark">{msg.content}</MarkdownText>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {/* Live events while agent is running */}
        {busy && currentEvents.length > 0 && (
          <div className="flex justify-start mb-3">
            <div className="bg-amber-900/30 border border-amber-700 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%]">
              <div className="flex items-center gap-2 text-sm text-amber-400 mb-1.5">
                <span className="w-3.5 h-3.5 border-[1.5px] border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
                <span className="font-medium">Agent 正在執行...</span>
              </div>
              <div className="space-y-0.5">
                {currentEvents.filter(e => e.type !== "response").map((evt, i) => renderEvent(evt, i))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-stone-700 bg-stone-900 px-3 py-2">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={busy ? "Agent 正在思考..." : "輸入訊息..."}
            disabled={busy || !connected || !ready}
            className="flex-1 px-3 py-2 rounded-lg border border-stone-600 bg-stone-800 text-base text-stone-200 placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-stone-800 disabled:text-stone-500"
          />
          <button
            type="submit"
            disabled={busy || !input.trim() || !connected || !ready}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:bg-stone-700 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 border-[1.5px] border-white border-t-transparent rounded-full animate-spin" /></span>
            ) : (
              "送出"
            )}
          </button>
        </form>
        {/* Status bar */}
        <div className="flex items-center justify-between mt-1.5 px-1">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "w-2 h-2 rounded-full shrink-0",
              connected && ready ? "bg-emerald-500" : connected ? "bg-yellow-500 animate-pulse" : "bg-red-500"
            )} />
            <span className="text-xs text-stone-500">
              {connected && ready ? "PAAW Agent ready" : connected ? "Connecting..." : "Disconnected"}
            </span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={restartSession}
              className="px-2 py-0.5 rounded text-xs font-bold text-stone-500 hover:text-stone-300 transition-colors border border-stone-600 hover:border-stone-500"
              title="Restart session"
            >
              <Icon name="restart" size={12} /> Restart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default AgentConsole;
