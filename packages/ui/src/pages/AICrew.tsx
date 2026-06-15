import API_BASE from "../api";
import React, { useState, useEffect, useCallback } from "react";
import { Card, RiskBadge, cn } from "../components/ui/shared";
import { Crew, SkillDefinition } from "../types";
import { useTheme } from "../theme";
import CrewEditor from "../components/CrewEditor";
import Icon from "../components/Icon";

interface AICrewProps {
    openEmployee: (employeeId: string) => void;
    onCrewChanged?: () => void;
    factoryId?: string;
}

export default function AICrew({ openEmployee, onCrewChanged, factoryId = "default" }: AICrewProps) {
    const { info: t } = useTheme();
    const [crew, setCrew] = useState<Crew[]>([]);
    const [skillDefs, setSkillDefs] = useState<Map<string, SkillDefinition>>(new Map());
    const [loading, setLoading] = useState(true);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingCrew, setEditingCrew] = useState<Crew | null>(null);

    const loadCrew = useCallback(async () => {
        try {
            const resp = await fetch(`${API_BASE}/api/crew?factory=${factoryId}`);
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
    }, [factoryId]);

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

    const handleAdd = () => {
        setEditingCrew(null);
        setEditorOpen(true);
    };

    const handleEdit = (c: Crew) => {
        setEditingCrew(c);
        setEditorOpen(true);
    };

    const handleSave = async (crewData: Crew) => {
        const isEdit = !!editingCrew;
        const url = isEdit ? `${API_BASE}/api/crew/${crewData.id}?factory=${factoryId}` : `${API_BASE}/api/crew?factory=${factoryId}`;
        const method = isEdit ? "PUT" : "POST";

        const resp = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(crewData),
        });

        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || `Save failed (${resp.status})`);
        }

        setEditorOpen(false);
        setEditingCrew(null);
        await loadCrew();
        onCrewChanged?.();
    };

    const handleDelete = async (id: string) => {
        const resp = await fetch(`${API_BASE}/api/crew/${id}?factory=${factoryId}`, { method: "DELETE" });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || `Delete failed (${resp.status})`);
        }
        setEditorOpen(false);
        setEditingCrew(null);
        await loadCrew();
        onCrewChanged?.();
    };

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
                    <h2 className="text-sm font-semibold text-stone-800">AI Crew Members</h2>
                    <p className="text-xs text-stone-400">點選 Crew 開啟工作區，可以同時開多個員工的 tab</p>
                </div>
                <button
                    onClick={handleAdd}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors shadow-sm"
                    style={{ backgroundColor: t.accent, borderColor: t.accentHover }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accentHover; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = t.accent; }}
                >
                    <Icon name="plus" size={14} /> 新增員工
                </button>
            </div>

            {/* Crew grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-2 w-full">
                {crew.map((s) => (
                    <div key={s.id} className="group relative">
                        {/* Edit button overlay */}
                        <button
                            onClick={(e) => { e.stopPropagation(); handleEdit(s); }}
                            className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded-lg text-[10px] font-bold bg-white/90 text-stone-600 border border-stone-300 shadow-sm hover:bg-stone-100"
                            title="編輯員工"
                        >
                            <Icon name="edit" size={12} /> 編輯
                        </button>

                        <button
                            onClick={() => openEmployee(s.id)}
                            className={cn(
                                "w-full flex flex-col rounded-2xl border bg-white p-0 overflow-hidden shadow-sm transition-all hover:shadow-md hover:-translate-y-1 group text-left"
                            )}
                            style={{ borderColor: t.accentBorder }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = t.accentBorder; }}
                        >
                            <div className="h-48 w-full relative overflow-hidden shrink-0 flex items-center justify-center p-2" style={{ backgroundColor: t.accentBg }}>
                                <img
                                    src={s.imageUrl?.startsWith("/") ? `${API_BASE}/api/factory/${factoryId}/crews-pic/${s.imageUrl.split("/").pop()}` : s.imageUrl}
                                    alt={s.title}
                                    className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-110 drop-shadow-sm"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                />
                                <div className="absolute top-2 right-2 scale-75 origin-top-right">
                                    <RiskBadge risk={s.risk} />
                                </div>
                            </div>
                            <div className="p-4 flex flex-col flex-1 border-t" style={{ borderColor: t.accentBorder + "60" }}>
                                <div className="text-base font-bold text-stone-800 truncate">{s.title}</div>
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
                        </button>
                    </div>
                ))}

                {/* Add new card placeholder */}
                <button
                    onClick={handleAdd}
                    className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-white/30 hover:bg-white/60 transition-colors min-h-[240px] group"
                    style={{ borderColor: t.accentBorder }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = t.accentBorder; }}
                >
                    <div className="text-4xl group-hover:scale-110 transition-all mb-2" style={{ color: t.accentBorder }}>+</div>
                    <div className="text-sm font-bold transition-colors" style={{ color: t.accent + "aa" }}>新增員工</div>
                </button>
            </div>

            {/* Editor Modal */}
            {editorOpen && (
                <CrewEditor
                    crew={editingCrew}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onCancel={() => { setEditorOpen(false); setEditingCrew(null); }}
                />
            )}
        </div>
    );
}
