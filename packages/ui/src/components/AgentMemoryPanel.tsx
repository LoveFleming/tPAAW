/**
 * AgentMemoryPanel — View and edit agent long-term memory files
 *
 * Shows .paaw/AGENT-MEMORY/{agentId}.md files in a sidebar list + editor layout.
 * Agents can save memories via agent_memory_save tool; this panel lets the user
 * directly view and edit those memories.
 */
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface MemoryFile {
  agentId: string;
  filename: string;
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

function agentIcon(agentId: string): string {
  return AGENT_ICONS[agentId] || "🤖";
}

export default function AgentMemoryPanel({ rootPath, theme }: Props) {
  const { t } = useI18n();
  const [memories, setMemories] = useState<MemoryFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentId, setNewAgentId] = useState("");

  const basePath = `${API_BASE}/api/coding-memory?path=${encodeURIComponent(rootPath)}`;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(basePath);
      const data = await res.json();
      const mems = data.memories || [];
      setMemories(mems);
      // Auto-select first if nothing selected
      if (!selectedId && mems.length > 0) {
        setSelectedId(mems[0].agentId);
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
        setSelectedId(null);
        setContent("");
        setOriginalContent("");
      }
      await fetchList();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  const handleCreate = async () => {
    const id = newAgentId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    if (!id) return;
    try {
      await fetch(`${API_BASE}/api/coding-memory/${encodeURIComponent(id)}?path=${encodeURIComponent(rootPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `# ${id} Memory\n\n## Lessons Learned\n\n## Project Conventions\n\n## User Preferences\n` }),
      });
      setNewAgentId("");
      setCreatingAgent(false);
      await fetchList();
      setSelectedId(id);
    } catch (err) {
      alert("Create failed: " + err.message);
    }
  };

  const inputStyle = {
    background: theme.bg,
    color: theme.text,
    borderColor: theme.borderLight,
  } as React.CSSProperties;

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* === Left: Agent List === */}
      <div className="w-64 flex flex-col border-r shrink-0" style={{ borderColor: theme.borderLight }}>
        {/* Header */}
        <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
          <span className="text-xs font-semibold uppercase" style={{ color: theme.text, opacity: 0.6 }}>
            🧠 {t("memory.title")}
          </span>
          <button
            onClick={() => setCreatingAgent(!creatingAgent)}
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: theme.accentBg, color: theme.accent }}
            title={t("memory.newAgent")}
          >
            + {t("memory.new")}
          </button>
        </div>

        {/* New agent input */}
        {creatingAgent && (
          <div className="px-3 py-2 flex gap-1" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
            <input
              type="text"
              value={newAgentId}
              onChange={e => setNewAgentId(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreatingAgent(false); }}
              placeholder="agent-id..."
              className="flex-1 text-xs px-2 py-1 rounded border outline-none"
              style={inputStyle}
              autoFocus
            />
            <button onClick={handleCreate} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>✓</button>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              {t("memory.loading")}
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center" style={{ color: theme.text, opacity: 0.4 }}>
              <div className="text-3xl">🧠</div>
              <div className="text-sm">{t("memory.empty")}</div>
              <div className="text-xs">{t("memory.emptyHint")}</div>
            </div>
          ) : (
            memories.map(mem => {
              const isSelected = mem.agentId === selectedId;
              return (
                <div
                  key={mem.agentId}
                  onClick={() => { setSelectedId(mem.agentId); }}
                  className="px-3 py-2 cursor-pointer border-b transition-colors flex items-center gap-2"
                  style={{
                    borderColor: theme.borderLight,
                    background: isSelected ? theme.accentBg : "transparent",
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  <span className="text-base shrink-0">{agentIcon(mem.agentId)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: theme.text }}>{mem.agentId}</div>
                    <div className="text-[10px]" style={{ color: theme.text, opacity: 0.4 }}>
                      {mem.lines} lines · {mem.size > 1024 ? `${(mem.size / 1024).toFixed(1)}KB` : `${mem.size}B`}
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(mem.agentId); }}
                    className="text-xs opacity-30 hover:opacity-100"
                    style={{ color: "#dc2626" }}
                  >
                    🗑️
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* === Right: Editor === */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">🤖</div>
            <div className="text-sm">{t("memory.selectPrompt")}</div>
          </div>
        ) : (
          <>
            {/* Editor header */}
            <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
              <div className="flex items-center gap-2">
                <span className="text-base">{agentIcon(selectedId)}</span>
                <span className="text-sm font-medium" style={{ color: theme.text }}>{selectedId}.md</span>
                {modified && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#fffbeb", color: "#d97706" }}>
                    {t("memory.unsaved")}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
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
            </div>

            {/* Editor */}
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

            {/* Footer hint */}
            <div className="px-4 py-1.5 text-[10px]" style={{ borderTop: `1px solid ${theme.borderLight}`, color: theme.text, opacity: 0.3 }}>
              💡 {t("memory.hint")} · ⌘S = {t("memory.save")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
