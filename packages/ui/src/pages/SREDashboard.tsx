/**
 * SREDashboard — SRE 儀表板概覽
 *
 * 顯示：
 *  1. Provider 狀態卡片（Prometheus / Loki / K8s / Shell / Security / Docs）
 *  2. 系統健康摘要（K8s nodes、Prometheus targets）
 *  3. Alert 摘要（firing alerts 數量 + 列表）
 *  4. 最近 SRE 操作紀錄
 *  5. 快速 PromQL 查詢
 */
import API_BASE from "../api";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "../theme";
import { cn } from "../utils";
import MarkdownText from "../components/MarkdownText";

// ── Types ──
interface ProviderStatus {
  id: string;
  label: string;
  emoji: string;
  toolGroup: string;
  tools: string[];
  configured: boolean;
  toolCount: number;
  registered: boolean;
  hasConfig: boolean;
  status: "ready" | "pending" | "error";
}

interface Alert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;
  activeAt: string;
}

interface HealthCheck {
  k8s?: { available: boolean; nodes: number; raw?: string };
  prometheus?: { available: boolean; targets?: number; configured?: boolean };
  overall: { healthy: boolean; timestamp: string };
}

interface SREAction {
  id?: string;
  title?: string;
  summary?: string;
  agentId?: string;
  timestamp?: string;
  decision?: string;
}

// ── Provider Status Card ──
function ProviderCard({ provider }: { provider: ProviderStatus }) {
  const { info: t } = useTheme();
  const statusConfig = {
    ready: { color: "#22c55e", bg: "#22c55e15", label: "Ready", icon: "✅" },
    pending: { color: "#f59e0b", bg: "#f59e0b15", label: "待設定", icon: "⚠️" },
    error: { color: "#ef4444", bg: "#ef444415", label: "Error", icon: "❌" },
  };
  const sc = statusConfig[provider.status];

  return (
    <div
      className="rounded-xl p-3 border transition-all hover:shadow-sm"
      style={{ borderColor: sc.color + "40", backgroundColor: sc.bg }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-lg">{provider.emoji}</span>
          <span className="font-semibold text-sm text-stone-800">{provider.label}</span>
        </div>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ color: sc.color, backgroundColor: sc.color + "20" }}>
          {sc.icon} {sc.label}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-stone-500">
        <span>{provider.toolCount} tools</span>
        <span>•</span>
        <span>{provider.registered ? "已註冊" : "未載入"}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {provider.tools.slice(0, 4).map(tool => (
          <code key={tool} className="text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
            {tool}
          </code>
        ))}
        {provider.tools.length > 4 && (
          <span className="text-[9px] text-stone-400">+{provider.tools.length - 4}</span>
        )}
      </div>
    </div>
  );
}

// ── Alert Card ──
function AlertCard({ alert }: { alert: Alert }) {
  const severity = alert.labels?.severity || "unknown";
  const alertname = alert.labels?.alertname || "unknown";
  const summary = alert.annotations?.summary || "";
  const description = alert.annotations?.description || "";

  const sevConfig: Record<string, { color: string; emoji: string }> = {
    critical: { color: "#ef4444", emoji: "🔴" },
    warning: { color: "#f59e0b", emoji: "🟡" },
    info: { color: "#3b82f6", emoji: "🔵" },
  };
  const sc = sevConfig[severity] || sevConfig.info;

  return (
    <div
      className="rounded-lg p-2.5 border text-xs"
      style={{ borderColor: sc.color + "40", backgroundColor: sc.color + "08" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span>{sc.emoji}</span>
        <span className="font-semibold text-stone-800">{alertname}</span>
        <span className="text-[9px] uppercase px-1 rounded" style={{ color: sc.color, backgroundColor: sc.color + "20" }}>
          {severity}
        </span>
      </div>
      {summary && <div className="text-stone-600">{summary}</div>}
      {description && <div className="text-stone-400 mt-0.5 text-[11px]">{description}</div>}
    </div>
  );
}

// ── Quick PromQL Query Panel ──
function QuickQueryPanel() {
  const { info: t } = useTheme();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const PRESETS = [
    { label: "🔴 5xx 錯誤率", query: 'sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)' },
    { label: "⏱️ p99 Latency", query: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))' },
    { label: "💻 CPU 使用率", query: 'sum(rate(container_cpu_usage_seconds_total[5m])) by (pod)' },
    { label: "🧠 Memory 使用率", query: 'sum(container_memory_working_set_bytes) by (pod)' },
  ];

  const runQuery = useCallback(async (q: string) => {
    if (!q) return;
    setLoading(true);
    setResult("");
    try {
      const resp = await fetch(`${API_BASE}/api/sre/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await resp.json();
      if (data.result?.text) {
        setResult(data.result.text);
      } else if (data.result?.error) {
        setResult("❌ " + data.result.error);
      } else {
        setResult("（無資料）");
      }
    } catch (err) {
      setResult("❌ 查詢失敗：" + (err as Error).message);
    }
    setLoading(false);
  }, []);

  return (
    <div className="bg-white rounded-xl p-3 border border-stone-200">
      <div className="text-xs font-semibold text-stone-500 mb-2">🔍 快速 PromQL 查詢</div>
      <div className="flex gap-1.5 mb-2 flex-wrap">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => { setQuery(p.query); runQuery(p.query); }}
            className="text-[10px] px-2 py-1 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-600"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") runQuery(query); }}
          placeholder="rate(http_requests_total[5m])"
          className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-stone-200 focus:outline-none focus:border-stone-400 font-mono"
        />
        <button
          onClick={() => runQuery(query)}
          disabled={loading || !query}
          className="text-xs px-3 py-1.5 rounded-lg font-medium text-white disabled:opacity-40"
          style={{ backgroundColor: t.accent }}
        >
          {loading ? "..." : "Run"}
        </button>
      </div>
      {result && (
        <div className="mt-2 p-2.5 rounded-lg bg-stone-50 border border-stone-100 overflow-x-auto">
          <pre className="text-[11px] text-stone-600 whitespace-pre-wrap font-mono">{result}</pre>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ──

export default function SREDashboard() {
  const { info: t } = useTheme();

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsConfigured, setAlertsConfigured] = useState(true);
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [actions, setActions] = useState<SREAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const refreshTimer = useRef<ReturnType<typeof setInterval>>();

  const loadAll = useCallback(async () => {
    try {
      const [statusResp, alertsResp, healthResp, actionsResp] = await Promise.allSettled([
        fetch(`${API_BASE}/api/sre/status`).then(r => r.json()),
        fetch(`${API_BASE}/api/sre/alerts`).then(r => r.json()),
        fetch(`${API_BASE}/api/sre/health`).then(r => r.json()),
        fetch(`${API_BASE}/api/sre/actions`).then(r => r.json()),
      ]);

      if (statusResp.status === "fulfilled") setProviders(statusResp.value.providers || []);
      if (alertsResp.status === "fulfilled") {
        setAlerts(alertsResp.value.alerts || []);
        setAlertsConfigured(alertsResp.value.configured !== false);
      }
      if (healthResp.status === "fulfilled") setHealth(healthResp.value);
      if (actionsResp.status === "fulfilled") setActions(actionsResp.value.actions || []);
    } catch {}
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    loadAll();
    // Auto-refresh every 30s
    refreshTimer.current = setInterval(loadAll, 30000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [loadAll]);

  const readyCount = providers.filter(p => p.status === "ready").length;
  const pendingCount = providers.filter(p => p.status === "pending").length;
  const criticalAlerts = alerts.filter(a => a.labels?.severity === "critical");
  const warningAlerts = alerts.filter(a => a.labels?.severity === "warning");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-stone-400 text-sm animate-pulse">Loading SRE Dashboard...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-stone-50" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: t.accent + "15" }}>
              🛡️
            </div>
            <div>
              <h2 className="font-bold text-stone-800">SRE Dashboard</h2>
              <div className="text-[10px] text-stone-400">
                更新於 {lastRefresh.toLocaleTimeString()} · 每 30s 自動刷新
              </div>
            </div>
          </div>
          <button
            onClick={loadAll}
            className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-white text-stone-600 flex items-center gap-1"
          >
            🔄 刷新
          </button>
        </div>

        {/* ── Summary Bar ── */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-white rounded-xl p-3 border border-stone-200 text-center">
            <div className={cn("text-2xl font-bold", readyCount === providers.length ? "text-green-500" : "text-amber-500")}>
              {readyCount}/{providers.length}
            </div>
            <div className="text-[10px] text-stone-400 mt-0.5">Providers Ready</div>
          </div>
          <div className="bg-white rounded-xl p-3 border border-stone-200 text-center">
            <div className={cn("text-2xl font-bold", criticalAlerts.length > 0 ? "text-red-500" : "text-green-500")}>
              {criticalAlerts.length}
            </div>
            <div className="text-[10px] text-stone-400 mt-0.5">Critical Alerts</div>
          </div>
          <div className="bg-white rounded-xl p-3 border border-stone-200 text-center">
            <div className={cn("text-2xl font-bold", warningAlerts.length > 0 ? "text-amber-500" : "text-green-500")}>
              {warningAlerts.length}
            </div>
            <div className="text-[10px] text-stone-400 mt-0.5">Warning Alerts</div>
          </div>
          <div className="bg-white rounded-xl p-3 border border-stone-200 text-center">
            <div className={cn("text-2xl font-bold", health?.k8s?.available ? "text-green-500" : "text-stone-400")}>
              {health?.k8s?.nodes || 0}
            </div>
            <div className="text-[10px] text-stone-400 mt-0.5">K8s Nodes</div>
          </div>
        </div>

        {/* ── Health Status ── */}
        {health && (
          <div className="bg-white rounded-xl p-3 border border-stone-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-stone-500">🏥 系統健康</div>
              <div className="flex items-center gap-1.5">
                <span className={cn("w-2 h-2 rounded-full", health.overall.healthy ? "bg-green-500" : "bg-amber-500")} />
                <span className="text-[10px] text-stone-400">{health.overall.healthy ? "All Healthy" : "Issues Detected"}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {health.k8s && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-stone-50">
                  <span className="text-base">{health.k8s.available ? "✅" : "❌"}</span>
                  <div>
                    <div className="text-xs font-medium text-stone-700">Kubernetes</div>
                    <div className="text-[10px] text-stone-400">
                      {health.k8s.available ? `${health.k8s.nodes} nodes` : "unavailable"}
                    </div>
                  </div>
                </div>
              )}
              {health.prometheus && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-stone-50">
                  <span className="text-base">{health.prometheus.available ? "✅" : "❌"}</span>
                  <div>
                    <div className="text-xs font-medium text-stone-700">Prometheus</div>
                    <div className="text-[10px] text-stone-400">
                      {health.prometheus.configured === false ? "未設定" :
                       health.prometheus.available ? `${health.prometheus.targets || 0} targets` : "unavailable"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Provider Cards ── */}
        <div>
          <div className="text-xs font-semibold text-stone-500 mb-2">🔌 Tool Providers</div>
          <div className="grid grid-cols-2 gap-2">
            {providers.map(p => (
              <ProviderCard key={p.id} provider={p} />
            ))}
          </div>
        </div>

        {/* ── Alerts Feed ── */}
        <div className="bg-white rounded-xl p-3 border border-stone-200">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-stone-500">🚨 Active Alerts</div>
            {!alertsConfigured && (
              <span className="text-[10px] text-amber-500">Prometheus 未設定</span>
            )}
          </div>
          {alertsConfigured && alerts.length === 0 ? (
            <div className="text-center py-4 text-sm text-stone-400">
              ✅ 目前沒有 firing alerts
            </div>
          ) : alertsConfigured ? (
            <div className="space-y-1.5">
              {alerts.slice(0, 10).map((alert, i) => (
                <AlertCard key={i} alert={alert} />
              ))}
              {alerts.length > 10 && (
                <div className="text-center text-[10px] text-stone-400 py-1">
                  還有 {alerts.length - 10} 個 alerts...
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4 text-sm text-stone-400">
              設定 Prometheus 後可查看即時 alerts<br />
              <code className="text-[10px]">data/tools/prometheus/config.json</code>
            </div>
          )}
        </div>

        {/* ── Quick PromQL ── */}
        <QuickQueryPanel />

        {/* ── Recent Actions ── */}
        <div className="bg-white rounded-xl p-3 border border-stone-200">
          <div className="text-xs font-semibold text-stone-500 mb-2">📋 最近 SRE 操作紀錄</div>
          {actions.length === 0 ? (
            <div className="text-center py-3 text-xs text-stone-400">尚無 SRE 操作紀錄</div>
          ) : (
            <div className="space-y-1.5">
              {actions.slice(0, 10).map((action, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-stone-50">
                  <span className="text-xs mt-0.5">📝</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-stone-700">
                      {action.title || action.summary || action.decision || "SRE operation"}
                    </div>
                    <div className="text-[10px] text-stone-400 mt-0.5">
                      {action.agentId && <span>{action.agentId} · </span>}
                      {action.timestamp && new Date(action.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Setup Guide (show if providers pending) ── */}
        {pendingCount > 0 && (
          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
            <div className="text-xs font-semibold text-amber-700 mb-2">⚙️ 設定指引</div>
            <div className="text-xs text-amber-600 space-y-1">
              <p>部分 Tool Providers 尚未設定。編輯對應的 config.json：</p>
              <pre className="text-[10px] bg-white rounded p-2 mt-1 overflow-x-auto">
{`data/tools/prometheus/config.json → { "url": "http://prometheus:9090" }
data/tools/loki/config.json       → { "url": "http://loki:3100" }
data/tools/k8s/config.json        → { "context": "my-cluster" }`}
              </pre>
              <p className="mt-1">設定後重啟伺服器或點「刷新」即可生效。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
