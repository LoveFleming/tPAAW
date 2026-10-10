/**
 * CodeIntelPage — 🏛 Architecture 頁（C4 對外連線全景）
 *
 * 2026-10-10 21:37 Fleming 拍板（方案 B）：
 * 「Code Intelligence 的統計宮殿退場」— 砍掉四個統計 tab
 *   📞 Call Graph — call graph 88% unresolved，UI 只吐數字無決策價值
 *   🔗 Deps      — 單檔依賴查詢
 *   🎯 Impact    — 影響分析
 *   🩺 Health    — analyze 分數 + gates
 * 只留 🏛 C4（curated 對外連線全景：DB/服務/佇列，高訊號；
 *   且 agent 下游 project_info(category=c4_model) 真的在用）。
 *
 * 右欄：🏛️ Architect AI（coding.architect）— 帶 C4 證據問答（No answer without evidence）。
 *
 * ⚠️ 只砍 UI 出口 — 資料層（release-unit-model / code-intelligence JSON / c4-model.json）不動。
 * server 端 CU code-intelligence 步驟照跑（下游：agent context / QA / RU model / Evidence Matrix）。
 */

import React, { useEffect, useRef, useState, useCallback, forwardRef } from "react";
import { useI18n } from "../i18n";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";
import { useColResize, ColResizer } from "./ColResizer"; // 2026-10-10 Fleming：跟 Handover 同款左右 splitter

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4097";

// ── C4 Model（對外連線全景）2026-09-05 ──
interface C4Model {
  system?: { name?: string; description?: string };
  containers?: { name: string; type?: string; technology?: string; description?: string; evidence?: string[] }[];
  externalSystems?: { name: string; type?: string; technology?: string; description?: string; evidence?: string[] }[];
  relationships?: { from: string; to: string; protocol?: string; description?: string }[];
  notes?: string;
  stats?: { containers?: number; external?: number; relationships?: number };
}

interface Props {
  rootPath: string;
  onOpenFile?: (absPath: string) => void;
  refreshKey?: number; // CU 完成後重抓（mount-only fetch 會 stale）
  theme?: { borderLight?: string; accent?: string; accentHover?: string }; // 2026-10-10：跟 Handover 同款（splitter + side chat 色）
}

function CodeIntelPageInner({ rootPath, refreshKey, theme }: Props, ref: React.Ref<AgentSideChatHandle | null>) {
  const { t } = useI18n();
  const borderLight = theme?.borderLight || "#f0f0f0";
  const accent = theme?.accent || "#7c3aed";
  const accentHover = theme?.accentHover || theme?.accent || "#7c3aed";
  // 2026-10-10 Fleming：跟 Handover 一模一樣的 side chat（splitter default 520 寬）
  const pane = useColResize(520, 300, 760);

  const chatRef = useRef<AgentSideChatHandle>(null);
  React.useImperativeHandle(ref, () => ({
    send: (text: string) => { chatRef.current?.send(text); },
    addFiles: (files: File[]) => { chatRef.current?.addFiles(files); },
    setText: (text: string) => { chatRef.current?.setText(text); },
  }));

  // C4 model
  const [c4, setC4] = useState<C4Model | null>(null);
  const [c4Busy, setC4Busy] = useState(false);
  const loadC4 = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/c4-model?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) { const d = await res.json(); setC4(d.missing ? null : d); }
    } catch { /* silent */ }
  }, [rootPath]);
  useEffect(() => { loadC4(); }, [loadC4, refreshKey]);
  const c4Organize = async () => {
    setC4Busy(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/c4-model/rescan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: rootPath }) });
      if (res.ok) { const d = await res.json(); setC4(d.skipped || d.missing ? null : d); }
    } catch {} setC4Busy(false);
  };

  // 帶 C4 證據問 architect（No answer without evidence）
  const askC4 = () => {
    if (!c4) return;
    const fmt = (c: { name: string; type?: string; technology?: string; description?: string }) =>
      `- ${c.name} [${c.type || "?"}]${c.technology ? ` (${c.technology})` : ""}${c.description ? ` — ${c.description}` : ""}`;
    const cont = (c4.containers || []).map(fmt).join("\n") || "（無）";
    const ext = (c4.externalSystems || []).map(fmt).join("\n") || "（無）";
    const rel = (c4.relationships || []).map(r => `- ${r.from} → ${r.to} (${r.protocol || "?"})${r.description ? ` — ${r.description}` : ""}`).join("\n") || "（無）";
    chatRef.current?.send(
      `C4 對外連線全景（${c4.system?.name || "本專案"}）：\n\n` +
      `## Containers\n${cont}\n\n## External systems\n${ext}\n\n## Relationships\n${rel}\n\n` +
      `請以架構師觀點分析：1) 這些對外依賴的風險（單點/瓶頸/耦合）2) 哪些是關鍵路徑 3) 上線/維運要特別注意什麼`
    );
  };

  if (!rootPath) {
    return <div className="flex items-center justify-center h-full text-xs text-stone-400">{t("ruTree.noProject")}</div>;
  }

  return (
    <div className="flex h-full min-h-0" data-testid="code-intel-page">
      {/* 左：C4 全景 */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="p-4" data-testid="ci-panel-c4">
          <div className="space-y-3 max-w-4xl">
            {/* header：系統名 + 整理按鈕 */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-stone-800">{c4?.system?.name || t("codeIntel.c4Title")}</div>
                {c4?.system?.description && <div className="text-xs text-stone-500 mt-0.5">{c4.system.description}</div>}
              </div>
              {c4 && (
                <button onClick={askC4} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium">
                  💬 {t("codeIntel.askAi")}
                </button>
              )}
              <button onClick={c4Organize} disabled={c4Busy} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-stone-800 text-white disabled:opacity-50">
                {c4Busy ? "⏳" : "🏛"} {t("codeIntel.c4Organize")}
              </button>
            </div>

            {!c4 && !c4Busy && (
              <div className="text-xs text-stone-400 p-4 text-center">{t("codeIntel.c4Empty")}</div>
            )}

            {c4 && (
              <>
                {/* Containers */}
                {(c4.containers?.length || 0) > 0 && (
                  <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 bg-stone-50" style={{ borderBottom: `1px solid ${borderLight}` }}>
                      📦 {t("codeIntel.c4Containers")} · {c4.containers!.length}
                    </div>
                    {c4.containers!.map(c => (
                      <div key={c.name} className="px-3 py-2 border-b last:border-0" style={{ borderColor: borderLight }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-stone-800">{c.name}</span>
                          {c.type && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">{c.type}</span>}
                          {c.technology && <span className="text-[10px] text-stone-400">{c.technology}</span>}
                        </div>
                        {c.description && <div className="text-[11px] text-stone-500 mt-0.5">{c.description}</div>}
                        {(c.evidence?.length || 0) > 0 && (
                          <div className="text-[10px] text-stone-400 font-mono mt-0.5 truncate" title={c.evidence!.join("\n")}>🔍 {c.evidence!.slice(0, 3).join(" · ")}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* External systems */}
                {(c4.externalSystems?.length || 0) > 0 && (
                  <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 bg-stone-50" style={{ borderBottom: `1px solid ${borderLight}` }}>
                      🌐 {t("codeIntel.c4External")} · {c4.externalSystems!.length}
                    </div>
                    {c4.externalSystems!.map(x => (
                      <div key={x.name} className="px-3 py-2 border-b last:border-0" style={{ borderColor: borderLight }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-stone-800">{x.name}</span>
                          {x.type && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">{x.type}</span>}
                          {x.technology && <span className="text-[10px] text-stone-400">{x.technology}</span>}
                        </div>
                        {x.description && <div className="text-[11px] text-stone-500 mt-0.5">{x.description}</div>}
                        {(x.evidence?.length || 0) > 0 && (
                          <div className="text-[10px] text-stone-400 font-mono mt-0.5 truncate" title={x.evidence!.join("\n")}>🔍 {x.evidence!.slice(0, 3).join(" · ")}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* Relationships */}
                {(c4.relationships?.length || 0) > 0 && (
                  <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 bg-stone-50" style={{ borderBottom: `1px solid ${borderLight}` }}>
                      🔗 {t("codeIntel.c4Relations")} · {c4.relationships!.length}
                    </div>
                    {c4.relationships!.map((r, i) => (
                      <div key={`${r.from}-${r.to}-${i}`} className="px-3 py-1.5 border-b last:border-0 text-xs flex items-center gap-2 flex-wrap" style={{ borderColor: borderLight }}>
                        <span className="font-semibold text-stone-700">{r.from}</span>
                        <span className="text-stone-400">→</span>
                        <span className="font-semibold text-stone-700">{r.to}</span>
                        {r.protocol && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{r.protocol}</span>}
                        {r.description && <span className="text-[11px] text-stone-400">{r.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {c4.notes && <div className="text-[11px] text-stone-500 bg-stone-50 rounded-lg p-2 whitespace-pre-wrap">📝 {c4.notes}</div>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 右：Architect AI — 2026-10-10 Fleming：跟 Handover 一模一樣的 side chat
          （splitter + tool icons + 上傳文字/圖片 + model selector + 對話持久化）*/}
      <ColResizer onDown={pane.startDrag} className="hidden md:block" />
      <div className="shrink-0 hidden md:block" style={{ width: pane.width }}>
        <AgentSideChat
          ref={chatRef}
          agentId="architect"
          agentName={t("codeIntel.architectName")}
          agentEmoji="🏛️"
          greeting={t("codeIntel.architectGreeting")}
          cwd={rootPath}
          accent={accent}
          accentHover={accentHover}
          height="100%"
          persistCrewId="coding.architect-side"
          modelFeature="sideChat.architect"
          placeholder={t("codeIntel.architectPlaceholder")}
          suggestions={[
            { label: t("codeIntel.sug1Label"), prompt: t("codeIntel.sug1Prompt") },
            { label: t("codeIntel.sug2Label"), prompt: t("codeIntel.sug2Prompt") },
          ]}
        />
      </div>
    </div>
  );
}

const CodeIntelPage = forwardRef<AgentSideChatHandle | null, Props>(CodeIntelPageInner);
export default CodeIntelPage;
