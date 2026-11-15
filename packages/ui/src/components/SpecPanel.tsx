/**
 * SpecPanel — 📄 Product Spec（AI-Native Product Development Specification，2026-11-15 Fleming）
 *
 * 三欄：左 = 8 section 清單（狀態 chip）/ 中 = section markdown 編輯 / 右 = 架構師 side chat（討論範圍綁該 section）
 * - CU product-spec step 只做空 section 初稿；新 project 由架構師在這裡逐段討論產出
 * - spec_write（受控工具）寫入後 → 重新整理看最新內容
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentSideChat from "./AgentSideChat";
import MarkdownText from "./MarkdownText";

interface Theme { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string }
interface SpecSection {
  id: string; num: number; file: string; title: string; zh: string; owner: string;
  content: string; hasContent: boolean; status: string; updatedAt: string | null;
}
const STATUSES = ["draft", "review", "final"] as const;

export default function SpecPanel({ rootPath, theme }: { rootPath: string; theme: Theme }) {
  const { t: tt } = useI18n();
  const [sections, setSections] = useState<SpecSection[]>([]);
  const [activeId, setActiveId] = useState<string>("overview");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // side chat spec_write 後手動 🔄
  const active = sections.find(s => s.id === activeId) || null;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/spec?root=${encodeURIComponent(rootPath)}`);
      const d = await r.json();
      if (Array.isArray(d.sections)) setSections(d.sections);
    } catch { /* keep old */ }
  }, [rootPath]);

  useEffect(() => { load(); }, [load, reloadKey]);

  // 切 section → 離開編輯模式清 draft
  useEffect(() => { setEditing(false); setDirty(false); }, [activeId]);

  const save = useCallback(async (status?: string) => {
    if (!active) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/coding-project/spec/section`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: rootPath, section: active.id, content: draft, ...(status ? { status } : {}) }),
      });
      setEditing(false); setDirty(false);
      await load();
    } finally { setBusy(false); }
  }, [active, draft, rootPath, load]);

  const statusChip = (s: SpecSection) => {
    const map: Record<string, string> = {
      empty: "⚪", draft: "📝", review: "👀", final: "✅",
    };
    return <span className="text-[10px] shrink-0">{map[s.status] || "⚪"}</span>;
  };

  return (
    <div className="flex-1 flex min-h-0">
      {/* ── 左：section 清單 ── */}
      <div className="w-52 shrink-0 border-r overflow-y-auto py-2" style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
        <div className="px-3 pb-2 text-xs font-bold" style={{ color: theme.text }}>{tt("spec.toolbar")}</div>
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveId(s.id)}
            className={`w-full text-left px-3 py-1.5 border-l-[3px] transition-colors ${s.id === activeId ? "font-semibold" : "hover:bg-black/[.03]"}`}
            style={{ borderColor: s.id === activeId ? theme.accent : "transparent" }}>
            <div className="flex items-center gap-1.5">
              {statusChip(s)}
              <span className="text-[11px] truncate" style={{ color: theme.text }}>{s.num}. {s.title}</span>
            </div>
          </button>
        ))}
        <div className="px-3 pt-3 text-[10px] leading-relaxed opacity-60" style={{ color: theme.text }}>
          {tt("spec.statusLegend")}
        </div>
      </div>

      {/* ── 中：section 內容 ── */}
      <div className="flex-1 min-w-0 flex flex-col" style={{ background: theme.bg }}>
        {active && (
          <>
            <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: theme.borderLight }}>
              <span className="text-sm font-bold" style={{ color: theme.text }}>{active.num}. {active.title}</span>
              <span className="text-[10px] opacity-60" style={{ color: theme.text }}>{active.zh}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: theme.borderLight, color: theme.text }}>
                {tt(`spec.status.${active.status}`)}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {/* 狀態切換（final = 人定稿） */}
                {STATUSES.map(st => (
                  <button key={st} disabled={busy || active.status === "empty"}
                    onClick={() => { setDraft(active.content); save(st); }}
                    className={`text-[10px] px-2 py-1 rounded-lg border transition-colors disabled:opacity-30 ${active.status === st ? "font-bold" : ""}`}
                    style={{ borderColor: theme.borderLight, color: theme.text, background: active.status === st ? theme.accentBg : undefined }}
                    title={tt(`spec.status.${st}`)}
                  >{tt(`spec.status.${st}`)}</button>
                ))}
                <button onClick={() => { setDraft(active.content); setEditing(v => !v); setDirty(false); }} disabled={active.status === "empty"}
                  className="text-[10px] px-2 py-1 rounded-lg border disabled:opacity-30" style={{ borderColor: theme.borderLight, color: theme.text }}>
                  {editing ? tt("spec.preview") : "✏️"}
                </button>
                <button onClick={() => setReloadKey(k => k + 1)} className="text-[10px] px-2 py-1 rounded-lg border" style={{ borderColor: theme.borderLight, color: theme.text }} title={tt("spec.reload")}>🔄</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarWidth: "thin" }}>
              {editing ? (
                <div className="flex flex-col h-full gap-2">
                  <textarea value={draft} onChange={e => { setDraft(e.target.value); setDirty(true); }}
                    spellCheck={false}
                    className="flex-1 w-full rounded-lg border p-3 font-mono text-[12px] leading-relaxed resize-none focus:outline-none"
                    style={{ borderColor: theme.borderLight, background: theme.bg, color: theme.text }} />
                  <div className="flex items-center gap-2">
                    <button onClick={() => save()} disabled={busy || !dirty}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-40"
                      style={{ background: theme.accent }}>{busy ? "…" : tt("spec.save")}</button>
                    <button onClick={() => { setEditing(false); setDirty(false); }} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: theme.borderLight, color: theme.text }}>{tt("spec.cancel")}</button>
                  </div>
                </div>
              ) : active.status === "empty" ? (
                <div className="text-center py-10 text-xs opacity-60" style={{ color: theme.text }}>
                  <div className="text-3xl mb-2">📄</div>
                  {tt("spec.emptyHint")}
                </div>
              ) : (
                <div className="text-sm leading-relaxed" style={{ color: theme.text }}>
                  <MarkdownText>{active.content}</MarkdownText>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── 右：架構師 side chat（討論範圍綁當前 section）── */}
      <div className="shrink-0 hidden md:block w-[360px]">
        <AgentSideChat
          key={activeId /* 切 section → 新對話線，context 乾淨 */}
          agentId="spec"
          agentName={tt("spec.agentName")}
          agentEmoji="📄"
          greeting={tt("spec.agentGreeting")}
          cwd={rootPath}
          accent={theme.accent}
          height="100%"
          persistCrewId={`coding.spec-side.${activeId}`}
          modelFeature="sideChat.spec"
          placeholder={tt("spec.chatPlaceholder")}
          suggestions={[
            { label: tt("spec.sug.draft"), prompt: tt("spec.sug.draftPrompt").replace("{section}", active ? `${active.num}. ${active.title}` : "") },
            { label: tt("spec.sug.review"), prompt: tt("spec.sug.reviewPrompt").replace("{section}", active ? `${active.num}. ${active.title}` : "") },
          ]}
          headerActions={() => (
            <button onClick={() => setReloadKey(k => k + 1)} className="text-[10px] px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:bg-stone-50" title={tt("spec.reload")}>🔄</button>
          )}
        />
      </div>
    </div>
  );
}
