/**
 * CrewManager — Per-Project AI Crew Management UI
 *
 * Shows all agents (default + custom), allows editing rules, model,
 * skills, context, and memory per agent.
 */
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "../utils";
import API_BASE from "../api";
import { useI18n } from "../i18n";

// ── Types ──
interface AgentDef {
  id: string;
  codename: string;
  title: string;
  emoji: string;
  rolePrompt: string;
  description: string;
  expertise: string;
  injectProjectContext: boolean;
  chatConfig?: any;
  toolGroups?: string[];
  guardrails?: any;
  imageUrl?: string;
  _source?: string;
}

interface CrewConfig {
  version: number;
  initialized: boolean;
  globalCrewIds: string[];
  customAgents: string[];
  models: Record<string, { primary: string; fallbacks: string[]; emModel: string; nightShiftModel: string }>;
  skillBindings: Record<string, string[]>;
  contextOverrides: Record<string, any>;
}

interface CrewManagerProps {
  rootPath: string;
  theme: {
    bg: string;
    bgMuted: string;
    borderLight: string;
    border: string;
    accent: string;
    accentLight: string;
    accentText: string;
    text: string;
  };
  onCrewChanged?: () => void; // notify parent to refresh crew list
}

// ── Available models (read from providers) ──
const MODEL_OPTIONS = [
  { value: "", label: "（使用全域預設）" },
  { value: "zai/glm-5.1", label: "GLM 5.1 (zai)" },
  { value: "openrouter/z-ai/glm-5.1", label: "GLM 5.1 (OpenRouter)" },
  { value: "openrouter/deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "openrouter/deepseek/deepseek-v4", label: "DeepSeek V4" },
];

// ── Skill Pool (static for now, will be dynamic in Phase 5) ──
const AVAILABLE_SKILLS = [
  { id: "security-audit", name: "🔒 Security Audit", desc: "安全性審計" },
  { id: "code-review-checklist", name: "📋 Code Review Checklist", desc: "Code Review 檢查表" },
  { id: "react-test-generator", name: "⚛️ React Test Generator", desc: "React 測試生成" },
  { id: "api-docs-generator", name: "📡 API Docs Generator", desc: "API 文檔生成" },
  { id: "translate", name: "🌐 Translate", desc: "翻譯" },
];

type DetailTab = "rules" | "context" | "skills" | "model" | "memory";

// ═══════════════════════════════════════════════
export default function CrewManager({ rootPath, theme: t, onCrewChanged }: CrewManagerProps) {
  const { t: tt } = useI18n();
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [config, setConfig] = useState<CrewConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("rules");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // Editable state for selected agent
  const [editData, setEditData] = useState<AgentDef | null>(null);
  const [editModel, setEditModel] = useState({ primary: "", fallbacks: [] as string[], emModel: "", nightShiftModel: "" });
  const [editSkills, setEditSkills] = useState<string[]>([]);
  const [agentMemory, setAgentMemory] = useState<any[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);

  // ── Load crew ──
  const loadCrew = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/crew?path=${encodeURIComponent(rootPath)}`);
      const data = await res.json();
      if (data.agents) {
        setAgents(data.agents);
        setConfig(data.config);
        if (data.agents.length > 0 && !selectedAgentId) {
          setSelectedAgentId(data.agents[0].id);
        }
      }
    } catch (err) {
      console.error("[CrewManager] Failed to load crew:", err);
    }
    setLoading(false);
  }, [rootPath]);

  useEffect(() => { loadCrew(); }, [loadCrew]);

  // ── Load agent detail when selected ──
  useEffect(() => {
    if (!selectedAgentId || !rootPath) return;
    const agent = agents.find(a => a.id === selectedAgentId);
    if (agent) {
      setEditData({ ...agent });
    }
    // Load model config
    if (config?.models?.[selectedAgentId]) {
      setEditModel(config.models[selectedAgentId]);
    } else {
      setEditModel({ primary: "", fallbacks: [], emModel: "", nightShiftModel: "" });
    }
    // Load skill bindings
    if (config?.skillBindings?.[selectedAgentId]) {
      setEditSkills(config.skillBindings[selectedAgentId]);
    } else {
      setEditSkills([]);
    }
    setSavedMsg("");
  }, [selectedAgentId, agents, config, rootPath]);

  // ── Load memory when tab switches ──
  useEffect(() => {
    if (detailTab !== "memory" || !selectedAgentId || !rootPath) return;
    setMemoryLoading(true);
    const agentShortId = selectedAgentId.replace(/^coding\./, "").replace(/^custom\./, "");
    fetch(`${API_BASE}/api/coding-crew/${selectedAgentId}/memory?cwd=${encodeURIComponent(rootPath)}`)
      .then(r => r.json())
      .then(data => {
        setAgentMemory(data.entries || data.memory || []);
      })
      .catch(() => setAgentMemory([]))
      .finally(() => setMemoryLoading(false));
  }, [detailTab, selectedAgentId, rootPath]);

  // ── Save agent rules ──
  const saveRules = async () => {
    if (!selectedAgentId || !editData || !rootPath) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(selectedAgentId)}?path=${encodeURIComponent(rootPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rolePrompt: editData.rolePrompt,
          description: editData.description,
          codename: editData.codename,
          expertise: editData.expertise,
        }),
      });
      setSavedMsg("✅ 規則已儲存");
      setTimeout(() => setSavedMsg(""), 2000);
      onCrewChanged?.();
    } catch (err: any) {
      setSavedMsg(`❌ ${err.message}`);
    }
    setSaving(false);
  };

  // ── Save model config ──
  const saveModel = async () => {
    if (!selectedAgentId || !rootPath) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(selectedAgentId)}/model?path=${encodeURIComponent(rootPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editModel),
      });
      setSavedMsg("✅ 模型設定已儲存");
      setTimeout(() => setSavedMsg(""), 2000);
    } catch (err: any) {
      setSavedMsg(`❌ ${err.message}`);
    }
    setSaving(false);
  };

  // ── Save skill bindings ──
  const saveSkills = async () => {
    if (!selectedAgentId || !rootPath) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(selectedAgentId)}/skills?path=${encodeURIComponent(rootPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: editSkills }),
      });
      setSavedMsg("✅ 技能綁定已儲存");
      setTimeout(() => setSavedMsg(""), 2000);
    } catch (err: any) {
      setSavedMsg(`❌ ${err.message}`);
    }
    setSaving(false);
  };

  // ── Reset agent ──
  const resetAgent = async () => {
    if (!selectedAgentId || !rootPath) return;
    if (!confirm(`重置 ${selectedAgentId} 為全域預設？這會清除所有客製設定。`)) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(selectedAgentId)}/reset?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.id) {
        setEditData(data);
        setEditModel({ primary: "", fallbacks: [], emModel: "", nightShiftModel: "" });
        setEditSkills([]);
        setSavedMsg("✅ 已重置為預設");
        setTimeout(() => setSavedMsg(""), 2000);
        await loadCrew();
        onCrewChanged?.();
      }
    } catch (err: any) {
      setSavedMsg(`❌ ${err.message}`);
    }
    setSaving(false);
  };

  // ── Delete custom agent ──
  const deleteAgent = async () => {
    if (!selectedAgentId || !rootPath) return;
    if (!selectedAgentId.startsWith("custom.")) return;
    if (!confirm(`刪除 ${selectedAgentId}？此操作無法復原。`)) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(selectedAgentId)}?path=${encodeURIComponent(rootPath)}`, {
        method: "DELETE",
      });
      // Select first remaining agent
      const remaining = agents.filter(a => a.id !== selectedAgentId);
      setSelectedAgentId(remaining[0]?.id || null);
      await loadCrew();
      onCrewChanged?.();
    } catch (err: any) {
      setSavedMsg(`❌ ${err.message}`);
    }
    setSaving(false);
  };

  // ── Create custom agent ──
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAgent, setNewAgent] = useState({ id: "", codename: "", title: "", emoji: "🤖", rolePrompt: "", description: "" });

  const createAgent = async () => {
    if (!rootPath) return;
    const agentId = newAgent.id.trim();
    if (!agentId.startsWith("custom.")) {
      setSavedMsg('❌ ID 必須以 "custom." 開頭');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/crew?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: agentId,
          codename: newAgent.codename || agentId,
          title: newAgent.title || "Custom Agent",
          emoji: newAgent.emoji || "🤖",
          rolePrompt: newAgent.rolePrompt || `You are ${newAgent.codename || "a custom agent"}.`,
          description: newAgent.description || "",
        }),
      });
      const data = await res.json();
      if (data.id) {
        setShowCreateForm(false);
        setNewAgent({ id: "", codename: "", title: "", emoji: "🤖", rolePrompt: "", description: "" });
        await loadCrew();
        setSelectedAgentId(data.id);
        onCrewChanged?.();
      }
    } catch (err: any) {
      setSavedMsg(`❌ ${err.message}`);
    }
    setSaving(false);
  };

  const selectedAgent = agents.find(a => a.id === selectedAgentId);
  const isCustom = selectedAgentId?.startsWith("custom.") || false;

  // ═══════════════════════════════════════════════
  if (loading) {
    return <div className="flex items-center justify-center h-full text-stone-400 text-sm">載入 AI Crew 中...</div>;
  }

  return (
    <div className="flex h-full" style={{ background: t.bg }}>
      {/* ── Left: Agent List ── */}
      <div className="w-64 shrink-0 border-r flex flex-col" style={{ borderColor: t.borderLight, background: t.bgMuted }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: t.borderLight }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-stone-700">👥 AI Crew</h2>
            <span className="text-xs text-stone-400">{agents.length}</span>
          </div>
          <p className="text-[11px] text-stone-400 mt-0.5">專案客製化 Agent 管理</p>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => setSelectedAgentId(agent.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors",
                selectedAgentId === agent.id ? "bg-white" : "hover:bg-white/50"
              )}
              style={selectedAgentId === agent.id ? { borderLeft: `3px solid ${t.accent}` } : { borderLeft: "3px solid transparent" }}
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0"
                style={{ backgroundColor: (t.accent || "#10b981") + "15" }}>
                {agent.imageUrl ? (
                  <img src={`${API_BASE}${agent.imageUrl}`} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  agent.emoji || "🤖"
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-stone-700 truncate">{agent.codename}</div>
                <div className="text-[10px] text-stone-400 truncate">{agent.title}</div>
              </div>
              {agent._source === "custom" && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-600 font-medium">CUSTOM</span>
              )}
            </button>
          ))}
        </div>

        {/* Create agent button */}
        <div className="p-2 border-t" style={{ borderColor: t.borderLight }}>
          {showCreateForm ? (
            <div className="space-y-2 p-2 bg-white rounded-lg border" style={{ borderColor: t.borderLight }}>
              <input
                placeholder="custom.reviewer"
                value={newAgent.id}
                onChange={e => setNewAgent({ ...newAgent, id: e.target.value })}
                className="w-full px-2 py-1 text-xs border rounded font-mono"
                style={{ borderColor: t.borderLight }}
              />
              <input
                placeholder="名字 / Codename"
                value={newAgent.codename}
                onChange={e => setNewAgent({ ...newAgent, codename: e.target.value })}
                className="w-full px-2 py-1 text-xs border rounded"
                style={{ borderColor: t.borderLight }}
              />
              <input
                placeholder="角色 Title (e.g. Reviewer)"
                value={newAgent.title}
                onChange={e => setNewAgent({ ...newAgent, title: e.target.value })}
                className="w-full px-2 py-1 text-xs border rounded"
                style={{ borderColor: t.borderLight }}
              />
              <input
                placeholder="Emoji 🤖"
                value={newAgent.emoji}
                onChange={e => setNewAgent({ ...newAgent, emoji: e.target.value })}
                className="w-full px-2 py-1 text-xs border rounded"
                style={{ borderColor: t.borderLight }}
              />
              <textarea
                placeholder="Role Prompt — 角色職責描述..."
                value={newAgent.rolePrompt}
                onChange={e => setNewAgent({ ...newAgent, rolePrompt: e.target.value })}
                rows={3}
                className="w-full px-2 py-1 text-xs border rounded resize-none"
                style={{ borderColor: t.borderLight }}
              />
              <div className="flex gap-1">
                <button
                  onClick={createAgent}
                  disabled={saving || !newAgent.id.trim()}
                  className="flex-1 px-2 py-1 text-xs font-bold text-white rounded"
                  style={{ backgroundColor: t.accent }}
                >
                  建立
                </button>
                <button
                  onClick={() => { setShowCreateForm(false); setNewAgent({ id: "", codename: "", title: "", emoji: "🤖", rolePrompt: "", description: "" }); }}
                  className="px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 rounded"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCreateForm(true)}
              className="w-full px-3 py-2 text-xs font-medium text-stone-500 hover:bg-white rounded-lg flex items-center justify-center gap-1 transition-colors"
            >
              ➕ 新增 Agent
            </button>
          )}
        </div>
      </div>

      {/* ── Right: Agent Detail ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedAgent && editData ? (
          <>
            {/* Agent Header */}
            <div className="shrink-0 px-5 py-3 border-b flex items-center gap-3"
              style={{ borderColor: t.borderLight, background: `linear-gradient(135deg, ${(t.accent || "#10b981")}08 0%, transparent 100%)` }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                style={{ backgroundColor: (t.accent || "#10b981") + "15", border: `2px solid ${(t.accent || "#10b981")}33` }}>
                {selectedAgent.imageUrl ? (
                  <img src={`${API_BASE}${selectedAgent.imageUrl}`} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  selectedAgent.emoji
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-stone-800">{editData.codename}</span>
                  <span className="text-[11px] text-stone-400">{selectedAgent.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                    style={{ backgroundColor: t.bgMuted, color: t.text }}>
                    {selectedAgent.id}
                  </span>
                </div>
                <p className="text-[11px] text-stone-500 mt-0.5">{editData.description || "(無描述)"}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={resetAgent}
                  disabled={saving}
                  className="text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100 transition-colors"
                  title="重置為全域預設"
                >
                  ↩️ 重置
                </button>
                {isCustom && (
                  <button
                    onClick={deleteAgent}
                    disabled={saving}
                    className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 transition-colors"
                    title="刪除（僅自訂 Agent）"
                  >
                    🗑️ 刪除
                  </button>
                )}
              </div>
            </div>

            {/* Detail Tabs */}
            <div className="shrink-0 px-5 flex items-center gap-1 border-b" style={{ borderColor: t.borderLight }}>
              {([
                { key: "rules" as const, label: "⚙️ 規則", },
                { key: "model" as const, label: "🤖 模型" },
                { key: "skills" as const, label: "🔧 技能" },
                { key: "context" as const, label: "🧠 Context" },
                { key: "memory" as const, label: "💾 記憶" },
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setDetailTab(tab.key)}
                  className={cn(
                    "px-3 py-2 text-xs font-medium border-b-2 transition-colors",
                    detailTab === tab.key
                      ? "text-stone-800"
                      : "text-stone-400 hover:text-stone-600"
                  )}
                  style={detailTab === tab.key ? { borderColor: t.accent } : { borderColor: "transparent" }}
                >
                  {tab.label}
                </button>
              ))}
              <div className="flex-1" />
              {savedMsg && <span className="text-xs text-emerald-600">{savedMsg}</span>}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* ── Rules Tab ── */}
              {detailTab === "rules" && (
                <div className="space-y-4 max-w-3xl">
                  <div>
                    <label className="text-xs font-semibold text-stone-600 mb-1 block">Codename</label>
                    <input
                      value={editData.codename}
                      onChange={e => setEditData({ ...editData, codename: e.target.value })}
                      className="w-full px-3 py-2 text-sm border rounded-lg"
                      style={{ borderColor: t.borderLight }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-600 mb-1 block">描述</label>
                    <input
                      value={editData.description}
                      onChange={e => setEditData({ ...editData, description: e.target.value })}
                      className="w-full px-3 py-2 text-sm border rounded-lg"
                      style={{ borderColor: t.borderLight }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-600 mb-1 block">專業能力</label>
                    <textarea
                      value={editData.expertise}
                      onChange={e => setEditData({ ...editData, expertise: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 text-sm border rounded-lg resize-none"
                      style={{ borderColor: t.borderLight }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-600 mb-1 block">
                      Role Prompt（系統提示詞）
                      <span className="text-stone-400 font-normal ml-2">{editData.rolePrompt.length} chars</span>
                    </label>
                    <textarea
                      value={editData.rolePrompt}
                      onChange={e => setEditData({ ...editData, rolePrompt: e.target.value })}
                      rows={20}
                      className="w-full px-3 py-2 text-xs border rounded-lg resize-y font-mono"
                      style={{ borderColor: t.borderLight }}
                    />
                  </div>
                  <button
                    onClick={saveRules}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-bold text-white rounded-lg"
                    style={{ backgroundColor: t.accent }}
                  >
                    {saving ? "儲存中..." : "💾 儲存規則"}
                  </button>
                </div>
              )}

              {/* ── Model Tab ── */}
              {detailTab === "model" && (
                <div className="space-y-5 max-w-2xl">
                  <div className="text-xs text-stone-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    💡 留空 = 使用全域預設模型。可以為每個 agent 設定不同模型，實現成本優化。
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-stone-600 mb-1 block">
                      🎙️ Interactive Model（聊天 / 直接對話）
                    </label>
                    <select
                      value={editModel.primary}
                      onChange={e => setEditModel({ ...editModel, primary: e.target.value })}
                      className="w-full px-3 py-2 text-sm border rounded-lg bg-white"
                      style={{ borderColor: t.borderLight }}
                    >
                      {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-stone-600 mb-1 block">
                      🚀 EM Dispatch Model（EM 調度執行時）
                    </label>
                    <select
                      value={editModel.emModel}
                      onChange={e => setEditModel({ ...editModel, emModel: e.target.value })}
                      className="w-full px-3 py-2 text-sm border rounded-lg bg-white"
                      style={{ borderColor: t.borderLight }}
                    >
                      {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <p className="text-[11px] text-stone-400 mt-1">空 = 使用 Interactive Model</p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-stone-600 mb-1 block">
                      🌙 Night Shift Model（夜間批次）
                    </label>
                    <select
                      value={editModel.nightShiftModel}
                      onChange={e => setEditModel({ ...editModel, nightShiftModel: e.target.value })}
                      className="w-full px-3 py-2 text-sm border rounded-lg bg-white"
                      style={{ borderColor: t.borderLight }}
                    >
                      {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <p className="text-[11px] text-stone-400 mt-1">建議用便宜模型省成本</p>
                  </div>

                  {/* Cost strategy hint */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="text-xs font-semibold text-blue-700 mb-1">💡 成本策略建議</div>
                    <div className="text-[11px] text-blue-600 space-y-0.5">
                      <div>🔴 <b>架構師/Developer/QA</b> → GLM 5.1（需要品質）</div>
                      <div>🟢 <b>Tester/Doc Writer/Helpdesk</b> → DeepSeek Flash（省成本）</div>
                    </div>
                  </div>

                  <button
                    onClick={saveModel}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-bold text-white rounded-lg"
                    style={{ backgroundColor: t.accent }}
                  >
                    {saving ? "儲存中..." : "💾 儲存模型設定"}
                  </button>
                </div>
              )}

              {/* ── Skills Tab ── */}
              {detailTab === "skills" && (
                <div className="space-y-3 max-w-2xl">
                  <div className="text-xs text-stone-500 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                    🔧 掛載技能後，Skill 的 prompt 會注入到此 Agent 的 system prompt。
                  </div>
                  <div className="space-y-2">
                    {AVAILABLE_SKILLS.map(skill => {
                      const bound = editSkills.includes(skill.id);
                      return (
                        <label
                          key={skill.id}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                            bound ? "bg-indigo-50 border-indigo-200" : "hover:bg-stone-50"
                          )}
                          style={{ borderColor: bound ? undefined : t.borderLight }}
                        >
                          <input
                            type="checkbox"
                            checked={bound}
                            onChange={e => {
                              if (e.target.checked) {
                                setEditSkills([...editSkills, skill.id]);
                              } else {
                                setEditSkills(editSkills.filter(s => s !== skill.id));
                              }
                            }}
                            className="w-4 h-4 accent-indigo-500"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-stone-700">{skill.name}</div>
                            <div className="text-[11px] text-stone-400">{skill.desc}</div>
                          </div>
                          {bound && <span className="text-[10px] text-indigo-500 font-medium">✓ 已掛載</span>}
                        </label>
                      );
                    })}
                  </div>
                  <button
                    onClick={saveSkills}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-bold text-white rounded-lg"
                    style={{ backgroundColor: t.accent }}
                  >
                    {saving ? "儲存中..." : "💾 儲存技能綁定"}
                  </button>
                </div>
              )}

              {/* ── Context Tab ── */}
              {detailTab === "context" && (
                <div className="space-y-3 max-w-2xl">
                  <div className="text-xs text-stone-500 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    🧠 選擇要注入到此 Agent 的 Context（對話時自動附加）
                  </div>
                  <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer hover:bg-stone-50"
                    style={{ borderColor: t.borderLight }}>
                    <input
                      type="checkbox"
                      checked={editData.injectProjectContext}
                      onChange={e => setEditData({ ...editData, injectProjectContext: e.target.checked })}
                      className="w-4 h-4 accent-emerald-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-stone-700">📂 專案知識 (.paaw/)</div>
                      <div className="text-[11px] text-stone-400">PROJECT.md, CODING-STANDARDS.md, KNOWN-ISSUES.md 等</div>
                    </div>
                  </label>
                  <div className="text-xs text-stone-400 px-3 py-2">
                    Feature Map、Coding Standards、Decision Log 等會根據 Agent 的 toolGroups 自動注入。
                  </div>
                  {/* Save context changes via rules save */}
                  <button
                    onClick={saveRules}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-bold text-white rounded-lg"
                    style={{ backgroundColor: t.accent }}
                  >
                    {saving ? "儲存中..." : "💾 儲存 Context 設定"}
                  </button>
                </div>
              )}

              {/* ── Memory Tab ── */}
              {detailTab === "memory" && (
                <div className="space-y-3 max-w-2xl">
                  <div className="text-xs text-stone-500 bg-stone-50 border rounded-lg px-3 py-2" style={{ borderColor: t.borderLight }}>
                    💾 Agent 記憶 — 最近的對話摘要和學到的教訓
                  </div>
                  {memoryLoading ? (
                    <div className="text-sm text-stone-400">載入中...</div>
                  ) : agentMemory.length === 0 ? (
                    <div className="text-sm text-stone-400 py-8 text-center">
                      目前沒有記憶條目。
                      <br />
                      <span className="text-xs">Agent 對話後會自動累積記憶。</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {agentMemory.map((entry, i) => (
                        <div key={i} className="p-3 rounded-lg border" style={{ borderColor: t.borderLight }}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-mono">
                              {entry.type || entry.kind || "memory"}
                            </span>
                            <span className="text-[10px] text-stone-400">
                              {entry.ts || entry.timestamp || ""}
                            </span>
                          </div>
                          <p className="text-xs text-stone-600 whitespace-pre-wrap">{entry.content || entry.text || entry.summary || JSON.stringify(entry)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm">
            選擇一個 Agent 開始編輯
          </div>
        )}
      </div>
    </div>
  );
}
