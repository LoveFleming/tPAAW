import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "../theme";

import API_BASE from "../api";

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
  onTitleChange?: (title: string) => void;
  onDeepLink?: (path: string, params: Record<string, string>) => void;
  seedMessage?: string | null;
  onSeedConsumed?: () => void;
}

export default function ChatView({ profile, embedded = false, onTitleChange, onDeepLink, seedMessage, onSeedConsumed }: Props) {
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
    fetch(`${API_BASE}/api/paaw/providers`)
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

  // ── Load chats (with messages) ──
  const loadChats = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/paaw/chats`);
      if (resp.ok) {
        const data = await resp.json();
        setChats(data);
        // Only update messages from server when NOT streaming/loading
        // This prevents scroll jumps from polling
        if (activeChatId && !isLoading) {
          const current = data.find((c: Chat) => c.id === activeChatId);
          if (current?.messages) {
            // Only set if message count changed (new message from elsewhere)
            setMessages(prev => {
              if (current.messages.length !== prev.length) {
                return current.messages;
              }
              return prev;
            });
          }
        }
      }
    } catch {}
  }, [activeChatId, isLoading]);

  useEffect(() => { loadChats(); }, []);

  // Auto-select most recent chat on first load
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current || chats.length === 0) return;
    if (!activeChatId && chats.length > 0) {
      initialLoadDone.current = true;
      const latest = chats[0]; // chats are sorted newest first
      setActiveChatId(latest.id);
      setMessages(latest.messages || []);
      // Scroll to bottom after initial load
      setTimeout(() => scrollToBottom(false), 50);
    }
  }, [chats]);

  // Notify parent of current chat title
  useEffect(() => {
    if (onTitleChange && activeChatId) {
      const chat = chats.find(c => c.id === activeChatId);
      onTitleChange(chat?.title || "新對話");
    } else if (onTitleChange && !activeChatId) {
      onTitleChange("新對話");
    }
  }, [activeChatId, chats, onTitleChange]);

  // Poll for updates every 5s
  useEffect(() => {
    const interval = setInterval(loadChats, 5000);
    return () => clearInterval(interval);
  }, [loadChats]);

  // Auto-scroll: only when user sends/receives, not on polling
  const isNearBottomRef = useRef(true);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Track whether user is near bottom
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll to bottom — only when explicitly requested (send/receive)
  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
    });
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  // ── Seed message from outside (e.g. AI 摘要 from file tree) ──
  // Listen for both prop-based and event-based seed messages
  const sendingSeedRef = useRef(false);
  const [localSeed, setLocalSeed] = useState<string | null>(null);

  // Prop-based seed
  useEffect(() => {
    if (seedMessage) {
      setLocalSeed(seedMessage);
      onSeedConsumed?.();
    }
  }, [seedMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Event-based seed (from window event, works across re-mounts)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) setLocalSeed(detail.message);
    };
    window.addEventListener("paaw-seed-chat", handler as EventListener);
    return () => window.removeEventListener("paaw-seed-chat", handler as EventListener);
  }, []);

  // Process seed
  useEffect(() => {
    if (!localSeed || sendingSeedRef.current || isLoading) return;
    const text = localSeed.trim();
    if (!text) return;

    setLocalSeed(null);
    sendingSeedRef.current = true;

    const timer = setTimeout(async () => {
      let chatId = activeChatId;
      let baseMsgs = messages;

      if (!chatId) {
        const newId = `chat_${Date.now()}`;
        const greeting: Message = {
          role: "assistant",
          content: `嗨${profile.name ? ` ${profile.name}` : ""}！我是${assistantName}，有什麼可以幫你的嗎？ 🌤️`,
          timestamp: new Date().toISOString(),
        };
        const newChat = { id: newId, title: "新對話", messages: [greeting], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        try {
          await fetch(`${API_BASE}/api/paaw/chats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newChat) });
        } catch {}
        setChats(prev => [newChat, ...prev]);
        setActiveChatId(newId);
        chatId = newId;
        baseMsgs = [greeting];
        setMessages([greeting]);
      }

      const userMsg: Message = { role: "user", content: text, timestamp: new Date().toISOString() };
      const newMsgs = [...baseMsgs, userMsg];
      setMessages(newMsgs);
      setIsLoading(true);
      scrollToBottom(false);

      const withAssistant = [...newMsgs, { role: "assistant" as const, content: "", timestamp: new Date().toISOString() }];
      setMessages(withAssistant);

      try {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const resp = await fetch(`${API_BASE}/api/paaw/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            chatId,
            history: newMsgs.map(m => ({ role: m.role, content: m.content })),
          }),
          signal: ctrl.signal,
        });
        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setMessages(prev => {
            const u = [...prev];
            u[u.length - 1] = { ...u[u.length - 1], content: full };
            return u;
          });
        }
        try {
          const finalMsgs = [...newMsgs, { role: "assistant", content: full, timestamp: new Date().toISOString() }];
          await fetch(`${API_BASE}/api/paaw/chats/${chatId}`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: finalMsgs, title: text.slice(0, 30) }),
          });
          setChats(prev => prev.map((c: any) => c.id === chatId ? { ...c, messages: finalMsgs, title: text.slice(0, 30) } : c));
        } catch {}
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: "⚠️ " + (err.message || "發送失敗") }; return u; });
        }
      } finally {
        setIsLoading(false);
        sendingSeedRef.current = false;
        scrollToBottom(true);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [localSeed, activeChatId, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

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
      await fetch(`${API_BASE}/api/paaw/chats`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newChat),
      });
    } catch {}
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(chatId);
    setMessages([greeting]);
    setShowChatList(false);
  };

  const deleteChat = async (chatId: string) => {
    try { await fetch(`${API_BASE}/api/paaw/chats/${chatId}`, { method: "DELETE" }); } catch {}
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (activeChatId === chatId) {
      const remaining = chats.filter(c => c.id !== chatId);
      setActiveChatId(remaining.length > 0 ? remaining[0].id : null);
      setMessages(remaining.length > 0 ? (remaining[0].messages || []) : []);
    }
  };

  const selectChat = (chat: Chat) => {
    setActiveChatId(chat.id);
    setMessages(chat.messages || []);
    setShowChatList(false);
    setTimeout(() => scrollToBottom(false), 50);
  };

  const saveMessages = async (chatId: string, msgs: Message[]) => {
    const firstUserMsg = msgs.find(m => m.role === "user");
    const title = firstUserMsg ? firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? "..." : "") : "新對話";
    try {
      await fetch(`${API_BASE}/api/paaw/chats/${chatId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, title }),
      });
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, title, messages: msgs } : c));
    } catch {}
  };

  // ── Send message (SSE streaming) ──
  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || !activeChatId || isLoading) return;

    const userMsg: Message = { role: "user", content: text, timestamp: new Date().toISOString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    scrollToBottom(false);

    const assistantMsg: Message = { role: "assistant", content: "", timestamp: new Date().toISOString() };
    const withAssistant = [...newMessages, assistantMsg];
    setMessages(withAssistant);

    let stallCheck: ReturnType<typeof setTimeout> | null = null;

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const resp = await fetch(`${API_BASE}/api/paaw/chat`, {
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
      let sseChunkCount = 0;
      const sseStart = Date.now();
      console.log(`[Chat SSE] Stream started`);

      // 10 秒沒收到任何 data → 印警告
      stallCheck = setTimeout(() => {
        if (sseChunkCount === 0) {
          console.warn(`[Chat SSE] ⚠️ 10秒沒收到任何 SSE data！Server 可能 buffer 住了`);
        }
      }, 10000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[Chat SSE] Stream done. chunks=${sseChunkCount} elapsed=${Date.now() - sseStart}ms contentLen=${fullContent.length}`);
          break;
        }
        sseChunkCount++;
        if (sseChunkCount <= 5 || sseChunkCount % 20 === 0) {
          console.log(`[Chat SSE] chunk #${sseChunkCount} ${Date.now() - sseStart}ms bytes=${value?.length}`);
        }

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
            // Debug: 印每個 SSE event 的 key，抓格式問題
            if (sseChunkCount <= 10) console.log(`[Chat SSE] event keys:`, Object.keys(parsed), JSON.stringify(parsed).slice(0, 150));
            if (parsed.error) {
              fullContent += `\n❌ ${parsed.message}`;
            } else if (parsed.content) {
              fullContent += parsed.content;
            } else if (parsed.tool_call) {
              // Show executing status — will be cleared when AI responds
              const tc = parsed.tool_call;
              const label = tc.name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
              const labelShort = label.replace(/ App/g, "");
              fullContent += `⏳ ${labelShort} 執行中...`;
              console.log(`[Chat SSE] tool_call: ${tc.name} ${Date.now() - sseStart}ms`);
            } else if (parsed.tool_result) {
              const tr = parsed.tool_result;
              // Remove the "⏳ 執行中..." status line
              fullContent = fullContent.replace(/\n?⏳ [^\n]*執行中\.\.\./g, "");
              if (tr.result?.error) {
                fullContent += `\n❌ ${tr.result.text}\n`;
              } else if (tr.result?.text) {
                fullContent += `\n${tr.result.text}\n`;
              } else {
                const label = (tr.name || "tool").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                fullContent += `\n✅ ${label} 完成\n`;
              }
              console.log(`[Chat SSE] tool_result: ${tr.name} error=${!!tr.result?.error} ${Date.now() - sseStart}ms`);
            }
          } catch {}
        }

        assistantMsg.content = fullContent;
        setMessages([...newMessages, { ...assistantMsg }]);
        if (isNearBottomRef.current) scrollToBottom(true);
      }

      assistantMsg.content = fullContent;
      setMessages([...newMessages, { ...assistantMsg }]);
      scrollToBottom(true);
      await saveMessages(activeChatId, [...newMessages, assistantMsg]);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        assistantMsg.content = "抱歉，出了點問題。請稍後再試。";
        setMessages([...newMessages, assistantMsg]);
        await saveMessages(activeChatId, [...newMessages, assistantMsg]);
      }
    } finally {
      clearTimeout(stallCheck);
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
      await fetch(`${API_BASE}/api/paaw/providers`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: providerId, defaultModel: modelId }),
      });
    } catch {}
  };

  // ── Render ──
  return (
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: themeInfo.accentBg }}>

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
      <div ref={el => { chatAreaRef.current = el; chatContainerRef.current = el; }} className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
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
          <div className="w-full px-4 py-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className="flex justify-start">
                <div className="flex gap-2.5 max-w-[95%]">
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
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-stone-600">{msg.role === "assistant" ? assistantName : profile.name || "你"}</span>
                      <span className="text-[10px] text-stone-300">{formatTime(msg.timestamp)}</span>
                    </div>
                    <div className={`px-4 py-3 text-sm leading-relaxed rounded-2xl ${msg.role === "assistant" ? "bg-white shadow-sm border border-stone-100 text-stone-700" : "bg-stone-50 text-stone-700"}`}>
                      {msg.role === "assistant" ? (
                        <div className="prose prose-stone prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
                          {msg.content ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node, href, ...props }) => {
                              // 攔截筆記 deep link: #/notes?note=xxx&notebook=yyy
                              if (href && href.startsWith("#/notes")) {
                                try {
                                  const u = new URL("http://dummy" + href.slice(1)); // /notes?note=xxx
                                  const params: Record<string, string> = {};
                                  u.searchParams.forEach((v, k) => { params[k] = v; });
                                  return <a {...props} href={href} onClick={(e) => { e.preventDefault(); onDeepLink?.("notes", params); }} style={{ color: "inherit", textDecoration: "underline", cursor: "pointer" }} />;
                                } catch { /* fallback */ }
                              }
                              return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
                            } }}>{msg.content}</ReactMarkdown> : (
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
          <div className="flex gap-2 items-end">
            <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={`跟${assistantName}說點什麼...`}
              rows={1}
              className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-stone-400 resize-none transition-colors bg-stone-50" style={{ maxHeight: 120 }} />
            {isLoading ? (
              <button onClick={handleStop} className="px-4 py-2.5 rounded-xl text-white font-medium text-sm bg-rose-500 hover:bg-rose-600 flex-shrink-0 transition-colors">停止</button>
            ) : (
              <button onClick={() => handleSend()} disabled={!input.trim()} className="px-4 py-2.5 rounded-xl text-white font-medium text-sm disabled:opacity-40 flex-shrink-0 transition-all" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" /></svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
