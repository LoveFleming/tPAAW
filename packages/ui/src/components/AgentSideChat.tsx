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
import { useI18n } from "../i18n";
import MarkdownText from "./MarkdownText"; // markdown 渲染（含 GFM table）

// fetch crew 大頭照（AI Crew 頁面同一張）；失敗 fallback emoji
function useCrewAvatar(agentId: string, enabled: boolean) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !agentId) return;
    let alive = true;
    fetch(`${API_BASE}/api/coding-crew/coding.${agentId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.imageUrl) setAvatarUrl(`${API_BASE}${d.imageUrl}`); })
      .catch(() => {});
    return () => { alive = false; };
  }, [agentId, enabled]);
  return avatarUrl;
}

export interface SideChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  images?: string[]; // 👁 uploads/ 相對路徑（agent chat 貼圖，2026-08-30）
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

export interface AgentSideChatHandle {
  send: (text: string) => void;   // 外部注入訊息（Handover QA → AI）
}

export default React.forwardRef<AgentSideChatHandle, AgentSideChatProps>(function AgentSideChat({
  agentId,
  agentName,
  agentEmoji = "🤖",
  greeting,
  cwd,
  suggestions = [],
  placeholder = "問我任何問題…",
  accent = "#8b5e3c",
  height = "100%",
}: AgentSideChatProps, ref) {
  const [messages, setMessages] = useState<SideChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null); // 聊天容器：用容器 scrollTo，不用 scrollIntoView（會拖祖先容器）
  const nearBottomRef = useRef(true);
  const composingRef = useRef(false); // IME 三層保護（可靠層）
  const avatarUrl = useCrewAvatar(agentId, true);
  const { t: tt } = useI18n();

  // 👁 agent chat 貼圖（2026-08-30）：paste/drop/picker → 壓縮 → 上傳 → a2a parts 喜vision model
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<{ id: string; dataUrl: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const compressImage = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1568;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => reject(new Error("image load fail"));
        img.src = String(reader.result);
      };
      reader.onerror = () => reject(new Error("file read fail"));
      reader.readAsDataURL(file);
    });
  }, []);
  const addImages = useCallback(async (files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    const room = 4 - pendingImages.length;
    if (room <= 0) { alert(tt("chat.imageLimit")); return; }
    const results: { id: string; dataUrl: string }[] = [];
    for (const f of imgs.slice(0, room)) {
      try { results.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, dataUrl: await compressImage(f) }); } catch {}
    }
    if (results.length > 0) setPendingImages(p => [...p, ...results].slice(0, 4));
  }, [compressImage, pendingImages.length, tt]);


  // 串流抖動修復：新訊息 smooth；同一訊息內容增長（串流 chunk）用 instant + 只在使用者在底部附近時
  // （smooth 動畫被頻繁 chunk 打斷重啟 → 畫面持續抖動）
  const prevMsgLenRef = useRef(messages.length);
  const prevContentLenRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNewMessage = messages.length !== prevMsgLenRef.current;
    const lastLen = messages.length ? (messages[messages.length - 1].content || "").length : 0;
    const contentGrew = lastLen > prevContentLenRef.current;
    prevMsgLenRef.current = messages.length;
    prevContentLenRef.current = lastLen;
    if (isNewMessage) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else if (contentGrew && loading && nearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    }
  }, [messages, loading]);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if ((!msg && pendingImages.length === 0) || loading) return;
    setInput("");

    // 👁 先上傳 pending 圖 → 換 path（失敗跳過）
    let uploadedPaths: string[] = [];
    if (pendingImages.length > 0) {
      const results = await Promise.all(pendingImages.map(async (img) => {
        try {
          const r = await fetch(`${API_BASE}/api/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: img.dataUrl }) });
          const j = await r.json();
          return j.ok ? j.path : null;
        } catch { return null; }
      }));
      uploadedPaths = results.filter(Boolean) as string[];
    }
    setPendingImages([]);
    const textPart = msg || (uploadedPaths.length > 0 ? "請看這張圖" : "");
    if (!textPart) return;

    const userMsg: SideChatMessage = { role: "user", content: textPart, ts: new Date().toISOString(), ...(uploadedPaths.length > 0 ? { images: uploadedPaths } : {}) };
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
            message: { role: "user", parts: [{ type: "text", text: textPart }, ...uploadedPaths.map(p => ({ type: "image", path: p }))] },
            context: { cwd },
            conversationHistory: [...messages, { role: "user", content: textPart }],
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
  }, [input, loading, messages, agentId, cwd, pendingImages]);

  // 外部注入訊息（Handover QA chips → AI；不改變內部訊息流）
  React.useImperativeHandle(ref, () => ({ send: (text: string) => { send(text); } }), [send]);

  return (
    <div className="flex flex-col border-l" style={{ borderColor: "#e7e5e4", height }}>
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0" style={{ borderColor: "#e7e5e4" }}>
        {avatarUrl ? (
          <img src={avatarUrl} className="w-6 h-6 rounded-full object-cover" alt="" />
        ) : (
          <span className="text-base">{agentEmoji}</span>
        )}
        <span className="text-xs font-bold text-stone-700">{agentName}</span>
        {loading && <span className="text-[10px] text-stone-400 animate-pulse ml-auto">{action || "處理中…"}</span>}
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={(e) => {
        const el = e.currentTarget;
        nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }} className="flex-1 overflow-y-auto px-3 py-3 space-y-3" style={{ scrollbarWidth: "thin" }}>
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center text-2xl mb-2 overflow-hidden" style={{ backgroundColor: accent + "15" }}>
              {avatarUrl ? <img src={avatarUrl} className="w-full h-full object-cover" alt="" /> : agentEmoji}
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
              <div className="text-[10px] text-stone-400 mb-0.5 flex items-center gap-1">
                {m.role === "assistant" && avatarUrl && <img src={avatarUrl} className="w-3.5 h-3.5 rounded-full object-cover" alt="" />}
                <span>{m.role === "user" ? "你" : agentName} · {fmtChatTime(m.ts)}</span>
              </div>
              {m.role === "assistant" ? (
                <MarkdownText>{m.content}</MarkdownText>
              ) : (
                <div>
                  {m.images && m.images.length > 0 && (
                    <div className="flex gap-1.5 mb-1 flex-wrap justify-end">
                      {m.images.map((p, j) => (
                        <img key={j} src={`${API_BASE}/api/${p}`} alt="" className="max-w-[140px] max-h-[140px] rounded-lg object-cover" />
                      ))}
                    </div>
                  )}
                  <div className="text-xs whitespace-pre-wrap leading-relaxed">{m.content}</div>
                </div>
              )}
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
      </div>

      {/* Input — IME 三層保護：composingRef → isComposing → keyCode 229 */}
      <div className="border-t p-2 shrink-0" style={{ borderColor: "#e7e5e4" }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addImages(Array.from(e.dataTransfer.files)); }}>
        {/* 👁 待送圖預覽 */}
        {pendingImages.length > 0 && (
          <div className="flex gap-1.5 mb-1.5 flex-wrap">
            {pendingImages.map(img => (
              <div key={img.id} className="relative group">
                <img src={img.dataUrl} alt="" className="w-14 h-14 object-cover rounded-lg border border-stone-200" />
                <button onClick={() => setPendingImages(p => p.filter(x => x.id !== img.id))} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-stone-700 text-white text-[9px] flex items-center justify-center opacity-80 hover:opacity-100">✕</button>
              </div>
            ))}
          </div>
        )}
        {dragOver && <div className="mb-1.5 text-[10px] px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">{tt("chat.imageDropHere")}</div>}
        <div className="flex gap-1.5 items-end">
          {/* 👁 📞 貼圖鈕 */}
          <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addImages(Array.from(e.target.files || [])); e.target.value = ""; }} />
          <button onClick={() => imageInputRef.current?.click()} disabled={pendingImages.length >= 4} title={tt("chat.attachImage")}
            className="text-xs px-2 py-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:border-stone-300 disabled:opacity-40 shrink-0 bg-stone-50">📎</button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onPaste={(e) => { const files = Array.from(e.clipboardData?.files || []); if (files.length > 0) { e.preventDefault(); addImages(files); } }}
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
            <button onClick={() => send()} disabled={!input.trim() && pendingImages.length === 0}
              className="text-xs px-3 py-2 rounded-lg text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: accent }}>
              送出
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
