import React, { useState } from "react";
import { Skill, CrewSkill, RequiredInput, Risk } from "../types";
import CrewAvatar from "./CrewAvatar";
import Icon from "./Icon";
import { useTheme } from "../theme";

interface CrewEditorProps {
    crew?: Skill | null;
    onSave: (crew: Skill) => Promise<void>;
    onDelete?: (id: string) => Promise<void>;
    onCancel: () => void;
}

const RISK_OPTIONS: Risk[] = ["safe", "guarded", "external"];

const EMPTY_SKILL: CrewSkill = {
    id: "",
    name: "",
    description: "",
    enabled: true,
    prompt: "",
    requiredInputs: [],
    cli: "qwen",
};

const EMPTY_INPUT: RequiredInput = {
    id: "",
    label: "",
    description: "",
    placeholder: "",
    required: false,
};

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
    const [skills, setSkills] = useState<CrewSkill[]>(crew?.skills?.length ? crew.skills : []);

    const idDisabled = isEdit;

    function makeSkillId(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }

    const addSkill = () => {
        setSkills([...skills, { ...EMPTY_SKILL, id: `skill-${Date.now()}` }]);
    };

    const removeSkill = (idx: number) => {
        setSkills(skills.filter((_, i) => i !== idx));
    };

    const updateSkill = (idx: number, field: keyof CrewSkill, value: any) => {
        const updated = [...skills];
        updated[idx] = { ...updated[idx], [field]: value };
        if (field === "name" && updated[idx].id.startsWith("skill-")) {
            updated[idx].id = makeSkillId(value) || updated[idx].id;
        }
        setSkills(updated);
    };

    const addInput = (skillIdx: number) => {
        const updated = [...skills];
        const inputs = [...(updated[skillIdx].requiredInputs || []), { ...EMPTY_INPUT, id: `input-${Date.now()}` }];
        updated[skillIdx] = { ...updated[skillIdx], requiredInputs: inputs };
        setSkills(updated);
    };

    const removeInput = (skillIdx: number, inputIdx: number) => {
        const updated = [...skills];
        const inputs = (updated[skillIdx].requiredInputs || []).filter((_, i) => i !== inputIdx);
        updated[skillIdx] = { ...updated[skillIdx], requiredInputs: inputs };
        setSkills(updated);
    };

    const updateInput = (skillIdx: number, inputIdx: number, field: keyof RequiredInput, value: any) => {
        const updated = [...skills];
        const inputs = [...(updated[skillIdx].requiredInputs || [])];
        inputs[inputIdx] = { ...inputs[inputIdx], [field]: value };
        if (field === "label" && inputs[inputIdx].id.startsWith("input-")) {
            inputs[inputIdx].id = makeSkillId(value) || inputs[inputIdx].id;
        }
        updated[skillIdx] = { ...updated[skillIdx], requiredInputs: inputs };
        setSkills(updated);
    };

    const handleSave = async () => {
        setError("");
        if (!id.trim()) { setError("ID is required"); return; }
        if (!title.trim()) { setError("Title is required"); return; }
        if (!codename.trim()) { setError("Codename is required"); return; }
        if (!rolePrompt.trim()) { setError("Role Prompt is required"); return; }
        for (const sk of skills) {
            if (!sk.id.trim() || !sk.name.trim()) {
                setError("All skills must have id and name");
                return;
            }
        }

        const newCrew: Skill = {
            id: id.trim(),
            title: title.trim(),
            codename: codename.trim(),
            imageUrl: imageUrl.trim() || "/crews/pic/default_crew.png",
            skills: skills.map(sk => ({ ...sk, id: sk.id.trim(), name: sk.name.trim() })),
            risk,
            description: description.trim(),
            rolePrompt: rolePrompt.trim(),
            chatConfig: { greeting: greeting.trim() || undefined, maxTokens, temperature },
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

    // Shared input styles (text-sm = 14px, matching profile)
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
                            <div className="text-xs text-stone-400 mt-1">{skills.length} skills • {risk}</div>
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

                    {/* Chat Config */}
                    <fieldset className="space-y-3">
                        <legend className="text-sm font-bold text-stone-600 border-b border-stone-200 pb-1 w-full flex items-center gap-1.5"><Icon name="chat" size={16} /> Chat Config</legend>
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

                    {/* Skills — unified text-sm matching profile */}
                    <fieldset className="space-y-4">
                        <div className="flex items-center justify-between border-b border-stone-200 pb-1">
                            <legend className="text-sm font-bold text-stone-600 flex items-center gap-1.5"><Icon name="lightning" size={16} /> Skills ({skills.length})</legend>
                            <button type="button" onClick={addSkill}
                                className="px-3 py-1.5 rounded-lg text-sm font-bold transition-colors"
                                style={{ backgroundColor: t.accentLight, color: t.accent, borderColor: t.accentBorder }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accent; e.currentTarget.style.color = "white"; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = t.accentLight; e.currentTarget.style.color = t.accent; }}
                            >
                                + Add Skill
                            </button>
                        </div>

                        {skills.length === 0 && (
                            <div className="text-center text-sm text-stone-400 py-4">
                                No skills yet. Click "+ Add Skill" to add one.
                            </div>
                        )}

                        {skills.map((sk, skIdx) => (
                            <div key={skIdx} className="border rounded-xl p-4 space-y-3" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold" style={{ color: t.accent }}>Skill #{skIdx + 1} — {sk.name || "Unnamed"}</span>
                                    <button type="button" onClick={() => removeSkill(skIdx)}
                                        className="text-sm text-red-400 hover:text-red-600 font-bold flex items-center gap-0.5"><Icon name="cross" size={12} /> Remove</button>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="text-sm font-semibold text-stone-500">ID</label>
                                        <input value={sk.id} onChange={e => updateSkill(skIdx, "id", e.target.value)}
                                            className={`${inputCls} font-mono`} style={inputStyle} />
                                    </div>
                                    <div>
                                        <label className="text-sm font-semibold text-stone-500">Name *</label>
                                        <input value={sk.name} onChange={e => updateSkill(skIdx, "name", e.target.value)}
                                            className={inputCls} style={inputStyle} />
                                    </div>
                                    <div className="flex items-end gap-2">
                                        <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                                            <input type="checkbox" checked={sk.enabled}
                                                onChange={e => updateSkill(skIdx, "enabled", e.target.checked)}
                                                className="rounded border-stone-300" />
                                            <span className="text-sm text-stone-500">Enabled</span>
                                        </label>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-semibold text-stone-500">Description</label>
                                    <input value={sk.description} onChange={e => updateSkill(skIdx, "description", e.target.value)}
                                        className={inputCls} style={inputStyle} placeholder="What this skill does" />
                                </div>
                                <div>
                                    <label className="text-sm font-semibold text-stone-500">Prompt</label>
                                    <textarea value={sk.prompt} onChange={e => updateSkill(skIdx, "prompt", e.target.value)}
                                        rows={3} className={`${inputCls} font-mono`} style={inputStyle}
                                        placeholder="Skill-specific system prompt instructions..." />
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="text-sm font-semibold text-stone-500">CLI Engine</label>
                                        <select value={sk.cli || "qwen"} onChange={e => updateSkill(skIdx, "cli", e.target.value)}
                                            className={`${inputCls}`} style={inputStyle}>
                                            <option value="qwen">Qwen Code</option>
                                            <option value="claude">Claude Code</option>
                                            <option value="opencode">OpenCode</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-sm font-semibold text-stone-500">Model</label>
                                        <input value={sk.model || ""} onChange={e => updateSkill(skIdx, "model", e.target.value)}
                                            className={inputCls} style={inputStyle} placeholder="Default (inherit)" />
                                    </div>
                                    <div>
                                        <label className="text-sm font-semibold text-stone-500">Approval Mode</label>
                                        <select value={sk.approvalMode || ""} onChange={e => updateSkill(skIdx, "approvalMode", e.target.value)}
                                            className={inputCls} style={inputStyle}>
                                            <option value="">Default (inherit)</option>
                                            <option value="default">Default</option>
                                            <option value="auto-edit">Auto-Edit</option>
                                            <option value="yolo">YOLO</option>
                                            <option value="plan">Plan</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Required Inputs */}
                                <div className="space-y-3 ml-2 pl-4 border-l-2" style={{ borderColor: t.accentBorder }}>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-bold" style={{ color: t.accent }}>Inputs ({sk.requiredInputs?.length || 0})</span>
                                        <button type="button" onClick={() => addInput(skIdx)}
                                            className="text-sm font-bold hover:underline" style={{ color: t.accent }}>+ Add Input</button>
                                    </div>
                                    {(sk.requiredInputs || []).map((inp, inpIdx) => (
                                        <div key={inpIdx} className="bg-white rounded-lg p-4 border border-stone-200 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-bold text-stone-500">Input #{inpIdx + 1}</span>
                                                <button type="button" onClick={() => removeInput(skIdx, inpIdx)}
                                                    className="text-sm text-red-400 hover:text-red-600 font-bold"><Icon name="cross" size={12} /></button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-sm text-stone-500">ID</label>
                                                    <input value={inp.id} onChange={e => updateInput(skIdx, inpIdx, "id", e.target.value)}
                                                        className={`${inputCls} font-mono`} style={inputStyle} />
                                                </div>
                                                <div>
                                                    <label className="text-sm text-stone-500">Label *</label>
                                                    <input value={inp.label} onChange={e => updateInput(skIdx, inpIdx, "label", e.target.value)}
                                                        className={inputCls} style={inputStyle} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-sm text-stone-500">Description</label>
                                                <input value={inp.description} onChange={e => updateInput(skIdx, inpIdx, "description", e.target.value)}
                                                    className={inputCls} style={inputStyle} />
                                            </div>
                                            <div>
                                                <label className="text-sm text-stone-500">Placeholder</label>
                                                <input value={inp.placeholder} onChange={e => updateInput(skIdx, inpIdx, "placeholder", e.target.value)}
                                                    className={inputCls} style={inputStyle} />
                                            </div>
                                            <div className="flex gap-4 items-center">
                                                <label className="flex items-center gap-1.5 cursor-pointer">
                                                    <input type="checkbox" checked={inp.required}
                                                        onChange={e => updateInput(skIdx, inpIdx, "required", e.target.checked)}
                                                        className="rounded border-stone-200" />
                                                    <span className="text-sm text-stone-500">Required</span>
                                                </label>
                                                <label className="flex items-center gap-1.5 cursor-pointer">
                                                    <input type="checkbox" checked={inp.multiline || false}
                                                        onChange={e => updateInput(skIdx, inpIdx, "multiline", e.target.checked)}
                                                        className="rounded border-stone-200" />
                                                    <span className="text-sm text-stone-500">Multiline</span>
                                                </label>
                                                <div className="flex items-center gap-1.5">
                                                    <label className="text-sm text-stone-500">Group</label>
                                                    <input value={inp.group || ""} onChange={e => updateInput(skIdx, inpIdx, "group", e.target.value)}
                                                        className={`${inputCls} !mt-0 w-32`} style={inputStyle} />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
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
