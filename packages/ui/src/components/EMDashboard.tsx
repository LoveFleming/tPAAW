/**
 * EMDashboard — Engineering Manager 大總管 Landing Page
 *
 * 佈局：
 *   左側 (60%): EM Chat 對話視窗
 *   全寬 sub-tab：💬 EM Chat | 🏛 派工 Auto Dispatch（CU 狀態 slim bar 在 chat 頂部）
 */
import { useState, useEffect, useRef, useCallback } from "react";
import API_BASE from "../api";
import ChatMessages from "./ChatMessages"; // kept for reference — EM chat now uses custom rich renderer
import AutoDispatchPanel from "./AutoDispatchPanel";
import ModelSelector from "./ModelSelector";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import MarkdownText from "./MarkdownText";

interface ChatMessage {
  role: string;
  content: string;
  ts?: string;
  _thinking?: boolean;
  _streamId?: string | null;
  _emProgress?: boolean;
  // Rich EM actions — clickable links/buttons embedded in chat
  actions?: ChatAction[];
  reportRef?: string; // e.g. "security", "code-intelligence", "test-intelligence"
}

interface ChatAction {
  label: string; // e.g. "📄報告", "🔧修復", "💻派 Developer"
  type: "openReport" | "dispatchCrew" | "confirmPlan" | "cancelPlan";
  reportId?: string; // for openReport
  crewId?: string; // for dispatchCrew
  prompt?: string; // for dispatchCrew — pre-filled message
  findingIndex?: number; // specific finding to highlight
  planData?: { workList: any[]; situationReport: string }; // for confirmPlan
}

// Pending EM plan state (awaiting user confirmation)
interface PendingPlan {
  workList: any[];
  situationReport: string;
}

interface CodeUnderstandingStep {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error" | "skip";
  size?: number;
  error?: string;
}

interface EMDashboardProps {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string };
  // Code Understanding (was AI Initialize)
  onStartCodeUnderstanding?: (forceRerun?: boolean) => void;
  codeUnderstanding?: { running: boolean; steps: CodeUnderstandingStep[] };
  // Dispatch to crew with pre-filled message
  onDispatchToCrew?: (crewId: string, message: string) => void;
  // 開 subtask-detail tab 用（AutoDispatchPanel 內嵌）
  openMainTab?: (tab: any) => void;
  adRefreshTrigger?: number;
  model?: string;
  onModelChange?: (m: string) => void;
  // Project loop mode switch (mini / full)
  loopMode?: "mini" | "full";
  onLoopModeChange?: (mode: "mini" | "full") => void;
}

export default function EMDashboard({ rootPath, theme: tk, onStartCodeUnderstanding, codeUnderstanding, onDispatchToCrew, openMainTab, adRefreshTrigger = 0, model, onModelChange, loopMode, onLoopModeChange }: EMDashboardProps) {
  // ── EM Profile (avatar from crew API) ──
  const [emProfile, setEmProfile] = useState<{ codename?: string; imageUrl?: string; emoji?: string }>({});
  useEffect(() => {
    fetch(`${API_BASE}/api/coding-crew/coding.em`).then(r => r.json()).then(d => {
      setEmProfile({ codename: d.codename, imageUrl: d.imageUrl, emoji: d.emoji });
    }).catch(() => {});
  }, []);

  // ── Recent Dispatch (health tasks) ──
    // ── Chat State ──
  const EM_CHAT_ID = "coding.em";
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const prevMsgLenRef = useRef(0);
  // 2026-08-29: tab 切換保留 scroll — 持續記錄 chat scroll 位置
  const chatScrollTopRef = useRef(0);
  const composingRef = useRef(false);
  const { t } = useI18n();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load persisted EM chat on mount
  useEffect(() => {
    if (!rootPath || messagesLoaded) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(EM_CHAT_ID)}?cwd=${encodeURIComponent(rootPath)}`);
        const data = await res.json();
        if (data.messages?.length > 0) {
          setMessages(data.messages);
        } else {
          setMessages([{ role: "assistant", content: "🎖️ 我是陳哲宇 Ethan，EM 大總管。我可以幫你規劃工作、調度 agent、審查進度。\n\n告訴我你想做什麼，或點「🚀 EM 自動調度」讓我自動規劃。", ts: new Date().toISOString() }]);
        }
      } catch {
        setMessages([{ role: "assistant", content: "🎖️ 我是陳哲宇 Ethan，EM 大總管。我可以幫你規劃工作、調度 agent、審查進度。\n\n告訴我你想做什麼，或點「🚀 EM 自動調度」讓我自動規劃。", ts: new Date().toISOString() }]);
      }
      setMessagesLoaded(true);
    })();
  }, [rootPath, messagesLoaded]);

  // Save EM chat (debounced) — only when viewing active session
  useEffect(() => {
    if (!rootPath || !messagesLoaded || messages.length === 0) return;
    if (activeSessionId !== "active") return; // Don't save when viewing history
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(EM_CHAT_ID)}?cwd=${encodeURIComponent(rootPath)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });
      } catch {}
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [messages, rootPath, messagesLoaded]);

  // ── Project Status ──
  // Project status state removed — was only for git/unpushed display
  // actionLog/report state removed — Auto Dispatch tab handles both

  // ── EM Sessions (active + history) ──
  const [emSessions, setEmSessions] = useState<{ sessionId: string; title: string; messageCount: number; lastUpdated: string | null; isActive?: boolean }[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>("active");

  const fetchEmSessions = useCallback(async () => {
    if (!rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(EM_CHAT_ID)}/sessions?cwd=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setEmSessions(d.sessions || []);
    } catch {}
  }, [rootPath]);

  // 2026-08-29: 自動派工狀態輪詢 — chat view 頂部 slim bar 顯示進度（cron / 派工頁啟動的也能看到）
  const [adStatus, setAdStatus] = useState<any>(null);
  useEffect(() => {
    if (!rootPath) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/coding-auto-dispatch/status?path=${encodeURIComponent(rootPath)}`);
        if (!stopped) setAdStatus(await res.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, adStatus?.status === "running" ? 4000 : 20000);
    return () => { stopped = true; clearInterval(id); };
  }, [rootPath, adStatus?.status]);

  // 派工結束 5 分鐘內顯示結果 bar
  const adRecentlyFinished = adStatus && adStatus.status !== "running" && adStatus.status !== "never" && adStatus.completedAt
    && (Date.now() - new Date(adStatus.completedAt).getTime()) < 5 * 60 * 1000;

  // 2026-08-29: running 期間把 status events 轉成 chat 進度訊息（cron / 派工頁 / chat 觸發的都看得到）
  const adEventsSeenRef = useRef<number | null>(null);
  const [stopAsked, setStopAsked] = useState(false);
  useEffect(() => {
    const evts: any[] = adStatus?.events || [];
    if (adEventsSeenRef.current !== null && evts.length < adEventsSeenRef.current) {
      adEventsSeenRef.current = null; // 新一輪派工（events 重置）→ 重新計數
    }
    if (adEventsSeenRef.current === null) {
      // 首次觀察：執行中才倒帶（補齊進度）；間置狀態不倒歷史，避免洗版
      adEventsSeenRef.current = adStatus?.status === "running" ? 0 : evts.length;
      if (adEventsSeenRef.current === 0 && evts.length === 0) return;
      if (adEventsSeenRef.current !== 0) return;
    }
    const fresh = evts.slice(adEventsSeenRef.current);
    if (!fresh.length) {
      if (adStatus?.status !== "running") setStopAsked(false);
      return;
    }
    adEventsSeenRef.current = evts.length;

    const agentIcon: Record<string, string> = {
      architect: "🏛️", developer: "💻", tester: "🧪",
      "doc-writer": "📝", qa: "🔬", helpdesk: "🌸",
    };
    const lines: string[] = [];
    for (const e of fresh) {
      const m = e.meta || {};
      if (e.type === "task_start") {
        lines.push(`▶️ [${m.index ?? "?"}${m.total ? `/${m.total}` : ""}] ${agentIcon[m.agent] || "🔧"} **${m.agent}** 開始執行${m.subtaskId ? ` — ${m.subtaskId}` : ""}`);
      } else if (e.type === "task_done") {
        lines.push(`✅ [${m.index ?? "?"}] **${m.agent}** 完成${m.subtaskId ? ` — ${m.subtaskId}` : ""}`);
      } else if (e.type === "task_error") {
        lines.push(`❌ [${m.index ?? "?"}] **${m.agent}** 失敗：${(e.message || "").slice(0, 100)}`);
      } else if (e.type === "done") {
        const head = m.interrupted ? t("emDash.dispatchSummaryInterrupted") : t("emDash.dispatchSummaryDone");
        lines.push(`${m.interrupted ? "⏹️" : "🏁"} ${head} — 成功 **${m.succeeded ?? 0}** / 失敗 **${m.failed ?? 0}** / 共 ${m.totalTasks ?? 0} 項，統整報告見「自動派工」分頁`);
      } else if (e.type === "info" && e.message) {
        lines.push(`ℹ️ ${String(e.message).slice(0, 120)}`);
      }
    }
    if (lines.length) {
      setMessages(prev => [...prev, ...lines.map(content => ({ role: "assistant", content, ts: new Date().toISOString() } as ChatMessage))]);
      requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 300) el.scrollTop = el.scrollHeight;
      });
    }
    if (adStatus?.status !== "running") setStopAsked(false);
  }, [adStatus]);

  useEffect(() => { fetchEmSessions(); }, [fetchEmSessions]);
  const [emRunning, setEmRunning] = useState(false);
  // 右側面板 tab：overview | dispatch（Auto Dispatch 併入）
  const [view, setView] = useState<"chat" | "dispatch">("chat");
  // 2026-08-29: 切回 chat 時還原 scroll 位置（兩個 view 改為常駐掛載 + hidden 切換）
  useEffect(() => {
    if (view === "chat" && chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollTopRef.current;
  }, [view]);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [showEmContextDebug, setShowEmContextDebug] = useState(false);
  const [emContextDebug, setEmContextDebug] = useState<any>(null);
  const [emAction, setEmAction] = useState(""); // current EM action (thinking vs tool)
  const [emToolLog, setEmToolLog] = useState<{ name: string; args: string; result: string }[]>([]); // ⚡ tool call log
  const [showCUModal, setShowCUModal] = useState(false);
  const [singleStepRunning, setSingleStepRunning] = useState<string | null>(null); // step id being retried

  // ── EM Config ──
  const [emConfig, setEmConfig] = useState<any>(null);
  const [showEmConfig, setShowEmConfig] = useState(false);
  const [emConfigDirty, setEmConfigDirty] = useState(false);

  const fetchEmConfig = useCallback(async () => {
    if (!rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-em/config?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setEmConfig(d);
      setEmConfigDirty(false);
    } catch {}
  }, [rootPath]);

  useEffect(() => { fetchEmConfig(); }, [fetchEmConfig]);

  const patchEmConfig = async (patch: any) => {
    setEmConfig((prev: any) => ({ ...prev, ...patch }));
    setEmConfigDirty(true);
  };

  const patchEmConfigDeep = async (section: string, key: string, value: any) => {
    setEmConfig((prev: any) => {
      if (!prev) return prev;
      const sectionData = prev[section] || {};
      return { ...prev, [section]: { ...sectionData, [key]: value } };
    });
    setEmConfigDirty(true);
  };

  const saveEmConfig = async () => {
    if (!rootPath || !emConfig) return;
    try {
      await fetch(`${API_BASE}/api/coding-em/config?path=${encodeURIComponent(rootPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emConfig),
      });
      setEmConfigDirty(false);
    } catch (e: any) {
      alert("儲存 EM 設定失敗: " + e.message);
    }
  };

  const resetEmConfig = async () => {
    if (!rootPath) return;
    if (!confirm("重置 EM 設定為預設值？")) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-em/config/reset?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
      const d = await res.json();
      setEmConfig(d.config);
      setEmConfigDirty(false);
    } catch (e: any) {
      alert("重置失敗: " + e.message);
    }
  };

  // ── CU step definitions (must match server) ──
  const CU_STEPS = [
    { id: "scan", name: "🔍 掃描專案結構", file: "scan.json" },
    { id: "feature-map", name: "🗺️ Feature Map", file: "features/FEATURES.json" },
    { id: "code-intelligence", name: "🧠 Code Intelligence", file: "code-intelligence/summary.json" },
    { id: "test-intelligence", name: "🧪 Test Intelligence", file: "code-intelligence/test-intelligence.json" },
  ];

  // ── Load persisted step statuses when opening Modal ──
  const [persistedSteps, setPersistedSteps] = useState<Array<{ id: string; name: string; status: string; size?: number; error?: string }>>([]);
  // CU lifecycle 原料（cu-status 擴充回傳）— phase 派生用
  const [cuMeta, setCuMeta] = useState<{ hasPaaw: boolean; sourceFiles: number; doneCount: number; codeLastModified?: string | null; staleSteps?: Array<{ id: string; mechanical: boolean; manual?: boolean }>; staleCount?: number } | null>(null);
  const [cuInitBusy, setCuInitBusy] = useState(false);
  const [cuRescanBusy, setCuRescanBusy] = useState(false);
  const [cuRescanMsg, setCuRescanMsg] = useState<string>(""); // "" | "fail" | ✅ 摘要文字
  // 重掃回報：content-addressed diff 摘要（+新增/-消失/~修改；無變更 = model 未重寫，git 零 diff）
  const reportRescan = useCallback(async (r: Response) => {
    if (!r.ok) { setCuRescanMsg("fail"); setTimeout(() => setCuRescanMsg(""), 3000); return; }
    const d = await r.json().catch(() => null);
    const t = d?.ruDiff?.tables;
    if (t) {
      const fmt = (label: string, x?: { added: number; removed: number; modified: number }) =>
        !x || x.added + x.removed + x.modified === 0 ? "" : ` ${label}+${x.added}/-${x.removed}/~${x.modified}`;
      const parts = [fmt("API", t.apis), fmt("feat", t.features), fmt("test", t.tests), fmt("chg", t.changes)].filter(Boolean);
      setCuRescanMsg(parts.length ? `✅ 重掃：${parts.join("，")}` : "✅ 重掃完成 — 無變更（model 未重寫）");
    } else setCuRescanMsg("✅ 已重掃+重建 RU model");
    setTimeout(() => setCuRescanMsg(""), 5000);
  }, []);

  // ── CU lifecycle phase（派生，不存儲）──
  // missing=無 .paaw｜no-code=code 尚少不催（剛建立/剛 import 還沒寫 code）｜ready=該跑｜partial=跑一半｜done=完成
  const CU_NO_CODE_THRESHOLD = 5;
  // ⚠️ no-code 判定優先於 missing：空專案 import（無 .paaw 且 code 尚少）不催 CU，
  // 先寫 code；有料了（≥5 檔）才是 missing → 彈窗引導建立知識庫
  const cuPhase: "missing" | "no-code" | "ready" | "partial" | "done" | "stale" | null = cuMeta && rootPath
    ? (cuMeta.sourceFiles < CU_NO_CODE_THRESHOLD ? "no-code"
      : !cuMeta.hasPaaw ? "missing"
      : cuMeta.doneCount >= CU_STEPS.length ? (
          // manual-only stale（人寫文件較舊）不算知識過期 — 進 done + 小字提示（2026-08-22）
          ((cuMeta.staleSteps ?? []).some(s => !s.mechanical && !s.manual) || (cuMeta.staleSteps ?? []).some(s => s.mechanical)) ? "stale" : "done")
      : cuMeta.doneCount > 0 ? "partial"
      : "ready")
    : null;
  const staleMechanical = (cuMeta?.staleSteps ?? []).filter(s => s.mechanical).length;
  const staleManual = (cuMeta?.staleSteps ?? []).filter(s => (s as any).manual).length; // 人寫文件（CU 重跑不會更新）
  const staleSmart = (cuMeta?.staleSteps ?? []).filter(s => !s.mechanical && !(s as any).manual).length;
  const loadPersistedSteps = useCallback(async () => {
    if (!rootPath) return [];
    let steps: Array<{ id: string; name: string; status: string; size?: number; error?: string }> = [];
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/cu-status?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) {
        const data = await res.json();
        // CU lifecycle 原料（phase 派生用 + staleness）
        setCuMeta({
          hasPaaw: data.hasPaaw !== false,
          sourceFiles: data.sourceFiles ?? 0,
          doneCount: data.doneCount ?? 0,
          codeLastModified: data.codeLastModified ?? null,
          staleSteps: data.staleSteps ?? [],
          staleCount: data.staleCount ?? 0,
        });
        steps = CU_STEPS.map(s => {
          const st = data.steps?.[s.id];
          if (st?.status === "done") {
            return { id: s.id, name: s.name, status: "done", size: st.size };
          } else if (st?.status === "error") {
            return { id: s.id, name: s.name, status: "error", error: st.error };
          } else {
            return { id: s.id, name: s.name, status: "pending" };
          }
        });
        setPersistedSteps(steps);
        return steps;
      }
    } catch {}
    // Fallback: check file existence
    steps = [];
    for (const s of CU_STEPS) {
      try {
        const res = await fetch(`${API_BASE}/api/coding-project/file?path=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(s.file)}`);
        if (res.ok) {
          const content = await res.text();
          if (content.trim() && content.length > 50 && !content.includes("(待補充)") && !content.includes("(auto-detect)")) {
            steps.push({ id: s.id, name: s.name, status: "done", size: content.length });
          } else {
            steps.push({ id: s.id, name: s.name, status: "pending" });
          }
        } else {
          steps.push({ id: s.id, name: s.name, status: "pending" });
        }
      } catch {
        steps.push({ id: s.id, name: s.name, status: "pending" });
      }
    }
    setPersistedSteps(steps);
    return steps;
  }, [rootPath]);

  // 進 dashboard 就載 CU 狀態（auto-popup + 狀態條用）
  useEffect(() => { if (rootPath) loadPersistedSteps(); }, [rootPath]);

  // ── Auto-popup Code Understanding — 只有 ready / missing 才彈 ──
  // no-code（code 尚少，第一次進來根本還沒開始寫）不催；partial/done 不打擾
  // Per-project：切換專案（EMDashboard 不 unmount）重新判定
  const autoCUTriggeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!rootPath) return;
    if (autoCUTriggeredFor.current === rootPath) return;
    if (cuPhase === "ready" || cuPhase === "missing") {
      autoCUTriggeredFor.current = rootPath;
      setShowCUModal(true);
    }
  }, [rootPath, cuPhase]);

  // ── When bulk Code Understanding finishes (running false→true→false), refresh persisted steps + code status ──
  const prevRunningRef = useRef(false);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    const isRunning = codeUnderstanding?.running;
    if (wasRunning && !isRunning) {
      // Bulk run just finished — merge live step results into persistedSteps first
      // (in case .paaw/ files aren't written yet, we still show what the frontend knows)
      loadPersistedSteps().then(() => {
        setPersistedSteps(prev => {
          // If loadPersistedSteps returned all pending but we have live results, use live results
          const liveSteps = codeUnderstanding?.steps || [];
          const liveDone = liveSteps.filter(s => s.status === "done");
          if (liveDone.length > 0 && prev.every(s => s.status === "pending")) {
            return liveSteps.map(s => ({ id: s.id, name: s.name, status: s.status, size: s.size, error: s.error }));
          }
          return prev;
        });
      });
    }
    prevRunningRef.current = !!isRunning;
  }, [codeUnderstanding?.running, loadPersistedSteps]);

  // Auto-scroll to bottom instantly (no smooth animation flicker)
  useEffect(() => {
    if (messages.length > prevMsgLenRef.current) {
      // Use direct scrollTop for instant jump, avoid smooth scroll animation
      const el = chatScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevMsgLenRef.current = messages.length;
  }, [messages]);

  // ── Send chat to EM via A2A ──
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (adStatus?.status === "running") return; // 派工執行中 input 鎖定
    setInput("");

    // 2026-08-29 確認制派工：敲「自動派工 / 開始派工 / 派工」→ 顯示範圍等人確認（短指令才觸發，避免誤判問句）
    const compact = text.replace(/\s/g, "");
    if (/派工/.test(compact) && compact.length <= 6) {
      setMessages(prev => [...prev, { role: "user", content: text, ts: new Date().toISOString() } as ChatMessage]);
      startDispatchIntent();
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text, ts: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const ac = new AbortController();
    abortRef.current = ac;

    // Reset tool log
    setEmToolLog([]);
    setEmAction("思考中");

    try {
      const res = await fetch(`${API_BASE}/a2a/em`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: { role: "user", parts: [{ type: "text", text }] },
            context: { cwd: rootPath },
            conversationHistory: [...messages, { role: "user", content: text }].filter(m => !m._thinking),
            ...(model ? { metadata: { model } } : {}),
          },
          id: `em-chat-${Date.now()}`,
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
              // Update action indicator — no message bubble
              setEmAction("💭 思考中...");
            } else if (currentEvent === "tool" && d.name) {
              // Tool call — track in tool log (like CodingIDE agentToolLog)
              if (d.args !== undefined) {
                // tool_start: add entry with result = "..."
                const actionLabels: Record<string, string> = {
                  read_file: "📖 讀取檔案",
                  write_file: "✏️ 寫入檔案",
                  edit_file: "✏️ 編輯檔案",
                  glob: "🔍 搜尋檔案",
                  grep: "🔍 搜尋內容",
                  bash: "⚡ 執行指令",
                  git: "🔄 Git 操作",
                  diff: "🔍 比較差異",
                  ask_user: "❓ 詢問用戶",
                  dispatch_agent: "🔧 派工",
                  task_list: "📋 任務清單",
                  task_update: "📝 更新任務",
                  browser_test: "🌐 瀏覽器測試",
                };
                const actionLabel = actionLabels[d.name] || `🔧 ${d.name}`;
                const argsObj = typeof d.args === "string" ? (() => { try { return JSON.parse(d.args); } catch { return {}; } })() : d.args;
                const detail = argsObj?.path || argsObj?.file || argsObj?.pattern || argsObj?.command || argsObj?.question || "";
                setEmAction(detail ? `${actionLabel} ${detail.split(/[\/\\]/).pop()}` : actionLabel);
                setEmToolLog(prev => [...prev, { name: d.name, args: typeof d.args === "string" ? d.args : JSON.stringify(d.args), result: "..." }]);
              }
              if (d.result !== undefined && d.result !== "...") {
                // tool_end: update last matching entry's result
                setEmToolLog(prev => {
                  const updated = [...prev];
                  const idx = updated.length - 1;
                  if (idx >= 0 && updated[idx].name === d.name) {
                    updated[idx] = { ...updated[idx], result: d.result };
                  }
                  return updated;
                });
                setEmAction("💭 思考中...");
              }
            } else if (currentEvent === "content" && d.content) {
              // Final response — add as permanent message
              fullText = d.content;
              setMessages(prev => [...prev, { role: "assistant", content: d.content, ts: new Date().toISOString() }]);
            } else if (currentEvent === "error" && d.error) {
              setMessages(prev => [...prev, { role: "assistant", content: `❌ Error: ${typeof d.error === "string" ? d.error : d.error.error || d.error.message || "unknown"}`, ts: new Date().toISOString() }]);
              fullText = "__error__";
            } else if (currentEvent === "info" && d.message) {
              // Info messages — update action indicator
              setEmAction(d.message.slice(0, 60));
            }
            // A2A JSON-RPC format
            else if (d.result) {
              const r = d.result;
              if (r.artifacts?.[0]?.parts?.[0]?.text) {
                fullText = r.artifacts[0].parts[0].text;
                setMessages(prev => [...prev, { role: "assistant", content: fullText, ts: new Date().toISOString() }]);
              }
            } else if (d.error) {
              setMessages(prev => [...prev, { role: "assistant", content: `❌ Error: ${d.error.message || "unknown"}`, ts: new Date().toISOString() }]);
              fullText = "__error__";
            }

            currentEvent = "";
          } catch {}
        }
      }

      // If stream ended with no content, show fallback
      if (!fullText || fullText === "__error__") {
        if (fullText !== "__error__" && emToolLog.length === 0) {
          setMessages(prev => [...prev, { role: "assistant", content: "（AI 回應完成但無文字內容）", ts: new Date().toISOString() }]);
        }
      }

      // Refresh action log after EM responds
    } catch (err: any) {
      if (err.name === "AbortError") {
        setMessages(prev => [...prev, { role: "assistant", content: "⏹️ 已中斷", ts: new Date().toISOString() }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.message}`, ts: new Date().toISOString() }]);
      }
    }
    abortRef.current = null;
    setEmAction("");
    setEmToolLog([]);
    setLoading(false);
  };

  const stopAgent = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  };

  // ── 2026-08-29 Fleming 定調：確認制自動派工 ──
  // 使用者敲「自動派工」→ 即時掃 TASKS.json 顯示工作範圍 → 人確認 → 背景執行（/start API）
  // 每個 task 是獨立無狀態 A2A 呼叫（context 不累積），可長時間把所有 task 做完，最後統整報告
  const startDispatchIntent = async () => {
    if (!rootPath) return;
    if (adStatus?.status === "running") {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ 自動派工已在執行中，請等它完成或按「⏹ 中斷」。`, ts: new Date().toISOString() } as ChatMessage]);
      return;
    }
    setEmRunning(true);
    setEmAction("掃描 TASKS.json");
    try {
      const res = await fetch(`${API_BASE}/api/coding-auto-dispatch/preview?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "preview failed");

      if (!d.workList || d.workList.length === 0) {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `ℹ️ ${t("emDash.dispatchNoWork")}\n\n> ${d.noWorkReason || ""}`,
          ts: new Date().toISOString(),
        } as ChatMessage]);
        return;
      }

      const stats = d.stats || {};
      const priorityIcon: Record<string, string> = { critical: "💣", high: "🔴", medium: "🟡", low: "🟢" };
      const agentIcon: Record<string, string> = {
        architect: "🏛️", developer: "💻", tester: "🧪",
        "doc-writer": "📝", qa: "🔬", helpdesk: "🌸",
      };
      const planText = (d.workList as any[]).map((w, i) => {
        const pi = priorityIcon[w.priority as string] || "⚪";
        const ai = agentIcon[w.agent as string] || "🔧";
        return `${pi} ${i + 1}. ${ai} **${w.agent}** — ${w.sourceRef || ""}\n\n${w.task.slice(0, 160)}${w.task.length > 160 ? "…" : ""}`;
      }).join("\n\n");
      const excludedText = (d.excluded || []).length
        ? `\n\n---\n\n**🔒 排除 ${d.excluded.length} 項：**\n${(d.excluded as any[]).map(e => `- ~~${e.id} ${e.title}~~（${e.reason}）`).join("\n")}`
        : "";

      setPendingPlan({ workList: d.workList, situationReport: d.situationReport || "" });
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `## 📋 ${t("emDash.dispatchScopeTitle")}\n\nTASKS.json：open **${stats.open ?? "?"}** ｜ 進行中 ${stats.inProgress ?? 0} ｜ done ${stats.done ?? 0}\n\n本輪將派工 **${d.workList.length}** 項（依 priority 排序，各自獨立 context 逐一執行）：\n\n${planText}${excludedText}`,
        ts: new Date().toISOString(),
        actions: [
          { label: "✅ 確認執行", type: "confirmPlan", planData: { workList: d.workList, situationReport: d.situationReport || "" } },
          { label: "❌ 取消", type: "cancelPlan" },
        ],
      } as any]);
      requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.message}`, ts: new Date().toISOString() } as ChatMessage]);
    } finally {
      setEmRunning(false);
      setEmAction("");
    }
  };

  // ── 確認後執行：走 /start API 背景執行（2026-08-29 改版 — 不再前端 SSE 掛長連線）──
  // 進度由 adStatus 輪詢（4s）把 events 轉成 chat 訊息；執行中 input 鎖定 + 中斷 button
  const confirmEMPlan = async (_plan: PendingPlan) => {
    if (!rootPath || adStatus?.status === "running") return;
    setPendingPlan(null);
    setMessages(prev => [...prev, { role: "user", content: "✅ 確認執行自動派工", ts: new Date().toISOString() } as ChatMessage]);
    try {
      const res = await fetch(`${API_BASE}/api/coding-auto-dispatch/start?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "em", model: model || undefined }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "start failed");
      // 樂觀標記 running → input 立刻鎖定 + 中斷 button 出現（下一輪 poll 會校正）
      setAdStatus({ status: "running", startedAt: new Date().toISOString(), events: [] });
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `🚀 ${t("emDash.dispatchStarted")}`,
        ts: new Date().toISOString(),
      } as ChatMessage]);
      requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.message}`, ts: new Date().toISOString() } as ChatMessage]);
    }
  };

  // ── 中斷自動派工（安全中斷點：目前 task 完成後停止，剩餘標 skipped）──
  const stopDispatch = async () => {
    if (!rootPath || adStatus?.status !== "running") return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-auto-dispatch/stop?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await res.json();
      if (d.ok) {
        setStopAsked(true);
        setMessages(prev => [...prev, { role: "assistant", content: `⏹️ ${t("emDash.interruptAsked")}`, ts: new Date().toISOString() } as ChatMessage]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${d.message || "目前沒有在執行"}`, ts: new Date().toISOString() } as ChatMessage]);
      }
    } catch {}
  };

  // ── Run a single Code Understanding step (retry) ──
  const runSingleStep = useCallback(async (stepId: string) => {
    if (!rootPath || singleStepRunning) return;
    setSingleStepRunning(stepId);
    // Update local state to show running
    setPersistedSteps(prev => prev.map(s => s.id === stepId ? { ...s, status: "running" } : s));
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/ai-initial-step?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: stepId, model: model || undefined }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let stepSize = 0;
      let hadError = false;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.step && d.preview !== undefined && d.size) stepSize = d.size;
              if (d.step && d.error) hadError = true;
            } catch {}
          }
        }
      }
      // Update local state
      setPersistedSteps(prev => prev.map(s => s.id === stepId
        ? { ...s, status: hadError ? "error" : "done", size: stepSize || undefined }
        : s));
    } catch (err) {
      setPersistedSteps(prev => prev.map(s => s.id === stepId ? { ...s, status: "error" } : s));
    }
    setSingleStepRunning(null);
  }, [rootPath, singleStepRunning]);

  if (!rootPath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
        <span className="text-5xl opacity-40">🎖️</span>
        <p className="text-sm text-stone-400">開啟專案後即可查看 EM 大總管 Dashboard</p>
      </div>
    );
  }

  return (
    <>
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* ── Sub-tab bar：💬 EM Chat | 🏛 派工 Auto Dispatch（全寬，比照 ChatView） ── */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b" style={{ borderColor: tk.borderLight, background: tk.bg }}>
        <button data-testid="em-main-tab-chat" onClick={() => setView("chat")}
          className={cn("text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors", view === "chat" ? "bg-stone-800 text-white" : "text-stone-500 hover:bg-stone-100")}>
          💬 EM Chat
        </button>
        <button data-testid="em-main-tab-dispatch" onClick={() => setView("dispatch")}
          className={cn("text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors", view === "dispatch" ? "bg-stone-800 text-white" : "text-stone-500 hover:bg-stone-100")}>
          🏛 派工 Auto Dispatch
        </button>
      </div>
      {/* 2026-08-29: 兩個 view 常駐掛載，用 hidden 切換 — 保留雙方 scroll 位置與元件狀態 */}
      <div className={cn("flex-1 flex flex-col min-w-0 min-h-0", view !== "chat" && "hidden")}>
        {/* Header — matches crew agent header layout */}
        <div className="shrink-0 px-4 py-3 border-b relative" style={{ borderColor: tk.borderLight, background: `linear-gradient(135deg, #8b5cf611 0%, #8b5cf608 100%)` }}>
          <div className="flex items-center gap-3">
            {emProfile.imageUrl ? (
              <img src={`${API_BASE}${emProfile.imageUrl}`} className="w-10 h-10 rounded-full object-cover" style={{ border: "2px solid #8b5cf644" }} />
            ) : (
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl" style={{ backgroundColor: "#8b5cf622", border: "2px solid #8b5cf644" }}>🎖️</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-stone-800">{emProfile.codename || "EM 大總管"}</span>
                <span className="text-[11px] text-stone-400">Engineering Manager</span>
              </div>
              <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">規劃工作、調度 agent、審查進度</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* EM Settings */}
              <button
                onClick={() => { if (!showEmConfig) fetchEmConfig(); setShowEmConfig(!showEmConfig); }}
                className={cn("text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100 transition-colors",
                  showEmConfig && "bg-purple-100 text-purple-700")}
                title="EM 調度設定"
              >
                ⚙️
              </button>
              {/* History button */}
              <button
                onClick={() => { setShowSessions(!showSessions); if (!showSessions) fetchEmSessions(); }}
                className="text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100 transition-colors"
                title="歷史對話"
              >
                📋
              </button>
              {/* Context debug button */}
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/a2a/em/system-prompt${rootPath ? `?cwd=${encodeURIComponent(rootPath)}` : ""}`);
                    const data = await res.json();
                    setEmContextDebug(data);
                    setShowEmContextDebug(true);
                  } catch (e: any) {
                    setEmContextDebug({ error: e.message });
                    setShowEmContextDebug(true);
                  }
                }}
                className="text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100 transition-colors"
                title="查看注入的 Context & Prompts"
              >
                🔍
              </button>
              {/* New conversation button */}
              <button
                onClick={async () => {
                  if (messages.length <= 1) return;
                  try {
                    await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(EM_CHAT_ID)}/new-session?cwd=${encodeURIComponent(rootPath)}`, { method: "POST" });
                    setMessages([{ role: "assistant", content: "🎖️ 新對話已開啟。告訴我你想做什麼！", ts: new Date().toISOString() }]);
                    setActiveSessionId("active");
                    await fetchEmSessions();
                  } catch (e: any) {
                    alert("切換新對話失敗: " + e.message);
                  }
                }}
                disabled={messages.length === 0}
                className="text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30 transition-colors"
                title="開新對話"
              >
                ✨
              </button>
              {/* Model selector */}
              {onModelChange && (
                <ModelSelector feature="codingIDE.emDashboard" value={model || ""} onChange={onModelChange} />
              )}
              {/* Loop Mode — release unit 開發模式（mini = 快速迭代 / full = 七關證據流） */}
              {loopMode && onLoopModeChange && (
                <div className="flex items-center rounded-md border border-stone-200 overflow-hidden shrink-0"
                  title={loopMode === "mini" ? "Mini：上線前快速迭代 — developer 實作即 commit" : "Full：上線後完整管線 — spec → implement → review → test → qa → docs → commit，證據齊才能過"}>
                  {(["mini", "full"] as const).map(m => (
                    <button key={m} onClick={() => onLoopModeChange(m)}
                      className={cn("text-[10px] font-bold px-2 py-1 transition-colors",
                        loopMode === m ? (m === "mini" ? "bg-amber-500 text-white" : "bg-blue-500 text-white") : "bg-white text-stone-400 hover:bg-stone-50")}>
                      {m === "mini" ? "🚀 Mini" : "🛡️ Full"}
                    </button>
                  ))}
                </div>
              )}
              {/* Divider */}
              <div className="w-px h-5 bg-stone-200 mx-1" />
              {/* 2026-08-29: 🚀 EM 規劃 button 已移除 — 改成在 input 敲「自動派工」觸發確認制派工 */}
            </div>
          </div>
        </div>

        {/* EM sessions dropdown */}
        {showSessions && (
          <div className="absolute z-50 mt-1 w-80 bg-white rounded-lg shadow-2xl border border-stone-200 max-h-96 overflow-y-auto" style={{ right: 8 }}>
            <div className="px-3 py-2 border-b border-stone-100 flex items-center justify-between">
              <span className="text-sm font-bold text-stone-700">📜 對話歷史</span>
              <button onClick={() => setShowSessions(false)} className="text-xs text-stone-400 hover:text-stone-600">✕</button>
            </div>
            {emSessions.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-stone-400">暫無歷史對話</div>
            ) : (
              emSessions.map(s => (
                <button
                  key={s.sessionId}
                  onClick={async () => {
                    if (s.isActive) {
                      // Already active, just reload
                      const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(EM_CHAT_ID)}?cwd=${encodeURIComponent(rootPath)}`);
                      const d = await res.json();
                      setMessages(d.messages || []);
                      setActiveSessionId("active");
                    } else {
                      // Load historical session
                      const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(EM_CHAT_ID)}/sessions/${encodeURIComponent(s.sessionId)}?cwd=${encodeURIComponent(rootPath)}`);
                      const d = await res.json();
                      setMessages(d.messages || []);
                      setActiveSessionId(s.sessionId);
                    }
                    setShowSessions(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-stone-50 border-b border-stone-50 transition-colors"
                  style={{ background: activeSessionId === s.sessionId ? "#fef3c7" : undefined }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-stone-700 truncate flex-1">
                      {s.isActive && "🟢 "}{s.title || "未命名對話"}
                    </span>
                    {s.lastUpdated && (
                      <span className="text-[10px] text-stone-400 ml-2 shrink-0">
                        {new Date(s.lastUpdated).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* EM Config Panel */}
        {showEmConfig && emConfig && (
          <div className="border-b bg-stone-50" style={{ borderColor: tk.borderLight, maxHeight: "70%", overflowY: "auto" }}>
            <div className="flex items-center justify-between px-4 py-2 border-b sticky top-0 bg-white z-10" style={{ borderColor: tk.borderLight }}>
              <span className="text-sm font-bold text-stone-700">⚙️ EM 調度設定</span>
              <div className="flex items-center gap-2">
                {emConfigDirty && <span className="text-[10px] text-amber-600">● 未儲存</span>}
                <button onClick={saveEmConfig} disabled={!emConfigDirty} className="text-xs px-2 py-1 rounded bg-blue-500 text-white disabled:opacity-30 hover:bg-blue-600">💾 儲存</button>
                <button onClick={resetEmConfig} className="text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100">↩️ 重置</button>
                <button onClick={() => setShowEmConfig(false)} className="text-xs text-stone-400 hover:text-stone-600">✕</button>
              </div>
            </div>
            <div className="px-4 py-3 space-y-4">
              {/* Dispatch Strategy */}
              <div>
                <label className="text-xs font-bold text-stone-600 block mb-1.5">🧭 調度策略</label>
                <div className="flex gap-1.5">
                  {[
                    { v: "conservative", label: "保守", desc: "每步都問人" },
                    { v: "balanced", label: "平衡", desc: "計畫→確認→執行" },
                    { v: "aggressive", label: "積極", desc: "收到目標直接做完" },
                  ].map(s => (
                    <button key={s.v} onClick={() => patchEmConfig({ dispatchStrategy: s.v })}
                      className={cn("text-xs px-3 py-1.5 rounded-md border transition-all",
                        emConfig.dispatchStrategy === s.v ? "bg-purple-100 border-purple-300 text-purple-700 font-bold" : "bg-white border-stone-200 text-stone-500 hover:border-stone-300")}
                      title={s.desc}
                    >{s.label}</button>
                  ))}
                </div>
              </div>

              {/* Auto-Execute Rules */}
              <div>
                <label className="text-xs font-bold text-stone-600 block mb-1.5">⚡ 自動執行規則</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: "tests", label: "補測試" },
                    { key: "docs", label: "寫文件" },
                    { key: "refactor", label: "重構" },
                    { key: "securityFix", label: "安全修復" },
                    { key: "breakingChange", label: "破壞性變更" },
                  ].map(r => (
                    <label key={r.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox"
                        checked={!!emConfig.autoExecute?.[r.key]}
                        onChange={e => patchEmConfigDeep("autoExecute", r.key, e.target.checked)}
                        className="accent-purple-500"
                      />
                      <span className={emConfig.autoExecute?.[r.key] ? "text-stone-700 font-medium" : "text-stone-400"}>{r.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-stone-400 mt-1">未勾選的項目 EM 會先問人再執行</p>
              </div>

              {/* Task Decomposition */}
              <div>
                <label className="text-xs font-bold text-stone-600 block mb-1.5">📋 任務拆分設定</label>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-1 text-xs text-stone-600">
                    最多子任務:
                    <input type="number" min={1} max={50}
                      value={emConfig.taskDecomposition?.maxSubtasks ?? 10}
                      onChange={e => patchEmConfigDeep("taskDecomposition", "maxSubtasks", parseInt(e.target.value) || 10)}
                      className="w-14 px-1.5 py-0.5 rounded border border-stone-200 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-stone-600">
                    預設 Effort:
                    <select value={emConfig.taskDecomposition?.defaultEffort ?? "S"}
                      onChange={e => patchEmConfigDeep("taskDecomposition", "defaultEffort", e.target.value)}
                      className="px-1.5 py-0.5 rounded border border-stone-200 text-xs bg-white"
                    >
                      <option value="XS">XS</option>
                      <option value="S">S</option>
                      <option value="M">M</option>
                      <option value="L">L</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1 text-xs text-stone-600">
                    <input type="checkbox"
                      checked={!!emConfig.taskDecomposition?.requireEstimate}
                      onChange={e => patchEmConfigDeep("taskDecomposition", "requireEstimate", e.target.checked)}
                      className="accent-purple-500"
                    />
                    拆完附估時
                  </label>
                </div>
              </div>

              {/* Reporting */}
              <div>
                <label className="text-xs font-bold text-stone-600 block mb-1.5">📊 報告格式</label>
                <div className="flex flex-wrap gap-3">
                  <select value={emConfig.reporting?.format ?? "summary"}
                    onChange={e => patchEmConfigDeep("reporting", "format", e.target.value)}
                    className="px-2 py-1 rounded border border-stone-200 text-xs bg-white"
                  >
                    <option value="summary">摘要</option>
                    <option value="detailed">詳細</option>
                    <option value="executive">執行摘要</option>
                  </select>
                  <label className="flex items-center gap-1 text-xs text-stone-600">
                    <input type="checkbox"
                      checked={!!emConfig.reporting?.includeCodeChanges}
                      onChange={e => patchEmConfigDeep("reporting", "includeCodeChanges", e.target.checked)}
                      className="accent-purple-500"
                    />
                    附 Code Diff
                  </label>
                  <label className="flex items-center gap-1 text-xs text-stone-600">
                    <input type="checkbox"
                      checked={!!emConfig.reporting?.includeActionLog}
                      onChange={e => patchEmConfigDeep("reporting", "includeActionLog", e.target.checked)}
                      className="accent-purple-500"
                    />
                    附 Action Log
                  </label>
                </div>
              </div>

              {/* Planning Scope */}
              <div>
                <label className="text-xs font-bold text-stone-600 block mb-1.5">🔍 規劃範圍</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: "gitChanges", label: "Git 變更" },
                    { key: "openIssues", label: "Open Issues" },
                    { key: "openTasks", label: "Open Tasks" },
                    { key: "securityFindings", label: "安全發現" },
                    { key: "codeIntelligence", label: "Code Intelligence" },
                    { key: "testCoverage", label: "測試覆蓋率" },
                  ].map(r => (
                    <label key={r.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox"
                        checked={!!emConfig.planningScope?.[r.key]}
                        onChange={e => patchEmConfigDeep("planningScope", r.key, e.target.checked)}
                        className="accent-purple-500"
                      />
                      <span className={emConfig.planningScope?.[r.key] ? "text-stone-700 font-medium" : "text-stone-400"}>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── CU lifecycle slim bar — 知識庫狀態一行掌握 ── */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b text-xs" style={{ borderColor: tk.borderLight, backgroundColor: tk.bgMuted }}>
          {cuPhase === null && (
            <span className="text-stone-400 truncate">⏳ 載入知識庫狀態…</span>
          )}
          {cuPhase === "missing" && (
            <>
              <span className="text-stone-500 truncate flex-1" title="這個 Release Unit 還沒有 .paaw 知識庫 — 初始化或跑 Code Understanding 建立">🌱 尚未初始化 — 還沒有 .paaw 知識庫</span>
              <button
                onClick={async () => {
                  if (!rootPath || cuInitBusy) return;
                  setCuInitBusy(true);
                  try {
                    await fetch(`${API_BASE}/api/coding-project/init?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
                    await loadPersistedSteps();
                  } finally { setCuInitBusy(false); }
                }}
                disabled={cuInitBusy}
                className="shrink-0 px-2 py-0.5 rounded bg-stone-600 text-white hover:bg-stone-700 font-bold disabled:opacity-50"
              >{cuInitBusy ? "⏳ 初始化中..." : "🌱 初始化 .paaw"}</button>
            </>
          )}
          {cuPhase === "no-code" && (
            <>
              <span className="text-stone-400 truncate flex-1">🌱 代碼尚少（{cuMeta?.sourceFiles ?? 0} 個檔案）— 先寫 code，Code Understanding 之後再跑也可以</span>
              <button onClick={() => { loadPersistedSteps(); setShowCUModal(true); }}
                title="代碼尚少 — 先寫 code 再跑更有意義，但仍可手動執行"
                className="shrink-0 px-2 py-0.5 rounded bg-stone-100 text-stone-500 hover:bg-stone-200 font-bold"
              >🧠 Code Understanding</button>
            </>
          )}
          {cuPhase === "ready" && (
            <>
              <span className="text-emerald-700 truncate flex-1">🧠 待探索（{cuMeta?.sourceFiles ?? 0} 個檔案）— 跑 Code Understanding 建立知識庫</span>
              <button onClick={() => { loadPersistedSteps(); setShowCUModal(true); }}
                className="shrink-0 px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-bold animate-pulse"
              >🧠 Code Understanding</button>
            </>
          )}
          {cuPhase === "partial" && (
            <>
              <span className="text-amber-700 truncate flex-1">⏳ 進行中 {cuMeta?.doneCount ?? 0}/{CU_STEPS.length} — 知識庫部分完成，可繼續跑完</span>
              <button onClick={() => { loadPersistedSteps(); setShowCUModal(true); }}
                className="shrink-0 px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
              >🧠 Code Understanding</button>
            </>
          )}
          {cuPhase === "stale" && (
            <>
              <span className="text-orange-700 truncate flex-1" title={`${t("cu.stale.label")}（${new Date(cuMeta?.codeLastModified || "").toLocaleDateString()}）${staleManual > 0 ? `；${staleManual} ${t("cu.stale.manual")}（${t("cu.stale.manualDetail")}）` : ""}`}>
                ⚠️ {t("cu.stale.label")}（{new Date(cuMeta?.codeLastModified || "").toLocaleDateString()}）
                {staleMechanical > 0 && <>，{staleMechanical} {t("cu.stale.mechanical")}</>}
                {staleSmart > 0 && <>，{staleSmart} {t("cu.stale.smart")}</>}
              </span>
              {staleMechanical > 0 && (
                <button
                  onClick={async () => {
                    if (!rootPath || cuRescanBusy) return;
                    setCuRescanBusy(true);
                    try {
                      try {
                        const r = await fetch(`${API_BASE}/api/coding-project/cu-rescan-mechanical?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
                        await reportRescan(r);
                      } catch { setCuRescanMsg("fail"); setTimeout(() => setCuRescanMsg(""), 3000); }
                      await loadPersistedSteps();
                    } finally { setCuRescanBusy(false); }
                  }}
                  disabled={cuRescanBusy}
                  className="shrink-0 px-2 py-0.5 rounded bg-orange-600 text-white hover:bg-orange-700 font-bold disabled:opacity-50"
                >{cuRescanBusy ? "⏳ 重掃中..." : cuRescanMsg === "fail" ? "❌ 重掃失敗" : cuRescanMsg || "⚡ 重掃機械層"}</button>
              )}
              {staleSmart > 0 && (
                <button onClick={() => { loadPersistedSteps(); setShowCUModal(true); }}
                  className="shrink-0 px-2 py-0.5 rounded bg-stone-100 text-stone-600 hover:bg-stone-200 font-bold"
                >🧠 開啟 CU 視窗重跑</button>
              )}
            </>
          )}
          {cuPhase === "done" && (
            <>
              <span className="text-green-700 truncate flex-1" title={((cuMeta?.staleSteps ?? []).filter(s => s.manual).length > 0) ? t("cu.stale.manualDetailDone") : undefined}>
                ✅ 已完成 {cuMeta?.doneCount ?? 0}/{CU_STEPS.length} — 知識庫就緒
              </span>
              <button onClick={() => { loadPersistedSteps(); setShowCUModal(true); }}
                className="shrink-0 px-2 py-0.5 rounded bg-stone-100 text-stone-600 hover:bg-stone-200 font-bold"
              >🧠 Code Understanding</button>
            </>
          )}
        </div>

        {/* 2026-08-29: 自動派工即時狀態 slim bar（執行中/剛結束） */}
        {(adStatus?.status === "running" || adRecentlyFinished) && (
          <div className="shrink-0 px-3 py-1.5 border-b flex items-center gap-2 text-[11px]" style={{ borderColor: tk.borderLight, background: adStatus?.status === "running" ? "#8b5cf611" : adStatus?.status === "failed" ? "#ef444411" : "#22c55e11" }}>
            <span className={adStatus?.status === "running" ? "animate-pulse" : ""}>{adStatus?.status === "running" ? "🌙" : adStatus?.status === "failed" ? "❌" : "✅"}</span>
            <span className="font-bold shrink-0" style={{ color: adStatus?.status === "failed" ? "#dc2626" : adStatus?.status === "running" ? "#7c3aed" : "#16a34a" }}>
              {adStatus?.status === "running" ? t("emDash.dispatchRunning") : adStatus?.status === "failed" ? t("emDash.dispatchFailed") : t("emDash.dispatchDone")}
            </span>
            <span className="text-stone-500 truncate flex-1 min-w-0" title={adStatus?.lastEvent?.message || adStatus?.error || ""}>
              {adStatus?.status === "running"
                ? (adStatus?.lastEvent?.message || "...")
                : (adStatus?.status === "failed" ? (adStatus?.error || "") : (adStatus?.duration ? `${Math.round(adStatus.duration / 1000)}s` : ""))}
            </span>
            <button onClick={() => setView("dispatch")} className="shrink-0 px-2 py-0.5 rounded bg-stone-100 text-stone-600 hover:bg-stone-200 font-bold">{t("emDash.view")} →</button>
          </div>
        )}

        {/* Chat Messages */}
        <div ref={chatScrollRef} onScroll={(e) => { chatScrollTopRef.current = e.currentTarget.scrollTop; }} className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "thin" }}>
          {messages.map((msg, i) => (
            <div key={i} className="mb-3 flex gap-2.5">
              {/* Avatar */}
              <div className="flex-shrink-0 mt-0.5">
                {msg.role === "user" ? (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm" style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}>你</div>
                ) : emProfile.imageUrl ? (
                  <img src={`${API_BASE}${emProfile.imageUrl}`} className="w-7 h-7 rounded-full object-cover" style={{ border: "1px solid #8b5cf633" }} />
                ) : (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ backgroundColor: "#8b5cf622", border: "1px solid #8b5cf633" }}>🎖️</div>
                )}
              </div>
              {/* Bubble */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-stone-600">{msg.role === "user" ? "你" : (emProfile.codename || "EM 大總管")}</span>
                </div>
                {msg.role === "user" ? (
                  <span className="inline-block px-3 py-1.5 rounded-2xl text-sm bg-stone-50 text-stone-700 max-w-[80%] whitespace-pre-wrap">{msg.content}</span>
                ) : (
                  <div className="px-4 py-2.5 rounded-2xl bg-white shadow-sm border border-stone-100 text-sm text-stone-700 leading-relaxed">
                  <MarkdownText>{msg.content}</MarkdownText>
                  {/* Rich action buttons */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {msg.actions.map((action, j) => (
                        <button
                          key={j}
                          onClick={() => {
                            if (action.type === "confirmPlan" && action.planData) {
                              confirmEMPlan(action.planData);
                            }
                            if (action.type === "cancelPlan") {
                              setMessages(prev => [...prev, {
                                role: "assistant",
                                content: "❌ EM 調度計畫已取消。",
                                ts: new Date().toISOString(),
                              }]);
                            }
                            if (action.type === "dispatchCrew" && onDispatchToCrew) {
                              onDispatchToCrew(action.crewId || "", action.prompt || "");
                            // Push dispatch confirmation to chat
                            setMessages(prev => [...prev, {
                              role: "assistant",
                              content: `🔧 已派交 **${action.crewId}** 處理：${(action.prompt || "").slice(0, 60)}...`,
                              ts: new Date().toISOString(),
                            }]);
                            const el2 = chatScrollRef.current;
                            if (el2) el2.scrollTop = el2.scrollHeight;
                            }
                            if (action.type === "openReport" && action.reportId) {
                              // Open Auto Dispatch tab (reports live there)
                              setView("dispatch");
                            }
                          }}
                          disabled={action.type === "confirmPlan" && emRunning}
                          className={cn(
                            "text-xs px-2.5 py-1.5 rounded-md font-semibold transition-colors",
                            action.type === "confirmPlan"
                              ? "bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-300"
                              : action.type === "cancelPlan"
                              ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                              : action.type === "openReport"
                              ? "bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                          )}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                )}
            </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-2.5">
              <div className="flex-shrink-0 mt-0.5">
                {emProfile.imageUrl ? (
                  <img src={`${API_BASE}${emProfile.imageUrl}`} className="w-7 h-7 rounded-full object-cover" style={{ border: "1px solid #8b5cf633" }} />
                ) : (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ backgroundColor: "#8b5cf622", border: "1px solid #8b5cf633" }}>🎖️</div>
                )}
              </div>
              <div>
                <span className="text-xs font-medium text-stone-600">{emProfile.codename || "EM 大總管"}</span>
                <div className="flex items-center gap-2 py-2">
                  {(!emAction || emAction.includes("思考") || emAction.includes("規劃")) ? (
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#8b5cf6", animationDelay: "0ms" }} />
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#8b5cf6", animationDelay: "200ms" }} />
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#8b5cf6", animationDelay: "400ms" }} />
                    </div>
                  ) : (
                    <span className="w-3.5 h-3.5 border-[2px] rounded-full animate-spin" style={{ borderColor: "#8b5cf6", borderTopColor: "transparent" }} />
                  )}
                  <span className={`text-xs font-medium ${(!emAction || emAction.includes("思考") || emAction.includes("規劃")) ? "opacity-70" : ""}`} style={{ color: "#8b5cf6" }}>{emAction || "思考中"}</span>
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ⚡ Tool Calls panel — same style as CodingIDE */}
        {loading && emToolLog.length > 0 && (
          <div className="shrink-0 max-h-32 overflow-y-auto border-t px-3 py-2 space-y-1" style={{ borderColor: tk.borderLight, scrollbarWidth: "thin" }}>
            <div className="text-xs font-semibold text-stone-400 mb-1">⚡ Tool Calls</div>
            {emToolLog.slice(-8).map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <span className={t.result !== "..." ? "text-green-500" : "text-blue-400 animate-pulse"}>
                  {t.result !== "..." ? "✓" : "⏳"}
                </span>
                <span className="font-mono text-stone-600">{t.name}</span>
                <span className="text-stone-400 truncate max-w-[200px]">{t.args}</span>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="shrink-0 px-4 py-3 border-t" style={{ borderColor: tk.borderLight }}>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onKeyDown={e => {
                if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              disabled={adStatus?.status === "running"}
              placeholder={adStatus?.status === "running"
                ? t("emDash.inputLocked")
                : `跟 ${emProfile.codename || "EM 大總管"}對話（敲「自動派工」啟動確認制派工）...`}
              rows={1}
              className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              style={{ borderColor: tk.borderLight, backgroundColor: tk.bg }}
            />
            {adStatus?.status === "running" ? (
              <button
                onClick={stopDispatch}
                disabled={stopAsked}
                className={cn("px-4 py-2 rounded-lg text-sm font-bold transition-colors shrink-0",
                  stopAsked ? "bg-stone-300 text-stone-500 cursor-not-allowed" : "bg-red-500 text-white hover:bg-red-600 animate-pulse")}
              >
                {stopAsked ? "⏳ 中斷中…" : `⏹ ${t("emDash.interruptBtn")}`}
              </button>
            ) : (
              <button
                onClick={loading ? stopAgent : sendMessage}
                disabled={!loading && !input.trim()}
                className={cn("px-4 py-2 rounded-lg text-sm font-bold transition-colors shrink-0",
                  loading
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : input.trim() ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-stone-200 text-stone-400")}
              >
                {loading ? "中斷" : "送出"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={cn("flex-1 min-h-0", view !== "dispatch" && "hidden")} data-testid="em-dispatch-full">
        <AutoDispatchPanel active={view === "dispatch"} theme={tk} rootPath={rootPath} model={model} openMainTab={openMainTab} refreshTrigger={adRefreshTrigger} />
      </div>
    </div>

    {/* ══ Code Understanding Progress Modal ══ */}
    {showCUModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!codeUnderstanding?.running && !singleStepRunning) setShowCUModal(false); }}>
        <div className="bg-white rounded-2xl shadow-2xl border flex flex-col" style={{ width: "min(520px, 90vw)", maxHeight: "70vh" }} onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b rounded-t-2xl" style={{ backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }}>
            <h3 className="text-base font-bold text-emerald-700">🧠 Code Understanding</h3>
            {/* ✕ close always visible — disabled while running */}
            <button
              onClick={() => setShowCUModal(false)}
              disabled={codeUnderstanding?.running || singleStepRunning !== null}
              className={cn("text-lg transition-colors", (codeUnderstanding?.running || singleStepRunning !== null) ? "text-stone-200 cursor-not-allowed" : "text-stone-400 hover:text-stone-600")}
            >✕</button>
          </div>
          {/* Use live steps if bulk running, otherwise use persisted steps */}
          {(() => {
            const isBulkRunning = codeUnderstanding?.running && codeUnderstanding.steps.length > 0;
            const steps = isBulkRunning ? codeUnderstanding.steps : persistedSteps;
            const isRunning = isBulkRunning || singleStepRunning !== null;
            if (steps.length === 0) return (
              <div className="flex-1 flex items-center justify-center text-sm text-stone-400 py-12">
                載入中...
              </div>
            );
            return (<>
          {/* Steps */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {steps.map((step) => (
              <div key={step.id} className="flex items-center gap-3 py-2">
                <span className="text-lg shrink-0">
                  {step.status === "done" ? "✅" : step.status === "running" ? "⏳" : step.status === "error" ? "❌" : step.status === "skip" ? "⏭️" : "⬜"}
                  {singleStepRunning === step.id && <span className="ml-1 inline-block animate-pulse">●</span>}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm font-medium", step.status === "running" ? "text-emerald-700" : step.status === "done" ? "text-stone-600" : step.status === "error" ? "text-red-500" : "text-stone-400")}>
                    {step.name}
                    {step.status === "running" && <span className="ml-2 inline-block animate-pulse">●</span>}
                  </div>
                  {step.status === "done" && step.size && (
                    <div className="text-xs text-stone-300">{step.size.toLocaleString()} chars</div>
                  )}
                  {step.status === "error" && step.error && (
                    <div className="text-xs text-red-400">{step.error}</div>
                  )}
                  {step.status === "skip" && (
                    <div className="text-xs text-stone-300">Skipped</div>
                  )}
                </div>
                {/* Retry / Run button — not during bulk run */}
                {!isBulkRunning && (step.status === "error" || step.status === "skip" || step.status === "done" || step.status === "pending") && (
                  <button
                    onClick={() => runSingleStep(step.id)}
                    disabled={singleStepRunning !== null}
                    className={cn("text-xs px-2 py-1 rounded font-bold shrink-0 transition-colors",
                      singleStepRunning === step.id
                        ? "bg-emerald-100 text-emerald-400 cursor-wait"
                        : singleStepRunning !== null
                          ? "bg-stone-100 text-stone-300 cursor-not-allowed"
                          : "bg-stone-100 text-stone-500 hover:bg-emerald-100 hover:text-emerald-600")}
                    title={step.status === "done" ? "重做此步驟" : "單獨執行此步驟"}
                  >
                    {singleStepRunning === step.id ? "⏳" : step.status === "done" ? "🔄" : "▶️"}
                  </button>
                )}
              </div>
            ))}
          </div>
          {/* Footer */}
          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: "#f0f0f0" }}>
            <span className="text-sm text-stone-400">
              {isBulkRunning
                ? "AI 正在分析專案..."
                : singleStepRunning
                  ? `正在執行 ${singleStepRunning}...`
                  : `${persistedSteps.filter(s => s.status === "done").length}/${persistedSteps.length} 完成`}
            </span>
            <div className="flex gap-2">
              {/* Run All button — always available when not bulk running */}
              {!isBulkRunning && (
                <button
                  onClick={() => { if (onStartCodeUnderstanding) { onStartCodeUnderstanding(cuPhase === "stale"); } }}
                  disabled={singleStepRunning !== null}
                  className="px-4 py-1.5 text-sm font-bold rounded-lg border transition-colors disabled:opacity-50"
                  style={{ borderColor: "#bbf7d0", color: "#059669", backgroundColor: "#f0fdf4" }}
                >
                  🚀 全部執行
                </button>
              )}
              {/* Close button — replaces 完成 ✅ */}
              {!isBulkRunning && !singleStepRunning && (
                <button onClick={() => { setShowCUModal(false); }} className="px-4 py-1.5 text-sm font-bold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700">
                  關閉
                </button>
              )}
            </div>
          </div>
            </>);
          })()}
        </div>
      </div>
    )}

    {/* Context Debug Modal */}
    {showEmContextDebug && emContextDebug && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowEmContextDebug(false)}>
        <div className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="shrink-0 px-5 py-3 border-b border-stone-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-stone-800">🔍 EM Context Debug — {emContextDebug.agentId || "architect"}</h3>
            <div className="flex items-center gap-3">
              {emContextDebug.totalLength != null && typeof emContextDebug.totalLength === "number" && (
                <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600">{emContextDebug.totalLength.toLocaleString()} chars total</span>
              )}
              <button onClick={() => setShowEmContextDebug(false)} className="text-stone-400 hover:text-stone-600 text-lg">✕</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
            {emContextDebug.error && (
              <div className="p-3 rounded bg-red-50 text-red-700">❌ {emContextDebug.error}</div>
            )}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-stone-700">📝 Base System Prompt</span>
                {typeof emContextDebug.baseSystemPromptLength === "number" && (
                  <span className="text-xs text-stone-400">({emContextDebug.baseSystemPromptLength.toLocaleString()} chars)</span>
                )}
              </div>
              <pre className="whitespace-pre-wrap text-xs bg-stone-50 p-3 rounded-lg max-h-64 overflow-y-auto border border-stone-200">{emContextDebug.baseSystemPrompt || "(empty)"}</pre>
            </div>
            {(emContextDebug.dynamicContext || []).map((ctx: any, i: number) => (
              <div key={i}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-stone-700">📂 {ctx.source}</span>
                  <span className="text-xs text-stone-400">({(typeof ctx.content === "string" ? ctx.content.length : JSON.stringify(ctx.content).length)?.toLocaleString() || "?"} chars)</span>
                </div>
                <pre className="whitespace-pre-wrap text-xs bg-stone-50 p-3 rounded-lg max-h-48 overflow-y-auto border border-stone-200">{typeof ctx.content === "string" ? ctx.content : JSON.stringify(ctx.content, null, 2) || "(empty)"}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ── Git Changes Preview Panel removed ──
// EM chat works from commit changes directly, no need for a separate panel

