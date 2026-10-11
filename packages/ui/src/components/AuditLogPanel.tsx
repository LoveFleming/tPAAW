/**
 * AuditLogPanel — 安全審計紀錄報表（2026-10-11 Fleming）
 *
 * 讀 /api/audit-log（audit-log.mjs 落盤的 audit-*.jsonl 事實來源）— 讓 PAAW 內就能看
 * 「AI 犯傻」審計，不必依賴 Elasticsearch。設定 → 🛡 安全 內嵌。
 */
import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";

interface AuditEvent {
  eid: string;
  "@timestamp": string;
  kind: string;
  severity: "block" | "warn" | "info" | string;
  layer?: string;
  tool?: string | null;
  command?: string | null;
  reason?: string | null;
  domains?: string[];
  agentId?: string | null;
  runId?: string | null;
  ruSlug?: string | null;
  cwd?: string | null;
  hostName?: string;
}

const SEV: Record<string, { color: string; bg: string; label: string }> = {
  block: { color: "#b91c1c", bg: "#fef2f2", label: "Block" },
  warn:  { color: "#d97706", bg: "#fffbeb", label: "Warn" },
  info:  { color: "#2563eb", bg: "#eff6ff", label: "Info" },
};

const KIND_LABEL: Record<string, string> = {
  network_block: "🌐 網路白名單",
  network_allow: "🔓 白名單放行",
  sandbox_fs_deny: "🔒 沙箱防護",
  shell_guard: "🛡 Shell 護欄",
  script_guard: "🛡 Script 護欄",
  script_guard_entry: "🛡 執行入口寫入",
  path_violation: "📁 路徑越界",
  doom_loop: "🔁 重複迴圈",
  block_retry: "⛔ 被擋後重試",
  approval_request: "✅ 審批請求",
  approval_decision: "⚖️ 審批決策",
  env_exec_block: "🧰 環境工具攔截",
};

export default function AuditLogPanel() {
  const { t } = useI18n();
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [severity, setSeverity] = useState<string>("");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (d?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (d) params.set("date", d);
      if (severity) params.set("severity", severity);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`${API_BASE}/api/audit-log?${params.toString()}`);
      const j = await res.json();
      setData(j);
      if (Array.isArray(j.dates)) setDates(j.dates);
      if (j.date) setDate(j.date);
    } catch { setData({ ok: false, error: "fetch failed" }); }
    finally { setLoading(false); }
  }, [severity, q]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = data?.stats;
  const events: AuditEvent[] = data?.events || [];

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-base font-bold text-stone-700">📋 {t("settings.audit.title")}</h3>
        <span className="flex-1" />
        <select
          value={date}
          onChange={e => { setDate(e.target.value); load(e.target.value); }}
          className="text-xs px-2 py-1 rounded border border-stone-200 focus:outline-none"
        >
          {dates.length === 0 && <option value="">—</option>}
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button onClick={() => load(date)} disabled={loading}
          className="text-xs px-3 py-1 rounded bg-stone-100 text-stone-600 hover:bg-stone-200 font-semibold disabled:opacity-50">
          {loading ? "…" : "🔄"}
        </button>
      </div>
      <p className="text-sm text-stone-400 mb-3">{t("settings.audit.desc")}</p>

      {/* 統計 chips */}
      {stats && data?.total > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <span className="text-stone-500">{t("settings.audit.total")} {data.total}</span>
          {["block", "warn", "info"].filter(s => stats.bySeverity[s]).map(s => (
            <button key={s} onClick={() => setSeverity(severity === s ? "" : s)}
              className="px-2 py-0.5 rounded-full font-semibold border transition-colors"
              style={{ backgroundColor: severity === s ? SEV[s].color : SEV[s].bg, color: severity === s ? "#fff" : SEV[s].color, borderColor: SEV[s].color + "55" }}>
              {SEV[s].label} {stats.bySeverity[s]}
            </button>
          ))}
          <span className="text-stone-300">·</span>
          {Object.entries(stats.byKind || {}).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, n]) => (
            <span key={k} className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">{KIND_LABEL[k] || k} {n as number}</span>
          ))}
        </div>
      )}

      {/* 搜尋 */}
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") load(date); }}
        placeholder={t("settings.audit.search")}
        className="w-full mb-3 px-3 py-1.5 rounded-lg border border-stone-200 text-xs focus:outline-none focus:border-stone-400"
      />

      {loading && events.length === 0 && <div className="text-xs text-stone-400 py-4 text-center">{t("settings.audit.loading")}</div>}

      {!loading && events.length === 0 && (
        <div className="text-xs text-stone-400 py-6 text-center">
          {data?.exists === false ? t("settings.audit.none") : t("settings.audit.empty")}
        </div>
      )}

      {/* 事件列表 */}
      {events.length > 0 && (
        <div className="border border-stone-100 rounded-lg overflow-hidden" style={{ maxHeight: 460, overflowY: "auto" }}>
          {events.map((e, i) => {
            const sev = SEV[e.severity] || SEV.warn;
            const open = expanded === e.eid;
            const time = (e["@timestamp"] || "").slice(11, 19);
            return (
              <div key={e.eid || i} className="border-b border-stone-100 last:border-b-0">
                <button
                  onClick={() => setExpanded(open ? null : e.eid)}
                  className="w-full text-left px-3 py-2 hover:bg-stone-50 flex items-center gap-2"
                >
                  <span className="text-[10px] font-mono text-stone-400 shrink-0 w-14">{time}</span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sev.color }} />
                  <span className="text-xs font-semibold shrink-0" style={{ color: sev.color }}>{KIND_LABEL[e.kind] || e.kind}</span>
                  {e.layer && <span className="text-[10px] text-stone-400 px-1.5 py-0.5 rounded bg-stone-100 shrink-0">{e.layer}</span>}
                  {e.tool && <span className="text-[10px] font-mono text-stone-400 shrink-0">{e.tool}</span>}
                  <span className="text-xs text-stone-500 truncate flex-1 min-w-0">{e.command || e.reason || ""}</span>
                  {e.agentId && <span className="text-[10px] text-stone-400 shrink-0">{e.agentId.replace(/^coding\./, "")}</span>}
                  <span className="text-stone-300 text-xs shrink-0">{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-1 space-y-1.5 text-xs bg-stone-50/60">
                    {e.reason && <div><span className="text-stone-400">理由：</span><span className="text-stone-600">{e.reason}</span></div>}
                    {e.command && (
                      <div>
                        <span className="text-stone-400">指令：</span>
                        <pre className="mt-1 p-2 rounded bg-white border border-stone-200 font-mono text-[11px] whitespace-pre-wrap break-all">{e.command}</pre>
                      </div>
                    )}
                    {e.domains && e.domains.length > 0 && <div><span className="text-stone-400">網域：</span><span className="text-stone-600 font-mono">{e.domains.join(", ")}</span></div>}
                    <div className="flex flex-wrap gap-3 text-[10px] text-stone-400">
                      {e.agentId && <span>agent: {e.agentId}</span>}
                      {e.ruSlug && <span>RU: {e.ruSlug}</span>}
                      {e.runId && <span>run: {e.runId.slice(0, 12)}</span>}
                      {e.hostName && <span>host: {e.hostName}</span>}
                      {e["@timestamp"] && <span>{e["@timestamp"]}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {data?.truncated && <div className="px-3 py-1.5 text-[10px] text-stone-400 text-center border-t border-stone-100">（僅顯示前 {events.length} 筆 — 用搜尋縮小範圍）</div>}
        </div>
      )}
    </div>
  );
}
