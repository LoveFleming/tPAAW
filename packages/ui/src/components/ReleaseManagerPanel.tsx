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
  const [showChat, setShowChat] = useState(true); // 2026-11-19 Fleming：side chat 顯示/隱藏開關（跟 Prod Spec 同款）
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

  // ↻ 重新整理按鈕已移除（2026-11-07 Fleming）— readiness 隨各區塊按鈕重抓，不再全頁刷新
  const fetchReadinessNow = fetchReadiness; // 保留給未來用途

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

  // 2026-11-21 Fleming：Release Info 卡 — RR 下拉選單（預設最近一次 release/draft）+ ↻ refresh + 重新產生
  const [rrOptions, setRrOptions] = useState<any[]>([]);   // 全部 RR（最新在前）
  const [selRR, setSelRR] = useState<string>("");          // 選中的 RR id
  const [selDetail, setSelDetail] = useState<any | null>(null); // { releaseInfo, buildStatus, versions }
  const [newRrBusy, setNewRrBusy] = useState(false);
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [riRefreshing, setRiRefreshing] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  // 2026-11-21 Fleming：三份 AI 文件（Prod Spec / DFO / Release Info）狀態 + 決定性檢查
  const [docs, setDocs] = useState<any | null>(null);
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const [matrixFrozen, setMatrixFrozen] = useState<number | null>(null);

  const fetchSelDetail = useCallback(async (rrId: string) => {
    if (!rootPath || !rrId) { setSelDetail(null); return; }
    try {
      const p = (e: string) => `${API_BASE}/api/coding-releases/release-info/${e}?path=${encodeURIComponent(rootPath)}`;
      const [itemR, stR] = await Promise.all([
        fetch(`${p("item")}&rr=${encodeURIComponent(rrId)}`).then(r => r.json()).catch(() => null),
        fetch(`${p("status")}&rr=${encodeURIComponent(rrId)}`).then(r => r.json()).catch(() => null),
      ]);
      setSelDetail({
        releaseInfo: itemR?.release_info || null,
        infoVersion: itemR?.version_of_info || null,
        buildStatus: stR?.status || null,
        building: !!stR?.running,
      });
    } catch { /* 不擋主頁 */ }
  }, [rootPath]);

  const fetchRrOptions = useCallback(async (keepSel = false) => {
    if (!rootPath) return;
    try {
      const d = await fetch(`${API_BASE}/api/coding-releases/requests?path=${encodeURIComponent(rootPath)}`).then(r => r.json());
      const list = (d?.requests || []).map((r: any) => ({
        id: r.id, status: r.status, title: r.title, createdAt: r.createdAt, releaseId: r.releaseId,
        scope: r.scope, shipped: r.status === "released",
      }));
      setRrOptions(list);
      // 預選（Fleming 2026-11-21 定調）：有未定案 draft（產生中/待 Release）→ 選它；否則最近一張 released；否則空
      setSelRR((prev: string) => {
        if (keepSel && list.some((r: any) => r.id === prev)) return prev;
        return (list.find((r: any) => !r.shipped)?.id) || (list.find((r: any) => r.shipped)?.id) || "";
      });
    } catch { /* 不擋主頁 */ }
  }, [rootPath]);

  const fetchDocs = useCallback(async () => {
    if (!rootPath || !selRR) { setDocs(null); return; }
    try {
      const d = await fetch(`${API_BASE}/api/coding-releases/docs?rr=${encodeURIComponent(selRR)}&path=${encodeURIComponent(rootPath)}`).then(r => r.json());
      if (!d?.error) {
        setDocs(d);
        // Release Info 做完 → 直接載入同版號凍結的 Evidence Matrix（2026-11-21 Fleming：矩陣是 release info 的一部分）
        if (d?.docs?.releaseInfo?.status === "done") {
          try {
            const m = await fetch(`${API_BASE}/api/coding-releases/release-info/matrix?rr=${encodeURIComponent(selRR)}&path=${encodeURIComponent(rootPath)}`).then(r => r.json());
            if (m?.ok && m.matrix) { setEvApi(m.matrix); setMatrixFrozen(m.version); }
          } catch {}
        }
      }
    } catch { /* 不擋主頁 */ }
  }, [rootPath, selRR]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);
  // 有文件在跑 → 5s 輪詢
  useEffect(() => {
    const running = docs && Object.values(docs.docs || {}).some((x: any) => x?.status === "running");
    if (!running) return;
    const id = setTimeout(() => { fetchDocs(); if (selRR) fetchSelDetail(selRR); }, 5000);
    return () => clearTimeout(id);
  }, [docs, fetchDocs, selRR, fetchSelDetail]);

  const anyDocRunning = !!(docs && Object.values(docs.docs || {}).some((x: any) => x?.status === "running"));

  const buildAllDocs = async () => {
    if (!rootPath || !selRR || docBusy || anyDocRunning) return;
    if (!window.confirm(`製作 ${selRR} 的 Release Info？\n\n會做：Prod Spec 更新 → DFO 更新 → Release Info（含 Evidence Matrix）\n需要數分鐘，完成後有問題會列出來讓你決定是否重做`)) return;
    setDocBusy("all");
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/release-docs/build-all?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rr: selRR }),
      }).then(r => r.json());
      if (r?.error) setToast({ ok: false, text: String(r.error) });
      else setToast({ ok: true, text: `🚀 開始製作（${selRR}）：Prod Spec + DFO + Release Info + Evidence Matrix` });
      await fetchDocs();
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setDocBusy(null); }
  };

  const rebuildDoc = async (kind: "spec" | "dfo" | "releaseInfo") => {
    if (!rootPath || !selRR || docBusy) return;
    setDocBusy(kind);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/release-docs/rebuild?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ rr: selRR, kind }),
      }).then(r => r.json());
      if (r?.error) setToast({ ok: false, text: String(r.error) });
      else setToast({ ok: true, text: `🔄 ${kind} 開始重做（${selRR}）` });
      await fetchDocs();
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setDocBusy(null); }
  };

  useEffect(() => { fetchRrOptions(); }, [fetchRrOptions]);
  useEffect(() => { if (selRR) fetchSelDetail(selRR); }, [selRR, fetchSelDetail]);
  // build 進行中 → 輪詢（選中那張）
  useEffect(() => {
    if (!selDetail?.building || !selRR) return;
    const id = setTimeout(() => { fetchSelDetail(selRR); fetchRrOptions(true); }, 3000);
    return () => clearTimeout(id);
  }, [selDetail, selRR, fetchSelDetail, fetchRrOptions]);

  const refreshReleaseInfo = async () => {
    setRiRefreshing(true);
    try { await Promise.all([fetchRrOptions(true), selRR ? fetchSelDetail(selRR) : null]); } finally { setRiRefreshing(false); }
  };

  const rebuildInfo = async () => {
    if (!rootPath || !selRR || rebuildBusy) return;
    if (selDetail?.building) return;
    setRebuildBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/requests/${encodeURIComponent(selRR)}/build?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
      }).then(r => r.json());
      if (r.error) { setToast({ ok: false, text: String(r.error) }); return; }
      setToast({ ok: true, text: `🔄 開始重新產生 ${selRR} 的 Release Info（實蹓測試 + 證據 + AI 摘要 → 新版 v${(selDetail?.versions?.length ?? 0) + 1 || 1}）` });
      fetchSelDetail(selRR);
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setRebuildBusy(false); }
  };

  // ✅ Set RR to Close（2026-11-21 Fleming）：只改 status，不卡關；文件有問題先提示，人可照樣關
  const confirmRelease = async () => {
    if (!rootPath || !selRR || releaseBusy) return;
    const ri = selDetail?.releaseInfo;
    const errs = (docs?.verify?.findings || []).filter((f: any) => f.level === "error");
    const warnTxt = errs.length
      ? `\n\n⚠️ 文件檢查有 ${errs.length} 個問題：\n- ${errs.slice(0, 5).map((f: any) => `[${f.doc}] ${f.message}`).join("\n- ")}\n（可先按重做，或照樣關閉）`
      : "";
    if (!window.confirm(`把 ${selRR} 設為 close（release）？\n\n版本 v${ri?.version || "?"} — ${(ri?.summary || "").slice(0, 120)}${warnTxt}`)) return;
    setReleaseBusy(true);
    try {
      const c = await fetch(`${API_BASE}/api/coding-releases/requests/${encodeURIComponent(selRR)}/close?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true, note: `Set to close by human — v${ri?.version || ""}` }),
      }).then(r => r.json());
      if (c.error) { setToast({ ok: false, text: `關閉失敗：${String(c.error).slice(0, 200)}` }); await fetchRrOptions(true); return; }
      setToast({ ok: true, text: `✅ ${c.releaseId || selRR} 已 close（v${ri?.version || "?"}）` });
      await fetchRrOptions(true);
      fetchDocs();
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setReleaseBusy(false); }
  };

  // ↩ Reopen 最新一版：released → reviewing（可重做、可再加功能後重新 close）
  const reopenRR = async () => {
    if (!rootPath || !selRR || releaseBusy) return;
    if (!window.confirm(`Reopen ${selRR}？\n\n會回到 reviewing，可重新產生文件、加功能後再 close（原 REL 記錄保留）`)) return;
    setReleaseBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/requests/${encodeURIComponent(selRR)}/reopen?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "human reopen" }),
      }).then(r => r.json());
      if (r.error) { setToast({ ok: false, text: String(r.error) }); return; }
      setToast({ ok: true, text: `↩ ${selRR} 已 reopen（reviewing）` });
      await fetchRrOptions(true);
      if (selRR) { fetchSelDetail(selRR); fetchDocs(); }
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setReleaseBusy(false); }
  };

  const createNewRR = async () => {
    if (!rootPath || newRrBusy) return;
    setNewRrBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/request?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
      }).then(r => r.json());
      if (r.error) { setToast({ ok: false, text: String(r.error) }); return; }
      setToast({ ok: true, text: `✅ ${r.id} 已建單 — AI 開始產 Release Info（實蹓測試 + 證據快照 + Schema v1.0）` });
      await fetchRrOptions(true);
      setSelRR(r.id); // 跳到新建的這張
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setNewRrBusy(false); }
  };

  // ▶ 執行測試：POST 背景跑 → 輪詢到結束 → 重抓 readiness（真實數字）
    // 2026-11-07 Fleming 大 feature：E2E 測試盤點（deterministic 抽取測試名/URL ↔ API 雙向關聯，孤兒=黑盒缺口）
  const [e2eInv, setE2eInv] = useState<any | null>(null);
  const [e2eInvBusy, setE2eInvBusy] = useState(false);
  const loadE2eInv = async () => {
    if (!rootPath || e2eInvBusy) return;
    setE2eInvBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/e2e-inventory?path=${encodeURIComponent(rootPath)}`).then(r => r.json());
      if (r.ok) setE2eInv(r); else setToast({ ok: false, text: String(r.error || r.detail || "failed") });
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setE2eInvBusy(false); }
  };
    // 2026-11-07 Fleming：Page 盤點（前端 API-first 同款骨架 — route 錨點 + unit/e2e/API 關聯）
  const [pageInv, setPageInv] = useState<any | null>(null);
  const [pageInvBusy, setPageInvBusy] = useState(false);
  const loadPageInv = async () => {
    if (!rootPath || pageInvBusy) return;
    setPageInvBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/page-inventory?path=${encodeURIComponent(rootPath)}`).then(r => r.json());
      if (r.ok) setPageInv(r); else setToast({ ok: false, text: String(r.error || r.detail || "failed") });
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setPageInvBusy(false); }
  };
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
      `● ${a.entry}｜${a.name || ""}｜Tests ${a.tests.length ? `✓${a.tests.length}（${a.tests.join(", ")}）` : "✗ 無"}｜E2E ${a.e2eCovered ? "✓" : "—"}｜SG ${a.sg.ok ? `✓（${a.sg.total} findings）` : `✗${a.sg.high}hi`}｜Review ${a.reviewCount ? `✓${a.reviewCount}（最新 ${String(a.latestReviewAt || "").slice(0, 10)}）` : "✗ 未審"}｜QA ${a.qa?.count ? `${a.qa.latestVerdict === "pass" ? "✓" : a.qa.latestVerdict === "fail" ? "✗fail" : "⚠"}${a.qa.count}（最新 ${String(a.qa.latestAt || "").slice(0, 10)}）` : "✗ 無記錄"}｜檔案 ${a.files.join(", ")}`
    ).join("\n");
    return `Evidence Matrix by API（${anchorDesc}：${evApi.summary.changedApis} APIs changed / tests ✓${evApi.summary.withTests} / e2e ✓${evApi.summary.e2eCovered} / SG high ✗${evApi.summary.sgHigh}）\n\n${rows}`;
  };

  // 2026-11-07 Fleming v5：產生 Review Report 搬進 Evidence Matrix 塊內（跟 api 摘要同款：按鈕 → 結果顯示在表格下方）
  const [reviewReport, setReviewReport] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const generateReport = async () => {
    if (!rootPath || reviewBusy) return;
    const ev = readinessEvidence();
    const mx = matrixEvidenceText();
    if (!ev) return;
    const cmt = baselines.find(b => b.sha === selCommit);
    const anchor = cmt ? `\n報告基準 commit：${cmt.short}（${cmt.subject}，${cmt.at}）\n報告範圍：這個 commit 之後的變更。` : `\n報告基準：目前 HEAD（全部 API，不 by 時間）。`;
    const evidence = `以下是這次 release 的就緒證據（程式產生，deterministic）：\n\n${ev}\n\n${mx || ""}${anchor}`;
    setReviewBusy(true); setReviewReport(null);
    try {
      const r = await fetch(`${API_BASE}/api/coding-releases/review-report?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evidence }),
      }).then(r => r.json());
      if (r.ok) setReviewReport(String(r.report || "")); else setToast({ ok: false, text: String(r.error || "failed") });
    } catch (e: any) { setToast({ ok: false, text: e.message }); }
    finally { setReviewBusy(false); }
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
            <span className="flex-1" />
            <button onClick={() => setShowChat(v => !v)}
              className="text-xs px-2 py-1 rounded-lg border transition-colors shrink-0"
              style={{ borderColor: tk.borderLight || "#e7e5e4", color: tk.accent || "#8b5e3c" }}
              title={t("projectMd.chatToggle")}>💬</button>
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
            {/* ↻ 重新整理按鈕移除（2026-11-07 Fleming）— 各區塊按鈕各自載入，不需全頁刷新 */}
          </div>
          {/* rm.subtitle 拿掉（2026-11-07 Fleming）*/}
        </div>

        {toast && (
          <div className={`mx-5 mt-3 px-3 py-2 rounded-lg text-xs ${toast.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {toast.text}
          </div>
        )}

        {/* ═══ Release Information 進場卡（2026-11-21 Fleming）— 進來就看到最新一版 release 資訊 + 證據 ═══ */}
        <div className="px-5 pt-4" data-testid="rm-release-info">
          <div className="rounded-xl border overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
            <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap border-b bg-stone-50/60" style={{ borderColor: tk.borderLight }}>
              <span className="text-sm font-bold text-stone-800">🚀 {t("rm.ri.title")}</span>
              {/* RR 下拉選單（2026-11-21 Fleming）：預設最近一次 release，可切 draft）*/}
              {rrOptions.length > 0 ? (
                <select value={selRR} onChange={(e) => setSelRR(e.target.value)}
                  className="text-[11px] border rounded-lg px-1.5 py-1 bg-white max-w-[340px] shrink" style={{ borderColor: tk.borderLight }}
                  data-testid="rm-ri-rr-select">
                  {rrOptions.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.shipped ? "🟢" : r.status === "reviewing" ? "🟡" : "⚪"} {r.id} · {r.status}{r.releaseId ? ` · ${r.releaseId}` : ""}
                    </option>
                  ))}
                </select>
              ) : null}
              <span className="flex-1" />
              {/* ↻ refresh（2026-11-21 Fleming 要求）*/}
              <button onClick={refreshReleaseInfo} disabled={riRefreshing}
                className="text-xs px-2 py-1 rounded-lg border transition-colors shrink-0"
                style={{ borderColor: tk.borderLight, color: tk.accent || "#8b5e3c" }}
                title={t("rm.ri.refreshTip")} data-testid="rm-ri-refresh">
                {riRefreshing ? "⏳" : "↻"}
              </button>
              {/* 🔄 重新產生（只在未定案 draft 顯示）*/}
              {selRR && !rrOptions.find(r => r.id === selRR)?.shipped && (
                <button onClick={rebuildInfo} disabled={rebuildBusy || selDetail?.building}
                  className="text-xs px-3 py-1 rounded-lg text-white font-bold hover:opacity-90 disabled:opacity-60 flex items-center gap-1.5"
                  style={{ backgroundColor: "#0369a1" }} data-testid="rm-ri-rebuild" title={t("rm.ri.rebuildTip")}>
                  {(rebuildBusy || selDetail?.building) && <span className="animate-spin inline-block w-3 h-3 border-[1.5px] border-white border-t-transparent rounded-full" />}
                  🔄 {t("rm.ri.rebuildBtn")}
                </button>
              )}
              {/* ✅ Set RR to Close（2026-11-21 Fleming：只改 status，不卡關）*/}
              {(() => {
                const sel = rrOptions.find(r => r.id === selRR);
                if (!sel) return null;
                if (sel.shipped) {
                  return (
                    <button onClick={reopenRR} disabled={releaseBusy}
                      className="text-xs px-3 py-1 rounded-lg text-white font-bold hover:opacity-90 disabled:opacity-60 flex items-center gap-1.5"
                      style={{ backgroundColor: "#7c3aed" }} data-testid="rm-ri-reopen" title="Reopen：回到 reviewing 重做（原 REL 保留）">
                      {releaseBusy && <span className="animate-spin inline-block w-3 h-3 border-[1.5px] border-white border-t-transparent rounded-full" />}
                      ↩ {t("rm.reopenBtn")}
                    </button>
                  );
                }
                return (
                  <button onClick={confirmRelease} disabled={releaseBusy}
                    className="text-xs px-3 py-1 rounded-lg text-white font-bold hover:opacity-90 disabled:opacity-60 flex items-center gap-1.5"
                    style={{ backgroundColor: "#b45309" }} data-testid="rm-ri-release" title="Set RR to Close（只改 status，不卡關）">
                    {releaseBusy && <span className="animate-spin inline-block w-3 h-3 border-[1.5px] border-white border-t-transparent rounded-full" />}
                    ✅ {t("rm.closeBtn")}
                  </button>
                );
              })()}
              {/* 🚀 Create New Release：有未定案 draft（產生中/待確認）= off */}
              {(() => {
                const hasDraft = rrOptions.some(r => !r.shipped);
                return (
                  <button onClick={createNewRR} disabled={newRrBusy || hasDraft}
                    className="text-xs px-3 py-1 rounded-lg text-white font-bold hover:opacity-90 disabled:opacity-60 flex items-center gap-1.5"
                    style={{ backgroundColor: hasDraft ? "#a8a29e" : "#16a34a" }}
                    title={hasDraft ? t("rm.ri.createOffTip") : t("rm.ri.firstBtnTip")} data-testid="rm-ri-new">
                    {newRrBusy && <span className="animate-spin inline-block w-3 h-3 border-[1.5px] border-white border-t-transparent rounded-full" />}
                    🚀 {t("rm.ri.createBtn")}
                  </button>
                );
              })()}
            </div>
            {rrOptions.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-stone-400">{t("rm.ri.empty")}</div>
            ) : (
              <div className="px-4 py-3 space-y-2">
                {/* 選中 RR 狀態列 */}
                {(() => {
                  const rr = rrOptions.find(r => r.id === selRR);
                  if (!rr) return null;
                  return (
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${rr.status === "released" ? "bg-green-100 text-green-700" : rr.status === "reviewing" ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>{rr.status}</span>
                      <span className="text-stone-400 truncate max-w-[380px]" title={rr.title}>{rr.title}</span>
                      {rr.scope && <span className="text-[10px] text-stone-400 font-mono">{rr.scope.commits} commits · {rr.scope.files} files · {rr.scope.tasks} tasks</span>}
                    </div>
                  );
                })()}
                {/* 實體證據 chips：test run + evidence snapshot */}
                <div className="flex gap-2 flex-wrap text-[10px] font-bold">
                  {(() => {
                    const tr = selDetail?.buildStatus?.testRun;
                    if (!tr) return <span className="px-2 py-1 rounded-lg bg-white border text-stone-400" style={{ borderColor: tk.borderLight }}>{t("rm.ri.noTest")}</span>;
                    const s = tr.summary || {};
                    return (
                      <span className={`px-2 py-1 rounded-lg border ${tr.status === "pass" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`} style={{ borderColor: tk.borderLight }}
                        title={`${tr.id} @ ${String(tr.at || "").slice(0, 16)}`}>
                        🧪 {tr.id} {tr.status} · {s.passed ?? "?"}✓ / {s.failed ?? "?"}✗ / {s.skipped ?? "?"}s
                      </span>
                    );
                  })()}
                  {selDetail?.buildStatus?.evidenceSnapshot ? (
                    <span className="px-2 py-1 rounded-lg bg-white border text-teal-700" style={{ borderColor: tk.borderLight }}
                      title={selDetail.buildStatus.evidenceSnapshot.id}>
                      ⚖️ {selDetail.buildStatus.evidenceSnapshot.id}
                    </span>
                  ) : null}
                  {selDetail?.infoVersion && (
                    <span className="px-2 py-1 rounded-lg bg-white border text-stone-500" style={{ borderColor: tk.borderLight }}>
                      📄 info v{selDetail.infoVersion}
                    </span>
                  )}
                </div>
                {/* build 進度 */}
                {selDetail?.building && (
                  <div className="flex items-center gap-2 text-[11px] text-amber-700">
                    <span className="animate-spin inline-block w-3 h-3 border-[1.5px] border-amber-500 border-t-transparent rounded-full" />
                    {t("rm.ri.building")}：{selDetail?.buildStatus?.step}
                  </div>
                )}
                {selDetail?.buildStatus?.error && (
                  <div className="text-[11px] text-red-500">⚠ {selDetail.buildStatus.error}</div>
                )}
                {/* Release Info（Schema v1.0）render：version + summary + changes（type 徽章）+ git 溯源 */}
                {selDetail?.releaseInfo ? (() => {
                  const ri = selDetail.releaseInfo;
                  const TYPE_STYLE: Record<string, string> = {
                    feature: "bg-green-100 text-green-700",
                    improvement: "bg-sky-100 text-sky-700",
                    fix: "bg-amber-100 text-amber-700",
                    breaking: "bg-red-100 text-red-600",
                    chore: "bg-stone-100 text-stone-500",
                  };
                  return (
                    <div className="rounded-lg border bg-white" style={{ borderColor: tk.borderLight }}>
                      <div className="px-3 py-2 flex items-center gap-2 flex-wrap border-b bg-stone-50/60" style={{ borderColor: tk.borderLight }}>
                        <span className="font-mono font-bold text-stone-800">v{ri.version}</span>
                        <span className="text-[10px] text-stone-400 font-mono">{ri.release_date}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-bold">schema {ri.schema}</span>
                        <span className="flex-1" />
                        <span className="text-[10px] font-mono text-stone-400" title={`${ri.git?.previous_tag || "—"} → ${ri.git?.tag || "(untagged)"}`}>
                          {ri.git?.previous_tag ? `${ri.git.previous_tag} → ` : ""}{ri.git?.tag || ri.git?.commit || "—"}
                        </span>
                      </div>
                      <div className="px-3 py-2 text-[11px] text-stone-700 leading-relaxed">{ri.summary}</div>
                      {(ri.changes || []).length > 0 && (
                        <div className="px-3 pb-2 space-y-1 max-h-56 overflow-auto">
                          {ri.changes.map((c: any, i: number) => (
                            <div key={i} className="flex gap-2 items-start text-[11px]">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${TYPE_STYLE[c.type] || TYPE_STYLE.chore}`}>{c.type}</span>
                              <div className="min-w-0">
                                <span className="font-bold text-stone-700">{c.title}</span>
                                {c.description && <span className="text-stone-400"> — {c.description}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {(ri.features || []).length > 0 && (
                        <div className="px-3 pb-2 border-t pt-2" style={{ borderColor: tk.borderLight }}>
                          <div className="text-[10px] font-bold text-stone-500 mb-1">{t("rm.ri.features")}（{ri.features.length}）</div>
                          <div className="space-y-1 max-h-40 overflow-auto">
                            {ri.features.map((f: any, i: number) => (
                              <div key={i} className="flex gap-2 items-start text-[11px]">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-indigo-100 text-indigo-700 font-mono">{f.id}</span>
                                <div className="min-w-0">
                                  <span className="font-bold text-stone-700">{f.name}</span>
                                  {f.impact && <span className="text-stone-400"> — {f.impact}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="px-3 py-1.5 border-t flex gap-3 text-[10px] font-mono text-stone-400" style={{ borderColor: tk.borderLight }}>
                        <span>commit {ri.git?.commit || "—"}</span>
                        <span>prev_tag {ri.git?.previous_tag || "null"}</span>
                        <span>tag {ri.git?.tag || "null"}</span>
                      </div>
                    </div>
                  );
                })() : !selDetail?.building && (
                  <div className="text-[11px] text-stone-400">{t("rm.ri.noInfo")}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ═══ AI 文件（Prod Spec / DFO / Release Info）— 有問題顯示，人按重做（2026-11-21 Fleming）═══ */}
        {selRR && (
          <div className="px-5 pt-3" data-testid="rm-docs">
            <div className="rounded-xl border overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
              <div className="px-4 py-2 flex items-center gap-2 flex-wrap border-b bg-stone-50/60" style={{ borderColor: tk.borderLight }}>
                <span className="text-sm font-bold text-stone-800">📄 {t("rm.docs.title")}</span>
                <span className="text-[10px] text-stone-400">{selRR}</span>
                <span className="flex-1" />
                <button onClick={buildAllDocs} disabled={!!docBusy || anyDocRunning}
                  className="text-xs px-3 py-1 rounded-lg text-white font-bold hover:opacity-90 disabled:opacity-60 flex items-center gap-1.5"
                  style={{ backgroundColor: "#b45309" }} data-testid="rm-docs-build-all"
                  title="按下去會依序做：Prod Spec 更新 → DFO 更新 → Release Info（含 Evidence Matrix）">
                  {(docBusy === "all" || anyDocRunning) && <span className="animate-spin inline-block w-3 h-3 border-[1.5px] border-white border-t-transparent rounded-full" />}
                  🚀 製作 Release Info
                </button>
                {docs?.verify && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${docs.verify.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                    {docs.verify.ok ? `✅ OK${docs.verify.warnings ? ` · ⚠️ ${docs.verify.warnings}` : ""}` : `❌ ${docs.verify.errors} 個錯誤${docs.verify.warnings ? ` · ⚠️ ${docs.verify.warnings}` : ""}`}
                  </span>
                )}
                <button onClick={fetchDocs} className="text-xs px-2 py-1 rounded-lg border" style={{ borderColor: tk.borderLight, color: tk.accent || "#8b5e3c" }} title="重新檢查">↻</button>
              </div>
              <div className="px-4 pt-2 pb-1 text-[10px] text-stone-500 leading-relaxed">
                按「🚀 製作 Release Info」會做四件事（數分鐘）：<b>Prod Spec 更新</b> → <b>DFO 更新</b> → <b>Release Info</b> → <b>Evidence Matrix</b>。
                Evidence Matrix 是 Release Info 的一部分，跟 info 同版號一起凍結（matrix-vN.json）。做完有問題會列在下面，可按「重做」單獨重跑。
              </div>
              <div className="px-4 py-2 space-y-1.5">
                {[
                  { kind: "spec", label: "📄 Prod Spec", key: "spec" },
                  { kind: "dfo", label: "🛠 DFO", key: "dfo" },
                  { kind: "releaseInfo", label: "🚀 Release Info + ⚖️ Matrix", key: "releaseInfo" },
                ].map((row) => {
                  const st = docs?.docs?.[row.key];
                  const fs = (docs?.verify?.findings || []).filter((f: any) => f.doc === row.key);
                  const errs = fs.filter((f: any) => f.level === "error");
                  const warns = fs.filter((f: any) => f.level === "warn");
                  const status = st?.status || (docs ? "idle" : "loading");
                  const badge = status === "running" ? "⏳ 產生中" : status === "done" ? (errs.length ? "❌ 有錯" : warns.length ? "⚠️ 提醒" : "✅ OK") : status === "error" ? "❌ 失敗" : errs.length ? "❌ 有錯" : "—";
                  const badgeCls = status === "running" ? "bg-amber-100 text-amber-700" : (errs.length || status === "error") ? "bg-red-100 text-red-600" : warns.length ? "bg-amber-100 text-amber-700" : status === "done" ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-500";
                  const busy = docBusy === row.kind || status === "running";
                  return (
                    <div key={row.kind} className="flex items-start gap-2 text-[11px]">
                      <span className="font-bold text-stone-700 w-32 shrink-0">{row.label}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${badgeCls}`}>{badge}</span>
                      <div className="min-w-0 flex-1">
                        {st?.error && <div className="text-red-500">{st.error}</div>}
                        {errs.map((f: any, i: number) => <div key={`e${i}`} className="text-red-500">• {f.message}</div>)}
                        {warns.map((f: any, i: number) => <div key={`w${i}`} className="text-amber-600">• {f.message}</div>)}
                        {!errs.length && !warns.length && st?.detail && <div className="text-stone-400">{st.detail}</div>}
                      </div>
                      <button onClick={() => rebuildDoc(row.kind as any)} disabled={busy || !!docBusy}
                        className="text-[10px] px-2 py-0.5 rounded border shrink-0 disabled:opacity-40"
                        style={{ borderColor: tk.borderLight, color: tk.accent || "#8b5e3c" }} data-testid={`rm-doc-rebuild-${row.kind}`}>
                        {busy ? "⏳" : t("rm.docs.rebuild")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ═══ Release Readiness 報告（APRS 風格 — 打開就能跟老闆報告）═══ */}
        {readiness && (
          <div className="px-5 pt-4" data-testid="rm-readiness">
            <div className="rounded-xl border overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
              {/* Header */}
              {/* ⚖️ Evidence Matrix（2026-11-07 Fleming v3：API-first，按鈕才載入；窗口 = 下拉選的 baseline commit 之後的 change）*/}
                {evApi && (
                  <div className="px-4 py-3 border-t" style={{ borderColor: tk.borderLight }} data-testid="rm-evidence-matrix">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-xs font-bold text-stone-700">⚖️ {t("rm.ev.title")}</span>
                      <span className="text-[10px] text-stone-400">{evApi.anchor === "all" ? t("rm.ev.sinceHead") : `${evApi.anchor} · ${evApi.commitsInWindow} commits`}</span>
                      {matrixFrozen ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-bold" title="與 Release Info 同版號凍結">🔒 凍結 v{matrixFrozen}</span> : null}
                      {onOpenReviewBoard && <button type="button" onClick={onOpenReviewBoard} className="text-[10px] px-2 py-0.5 rounded-full border font-bold text-violet-600 hover:bg-violet-50" style={{ borderColor: "#ddd6fe" }} data-testid="rm-open-review-board">{t("rm.ev.openBoard")} →</button>}
                      {/* 2026-11-07 Fleming v5：產生 Review Report 搬進本塊 — 按鈕在這，結果在表格下方 */}
                      <button type="button" onClick={generateReport} disabled={reviewBusy}
                        className="ml-auto text-[10px] px-2.5 py-1 rounded-full border font-bold text-violet-600 hover:bg-violet-50 disabled:opacity-50 flex items-center gap-1" style={{ borderColor: "#ddd6fe" }} data-testid="rm-gen-report">
                        {reviewBusy && <span className="animate-spin inline-block w-2.5 h-2.5 border-[1.5px] border-current border-t-transparent rounded-full" />}
                        📋 {t("rm.genReport")}
                      </button>
                      <span className="ml-auto flex gap-1.5 text-[10px] font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 font-bold">API {evApi.summary.changedApis}</span>
                        <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-bold">Tests ✓{evApi.summary.withTests}</span>
                        <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-bold">E2E ✓{evApi.summary.e2eCovered}</span>
                        <span className={`px-1.5 py-0.5 rounded font-bold ${evApi.summary.sgHigh > 0 ? "bg-red-50 text-red-600" : "bg-stone-100 text-stone-500"}`}>SG ✗{evApi.summary.sgHigh}</span>
                        <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 font-bold">🏛 {evApi.summary.withReview}</span>
                        <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 font-bold">QA {evApi.summary.withQa}{evApi.summary.qaLatestFail > 0 ? ` ✗${evApi.summary.qaLatestFail}` : ""}</span>
                      </span>
                    </div>
                    <div className="grid gap-1 text-[9px] font-bold text-stone-400 px-2 pb-1" style={{ gridTemplateColumns: "1.9fr 1.3fr 0.7fr 0.6fr 0.7fr 1.1fr 1fr" }}>
                      <span>{t("rm.apiColApi")}</span><span>{t("rm.apiColName")}</span><span>Unit Test</span><span>E2E</span><span>SG</span><span>{t("rm.ev.reviewCol")}</span><span>QA</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {evApi.apis.map((a: any, i: number) => {
                        const risky = !a.tests.length && !a.e2eCovered;
                        return (
                          <div key={i} className="grid gap-1 items-center px-2 py-1.5 rounded-lg hover:bg-stone-50 text-[10px]" style={{ gridTemplateColumns: "1.9fr 1.3fr 0.7fr 0.6fr 0.7fr 1.1fr 1fr", background: risky ? "#fff7ed" : undefined }}>
                            <span className="font-mono font-bold text-stone-700 truncate" title={`${a.entry}\n${(a.files || []).join("\n")}`}>{a.entry}</span>
                            <span className="text-stone-500 truncate" title={a.name}>{a.name || "—"}</span>
                            <span className={`font-mono font-bold ${a.tests.length ? "text-green-600" : "text-red-500"}`} title={(a.tests || []).join("\n") || t("rm.ev.noTest")}>{a.tests.length ? `✓${a.tests.length}` : "✗"}</span>
                            <span className={`font-mono font-bold ${a.e2eCovered ? "text-green-600" : "text-stone-300"}`}>{a.e2eCovered ? "✓" : "—"}</span>
                            <span className={`font-mono font-bold ${a.sg.ok ? ((a.sg.total ?? 0) > 0 ? "text-amber-600" : "text-green-600") : "text-red-500"}`} title={a.sg.reason || `${a.sg.total ?? 0} findings（high ${a.sg.high ?? 0}）@ ${evApi.summary.sgScannedAt || "—"}`}>{a.sg.ok ? ((a.sg.total ?? 0) > 0 ? `⚠${a.sg.total}` : "✓0") : `✗${a.sg.high}hi`}</span>
                            <span className={`font-mono font-bold ${a.reviewCount ? "text-green-600" : "text-stone-300"}`} title={(a.reviews || []).map((r: any) => `${String(r.at || "").slice(0, 16)} ${r.decision || ""}`).join("\n") || t("rm.ev.noReview")}>{a.reviewCount ? `✓${a.reviewCount}（${String(a.latestReviewAt || "").slice(5, 10)}）` : "✗"}</span>
                            <span className={`font-mono font-bold ${a.qa?.latestVerdict === "pass" ? "text-green-600" : a.qa?.latestVerdict ? "text-red-500" : "text-stone-300"}`} title={(a.qa?.items || []).map((q: any) => `${String(q.at || "").slice(0, 16)} ${q.verdict}（${q.actor}）${q.summary || ""}`).join("\n") || t("rm.ev.noQa")}>{a.qa?.count ? `${a.qa.latestVerdict === "pass" ? "✓" : a.qa.latestVerdict === "fail" ? "✗" : "⚠"}${a.qa.count}（${String(a.qa.latestAt || "").slice(5, 10)}）` : "✗"}</span>
                          </div>
                        );
                      })}
                    </div>
                    {(reviewBusy || reviewReport) && (
                      <div className="mt-2 rounded-lg bg-violet-50 border px-3 py-2 text-[11px] text-stone-700 whitespace-pre-wrap" style={{ borderColor: "#ddd6fe" }} data-testid="rm-review-report">
                        <div className="text-[9px] font-bold text-violet-600 mb-0.5">{t("rm.reportTitle")}</div>
                        {reviewBusy ? t("rm.reportGenerating") : reviewReport}
                      </div>
                    )}
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
      <ColResizer onDown={rmPane.startDrag} className={showChat ? "hidden md:block" : "hidden"} />
      <div className="shrink-0 hidden md:block" style={{ width: rmPane.width, display: showChat ? undefined : "none" }}>
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
