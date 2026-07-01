import React, { useState, useEffect } from "react";
import { useTheme } from "../theme";
import { useI18n, LOCALE_LABELS, Locale } from "../i18n";

import API_BASE from "../api";
import BackupSettings from "./BackupSettings";

interface ProviderData {
  name: string;
  baseURL: string;
  apiKey: string;
  models: { id: string; name: string }[];
}

interface SettingsPageProps {
  initialTab?: string;
  onTabChange?: (tab: string) => void;
  onProvidersSaved?: () => void;
}

export default function SettingsPage({ initialTab, onTabChange, onProvidersSaved }: SettingsPageProps = {}) {
  const { info: themeInfo } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const [tab, setTabState] = useState<"profile" | "providers" | "agentConfig" | "preferences" | "skill" | "distill" | "tools" | "language" | "backup">((initialTab as any) || "profile");
  const [providers, setProviders] = useState<Record<string, ProviderData>>({});
  const [activeId, setActiveId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Provider CRUD state
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderId, setNewProviderId] = useState("");
  const [showNewProvider, setShowNewProvider] = useState(false);

  // Agent Config state
  const [agentConfig, setAgentConfig] = useState({ maxTurns: 100, timeoutSeconds: 1800, bashTimeoutSeconds: 300, shellTimeoutMs: 600000 });

  // User Preferences state
  const [userPrefs, setUserPrefs] = useState<Record<string, string>>({});

  const [skillConfig, setSkillConfig] = useState({ testTimeout: 600, maxToolCalls: 50 });
  const [distillConfig, setDistillConfig] = useState<any>(null);
  const [distillRunning, setDistillRunning] = useState(false);

  // Sync tab when parent changes initialTab (e.g. redirect to providers)
  useEffect(() => {
    if (initialTab && initialTab !== tab) setTabState(initialTab as typeof tab);
  }, [initialTab]);

  // Tab setter that syncs with parent
  const setTab = (newTab: typeof tab) => { setTabState(newTab); onTabChange?.(newTab); };

  useEffect(() => {
    fetch(`${API_BASE}/api/paaw/providers`)
      .then(r => r.json())
      .then(data => {
        if (data.providers) setProviders(data.providers);
        if (data.active) setActiveId(data.active);
        if (data.defaultModel) setSelectedModel(data.defaultModel);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/ai-settings/agent-config`)
      .then(r => r.json())
      .then(data => {
        if (data && !data.error) setAgentConfig({
          maxTurns: data.maxTurns ?? 100,
          timeoutSeconds: data.timeoutSeconds ?? 1800,
          bashTimeoutSeconds: data.bashTimeoutSeconds ?? 300,
          shellTimeoutMs: data.shellTimeoutMs ?? 600000,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/user/preferences`)
      .then(r => r.json())
      .then(data => { if (data && !data.error) setUserPrefs(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/paaw/user`)
      .then(r => r.json())
      .then(data => { if (data) setProfile(data); })
      .catch(() => {});
  }, []);

  // Load Engine Config
  useEffect(() => {
    fetch(`${API_BASE}/api/paaw/skill-config`)
      .then(r => r.json())
      .then(data => { if (data) setSkillConfig({ testTimeout: data.testTimeout || 600, maxToolCalls: data.maxToolCalls || 50 }); })
      .catch(() => {});
    fetch(`${API_BASE}/api/distill/config`)
      .then(r => r.json())
      .then(data => { if (data) setDistillConfig(data); })
      .catch(() => {});
  }, []);

  const handleApiKeyChange = (pid: string, key: string) => {
    setProviders(prev => ({ ...prev, [pid]: { ...prev[pid], apiKey: key } }));
    setSaved(false);
  };

  const handleBaseURLChange = (pid: string, url: string) => {
    setProviders(prev => ({ ...prev, [pid]: { ...prev[pid], baseURL: url } }));
    setSaved(false);
  };

  const handleProviderField = (pid: string, field: string, value: any) => {
    setProviders(prev => ({ ...prev, [pid]: { ...prev[pid], [field]: value } }));
    setSaved(false);
  };

  const addProvider = () => {
    if (!newProviderId.trim()) return;
    setProviders(prev => ({ ...prev, [newProviderId]: { name: newProviderName || newProviderId, baseURL: "", apiKey: "", models: [] } }));
    setNewProviderId("");
    setNewProviderName("");
    setShowNewProvider(false);
    setSaved(false);
  };

  const removeProvider = (pid: string) => {
    const { [pid]: removed, ...rest } = providers;
    setProviders(rest);
    if (activeId === pid) {
      const remaining = Object.keys(rest);
      setActiveId(remaining.length > 0 ? remaining[0] : "");
    }
    setSaved(false);
  };

  const renameProvider = (oldPid: string, newPid: string) => {
    if (newPid === oldPid || !newPid.trim()) return;
    const p = providers[oldPid];
    const { [oldPid]: removed, ...rest } = providers;
    setProviders({ ...rest, [newPid]: { ...p } });
    if (activeId === oldPid) setActiveId(newPid);
    setSaved(false);
  };

  const addModelToProvider = (pid: string) => {
    const id = prompt("輸入 Model ID（例如 glm-5.1）:");
    if (!id) return;
    const name = prompt("輸入 Model 名稱（例如 GLM 5.1）:") || id;
    setProviders(prev => ({ ...prev, [pid]: { ...prev[pid], models: [...prev[pid].models, { id, name }] } }));
    setSaved(false);
  };

  const removeModelFromProvider = (pid: string, mid: string) => {
    setProviders(prev => ({ ...prev, [pid]: { ...prev[pid], models: prev[pid].models.filter(m => m.id !== mid) } }));
    if (selectedModel === mid) setSelectedModel("");
    setSaved(false);
  };

  const handleSaveProviders = async () => {
    setSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/api/paaw/providers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: activeId, defaultModel: selectedModel, providers }),
      });
      if (resp.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); onProvidersSaved?.(); }
    } catch {}
    setSaving(false);
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/paaw/user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string).split(",")[1];
      setAvatarPreview(ev.target?.result as string);
      try {
        await fetch(`${API_BASE}/api/paaw/avatar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: base64, filename: file.name }),
        });
        setProfile((p: any) => ({ ...p, assistantAvatar: `/api/paaw/avatar/assistant?t=${Date.now()}` }));
      } catch {}
    };
    reader.readAsDataURL(file);
  };

  const handleResetAvatar = () => {
    setProfile((p: any) => ({ ...p, assistantAvatar: "" }));
    setAvatarPreview(null);
    setSaved(false);
  };

  // Avatar display
  const avatarSrc = avatarPreview || (profile?.assistantAvatar ? `${API_BASE}${profile.assistantAvatar}` : null);

  return (
    <div className="h-full w-full flex-1 min-h-0 overflow-y-auto" style={{ backgroundColor: themeInfo.accentBg }}>
      <div className="px-6 py-5 pb-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "#1c1917" }}>⚙️ 設定</h2>
            <p className="text-xs mt-0.5" style={{ color: "#a8a29e" }}>系統設定與偏好管理。修改後即時生效。</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-stone-100 p-1 rounded-xl w-fit flex-wrap">
          <button onClick={() => setTab("profile")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "profile" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            👤 個人資料
          </button>
          <button onClick={() => setTab("providers")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "providers" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            🤖 Provider
          </button>
          <button onClick={() => setTab("agentConfig")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "agentConfig" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            ⚡ Agent 設定
          </button>
          <button onClick={() => setTab("preferences")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "preferences" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            📌 Model 偏好
          </button>
          <button onClick={() => setTab("skill")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "skill" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            🔨 Skill Builder
          </button>
          <button onClick={() => setTab("distill")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "distill" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            ⚗️ AI 蒸餾
          </button>
          <button onClick={() => setTab("tools")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "tools" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            🛠️ System Tools
          </button>
          <button onClick={() => setTab("backup")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "backup" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            💾 備份還原
          </button>
          <button onClick={() => setTab("language")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "language" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            🌐 {t("settings.language")}
          </button>
        </div>

        {/* Profile tab */}
        {tab === "profile" && profile && (
          <div className="space-y-4">
            {/* Assistant avatar */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3 block">助理頭像</label>
              <div className="flex items-center gap-4">
                <div className="relative group">
                  {avatarSrc ? (
                    <img src={avatarSrc} className="w-16 h-16 rounded-full object-cover shadow-md" alt="助理頭像" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center text-2xl shadow-md">🐾</div>
                  )}
                  <label className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="white" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                    </svg>
                  </label>
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </div>
                <div>
                  <p className="text-sm text-stone-600">點擊頭像更換圖片</p>
                  {avatarSrc && (
                    <button onClick={handleResetAvatar} className="text-xs text-rose-400 hover:text-rose-500 mt-1">恢復預設</button>
                  )}
                </div>
              </div>
            </div>

            {/* User info */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">助理名字</label>
                  <input type="text" value={profile.assistantName || "林語晴"} onChange={(e) => { setProfile({ ...profile, assistantName: e.target.value }); setSaved(false); }} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">你的名字</label>
                  <input type="text" value={profile.name || ""} onChange={(e) => { setProfile({ ...profile, name: e.target.value }); setSaved(false); }} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">自我介紹</label>
                  <textarea value={profile.intro || ""} onChange={(e) => { setProfile({ ...profile, intro: e.target.value }); setSaved(false); }} rows={3} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400 resize-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">回覆風格</label>
                  <div className="flex gap-2">
                    {["concise", "detailed", "casual", "formal"].map(s => (
                      <button key={s} onClick={() => { setProfile({ ...profile, style: s }); setSaved(false); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${profile.style === s ? "border-stone-400 bg-stone-50 text-stone-700" : "border-stone-200 text-stone-400 hover:border-stone-300"}`}>
                        {{ concise: "⚡ 簡潔", detailed: "📚 詳細", casual: "😊 輕鬆", formal: "💼 正式" }[s]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <button onClick={handleSaveProfile} disabled={saving} className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
              {saving ? "儲存中..." : saved ? "✅ 已儲存" : "儲存個人資料"}
            </button>
          </div>
        )}

        {/* Provider tab — full CRUD */}
        {tab === "providers" && (
          <div className="space-y-4">
            {/* Active provider selector */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3 block">啟用 Provider</label>
              <div className="flex flex-wrap gap-2">
                {Object.keys(providers).map(pid => (
                  <button key={pid} onClick={() => { setActiveId(pid); if (providers[pid].models.length > 0) setSelectedModel(providers[pid].models[0].id); setSaved(false); }}
                    className="px-3 py-2 rounded-lg text-sm font-medium border transition-all flex items-center gap-2"
                    style={activeId === pid ? { borderColor: themeInfo.accent, background: `${themeInfo.accent}08` } : { borderColor: "#e7e5e4" }}>
                    {activeId === pid && <span className="w-2 h-2 rounded-full" style={{ background: themeInfo.accent }} />}
                    {providers[pid]?.name || pid}
                  </button>
                ))}
              </div>
            </div>

            {/* Provider cards */}
            {Object.entries(providers).map(([pid, p]) => (
              <div key={pid} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="px-5 py-3 flex items-center justify-between border-b border-stone-100" style={activeId === pid ? { background: `${themeInfo.accent}08` } : {}}>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center" style={{ borderColor: activeId === pid ? themeInfo.accent : "#d6d3d1" }}>
                      {activeId === pid && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: themeInfo.accent }} />}
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <input type="text" value={p.name} onChange={e => handleProviderField(pid, "name", e.target.value)} className="text-sm font-semibold text-stone-700 bg-transparent border-b border-transparent hover:border-stone-300 focus:border-stone-400 focus:outline-none w-[160px]" />
                        {activeId === pid && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">啟用中</span>}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[10px] font-mono text-stone-400">ID:</span>
                        <input type="text" value={pid} onChange={e => renameProvider(pid, e.target.value)} className="text-[10px] font-mono text-stone-400 bg-transparent border-b border-transparent hover:border-stone-300 focus:border-stone-400 focus:outline-none w-[120px]" />
                      </div>
                    </div>
                  </div>
                  <button onClick={() => { if (confirm(`刪除 provider「${p.name}」？`)) removeProvider(pid); }}
                    className="text-xs px-2 py-1 rounded-md text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-all">刪除</button>
                </div>
                <div className="px-5 py-3 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-1">Base URL</label>
                      <input type="text" value={p.baseURL} onChange={e => handleProviderField(pid, "baseURL", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-xs font-mono text-stone-500 focus:outline-none focus:border-stone-400" />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-1">API Key</label>
                      <input type="password" value={p.apiKey} onChange={e => handleProviderField(pid, "apiKey", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-xs font-mono focus:outline-none focus:border-stone-400" placeholder="輸入 API Key..." />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Models</label>
                      <button onClick={() => addModelToProvider(pid)} className="text-xs text-stone-500 hover:text-stone-700 px-2 py-0.5 rounded hover:bg-stone-100">+ 新增 Model</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.models.map(m => (
                        <span key={m.id} className="group inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-stone-50 border border-stone-100 text-stone-600">
                          {selectedModel === m.id && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                          {m.name}
                          {activeId === pid && (
                            <button onClick={() => setSelectedModel(m.id)}
                              className={`text-[9px] ml-0.5 px-1 rounded ${selectedModel === m.id ? "text-amber-600 bg-amber-50" : "text-stone-300 hover:text-stone-500"}`}
                              title="設為預設">{selectedModel === m.id ? "✓" : "📌"}</button>
                          )}
                          <button onClick={() => removeModelFromProvider(pid, m.id)}
                            className="text-stone-300 hover:text-rose-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                            title="刪除 model">✕</button>
                        </span>
                      ))}
                      {p.models.length === 0 && <span className="text-xs text-stone-300">尚未新增 Model</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Add new provider */}
            {showNewProvider ? (
              <div className="bg-white rounded-xl border-2 border-amber-200 p-5">
                <div className="flex gap-3 mb-3">
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-1">Provider ID</label>
                    <input type="text" value={newProviderId} onChange={e => setNewProviderId(e.target.value)} placeholder="例如: openrouter" className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono focus:outline-none focus:border-amber-400" autoFocus onKeyDown={e => { if (e.key === "Enter") addProvider(); if (e.key === "Escape") { setShowNewProvider(false); setNewProviderId(""); }}} />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-1">顯示名稱</label>
                    <input type="text" value={newProviderName} onChange={e => setNewProviderName(e.target.value)} placeholder="例如: OpenRouter" className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-amber-400" onKeyDown={e => { if (e.key === "Enter") addProvider(); }} />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setShowNewProvider(false); setNewProviderId(""); setNewProviderName(""); }} className="text-xs px-4 py-2 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50">取消</button>
                  <button onClick={addProvider} disabled={!newProviderId.trim()} className="text-xs px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>新增</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowNewProvider(true)} className="w-full py-3 rounded-xl border-2 border-dashed text-sm font-medium transition-all" style={{ borderColor: "#d6d3d1", color: "#a8a29e" }}>
                + 新增 Provider
              </button>
            )}

            {/* Default model selector */}
            {activeId && providers[activeId]?.models.length > 0 && (
              <div className="bg-white rounded-xl border border-stone-200 p-5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-2">預設 Model</label>
                <select value={selectedModel} onChange={e => { setSelectedModel(e.target.value); setSaved(false); }} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none">
                  {providers[activeId].models.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
                  ))}
                </select>
                <p className="text-xs text-stone-400 mt-1">所有 AI 功能的起始 model，各功能可在「Model 偏好」中自訂</p>
              </div>
            )}

            <button onClick={handleSaveProviders} disabled={saving} className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
              {saving ? "儲存中..." : saved ? "✅ 已儲存" : "儲存 Provider 設定"}
            </button>
          </div>
        )}

        {/* Agent Config tab */}
        {tab === "agentConfig" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <h3 className="text-base font-bold text-stone-700">Agent 執行設定</h3>
              <p className="text-sm text-stone-400 mb-4">控制所有 AI Agent 的執行行為上限</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Max Turns（最大工具呼叫次數）</label>
                  <input type="number" value={agentConfig.maxTurns} onChange={e=>{setAgentConfig(p=>({...p,maxTurns:Math.max(1,parseInt(e.target.value)||20)}));setSaved(false);}} min={1} max={500} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400" />
                  <p className="text-xs text-stone-400 mt-1">AI 在單次任務中最多能呼叫工具幾次（預設 100）</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Timeout（秒）</label>
                  <input type="number" value={agentConfig.timeoutSeconds} onChange={e=>{setAgentConfig(p=>({...p,timeoutSeconds:Math.max(10,parseInt(e.target.value)||120)}));setSaved(false);}} min={10} step={10} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400" />
                  <p className="text-xs text-stone-400 mt-1">任務總超時（預設 1800 = 30 分鐘）</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Bash Timeout（秒）</label>
                  <input type="number" value={agentConfig.bashTimeoutSeconds} onChange={e=>{setAgentConfig(p=>({...p,bashTimeoutSeconds:Math.max(5,parseInt(e.target.value)||60)}));setSaved(false);}} min={5} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400" />
                  <p className="text-xs text-stone-400 mt-1">每個 Shell 指令的超時（預設 300）</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Shell Timeout（ms）</label>
                  <input type="number" value={agentConfig.shellTimeoutMs} onChange={e=>{setAgentConfig(p=>({...p,shellTimeoutMs:Math.max(10000,parseInt(e.target.value)||600000)}));setSaved(false);}} min={10000} step={50000} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400" />
                  <p className="text-xs text-stone-400 mt-1">Shell session 總超時（毫秒，預設 600000 = 10 分鐘）</p>
                </div>
              </div>
            </div>
            <button onClick={async()=>{setSaving(true);try{await fetch(`${API_BASE}/api/ai-settings/agent-config`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(agentConfig)});setSaved(true);setTimeout(()=>setSaved(false),2000);}catch{}setSaving(false);}} disabled={saving} className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50" style={{background:`linear-gradient(135deg,${themeInfo.accent},${themeInfo.accentHover})`}}>{saving?"儲存中...":saved?"✅ 已儲存":"儲存 Agent 設定"}</button>
          </div>
        )}

        {/* Model Preferences tab */}
        {tab === "preferences" && (
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h3 className="text-base font-bold text-stone-700">Model 偏好設定</h3>
            <p className="text-sm text-stone-400 mb-4">各 AI 功能使用的預設 Model，未設定則使用 Provider 的全域預設</p>
            <div className="space-y-4">
              {[{key:"skillBuilder",label:"Skill Builder",desc:"生成和建構 skill 使用的 model"},{key:"coding",label:"Coding",desc:"Coding IDE 助手使用的 model"},{key:"crewChat",label:"Crew 聊天",desc:"Crew 聊天時使用的 model"},{key:"appBuilder",label:"App Builder",desc:"App Builder 執行時使用的 model"}].map(feat=>(
                <div key={feat.key} className="flex items-center justify-between py-2 border-b border-stone-100 last:border-0">
                  <div><span className="text-sm font-medium text-stone-700">{feat.label}</span><p className="text-xs text-stone-400">{feat.desc}</p></div>
                  <div className="w-[50%]">
                    <select value={userPrefs[feat.key]||""} onChange={async(e)=>{const n={...userPrefs,[feat.key]:e.target.value};setUserPrefs(n);await fetch(`${API_BASE}/api/user/preferences`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({[feat.key]:e.target.value})});}} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none">
                      <option value="">（使用預設）</option>
                      {activeId&&providers[activeId]?.models?.map((m:any)=><option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skill Builder tab */}
        {tab === "skill" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3 block">測試執行設定</label>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">⏱️ 測試逾時（秒）</label>
                  <input type="number" value={skillConfig.testTimeout} onChange={e => { setSkillConfig(prev => ({ ...prev, testTimeout: Math.max(60, parseInt(e.target.value) || 600) })); setSaved(false); }} min={60} step={60} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400" />
                  <p className="text-xs text-stone-400 mt-1">預設 600 秒（10 分鐘），最少 60 秒</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">🔧 最大 Session Turn 次數</label>
                  <input type="number" value={skillConfig.maxToolCalls} onChange={e => { setSkillConfig(prev => ({ ...prev, maxToolCalls: Math.max(1, parseInt(e.target.value) || 50) })); setSaved(false); }} min={1} max={200} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400" />
                  <p className="text-xs text-stone-400 mt-1">預設 50，AI Agent 的最大執行步數</p>
                </div>
              </div>
            </div>
            <button onClick={async () => {
              setSaving(true);
              try {
                await fetch(`${API_BASE}/api/paaw/skill-config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(skillConfig) });
                setSaved(true); setTimeout(() => setSaved(false), 2000);
              } catch {} setSaving(false);
            }} disabled={saving} className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
              {saving ? "儲存中..." : saved ? "✅ 已儲存" : "儲存 Skill Builder 設定"}
            </button>
          </div>
        )}

        {/* Distill tab */}
        {tab === "distill" && distillConfig && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3 block">📊 紀錄統計</label>
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center p-3 rounded-lg bg-stone-50">
                  <div className="text-xl font-bold text-stone-700">{Object.keys(distillConfig.stats?.sources || {}).reduce((s, k) => s + (distillConfig.stats?.sources?.[k]?.rawFiles || 0), 0)}</div>
                  <div className="text-[10px] text-stone-400 mt-1">紀錄天數</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-stone-50">
                  <div className="text-xl font-bold text-stone-700">{distillConfig.stats?.totalRawEntries || 0}</div>
                  <div className="text-[10px] text-stone-400 mt-1">互動次數</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-stone-50">
                  <div className="text-xl font-bold text-stone-700">{(distillConfig.stats?.totalRawSize || 0) > 1024 * 1024 ? `${((distillConfig.stats?.totalRawSize || 0) / (1024 * 1024)).toFixed(1)} MB` : `${Math.round((distillConfig.stats?.totalRawSize || 0) / 1024)} KB`}</div>
                  <div className="text-[10px] text-stone-400 mt-1">原始紀錄</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-amber-50">
                  <div className="text-xl font-bold text-amber-600">{distillConfig.stats?.totalKnowledgeFiles || 0}</div>
                  <div className="text-[10px] text-amber-500 mt-1">已蒸餾</div>
                </div>
              </div>
            </div>

            {/* Global toggle */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-semibold text-stone-700">🔬 AI 互動紀錄</label>
                  <p className="text-xs text-stone-400 mt-0.5">記錄所有跟 AI 的互動，包括聊天和 Coding IDE</p>
                </div>
                <button onClick={() => { setDistillConfig({ ...distillConfig, enabled: !distillConfig.enabled }); setSaved(false); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${distillConfig.enabled ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-400"}`}>
                  {distillConfig.enabled ? "✓ 啟用" : "停用"}
                </button>
              </div>
            </div>

            {/* Source toggles */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3 block">記錄來源</label>
              <div className="space-y-3">
                {Object.entries(distillConfig.sources || {}).map(([key, src]: [string, any]) => (
                  <div key={key} className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-stone-700">{src.label || key}</span>
                      <p className="text-xs text-stone-400">{src.description || ""}</p>
                      {distillConfig.stats?.sources?.[key] && (
                        <span className="text-[10px] text-stone-300">{distillConfig.stats.sources[key].rawEntries || 0} 筆紀錄 · {distillConfig.stats.sources[key].knowledgeFiles || 0} 已蒸餾</span>
                      )}
                    </div>
                    <button onClick={() => {
                      const updated = { ...distillConfig };
                      updated.sources = { ...updated.sources, [key]: { ...updated.sources[key], enabled: !updated.sources[key].enabled } };
                      setDistillConfig(updated); setSaved(false);
                    }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${src.enabled ? "bg-blue-100 text-blue-700" : "bg-stone-100 text-stone-400"}`}>
                      {src.enabled ? "✓ 開" : "關"}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Auto distill */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <label className="text-sm font-semibold text-stone-700">⚗️ 自動蒸餾</label>
                  <p className="text-xs text-stone-400">每天自動用 AI 精煉當天的互動紀錄</p>
                </div>
                <button onClick={() => { setDistillConfig({ ...distillConfig, autoDistill: !distillConfig.autoDistill }); setSaved(false); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${distillConfig.autoDistill ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-400"}`}>
                  {distillConfig.autoDistill ? "✓ 開" : "關"}
                </button>
              </div>
              {distillConfig.autoDistill && (
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">排程時間（cron）</label>
                  <div className="flex gap-2 items-center">
                    <input type="text" value={distillConfig.autoDistillSchedule} onChange={e => { setDistillConfig({ ...distillConfig, autoDistillSchedule: e.target.value }); setSaved(false); }} className="flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono" />
                    <span className="text-xs text-stone-400">{distillConfig.autoDistillSchedule === "0 2 * * *" ? "每天 02:00" : distillConfig.autoDistillSchedule === "0 3 * * *" ? "每天 03:00" : ""}</span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {[{l:"02:00",v:"0 2 * * *"},{l:"03:00",v:"0 3 * * *"},{l:"06:00",v:"0 6 * * *"},{l:"每 6 小時",v:"0 */6 * * *"}].map(p => (
                      <button key={p.v} onClick={() => { setDistillConfig({ ...distillConfig, autoDistillSchedule: p.v }); setSaved(false); }}
                        className={`text-xs px-2 py-1 rounded-md border ${distillConfig.autoDistillSchedule === p.v ? "border-amber-400 bg-amber-50 text-amber-600" : "border-stone-200 text-stone-500"}`}>
                        {p.l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Custom distill prompt */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <details>
                <summary className="text-[10px] font-bold text-stone-400 uppercase tracking-wider cursor-pointer flex items-center gap-1">
                  📝 自訂蒸餾提示詞 <span className="text-stone-300">▶</span>
                </summary>
                <textarea value={distillConfig.distillPrompt || ""} onChange={e => { setDistillConfig({ ...distillConfig, distillPrompt: e.target.value }); setSaved(false); }}
                  className="w-full mt-2 px-3 py-2 rounded-lg border border-stone-200 text-xs font-mono resize-none" rows={8} />
              </details>
            </div>

            {/* Manual trigger */}
            <button onClick={async () => {
              setDistillRunning(true);
              try { await fetch(`${API_BASE}/api/distill/run`, { method: "POST" }); } catch {}
              // Reload stats
              try {
                const r = await fetch(`${API_BASE}/api/distill/config`);
                if (r.ok) setDistillConfig(await r.json());
              } catch {}
              setDistillRunning(false);
            }} disabled={distillRunning}
              className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, #F59E0B, #D97706)` }}>
              {distillRunning ? "⏳ 蒸餾中..." : "⚗️ 立即蒸餾"}
            </button>

            <button onClick={async () => {
              setSaving(true);
              try {
                await fetch(`${API_BASE}/api/distill/config`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(distillConfig),
                });
                setSaved(true); setTimeout(() => setSaved(false), 2000);
              } catch {} setSaving(false);
            }} disabled={saving} className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
              {saving ? "儲存中..." : saved ? "✅ 已儲存" : "儲存蒸餾設定"}
            </button>
          </div>
        )}

        {/* Tools tab */}
        {tab === "tools" && <ToolsTab />}

        {/* Backup tab */}
        {tab === "backup" && <BackupSettings />}

        {/* Language tab */}
        {tab === "language" && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-stone-800">🌐 {t("settings.language")}</h3>
            <p className="text-sm text-stone-500">{t("settings.language")}</p>
            <div className="space-y-2">
              {(Object.entries(LOCALE_LABELS) as [Locale, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setLocale(key)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                    locale === key
                      ? "border-stone-800 bg-stone-50 shadow-sm"
                      : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
                  }`
                }
                >
                  <span className="text-2xl">
                    {key === "zh-mix" ? "🇹🇼" : key === "en" ? "🇺🇸" : key === "zh" ? "🇨🇳" : "🇯🇵"}
                  </span>
                  <div>
                    <div className={`font-medium ${locale === key ? "text-stone-800" : "text-stone-600"}`}>{label}</div>
                  </div>
                  {locale === key && <span className="ml-auto text-stone-800">✓</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tools Tab Component ──
function ToolsTab() {
  const { t: tt } = useI18n();
  const [tools, setTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/tool-registry`)
      .then(r => r.json())
      .then(data => { setTools(data.routes || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const toggleEnabled = async (routeId: string, enabled: boolean) => {
    await fetch(`${API_BASE}/api/tool-registry/${routeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    setTools(prev => prev.map(t => t.routeId === routeId ? { ...t, enabled: !enabled } : t));
  };

  const filtered = tools.filter(t =>
    filter === "" ||
    t.name.toLowerCase().includes(filter.toLowerCase()) ||
    t.route.toLowerCase().includes(filter.toLowerCase()) ||
    t.category.toLowerCase().includes(filter.toLowerCase())
  );

  const categories = Array.from(new Set(tools.map(t => t.category))).sort();

  if (loading) return <div className="p-8 text-stone-400">Loading...</div>;

  const totalGenerated = tools.filter(t => t.generated).length;
  const totalTools = tools.length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-stone-800">🛠️ System Tools</h3>
        <p className="text-sm text-stone-500">已註冊的 API Contract，自動產生 AI Tool。</p>
      </div>

      {/* Category stats — show skill coverage */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map(cat => {
          const inCat = tools.filter(t => t.category === cat);
          const hasSkill = inCat.filter(t => t.generated).length;
          const total = inCat.length;
          const allDone = hasSkill === total;
          return (
            <span
              key={cat}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${allDone ? "bg-emerald-50 text-emerald-700" : "bg-stone-50 text-stone-500"}`}
            >
              {cat}: {hasSkill}/{total}
            </span>
          );
        })}
      </div>

      {/* Summary */}
      <div className="text-xs text-stone-400">
        {totalGenerated}/{totalTools} 已有 Skill
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="搜尋工具名稱、路徑、分類..."
          className="flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400"
        />
        <button
          onClick={() => setFilter("")}
          className="px-3 py-2 rounded-lg border border-stone-200 text-sm text-stone-500 hover:bg-stone-50"
        >
          清除
        </button>
      </div>

      {/* Tools list */}
      <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
        {filtered.map(tool => (
          <div key={tool.routeId} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 transition-colors">
            <input
              type="checkbox"
              checked={tool.enabled}
              onChange={() => toggleEnabled(tool.routeId, tool.enabled)}
              className="w-4 h-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500 shrink-0"
            />
            <span className="text-xs font-mono text-stone-500 w-[200px] shrink-0 truncate">{tool.route}</span>
            <span className="flex-1 text-sm font-medium text-stone-700 truncate">{tool.name}</span>
            <span className="px-2 py-0.5 rounded bg-stone-50 text-[10px] text-stone-500 shrink-0">{tool.category}</span>
            {tool.generated ? (
              <span className="text-[10px] font-medium text-emerald-600 shrink-0 w-[60px] text-right">✓ Skill</span>
            ) : (
              <span className="text-[10px] text-stone-300 shrink-0 w-[60px] text-right">—</span>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="p-8 text-center text-stone-400 text-sm">沒有符合條件的工具</div>
        )}
      </div>
    </div>
  );
}
