/**
 * CrewManager — Per-Project AI Crew Management UI
 *
 * Phase 3: Full agent editing — Rules / Model / Context
 * - Rules: codename, description, expertise, rolePrompt, guardrails, chatConfig
 * - Model: per-agent model (interactive/EM/nightShift) + fallback chain
 * - Context: injectProjectContext + toolGroups selector
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "../utils";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentBuilder from "./AgentBuilder";
import SkillPicker from "./SkillPicker";

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
  chatConfig?: {
    greeting?: string;
    temperature?: number;
    maxTokens?: number;
  };
  toolGroups?: string[];
  guardrails?: {
    redirectRules?: string;
    refuseTopics?: string;
  };
  imageUrl?: string;
  _source?: string;
  _updatedAt?: string;
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

interface ProviderModel {
  id: string;
  name: string;
}

interface Provider {
  id: string;
  name: string;
  models: ProviderModel[];
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
  onCrewChanged?: () => void;
}

// ── Static options ──
const TOOL_GROUPS = [
  { id: "core-read", name: "📖 核心讀取", desc: "讀檔案、目錄結構" },
  { id: "core", name: "📖 核心讀寫", desc: "讀寫檔案、目錄結構" },
  { id: "memory", name: "💾 Memory", desc: "記憶讀寫" },
  { id: "decisions", name: "📋 Decisions", desc: "決策記錄" },
  { id: "project", name: "📂 Project Info", desc: "專案資訊、feature map" },
  { id: "project-edit", name: "✏️ Project Edit", desc: "修改專案設定" },
  { id: "notes", name: "📝 Notes", desc: "筆記" },
  { id: "tasks", name: "📌 Tasks", desc: "任務管理" },
  { id: "docs", name: "📡 Docs", desc: "文檔生成" },
  { id: "dispatch", name: "🚀 Dispatch", desc: "EM 調度" },
  { id: "browser", name: "🌐 Browser", desc: "瀏覽器操作" },
];

type DetailTab = "rules" | "model" | "context" | "skills" | "memory";

// Collapsible section wrapper
function Section({ title, icon, children, defaultOpen = false }: { title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden" style={{ borderColor: "#e5e5e5" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50 transition-colors"
      >
        <span>{open ? "▼" : "▶"}</span>
        <span>{icon}</span>
        <span>{title}</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════
export default function CrewManager({ rootPath, theme: t, onCrewChanged }: CrewManagerProps) {
  const { t: tt } = useI18n();
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [config, setConfig] = useState<CrewConfig | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("rules");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // Editable state for selected agent
  const [editData, setEditData] = useState<AgentDef | null>(null);
  const [editModel, setEditModel] = useState({ primary: "", fallbacks: [] as string[], emModel: "", nightShiftModel: "" });
  const [editSkills, setEditSkills] = useState<string[]>([]);
  const [agentMemory, setAgentMemory] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryDirty, setMemoryDirty] = useState(false);
  const [memoryMeta, setMemoryMeta] = useState<{ updatedAt: string | null; size: number }>({ updatedAt: null, size: 0 });

  // ── Build flat model list from providers ──
  const modelOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string; group: string }> = [
      { value: "", label: "（使用全域預設）", group: "" },
    ];
    for (const p of providers) {
      for (const m of p.models) {
        const fullId = `${p.id}/${m.id}`;
        opts.push({ value: fullId, label: `${m.name || m.id}`, group: p.name });
      }
    }
    return opts;
  }, [providers]);

  // ── Load providers ──
  useEffect(() => {
    fetch(`${API_BASE}/api/models`)
      .then(r => r.json())
      .then(data => {
        if (data.providers) setProviders(data.providers);
      })
      .catch(() => {});
  }, []);

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
      // Deep clone to avoid mutating the list state
      setEditData(JSON.parse(JSON.stringify(agent)));
    }
    if (config?.models?.[selectedAgentId]) {
      setEditModel({ ...config.models[selectedAgentId], fallbacks: config.models[selectedAgentId].fallbacks || [] });
    } else {
      setEditModel({ primary: "", fallbacks: [], emModel: "", nightShiftModel: "" });
    }
    if (config?.skillBindings?.[selectedAgentId]) {
      setEditSkills([...config.skillBindings[selectedAgentId]]);
    } else {
      setEditSkills([]);
    }
    setSavedMsg("");
  }, [selectedAgentId, agents, config, rootPath]);

  // ── Load memory when tab switches ──
  useEffect(() => {
    if (detailTab !== "memory" || !selectedAgentId || !rootPath) return;
    setMemoryLoading(true);
    setMemoryDirty(false);
    fetch(`${API_BASE}/api/coding-project/agent-memory?path=${encodeURIComponent(rootPath)}&agentId=${encodeURIComponent(selectedAgentId)}`)
      .then(r => r.json())
      .then(data => {
        setAgentMemory(data.content || "");
        setMemoryMeta({ updatedAt: data.updatedAt, size: data.size || 0 });
      })
      .catch(() => { setAgentMemory(""); setMemoryMeta({ updatedAt: null, size: 0 }); })
      .finally(() => setMemoryLoading(false));
  }, [detailTab, selectedAgentId, rootPath]);

  // ── Deep-clone editData helper ──
  const patchEdit = (patch: Partial<AgentDef>) => setEditData(prev => prev ? { ...prev, ...patch } : prev);
  const patchChatConfig = (key: string, val: any) =>
    setEditData(prev => prev ? { ...prev, chatConfig: { ...(prev.chatConfig || {}), [key]: val } } : prev);
  const patchGuardrails = (key: string, val: string) =>
    setEditData(prev => prev ? { ...prev, guardrails: { ...(prev.guardrails || {}), [key]: val } } : prev);

  // ── Toggle toolGroup ──
  const toggleToolGroup = (gid: string) => {
    if (!editData) return;
    const current = editData.toolGroups || [];
    patchEdit({
      toolGroups: current.includes(gid) ? current.filter(g => g !== gid) : [...current, gid],
    });
  };

  // ── Toggle fallback model ──
  const toggleFallback = (modelId: string) => {
    setEditModel(prev => ({
      ...prev,
      fallbacks: prev.fallbacks.includes(modelId)
        ? prev.fallbacks.filter(f => f !== modelId)
        : [...prev.fallbacks, modelId],
    }));
  };

  // ── Save: Rules (includes all agent definition fields) ──
  const saveRules = async () => {
    if (!selectedAgentId || !editData || !rootPath) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(selectedAgentId)}?path=${encodeURIComponent(rootPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codename: editData.codename,
          description: editData.description,
          expertise: editData.expertise,
          rolePrompt: editData.rolePrompt,
          injectProjectContext: editData.injectProjectContext,
          toolGroups: editData.toolGroups || [],
          guardrails: editData.guardrails || {},
          chatConfig: editData.chatConfig || {},
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setSavedMsg("✅ 規則已儲存");
      setTimeout(() => setSavedMsg(""), 2500);
      onCrewChanged?.();
    } catch (err: any) {
      setSavedMsg(`❌ ${err.message}`);
    }
    setSaving(false);
  };

  // ── Save: Model config ──
  const saveModel = async () => {
    if (!selectedAgentId || !rootPath) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(selectedAgentId)}/model?path=${encodeURIComponent(rootPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editModel),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setSavedMsg("✅ 模型設定已儲存");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (err: any) {
      setSavedMsg(`❌ ${err.message}`);
    }
    setSaving(false);
  };

  // ── Save: Skill bindings ──
  const saveSkills = async () => {
    if (!selectedAgentId || !rootPath) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(selectedAgentId)}/skills?path=${encodeURIComponent(rootPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: editSkills }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedMsg("✅ 技能綁定已儲存");
      setTimeout(() => setSavedMsg(""), 2500);
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
        setEditData(JSON.parse(JSON.stringify(data)));
        setEditModel({ primary: "", fallbacks: [], emModel: "", nightShiftModel: "" });
        setEditSkills([]);
        setSavedMsg("✅ 已重置為預設");
        setTimeout(() => setSavedMsg(""), 2500);
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
      await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(selectedAgentId)}?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" });
      const remaining = agents.filter(a => a.id !== selectedAgentId);
      setSelectedAgentId(remaining[0]?.id || null);
      await loadCrew();
      onCrewChanged?.();
    } catch (err: any) {
      setSavedMsg(`❌ ${err.message}`);
    }
    setSaving(false);
  };

  // ── AgentBuilder wizard ──
  const [showBuilder, setShowBuilder] = useState(false);

  const handleAgentCreated = async (agentId: string) => {
    setShowBuilder(false);
    await loadCrew();
    setSelectedAgentId(agentId);
    onCrewChanged?.();
    setSavedMsg("✅ Agent 建立成功！");
    setTimeout(() => setSavedMsg(""), 3000);
  };

  const selectedAgent = agents.find(a => a.id === selectedAgentId);
  const isCustom = selectedAgentId?.startsWith("custom.") || false;

  // ═══════════════════════════════════════════════
  if (loading) {
    return <div className="flex items-center justify-center h-full text-stone-400 text-sm">載入 AI Crew 中...</div>;
  }

  const inputCls = "w-full px-3 py-2 text-sm border rounded-lg transition-colors focus:outline-none focus:ring-2";
  const inputStyle = { borderColor: t.borderLight };
  const labelCls = "text-xs font-semibold text-stone-600 mb-1 block";

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

        {/* Create agent + Import/Export */}
        <div className="p-2 border-t space-y-1.5" style={{ borderColor: t.borderLight }}>
          <button onClick={() => setShowBuilder(true)} className="w-full px-3 py-2 text-xs font-medium text-white rounded-lg flex items-center justify-center gap-1 transition-colors"
            style={{ backgroundColor: t.accent }}>
            ➕ 新增 Agent
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`${API_BASE}/api/coding-project/crew-export?path=${encodeURIComponent(rootPath)}`);
                  const data = await res.json();
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `crew-${new Date().toISOString().slice(0,10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setSavedMsg("✅ 已匯出");
                  setTimeout(() => setSavedMsg(""), 2000);
                } catch { setSavedMsg("❌ 匯出失敗"); }
              }}
              className="flex-1 px-2 py-1.5 text-[11px] text-stone-600 rounded-lg border hover:bg-stone-50"
              style={{ borderColor: t.borderLight }}
            >📥 匯出</button>
            <label className="flex-1 px-2 py-1.5 text-[11px] text-stone-600 rounded-lg border hover:bg-stone-50 cursor-pointer text-center"
              style={{ borderColor: t.borderLight }}>
              📤 匯入
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (!confirm("匯入會覆寫現有 crew 設定，確定？")) return;
                  const text = await file.text();
                  const data = JSON.parse(text);
                  const res = await fetch(`${API_BASE}/api/coding-project/crew-import`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: rootPath, data }),
                  });
                  const result = await res.json();
                  if (result.ok) {
                    setSavedMsg(`✅ 匯入成功（${result.imported} agents）`);
                    loadCrew();
                    onCrewChanged?.();
                  } else { setSavedMsg("❌ 匯入失敗"); }
                  setTimeout(() => setSavedMsg(""), 3000);
                }}
              />
            </label>
          </div>
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
                ) : (selectedAgent.emoji)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-stone-800">{editData.codename}</span>
                  <span className="text-[11px] text-stone-400">{selectedAgent.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: t.bgMuted, color: t.text }}>{selectedAgent.id}</span>
                  {editData._source === "project" && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-600 font-medium">已客製</span>}
                  {editData._source === "custom" && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-600 font-medium">自訂</span>}
                </div>
                <p className="text-[11px] text-stone-500 mt-0.5">{editData.description || "(無描述)"}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={resetAgent} disabled={saving} className="text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100 transition-colors" title="重置為全域預設">↩️ 重置</button>
                {isCustom && (
                  <button onClick={deleteAgent} disabled={saving} className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 transition-colors" title="刪除（僅自訂）">🗑️ 刪除</button>
                )}
              </div>
            </div>

            {/* Detail Tabs */}
            <div className="shrink-0 px-5 flex items-center gap-1 border-b" style={{ borderColor: t.borderLight }}>
              {([
                { key: "rules" as const, label: "⚙️ 規則" },
                { key: "model" as const, label: "🤖 模型" },
                { key: "context" as const, label: "🧠 Context" },
                { key: "skills" as const, label: "🔧 技能" },
                { key: "memory" as const, label: "💾 記憶" },
              ]).map(tab => (
                <button key={tab.key} onClick={() => setDetailTab(tab.key)}
                  className={cn("px-3 py-2 text-xs font-medium border-b-2 transition-colors", detailTab === tab.key ? "text-stone-800" : "text-stone-400 hover:text-stone-600")}
                  style={detailTab === tab.key ? { borderColor: t.accent } : { borderColor: "transparent" }}>
                  {tab.label}
                </button>
              ))}
              <div className="flex-1" />
              {savedMsg && <span className="text-xs text-emerald-600 animate-pulse">{savedMsg}</span>}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* ════ Rules Tab ════ */}
              {detailTab === "rules" && (
                <div className="space-y-4 max-w-3xl">
                  {/* Basic info */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Codename（名字）</label>
                      <input value={editData.codename} onChange={e => patchEdit({ codename: e.target.value })} className={inputCls} style={inputStyle} />
                    </div>
                    <div>
                      <label className={labelCls}>Emoji</label>
                      <input value={editData.emoji || ""} onChange={e => patchEdit({ emoji: e.target.value })} className={inputCls} style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>描述</label>
                    <input value={editData.description} onChange={e => patchEdit({ description: e.target.value })} className={inputCls} style={inputStyle} />
                  </div>
                  <div>
                    <label className={labelCls}>專業能力</label>
                    <textarea value={editData.expertise} onChange={e => patchEdit({ expertise: e.target.value })} rows={2} className={cn(inputCls, "resize-none")} style={inputStyle} />
                  </div>

                  {/* Role Prompt */}
                  <div>
                    <label className={labelCls}>
                      Role Prompt（系統提示詞）
                      <span className="text-stone-400 font-normal ml-2">{editData.rolePrompt.length} chars</span>
                    </label>
                    <textarea value={editData.rolePrompt} onChange={e => patchEdit({ rolePrompt: e.target.value })} rows={16}
                      className="w-full px-3 py-2 text-xs border rounded-lg resize-y font-mono" style={inputStyle} />
                  </div>

                  {/* Guardrails */}
                  <Section title="Guardrails（護欄）" icon="🛡️">
                    <div className="space-y-3">
                      <div>
                        <label className={labelCls}>轉導規則（什麼問題該轉給誰）</label>
                        <textarea
                          value={editData.guardrails?.redirectRules || ""}
                          onChange={e => patchGuardrails("redirectRules", e.target.value)}
                          rows={4}
                          className="w-full px-2 py-2 text-xs border rounded resize-none"
                          style={inputStyle}
                          placeholder="實作程式碼 → Developer&#10;寫測試 → Tester"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>拒絕主題（不回答的問題）</label>
                        <textarea
                          value={editData.guardrails?.refuseTopics || ""}
                          onChange={e => patchGuardrails("refuseTopics", e.target.value)}
                          rows={3}
                          className="w-full px-2 py-2 text-xs border rounded resize-none"
                          style={inputStyle}
                          placeholder="非技術問題&#10;人事與流程管理"
                        />
                      </div>
                    </div>
                  </Section>

                  {/* Chat Config */}
                  <Section title="Chat Config（聊天行為）" icon="💬">
                    <div className="space-y-3">
                      <div>
                        <label className={labelCls}>問候語（Greeting）</label>
                        <textarea
                          value={editData.chatConfig?.greeting || ""}
                          onChange={e => patchChatConfig("greeting", e.target.value)}
                          rows={3}
                          className="w-full px-2 py-2 text-xs border rounded resize-none"
                          style={inputStyle}
                          placeholder="嗨！我是..."
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>
                            Temperature
                            <span className="text-stone-400 font-normal ml-1">({editData.chatConfig?.temperature ?? 0.4})</span>
                          </label>
                          <input
                            type="range" min="0" max="1" step="0.1"
                            value={editData.chatConfig?.temperature ?? 0.4}
                            onChange={e => patchChatConfig("temperature", parseFloat(e.target.value))}
                            className="w-full accent-emerald-500"
                          />
                          <div className="flex justify-between text-[10px] text-stone-400 mt-0.5">
                            <span>精確</span><span>創意</span>
                          </div>
                        </div>
                        <div>
                          <label className={labelCls}>Max Tokens</label>
                          <select
                            value={editData.chatConfig?.maxTokens ?? 4096}
                            onChange={e => patchChatConfig("maxTokens", parseInt(e.target.value))}
                            className={inputCls} style={inputStyle}
                          >
                            <option value={2048}>2,048</option>
                            <option value={4096}>4,096</option>
                            <option value={8192}>8,192</option>
                            <option value={16384}>16,384</option>
                            <option value={32768}>32,768</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </Section>

                  {/* Source indicator */}
                  {editData._source === "project" && editData._updatedAt && (
                    <div className="text-[11px] text-stone-400 flex items-center gap-1">
                      📝 已客製化 · 最後更新: {new Date(editData._updatedAt).toLocaleString("zh-TW")}
                    </div>
                  )}

                  <button onClick={saveRules} disabled={saving}
                    className="px-4 py-2 text-sm font-bold text-white rounded-lg transition-opacity"
                    style={{ backgroundColor: t.accent, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "儲存中..." : "💾 儲存規則"}
                  </button>
                </div>
              )}

              {/* ════ Model Tab ════ */}
              {detailTab === "model" && (
                <div className="space-y-5 max-w-2xl">
                  <div className="text-xs text-stone-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    💡 留空 = 使用全域預設模型。可為每個 agent 設定不同模型，實現成本優化。
                  </div>

                  {/* Interactive Model */}
                  <div>
                    <label className={labelCls}>🎙️ Interactive Model（聊天 / 直接對話）</label>
                    <select value={editModel.primary} onChange={e => setEditModel({ ...editModel, primary: e.target.value })}
                      className={cn(inputCls, "bg-white")} style={inputStyle}>
                      {modelOptions.map(m => <option key={m.value || "_default"} value={m.value}>{m.group ? `[${m.group}] ` : ""}{m.label}</option>)}
                    </select>
                  </div>

                  {/* Fallback Chain */}
                  <Section title="Fallback Chain（限流時依序切換）" icon="🔄" defaultOpen={!!editModel.fallbacks.length}>
                    {(() => {
                      const fallbackCandidates = modelOptions.filter(m => m.value && m.value !== editModel.primary);
                      return (
                        <div className="space-y-1">
                          <div className="text-[11px] text-stone-400 mb-2">
                            勾選的模型會在主模型限流或失敗時依序切換。
                          </div>
                          {/* Current fallback order */}
                          {editModel.fallbacks.length > 0 && (
                            <div className="mb-2 p-2 bg-stone-50 rounded border" style={{ borderColor: t.borderLight }}>
                              <div className="text-[10px] text-stone-400 mb-1">目前順序:</div>
                              <div className="flex flex-wrap gap-1">
                                {editModel.fallbacks.map((fb, i) => (
                                  <span key={fb} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-white border" style={{ borderColor: t.borderLight }}>
                                    <span className="text-stone-400">{i + 1}.</span>
                                    {fb}
                                    <button onClick={() => toggleFallback(fb)} className="text-red-400 hover:text-red-600 ml-1">✕</button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {fallbackCandidates.map(m => {
                              const checked = editModel.fallbacks.includes(m.value);
                              return (
                                <label key={m.value} className={cn("flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors text-xs", checked ? "bg-emerald-50" : "hover:bg-stone-50")}>
                                  <input type="checkbox" checked={checked} onChange={() => toggleFallback(m.value)} className="w-3.5 h-3.5 accent-emerald-500" />
                                  <span className="flex-1">{m.group ? `[${m.group}] ` : ""}{m.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </Section>

                  {/* EM / Night Shift */}
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className={labelCls}>🚀 EM Dispatch Model（EM 調度執行時）</label>
                      <select value={editModel.emModel} onChange={e => setEditModel({ ...editModel, emModel: e.target.value })}
                        className={cn(inputCls, "bg-white")} style={inputStyle}>
                        {modelOptions.map(m => <option key={`em_${m.value || "_default"}`} value={m.value}>{m.group ? `[${m.group}] ` : ""}{m.label}</option>)}
                      </select>
                      <p className="text-[11px] text-stone-400 mt-1">空 = 使用 Interactive Model</p>
                    </div>
                    <div>
                      <label className={labelCls}>🌙 Night Shift Model（夜間批次）</label>
                      <select value={editModel.nightShiftModel} onChange={e => setEditModel({ ...editModel, nightShiftModel: e.target.value })}
                        className={cn(inputCls, "bg-white")} style={inputStyle}>
                        {modelOptions.map(m => <option key={`ns_${m.value || "_default"}`} value={m.value}>{m.group ? `[${m.group}] ` : ""}{m.label}</option>)}
                      </select>
                      <p className="text-[11px] text-stone-400 mt-1">建議用便宜模型省成本</p>
                    </div>
                  </div>

                  {/* Cost strategy hint */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="text-xs font-semibold text-blue-700 mb-1">💡 成本策略建議</div>
                    <div className="text-[11px] text-blue-600 space-y-0.5">
                      <div>🔴 <b>架構/開發/QA</b> → 用強模型（需要品質）</div>
                      <div>🟢 <b>測試/文件/客服</b> → 用經濟模型（省成本）</div>
                      <div>🌙 <b>Night Shift</b> → 建議用經濟模型（高頻省成本）</div>
                      <div className="text-stone-400 mt-1">以上為建議，實際可用模型取決於你的 Provider 設定</div>
                    </div>
                  </div>

                  <button onClick={saveModel} disabled={saving}
                    className="px-4 py-2 text-sm font-bold text-white rounded-lg"
                    style={{ backgroundColor: t.accent, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "儲存中..." : "💾 儲存模型設定"}
                  </button>
                </div>
              )}

              {/* ════ Context Tab ════ */}
              {detailTab === "context" && (
                <div className="space-y-4 max-w-2xl">
                  <div className="text-xs text-stone-500 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    🧠 選擇要注入到此 Agent 的 Context 來源（對話時自動附加到 system prompt）
                  </div>

                  {/* Project context injection */}
                  <div className={cn("rounded-lg border p-3 transition-colors", editData.injectProjectContext ? "bg-emerald-50 border-emerald-200" : "")}
                    style={!editData.injectProjectContext ? { borderColor: t.borderLight } : {}}>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={editData.injectProjectContext}
                        onChange={e => patchEdit({ injectProjectContext: e.target.checked })}
                        className="w-4 h-4 accent-emerald-500" />
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-stone-700">📂 專案知識 (.paaw/)</div>
                        <div className="text-[11px] text-stone-400">PROJECT.md, CODING-STANDARDS.md, KNOWN-ISSUES.md</div>
                      </div>
                    </label>
                  </div>

                  {/* Tool Groups = which data sources agent can access */}
                  <div>
                    <label className="text-xs font-semibold text-stone-600 mb-2 block">
                      🔧 Tool Groups（資料存取權限）
                      <span className="text-stone-400 font-normal ml-2">{(editData.toolGroups || []).length} 個已啟用</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {TOOL_GROUPS.map(tg => {
                        const enabled = (editData.toolGroups || []).includes(tg.id);
                        return (
                          <label key={tg.id}
                            className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-all",
                              enabled ? "bg-indigo-50 border-indigo-200 shadow-sm" : "hover:bg-stone-50")}
                            style={!enabled ? { borderColor: t.borderLight } : {}}>
                            <input type="checkbox" checked={enabled} onChange={() => toggleToolGroup(tg.id)}
                              className="w-3.5 h-3.5 accent-indigo-500" />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-stone-700">{tg.name}</div>
                              <div className="text-[10px] text-stone-400 truncate">{tg.desc}</div>
                            </div>
                            {enabled && <span className="text-[9px] text-indigo-500">✓</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Context preview */}
                  <div className="bg-stone-50 border rounded-lg p-3" style={{ borderColor: t.borderLight }}>
                    <div className="text-xs font-semibold text-stone-600 mb-2">📋 Context 來源預覽</div>
                    <div className="space-y-1 text-[11px] text-stone-500">
                      {editData.injectProjectContext && <div>✅ .paaw/PROJECT.md</div>}
                      {editData.injectProjectContext && <div>✅ .paaw/CODING-STANDARDS.md</div>}
                      {(editData.toolGroups || []).includes("decisions") && <div>✅ .paaw/decision-log.json</div>}
                      {(editData.toolGroups || []).includes("project") && <div>✅ .paaw/project.json (feature map)</div>}
                      {(editData.toolGroups || []).includes("issues") && <div>✅ .paaw/issues.json</div>}
                      {(editData.toolGroups || []).includes("tasks") && <div>✅ .paaw/tasks.json</div>}
                      {(editData.toolGroups || []).includes("security") && <div>✅ .paaw/security/scan-results.json</div>}
                      {!editData.injectProjectContext && (editData.toolGroups || []).length === 0 && (
                        <div className="text-stone-400">（未啟用任何 Context）</div>
                      )}
                    </div>
                  </div>

                  <button onClick={saveRules} disabled={saving}
                    className="px-4 py-2 text-sm font-bold text-white rounded-lg"
                    style={{ backgroundColor: t.accent, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "儲存中..." : "💾 儲存 Context 設定"}
                  </button>
                </div>
              )}

              {/* ════ Skills Tab ════ */}
              {detailTab === "skills" && (
                <div className="space-y-3 max-w-2xl">
                  <div className="text-xs text-stone-500 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                    🔧 掛載技能後，Skill 的定義會注入到此 Agent 的 system prompt。\n                    Agent 對話時會自動遵循技能的規則和流程。
                  </div>
                  <SkillPicker
                    rootPath={rootPath}
                    selected={editSkills}
                    onChange={setEditSkills}
                    theme={{ bg: t.bg, bgMuted: t.bgMuted, borderLight: t.borderLight, accent: t.accent, text: t.text }}
                  />
                  <button onClick={saveSkills} disabled={saving}
                    className="px-4 py-2 text-sm font-bold text-white rounded-lg"
                    style={{ backgroundColor: t.accent, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "儲存中..." : "💾 儲存技能綁定"}
                  </button>
                </div>
              )}

              {/* ════ Memory Tab ════ */}
              {detailTab === "memory" && (
                <div className="space-y-3 max-w-2xl">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-stone-500">
                      💾 Agent 長期記憶 — 對話後自動累積、也可手動編輯
                    </div>
                    <div className="flex items-center gap-2">
                      {memoryMeta.size > 0 && (
                        <span className="text-[10px] text-stone-400">
                          {memoryMeta.size > 1024 ? `${(memoryMeta.size/1024).toFixed(1)} KB` : `${memoryMeta.size} B`}
                          {memoryMeta.updatedAt && ` · ${new Date(memoryMeta.updatedAt).toLocaleDateString()}`}
                        </span>
                      )}
                      <button
                        onClick={async () => {
                          if (!selectedAgentId || !rootPath) return;
                          if (!confirm(`清空 ${selectedAgentId} 的記憶？此操作無法復原。`)) return;
                          setSaving(true);
                          try {
                            await fetch(`${API_BASE}/api/coding-project/agent-memory?path=${encodeURIComponent(rootPath)}&agentId=${encodeURIComponent(selectedAgentId)}`, { method: "DELETE" });
                            setAgentMemory("");
                            setMemoryMeta({ updatedAt: null, size: 0 });
                            setSavedMsg("記憶已清空");
                            setTimeout(() => setSavedMsg(""), 2000);
                          } catch { setSavedMsg("❌ 清空失敗"); }
                          setSaving(false);
                        }}
                        className="text-[11px] text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                      >🗑 清空</button>
                    </div>
                  </div>
                  {memoryLoading ? (
                    <div className="text-sm text-stone-400 py-8 text-center">載入中...</div>
                  ) : (
                    <>
                      <textarea
                        value={agentMemory}
                        onChange={e => { setAgentMemory(e.target.value); setMemoryDirty(true); }}
                        placeholder={`# 我的記憶\n\n## 專案慣例\n- ...\n\n## 踩過的坑\n- ...\n\n## 使用者偏好\n- ...`}
                        className="w-full h-96 p-3 text-xs font-mono rounded-lg border bg-white resize-y focus:outline-none focus:ring-2"
                        style={{
                          borderColor: memoryDirty ? t.accent : t.borderLight,
                          boxShadow: memoryDirty ? `0 0 0 2px ${t.accentLight}` : undefined,
                        }}
                      />
                      <div className="flex items-center gap-3">
                        <button
                          onClick={async () => {
                            if (!selectedAgentId || !rootPath) return;
                            setSaving(true);
                            try {
                              const res = await fetch(`${API_BASE}/api/coding-project/agent-memory`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ path: rootPath, agentId: selectedAgentId, content: agentMemory }),
                              });
                              const data = await res.json();
                              if (data.ok) {
                                setMemoryDirty(false);
                                setMemoryMeta({ updatedAt: data.updatedAt, size: data.size });
                                setSavedMsg("✅ 記憶已儲存");
                                setTimeout(() => setSavedMsg(""), 2000);
                              } else { setSavedMsg("❌ 儲存失敗"); }
                            } catch { setSavedMsg("❌ 儲存失敗"); }
                            setSaving(false);
                          }}
                          disabled={!memoryDirty || saving}
                          className="px-4 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-50"
                          style={{ backgroundColor: memoryDirty ? t.accent : t.borderLight }}
                        >{saving ? "儲存中..." : "💾 儲存記憶"}</button>
                        {memoryDirty && <span className="text-[11px] text-amber-600">● 未儲存變更</span>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm">選擇一個 Agent 開始編輯</div>
        )}
      </div>

      {/* AgentBuilder Modal */}
      {showBuilder && (
        <AgentBuilder
          rootPath={rootPath}
          theme={{ bg: t.bg, bgMuted: t.bgMuted, borderLight: t.borderLight, border: t.border, accent: t.accent, accentLight: t.accentLight, accentText: t.accentText, text: t.text }}
          onClose={() => setShowBuilder(false)}
          onCreated={handleAgentCreated}
        />
      )}
    </div>
  );
}
