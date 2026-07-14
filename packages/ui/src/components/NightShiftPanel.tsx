/**
 * NightShiftPanel — Trigger and view Night Shift reports
 *
 * Button to start night shift, live status polling, and report display.
 */
import React, { useState, useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

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
  agents: Record<string, AgentStatus>;
  totalAgents: number;
  completedAgents: number;
  report?: string;
  message?: string;
}

const AGENT_INFO: Record<string, { icon: string; label: string }> = {
  architect: { icon: "🏛️", label: "Architect" },
  developer: { icon: "💻", label: "Developer" },
  tester: { icon: "🧪", label: "Tester" },
  "doc-writer": { icon: "📝", label: "Doc Writer" },
  qa: { icon: "🔍", label: "QA" },
  helpdesk: { icon: "🎫", label: "Helpdesk" },
};

export default function NightShiftPanel({ theme, rootPath }: { theme: any; rootPath?: string }) {
  const { t } = useI18n();
  const [nsStatus, setNsStatus] = useState<NightShiftStatus | null>(null);
  const [report, setReport] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-night-shift/status${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`);
      const data = await res.json();
      setNsStatus(data);

      if (data.status === "completed" && !report) {
        const repRes = await fetch(`${API_BASE}/api/coding-night-shift/report${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`);
        const repText = await repRes.text();
        setReport(repText);
      }
    } catch (err) {
      console.error("[NightShift] status error:", err);
    }
  };

  useEffect(() => {
    fetchStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

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
      fetch(`${API_BASE}/api/coding-night-shift/report${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`).then(r => r.text()).then(setReport).catch(() => {});
    }
  }, [nsStatus?.status, nsStatus?.completedAt]);

  const handleStart = async () => {
    setStarting(true);
    setReport("");
    try {
      const res = await fetch(`${API_BASE}/api/coding-night-shift/start${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        await fetchStatus();
      }
    } catch (err) {
      alert("Failed to start: " + err.message);
    }
    setStarting(false);
  };

  const isRunning = nsStatus?.status === "running";
  const progress = nsStatus ? `${nsStatus.completedAgents}/${nsStatus.totalAgents}` : "0/6";

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* Left: Control + Agent Status */}
      <div className="w-72 flex flex-col border-r shrink-0" style={{ borderColor: theme.borderLight }}>
        {/* Header */}
        <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
          <span className="text-sm font-semibold" style={{ color: theme.text }}>🌙 {t("nightShift.title")}</span>
          <button
            onClick={handleStart}
            disabled={starting || isRunning}
            className="text-xs px-2 py-1 rounded font-medium"
            style={{
              background: isRunning ? theme.bgMuted : theme.accentBg,
              color: isRunning ? theme.text : theme.accent,
              opacity: isRunning ? 0.5 : 1,
            }}
          >
            {isRunning ? `⏳ ${progress}` : `🚀 ${t("nightShift.start")}`}
          </button>
        </div>

        {/* Description */}
        <div className="px-3 py-2 text-xs" style={{ color: theme.text, opacity: 0.5, borderBottom: `1px solid ${theme.borderLight}` }}>
          {t("nightShift.description")}
        </div>

        {/* Agent status list */}
        <div className="flex-1 overflow-y-auto">
          {nsStatus && nsStatus.agents && Object.entries(AGENT_INFO).map(([role, info]) => {
            const agentStatus = nsStatus.agents[role];
            const icon = agentStatus?.status === "completed" ? "✅" : agentStatus?.status === "failed" ? "❌" : agentStatus?.status === "running" ? "⏳" : "⬜";
            return (
              <div key={role} className="px-3 py-2 border-b" style={{ borderColor: theme.borderLight }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{info.icon}</span>
                  <span className="text-sm font-medium" style={{ color: theme.text }}>{agentStatus?.codename || info.label}</span>
                  <span className="ml-auto text-sm">{icon}</span>
                </div>
                {agentStatus?.status === "failed" && agentStatus.error && (
                  <div className="text-xs mt-1" style={{ color: "#dc2626" }}>{agentStatus.error}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Last run info */}
        {nsStatus?.completedAt && (
          <div className="px-3 py-2 text-[10px]" style={{ color: theme.text, opacity: 0.4, borderTop: `1px solid ${theme.borderLight}` }}>
            {t("nightShift.lastRun")}: {new Date(nsStatus.completedAt).toLocaleString()}
            {nsStatus.duration && ` · ${Math.round(nsStatus.duration / 1000)}s`}
          </div>
        )}
      </div>

      {/* Right: Report */}
      <div className="flex-1 overflow-y-auto">
        {report ? (
          <div className="p-4">
            <pre className="text-sm whitespace-pre-wrap font-sans" style={{ color: theme.text }}>{report}</pre>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center h-full gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">🌙</div>
            <div className="text-sm">{t("nightShift.noReport")}</div>
            <div className="text-xs">{t("nightShift.noReportHint")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
