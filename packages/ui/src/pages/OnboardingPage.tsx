import React, { useState, useEffect } from "react";
import { useTheme } from "../theme";

import API_BASE from "../api";

interface Props {
  onComplete: (profile: UserProfile) => void;
}

interface UserProfile {
  name: string;
  intro: string;
  style: "concise" | "detailed" | "casual" | "formal";
  assistantName?: string;
  onboarded?: boolean;
  onboardedAt?: string;
}

interface ProviderData {
  name: string;
  baseURL: string;
  apiKey: string;
  models: { id: string; name: string }[];
}

const STYLES = [
  { id: "concise" as const, label: "簡潔有力", desc: "快速回答，不廢話", emoji: "⚡" },
  { id: "detailed" as const, label: "詳細完整", desc: "深入解釋，鉅細靡遺", emoji: "📚" },
  { id: "casual" as const, label: "輕鬆友善", desc: "像朋友聊天一樣", emoji: "😊" },
  { id: "formal" as const, label: "正式專業", desc: "商務風格，條理清晰", emoji: "💼" },
];

export default function OnboardingPage({ onComplete }: Props) {
  const { info: themeInfo } = useTheme();
  const [step, setStep] = useState(0); // 0: welcome, 1: name, 2: intro, 3: style, 4: provider
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [style, setStyle] = useState<UserProfile["style"]>("casual");
  const [composing, setComposing] = useState(false);

  // Provider state
  const [providers, setProviders] = useState<Record<string, ProviderData>>({});
  const [activeId, setActiveId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [providerSkipped, setProviderSkipped] = useState(false);

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

  const handleApiKeyChange = (pid: string, key: string) => {
    setProviders(prev => ({ ...prev, [pid]: { ...prev[pid], apiKey: key } }));
  };

  const handleBaseURLChange = (pid: string, url: string) => {
    setProviders(prev => ({ ...prev, [pid]: { ...prev[pid], baseURL: url } }));
  };

  const saveProviders = async () => {
    await fetch(`${API_BASE}/api/paaw/providers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: activeId, defaultModel: selectedModel, providers }),
    });
  };

  // Check if provider is configured (has API key)
  const activeProvider = providers[activeId];
  const hasValidProvider = activeProvider && activeProvider.apiKey && activeProvider.apiKey !== "na";

  const handleFinish = async () => {
    // Save provider config if not skipped
    if (!providerSkipped) {
      try { await saveProviders(); } catch (err) { console.error("Failed to save providers:", err); }
    }

    const profile: UserProfile = { name, intro, style, assistantName: "林語晴", onboarded: true, onboardedAt: new Date().toISOString() };
    try {
      await fetch(`${API_BASE}/api/paaw/user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...profile, onboarded: true, onboardedAt: new Date().toISOString() }),
      });
    } catch (err) {
      console.error("Failed to save profile:", err);
    }
    onComplete(profile);
  };

  const steps = [
    // Step 0: Welcome
    <div key="welcome" className="flex flex-col items-center text-center">
      <div className="w-28 h-28 rounded-full overflow-hidden shadow-lg shadow-orange-300/30 mb-8 ring-4 ring-amber-100">
        <img
          src={`/avatars/assistant-default.png`}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).parentElement!.innerHTML = "<div class='w-full h-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center text-5xl'>🐾</div>"; }}
          className="w-full h-full object-cover"
          alt="林語晴"
        />
      </div>
      <h1 className="text-3xl font-bold text-stone-800 mb-3" style={{ fontFamily: "'SF Pro Display', system-ui, sans-serif" }}>
        嗨！我是林語晴
      </h1>
      <p className="text-stone-500 text-base mb-2">
        在開始之前，讓我先認識你一下 ✨
      </p>
      <p className="text-stone-400 text-sm">
        只需要幾個簡單的步驟
      </p>
      <button
        onClick={() => setStep(1)}
        className="mt-10 px-8 py-3 rounded-xl text-white font-medium shadow-lg hover:shadow-xl transition-all text-base"
        style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
      >
        開始吧 →
      </button>
    </div>,

    // Step 1: Name
    <div key="name" className="flex flex-col items-center text-center max-w-md w-full">
      <div className="text-4xl mb-6">👋</div>
      <h2 className="text-2xl font-bold text-stone-800 mb-2">你叫什麼名字？</h2>
      <p className="text-stone-400 text-sm mb-8">這樣我才知道怎麼稱呼你</p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={(e) => { if (e.key === "Enter" && !composing && !e.nativeEvent?.isComposing) { e.preventDefault(); const val = e.currentTarget.value.trim(); if (val) { setName(val); setStep(2); } } }}
        placeholder="輸入你的名字..."
        className="w-full px-5 py-4 rounded-xl border-2 text-lg text-center focus:outline-none transition-colors"
        style={{ borderColor: name ? themeInfo.accent : "#e7e5e4", color: "#1c1917" }}
        autoFocus
      />
      <button
        onClick={() => setStep(2)}
        disabled={!name.trim()}
        className="mt-6 px-8 py-3 rounded-xl text-white font-medium shadow-lg hover:shadow-xl transition-all text-base disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
      >
        下一步 →
      </button>
    </div>,

    // Step 2: Intro
    <div key="intro" className="flex flex-col items-center text-center max-w-md w-full">
      <div className="text-4xl mb-6">💬</div>
      <h2 className="text-2xl font-bold text-stone-800 mb-2">簡單介紹一下自己吧</h2>
      <p className="text-stone-400 text-sm mb-8">一句話就好，幫助我更了解你</p>
      <textarea
        value={intro}
        onChange={(e) => setIntro(e.target.value)}
        placeholder="例如：我是軟體工程師，有個 13 歲的女兒..."
        className="w-full px-5 py-4 rounded-xl border-2 text-base focus:outline-none transition-colors resize-none"
        style={{ borderColor: intro ? themeInfo.accent : "#e7e5e4", color: "#1c1917", minHeight: 100 }}
        rows={3}
        autoFocus
      />
      <button
        onClick={() => setStep(3)}
        disabled={!intro.trim()}
        className="mt-6 px-8 py-3 rounded-xl text-white font-medium shadow-lg hover:shadow-xl transition-all text-base disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
      >
        下一步 →
      </button>
    </div>,

    // Step 3: Style preference
    <div key="style" className="flex flex-col items-center text-center max-w-lg w-full">
      <div className="text-4xl mb-6">🎨</div>
      <h2 className="text-2xl font-bold text-stone-800 mb-2">你喜歡什麼風格？</h2>
      <p className="text-stone-400 text-sm mb-8">之後隨時可以改</p>
      <div className="grid grid-cols-2 gap-3 w-full mb-8">
        {STYLES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStyle(s.id)}
            className="flex flex-col items-center p-4 rounded-xl border-2 transition-all"
            style={{
              borderColor: style === s.id ? themeInfo.accent : "#e7e5e4",
              backgroundColor: style === s.id ? themeInfo.accentBg : "white",
            }}
          >
            <span className="text-3xl mb-2">{s.emoji}</span>
            <span className="font-semibold text-stone-700 text-sm">{s.label}</span>
            <span className="text-stone-400 text-xs mt-1">{s.desc}</span>
          </button>
        ))}
      </div>
      <button
        onClick={() => setStep(4)}
        className="px-10 py-3 rounded-xl text-white font-medium shadow-lg hover:shadow-xl transition-all text-base"
        style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
      >
        下一步 →
      </button>
    </div>,

    // Step 4: Provider setup
    <div key="provider" className="flex flex-col items-center text-center max-w-lg w-full">
      <div className="text-4xl mb-6">🤖</div>
      <h2 className="text-2xl font-bold text-stone-800 mb-2">設定 AI Provider</h2>
      <p className="text-stone-400 text-sm mb-6">至少設定一個 Provider 才能開始聊天，也可以稍後在設定頁配置</p>

      {/* Provider cards */}
      <div className="space-y-3 mb-6 w-full">
        {Object.entries(providers).map(([pid, p]) => (
          <div
            key={pid}
            className="bg-white rounded-xl border-2 p-4 transition-all text-left"
            style={{ borderColor: activeId === pid ? themeInfo.accent : "#e7e5e4" }}
          >
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => { setActiveId(pid); if (p.models?.length > 0) setSelectedModel(p.models[0].id); }}
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
              {p.models?.length > 0 && activeId === pid && (
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
            <input
              type="text"
              value={p.baseURL}
              onChange={(e) => handleBaseURLChange(pid, e.target.value)}
              placeholder="API Base URL"
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm mb-2 focus:outline-none focus:border-stone-400 font-mono text-stone-500"
            />
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

      {/* Status hint */}
      {hasValidProvider ? (
        <p className="text-green-600 text-sm mb-4">✅ {providers[activeId]?.name} 已設定完成</p>
      ) : (
        <p className="text-amber-500 text-sm mb-4">⚠️ 尚未設定 API Key，你可以稍後再配置</p>
      )}

      <div className="flex flex-col gap-3 w-full">
        <button
          onClick={() => { setProviderSkipped(false); handleFinish(); }}
          disabled={!hasValidProvider}
          className="w-full py-3 rounded-xl text-white font-medium shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
        >
          ✅ 儲存並開始使用
        </button>
        <button
          onClick={() => { setProviderSkipped(true); handleFinish(); }}
          className="w-full py-2.5 rounded-xl text-stone-400 font-medium text-sm hover:text-stone-600 hover:bg-stone-100 transition-all"
        >
          稍後再設定 →
        </button>
      </div>
    </div>,
  ];

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: themeInfo.accentBg }}>
      <div className="w-full max-w-xl mx-4 px-6 py-12">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-10">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full transition-all"
              style={{
                backgroundColor: i === step ? themeInfo.accent : i < step ? themeInfo.accent + "60" : "#d6d3d1",
                transform: i === step ? "scale(1.3)" : "scale(1)",
              }}
            />
          ))}
        </div>

        {/* Step content */}
        {steps[step]}
      </div>
    </div>
  );
}
