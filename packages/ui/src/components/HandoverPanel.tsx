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

import React, { useState, useEffect, useCallback, Component, useMemo } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentSideChat from "./AgentSideChat";
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
}

export default function HandoverPanel({ rootPath, theme: tk, onOpenEMDashboard }: Props) {
  const { t } = useI18n();
  const [bundle, setBundle] = useState<HandoverBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [expandSection, setExpandSection] = useState<string | null>("project");

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

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-handover/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath }),
      });
      const data = await res.json();
      setToast(data.ok
        ? { ok: true, text: `✅ ${t("ho.generated")}: ${data.file} (${(data.bytes / 1024).toFixed(1)} KB)` }
        : { ok: false, text: `❌ ${data.error || "生成失敗"}` });
    } catch (e: any) {
      setToast({ ok: false, text: `❌ ${e?.message || "連線失敗"}` });
    } finally {
      setGenerating(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const section = (key: string, icon: string, title: string, content: string | null, maxLines: number) => {
    const has = !!content?.trim();
    const isOpen = expandSection === key;
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
          <div className="border-t px-3.5 py-2.5 max-h-64 overflow-y-auto" style={{ borderColor: tk.borderLight, scrollbarWidth: "thin" }}>
            {has ? (
              <div className="text-[11px] text-stone-600 leading-relaxed">
                <SafeMarkdown content={content!.split("\n").slice(0, maxLines).join("\n") + (content!.split("\n").length > maxLines ? `\n… (${content!.split("\n").length - maxLines} more lines)` : "")} />
              </div>
            ) : (
              <div className="text-[11px] text-stone-400">{t("ho.missingDesc")}</div>
            )}
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
          <button onClick={generate} disabled={generating || !bundle?.initialized}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: tk.accent }}>
            {generating ? "…" : `📝 ${t("ho.generate")}`}
          </button>
        </div>

        {toast && (
          <div className={`mx-5 mt-3 px-3 py-2 rounded-lg text-xs ${toast.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {toast.text}
          </div>
        )}

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

        {/* ═══ 交接包 ═══ */}
        {!loading && bundle?.initialized && bundle.hasKnowledge && (
          <div className="p-5 space-y-4">
            {/* 快覽列 */}
            <div className="grid grid-cols-4 gap-2">
              <StatCard label={t("ho.stat.tasks")} value={String(bundle.activeTasks.length)} icon="📋" />
              <StatCard label={t("ho.stat.releases")} value={String(bundle.releases.length)} icon="🚀" />
              <StatCard label={t("ho.stat.deps")} value={bundle.package ? String(bundle.package.dependencies.length) : "—"} icon="📦" />
              <StatCard label={t("ho.stat.git")} value={bundle.git.status.dirty ? t("ho.stat.dirty") : t("ho.stat.clean")} icon={bundle.git.status.dirty ? "⚠️" : "✅"} />
            </div>

            {section("project", "🎯", t("ho.sec.project"), bundle.knowledge.project, 40)}
            {section("architecture", "🏗️", t("ho.sec.architecture"), bundle.knowledge.architecture, 60)}
            {section("decisions", "🧠", t("ho.sec.decisions"), bundle.knowledge.decisions, 80)}
            {section("changelog", "📜", t("ho.sec.changelog"), bundle.knowledge.changelog, 40)}

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
          </div>
        )}
      </div>

      {/* ── 右：Handover AI 助理 ── */}
      <div className="w-[320px] shrink-0 hidden md:block">
        <AgentSideChat
          agentId="handover"
          agentName={t("ho.agentName")}
          agentEmoji="🤝"
          greeting={t("ho.agentGreeting")}
          cwd={rootPath}
          accent={tk.accent}
          height="100%"
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

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="border rounded-lg px-2.5 py-2 bg-white text-center" style={{ borderColor: "#e7e5e4" }}>
      <div className="text-sm">{icon}</div>
      <div className="text-sm font-bold text-stone-700 font-mono">{value}</div>
      <div className="text-[9px] text-stone-400">{label}</div>
    </div>
  );
}
