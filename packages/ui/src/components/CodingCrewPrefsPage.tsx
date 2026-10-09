import API_BASE from "../api";
import React, { useState, useEffect, useCallback } from "react";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import CrewPrefsEditor from "./CrewPrefsEditor";

interface ModuleCrew {
  id: string;
  title?: string;
  codename?: string;
  emoji?: string;
  description?: string;
  imageUrl?: string;
  displayName?: string;
  _hasPrefs?: boolean;
  _promptRev?: string;
}

/**
 * Coding module 的 AI Crew 頁（2026-10-09 Fleming：偏好編輯入口在 module 內，全域組織圖唯讀）
 * 可編：頭像/顯示名/開場白/語氣/備註 — 純外觀層，行為由 module firmware 維護
 */
export default function CodingCrewPrefsPage({ onCrewChanged }: { onCrewChanged?: () => void }) {
  const { t } = useI18n();
  const { info: theme } = useTheme();
  const [crews, setCrews] = useState<ModuleCrew[]>([]);
  const [loading, setLoading] = useState(true);
  const [prefsCrew, setPrefsCrew] = useState<ModuleCrew | null>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/api/modules/coding/crews`)
      .then(r => (r.ok ? r.json() : []))
      .then((d: ModuleCrew[]) => setCrews(Array.isArray(d) ? d : []))
      .catch(() => setCrews([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5">
          <h2 className="text-sm font-bold text-stone-800">{t("crew.prefs.pageTitle")}</h2>
          <p className="text-xs text-stone-400 mt-1">{t("crew.prefs.pageSubtitle")}</p>
        </div>

        {loading ? (
          <div className="text-xs text-stone-400 py-10 text-center">…</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {crews.map(c => {
              const avatar = c.imageUrl?.startsWith("/")
                ? `${API_BASE}${c.imageUrl}`
                : c.imageUrl;
              return (
                <button
                  key={c.id}
                  onClick={() => setPrefsCrew(c)}
                  className="group relative rounded-2xl border bg-white p-4 text-left transition-all hover:shadow-md"
                  style={{ borderColor: theme.accentBorder }}
                >
                  {c._hasPrefs && (
                    <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-600">✏️ {t("crew.customized")}</span>
                  )}
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center" style={{ backgroundColor: theme.accentBg }}>
                      {avatar ? (
                        <img src={avatar} alt={c.title || c.id} className="w-full h-full object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <span className="text-xl">{c.emoji || "🤖"}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-stone-800 truncate">{c.displayName || c.codename || c.title || c.id}</div>
                      <div className="font-mono text-[10px] text-stone-400 truncate">{c.id}</div>
                    </div>
                  </div>
                  {c.description && <p className="text-[11px] text-stone-500 mt-2 line-clamp-2">{c.description}</p>}
                  <div className="text-[10px] text-stone-400 mt-2 group-hover:text-stone-600 transition-colors">⚙️ {t("crew.customize")}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {prefsCrew && (
        <CrewPrefsEditor
          crew={prefsCrew}
          onSaved={() => { setPrefsCrew(null); load(); onCrewChanged?.(); }}
          onCancel={() => setPrefsCrew(null)}
        />
      )}
    </div>
  );
}
