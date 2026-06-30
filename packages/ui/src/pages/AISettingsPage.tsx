/**
 * AISettingsPage — AI Settings Management (by category)
 *
 * Categories: chat, skill-builder, app-builder
 * Files within each category are fully dynamic (CRUD).
 * API: /api/ai-settings/:category/:file
 */

import React, { useEffect, useState, useCallback } from "react";
import { useTheme } from "../theme";

import API_BASE from "../api";

interface CategoryFile {
  file: string;
  label: string;
  icon: string;
  content?: string;
  exists?: boolean;
}

interface Category {
  id: string;
  label: string;
  icon: string;
  desc: string;
  files: CategoryFile[];
}

export default function AISettingsPage() {
  const { info: t } = useTheme();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [files, setFiles] = useState<CategoryFile[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // New file dialog state
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [creating, setCreating] = useState(false);

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);

  // Provider config state
  const [providerTab, setProviderTab] = useState(false);
  const [providerConfig, setProviderConfig] = useState<any>(null);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerSaved, setProviderSaved] = useState(false);

  // Agent config state
  const [agentConfigTab, setAgentConfigTab] = useState(false);
  const [agentConfig, setAgentConfig] = useState<any>(null);
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentConfigSaved, setAgentConfigSaved] = useState(false);

  // Load category list
  useEffect(() => {
    fetch(`${API_BASE}/api/ai-settings`)
      .then(r => r.json())
      .then(data => {
        if (data.categories) {
          setCategories(data.categories);
          setActiveCategory(data.categories[0]?.id || "");
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Load provider config
  const loadProviderConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ai-settings/providers`);
      if (res.ok) {
        const data = await res.json();
        setProviderConfig(data);
      }
    } catch {}
  }, []);

  useEffect(() => { if (providerTab) loadProviderConfig(); }, [providerTab, loadProviderConfig]);

  // Load agent config
  const loadAgentConfigData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ai-settings/agent-config`);
      if (res.ok) {
        const data = await res.json();
        setAgentConfig(data);
      }
    } catch {}
  }, []);

  useEffect(() => { if (agentConfigTab) loadAgentConfigData(); }, [agentConfigTab, loadAgentConfigData]);

  // Load files when category changes
  const loadCategory = useCallback(async (categoryId: string) => {
    if (!categoryId) return;
    try {
      const res = await fetch(`${API_BASE}/api/ai-settings/${categoryId}`);
      if (!res.ok) return;
      const data = await res.json();
      setFiles(data.files || []);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (activeCategory) {
      loadCategory(activeCategory);
      setEditing(null);
      setError(null);
      setShowNewFile(false);
    }
  }, [activeCategory, loadCategory]);

  const startEdit = (file: string) => {
    const f = files.find(x => x.file === file);
    setEditing(file);
    setEditContent(f?.content || "");
    setSaved(false);
    setError(null);
  };

  const save = async () => {
    if (!editing || !activeCategory) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai-settings/${activeCategory}/${editing}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        setFiles(prev => prev.map(f => f.file === editing ? { ...f, content: editContent, exists: true } : f));
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else {
        const data = await res.json();
        setError(data.error || "Save failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditContent("");
    setError(null);
  };

  const handleCreate = async () => {
    let name = newFileName.trim();
    if (!name) return;
    if (!name.endsWith(".md")) name += ".md";
    if (name.includes("..") || name.includes("/")) {
      setError("Invalid filename");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai-settings/${activeCategory}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: name, content: "" }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewFileName("");
        setShowNewFile(false);
        await loadCategory(activeCategory);
        // Auto-open editor for new file
        setTimeout(() => startEdit(name), 200);
      } else {
        setError(data.error || "Create failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (file: string) => {
    setDeleting(file);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai-settings/${activeCategory}/${file}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        if (editing === file) cancelEdit();
        await loadCategory(activeCategory);
      } else {
        setError(data.error || "Delete failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  };

  // ── Styles ──
  const cardBg = "#ffffff";
  const cardBorder = "#e7e5e4";
  const activeBorder = t.accent;
  const muted = "#8a8580";
  const mono = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";
  const dangerColor = "#dc2626";

  if (loading) {
    return (
      <div className="h-full w-full flex-1 min-h-0 flex items-center justify-center" style={{ backgroundColor: t.accentBg }}>
        <span style={{ color: muted }}>Loading...</span>
      </div>
    );
  }

  const activeCat = categories.find(c => c.id === activeCategory);

  return (
    <div className="h-full w-full flex-1 min-h-0 overflow-y-auto" style={{ backgroundColor: t.accentBg }}>
      <div className="px-6 py-5 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "#1c1917" }}>
              ⚙️ AI 設定
            </h2>
            <p className="text-xs mt-0.5" style={{ color: muted }}>
              管理各模組的 AI 設定。修改後即時生效，不需重啟。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeCategory && (
              <button
                onClick={() => { setShowNewFile(true); setError(null); }}
                className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                style={{ background: t.accent, color: "#fff" }}
              >
                + 新增
              </button>
            )}
            {activeCategory && (
              <button
                onClick={() => loadCategory(activeCategory)}
                className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: cardBorder, color: muted }}
              >
                ↻ Refresh
              </button>
            )}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {/* Provider tab */}
          <button
            onClick={() => { setProviderTab(true); setActiveCategory(""); }}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={providerTab
              ? { background: t.accent, color: "#fff", boxShadow: `0 2px 8px ${t.accent}30` }
              : { background: cardBg, color: "#57534e", border: `1px solid ${cardBorder}` }
            }
          >
            <span className="mr-1.5">🔌</span>Provider
          </button>
          {/* Agent Config tab */}
          <button
            onClick={() => { setProviderTab(false); setActiveCategory(""); setAgentConfigTab(true); }}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={agentConfigTab
              ? { background: t.accent, color: "#fff", boxShadow: `0 2px 8px ${t.accent}30` }
              : { background: cardBg, color: "#57534e", border: `1px solid ${cardBorder}` }
            }
          >
            <span className="mr-1.5">⚡</span>Agent Config
          </button>
          {/* Divider */}
          <div className="w-px self-stretch" style={{ background: cardBorder }} />
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => { setActiveCategory(cat.id); setProviderTab(false); setAgentConfigTab(false); }}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
              style={activeCategory === cat.id && !providerTab && !agentConfigTab
                ? { background: t.accent, color: "#fff", boxShadow: `0 2px 8px ${t.accent}30` }
                : { background: cardBg, color: "#57534e", border: `1px solid ${cardBorder}` }
              }
            >
              <span className="mr-1.5">{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Category description */}
        {activeCat && !providerTab && !agentConfigTab && (
          <p className="text-xs mb-4" style={{ color: muted }}>
            {activeCat.desc}
          </p>
        )}

        {/* ── Provider Tab Content ── */}
        {providerTab && providerConfig && (
          <div className="space-y-4 mb-6">
            <p className="text-xs" style={{ color: muted }}>管理 AI Provider 設定。Active provider 會被所有 AI 功能使用。</p>

            {/* Active provider selector */}
            <div className="rounded-xl p-4" style={{ background: cardBg, border: `1.5px solid ${t.accent}` }}>
              <div className="text-sm font-semibold mb-3" style={{ color: "#1c1917" }}>🔴 Active Provider</div>
              <div className="flex gap-2 flex-wrap">
                {Object.keys(providerConfig.providers || {}).map(pid => (
                  <button
                    key={pid}
                    onClick={async () => {
                      const newCfg = { ...providerConfig, active: pid };
                      setProviderConfig(newCfg);
                      setProviderSaving(true);
                      try {
                        await fetch(`${API_BASE}/api/ai-settings/providers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newCfg) });
                        setProviderSaved(true); setTimeout(() => setProviderSaved(false), 2500);
                      } catch {} finally { setProviderSaving(false); }
                    }}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                    style={providerConfig.active === pid
                      ? { background: t.accent, color: "#fff", boxShadow: `0 2px 8px ${t.accent}30` }
                      : { background: "#fafaf9", color: "#57534e", border: `1px solid ${cardBorder}` }
                    }
                  >
                    {providerConfig.providers[pid].name || pid}
                  </button>
                ))}
              </div>
            </div>

            {/* Default model selector */}
            <div className="rounded-xl p-4" style={{ background: cardBg, border: `1.5px solid ${cardBorder}` }}>
              <div className="text-sm font-semibold mb-3" style={{ color: "#1c1917" }}>🎯 Default Model</div>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(providerConfig.providers || {}).flatMap(([pid, p]: [string, any]) =>
                  (p.models || []).map((m: any) => (
                    <button
                      key={`${pid}/${m.id}`}
                      onClick={async () => {
                        const newCfg = { ...providerConfig, defaultModel: m.id };
                        setProviderConfig(newCfg);
                        setProviderSaving(true);
                        try {
                          await fetch(`${API_BASE}/api/ai-settings/providers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newCfg) });
                          setProviderSaved(true); setTimeout(() => setProviderSaved(false), 2500);
                        } catch {} finally { setProviderSaving(false); }
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={providerConfig.defaultModel === m.id
                        ? { background: t.accent, color: "#fff" }
                        : { background: "#fafaf9", color: "#57534e", border: `1px solid ${cardBorder}` }
                      }
                    >
                      <span className="opacity-60 mr-1">{providerConfig.providers[pid].name}</span> {m.name || m.id}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Provider cards */}
            {Object.entries(providerConfig.providers || {}).map(([pid, p]: [string, any]) => (
              <div key={pid} className="rounded-xl overflow-hidden" style={{ background: cardBg, border: `1.5px solid ${providerConfig.active === pid ? t.accent : cardBorder}` }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${cardBorder}` }}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{providerConfig.active === pid ? "🟢" : "⚪"}</span>
                    <div>
                      <div className="text-sm font-semibold" style={{ color: "#1c1917" }}>{p.name}</div>
                      <div className="text-[11px]" style={{ color: muted, fontFamily: mono }}>{pid} · {p.baseURL}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {providerConfig.active === pid && <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={{ background: t.accent + "18", color: t.accent }}>Active</span>}
                    <button onClick={async () => {
                      if (!confirm(`刪除 provider ${pid}？`)) return;
                      const newProviders = { ...providerConfig.providers };
                      delete newProviders[pid];
                      const newCfg = { ...providerConfig, providers: newProviders, active: providerConfig.active === pid ? Object.keys(newProviders)[0] || "" : providerConfig.active };
                      setProviderConfig(newCfg);
                      await fetch(`${API_BASE}/api/ai-settings/providers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newCfg) });
                    }} className="text-xs px-2 py-1 rounded-lg border" style={{ borderColor: cardBorder, color: muted }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = dangerColor; e.currentTarget.style.color = dangerColor; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = cardBorder; e.currentTarget.style.color = muted; }}
                    >🗑</button>
                  </div>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium mb-1" style={{ color: "#57534e" }}>Provider ID</label>
                      <input type="text" value={pid} onChange={e => {
                        const newPid = e.target.value;
                        if (newPid === pid) return;
                        const { [pid]: removed, ...rest } = providerConfig.providers;
                        const newCfg = { ...providerConfig, providers: { ...rest, [newPid]: { ...p } } };
                        if (providerConfig.active === pid) newCfg.active = newPid;
                        setProviderConfig(newCfg);
                      }} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}`, fontFamily: mono }} />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium mb-1" style={{ color: "#57534e" }}>Name</label>
                      <input type="text" value={p.name} onChange={e => {
                        const newCfg = { ...providerConfig, providers: { ...providerConfig.providers, [pid]: { ...p, name: e.target.value } } };
                        setProviderConfig(newCfg);
                      }} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}` }} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "#57534e" }}>Base URL</label>
                    <input type="text" value={p.baseURL} onChange={e => {
                      const newCfg = { ...providerConfig, providers: { ...providerConfig.providers, [pid]: { ...p, baseURL: e.target.value } } };
                      setProviderConfig(newCfg);
                    }} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}`, fontFamily: mono }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "#57534e" }}>API Key</label>
                    <input type="password" value={p.apiKey} onChange={e => {
                      const newCfg = { ...providerConfig, providers: { ...providerConfig.providers, [pid]: { ...p, apiKey: e.target.value } } };
                      setProviderConfig(newCfg);
                    }} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}`, fontFamily: mono }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "#57534e" }}>Models</label>
                    <div className="flex flex-col gap-1.5">
                      {(p.models || []).map((m: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input type="text" value={m.id} onChange={e => {
                            const newModels = [...p.models]; newModels[idx] = { ...m, id: e.target.value };
                            const newCfg = { ...providerConfig, providers: { ...providerConfig.providers, [pid]: { ...p, models: newModels } } };
                            setProviderConfig(newCfg);
                          }} placeholder="model-id" className="flex-1 rounded-lg px-3 py-1.5 text-xs" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}`, fontFamily: mono }} />
                          <input type="text" value={m.name} onChange={e => {
                            const newModels = [...p.models]; newModels[idx] = { ...m, name: e.target.value };
                            const newCfg = { ...providerConfig, providers: { ...providerConfig.providers, [pid]: { ...p, models: newModels } } };
                            setProviderConfig(newCfg);
                          }} placeholder="Display Name" className="flex-1 rounded-lg px-3 py-1.5 text-xs" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}` }} />
                          <button onClick={() => {
                            const newModels = p.models.filter((_: any, i: number) => i !== idx);
                            const newCfg = { ...providerConfig, providers: { ...providerConfig.providers, [pid]: { ...p, models: newModels } } };
                            setProviderConfig(newCfg);
                          }} className="text-xs px-1.5 py-1" style={{ color: dangerColor }}>✕</button>
                        </div>
                      ))}
                      <button onClick={() => {
                        const newModels = [...(p.models || []), { id: "", name: "" }];
                        const newCfg = { ...providerConfig, providers: { ...providerConfig.providers, [pid]: { ...p, models: newModels } } };
                        setProviderConfig(newCfg);
                      }} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: cardBorder, color: t.accent }}>+ Add Model</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Add new provider */}
            <button onClick={() => {
              const newId = `provider-${Date.now().toString(36)}`;
              const newCfg = { ...providerConfig, providers: { ...providerConfig.providers, [newId]: { name: "New Provider", baseURL: "", apiKey: "", models: [] } } };
              setProviderConfig(newCfg);
            }} className="w-full py-3 rounded-xl border-2 border-dashed text-sm font-medium transition-colors" style={{ borderColor: cardBorder, color: muted }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.color = t.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = cardBorder; e.currentTarget.style.color = muted; }}
            >+ 新增 Provider</button>

            {/* Save all */}
            <div className="flex justify-end gap-2">
              {providerSaved && <span className="text-xs font-medium" style={{ color: "#16a34a" }}>✓ Saved</span>}
              <button onClick={async () => {
                setProviderSaving(true);
                try {
                  await fetch(`${API_BASE}/api/ai-settings/providers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(providerConfig) });
                  setProviderSaved(true); setTimeout(() => setProviderSaved(false), 2500);
                } catch {} finally { setProviderSaving(false); }
              }} disabled={providerSaving}
                className="px-5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accentHover})` }}
              >{providerSaving ? "Saving..." : "💾 Save All"}</button>
            </div>
          </div>
        )}

        {/* ── Agent Config Tab Content ── */}
        {agentConfigTab && agentConfig && (
          <div className="space-y-4 mb-6">
            <p className="text-xs" style={{ color: muted }}>Agent 執行參數設定。所有 AI agent（Build、Test、Cron、Workflow）共用這組設定。</p>

            <div className="rounded-xl p-4 space-y-4" style={{ background: cardBg, border: `1.5px solid ${cardBorder}` }}>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={{ color: "#57534e" }}>Max Turns（最大工具呼叫次數）</label>
                  <input type="number" value={agentConfig.maxTurns} onChange={e => setAgentConfig({ ...agentConfig, maxTurns: parseInt(e.target.value) || 100 })}
                    className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}`, fontFamily: mono }} />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={{ color: "#57534e" }}>Timeout（秒）</label>
                  <input type="number" value={agentConfig.timeoutSeconds} onChange={e => setAgentConfig({ ...agentConfig, timeoutSeconds: parseInt(e.target.value) || 1800 })}
                    className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}`, fontFamily: mono }} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={{ color: "#57534e" }}>Bash Timeout（秒）</label>
                  <input type="number" value={agentConfig.bashTimeoutSeconds} onChange={e => setAgentConfig({ ...agentConfig, bashTimeoutSeconds: parseInt(e.target.value) || 300 })}
                    className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}`, fontFamily: mono }} />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={{ color: "#57534e" }}>Shell Timeout（ms）</label>
                  <input type="number" value={agentConfig.shellTimeoutMs} onChange={e => setAgentConfig({ ...agentConfig, shellTimeoutMs: parseInt(e.target.value) || 600000 })}
                    className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#fafaf9", border: `1px solid ${cardBorder}`, fontFamily: mono }} />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {agentConfigSaved && <span className="text-xs font-medium" style={{ color: "#16a34a" }}>✓ Saved</span>}
              <button onClick={async () => {
                setAgentConfigSaving(true);
                try {
                  await fetch(`${API_BASE}/api/ai-settings/agent-config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(agentConfig) });
                  setAgentConfigSaved(true); setTimeout(() => setAgentConfigSaved(false), 2500);
                } catch {} finally { setAgentConfigSaving(false); }
              }} disabled={agentConfigSaving}
                className="px-5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accentHover})` }}
              >{agentConfigSaving ? "Saving..." : "💾 Save"}</button>
            </div>
          </div>
        )}

        {/* File Cards — only show for AI Settings category tabs */}
        {!providerTab && !agentConfigTab && (
        <>
          {/* New file dialog */}
          {showNewFile && (
          <div className="mb-4 rounded-xl p-4" style={{ background: cardBg, border: `1.5px solid ${activeBorder}` }}>
            <div className="text-sm font-semibold mb-2" style={{ color: "#1c1917" }}>新增 AI 設定檔</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setShowNewFile(false); setNewFileName(""); } }}
                placeholder="例：custom-rules.md"
                autoFocus
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: "#fafaf9", border: `1px solid ${cardBorder}`, fontFamily: mono }}
                onFocus={e => e.currentTarget.style.borderColor = t.accent}
                onBlur={e => e.currentTarget.style.borderColor = cardBorder}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newFileName.trim()}
                className="text-xs px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accentHover})` }}
              >
                {creating ? "..." : "建立"}
              </button>
              <button
                onClick={() => { setShowNewFile(false); setNewFileName(""); setError(null); }}
                className="text-xs px-3 py-2 rounded-lg border"
                style={{ borderColor: cardBorder, color: muted }}
              >
                Cancel
              </button>
            </div>
            {error && <div className="text-xs mt-2" style={{ color: dangerColor }}>{error}</div>}
          </div>
          )}

          {/* File Cards */}
        <div className="flex flex-col gap-3">
          {files.length === 0 && !showNewFile && (
            <div className="text-center py-12 text-sm" style={{ color: muted }}>
              這個分類還沒有任何檔案。按「+ 新增」建立第一個。
            </div>
          )}
          {files.map(({ file, label, icon, content, exists }) => {
            const isEditing = editing === file;
            const lineCount = content ? content.split("\n").length : 0;
            const charCount = content ? content.length : 0;

            return (
              <div
                key={file}
                className="rounded-xl overflow-hidden transition-all"
                style={{
                  background: cardBg,
                  border: `1.5px solid ${isEditing ? activeBorder : cardBorder}`,
                  boxShadow: isEditing ? `0 0 0 3px ${t.accent}15` : "none",
                }}
              >
                {/* Card Header */}
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${cardBorder}` }}>
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="text-base">{icon || "📄"}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate" style={{ color: "#1c1917" }}>
                        {label}
                      </div>
                      <div className="text-[11px] flex items-center gap-2" style={{ color: muted }}>
                        <span style={{ fontFamily: mono }}>{file}</span>
                        {content && (
                          <span className="opacity-60">{lineCount} lines · {charCount} chars</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!isEditing ? (
                      <>
                        <button
                          onClick={() => startEdit(file)}
                          className="text-xs px-3 py-1.5 rounded-lg border transition-all font-medium"
                          style={{ borderColor: cardBorder, color: t.accent }}
                          onMouseEnter={e => { e.currentTarget.style.background = t.accent; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = t.accent; }}
                          onMouseLeave={e => { e.currentTarget.style.background = ""; e.currentTarget.style.color = t.accent; e.currentTarget.style.borderColor = cardBorder; }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`刪除 ${file}？`)) handleDelete(file);
                          }}
                          disabled={deleting === file}
                          className="text-xs px-2 py-1.5 rounded-lg border transition-all"
                          style={{ borderColor: cardBorder, color: muted }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = dangerColor; e.currentTarget.style.color = dangerColor; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = cardBorder; e.currentTarget.style.color = muted; }}
                          title="刪除"
                        >
                          {deleting === file ? "..." : "🗑"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={cancelEdit}
                          className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                          style={{ borderColor: cardBorder, color: muted }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={save}
                          disabled={saving}
                          className="text-xs px-4 py-1.5 rounded-lg text-white font-medium transition-all disabled:opacity-50"
                          style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accentHover})` }}
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                        {saved && <span className="text-xs font-medium" style={{ color: "#16a34a" }}>✓ Saved</span>}
                      </>
                    )}
                  </div>
                </div>

                {/* Error */}
                {error && isEditing && (
                  <div className="px-4 py-1.5 text-xs" style={{ color: dangerColor, background: "#fef2f2" }}>{error}</div>
                )}

                {/* Editor */}
                {isEditing && (
                  <div className="p-3">
                    <textarea
                      value={editContent}
                      onChange={e => { setEditContent(e.target.value); setSaved(false); }}
                      placeholder={`Enter content for ${file}...`}
                      className="w-full rounded-lg p-3 text-[13px] leading-relaxed resize-y focus:outline-none"
                      style={{
                        minHeight: 320,
                        background: "#fafaf9",
                        border: `1px solid ${cardBorder}`,
                        fontFamily: mono,
                        color: "#1c1917",
                      } as React.CSSProperties}
                      onFocus={e => e.currentTarget.style.borderColor = t.accent}
                      onBlur={e => e.currentTarget.style.borderColor = cardBorder}
                    />
                  </div>
                )}

                {/* Preview (collapsed) */}
                {!isEditing && content && (
                  <div
                    className="px-4 py-2.5 text-[12px] leading-relaxed max-h-[72px] overflow-hidden"
                    style={{ color: muted, fontFamily: mono, whiteSpace: "pre-wrap" }}
                  >
                    {content.slice(0, 250)}{content.length > 250 ? "..." : ""}
                  </div>
                )}

                {!isEditing && !content && (
                  <div className="px-4 py-3 text-[12px] italic" style={{ color: muted + "80" }}>
                    Empty file — click Edit to add content.
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>)}
      </div>
    </div>
  );
}
