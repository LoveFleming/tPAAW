import React, { useState, useEffect } from "react";
import { useTheme } from "../theme";

const API_BASE = "http://127.0.0.1:4097";

interface Props {
  onComplete: () => void;
}

interface ProviderData {
  name: string;
  baseURL: string;
  apiKey: string;
  models: { id: string; name: string }[];
}

export default function ProviderSetupPage({ onComplete }: Props) {
  const { info: themeInfo } = useTheme();
  const [providers, setProviders] = useState<Record<string, ProviderData>>({});
  const [activeId, setActiveId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/tagent/providers`)
      .then(r => r.json())
      .then(data => {
        if (data.providers) setProviders(data.providers as Record<string, ProviderData>);
        if (data.active) setActiveId(data.active);
        if (data.defaultModel) setSelectedModel(data.defaultModel);
      })
      .catch(() => {});
  }, []);

  const handleApiKeyChange = (pid: string, key: string) => {
    setProviders(prev => ({
      ...prev,
      [pid]: { ...prev[pid], apiKey: key },
    }));
    setError("");
  };

  const handleBaseURLChange = (pid: string, url: string) => {
    setProviders(prev => ({
      ...prev,
      [pid]: { ...prev[pid], baseURL: url },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/api/tagent/providers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active: activeId,
          defaultModel: selectedModel,
          providers,
        }),
      });
      if (resp.ok) {
        onComplete();
      } else {
        setError("儲存失敗，請重試");
      }
    } catch {
      setError("連線錯誤，請確認 server 是否運行中");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: themeInfo.accentBg }}>
      <div className="w-full max-w-lg mx-4">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 shadow-lg shadow-orange-300/20 mb-5">
            <span className="text-3xl">🤖</span>
          </div>
          <h1 className="text-2xl font-bold text-stone-800 mb-2">設定 AI Provider</h1>
          <p className="text-stone-400 text-sm">至少設定一個 Provider 才能開始聊天</p>
        </div>

        {/* Provider cards */}
        <div className="space-y-4 mb-8">
          {Object.entries(providers).map(([pid, p]) => (
            <div
              key={pid}
              className="bg-white rounded-xl border-2 p-4 transition-all"
              style={{ borderColor: activeId === pid ? themeInfo.accent : "#e7e5e4" }}
            >
              {/* Provider header */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => { setActiveId(pid); if (p.models.length > 0) setSelectedModel(p.models[0].id); }}
                  className="flex items-center gap-2"
                >
                  <div
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                    style={{ borderColor: activeId === pid ? themeInfo.accent : "#d6d3d1" }}
                  >
                    {activeId === pid && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: themeInfo.accent }} />}
                  </div>
                  <span className="font-semibold text-stone-700">{p.name}</span>
                </button>
                {p.models.length > 0 && activeId === pid && (
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="text-xs px-2 py-1 rounded-md border border-stone-200 text-stone-600 focus:outline-none"
                  >
                    {p.models.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Base URL */}
              <input
                type="text"
                value={p.baseURL}
                onChange={(e) => handleBaseURLChange(pid, e.target.value)}
                placeholder="API Base URL"
                className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm mb-2 focus:outline-none focus:border-stone-400 font-mono text-stone-500"
              />

              {/* API Key */}
              <input
                type="password"
                value={p.apiKey}
                onChange={(e) => handleApiKeyChange(pid, e.target.value)}
                placeholder="API Key"
                className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400 font-mono"
              />
            </div>
          ))}
        </div>

        {error && <p className="text-center text-rose-500 text-sm mb-4">{error}</p>}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
          >
            {saving ? "儲存中..." : "✅ 儲存並開始使用"}
          </button>
          <button
            onClick={onComplete}
            className="w-full py-2.5 rounded-xl text-stone-400 font-medium text-sm hover:text-stone-600 hover:bg-stone-100 transition-all"
          >
            稍後再設定 →
          </button>
        </div>
      </div>
    </div>
  );
}
