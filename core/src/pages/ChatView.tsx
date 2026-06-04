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
  assistantName?: string;
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
  const assistantName = profile.assistantName || "林語晴";

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
  const chatAreaRef = useRef<HTMLDivElement>(null);

  // ── Assistant avatar ──
  const avatarSrc = profile.assistantAvatar
    ? (profile.assistantAvatar.startsWith("/") ? `${API_BASE}${profile.assistantAvatar}` : profile.assistantAvatar)
    : "/avatars/assistant-default.png";

  const AssistantAvatar = ({ size = "w-8 h-8" }: { size?: string }) => (
    <img src={avatarSrc} className={`${size} rounded-full object-cover ring-2 ring-white shadow-md`} alt={assistantName}
      onError={(e) => { const el = e.currentTarget; el.style.display = "none"; }} />
  );

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
      content: `嗨${profile.name ? ` ${profile.name}` : ""}！我是${assistantName}，有什麼可以幫你的嗎？ 🌤️`,
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
            if (parsed.error) {
              fullContent += `\n❌ ${parsed.message}`;
            } else if (parsed.content) {
              fullContent += parsed.content;
            } else if (parsed.tool_call) {
              const tc = parsed.tool_call;
              const icons: Record<string, string> = { todo_add: "📝", todo_list: "📋", todo_update: "✏️", todo_delete: "🗑️", note_create: "📝", note_list: "📓", note_read: "📖", note_delete: "🗑️", file_read: "📄", file_list: "📁", memory_add: "🧠", memory_list: "💭", web_search: "🔍", app_create: "🧪", app_list: "📦" };
              const icon = icons[tc.name] || "🔧";
              const label = tc.name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
              fullContent += `\n\n> ${icon} **${label}** ...\n`;
            } else if (parsed.tool_result) {
              const tr = parsed.tool_result;
              if (tr.result?.text) {
                fullContent += `> ${tr.result.text.split("\n").join("\n> ")}\n\n`;
              }
            }
          } catch {}
        }

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

  const handleStop = () => { abortRef.current?.abort(); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); handleSend(); }
  };

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

  const activeProvider = providers.find(p => p.id === activeProviderId);
  const activeModelName = activeProvider?.models.find(m => m.id === activeModel)?.name || activeModel;

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

      {/* ── Header: 林語晴照片 + 名字 + 控制列 ── */}
      <div className="shrink-0 border-b" style={{ borderColor: themeInfo.accentBorder + "30", background: "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%)" }}>
        {/* Profile bar */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="relative">
            <AssistantAvatar size="w-10 h-10" />
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-stone-800 leading-tight">{assistantName}</h2>
            <p className="text-[11px] text-stone-400">你的個人助理 · 在線</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowChatList(!showChatList)} className="text-[11px] px-2 py-1 rounded-lg border transition-colors hover:bg-stone-50" style={{ borderColor: themeInfo.accentBorder, color: themeInfo.accentHover }}>
              💬
            </button>
            <div className="relative">
              <button onClick={() => setShowModelPicker(!showModelPicker)} className="text-[11px] px-2 py-1 rounded-lg border transition-colors hover:bg-stone-50 flex items-center gap-1" style={{ borderColor: themeInfo.accentBorder, color: themeInfo.accentHover }}>
                🤖 {activeModelName}
              </button>
              {showModelPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden z-50">
                    {providers.map(p => (
                      <div key={p.id}>
                        <div className="px-3 py-1.5 bg-stone-50 border-b border-stone-100">
                          <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{p.name}</span>
                        </div>
                        {p.models.map(m => (
                          <button key={`${p.id}/${m.id}`} onClick={() => switchModel(p.id, m.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-stone-50 transition-colors ${activeProviderId === p.id && activeModel === m.id ? "bg-stone-50 font-medium" : ""}`}>
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
            <button onClick={createNewChat} className="text-[11px] px-2 py-1 rounded-lg text-white font-medium transition-colors" style={{ background: themeInfo.accent }}>＋</button>
          </div>
        </div>

        {/* Chat list dropdown */}
        {showChatList && (
          <div className="border-t max-h-36 overflow-y-auto bg-white" style={{ scrollbarWidth: "thin", borderColor: themeInfo.accentBorder + "20" }}>
            {chats.length === 0 && <div className="px-4 py-3 text-center text-stone-400 text-xs">還沒有對話紀錄</div>}
            {chats.map((chat) => (
              <div key={chat.id} className={`group flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors text-sm ${chat.id === activeChatId ? "bg-stone-50 font-medium" : "hover:bg-stone-50"}`} onClick={() => selectChat(chat)}>
                <span className="text-stone-400 text-xs">💬</span>
                <span className="flex-1 truncate text-stone-600">{chat.title}</span>
                <span className="text-[10px] text-stone-300">{formatTime(chat.updatedAt)}</span>
                <button onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }} className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-rose-500 transition-all">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Messages area ── */}
      <div ref={chatAreaRef} className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {!activeChatId ? (
          /* ── Empty state: welcome card ── */
          <div className="flex flex-col items-center justify-center h-full px-4">
            <div className="text-center max-w-sm">
              <div className="mx-auto mb-6">
                <img src={avatarSrc} className="w-24 h-24 rounded-full object-cover ring-4 ring-amber-100 shadow-lg shadow-amber-200/30 mx-auto" alt={assistantName}
                  onError={(e) => { const el = e.currentTarget; el.style.display = "none"; }} />
              </div>
              <h2 className="text-xl font-bold text-stone-800 mb-1">{assistantName}</h2>
              <p className="text-stone-400 text-sm mb-6">你的個人 AI 助理</p>
              <div className="space-y-2 mb-8">
                {[
                  { icon: "📋", text: "幫我加一個待辦事項" },
                  { icon: "📝", text: "記一下今天的重點" },
                  { icon: "🧠", text: "記住我喜歡 dark mode" },
                ].map((hint, i) => (
                  <button key={i} onClick={createNewChat} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-stone-200 text-sm text-stone-600 hover:border-stone-300 hover:shadow-sm transition-all text-left">
                    <span>{hint.icon}</span>
                    <span>{hint.text}</span>
                  </button>
                ))}
              </div>
              <button onClick={createNewChat} className="px-6 py-2.5 rounded-xl text-white font-medium shadow-lg hover:shadow-xl transition-all" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
                開始對話 →
              </button>
            </div>
          </div>
        ) : (
          /* ── Chat messages ── */
          <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`flex gap-2.5 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  {/* Avatar */}
                  <div className="flex-shrink-0 mt-1">
                    {msg.role === "assistant" ? (
                      <AssistantAvatar size="w-8 h-8" />
                    ) : (
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
                        {"你"}
                      </div>
                    )}
                  </div>
                  {/* Bubble */}
                  <div>
                    <div className={`px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "text-white rounded-2xl rounded-tr-sm" : "bg-white rounded-2xl rounded-tl-sm shadow-sm border border-stone-100 text-stone-700"}`}
                      style={msg.role === "user" ? { background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` } : {}}>
                      {msg.role === "assistant" ? (
                        <div className="prose prose-stone prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
                          {msg.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown> : (
                            <div className="flex items-center gap-1.5 text-stone-300">
                              <div className="flex gap-1">
                                <span className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                <span className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                              </div>
                              <span className="text-xs">思考中</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      )}
                    </div>
                    <div className={`text-[10px] text-stone-300 mt-0.5 px-1 ${msg.role === "user" ? "text-right" : ""}`}>{formatTime(msg.timestamp)}</div>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input bar ── */}
      {activeChatId && (
        <div className="shrink-0 px-4 py-3 border-t bg-white/80 backdrop-blur-sm" style={{ borderColor: themeInfo.accentBorder + "30" }}>
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={`跟${assistantName}說點什麼...`}
              rows={1}
              className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-stone-400 resize-none transition-colors bg-stone-50" style={{ maxHeight: 120 }} />
            {isLoading ? (
              <button onClick={handleStop} className="px-4 py-2.5 rounded-xl text-white font-medium text-sm bg-rose-500 hover:bg-rose-600 flex-shrink-0 transition-colors">停止</button>
            ) : (
              <button onClick={handleSend} disabled={!input.trim()} className="px-4 py-2.5 rounded-xl text-white font-medium text-sm disabled:opacity-40 flex-shrink-0 transition-all" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" /></svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
