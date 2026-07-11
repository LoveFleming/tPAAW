import React, { useState, useEffect } from "react";
import { Crew, SkillDefinition } from "../types";
import CrewAvatar from "./CrewAvatar";
import Icon from "./Icon";
import { useTheme } from "../theme";
import API_BASE from "../api";

interface CrewEditorProps {
    crew?: Crew | null;
    onSave: (crew: Crew) => Promise<void>;
    onDelete?: (id: string) => Promise<void>;
    onCancel: () => void;
}

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
    const [imageUrl, setImageUrl] = useState(crew?.imageUrl || "");
    const [greeting, setGreeting] = useState(crew?.chatConfig?.greeting || "");
    const [maxTokens, setMaxTokens] = useState(crew?.chatConfig?.maxTokens || 4096);
    const [temperature, setTemperature] = useState(crew?.chatConfig?.temperature ?? 0.3);
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(crew?.skillIds || []);

    // New fields: expertise + guardrails
    const [expertise, setExpertise] = useState<string[]>(crew?.expertise || []);
    const [expertiseInput, setExpertiseInput] = useState("");
    const [redirectRules, setRedirectRules] = useState<string[]>(crew?.guardrails?.redirectRules || []);
    const [redirectInput, setRedirectInput] = useState("");
    const [refuseTopics, setRefuseTopics] = useState<string[]>(crew?.guardrails?.refuseTopics || []);
    const [refuseInput, setRefuseInput] = useState("");

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

    const addExpertise = () => {
        const v = expertiseInput.trim();
        if (v && !expertise.includes(v)) { setExpertise([...expertise, v]); setExpertiseInput(""); }
    };
    const addRedirect = () => {
        const v = redirectInput.trim();
        if (v && !redirectRules.includes(v)) { setRedirectRules([...redirectRules, v]); setRedirectInput(""); }
    };
    const addRefuse = () => {
        const v = refuseInput.trim();
        if (v && !refuseTopics.includes(v)) { setRefuseTopics([...refuseTopics, v]); setRefuseInput(""); }
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
            description: description.trim(),
            rolePrompt: rolePrompt.trim(),
            expertise: expertise.length > 0 ? expertise : undefined,
            guardrails: (redirectRules.length > 0 || refuseTopics.length > 0) ? {
                redirectRules: redirectRules.length > 0 ? redirectRules : undefined,
                refuseTopics: refuseTopics.length > 0 ? refuseTopics : undefined,
            } : undefined,
            chatConfig: {
                greeting: greeting.trim() || undefined,
                maxTokens,
                temperature,
                engine: "paaw-agent" as const,
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

    const inputCls = "w-full mt-1 px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-1";
    const inputStyle = { borderColor: "#d6d3d1" };

    // Tag input helper component
    const TagInput = ({ label, items, setItems, input, setInput, onAdd, placeholder }: any) => (
        <div>
            <label className="text-sm font-semibold text-stone-500">{label}</label>
            <div className="flex gap-1 mt-1">
                <input value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
                    className={inputCls} style={inputStyle} placeholder={placeholder} />
                <button type="button" onClick={onAdd}
                    className="px-3 py-2 rounded-lg text-sm bg-stone-100 hover:bg-stone-200 text-stone-600 shrink-0">+</button>
            </div>
            {items.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {items.map((item: string, i: number) => (
                        <span key={i} className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-600 flex items-center gap-1">
                            {item}
                            <button type="button" onClick={() => setItems(items.filter((_: any, j: number) => j !== i))}
                                className="text-blue-400 hover:text-red-500">✕</button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );

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
                                {selectedSkillIds.length === 0 ? '純 Prompt 模式' : `${selectedSkillIds.length} 個技能`}
                                {expertise.length > 0 && ` • ${expertise.length} 項專業`}
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
                    </fieldset>

                    {/* Role Prompt */}
                    <fieldset className="space-y-3">
                        <legend className="text-sm font-bold text-stone-600 border-b border-stone-200 pb-1 w-full flex items-center gap-1.5"><Icon name="brain" size={16} /> Role Prompt *</legend>
                        <textarea value={rolePrompt} onChange={e => setRolePrompt(e.target.value)} rows={6}
                            className={`${inputCls} font-mono`} style={inputStyle}
                            placeholder="你是...，名叫...。你的工作是...&#10;包含職責、專業範圍、護欄（不該做什麼）、輸出格式" />
                    </fieldset>

                    {/* Expertise & Guardrails */}
                    <fieldset className="space-y-4">
                        <legend className="text-sm font-bold text-stone-600 border-b border-stone-200 pb-1 w-full flex items-center gap-1.5">
                            <Icon name="shield" size={16} /> 專業範圍與護欄
                        </legend>
                        <TagInput label="專業範圍" items={expertise} setItems={setExpertise}
                            input={expertiseInput} setInput={setExpertiseInput} onAdd={addExpertise}
                            placeholder="e.g. 系統架構設計、技術選型..." />
                        <div className="border-t pt-3" style={{ borderColor: t.accentBorder + "40" }}>
                            <p className="text-xs text-stone-400 mb-2">護欄 — 被問到超出範圍時的轉介和拒絕規則</p>
                            <TagInput label="轉介規則（超出範圍 → 找誰）" items={redirectRules} setItems={setRedirectRules}
                                input={redirectInput} setInput={setRedirectInput} onAdd={addRedirect}
                                placeholder="e.g. 寫程式碼 → Developer (Priya)" />
                            <div className="mt-3">
                                <TagInput label="拒絕主題（完全不回答）" items={refuseTopics} setItems={setRefuseTopics}
                                    input={refuseInput} setInput={setRefuseInput} onAdd={addRefuse}
                                    placeholder="e.g. 非技術問題、人事管理" />
                            </div>
                        </div>
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

                        {selectedSkillIds.length === 0 && allSkills.length > 0 && (
                            <div className="text-xs text-stone-400 text-center py-2">
                                未選技能 = 純 Prompt 模式，只使用 Role Prompt
                            </div>
                        )}
                    </fieldset>

                    {/* Execution Config */}
                    <fieldset className="space-y-3">
                        <legend className="text-sm font-bold text-stone-600 border-b border-stone-200 pb-1 w-full flex items-center gap-1.5"><Icon name="settings" size={16} /> 執行設定</legend>
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
                        <p className="text-xs text-stone-400">Model 由 PAAW 預設 / fallback chain 或 ModelSelector 控制，不再 per-crew 設定。</p>
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
