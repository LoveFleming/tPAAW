/**
 * UsageReportPanel — Agent 執行報表（2026-09-16）
 *
 * 回答：「每個 Release Unit 每天每個 agent 接了多少 request、用多少 token、花多少錢、跑多久？」
 * 資料：GET /api/agent-logs?limit=200（現成 API，index.json 最近的任務摘要）
 * 聚合全在前端（browser 本地時區分日）；無新 storage、無新 API。
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface TaskItem {
  taskId: string; agentId: string; model?: string; models?: Array<string | { model?: string }>; cwd: string; ruName?: string;
  startTime: string; durationMs: number; turns: number; status: string;
  usage?: { prompt: number; completion: number; total: number };
  costUsd?: number;
}
interface Agg {
  requests: number; tokensIn: number; tokensOut: number;
  costUsd: number; durationMs: number; errors: number;
  modelCounts: Record<string, number>;
}
interface DayRow extends Agg { date: string; byAgent: Record<string, Agg> }
interface RuRow extends Agg { ruName: string }
interface AgentRow extends Agg { agentId: string }
interface RuAgentRow extends Agg { ruName: string; agentId: string }
interface RuModelRow { ruName: string; model: string; requests: number; costUsd: number; durationMs: number }
type Metric = "cost" | "requests" | "tokens" | "duration";

const AGENT_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#64748b", "#14b8a6", "#a855f7"];

const fmtUsd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const fmtTok = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));
const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m}m${rs ? `${rs}s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
};
const agentColor = (a: string, agents: string[]) => AGENT_COLORS[Math.max(0, agents.indexOf(a)) % AGENT_COLORS.length];

function metricValue(row: Agg, metric: Metric): number {
  if (metric === "cost") return row.costUsd;
  if (metric === "requests") return row.requests;
  if (metric === "tokens") return row.tokensIn + row.tokensOut;
  return row.durationMs;
}
function metricLabel(v: number, metric: Metric): string {
  if (metric === "cost") return fmtUsd(v);
  if (metric === "requests") return fmtInt(v);
  if (metric === "tokens") return fmtTok(v);
  return fmtDur(v);
}
const isoDay = (iso: string): string | null => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 每日堆疊長條圖（SVG，by agent） */
function ModelsCell({ modelCounts }: { modelCounts: Record<string, number> }) {
  const entries = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <td style={{ padding: "5px 10px", whiteSpace: "nowrap", fontSize: 12, opacity: 0.35 }}>–</td>;
  const full = entries.map(([m, c]) => `${m} ×${c}`).join("\n");
  return (
    <td style={{ padding: "5px 10px", whiteSpace: "normal", fontSize: 11, minWidth: 120 }} title={full}>
      {entries.map(([m, c]) => (
        <div key={m} className="whitespace-nowrap">{m.split("/").pop()} <span style={{ opacity: 0.5 }}>×{c}</span></div>
      ))}
    </td>
  );
}

function StackedDailyChart({ days, metric, theme, agents }: { days: DayRow[]; metric: Metric; theme: any; agents: string[] }) {
  const { t } = useI18n();
  const chartAgents = useMemo(
    () => agents.filter(a => days.some(d => d.byAgent[a] && metricValue(d.byAgent[a], metric) > 0)),
    [agents, days, metric]
  );

  if (days.length === 0) return null;

  const H = 210, padL = 56, padR = 10, padT = 14, padB = 26;
  const barSlot = days.length > 40 ? 22 : 30;
  const W = Math.max(560, days.length * barSlot + padL + padR);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = Math.max(1e-9, ...days.map(d => metricValue(d, metric)));
  // y 軸刻度：漂亮的整數刻度
  const pow = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => maxVal / s <= 4) || pow * 10;
  const yMax = Math.ceil(maxVal / step) * step;
  const y = (v: number) => padT + plotH * (1 - v / yMax);
  const labelEvery = Math.max(1, Math.ceil(days.length / 14));

  return (
    <div>
      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        {chartAgents.map(a => (
          <span key={a} className="inline-flex items-center gap-1 text-[11px]" style={{ color: theme.text }}>
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: agentColor(a, agents) }} />
            {a}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto" style={{ border: `1px solid ${theme.borderLight}`, borderRadius: 8, background: theme.bgMuted }}>
        <svg width={W} height={H} role="img" style={{ display: "block" }}>
          {/* gridlines + y labels */}
          {Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step).map(v => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={theme.borderLight} strokeWidth={1} strokeDasharray={v === 0 ? "" : "3,3"} />
              <text x={padL - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={theme.text} opacity={0.55}>
                {metricLabel(v, metric)}
              </text>
            </g>
          ))}
          {/* stacked bars */}
          {days.map((d, i) => {
            const x = padL + (i * plotW) / days.length;
            const barW = Math.min(barSlot - 6, (plotW / days.length) * 0.7);
            let acc = 0;
            return (
              <g key={d.date}>
                {chartAgents.map(a => {
                  const seg = d.byAgent[a];
                  const v = seg ? metricValue(seg, metric) : 0;
                  if (v <= 0) return null;
                  const y0 = y(acc), y1 = y(acc + v);
                  acc += v;
                  return (
                    <rect key={a} x={x} y={y1} width={barW} height={Math.max(0, y0 - y1)} fill={agentColor(a, agents)} rx={1.5}>
                      <title>{`${d.date} · ${a}: ${metricLabel(v, metric)} (${t("report.requests")}: ${seg!.requests}, ${fmtUsd(seg!.costUsd)})`}</title>
                    </rect>
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={9.5} fill={theme.text} opacity={0.55}>
                    {d.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// PAAW Management 頁掛載時不傳 theme → 用預設淺色（與 AgentLogs 等管理頁一致）
const DEFAULT_THEME = { bg: "#ffffff", bgMuted: "#fafaf9", borderLight: "#e7e5e4", accent: "#b45309", accentBg: "#fef3c7", text: "#374151" };

export default function UsageReportPanel({ theme = DEFAULT_THEME }: { theme?: any }) {
  const { t } = useI18n();
  const [items, setItems] = useState<TaskItem[]>([]);
  const [from, setFrom] = useState<string>(() => isoDay(new Date(Date.now() - 29 * 86400_000).toISOString()) || "");
  const [to, setTo] = useState<string>(() => isoDay(new Date().toISOString()) || "");
  const [ru, setRu] = useState<string>("");
  const [agent, setAgent] = useState<string>("");
  const [metric, setMetric] = useState<Metric>("cost");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 一次拉現成 API 的最近任務（limit 上限 200 = index 全量）
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/agent-logs?limit=100000`); // 2026-09-16：index 全保留（之後接 ES）
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const quickRange = (days: number | null) => {
    if (days === null) { setFrom(""); setTo(""); return; }
    setTo(isoDay(new Date().toISOString()) || "");
    setFrom(isoDay(new Date(Date.now() - (days - 1) * 86400_000).toISOString()) || "");
  };

  const options = useMemo(() => ({
    agents: [...new Set(items.map(i => i.agentId))].sort(),
    rus: [...new Set(items.map(i => i.ruName || "-"))].sort(),
  }), [items]);

  // ── 前端聚合：filter → byDay / byRu / byAgent / byRuAgent / totals ──
  const report = useMemo(() => {
    const newAgg = (): Agg => ({ requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0, errors: 0, modelCounts: {} });
    const add = (agg: Agg, e: TaskItem) => {
      agg.requests += 1;
      agg.tokensIn += e.usage?.prompt || 0;
      agg.tokensOut += e.usage?.completion || 0;
      agg.costUsd += e.costUsd || 0;
      agg.durationMs += e.durationMs || 0;
      if (e.status && e.status !== "completed") agg.errors += 1;
      const rawModels: Array<string | { model?: string }> = e.models?.length ? e.models : (e.model ? [e.model] : []);
      const models = rawModels.map(x => (typeof x === "string" ? x : x?.model) ?? "").map(m => m.trim()).filter(m => m);
      for (const m of new Set(models)) agg.modelCounts[m] = (agg.modelCounts[m] || 0) + 1;
    };

    const filtered = items.filter(e => {
      const d = isoDay(e.startTime);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      const ruName = e.ruName || "-";
      if (ru && ruName !== ru) return false;
      if (agent && e.agentId !== agent) return false;
      return true;
    });

    const totals = newAgg();
    const byDayMap = new Map<string, DayRow>();
    const byRuMap = new Map<string, RuRow>();
    const byAgentMap = new Map<string, AgentRow>();
    const byRuAgentMap = new Map<string, RuAgentRow>();
    const byRuModelMap = new Map<string, RuModelRow>(); // 2026-09-17 Fleming：RU × Model 表（request / cost / duration）

    for (const e of filtered) {
      const d = isoDay(e.startTime)!;
      const ruName = e.ruName || "-";
      add(totals, e);

      if (!byDayMap.has(d)) byDayMap.set(d, { date: d, ...newAgg(), byAgent: {} });
      const day = byDayMap.get(d)!;
      add(day, e);
      if (!day.byAgent[e.agentId]) day.byAgent[e.agentId] = newAgg();
      add(day.byAgent[e.agentId], e);

      if (!byRuMap.has(ruName)) byRuMap.set(ruName, { ruName, ...newAgg() });
      add(byRuMap.get(ruName)!, e);

      if (!byAgentMap.has(e.agentId)) byAgentMap.set(e.agentId, { agentId: e.agentId, ...newAgg() });
      add(byAgentMap.get(e.agentId)!, e);

      const raKey = `${ruName}\u001f${e.agentId}`;
      if (!byRuAgentMap.has(raKey)) byRuAgentMap.set(raKey, { ruName, agentId: e.agentId, ...newAgg() });
      add(byRuAgentMap.get(raKey)!, e);

      // RU × Model：cost/duration 依 model 呼叫數比例分攤（多模型任務總計不變）
      const rmModels = ((e.models?.length ? e.models : (e.model ? [e.model] : [])) as Array<string | { model?: string }>)
        .map(x => (typeof x === "string" ? x : x?.model) ?? "").map(m => m.trim()).filter(Boolean);
      const rmKeys = rmModels.length ? [...new Set(rmModels)] : ["-"];
      const rmShare = 1 / rmKeys.length;
      for (const m of rmKeys) {
        const rmKey = `${ruName}\u001f${m}`;
        if (!byRuModelMap.has(rmKey)) byRuModelMap.set(rmKey, { ruName, model: m, requests: 0, costUsd: 0, durationMs: 0 });
        const row = byRuModelMap.get(rmKey)!;
        row.requests += 1;
        row.costUsd += (e.costUsd || 0) * rmShare;
        row.durationMs += (e.durationMs || 0) * rmShare;
      }
    }

    const sortCost = (a: { costUsd: number }, b: { costUsd: number }) => b.costUsd - a.costUsd;
    const byDay = Array.from(byDayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    return {
      totals,
      byDay,
      byRu: Array.from(byRuMap.values()).sort(sortCost),
      byAgent: Array.from(byAgentMap.values()).sort(sortCost),
      byRuAgent: Array.from(byRuAgentMap.values()).sort((a, b) => a.ruName.localeCompare(b.ruName) || sortCost(a, b)),
      byRuModel: Array.from(byRuModelMap.values()).sort((a, b) => a.ruName.localeCompare(b.ruName) || b.costUsd - a.costUsd),
      dateFrom: byDay[0]?.date || null,
      dateTo: byDay[byDay.length - 1]?.date || null,
      count: filtered.length,
    };
  }, [items, from, to, ru, agent]);

  // RU × Agent 分組（RU 小計 + agent 明細）
  const ruGroups = useMemo(() => {
    const map = new Map<string, { ruName: string; subtotal: RuAgentRow; rows: RuAgentRow[] }>();
    for (const r of report.byRuAgent) {
      if (!map.has(r.ruName)) map.set(r.ruName, {
        ruName: r.ruName,
        subtotal: { ruName: r.ruName, agentId: "", requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0, errors: 0, modelCounts: {} },
        rows: [],
      });
      const g = map.get(r.ruName)!;
      g.rows.push(r);
      g.subtotal.requests += r.requests; g.subtotal.tokensIn += r.tokensIn; g.subtotal.tokensOut += r.tokensOut;
      g.subtotal.costUsd += r.costUsd; g.subtotal.durationMs += r.durationMs; g.subtotal.errors += r.errors;
      for (const [m, c] of Object.entries(r.modelCounts)) g.subtotal.modelCounts[m] = (g.subtotal.modelCounts[m] || 0) + c;
    }
    return Array.from(map.values());
  }, [report]);

  // 2026-09-18 Fleming：RU × Model 表改 group 模式 — 同 RU 的不同 model 集中（subtotal + 縮排明細）
  const ruModelGroups = useMemo(() => {
    const map = new Map<string, { ruName: string; subtotal: { requests: number; costUsd: number; durationMs: number }; rows: RuModelRow[] }>();
    for (const r of report.byRuModel) {
      if (!map.has(r.ruName)) map.set(r.ruName, { ruName: r.ruName, subtotal: { requests: 0, costUsd: 0, durationMs: 0 }, rows: [] });
      const g = map.get(r.ruName)!;
      g.rows.push(r);
      g.subtotal.requests += r.requests; g.subtotal.costUsd += r.costUsd; g.subtotal.durationMs += r.durationMs;
    }
    const groups = Array.from(map.values());
    for (const g of groups) g.rows.sort((a, b) => b.costUsd - a.costUsd);
    groups.sort((a, b) => b.subtotal.costUsd - a.subtotal.costUsd);
    return groups;
  }, [report]);

  const card: React.CSSProperties = {
    background: theme.bgMuted, border: `1px solid ${theme.borderLight}`,
    borderRadius: 10, padding: "10px 14px", minWidth: 130,
  };
  const th: React.CSSProperties = { textAlign: "left", fontWeight: 600, opacity: 0.55, fontSize: 11, padding: "6px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "5px 10px", whiteSpace: "nowrap", fontSize: 12 };
  const inputStyle: React.CSSProperties = {
    background: "transparent", color: theme.text, border: `1px solid ${theme.borderLight}`,
    borderRadius: 6, padding: "3px 8px", fontSize: 12,
  };

  const metrics: Array<{ id: Metric; label: string }> = [
    { id: "cost", label: t("report.metric.cost") },
    { id: "requests", label: t("report.metric.requests") },
    { id: "tokens", label: t("report.metric.tokens") },
    { id: "duration", label: t("report.metric.duration") },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: theme.bg, color: theme.text }}>
      {/* ── Header + filters ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-sm font-bold mr-2">📊 {t("report.title")}</h2>
        <span className="text-[11px]" style={{ opacity: 0.55 }}>{t("report.subtitle")}</span>
        <span className="flex-1" />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} title={t("report.from")} />
        <span className="text-[11px]" style={{ opacity: 0.55 }}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} title={t("report.to")} />
        {([[7, "7d"], [30, "30d"], [90, "90d"]] as Array<[number, string]>).map(([d, lbl]) => (
          <button key={lbl} onClick={() => quickRange(d)} className="text-[11px] px-2 py-0.5 rounded border hover:opacity-80"
            style={{ borderColor: theme.borderLight, color: theme.text }}>{lbl}</button>
        ))}
        <button onClick={() => quickRange(null)} className="text-[11px] px-2 py-0.5 rounded border hover:opacity-80"
          style={{ borderColor: theme.borderLight, color: theme.text }}>{t("report.all")}</button>
        <select value={ru} onChange={e => setRu(e.target.value)} style={inputStyle} title="Release Unit">
          <option value="">{t("report.allRu")}</option>
          {options.rus.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={agent} onChange={e => setAgent(e.target.value)} style={inputStyle} title="Agent">
          <option value="">{t("report.allAgents")}</option>
          {options.agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button onClick={load} disabled={loading} className="text-[11px] px-2 py-0.5 rounded hover:opacity-80"
          style={{ border: `1px solid ${theme.borderLight}`, color: theme.text }} title={t("report.refresh")}>
          {loading ? "…" : "⟳"}
        </button>
      </div>

      {error && <div className="mb-3 text-xs" style={{ color: "#ef4444" }}>{t("report.error")}: {error}</div>}
      {!error && items.length === 0 && loading && <div className="text-xs" style={{ opacity: 0.55 }}>{t("report.loading")}</div>}
      {report && report.count === 0 && !loading && (
        <div className="text-xs" style={{ opacity: 0.55 }}>{t("report.noData")}</div>
      )}

      {report && report.count > 0 && (
        <>
          {/* ── Summary cards ── */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div style={card}><div className="text-[10px]" style={{ opacity: 0.55 }}>{t("report.requests")}</div><div className="text-lg font-bold">{fmtInt(report.totals.requests)}</div></div>
            <div style={card}><div className="text-[10px]" style={{ opacity: 0.55 }}>{t("report.tokensIn")}</div><div className="text-lg font-bold">{fmtTok(report.totals.tokensIn)}</div></div>
            <div style={card}><div className="text-[10px]" style={{ opacity: 0.55 }}>{t("report.tokensOut")}</div><div className="text-lg font-bold">{fmtTok(report.totals.tokensOut)}</div></div>
            <div style={card}><div className="text-[10px]" style={{ opacity: 0.55 }}>{t("report.cost")}</div><div className="text-lg font-bold">{fmtUsd(report.totals.costUsd)}</div></div>
            <div style={card}><div className="text-[10px]" style={{ opacity: 0.55 }}>{t("report.duration")}</div><div className="text-lg font-bold">{fmtDur(report.totals.durationMs)}</div></div>
            <div style={card}><div className="text-[10px]" style={{ opacity: 0.55 }}>{t("report.avgDuration")}</div><div className="text-lg font-bold">{fmtDur(report.totals.durationMs / Math.max(1, report.totals.requests))}</div></div>
            <div style={card}><div className="text-[10px]" style={{ opacity: 0.55 }}>{t("report.errors")}</div><div className="text-lg font-bold">{fmtInt(report.totals.errors)}</div></div>
          </div>

          {/* ── Chart ── */}
          <div className="mb-2 flex items-center gap-2 flex-wrap">
            <h3 className="text-xs font-bold">{t("report.chart.daily")}</h3>
            <span className="flex-1" />
            <div className="flex gap-1">
              {metrics.map(m => (
                <button key={m.id} onClick={() => setMetric(m.id)} className="text-[11px] px-2 py-0.5 rounded"
                  style={{
                    border: `1px solid ${metric === m.id ? theme.accent : theme.borderLight}`,
                    background: metric === m.id ? theme.accentBg : "transparent",
                    color: metric === m.id ? theme.accent : theme.text,
                  }}>{m.label}</button>
              ))}
            </div>
          </div>
          <div className="mb-5"><StackedDailyChart days={report.byDay} metric={metric} theme={theme} agents={options.agents} /></div>

          {/* ── Table 1: 每日統計 ── */}
          <h3 className="text-xs font-bold mb-2">{t("report.table.daily")}</h3>
          <div className="overflow-x-auto mb-5" style={{ border: `1px solid ${theme.borderLight}`, borderRadius: 8 }}>
            <table className="w-full border-collapse" style={{ background: theme.bgMuted }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                  <th style={th}>{t("report.date")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.requests")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.tokensIn")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.tokensOut")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.cost")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.duration")}</th>
                  <th style={th}>{t("report.models")}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {[...report.byDay].reverse().map(d => (
                  <tr key={d.date} style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                    <td style={td}>{d.date}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtInt(d.requests)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtTok(d.tokensIn)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtTok(d.tokensOut)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtUsd(d.costUsd)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtDur(d.durationMs)}</td>
                    <ModelsCell modelCounts={d.modelCounts} />
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ ...td, fontWeight: 700 }}>{t("report.total")}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtInt(report.totals.requests)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtTok(report.totals.tokensIn)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtTok(report.totals.tokensOut)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtUsd(report.totals.costUsd)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtDur(report.totals.durationMs)}</td>
                  <ModelsCell modelCounts={report.totals.modelCounts} />
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Table 2: RU × Agent ── */}
          <h3 className="text-xs font-bold mb-2">{t("report.table.ruAgent")}</h3>
          <div className="overflow-x-auto mb-4" style={{ border: `1px solid ${theme.borderLight}`, borderRadius: 8 }}>
            <table className="w-full border-collapse" style={{ background: theme.bgMuted }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                  <th style={th}>Release Unit</th>
                  <th style={th}>Agent</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.requests")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.tokens")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.cost")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.duration")}</th>
                  <th style={th}>{t("report.models")}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {ruGroups.map(g => (
                  <React.Fragment key={g.ruName}>
                    <tr style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bg }}>
                      <td style={{ ...td, fontWeight: 700 }}>{g.ruName}</td>
                      <td style={{ ...td, fontWeight: 700, opacity: 0.65 }}>{t("report.subtotal")}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtInt(g.subtotal.requests)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtTok(g.subtotal.tokensIn + g.subtotal.tokensOut)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtUsd(g.subtotal.costUsd)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtDur(g.subtotal.durationMs)}</td>
                      <ModelsCell modelCounts={g.subtotal.modelCounts} />
                    </tr>
                    {g.rows.map(r => (
                      <tr key={`${r.ruName}/${r.agentId}`} style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                        <td style={{ ...td, opacity: 0.4 }}>└</td>
                        <td style={td}>
                          <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: agentColor(r.agentId, options.agents) }} />
                          {r.agentId}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtInt(r.requests)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtTok(r.tokensIn + r.tokensOut)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtUsd(r.costUsd)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtDur(r.durationMs)}</td>
                        <ModelsCell modelCounts={r.modelCounts} />
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr>
                  <td colSpan={2} style={{ ...td, fontWeight: 700 }}>{t("report.total")}</td>
                  <td />
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtInt(report.totals.requests)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtTok(report.totals.tokensIn + report.totals.tokensOut)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtUsd(report.totals.costUsd)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtDur(report.totals.durationMs)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Table 3: Release Unit × Model（2026-09-17 Fleming：RU / model / requests / cost / duration）── */}
          <h3 className="text-xs font-bold mb-2">{t("report.table.ruModel")}</h3>
          <div className="overflow-x-auto mb-4" style={{ border: `1px solid ${theme.borderLight}`, borderRadius: 8 }}>
            <table className="w-full border-collapse" style={{ background: theme.bgMuted }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                  <th style={th}>Release Unit</th>
                  <th style={th}>{t("report.model")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.requests")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.cost")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("report.duration")}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {ruModelGroups.map(g => (
                  <React.Fragment key={g.ruName}>
                    <tr style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bg }}>
                      <td style={{ ...td, fontWeight: 700 }}>{g.ruName}</td>
                      <td style={{ ...td, fontWeight: 700, opacity: 0.65 }}>{t("report.subtotal")}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtInt(g.subtotal.requests)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtUsd(g.subtotal.costUsd)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtDur(g.subtotal.durationMs)}</td>
                    </tr>
                    {g.rows.map(r => (
                      <tr key={`${r.ruName}/${r.model}`} style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                        <td style={{ ...td, opacity: 0.4 }}>└</td>
                        <td style={td}>{r.model}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtInt(r.requests)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtUsd(r.costUsd)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtDur(r.durationMs)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={2} style={{ ...td, fontWeight: 700 }}>{t("report.total")}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtInt(report.totals.requests)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtUsd(report.totals.costUsd)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtDur(report.totals.durationMs)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="text-[10px]" style={{ opacity: 0.45 }}>
            {t("report.range")}: {report.dateFrom || "–"} → {report.dateTo || "–"} · {t("report.sampleNote")}
          </div>
        </>
      )}
    </div>
  );
}
