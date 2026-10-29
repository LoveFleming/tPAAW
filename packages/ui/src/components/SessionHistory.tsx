/**
 * SessionHistory — Browse .paaw/sessions/ records
 *
 * Shows past AI coding sessions with task, duration, files changed.
 */
import React, { useEffect, useState, useCallback } from "react";
import API_BASE from "../api";

// ── Types ──

interface SessionFile {
  filename: string;
  modified: string;
  size: number;
}

interface SessionHistoryProps {
  projectRoot: string;
  refreshKey?: number;
}

// ── Helpers ──

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// ── Component ──

export default function SessionHistory({ projectRoot, refreshKey = 0 }: SessionHistoryProps) {
  const [sessions, setSessions] = useState<SessionFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!projectRoot) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/sessions?path=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch {}
    setLoading(false);
  }, [projectRoot]);

  useEffect(() => { loadSessions(); }, [loadSessions, refreshKey]);

  const openSession = useCallback(async (filename: string) => {
    setSelected(filename);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/sessions/${encodeURIComponent(filename)}?path=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        setContent(await res.text());
      }
    } catch {}
  }, [projectRoot]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-stone-200 bg-stone-50 text-xs">
        <span className="font-semibold text-stone-600">📜 Sessions</span>
        <span className="text-[10px] text-stone-400">({sessions.length})</span>
        <div className="flex-1" />
        <button
          onClick={loadSessions}
          className="px-1 py-0.5 rounded text-[10px] text-stone-400 hover:text-stone-600"
        >
          ↻
        </button>
      </div>

      {/* Split: list + detail */}
      <div className="flex flex-1 min-h-0">
        {/* Session list */}
        <div className="w-44 border-r border-stone-200 overflow-y-auto bg-white" style={{ scrollbarWidth: "thin" }}>
          {loading && <div className="px-2 py-1 text-[10px] text-stone-400 animate-pulse">Loading...</div>}
          {sessions.map(s => (
            <div
              key={s.filename}
              onClick={() => openSession(s.filename)}
              className={`px-2 py-1.5 cursor-pointer border-b border-stone-100 ${
                selected === s.filename ? "bg-blue-50" : "hover:bg-stone-50"
              }`}
            >
              <div className={`text-[11px] truncate ${selected === s.filename ? "text-blue-700 font-medium" : "text-stone-700"}`}>
                {s.filename.replace(".md", "")}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px] text-stone-400">{formatDate(s.modified)}</span>
                <span className="text-[9px] text-stone-300">{formatSize(s.size)}</span>
              </div>
            </div>
          ))}
          {sessions.length === 0 && !loading && (
            <div className="px-2 py-3 text-[10px] text-stone-400 text-center">
              <div className="text-xl mb-1">📜</div>
              No sessions yet.<br />
              <span className="text-[9px]">AI coding sessions<br />will appear here.</span>
            </div>
          )}
        </div>

        {/* Detail view */}
        <div className="flex-1 overflow-y-auto bg-white" style={{ scrollbarWidth: "thin" }}>
          {selected ? (
            <div className="p-3 text-[11px] leading-relaxed text-stone-700 whitespace-pre-wrap font-mono">
              {content}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-stone-300 text-xs h-full">
              <div className="text-center">
                <div className="text-2xl mb-2">📜</div>
                <div>Select a session to view</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
