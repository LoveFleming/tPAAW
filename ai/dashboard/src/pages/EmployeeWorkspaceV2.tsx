import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, cn } from "../components/ui/shared";
import { SKILLS } from "../data/mockData";
import { Skill, CrewSkill, RequiredInput, buildSystemPrompt } from "../types";
import { useTheme } from "../theme";
import TerminalConsole from "../components/TerminalConsole";
import Icon from "../components/Icon";

interface ModelOption {
    id: string;
    name: string;
    current: boolean;
}

interface ConvSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    model: string;
}

interface Props {
    employeeId: string;
}

export default function EmployeeWorkspaceV2({ employeeId }: Props) {
    const employee = SKILLS.find((s) => s.id === employeeId);
    const { info: t } = useTheme();
    const [enabledSkills, setEnabledSkills] = useState<Record<string, boolean>>({});
    const [consoleKey, setConsoleKey] = useState(0);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [chatStarted, setChatStarted] = useState(false);
    const [taskInput, setTaskInput] = useState("");
    const [formData, setFormData] = useState<Record<string, string>>({});
    const [models, setModels] = useState<ModelOption[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>("");
    const [permissionMode, setPermissionMode] = useState<string>("yolo");
    const [selectedCli, setSelectedCli] = useState<string>("qwen");
    const [installedClis, setInstalledClis] = useState<Record<string, { installed: boolean; name: string }>>({});
    const [conversations, setConversations] = useState<ConvSummary[]>([]);
    const [cliTab, setCliTab] = useState<"console" | "logs" | "preview">("console");
    const [showPromptPreview, setShowPromptPreview] = useState(false);
    const [showInputDialog, setShowInputDialog] = useState(false);
    const [inputDialogData, setInputDialogData] = useState<Record<string, string>>({});
    const [inputDialogErrors, setInputDialogErrors] = useState<Record<string, boolean>>({});

    useEffect(() => {
        fetch("http://127.0.0.1:4097/api/models")
            .then(r => r.json())
            .then(data => {
                const list: ModelOption[] = data.models || [];
                setModels(list);
                const current = list.find((m: ModelOption) => m.current);
                if (current) setSelectedModel(current.id);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        fetch("http://127.0.0.1:4097/api/clis")
            .then(r => r.json())
            .then(data => setInstalledClis(data))
            .catch(() => {});
    }, []);

    // Initialize skills
    useEffect(() => {
        if (!employee) return;
        const initial: Record<string, boolean> = {};
        employee.skills.forEach(s => { initial[s.id] = s.enabled; });
        setEnabledSkills(initial);
        setChatStarted(false);
        setFormData({});
    }, [employee]);

    const loadConversations = useCallback(() => {
        if (!employee) return;
        fetch(`http://127.0.0.1:4097/api/conversations/${employee.id}`)
            .then(r => r.json())
            .then(data => setConversations(data.conversations || []))
            .catch(() => {});
    }, [employee]);

    useEffect(() => { loadConversations(); }, [loadConversations]);

    const selectedSkillIds = useMemo(() => {
        return Object.entries(enabledSkills).filter(([_, v]) => v).map(([k]) => k);
    }, [enabledSkills]);

    // Collect all required inputs from selected skills
    const requiredInputs = useMemo(() => {
        if (!employee) return [];
        const inputs: RequiredInput[] = [];
        const seen = new Set<string>();
        for (const id of selectedSkillIds) {
            const sk = employee.skills.find(s => s.id === id);
            if (sk?.requiredInputs) {
                for (const inp of sk.requiredInputs) {
                    if (!seen.has(inp.id)) {
                        seen.add(inp.id);
                        inputs.push(inp);
                    }
                }
            }
        }
        return inputs;
    }, [employee, selectedSkillIds]);

    const effectiveCli = useMemo(() => {
        if (!employee) return "qwen";
        for (const id of selectedSkillIds) {
            const sk = employee.skills.find(s => s.id === id);
            if (sk?.cli) return sk.cli;
        }
        return selectedCli;
    }, [employee, selectedSkillIds, selectedCli]);

    const effectiveModel = useMemo(() => {
        if (!employee) return selectedModel;
        for (const id of selectedSkillIds) {
            const sk = employee.skills.find(s => s.id === id);
            if (sk?.model) return sk.model;
        }
        return selectedModel;
    }, [employee, selectedSkillIds, selectedModel]);

    // Initialize permissionMode from skill config (only on first skill selection)
    const initializedRef = useRef(false);
    useEffect(() => {
        if (!employee || initializedRef.current) return;
        for (const id of selectedSkillIds) {
            const sk = employee.skills.find(s => s.id === id);
            if (sk?.approvalMode) {
                setPermissionMode(sk.approvalMode);
                initializedRef.current = true;
                return;
            }
        }
    }, [employee, selectedSkillIds]);

    // Runtime approval mode — user override always wins
    const effectiveApprovalMode = permissionMode;

    const handleStartClick = () => {
        if (!employee) return;
        if (requiredInputs.length > 0) {
            // Show input dialog
            setInputDialogData({});
            setInputDialogErrors({});
            setShowInputDialog(true);
        } else if (taskInput.trim()) {
            // No required inputs, launch directly
            launchTask({});
        }
    };

    const launchTask = (dialogData: Record<string, string>) => {
        if (!employee) return;
        const allData = { ...dialogData, task: taskInput.trim() };
        const prompt = buildSystemPrompt(employee, selectedSkillIds, allData);
        setSystemPrompt(prompt);
        setFormData(allData);
        setConsoleKey(prev => prev + 1);
        setChatStarted(true);
        setShowInputDialog(false);
    };

    const handleDialogSubmit = () => {
        // Validate required fields
        const errors: Record<string, boolean> = {};
        for (const inp of requiredInputs) {
            if (inp.required && !inputDialogData[inp.id]?.trim()) {
                errors[inp.id] = true;
            }
        }
        if (Object.keys(errors).length > 0) {
            setInputDialogErrors(errors);
            return;
        }
        launchTask(inputDialogData);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleStartClick();
        }
    };

    const stats = [
        { label: "指派任務", value: "12", icon: "chat" as const },
        { label: "完成任務", value: "8", icon: "check" as const },
    ];

    if (!employee) return <div className="p-8 text-stone-400">Employee not found</div>;

    const allSkills = employee.skills || [];

    return (
        <div className="flex flex-col lg:flex-row h-full overflow-hidden">
            {/* ===== Input Dialog Modal ===== */}
            {showInputDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowInputDialog(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                        {/* Dialog header */}
                        <div className="px-6 py-4 border-b" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                            <h3 className="text-lg font-bold" style={{ color: t.accentText }}>任務參數</h3>
                            <p className="text-xs mt-0.5" style={{ color: t.accent }}>
                                {selectedSkillIds.length} 個技能需要以下資料才能啟動
                            </p>
                        </div>

                        {/* Dialog body */}
                        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                            {requiredInputs.map(inp => (
                                <div key={inp.id}>
                                    <label className="flex items-center gap-1.5 text-sm font-medium text-stone-700 mb-1">
                                        {inp.label}
                                        {inp.required && <span className="text-rose-500">*</span>}
                                    </label>
                                    {inp.description && (
                                        <p className="text-[11px] text-stone-400 mb-1.5">{inp.description}</p>
                                    )}
                                    {inp.multiline ? (
                                        <textarea
                                            value={inputDialogData[inp.id] || ""}
                                            onChange={e => {
                                                setInputDialogData(prev => ({ ...prev, [inp.id]: e.target.value }));
                                                if (inputDialogErrors[inp.id]) {
                                                    setInputDialogErrors(prev => { const n = { ...prev }; delete n[inp.id]; return n; });
                                                }
                                            }}
                                            placeholder={inp.placeholder}
                                            rows={4}
                                            className={cn(
                                                "w-full px-3 py-2 text-sm border rounded-xl resize-none focus:outline-none focus:ring-2 transition-colors",
                                                inputDialogErrors[inp.id]
                                                    ? "border-rose-300 focus:ring-rose-200 bg-rose-50/30"
                                                    : "border-stone-200 focus:ring-blue-100"
                                            )}
                                        />
                                    ) : (
                                        <input
                                            type="text"
                                            value={inputDialogData[inp.id] || ""}
                                            onChange={e => {
                                                setInputDialogData(prev => ({ ...prev, [inp.id]: e.target.value }));
                                                if (inputDialogErrors[inp.id]) {
                                                    setInputDialogErrors(prev => { const n = { ...prev }; delete n[inp.id]; return n; });
                                                }
                                            }}
                                            placeholder={inp.placeholder}
                                            className={cn(
                                                "w-full px-3 py-2 text-sm border rounded-xl focus:outline-none focus:ring-2 transition-colors",
                                                inputDialogErrors[inp.id]
                                                    ? "border-rose-300 focus:ring-rose-200 bg-rose-50/30"
                                                    : "border-stone-200 focus:ring-blue-100"
                                            )}
                                        />
                                    )}
                                    {inputDialogErrors[inp.id] && (
                                        <p className="text-[11px] text-rose-500 mt-1">此欄位為必填</p>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Dialog footer */}
                        <div className="px-6 py-3 border-t border-stone-100 flex items-center justify-end gap-2">
                            <button
                                onClick={() => setShowInputDialog(false)}
                                className="px-4 py-2 text-sm rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleDialogSubmit}
                                className="px-5 py-2 text-sm font-bold text-white rounded-xl transition-colors shadow-sm"
                                style={{ backgroundColor: t.accent }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accentHover; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = t.accent; }}
                            >
                                🚀 啟動任務
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== Main Content ===== */}
            <div className="flex-1 flex flex-col overflow-y-auto p-2 sm:p-3 gap-2 sm:gap-2.5 min-w-0 min-h-0">

                {/* --- Profile Banner --- */}
                <Card className="overflow-hidden border shadow-sm" style={{ borderColor: t.accentBorder }}>
                    <div className="flex flex-col sm:flex-row" style={{ background: `linear-gradient(to right, ${t.accentLight}, white, ${t.accentBg})` }}>
                        {/* Photo */}
                        <div className="w-full sm:w-40 md:w-52 shrink-0 flex items-center justify-center p-3 max-h-[160px] sm:max-h-none">
                            <img
                                src={employee.imageUrl}
                                alt={employee.title}
                                className="w-full h-full object-contain drop-shadow-lg"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                        </div>
                        {/* Info */}
                        <div className="flex-1 py-2 sm:py-3 px-3 sm:px-4 flex flex-col justify-center min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-xl sm:text-2xl font-bold text-stone-800">{employee.codename || employee.title}</span>
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: t.accentLight, color: t.accent }}>
                                    AI 員工
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-stone-600 mb-1 sm:mb-2">
                                <Icon name="gear" size={14} style={{ color: t.accent }} />
                                <span className="font-medium text-sm">{employee.title}</span>
                            </div>
                            <p className="text-sm text-stone-500 mb-2 line-clamp-2 hidden sm:block">{employee.rolePrompt?.split("。")[0]}</p>
                            <div className="flex items-center gap-1.5 text-xs">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-emerald-600 font-medium">在線上</span>
                            </div>
                        </div>
                        {/* Skills + Actions — hidden on small, visible md+ */}
                        <div className="hidden md:flex flex-[2] py-3 pr-4 pl-2 flex-col justify-center gap-2.5 min-w-0">
                            <div className="rounded-xl p-3 border" style={{ backgroundColor: "rgba(255,255,255,0.7)", borderColor: t.accentBorder }}>
                                <div className="flex items-center gap-1.5 mb-2">
                                    <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ backgroundColor: t.accent }}>
                                        <Icon name="lightning" size={12} className="text-white" />
                                    </div>
                                    <span className="text-sm font-bold text-stone-700">Skills</span>
                                    <span className="text-[10px] text-stone-400 ml-auto">{selectedSkillIds.length}/{allSkills.length} 已選</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {allSkills.map(sk => (
                                        <button
                                            key={sk.id}
                                            onClick={() => setEnabledSkills(prev => {
                                                const isOn = prev[sk.id];
                                                const next: Record<string, boolean> = {};
                                                if (!isOn) next[sk.id] = true;
                                                return next;
                                            })}
                                            className={cn(
                                                "text-sm font-medium px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 whitespace-nowrap",
                                            )}
                                            style={enabledSkills[sk.id]
                                                ? { backgroundColor: t.accent, color: "white", borderColor: t.accent, boxShadow: `0 1px 3px ${t.accent}40` }
                                                : { backgroundColor: "white", color: "#57534e", borderColor: "#e7e5e4" }
                                            }
                                            onMouseEnter={e => { if (!enabledSkills[sk.id]) { e.currentTarget.style.borderColor = t.accentBorder; e.currentTarget.style.backgroundColor = t.accentBg; } }}
                                            onMouseLeave={e => { if (!enabledSkills[sk.id]) { e.currentTarget.style.borderColor = "#e7e5e4"; e.currentTarget.style.backgroundColor = "white"; } }}
                                        >
                                            <Icon name={enabledSkills[sk.id] ? "check" : "gear"} size={12} />
                                            {sk.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowPromptPreview(!showPromptPreview)}
                                    className="flex-1 px-3 py-2 rounded-xl text-sm font-medium bg-white border text-stone-600 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                    style={{ borderColor: t.accentBorder, color: t.accentText }}
                                >
                                    <Icon name="document" size={14} /> 提示詞
                                </button>
                                <button
                                    onClick={handleStartClick}
                                    className="flex-1 px-3 py-2 rounded-xl text-sm font-bold text-white transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                    style={{ backgroundColor: t.accent, boxShadow: `0 1px 3px ${t.accent}40` }}
                                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accentHover; }}
                                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = t.accent; }}
                                >
                                    <Icon name="rocket" size={14} /> 開始
                                </button>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* --- Mobile Skills row (visible < md) --- */}
                <Card className="md:hidden overflow-hidden border shadow-sm" style={{ borderColor: t.accentBorder }}>
                    <div className="p-2.5 flex flex-wrap gap-1.5 items-center">
                        <div className="w-5 h-5 rounded-md flex items-center justify-center mr-1" style={{ backgroundColor: t.accent }}>
                            <Icon name="lightning" size={10} className="text-white" />
                        </div>
                        {allSkills.map(sk => (
                            <button
                                key={sk.id}
                                onClick={() => setEnabledSkills(prev => {
                                    const isOn = prev[sk.id];
                                    const next: Record<string, boolean> = {};
                                    if (!isOn) next[sk.id] = true;
                                    return next;
                                })}
                                className={cn("text-xs font-medium px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 whitespace-nowrap")}
                                style={enabledSkills[sk.id]
                                    ? { backgroundColor: t.accent, color: "white", borderColor: t.accent }
                                    : { backgroundColor: "white", color: "#57534e", borderColor: "#e7e5e4" }
                                }
                            >
                                {sk.name}
                            </button>
                        ))}
                        <button
                            onClick={handleStartClick}
                            className="ml-auto px-3 py-1 rounded-lg text-xs font-bold text-white flex items-center gap-1"
                            style={{ backgroundColor: t.accent }}
                        >
                            <Icon name="rocket" size={11} /> 開始
                        </button>
                    </div>
                </Card>

                {/* --- CLI Console --- */}
                <Card className="flex-1 min-h-[280px] sm:min-h-[400px] flex flex-col border shadow-sm overflow-hidden" style={{ borderColor: t.accentBorder + "60" }}>
                    {/* Console header */}
                    <div className="flex items-center justify-between px-2 sm:px-4 py-2 border-b gap-2" style={{ borderColor: t.accentBorder + "40", backgroundColor: t.accentBg }}>
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: t.accent }}>
                                <span className="text-white text-[10px] font-black">O</span>
                            </div>
                            <span className="font-bold text-sm truncate" style={{ color: t.accentText }}>
                                {effectiveCli === 'claude' ? 'Claude Code' : effectiveCli === 'opencode' ? 'OpenCode' : 'Qwen'} CLI
                            </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                            {/* Approval Mode — runtime changeable, restarts console */}
                            <select
                                value={permissionMode}
                                onChange={e => {
                                    setPermissionMode(e.target.value);
                                    setConsoleKey(prev => prev + 1);
                                    setChatStarted(true);
                                }}
                                className="px-1.5 py-1 rounded-lg border text-[11px] bg-white cursor-pointer"
                                style={{ borderColor: t.accentBorder, color: t.accentText }}
                                title="Approval Mode — changing restarts console"
                            >
                                <option value="default">🔒 Default</option>
                                <option value="auto-edit">✏️ Auto-Edit</option>
                                <option value="yolo">⚡ YOLO</option>
                                <option value="plan">📋 Plan</option>
                            </select>
                            {/* CLI Engine — display only */}
                            <select
                                disabled
                                className="px-1.5 py-1 rounded-lg border text-[11px] bg-stone-50 opacity-60 cursor-not-allowed"
                                style={{ borderColor: t.accentBorder, color: t.accentText }}
                                title="CLI engine is set by skill config — change in skill settings"
                                value={effectiveCli}
                            >
                                {Object.entries(installedClis).map(([key, info]: [string, any]) => (
                                    <option key={key} value={key}>
                                        {info.name} {!info.installed ? '(未安裝)' : ''}
                                    </option>
                                ))}
                            </select>
                            {/* Model — display only */}
                            {models.length > 0 && (
                                <select
                                    disabled
                                    className="hidden sm:block px-1.5 py-1 rounded-lg border text-[11px] bg-stone-50 opacity-60 cursor-not-allowed max-w-[140px] truncate"
                                    style={{ borderColor: t.accentBorder, color: t.accentText }}
                                    title="Model is set by skill config — change in skill settings"
                                    value={effectiveModel}
                                >
                                    {models.map(m => (
                                        <option key={m.id} value={m.id}>
                                            {m.name.length > 20 ? m.name.slice(0, 20) + '...' : m.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <button
                                onClick={() => setShowPromptPreview(!showPromptPreview)}
                                className="hidden sm:flex px-2 py-1 rounded-lg border text-[11px] transition-colors items-center gap-1"
                                style={{ borderColor: t.accentBorder, color: t.accent }}
                            >
                                <Icon name="document" size={11} /> Prompt
                            </button>
                        </div>
                    </div>

                    {/* Console tabs */}
                    <div className="flex border-b px-2 sm:px-4" style={{ borderColor: t.accentBorder + "40" }}>
                        {(["console", "logs", "preview"] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setCliTab(tab)}
                                className={cn("px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px")}
                                style={cliTab === tab
                                    ? { borderColor: t.accent, color: t.accent }
                                    : { borderColor: "transparent", color: t.accent + "50" }
                                }
                            >
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            </button>
                        ))}
                    </div>

                    {/* Terminal */}
                    <div className="flex-1 min-h-0">
                        {cliTab === "console" ? (
                            <TerminalConsole
                                key={`terminal-${consoleKey}`}
                                cwd={undefined}
                                cli={effectiveCli}
                                model={effectiveModel || undefined}
                                approvalMode={effectiveApprovalMode}
                                systemPrompt={undefined}
                                initialPrompt={chatStarted ? [
                                    systemPrompt ? `# System Instructions\n${systemPrompt}` : '',
                                    taskInput ? `# Task\n${taskInput}` : '',
                                ].filter(Boolean).join('\n\n') : undefined}
                            />
                        ) : cliTab === "logs" ? (
                            <div className="h-full flex items-center justify-center text-sm bg-slate-900" style={{ color: t.accent + "60" }}>
                                <div className="text-center">
                                    <Icon name="document" size={24} className="mx-auto mb-2 opacity-30" />
                                    <p>Logs will appear here</p>
                                </div>
                            </div>
                        ) : (
                            showPromptPreview && systemPrompt ? (
                                <div className="h-full overflow-auto p-4" style={{ backgroundColor: t.accentBg }}>
                                    <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono">{systemPrompt}</pre>
                                </div>
                            ) : (
                                <div className="h-full flex items-center justify-center text-sm" style={{ backgroundColor: t.accentBg, color: t.accent + "60" }}>
                                    <div className="text-center">
                                        <Icon name="document" size={24} className="mx-auto mb-2 opacity-30" />
                                        <p>Start a task to preview prompt</p>
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                </Card>
            </div>

            {/* ===== Right Sidebar ===== */}
            <div className="w-full lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l bg-white/80 overflow-y-auto p-2 sm:p-3 flex flex-col gap-2 sm:gap-2.5 max-h-[260px] lg:max-h-none"
                style={{ borderColor: t.accentBorder + "40" }}>

                {/* Overview Stats */}
                <Card className="p-2 sm:p-3 border shadow-sm" style={{ borderColor: t.accentBorder }}>
                    <h3 className="font-bold text-sm mb-0.5" style={{ color: t.accentText }}>概覽</h3>
                    <p className="text-[10px] mb-2" style={{ color: t.accent + "80" }}>今日工作概要</p>
                    <div className="grid grid-cols-2 gap-2">
                        {stats.map(s => (
                            <div key={s.label} className="rounded-xl p-2 sm:p-3 text-center" style={{ backgroundColor: t.accentBg }}>
                                <div className="flex items-center justify-center gap-1 mb-1">
                                    <Icon name={s.icon} size={12} style={{ color: t.accent }} />
                                    <span className="text-lg font-bold" style={{ color: t.accentText }}>{s.value}</span>
                                </div>
                                <span className="text-[10px]" style={{ color: t.accent + "90" }}>{s.label}</span>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Quick Actions */}
                <Card className="p-2 sm:p-3 border shadow-sm" style={{ borderColor: t.accentBorder }}>
                    <h3 className="font-bold text-sm mb-2" style={{ color: t.accentText }}>快速操作</h3>
                    <div className="flex flex-row lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible">
                        {[
                            { label: "建立新任務", icon: "plus" as const, desc: "開一個新的 CLI session" },
                            { label: "建立新 Skill", icon: "lightning" as const, desc: "擴充員工能力" },
                            { label: "匯出對話紀錄", icon: "save" as const, desc: "存成 Markdown" },
                        ].map(a => (
                            <button
                                key={a.label}
                                className="flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors text-left group shrink-0 lg:shrink"
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accentBg; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = ""; }}
                            >
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform" style={{ backgroundColor: t.accentLight }}>
                                    <Icon name={a.icon} size={14} style={{ color: t.accent }} />
                                </div>
                                <div className="min-w-0 hidden sm:block">
                                    <div className="text-xs font-medium" style={{ color: t.accentText }}>{a.label}</div>
                                    <div className="text-[10px]" style={{ color: t.accent + "80" }}>{a.desc}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </Card>

                {/* Recent Conversations */}
                <Card className="p-2 sm:p-3 border shadow-sm flex-1" style={{ borderColor: t.accentBorder }}>
                    <div className="flex items-center justify-between mb-1.5">
                        <h3 className="font-bold text-sm" style={{ color: t.accentText }}>最近對話</h3>
                        <span className="text-[10px] cursor-pointer" style={{ color: t.accent }}>查看全部</span>
                    </div>
                    {conversations.length === 0 ? (
                        <div className="space-y-1.5">
                            {["如何建立新的微服務？", "工廠的部署流程是什麼？", "如何設定權限與角色？"].map((q, i) => (
                                <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: t.accentBorder + "40" }}>
                                    <span className="text-xs truncate" style={{ color: t.accentText + "70" }}>{q}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            {conversations.slice(0, 3).map(c => (
                                <div key={c.id} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: t.accentBorder + "40" }}>
                                    <span className="text-xs truncate flex-1" style={{ color: t.accentText + "70" }}>{c.title}</span>
                                    <span className="text-[10px] shrink-0 ml-2" style={{ color: t.accent + "60" }}>
                                        {new Date(c.updatedAt).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                {/* Quote */}
                <Card className="p-3 sm:p-4 border shadow-sm relative overflow-hidden mt-auto hidden sm:block"
                    style={{ borderColor: t.accentBorder, background: `linear-gradient(to bottom right, ${t.accentLight}, ${t.accentBg})` }}>
                    <div className="absolute top-2 right-3 text-5xl font-serif" style={{ color: t.accent + "25" }}>\"</div>
                    <p className="text-sm text-stone-600 italic leading-relaxed relative z-10">
                        導入創新，萬機皆服務，萬事皆連結。
                    </p>
                    <p className="text-[10px] mt-2 font-medium" style={{ color: t.accent + "80" }}>— AI Software Factory</p>
                </Card>
            </div>
        </div>
    );
}
