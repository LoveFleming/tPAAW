/**
 * ProjectMdPage — 📄 Prod Spec（PROJECT.md）唯讀渲染頁
 *
 * 2026-11-16 Fleming：product spec 做在 project page；tab 改名 Prod Spec、跟 PAAW project 解耦
 * 2026-11-16 Fleming（晚，定版）：頁面**唯讀** — render 好的 markdown + mermaid 圖
 *   人不直接改；全部從右邊林曉薇（架構師）side chat 討論 → 收斂後她用 spec_write 工具寫入
 * - 上方 8 個 section tab（綠點 = 有內容）+ 🔄 重新載入
 * 檔案：.paaw/PROJECT.md（marker 切區，server lib/project-md.mjs 同 schema）
 */

import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentSideChat from "./AgentSideChat";
import MarkdownText from "./MarkdownText"; // 渲染 markdown + mermaid 圖（sequenceDiagram / flowchart）

interface Props {
  rootPath: string;
  theme?: { bg?: string; bgMuted?: string; borderLight?: string; accent?: string; accentBg?: string; text?: string };
}

export default function ProjectMdPage({ rootPath, theme }: Props) {
  const { t } = useI18n();
  const tk = theme || {};
  const [exists, setExists] = useState<boolean | null>(null); // null = loading
  const [sections, setSections] = useState<string[]>(new Array(8).fill(""));
  const [activeIdx, setActiveIdx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showChat, setShowChat] = useState(true); // 林曉薇 side chat 開關（預設開）

  const load = useCallback(async () => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/project-md?path=${encodeURIComponent(rootPath)}`);
      const d = await r.json();
      setExists(!!d.exists);
      setSections((d.specSections && d.specSections.length === 8) ? d.specSections : new Array(8).fill(""));
    } catch {
      setExists(false);
    }
  }, [rootPath]);

  useEffect(() => { setExists(null); load(); }, [load]);
  // 曉薇寫入後自動看到：切 tab 或視窗聚焦時重抓（輕量，不打擾）
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!rootPath) return null;
  if (exists === null) {
    return <div className="flex items-center justify-center h-full text-stone-400 text-sm">⏳ {t("projectMd.loading")}</div>;
  }

  const tabLabels = [
    t("projectMd.sec1"), t("projectMd.sec2"), t("projectMd.sec3"), t("projectMd.sec4"),
    t("projectMd.sec5"), t("projectMd.sec6"), t("projectMd.sec7"), t("projectMd.sec8"),
  ];

  return (
    <div className="flex h-full overflow-hidden" style={{ background: tk.bg || "#fff" }}>

      {/* ── 左：📄 Product Spec（唯讀渲染 — 全靠右邊曉薇用 spec_write 寫入）── */}
      <div className="flex-1 min-w-0 px-6 py-4 flex flex-col overflow-hidden">
        <section className="rounded-xl border flex-1 min-h-0 flex flex-col" style={{ borderColor: tk.borderLight || "#e7e5e4" }}>

          {/* 8 個 section tabs */}
          <div className="flex items-stretch gap-1 border-b overflow-x-auto flex-none" style={{ borderColor: tk.borderLight || "#e7e5e4", background: tk.bgMuted || "#fafaf9" }}>
            {tabLabels.map((label, i) => (
              <button
                key={i}
                onClick={() => { setActiveIdx(i); load(); }}
                className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${i === activeIdx ? "font-bold" : "opacity-60 hover:opacity-90"}`}
                style={{ borderBottomColor: i === activeIdx ? (tk.accent || "#8b5e3c") : "transparent", color: i === activeIdx ? (tk.accent || "#8b5e3c") : undefined }}
              >
                <span>{i + 1}. {label}</span>
                {sections[i] ? <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-none" title={t("projectMd.hasContent")} /> : <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: "#d6d3d1" }} />}
              </button>
            ))}
          </div>

          {/* toolbar：唯讀 — 只有 🔄 / 💬 */}
          <div className="px-4 py-2 flex items-center gap-2 border-b flex-none" style={{ borderColor: tk.borderLight || "#e7e5e4" }}>
            <span className="text-sm font-bold flex-1 truncate">📄 {activeIdx + 1}. {tabLabels[activeIdx]}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">{t("projectMd.readOnly")}</span>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-40"
              style={{ borderColor: tk.borderLight || "#e7e5e4", color: tk.accent || "#8b5e3c" }}
              title={t("projectMd.refreshTitle")}
            >{refreshing ? "⏳" : "🔄"}</button>
            <button
              onClick={() => setShowChat(v => !v)}
              className="text-xs px-2 py-1 rounded-lg border transition-colors"
              style={{ borderColor: tk.borderLight || "#e7e5e4", color: tk.accent || "#8b5e3c" }}
              title={t("projectMd.chatToggle")}
            >💬</button>
          </div>

          {/* 唯讀渲染區：markdown + mermaid 圖 */}
          <div className="p-4 flex-1 min-h-0 overflow-y-auto text-sm leading-relaxed" style={{ color: tk.text || "#44403c" }}>
            {sections[activeIdx]?.trim() ? (
              <MarkdownText>{sections[activeIdx]}</MarkdownText>
            ) : (
              <div className="text-center py-8 text-stone-400 text-sm">
                <div className="text-2xl mb-2">📄</div>
                {t("projectMd.emptySection")}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── 右：林曉薇 side chat（架構師 — 討論 + spec_write 寫入）── */}
      {showChat && rootPath && (
        <div className="flex-none border-l" style={{ borderColor: tk.borderLight || "#e7e5e4", width: 380 }}>
          <AgentSideChat
            agentId="architect"
            agentName={t("projectMd.chatName")}
            agentEmoji="🏛️"
            greeting={t("projectMd.chatGreeting")}
            cwd={rootPath}
            accent={tk.accent || "#8b5e3c"}
            persistCrewId="coding.spec-side"
            modelFeature="sideChat.architect"
            placeholder={t("projectMd.chatPlaceholder")}
            suggestions={[
              { label: t("projectMd.sugg1Label"), prompt: `${t("projectMd.sugg1Prompt")}「${activeIdx + 1}. ${tabLabels[activeIdx]}」` },
              { label: t("projectMd.sugg2Label"), prompt: t("projectMd.sugg2Prompt") },
              { label: t("projectMd.sugg3Label"), prompt: `${t("projectMd.sugg3Prompt")}「${activeIdx + 1}. ${tabLabels[activeIdx]}」` },
            ]}
          />
        </div>
      )}

    </div>
  );
}
