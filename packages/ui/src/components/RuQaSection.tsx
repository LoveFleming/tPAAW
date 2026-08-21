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

const SUGGESTIONS = [
  "ru.qa.sug1", "ru.qa.sug2", "ru.qa.sug3", "ru.qa.sug4",
] as const;

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
      <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-2">
        ❓ {t("ru.qa.title")}
        <span className="text-[9px] font-normal px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{t("ru.qa.noLlm")}</span>
      </h3>
      <div style={box}>
        <div className="flex gap-1.5">
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
            className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border outline-none"
            style={{ borderColor: theme.borderLight, background: "#fff", color: theme.text }}
          />
          <button onClick={() => ask(q)} disabled={loading || !q.trim()}
            className="text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
            style={{ backgroundColor: theme.accent || "#78716c" }}>
            {loading ? "…" : t("ru.qa.ask")}
          </button>
        </div>

        {/* 建議題（新人 12 問精選）*/}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => ask(t(s))}
              className="text-[10px] px-2 py-0.5 rounded-full border text-stone-500 hover:bg-stone-100"
              style={{ borderColor: theme.borderLight }}>
              {t(s)}
            </button>
          ))}
        </div>

        {/* 答案卡 */}
        {a && (
          <div className="mt-2.5 border-t pt-2.5" style={{ borderColor: theme.borderLight }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: a.noEvidence ? "#fef3c7" : "#dcfce7", color: a.noEvidence ? "#92400e" : "#166534" }}>
                {a.noEvidence ? t("ru.qa.noEvidence") : `intent: ${a.intent}`}
              </span>
              <span className="text-[10px] text-stone-400 truncate">{a.question}</span>
            </div>
            <div className="text-xs leading-relaxed" style={{ color: a.noEvidence ? "#92400e" : theme.text }}>
              {a.noEvidence ? "🚫 " : ""}{a.summary}
            </div>
            {a.bullets && a.bullets.length > 0 && (
              <ul className="text-[11px] mt-1 space-y-0.5" style={{ color: theme.text }}>
                {a.bullets.map((b, i) => <li key={i} className="truncate" title={b}>• {b}</li>)}
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
