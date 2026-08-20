/**
 * AutoDispatchPanel — 自動派工
 *
 * Master table (plan summary) + Detail table (task → sub-task hierarchy)
 * Actions: delete plan, change status, resume, view sub-task detail in new tab
 */
import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import API_BASE from "../api";
import ModelSelector from "./ModelSelector";
import MarkdownText from "./MarkdownText";

interface PlanListItem {
  planId: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  summary: {
    total: number;
    completed: number;
    failed: number;
    timedOut: number;
    skipped: number;
    totalSubtasks: number;
    totalTokens: number;
    totalDurationMs: number;
  };
}

const STATUS_BADGE: Record<string, { icon: string; color: string; label: string }> = {
  completed:  { icon: "✅", color: "#22c55e", label: "完成" },
  done:       { icon: "✅", color: "#22c55e", label: "完成" },
  running:    { icon: "⏳", color: "#eab308", label: "執行中" },
  failed:     { icon: "❌", color: "#ef4444", label: "失敗" },
  fail:       { icon: "❌", color: "#ef4444", label: "失敗" },
  partial:    { icon: "⚠️", color: "#f59e0b", label: "部分完成" },
  interrupted:{ icon: "⚡", color: "#f59e0b", label: "中斷" },
  created:    { icon: "⏸",  color: "#9ca3af", label: "待執行" },
  pending:    { icon: "⬜", color: "#9ca3af", label: "待執行" },
  skipped:    { icon: "⏭️", color: "#9ca3af", label: "跳過" },
  timeout:    { icon: "⏰", color: "#f59e0b", label: "逾時" },
};

const SUB_ICON: Record<string, string> = {
  done: "✅", running: "⏳", fail: "❌", timeout: "⏰", interrupted: "⚡", pending: "⬜", skipped: "⏭️",
};

function badge(status: string) {
  const s = STATUS_BADGE[status] || { icon: "❓", color: "#9ca3af", label: status };
  return <span style={{ color: s.color, fontWeight: 600 }}>{s.icon} {s.label}</span>;
}

// ── Sub-task detail tab content ──
export function SubTaskDetail({ theme, data }: { theme: any; data: any }) {
  const tk = theme;
  if (!data) return <div className="p-4 text-sm" style={{ color: tk.text, opacity: 0.4 }}>No data</div>;

  const { subtaskId, title, assignee, status, model, startedAt, completedAt, durationMs, tokenUsage, result, error, taskTitle } = data;

  const rows: { label: string; value: string }[] = [
    { label: "Sub-task ID", value: subtaskId || "—" },
    { label: "Status", value: status || "—" },
    { label: "Agent", value: assignee || "—" },
    { label: "Model", value: model || "—" },
    { label: "Started", value: startedAt ? new Date(startedAt).toLocaleString("zh-TW") : "—" },
    { label: "Completed", value: completedAt ? new Date(completedAt).toLocaleString("zh-TW") : "—" },
    { label: "Duration", value: durationMs ? `${(durationMs / 1000 / 60).toFixed(1)} min` : "—" },
    { label: "Input tokens", value: tokenUsage?.prompt ? tokenUsage.prompt.toLocaleString() : "—" },
    { label: "Output tokens", value: tokenUsage?.completion ? tokenUsage.completion.toLocaleString() : "—" },
    { label: "Total tokens", value: tokenUsage?.total ? tokenUsage.total.toLocaleString() : "—" },
  ];

  return (
    <div className="p-4 overflow-y-auto h-full" style={{ background: tk.bg, color: tk.text }}>
      <div className="mb-3 pb-3" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
        <div className="text-sm font-bold mb-1">{badge(status)}</div>
        {taskTitle && <div className="text-xs mb-1" style={{ opacity: 0.5 }}>Parent: {taskTitle.slice(0, 80)}</div>}
        <div className="text-sm mt-1" style={{ fontWeight: 500 }}>{title?.slice(0, 120)}</div>
      </div>
      <table className="text-xs mb-4" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
              <td className="py-1.5 pr-4" style={{ opacity: 0.5, width: "120px" }}>{r.label}</td>
              <td className="py-1.5" style={{ fontWeight: 500 }}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && (
        <div className="mb-3 p-3 rounded text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "#dc2626" }}>
          <div className="font-bold mb-1">❌ Error</div>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{error}</pre>
        </div>
      )}
      {result && (
        <div>
          <div className="text-sm font-bold mb-2">📋 執行結果</div>
          <div className="p-3 rounded text-xs" style={{ background: tk.bgMuted }}>
            <MarkdownText>{result}</MarkdownText>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──
export default function AutoDispatchPanel({ theme, rootPath, model, openMainTab, refreshTrigger = 0 }: { theme: any; rootPath?: string; model?: string; openMainTab?: (tab: any) => void; refreshTrigger?: number }) {
  const { t } = useI18n();
  const tk = theme;

  const [starting, setStarting] = useState(false);
  const [nsConfig, setNsConfig] = useState<any>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [saveResult, setSaveResult] = useState<"" | "ok" | "err">("");

  const [execPlan, setExecPlan] = useState<any>(null);
  const [planList, setPlanList] = useState<PlanListItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [cronJob, setCronJob] = useState<any>(null);

  // ── Fetch helpers ──
  const fetchConfig = useCallback(async () => {
    if (!rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-auto-dispatch/config?path=${encodeURIComponent(rootPath)}`);
      setNsConfig(await res.json());
    } catch {}
  }, [rootPath]);

  const refreshPlans = useCallback(async () => {
    if (!rootPath) return;
    try {
      const [planRes, listRes] = await Promise.all([
        fetch(`${API_BASE}/api/auto-dispatch/plan/latest?path=${encodeURIComponent(rootPath)}`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/auto-dispatch/plan/list?path=${encodeURIComponent(rootPath)}`).then(r => r.ok ? r.json() : null),
      ]);
      setExecPlan(planRes?.plan || null);
      setPlanList(listRes?.plans || []);
    } catch {}
  }, [rootPath]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);
  useEffect(() => { refreshPlans(); }, [refreshPlans]);
  useEffect(() => { if (refreshTrigger > 0) refreshPlans(); }, [refreshTrigger]);

  useEffect(() => {
    if (!rootPath) return;
    fetch(`${API_BASE}/api/cron-jobs`)
      .then(r => r.json())
      .then((jobs: any[]) => {
        const found = jobs.find(j => j.id?.startsWith('auto-dispatch-') && j.params?.projectPath === rootPath);
        setCronJob(found || null);
      })
      .catch(() => setCronJob(null));
  }, [rootPath]);

  useEffect(() => {
    if (execPlan?.status !== "running") return;
    const interval = setInterval(refreshPlans, 5000);
    return () => clearInterval(interval);
  }, [execPlan?.status, refreshPlans]);

  // ── Actions ──
  const handleStart = async () => {
    setStarting(true);
    try {
      await fetch(`${API_BASE}/api/coding-auto-dispatch/start${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "em", model: model || undefined }),
      });
      await refreshPlans();
    } catch (err: any) { alert("啟動失敗: " + err.message); }
    setStarting(false);
  };

  const handleResume = async (planId: string) => {
    try {
      // Optimistic: immediately mark as running so UI hides resume button
      setExecPlan((prev: any) => prev ? { ...prev, status: 'running' } : prev);
      // Trigger actual EM execution with existing plan
      await fetch(`${API_BASE}/api/coding-auto-dispatch/start${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "em", planId }),
      });
      // Poll after short delay to catch server update
      setTimeout(() => refreshPlans(), 1000);
      setTimeout(() => refreshPlans(), 3000);
    } catch {
      // Revert on error
      await refreshPlans();
    }
  };

  const handleDelete = async (planId: string) => {
    if (!confirm(`刪除 plan ${planId}？`)) return;
    try {
      await fetch(`${API_BASE}/api/auto-dispatch/plan/${planId}?path=${encodeURIComponent(rootPath || "")}`, { method: "DELETE" });
      setSelectedPlanId(null);
      await refreshPlans();
    } catch {}
  };

  const handleStatusChange = async (planId: string, newStatus: string) => {
    try {
      await fetch(`${API_BASE}/api/auto-dispatch/plan/${planId}/status?path=${encodeURIComponent(rootPath || "")}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      await refreshPlans();
    } catch {}
  };

  const loadPlan = async (planId: string) => {
    if (!rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/auto-dispatch/plan/${planId}?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setExecPlan(d?.plan || null);
      setSelectedPlanId(planId);
    } catch {}
  };

  const openSubTaskDetail = (st: any, taskTitle: string) => {
    if (!openMainTab) return;
    openMainTab({
      id: `subtask:${st.subtaskId}`,
      type: "subtask-detail",
      label: `${st.subtaskId}`,
      icon: "🔍",
      closable: true,
      data: { ...st, taskTitle },
    });
  };

  // ── Format helpers ──
  const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtDur = (ms: number) => ms ? (ms < 60000 ? `${(ms/1000).toFixed(0)}s` : `${(ms/60000).toFixed(1)}min`) : "—";
  const fmtTok = (n: number) => n > 0 ? n.toLocaleString() : "—";

  const isRunning = execPlan?.status === "running";
  const hasPending = execPlan?.tasks?.some((task: any) =>
    task.subtasks?.some((st: any) => st.status === "interrupted" || st.status === "pending")
  );

  // Unique agents
  const agents = new Set<string>();
  execPlan?.tasks?.forEach((task: any) => task.subtasks?.forEach((st: any) => agents.add(st.assignee)));

  return (
    <div className="flex h-full" style={{ background: tk.bg }}>
      {/* ═══ Left: Plan List ═══ */}
      <div className="w-56 flex flex-col border-r shrink-0" style={{ borderColor: tk.borderLight }}>
        <div className="px-3 py-2" style={{ borderBottom: `1px solid ${tk.borderLight}`, background: tk.bgMuted }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold" style={{ color: tk.text }}>🏭 {t("autoDispatch.title")}</span>
          </div>
          <button onClick={handleStart} disabled={starting || isRunning}
            className="w-full py-1 rounded text-xs font-medium mb-1"
            style={{ background: isRunning ? tk.bgMuted : tk.accentBg, color: isRunning ? tk.text : tk.accent, opacity: isRunning ? 0.5 : 1 }}>
            {starting ? "⏳ 啟動中..." : isRunning ? "⏳ 執行中..." : `🚀 ${t("autoDispatch.start")}`}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {planList.length === 0 && <div className="p-3 text-center text-xs" style={{ color: tk.text, opacity: 0.4 }}>尚無執行記錄</div>}
          {planList.map((p, i) => (
            <div key={p.planId} onClick={() => loadPlan(p.planId)}
              className="px-3 py-2 cursor-pointer border-b transition-colors"
              style={{ borderColor: tk.borderLight, background: (selectedPlanId === p.planId || (i === 0 && !selectedPlanId)) ? tk.accentBg : "transparent" }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono" style={{ color: tk.text, fontWeight: 600 }}>{fmtDate(p.createdAt)}</span>
                <span className="text-[10px]">{badge(p.status)}</span>
              </div>
              {p.summary && (
                <div className="text-[10px] mt-0.5" style={{ color: tk.text, opacity: 0.5 }}>
                  {p.summary.completed}/{p.summary.totalSubtasks} subtasks
                </div>
              )}
            </div>
          ))}
        </div>

        {cronJob && (
          <div className="px-3 py-1.5 text-[10px]" style={{ borderTop: `1px solid ${tk.borderLight}`, color: tk.text }}>
            <span style={{ opacity: 0.5 }}>⏰ </span>
            <span style={{ color: cronJob.enabled ? "#22c55e" : "#9ca3af" }}>{cronJob.enabled ? cronJob.schedule : "停用"}</span>
          </div>
        )}

        <div className="px-3 py-1.5" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
          <button onClick={() => setShowConfig(!showConfig)} className="text-[11px]" style={{ color: tk.text, opacity: 0.5 }}>
            {showConfig ? "▼" : "▶"} ⚙️ 設定
          </button>
        </div>
        {showConfig && nsConfig && (
          <div className="flex-1 flex flex-col px-3 py-2 overflow-visible" style={{ borderTop: `1px solid ${tk.borderLight}`, background: tk.bgMuted }}>
            <div className="space-y-2">
              <div>
                <div className="text-[11px] font-bold mb-1" style={{ color: tk.text }}>🏗️ Phase</div>
                <select value={nsConfig.projectPhase || "bootstrap"}
                  onChange={e => setNsConfig({ ...nsConfig, projectPhase: e.target.value })}
                  className="text-[11px] px-2 py-1 rounded border w-full"
                  style={{ borderColor: tk.borderLight, background: tk.bg, color: tk.text }}>
                  <option value="bootstrap">🚀 Bootstrap</option>
                  <option value="mvp">📦 MVP</option>
                  <option value="growth">📈 Growth</option>
                  <option value="stable">✅ Stable</option>
                  <option value="refactor">🔧 Refactor</option>
                </select>
                {/* Show derived loop mode */}
                {(() => {
                  const phase = nsConfig.projectPhase || "bootstrap";
                  const isMini = ["bootstrap", "mvp", "growth"].includes(phase);
                  return (
                    <div className="mt-1 flex items-center gap-1">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-bold",
                        isMini ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                      )}>
                        {isMini ? "Mini Loop" : "Full Loop"}
                      </span>
                      <span className="text-[9px]" style={{ color: tk.textMuted }}>
                        {isMini ? "implement → 你驗 → commit" : "spec → implement → test → qa → docs → commit"}
                      </span>
                    </div>
                  );
                })()}
              </div>
              <div>
                <div className="text-[11px] font-bold mb-1" style={{ color: tk.text }}>⏰ Schedule</div>
                <label className="flex items-center gap-1 text-[11px]" style={{ color: tk.text }}>
                  <input type="checkbox" checked={nsConfig.schedule?.enabled || false}
                    onChange={e => setNsConfig({ ...nsConfig, schedule: { ...nsConfig.schedule, enabled: e.target.checked } })} />每日</label>
                {nsConfig.schedule?.enabled && (
                  <input type="time" value={nsConfig.schedule?.time || "22:00"}
                    onChange={e => setNsConfig({ ...nsConfig, schedule: { ...nsConfig.schedule, time: e.target.value } })}
                    className="text-[11px] px-2 py-1 rounded border mt-1"
                    style={{ borderColor: tk.borderLight, background: tk.bg, color: tk.text }} />
                )}
              </div>
              <div>
                <div className="text-[11px] font-bold mb-1" style={{ color: tk.text }}>🤖 Model</div>
                <ModelSelector feature="autoDispatch" value={nsConfig.model?.primary || ""}
                  onChange={(v: string) => setNsConfig({ ...nsConfig, model: { ...nsConfig.model, primary: v } })} />
              </div>
            </div>
            <div className="mt-auto pt-2">
              <button onClick={async () => {
                  setSavingConfig(true); setSaveResult("");
                  try {
                    const r = await fetch(`${API_BASE}/api/coding-auto-dispatch/config?path=${encodeURIComponent(rootPath || "")}`, {
                      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nsConfig) });
                    setSaveResult(r.ok ? "ok" : "err"); if (r.ok) setTimeout(() => setSaveResult(""), 3000);
                  } catch { setSaveResult("err"); }
                  setSavingConfig(false);
                }} disabled={savingConfig}
                className="w-full py-1 rounded text-[11px] font-medium"
                style={{ background: tk.accentBg, color: tk.accent }}>
                {savingConfig ? "..." : "💾 儲存"}
              </button>
              {saveResult === "ok" && <div className="text-center text-[10px] mt-1" style={{ color: "#22c55e" }}>✅</div>}
              {saveResult === "err" && <div className="text-center text-[10px] mt-1" style={{ color: "#ef4444" }}>❌</div>}
            </div>
          </div>
        )}
      </div>
      {/* ═══ Right: Master + Detail ═══ */}
      <div className="flex-1 overflow-y-auto">
        {!execPlan ? (
          <div className="flex-1 flex flex-col items-center justify-center h-full gap-2" style={{ color: tk.text, opacity: 0.4 }}>
            <div className="text-4xl">🏭</div>
            <div className="text-sm">{t("autoDispatch.noPlan")}</div>
            <div className="text-xs">{t("autoDispatch.noPlanHint")}</div>
          </div>
        ) : (
          <div className="p-4">
            {/* ── Master Summary ── */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-4">
                <div className="text-sm font-bold font-mono" style={{ color: tk.text }}>{execPlan.planId}</div>
                {badge(execPlan.status)}
                <span className="text-xs" style={{ color: tk.text, opacity: 0.5 }}>
                  {fmtDate(execPlan.createdAt)} → {fmtDate(execPlan.completedAt)}
                </span>
                <span className="text-xs" style={{ color: tk.text, opacity: 0.5 }}>·</span>
                <span className="text-xs" style={{ color: tk.text, opacity: 0.7 }}>⏱ {fmtDur(execPlan.summary?.totalDurationMs || 0)}</span>
                <span className="text-xs" style={{ color: tk.text, opacity: 0.7 }}>📝 {fmtTok(execPlan.summary?.totalTokens || 0)}</span>
                <span className="text-xs" style={{ color: tk.text, opacity: 0.7 }}>👥 {[...agents].join(", ")}</span>
              </div>
              {/* Action buttons */}
              <div className="flex items-center gap-1">
                {/* Resume */}
                {hasPending && execPlan.status !== "running" && (
                  <button onClick={() => handleResume(execPlan.planId)}
                    className="text-[11px] px-2 py-1 rounded font-medium"
                    style={{ background: "#f59e0b", color: "#fff" }} title="恢復執行">▶️ Resume</button>
                )}
                {/* Status dropdown */}
                <select
                  value={execPlan.status}
                  onChange={e => handleStatusChange(execPlan.planId, e.target.value)}
                  className="text-[10px] px-1 py-1 rounded border"
                  style={{ borderColor: tk.borderLight, background: tk.bg, color: tk.text }}
                  title="手動更改狀態"
                >
                  <option value="created">⏸ 待執行</option>
                  <option value="running">⏳ 執行中</option>
                  <option value="completed">✅ 完成</option>
                  <option value="failed">❌ 失敗</option>
                  <option value="partial">⚠️ 部分</option>
                  <option value="interrupted">⚡ 中斷</option>
                </select>
                {/* Delete */}
                <button onClick={() => handleDelete(execPlan.planId)}
                  className="text-[11px] px-1.5 py-1 rounded"
                  style={{ background: "rgba(239,68,68,0.1)", color: "#dc2626" }} title="刪除 Plan">🗑</button>
              </div>
            </div>

            {/* ── Detail Table: Task → Sub-task hierarchy ── */}
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: tk.bgMuted }}>
                  <th className="text-left py-1.5 px-2" style={{ color: tk.text, borderBottom: `1px solid ${tk.borderLight}`, width: "90px" }}>ID</th>
                  <th className="text-left py-1.5 px-2" style={{ color: tk.text, borderBottom: `1px solid ${tk.borderLight}`, width: "60px" }}>Agent</th>
                  <th className="text-left py-1.5 px-2" style={{ color: tk.text, borderBottom: `1px solid ${tk.borderLight}` }}>Description</th>
                  <th className="text-right py-1.5 px-2" style={{ color: tk.text, borderBottom: `1px solid ${tk.borderLight}`, width: "70px" }}>In tok</th>
                  <th className="text-right py-1.5 px-2" style={{ color: tk.text, borderBottom: `1px solid ${tk.borderLight}`, width: "70px" }}>Out tok</th>
                  <th className="text-right py-1.5 px-2" style={{ color: tk.text, borderBottom: `1px solid ${tk.borderLight}`, width: "50px" }}>Time</th>
                  <th className="text-center py-1.5 px-2" style={{ color: tk.text, borderBottom: `1px solid ${tk.borderLight}`, width: "35px" }}>St</th>
                  <th className="text-center py-1.5 px-2" style={{ color: tk.text, borderBottom: `1px solid ${tk.borderLight}`, width: "35px" }}></th>
                </tr>
              </thead>
              <tbody>
                {execPlan.tasks?.map((task: any) => (
                  <React.Fragment key={task.taskId}>
                    {/* Task row */}
                    <tr style={{ background: tk.bgMuted }}>
                      <td className="py-1.5 px-2" style={{ color: tk.text }}>
                        <span className="font-mono font-bold text-[11px]">{task.taskId}</span>
                      </td>
                      <td className="py-1.5 px-2" colSpan={6}>
                        <span className="text-[11px] font-bold" style={{ color: tk.text }}>
                          {task.title?.length > 100 ? task.title.slice(0, 100) + "..." : task.title}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-center text-[10px]" style={{ opacity: 0.4 }}>
                        {task.subtasks?.filter((s: any) => s.status === "done").length || 0}/{task.subtasks?.length || 0}
                      </td>
                    </tr>
                    {/* Sub-task rows */}
                    {task.subtasks?.map((st: any) => (
                      <tr key={st.subtaskId} style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
                        <td className="py-1 px-2" style={{ color: tk.text, fontFamily: "monospace", fontSize: 10, paddingLeft: "20px" }}>
                          └ {st.subtaskId}
                        </td>
                        <td className="py-1 px-2" style={{ color: tk.text, fontWeight: 500 }}>{st.assignee}</td>
                        <td className="py-1 px-2" style={{ color: tk.text, opacity: 0.7, maxWidth: "350px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {st.title}
                        </td>
                        <td className="py-1 px-2 text-right" style={{ color: tk.text, opacity: 0.6 }}>{fmtTok(st.tokenUsage?.prompt || 0)}</td>
                        <td className="py-1 px-2 text-right" style={{ color: tk.text, opacity: 0.6 }}>{fmtTok(st.tokenUsage?.completion || 0)}</td>
                        <td className="py-1 px-2 text-right" style={{ color: tk.text, opacity: 0.6 }}>{fmtDur(st.durationMs || 0)}</td>
                        <td className="py-1 px-2 text-center">{SUB_ICON[st.status] || "❓"}</td>
                        <td className="py-1 px-2 text-center">
                          <button onClick={() => openSubTaskDetail(st, task.title)}
                            className="text-[10px] px-1 py-0.5 rounded"
                            style={{ background: tk.accentBg, color: tk.accent, opacity: st.result || st.error ? 1 : 0.3 }}
                            disabled={!st.result && !st.error}
                            title="查看執行細節">🔍</button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
