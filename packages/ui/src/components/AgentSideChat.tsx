/**
 * AgentSideChat — 側欄 AI 助理對話（共用元件）
 *
 * Release Manager / Handover / Troubleshooting 三個頁面共用。
 * 打 /a2a/:agentId 的 message/stream（與 EM Dashboard chat 同協議）。
 *
 * 注意：textarea 有 IME composition 三層保護（TOOLS.md 紀律）。
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { pasteMayContainImage, extractPasteFiles } from "../utils/pasteFiles";
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
  files?: { name: string; size: number }[]; // 📄 文字檔附件（2026-09-14）
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
  accentHover?: string;     // theme accent hover color（「你」頭像漸層第二色，沒帶就用 accent）
  height?: string;          // e.g. "100%" — container height
  persistCrewId?: string;   // 2026-09-17 Fleming：有帶 → 對話持久化到 .paaw/coding-memory/conversations/<id>/，
                             //   並顯示三按鈕（📋 歷史 / 🧠 注入 prompt / 💬 新對話），跟 crew chat 同一套 API
}

export interface AgentSideChatHandle {
  send: (text: string) => void;   // 外部注入訊息（Handover QA → AI）
  addFiles: (files: File[]) => void; // 外部注入附件（📸 拍目前畫面 → 直接入 attachment area，2026-09-26）
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
  accentHover,
  height = "100%",
  persistCrewId,
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
  const youGrad = `linear-gradient(135deg, ${accent}, ${accentHover || accent})`; // 「你」頭像漸層（跟 ChatView 同形式）
  const { t: tt } = useI18n();

  // ══ 2026-09-17 Fleming：Browser QA side chat 對話持久化 + 三按鈕（跟 crew chat 同一套）══
  // 📋 歷史對話 / 🧠 查看注入 prompt / 💬 新對話 — persistCrewId 有帶才启用
  const [sessions, setSessions] = useState<{ sessionId: string; title: string; messageCount: number; lastUpdated: string | null; isActive: boolean }[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [viewingArchive, setViewingArchive] = useState<string | null>(null); // 正在看的歷史 session（null=目前對話）
  const [promptData, setPromptData] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const messagesRef = useRef<SideChatMessage[]>([]); // mount 載入號局保護（本地已有訊息就不破壞）
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // 載入 active 對話（mount / cwd 變 → 讀指定 RU 的 .paaw/coding-memory；切 tab 不再清空）
  useEffect(() => {
    if (!persistCrewId || !cwd) return;
    let alive = true;
    fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(persistCrewId)}?cwd=${encodeURIComponent(cwd)}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        // 只在本地還空時套用 server 狀態（避免覆寫剛送出的訊息）
        if (messagesRef.current.length === 0 && Array.isArray(d.messages) && d.messages.length > 0) {
          setMessages(d.messages.map((m: any) => ({
            role: m.role === "assistant" ? "assistant" as const : "user" as const,
            content: String(m.content ?? ""),
            ts: m.ts || new Date().toISOString(),
            ...(Array.isArray(m.images) ? { images: m.images } : {}),
            ...(Array.isArray(m.files) ? { files: m.files } : {}),
          })));
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [persistCrewId, cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  // 存檔（debounce 2s — 跟 crew chat 同節奏；有真實 user 訊息才存）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!persistCrewId || !cwd) return;
    if (!messages.some(m => m.role === "user")) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(persistCrewId)}?cwd=${encodeURIComponent(cwd)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });
      } catch { /* best effort */ }
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [messages, persistCrewId, cwd]);

  // 📋 歷史：拉 session 清單（active + 歸檔 s-*）
  const loadSessions = useCallback(async () => {
    if (!persistCrewId || !cwd) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(persistCrewId)}/sessions?cwd=${encodeURIComponent(cwd)}`);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch { setSessions([]); }
  }, [persistCrewId, cwd]);

  // 載入指定 session（"active" = 回目前對話）
  const openSession = useCallback(async (sessionId: string) => {
    if (!persistCrewId || !cwd) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(persistCrewId)}/sessions/${encodeURIComponent(sessionId)}?cwd=${encodeURIComponent(cwd)}`);
      const data = await res.json();
      setMessages((data.messages || []).map((m: any) => ({
        role: m.role === "assistant" ? "assistant" as const : "user" as const,
        content: String(m.content ?? ""),
        ts: m.ts || new Date().toISOString(),
        ...(Array.isArray(m.images) ? { images: m.images } : {}),
        ...(Array.isArray(m.files) ? { files: m.files } : {}),
      })));
      setViewingArchive(sessionId === "active" ? null : sessionId);
    } catch { /* best effort */ }
    setShowSessions(false);
  }, [persistCrewId, cwd]);

  // 💬 新對話：歸檔 active + 清空（跟 crew chat 的 startNewConversation 同 API）
  const startNewChat = useCallback(async () => {
    if (messages.length === 0) return;
    if (persistCrewId && cwd) {
      try { await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(persistCrewId)}/new-session?cwd=${encodeURIComponent(cwd)}`, { method: "POST" }); } catch {}
    }
    setMessages([]);
    setViewingArchive(null);
    setShowSessions(false);
  }, [messages, persistCrewId, cwd]);

  // 🧠 查看注入 prompt（/a2a/:agentId/system-prompt — 同 crew chat 的 Context debug）
  const viewPrompt = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/a2a/${encodeURIComponent(agentId)}/system-prompt${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`);
      setPromptData(await res.json());
    } catch (e: any) {
      setPromptData({ error: e?.message || "fetch failed" });
    }
    setShowPrompt(true);
  }, [agentId, cwd]);

  // 👁 agent chat 貼圖（2026-08-30）：paste/drop/picker → 壓縮 → 上傳 → a2a parts 喜vision model
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<{ id: string; dataUrl: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // 📄 文字檔附件（2026-09-14）：picker/drop/paste → 讀文字 → 上傳 → read_file / inline
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<{ id: string; name: string; size: number; text: string }[]>([]);
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const readAsText = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ""));
      r.onerror = () => reject(new Error("read fail"));
      r.readAsText(file, "utf-8");
    });
  }, []);
  const addTextFiles = useCallback(async (files: File[]) => {
    const texts = files.filter(f => !f.type.startsWith("image/"));
    if (texts.length === 0) return;
    const room = 4 - pendingFiles.length;
    if (room <= 0) { alert(tt("chat.fileLimit")); return; }
    const results: { id: string; name: string; size: number; text: string }[] = [];
    for (const f of texts.slice(0, room)) {
      if (f.size > MAX_FILE_BYTES) { alert(`${f.name}: ${tt("chat.fileTooLarge")}`); continue; }
      try {
        const text = await readAsText(f);
        if (text.includes("\u0000")) { alert(`${f.name}: ${tt("chat.fileBinary")}`); continue; }
        results.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: f.name, size: f.size, text });
      } catch { alert(`${f.name}: ${tt("chat.fileReadFail")}`); }
    }
    if (results.length > 0) setPendingFiles(p => [...p, ...results].slice(0, 4));
  }, [pendingFiles.length, readAsText, tt]);
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
    if ((!msg && pendingImages.length === 0 && pendingFiles.length === 0) || loading) return;
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

    // 📄 上傳 pending 文字檔 → path（失敗 fallback：小檔直接 inline，大檔提示失敗）
    const INLINE_LIMIT = 8000;
    let textPart = msg;
    const fileMeta: { name: string; size: number }[] = [];
    if (pendingFiles.length > 0) {
      const files = pendingFiles;
      setPendingFiles([]);
      for (const f of files) {
        fileMeta.push({ name: f.name, size: f.size });
        let uploaded: { abs?: string; rel?: string } | null = null;
        try {
          const r = await fetch(`${API_BASE}/api/uploads/text`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: f.text, filename: f.name, ruRoot: cwd }),
          });
          const j = await r.json();
          if (j.ok) uploaded = { abs: j.abs, rel: j.rel };
        } catch { /* fallback inline */ }
        const ref = uploaded?.rel || uploaded?.abs;
        if (f.text.length <= INLINE_LIMIT) {
          const pathNote = ref ? `\npath: ${ref}（已存檔，可用 read_file 讀取）` : "";
          textPart += `\n\n[User uploaded file: ${f.name}]${pathNote}\n\`\`\`\n${f.text}\n\`\`\``;
        } else if (ref) {
          textPart += `\n\n[User uploaded file: ${f.name} (${f.text.length} chars)]\npath: ${ref}\n(檔案較大未內嵌 — 請用 read_file 讀取完整內容)`;
        } else {
          textPart += `\n\n[Upload failed for ${f.name} — 檔案過大且上傳失敗，請提醒使用者重試]`;
        }
      }
    }
    if (!textPart && uploadedPaths.length > 0 && fileMeta.length === 0) textPart = "請看這張圖"; // 圖-only 保留原行為
    if (!textPart) return;
    if (!msg && fileMeta.length > 0) textPart = `${tt("chat.fileDefaultMsg")}${textPart}`;

    const userMsg: SideChatMessage = { role: "user", content: textPart, ts: new Date().toISOString(), ...(uploadedPaths.length > 0 ? { images: uploadedPaths } : {}), ...(fileMeta.length > 0 ? { files: fileMeta } : {}) };
    setMessages(prev => [...prev, userMsg]);
    if (viewingArchive) setViewingArchive(null); // 在歷史裡接話 → 這條線變成新的目前對話（存檔寫 active）
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
  }, [input, loading, messages, agentId, cwd, pendingImages, pendingFiles, tt, viewingArchive]);

  // 外部注入訊息（Handover QA chips → AI；不改變內部訊息流）
  React.useImperativeHandle(ref, () => ({
    send: (text: string) => { send(text); },
    addFiles: (files: File[]) => { addImages(files); addTextFiles(files); },
  }), [send, addImages, addTextFiles]);

  return (
    <div className="flex flex-col border-l relative" style={{ borderColor: "#e7e5e4", height }}>
      {/* 🧠 注入 prompt 檢視器（fixed overlay — 跟 crew chat 的 Context debug 同款深色 modal）*/}
      {showPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={() => { setShowPrompt(false); setPromptData(null); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-[640px] max-w-[90vw] max-h-[80vh] bg-[#1a1a2e] rounded-xl shadow-2xl border border-stone-700 flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-700">
              <h3 className="text-sm font-bold text-stone-100 flex items-center gap-2">🧠 {tt("sideChat.prompt")}</h3>
              <div className="flex items-center gap-3">
                {typeof promptData?.totalLength === "number" && (
                  <span className="text-xs text-stone-400">Total: {promptData.totalLength.toLocaleString()} chars</span>
                )}
                <button onClick={() => { setShowPrompt(false); setPromptData(null); }} className="text-stone-400 hover:text-white text-lg">✕</button>
              </div>
            </div>
            {promptData?.error ? (
              <div className="flex-1 flex items-center justify-center text-red-400 text-sm p-6">Error: {promptData.error}</div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: "thin" }}>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">🤖 {promptData?.agentName || agentName}</span>
                  {promptData?.contextProviders?.length > 0 && (
                    <span className="text-[10px] text-stone-500">providers: {promptData.contextProviders.join(", ")}</span>
                  )}
                </div>
                {promptData?.baseSystemPrompt ? (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">📋 Base System Prompt</span>
                      <span className="text-[10px] text-stone-500">{(promptData.baseSystemPrompt.length || 0).toLocaleString()} chars</span>
                    </div>
                    <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: 300, overflowY: "auto" }}>{String(promptData.baseSystemPrompt)}</pre>
                  </div>
                ) : promptData?.systemPromptPreview ? (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">📋 System Prompt Preview</span>
                      <span className="text-[10px] text-stone-500">{promptData.systemPromptLength?.toLocaleString?.() || ""} chars total</span>
                    </div>
                    <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: 300, overflowY: "auto" }}>{String(promptData.systemPromptPreview)}</pre>
                  </div>
                ) : (
                  <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: 400, overflowY: "auto" }}>{JSON.stringify(promptData, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0" style={{ borderColor: "#e7e5e4" }}>
        {avatarUrl ? (
          <img src={avatarUrl} className="w-6 h-6 rounded-full object-cover" alt="" />
        ) : (
          <span className="text-base">{agentEmoji}</span>
        )}
        <span className="text-xs font-bold text-stone-700">{agentName}</span>
        {loading && <span className="text-[10px] text-stone-400 animate-pulse ml-auto">{action || "處理中…"}</span>}
        {/* 2026-09-17 Fleming：三按鈕（跟 crew chat 一致）— 📋 歷史 / 🧠 注入 prompt / 💬 新對話 */}
        {persistCrewId && (
          <div className={`${loading ? "" : "ml-auto"} flex items-center gap-1 shrink-0`}>
            {viewingArchive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">📂 {tt("sideChat.archive")}</span>
            )}
            <button
              onClick={() => { if (!showSessions) loadSessions(); setShowSessions(!showSessions); }}
              className="text-xs px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:bg-stone-50 transition-colors"
              title={tt("sideChat.history")}
            >📋</button>
            <button
              onClick={viewPrompt}
              className="text-xs px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:bg-stone-50 transition-colors"
              title={tt("sideChat.prompt")}
            >🧠</button>
            <button
              onClick={startNewChat}
              disabled={messages.length === 0}
              className="text-xs px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:bg-stone-50 transition-colors disabled:opacity-30"
              title={tt("sideChat.newChat")}
            >💬</button>
          </div>
        )}
      </div>

      {/* 📋 Sessions 下拉清單（active + 歷史）*/}
      {persistCrewId && showSessions && (
        <div className="border-b bg-white shadow-sm shrink-0" style={{ borderColor: "#e7e5e4", maxHeight: 220, overflowY: "auto" }}>
          <div className="flex items-center justify-between px-3 py-2 border-b sticky top-0 bg-white z-10" style={{ borderColor: "#e7e5e4" }}>
            <span className="text-xs font-semibold text-stone-600">📜 {tt("sideChat.sessions")}</span>
            <button onClick={() => setShowSessions(false)} className="text-stone-400 hover:text-stone-600 text-sm">✕</button>
          </div>
          {sessions.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-stone-400">{tt("sideChat.noSessions")}</div>
          ) : sessions.map(s => (
            <button
              key={s.sessionId}
              onClick={() => openSession(s.sessionId)}
              className={`w-full text-left px-3 py-2 hover:bg-stone-50 border-b last:border-b-0 transition-colors ${viewingArchive === s.sessionId || (!viewingArchive && s.isActive) ? "bg-amber-50/50" : ""}`}
              style={{ borderColor: "#f5f5f4" }}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-stone-700 truncate flex-1">{s.isActive ? "🟢" : "📂"} {s.title || (s.isActive ? tt("sideChat.current") : "對話")}</span>
                <span className="text-[10px] text-stone-400 shrink-0">{s.messageCount} 則</span>
              </div>
              {s.lastUpdated && (
                <div className="text-[10px] text-stone-400 mt-0.5">{new Date(s.lastUpdated).toLocaleString()}</div>
              )}
            </button>
          ))}
        </div>
      )}

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
          <div key={i} className="flex gap-2.5">
            {/* Avatar — 跟 ChatView/EMDashboard 同形式：左側頭像欄（user=accent 漸層「你」、assistant=avatar/emoji）*/}
            <div className="flex-shrink-0 mt-0.5">
              {m.role === "user" ? (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm" style={{ background: youGrad }}>你</div>
              ) : avatarUrl ? (
                <img src={avatarUrl} className="w-7 h-7 rounded-full object-cover" style={{ border: `1px solid ${accent}33` }} alt="" />
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ backgroundColor: `${accent}22`, border: `1px solid ${accent}33` }}>{agentEmoji}</div>
              )}
            </div>
            {/* Bubble — 全部靠左（跟其他 chat UI 一致；user 淺色泡泡不再是黑色靠右）*/}
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-stone-600">{m.role === "assistant" ? agentName : "你"}</span>
                <span className="text-[10px] text-stone-300">{fmtChatTime(m.ts)}</span>
              </div>
              {m.role === "assistant" ? (
                <div className="px-3.5 py-2 rounded-2xl bg-white shadow-sm border border-stone-100 text-sm text-stone-700 leading-relaxed">
                  <MarkdownText>{m.content}</MarkdownText>
                </div>
              ) : (
                <div>
                  {m.images && m.images.length > 0 && (
                    <div className="flex gap-1.5 mb-1 flex-wrap">
                      {m.images.map((p, j) => (
                        <img key={j} src={`${API_BASE}/api/${p}`} alt="" className="max-w-[140px] max-h-[140px] rounded-lg object-cover" />
                      ))}
                    </div>
                  )}
                  {m.files && m.files.length > 0 && (
                    <div className="flex gap-1.5 mb-1 flex-wrap">
                      {m.files.map((f, j) => (
                        <span key={j} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-100 border border-stone-200 text-[10px] text-stone-600 max-w-[200px]">
                          <span>📄</span>
                          <span className="truncate" title={f.name}>{f.name}</span>
                          <span className="text-stone-400 shrink-0">{(f.size / 1024).toFixed(1)}KB</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {(() => {
                    // 氣泡只顯示使用者打的字（inline 檔案內容不重複渲染，用上方 chip 代表）
                    const shown = m.content.split("\n\n[User uploaded file:")[0].trim();
                    if (!shown) return null;
                    return <span className="inline-block px-3 py-1.5 rounded-2xl text-sm bg-stone-50 text-stone-700 max-w-[85%] whitespace-pre-wrap">{shown}</span>;
                  })()}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-2.5">
            <div className="flex-shrink-0 mt-0.5">
              {avatarUrl ? (
                <img src={avatarUrl} className="w-7 h-7 rounded-full object-cover" style={{ border: `1px solid ${accent}33` }} alt="" />
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ backgroundColor: `${accent}22`, border: `1px solid ${accent}33` }}>{agentEmoji}</div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-stone-600">{agentName}</span>
              </div>
              <div className="px-3.5 py-2 rounded-2xl bg-white shadow-sm border border-stone-100 text-sm text-stone-400 animate-pulse">{action || "💭 思考中…"}</div>
            </div>
          </div>
        )}
      </div>

      {/* Input — IME 三層保護：composingRef → isComposing → keyCode 229 */}
      <div className="border-t p-2 shrink-0" style={{ borderColor: "#e7e5e4" }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer.files); addImages(files); addTextFiles(files); }}>
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
        {/* 📄 待送文字檔預覽 */}
        {pendingFiles.length > 0 && (
          <div className="flex gap-1.5 mb-1.5 flex-wrap">
            {pendingFiles.map(f => (
              <div key={f.id} className="relative group">
                <span className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white border border-stone-200 text-[10px] text-stone-600 max-w-[220px]">
                  <span>📄</span>
                  <span className="truncate" title={f.name}>{f.name}</span>
                  <span className="text-stone-400 shrink-0">{(f.size / 1024).toFixed(1)}KB</span>
                </span>
                <button onClick={() => setPendingFiles(p => p.filter(x => x.id !== f.id))} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-stone-700 text-white text-[9px] flex items-center justify-center opacity-80 hover:opacity-100">✕</button>
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
          {/* 📄 文字檔鈕 */}
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { addTextFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={pendingFiles.length >= 4} title={tt("chat.attachFile")}
            className="text-xs px-2 py-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:border-stone-300 disabled:opacity-40 shrink-0 bg-stone-50">📄</button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onPaste={async (e) => {
              // 2026-09-16：貼圓修復 — files/items/text-html 全支援
              if (!pasteMayContainImage(e.clipboardData)) return;
              e.preventDefault();
              const files = await extractPasteFiles(e.clipboardData);
              if (files && files.length > 0) { addImages(files); addTextFiles(files); }
            }}
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
            <button onClick={() => send()} disabled={!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0}
              className="text-xs px-3 py-2 rounded-lg text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: accent }}>
              送出
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
