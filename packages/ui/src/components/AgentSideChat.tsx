/**
 * AgentSideChat — 側欄 AI 助理對話（共用元件）
 *
 * Release Manager / Handover / Troubleshooting 三個頁面共用。
 * 打 /a2a/:agentId 的 message/stream（與 EM Dashboard chat 同協議）。
 *
 * 注意：textarea 有 IME composition 三層保護（TOOLS.md 紀律）。
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { fmtChatTime } from "../utils";

export interface SideChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

interface AgentSideChatProps {
  agentId: string;          // e.g. "rm" | "handover" | "ops"
  agentName: string;
  agentEmoji?: string;
  greeting?: string;
  cwd: string;              // project root path
  suggestions?: { label: string; prompt: string }[];
  placeholder?: string;
  accent?: string;          // theme accent color
  height?: string;          // e.g. "100%" — container height
}

export default function AgentSideChat({
  agentId,
  agentName,
  agentEmoji = "🤖",
  greeting,
  cwd,
  suggestions = [],
  placeholder = "問我任何問題…",
  accent = "#8b5e3c",
  height = "100%",
}: AgentSideChatProps) {
  const [messages, setMessages] = useState<SideChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false); // IME 三層保護（可靠層）

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    if (text) setInput("");
    else setInput("");

    const userMsg: SideChatMessage = { role: "user", content: msg, ts: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setAction("💭 思考中…");

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`${API_BASE}/a2a/${agentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: { role: "user", parts: [{ type: "text", text: msg }] },
            context: { cwd },
            conversationHistory: [...messages, { role: "user", content: msg }],
          },
          id: `${agentId}-chat-${Date.now()}`,
        }),
        signal: ac.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let currentEvent = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); continue; }
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));

            if (currentEvent === "thinking" && d.content) {
              setAction("💭 思考中…");
            } else if (currentEvent === "tool" && d.name) {
              const labels: Record<string, string> = {
                read_file: "📖 讀取", write_file: "✏️ 寫入", edit_file: "✏️ 編輯",
                glob: "🔍 找檔案", grep: "🔍 搜內容", bash: "⚡ 執行", git: "🔄 Git",
              };
              if (d.args !== undefined) {
                const argsObj = typeof d.args === "string" ? (() => { try { return JSON.parse(d.args); } catch { return {}; } })() : d.args;
                const detail = argsObj?.path || argsObj?.pattern || argsObj?.command || "";
                setAction(`${labels[d.name] || `🔧 ${d.name}`} ${String(detail).split(/[\/\\]/).pop()}`);
              }
              if (d.result !== undefined) setAction("💭 思考中…");
            } else if (currentEvent === "content" && d.content) {
              fullText = d.content;
              setMessages(prev => [...prev, { role: "assistant", content: d.content, ts: new Date().toISOString() }]);
            } else if (currentEvent === "error" && d.error) {
              const errText = typeof d.error === "string" ? d.error : d.error.error || d.error.message || "unknown";
              setMessages(prev => [...prev, { role: "assistant", content: `❌ ${errText}`, ts: new Date().toISOString() }]);
              fullText = "__error__";
            } else if (d.result) {
              const t = d.result.artifacts?.[0]?.parts?.[0]?.text;
              if (t) {
                fullText = t;
                setMessages(prev => [...prev, { role: "assistant", content: t, ts: new Date().toISOString() }]);
              }
            } else if (d.error) {
              setMessages(prev => [...prev, { role: "assistant", content: `❌ ${d.error.message || "unknown"}`, ts: new Date().toISOString() }]);
              fullText = "__error__";
            }
            currentEvent = "";
          } catch { /* ignore malformed chunk */ }
        }
      }

      if (!fullText) {
        setMessages(prev => [...prev, { role: "assistant", content: "（AI 回應完成但無文字內容）", ts: new Date().toISOString() }]);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setMessages(prev => [...prev, { role: "assistant", content: `❌ 連線失敗：${err?.message || "unknown"}`, ts: new Date().toISOString() }]);
      }
    } finally {
      setLoading(false);
      setAction("");
      abortRef.current = null;
    }
  }, [input, loading, messages, agentId, cwd]);

  return (
    <div className="flex flex-col border-l" style={{ borderColor: "#e7e5e4", height }}>
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0" style={{ borderColor: "#e7e5e4" }}>
        <span className="text-base">{agentEmoji}</span>
        <span className="text-xs font-bold text-stone-700">{agentName}</span>
        {loading && <span className="text-[10px] text-stone-400 animate-pulse ml-auto">{action || "處理中…"}</span>}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3" style={{ scrollbarWidth: "thin" }}>
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center text-2xl mb-2" style={{ backgroundColor: accent + "15" }}>
              {agentEmoji}
            </div>
            <p className="text-xs text-stone-500 leading-relaxed max-w-[220px] mx-auto">{greeting}</p>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
                {suggestions.map(s => (
                  <button key={s.label} onClick={() => send(s.prompt)}
                    className="text-[10px] px-2.5 py-1 rounded-full border border-stone-200 text-stone-500 hover:bg-stone-50 hover:border-stone-300 transition-colors">
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[92%] rounded-xl px-3 py-2 ${m.role === "user" ? "bg-stone-800 text-white" : "bg-white border border-stone-200 text-stone-700"}`}
              style={m.role === "assistant" ? { borderLeft: `2px solid ${accent}` } : undefined}>
              <div className="text-[10px] text-stone-400 mb-0.5">{m.role === "user" ? "你" : agentName} · {fmtChatTime(m.ts)}</div>
              <div className="text-xs whitespace-pre-wrap leading-relaxed">{m.content}</div>
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-white border border-stone-200 rounded-xl px-3 py-2" style={{ borderLeft: `2px solid ${accent}` }}>
              <div className="text-xs text-stone-400 animate-pulse">{action || "💭 思考中…"}</div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input — IME 三層保護：composingRef → isComposing → keyCode 229 */}
      <div className="border-t p-2 shrink-0" style={{ borderColor: "#e7e5e4" }}>
        <div className="flex gap-1.5 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={e => {
              if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            rows={2}
            placeholder={placeholder}
            className="flex-1 text-xs rounded-lg border border-stone-200 px-2.5 py-2 resize-none focus:outline-none focus:border-stone-400 bg-white"
          />
          {loading ? (
            <button onClick={() => abortRef.current?.abort()}
              className="text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 shrink-0">停止</button>
          ) : (
            <button onClick={() => send()} disabled={!input.trim()}
              className="text-xs px-3 py-2 rounded-lg text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: accent }}>
              送出
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
