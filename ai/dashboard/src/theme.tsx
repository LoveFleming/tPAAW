import React, { createContext, useContext, useState } from "react";

export type ThemeId =
  | "sunny"
  | "sky"
  | "calm-anxiety"       // 焦慮 — 柔和藍
  | "calm-tension"       // 緊張 — 森林綠
  | "calm-anger"         // 憤怒 — 暖灰木質棕
  | "boost-creative"     // 創造力 — 深紫藍
  | "calm-exhaustion";   // 疲憊 — 暖白低對比

interface ThemePalette {
  id: ThemeId;
  label: string;
  emoji: string;
  group: string;            // category for dropdown grouping
  desc: string;             // short description shown in dropdown
  feeling?: string;         // when to use this theme

  gradient: string;

  accent: string;
  accentLight: string;
  accentBg: string;
  accentBorder: string;
  accentText: string;
  accentHover: string;

  badgeString: string;
  badgeNumber: string;
  badgeBoolean: string;
  badgeNull: string;
  badgeObject: string;
  badgeArray: string;

  syntaxString: string;
  syntaxNumber: string;
  syntaxBoolean: string;
  syntaxKey: string;
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  sunny: {
    id: "sunny", label: "陽光", emoji: "☀️",
    group: "日常", desc: "溫暖明亮，活力充沛", feeling: "日常使用、好心情",
    gradient: "linear-gradient(135deg, #F59E0B 0%, #FBBF24 50%, #FDE68A 100%)",
    accent: "#F59E0B", accentLight: "#FEF3C7", accentBg: "#FFFBEB",
    accentBorder: "#FCD34D", accentText: "#92400E", accentHover: "#D97706",
    badgeString: "bg-emerald-50 text-emerald-600 border-emerald-200",
    badgeNumber: "bg-amber-50 text-amber-600 border-amber-200",
    badgeBoolean: "bg-rose-50 text-rose-600 border-rose-200",
    badgeNull: "bg-stone-100 text-stone-400 border-stone-200",
    badgeObject: "bg-violet-50 text-violet-600 border-violet-200",
    badgeArray: "bg-sky-50 text-sky-600 border-sky-200",
    syntaxString: "text-emerald-600", syntaxNumber: "text-amber-600",
    syntaxBoolean: "text-rose-600", syntaxKey: "text-stone-700",
  },
  sky: {
    id: "sky", label: "藍天", emoji: "🌤️",
    group: "日常", desc: "清澈開闊，自由自在", feeling: "日常使用、輕鬆愉快",
    gradient: "linear-gradient(135deg, #3B82F6 0%, #60A5FA 50%, #93C5FD 100%)",
    accent: "#3B82F6", accentLight: "#DBEAFE", accentBg: "#EFF6FF",
    accentBorder: "#93C5FD", accentText: "#1E3A8A", accentHover: "#2563EB",
    badgeString: "bg-teal-50 text-teal-600 border-teal-200",
    badgeNumber: "bg-blue-50 text-blue-600 border-blue-200",
    badgeBoolean: "bg-indigo-50 text-indigo-600 border-indigo-200",
    badgeNull: "bg-slate-100 text-slate-400 border-slate-200",
    badgeObject: "bg-purple-50 text-purple-600 border-purple-200",
    badgeArray: "bg-cyan-50 text-cyan-600 border-cyan-200",
    syntaxString: "text-teal-600", syntaxNumber: "text-blue-600",
    syntaxBoolean: "text-indigo-600", syntaxKey: "text-slate-700",
  },

  // ─── 舒緩杏仁核 ───

  "calm-anxiety": {
    id: "calm-anxiety", label: "舒緩焦慮", emoji: "🌊",
    group: "舒緩杏仁核", desc: "柔和藍、灰藍、深海藍 — 穩定、安全、理性",
    feeling: "擔心未來、停不下來、未知感",
    gradient: "linear-gradient(135deg, #1E3A5F 0%, #4A7BA7 50%, #8CB4D5 100%)",
    accent: "#4A7BA7", accentLight: "#D6E8F0", accentBg: "#EFF5F9",
    accentBorder: "#8CB4D5", accentText: "#1E3A5F", accentHover: "#3A6B97",
    badgeString: "bg-sky-50 text-sky-600 border-sky-200",
    badgeNumber: "bg-blue-50 text-blue-600 border-blue-200",
    badgeBoolean: "bg-indigo-50 text-indigo-600 border-indigo-200",
    badgeNull: "bg-slate-100 text-slate-400 border-slate-200",
    badgeObject: "bg-cyan-50 text-cyan-600 border-cyan-200",
    badgeArray: "bg-teal-50 text-teal-600 border-teal-200",
    syntaxString: "text-sky-600", syntaxNumber: "text-blue-600",
    syntaxBoolean: "text-indigo-600", syntaxKey: "text-slate-700",
  },
  "calm-tension": {
    id: "calm-tension", label: "舒緩緊張", emoji: "🌲",
    group: "舒緩杏仁核", desc: "森林綠、墨綠、深青色 — 恢復、安全、可呼吸",
    feeling: "被 deadline 追著跑、高壓警戒",
    gradient: "linear-gradient(135deg, #1B4332 0%, #2D6A4F 50%, #74C69D 100%)",
    accent: "#2D6A4F", accentLight: "#D8F3DC", accentBg: "#F0F9F4",
    accentBorder: "#74C69D", accentText: "#1B4332", accentHover: "#245840",
    badgeString: "bg-green-50 text-green-600 border-green-200",
    badgeNumber: "bg-teal-50 text-teal-600 border-teal-200",
    badgeBoolean: "bg-emerald-50 text-emerald-600 border-emerald-200",
    badgeNull: "bg-stone-100 text-stone-400 border-stone-200",
    badgeObject: "bg-cyan-50 text-cyan-600 border-cyan-200",
    badgeArray: "bg-lime-50 text-lime-600 border-lime-200",
    syntaxString: "text-green-600", syntaxNumber: "text-teal-600",
    syntaxBoolean: "text-emerald-600", syntaxKey: "text-stone-700",
  },
  "calm-anger": {
    id: "calm-anger", label: "舒緩憤怒", emoji: "🪵",
    group: "舒緩杏仁核", desc: "暖灰、米白、木質棕 — 降低對抗感、沉穩",
    feeling: "想反駁、容易 irritated、內耗",
    gradient: "linear-gradient(135deg, #78716C 0%, #A8A29E 50%, #D6D3D1 100%)",
    accent: "#78716C", accentLight: "#E7E5E4", accentBg: "#F5F4F3",
    accentBorder: "#D6D3D1", accentText: "#44403C", accentHover: "#57534E",
    badgeString: "bg-stone-50 text-stone-600 border-stone-200",
    badgeNumber: "bg-amber-50 text-amber-700 border-amber-200",
    badgeBoolean: "bg-orange-50 text-orange-600 border-orange-200",
    badgeNull: "bg-stone-100 text-stone-400 border-stone-200",
    badgeObject: "bg-yellow-50 text-yellow-700 border-yellow-200",
    badgeArray: "bg-lime-50 text-lime-700 border-lime-200",
    syntaxString: "text-stone-600", syntaxNumber: "text-amber-700",
    syntaxBoolean: "text-orange-600", syntaxKey: "text-stone-700",
  },
  "boost-creative": {
    id: "boost-creative", label: "靈感爆發", emoji: "🔮",
    group: "舒緩杏仁核", desc: "深紫藍、柔紫、少量 cyan — 未來感、靈感流動",
    feeling: "很想做東西、靈感多、創造力爆發",
    gradient: "linear-gradient(135deg, #4C1D95 0%, #7C3AED 50%, #A78BFA 100%)",
    accent: "#7C3AED", accentLight: "#EDE9FE", accentBg: "#F5F3FF",
    accentBorder: "#C4B5FD", accentText: "#4C1D95", accentHover: "#6D28D9",
    badgeString: "bg-emerald-50 text-emerald-600 border-emerald-200",
    badgeNumber: "bg-violet-50 text-violet-600 border-violet-200",
    badgeBoolean: "bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200",
    badgeNull: "bg-stone-100 text-stone-400 border-stone-200",
    badgeObject: "bg-purple-50 text-purple-600 border-purple-200",
    badgeArray: "bg-cyan-50 text-cyan-600 border-cyan-200",
    syntaxString: "text-emerald-600", syntaxNumber: "text-violet-600",
    syntaxBoolean: "text-fuchsia-600", syntaxKey: "text-stone-700",
  },
  "calm-exhaustion": {
    id: "calm-exhaustion", label: "舒緩疲憊", emoji: "☁️",
    group: "舒緩杏仁核", desc: "暖白、淺灰、低對比色 — 放鬆、減壓、低刺激",
    feeling: "腦袋累、資訊過載、被掏空",
    gradient: "linear-gradient(135deg, #D4CFC9 0%, #E8E4DF 50%, #F5F3F0 100%)",
    accent: "#A8A29E", accentLight: "#F5F5F4", accentBg: "#FAFAF9",
    accentBorder: "#E7E5E4", accentText: "#57534E", accentHover: "#78716C",
    badgeString: "bg-stone-50 text-stone-500 border-stone-200",
    badgeNumber: "bg-stone-50 text-stone-500 border-stone-200",
    badgeBoolean: "bg-stone-50 text-stone-500 border-stone-200",
    badgeNull: "bg-stone-50 text-stone-300 border-stone-200",
    badgeObject: "bg-stone-50 text-stone-500 border-stone-200",
    badgeArray: "bg-stone-50 text-stone-500 border-stone-200",
    syntaxString: "text-stone-500", syntaxNumber: "text-stone-500",
    syntaxBoolean: "text-stone-500", syntaxKey: "text-stone-600",
  },
};

export type ThemeInfo = ThemePalette;

interface ThemeContextType {
  theme: ThemeId;
  info: ThemePalette;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "sunny",
  info: THEMES.sunny,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeId] = useState<ThemeId>(() => {
    try {
      const stored = localStorage.getItem("ai-factory-theme") as ThemeId;
      return (stored && THEMES[stored]) ? stored : "sunny";
    }
    catch { return "sunny"; }
  });

  const setTheme = (id: ThemeId) => {
    setThemeId(id);
    try { localStorage.setItem("ai-factory-theme", id); } catch {}
  };

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, info: THEMES[theme] ?? THEMES.sunny, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Grouped theme list for dropdown
export const THEME_GROUPS: { label: string; themes: ThemePalette[] }[] = [
  { label: "☀️ 日常", themes: [THEMES.sunny, THEMES.sky] },
  { label: "🧠 舒緩杏仁核", themes: [
    THEMES["calm-anxiety"],
    THEMES["calm-tension"],
    THEMES["calm-anger"],
    THEMES["boost-creative"],
    THEMES["calm-exhaustion"],
  ]},
];
