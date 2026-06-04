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
  const [tab, setTab] = useState<"providers" | "profile">("providers");
  const [providers, setProviders] = useState<Record<string, ProviderData>>({});
  const [activeId, setActiveId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  // Load providers
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

  // Load profile
  useEffect(() => {
    fetch(`${API_BASE}/api/tclaw/user`)
      .then(r => r.json())
      .then(data => { if (data) setProfile(data); })
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
      if (resp.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
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

  return (
    <div className="h-full overflow-y-auto p-6" style={{ backgroundColor: themeInfo.accentBg }}>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-stone-800 mb-6">⚙️ 設定</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-stone-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setTab("providers")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "providers" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}
          >
            🤖 Provider
          </button>
          <button
            onClick={() => setTab("profile")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "profile" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}
          >
            👤 個人資料
          </button>
        </div>

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

        {/* Profile tab */}
        {tab === "profile" && profile && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">名字</label>
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
      </div>
    </div>
  );
}
