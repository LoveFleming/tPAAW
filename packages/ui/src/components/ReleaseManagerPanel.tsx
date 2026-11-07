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

interface Props {
  rootPath: string;
  theme: any;
  onOpenEMDashboard?: (prefill?: string) => void; // 2026-10-16：可帶預填訊息（補強 CTA → EM 輸入框直接有派工指令，使用者按送出即可）
  onOpenReviewBoard?: () => void;
  onOpenQaRecords?: (featureName: string) => void; // 2026-10-16：Human 欄點入 — 跳 QA 記錄並過濾該 feature（看/補人員簽核）
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
interface EvidenceMatrix { features: EvFeature[]; byCommit?: { short: string; subject: string; at: string; author: string; featureIds: string[] }[]; /* 2026-11-07 Fleming：by commit line 分組 */ summary: { features: number; bySeverity: Record<string, number>; withGaps: number; sgScan: { scannedAt: string | null; total: number; high: number } | null; reviewBoard: { latest: { at: string | null; decision: string | null; models: string[] }; total: number } | null } }
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

export default function ReleaseManagerPanel({ rootPath, theme: tk, onOpenEMDashboard, onOpenReviewBoard, onOpenQaRecords }: Props) {
  const { t } = useI18n();
  const [initialized, setInitialized] = useState<boolean | null>(null); // null = loading
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  // Phase A（2026-10-30）：baseline 錨點 Release Evidence 凍結快照
  const [baselines, setBaselines] = useState<{ sha: string; short: string; subject: string; at: string; isAuto: boolean }[]>([]);
  const [autoBaseline, setAutoBaseline] = useState<string>("");
  // 2026-11-06 Fleming：產 report 前選 commit 時間
  const [selCommit, setSelCommit] = useState<string>("");
  const [testing, setTesting] = useState(false);
  // 2026-11-03 Fleming：API 現況一鍵清點（前後端 + 測試 + baseline 變更）+ AI 摘要
  const [apiStatus, setApiStatus] = useState<any | null>(null);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiSummary, setApiSummary] = useState<string | null>(null);
  const [apiSummaryBusy, setApiSummaryBusy] = useState(false);
  // 2026-11-07 Fleming v3：Evidence Matrix API-first、按鈕才載入（不随 readiness 自動出現）
  const [evApi, setEvApi] = useState<any | null>(null);
  const [evApiBusy, setEvApiBusy] = useState(false);
  const [includeE2e, setIncludeE2e] = useState(false);
  const chatRef = useRef<AgentSideChatHandle>(null);
  // 2026-10-09 Fleming：RM side chat 左右 splitter + 對話持久化 + model selector（跟 QA browser 同款）
  const rmPane = useColResize(520, 300, 760); // 2026-10-09：與 Handover/Troubleshooting 統一

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    try {
      const pRes = await fetch(`${API_BASE}/api/coding-releases/pending?path=${encodeURIComponent(rootPath)}`);
      const pData = await pRes.json();
      setInitialized(!!pData.initialized); // pending endpoint 只剩初始化偵測用途（待放行已移除）
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
    } catch { /* 忽略 — 不擋主頁 */ }
  }, [rootPath]);
  useEffect(() => { fetchEvSnapshots(); }, [fetchEvSnapshots]);

  // 整頁刷新（2026-09-19 Fleming）：現況報告一次重讀
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    let ok = true;
    try { await Promise.all([refresh(), fetchReadiness()]); } catch { ok = false; }
    setRefreshing(false);
    const now = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    setToast({ ok, text: `${ok ? t("rm.refreshDone") : t("rm.refreshFail")} · ${now}` });
    setTimeout(() => setToast(null), 4000);
  }, [refresh, fetchReadiness, t]);

  // 2026-11-07 Fleming v3：Evidence Matrix API-first — 按鈕載入（/evidence-by-api），窗口 = 選的 baseline commit 之後；api 現況另顆按鈕看全貌
  const loadEvApi = async (sha?: string) => {
    if (!rootPath || evApiBusy) return;
    const since = sha !== undefined ? sha : selCommit;
    setEvApiBusy(true);
    try {
      const p = `${API_BASE}/api/coding-releases/evidence-by-api?path=${encodeURIComponent(rootPath)}${since ? `&since=${encodeURIComponent(since)}` : ""}`;
      const r = await fetch(p).then(r => r.json());
      if (r.ok) setEvApi(r); else setToast({ ok: false, text: String(r.error || r.detail || "failed") });
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setEvApiBusy(false); }
  };

  // ▶ 執行測試：POST 背景跑 → 輪詢到結束 → 重抓 readiness（真實數字）
    // 2026-11-03 Fleming：一鍵 API 現況（按鈕才算 — 不自動燒）
  const loadApiStatus = async () => {
    if (!rootPath || apiBusy) return;
    setApiBusy(true); setApiSummary(null);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/api-status?path=${encodeURIComponent(rootPath)}`).then(r => r.json());
      if (r.ok) { setApiStatus(r); genApiSummary(); } // 2026-11-07 Fleming：看全貌同時自動出 AI 摘要
      else setToast({ ok: false, text: String(r.error || r.detail || "failed") });
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

  // 2026-11-07 Fleming v3：Evidence Matrix 表格文字化（API-first，餵 AI 用；資料來源 = 按鈕載入的 evApi）
  const matrixEvidenceText = (): string | null => {
    if (!evApi) return null;
    const anchorDesc = evApi.anchor === "all" ? "HEAD（全部 API，不 by 時間）" : `${evApi.anchor}（${evApi.commitsInWindow} commits）`;
    const rows = evApi.apis.map((a: any) =>
      `● ${a.entry}｜${a.name || ""}｜Tests ${a.tests.length ? `✓${a.tests.length}（${a.tests.join(", ")}）` : "✗ 無"}｜E2E ${a.e2eCovered ? "✓" : "—"}｜SG ${a.sg.ok ? `✓（${a.sg.total} findings）` : `✗${a.sg.high}hi`}｜Review ${a.reviewCount ? `✓${a.reviewCount}（最新 ${String(a.latestReviewAt || "").slice(0, 10)}）` : "✗ 未審"}｜檔案 ${a.files.join(", ")}`
    ).join("\n");
    return `Evidence Matrix by API（${anchorDesc}：${evApi.summary.changedApis} APIs changed / tests ✓${evApi.summary.withTests} / e2e ✓${evApi.summary.e2eCovered} / SG high ✗${evApi.summary.sgHigh}）\n\n${rows}`;
  };

  const generateReport = () => {
    const ev = readinessEvidence();
    const mx = matrixEvidenceText();
    if (!ev) return;
    const cmt = baselines.find(b => b.sha === selCommit);
    const anchor = cmt ? `\n報告基準 commit：${cmt.short}（${cmt.subject}，${cmt.at}）\n報告範圍：這個 commit 為止的狀態。` : `\n報告基準：目前 HEAD。`;
    chatRef.current?.send(
      `以下是這次 release 的就緒證據（程式產生，deterministic）：\n\n${ev}\n\n${mx || ""}${anchor}\n\n` +
      `請以 Release Manager 角色產生一份「給老闆的上線報告」：\n` +
      `1) 一句話結論（能不能上）\n2) 這次改了什麼（人話，feature 導向）\n3) 風險與最壞情況\n4) 測試與驗證狀態\n5) rollback 考量\n6) 建議決策（上 / 不上 / 附條件上）`
    );
  };

  // 2026-11-06 Fleming：請 AI 實際去看證據（不只看表 — 讀 code/test 檔驗證）
  const askAiVerify = () => {
    const mx = matrixEvidenceText();
    if (!mx) return;
    chatRef.current?.send(
      `以下是 Evidence Matrix 表格（by API，deterministic 證據）：\n\n${mx}\n\n` +
      `請不要只看表格 — 實際去 repo（cwd）查證據，回答：\n` +
      `1) Tests ✗ 的 API：去看該 API 的 code 與現有測試，找出沒測到的部分\n` +
      `2) 哪些 API 變更風險最高（無測試 + 無 e2e 覆蓋 + 高 commit 數），實際讀 code 說明風險\n` +
      `3) SG ✗ 的原因是什麼（真的有 high finding 還是掃描沒覆蓋）\n` +
      `結論要附實際檔案路徑與行號證據（No answer without evidence）。`
    );
  };

  // 2026-11-03：老闆五問快捷鈕移除（Fleming：過度設計）— generateReport 已涵蓋同內容

  return (
    <div className="flex h-full min-h-0">
      {/* ── 左：內容區 ── */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {/* Header */}
        <div className="px-5 py-3 border-b sticky top-0 bg-white/95 backdrop-blur z-10" style={{ borderColor: tk.borderLight }}>
          {/* 2026-11-06 Fleming：按鈕多，允许換行避免遮住 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg">🚦</span>
            <h2 className="text-sm font-bold text-stone-800">{t("rm.title")}</h2>
            {readiness && (
              <select value={selCommit} onChange={(e) => { const v = e.target.value; setSelCommit(v); if (evApi) loadEvApi(v); }}
                className="text-[11px] border rounded-lg px-1.5 py-1 bg-white min-w-0 max-w-[260px] shrink" style={{ borderColor: tk.borderLight }}
                title={t("rm.reportCommitTip")} data-testid="rm-report-commit-select">
                <option value="">HEAD（目前）</option>
                {baselines.map((b) => (
                  <option key={b.sha} value={b.sha}>{fmtShort(b.at)} {b.short} · {b.subject.slice(0, 40)}</option>
                ))}
              </select>
            )}
            {readiness && (
              <button onClick={generateReport}
                className="text-xs px-3 py-1 rounded-lg text-white font-bold shrink-0 hover:opacity-90"
                style={{ backgroundColor: "#7c3aed" }} data-testid="rm-gen-report">
                📋 {t("rm.genReport")}
              </button>
            )}
            {readiness && (
              <button onClick={() => loadEvApi()} disabled={evApiBusy}
                className="text-xs px-3 py-1 rounded-lg text-white font-bold shrink-0 hover:opacity-90 disabled:opacity-60 flex items-center gap-1.5"
                style={{ backgroundColor: "#b45309" }} data-testid="rm-ev-load" title={t("rm.ev.loadTip")}>
                {evApiBusy && <span className="animate-spin inline-block w-3 h-3 border-[1.5px] border-white border-t-transparent rounded-full" />}
                ⚖️ {t("rm.ev.loadBtn")}
              </button>
            )}
            {evApi && (
              <button onClick={askAiVerify}
                className="text-xs px-3 py-1 rounded-lg text-white font-bold shrink-0 hover:opacity-90"
                style={{ backgroundColor: "#dc2626" }} data-testid="rm-ai-verify">
                🔍 {t("rm.aiVerify")}
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
            <span className="flex-1 min-w-[8px]" />
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
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-lg border bg-white" style={{ borderColor: tk.borderLight }}>
                      <div className="grid gap-1 text-[9px] font-bold text-stone-400 px-2 py-1 sticky top-0 bg-white border-b" style={{ gridTemplateColumns: "2.1fr 1.4fr 0.8fr 0.6fr 0.7fr", borderColor: tk.borderLight }}>
                        <span>{t("rm.apiColApi")}</span><span>{t("rm.apiColName")}</span><span>Unit Test</span><span>E2E</span><span>SG</span><span>{t("rm.ev.reviewCol")}</span>
                      </div>
                      {(apiStatus.apis || []).map((a: any, i: number) => (
                        <div key={i} className="grid gap-1 items-center px-2 py-1 text-[10px] hover:bg-stone-50" style={{ gridTemplateColumns: "2.1fr 1.4fr 0.8fr 0.6fr 0.7fr" }}>
                          <span className="font-mono font-bold text-stone-700 truncate" title={a.entry}>{a.entry}</span>
                          <span className="text-stone-500 truncate" title={a.name}>{a.name}</span>
                          <span className={`font-mono font-bold ${(a.testCount ?? a.tests?.length ?? 0) > 0 ? "text-green-600" : "text-red-500"}`} title={(a.tests || []).join("\n") || t("rm.ev.noTest")}>{(a.testCount ?? a.tests?.length ?? 0) > 0 ? `✓${a.testCount ?? a.tests.length}` : "✗"}</span>
                          <span className={`font-mono font-bold ${a.e2eCovered ? "text-green-600" : "text-stone-300"}`}>{a.e2eCovered ? "✓" : "—"}</span>
                          <span className={`font-mono font-bold ${a.sg?.ok ? ((a.sg.total ?? 0) > 0 ? "text-amber-600" : "text-green-600") : "text-red-500"}`} title={a.sg?.reason || `${a.sg?.total ?? 0} findings（high ${a.sg?.high ?? 0}）`}>{a.sg ? (a.sg.ok ? ((a.sg.total ?? 0) > 0 ? `⚠${a.sg.total}` : "✓0") : `✗${a.sg.high}hi`) : "—"}</span>
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

                {/* ⚖️ Evidence Matrix（2026-11-07 Fleming v3：API-first，按鈕才載入；窗口 = 下拉選的 baseline commit 之後的 change）*/}
                {evApi && (
                  <div className="px-4 py-3 border-t" style={{ borderColor: tk.borderLight }} data-testid="rm-evidence-matrix">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-xs font-bold text-stone-700">⚖️ {t("rm.ev.title")}</span>
                      <span className="text-[10px] text-stone-400">{evApi.anchor === "all" ? t("rm.ev.sinceHead") : `${evApi.anchor} · ${evApi.commitsInWindow} commits`}</span>
                      {onOpenReviewBoard && <button type="button" onClick={onOpenReviewBoard} className="text-[10px] px-2 py-0.5 rounded-full border font-bold text-violet-600 hover:bg-violet-50" style={{ borderColor: "#ddd6fe" }} data-testid="rm-open-review-board">{t("rm.ev.openBoard")} →</button>}
                      <span className="ml-auto flex gap-1.5 text-[10px] font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 font-bold">API {evApi.summary.changedApis}</span>
                        <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-bold">Tests ✓{evApi.summary.withTests}</span>
                        <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-bold">E2E ✓{evApi.summary.e2eCovered}</span>
                        <span className={`px-1.5 py-0.5 rounded font-bold ${evApi.summary.sgHigh > 0 ? "bg-red-50 text-red-600" : "bg-stone-100 text-stone-500"}`}>SG ✗{evApi.summary.sgHigh}</span>
                        <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 font-bold">🏛 {evApi.summary.withReview}</span>
                      </span>
                    </div>
                    <div className="grid gap-1 text-[9px] font-bold text-stone-400 px-2 pb-1" style={{ gridTemplateColumns: "1.9fr 1.3fr 0.7fr 0.6fr 0.7fr 1.1fr" }}>
                      <span>{t("rm.apiColApi")}</span><span>{t("rm.apiColName")}</span><span>Unit Test</span><span>E2E</span><span>SG</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {evApi.apis.map((a: any, i: number) => {
                        const risky = !a.tests.length && !a.e2eCovered;
                        return (
                          <div key={i} className="grid gap-1 items-center px-2 py-1.5 rounded-lg hover:bg-stone-50 text-[10px]" style={{ gridTemplateColumns: "1.9fr 1.3fr 0.7fr 0.6fr 0.7fr 1.1fr", background: risky ? "#fff7ed" : undefined }}>
                            <span className="font-mono font-bold text-stone-700 truncate" title={`${a.entry}\n${(a.files || []).join("\n")}`}>{a.entry}</span>
                            <span className="text-stone-500 truncate" title={a.name}>{a.name || "—"}</span>
                            <span className={`font-mono font-bold ${a.tests.length ? "text-green-600" : "text-red-500"}`} title={(a.tests || []).join("\n") || t("rm.ev.noTest")}>{a.tests.length ? `✓${a.tests.length}` : "✗"}</span>
                            <span className={`font-mono font-bold ${a.e2eCovered ? "text-green-600" : "text-stone-300"}`}>{a.e2eCovered ? "✓" : "—"}</span>
                            <span className={`font-mono font-bold ${a.sg.ok ? ((a.sg.total ?? 0) > 0 ? "text-amber-600" : "text-green-600") : "text-red-500"}`} title={a.sg.reason || `${a.sg.total ?? 0} findings（high ${a.sg.high ?? 0}）@ ${evApi.summary.sgScannedAt || "—"}`}>{a.sg.ok ? ((a.sg.total ?? 0) > 0 ? `⚠${a.sg.total}` : "✓0") : `✗${a.sg.high}hi`}</span>
                            <span className={`font-mono font-bold ${a.reviewCount ? "text-green-600" : "text-stone-300"}`} title={(a.reviews || []).map((r: any) => `${String(r.at || "").slice(0, 16)} ${r.decision || ""}`).join("\n") || t("rm.ev.noReview")}>{a.reviewCount ? `✓${a.reviewCount}（${String(a.latestReviewAt || "").slice(5, 10)}）` : "✗"}</span>
                          </div>
                        );
                      })}
                    </div>
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
          <div className="p-5" />
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
