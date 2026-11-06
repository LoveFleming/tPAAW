/**
 * ReleaseManagerPanel — 🚦 Release Manager 頁
 *
 * 「要 release 時打開這頁，讓 Release Manager 同意上線」
 *
 * 左：現況報告（readiness 即時快照）
 *     + Release Requests（正式批次放行 — 證據審查全過才能 close）
 *     + 品質債現況 + Release 歷史時間線
 * 右：RM AI 助理（審證據不審碼）
 *
 * 2026-09-19：待放行（per-task approve）移除 — task 已無 pipeline（feature-first），
 * 放行一律走 Release Request（close 自動放行範圍內 pending tasks）
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";
import { useColResize, ColResizer } from "./ColResizer"; // 2026-10-09：side chat 左右 splitter
import ReleaseRequests from "./ReleaseRequests";

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
  onOpenEMDashboard?: (prefill?: string) => void; // 2026-10-16：可帶預填訊息（補強 CTA → EM 輸入框直接有派工指令，使用者按送出即可）
  onOpenReviewBoard?: () => void;
  onOpenQaRecords?: (featureName: string) => void; // 2026-10-16：Human 欄點入 — 跳 QA 記錄並過濾該 feature（看/補人員簽核）
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

interface ReadinessFeature {
  id: string; name: string; changedFiles: string[]; changeCount: number;
  apis: string[]; apiImpact: boolean; tests: { file: string; kind?: string | null }[];
  hasTests: boolean; knowledgeGaps: string[]; recentSubjects: string[];
}
interface EvCell { ok: boolean; reason?: string; note?: string; tests?: number; covered?: number; total?: number; high?: number; actor?: string; verdict?: string; models?: string[]; at?: string; decision?: string; summary?: string; touched?: boolean; untouched?: boolean; source?: string; id?: string; file?: string } // source/id/file（Phase A 2026-10-30）：證據來源註記（test-run id / review 檔 / qa id）；touched（2026-10-20）：aiReview 已審未過 vs 未跑；untouched（2026-10-21）：有跑但未觸及（≠未跑）；verdict（2026-10-21）：qa 有記錄非 pass vs 無記錄；note（2026-10-28）：綠燈但附提示（如 stale 自動重跑中）
interface EvFeature extends ReadinessFeature {
  severity: string | null; severitySource: string; // human=最新人判定 | ai/scan/auto=AI 判定預設生效
  severityDecisions?: { id: string; by: string; at: string; severity: string; remark?: string }[];
  evidence: { unit: EvCell; e2e: EvCell; sg: EvCell; qa: EvCell; aiReview: EvCell; human: EvCell };
  gaps: { missing: string[] };
}
interface EvidenceMatrix { features: EvFeature[]; summary: { features: number; bySeverity: Record<string, number>; withGaps: number; sgScan: { scannedAt: string | null; total: number; high: number } | null; reviewBoard: { latest: { at: string | null; decision: string | null; models: string[] }; total: number } | null } }
// Phase A（2026-10-30）：baseline 錨點凍結快照（.paaw/release/evidence/）
interface EvSnapshot {
  id: string; frozen: boolean; generatedAt: string;
  baseline: { sha: string; short: string; subject: string; at: string; source: string };
  head: { sha: string; short: string; subject: string };
  range: string;
  commits: { count: number; authors: string[] };
  modelDegraded?: boolean;
  features: EvFeature[];
  allGreen: boolean;
}
interface Readiness {
  releaseId: string; since: string; sinceRelease: { id: string; releasedAt: string; title: string } | null;
  firstRelease: boolean;
  evidenceMatrix?: EvidenceMatrix | null;
  commits: { count: number; authors: string[]; subjects: string[] };
  changedFiles: { file: string; changeCount: number }[];
  changedFeatures: ReadinessFeature[];
  changedApis: { method: string; path: string; file: string; featureIds: string[] }[];
  tests: { totalTestFiles?: number | null; changedFeaturesWithTests: number; changedFeaturesTotal: number };
  lastTestRun: {
    runId?: string | null;
    finishedAt: string; status: string; includeE2e: boolean; durationMs: number;
    summary: { passed: number; failed: number; skipped: number; total: number };
    byKind: Record<string, { passed: number; failed: number; skipped: number; files: number }>;
    stale: boolean; staleCommits: number;
  } | null;
  coverage?: { linePct: number | null; runner: string | null; at: string | null; measured: boolean; reason?: string | null } | null; // 2026-10-21：真實 UT 行覆蓋率（measured:false = 未量測；2026-10-27 reason = 未量測原因，直遠 UI tooltip）
  modelDegraded?: boolean; // 2026-10-28：RU model 重建失敗降級中（matrix 資料是合成最小集，重新整理自動重試）
  gates: { overall?: string; gates?: { gate: string; status: string; detail?: string; required?: boolean }[] } | null;
  openItems: number; risk: string; riskReasons: string[]; ready: boolean;
}

const RISK_COLORS: Record<string, string> = { LOW: "#16a34a", MEDIUM: "#d97706", HIGH: "#dc2626" };

export default function ReleaseManagerPanel({ rootPath, theme: tk, onOpenEMDashboard, onOpenReviewBoard, onOpenQaRecords }: Props) {
  const { t } = useI18n();
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [initialized, setInitialized] = useState<boolean | null>(null); // null = loading
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [qd, setQd] = useState<QualityDebt | null>(null);
  const [retrofitting, setRetrofitting] = useState(false);
  // 2026-10-16：補強結果常駐顯示（取代只跳 toast 就消失）+ CTA 跳 EM 大總管
  const [retrofitResult, setRetrofitResult] = useState<{ createdCount: number; skipped: number; scanned: number; created: { id: string; featureName?: string; needPhases?: string[] }[] } | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  // Phase A（2026-10-30）：baseline 錨點 Release Evidence 凍結快照
  const [baselines, setBaselines] = useState<{ sha: string; short: string; subject: string; at: string; isAuto: boolean }[]>([]);
  const [autoBaseline, setAutoBaseline] = useState<string>("");
  const [selBaseline, setSelBaseline] = useState<string>("auto");
  const [evSnaps, setEvSnaps] = useState<{ id: string; generatedAt: string; baseline: { short: string; subject: string } | null; head: { short: string } | null; features: number; withGaps: number; allGreen: boolean }[]>([]);
  const [evSnap, setEvSnap] = useState<EvSnapshot | null>(null);
  const [evBusy, setEvBusy] = useState(false);
  const [gapTasks, setGapTasks] = useState<Record<string, string>>({}); // featureId → taskId（開單結果）
  const [testing, setTesting] = useState(false);
  // 2026-11-03 Fleming：API 現況一鍵清點（前後端 + 測試 + baseline 變更）+ AI 摘要
  const [apiStatus, setApiStatus] = useState<any | null>(null);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiSummary, setApiSummary] = useState<string | null>(null);
  const [apiSummaryBusy, setApiSummaryBusy] = useState(false);
  const [includeE2e, setIncludeE2e] = useState(false);
  const chatRef = useRef<AgentSideChatHandle>(null);
  // 2026-10-09 Fleming：RM side chat 左右 splitter + 對話持久化 + model selector（跟 QA browser 同款）
  const rmPane = useColResize(520, 300, 760); // 2026-10-09：與 Handover/Troubleshooting 統一

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
      setInitialized(!!pData.initialized); // pending endpoint 只剩初始化偵測用途（待放行已移除）
      setReleases(lData.releases || []);
      setQd(qdData);
    } catch {
      setInitialized(false);
    }
  }, [rootPath]);

  useEffect(() => { refresh(); }, [refresh]);

  const fetchReadiness = useCallback(() => {
    if (!rootPath) { setReadiness(null); return; }
    fetch(`${API_BASE}/api/coding-releases/readiness?path=${encodeURIComponent(rootPath)}`)
      .then(r => r.json())
      .then(d => { if (d && !d.error) setReadiness(d); })
      .catch(() => {});
  }, [rootPath]);

  useEffect(() => { fetchReadiness(); }, [fetchReadiness]);

  // Phase A：baseline 候選 + 既有快照清單
  const fetchEvSnapshots = useCallback(async () => {
    if (!rootPath) return;
    try {
      const [bRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/coding-releases/baseline-candidates?path=${encodeURIComponent(rootPath)}`),
        fetch(`${API_BASE}/api/coding-releases/evidence?path=${encodeURIComponent(rootPath)}`),
      ]);
      const b = await bRes.json();
      const s = await sRes.json();
      if (b?.recent) {
        setBaselines(b.recent);
        if (b.auto?.sha) setAutoBaseline(b.auto.sha);
      }
      if (s?.snapshots) setEvSnaps(s.snapshots);
    } catch { /* 忽略 — 不擋主頁 */ }
  }, [rootPath]);
  useEffect(() => { fetchEvSnapshots(); }, [fetchEvSnapshots]);

  const loadEvSnapshot = useCallback(async (id: string) => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/evidence/${encodeURIComponent(id)}?path=${encodeURIComponent(rootPath)}`);
      const d = await r.json();
      if (d?.ok) setEvSnap(d.snapshot); else setEvSnap(null);
    } catch { /* ignore */ }
  }, [rootPath]);

  const generateEvidence = async () => {
    if (!rootPath || evBusy) return;
    setEvBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/evidence`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, baseline: selBaseline }),
      });
      const d = await r.json();
      if (d?.ok) {
        setEvSnap(d.snapshot);
        setToast({ ok: true, text: t("rm.evSnap.done").replace("{id}", d.snapshot.id) });
        await fetchEvSnapshots();
      } else {
        setToast({ ok: false, text: `❌ ${d?.error || t("rm.evSnap.fail")}` });
      }
    } catch (e: any) {
      setToast({ ok: false, text: `❌ ${e?.message || t("rm.evSnap.fail")}` });
    } finally {
      setEvBusy(false);
      setTimeout(() => setToast(null), 6000);
    }
  };

  const openGapTask = async (featureId: string) => {
    if (!rootPath || !evSnap || evBusy) return;
    setEvBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/evidence/${encodeURIComponent(evSnap.id)}/gap-task`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, featureId }),
      });
      const d = await r.json();
      if (d?.ok && d.taskId) {
        setGapTasks((g) => ({ ...g, [featureId]: d.taskId }));
        setToast({ ok: true, text: `✅ ${t("rm.evSnap.taskOpened")} ${d.taskId}` });
      } else {
        setToast({ ok: false, text: `❌ ${d?.error || d?.reason || t("rm.evSnap.fail")}` });
      }
    } catch (e: any) {
      setToast({ ok: false, text: `❌ ${e?.message || t("rm.evSnap.fail")}` });
    } finally {
      setEvBusy(false);
      setTimeout(() => setToast(null), 6000);
    }
  };

  // 整頁刷新（2026-09-19 Fleming）：現況報告 + RR 清單 + 品質債 + 歷史一次重讀；RR 用 key remount 重抓
  const [rrRefreshKey, setRrRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setRrRefreshKey((k) => k + 1);
    let ok = true;
    try { await Promise.all([refresh(), fetchReadiness()]); } catch { ok = false; }
    setRefreshing(false);
    const now = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    setToast({ ok, text: `${ok ? t("rm.refreshDone") : t("rm.refreshFail")} · ${now}` });
    setTimeout(() => setToast(null), 4000);
  }, [refresh, fetchReadiness, t]);

  // ▶ 執行測試：POST 背景跑 → 輪詢到結束 → 重抓 readiness（真實數字）
    // 2026-11-03 Fleming：一鍵 API 現況（按鈕才算 — 不自動燒）
  const loadApiStatus = async () => {
    if (!rootPath || apiBusy) return;
    setApiBusy(true); setApiSummary(null);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/api-status?path=${encodeURIComponent(rootPath)}`).then(r => r.json());
      if (r.ok) setApiStatus(r); else setToast({ ok: false, text: String(r.error || r.detail || "failed") });
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setApiBusy(false); }
  };
  const genApiSummary = async () => {
    if (!rootPath || apiSummaryBusy) return;
    setApiSummaryBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/api-summary?path=${encodeURIComponent(rootPath)}`, { method: "POST" }).then(r => r.json());
      if (r.ok) setApiSummary(String(r.summary || "")); else setToast({ ok: false, text: String(r.error || "failed") });
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setApiSummaryBusy(false); }
  };

  const runTests = async () => {
    if (!rootPath || testing) return;
    setTesting(true);
    try {
      await fetch(`${API_BASE}/api/coding-releases/test-run?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeE2e }),
      });
      for (let i = 0; i < 600; i++) { // 最長 20 分鐘
        await new Promise(r => setTimeout(r, 2000));
        const st = await fetch(`${API_BASE}/api/coding-releases/test-run?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).catch(() => null);
        if (!st?.running) break;
      }
      fetchReadiness();
    } finally { setTesting(false); }
  }

  // ── Readiness 證據注入（No answer without evidence）──
  const readinessEvidence = (): string | null => {
    if (!readiness) return null;
    const feats = readiness.changedFeatures.map(f =>
      `● ${f.id} ${f.name}\n  files: ${f.changedFiles.length}\n  change: ${f.recentSubjects[0] || "(commits)"}\n  risk-signal: ${f.hasTests ? "tests ✓" : "NO TESTS"}${f.apiImpact ? " · API impact" : ""}`
    ).join("\n");
    const gates = (readiness.gates?.gates || []).map(g => `${g.gate}: ${g.status}`).join(", ") || "n/a";
    return [
      `Readiness Report #${readiness.releaseId}`,
      `Baseline: ${readiness.firstRelease ? "首次發布（first commit 起）" : `${readiness.sinceRelease?.id} @ ${readiness.sinceRelease?.releasedAt?.slice(0, 16)}`}`,
      `Ready: ${readiness.ready ? "READY" : "NOT READY"} · Risk: ${readiness.risk}（${readiness.riskReasons.join("; ") || "clean"}）`,
      `Commits since baseline: ${readiness.commits.count}（${readiness.commits.authors.join(", ")}）`,
      `Changed: ${readiness.changedFeatures.length} features / ${readiness.changedApis.length} APIs / ${readiness.changedFiles.length} files / open items ${readiness.openItems}`,
      `Tests: changed features with tests ${readiness.tests.changedFeaturesWithTests}/${readiness.tests.changedFeaturesTotal}`,
      ...(readiness.lastTestRun
        ? [`Last test run (${readiness.lastTestRun.finishedAt.slice(0, 16).replace("T", " ")}${readiness.lastTestRun.stale ? ` ⚠ STALE ${readiness.lastTestRun.staleCommits} commits since` : ""}): ${readiness.lastTestRun.summary.passed} passed / ${readiness.lastTestRun.summary.failed} failed / ${readiness.lastTestRun.summary.skipped} skipped（${Object.entries(readiness.lastTestRun.byKind).map(([k, v]) => `${k} ${v.passed}✓${v.failed ? ` ${v.failed}✗` : ""}`).join(", ") || "no per-kind"}）`]
        : [`Tests: 尚未執行過測試（數字待跑）`]),
      `Gates: ${gates}`,
      "",
      "Changed Features:",
      feats,
      "",
      "Changed APIs:",
      readiness.changedApis.slice(0, 20).map(a => `${a.method} ${a.path} (${a.file})`).join("\n") || "(none)",
      "",
      "Recent commits:",
      readiness.commits.subjects.slice(0, 10).join("\n"),
    ].join("\n");
  };

  const generateReport = () => {
    const ev = readinessEvidence();
    if (!ev) return;
    chatRef.current?.send(
      `以下是這次 release 的就緒證據（程式產生，deterministic）：\n\n${ev}\n\n` +
      `請以 Release Manager 角色產生一份「給老闆的上線報告」：\n` +
      `1) 一句話結論（能不能上）\n2) 這次改了什麼（人話，feature 導向）\n3) 風險與最壞情況\n4) 測試與驗證狀態\n5) rollback 考量\n6) 建議決策（上 / 不上 / 附條件上）`
    );
  };

  // 2026-11-03：老闆五問快捷鈕移除（Fleming：過度設計）— generateReport 已涵蓋同內容

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
        setRetrofitResult({ createdCount: data.createdCount || 0, skipped: data.skipped || 0, scanned: data.scanned || 0, created: Array.isArray(data.created) ? data.created.slice(0, 5) : [] });
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
            {readiness && (
              <button onClick={generateReport}
                className="text-xs px-3 py-1 rounded-lg text-white font-bold shrink-0 hover:opacity-90"
                style={{ backgroundColor: "#7c3aed" }} data-testid="rm-gen-report">
                📋 {t("rm.genReport")}
              </button>
            )}
            {readiness && (
              <button onClick={loadApiStatus} disabled={apiBusy}
                className="text-xs px-3 py-1 rounded-lg text-white font-bold shrink-0 hover:opacity-90 disabled:opacity-60 flex items-center gap-1.5"
                style={{ backgroundColor: "#0369a1" }} data-testid="rm-api-status">
                {apiBusy && <span className="animate-spin inline-block w-3 h-3 border-[1.5px] border-white border-t-transparent rounded-full" />}
                {t("rm.apiBtn")}
              </button>
            )}
            <span className="flex-1" />
            <button onClick={refreshAll} disabled={refreshing}
              title={t("rm.refreshAll")}
              className="text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors disabled:opacity-40"
              style={{ borderColor: tk.borderLight }}>
              {refreshing ? `⏳ ${t("rm.refreshing")}` : `↻ ${t("rm.refreshAll")}`}
            </button>
          </div>
          <p className="text-[11px] text-stone-400 mt-0.5">{t("rm.subtitle")}</p>
        </div>

        {toast && (
          <div className={`mx-5 mt-3 px-3 py-2 rounded-lg text-xs ${toast.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {toast.text}
          </div>
        )}

        {/* ═══ Release Readiness 報告（APRS 風格 — 打開就能跟老闆報告）═══ */}
        {readiness && (
          <div className="px-5 pt-4" data-testid="rm-readiness">
            <div className="rounded-xl border overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
              {/* Header */}
              {/* ══ API 現況（2026-11-03 Fleming：一鍵清點前後端 API + 測試狀態 + AI 摘要）══ */}
                {apiStatus && (
                  <div className="px-4 py-3 border-t" style={{ borderColor: tk.borderLight, background: "#f0f9ff" }} data-testid="rm-api-status-block">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-xs font-bold text-stone-700">{t("rm.apiTitle")}</span>
                      <button onClick={genApiSummary} disabled={apiSummaryBusy}
                        className="ml-auto text-[10px] px-2.5 py-1 rounded-full border font-bold text-violet-600 hover:bg-violet-50 disabled:opacity-50 flex items-center gap-1"
                        style={{ borderColor: "#ddd6fe" }} data-testid="rm-api-summary-btn">
                        {apiSummaryBusy && <span className="animate-spin inline-block w-2.5 h-2.5 border-[1.5px] border-current border-t-transparent rounded-full" />}
                        {t("rm.apiGenSummary")}
                      </button>
                    </div>
                    <div className="flex gap-2 flex-wrap text-[10px] font-bold mb-2">
                      <span className="px-2 py-1 rounded-lg bg-white border" style={{ borderColor: tk.borderLight }}>
                        {t("rm.apiBackend")} <span className="font-mono text-sky-700 text-xs">{apiStatus.backend.total}</span>
                        <span className="text-stone-400 font-normal">（{apiStatus.backend.withTests} {t("rm.apiHasTest")} / {apiStatus.backend.total - apiStatus.backend.withTests} {t("rm.apiNoTest")}）</span>
                      </span>
                      <span className="px-2 py-1 rounded-lg bg-white border" style={{ borderColor: tk.borderLight }}>
                        {t("rm.apiFrontend")} <span className="font-mono text-sky-700 text-xs">{apiStatus.frontend.pages}</span>
                        <span className="text-stone-400 font-normal"> · {t("rm.apiCalls")} {apiStatus.frontend.apiCallsTotal}</span>
                      </span>
                      <span className="px-2 py-1 rounded-lg bg-white border" style={{ borderColor: tk.borderLight }}>
                        {t("rm.apiChangedSince")} <span className={`font-mono text-xs ${apiStatus.changedSinceRelease > 0 ? "text-amber-600" : "text-green-600"}`}>{apiStatus.changedSinceRelease ?? "—"}</span>
                        {apiStatus.changedSinceRelease == null && <span className="text-stone-400 font-normal">（{t("rm.apiFirstRelease")}）</span>}
                      </span>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-lg border bg-white" style={{ borderColor: tk.borderLight }}>
                      <div className="grid gap-1 text-[9px] font-bold text-stone-400 px-2 py-1 sticky top-0 bg-white border-b" style={{ gridTemplateColumns: "1.8fr 1.6fr 0.9fr 0.6fr 0.6fr", borderColor: tk.borderLight }}>
                        <span>{t("rm.apiColApi")}</span><span>{t("rm.apiColName")}</span><span>{t("rm.apiColFrontend")}</span><span>{t("rm.apiColTests")}</span><span>{t("rm.apiColChanged")}</span>
                      </div>
                      {(apiStatus.apis || []).map((a: any, i: number) => (
                        <div key={i} className="grid gap-1 items-center px-2 py-1 text-[10px] hover:bg-stone-50" style={{ gridTemplateColumns: "1.8fr 1.6fr 0.9fr 0.6fr 0.6fr", background: a.changed ? "#fffbeb" : undefined }}>
                          <span className="font-mono font-bold text-stone-700 truncate" title={a.entry}>{a.entry}</span>
                          <span className="text-stone-500 truncate" title={a.name}>{a.name}</span>
                          <span className="text-stone-500 truncate" title={(a.frontendRefs || []).join(", ")}>{a.frontendRefs?.length ? `${a.frontendRefs.length} ${t("rm.apiYes")}` : <span className="text-stone-300">—</span>}</span>
                          <span className={`font-mono font-bold ${a.tests > 0 ? "text-green-600" : "text-red-500"}`}>{a.tests > 0 ? `✓${a.tests}` : "✗"}</span>
                          <span className={`font-bold ${a.changed ? "text-amber-600" : "text-stone-300"}`}>{a.changed ? "●" : "—"}</span>
                        </div>
                      ))}
                    </div>
                    {apiSummary && (
                      <div className="mt-2 rounded-lg bg-violet-50 border px-3 py-2 text-[11px] text-stone-700 whitespace-pre-wrap" style={{ borderColor: "#ddd6fe" }} data-testid="rm-api-summary">
                        <div className="text-[9px] font-bold text-violet-600 mb-0.5">{t("rm.apiSummaryTitle")}</div>
                        {apiSummary}
                      </div>
                    )}
                  </div>
                )}

                {readiness.evidenceMatrix && (
                  <div className="px-4 py-3 border-t" style={{ borderColor: tk.borderLight }} data-testid="rm-evidence-matrix">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-xs font-bold text-stone-700">⚖️ {t("rm.ev.title")}</span>
                      <span className="text-[10px] text-stone-400">{t("rm.ev.hint")}</span>
                      {onOpenReviewBoard && <button type="button" onClick={onOpenReviewBoard} className="text-[10px] px-2 py-0.5 rounded-full border font-bold text-violet-600 hover:bg-violet-50" style={{ borderColor: "#ddd6fe" }} data-testid="rm-open-review-board">{t("rm.ev.openBoard")} →</button>}
                      <span className="ml-auto flex gap-1.5 text-[10px] font-mono">
                        {readiness.evidenceMatrix.summary.bySeverity.S2 > 0 && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-bold">S2 {readiness.evidenceMatrix.summary.bySeverity.S2}</span>}
                        {readiness.evidenceMatrix.summary.bySeverity.S1 > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-bold">S1 {readiness.evidenceMatrix.summary.bySeverity.S1}</span>}
                        {readiness.evidenceMatrix.summary.bySeverity.S0 > 0 && <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-bold">S0 {readiness.evidenceMatrix.summary.bySeverity.S0}</span>}
                        {readiness.evidenceMatrix.summary.bySeverity.humanOverride > 0 && <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 font-bold" title={t("rm.ev.humanTip")}>👤 {readiness.evidenceMatrix.summary.bySeverity.humanOverride}</span>}
                        {readiness.evidenceMatrix.summary.bySeverity.aiDefault > 0 && <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-600 font-bold" title={t("rm.ev.aiTip")}>🤖 {readiness.evidenceMatrix.summary.bySeverity.aiDefault}</span>}
                        {readiness.evidenceMatrix.summary.reviewBoard && <button type="button" onClick={onOpenReviewBoard} disabled={!onOpenReviewBoard} className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 enabled:hover:bg-violet-100 disabled:cursor-default" title={readiness.evidenceMatrix.summary.reviewBoard.latest.models.join("、")}>🏛 {readiness.evidenceMatrix.summary.reviewBoard.latest.models.length}m</button>}
                        {readiness.evidenceMatrix.summary.sgScan && <span className={`px-1.5 py-0.5 rounded ${readiness.evidenceMatrix.summary.sgScan.high > 0 ? "bg-red-50 text-red-600 font-bold" : "bg-green-50 text-green-700"}`}>🛡 {readiness.evidenceMatrix.summary.sgScan.total}·{readiness.evidenceMatrix.summary.sgScan.high}hi</span>}
                      </span>
                    </div>
                    {readiness.modelDegraded && (
                      <div className="mb-2 rounded-lg bg-orange-50 px-3 py-1.5 text-[10px] text-orange-700 font-bold">⚠️ {t("rm.ev.modelDegraded")}</div>
                    )}
                    <div className="grid gap-1 text-[9px] font-bold text-stone-400 px-2 pb-1" style={{ gridTemplateColumns: "1.6fr 0.6fr 0.8fr 0.9fr 0.8fr 0.8fr 1.5fr" }}>
                      {/* 2026-11-03 Fleming：Human 欄移除 — 簡化（人不逐 feature 簽核，看 AI 摘要與 QA 記錄即可）*/}
                      <span>{t("rm.ev.feature")}</span><span>Sev</span><span>Unit</span><span>E2E</span><span>SG</span><span>QA</span><span>{t("rm.ev.board")}</span>
                    </div>
                    {readiness.evidenceMatrix.features.map(f => {
                      const ev = f.evidence;
                      const cell = (c: EvCell, label: string) => (
                        <span className={`text-[10px] font-mono ${c.ok ? (c.note ? "text-amber-600 font-bold" : "text-green-600") : "text-red-500 font-bold"}`} title={String(c.note ? `${c.reason || "✓"}（${c.note}）` : (c.reason || (c.ok ? "✓" : "missing")))}>{label}</span>
                      );
                      return (
                        <div key={f.id} className="grid gap-1 items-center px-2 py-1.5 rounded-lg hover:bg-stone-50" style={{ gridTemplateColumns: "1.6fr 0.6fr 0.8fr 0.9fr 0.8fr 0.8fr 1.5fr", background: f.gaps.missing.length ? "#fff7ed" : undefined }}>
                          <span className="text-[10px] font-bold text-stone-700 truncate" title={f.name}>{f.name}</span>
                          <span className={`text-[10px] font-bold ${f.severity === "S2" ? "text-red-600" : f.severity === "S1" ? "text-amber-600" : f.severity === "S0" ? "text-green-600" : "text-stone-400"}`} title={[t("rm.ev.aiTip"), ...((f.severityDecisions || []).map(d => `👤${d.by}: ${d.severity}${d.remark ? `（${d.remark}）` : ""}`))].join("\n")}>
                            {f.severity}{f.severitySource === "human" ? "👤" : "🤖"}
                          </span>
                          {cell(ev.unit, ev.unit.ok ? `✓${ev.unit.tests || 0}t${ev.unit.note ? " ⚣" : ""}` : "✗")}
                          {cell(ev.e2e, ev.e2e.ok ? (ev.e2e.total ? `${ev.e2e.covered}/${ev.e2e.total}` : "—") : `✗${ev.e2e.covered ?? 0}/${ev.e2e.total ?? 0}`)}
                          {cell(ev.sg, ev.sg.ok ? ((ev.sg.total ?? 0) > 0 ? `⚠${ev.sg.total}` : "✓0") : `✗${ev.sg.high ?? 0}hi`)}
                          {cell(ev.qa, ev.qa.ok ? `✓${String(ev.qa.actor || "").slice(0, 4)}` : ev.qa.verdict ? `✗${ev.qa.verdict}` : "✗")}
                          {ev.aiReview.ok
                            ? <span className="text-[9px] text-green-600 font-mono truncate" title={`${ev.aiReview.models?.join("、")} @ ${String(ev.aiReview.at || "").slice(0, 10)}`}>✓{ev.aiReview.models?.length}m {String(ev.aiReview.decision || "").slice(0, 8)}</span>
                            // 2026-10-20：區分「已審未過」vs「未跑」；2026-10-21 再分「有跑但未觸及」— 三態不誤導
                            : ev.aiReview.touched
                              ? <span className="text-[9px] text-amber-600 font-bold truncate" title={String(ev.aiReview.reason || "")}>✗ {t("rm.ev.reviewedNotApproved")}{ev.aiReview.decision ? `（${String(ev.aiReview.decision).slice(0, 14)}）` : ""}</span>
                              : ev.aiReview.untouched
                                ? <span className="text-[9px] text-amber-600 font-bold truncate" title={String(ev.aiReview.reason || "")}>✗ {t("rm.ev.notTouched")}</span>
                                : <span className="text-[9px] text-red-500 font-bold truncate" title={String(ev.aiReview.reason || "")}>✗ {t("rm.ev.notRun")}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

              {/* Changed Features */}
              {readiness.changedFeatures.length > 0 && (
                <div data-testid="rm-readiness-features">
                  {(readiness.changedFeatures).map(f => (
                    <div key={f.id} className="px-4 py-2.5 border-b last:border-0 hover:bg-stone-50" style={{ borderColor: tk.borderLight }} data-testid="rm-readiness-feature">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ color: "#7c3aed", backgroundColor: "#f5f3ff" }}>{f.id}</span>
                        <span className="text-xs font-bold text-stone-800">{f.name}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: RISK_COLORS[f.hasTests || !f.apiImpact ? "LOW" : "HIGH"], backgroundColor: f.hasTests || !f.apiImpact ? "#f0fdf4" : "#fef2f2" }}>
                          risk {f.hasTests || !f.apiImpact ? "LOW" : "HIGH"}
                        </span>
                        <span className={`text-[9px] font-bold ${f.hasTests ? "text-green-600" : "text-red-500"}`}>tests {f.hasTests ? `✓ ${f.tests.length}` : "✗ none"}</span>
                        <span className={`text-[9px] ${f.apiImpact ? "text-blue-600 font-bold" : "text-stone-400"}`}>{f.apiImpact ? `API impact: ${f.apis.length}` : "API impact: No"}</span>
                      </div>
                      <div className="text-[10px] text-stone-500 mt-1">
                        Change: {f.recentSubjects.slice(0, 2).join(" / ") || `${f.changedFiles.length} files changed`}
                        <span className="text-stone-400"> · {f.changedFiles.length} files · {f.changeCount} changes</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
              </div>
              {onOpenEMDashboard && (
                <button onClick={() => onOpenEMDashboard()}
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
            {/* ══ Release Evidence 凍結快照（Phase A：baseline 錨點出貨檢查表 — 人選 baseline 生成，快照不可變）══ */}
            <section data-testid="rm-ev-snapshot">
              <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-1.5">🧊 {t("rm.evSnap.title")}</h3>
              <div className="border rounded-xl bg-white p-3.5" style={{ borderColor: tk.borderLight }}>
                <p className="text-[11px] text-stone-400 mb-2.5">{t("rm.evSnap.hint")}</p>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="text-[11px] font-bold text-stone-500">{t("rm.evSnap.baseline")}</span>
                  <select value={selBaseline} onChange={(e) => setSelBaseline(e.target.value)}
                    className="text-xs border rounded-lg px-2 py-1.5 bg-white max-w-[340px]" style={{ borderColor: tk.borderLight }}
                    data-testid="rm-ev-baseline-select">
                    <option value="auto">⭐ auto{autoBaseline ? ` (${autoBaseline.slice(0, 8)})` : ""}</option>
                    {baselines.map((b) => (
                      <option key={b.sha} value={b.sha}>{b.short} · {b.subject.slice(0, 50)}{b.isAuto ? " ⭐" : ""}</option>
                    ))}
                  </select>
                  <button onClick={generateEvidence} disabled={evBusy}
                    className="text-xs px-3 py-1.5 rounded-lg text-white font-bold disabled:opacity-40"
                    style={{ backgroundColor: tk.accent }} data-testid="rm-ev-generate">
                    {evBusy ? t("rm.evSnap.generating") : `🧊 ${t("rm.evSnap.generate")}`}
                  </button>
                  <span className="text-[10px] font-mono text-stone-400">.paaw/release/evidence/</span>
                </div>
                {/* 快照清單（載入舊快照 — 凍結不可變）*/}
                {evSnaps.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mb-2" data-testid="rm-ev-snap-list">
                    {evSnaps.slice(0, 8).map((s) => (
                      <button key={s.id} onClick={() => loadEvSnapshot(s.id)}
                        className={`text-[10px] font-mono px-2 py-1 rounded-full border ${evSnap?.id === s.id ? "bg-stone-800 text-white" : "bg-white hover:bg-stone-100"}`} style={{ borderColor: evSnap?.id === s.id ? "transparent" : tk.borderLight }}>
                        {s.allGreen ? "✅" : "⚠️"} {s.id} · {s.withGaps}/{s.features}
                      </button>
                    ))}
                  </div>
                )}
                {/* 快照表格 */}
                {evSnap && (
                  <div data-testid="rm-ev-snap-table">
                    <div className="flex items-center gap-2 flex-wrap text-[10px] text-stone-500 mb-2">
                      <span className="font-mono font-bold">{evSnap.id}</span>
                      <span>{t("rm.evSnap.range")}: {evSnap.baseline?.short}…{evSnap.head?.short} · {evSnap.commits?.count} commits</span>
                      <span>{t("rm.evSnap.frozenAt")} {fmtShort(evSnap.generatedAt)}</span>
                      <span className={`font-bold px-1.5 py-0.5 rounded ${evSnap.allGreen ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-700"}`}>
                        {evSnap.allGreen ? t("rm.evSnap.allGreen") : t("rm.evSnap.hasGaps")}
                      </span>
                      {evSnap.modelDegraded && <span className="text-orange-600">⚠ {t("rm.ev.modelDegraded")}</span>}
                    </div>
                    {evSnap.features.length === 0 ? (
                      <div className="text-[11px] text-stone-400 border border-dashed rounded-lg px-3 py-2" style={{ borderColor: tk.borderLight }}>{t("rm.evSnap.noDelta")}</div>
                    ) : (
                      <div className="grid gap-1 text-[9px] font-bold text-stone-400 px-2 pb-1" style={{ gridTemplateColumns: "1.6fr 0.5fr 0.8fr 0.8fr 0.7fr 1.1fr 1.1fr 1.3fr" }}>
                        <span>{t("rm.ev.feature")}</span><span>Sev</span><span>Unit</span><span>E2E</span><span>SG</span><span>{t("rm.ev.board")}</span><span>{t("rm.ev.human")}</span><span>{t("rm.evSnap.action")}</span>
                      </div>
                    )}
                    {evSnap.features.map((f) => {
                      const ev = f.evidence;
                      const cell = (c: EvCell, okLabel: string) => (
                        <span className={`text-[10px] font-mono ${c.ok ? "text-green-600" : "text-red-500 font-bold"}`} title={String(c.reason || c.source || (c.ok ? "✓" : "missing"))}>{c.ok ? okLabel : "✗"}</span>
                      );
                      return (
                        <div key={f.id} className="grid gap-1 items-center px-2 py-1.5 rounded-lg hover:bg-stone-50" style={{ gridTemplateColumns: "1.6fr 0.5fr 0.8fr 0.8fr 0.7fr 1.1fr 1.1fr 1.3fr", background: f.gaps.missing.length ? "#fff7ed" : undefined }} data-testid="rm-ev-snap-row">
                          <span className="text-[10px] font-bold text-stone-700 truncate" title={`${f.id} · ${f.name}`}>{f.name}</span>
                          <span className={`text-[10px] font-bold ${f.severity === "S2" ? "text-red-600" : f.severity === "S1" ? "text-amber-600" : "text-green-600"}`}>{f.severity || "?"}</span>
                          {cell(ev.unit, ev.unit.ok ? `✓${ev.unit.tests || 0}t` : "✗")}
                          {cell(ev.e2e, ev.e2e.ok ? (ev.e2e.total ? `${ev.e2e.covered}/${ev.e2e.total}` : "—") : "✗")}
                          {cell(ev.sg, ev.sg.ok ? "✓" : `✗${ev.sg.high ?? 0}hi`)}
                          {ev.aiReview.ok
                            ? <span className="text-[9px] text-green-600 font-mono truncate" title={String(ev.aiReview.source || "")}>✓{ev.aiReview.models?.length || ""}m</span>
                            : <span className="text-[9px] text-red-500 font-bold truncate" title={String(ev.aiReview.reason || "")}>✗ {t("rm.ev.notRun")}</span>}
                          {ev.human.ok
                            ? <span className="text-[9px] text-green-700 truncate" title={String(ev.human.source || ev.human.summary || "")}>✍</span>
                            : <span className="text-[9px] text-stone-400">—</span>}
                          {f.gaps.missing.length > 0 ? (
                            gapTasks[f.id]
                              ? <span className="text-[9px] text-green-700 font-bold truncate" data-testid="rm-ev-gap-tasked">✅ {gapTasks[f.id]}</span>
                              : <button type="button" onClick={() => openGapTask(f.id)} disabled={evBusy}
                                  className="text-[9px] px-2 py-0.5 rounded-full border font-bold text-orange-600 hover:bg-orange-50 disabled:opacity-40"
                                  style={{ borderColor: "#fed7aa" }} title={t("rm.evSnap.openTaskTip")} data-testid="rm-ev-open-gap-task">
                                  🛠 {t("rm.evSnap.openTask")}（缺 {f.gaps.missing.join("/")}）
                                </button>
                          ) : <span className="text-[9px] text-green-600 font-bold">✓ {t("rm.evSnap.rowGreen")}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Release Requests — 正式批次放行（v2 2026-09-18；v3：AI 建議 verdict）*/}
            <ReleaseRequests
              key={rrRefreshKey}
              rootPath={rootPath}
              theme={{ borderLight: tk.borderLight, accent: tk.accent, accentHover: tk.accentHover || tk.accent }}
              notify={(ok, text) => { setToast({ ok, text }); setTimeout(() => setToast(null), 6000); }}
              chatRef={chatRef}
            />

            

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
      {/* 2026-10-09 Fleming：跟 QA browser 同款 — splitter 可拖寬 + 三按鈕（persistCrewId）+ model selector */}
      <ColResizer onDown={rmPane.startDrag} className="hidden md:block" />
      <div className="shrink-0 hidden md:block" style={{ width: rmPane.width }}>
        <AgentSideChat
          ref={chatRef}
          agentId="rm"
          agentName={t("rm.agentName")}
          agentEmoji="🚦"
          greeting={t("rm.agentGreeting")}
          cwd={rootPath}
          accent={tk.accent}
          accentHover={tk.accentHover || tk.accent}
          height="100%"
          persistCrewId="coding.rm-side"
          modelFeature="sideChat.rm"
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
