import React, { useState, useEffect, useCallback } from "react";
import { SkillDefinition, UserInput } from "../types";
import Icon from "../components/Icon";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";

import API from "../api";

const EMPTY_INPUT: UserInput = { id: "", label: "", description: "", placeholder: "", required: false };

function buildSkillMd(fields: {
    id: string; name: string; version: string; description: string; category: string;
    tags: string; useSkills: string; usePhysicalSkills: string; userInputs: UserInput[]; body: string;
}): string {
    const lines = ["---"];
    lines.push(`id: ${fields.id}`);
    lines.push(`name: ${fields.name}`);
    lines.push(`version: ${fields.version || "1.0.0"}`);
    lines.push(`description: ${fields.description}`);
    if (fields.category) lines.push(`category: ${fields.category}`);
    if (fields.tags) {
        const tags = fields.tags.split(",").map(t => t.trim()).filter(Boolean);
        if (tags.length) { lines.push("tags:"); tags.forEach(t => lines.push(`  - ${t}`)); }
    }
    if (fields.useSkills) {
        const skills = fields.useSkills.split(",").map(t => t.trim()).filter(Boolean);
        if (skills.length) { lines.push("useSkills:"); skills.forEach(s => lines.push(`  - ${s}`)); }
    }
    if (fields.usePhysicalSkills) {
        const pskills = fields.usePhysicalSkills.split(",").map(t => t.trim()).filter(Boolean);
        if (pskills.length) { lines.push("usePhysicalSkills:"); pskills.forEach(s => lines.push(`  - ${s}`)); }
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
  const { t: tt } = useI18n();
    const { info: t } = useTheme();
    const [skills, setSkills] = useState<SkillDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    // Form
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
    const [toast, setToast] = useState<string | null>(null);

    const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

    const loadSkills = useCallback(() => {
        setLoading(true);
        fetch(`${API}/api/skills`).then(r => r.json()).then((data: SkillDefinition[]) => { setSkills(data); setLoading(false); }).catch(() => setLoading(false));
    }, []);
    useEffect(() => { loadSkills(); }, [loadSkills]);

    const startEdit = (sk: SkillDefinition) => {
        setSelectedSkill(sk); setIsCreating(false);
        setFId(sk.id); setFName(sk.name); setFVersion(sk.version || "1.0.0");
        setFDesc(sk.description); setFCategory(sk.category || ""); setFTags("");
        setFUseSkills((sk.useSkills || []).join(", ")); setFUsePhysicalSkills((sk.usePhysicalSkills || []).join(", "));
        setFUserInputs(sk.userInputs || []); setFBody(sk.skillPrompt || ""); setError("");
    };

    const startCreate = () => {
        setSelectedSkill(null); setIsCreating(true);
        setFId(""); setFName(""); setFVersion("1.0.0"); setFDesc(""); setFCategory("");
        setFTags(""); setFUseSkills(""); setFUsePhysicalSkills(""); setFUserInputs([]);
        setFBody(""); setError("");
    };

    const cancelEdit = () => { setSelectedSkill(null); setIsCreating(false); setError(""); };

    const addInput = () => setFUserInputs([...fUserInputs, { ...EMPTY_INPUT, id: `input-${Date.now()}` }]);
    const removeInput = (idx: number) => setFUserInputs(fUserInputs.filter((_, i) => i !== idx));
    const updateInput = (idx: number, field: keyof UserInput, value: any) => {
        const updated = [...fUserInputs]; updated[idx] = { ...updated[idx], [field]: value };
        if (field === "label" && updated[idx].id.startsWith("input-"))
            updated[idx].id = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || updated[idx].id;
        setFUserInputs(updated);
    };

    const handleSave = async () => {
        setError("");
        if (!fId.trim()) { setError("Skill ID is required"); return; }
        if (!fName.trim()) { setError("Name is required"); return; }
        const content = buildSkillMd({
            id: fId.trim(), name: fName.trim(), version: fVersion.trim(), description: fDesc.trim(),
            category: fCategory.trim(), tags: fTags.trim(), useSkills: fUseSkills.trim(),
            usePhysicalSkills: fUsePhysicalSkills.trim(), userInputs: fUserInputs, body: fBody,
        });
        setSaving(true);
        try {
            const resp = await fetch(`${API}/api/skills/${fId.trim()}`, {
                method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
            });
            if (!resp.ok) { const data = await resp.json(); throw new Error(data.error || "Save failed"); }
            setSelectedSkill(null); setIsCreating(false); loadSkills();
            showToast(tt("skillsPage.saved"));
        } catch (err: any) { setError(err.message); } finally { setSaving(false); }
    };

    const handleDelete = async (sk: SkillDefinition) => {
        if (!confirm(`確定要刪除 ${sk.name} (${sk.id})？`)) return;
        await fetch(`${API}/api/skills/${sk.id}`, { method: "DELETE" });
        loadSkills(); if (selectedSkill?.id === sk.id) cancelEdit();
        showToast("🗑 已刪除");
    };

    // ── Export skill ──
    const handleExportSkill = async (sk: SkillDefinition, e?: React.MouseEvent) => {
        e?.stopPropagation();
        try {
            const resp = await fetch(`${API}/api/skills/${sk.id}/export`);
            if (!resp.ok) { const d = await resp.json(); alert(`匯出失敗: ${d.error}`); return; }
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `${sk.id}-skill.json`; a.click();
            URL.revokeObjectURL(url);
            showToast(`📦 ${sk.id} 已匯出`);
        } catch (err: any) { alert(`匯出失敗: ${err.message}`); }
    };

    // ── Import skill ──
    const handleImportSkill = async (file: File) => {
        try {
            const text = await file.text();
            const bundle = JSON.parse(text);
            const resp = await fetch(`${API}/api/skills/import`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bundle),
            });
            const data = await resp.json();
            if (data.ok) { showToast(`✅ ${data.message}`); loadSkills(); } else { alert(`❌ ${data.error}`); }
        } catch (err: any) { alert(`❌ 匯入失敗: ${err.message}`); }
    };

    const hasRightPanel = selectedSkill || isCreating;
    const inputCls = "w-full mt-1 px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-1";

    return (
        <div className="flex h-full w-full relative bg-stone-50">
            {toast && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg shadow-lg">{toast}</div>}

            {/* Left: Skill List */}
            <div className="w-56 border-r border-stone-200 bg-white flex flex-col">
                <div className="p-3 border-b border-stone-200 flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-stone-700">⚡ Skills</h3>
                    <button onClick={startCreate} className="text-violet-600 hover:text-violet-800 text-sm font-medium">＋</button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {loading && <div className="text-xs text-stone-400 text-center py-8">Loading...</div>}
                    {!loading && skills.length === 0 && <div className="text-xs text-stone-400 text-center py-8">還沒有 Skill</div>}
                    {skills.map(sk => (
                        <button key={sk.id} onClick={() => startEdit(sk)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedSkill?.id === sk.id ? "bg-violet-100 text-violet-800 font-medium" : "hover:bg-stone-50 text-stone-600"}`}>
                            <div className="flex items-center gap-2">
                                <span className="text-xs">{sk.kind === 'physical-skill' ? '📦' : '📝'}</span>
                                <span className="truncate">{sk.name}</span>
                            </div>
                            <div className="text-[10px] text-stone-400 ml-5 truncate font-mono">{sk.id}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Center: Skill Cards */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-stone-200 bg-white shrink-0">
                    <h2 className="font-semibold text-sm text-stone-700">⚡ Skills</h2>
                    <span className="text-xs text-stone-400">{skills.length} skills</span>
                    <span className="text-[10px] text-stone-300">input-prompt + physical-skill</span>
                    <div className="ml-auto flex items-center gap-2">
                        {/* Import Skill */}
                        <label className="text-xs px-2.5 py-1 rounded-lg border cursor-pointer hover:bg-stone-50 transition-colors flex items-center gap-1 text-stone-600" style={{ borderColor: "#d6d3d1" }}>
                            📥 匯入
                            <input type="file" accept=".json" className="hidden" onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                await handleImportSkill(file);
                                e.target.value = "";
                            }} />
                        </label>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    {!loading && skills.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full">
                            <div className="text-4xl mb-3">⚡</div>
                            <div className="text-stone-500 font-semibold mb-1">還沒有任何 Skill</div>
                            <button onClick={startCreate} className="mt-2 px-5 py-2 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: t.accent }}>建立第一個 Skill</button>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {skills.map(sk => (
                            <div key={sk.id} onClick={() => startEdit(sk)}
                                className="rounded-xl border shadow-sm overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer relative group" style={{ borderColor: t.accentBorder }}>
                                <div className="p-3">
                                    <div className="flex items-start justify-between mb-1.5">
                                        <div>
                                            <div className="font-bold text-sm text-stone-800">{sk.name}</div>
                                            <div className="text-[10px] text-stone-400 font-mono">{sk.id}</div>
                                        </div>
                                        {sk.category && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: t.accentBg, color: t.accent }}>{sk.category}</span>}
                                    </div>
                                    <p className="text-xs text-stone-500 line-clamp-2 mb-2">{sk.description}</p>
                                    <div className="flex items-center gap-1.5 text-[10px] text-stone-400">
                                        <span className={`px-1.5 py-0.5 rounded font-semibold ${sk.kind === 'physical-skill' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{sk.kind === 'physical-skill' ? '📦 實體' : '📝 輸入'}</span>
                                        {(sk.userInputs?.length || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-stone-100">{sk.userInputs.length} inputs</span>}
                                        <span className="ml-auto">{sk.version || "1.0.0"}</span>
                                    </div>
                                </div>
                                {/* Export button — appears on hover */}
                                <button onClick={(e) => handleExportSkill(sk, e)}
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-stone-300 hover:text-blue-500 text-xs"
                                    title={tt("skillsPage.exportSkill")}>📦</button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right: Skill Detail / Edit Panel */}
            {hasRightPanel && (
                <div className="w-80 border-l border-stone-200 bg-white flex flex-col">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 bg-stone-50">
                        <span className="text-sm font-semibold text-stone-800">{isCreating ? tt("skillsPage.newSkill") : `🔧 ${selectedSkill?.name}`}</span>
                        <button onClick={cancelEdit} className="text-stone-400 hover:text-stone-600 text-sm">✕</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">{error}</div>}

                        <div>
                            <label className="text-xs font-semibold text-stone-500 block mb-1">Skill ID *</label>
                            <input value={fId} onChange={e => setFId(e.target.value)} disabled={!isCreating}
                                className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-stone-50" placeholder="my-skill-id" />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-stone-500 block mb-1">名稱 *</label>
                            <input value={fName} onChange={e => setFName(e.target.value)}
                                className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" placeholder="My Skill" />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-stone-500 block mb-1">{tt("common.description")}</label>
                            <input value={fDesc} onChange={e => setFDesc(e.target.value)}
                                className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" placeholder={tt("skillsPage.oneLineDesc")} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs font-semibold text-stone-500 block mb-1">Version</label>
                                <input value={fVersion} onChange={e => setFVersion(e.target.value)}
                                    className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" placeholder="1.0.0" />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-stone-500 block mb-1">Category</label>
                                <input value={fCategory} onChange={e => setFCategory(e.target.value)}
                                    className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" placeholder="tutorial" />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-stone-500 block mb-1">Tags (逗號分隔)</label>
                            <input value={fTags} onChange={e => setFTags(e.target.value)}
                                className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" placeholder="guide, onboarding" />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-stone-500 block mb-1">引用技能 (逗號分隔)</label>
                            <input value={fUseSkills} onChange={e => setFUseSkills(e.target.value)}
                                className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" placeholder="other-skill-id" />
                        </div>

                        {/* User Inputs */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-xs font-semibold text-stone-500">輸入欄位 ({fUserInputs.length})</label>
                                <button onClick={addInput} className="text-xs text-violet-600 hover:text-violet-800 font-medium">{tt("vibe.apiAddHeader")}</button>
                            </div>
                            <div className="space-y-2">
                                {fUserInputs.map((inp, idx) => (
                                    <div key={inp.id + idx} className="border border-stone-200 rounded-lg p-2.5 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-mono text-stone-400">{inp.id || `input-${idx}`}</span>
                                            <button onClick={() => removeInput(idx)} className="text-stone-400 hover:text-red-500 text-xs">✕</button>
                                        </div>
                                        <input value={inp.label} onChange={e => updateInput(idx, "label", e.target.value)}
                                            className="w-full px-2 py-1 text-xs bg-white border border-stone-200 rounded" placeholder="Label" />
                                        <input value={inp.description} onChange={e => updateInput(idx, "description", e.target.value)}
                                            className="w-full px-2 py-1 text-xs bg-white border border-stone-200 rounded" placeholder="Description" />
                                        <div className="flex items-center gap-3">
                                            <label className="flex items-center gap-1 text-[10px] text-stone-500 cursor-pointer">
                                                <input type="checkbox" checked={inp.required} onChange={e => updateInput(idx, "required", e.target.checked)} className="rounded" /> Required
                                            </label>
                                            <label className="flex items-center gap-1 text-[10px] text-stone-500 cursor-pointer">
                                                <input type="checkbox" checked={inp.multiline || false} onChange={e => updateInput(idx, "multiline", e.target.checked)} className="rounded" /> Multiline
                                            </label>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Skill Prompt */}
                        <div>
                            <label className="text-xs font-semibold text-stone-500 block mb-1">Skill Prompt</label>
                            <textarea value={fBody} onChange={e => setFBody(e.target.value)}
                                className="w-full px-3 py-2 text-xs font-mono bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
                                rows={8} placeholder="# Skill Name\n\n## 目的\n\n## 步驟\n\n## 產出" />
                        </div>
                    </div>

                    {/* Footer actions */}
                    <div className="px-4 py-3 border-t border-stone-200 space-y-2">
                        <button onClick={handleSave} disabled={saving}
                            className="w-full py-1.5 text-xs rounded-lg font-medium bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50">
                            {saving ? tt("skillsPage.saving") : isCreating ? tt("skillsPage.createSkill") : tt("skillsPage.saveChanges")}
                        </button>
                        {!isCreating && selectedSkill && (
                            <div className="flex gap-2">
                                <button onClick={() => handleExportSkill(selectedSkill)}
                                    className="flex-1 py-1.5 text-xs rounded-lg text-blue-600 hover:bg-blue-50 border border-blue-200 transition-colors">
                                    📦 匯出
                                </button>
                                <button onClick={() => handleDelete(selectedSkill)}
                                    className="flex-1 py-1.5 text-xs rounded-lg text-red-600 hover:bg-red-50 border border-red-200 transition-colors">
                                    🗑 刪除
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
