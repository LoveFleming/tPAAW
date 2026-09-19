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

interface ReadinessFeature {
  id: string; name: string; changedFiles: string[]; changeCount: number;
  apis: string[]; apiImpact: boolean; tests: { file: string; kind?: string | null }[];
  hasTests: boolean; knowledgeGaps: string[]; recentSubjects: string[];
}
interface Readiness {
  releaseId: string; since: string; sinceRelease: { id: string; releasedAt: string; title: string } | null;
  firstRelease: boolean;
  commits: { count: number; authors: string[]; subjects: string[] };
  changedFiles: { file: string; changeCount: number }[];
  changedFeatures: ReadinessFeature[];
  changedApis: { method: string; path: string; file: string; featureIds: string[] }[];
  tests: { totalTestFiles?: number | null; changedFeaturesWithTests: number; changedFeaturesTotal: number };
  lastTestRun: {
    finishedAt: string; status: string; includeE2e: boolean; durationMs: number;
    summary: { passed: number; failed: number; skipped: number; total: number };
    byKind: Record<string, { passed: number; failed: number; skipped: number; files: number }>;
    stale: boolean; staleCommits: number;
  } | null;
  gates: { overall?: string; gates?: { gate: string; status: string; detail?: string; required?: boolean }[] } | null;
  openItems: number; risk: string; riskReasons: string[]; ready: boolean;
}

const RISK_COLORS: Record<string, string> = { LOW: "#16a34a", MEDIUM: "#d97706", HIGH: "#dc2626" };

export default function ReleaseManagerPanel({ rootPath, theme: tk, onOpenEMDashboard }: Props) {
  const { t } = useI18n();
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [initialized, setInitialized] = useState<boolean | null>(null); // null = loading
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [qd, setQd] = useState<QualityDebt | null>(null);
  const [retrofitting, setRetrofitting] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [testing, setTesting] = useState(false);
  const [includeE2e, setIncludeE2e] = useState(false);
  const chatRef = useRef<AgentSideChatHandle>(null);

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

  // 整頁刷新（2026-09-19 Fleming）：現況報告 + RR 清單 + 品質債 + 歷史一次重讀；RR 用 key remount 重抓
  const [rrRefreshKey, setRrRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setRrRefreshKey((k) => k + 1);
    try { await Promise.all([refresh(), fetchReadiness()]); } catch {}
    setRefreshing(false);
  }, [refresh, fetchReadiness]);

  // ▶ 執行測試：POST 背景跑 → 輪詢到結束 → 重抓 readiness（真實數字）
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

  const askBoss = (topic: string) => {
    const ev = readinessEvidence();
    if (!ev) return;
    const Q: Record<string, string> = {
      risk: `老闆固定問題：「這次最大的風險是什麼？最壞情況？」\n請基於證據回答，並具體指出最壞情況下哪些功能會受影響、多快能察覺。`,
      rollback: `老闆固定問題：「Rollback plan 是什麼？」\n請基於 changed features/APIs 說明：revert 哪些 commit、有沒有資料遷移問題、回滾需要多久。`,
      impact: `老闆固定問題：「影響範圍？」\n請基於 changed features/APIs 列出：影響哪些功能、哪些 API 變了（breaking?）、哪些用戶流程會經過。`,
      tests: `老闆固定問題：「測試涵蓋了什麼？沒測到什麼？」\n請誠實指出：changed features 有沒有測試、測了什麼層級、最該補但來不及補的是什麼、建議上線後先手動驗什麼。`,
      why: `老闆固定問題：「為什麼現在要上？不上會怎樣？」\n請從這批 changed features 的價值與風險累積角度回答。`,
    };
    chatRef.current?.send(`Release 就緒證據：\n\n${ev}\n\n${Q[topic]}`);
  };

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
            <span className="flex-1" />
            <button onClick={refreshAll} disabled={refreshing}
              title={t("rm.refreshAll")}
              className="text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors disabled:opacity-40"
              style={{ borderColor: tk.borderLight }}>
              {refreshing ? "⏳" : "↻"} {t("rm.refreshAll")}
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
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: `1px solid ${tk.borderLight}`, background: readiness.ready ? "#f0fdf4" : "#fff7ed" }}>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-stone-800 flex items-center gap-2">
                    📈 {t("rm.reportTitle")} #{readiness.releaseId}
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded font-bold"
                      style={{ color: readiness.ready ? "#16a34a" : "#d97706", backgroundColor: readiness.ready ? "#dcfce7" : "#ffedd5" }}>
                      {readiness.ready ? t("rm.ready") : t("rm.notReady")}
                    </span>
                  </div>
                  <div className="text-[10px] text-stone-400 mt-0.5" data-testid="rm-readiness-baseline">
                    {readiness.firstRelease
                      ? t("rm.firstRelease")
                      : `${t("rm.since")} ${readiness.sinceRelease?.releasedAt?.slice(0, 16).replace("T", " ")} (${readiness.sinceRelease?.id})`}
                  </div>
                </div>
                <button onClick={generateReport}
                  className="ml-auto text-xs px-3 py-1.5 rounded-lg text-white font-bold shrink-0 hover:opacity-90"
                  style={{ backgroundColor: "#7c3aed" }} data-testid="rm-gen-report">
                  📋 {t("rm.genReport")}
                </button>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 md:grid-cols-6 divide-x" style={{ borderColor: tk.borderLight }} data-testid="rm-readiness-stats">
                {([
                  [t("rm.stFeatures"), String(readiness.changedFeatures.length), "#0369a1"],
                  [t("rm.stApis"), String(readiness.changedApis.length), "#0369a1"],
                  [t("rm.stFiles"), String(readiness.changedFiles.length), "#57534e"],
                  [t("rm.stCommits"), String(readiness.commits.count), "#57534e"],
                  [t("rm.stOpen"), String(readiness.openItems), readiness.openItems > 0 ? "#d97706" : "#16a34a"],
                  [t("rm.stRisk"), readiness.risk, RISK_COLORS[readiness.risk] || "#57534e"],
                ] as [string, string, string][]).map(([label, val, color]) => (
                  <div key={label} className="px-3 py-2 text-center" style={{ borderColor: tk.borderLight }}>
                    <div className="text-[9px] text-stone-400 font-bold">{label}</div>
                    <div className="text-base font-bold font-mono" style={{ color }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Tests + Gates 一行（含真實執行數字）*/}
              <div className="px-4 py-2 flex items-center gap-3 flex-wrap text-[11px]" style={{ borderBottom: `1px solid ${tk.borderLight}`, background: "#fafaf9" }}>
                <span className="font-bold text-stone-500">🧪 {t("rm.testsLine")}</span>
                {/* 真實執行數字（.paaw/test-runs/last.json — 程式跑的）*/}
                {readiness.lastTestRun ? (
                  <span className="flex items-center gap-2 flex-wrap" data-testid="rm-test-run-real">
                    {Object.entries(readiness.lastTestRun.byKind).map(([kind, v]) => (
                      <span key={kind} className={`font-mono px-1.5 py-0.5 rounded ${v.failed > 0 ? "bg-red-50 text-red-600 font-bold" : "bg-green-50 text-green-700"}`}>
                        {kind} {v.passed}✓{v.failed > 0 ? ` ${v.failed}✗` : ""}
                      </span>
                    ))}
                    {!readiness.lastTestRun.includeE2e && <span className="font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-400">e2e —</span>}
                    <span className={`text-[10px] ${readiness.lastTestRun.stale ? "text-amber-600 font-bold" : "text-stone-400"}`} title={readiness.lastTestRun.stale ? `${readiness.lastTestRun.staleCommits} commits since last run` : ""}>
                      {readiness.lastTestRun.stale ? `⏰ ${readiness.lastTestRun.staleCommits}c` : `⏱ ${Math.round(readiness.lastTestRun.durationMs / 1000)}s`}
                    </span>
                  </span>
                ) : (
                  <span className="text-stone-400 italic">{t("rm.noTestRun")}</span>
                )}
                <button onClick={runTests} disabled={testing}
                  className="text-[10px] px-2 py-0.5 rounded-full border font-bold disabled:opacity-50 hover:bg-stone-100 flex items-center gap-1"
                  style={{ borderColor: testing ? tk.borderLight : "#0369a1", color: testing ? "#a8a29e" : "#0369a1" }}
                  data-testid="rm-run-tests">
                  {testing ? <span className="animate-spin inline-block w-2.5 h-2.5 border-[1.5px] border-current border-t-transparent rounded-full" /> : "▶"} {testing ? t("rm.testing") : t("rm.runTests")}
                </button>
                <label className="flex items-center gap-1 text-[10px] text-stone-400 cursor-pointer select-none" data-testid="rm-e2e-toggle">
                  <input type="checkbox" checked={includeE2e} onChange={e => setIncludeE2e(e.target.checked)} className="accent-sky-600" />
                  {t("rm.includeE2e")}
                </label>
                <span className={readiness.tests.changedFeaturesTotal === 0 ? "text-stone-400" : readiness.tests.changedFeaturesWithTests === readiness.tests.changedFeaturesTotal ? "text-green-600 font-bold" : "text-amber-600 font-bold"}>
                  {t("rm.featureTests")} {readiness.tests.changedFeaturesWithTests}/{readiness.tests.changedFeaturesTotal}
                </span>
                {(readiness.gates?.gates || []).slice(0, 4).map(g => (
                  <span key={g.gate} className={`font-mono ${g.status === "pass" ? "text-green-600" : g.status === "blocked" || g.status === "fail" ? "text-red-500 font-bold" : "text-stone-400"}`}>
                    {g.gate} {g.status === "pass" ? "✓" : g.status === "blocked" || g.status === "fail" ? "✗" : "…"}
                  </span>
                ))}
                {readiness.riskReasons.length > 0 && (
                  <span className="text-[10px] text-amber-600 truncate" title={readiness.riskReasons.join("; ")}>{t("rm.riskWhy")}: {readiness.riskReasons.join("; ")}</span>
                )}
              </div>

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

            {/* 老闆固定問題快捷鍵 */}
            <div className="flex gap-1.5 flex-wrap mt-2" data-testid="rm-boss-questions">
              {([["risk", "🎲", t("rm.bqRisk")], ["rollback", "↩️", t("rm.bqRollback")], ["impact", "🎯", t("rm.bqImpact")], ["tests", "🧪", t("rm.bqTests")], ["why", "❓", t("rm.bqWhy")]] as [string, string, string][]).map(([k, icon, label]) => (
                <button key={k} onClick={() => askBoss(k)}
                  className="text-[10px] px-2 py-1 rounded-full border bg-white hover:bg-stone-100 text-stone-600 font-medium"
                  style={{ borderColor: tk.borderLight }} data-testid={`rm-boss-${k}`}>
                  {icon} {label}
                </button>
              ))}
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
            {/* Release Requests — 正式批次放行（v2 2026-09-18；v3：AI 建議 verdict）*/}
            <ReleaseRequests
              key={rrRefreshKey}
              rootPath={rootPath}
              theme={{ borderLight: tk.borderLight, accent: tk.accent, accentHover: tk.accentHover || tk.accent }}
              notify={(ok, text) => { setToast({ ok, text }); setTimeout(() => setToast(null), 6000); }}
              chatRef={chatRef}
            />

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
      <div className="w-[340px] shrink-0 hidden md:block">
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
