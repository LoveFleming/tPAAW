/**
 * SkillsUsagePanel — Skill 使用報表（2026-10-15）
 *
 * 回答：「哪些 skill 真的被掛進 agent prompt？誰在用？注入了多少字？」
 * 資料：GET /api/llm-logs/skills-usage?days=N
 * 證據來源：appendSkillBindings 每次注入寫一筆 phase:"skills" 進 llm log — 程式 stamp，非 LLM 自述。
 * （背景：2026-10-15 四連修前，手動 dispatch / crew chat 從 2026-08-01 起從未注入過 skill）
 */
import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface SkillRow {
  id: string; count: number; sectionCharsTotal: number; avgSectionChars: number; lastTs: string;
  agents: Array<{ id: string; count: number }>;
}
interface AgentRow {
  id: string; count: number; chars: number; lastTs: string; lastCwd: string | null;
  skills: Array<{ id: string; count: number }>;
}
interface Usage {
  days: number;
  totals: { injections: number; skills: number; agents: number; chars: number };
  bySkill: SkillRow[];
  byAgent: AgentRow[];
  byDay: Array<{ date: string; count: number; chars: number }>;
}

const DEFAULT_THEME = { bg: "#ffffff", bgMuted: "#fafaf9", borderLight: "#e7e5e4", accent: "#b45309", accentBg: "#fef3c7", text: "#374151" };

const fmtChars = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const fmtAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "–";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export default function SkillsUsagePanel({ theme = DEFAULT_THEME }: { theme?: any }) {
  const { t } = useI18n();
  const [days, setDays] = useState(7); // 預設 7 天（log retention 預設視窗）
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 點下去看實際注入內容（/a2a/:id/system-prompt）
  const [viewAgent, setViewAgent] = useState<AgentRow | null>(null);
  const [viewPrompt, setViewPrompt] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const openPromptView = useCallback(async (agent: AgentRow) => {
    setViewAgent(agent); setViewPrompt(null); setViewError(null); setViewLoading(true);
    try {
      const cwdQ = agent.lastCwd ? `?cwd=${encodeURIComponent(agent.lastCwd)}` : "";
      const res = await fetch(`${API_BASE}/a2a/${encodeURIComponent(agent.id)}/system-prompt${cwdQ}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setViewPrompt(typeof j?.baseSystemPrompt === "string" ? j.baseSystemPrompt : "");
    } catch (e: any) { setViewError(e.message || String(e)); }
    finally { setViewLoading(false); }
  }, []);
  const closePromptView = useCallback(() => { setViewAgent(null); setViewPrompt(null); setViewError(null); }, []);

  const load = useCallback(async (d: number) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/llm-logs/skills-usage?days=${d}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const inputStyle: React.CSSProperties = {
    background: theme.bg, border: `1px solid ${theme.borderLight}`, borderRadius: 6,
    padding: "2px 8px", fontSize: 11, color: theme.text,
  };
  const th: React.CSSProperties = { textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 600, borderBottom: `1px solid ${theme.borderLight}`, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "5px 10px", fontSize: 12, borderBottom: `1px solid ${theme.borderLight}55`, whiteSpace: "nowrap" };
  const cardStyle: React.CSSProperties = {
    flex: 1, minWidth: 130, background: theme.bgMuted, border: `1px solid ${theme.borderLight}`,
    borderRadius: 8, padding: "10px 14px",
  };
  const maxDay = Math.max(1, ...(data?.byDay || []).map(d => d.count));

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: theme.bg, color: theme.text }}>
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-sm font-bold mr-2">🔥 {t("skillsUsage.title")}</h2>
        <span className="text-[11px]" style={{ opacity: 0.55 }}>{t("skillsUsage.subtitle")}</span>
        <span className="flex-1" />
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} className="text-[11px] px-2 py-0.5 rounded border hover:opacity-80"
            style={{ borderColor: days === d ? theme.accent : theme.borderLight, color: days === d ? theme.accent : theme.text, background: days === d ? theme.accentBg : "transparent" }}>
            {d}d
          </button>
        ))}
        <button onClick={() => load(days)} disabled={loading} className="text-[11px] px-2 py-0.5 rounded hover:opacity-80"
          style={{ border: `1px solid ${theme.borderLight}`, color: theme.text }} title={t("skillsUsage.refresh")}>
          {loading ? "…" : "⟳"}
        </button>
      </div>

      {error && <div className="mb-3 text-xs" style={{ color: "#ef4444" }}>{t("skillsUsage.error")}: {error}</div>}

      {/* ── Summary cards ── */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div style={cardStyle}>
          <div className="text-[10px] uppercase tracking-wider" style={{ opacity: 0.55 }}>{t("skillsUsage.totalInjections")}</div>
          <div className="text-xl font-bold">{data?.totals.injections ?? "–"}</div>
        </div>
        <div style={cardStyle}>
          <div className="text-[10px] uppercase tracking-wider" style={{ opacity: 0.55 }}>{t("skillsUsage.activeSkills")}</div>
          <div className="text-xl font-bold">{data?.totals.skills ?? "–"}</div>
        </div>
        <div style={cardStyle}>
          <div className="text-[10px] uppercase tracking-wider" style={{ opacity: 0.55 }}>{t("skillsUsage.activeAgents")}</div>
          <div className="text-xl font-bold">{data?.totals.agents ?? "–"}</div>
        </div>
        <div style={cardStyle}>
          <div className="text-[10px] uppercase tracking-wider" style={{ opacity: 0.55 }}>{t("skillsUsage.totalChars")}</div>
          <div className="text-xl font-bold">{data ? fmtChars(data.totals.chars) : "–"}</div>
        </div>
      </div>

      {/* ── Daily trend ── */}
      {data && data.byDay.length > 0 && (
        <div className="mb-4" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}`, borderRadius: 8, padding: "10px 14px" }}>
          <div className="text-[11px] font-semibold mb-2">{t("skillsUsage.daily")}</div>
          <div className="flex items-end gap-1" style={{ height: 60 }}>
            {data.byDay.map(d => (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.count}× (${fmtChars(d.chars)})`}>
                <div style={{ width: "70%", minWidth: 8, height: `${(d.count / maxDay) * 100}%`, background: theme.accent, opacity: 0.75, borderRadius: 3 }} />
                <div className="text-[9px] mt-0.5" style={{ opacity: 0.5 }}>{d.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── By skill ── */}
      <div className="mb-4">
        <div className="text-[11px] font-semibold mb-1">{t("skillsUsage.bySkill")}</div>
        {data && data.bySkill.length > 0 ? (
          <div style={{ border: `1px solid ${theme.borderLight}`, borderRadius: 8, overflow: "hidden" }}>
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: theme.bgMuted }}>
                  <th style={th}>{t("skillsUsage.skill")}</th>
                  <th style={th}>{t("skillsUsage.injections")}</th>
                  <th style={{ ...th, whiteSpace: "normal" }}>{t("skillsUsage.agents")}</th>
                  <th style={th}>{t("skillsUsage.avgChars")}</th>
                  <th style={th}>{t("skillsUsage.lastUsed")}</th>
                </tr>
              </thead>
              <tbody>
                {data.bySkill.map(s => (
                  <tr key={s.id}>
                    <td style={td}>✨ {s.id}</td>
                    <td style={td}><b>{s.count}</b></td>
                    <td style={{ ...td, whiteSpace: "normal", fontSize: 11 }}>
                      {s.agents.map(a => (
                        <span key={a.id} className="inline-block rounded px-1 mr-1 mb-0.5" style={{ background: theme.accentBg, color: theme.accent }}>
                          {a.id} <span style={{ opacity: 0.6 }}>×{a.count}</span>
                        </span>
                      ))}
                    </td>
                    <td style={td} title={`${t("skillsUsage.totalInjected")}: ${fmtChars(s.sectionCharsTotal)}`}>{fmtChars(s.avgSectionChars)}</td>
                    <td style={td} title={s.lastTs}>{fmtAgo(s.lastTs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs p-4 rounded" style={{ border: `1px dashed ${theme.borderLight}`, opacity: 0.7 }}>
            {loading ? "…" : t("skillsUsage.empty")}
            {!loading && <div className="mt-1" style={{ opacity: 0.7, fontSize: 11 }}>{t("skillsUsage.emptyHint")}</div>}
          </div>
        )}
      </div>

      {/* ── By agent ── */}
      {data && data.byAgent.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold mb-1">{t("skillsUsage.byAgent")}</div>
          <div style={{ border: `1px solid ${theme.borderLight}`, borderRadius: 8, overflow: "hidden" }}>
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: theme.bgMuted }}>
                  <th style={th}>{t("skillsUsage.agent")}</th>
                  <th style={th}>{t("skillsUsage.injections")}</th>
                  <th style={{ ...th, whiteSpace: "normal" }}>{t("skillsUsage.skillList")}</th>
                  <th style={th}>{t("skillsUsage.totalChars")}</th>
                  <th style={th}>{t("skillsUsage.lastUsed")}</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {data.byAgent.map(a => (
                  <tr key={a.id}>
                    <td style={td}>🤖 {a.id}</td>
                    <td style={td}><b>{a.count}</b></td>
                    <td style={{ ...td, whiteSpace: "normal", fontSize: 11 }}>
                      {a.skills.map(s => (
                        <span key={s.id} className="inline-block rounded px-1 mr-1 mb-0.5" style={{ background: theme.accentBg, color: theme.accent }}>
                          {s.id} <span style={{ opacity: 0.6 }}>×{s.count}</span>
                        </span>
                      ))}
                    </td>
                    <td style={td}>{fmtChars(a.chars)}</td>
                    <td style={td} title={a.lastTs}>{fmtAgo(a.lastTs)}</td>
                    <td style={td}>
                      <button onClick={() => openPromptView(a)} title={t("skillsUsage.viewPrompt")}
                        className="text-[11px] px-1.5 py-0.5 rounded hover:opacity-80"
                        style={{ border: `1px solid ${theme.borderLight}`, color: theme.accent }}>🔍</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Prompt 檢視 modal：點下去看實際注入的 skill 內容 ── */}
      {viewAgent && (
        <div onClick={closePromptView} className="fixed inset-0 flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.45)", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} className="flex flex-col rounded-lg shadow-2xl"
            style={{ background: theme.bg, border: `1px solid ${theme.borderLight}`, maxWidth: "min(900px, 92vw)", width: "100%", maxHeight: "86vh" }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
              <span className="text-sm font-bold">🔍 {viewAgent.id}</span>
              <span className="text-[11px]" style={{ opacity: 0.55 }}>{t("skillsUsage.injectedSection")}</span>
              <span className="flex-1" />
              <button onClick={closePromptView} className="text-xs px-2 py-0.5 rounded hover:opacity-80"
                style={{ border: `1px solid ${theme.borderLight}`, color: theme.text }}>{t("skillsUsage.close")}</button>
            </div>
            <div className="overflow-auto px-4 py-3" style={{ background: theme.bgMuted }}>
              {viewLoading && <div className="text-xs" style={{ opacity: 0.6 }}>…</div>}
              {viewError && <div className="text-xs" style={{ color: "#ef4444" }}>{viewError}</div>}
              {!viewLoading && !viewError && viewPrompt !== null && (() => {
                const idx = viewPrompt.indexOf("## 已掛載技能 (Skills)");
                const section = idx >= 0 ? viewPrompt.slice(idx) : "";
                return section ? (
                  <pre className="text-[11px] whitespace-pre-wrap" style={{ fontFamily: "ui-monospace, monospace", color: theme.text }}>{section}</pre>
                ) : (
                  <div className="text-xs" style={{ opacity: 0.7 }}>
                    {t("skillsUsage.noSection")}
                    <div className="mt-1" style={{ fontSize: 11, opacity: 0.7 }}>{t("skillsUsage.promptLen")}: {viewPrompt.length}</div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
