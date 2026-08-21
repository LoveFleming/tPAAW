/**
 * RuCostSection — Cost 歸集檢視（R3）
 *
 * 回答：「這個 feature / model / 這個月花了多少 AI 成本？」
 * 資料：GET /api/ru/cost?days=N（deterministic，零 LLM）
 * 顯示：總計、by model、by agent、by day（迷你趨勢）、by feature、by task。
 */
import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface CostGroup { key: string; calls: number; tokens: number; costUsd: number }
interface CostDay { day: string; calls: number; tokens: number; costUsd: number }
interface CostTask { taskId: string; title: string; model: string | null; featureIds: string[]; tokens: number; costUsd: number }
interface CostFeature { featureId: string; name: string; tasks: number; tokens: number; costUsd: number }
interface CostReport {
  generatedAt: string;
  rangeDays: number;
  logDays: number;
  totals: { calls: number; tokens: number; promptTokens: number; completionTokens: number; costUsd: number; estimatedShare: number };
  byDay: CostDay[];
  byModel: CostGroup[];
  byAgent: CostGroup[];
  byTask: CostTask[];
  byFeature: CostFeature[];
}

const fmtUsd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const fmtTok = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1e3).toFixed(1)}K` : String(n));

export default function RuCostSection({ rootPath, theme }: { rootPath: string; theme: any }) {
  const { t } = useI18n();
  const [r, setR] = useState<CostReport | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ru/cost?path=${encodeURIComponent(rootPath)}&days=${d}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.totals) setR(data);
    } catch { /* keep old */ } finally { setLoading(false); }
  }, [rootPath]);

  useEffect(() => { if (open && !r) load(days); }, [open, r, days, load]);

  const box: React.CSSProperties = {
    background: theme.bgMuted || "#fafaf9",
    border: `1px solid ${theme.borderLight || "#e7e5e4"}`,
    borderRadius: 10, padding: 12,
  };
  const th: React.CSSProperties = { textAlign: "left", fontWeight: 600, opacity: 0.55 };

  const maxDay = Math.max(1e-9, ...(r?.byDay.map(d => d.costUsd) || [0]));

  return (
    <section>
      <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-2 flex-wrap">
        💰 {t("ru.cost.title")}
        <button
          onClick={() => { setOpen(v => !v); }}
          className="text-[10px] px-2 py-0.5 rounded border text-stone-500 hover:bg-stone-50"
          style={{ borderColor: theme.borderLight }}
        >
          {open ? "▾" : "▸"} {r ? `${fmtUsd(r.totals.costUsd)} / ${r.rangeDays}d` : t("ru.cost.expand")}
        </button>
        {open && (
          <select
            value={days}
            onChange={e => { const d = Number(e.target.value); setDays(d); load(d); }}
            className="text-[10px] px-1 py-0.5 rounded border bg-transparent"
            style={{ borderColor: theme.borderLight, color: theme.text }}
          >
            {[7, 14, 30, 90, 365].map(d => <option key={d} value={d}>{d}d</option>)}
          </select>
        )}
        {open && (
          <button onClick={() => load(days)} className="text-[10px] px-2 py-0.5 rounded border text-stone-500 hover:bg-stone-50" style={{ borderColor: theme.borderLight }}>
            {t("ru.cost.refresh")}
          </button>
        )}
      </h3>

      {open && (
        <div style={box}>
          {!r && loading && <div className="text-xs text-stone-400">⏳ {t("ru.cost.loading")}…</div>}
          {r && (
            <>
              {/* 總計 */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 text-center">
                <div><div className="text-lg font-bold" style={{ color: theme.text }}>{fmtUsd(r.totals.costUsd)}</div><div className="text-[10px] opacity-60">{t("ru.cost.totalCost")}</div></div>
                <div><div className="text-lg font-bold" style={{ color: theme.text }}>{fmtTok(r.totals.tokens)}</div><div className="text-[10px] opacity-60">{t("ru.cost.totalTokens")}</div></div>
                <div><div className="text-lg font-bold" style={{ color: theme.text }}>{r.totals.calls}</div><div className="text-[10px] opacity-60">{t("ru.cost.totalCalls")}</div></div>
                <div><div className="text-lg font-bold" style={{ color: theme.text }}>{r.byModel.length}</div><div className="text-[10px] opacity-60">{t("ru.cost.models")}</div></div>
                <div><div className="text-lg font-bold" style={{ color: theme.text }}>{r.byFeature.length}</div><div className="text-[10px] opacity-60">{t("ru.cost.features")}</div></div>
              </div>

              {/* 日趨勢（迷你 bar）*/}
              {r.byDay.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] opacity-55 mb-1">{t("ru.cost.byDay")}</div>
                  <div className="flex items-end gap-[2px] h-10">
                    {r.byDay.map(d => (
                      <div key={d.day} title={`${d.day}: ${fmtUsd(d.costUsd)} (${d.calls} calls)`}
                        style={{
                          flex: 1, minWidth: 3,
                          height: `${Math.max(4, (d.costUsd / maxDay) * 100)}%`,
                          background: "#78716c", borderRadius: 2, opacity: 0.75,
                        }} />
                    ))}
                  </div>
                  <div className="flex justify-between text-[9px] opacity-40 mt-0.5">
                    <span>{r.byDay[0]?.day.slice(5)}</span>
                    <span>{r.byDay[r.byDay.length - 1]?.day.slice(5)}</span>
                  </div>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-3">
                {/* by model */}
                <div>
                  <div className="text-[10px] opacity-55 mb-1">{t("ru.cost.byModel")}</div>
                  <table className="w-full text-[11px]">
                    <thead><tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}><th style={th} className="py-1">Model</th><th style={{ ...th, textAlign: "right" }}>Calls</th><th style={{ ...th, textAlign: "right" }}>Tokens</th><th style={{ ...th, textAlign: "right" }}>USD</th></tr></thead>
                    <tbody>
                      {r.byModel.slice(0, 8).map(g => (
                        <tr key={g.key}>
                          <td className="py-0.5 font-mono truncate max-w-[140px]" title={g.key}>{g.key.split("/").pop()}</td>
                          <td className="text-right opacity-60">{g.calls}</td>
                          <td className="text-right opacity-60">{fmtTok(g.tokens)}</td>
                          <td className="text-right font-semibold">{fmtUsd(g.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* by agent */}
                <div>
                  <div className="text-[10px] opacity-55 mb-1">{t("ru.cost.byAgent")}</div>
                  <table className="w-full text-[11px]">
                    <thead><tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}><th style={th} className="py-1">Agent</th><th style={{ ...th, textAlign: "right" }}>Calls</th><th style={{ ...th, textAlign: "right" }}>Tokens</th><th style={{ ...th, textAlign: "right" }}>USD</th></tr></thead>
                    <tbody>
                      {r.byAgent.slice(0, 8).map(g => (
                        <tr key={g.key}>
                          <td className="py-0.5 truncate max-w-[140px]">{g.key}</td>
                          <td className="text-right opacity-60">{g.calls}</td>
                          <td className="text-right opacity-60">{fmtTok(g.tokens)}</td>
                          <td className="text-right font-semibold">{fmtUsd(g.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* by feature */}
                {r.byFeature.length > 0 && (
                  <div>
                    <div className="text-[10px] opacity-55 mb-1">{t("ru.cost.byFeature")}</div>
                    <table className="w-full text-[11px]">
                      <thead><tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}><th style={th} className="py-1">Feature</th><th style={{ ...th, textAlign: "right" }}>Tasks</th><th style={{ ...th, textAlign: "right" }}>Tokens</th><th style={{ ...th, textAlign: "right" }}>USD</th></tr></thead>
                      <tbody>
                        {r.byFeature.slice(0, 8).map(g => (
                          <tr key={g.featureId}>
                            <td className="py-0.5 truncate max-w-[140px]" title={`${g.featureId} ${g.name}`}><span className="font-mono opacity-60">{g.featureId}</span> {g.name}</td>
                            <td className="text-right opacity-60">{g.tasks}</td>
                            <td className="text-right opacity-60">{fmtTok(g.tokens)}</td>
                            <td className="text-right font-semibold">{fmtUsd(g.costUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* by task */}
                {r.byTask.length > 0 && (
                  <div>
                    <div className="text-[10px] opacity-55 mb-1">{t("ru.cost.byTask")}</div>
                    <table className="w-full text-[11px]">
                      <thead><tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}><th style={th} className="py-1">Task</th><th style={{ ...th, textAlign: "right" }}>Tokens</th><th style={{ ...th, textAlign: "right" }}>USD</th></tr></thead>
                      <tbody>
                        {r.byTask.slice(0, 8).map(g => (
                          <tr key={g.taskId}>
                            <td className="py-0.5 truncate max-w-[180px]" title={g.title}><span className="font-mono">{g.taskId}</span> {g.title}</td>
                            <td className="text-right opacity-60">{fmtTok(g.tokens)}</td>
                            <td className="text-right font-semibold">{fmtUsd(g.costUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="text-[10px] mt-1 opacity-40">
                {t("ru.cost.generatedAt")}: {r.generatedAt?.slice(0, 16).replace("T", " ")} · {r.logDays} {t("ru.cost.logDays")} · {t("ru.cost.deterministic")}
                {r.totals.estimatedShare > 0.05 && ` · ⚠️ ${(r.totals.estimatedShare * 100).toFixed(0)}% ${t("ru.cost.estimated")}`}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
