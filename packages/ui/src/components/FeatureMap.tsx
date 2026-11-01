/**
 * ApiMapView — API-first code understanding panel（原 FeatureMap，2026-11-01 改造）
 *
 * 資料源：GET /api/coding-project/api-features?path=<projRoot>
 * 左：category 分組樹（每日練習/錯題本/…）→ entry（POST /api/attempt — 提交作答）
 * 右：API detail — name/description/bizLogic + Process Flow + Validation + Data Touch
 *     + codeFiles/tests + severity
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface FlowStep { step?: number | string; action?: string; detail?: string; file?: string }
interface ValidationRule { field?: string; rule?: string; on?: string; fail?: string }
interface DataTouch { table?: string; ops?: string[] }

interface ApiFeature {
  id: string;
  category: string;
  entry: string;
  name: string;
  description?: string;
  bizLogic?: string;
  processFlow?: FlowStep[];
  validation?: ValidationRule[];
  dataTouch?: DataTouch[];
  codeFiles?: string[];
  tests?: string[];
  severity?: string | null;
  aiUnderstanding?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface UiFlowStep { step?: number | string; action?: string; component?: string }
interface UiFeature {
  id: string; category: string; route: string; name: string; description?: string;
  uiFlow?: UiFlowStep[]; components?: string[]; stateMgmt?: string;
  apiCalls?: string[]; codeFiles?: string[]; tests?: string[]; severity?: string;
  createdAt?: string; updatedAt?: string;
}

interface Props {
  rootPath: string;
  refreshKey?: number; // 外部資料更新訊號（CU 完成）→ 重新載入（tab 常駐 CSS hide 不會 remount）
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

const SEV_STYLES: Record<string, { bg: string; text: string; dot: string; descKey: string }> = {
  S0: { bg: "#f0fdf4", text: "#16a34a", dot: "🟢", descKey: "apiMap.sevS0" },
  S1: { bg: "#fefce8", text: "#ca8a04", dot: "🟡", descKey: "apiMap.sevS1" },
  S2: { bg: "#fef2f2", text: "#dc2626", dot: "🔴", descKey: "apiMap.sevS2" },
};

const OP_COLOR: Record<string, string> = { select: "#16a34a", insert: "#2563eb", update: "#d97706", delete: "#dc2626" };

const methodOf = (entry: string) => (entry.trim().split(/\s+/)[0] || "").toUpperCase();
const METHOD_COLORS: Record<string, string> = {
  GET: "#16a34a",
  POST: "#2563eb",
  PUT: "#d97706",
  PATCH: "#9333ea",
  DELETE: "#dc2626",
};

export default function ApiMapView({ rootPath, theme, onOpenFile, refreshKey }: Props) {
  const { t } = useI18n();
  const [apis, setApis] = useState<ApiFeature[]>([]);
  const [uis, setUis] = useState<UiFeature[]>([]);
  const [mode, setMode] = useState<"api" | "ui">("api");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());

  const inputStyle = { background: theme.bg, color: theme.text, borderColor: theme.borderLight } as React.CSSProperties;

  const fetchApis = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/api-features?path=${encodeURIComponent(rootPath)}`);
      const data = await res.json();
      const resUi = await fetch(`${API_BASE}/api/coding-project/ui-features?path=${encodeURIComponent(rootPath)}`).catch(() => null);
      const dataUi = resUi ? await resUi.json().catch(() => ({})) : {};
      if (Array.isArray(dataUi.uis)) setUis(dataUi.uis);
      else setUis([]);
      if (Array.isArray(data.apis)) {
        setApis(data.apis);
        // 預設全部 category 展開（API + UI 兩邊）
        setOpenCats(new Set([...data.apis.map((a: ApiFeature) => a.category), ...dataUi.uis.map((u: UiFeature) => u.category)]));
      } else {
        setFetchError(data.error || `HTTP ${res.status}`);
        setApis([]);
      }
    } catch (err) {
      setFetchError(`連線失敗: ${err instanceof Error ? err.message : String(err)}`);
      setApis([]);
    }
    setLoading(false);
  }, [rootPath]);

  useEffect(() => { fetchApis(); }, [fetchApis, refreshKey]);

  // 搜尋過濾（entry/route / name / category / description / id）
  const items = useMemo(() => mode === "api"
    ? apis.map(a => ({ id: a.id, category: a.category, entry: a.entry, name: a.name, description: a.description || "", severity: a.severity || undefined, raw: a as ApiFeature | UiFeature }))
    : uis.map(u => ({ id: u.id, category: u.category, entry: u.route, name: u.name, description: u.description || "", severity: u.severity || undefined, raw: u as ApiFeature | UiFeature }))
  , [mode, apis, uis]);
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(it =>
      `${it.entry} ${it.name} ${it.category} ${it.description} ${it.id}`.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  // category 分組（維持回傳順序）
  const byCategory = useMemo(() => {
    const m = new Map<string, { id: string; category: string; entry: string; name: string; severity?: string | undefined; raw: ApiFeature | UiFeature }[]>();
    for (const it of filtered) {
      if (!m.has(it.category)) m.set(it.category, []);
      m.get(it.category)!.push(it);
    }
    return [...m.entries()];
  }, [filtered]);

  const selectedApi = mode === "api" ? apis.find(a => a.id === selectedId) || null : null;
  const selectedUi = mode === "ui" ? uis.find(u => u.id === selectedId) || null : null;

  const toggleCat = (cat: string) => setOpenCats(prev => {
    const n = new Set(prev);
    if (n.has(cat)) n.delete(cat); else n.add(cat);
    return n;
  });

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* === Left: Category → Entry 樹 === */}
      <div className="w-80 flex flex-col border-r shrink-0" style={{ borderColor: theme.borderLight }}>
        {/* Header */}
        <div className="px-3 py-2 flex items-center justify-between gap-2" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
          <span className="text-sm font-semibold truncate" style={{ color: theme.text }}>
            {mode === "api" ? "🌐" : "🖥️"} {mode === "api" ? t("apiMap.title") : t("uiMap.title")}
          </span>
          <span className="text-[10px] shrink-0" style={{ color: theme.text, opacity: 0.5 }}>
            {filtered.length}/{items.length}
          </span>
          <button onClick={() => fetchApis()} className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: theme.bg, color: theme.text, opacity: 0.5 }} title={t("apiMap.refresh")}>
            ↻
          </button>
        </div>

        {/* Mode toggle：🌐 API / 🖥️ UI（前端 route-first） */}
        <div className="px-3 pt-2 pb-1 flex gap-1">
          {([["api", `🌐 ${t("uiMap.modeApi")}`], ["ui", `🖥️ ${t("uiMap.modeUi")}`]] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => { setMode(m); setSelectedId(null); }}
              className="flex-1 text-xs px-2 py-1 rounded font-semibold"
              style={{
                background: mode === m ? theme.accentBg : theme.bg,
                color: mode === m ? theme.accent : theme.text,
                border: `1px solid ${mode === m ? theme.accent : theme.borderLight}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-3 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t("apiMap.searchPlaceholder")}
            className="w-full text-xs px-2 py-1 rounded border outline-none"
            style={inputStyle}
          />
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              {t("apiMap.loading")}
            </div>
          ) : apis.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center" style={{ color: theme.text, opacity: 0.4 }}>
              <div className="text-3xl">{mode === "api" ? "🌐" : "🖥️"}</div>
              <div className="text-sm">{fetchError ? `❌ ${fetchError}` : mode === "api" ? t("apiMap.empty") : t("uiMap.empty")}</div>
              <div className="text-xs">{mode === "api" ? t("apiMap.emptyHint") : t("uiMap.emptyHint")}</div>
            </div>
          ) : byCategory.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              {t("apiMap.noMatch")}
            </div>
          ) : byCategory.map(([cat, list]) => {
            const open = openCats.has(cat);
            return (
              <div key={cat} style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                {/* Category header */}
                <button
                  onClick={() => toggleCat(cat)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-left"
                  style={{ background: theme.bgMuted }}
                >
                  <span className="text-[10px]" style={{ color: theme.text, opacity: 0.5 }}>{open ? "▾" : "▸"}</span>
                  <span className="text-xs font-bold truncate flex-1" style={{ color: theme.text }}>{cat}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-bold" style={{ background: theme.accentBg, color: theme.accent }}>{list.length}</span>
                </button>
                {/* Entries */}
                {open && list.map(a => {
                  const method = methodOf(a.entry);
                  const mColor = METHOD_COLORS[method] || theme.accent;
                  const sv = a.severity ? (SEV_STYLES[a.severity] || null) : null;
                  const isSelected = a.id === selectedId;
                  return (
                    <div
                      key={a.id}
                      onClick={() => setSelectedId(a.id)}
                      className="px-3 py-2 cursor-pointer border-t transition-colors"
                      style={{ borderColor: theme.borderLight, background: isSelected ? theme.accentBg : "transparent" }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                    >
                      <div className="flex items-center gap-1.5">
                        {mode === "api"
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded font-bold font-mono shrink-0" style={{ background: theme.bg, color: mColor }}>{method}</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0" style={{ background: theme.bg, color: theme.accent }}>🖥️</span>}
                        <span className="text-xs font-mono truncate flex-1" style={{ color: theme.text }} title={a.entry}>{a.entry.replace(/^\w+\s+/, "")}</span>
                        {sv && <span title={`${a.severity} — ${t(sv.descKey)}`} className="text-[10px] font-bold shrink-0" style={{ color: sv.text }}>{sv.dot}</span>}
                      </div>
                      <div className="text-xs truncate mt-0.5" style={{ color: theme.text, opacity: 0.6 }} title={a.name}>{a.name}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* === Right: API Detail === */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {mode === "ui" && selectedUi ? (
          <UiDetail ui={selectedUi} theme={theme} t={t as (k: string) => string} onOpenFile={onOpenFile} />
        ) : !selectedApi ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">{mode === "api" ? "🌐" : "🖥️"}</div>
            <div className="text-sm">{t("apiMap.selectPrompt")}</div>
          </div>
        ) : (
          <ApiDetail api={selectedApi} theme={theme} t={t as (k: string) => string} onOpenFile={onOpenFile} />
        )}
      </div>
    </div>
  );
}

// ── 通用 Section ──
function Section({ title, count, theme, children }: {
  title: string;
  count?: number;
  theme: Props["theme"];
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${theme.borderLight}` }}>
      <div className="px-3 py-1.5 flex items-center gap-2" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
        <span className="text-sm font-semibold" style={{ color: theme.text, opacity: 0.55 }}>{title}</span>
        {count != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: theme.accentBg, color: theme.accent }}>{count}</span>}
      </div>
      <div className="p-2 flex flex-col gap-1">{children}</div>
    </div>
  );
}

// ── 檔案 chip（點擊開 editor）──
function FileChip({ file, theme, onOpenFile }: { file: string; theme: Props["theme"]; onOpenFile?: (p: string) => void }) {
  return (
    <button
      onClick={() => onOpenFile?.(file)}
      className="text-left text-xs px-2 py-1 rounded font-mono hover:underline break-all"
      style={{ background: theme.bgMuted, color: theme.accent }}
      title={file}
    >
      {file}
    </button>
  );
}

// ── API Detail ──
function ApiDetail({ api, theme, t, onOpenFile }: {
  api: ApiFeature;
  theme: Props["theme"];
  t: (k: string) => string;
  onOpenFile?: (p: string) => void;
}) {
  const method = methodOf(api.entry);
  const mColor = METHOD_COLORS[method] || theme.accent;
  const sv = api.severity ? (SEV_STYLES[api.severity] || null) : null;
  const flow = api.processFlow || [];
  const validation = api.validation || [];
  const dataTouch = api.dataTouch || [];
  const codeFiles = api.codeFiles || [];
  const tests = api.tests || [];
  const thStyle: React.CSSProperties = { color: theme.text, opacity: 0.55, fontWeight: 600, textAlign: "left", padding: "4px 8px", whiteSpace: "nowrap" };
  const tdStyle: React.CSSProperties = { color: theme.text, padding: "4px 8px", verticalAlign: "top" };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[10px] px-2 py-0.5 rounded font-bold font-mono" style={{ background: theme.bg, color: mColor }}>{method}</span>
          <span className="text-sm font-mono font-bold break-all" style={{ color: theme.text }}>{api.entry}</span>
          {sv && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0" style={{ background: sv.bg, color: sv.text }} title={t(sv.descKey)}>{sv.dot} {api.severity}</span>}
          <span className="text-[10px] font-mono ml-auto shrink-0" style={{ color: theme.text, opacity: 0.4 }}>{api.id}</span>
        </div>
        <h2 className="text-sm font-bold" style={{ color: theme.text }}>{api.name}</h2>
        {api.category && <div className="text-[10px] mt-0.5" style={{ color: theme.text, opacity: 0.45 }}>🏷️ {api.category}</div>}
        {api.description && <p className="text-xs mt-1 leading-relaxed" style={{ color: theme.text, opacity: 0.6 }}>{api.description}</p>}
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* 商業邏輯 */}
        {api.bizLogic && (
          <Section title={`📖 ${t("apiMap.bizLogic")}`} theme={theme}>
            <div className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: theme.text, opacity: 0.8 }}>{api.bizLogic}</div>
          </Section>
        )}

        {/* Process Flow */}
        {flow.length > 0 && (
          <Section title={`🔀 ${t("apiMap.processFlow")}`} count={flow.length} theme={theme}>
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                  <th style={{ ...thStyle, width: "2rem" }}>#</th>
                  <th style={{ ...thStyle, width: "7rem" }}>{t("apiMap.colAction")}</th>
                  <th style={thStyle}>{t("apiMap.colDetail")}</th>
                  <th style={{ ...thStyle, width: "30%" }}>{t("apiMap.colFile")}</th>
                </tr>
              </thead>
              <tbody>
                {flow.map((s, i) => (
                  <tr key={i} style={{ borderBottom: i < flow.length - 1 ? `1px solid ${theme.borderLight}` : undefined }}>
                    <td style={{ ...tdStyle, opacity: 0.5, fontWeight: 700 }}>{s.step ?? i + 1}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{s.action || "—"}</td>
                    <td style={{ ...tdStyle, opacity: 0.8 }}>{s.detail || "—"}</td>
                    <td style={tdStyle}>
                      {s.file ? <FileChip file={s.file} theme={theme} onOpenFile={onOpenFile} /> : <span style={{ opacity: 0.35 }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Validation */}
        {validation.length > 0 && (
          <Section title={`✅ ${t("apiMap.validation")}`} count={validation.length} theme={theme}>
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                  <th style={{ ...thStyle, width: "18%" }}>{t("apiMap.colField")}</th>
                  <th style={{ ...thStyle, width: "34%" }}>{t("apiMap.colRule")}</th>
                  <th style={{ ...thStyle, width: "18%" }}>{t("apiMap.colOn")}</th>
                  <th style={thStyle}>{t("apiMap.colFail")}</th>
                </tr>
              </thead>
              <tbody>
                {validation.map((v, i) => (
                  <tr key={i} style={{ borderBottom: i < validation.length - 1 ? `1px solid ${theme.borderLight}` : undefined }}>
                    <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{v.field || "—"}</td>
                    <td style={{ ...tdStyle, opacity: 0.8 }}>{v.rule || "—"}</td>
                    <td style={{ ...tdStyle, opacity: 0.8 }}>{v.on || "—"}</td>
                    <td style={{ ...tdStyle, opacity: 0.8 }}>{v.fail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Data Touch */}
        {dataTouch.length > 0 && (
          <Section title={`🗄️ ${t("apiMap.dataTouch")}`} count={dataTouch.length} theme={theme}>
            <div className="flex flex-col gap-1">
              {dataTouch.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded" style={{ background: theme.bgMuted }}>
                  <span className="font-mono truncate" style={{ color: theme.text }} title={d.table}>{d.table}</span>
                  <span className="ml-auto flex gap-0.5 shrink-0">
                    {(d.ops || []).map(op => (
                      <span key={op} className="text-[10px] px-1 rounded font-bold font-mono" style={{ background: theme.bg, color: OP_COLOR[op.toLowerCase()] || "#a8a29e" }}>{op}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Code Files */}
        {codeFiles.length > 0 && (
          <Section title={`📄 ${t("apiMap.codeFiles")}`} count={codeFiles.length} theme={theme}>
            <div className="flex flex-col gap-1">
              {codeFiles.map(f => <FileChip key={f} file={f} theme={theme} onOpenFile={onOpenFile} />)}
            </div>
          </Section>
        )}

        {/* Tests */}
        {tests.length > 0 && (
          <Section title={`🧪 ${t("apiMap.tests")}`} count={tests.length} theme={theme}>
            <div className="flex flex-col gap-1">
              {tests.map(f => <FileChip key={f} file={f} theme={theme} onOpenFile={onOpenFile} />)}
            </div>
          </Section>
        )}

        {/* Meta */}
        {(api.createdAt || api.updatedAt) && (
          <div className="text-[10px]" style={{ color: theme.text, opacity: 0.35 }}>
            {api.createdAt ? `${t("apiMap.createdAt")} ${String(api.createdAt).slice(0, 16).replace("T", " ")}` : ""}
            {api.updatedAt ? ` · ${t("apiMap.updatedAt")} ${String(api.updatedAt).slice(0, 16).replace("T", " ")}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

// ── UI Detail（前端 route-first，2026-11-01）──
function UiDetail({ ui, theme, t, onOpenFile }: {
  ui: UiFeature;
  theme: Props["theme"];
  t: (k: string) => string;
  onOpenFile?: (p: string) => void;
}) {
  const sv = ui.severity ? (SEV_STYLES[ui.severity] || null) : null;
  const flow = ui.uiFlow || [];
  const components = ui.components || [];
  const apiCalls = ui.apiCalls || [];
  const codeFiles = ui.codeFiles || [];
  const tests = ui.tests || [];
  const thStyle: React.CSSProperties = { color: theme.text, opacity: 0.55, fontWeight: 600, textAlign: "left", padding: "4px 8px", whiteSpace: "nowrap" };
  const tdStyle: React.CSSProperties = { color: theme.text, padding: "4px 8px", verticalAlign: "top" };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ background: theme.bg, color: theme.accent }}>🖥️ PAGE</span>
          <span className="text-sm font-mono font-bold break-all" style={{ color: theme.text }}>{ui.route}</span>
          {sv && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0" style={{ background: sv.bg, color: sv.text }} title={t(sv.descKey)}>{sv.dot} {ui.severity}</span>}
          <span className="text-[10px] font-mono ml-auto shrink-0" style={{ color: theme.text, opacity: 0.4 }}>{ui.id}</span>
        </div>
        <h2 className="text-sm font-bold" style={{ color: theme.text }}>{ui.name}</h2>
        {ui.category && <div className="text-[10px] mt-0.5" style={{ color: theme.text, opacity: 0.45 }}>🏷️ {ui.category}</div>}
        {ui.description && <p className="text-xs mt-1 leading-relaxed" style={{ color: theme.text, opacity: 0.6 }}>{ui.description}</p>}
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* State 管理 */}
        {ui.stateMgmt && (
          <Section title={`⚙️ ${t("uiMap.stateMgmt")}`} theme={theme}>
            <div className="text-xs leading-relaxed" style={{ color: theme.text, opacity: 0.8 }}>{ui.stateMgmt}</div>
          </Section>
        )}

        {/* UI Flow */}
        {flow.length > 0 && (
          <Section title={`🔀 ${t("uiMap.uiFlow")}`} count={flow.length} theme={theme}>
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                  <th style={{ ...thStyle, width: "2rem" }}>#</th>
                  <th style={thStyle}>{t("uiMap.colAction")}</th>
                  <th style={{ ...thStyle, width: "30%" }}>{t("uiMap.colComponent")}</th>
                </tr>
              </thead>
              <tbody>
                {flow.map((f, i) => (
                  <tr key={i} style={{ borderBottom: i < flow.length - 1 ? `1px solid ${theme.borderLight}` : undefined }}>
                    <td style={{ ...tdStyle, opacity: 0.5, fontWeight: 700 }}>{f.step ?? i + 1}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{f.action || "—"}</td>
                    <td style={tdStyle}>{f.component || <span style={{ opacity: 0.35 }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* API Calls（前後端橋樑） */}
        {apiCalls.length > 0 && (
          <Section title={`🔗 ${t("uiMap.apiCalls")}`} count={apiCalls.length} theme={theme}>
            <div className="flex flex-wrap gap-1">
              {apiCalls.map((c, i) => {
                const m = methodOf(c);
                return (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold" style={{ background: theme.bgMuted, color: METHOD_COLORS[m] || theme.accent }} title={c}>{c}</span>
                );
              })}
            </div>
          </Section>
        )}

        {/* Components */}
        {components.length > 0 && (
          <Section title={`🧩 ${t("uiMap.components")}`} count={components.length} theme={theme}>
            <div className="flex flex-col gap-1">
              {components.map(f => <FileChip key={f} file={f} theme={theme} onOpenFile={onOpenFile} />)}
            </div>
          </Section>
        )}

        {/* Code Files */}
        {codeFiles.length > 0 && (
          <Section title={`📄 ${t("apiMap.codeFiles")}`} count={codeFiles.length} theme={theme}>
            <div className="flex flex-col gap-1">
              {codeFiles.map(f => <FileChip key={f} file={f} theme={theme} onOpenFile={onOpenFile} />)}
            </div>
          </Section>
        )}

        {/* Tests */}
        {tests.length > 0 && (
          <Section title={`🧪 ${t("apiMap.tests")}`} count={tests.length} theme={theme}>
            <div className="flex flex-col gap-1">
              {tests.map(f => <FileChip key={f} file={f} theme={theme} onOpenFile={onOpenFile} />)}
            </div>
          </Section>
        )}

        {(ui.createdAt || ui.updatedAt) && (
          <div className="text-[10px]" style={{ color: theme.text, opacity: 0.35 }}>
            {ui.createdAt ? `${t("apiMap.createdAt")} ${String(ui.createdAt).slice(0, 16).replace("T", " ")}` : ""}
            {ui.updatedAt ? ` · ${t("apiMap.updatedAt")} ${String(ui.updatedAt).slice(0, 16).replace("T", " ")}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
