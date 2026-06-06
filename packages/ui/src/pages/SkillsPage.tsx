import React, { useState, useEffect, useCallback } from "react";
import { SkillDefinition, UserInput } from "../types";
import Icon from "../components/Icon";
import { useTheme } from "../theme";

const API = "http://127.0.0.1:4097";

const EMPTY_INPUT: UserInput = {
    id: "",
    label: "",
    description: "",
    placeholder: "",
    required: false,
};

// Build SKILL.md content from form fields + structured userInputs
function buildSkillMd(fields: {
    id: string;
    name: string;
    version: string;
    description: string;
    category: string;
    tags: string;
    useSkills: string;
    usePhysicalSkills: string;
    userInputs: UserInput[];
    body: string;
}): string {
    const lines = ["---"];
    lines.push(`id: ${fields.id}`);
    lines.push(`name: ${fields.name}`);
    lines.push(`version: ${fields.version || "1.0.0"}`);
    lines.push(`description: ${fields.description}`);
    if (fields.category) lines.push(`category: ${fields.category}`);
    if (fields.tags) {
        const tags = fields.tags.split(",").map(t => t.trim()).filter(Boolean);
        if (tags.length) {
            lines.push("tags:");
            tags.forEach(t => lines.push(`  - ${t}`));
        }
    }
    if (fields.useSkills) {
        const skills = fields.useSkills.split(",").map(t => t.trim()).filter(Boolean);
        if (skills.length) {
            lines.push("useSkills:");
            skills.forEach(s => lines.push(`  - ${s}`));
        }
    }
    if (fields.usePhysicalSkills) {
        const pskills = fields.usePhysicalSkills.split(",").map(t => t.trim()).filter(Boolean);
        if (pskills.length) {
            lines.push("usePhysicalSkills:");
            pskills.forEach(s => lines.push(`  - ${s}`));
        }
    }
    if (fields.userInputs.length > 0) {
        lines.push("userInputs:");
        for (const inp of fields.userInputs) {
            lines.push(`  - id: ${inp.id || ""}`);
            lines.push(`    label: ${inp.label || ""}`);
            lines.push(`    description: ${inp.description || ""}`);
            lines.push(`    placeholder: ${inp.placeholder || ""}`);
            lines.push(`    required: ${inp.required ?? false}`);
            if (inp.type) lines.push(`    type: ${inp.type}`);
            if (inp.multiline) lines.push(`    multiline: true`);
            if (inp.rows) lines.push(`    rows: ${inp.rows}`);
        }
    }
    lines.push("---");
    lines.push("");
    lines.push(fields.body || `# ${fields.name}\n\n## 目的\n\n## 執行步驟\n\n## 產出\n`);
    return lines.join("\n");
}

export default function SkillsPage() {
    const { info: t } = useTheme();
    const [skills, setSkills] = useState<SkillDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<SkillDefinition | null>(null);
    const [creating, setCreating] = useState(false);

    // Editor form state
    const [fId, setFId] = useState("");
    const [fName, setFName] = useState("");
    const [fVersion, setFVersion] = useState("1.0.0");
    const [fDesc, setFDesc] = useState("");
    const [fCategory, setFCategory] = useState("");
    const [fTags, setFTags] = useState("");
    const [fUseSkills, setFUseSkills] = useState("");
    const [fUsePhysicalSkills, setFUsePhysicalSkills] = useState("");
    const [fUserInputs, setFUserInputs] = useState<UserInput[]>([]);
    const [fBody, setFBody] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const loadSkills = useCallback(() => {
        setLoading(true);
        fetch(`${API}/api/skills`)
            .then(r => r.json())
            .then((data: SkillDefinition[]) => {
                setSkills(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    useEffect(() => { loadSkills(); }, [loadSkills]);

    const startEdit = (sk: SkillDefinition) => {
        setEditing(sk);
        setCreating(false);
        setFId(sk.id);
        setFName(sk.name);
        setFVersion(sk.version || "1.0.0");
        setFDesc(sk.description);
        setFCategory(sk.category || "");
        setFTags("");
        setFUseSkills((sk.useSkills || []).join(", "));
        setFUsePhysicalSkills((sk.usePhysicalSkills || []).join(", "));
        setFUserInputs(sk.userInputs || []);
        setFBody(sk.skillPrompt || "");
        setError("");
    };

    const startCreate = () => {
        setEditing(null);
        setCreating(true);
        setFId("");
        setFName("");
        setFVersion("1.0.0");
        setFDesc("");
        setFCategory("");
        setFTags("");
        setFUseSkills("");
        setFUsePhysicalSkills("");
        setFUserInputs([]);
        setFBody("");
        setError("");
    };

    const cancelEdit = () => {
        setEditing(null);
        setCreating(false);
        setError("");
    };

    // userInputs editing helpers
    const addInput = () => {
        setFUserInputs([...fUserInputs, { ...EMPTY_INPUT, id: `input-${Date.now()}` }]);
    };

    const removeInput = (idx: number) => {
        setFUserInputs(fUserInputs.filter((_, i) => i !== idx));
    };

    const updateInput = (idx: number, field: keyof UserInput, value: any) => {
        const updated = [...fUserInputs];
        updated[idx] = { ...updated[idx], [field]: value };
        if (field === "label" && updated[idx].id.startsWith("input-")) {
            updated[idx].id = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || updated[idx].id;
        }
        setFUserInputs(updated);
    };

    const handleSave = async () => {
        setError("");
        if (!fId.trim()) { setError("Skill ID is required"); return; }
        if (!fName.trim()) { setError("Name is required"); return; }

        const content = buildSkillMd({
            id: fId.trim(),
            name: fName.trim(),
            version: fVersion.trim(),
            description: fDesc.trim(),
            category: fCategory.trim(),
            tags: fTags.trim(),
            useSkills: fUseSkills.trim(),
            usePhysicalSkills: fUsePhysicalSkills.trim(),
            userInputs: fUserInputs,
            body: fBody,
        });

        setSaving(true);
        try {
            const resp = await fetch(`${API}/api/skills/${fId.trim()}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });
            if (!resp.ok) {
                const data = await resp.json();
                throw new Error(data.error || "Save failed");
            }
            setEditing(null);
            setCreating(false);
            loadSkills();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (sk: SkillDefinition) => {
        if (!confirm(`確定要刪除 ${sk.name} (${sk.id})？這個操作無法復原。`)) return;
        try {
            await fetch(`${API}/api/skills/${sk.id}`, { method: "DELETE" });
            loadSkills();
            if (editing?.id === sk.id) cancelEdit();
        } catch {}
    };

    const inputCls = "w-full mt-1 px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-1";
    const inputStyle = { borderColor: "#d6d3d1" };

    // ── Editor panel ──
    if (creating || editing) {
        return (
            <div className="h-full flex flex-col bg-white">
                <div className="flex items-center justify-between px-6 py-3 border-b shrink-0" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                    <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: t.accentText }}>
                        <Icon name={editing ? "edit" : "plus"} size={16} />
                        {editing ? `編輯：${editing.name}` : "新增 Skill"}
                    </h2>
                    <button onClick={cancelEdit} className="text-stone-400 hover:text-stone-600 text-xl leading-none">&times;</button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}

                    {/* ── Basic Info ── */}
                    <fieldset className="space-y-3">
                        <legend className="text-sm font-bold text-stone-600 border-b border-stone-200 pb-1 w-full flex items-center gap-1.5"><Icon name="clipboard" size={16} /> 基本資料</legend>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-semibold text-stone-500">Skill ID *</label>
                                <input value={fId} onChange={e => setFId(e.target.value)} disabled={!!editing}
                                    className={`${inputCls} disabled:bg-stone-100`} style={inputStyle} placeholder="my-skill-id" />
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-stone-500">名稱 *</label>
                                <input value={fName} onChange={e => setFName(e.target.value)}
                                    className={inputCls} style={inputStyle} placeholder="My Skill Name" />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-stone-500">描述</label>
                            <input value={fDesc} onChange={e => setFDesc(e.target.value)}
                                className={inputCls} style={inputStyle} placeholder="一句話說明這個技能做什麼" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-sm font-semibold text-stone-500">Version</label>
                                <input value={fVersion} onChange={e => setFVersion(e.target.value)}
                                    className={inputCls} style={inputStyle} placeholder="1.0.0" />
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-stone-500">Category</label>
                                <input value={fCategory} onChange={e => setFCategory(e.target.value)}
                                    className={inputCls} style={inputStyle} placeholder="tutorial" />
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-stone-500">Tags (逗號分隔)</label>
                                <input value={fTags} onChange={e => setFTags(e.target.value)}
                                    className={inputCls} style={inputStyle} placeholder="onboarding, guide" />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-stone-500">引用技能 (useSkills, 逗號分隔)</label>
                            <input value={fUseSkills} onChange={e => setFUseSkills(e.target.value)}
                                className={inputCls} style={inputStyle} placeholder="other-skill-id, another-skill" />
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-stone-500">引用實體技能 (usePhysicalSkills, 逗號分隔)</label>
                            <input value={fUsePhysicalSkills} onChange={e => setFUsePhysicalSkills(e.target.value)}
                                className={inputCls} style={inputStyle} placeholder="node-codegen, test-generation" />
                        </div>
                    </fieldset>

                    {/* ── User Inputs (structured editor) ── */}
                    <fieldset className="space-y-3">
                        <div className="flex items-center justify-between border-b border-stone-200 pb-1">
                            <legend className="text-sm font-bold text-stone-600 flex items-center gap-1.5">
                                <Icon name="form" size={16} /> 操作員輸入 <span className="text-stone-400 font-normal">({fUserInputs.length})</span>
                            </legend>
                            <button type="button" onClick={addInput}
                                className="text-xs font-bold px-2.5 py-1 rounded-lg border transition-colors"
                                style={{ borderColor: t.accentBorder, color: t.accent }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accent; e.currentTarget.style.color = "white"; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = t.accent; }}>
                                + 新增欄位
                            </button>
                        </div>

                        {fUserInputs.length === 0 && (
                            <div className="text-center text-sm py-4 rounded-xl border-2 border-dashed" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                                <div className="text-stone-400 mb-1">還沒有輸入欄位</div>
                                <div className="text-xs text-stone-400">點「+ 新增欄位」讓操作員在啟動前填寫規格</div>
                            </div>
                        )}

                        {fUserInputs.map((inp, idx) => (
                            <div key={inp.id + idx} className="border rounded-xl p-3 space-y-2.5" style={{ borderColor: t.accentBorder }}>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold font-mono px-2 py-0.5 rounded" style={{ backgroundColor: t.accentBg, color: t.accent }}>{inp.id || `input-${idx}`}</span>
                                    <button type="button" onClick={() => removeInput(idx)}
                                        className="text-red-400 hover:text-red-600 text-xs flex items-center gap-0.5">
                                        <Icon name="trash" size={10} /> 移除
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs font-semibold text-stone-500">Label *</label>
                                        <input value={inp.label} onChange={e => updateInput(idx, "label", e.target.value)}
                                            className={`${inputCls} !text-xs !py-1.5`} style={inputStyle} placeholder="需求來源" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-stone-500">ID</label>
                                        <input value={inp.id} onChange={e => updateInput(idx, "id", e.target.value)}
                                            className={`${inputCls} !text-xs !py-1.5 font-mono`} style={inputStyle} placeholder="source_material" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-stone-500">Description</label>
                                    <input value={inp.description} onChange={e => updateInput(idx, "description", e.target.value)}
                                        className={`${inputCls} !text-xs !py-1.5`} style={inputStyle} placeholder="貼上 PM 的需求文件、會議記錄..." />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-stone-500">Placeholder</label>
                                    <textarea value={inp.placeholder} onChange={e => updateInput(idx, "placeholder", e.target.value)}
                                        className={`${inputCls} !text-xs !py-1.5`} style={inputStyle} rows={2}
                                        placeholder={"貼上需求文件內容...\n\n例：\nPM 要求做一個 lot-tool-check 功能..."} />
                                </div>
                                <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="checkbox" checked={inp.required}
                                            onChange={e => updateInput(idx, "required", e.target.checked)}
                                            className="rounded border-stone-200" />
                                        <span className="text-xs text-stone-500">Required</span>
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="checkbox" checked={inp.multiline || false}
                                            onChange={e => updateInput(idx, "multiline", e.target.checked)}
                                            className="rounded border-stone-200" />
                                        <span className="text-xs text-stone-500">Multiline</span>
                                    </label>
                                    <div className="flex items-center gap-1.5">
                                        <label className="text-xs text-stone-500">Type</label>
                                        <select value={inp.type || "text"} onChange={e => updateInput(idx, "type", e.target.value)}
                                            className="px-2 py-1 text-xs border rounded-lg" style={inputStyle}>
                                            <option value="text">text</option>
                                            <option value="textarea">textarea</option>
                                            <option value="select">select</option>
                                            <option value="number">number</option>
                                        </select>
                                    </div>
                                    {inp.multiline && (
                                        <div className="flex items-center gap-1.5">
                                            <label className="text-xs text-stone-500">Rows</label>
                                            <input type="number" min={2} max={20} value={inp.rows || 3}
                                                onChange={e => updateInput(idx, "rows", Number(e.target.value))}
                                                className="w-14 px-2 py-1 text-xs border rounded-lg" style={inputStyle} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </fieldset>

                    {/* ── Skill Prompt (SKILL.md body) ── */}
                    <fieldset className="space-y-3">
                        <legend className="text-sm font-bold text-stone-600 border-b border-stone-200 pb-1 w-full flex items-center gap-1.5"><Icon name="brain" size={16} /> Skill Prompt (SKILL.md body)</legend>
                        <textarea value={fBody} onChange={e => setFBody(e.target.value)}
                            className={`${inputCls} font-mono`} style={inputStyle} rows={14}
                            placeholder={"# Skill Name\n\n## 目的\n\n## 執行步驟\n\n1. ...\n\n## 產出\n"} />
                    </fieldset>
                </div>
                <div className="flex items-center justify-end gap-2 px-6 py-3 border-t shrink-0" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                    <button onClick={cancelEdit} className="px-4 py-2 rounded-lg text-sm font-bold bg-white text-stone-600 border border-stone-300 hover:bg-stone-50">
                        Cancel
                    </button>
                    <button onClick={handleSave} disabled={saving}
                        className="px-6 py-2 rounded-lg text-sm font-bold text-white transition-colors disabled:opacity-50"
                        style={{ backgroundColor: t.accent }}>
                        {saving ? "Saving..." : editing ? <><Icon name="save" size={14} /> Save Changes</> : <><Icon name="plus" size={14} /> Create Skill</>}
                    </button>
                </div>
            </div>
        );
    }

    // ── List view ──
    return (
        <div className="h-full flex flex-col bg-white">
            <div className="flex items-center justify-between px-6 py-3 border-b shrink-0" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: t.accentText }}>
                    <Icon name="lightning" size={16} /> Skills 共享技能池
                        <span className="text-xs font-normal text-stone-400 ml-2">input-prompt + physical-skill</span>
                </h2>
                <button onClick={startCreate}
                    className="px-4 py-1.5 rounded-lg text-sm font-bold text-white flex items-center gap-1.5"
                    style={{ backgroundColor: t.accent }}>
                    <Icon name="plus" size={14} /> 新增 Skill
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12 text-stone-400">
                        <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Loading...
                    </div>
                ) : skills.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="text-4xl mb-3">⚡</div>
                        <div className="text-stone-500 font-semibold mb-1">還沒有任何 Skill</div>
                        <div className="text-stone-400 text-sm mb-4">Skill 是可重用的方法論，任何員工都可以引用</div>
                        <button onClick={startCreate}
                            className="px-5 py-2 rounded-xl text-sm font-bold text-white"
                            style={{ backgroundColor: t.accent }}>
                            <Icon name="plus" size={14} /> 建立第一個 Skill
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {skills.map(sk => (
                            <div key={sk.id}
                                className="rounded-2xl border shadow-sm overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5 group"
                                style={{ borderColor: t.accentBorder }}>
                                <div className="p-4">
                                    <div className="flex items-start justify-between mb-2">
                                        <div>
                                            <div className="font-bold text-stone-800">{sk.name}</div>
                                            <div className="text-xs text-stone-400 font-mono">{sk.id}</div>
                                        </div>
                                        {sk.category && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                                style={{ backgroundColor: t.accentBg, color: t.accent }}>
                                                {sk.category}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-stone-500 line-clamp-2 mb-3">{sk.description}</p>
                                    <div className="flex items-center gap-2 text-[11px] text-stone-400">
                                        <span className={`px-1.5 py-0.5 rounded font-semibold ${sk.kind === 'physical-skill' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{sk.kind === 'physical-skill' ? '📦 實體' : '📝 輸入'}</span>
                                        {(sk.userInputs?.length || 0) > 0 && (
                                            <span className="px-1.5 py-0.5 rounded bg-stone-100">{sk.userInputs.length} inputs</span>
                                        )}
                                        {(sk.useSkills?.length || 0) > 0 && (
                                            <span className="px-1.5 py-0.5 rounded bg-stone-100">refs: {sk.useSkills.join(", ")}</span>
                                        )}
                                        {(sk.usePhysicalSkills?.length || 0) > 0 && (
                                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">uses: {sk.usePhysicalSkills.join(", ")}</span>
                                        )}
                                        <span className="ml-auto">{sk.version || "1.0.0"}</span>
                                    </div>
                                </div>
                                <div className="flex border-t" style={{ borderColor: t.accentBorder }}>
                                    <button onClick={() => startEdit(sk)}
                                        className="flex-1 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors flex items-center justify-center gap-1">
                                        <Icon name="edit" size={12} /> 編輯
                                    </button>
                                    <div className="w-px" style={{ backgroundColor: t.accentBorder }} />
                                    <button onClick={() => handleDelete(sk)}
                                        className="px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-50 transition-colors flex items-center justify-center gap-1">
                                        <Icon name="trash" size={12} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
