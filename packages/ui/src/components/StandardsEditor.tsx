/**
 * StandardsEditor — Edit .paaw/standards/ files
 *
 * Features:
 * - List all standard files
 * - Click to edit inline
 * - Import from templates
 * - AI-generate from codebase
 * - Create new / delete
 */
import React, { useEffect, useState, useCallback } from "react";
import API_BASE from "../api";

// ── Types ──

interface StandardFile {
  name: string;
  size: number;
  modified: string;
}

interface Template {
  name: string;
  title: string;
  preview: string;
}

interface StandardsEditorProps {
  projectRoot: string;
  refreshKey?: number;
}

// ── Component ──

export default function StandardsEditor({ projectRoot, refreshKey = 0 }: StandardsEditorProps) {
  const [files, setFiles] = useState<StandardFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [generating, setGenerating] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);

  // ── Load file list ──
  const loadFiles = useCallback(async () => {
    if (!projectRoot) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/project/standards?path=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      }
    } catch {}
    setLoading(false);
  }, [projectRoot]);

  useEffect(() => { loadFiles(); }, [loadFiles, refreshKey]);

  // ── Load file content ──
  const openFile = useCallback(async (name: string) => {
    setSelected(name);
    setDirty(false);
    try {
      const res = await fetch(`${API_BASE}/api/project/standards/${encodeURIComponent(name)}?path=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        const text = await res.text();
        setContent(text);
        setOriginalContent(text);
      }
    } catch {}
  }, [projectRoot]);

  // ── Save ──
  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/project/standards/${encodeURIComponent(selected)}?path=${encodeURIComponent(projectRoot)}`, {
        method: "PUT",
        body: content,
      });
      setOriginalContent(content);
      setDirty(false);
      await loadFiles();
    } catch {}
    setSaving(false);
  };

  // ── Load templates ──
  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/project/templates`);
      if (res.ok) {
        setTemplates(await res.json());
      }
    } catch {}
  }, []);

  // ── Import template ──
  const handleImport = async (templateName: string) => {
    try {
      await fetch(`${API_BASE}/api/project/import-template?path=${encodeURIComponent(projectRoot)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: templateName }),
      });
      await loadFiles();
      setShowTemplates(false);
    } catch {}
  };

  // ── AI Generate ──
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/project/generate-standards?path=${encodeURIComponent(projectRoot)}`, {
        method: "POST",
      });
      if (res.ok) {
        await loadFiles();
        // Open the generated file
        const generated = files.find(f => f.name === "auto-generated.md");
        if (!generated) {
          // File list might not have updated yet, open directly
          await openFile("auto-generated.md");
        }
      }
    } catch {}
    setGenerating(false);
  };

  // ── Create new file ──
  const handleCreate = async () => {
    let name = newFileName.trim();
    if (!name) return;
    if (!name.endsWith(".md")) name += ".md";
    try {
      await fetch(`${API_BASE}/api/project/standards/${encodeURIComponent(name)}?path=${encodeURIComponent(projectRoot)}`, {
        method: "PUT",
        body: `# ${name.replace(".md", "").replace(/[-_]/g, " ")}\n\n> Describe your coding standards here.\n`,
      });
      setNewFileName("");
      setShowNewFile(false);
      await loadFiles();
      await openFile(name);
    } catch {}
  };

  // ── Content change ──
  const onContentChange = (v: string) => {
    setContent(v);
    setDirty(v !== originalContent);
  };

  // ── Render ──

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-stone-200 bg-stone-50 text-xs">
        <span className="font-semibold text-stone-600">📏 Standards</span>
        <div className="flex-1" />
        <button
          onClick={() => { setShowTemplates(!showTemplates); if (!showTemplates) loadTemplates(); }}
          className="px-1.5 py-0.5 rounded text-[10px] text-blue-600 hover:bg-blue-50 font-medium"
          title="Import from templates"
        >
          📥 Import
        </button>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="px-1.5 py-0.5 rounded text-[10px] text-purple-600 hover:bg-purple-50 font-medium disabled:opacity-50"
          title="AI analyzes codebase and generates standards"
        >
          {generating ? "⏳ Generating..." : "🤖 Generate"}
        </button>
        <button
          onClick={() => setShowNewFile(!showNewFile)}
          className="px-1.5 py-0.5 rounded text-[10px] text-green-600 hover:bg-green-50 font-medium"
        >
          ➕ New
        </button>
        <button
          onClick={loadFiles}
          className="px-1 py-0.5 rounded text-[10px] text-stone-400 hover:text-stone-600"
        >
          ↻
        </button>
      </div>

      {/* New file input */}
      {showNewFile && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-green-50 border-b border-green-200">
          <input
            type="text"
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
            placeholder="file-name.md"
            className="flex-1 text-xs px-2 py-1 rounded border border-green-300 focus:border-green-500 outline-none bg-white"
            autoFocus
          />
          <button onClick={handleCreate} className="text-xs px-2 py-1 rounded bg-green-500 text-white hover:bg-green-600">
            Create
          </button>
          <button onClick={() => setShowNewFile(false)} className="text-xs px-1.5 py-1 text-stone-400">
            ✕
          </button>
        </div>
      )}

      {/* Templates panel */}
      {showTemplates && (
        <div className="border-b border-stone-200 bg-blue-50 max-h-48 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] text-blue-600 font-semibold">📋 Templates — click to import</div>
          {templates.length === 0 ? (
            <div className="px-2 py-1 text-[10px] text-stone-400">No templates found</div>
          ) : (
            templates.map(tpl => (
              <div
                key={tpl.name}
                onClick={() => handleImport(tpl.name)}
                className="px-2 py-1 cursor-pointer hover:bg-blue-100 text-xs border-b border-blue-100 last:border-0"
              >
                <div className="font-medium text-stone-700">{tpl.title}</div>
                <div className="text-[9px] text-stone-400 truncate">{tpl.preview.slice(0, 80)}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* File list + editor split */}
      <div className="flex flex-1 min-h-0">
        {/* File list */}
        <div className="w-32 border-r border-stone-200 overflow-y-auto bg-white" style={{ scrollbarWidth: "thin" }}>
          {loading && <div className="px-2 py-1 text-[10px] text-stone-400 animate-pulse">Loading...</div>}
          {files.map(f => (
            <div
              key={f.name}
              onClick={() => openFile(f.name)}
              className={`px-2 py-1 cursor-pointer text-[11px] truncate border-b border-stone-100 ${
                selected === f.name ? "bg-blue-50 text-blue-700 font-medium" : "text-stone-600 hover:bg-stone-50"
              }`}
              title={f.name}
            >
              📄 {f.name}
            </div>
          ))}
          {files.length === 0 && !loading && (
            <div className="px-2 py-2 text-[10px] text-stone-400">
              No standards yet.<br />Import or generate to start.
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <>
              <div className="flex items-center gap-2 px-2 py-1 border-b border-stone-200 bg-white">
                <span className="text-[11px] text-stone-500 truncate">standards/{selected}</span>
                {dirty && <span className="text-[9px] text-orange-500">● unsaved</span>}
                <div className="flex-1" />
                <button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className="text-[10px] px-2 py-0.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
                >
                  {saving ? "Saving..." : "💾 Save"}
                </button>
              </div>
              <textarea
                value={content}
                onChange={e => onContentChange(e.target.value)}
                className="flex-1 p-2 text-[11px] font-mono resize-none outline-none bg-white text-stone-800"
                style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", lineHeight: 1.5 }}
                spellCheck={false}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-stone-300 text-xs">
              <div className="text-center">
                <div className="text-2xl mb-2">📏</div>
                <div>Select a file or create new</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
