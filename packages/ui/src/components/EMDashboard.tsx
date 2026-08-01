/**
 * EMDashboard — Engineering Manager 大總管 Landing Page
 *
 * 佈局：
 *   左側 (60%): EM Chat 對話視窗
 *   右側 (40%): Project Overview + Agent Activity + Overnight Report
 */
import { useState, useEffect, useRef, useCallback } from "react";
import API_BASE from "../api";
import ChatMessages from "./ChatMessages"; // kept for reference — EM chat now uses custom rich renderer
import ModelSelector from "./ModelSelector";
import { cn } from "../utils";
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

interface CodeScoreItem {
  name: string;
  status: string;
  detail: string;
}
interface CodeStatus {
  initialized: boolean;
  scores: Record<string, { score: number; items: CodeScoreItem[] }>;
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
  onOpenFile?: (path: string) => void;
  // Code Understanding (was AI Initialize)
  onStartCodeUnderstanding?: () => void;
  codeUnderstanding?: { running: boolean; steps: CodeUnderstandingStep[] };
  // Dispatch to crew with pre-filled message
  onDispatchToCrew?: (crewId: string, message: string) => void;
  // Open a report tab (EM chat → Report)
  onOpenReportTab?: (reportId: string) => void;
  model?: string;
  onModelChange?: (m: string) => void;
}

export default function EMDashboard({ rootPath, theme: tk, onOpenFile, onStartCodeUnderstanding, codeUnderstanding, onDispatchToCrew, onOpenReportTab, model, onModelChange }: EMDashboardProps) {
  // ── EM Profile (avatar from crew API) ──
  const [emProfile, setEmProfile] = useState<{ codename?: string; imageUrl?: string; emoji?: string }>({});
  useEffect(() => {
    fetch(`${API_BASE}/api/coding-crew/coding.em`).then(r => r.json()).then(d => {
      setEmProfile({ codename: d.codename, imageUrl: d.imageUrl, emoji: d.emoji });
    }).catch(() => {});
  }, []);

  // ── Night Shift State ──
  const [nsRunning, setNsRunning] = useState(false);
  const [nsStatus, setNsStatus] = useState<string>("");
  const nightShiftPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up night shift poll on unmount
  useEffect(() => {
    return () => { if (nightShiftPollRef.current) clearInterval(nightShiftPollRef.current); };
  }, []);
  // emSinceDate/nsSinceDate removed — EM works from commit changes, user can give time commands in chat

  const startNightShift = async () => {
    setNsRunning(true);
    setNsStatus("啟動中...");
    setMessages(prev => [...prev, { role: "user", content: "🌙 啟動 Night Shift", ts: new Date().toISOString() }]);
    try {
      const res = await fetch(`${API_BASE}/api/coding-night-shift/start${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.ok) {
        setNsStatus("🌙 Night Shift 已啟動！6 個 agent 平行工作中...");
      } else {
        setNsStatus("❌ 啟動失敗: " + (data.error || "unknown"));
        setMessages(prev => [...prev, { role: "assistant", content: `❌ Night Shift 啟動失敗: ${data.error || "unknown"}`, ts: new Date().toISOString() }]);
        setNsRunning(false);
        return;
      }
    } catch (err: any) {
      setNsStatus("❌ " + err.message);
      setMessages(prev => [...prev, { role: "assistant", content: `❌ Night Shift error: ${err.message}`, ts: new Date().toISOString() }]);
      setNsRunning(false);
      return;
    }
    // Poll status and update chat
    const agentEmojis: Record<string,string> = { architect: "🏗️", developer: "💻", tester: "🧪", "doc-writer": "📝", qa: "🔍", helpdesk: "🎫" };
    let prevCompleted = 0;
    let progressMsg = "🌙 Night Shift 啟動中...";
    nightShiftPollRef.current = setInterval(async () => {
      try {
        const sr = await fetch(`${API_BASE}/api/coding-night-shift/status${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`);
        const sd = await sr.json();
        if (sd.status === "completed") {
          if (nightShiftPollRef.current) { clearInterval(nightShiftPollRef.current); nightShiftPollRef.current = null; }
          setNsRunning(false);
          const done = sd.completedAgents || 0;
          const total = sd.totalAgents || 6;
          setNsStatus(`✅ Night Shift 完成！${done}/${total} agents 完成，耗時 ${Math.round((sd.duration || 0) / 1000)}s`);
          // Build final chat message with per-agent results
          const agentResults = (sd.results || []).map((r: any) => {
            const e = agentEmojis[r.agentId] || "🤖";
            return `${e} ${r.agentId}: ${r.error ? "❌ " + r.error.slice(0, 80) : "✅ " + (r.summary || "完成").slice(0, 80)}`;
          }).join("\n");
          const nsActions: ChatAction[] = [
            { label: "📊完整報告", type: "openReport", reportId: "em-report" },
          ];
          // If any agent had errors, add retry actions
          const failedAgents = (sd.results || []).filter((r: any) => r.error);
          for (const fa of failedAgents) {
            const crewMap: Record<string, string> = { architect: "coding.architect", developer: "coding.developer", tester: "coding.tester", "doc-writer": "coding.doc-writer", qa: "coding.qa", helpdesk: "coding.helpdesk" };
            nsActions.push({ label: `🔄重試 ${fa.agentId}`, type: "dispatchCrew", crewId: crewMap[fa.agentId] || "", prompt: `Night Shift 發現錯誤：${fa.error.slice(0, 100)}\n請重新執行這個任務。` });
          }
          setMessages(prev => {
            const lastNs = [...prev].reverse().findIndex(m => (m as any)._nsProgress);
            if (lastNs >= 0) {
              const idx = prev.length - 1 - lastNs;
              const updated = [...prev];
              updated[idx] = { role: "assistant", content: `🌙 Night Shift 完成！${done}/${total} agents\n\n${agentResults || "詳見右側報告"}`, ts: new Date().toISOString(), actions: nsActions } as any;
              return updated;
            }
            return [...prev, { role: "assistant", content: `🌙 Night Shift 完成！${done}/${total} agents\n\n${agentResults || "詳見右側報告"}`, ts: new Date().toISOString(), actions: nsActions } as any];
          });
          refreshData();
        } else if (sd.status === "running") {
          const completed = sd.completedAgents || 0;
          const total = sd.totalAgents || 6;
          setNsStatus(`⏳ ${completed}/${total} agents 完成...`);
          // Update progress in chat
          if (completed > prevCompleted) {
            prevCompleted = completed;
            const agentList = (sd.agentStatuses || []).map((a: any) => {
              const e = agentEmojis[a.agentId] || "🤖";
              const s = a.status === "completed" ? "✅" : a.status === "running" ? "⏳" : a.status === "error" ? "❌" : "⏸️";
              return `${e} ${a.agentId}: ${s}`;
            }).join("\n");
            progressMsg = `🌙 Night Shift 進度 ${completed}/${total}:\n\n${agentList}`;
            setMessages(prev => {
              const lastNs = [...prev].reverse().findIndex(m => (m as any)._nsProgress);
              if (lastNs >= 0) {
                const idx = prev.length - 1 - lastNs;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], content: progressMsg } as any;
                return updated;
              }
              return [...prev, { role: "assistant", content: progressMsg, ts: new Date().toISOString(), _nsProgress: true } as any];
            });
          }
        } else if (sd.status === "failed" || sd.status === "interrupted" || sd.status === "error") {
          // Terminal states — stop polling
          if (nightShiftPollRef.current) { clearInterval(nightShiftPollRef.current); nightShiftPollRef.current = null; }
          setNsRunning(false);
          const errMsg = sd.error || sd.message || sd.status;
          setNsStatus(`❌ Night Shift 終止: ${errMsg.slice(0, 100)}`);
          setMessages(prev => {
            const lastNs = [...prev].reverse().findIndex(m => (m as any)._nsProgress);
            if (lastNs >= 0) {
              const idx = prev.length - 1 - lastNs;
              const updated = [...prev];
              updated[idx] = { role: "assistant", content: `❌ Night Shift 終止 (${sd.status})

${errMsg.slice(0, 200)}`, ts: new Date().toISOString() } as any;
              return updated;
            }
            return [...prev, { role: "assistant", content: `❌ Night Shift 終止 (${sd.status})

${errMsg.slice(0, 200)}`, ts: new Date().toISOString() } as any];
          });
        }
      } catch {}
    }, 5000);
  };

  // ── Chat State ──
  const EM_CHAT_ID = "coding.em";
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const prevMsgLenRef = useRef(0);
  const composingRef = useRef(false);
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
  // actionLog/report state removed — Night Shift tab handles both

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

  useEffect(() => { fetchEmSessions(); }, [fetchEmSessions]);
  const [emRunning, setEmRunning] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [showEmContextDebug, setShowEmContextDebug] = useState(false);
  const [emContextDebug, setEmContextDebug] = useState<any>(null);
  const [emAction, setEmAction] = useState(""); // current EM action (thinking vs tool)
  const [codeStatus, setCodeStatus] = useState<CodeStatus | null>(null);
  const [codeStatusLoading, setCodeStatusLoading] = useState(true);
  const [expandedArea, setExpandedArea] = useState<string | null>(null);
  const [showCUModal, setShowCUModal] = useState(false);
  const [singleStepRunning, setSingleStepRunning] = useState<string | null>(null); // step id being retried

  // ── CU step definitions (must match server) ──
  const CU_STEPS = [
    { id: "scan", name: "🔍 掃描專案結構", file: "scan.json" },
    { id: "architecture", name: "📐 Architecture Map", file: "ARCHITECTURE.md" },
    { id: "feature-map", name: "🗺️ Feature Map", file: "features/FEATURES.json" },
    { id: "api-spec", name: "📡 API Contract", file: "specs/api-contract.md" },
    { id: "code-intelligence", name: "🧠 Code Intelligence", file: "code-intelligence/summary.json" },
    { id: "test-intelligence", name: "🧪 Test Intelligence", file: "code-intelligence/test-intelligence.json" },
    { id: "error-mapping", name: "🐛 Error Map + Runbooks", file: "specs/error-codes.md" },
    { id: "security-scan", name: "🔒 Security Scan (Semgrep)", file: "security/scan-results.json" },
    { id: "standards", name: "🏛️ Coding Standards", file: "standards/coding-style.md" },
    { id: "overview", name: "📊 PROJECT.md", file: "PROJECT.md", checkOnly: true },
    { id: "change-intelligence", name: "🔄 Change Intelligence", file: "changes/change-intelligence.json" },
  ];

  // ── Code Health item → Crew + prompt mapping ──
  // When user clicks 🔧 on a missing/warn item, dispatch to the right crew with a pre-filled prompt
  const HEALTH_DISPATCH: Record<string, { crew: string; prompt: string }> = {
    // Architecture
    "Architecture Map": { crew: "coding.architect", prompt: "請根據目前專案程式碼，產出 ARCHITECTURE.md，包含系統架構圖、模組依賴關係、資料流動方向。" },
    "Decision Records": { crew: "coding.architect", prompt: "請檢查近期的重要技術決策，用 ADR 格式補進 DECISIONS.md。" },
    "PROJECT.md": { crew: "coding.doc-writer", prompt: "請根據目前專案狀態，更新 PROJECT.md，包含產品定位、技術棧、專案結構。" },
    // API
    "API Contract": { crew: "coding.architect", prompt: "請掃描所有 API routes，產出 specs/api-contract.md，列出每個 endpoint 的 method、path、request/response schema。" },
    "Error Mapping": { crew: "coding.developer", prompt: "請掃描所有 error code 和 exception，產出 specs/error-codes.md，定義每個 error 的 HTTP status、類型、處理方式。" },
    "Runbooks": { crew: "coding.helpdesk", prompt: "請根據已知的 error codes，為每個常見錯誤寫 runbook（診斷步驟 + 修復方式），存到 .paaw/runbook/。" },
    // Test
    "API Test Payloads": { crew: "coding.tester", prompt: "請根據 API contract，為每個 endpoint 產出 test payload JSON，存到 .paaw/test-payloads/。" },
    "Unit Tests": { crew: "coding.tester", prompt: "請檢查目前缺少 unit test 的模組，列出優先級並開始補測試。" },
    "E2E Tests": { crew: "coding.tester", prompt: "請評估是否需要 E2E 測試，如果需要，設定 playwright/cypress 並寫關鍵流程的 E2E 測試。" },
    // Docs
    "README": { crew: "coding.doc-writer", prompt: "請更新 README.md，確保包含：專案介紹、安裝步驟、使用方式、開發指南。" },
    "FAQ": { crew: "coding.helpdesk", prompt: "請根據已知 issues 和 common questions，產出 helpdesk/faq.md。" },
    "Changelog": { crew: "coding.doc-writer", prompt: "請根據最近的 git log，更新 CHANGELOG.md。" },
    // Maintainability
    "Coding Standards": { crew: "coding.qa", prompt: "請根據目前專案的 coding style，產出 standards/coding-style.md，包含命名規則、檔案結構、lint 規則。" },
  };

  // ── Load persisted step statuses when opening Modal ──
  const [persistedSteps, setPersistedSteps] = useState<Array<{ id: string; name: string; status: string; size?: number; error?: string }>>([]);
  const loadPersistedSteps = useCallback(async () => {
    if (!rootPath) return [];
    let steps: Array<{ id: string; name: string; status: string; size?: number; error?: string }> = [];
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/cu-status?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) {
        const data = await res.json();
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

  // ── Fetch data when rootPath changes ──
  const refreshData = useCallback(async () => {
    if (!rootPath) return;
    setCodeStatusLoading(true);
    // Fire all requests in parallel
    const [codeRes] = await Promise.allSettled([
      fetch(`${API_BASE}/api/coding-project/status?path=${encodeURIComponent(rootPath)}`).then(r => r.json()),
    ]);
    // codeRes intentionally ignored — just keeping the pattern for future use
    if (codeRes.status === "fulfilled") setCodeStatus(codeRes.value);
    setCodeStatusLoading(false);
  }, [rootPath]);

  useEffect(() => { refreshData(); }, [refreshData]);

  // ── Auto-trigger Code Understanding on first project open ──
  const autoCUTriggered = useRef(false);
  useEffect(() => {
    if (autoCUTriggered.current) return;
    if (!rootPath) return;
    if (codeStatus && !codeStatus.initialized && onStartCodeUnderstanding) {
      autoCUTriggered.current = true;
      loadPersistedSteps().then((steps) => {
        // If CU was already done before (>50% steps done), don't auto-popup
        const doneCount = (steps || []).filter((s: any) => s.status === "done").length;
        if (doneCount >= CU_STEPS.length * 0.5) {
          return; // Already done — stay silent
        }
        // .paaw deleted or never initialized — show modal but DON'T auto-start
        // Let user decide whether to run Code Understanding
        setShowCUModal(true);
      });
    }
  }, [rootPath, codeStatus, onStartCodeUnderstanding, loadPersistedSteps]);

  // ── When bulk Code Understanding finishes (running false→true→false), refresh persisted steps + code status ──
  const prevRunningRef = useRef(false);
  const [cuFinishCount, setCuFinishCount] = useState(0);
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
      refreshData();
      setCuFinishCount(c => c + 1);
    }
    prevRunningRef.current = !!isRunning;
  }, [codeUnderstanding?.running, loadPersistedSteps, refreshData]);

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
    setInput("");

    const userMsg: ChatMessage = { role: "user", content: text, ts: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Add thinking bubble
    const thinkId = Date.now();
    setMessages(prev => [...prev, { role: "assistant", content: "🎖️ 規劃中...", ts: new Date().toISOString(), _thinking: true }]);

    const ac = new AbortController();
    abortRef.current = ac;

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
          id: `em-chat-${thinkId}`,
        }),
        signal: ac.signal,
      });

      // Remove thinking bubble
      setMessages(prev => prev.filter(m => !m._thinking));

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let lastAssistantId: string | null = null;
      let currentEvent = ""; // Track SSE event name
      const toolLog: string[] = [];

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          // Track SSE event name
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));

            // ── Agent Loop SSE format (event: content, event: thinking, event: tool) ──
            if (currentEvent === "content" && d.content) {
              fullText = d.content;
              setMessages(prev => [...prev.filter(m => !m._thinking)]);
              setMessages(prev => [...prev, { role: "assistant", content: d.content, ts: new Date().toISOString() }]);
            } else if (currentEvent === "thinking" && d.content) {
              setEmAction("思考中");
              setMessages(prev => [...prev, { role: "assistant", content: `💭 ${d.content.slice(0, 200)}`, ts: new Date().toISOString(), _thinking: true }]);
            } else if (currentEvent === "tool" && d.name) {
              setEmAction(`🔧 ${d.name}`);
              toolLog.push(d.name);
              setMessages(prev => [...prev.filter(m => !m._thinking)]);
              setMessages(prev => [...prev, { role: "assistant", content: `🔧 執行: ${d.name}`, ts: new Date().toISOString(), _thinking: true }]);
            } else if (currentEvent === "error" && d.error) {
              setMessages(prev => [...prev.filter(m => !m._thinking)]);
              setMessages(prev => [...prev, { role: "assistant", content: `❌ Error: ${typeof d.error === "string" ? d.error : d.error.error || d.error.message || "unknown"}`, ts: new Date().toISOString() }]);
              fullText = "__error__";
            } else if (currentEvent === "info" && d.message) {
              setMessages(prev => [...prev, { role: "assistant", content: d.message, ts: new Date().toISOString(), _thinking: true }]);
            }
            // ── A2A JSON-RPC format (message/send non-streaming) ──
            else if (d.result) {
              const r = d.result;
              if (r.artifacts?.[0]?.parts?.[0]?.text) {
                fullText = r.artifacts[0].parts[0].text;
                setMessages(prev => [...prev.filter(m => !m._thinking)]);
                setMessages(prev => [...prev, { role: "assistant", content: fullText, ts: new Date().toISOString() }]);
              }
            }
            // ── JSON-RPC error ──
            else if (d.error) {
              setMessages(prev => [...prev.filter(m => !m._thinking)]);
              setMessages(prev => [...prev, { role: "assistant", content: `❌ Error: ${d.error.message || "unknown"}`, ts: new Date().toISOString() }]);
              fullText = "__error__";
            }

            currentEvent = ""; // Reset after processing data
          } catch {}
        }
      }

      // If stream ended with content but not yet added as message, add it now
      if (fullText && fullText !== "__error__") {
        setMessages(prev => {
          const filtered = prev.filter(m => !m._thinking);
          // Check if content already exists
          if (filtered.some(m => m.role === "assistant" && m.content === fullText)) return filtered;
          return [...filtered, { role: "assistant", content: fullText, ts: new Date().toISOString() }];
        });
      } else if (!fullText && !toolLog.length) {
        // No content at all — show fallback
        setMessages(prev => [...prev.filter(m => !m._thinking)]);
        setMessages(prev => [...prev, { role: "assistant", content: "（AI 回應完成但無文字內容）", ts: new Date().toISOString() }]);
      }

      // Refresh action log after EM responds
      refreshData();
    } catch (err: any) {
      setMessages(prev => [...prev.filter(m => !m._thinking)]);
      if (err.name === "AbortError") {
        setMessages(prev => [...prev, { role: "assistant", content: "⏹️ 已中斷", ts: new Date().toISOString() }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.message}`, ts: new Date().toISOString() }]);
      }
    }
    abortRef.current = null;
    setEmAction("");
    setLoading(false);
  };

  const stopAgent = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  };

  // ── EM Auto-orchestrate: Phase 1 — Plan only (show in chat for confirmation) ──
  const runEM = async () => {
    if (emRunning || !rootPath) return;
    setEmRunning(true);
    setPendingPlan(null);
    setMessages(prev => [...prev, { role: "user", content: "🚀 啟動 EM 調度規劃", ts: new Date().toISOString() }]);

    // Add thinking bubble
    setMessages(prev => [...prev, { role: "assistant", content: "🎖️ 收集專案狀態中...", ts: new Date().toISOString(), _thinking: true }]);

    try {
      const res = await fetch(`${API_BASE}/api/coding-crew/em-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: rootPath, model: model || undefined }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let plannedWorkList: any[] = [];
      let situationReport = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));

            // info messages — show as thinking updates
            if (d.message && !d.workList && !d.totalTasks) {
              setMessages(prev => {
                const lastThink = [...prev].reverse().findIndex(m => m._thinking);
                if (lastThink >= 0) {
                  const idx = prev.length - 1 - lastThink;
                  const updated = [...prev];
                  updated[idx] = { ...updated[idx], content: `🎖️ ${d.message}` } as any;
                  return updated;
                }
                return prev;
              });
            }

            // plan_ready — show plan in chat with confirm/cancel buttons
            if (d.workList) {
              plannedWorkList = d.workList;
              situationReport = d.situationReport || "";
              setMessages(prev => [...prev.filter(m => !m._thinking)]);

              if (d.workList.length === 0) {
                setMessages(prev => [...prev, {
                  role: "assistant",
                  content: "✅ 目前沒有需要調度的工作，專案狀態良好。",
                  ts: new Date().toISOString(),
                }]);
              } else {
                const priorityIcon: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };
                const agentIcon: Record<string, string> = {
                  architect: "🏛️", developer: "💻", tester: "🧪",
                  "doc-writer": "📝", qa: "🔬", helpdesk: "🌸",
                };
                const planText = d.workList.map((w: any, i: number) => {
                  const pi = priorityIcon[w.priority as string] || "⚪";
                  const ai = agentIcon[w.agent as string] || "🔧";
                  return `### ${pi} ${i + 1}. ${ai} ${w.agent}\n\n**任務：** ${w.task}${w.reason ? `\n\n> 💡 ${w.reason}` : ""}`;
                }).join("\n---\n\n");

                setMessages(prev => [...prev, {
                  role: "assistant",
                  content: `## 📋 EM 調度規劃\n\n共 **${d.workList.length}** 項工作，確認後開始執行：\n\n---\n\n${planText}`,
                  ts: new Date().toISOString(),
                  actions: [
                    { label: "✅ 確認執行", type: "confirmPlan", planData: { workList: d.workList, situationReport } },
                    { label: "❌ 取消", type: "cancelPlan" },
                  ],
                } as any]);
              }
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setMessages(prev => [...prev.filter(m => !m._thinking)]);
      setMessages(prev => [...prev, { role: "assistant", content: `❌ EM error: ${err.message}`, ts: new Date().toISOString() }]);
    }
    setEmRunning(false);
  };

  // ── EM Execute confirmed plan ──
  const confirmEMPlan = async (plan: PendingPlan) => {
    if (emRunning || !rootPath) return;
    setEmRunning(true);
    setPendingPlan(null);
    setMessages(prev => [...prev, { role: "user", content: "✅ 確認執行 EM 調度計畫", ts: new Date().toISOString() }]);

    try {
      const res = await fetch(`${API_BASE}/api/coding-crew/em-execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: rootPath, workList: plan.workList, situationReport: plan.situationReport, model: model || undefined }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const completedSteps: { stepId: string; name: string; summary: string; reportId?: string }[] = [];

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            const agentIcon: Record<string, string> = {
              architect: "🏛️", developer: "💻", tester: "🧪",
              "doc-writer": "📝", qa: "🔬", helpdesk: "🌸",
            };

            // task_start
            if (d.agent && d.task && d.preview === undefined && d.error === undefined) {
              const ai = agentIcon[d.agent as string] || "🔧";
              setMessages(prev => [...prev, {
                role: "assistant",
                content: `### ⏳ ${ai} ${d.agent} 執行中...\n\n${d.task}\n\n\`[${d.index}/${d.total}]\``,
                ts: new Date().toISOString(),
                _emProgress: true,
              } as any]);
            }

            // task_done
            if (d.agent && d.preview !== undefined) {
              const ai = agentIcon[d.agent as string] || "🔧";
              completedSteps.push({ stepId: d.agent, name: d.agent, summary: d.preview });
              setMessages(prev => {
                const lastProg = [...prev].reverse().findIndex(m => m._emProgress);
                if (lastProg >= 0) {
                  const idx = prev.length - 1 - lastProg;
                  const updated = [...prev];
                  updated[idx] = { role: "assistant", content: `### ✅ ${ai} ${d.agent} 完成\n\n${d.preview.slice(0, 300)}`, ts: new Date().toISOString() } as any;
                  return updated;
                }
                return [...prev, { role: "assistant", content: `✅ **${d.agent}** — ${d.preview.slice(0, 200)}`, ts: new Date().toISOString() } as any];
              });
            }

            // task_error
            if (d.agent && d.error) {
              setMessages(prev => {
                const lastProg = [...prev].reverse().findIndex(m => m._emProgress);
                if (lastProg >= 0) {
                  const idx = prev.length - 1 - lastProg;
                  const updated = [...prev];
                  updated[idx] = { role: "assistant", content: `❌ **${d.agent}** — ${d.error}`, ts: new Date().toISOString() } as any;
                  return updated;
                }
                return [...prev, { role: "assistant", content: `❌ **${d.agent}** — ${d.error}`, ts: new Date().toISOString() } as any];
              });
            }
          } catch {}
        }
      }

      // Final summary
      const finalActions: ChatAction[] = [];
      if (completedSteps.length > 0) {
        finalActions.push({ label: "📊完整報告", type: "openReport", reportId: "em-report" });
      }
      const summaryText = `🎖️ EM 調度完成！完成 ${completedSteps.length} 項工作。\n\n${completedSteps.map(s => `  ✅ ${s.name}: ${s.summary.slice(0, 100)}`).join("\n")}`;
      setMessages(prev => [...prev, { role: "assistant", content: summaryText, ts: new Date().toISOString(), actions: finalActions }]);
      refreshData();
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ EM error: ${err.message}`, ts: new Date().toISOString() }]);
    }
    setEmRunning(false);
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
        body: JSON.stringify({ step: stepId }),
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
      // Refresh code status after single step
      try {
        const stRes = await fetch(`${API_BASE}/api/coding-project/status?path=${encodeURIComponent(rootPath)}`);
        const stData = await stRes.json();
        setCodeStatus(stData);
      } catch {}
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
    <div className="flex-1 flex min-w-0 overflow-hidden">
      {/* ════════ LEFT: EM Chat (60%) ════════ */}
      <div className="flex-1 flex flex-col min-w-0 border-r" style={{ borderColor: tk.borderLight }}>
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
              {/* Divider */}
              <div className="w-px h-5 bg-stone-200 mx-1" />
              {/* EM-specific action buttons */}
              <button
                onClick={runEM}
                disabled={emRunning}
                className={cn("text-xs px-3 py-1 rounded-md font-bold flex items-center gap-1",
                  emRunning ? "bg-stone-200 text-stone-400 cursor-not-allowed" : "bg-amber-600 text-white hover:bg-amber-700")}
              >
                {emRunning ? "⏳" : "🚀 EM"}
              </button>
              <button
                onClick={startNightShift}
                disabled={nsRunning}
                className={cn("text-xs px-3 py-1 rounded-md font-bold flex items-center gap-1",
                  nsRunning ? "bg-stone-200 text-stone-400 cursor-not-allowed" : "bg-indigo-600 text-white hover:bg-indigo-700")}
                title="掃描今天的 git 變更，自動派 6 個 agent 補測試/補文件/做 Code Review"
              >
                {nsRunning ? "⏳" : "🌙"}
              </button>
            </div>
          </div>
          {/* Night Shift status line */}
          {!nsRunning && nsStatus && <div className="text-[11px] text-indigo-600 mt-1">{nsStatus}</div>}
          {nsRunning && nsStatus && <div className="text-[11px] text-indigo-600 mt-1 animate-pulse">{nsStatus}</div>}
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

        {/* Chat Messages */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "thin" }}>
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
                              // Open report tab
                              if (onOpenReportTab) {
                                onOpenReportTab(action.reportId);
                              } else if (onOpenFile) {
                                // Fallback: open file
                                if (action.reportId === "security") {
                                  onOpenFile(".paaw/security/scan-results.json");
                                }
                              }
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

        {/* Input */}
        <div className="px-4 py-3 border-t" style={{ borderColor: tk.borderLight }}>
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
              placeholder={`跟 ${emProfile.codename || "EM 大總管"}對話... (Enter 送出, Shift+Enter 換行)`}
              rows={1}
              className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              style={{ borderColor: tk.borderLight, backgroundColor: tk.bg }}
            />
            <button
              onClick={loading ? stopAgent : sendMessage}
              disabled={!loading && !input.trim()}
              className={cn("px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                loading
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : input.trim() ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-stone-200 text-stone-400")}
            >
              {loading ? "中斷" : "送出"}
            </button>
          </div>
        </div>
      </div>

      {/* ════════ RIGHT: Overview Panels (40%) ════════ */}
      <div className="w-[40%] min-w-[280px] max-w-[480px] flex flex-col overflow-y-auto" style={{ scrollbarWidth: "thin", backgroundColor: tk.bgMuted }}>
        {/* Project Status + Git Changes Preview removed */}
        {/* Git Changes Preview removed — EM chat works from commit changes directly */}

        {/* ── Code Health (from Code Understanding) ── */}
        <div className="px-4 py-3 border-b" style={{ borderColor: tk.borderLight }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-stone-700 flex items-center gap-1.5">
              <span>📊</span> Code Health
            </h3>
            {!codeStatus && codeStatusLoading && rootPath && (
              <button disabled className="text-sm px-2 py-1 rounded bg-stone-200 text-stone-400 font-bold cursor-wait">⚡ 載入中...</button>
            )}
            {!codeStatus && !codeStatusLoading && rootPath && (
              <button
                onClick={() => { loadPersistedSteps(); setShowCUModal(true); }}
                className="text-sm px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
              >🧠 Code Understanding</button>
            )}
            {codeStatus && (
              <button
                onClick={() => { loadPersistedSteps(); setShowCUModal(true); }}
                className="text-sm px-2 py-1 rounded bg-stone-100 text-stone-600 hover:bg-stone-200 font-bold"
              >🔄 重新掃描</button>
            )}
          </div>
          {!codeStatus && codeStatusLoading ? (
            <p className="text-sm text-stone-400 py-2">⚡ 載入中...</p>
          ) : !codeStatus ? (
            <p className="text-sm text-stone-400 py-2">尚未 Code Understanding。點 🧠 產生健康度報告。</p>
          ) : !codeStatus.initialized ? (
            <p className="text-sm text-stone-400 py-2">尚未初始化。</p>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(codeStatus.scores).map(([area, data]) => (
                <div key={area}>
                  <div
                    className="flex items-center gap-2 cursor-pointer select-none"
                    onClick={() => setExpandedArea(expandedArea === area ? null : area)}
                  >
                    <span className="text-sm text-stone-300 w-3">{expandedArea === area ? "▼" : "▶"}</span>
                    <span className="text-sm font-semibold text-stone-600 capitalize flex-1">{area.replace(/[-_]/g, " ")}</span>
                    <div className="w-16 h-1.5 rounded-full bg-stone-200 overflow-hidden">
                      <div className={cn("h-full rounded-full", data.score >= 80 ? "bg-green-500" : data.score >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${data.score}%` }} />
                    </div>
                    <span className={cn("text-sm font-bold", data.score >= 80 ? "text-green-600" : data.score >= 50 ? "text-amber-600" : "text-red-600")}>{data.score}</span>
                  </div>
                  {expandedArea === area && (
                    <div className="ml-5 mt-1 space-y-0.5">
                      {data.items.map((item, i) => {
                        const dispatch = (item.status === "missing" || item.status === "warn") ? HEALTH_DISPATCH[item.name] : null;
                        return (
                        <div key={i} className="flex items-center gap-1.5 text-sm">
                          <span className={item.status === "done" || item.status === "ok" ? "text-green-500" : item.status === "partial" || item.status === "warn" ? "text-amber-500" : item.status === "missing" ? "text-red-400" : "text-stone-400"}>
                            {item.status === "done" || item.status === "ok" ? "✅" : item.status === "partial" || item.status === "warn" ? "🟡" : item.status === "missing" ? "❌" : "ℹ️"}
                          </span>
                          <span className="text-stone-500 flex-1">{item.name}</span>
                          {item.detail && item.status !== "ok" && item.status !== "info" && (
                            <span className="text-xs text-stone-300">{item.detail}</span>
                          )}
                          {dispatch && onDispatchToCrew && (
                            <button
                              onClick={() => onDispatchToCrew(dispatch.crew, dispatch.prompt)}
                              className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-bold shrink-0 transition-colors"
                              title={`派交 ${dispatch.crew}`}
                            >🔧</button>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent Activity + Overnight Report removed — Night Shift tab handles reports */}

        {/* ── 專案知識面板 (Project Knowledge) ── */}
        <ProjectKnowledgePanel rootPath={rootPath} tk={tk} onOpenFile={onOpenFile} refreshTrigger={cuFinishCount} />

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
                  onClick={() => { if (onStartCodeUnderstanding) { onStartCodeUnderstanding(); } }}
                  disabled={singleStepRunning !== null}
                  className="px-4 py-1.5 text-sm font-bold rounded-lg border transition-colors disabled:opacity-50"
                  style={{ borderColor: "#bbf7d0", color: "#059669", backgroundColor: "#f0fdf4" }}
                >
                  🚀 全部執行
                </button>
              )}
              {/* Close button — replaces 完成 ✅ */}
              {!isBulkRunning && !singleStepRunning && (
                <button onClick={() => { setShowCUModal(false); refreshData(); }} className="px-4 py-1.5 text-sm font-bold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700">
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

// ── 專案知識面板 (Project Knowledge) ──
interface KnowledgeFile {
  path: string;
  icon: string;
  label: string;
  cuStep?: string; // which CU step produces this file
}
const KNOWLEDGE_FILES: KnowledgeFile[] = [
  // CU 產出的核心檔案
  { path: ".paaw/PROJECT.md", icon: "📋", label: "PROJECT.md", cuStep: "overview" },
  { path: ".paaw/ARCHITECTURE.md", icon: "📐", label: "Architecture Map", cuStep: "architecture" },
  { path: ".paaw/features/FEATURES.json", icon: "🗺️", label: "Feature Map", cuStep: "feature-map" },
  { path: ".paaw/specs/api-contract.md", icon: "📡", label: "API Contract", cuStep: "api-spec" },
  { path: ".paaw/specs/error-codes.md", icon: "🐛", label: "Error Mapping", cuStep: "error-mapping" },
  { path: ".paaw/standards/coding-style.md", icon: "🏛️", label: "Coding Standards", cuStep: "standards" },
  { path: ".paaw/code-intelligence/summary.json", icon: "🧠", label: "Code Intelligence", cuStep: "code-intelligence" },
  { path: ".paaw/code-intelligence/test-intelligence.json", icon: "🧪", label: "Test Intelligence", cuStep: "test-intelligence" },
  { path: ".paaw/security/scan-results.json", icon: "🔒", label: "Security Scan", cuStep: "security-scan" },
  { path: ".paaw/changes/change-intelligence.json", icon: "🔄", label: "Change Intelligence", cuStep: "change-intelligence" },
  // Agent 維護的檔案（非 CU 產出，但重要）
  { path: ".paaw/DECISIONS.md", icon: "🧠", label: "Decision Log" },
  { path: ".paaw/CHANGELOG.md", icon: "📝", label: "Change Memory" },
];

function ProjectKnowledgePanel({ rootPath, tk, onOpenFile, refreshTrigger }: { rootPath: string; tk: any; onOpenFile?: (p: string) => void; refreshTrigger?: number }) {
  const [knowledgeStatuses, setFileStatuses] = useState<Record<string, "ok" | "template" | "missing">>({});

  useEffect(() => {
    if (!rootPath) return;
    const checkFiles = async () => {
      const results: Record<string, "ok" | "template" | "missing"> = {};
      for (const f of KNOWLEDGE_FILES) {
        try {
          const filePath = f.path.replace(/^\.paaw\//, "");
          const res = await fetch(`${API_BASE}/api/coding-project/file?path=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(filePath)}`);
          if (!res.ok) { results[f.path] = "missing"; continue; }
          const content = await res.text();
          // JSON files: check if valid JSON with content
          if (f.path.endsWith(".json")) {
            try {
              const parsed = JSON.parse(content);
              const hasContent = JSON.stringify(parsed).length > 20;
              results[f.path] = hasContent ? "ok" : "template";
            } catch {
              results[f.path] = "template";
            }
            continue;
          }
          // Markdown files: check for real content
          if (!content.trim() || content.includes("(待補充)") || content.includes("(auto-detect)") || content.length < 50) {
            results[f.path] = "template";
          } else {
            results[f.path] = "ok";
          }
        } catch {
          results[f.path] = "missing";
        }
      }
      setFileStatuses(results);
    };
    checkFiles();
  }, [rootPath, refreshTrigger]);

  const okCount = Object.values(knowledgeStatuses).filter(s => s === "ok").length;
  const total = KNOWLEDGE_FILES.length;
  const missingCount = Object.values(knowledgeStatuses).filter(s => s === "missing").length;
  const isInitial = missingCount === total; // all missing = brand new project
const pct = total > 0 ? Math.round((okCount / total) * 100) : 0;

  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: tk.borderLight }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-stone-700 flex items-center gap-1.5">
          <span>📚</span> 專案知識
        </h3>
        {isInitial ? (
          <span className="text-xs font-bold text-stone-400">🌱 Initial</span>
        ) : (
          <span className={cn("text-xs font-bold", pct === 100 ? "text-green-600" : pct >= 50 ? "text-amber-600" : "text-red-500")}>
            {okCount}/{total} ({pct}%)
          </span>
        )}
      </div>
      {/* Progress bar */}
      {isInitial ? (
        <div className="text-xs text-stone-400 py-2">🌱 專案剛建立，知識庫尚未產生</div>
      ) : (
        <div className="w-full h-1.5 rounded-full bg-stone-200 overflow-hidden mb-2">
          <div className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${pct}%` }} />
        </div>
      )}
      {/* File list */}
      <div className="space-y-1">
        {KNOWLEDGE_FILES.map(f => {
          const st = knowledgeStatuses[f.path] || "missing";
          return (
            <button
              key={f.path}
              onClick={() => onOpenFile?.(`${rootPath}/${f.path}`)}
              className="flex items-center gap-2 text-sm w-full hover:bg-stone-50 rounded px-1.5 py-1 transition-colors"
            >
              <span className="shrink-0">{f.icon}</span>
              <span className="text-stone-600 flex-1 text-left truncate">{f.label}</span>
              <span className="shrink-0 text-xs">
                {st === "ok" ? <span className="text-green-500">✅</span> : st === "template" ? <span className="text-amber-500">⚠️</span> : <span className="text-red-400">❌</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
