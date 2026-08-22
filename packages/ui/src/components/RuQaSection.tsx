/**
 * RuQaSection — 新人 12 問 Q&A 入口（R5）
 *
 * 鐵律：No answer without evidence — 每個回答帶 evidence chips，
 * 沒證據就明講。deterministic 引擎（零 LLM），資料 = R2 model + git + ADR + releases。
 */
import React, { useState, useRef, useCallback, useEffect } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface Evidence { type: string; ref: string; detail?: string }
interface Answer {
  question: string;
  intent: string;
  matched: boolean;
  summary: string;
  bullets?: string[];
  evidence: Evidence[];
  noEvidence?: boolean;
  followUps?: string[];
}

const EV_ICON: Record<string, string> = {
  doc: "📄", file: "📁", commit: "🔖", adr: "⚖️", task: "📋", api: "🔌", release: "🚀", stat: "📊",
};

// 新人 12 問完整清單 — 點了即問（對應 qa.mjs 12 intents）
const SUGGESTIONS = [
  "ru.qa.sug1", "ru.qa.sug2", "ru.qa.sug3", "ru.qa.sug4",
  "ru.qa.sug5", "ru.qa.sug6", "ru.qa.sug7", "ru.qa.sug8",
  "ru.qa.sug9", "ru.qa.sug10", "ru.qa.sug11", "ru.qa.sug12",
] as const;
const CIRCLED = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫"];

export default function RuQaSection({ rootPath, theme }: { rootPath: string; theme: any }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [a, setA] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const composingRef = useRef(false); // IME 紀律：useRef 三層保護

  const ask = useCallback(async (question: string) => {
    const qs = question.trim();
    if (!qs) return;
    setLoading(true);
    setQ(qs);
    try {
      const res = await fetch(`${API_BASE}/api/ru/qa?path=${encodeURIComponent(rootPath)}&q=${encodeURIComponent(qs)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d && typeof d.summary === "string") setA(d);
    } catch {
      setA({ question: qs, intent: "error", matched: false, summary: t("ru.qa.error"), evidence: [], noEvidence: true });
    } finally { setLoading(false); }
  }, [rootPath, t]);

  useEffect(() => { setA(null); setQ(""); }, [rootPath]);

  const box: React.CSSProperties = {
    background: theme.bgMuted || "#fafaf9",
    border: `1px solid ${theme.borderLight || "#e7e5e4"}`,
    borderRadius: 10, padding: 12,
  };
  const chip = (e: Evidence, i: number) => (
    <span key={i} title={e.detail || ""}
      className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border max-w-[260px] truncate"
      style={{ borderColor: theme.borderLight, background: "#fff" }}>
      {EV_ICON[e.type] || "❓"} {e.ref}
    </span>
  );

  return (
    <section>
      <h3 className="text-xs font-bold text-stone-600 mb-2">❓ {t("ru.qa.title")}</h3>
      <div style={box}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={e => {
            if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(q); }
          }}
          placeholder={t("ru.qa.placeholder")}
          className="w-full text-xs px-2.5 py-1.5 rounded-lg border outline-none focus:border-stone-400 transition-colors"
          style={{ borderColor: theme.borderLight, background: "#fff", color: theme.text }}
        />

        {/* 新人 12 問 — 兩欄 grid，點了即問 */}
        <div className="mt-2">
          <div className="text-[9px] font-semibold text-stone-400 mb-1">{t("ru.qa.sugTitle")}</div>
          <div className="grid grid-cols-2 gap-1">
            {SUGGESTIONS.map((s, i) => (
              <button key={s} onClick={() => ask(t(s))}
                className="text-left text-[10px] px-2 py-1 rounded-md border text-stone-600 hover:bg-stone-50 hover:border-stone-300 transition-colors truncate"
                style={{ borderColor: theme.borderLight }}>
                <span className="text-stone-300 mr-1">{CIRCLED[i]}</span>{t(s)}
              </button>
            ))}
          </div>
        </div>

        {/* 答案卡 */}
        {loading && (
          <div className="mt-2.5 border-t pt-2.5 text-[11px] text-stone-400 animate-pulse" style={{ borderColor: theme.borderLight }}>
            🔍 {t("ru.qa.searching")}
          </div>
        )}
        {a && !loading && (
          <div className={`mt-2.5 border-t pt-2.5 ${a.noEvidence ? "rounded-lg px-2.5 py-2" : ""}`} style={{ borderColor: a.noEvidence ? "#fcd34d" : theme.borderLight, background: a.noEvidence ? "#fffbeb" : undefined }}>
            <div className="text-xs font-medium leading-relaxed" style={{ color: a.noEvidence ? "#92400e" : theme.text }}>
              {a.noEvidence ? "🚫 " : ""}{a.summary}
            </div>
            {a.bullets && a.bullets.length > 0 && (
              <ul className="text-[11px] mt-1.5 space-y-1 leading-relaxed" style={{ color: theme.text }}>
                {a.bullets.map((b, i) => <li key={i} className="break-words">• {b}</li>)}
              </ul>
            )}
            {a.evidence.length > 0 && (
              <div className="mt-2">
                <div className="text-[9px] opacity-50 mb-1">{t("ru.qa.evidence")}（{a.evidence.length}）</div>
                <div className="flex flex-wrap gap-1">
                  {a.evidence.map(chip)}
                </div>
              </div>
            )}
            {a.followUps && a.followUps.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {a.followUps.map(f => (
                  <button key={f} onClick={() => ask(f)}
                    className="text-[10px] px-2 py-0.5 rounded-full border text-stone-500 hover:bg-stone-100"
                    style={{ borderColor: theme.borderLight }}>
                    ↳ {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
