/**
 * ApiMapSidebar — API Tester 左欄：專案 API 地圖宮殿
 *
 * 資料（三源 merge，key = method+path）：
 *   1. /api/api-tester/project-apis — method/path/file（主清單）
 *   2. /api/ru/code-intel — callChain（handler 調用鏈）
 *   3. /api/ru/model — featureIds（F-xxx chips）
 *
 * 點 row → onPick(method, path) 填入測試表單
 * 「問 AI」→ onAskAi(prompt) 帶證據送右欄 Developer AI（No answer without evidence）
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useRuModel, featureNameMap, type RuModelLite } from "./useRuModel";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4097";

export const METHOD_COLORS: Record<string, string> = {
  GET: "#16a34a", POST: "#2563eb", PUT: "#d97706", PATCH: "#9333ea",
  DELETE: "#dc2626", HEAD: "#64748b", OPTIONS: "#64748b", ANY: "#78716c",
};

interface ApiEntry {
  method: string; path: string; file?: string | null;
  callChain?: { function: string; depth: number; file?: string; resolved?: boolean }[] | null;
  featureIds?: string[];
}

interface Props {
  rootPath: string;
  onPick: (method: string, path: string) => void;
  onOpenFile: (absPath: string) => void;
  onAskAi: (prompt: string) => void;
  borderLight?: string;
  accentText?: string;
}

export default function ApiMapSidebar({ rootPath, onPick, onOpenFile, onAskAi, borderLight = "#f0f0f0", accentText = "#0369a1" }: Props) {
  const { t } = useI18n();
  const [apis, setApis] = useState<ApiEntry[]>([]);
  const ruModel: RuModelLite | null = useRuModel(rootPath);
  const featNames = useMemo(() => featureNameMap(ruModel), [ruModel]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"feature" | "prefix">("feature"); // feature 分組為主軸
  const [openGroup, setOpenGroup] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null); // method+path
  const composingRef = useRef(false); // IME 三層保護

  useEffect(() => {
    if (!rootPath) { setApis([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const [pr, ci, ru] = await Promise.all([
          fetch(`${API_BASE}/api/api-tester/project-apis?root=${encodeURIComponent(rootPath)}`).then(r => r.json()).catch(() => null),
          fetch(`${API_BASE}/api/ru/code-intel?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).catch(() => null),
          fetch(`${API_BASE}/api/ru/model?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        const chainMap = new Map<string, ApiEntry["callChain"]>();
        for (const r of ci?.apiMap?.routes || []) {
          if (r.callChain?.length) chainMap.set(`${r.method} ${r.path}`, r.callChain);
        }
        const featMap = new Map<string, string[]>();
        for (const a of ru?.apis || []) {
          if (a.featureIds?.length) featMap.set(`${a.method} ${a.path}`, a.featureIds);
        }
        const merged: ApiEntry[] = (pr?.routes || []).map((r: ApiEntry) => ({
          ...r,
          callChain: chainMap.get(`${r.method} ${r.path}`) || null,
          featureIds: featMap.get(`${r.method} ${r.path}`) || [],
        }));
        setApis(merged);
      } catch { /* 靜默 — 空狀態顯示 */ }
    })();
    return () => { cancelled = true; };
  }, [rootPath]);

  // 搜尋 filter（method + path，case-insensitive）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apis;
    return apis.filter(a => `${a.method} ${a.path}`.toLowerCase().includes(q));
  }, [apis, query]);

  // 分組：feature（Release Unit 為主軸）或 prefix（技術結構）
  const UNMAPPED_KEY = "__unmapped__";
  const groups = useMemo(() => {
    const g = new Map<string, ApiEntry[]>();
    const push = (key: string, a: ApiEntry) => { if (!g.has(key)) g.set(key, []); g.get(key)!.push(a); };
    if (mode === "feature") {
      // 多歸屬誠實顯示：API 有幾個 featureIds 就出現在幾組
      for (const a of filtered) {
        const fids = (a.featureIds || []).filter(fid => featNames.has(fid));
        if (fids.length === 0) push(UNMAPPED_KEY, a);
        else fids.forEach(fid => push(fid, a));
      }
      // feature 依 F-id 排序，其他放最後
      const featKeys = [...g.keys()].filter(k => k !== UNMAPPED_KEY).sort();
      if (g.has(UNMAPPED_KEY)) featKeys.push(UNMAPPED_KEY);
      return featKeys.map(k => [k, g.get(k)!] as [string, ApiEntry[]]);
    }
    for (const a of filtered) {
      const parts = a.path.replace(/^\/+/, "").split("/");
      push(parts.length > 1 ? `/${parts[0]}` : "/", a);
    }
    return [...g.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [filtered, mode, featNames]);

  const askAbout = (a: ApiEntry) => {
    const chain = (a.callChain || []).map(c => `${"  ".repeat(c.depth)}${c.function}${c.resolved === false ? " (unresolved)" : ""}`).join("\n");
    onAskAi(
      `關於這條 API：${a.method} ${a.path}\n` +
      `handler 檔案：${a.file || "未知"}\n` +
      (a.featureIds?.length ? `屬於 features：${a.featureIds.join(", ")}\n` : "") +
      (chain ? `調用鏈：\n${chain}\n` : "") +
      `請幫我：1) 解釋這條 API 的用途與參數 2) 建議測試 payload 3) 指出需要注意的邊界情況`
    );
  };

  if (!rootPath) {
    return <div className="flex items-center justify-center h-full text-xs text-stone-400 p-4 text-center">{t("apiMap.noProject")}</div>;
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="api-map-sidebar">
      {/* 搜尋 + 統計 */}
      <div className="shrink-0 p-2 space-y-1.5" style={{ borderBottom: `1px solid ${borderLight}` }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          placeholder={t("apiMap.search")}
          className="w-full text-xs px-2 py-1.5 border rounded-lg outline-none focus:border-blue-400"
          style={{ borderColor: borderLight }}
          data-testid="api-map-search"
        />
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-stone-400 font-medium px-0.5">
            ⚡ {filtered.length}/{apis.length} APIs
          </div>
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: borderLight }} data-testid="api-map-mode">
            {(["feature", "prefix"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                data-testid={`api-map-mode-${m}`}
                className={`text-[10px] font-bold px-1.5 py-0.5 ${mode === m ? "bg-stone-800 text-white" : "text-stone-400 hover:bg-stone-100"}`}>
                {m === "feature" ? "🧩 Feature" : "🔍 Prefix"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 分組清單 */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {groups.length === 0 && (
          <div className="text-xs text-stone-400 italic p-3 text-center">{t("apiMap.noApis")}</div>
        )}
        {groups.map(([gName, list]) => {
          const open = openGroup[gName] !== false; // 預設展開
          return (
            <div key={gName}>
              <button onClick={() => setOpenGroup(prev => ({ ...prev, [gName]: !open }))}
                className="w-full flex items-center gap-1 text-xs font-bold text-stone-500 hover:text-stone-700 px-1 py-0.5">
                <span className="text-[10px]">{open ? "▾" : "▸"}</span>
                {mode === "feature" && gName !== UNMAPPED_KEY ? (
                  <>
                    <span className="font-mono shrink-0" style={{ color: accentText }}>{gName}</span>
                    <span className="truncate">{featNames.get(gName) || "?"}</span>
                  </>
                ) : mode === "feature" ? (
                  <span className="text-stone-400">📦 {t("apiMap.unmapped")}</span>
                ) : (
                  <span className="font-mono">{gName}</span>
                )}
                <span className="text-stone-400 font-normal shrink-0">({list.length})</span>
              </button>
              {open && list.map(a => {
                const key = `${a.method} ${a.path}`;
                const isExpanded = expanded === key;
                const color = METHOD_COLORS[a.method] || "#78716c";
                return (
                  <div key={key} className="ml-1">
                    <button onClick={() => { setExpanded(isExpanded ? null : key); onPick(a.method, a.path); }}
                      className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left hover:bg-stone-50 group"
                      data-testid="api-map-row">
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 w-11 text-center text-white" style={{ backgroundColor: color }}>{a.method}</span>
                      <span className="text-[11px] font-mono text-stone-700 truncate flex-1" title={a.path}>{a.path}</span>
                      {a.callChain?.length ? <span className="text-[9px] text-stone-400 shrink-0" title={`${a.callChain.length} call chain`}>⛓{a.callChain.length}</span> : null}
                    </button>
                    {isExpanded && (
                      <div className="ml-4 mr-1 mb-1 p-2 rounded-lg border space-y-1.5" style={{ borderColor: borderLight, background: "#fafaf9" }}>
                        {a.file && (
                          <button onClick={() => onOpenFile(`${rootPath}/${a.file}`)}
                            className="block text-[10px] font-mono text-left hover:underline break-all" style={{ color: accentText }}>
                            📄 {a.file}
                          </button>
                        )}
                        {a.featureIds && a.featureIds.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {a.featureIds.map(fid => (
                              <span key={fid} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: "#f0f9ff", color: accentText }}>{fid}</span>
                            ))}
                          </div>
                        )}
                        {a.callChain && a.callChain.length > 0 && (
                          <div className="text-[10px] font-mono text-stone-500 space-y-0.5">
                            {(a.callChain.slice(0, 12)).map((c, i) => (
                              <div key={i} className={c.resolved === false ? "text-stone-400 italic" : ""} style={{ paddingLeft: c.depth * 10 }}>
                                {c.depth === 0 ? "▸ " : "└ "}{c.function}
                              </div>
                            ))}
                          </div>
                        )}
                        <button onClick={() => askAbout(a)}
                          className="text-[10px] px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium"
                          data-testid="api-map-ask">
                          💬 {t("apiMap.askAi")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
