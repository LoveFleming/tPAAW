/**
 * PAAW HelpDesk — Built-in Customer Service Page
 *
 * 接收其他 Agent 的提問，顯示即時對話與歷史紀錄
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import API from "../api";
import { cn } from "../utils";

// ── Types ──
interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "agent";
  text: string;
  ts: number;
}

interface Ticket {
  ticketId: string;
  agentName: string;
  agentType: string;
  subject: string;
  status: "open" | "working" | "input-required" | "answered" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  messages: Message[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const AGENT_COLORS: Record<string, string> = {
  openclaw: "#ff6b6b",
  claude: "#d97757",
  chatgpt: "#10a37f",
  gemini: "#4285f4",
  copilot: "#0078d4",
  custom: "#a78bfa",
  human: "#4ade80",
};

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  open: { bg: "rgba(251,191,36,0.12)", color: "#fbbf24", label: "待回" },
  working: { bg: "rgba(74,158,255,0.12)", color: "#4a9eff", label: "處理中" },
  "input-required": { bg: "rgba(168,85,247,0.12)", color: "#a855f7", label: "需補充" },
  answered: { bg: "rgba(74,222,128,0.12)", color: "#4ade80", label: "已回" },
  closed: { bg: "rgba(107,114,128,0.12)", color: "#9ca3af", label: "已關閉" },
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#f87171",
  high: "#fbbf24",
  medium: "#4a9eff",
  low: "#9ca3af",
};

function formatTime(ts: string | number | undefined): string {
  if (!ts) return "";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "剛剛";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小時前`;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

function escHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

// ── A2A Task Detail Component ──
function A2aTaskDetail({ task, theme, formatTime }: { task: any; theme: any; formatTime: (t: string) => string }) {
  if (!task) return <div className="text-center py-10 text-sm" style={{ color: "#6a6a6a" }}>載入中...</div>;
  return (
    <div className="flex flex-col gap-4">
      {/* Task Info */}
      <div className="rounded-xl p-4" style={{ background: "#1a1a1a", border: "1px solid #2e2e2e" }}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div style={{ color: "#6a6a6a" }}>Task ID</div>
          <div className="font-mono" style={{ color: "#a0a0a0" }}>{task.id}</div>
          <div style={{ color: "#6a6a6a" }}>Context ID</div>
          <div className="font-mono" style={{ color: "#a0a0a0" }}>{task.contextId || "—"}</div>
          <div style={{ color: "#6a6a6a" }}>State</div>
          <div style={{ color: task.status?.state === "completed" ? "#4ade80" : "#4a9eff" }}>{task.status?.state}</div>
          <div style={{ color: "#6a6a6a" }}>Timestamp</div>
          <div style={{ color: "#a0a0a0" }}>{task.status?.timestamp ? formatTime(task.status.timestamp) : "—"}</div>
          {task.metadata?.toolsUsed?.length > 0 && (
            <>
              <div style={{ color: "#6a6a6a" }}>Tools Used</div>
              <div className="flex flex-wrap gap-1">
                {task.metadata.toolsUsed.map((tool: string, i: number) => (
                  <span key={i} className="px-2 py-0.5 rounded text-[10px]" style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}>{tool}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Conversation History */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "#a0a0a0" }}>💬 互動訊息</div>
        {(task.history || []).map((msg: any, i: number) => {
          const text = msg.parts?.map((p: any) => p.text).join("") || "";
          const isUser = msg.role === "user";
          const isAgent = msg.role === "agent";
          return (
            <div key={i} className="mb-3 flex justify-start">
              <div className={cn("max-w-[75%] flex flex-col gap-1")}>
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "#6a6a6a" }}>
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: isUser ? "#4a9eff" : "#4ade80" }} />
                  <span className="font-semibold">{isUser ? "📡 Agent Orchestrator" : "🎧 PAAW HelpDesk"}</span>
                </div>
                <div
                  className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5"
                  style={{
                    background: isUser ? "#252525" : theme.accent,
                    color: isAgent ? "#fff" : "#e8e8e8",
                    borderBottomLeftRadius: isUser ? 4 : undefined,
                    borderBottomRightRadius: isAgent ? 4 : undefined,
                    border: isUser ? "1px solid #2e2e2e" : "none",
                  }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{text}</ReactMarkdown>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Artifacts */}
      {task.artifacts && task.artifacts.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "#a0a0a0" }}>📦 Artifacts</div>
          {task.artifacts.map((art: any, i: number) => (
            <div key={i} className="rounded-xl p-3 mb-1" style={{ background: "#1a1a1a", border: "1px solid #2e2e2e" }}>
              <div className="text-xs font-semibold mb-1" style={{ color: "#4ade80" }}>{art.name || `Artifact ${i + 1}`}</div>
              <div className="text-xs prose prose-invert prose-sm max-w-none prose-p:my-0.5 prose-headings:my-1" style={{ color: "#a0a0a0" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{art.parts?.map((p: any) => p.text).join("") || ""}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Raw JSON */}
      <details>
        <summary className="text-xs font-semibold cursor-pointer" style={{ color: "#6a6a6a" }}>🔧 Raw JSON</summary>
        <pre className="mt-2 p-3 rounded-xl text-[10px] overflow-x-auto" style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#a0a0a0" }}>
          {JSON.stringify(task, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function HelpDesk({ active = true }: { active?: boolean }) {
  const { info: theme } = useTheme();
  const { t: tt } = useI18n();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [replyText, setReplyText] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const composingRef = useRef(false);
  const chatAreaRef = useRef<HTMLDivElement>(null);

  // A2A state
  const [viewMode, setViewMode] = useState<"tickets" | "a2a">("tickets");
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [a2aTasks, setA2aTasks] = useState<any[]>([]);
  const [a2aLoading, setA2aLoading] = useState(false);
  const [a2aTabs, setA2aTabs] = useState<{ id: string; task: any }[]>([]);
  const [activeA2aTabId, setActiveA2aTabId] = useState<string>("main"); // "main" or task.id

  // New ticket form
  const [fAgentName, setFAgentName] = useState("");
  const [fAgentType, setFAgentType] = useState("openclaw");
  const [fSubject, setFSubject] = useState("");
  const [fPriority, setFPriority] = useState("medium");
  const [fMessage, setFMessage] = useState("");
  const [fTags, setFTags] = useState("");

  // ── Load ──
  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/helpdesk/tickets`);
      const data = await res.json();
      const list = data.tickets || [];
      // For active ticket, get full messages
      if (activeId) {
        const full = await fetch(`${API}/api/helpdesk/ticket/${activeId}`);
        if (full.ok) {
          const fullData = await full.json();
          const idx = list.findIndex((t: any) => t.ticketId === activeId);
          if (idx >= 0) list[idx] = fullData;
        }
      }
      setTickets(list);
    } catch (err) {
      console.error("Load tickets error:", err);
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    if (!active) return;
    loadTickets();
    const timer = setInterval(loadTickets, 10000);
    return () => clearInterval(timer);
  }, [active, loadTickets]);

  // ── Load Models ──
  useEffect(() => {
    fetch(`${API}/api/helpdesk/models`)
      .then(res => res.json())
      .then(data => {
        setAvailableModels(data.models || []);
        setSelectedModel(data.defaultModel || "");
      })
      .catch(() => {});
  }, []);

  // ── Load A2A Tasks ──
  const loadA2aTasks = useCallback(async () => {
    setA2aLoading(true);
    try {
      const res = await fetch(`${API}/api/a2a/tasks`);
      if (res.ok) {
        const data = await res.json();
        const tasks = data.data || [];
        setA2aTasks(tasks);
        // Sync open tabs with latest task data
        setA2aTabs(prev => prev.map(t => {
          const updated = tasks.find((task: any) => task.id === t.id);
          return updated ? { ...t, task: updated } : t;
        }));
      }
    } catch (err) {
      console.error("Load A2A tasks error:", err);
    } finally {
      setA2aLoading(false);
    }
  }, []);

  const openA2aTab = useCallback((task: any) => {
    setA2aTabs(prev => {
      if (prev.find(t => t.id === task.id)) return prev;
      return [...prev, { id: task.id, task }];
    });
    setActiveA2aTabId(task.id);
  }, []);

  const closeA2aTab = useCallback((tabId: string) => {
    setA2aTabs(prev => prev.filter(t => t.id !== tabId));
    setActiveA2aTabId(prev => prev === tabId ? "main" : prev);
  }, []);

  useEffect(() => {
    if (!active || viewMode !== "a2a") return;
    loadA2aTasks();
    const timer = setInterval(loadA2aTasks, 5000);
    return () => clearInterval(timer);
  }, [active, viewMode, loadA2aTasks]);

  // ── Active ticket with full messages ──
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);

  const selectTicket = useCallback(async (ticketId: string) => {
    setActiveId(ticketId);
    try {
      const res = await fetch(`${API}/api/helpdesk/ticket/${ticketId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveTicket(data);
      }
    } catch (err) {
      console.error("Failed to load ticket:", err);
    }
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [activeTicket?.messages?.length]);

  // ── Stats ──
  const stats = {
    open: tickets.filter((t) => t.status === "open" || t.status === "input-required").length,
    working: tickets.filter((t) => t.status === "working").length,
    answered: tickets.filter((t) => t.status === "answered").length,
    total: tickets.length,
  };

  // ── Filtered list ──
  const filtered = tickets
    .filter((t) => {
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return (
        (t.subject || "").toLowerCase().includes(q) ||
        (t.agentName || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (a.status === "open" && b.status !== "open") return -1;
      if (a.status !== "open" && b.status === "open") return 1;
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });

  // ── Actions ──
  const sendReply = useCallback(async () => {
    if (!replyText.trim() || !activeId) return;
    const ticket = tickets.find((t) => t.ticketId === activeId);
    if (!ticket) return;

    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      role: "assistant",
      text: replyText.trim(),
      ts: Date.now(),
    };

    const updated = {
      ...ticket,
      messages: [...(ticket.messages || []), newMsg],
      status: "answered" as const,
      updatedAt: new Date().toISOString(),
    };

    // Optimistic update
    setActiveTicket(updated);
    setTickets((prev) =>
      prev.map((t) => (t.ticketId === activeId ? updated : t))
    );
    setReplyText("");

    // Save via PUT
    try {
      const allRes = await fetch(`${API}/api/helpdesk/tickets`);
      const allData = await allRes.json();
      const all: Ticket[] = allData.tickets || [];
      const idx = all.findIndex((t) => t.ticketId === activeId);
      if (idx >= 0) {
        all[idx] = updated;
        await fetch(`${API}/api/helpdesk/tickets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(all),
        });
      }
      setToast("✅ 回覆已送出");
      setTimeout(() => setToast(null), 2500);
    } catch (err) {
      console.error("Save reply error:", err);
    }
  }, [replyText, activeId, tickets]);

  const changeStatus = useCallback(async (ticketId: string, status: Ticket["status"]) => {
    const ticket = tickets.find((t) => t.ticketId === ticketId);
    if (!ticket) return;
    const updated = { ...ticket, status, updatedAt: new Date().toISOString() };
    setTickets((prev) => prev.map((t) => (t.ticketId === ticketId ? updated : t)));
    if (activeId === ticketId) setActiveTicket(updated);
    // Save
    try {
      const allRes = await fetch(`${API}/api/helpdesk/tickets`);
      const allData = await allRes.json();
      const all: Ticket[] = allData.tickets || [];
      const idx = all.findIndex((t) => t.ticketId === ticketId);
      if (idx >= 0) {
        all[idx] = updated;
        await fetch(`${API}/api/helpdesk/tickets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(all),
        });
      }
    } catch (err) {
      console.error("Save status error:", err);
    }
  }, [tickets, activeId]);

  const deleteTicket = useCallback(async (ticketId: string) => {
    if (!confirm("確定刪除這個對話？此操作無法復原。")) return;
    setTickets((prev) => prev.filter((t) => t.ticketId !== ticketId));
    if (activeId === ticketId) {
      setActiveId(null);
      setActiveTicket(null);
    }
    try {
      const allRes = await fetch(`${API}/api/helpdesk/tickets`);
      const allData = await allRes.json();
      const all: Ticket[] = allData.tickets || [];
      const filtered = all.filter((t) => t.ticketId !== ticketId);
      await fetch(`${API}/api/helpdesk/tickets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filtered),
      });
      setToast("🗑 已刪除");
      setTimeout(() => setToast(null), 2500);
    } catch (err) {
      console.error("Delete error:", err);
    }
  }, [activeId]);

  const createTicket = useCallback(async () => {
    if (!fAgentName.trim() || !fSubject.trim() || !fMessage.trim()) {
      alert("請填寫 Agent 名稱、主旨和問題內容");
      return;
    }
    try {
      const res = await fetch(`${API}/api/helpdesk/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: fAgentName.trim(),
          agentType: fAgentType,
          subject: fSubject.trim(),
          priority: fPriority,
          message: fMessage.trim(),
          tags: fTags.trim() ? fTags.split(",").map((s) => s.trim()).filter(Boolean) : [],
          ...(selectedModel ? { model: selectedModel } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowNewModal(false);
        setFAgentName(""); setFSubject(""); setFMessage(""); setFTags("");
        await loadTickets();
        if (data.ticketId) selectTicket(data.ticketId);
        setToast("✅ 問題已建立");
        setTimeout(() => setToast(null), 2500);
      }
    } catch (err) {
      console.error("Create ticket error:", err);
    }
  }, [fAgentName, fAgentType, fSubject, fPriority, fMessage, fTags, loadTickets, selectTicket]);

  // ── Render ──
  return (
    <div className="flex h-full w-full overflow-hidden" style={{ backgroundColor: "#0f0f0f", color: "#e8e8e8" }}>
      {/* ── Sidebar: Ticket List ── */}
      <div className="flex flex-col border-r" style={{ width: 300, minWidth: 300, backgroundColor: "#1a1a1a", borderColor: "#2e2e2e" }}>
        {/* Header */}
        <div className="p-4 border-b" style={{ borderColor: "#2e2e2e" }}>
          <h1 className="text-lg font-bold flex items-center gap-2">🎧 PAAW HelpDesk</h1>
          {/* View Tabs */}
          <div className="flex gap-1 mt-3">
            <button onClick={() => setViewMode("tickets")}
              className={cn("px-2.5 py-1 rounded-full text-xs font-semibold transition-colors",
                viewMode === "tickets" ? "bg-blue-500 text-white" : "text-stone-400 hover:bg-stone-700")}>
              🎫 Tickets
            </button>
            <button onClick={() => setViewMode("a2a")}
              className={cn("px-2.5 py-1 rounded-full text-xs font-semibold transition-colors",
                viewMode === "a2a" ? "bg-purple-500 text-white" : "text-stone-400 hover:bg-stone-700")}>
              🤖 A2A
            </button>
          </div>
          {viewMode === "tickets" && (
            <div className="flex gap-3 mt-3">
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24" }}>
                待回 {stats.open}
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "rgba(74,158,255,0.12)", color: "#4a9eff" }}>
                處理中 {stats.working}
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "rgba(74,222,128,0.12)", color: "#4ade80" }}>
                已回 {stats.answered}
              </span>
            </div>
          )}
          {viewMode === "a2a" && (
            <div className="flex gap-3 mt-3">
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}>
                A2A {a2aTasks.length}
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "rgba(74,222,128,0.12)", color: "#4ade80" }}>
                完成 {a2aTasks.filter(t => t.status?.state === "completed").length}
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "rgba(74,158,255,0.12)", color: "#4a9eff" }}>
                處理中 {a2aTasks.filter(t => t.status?.state === "working").length}
              </span>
            </div>
          )}
        </div>

        {/* Search */}
        {viewMode === "tickets" && (
        <div className="px-4 py-3 border-b" style={{ borderColor: "#2e2e2e" }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="🔍 搜尋對話..."
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#e8e8e8" }}
          />
        </div>
        )}

        {/* Model Selector */}
        {availableModels.length > 0 && (
          <div className="px-4 py-2 border-t" style={{ borderColor: "#2e2e2e" }}>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full px-2 py-1 rounded text-xs outline-none"
              style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#e8e8e8" }}
            >
              {availableModels.map((m: any) => (
                <option key={`${m.provider}/${m.id}`} value={m.id}>
                  {m.providerName} · {m.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Ticket List / A2A Task List */}
        <div className="flex-1 overflow-y-auto p-2" style={{ scrollbarWidth: "thin" }}>
          {viewMode === "a2a" ? (
            // ── A2A Task List ──
            a2aLoading && a2aTasks.length === 0 ? (
              <div className="text-center py-10 text-sm" style={{ color: "#6a6a6a" }}>載入中...</div>
            ) : a2aTasks.length === 0 ? (
              <div className="text-center py-10 text-sm" style={{ color: "#6a6a6a" }}>
                🤖 尚無 A2A 互動
              </div>
            ) : (
              a2aTasks.map((task) => {
                const userText = task.history?.find((h: any) => h.role === "user")?.parts?.map((p: any) => p.text).join("") || "";
                const agentText = task.history?.find((h: any) => h.role === "agent")?.parts?.map((p: any) => p.text).join("") || "";
                const state = task.status?.state || "unknown";
                const stateColors: Record<string, string> = {
                  completed: "#4ade80", working: "#4a9eff", "input-required": "#a855f7",
                  failed: "#f87171", canceled: "#9ca3af",
                };
                return (
                  <div
                    key={task.id}
                    onClick={() => openA2aTab(task)}
                    className={cn("p-3 rounded-lg cursor-pointer mb-1 border transition-all")}
                    style={{
                      background: activeA2aTabId === task.id ? "rgba(168,85,247,0.1)" : "transparent",
                      borderColor: activeA2aTabId === task.id ? "#a855f7" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (activeA2aTabId !== task.id) e.currentTarget.style.background = "#2a2a2a"; }}
                    onMouseLeave={(e) => { if (activeA2aTabId !== task.id) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#a0a0a0" }}>
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: stateColors[state] || "#6a6a6a" }} />
                        📡 {task.id.split("-").pop()}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase" style={{ background: `rgba(${state === "completed" ? "74,222,128" : state === "working" ? "74,158,255" : "168,85,247"},0.12)`, color: stateColors[state] || "#6a6a6a" }}>
                        {state}
                      </span>
                    </div>
                    <div className="text-sm font-medium truncate" style={{ color: "#e8e8e8" }}>{userText.slice(0, 50) || "(empty)"}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: "#6a6a6a" }}>
                      {(task.history?.length || 0)} 訊息 · {task.metadata?.toolsUsed?.length || 0} 工具
                    </div>
                  </div>
                );
              })
            )
          ) : (
            // ── Original Ticket List ──
            loading ? (
            <div className="text-center py-10 text-sm" style={{ color: "#6a6a6a" }}>載入中...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: "#6a6a6a" }}>
              {tickets.length === 0 ? "📭 尚無客服對話" : "🔍 沒有匹配的對話"}
            </div>
          ) : (
            filtered.map((t) => (
              <div
                key={t.ticketId}
                onClick={() => selectTicket(t.ticketId)}
                className={cn("p-3 rounded-lg cursor-pointer mb-1 border transition-all")}
                style={{
                  background: activeId === t.ticketId ? "rgba(74,158,255,0.1)" : "transparent",
                  borderColor: activeId === t.ticketId ? "#4a9eff" : "transparent",
                }}
                onMouseEnter={(e) => { if (activeId !== t.ticketId) e.currentTarget.style.background = "#2a2a2a"; }}
                onMouseLeave={(e) => { if (activeId !== t.ticketId) e.currentTarget.style.background = "transparent"; }}
              >
                {/* Agent + Status */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#a0a0a0" }}>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: AGENT_COLORS[t.agentType] || AGENT_COLORS.custom }} />
                    {t.agentName}
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase" style={{ background: STATUS_STYLES[t.status]?.bg, color: STATUS_STYLES[t.status]?.color }}>
                    {STATUS_STYLES[t.status]?.label || t.status}
                  </span>
                </div>
                {/* Subject */}
                <div className="text-sm font-medium truncate" style={{ color: "#e8e8e8" }}>{t.subject}</div>
                {/* Meta */}
                <div className="flex items-center justify-between mt-1 text-[11px]" style={{ color: "#6a6a6a" }}>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.low }} />
                    {(t.messages?.length || 0)} 則
                  </span>
                  <span>{formatTime(t.updatedAt || t.createdAt)}</span>
                </div>
              </div>
            ))
          )
          )}
        </div>
      </div>

      {/* ── Main: Chat View / A2A Detail ── */}
      <div className="flex-1 flex flex-col">
        {viewMode === "a2a" ? (
          /* ── A2A Tabbed Interface ── */
          <>
            {/* A2A Tab Bar */}
            <div className="flex items-center gap-0.5 px-2 pt-1.5 border-b overflow-x-auto" style={{ background: "#1a1a1a", borderColor: "#2e2e2e", scrollbarWidth: "thin" }}>
              {/* Main tab */}
              <button
                onClick={() => setActiveA2aTabId("main")}
                className={cn("px-3 py-2 rounded-t-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5",
                  activeA2aTabId === "main" ? "bg-[#0f0f0f]" : "text-stone-400 hover:bg-stone-800")}
                style={activeA2aTabId === "main" ? { color: "#a855f7", borderBottom: "2px solid #a855f7" } : {}}
              >
                🏠 A2A Main
              </button>
              {/* Task tabs */}
              {a2aTabs.map(tab => (
                <div
                  key={tab.id}
                  className={cn("group flex items-center gap-1 px-3 py-2 rounded-t-lg text-xs font-medium whitespace-nowrap transition-colors",
                    activeA2aTabId === tab.id ? "bg-[#0f0f0f]" : "text-stone-400 hover:bg-stone-800")}
                  style={activeA2aTabId === tab.id ? { color: "#e8e8e8", borderBottom: "2px solid #a855f7" } : {}}
                >
                  <button onClick={() => setActiveA2aTabId(tab.id)} className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tab.task.status?.state === "completed" ? "#4ade80" : "#4a9eff" }} />
                    {tab.id.split("-").pop()}
                  </button>
                  <button onClick={() => closeA2aTab(tab.id)} className="opacity-0 group-hover:opacity-100 text-stone-500 hover:text-red-400 ml-0.5">✕</button>
                </div>
              ))}
            </div>

            {/* A2A Content */}
            <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: "thin" }}>
              {activeA2aTabId === "main" ? (
                /* ── Main: A2A Session Log Window ── */
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-base font-semibold">📡 A2A Session Log</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}>
                      {a2aTasks.length} sessions
                    </span>
                  </div>
                  {a2aTasks.length === 0 ? (
                    <div className="text-center py-16 text-sm" style={{ color: "#6a6a6a" }}>尚無 A2A 互動記錄</div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {a2aTasks.map((task) => {
                        const userText = task.history?.find((h: any) => h.role === "user")?.parts?.map((p: any) => p.text).join("") || "";
                        const agentText = task.history?.find((h: any) => h.role === "agent")?.parts?.map((p: any) => p.text).join("") || "";
                        const state = task.status?.state || "unknown";
                        const stateColors: Record<string, string> = {
                          completed: "#4ade80", working: "#4a9eff", "input-required": "#a855f7",
                          failed: "#f87171", canceled: "#9ca3af",
                        };
                        const toolCount = task.metadata?.toolsUsed?.length || 0;
                        const msgCount = task.history?.length || 0;
                        const ts = task.status?.timestamp;
                        return (
                          <div
                            key={task.id}
                            onClick={() => openA2aTab(task)}
                            className="px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-stone-800 flex items-center gap-3"
                            style={{ border: "1px solid #2e2e2e", background: "#1a1a1a" }}
                          >
                            {/* Status dot */}
                            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: stateColors[state] || "#6a6a6a" }} />
                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate" style={{ color: "#e8e8e8" }}>
                                {userText || "(empty)"}
                              </div>
                              <div className="text-[11px] truncate" style={{ color: "#6a6a6a" }}>
                                {agentText.slice(0, 100) || "..."}
                              </div>
                            </div>
                            {/* Meta */}
                            <div className="flex items-center gap-2 flex-shrink-0 text-[10px]" style={{ color: "#6a6a6a" }}>
                              {toolCount > 0 && <span>🔧 {toolCount}</span>}
                              <span>💬 {msgCount}</span>
                              {ts && <span>{formatTime(ts)}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* ── Task Detail Tab ── */
                <A2aTaskDetail task={a2aTabs.find(t => t.id === activeA2aTabId)?.task} theme={theme} formatTime={formatTime} />
              )}
            </div>
          </>
        ) : (
        <>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ background: "#1a1a1a", borderColor: "#2e2e2e" }}>
          <div>
            <h2 className="text-base font-semibold">{activeTicket?.subject || "選擇一個對話或建立新問題"}</h2>
            {activeTicket && (
              <div className="text-xs mt-0.5" style={{ color: "#6a6a6a" }}>
                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: AGENT_COLORS[activeTicket.agentType] || AGENT_COLORS.custom, verticalAlign: "middle" }} />
                {activeTicket.agentName} · {activeTicket.agentType} · {activeTicket.messages?.length || 0} 則訊息 · 建立於 {formatTime(activeTicket.createdAt)}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowNewModal(true)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
              style={{ background: theme.accent }}
            >
              ➕ 新問題
            </button>
            {activeTicket && activeTicket.status !== "closed" && (
              <>
                <button
                  onClick={() => changeStatus(activeTicket.ticketId, activeTicket.status === "answered" ? "open" : "answered")}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: "#252525", border: "1px solid #3a3a3a", color: "#e8e8e8" }}
                >
                  {activeTicket.status === "answered" ? "🔄 重開" : "✅ 已回答"}
                </button>
                <button
                  onClick={() => changeStatus(activeTicket.ticketId, "closed")}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: "#252525", border: "1px solid #3a3a3a", color: "#e8e8e8" }}
                >
                  🔒 關閉
                </button>
              </>
            )}
            {activeTicket && (
              <button
                onClick={() => deleteTicket(activeTicket.ticketId)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" }}
              >
                🗑 刪除
              </button>
            )}
          </div>
        </div>

        {/* Tags */}
        {activeTicket && activeTicket.tags && activeTicket.tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap px-5 py-2.5">
            {activeTicket.tags.map((tag, i) => (
              <span key={i} className="px-2.5 py-0.5 rounded-full text-[11px] font-medium" style={{ background: "#252525", color: "#a0a0a0", border: "1px solid #2e2e2e" }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Chat Area */}
        <div ref={chatAreaRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-3" style={{ scrollbarWidth: "thin" }}>
          {!activeTicket ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: "#6a6a6a" }}>
              <span className="text-5xl">🎧</span>
              <h3 className="text-lg font-semibold" style={{ color: "#a0a0a0" }}>PAAW 客戶服務中心</h3>
              <p className="text-sm text-center max-w-md leading-relaxed">
                這裡是 PAAW 的客服中心，其他 Agent 可以透過 API 提問，<br />
                所有對話紀錄都會顯示在這裡。點左邊的對話查看詳情，或建立新問題。
              </p>
              {/* API Usage */}
              <div className="mt-4 p-4 rounded-xl text-xs font-mono max-w-lg" style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#a0a0a0" }}>
                <div className="font-sans font-semibold mb-2" style={{ color: "#4a9eff" }}>📡 外部 Agent API</div>
                <div>POST /api/helpdesk/ask — 提交問題</div>
                <div>GET /api/helpdesk/tickets — 列出票</div>
                <div>GET /api/helpdesk/ticket/:id — 查單一票</div>
                <div>POST /api/helpdesk/ticket/:id/reply — 補充</div>
                <div>GET /api/helpdesk/knowledge — 知識庫</div>
              </div>
            </div>
          ) : (activeTicket.messages?.length === 0 ? (
            <div className="flex-1 flex items-center justify-center" style={{ color: "#6a6a6a" }}>此對話尚無訊息</div>
          ) : (
            activeTicket.messages.map((m, msgIdx) => {
              const userRounds = activeTicket.messages.filter(mm => mm.role === "user").length;
              const thisUserRound = activeTicket.messages.slice(0, msgIdx + 1).filter(mm => mm.role === "user").length;
              const isAgent = m.role === "assistant" || m.role === "agent";
              return (
                <div
                  key={m.id}
                  className={cn("max-w-[80%] flex flex-col gap-1 self-start items-start")}
                >
                  {/* Round badge for multi-turn */}
                  {m.role === "user" && userRounds > 1 && (
                    <div className="text-[10px] font-bold px-2 py-0.5 rounded-full self-start" style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}>
                      第 {thisUserRound} 輪提問
                    </div>
                  )}
                  {isAgent && userRounds > 1 && (
                    <div className="text-[10px] font-bold px-2 py-0.5 rounded-full self-start" style={{ background: "rgba(74,222,128,0.12)", color: "#4ade80" }}>
                      第 {thisUserRound} 輪回答
                    </div>
                  )}
                  <div
                    className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5"
                    style={{
                      background: m.role === "user" ? "#252525" : isAgent ? theme.accent : "#1e1e1e",
                      color: isAgent ? "#fff" : m.role === "system" ? "#a0a0a0" : "#e8e8e8",
                      border: !isAgent ? "1px solid #2e2e2e" : "none",
                      borderBottomLeftRadius: m.role === "user" ? 4 : undefined,
                      borderBottomRightRadius: isAgent ? 4 : undefined,
                      fontStyle: m.role === "system" ? "italic" : "normal",
                      fontSize: m.role === "system" ? 12 : 14,
                    }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{m.text}</ReactMarkdown>
                  </div>
                  <div className="text-[11px] px-1" style={{ color: "#6a6a6a" }}>
                    {m.role === "user" ? `🙋 ${activeTicket.agentName}` : isAgent ? "🎧 PAAW HelpDesk AI" : "ℹ️ System"} · {formatTime(m.ts)}
                  </div>
                </div>
              );
            })
          ))}
        </div>

        {/* Reply Area */}
        {activeTicket && activeTicket.status !== "closed" && (
          <div className="px-5 py-3.5 border-t" style={{ background: "#1a1a1a", borderColor: "#2e2e2e" }}>
            <div className="flex gap-2.5 items-end">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                onKeyDown={(e) => {
                  if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                placeholder="輸入回覆... (Enter 送出 / Shift+Enter 換行)"
                rows={1}
                className="flex-1 px-3.5 py-2.5 rounded-xl text-sm outline-none resize-none"
                style={{
                  background: "#1a1a1a",
                  border: "1px solid #2e2e2e",
                  color: "#e8e8e8",
                  minHeight: 42,
                  maxHeight: 120,
                }}
                onFocus={(e) => { e.target.style.borderColor = theme.accent; }}
                onBlur={(e) => { e.target.style.borderColor = "#2e2e2e"; }}
              />
              <button
                onClick={sendReply}
                disabled={!replyText.trim()}
                className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-lg shrink-0 transition-opacity"
                style={{ background: theme.accent, opacity: replyText.trim() ? 1 : 0.4 }}
              >
                ➤
              </button>
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {/* ── New Ticket Modal ── */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setShowNewModal(false)}
        >
          <div
            className="rounded-2xl p-6 w-[90%] max-w-[500px]"
            style={{ background: "#1e1e1e", border: "1px solid #2e2e2e" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">➕ 建立新客服問題</h3>

            <div className="mb-3.5">
              <label className="block text-xs font-semibold mb-1" style={{ color: "#a0a0a0" }}>Agent 名稱</label>
              <input
                type="text"
                value={fAgentName}
                onChange={(e) => setFAgentName(e.target.value)}
                placeholder="例如: OpenClaw Agent"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#e8e8e8" }}
              />
            </div>

            <div className="flex gap-3 mb-3.5">
              <div className="flex-1">
                <label className="block text-xs font-semibold mb-1" style={{ color: "#a0a0a0" }}>Agent 類型</label>
                <select
                  value={fAgentType}
                  onChange={(e) => setFAgentType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#e8e8e8" }}
                >
                  <option value="openclaw">OpenClaw</option>
                  <option value="claude">Claude</option>
                  <option value="chatgpt">ChatGPT</option>
                  <option value="gemini">Gemini</option>
                  <option value="copilot">Copilot</option>
                  <option value="custom">Custom</option>
                  <option value="human">Human</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold mb-1" style={{ color: "#a0a0a0" }}>優先級</label>
                <select
                  value={fPriority}
                  onChange={(e) => setFPriority(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#e8e8e8" }}
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="urgent">緊急</option>
                </select>
              </div>
            </div>

            <div className="mb-3.5">
              <label className="block text-xs font-semibold mb-1" style={{ color: "#a0a0a0" }}>主旨</label>
              <input
                type="text"
                value={fSubject}
                onChange={(e) => setFSubject(e.target.value)}
                placeholder="問題摘要"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#e8e8e8" }}
              />
            </div>

            <div className="mb-3.5">
              <label className="block text-xs font-semibold mb-1" style={{ color: "#a0a0a0" }}>問題內容</label>
              <textarea
                value={fMessage}
                onChange={(e) => setFMessage(e.target.value)}
                placeholder="詳細描述問題..."
                className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-vertical"
                style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#e8e8e8", minHeight: 80 }}
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold mb-1" style={{ color: "#a0a0a0" }}>標籤 (逗號分隔)</label>
              <input
                type="text"
                value={fTags}
                onChange={(e) => setFTags(e.target.value)}
                placeholder="例如: skill, app, bug"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#1a1a1a", border: "1px solid #2e2e2e", color: "#e8e8e8" }}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: "#252525", border: "1px solid #3a3a3a", color: "#e8e8e8" }}
              >
                取消
              </button>
              <button
                onClick={createTicket}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
                style={{ background: theme.accent }}
              >
                建立
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          className="fixed bottom-5 right-5 px-5 py-3 rounded-xl text-sm z-[200]"
          style={{ background: "#252525", border: "1px solid #4ade80", color: "#e8e8e8", animation: "slideIn 0.3s ease" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
