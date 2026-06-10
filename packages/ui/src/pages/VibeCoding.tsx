import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTheme } from "../theme";
import { cn } from "../utils";

const API_BASE = "http://127.0.0.1:4097";

// ── Types ──
interface CliSession {
    id: string;
    name: string;
    cli: string; // "qwen" | "claude" | "opencode" | "aider" | custom
    model: string;
    cwd: string;
    approvalMode: string;
    systemPrompt: string;
    createdAt: string;
    lastActive: string;
}

interface QuickAction {
    id: string;
    label: string;
    icon: string;
    prompt: string;
}

// ── Presets ──
const CLI_OPTIONS = [
    { id: "qwen", label: "Qwen Code", icon: "🟣", color: "#8B5CF6" },
    { id: "claude", label: "Claude Code", icon: "🟠", color: "#F97316" },
    { id: "opencode", label: "OpenCode", icon: "🔵", color: "#3B82F6" },
    { id: "aider", label: "Aider", icon: "🟢", color: "#10B981" },
    { id: "custom", label: "Custom CLI", icon: "⚪", color: "#6B7280" },
];

const APPROVAL_MODES = [
    { id: "yolo", label: "YOLO (全自動)", icon: "🚀", desc: "自動執行所有操作" },
    { id: "auto-edit", label: "Auto Edit", icon: "✏️", desc: "自動編輯，需確認外部操作" },
    { id: "default", label: "Default", icon: "🔒", desc: "需確認所有操作" },
    { id: "plan", label: "Plan First", icon: "📋", desc: "先規劃再執行" },
];

const QUICK_ACTIONS: QuickAction[] = [
    {
        id: "refactor",
        label: "重構",
        icon: "🔧",
        prompt: "請重構這個專案的程式碼，改善可讀性和效能。先分析現有結構，再逐步修改。",
    },
    {
        id: "debug",
        label: "Debug",
        icon: "🐛",
        prompt: "請幫我找出並修復程式中的 bug。先看 error log，再定位問題，最後修復。",
    },
    {
        id: "feature",
        label: "新功能",
        icon: "✨",
        prompt: "我要新增一個功能。請先了解現有架構，再提出實作方案，確認後開始開發。",
    },
    {
        id: "review",
        label: "Code Review",
        icon: "👀",
        prompt: "請 review 目前的程式碼，指出潛在問題、安全風險、效能瓶頸，並給出改善建議。",
    },
    {
        id: "test",
        label: "寫測試",
        icon: "🧪",
        prompt: "請為目前的程式碼寫單元測試。先分析需要測試的模組，再逐一撰寫測試案例。",
    },
    {
        id: "docs",
        label: "寫文件",
        icon: "📝",
        prompt: "請為這個專案寫文件，包括 README、API 文件、使用範例。",
    },
    {
        id: "migrate",
        label: "遷移",
        icon: "📦",
        prompt: "請幫我進行版本遷移/升級。先確認目前版本和目標版本，再規劃遷移步驟。",
    },
    {
        id: "deploy",
        label: "部署",
        icon: "🚢",
        prompt: "請幫我準備部署流程。檢查環境設定、建置配置、部署腳本。",
    },
];

const RECENT_PROJECTS_KEY = "paaw.vibe.recent-projects";

export default function VibeCoding() {
    const { info: themeInfo } = useTheme();

    // ── State ──
    const [sessions, setSessions] = useState<CliSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [showNewSession, setShowNewSession] = useState(false);
    const [showQuickActions, setShowQuickActions] = useState(true);

    // New session form
    const [formCli, setFormCli] = useState("qwen");
    const [formModel, setFormModel] = useState("");
    const [formCwd, setFormCwd] = useState("");
    const [formApproval, setFormApproval] = useState("yolo");
    const [formSystemPrompt, setFormSystemPrompt] = useState("");
    const [formName, setFormName] = useState("");

    const [recentProjects, setRecentProjects] = useState<string[]>([]);

    // ── Load recent projects from server ──
    useEffect(() => {
        // Try to get recent projects from server UI state
        fetch(`${API_BASE}/api/paaw/ui-state`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.recentProjects) {
                    setRecentProjects(data.recentProjects.slice(0, 8));
                    if (data.recentProjects.length > 0 && !formCwd) {
                        setFormCwd(data.recentProjects[0]);
                    }
                }
            })
            .catch(() => {});

        // Load sessions from localStorage
        try {
            const saved = localStorage.getItem("paaw.vibe.sessions");
            if (saved) {
                const parsed = JSON.parse(saved);
                setSessions(parsed);
                if (parsed.length > 0) setActiveSessionId(parsed[0].id);
            }
        } catch {}
    }, []);

    // Save sessions to localStorage
    useEffect(() => {
        try {
            localStorage.setItem("paaw.vibe.sessions", JSON.stringify(sessions));
        } catch {}
    }, [sessions]);

    // ── Handlers ──
    const createSession = useCallback(() => {
        const id = `vibe-${Date.now()}`;
        const name = formName || `${CLI_OPTIONS.find(c => c.id === formCli)?.label || formCli} Session`;
        const session: CliSession = {
            id,
            name,
            cli: formCli,
            model: formModel,
            cwd: formCwd,
            approvalMode: formApproval,
            systemPrompt: formSystemPrompt,
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString(),
        };
        setSessions(prev => [session, ...prev]);
        setActiveSessionId(id);
        setShowNewSession(false);
        // Reset form
        setFormName("");
        setFormSystemPrompt("");
    }, [formCli, formModel, formCwd, formApproval, formSystemPrompt, formName]);

    const deleteSession = useCallback((id: string) => {
        setSessions(prev => prev.filter(s => s.id !== id));
        if (activeSessionId === id) {
            setActiveSessionId(null);
        }
    }, [activeSessionId]);

    const activeSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId]);

    const selectedCli = CLI_OPTIONS.find(c => c.id === (activeSession?.cli || formCli));

    // ── Render: Quick Action Button ──
    const renderQuickAction = (action: QuickAction) => (
        <button
            key={action.id}
            onClick={() => {
                // Send prompt to active terminal
                const event = new CustomEvent("paaw:vibe-prompt", { detail: { prompt: action.prompt } });
                window.dispatchEvent(event);
            }}
            className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border transition-all hover:shadow-md active:scale-95"
            style={{
                borderColor: themeInfo.accentBorder,
                backgroundColor: "white",
                minWidth: 72,
            }}
            onMouseEnter={e => {
                e.currentTarget.style.borderColor = themeInfo.accent;
                e.currentTarget.style.backgroundColor = themeInfo.accentBg;
            }}
            onMouseLeave={e => {
                e.currentTarget.style.borderColor = themeInfo.accentBorder;
                e.currentTarget.style.backgroundColor = "white";
            }}
        >
            <span className="text-lg">{action.icon}</span>
            <span className="text-[11px] font-semibold text-stone-600">{action.label}</span>
        </button>
    );

    return (
        <div className="h-full flex w-full" style={{ backgroundColor: "#fafaf9" }}>
            {/* ── Left: Session List ── */}
            <div className="w-72 flex flex-col border-r shrink-0" style={{ borderColor: themeInfo.accentBorder + "60", backgroundColor: "#fff" }}>
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0" style={{ borderColor: themeInfo.accentBorder, backgroundColor: themeInfo.accentBg }}>
                    <span className="text-lg">⚡</span>
                    <h2 className="text-sm font-bold flex-1" style={{ color: themeInfo.accentText }}>Vibe Coding</h2>
                    <span className="text-xs text-stone-400">{sessions.length}</span>
                    <button
                        onClick={() => setShowNewSession(true)}
                        className="ml-auto text-xs font-bold px-2.5 py-1 rounded-lg text-white"
                        style={{ backgroundColor: themeInfo.accent }}
                    >
                        + New
                    </button>
                </div>

                {/* New Session Form */}
                {showNewSession && (
                    <div className="p-3 border-b space-y-3" style={{ borderColor: "#e7e5e4", backgroundColor: "#fafaf9" }}>
                        {/* Name */}
                        <input
                            value={formName}
                            onChange={e => setFormName(e.target.value)}
                            placeholder="Session 名稱（可選）"
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                            style={{ borderColor: "#d6d3d1" }}
                        />

                        {/* CLI Selection */}
                        <div>
                            <div className="text-[11px] text-stone-500 font-bold mb-1.5 uppercase tracking-wider">AI CLI</div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {CLI_OPTIONS.map(cli => (
                                    <button
                                        key={cli.id}
                                        onClick={() => setFormCli(cli.id)}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold border transition-all",
                                            formCli === cli.id ? "border-stone-400 bg-stone-50" : "border-stone-200 text-stone-500"
                                        )}
                                        style={formCli === cli.id ? { borderColor: cli.color, backgroundColor: cli.color + "10" } : {}}
                                    >
                                        <span>{cli.icon}</span>
                                        <span className="truncate">{cli.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Model */}
                        {formCli !== "custom" && (
                            <input
                                value={formModel}
                                onChange={e => setFormModel(e.target.value)}
                                placeholder="Model（留空用預設）"
                                className="w-full px-3 py-2 border rounded-lg text-xs font-mono"
                                style={{ borderColor: "#d6d3d1" }}
                            />
                        )}

                        {/* Working Directory */}
                        <div>
                            <div className="text-[11px] text-stone-500 font-bold mb-1.5 uppercase tracking-wider">工作目錄</div>
                            <input
                                value={formCwd}
                                onChange={e => setFormCwd(e.target.value)}
                                placeholder="/path/to/project"
                                className="w-full px-3 py-2 border rounded-lg text-xs font-mono"
                                style={{ borderColor: "#d6d3d1" }}
                            />
                            {recentProjects.length > 0 && (
                                <div className="mt-1.5 space-y-0.5 max-h-24 overflow-y-auto">
                                    {recentProjects.map(p => (
                                        <button
                                            key={p}
                                            onClick={() => setFormCwd(p)}
                                            className={cn(
                                                "w-full text-left px-2 py-1 rounded text-[10px] font-mono truncate transition-colors",
                                                formCwd === p ? "bg-blue-50 text-blue-600" : "text-stone-400 hover:bg-stone-100"
                                            )}
                                        >
                                            📁 {p.split("/").pop()} <span className="text-stone-300">{p}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Approval Mode */}
                        <div>
                            <div className="text-[11px] text-stone-500 font-bold mb-1.5 uppercase tracking-wider">執行模式</div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {APPROVAL_MODES.map(mode => (
                                    <button
                                        key={mode.id}
                                        onClick={() => setFormApproval(mode.id)}
                                        className={cn(
                                            "flex flex-col items-start px-2.5 py-2 rounded-lg text-left border transition-all",
                                            formApproval === mode.id ? "border-stone-400 bg-stone-50" : "border-stone-200"
                                        )}
                                        style={formApproval === mode.id ? { borderColor: themeInfo.accent, backgroundColor: themeInfo.accentBg } : {}}
                                    >
                                        <span className="text-xs font-semibold flex items-center gap-1">
                                            <span>{mode.icon}</span> {mode.label}
                                        </span>
                                        <span className="text-[10px] text-stone-400 mt-0.5">{mode.desc}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* System Prompt */}
                        <details className="group">
                            <summary className="text-[11px] text-stone-500 font-bold cursor-pointer uppercase tracking-wider flex items-center gap-1">
                                System Prompt <span className="text-stone-300 group-open:rotate-90 transition-transform">▶</span>
                            </summary>
                            <textarea
                                value={formSystemPrompt}
                                onChange={e => setFormSystemPrompt(e.target.value)}
                                placeholder="自訂系統提示詞（可選）"
                                className="w-full mt-1.5 px-3 py-2 border rounded-lg text-xs font-mono resize-none"
                                rows={3}
                                style={{ borderColor: "#d6d3d1" }}
                            />
                        </details>

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={createSession}
                                disabled={!formCwd}
                                className="flex-1 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40 transition-opacity"
                                style={{ backgroundColor: themeInfo.accent }}
                            >
                                🚀 Start Coding
                            </button>
                            <button
                                onClick={() => setShowNewSession(false)}
                                className="px-3 py-2 rounded-lg text-sm border text-stone-500"
                                style={{ borderColor: "#d6d3d1" }}
                            >
                                取消
                            </button>
                        </div>
                    </div>
                )}

                {/* Session List */}
                <div className="flex-1 overflow-y-auto">
                    {sessions.length === 0 && !showNewSession && (
                        <div className="flex flex-col items-center justify-center h-64 gap-3 px-6 text-center">
                            <span className="text-5xl">⚡</span>
                            <p className="text-stone-800 font-semibold text-base">Vibe Coding</p>
                            <p className="text-stone-400 text-xs leading-relaxed">
                                用 AI CLI 快速打造程式碼<br />
                                選擇工具、設定目錄、開始 coding
                            </p>
                            <button
                                onClick={() => setShowNewSession(true)}
                                className="mt-2 text-sm font-bold px-4 py-2 rounded-lg text-white"
                                style={{ backgroundColor: themeInfo.accent }}
                            >
                                + 開始新 Session
                            </button>
                        </div>
                    )}
                    {sessions.map(session => {
                        const cliOpt = CLI_OPTIONS.find(c => c.id === session.cli);
                        const isActive = activeSessionId === session.id;
                        return (
                            <div
                                key={session.id}
                                onClick={() => setActiveSessionId(session.id)}
                                className={cn(
                                    "group px-4 py-3 border-b cursor-pointer transition-all",
                                    isActive ? "bg-stone-50" : "hover:bg-stone-50/50"
                                )}
                                style={{
                                    borderColor: "#e7e5e4",
                                    borderLeftColor: isActive ? themeInfo.accent : undefined,
                                    borderLeftWidth: isActive ? 3 : undefined,
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-sm">{cliOpt?.icon || "⚪"}</span>
                                    <span className="text-sm font-semibold text-stone-700 flex-1 truncate">{session.name}</span>
                                    <button
                                        onClick={e => { e.stopPropagation(); deleteSession(session.id); }}
                                        className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 text-xs transition-all"
                                    >
                                        ✕
                                    </button>
                                </div>
                                <div className="flex items-center gap-1.5 mt-1">
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: (cliOpt?.color || "#6B7280") + "15", color: cliOpt?.color || "#6B7280" }}>
                                        {session.cli}
                                    </span>
                                    <span className="text-[10px] text-stone-400 truncate">{session.cwd.split("/").pop()}</span>
                                </div>
                                {session.model && (
                                    <div className="text-[10px] text-stone-400 mt-0.5 font-mono">{session.model}</div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Footer hint */}
                <div className="px-4 py-2 border-t shrink-0" style={{ borderColor: themeInfo.accentBorder + "60" }}>
                    <div className="text-[10px] text-stone-400 text-center">
                        ⚡ Vibe Coding — AI 幫你寫程式
                    </div>
                </div>
            </div>

            {/* ── Right: Main Area ── */}
            <div className="flex-1 flex flex-col min-w-0">
                {!activeSession ? (
                    /* Empty state */
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
                        <div className="text-6xl">⚡</div>
                        <h2 className="text-xl font-bold text-stone-700">Vibe Coding</h2>
                        <p className="text-stone-400 text-sm text-center max-w-md leading-relaxed">
                            用你最順手的 AI CLI 工具，在終端機裡快速打造程式碼。
                            <br />支援 Qwen Code、Claude Code、OpenCode 等。
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                            {CLI_OPTIONS.slice(0, 3).map(cli => (
                                <span key={cli.id} className="text-xs px-3 py-1.5 rounded-full border font-semibold" style={{ borderColor: cli.color + "40", color: cli.color, backgroundColor: cli.color + "08" }}>
                                    {cli.icon} {cli.label}
                                </span>
                            ))}
                        </div>
                        <button
                            onClick={() => setShowNewSession(true)}
                            className="mt-4 text-sm font-bold px-6 py-2.5 rounded-xl text-white shadow-lg transition-all hover:shadow-xl active:scale-95"
                            style={{ backgroundColor: themeInfo.accent }}
                        >
                            🚀 開始 Coding
                        </button>
                    </div>
                ) : (
                    <>
                        {/* ── Session Header ── */}
                        <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0" style={{ borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
                            <span className="text-base">{selectedCli?.icon || "⚪"}</span>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold text-stone-700 truncate">{activeSession.name}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: (selectedCli?.color || "#6B7280") + "15", color: selectedCli?.color || "#6B7280" }}>
                                        {activeSession.cli} {activeSession.model && `· ${activeSession.model}`}
                                    </span>
                                    <span className="text-[10px] text-stone-400 font-mono truncate">{activeSession.cwd}</span>
                                    <span className="text-[10px] text-stone-300">
                                        {APPROVAL_MODES.find(m => m.id === activeSession.approvalMode)?.icon} {activeSession.approvalMode}
                                    </span>
                                </div>
                            </div>
                            {/* Quick Actions Toggle */}
                            <button
                                onClick={() => setShowQuickActions(!showQuickActions)}
                                className={cn(
                                    "text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors",
                                    showQuickActions ? "text-stone-600 bg-stone-100" : "text-stone-400"
                                )}
                                style={showQuickActions ? { borderColor: themeInfo.accent, color: themeInfo.accent } : { borderColor: "#d6d3d1" }}
                            >
                                ⚡ Quick
                            </button>
                        </div>

                        {/* ── Quick Actions Bar ── */}
                        {showQuickActions && (
                            <div className="px-4 py-2.5 border-b shrink-0" style={{ borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
                                <div className="flex items-center gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "thin" }}>
                                    <span className="text-[10px] text-stone-400 font-bold shrink-0 mr-1">⚡ 快捷指令</span>
                                    {QUICK_ACTIONS.map(renderQuickAction)}
                                </div>
                            </div>
                        )}

                        {/* ── Terminal ── */}
                        <div className="flex-1 min-h-0 p-3">
                            <TerminalPanel
                                key={activeSession.id}
                                cli={activeSession.cli}
                                model={activeSession.model}
                                cwd={activeSession.cwd}
                                approvalMode={activeSession.approvalMode}
                                systemPrompt={activeSession.systemPrompt}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── Terminal Panel (wraps TerminalConsole with vibe coding specific features) ──
import TerminalConsole from "../components/TerminalConsole";

interface TerminalPanelProps {
    cli: string;
    model: string;
    cwd: string;
    approvalMode: string;
    systemPrompt: string;
}

function TerminalPanel({ cli, model, cwd, approvalMode, systemPrompt }: TerminalPanelProps) {
    const termRef = useRef<any>(null);
    const [customPrompt, setCustomPrompt] = useState("");

    // Listen for quick action prompts
    useEffect(() => {
        const handler = (e: Event) => {
            const { prompt } = (e as CustomEvent).detail;
            if (prompt && termRef.current) {
                termRef.current.sendPrompt(prompt);
            }
        };
        window.addEventListener("paaw:vibe-prompt", handler);
        return () => window.removeEventListener("paaw:vibe-prompt", handler);
    }, []);

    // Listen for Enter key on custom prompt
    const handlePromptSubmit = () => {
        if (!customPrompt.trim()) return;
        if (termRef.current) {
            termRef.current.sendPrompt(customPrompt.trim());
            setCustomPrompt("");
        }
    };

    return (
        <div className="flex flex-col h-full gap-2">
            {/* Terminal */}
            <div className="flex-1 min-h-0">
                <TerminalConsole
                    ref={termRef}
                    cli={cli}
                    model={model || undefined}
                    cwd={cwd}
                    approvalMode={approvalMode}
                    systemPrompt={systemPrompt || undefined}
                />
            </div>

            {/* Custom Prompt Input */}
            <div className="shrink-0 flex items-center gap-2 px-1">
                <div className="flex-1 flex items-center rounded-lg border overflow-hidden" style={{ borderColor: "#313244", backgroundColor: "#181825" }}>
                    <span className="text-stone-500 text-sm pl-3 pr-1 shrink-0">💬</span>
                    <input
                        value={customPrompt}
                        onChange={e => setCustomPrompt(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handlePromptSubmit(); }}
                        placeholder="輸入 prompt 直接送到終端機..."
                        className="flex-1 bg-transparent text-sm text-stone-200 px-2 py-2 outline-none placeholder:text-stone-600 font-mono"
                    />
                    <button
                        onClick={handlePromptSubmit}
                        disabled={!customPrompt.trim()}
                        className="px-3 py-1.5 text-xs font-bold text-white rounded-md mr-1.5 disabled:opacity-30 transition-opacity"
                        style={{ backgroundColor: "#89b4fa" }}
                    >
                        Send ⏎
                    </button>
                </div>
            </div>
        </div>
    );
}
