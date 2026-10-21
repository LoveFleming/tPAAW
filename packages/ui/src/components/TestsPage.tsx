/**
 * TestsPage — 🧪 Tests 獨立頁（宮殿 + 神）
 *
 * 左宮殿（三區）：
 *   📊 統計卡 — 總測試檔 / kind 分佈（unit/integration/e2e）/ coverage rate
 *   🔗 對照表 — testToCode：test file ↔ production file（testedFunctions + kind + matchType）
 *   🕳️ 缺口 — coverageGaps：沒有測試的 production 檔（按函數數排序）
 *
 * 右神：🧪 Tester AI（coding.tester）— 每區「問 AI」帶證據注入
 */

import React, { useEffect, useMemo, useRef, useState, forwardRef } from "react";
import { useI18n } from "../i18n";
import { useTheme } from "../theme";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";
import { useColResize, ColResizer } from "./ColResizer"; // 2026-10-09：side chat 左右 splitter
import { useRuModel } from "./useRuModel";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4097";

const KIND_COLORS: Record<string, string> = {
  unit: "#16a34a", integration: "#2563eb", e2e: "#9333ea", contract: "#d97706",
};

interface TestMatch { productionFile: string; matchType: string; testedFunctions: string[]; confidence?: string }
interface TestToCodeEntry { testFile: string; testType?: string; functionCount?: number; matches: TestMatch[] }
interface GapEntry { file: string; functionCount?: number; exportCount?: number }
interface DetailData {
  summary?: {
    totalTestFiles?: number; byType?: Record<string, number>; totalMappings?: number;
    coverageGapFiles?: number; estimatedCoverageRate?: string; featureTestCoverage?: number;
    testReports?: {
      found: number;
      reports: { runner: string; kind: string; at: string | null; total?: number | null; passed?: number | null; failed?: number | null; skipped?: number | null; totalLinePct?: number | null }[];
      run?: { runner: string; kind: string; at: string | null; status?: string | null; total?: number | null; passed?: number | null; failed?: number | null; skipped?: number | null; durationMs?: number | null; id?: string | null; headSha?: string | null; commands?: string[] | null; includeE2e?: boolean | null; byKind?: Record<string, { passed: number; failed: number; skipped: number; files: number }> | null }[];
      coverage: { runner: string; at: string | null; totalLinePct?: number | null }[];
      e2e: { runner: string; at: string | null; total?: number | null; passed?: number | null; failed?: number | null }[];
      unit: { runner: string; at: string | null; total?: number | null; passed?: number | null; failed?: number | null }[];
    } | null;
  };
  testToCode?: TestToCodeEntry[];
  coverageGaps?: GapEntry[];
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

interface Props { rootPath: string; onOpenFile?: (absPath: string) => void; refreshKey?: number }

function TestsPageInner({ rootPath, onOpenFile, refreshKey }: Props, ref: React.Ref<AgentSideChatHandle | null>) {
  const { t } = useI18n();
  const themeCtx = useTheme();
  const borderLight = "#f0f0f0";
  const accentText = themeCtx?.info?.accentText || "#0369a1";

  const [data, setData] = useState<DetailData | null>(null);
  const ruModel = useRuModel(rootPath);
  const [loading, setLoading] = useState(false);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(true);
  useEffect(() => { autoRefreshRef.current = autoRefresh; }, [autoRefresh]);
  const [kindFilter, setKindFilter] = useState<string>("__all__");
  const [expanded, setExpanded] = useState<string | null>(null); // testFile
  const chatRef = useRef<AgentSideChatHandle>(null);
  // 2026-10-09 Fleming：Tester side chat 左右 splitter + 對話持久化 + model selector（跟 QA browser 同款）
  const testerPane = useColResize(340, 260, 640);
  React.useImperativeHandle(ref, () => ({
    send: (text: string) => { chatRef.current?.send(text); },
    addFiles: (files: File[]) => { chatRef.current?.addFiles(files); },
    setText: (text: string) => { chatRef.current?.setText(text); },
  }));

  const fetchDetail = React.useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/test-intelligence?path=${encodeURIComponent(rootPath)}&detail=1`);
      const d = await res.json();
      if (d && !d.error) { setData(d); setLastAt(Date.now()); }
    } catch { /* keep old */ } finally { setLoading(false); }
  }, [rootPath, refreshKey]); // 2026-09-04：CU 完成後重抓

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // 2026-10-11 Fleming：不用切分頁 — 視窗 focus + 每 30s 自動重抓（只在頁面可見時）
  useEffect(() => {
    const onFocus = () => { if (autoRefreshRef.current) fetchDetail(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchDetail]);
  useEffect(() => {
    const id = setInterval(() => {
      if (autoRefreshRef.current && document.visibilityState === "visible") fetchDetail();
    }, 30000);
    return () => clearInterval(id);
  }, [fetchDetail]);

  const byType = data?.summary?.byType || {};
  const tr = data?.summary?.testReports || null;
  // 真實 coverage（工具 report）— 找不到 = null（誠實顯示無）
  const covReport = tr?.coverage?.[0] || null;
  const realCov = covReport?.totalLinePct ?? null;
  const realCovSrc = covReport?.runner || null;
  const realCovAt = covReport?.at || null;
  // 2026-10-21 Fleming：真實執行結果 per-kind（UT / E2E）— 來自 .paaw/test-runs/last.json 的 run report
  const lastRun = tr?.run?.[0] || null;
  const ut = lastRun?.byKind?.unit || lastRun?.byKind?.mixed || null;
  const e2e = lastRun?.byKind?.e2e || null;
  const kindChips = useMemo(() => {
    const entries = Object.entries(byType).filter(([, n]) => (n || 0) > 0);
    return entries.sort((a, b) => b[1] - a[1]);
  }, [byType]);

  const rows = useMemo(() => {
    const list = data?.testToCode || [];
    if (kindFilter === "__all__") return list;
    return list.filter(e => (e.testType || "unit") === kindFilter);
  }, [data, kindFilter]);

  // ── feature 分組：test 的 matches 打到 feature 的 files → 歸該 feature（多歸屬誠實顯示）──
  const testGroups = useMemo(() => {
    const feats = (ruModel?.features || []).map(f => ({ id: f.id, name: f.name, files: new Set(f.files || []) }));
    const byFeature = new Map<string, TestToCodeEntry[]>();
    const others: TestToCodeEntry[] = [];
    for (const e of rows) {
      const hit = feats.filter(f => (e.matches || []).some(m => f.files.has(m.productionFile)));
      if (hit.length === 0) others.push(e);
      else hit.forEach(f => {
        if (!byFeature.has(f.id)) byFeature.set(f.id, []);
        byFeature.get(f.id)!.push(e);
      });
    }
    const groups = [...byFeature.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, entries]) => ({ key: id, name: feats.find(f => f.id === id)?.name || id, entries }));
    if (others.length) groups.push({ key: "__others__", name: "", entries: others });
    return groups;
  }, [rows, ruModel]);

  const featuresWithTests = testGroups.filter(g => g.key !== "__others__").length;
  const [openTestGroup, setOpenTestGroup] = useState<Record<string, boolean>>({});

  const askGaps = () => {
    const gaps = (data?.coverageGaps || []).slice(0, 20)
      .map(g => `${g.file}（${g.functionCount ?? "?"} 函數）`).join("\n");
    chatRef.current?.send(
      `測試缺口分析。以下是沒有測試的 production 檔案（依函數數排序）：\n${gaps}\n\n` +
      `請以測試工程師觀點：1) 挑出最該優先補測的前 5 個（考慮風險 vs 成本）2) 每個建議測什麼情境 3) 排一個補測順序`
    );
  };

  const askMapping = (e: TestToCodeEntry) => {
    const lines = e.matches.map(m => `→ ${m.productionFile} [${m.matchType}${m.confidence ? "/" + m.confidence : ""}] 測到：${m.testedFunctions.join(", ") || "（無交集）"}`).join("\n");
    chatRef.current?.send(
      `測試對照檢查：${e.testFile}（${e.testType || "unit"}）\n${lines}\n\n` +
      `這個 mapping 合理嗎？有沒有「測了但沒測到重點」或誤配的問題？建議補哪些 case？`
    );
  };

  if (!rootPath) {
    return <div className="flex items-center justify-center h-full text-xs text-stone-400">{t("ruTree.noProject")}</div>;
  }

  return (
    <div className="flex-1 flex min-w-0 overflow-hidden" data-testid="tests-page">
      {/* 左：宮殿 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-4 space-y-4">
        {/* 工具列（2026-10-11 Fleming：手動刷新 + 自動刷新開關 + 更新時間） */}
        <div className="flex items-center gap-2 flex-wrap" data-testid="tests-toolbar-refresh">
          <div className="text-sm font-bold text-stone-600">{t("tests.title")}</div>
          <button
            onClick={() => fetchDetail()}
            disabled={loading}
            className="px-2.5 py-1 rounded-lg text-xs font-medium border bg-white hover:bg-stone-50 disabled:opacity-50"
            style={{ borderColor: borderLight, color: accentText }}
          >
            🔄 {loading ? t("common.loading") : t("tests.refresh")}
          </button>
          <label className="text-[11px] text-stone-400 flex items-center gap-1 select-none cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            {t("tests.autoRefresh")}
          </label>
          {lastAt && <span className="text-[11px] text-stone-400 ml-auto">{t("tests.updatedAt")} {new Date(lastAt).toLocaleTimeString("zh-TW", { hour12: false })}</span>}
        </div>
        {/* 統計卡（2026-10-21 Fleming：一眼看清 RU 測試寫得如何 — UT 執行 / E2E / 行覆蓋率 / 缺口 / features）*/}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="tests-stats">
          {/* 單元測試（真實執行）*/}
          <div className={`px-3 py-2 rounded-lg border ${ut ? (ut.failed > 0 ? "border-red-200 bg-red-50/40" : "border-green-200 bg-green-50/40") : ""}`} style={{ borderColor: ut ? undefined : borderLight }} data-testid="tests-ut-card">
            <div className="text-xs text-stone-400 font-medium">{t("tests.utRun")}</div>
            {ut ? (
              <>
                <div className={`text-lg font-bold ${ut.failed > 0 ? "text-red-600" : "text-green-700"}`}>{ut.passed}<span className="text-sm">✓</span>{ut.failed > 0 && <span className="text-sm text-red-500"> {ut.failed}✗</span>}</div>
                <div className="text-[9px] text-stone-400 truncate">{ut.files ?? "?"} {t("tests.filesShort")}{ut.skipped ? ` · ⏭${ut.skipped}` : ""}</div>
              </>
            ) : <div className="text-lg font-bold text-stone-400">{t("tests.notRunShort")}</div>}
          </div>
          {/* E2E（真實執行）*/}
          <div className={`px-3 py-2 rounded-lg border ${e2e ? (e2e.failed > 0 ? "border-red-200 bg-red-50/40" : "border-green-200 bg-green-50/40") : ""}`} style={{ borderColor: e2e ? undefined : borderLight }} data-testid="tests-e2e-card">
            <div className="text-xs text-stone-400 font-medium">{t("tests.e2eRun")}</div>
            {e2e ? (
              <>
                <div className={`text-lg font-bold ${e2e.failed > 0 ? "text-red-600" : "text-green-700"}`}>{e2e.passed}<span className="text-sm">✓</span>{e2e.failed > 0 && <span className="text-sm text-red-500"> {e2e.failed}✗</span>}</div>
                <div className="text-[9px] text-stone-400 truncate">{e2e.files ?? "?"} {t("tests.filesShort")}</div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold text-stone-400">{lastRun && !lastRun.includeE2e ? t("tests.e2eNotRun") : t("tests.notRunShort")}</div>
                <div className="text-[9px] text-stone-400 truncate" title={t("tests.e2eNotRunTip")}>{t("tests.e2eNotRunTipShort")}</div>
              </>
            )}
          </div>
          {/* 行覆蓋率（真實工具 report）*/}
          <div className="px-3 py-2 rounded-lg border" style={{ borderColor: borderLight }} data-testid="tests-coverage-card">
            <div className="text-xs text-stone-400 font-medium">{t("tests.coverageLine")}</div>
            {realCov !== null ? (
              <>
                <div className={`text-lg font-bold ${realCov >= 80 ? "text-green-700" : realCov >= 50 ? "text-amber-600" : "text-red-600"}`}>{realCov}%</div>
                <div className="text-[9px] text-stone-400 truncate" title={realCovSrc || ""}>📊 {realCovSrc} · {realCovAt?.slice(5, 16).replace("T", " ")}</div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold text-stone-400" title={t("tests.notMeasuredTip")}>{t("tests.notMeasured")}</div>
                <div className="text-[9px] text-stone-400 truncate" title={t("tests.notMeasuredTip")}>{t("tests.notMeasuredTipShort")}</div>
              </>
            )}
          </div>
          {/* 測試檔數（含 kind 分佈）*/}
          <div className="px-3 py-2 rounded-lg border" style={{ borderColor: borderLight }}>
            <div className="text-xs text-stone-400 font-medium">{t("tests.totalFiles")}</div>
            <div className="text-lg font-bold text-stone-700">{data?.summary?.totalTestFiles ?? "—"}</div>
            <div className="text-[9px] text-stone-400 truncate">{kindChips.map(([k, n]) => `${k} ${n}`).join(" · ") || "—"}</div>
          </div>
          {/* 缺口 */}
          <div className="px-3 py-2 rounded-lg border" style={{ borderColor: borderLight, background: (data?.summary?.coverageGapFiles || 0) > 0 ? "#fffbeb" : undefined }} data-testid="tests-gap-card">
            <div className="text-xs text-stone-400 font-medium">{t("tests.gapFiles")}</div>
            <div className={`text-lg font-bold ${(data?.summary?.coverageGapFiles || 0) > 0 ? "text-amber-600" : "text-stone-700"}`}>{data?.summary?.coverageGapFiles ?? "—"}</div>
          </div>
          {/* features */}
          <div className="px-3 py-2 rounded-lg border" style={{ borderColor: borderLight }}>
            <div className="text-xs text-stone-400 font-medium">{t("tests.featuresWithTests")}</div>
            <div className="text-lg font-bold text-stone-700">{featuresWithTests}<span className="text-xs text-stone-400 font-normal">/{(ruModel?.features || []).length || "—"}</span></div>
          </div>
        </div>
        {/* 檔案對映估算（誠實標示 — 非行覆蓋率，2026-10-21）*/}
        {data?.summary?.estimatedCoverageRate && (
          <div className="text-[10px] text-stone-400 -mt-1" data-testid="tests-estimate" title={t("tests.estTip")}>
            ℹ️ {t("tests.estLabel")} <span className="font-mono text-stone-500">{data.summary.estimatedCoverageRate}</span> · {t("tests.estTip")}
          </div>
        )}

        {/* 📊 真實工具 report（2026-10-10 Fleming：找沒有就顯示沒有，不亂編）*/}
        <div className="rounded-lg border" style={{ borderColor: borderLight }} data-testid="tests-reports">
          <div className="px-3 py-1.5 text-xs font-bold text-stone-400 bg-stone-50 flex items-center" style={{ borderBottom: `1px solid ${borderLight}` }}>
            📊 {t("tests.realReports")}
            {tr && tr.found > 0 && <span className="ml-auto text-[10px] text-green-600">{t("tests.foundN").replace("{n}", String(tr.found))}</span>}
          </div>
          {tr && tr.found > 0 ? (
            <div>
              {/* 🧾 最近一次 PAAW 測試執行（2026-10-11：真實跑過的結果優先顯示）*/}
              {tr.run?.[0] && (() => {
                const r = tr.run![0];
                const ok = (r.status || "pass") === "pass";
                return (
                  <div className="px-3 py-2 flex items-center gap-2 text-xs flex-wrap"
                    style={{ borderBottom: `1px solid ${borderLight}`, background: ok ? "#f0fdf4" : "#fef2f2" }}
                    data-testid="tests-last-run">
                    <span className="font-bold shrink-0" style={{ color: ok ? "#15803d" : "#b91c1c" }}>
                      {ok ? "✅" : "❌"} {t("tests.lastRun")}
                    </span>
                    {r.id && <span className="font-mono text-[10px] text-stone-500 shrink-0">{r.id}</span>}
                    <span className="font-mono shrink-0">{r.passed ?? "?"}/{r.total ?? "?"} {t("tests.passed")}</span>
                    {r.failed != null && r.failed > 0 && <span className="font-bold text-red-500 shrink-0">✗ {r.failed}</span>}
                    {r.skipped ? <span className="text-stone-400 shrink-0">⏭ {r.skipped}</span> : null}
                    {r.durationMs != null && <span className="text-stone-500 shrink-0">{(r.durationMs / 1000).toFixed(1)}s</span>}
                    {r.headSha && <span className="font-mono text-[10px] text-stone-400 shrink-0">{r.headSha}</span>}
                    {r.commands?.length ? <span className="font-mono text-[10px] text-stone-400 truncate">{r.commands.join(" · ")}</span> : null}
                    {r.at && <span className="ml-auto text-[10px] text-stone-400 shrink-0" title={r.at}>{r.at.slice(5, 16).replace("T", " ")}</span>}
                  </div>
                );
              })()}
            <div className="divide-y" style={{ borderColor: borderLight }}>
              {tr.reports.filter(r => r.kind !== "run").map((r, i) => (
                <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                  <span className="font-bold text-stone-700 shrink-0">{r.runner}</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-stone-100 text-stone-500 shrink-0">{r.kind}</span>
                  {r.total != null && <span className="font-mono text-stone-600">{t("tests.testsN").replace("{p}", String(r.passed ?? "?")).replace("{t}", String(r.total))}</span>}
                  {r.failed != null && r.failed > 0 && <span className="font-bold text-red-500">✗ {r.failed}</span>}
                  {r.totalLinePct != null && <span className="font-mono text-green-700">LINE {r.totalLinePct}%</span>}
                  {r.at && <span className="ml-auto text-[10px] text-stone-400 shrink-0">{r.at.slice(5, 16).replace("T", " ")}</span>}
                </div>
              ))}
            </div>
            </div>
          ) : (
            <div className="px-3 py-3 text-xs text-stone-400 text-center" data-testid="tests-reports-empty">
              {t("tests.noRealReport")}
              <div className="text-[10px] mt-0.5 opacity-70">{t("tests.noRealReportHint")}</div>
            </div>
          )}
        </div>

        {/* kind 分佈 chips */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <button onClick={() => setKindFilter("__all__")}
            className={`text-xs px-2 py-1 rounded-full border font-semibold transition-colors ${kindFilter === "__all__" ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}
            data-testid="tests-kind-all">
            {t("tests.allKinds")} · {(data?.testToCode || []).length}
          </button>
          {kindChips.map(([kind, n]) => (
            <button key={kind} onClick={() => setKindFilter(kind)}
              data-testid={`tests-kind-${kind}`}
              className={`text-xs px-2 py-1 rounded-full border font-semibold transition-colors ${kindFilter === kind ? "text-white border-transparent" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}
              style={kindFilter === kind ? { backgroundColor: KIND_COLORS[kind] || "#78716c" } : undefined}>
              {kind} · {n}
            </button>
          ))}
          {loading && <span className="text-xs text-stone-400 animate-pulse">loading…</span>}
        </div>

        {/* 對照表 */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }} data-testid="tests-mapping">
          <div className="px-3 py-1.5 text-xs font-bold text-stone-400 bg-stone-50 flex items-center" style={{ borderBottom: `1px solid ${borderLight}` }}>
            🔗 {t("tests.mappingTitle")} · {rows.length}
          </div>
          {testGroups.map(g => {
            const gOpen = openTestGroup[g.key] !== false;
            const gKinds = [...new Set(g.entries.map(e => e.testType || "unit"))];
            return (
            <div key={g.key}>
              <button onClick={() => setOpenTestGroup(prev => ({ ...prev, [g.key]: !gOpen }))}
                className="w-full px-3 py-1.5 bg-stone-50 hover:bg-stone-100 flex items-center gap-2 text-left"
                style={{ borderBottom: `1px solid ${borderLight}` }} data-testid="tests-group">
                <span className="text-xs">{gOpen ? "▾" : "▸"}</span>
                {g.key === "__others__" ? (
                  <span className="text-xs font-bold text-stone-400">📦 {t("tests.otherGroup")}</span>
                ) : (
                  <>
                    <span className="text-xs font-mono font-bold" style={{ color: accentText }}>{g.key}</span>
                    <span className="text-xs font-bold text-stone-700 truncate">{g.name}</span>
                  </>
                )}
                <span className="text-[10px] text-stone-400 shrink-0">🧪 {g.entries.length}</span>
                <span className="flex gap-1 shrink-0">
                  {gKinds.map(k => <span key={k} className="text-[9px] px-1 py-0.5 rounded text-white font-bold" style={{ backgroundColor: KIND_COLORS[k] || "#78716c" }}>{k}</span>)}
                </span>
              </button>
              {gOpen && g.entries.map(e => {
            const kind = e.testType || "unit";
            const isOpen = expanded === e.testFile;
            return (
              <div key={e.testFile}>
                <button onClick={() => setExpanded(isOpen ? null : e.testFile)}
                  className="w-full text-left px-3 py-1.5 border-b hover:bg-stone-50 flex items-center gap-2"
                  style={{ borderColor: borderLight }} data-testid="tests-row">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0" style={{ backgroundColor: KIND_COLORS[kind] || "#78716c" }}>{kind}</span>
                  <span className="text-xs font-mono text-stone-700 truncate flex-1" title={e.testFile}>{e.testFile}</span>
                  <span className="text-[10px] shrink-0" style={{ color: e.matches.length ? undefined : "#a8a29e" }}>→ {e.matches.length > 0 ? `${e.matches.length} file(s)` : t("tests.unmapped")}</span>
                </button>
                {isOpen && (
                  <div className="px-3 py-2 border-b space-y-1.5" style={{ borderColor: borderLight, background: "#fafaf9" }}>
                    {e.matches.map((m, i) => (
                      <div key={`${m.productionFile}-${i}`} className="flex items-start gap-2 flex-wrap">
                        <button onClick={() => onOpenFile?.(`${rootPath}/${m.productionFile}`)}
                          className="text-xs font-mono hover:underline break-all" style={{ color: accentText }}>
                          📄 {m.productionFile}
                        </button>
                        <span className="text-[10px] text-stone-400">[{m.matchType}{m.confidence ? `/${m.confidence}` : ""}]</span>
                        {m.testedFunctions.length > 0 && (
                          <span className="text-[10px] text-stone-500 font-mono">{m.testedFunctions.map(f => `${f}()`).join(", ")}</span>
                        )}
                      </div>
                    ))}
                    <button onClick={() => askMapping(e)}
                      className="text-xs px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium"
                      data-testid="tests-ask-mapping">
                      💬 {t("tests.askCheckMapping")}
                    </button>
                  </div>
                )}
              </div>
              );
            })}
            </div>
            );
          })}
          {rows.length === 0 && !loading && (
            <div className="px-3 py-6 text-xs text-stone-300 text-center">{t("tests.noTests")}</div>
          )}
        </div>

        {/* 缺口 */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }} data-testid="tests-gaps">
          <div className="px-3 py-1.5 text-xs font-bold text-stone-400 bg-stone-50 flex items-center" style={{ borderBottom: `1px solid ${borderLight}` }}>
            🕳️ {t("tests.gapsTitle")} · {(data?.coverageGaps || []).length}
            <span className="flex-1" />
            {(data?.coverageGaps || []).length > 0 && (
              <button onClick={askGaps} data-testid="tests-ask-gaps"
                className="text-xs px-2 py-0.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium">
                💬 {t("tests.askPrioritize")}
              </button>
            )}
          </div>
          {(data?.coverageGaps || []).slice(0, 40).map(g => (
            <button key={g.file} onClick={() => onOpenFile?.(`${rootPath}/${g.file}`)}
              className="w-full text-left px-3 py-1 border-b hover:bg-stone-50 flex items-center gap-2 last:border-0" style={{ borderColor: borderLight }}>
              <span className="text-xs font-mono text-stone-600 truncate flex-1">{g.file}</span>
              <span className="text-[10px] text-stone-400 font-mono shrink-0">ƒ{g.functionCount ?? 0}</span>
            </button>
          ))}
          {(data?.coverageGaps || []).length === 0 && (
            <div className="px-3 py-4 text-xs text-stone-300 text-center">{t("tests.noGaps")}</div>
          )}
        </div>
      </div>

      {/* 右：神 — Tester AI */}
      {/* 2026-10-09 Fleming：跟 QA browser 同款 — splitter 可拖寬 + 三按鈕（persistCrewId）+ model selector */}
      <ColResizer onDown={testerPane.startDrag} className="hidden xl:block" />
      <div className="shrink-0 border-l hidden xl:flex flex-col" style={{ width: testerPane.width, borderColor: borderLight }}>
        <AgentSideChat
          ref={chatRef}
          agentId="tester"
          agentName={t("tests.testerName")}
          agentEmoji="🧪"
          greeting={t("tests.testerGreeting")}
          cwd={rootPath}
          accent="#16a34a"
          height="100%"
          persistCrewId="coding.tester-side"
          modelFeature="sideChat.tester"
          placeholder={t("tests.testerPlaceholder")}
          suggestions={[
            { label: t("tests.sug1Label"), prompt: t("tests.sug1Prompt") },
            { label: t("tests.sug2Label"), prompt: t("tests.sug2Prompt") },
          ]}
        />
      </div>
    </div>
  );
}

const TestsPage = forwardRef<AgentSideChatHandle | null, Props>(TestsPageInner);
export default TestsPage;
