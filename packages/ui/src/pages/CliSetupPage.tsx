import React, { useState, useEffect } from "react";
import { useTheme } from "../theme";

const API_BASE = "http://127.0.0.1:4097";

interface Props {
  onComplete: () => void;
}

interface CliInfo {
  installed: boolean;
  bin: string;
  name: string;
}

interface ModelInfo {
  id: string;
  name: string;
}

export default function CliSetupPage({ onComplete }: Props) {
  const { info: themeInfo } = useTheme();
  const [installedClis, setInstalledClis] = useState<Record<string, CliInfo>>({});
  const [selectedCli, setSelectedCli] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Detect installed CLIs
    fetch(`${API_BASE}/api/clis`)
      .then(r => r.json())
      .then((data: Record<string, CliInfo>) => {
        setInstalledClis(data);
        // Auto-select first installed CLI
        const firstInstalled = Object.entries(data).find(([, v]) => v.installed);
        if (firstInstalled) {
          const [key] = firstInstalled;
          setSelectedCli(key);
          fetchModels(key);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const fetchModels = async (cli: string) => {
    try {
      const resp = await fetch(`${API_BASE}/api/models?cli=${cli}`);
      const data = await resp.json();
      const modelList = data.models || [];
      setModels(modelList);
      if (data.current) setSelectedModel(data.current);
      else if (modelList.length > 0) setSelectedModel(modelList[0].id);
    } catch {
      setModels([]);
    }
  };

  const handleCliChange = (cli: string) => {
    setSelectedCli(cli);
    setModels([]);
    setSelectedModel("");
    fetchModels(cli);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/paaw/cli-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultCli: selectedCli,
          defaultModel: selectedModel,
        }),
      });
    } catch {}
    setSaving(false);
    onComplete();
  };

  const installedList = Object.entries(installedClis).filter(([, v]) => v.installed);
  const notInstalledList = Object.entries(installedClis).filter(([, v]) => !v.installed);
  const hasAny = installedList.length > 0;

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: themeInfo.accentBg }}>
      <div className="w-full max-w-lg mx-4">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 shadow-lg shadow-indigo-300/20 mb-5">
            <span className="text-3xl">🛠️</span>
          </div>
          <h1 className="text-2xl font-bold text-stone-800 mb-2">CLI 工具設定</h1>
          <p className="text-stone-400 text-sm">設定 Employee Workspace 的預設 CLI 引擎和模型</p>
        </div>

        {loading ? (
          <div className="text-center text-stone-400 py-8">偵測中...</div>
        ) : !hasAny ? (
          /* No CLI installed */
          <div className="bg-white rounded-xl border border-stone-200 p-5 mb-6">
            <p className="text-stone-600 text-sm mb-4">目前沒有偵測到任何 CLI 工具。你可以稍後在設定中安裝。</p>
            <div className="space-y-3">
              {notInstalledList.map(([key, info]) => (
                <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-stone-50">
                  <span className="text-stone-300 text-lg">⬚</span>
                  <div>
                    <p className="text-sm font-medium text-stone-600">{info.name}</p>
                    <p className="text-xs text-stone-400 font-mono">{info.bin}</p>
                  </div>
                  <span className="ml-auto text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded">未安裝</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Has installed CLIs */
          <div className="space-y-4 mb-6">
            {/* Installed CLIs */}
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3 block">選擇預設 CLI 引擎</label>
              <div className="space-y-2">
                {installedList.map(([key, info]) => (
                  <button
                    key={key}
                    onClick={() => handleCliChange(key)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left"
                    style={{ borderColor: selectedCli === key ? themeInfo.accent : "#e7e5e4" }}
                  >
                    <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: selectedCli === key ? themeInfo.accent : "#d6d3d1" }}>
                      {selectedCli === key && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: themeInfo.accent }} />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-700">{info.name}</p>
                      <p className="text-xs text-stone-400 font-mono">{info.bin}</p>
                    </div>
                    <span className="ml-auto text-xs text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded">✓ 已安裝</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Model selection */}
            {selectedCli && models.length > 0 && (
              <div className="bg-white rounded-xl border border-stone-200 p-5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3 block">預設模型</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-stone-400"
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Not installed (info only) */}
            {notInstalledList.length > 0 && (
              <div className="bg-white rounded-xl border border-stone-200 p-4">
                <p className="text-xs text-stone-400 mb-2">其他可用的 CLI（尚未安裝）：</p>
                <div className="space-y-1.5">
                  {notInstalledList.map(([key, info]) => (
                    <div key={key} className="flex items-center gap-2 text-xs text-stone-400">
                      <span>⬚</span>
                      <span>{info.name}</span>
                      <span className="font-mono text-stone-300">{info.bin}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {hasAny && (
            <button
              onClick={handleSave}
              disabled={saving || (!selectedCli)}
              className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
            >
              {saving ? "儲存中..." : "✅ 儲存並繼續"}
            </button>
          )}
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
