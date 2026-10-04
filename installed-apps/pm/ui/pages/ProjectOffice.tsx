/**
 * ProjectOffice — 🎯 產品經理室主頁（landing = 首席產品經理）
 * 側欄：首席 + 全域報表櫃 + 產品清單（可展開檔案/上傳）+ 新增產品
 * tabs：💬 對話 / 📋 需求池 / 🔔 截止雷達 / 🌅 晨間簡報 / 🗺️ 產品總覽
 * 架構同 Secretary（綠地模板）：檔案是事實來源，產品管家寫自己的櫃。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarkdownText from "@paaw-ui/components/MarkdownText";
import Icon from "@paaw-ui/components/Icon";
import { useI18n } from "@paaw-ui/i18n";
import { useTheme } from "@paaw-ui/theme";
import SidebarFileTree from "@paaw-ui/components/SidebarFileTree";
import ExpertChatPanel from "../components/ExpertChatPanel";
import SheetPreview from "../components/SheetPreview";

const SHEET_RE = /\.(xlsx|csv)$/i;

type ProjNode = { id: string; name: string; emoji: string; agentId: string; enabled: boolean; kind?: "function" | "product"; files: { name: string; size: number; mtime: string; sheet: boolean }[] };
type TabKind = "chat" | "todos" | "radar" | "briefing" | "board";
type TabInst = { key: string; kind: TabKind; agentId: string; label: string };
type OpenFile = { proj: string; name: string; sheet: boolean };
type BoardRow = { id: string; name?: string; status: string; stage?: string; risks: number; openBacklog: number; nextMilestone: string | null; files: number };
type RadarItem = { type: string; label: string; date: string; text: string; source: string; inDays: number; status: string };

const CHIEF = "pm.chief";
const LANDING: TabInst = { key: "chief", kind: "chat", agentId: CHIEF, label: "🎯 首席產品經理" };

export default function ProjectOffice() {
  const { t } = useI18n();
  const { info: themeInfo } = useTheme();
  // tk token — 同 LearningSpace（toolbar 系列由 accent 衍生，跟著 PAAW theme 走）
  const tk = useMemo(() => ({
    bgMuted: themeInfo.accentLight || "#f5f5f4",
    borderLight: themeInfo.accentBorder || "#f0f0f0",
    accent: themeInfo.accent,
    toolbarBg: themeInfo.accentText || "#1e1e1e",
    toolbarBorder: themeInfo.accentBorder || "#333",
    toolbarText: "rgba(255,255,255,0.9)",
    toolbarTextMuted: "rgba(255,255,255,0.5)",
    toolbarHover: "rgba(255,255,255,0.1)",
    toolbarActive: "rgba(255,255,255,0.15)",
  }), [themeInfo]);
  // 動態 tabs：landing 固定首席（不可關）；點專家/工具列才開 tab（可關）
  const [tabs, setTabs] = useState<TabInst[]>([LANDING]);
  const [activeKey, setActiveKey] = useState<string>("chief");
  const active = tabs.find(x => x.key === activeKey) || LANDING;
  // 學習空間同款：最左收合側欄樹、最右 ⛶ 專注模式蓋掉整個 PAAW（Esc 縮回）
  const [treeHidden, setTreeHidden] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    if (!focusMode) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setFocusMode(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [focusMode]);
  const [projects, setProjects] = useState<ProjNode[]>([]);
  const functions = projects.filter(p => p.enabled !== false && p.kind === "function");
  const [dossierRoot, setDossierRoot] = useState<string>("");
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [mdContent, setMdContent] = useState("");
  const [mdDirty, setMdDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [todosMd, setTodosMd] = useState("");
  const [briefing, setBriefing] = useState<{ markdown: string; stats?: Record<string, number> }>({ markdown: "" });
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [radar, setRadar] = useState<RadarItem[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadProj = useRef<string>("");

  const loadTree = useCallback(async () => {
    try {
      const d = await fetch("/api/pm/dossiers").then(r => r.json());
      setProjects(d.projects || []);
      if (d.root) setDossierRoot(String(d.root).replace(/\\/g, "/").replace(/\/+$/, ""));
    } catch { /* server 未掛載時靜默 */ }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  const loadPanel = useCallback(async (which: Tab) => {
    if (which === "todos") {
      const d = await fetch("/api/pm/briefing?part=todos").then(r => r.json()).catch(() => null);
      if (d) setTodosMd(d.markdown || "");
    } else if (which === "briefing") {
      const d = await fetch("/api/pm/briefing").then(r => r.json()).catch(() => null);
      if (d) setBriefing(d);
    } else if (which === "radar") {
      const d = await fetch("/api/pm/radar").then(r => r.json()).catch(() => null);
      if (d) setRadar(d.items || []);
    } else if (which === "board") {
      const d = await fetch("/api/pm/briefing?part=board").then(r => r.json()).catch(() => null);
      if (d) setBoard(d.board || []);
    }
  }, []);

  useEffect(() => { if (active.kind !== "chat") loadPanel(active.kind); }, [active.key, active.kind, loadPanel]);

  // ── 動態 tabs（同學習空間/秘書）──
  const openTab = useCallback((tb: TabInst) => {
    setTabs(prev => prev.some(x => x.key === tb.key) ? prev : [...prev, tb]);
    setActiveKey(tb.key);
  }, []);
  const closeTab = useCallback((key: string) => {
    setTabs(prev => prev.filter(x => x.key === key).length ? prev.filter(x => x.key !== key) : [LANDING]);
  }, []);
  useEffect(() => { if (!tabs.some(x => x.key === activeKey)) setActiveKey("chief"); }, [tabs, activeKey]);

  const openDossier = useCallback(async (proj: string, name: string, sheet: boolean) => {
    setOpenFile({ proj, name, sheet });
    setMdDirty(false);
    if (!sheet) {
      try {
        const d = await fetch(`/api/pm/dossiers/${encodeURIComponent(proj)}/${encodeURIComponent(name)}`).then(r => r.json());
        setMdContent(d.content ?? "");
      } catch { setMdContent(""); }
    }
  }, []);

  const saveMd = useCallback(async () => {
    if (!openFile) return;
    setSaving(true);
    try {
      await fetch(`/api/pm/dossiers/${encodeURIComponent(openFile.proj)}/${encodeURIComponent(openFile.name)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: mdContent }),
      });
      setMdDirty(false);
      loadTree();
    } finally { setSaving(false); }
  }, [openFile, mdContent, loadTree]);

  const pickProject = useCallback((p: ProjNode) => {
    openTab({ key: `expert:${p.id}`, kind: "chat", agentId: p.agentId || `pm.${p.id}`, label: `${p.emoji} ${p.id === "_global" ? t("pm.global", "全域報表") : p.name}` });
  }, [t, openTab]);

  // ── 檔案樹回呼（SidebarFileTree 同款）──
  // 檔案：root/<proj>/<name...> → 開檔（md 編輯 / sheet 預覽）；頂層檔不屬於任何產品櫃 → 靜默
  const handleTreeSelectFile = useCallback((path: string) => {
    if (!dossierRoot || !path.startsWith(dossierRoot + "/")) return;
    const rel = path.slice(dossierRoot.length + 1);
    const seg = rel.split("/");
    if (seg.length < 2) return;
    const proj = seg[0];
    const name = seg[seg.length - 1];
    const p = projects.find(x => x.id === proj);
    if (p && p.enabled !== false) pickProject(p);
    openDossier(proj, name, SHEET_RE.test(name));
  }, [dossierRoot, openDossier, projects, pickProject]);

  // 目錄：頂層產品櫃 → 切換該產品管家（保留原 點產品=挑管家 行為）；子目錄只展開
  const handleTreeSelectDir = useCallback((path: string) => {
    if (!dossierRoot || !path.startsWith(dossierRoot + "/")) return;
    const rel = path.slice(dossierRoot.length + 1);
    if (rel.includes("/")) return;
    const p = projects.find(x => x.id === rel);
    if (p && p.enabled !== false) pickProject(p);
  }, [dossierRoot, projects, pickProject]);

  const doUpload = useCallback(async (files: FileList | null) => {
    if (!files || !uploadProj.current) return;
    const proj = uploadProj.current;
    for (const f of Array.from(files)) {
      const b64 = await new Promise<string>(res => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1] || "");
        fr.readAsDataURL(f);
      });
      await fetch(`/api/pm/dossiers/${encodeURIComponent(proj)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: f.name, dataBase64: b64 }),
      });
    }
    if (uploadRef.current) uploadRef.current.value = "";
    loadTree();
  }, [loadTree]);

  // 工具列：點選才開 tab（不常駐）
  const TOOLS: { kind: TabKind; label: string }[] = [
    { kind: "board", label: t("pm.tab.board", "🗺️ 產品總覽") },
    { kind: "todos", label: t("pm.tab.todos", "📋 需求池") },
    { kind: "radar", label: t("pm.tab.radar", "🔔 截止雷達") },
    { kind: "briefing", label: t("pm.tab.briefing", "🌅 晨間簡報") },
  ];

  return (
    <div className={`h-full w-full flex flex-col min-h-0 bg-stone-100 ${focusMode ? "fixed inset-0 z-[9999]" : ""}`}>
      {/* ═══ Top 工具列（同學習空間：tk.toolbarBg theme 色 / 最左收合側欄 / 最右 ⛶ 專注模式）═══ */}
      <div className="flex items-center h-9 px-2 shrink-0 select-none gap-1" style={{ backgroundColor: tk.toolbarBg, borderBottom: `1px solid ${tk.toolbarBorder}` }}>
        <button onClick={() => setTreeHidden(v => !v)}
          title={treeHidden ? "顯示檔案樹" : "收合檔案樹"}
          className="text-xs px-2 py-1 rounded transition-colors shrink-0"
          style={{ backgroundColor: treeHidden ? tk.toolbarActive : "transparent", color: tk.toolbarTextMuted }}
          onMouseEnter={e => { if (!treeHidden) e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = treeHidden ? tk.toolbarActive : "transparent"; }}
        >{treeHidden ? "📁" : "📚"}</button>
        {TOOLS.map(x => {
          const opened = tabs.some(tb => tb.key === x.kind);
          return (
            <button
              key={x.kind}
              onClick={() => openTab({ key: x.kind, kind: x.kind, agentId: "", label: x.label })}
              className="text-xs px-2 py-1 rounded transition-colors whitespace-nowrap shrink-0"
              style={{ backgroundColor: opened ? tk.toolbarActive : "transparent", color: opened ? tk.toolbarText : tk.toolbarTextMuted }}
              onMouseEnter={e => { if (!opened) e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = opened ? tk.toolbarActive : "transparent"; }}
            >{x.label}</button>
          );
        })}
        <div className="flex-1" />
        {active.kind === "chat" && <div className="text-[11px] pr-1 shrink-0" style={{ color: tk.toolbarTextMuted }}>{active.label}</div>}
        <button onClick={() => setFocusMode(v => !v)}
          title={focusMode ? "縮回（Esc）" : "放大蓋住整個 PAAW"}
          className="flex items-center text-xs px-2 py-1 rounded transition-colors shrink-0"
          style={{ backgroundColor: focusMode ? tk.toolbarActive : "transparent", color: focusMode ? tk.accent : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (!focusMode) e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = focusMode ? tk.toolbarActive : "transparent"; }}
        >{focusMode ? <Icon name="contract" size={14} /> : <Icon name="expand" size={14} />}</button>
      </div>

      <div className="flex-1 flex min-h-0">
      {/* ═══ 左 sidebar ═══ */}
      {!treeHidden && (<aside className="w-60 shrink-0 flex flex-col border-r border-stone-200 bg-white overflow-hidden">
        <div className="px-3 py-2.5 border-b border-stone-100">
          <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{t("pm.title", "🎯 產品經理室")}</div>
        </div>
        <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
          {/* 總管（landing） */}
          <button
            onClick={() => { setActiveKey("chief"); setOpenFile(null); }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${activeKey === "chief" ? "bg-stone-100 font-bold text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}
          >
            <span>🎯</span><span className="truncate">{t("pm.chief", "首席產品經理")}</span>
          </button>

          {/* 專家團隊（橫向職能：每個工作領域一個 AI 專家，方案 B）*/}
          <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("pm.experts", "專家團隊")}</div>
          {functions.map(p => (
            <button
              key={p.id}
              onClick={() => pickProject(p)}
              className={`w-full flex items-center gap-2 px-5 py-1.5 text-sm text-left transition-colors ${active.kind === "chat" && active.agentId === (p.agentId || `pm.${p.id}`) ? "bg-stone-100 font-bold text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}
            >
              <span>{p.emoji}</span><span className="truncate">{p.id === "_global" ? t("pm.global", "全域報表") : p.name}</span>
            </button>
          ))}

          <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("pm.projects", "產品檔案櫃")}</div>
          {/* 檔案樹：同 File Mounts（SidebarFileTree）— 展開/右鍵（新增/匯入/移動/改名/刪除）/自動刷新 */}
          {dossierRoot ? (
            <SidebarFileTree
              projectRoot={dossierRoot}
              activeFilePath={openFile && openFile.proj && openFile.name ? `${dossierRoot}/${openFile.proj}/${openFile.name}` : null}
              openFilePaths={new Set(openFile && openFile.name ? [`${dossierRoot}/${openFile.proj}/${openFile.name}`] : [])}
              onSelectFile={handleTreeSelectFile}
              onEditFile={handleTreeSelectFile}
              onSelectDir={handleTreeSelectDir}
              menuMode="files"
            />
          ) : (
            <div className="px-5 py-2 text-[11px] text-stone-300">{t("pm.treeLoading", "載入檔案樹…")}</div>
          )}
        </div>
        <div className="border-t border-stone-100 p-2 space-y-0.5">
          <button onClick={() => setUploadOpen(true)} className="w-full text-xs text-stone-500 hover:text-stone-800 py-1.5 px-2 rounded hover:bg-stone-50 text-left">
            ⬆️ {t("pm.uploadPick", "上傳檔案到產品櫃")}
          </button>
          <button onClick={() => setNewOpen(true)} className="w-full text-xs text-stone-500 hover:text-stone-800 py-1.5 px-2 rounded hover:bg-stone-50 text-left">
            ➕ {t("pm.newProject", "新增產品（自動配管家）")}
          </button>
        </div>
        <input ref={uploadRef} type="file" multiple hidden onChange={e => doUpload(e.target.files)} />
      </aside>)}

      {/* ═══ 主區 ═══ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab Bar — 同學習空間：landing 首席固定第一頁不可關，其他開 tab sheet */}
        <div className="flex items-end shrink-0 overflow-x-auto" style={{ backgroundColor: tk.bgMuted, borderBottom: `1px solid ${tk.borderLight}` }}>
          {tabs.map(tb => {
            const isActive = activeKey === tb.key;
            const closable = tb.key !== "chief";
            return (
              <div key={tb.key}
                onClick={() => setActiveKey(tb.key)}
                className={`group flex items-center gap-1 px-3 py-1 cursor-pointer select-none text-xs shrink-0 transition-colors ${isActive ? "bg-white text-stone-800 font-bold" : "text-stone-400 hover:bg-stone-100"}`}
                style={isActive ? { borderTop: `2px solid ${tk.accent}` } : { borderTop: "2px solid transparent" }}
              >
                <span className="truncate max-w-[120px]">{tb.label}</span>
                {closable && (
                  <button onClick={e => { e.stopPropagation(); closeTab(tb.key); }}
                    className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 text-xs ml-1"
                  >✕</button>
                )}
              </div>
            );
          })}
        </div>

        {/* content */}
        <div className="flex-1 min-h-0">
          {active.kind === "chat" && (
            openFile ? (
              <div className="flex h-full">
                <div className="w-1/2 min-w-0 border-r border-stone-200 bg-white flex flex-col">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200 shrink-0">
                    <span className="text-sm font-bold text-stone-800 truncate">{openFile.sheet ? "📊" : "📄"} {openFile.name}</span>
                    <span className="text-[11px] text-stone-400 shrink-0">{openFile.proj}/</span>
                    <div className="flex-1" />
                    {!openFile.sheet && (
                      <button
                        onClick={saveMd}
                        disabled={!mdDirty || saving}
                        className="text-xs rounded-lg bg-stone-800 text-white px-3 py-1 disabled:opacity-30"
                      >{saving ? "…" : t("pm.save", "儲存")}</button>
                    )}
                    <button onClick={() => setOpenFile(null)} className="text-stone-400 hover:text-stone-700 text-lg leading-none px-1">✕</button>
                  </div>
                  {openFile.sheet ? (
                    <SheetPreview category={openFile.proj} file={openFile.name} onClose={() => setOpenFile(null)} />
                  ) : (
                    <textarea
                      value={mdContent}
                      onChange={e => { setMdContent(e.target.value); setMdDirty(true); }}
                      className="flex-1 w-full resize-none p-4 font-mono text-xs leading-relaxed focus:outline-none"
                      spellCheck={false}
                    />
                  )}
                </div>
                <div className="w-1/2 min-w-0">
                  <ExpertChatPanel agentId={active.agentId} />
                </div>
              </div>
            ) : (
              <ExpertChatPanel agentId={active.agentId} />
            )
          )}

          {active.kind === "board" && (
            <div className="h-full overflow-y-auto bg-white p-6" style={{ scrollbarWidth: "thin" }}>
              <div className="max-w-4xl mx-auto">
                <div className="text-xs text-stone-400 mb-3">{t("pm.boardHint", "燈號與階段來自各產品 product.md（管家維護）— 統計由程式掃描，零 LLM")}</div>
                {board.length === 0 && <div className="text-sm text-stone-400">{t("pm.boardEmpty", "尚無產品 — 左下「新增產品」開一個")}</div>}
                {board.length > 0 && (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-left text-xs text-stone-400 border-b border-stone-200">
                        <th className="py-2 pr-3">{t("pm.colProject", "產品")}</th>
                        <th className="py-2 pr-3">{t("pm.colStatus", "狀態")}</th>
                        <th className="py-2 pr-3">{t("pm.colStage", "階段")}</th>
                        <th className="py-2 pr-3">{t("pm.colRisks", "風險")}</th>
                        <th className="py-2 pr-3">{t("pm.colIssues", "未結需求")}</th>
                        <th className="py-2">{t("pm.colMilestone", "下個版本")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.map(b => (
                        <tr key={b.id} className="border-b border-stone-100 hover:bg-stone-50">
                          <td className="py-2.5 pr-3 font-semibold text-stone-800">{b.name}</td>
                          <td className="py-2.5 pr-3 text-lg">{b.status}</td>
                          <td className="py-2.5 pr-3">{b.stage || "—"}</td>
                          <td className="py-2.5 pr-3 text-stone-600">{b.risks > 0 ? `⚠️ ${b.risks}` : "0"}</td>
                          <td className="py-2.5 pr-3 text-stone-600">{b.openBacklog > 0 ? `🔶 ${b.openBacklog}` : "0"}</td>
                          <td className="py-2.5 font-mono text-xs text-stone-600">{b.nextMilestone || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {active.kind === "todos" && (
            <div className="h-full overflow-y-auto bg-white p-6" style={{ scrollbarWidth: "thin" }}>
              <div className="max-w-3xl mx-auto">
                <div className="text-xs text-stone-400 mb-2">{t("pm.todosHint", "checkbox 落在各產品櫃（backlog 為主）— 勾掉請找該產品管家（點左邊產品），這裡是總掃描")}</div>
                <MarkdownText>{todosMd || "（掃描中…）"}</MarkdownText>
              </div>
            </div>
          )}

          {active.kind === "radar" && (
            <div className="h-full overflow-y-auto bg-white p-6" style={{ scrollbarWidth: "thin" }}>
              <div className="max-w-3xl mx-auto space-y-2">
                <div className="text-xs text-stone-400 mb-2">{t("pm.radarHint", "來源：各產品櫃 [milestone:] / [due:] / [expires:] 標記 — 30 天內全部列出")}</div>
                {radar.length === 0 && <div className="text-sm text-stone-400">✅ {t("pm.radarClean", "雷達乾淨 — 沒有 30 天內到期項")}</div>}
                {radar.map((it, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-stone-200 px-3 py-2">
                    <span className={`text-xs font-bold shrink-0 rounded-full px-2 py-0.5 ${it.status === "逾期" ? "bg-red-100 text-red-700" : it.status === "7天內" ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>
                      {it.status === "逾期" ? "🚨" : it.status === "7天內" ? "⚠️" : "⏳"} {it.label}·{it.status}
                    </span>
                    <span className="text-sm text-stone-800 font-mono shrink-0">{it.date}</span>
                    <span className="text-sm text-stone-700 truncate flex-1">{it.text}</span>
                    <span className="text-[10px] text-stone-300 shrink-0">{it.source}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {active.kind === "briefing" && (
            <div className="h-full overflow-y-auto bg-white p-6" style={{ scrollbarWidth: "thin" }}>
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-2 mb-3">
                  <button onClick={() => loadPanel("briefing")} className="text-xs rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-50">🔄 {t("pm.refresh", "重新掃描")}</button>
                  {briefing.stats && (
                    <div className="flex gap-2 text-[11px] flex-wrap">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">🗺️ {briefing.stats.products ?? briefing.stats.projects ?? 0}</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">🎯 {briefing.stats.milestones ?? 0}</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">🚨 {briefing.stats.overdue ?? 0}</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">✅ {briefing.stats.todos ?? 0}</span>
                    </div>
                  )}
                </div>
                <MarkdownText>{briefing.markdown || "（掃描中…）"}</MarkdownText>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* ═══ 新增產品 modal ═══ */}
      {newOpen && (
        <NewProjectModal
          onClose={() => setNewOpen(false)}
          onCreated={(p) => { openTab({ key: `expert:${p.id}`, kind: "chat", agentId: p.agentId, label: `${p.emoji} ${p.name}` }); loadTree(); }}
        />
      )}

      {uploadOpen && (
        <UploadModal
          projects={projects.filter(p => p.enabled !== false)}
          onClose={() => setUploadOpen(false)}
          onPickProj={(projId) => { uploadProj.current = projId; setUploadOpen(false); setTimeout(() => uploadRef.current?.click(), 50); }}
        />
      )}
    </div>
  );
}

/** 上傳：選產品櫃 → 開檔案挑選器（沿用原 doUpload 流程） */
function UploadModal({ projects, onClose, onPickProj }: { projects: ProjNode[]; onClose: () => void; onPickProj: (projId: string) => void }) {
  const { t } = useI18n();
  const [proj, setProj] = useState(projects[0]?.id || "");
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[380px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-stone-100 flex items-center">
          <div className="font-bold text-stone-800">⬆️ {t("pm.uploadPick", "上傳檔案到產品櫃")}</div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-xs text-stone-500">{t("pm.uploadHint", "選一個產品櫃，然後挑選要上傳的檔案（xlsx / csv / md…）")}</div>
          <select value={proj} onChange={e => setProj(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm">
            {projects.length === 0 && <option value="">{t("pm.noProj", "（沒有可用產品櫃 — 先新增產品）")}</option>}
            {projects.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.id === "_global" ? t("pm.global", "全域報表") : p.name}（{p.files.length}）</option>)}
          </select>
          <button
            onClick={() => proj && onPickProj(proj)}
            disabled={!proj}
            className="w-full rounded-lg bg-stone-800 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >{t("pm.pickFiles", "選擇檔案…")}</button>
        </div>
      </div>
    </div>
  );
}

/** 新增產品：自動 scaffold 四模板檔（定位/路線圖/需求池/指標）+ 專屬管家 agent */
function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: { id: string; name: string; emoji: string; agentId: string }) => void }) {
  const { t } = useI18n();
  const [pid, setPid] = useState("");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🗂️");
  const [goal, setGoal] = useState("");
  const [owner, setOwner] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pm/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pid.trim() || undefined, name: name.trim(), emoji: emoji.trim() || "🗂️", goal: goal.trim(), owner: owner.trim(), start, end }),
      });
      const d = await r.json();
      if (d.error) { setMsg(`❌ ${d.error}`); return; }
      setMsg(`✅ ${d.project.emoji} ${d.project.name} 已建立 — 專屬產品管家 ${d.project.agentId} 上線（左邊清單可聊）`);
      setTimeout(() => { onCreated(d.project); onClose(); }, 900);
      setPid(""); setName(""); setGoal(""); setOwner(""); setStart(""); setEnd("");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={busy ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-stone-100 flex items-center">
          <div className="font-bold text-stone-800">➕ {t("pm.newProject", "新增產品")}</div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">✕</button>
        </div>
        <div className="p-5 overflow-y-auto space-y-2.5" style={{ scrollbarWidth: "thin" }}>
          <div className="text-xs text-stone-400">{t("pm.newHint", "自動生成：定位/路線圖/需求池/指標四模板檔 + 專屬 AI 產品管家（只能寫這個產品的櫃）")}</div>
          <div className="flex gap-2">
            <input value={emoji} onChange={e => setEmoji(e.target.value)} className="w-16 rounded-lg border border-stone-200 px-2 py-1.5 text-sm text-center" placeholder="🗂️" />
            <input value={name} onChange={e => setName(e.target.value)} className="flex-1 rounded-lg border border-stone-200 px-3 py-1.5 text-sm" placeholder={t("pm.projName", "產品名稱，如：AI 工廠入口")} />
          </div>
          <input value={pid} onChange={e => setPid(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-mono" placeholder={t("pm.projId", "英文 id（可選，如 ai-portal；留空自動編號）")} />
          <input value={goal} onChange={e => setGoal(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm" placeholder={t("pm.projGoal", "一句話目標（什麼算成功）— 進定位檔與管家 prompt")} />
          <input value={owner} onChange={e => setOwner(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm" placeholder={t("pm.projOwner", "Owner（產品負責人）")} />
          <div className="flex gap-2">
            <input value={start} onChange={e => setStart(e.target.value)} className="flex-1 rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-mono" placeholder="起 2026-10-01" />
            <input value={end} onChange={e => setEnd(e.target.value)} className="flex-1 rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-mono" placeholder="迄 2026-12-31" />
          </div>
          <button onClick={create} disabled={busy || !name.trim()} className="rounded-lg bg-stone-800 text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-40">
            {busy ? "建立中…" : t("pm.createProject", "建立產品")}
          </button>
          {msg && <div className="text-xs text-stone-600">{msg}</div>}
        </div>
      </div>
    </div>
  );
}
