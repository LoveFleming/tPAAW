/**
 * RuTree — 🧭 Release Unit 左側目錄（coding app sidebar 第二視圖）
 *
 * 點分類 → 主區開 tab（RuView）顯示該分類 model 內容；sidebar 只做導航目錄。
 * 資料源：GET /api/ru/model（summary 即可，程式生成零 LLM）— No answer without evidence：
 * 沒資料的分類灰色 disabled，knowledgeGaps 數字照顯示（看得到的工作項）。
 */

import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import { RU_CATEGORY_META, type RuCategory } from "./RuView";

interface RuModelSummary {
  generatedAt?: string; headSha?: string; stale?: boolean;
  summary?: { features?: number; apis?: number; files?: number; filesMapped?: number; tests?: number; commits?: number };
  knowledgeGaps?: { featuresWithoutRunbooks?: any[]; hotUnmappedFiles?: any[] };
}

interface Props {
  rootPath: string;
  theme: any;
  onOpenFile: (absPath: string) => void;
  onOpenCategory: (cat: RuCategory) => void;
  activeCategory?: RuCategory | null;
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[2].slice(1)}/${m[3]} ${m[4]}:${m[5]}` : (iso || "").slice(0, 11);
}

export default function RuTree({ rootPath, theme, onOpenCategory, activeCategory }: Props) {
  const { t } = useI18n();
  const [model, setModel] = useState<RuModelSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/api/ru/model?view=summary&path=${encodeURIComponent(rootPath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setModel(d);
    } catch (e: any) { setError(e?.message || "failed"); } finally { setLoading(false); }
  }, [rootPath]);
  useEffect(() => { setModel(null); load(); }, [load]);

  const textMuted = theme?.textMuted || "#9ca3af";
  const textPrimary = theme?.textPrimary || "#374151";
  const borderLight = theme?.borderLight || "#f0f0f0";
  const rowHover = theme?.bgHover || "#f5f5f4";
  const accentBg = theme?.accentBg || "#f0f9ff";
  const accentText = theme?.accentText || "#0369a1";

  // 分類 → count / tone（partial/off）
  const catMeta = (key: RuCategory): { count?: string; tone: "live" | "partial" | "off" } => {
    const sm = model?.summary, gaps = model?.knowledgeGaps;
    switch (key) {
      case "features": return { count: sm ? String(sm.features ?? "") : "", tone: "live" };
      case "apis": return { count: sm ? String(sm.apis ?? "") : "", tone: "live" };
      case "files": return { count: sm ? `${sm.filesMapped}/${sm.files}` : "", tone: "live" };
      case "deps": return { tone: "partial" };
      case "tests": return { count: sm ? String(sm.tests ?? "") : "", tone: "live" };
      case "changes": return { count: sm ? String(sm.commits ?? "") : "", tone: "live" };
      case "aiwork": return { tone: "partial" };
      case "config": return { tone: "partial" };
      case "specs": return { tone: "off" };
      case "runbooks": return { count: gaps?.featuresWithoutRunbooks ? `${gaps.featuresWithoutRunbooks.length}⌀` : "", tone: "partial" };
      case "deploy": return { tone: "off" };
      case "security": return { tone: "off" };
      case "incidents": return { tone: "off" };
      default: return { tone: "off" };
    }
  };

  if (!rootPath) {
    return <div className="flex items-center justify-center h-full text-xs text-stone-400 px-4 text-center">{t("ruTree.noProject")}</div>;
  }

  const PLANNED = new Set<RuCategory>(["specs", "runbooks", "deploy", "security", "incidents"]);

  return (
    <div className="flex flex-col h-full" data-testid="ru-tree">
      {/* header：updated @ sha + stale + refresh */}
      <div className="px-2 py-1 flex items-center gap-1 text-[10px] shrink-0" style={{ borderBottom: `1px solid ${borderLight}`, color: textMuted }}>
        <span className="truncate flex-1" title={model?.generatedAt}>
          {t("ruTree.updated")} {shortDate(model?.generatedAt)} @ {model?.headSha?.slice(0, 7) || (loading ? "…" : "—")}
        </span>
        {model?.stale && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-semibold border border-amber-200" title={t("ruTree.staleHint")}>
            {t("ruTree.stale")}
          </span>
        )}
        <button onClick={load} title={t("ruTree.refresh")} className="shrink-0 px-1 rounded hover:bg-stone-100">🔄</button>
      </div>

      {/* 分類目錄：點 → 開主區 tab */}
      <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
        {error && !model && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-xs text-stone-500">{t("ruTree.noModel")}</p>
            <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium">{t("ruTree.retry")}</button>
          </div>
        )}
        {RU_CATEGORY_META.map(({ key, icon, labelKey }) => {
          const { count, tone } = catMeta(key);
          const disabled = tone === "off";
          const dot = tone === "live" ? "#16a34a" : tone === "partial" ? "#d97706" : textMuted;
          const active = activeCategory === key;
          return (
            <button
              key={key}
              onClick={() => onOpenCategory(key)}
              disabled={disabled}
              title={disabled ? t("ruTree.notBuilt") : t(labelKey)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs rounded-md"
              style={{
                color: disabled ? textMuted : textPrimary,
                cursor: disabled ? "default" : "pointer",
                backgroundColor: active ? (rowHover) : "transparent",
                fontWeight: active ? 700 : 600,
              }}
              onMouseEnter={e => { if (!disabled) e.currentTarget.style.backgroundColor = rowHover; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <span className="text-[9px] w-1.5 shrink-0" style={{ color: dot }}>●</span>
              <span className="w-3.5 shrink-0 text-center">{icon}</span>
              <span className="truncate flex-1" style={{ fontWeight: disabled ? 400 : undefined }}>{t(labelKey)}</span>
              {count ? (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: disabled ? "#f5f5f4" : accentBg, color: disabled ? textMuted : accentText }}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
        <div className="px-2 pt-2 pb-1 text-[9px] leading-relaxed" style={{ color: textMuted, borderTop: `1px solid ${borderLight}`, marginTop: 4 }}>
          {t("ru.view.openHint")}
        </div>
      </div>
    </div>
  );
}
