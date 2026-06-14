/**
 * AISettingsPage — AI Settings Management (by category)
 *
 * Categories: chat, skill-builder, app-builder
 * API: /api/ai-settings/:category/:file
 */

import React, { useEffect, useState, useCallback } from "react";
import { useTheme } from "../theme";

const API_BASE = "http://127.0.0.1:4097";

interface Category {
  id: string;
  label: string;
  icon: string;
  desc: string;
  files: { file: string; icon: string; label: string; desc: string }[];
}

export default function AISettingsPage() {
  const { info: t } = useTheme();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [files, setFiles] = useState<Record<string, string | null>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load category list
  useEffect(() => {
    fetch(`${API_BASE}/api/ai-settings`)
      .then(r => r.json())
      .then(data => {
        if (data.categories) {
          setCategories(data.categories);
          setActiveCategory(data.categories[0]?.id || "");
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Load files when category changes
  const loadCategory = useCallback(async (categoryId: string) => {
    if (!categoryId) return;
    try {
      const res = await fetch(`${API_BASE}/api/ai-settings/${categoryId}`);
      if (!res.ok) return;
      const data = await res.json();
      const fileMap: Record<string, string | null> = {};
      for (const f of data.files || []) {
        fileMap[f.file] = f.exists ? f.content : null;
      }
      setFiles(fileMap);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (activeCategory) {
      loadCategory(activeCategory);
      setEditing(null);
      setError(null);
    }
  }, [activeCategory, loadCategory]);

  const startEdit = (file: string) => {
    setEditing(file);
    setEditContent(files[file] || "");
    setSaved(false);
    setError(null);
  };

  const save = async () => {
    if (!editing || !activeCategory) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai-settings/${activeCategory}/${editing}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        setFiles(prev => ({ ...prev, [editing!]: editContent }));
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else {
        const data = await res.json();
        setError(data.error || "Save failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditContent("");
    setError(null);
  };

  // ── Styles ──
  const cardBg = "#ffffff";
  const cardBorder = "#e7e5e4";
  const activeBorder = t.accent;
  const muted = "#8a8580";
  const mono = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";

  if (loading) {
    return (
      <div className="h-full w-full flex-1 min-h-0 flex items-center justify-center" style={{ backgroundColor: t.accentBg }}>
        <span style={{ color: muted }}>Loading...</span>
      </div>
    );
  }

  const activeCat = categories.find(c => c.id === activeCategory);

  return (
    <div className="h-full w-full flex-1 min-h-0 overflow-y-auto" style={{ backgroundColor: t.accentBg }}>
      <div className="px-6 py-5 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "#1c1917" }}>
              ⚙️ AI 設定
            </h2>
            <p className="text-xs mt-0.5" style={{ color: muted }}>
              管理各模組的 AI 設定。修改後即時生效，不需重啟。
            </p>
          </div>
          {activeCategory && (
            <button
              onClick={() => loadCategory(activeCategory)}
              className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
              style={{ borderColor: cardBorder, color: muted }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.color = t.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = cardBorder; e.currentTarget.style.color = muted; }}
            >
              ↻ Refresh
            </button>
          )}
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
              style={activeCategory === cat.id
                ? { background: t.accent, color: "#fff", boxShadow: `0 2px 8px ${t.accent}30` }
                : { background: cardBg, color: "#57534e", border: `1px solid ${cardBorder}` }
              }
            >
              <span className="mr-1.5">{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Category description */}
        {activeCat && (
          <p className="text-xs mb-4" style={{ color: muted }}>
            {activeCat.desc}
          </p>
        )}

        {/* File Cards */}
        <div className="flex flex-col gap-3">
          {activeCat?.files.map(({ file, icon, label, desc }) => {
            const content = files[file];
            const isEditing = editing === file;
            const lineCount = content ? content.split("\n").length : 0;
            const charCount = content ? content.length : 0;

            return (
              <div
                key={file}
                className="rounded-xl overflow-hidden transition-all"
                style={{
                  background: cardBg,
                  border: `1.5px solid ${isEditing ? activeBorder : cardBorder}`,
                  boxShadow: isEditing ? `0 0 0 3px ${t.accent}15` : "none",
                }}
              >
                {/* Card Header */}
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${cardBorder}` }}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-base">{icon}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate" style={{ color: "#1c1917" }}>
                        {label}
                      </div>
                      <div className="text-[11px]" style={{ color: muted }}>
                        {desc}
                        {content && (
                          <span className="ml-1.5 opacity-60">· {lineCount} lines · {charCount} chars</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {!isEditing ? (
                    <button
                      onClick={() => startEdit(file)}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-all font-medium"
                      style={{ borderColor: cardBorder, color: t.accent }}
                      onMouseEnter={e => { e.currentTarget.style.background = t.accent; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = t.accent; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ""; e.currentTarget.style.color = t.accent; e.currentTarget.style.borderColor = cardBorder; }}
                    >
                      Edit
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={cancelEdit}
                        className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                        style={{ borderColor: cardBorder, color: muted }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={save}
                        disabled={saving}
                        className="text-xs px-4 py-1.5 rounded-lg text-white font-medium transition-all disabled:opacity-50"
                        style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accentHover})` }}
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                      {saved && <span className="text-xs font-medium" style={{ color: "#16a34a" }}>✓ Saved</span>}
                      {error && <span className="text-xs" style={{ color: "#dc2626" }}>{error}</span>}
                    </div>
                  )}
                </div>

                {/* Editor */}
                {isEditing && (
                  <div className="p-3">
                    <textarea
                      value={editContent}
                      onChange={e => { setEditContent(e.target.value); setSaved(false); }}
                      placeholder={`Enter content for ${file}...`}
                      className="w-full rounded-lg p-3 text-[13px] leading-relaxed resize-y focus:outline-none focus:ring-2"
                      style={{
                        minHeight: 320,
                        background: "#fafaf9",
                        border: `1px solid ${cardBorder}`,
                        fontFamily: mono,
                        color: "#1c1917",
                        "--tw-ring-color": t.accent + "40",
                      } as React.CSSProperties}
                      onFocus={e => { e.currentTarget.style.borderColor = t.accent; }}
                      onBlur={e => { e.currentTarget.style.borderColor = cardBorder; }}
                    />
                  </div>
                )}

                {/* Preview (collapsed) */}
                {!isEditing && content && (
                  <div
                    className="px-4 py-2.5 text-[12px] leading-relaxed max-h-[72px] overflow-hidden"
                    style={{ color: muted, fontFamily: mono, whiteSpace: "pre-wrap" }}
                  >
                    {content.slice(0, 250)}{content.length > 250 ? "..." : ""}
                  </div>
                )}

                {!isEditing && !content && (
                  <div className="px-4 py-3 text-[12px] italic" style={{ color: muted + "80" }}>
                    Not created yet — click Edit to add content.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
