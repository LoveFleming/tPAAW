/**
 * AgentSideChat — 側欄 AI 對話（全站共用元件）
 *
 * 兩種 transport：
 *   1. a2a（預設）— 打 /a2a/:agentId 的 message/stream（coding crews / EM chat 同協議）
 *   2. paawChat    — 打 /api/paaw/chat（contextTarget: "project" / "notes" / ...，
 *                    server context-engine 已支援；與 ChatView 林雨晴同協議）
 *
 * 共用對象：RM / Handover / Troubleshooting / QA Browser side chat、
 *           ProjectAiPanel（AI 專案助理）、Notes（AI 寫筆記）、未來新 module。
 * 功能：📋 歷史 / 🧠 prompt 檢視 / 💬 新對話 / ModelSelector / 🖼️📄 上傳 / tool badges / 停止。
 *
 * 注意：textarea 有 IME composition 三層保護（TOOLS.md 紀律，在 ChatInputBar 內）。
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { stableStringify, fmtChatTime } from "../utils";
import { useI18n } from "../i18n";
import MarkdownText from "./MarkdownText";
import { LoadingIndicator, ToolBadges, type ChatToolBadge } from "./ChatMessages"; // 2026-10-09：side chat 與 agent chat UI 一致（Fleming 要求） // markdown 渲染（含 GFM table）
import ModelSelector from "./ModelSelector";
import ChatInputBar, { type ChatInputBarHandle, type PendingImage, type PendingFile } from "./ChatInputBar"; // 2026-10-09 Fleming：side chat 跟 crew chat 同款 model selector

// fetch crew 大頭照（AI Crew 頁面同一張）+ 使用者偏好覆蓋（2026-10-09：頭像/顯示名/開場白偏好層）
function useCrewAvatar(agentId: string, enabled: boolean) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{ displayName?: string; greeting?: string }>({});
  useEffect(() => {
    if (!enabled || !agentId) return;
    let alive = true;
    fetch(`${API_BASE}/api/coding-crew/coding.${agentId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.imageUrl) setAvatarUrl(`${API_BASE}${d.imageUrl}`); })
      .catch(() => {});
    fetch(`${API_BASE}/api/crew-preferences/coding.${agentId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive || !d) return;
        if (d.avatarUrl) setAvatarUrl(d.avatarUrl.startsWith("/") ? `${API_BASE}${d.avatarUrl}` : d.avatarUrl);
        setIdentity({ displayName: d.displayName, greeting: d.greeting });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [agentId, enabled]);
  return { avatarUrl, ...identity };
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
  modelFeature?: string;    // 2026-10-09 Fleming：有帶 → header 顯示 ModelSelector（跟 crew chat / QA browser 同款），
                             //   選的 model 透過 a2a params.metadata.model 送出（per-chat user preference）
  paawChat?: {              // 2026-10-09 Fleming：AI 專案助理 / AI 寫筆記 統一用 side chat — 走 /api/paaw/chat
    contextTarget: string;  //   "project" | "notes" | ...（context-engine build target）
    contextSeed?: string;   //   訊息區頂部的 📋 context 提示條（原本 ProjectAiPanel 的 context hint）
  };
  onClose?: () => void;     // 有帶 → header 右側 ✕（Panel 形式）
  headerActions?: (ctx: {   // header 擴充鈕（如 Notes 的「💾 存成筆記」）
    getLastAssistant: () => string | undefined;
    loading: boolean;
  }) => React.ReactNode;
}

export interface AgentSideChatHandle {
  send: (text: string) => void;   // 外部注入訊息（Handover QA → AI）
  addFiles: (files: File[]) => void; // 外部注入附件（📸 拍目前畫面 → 直接入 attachment area，2026-09-26）
  setText: (text: string) => void;  // 外部預填輸入框（ProjectAiPanel initialPrompt，不自動送出）
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
  modelFeature,
  paawChat,
  onClose,
  headerActions,
}: AgentSideChatProps, ref) {
  const [messages, setMessages] = useState<SideChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string>("");
  // 2026-10-09：tool badges — 跟 agent chat（ChatView）同款
  const [activeTools, setActiveTools] = useState<ChatToolBadge[]>([]);
  const [model, setModel] = useState(""); // 2026-10-09：per-side-chat model override（ModelSelector 初始値讀 user preference）
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<ChatInputBarHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null); // 聊天容器：用容器 scrollTo，不用 scrollIntoView（會拖祖先容器）
  const nearBottomRef = useRef(true);
  const composingRef = useRef(false); // IME 三層保護（可靠層）
  const { avatarUrl, displayName: prefName, greeting: prefGreeting } = useCrewAvatar(paawChat ? "" : agentId, !paawChat);
  const shownName = prefName || agentName;
  const shownGreeting = prefGreeting || greeting;
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
    // 🛡 2026-09-27 治本：看歷史（viewingArchive）時絕不 auto-save —
    // 否則歷史內容 2 秒後被寮回 active 對話，目前對話被歷史覆蓋（切不回來的根因）
    if (viewingArchive) return;
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
  }, [messages, persistCrewId, cwd, viewingArchive]);

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

  // 🧠 查看注入 prompt — paawChat 走 generic-preview（同 ProjectAiPanel 原本的 📋 Prompt）；a2a 走 system-prompt
  const viewPrompt = useCallback(async () => {
    if (paawChat) {
      const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
      try {
        const res = await fetch(`${API_BASE}/api/ai-settings/generic-preview`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: paawChat.contextTarget, prompt: lastUser }),
        });
        const d = await res.json();
        setPromptData({ agentName, systemPrompt: d.systemPrompt || "", userPrompt: d.userPrompt || "", totalLength: (d.systemPrompt || "").length + (d.userPrompt || "").length });
      } catch (e: any) {
        setPromptData({ error: e?.message || "fetch failed" });
      }
      setShowPrompt(true);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/a2a/${encodeURIComponent(agentId)}/system-prompt${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`);
      setPromptData(await res.json());
    } catch (e: any) {
      setPromptData({ error: e?.message || "fetch failed" });
    }
    setShowPrompt(true);
  }, [agentId, cwd, paawChat, messages, agentName]);

  // 👁 agent chat 貼圖（2026-08-30）：paste/drop/picker → 壓縮 → 上傳 → a2a parts 喜vision model


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

  const submit = useCallback(async ({ text, images, files }: { text: string; images: PendingImage[]; files: PendingFile[] }) => {
    const msg = text.trim();
    if ((!msg && images.length === 0 && files.length === 0) || loading) return;

    // 👁 先上傳 pending 圖 → 換 path（失敗跳過）
    let uploadedPaths: string[] = [];
    if (images.length > 0) {
      const results = await Promise.all(images.map(async (img) => {
        try {
          const r = await fetch(`${API_BASE}/api/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: img.dataUrl }) });
          const j = await r.json();
          return j.ok ? j.path : null;
        } catch { return null; }
      }));
      uploadedPaths = results.filter(Boolean) as string[];
    }

    // 📄 上傳 pending 文字檔 → path（失敗 fallback：小檔直接 inline，大檔提示失敗）
    const INLINE_LIMIT = 8000;
    let textPart = msg;
    const fileMeta: { name: string; size: number }[] = [];
    if (files.length > 0) {
      for (const f of files) {
        fileMeta.push({ name: f.name, size: f.size });
        let uploaded: { abs?: string; rel?: string } | null = null;
        try {
          const r = await fetch(`${API_BASE}/api/uploads/text`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: stableStringify({ content: f.text, filename: f.name, ruRoot: cwd }),
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
    setActiveTools([]);

    const ac = new AbortController();
    abortRef.current = ac;

    // paaw-chat 模式的 tool badge 標籤（跟 a2a 同款中文 action labels）
    const actionLabels: Record<string, string> = {
      read_file: "📖 讀取檔案", write_file: "✏️ 寫入檔案", edit_file: "✏️ 編輯檔案",
      glob: "🔍 搜尋檔案", grep: "🔍 搜尋內容", bash: "⚡ 執行指令", git: "🔄 Git",
      create_note: "📝 建立筆記", search_notes: "🔍 搜尋筆記",
    };

    try {
      let res: Response;
      if (paawChat) {
        // ── paawChat transport：/api/paaw/chat（與 ChatView 林雨晴同協議）──
        res = await fetch(`${API_BASE}/api/paaw/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: stableStringify({
            messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images } : {}) })),
            model: model || undefined,
            contextTarget: paawChat.contextTarget,
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const err = await res.text();
          setMessages(prev => [...prev, { role: "assistant", content: `❌ API 錯誤: ${res.status} — ${err.slice(0, 200)}`, ts: new Date().toISOString() }]);
          return;
        }
      } else {
        // ── a2a transport（原本路徑）──
        res = await fetch(`${API_BASE}/a2a/${agentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: stableStringify({
            jsonrpc: "2.0",
            method: "message/stream",
            params: {
              message: { role: "user", parts: [{ type: "text", text: textPart }, ...uploadedPaths.map(p => ({ type: "image", path: p }))] },
              context: { cwd },
              metadata: model ? { model } : undefined, // 2026-10-09：跟 crew chat 同協議（params.metadata.model）
              conversationHistory: [...messages, { role: "user", content: textPart }],
            },
            id: `${agentId}-chat-${Date.now()}`,
          }),
          signal: ac.signal,
        });
      }

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

            if (paawChat) {
              // ── paaw-chat 事件：{content}（delta 累積）/ {tool_call} / {tool_result} / {error} ──
              if (d.content) {
                fullText += d.content;
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant" && (last as any)._streaming) {
                    return [...prev.slice(0, -1), { ...last, content: fullText }];
                  }
                  return [...prev, { role: "assistant", content: fullText, ts: new Date().toISOString(), _streaming: true } as SideChatMessage];
                });
                nearBottomRef.current && scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "instant" });
              } else if (d.tool_call?.name) {
                const argsObj = typeof d.tool_call.args === "string" ? (() => { try { return JSON.parse(d.tool_call.args); } catch { return {}; } })() : (d.tool_call.args || {});
                const detail = argsObj?.path || argsObj?.pattern || argsObj?.command || argsObj?.query || "";
                setAction(`${actionLabels[d.tool_call.name] || `🔧 ${d.tool_call.name}`} ${String(detail).split(/[\/]/).pop()}`);
                setActiveTools(prev => [...prev, { name: d.tool_call.name, status: "running" }]);
              } else if (d.tool_result?.name) {
                setActiveTools(prev => prev.map(t => t.name === d.tool_result.name ? { ...t, status: d.tool_result.result?.error ? "error" : "done" } : t));
                setTimeout(() => setActiveTools(prev => prev.filter(t => t.name !== d.tool_result.name)), 1500);
                setAction("💭 思考中…");
              } else if (d.error) {
                // server 形狀：{ error: true, message: "..." }（message 在頂層，chat.mjs:381）
                const errText = typeof d.error === "string" ? d.error : (d.message || d.error?.message || d.error?.error || "unknown");
                setMessages(prev => [...prev, { role: "assistant", content: `❌ ${errText}`, ts: new Date().toISOString() }]);
                fullText = "__error__";
              }
              continue;
            }

            if (currentEvent === "thinking" && d.content) {
              setAction("💭 思考中…");
            } else if ((currentEvent === "tool" || currentEvent === "tool_result") && d.name) {
              // 2026-10-09：跟 agent chat（ChatView）同款 — badges + 中文 action labels
              const label = d.name.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
              const labelShort = label.replace(/ App/g, "");
              const actionLabels: Record<string, string> = {
                read_file: "📖 讀取檔案", write_file: "✏️ 寫入檔案", edit_file: "✏️ 編輯檔案",
                glob: "🔍 搜尋檔案", grep: "🔍 搜尋內容", bash: "⚡ 執行指令", git: "🔄 Git",
              };
              if (d.args !== undefined) {
                const argsObj = typeof d.args === "string" ? (() => { try { return JSON.parse(d.args); } catch { return {}; } })() : d.args;
                const detail = argsObj?.path || argsObj?.pattern || argsObj?.command || "";
                setAction(`${actionLabels[d.name] || `🔧 ${labelShort}`} ${String(detail).split(/[\/\\]/).pop()}`);
                setActiveTools(prev => [...prev, { name: labelShort, status: "running" }]);
              }
              if (d.result !== undefined) {
                setActiveTools(prev => prev.map(t => t.name === labelShort ? { ...t, status: d.result?.error ? "error" : "done" } : t));
                setTimeout(() => setActiveTools(prev => prev.filter(t => t.name !== labelShort)), 1500);
                setAction("💭 思考中…");
              }
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
  }, [loading, messages, agentId, cwd, tt, viewingArchive, model, paawChat]);

  // 外部注入訊息（Handover QA chips → AI；不改變內部訊息流）
  React.useImperativeHandle(ref, () => ({
    send: (text: string) => { submit({ text, images: [], files: [] }); },
    addFiles: (files: File[]) => { inputRef.current?.addFiles(files); },
    setText: (text: string) => { inputRef.current?.setText(text); },
  }), [submit]);

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
                {promptData?.systemPrompt !== undefined ? (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">📋 System Prompt（{paawChat?.contextTarget}）</span>
                        <span className="text-[10px] text-stone-500">{(promptData.systemPrompt || "").length.toLocaleString()} chars</span>
                      </div>
                      <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: 300, overflowY: "auto" }}>{String(promptData.systemPrompt || "(空)")}</pre>
                    </div>
                    {promptData?.userPrompt ? (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">💬 User Prompt</span>
                          <span className="text-[10px] text-stone-500">{promptData.userPrompt.length.toLocaleString()} chars</span>
                        </div>
                        <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: 200, overflowY: "auto" }}>{String(promptData.userPrompt)}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : promptData?.baseSystemPrompt ? (
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
        <span className="text-xs font-bold text-stone-700">{shownName}</span>
        {/* 2026-09-17 Fleming：三按鈕（跟 crew chat 一致）— 📋 歷史 / 🧠 注入 prompt / 💬 新對話 */}
        {/* 2026-10-09 Fleming：加 ModelSelector（modelFeature 有帶就顯示，跟 QA browser / crew chat 同款）*/}
        {(persistCrewId || modelFeature) && (
          <div className={`${loading ? "" : "ml-auto"} flex items-center gap-1 shrink-0`}>
            {viewingArchive && (
              <button
                onClick={() => openSession("active")}
                className="text-[10px] px-2 py-1 rounded-lg bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 font-semibold transition-colors"
                title={tt("sideChat.backToActive")}
              >↩ {tt("sideChat.backToActive")}</button>
            )}
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
            {modelFeature && (
              <ModelSelector feature={modelFeature} value={model} onChange={setModel} />
            )}
            {headerActions?.({
              getLastAssistant: () => [...messages].reverse().find(m => m.role === "assistant")?.content,
              loading,
            })}
            {onClose && (
              <button
                onClick={onClose}
                className="text-lg leading-none px-1 text-stone-400 hover:text-stone-600 transition-colors"
                title="關閉"
              >✕</button>
            )}
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
          ) : sessions.map(s => {
            const isCurrent = !viewingArchive && s.isActive;
            const isViewing = viewingArchive === s.sessionId || isCurrent;
            return (
            <button
              key={s.sessionId}
              onClick={() => openSession(s.sessionId)}
              className={`w-full text-left px-3 py-2 border-b last:border-b-0 transition-colors ${s.isActive ? "border-l-[3px] border-l-green-500" : "border-l-[3px] border-l-transparent"} ${isViewing ? "bg-amber-50" : "hover:bg-stone-50"}`}
              style={{ borderColor: "#f5f5f4" }}
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-[11px] truncate flex-1 ${s.isActive ? "text-green-700 font-semibold" : "text-stone-700"}`}>{s.isActive ? "🟢" : "📂"} {s.title || (s.isActive ? tt("sideChat.current") : "對話")}</span>
                {s.isActive && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-300 font-semibold shrink-0">{tt("sideChat.activeBadge")}</span>
                )}
                <span className="text-[10px] text-stone-400 shrink-0">{s.messageCount} 則</span>
              </div>
              {s.lastUpdated && (
                <div className="text-[10px] text-stone-400 mt-0.5">{new Date(s.lastUpdated).toLocaleString()}</div>
              )}
            </button>
            );
          })}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={(e) => {
        const el = e.currentTarget;
        nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }} className="flex-1 overflow-y-auto px-3 py-3 space-y-3" style={{ scrollbarWidth: "thin" }}>
        {paawChat?.contextSeed && (
          <div className="text-xs px-3 py-2 rounded-lg border border-dashed border-stone-200 bg-stone-50 text-stone-400 leading-relaxed" title={paawChat.contextSeed}>
            📋 {paawChat.contextSeed.length > 110 ? paawChat.contextSeed.slice(0, 110) + "…" : paawChat.contextSeed}
          </div>
        )}
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center text-2xl mb-2 overflow-hidden" style={{ backgroundColor: accent + "15" }}>
              {avatarUrl ? <img src={avatarUrl} className="w-full h-full object-cover" alt="" /> : agentEmoji}
            </div>
            <p className="text-xs text-stone-500 leading-relaxed max-w-[220px] mx-auto">{shownGreeting}</p>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
                {suggestions.map(s => (
                  <button key={s.label} onClick={() => submit({ text: s.prompt, images: [], files: [] })}
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
                <span className="text-xs font-medium text-stone-600">{m.role === "assistant" ? shownName : "你"}</span>
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
                <span className="text-xs font-medium text-stone-600">{shownName}</span>
              </div>
              <div>
                <LoadingIndicator accent={accent} label={action || "💭 思考中…"} />
                {activeTools.length > 0 && <ToolBadges tools={activeTools} />}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input — 共用元件 ChatInputBar（與林雨晴 chat 完全一致，2026-10-09 Fleming）*/}
      <ChatInputBar
        ref={inputRef}
        placeholder={placeholder}
        accent={accent}
        loading={loading}
        onSubmit={submit}
        onStop={() => abortRef.current?.abort()}
      />
    </div>
  );
});
