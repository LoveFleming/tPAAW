/**
 * ProjectAiPanel — 內嵌於 Project App 的 AI 對話面板
 * 不跳到聊天視窗，直接在 Project Board 內對話
 */

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import API_BASE from "../api";

// ── Types ──
interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: { name: string; status: string; args?: any }[];
  toolResults?: { name: string; result?: any }[];
}

interface Props {
  /** Context seed: what the AI should know about */
  context: string;
  /** Initial prompt when panel opens */
  initialPrompt?: string;
  /** Theme tokens from parent */
  tk: any;
  onClose: () => void;
}

export default function ProjectAiPanel({ context, initialPrompt, tk, onClose }: Props) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasSentInitial = useRef(false);

  // ── Model selector state ──
  const [providers, setProviders] = useState<Record<string, any>>({});
  const [activeProviderId, setActiveProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // ── System prompt loaded from ai-settings/project/ via context-engine ──
  // Server-side: /api/paaw/chat with contextTarget="project" loads it automatically

  useEffect(() => {
    // Load model config
    fetch(`${API_BASE}/api/paaw/providers`)
      .then(r => r.json())
      .then(data => {
        setProviders(data.providers || {});
        setActiveProviderId(data.active || "");
        setSelectedModel(data.defaultModel || "");
      })
      .catch(() => {});
  }, []);

  const allModels = useCallback(() => {
    const result: { providerId: string; providerName: string; modelId: string; modelName: string }[] = [];
    for (const [pid, p] of Object.entries(providers)) {
      for (const m of (p.models || [])) {
        result.push({ providerId: pid, providerName: p.name, modelId: m.id, modelName: m.name });
      }
    }
    return result;
  }, [providers]);

  const activeModelName = allModels().find(m => `${m.providerId}/${m.modelId}` === selectedModel || m.modelId === selectedModel)?.modelName || selectedModel || "預設";
  const fullModelForApi = useCallback(() => {
    if (!selectedModel) return undefined;
    if (selectedModel.includes("/")) return selectedModel;
    return `${activeProviderId}/${selectedModel}`;
  }, [selectedModel, activeProviderId]);

  // Scroll to bottom
  const scrollToBottom = useCallback((smooth = true) => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    }, 50);
  }, []);

  // Auto-send initial prompt once
  useEffect(() => {
    if (initialPrompt && !hasSentInitial.current) {
      hasSentInitial.current = true;
      handleSend(initialPrompt);
    }
  }, [initialPrompt]);

  // ── Send message via SSE ──
  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: "user", content: text, timestamp: new Date().toISOString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    scrollToBottom(false);

    const assistantMsg: Message = { role: "assistant", content: "", timestamp: new Date().toISOString(), toolCalls: [], toolResults: [] };
    const withAssistant = [...newMessages, assistantMsg];
    setMessages(withAssistant);

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Build the messages array — server will load project prompts from ai-settings
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));

      const resp = await fetch(`${API_BASE}/api/paaw/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, model: fullModelForApi(), contextTarget: "project" }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        const err = await resp.text();
        assistantMsg.content = `❌ API 錯誤: ${resp.status} — ${err.slice(0, 200)}`;
        setMessages([...newMessages, assistantMsg]);
        setIsLoading(false);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.content) {
              fullContent += parsed.content;
              assistantMsg.content = fullContent;
              setMessages([...newMessages, { ...assistantMsg }]);
              scrollToBottom(false);
            }

            if (parsed.tool_call) {
              assistantMsg.toolCalls = [...(assistantMsg.toolCalls || []), { name: parsed.tool_call.name, status: parsed.tool_call.status, args: parsed.tool_call.args }];
              setMessages([...newMessages, { ...assistantMsg }]);
            }

            if (parsed.tool_result) {
              assistantMsg.toolResults = [...(assistantMsg.toolResults || []), { name: parsed.tool_result.name, result: parsed.tool_result.result }];
              setMessages([...newMessages, { ...assistantMsg }]);
            }

            if (parsed.error) {
              assistantMsg.content += `\n❌ ${parsed.message || "發生錯誤"}`;
              setMessages([...newMessages, { ...assistantMsg }]);
            }
          } catch {}
        }
      }

      // Final update
      assistantMsg.content = fullContent || assistantMsg.content || "（無回應）";
      setMessages([...newMessages, assistantMsg]);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        assistantMsg.content = `❌ 連線錯誤: ${err.message}`;
        setMessages([...newMessages, assistantMsg]);
      }
    }

    setIsLoading(false);
    scrollToBottom();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setIsLoading(false);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: tk.bg, borderLeft: `1px solid ${tk.borderLight}` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <span className="text-sm font-semibold" style={{ color: tk.textPrimary }}>AI 專案助理</span>
          {isLoading && <span className="text-xs animate-pulse" style={{ color: tk.accent }}>思考中…</span>}
          {/* Model selector */}
          <div className="relative">
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              className="text-xs px-2 py-1 rounded flex items-center gap-1"
              style={{ background: showModelDropdown ? tk.bgHover : "transparent", color: tk.textMuted, border: `1px solid ${showModelDropdown ? tk.border : "transparent"}` }}
              title="AI Model 偏好"
            >🤖 {activeModelName} ▾</button>
            {showModelDropdown && (
              <div className="absolute top-full left-0 mt-1 rounded-lg shadow-lg border py-1 z-50" style={{ background: tk.bg, borderColor: tk.borderLight, minWidth: 180, maxHeight: 280, overflow: "auto" }}>
                {allModels().map(m => {
                  const fullId = `${m.providerId}/${m.modelId}`;
                  const isActive = fullId === selectedModel || m.modelId === selectedModel;
                  return (
                    <div key={fullId} onClick={() => { setSelectedModel(fullId); setShowModelDropdown(false); }}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs" style={{ background: isActive ? tk.bgHover : "transparent", color: tk.textPrimary }}
                      onMouseEnter={e => e.currentTarget.style.background = tk.bgHover}
                      onMouseLeave={e => e.currentTarget.style.background = isActive ? tk.bgHover : "transparent"}>
                      {isActive && <span style={{ color: tk.accent }}>✓</span>}
                      <div><div style={{ fontWeight: 500 }}>{m.modelName}</div><div style={{ color: tk.textMuted }}>{m.providerName}</div></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isLoading && (
            <button onClick={stopGeneration} className="text-xs px-2 py-1 rounded" style={{ color: "#ef4444", border: "1px solid #fecaca" }}>⏹ 停止</button>
          )}
          <button onClick={onClose} className="text-lg leading-none px-1" style={{ color: tk.textMuted }}>✕</button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "thin" }}>
        {/* Context hint */}
        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: tk.bgMuted, color: tk.textMuted, border: `1px dashed ${tk.border}` }}>
          📋 {context}
        </div>

        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">🤖</div>
            <div className="text-sm" style={{ color: tk.textMuted }}>問我任何關於專案的問題</div>
            <div className="flex flex-wrap gap-2 mt-4 justify-center">
              <button onClick={() => handleSend(t("projectAi.newProjectPrompt"))}
                className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe" }}>
                🏗️ 建專案
              </button>
              <button onClick={() => handleSend(t("projectAi.analyzePrompt"))}
                className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0" }}>
                📊 分析專案
              </button>
              <button onClick={() => handleSend(t("projectAi.delayPrompt"))}
                className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "#fefce8", color: "#854d0e", border: "1px solid #fde68a" }}>
                ⚠️ 找風險
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
              msg.role === "user"
                ? "text-white"
                : ""
            }`} style={
              msg.role === "user"
                ? { background: tk.accent, color: tk.accentText === tk.accent ? "#fff" : tk.accentText }
                : { background: tk.bgMuted, color: tk.textPrimary, border: `1px solid ${tk.borderLight}` }
            }>
              {msg.role === "assistant" ? (
                <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || "…"}</ReactMarkdown>
                </div>
              ) : (
                <span>{msg.content}</span>
              )}

              {/* Tool indicators */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {msg.toolCalls.map((tc, j) => (
                    <div key={j} className="text-xs flex items-center gap-1" style={{ color: tk.textMuted }}>
                      <span>{tc.status === "executing" ? "⏳" : "✅"}</span>
                      <span>{tc.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 py-3" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
        <div className="flex items-end gap-2 rounded-xl border px-3 py-2" style={{ background: tk.bg, borderColor: tk.border }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("projectAi.inputPlaceholder")}
            rows={1}
            className="flex-1 text-sm outline-none resize-none bg-transparent"
            style={{ color: tk.textPrimary, maxHeight: 120 }}
            onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="shrink-0 text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 transition-colors"
            style={{ background: tk.accentBg, color: tk.accentText }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
