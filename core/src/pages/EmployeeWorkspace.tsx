import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Card, cn } from "../components/ui/shared";
import { SKILLS } from "../data/mockData";
import { Skill, CrewSkill, RequiredInput, buildSystemPrompt } from "../types";
import AgentConsole from "./AgentConsole";
import TerminalConsole from "../components/TerminalConsole";
import Icon, { IconLabel } from "../components/Icon";

interface ModelOption {
    id: string;
    name: string;
    contextWindowSize?: number;
    vision?: boolean;
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

interface EmployeeWorkspaceProps {
    employeeId: string;
}

function buildInitialMessage(inputs: RequiredInput[], data: Record<string, string>, skillIds: string[]): string {
    const lines: string[] = [];
    const groups = new Map<string, { label: string; value: string }[]>();
    for (const input of inputs) {
        const val = data[input.id]?.trim();
        if (!val) continue;
        const group = input.group || "Other";
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)!.push({ label: input.label, value: val });
    }
    for (const [group, items] of groups) {
        lines.push(`## ${group}`);
        for (const item of items) {
            lines.push(`**${item.label}:** ${item.value}`);
        }
        lines.push("");
    }
    lines.push("---");
    lines.push("Please start working based on the above information.");
    return lines.join("\n");
}

function BriefingForm({ inputs, onSubmit, onCancel }: {
    inputs: RequiredInput[];
    onSubmit: (data: Record<string, string>) => void;
    onCancel: () => void;
}) {
    const [formData, setFormData] = useState<Record<string, string>>({});

    useEffect(() => {
        const initial: Record<string, string> = {};
        inputs.forEach(i => { initial[i.id] = ""; });
        setFormData(initial);
    }, [inputs]);

    const groups = useMemo(() => {
        const map = new Map<string, RequiredInput[]>();
        for (const input of inputs) {
            const group = input.group || "其他";
            if (!map.has(group)) map.set(group, []);
            map.get(group)!.push(input);
        }
        return map;
    }, [inputs]);

    const missingRequired = inputs.filter(i => i.required && !formData[i.id]?.trim());

    const handleChange = (id: string, value: string) => {
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    return (
        <div className="flex flex-col h-full">
            {/* Scrollable form area */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="flex flex-col gap-6 max-w-4xl mx-auto">
                    <div className="text-center space-y-1">
                        <h3 className="text-lg font-bold text-stone-800 flex items-center gap-1.5"><Icon name="clipboard" size={20} /> 工作需求表</h3>
                        <p className="text-xs text-stone-400">請填寫以下資料，讓員工知道要做什麼。必填欄位標記 *</p>
                    </div>

                    {Array.from(groups.entries()).map(([groupName, groupInputs]) => (
                        <Card key={groupName} title={groupName} className="p-4">
                            <div className="space-y-4">
                                {groupInputs.map(input => (
                                    <div key={input.id}>
                                        <label className="block text-sm font-semibold text-stone-600 mb-1">
                                            {input.label}
                                            {input.required && <span className="text-rose-500 ml-1">*</span>}
                                        </label>
                                        <p className="text-xs text-stone-400 mb-1.5">{input.description}</p>
                                        {input.multiline ? (
                                            <textarea
                                                value={formData[input.id] || ""}
                                                onChange={e => handleChange(input.id, e.target.value)}
                                                placeholder={input.placeholder}
                                                rows={6}
                                                className={cn(
                                                    "w-full rounded-xl border bg-amber-50/50 px-3 py-2 text-sm font-mono transition-colors",
                                                    "placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400",
                                                    input.required && !formData[input.id]?.trim()
                                                        ? "border-red-200 bg-red-50/30"
                                                        : "border-orange-200"
                                                )}
                                            />
                                        ) : (
                                            <input
                                                type="text"
                                                value={formData[input.id] || ""}
                                                onChange={e => handleChange(input.id, e.target.value)}
                                                placeholder={input.placeholder}
                                                className={cn(
                                                    "w-full rounded-xl border bg-amber-50/50 px-3 py-2 text-sm font-mono transition-colors",
                                                    "placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400",
                                                    input.required && !formData[input.id]?.trim()
                                                        ? "border-red-200 bg-red-50/30"
                                                        : "border-orange-200"
                                                )}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </Card>
                    ))}
                </div>
            </div>

            {/* Fixed bottom action bar */}
            <div className="flex items-center justify-between px-6 py-3 bg-white/80 backdrop-blur-sm border-t border-orange-100 shrink-0">
                <button
                    onClick={onCancel}
                    className="px-4 py-2 rounded-xl border border-orange-200 text-sm text-stone-400 hover:bg-amber-50 transition-colors"
                >
                    ← 返回
                </button>
                <div className="flex items-center gap-3">
                    {missingRequired.length > 0 ? (
                        <span className="text-xs text-red-400">
                            還有 {missingRequired.length} 個必填欄位未填
                        </span>
                    ) : (
                        <span className="text-xs text-emerald-500 flex items-center gap-1"><Icon name="success" size={12} /> 資料齊全，可以開始！</span>
                    )}
                    <button
                        onClick={() => onSubmit(formData)}
                        disabled={missingRequired.length > 0}
                        className={cn(
                            "px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                            missingRequired.length === 0
                                ? "bg-orange-500 text-white hover:bg-orange-600 shadow-sm active:scale-95"
                                : "bg-amber-50 text-stone-400 cursor-not-allowed"
                        )}
                    >
                        <Icon name="rocket" size={14} /> 開始 ({inputs.filter(i => formData[i.id]?.trim()).length}/{inputs.length} 已填)
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function EmployeeWorkspace({ employeeId }: EmployeeWorkspaceProps) {
    const employee = SKILLS.find((s) => s.id === employeeId);
    const [enabledSkills, setEnabledSkills] = useState<Record<string, boolean>>({});
    const [consoleKey, setConsoleKey] = useState(0);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [chatStarted, setChatStarted] = useState(false);
    const [showPromptModal, setShowPromptModal] = useState(false);
    const [showBriefing, setShowBriefing] = useState(false);
    const [formData, setFormData] = useState<Record<string, string>>({});
    const [models, setModels] = useState<ModelOption[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>("");
    const [permissionMode, setPermissionMode] = useState<string>("yolo");
    const [selectedCli, setSelectedCli] = useState<string>("qwen");
    const [installedClis, setInstalledClis] = useState<Record<string, { installed: boolean; name: string }>>({});
    const [conversations, setConversations] = useState<ConvSummary[]>([]);
    const [showConvHistory, setShowConvHistory] = useState(false);

    // Load models from server
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

    // Load installed CLIs
    useEffect(() => {
        fetch("http://127.0.0.1:4097/api/clis")
            .then(r => r.json())
            .then(data => setInstalledClis(data))
            .catch(() => {});
    }, []);

    // Load conversation history
    const loadConversations = useCallback(() => {
        if (!employee) return;
        fetch(`http://127.0.0.1:4097/api/conversations/${employee.id}`)
            .then(r => r.json())
            .then((list: ConvSummary[]) => setConversations(list))
            .catch(() => setConversations([]));
    }, [employee]);

    useEffect(() => {
        loadConversations();
    }, [loadConversations]);

    useEffect(() => {
        if (employee) {
            const initial: Record<string, boolean> = {};
            // No skill selected by default
            setEnabledSkills(initial);
            setConsoleKey(0);
            setChatStarted(false);
            setShowPromptModal(false);
            setShowBriefing(false);
            setShowConvHistory(false);
            setFormData({});
            setSystemPrompt(buildSystemPrompt(employee, []));
        }
    }, [employee]);

    const selectedSkillIds = useMemo(() => {
        return Object.entries(enabledSkills)
            .filter(([_, v]) => v)
            .map(([k]) => k);
    }, [enabledSkills]);

    // Derive CLI, model, approvalMode from first selected skill (or fallback to employee defaults)
    const effectiveCli = useMemo(() => {
        if (!employee) return "qwen";
        for (const id of selectedSkillIds) {
            const sk = employee.skills.find(s => s.id === id);
            if (sk?.cli) return sk.cli;
        }
        return "qwen";
    }, [employee, selectedSkillIds]);

    const effectiveModel = useMemo(() => {
        if (!employee) return selectedModel;
        for (const id of selectedSkillIds) {
            const sk = employee.skills.find(s => s.id === id);
            if (sk?.model) return sk.model;
        }
        return selectedModel;
    }, [employee, selectedSkillIds, selectedModel]);

    const effectiveApprovalMode = useMemo(() => {
        if (!employee) return permissionMode;
        for (const id of selectedSkillIds) {
            const sk = employee.skills.find(s => s.id === id);
            if (sk?.approvalMode) return sk.approvalMode;
        }
        return permissionMode;
    }, [employee, selectedSkillIds, permissionMode]);

    // Collect all requiredInputs from enabled skills
    const allRequiredInputs = useMemo(() => {
        if (!employee) return [];
        const inputs: RequiredInput[] = [];
        for (const skill of employee.skills) {
            if (selectedSkillIds.includes(skill.id) && skill.requiredInputs) {
                inputs.push(...skill.requiredInputs);
            }
        }
        return inputs;
    }, [employee, selectedSkillIds]);

    const handleSkillToggle = useCallback((skillId: string) => {
        setEnabledSkills(prev => {
            // Radio behavior: only one skill at a time
            const next: Record<string, boolean> = {};
            // If clicking the already-selected skill, deselect it
            if (!(prev[skillId])) {
                next[skillId] = true;
            }
            if (employee) {
                const ids = Object.entries(next).filter(([_, v]) => v).map(([k]) => k);
                setSystemPrompt(buildSystemPrompt(employee, ids));
            }
            return next;
        });
    }, [employee]);

    const handleStartChat = () => {
        // If there are required inputs, show briefing form first
        if (allRequiredInputs.length > 0 && !chatStarted) {
            setShowBriefing(true);
            return;
        }
        // Otherwise start directly
        if (employee) {
            setSystemPrompt(buildSystemPrompt(employee, selectedSkillIds));
            setConsoleKey(prev => prev + 1);
            setChatStarted(true);
        }
    };

    const handleBriefingSubmit = (data: Record<string, string>) => {
        setFormData(data);
        if (employee) {
            // Build label→value map for prompt
            const labelMap: Record<string, string> = {};
            for (const input of allRequiredInputs) {
                if (data[input.id]?.trim()) {
                    labelMap[input.label] = data[input.id];
                }
            }
            const prompt = buildSystemPrompt(employee, selectedSkillIds, labelMap);
            setSystemPrompt(prompt);
        }
        setConsoleKey(prev => prev + 1);
        setChatStarted(true);
        setShowBriefing(false);
    };

    // Handle loading a past conversation
    const handleLoadConv = async (convId: string) => {
        if (!employee) return;
        try {
            const res = await fetch(`http://127.0.0.1:4097/api/conversations/${employee.id}/${convId}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.systemPrompt) setSystemPrompt(data.systemPrompt);
            if (data.model) setSelectedModel(data.model);
            setChatStarted(true);
            setConsoleKey(prev => prev + 1);
            setShowConvHistory(false);
            setLoadedConvMessages(data.messages || []);
            setLoadedConvId(convId);
        } catch { /* silently fail */ }
    };

    const [loadedConvMessages, setLoadedConvMessages] = useState<Array<{role: string; text: string}> | null>(null);
    const [loadedConvId, setLoadedConvId] = useState<string | undefined>(undefined);

    // Handle deleting a conversation
    const handleDeleteConv = async (convId: string) => {
        if (!employee) return;
        try {
            await fetch(`http://127.0.0.1:4097/api/conversations/${employee.id}/${convId}`, { method: "DELETE" });
            loadConversations();
        } catch { /* silently fail */ }
    };

    if (!employee) {
        return <div className="p-4 text-rose-500">Employee not found.</div>;
    }

    // Show briefing form - full tab page
    if (showBriefing) {
        return (
            <BriefingForm
                inputs={allRequiredInputs}
                onSubmit={handleBriefingSubmit}
                onCancel={() => setShowBriefing(false)}
            />
        );
    }

    return (
        <div className="flex flex-col h-full gap-2 relative">
            {/* Conversation history sidebar overlay */}
            {showConvHistory && (
                <div className="fixed inset-0 z-40 flex" onClick={() => setShowConvHistory(false)}>
                    <div className="w-80 bg-white border-r border-orange-200 shadow-xl h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="sticky top-0 bg-white border-b border-orange-100 px-4 py-3 flex items-center justify-between z-10">
                            <h3 className="text-sm font-bold text-stone-700 flex items-center gap-1"><Icon name="chat" size={16} /> 對話紀錄</h3>
                            <button onClick={() => setShowConvHistory(false)} className="text-stone-400 hover:text-stone-600 text-lg"><Icon name="cross" size={18} /></button>
                        </div>
                        <div className="p-2">
                            {conversations.length === 0 ? (
                                <div className="text-center py-8 text-stone-400 text-xs">尚無對話紀錄</div>
                            ) : (
                                conversations.map(conv => (
                                    <div key={conv.id} className="group relative">
                                        <button
                                            onClick={() => handleLoadConv(conv.id)}
                                            className="w-full text-left p-3 rounded-xl hover:bg-orange-50 transition-colors border border-transparent hover:border-orange-200 mb-1"
                                        >
                                            <div className="text-xs font-medium text-stone-700 truncate">{conv.title}</div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[10px] text-stone-400">{new Date(conv.updatedAt).toLocaleString('zh-TW')}</span>
                                                <span className="text-[10px] text-stone-300">·</span>
                                                <span className="text-[10px] text-stone-400">{conv.messageCount} 則訊息</span>
                                            </div>
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteConv(conv.id); }}
                                            className="absolute top-2 right-2 w-5 h-5 rounded-full bg-stone-100 hover:bg-red-100 text-stone-300 hover:text-red-400 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="刪除"
                                        ><Icon name="cross" size={12} /></button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Top panel: Employee header and skills */}
            <Card className="flex-none overflow-y-auto p-4">
                <div className="flex gap-6 items-start">
                    {/* Left: Employee Photo */}
                    <div className="w-48 h-48 shrink-0 rounded-2xl overflow-hidden bg-orange-50/50 border border-orange-100 flex items-center justify-center p-3 shadow-sm">
                        <img
                            src={employee.imageUrl}
                            alt={employee.title}
                            className="w-full h-full object-contain drop-shadow-sm"
                        />
                    </div>
                    {/* Right: Details & Skills */}
                    <div className="flex flex-col gap-3 flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                            <div>
                                <h2 className="text-lg font-bold text-stone-800">
                                    {employee.codename}
                                    <span className="text-stone-400 font-normal text-sm ml-2">({employee.title})</span>
                                </h2>
                                <p className="text-xs text-stone-400 mt-0.5">{employee.description}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-4">
                                {/* Conversation history toggle */}
                                {conversations.length > 0 && (
                                    <button
                                        onClick={() => { loadConversations(); setShowConvHistory(true); }}
                                        className="px-3 py-2 rounded-xl border border-orange-200 text-xs font-medium text-stone-500 hover:bg-amber-50/50 hover:border-orange-300 transition-all"
                                        title="對話紀錄"
                                    >
                                        <Icon name="chat" size={14} /> 紀錄 ({conversations.length})
                                    </button>
                                )}
                                {/* Model selector */}
                                {/* CLI selector */}
                                <select
                                    value={selectedCli}
                                    onChange={e => setSelectedCli(e.target.value)}
                                    className="px-2 py-1.5 rounded-xl border border-orange-200 text-xs text-stone-500 bg-white hover:border-orange-300 transition-all"
                                    title="選擇 CLI Engine"
                                >
                                    {Object.entries(installedClis).map(([key, info]: [string, any]) => (
                                        <option key={key} value={key} disabled={!info.installed}>
                                            {info.name} {info.installed ? '' : '(未安裝)'}
                                        </option>
                                    ))}
                                </select>
                                {models.length > 0 && (
                                    <select
                                        value={selectedModel}
                                        onChange={e => setSelectedModel(e.target.value)}
                                        className="px-2 py-1.5 rounded-xl border border-orange-200 text-xs text-stone-500 bg-white hover:border-orange-300 transition-all max-w-[200px] truncate"
                                        title="選擇 AI Model"
                                    >
                                        {models.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {m.name.length > 35 ? m.name.slice(0, 35) + '...' : m.name} {m.current ? '\u2605' : ''}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                {/* Permission mode selector */}
                                <select
                                    value={permissionMode}
                                    onChange={e => setPermissionMode(e.target.value)}
                                    className="px-2 py-1.5 rounded-xl border border-orange-200 text-xs text-stone-500 bg-white hover:border-orange-300 transition-all"
                                    title="Permission Mode"
                                >
                                    <option value="default">Default</option>
                                    <option value="auto-edit">Auto-Edit</option>
                                    <option value="yolo">YOLO</option>
                                    <option value="plan">Plan</option>
                                </select>
                                <button
                                    onClick={() => setShowPromptModal(true)}
                                    className="px-3 py-2 rounded-xl border border-orange-200 text-xs font-medium text-stone-500 hover:bg-amber-50/50 hover:border-orange-300 transition-all"
                                >
                                    <Icon name="document" size={14} /> 提示詞
                                </button>
                                <button
                                    onClick={handleStartChat}
                                    disabled={selectedSkillIds.length === 0}
                                    className={cn(
                                        "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                                        selectedSkillIds.length > 0
                                            ? "bg-orange-500 text-white hover:bg-orange-600 shadow-sm active:scale-95"
                                            : "bg-amber-50 text-stone-400 cursor-not-allowed"
                                    )}
                                >
                                    {allRequiredInputs.length > 0 && !chatStarted
                                        ? <><Icon name="clipboard" size={14} /> 填寫需求</>
                                        : <><Icon name="chat" size={14} /> Start</>
                                    }
                                </button>
                            </div>
                        </div>

                        {/* Skill selection */}
                        <div>
                            <div className="font-semibold text-xs mb-2 text-stone-500 uppercase tracking-wider">
                                選擇要載入的技能
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {employee.skills.map((skill: CrewSkill) => {
                                    const isSelected = enabledSkills[skill.id] === true;
                                    const hasInputs = skill.requiredInputs && skill.requiredInputs.length > 0;
                                    return (
                                        <label
                                            key={skill.id}
                                            className={cn(
                                                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-all",
                                                isSelected
                                                    ? "border-orange-400 bg-orange-50 text-orange-700 shadow-sm"
                                                    : "border-orange-200 bg-white text-stone-400 hover:border-orange-300"
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name="skill-select"
                                                className="w-3.5 h-3.5 rounded-full border-orange-300 accent-orange-500"
                                                checked={isSelected}
                                                onChange={() => handleSkillToggle(skill.id)}
                                            />
                                            <span className="font-medium">{skill.name}</span>
                                            {hasInputs && isSelected && (
                                                <span className="bg-orange-200 text-orange-800 px-1.5 py-0.5 rounded text-[9px]">
                                                    <Icon name="clipboard" size={12} /> {skill.requiredInputs!.length} 項輸入
                                                </span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Form data summary (after submission) */}
                        {chatStarted && Object.keys(formData).length > 0 && (
                            <details className="mt-1">
                                <summary className="text-xs text-stone-400 cursor-pointer hover:text-stone-500">
                                    <Icon name="clipboard" size={14} /> 已填寫 {Object.values(formData).filter(v => v.trim()).length}/{allRequiredInputs.length} 項規格資料
                                </summary>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    {allRequiredInputs.map(input => (
                                        <div key={input.id} className="text-xs">
                                            <span className="font-medium text-stone-500">{input.group} → {input.label}:</span>
                                            <span className={formData[input.id]?.trim() ? "text-green-600 ml-1" : "text-red-400 ml-1"}>
                                                {formData[input.id]?.trim() ? <><Icon name="check" size={10} className="text-emerald-500" /> 已填</> : <><Icon name="cross" size={10} className="text-stone-400" /> 未填</>}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                </div>
            </Card>

            {/* Console area */}
            {chatStarted ? (
                <Card className="flex-1 min-h-0 flex flex-col overflow-hidden p-0 border-0 bg-transparent shadow-none">
                    <TerminalConsole
                        key={`terminal-${consoleKey}`}
                        cwd={undefined}
                        cli={effectiveCli}
                        model={effectiveModel || undefined}
                        approvalMode={effectiveApprovalMode}
                        systemPrompt={undefined}
                        initialPrompt={chatStarted ? [
                            systemPrompt ? `# System Instructions\n${systemPrompt}` : '',
                            Object.keys(formData).length > 0 ? buildInitialMessage(allRequiredInputs, formData, selectedSkillIds) : '',
                        ].filter(Boolean).join('\n\n') : undefined}
                    />
                </Card>
            ) : (
                <Card className="flex-1 min-h-0 flex items-center justify-center border-dashed border-2 border-orange-200 bg-amber-50/50/50">
                    <div className="text-center space-y-2">
                        <div className="text-4xl"><Icon name="robot" size={40} /></div>
                        {allRequiredInputs.length > 0 ? (
                            <div className="text-sm text-stone-400">
                                點「<Icon name="clipboard" size={12} /> 填寫需求」準備規格資料，再開始開發
                            </div>
                        ) : (
                            <div className="text-sm text-stone-400">選擇一個技能後點 Start 來啟動 Console</div>
                        )}
                        <details className="mt-4 text-left">
                            <summary className="text-xs text-stone-400 cursor-pointer hover:text-stone-500 text-center">
                                <Icon name="document" size={14} /> 預覽 System Prompt ({systemPrompt.length} 字元)
                            </summary>
                            <pre className="bg-zinc-900 text-green-400 p-4 rounded-xl text-[11px] whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto mt-2">
                                {systemPrompt}
                            </pre>
                        </details>
                    </div>
                </Card>
            )}

            {/* Prompt preview modal */}
            {showPromptModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPromptModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-w-[90vw] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-orange-100">
                            <div>
                                <h3 className="text-base font-bold text-stone-800 flex items-center gap-1.5"><Icon name="document" size={18} /> System Prompt 預覽</h3>
                                <p className="text-xs text-stone-400 mt-0.5">
                                    {employee.codename} · {systemPrompt.length} 字元
                                </p>
                            </div>
                            <button
                                onClick={() => setShowPromptModal(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-amber-50 text-stone-400 hover:text-stone-500 transition-colors"
                            >
                                <Icon name="cross" size={16} />
                            </button>
                        </div>
                        <div className="px-5 py-3 border-b border-orange-100 flex flex-wrap gap-1.5">
                            {employee.skills.map(s => (
                                <span key={s.id} className={cn(
                                    "text-[10px] px-2 py-1 rounded-full",
                                    selectedSkillIds.includes(s.id)
                                        ? "bg-orange-100 text-orange-700"
                                        : "bg-amber-50 text-stone-400 line-through"
                                )}>
                                    {selectedSkillIds.includes(s.id) ? <Icon name="check" size={10} className="text-emerald-500" /> : <Icon name="cross" size={10} className="text-stone-300" />} {s.name}
                                </span>
                            ))}
                        </div>
                        <pre className="flex-1 overflow-y-auto bg-zinc-900 text-green-400 p-5 text-xs whitespace-pre-wrap font-mono rounded-b-2xl">
                            {systemPrompt}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
}
