/**
 * ProjectOffice — 🎯 產品經理室主頁（landing = 首席產品經理）
 * 側欄：首席 + 全域報表櫃 + 產品清單（可展開檔案/上傳）+ 新增產品
 * tabs：💬 對話 / 📋 需求池 / 🔔 截止雷達 / 🌅 晨間簡報 / 🗺️ 產品總覽
 * 架構同 Secretary（綠地模板）：檔案是事實來源，產品管家寫自己的櫃。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import MarkdownText from "@paaw-ui/components/MarkdownText";
import { useI18n } from "@paaw-ui/i18n";
import SidebarFileTree from "@paaw-ui/components/SidebarFileTree";
import ExpertChatPanel from "../components/ExpertChatPanel";
import SheetPreview from "../components/SheetPreview";

const SHEET_RE = /\.(xlsx|csv)$/i;

type ProjNode = { id: string; name: string; emoji: string; agentId: string; enabled: boolean; kind?: "function" | "product"; files: { name: string; size: number; mtime: string; sheet: boolean }[] };
type Tab = "chat" | "todos" | "radar" | "briefing" | "board";
type OpenFile = { proj: string; name: string; sheet: boolean };
type BoardRow = { id: string; name?: string; status: string; stage?: string; risks: number; openBacklog: number; nextMilestone: string | null; files: number };
type RadarItem = { type: string; label: string; date: string; text: string; source: string; inDays: number; status: string };

const CHIEF = "pm.chief";

export default function ProjectOffice() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("chat");
  const [projects, setProjects] = useState<ProjNode[]>([]);
  const functions = projects.filter(p => p.enabled !== false && p.kind === "function");
  const [dossierRoot, setDossierRoot] = useState<string>("");
  const [activeAgent, setActiveAgent] = useState<string>(CHIEF);
  const [activeAgentLabel, setActiveAgentLabel] = useState<string>("🎯 首席產品經理");
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

  useEffect(() => { loadPanel(tab); }, [tab, loadPanel]);

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
    setActiveAgent(p.agentId || `pm.${p.id}`);
    setActiveAgentLabel(`${p.emoji} ${p.id === "_global" ? t("pm.global", "全域報表") : p.name}`);
    setTab("chat");
  }, [t]);

  // ── 檔案樹回呼（SidebarFileTree 同款）──
  // 檔案：root/<proj>/<name...> → 開檔（md 編輯 / sheet 預覽）；頂層檔不屬於任何產品櫃 → 靜默
  const handleTreeSelectFile = useCallback((path: string) => {
    if (!dossierRoot || !path.startsWith(dossierRoot + "/")) return;
    const rel = path.slice(dossierRoot.length + 1);
    const seg = rel.split("/");
    if (seg.length < 2) return;
    const proj = seg[0];
    const name = seg[seg.length - 1];
    openDossier(proj, name, SHEET_RE.test(name));
    setTab("chat");
  }, [dossierRoot, openDossier]);

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

  const TABS: { id: Tab; label: string }[] = [
    { id: "chat", label: t("pm.tab.chat", "💬 專家對話") },
    { id: "board", label: t("pm.tab.board", "🗺️ 產品總覽") },
    { id: "todos", label: t("pm.tab.todos", "📋 需求池") },
    { id: "radar", label: t("pm.tab.radar", "🔔 截止雷達") },
    { id: "briefing", label: t("pm.tab.briefing", "🌅 晨間簡報") },
  ];

  return (
    <div className="flex h-full min-h-0 bg-stone-100">
      {/* ═══ 左 sidebar ═══ */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-stone-200 bg-white overflow-hidden">
        <div className="px-3 py-2.5 border-b border-stone-100">
          <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{t("pm.title", "🎯 產品經理室")}</div>
        </div>
        <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
          {/* 總管（landing） */}
          <button
            onClick={() => { setActiveAgent(CHIEF); setActiveAgentLabel("🎯 首席產品經理"); setTab("chat"); setOpenFile(null); }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${activeAgent === CHIEF && tab === "chat" ? "bg-stone-100 font-bold text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}
          >
            <span>🎯</span><span className="truncate">{t("pm.chief", "首席產品經理")}</span>
          </button>

          {/* 專家團隊（橫向職能：每個工作領域一個 AI 專家，方案 B）*/}
          <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("pm.experts", "專家團隊")}</div>
          {functions.map(p => (
            <button
              key={p.id}
              onClick={() => pickProject(p)}
              className={`w-full flex items-center gap-2 px-5 py-1.5 text-sm text-left transition-colors ${activeAgent === (p.agentId || `pm.${p.id}`) && tab === "chat" ? "bg-stone-100 font-bold text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}
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
      </aside>

      {/* ═══ 主區 ═══ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* tabs */}
        <div className="flex items-center gap-1 px-3 pt-2 pb-0 border-b border-stone-200 bg-white shrink-0">
          {TABS.map(tb => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`px-3.5 py-2 text-sm rounded-t-lg transition-colors ${tab === tb.id ? "font-bold text-stone-900 border-b-2 border-stone-800" : "text-stone-500 hover:text-stone-800"}`}
            >{tb.label}</button>
          ))}
          <div className="flex-1" />
          {tab === "chat" && <div className="text-[11px] text-stone-400 pr-2">{activeAgentLabel}</div>}
        </div>

        {/* content */}
        <div className="flex-1 min-h-0">
          {tab === "chat" && (
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
                  <ExpertChatPanel agentId={activeAgent} />
                </div>
              </div>
            ) : (
              <ExpertChatPanel agentId={activeAgent} />
            )
          )}

          {tab === "board" && (
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

          {tab === "todos" && (
            <div className="h-full overflow-y-auto bg-white p-6" style={{ scrollbarWidth: "thin" }}>
              <div className="max-w-3xl mx-auto">
                <div className="text-xs text-stone-400 mb-2">{t("pm.todosHint", "checkbox 落在各產品櫃（backlog 為主）— 勾掉請找該產品管家（點左邊產品），這裡是總掃描")}</div>
                <MarkdownText>{todosMd || "（掃描中…）"}</MarkdownText>
              </div>
            </div>
          )}

          {tab === "radar" && (
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

          {tab === "briefing" && (
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

      {/* ═══ 新增產品 modal ═══ */}
      {newOpen && (
        <NewProjectModal
          onClose={() => setNewOpen(false)}
          onCreated={(p) => { setActiveAgent(p.agentId); setActiveAgentLabel(`${p.emoji} ${p.name}`); setTab("chat"); loadTree(); }}
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
