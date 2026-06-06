/**
 * tAgent i18n — lightweight internationalization
 * 
 * No heavy library needed. Just a React context + JSON locale files.
 * 
 * Usage:
 *   const { t } = useI18n();
 *   <span>{t("sidebar.skills")}</span>
 * 
 * Change language:
 *   const { setLocale } = useI18n();
 *   setLocale("en");
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

export type Locale = "zh-mix" | "en" | "zh" | "ja";

export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-mix": "中英混合（預設）",
  "en": "English",
  "zh": "全中文",
  "ja": "日本語",
};

// ── Import locale files ────────────────────────────────

import zhMix from "./locales/zh-mix.json";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";

const LOCALES: Record<Locale, Record<string, string>> = {
  "zh-mix": zhMix,
  "en": en,
  "zh": zh,
  "ja": ja,
};

// ── Storage ────────────────────────────────────────────

const STORAGE_KEY = "tagent.locale";

function getStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES[stored as Locale]) return stored as Locale;
  } catch {}
  return "zh-mix"; // Default: 中英混合
}

function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
}

// ── Context ────────────────────────────────────────────

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-mix",
  setLocale: () => {},
  t: (key: string) => key,
});

// ── Provider ───────────────────────────────────────────

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    storeLocale(newLocale);
  }, []);

  const t = useCallback((key: string, fallback?: string): string => {
    const strings = LOCALES[locale] || LOCALES["zh-mix"];
    return strings[key] || fallback || key;
  }, [locale]);

  return React.createElement(I18nContext.Provider, { value: { locale, setLocale, t } }, children);
}

// ── Hook ───────────────────────────────────────────────

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
