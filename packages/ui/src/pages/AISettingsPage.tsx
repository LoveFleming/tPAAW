/**
 * AISettingsPage — AI 設定
 *
 * Manage context files for each functional module (chat, skill-builder, app-builder, etc.).
 * API: /api/contexts/*
 */

import React, { useEffect, useState, useCallback } from "react";
import { useTheme } from "../theme";

const API_BASE = "http://127.0.0.1:4097";

interface ContextFile {
  name: string;
  path: string;
}

interface ContextCategory {
  id: string;
  files: ContextFile[];
}

const CATEGORY_DISPLAY: Record<string, { label: string; icon: string; desc: string }> = {
  chat: { label: "聊天助理", icon: "💬", desc: "語晴的角色設定、溝通風格、工具規則" },
  "skill-builder": { label: "Skill Builder", icon: "⚡", desc: "Skill 建立規範、SKILL.md 格式" },
  "app-builder": { label: "App Builder", icon: "🏗", desc: "App 定義規範、資料結構規則" },
  "vibe-coding": { label: "Vibe Coding", icon: "🖥", desc: "開發流程、Git 操作、Review 標準" },
  workflow: { label: "Workflow", icon: "🔄", desc: "Workflow 執行規則" },
};

function fileNameToLabel(name: string): string {
  const base = name.replace(/\.md$/, "");
  return base
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function fileNameToIcon(name: string): string {
  const map: Record<string, string> = {
    "identity.md": "🤖",
    "system-prompt.md": "📋",
    "reply-rules.md": "💬",
    "tool-rules.md": "🔧",
    "guardrails.md": "🛡️",
    "skill-format.md": "📐",
    "builder-rules.md": "📏",
    "app-rules.md": "📋",
    "workflow.md": "📝",
    "workflow-rules.md": "📝",
    "git-rules.md": "🔀",
    "review-standards.md": "📊",
  };
  return map[name] || "📄";
}

export default function AISettingsPage() {
  const { info: t } = useTheme();
  const [categories, setCategories] = useState<ContextCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/contexts`);
      if (res.ok) {
        const data: ContextCategory[] = await res.json();
        setCategories(data);
        if (data.length > 0 && !selectedCategory) {
          setSelectedCategory(data[0].id);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCategories(); }, []);

  const loadFileContent = useCallback(async (catId: string, fileName: string) => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE}/api/contexts/${catId}/${fileName}`);
      if (res.ok) {
        const data = await res.json();
        setEditContent(data.content || "");
        setOriginalContent(data.content || "");
        setSaved(false);
      } else {
        const data = await res.json();
        setEditContent("");
        setOriginalContent("");
        setError(data.error || "Failed to load");
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const selectCategory = useCallback((catId: string) => {
    setSelectedCategory(catId);
    setSelectedFile(null);
    setEditContent("");
    setOriginalContent("");
    setSaved(false);
    setError(null);
  }, []);

  const selectFile = useCallback((catId: string, fileName: string) => {
    setSelectedFile(fileName);
    loadFileContent(catId, fileName);
  }, [loadFileContent]);

  const save = useCallback(async () => {
    if (!selectedCategory || !selectedFile) return;
    if (editContent === originalContent) { setSaved(true); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contexts/${selectedCategory}/${selectedFile}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        setSaved(true);
        setOriginalContent(editContent);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const data = await res.json();
        setError(data.error || "Save failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [selectedCategory, selectedFile, editContent, originalContent]);

  const currentCategory = categories.find(c => c.id === selectedCategory);
  const catInfo = selectedCategory ? CATEGORY_DISPLAY[selectedCategory] : null;

  return (
    <div className="flex h-full w-full" style={{ backgroundColor: "#fafaf9" }}>
      {/* ── Left: Category Sidebar ── */}
      <div className="w-52 shrink-0 border-r border-stone-200 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-stone-200">
          <h2 className="text-sm font-bold text-stone-700">AI 設定</h2>
          <p className="text-[10px] text-stone-400 mt-0.5">依功能模組分類</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {categories.map(cat => {
            const info = CATEGORY_DISPLAY[cat.id] || { label: cat.id, icon: "📁", desc: "" };
            const active = cat.id === selectedCategory;
            return (
              <button
                key={cat.id}
                onClick={() => selectCategory(cat.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                  active
                    ? "bg-violet-100 text-violet-800"
                    : "hover:bg-stone-50 text-stone-600"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{info.icon}</span>
                  <div className="min-w-0">
                    <div className={`text-sm font-medium truncate ${active ? "text-violet-800" : "text-stone-700"}`}>
                      {info.label}
                    </div>
                    <div className="text-[10px] text-stone-400 truncate mt-0.5">{info.desc}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Middle: File List ── */}
      <div className="w-56 shrink-0 border-r border-stone-200 bg-stone-50 flex flex-col">
        <div className="px-4 py-3 border-b border-stone-200 bg-white">
          <h3 className="text-xs font-semibold text-stone-600">
            {catInfo ? `${catInfo.icon} ${catInfo.label}` : "選擇分類"}
          </h3>
        </div>
        {selectedCategory ? (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {currentCategory?.files.map(f => {
              const active = f.name === selectedFile;
              return (
                <button
                  key={f.name}
                  onClick={() => selectFile(selectedCategory, f.name)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors text-sm ${
                    active
                      ? "bg-white shadow-sm border border-stone-200 text-stone-800 font-semibold"
                      : "text-stone-600 hover:bg-white/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{fileNameToIcon(f.name)}</span>
                    <div className="min-w-0">
                      <div className="truncate text-xs">{fileNameToLabel(f.name)}</div>
                      <div className="text-[10px] text-stone-400 truncate">{f.name}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-stone-400">請選擇左側分類</p>
          </div>
        )}
      </div>

      {/* ── Right: Editor ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedFile && selectedCategory ? (
          <>
            {/* Editor Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <span>{fileNameToIcon(selectedFile)}</span>
                <span className="text-sm font-semibold text-stone-700">{fileNameToLabel(selectedFile)}</span>
                <span className="text-[10px] text-stone-400 font-mono">{selectedCategory}/{selectedFile}</span>
                {editContent !== originalContent && (
                  <span className="text-[10px] text-amber-600 font-medium ml-1">已修改</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {saved && editContent === originalContent && (
                  <span className="text-[10px] text-emerald-600 font-medium">✓ 已儲存</span>
                )}
                <button
                  onClick={save}
                  disabled={saving || editContent === originalContent}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    saving || editContent === originalContent
                      ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                      : "text-white hover:opacity-90"
                  }`}
                  style={saving || editContent === originalContent ? undefined : { backgroundColor: t.accent }}
                >
                  {saving ? "儲存中..." : "儲存"}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="px-4 py-2 bg-red-50 border-b border-red-200">
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            {/* Editor */}
            <div className="flex-1 overflow-hidden">
              <textarea
                value={editContent}
                onChange={e => { setEditContent(e.target.value); setSaved(false); }}
                className="w-full h-full px-4 py-3 text-sm font-mono bg-white border-0 resize-none focus:outline-none"
                style={{ lineHeight: 1.6, tabSize: 2 }}
                spellCheck={false}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-3">⚙️</div>
              <div className="text-stone-500 font-semibold mb-1">AI 設定</div>
              <p className="text-xs text-stone-400 max-w-xs">
                左側選擇功能模組，中間選擇要編輯的設定檔。<br />
                修改後按「儲存」立即生效。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}