import ModelSelector from "./ModelSelector";
import API_BASE from "../api";
import React, { useState, useEffect } from "react";
import { Crew, Risk, SkillDefinition } from "../types";
import CrewAvatar from "./CrewAvatar";
import Icon from "./Icon";
import { useTheme } from "../theme";

interface CrewEditorProps {
    crew?: Crew | null;
    onSave: (crew: Crew) => Promise<void>;
    onDelete?: (id: string) => Promise<void>;
    onCancel: () => void;
}

const RISK_OPTIONS: Risk[] = ["safe", "guarded", "external"];

export default function CrewEditor({ crew, onSave, onDelete, onCancel }: CrewEditorProps) {
    const isEdit = !!crew;
    const { info: t } = useTheme();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const [id, setId] = useState(crew?.id || "");
    const [title, setTitle] = useState(crew?.title || "");
    const [codename, setCodename] = useState(crew?.codename || "");
    const [description, setDescription] = useState(crew?.description || "");
    const [rolePrompt, setRolePrompt] = useState(crew?.rolePrompt || "");
    const [risk, setRisk] = useState<Risk>(crew?.risk || "safe");
    const [imageUrl, setImageUrl] = useState(crew?.imageUrl || "");
    const [greeting, setGreeting] = useState(crew?.chatConfig?.greeting || "");
    const [maxTokens, setMaxTokens] = useState(crew?.chatConfig?.maxTokens || 4096);
    const [temperature, setTemperature] = useState(crew?.chatConfig?.temperature ?? 0.3);
    const [model, setModel] = useState(crew?.chatConfig?.model || "");
    const [approvalMode, setApprovalMode] = useState(crew?.chatConfig?.approvalMode || "yolo");
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(crew?.skillIds || []);

    // Load saved model preference when crew changes
    useEffect(() => {
        if (crew?.chatConfig?.model) setModel(crew.chatConfig.model);
    }, [crew]);

    // Fetch all skill definitions from shared pool
    const [allSkills, setAllSkills] = useState<SkillDefinition[]>([]);
    useEffect(() => {
        fetch(`${API_BASE}/api/skills`)
            .then(r => r.json())
            .then((data: SkillDefinition[]) => setAllSkills(data))
            .catch(() => {});
    }, []);

    const idDisabled = isEdit;

    const toggleSkill = (skillId: string) => {
        setSelectedSkillIds(prev =>
            prev.includes(skillId) ? prev.filter(s => s !== skillId) : [...prev, skillId]
        );
    };

    const handleSave = async () => {
        setError("");
        if (!id.trim()) { setError("ID is required"); return; }
        if (!title.trim()) { setError("Title is required"); return; }
        if (!codename.trim()) { setError("Codename is required"); return; }
        if (!rolePrompt.trim()) { setError("Role Prompt is required"); return; }

        const newCrew: Crew = {
            id: id.trim(),
            title: title.trim(),
            codename: codename.trim(),
            imageUrl: imageUrl.trim() || "/crews/pic/default_crew.png",
            skillIds: selectedSkillIds,
            risk,
            description: description.trim(),
            rolePrompt: rolePrompt.trim(),
            chatConfig: {
                greeting: greeting.trim() || undefined,
                maxTokens,
                temperature,
                engine: "paaw-agent" as const,
                model: model.trim() || undefined,
                approvalMode: approvalMode.trim() || undefined,
            },
        };

        setSaving(true);
        try { await onSave(newCrew); }
        catch (err: any) { setError(err.message || "Save failed"); }
        finally { setSaving(false); }
    };

    const handleDelete = async () => {
        if (!crew || !onDelete) return;
        if (!confirm(`確定要刪除 ${crew.title} (${crew.id})？這個操作無法復原。`)) return;
        setSaving(true);
        try { await onDelete(crew.id); }
        catch (err: any) { setError(err.message || "Delete failed"); }
        finally { setSaving(false); }
    };

    // Shared input styles
    const inputCls = "w-full mt-1 px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-1";
    const inputStyle = { borderColor: "#d6d3d1" };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 my-auto">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                    <h2 className="text-xl font-bold" style={{ color: t.accentText }}>
                        {isEdit ? <><Icon name="edit" size={16} /> 編輯員工</> : <><Icon name="plus" size={16} /> 新增員工</>}
                    </h2>
                    <button onClick={onCancel} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">&times;</button>
                </div>

                <div className="px-6 py-4 space-y-6 max-h-[75vh] overflow-y-auto">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>
                    )}

                    {/* Preview */}
                    <div className="flex items-center gap-4 p-4 rounded-xl" style={{ backgroundColor: t.accentBg }}>
                        <CrewAvatar crewId={id || "new"} codename={codename || "New"} size={80} />
                        <div>
                            <div className="text-lg font-bold text-stone-800">{title || "Employee Name"}</div>
                            <div className="text-sm text-stone-500">{codename || "Codename"}</div>
                            <div className="text-xs text-stone-400 mt-1">
                                {selectedSkillIds.length === 0 ? '純 Prompt 模式' : `${selectedSkillIds.length} 個技能`} • {approvalMode}
                            </div>
                        </div>
                    </div>

                    {/* Basic Info */}
                    <fieldset className="space-y-3">
                        <legend className="text-sm font-bold text-stone-600 border-b border-stone-200 pb-1 w-full flex items-center gap-1.5"><Icon name="clipboard" size={16} /> 基本資料</legend>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-semibold text-stone-500">ID *</label>
                                <input value={id} onChange={e => setId(e.target.value)} disabled={idDisabled}
                                    className={`${inputCls} disabled:bg-stone-100 disabled:text-stone-400`} style={inputStyle}
                                    placeholder="ai.my-role" />
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-stone-500">Codename *</label>
                                <input value={codename} onChange={e => setCodename(e.target.value)}
                                    className={inputCls} style={inputStyle} placeholder="王小明 Tom Wang" />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-stone-500">Title *</label>
                            <input value={title} onChange={e => setTitle(e.target.value)}
                                className={inputCls} style={inputStyle} placeholder="Spec Architect" />
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-stone-500">Description</label>
                            <input value={description} onChange={e => setDescription(e.target.value)}
                                className={inputCls} style={inputStyle} placeholder="Short description of this employee's role" />
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-stone-500">Avatar Image URL</label>
                            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                                className={inputCls} style={inputStyle} placeholder="/crews/pic/my_avatar.png" />
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-stone-500">Risk Level</label>
                            <div className="flex gap-2 mt-1">
                                {RISK_OPTIONS.map(r => (
                                    <button key={r} type="button" onClick={() => setRisk(r)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
                                            risk === r
                                                ? r === "safe" ? "bg-green-100 border-green-400 text-green-700"
                                                  : r === "guarded" ? "bg-yellow-100 border-yellow-400 text-yellow-700"
                                                  : "bg-red-100 border-red-400 text-red-700"
                                                : "bg-white border-stone-300 text-stone-500 hover:bg-stone-50"
                                        }`}>
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </fieldset>

                    {/* Role Prompt */}
                    <fieldset className="space-y-3">
                        <legend className="text-sm font-bold text-stone-600 border-b border-stone-200 pb-1 w-full flex items-center gap-1.5"><Icon name="brain" size={16} /> Role Prompt *</legend>
                        <textarea value={rolePrompt} onChange={e => setRolePrompt(e.target.value)} rows={5}
                            className={`${inputCls} font-mono`} style={inputStyle}
                            placeholder="你是半導體工廠的...，名叫...。你的工作是..." />
                    </fieldset>

                    {/* Skills — 選擇共享技能池 */}
                    <fieldset className="space-y-3">
                        <div className="flex items-center justify-between border-b border-stone-200 pb-1">
                            <legend className="text-sm font-bold text-stone-600 flex items-center gap-1.5">
                                <Icon name="lightning" size={16} /> 技能 <span className="text-stone-400 font-normal">({selectedSkillIds.length})</span>
                            </legend>
                        </div>

                        {allSkills.length === 0 ? (
                            <div className="text-center text-sm py-6 rounded-xl border-2 border-dashed" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                                <div className="text-stone-400 mb-1">共享技能池中沒有技能</div>
                                <div className="text-xs text-stone-400">請先在 skills/input-prompt/ 目錄建立 SKILL.md</div>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {allSkills.map(sk => {
                                    const isSelected = selectedSkillIds.includes(sk.id);
                                    return (
                                        <button key={sk.id} type="button" onClick={() => toggleSkill(sk.id)}
                                            className="text-sm font-medium px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 whitespace-nowrap"
                                            style={isSelected
                                                ? { backgroundColor: t.accent, color: "white", borderColor: t.accent, boxShadow: `0 1px 3px ${t.accent}40` }
                                                : { backgroundColor: "white", color: "#57534e", borderColor: "#e7e5e4" }
                                            }
                                        >
                                            <Icon name={isSelected ? "check" : "gear"} size={12} />
                                            {sk.name}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {selectedSkillIds.length > 0 && (
                            <div className="space-y-1.5 mt-2">
                                {selectedSkillIds.map(sid => {
                                    const sk = allSkills.find(s => s.id === sid);
                                    return (
                                        <div key={sid} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg" style={{ backgroundColor: t.accentBg, color: t.accentText }}>
                                            <span className="font-bold">{sk?.name || sid}</span>
                                            {sk?.description && <span className="text-stone-400">— {sk.description}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {selectedSkillIds.length === 0 && allSkills.length > 0 && (
                            <div className="text-xs text-stone-400 text-center py-2">
                                未選技能 = 純 Prompt 模式，只使用 Role Prompt
                            </div>
                        )}
                    </fieldset>

                    {/* Execution Config — 歸員工管 */}
                    <fieldset className="space-y-3">
                        <legend className="text-sm font-bold text-stone-600 border-b border-stone-200 pb-1 w-full flex items-center gap-1.5"><Icon name="settings" size={16} /> 執行設定 <span className="text-stone-400 font-normal text-xs">（歸員工管）</span></legend>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-semibold text-stone-500">Model</label>
                                <ModelSelector feature="crewChat" value={model} onChange={setModel} className={inputCls} style={inputStyle} />
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-stone-500">Approval Mode</label>
                                <select value={approvalMode} onChange={e => setApprovalMode(e.target.value)}
                                    className={inputCls} style={inputStyle}>
                                    <option value="default">Default</option>
                                    <option value="auto-edit">Auto-Edit</option>
                                    <option value="yolo">YOLO</option>
                                    <option value="plan">Plan</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-stone-500">Greeting Message</label>
                            <input value={greeting} onChange={e => setGreeting(e.target.value)}
                                className={inputCls} style={inputStyle} placeholder="嗨！我是..." />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-semibold text-stone-500">Max Tokens</label>
                                <input type="number" value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))}
                                    className={inputCls} style={inputStyle} min={256} max={32768} />
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-stone-500">Temperature</label>
                                <input type="number" value={temperature} onChange={e => setTemperature(Number(e.target.value))}
                                    className={inputCls} style={inputStyle} min={0} max={2} step={0.1} />
                            </div>
                        </div>
                    </fieldset>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t rounded-b-2xl" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                    <div>
                        {isEdit && onDelete && (
                            <button type="button" onClick={handleDelete} disabled={saving}
                                className="px-4 py-2 rounded-lg text-sm font-bold bg-red-100 text-red-700 border border-red-300 hover:bg-red-200 transition-colors disabled:opacity-50">
                                <Icon name="trash" size={14} /> Delete
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={onCancel} disabled={saving}
                            className="px-4 py-2 rounded-lg text-sm font-bold bg-white text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors">
                            Cancel
                        </button>
                        <button type="button" onClick={handleSave} disabled={saving}
                            className="px-6 py-2 rounded-lg text-sm font-bold text-white transition-colors disabled:opacity-50"
                            style={{ backgroundColor: t.accent }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accentHover; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = t.accent; }}
                        >
                            {saving ? "Saving..." : isEdit ? <><Icon name="save" size={14} /> Save Changes</> : <><Icon name="plus" size={14} /> Create Employee</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
