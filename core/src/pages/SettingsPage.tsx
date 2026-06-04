import React, { useState, useEffect } from "react";
import { useTheme } from "../theme";

const API_BASE = "http://127.0.0.1:4097";

interface ProviderData {
  name: string;
  baseURL: string;
  apiKey: string;
  models: { id: string; name: string }[];
}

export default function SettingsPage() {
  const { info: themeInfo } = useTheme();
  const [tab, setTab] = useState<"profile" | "providers" | "cli">("profile");
  const [providers, setProviders] = useState<Record<string, ProviderData>>({});
  const [activeId, setActiveId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [installedClis, setInstalledClis] = useState<Record<string, { installed: boolean; bin: string; name: string }>>({});
  const [cliConfig, setCliConfig] = useState({ defaultCli: "", defaultModel: "" });
  const [cliModels, setCliModels] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/tclaw/providers`)
      .then(r => r.json())
      .then(data => {
        if (data.providers) setProviders(data.providers);
        if (data.active) setActiveId(data.active);
        if (data.defaultModel) setSelectedModel(data.defaultModel);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/tclaw/user`)
      .then(r => r.json())
      .then(data => { if (data) setProfile(data); })
      .catch(() => {});
  // Load CLIs
  useEffect(() => {
    fetch(`${API_BASE}/api/clis`)
      .then(r => r.json())
      .then(data => setInstalledClis(data))
      .catch(() => {});
    fetch(`${API_BASE}/api/tclaw/cli-config`)
      .then(r => r.json())
      .then(data => {
        if (data?.configured) setCliConfig({ defaultCli: data.defaultCli || "", defaultModel: data.defaultModel || "" });
      })
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

  const handleSaveProviders = async () => {
    setSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/api/tclaw/providers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: activeId, defaultModel: selectedModel, providers }),
      });
      if (resp.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } catch {}
    setSaving(false);
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/tclaw/user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  const handleCliChange = (cli: string) => {
    setCliConfig(prev => ({ ...prev, defaultCli: cli }));
    setSaved(false);
    fetch(`${API_BASE}/api/models?cli=${cli}`)
      .then(r => r.json())
      .then(data => {
        setCliModels(data.models || []);
        if (data.current) setCliConfig(prev => ({ ...prev, defaultModel: data.current }));
        else if (data.models?.length) setCliConfig(prev => ({ ...prev, defaultModel: data.models[0].id }));
      })
      .catch(() => setCliModels([]));
  };

  const handleSaveCli = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/tclaw/cli-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cliConfig),
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
        await fetch(`${API_BASE}/api/tclaw/avatar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: base64, filename: file.name }),
        });
        setProfile((p: any) => ({ ...p, assistantAvatar: `/api/tclaw/avatar/assistant?t=${Date.now()}` }));
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
    <div className="h-full overflow-y-auto p-6" style={{ backgroundColor: themeInfo.accentBg }}>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-stone-800 mb-6">⚙️ 設定</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-stone-100 p-1 rounded-xl w-fit">
          <button onClick={() => setTab("profile")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "profile" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            👤 個人資料
          </button>
          <button onClick={() => setTab("providers")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "providers" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            🤖 Provider
          </button>
          <button onClick={() => setTab("cli")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "cli" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>
            🛠️ CLI
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

        {/* Provider tab */}
        {tab === "providers" && (
          <div className="space-y-4">
            {Object.entries(providers).map(([pid, p]) => (
              <div key={pid} className="bg-white rounded-xl border-2 p-5 transition-all" style={{ borderColor: activeId === pid ? themeInfo.accent : "#e7e5e4" }}>
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => { setActiveId(pid); if (p.models.length > 0) setSelectedModel(p.models[0].id); setSaved(false); }} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center" style={{ borderColor: activeId === pid ? themeInfo.accent : "#d6d3d1" }}>
                      {activeId === pid && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: themeInfo.accent }} />}
                    </div>
                    <span className="font-semibold text-stone-700">{p.name}</span>
                    {activeId === pid && <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">啟用中</span>}
                  </button>
                  {p.models.length > 0 && activeId === pid && (
                    <select value={selectedModel} onChange={(e) => { setSelectedModel(e.target.value); setSaved(false); }} className="text-xs px-2 py-1 rounded-md border border-stone-200 text-stone-600 focus:outline-none">
                      {p.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">Base URL</label>
                    <input type="text" value={p.baseURL} onChange={(e) => handleBaseURLChange(pid, e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono text-stone-500 focus:outline-none focus:border-stone-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">API Key</label>
                    <input type="password" value={p.apiKey} onChange={(e) => handleApiKeyChange(pid, e.target.value)} placeholder="輸入 API Key..." className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono focus:outline-none focus:border-stone-400" />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={handleSaveProviders} disabled={saving} className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
              {saving ? "儲存中..." : saved ? "✅ 已儲存" : "儲存 Provider 設定"}
            </button>
          </div>
        )}
        {/* CLI tab */}
        {tab === "cli" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3 block">預設 CLI 引擎</label>
              <div className="space-y-2">
                {Object.entries(installedClis).map(([key, info]: [string, any]) => (
                  <button
                    key={key}
                    onClick={() => info.installed && handleCliChange(key)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${!info.installed ? "opacity-50 cursor-not-allowed" : ""}`}
                    style={{ borderColor: cliConfig.defaultCli === key ? themeInfo.accent : "#e7e5e4" }}
                    disabled={!info.installed}
                  >
                    <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: cliConfig.defaultCli === key ? themeInfo.accent : "#d6d3d1" }}>
                      {cliConfig.defaultCli === key && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: themeInfo.accent }} />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-700">{info.name}</p>
                      <p className="text-xs text-stone-400 font-mono">{info.bin}</p>
                    </div>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded ${info.installed ? "text-emerald-500 bg-emerald-50" : "text-stone-400 bg-stone-100"}`}>
                      {info.installed ? "✓ 已安裝" : "未安裝"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {cliConfig.defaultCli && cliModels.length > 0 && (
              <div className="bg-white rounded-xl border border-stone-200 p-5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3 block">預設模型</label>
                <select
                  value={cliConfig.defaultModel}
                  onChange={(e) => { setCliConfig(prev => ({ ...prev, defaultModel: e.target.value })); setSaved(false); }}
                  className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400"
                >
                  {cliModels.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                </select>
              </div>
            )}

            <button onClick={handleSaveCli} disabled={saving} className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}>
              {saving ? "儲存中..." : saved ? "✅ 已儲存" : "儲存 CLI 設定"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
