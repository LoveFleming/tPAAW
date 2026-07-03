/**
 * A2A Playground — Agent2Agent Protocol UI Simulator
 *
 * 功能：
 *  1. 顯示 Agent Card (從 /.well-known/agent.json 抓)
 *  2. 送 message/send (同步)
 *  3. 送 message/stream (SSE 串流)
 *  4. 查看 Task 列表
 *  5. JSON-RPC raw request
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";

import API_BASE from "../api";

interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: any;
  skills: any[];
  authentication: any;
}

interface Task {
  id: string;
  contextId?: string;
  status: { state: string; timestamp: string; message?: any };
  history: any[];
  artifacts: any[];
  metadata?: any;
}

interface LogEntry {
  time: string;
  type: "send" | "recv" | "info" | "error";
  data: any;
}

const STATE_COLORS: Record<string, string> = {
  submitted: "#6b7280",
  working: "#3b82f6",
  "input-required": "#f59e0b",
  completed: "#22c55e",
  canceled: "#ef4444",
  failed: "#ef4444",
  rejected: "#ef4444",
};

export default function A2APlayground() {
  const { t } = useI18n();
  const [card, setCard] = useState<AgentCard | null>(null);
  const [input, setInput] = useState("你好！請介紹你自己，然後用 pocket_add 幫我記一筆筆記：A2A test successful");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [toolEvents, setToolEvents] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [tab, setTab] = useState<"chat" | "stream" | "tasks" | "rpc" | "card">("stream");
  const [rpcMethod, setRpcMethod] = useState("message/send");
  const [rpcParams, setRpcParams] = useState(`{
  "message": {
    "role": "user",
    "parts": [{ "type": "text", "text": "Hello from A2A!" }],
    "messageId": "msg-test-001"
  }
}`);
  const streamAreaRef = useRef<HTMLDivElement>(null);

  const log = useCallback((type: LogEntry["type"], data: any) => {
    setLogs(prev => [...prev.slice(-50), { time: new Date().toLocaleTimeString(), type, data }]);
  }, []);

  // Load agent card
  const loadCard = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/.well-known/agent.json`);
      const data = await res.json();
      setCard(data);
      log("info", { message: "Agent Card loaded", data });
    } catch (err) {
      log("error", { message: "Failed to load agent card", error: String(err) });
    }
  }, [log]);

  // Load tasks
  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/a2a/tasks`);
      const data = await res.json();
      setTasks(data.data || []);
    } catch {}
  }, []);

  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadCard();
    loadTasks();
  }, [loadCard, loadTasks]);

  // Auto-scroll
  useEffect(() => {
    if (streamAreaRef.current) {
      streamAreaRef.current.scrollTop = streamAreaRef.current.scrollHeight;
    }
  }, [streamText, toolEvents]);

  // ── message/send (sync) ──
  const handleSendSync = async () => {
    if (!input.trim()) return;
    setStreaming(true);
    log("send", { method: "message/send", text: input });
    try {
      const res = await fetch(`${API_BASE}/a2a`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ type: "text", text: input }],
              messageId: `msg-${Date.now()}`,
            },
          },
          id: `req-${Date.now()}`,
        }),
      });
      const data = await res.json();
      log("recv", data);
      if (data.result) {
        const task: Task = data.result;
        setStreamText(task.artifacts?.[0]?.parts?.[0]?.text || "(no output)");
        loadTasks();
      } else if (data.error) {
        setStreamText(`❌ Error: ${data.error.message}`);
      }
    } catch (err) {
      log("error", { error: String(err) });
      setStreamText(`❌ ${err}`);
    }
    setStreaming(false);
  };

  // ── message/stream (SSE) ──
  const handleSendStream = async () => {
    if (!input.trim()) return;
    setStreaming(true);
    setStreamText("");
    setToolEvents([]);
    log("send", { method: "message/stream", text: input });

    try {
      const res = await fetch(`${API_BASE}/a2a`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              role: "user",
              parts: [{ type: "text", text: input }],
              messageId: `msg-${Date.now()}`,
            },
          },
          id: `req-${Date.now()}`,
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload);
            log("recv", evt);

            if (evt.result?.kind === "task") {
              // Initial task
            } else if (evt.result?.kind === "status-update") {
              const status = evt.result.status;
              if (status.message?.parts?.[0]?.text) {
                setToolEvents(prev => [...prev, status.message.parts[0].text]);
              }
              if (evt.result.final) {
                setStreaming(false);
                loadTasks();
              }
            } else if (evt.result?.kind === "artifact-update") {
              const text = evt.result.artifact?.parts?.[0]?.text;
              if (text) {
                setStreamText(prev => prev + text);
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      log("error", { error: String(err) });
      setStreamText(`❌ ${err}`);
    }
    setStreaming(false);
  };

  // ── Raw JSON-RPC ──
  const handleRawRPC = async () => {
    let parsed;
    try {
      parsed = JSON.parse(rpcParams);
    } catch {
      log("error", { message: "Invalid JSON params" });
      return;
    }
    const body = {
      jsonrpc: "2.0",
      method: rpcMethod,
      params: parsed,
      id: `rpc-${Date.now()}`,
    };
    log("send", body);
    try {
      const res = await fetch(`${API_BASE}/a2a`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      log("recv", data);
    } catch (err) {
      log("error", { error: String(err) });
    }
  };

  const addLogEntry = (entry: LogEntry, i: number) => (
    <div key={i} className={`text-xs font-mono px-2 py-1 border-b border-white/5 ${
      entry.type === "send" ? "text-blue-400" :
      entry.type === "recv" ? "text-green-400" :
      entry.type === "error" ? "text-red-400" : "text-gray-500"
    }`}>
      <span className="text-white/30 mr-2">{entry.time}</span>
      <span className="mr-2">[{entry.type.toUpperCase()}]</span>
      {typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data).slice(0, 200)}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-gray-200">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10">
        <span className="text-lg">🔗</span>
        <h1 className="text-sm font-semibold">A2A Playground</h1>
        {card && (
          <span className="text-xs text-gray-500">
            {card.name} v{card.version} · protocol {card.protocolVersion}
          </span>
        )}
        <button onClick={loadCard} className="ml-auto text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10">
          🔄 Agent Card
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-1 border-b border-white/10 text-xs">
        {(["stream", "chat", "rpc", "tasks", "card"] as const).map(tt => (
          <button
            key={tt}
            onClick={() => setTab(tt)}
            className={`px-3 py-1 rounded-t ${tab === tt ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"}`}
          >
            {tt === "stream" ? "📡 Stream" : tt === "chat" ? "💬 Sync" : tt === "rpc" ? "🔧 RPC" : tt === "tasks" ? "📋 Tasks" : "🏷️ Card"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Input bar (shared) */}
        {(tab === "stream" || tab === "chat") && (
          <div className="px-4 py-2 border-b border-white/10">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    tab === "stream" ? handleSendStream() : handleSendSync();
                  }
                }}
                placeholder="Type a message to the A2A agent..."
                className="flex-1 bg-white/5 text-sm rounded px-3 py-2 outline-none border border-white/10 focus:border-blue-500 resize-none"
                rows={2}
                disabled={streaming}
              />
              <div className="flex flex-col gap-1">
                {tab === "stream" ? (
                  <button
                    onClick={handleSendStream}
                    disabled={streaming || !input.trim()}
                    className="px-4 py-1 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-30"
                  >
                    {streaming ? "⏳" : "📡 Stream"}
                  </button>
                ) : (
                  <button
                    onClick={handleSendSync}
                    disabled={streaming || !input.trim()}
                    className="px-4 py-1 text-sm rounded bg-green-600 hover:bg-green-500 disabled:opacity-30"
                  >
                    {streaming ? "⏳" : "💬 Send"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stream / Sync response area */}
        {(tab === "stream" || tab === "chat") && (
          <div className="flex-1 overflow-auto p-4" ref={streamAreaRef}>
            {toolEvents.length > 0 && (
              <div className="mb-3">
                {toolEvents.map((evt, i) => (
                  <div key={i} className="text-xs text-yellow-400 font-mono mb-1">⚡ {evt}</div>
                ))}
              </div>
            )}
            {streamText ? (
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{streamText}</div>
            ) : (
              !streaming && <div className="text-xs text-gray-600">Response will appear here...</div>
            )}
          </div>
        )}

        {/* RPC tab */}
        {tab === "rpc" && (
          <div className="flex-1 overflow-auto p-4 space-y-3">
            <div className="flex gap-2 items-center">
              <span className="text-xs text-gray-500">Method:</span>
              <select
                value={rpcMethod}
                onChange={e => setRpcMethod(e.target.value)}
                className="bg-white/5 text-sm rounded px-2 py-1 border border-white/10"
              >
                <option value="message/send">message/send</option>
                <option value="message/stream">message/stream</option>
                <option value="tasks/get">tasks/get</option>
                <option value="tasks/list">tasks/list</option>
                <option value="tasks/cancel">tasks/cancel</option>
              </select>
              <button onClick={handleRawRPC} className="ml-auto px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-500">
                Send RPC
              </button>
            </div>
            <textarea
              value={rpcParams}
              onChange={e => setRpcParams(e.target.value)}
              className="w-full bg-black/40 text-xs font-mono rounded p-3 border border-white/10 h-48"
            />
          </div>
        )}

        {/* Tasks tab */}
        {tab === "tasks" && (
          <div className="flex-1 overflow-auto p-4">
            <div className="flex items-center mb-3">
              <h2 className="text-sm font-semibold">Tasks ({tasks.length})</h2>
              <button onClick={loadTasks} className="ml-auto text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10">🔄 Refresh</button>
            </div>
            {tasks.length === 0 ? (
              <div className="text-xs text-gray-600">No tasks yet. Send a message first!</div>
            ) : (
              <div className="space-y-2">
                {tasks.map(task => (
                  <div key={task.id} className="bg-white/5 rounded p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-gray-400">{task.id}</span>
                      <span
                        className="px-1.5 py-0.5 rounded text-white text-[10px]"
                        style={{ background: STATE_COLORS[task.status?.state] || "#6b7280" }}
                      >
                        {task.status?.state}
                      </span>
                      <span className="text-gray-600 ml-auto">{new Date(task.status?.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="text-gray-400">
                      {task.history?.[0]?.parts?.[0]?.text?.slice(0, 100)}
                    </div>
                    {task.metadata?.toolsUsed?.length > 0 && (
                      <div className="text-yellow-500 mt-1">🔧 {task.metadata.toolsUsed.join(", ")}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Agent Card tab */}
        {tab === "card" && (
          <div className="flex-1 overflow-auto p-4">
            <pre className="text-xs font-mono bg-black/40 rounded p-4 overflow-auto">
              {JSON.stringify(card, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Log panel */}
      <div className="h-32 border-t border-white/10 overflow-auto bg-black/40">
        {logs.length === 0 ? (
          <div className="text-xs text-gray-700 p-2">Activity log...</div>
        ) : (
          logs.map(addLogEntry)
        )}
      </div>
    </div>
  );
}
