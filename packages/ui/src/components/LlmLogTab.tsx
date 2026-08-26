/**
 * LLM Log Tab — 顯示所有 LLM API 呼叫記錄
 *
 * Data from: GET /api/llm-logs?days=7
 * Stats from: GET /api/llm-logs/stats
 */

import React, { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_PAAW_API_BASE || "";

interface LlmLogItem {
  id: string;
  ts: string;
  agentId: string;
  model: string;
  stream: boolean;
  messageCount: number;
  toolNames: string[];
  durationMs: number | null;
  finishReason: string | null;
  contentLen: number;
  toolCalls: { name: string; argsLen: number }[];
  auditOk: boolean;
  auditViolations: string[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  error: string | null;
  caller: string | null;
}

interface LlmLogSummary {
  success: number;
  errors: number;
  totalDurationMs: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  byModel: Record<string, { count: number; tokens: number; errors: number; durationMs: number }>;
  byAgent: Record<string, { count: number; tokens: number; errors: number }>;
  auditOk: number;
  auditFail: number;
  violations: Record<string, number>;
}

interface LlmLogResponse {
  items: LlmLogItem[];
  total: number;
  summary: LlmLogSummary;
}

const AGENT_EMOJI: Record<string, string> = {
  architect: "🏗️",
  developer: "💻",
  tester: "🧪",
  "doc-writer": "📝",
  helpdesk: "🆘",
  qa: "🔍",
};

function formatDuration(ms: number | null) {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export default function LlmLogTab() {
  const [logs, setLogs] = useState<LlmLogItem[]>([]);
  const [summary, setSummary] = useState<LlmLogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [agentFilter, setAgentFilter] = useState("");
  const [selectedLog, setSelectedLog] = useState<LlmLogItem | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ days: String(days), limit: "200" });
      if (agentFilter) params.set("agent", agentFilter);
      const res = await fetch(`${API_BASE}/api/llm-logs?${params}`);
      const data: LlmLogResponse = await res.json();
      setLogs(data.items);
      setSummary(data.summary);
    } catch (err) {
      console.error("[LLM Log] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [days, agentFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: "#1a1a2e" }}>
        <div className="text-stone-400 text-sm">Loading LLM logs...</div>
      </div>
    );
  }

  const agentOptions = summary?.byAgent ? Object.keys(summary.byAgent).sort() : [];

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full" style={{ backgroundColor: "#1a1a2e", color: "#cdd6f4" }}>
      {/* ── Header: Stats Summary ── */}
      <div className="px-4 py-3 border-b border-stone-700/50 flex items-center gap-4 flex-wrap">
        <h2 className="text-sm font-bold flex items-center gap-1.5">📡 LLM API Log</h2>
        <div className="flex items-center gap-3 text-xs text-stone-400">
          {summary && (
            <>
              <span className="px-2 py-0.5 rounded bg-blue-900/50 text-blue-300">
                {summary.success + summary.errors} calls
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300">
                ✅ {summary.success}
              </span>
              {summary.errors > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-900/50 text-red-300">
                  ❌ {summary.errors}
                </span>
              )}
              <span className="px-2 py-0.5 rounded bg-sky-900/50 text-sky-300">
                ⬆ {formatTokens(summary.totalPromptTokens)} in
              </span>
              <span className="px-2 py-0.5 rounded bg-violet-900/50 text-violet-300">
                ⬇ {formatTokens(summary.totalCompletionTokens)} out
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-900/50 text-amber-300">
                ⏱ {formatDuration(summary.totalDurationMs)}
              </span>
              <span className="px-2 py-0.5 rounded bg-stone-700/60 text-stone-200 font-semibold">
                🛡️ 合規 {summary.auditOk ?? 0} · 不合規 {summary.auditFail ?? 0}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {/* Days filter */}
          <select value={days} onChange={e => { setDays(Number(e.target.value)); setLoading(true); }}
            className="text-xs px-2 py-1 rounded bg-stone-800 text-stone-300 border border-stone-600">
            {[1, 3, 7, 14, 30].map(d => <option key={d} value={d}>{d}d</option>)}
          </select>
          {/* Agent filter */}
          <select value={agentFilter} onChange={e => { setAgentFilter(e.target.value); setLoading(true); }}
            className="text-xs px-2 py-1 rounded bg-stone-800 text-stone-300 border border-stone-600">
            <option value="">All Agents</option>
            {agentOptions.map(a => <option key={a} value={a}>{AGENT_EMOJI[a] || "🤖"} {a}</option>)}
          </select>
          {/* Auto refresh */}
          <button onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-xs px-2 py-1 rounded border ${autoRefresh ? "bg-emerald-800/50 border-emerald-600 text-emerald-300" : "bg-stone-800 border-stone-600 text-stone-400"}`}>
            🔄 {autoRefresh ? "ON" : "OFF"}
          </button>
          <button onClick={() => { setLoading(true); fetchLogs(); }}
            className="text-xs px-2 py-1 rounded bg-stone-800 border border-stone-600 text-stone-300 hover:bg-stone-700">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Model Breakdown ── */}
      {summary?.byModel && Object.keys(summary.byModel).length > 0 && (
        <div className="px-4 py-2 border-b border-stone-700/30 flex items-center gap-4 text-xs text-stone-400 flex-wrap">
          <span className="font-semibold text-stone-500">Models:</span>
          {Object.entries(summary.byModel).map(([model, info]) => (
            <span key={model} className="flex items-center gap-1">
              <span className="text-stone-300">{model}</span>
              <span className="text-stone-500">×{info.count}</span>
              {info.tokens > 0 && <span className="text-purple-400">{formatTokens(info.tokens)} tok</span>}
              {info.errors > 0 && <span className="text-red-400">❌{info.errors}</span>}
            </span>
          ))}
        </div>
      )}

      {/* ── Main Content: Log List ── */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        {/* Log List */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#444 #1a1a2e" }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: "#1a1a2e" }}>
              <tr className="text-stone-500 border-b border-stone-700/50">
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-left px-3 py-2 font-medium">Agent</th>
                <th className="text-left px-3 py-2 font-medium">Model</th>
                <th className="text-left px-3 py-2 font-medium">Msgs</th>
                <th className="text-left px-3 py-2 font-medium">Tools</th>
                <th className="text-left px-3 py-2 font-medium">Audit</th>
                <th className="text-left px-3 py-2 font-medium">Duration</th>
                <th className="text-left px-3 py-2 font-medium">In Tok</th>
                <th className="text-left px-3 py-2 font-medium">Out Tok</th>
                <th className="text-left px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}
                  onClick={() => setSelectedLog(selectedLog?.id === log.id ? null : log)}
                  className={`border-b border-stone-800/50 cursor-pointer transition-colors ${selectedLog?.id === log.id ? "bg-blue-900/30" : "hover:bg-stone-800/30"}`}>
                  <td className="px-3 py-1.5 text-stone-400 whitespace-nowrap">
                    {new Date(log.ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="mr-1">{AGENT_EMOJI[log.agentId] || "🤖"}</span>
                    <span className={log.agentId === "unknown" ? "text-stone-500" : "text-stone-200"}>{log.agentId}</span>
                  </td>
                  <td className="px-3 py-1.5 text-blue-300 whitespace-nowrap">{log.model}</td>
                  <td className="px-3 py-1.5 text-stone-400 text-center">{log.messageCount}</td>
                  <td className="px-3 py-1.5 text-stone-400">
                    {log.toolCalls.length > 0 ? (
                      <span className="text-amber-300">{log.toolCalls.length} calls</span>
                    ) : log.toolNames.length > 0 ? (
                      <span className="text-stone-600">{log.toolNames.length} avail</span>
                    ) : (
                      <span className="text-stone-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {log.toolCalls.length === 0 ? (
                      <span className="text-stone-600">—</span>
                    ) : log.auditOk ? (
                      <span className="text-emerald-400">✅ {log.toolCalls.length}</span>
                    ) : (
                      <span className="text-red-400">❌ {log.auditViolations.length}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-stone-400 whitespace-nowrap">
                    {log.durationMs !== null ? (
                      <span className={log.durationMs > 30000 ? "text-red-400" : log.durationMs > 10000 ? "text-amber-400" : "text-stone-300"}>
                        {formatDuration(log.durationMs)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-stone-400 whitespace-nowrap">
                    {log.usage ? (
                      <span className="text-sky-300">{formatTokens(log.usage.prompt_tokens)}</span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-stone-400 whitespace-nowrap">
                    {log.usage ? (
                      <span className="text-violet-300">{formatTokens(log.usage.completion_tokens)}</span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {log.error ? (
                      <span className="text-red-400">❌ Error</span>
                    ) : log.finishReason === "tool_calls" ? (
                      <span className="text-amber-300">🔧 {log.toolCalls.length}</span>
                    ) : log.finishReason === "stop" ? (
                      <span className="text-emerald-300">✅ {log.contentLen > 0 ? `${log.contentLen} chars` : ""}</span>
                    ) : (
                      <span className="text-stone-500">{log.finishReason || "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-stone-500">
                    No LLM calls recorded yet. Start chatting with an AI agent to see logs here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Detail Panel */}
        {selectedLog && (
          <div className="w-[360px] shrink-0 border-l border-stone-700/50 overflow-y-auto p-4" style={{ scrollbarWidth: "thin" }}>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5">
              {AGENT_EMOJI[selectedLog.agentId] || "🤖"} Call Detail
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <div className="text-stone-500 mb-0.5">Timestamp</div>
                <div className="text-stone-200">{new Date(selectedLog.ts).toLocaleString("zh-TW")}</div>
              </div>
              <div>
                <div className="text-stone-500 mb-0.5">Model</div>
                <div className="text-blue-300">{selectedLog.model}</div>
              </div>
              <div>
                <div className="text-stone-500 mb-0.5">Agent</div>
                <div className="text-stone-200">{selectedLog.agentId}</div>
              </div>
              <div>
                <div className="text-stone-500 mb-0.5">Duration</div>
                <div className="text-stone-200">{formatDuration(selectedLog.durationMs)}</div>
              </div>
              {selectedLog.usage && (
                <div>
                  <div className="text-stone-500 mb-0.5">Token Usage</div>
                  <div className="text-stone-200 space-y-0.5">
                    <div>Prompt: {selectedLog.usage.prompt_tokens?.toLocaleString()}</div>
                    <div>Completion: {selectedLog.usage.completion_tokens?.toLocaleString()}</div>
                    <div className="text-purple-300 font-semibold">Total: {selectedLog.usage.total_tokens?.toLocaleString()}</div>
                  </div>
                </div>
              )}
              <div>
                <div className="text-stone-500 mb-0.5">Finish Reason</div>
                <div className="text-stone-200">{selectedLog.finishReason || "—"}</div>
              </div>
              {selectedLog.toolNames.length > 0 && (
                <div>
                  <div className="text-stone-500 mb-0.5">Available Tools ({selectedLog.toolNames.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedLog.toolNames.map(t => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 text-[10px]">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {selectedLog.toolCalls.length > 0 && (
                <div>
                  <div className="text-stone-500 mb-0.5">Tool Calls ({selectedLog.toolCalls.length})</div>
                  <div className="space-y-1">
                    {selectedLog.toolCalls.map((tc, i) => {
                      const isViolation = selectedLog.auditViolations?.includes(tc.name);
                      return (
                        <div key={i} className={`px-2 py-1 rounded text-xs ${isViolation ? "bg-red-900/40 text-red-300" : "bg-stone-800 text-amber-300"}`}>
                          {isViolation ? "🚫" : "🔧"} {tc.name} <span className="text-stone-500">({tc.argsLen} chars)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {selectedLog.toolCalls.length > 0 && !selectedLog.auditOk && (
                <div className="px-2 py-1.5 rounded bg-red-900/30 border border-red-800/50">
                  <div className="text-red-300 text-xs font-medium">🚫 Audit Violations ({selectedLog.auditViolations.length})</div>
                  <div className="text-red-400 text-[10px] mt-1">
                    {selectedLog.auditViolations.map((v, i) => (
                      <span key={i} className="inline-block mr-1 px-1 py-0.5 rounded bg-red-900/50">{v}</span>
                    ))}
                  </div>
                </div>
              )}
              {selectedLog.error && (
                <div>
                  <div className="text-stone-500 mb-0.5">Error</div>
                  <div className="text-red-400 break-all">{selectedLog.error}</div>
                </div>
              )}
              {selectedLog.contentLen > 0 && (
                <div>
                  <div className="text-stone-500 mb-0.5">Response</div>
                  <div className="text-emerald-300">{selectedLog.contentLen} chars</div>
                </div>
              )}
              <div>
                <div className="text-stone-500 mb-0.5">Call ID</div>
                <div className="text-stone-600 font-mono text-[10px] break-all">{selectedLog.id}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-2 border-t border-stone-700/50 text-xs text-stone-500 flex items-center gap-2">
        <span>{logs.length} calls in last {days} days</span>
        <span>•</span>
        <span>Auto-refresh: {autoRefresh ? "10s" : "OFF"}</span>
      </div>
    </div>
  );
}
