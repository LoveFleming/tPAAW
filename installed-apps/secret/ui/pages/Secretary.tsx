/**
 * Secretary — 🕴️ 秘書模組主頁（landing = 總管秘書）
 * 殼：左 sidebar（總管 + 分類檔案櫃 + 新增分類/管理）× 上方功能 tabs（對話/交辦/效期/簡報）
 * 架構同 LearningSpace 精神：檔案是事實來源，專家負責讀寫自己的櫃。
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

type CatNode = { id: string; name: string; emoji: string; agentId: string; enabled: boolean; files: { name: string; size: number; mtime: string; sheet: boolean }[] };
type TabKind = "chat" | "todos" | "expirations" | "briefing";
type TabInst = { key: string; kind: TabKind; agentId: string; label: string };
type OpenFile = { cat: string; name: string; sheet: boolean };

const CHIEF = "secret.chief";
const LANDING: TabInst = { key: "chief", kind: "chat", agentId: CHIEF, label: "🕴️ 總管秘書" };

export default function Secretary() {
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
  // 動態 tabs：landing 固定總管；點專家/工具列才開 tab（可關）
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
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [cats, setCats] = useState<CatNode[]>([]);
  const [dossierRoot, setDossierRoot] = useState<string>("");
  const [mdContent, setMdContent] = useState("");
  const [mdDirty, setMdDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [todosMd, setTodosMd] = useState("");
  const [briefing, setBriefing] = useState<{ markdown: string; stats?: Record<string, number> }>({ markdown: "" });
  const [expiryItems, setExpiryItems] = useState<{ date: string; text: string; source: string; inDays: number; status: string }[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadCat = useRef<string>("");

  const loadTree = useCallback(async () => {
    try {
      const d = await fetch("/api/secret/dossiers").then(r => r.json());
      setCats(d.categories || []);
      if (d.root) setDossierRoot(String(d.root).replace(/\\/g, "/").replace(/\/+$/, ""));
    } catch { /* server 未掛載時靜默 */ }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  const loadPanel = useCallback(async (which: TabKind) => {
    if (which === "todos") {
      const d = await fetch("/api/secret/briefing?part=todos").then(r => r.json()).catch(() => null);
      if (d) setTodosMd(d.markdown || "");
    } else if (which === "briefing") {
      const d = await fetch("/api/secret/briefing").then(r => r.json()).catch(() => null);
      if (d) setBriefing(d);
    } else if (which === "expirations") {
      const d = await fetch("/api/secret/expirations").then(r => r.json()).catch(() => null);
      if (d) setExpiryItems(d.items || []);
    }
  }, []);

  useEffect(() => { if (active.kind !== "chat") loadPanel(active.kind); }, [active.key, active.kind, loadPanel]);

  // ── 動態 tabs ──
  const openTab = useCallback((tb: TabInst) => {
    setTabs(prev => prev.some(x => x.key === tb.key) ? prev : [...prev, tb]);
    setActiveKey(tb.key);
  }, []);
  const closeTab = useCallback((key: string) => {
    setTabs(prev => prev.filter(x => x.key === key).length ? prev.filter(x => x.key !== key) : [LANDING]);
  }, []);
  useEffect(() => { if (!tabs.some(x => x.key === activeKey)) setActiveKey("chief"); }, [tabs, activeKey]);

  // 開檔
  const openDossier = useCallback(async (cat: string, name: string, sheet: boolean) => {
    setOpenFile({ cat, name, sheet });
    setMdDirty(false);
    if (!sheet) {
      try {
        const d = await fetch(`/api/secret/dossiers/${encodeURIComponent(cat)}/${encodeURIComponent(name)}`).then(r => r.json());
        setMdContent(d.content ?? "");
      } catch { setMdContent(""); }
    }
  }, []);

  const saveMd = useCallback(async () => {
    if (!openFile) return;
    setSaving(true);
    try {
      await fetch(`/api/secret/dossiers/${encodeURIComponent(openFile.cat)}/${encodeURIComponent(openFile.name)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: mdContent }),
      });
      setMdDirty(false);
      loadTree();
    } finally { setSaving(false); }
  }, [openFile, mdContent, loadTree]);

  const pickCategory = useCallback((c: CatNode) => {
    openTab({ key: `expert:${c.id}`, kind: "chat", agentId: c.agentId || `secret.${c.id}`, label: `${c.emoji} ${c.name}` });
  }, [openTab]);

  // ── 檔案樹回呼（SidebarFileTree 同款）──
  // 檔案：root/<cat>/<name...> → 開檔（md 編輯 / sheet 預覽）；頂層檔不屬於任何分類 → 靜默
  const handleTreeSelectFile = useCallback((path: string) => {
    if (!dossierRoot || !path.startsWith(dossierRoot + "/")) return;
    const rel = path.slice(dossierRoot.length + 1);
    const seg = rel.split("/");
    if (seg.length < 2) return;
    const cat = seg[0];
    const name = seg[seg.length - 1];
    const c = cats.find(x => x.id === cat);
    if (c && c.enabled !== false) pickCategory(c);
    openDossier(cat, name, SHEET_RE.test(name));
  }, [dossierRoot, openDossier, cats, pickCategory]);

  // 目錄：頂層分類資料夾 → 切換專家（保留原 點分類=挑專家 行為）；底層子目錄只展開
  const handleTreeSelectDir = useCallback((path: string) => {
    if (!dossierRoot || !path.startsWith(dossierRoot + "/")) return;
    const rel = path.slice(dossierRoot.length + 1);
    if (rel.includes("/")) return;
    const c = cats.find(x => x.id === rel);
    if (c && c.enabled !== false) pickCategory(c);
  }, [dossierRoot, cats, pickCategory]);

  // 上傳（xlsx/csv/md）
  const doUpload = useCallback(async (files: FileList | null) => {
    if (!files || !uploadCat.current) return;
    const cat = uploadCat.current;
    for (const f of Array.from(files)) {
      const b64 = await new Promise<string>(res => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1] || "");
        fr.readAsDataURL(f);
      });
      await fetch(`/api/secret/dossiers/${encodeURIComponent(cat)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: f.name, dataBase64: b64 }),
      });
    }
    uploadRef.current && (uploadRef.current.value = "");
    loadTree();
  }, [loadTree]);

  // 工具列：點選才開 tab（不常駐）
  const TOOLS: { kind: TabKind; label: string }[] = [
    { kind: "todos", label: t("secret.tab.todos", "📋 交辦清單") },
    { kind: "expirations", label: t("secret.tab.expiry", "🔔 效期雷達") },
    { kind: "briefing", label: t("secret.tab.briefing", "🌅 晨間簡報") },
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
        {/* 工具：點選才開 tab（同學習空間工具列模式） */}
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
          <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{t("secret.title", "🕴️ 秘書 · 處長室")}</div>
        </div>
        <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
          {/* 總管（landing） */}
          <button
            onClick={() => { setActiveKey("chief"); setOpenFile(null); }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${activeKey === "chief" ? "bg-stone-100 font-bold text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}
          >
            <span>🕴️</span><span className="truncate">{t("secret.chief", "總管秘書")}</span>
          </button>

          {/* 專家團隊（每個秘書領域一個 AI 專家 — 同 PM 方案 B 展現） */}
          <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("secret.experts", "專家團隊")}</div>
          {cats.filter(c => c.enabled !== false).map(c => (
            <button
              key={c.id}
              onClick={() => pickCategory(c)}
              className={`w-full flex items-center gap-2 px-5 py-1.5 text-sm text-left transition-colors ${active.kind === "chat" && active.agentId === (c.agentId || `secret.${c.id}`) ? "bg-stone-100 font-bold text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}
            >
              <span>{c.emoji}</span><span className="truncate">{c.name}</span>
            </button>
          ))}

          <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("secret.cats", "分類檔案櫃")}</div>
          {/* 檔案樹：同 File Mounts（SidebarFileTree）— 展開/右鍵（新增/匯入/移動/改名/刪除）/自動刷新 */}
          {dossierRoot ? (
            <SidebarFileTree
              projectRoot={dossierRoot}
              activeFilePath={openFile && openFile.cat && openFile.name ? `${dossierRoot}/${openFile.cat}/${openFile.name}` : null}
              openFilePaths={new Set(openFile && openFile.name ? [`${dossierRoot}/${openFile.cat}/${openFile.name}`] : [])}
              onSelectFile={handleTreeSelectFile}
              onEditFile={handleTreeSelectFile}
              onSelectDir={handleTreeSelectDir}
              menuMode="files"
            />
          ) : (
            <div className="px-5 py-2 text-[11px] text-stone-300">{t("secret.treeLoading", "載入檔案樹…")}</div>
          )}
        </div>
        <div className="border-t border-stone-100 p-2 space-y-0.5">
          <button onClick={() => setUploadOpen(true)} className="w-full text-xs text-stone-500 hover:text-stone-800 py-1.5 px-2 rounded hover:bg-stone-50 text-left">
            ⬆️ {t("secret.uploadPick", "上傳檔案到分類")}
          </button>
          <button onClick={() => setManagerOpen(true)} className="w-full text-xs text-stone-500 hover:text-stone-800 py-1.5 px-2 rounded hover:bg-stone-50 text-left">
            ⚙️ {t("secret.manage", "管理分類 / 新增")}
          </button>
        </div>
        <input ref={uploadRef} type="file" multiple hidden onChange={e => doUpload(e.target.files)} />
      </aside>)}

      {/* ═══ 主區 ═══ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab Bar — 同學習空間：landing 總管固定第一頁不可關，其他開 tab sheet */}
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
                    <span className="text-[11px] text-stone-400 shrink-0">{openFile.cat}/</span>
                    <div className="flex-1" />
                    {!openFile.sheet && (
                      <button
                        onClick={saveMd}
                        disabled={!mdDirty || saving}
                        className="text-xs rounded-lg bg-stone-800 text-white px-3 py-1 disabled:opacity-30"
                      >{saving ? "…" : t("secret.save", "儲存")}</button>
                    )}
                    <button onClick={() => setOpenFile(null)} className="text-stone-400 hover:text-stone-700 text-lg leading-none px-1">✕</button>
                  </div>
                  {openFile.sheet ? (
                    <SheetPreview category={openFile.cat} file={openFile.name} onClose={() => setOpenFile(null)} />
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

          {active.kind === "todos" && (
            <div className="h-full overflow-y-auto bg-white p-6" style={{ scrollbarWidth: "thin" }}>
              <div className="max-w-3xl mx-auto">
                <div className="text-xs text-stone-400 mb-2">{t("secret.todosHint", "checkbox 落在檔案櫃裡 — 勾掉請找對應專家（點左邊分類），這裡是總掃描")}</div>
                <MarkdownText>{todosMd || "（掃描中…）"}</MarkdownText>
              </div>
            </div>
          )}

          {active.kind === "expirations" && (
            <div className="h-full overflow-y-auto bg-white p-6" style={{ scrollbarWidth: "thin" }}>
              <div className="max-w-3xl mx-auto space-y-2">
                <div className="text-xs text-stone-400 mb-2">{t("secret.expiryHint", "來源：檔案櫃內 [expires:YYYY-MM-DD] 標記 — 公文管理專家維護")}</div>
                {expiryItems.length === 0 && <div className="text-sm text-stone-400">✅ {t("secret.expiryClean", "效期雷達乾淨 — 沒有 30 天內到期項")}</div>}
                {expiryItems.map((it, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-stone-200 px-3 py-2">
                    <span className={`text-xs font-bold shrink-0 rounded-full px-2 py-0.5 ${it.status === "逾期" ? "bg-red-100 text-red-700" : it.status === "30天內" ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>
                      {it.status === "逾期" ? "🚨" : it.status === "30天內" ? "⏳" : ""} {it.status}
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
                  <button onClick={() => loadPanel("briefing")} className="text-xs rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-50">🔄 {t("secret.refresh", "重新掃描")}</button>
                  {briefing.stats && (
                    <div className="flex gap-2 text-[11px]">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">✅ {briefing.stats.todos ?? 0}</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">📅 {briefing.stats.events ?? 0}</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">🔔 {briefing.stats.expirations ?? 0}</span>
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

      {/* ═══ 管理分類 modal ═══ */}
      {managerOpen && (
        <CategoryManager
          cats={cats}
          onClose={() => setManagerOpen(false)}
          onChanged={loadTree}
        />
      )}

      {uploadOpen && (
        <UploadModal
          cats={cats.filter(c => c.enabled !== false)}
          onClose={() => setUploadOpen(false)}
          onPickCat={(catId) => { uploadCat.current = catId; setUploadOpen(false); setTimeout(() => uploadRef.current?.click(), 50); }}
        />
      )}
    </div>
  );
}

/** 上傳：選分類 → 開檔案挑選器（沿用原 doUpload 流程） */
function UploadModal({ cats, onClose, onPickCat }: { cats: CatNode[]; onClose: () => void; onPickCat: (catId: string) => void }) {
  const { t } = useI18n();
  const [cat, setCat] = useState(cats[0]?.id || "");
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[380px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-stone-100 flex items-center">
          <div className="font-bold text-stone-800">⬆️ {t("secret.uploadPick", "上傳檔案到分類")}</div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-xs text-stone-500">{t("secret.uploadHint", "選一個分類檔案櫃，然後挑選要上傳的檔案（xlsx / csv / md…）")}</div>
          <select value={cat} onChange={e => setCat(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm">
            {cats.length === 0 && <option value="">{t("secret.noCat", "（沒有可用分類 — 先到管理新增）")}</option>}
            {cats.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}（{c.files.length}）</option>)}
          </select>
          <button
            onClick={() => cat && onPickCat(cat)}
            disabled={!cat}
            className="w-full rounded-lg bg-stone-800 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >{t("secret.pickFiles", "選擇檔案…")}</button>
        </div>
      </div>
    </div>
  );
}

/** 分類管理：新增（自動生 agent）+ 換綁 + 停用 */
function CategoryManager({ cats, onClose, onChanged }: { cats: CatNode[]; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📁");
  const [desc, setDesc] = useState("");
  const [cid, setCid] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/secret/categories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cid.trim() || undefined, name: name.trim(), emoji: emoji.trim() || "📁", description: desc.trim() }),
      });
      const d = await r.json();
      if (d.error) { setMsg(`❌ ${d.error}`); return; }
      setCid("");
      setMsg(`✅ ${d.category.emoji} ${d.category.name} 已建立 — 專家 ${d.category.agentId} 上線（chat 清單重載後可聊）`);
      setName(""); setDesc("");
      onChanged();
    } finally { setBusy(false); }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch("/api/secret/categories", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    onChanged();
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-stone-100 flex items-center">
          <div className="font-bold text-stone-800">{t("secret.manager", "⚙️ 分類管理")}</div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">✕</button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4" style={{ scrollbarWidth: "thin" }}>
          {/* 新增 */}
          <div className="space-y-2">
            <div className="text-sm font-bold text-stone-700">➕ {t("secret.newCat", "新增分類（自動生專家）")}</div>
            <div className="flex gap-2">
              <input value={emoji} onChange={e => setEmoji(e.target.value)} className="w-16 rounded-lg border border-stone-200 px-2 py-1.5 text-sm text-center" placeholder="📁" />
              <input value={name} onChange={e => setName(e.target.value)} className="flex-1 rounded-lg border border-stone-200 px-3 py-1.5 text-sm" placeholder={t("secret.catName", "分類名稱，如：送禮記錄")} />
            </div>
            <input value={desc} onChange={e => setDesc(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm" placeholder={t("secret.catDesc", "一句職責描述（會寫進專家的 system prompt）")} />
            <input value={cid} onChange={e => setCid(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-mono" placeholder={t("secret.catId", "英文 id（可選，如 gifts；留空自動編號）")} />
            <button onClick={create} disabled={busy || !name.trim()} className="rounded-lg bg-stone-800 text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-40">
              {busy ? "建立中…" : t("secret.create", "建立")}
            </button>
            {msg && <div className="text-xs text-stone-600">{msg}</div>}
          </div>
          {/* 既有清單 */}
          <div className="space-y-1.5">
            <div className="text-sm font-bold text-stone-700 pt-2">{t("secret.existing", "既有分類（換綁 agent / 停用）")}</div>
            {cats.map(c => (
              <div key={c.id} className="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2">
                <span>{c.emoji}</span>
                <span className="text-sm text-stone-800 w-24 truncate shrink-0">{c.name}</span>
                <input
                  defaultValue={c.agentId}
                  onBlur={e => { if (e.target.value !== c.agentId) patch(c.id, { agentId: e.target.value.trim() }); }}
                  className="flex-1 min-w-0 rounded-lg border border-stone-200 px-2 py-1 text-xs font-mono"
                />
                <button
                  onClick={() => patch(c.id, { enabled: c.enabled === false })}
                  className={`text-xs rounded-full px-2.5 py-1 shrink-0 ${c.enabled === false ? "bg-stone-100 text-stone-400" : "bg-emerald-50 text-emerald-700"}`}
                >{c.enabled === false ? t("secret.disabled", "停用") : t("secret.enabled", "啟用")}</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
