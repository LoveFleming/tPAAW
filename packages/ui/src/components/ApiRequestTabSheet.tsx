/**
 * ApiRequestTabSheet — API Tester 中欄：Postman 式多 request tab sheet（2026-11-06 Fleming）
 *
 * 改版重點：
 *   - 頂部一排 request tabs（像瀏覽器/Postman），每個 tab 有自己的 method/url/headers/body/streamMode/response
 *   - 「＋」開新 tab；tab 可關（✕）；全關自動補一個空 tab；tab 標題 = method + 短 path
 *   - 左欄點 API / 載入 payload → openTab() 開新 tab 填入（Postman 行為）
 *   - 原 CodingIDE 的 request builder / response viewer / stream / 存 collection 全部搬來這裡
 *
 * CodingIDE 透過 ref 呼叫 openTab()；歷史紀錄透過 onHistory 回報 parent 統一管理。
 */

import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import { uiAlert, uiAlertError } from "./ui/uiFeedback";
import JsonViewer from "./JsonViewer";
import API_BASE from "../api";

// ── Types（與 CodingIDE 共用結構；CodingIDE 保留自己的 ApiHistoryItem 定義）──
export interface ApiHeader { key: string; value: string; enabled: boolean; }
export interface ApiResponse { status: number; statusText: string; headers: Record<string, string>; body: string; elapsed: number; size: number; error?: boolean; }
export interface ApiHistoryItemLike {
  id: string; ts: string; method: string; url: string; status: number; elapsed: number;
  headers?: ApiHeader[]; body?: string; streamMode?: boolean;
  response?: ApiResponse; streamResponse?: string; source?: "agent" | "human"; agent?: string;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const METHOD_COLORS: Record<string, string> = {
  GET: "#10B981", POST: "#3B82F6", PUT: "#F59E0B", PATCH: "#8B5CF6",
  DELETE: "#EF4444", HEAD: "#6B7280", OPTIONS: "#6B7280",
};

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function tryFormatJson(str: string): string {
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
}

// ── Response body：JSON 自動 pretty / 樹狀檢視，非 JSON 原樣顯示 ──
function ApiResponseBody({ body }: { body: string }) {
  const { t: tt } = useI18n();
  const [view, setView] = useState<"tree" | "raw">("tree");
  const [copied, setCopied] = useState(false);
  let parsed: unknown = null;
  try { parsed = JSON.parse(body); } catch { /* not JSON */ }
  const isJson = parsed !== null && typeof parsed === "object";
  const pretty = tryFormatJson(body);
  const copy = () => {
    navigator.clipboard.writeText(pretty).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const btn = "text-xs px-2 py-1 rounded-md border transition-colors";
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 shrink-0">
        {isJson && (
          <>
            <button onClick={() => setView("tree")} className={cn(btn, view === "tree" ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50")}>🌳 {tt("vibe.apiViewTree")}</button>
            <button onClick={() => setView("raw")} className={cn(btn, view === "raw" ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50")}>📄 {tt("vibe.apiViewRaw")}</button>
          </>
        )}
        <button onClick={copy} className={cn(btn, "ml-auto bg-white text-stone-600 border-stone-300 hover:bg-stone-50")}>{copied ? "✅" : "📋"} {tt("vibe.apiCopy")}</button>
      </div>
      {isJson && view === "tree" ? (
        <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-stone-300 bg-white flex flex-col">
          <JsonViewer data={parsed} compact />
        </div>
      ) : (
        <pre className="flex-1 text-sm font-mono bg-stone-800 text-green-300 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words min-h-0">
          {pretty}
        </pre>
      )}
    </div>
  );
}

// ── 單一 request tab 的完整狀態（Postman 式：每 tab 獨立）──
interface ApiTab {
  id: string;
  method: string; url: string; headers: ApiHeader[]; body: string; streamMode: boolean;
  response: ApiResponse | null; loading: boolean;
  streamContent: string;
  streamInfo: { status: number; statusText: string; contentType: string } | null;
}

let _tabSeq = 0;
const newTabId = () => `apitab-${Date.now()}-${++_tabSeq}`;

const emptyTab = (): ApiTab => ({
  id: newTabId(), method: "GET", url: "",
  headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
  body: "", streamMode: false, response: null, loading: false, streamContent: "", streamInfo: null,
});

/** 外部（左欄 onPick / onLoadPayload）開新 tab 的輸入 */
export interface ApiTabInput {
  method?: string; url?: string; headers?: ApiHeader[] | any[]; body?: string; streamMode?: boolean;
}

export interface ApiRequestTabSheetHandle {
  /** 開新 tab 並填入內容（Postman 行為：點 API/收藏 = 開新 tab） */
  openTab: (input?: ApiTabInput) => void;
}

interface Props {
  rootPath: string;
  theme: any; // CodingIDE 的 tk
  projectApis: { method: string; path: string; file: string }[];
  projectApiExamples: { method: string; endpoint: string; description: string; request: any; response: any }[];
  /** 跑完 request → 回報 parent 存進 apiHistory */
  onHistory: (item: ApiHistoryItemLike) => void;
  /** 2026-11-07 修：存入 collection 成功 → 通知 parent 刷新 collection 清單（原本存完不刷新，要 reload 才看得到） */
  onCollectionsSaved?: () => void;
}

const ApiRequestTabSheet = forwardRef<ApiRequestTabSheetHandle, Props>(function ApiRequestTabSheet({
  rootPath, theme: tk, projectApis, projectApiExamples, onHistory, onCollectionsSaved,
}, ref) {
  const { t: tt } = useI18n();
  const [tabs, setTabs] = useState<ApiTab[]>([emptyTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => "");
  const [apiGroupCollapsed, setApiGroupCollapsed] = useState<Record<string, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);

  // 初始 active = 第一個 tab
  const activeId = activeTabId || tabs[0]?.id || "";
  const active = tabs.find(t => t.id === activeId) || tabs[0];

  const updateTab = useCallback((id: string, patch: Partial<ApiTab> | ((t: ApiTab) => Partial<ApiTab>)) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t));
  }, []);

  // ── 外部 API：開新 tab（Postman 行為）──
  useImperativeHandle(ref, () => ({
    openTab(input?: ApiTabInput) {
      const tab: ApiTab = {
        ...emptyTab(),
        method: input?.method || "GET",
        url: input?.url ?? "",
        headers: Array.isArray(input?.headers) && input!.headers!.length
          ? input!.headers!.map((h: any) => ({ key: String(h.key ?? ""), value: String(h.value ?? ""), enabled: h.enabled !== false }))
          : [{ key: "Content-Type", value: "application/json", enabled: true }],
        body: input?.body ?? "",
        streamMode: !!input?.streamMode,
      };
      setTabs(prev => [...prev, tab]);
      setActiveTabId(tab.id);
    },
  }), []);

  const closeTab = (id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter(t => t.id !== id);
      // 全關 → 自動補一個空 tab（至少維持一個）
      if (next.length === 0) {
        const fresh = emptyTab();
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveTabId(next[Math.min(idx, next.length - 1)].id);
      return next;
    });
  };

  // ═══════════════════════════════════════════════
  // 存入 Collection（原 CodingIDE doSaveToCollection 搬入）
  // ═══════════════════════════════════════════════
  const [saveColOpen, setSaveColOpen] = useState(false);
  const [saveColName, setSaveColName] = useState("");
  const [savePayloadName, setSavePayloadName] = useState("");
  const saveColComposingRef = useRef(false); // IME 三層保護

  const doSaveToCollection = async () => {
    const col = saveColName.trim();
    const pname = savePayloadName.trim();
    if (!active || !col || !pname || !active.url) return;
    try {
      const res = await fetch(`${API_BASE}/api/api-tester/collections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collection: col,
          path: rootPath, // RU-scoped collections
          payload: { name: pname, method: active.method, url: active.url, headers: active.headers, body: active.body, streamMode: active.streamMode },
        }),
      });
      if (res.ok) { setSaveColOpen(false); setSavePayloadName(""); uiAlert(tt("apiTester.saved")); onCollectionsSaved?.(); }
      else uiAlertError(tt("apiTester.saveFailed"));
    } catch { uiAlertError(tt("apiTester.saveFailed")); }
  };

  // ═══════════════════════════════════════════════
  // 發送 request（更新 active tab 的 response；stream 邏輯 per-tab）
  // ═══════════════════════════════════════════════
  const sendApiRequest = async () => {
    if (!active || !active.url.trim() || active.loading) return;
    const tabId = active.id;

    const headersObj: Record<string, string> = {};
    active.headers.filter(h => h.enabled && h.key).forEach(h => { headersObj[h.key] = h.value; });

    // ── Streaming mode ──
    if (active.streamMode) {
      updateTab(tabId, { loading: true, streamContent: "", streamInfo: null });
      const startTime = Date.now();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(`${API_BASE}/api/api-tester/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: active.method, url: active.url.trim(), headers: headersObj, body: active.body }),
          signal: ac.signal,
        });
        const status = parseInt(res.headers.get("X-Response-Status") || "0", 10);
        const statusText = res.headers.get("X-Response-Status-Text") || "";
        const contentType = res.headers.get("Content-Type") || "";
        updateTab(tabId, { streamInfo: { status, statusText, contentType } });

        const reader = res.body?.getReader();
        if (!reader) { updateTab(tabId, { streamContent: "No response body", loading: false }); return; }
        const decoder = new TextDecoder();
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          updateTab(tabId, { streamContent: accumulated });
        }

        const elapsed = Date.now() - startTime;
        const item: ApiHistoryItemLike = { id: `req-${Date.now()}`, ts: new Date().toISOString(), method: active.method, url: active.url, status: status || 200, elapsed, headers: [...active.headers], body: active.body, streamMode: active.streamMode, streamResponse: accumulated, source: "human" };
        onHistory(item);
        try { await fetch(`${API_BASE}/api/api-tester/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }); } catch {}
      } catch (err: any) {
        if (err.name === "AbortError") {
          updateTab(tabId, t => ({ streamContent: t.streamContent + "\n\n[⏹ Aborted by user]" }));
        } else {
          updateTab(tabId, { streamContent: `❌ Error: ${err.message}` });
        }
      }
      abortRef.current = null;
      updateTab(tabId, { loading: false });
      return;
    }

    // ── Normal (non-streaming) mode ──
    updateTab(tabId, { loading: true, response: null });
    try {
      const res = await fetch(`${API_BASE}/api/api-tester/proxy`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: active.method, url: active.url.trim(), headers: headersObj, body: active.body }),
      });
      const data = await res.json();
      updateTab(tabId, { response: data });
      const item: ApiHistoryItemLike = { id: `req-${Date.now()}`, ts: new Date().toISOString(), method: active.method, url: active.url, status: data.status, elapsed: data.elapsed, headers: [...active.headers], body: active.body, streamMode: active.streamMode, response: data, source: "human" };
      onHistory(item);
      try { await fetch(`${API_BASE}/api/api-tester/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }); } catch {}
    } catch (err: any) {
      updateTab(tabId, { response: { status: 0, statusText: "Error", headers: {}, body: err.message, elapsed: 0, size: 0, error: true } });
    }
    updateTab(tabId, { loading: false });
  };

  // URL input IME 三層保護
  const urlComposingRef = useRef(false);

  if (!active) return null;

  const shortPath = (url: string): string => {
    try { return new URL(url).pathname; } catch { return url; }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* ── Request tab bar（Postman 式）── */}
      <div className="shrink-0 flex items-end gap-0.5 px-1.5 pt-1.5 overflow-x-auto" style={{ borderBottom: `1px solid ${tk.borderLight}` }} data-testid="api-request-tabbar">
        {tabs.map(t => {
          const isActive = t.id === active.id;
          const color = METHOD_COLORS[t.method] || "#78716c";
          const sp = shortPath(t.url) || "(empty)";
          return (
            <div key={t.id}
              onClick={() => setActiveTabId(t.id)}
              className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-lg cursor-pointer border border-b-0 text-xs whitespace-nowrap shrink-0 max-w-48 ${isActive ? "bg-white" : "bg-stone-100 hover:bg-stone-200/70"}`}
              style={{ borderColor: tk.borderLight, marginBottom: "-1px" }}
              data-testid="api-request-tab">
              <span className="text-[9px] font-bold px-1 py-0.5 rounded text-white shrink-0" style={{ backgroundColor: color }}>{t.method}</span>
              <span className="font-mono text-stone-600 truncate" title={t.url || tt("apiTester.tabEmptyTitle")}>{sp.length > 18 ? `…${sp.slice(-17)}` : sp}</span>
              {t.loading && <span className="text-[9px] animate-pulse shrink-0">⏳</span>}
              {tabs.length > 1 && (
                <button onClick={e => { e.stopPropagation(); closeTab(t.id); }}
                  className="text-stone-300 hover:text-red-500 text-[10px] shrink-0 opacity-60 group-hover:opacity-100 leading-none px-0.5"
                  title={tt("apiTester.closeTab")}>✕</button>
              )}
            </div>
          );
        })}
        <button onClick={() => { const t = emptyTab(); setTabs(prev => [...prev, t]); setActiveTabId(t.id); }}
          className="shrink-0 px-2 py-1.5 text-xs text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-t-lg"
          title={tt("apiTester.newTab")} data-testid="api-request-newtab">＋</button>
      </div>

      {/* ── Top: Request Builder（per-tab）── */}
      <div data-api-panel="request" className="shrink-0 overflow-y-auto p-3 space-y-2 flex flex-col" style={{ flex: "0 0 50%", borderBottom: `1px solid ${tk.borderLight}`, maxHeight: "70%" }}>
        {/* Title bar */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-stone-500">🌐 API Tester</span>
          <span className="flex-1" />
          {rootPath && (
            <button onClick={async () => {
              try {
                const res = await fetch(`${API_BASE}/api/coding-project/file?path=${encodeURIComponent(rootPath)}&file=test-payloads/all-payloads.json`);
                if (res.ok) {
                  const data = await res.json();
                  if (data.content) {
                    try {
                      const payloads = JSON.parse(data.content);
                      if (payloads.tests?.[0]?.request) {
                        const t = payloads.tests[0];
                        updateTab(active.id, {
                          method: t.request.method || "GET",
                          url: t.request.path || "",
                          headers: t.request.headers ? Object.entries(t.request.headers).map(([k, v]) => ({ key: k, value: String(v), enabled: true })) : active.headers,
                          body: t.request.body ? (typeof t.request.body === "string" ? t.request.body : JSON.stringify(t.request.body, null, 2)) : active.body,
                        });
                        uiAlert(tt("apiTester.aiPayloadLoaded"));
                      } else if (payloads.endpoint) {
                        updateTab(active.id, {
                          method: payloads.tests?.[0]?.request?.method || payloads.request?.method || "GET",
                          url: payloads.endpoint.split(" ").pop() || payloads.request?.path || "",
                        });
                      }
                    } catch { uiAlertError(tt("apiTester.aiPayloadBadFormat")); }
                  } else { uiAlert(tt("apiTester.aiPayloadNone")); }
                } else { uiAlert(tt("apiTester.aiPayloadNone")); }
              } catch { uiAlertError(tt("apiTester.loadFailed")); }
            }} className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 hover:bg-emerald-200 font-bold" title={tt("apiTester.aiPayloadBtn")}>
              🧪 AI
            </button>
          )}
          <div className="relative">
            <button onClick={() => setSaveColOpen(v => !v)} className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 font-bold" title={tt("apiTester.saveToCollection")}>
              💾+
            </button>
            {/* 存入 Collection popover */}
            {saveColOpen && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg shadow-xl border p-2 space-y-1.5 z-50" style={{ borderColor: tk.borderInput }}>
                <div className="text-xs font-bold text-stone-500">{tt("apiTester.saveToCollection")}</div>
                <input value={saveColName} onChange={e => setSaveColName(e.target.value)}
                  onCompositionStart={() => { saveColComposingRef.current = true; }}
                  onCompositionEnd={() => { saveColComposingRef.current = false; }}
                  placeholder={tt("apiTester.collectionNamePh")} className="w-full text-xs px-2 py-1 rounded border bg-transparent outline-none focus:border-amber-400" style={{ borderColor: tk.borderInput }} />
                <input value={savePayloadName} onChange={e => setSavePayloadName(e.target.value)}
                  onCompositionStart={() => { saveColComposingRef.current = true; }}
                  onCompositionEnd={() => { saveColComposingRef.current = false; }}
                  onKeyDown={async (e) => {
                    if (saveColComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Enter") { e.preventDefault(); await doSaveToCollection(); }
                  }}
                  placeholder={tt("apiTester.payloadNamePh")} className="w-full text-xs px-2 py-1 rounded border bg-transparent outline-none focus:border-amber-400" style={{ borderColor: tk.borderInput }} />
                <div className="flex gap-1.5">
                  <button onClick={doSaveToCollection} disabled={!saveColName.trim() || !savePayloadName.trim() || !active.url}
                    className="flex-1 text-xs px-2 py-1 rounded bg-amber-500 text-white font-bold hover:bg-amber-600 disabled:opacity-40">{tt("apiTester.save")}</button>
                  <button onClick={() => setSaveColOpen(false)} className="text-xs px-2 py-1 rounded text-stone-400 hover:text-stone-600">{tt("apiTester.cancel")}</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick URLs */}
        <div className="flex flex-wrap gap-1 mb-1">
          {projectApiExamples.length > 0 && projectApiExamples.slice(0, 20).map((ex, i) => (
            <button key={`ex-${i}`} onClick={() => {
              const base = rootPath ? `http://localhost:${new URL(API_BASE).port}` : API_BASE;
              let url = `${base}${ex.endpoint}`;
              if (ex.request?.params) {
                for (const [k, v] of Object.entries(ex.request.params)) {
                  url = url.replace(`{${k}}`, String(v));
                }
              }
              updateTab(active.id, {
                url,
                method: ex.method || "GET",
                streamMode: false,
                headers: ex.request?.headers ? Object.entries(ex.request.headers).map(([key, value]) => ({ key, value: String(value), enabled: true })) : active.headers,
                body: ex.request?.body ? JSON.stringify(ex.request.body, null, 2) : active.body,
              });
            }}
              className="text-xs px-2 py-0.5 rounded-full border border-emerald-200 text-emerald-600 hover:bg-emerald-50"
              title={`${ex.description}\n${JSON.stringify(ex.request?.body || {}, null, 2).slice(0, 200)}`}>
              {ex.method} {ex.endpoint.length > 22 ? `…${ex.endpoint.slice(-19)}` : ex.endpoint}
            </button>
          ))}
          {projectApiExamples.length === 0 && projectApis.length > 0 && (() => {
            const groups: Record<string, typeof projectApis> = {};
            for (const api of projectApis) {
              const parts = api.path.replace(/^\/+/, "").split("/");
              const group = parts.length > 1 ? parts[0] : "root";
              if (!groups[group]) groups[group] = [];
              groups[group].push(api);
            }
            const groupNames = Object.keys(groups).sort();
            return groupNames.map(gName => {
              const apis = groups[gName];
              const collapsed = apiGroupCollapsed[gName] !== false;
              return (
                <div key={`grp-${gName}`} className="mb-1">
                  <button onClick={() => setApiGroupCollapsed(prev => ({ ...prev, [gName]: !collapsed }))}
                    className="text-xs font-semibold text-stone-500 hover:text-stone-700 flex items-center gap-1 mb-0.5">
                    <span className="text-[10px]">{collapsed ? "▸" : "▾"}</span>
                    <span className="text-blue-500">/{gName}</span>
                    <span className="text-stone-400 font-normal">({apis.length})</span>
                  </button>
                  {!collapsed && (
                    <div className="flex flex-wrap gap-1 ml-3 mb-1">
                      {apis.map((api, i) => (
                        <button key={`proj-${gName}-${i}`} onClick={() => {
                          const base = rootPath ? `http://localhost:${new URL(API_BASE).port}` : API_BASE;
                          updateTab(active.id, { url: `${base}${api.path}`, method: api.method || "GET", streamMode: false });
                        }}
                          className="text-xs px-2 py-0.5 rounded-full border border-blue-200 text-blue-600 hover:bg-blue-50"
                          title={api.file || api.path}>
                          {api.method} {api.path.length > 30 ? `…${api.path.slice(-27)}` : api.path}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()}
          {projectApiExamples.length === 0 && projectApis.length === 0 && (
            <span className="text-xs text-stone-400 italic">{tt("apiTester.noProjectApis")}</span>
          )}
        </div>

        {/* URL bar */}
        <div className="flex items-center gap-2">
          <select value={active.method} onChange={e => updateTab(active.id, { method: e.target.value })}
            className="text-sm font-bold px-2 py-1.5 border rounded-lg outline-none cursor-pointer"
            style={{ borderColor: "#ddd", color: METHOD_COLORS[active.method] }}>
            {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input value={active.url} onChange={e => updateTab(active.id, { url: e.target.value })}
            onCompositionStart={() => { urlComposingRef.current = true; }}
            onCompositionEnd={() => { urlComposingRef.current = false; }}
            onKeyDown={e => {
              // IME 三層保護：composing 中不送出
              if (urlComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendApiRequest(); }
            }}
            placeholder="https://api.example.com/endpoint"
            className="flex-1 text-sm font-mono px-3 py-1.5 border rounded-lg outline-none focus:border-blue-400"
            style={{ borderColor: "#ddd" }} />
          <button
            onClick={() => updateTab(active.id, { streamMode: !active.streamMode })}
            className={cn("text-xs px-2 py-1.5 rounded-lg border font-semibold transition-colors",
              active.streamMode ? "bg-purple-600 text-white border-purple-600" : "text-stone-400 border-stone-200 hover:bg-stone-50")}
            title="Toggle streaming mode (for LLM SSE endpoints)">
            ⚡ Stream
          </button>
          {active.loading && active.streamMode ? (
            <button onClick={() => abortRef.current?.abort()}
              className="px-3 py-1.5 rounded-lg text-sm font-bold text-white bg-red-500 hover:bg-red-600 active:scale-95 transition-all">
              ⏹ Stop
            </button>
          ) : (
            <button onClick={sendApiRequest} disabled={active.loading || !active.url.trim()}
              className="px-4 py-1.5 rounded-lg text-sm font-bold text-white disabled:opacity-40 active:scale-95 transition-transform"
              style={{ backgroundColor: tk.accent }}>
              {active.loading ? "⏳" : "Send"}
            </button>
          )}
        </div>

        {/* Headers (collapsible) */}
        <details open>
          <summary className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-xs font-bold text-stone-500">{tt('vibe.apiHeaders')}</span>
            <button onClick={e => { e.stopPropagation(); updateTab(active.id, t => ({ headers: [...t.headers, { key: "", value: "", enabled: true }] })); }} className="text-xs text-blue-500 hover:text-blue-600">{tt("vibe.apiAddHeader")}</button>
            <span className="text-xs text-stone-400">{active.headers.filter(h => h.enabled).length}/{active.headers.length}</span>
          </summary>
          {active.headers.map((h, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1">
              <input type="checkbox" checked={h.enabled} onChange={e => updateTab(active.id, t => ({ headers: t.headers.map((x, idx) => idx === i ? { ...x, enabled: e.target.checked } : x) }))} className="w-3 h-3" />
              <input value={h.key} onChange={e => updateTab(active.id, t => ({ headers: t.headers.map((x, idx) => idx === i ? { ...x, key: e.target.value } : x) }))} placeholder="Key"
                className="flex-1 text-xs font-mono px-2 py-1 border rounded outline-none" style={{ borderColor: "#ddd" }} />
              <input value={h.value} onChange={e => updateTab(active.id, t => ({ headers: t.headers.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x) }))} placeholder="Value"
                className="flex-1 text-xs font-mono px-2 py-1 border rounded outline-none" style={{ borderColor: "#ddd" }} />
              <button onClick={() => updateTab(active.id, t => ({ headers: t.headers.filter((_, idx) => idx !== i) }))} className="text-stone-300 hover:text-red-500 text-xs">✕</button>
            </div>
          ))}
        </details>

        {/* Body */}
        {active.method !== "GET" && active.method !== "HEAD" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2 mb-1 shrink-0">
              <span className="text-xs font-bold text-stone-500 shrink-0">{tt('vibe.apiBody')}</span>
              <button onClick={() => updateTab(active.id, t => ({ body: tryFormatJson(t.body) }))}
                className="text-xs text-stone-400 hover:text-stone-600">📐 {tt("vibe.format")}</button>
            </div>
            <textarea value={active.body} onChange={e => updateTab(active.id, { body: e.target.value })}
              placeholder='{"key": "value"}'
              className="w-full flex-1 min-h-0 text-sm font-mono px-3 py-2 border rounded-lg outline-none focus:border-blue-400 resize-none"
              style={{ borderColor: "#ddd" }} />
          </div>
        )}
      </div>

      {/* ── Splitter ── */}
      <div className="h-px cursor-row-resize hover:h-1 hover:bg-blue-400 active:bg-blue-500 transition-all shrink-0"
        onMouseDown={e => {
          e.preventDefault();
          const container = e.currentTarget.parentElement;
          if (!container) return;
          const startY = e.clientY;
          const reqPanel = container.querySelector('[data-api-panel="request"]') as HTMLElement;
          const respPanel = container.querySelector('[data-api-panel="response"]') as HTMLElement;
          if (!reqPanel || !respPanel) return;
          const startReqH = reqPanel.offsetHeight;
          const totalH = container.offsetHeight;
          const onMove = (ev: MouseEvent) => {
            const delta = ev.clientY - startY;
            const newReqH = Math.max(120, Math.min(totalH - 120, startReqH + delta));
            const pct = (newReqH / totalH) * 100;
            reqPanel.style.flex = `0 0 ${pct}%`;
            respPanel.style.flex = `1 1 ${100 - pct}%`;
          };
          const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }} style={{ backgroundColor: tk.border }} />

      {/* ── Bottom: Response Viewer（per-tab）── */}
      <div data-api-panel="response" className="flex-1 overflow-y-auto p-3 min-h-0">
        {active.streamMode && (active.streamContent || active.loading) ? (
          <div className="flex flex-col h-full gap-2">
            <div className="flex items-center gap-2 shrink-0">
              {active.streamInfo && (
                <span className="text-xs font-bold" style={{ color: active.streamInfo.status < 300 ? "#10B981" : active.streamInfo.status < 400 ? "#F59E0B" : "#EF4444" }}>
                  {active.streamInfo.status || "..."} {active.streamInfo.statusText}
                </span>
              )}
              {active.loading && <span className="text-xs text-purple-500 animate-pulse">⚡ streaming...</span>}
            </div>
            <pre className="flex-1 text-sm font-mono bg-stone-900 text-green-300 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words min-h-0">
              {active.streamContent ? tryFormatJson(active.streamContent) : "⏳ Waiting for response..."}
            </pre>
          </div>
        ) : active.response ? (
          <div className="flex flex-col h-full gap-2">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold" style={{ color: active.response.status < 300 ? "#10B981" : active.response.status < 400 ? "#F59E0B" : "#EF4444" }}>
                {active.response.status} {active.response.statusText}
              </span>
              <span className="text-xs text-stone-400">{active.response.elapsed}ms · {fmtBytes(active.response.size)}</span>
            </div>
            {Object.keys(active.response.headers).length > 0 && (
              <details className="shrink-0">
                <summary className="text-xs font-bold text-stone-400 cursor-pointer hover:text-stone-600">{tt('vibe.apiRespHeaders')}</summary>
                <div className="text-xs font-mono bg-stone-50 rounded-lg p-2 space-y-0.5 mt-1">
                  {Object.entries(active.response.headers).map(([k, v]) => (
                    <div key={k}><span className="text-blue-600">{k}</span>: <span className="text-stone-600">{v}</span></div>
                  ))}
                </div>
              </details>
            )}
            <ApiResponseBody body={active.response.body} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-stone-400 text-xs">
            <span className="text-2xl">📥</span>
            <p>{tt("vibe.apiNoResponse")}</p>
          </div>
        )}
      </div>
    </div>
  );
});

export default ApiRequestTabSheet;
