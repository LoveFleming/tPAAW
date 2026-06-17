import API_BASE from "../api";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, cn } from "../components/ui/shared";
import { Crew, SkillDefinition, UserInput, buildSystemPrompt, migrateCrew } from "../types";
import { useTheme } from "../theme";
import Icon from "../components/Icon";
import TerminalConsole from "../components/TerminalConsole";

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
    crew?: Crew[];
}

export default function EmployeeWorkspace({ employeeId, projectRoot, crew: crewProp, factoryId = "default" }: Props & { factoryId?: string }) {
    // Use crew from props (API-fetched) to avoid HMR reset when crew JSON files change
    const [apiEmployee, setApiEmployee] = useState<Crew | null>(null);
    const propEmployee = crewProp?.find((s) => s.id === employeeId) || null;
    // Fallback: fetch fresh from API on mount if not in crew prop
    useEffect(() => {
        if (propEmployee) return;
        fetch(`${API_BASE}/api/crew/${employeeId}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setApiEmployee(data); })
            .catch(() => {});
    }, [employeeId, propEmployee]);
    const rawEmployee = propEmployee || apiEmployee;
    const employee = rawEmployee ? migrateCrew(rawEmployee) : null;
    const { info: t } = useTheme();

    // ── Skill Definitions (fetched from /api/skills) ──
    const [skillDefinitions, setSkillDefinitions] = useState<Map<string, SkillDefinition>>(new Map());
    useEffect(() => {
        fetch(`${API_BASE}/api/skills`)
            .then(r => r.json())
            .then((data: SkillDefinition[]) => {
                const map = new Map<string, SkillDefinition>();
                for (const sd of data) map.set(sd.id, sd);
                setSkillDefinitions(map);
            })
            .catch(() => {});
    }, []);

    const [skillRules, setSkillRules] = useState("");
    useEffect(() => {
        fetch(`${API_BASE}/api/ai-settings/crew/skill-rules.md`)
            .then(r => r.json())
            .then(data => setSkillRules(data.content || ""))
            .catch(() => {});
    }, []);

    const [enabledSkills, setEnabledSkills] = useState<Record<string, boolean>>({});
    const [consoleKey, setConsoleKey] = useState(0);
    const [restartCount, setRestartCount] = useState(0);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [chatStarted, setChatStarted] = useState(false);
    const [taskInput, setTaskInput] = useState("");

    // Load workspaces
    const [workspaces, setWorkspaces] = useState<string[]>([]);
    useEffect(() => {
        fetch(`${API_BASE}/api/paaw/workspaces`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?.directories) setWorkspaces(data.directories); })
            .catch(() => {});
    }, []);

    // "Running" config = what the active console is using (persisted in chatConfig)
    // Fallback chain: employee.chatConfig → global CLI config → "qwen"
    const [globalCliConfig, setGlobalCliConfig] = useState({ defaultCli: "qwen", defaultModel: "" });
    useEffect(() => {
        fetch(`${API_BASE}/api/paaw/cli-config`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.configured) setGlobalCliConfig({ defaultCli: data.defaultCli || "qwen", defaultModel: data.defaultModel || "" });
            })
            .catch(() => {});
    }, []);
    const savedCli = employee?.chatConfig?.cli || globalCliConfig.defaultCli || "qwen";
    const savedModel = employee?.chatConfig?.model || globalCliConfig.defaultModel || "";
    const savedApproval = employee?.chatConfig?.approvalMode || "yolo";
    const [runningCli, setRunningCli] = useState(savedCli);
    const [runningModel, setRunningModel] = useState(savedModel);
    const [runningApproval, setRunningApproval] = useState(savedApproval);
    // Sync running config when employee changes (different employee selected)
    const prevEmpIdRef = useRef(employee?.id);
    useEffect(() => {
        if (employee?.id !== prevEmpIdRef.current) {
            prevEmpIdRef.current = employee?.id;
            setRunningCli(savedCli);
            setRunningModel(savedModel);
            setRunningApproval(savedApproval);
            setSelectedModel(savedModel);
            fetchModels(savedCli, savedModel);
        }
    }, [employee?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const [paawRoot, setPaawRoot] = useState("");

        const [formData, setFormData] = useState<Record<string, string>>({});
    const [models, setModels] = useState<ModelOption[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>("");
    const [permissionMode, setPermissionMode] = useState<string>("yolo");
    const [installedClis, setInstalledClis] = useState<Record<string, { installed: boolean; name: string }>>({});
    const [conversations, setConversations] = useState<ConvSummary[]>([]);
    const [fullscreen, setFullscreen] = useState(false);
    const [showInputDialog, setShowInputDialog] = useState(false);
    const [inputDialogData, setInputDialogData] = useState<Record<string, string>>({});
    const [inputDialogErrors, setInputDialogErrors] = useState<Record<string, boolean>>({});
    const [savedInputs, setSavedInputs] = useState<Array<{ hash: string; skillId: string; data: Record<string, string>; savedAt: string }>>([]);
    const [rightPanelOpen, setRightPanelOpen] = useState(true);
    const [showWorkLog, setShowWorkLog] = useState(false);
    const [showSkillPrompts, setShowSkillPrompts] = useState(false);
    const [workLog, setWorkLog] = useState<Array<{ id: string; skillIds: string[]; inputSummary: string; cli: string; inputData?: Record<string, string>; timestamp: string }>>([]);

    // Fetch models for a specific CLI
    const fetchModels = useCallback((cli: string, preferModel?: string) => {
        fetch(`${API_BASE}/api/models?cli=${cli}`)
            .then(r => r.json())
            .then(data => {
                if (data.paawRoot) setPaawRoot(data.paawRoot);
                const list: ModelOption[] = data.models || [];
                setModels(list);
                // Prefer saved model if it exists in the list
                if (preferModel != null && list.find(m => m.id === preferModel)) {
                    setSelectedModel(preferModel);
                } else {
                    const current = list.find((m: ModelOption) => m.current);
                    setSelectedModel(current ? current.id : (list.length > 0 ? list[0].id : ""));
                }
            })
            .catch(() => {});
    }, []);

    // Initial fetch with saved config — only once on mount
    const mountedRef = useRef(false);
    useEffect(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;
        fetchModels(savedCli, savedModel);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        fetch(`${API_BASE}/api/clis`)
            .then(r => r.json())
            .then(data => setInstalledClis(data))
            .catch(() => {});
    }, []);

    // Initialize skills
    const prevEmployeeIdRef = useRef<string>(employeeId);
    useEffect(() => {
        if (!employee) return;
        // Only reset state when switching to a DIFFERENT employee
        const changed = prevEmployeeIdRef.current !== employeeId;
        prevEmployeeIdRef.current = employeeId;
        if (changed) {
            const initial: Record<string, boolean> = {};
            (employee.skillIds || []).forEach(id => { initial[id] = true; });
            setEnabledSkills(initial);
            setChatStarted(false);
            setFormData({});
        }
    }, [employeeId]); // ← ONLY employeeId, not employee object

    const projectPathHash = useMemo(() => {
        if (!projectRoot) return "_default";
        // Simple hash: replace non-alphanumeric with underscore
        return projectRoot.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "_default";
    }, [projectRoot]);

    const loadConversations = useCallback(() => {
        if (!employeeId) return;
        const params = new URLSearchParams({ root: projectRoot || "" });
        fetch(`${API_BASE}/api/conversations/${employeeId}?${params}`)
            .then(r => r.json())
            .then(data => setConversations(data.conversations || data || []))
            .catch(() => {});
    }, [employeeId, projectRoot]);

    useEffect(() => { loadConversations(); }, [loadConversations]);

    const loadSavedInputs = useCallback(() => {
        if (!employeeId) return;
        const params = new URLSearchParams({ root: projectRoot || "" });
        fetch(`${API_BASE}/api/saved-inputs/${employeeId}?${params}`)
            .then(r => r.json())
            .then(data => setSavedInputs(data.inputs || []))
            .catch(() => {});
    }, [employeeId, projectRoot]);

    useEffect(() => { loadSavedInputs(); }, [loadSavedInputs]);

    const loadWorkLog = useCallback(() => {
        if (!employeeId) return;
        const params = new URLSearchParams({ root: projectRoot || "" });
        fetch(`${API_BASE}/api/work-log/${employeeId}?${params}`)
            .then(r => r.json())
            .then(data => setWorkLog(data.entries || []))
            .catch(() => {});
    }, [employeeId, projectRoot]);

    useEffect(() => { loadWorkLog(); }, [loadWorkLog]);

    const selectedSkillIds = useMemo(() => {
        return Object.entries(enabledSkills).filter(([_, v]) => v).map(([k]) => k);
    }, [enabledSkills]);

    // Collect all user inputs from selected skills
    const requiredInputs = useMemo(() => {
        if (!employee) return [];
        const inputs: UserInput[] = [];
        const seen = new Set<string>();
        for (const id of selectedSkillIds) {
            const sk = skillDefinitions.get(id);
            const skillInputs = sk?.userInputs || [];
            for (const inp of skillInputs) {
                if (!seen.has(inp.id)) {
                    seen.add(inp.id);
                    inputs.push(inp);
                }
            }
        }
        return inputs;
    }, [employee, selectedSkillIds, skillDefinitions]);

    // Default CLI from employee chatConfig
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const defaultCliFromSkills = useMemo(() => {
        return employee?.chatConfig?.cli || "qwen";
    }, [selectedSkillIds]);

    const [selectedCli, setSelectedCli] = useState<string>(savedCli);

    // Sync selectedCli from saved config or skill default — only on mount
    useEffect(() => {
        if (savedCli) {
            setSelectedCli(savedCli);
        } else if (defaultCliFromSkills) {
            setSelectedCli(defaultCliFromSkills);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // effectiveCli always follows user selection
    const effectiveCli = selectedCli;

    const effectiveModel = selectedModel;

    // Initialize permissionMode from skill config (only on first skill selection)
    const initializedRef = useRef(false);
    useEffect(() => {
        if (!employee || initializedRef.current) return;
        for (const id of selectedSkillIds) {
            const sk = skillDefinitions.get(id);
            // approval mode comes from employee chatConfig now
            const approvalFromEmployee = employee?.chatConfig?.approvalMode;
            if (approvalFromEmployee) {
                setPermissionMode(approvalFromEmployee);
                initializedRef.current = true;
                return;
            }
        }
    }, [employee, selectedSkillIds]);

    // Runtime approval mode — user override always wins
    const effectiveApprovalMode = permissionMode;

    // Save runtime setting changes back to crew JSON (all selected skills)
    const saveSkillConfig = useCallback(async (field: 'cli' | 'model' | 'approvalMode', value: string) => {
        if (!employee) return;
        const updated = { ...employee, chatConfig: { ...employee.chatConfig, [field]: value } };
        try {
            await fetch(`${API_BASE}/api/crew/${employee.id}?factory=${factoryId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updated),
            });
        } catch (err) {
            console.error("[PAAW] Failed to save skill config:", err);
        }
    }, [employee, selectedSkillIds]);

    // Check if pending config differs from running config
    const configDirty = chatStarted && (
        effectiveCli !== runningCli ||
        (effectiveModel || "") !== runningModel ||
        permissionMode !== runningApproval
    );

    // Apply pending config: save to crew JSON, hot-restart console with same prompt
    const applyConfig = useCallback(async () => {
        // Save cli and model to crew JSON chatConfig for persistence
        if (!employee) return;
        const updated = { ...employee, chatConfig: { ...employee.chatConfig, cli: effectiveCli, model: effectiveModel || "", approvalMode: permissionMode } };
        try {
            await fetch(`${API_BASE}/api/crew/${employee.id}?factory=${factoryId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updated),
            });
        } catch (err) {
            console.error("[PAAW] Failed to save config:", err);
        }
        // Update running state
        setRunningCli(effectiveCli);
        setRunningModel(effectiveModel || "");
        setRunningApproval(permissionMode);
        // Hot-restart console
        setRestartCount(prev => prev + 1);
    }, [effectiveCli, effectiveModel, permissionMode, runningCli, runningModel, runningApproval, employee, selectedSkillIds]);

    const handleStartClick = () => {
        if (!employee) return;
        if (requiredInputs.length > 0) {
            // Show input dialog
            setInputDialogData({});
            setInputDialogErrors({});
            setShowInputDialog(true);
        } else {
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
        const prompt = buildSystemPrompt(employee, skillDefinitions, selectedSkillIds, allData, { paawRoot, projectRoot: projectRoot || "", factoryId }, workspaces, skillRules);
        setSystemPrompt(prompt);
        setFormData(allData);
        setConsoleKey(prev => prev + 1);
        setChatStarted(true);
        setShowInputDialog(false);
        // Snapshot running config
        setRunningCli(effectiveCli);
        setRunningModel(effectiveModel || "");
        setRunningApproval(permissionMode);

        // Save input via API
        if (Object.keys(dialogData).length > 0 || taskInput.trim()) {
            try {
                const allDataForHash = { ...dialogData, task: taskInput.trim() };
                const hash = await computeHash(allDataForHash);
                const existingHashes = savedInputs.map(i => i.hash);
                if (!existingHashes.includes(hash)) {
                    const params = new URLSearchParams({ root: projectRoot || "" });
                    await fetch(`${API_BASE}/api/saved-inputs/${employee.id}?${params}`, {
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
            await fetch(`${API_BASE}/api/work-log/${employee.id}?${params}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    skillIds: selectedSkillIds,
                    inputSummary: inputSummary.slice(0, 100),
                    cli: effectiveCli,
                    inputData: allData,
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

    // Enter does NOT trigger start — user must click the button

    if (!employee) return <div className="p-8 text-stone-400">Employee not found</div>;

    const allSkillDefs = (employee?.skillIds || []).map(id => skillDefinitions.get(id)).filter(Boolean) as SkillDefinition[];

    return (
        <div className="flex flex-col lg:flex-row h-full w-full overflow-hidden">
            {/* ===== Input Dialog Modal ===== */}
            {showInputDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowInputDialog(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                        {/* Dialog header */}
                        <div className="px-6 py-4 border-b" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                            <h3 className="text-lg font-bold" style={{ color: t.accentText }}>任務參數</h3>
                            <p className="text-xs mt-0.5" style={{ color: t.accent }}>
                                {selectedSkillIds.length} 個技能需要以下資料才能啟動
                            </p>
                        </div>

                        {/* Dialog body */}
                        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                            {/* Saved Inputs Quick Select — filtered by current skills */}
                            {(() => {
                                const relevantInputs = savedInputs.filter(si => {
                                    if (!si.skillId) return true;
                                    const siSkills = si.skillId.split(',');
                                    return siSkills.some(s => selectedSkillIds.includes(s));
                                });
                                return relevantInputs.length > 0 ? (
                                    <div>
                                        <label className="flex items-center gap-1.5 text-sm font-medium text-stone-700 mb-1">
                                            <Icon name="clipboard" size={14} /> 已存參數
                                        </label>
                                        <p className="text-[11px] text-stone-400 mb-1.5">選擇此技能過去的輸入快速填入</p>
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
                                            <option value="">-- 選擇已存參數 --</option>
                                            {relevantInputs.map((si, idx) => {
                                                const label = (() => {
                                                    const vals = Object.entries(si.data).filter(([k]) => k !== 'task').slice(0, 2).map(([, v]) => String(v).slice(0, 30));
                                                    return vals.length > 0 ? vals.join(' / ') : si.skillId;
                                                })();
                                                return (
                                                    <option key={idx} value={JSON.stringify(si)}>
                                                        {label} ({new Date(si.savedAt).toLocaleDateString('zh-TW')})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                ) : null;
                            })()}
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
                                            rows={inp.rows || 4}
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
                                <Icon name="rocket" size={14} /> 啟動任務
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
                                src={employee.imageUrl?.startsWith("/") ? `${API_BASE}/api/factory/${factoryId}/crews-pic/${employee.imageUrl.split("/").pop()}` : employee.imageUrl}
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
                                    <span className="text-[10px] text-stone-400 ml-auto">{selectedSkillIds.length}/{allSkillDefs.length} 已選</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {allSkillDefs.map(sk => (
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
                                {selectedSkillIds.length > 0 && (
                                    <button
                                        onClick={() => setShowSkillPrompts(true)}
                                        className="flex-1 px-3 py-2 rounded-xl text-sm font-medium bg-white border transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                        style={{ borderColor: t.accentBorder, color: t.accentText }}
                                    >
                                        <Icon name="scroll" size={14} /> Prompts
                                    </button>
                                )}
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
                        {allSkillDefs.map(sk => (
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
                        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: t.accentBg }}>
                                <Icon name="lightning" size={28} style={{ color: t.accent + (selectedSkillIds.length > 0 ? "80" : "40") }} />
                            </div>
                            <div className="text-center">
                                {selectedSkillIds.length === 0 ? (
                                    <>
                                        <p className="text-sm font-semibold" style={{ color: t.accentText }}>純 Prompt 模式</p>
                                        <p className="text-xs mt-1" style={{ color: t.accent + "80" }}>輸入任務描述，或從上方選擇技能</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm font-semibold" style={{ color: t.accentText }}>準備好了！輸入任務按下 Enter 啟動</p>
                                        <p className="text-xs mt-1" style={{ color: t.accent + "80" }}>選擇的技能：{selectedSkillIds.map(sid => skillDefinitions.get(sid)?.name).filter(Boolean).join(', ')}</p>
                                    </>
                                )}
                            </div>
                            {/* Task Input — pre-launch */}
                            <div className="w-full max-w-3xl mt-3">
                                <div className="rounded-2xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md" style={{ borderColor: t.accentBorder + "80", backgroundColor: "white" }}>
                                    <textarea
                                        value={taskInput}
                                        onChange={e => {
                                            setTaskInput(e.target.value);
                                            e.target.style.height = "auto";
                                            e.target.style.height = Math.min(e.target.scrollHeight, 400) + "px";
                                        }}
                                        onKeyDown={e => {
                                            if (e.nativeEvent?.isComposing || (e as any).isComposing) return;
                                            if (e.key === "Enter" && !e.shiftKey) {
                                                e.preventDefault();
                                                handleStartClick();
                                            }
                                        }}
                                        placeholder={"描述你想讓 AI 做什麼...\n\n可以貼上需求文件、error log、程式碼片段等任何內容\nShift+Enter 換行，Enter 送出"}
                                        className="w-full bg-transparent outline-none text-sm text-stone-700 resize-none min-h-[260px] max-h-[400px] px-4 py-3 leading-relaxed placeholder-stone-400 font-mono"
                                        rows={10}
                                    />
                                    <div className="flex items-center justify-between px-4 py-2 border-t" style={{ borderColor: t.accentBorder + "40", backgroundColor: t.accentBg }}>
                                        <div className="flex items-center gap-3">
                                            <span className="text-[11px] text-stone-400">Shift+Enter 換行 · Enter 送出</span>
                                            {taskInput.length > 0 && <span className="text-[11px] text-stone-400">{taskInput.length} 字</span>}
                                        </div>
                                        <button
                                            onClick={handleStartClick}
                                            className="px-5 py-1.5 rounded-xl text-sm font-bold text-white shrink-0 transition-all hover:shadow-md active:scale-95"
                                            style={{ backgroundColor: t.accent }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accentHover; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = t.accent; }}
                                        >
                                            <Icon name="rocket" size={14} /> 開始
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                                ) : (
                    <Card
                        className={cn(
                            "flex flex-col border shadow-sm overflow-hidden",
                            fullscreen
                                ? "fixed inset-0 z-50 rounded-none border-none shadow-none bg-gray-900"
                                : "flex-1 min-h-[280px] sm:min-h-[400px]"
                        )}
                        style={fullscreen ? {} : { borderColor: t.accentBorder + "60" }}
                    >
                    {/* Console header */}
                    <div className="flex items-center justify-between px-2 sm:px-4 py-2 border-b gap-2" style={{ borderColor: fullscreen ? "#374151" : t.accentBorder + "40", backgroundColor: fullscreen ? "#111827" : t.accentBg }}>
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: t.accent }}>
                                <span className="text-white text-[10px] font-black">O</span>
                            </div>
                            <span className={cn("font-bold text-sm truncate", fullscreen && "text-gray-200")} style={!fullscreen ? { color: t.accentText } : undefined}>
                                {effectiveCli === 'claude' ? 'Claude Code' : effectiveCli === 'opencode' ? 'OpenCode' : 'Qwen'} CLI
                                {fullscreen && ' — 全螢幕'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                            {/* Approval Mode */}
                            <select
                                value={permissionMode}
                                onChange={e => {
                                    setPermissionMode(e.target.value);
                                }}
                                className={cn(
                                    "px-1.5 py-1 rounded-lg border text-[11px] cursor-pointer",
                                    fullscreen ? "bg-gray-800 border-gray-600 text-gray-200" : "bg-white",
                                    chatStarted && permissionMode !== runningApproval && !fullscreen && "border-amber-400"
                                )}
                                style={!fullscreen ? { borderColor: t.accentBorder, color: t.accentText } : undefined}
                                title="Approval Mode"
                            >
                                <option value="default">Default</option>
                                <option value="auto-edit">Auto-Edit</option>
                                <option value="yolo">YOLO</option>
                                <option value="plan">Plan</option>
                            </select>
                            {/* CLI Engine */}
                            <select
                                value={selectedCli}
                                onChange={e => {
                                    const newCli = e.target.value;
                                    setSelectedCli(newCli);
                                    fetchModels(newCli);
                                }}
                                className={cn(
                                    "px-1.5 py-1 rounded-lg border text-[11px] cursor-pointer",
                                    fullscreen ? "bg-gray-800 border-gray-600 text-gray-200" : "bg-white",
                                    chatStarted && effectiveCli !== runningCli && !fullscreen && "border-amber-400"
                                )}
                                style={!fullscreen ? { borderColor: t.accentBorder, color: t.accentText } : undefined}
                                title="CLI Engine"
                            >
                                {Object.entries(installedClis).map(([key, info]: [string, any]) => (
                                    <option key={key} value={key}>
                                        {info.name} {!info.installed ? '(未安裝)' : ''}
                                    </option>
                                ))}
                            </select>
                            {/* Model */}
                            {models.length > 0 && (
                                <select
                                    value={effectiveModel}
                                    onChange={e => {
                                        setSelectedModel(e.target.value);
                                    }}
                                    className={cn(
                                        "px-1.5 py-1 rounded-lg border text-[11px] cursor-pointer max-w-[140px]",
                                        fullscreen ? "bg-gray-800 border-gray-600 text-gray-200" : "bg-white",
                                        chatStarted && (effectiveModel || "") !== runningModel && !fullscreen && "border-amber-400"
                                    )}
                                    style={!fullscreen ? { borderColor: t.accentBorder, color: t.accentText } : undefined}
                                    title="Model"
                                >
                                    {models.map(m => (
                                        <option key={m.id} value={m.id}>
                                            {m.name.length > 20 ? m.name.slice(0, 20) + '...' : m.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                            {/* Apply & Restart — only visible when config changed */}
                            {configDirty && (
                                <button
                                    onClick={applyConfig}
                                    className={cn(
                                        "px-2 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 animate-pulse",
                                        fullscreen
                                            ? "bg-amber-600 text-white hover:bg-amber-500"
                                            : "text-white hover:opacity-90"
                                    )}
                                    style={!fullscreen ? { backgroundColor: t.accent } : undefined}
                                    title="套用變更並重啟 CLI"
                                >
                                    <Icon name="restart" size={12} /> 套用
                                </button>
                            )}
                            {/* Fullscreen toggle */}
                            <button
                                onClick={() => setFullscreen(!fullscreen)}
                                className={cn(
                                    "px-1.5 py-1 rounded-lg border text-[11px] transition-colors flex items-center",
                                    fullscreen ? "border-gray-600 text-gray-300 hover:text-white hover:border-gray-400" : ""
                                )}
                                style={!fullscreen ? { borderColor: t.accentBorder, color: t.accent } : undefined}
                                title={fullscreen ? "退出全螢幕 (Esc)" : "全螢幕"}
                            >
                                <Icon name={fullscreen ? "contract" : "expand"} size={14} />
                                {fullscreen && <span className="ml-1">ESC</span>}
                            </button>
                        </div>
                    </div>

                    {/* Terminal — single instance, shared between normal and fullscreen */}
                    <div className="flex-1 min-h-0">
                        <TerminalConsole
                            key={`terminal-${consoleKey}`}
                            cwd={projectRoot}
                            cli={effectiveCli}
                            model={effectiveModel || undefined}
                            approvalMode={effectiveApprovalMode}
                            systemPrompt={undefined}
                            initialPrompt={chatStarted ? [
                                systemPrompt ? `# System Instructions\n${systemPrompt}` : '',
                            ].filter(Boolean).join('\n\n') : undefined}
                            restartTrigger={restartCount}
                        />
                    </div>
                </Card>
                )}
            </div>


            {/* ===== Skill Prompts Dialog ===== */}
            {showSkillPrompts && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowSkillPrompts(false)}>
                    <div className="absolute inset-0 bg-black/30" />
                    <div className="relative bg-white rounded-2xl shadow-2xl border w-[600px] max-h-[80vh] flex flex-col" style={{ borderColor: t.accentBorder }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: t.accentBorder + "40" }}>
                            <h3 className="font-bold text-base" style={{ color: t.accentText }}>Skill Prompts</h3>
                            <button onClick={() => setShowSkillPrompts(false)} className="text-stone-400 hover:text-stone-600 text-lg leading-none cursor-pointer">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: "thin" }}>
                            {/* Role Prompt */}
                            <div>
                                <div className="flex items-center gap-1.5 mb-2">
                                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: t.accent + "20", color: t.accent }}>Role</span>
                                    <span className="text-sm font-semibold" style={{ color: t.accentText }}>{employee?.title}</span>
                                </div>
                                <pre className="text-xs whitespace-pre-wrap rounded-lg border p-3 leading-relaxed" style={{ borderColor: t.accentBorder + "60", background: t.accentLight + "30", color: t.accentText + "85" }}>{employee?.rolePrompt}</pre>
                            </div>
                            {/* Each selected skill */}
                            {selectedSkillIds.map(sid => {
                                const sd = skillDefinitions.get(sid);
                                if (!sd) return (
                                    <div key={sid}>
                                        <span className="text-xs" style={{ color: t.accentText + "50" }}>{sid} — not found</span>
                                    </div>
                                );
                                return (
                                    <div key={sid}>
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: t.accent + "20", color: t.accent }}>Skill</span>
                                            <span className="text-sm font-semibold" style={{ color: t.accentText }}>{sd.name}</span>
                                            <span className="text-xs" style={{ color: t.accentText + "40" }}>{sd.id}</span>
                                        </div>
                                        <div className="text-xs rounded-lg border p-3 leading-relaxed" style={{ borderColor: t.accentBorder + "60", background: t.accentLight + "30", color: t.accentText + "85" }}>
                                            <div>Please use {sd.id} skill</div>                                           
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ===== Work Log Popup ===== */}
            {showWorkLog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowWorkLog(false)}>
                    <div className="absolute inset-0 bg-black/30" />
                    <div className="relative bg-white rounded-2xl shadow-2xl border w-[520px] max-h-[70vh] flex flex-col" style={{ borderColor: t.accentBorder }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: t.accentBorder + "40" }}>
                            <h3 className="font-bold text-base" style={{ color: t.accentText }}>最近工作</h3>
                            <button onClick={() => setShowWorkLog(false)} className="text-stone-400 hover:text-stone-600 text-lg leading-none cursor-pointer">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: "thin" }}>
                            {workLog.length === 0 ? (
                                <p className="text-sm text-center py-8" style={{ color: t.accentText + "50" }}>尚無工作紀錄</p>
                            ) : (
                                <div className="space-y-2.5">
                                    {workLog.map(w => {
                                        const skillNames = (w.skillIds || []).map(s => skillDefinitions.get(s)?.name || s);
                                        const hasInputs = w.inputData && Object.keys(w.inputData).length > 0;
                                        return (
                                            <button
                                                key={w.id}
                                                className="w-full text-left p-3 rounded-lg border transition-colors hover:shadow-sm cursor-pointer"
                                                style={{ borderColor: t.accentBorder + "60", background: t.accentLight + "40" }}
                                                onClick={() => {
                                                    // Load this work log's inputs into the form
                                                    if (hasInputs) {
                                                        setTaskInput(w.inputData!.task || "");
                                                        setShowWorkLog(false);
                                                    }
                                                }}
                                            >
                                                <div className="flex items-center justify-between mb-1.5">
                                                    {skillNames.length > 0 ? (
                                                        <div className="flex gap-1 flex-wrap">
                                                            {skillNames.map(name => (
                                                                <span key={name} className="text-xs inline-block px-2 py-0.5 rounded-full" style={{ background: t.accent + "20", color: t.accent }}>{name}</span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs" style={{ color: t.accentText + "50" }}>general</span>
                                                    )}
                                                    <span className="text-xs shrink-0" style={{ color: t.accent + "70" }}>
                                                        {new Date(w.timestamp).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                {/* Show inputSummary */}
                                                {w.inputSummary && (
                                                    <p className="text-sm truncate mb-1" style={{ color: t.accentText + "80" }}>{w.inputSummary}</p>
                                                )}
                                                {/* Show actual input data (prompts) */}
                                                {hasInputs && (
                                                    <div className="space-y-1 mt-1.5">
                                                        {Object.entries(w.inputData!)
                                                            .filter(([k, v]) => v && k !== "task")
                                                            .slice(0, 3)
                                                            .map(([k, v]) => (
                                                                <div key={k} className="text-xs rounded px-2 py-1" style={{ background: "white", color: t.accentText + "70" }}>
                                                                    <span className="font-semibold" style={{ color: t.accentText + "90" }}>{k}:</span>{" "}
                                                                    <span className="line-clamp-1">{String(v).slice(0, 120)}</span>
                                                                </div>
                                                            ))
                                                        }
                                                        {w.inputData!.task && (
                                                            <div className="text-xs rounded px-2 py-1" style={{ background: "white", color: t.accentText + "70" }}>
                                                                <span className="font-semibold" style={{ color: t.accentText + "90" }}>prompt:</span>{" "}
                                                                <span className="line-clamp-2">{w.inputData!.task.slice(0, 200)}</span>
                                                            </div>
                                                        )}
                                                        {Object.keys(w.inputData!).filter(k => w.inputData![k] && k !== "task").length > 3 && (
                                                            <span className="text-[10px]" style={{ color: t.accentText + "40" }}>+{Object.keys(w.inputData!).filter(k => w.inputData![k] && k !== "task").length - 3} more...</span>
                                                        )}
                                                    </div>
                                                )}
                                                {w.cli && <span className="text-xs mt-1 inline-block" style={{ color: t.accentText + "40" }}>via {w.cli}</span>}
                                                {hasInputs && (
                                                    <div className="text-[10px] mt-1.5 font-medium" style={{ color: t.accent + "90" }}>點擊載入此工作</div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
