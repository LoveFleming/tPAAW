/**
 * NightShiftPanel — Night Shift 統一介面
 *
 * 整合：
 * - Mode 切換（EM 智慧調度 / 全員平行）
 * - 即時狀態 + 報告
 * - 排程設定 + Model 設定
 * - 歷史報告列表（含 ReportsTab 功能）
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ModelSelector from "./ModelSelector";

interface AgentStatus {
  status: "completed" | "failed" | "skipped" | "running";
  codename?: string;
  result?: string;
  report?: string;
  error?: string;
}

interface NightShiftStatus {
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  status: "running" | "completed" | "never" | "error";
  mode?: string;
  agents: Record<string, AgentStatus>;
  totalAgents: number;
  completedAgents: number;
  report?: string;
  message?: string;
}

interface ReportListItem {
  date: string;
  filename: string;
  size: number;
  modified: string;
  result: string;
  summary: string;
  mode: string;
}

const AGENT_INFO: Record<string, { icon: string; label: string }> = {
  architect: { icon: "🏛️", label: "Architect" },
  developer: { icon: "💻", label: "Developer" },
  tester: { icon: "🧪", label: "Tester" },
  "doc-writer": { icon: "📝", label: "Doc Writer" },
  qa: { icon: "🔍", label: "QA" },
  helpdesk: { icon: "🎫", label: "Helpdesk" },
};

const MODE_INFO = {
  em: { icon: "🎖️", label: "EM 智慧調度", desc: "EM 先分析現況，再決定調度哪些 agent" },
  parallel: { icon: "🌙", label: "全員平行", desc: "6 個 agent 同時出動，快速掃描" },
};

export default function NightShiftPanel({ theme, rootPath, model }: { theme: any; rootPath?: string; model?: string }) {
  const { t } = useI18n();
  const tk = theme;

  // ── State ──
  const [nsStatus, setNsStatus] = useState<NightShiftStatus | null>(null);
  const [report, setReport] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const [selectedMode, setSelectedMode] = useState<string>("em");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Config
  const [showConfig, setShowConfig] = useState(false);
  const [nsConfig, setNsConfig] = useState<any>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Reports list
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [selectedReportDate, setSelectedReportDate] = useState<string | null>(null);
  const [reportContent, setReportContent] = useState<string>("");
  const [loadingReport, setLoadingReport] = useState(false);
  const [showReportsList, setShowReportsList] = useState(false);

  // ── Fetch config ──
  const fetchConfig = async () => {
    if (!rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-night-shift/config?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setNsConfig(d);
      setSelectedMode(d.mode || "em");
    } catch {}
  };

  useEffect(() => { fetchConfig(); }, [rootPath]);

  // ── Fetch status ──
  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-night-shift/status${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`);
      const data = await res.json();
      setNsStatus(data);
    } catch (err) {
      console.error("[NightShift] status error:", err);
    }
  };

  useEffect(() => {
    fetchStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [rootPath]);

  // Poll while running
  useEffect(() => {
    if (nsStatus?.status === "running") {
      pollRef.current = setInterval(fetchStatus, 3000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, [nsStatus?.status]);

  // Fetch report when completed
  useEffect(() => {
    if (nsStatus?.status === "completed") {
      fetch(`${API_BASE}/api/coding-night-shift/report${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`)
        .then(r => r.text()).then(setReport).catch(() => {});
    }
  }, [nsStatus?.status, nsStatus?.completedAt]);

  // ── Fetch reports list ──
  const fetchReports = useCallback(async () => {
    if (!rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-reports/list?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setReports(d.reports || []);
    } catch {}
  }, [rootPath]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  // Load report content when selected
  useEffect(() => {
    if (!selectedReportDate) return;
    setLoadingReport(true);
    fetch(`${API_BASE}/api/coding-reports/${selectedReportDate}?path=${encodeURIComponent(rootPath || "")}`)
      .then(r => r.json())
      .then(d => { setReportContent(d.content || ""); setLoadingReport(false); })
      .catch(() => setLoadingReport(false));
  }, [selectedReportDate, rootPath]);

  // ── Actions ──
  const handleStart = async () => {
    setStarting(true);
    setReport("");
    setSelectedReportDate(null);
    try {
      const res = await fetch(`${API_BASE}/api/coding-night-shift/start${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: selectedMode, model: model || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchStatus();
      }
    } catch (err: any) {
      alert("Failed to start: " + err.message);
    }
    setStarting(false);
  };

  const deleteReport = async (date: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`刪除報告 ${date}？`)) return;
    try {
      await fetch(`${API_BASE}/api/coding-reports/${date}?path=${encodeURIComponent(rootPath || "")}`, { method: "DELETE" });
      setReports(prev => prev.filter(r => r.date !== date));
      if (selectedReportDate === date) {
        setSelectedReportDate(null);
        setReportContent("");
      }
    } catch {}
  };

  // ── Render ──
  const isRunning = nsStatus?.status === "running";
  const progress = nsStatus ? `${nsStatus.completedAgents}/${nsStatus.totalAgents || (nsStatus.mode === "parallel" ? 6 : "?")}` : "0/?";
  const currentMode = nsStatus?.mode || selectedMode;
  const modeInfo = MODE_INFO[currentMode as keyof typeof MODE_INFO] || MODE_INFO.em;

  // Determine which content to show
  const displayContent = selectedReportDate ? reportContent : report;
  const displayTitle = selectedReportDate
    ? `${selectedReportDate} 報告`
    : nsStatus?.status === "completed"
      ? "最新報告"
      : "";

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex h-full" style={{ background: tk.bg }}>
      {/* ═══ Left: Control + Status + Reports List ═══ */}
      <div className="w-72 flex flex-col border-r shrink-0" style={{ borderColor: tk.borderLight }}>
        {/* ── Mode Selector + Start ── */}
        <div className="px-3 py-2" style={{ borderBottom: `1px solid ${tk.borderLight}`, background: tk.bgMuted }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold" style={{ color: tk.text }}>🌙 {t("nightShift.title")}</span>
            <button
              onClick={handleStart}
              disabled={starting || isRunning}
              className="text-xs px-2 py-1 rounded font-medium"
              style={{
                background: isRunning ? tk.bgMuted : tk.accentBg,
                color: isRunning ? tk.text : tk.accent,
                opacity: isRunning ? 0.5 : 1,
              }}
            >
              {isRunning ? `⏳ ${progress}` : `🚀 ${t("nightShift.start")}`}
            </button>
          </div>

          {/* Mode toggle */}
          {!isRunning && (
            <div className="flex gap-1">
              {(Object.keys(MODE_INFO) as (keyof typeof MODE_INFO)[]).map(m => (
                <button
                  key={m}
                  onClick={() => setSelectedMode(m)}
                  className="flex-1 text-xs px-2 py-1 rounded font-medium transition-colors"
                  style={{
                    background: selectedMode === m ? tk.accentBg : "transparent",
                    color: selectedMode === m ? tk.accent : tk.text,
                    opacity: selectedMode === m ? 1 : 0.5,
                    border: `1px solid ${selectedMode === m ? tk.accent : tk.borderLight}`,
                  }}
                >
                  {MODE_INFO[m].icon} {MODE_INFO[m].label}
                </button>
              ))}
            </div>
          )}
          {isRunning && (
            <div className="text-xs text-center" style={{ color: tk.text, opacity: 0.6 }}>
              {modeInfo.icon} {modeInfo.label} 執行中...
            </div>
          )}
        </div>

        {/* ── Agent status list (during/after run) ── */}
        {nsStatus && nsStatus.agents && Object.keys(nsStatus.agents).length > 0 && (
          <div className="flex-1 overflow-y-auto">
            {Object.entries(AGENT_INFO).map(([role, info]) => {
              const agentStatus = nsStatus.agents[role];
              if (!agentStatus) return null;
              const icon = agentStatus.status === "completed" ? "✅" : agentStatus.status === "failed" ? "❌" : agentStatus.status === "running" ? "⏳" : "⬜";
              return (
                <div key={role} className="px-3 py-2 border-b" style={{ borderColor: tk.borderLight }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{info.icon}</span>
                    <span className="text-sm font-medium" style={{ color: tk.text }}>{agentStatus.codename || info.label}</span>
                    <span className="ml-auto text-sm">{icon}</span>
                  </div>
                  {agentStatus.status === "failed" && agentStatus.error && (
                    <div className="text-xs mt-1" style={{ color: "#dc2626" }}>{agentStatus.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Last run info ── */}
        {nsStatus?.completedAt && !showReportsList && (
          <div className="px-3 py-2 text-[10px]" style={{ color: tk.text, opacity: 0.4, borderTop: `1px solid ${tk.borderLight}` }}>
            {t("nightShift.lastRun")}: {new Date(nsStatus.completedAt).toLocaleString()}
            {nsStatus.duration && ` · ${Math.round(nsStatus.duration / 1000)}s`}
            {nsStatus.mode && ` · ${MODE_INFO[nsStatus.mode as keyof typeof MODE_INFO]?.label || nsStatus.mode}`}
          </div>
        )}

        {/* ── Reports list toggle ── */}
        <div className="px-3 py-2" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
          <button
            onClick={() => { setShowReportsList(!showReportsList); if (!showReportsList) fetchReports(); }}
            className="text-xs flex items-center gap-1 w-full"
            style={{ color: tk.text, opacity: 0.7 }}
          >
            {showReportsList ? "▼" : "▶"} 📋 歷史報告 ({reports.length})
          </button>
        </div>

        {/* ── Reports list ── */}
        {showReportsList && (
          <div className="flex-1 overflow-y-auto" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
            {reports.length === 0 && (
              <div className="p-3 text-center text-xs" style={{ color: tk.text, opacity: 0.4 }}>
                暫無報告
              </div>
            )}
            {reports.map(r => (
              <div
                key={r.date}
                onClick={() => { setSelectedReportDate(r.date); setReport(""); }}
                className="px-3 py-2 cursor-pointer border-b transition-colors"
                style={{
                  borderColor: tk.borderLight,
                  background: selectedReportDate === r.date ? tk.accentBg : "transparent",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold" style={{ color: tk.text }}>
                    {r.mode === "em" ? "🎖️" : "🌙"} {r.date}
                  </span>
                  <button
                    onClick={(e) => deleteReport(r.date, e)}
                    className="text-xs opacity-30 hover:opacity-100 hover:text-red-500"
                    style={{ color: tk.text }}
                    title="刪除"
                  >✕</button>
                </div>
                {r.result && (
                  <span className="text-[10px]" style={{ color: tk.text, opacity: 0.5 }}>{r.result}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Config toggle ── */}
        <div className="px-3 py-2" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="text-xs flex items-center gap-1"
            style={{ color: tk.text, opacity: 0.6 }}
          >
            {showConfig ? "▼" : "▶"} ⚙️ 設定
          </button>
        </div>

        {/* ── Config panel ── */}
        {showConfig && nsConfig && (
          <div className="px-3 py-2 space-y-3 overflow-y-auto" style={{ borderTop: `1px solid ${tk.borderLight}`, background: tk.bgMuted, maxHeight: "300px" }}>
            {/* Default Mode */}
            <div>
              <div className="text-xs font-bold mb-1" style={{ color: tk.text }}>🎛️ 預設模式</div>
              <select
                value={nsConfig.mode || "em"}
                onChange={e => setNsConfig({ ...nsConfig, mode: e.target.value })}
                className="text-xs px-2 py-1 rounded border w-full"
                style={{ borderColor: tk.borderLight, background: tk.bg, color: tk.text }}
              >
                <option value="em">🎖️ EM 智慧調度</option>
                <option value="parallel">🌙 全員平行</option>
              </select>
            </div>

            {/* Schedule */}
            <div>
              <div className="text-xs font-bold mb-1" style={{ color: tk.text }}>⏰ 排程</div>
              <label className="flex items-center gap-2 text-xs" style={{ color: tk.text }}>
                <input
                  type="checkbox"
                  checked={nsConfig.schedule?.enabled || false}
                  onChange={e => setNsConfig({ ...nsConfig, schedule: { ...nsConfig.schedule, enabled: e.target.checked } })}
                />
                每日自動執行
              </label>
              {nsConfig.schedule?.enabled && (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="time"
                    value={nsConfig.schedule?.time || "22:00"}
                    onChange={e => setNsConfig({ ...nsConfig, schedule: { ...nsConfig.schedule, time: e.target.value } })}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: tk.borderLight, background: tk.bg, color: tk.text }}
                  />
                  <select
                    value={nsConfig.schedule?.tz || "Asia/Taipei"}
                    onChange={e => setNsConfig({ ...nsConfig, schedule: { ...nsConfig.schedule, tz: e.target.value } })}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: tk.borderLight, background: tk.bg, color: tk.text }}
                  >
                    <option value="Asia/Taipei">台北</option>
                    <option value="Asia/Shanghai">上海</option>
                    <option value="Asia/Tokyo">東京</option>
                    <option value="America/Los_Angeles">太平洋</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              )}
            </div>

            {/* Model */}
            <div>
              <div className="text-xs font-bold mb-1" style={{ color: tk.text }}>🤖 Primary Model</div>
              <ModelSelector
                feature="nightShift"
                value={nsConfig.model?.primary || ""}
                onChange={(v: string) => setNsConfig({ ...nsConfig, model: { ...nsConfig.model, primary: v } })}
              />
              <div className="text-xs font-bold mt-2 mb-1" style={{ color: tk.text, opacity: 0.6 }}>Fallback Model</div>
              <ModelSelector
                feature="nightShiftFallback"
                value={nsConfig.model?.fallbacks?.[0] || ""}
                onChange={(v: string) => setNsConfig({ ...nsConfig, model: { ...nsConfig.model, fallbacks: v ? [v] : [] } })}
              />
            </div>

            {/* Save */}
            <button
              onClick={async () => {
                setSavingConfig(true);
                try {
                  await fetch(`${API_BASE}/api/coding-night-shift/config?path=${encodeURIComponent(rootPath || "")}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(nsConfig),
                  });
                } catch {}
                setSavingConfig(false);
              }}
              disabled={savingConfig}
              className="w-full py-1.5 rounded text-xs font-medium"
              style={{ background: tk.accentBg, color: tk.accent }}
            >
              {savingConfig ? "儲存中..." : "💾 儲存設定"}
            </button>
          </div>
        )}
      </div>

      {/* ═══ Right: Report Content ═══ */}
      <div className="flex-1 overflow-y-auto">
        {loadingReport ? (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-sm" style={{ color: tk.text, opacity: 0.4 }}>載入中...</div>
          </div>
        ) : displayContent ? (
          <>
            {displayTitle && (
              <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                <span className="text-sm font-bold" style={{ color: tk.text }}>{displayTitle}</span>
                {selectedReportDate && (
                  <button
                    onClick={() => { setSelectedReportDate(null); setReportContent(""); }}
                    className="text-xs"
                    style={{ color: tk.accent }}
                  >← 回最新</button>
                )}
              </div>
            )}
            <div className="p-4 prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center h-full gap-2" style={{ color: tk.text, opacity: 0.4 }}>
            <div className="text-4xl">{modeInfo.icon}</div>
            <div className="text-sm">{t("nightShift.noReport")}</div>
            <div className="text-xs">{t("nightShift.noReportHint")}</div>
            <div className="text-xs mt-2" style={{ opacity: 0.5 }}>{modeInfo.desc}</div>
          </div>
        )}
      </div>
    </div>
  );
}
