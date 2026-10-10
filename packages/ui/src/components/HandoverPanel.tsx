/**
 * HandoverPanel — 🤝 交接頁
 *
 * 「人要可以很容易懂、可以接手、指揮 AI 開發和維運」
 *
 * 左：交接包（專案是什麼/為什麼這樣設計/最近改什麼/進行中/怎麼跑）
 *     + 一鍵生成 .paaw/HANDOVER.md
 * 右：Handover AI 助理（新人問答，context 帶知識庫）
 *
 * 空狀態：.paaw/ 不存在或知識檔案缺 → 引導先跑 Code Understanding。
 */

import React, { useState, useEffect, useCallback, Component, useMemo, useRef } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";
import { useColResize, ColResizer } from "./ColResizer"; // 2026-10-09：side chat 左右 splitter
import MarkdownText from "./MarkdownText";

class HandoverErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <span className="text-2xl">💥</span>
          <div className="text-xs text-red-600 font-bold">Handover 頁面錯誤</div>
          <pre className="text-[10px] text-stone-500 bg-stone-50 rounded p-2 max-w-md overflow-auto">{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })} className="text-xs px-3 py-1.5 rounded bg-blue-500 text-white">重試</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Markdown renderer with parse error fallback — prevents ReactMarkdown crashes from white-screening */
function SafeMarkdown({ content }: { content: string }) {
  const [parseError, setParseError] = useState<string | null>(null);
  const sanitized = useMemo(() => {
    // Pre-sanitize: escape patterns known to crash react-markdown 10
    // 1. Remove raw HTML that might break the parser
    // 2. Ensure code blocks are properly closed
    try {
      let md = content;
      // Count code fences — if odd, append closing fence
      const fenceCount = (md.match(/```/g) || []).length;
      if (fenceCount % 2 !== 0) md += "\n```";
      return md;
    } catch {
      return content;
    }
  }, [content]);

  if (parseError) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] text-amber-600 font-bold">⚠️ Markdown 渲染失敗，顯示原始內容</div>
        <pre className="text-[11px] text-stone-500 whitespace-pre-wrap break-words font-mono">{content}</pre>
      </div>
    );
  }

  return (
    <ErrorBoundary onCatch={(err: Error) => setParseError(err.message)}>
      <MarkdownText>{sanitized}</MarkdownText>
    </ErrorBoundary>
  );
}

/** Lightweight error boundary that calls onCatch instead of replacing UI */
class ErrorBoundary extends Component<{ onCatch: (err: Error) => void; children: React.ReactNode }, {}> {
  static getDerivedStateFromError() { return {}; }
  componentDidCatch(err: Error) { this.props.onCatch(err); }
  render() { return this.props.children; }
}

interface HandoverBundle {
  initialized: boolean;
  generatedAt: string;
  knowledge: Record<string, string | null>;
  git: { log: string[]; status: { dirty: boolean; files: string[] } };
  package: { name: string | null; scripts: Record<string, string>; dependencies: string[]; devDependenciesCount: number } | null;
  activeTasks: { id: string; title: string; status: string; priority: string }[];
  releases: { id: string; taskId: string; title: string; releasedAt: string }[];
  hasKnowledge: boolean;
}

interface Props {
  rootPath: string;
  theme: any;
  onOpenEMDashboard?: () => void;
  /** 2026-10-09：keep-mounted 下切回 tab 時要重新拉 state（commit 後畫面不再停在舊快照） */
  active?: boolean;
}

export default function HandoverPanel({ rootPath, theme: tk, onOpenEMDashboard, active = true }: Props) {
  const { t } = useI18n();
  const [bundle, setBundle] = useState<HandoverBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandSection, setExpandSection] = useState<string | null>(null);
  // 2026-10-10 Fleming：新人 12 問 tab 移除（過度設計）— 單欄交接包 + AI 摘要 + 人員注記
  // AI 摘要包（brief）：懶生成 — 進頁 GET，無快取自動 POST 生成（平時/CU 不燒 token）
  const [brief, setBrief] = useState<any | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [remarks, setRemarks] = useState<{ id: string; target: string; text: string; author: string; at: string }[]>([]);
  const [remarkText, setRemarkText] = useState("");
  const [remarkSaving, setRemarkSaving] = useState(false);
  const chatRef = useRef<AgentSideChatHandle>(null);
  const composingRef = useRef(false); // IME composition 三層保護（2026-07-04 紀律）
  // 2026-10-09 Fleming：Handover side chat 左右 splitter + 對話持久化 + model selector（跟 QA browser 同款）
  const hoPane = useColResize(520, 300, 760); // 2026-10-09：與 Troubleshooting/Release Manager 統一

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-handover/bundle?path=${encodeURIComponent(rootPath)}`);
      if (!res.ok) {
        console.error(`[Handover] bundle API ${res.status}`);
        setBundle(null);
        setLoading(false);
        return;
      }
      const data = await res.json();
      // Validate shape
      if (!data || typeof data !== "object" || !("initialized" in data)) {
        console.error("[Handover] unexpected bundle shape:", data);
        setBundle(null);
        setLoading(false);
        return;
      }
      setBundle(data);
    } catch (err) {
      console.error("[Handover] fetch failed:", err);
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => { refresh(); }, [refresh]);
  // 2026-10-09 Fleming：keep-mounted 模式下切回 handover tab 時重新拉 — 否則 commit 後畫面還在舊快照（「都 commit 了為何還有 9 個未提交」）
  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  const section = (key: string, icon: string, title: string, content: string | null) => {
    const has = !!content?.trim();
    const isOpen = expandSection === key;
    // 2026-10-09 Fleming：knowledge 顯示清洗 — schema marker/元資料/placeholder 濾掉、連續重複行去重、標題降兩級（字體跟其他區塊一致）
    const cleanKnowledge = (raw: string) => {
      const lines = raw.split("\n").filter(l => {
        const s = l.trim();
        if (/^<!--[\s\S]*-->$/.test(s)) return false;              // <!-- ... --> marker 註解
        if (/^>\s*📄/.test(l)) return false;                          // > 📄 Schema v2 ·… 元資料
        if (/^（人在 UI 或直接編輯/.test(s)) return false;               // user 區 placeholder
        return true;
      });
      const dedup: string[] = [];
      for (const l of lines) {
        if (l.trim() !== "" && dedup.length && dedup[dedup.length - 1].trim() === l.trim()) continue;
        dedup.push(l);
      }
      return dedup.join("\n")
        .replace(/^### /gm, "##### ")   // 先長後短（避免二次替換）
        .replace(/^## /gm, "#### ")
        .replace(/^# /gm, "### ");
    };
    const shown = has ? cleanKnowledge(content!) : null;
    return (
      <div key={key} className="border rounded-xl overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
        <button onClick={() => setExpandSection(isOpen ? null : key)}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-stone-50 text-left">
          <span>{icon}</span>
          <span className="text-xs font-bold text-stone-700">{title}</span>
          {!has && <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-400">{t("ho.missing")}</span>}
          <span className="ml-auto text-[10px] text-stone-400">{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen && (
          <div className="border-t px-3.5 py-2.5" style={{ borderColor: tk.borderLight }}>
            {shown ? (
              /* 2026-10-09 Fleming：main info 內容字級與 Troubleshooting/Release Manager 對齊（11px）—
                 MarkdownText root 的 text-sm(14px) 會蓋掉外層，這裡用 arbitrary variants 壓回來（不動共用元件） */
              <div className="text-[11px] text-stone-600 leading-relaxed [&_.md-content]:!text-[11px] [&_.md-content_h1]:!text-xs [&_.md-content_h2]:!text-xs [&_.md-content_h3]:!text-[11px] [&_.md-content_h4]:!text-[11px] [&_.md-content_h5]:!text-[11px] [&_.md-content_p]:!text-[11px] [&_.md-content_li]:!text-[11px] [&_.md-content_td]:!text-[11px]">
                <SafeMarkdown content={shown} />
              </div>
            ) : (
              <div className="text-[11px] text-stone-400">{t("ho.missingDesc")}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── brief 懶生成（2026-10-10 Fleming：進頁才觸發、有快取用快取）──
  const ensureBrief = useCallback(async (force = false) => {
    if (!rootPath || briefLoading) return;
    if (!force) {
      try {
        const r = await fetch(`${API_BASE}/api/coding-handover/brief?path=${encodeURIComponent(rootPath)}`);
        if (r.ok) {
          const d = await r.json();
          if (d.brief) { setBrief(d.brief); setRemarks(d.remarks || []); return; }
        }
      } catch { /* fallthrough 生成 */ }
    }
    setBriefLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-handover/brief?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
      if (r.ok) {
        const d = await r.json();
        setBrief(d.brief); setRemarks(d.remarks || []);
      }
    } catch { /* 生成失敗 — 顯示 deterministic 區不受影響 */ }
    setBriefLoading(false);
  }, [rootPath, briefLoading]);

  useEffect(() => { if (active && bundle?.initialized && bundle.hasKnowledge) ensureBrief(); }, [active, bundle?.initialized, bundle?.hasKnowledge, ensureBrief]);

  const addRemark = useCallback(async () => {
    const text = remarkText.trim();
    if (!text || remarkSaving || !rootPath) return;
    setRemarkSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-handover/remark?path=${encodeURIComponent(rootPath)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target: "general" }),
      });
      if (r.ok) { const d = await r.json(); setRemarks(d.remarks || []); setRemarkText(""); }
    } catch { /* silent */ }
    setRemarkSaving(false);
  }, [remarkText, remarkSaving, rootPath]);

  const delRemark = useCallback(async (id: string) => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-handover/remark?path=${encodeURIComponent(rootPath)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r.ok) { const d = await r.json(); setRemarks(d.remarks || []); }
    } catch { /* silent */ }
  }, [rootPath]);

  return (
    <HandoverErrorBoundary>
    <div className="flex h-full min-h-0">
      {/* ── 左：內容區 ── */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="px-5 py-3 border-b sticky top-0 bg-white/95 backdrop-blur z-10 flex items-center gap-2" style={{ borderColor: tk.borderLight }}>
          <span className="text-lg">🤝</span>
          <h2 className="text-sm font-bold text-stone-800">{t("ho.title")}</h2>
          {bundle?.package?.name && <span className="text-[10px] font-mono text-stone-400">{bundle.package.name}</span>}
        </div>

        {loading && <div className="p-8 text-center text-xs text-stone-400 animate-pulse">{t("common.loading")}</div>}

        {/* ═══ 空狀態：未初始化或無知識 ═══ */}
        {!loading && bundle && (!bundle.initialized || !bundle.hasKnowledge) && (
          <div className="p-8">
            <div className="max-w-md mx-auto text-center border rounded-xl p-6 bg-stone-50" style={{ borderColor: tk.borderLight }}>
              <div className="text-3xl mb-2">{bundle.initialized ? "📖" : "🌱"}</div>
              <h3 className="text-sm font-bold text-stone-700 mb-1">
                {bundle.initialized ? t("ho.emptyNoKnowledge.title") : t("ho.emptyInit.title")}
              </h3>
              <p className="text-xs text-stone-500 leading-relaxed mb-4">
                {bundle.initialized ? t("ho.emptyNoKnowledge.desc") : t("ho.emptyInit.desc")}
              </p>
              {onOpenEMDashboard && (
                <button onClick={onOpenEMDashboard}
                  className="text-xs px-4 py-2 rounded-lg text-white" style={{ backgroundColor: tk.accent }}>
                  {t("ho.emptyInit.goEM")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══ 交接包（2026-10-10：12 問 tab 移除 — 單欄）═══ */}
        {!loading && bundle?.initialized && bundle.hasKnowledge && (
          <div>
          <div className="p-5 space-y-4">

            {/* ── 🧠 AI 摘要包（brief：懶生成 — 進頁觸發一次）── */}
            <div className="border rounded-xl overflow-hidden bg-gradient-to-b from-blue-50/60 to-white" style={{ borderColor: tk.borderLight }}>
              <div className="flex items-center gap-2 px-3.5 py-2.5">
                <span>🧠</span>
                <span className="text-xs font-bold text-stone-700">{t("ho.brief.title")}</span>
                <span className="ml-auto flex items-center gap-2">
                  {brief?.generatedAt && <span className="text-[10px] text-stone-400">{brief.generatedAt.slice(0, 16).replace("T", " ")}</span>}
                  <button onClick={() => ensureBrief(true)} disabled={briefLoading}
                    className="text-[10px] px-2 py-0.5 rounded border disabled:opacity-40 hover:bg-stone-50" style={{ borderColor: tk.borderLight }}>
                    {briefLoading ? "…" : `↻ ${t("ho.brief.regenerate")}`}
                  </button>
                </span>
              </div>
              <div className="border-t px-3.5 py-2.5 space-y-2.5" style={{ borderColor: tk.borderLight }}>
                {briefLoading && !brief && <div className="text-[11px] text-stone-400 animate-pulse">{t("ho.brief.generating")}</div>}
                {!briefLoading && !brief && <div className="text-[11px] text-stone-400">{t("ho.brief.none")}</div>}
                {brief?.ai?.error && <div className="text-[11px] text-amber-600">⚠️ {brief.ai.error}</div>}
                {brief?.ai?.summary && <div className="text-[12px] text-stone-700 font-medium leading-relaxed">{brief.ai.summary}</div>}
                {brief?.ai?.dangerZones?.length > 0 && (
                  <div className="bg-red-50 rounded-lg p-2 space-y-0.5">
                    <div className="text-[10px] font-bold text-red-700">⚠️ {t("ho.brief.danger")}</div>
                    {brief.ai.dangerZones.map((z: string, i: number) => <div key={i} className="text-[11px] text-red-600">• {z}</div>)}
                  </div>
                )}
                {brief?.ai?.quickstart && (brief.ai.quickstart.steps?.length > 0 || brief.ai.quickstart.env?.length > 0) && (
                  <div>
                    <div className="text-[10px] font-bold text-stone-500 mb-0.5">▶️ {t("ho.brief.quickstart")}</div>
                    {brief.ai.quickstart.env?.length > 0 && <div className="text-[10px] text-stone-500 mb-1">{brief.ai.quickstart.env.join(" · ")}</div>}
                    {brief.ai.quickstart.steps?.map((st: string, i: number) => (
                      <div key={i} className="text-[11px] text-stone-600 flex gap-1.5"><span className="text-stone-400 font-mono">{i + 1}.</span><span>{st}</span></div>
                    ))}
                  </div>
                )}
                {brief?.ai?.decisions?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-stone-500 mb-0.5">🏛 {t("ho.brief.decisions")}</div>
                    {brief.ai.decisions.map((d: any, i: number) => (
                      <div key={i} className="text-[11px] text-stone-600 leading-relaxed">
                        • <span className="font-medium">{d.title}</span>{d.gap ? <span className="text-amber-600">（{t("ho.brief.gap")}）</span> : null}
                        <span className="text-stone-500"> — {d.why}</span>
                        {d.evidence && !d.gap && <span className="text-stone-400 font-mono text-[10px]"> [{d.evidence.slice(0, 40)}]</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {section("project", "🎯", t("ho.sec.project"), bundle.knowledge.project)}

            {/* Git 歷史 */}
            <div className="border rounded-xl overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
              <button onClick={() => setExpandSection(expandSection === "git" ? null : "git")}
                className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-stone-50 text-left">
                <span>🔄</span>
                <span className="text-xs font-bold text-stone-700">{t("ho.sec.gitLog")}</span>
                <span className="ml-auto text-[10px] text-stone-400">{expandSection === "git" ? "▾" : "▸"}</span>
              </button>
              {expandSection === "git" && (
                <div className="border-t px-3.5 py-2.5 max-h-56 overflow-y-auto" style={{ borderColor: tk.borderLight }}>
                  {bundle.git.log.length ? (
                    <pre className="text-[10px] font-mono text-stone-600 leading-relaxed">{bundle.git.log.join("\n")}</pre>
                  ) : (
                    <div className="text-[11px] text-stone-400">{t("ho.noGit")}</div>
                  )}
                </div>
              )}
            </div>

            {/* 進行中 task */}
            <div className="border rounded-xl overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
              <button onClick={() => setExpandSection(expandSection === "tasks" ? null : "tasks")}
                className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-stone-50 text-left">
                <span>📋</span>
                <span className="text-xs font-bold text-stone-700">{t("ho.sec.activeTasks")}</span>
                {bundle.activeTasks.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">{bundle.activeTasks.length}</span>}
                <span className="ml-auto text-[10px] text-stone-400">{expandSection === "tasks" ? "▾" : "▸"}</span>
              </button>
              {expandSection === "tasks" && (
                <div className="border-t px-3.5 py-2.5" style={{ borderColor: tk.borderLight }}>
                  {bundle.activeTasks.length ? (
                    <div className="space-y-1">
                      {bundle.activeTasks.map(t2 => (
                        <div key={t2.id} className="text-[11px] text-stone-600 flex gap-2">
                          <span className={`px-1 rounded ${t2.status === "in-progress" ? "bg-blue-50 text-blue-600" : "bg-stone-100 text-stone-500"}`}>{t2.status}</span>
                          <span className="font-mono text-stone-400">{t2.id}</span>
                          <span className="truncate">{t2.title}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-stone-400">{t("ho.noActiveTasks")}</div>
                  )}
                </div>
              )}
            </div>

            {/* 怎麼跑 */}
            {bundle.package?.scripts && Object.keys(bundle.package.scripts).length > 0 && (
              <div className="border rounded-xl overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
                <button onClick={() => setExpandSection(expandSection === "run" ? null : "run")}
                  className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-stone-50 text-left">
                  <span>▶️</span>
                  <span className="text-xs font-bold text-stone-700">{t("ho.sec.run")}</span>
                  <span className="ml-auto text-[10px] text-stone-400">{expandSection === "run" ? "▾" : "▸"}</span>
                </button>
                {expandSection === "run" && (
                  <div className="border-t px-3.5 py-2.5" style={{ borderColor: tk.borderLight }}>
                    <pre className="text-[10px] font-mono text-stone-600 leading-relaxed">
                      {["dev", "start", "build", "test", "lint"].filter(s => bundle.package!.scripts[s]).map(s => `npm run ${s}`).join("\n")}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* ── ✍️ 人員注記（remarks：作者資產 — 重生成永不覆蓋）── */}
            <div className="border rounded-xl overflow-hidden bg-amber-50/40" style={{ borderColor: tk.borderLight }}>
              <div className="flex items-center gap-2 px-3.5 py-2.5">
                <span>✍️</span>
                <span className="text-xs font-bold text-stone-700">{t("ho.remark.title")}</span>
                {remarks.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">{remarks.length}</span>}
              </div>
              <div className="border-t px-3.5 py-2.5 space-y-2" style={{ borderColor: tk.borderLight }}>
                {remarks.map(r => (
                  <div key={r.id} className="flex items-start gap-2 group">
                    <span className="text-[10px] text-amber-600 font-mono mt-0.5">{(r.at || "").slice(5, 10)}</span>
                    <div className="text-[11px] text-stone-700 leading-relaxed flex-1">{r.text}</div>
                    <button onClick={() => delRemark(r.id)} className="opacity-0 group-hover:opacity-100 text-[10px] text-stone-400 hover:text-red-500" title={t("ho.remark.delete")}>✕</button>
                  </div>
                ))}
                {remarks.length === 0 && <div className="text-[11px] text-stone-400">{t("ho.remark.empty")}</div>}
                <div className="flex gap-2 items-start">
                  <textarea
                    value={remarkText}
                    onChange={(e) => setRemarkText(e.target.value)}
                    onCompositionStart={() => (composingRef.current = true)}
                    onCompositionEnd={() => (composingRef.current = false)}
                    onKeyDown={(e) => {
                      if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addRemark(); }
                    }}
                    placeholder={t("ho.remark.placeholder")}
                    rows={2}
                    className="flex-1 text-[11px] rounded-lg border px-2.5 py-1.5 resize-y focus:outline-none focus:ring-1"
                    style={{ borderColor: tk.borderLight }}
                  />
                  <button onClick={addRemark} disabled={!remarkText.trim() || remarkSaving}
                    className="text-[11px] px-3 py-1.5 rounded-lg text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: tk.accent }}>
                    {remarkSaving ? "…" : t("ho.remark.add")}
                  </button>
                </div>
              </div>
            </div>

          </div>
          </div>
        )}
      </div>

      {/* ── 右：Handover AI 助理 ── */}
      {/* 2026-10-09 Fleming：跟 QA browser 同款 — splitter 可拖寬 + 三按鈕（persistCrewId）+ model selector */}
      <ColResizer onDown={hoPane.startDrag} className="hidden md:block" />
      <div className="shrink-0 hidden md:block" style={{ width: hoPane.width }}>
        <AgentSideChat ref={chatRef}
          agentId="handover"
          agentName={t("ho.agentName")}
          agentEmoji="🤝"
          greeting={t("ho.agentGreeting")}
          cwd={rootPath}
          accent={tk.accent}
          accentHover={tk.accentHover || tk.accent}
          height="100%"
          persistCrewId="coding.handover-side"
          modelFeature="sideChat.handover"
          suggestions={[
            { label: t("ho.sug.brief"), prompt: t("ho.sug.briefPrompt") },
            { label: t("ho.sug.why"), prompt: t("ho.sug.whyPrompt") },
            { label: t("ho.sug.day1"), prompt: t("ho.sug.day1Prompt") },
          ]}
        />
      </div>
    </div>
    </HandoverErrorBoundary>
  );
}

