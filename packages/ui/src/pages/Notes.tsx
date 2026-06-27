/**
 * PAAW Notes — 筆記應用
 *
 * 整合各家筆記軟體優點：
 * - OneNote: Notebook 組織、圖片貼上
 * - Notion: 簡潔 UI、block-based content
 * - Obsidian: 全文搜尋、標籤系統
 * - Apple Notes: 快速建立、釘選
 *
 * 功能：
 * - Notebook 側欄 + 筆記列表 + 編輯器三欄佈局
 * - Rich text editor（contenteditable + toolbar）
 * - 圖片貼上（clipboard → upload → insert）
 * - 全文搜尋 + 標籤篩選
 * - 釘選、自動儲存
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTheme } from "../theme";

// ── Types ──

interface Notebook {
  id: string;
  name: string;
  color: string;
  icon: string;
  createdAt: string;
}

interface NoteMeta {
  id: string;
  notebookId: string;
  notebookName?: string;
  title: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  excerpt: string;
  coverImage: string | null;
}

interface Note extends NoteMeta {
  content: string;
}

// ── Main Component ──

export default function Notes() {
  const { info: themeInfo } = useTheme();

  const tk = {
    bg: "#fff",
    bgMuted: "#fafafa",
    bgHover: themeInfo.accentLight || "#f5f5f4",
    border: themeInfo.accentBorder || "#e5e5e5",
    borderLight: "#f0f0f0",
    borderInput: "#e0e0e0",
    textMuted: "#9ca3af",
    textPrimary: "#374151",
    textSecondary: "#6b7280",
    accent: themeInfo.accent,
    accentBg: themeInfo.accentBg,
    accentText: themeInfo.accentText,
    accentHover: themeInfo.accentHover,
    accentLight: themeInfo.accentLight,
  };

  // State
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebook, setActiveNotebook] = useState<string>("default");
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteMeta[] | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState("");

  // Editor
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [showTagEditor, setShowTagEditor] = useState(false);

  // ── Load notebooks ──
  const loadNotebooks = useCallback(async () => {
    const resp = await fetch("/api/notes/notebooks");
    const data = await resp.json();
    setNotebooks(data.notebooks || []);
  }, []);

  // ── Load notes in notebook ──
  const loadNotes = useCallback(async (notebookId: string) => {
    const resp = await fetch(`/api/notes/list?notebook=${encodeURIComponent(notebookId)}`);
    const data = await resp.json();
    setNotes(data.notes || []);
  }, []);

  // ── Load note content ──
  const loadNote = useCallback(async (noteId: string, notebookId: string) => {
    const resp = await fetch(`/api/notes/get?id=${noteId}&notebook=${encodeURIComponent(notebookId)}`);
    const data = await resp.json();
    if (data.note) {
      setActiveNote(data.note);
      setTagsInput((data.note.tags || []).join(", "));
      // 等 React 渲染後設定 editor 內容
      setTimeout(() => {
        if (editorRef.current) editorRef.current.innerHTML = data.note.content || "";
      }, 50);
    }
  }, []);

  // ── Auto-save ──
  const saveNote = useCallback(async () => {
    if (!activeNote) return;
    const content = editorRef.current?.innerHTML || "";
    const title = titleRef.current?.value || activeNote.title;

    await fetch(`/api/notes/update?id=${activeNote.id}&notebook=${encodeURIComponent(activeNote.notebookId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content,
        tags: activeNote.tags,
      }),
    });

    // 更新列表中的 excerpt
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
    const now = new Date().toISOString();
    const resp = await fetch("/api/notes/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notebookId: activeNotebook, title: "新筆記", content: "" }),
    });
    const data = await resp.json();
    if (data.ok) {
      await loadNotes(activeNotebook);
      await loadNote(data.note.id, activeNotebook);
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [activeNotebook, loadNotes, loadNote]);

  // ── Delete note ──
  const deleteNote = useCallback(async (noteId: string, notebookId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("確定刪除這則筆記？")) return;
    await fetch(`/api/notes/delete?id=${noteId}&notebook=${encodeURIComponent(notebookId)}`, { method: "DELETE" });
    if (activeNote?.id === noteId) setActiveNote(null);
    await loadNotes(activeNotebook);
  }, [activeNote, activeNotebook, loadNotes]);

  // ── Pin note ──
  const togglePin = useCallback(async (noteId: string, notebookId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/notes/pin?id=${noteId}&notebook=${encodeURIComponent(notebookId)}`, { method: "PUT" });
    await loadNotes(activeNotebook);
  }, [activeNotebook, loadNotes]);

  // ── Search ──
  const doSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults(null); return; }
    const resp = await fetch(`/api/notes/search?q=${encodeURIComponent(q)}`);
    const data = await resp.json();
    setSearchResults(data.results || []);
  }, []);

  // ── Tags ──
  const loadTags = useCallback(async () => {
    const resp = await fetch("/api/notes/tags");
    const data = await resp.json();
    setAllTags((data.tags || []).map((t: any) => t.name));
  }, []);

  const filterByTag = useCallback(async (tag: string) => {
    if (activeTag === tag) { setActiveTag(null); await loadNotes(activeNotebook); return; }
    setActiveTag(tag);
    const resp = await fetch(`/api/notes/by-tag?tag=${encodeURIComponent(tag)}`);
    const data = await resp.json();
    setSearchResults(data.results || []);
  }, [activeTag, activeNotebook, loadNotes]);

  const updateTags = useCallback(() => {
    if (!activeNote) return;
    const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean);
    setActiveNote(prev => prev ? { ...prev, tags } : null);
    scheduleSave();
  }, [activeNote, tagsInput, scheduleSave]);

  // ── Image paste ──
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          const resp = await fetch("/api/notes/upload-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: base64, filename: `paste.png` }),
          });
          const data = await resp.json();
          if (data.ok) {
            document.execCommand("insertHTML", false, `<img src="${data.url}" style="max-width:100%;border-radius:8px;margin:8px 0;" />`);
            scheduleSave();
          }
        };
        reader.readAsDataURL(file);
      }
    }
  }, [scheduleSave]);

  // ── Create notebook ──
  const createNotebook = useCallback(async () => {
    if (!newNotebookName.trim()) return;
    const resp = await fetch("/api/notes/notebooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newNotebookName }),
    });
    const data = await resp.json();
    if (data.ok) {
      setNewNotebookName("");
      setShowNewNotebook(false);
      await loadNotebooks();
    }
  }, [newNotebookName, loadNotebooks]);

  // ── Editor toolbar ──
  const exec = useCallback((cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    scheduleSave();
  }, [scheduleSave]);

  // ── Init ──
  useEffect(() => {
    loadNotebooks().then(() => loadNotes("default"));
    loadTags();
  }, []);

  useEffect(() => {
    if (activeNotebook && !searchQuery && !activeTag) loadNotes(activeNotebook);
  }, [activeNotebook]);

  const displayNotes = searchResults || notes;

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  return (
    <div className="h-full flex w-full overflow-hidden" style={{ backgroundColor: tk.bgHover }}>
      {/* ══ 左欄：Notebook 側欄 ══ */}
      <div className="shrink-0 flex flex-col border-r" style={{ width: 200, background: tk.bg, borderColor: tk.borderLight }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b shrink-0" style={{ borderColor: tk.borderLight }}>
          <span className="text-sm font-bold" style={{ color: tk.textPrimary }}>📚 筆記本</span>
          <button onClick={() => setShowNewNotebook(!showNewNotebook)} className="text-xs px-1.5 rounded hover:bg-black/5" style={{ color: tk.textMuted }}>+</button>
        </div>

        {/* New notebook input */}
        {showNewNotebook && (
          <div className="px-3 py-2 border-b" style={{ borderColor: tk.borderLight }}>
            <input
              value={newNotebookName}
              onChange={e => setNewNotebookName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") createNotebook(); }}
              placeholder="筆記本名稱..."
              className="w-full text-xs px-2 py-1 rounded border outline-none"
              style={{ background: tk.bgMuted, borderColor: tk.borderInput, color: tk.textPrimary }}
              autoFocus
            />
          </div>
        )}

        {/* Notebook list */}
        <div className="flex-1 overflow-auto py-1">
          {notebooks.map(nb => (
            <div
              key={nb.id}
              onClick={() => { setActiveNotebook(nb.id); setActiveTag(null); setSearchQuery(""); setSearchResults(null); }}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm transition-colors"
              style={{
                background: activeNotebook === nb.id ? tk.accentBg : "transparent",
                color: activeNotebook === nb.id ? tk.accentText : tk.textSecondary,
                fontWeight: activeNotebook === nb.id ? 600 : 400,
              }}
              onMouseEnter={e => { if (activeNotebook !== nb.id) e.currentTarget.style.background = tk.bgHover; }}
              onMouseLeave={e => { if (activeNotebook !== nb.id) e.currentTarget.style.background = "transparent"; }}
            >
              <span>{nb.icon || "📓"}</span>
              <span className="truncate flex-1">{nb.name}</span>
            </div>
          ))}
        </div>

        {/* Tags section */}
        {allTags.length > 0 && (
          <div className="border-t py-2" style={{ borderColor: tk.borderLight }}>
            <div className="px-3 py-1 text-xs font-semibold" style={{ color: tk.textMuted }}>標籤</div>
            <div className="px-2 flex flex-wrap gap-1">
              {allTags.slice(0, 12).map(tag => (
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

      {/* ══ 中欄：筆記列表 ══ */}
      <div className="shrink-0 flex flex-col border-r" style={{ width: 280, background: tk.bg, borderColor: tk.borderLight }}>
        {/* Search bar */}
        <div className="px-3 py-2.5 border-b" style={{ borderColor: tk.borderLight }}>
          <div className="flex items-center gap-2">
            <input
              value={searchQuery}
              onChange={e => doSearch(e.target.value)}
              placeholder="🔍 搜尋筆記..."
              className="flex-1 text-sm px-3 py-1.5 rounded-lg border outline-none"
              style={{ background: tk.bgMuted, borderColor: tk.borderInput, color: tk.textPrimary }}
            />
            <button
              onClick={createNote}
              className="text-xs px-2.5 py-1.5 rounded-lg font-medium shrink-0 text-white"
              style={{ background: tk.accent }}
            >+ 新增</button>
          </div>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-auto">
          {displayNotes.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: tk.textMuted }}>
              {searchQuery || activeTag ? "沒有符合的筆記" : "點「+ 新增」建立第一則筆記"}
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
                    <div className="text-xs mt-1 line-clamp-2" style={{ color: tk.textMuted }}>{note.excerpt || "（空白筆記）"}</div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {note.tags?.slice(0, 3).map(t => (
                        <span key={t} className="text-xs px-1.5 rounded" style={{ background: tk.accentBg, color: tk.accentText }}>#{t}</span>
                      ))}
                      <span className="text-xs ml-auto" style={{ color: tk.textMuted }}>
                        {note.updatedAt ? new Date(note.updatedAt).toLocaleDateString("zh-TW", { month: "short", day: "numeric" }) : ""}
                      </span>
                    </div>
                  </div>
                  {/* Hover actions */}
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={e => togglePin(note.id, note.notebookId, e)} className="text-xs hover:bg-black/10 rounded p-1" style={{ color: tk.textMuted }} title="釘選">
                      {note.pinned ? "📌" : "📍"}
                    </button>
                    <button onClick={e => deleteNote(note.id, note.notebookId, e)} className="text-xs hover:bg-red-50 rounded p-1" style={{ color: "#ef4444" }} title="刪除">🗑</button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ══ 右欄：編輯器 ══ */}
      <div className="flex-1 flex flex-col" style={{ background: tk.bg }}>
        {!activeNote ? (
          /* Empty state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-6xl mb-4">📝</div>
              <div className="text-lg" style={{ color: tk.textSecondary }}>選擇一則筆記或建立新筆記</div>
              <button onClick={createNote} className="mt-4 px-6 py-2.5 rounded-lg text-white font-medium" style={{ background: tk.accent }}>
                ＋ 新建筆記
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Editor toolbar */}
            <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0 flex-wrap" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
              <button onClick={() => exec("bold")} className="toolBtn" style={toolBtnStyle(tk)}><b>B</b></button>
              <button onClick={() => exec("italic")} className="toolBtn" style={toolBtnStyle(tk)}><i>I</i></button>
              <button onClick={() => exec("underline")} className="toolBtn" style={toolBtnStyle(tk)}><u>U</u></button>
              <div className="w-px h-5" style={{ background: tk.border }} />
              <button onClick={() => exec("formatBlock", "<h2>")} className="toolBtn" style={toolBtnStyle(tk)}>H2</button>
              <button onClick={() => exec("formatBlock", "<h3>")} className="toolBtn" style={toolBtnStyle(tk)}>H3</button>
              <button onClick={() => exec("formatBlock", "<p>")} className="toolBtn" style={toolBtnStyle(tk)}>P</button>
              <div className="w-px h-5" style={{ background: tk.border }} />
              <button onClick={() => exec("insertUnorderedList")} className="toolBtn" style={toolBtnStyle(tk)}>• 清單</button>
              <button onClick={() => exec("insertOrderedList")} className="toolBtn" style={toolBtnStyle(tk)}>1. 清單</button>
              <button onClick={() => exec("formatBlock", "<blockquote>")} className="toolBtn" style={toolBtnStyle(tk)}>❝</button>
              <button onClick={() => exec("formatBlock", "<pre>")} className="toolBtn" style={toolBtnStyle(tk)}>{"</>"}</button>
              <div className="w-px h-5" style={{ background: tk.border }} />
              <label className="toolBtn cursor-pointer" style={toolBtnStyle(tk)}>
                🖼 圖片
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = async () => {
                      const resp = await fetch("/api/notes/upload-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ data: reader.result, filename: file.name }),
                      });
                      const data = await resp.json();
                      if (data.ok) {
                        document.execCommand("insertHTML", false, `<img src="${data.url}" style="max-width:100%;border-radius:8px;margin:8px 0;" />`);
                        scheduleSave();
                      }
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <div className="flex-1" />
              {/* Tag editor toggle */}
              <button onClick={() => setShowTagEditor(!showTagEditor)} className="toolBtn" style={toolBtnStyle(tk)}>🏷</button>
            </div>

            {/* Tag editor row */}
            {showTagEditor && (
              <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                <span className="text-xs" style={{ color: tk.textMuted }}>標籤：</span>
                <input
                  value={tagsInput}
                  onChange={e => setTagsInput(e.target.value)}
                  onBlur={updateTags}
                  onKeyDown={e => { if (e.key === "Enter") { updateTags(); setShowTagEditor(false); } }}
                  placeholder="用逗號分隔，例如：工作, 重要, Idea"
                  className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                  style={{ background: tk.bg, borderColor: tk.borderInput, color: tk.textPrimary }}
                />
              </div>
            )}

            {/* Title */}
            <div className="px-8 pt-6 pb-2">
              <input
                ref={titleRef}
                defaultValue={activeNote.title}
                onChange={scheduleSave}
                className="w-full text-2xl font-bold outline-none border-none bg-transparent"
                style={{ color: tk.textPrimary }}
                placeholder="筆記標題..."
              />
            </div>

            {/* Meta info */}
            <div className="px-8 pb-2 flex items-center gap-3 text-xs" style={{ color: tk.textMuted }}>
              <span>{new Date(activeNote.updatedAt).toLocaleString("zh-TW")}</span>
              {activeNote.tags.length > 0 && (
                <span className="flex gap-1">
                  {activeNote.tags.map(t => (
                    <span key={t} className="px-1.5 rounded" style={{ background: tk.accentBg, color: tk.accentText }}>#{t}</span>
                  ))}
                </span>
              )}
            </div>

            {/* Editor area */}
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
                data-placeholder="開始輸入... 支援 Ctrl+B/I/U 格式，可直接貼上圖片"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Toolbar button style ──

function toolBtnStyle(tk: any): React.CSSProperties {
  return {
    padding: "4px 8px",
    background: "transparent",
    border: `1px solid transparent`,
    borderRadius: 4,
    color: tk.textSecondary,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };
}
