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
}

interface Props {
  profile: UserProfile;
  /** When embedded, ChatView is a plain content area (no sidebar/header) */
  embedded?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export default function ChatView({ profile, embedded = false, sidebarOpen: _extSidebarOpen, onToggleSidebar: _extToggleSidebar }: Props) {
  const { info: themeInfo } = useTheme();
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showChatList, setShowChatList] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadChats = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/tclaw/chats`);
      if (resp.ok) {
        const data = await resp.json();
        setChats(data);
      }
    } catch {}
  }, []);

  useEffect(() => { loadChats(); }, []);

  useEffect(() => {
    if (!activeChatId) return;
    const chat = chats.find(c => c.id === activeChatId);
    if (chat) {
      setMessages(chat.messages);
    } else {
      fetch(`${API_BASE}/api/tclaw/chats/${activeChatId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setMessages(data.messages || []); })
        .catch(() => {});
    }
  }, [activeChatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  const createNewChat = async () => {
    const chatId = `chat_${Date.now()}`;
    const greeting: Message = {
      role: "assistant",
      content: `嗨${profile.name ? ` ${profile.name}` : ""}！👋 我是林語晴，有什麼可以幫你的嗎？`,
      timestamp: new Date().toISOString(),
    };
    const newChat = {
      id: chatId,
      title: "新對話",
      messages: [greeting],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetch(`${API_BASE}/api/tclaw/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newChat),
      });
    } catch {}
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(chatId);
    setMessages([greeting]);
  };

  const deleteChat = async (chatId: string) => {
    try {
      await fetch(`${API_BASE}/api/tclaw/chats/${chatId}`, { method: "DELETE" });
    } catch {}
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
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, title }),
      });
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, title, messages: msgs } : c));
    } catch {}
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeChatId || isLoading) return;

    const userMsg: Message = { role: "user", content: text, timestamp: new Date().toISOString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      await new Promise(r => setTimeout(r, 800));
      const assistantMsg: Message = {
        role: "assistant",
        content: `[Demo] 收到你的訊息了！\n\n> ${text}\n\n目前是 demo 模式，正式 AI 串接開發中。`,
        timestamp: new Date().toISOString(),
      };
      const withReply = [...newMessages, assistantMsg];
      setMessages(withReply);
      await saveMessages(activeChatId, withReply);
    } catch {
      const errorMsg: Message = {
        role: "assistant",
        content: "抱歉，出了點問題。請稍後再試。",
        timestamp: new Date().toISOString(),
      };
      const withError = [...newMessages, errorMsg];
      setMessages(withError);
      await saveMessages(activeChatId, withError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  };

  // ── Embedded mode: full content area, no sidebar/header ──
  if (embedded) {
    return (
      <div className="h-full flex flex-col" style={{ backgroundColor: themeInfo.accentBg }}>
        {/* Chat list toggle bar */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b shrink-0" style={{ borderColor: themeInfo.accentBorder + "30" }}>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChatList(!showChatList)}
              className="text-xs px-2.5 py-1 rounded-md border transition-colors"
              style={{ borderColor: themeInfo.accentBorder, color: themeInfo.accentHover }}
            >
              💬 {chats.length} 則對話
            </button>
            {activeChatId && chats.find(c => c.id === activeChatId) && (
              <span className="text-xs text-stone-400 truncate max-w-[200px]">
                {chats.find(c => c.id === activeChatId)?.title}
              </span>
            )}
          </div>
          <button
            onClick={createNewChat}
            className="text-xs px-2.5 py-1 rounded-md text-white transition-colors"
            style={{ background: themeInfo.accent }}
          >
            ＋ 新對話
          </button>
        </div>

        {/* Chat list dropdown */}
        {showChatList && (
          <div className="border-b shrink-0 max-h-40 overflow-y-auto bg-white" style={{ scrollbarWidth: "thin", borderColor: themeInfo.accentBorder + "30" }}>
            {chats.length === 0 && (
              <div className="px-4 py-3 text-center text-stone-400 text-xs">還沒有對話紀錄</div>
            )}
            {chats.map((chat) => (
              <div
                key={chat.id}
                className={`group flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors text-sm ${
                  chat.id === activeChatId ? "bg-stone-50 font-medium" : "hover:bg-stone-50"
                }`}
                onClick={() => selectChat(chat)}
              >
                <span className="flex-1 truncate text-stone-600">{chat.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                  className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-rose-500 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: "thin" }}>
          {!activeChatId ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center text-3xl shadow-lg shadow-orange-300/20 mb-5">
                🐾
              </div>
              <h2 className="text-lg font-bold text-stone-700 mb-1">嗨{profile.name ? ` ${profile.name}` : ""}！</h2>
              <p className="text-stone-400 text-sm mb-5">我是林語晴，你的個人助理</p>
              <button
                onClick={createNewChat}
                className="px-5 py-2 rounded-xl text-white font-medium text-sm shadow-lg transition-all"
                style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
              >
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
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center text-xs shadow-sm">🐾</div>
                      ) : (
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm" style={{ background: themeInfo.accent }}>
                          {profile.name?.charAt(0) || "?"}
                        </div>
                      )}
                    </div>
                    <div>
                      <div
                        className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "text-white rounded-tr-md"
                            : "bg-white border border-stone-200 text-stone-700 rounded-tl-md shadow-sm"
                        }`}
                        style={msg.role === "user" ? { background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` } : {}}
                      >
                        {msg.role === "assistant" ? (
                          <div className="prose prose-stone prose-sm max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        )}
                      </div>
                      <div className={`text-[10px] text-stone-400 mt-0.5 ${msg.role === "user" ? "text-right" : ""}`}>
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center text-xs">🐾</div>
                    <div className="px-3.5 py-2.5 bg-white rounded-2xl rounded-tl-md border border-stone-200 shadow-sm">
                      <div className="flex gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-stone-300 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-stone-300 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-stone-300 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        {activeChatId && (
          <div className="px-4 py-3 border-t bg-white shrink-0" style={{ borderColor: themeInfo.accentBorder + "40" }}>
            <div className="max-w-3xl mx-auto flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="輸入訊息... (Enter 發送, Shift+Enter 換行)"
                rows={1}
                className="flex-1 px-3.5 py-2.5 rounded-xl border-2 border-stone-200 text-sm focus:outline-none resize-none transition-colors"
                style={{ maxHeight: 120 }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="px-4 py-2.5 rounded-xl text-white font-medium text-sm transition-all disabled:opacity-40 flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
              >
                送出
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Standalone mode (not used in tClaw currently, kept for future) ──
  return (
    <div className="h-screen flex text-stone-800 font-sans overflow-hidden">
      <p className="p-8 text-stone-400">Standalone chat mode</p>
    </div>
  );
}
