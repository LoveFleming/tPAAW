/**
 * SheetPreview — xlsx/csv 表格預覽（讀 /api/secret/dossiers/<cat>/<file> 的 sheet 型回應）
 */
import React, { useEffect, useState } from "react";

type SheetData = { headers: string[]; previewRows: string[][]; totalRows: number; sheets?: string[]; truncated?: boolean };

export default function SheetPreview({ category, file, onClose }: { category: string; file: string; onClose: () => void }) {
  const [data, setData] = useState<SheetData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setData(null); setErr("");
    fetch(`/api/secret/dossiers/${encodeURIComponent(category)}/${encodeURIComponent(file)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else setData(d); })
      .catch(e => setErr(String(e)));
  }, [category, file]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200 bg-white shrink-0">
        <span className="text-sm font-bold text-stone-800 truncate">📊 {file}</span>
        {data && <span className="text-[11px] text-stone-400 shrink-0">{data.totalRows} 列{data.sheets && data.sheets.length > 1 ? ` · ${data.sheets.length} sheets` : ""}</span>}
        <div className="flex-1" />
        <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-lg leading-none px-1">✕</button>
      </div>
      <div className="flex-1 overflow-auto p-3" style={{ scrollbarWidth: "thin" }}>
        {err && <div className="text-sm text-red-600">⚠️ {err}</div>}
        {!data && !err && <div className="text-sm text-stone-400">載入中…</div>}
        {data && (
          <table className="text-xs border-collapse bg-white rounded-lg overflow-hidden">
            <thead>
              <tr>{data.headers.map((h, i) => <th key={i} className="border border-stone-200 bg-stone-100 px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.previewRows.map((r, i) => (
                <tr key={i} className={i % 2 ? "bg-stone-50" : ""}>
                  {data.headers.map((_, j) => <td key={j} className="border border-stone-200 px-2 py-1 whitespace-nowrap">{String(r[j] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data?.truncated && <div className="text-[11px] text-stone-400 mt-2">只顯示前 50 列</div>}
      </div>
    </div>
  );
}
