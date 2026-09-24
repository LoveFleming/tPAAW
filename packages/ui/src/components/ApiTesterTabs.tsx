/**
 * ApiTesterTabs — API Tester 左欄 tab sheet（2026-09-24 Fleming）
 *
 * 三個 tab：
 *   1. 🗂 Feature    — 原 ApiMapSidebar（專案 API 地圖，by feature 分組）
 *   2. 📁 Collection — api-tester collections（AI/人存的 payload，by collection 分組）
 *   3. 📜 History    — 執行歷史（取代原本標題列的 history dropdown button）
 *
 * 點 payload/history row → onLoadPayload({method,url,headers,body,streamMode}) 填入測試表單
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import ApiMapSidebar from "./ApiMapSidebar";
import { METHOD_COLORS } from "./ApiMapSidebar";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4097";

export interface ApiHistoryItem {
  id?: string; ts?: string;
  method: string; url: string; status: number; elapsed?: number;
  headers?: Array<{ key: string; value: string; enabled?: boolean }>;
  body?: string; streamMode?: boolean;
  source?: string; agent?: string; collection?: string;
  response?: any; streamResponse?: string;
}

interface CollectionSummary {
  name: string; count: number; updatedAt?: string; createdAt?: string;
  payloads: Array<{ id: string; name: string; method: string; url: string; createdAt?: string }>;
}

interface Props {
  rootPath: string;
  onPick: (method: string, path: string) => void;
  onOpenFile: (absPath: string) => void;
  onAskAi: (prompt: string) => void;
  onLoadPayload: (p: { method: string; url: string; headers?: any; body?: string; streamMode?: boolean }) => void;
  apiHistory: ApiHistoryItem[];
  onClearHistory: () => void;
  refreshHistory: () => void;
  borderLight?: string;
  borderInput?: string;
}

export default function ApiTesterTabs({
  rootPath, onPick, onOpenFile, onAskAi, onLoadPayload,
  apiHistory, onClearHistory, refreshHistory,
  borderLight = "#f0f0f0", borderInput = "#e5e5e5",
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"feature" | "collection" | "history">("feature");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [openCols, setOpenCols] = useState<Record<string, boolean>>({});
  const [colQuery, setColQuery] = useState("");
  const composingRef = useRef(false); // IME 三層保護

  const loadCollections = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/api-tester/collections`);
      const data = await res.json();
      if (Array.isArray(data.collections)) setCollections(data.collections);
    } catch { /* 靜默 — 空狀態顯示 */ }
  }, []);

  useEffect(() => {
    if (tab === "collection") loadCollections();
  }, [tab, loadCollections]);

  // 切到 collection tab 時順便刷新 history（agent 存的 payload 跑完會進 history）
  useEffect(() => {
    if (tab === "history") refreshHistory();
  }, [tab, refreshHistory]);

  const filteredCols = useMemo(() => {
    const q = colQuery.trim().toLowerCase();
    if (!q) return collections;
    return collections
      .map(c => ({ ...c, payloads: c.payloads.filter(p => p.name.toLowerCase().includes(q) || p.url.toLowerCase().includes(q)) }))
      .filter(c => c.name.toLowerCase().includes(q) || c.payloads.length > 0);
  }, [collections, colQuery]);

  const loadPayloadDetail = async (colName: string, payloadId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/api-tester/collections?name=${encodeURIComponent(colName)}`);
      const data = await res.json();
      const p = (data.collection?.payloads || []).find((x: any) => x.id === payloadId);
      if (!p) return;
      onLoadPayload({
        method: p.method || "GET",
        url: p.url,
        headers: Array.isArray(p.headers) ? p.headers : [],
        body: typeof p.body === "string" ? p.body : (p.body ? JSON.stringify(p.body, null, 2) : ""),
        streamMode: !!p.streamMode,
      });
    } catch { /* 靜默 */ }
  };

  const deleteCollection = async (name: string) => {
    if (!confirm(`${t("apiTester.delCollectionConfirm")}: ${name}?`)) return;
    try { await fetch(`${API_BASE}/api/api-tester/collections?name=${encodeURIComponent(name)}`, { method: "DELETE" }); } catch {}
    loadCollections();
  };

  const deletePayload = async (colName: string, payloadId: string) => {
    try { await fetch(`${API_BASE}/api/api-tester/collections?name=${encodeURIComponent(colName)}&payloadId=${encodeURIComponent(payloadId)}`, { method: "DELETE" }); } catch {}
    loadCollections();
  };

  const tabBtn = (key: typeof tab, emoji: string, label: string, count?: number) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={`flex-1 text-xs py-1.5 font-semibold transition-colors ${tab === key ? "border-b-2 border-sky-500 text-sky-600" : "text-stone-400 hover:text-stone-600"}`}
      style={tab !== key ? { borderBottom: "2px solid transparent" } : undefined}
    >
      {emoji} {label}{typeof count === "number" && count > 0 ? ` (${count})` : ""}
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Tab bar ── */}
      <div className="flex shrink-0" style={{ borderBottom: `1px solid ${borderLight}` }}>
        {tabBtn("feature", "🗂", t("apiTester.tabFeature"))}
        {tabBtn("collection", "📁", t("apiTester.tabCollection"), collections.reduce((s, c) => s + c.count, 0))}
        {tabBtn("history", "📜", t("apiTester.tabHistory"), apiHistory.length)}
      </div>

      {/* ── Tab 1: Feature（原 ApiMapSidebar）── */}
      {tab === "feature" && (
        <div className="flex-1 min-h-0">
          <ApiMapSidebar rootPath={rootPath} onPick={onPick} onOpenFile={onOpenFile} onAskAi={onAskAi} borderLight={borderLight} />
        </div>
      )}

      {/* ── Tab 2: Collection ── */}
      {tab === "collection" && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="p-1.5 shrink-0">
            <input
              value={colQuery}
              onChange={e => setColQuery(e.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              placeholder={t("apiTester.searchCollection")}
              className="w-full text-xs px-2 py-1 rounded border bg-transparent outline-none focus:border-sky-400"
              style={{ borderColor: borderInput }}
            />
          </div>
          <div className="flex-1 overflow-y-auto px-1.5 pb-2">
            {filteredCols.length === 0 ? (
              <div className="text-center text-stone-400 text-xs py-6 leading-5">
                {t("apiTester.noCollections")}<br />
                <span className="text-[10px]">{t("apiTester.noCollectionsHint")}</span>
              </div>
            ) : filteredCols.map(col => {
              const open = openCols[col.name] !== false; // 預設展開
              return (
                <div key={col.name} className="mb-1">
                  <div className="flex items-center gap-1 group">
                    <button onClick={() => setOpenCols(prev => ({ ...prev, [col.name]: !open }))}
                      className="flex-1 text-left text-xs font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-1 min-w-0 py-0.5">
                      <span className="text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
                      <span className="truncate">📁 {col.name}</span>
                      <span className="text-stone-400 font-normal shrink-0">({col.payloads.length})</span>
                    </button>
                    <button onClick={() => deleteCollection(col.name)}
                      className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 text-xs shrink-0 px-1" title={t("apiTester.delCollection")}>🗑</button>
                  </div>
                  {open && col.payloads.map(p => (
                    <div key={p.id} className="flex items-center gap-1.5 pl-4 py-0.5 hover:bg-stone-50 cursor-pointer group"
                      onClick={() => loadPayloadDetail(col.name, p.id)} title={p.url}>
                      <span className="text-[10px] font-bold w-11 shrink-0" style={{ color: METHOD_COLORS[p.method] || "#6B7280" }}>{p.method}</span>
                      <span className="text-xs text-stone-600 truncate flex-1">{p.name}</span>
                      <button onClick={e => { e.stopPropagation(); deletePayload(col.name, p.id); }}
                        className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 text-xs shrink-0" title={t("apiTester.delPayload")}>✕</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tab 3: History ── */}
      {tab === "history" && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center px-2 py-1 shrink-0" style={{ borderBottom: `1px solid ${borderLight}` }}>
            <span className="text-xs font-bold text-stone-500">{t("apiTester.tabHistory")} ({apiHistory.length})</span>
            <span className="flex-1" />
            {apiHistory.length > 0 && (
              <button onClick={onClearHistory} className="text-xs text-red-400 hover:text-red-600">{t("apiTester.clear")}</button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {apiHistory.length === 0 ? (
              <div className="text-center text-stone-400 text-xs py-6">{t("apiTester.noHistory")}</div>
            ) : apiHistory.map((h, hi) => (
              <div key={h.id || hi} className="flex flex-col px-2 py-1.5 hover:bg-stone-50 cursor-pointer"
                style={{ borderBottom: "1px solid #f5f5f5" }}
                onClick={() => onLoadPayload({
                  method: h.method, url: h.url,
                  headers: Array.isArray(h.headers) ? h.headers : [],
                  body: typeof h.body === "string" ? h.body : "",
                  streamMode: h.streamMode,
                })}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold w-10 shrink-0" style={{ color: METHOD_COLORS[h.method] || "#6B7280" }}>{h.method}</span>
                  <span className="text-stone-600 truncate flex-1 font-mono text-xs">{h.url}</span>
                  {h.source === "agent" && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-violet-50 text-violet-500 shrink-0" title={`由 ${h.agent || "agent"} 執行`}>🤖</span>
                  )}
                  {h.collection && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-amber-50 text-amber-600 shrink-0" title={`${t("apiTester.tabCollection")}: ${h.collection}`}>📁</span>
                  )}
                  <span className="text-xs font-bold shrink-0" style={{ color: h.status < 300 ? "#10B981" : h.status < 400 ? "#F59E0B" : "#EF4444" }}>{h.status}</span>
                  <span className="text-xs text-stone-400 shrink-0">{h.elapsed}ms</span>
                </div>
                {h.source !== "agent" && (h.response as any)?.body && (
                  <pre className="text-xs font-mono text-stone-400 mt-0.5 truncate">{String((h.response as any).body).slice(0, 120)}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
