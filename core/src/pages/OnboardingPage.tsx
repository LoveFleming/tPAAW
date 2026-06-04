import React, { useState } from "react";
import { useTheme } from "../theme";

const API_BASE = "http://127.0.0.1:4097";

interface Props {
  onComplete: (profile: UserProfile) => void;
}

interface UserProfile {
  name: string;
  intro: string;
  style: "concise" | "detailed" | "casual" | "formal";
}

const STYLES = [
  { id: "concise" as const, label: "簡潔有力", desc: "快速回答，不廢話", emoji: "⚡" },
  { id: "detailed" as const, label: "詳細完整", desc: "深入解釋，鉅細靡遺", emoji: "📚" },
  { id: "casual" as const, label: "輕鬆友善", desc: "像朋友聊天一樣", emoji: "😊" },
  { id: "formal" as const, label: "正式專業", desc: "商務風格，條理清晰", emoji: "💼" },
];

export default function OnboardingPage({ onComplete }: Props) {
  const { info: themeInfo } = useTheme();
  const [step, setStep] = useState(0); // 0: welcome, 1: name, 2: intro, 3: style
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [style, setStyle] = useState<UserProfile["style"]>("casual");

  const handleFinish = async () => {
    const profile: UserProfile = { name, intro, style, assistantName: "林語晴", onboarded: true, onboardedAt: new Date().toISOString() };
    try {
      await fetch(`${API_BASE}/api/tclaw/user`, {
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
      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center text-5xl shadow-lg shadow-orange-300/30 mb-8">
        🐾
      </div>
      <h1 className="text-3xl font-bold text-stone-800 mb-3" style={{ fontFamily: "'SF Pro Display', system-ui, sans-serif" }}>
        嗨！我是林語晴
      </h1>
      <p className="text-stone-500 text-lg mb-2">你的個人 AI 助理</p>
      <p className="text-stone-400 text-sm max-w-sm">
        在開始之前，我想先認識你一下。只需要幾個簡單的步驟就好。
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
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) setStep(2); }}
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
        onClick={handleFinish}
        className="px-10 py-3 rounded-xl text-white font-medium shadow-lg hover:shadow-xl transition-all text-base"
        style={{ background: `linear-gradient(135deg, ${themeInfo.accent}, ${themeInfo.accentHover})` }}
      >
        完成！開始聊天 🎉
      </button>
    </div>,
  ];

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: themeInfo.accentBg }}>
      <div className="w-full max-w-lg mx-4 px-6 py-12">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-10">
          {[0, 1, 2, 3].map((i) => (
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
