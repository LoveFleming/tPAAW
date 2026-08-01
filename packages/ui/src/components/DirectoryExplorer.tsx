import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "../theme";

import API from "../api";

interface DirEntry {
    name: string;
    path: string;
}

interface Props {
    /** Starting path (defaults to home) */
    initialPath?: string;
    /** Called when user confirms a directory */
    onSelect: (path: string) => void;
    /** Called when user cancels */
    onClose: () => void;
    /** Modal title */
    title?: string;
}

export default function DirectoryExplorer({
    initialPath,
    onSelect,
    onClose,
    title = "📂 選擇目錄",
}: Props) {
    const { info: t } = useTheme();
    const [currentPath, setCurrentPath] = useState(initialPath || "");
    const [parentPath, setParentPath] = useState<string | null>(null);
    const [dirs, setDirs] = useState<DirEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [manualInput, setManualInput] = useState("");
    const [showManual, setShowManual] = useState(false);
    const [manualError, setManualError] = useState("");
    const [selectedDir, setSelectedDir] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const browse = useCallback(
        (path: string) => {
            setLoading(true);
            setError("");
            setSelectedDir(null);
            fetch(`${API}/api/fs/browse?path=${encodeURIComponent(path)}`)
                .then((r) => r.json())
                .then((data) => {
                    if (data.error) {
                        setError(data.error);
                        return;
                    }
                    setCurrentPath(data.currentPath);
                    setParentPath(data.parent || null);
                    setDirs(data.directories || []);
                })
                .catch((err) => setError(err.message))
                .finally(() => setLoading(false));
        },
        []
    );

    // Initial load
    useEffect(() => {
        browse(currentPath || "/");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && selectedDir) onSelect(selectedDir);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose, onSelect, selectedDir]);

    const goUp = () => {
        if (parentPath) browse(parentPath);
    };

    const handleManualGo = async () => {
        const p = manualInput.trim();
        if (!p) return;
        // ~ expansion is handled server-side
        const expanded = p;
        setManualError("");
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`${API}/api/fs/browse?path=${encodeURIComponent(expanded)}`);
            const data = await res.json();
            if (data.error) {
                setManualError(data.error);
                return; // keep input visible so user can fix
            }
            setCurrentPath(data.currentPath);
            setParentPath(data.parent || null);
            setDirs(data.directories || []);
            setManualInput("");
            setShowManual(false);
        } catch (err: any) {
            setManualError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl border flex flex-col"
                style={{
                    borderColor: t.accentBorder,
                    width: "min(520px, 90vw)",
                    maxHeight: "80vh",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Header ── */}
                <div
                    className="flex items-center justify-between px-5 py-3 border-b shrink-0 rounded-t-2xl"
                    style={{
                        borderColor: t.accentBorder,
                        backgroundColor: t.accentBg,
                    }}
                >
                    <h3
                        className="text-base font-bold"
                        style={{ color: t.accentText }}
                    >
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-stone-400 hover:text-stone-600 text-lg leading-none cursor-pointer"
                    >
                        ✕
                    </button>
                </div>

                {/* ── Toolbar: up + path bar ── */}
                <div
                    className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
                    style={{ borderColor: t.accentBorder + "40" }}
                >
                    <button
                        onClick={goUp}
                        disabled={!parentPath}
                        className="px-2.5 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ borderColor: t.accentBorder, color: t.accent }}
                        onMouseEnter={(e) => {
                            if (parentPath)
                                e.currentTarget.style.backgroundColor = t.accentBg;
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "";
                        }}
                    >
                        ↩
                    </button>
                    <div
                        className="flex-1 text-sm font-mono text-stone-600 truncate px-3 py-1.5 rounded-lg border"
                        style={{
                            borderColor: t.accentBorder + "60",
                            backgroundColor: t.accentBg + "60",
                        }}
                    >
                        {currentPath}
                    </div>
                    <button
                        onClick={() => {
                            if (!showManual) {
                                setManualInput(currentPath);
                                setManualError("");
                            }
                            setShowManual(!showManual);
                        }}
                        className="px-2 py-1.5 rounded-lg border text-sm transition-colors"
                        style={{ borderColor: t.accentBorder, color: t.accent + "99" }}
                        title="手動輸入路徑"
                    >
                        ✎
                    </button>
                </div>

                {/* ── Manual path input (collapsible) ── */}
                {showManual && (
                    <div
                        className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
                        style={{ borderColor: t.accentBorder + "40" }}
                    >
                        <input
                            ref={inputRef}
                            type="text"
                            value={manualInput}
                            onChange={(e) => setManualInput(e.target.value)}
                            placeholder="/手動/輸入/路徑"
                            className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-1 font-mono"
                            style={{ borderColor: t.accentBorder }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleManualGo();
                            }}
                            autoFocus
                        />
                        <button
                            onClick={handleManualGo}
                            className="px-3 py-1.5 text-sm font-bold text-white rounded-lg"
                            style={{ backgroundColor: t.accent }}
                        >
                            Go
                        </button>
                    </div>
                )}
                {showManual && manualError && (
                    <div className="px-4 py-1.5 text-xs text-red-500 border-b" style={{ borderColor: t.accentBorder + "40" }}>
                        ❌ {manualError}
                    </div>
                )}

                {/* ── Directory list ── */}
                <div
                    ref={listRef}
                    className="flex-1 overflow-y-auto min-h-[220px]"
                    style={{ scrollbarWidth: "thin" }}
                >
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-stone-400 text-sm">
                            <svg
                                className="animate-spin h-4 w-4 mr-2"
                                viewBox="0 0 24 24"
                            >
                                <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                    fill="none"
                                />
                                <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                />
                            </svg>
                            Loading...
                        </div>
                    ) : error ? (
                        <div className="text-center py-16 px-6">
                            <div className="text-red-400 text-sm mb-2">
                                ❌ {error}
                            </div>
                            <button
                                onClick={() => browse(currentPath)}
                                className="text-sm px-3 py-1 rounded-lg border"
                                style={{
                                    borderColor: t.accentBorder,
                                    color: t.accent,
                                }}
                            >
                                重試
                            </button>
                        </div>
                    ) : dirs.length === 0 ? (
                        <div className="text-center py-16 text-stone-400 text-sm">
                            📭 這個目錄下沒有子目錄
                            <br />
                            <span className="text-xs">
                                可以直接按下方「選擇此目錄」
                            </span>
                        </div>
                    ) : (
                        <div className="py-1">
                            {dirs.map((d) => {
                                const isSelected = selectedDir === d.path;
                                return (
                                    <button
                                        key={d.path}
                                        className="w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 transition-colors cursor-pointer"
                                        style={{
                                            backgroundColor: isSelected
                                                ? t.accentBg
                                                : undefined,
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isSelected)
                                                e.currentTarget.style.backgroundColor =
                                                    t.accentBg + "80";
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isSelected)
                                                e.currentTarget.style.backgroundColor =
                                                    "";
                                        }}
                                        onClick={() => setSelectedDir(d.path)}
                                        onDoubleClick={() => {
                                            browse(d.path);
                                        }}
                                    >
                                        <span className="text-base">
                                            {isSelected ? "📂" : "📁"}
                                        </span>
                                        <span className="text-stone-700 truncate">
                                            {d.name}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── Footer: actions ── */}
                <div
                    className="flex items-center gap-3 px-5 py-3 border-t shrink-0 rounded-b-2xl"
                    style={{
                        borderColor: t.accentBorder + "60",
                        backgroundColor: t.accentBg + "40",
                    }}
                >
                    {/* Current path info */}
                    <div className="flex-1 min-w-0">
                        <div className="text-xs text-stone-400">
                            當前目錄
                        </div>
                        <div
                            className="text-sm font-mono truncate"
                            style={{ color: t.accentText }}
                        >
                            {currentPath}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium rounded-lg border transition-colors"
                        style={{
                            borderColor: t.accentBorder,
                            color: t.accentText,
                        }}
                    >
                        取消
                    </button>
                    <button
                        onClick={() => onSelect(currentPath)}
                        className="px-5 py-2 text-sm font-bold text-white rounded-lg transition-colors"
                        style={{ backgroundColor: t.accent }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = t.accentHover;
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = t.accent;
                        }}
                    >
                        選擇此目錄
                    </button>
                </div>
            </div>
        </div>
    );
}
