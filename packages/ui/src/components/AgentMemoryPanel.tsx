/**
 * AgentMemoryPanel — View and edit agent long-term memory files
 *
 * Sidebar shows all coding crew agents with their avatar, name, and title.
 * Agents without memory show "empty" badge. Click to view/edit memory.
 */
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface MemoryEntry {
  agentId: string;
  crewId: string | null;
  title: string;
  codename: string;
  imageUrl: string;
  description: string;
  hasMemory: boolean;
  size: number;
  preview: string;
  lines: number;
  updatedAt: string | null;
}

interface Props {
  rootPath: string;
  theme: {
    bg: string;
    bgMuted: string;
    borderLight: string;
    accent: string;
    accentBg: string;
    text: string;
  };
}

const AGENT_ICONS: Record<string, string> = {
  architect: "🏗️",
  developer: "💻",
  tester: "🧪",
  "doc-writer": "📝",
  qa: "🔍",
  helpdesk: "🛠️",
};

function agentFallbackIcon(agentId: string): string {
  return AGENT_ICONS[agentId] || "🤖";
}

export default function AgentMemoryPanel({ rootPath, theme }: Props) {
  const { t } = useI18n();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const basePath = `${API_BASE}/api/coding-memory?path=${encodeURIComponent(rootPath)}`;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(basePath);
      const data = await res.json();
      const mems = data.memories || [];
      setMemories(mems);
      // Auto-select first agent with memory, or first agent overall
      if (!selectedId && mems.length > 0) {
        const withMemory = mems.find(m => m.hasMemory);
        setSelectedId((withMemory || mems[0]).agentId);
      }
    } catch (err) {
      console.error("[AgentMemoryPanel] fetch list error:", err);
    }
    setLoading(false);
  }, [basePath]);

  const fetchContent = useCallback(async (agentId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-memory/${encodeURIComponent(agentId)}?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) {
        const data = await res.json();
        setContent(data.content || "");
        setOriginalContent(data.content || "");
      } else {
        setContent("");
        setOriginalContent("");
      }
    } catch (err) {
      console.error("[AgentMemoryPanel] fetch content error:", err);
      setContent("");
      setOriginalContent("");
    }
  }, [rootPath]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { if (selectedId) fetchContent(selectedId); }, [selectedId, fetchContent]);

  const modified = content !== originalContent;
  const selected = memories.find(m => m.agentId === selectedId);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/coding-memory/${encodeURIComponent(selectedId)}?path=${encodeURIComponent(rootPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setOriginalContent(content);
      await fetchList();
    } catch (err) {
      alert("Save failed: " + err.message);
    }
    setSaving(false);
  };

  const handleDelete = async (agentId: string) => {
    if (!confirm(`Delete memory for ${agentId}?`)) return;
    try {
      await fetch(`${API_BASE}/api/coding-memory/${encodeURIComponent(agentId)}?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" });
      if (selectedId === agentId) {
        setContent("");
        setOriginalContent("");
      }
      await fetchList();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  // ── Avatar ──
  function renderAvatar(mem: MemoryEntry, size: number) {
    if (mem.imageUrl) {
      const url = `${API_BASE}${mem.imageUrl}`;
      return (
        <img
          src={url}
          alt={mem.codename || mem.agentId}
          className="rounded-full object-cover shrink-0"
          style={{ width: size, height: size }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      );
    }
    return (
      <div
        className="rounded-full flex items-center justify-center shrink-0"
        style={{ width: size, height: size, background: theme.bgMuted, fontSize: size * 0.5 }}
      >
        {agentFallbackIcon(mem.agentId)}
      </div>
    );
  }

  const inputStyle = {
    background: theme.bg,
    color: theme.text,
    borderColor: theme.borderLight,
  } as React.CSSProperties;

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* === Left: Agent List === */}
      <div className="w-72 flex flex-col border-r shrink-0" style={{ borderColor: theme.borderLight }}>
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
          <span className="text-sm font-semibold" style={{ color: theme.text }}>
            🧠 {t("memory.title")}
          </span>
          <button
            onClick={() => { fetchList(); }}
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: theme.bg, color: theme.text, opacity: 0.5 }}
            title={t("memory.refresh") || "Refresh"}
          >
            🔄
          </button>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              {t("memory.loading")}
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center" style={{ color: theme.text, opacity: 0.4 }}>
              <div className="text-3xl">🧠</div>
              <div className="text-sm">{t("memory.empty")}</div>
            </div>
          ) : (
            memories.map(mem => {
              const isSelected = mem.agentId === selectedId;
              return (
                <div
                  key={mem.agentId}
                  onClick={() => setSelectedId(mem.agentId)}
                  className="px-3 py-2.5 cursor-pointer border-b transition-colors flex items-center gap-3"
                  style={{
                    borderColor: theme.borderLight,
                    background: isSelected ? theme.accentBg : "transparent",
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Avatar */}
                  {renderAvatar(mem, 40)}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate" style={{ color: theme.text }}>
                        {mem.codename || mem.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text, opacity: 0.6 }}>
                        {mem.title}
                      </span>
                      {mem.hasMemory ? (
                        <span className="text-[10px]" style={{ color: theme.text, opacity: 0.4 }}>
                          {mem.lines} lines
                        </span>
                      ) : (
                        <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: "#f5f5f4", color: "#a8a29e" }}>
                          {t("memory.noMemory") || "no memory"}
                        </span>
                      )}
                    </div>
                    {mem.hasMemory && mem.preview && (
                      <div className="text-[10px] truncate mt-0.5" style={{ color: theme.text, opacity: 0.3 }}>
                        {mem.preview.replace(/[#*\n]/g, " ").trim().slice(0, 60)}
                      </div>
                    )}
                  </div>

                  {/* Delete */}
                  {mem.hasMemory && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(mem.agentId); }}
                      className="text-xs opacity-20 hover:opacity-100 shrink-0"
                      style={{ color: "#dc2626" }}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* === Right: Editor === */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedId || !selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">🤖</div>
            <div className="text-sm">{t("memory.selectPrompt")}</div>
          </div>
        ) : (
          <>
            {/* Agent header with avatar */}
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
              {renderAvatar(selected, 36)}
              <div className="flex-1">
                <div className="text-sm font-semibold" style={{ color: theme.text }}>
                  {selected.codename || selected.title}
                </div>
                <div className="text-xs" style={{ color: theme.text, opacity: 0.5 }}>
                  {selected.title} · {selected.agentId}
                </div>
              </div>
              {modified && (
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "#fffbeb", color: "#d97706" }}>
                  {t("memory.unsaved")}
                </span>
              )}
            </div>

            {/* Action bar */}
            <div className="flex items-center justify-end gap-2 px-4 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
              <button
                onClick={() => { setContent(originalContent); }}
                disabled={!modified}
                className="text-xs px-2 py-1 rounded disabled:opacity-30"
                style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.borderLight}` }}
              >
                {t("memory.revert")}
              </button>
              <button
                onClick={handleSave}
                disabled={!modified || saving}
                className="text-xs px-3 py-1 rounded font-medium disabled:opacity-30"
                style={{ background: theme.accentBg, color: theme.accent }}
              >
                {saving ? "..." : `💾 ${t("memory.save")}`}
              </button>
            </div>

            {/* Editor or empty state */}
            {selected.hasMemory || content ? (
              <>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (modified) handleSave(); }
                  }}
                  className="flex-1 w-full p-4 font-mono text-sm outline-none resize-none border-0"
                  style={{ background: theme.bg, color: theme.text }}
                  placeholder={t("memory.editorPlaceholder")}
                  spellCheck={false}
                />
                <div className="px-4 py-1.5 text-[10px]" style={{ borderTop: `1px solid ${theme.borderLight}`, color: theme.text, opacity: 0.3 }}>
                  💡 {t("memory.hint")} · ⌘S = {t("memory.save")}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8" style={{ color: theme.text, opacity: 0.5 }}>
                <div className="text-4xl">{agentFallbackIcon(selected.agentId)}</div>
                <div className="text-sm text-center">
                  {selected.codename || selected.title} {t("memory.noMemoryYet") || "has no memory yet"}
                </div>
                <div className="text-xs text-center" style={{ opacity: 0.7 }}>
                  {t("memory.emptyHint")}
                </div>
                <button
                  onClick={() => {
                    const template = `# ${selected.codename || selected.agentId} Memory\n\n## Lessons Learned\n\n## Project Conventions\n\n## User Preferences\n\n## Mistakes to Avoid\n`;
                    setContent(template);
                  }}
                  className="text-xs px-3 py-1.5 rounded font-medium mt-2"
                  style={{ background: theme.accentBg, color: theme.accent }}
                >
                  + {t("memory.createTemplate") || "Create Memory Template"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
