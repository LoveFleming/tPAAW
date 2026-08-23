import React, { useState, useEffect } from "react";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";

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

interface ProviderModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  pricing?: { inputPerMillion?: number; outputPerMillion?: number };
}

interface ProviderData {
  name: string;
  baseURL: string;
  apiKey: string;
  models: ProviderModel[];
}

const STYLES = [
  { id: "concise" as const, label: "簡潔精炼", desc: "重點到位，不廢話", emoji: "⚡" },
  { id: "detailed" as const, label: "詳細周到", desc: "步驟清晰，解釋完整", emoji: "📚" },
  { id: "casual" as const, label: "輕鬆日常", desc: "像朋友聊天一樣自然", emoji: "😊" },
  { id: "formal" as const, label: "正式專業", desc: "商務風格，嚴謹用詞", emoji: "💼" },
];

export default function OnboardingPage({ onComplete }: Props) {
  const { t: tt } = useI18n();
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

  // 新增第一個 Provider 的表單（全新安裝 providers = 空 → 走這個模式）
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formBaseURL, setFormBaseURL] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModelId, setFormModelId] = useState("");
  const [formModelName, setFormModelName] = useState("");
  const [formCtx, setFormCtx] = useState("");
  const [formMaxTok, setFormMaxTok] = useState("");
  const [formPriceIn, setFormPriceIn] = useState("");
  const [formPriceOut, setFormPriceOut] = useState("");

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

  const hasExistingProviders = Object.keys(providers).length > 0;
  const formValid = !!(formId.trim() && formBaseURL.trim() && formApiKey.trim() && formModelId.trim());

  const saveProviders = async () => {
    if (!hasExistingProviders) {
      // 表單模式：建立第一個 provider（OpenAI 相容：baseURL + apiKey + models）
      const model: ProviderModel = { id: formModelId.trim() };
      if (formModelName.trim()) model.name = formModelName.trim();
      const ctx = parseInt(formCtx, 10); if (Number.isFinite(ctx) && ctx > 0) model.contextWindow = ctx;
      const mt = parseInt(formMaxTok, 10); if (Number.isFinite(mt) && mt > 0) model.maxTokens = mt;
      const pin = parseFloat(formPriceIn); const pout = parseFloat(formPriceOut);
      if (!Number.isNaN(pin) || !Number.isNaN(pout)) {
        model.pricing = {
          ...(Number.isNaN(pin) ? {} : { inputPerMillion: pin }),
          ...(Number.isNaN(pout) ? {} : { outputPerMillion: pout }),
        };
      }
      const pid = formId.trim();
      await fetch(`${API_BASE}/api/paaw/providers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active: pid,
          defaultModel: model.id,
          providers: { [pid]: { name: formName.trim() || pid, baseURL: formBaseURL.trim(), apiKey: formApiKey, models: [model] } },
        }),
      });
      return;
    }
    await fetch(`${API_BASE}/api/paaw/providers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: activeId, defaultModel: selectedModel, providers }),
    });
  };

  // Check if provider is configured (has API key)
  const activeProvider = providers[activeId];
  const hasValidProvider = !hasExistingProviders
    ? formValid
    : !!(activeProvider && activeProvider.apiKey && activeProvider.apiKey !== "na" && activeProvider.apiKey !== "YOUR_API_KEY_HERE");

  const handleFinish = async () => {
    // Save provider config if not skipped
    if (!providerSkipped) {
      try { await saveProviders(); } catch (err) { console.error("Failed to save providers:", err); }
    }

    const profile: UserProfile = { name, intro, style, assistantName: tt("chat.assistantDefault"), onboarded: true, onboardedAt: new Date().toISOString() };
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
          alt={tt("chat.assistantDefault")}
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
        placeholder={tt("onboarding.namePlaceholder")}
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
        placeholder={tt("onboarding.introPlaceholder")}
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
      <p className="text-stone-400 text-sm mb-6">{hasExistingProviders ? tt("onboarding.providerDescSelect") : tt("onboarding.providerDescCreate")}</p>

      {hasExistingProviders ? (
      /* Provider cards（已有 providers：選一個、補 key）*/
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
                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
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
      ) : (
      /* 全新安裝：建立第一個 Provider（OpenAI 相容 API）*/
      <div className="w-full bg-white rounded-xl border-2 border-stone-200 p-5 space-y-3 text-left mb-6">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerId")}</span>
            <input
              data-ob="pid"
              type="text"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              placeholder={tt("onboarding.providerIdPh")}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono text-stone-700 focus:outline-none focus:border-stone-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerName")}</span>
            <input
              data-ob="pname"
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={tt("onboarding.providerNamePh")}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm text-stone-700 focus:outline-none focus:border-stone-400"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerBaseUrl")}</span>
          <input
            data-ob="pbase"
            type="text"
            value={formBaseURL}
            onChange={(e) => setFormBaseURL(e.target.value)}
            placeholder={tt("onboarding.providerBaseUrlPh")}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono text-stone-700 focus:outline-none focus:border-stone-400"
          />
          <span className="text-[10px] text-stone-400 block mt-1">{tt("onboarding.providerOpenaiHint")}</span>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerApiKey")}</span>
          <input
            data-ob="pkey"
            type="password"
            value={formApiKey}
            onChange={(e) => setFormApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono text-stone-700 focus:outline-none focus:border-stone-400"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerModelId")}</span>
          <input
            data-ob="pmid"
            type="text"
            value={formModelId}
            onChange={(e) => setFormModelId(e.target.value)}
            placeholder={tt("onboarding.providerModelIdPh")}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono text-stone-700 focus:outline-none focus:border-stone-400"
          />
        </label>
        <details className="border-t border-stone-100 pt-3">
          <summary className="text-xs font-semibold text-stone-400 cursor-pointer select-none hover:text-stone-600">{tt("onboarding.providerAdvanced")}</summary>
          <div className="space-y-3 pt-3">
            <label className="block">
              <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerModelName")}</span>
              <input
                data-ob="pmname"
                type="text"
                value={formModelName}
                onChange={(e) => setFormModelName(e.target.value)}
                placeholder={tt("onboarding.providerModelNamePh")}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm text-stone-700 focus:outline-none focus:border-stone-400"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerContextWindow")}</span>
                <input data-ob="pctx" type="text" inputMode="numeric" value={formCtx} onChange={(e) => setFormCtx(e.target.value)} placeholder="128000" className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono text-stone-700 focus:outline-none focus:border-stone-400" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerMaxTokens")}</span>
                <input data-ob="pmax" type="text" inputMode="numeric" value={formMaxTok} onChange={(e) => setFormMaxTok(e.target.value)} placeholder="16384" className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono text-stone-700 focus:outline-none focus:border-stone-400" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerPriceIn")}</span>
                <input data-ob="ppin" type="text" inputMode="decimal" value={formPriceIn} onChange={(e) => setFormPriceIn(e.target.value)} placeholder="0.6" className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono text-stone-700 focus:outline-none focus:border-stone-400" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-stone-500 block mb-1">{tt("onboarding.providerPriceOut")}</span>
                <input data-ob="ppout" type="text" inputMode="decimal" value={formPriceOut} onChange={(e) => setFormPriceOut(e.target.value)} placeholder="2.2" className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono text-stone-700 focus:outline-none focus:border-stone-400" />
              </label>
            </div>
          </div>
        </details>
      </div>
      )}

      {/* Status hint */}
      {hasValidProvider ? (
        <p className="text-green-600 text-sm mb-4">✅ {hasExistingProviders ? providers[activeId]?.name : (formName.trim() || formId.trim())} {tt("onboarding.providerConfigured")}</p>
      ) : (
        <p className="text-amber-500 text-sm mb-4">{tt("onboarding.providerNoKey")}</p>
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
