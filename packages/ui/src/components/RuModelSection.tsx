/**
 * RuModelSection — Release Unit Model 檢視（R2）
 *
 * 「Knowledge Control：Release Unit 全資訊」的 UI 入口。
 * 資料：GET /api/ru/model?view=summary（deterministic，零 LLM）
 * 顯示：summary 數字、knowledge gaps、feature × api × test × change 矩陣。
 */
import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface ModelFeature {
  id: string;
  name: string;
  status: string | null;
  fileCount: number;
  apiCount: number;
  testCount: number;
  changeCount: number;
  lastChangeAt: string | null;
  knowledgeGaps: string[];
}

interface ModelSummary {
  version: number;
  generatedAt: string;
  headSha: string | null;
  stale?: boolean;
  summary: {
    features: number;
    apis: number;
    apisWithFeature: number;
    files: number;
    filesMapped: number;
    tests: number;
    commits: number;
  };
  knowledgeGaps: {
    featuresWithoutTests: string[];
    featuresWithoutRunbooks: string[];
    apisWithoutFeature: string[];
    filesWithoutFeature: number;
    hotUnmappedFiles: Array<{ file: string; commits: number }>;
  };
  features: ModelFeature[];
}

const GAP_LABEL: Record<string, string> = {
  "no-tests": "🧪?",
  "no-api-mapped": "🔌?",
  "no-runbook": "📖?",
};

export default function RuModelSection({ rootPath, theme }: { rootPath: string; theme: any }) {
  const { t } = useI18n();
  const [m, setM] = useState<ModelSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/ru/model?view=summary&path=${encodeURIComponent(rootPath)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d && d.summary && Array.isArray(d.features)) setM(d);
    } catch { /* keep old */ } finally { setLoading(false); }
  }, [rootPath]);

  useEffect(() => { load(); }, [load]);

  const box: React.CSSProperties = {
    background: theme.bgMuted || "#fafaf9",
    border: `1px solid ${theme.borderLight || "#e7e5e4"}`,
    borderRadius: 10,
    padding: 12,
  };
  const stat = (v: number | null | undefined) => (
    <span className="text-lg font-bold" style={{ color: theme.text }}>{v ?? "—"}</span>
  );

  return (
    <section>
      <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-2">
        🧠 {t("ru.model.title")}
        <button
          onClick={() => setOpen(v => !v)}
          className="text-[10px] px-2 py-0.5 rounded border text-stone-500 hover:bg-stone-50"
          style={{ borderColor: theme.borderLight }}
        >
          {open ? "▾" : "▸"} {m ? `${m.summary.features} features · ${m.summary.apis} APIs` : t("ru.model.loading")}
        </button>
        <button onClick={load} className="text-[10px] px-2 py-0.5 rounded border text-stone-500 hover:bg-stone-50" style={{ borderColor: theme.borderLight }}>
          {t("ru.model.refresh")}
        </button>
        {m?.stale === false && (
          <span className="text-[10px] text-stone-400">
            {t("ru.model.fresh")} {m.headSha?.slice(0, 7)}
          </span>
        )}
      </h3>

      {loading && !m && <div className="text-xs text-stone-400">⏳ {t("ru.model.loading")}…</div>}
      {m && open && (
        <div style={box}>
          {/* summary 數字 */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3 text-center">
            <div><div>{stat(m.summary.features)}</div><div className="text-[10px] opacity-60">{t("ru.model.features")}</div></div>
            <div><div>{stat(m.summary.apis)}</div><div className="text-[10px] opacity-60">{t("ru.model.apis")}</div></div>
            <div><div>{stat(m.summary.filesMapped)}/{m.summary.files}</div><div className="text-[10px] opacity-60">{t("ru.model.mapped")}</div></div>
            <div><div>{stat(m.summary.tests)}</div><div className="text-[10px] opacity-60">{t("ru.model.tests")}</div></div>
            <div><div>{stat(m.summary.commits)}</div><div className="text-[10px] opacity-60">{t("ru.model.commits")}</div></div>
            <div><div>{stat(m.knowledgeGaps.featuresWithoutTests.length)}</div><div className="text-[10px] opacity-60">{t("ru.model.noTestFeatures")}</div></div>
          </div>

          {/* knowledge gaps */}
          {m.knowledgeGaps.hotUnmappedFiles.length > 0 && (
            <details className="mb-2">
              <summary className="text-[11px] cursor-pointer" style={{ color: "#d97706" }}>
                ⚠️ {t("ru.model.hotUnmapped")} — {m.knowledgeGaps.hotUnmappedFiles.length}
              </summary>
              <div className="text-[11px] font-mono mt-1 space-y-0.5 opacity-75">
                {m.knowledgeGaps.hotUnmappedFiles.map(h => (
                  <div key={h.file}>• {h.file} <span className="opacity-60">({h.commits} commits)</span></div>
                ))}
              </div>
            </details>
          )}

          {/* feature 矩陣 */}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left opacity-55 border-b" style={{ borderColor: theme.borderLight }}>
                  <th className="py-1 pr-2">ID</th>
                  <th className="py-1 pr-2">{t("ru.model.fName")}</th>
                  <th className="py-1 pr-2 text-right">📁</th>
                  <th className="py-1 pr-2 text-right">🔌</th>
                  <th className="py-1 pr-2 text-right">🧪</th>
                  <th className="py-1 pr-2 text-right">{t("ru.model.changes")}</th>
                  <th className="py-1 pr-2">{t("ru.model.lastChange")}</th>
                  <th className="py-1">Gaps</th>
                </tr>
              </thead>
              <tbody>
                {m.features.map(f => (
                  <tr key={f.id} className="border-b" style={{ borderColor: `${theme.borderLight}66` }}>
                    <td className="py-1 pr-2 font-mono">{f.id}</td>
                    <td className="py-1 pr-2 truncate max-w-[180px]">{f.name}</td>
                    <td className="py-1 pr-2 text-right opacity-70">{f.fileCount}</td>
                    <td className="py-1 pr-2 text-right opacity-70">{f.apiCount}</td>
                    <td className="py-1 pr-2 text-right" style={{ opacity: f.testCount > 0 ? 0.7 : 1, color: f.testCount > 0 ? undefined : "#d97706" }}>{f.testCount}</td>
                    <td className="py-1 pr-2 text-right opacity-70">{f.changeCount}</td>
                    <td className="py-1 pr-2 opacity-50">{f.lastChangeAt?.slice(0, 10) ?? "—"}</td>
                    <td className="py-1">{f.knowledgeGaps.map(g => GAP_LABEL[g] || g).join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] mt-1 opacity-40">
            {t("ru.model.generatedAt")}: {m.generatedAt?.slice(0, 16).replace("T", " ")} · {t("ru.model.deterministic")}
          </div>
        </div>
      )}
    </section>
  );
}
