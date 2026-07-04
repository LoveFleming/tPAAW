/**
 * A2A Playground — 簡化版聊天介面
 *
 * 單一聊天區塊，可以：
 *  1. 顯示遠端 Agent Card
 *  2. 跟遠端 Agent 互相討論
 *  3. 互動內容即時顯示
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

const REMOTE_AGENT_URL = "http://localhost:4100";

interface AgentCard {
  name?: string;
  description?: string;
  version?: string;
  protocolVersion?: string;
  url?: string;
  skills?: Array<{ id: string; name: string; description: string }>;
  capabilities?: Record<string, boolean>;
}

interface ChatMessage {
  role: "user" | "agent" | "remote" | "system";
  text: string;
  time: string;
}

export default function A2APlayground({ }: { _a2a?: boolean }) {
  const { t: _t } = useI18n();
  const [card, setCard] = useState<AgentCard | null>(null);
  const [cardError, setCardError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "system", text: "👋 歡迎！輸入訊息跟 Help Desk 聊天", time: "" },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [contextId, setContextId] = useState<string | null>(null);
  const composingRef = useRef(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  const addMsg = useCallback((role: ChatMessage["role"], text: string) => {
    setMessages((prev) => [...prev, { role, text, time: new Date().toLocaleTimeString() }]);
  }, []);

  // Load remote agent card (from Help Desk Agent at 4100)
  const loadCard = useCallback(async () => {
    try {
      const res = await fetch(`${REMOTE_AGENT_URL}/.well-known/agent-card.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCard(data);
      setCardError("");
    } catch (err) {
      setCardError(String(err));
    }
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadCard();
  }, [loadCard]);

  // Auto-scroll
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  // ── Send message to Help Desk (4100) ──
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    setInput("");
    addMsg("user", text);

    addMsg("system", "⏳ Waiting for Help Desk...");

    try {
      const res = await fetch(`${REMOTE_AGENT_URL}/a2a/jsonrpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/send",
          params: {
            message: {
              kind: "message",
              role: "user",
              messageId: `msg-${Date.now()}`,
              parts: [{ kind: "text", text }],
              ...(contextId ? { contextId } : {}),
            },
          },
          id: `paaw-${Date.now()}`,
        }),
      });
      const data = await res.json();

      // Remove "waiting" message
      setMessages((prev) => prev.filter((m) => m.text !== "⏳ Waiting for Help Desk..."));

      if (data.result) {
        const task = data.result;
        if (!contextId && task.contextId) setContextId(task.contextId);
        const artifact = task.artifacts?.[0];
        const responseText = artifact?.parts?.[0]?.text || "(no output)";
        addMsg("remote", responseText);
      } else if (data.error) {
        addMsg("system", `❌ ${data.error.message}`);
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.text !== "⏳ Waiting for Help Desk..."));
      addMsg("system", `❌ ${String(err)}`);
    }
    setSending(false);
  }, [sending, contextId, addMsg]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // ⚠️ IME: use ref-tracked composition state (useState is async, misses same-cycle).
    // Also check native isComposing + keyCode 229 as fallback.
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── Styles ──
  const msgStyles: Record<string, React.CSSProperties> = {
    user: { alignSelf: "flex-end", background: "#1f6feb", color: "#fff", borderRadius: "14px 14px 4px 14px" },
    remote: { alignSelf: "flex-start", background: "#0d2818", border: "1px solid #238636", borderRadius: "14px 14px 14px 4px" },
    agent: { alignSelf: "flex-start", background: "#161b22", border: "1px solid #30363d", borderRadius: "14px 14px 14px 4px" },
    system: { alignSelf: "center", fontSize: "12px", color: "#8b949e", background: "none", padding: "4px 0" },
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0d1117", color: "#e6edf3" }}>
      {/* ── Remote Agent Card ── */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #21262d", background: "#161b22", display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: "#1f6feb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
          🌐
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {card ? card.name : cardError ? "❌ 無法連接遠端 Agent" : "Loading..."}
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {card?.description || cardError || REMOTE_AGENT_URL}
          </div>
          {card?.skills && (
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              {card.skills.map((s) => (
                <span key={s.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#21262d", color: "#8b949e" }}>
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#8b949e" }}>{REMOTE_AGENT_URL}</div>
          <div style={{ fontSize: 11, marginTop: 2, color: card ? "#238636" : cardError ? "#da3633" : "#d29922" }}>
            {card ? "● 已連線" : cardError ? "● 離線" : "● 連線中"}
          </div>
        </div>
      </div>

      {/* ── Chat Area ── */}
      <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              maxWidth: msg.role === "system" ? "100%" : "75%",
              padding: msg.role === "system" ? "4px 0" : "10px 14px",
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              ...msgStyles[msg.role],
            }}
          >
            {(msg.role === "remote" || msg.role === "agent") && (
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, opacity: 0.7 }}>
                {msg.role === "remote" ? "Help Desk" : "PAAW Agent"}
              </div>
            )}
            {msg.text}
          </div>
        ))}
      </div>

      {/* ── Input ── */}
      <div style={{ padding: "12px 20px", borderTop: "1px solid #21262d", display: "flex", gap: 8, background: "#010409" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          rows={1}
          placeholder="輸入訊息... (Enter 送出, Shift+Enter 換行)"
          style={{
            flex: 1,
            background: "#0d1117",
            border: "1px solid #30363d",
            borderRadius: 10,
            padding: "10px 14px",
            color: "#e6edf3",
            fontSize: 14,
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
            minHeight: 44,
            maxHeight: 120,
          }}
          onFocus={(e) => (e.target.style.borderColor = "#1f6feb")}
          onBlur={(e) => (e.target.style.borderColor = "#30363d")}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={sending || !input.trim()}
          style={{
            padding: "8px 20px",
            borderRadius: 10,
            border: "none",
            cursor: sending ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 600,
            background: sending ? "#21262d" : "#238636",
            color: "#fff",
            opacity: sending ? 0.4 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {sending ? "..." : "送出"}
        </button>
      </div>
    </div>
  );
}
