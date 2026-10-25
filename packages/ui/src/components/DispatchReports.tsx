/**
 * DispatchReports — 派工報告 tab page（2026-10-25 Fleming：從 EM 大總管 modal 改成獨立 tab，入口在 👷 生產 menu）
 *
 * 資料源：GET /api/coding-reports/list、GET/DELETE /api/coding-reports/:date（routes/coding-reports.mjs）
 * 報告來源：.paaw/auto-dispatch/reports/*.md（EM / Auto Dispatch 派工每日產出）
 * UI：左側日期清單（結果/摘要）+ 右側 Markdown 全文 — 樣式對齊 QaRecords 等 tab page
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import MarkdownText from "./MarkdownText";
import { uiConfirm } from "./ui/uiFeedback";

interface ReportMeta {
  date: string;
  size?: number;
  modified?: string;
  result?: string;
  summary?: string;
  mode?: string;
}

interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string };
  /** EM 大總管（📄 / 查看 → / openReport action）點入時指定日期；seq 遞增確保同日期重複點入也會觸發 */
  focus?: { date: string | null; seq: number } | null;
  /** tab 活躍時輕量刷新清單（切回 tab 抓最新報告，保留目前選取） */
  active?: boolean;
}

const fmtSize = (n?: number) => {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export default function DispatchReports({ rootPath, theme, focus, active = true }: Props) {
  const { t } = useI18n();
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reportContent, setReportContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef<string | null>(null); // effect 內讀目前選取用（避免 dep 迴圈）

  // ── 清單 + 內容載入（preferDate 有在清單內就選它，否則選最新一筆）──
  const fetchList = useCallback(async (preferDate?: string | null) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-reports/list?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      const list = (d.reports || []) as ReportMeta[];
      setReports(list);
      const want = preferDate && list.some(r => r.date === preferDate) ? preferDate : (list[0]?.date ?? null);
      selectedRef.current = want;
      setSelectedDate(want);
      if (want) {
        const r2 = await fetch(`${API_BASE}/api/coding-reports/${encodeURIComponent(want)}?path=${encodeURIComponent(rootPath)}`);
        const d2 = await r2.json();
        setReportContent(d2.content || t("emDash.reportsEmpty"));
      } else {
        setReportContent("");
      }
    } catch (err) {
      console.error("[DispatchReports] fetch error:", err);
      setReportContent(`❌ ${(err as Error).message}`);
    }
    setLoading(false);
  }, [rootPath, t]);

  // 單點某日期 → 只載內容（不重抓清單）
  const loadReport = useCallback(async (date: string) => {
    selectedRef.current = date;
    setSelectedDate(date);
    setContentLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-reports/${encodeURIComponent(date)}?path=${encodeURIComponent(rootPath)}`);
      const d = await r.json();
      setReportContent(d.content || t("emDash.reportsEmpty"));
    } catch (err) {
      console.error("[DispatchReports] load error:", err);
      setReportContent(`❌ ${(err as Error).message}`);
    }
    setContentLoading(false);
  }, [rootPath, t]);

  const handleDelete = async (date: string) => {
    if (!(await uiConfirm(`${t("dispatchReports.deleteConfirm")} ${date} ?`, { danger: true }))) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/coding-reports/${encodeURIComponent(date)}?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" });
      // 刪的是目前選取 → 改選最新；否則保留選取
      const keep = selectedRef.current === date ? null : selectedRef.current;
      await fetchList(keep ?? undefined);
    } catch (err) { console.error("[DispatchReports] delete error:", err); }
    setBusy(false);
  };

  // 掛載 / RU 切換（fetchList identity 變）/ EM 點入（focus 變更）→ 重抓清單
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      fetchList(focus?.date ?? null);
      return;
    }
    fetchList(focus?.date ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchList, focus?.date, focus?.seq]);

  // 切回 tab → 輕量刷新（保留目前選取）；掛載首輪已由上面 effect 處理
  const activeFirstRef = useRef(true);
  useEffect(() => {
    if (activeFirstRef.current) { activeFirstRef.current = false; return; }
    if (active) fetchList(selectedRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const selected = reports.find(r => r.date === selectedDate) || null;

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* Left: 報告清單 */}
      <div className="w-64 shrink-0 flex flex-col border-r" style={{ borderColor: theme.borderLight }}>
        <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}` }}>
          <span className="truncate" style={{ color: theme.text, opacity: 0.6 }}>{t("dispatchReports.total")}: <b>{reports.length}</b></span>
          <button onClick={() => fetchList(selectedRef.current)} className="ml-auto text-xs px-1.5 py-1 rounded shrink-0" style={{ background: theme.bg, color: theme.text }} title={t("dispatchReports.refresh")}>🔄</button>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>{t("dispatchReports.loading")}</div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center" style={{ color: theme.text, opacity: 0.4 }}>
              <div className="text-3xl">📄</div>
              <div className="text-sm">{t("dispatchReports.empty")}</div>
              <div className="text-xs max-w-[220px]">{t("dispatchReports.emptyHint")}</div>
            </div>
          ) : reports.map(r => {
            const isSelected = r.date === selectedDate;
            const hasFail = /❌\s*[1-9]/.test(r.result || "");
            return (
              <div key={r.date} onClick={() => loadReport(r.date)}
                className="px-3 py-2.5 cursor-pointer border-b transition-colors"
                style={{ borderColor: theme.borderLight, background: isSelected ? theme.accentBg : "transparent" }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold truncate" style={{ color: isSelected ? theme.accent : theme.text }}>🗓️ {r.date}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={hasFail
                    ? { background: "#fef2f2", color: "#dc2626" }
                    : { background: "#f0fdf4", color: "#16a34a" }}>{hasFail ? "❌" : "✅"}</span>
                </div>
                {r.result && <div className="text-[10px] mt-0.5 truncate" style={{ color: theme.text, opacity: 0.55 }} title={r.result}>{r.result}</div>}
                {r.summary && <div className="text-[10px] mt-0.5 truncate" style={{ color: theme.text, opacity: 0.4 }} title={r.summary}>{r.summary}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: 報告內容 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedDate ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">📄</div>
            <div className="text-sm">{t("dispatchReports.select")}</div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0" style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
              <span className="text-sm font-bold truncate" style={{ color: theme.text }}>📄 {selectedDate} {t("emDash.reportsTitle")}</span>
              {selected && (
                <span className="text-[10px] shrink-0" style={{ color: theme.text, opacity: 0.5 }}>
                  {fmtSize(selected.size)}{selected.modified ? ` · ${new Date(selected.modified).toLocaleString()}` : ""}
                </span>
              )}
              <button onClick={() => handleDelete(selectedDate)} disabled={busy}
                className="ml-auto text-xs px-2 py-1 rounded shrink-0 disabled:opacity-40"
                style={{ background: "#fef2f2", color: "#dc2626" }} title={t("dispatchReports.delete")}>🗑️</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarWidth: "thin" }}>
              {contentLoading ? (
                <p className="text-xs animate-pulse" style={{ color: theme.text, opacity: 0.4 }}>⏳ …</p>
              ) : (
                <div style={{ color: theme.text }}><MarkdownText>{reportContent}</MarkdownText></div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
