/**
 * HandoverPanel — 🤝 交接頁（v2 — 2026-11-08 Fleming 改版）
 *
 * 面向式交接文件（AI 一鍵生成，人不介入）：
 *   專案定位 / 技術棧 / Storage / 外部服務與金鑰 / 認證 / Cache / 高風險區
 *   / AI 開發方式（SA 開 task → EM 派工）/ 怎麼跑起來 / 疑難排解 FAQ（helpdesk agent）
 *   + ✍️ Remarks 人員注記（人工資產 — 重生成永不覆蓋）
 *
 * 移除（Fleming 2026-11-08）：Git 演進史、進行中工作（不需要）、舊 brief 摘要卡
 *
 * 右：Handover AI 助理（新人問答，context 帶知識庫）
 */

import React, { useState, useEffect, useCallback, Component, useMemo, useRef } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";
import { useColResize, ColResizer } from "./ColResizer";
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
    try {
      let md = content;
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

// Handover 文件 v2（2026-11-08 Fleming）：面向式交接 — 與 server HO_DOC_SECTIONS 對齊
const DOC_SECTIONS: { key: string; icon: string }[] = [
  { key: "positioning", icon: "🎯" },
  { key: "techStack", icon: "🧱" },
  { key: "storage", icon: "💾" },
  { key: "externalServices", icon: "🔌" },
  { key: "auth", icon: "🔐" },
  { key: "cache", icon: "⚡" },
  { key: "risks", icon: "⚠️" },
  { key: "aiWorkflow", icon: "🛠️" },
  { key: "quickstart", icon: "▶️" },
];

interface HandoverDoc {
  version: number;
  generatedAt: string;
  sections: Record<string, string>;
  faq: string;
  meta?: Record<string, any>;
}

interface Props {
  rootPath: string;
  theme: any;
  onOpenEMDashboard?: () => void;
  /** keep-mounted 下切回 tab 時要重新拉 state */
  active?: boolean;
}

export default function HandoverPanel({ rootPath, theme: tk, onOpenEMDashboard, active = true }: Props) {
  const { t } = useI18n();
  const [bundle, setBundle] = useState<HandoverBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandSection, setExpandSection] = useState<string | null>(null);
  // Handover 文件 v2（2026-11-08）：一鍵生成 — 人不介入
  const [doc, setDoc] = useState<HandoverDoc | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<{ id: string; target: string; text: string; author: string; at: string }[]>([]);
  const [remarkText, setRemarkText] = useState("");
  const [remarkSaving, setRemarkSaving] = useState(false);
  const chatRef = useRef<AgentSideChatHandle>(null);
  const composingRef = useRef(false); // IME composition 三層保護（2026-07-04 紀律）
  const hoPane = useColResize(520, 300, 760);

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
  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  // Handover 文件 v2：讀快取（進頁零 Token）+ 一鍵生成（POST — 掃專案生最新）
  const loadDoc = useCallback(async () => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-handover/doc?path=${encodeURIComponent(rootPath)}`);
      if (r.ok) {
        const d = await r.json();
        setDoc(d.doc || null);
        if (d.remarks) setRemarks(d.remarks || []);
      }
    } catch { /* silent */ }
  }, [rootPath]);

  const generateDoc = useCallback(async () => {
    if (!rootPath || docLoading) return;
    setDocLoading(true); setDocError(null);
    try {
      const r = await fetch(`${API_BASE}/api/coding-handover/doc?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
      if (r.ok) {
        const d = await r.json();
        setDoc(d.doc);
        if (d.remarks) setRemarks(d.remarks || []);
      } else {
        setDocError((await r.json().catch(() => ({}))).error || t("ho.doc.failed"));
      }
    } catch { setDocError(t("ho.doc.failed")); }
    setDocLoading(false);
  }, [rootPath, docLoading, t]);

  useEffect(() => { if (active && bundle?.initialized) loadDoc(); }, [active, bundle?.initialized, loadDoc]);

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

  /** 面向 section 卡（AI 產生內容） */
  const docSection = (key: string, icon: string, content: string) => {
    const isOpen = expandSection === key;
    return (
      <div key={key} className="border rounded-xl overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
        <button onClick={() => setExpandSection(isOpen ? null : key)}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-stone-50 text-left">
          <span>{icon}</span>
          <span className="text-xs font-bold text-stone-700">{t(`ho.doc.sec.${key}`)}</span>
          <span className="ml-auto text-[10px] text-stone-400">{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen && (
          <div className="border-t px-3.5 py-2.5" style={{ borderColor: tk.borderLight }}>
            <div className="text-[11px] text-stone-600 leading-relaxed [&_.md-content]:!text-[11px] [&_.md-content_h1]:!text-xs [&_.md-content_h2]:!text-xs [&_.md-content_h3]:!text-[11px] [&_.md-content_h4]:!text-[11px] [&_.md-content_p]:!text-[11px] [&_.md-content_li]:!text-[11px] [&_.md-content_code]:!text-[10px]">
              <SafeMarkdown content={content} />
            </div>
          </div>
        )}
      </div>
    );
  };

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

        {/* ═══ 空狀態：未初始化 ═══ */}
        {!loading && bundle && !bundle.initialized && (
          <div className="p-8">
            <div className="max-w-md mx-auto text-center border rounded-xl p-6 bg-stone-50" style={{ borderColor: tk.borderLight }}>
              <div className="text-3xl mb-2">🌱</div>
              <h3 className="text-sm font-bold text-stone-700 mb-1">{t("ho.emptyInit.title")}</h3>
              <p className="text-xs text-stone-500 leading-relaxed mb-4">{t("ho.emptyInit.desc")}</p>
              {onOpenEMDashboard && (
                <button onClick={onOpenEMDashboard}
                  className="text-xs px-4 py-2 rounded-lg text-white" style={{ backgroundColor: tk.accent }}>
                  {t("ho.emptyInit.goEM")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══ Handover 文件 v2（2026-11-08 Fleming：面向式 — 一鍵生成，人不介入）═══ */}
        {!loading && bundle?.initialized && (
          <div>
          <div className="p-5 space-y-4">

            {/* ── 一鍵生成 header card ── */}
            <div className="border rounded-xl overflow-hidden bg-gradient-to-b from-blue-50/60 to-white" style={{ borderColor: tk.borderLight }}>
              <div className="flex items-center gap-2 px-3.5 py-2.5">
                <span>🧠</span>
                <span className="text-xs font-bold text-stone-700">{t("ho.title")} — AI 交接文件</span>
                <span className="ml-auto flex items-center gap-2">
                  {doc?.generatedAt && <span className="text-[10px] text-stone-400">{doc.generatedAt.slice(0, 16).replace("T", " ")}</span>}
                  <button onClick={generateDoc} disabled={docLoading}
                    className="text-[10px] px-2.5 py-1 rounded border disabled:opacity-40 hover:bg-stone-50 font-medium" style={{ borderColor: tk.borderLight }}>
                    {docLoading ? "⏳ …" : `🔄 ${doc ? t("ho.doc.regenerate") : t("ho.doc.generate")}`}
                  </button>
                </span>
              </div>
              <div className="border-t px-3.5 py-2.5" style={{ borderColor: tk.borderLight }}>
                {docLoading && <div className="text-[11px] text-stone-400 animate-pulse">{t("ho.doc.generating")}</div>}
                {!docLoading && !doc && (
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-stone-400">{t("ho.doc.none")}</span>
                    <button onClick={generateDoc} className="text-[11px] px-3 py-1.5 rounded-lg text-white font-medium" style={{ backgroundColor: tk.accent }}>{t("ho.doc.generate")}</button>
                  </div>
                )}
                {docError && <div className="text-[11px] text-red-600">⚠️ {docError}</div>}
                {doc && !docLoading && Object.keys(doc.sections).length < DOC_SECTIONS.length - 1 && (
                  <div className="text-[10px] text-amber-600">{t("ho.doc.partial")}</div>
                )}
              </div>
            </div>

            {/* ── 各面向 section（AI 產生，有內容才顯示）── */}
            {doc && DOC_SECTIONS.map(({ key, icon }) => {
              const content = doc.sections?.[key];
              if (!content?.trim()) return null;
              return docSection(key, icon, content);
            })}

            {/* ── 🚑 疑難排解 FAQ（helpdesk agent 回答）── */}
            {doc?.faq && (
              <div className="border rounded-xl overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
                <button onClick={() => setExpandSection(expandSection === "faq" ? null : "faq")}
                  className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-stone-50 text-left">
                  <span>🚑</span>
                  <span className="text-xs font-bold text-stone-700">{t("ho.doc.faq")}</span>
                  <span className="ml-auto text-[10px] text-stone-400">{expandSection === "faq" ? "▾" : "▸"}</span>
                </button>
                {expandSection === "faq" && (
                  <div className="border-t px-3.5 py-2.5" style={{ borderColor: tk.borderLight }}>
                    <div className="text-[11px] text-stone-600 leading-relaxed [&_.md-content]:!text-[11px] [&_.md-content_h3]:!text-[11px] [&_.md-content_p]:!text-[11px] [&_.md-content_li]:!text-[11px]">
                      <SafeMarkdown content={doc.faq} />
                    </div>
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
