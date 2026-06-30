/**
 * PAAW Notes — 筆記應用（OneNote 式）
 *
 * 佈局：
 *   頂部：[Notebook 下拉選單] [Section Tabs: 預設 | ... | ＋]
 *   主體：左側 Note list + Editor 大區塊 ｜ 右側 Search panel
 *
 * 圖片：paste upload + click to zoom + scroll to resize
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useTheme } from "../theme";
import API_BASE from "../api";

// ── Types ──

interface Notebook { id: string; name: string; color: string; icon: string; createdAt: string; }
interface Section { id: string; notebookId: string; name: string; icon: string; createdAt: string; }
interface NoteMeta {
  id: string; notebookId: string; sectionId?: string;
  notebookName?: string; sectionName?: string;
  title: string; tags: string[]; pinned: boolean;
  createdAt: string; updatedAt: string; excerpt: string; coverImage: string | null;
}
interface Note extends NoteMeta { content: string; }

interface NotesProps {
  deepLinkNote?: { noteId: string; notebookId: string } | null;
  onDeepLinkConsumed?: () => void;
}

export default function Notes({ deepLinkNote, onDeepLinkConsumed }: NotesProps) {
  const { info: th } = useTheme();

  const tk = {
    bg: "#fff", bgMuted: "#fafafa", bgHover: th.accentLight || "#f5f5f4",
    border: th.accentBorder || "#e5e5e5", borderLight: "#f0f0f0", borderInput: "#e0e0e0",
    textMuted: "#9ca3af", textPrimary: "#374151", textSecondary: "#6b7280",
    accent: th.accent, accentBg: th.accentBg, accentText: th.accentText,
    accentHover: th.accentHover, accentLight: th.accentLight,
  };

  // ── Data ──
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeNotebook, setActiveNotebook] = useState("default");
  const [activeSection, setActiveSection] = useState("default");
  const [activeNote, setActiveNote] = useState<Note | null>(null);

  // ── UI ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteMeta[] | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [nbDropdownOpen, setNbDropdownOpen] = useState(false);
  const [showNewNbInput, setShowNewNbInput] = useState(false);
  const [newNbName, setNewNbName] = useState("");
  const [showNewSecInput, setShowNewSecInput] = useState(false);
  const [newSecName, setNewSecName] = useState("");
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [aiWriting, setAiWriting] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");

  // ── Model selector state ──
  const [providers, setProviders] = useState<Record<string, any>>({});
  const [activeProviderId, setActiveProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/paaw/providers`)
      .then(r => r.json())
      .then(data => {
        setProviders(data.providers || {});
        setActiveProviderId(data.active || "");
        setSelectedModel(data.defaultModel || "");
      })
      .catch(() => {});
  }, []);

  const allModels = useCallback(() => {
    const result: { providerId: string; providerName: string; modelId: string; modelName: string }[] = [];
    for (const [pid, p] of Object.entries(providers)) {
      for (const m of (p.models || [])) {
        result.push({ providerId: pid, providerName: p.name, modelId: m.id, modelName: m.name });
      }
    }
    return result;
  }, [providers]);

  const activeModelName = allModels().find(m => `${m.providerId}/${m.modelId}` === selectedModel || m.modelId === selectedModel)?.modelName || selectedModel || "預設";
  const fullModelForApi = useCallback(() => {
    if (!selectedModel) return undefined;
    if (selectedModel.includes("/")) return selectedModel;
    return `${activeProviderId}/${selectedModel}`;
  }, [selectedModel, activeProviderId]);

  // ── Refs ──
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nbDropdownRef = useRef<HTMLDivElement>(null);
  const deepLinkProcessed = useRef<string | null>(null);

  // ════════════════════════════════════════
  // API
  // ════════════════════════════════════════

  const api = {
    get: async (path: string) => (await fetch(path)).json(),
    post: async (path: string, body: any) => (await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json(),
    put: async (path: string, body?: any) => (await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json(),
    del: async (path: string) => (await fetch(path, { method: "DELETE" })).json(),
  };

  const loadNotebooks = useCallback(async () => {
    const data = await api.get("/api/notes/notebooks");
    setNotebooks(data.notebooks || []);
  }, []);

  const loadSections = useCallback(async (nbId: string) => {
    const data = await api.get(`/api/notes/sections?notebook=${encodeURIComponent(nbId)}`);
    setSections(data.sections || []);
  }, []);

  const loadNotes = useCallback(async (nbId: string, secId?: string) => {
    let p = `/api/notes/list?notebook=${encodeURIComponent(nbId)}`;
    if (secId) p += `&section=${encodeURIComponent(secId)}`;
    const data = await api.get(p);
    setNotes(data.notes || []);
  }, []);

  const loadNote = useCallback(async (id: string, nbId: string) => {
    const data = await api.get(`/api/notes/get?id=${id}&notebook=${encodeURIComponent(nbId)}`);
    if (data.note) {
      setActiveNote(data.note);
      setTagsInput((data.note.tags || []).join(", "));
      setTimeout(() => {
        if (editorRef.current) editorRef.current.innerHTML = data.note.content || "";
      }, 50);
    }
  }, []);

  const loadTags = useCallback(async () => {
    const data = await api.get("/api/notes/tags");
    setAllTags((data.tags || []).map((t: any) => t.name));
  }, []);

  // ── Auto-save ──
  const saveNote = useCallback(async () => {
    if (!activeNote) return;
    const content = editorRef.current?.innerHTML || "";
    const title = titleRef.current?.value || activeNote.title;
    await api.put(`/api/notes/update?id=${activeNote.id}&notebook=${encodeURIComponent(activeNote.notebookId)}`, { title, content, tags: activeNote.tags });
    setNotes(prev => prev.map(n => n.id === activeNote.id ? { ...n, title, excerpt: content.replace(/<[^>]+>/g, "").slice(0, 120), updatedAt: new Date().toISOString() } : n));
  }, [activeNote]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNote(), 800);
  }, [saveNote]);

  // ── CRUD ──
  const createNote = useCallback(async () => {
    const data = await api.post("/api/notes/create", { notebookId: activeNotebook, sectionId: activeSection, title: "新筆記", content: "" });
    if (data.ok) {
      await loadNotes(activeNotebook, activeSection);
      await loadNote(data.note.id, activeNotebook);
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [activeNotebook, activeSection, loadNotes, loadNote]);

  const deleteNote = useCallback(async (id: string, nbId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("確定刪除？")) return;
    await api.del(`/api/notes/delete?id=${id}&notebook=${encodeURIComponent(nbId)}`);
    if (activeNote?.id === id) setActiveNote(null);
    await loadNotes(activeNotebook, activeSection);
  }, [activeNote, activeNotebook, activeSection, loadNotes]);

  const togglePin = useCallback(async (id: string, nbId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.put(`/api/notes/pin?id=${id}&notebook=${encodeURIComponent(nbId)}`);
    await loadNotes(activeNotebook, activeSection);
  }, [activeNotebook, activeSection, loadNotes]);

  // ── Search ──
  const doSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults(null); return; }
    const data = await api.get(`/api/notes/search?q=${encodeURIComponent(q)}`);
    setSearchResults(data.results || []);
  }, []);

  const filterByTag = useCallback(async (tag: string) => {
    if (activeTag === tag) { setActiveTag(null); setSearchResults(null); await loadNotes(activeNotebook, activeSection); return; }
    setActiveTag(tag);
    setSearchPanelOpen(true);
    const data = await api.get(`/api/notes/by-tag?tag=${encodeURIComponent(tag)}`);
    setSearchResults(data.results || []);
  }, [activeTag, activeNotebook, activeSection, loadNotes]);

  const updateTags = useCallback(() => {
    if (!activeNote) return;
    const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean);
    setActiveNote(prev => prev ? { ...prev, tags } : null);
    scheduleSave();
  }, [activeNote, tagsInput, scheduleSave]);

  // ── Notebook / Section ──
  const createNotebook = useCallback(async () => {
    if (!newNbName.trim()) return;
    const data = await api.post("/api/notes/notebooks", { name: newNbName });
    setNewNbName(""); setShowNewNbInput(false); setNbDropdownOpen(false);
    await loadNotebooks();
    if (data.ok) switchNotebook(data.notebook.id);
  }, [newNbName, loadNotebooks]);

  const createSection = useCallback(async () => {
    if (!newSecName.trim()) return;
    await api.post("/api/notes/sections", { notebookId: activeNotebook, name: newSecName });
    setNewSecName(""); setShowNewSecInput(false);
    await loadSections(activeNotebook);
  }, [newSecName, activeNotebook, loadSections]);

  const switchNotebook = useCallback(async (nbId: string) => {
    setActiveNotebook(nbId);
    setActiveSection("default");
    setActiveNote(null);
    setSearchQuery(""); setSearchResults(null); setActiveTag(null);
    setNbDropdownOpen(false);
    await loadSections(nbId);
    await loadNotes(nbId, "default");
  }, [loadSections, loadNotes]);

  const switchSection = useCallback(async (secId: string) => {
    setActiveSection(secId);
    setActiveNote(null);
    setSearchQuery(""); setSearchResults(null); setActiveTag(null);
    await loadNotes(activeNotebook, secId);
  }, [activeNotebook, loadNotes]);

  // ── AI 寫筆記 ──
  const aiWrite = useCallback(async () => {
    const content = aiInput.trim();
    if (!content || content.length < 5) return;
    setAiWriting(true);
    try {
      const resp = await fetch("/api/notes/ai-write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, prompt: aiPrompt.trim() || undefined, model: fullModelForApi() }),
      });
      const data = await resp.json();
      if (!data.ok) { alert(data.error || "AI 寫筆記失敗"); return; }

      // 建立新筆記並寫入 AI 產生的內容
      const createResp = await api.post("/api/notes/create", {
        notebookId: activeNotebook, sectionId: activeSection,
        title: data.title || "AI 筆記", content: data.content || "",
        tags: data.tags || [],
      });
      if (createResp.ok) {
        setAiInput(""); setAiPrompt(""); setAiPanelOpen(false);
        await loadNotes(activeNotebook, activeSection);
        await loadNote(createResp.note.id, activeNotebook);
      }
    } catch (err) {
      alert(`AI 寫筆記失敗：${err}`);
    } finally {
      setAiWriting(false);
    }
  }, [aiInput, aiPrompt, activeNotebook, activeSection, loadNotes, loadNote]);

  // ── Image ──
  const uploadImage = useCallback(async (file: File | Blob): Promise<string | null> => {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const resp = await fetch("/api/notes/upload-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: reader.result, filename: "paste.png" }) });
          const data = await resp.json();
          resolve(data.ok ? data.url : null);
        } catch { resolve(null); }
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const insertImageAtCursor = useCallback((url: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const img = document.createElement("img");
      img.src = url;
      img.style.maxWidth = "100%";
      img.style.borderRadius = "8px";
      img.style.margin = "8px 0";
      img.style.cursor = "pointer";
      img.onclick = () => setZoomImg(url);
      img.onwheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const cur = parseInt(img.style.maxWidth) || 100;
        img.style.maxWidth = `${Math.max(20, Math.min(200, Math.round(cur * factor)))}%`;
      };
      range.insertNode(img);
      range.setStartAfter(img);
      range.setEndAfter(img);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    scheduleSave();
  }, [scheduleSave]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) { const url = await uploadImage(file); if (url) insertImageAtCursor(url); }
      }
    }
  }, [uploadImage, insertImageAtCursor]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadImage(file);
    if (url) insertImageAtCursor(url);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [uploadImage, insertImageAtCursor]);

  const exec = useCallback((cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    scheduleSave();
  }, [scheduleSave]);

  // Attach handlers to existing images
  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.querySelectorAll("img").forEach(img => {
      img.style.cursor = "pointer";
      img.onclick = () => setZoomImg(img.src);
      img.onwheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const cur = parseInt((img as HTMLImageElement).style.maxWidth) || 100;
        (img as HTMLImageElement).style.maxWidth = `${Math.max(20, Math.min(200, Math.round(cur * factor)))}%`;
      };
    });
  }, [activeNote]);

  // Click outside closes notebook dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (nbDropdownRef.current && !nbDropdownRef.current.contains(e.target as Node)) {
        setNbDropdownOpen(false);
        setShowNewNbInput(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Init
  useEffect(() => {
    (async () => { await loadNotebooks(); await loadSections("default"); await loadNotes("default", "default"); await loadTags(); })();
  }, []);

  // Deep link: auto-open a specific note
  useEffect(() => {
    if (!deepLinkNote) return;
    const key = `${deepLinkNote.noteId}:${deepLinkNote.notebookId}`;
    console.log("[Notes DeepLink] received=", key, "processed=", deepLinkProcessed.current);
    if (deepLinkProcessed.current === key) return; // 已處理過
    deepLinkProcessed.current = key;

    (async () => {
      try {
        // 1. 確保 notebooks 已載入
        const nbs = await api.get("/api/notes/notebooks");
        setNotebooks(nbs.notebooks || []);
        console.log("[Notes DeepLink] notebooks loaded");

        // 2. 切到正確的 notebook
        if (deepLinkNote.notebookId !== activeNotebook) {
          setActiveNotebook(deepLinkNote.notebookId);
          const secData = await api.get(`/api/notes/sections?notebook=${encodeURIComponent(deepLinkNote.notebookId)}`);
          setSections(secData.sections || []);
          const noteData = await api.get(`/api/notes/list?notebook=${encodeURIComponent(deepLinkNote.notebookId)}`);
          setNotes(noteData.notes || []);
          console.log("[Notes DeepLink] notebook switched, sections/notes loaded");
        }

        // 3. 載入筆記內容
        const noteData = await api.get(`/api/notes/get?id=${deepLinkNote.noteId}&notebook=${encodeURIComponent(deepLinkNote.notebookId)}`);
        console.log("[Notes DeepLink] note loaded=", noteData.note?.id, noteData.note?.title);
        if (noteData.note) {
          setActiveNote(noteData.note);
          setTagsInput((noteData.note.tags || []).join(", "));
          // 等 React render 完 editor div 再設內容
          setTimeout(() => {
            if (editorRef.current) {
              editorRef.current.innerHTML = noteData.note.content || "";
              console.log("[Notes DeepLink] editor content set, len=", (noteData.note.content || "").length);
            }
            if (titleRef.current) {
              titleRef.current.value = noteData.note.title || "";
            }
          }, 100);
        }

        onDeepLinkConsumed?.();
      } catch (err) {
        console.error("[Notes DeepLink] failed:", err);
        onDeepLinkConsumed?.();
      }
    })();
  }, [deepLinkNote]);

  const displayNotes = searchResults || notes;
  const activeNb = notebooks.find(n => n.id === activeNotebook);

  // ════════════════════════════════════════ RENDER ════════════════════════════════════════

  return (
    <div className="h-full flex flex-col w-full overflow-hidden" style={{ background: tk.bg }}>
      {/* ══ 頂部 Bar：Notebook 下拉 + Section Tabs + Search toggle ══ */}
      <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
        {/* Notebook 下拉選單 */}
        <div className="relative shrink-0" ref={nbDropdownRef}>
          <button
            onClick={() => setNbDropdownOpen(!nbDropdownOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: tk.bg, border: `1px solid ${tk.borderInput}`, color: tk.textPrimary }}
          >
            <span>{activeNb?.icon || "📓"}</span>
            <span>{activeNb?.name || "選擇筆記本"}</span>
            <span style={{ color: tk.textMuted, fontSize: 10 }}>▼</span>
          </button>

          {nbDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 rounded-lg shadow-lg border py-1 z-50 min-w-180px" style={{ background: tk.bg, borderColor: tk.borderLight, minWidth: 180 }}>
              {notebooks.map(nb => (
                <div
                  key={nb.id}
                  onClick={() => switchNotebook(nb.id)}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors"
                  style={{ color: nb.id === activeNotebook ? tk.accent : tk.textPrimary, fontWeight: nb.id === activeNotebook ? 600 : 400 }}
                  onMouseEnter={e => e.currentTarget.style.background = tk.bgHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span>{nb.icon || "📓"}</span>
                  <span className="flex-1">{nb.name}</span>
                  {nb.id === activeNotebook && <span>✓</span>}
                </div>
              ))}
              <div className="border-t my-1" style={{ borderColor: tk.borderLight }} />
              {showNewNbInput ? (
                <div className="px-2 py-1.5">
                  <input
                    value={newNbName}
                    onChange={e => setNewNbName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") createNotebook(); if (e.key === "Escape") { setShowNewNbInput(false); setNewNbName(""); } }}
                    placeholder="筆記本名稱..."
                    className="w-full text-sm px-2 py-1 rounded border outline-none"
                    style={{ background: tk.bgMuted, borderColor: tk.borderInput, color: tk.textPrimary }}
                    autoFocus
                  />
                </div>
              ) : (
                <div
                  onClick={() => setShowNewNbInput(true)}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm"
                  style={{ color: tk.accent }}
                  onMouseEnter={e => e.currentTarget.style.background = tk.bgHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span>＋</span><span>新增筆記本</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section Tabs */}
        <div className="flex items-center gap-0 flex-1 overflow-hidden">
          {sections.map(sec => (
            <button
              key={sec.id}
              onClick={() => switchSection(sec.id)}
              className="px-3 py-1.5 text-sm rounded-t-md transition-colors whitespace-nowrap flex items-center gap-1"
              style={{
                background: activeSection === sec.id ? tk.bg : "transparent",
                color: activeSection === sec.id ? tk.textPrimary : tk.textMuted,
                borderBottom: activeSection === sec.id ? `2px solid ${tk.accent}` : "2px solid transparent",
                fontWeight: activeSection === sec.id ? 600 : 400,
              }}
              onMouseEnter={e => { if (activeSection !== sec.id) e.currentTarget.style.background = tk.bgHover; }}
              onMouseLeave={e => { if (activeSection !== sec.id) e.currentTarget.style.background = "transparent"; }}
            >
              <span>{sec.id === "default" ? "📋" : (sec.icon || "📁")}</span>
              <span>{sec.id === "default" ? "預設" : sec.name}</span>
            </button>
          ))}

          {/* New section input */}
          {showNewSecInput ? (
            <input
              value={newSecName}
              onChange={e => setNewSecName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") createSection(); if (e.key === "Escape") { setShowNewSecInput(false); setNewSecName(""); } }}
              onBlur={() => { if (!newSecName.trim()) setShowNewSecInput(false); }}
              placeholder="分類名稱..."
              className="text-sm px-2 py-1 rounded border outline-none ml-1"
              style={{ background: tk.bg, borderColor: tk.borderInput, color: tk.textPrimary, width: 100 }}
              autoFocus
            />
          ) : (
            <button
              onClick={() => setShowNewSecInput(true)}
              className="px-2 py-1.5 text-sm rounded-t-md shrink-0"
              style={{ color: tk.textMuted }}
              title="新增分類"
            >＋</button>
          )}
        </div>

        {/* AI write toggle */}
        <button
          onClick={() => { setAiPanelOpen(!aiPanelOpen); }}
          className="shrink-0 px-2.5 py-1.5 rounded-lg text-sm flex items-center gap-1 font-medium"
          style={{
            background: aiPanelOpen ? tk.accent : tk.accentBg,
            color: aiPanelOpen ? "#fff" : tk.accentText,
            border: `1px solid ${aiPanelOpen ? tk.accent : tk.accentBg}`,
          }}
        >✨ AI 寫筆記</button>

        {/* Model selector */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            className="px-2.5 py-1.5 rounded-lg text-sm flex items-center gap-1"
            style={{ background: showModelDropdown ? tk.accentBg : "transparent", color: showModelDropdown ? tk.accentText : tk.textMuted, border: `1px solid ${showModelDropdown ? tk.accent : tk.borderInput}` }}
            title="AI Model 偏好"
          >🤖 {activeModelName} ▾</button>
          {showModelDropdown && (
            <div className="absolute top-full right-0 mt-1 rounded-lg shadow-lg border py-1 z-50" style={{ background: tk.bg, borderColor: tk.borderLight, minWidth: 200, maxHeight: 300, overflow: "auto" }}>
              {allModels().map(m => {
                const fullId = `${m.providerId}/${m.modelId}`;
                const isActive = fullId === selectedModel || m.modelId === selectedModel;
                return (
                  <div key={fullId} onClick={() => { setSelectedModel(fullId); setShowModelDropdown(false); }}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm" style={{ background: isActive ? tk.accentBg : "transparent", color: tk.textPrimary }}
                    onMouseEnter={e => e.currentTarget.style.background = tk.bgHover}
                    onMouseLeave={e => e.currentTarget.style.background = isActive ? tk.accentBg : "transparent"}>
                    {isActive && <span style={{ color: tk.accent }}>✓</span>}
                    <div><div style={{ fontWeight: 500 }}>{m.modelName}</div><div className="text-xs" style={{ color: tk.textMuted }}>{m.providerName}</div></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Search toggle */}
        <button
          onClick={() => { setSearchPanelOpen(!searchPanelOpen); if (!searchPanelOpen) setSearchQuery(""); }}
          className="shrink-0 px-2.5 py-1.5 rounded-lg text-sm flex items-center gap-1"
          style={{
            background: searchPanelOpen ? tk.accentBg : "transparent",
            color: searchPanelOpen ? tk.accentText : tk.textMuted,
            border: `1px solid ${searchPanelOpen ? tk.accent : tk.borderInput}`,
          }}
        >🔍</button>
      </div>

      {/* ══ 主體 ══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── 左側大區塊：Note list + Editor ── */}
        <div className="flex-1 flex overflow-hidden">
          {/* Note list（窄） */}
          <div className="shrink-0 flex flex-col border-r" style={{ width: 240, background: tk.bg, borderColor: tk.borderLight }}>
            <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between" style={{ borderColor: tk.borderLight }}>
              <span className="text-xs font-semibold" style={{ color: tk.textMuted }}>
                {searchResults ? `搜尋結果 (${displayNotes.length})` : `${displayNotes.length} 則筆記`}
              </span>
              <button onClick={createNote} className="text-xs px-2 py-1 rounded font-medium text-white" style={{ background: tk.accent }}>＋ 新增</button>
            </div>

            <div className="flex-1 overflow-auto">
              {displayNotes.length === 0 ? (
                <div className="text-center py-12 text-sm" style={{ color: tk.textMuted }}>
                  {searchQuery || activeTag ? "沒有符合的筆記" : "點「＋ 新增」建立筆記"}
                </div>
              ) : (
                displayNotes.map(note => (
                  <div
                    key={note.id}
                    onClick={() => loadNote(note.id, note.notebookId)}
                    className="px-3 py-2.5 border-b cursor-pointer transition-colors group"
                    style={{ borderColor: tk.borderLight, background: activeNote?.id === note.id ? tk.accentBg : "transparent" }}
                    onMouseEnter={e => { if (activeNote?.id !== note.id) e.currentTarget.style.background = tk.bgHover; }}
                    onMouseLeave={e => { if (activeNote?.id !== note.id) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {note.pinned && <span className="text-xs">📌</span>}
                          <span className="text-sm font-medium truncate" style={{ color: tk.textPrimary }}>{note.title}</span>
                        </div>
                        <div className="text-xs mt-0.5 line-clamp-2" style={{ color: tk.textMuted }}>{note.excerpt || "（空白）"}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {note.tags?.slice(0, 2).map((t: string) => (
                            <span key={t} className="text-xs px-1 rounded" style={{ background: tk.accentBg, color: tk.accentText }}>#{t}</span>
                          ))}
                          <span className="text-xs ml-auto" style={{ color: tk.textMuted }}>
                            {note.updatedAt ? new Date(note.updatedAt).toLocaleDateString("zh-TW", { month: "short", day: "numeric" }) : ""}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={e => togglePin(note.id, note.notebookId, e)} className="text-xs hover:bg-black/10 rounded p-0.5" style={{ color: tk.textMuted }} title="釘選">
                          {note.pinned ? "📌" : "📍"}
                        </button>
                        <button onClick={e => deleteNote(note.id, note.notebookId, e)} className="text-xs hover:bg-red-50 rounded p-0.5" style={{ color: "#ef4444" }} title="刪除">🗑</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Tags at bottom */}
            {allTags.length > 0 && (
              <div className="border-t py-2 px-2 shrink-0" style={{ borderColor: tk.borderLight }}>
                <div className="text-xs font-semibold mb-1" style={{ color: tk.textMuted }}>標籤</div>
                <div className="flex flex-wrap gap-1">
                  {allTags.slice(0, 10).map(tag => (
                    <span key={tag} onClick={() => filterByTag(tag)} className="text-xs px-2 py-0.5 rounded-full cursor-pointer" style={{ background: activeTag === tag ? tk.accent : tk.accentBg, color: activeTag === tag ? "#fff" : tk.accentText }}>#{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Editor（大） */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ background: tk.bg }}>
            {!activeNote ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-6xl mb-4">📝</div>
                  <div className="text-lg" style={{ color: tk.textSecondary }}>選擇或建立筆記</div>
                  <button onClick={createNote} className="mt-4 px-6 py-2.5 rounded-lg text-white font-medium" style={{ background: tk.accent }}>＋ 新建筆記</button>
                </div>
              </div>
            ) : (
              <>
                {/* Toolbar */}
                <div className="flex items-center gap-1 px-4 py-1.5 border-b shrink-0 flex-wrap" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                  <button onClick={() => exec("bold")} className="toolBtn" style={toolBtnStyle(tk)}><b>B</b></button>
                  <button onClick={() => exec("italic")} className="toolBtn" style={toolBtnStyle(tk)}><i>I</i></button>
                  <button onClick={() => exec("underline")} className="toolBtn" style={toolBtnStyle(tk)}><u>U</u></button>
                  <div className="w-px h-5" style={{ background: tk.border }} />
                  <button onClick={() => exec("formatBlock", "<h2>")} className="toolBtn" style={toolBtnStyle(tk)}>H2</button>
                  <button onClick={() => exec("formatBlock", "<h3>")} className="toolBtn" style={toolBtnStyle(tk)}>H3</button>
                  <button onClick={() => exec("formatBlock", "<p>")} className="toolBtn" style={toolBtnStyle(tk)}>P</button>
                  <div className="w-px h-5" style={{ background: tk.border }} />
                  <button onClick={() => exec("insertUnorderedList")} className="toolBtn" style={toolBtnStyle(tk)}>•</button>
                  <button onClick={() => exec("insertOrderedList")} className="toolBtn" style={toolBtnStyle(tk)}>1.</button>
                  <button onClick={() => exec("formatBlock", "<blockquote>")} className="toolBtn" style={toolBtnStyle(tk)}>❝</button>
                  <button onClick={() => exec("formatBlock", "<pre>")} className="toolBtn" style={toolBtnStyle(tk)}>{"</>"}</button>
                  <div className="w-px h-5" style={{ background: tk.border }} />
                  <button onClick={() => fileInputRef.current?.click()} className="toolBtn" style={toolBtnStyle(tk)}>🖼</button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                  <div className="flex-1" />
                  <button onClick={() => setShowTagEditor(!showTagEditor)} className="toolBtn" style={toolBtnStyle(tk)}>🏷</button>
                </div>

                {showTagEditor && (
                  <div className="flex items-center gap-2 px-4 py-1.5 border-b" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                    <span className="text-xs" style={{ color: tk.textMuted }}>標籤：</span>
                    <input value={tagsInput} onChange={e => setTagsInput(e.target.value)} onBlur={updateTags}
                      onKeyDown={e => { if (e.key === "Enter") { updateTags(); setShowTagEditor(false); } }}
                      placeholder="逗號分隔：工作, 重要, Idea"
                      className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                      style={{ background: tk.bg, borderColor: tk.borderInput, color: tk.textPrimary }} />
                  </div>
                )}

                <div className="px-8 pt-5 pb-1 shrink-0">
                  <input ref={titleRef} defaultValue={activeNote.title} onChange={scheduleSave}
                    className="w-full text-2xl font-bold outline-none border-none bg-transparent"
                    style={{ color: tk.textPrimary }} placeholder="標題..." />
                </div>

                <div className="px-8 pb-2 flex items-center gap-3 text-xs shrink-0" style={{ color: tk.textMuted }}>
                  <span>🕐 {new Date(activeNote.updatedAt).toLocaleString("zh-TW")}</span>
                  {activeNote.tags.length > 0 && (
                    <span className="flex gap-1">
                      {activeNote.tags.map(t => <span key={t} className="px-1.5 rounded" style={{ background: tk.accentBg, color: tk.accentText }}>#{t}</span>)}
                    </span>
                  )}
                  <span className="ml-auto">滾輪縮放圖片 · 點擊放大</span>
                </div>

                <div className="flex-1 overflow-auto px-8 pb-12">
                  <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={scheduleSave} onPaste={handlePaste}
                    className="outline-none min-h-full"
                    style={{ color: tk.textPrimary, fontSize: 15, lineHeight: 1.8, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
                    data-placeholder="開始輸入... 可直接貼上圖片（Ctrl+V）" />
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── AI 寫筆記 Panel（可收合） ── */}
        {aiPanelOpen && (
          <div className="shrink-0 flex flex-col border-l" style={{ width: 340, background: tk.bg, borderColor: tk.borderLight }}>
            <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: tk.borderLight }}>
              <span className="text-sm font-semibold" style={{ color: tk.textPrimary }}>✨ AI 寫筆記</span>
              <button onClick={() => setAiPanelOpen(false)} className="text-xs px-1.5 rounded" style={{ color: tk.textMuted }}>✕</button>
            </div>

            <div className="flex-1 flex flex-col p-3 gap-3 overflow-auto">
              <div className="flex flex-col flex-1">
                <label className="text-xs font-medium mb-1" style={{ color: tk.textSecondary }}>貼上要整理的內容</label>
                <textarea
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  placeholder="貼上會議記錄、文章、想法、對話內容...\nAI 會幫你整理成結構化筆記"
                  className="flex-1 w-full px-3 py-2 rounded-lg border outline-none text-sm"
                  style={{ background: tk.bgMuted, borderColor: tk.borderInput, color: tk.textPrimary, resize: "none", minHeight: 160, lineHeight: 1.6 }}
                />
              </div>

              <div className="flex flex-col">
                <label className="text-xs font-medium mb-1" style={{ color: tk.textSecondary }}>AI 提示詞（選填）<span style={{ color: tk.textMuted, fontWeight: 400 }}> · Shift+Enter 換行</span></label>
                <textarea
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder={"例如：\n整理成會議記錄，列出決策和行動項\n翻譯成英文並加上重點說明\n用表格整理比較"}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border outline-none text-sm"
                  style={{ background: tk.bgMuted, borderColor: tk.borderInput, color: tk.textPrimary, resize: "none", lineHeight: 1.6 }}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); aiWrite(); } }}
                />
              </div>

              <button
                onClick={aiWrite}
                disabled={aiWriting || aiInput.trim().length < 5}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
                style={{
                  background: aiWriting || aiInput.trim().length < 5 ? tk.bgMuted : tk.accent,
                  color: aiWriting || aiInput.trim().length < 5 ? tk.textMuted : "#fff",
                  cursor: aiWriting || aiInput.trim().length < 5 ? "not-allowed" : "pointer",
                }}
              >
                {aiWriting ? (
                  <>
                    <span className="ai-spinner" style={{ fontSize: 18 }}>⏳</span>
                    AI 整理中...
                  </>
                ) : "✨ 幫我寫筆記"}
              </button>

              <div className="text-xs text-center" style={{ color: tk.textMuted }}>
                AI 會自動建立一則新筆記
              </div>
            </div>
          </div>
        )}

        {/* ── 右側：Search Panel（可收合） ── */}
        {searchPanelOpen && (
          <div className="shrink-0 flex flex-col border-l" style={{ width: 280, background: tk.bg, borderColor: tk.borderLight }}>
            <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: tk.borderLight }}>
              <input
                value={searchQuery}
                onChange={e => doSearch(e.target.value)}
                placeholder="搜尋所有筆記..."
                className="flex-1 text-sm px-3 py-1.5 rounded-lg border outline-none"
                style={{ background: tk.bgMuted, borderColor: tk.borderInput, color: tk.textPrimary }}
                autoFocus
              />
              <button onClick={() => { setSearchPanelOpen(false); setSearchQuery(""); setSearchResults(null); }}
                className="text-xs px-1.5 rounded" style={{ color: tk.textMuted }}>✕</button>
            </div>

            <div className="flex-1 overflow-auto">
              {searchQuery && (!searchResults || searchResults.length === 0) ? (
                <div className="text-center py-12 text-sm" style={{ color: tk.textMuted }}>沒有符合的筆記</div>
              ) : searchResults ? (
                searchResults.map(note => (
                  <div key={note.id} onClick={() => loadNote(note.id, note.notebookId)}
                    className="px-3 py-2.5 border-b cursor-pointer transition-colors"
                    style={{ borderColor: tk.borderLight, background: activeNote?.id === note.id ? tk.accentBg : "transparent" }}
                    onMouseEnter={e => e.currentTarget.style.background = tk.bgHover}
                    onMouseLeave={e => { if (activeNote?.id !== note.id) e.currentTarget.style.background = "transparent"; }}>
                    <div className="text-sm font-medium truncate" style={{ color: tk.textPrimary }}>{note.title}</div>
                    {note.notebookName && <div className="text-xs mt-0.5" style={{ color: tk.textMuted }}>📁 {note.notebookName}</div>}
                    <div className="text-xs mt-1 line-clamp-2" style={{ color: tk.textSecondary }}>{note.excerpt}</div>
                    {note.tags?.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {note.tags.slice(0, 3).map(t => <span key={t} className="text-xs px-1 rounded" style={{ background: tk.accentBg, color: tk.accentText }}>#{t}</span>)}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-sm" style={{ color: tk.textMuted }}>
                  輸入關鍵字搜尋所有筆記
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══ 圖片放大 Modal ══ */}
      {zoomImg && (
        <div onClick={() => setZoomImg(null)} className="fixed inset-0 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.8)", zIndex: 9999, cursor: "zoom-out" }}>
          <img src={zoomImg} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}
            onClick={e => e.stopPropagation()} />
          <button onClick={() => setZoomImg(null)} className="fixed top-4 right-4 text-white text-2xl px-3 py-1 rounded-full"
            style={{ background: "rgba(255,255,255,0.2)" }}>✕</button>
        </div>
      )}
    </div>
  );
}

function toolBtnStyle(tk: any): React.CSSProperties {
  return {
    padding: "4px 8px", background: "transparent", border: "1px solid transparent", borderRadius: 4,
    color: tk.textSecondary, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center",
  };
}
