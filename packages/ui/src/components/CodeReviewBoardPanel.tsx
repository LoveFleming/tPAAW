/**
 * CodeReviewBoardPanel — 🏛️ Code Review 委員會 會議記錄頁（2026-10-11 Fleming）
 *
 * 需求（Fleming）：「替 code review 會議記錄做一個 page；Release Manager 可以連到那頁。」
 *
 * 資料來源：{project}/.paaw/review-board/*.md（coding-review-runner 每次開會落檔）。
 * 本頁把這些 report 當「會議記錄」呈現：
 *   左：全部會議清單（時間 / range / 結論 / 審查員 / findings / 分歧）
 *   右：選定會議的完整 report markdown（等同原始會議記錄全文）
 *
 * 唯讀頁 — 純查閱，不寫任何檔。
 */

import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import MarkdownText from "./MarkdownText";

interface ReportMeta {
  file: string;
  at: string | null;
  range: string | null;
  pathFilter: string | null;
  decision: string | null;
  counts: { critical: number; major: number; minor: number } | null;
  reviewers: string[];
  modelCount: number;
  commitShas: string[] | null;
  commitCount: number;
  fileCount: number | null;
  findingsCount: number;
  consensus: number;
  disputes: number;
  dropped: number;
  runnerFormat: boolean;
}

interface Props {
  rootPath: string;
  theme: any;
  onBackToReleaseManager?: () => void;
}

const DECISION_STYLE: Record<string, { bg: string; text: string; icon: string }> = {
  approve:            { bg: "#dcfce7", text: "#15803d", icon: "✅" },
  "review-notes":     { bg: "#fef3c7", text: "#b45309", icon: "🟠" },
  "request-changes":  { bg: "#fee2e2", text: "#b91c1c", icon: "🔴" },
  inconclusive:       { bg: "#f5f5f4", text: "#57534e", icon: "⛔" },
};

export default function CodeReviewBoardPanel({ rootPath, theme: tk, onBackToReleaseManager }: Props) {
  const { t } = useI18n();
  const borderLight = tk?.borderLight || "#e7e5e4";
  const accent = tk?.accent || "#7c3aed";
  const bgMuted = tk?.bgMuted || "#fafaf9";

  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [exists, setExists] = useState<boolean | null>(null); // null = loading
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchList = useCallback(async () => {
    if (!rootPath) { setExists(false); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-review-board/list?path=${encodeURIComponent(rootPath)}`);
      const d = await r.json();
      const list: ReportMeta[] = d.reports || [];
      setReports(list);
      setExists(!!d.exists && list.length > 0);
      setSelected(prev => (prev && list.some(x => x.file === prev)) ? prev : (list[0]?.file || null));
    } catch {
      setExists(false);
    } finally {
      setBusy(false);
    }
  }, [rootPath]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // 選定會議 → 讀全文
  useEffect(() => {
    if (!selected || !rootPath) { setContent(""); return; }
    let alive = true;
    setLoadingContent(true);
    fetch(`${API_BASE}/api/coding-review-board/report?path=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(selected)}`)
      .then(r => r.json())
      .then(d => { if (alive) setContent(d.ok ? d.content : `⚠️ ${d.error || "讀取失敗"}`); })
      .catch(e => { if (alive) setContent(`⚠️ ${String(e.message || e)}`); })
      .finally(() => { if (alive) setLoadingContent(false); });
    return () => { alive = false; };
  }, [selected, rootPath]);

  const decisionBadge = (m: ReportMeta) => {
    if (!m.decision) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{t("crb.tag.nonRunner")}</span>;
    const s = DECISION_STYLE[m.decision] || { bg: "#f5f5f4", text: "#57534e", icon: "•" };
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: s.bg, color: s.text }}>
        {s.icon} {t(`crb.decision.${m.decision}`)}
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full" style={{ backgroundColor: "#fff" }}>
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: borderLight }}>
        <div className="min-w-0">
          <div className="text-sm font-bold text-stone-800">{t("crb.title")}</div>
          <div className="text-[11px] text-stone-400 truncate">{t("crb.subtitle")}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onBackToReleaseManager && (
            <button onClick={onBackToReleaseManager}
              className="text-xs px-3 py-1.5 rounded-lg border font-medium hover:bg-stone-50"
              style={{ borderColor: borderLight, color: "#57534e" }}>
              {t("crb.openInRM")}
            </button>
          )}
          <button onClick={fetchList} disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg border font-medium hover:bg-stone-50 disabled:opacity-50"
            style={{ borderColor: accent, color: accent }}>
            {busy ? t("crb.refreshing") : `↻ ${t("crb.refresh")}`}
          </button>
        </div>
      </div>

      {exists === null ? (
        <div className="flex-1 flex items-center justify-center text-sm text-stone-400">{t("crb.loading")}</div>
      ) : !exists ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
          <div className="text-3xl">🏛️</div>
          <div className="text-sm font-bold text-stone-600">{t("crb.empty")}</div>
          <div className="text-xs text-stone-400 max-w-md">{t("crb.emptyHint")}</div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* 左：會議清單 */}
          <div className="w-[340px] shrink-0 border-r overflow-y-auto" style={{ borderColor: borderLight, backgroundColor: bgMuted }}>
            {reports.map(m => {
              const isSel = m.file === selected;
              return (
                <button key={m.file} onClick={() => setSelected(m.file)}
                  className="w-full text-left px-3 py-2.5 border-b hover:bg-white transition-colors"
                  style={{ borderColor: borderLight, backgroundColor: isSel ? "#fff" : undefined, borderLeft: isSel ? `3px solid ${accent}` : "3px solid transparent" }}>
                  <div className="flex items-center gap-2 mb-1">
                    {decisionBadge(m)}
                    <span className="text-[10px] text-stone-400 ml-auto">{m.at ? String(m.at).slice(0, 16).replace("T", " ") : "—"}</span>
                  </div>
                  <div className="text-[11px] font-mono text-stone-600 truncate" title={m.range || ""}>{m.range || m.file}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-stone-400">
                    <span title={m.reviewers.join("、")}>👥 {m.modelCount}</span>
                    <span>🔎 {m.findingsCount}</span>
                    {m.consensus > 0 && <span>🤝 {m.consensus}</span>}
                    {m.disputes > 0 && <span className="text-red-500 font-bold">🚩 {m.disputes}</span>}
                    {m.commitCount > 0 && <span>⎇ {m.commitCount}</span>}
                    {m.pathFilter && <span className="text-amber-600">{t("crb.tag.pathFilter")}</span>}
                  </div>
                  <div className="mt-1 text-[9px] font-mono text-stone-300 truncate">{m.file}</div>
                </button>
              );
            })}
          </div>

          {/* 右：會議記錄全文 */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-4">
            {loadingContent ? (
              <div className="text-sm text-stone-400">{t("crb.loading")}</div>
            ) : content ? (
              <MarkdownText>{content}</MarkdownText>
            ) : (
              <div className="text-sm text-stone-400">{t("crb.selectHint")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
