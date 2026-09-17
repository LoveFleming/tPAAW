/**
 * QaRecords — QA 記錄檢視器（2026-09-17 Fleming：「要可以有 ui 可以看 qa 單」）
 *
 * 資料源：GET/PATCH/DELETE /api/coding-crew/qa-results（lib qa-results.mjs，jsonl 存儲）
 * 記錄主要來自 agent 的 qa_record_save tool；UI 提供：
 *  - 列表（verdict/status/type filter + 搜尋 + 統計列）
 *  - 詳情（summary / issues / evidence / history 軌跡）
 *  - Human 操作：issue 標 resolved/wontfix、刪除記錄
 */
import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import MarkdownText from "./MarkdownText";

interface QaIssue {
  severity: "critical" | "major" | "minor";
  desc: string;
  status: "open" | "resolved" | "wontfix";
  evidence?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
}

interface QaHistoryEntry {
  ts: string;
  by: string;
  from: string;
  to: string;
  note?: string | null;
}

interface QaRecord {
  id: string;
  ts: string;
  updatedAt: string | null;
  actor: string;
  type: "browser" | "smoke" | "api" | "review" | "e2e" | "manual";
  target: string;
  url?: string | null;
  taskId?: string | null;
  feature?: string | null;
  verdict: "pass" | "fail" | "warn" | "blocked";
  summary: string;
  issues: QaIssue[];
  evidence: string[];
  durationMs: number | null;
  status: "open" | "resolved" | "wontfix";
  history: QaHistoryEntry[];
}

interface QaStats {
  total: number;
  open: number;
  failOpen: number;
  byVerdict: Record<string, number>;
  lastTs: string | null;
}

interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string };
}

const VERDICT_STYLES: Record<string, { icon: string; bg: string; text: string }> = {
  pass:    { icon: "✅", bg: "#f0fdf4", text: "#16a34a" },
  fail:    { icon: "❌", bg: "#fef2f2", text: "#dc2626" },
  warn:    { icon: "⚠️", bg: "#fffbeb", text: "#d97706" },
  blocked: { icon: "⛔", bg: "#faf5ff", text: "#9333ea" },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  open:     { bg: "#fef2f2", text: "#dc2626" },
  resolved: { bg: "#f0fdf4", text: "#16a34a" },
  wontfix:  { bg: "#faf5ff", text: "#9333ea" },
};

const TYPE_ICONS: Record<string, string> = {
  browser: "🧭", smoke: "💨", api: "🌐", review: "👀", e2e: "🎬", manual: "✍️",
};

const SEVERITY_STYLES: Record<string, { color: string; label: string }> = {
  critical: { color: "#dc2626", label: "🔴" },
  major:    { color: "#ea580c", label: "🟠" },
  minor:    { color: "#f59e0b", label: "🟡" },
};

export default function QaRecords({ rootPath, theme }: Props) {
  const { t } = useI18n();
  const [records, setRecords] = useState<QaRecord[]>([]);
  const [stats, setStats] = useState<QaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const base = `${API_BASE}/api/coding-crew/qa-results`;

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ cwd: rootPath, limit: "200" });
      if (verdictFilter !== "all") params.set("verdict", verdictFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const res = await fetch(`${base}?${params}`);
      const data = await res.json();
      setRecords(data.results || []);
    } catch (err) { console.error("[QaRecords] fetch error:", err); }
    setLoading(false);
  }, [base, rootPath, verdictFilter, statusFilter, typeFilter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${base}?cwd=${encodeURIComponent(rootPath)}&stats=1`);
      if (res.ok) { const d = await res.json(); setStats(d.stats); }
    } catch {}
  }, [base, rootPath]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const selected = records.find(r => r.id === selectedId) || null;

  const patchRecord = async (id: string, patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: rootPath, by: "human", ...patch }),
      });
      if (res.ok) { const d = await res.json(); setRecords(prev => prev.map(r => r.id === id ? d.record : r)); await fetchStats(); }
    } catch (err) { console.error("[QaRecords] patch error:", err); }
    setBusy(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete ${id}?`)) return;
    setBusy(true);
    try {
      await fetch(`${base}/${encodeURIComponent(id)}?cwd=${encodeURIComponent(rootPath)}`, { method: "DELETE" });
      setSelectedId(null);
      await fetchRecords();
      await fetchStats();
    } catch (err) { console.error("[QaRecords] delete error:", err); }
    setBusy(false);
  };

  const inputStyle = { background: theme.bg, color: theme.text, borderColor: theme.borderLight } as React.CSSProperties;

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    if (diffMs < 60_000) return t("qaRecords.justNow");
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}${t("qaRecords.minAgo")}`;
    return d.toLocaleString();
  };

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* Left: record list */}
      <div className="w-[46%] flex flex-col border-r" style={{ borderColor: theme.borderLight }}>
        {stats && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap" style={{ background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}` }}>
            <span style={{ color: theme.text, opacity: 0.6 }}>{t("qaRecords.total")}: <b>{stats.total}</b></span>
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.open.bg, color: STATUS_STYLES.open.text }}>{t("qaRecords.statusOpen")}: {stats.open}</span>
            {stats.failOpen > 0 && <span className="px-1.5 py-0.5 rounded font-medium" style={{ background: "#fef2f2", color: "#dc2626" }}>❌ {t("qaRecords.failOpen")}: {stats.failOpen}</span>}
            {Object.entries(stats.byVerdict || {}).filter(([k, v]) => v > 0 && k !== "fail").map(([k, v]) => {
              const vs = VERDICT_STYLES[k];
              return vs ? <span key={k} className="px-1.5 py-0.5 rounded" style={{ background: vs.bg, color: vs.text }}>{vs.icon} {v}</span> : null;
            })}
          </div>
        )}
        <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
          <select value={verdictFilter} onChange={e => setVerdictFilter(e.target.value)} className="text-xs px-1.5 py-1 rounded border outline-none" style={inputStyle}>
            <option value="all">{t("qaRecords.allVerdicts")}</option>
            {Object.keys(VERDICT_STYLES).map(v => <option key={v} value={v}>{VERDICT_STYLES[v].icon} {v}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-xs px-1.5 py-1 rounded border outline-none" style={inputStyle}>
            <option value="all">{t("qaRecords.allStatuses")}</option>
            <option value="open">{t("qaRecords.statusOpen")}</option>
            <option value="resolved">{t("qaRecords.statusResolved")}</option>
            <option value="wontfix">{t("qaRecords.statusWontfix")}</option>
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="text-xs px-1.5 py-1 rounded border outline-none" style={inputStyle}>
            <option value="all">{t("qaRecords.allTypes")}</option>
            {Object.keys(TYPE_ICONS).map(v => <option key={v} value={v}>{TYPE_ICONS[v]} {v}</option>)}
          </select>
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t("qaRecords.search")} className="flex-1 text-xs px-2 py-1 rounded border outline-none min-w-0" style={inputStyle} />
          <button onClick={() => { fetchRecords(); fetchStats(); }} className="text-xs px-1.5 py-1 rounded shrink-0" style={{ background: theme.bgMuted, color: theme.text }} title="Refresh">🔄</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>{t("qaRecords.loading")}</div>
          : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              <div className="text-3xl">🧾</div>
              <div>{t("qaRecords.empty")}</div>
              <div className="text-xs max-w-[260px] text-center">{t("qaRecords.emptyHint")}</div>
            </div>
          )
          : records.map(r => {
            const vs = VERDICT_STYLES[r.verdict] || VERDICT_STYLES.warn;
            const ss = STATUS_STYLES[r.status] || STATUS_STYLES.open;
            const openIssues = (r.issues || []).filter(i => i.status === "open").length;
            const isSelected = r.id === selectedId;
            return (
              <div key={r.id} onClick={() => setSelectedId(r.id)} className="px-3 py-2.5 cursor-pointer border-b transition-colors" style={{ borderColor: theme.borderLight, background: isSelected ? theme.accentBg : "transparent" }} onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }} onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
                <div className="flex items-start gap-2">
                  <span className="text-sm shrink-0 mt-0.5">{vs.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: vs.bg, color: vs.text }}>{r.verdict}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: ss.bg, color: ss.text }}>{r.status}</span>
                      <span className="text-[10px] shrink-0" style={{ color: theme.text, opacity: 0.5 }}>{TYPE_ICONS[r.type] || "✍️"} {r.type}</span>
                      {openIssues > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium" style={{ background: "#fef2f2", color: "#dc2626" }}>🐞 {openIssues}</span>}
                      {(r.issues || []).length > openIssues && <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: "#f0fdf4", color: "#16a34a" }}>✓ {(r.issues || []).length - openIssues}</span>}
                    </div>
                    <div className="text-sm font-medium truncate" style={{ color: theme.text }}>{r.target || r.summary.slice(0, 60)}</div>
                    <div className="text-[10px] mt-0.5 truncate" style={{ color: theme.text, opacity: 0.4 }}>
                      {r.actor} · {fmtTime(r.ts)}{r.taskId ? ` · 📌 ${r.taskId}` : ""}{r.feature ? ` · 🗺️ ${r.feature}` : ""}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">🧾</div>
            <div className="text-sm">{t("qaRecords.selectDetail")}</div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            {(() => {
              const vs = VERDICT_STYLES[selected.verdict] || VERDICT_STYLES.warn;
              const ss = STATUS_STYLES[selected.status] || STATUS_STYLES.open;
              return (
                <>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-mono" style={{ color: theme.text, opacity: 0.5 }}>{selected.id}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: vs.bg, color: vs.text }}>{vs.icon} {selected.verdict}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: ss.bg, color: ss.text }}>{selected.status}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>{TYPE_ICONS[selected.type] || "✍️"} {selected.type}</span>
                      </div>
                      <h2 className="text-lg font-bold break-words" style={{ color: theme.text }}>{selected.target}</h2>
                      <div className="flex gap-3 text-xs mt-1 flex-wrap" style={{ color: theme.text, opacity: 0.5 }}>
                        <span>👤 {selected.actor}</span>
                        <span>📅 {new Date(selected.ts).toLocaleString()}</span>
                        {selected.durationMs != null && <span>⏱️ {(selected.durationMs / 1000).toFixed(1)}s</span>}
                        {selected.updatedAt && <span>🔄 {new Date(selected.updatedAt).toLocaleString()}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => patchRecord(selected.id, { status: selected.status === "resolved" ? "open" : "resolved" })} disabled={busy} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>
                        {selected.status === "resolved" ? t("qaRecords.reopen") : t("qaRecords.markResolved")}
                      </button>
                      <button onClick={() => handleDelete(selected.id)} disabled={busy} className="text-xs px-2 py-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>🗑️</button>
                    </div>
                  </div>

                  {selected.url && (
                    <div className="mb-3 text-xs font-mono px-2 py-1 rounded break-all" style={{ background: theme.bgMuted, color: theme.accent }}>🔗 {selected.url}</div>
                  )}
                  {(selected.taskId || selected.feature) && (
                    <div className="flex gap-1 mb-3 flex-wrap">
                      {selected.taskId && <span className="text-xs px-2 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>📌 {selected.taskId}</span>}
                      {selected.feature && <span className="text-xs px-2 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>🗺️ {selected.feature}</span>}
                    </div>
                  )}

                  {selected.summary && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{t("qaRecords.summary")}</h3>
                      <div style={{ color: theme.text }}><MarkdownText>{selected.summary}</MarkdownText></div>
                    </div>
                  )}

                  {(selected.issues || []).length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold uppercase mb-1.5" style={{ color: theme.text, opacity: 0.5 }}>{t("qaRecords.issues")} ({selected.issues.filter(i => i.status === "open").length} {t("qaRecords.openCount")})</h3>
                      <div className="flex flex-col gap-1.5">
                        {selected.issues.map((issue, idx) => {
                          const sev = SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.minor;
                          return (
                            <div key={idx} className="flex items-start gap-2 px-2.5 py-2 rounded" style={{ background: theme.bgMuted, borderLeft: `3px solid ${sev.color}` }}>
                              <span className="text-xs shrink-0">{sev.label}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm break-words" style={{ color: theme.text, textDecoration: issue.status === "resolved" ? "line-through" : undefined, opacity: issue.status === "resolved" ? 0.6 : 1 }}>{issue.desc}</div>
                                {issue.evidence && <div className="text-[10px] mt-0.5 font-mono break-all" style={{ color: theme.text, opacity: 0.4 }}>📎 {issue.evidence}</div>}
                                {issue.status !== "open" && (
                                  <div className="text-[10px] mt-0.5" style={{ color: "#16a34a" }}>
                                    ✓ {issue.status}{issue.resolvedBy ? ` · ${issue.resolvedBy}` : ""}{issue.resolvedAt ? ` · ${new Date(issue.resolvedAt).toLocaleString()}` : ""}
                                  </div>
                                )}
                              </div>
                              {issue.status === "open" && (
                                <div className="flex flex-col gap-1 shrink-0">
                                  <button onClick={() => patchRecord(selected.id, { issueIndex: idx, issueStatus: "resolved", note: t("qaRecords.humanResolved") })} disabled={busy} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "#f0fdf4", color: "#16a34a" }}>✓ {t("qaRecords.fix")}</button>
                                  <button onClick={() => patchRecord(selected.id, { issueIndex: idx, issueStatus: "wontfix" })} disabled={busy} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#faf5ff", color: "#9333ea" }}>{t("qaRecords.wontfix")}</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {(selected.evidence || []).length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold uppercase mb-1.5" style={{ color: theme.text, opacity: 0.5 }}>{t("qaRecords.evidence")}</h3>
                      <div className="flex flex-col gap-1">
                        {selected.evidence.map((ev, i) => (
                          <div key={i} className="text-xs font-mono px-2 py-1 rounded break-all" style={{ background: theme.bgMuted, color: theme.text }}>📎 {ev}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(selected.history || []).length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold uppercase mb-1.5" style={{ color: theme.text, opacity: 0.5 }}>{t("qaRecords.history")}</h3>
                      <div className="flex flex-col gap-1">
                        {selected.history.map((h, i) => (
                          <div key={i} className="flex gap-2 items-start text-xs">
                            <span style={{ color: theme.text, opacity: 0.4 }}>{new Date(h.ts).toLocaleString()}</span>
                            <span className="font-medium" style={{ color: theme.accent }}>{h.by}</span>
                            <span style={{ color: theme.text }}>{h.from} → {h.to}</span>
                            {h.note && <span className="flex-1" style={{ color: theme.text, opacity: 0.6 }}>{h.note}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
