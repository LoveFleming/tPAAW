/**
 * RuView — 🧭 Release Unit 主區分類頁（每個 RU 分類開一個 tab）
 *
 * sidebar 目錄點分類 → 主區開 tab 顯示該分類 model 內容（rich UI）：
 *   🎯 Features 卡片牆（可展開檔案/API/測試）
 *   ⚡ APIs 表格（prefix 篩選 + method 色票 + handler 直連）
 *   📁 Files 對應表（hot unmapped + feature 認領）
 *   🧪 Tests 對照表（test ↔ production file）
 *   🕘 Change History 時間軸（kind 篩選 + feature chips）
 *   🔗 Dependencies / 🤖 AI Work / ⚙️ Configuration — 部分資料說明卡
 *   📋 Specs / 📕 Runbooks / 🚀 Deployment / 🔐 Security / 🚨 Incidents — 未建置狀態（Runbooks 列缺口清單）
 *
 * 資料源同 RuTree：GET /api/ru/model（deterministic，零 LLM）。
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";

// ── Model types（與 server 對應，寬鬆防禦）──
interface RuApi { method: string; path: string; file?: string | null; handler?: string | null; featureIds?: string[] }
interface RuTest { testFile: string; productionFile: string; testCount?: number; featureIds?: string[] }
interface RuChange { hash: string; date: string; subject: string; kind?: string; files?: number; featureIds?: string[] }
interface RuFeature {
  id: string; name: string; status?: string; description?: string;
  fileCount?: number; files?: string[]; apiCount?: number; apis?: string[];
  testCount?: number; tests?: string[]; changeCount?: number;
}
interface RuModel {
  root?: string; generatedAt?: string; headSha?: string; stale?: boolean;
  summary?: { features?: number; apis?: number; apisWithFeature?: number; files?: number; filesMapped?: number; tests?: number; commits?: number };
  features?: RuFeature[]; apis?: RuApi[]; tests?: RuTest[]; changes?: RuChange[];
  knowledgeGaps?: {
    featuresWithoutTests?: any[]; featuresWithoutRunbooks?: any[];
    apisWithoutFeature?: any[]; filesWithoutFeature?: any[];
    hotUnmappedFiles?: { file: string; commits: number }[];
  };
}

export type RuCategory = "features" | "apis" | "files" | "deps" | "tests" | "changes" | "aiwork" | "config" | "specs" | "runbooks" | "deploy" | "security" | "incidents";

export const RU_CATEGORY_META: { key: RuCategory; icon: string; labelKey: string }[] = [
  { key: "features", icon: "🎯", labelKey: "ruTree.features" },
  { key: "apis", icon: "⚡", labelKey: "ruTree.apis" },
  { key: "files", icon: "📁", labelKey: "ruTree.files" },
  { key: "deps", icon: "🔗", labelKey: "ruTree.dependencies" },
  { key: "tests", icon: "🧪", labelKey: "ruTree.tests" },
  { key: "changes", icon: "🕘", labelKey: "ruTree.changeHistory" },
  { key: "aiwork", icon: "🤖", labelKey: "ruTree.aiWorkHistory" },
  { key: "config", icon: "⚙️", labelKey: "ruTree.configuration" },
  { key: "specs", icon: "📋", labelKey: "ruTree.specs" },
  { key: "runbooks", icon: "📕", labelKey: "ruTree.runbooks" },
  { key: "deploy", icon: "🚀", labelKey: "ruTree.deployment" },
  { key: "security", icon: "🔐", labelKey: "ruTree.security" },
  { key: "incidents", icon: "🚨", labelKey: "ruTree.incidents" },
];

const METHOD_COLOR: Record<string, string> = {
  GET: "#0ea5e9", POST: "#16a34a", PUT: "#d97706", PATCH: "#a855f7",
  DELETE: "#dc2626", HEAD: "#6b7280", OPTIONS: "#6b7280",
};

function joinPath(root: string, rel: string): string {
  const r = (root || "").replace(/[\\/]+$/, "");
  return `${r}/${rel}`;
}
function baseName(p: string): string { return p.split(/[\\/]/).slice(-2).join("/"); }
function shortDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1].slice(2)}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : iso.slice(0, 11);
}

interface Props {
  category: RuCategory;
  rootPath: string;
  theme: any;
  onOpenFile: (absPath: string) => void;
}

export default function RuView({ category, rootPath, theme, onOpenFile }: Props) {
  const { t } = useI18n();
  const [model, setModel] = useState<RuModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/api/ru/model?path=${encodeURIComponent(rootPath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (!d || !Array.isArray(d.features)) throw new Error("bad model payload");
      setModel(d);
    } catch (e: any) { setError(e?.message || "failed"); } finally { setLoading(false); }
  }, [rootPath]);
  useEffect(() => { setModel(null); load(); }, [load]);

  const meta = RU_CATEGORY_META.find(m => m.key === category);
  const gaps = model?.knowledgeGaps;
  const sm = model?.summary;
  const accent = theme?.accent || "#0ea5e9";
  const accentBg = theme?.accentBg || "#f0f9ff";
  const accentText = theme?.accentText || "#0369a1";
  const borderLight = theme?.borderLight || "#f0f0f0";

  const FileLink = ({ file, children }: { file: string; children?: React.ReactNode }) => (
    <button onClick={() => onOpenFile(joinPath(rootPath, file))}
      className="font-mono text-[11px] text-left hover:underline break-all"
      style={{ color: accentText }} title={joinPath(rootPath, file)}>
      {children ?? file}
    </button>
  );
  const FeatureChip = ({ id }: { id: string }) => (
    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0" style={{ backgroundColor: accentBg, color: accentText }}>{id}</span>
  );
  const StatBox = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" }) => (
    <div className="px-3 py-2 rounded-lg border" style={{ borderColor: borderLight, background: tone === "warn" ? "#fffbeb" : "#fff" }}>
      <div className="text-[10px] text-stone-400 font-medium">{label}</div>
      <div className={`text-sm font-bold ${tone === "warn" ? "text-amber-600" : "text-stone-700"}`}>{value}</div>
    </div>
  );
  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-xs font-bold text-stone-600 mb-2">{children}</h3>
  );
  const NotBuilt = ({ hint }: { hint?: string }) => (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
      <span className="text-3xl opacity-40">{meta?.icon}</span>
      <p className="text-sm text-stone-500 font-medium">{t("ruTree.notBuilt")}</p>
      <p className="text-xs text-stone-400 max-w-md">{hint || t("ruTree.planned")}</p>
    </div>
  );

  if (!rootPath) return <div className="flex items-center justify-center h-full text-xs text-stone-400">{t("ruTree.noProject")}</div>;
  if (loading && !model) return <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-stone-400"><span className="animate-pulse text-2xl">🧭</span>{t("ruTree.loading")}</div>;
  if (error && !model) return (
    <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
      <span className="text-2xl">🧭</span>
      <p className="text-xs text-stone-500">{t("ruTree.noModel")}</p>
      <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium">{t("ruTree.retry")}</button>
    </div>
  );
  if (!model) return null;

  const body = (() => {
    switch (category) {
      // ═══ 🎯 Features：卡片牆 + 展開細節 ═══
      case "features": {
        const noTests = gaps?.featuresWithoutTests?.length ?? 0;
        return (
          <div className="space-y-4" data-testid="ru-features">
            <div className="grid grid-cols-4 gap-2">
              <StatBox label={t("ruTree.features")} value={sm?.features ?? model.features?.length ?? 0} />
              <StatBox label={t("ruTree.apis")} value={sm?.apis ?? 0} />
              <StatBox label={t("ruTree.tests")} value={sm?.tests ?? 0} />
              <StatBox label={t("ruTree.noTests")} value={noTests} tone={noTests ? "warn" : undefined} />
            </div>
            <FeaturesGrid features={model.features || []} t={t} accent={accent} borderLight={borderLight} accentText={accentText} FileLink={FileLink} />
          </div>
        );
      }
      // ═══ ⚡ APIs：表格 + prefix 篩選 ═══
      case "apis": {
        return <ApisTable apis={model.apis || []} t={t} borderLight={borderLight} accentText={accentText} FeatureChip={FeatureChip} FileLink={FileLink} />;
      }
      // ═══ 📁 Files：對應表 + hot unmapped ═══
      case "files": {
        const file2feat = new Map<string, string[]>();
        for (const f of (model.features || [])) for (const file of (f.files || [])) {
          if (!file2feat.has(file)) file2feat.set(file, []);
          file2feat.get(file)!.push(f.id);
        }
        const mapped = [...file2feat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const hot = (gaps?.hotUnmappedFiles || []).slice(0, 30);
        const noOwner = gaps?.filesWithoutFeature?.length ?? 0;
        return (
          <div className="space-y-5" data-testid="ru-files">
            <div className="grid grid-cols-3 gap-2">
              <StatBox label={t("ruTree.mapped")} value={`${sm?.filesMapped ?? 0} / ${sm?.files ?? 0}`} />
              <StatBox label="🔥 " value={gaps?.hotUnmappedFiles?.length ?? 0} tone={(gaps?.hotUnmappedFiles?.length ?? 0) ? "warn" : undefined} />
              <StatBox label={t("ru.view.noFeature")} value={noOwner} />
            </div>
            {!!hot.length && (
              <div>
                <SectionTitle>🔥 {t("ruTree.hotUnmapped")}</SectionTitle>
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
                  {hot.map((h, i) => (
                    <div key={h.file} className={`flex items-center gap-3 px-3 py-1.5 ${i % 2 ? "bg-stone-50" : "bg-white"}`}>
                      <span className="shrink-0 text-[10px] font-bold text-amber-600 w-10 text-right">{h.commits}×</span>
                      <FileLink file={h.file}>{h.file}</FileLink>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <SectionTitle>📁 {t("ruTree.mapped")} · {t("ru.view.mappedTo")}</SectionTitle>
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
                {mapped.slice(0, 200).map(([file, fids], i) => (
                  <div key={file} className={`flex items-center gap-3 px-3 py-1.5 ${i % 2 ? "bg-stone-50" : "bg-white"}`}>
                    <FileLink file={file} />
                    <span className="flex gap-1 ml-auto">{fids.map(fid => <FeatureChip key={fid} id={fid} />)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }
      // ═══ 🔗 Dependencies ═══
      case "deps":
        return <NotBuilt hint={t("ruTree.depsHint")} />;
      // ═══ 🧪 Tests：對照表 ═══
      case "tests": {
        const rows = (model.tests || []).slice(0, 200);
        return (
          <div className="space-y-4" data-testid="ru-tests">
            <div className="grid grid-cols-3 gap-2">
              <StatBox label={t("ruTree.tests")} value={sm?.tests ?? rows.length} />
              <StatBox label={t("ru.view.testsTarget")} value={new Set(rows.map(r => r.productionFile)).size} />
              <StatBox label={t("ruTree.noTests")} value={gaps?.featuresWithoutTests?.length ?? 0} tone={(gaps?.featuresWithoutTests?.length) ? "warn" : undefined} />
            </div>
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
              <div className="grid grid-cols-[1.2fr_auto_1.2fr] px-3 py-1.5 text-[10px] font-bold text-stone-400 bg-stone-50" style={{ borderBottom: `1px solid ${borderLight}` }}>
                <span>🧪 {t("ruTree.tests")}</span><span className="text-center w-10">n</span><span>{t("ru.view.testsTarget")}</span>
              </div>
              {rows.map((r, i) => (
                <div key={`${r.testFile}-${i}`} className={`grid grid-cols-[1.2fr_auto_1.2fr] items-center px-3 py-1.5 gap-2 ${i % 2 ? "bg-stone-50" : "bg-white"}`}>
                  <FileLink file={r.testFile} />
                  <span className="text-[10px] font-bold text-stone-400 w-10 text-center">{r.testCount ?? ""}</span>
                  {r.productionFile ? <FileLink file={r.productionFile} /> : <span className="text-[11px] text-stone-300">—</span>}
                </div>
              ))}
            </div>
          </div>
        );
      }
      // ═══ 🕘 Change History：時間軸 + kind 篩選 ═══
      case "changes":
        return <ChangesTimeline changes={model.changes || []} t={t} borderLight={borderLight} accentText={accentText} FeatureChip={FeatureChip} />;
      // ═══ 🤖 AI Work / ⚙️ Configuration ═══
      case "aiwork":
        return <NotBuilt hint={t("ruTree.aiWorkHint")} />;
      case "config":
        return (
          <div className="space-y-3" data-testid="ru-config">
            <SectionTitle>⚙️ {t("ruTree.configuration")}</SectionTitle>
            <div className="rounded-lg border divide-y" style={{ borderColor: borderLight }}>
              {[
                ["📦 Package", rootPath.split(/[\\/]/).pop() || rootPath],
                ["🗂 Root", rootPath],
                ["🧪 Loop", t("ruTree.configLoop") + " · mini"],
                ["🎯 Features", String(sm?.features ?? 0)],
                ["⚡ APIs", String(sm?.apis ?? 0)],
                ["🧪 Tests", String(sm?.tests ?? 0)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 px-3 py-2 bg-white">
                  <span className="text-xs text-stone-500 w-28 shrink-0">{k}</span>
                  <span className="text-xs font-mono text-stone-700 break-all">{v}</span>
                </div>
              ))}
            </div>
          </div>
        );
      // ═══ 未建置（R6+）═══
      case "specs": return <NotBuilt />;
      case "runbooks": {
        const list = gaps?.featuresWithoutRunbooks || [];
        return (
          <div className="space-y-4" data-testid="ru-runbooks">
            <div className="px-4 py-3 rounded-lg border border-amber-200 bg-amber-50">
              <p className="text-xs text-amber-700 font-medium">📕 {t("ruTree.runbooksHint")}</p>
              <p className="text-xs text-amber-600 mt-0.5">{t("ru.view.runbooksGap")} — {list.length} ⌀</p>
            </div>
            {!!list.length && (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
                {list.map((g: any, i: number) => (
                  <div key={g.id || i} className={`flex items-center gap-3 px-3 py-1.5 ${i % 2 ? "bg-stone-50" : "bg-white"}`}>
                    <FeatureChip id={g.id || `F-${String(i + 1).padStart(3, "0")}`} />
                    <span className="text-xs text-stone-600 truncate">{g.name || ""}</span>
                    <span className="ml-auto text-[10px] text-amber-500">⌀ runbook</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }
      case "deploy": return <NotBuilt />;
      case "security": return <NotBuilt />;
      case "incidents": return <NotBuilt />;
      default: return null;
    }
  })();

  return (
    <div className="flex flex-col h-full" data-testid="ru-view">
      {/* header */}
      <div className="px-4 py-2 flex items-center gap-2 shrink-0" style={{ borderBottom: `1px solid ${borderLight}` }}>
        <span className="text-sm">{meta?.icon}</span>
        <h2 className="text-sm font-bold text-stone-700">{t(meta?.labelKey || "ruTree.features")}</h2>
        <span className="text-[10px] text-stone-400 truncate">{t("ruTree.updated")} {shortDate(model.generatedAt)} @ {model.headSha?.slice(0, 7) || "—"}</span>
        {model.stale && <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-semibold border border-amber-200">{t("ruTree.stale")}</span>}
        <button onClick={load} title={t("ruTree.refresh")} className="ml-auto shrink-0 px-1.5 rounded hover:bg-stone-100 text-xs">🔄</button>
      </div>
      {/* body */}
      <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: "thin" }}>{body}</div>
    </div>
  );
}

// ═══ Features 卡片牆 ═══
function FeaturesGrid({ features, t, accent, borderLight, accentText, FileLink }: any) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-2 gap-2">
      {features.map((f: RuFeature) => {
        const open = openId === f.id;
        return (
          <div key={f.id} className="rounded-lg border bg-white overflow-hidden" style={{ borderColor: open ? accent : borderLight }}>
            <button onClick={() => setOpenId(open ? null : f.id)} className="w-full text-left px-3 py-2 hover:bg-stone-50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold shrink-0" style={{ color: accentText }}>{f.id}</span>
                <span className="text-xs font-semibold text-stone-700 truncate flex-1">{f.name}</span>
                {f.status === "active" && <span className="text-[9px] text-emerald-500 shrink-0">●</span>}
                <span className="text-[9px] text-stone-300 shrink-0">{open ? "▾" : "▸"}</span>
              </div>
              {f.description && <p className="text-[10px] text-stone-400 mt-0.5 line-clamp-2">{f.description}</p>}
              <div className="flex gap-2 mt-1 text-[10px] text-stone-500">
                <span>📁 {f.fileCount ?? (f.files || []).length}</span>
                <span>⚡ {f.apiCount ?? (f.apis || []).length}</span>
                <span className={f.testCount ? "" : "text-amber-500"}>🧪 {f.testCount ?? 0}</span>
                <span>🕘 {f.changeCount ?? 0}</span>
              </div>
            </button>
            {open && (
              <div className="px-3 pb-2 space-y-1.5" style={{ borderTop: `1px solid ${borderLight}`, paddingTop: 6 }}>
                <div>
                  <div className="text-[9px] font-bold text-stone-400 mb-0.5">📁 {t("ruTree.files")}</div>
                  {(f.files || []).map((file: string) => <div key={file}><FileLink file={file}>{baseName(file)}</FileLink></div>)}
                  {!(f.files || []).length && <span className="text-[10px] text-stone-300">—</span>}
                </div>
                <div>
                  <div className="text-[9px] font-bold text-stone-400 mb-0.5">⚡ {t("ruTree.apis")}</div>
                  {(f.apis || []).slice(0, 20).map((api: string) => <div key={api} className="text-[10px] font-mono text-stone-500 break-all">{api}</div>)}
                  {!(f.apis || []).length && <span className="text-[10px] text-stone-300">—</span>}
                </div>
                <div>
                  <div className="text-[9px] font-bold text-stone-400 mb-0.5">🧪 {t("ruTree.tests")}</div>
                  {(f.tests || []).map((tf: string) => <div key={tf}><FileLink file={tf}>{baseName(tf)}</FileLink></div>)}
                  {!(f.tests || []).length && <span className="text-[10px] text-amber-500">{t("ruTree.noTests")}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══ APIs 表格 ═══
function ApisTable({ apis, t, borderLight, accentText, FeatureChip, FileLink }: any) {
  const [group, setGroup] = useState<string>("__all__");
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of apis as RuApi[]) {
      const seg = (a.path || "").split("/").filter(Boolean);
      const key = seg.length >= 2 ? `/${seg[0]}/${seg[1]}` : (seg[0] || "/");
      m.set(key, (m.get(key) || 0) + 1);
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [apis]);
  const rows = (group === "__all__" ? apis : apis.filter((a: RuApi) => {
    const seg = (a.path || "").split("/").filter(Boolean);
    const key = seg.length >= 2 ? `/${seg[0]}/${seg[1]}` : (seg[0] || "/");
    return key === group;
  })) as RuApi[];
  return (
    <div className="space-y-3" data-testid="ru-apis">
      {/* prefix 篩選 chips */}
      <div className="flex flex-wrap gap-1">
        <button onClick={() => setGroup("__all__")}
          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors ${group === "__all__" ? "bg-stone-700 text-white border-stone-700" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}>
          {t("ru.view.all")} · {apis.length}
        </button>
        {groups.map(([g, n]) => (
          <button key={g} onClick={() => setGroup(g)}
            className={`text-[10px] px-2 py-0.5 rounded-full border font-mono transition-colors ${group === g ? "bg-stone-700 text-white border-stone-700" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}>
            {g} · {n}
          </button>
        ))}
      </div>
      {/* table */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
        <div className="grid grid-cols-[64px_1.4fr_1.2fr_auto] px-3 py-1.5 text-[10px] font-bold text-stone-400 bg-stone-50 gap-2" style={{ borderBottom: `1px solid ${borderLight}` }}>
          <span>METHOD</span><span>PATH</span><span>{t("ru.view.handler")}</span><span>{t("ruTree.features")}</span>
        </div>
        {rows.slice(0, 300).map((a, i) => (
          <div key={`${a.method}-${a.path}-${i}`} className={`grid grid-cols-[64px_1.4fr_1.2fr_auto] items-center px-3 py-1.5 gap-2 ${i % 2 ? "bg-stone-50" : "bg-white"}`}>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white text-center shrink-0" style={{ backgroundColor: METHOD_COLOR[a.method] || "#6b7280" }}>{a.method}</span>
            <span className="text-[11px] font-mono text-stone-700 break-all">{a.path}</span>
            {a.file
              ? <FileLink file={a.file}>{baseName(a.file)}{a.handler ? ` · ${a.handler}()` : ""}</FileLink>
              : <span className="text-[10px] text-stone-300">{t("ru.view.noHandler")}</span>}
            <span className="flex gap-1 justify-end flex-wrap max-w-[140px]">{(a.featureIds || []).map(fid => <FeatureChip key={fid} id={fid} />)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ Change History 時間軸 ═══
function ChangesTimeline({ changes, t, borderLight, accentText, FeatureChip }: any) {
  const [kind, setKind] = useState<string>("__all__");
  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of changes as RuChange[]) { const k = c.kind || "other"; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [changes]);
  const rows = (kind === "__all__" ? changes : (changes as RuChange[]).filter(c => (c.kind || "other") === kind));
  return (
    <div className="space-y-3" data-testid="ru-changes">
      <div className="flex flex-wrap gap-1">
        <button onClick={() => setKind("__all__")}
          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors ${kind === "__all__" ? "bg-stone-700 text-white border-stone-700" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}>
          {t("ru.view.all")} · {changes.length}
        </button>
        {kinds.map(([k, n]) => (
          <button key={k} onClick={() => setKind(k)}
            className={`text-[10px] px-2 py-0.5 rounded-full border font-mono transition-colors ${kind === k ? "bg-stone-700 text-white border-stone-700" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}>
            {k} · {n}
          </button>
        ))}
      </div>
      <div className="space-y-0">
        {rows.slice(0, 100).map((c: RuChange) => (
          <div key={c.hash} className="flex gap-3 px-2 py-2 border-b hover:bg-stone-50 transition-colors" style={{ borderColor: borderLight }}>
            <div className="flex flex-col items-end shrink-0 w-20 text-[9px] text-stone-400 font-mono">
              <span>{c.hash.slice(0, 7)}</span>
              <span>{shortDate(c.date)}</span>
            </div>
            <div className="w-1 rounded-full shrink-0" style={{ backgroundColor: c.kind === "feat" ? "#16a34a" : c.kind === "fix" ? "#dc2626" : "#d6d3d1" }} title={c.kind || ""} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-stone-700 leading-snug break-words">{c.subject}</div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {c.kind && <span className="text-[9px] px-1 rounded bg-stone-100 text-stone-500 font-medium">{c.kind}</span>}
                {typeof c.files === "number" && <span className="text-[9px] text-stone-400">📁 {c.files}</span>}
                {(c.featureIds || []).map(fid => <FeatureChip key={fid} id={fid} />)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
