import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "../utils";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import { ChatMessages, type ChatMessageItem, type ChatToolBadge } from "./ChatMessages";

// ── Types ──

interface AgentConsoleProps {
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  initialPrompt?: string;
  restartTrigger?: number;
  onReady?: () => void;
  onDone?: () => void;
  /** Accent color (default: #10b981) */
  accent?: string;
  /** Display name for the assistant label */
  assistantName?: string;
}

export interface AgentConsoleHandle {
  sendPrompt: (text: string, newSystemPrompt?: string) => void;
}

interface AgentEvent {
  type: "tool_start" | "tool_end" | "tool_complete" | "thinking" | "response";
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  content?: string;
}

const WS_PORT = import.meta.env.VITE_PAAW_WS_PORT || (parseInt(window.location.port || "4097", 10) + 1);

// ── Component ──

const AgentConsole = React.forwardRef<AgentConsoleHandle, AgentConsoleProps>(function AgentConsole({
  cwd,
  model,
  systemPrompt,
  initialPrompt,
  restartTrigger,
  onReady,
  onDone,
  accent = "#10b981",
  assistantName = "Agent Builder",
}, ref) {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [currentEvents, setCurrentEvents] = useState<AgentEvent[]>([]);
  const [agentAction, setAgentAction] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  const initialSentRef = useRef(false);
  const busyRef = useRef(false);
  const optsRef = useRef({ cwd, model, systemPrompt, initialPrompt });
  optsRef.current = { cwd, model, systemPrompt, initialPrompt };

  // IME composition tracking
  const composingRef = useRef(false);

  // Scroll to bottom — instant：事件串流頻繁，smooth 動畫會被不斷打斷重啟造成抖動
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [chatMessages, currentEvents]);

  // Expose sendPrompt to parent
  React.useImperativeHandle(ref, () => ({
    sendPrompt: (text: string, newSystemPrompt?: string) => {
      if (!text.trim()) return;
      if (newSystemPrompt && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "set_system_prompt", systemPrompt: newSystemPrompt }));
      }
      sendMessage(text.trim());
    },
  }), []);

  // ── WebSocket message handler (shared between initial connect and restart) ──
  const handleWsMessage = useCallback((msg: any) => {
    if (!mountedRef.current) return;

    switch (msg.type) {
      case "ready": {
        setReady(true);
        // 2026-09-11 resume：記住 session id（斷線重連用）+ 帶回 history 重建對話
        if (msg.sessionId) {
          wsSessionIdRef.current = msg.sessionId;
          try {
            const opts0 = optsRef.current;
            sessionStorage.setItem(`paaw:agent-console:session:${opts0.cwd || "default"}`, msg.sessionId);
          } catch {}
        }
        if (msg.resumed && Array.isArray(msg.history)) {
          // 重連接回：server 帶回最近對話 — 只在本地面比 server 短時重建（補齊斷線期間的訊息）
          setChatMessages(prev => {
            if (msg.history.length > prev.length) {
              return msg.history.map((h: { role: string; content: string }) => ({
                role: h.role as "user" | "assistant",
                content: h.content,
                ts: new Date().toISOString(),
              }));
            }
            return prev;
          });
          // 斷線期間 run 已結束：把最後回覆補上，解除 busy
          if (!msg.busy && busyRef.current) {
            const lastAssistant = [...msg.history].reverse().find((h: { role: string }) => h.role === "assistant");
            if (lastAssistant) {
              setChatMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && last.content === lastAssistant.content) return prev;
                return [...prev, { role: "assistant" as const, content: lastAssistant.content, ts: new Date().toISOString() }];
              });
            }
            setBusy(false); busyRef.current = false; setAgentAction(""); setCurrentEvents([]);
          }
        }
        onReady?.();
        break;
      }
      case "agent_running":
        setBusy(true);
        busyRef.current = true;
        setCurrentEvents([]);
        setAgentAction("執行中");
        break;
      case "agent_event":
        setCurrentEvents(prev => {
          // tool_end: merge with matching tool_start → tool_complete
          if (msg.event === "tool_end" && msg.name) {
            const newEvents = [...prev];
            for (let i = newEvents.length - 1; i >= 0; i--) {
              if (newEvents[i].type === "tool_start" && newEvents[i].name === msg.name) {
                newEvents[i] = { ...newEvents[i], type: "tool_complete", result: msg.result };
                return newEvents;
              }
            }
            return [...newEvents, { type: "tool_complete", name: msg.name, result: msg.result }];
          }
          // thinking event → update agent action
          if (msg.event === "thinking" && msg.content) {
            setAgentAction(msg.content.slice(0, 50));
          } else if (msg.event === "tool_start" && msg.name) {
            setAgentAction(`🔧 ${msg.name}...`);
          }
          return [...prev, {
            type: msg.event,
            name: msg.name,
            args: msg.args,
            result: msg.result,
            content: msg.content,
          }];
        });
        break;
      case "agent_done": {
        setBusy(false);
        busyRef.current = false;
        setAgentAction("");
        const assistantMsg: ChatMessageItem = {
          role: "assistant",
          content: msg.content || "",
          ts: new Date().toISOString(),
        };
        setChatMessages(prev => [...prev, assistantMsg]);
        setCurrentEvents([]);
        if (msg.success !== false) onDone?.();
        break;
      }
      case "agent_busy":
        break;
      case "agent_error":
        setBusy(false);
        busyRef.current = false;
        setAgentAction("");
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `❌ Error: ${msg.message}`,
          ts: new Date().toISOString(),
        }]);
        setCurrentEvents([]);
        break;
      case "cliDone":
        onDone?.();
        break;
      case "exit":
        setReady(false);
        break;
      case "error":
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `❌ ${msg.message}`,
          ts: new Date().toISOString(),
        }]);
        break;
    }
  }, [currentEvents]);

  // ── WebSocket connect + auto-reconnect（2026-09-11 治本：斷線自動重連 + session resume）──
  const wsSessionIdRef = useRef<string | null>(null);      // server session id（resume 用）
  const manualCloseRef = useRef(false);                     // 卸載/手動重啟時不自動重連
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;
    const wsUrl = `ws://${window.location.hostname}:${WS_PORT}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setConnected(true);
      backoffRef.current = 1000; // 連上重置 backoff
      const opts = optsRef.current;
      // resume：帶上原 session id（server 保留 10 分鐘；vite full reload 後 sessionStorage 還拿得到）
      const resumeKey = `paaw:agent-console:session:${opts.cwd || "default"}`;
      const resumeSessionId = wsSessionIdRef.current
        || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem(resumeKey) : null);
      ws.send(JSON.stringify({
        type: "spawn",
        options: {
          engine: "paaw-agent",
          cwd: opts.cwd || undefined,
          model: opts.model || undefined,
          systemPrompt: opts.systemPrompt || undefined,
          ...(resumeSessionId ? { resumeSessionId } : {}),
        },
      }));
    };

    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data as string); } catch { return; }
      handleWsMessage(msg);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      setReady(false);
      if (manualCloseRef.current) return; // 手動關閉/重啟 — 不自動重連
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, 15000);
      reconnectTimerRef.current = setTimeout(connectWs, delay);
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setConnected(false);
    };
  }, [handleWsMessage]);

  // Connect WebSocket
  useEffect(() => {
    mountedRef.current = true;
    manualCloseRef.current = false;
    connectWs();
    return () => {
      mountedRef.current = false;
      manualCloseRef.current = true;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      const ws = wsRef.current;
      if (ws) {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => ws.close();
        } else {
          ws.close();
        }
      }
      wsRef.current = null;
    };
  }, [connectWs]);

  // Auto-send initial prompt
  useEffect(() => {
    if (!ready || !initialPrompt || initialSentRef.current) return;
    initialSentRef.current = true;
    sendMessage(initialPrompt);
  }, [ready, initialPrompt]);

  // Restart trigger
  const prevRestartRef = useRef(restartTrigger);
  useEffect(() => {
    if (restartTrigger === undefined || restartTrigger === prevRestartRef.current) return;
    prevRestartRef.current = restartTrigger;
    restartSession();
  }, [restartTrigger]);

  const restartSession = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "kill" }));
      manualCloseRef.current = true; // 手動重啟：擋掉舊 ws 的 auto-reconnect（server 端 kill 已 drop resumable）
      wsRef.current.close();
      wsRef.current = null;
    }
    setReady(false);
    setConnected(false);
    setBusy(false);
    busyRef.current = false;
    setChatMessages([]);
    setCurrentEvents([]);
    setAgentAction("");
    initialSentRef.current = false;
    // 清 resume 痕跡：重啟 = fresh session，不要接回舊 session
    wsSessionIdRef.current = null;
    try {
      const opts0 = optsRef.current;
      sessionStorage.removeItem(`paaw:agent-console:session:${opts0.cwd || "default"}`);
    } catch {}

    setTimeout(() => {
      if (!mountedRef.current) return;
      manualCloseRef.current = false; // 重新交給 connectWs（含 auto-reconnect + fresh spawn）
      connectWs();
    }, 500);
  }, [connectWs]);

  const sendMessage = useCallback((text: string, images?: string[]) => {
    if ((!text.trim() && !(images?.length)) || busyRef.current) return;
    const display = text.trim() || "請看這張圖";
    const userMsg: ChatMessageItem = {
      role: "user",
      content: display,
      ts: new Date().toISOString(),
      ...(images?.length ? { images } : {}),
    };
    setChatMessages(prev => [...prev, userMsg]);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", text: display, ...(images?.length ? { images } : {}) }));
    }
  }, []);

  // 👁 2026-09-06：貼圖/附圖（跟主 chat 同機制：壓縮 → /api/uploads → agent loop vision 自動路由）
  const { t: tt } = useI18n();
  const [pendingImages, setPendingImages] = useState<{ id: string; dataUrl: string }[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const compressImage = useCallback((file: File) => new Promise<string>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1568; // 長邊 1568px jpeg q80 — vision API 甜蜜點
      let { width, height } = img;
      if (Math.max(width, height) > MAX) {
        const r = MAX / Math.max(width, height);
        width = Math.round(width * r); height = Math.round(height * r);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load fail")); };
    img.src = url;
  }), []);

  const addImages = useCallback(async (files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    const room = 4 - pendingImages.length;
    if (room <= 0) { alert(tt("chat.imageLimit")); return; }
    const results = await Promise.all(imgs.slice(0, room).map(async f => {
      try { return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, dataUrl: await compressImage(f) }; } catch { return null; }
    }));
    setPendingImages(prev => [...prev, ...results.filter((r): r is { id: string; dataUrl: string } => r !== null)]);
  }, [compressImage, pendingImages.length, tt]);

  const handleChatSend = async () => {
    if ((!chatInput.trim() && pendingImages.length === 0) || busy) return;
    let uploadedPaths: string[] = [];
    if (pendingImages.length > 0) {
      const results = await Promise.all(pendingImages.map(async (img) => {
        try {
          const r = await fetch(`${API_BASE}/api/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: img.dataUrl }) });
          const d = await r.json();
          return (d?.ok && d?.path) ? d.path as string : null;
        } catch { return null; }
      }));
      uploadedPaths = results.filter(Boolean) as string[];
    }
    sendMessage(chatInput.trim(), uploadedPaths.length > 0 ? uploadedPaths : undefined);
    setChatInput("");
    setPendingImages([]);
  };

  const handleInterrupt = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
    setBusy(false);
    busyRef.current = false;
    setAgentAction("");
    setChatMessages(prev => [...prev, {
      role: "assistant",
      content: "⏹️ Agent 已中斷。你可以繼續對話來恢復。",
      ts: new Date().toISOString(),
    }]);
    setCurrentEvents([]);
  };

  // ── Live tool badges from current events（useMemo：身分穩定，不打爆 ChatMessages 內部 memo）──
  const liveToolBadges: ChatToolBadge[] = useMemo(() => currentEvents.map(evt => {
    if (evt.type === "tool_start") return { name: evt.name || "tool", status: "running" as const };
    if (evt.type === "tool_complete") return { name: evt.name || "tool", status: "done" as const };
    return { name: evt.name || "tool", status: undefined as any };
  }).filter(b => b.name !== "tool" || b.status), [currentEvents]);

  // ── Live thinking content for the typing indicator ──
  const lastThinking = currentEvents.filter(e => e.type === "thinking").pop()?.content;

  return (
    <div className="flex flex-col h-full bg-white rounded-lg overflow-hidden">

      {/* Chat messages — reuse ChatMessages component for consistent look */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {chatMessages.length === 0 && !busy ? (
          <div className="flex items-center justify-center h-full text-stone-400">
            <div className="text-center">
              <div className="text-4xl mb-2">🤖</div>
              <div className="font-medium text-stone-500">{assistantName}</div>
              <div className="text-sm mt-1">輸入訊息開始對話</div>
            </div>
          </div>
        ) : (
          <ChatMessages
            messages={chatMessages}
            accent={accent}
            accentHover={accent}
            assistantName={assistantName}
            userName="你"
            assistantEmoji="🤖"
            loading={busy}
            agentAction={agentAction}
            activeTools={liveToolBadges}
            endRef={messagesEndRef}
            className="px-4 py-4"
          />
        )}

        {/* Live thinking content while agent is running */}
        {busy && lastThinking && (
          <div className="px-6 pb-2">
            <div className="flex items-center gap-1.5 text-xs text-stone-400 italic">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accent }} />
              {lastThinking.slice(0, 120)}
            </div>
          </div>
        )}
      </div>

      {/* Input bar — matches Coding app style */}
      <div className="shrink-0 px-4 py-2.5 border-t" style={{ borderColor: "#e7e5e4", backgroundColor: "#fafaf9" }}>
        {pendingImages.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {pendingImages.map(img => (
              <div key={img.id} className="relative group">
                <img src={img.dataUrl} alt="pending" className="w-14 h-14 object-cover rounded-lg border border-stone-200" />
                <button
                  onClick={() => setPendingImages(prev => prev.filter(p => p.id !== img.id))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-600 text-white text-xs leading-none hidden group-hover:flex items-center justify-center"
                  title="移除">✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addImages(Array.from(e.target.files || [])); e.target.value = ""; }} />
          <button onClick={() => imageInputRef.current?.click()} disabled={pendingImages.length >= 4} title={tt("chat.attachImage")}
            className="text-xs px-2 py-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:border-stone-300 disabled:opacity-40 shrink-0 bg-stone-50">📎</button>
          <textarea
            ref={inputRef}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={e => {
              if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleChatSend();
              }
            }}
            onPaste={(e) => { const files = Array.from(e.clipboardData?.files || []); if (files.length > 0) { e.preventDefault(); addImages(files); } }}
            placeholder={busy ? "Agent 正在思考..." : "輸入訊息..."}
            disabled={!connected || !ready}
            rows={2}
            className="flex-1 text-sm px-3 py-2 rounded-lg resize-none outline-none border focus:border-blue-400"
            style={{ borderColor: "#d6d3d1", backgroundColor: "white" }}
          />
          {busy && (
            <button
              onClick={handleInterrupt}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors shrink-0"
              title="中斷"
            >
              中斷
            </button>
          )}
          <button
            onClick={handleChatSend}
            disabled={busy || !chatInput.trim() || !connected || !ready}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40 transition-colors shrink-0"
            style={{ backgroundColor: busy ? '#a1a1aa' : accent }}
          >
            送出
          </button>
        </div>
        {/* Status bar */}
        <div className="flex items-center justify-between mt-1.5 px-1">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "w-2 h-2 rounded-full shrink-0",
              connected && ready ? "bg-emerald-500" : connected ? "bg-yellow-500 animate-pulse" : "bg-red-500"
            )} />
            <span className="text-[10px] text-stone-400">
              {connected && ready ? "Ready" : connected ? "Connecting..." : "Disconnected"}
            </span>
          </div>
          <button
            onClick={restartSession}
            className="px-2 py-0.5 rounded text-[10px] font-medium text-stone-400 hover:text-stone-600 transition-colors border border-stone-200 hover:border-stone-300"
            title="Restart session"
          >
            ↻ Restart
          </button>
        </div>
      </div>
    </div>
  );
});

export default AgentConsole;
