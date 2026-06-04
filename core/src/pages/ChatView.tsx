import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "../theme";

const API_BASE = "http://127.0.0.1:4097";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

interface UserProfile {
  name: string;
  intro: string;
  style: string;
  assistantAvatar?: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

interface Props {
  profile: UserProfile;
  embedded?: boolean;
}

export default function ChatView({ profile, embedded = false }: Props) {
  const { info: themeInfo } = useTheme();

  // ── State ──
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showChatList, setShowChatList] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Provider / model
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("");
  const [activeModel, setActiveModel] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Load providers ──
  useEffect(() => {
    fetch(`${API_BASE}/api/tclaw/providers`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setActiveProviderId(data.active);
        setActiveModel(data.defaultModel);
        const list: ProviderInfo[] = [];
        for (const [id, p] of Object.entries(data.providers || {})) {
          const prov = p as any;
          list.push({ id, name: prov.name, models: prov.models || [] });
        }
        setProviders(list);
      })
      .catch(() => {});
  }, []);

  // ── Load chats ──
  const loadChats = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/tclaw/chats`);
      if (resp.ok) setChats(await resp.json());
    } catch {}
  }, []);

  useEffect(() => { loadChats(); }, []);

  useEffect(() => {
    if (!activeChatId) return;
    const chat = chats.find(c => c.id === activeChatId);
    if (chat) setMessages(chat.messages);
  }, [activeChatId, chats]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  // ── Chat actions ──
  const createNewChat = async () => {
    const chatId = `chat_${Date.now()}`;
    const greeting: Message = {
      role: "assistant",
      content: `嗨${profile.name ? ` ${profile.name}` : ""}！👋 我是${profile.assistantName || "林語晴"}，你的個人助理 🌤️\n\n有什麼可以幫你的嗎？`,
      timestamp: new Date().toISOString(),
    };
    const newChat = { id: chatId, title: "新對話", messages: [greeting], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    try {
      await fetch(`${API_BASE}/api/tclaw/chats`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newChat),
      });
    } catch {}
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(chatId);
    setMessages([greeting]);
    setShowChatList(false);
  };

  const deleteChat = async (chatId: string) => {
    try { await fetch(`${API_BASE}/api/tclaw/chats/${chatId}`, { method: "DELETE" }); } catch {}
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (activeChatId === chatId) {
      const remaining = chats.filter(c => c.id !== chatId);
      setActiveChatId(remaining.length > 0 ? remaining[0].id : null);
      setMessages(remaining.length > 0 ? remaining[0].messages : []);
    }
  };

  const selectChat = (chat: Chat) => {
    setActiveChatId(chat.id);
    setMessages(chat.messages);
    setShowChatList(false);
  };

  const saveMessages = async (chatId: string, msgs: Message[]) => {
    const firstUserMsg = msgs.find(m => m.role === "user");
    const title = firstUserMsg ? firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? "..." : "") : "新對話";
    try {
      await fetch(`${API_BASE}/api/tclaw/chats/${chatId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, title }),
      });
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, title, messages: msgs } : c));
    } catch {}
  };

  // ── Send message (SSE streaming) ──
  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeChatId || isLoading) return;

    const userMsg: Message = { role: "user", content: text, timestamp: new Date().toISOString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    // Prepare assistant placeholder
    const assistantMsg: Message = { role: "assistant", content: "", timestamp: new Date().toISOString() };
    const withAssistant = [...newMessages, assistantMsg];
    setMessages(withAssistant);

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const resp = await fetch(`${API_BASE}/api/tclaw/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          model: activeModel,
          provider: activeProviderId,
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        const err = await resp.text();
        assistantMsg.content = `❌ API 錯誤: ${resp.status} — ${err.slice(0, 200)}`;
        setMessages([...newMessages, assistantMsg]);
        await saveMessages(activeChatId, [...newMessages, assistantMsg]);
        return;
      }

      // Read SSE stream
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

        let toolCallDisplay = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              fullContent += `\n❌ ${parsed.message}`;
            } else if (parsed.content) {
              fullContent += parsed.content;
            } else if (parsed.tool_call) {
              const tc = parsed.tool_call;
              const icon = { todo_add: "📝", todo_list: "📋", todo_update: "✏️", todo_delete: "🗑️", note_create: "📝", note_list: "📓", note_read: "📖", note_delete: "🗑️", file_read: "📄", file_list: "📁", memory_save: "🧠", memory_read: "💭", web_search: "🔍" }[tc.name] || "🔧";
              const label = tc.name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
              if (tc.status === "executing") {
                toolCallDisplay = `${icon} ${label}...`;
              }
            } else if (parsed.tool_result) {
              const tr = parsed.tool_result;
              if (tr.result?.text) {
                // Append tool result as a visible card
                fullContent += `\n\n> 🔧 **${tr.name.replace(/_/g, " ")}**\n> ${tr.result.text.split("\n").join("\n> ")}\n`;
              }
              toolCallDisplay = "";
            }
          } catch {}
        }

        // Update message progressively
        assistantMsg.content = fullContent;
        setMessages([...newMessages, { ...assistantMsg }]);
      }

      assistantMsg.content = fullContent;
      setMessages([...newMessages, { ...assistantMsg }]);
      await saveMessages(activeChatId, [...newMessages, assistantMsg]);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        assistantMsg.content = "抱歉，出了點問題。請稍後再試。";
        setMessages([...newMessages, assistantMsg]);
        await saveMessages(activeChatId, [...newMessages, assistantMsg]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

  const activeProvider = providers.find(p => p.id === activeProviderId);
  const activeModelName = activeProvider?.models.find(m => m.id === activeModel)?.name || activeModel;

  // Assistant avatar component
  const AssistantAvatar = ({ size = "w-7 h-7" }: { size?: string }) => profile.assistantAvatar ? (
    <img src={profile.assistantAvatar.startsWith("/") ? `${API_BASE}${profile.assistantAvatar}` : profile.assistantAvatar} className={`${size} rounded-full shadow-sm object-cover`} alt="林語晴" />
  ) : (
    <div className={`${size} rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center text-xs shadow-sm`}>🐾</div>
  );

  const switchModel = async (providerId: string, modelId: string) => {
    setActiveProviderId(providerId);
    setActiveModel(modelId);
    setShowModelPicker(false);
    try {
      await fetch(`${API_BASE}/api/tclaw/providers`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: providerId, defaultModel: modelId }),
      });
    } catch {}
  };

  // ── Render ──
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: themeInfo.accentBg }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b shrink-0" style={{ borderColor: themeInfo.accentBorder + "30" }}>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowChatList(!showChatList)} className="text-xs px-2.5 py-1 rounded-md border transition-colors" style={{ borderColor: themeInfo.accentBorder, color: themeInfo.accentHover }}>
            💬 {chats.length} 則對話
          </button>
          {activeChatId && chats.find(c => c.id === activeChatId) && (
            <span className="text-xs text-stone-400 truncate max-w-[200px]">{chats.find(c => c.id === activeChatId)?.title}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Model picker */}
          <div className="relative">
            <button onClick={() => setShowModelPicker(!showModelPicker)} className="text-xs px-2.5 py-1 rounded-md border flex items-center gap-1 transition-colors" style={{ borderColor: themeInfo.accentBorder, color: themeInfo.accentHover }}>
              🤖 {activeModelName}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
            </button>
            {showModelPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
                <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden z-50">
                  {providers.map(p => (
                    <div key={p.id}>
                      <div className="px-3 py-1.5 bg-stone-50 border-b border-stone-100">
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{p.name}</span>
                      </div>
                      {p.models.map(m => (
                        <button
                          key={`${p.id}/${m.id}`}
                          onClick={() => switchModel(p.id, m.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-stone-50 transition-colors ${activeProviderId === p.id && activeModel === m.id ? "bg-stone-50 font-medium" : ""}`}
                        >
                          <span className="flex-1">{m.name}</span>
                          {activeProviderId === p.id && activeModel === m.id && <span style={{ color: themeInfo.accent }}>✓</span>}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={createNewChat} className="text-xs px-2.5 py-1 rounded-md text-white transition-colors" style={{ background: themeInfo.accent }}>＋ 新對話</button>
        </div>
      </div>

      {/* Chat list dropdown */}
      {showChatList && (
        <div className="border-b shrink-0 max-h-40 overflow-y-auto bg-white" style={{ scrollbarWidth: "thin", borderColor: themeInfo.accentBorder + "30" }}>
          {chats.length === 0 && <div className="px-4 py-3 text-center text-stone-400 text-xs">還沒有對話紀錄</div>}
          {chats.map((chat) => (
            <div key={chat.id} className={`group flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors text-sm ${chat.id === activeChatId ? "bg-stone-50 font-medium" : "hover:bg-stone-50"}`} onClick={() => selectChat(chat)}>
              <span className="flex-1 truncate text-stone-600">{chat.title}</span>
              <button onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }} className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-rose-500 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: "thin" }}>
        {!activeChatId ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <AssistantAvatar size="w-16 h-16" />
            <h2 className="text-lg font-bold text-stone-700 mb-1">嗨{profile.name ? ` ${profile.name}` : ""}！</h2>
            <p className="text-stone-400 text-sm mb-5">我是{profile.assistantName || "林語晴"}，你的個人助理</p>
            <button onClick={createNewChat} className="px-5 py-2 rounded-xl text-white font-medium text-sm shadow-lg transition-all" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
              開始新對話
            </button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`flex gap-2.5 max-w-[80%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className="flex-shrink-0 mt-1">
                    {msg.role === "assistant" ? (
                      <AssistantAvatar />
                    ) : (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm" style={{ background: themeInfo.accent }}>{profile.name?.charAt(0) || "?"}</div>
                    )}
                  </div>
                  <div>
                    <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === "user" ? "text-white rounded-tr-md" : "bg-white border border-stone-200 text-stone-700 rounded-tl-md shadow-sm"}`} style={msg.role === "user" ? { background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` } : {}}>
                      {msg.role === "assistant" ? (
                        <div className="prose prose-stone prose-sm max-w-none">
                          {msg.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown> : <span className="text-stone-300 animate-pulse">思考中...</span>}
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      )}
                    </div>
                    <div className={`text-[10px] text-stone-400 mt-0.5 ${msg.role === "user" ? "text-right" : ""}`}>{formatTime(msg.timestamp)}</div>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      {activeChatId && (
        <div className="px-4 py-3 border-t bg-white shrink-0" style={{ borderColor: themeInfo.accentBorder + "40" }}>
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="輸入訊息... (Enter 發送, Shift+Enter 換行)" rows={1} className="flex-1 px-3.5 py-2.5 rounded-xl border-2 border-stone-200 text-sm focus:outline-none resize-none transition-colors" style={{ maxHeight: 120 }} />
            {isLoading ? (
              <button onClick={handleStop} className="px-4 py-2.5 rounded-xl text-white font-medium text-sm transition-all flex-shrink-0 bg-rose-500 hover:bg-rose-600">停止</button>
            ) : (
              <button onClick={handleSend} disabled={!input.trim()} className="px-4 py-2.5 rounded-xl text-white font-medium text-sm transition-all disabled:opacity-40 flex-shrink-0" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>送出</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
