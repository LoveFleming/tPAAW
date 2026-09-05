/**
 * SkillSuggestModal — 💡 Skill 建議（新 release unit onboarding）
 *
 * 機器掃（deterministic）→ per-agent 建議清單 → 使用者勾選套用
 * LLM 只註解（為什麼適合 + catalog 缺口點子），不參與比對 — 事實靠程式
 *
 * 來源：GET  /api/coding-project/skill-suggest（掃描 + 規則表，零 token）
 *       POST /api/coding-project/skill-suggest/annotate（AI 註解）
 * 套用：PUT  /api/coding-project/crew/:agentId/skills（既有 endpoint）
 */
import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";

interface StackInfo { id: string; kind: string; label: string; evidence: string }
interface Suggestion {
  skillId: string; skillName: string; inCatalog: boolean; status: "new" | "already";
  evidence: string; stacks: string[];
}
interface AgentGroup {
  agentId: string; title: string; codename: string; source: string;
  currentSkills: string[]; suggestions: Suggestion[];
}
interface SuggestResult {
  ok: boolean;
  detection: { scannedFiles: number; stacks: StackInfo[]; manifests: string[] };
  unmatched: { id: string; label: string }[];
  agents: AgentGroup[];
  summary: { newCount: number; alreadyCount: number; agentsWithNew: number };
  catalogCount: number;
}
interface CustomIdea { name: string; purpose: string; reason: string }

interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; text: string };
  onClose: () => void;
  onApplied?: () => void;
}

const KIND_ICON: Record<string, string> = { language: "🔤", framework: "🧩", infra: "🏗️", test: "🧪" };

export default function SkillSuggestModal({ rootPath, theme: t, onClose, onApplied }: Props) {
  const { t: i18n } = useI18n();
  const [data, setData] = useState<SuggestResult | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({}); // `${agentId}:${skillId}`
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ideas, setIdeas] = useState<CustomIdea[]>([]);
  const [annotating, setAnnotating] = useState(false);
  const [annotated, setAnnotated] = useState(false);
  const [aiWarn, setAiWarn] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedMsg, setAppliedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null); setLoadErr(null); setChecked({}); setNotes({}); setIdeas([]); setAnnotated(false); setAiWarn(null);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/skill-suggest?path=${encodeURIComponent(rootPath)}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      const init: Record<string, boolean> = {};
      for (const a of json.agents || []) for (const s of a.suggestions || []) {
        if (s.status === "new") init[`${a.agentId}:${s.skillId}`] = true;
      }
      setChecked(init);
    } catch (e: any) {
      setLoadErr(e.message || "load failed");
    }
  }, [rootPath]);

  useEffect(() => { load(); }, [load]);

  const annotate = async () => {
    setAnnotating(true); setAiWarn(null);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/skill-suggest/annotate?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setNotes(json.notes || {});
      setIdeas(json.customIdeas || []);
      setAnnotated(true);
      if (json.warn) setAiWarn(json.warn);
    } catch (e: any) {
      setAiWarn(e.message || "annotate failed");
    }
    setAnnotating(false);
  };

  const apply = async () => {
    if (!data) return;
    // 按 agent 分組勾選
    const byAgent = new Map<string, string[]>();
    for (const a of data.agents) {
      const sel = a.suggestions.filter(s => s.status === "new" && checked[`${a.agentId}:${s.skillId}`]).map(s => s.skillId);
      if (sel.length) byAgent.set(a.agentId, sel);
    }
    if (!byAgent.size) { setAppliedMsg(i18n("ss.applyNone")); return; }
    setApplying(true);
    let okAgents = 0, okSkills = 0, lastErr = "";
    for (const [agentId, sel] of byAgent) {
      try {
        const agent = data.agents.find(a => a.agentId === agentId)!;
        const merged = [...new Set([...agent.currentSkills, ...sel])];
        const res = await fetch(`${API_BASE}/api/coding-project/crew/${encodeURIComponent(agentId)}/skills?path=${encodeURIComponent(rootPath)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills: merged }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        okAgents++; okSkills += sel.length;
      } catch (e: any) { lastErr = e.message; }
    }
    setApplying(false);
    if (okAgents > 0) {
      setAppliedMsg(i18n("ss.applied").replace("{n}", String(okSkills)).replace("{m}", String(okAgents)));
      onApplied?.();
      setTimeout(() => { load(); }, 600); // 重載 → new 變 already
    } else {
      setAppliedMsg(`❌ ${lastErr || "apply failed"}`);
    }
  };

  const toggleAll = (on: boolean) => {
    if (!data) return;
    const next: Record<string, boolean> = {};
    if (on) for (const a of data.agents) for (const s of a.suggestions) {
      if (s.status === "new") next[`${a.agentId}:${s.skillId}`] = true;
    }
    setChecked(next);
  };

  const checkedCount = Object.values(checked).filter(Boolean).length;
  const langs = data?.detection.stacks.filter(s => s.kind === "language") || [];
  const fws = data?.detection.stacks.filter(s => s.kind !== "language") || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        style={{ border: `1px solid ${t.borderLight}` }} onClick={e => e.stopPropagation()} data-testid="skill-suggest-modal">

        {/* header */}
        <div className="px-5 py-3.5 border-b flex items-center justify-between shrink-0" style={{ borderColor: t.borderLight, background: t.bgMuted }}>
          <div>
            <div className="text-sm font-bold text-stone-800">{i18n("ss.title")}</div>
            <div className="text-[11px] text-stone-500 mt-0.5">{i18n("ss.subtitle")}</div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-lg leading-none px-2">✕</button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loadErr && <div className="text-xs text-red-500">❌ {loadErr}</div>}
          {!data && !loadErr && <div className="text-xs text-stone-400 animate-pulse py-8 text-center">{i18n("ss.loading")}</div>}

          {data && (
            <>
              {/* 掃描結果 */}
              <section>
                <div className="text-[11px] font-bold text-stone-500 mb-1.5">{i18n("ss.detectTitle")} <span className="font-normal text-stone-400">· {data.detection.scannedFiles} files</span></div>
                {data.detection.stacks.length === 0 ? (
                  <div className="text-xs text-stone-400 border border-dashed rounded-lg p-3" style={{ borderColor: t.borderLight }}>{i18n("ss.detectEmpty")}</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {[...langs, ...fws].map(s => (
                      <span key={s.id} title={s.evidence}
                        className={`text-[10px] px-2 py-1 rounded-full border ${s.kind === "language" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}
                        style={{ borderColor: t.borderLight }}>
                        {KIND_ICON[s.kind] || "📦"} {s.label}
                      </span>
                    ))}
                  </div>
                )}
                {data.unmatched.length > 0 && (
                  <div className="text-[10px] text-amber-600 mt-1.5">{i18n("ss.unmatchedNote").replace("{list}", data.unmatched.map(u => u.label).join("、"))}</div>
                )}
              </section>

              {/* 建議清單 */}
              {data.summary.newCount === 0 && (
                <div className="text-xs text-green-600 bg-green-50 border border-green-200 rounded-lg p-3">✓ {i18n("ss.noSuggestions")}</div>
              )}
              {data.agents.filter(a => a.suggestions.length > 0).map(a => (
                <section key={a.agentId}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold text-stone-700">{a.title}</span>
                    <span className="text-[9px] font-mono text-stone-400">{a.agentId}</span>
                    <span className="text-[9px] text-stone-400 ml-auto">{i18n("ss.currentCount").replace("{n}", String(a.currentSkills.length))}</span>
                  </div>
                  <div className="border rounded-lg divide-y" style={{ borderColor: t.borderLight }}>
                    {a.suggestions.map(s => {
                      const key = `${a.agentId}:${s.skillId}`;
                      return (
                        <label key={key} className={`flex items-start gap-2.5 px-3 py-2 ${s.status === "already" ? "opacity-50" : "cursor-pointer hover:bg-stone-50"}`}>
                          <input type="checkbox" className="mt-0.5 accent-emerald-600"
                            disabled={s.status === "already"}
                            checked={s.status === "already" || !!checked[key]}
                            onChange={e => setChecked(prev => ({ ...prev, [key]: e.target.checked }))} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-stone-800">{s.skillName}</span>
                              {s.status === "new"
                                ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{i18n("ss.badgeNew")}</span>
                                : <span className="text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{i18n("ss.badgeAlready")}</span>}
                            </div>
                            <div className="text-[10px] text-stone-400 mt-0.5">{i18n("ss.evidence")}：{s.evidence}</div>
                            {annotated && notes[s.skillId] && (
                              <div className="text-[10px] text-sky-700 mt-0.5 italic">🤖 {notes[s.skillId]}</div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}

              {/* AI 註解按鈕 */}
              {!annotated && (
                <button onClick={annotate} disabled={annotating || data.summary.newCount + data.summary.alreadyCount === 0}
                  className="text-xs px-3 py-2 rounded-lg border text-stone-600 hover:bg-stone-50 disabled:opacity-40" style={{ borderColor: t.borderLight }}>
                  {annotating ? i18n("ss.aiNotesRunning") : i18n("ss.aiNotes")}
                </button>
              )}
              {aiWarn && <div className="text-[10px] text-amber-600">⚠️ {aiWarn}</div>}

              {/* catalog 缺口點子 */}
              {ideas.length > 0 && (
                <section>
                  <div className="text-[11px] font-bold text-stone-500 mb-1.5">{i18n("ss.customIdeas")}</div>
                  <div className="space-y-1.5">
                    {ideas.map((idea, i) => (
                      <div key={i} className="border rounded-lg p-2.5 bg-amber-50/60" style={{ borderColor: t.borderLight }}>
                        <div className="text-xs font-bold text-stone-800">✨ {idea.name}</div>
                        <div className="text-[10px] text-stone-600 mt-0.5">{idea.purpose}</div>
                        {idea.reason && <div className="text-[10px] text-stone-400 mt-0.5">{idea.reason}</div>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {appliedMsg && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">{appliedMsg}</div>}
            </>
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t flex items-center gap-2 shrink-0" style={{ borderColor: t.borderLight, background: t.bgMuted }}>
          <button onClick={() => toggleAll(true)} className="text-[11px] px-2.5 py-1.5 rounded-lg border text-stone-600 hover:bg-white" style={{ borderColor: t.borderLight }}>
            {i18n("ss.selectNew")}
          </button>
          <div className="flex-1" />
          <button onClick={load} className="text-[11px] px-2.5 py-1.5 rounded-lg border text-stone-600 hover:bg-white" style={{ borderColor: t.borderLight }}>
            ↻ {i18n("ss.rescan")}
          </button>
          <button onClick={apply} disabled={applying}
            className="text-xs px-4 py-1.5 rounded-lg text-white font-semibold disabled:opacity-40" style={{ background: t.accent }}>
            {applying ? i18n("ss.applying") : `${i18n("ss.apply")}${checkedCount > 0 ? ` (${checkedCount})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
