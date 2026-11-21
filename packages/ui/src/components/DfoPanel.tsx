/**
 * DfoPanel — 📋 DFO（Design for Operation）維運文件頁（2026-11-20 Fleming）
 *
 * Handover page 改造：四節 tab + markdown/mermaid render + 版本列（看歷版唯讀）
 * + 🔄 AI 更新（POST generate，一次 LLM 全量）+ 💬 side chat 直連 Greta（coding.ops，dfo_write）。
 */

import React, { useState, useEffect, useCallback, Component, useMemo, useRef } from "react";
import API_BASE from "../api";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";
import { useColResize, ColResizer } from "./ColResizer";
import MarkdownText from "./MarkdownText";

class DfoErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <span className="text-2xl">💥</span>
          <div className="text-xs text-red-600 font-bold">DFO 頁面錯誤</div>
          <pre className="text-[10px] text-stone-500 bg-stone-50 rounded p-2 max-w-md overflow-auto">{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })} className="text-xs px-3 py-1.5 rounded bg-blue-500 text-white">重試</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const SECTION_DEFS = [
  { id: "overview", icon: "🗺️" },
  { id: "operations", icon: "🔧" },
  { id: "troubleshooting", icon: "🚨" },
  { id: "handover", icon: "🤝" },
];

interface DfoSection { id: string; title: string; markdown: string }
interface DfoDoc { schemaVersion: number; version: string; updatedAt: string; updatedBy: string; sections: DfoSection[] }

export default function DfoPanel({ rootPath, active, theme: tk }: { rootPath: string; active?: boolean; theme: { borderLight: string; accent: string; accentHover?: string } }) {
  const [dfo, setDfo] = useState<DfoDoc | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);
  const [versions, setVersions] = useState<Array<{ version: string }>>([]);
  const [viewVersion, setViewVersion] = useState<string>("current");
  const [viewDfo, setViewDfo] = useState<DfoDoc | null>(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState("");
  const [frozen, setFrozen] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(true);
  const chatRef = useRef<AgentSideChatHandle>(null);
  const gretaPane = useColResize(520, 300, 760);

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-dfo?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setExists(!!d.exists);
      setDfo(d.exists ? d.dfo : null);
      setVersions(d.versions || []);
      setFrozen(d.frozen || null);
      setViewVersion("current");
      setViewDfo(d.exists ? d.dfo : null);
    } catch { setExists(false); }
    finally { setLoading(false); }
  }, [rootPath]);

  useEffect(() => { if (active !== false) refresh(); }, [refresh, active]);

  // 看指定歷版
  useEffect(() => {
    if (viewVersion === "current") { setViewDfo(dfo); return; }
    if (!rootPath || !viewVersion) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/coding-dfo/versions/${viewVersion}?path=${encodeURIComponent(rootPath)}`);
        const d = await res.json();
        if (d.dfo) setViewDfo(d.dfo);
      } catch {}
    })();
  }, [viewVersion, rootPath, dfo]);

  const generate = useCallback(async () => {
    if (!rootPath || generating) return;
    setGenerating(true); setGenMsg(exists ? "🤖 AI 更新中（參考現行版 + 程式碼，約 1-2 分鐘）…" : "🤖 AI 首次生成中（掃知識庫 + 程式碼，約 1-2 分鐘）…");
    try {
      const res = await fetch(`${API_BASE}/api/coding-dfo/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: rootPath }),
      });
      const d = await res.json();
      if (d.ok) {
        setGenMsg(`✅ 已更新至 ${d.version}（${(d.sections || []).map((s: any) => s.id).join("、")}）`);
        await refresh();
      } else setGenMsg(`❌ ${d.error || "生成失敗"}`);
    } catch (e: any) { setGenMsg(`❌ ${e.message}`); }
    finally { setGenerating(false); }
  }, [rootPath, generating, exists, refresh]);

  const shown = viewDfo;
  const sec = shown?.sections.find(s => s.id === activeSection);
  const secDef = SECTION_DEFS.find(s => s.id === activeSection);

  return (
    <DfoErrorBoundary>
      <div className="flex-1 flex min-h-0">
        {/* ── 左：DFO 主體 ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 版本列 */}
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b text-xs" style={{ borderColor: tk.borderLight }}>
            <span className="font-bold" style={{ color: tk.accent }}>📋 DFO 維運文件</span>
            {shown ? (
              <span className="text-stone-500">{shown.version}</span>
            ) : <span className="text-stone-400">{loading ? "載入中…" : "尚無 DFO — 按 🔄 AI 生成"}</span>}
            {frozen && <span className="text-amber-600 font-bold" title={frozen}>🔒 已凍結（RR 已關閉）</span>}
            <div className="flex-1" />
            {versions.length > 0 && (
              <select value={viewVersion} onChange={e => setViewVersion(e.target.value)}
                className="text-xs px-1.5 py-1 border rounded-none bg-white" style={{ borderColor: tk.borderLight }}
                title="查看歷史版本（唯讀）">
                <option value="current">現行版</option>
                {[...versions].reverse().map(v => <option key={v.version} value={v.version}>{v.version}（唯讀）</option>)}
              </select>
            )}
            {viewVersion !== "current" && <span className="text-amber-600 font-bold">👁️ {viewVersion} 唯讀</span>}
            <button onClick={generate} disabled={generating || !rootPath || !!frozen}
              className="px-2.5 py-1 rounded border font-bold transition-colors disabled:opacity-50"
              style={{ borderColor: tk.accent, color: tk.accent }}
              title={frozen || (exists ? "AI 參考現行版 + 程式碼，全量更新（自動進版）" : "AI 首次生成 DFO")}>
              {generating ? "⏳ 生成中…" : "🔄 AI 更新"}
            </button>
            <button onClick={() => setShowChat(v => !v)} className="px-2 py-1 rounded border text-stone-500 hover:bg-stone-50"
              style={{ borderColor: tk.borderLight }} title="顯示/隱藏 Greta side chat">💬</button>
          </div>
          {genMsg && <div className="shrink-0 px-4 py-1.5 text-xs border-b bg-stone-50 text-stone-600" style={{ borderColor: tk.borderLight }}>{genMsg}</div>}

          {/* 節 tab */}
          <div className="shrink-0 flex items-center gap-1 px-4 pt-2 border-b overflow-x-auto" style={{ borderColor: tk.borderLight }}>
            {SECTION_DEFS.map(def => {
              const s = shown?.sections.find(x => x.id === def.id);
              const isActive = activeSection === def.id;
              return (
                <button key={def.id} onClick={() => setActiveSection(def.id)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors ${isActive ? "font-bold" : "text-stone-400 hover:text-stone-600"}`}
                  style={{ borderBottom: `2px solid ${isActive ? tk.accent : "transparent"}`, color: isActive ? undefined : undefined }}>
                  <span>{def.icon}</span>
                  <span>{s?.title || def.id}</span>
                  {s?.markdown ? <span className="text-[9px] text-stone-300">{(s.markdown.length / 1000).toFixed(1)}k</span> : <span className="text-[9px] text-stone-300">空</span>}
                </button>
              );
            })}
          </div>

          {/* 內容：markdown + mermaid */}
          <div className="flex-1 overflow-auto px-6 py-4">
            {!shown ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-stone-400">
                <span className="text-4xl">📋</span>
                <div className="text-sm">尚無 DFO 文件</div>
                <div className="text-xs">DFO = 系統全景 / 日常操作 / 事故排查 / 交接上手 — 一鍵 AI 生成，之後 AI 持續維護進版</div>
                <button onClick={generate} disabled={generating} className="mt-2 px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: tk.accent }}>
                  🔄 AI 生成
                </button>
              </div>
            ) : sec?.markdown ? (
              <div className={showChat ? "max-w-3xl" : "w-full"}>
                <MarkdownText>{sec.markdown}</MarkdownText>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-stone-400">
                <span className="text-3xl">{secDef?.icon}</span>
                <div className="text-sm">「{sec?.title}」尚無內容 — 按 🔄 AI 更新 或跟 Greta 說一聲</div>
              </div>
            )}
          </div>
        </div>

        {/* ── 右：Greta side chat（dfo_write 直接改 DFO） ── */}
        <ColResizer onDown={gretaPane.startDrag} className={showChat ? "hidden md:block" : "hidden"} />
        <div className="shrink-0 hidden md:block" style={{ width: gretaPane.width, display: showChat ? undefined : "none" }}>
          <AgentSideChat ref={chatRef}
            agentId="ops"
            agentName="格蕾塔·穆勒 · 維運助理"
            agentEmoji="🛠️"
            greeting="Guten Tag！我是 Greta，DFO 文件的 owner。左邊四節看得到現況 — 想改哪節直接跟我說（例如「事故排查那節補上 Redis 斷線的處置」），我用 dfo_write 寫入自動進版。"
            cwd={rootPath}
            accent={tk.accent}
            accentHover={tk.accentHover || tk.accent}
            height="100%"
            persistCrewId="coding.dfo-side"
            modelFeature="sideChat.ops"
            suggestions={[
              { label: "更新事故排查", prompt: "參考最新的 error codes、程式碼、tasks 與 ADR，把 DFO 的事故排查節更新一遍" },
              { label: "補充實務經驗", prompt: "我要補充一段實務經驗或踩過的坑（內容我接著貼），請對照 code / task / ADR 後用 dfo_write 寫進最合適的章節" },
              { label: "檢查是否過時", prompt: "對照程式碼、tasks、ADR 與 DFO 現況，指出哪些章節已過時並直接更新" },
            ]}
          />
        </div>
      </div>
    </DfoErrorBoundary>
  );
}
