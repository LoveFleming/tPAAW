import React, { createContext, useContext, useState } from "react";

export type ThemeId = "sunny" | "sky" | "calm-anger" | "calm-anxiety" | "calm-resignation";

interface ThemePalette {
  id: ThemeId;
  label: string;
  icon: string;
  desc: string;
  gradient: string;

  // Primary accent
  accent: string;
  accentLight: string;       // bg with low opacity feel
  accentBg: string;          // very light bg for hover/highlight
  accentBorder: string;      // border color
  accentText: string;        // text on accent bg
  accentHover: string;       // darker accent for hover

  // Badge colors for types
  badgeString: string;
  badgeNumber: string;
  badgeBoolean: string;
  badgeNull: string;
  badgeObject: string;
  badgeArray: string;

  // Syntax colors
  syntaxString: string;
  syntaxNumber: string;
  syntaxBoolean: string;
  syntaxKey: string;

  // Sidebar
  sidebarBg: string;
  sidebarActive: string;
  sidebarActiveBorder: string;

  // Tabs
  tabActive: string;
  tabBg: string;
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  sunny: {
    id: "sunny", label: "陽光", icon: "sun", desc: "溫暖明亮",
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
    sidebarBg: "bg-white", sidebarActive: "bg-amber-50", sidebarActiveBorder: "#F59E0B",
    tabActive: "text-amber-700", tabBg: "bg-stone-100",
  },
  sky: {
    id: "sky", label: "藍天", icon: "cloud-sun", desc: "清澈開闊",
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
    sidebarBg: "bg-white", sidebarActive: "bg-blue-50", sidebarActiveBorder: "#3B82F6",
    tabActive: "text-blue-700", tabBg: "bg-slate-100",
  },
  "calm-anger": {
    id: "calm-anger", label: "舒緩生氣", icon: "calm-anger", desc: "薰衣草紫",
    gradient: "linear-gradient(135deg, #7C3AED 0%, #A78BFA 50%, #DDD6FE 100%)",
    accent: "#7C3AED", accentLight: "#EDE9FE", accentBg: "#F5F3FF",
    accentBorder: "#C4B5FD", accentText: "#4C1D95", accentHover: "#6D28D9",
    badgeString: "bg-emerald-50 text-emerald-600 border-emerald-200",
    badgeNumber: "bg-violet-50 text-violet-600 border-violet-200",
    badgeBoolean: "bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200",
    badgeNull: "bg-stone-100 text-stone-400 border-stone-200",
    badgeObject: "bg-purple-50 text-purple-600 border-purple-200",
    badgeArray: "bg-indigo-50 text-indigo-600 border-indigo-200",
    syntaxString: "text-emerald-600", syntaxNumber: "text-violet-600",
    syntaxBoolean: "text-fuchsia-600", syntaxKey: "text-stone-700",
    sidebarBg: "bg-white", sidebarActive: "bg-violet-50", sidebarActiveBorder: "#7C3AED",
    tabActive: "text-violet-700", tabBg: "bg-stone-100",
  },
  "calm-anxiety": {
    id: "calm-anxiety", label: "舒緩焦慮", icon: "calm-anxiety", desc: "鼠尾草綠",
    gradient: "linear-gradient(135deg, #059669 0%, #6EE7B7 50%, #D1FAE5 100%)",
    accent: "#059669", accentLight: "#D1FAE5", accentBg: "#ECFDF5",
    accentBorder: "#6EE7B7", accentText: "#064E3B", accentHover: "#047857",
    badgeString: "bg-green-50 text-green-600 border-green-200",
    badgeNumber: "bg-teal-50 text-teal-600 border-teal-200",
    badgeBoolean: "bg-lime-50 text-lime-600 border-lime-200",
    badgeNull: "bg-stone-100 text-stone-400 border-stone-200",
    badgeObject: "bg-emerald-50 text-emerald-600 border-emerald-200",
    badgeArray: "bg-cyan-50 text-cyan-600 border-cyan-200",
    syntaxString: "text-green-600", syntaxNumber: "text-teal-600",
    syntaxBoolean: "text-lime-600", syntaxKey: "text-stone-700",
    sidebarBg: "bg-white", sidebarActive: "bg-emerald-50", sidebarActiveBorder: "#059669",
    tabActive: "text-emerald-700", tabBg: "bg-stone-100",
  },
  "calm-resignation": {
    id: "calm-resignation", label: "舒緩無奈", icon: "calm-resignation", desc: "暖珊瑚橘",
    gradient: "linear-gradient(135deg, #F97316 0%, #FB923C 50%, #FED7AA 100%)",
    accent: "#F97316", accentLight: "#FED7AA", accentBg: "#FFF7ED",
    accentBorder: "#FDBA74", accentText: "#7C2D12", accentHover: "#EA580C",
    badgeString: "bg-emerald-50 text-emerald-600 border-emerald-200",
    badgeNumber: "bg-orange-50 text-orange-600 border-orange-200",
    badgeBoolean: "bg-rose-50 text-rose-600 border-rose-200",
    badgeNull: "bg-stone-100 text-stone-400 border-stone-200",
    badgeObject: "bg-amber-50 text-amber-600 border-amber-200",
    badgeArray: "bg-sky-50 text-sky-600 border-sky-200",
    syntaxString: "text-emerald-600", syntaxNumber: "text-orange-600",
    syntaxBoolean: "text-rose-600", syntaxKey: "text-stone-700",
    sidebarBg: "bg-white", sidebarActive: "bg-orange-50", sidebarActiveBorder: "#F97316",
    tabActive: "text-orange-700", tabBg: "bg-stone-100",
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
