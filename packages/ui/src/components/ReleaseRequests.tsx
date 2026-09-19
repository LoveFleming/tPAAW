/**
 * ReleaseRequests — 📋 Release Request（RR）區（2026-09-18 v2 + v3）
 *
 * v3：RM agent 整合 — 🤖 請 AI 審查（side chat 吃 rr_get 證據 → rr_suggest 寫建議）、
 *     ⚡ 一鍵套用建議（AI 只建議，人確認）；per-task approve 自動建 RR（server 端）
 *
 * 正式批次放行路徑：建單（baseline by SHA）→ 開審 → checklist 證據審查 → 結案放行。
 * 與 per-task approve 共存（快速路徑，不走這裡）。
 *
 * API（lib release-requests.mjs）：
 *   GET  /api/coding-releases/requests?path=            — 列表
 *   GET  /api/coding-releases/requests/:id?path=        — 單張（自動 refresh target/auto）
 *   POST /api/coding-releases/request                   — 建單 { title?, baseline?: sha|"auto" }
 *   PATCH /api/coding-releases/requests/:id             — draft 改 title / 換 baseline
 *   POST /api/coding-releases/requests/:id/open         — draft → reviewing
 *   POST /api/coding-releases/requests/:id/checklist    — 審查一項 { itemId, verdict, note? }
 *   POST /api/coding-releases/requests/:id/close        — 結案（server 驗證全 pass/waived）
 *   POST /api/coding-releases/requests/:id/cancel       — 作廢 { reason }
 *   GET  /api/coding-releases/baseline-candidates?path= — baseline 候選（auto + 最近 20）
 */
import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import type { AgentSideChatHandle } from "./AgentSideChat";

// ── types ──

export interface RrChecklistItem {
  id: string;
  label: string;
  auto?: { status: string; detail: string; checkedAt?: string; runId?: string | null } | null;
  verdict: "pass" | "fail" | "waived" | "pending";
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  note?: string | null;
}

export interface RrDetail {
  id: string;
  title: string;
  status: "draft" | "reviewing" | "released" | "cancelled";
  createdAt: string;
  closedAt: string | null;
  releaseId: string | null;
  baseline: { sha: string; short: string; subject: string; at?: string; source?: string };
  target: { sha?: string; short?: string; subject?: string; at?: string };
  scope: {
    computedAt?: string;
    commits: { count: number; authors: string[]; subjects: string[] };
    files: { file: string; changeCount: number }[];
    features: { id: string; name: string; changedFiles: string[]; apis: string[]; apiImpact: boolean; hasTests: boolean }[];
    apis: { method: string; path: string; file: string; featureIds: string[] }[];
    taskIds: ({ id: string; title: string } | string)[];
  };
  checklist: RrChecklistItem[];
  // v3（2026-09-18）：RM agent 建議 — { itemId: { verdict, reason, by, at } }
  suggested?: Record<string, { verdict: string; reason: string; by?: string; at?: string }> | null;
  history: { ts: string; by: string; event: string; note?: string | null }[];
}

interface RrListItem {
  id: string;
  title: string;
  status: RrDetail["status"];
  createdAt: string;
  closedAt: string | null;
  releaseId: string | null;
  baseline: { short?: string; subject?: string; source?: string };
  target: { short?: string; subject?: string };
  scope: { commits: number; files: number; features: number; apis: number; tasks: number };
  checklist: { id: string; verdict: string; auto: string }[];
}

interface BaselineCandidates {
  auto: { sha: string; short: string; subject: string; source?: string };
  recent: { sha: string; short: string; at: string; author: string; subject: string; isAuto: boolean }[];
}

interface Props {
  rootPath: string;
  theme: { borderLight: string; accent: string; accentHover?: string };
  notify?: (ok: boolean, text: string) => void; // 用父層 toast；沒帶就內建
  chatRef?: React.RefObject<AgentSideChatHandle | null>; // v3：請 RM agent 審查建議用
}

// ── styles ──

const STATUS_STYLES: Record<string, { icon: string; bg: string; text: string }> = {
  draft: { icon: "📝", bg: "#f5f5f4", text: "#78716c" },
  reviewing: { icon: "🔍", bg: "#fffbeb", text: "#d97706" },
  released: { icon: "🚀", bg: "#f0fdf4", text: "#16a34a" },
  cancelled: { icon: "🚫", bg: "#fef2f2", text: "#dc2626" },
};

const AUTO_ICON: Record<string, string> = { pass: "✅", fail: "❌", warn: "⚠️", unknown: "❔" };
const VERDICT_STYLES: Record<string, { icon: string; bg: string; text: string }> = {
  pass: { icon: "✅", bg: "#f0fdf4", text: "#16a34a" },
  fail: { icon: "❌", bg: "#fef2f2", text: "#dc2626" },
  waived: { icon: "🙋", bg: "#faf5ff", text: "#9333ea" },
  pending: { icon: "⏳", bg: "#f5f5f4", text: "#a8a29e" },
};

const BASELINE_SOURCE_LABEL: Record<string, string> = {
  "last-release-head": "上次 release",
  "first-commit": "首 commit",
  "user-selected": "自選",
};

export default function ReleaseRequests({ rootPath, theme: tk, notify, chatRef }: Props) {
  const { t } = useI18n();
  const [list, setList] = useState<RrListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [candidates, setCandidates] = useState<BaselineCandidates | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBaseline, setNewBaseline] = useState("auto");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RrDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null); // close/open/cancel 失敗原因常駐顯示（toast 一閃即逝的補救）
  const [waiveItem, setWaiveItem] = useState<string | null>(null);
  const [waiveNote, setWaiveNote] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [pickBaseline, setPickBaseline] = useState("");
  const [showScope, setShowScope] = useState(false);
  const [waitingSuggest, setWaitingSuggest] = useState(false); // v3：等 AI 寫建議（light 輪詢）

  const toast = useCallback((ok: boolean, text: string) => {
    if (notify) { notify(ok, text); return; }
    // 父層沒給 toast 就 console（通常不會發生 — ReleaseManagerPanel 一定會傳）
    console.warn("[RR]", ok ? "✅" : "❌", text);
  }, [notify]);

  const base = `${API_BASE}/api/coding-releases`;
  const qs = `path=${encodeURIComponent(rootPath)}`;

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch(`${base}/requests?${qs}`);
      const data = await res.json();
      setList(data.requests || []);
    } catch { /* 下次輪詢再試 */ }
    setLoaded(true);
  }, [base, qs]);

  useEffect(() => { refreshList(); }, [refreshList]);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${base}/requests/${id}?${qs}`);
      if (!res.ok) { setDetail(null); return; }
      const rr: RrDetail = await res.json();
      setDetail(rr);
      setEditTitle(rr.title);
      setPickBaseline(rr.baseline?.sha || "");
    } catch { /* keep old */ }
  }, [base, qs]);

  useEffect(() => {
    if (detailId) fetchDetail(detailId);
    else setDetail(null);
  }, [detailId, fetchDetail]);

  // ── actions ──

  const openCreate = async () => {
    setCreating(true);
    setNewTitle("");
    setNewBaseline("auto");
    if (!candidates) {
      try {
        const res = await fetch(`${base}/baseline-candidates?${qs}`);
        if (res.ok) setCandidates(await res.json());
      } catch { /* fallback: 只有 auto */ }
    }
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, title: newTitle.trim() || undefined, baseline: newBaseline || "auto" }),
      });
      const data = await res.json();
      if (!res.ok) return toast(false, `❌ ${data.error || "建單失敗"}`);
      toast(true, `📝 ${data.id} 已建立（draft）`);
      setCreating(false);
      await refreshList();
      setDetailId(data.id);
    } catch (e: any) {
      toast(false, `❌ ${e?.message || "連線失敗"}`);
    } finally { setBusy(false); }
  };

  const patch = async (body: Record<string, unknown>, okText: string) => {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/requests/${detail.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, ...body }),
      });
      const data = await res.json();
      if (!res.ok) return toast(false, `❌ ${data.error || "更新失敗"}`);
      toast(true, okText);
      setDetail(data); setEditTitle(data.title);
      refreshList();
    } catch (e: any) {
      toast(false, `❌ ${e?.message || "連線失敗"}`);
    } finally { setBusy(false); }
  };

  const act = async (action: "open" | "close" | "cancel", body: Record<string, unknown>, okText: string) => {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/requests/${detail.id}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, ...body }),
      });
      const data = await res.json();
      if (!res.ok) { const msg = `❌ ${data.error || "操作失敗"}`; setActionError(msg); return toast(false, msg); }
      setActionError(null);
      toast(true, okText);
      if (action === "close" && data.releaseId) {
        toast(true, `🚀 ${data.releaseId} — ${t("rr.releasedBanner")}${data.releasedTasks ? `（${data.releasedTasks} tasks）` : ""}`);
        setCloseNote("");
      }
      if (action === "cancel") { setCancelReason(""); setCancelling(false); }
      setDetail(data.rr || data);
      refreshList();
    } catch (e: any) {
      toast(false, `❌ ${e?.message || "連線失敗"}`);
    } finally { setBusy(false); }
  };

  const review = async (itemId: string, verdict: string, note?: string) => {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/requests/${detail.id}/checklist`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, itemId, verdict, note }),
      });
      const data = await res.json();
      if (!res.ok) return toast(false, `❌ ${data.error || "審查失敗"}`);
      setDetail(data);
      setWaiveItem(null); setWaiveNote("");
      refreshList();
    } catch (e: any) {
      toast(false, `❌ ${e?.message || "連線失敗"}`);
    } finally { setBusy(false); }
  };

  // ── v3：RM agent 建議 verdict（AI 只建議，人一鍵確認）──

  const askAi = () => {
    if (!detail) return;
    chatRef?.current?.send(
      `請審查 release request ${detail.id}（${detail.title}）：\n` +
      `1. 先用 rr_get 讀完整證據（scope + checklist 自動檢查明細）\n` +
      `2. 用 rr_suggest 寫入你對四項 checklist 的建議 verdict（pass / fail / waived + 理由）\n` +
      `鐵律：你只建議，人類做最終決定；理由必須引用 rr_get 的證據，沒證據不建議。`
    );
    setWaitingSuggest(true);
  };

  const applySuggestions = async () => {
    if (!detail?.suggested || busy) return;
    setBusy(true);
    try {
      let applied = 0;
      for (const item of detail.checklist) {
        if (item.verdict !== "pending") continue; // 人已下過 verdict 的不覆蓋
        const sug = detail.suggested?.[item.id];
        if (!sug) continue;
        const res = await fetch(`${base}/requests/${detail.id}/checklist`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: rootPath, itemId: item.id, verdict: sug.verdict, note: `🤖 套用 AI 建議 — ${sug.reason}` }),
        });
        if (res.ok) { const rr: RrDetail = await res.json(); setDetail(rr); applied++; }
      }
      toast(applied > 0, applied > 0 ? `🤖 ${t("rr.appliedToast")}（${applied}）` : t("rr.noApplyToast"));
      refreshList();
    } catch (e: any) {
      toast(false, `❌ ${e?.message || "連線失敗"}`);
    } finally { setBusy(false); }
  };

  // 等待 AI 寫建議：light 輪詢（5s × 最長 2.5 分），建議出現或超時停止
  useEffect(() => {
    if (!waitingSuggest || !detailId) return;
    const started = Date.now();
    const orig = detail ? JSON.stringify(detail.suggested || {}) : "{}";
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`${base}/requests/${detailId}?${qs}&light=1`);
        if (!res.ok) return;
        const rr: RrDetail = await res.json();
        const now = JSON.stringify(rr.suggested || {});
        if (now !== orig) {
          setDetail(rr); setEditTitle(rr.title);
          setWaitingSuggest(false);
          toast(true, `🤖 ${t("rr.aiDoneToast")}`);
          refreshList();
          return;
        }
        if (Date.now() - started > 150_000) setWaitingSuggest(false);
      } catch { /* 下輪再試 */ }
    }, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingSuggest, detailId]);

  // ── render helpers ──

  const checklistDone = (cl: { verdict: string }[]) => cl.filter(c => c.verdict === "pass" || c.verdict === "waived").length;

  const StatusBadge = ({ st }: { st: string }) => {
    const s = STATUS_STYLES[st] || STATUS_STYLES.draft;
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono shrink-0" style={{ background: s.bg, color: s.text }}>
        {s.icon} {st}
      </span>
    );
  };

  const MiniLights = ({ cl }: { cl: { id: string; verdict: string; auto: string }[] }) => (
    <span className="flex items-center gap-0.5 shrink-0" title={cl.map(c => `${c.id}: ${c.verdict !== "pending" ? c.verdict : `auto ${c.auto}`}`).join(" · ")}>
      {cl.map(c => {
        const v = c.verdict !== "pending" ? c.verdict : c.auto;
        const style = VERDICT_STYLES[v] || VERDICT_STYLES.unknown || VERDICT_STYLES.pending;
        return (
          <span key={c.id} className="text-[9px] font-bold px-1 rounded" style={{ background: style.bg, color: style.text }}>
            {c.id === "qa-records" ? "qa" : c.id}
          </span>
        );
      })}
    </span>
  );

  const candOptions = () => {
    if (!candidates) return null;
    return (
      <>
        <option value="auto">
          {t("rr.form.baselineAuto")} — {candidates.auto.short} {candidates.auto.subject?.slice(0, 40)}（{BASELINE_SOURCE_LABEL[candidates.auto.source || ""] || candidates.auto.source}）
        </option>
        <optgroup label={t("rr.form.baselineRecent")}>
          {candidates.recent.map(c => (
            <option key={c.sha} value={c.sha}>
              {c.short} {c.subject?.slice(0, 48)} — {c.author} {c.at?.slice(0, 10)}
            </option>
          ))}
        </optgroup>
      </>
    );
  };

  // ── render ──

  // v3：可套用的建議數（項目仍 pending 且有建議）
  const applicableSuggestions = detail?.status === "reviewing"
    ? (detail.checklist || []).filter(c => c.verdict === "pending" && detail.suggested?.[c.id]).length
    : 0;

  return (
    <section data-testid="rr-section">
      {/* header */}
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-xs font-bold text-stone-600 flex items-center gap-1.5">
          📋 {t("rr.title")}
          {list.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-stone-200 text-stone-600 text-[10px] font-bold">{list.length}</span>}
        </h3>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-400">.paaw/release-requests/</span>
        <button onClick={refreshList} className="text-[10px] text-stone-400 hover:text-stone-600">↻</button>
        <button onClick={() => creating ? setCreating(false) : openCreate()}
          className="ml-auto text-[11px] px-2.5 py-1 rounded-lg text-white font-bold shrink-0 hover:opacity-90"
          style={{ backgroundColor: tk.accent }} data-testid="rr-create-btn">
          {creating ? t("rr.form.cancel") : t("rr.create")}
        </button>
      </div>
      <p className="text-[10px] text-stone-400 -mt-1 mb-2">{t("rr.subtitle")}</p>

      {/* create form */}
      {creating && (
        <div className="border rounded-xl p-3.5 mb-3 bg-white space-y-2.5" style={{ borderColor: tk.accent }} data-testid="rr-create-form">
          <div className="text-xs font-bold text-stone-700">{t("rr.form.title")}</div>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder={t("rr.form.titlePh")}
            className="w-full text-xs rounded-lg border px-2.5 py-1.5 focus:outline-none focus:border-stone-400" style={{ borderColor: tk.borderLight }} />
          <div>
            <div className="text-[11px] font-bold text-stone-500 mb-1">{t("rr.form.baseline")}</div>
            <select value={newBaseline} onChange={e => setNewBaseline(e.target.value)}
              className="w-full text-xs rounded-lg border px-2.5 py-1.5 bg-white focus:outline-none" style={{ borderColor: tk.borderLight }}>
              {candidates ? candOptions() : <option value="auto">{t("rr.form.baselineAuto")}</option>}
            </select>
          </div>
          <div className="flex gap-2 pt-0.5">
            <button onClick={create} disabled={busy}
              className="text-xs px-3.5 py-1.5 rounded-lg text-white font-bold disabled:opacity-40" style={{ backgroundColor: tk.accent }} data-testid="rr-create-submit">
              {busy ? "…" : t("rr.form.submit")}
            </button>
            <button onClick={() => setCreating(false)} className="text-xs px-3 py-1.5 rounded-lg border text-stone-500 hover:bg-stone-50" style={{ borderColor: tk.borderLight }}>
              {t("rr.form.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* empty */}
      {loaded && list.length === 0 && !creating && (
        <div className="border border-dashed rounded-lg p-3.5 text-center text-xs text-stone-400" style={{ borderColor: tk.borderLight }}>
          {t("rr.empty")}
        </div>
      )}

      {/* list */}
      <div className="space-y-2">
        {list.map(rr => (
          <div key={rr.id} className={`border rounded-xl bg-white overflow-hidden ${detailId === rr.id ? "" : "hover:border-stone-300"}`}
            style={{ borderColor: detailId === rr.id ? tk.accent : tk.borderLight }} data-testid={`rr-card-${rr.id}`}>
            {/* collapsed row */}
            <button className="w-full text-left px-3.5 py-2.5 flex items-center gap-2.5"
              onClick={() => setDetailId(detailId === rr.id ? null : rr.id)}>
              <StatusBadge st={rr.status} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-stone-800 truncate">{rr.title}</div>
                <div className="text-[10px] font-mono text-stone-400 truncate">
                  {rr.id} · {rr.baseline.short} → {rr.target.short} · {t("rr.u.commits")} {rr.scope.commits} / {t("rr.u.files")} {rr.scope.files} / {t("rr.u.features")} {rr.scope.features} / {t("rr.u.apis")} {rr.scope.apis}
                  {rr.releaseId ? ` · ${rr.releaseId}` : ""}
                </div>
              </div>
              <span className="text-[10px] font-mono text-stone-400 shrink-0">{checklistDone(rr.checklist)}/{rr.checklist.length}</span>
              <MiniLights cl={rr.checklist} />
              <span className="text-stone-300 text-[10px] shrink-0">{detailId === rr.id ? "▾" : "▸"}</span>
            </button>

            {/* expanded detail */}
            {detailId === rr.id && (
              <div className="border-t px-4 py-3 bg-stone-50" style={{ borderColor: tk.borderLight }}>
                {!detail || detail.id !== rr.id ? (
                  <div className="text-xs text-stone-400 animate-pulse py-2 text-center">{t("common.loading")}</div>
                ) : (
                  <div className="space-y-3">
                    {/* baseline → target */}
                    <div className="text-[11px] text-stone-500 leading-relaxed" data-testid="rr-detail-baseline">
                      <span className="font-mono text-stone-700 font-bold">{detail.baseline.short}</span>
                      <span className="mx-1.5 text-stone-300">→</span>
                      <span className="font-mono text-stone-700 font-bold">{detail.target.short}</span>
                      <span className="ml-1.5 text-stone-400">
                        （{BASELINE_SOURCE_LABEL[detail.baseline.source || ""] || detail.baseline.source}：{detail.baseline.subject}）
                      </span>
                    </div>

                    {/* draft: title + baseline 可改 */}
                    {detail.status === "draft" && (
                      <div className="space-y-2 border rounded-lg p-2.5 bg-white" style={{ borderColor: tk.borderLight }}>
                        <div className="flex gap-1.5">
                          <input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder={t("rr.titlePhEdit")}
                            className="flex-1 text-xs rounded-lg border px-2.5 py-1.5 focus:outline-none" style={{ borderColor: tk.borderLight }} />
                          <button onClick={() => editTitle.trim() && editTitle !== detail.title && patch({ title: editTitle.trim() }, "✏️ " + t("rr.renamed"))}
                            disabled={busy || !editTitle.trim() || editTitle === detail.title}
                            className="text-[11px] px-2.5 py-1 rounded-lg border text-stone-600 hover:bg-stone-100 disabled:opacity-40" style={{ borderColor: tk.borderLight }}>
                            {t("rr.rename")}
                          </button>
                        </div>
                        {candidates && (
                          <div className="flex gap-1.5">
                            <select value={pickBaseline} onChange={e => setPickBaseline(e.target.value)}
                              className="flex-1 text-[11px] rounded-lg border px-2 py-1.5 bg-white focus:outline-none" style={{ borderColor: tk.borderLight }}>
                              <option value="">{t("rr.changeBaseline")}</option>
                              {candOptions()}
                            </select>
                            <button onClick={() => pickBaseline && patchBaseline()}
                              disabled={busy || !pickBaseline || pickBaseline === detail.baseline.sha}
                              className="text-[11px] px-2.5 py-1 rounded-lg border text-stone-600 hover:bg-stone-100 disabled:opacity-40" style={{ borderColor: tk.borderLight }}>
                              {t("rr.apply")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* checklist（draft 唯讀預覽；reviewing 可下 verdict）*/}
                    {(
                      <div data-testid="rr-checklist">
                        <div className="text-[11px] font-bold text-stone-500 mb-1.5">
                          {t("rr.checklistTitle")}（{checklistDone(detail.checklist)}/{detail.checklist.length}）{detail.status === "draft" ? ` · ${t("rr.draftPreview")}` : ""}
                        </div>
                        <div className="space-y-1.5">
                          {detail.checklist.map(item => (
                            <div key={item.id} className="border rounded-lg p-2.5 bg-white" style={{ borderColor: tk.borderLight }} data-testid={`rr-item-${item.id}`}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px]">{AUTO_ICON[item.auto?.status || "unknown"]}</span>
                                <span className="text-xs font-bold text-stone-700">{item.label}</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono`}
                                  style={{ background: (VERDICT_STYLES[item.verdict] || VERDICT_STYLES.pending).bg, color: (VERDICT_STYLES[item.verdict] || VERDICT_STYLES.pending).text }}>
                                  {item.verdict}
                                </span>
                                {item.note && <span className="text-[10px] text-purple-600">📝 {item.note}</span>}
                                {item.reviewedAt && <span className="text-[9px] text-stone-300 ml-auto">{fmtShort(item.reviewedAt)}</span>}
                              </div>
                              <div className="text-[10px] text-stone-400 mt-1 font-mono leading-relaxed break-all">
                                {t("rr.auto")}：{item.auto?.detail || "—"}
                              </div>
                              {detail.suggested?.[item.id] && (() => {
                                const s = detail.suggested[item.id];
                                const vs = VERDICT_STYLES[s.verdict] || VERDICT_STYLES.pending;
                                return (
                                  <div className="mt-1.5 flex items-start gap-1.5 text-[10px] bg-violet-50 border border-violet-200 rounded-md px-2 py-1" data-testid={`rr-suggest-${item.id}`}>
                                    <span>🤖</span>
                                    <span className="text-violet-700 leading-relaxed">
                                      <b>{t("rr.suggested")}</b>
                                      <span className="font-mono font-bold mx-1" style={{ color: vs.text }}>{vs.icon} {s.verdict}</span>
                                      — {s.reason}
                                      {s.by && <span className="text-violet-300 ml-1.5">{s.by}{s.at ? ` · ${fmtShort(s.at)}` : ""}</span>}
                                    </span>
                                  </div>
                                );
                              })()}
                              {/* verdict controls — reviewing only */}
                              {detail.status === "reviewing" && (
                                <div className="flex gap-1.5 mt-2 flex-wrap">
                                  <button onClick={() => review(item.id, "pass")} disabled={busy || item.verdict === "pass"}
                                    className="text-[10px] px-2 py-1 rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-40 font-bold">
                                    ✅ pass
                                  </button>
                                  <button onClick={() => review(item.id, "fail")} disabled={busy || item.verdict === "fail"}
                                    className="text-[10px] px-2 py-1 rounded-md bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-40 font-bold">
                                    ❌ fail
                                  </button>
                                  <button onClick={() => { setWaiveItem(waiveItem === item.id ? null : item.id); setWaiveNote(""); }}
                                    disabled={busy || item.verdict === "waived"}
                                    className="text-[10px] px-2 py-1 rounded-md bg-purple-50 text-purple-600 border border-purple-200 hover:bg-purple-100 disabled:opacity-40 font-bold">
                                    🙋 waive
                                  </button>
                                  {waiveItem === item.id && (
                                    <>
                                      <input value={waiveNote} onChange={e => setWaiveNote(e.target.value)}
                                        placeholder={t("rr.waiveNotePh")} autoFocus
                                        className="flex-1 min-w-[160px] text-[11px] rounded-md border border-purple-200 px-2 py-1 focus:outline-none focus:border-purple-400" />
                                      <button onClick={() => waiveNote.trim() && review(item.id, "waived", waiveNote.trim())}
                                        disabled={busy || !waiveNote.trim()}
                                        className="text-[10px] px-2 py-1 rounded-md bg-purple-600 text-white disabled:opacity-40 font-bold">
                                        {t("rr.waiveSubmit")}
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* scope tasks 提示（結案會放行這些） */}
                    {detail.status === "reviewing" && (detail.scope.taskIds || []).length > 0 && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        ⚠️ {t("rr.tasksLabel")}：{(detail.scope.taskIds || []).map(x => typeof x === "string" ? x : x.id).join(", ")}
                      </div>
                    )}

                    {/* actions by status */}
                    <div className="flex gap-2 flex-wrap items-center">
                      {detail.status === "reviewing" && (
                        <>
                          {/* v3：RM agent 審查建議（AI 只建議，人一鍵確認） */}
                          <button onClick={askAi} disabled={busy || !chatRef || waitingSuggest}
                            title={chatRef ? undefined : t("rr.aiUnavailable")}
                            className="text-[11px] px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-40 font-bold"
                            data-testid="rr-ask-ai">
                            {waitingSuggest ? `⏳ ${t("rr.waitingAi")}` : `🤖 ${t("rr.askAi")}`}
                          </button>
                          {applicableSuggestions > 0 && (
                            <button onClick={applySuggestions} disabled={busy}
                              className="text-[11px] px-2.5 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 font-bold"
                              data-testid="rr-apply-ai">
                              ⚡ {t("rr.applyAll")}（{applicableSuggestions}）
                            </button>
                          )}
                        </>
                      )}
                      {actionError && (
                        <div className="w-full mb-2 px-3 py-2 rounded-lg text-xs font-semibold" data-testid="rr-action-error"
                          style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
                          {actionError}
                        </div>
                      )}
                      {detail.status === "draft" && (
                        <button onClick={() => act("open", {}, "🔍 " + t("rr.openedToast"))} disabled={busy}
                          className="text-xs px-3.5 py-1.5 rounded-lg bg-amber-500 text-white font-bold hover:bg-amber-600 disabled:opacity-40" data-testid="rr-open-btn">
                          {busy ? "…" : t("rr.open")}
                        </button>
                      )}
                      {detail.status === "reviewing" && (
                        <>
                          <input value={closeNote} onChange={e => setCloseNote(e.target.value)} placeholder={t("rr.closeNotePh")}
                            className="flex-1 min-w-[140px] text-xs rounded-lg border px-2.5 py-1.5 focus:outline-none" style={{ borderColor: tk.borderLight }} />
                          <button onClick={() => act("close", closeNote.trim() ? { note: closeNote.trim() } : {}, "")} disabled={busy}
                            className="text-xs px-3.5 py-1.5 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-40 shrink-0" data-testid="rr-close-btn">
                            {busy ? "…" : t("rr.close")}
                          </button>
                        </>
                      )}
                      {(detail.status === "draft" || detail.status === "reviewing") && (
                        cancelling ? (
                          <>
                            <input value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder={t("rr.cancelReasonPh")} autoFocus
                              className="flex-1 min-w-[140px] text-xs rounded-lg border border-red-200 px-2.5 py-1.5 focus:outline-none focus:border-red-400" />
                            <button onClick={() => cancelReason.trim() && act("cancel", { reason: cancelReason.trim() }, "🚫 " + t("rr.cancelledToast"))}
                              disabled={busy || !cancelReason.trim()}
                              className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold disabled:opacity-40 shrink-0">
                              {t("rr.confirmCancel")}
                            </button>
                            <button onClick={() => { setCancelling(false); setCancelReason(""); }} className="text-[11px] text-stone-400 hover:text-stone-600 px-1">
                              {t("rr.form.cancel")}
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setCancelling(true)} disabled={busy}
                            className="text-[11px] px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">
                            🚫 {t("rr.cancelBtn")}
                          </button>
                        )
                      )}
                    </div>

                    {/* released 結果 */}
                    {detail.status === "released" && (
                      <div className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2.5 py-2" data-testid="rr-released-banner">
                        🚀 {t("rr.releaseId")}：<span className="font-mono font-bold">{detail.releaseId}</span>
                        {detail.closedAt && <span className="ml-2 text-stone-400">{t("rr.closedAt")} {fmtShort(detail.closedAt)}</span>}
                      </div>
                    )}

                    {/* scope 明細（摺疊） */}
                    <div>
                      <button onClick={() => setShowScope(!showScope)} className="text-[11px] text-stone-500 hover:text-stone-700 font-bold">
                        {showScope ? "▾" : "▸"} {t("rr.scopeDetails")}（{t("rr.u.commits")} {detail.scope.commits.count} · {t("rr.u.files")} {detail.scope.files.length} · {t("rr.u.features")} {detail.scope.features.length} · {t("rr.u.apis")} {detail.scope.apis.length}）
                      </button>
                      {showScope && (
                        <div className="mt-1.5 border rounded-lg p-2.5 bg-white text-[10px] text-stone-500 space-y-1.5 font-mono" style={{ borderColor: tk.borderLight }}>
                          <div className="text-stone-600">{detail.scope.commits.subjects.map(s => <div key={s} className="truncate">· {s}</div>)}</div>
                          {(detail.scope.features || []).length > 0 && (
                            <div>{t("rr.u.features")}：{(detail.scope.features || []).map(f => `${f.id}${f.hasTests ? "" : "(!no tests)"}`).join(", ")}</div>
                          )}
                          {(detail.scope.apis || []).length > 0 && (
                            <div>{t("rr.u.apis")}：{(detail.scope.apis || []).slice(0, 15).map(a => `${a.method} ${a.path}`).join(" · ")}{(detail.scope.apis || []).length > 15 ? " …" : ""}</div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* history */}
                    <div>
                      <div className="text-[11px] font-bold text-stone-500 mb-1">{t("rr.history")}</div>
                      <div className="space-y-0.5 max-h-32 overflow-y-auto">
                        {(detail.history || []).slice().reverse().map((h, i) => (
                          <div key={i} className="text-[10px] font-mono text-stone-400 flex gap-1.5">
                            <span className="shrink-0">{fmtShort(h.ts)}</span>
                            <span className="text-stone-500 shrink-0">{h.by}</span>
                            <span className="truncate">{h.event}{h.note ? ` — ${h.note}` : ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  // draft 換 baseline（定義在 render 之後使用上面 state）
  function patchBaseline() {
    patch({ baseline: pickBaseline }, "📌 " + t("rr.baselineChanged"));
  }
}

function fmtShort(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
