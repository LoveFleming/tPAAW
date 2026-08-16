/**
 * ReleaseManagerPanel — 🚦 Release Manager 頁
 *
 * 「要 release 時打開這頁，讓 Release Manager 同意上線」
 *
 * 左：待放行清單（full mode 七關走完、等 commit 批准的 task）
 *     + Release 歷史時間線
 * 右：RM AI 助理（審證據不審碼）
 *
 * 空狀態設計：
 *   - 專案未初始化（無 .paaw/TASKS.json）→ 引導先跑 CU / mini loop 開發
 *   - 已初始化但無待放行 → 說明什麼會出現在這裡
 */

import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import EvidenceCard from "./EvidenceCard";
import AgentSideChat from "./AgentSideChat";

const PHASES = ["spec", "implement", "review", "test", "qa", "docs", "commit"];

interface PendingTask {
  taskId: string;
  title: string;
  status: string;
  priority?: string;
  updatedAt?: string;
  pipeline: Record<string, { status: string }>;
  evidenceSummary: {
    trustScore: number | null;
    risk: { category: string; level: string } | null;
    diffStat: { files: number; insertions: number | null; deletions: number | null } | null;
    testResult: { passed?: number; failed?: number; status?: string } | null;
  } | null;
}

interface ReleaseRecord {
  id: string;
  releasedAt: string;
  taskId: string;
  title: string;
  trustScore: number | null;
  riskLevel: string | null;
  note: string | null;
}

interface Props {
  rootPath: string;
  theme: any;
  onOpenEMDashboard?: () => void;
}

interface QualityDebt {
  ok: boolean;
  code?: string;
  featuresUpdatedAt?: string | null;
  totalFeatures?: number;
  activeFeatures?: number;
  noTests?: number;
  noDocs?: number;
  openRetrofitTasks?: number;
}

export default function ReleaseManagerPanel({ rootPath, theme: tk, onOpenEMDashboard }: Props) {
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingTask[]>([]);
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [initialized, setInitialized] = useState<boolean | null>(null); // null = loading
  const [loopMode, setLoopMode] = useState<string>("mini");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [qd, setQd] = useState<QualityDebt | null>(null);
  const [retrofitting, setRetrofitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    try {
      const [pRes, lRes, qdRes] = await Promise.all([
        fetch(`${API_BASE}/api/coding-releases/pending?path=${encodeURIComponent(rootPath)}`),
        fetch(`${API_BASE}/api/coding-releases/list?path=${encodeURIComponent(rootPath)}`),
        fetch(`${API_BASE}/api/coding-releases/quality-debt?path=${encodeURIComponent(rootPath)}`),
      ]);
      const pData = await pRes.json();
      const lData = await lRes.json();
      const qdData = await qdRes.json().catch(() => null);
      setInitialized(!!pData.initialized);
      setLoopMode(pData.loopMode || "mini");
      setPending(pData.pending || []);
      setReleases(lData.releases || []);
      setQd(qdData);
    } catch {
      setInitialized(false);
    }
  }, [rootPath]);

  useEffect(() => { refresh(); }, [refresh]);

  const runRetrofit = async () => {
    if (!rootPath || retrofitting) return;
    setRetrofitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-releases/retrofit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath }),
      });
      const data = await res.json();
      if (data.ok) {
        setToast({ ok: true, text: t("rm.qd.done").replace("{n}", String(data.createdCount)).replace("{m}", String(data.scanned)) });
        refresh();
      } else {
        setToast({ ok: false, text: `❌ ${data.error || "補強失敗"}` });
      }
    } catch (e: any) {
      setToast({ ok: false, text: `❌ ${e?.message || "連線失敗"}` });
    } finally {
      setRetrofitting(false);
      setTimeout(() => setToast(null), 6000);
    }
  };

  const approve = async (taskId: string) => {
    setActing(taskId);
    try {
      const res = await fetch(`${API_BASE}/api/coding-releases/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, taskId, note: approveNote.trim() || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        setToast({ ok: true, text: `🚀 已批准上線 — ${data.releaseId}` });
        setDetailTaskId(null);
        setApproveNote("");
        refresh();
      } else {
        setToast({ ok: false, text: `❌ ${data.error || "批准失敗"}` });
      }
    } catch (e: any) {
      setToast({ ok: false, text: `❌ ${e?.message || "連線失敗"}` });
    } finally {
      setActing(null);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const reject = async (taskId: string) => {
    if (!rejectReason.trim()) return;
    setActing(taskId);
    try {
      const res = await fetch(`${API_BASE}/api/coding-releases/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, taskId, reason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setToast({ ok: true, text: "↩️ 已退回，原因已回饋到 task" });
        setRejecting(null);
        setRejectReason("");
        setDetailTaskId(null);
        refresh();
      } else {
        setToast({ ok: false, text: `❌ ${data.error || "退回失敗"}` });
      }
    } catch (e: any) {
      setToast({ ok: false, text: `❌ ${e?.message || "連線失敗"}` });
    } finally {
      setActing(null);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const phaseBadge = (st: string) => st === "done" ? "✅" : st === "awaiting_human" ? "🖐️" : st === "rework" ? "🔁" : st === "failed" || st === "needs_human" ? "❌" : "⚪";
  const riskColor = (lv: string | null | undefined) => lv === "high" ? "#dc2626" : lv === "medium" ? "#d97706" : "#16a34a";
  const trustColor = (s: number | null) => s === null ? "#a8a29e" : s >= 80 ? "#16a34a" : s >= 60 ? "#d97706" : "#dc2626";

  return (
    <div className="flex h-full min-h-0">
      {/* ── 左：內容區 ── */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {/* Header */}
        <div className="px-5 py-3 border-b sticky top-0 bg-white/95 backdrop-blur z-10" style={{ borderColor: tk.borderLight }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🚦</span>
            <h2 className="text-sm font-bold text-stone-800">{t("rm.title")}</h2>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">.paaw/releases/</span>
            {loopMode === "mini" && initialized && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">目前 mini loop — 上線前請切 full mode</span>
            )}
          </div>
          <p className="text-[11px] text-stone-400 mt-0.5">{t("rm.subtitle")}</p>
        </div>

        {toast && (
          <div className={`mx-5 mt-3 px-3 py-2 rounded-lg text-xs ${toast.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {toast.text}
          </div>
        )}

        {/* 載入中 */}
        {initialized === null && <div className="p-8 text-center text-xs text-stone-400 animate-pulse">{t("common.loading")}</div>}

        {/* ═══ 空狀態：未初始化 ═══ */}
        {initialized === false && (
          <div className="p-8">
            <div className="max-w-md mx-auto text-center border rounded-xl p-6 bg-stone-50" style={{ borderColor: tk.borderLight }}>
              <div className="text-3xl mb-2">🌱</div>
              <h3 className="text-sm font-bold text-stone-700 mb-1">{t("rm.emptyInit.title")}</h3>
              <p className="text-xs text-stone-500 leading-relaxed mb-4">{t("rm.emptyInit.desc")}</p>
              <div className="text-left bg-white rounded-lg border p-3 text-[11px] text-stone-500 space-y-1.5" style={{ borderColor: tk.borderLight }}>
                <div>1️⃣ {t("rm.emptyInit.step1")}</div>
                <div>2️⃣ {t("rm.emptyInit.step2")}</div>
                <div>3️⃣ {t("rm.emptyInit.step3")}</div>
              </div>
              {onOpenEMDashboard && (
                <button onClick={onOpenEMDashboard}
                  className="mt-4 text-xs px-4 py-2 rounded-lg text-white" style={{ backgroundColor: tk.accent }}>
                  {t("rm.emptyInit.goEM")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══ 已初始化 ═══ */}
        {initialized === true && (
          <div className="p-5 space-y-6">
            {/* 待放行 */}
            <section>
              <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-1.5">
                ⏳ {t("rm.pending.title")}
                {pending.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">{pending.length}</span>}
              </h3>

              {pending.length === 0 && (
                <div className="border border-dashed rounded-lg p-4 text-center text-xs text-stone-400" style={{ borderColor: tk.borderLight }}>
                  {t("rm.pending.empty")}
                </div>
              )}

              {pending.map(task => (
                <div key={task.taskId} className="border rounded-xl mb-2.5 bg-white overflow-hidden" style={{ borderColor: tk.borderLight }}>
                  <div className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-stone-800 truncate">{task.title}</div>
                        <div className="text-[10px] font-mono text-stone-400 mt-0.5">
                          {task.taskId} · {task.priority || "normal"}{task.updatedAt ? ` · 更新 ${fmtShort(task.updatedAt)}` : ""}
                        </div>
                      </div>
                      {task.evidenceSummary?.trustScore != null && (
                        <div className="text-right shrink-0">
                          <div className="text-lg font-bold font-mono" style={{ color: trustColor(task.evidenceSummary.trustScore) }}>
                            {task.evidenceSummary.trustScore}
                          </div>
                          <div className="text-[9px] text-stone-400">{t("rm.trustScore")}</div>
                        </div>
                      )}
                    </div>

                    {/* 七關 pipeline 徽章 */}
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {PHASES.map(ph => (
                        <span key={ph} className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${task.pipeline?.[ph]?.status === "done" ? "bg-green-50 text-green-700" : "bg-stone-100 text-stone-400"}`}>
                          {phaseBadge(task.pipeline?.[ph]?.status)} {ph}
                        </span>
                      ))}
                    </div>

                    {/* 證據摘要列 */}
                    {task.evidenceSummary && (
                      <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-stone-500">
                        {task.evidenceSummary.risk && (
                          <span>風險 <b style={{ color: riskColor(task.evidenceSummary.risk.level) }}>{task.evidenceSummary.risk.level}</b></span>
                        )}
                        {task.evidenceSummary.diffStat && (
                          <span>{task.evidenceSummary.diffStat.files} 檔案{task.evidenceSummary.diffStat.insertions != null ? ` · +${task.evidenceSummary.diffStat.insertions}/-${task.evidenceSummary.diffStat.deletions}` : ""}</span>
                        )}
                        {task.evidenceSummary.testResult && (
                          <span>測試 {task.evidenceSummary.testResult.status === "pass" ? "✅" : `⚠️ ${task.evidenceSummary.testResult.passed ?? "?"}/${(task.evidenceSummary.testResult.passed ?? 0) + (task.evidenceSummary.testResult.failed ?? 0)}`}</span>
                        )}
                      </div>
                    )}

                    {/* 行動列 */}
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setDetailTaskId(detailTaskId === task.taskId ? null : task.taskId)}
                        className="text-[11px] px-3 py-1.5 rounded-lg border hover:bg-stone-50 text-stone-600" style={{ borderColor: tk.borderLight }}>
                        🧾 {detailTaskId === task.taskId ? t("rm.hideEvidence") : t("rm.viewEvidence")}
                      </button>
                      <button onClick={() => { setRejecting(rejecting === task.taskId ? null : task.taskId); setApproveNote(""); }}
                        disabled={!!acting}
                        className="text-[11px] px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40">
                        {acting === task.taskId ? "…" : "✅ " + t("rm.approve")}
                      </button>
                      <button onClick={() => { setRejecting(rejecting === task.taskId ? null : task.taskId); setRejectReason(""); }}
                        className="text-[11px] px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">
                        ❌ {t("rm.reject")}
                      </button>
                    </div>

                    {/* 退回原因輸入 */}
                    {rejecting === task.taskId && (
                      <div className="mt-2.5 flex gap-1.5">
                        <input value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                          placeholder={t("rm.rejectReasonPh")}
                          className="flex-1 text-xs rounded-lg border border-red-200 px-2.5 py-1.5 focus:outline-none focus:border-red-400"
                          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) reject(task.taskId); }} />
                        <button onClick={() => reject(task.taskId)} disabled={!rejectReason.trim() || !!acting}
                          className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-40">
                          {t("rm.confirmReject")}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 展開完整證據卡 */}
                  {detailTaskId === task.taskId && (
                    <div className="border-t px-4 py-3 bg-stone-50" style={{ borderColor: tk.borderLight }}>
                      <EvidenceCard rootPath={rootPath} taskId={task.taskId} theme={tk}
                        onClose={() => setDetailTaskId(null)} />
                      {/* Release 批准含 note */}
                      <div className="mt-3 flex gap-1.5 items-center">
                        <input value={approveNote} onChange={e => setApproveNote(e.target.value)}
                          placeholder={t("rm.approveNotePh")}
                          className="flex-1 text-xs rounded-lg border px-2.5 py-1.5 focus:outline-none" style={{ borderColor: tk.borderLight }} />
                        <button onClick={() => approve(task.taskId)} disabled={!!acting}
                          className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 shrink-0">
                          🚀 {t("rm.approveRelease")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </section>

            {/* 品質債現況 */}
            <section>
              <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-1.5">
                🧰 {t("rm.qd.title")}
                <button onClick={refresh} className="ml-1 text-[10px] text-stone-400 hover:text-stone-600">↻ {t("rm.qd.refresh")}</button>
              </h3>

              {/* 還沒跑 feature map */}
              {qd && qd.ok === false && qd.code === "no-features-file" && (
                <div className="border border-dashed rounded-lg p-3.5 text-xs text-stone-400" style={{ borderColor: tk.borderLight }}>
                  🗺️ {t("rm.qd.noFeatureMap")}
                </div>
              )}

              {qd && qd.ok === true && (
                <div className="border rounded-xl bg-white p-3.5" style={{ borderColor: tk.borderLight }}>
                  <p className="text-[11px] text-stone-400 mb-2.5">{t("rm.qd.subtitle")}</p>

                  {/* 全清 */}
                  {(qd.noTests === 0 && qd.noDocs === 0 && (qd.openRetrofitTasks || 0) === 0) ? (
                    <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{t("rm.qd.clean")}</div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2 mb-2.5">
                        <span className="text-[11px] px-2 py-1 rounded-lg bg-stone-100 text-stone-600">📦 {(qd.activeFeatures ?? 0)} {t("rm.qd.features")}</span>
                        <span className={`text-[11px] px-2 py-1 rounded-lg ${(qd.noTests ?? 0) > 0 ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-stone-100 text-stone-500"}`}>🧪 {(qd.noTests ?? 0)} {t("rm.qd.noTests")}</span>
                        <span className={`text-[11px] px-2 py-1 rounded-lg ${(qd.noDocs ?? 0) > 0 ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-stone-100 text-stone-500"}`}>📘 {(qd.noDocs ?? 0)} {t("rm.qd.noDocs")}</span>
                        {(qd.openRetrofitTasks ?? 0) > 0 && (
                          <span className="text-[11px] px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">🛠️ {(qd.openRetrofitTasks ?? 0)} {t("rm.qd.openRetrofit")}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={runRetrofit} disabled={retrofitting}
                          className="text-xs px-4 py-2 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: tk.accent }}>
                          {retrofitting ? t("rm.qd.buttonRunning") : "🧰 " + t("rm.qd.button")}
                        </button>
                        {qd.featuresUpdatedAt && (
                          <span className="text-[10px] text-stone-400">{t("rm.qd.mapUpdatedAt").replace("{t}", fmtShort(qd.featuresUpdatedAt))}</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 載入失敗 / 未載入 */}
              {qd === null && (
                <div className="border border-dashed rounded-lg p-3.5 text-center text-xs text-stone-400" style={{ borderColor: tk.borderLight }}>
                  …
                </div>
              )}
            </section>

            {/* Release 歷史 */}
            <section>
              <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-1.5">📜 {t("rm.history.title")}</h3>
              {releases.length === 0 ? (
                <div className="border border-dashed rounded-lg p-4 text-center text-xs text-stone-400" style={{ borderColor: tk.borderLight }}>
                  {t("rm.history.empty")}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {releases.map(r => (
                    <div key={r.id} className="flex items-center gap-2.5 border rounded-lg px-3 py-2 bg-white text-xs" style={{ borderColor: tk.borderLight }}>
                      <span className="shrink-0">{r.riskLevel === "high" ? "🔴" : r.riskLevel === "medium" ? "🟡" : "🟢"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-stone-700 truncate">{r.title}</div>
                        <div className="text-[10px] font-mono text-stone-400">{r.id} · {fmtShort(r.releasedAt)}</div>
                      </div>
                      {r.trustScore != null && (
                        <span className="font-mono font-bold shrink-0" style={{ color: trustColor(r.trustScore) }}>{r.trustScore}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* ── 右：RM AI 助理 ── */}
      <div className="w-[320px] shrink-0 hidden md:block">
        <AgentSideChat
          agentId="rm"
          agentName={t("rm.agentName")}
          agentEmoji="🚦"
          greeting={t("rm.agentGreeting")}
          cwd={rootPath}
          accent={tk.accent}
          height="100%"
          suggestions={[
            { label: t("rm.sug.review"), prompt: t("rm.sug.reviewPrompt") },
            { label: t("rm.sug.whySafe"), prompt: t("rm.sug.whySafePrompt") },
            { label: t("rm.sug.rollback"), prompt: t("rm.sug.rollbackPrompt") },
          ]}
        />
      </div>
    </div>
  );
}

function fmtShort(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
