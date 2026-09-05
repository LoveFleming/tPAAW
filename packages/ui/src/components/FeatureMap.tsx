/**
 * FeatureMap — Feature-centric code understanding panel
 *
 * Left: Feature list with status badges and search
 * Right: Feature detail showing code files, APIs, tests, runbooks, issues,
 *        AI understanding, and editable documentation
 */
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import { FeatureCockpit } from "./FeatureCockpit";
import API_BASE from "../api";

interface ApiEntry {
  method: string;
  path: string;
  file: string;
}

interface IssueSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
}

interface Feature {
  id: string;
  name: string;
  description: string;
  status: "active" | "deprecated" | "planned";
  codeFiles: string[];
  apis: ApiEntry[];
  tests: string[];
  runbooks: string[];
  issues: string[];
  tags: string[];
  aiUnderstanding: string;
  aiUnderstandingAt: string | null;
  documentation: string;
  docsUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _issueSummaries?: IssueSummary[];
}

interface Props {
  rootPath: string;
  refreshKey?: number; // 2026-09-04：外部資料更新訊號（CU 完成/掃描完成）→ 重新載入（tab 常駐 CSS hide 不會 remount，需要顯式刷新）
  theme: {
    bg: string;
    bgMuted: string;
    borderLight: string;
    accent: string;
    accentBg: string;
    text: string;
  };
  onOpenFile?: (path: string) => void;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: "#f0fdf4", text: "#16a34a", label: "Active" },
  deprecated: { bg: "#f5f5f4", text: "#78716c", label: "Deprecated" },
  planned: { bg: "#eff6ff", text: "#2563eb", label: "Planned" },
};

const HTTP_COLORS: Record<string, string> = {
  GET: "#16a34a",
  POST: "#2563eb",
  PUT: "#d97706",
  PATCH: "#9333ea",
  DELETE: "#dc2626",
};

export default function FeatureMap({ rootPath, theme, onOpenFile, refreshKey }: Props) {
  const { t } = useI18n();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingDocs, setEditingDocs] = useState(false);
  const [docsContent, setDocsContent] = useState("");
  const [savingDocs, setSavingDocs] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<"features" | "files">("features");
  const [fetchError, setFetchError] = useState<string | null>(null);
  // RU model + callChain（Feature Cockpit 資料源 — deterministic，零 LLM）
  const [ruModel, setRuModel] = useState<any>(null);
  const [callChainMap, setCallChainMap] = useState<Map<string, any> | null>(null);
  // Error codes by feature（2026-09-05 v2 — LLM 語意整理，不認命名慣例）
  const [ecData, setEcData] = useState<any>(null);
  const [ecBusy, setEcBusy] = useState(false);
  const loadErrorCodes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/error-codes?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) {
        const d = await res.json();
        setEcData(d.missing ? null : d);
      }
    } catch { /* 缺檔 — silent */ }
  }, [rootPath]);
  useEffect(() => { loadErrorCodes(); }, [loadErrorCodes, refreshKey]);
  const ecMap = React.useMemo(() => {
    const m = new Map<string, { uniqueCount: number }>();
    for (const g of ecData?.byFeature || []) m.set(g.featureId, { uniqueCount: g.uniqueCount || g.codes?.length || 0 });
    return m;
  }, [ecData]);
  const ecRescan = async () => {
    setEcBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/error-codes/rescan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: rootPath }) });
      if (res.ok) {
        const d = await res.json();
        setEcData(d.skipped || d.missing ? null : d);
      }
    } catch {} setEcBusy(false);
  };
  useEffect(() => {
    let cancelled = false;
    setRuModel(null); setCallChainMap(null);
    (async () => {
      try {
        const [mRes, cRes] = await Promise.all([
          fetch(`${API_BASE}/api/ru/model?path=${encodeURIComponent(rootPath)}`),
          fetch(`${API_BASE}/api/ru/code-intel?path=${encodeURIComponent(rootPath)}`),
        ]);
        if (mRes.ok) { const m = await mRes.json(); if (!cancelled) setRuModel(m.model || m); }
        if (cRes.ok) {
          const c = await cRes.json();
          const map = new Map<string, any>();
          for (const r of c?.apiMap?.routes || []) {
            if (r.callChain?.length) map.set(`${r.method} ${r.path}`, r.callChain);
          }
          if (!cancelled) setCallChainMap(map);
        }
      } catch { /* model 未建時 silent — detail fallback 舊 sections */ }
    })();
    return () => { cancelled = true; };
  }, [rootPath, refreshKey]); // refreshKey：CU 重跑後 RU model / callChain 也要重抓

  const basePath = `${API_BASE}/api/coding-features?path=${encodeURIComponent(rootPath)}`;

  const fetchFeatures = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "";
      const url = `${basePath}${searchParam}`;
      console.log("[FeatureMap] fetching:", url);
      const res = await fetch(url);
      const text = await res.text();
      console.log("[FeatureMap] status:", res.status, "body length:", text.length, "first 200:", text.slice(0, 200));
      console.log("[FeatureMap] headers: X-Features-Path=", res.headers.get("X-Features-Path"), "X-Features-Count=", res.headers.get("X-Features-Count"), "X-Features-Exists=", res.headers.get("X-Features-Exists"));
      try {
        const data = JSON.parse(text);
        const loaded = data.features || [];
        console.log("[FeatureMap] loaded features:", loaded.length, loaded.length > 0 ? loaded[0]?.id : "(empty)");
        if (loaded.length === 0 && data.error) {
          console.error("[FeatureMap] API returned error:", data.error);
          setFetchError(data.error);
        }
        setFeatures(loaded);
      } catch (parseErr) {
        console.error("[FeatureMap] JSON parse error:", parseErr.message, "raw:", text.slice(0, 500));
        setFetchError(`API 回應格式錯誤: ${parseErr.message}`);
        setFeatures([]);
      }
    } catch (err) {
      console.error("[FeatureMap] fetch error:", err);
      setFetchError(`連線失敗: ${err.message}`);
    }
    setLoading(false);
  }, [basePath, searchQuery, refreshKey]);

  useEffect(() => { fetchFeatures(); }, [fetchFeatures]);

  const selected = features.find(f => f.id === selectedId);

  // ── Refresh all feature mappings (AI re-scan) ──
  const handleRefreshMapping = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-features/refresh-mapping?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        await fetchFeatures();
        alert(`✅ ${t("feature.refreshed")} ${data.updated}/${data.total}`);
      } else {
        alert(`❌ ${data.error}`);
      }
    } catch (err) {
      alert("Refresh failed: " + err.message);
    }
    setRefreshing(false);
  };

  // ── Save documentation ──
  const handleSaveDocs = async () => {
    if (!selectedId) return;
    setSavingDocs(true);
    try {
      await fetch(`${API_BASE}/api/coding-features/${encodeURIComponent(selectedId)}/docs?path=${encodeURIComponent(rootPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentation: docsContent }),
      });
      setFeatures(prev => prev.map(f => f.id === selectedId ? { ...f, documentation: docsContent, docsUpdatedAt: new Date().toISOString() } : f));
      setEditingDocs(false);
    } catch (err) {
      alert("Save failed: " + err.message);
    }
    setSavingDocs(false);
  };

  // ── Create feature ──
  const handleCreate = async (name: string, description: string) => {
    try {
      const res = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (res.ok) {
        setShowCreate(false);
        await fetchFeatures();
      }
    } catch (err) {
      alert("Create failed: " + err.message);
    }
  };

  // ── Delete feature ──
  const handleDelete = async (id: string) => {
    if (!confirm(`Delete feature ${id}?`)) return;
    try {
      await fetch(`${API_BASE}/api/coding-features/${encodeURIComponent(id)}?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" });
      if (selectedId === id) setSelectedId(null);
      await fetchFeatures();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  const inputStyle = {
    background: theme.bg,
    color: theme.text,
    borderColor: theme.borderLight,
  } as React.CSSProperties;

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* === Left: Feature List === */}
      <div className="w-80 flex flex-col border-r shrink-0" style={{ borderColor: theme.borderLight }}>
        {/* Header */}
        <div className="px-3 py-2 flex flex-col gap-1.5" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: theme.text }}>
              🗺️ {t("feature.title")}
            </span>
            <div className="flex gap-1">
              <button onClick={ecRescan} disabled={ecBusy} className="text-xs px-1.5 py-0.5 rounded" style={{ background: theme.accentBg, color: theme.accent, opacity: ecBusy ? 0.5 : 1 }} title={t("feature.ecRescan")}>
                {ecBusy ? "⏳" : "🔢"}
              </button>
              <button onClick={() => handleRefreshMapping()} disabled={refreshing} className="text-xs px-1.5 py-0.5 rounded" style={{ background: refreshing ? theme.bgMuted : theme.accentBg, color: refreshing ? theme.text : theme.accent, opacity: refreshing ? 0.5 : 1 }} title={refreshing ? t("feature.refreshingHint") : t("feature.refreshMapping")}>
                {refreshing ? "⏳" : "🔄"}
              </button>
              {refreshing && <span className="text-xs animate-pulse" style={{ color: theme.accent, opacity: 0.8 }}>{t("feature.refreshingHint")}</span>}
              <button onClick={() => setShowCreate(!showCreate)} className="text-xs px-1.5 py-0.5 rounded" style={{ background: theme.accentBg, color: theme.accent }}>
                +
              </button>
              <button onClick={() => fetchFeatures()} className="text-xs px-1.5 py-0.5 rounded" style={{ background: theme.bg, color: theme.text, opacity: 0.5 }}>
                ↻
              </button>
            </div>
          </div>
          {/* View mode toggle */}
          <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${theme.borderLight}` }}>
            <button
              onClick={() => setViewMode("features")}
              className="flex-1 text-xs py-0.5 transition-colors"
              style={{ background: viewMode === "features" ? theme.accentBg : theme.bg, color: viewMode === "features" ? theme.accent : theme.text, opacity: viewMode === "features" ? 1 : 0.5 }}
            >
              🗺️ {t("feature.byFeature")}
            </button>
            <button
              onClick={() => setViewMode("files")}
              className="flex-1 text-xs py-0.5 transition-colors"
              style={{ background: viewMode === "files" ? theme.accentBg : theme.bg, color: viewMode === "files" ? theme.accent : theme.text, opacity: viewMode === "files" ? 1 : 0.5 }}
            >
              📄 {t("feature.byFile")}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t("feature.searchPlaceholder")}
            className="w-full text-xs px-2 py-1 rounded border outline-none"
            style={inputStyle}
          />
        </div>

        {/* Create form */}
        {showCreate && (
          <CreateFeatureForm onCreate={handleCreate} onCancel={() => setShowCreate(false)} theme={theme} t={t} />
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              {t("feature.loading")}
            </div>
          ) : features.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center" style={{ color: theme.text, opacity: 0.4 }}>
              <div className="text-3xl">🗺️</div>
              <div className="text-sm">{fetchError ? `❌ ${fetchError}` : t("feature.empty")}</div>
              <div className="text-xs">{fetchError ? "請檢查 AI provider 設定或重新執行 Code Understanding" : t("feature.emptyHint")}</div>
            </div>
          ) : viewMode === "features" ? (
            /* Feature list (original) */
            features.map(f => {
              const st = STATUS_STYLES[f.status] || STATUS_STYLES.active;
              const isSelected = f.id === selectedId;
              return (
                <div
                  key={f.id}
                  onClick={() => { setSelectedId(f.id); setEditingDocs(false); }}
                  className="px-3 py-2.5 cursor-pointer border-b transition-colors"
                  style={{ borderColor: theme.borderLight, background: isSelected ? theme.accentBg : "transparent" }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-mono shrink-0" style={{ color: theme.text, opacity: 0.5 }}>{f.id}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                  </div>
                  <div className="text-sm font-medium truncate" style={{ color: theme.text }}>{f.name}</div>
                  {f.description && (
                    <div className="text-xs truncate mt-0.5" style={{ color: theme.text, opacity: 0.4 }}>{f.description}</div>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: theme.text, opacity: 0.5 }}>
                    {f.codeFiles.length > 0 && <span>📄 {f.codeFiles.length}</span>}
                    {ecMap.get(f.id)?.uniqueCount ? <span>🔢 {ecMap.get(f.id)!.uniqueCount}</span> : null}
                    {f.apis.length > 0 && <span>🌐 {f.apis.length}</span>}
                    {f.tests.length > 0 && <span>🧪 {f.tests.length}</span>}
                    {f.issues.length > 0 && <span>🐛 {f.issues.length}</span>}
                    {f.aiUnderstanding && <span>🤖 ✅</span>}
                    {f.documentation && <span>📖 ✅</span>}
                  </div>
                </div>
              );
            })
          ) : (
            /* File → Feature list (reverse view) */
            <FileToFeatureList features={features} theme={theme} t={t} searchQuery={searchQuery} onSelectFeature={(id) => { setSelectedId(id); setEditingDocs(false); }} onOpenFile={onOpenFile} />
          )}
        </div>
      </div>

      {/* === Right: Feature Detail === */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">🗺️</div>
            <div className="text-sm">{t("feature.selectPrompt")}</div>
          </div>
        ) : (
          <FeatureDetail
            feature={selected}
            theme={theme}
            t={t}
            onOpenFile={onOpenFile}
            ruModel={ruModel}
            callChainMap={callChainMap}
            editingDocs={editingDocs}
            docsContent={docsContent}
            setDocsContent={setDocsContent}
            setEditingDocs={setEditingDocs}
            onSaveDocs={handleSaveDocs}
            savingDocs={savingDocs}
            onDelete={() => handleDelete(selected.id)}
            rootPath={rootPath}
          />
        )}
      </div>
    </div>
  );
}

// ── Create Feature Form ──
function CreateFeatureForm({ onCreate, onCancel, theme, t }: {
  onCreate: (name: string, description: string) => void;
  onCancel: () => void;
  theme: any;
  t: (k: string) => string;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const inputStyle = { background: theme.bg, color: theme.text, borderColor: theme.borderLight } as React.CSSProperties;

  return (
    <div className="px-3 py-2 flex flex-col gap-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={t("feature.namePlaceholder")}
        className="text-sm px-2 py-1 rounded border outline-none"
        style={inputStyle}
        autoFocus
      />
      <input
        type="text"
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder={t("feature.descPlaceholder")}
        className="text-xs px-2 py-1 rounded border outline-none"
        style={inputStyle}
      />
      <div className="flex gap-1">
        <button onClick={() => name.trim() && onCreate(name, desc)} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>
          ✅ {t("feature.create")}
        </button>
        <button onClick={onCancel} className="text-xs px-2 py-1 rounded" style={{ background: theme.bgMuted, color: theme.text }}>
          {t("feature.cancel")}
        </button>
      </div>
    </div>
  );
}

// ── Feature Detail ──
function FeatureDetail({ feature, theme, t, onOpenFile, ruModel, callChainMap, editingDocs, docsContent, setDocsContent, setEditingDocs, onSaveDocs, savingDocs, onDelete, rootPath }: {
  feature: Feature;
  theme: any;
  t: (k: string) => string;
  onOpenFile?: (p: string) => void;
  ruModel?: any;
  callChainMap?: Map<string, any> | null;
  editingDocs: boolean;
  docsContent: string;
  setDocsContent: (s: string) => void;
  setEditingDocs: (b: boolean) => void;
  onSaveDocs: () => void;
  savingDocs: boolean;
  onDelete: () => void;
  rootPath: string;
}) {
  const st = STATUS_STYLES[feature.status] || STATUS_STYLES.active;

  // RU model 對應的 deterministic feature（有 → 用 Feature Cockpit 呈現；無 → fallback 舊 sections）
  const ruFeature = (ruModel?.features || []).find((x: any) => x.id === feature.id) || null;
  // Cockpit 用 FileLink（點檔開 editor tab）
  const CockpitFileLink = useCallback(({ file, children }: { file: string; children?: React.ReactNode }) => (
    <button onClick={() => onOpenFile?.(file)} className="font-mono text-sm text-left hover:underline break-all" style={{ color: theme.accent }} title={file}>
      {children ?? file}
    </button>
  ), [onOpenFile, theme.accent]);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-2" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono" style={{ color: theme.text, opacity: 0.5 }}>{feature.id}</span>
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: st.bg, color: st.text }}>{st.label}</span>
            {((feature.tags || [])).map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: theme.bg, color: theme.text, opacity: 0.6 }}>🏷️ {tag}</span>
            ))}
          </div>
          <h2 className="text-lg font-bold" style={{ color: theme.text }}>{feature.name}</h2>
          {feature.description && <p className="text-sm mt-1" style={{ color: theme.text, opacity: 0.6 }}>{feature.description}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={onDelete} className="text-xs px-2 py-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>🗑️</button>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* 🔢 Error Codes by feature（v2 — LLM 語意整理，不認命名慣例；只讀掃描產物）*/}
        {ecData && (() => {
          const g = ecMap.get(feature.id);
          const codes = ecData.byFeature?.find((x: any) => x.featureId === feature.id)?.codes || [];
          const summary = ecData.byFeature?.find((x: any) => x.featureId === feature.id)?.summary;
          return (
            <Section title={`🔢 ${t("feature.ecTitle")}`} count={g?.uniqueCount || 0} theme={theme}>
              {ecData.recommendation?.suggest && (
                <div className="px-2 py-1.5 rounded text-xs whitespace-pre-wrap" style={{ background: "#fef3c7", color: "#b45309" }}>
                  📋 {t("feature.ecRecommend")}{ecData.recommendation.plan ? `\n\n${ecData.recommendation.plan}` : ""}
                </div>
              )}
              {summary && <div className="px-2 py-1 text-xs" style={{ color: theme.text, opacity: 0.6 }}>{summary}</div>}
              {codes.length === 0 && <div className="text-xs px-2 py-1" style={{ color: theme.text, opacity: 0.45 }}>{t("feature.ecEmpty")}</div>}
              {codes.map((c: any, i: number) => (
                <div key={`${c.code || c.message}-${c.file}-${c.line}-${i}`} className="flex items-center gap-2 text-xs px-2 py-1 rounded flex-wrap" style={{ background: theme.bgMuted }}>
                  <span title={c.kind === "throw" ? "throw / raise 位置" : c.kind === "http" ? "HTTP status 回應" : "error 參考/調用"}>{c.kind === "throw" ? "🚨" : c.kind === "http" ? "🌐" : "📄"}</span>
                  {c.code
                    ? <span className="font-mono font-bold" style={{ color: theme.accent }}>{c.code}</span>
                    : <span className="italic" style={{ color: theme.text }}>{c.message || "(no message)"}</span>}
                  {c.code && c.message ? <span style={{ color: theme.text, opacity: 0.5 }}>{c.message}</span> : null}
                  {c.httpStatus ? <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: theme.accentBg, color: theme.accent }}>{c.httpStatus}</span> : null}
                  <button onClick={() => onOpenFile?.(c.file)} className="font-mono hover:underline truncate" style={{ color: theme.text, opacity: 0.55 }}>{c.file}{c.line ? `:${c.line}` : ""}</button>
                  {c.note ? <span className="opacity-50" title={c.note}>💡</span> : null}
                </div>
              ))}
            </Section>
          );
        })()}

        {/* 🛗 Feature Cockpit（RU model deterministic 全景 — Entry Points 調用鏈 / Code Structure / Tests kind / Changes）*/}
        {ruFeature && ruModel && (
          <FeatureCockpit
            feature={ruFeature} model={ruModel} callChainMap={callChainMap}
            t={t} accent={theme.accent} borderLight={theme.borderLight} accentText={theme.accent}
            FileLink={CockpitFileLink}
          />
        )}

        {/* fallback 舊 sections（RU model 沒資料時才顯示，避免跟 cockpit 重複）*/}
        {!ruFeature && (<>
        {/* Code Files */}
        <Section title={`📄 ${t("feature.codeFiles")}`} count={(feature.codeFiles || []).length} theme={theme}>
          {(feature.codeFiles || []).map(f => (
            <button key={f} onClick={() => onOpenFile?.(f)} className="block text-sm text-left px-2 py-1 rounded font-mono hover:underline" style={{ background: theme.bgMuted, color: theme.accent }}>
              {f}
            </button>
          ))}
        </Section>

        {/* API Endpoints */}
        <Section title={`🌐 ${t("feature.apis")}`} count={(feature.apis || []).length} theme={theme}>
          {(feature.apis || []).map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-sm px-2 py-1 rounded" style={{ background: theme.bgMuted }}>
              <span className="font-mono font-bold text-xs px-1.5 py-0.5 rounded" style={{ background: theme.bg, color: HTTP_COLORS[a.method] || theme.text }}>{a.method}</span>
              <span className="font-mono" style={{ color: theme.text }}>{a.path}</span>
              <span className="text-xs ml-auto" style={{ color: theme.text, opacity: 0.4 }}>{a.file}</span>
            </div>
          ))}
        </Section>

        {/* Tests */}
        <Section title={`🧪 ${t("feature.tests")}`} count={(feature.tests || []).length} theme={theme}>
          {(feature.tests || []).map(f => (
            <button key={f} onClick={() => onOpenFile?.(f)} className="block text-sm text-left px-2 py-1 rounded font-mono hover:underline" style={{ background: theme.bgMuted, color: theme.accent }}>
              {f}
            </button>
          ))}
        </Section>
        </>)}

        {/* Runbooks */}
        <Section title={`📖 ${t("feature.runbooks")}`} count={(feature.runbooks || []).length} theme={theme}>
          {(feature.runbooks || []).map(f => (
            <button key={f} onClick={() => onOpenFile?.(f)} className="block text-sm text-left px-2 py-1 rounded font-mono hover:underline" style={{ background: theme.bgMuted, color: theme.accent }}>
              {f}
            </button>
          ))}
        </Section>

        {/* Linked Issues */}
        <Section title={`🐛 ${t("feature.issues")}`} count={(feature._issueSummaries || []).length} theme={theme}>
          {(feature._issueSummaries || []).map(iss => {
            const ist = { bg: iss.status === "open" ? "#fef2f2" : "#f0fdf4", text: iss.status === "open" ? "#dc2626" : "#16a34a" };
            return (
              <div key={iss.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded" style={{ background: theme.bgMuted }}>
                <span className="font-mono text-xs" style={{ color: theme.text, opacity: 0.5 }}>{iss.id}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: ist.bg, color: ist.text }}>{iss.status}</span>
                <span style={{ color: theme.text }}>{iss.title}</span>
              </div>
            );
          })}
        </Section>

        {/* AI Understanding */}
        {feature.aiUnderstanding && (
          <div className="rounded-lg p-4" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold" style={{ color: theme.text }}>🤖 {t("feature.aiUnderstanding")}</h3>
              <span className="text-xs" style={{ color: theme.text, opacity: 0.4 }}>
                {feature.aiUnderstandingAt ? new Date(feature.aiUnderstandingAt).toLocaleString() : ""}
              </span>
            </div>
            <pre className="text-sm whitespace-pre-wrap font-sans" style={{ color: theme.text }}>{feature.aiUnderstanding}</pre>
          </div>
        )}

        {/* Documentation */}
        <div className="rounded-lg p-4" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold" style={{ color: theme.text }}>📖 {t("feature.documentation")}</h3>
            <div className="flex items-center gap-2">
              {feature.docsUpdatedAt && <span className="text-xs" style={{ color: theme.text, opacity: 0.4 }}>{new Date(feature.docsUpdatedAt).toLocaleString()}</span>}
              {!editingDocs ? (
                <button onClick={() => { setEditingDocs(true); setDocsContent(feature.documentation || ""); }} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>
                  ✏️ {t("feature.edit")}
                </button>
              ) : (
                <>
                  <button onClick={onSaveDocs} disabled={savingDocs} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>
                    {savingDocs ? "..." : `💾 ${t("feature.save")}`}
                  </button>
                  <button onClick={() => setEditingDocs(false)} className="text-xs px-2 py-1 rounded" style={{ background: theme.bg, color: theme.text }}>
                    {t("feature.cancel")}
                  </button>
                </>
              )}
            </div>
          </div>
          {editingDocs ? (
            <textarea
              value={docsContent}
              onChange={e => setDocsContent(e.target.value)}
              rows={10}
              className="w-full text-sm p-2 rounded border outline-none resize-y font-mono"
              style={{ background: theme.bg, color: theme.text, borderColor: theme.borderLight }}
              placeholder={t("feature.docsPlaceholder")}
            />
          ) : feature.documentation ? (
            <pre className="text-sm whitespace-pre-wrap font-sans" style={{ color: theme.text }}>{feature.documentation}</pre>
          ) : (
            <p className="text-sm" style={{ color: theme.text, opacity: 0.3 }}>{t("feature.noDocs")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── File → Feature reverse view ──
function FileToFeatureList({ features, theme, t, searchQuery, onSelectFeature, onOpenFile }: {
  features: Feature[];
  theme: any;
  t: (k: string) => string;
  searchQuery: string;
  onSelectFeature: (id: string) => void;
  onOpenFile?: (p: string) => void;
}) {
  // Build file → [features] map
  const fileMap: Record<string, { id: string; name: string; type: string }[]> = {};
  for (const f of features) {
    for (const file of f.codeFiles || []) {
      if (!fileMap[file]) fileMap[file] = [];
      fileMap[file].push({ id: f.id, name: f.name, type: "📄" });
    }
    for (const file of f.tests || []) {
      if (!fileMap[file]) fileMap[file] = [];
      fileMap[file].push({ id: f.id, name: f.name, type: "🧪" });
    }
    for (const file of f.runbooks || []) {
      if (!fileMap[file]) fileMap[file] = [];
      fileMap[file].push({ id: f.id, name: f.name, type: "📖" });
    }
    for (const a of f.apis || []) {
      if (a.file && !fileMap[a.file]) fileMap[a.file] = [];
      if (a.file) fileMap[a.file].push({ id: f.id, name: f.name, type: "🌐" });
    }
  }

  const sortedFiles = Object.keys(fileMap).sort();
  const filtered = searchQuery
    ? sortedFiles.filter(f => f.toLowerCase().includes(searchQuery.toLowerCase()))
    : sortedFiles;

  // Group by directory
  const grouped: Record<string, { file: string; features: { id: string; name: string; type: string }[] }[]> = {};
  for (const file of filtered) {
    const dir = file.split("/").slice(0, -1).join("/") || ".";
    if (!grouped[dir]) grouped[dir] = [];
    grouped[dir].push({ file, features: fileMap[file] });
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center" style={{ color: theme.text, opacity: 0.4 }}>
        <div className="text-3xl">📄</div>
        <div className="text-sm">{t("feature.noFiles")}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="px-3 py-1.5 text-xs" style={{ color: theme.text, opacity: 0.4, borderBottom: `1px solid ${theme.borderLight}` }}>
        {filtered.length} {t("feature.filesMapped")}
      </div>
      {Object.entries(grouped).map(([dir, entries]) => (
        <div key={dir}>
          <div className="px-3 py-1 text-xs font-mono sticky top-0" style={{ color: theme.text, opacity: 0.3, background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}` }}>
            📁 {dir}/
          </div>
          {entries.map(({ file, features: feats }) => (
            <div
              key={file}
              className="px-3 py-1.5 border-b flex items-center gap-2"
              style={{ borderColor: theme.borderLight }}
            >
              <button
                onClick={() => onOpenFile?.(file)}
                className="text-sm font-mono truncate flex-1 text-left hover:underline"
                style={{ color: theme.accent }}
                title={file}
              >
                {file.split("/").pop()}
              </button>
              <div className="flex flex-wrap gap-1 shrink-0">
                {feats.map((ft, i) => {
                  const feat = features.find(f => f.id === ft.id);
                  const st = feat ? STATUS_STYLES[feat.status] || STATUS_STYLES.active : null;
                  return (
                    <button
                      key={i}
                      onClick={() => onSelectFeature(ft.id)}
                      className="text-xs px-1.5 py-0.5 rounded transition-opacity hover:opacity-100"
                      style={{ background: st?.bg || theme.bgMuted, color: st?.text || theme.text, opacity: 0.7 }}
                      title={`${ft.type} ${ft.name}`}
                    >
                      {ft.type} {ft.id}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Section helper ──
function Section({ title, count, theme, children }: {
  title: string;
  count: number;
  theme: any;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase mb-2" style={{ color: theme.text, opacity: 0.5 }}>
        {title} <span style={{ opacity: 0.5 }}>({count})</span>
      </h3>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
