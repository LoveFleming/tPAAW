import React, { useState, useEffect } from "react";
import { useTheme } from "../theme";

import API from "../api";

interface AppItem {
    id: string;
    name: string;
    description: string;
    template: string;
    skillId: string;
    hasApp: boolean;
    generatedAt: string;
    status: string;
}

export default function AppPool({ onOpenApp }: { onOpenApp: (appId: string) => void }) {
    const { info: t } = useTheme();
    const [apps, setApps] = useState<AppItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [previewApp, setPreviewApp] = useState<string | null>(null);

    const loadApps = () => {
        fetch(`${API}/api/apps`)
            .then(r => r.json())
            .then(setApps)
            .catch(() => {})
            .finally(() => setLoading(false));
    };

    useEffect(() => { loadApps(); }, []);

    const handleUnpublish = (appId: string) => {
        if (!confirm(`確定要下架「${appId}」嗎？app.html 會被移除，但 metadata 會保留。`)) return;
        fetch(`${API}/api/app/${appId}`, { method: "DELETE" })
            .then(r => r.json())
            .then(() => loadApps())
            .catch(() => {});
    };

    const handleDelete = (appId: string) => {
        if (!confirm(`確定要完全刪除「${appId}」嗎？這個動作無法復原。`)) return;
        fetch(`${API}/api/app/${appId}/delete`, { method: "DELETE" })
            .then(r => r.json())
            .then(() => loadApps())
            .catch(() => {});
    };

    const templateIcons: Record<string, string> = {
        dashboard: "📊",
        table: "📋",
        chart: "📈",
        mixed: "🎛️",
    };

    return (
        <div className="h-full flex w-full" style={{ backgroundColor: "#fafaf9" }}>
            {/* App Grid */}
            <div className={`${previewApp ? "w-1/2" : "w-full"} flex flex-col overflow-hidden transition-all`}>
                <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                    <span className="text-lg">📊</span>
                    <h2 className="text-sm font-bold" style={{ color: t.accentText }}>Apps</h2>
                    <span className="text-xs text-stone-400 ml-2">{apps.length} apps</span>
                    <span className="text-[10px] text-stone-300">apps/</span>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {loading && (
                        <div className="flex items-center justify-center h-64 text-stone-400 text-sm">
                            Loading...
                        </div>
                    )}
                    {!loading && apps.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 gap-3">
                            <span className="text-4xl">📭</span>
                            <p className="text-stone-400 text-sm">還沒有 App</p>
                            <p className="text-stone-400 text-xs">去 App Builder 建立一個吧！</p>
                        </div>
                    )}
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        {apps.map(app => (
                            <button
                                key={app.id}
                                onClick={() => setPreviewApp(previewApp === app.id ? null : app.id)}
                                onDoubleClick={() => onOpenApp(app.id)}
                                className={`text-left p-4 border-2 rounded-xl transition-all hover:shadow-md ${previewApp === app.id ? "border-blue-400 bg-blue-50/50" : "border-stone-200 bg-white hover:border-stone-300"}`}
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <span className="text-2xl">{templateIcons[app.template] || "📊"}</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">
                                        {app.status === "published" ? "Published" : "Draft"}
                                    </span>
                                </div>
                                <div className="font-bold text-sm text-stone-800 mb-1">{app.name}</div>
                                <div className="text-[10px] text-stone-400 font-mono">{app.id}</div>
                                {app.description && (
                                    <div className="text-[10px] text-stone-500 mt-1 line-clamp-2">{app.description}</div>
                                )}
                                <div className="mt-3 flex gap-2">
                                    <button
                                        onClick={e => { e.stopPropagation(); onOpenApp(app.id); }}
                                        className="text-[10px] px-2 py-1 rounded-md font-semibold text-white"
                                        style={{ backgroundColor: t.accent }}>
                                        開啟
                                    </button>
                                    <button
                                        onClick={e => { e.stopPropagation(); setPreviewApp(previewApp === app.id ? null : app.id); }}
                                        className="text-[10px] px-2 py-1 rounded-md font-semibold border"
                                        style={{ borderColor: t.accentBorder, color: t.accent }}>
                                        預覽
                                    </button>
                                    {app.status === "published" && (
                                        <button
                                            onClick={e => { e.stopPropagation(); handleUnpublish(app.id); }}
                                            className="text-[10px] px-2 py-1 rounded-md font-semibold border border-stone-200 text-stone-400 hover:text-amber-600 hover:border-amber-300"
                                            title="下架">
                                            下架
                                        </button>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Preview Panel */}
            {previewApp && (
                <div className="w-1/2 flex flex-col border-l" style={{ borderColor: "#e7e5e4" }}>
                    <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0" style={{ borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
                        <span className="text-xs font-semibold text-stone-500">Preview</span>
                        <span className="text-xs text-stone-400 font-mono">{previewApp}</span>
                        <button onClick={() => setPreviewApp(null)} className="ml-auto text-xs text-stone-400 hover:text-red-400">✕</button>
                    </div>
                    <iframe
                        src={`${API}/api/app/${previewApp}`}
                        className="flex-1 w-full border-0 bg-white"
                        title="Preview"
                    />
                </div>
            )}
        </div>
    );
}
