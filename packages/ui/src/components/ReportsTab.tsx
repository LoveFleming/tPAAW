/**
 * ReportsTab — EM 報告列表 + 檢視器
 *
 * 左側: 報告列表（日期 + 結果 + 大小）
 * 右側: 選中的報告內容（markdown render）
 */

import { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ReportListItem {
  date: string;
  filename: string;
  size: number;
  modified: string;
  result: string;
  summary: string;
}

interface ReportsTabProps {
  rootPath: string;
  theme: {
    bg: string;
    bgMuted: string;
    borderLight: string;
    accent: string;
    accentBg: string;
    text: string;
    textMuted?: string;
  };
}

export default function ReportsTab({ rootPath, theme: tk }: ReportsTabProps) {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load report list ──
  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-reports/list?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setReports(d.reports || []);
      // Auto-select latest
      if (d.reports?.length > 0 && !selectedDate) {
        setSelectedDate(d.reports[0].date);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [rootPath]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // ── Load report content when selected ──
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/coding-reports/${selectedDate}?path=${encodeURIComponent(rootPath)}`)
      .then(r => r.json())
      .then(d => {
        setContent(d.content || "");
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [selectedDate, rootPath]);

  // ── Delete report ──
  const deleteReport = async (date: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`刪除報告 ${date}？`)) return;
    try {
      await fetch(`${API_BASE}/api/coding-reports/${date}?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" });
      setReports(prev => prev.filter(r => r.date !== date));
      if (selectedDate === date) {
        setSelectedDate(reports.find(r => r.date !== date)?.date || null);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 flex min-w-0 min-h-0" style={{ background: tk.bg }}>
      {/* ── Left: Report List ── */}
      <div className="w-[300px] flex flex-col border-r" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
        <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: tk.borderLight }}>
          <span className="text-sm font-bold" style={{ color: tk.text }}>📋 報告列表</span>
          <span className="text-xs" style={{ color: tk.textMuted }}>{reports.length} 篇</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {reports.length === 0 && !error && (
            <div className="p-4 text-center text-sm" style={{ color: tk.textMuted }}>
              暫無報告<br/>
              <span className="text-xs">EM 大總管執行後會自動產生</span>
            </div>
          )}

          {reports.map(r => (
            <div
              key={r.date}
              onClick={() => setSelectedDate(r.date)}
              className="px-3 py-2 cursor-pointer border-b transition-colors flex flex-col gap-1"
              style={{
                borderColor: tk.borderLight,
                background: selectedDate === r.date ? tk.accentBg : "transparent",
              }}
              onMouseEnter={e => { if (selectedDate !== r.date) e.currentTarget.style.background = tk.hover || tk.bgMuted; }}
              onMouseLeave={e => { if (selectedDate !== r.date) e.currentTarget.style.background = "transparent"; }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono font-bold" style={{ color: tk.text }}>{r.date}</span>
                <button
                  onClick={(e) => deleteReport(r.date, e)}
                  className="text-xs opacity-30 hover:opacity-100 hover:text-red-500"
                  style={{ color: tk.textMuted }}
                  title="刪除"
                >✕</button>
              </div>
              {r.result && (
                <span className="text-xs" style={{ color: tk.textMuted }}>{r.result}</span>
              )}
              <span className="text-xs" style={{ color: tk.textMuted }}>
                {formatDate(r.modified)} · {formatSize(r.size)}
              </span>
            </div>
          ))}
        </div>

        <div className="px-3 py-2 border-t" style={{ borderColor: tk.borderLight }}>
          <button
            onClick={loadList}
            className="w-full py-1.5 rounded text-xs font-medium border"
            style={{ borderColor: tk.borderLight, color: tk.text }}
          >
            🔄 重新載入
          </button>
        </div>
      </div>

      {/* ── Right: Report Content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-sm">{error}</div>
        )}

        {!selectedDate && !error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <div className="text-4xl">📋</div>
            <div className="text-sm" style={{ color: tk.textMuted }}>選擇左邊的報告來查看</div>
          </div>
        )}

        {selectedDate && loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-sm" style={{ color: tk.textMuted }}>載入中...</div>
          </div>
        )}

        {selectedDate && !loading && content && (
          <>
            <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
              <span className="text-sm font-bold" style={{ color: tk.text }}>🎖️ EM 報告 — {selectedDate}</span>
              <span className="text-xs" style={{ color: tk.textMuted }}>{formatSize(content.length)}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 prose prose-sm max-w-none" style={{ color: tk.text }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
