/**
 * TeacherChatPanel — 教室老師 chat（浮動面板，不推走教學內容）
 *
 * 樣式鐵律（2026-09-26 Fleming）：內容一律靠左，與林雨晴助教 chat（ChatMessages）樣式一致；
 * 上傳圖片（📎/貼圖，視覺模型看圖）與文字檔（📄，inline/path 引用）功能與助教 chat 相同。
 * 學生端零 shell：不渲染任何工具細節，只顯示「思考中」。
 * 通道：POST /a2a/{agentId}（jsonrpc message/stream → SSE）；image 走 a2a parts {type:"image", path}。
 * 持久化（2026-09-28）：rootPath 有值時對話存 server（/api/conversations/classroom-{agentId}，
 * active 進行中檔 + archive-* 歷史檔，與 ai-crew tab 同款契約、namespace 隔離不互搶 active）；
 * 支援 🆕 新對話（歸檔另存）與 📜 歷史列表續聊。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import MarkdownText from "@paaw-ui/components/MarkdownText";
import { useI18n } from "@paaw-ui/i18n";
import { pasteMayContainImage, extractPasteFiles } from "@paaw-ui/utils/pasteFiles";

interface PendingImage { dataUrl: string; name: string; }
interface PendingFile { name: string; size: number; text: string; }
interface Msg {
  role: "user" | "assistant"; content: string; ts?: string;
  images?: string[];                     // dataUrl 縮圖（顯示用）
  files?: { name: string; size: number }[];
}
interface CrewInfo {
  id: string; title: string; codename: string; imageUrl: string;
  chatConfig?: { greeting?: string };
}
/** 對話 session 摘要（GET /api/conversations/:ns 清單項） */
interface SessionEntry {
  id: string; title: string; createdAt?: string; updatedAt?: string;
  messageCount?: number;
}

const ACCENT = "#10b981";
const MAX_ATTACH = 4;
const INLINE_LIMIT = 8000;
const PAGE_MD_LIMIT = 8000;   // 本頁教學內容注入上限（過長截斷）

function formatTime(ts?: string) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return ""; }
}

function Avatar({ role, imageUrl, emoji }: { role: string; imageUrl?: string; emoji?: string }) {
  if (role === "assistant") {
    if (imageUrl) return <img src={imageUrl} className="w-8 h-8 rounded-full object-cover" alt="" />;
    return (
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
        style={{ backgroundColor: ACCENT + "22", border: `1px solid ${ACCENT}33` }}>
        {emoji || "👩‍🏫"}
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
      style={{ background: `linear-gradient(135deg, ${ACCENT}, #059669)` }}>
      元
    </div>
  );
}

function MessageRow({ msg, assistantName, imageUrl }: {
  msg: Msg; assistantName: string; imageUrl?: string;
}) {
  return (
    <div className="flex justify-start">
      <div className="flex gap-2.5 max-w-[95%]">
        <div className="flex-shrink-0 mt-1">
          <Avatar role={msg.role} imageUrl={msg.role === "assistant" ? imageUrl : undefined} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium text-stone-600">
              {msg.role === "assistant" ? assistantName : "小元寶"}
            </span>
            {msg.ts && <span className="text-[10px] text-stone-300">{formatTime(msg.ts)}</span>}
          </div>
          <div className={`px-4 py-3 text-sm leading-relaxed rounded-2xl ${
            msg.role === "assistant"
              ? "bg-white shadow-sm border border-stone-100 text-stone-700"
              : "bg-stone-50 text-stone-700"
          }`}>
            {msg.content && (msg.role === "assistant"
              ? <MarkdownText>{msg.content}</MarkdownText>
              : <div className="whitespace-pre-wrap">{msg.content}</div>)}
            {msg.images && msg.images.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {msg.images.map((img, i) => (
                  <img key={i} src={img} alt="" className="w-14 h-14 rounded-lg object-cover border border-stone-200" />
                ))}
              </div>
            )}
            {msg.files && msg.files.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {msg.files.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white border border-stone-200 px-2 py-0.5 text-[11px] text-stone-500">
                    📄 {f.name}（{(f.size / 1024).toFixed(0)}KB）
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex gap-1.5">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: ACCENT, animationDelay: "0ms" }} />
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: ACCENT, animationDelay: "200ms" }} />
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: ACCENT, animationDelay: "400ms" }} />
      </div>
      <span className="text-xs font-medium opacity-70" style={{ color: ACCENT }}>{label}</span>
    </div>
  );
}

export default function TeacherChatPanel({ teacherName, agentId, unitLabel, pageMd, onClose, kickoff, fitContainer, rootPath }: {
  agentId: string;
  /** 學生目前位置（動態：科目總覽／單元／知識點），換頁即更新 */
  unitLabel: string;
  /** 學生正在看的該頁教學內容 — 每則訊息注入，讓老師對話聚焦該頁 */
  pageMd?: string;
  onClose: () => void;
  /** 開面板自動送出的第一則訊息（錯題講解/變形題用；seq 遞增可重觸） */
  kickoff?: { text: string; seq: number };
  /** 塞進 SplitChatLayout 這種自適寬容器用（根元素改 w-full） */
  fitContainer?: boolean;
  teacherName?: string; // 顯示名（/api/crew 端點不存在，本地 fallback 用）
  /** 專案根（有的話啟用對話持久化：存 .paaw/conversations/<hash>/classroom-{agentId}/） */
  rootPath?: string;
}) {
  const { t } = useI18n();
  const [crew, setCrew] = useState<CrewInfo | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const composingRef = useRef(false);                                    // IME 三層保護
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── 對話持久化 session 狀態（rootPath 有值才啟用）──
  const [sessionId, setSessionId] = useState("active");                  // 進行中="active"，續聊歷史="archive-*"
  const [sessions, setSessions] = useState<SessionEntry[]>([]);          // 歷史清單
  const [showHistory, setShowHistory] = useState(false);
  const convNs = `classroom-${agentId}`;                                 // namespace：與 ai-crew tab 的 teacher.* 隔離
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMsgs([]); setCrew(null); setSessionId("active"); setShowHistory(false); setSessions([]);
    let cancelled = false;
    // 2026-10-04 瘦身：/api/crew/:id 端點不存在（CodingIDE fork 殘留，永遠 404）→ 直接本地 fallback crew
    (async () => {
      const d: CrewInfo = { id: agentId, title: teacherName || agentId, codename: "", imageUrl: "" };
      if (cancelled) return;
      setCrew(d);
      const g = d.chatConfig?.greeting;
      // 有開持久化 → 先還原 server 上的 active 對話（refresh/關面板重開不流失）；無則 greeting
      let restored = false;
      if (rootPath) {
        try {
          const conv = await fetch(`/api/conversations/${encodeURIComponent(`classroom-${agentId}`)}/active?root=${encodeURIComponent(rootPath)}`).then(r => r.json());
          const loaded = (Array.isArray(conv?.messages) ? conv.messages : [])
            .map((m: { role?: string; content?: string; ts?: string }) => ({
              role: m.role === "user" ? ("user" as const) : ("assistant" as const),
              content: String(m.content || ""), ts: m.ts,
            }))
            .filter((m: Msg) => m.content);
          if (loaded.length > 0) { setMsgs(loaded); restored = true; }
        } catch { /* 還原失敗退回 greeting */ }
      }
      if (!restored) setMsgs([{ role: "assistant", content: g || `嗨！我是${d.title}，有什麼我可以幫忙的嗎？`, ts: new Date().toISOString() }]);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, rootPath]);

  const kickoffRef = useRef(-1);
  // 開面板自動送 kickoff（等 crew 載入後；同 seq 只送一次）— 錯題講解/變形題一鍵直達
  useEffect(() => {
    if (!kickoff || !crew || kickoffRef.current === kickoff.seq) return;
    kickoffRef.current = kickoff.seq;
    send(kickoff.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kickoff?.seq, crew]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, live, thinking, pendingImages, pendingFiles]);

  // ═══ 對話持久化（rootPath 有值才作用；契約同 LearningSpace crew chat）═══
  const refreshSessions = useCallback(async () => {
    if (!rootPath) return;
    try {
      const list = await fetch(`/api/conversations/${encodeURIComponent(convNs)}?root=${encodeURIComponent(rootPath)}`).then(r => r.json());
      if (Array.isArray(list)) setSessions(list.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))));
    } catch { /* 清單失敗不影響聊天 */ }
  }, [rootPath, convNs]);

  // 開歷史面板時刷新清單
  useEffect(() => { if (showHistory) refreshSessions(); }, [showHistory, refreshSessions]);

  // 每輪對話後 debounce 2s 存回 server（只存文字欄位，圖檔 dataUrl 不入檔；greeting-only 不存）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!rootPath || !sessionId) return;
    const hasUser = msgs.some(m => m.role === "user");
    if (!hasUser || msgs.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/conversations/${encodeURIComponent(convNs)}?root=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sessionId,
          title: `${agentId} 教室對話`,
          messages: msgs.map(({ role, content, ts }) => ({ role, content, ts })),
        }),
      }).catch(() => {});
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [msgs, sessionId, rootPath, convNs, agentId]);

  // 🆕 新對話：進行中(active)有真實對話 → 另存 archive-{ts} + 刪 active；清空回 greeting
  const startNewChat = useCallback(() => {
    const g = crew?.chatConfig?.greeting;
    const doReset = () => {
      setSessionId("active");
      setMsgs(g ? [{ role: "assistant", content: g, ts: new Date().toISOString() }] : []);
      setShowHistory(false);
    };
    if (rootPath && sessionId === "active" && msgs.some(m => m.role === "user")) {
      fetch(`/api/conversations/${encodeURIComponent(convNs)}?root=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `archive-${Date.now()}`, title: `${agentId} 教室對話`,
          messages: msgs.map(({ role, content, ts }) => ({ role, content, ts })),
        }),
      })
        .then(() => fetch(`/api/conversations/${encodeURIComponent(convNs)}/active?root=${encodeURIComponent(rootPath)}`, { method: "DELETE" }))
        .catch(() => {})
        .finally(() => { doReset(); refreshSessions(); });
    } else {
      // 正在看歷史 session：清掉 server 上的殘留 active（否則重掛會還原舊對話，與新對話語意矛盾）
      if (rootPath) {
        fetch(`/api/conversations/${encodeURIComponent(convNs)}/active?root=${encodeURIComponent(rootPath)}`, { method: "DELETE" })
          .catch(() => {})
          .finally(() => { doReset(); refreshSessions(); });
      } else {
        doReset();
      }
    }
  }, [crew, msgs, sessionId, rootPath, convNs, agentId, refreshSessions]);

  // 📜 開歷史 session 續聊（之後存回同一檔，上下文延續）
  const openSession = useCallback(async (id: string) => {
    if (!rootPath) return;
    try {
      const conv = await fetch(`/api/conversations/${encodeURIComponent(convNs)}/${encodeURIComponent(id)}?root=${encodeURIComponent(rootPath)}`).then(r => r.json());
      const loaded = (Array.isArray(conv?.messages) ? conv.messages : [])
        .map((m: { role?: string; content?: string; ts?: string }) => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: String(m.content || ""), ts: m.ts,
        }))
        .filter((m: Msg) => m.content);
      setSessionId(id);
      setMsgs(loaded);
      setShowHistory(false);
    } catch { /* 載入失敗留在原地 */ }
  }, [rootPath, convNs]);

  // ── 附加檔案（與助教 chat 同款：📎 圖 max 4、📄 文字檔 max 4、貼圖支援）──
  const addImages = (files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith("image/"));
    for (const f of imgs) {
      if (pendingImages.length >= MAX_ATTACH) break;
      const r = new FileReader();
      r.onload = () => setPendingImages(p => p.length >= MAX_ATTACH ? p : [...p, { dataUrl: String(r.result), name: f.name }]);
      r.readAsDataURL(f);
    }
  };
  const addTextFiles = (files: File[]) => {
    const txts = files.filter(f => !f.type.startsWith("image/"));
    for (const f of txts) {
      if (pendingFiles.length >= MAX_ATTACH) break;
      const r = new FileReader();
      r.onload = () => setPendingFiles(p => p.length >= MAX_ATTACH ? p : [...p, { name: f.name, size: f.size, text: String(r.result) }]);
      r.readAsText(f);
    }
  };

  async function send(overrideText?: string) {
    if (busy) return;
    if (!input.trim() && !overrideText?.trim() && pendingImages.length === 0 && pendingFiles.length === 0) return;
    setBusy(true); setThinking(true); setLive("");
    const history = msgs;
    const sentImages = pendingImages;
    const sentFiles = pendingFiles;
    setInput(""); setPendingImages([]); setPendingFiles([]);

    try {
      // 1) 圖片上傳 → path（與助教 chat 同端點；學生端無 RU → 全域 uploads/）
      const uploadedPaths: string[] = [];
      for (const img of sentImages) {
        try {
          const r = await fetch(`/api/uploads`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: img.dataUrl }),
          });
          const d = await r.json();
          if (d?.ok && d?.path) uploadedPaths.push(d.path as string);
        } catch { /* 單張失敗續送 */ }
      }
      // 2) 文字檔上傳 → 小檔 inline / 大檔 path 引用
      let fileBlocks = "";
      const fileMeta = sentFiles.map(f => ({ name: f.name, size: f.size }));
      for (const f of sentFiles) {
        let uploaded: { abs?: string; rel?: string } | null = null;
        try {
          const r = await fetch(`/api/uploads/text`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: f.text, filename: f.name }),
          });
          const j = await r.json();
          if (j.ok) uploaded = { abs: j.abs, rel: j.rel };
        } catch { /* fallback inline */ }
        const ref = uploaded?.rel || uploaded?.abs;
        if (f.text.length <= INLINE_LIMIT) {
          const pathNote = ref ? `\npath: ${ref}` : "";
          fileBlocks += `\n\n[User uploaded file: ${f.name}]${pathNote}\n\`\`\`\n${f.text}\n\`\`\``;
        } else if (ref) {
          fileBlocks += `\n\n[User uploaded file: ${f.name} (${f.text.length} chars)]\npath: ${ref}\n(檔案較大未內嵌 — 請讀取完整內容)`;
        } else {
          fileBlocks += `\n\n[Upload failed for ${f.name} — 檔案過大且上傳失敗，請提醒使用者重試]`;
        }
      }

      const typedText = (overrideText ?? input).trim() || (uploadedPaths.length > 0 ? t("classroom.label.imageDefaultMsg") : "");
      const bodyText = typedText + fileBlocks;
      const sendText = bodyText || t("chat.attach.fileDefaultMsg");
      const userMsg: Msg = {
        role: "user", content: sendText, ts: new Date().toISOString(),
        ...(sentImages.length > 0 ? { images: sentImages.map(i => i.dataUrl) } : {}),
        ...(fileMeta.length > 0 ? { files: fileMeta } : {}),
      };
      setMsgs(m => [...m, userMsg]);

      // 本頁教學內容注入（學生正在看的頁面 → 老師聚焦該頁；過長截斷保護）
      const pageCtxBlock = pageMd && pageMd.trim()
        ? `\n【${t("classroom.page.pageCtx")}】\n${pageMd.length > PAGE_MD_LIMIT ? pageMd.slice(0, PAGE_MD_LIMIT) + "…（內容過長已截斷）" : pageMd}\n`
        : "";

      // 3) a2a message/stream — image 走 parts（與助教 chat 相同）
      const res = await fetch(`/a2a/${encodeURIComponent(agentId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              role: "user",
              parts: [
                { type: "text", text: `【${t("classroom.label.room")}】${unitLabel}${pageCtxBlock}\n${sendText}` },
                ...uploadedPaths.map(p => ({ type: "image", path: p })),
              ],
            },
            ...(history.length > 0 ? { conversationHistory: history.slice(-12).map(({ role, content }) => ({ role, content })) } : {}),
          },
          id: `tc-${Date.now()}`,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", evt = "", acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const ln of lines) {
          if (ln.startsWith("event: ")) { evt = ln.slice(7).trim(); continue; }
          if (!ln.startsWith("data: ")) continue;
          let d: { content?: string; done?: boolean; error?: string };
          try { d = JSON.parse(ln.slice(6)); } catch { continue; }
          if (evt === "thinking" || evt === "tool") setThinking(true);
          else if (evt === "content") {
            if (d.done && typeof d.content === "string") { acc = d.content; setLive(""); setThinking(false); }
            else if (d.content) { acc += d.content; setLive(acc); setThinking(false); }
          } else if (evt === "error" && d.error) { acc = `⚠️ ${d.error}`; }
        }
      }
      setMsgs(m => [...m, { role: "assistant", content: acc || "…", ts: new Date().toISOString() }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMsgs(m => [...m, { role: "assistant", content: `⚠️ ${msg}`, ts: new Date().toISOString() }]);
    } finally {
      setBusy(false); setThinking(false); setLive("");
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return; // IME 保護
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const displayName = crew ? (crew.codename ? `${crew.title} · ${crew.codename}` : crew.title) : "…";
  const hasPending = pendingImages.length > 0 || pendingFiles.length > 0;

  return (
    <div className={fitContainer ? "w-full h-full flex flex-col border-l border-stone-200 bg-stone-50" : "w-[400px] h-full flex flex-col border-l border-stone-200 bg-stone-50 shadow-2xl"}>
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 bg-white">
        {crew?.imageUrl ? (
          <img src={crew.imageUrl} alt="" className="w-9 h-9 rounded-full object-cover border border-stone-200" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-white border border-stone-200 flex items-center justify-center text-lg">👩‍🏫</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-stone-800 truncate">{displayName}</div>
          <div className="text-[11px] text-stone-400 truncate">
            {unitLabel}{pageMd && pageMd.trim() ? ` · 📖 ${t("classroom.page.pageSync")}` : ""}
          </div>
        </div>
        {rootPath && (
          <>
            <button onClick={startNewChat} title={t("classroom.chat.newChat")} aria-label={t("classroom.chat.newChat")}
              className="text-stone-300 hover:text-emerald-600 text-base leading-none px-1 transition-colors">🆕</button>
            <button onClick={() => setShowHistory(v => !v)} title={t("classroom.history.history")} aria-label={t("classroom.history.history")}
              className={`text-base leading-none px-1 transition-colors ${showHistory ? "text-emerald-600" : "text-stone-300 hover:text-emerald-600"}`}>📜</button>
          </>
        )}
        <button onClick={onClose} className="text-stone-300 hover:text-stone-600 text-lg leading-none px-1" aria-label="close">✕</button>
      </div>

      {/* 📜 歷史清單（與訊息區互斥顯示；點擊載入續聊） */}
      {showHistory && rootPath ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2" style={{ scrollbarWidth: "thin" }}>
          <button onClick={() => setShowHistory(false)}
            className="text-xs text-stone-400 hover:text-emerald-600 transition-colors mb-2">← {t("classroom.chat.backToChat")}</button>
          {sessions.length === 0 ? (
            <div className="text-xs text-stone-400 py-8 text-center">{t("classroom.history.historyEmpty")}</div>
          ) : sessions.map(s => (
            <button key={s.id} onClick={() => openSession(s.id)}
              className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                sessionId === s.id ? "border-emerald-300 bg-emerald-50" : "border-stone-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40"
              }`}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-stone-700 truncate flex-1">{s.title || s.id}</span>
                {s.id === "active" && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 text-[10px]">{t("classroom.history.ongoing")}</span>
                )}
              </div>
              <div className="text-[11px] text-stone-400 mt-0.5">
                {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ""}
                {typeof s.messageCount === "number" ? ` · ${s.messageCount} ${t("classroom.chat.msgCount")}` : ""}
              </div>
            </button>
          ))}
        </div>
      ) : (
      <div className="flex-1 min-h-0 flex flex-col">
      {/* messages — 全靠左，與林雨晴 chat 相同結構 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: "thin" }}>
        {msgs.map((m, i) => (
          <MessageRow key={i} msg={m} assistantName={displayName} imageUrl={crew?.imageUrl} />
        ))}
        {live && (
          <MessageRow msg={{ role: "assistant", content: live }} assistantName={displayName} imageUrl={crew?.imageUrl} />
        )}
        {thinking && <ThinkingDots label={t("classroom.chat.thinking")} />}
      </div>

      {/* input — 與助教 chat 同款：📎 📄 + textarea（貼圖支援）+ 送出 */}
      <div className="border-t border-stone-100 bg-white p-3">
        {(pendingImages.length > 0 || pendingFiles.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative">
                <img src={img.dataUrl} alt="" className="w-14 h-14 rounded-lg object-cover border border-stone-200" />
                <button onClick={() => setPendingImages(p => p.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-700 text-white text-[10px] leading-none flex items-center justify-center shadow" title={t("chat.attach.removeImage")}>✕</button>
              </div>
            ))}
            {pendingFiles.map((f, i) => (
              <div key={i} className="relative inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-[11px] text-stone-600">
                📄 {f.name}（{(f.size / 1024).toFixed(0)}KB）
                <button onClick={() => setPendingFiles(p => p.filter((_, j) => j !== i))}
                  className="text-stone-400 hover:text-stone-700" title={t("chat.attach.removeFile")}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { addImages(Array.from(e.target.files || [])); e.target.value = ""; }} />
          <button onClick={() => imageInputRef.current?.click()} disabled={pendingImages.length >= MAX_ATTACH} title={t("chat.attach.attachImage")}
            className="text-xs px-2 py-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:border-stone-300 disabled:opacity-40 shrink-0 bg-stone-50">📎</button>
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={(e) => { addTextFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={pendingFiles.length >= MAX_ATTACH} title={t("chat.attach.attachFile")}
            className="text-xs px-2 py-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:border-stone-300 disabled:opacity-40 shrink-0 bg-stone-50">📄</button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onPaste={async (e) => {
              if (!pasteMayContainImage(e.clipboardData)) return;
              e.preventDefault();
              const files = await extractPasteFiles(e.clipboardData);
              if (files && files.length > 0) { addImages(files); addTextFiles(files); }
            }}
            onKeyDown={onKey}
            rows={2}
            disabled={busy}
            placeholder={crew ? `${t("classroom.chat.askPrefix")}${crew.title}...` : t("classroom.chat.placeholder")}
            className="flex-1 text-sm px-3 py-2 rounded-lg resize-none outline-none border focus:border-blue-400 bg-white disabled:bg-stone-50"
          />
          <button onClick={() => send()} disabled={busy || (!input.trim() && !hasPending)}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 transition-colors disabled:opacity-40">
            {t("classroom.chat.send")}
          </button>
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
