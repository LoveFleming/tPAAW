/**
 * CrewManager — Per-Project AI Crew Management UI
 *
 * Phase 3: Full agent editing — Rules / Model / Context
 * - Rules: codename, description, expertise, rolePrompt, guardrails, chatConfig
 * - Model: per-agent model (interactive/EM/autoDispatch) + fallback chain
 * - Context: injectProjectContext + toolGroups selector
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "../utils";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentBuilder from "./AgentBuilder";
import SkillSuggestModal from "./SkillSuggestModal";
import RuSkillManagerModal from "./RuSkillManagerModal";
import SkillPicker from "./SkillPicker";
import { uiConfirm } from "./ui/uiFeedback";

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
  models: Record<string, { primary: string; fallbacks: string[]; emModel: string; autoDispatchModel: string }>;
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
  { id: "tasks", name: "📌 Tasks", desc: "任務管理" },
  { id: "docs", name: "📡 Docs", desc: "文檔生成（cu_refresh）" },
  { id: "dispatch", name: "🚀 Dispatch", desc: "EM 調度" },
  { id: "project-board", name: "🗂️ Project Board", desc: "專案看板維護" }, // 2026-09-06 補齊
  { id: "notes", name: "📝 Notes", desc: "筆記讀寫" }, // 2026-09-06 補齊
];

type DetailTab = "profile" | "model" | "skills" | "memory" | "system";

// 使用者基本資料（2026-10-09 Fleming：personal profile — 照片/名字等，全域 data/crew-preferences.json，跟著使用者走）
interface CrewPrefs {
  displayName?: string;
  avatarUrl?: string;
  greeting?: string;
  tone?: string;
  notes?: string;
}

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
  const [showSuggest, setShowSuggest] = useState(false);
  const [showRuSkills, setShowRuSkills] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("profile");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // Editable state for selected agent
  const [editData, setEditData] = useState<AgentDef | null>(null);
  const [editModel, setEditModel] = useState({ primary: "", fallbacks: [] as string[], emModel: "", autoDispatchModel: "" });
  const [prefs, setPrefs] = useState<CrewPrefs>({});
  const [prefsSaving, setPrefsSaving] = useState(false);
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

  // ── Load 基本資料（personal profile 層，與 .paaw override 分離）──
  useEffect(() => {
    if (!selectedAgentId) { setPrefs({}); return; }
    let alive = true;
    fetch(`${API_BASE}/api/crew-preferences/${selectedAgentId}`)
      .then(r => (r.ok ? r.json() : {}))
      .then(d => { if (alive) setPrefs(d || {}); })
      .catch(() => { if (alive) setPrefs({}); });
    return () => { alive = false; };
  }, [selectedAgentId]);

  const savePrefs = async () => {
    if (!selectedAgentId) return;
    setPrefsSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/api/crew-preferences/${selectedAgentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!resp.ok) throw new Error("save failed");
      setSavedMsg("✅ 基本資料已儲存");
      setTimeout(() => setSavedMsg(""), 2000);
      loadCrew();
    } catch {
      setSavedMsg("❌ 儲存失敗");
      setTimeout(() => setSavedMsg(""), 2000);
    }
    setPrefsSaving(false);
  };

  const uploadAvatar = async (file: File) => {
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch(`${API_BASE}/api/uploads`, { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "upload failed");
      setPrefs(p => ({ ...p, avatarUrl: data.url || data.path || "" }));
    } catch {
      setSavedMsg("❌ 上傳失敗");
      setTimeout(() => setSavedMsg(""), 2000);
    }
  };

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
      setEditModel({ primary: "", fallbacks: [], emModel: "", autoDispatchModel: "" });
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

  // ── Delete custom agent ──
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
          <button onClick={() => setShowSuggest(true)}
            className="mt-2 w-full text-[11px] px-2 py-1.5 rounded-lg border bg-white hover:bg-stone-50 text-stone-600 font-medium"
            style={{ borderColor: t.borderLight }} data-testid="skill-suggest-open">
            {tt("ss.openBtn")}
          </button>
          <button onClick={() => setShowRuSkills(true)}
            className="mt-1.5 w-full text-[11px] px-2 py-1.5 rounded-lg border bg-white hover:bg-stone-50 text-stone-600 font-medium"
            style={{ borderColor: t.borderLight }} data-testid="ru-skills-open">
            {tt("rusk.openBtn")}
          </button>
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
                <div className="text-xs font-semibold text-stone-700 truncate">
                  {(agent as any).displayName || agent.codename}
                  {(agent as any)._hasPrefs && <span className="text-[9px] text-amber-600 ml-1">✏️</span>}
                </div>
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
                  if (!(await uiConfirm("匯入會覆寫現有 crew 設定，確定？", { danger: true }))) return;
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
            </div>

            {/* Detail Tabs */}
            <div className="shrink-0 px-5 flex items-center gap-1 border-b" style={{ borderColor: t.borderLight }}>
              {([
                { key: "profile" as const, label: "🪪 基本資料" },
                { key: "model" as const, label: "🤖 模型" },
                { key: "skills" as const, label: "🔧 技能" },
                { key: "memory" as const, label: "💾 記憶" },
                { key: "system" as const, label: "⚙️ 系統（唯讀）" },
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
              {/* ════ 🔧 技能 Tab（2026-10-09 Fleming：綁定存 RU .paaw；實體種入 {ru}/.paaw/skills/）════ */}
              {detailTab === "skills" && (
                <div className="space-y-3 max-w-2xl">
                  <div className="text-xs text-stone-500 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                    🔧 技能<b>綁定</b>存在 release unit 的 .paaw（跟著這個專案走）；技能<b>實體</b>種入 <code>{'{ru}'}/.paaw/skills/</code>。<br />
                    Agent 對話時，已綁定技能的定義會注入 system prompt。
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-xs text-stone-500">
                      已綁定 <b>{editSkills.length}</b> 個技能
                      {editSkills.length === 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">系統預設（無）</span>}
                    </div>
                    <button onClick={() => setShowRuSkills(true)}
                      className="text-xs px-3 py-1.5 rounded-lg border hover:bg-stone-50"
                      style={{ borderColor: t.borderLight, color: t.accent }}>
                      🧩 RU 技能實例管理（種入 / 跟版 / 客製狀態）
                    </button>
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
                          if (!(await uiConfirm(`清空 ${selectedAgentId} 的記憶？此操作無法復原。`, { danger: true }))) return;
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

              {/* ════ 🪪 基本資料 Tab（2026-10-09 Fleming：personal profile — 照片/名字/開場白/語氣，data/ 跟 user 走）════ */}

              {/* ════ System Tab（唯讀）— 2026-10-09 Fleming：coding app 功能 = module firmware，使用者不可改 ════ */}
              {detailTab === "system" && editData && (
                <div className="space-y-4 max-w-3xl">
                  <div className="text-xs text-stone-400 border-l-2 pl-3 py-1" style={{ borderColor: t.borderLight }}>
                    這些是 coding module 的功能定義（firmware）— 隨 release 走，使用者不可修改。要改 = 改 module。
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div><span className={labelCls}>Codename</span><p className="text-sm text-stone-700">{editData.codename}</p></div>
                    <div><span className={labelCls}>Emoji</span><p className="text-sm text-stone-700">{editData.emoji || "—"}</p></div>
                  </div>
                  <div><span className={labelCls}>描述</span><p className="text-sm text-stone-700">{editData.description || "—"}</p></div>
                  <div><span className={labelCls}>專業能力</span><p className="text-sm text-stone-700 whitespace-pre-wrap">{editData.expertise || "—"}</p></div>

                  <div>
                    <span className={labelCls}>Role Prompt（系統提示詞）<span className="text-stone-400 font-normal ml-2">{editData.rolePrompt.length} chars</span></span>
                    <pre className="text-xs font-mono whitespace-pre-wrap p-3 rounded-lg border bg-stone-50 max-h-72 overflow-y-auto text-stone-600"
                      style={{ borderColor: t.borderLight }}>{editData.rolePrompt}</pre>
                  </div>

                  {editSkills.length > 0 && (
                    <div>
                      <span className={labelCls}>技能</span>
                      <div className="flex flex-wrap gap-1.5">
                        {editSkills.map(sk => (
                          <span key={sk} className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{sk}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}


              {detailTab === "model" && (
                <div className="space-y-5 max-w-2xl">
                  <div className="text-xs text-stone-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    💡 模型設定存在 <b>release unit 的 .paaw/agents/</b>（跟著這個專案走）；<b>留空 = 使用系統預設模型</b>。可為每個 agent 設不同模型做成本優化。
                  </div>

                  {!(editModel.primary || editModel.fallbacks.length || editModel.emModel || editModel.autoDispatchModel) && (
                    <div className="text-[11px] bg-stone-50 border rounded-lg px-3 py-1.5 text-stone-500" style={{ borderColor: t.borderLight }}>
                      ℹ️ 目前全部使用<b>系統預設模型</b>（未在此 release unit 設定）。
                    </div>
                  )}

                  {/* Interactive Model */}
                  <div>
                    <label className={labelCls}>
                      🎙️ Interactive Model（聊天 / 直接對話）
                      {editModel.primary
                        ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-normal">.paaw 已設定</span>
                        : <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-normal">系統預設</span>}
                    </label>
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

                  {/* EM / Auto Dispatch */}
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
                      <label className={labelCls}>🌙 Auto Dispatch Model（夜間批次）</label>
                      <select value={editModel.autoDispatchModel} onChange={e => setEditModel({ ...editModel, autoDispatchModel: e.target.value })}
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
                      <div>🌙 <b>Auto Dispatch</b> → 建議用經濟模型（高頻省成本）</div>
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

              {detailTab === "profile" && (
                <div className="space-y-4 max-w-3xl">
                  <div className="text-xs text-stone-400 border-l-2 pl-3 py-1" style={{ borderColor: t.borderLight }}>
                    照片、名字、開場白、語氣 — personal profile（data/，跟著使用者走）；行為（Role Prompt / 工具）由 coding module 維護。
                  </div>

                  {!(prefs.avatarUrl || prefs.displayName || prefs.tone || prefs.greeting || prefs.notes) && (
                    <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700">
                      ℹ️ 目前尚未設定個人資料 — 以下全部使用<b>系統預設</b>（來自 coding module）。
                    </div>
                  )}

                  {/* Avatar */}
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl border overflow-hidden flex items-center justify-center shrink-0"
                      style={{ borderColor: t.borderLight, backgroundColor: (t.accent || "#10b981") + "11" }}>
                      {prefs.avatarUrl ? (
                        <img src={prefs.avatarUrl.startsWith("/") ? `${API_BASE}${prefs.avatarUrl}` : prefs.avatarUrl}
                          className="w-full h-full object-contain"
                          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : editData?.imageUrl ? (
                        <img src={`${API_BASE}${editData.imageUrl}`} className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-2xl">{editData?.emoji || "👤"}</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <label className={labelCls}>
                        頭像照片（存 data/，跟著使用者走）
                        {prefs.avatarUrl ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-normal">已自訂</span> : <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-normal">系統預設</span>}
                      </label>
                      <div className="flex gap-2">
                        <input
                          value={prefs.avatarUrl || ""}
                          onChange={e => setPrefs(p => ({ ...p, avatarUrl: e.target.value }))}
                          placeholder="/api/uploads/… 或 https://…"
                          className={inputCls} style={inputStyle}
                        />
                        <label className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer shrink-0 hover:bg-stone-50"
                          style={{ borderColor: t.borderLight, color: t.accent }}>
                          📷 上傳
                          <input type="file" accept="image/*" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); }} />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>
                        顯示名稱
                        {prefs.displayName ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-normal">已自訂</span> : <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-normal">系統預設：{editData?.codename || selectedAgent?.id}</span>}
                      </label>
                      <input value={prefs.displayName || ""}
                        onChange={e => setPrefs(p => ({ ...p, displayName: e.target.value }))}
                        placeholder={editData?.codename || selectedAgent?.id}
                        className={inputCls} style={inputStyle} />
                    </div>
                    <div>
                      <label className={labelCls}>
                        語氣
                        {prefs.tone ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-normal">已自訂</span> : <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-normal">系統預設（不調整）</span>}
                      </label>
                      <select value={prefs.tone || ""}
                        onChange={e => setPrefs(p => ({ ...p, tone: e.target.value }))}
                        className={inputCls} style={inputStyle}>
                        <option value="">預設（不調整）</option>
                        <option value="concise">簡潔</option>
                        <option value="detailed">詳細</option>
                        <option value="casual">輕鬆</option>
                        <option value="professional">專業</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>
                      開場白（新對話第一句）
                      {prefs.greeting ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-normal">已自訂</span> : <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-normal">系統預設（無）</span>}
                    </label>
                    <input value={prefs.greeting || ""}
                      onChange={e => setPrefs(p => ({ ...p, greeting: e.target.value }))}
                      placeholder="例：今天要交接什麼？"
                      className={inputCls} style={inputStyle} />
                  </div>

                  <div>
                    <label className={labelCls}>
                      備註（只有你看）
                      {prefs.notes ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-normal">已自訂</span> : <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-normal">系統預設（無）</span>}
                    </label>
                    <textarea value={prefs.notes || ""}
                      onChange={e => setPrefs(p => ({ ...p, notes: e.target.value }))}
                      rows={2}
                      className={cn(inputCls, "resize-none")} style={inputStyle} />
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button onClick={savePrefs} disabled={prefsSaving}
                      className="px-4 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-50"
                      style={{ backgroundColor: t.accent }}>
                      {prefsSaving ? "儲存中..." : "💾 儲存基本資料"}
                    </button>
                    <span className="text-[11px] text-stone-400">即時套用：側欄、組織圖、聊天頁頭像名字</span>
                  </div>
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
      {showSuggest && (
        <SkillSuggestModal rootPath={rootPath}
          theme={{ bg: t.bg, bgMuted: t.bgMuted, borderLight: t.borderLight, accent: t.accent, text: t.text }}
          onClose={() => setShowSuggest(false)}
          onApplied={() => { loadCrew(); onCrewChanged?.(); }} />
      )}
      {showRuSkills && (
        <RuSkillManagerModal rootPath={rootPath}
          theme={{ bg: t.bg, bgMuted: t.bgMuted, borderLight: t.borderLight, accent: t.accent, text: t.text }}
          onClose={() => setShowRuSkills(false)}
          onChanged={() => { loadCrew(); onCrewChanged?.(); }} />
      )}
    </div>
  );
}
