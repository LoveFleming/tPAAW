/**
 * EMDashboard — Engineering Manager 大總管 Landing Page
 *
 * 佈局：
 *   左側 (60%): EM Chat 對話視窗
 *   右側 (40%): Project Overview + Agent Activity + Overnight Report
 */
import { useState, useEffect, useRef, useCallback } from "react";
import API_BASE from "../api";
import ChatMessages from "./ChatMessages";
import ModelSelector from "./ModelSelector";
import { cn } from "../utils";

interface ChatMessage {
  role: string;
  content: string;
  ts?: string;
  _thinking?: boolean;
  _streamId?: string | null;
}

interface ActionLogEntry {
  ts: string;
  agent: string;
  action: string;
  summary: string;
  result: string;
  priority?: string;
}

interface ProjectStatus {
  gitStatus: string;
  recentCommits: string;
  unpushed: string;
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
  model?: string;
  onModelChange?: (m: string) => void;
}

export default function EMDashboard({ rootPath, theme: tk, onOpenFile, onStartCodeUnderstanding, codeUnderstanding, onDispatchToCrew, model, onModelChange }: EMDashboardProps) {
  // ── Night Shift State ──
  const [nsRunning, setNsRunning] = useState(false);
  const [nsStatus, setNsStatus] = useState<string>("");

  const startNightShift = async () => {
    setNsRunning(true);
    setNsStatus("啟動中...");
    try {
      const res = await fetch(`${API_BASE}/api/coding-night-shift/start${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setNsStatus("🌙 Night Shift 已啟動！6 個 agent 平行工作中...");
      } else {
        setNsStatus("❌ 啟動失敗: " + (data.error || "unknown"));
      }
    } catch (err: any) {
      setNsStatus("❌ " + err.message);
    }
    // Don't set nsRunning false immediately — poll status
    const poll = setInterval(async () => {
      try {
        const sr = await fetch(`${API_BASE}/api/coding-night-shift/status${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`);
        const sd = await sr.json();
        if (sd.status === "completed") {
          clearInterval(poll);
          setNsRunning(false);
          const done = sd.completedAgents || 0;
          const total = sd.totalAgents || 6;
          setNsStatus(`✅ Night Shift 完成！${done}/${total} agents 完成，耗時 ${Math.round((sd.duration || 0) / 1000)}s`);
          // Refresh data to show overnight report
          setTimeout(() => window.location.reload(), 2000);
        } else if (sd.status === "running") {
          setNsStatus(`⏳ ${sd.completedAgents}/${sd.totalAgents} agents 完成...`);
        }
      } catch {}
    }, 5000);
  };

  // ── Chat State ──
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "🎖️ 我是 EM 大總管。我可以幫你規劃工作、調度 agent、審查進度。\n\n告訴我你想做什麼，或點「🚀 EM 自動調度」讓我自動規劃。", ts: new Date().toISOString() },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  // ── Project Status ──
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [emRunning, setEmRunning] = useState(false);
  const [emLog, setEmLog] = useState<string[]>([]);
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
    const [gitRes, logRes, codeRes, reportRes] = await Promise.allSettled([
      fetch(`${API_BASE}/api/vibe-git/status?path=${encodeURIComponent(rootPath)}`).then(r => r.json()),
      fetch(`${API_BASE}/api/coding-crew/action-log?limit=15`).then(r => r.json()),
      fetch(`${API_BASE}/api/coding-project/status?path=${encodeURIComponent(rootPath)}`).then(r => r.json()),
      fetch(`${API_BASE}/api/coding-crew/overnight-report?path=${encodeURIComponent(rootPath)}`).then(r => r.json()),
    ]);
    if (gitRes.status === "fulfilled") setStatus(prev => ({ ...prev, gitStatus: gitRes.value.summary || "clean", recentCommits: "", unpushed: "" }));
    if (logRes.status === "fulfilled") setActionLog(logRes.value.entries || []);
    if (codeRes.status === "fulfilled") setCodeStatus(codeRes.value);
    setCodeStatusLoading(false);
    if (reportRes.status === "fulfilled") setReport(reportRes.value.exists ? reportRes.value.report : null);
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
        setShowCUModal(true);
        setTimeout(() => onStartCodeUnderstanding!(), 300);
      });
    }
  }, [rootPath, codeStatus, onStartCodeUnderstanding, loadPersistedSteps]);

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
      refreshData();
    }
    prevRunningRef.current = !!isRunning;
  }, [codeUnderstanding?.running, loadPersistedSteps, refreshData]);

  // ── Auto scroll ──
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

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

    try {
      const res = await fetch(`${API_BASE}/a2a/architect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: { role: "user", parts: [{ type: "text", text }] },
            context: { cwd: rootPath },
            conversationHistory: messages.filter(m => !m._thinking).slice(-20),
            ...(model ? { metadata: { model } } : {}),
          },
          id: `em-chat-${thinkId}`,
        }),
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
              setMessages(prev => [...prev, { role: "assistant", content: `💭 ${d.content.slice(0, 200)}`, ts: new Date().toISOString(), _thinking: true }]);
            } else if (currentEvent === "tool" && d.name) {
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
      setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.message}`, ts: new Date().toISOString() }]);
    }
    setLoading(false);
  };

  // ── EM Auto-orchestrate ──
  const runEM = async () => {
    if (emRunning || !rootPath) return;
    setEmRunning(true);
    setEmLog([]);
    setMessages(prev => [...prev, { role: "user", content: "🚀 啟動 EM 自動調度", ts: new Date().toISOString() }]);

    try {
      const res = await fetch(`${API_BASE}/api/coding-crew/em-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: rootPath }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const logLines: string[] = [];

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
            if (d.message) {
              logLines.push(d.message);
              setEmLog([...logLines]);
            }
            if (d.type === "report" && d.report) {
              setReport(d.report);
            }
          } catch {}
        }
      }

      // Add EM result to chat
      const summary = logLines.filter(l => l.includes("✅") || l.includes("❌") || l.includes("完成")).pop() || "EM 調度完成";
      setMessages(prev => [...prev, { role: "assistant", content: `🎖️ ${summary}\n\n詳細報告請看右側「隔天報告」面板。`, ts: new Date().toISOString() }]);
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
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b" style={{ borderColor: tk.borderLight, backgroundColor: tk.bgMuted }}>
          <span className="text-lg">🎖️</span>
          <span className="text-sm font-bold text-stone-700">EM 大總管</span>
          <span className="text-sm text-stone-400">Engineering Manager</span>
          <div className="flex-1" />
          {onModelChange && (
            <ModelSelector feature="codingIDE" value={model || ""} onChange={onModelChange} />
          )}
          <button
            onClick={runEM}
            disabled={emRunning}
            className={cn("text-sm px-3 py-1 rounded-md font-bold flex items-center gap-1",
              emRunning ? "bg-stone-200 text-stone-400 cursor-not-allowed" : "bg-amber-600 text-white hover:bg-amber-700")}
          >
            {emRunning ? "⏳ 執行中..." : "🚀 EM 自動調度"}
          </button>
          <button
            onClick={startNightShift}
            disabled={nsRunning}
            className={cn("text-sm px-3 py-1 rounded-md font-bold flex items-center gap-1",
              nsRunning ? "bg-stone-200 text-stone-400 cursor-not-allowed" : "bg-indigo-600 text-white hover:bg-indigo-700")}
            title="掃描今天的 git 變更，自動派 6 個 agent 補測試/補文件/做 Code Review"
          >
            {nsRunning ? `⏳ ${nsStatus}` : "🌙 Night Shift"}
          </button>
          {!nsRunning && nsStatus && <span className="text-xs text-indigo-600">{nsStatus}</span>}
        </div>

        {/* EM running progress */}
        {emLog.length > 0 && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 max-h-32 overflow-y-auto">
            {emLog.map((line, i) => (
              <div key={i} className="text-sm text-amber-800 leading-relaxed">{line}</div>
            ))}
            {emRunning && <div className="text-sm text-amber-600 animate-pulse">⏳ 執行中...</div>}
          </div>
        )}

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "thin" }}>
          <ChatMessages messages={messages} loading={loading} accent={tk.accent} />
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
              placeholder="跟 EM 大總管對話... (Enter 送出, Shift+Enter 換行)"
              rows={1}
              className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              style={{ borderColor: tk.borderLight, backgroundColor: tk.bg }}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className={cn("px-4 py-2 rounded-lg text-sm font-bold",
                loading || !input.trim() ? "bg-stone-200 text-stone-400" : "bg-amber-600 text-white hover:bg-amber-700")}
            >
              送出
            </button>
          </div>
        </div>
      </div>

      {/* ════════ RIGHT: Overview Panels (40%) ════════ */}
      <div className="w-[40%] min-w-[280px] max-w-[480px] flex flex-col overflow-y-auto" style={{ scrollbarWidth: "thin", backgroundColor: tk.bgMuted }}>
        {/* ── Project Status Card ── */}
        <div className="px-4 py-3 border-b" style={{ borderColor: tk.borderLight }}>
          <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-1.5">
            <span>📊</span> Project Status
          </h3>
          <div className="space-y-1.5">
            <StatusRow icon="📁" label="Git" value={status?.gitStatus || "checking..."} ok={!status?.gitStatus?.includes("modified") && !status?.gitStatus?.includes("Untracked")} />
            <StatusRow icon="🔄" label="Unpushed" value={status?.unpushed || "none"} ok={!status?.unpushed} />
            <StatusRow icon="📦" label="Path" value={rootPath.split("/").slice(-2).join("/")} ok />
          </div>
        </div>

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

        {/* ── Agent Activity (Action Log) ── */}
        <div className="px-4 py-3 border-b" style={{ borderColor: tk.borderLight }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-stone-700 flex items-center gap-1.5">
              <span>⚡</span> Agent Activity
            </h3>
            <button onClick={refreshData} className="text-sm text-stone-400 hover:text-stone-600">↻</button>
          </div>
          {actionLog.length === 0 ? (
            <p className="text-sm text-stone-400 py-2">尚無 agent 活動紀錄</p>
          ) : (
            <div className="space-y-1.5">
              {actionLog.slice(0, 10).map((entry, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-stone-300 shrink-0">{entry.ts?.slice(11, 16) || "--:--"}</span>
                  <span className="shrink-0 font-semibold" style={{
                    color: entry.agent === "architect" ? "#DC2626" :
                           entry.agent === "developer" ? "#0891B2" :
                           entry.agent === "tester" ? "#BE185D" :
                           entry.agent === "doc-writer" ? "#D97706" :
                           entry.agent === "qa" ? "#059669" :
                           entry.agent === "em" ? "#6D28D9" :
                           "#78716C"
                  }}>
                    {entry.agent}
                  </span>
                  <span className="text-stone-600 truncate flex-1" title={entry.summary}>{entry.summary}</span>
                  <span className="shrink-0 text-stone-300">[{entry.result}]</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Overnight Report ── */}
        <div className="px-4 py-3 border-b" style={{ borderColor: tk.borderLight }}>
          <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-1.5">
            <span>📅</span> 隔天報告
          </h3>
          {report ? (
            <details>
              <summary className="text-sm text-amber-700 cursor-pointer hover:text-amber-800">
                {report.split("\n")[0]?.replace(/^#\s*/, "") || "View report"}
              </summary>
              <pre className="mt-2 text-sm text-stone-600 whitespace-pre-wrap max-h-60 overflow-y-auto bg-white rounded p-2 border" style={{ borderColor: tk.borderLight }}>
                {report}
              </pre>
            </details>
          ) : (
            <p className="text-sm text-stone-400 py-2">尚無隔天報告。點「🚀 EM 自動調度」產生。</p>
          )}
        </div>

        {/* ── 專案知識面板 (Project Knowledge) ── */}
        <ProjectKnowledgePanel rootPath={rootPath} tk={tk} onOpenFile={onOpenFile} />

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
    </>
  );
}

// ── Helper: Status Row ──
function StatusRow({ icon, label, value, ok }: { icon: string; label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span>{icon}</span>
      <span className="font-semibold text-stone-500 w-16 shrink-0">{label}</span>
      <span className={cn("truncate flex-1", ok ? "text-green-600" : "text-amber-600")} title={value}>{value}</span>
      <span className="shrink-0">{ok ? "✅" : "⚠️"}</span>
    </div>
  );
}

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

function ProjectKnowledgePanel({ rootPath, tk, onOpenFile }: { rootPath: string; tk: any; onOpenFile?: (p: string) => void }) {
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
  }, [rootPath]);

  const okCount = Object.values(knowledgeStatuses).filter(s => s === "ok").length;
  const total = KNOWLEDGE_FILES.length;
const pct = total > 0 ? Math.round((okCount / total) * 100) : 0;

  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: tk.borderLight }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-stone-700 flex items-center gap-1.5">
          <span>📚</span> 專案知識
        </h3>
        <span className={cn("text-xs font-bold", pct === 100 ? "text-green-600" : pct >= 50 ? "text-amber-600" : "text-red-500")}>
          {okCount}/{total} ({pct}%)
        </span>
      </div>
      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full bg-stone-200 overflow-hidden mb-2">
        <div className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${pct}%` }} />
      </div>
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
