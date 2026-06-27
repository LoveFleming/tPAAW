/**
 * PAAW Notes — OneNote 式筆記應用
 *
 * 佈局：頂部 Project tabs > 左側 Section > 中間 Note list > 右側 Editor
 * 圖片：paste upload + click to zoom + scroll to resize
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useTheme } from "../theme";

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

export default function Notes() {
  const { info: th } = useTheme();

  const tk = {
    bg: "#fff", bgMuted: "#fafafa", bgHover: th.accentLight || "#f5f5f4",
    border: th.accentBorder || "#e5e5e5", borderLight: "#f0f0f0", borderInput: "#e0e0e0",
    textMuted: "#9ca3af", textPrimary: "#374151", textSecondary: "#6b7280",
    accent: th.accent, accentBg: th.accentBg, accentText: th.accentText,
    accentHover: th.accentHover, accentLight: th.accentLight,
  };

  // ── Data state ──
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeNotebook, setActiveNotebook] = useState("default");
  const [activeSection, setActiveSection] = useState("default");
  const [activeNote, setActiveNote] = useState<Note | null>(null);

  // ── UI state ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteMeta[] | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showNewNb, setShowNewNb] = useState(false);
  const [newNbName, setNewNbName] = useState("");
  const [showNewSec, setShowNewSec] = useState(false);
  const [newSecName, setNewSecName] = useState("");
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [zoomImg, setZoomImg] = useState<string | null>(null);

  // ── Refs ──
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ════════════════════════════════════════
  // API calls
  // ════════════════════════════════════════

  const api = {
    get: async (path: string) => (await fetch(path)).json(),
    post: async (path: string, body: any) => (await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json(),
    put: async (path: string, body?: any) => (await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json(),
    del: async (path: string) => (await fetch(path, { method: "DELETE" })).json(),
  };

  // ── Load notebooks ──
  const loadNotebooks = useCallback(async () => {
    const data = await api.get("/api/notes/notebooks");
    setNotebooks(data.notebooks || []);
  }, []);

  // ── Load sections ──
  const loadSections = useCallback(async (notebookId: string) => {
    const data = await api.get(`/api/notes/sections?notebook=${encodeURIComponent(notebookId)}`);
    setSections(data.sections || []);
  }, []);

  // ── Load notes ──
  const loadNotes = useCallback(async (notebookId: string, sectionId?: string) => {
    let path = `/api/notes/list?notebook=${encodeURIComponent(notebookId)}`;
    if (sectionId) path += `&section=${encodeURIComponent(sectionId)}`;
    const data = await api.get(path);
    setNotes(data.notes || []);
  }, []);

  // ── Load note ──
  const loadNote = useCallback(async (noteId: string, notebookId: string) => {
    const data = await api.get(`/api/notes/get?id=${noteId}&notebook=${encodeURIComponent(notebookId)}`);
    if (data.note) {
      setActiveNote(data.note);
      setTagsInput((data.note.tags || []).join(", "));
      setTimeout(() => {
        if (editorRef.current) editorRef.current.innerHTML = data.note.content || "";
      }, 50);
    }
  }, []);

  // ── Load tags ──
  const loadTags = useCallback(async () => {
    const data = await api.get("/api/notes/tags");
    setAllTags((data.tags || []).map((t: any) => t.name));
  }, []);

  // ── Auto-save ──
  const saveNote = useCallback(async () => {
    if (!activeNote) return;
    const content = editorRef.current?.innerHTML || "";
    const title = titleRef.current?.value || activeNote.title;
    await api.put(`/api/notes/update?id=${activeNote.id}&notebook=${encodeURIComponent(activeNote.notebookId)}`, {
      title, content, tags: activeNote.tags,
    });
    setNotes(prev => prev.map(n =>
      n.id === activeNote.id
        ? { ...n, title, excerpt: content.replace(/<[^>]+>/g, "").slice(0, 120), updatedAt: new Date().toISOString() }
        : n
    ));
  }, [activeNote]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNote(), 800);
  }, [saveNote]);

  // ── Create note ──
  const createNote = useCallback(async () => {
    const data = await api.post("/api/notes/create", {
      notebookId: activeNotebook, sectionId: activeSection, title: "新筆記", content: "",
    });
    if (data.ok) {
      await loadNotes(activeNotebook, activeSection);
      await loadNote(data.note.id, activeNotebook);
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [activeNotebook, activeSection, loadNotes, loadNote]);

  // ── Delete note ──
  const deleteNote = useCallback(async (noteId: string, notebookId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("確定刪除？")) return;
    await api.del(`/api/notes/delete?id=${noteId}&notebook=${encodeURIComponent(notebookId)}`);
    if (activeNote?.id === noteId) setActiveNote(null);
    await loadNotes(activeNotebook, activeSection);
  }, [activeNote, activeNotebook, activeSection, loadNotes]);

  // ── Pin note ──
  const togglePin = useCallback(async (noteId: string, notebookId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.put(`/api/notes/pin?id=${noteId}&notebook=${encodeURIComponent(notebookId)}`);
    await loadNotes(activeNotebook, activeSection);
  }, [activeNotebook, activeSection, loadNotes]);

  // ── Search ──
  const doSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults(null); return; }
    const data = await api.get(`/api/notes/search?q=${encodeURIComponent(q)}`);
    setSearchResults(data.results || []);
  }, []);

  // ── Tag filter ──
  const filterByTag = useCallback(async (tag: string) => {
    if (activeTag === tag) { setActiveTag(null); setSearchResults(null); await loadNotes(activeNotebook, activeSection); return; }
    setActiveTag(tag);
    const data = await api.get(`/api/notes/by-tag?tag=${encodeURIComponent(tag)}`);
    setSearchResults(data.results || []);
  }, [activeTag, activeNotebook, activeSection, loadNotes]);

  const updateTags = useCallback(() => {
    if (!activeNote) return;
    const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean);
    setActiveNote(prev => prev ? { ...prev, tags } : null);
    scheduleSave();
  }, [activeNote, tagsInput, scheduleSave]);

  // ── Create notebook ──
  const createNotebook = useCallback(async () => {
    if (!newNbName.trim()) return;
    await api.post("/api/notes/notebooks", { name: newNbName });
    setNewNbName(""); setShowNewNb(false);
    await loadNotebooks();
  }, [newNbName, loadNotebooks]);

  // ── Create section ──
  const createSection = useCallback(async () => {
    if (!newSecName.trim()) return;
    await api.post("/api/notes/sections", { notebookId: activeNotebook, name: newSecName });
    setNewSecName(""); setShowNewSec(false);
    await loadSections(activeNotebook);
  }, [newSecName, activeNotebook, loadSections]);

  // ── Switch notebook ──
  const switchNotebook = useCallback(async (nbId: string) => {
    setActiveNotebook(nbId);
    setActiveSection("default");
    setActiveNote(null);
    setSearchQuery(""); setSearchResults(null); setActiveTag(null);
    await loadSections(nbId);
    await loadNotes(nbId, "default");
  }, [loadSections, loadNotes]);

  // ── Switch section ──
  const switchSection = useCallback(async (secId: string) => {
    setActiveSection(secId);
    setActiveNote(null);
    setSearchQuery(""); setSearchResults(null); setActiveTag(null);
    await loadNotes(activeNotebook, secId);
  }, [activeNotebook, loadNotes]);

  // ════════════════════════════════════════
  // Image upload helper
  // ════════════════════════════════════════

  const uploadImage = useCallback(async (file: File | Blob): Promise<string | null> => {
    const reader = new FileReader();
    return new Promise(resolve => {
      reader.onload = async () => {
        try {
          const resp = await fetch("/api/notes/upload-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: reader.result, filename: "paste.png" }),
          });
          const data = await resp.json();
          resolve(data.ok ? data.url : null);
        } catch { resolve(null); }
      };
      reader.readAsDataURL(file);
    });
  }, []);

  // ── Insert image at cursor ──
  const insertImageAtCursor = useCallback((imgUrl: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    // 使用 Range API 而非 execCommand
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const img = document.createElement("img");
      img.src = imgUrl;
      img.style.maxWidth = "100%";
      img.style.borderRadius = "8px";
      img.style.margin = "8px 0";
      img.style.cursor = "pointer";
      img.dataset.zoomable = "true";
      img.addEventListener("click", () => setZoomImg(imgUrl));
      img.addEventListener("wheel", (e: Event) => {
        e.preventDefault();
        const we = e as WheelEvent;
        const factor = we.deltaY < 0 ? 1.1 : 0.9;
        const currentW = parseInt(img.style.maxWidth) || 100;
        const newW = Math.max(20, Math.min(200, Math.round(currentW * factor)));
        img.style.maxWidth = `${newW}%`;
      });
      range.insertNode(img);
      range.setStartAfter(img);
      range.setEndAfter(img);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    scheduleSave();
  }, [scheduleSave]);

  // ── Paste handler（修復版） ──
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    // 檢查有沒有圖片
    const items = clipboard.items;
    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        hasImage = true;
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          const imgUrl = await uploadImage(file);
          if (imgUrl) insertImageAtCursor(imgUrl);
        }
      }
    }
    // 如果沒有圖片，讓瀏覽器正常處理文字貼上
    if (!hasImage) {
      // 預設行為，不阻止
    }
  }, [uploadImage, insertImageAtCursor]);

  // ── File upload (toolbar button) ──
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const imgUrl = await uploadImage(file);
    if (imgUrl) insertImageAtCursor(imgUrl);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [uploadImage, insertImageAtCursor]);

  // ── Editor toolbar ──
  const exec = useCallback((cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    scheduleSave();
  }, [scheduleSave]);

  // ── Attach click handlers to existing images after load ──
  useEffect(() => {
    if (!editorRef.current) return;
    const imgs = editorRef.current.querySelectorAll("img");
    imgs.forEach(img => {
      img.style.cursor = "pointer";
      img.dataset.zoomable = "true";
      img.onclick = () => setZoomImg(img.src);
      img.onwheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const currentW = parseInt((img as HTMLImageElement).style.maxWidth) || 100;
        const newW = Math.max(20, Math.min(200, Math.round(currentW * factor)));
        (img as HTMLImageElement).style.maxWidth = `${newW}%`;
      };
    });
  }, [activeNote]);

  // ── Init ──
  useEffect(() => {
    (async () => {
      await loadNotebooks();
      await loadSections("default");
      await loadNotes("default", "default");
      await loadTags();
    })();
  }, []);

  const displayNotes = searchResults || notes;

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  return (
    <div className="h-full flex flex-col w-full overflow-hidden" style={{ background: tk.bg }}>
      {/* ══ 頂部：Project Tabs ══ */}
      <div className="shrink-0 flex items-center gap-0 px-2 pt-1.5 border-b" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
        {notebooks.map(nb => (
          <button
            key={nb.id}
            onClick={() => switchNotebook(nb.id)}
            className="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            style={{
              background: activeNotebook === nb.id ? tk.bg : "transparent",
              color: activeNotebook === nb.id ? tk.textPrimary : tk.textMuted,
              borderBottom: activeNotebook === nb.id ? `2px solid ${tk.accent}` : "2px solid transparent",
              marginBottom: "-1px",
            }}
            onMouseEnter={e => { if (activeNotebook !== nb.id) e.currentTarget.style.background = tk.bgHover; }}
            onMouseLeave={e => { if (activeNotebook !== nb.id) e.currentTarget.style.background = "transparent"; }}
          >
            <span>{nb.icon || "📓"}</span>
            <span>{nb.name}</span>
          </button>
        ))}
        <button
          onClick={() => setShowNewNb(!showNewNb)}
          className="px-2 py-2 text-sm rounded-t-lg"
          style={{ color: tk.textMuted }}
          title="新增 Project"
        >＋</button>
        {showNewNb && (
          <input
            value={newNbName}
            onChange={e => setNewNbName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") createNotebook(); if (e.key === "Escape") setShowNewNb(false); }}
            onBlur={() => { if (!newNbName.trim()) setShowNewNb(false); }}
            placeholder="Project 名稱..."
            className="text-sm px-2 py-1 rounded border outline-none"
            style={{ background: tk.bg, borderColor: tk.borderInput, color: tk.textPrimary, width: 120 }}
            autoFocus
          />
        )}
      </div>

      {/* ══ 主體區 ══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── 左側：Section sidebar ── */}
        <div className="shrink-0 flex flex-col border-r" style={{ width: 180, background: tk.bgMuted, borderColor: tk.borderLight }}>
          {/* Section header */}
          <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: tk.borderLight }}>
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: tk.textMuted }}>分類</span>
            <button onClick={() => setShowNewSec(!showNewSec)} className="text-xs px-1 rounded hover:bg-black/5" style={{ color: tk.textMuted }} title="新增分類">＋</button>
          </div>

          {showNewSec && (
            <div className="px-2 py-1.5 border-b" style={{ borderColor: tk.borderLight }}>
              <input
                value={newSecName}
                onChange={e => setNewSecName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") createSection(); if (e.key === "Escape") setShowNewSec(false); }}
                placeholder="分類名稱..."
                className="w-full text-xs px-2 py-1 rounded border outline-none"
                style={{ background: tk.bg, borderColor: tk.borderInput, color: tk.textPrimary }}
                autoFocus
              />
            </div>
          )}

          {/* Section list */}
          <div className="flex-1 overflow-auto py-1">
            {sections.map(sec => (
              <div
                key={sec.id}
                onClick={() => switchSection(sec.id)}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors"
                style={{
                  background: activeSection === sec.id ? tk.accentBg : "transparent",
                  color: activeSection === sec.id ? tk.accentText : tk.textSecondary,
                  fontWeight: activeSection === sec.id ? 600 : 400,
                  borderLeft: activeSection === sec.id ? `3px solid ${tk.accent}` : "3px solid transparent",
                }}
                onMouseEnter={e => { if (activeSection !== sec.id) e.currentTarget.style.background = tk.bgHover; }}
                onMouseLeave={e => { if (activeSection !== sec.id) e.currentTarget.style.background = "transparent"; }}
              >
                <span>{sec.icon || "📁"}</span>
                <span className="truncate flex-1">{sec.name}</span>
              </div>
            ))}
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="border-t py-2" style={{ borderColor: tk.borderLight }}>
              <div className="px-3 py-1 text-xs font-semibold" style={{ color: tk.textMuted }}>標籤</div>
              <div className="px-2 flex flex-wrap gap-1">
                {allTags.slice(0, 10).map(tag => (
                  <span
                    key={tag}
                    onClick={() => filterByTag(tag)}
                    className="text-xs px-2 py-0.5 rounded-full cursor-pointer transition-colors"
                    style={{
                      background: activeTag === tag ? tk.accent : tk.accentBg,
                      color: activeTag === tag ? "#fff" : tk.accentText,
                    }}
                  >#{tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── 中間：Note list ── */}
        <div className="shrink-0 flex flex-col border-r" style={{ width: 260, background: tk.bg, borderColor: tk.borderLight }}>
          {/* Search + New */}
          <div className="px-3 py-2 border-b" style={{ borderColor: tk.borderLight }}>
            <div className="flex items-center gap-2">
              <input
                value={searchQuery}
                onChange={e => doSearch(e.target.value)}
                placeholder="🔍 搜尋..."
                className="flex-1 text-sm px-3 py-1.5 rounded-lg border outline-none"
                style={{ background: tk.bgMuted, borderColor: tk.borderInput, color: tk.textPrimary }}
              />
              <button
                onClick={createNote}
                className="text-xs px-2.5 py-1.5 rounded-lg font-medium shrink-0 text-white"
                style={{ background: tk.accent }}
              >＋ 新增</button>
            </div>
          </div>

          {/* Note cards */}
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
                  style={{
                    borderColor: tk.borderLight,
                    background: activeNote?.id === note.id ? tk.accentBg : "transparent",
                  }}
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
                        {searchResults && note.notebookName && (
                          <span className="text-xs px-1 rounded" style={{ background: tk.bgMuted, color: tk.textMuted }}>{note.notebookName}</span>
                        )}
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
        </div>

        {/* ── 右側：Editor ── */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: tk.bg }}>
          {!activeNote ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">📝</div>
                <div className="text-lg" style={{ color: tk.textSecondary }}>選擇或建立筆記</div>
                <button onClick={createNote} className="mt-4 px-6 py-2.5 rounded-lg text-white font-medium" style={{ background: tk.accent }}>
                  ＋ 新建筆記
                </button>
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

              {/* Tag editor */}
              {showTagEditor && (
                <div className="flex items-center gap-2 px-4 py-1.5 border-b" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                  <span className="text-xs" style={{ color: tk.textMuted }}>標籤：</span>
                  <input
                    value={tagsInput}
                    onChange={e => setTagsInput(e.target.value)}
                    onBlur={updateTags}
                    onKeyDown={e => { if (e.key === "Enter") { updateTags(); setShowTagEditor(false); } }}
                    placeholder="逗號分隔：工作, 重要, Idea"
                    className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                    style={{ background: tk.bg, borderColor: tk.borderInput, color: tk.textPrimary }}
                  />
                </div>
              )}

              {/* Title */}
              <div className="px-8 pt-5 pb-1 shrink-0">
                <input
                  ref={titleRef}
                  defaultValue={activeNote.title}
                  onChange={scheduleSave}
                  className="w-full text-2xl font-bold outline-none border-none bg-transparent"
                  style={{ color: tk.textPrimary }}
                  placeholder="標題..."
                />
              </div>

              {/* Meta */}
              <div className="px-8 pb-2 flex items-center gap-3 text-xs shrink-0" style={{ color: tk.textMuted }}>
                <span>🕐 {new Date(activeNote.updatedAt).toLocaleString("zh-TW")}</span>
                {activeNote.tags.length > 0 && (
                  <span className="flex gap-1">
                    {activeNote.tags.map(t => (
                      <span key={t} className="px-1.5 rounded" style={{ background: tk.accentBg, color: tk.accentText }}>#{t}</span>
                    ))}
                  </span>
                )}
                <span className="ml-auto" style={{ color: tk.textMuted }}>滾輪縮放圖片 · 點擊圖片放大</span>
              </div>

              {/* Editor */}
              <div className="flex-1 overflow-auto px-8 pb-12">
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={scheduleSave}
                  onPaste={handlePaste}
                  className="outline-none min-h-full"
                  style={{
                    color: tk.textPrimary,
                    fontSize: 15,
                    lineHeight: 1.8,
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  }}
                  data-placeholder="開始輸入... 可直接貼上圖片（Ctrl+V）"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ══ 圖片放大 Modal ══ */}
      {zoomImg && (
        <div
          onClick={() => setZoomImg(null)}
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.8)", zIndex: 9999, cursor: "zoom-out" }}
        >
          <img
            src={zoomImg}
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setZoomImg(null)}
            className="fixed top-4 right-4 text-white text-2xl px-3 py-1 rounded-full"
            style={{ background: "rgba(255,255,255,0.2)" }}
          >✕</button>
        </div>
      )}
    </div>
  );
}

function toolBtnStyle(tk: any): React.CSSProperties {
  return {
    padding: "4px 8px",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 4,
    color: tk.textSecondary,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
  };
}
