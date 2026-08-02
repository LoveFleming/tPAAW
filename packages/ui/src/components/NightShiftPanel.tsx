/**
 * AutoDispatchPanel — 自動派工（原 Night Shift）
 *
 * 以 Execution Plan 為主體：
 * - Plan 進度（sub-task 狀態、token、成本、時間）
 * - Plan 歷史列表
 * - 排程設定
 * - 觸發點：手動啟動 / cron job
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ModelSelector from "./ModelSelector";

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
    totalCostUsd: number;
    totalDurationMs: number;
  };
}

interface CronJobInfo {
  id: string;
  enabled: boolean;
  schedule: string;
  lastRun?: string;
  lastStatus?: string;
}

export default function NightShiftPanel({ theme, rootPath, model }: { theme: any; rootPath?: string; model?: string }) {
  const { t } = useI18n();
  const tk = theme;

  // ── State ──
  const [starting, setStarting] = useState(false);
  const [nsConfig, setNsConfig] = useState<any>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [saveResult, setSaveResult] = useState<"" | "ok" | "err">("");

  // Execution Plan
  const [execPlan, setExecPlan] = useState<any>(null);
  const [planList, setPlanList] = useState<PlanListItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [cronJob, setCronJob] = useState<CronJobInfo | null>(null);

  // ── Fetch config ──
  const fetchConfig = useCallback(async () => {
    if (!rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-night-shift/config?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setNsConfig(d);
    } catch {}
  }, [rootPath]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  // ── Fetch plan list + latest plan + cron ──
  const refreshPlans = useCallback(async () => {
    if (!rootPath) return;
    try {
      const [planRes, listRes] = await Promise.all([
        fetch(`${API_BASE}/api/night-shift/plan/latest?path=${encodeURIComponent(rootPath)}`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/night-shift/plan/list?path=${encodeURIComponent(rootPath)}`).then(r => r.ok ? r.json() : null),
      ]);
      setExecPlan(planRes?.plan || null);
      setPlanList(listRes?.plans || []);
    } catch {}
  }, [rootPath]);

  useEffect(() => { refreshPlans(); }, [refreshPlans]);

  // Fetch cron job status
  useEffect(() => {
    if (!rootPath) return;
    fetch(`${API_BASE}/api/cron-jobs`)
      .then(r => r.json())
      .then((jobs: any[]) => {
        const found = jobs.find(j => j.id?.startsWith('night-shift-') && j.params?.projectPath === rootPath);
        setCronJob(found || null);
      })
      .catch(() => setCronJob(null));
  }, [rootPath]);

  // Poll while plan is running
  useEffect(() => {
    if (execPlan?.status !== "running") return;
    const interval = setInterval(refreshPlans, 5000);
    return () => clearInterval(interval);
  }, [execPlan?.status, refreshPlans]);

  // ── Actions ──
  const handleStart = async () => {
    setStarting(true);
    try {
      await fetch(`${API_BASE}/api/coding-night-shift/start${rootPath ? `?path=${encodeURIComponent(rootPath)}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "em", model: model || undefined }),
      });
      await refreshPlans();
    } catch (err: any) {
      alert("啟動失敗: " + err.message);
    }
    setStarting(false);
  };

  const handleResume = async (planId: string) => {
    try {
      await fetch(`${API_BASE}/api/night-shift/plan/${planId}/resume?path=${encodeURIComponent(rootPath || "")}`, { method: "POST" });
      await refreshPlans();
    } catch {}
  };

  const loadPlan = async (planId: string) => {
    if (!rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/night-shift/plan/${planId}?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setExecPlan(d?.plan || null);
      setSelectedPlanId(planId);
    } catch {}
  };

  // ── Helpers ──
  const fmtDate = (iso?: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const fmtDuration = (ms: number) => {
    if (!ms) return "—";
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  };
  const fmtCost = (usd: number) => usd > 0 ? `$${usd.toFixed(3)}` : "—";
  const fmtTokens = (n: number) => n > 0 ? `${(n / 1000).toFixed(1)}K` : "—";

  const statusBadge = (status: string) => {
    const map: Record<string, { icon: string; color: string; label: string }> = {
      completed: { icon: "✅", color: "#22c55e", label: "完成" },
      running: { icon: "⏳", color: "#eab308", label: "執行中" },
      failed: { icon: "❌", color: "#ef4444", label: "失敗" },
      partial: { icon: "⚠️", color: "#f59e0b", label: "部分完成" },
      interrupted: { icon: "⚡", color: "#f59e0b", label: "中斷" },
      created: { icon: "⏸", color: "#9ca3af", label: "待執行" },
    };
    const s = map[status] || { icon: "❓", color: "#9ca3af", label: status };
    return <span style={{ color: s.color, fontWeight: 600 }}>{s.icon} {s.label}</span>;
  };

  const subTaskIcon = (status: string) => {
    const map: Record<string, string> = {
      done: "✅", running: "⏳", fail: "❌", timeout: "⏰", interrupted: "⚡", pending: "⬜", skipped: "⏭️",
    };
    return map[status] || "❓";
  };

  const isRunning = execPlan?.status === "running";
  const hasInterrupted = execPlan?.tasks?.some((task: any) =>
    task.subtasks?.some((st: any) => st.status === "interrupted" || st.status === "pending")
  ) && execPlan?.status !== "running";

  return (
    <div className="flex h-full" style={{ background: tk.bg }}>
      {/* ═══ Left: Plan List + Actions ═══ */}
      <div className="w-64 flex flex-col border-r shrink-0" style={{ borderColor: tk.borderLight }}>
        {/* ── Header ── */}
        <div className="px-3 py-2" style={{ borderBottom: `1px solid ${tk.borderLight}`, background: tk.bgMuted }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold" style={{ color: tk.text }}>🏭 {t("autoDispatch.title")}</span>
            <button
              onClick={handleStart}
              disabled={starting || isRunning}
              className="text-xs px-2.5 py-1 rounded font-medium"
              style={{
                background: isRunning ? tk.bgMuted : tk.accentBg,
                color: isRunning ? tk.text : tk.accent,
                opacity: isRunning ? 0.5 : 1,
              }}
            >
              {starting ? "⏳ 啟動中..." : isRunning ? "⏳ 執行中" : `🚀 ${t("autoDispatch.start")}`}
            </button>
          </div>
          {hasInterrupted && (
            <button
              onClick={() => handleResume(execPlan.planId)}
              className="w-full py-1 rounded text-xs font-medium"
              style={{ background: "#f59e0b", color: "#fff" }}
            >
              ▶️ 恢復中斷的 Plan
            </button>
          )}
        </div>

        {/* ── Plan History List ── */}
        <div className="flex-1 overflow-y-auto">
          {planList.length === 0 && (
            <div className="p-3 text-center text-xs" style={{ color: tk.text, opacity: 0.4 }}>
              尚無執行記錄
            </div>
          )}
          {planList.map((p, i) => (
            <div
              key={p.planId}
              onClick={() => loadPlan(p.planId)}
              className="px-3 py-2 cursor-pointer border-b transition-colors"
              style={{
                borderColor: tk.borderLight,
                background: (selectedPlanId === p.planId || (i === 0 && !selectedPlanId)) ? tk.accentBg : "transparent",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono" style={{ color: tk.text, fontWeight: 600 }}>
                  {fmtDate(p.createdAt)}
                </span>
                <span className="text-xs">{statusBadge(p.status)}</span>
              </div>
              {p.summary && (
                <div className="text-[10px] mt-0.5 flex items-center gap-2" style={{ color: tk.text, opacity: 0.5 }}>
                  <span>{p.summary.completed}/{p.summary.totalSubtasks} subtasks</span>
                  {p.summary.totalCostUsd > 0 && <span>{fmtCost(p.summary.totalCostUsd)}</span>}
                  {p.summary.totalDurationMs > 0 && <span>{fmtDuration(p.summary.totalDurationMs)}</span>}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Cron Status ── */}
        {cronJob && (
          <div className="px-3 py-2 text-xs space-y-1" style={{ borderTop: `1px solid ${tk.borderLight}`, color: tk.text }}>
            <div className="flex items-center justify-between">
              <span style={{ opacity: 0.6 }}>⏰ 排程</span>
              <span style={{ color: cronJob.enabled ? "#22c55e" : "#9ca3af", fontWeight: 600 }}>
                {cronJob.enabled ? `● ${cronJob.schedule}` : "○ 停用"}
              </span>
            </div>
            {cronJob.lastRun && (
              <div className="flex items-center justify-between">
                <span style={{ opacity: 0.6 }}>📅 上次</span>
                <span>{fmtDate(cronJob.lastRun)}</span>
              </div>
            )}
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

        {/* ── Config Panel ── */}
        {showConfig && nsConfig && (
          <div className="flex-1 flex flex-col px-3 py-2 max-h-[50vh] overflow-y-auto" style={{ borderTop: `1px solid ${tk.borderLight}`, background: tk.bgMuted }}>
            <div className="space-y-3">
              {/* Project Phase */}
              <div>
                <div className="text-xs font-bold mb-1" style={{ color: tk.text }}>🏗️ {t("autoDispatch.projectPhase")}</div>
                <select
                  value={nsConfig.projectPhase || "bootstrap"}
                  onChange={e => setNsConfig({ ...nsConfig, projectPhase: e.target.value })}
                  className="text-xs px-2 py-1 rounded border w-full"
                  style={{ borderColor: tk.borderLight, background: tk.bg, color: tk.text }}
                >
                  <option value="bootstrap">🚀 Bootstrap</option>
                  <option value="mvp">📦 MVP</option>
                  <option value="growth">📈 Growth</option>
                  <option value="stable">✅ Stable</option>
                  <option value="refactor">🔧 Refactor</option>
                </select>
              </div>

              {/* Schedule */}
              <div>
                <div className="text-xs font-bold mb-1" style={{ color: tk.text }}>⏰ {t("autoDispatch.schedule")}</div>
                <label className="flex items-center gap-2 text-xs" style={{ color: tk.text }}>
                  <input
                    type="checkbox"
                    checked={nsConfig.schedule?.enabled || false}
                    onChange={e => setNsConfig({ ...nsConfig, schedule: { ...nsConfig.schedule, enabled: e.target.checked } })}
                  />
                  {t("autoDispatch.dailyEnabled")}
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
                <div className="text-xs font-bold mt-2 mb-1" style={{ color: tk.text, opacity: 0.6 }}>Fallback</div>
                <ModelSelector
                  feature="nightShiftFallback"
                  value={nsConfig.model?.fallbacks?.[0] || ""}
                  onChange={(v: string) => setNsConfig({ ...nsConfig, model: { ...nsConfig.model, fallbacks: v ? [v] : [] } })}
                />
              </div>
            </div>

            {/* Save */}
            <div className="mt-auto pt-2" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
              <button
                onClick={async () => {
                  setSavingConfig(true);
                  setSaveResult("");
                  try {
                    const resp = await fetch(`${API_BASE}/api/coding-night-shift/config?path=${encodeURIComponent(rootPath || "")}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(nsConfig),
                    });
                    if (resp.ok) { setSaveResult("ok"); setTimeout(() => setSaveResult(""), 3000); }
                    else { setSaveResult("err"); }
                  } catch { setSaveResult("err"); }
                  setSavingConfig(false);
                }}
                disabled={savingConfig}
                className="w-full py-1.5 rounded text-xs font-medium"
                style={{ background: tk.accentBg, color: tk.accent }}
              >
                {savingConfig ? "儲存中..." : "💾 儲存設定"}
              </button>
              {saveResult === "ok" && <div className="text-center text-xs mt-1" style={{ color: "#22c55e" }}>✅ 已儲存</div>}
              {saveResult === "err" && <div className="text-center text-xs mt-1" style={{ color: "#ef4444" }}>❌ 失敗</div>}
            </div>
          </div>
        )}
      </div>

      {/* ═══ Right: Plan Detail ═══ */}
      <div className="flex-1 overflow-y-auto">
        {!execPlan ? (
          <div className="flex-1 flex flex-col items-center justify-center h-full gap-2" style={{ color: tk.text, opacity: 0.4 }}>
            <div className="text-4xl">🏭</div>
            <div className="text-sm">{t("autoDispatch.noPlan")}</div>
            <div className="text-xs">{t("autoDispatch.noPlanHint")}</div>
          </div>
        ) : (
          <div className="p-4">
            {/* ── Plan Header ── */}
            <div className="flex items-center justify-between mb-3 pb-3" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
              <div>
                <div className="text-sm font-bold" style={{ color: tk.text }}>
                  📋 {execPlan.planId}
                </div>
                <div className="text-xs mt-0.5" style={{ color: tk.text, opacity: 0.5 }}>
                  {fmtDate(execPlan.createdAt)} → {fmtDate(execPlan.completedAt)}
                </div>
              </div>
              <div className="text-lg">{statusBadge(execPlan.status)}</div>
            </div>

            {/* ── Summary Bar ── */}
            {execPlan.summary && (
              <div className="flex items-center gap-4 mb-3 px-3 py-2 rounded text-xs" style={{ background: tk.bgMuted, color: tk.text }}>
                <span>📊 {execPlan.summary.completed}/{execPlan.summary.totalSubtasks} done</span>
                {execPlan.summary.failed > 0 && <span style={{ color: "#ef4444" }}>❌ {execPlan.summary.failed}</span>}
                {execPlan.summary.timedOut > 0 && <span style={{ color: "#f97316" }}>⏰ {execPlan.summary.timedOut}</span>}
                <span style={{ opacity: 0.5 }}>·</span>
                <span>📝 {fmtTokens(execPlan.summary.totalTokens)}</span>
                <span>💰 {fmtCost(execPlan.summary.totalCostUsd)}</span>
                <span>⏱ {fmtDuration(execPlan.summary.totalDurationMs)}</span>
              </div>
            )}

            {/* ── Tasks & Sub-tasks ── */}
            <div className="space-y-3">
              {execPlan.tasks?.map((task: any) => (
                <div key={task.taskId}>
                  {/* Task header */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold" style={{ color: tk.text }}>{task.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: tk.bgMuted, color: tk.text, opacity: 0.6 }}>
                      {task.subtasks?.filter((s: any) => s.status === "done").length || 0}/{task.subtasks?.length || 0}
                    </span>
                  </div>

                  {/* Sub-tasks */}
                  <div className="ml-4 space-y-1">
                    {task.subtasks?.map((st: any) => (
                      <div key={st.subtaskId} className="flex items-start gap-2 py-1 px-2 rounded text-xs" style={{ background: tk.bgMuted }}>
                        <span className="mt-0.5">{subTaskIcon(st.status)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span style={{ fontWeight: 600, color: tk.text }}>{st.assignee}</span>
                            <span style={{ color: tk.text, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {st.title}
                            </span>
                          </div>
                          {(st.durationMs > 0 || st.tokenUsage?.total > 0 || st.costUsd > 0) && (
                            <div className="flex items-center gap-3 mt-0.5 text-[10px]" style={{ opacity: 0.5 }}>
                              {st.durationMs > 0 && <span>⏱ {fmtDuration(st.durationMs)}</span>}
                              {st.tokenUsage?.total > 0 && <span>📝 {fmtTokens(st.tokenUsage.total)}</span>}
                              {st.costUsd > 0 && <span>💰 {fmtCost(st.costUsd)}</span>}
                              {st.model && <span>🤖 {st.model}</span>}
                            </div>
                          )}
                          {st.error && (
                            <div className="text-[10px] mt-0.5" style={{ color: "#ef4444" }}>{st.error}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ── EM Report ── */}
            {execPlan.emReport && (
              <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
                <div className="text-sm font-bold mb-2" style={{ color: tk.text }}>🎖️ EM 報告</div>
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{execPlan.emReport}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
