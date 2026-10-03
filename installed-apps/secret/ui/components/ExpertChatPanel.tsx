/**
 * ExpertChatPanel — 秘書專家對話面板
 * 通道：POST /a2a/{agentId}（jsonrpc message/stream → SSE）— 同 TeacherChatPanel 契約
 * v1 不做對話持久化：秘書哲學是「落檔才是事實」，對話即時、紀錄進 dossiers。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import MarkdownText from "@paaw-ui/components/MarkdownText";

type Msg = { role: "user" | "assistant"; content: string; ts?: string };
type CrewInfo = { id: string; title: string; codename?: string; imageUrl?: string; chatConfig?: { greeting?: string } };

export default function ExpertChatPanel({ agentId, placeholder }: { agentId: string; placeholder?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("");
  const [thinking, setThinking] = useState(false);
  const [crew, setCrew] = useState<CrewInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false); // IME 三層保護（TOOLS.md 鐵律）

  useEffect(() => {
    setMsgs([]); setCrew(null);
    let cancelled = false;
    fetch(`/api/crew/${encodeURIComponent(agentId)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: CrewInfo) => {
        if (cancelled) return;
        setCrew(d);
        const g = d.chatConfig?.greeting;
        if (g) setMsgs([{ role: "assistant", content: g, ts: new Date().toISOString() }]);
      })
      .catch(() => setCrew({ id: agentId, title: agentId }));
    return () => { cancelled = true; };
  }, [agentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, live, thinking]);

  const send = useCallback(async (text?: string) => {
    const sendText = (text ?? input).trim();
    if (!sendText || busy) return;
    setInput("");
    setMsgs(m => [...m, { role: "user", content: sendText, ts: new Date().toISOString() }]);
    setBusy(true); setThinking(true);
    try {
      const res = await fetch(`/a2a/${encodeURIComponent(agentId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: { role: "user", parts: [{ type: "text", text: sendText }] },
            ...(msgs.length > 0 ? { conversationHistory: msgs.slice(-12).map(({ role, content }) => ({ role, content })) } : {}),
          },
          id: `sec-${Date.now()}`,
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
      setMsgs(m => [...m, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setBusy(false); setThinking(false); setLive("");
    }
  }, [agentId, input, busy, msgs]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const name = crew ? (crew.codename ? `${crew.title} · ${crew.codename}` : crew.title) : "…";

  return (
    <div className="w-full h-full flex flex-col bg-stone-50 min-w-0">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 bg-white shrink-0">
        <div className="w-9 h-9 rounded-full bg-white border border-stone-200 flex items-center justify-center text-lg">🕴️</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-stone-800 truncate">{name}</div>
          <div className="text-[11px] text-stone-400 truncate">{agentId}</div>
        </div>
      </div>

      {/* 訊息流 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: "thin" }}>
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-stone-800 text-white" : "bg-white border border-stone-200 text-stone-800"}`}>
              {m.role === "assistant" ? <MarkdownText>{m.content}</MarkdownText> : <span className="whitespace-pre-wrap">{m.content}</span>}
            </div>
          </div>
        ))}
        {live && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm bg-white border border-stone-200 text-stone-800">
              <MarkdownText>{live}</MarkdownText>
            </div>
          </div>
        )}
        {thinking && <div className="text-xs text-stone-400 px-2">💭 {busy ? "思考中…" : ""}</div>}
      </div>

      {/* 輸入 */}
      <div className="border-t border-stone-100 bg-white p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={onKey}
            rows={2}
            placeholder={placeholder || "跟專家說…（Enter 送出 / Shift+Enter 換行）"}
            className="flex-1 resize-none rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-stone-400 bg-stone-50"
          />
          <button
            onClick={() => send()}
            disabled={busy || !input.trim()}
            className="rounded-xl bg-stone-800 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40 hover:bg-stone-700 transition-colors"
          >送出</button>
        </div>
      </div>
    </div>
  );
}
