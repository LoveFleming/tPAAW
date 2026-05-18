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
    projectRoot?: string;
}

export default function EmployeeWorkspaceV2({ employeeId, projectRoot }: Props) {
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
    const [fullscreen, setFullscreen] = useState(false);
    const [showPromptPreview, setShowPromptPreview] = useState(false);
    const [showInputDialog, setShowInputDialog] = useState(false);
    const [inputDialogData, setInputDialogData] = useState<Record<string, string>>({});
    const [inputDialogErrors, setInputDialogErrors] = useState<Record<string, boolean>>({});
    const [savedInputs, setSavedInputs] = useState<Array<{ hash: string; skillId: string; data: Record<string, string>; savedAt: string }>>([]);
    const [rightPanelOpen, setRightPanelOpen] = useState(true);
    const [showWorkLog, setShowWorkLog] = useState(false);
    const [workLog, setWorkLog] = useState<Array<{ id: string; skillIds: string[]; inputSummary: string; cli: string; timestamp: string }>>([]);

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

    const projectPathHash = useMemo(() => {
        if (!projectRoot) return "_default";
        // Simple hash: replace non-alphanumeric with underscore
        return projectRoot.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "_default";
    }, [projectRoot]);

    const loadConversations = useCallback(() => {
        if (!employee) return;
        const params = new URLSearchParams({ root: projectRoot || "" });
        fetch(`http://127.0.0.1:4097/api/conversations/${employee.id}?${params}`)
            .then(r => r.json())
            .then(data => setConversations(data.conversations || data || []))
            .catch(() => {});
    }, [employee, projectRoot]);

    useEffect(() => { loadConversations(); }, [loadConversations]);

    const loadSavedInputs = useCallback(() => {
        if (!employee) return;
        const params = new URLSearchParams({ root: projectRoot || "" });
        fetch(`http://127.0.0.1:4097/api/saved-inputs/${employee.id}?${params}`)
            .then(r => r.json())
            .then(data => setSavedInputs(data.inputs || []))
            .catch(() => {});
    }, [employee, projectRoot]);

    useEffect(() => { loadSavedInputs(); }, [loadSavedInputs]);

    const loadWorkLog = useCallback(() => {
        if (!employee) return;
        const params = new URLSearchParams({ root: projectRoot || "" });
        fetch(`http://127.0.0.1:4097/api/work-log/${employee.id}?${params}`)
            .then(r => r.json())
            .then(data => setWorkLog(data.entries || []))
            .catch(() => {});
    }, [employee, projectRoot]);

    useEffect(() => { loadWorkLog(); }, [loadWorkLog]);

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

    // Simple MD5-like hash using crypto.subtle (async) — fallback to simple hash
    const computeHash = async (data: Record<string, string>): Promise<string> => {
        const str = JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('MD5' as AlgorithmIdentifier, dataBuffer).catch(() => null) || await crypto.subtle.digest('SHA-256', dataBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch {
            // Fallback: simple string hash
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash |= 0;
            }
            return Math.abs(hash).toString(16).padStart(8, '0');
        }
    };

    const launchTask = async (dialogData: Record<string, string>) => {
        if (!employee) return;
        const allData = { ...dialogData, task: taskInput.trim() };
        const prompt = buildSystemPrompt(employee, selectedSkillIds, allData);
        setSystemPrompt(prompt);
        setFormData(allData);
        setConsoleKey(prev => prev + 1);
        setChatStarted(true);
        setShowInputDialog(false);

        // Save input via API
        if (Object.keys(dialogData).length > 0 || taskInput.trim()) {
            try {
                const allDataForHash = { ...dialogData, task: taskInput.trim() };
                const hash = await computeHash(allDataForHash);
                const existingHashes = savedInputs.map(i => i.hash);
                if (!existingHashes.includes(hash)) {
                    const params = new URLSearchParams({ root: projectRoot || "" });
                    await fetch(`http://127.0.0.1:4097/api/saved-inputs/${employee.id}?${params}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            hash,
                            skillId: selectedSkillIds.join(","),
                            data: allDataForHash,
                        }),
                    });
                    loadSavedInputs();
                }
            } catch {
                // Non-critical — ignore save errors
            }
        }

        // Save work log
        try {
            const inputSummary = Object.entries(allData).map(([k, v]) => v).filter(Boolean).join(", ") || taskInput.trim() || "";
            const params = new URLSearchParams({ root: projectRoot || "" });
            await fetch(`http://127.0.0.1:4097/api/work-log/${employee.id}?${params}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    skillIds: selectedSkillIds,
                    inputSummary: inputSummary.slice(0, 100),
                    cli: effectiveCli,
                }),
            });
            loadWorkLog();
        } catch {
            // Non-critical — ignore save errors
        }
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

    // ESC to exit fullscreen
    useEffect(() => {
        if (!fullscreen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") setFullscreen(false);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [fullscreen]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleStartClick();
        }
    };

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
                            {/* Saved Inputs Quick Select */}
                            {savedInputs.length > 0 && (
                                <div>
                                    <label className="flex items-center gap-1.5 text-sm font-medium text-stone-700 mb-1">
                                        📋 已存輸入
                                    </label>
                                    <p className="text-[11px] text-stone-400 mb-1.5">選擇過去的輸入快速填入</p>
                                    <select
                                        className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        value=""
                                        onChange={e => {
                                            if (!e.target.value) return;
                                            try {
                                                const saved = JSON.parse(e.target.value);
                                                setInputDialogData(saved.data || {});
                                                if (saved.data?.task) setTaskInput(saved.data.task);
                                            } catch {}
                                        }}
                                    >
                                        <option value="">-- 選擇已存輸入 --</option>
                                        {savedInputs.map((si, idx) => (
                                            <option key={idx} value={JSON.stringify(si)}>
                                                {Object.values(si.data).slice(0, 2).join(' / ') || si.skillId} ({new Date(si.savedAt).toLocaleDateString('zh-TW')})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
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
                                    onClick={() => setShowWorkLog(true)}
                                    className="flex-1 px-3 py-2 rounded-xl text-sm font-medium bg-white border text-stone-600 transition-colors flex items-center justify-center gap-1.5 shadow-sm relative"
                                    style={{ borderColor: t.accentBorder, color: t.accentText }}
                                >
                                    <Icon name="clock" size={14} /> 最近工作
                                    {workLog.length > 0 && (
                                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-white text-[9px] flex items-center justify-center" style={{ backgroundColor: t.accent }}>{workLog.length > 9 ? '9+' : workLog.length}</span>
                                    )}
                                </button>
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

                {/* --- CLI Console or Empty State --- */}
                {!chatStarted ? (
                    <div className="flex-1 min-h-[280px] sm:min-h-[400px] flex flex-col border rounded-xl" style={{ borderColor: t.accentBorder + "60" }}>
                        <div className="flex-1 flex flex-col items-center justify-center gap-3">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: t.accentBg }}>
                                <Icon name="lightning" size={28} style={{ color: t.accent + (selectedSkillIds.length > 0 ? "80" : "40") }} />
                            </div>
                            <div className="text-center">
                                {selectedSkillIds.length === 0 ? (
                                    <>
                                        <p className="text-sm font-semibold" style={{ color: t.accentText }}>選擇一個技能才能開始工作</p>
                                        <p className="text-xs mt-1" style={{ color: t.accent + "80" }}>從上方的 Skills 面板選擇一個技能</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm font-semibold" style={{ color: t.accentText }}>準備好了！按下「開始」啟動工作</p>
                                        <p className="text-xs mt-1" style={{ color: t.accent + "80" }}>選擇的技能：{selectedSkillIds.map(sid => employee?.skills.find(s => s.id === sid)?.name).filter(Boolean).join(', ')}</p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
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
                            <button
                                onClick={() => setFullscreen(true)}
                                className="px-1.5 py-1 rounded-lg border text-[11px] transition-colors flex items-center"
                                style={{ borderColor: t.accentBorder, color: t.accent }}
                                title="全螢幕"
                            >
                                <Icon name="expand" size={14} />
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
                )}

                {/* ===== Fullscreen Console Overlay ===== */}
                {fullscreen && chatStarted && (
                    <div className="fixed inset-0 z-50 bg-black flex flex-col">
                        {/* Fullscreen header */}
                        <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: t.accent }}>
                                    <span className="text-white text-[10px] font-black">O</span>
                                </div>
                                <span className="font-bold text-sm text-gray-200 truncate">
                                    {effectiveCli === 'claude' ? 'Claude Code' : effectiveCli === 'opencode' ? 'OpenCode' : 'Qwen'} CLI — 全螢幕
                                </span>
                            </div>
                            <button
                                onClick={() => setFullscreen(false)}
                                className="px-2 py-1 rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-gray-400 transition-colors flex items-center gap-1.5 text-xs"
                                title="退出全螢幕 (Esc)"
                            >
                                <Icon name="contract" size={14} /> ESC
                            </button>
                        </div>
                        {/* Fullscreen console body */}
                        <div className="flex-1 min-h-0">
                            {cliTab === "console" ? (
                                <TerminalConsole
                                    key={`terminal-fs-${consoleKey}`}
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
                                <div className="h-full flex items-center justify-center text-sm text-gray-500">
                                    <div className="text-center">
                                        <Icon name="document" size={24} className="mx-auto mb-2 opacity-30" />
                                        <p>Logs will appear here</p>
                                    </div>
                                </div>
                            ) : (
                                showPromptPreview && systemPrompt ? (
                                    <div className="h-full overflow-auto p-6 bg-gray-950">
                                        <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">{systemPrompt}</pre>
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-sm text-gray-500">
                                        <div className="text-center">
                                            <Icon name="document" size={24} className="mx-auto mb-2 opacity-30" />
                                            <p>Start a task to preview prompt</p>
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                        {/* Fullscreen tabs */}
                        <div className="flex border-t border-gray-700 bg-gray-900 px-4 shrink-0">
                            {(["console", "logs", "preview"] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setCliTab(tab)}
                                    className={cn("px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
                                        cliTab === tab ? "border-blue-400 text-blue-400" : "border-transparent text-gray-500"
                                    )}
                                >
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* ===== Work Log Popup ===== */}
            {showWorkLog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowWorkLog(false)}>
                    <div className="absolute inset-0 bg-black/30" />
                    <div className="relative bg-white rounded-2xl shadow-2xl border w-[400px] max-h-[70vh] flex flex-col" style={{ borderColor: t.accentBorder }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: t.accentBorder + "40" }}>
                            <h3 className="font-bold text-sm" style={{ color: t.accentText }}>最近工作</h3>
                            <button onClick={() => setShowWorkLog(false)} className="text-stone-400 hover:text-stone-600 text-lg leading-none cursor-pointer">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: "thin" }}>
                            {workLog.length === 0 ? (
                                <p className="text-xs text-center py-8" style={{ color: t.accentText + "50" }}>尚無工作紀錄</p>
                            ) : (
                                <div className="space-y-2.5">
                                    {workLog.map(w => (
                                        <div key={w.id} className="p-2.5 rounded-lg border" style={{ borderColor: t.accentBorder + "60", background: t.accentLight + "40" }}>
                                            <div className="flex items-center justify-between mb-1">
                                                {w.skillIds?.length > 0 ? (
                                                    <div className="flex gap-1 flex-wrap">
                                                        {w.skillIds.map(s => (
                                                            <span key={s} className="text-[10px] inline-block px-1.5 py-0.5 rounded-full" style={{ background: t.accent + "20", color: t.accent }}>{s}</span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px]" style={{ color: t.accentText + "50" }}>general</span>
                                                )}
                                                <span className="text-[10px] shrink-0" style={{ color: t.accent + "70" }}>
                                                    {new Date(w.timestamp).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <p className="text-xs truncate" style={{ color: t.accentText + "80" }}>{w.inputSummary || "—"}</p>
                                            {w.cli && <span className="text-[10px]" style={{ color: t.accentText + "40" }}>via {w.cli}</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
