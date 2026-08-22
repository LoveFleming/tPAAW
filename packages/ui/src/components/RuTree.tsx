/**
 * RuTree — 🧭 Release Unit 左側樹（coding app sidebar 第二視圖）
 *
 * 「Workspace 才是工作的主人」：Release Unit Model 從 panel 報表升級為導航第一原則。
 * 資料源：GET /api/ru/model（全量，程式生成零 LLM）— No answer without evidence 的 UI 版本：
 * 每個可點節點都連到真東西（檔案 / handler / test / commit），沒資料的節點灰色 disabled。
 *
 * 三層呈現：
 *   可互動（綠）: Features / APIs / Files / Tests / Change History
 *   部分資料（黃）: AI Work History / Configuration（tech stack）
 *   未建置（灰）: Specs / Runbooks / Deployment / Security / Incidents — R6+，
 *                 knowledgeGaps 數字照顯示（看得到的工作項，不是死連結）
 *
 * 展開狀態：section 層存 localStorage（paaw.ruTree.open），feature 子層不存。
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";

// ── Model types（server lib/release-unit/model.mjs 對應，寬鬆防禦）──
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
    featuresWithoutTests?: any[]; featuresWithoutRunbooks?: any[]; apisWithoutFeature?: any[];
    filesWithoutFeature?: any[]; hotUnmappedFiles?: { file: string; commits: number }[];
  };
}

interface Props {
  rootPath: string;
  theme: any;
  onOpenFile: (absPath: string) => void;
}

const STORAGE_KEY = "paaw.ruTree.open";

const METHOD_COLOR: Record<string, string> = {
  GET: "#0ea5e9", POST: "#16a34a", PUT: "#d97706", PATCH: "#a855f7",
  DELETE: "#dc2626", HEAD: "#6b7280", OPTIONS: "#6b7280",
};

function joinPath(root: string, rel: string): string {
  const r = (root || "").replace(/[\\/]+$/, "");
  return `${r}/${rel}`;
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : iso.slice(0, 11);
}

export default function RuTree({ rootPath, theme, onOpenFile }: Props) {
  const { t } = useI18n();
  const [model, setModel] = useState<RuModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openFeatures, setOpenFeatures] = useState<Set<string>>(new Set());

  // 展開狀態恢復（section 層）
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) setOpen(new Set(saved));
    } catch { /* ignore */ }
  }, []);

  const persist = useCallback((next: Set<string>) => {
    setOpen(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback((key: string) => {
    persist(new Set(open.has(key) ? [...open].filter(k => k !== key) : [...open, key]));
  }, [open, persist]);

  const toggleFeature = useCallback((id: string) => {
    setOpenFeatures(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/api/ru/model?path=${encodeURIComponent(rootPath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (!d || !Array.isArray(d.features)) throw new Error("bad model payload");
      setModel(d);
    } catch (e: any) {
      setError(e?.message || "failed");
    } finally { setLoading(false); }
  }, [rootPath]);

  useEffect(() => { setModel(null); load(); }, [load]);

  // ── derived：API 分組（path 第二段）──
  const apiGroups = useMemo(() => {
    const apis = model?.apis || [];
    const groups = new Map<string, RuApi[]>();
    for (const a of apis) {
      const seg = (a.path || "").split("/").filter(Boolean);
      const key = seg.length >= 2 ? `/${seg[0]}/${seg[1]}` : (seg[0] || "/");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    }
    return [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
  }, [model]);

  const testFiles = useMemo(() => {
    const seen = new Map<string, number>();
    for (const tst of (model?.tests || [])) seen.set(tst.testFile, (seen.get(tst.testFile) || 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [model]);

  const changes = useMemo(() => (model?.changes || []).slice(0, 30), [model]);
  const gaps = model?.knowledgeGaps;
  const sm = model?.summary;

  // ── 樣式 tokens ──
  const rowHover = theme?.bgHover || "#f5f5f4";
  const textMuted = theme?.textMuted || "#9ca3af";
  const textPrimary = theme?.textPrimary || "#374151";
  const textSecondary = theme?.textSecondary || "#6b7280";
  const borderLight = theme?.borderLight || "#f0f0f0";
  const accent = theme?.accent || "#0ea5e9";

  // ── 載入狀態 ──
  if (!rootPath) {
    return <div className="flex items-center justify-center h-full text-xs text-stone-400 px-4 text-center">{t("ruTree.noProject")}</div>;
  }
  if (loading && !model) {
    return <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-stone-400"><span className="animate-pulse">🧭</span>{t("ruTree.loading")}</div>;
  }
  if (error && !model) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
        <span className="text-2xl">🧭</span>
        <p className="text-xs text-stone-500">{t("ruTree.noModel")}</p>
        <p className="text-[10px] text-stone-400">{t("ruTree.noModelHint")}</p>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium">{t("ruTree.retry")}</button>
      </div>
    );
  }
  if (!model) return null;

  // ── 小元件：section header row ──
  const SectionRow = ({ k, icon, label, count, tone = "live", hint }: { k: string; icon: string; label: string; count?: number | string; tone?: "live" | "partial" | "off"; hint?: string }) => {
    const isOpen = open.has(k);
    const disabled = tone === "off";
    const dotColor = tone === "live" ? "#16a34a" : tone === "partial" ? "#d97706" : textMuted;
    return (
      <div>
        <button
          onClick={() => !disabled && toggle(k)}
          disabled={disabled}
          title={disabled ? (hint || t("ruTree.notBuilt")) : hint}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs font-semibold rounded-md"
          style={{ color: disabled ? textMuted : textPrimary, cursor: disabled ? "default" : "pointer" }}
          onMouseEnter={e => { if (!disabled) e.currentTarget.style.backgroundColor = rowHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <span className="text-[9px] w-1.5 shrink-0" style={{ color: dotColor }}>●</span>
          <span className="w-3.5 shrink-0 text-center">{isOpen && !disabled ? "▾" : "▸"}</span>
          <span className="shrink-0">{icon}</span>
          <span className="truncate flex-1" style={{ fontWeight: disabled ? 400 : 600 }}>{label}</span>
          {count !== undefined && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: disabled ? "#f5f5f4" : (theme?.accentBg || "#f0f9ff"), color: disabled ? textMuted : (theme?.accentText || "#0369a1") }}>
              {count}
            </span>
          )}
        </button>
      </div>
    );
  };

  // ── 小元件：leaf row（檔案/一般條目）──
  const LeafRow = ({ depth, icon, label, title, onClick, badge }: { depth: number; icon?: string; label: string; title?: string; onClick?: () => void; badge?: string }) => (
    <button
      onClick={onClick}
      title={title || label}
      className="w-full flex items-center gap-1.5 text-left text-[11px] py-1 rounded-md"
      style={{ paddingLeft: 8 + depth * 14, color: onClick ? textSecondary : textMuted, cursor: onClick ? "pointer" : "default" }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.backgroundColor = rowHover; }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate flex-1">{label}</span>
      {badge && <span className="shrink-0 text-[9px] px-1 rounded bg-stone-100 text-stone-500">{badge}</span>}
    </button>
  );

  return (
    <div className="flex flex-col h-full" data-testid="ru-tree">
      {/* ── header：generated @ sha + stale + refresh ── */}
      <div className="px-2 py-1 flex items-center gap-1 text-[10px] shrink-0" style={{ borderBottom: `1px solid ${borderLight}`, color: textMuted }}>
        <span className="truncate flex-1" title={model.generatedAt}>
          {t("ruTree.updated")} {shortDate(model.generatedAt)} @ {model.headSha?.slice(0, 7) || "—"}
        </span>
        {model.stale && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-semibold border border-amber-200" title={t("ruTree.staleHint")}>
            {t("ruTree.stale")}
          </span>
        )}
        <button onClick={load} title={t("ruTree.refresh")} className="shrink-0 px-1 rounded hover:bg-stone-100">🔄</button>
      </div>

      {/* ── 樹本體 ── */}
      <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>

        {/* Features */}
        <SectionRow k="features" icon="🎯" label={t("ruTree.features")} count={sm?.features ?? model.features?.length} />
        {open.has("features") && (model.features || []).map(f => (
          <div key={f.id}>
            <button
              onClick={() => toggleFeature(f.id)}
              className="w-full flex items-center gap-1.5 px-2 text-left text-[11px] py-1 rounded-md"
              style={{ paddingLeft: 22, color: textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = rowHover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
              title={f.description || f.id}
            >
              <span className="shrink-0">{openFeatures.has(f.id) ? "▾" : "▸"}</span>
              <span className="shrink-0 font-mono text-[9px]" style={{ color: accent }}>{f.id}</span>
              <span className="truncate flex-1">{f.name}</span>
              {f.status === "active" && <span className="shrink-0 text-[8px] text-emerald-500">●</span>}
            </button>
            {openFeatures.has(f.id) && (
              <div style={{ paddingLeft: 10 }}>
                {(f.files || []).map(file => (
                  <LeafRow key={file} depth={1} icon="📄" label={file.split(/[\\/]/).slice(-2).join("/")} title={joinPath(rootPath, file)} onClick={() => onOpenFile(joinPath(rootPath, file))} />
                ))}
                {(f.apis || []).slice(0, 15).map(api => (
                  <LeafRow key={api} depth={1} icon="⚡" label={api} />
                ))}
                {f.testCount ? <LeafRow depth={1} icon="🧪" label={`${t("ruTree.tests")} · ${f.testCount}`} /> : (
                  <LeafRow depth={1} icon="🧪" label={t("ruTree.noTests")} />
                )}
                <LeafRow depth={1} icon="🕘" label={`${t("ruTree.changeHistory")} · ${f.changeCount ?? 0}`} />
              </div>
            )}
          </div>
        ))}

        {/* APIs */}
        <SectionRow k="apis" icon="⚡" label={t("ruTree.apis")} count={sm?.apis ?? model.apis?.length} />
        {open.has("apis") && apiGroups.map(([group, apis]) => (
          <div key={group}>
            <button
              onClick={() => toggle(`api:${group}`)}
              className="w-full flex items-center gap-1.5 px-2 text-left text-[11px] py-1 rounded-md font-medium"
              style={{ paddingLeft: 22, color: textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = rowHover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <span className="shrink-0">{open.has(`api:${group}`) ? "▾" : "▸"}</span>
              <span className="truncate flex-1 font-mono">{group}</span>
              <span className="shrink-0 text-[9px] px-1 rounded bg-stone-100 text-stone-500">{apis.length}</span>
            </button>
            {open.has(`api:${group}`) && apis.slice(0, 60).map((a, i) => (
              <LeafRow
                key={`${a.method}-${a.path}-${i}`}
                depth={1}
                label={a.path}
                title={a.file ? joinPath(rootPath, a.file) : a.path}
                badge={a.method}
                onClick={a.file ? () => onOpenFile(joinPath(rootPath, a.file!)) : undefined}
              />
            ))}
          </div>
        ))}

        {/* Files */}
        <SectionRow k="files" icon="📁" label={t("ruTree.files")} count={sm ? `${sm.filesMapped}/${sm.files}` : undefined} />
        {open.has("files") && (
          <div style={{ paddingLeft: 10 }}>
            <LeafRow depth={1} label={`${t("ruTree.mapped")}: ${sm?.filesMapped ?? 0} / ${sm?.files ?? 0}`} />
            {!!gaps?.hotUnmappedFiles?.length && (
              <>
                <div className="text-[10px] font-semibold mt-1 px-2" style={{ color: "#d97706" }}>🔥 {t("ruTree.hotUnmapped")}</div>
                {gaps.hotUnmappedFiles.slice(0, 10).map(h => (
                  <LeafRow key={h.file} depth={1} label={h.file.split(/[\\/]/).slice(-2).join("/")} title={`${joinPath(rootPath, h.file)} · ${h.commits} commits`} badge={`${h.commits}×`} onClick={() => onOpenFile(joinPath(rootPath, h.file))} />
                ))}
              </>
            )}
          </div>
        )}

        {/* Dependencies */}
        <SectionRow k="deps" icon="🔗" label={t("ruTree.dependencies")} tone="partial" hint={t("ruTree.depsHint")} />
        {open.has("deps") && (
          <div className="px-3 py-1 text-[10px]" style={{ color: textMuted }}>{t("ruTree.depsHint")}</div>
        )}

        {/* Tests */}
        <SectionRow k="tests" icon="🧪" label={t("ruTree.tests")} count={sm?.tests ?? model.tests?.length} />
        {open.has("tests") && testFiles.slice(0, 50).map(([file, n]) => (
          <LeafRow key={file} depth={1} icon="🧪" label={file.split(/[\\/]/).slice(-2).join("/")} title={joinPath(rootPath, file)} badge={`${n}`} onClick={() => onOpenFile(joinPath(rootPath, file))} />
        ))}

        {/* Change History */}
        <SectionRow k="changes" icon="🕘" label={t("ruTree.changeHistory")} count={sm?.commits ?? model.changes?.length} />
        {open.has("changes") && changes.map(c => (
          <div key={c.hash} className="px-2 py-1 mx-1 rounded-md" style={{ paddingLeft: 16 }}>
            <div className="flex items-center gap-1.5 text-[10px]" style={{ color: textMuted }}>
              <span className="shrink-0 font-mono">{c.hash.slice(0, 7)}</span>
              <span className="shrink-0">{shortDate(c.date)}</span>
              {c.kind && <span className="shrink-0 px-1 rounded bg-stone-100 font-medium">{c.kind}</span>}
            </div>
            <div className="text-[11px] leading-snug break-words" style={{ color: textSecondary }}>{c.subject}</div>
            {!!c.featureIds?.length && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {c.featureIds.slice(0, 6).map(fid => (
                  <span key={fid} className="text-[9px] px-1 rounded font-mono" style={{ backgroundColor: theme?.accentBg || "#f0f9ff", color: theme?.accentText || "#0369a1" }}>{fid}</span>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* AI Work History（部分資料） */}
        <SectionRow k="aiwork" icon="🤖" label={t("ruTree.aiWorkHistory")} tone="partial" hint={t("ruTree.aiWorkHint")} />
        {open.has("aiwork") && (
          <div className="px-3 py-1 text-[10px] leading-relaxed" style={{ color: textMuted }}>
            {t("ruTree.aiWorkHint")} — {t("ruTree.viewInPanel")}
          </div>
        )}

        {/* Configuration（部分資料） */}
        <SectionRow k="config" icon="⚙️" label={t("ruTree.configuration")} tone="partial" />
        {open.has("config") && (
          <div className="px-3 py-1 text-[10px] leading-relaxed" style={{ color: textMuted }}>
            <div>📦 package: <span className="font-mono">{rootPath.split(/[\\/]/).pop()}</span></div>
            <div>🧪 {t("ruTree.configLoop")}: mini</div>
          </div>
        )}

        {/* 未建置節點（R6+） */}
        <div className="mt-1 pt-1" style={{ borderTop: `1px solid ${borderLight}` }}>
          <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: textMuted }}>{t("ruTree.planned")}</div>
          <SectionRow k="specs" icon="📋" label={t("ruTree.specs")} tone="off" />
          <SectionRow k="runbooks" icon="📕" label={t("ruTree.runbooks")} count={gaps?.featuresWithoutRunbooks ? `${gaps.featuresWithoutRunbooks.length}⌀` : undefined} tone="off" hint={t("ruTree.runbooksHint")} />
          <SectionRow k="deploy" icon="🚀" label={t("ruTree.deployment")} tone="off" />
          <SectionRow k="security" icon="🔐" label={t("ruTree.security")} tone="off" />
          <SectionRow k="incidents" icon="🚨" label={t("ruTree.incidents")} tone="off" />
        </div>
      </div>
    </div>
  );
}
