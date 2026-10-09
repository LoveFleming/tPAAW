import API_BASE from "../api";
import React, { useState, useEffect, useCallback } from "react";
import { Card, cn } from "../components/ui/shared";
import { Crew, SkillDefinition } from "../types";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import Icon from "../components/Icon";

// 2026-10-09 組織圖模式：by module 分組顯示（firmware 🔒 唯讀 + 偏好編輯；user crew 可編輯）
// EmployeeWorkspace 退場 — 員工互動在 module UI（coding app side chat 等）
interface AICrewProps {
    onCrewChanged?: () => void;
}

const MODULE_LABELS: Record<string, string> = {
    coding: "💻 Coding 部門",
    pm: "📋 產品經理室",
    secretary: "📝 秘書處",
};

export default function AICrew({ onCrewChanged }: AICrewProps) {
  const { t: tt } = useI18n();
    const { info: t } = useTheme();
    const [crew, setCrew] = useState<Crew[]>([]);
    const [skillDefs, setSkillDefs] = useState<Map<string, SkillDefinition>>(new Map());
    const [loading, setLoading] = useState(true);


    const loadCrew = useCallback(async () => {
        try {
            const resp = await fetch(`${API_BASE}/api/crew`);
            if (resp.ok) {
                const data = await resp.json();
                setCrew(data);
            }
        } catch {
            // fallback: try loading from static files
            try {
                const resp = await fetch(`${API_BASE}/crew`);
                // won't work, just leave empty
            } catch { /* */ }
        }
        setLoading(false);
    }, []);

    // Fetch skill definitions
    useEffect(() => {
        fetch(`${API_BASE}/api/skills`)
            .then(r => r.json())
            .then((data: SkillDefinition[]) => {
                const map = new Map<string, SkillDefinition>();
                for (const sd of data) map.set(sd.id, sd);
                setSkillDefs(map);
            })
            .catch(() => {});
    }, []);

    useEffect(() => { loadCrew(); }, [loadCrew]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-stone-400 text-sm">Loading crew...</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col space-y-4 h-full w-full overflow-y-auto px-6" style={{ backgroundColor: t.accentBg }}>
            {/* Header with Add button */}
            <div className="flex items-center justify-between pt-2">
                <div>
                    <h2 className="text-sm font-semibold text-stone-800">{tt("crew.orgTitle")}</h2>
                    <p className="text-xs text-stone-400">{tt("crew.orgSubtitleRo")}</p>
                </div>
            </div>

            {/* 組織圖：by module 分組（2026-10-09） */}
            {(() => {
                const locked = crew.filter(s => (s as any).locked);
                const userCrews = crew.filter(s => !(s as any).locked);
                const modIds = Array.from(new Set(locked.map(s => (s as any).moduleId as string)));
                const sections: { key: string; label: string; list: typeof crew }[] = [
                    ...modIds.map(mid => ({ key: mid, label: MODULE_LABELS[mid] || `📦 ${mid}`, list: locked.filter(s => (s as any).moduleId === mid) })),
                    ...(userCrews.length > 0 ? [{ key: "user", label: "🧑‍💼 " + tt("crew.myCrews"), list: userCrews }] : []),
                ];
                return sections.map(sec => (
                <div key={sec.key}>
                    <div className="flex items-center gap-2 pt-2 pb-1">
                        <div className="text-xs font-bold text-stone-700">{sec.label}</div>
                        <div className="text-[10px] text-stone-400">{sec.list.length}</div>
                        {sec.key !== "user" && <div className="text-[9px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-400 border border-stone-200">🔒 {tt("crew.moduleOwned")}</div>}
                    </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-2 w-full">
                {sec.list.map((s) => (
                    <div key={s.id} className="group relative">
                        {/* 2026-10-09 Fleming：組織圖純顯示（唯讀）— 編輯入口在各 module 的 AI crew page */}
                        <div
                            className={cn(
                                "w-full flex flex-col rounded-2xl border bg-white p-0 overflow-hidden shadow-sm transition-all hover:shadow-md hover:-translate-y-1 group text-left"
                            )}
                            style={{ borderColor: t.accentBorder }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = t.accentBorder; }}
                        >
                            <div className="h-48 w-full relative overflow-hidden shrink-0 flex items-center justify-center p-2" style={{ backgroundColor: t.accentBg }}>
                                <img
                                    src={s.imageUrl?.startsWith("/") ? `${API_BASE}/api/crew-pic/${s.imageUrl.split("/").pop()}` : s.imageUrl}
                                    alt={s.title}
                                    className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-110 drop-shadow-sm"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                />
                                <div className="absolute top-2 right-2 scale-75 origin-top-right flex flex-col items-end gap-1">
                                    {(s as any).locked && (
                                        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs bg-stone-50 border-stone-300 text-stone-500">🔒</span>
                                    )}
                                    {(s as any)._hasPrefs && (
                                        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs bg-amber-50 border-amber-300 text-amber-600">✏️ {tt("crew.customized")}</span>
                                    )}
                                    {s.expertise && s.expertise.length > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs bg-blue-50 border-blue-300 text-blue-600">
                                            🛡️ {s.expertise.length}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="p-4 flex flex-col flex-1 border-t" style={{ borderColor: t.accentBorder + "60" }}>
                                <div className="text-base font-bold text-stone-800 truncate">{(s as any).displayName || s.title}</div>
                                <div className="font-mono text-[10px] font-semibold uppercase tracking-widest truncate mt-1" style={{ color: t.accent }}>{s.codename}</div>
                                <div className="text-xs text-zinc-500 mt-2 line-clamp-2">{s.description}</div>
                                <div className="flex flex-wrap gap-1 mt-3">
                                    {(s.skillIds || []).slice(0, 3).map(sid => {
                                        const sk = skillDefs.get(sid);
                                        return (
                                            <span key={sid} className={cn(
                                                "text-[10px] px-1.5 py-0.5 rounded-full"
                                            )}
                                            style={{ backgroundColor: t.accentLight, color: t.accent }}
                                            >
                                                <Icon name="check" size={10} style={{ color: "#10b981" }} /> {sk?.name || sid}
                                            </span>
                                        );
                                    })}
                                    {(s.skillIds || []).length > 3 && (
                                        <span className="text-[10px] bg-stone-100 text-stone-400 px-1.5 py-0.5 rounded-full">
                                            +{(s.skillIds || []).length - 3}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}

            </div>
                </div>
                ));
            })()}
        </div>
    );
}
