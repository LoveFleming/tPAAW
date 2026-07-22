/**
 * IssueTracker — Issue tracking panel for Coding IDE
 *
 * Issues = problem/requirement records (記錄、分類、追蹤)
 * Tasks = actionable work items → TaskBoard
 *
 * Features:
 *  - Issue list with filter (status, type, search)
 *  - Issue detail view with edit
 *  - Create new issue
 *  - Import from KNOWN-ISSUES.md
 *  - Linked tasks display
 *  - Stats summary bar
 */
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import API_BASE from "../api";
import MarkdownText from "./MarkdownText";

// ── Types ──
interface Issue {
  id: string;
  title: string;
  type: "bug" | "security" | "requirement" | "enhancement";
  status: "open" | "in-progress" | "resolved" | "closed" | "wontfix";
  priority: "critical" | "high" | "medium" | "low";
  severity: "critical" | "major" | "minor" | "info" | null;
  labels: string[];
  linkedTaskIds: string[];
  description: string;
  reproduction: string;
  solution: string;
  relatedFiles: string[];
  notes: { by: string; at: string; content: string }[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  createdBy: string;
}

interface IssueStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  wontfix: number;
  byPriority: { critical: number; high: number; medium: number; low: number };
  byType: { bug: number; security: number; requirement: number; enhancement: number };
}

interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string };
  onOpenFile?: (path: string) => void;
  onNavigateTask?: (taskId: string) => void;
}

// ── Styles ──
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open:         { bg: "#fef2f2", text: "#dc2626", label: "Open" },
  "in-progress":{ bg: "#fffbeb", text: "#d97706", label: "In Progress" },
  resolved:     { bg: "#f0fdf4", text: "#16a34a", label: "Resolved" },
  closed:       { bg: "#f5f5f4", text: "#78716c", label: "Closed" },
  wontfix:      { bg: "#faf5ff", text: "#9333ea", label: "Won't Fix" },
};

const PRIORITY_STYLES: Record<string, { dot: string; label: string }> = {
  critical: { dot: "#dc2626", label: "Critical" },
  high:     { dot: "#ea580c", label: "High" },
  medium:   { dot: "#facc15", label: "Medium" },
  low:      { dot: "#78716c", label: "Low" },
};

const TYPE_STYLES: Record<string, { icon: string; bg: string; text: string; label: string }> = {
  bug:         { icon: "🐛", bg: "#fef2f2", text: "#dc2626", label: "Bug" },
  security:    { icon: "🔒", bg: "#fdf4ff", text: "#9333ea", label: "Security" },
  requirement: { icon: "📋", bg: "#eff6ff", text: "#2563eb", label: "Requirement" },
  enhancement: { icon: "✨", bg: "#f0fdf4", text: "#16a34a", label: "Enhancement" },
};

const SEVERITY_STYLES: Record<string, { color: string; label: string }> = {
  critical: { color: "#dc2626", label: "🔴 Critical" },
  major:    { color: "#ea580c", label: "🟠 Major" },
  minor:    { color: "#f59e0b", label: "🟡 Minor" },
  info:     { color: "#3b82f6", label: "🔵 Info" },
};

const STATUS_FILTERS = ["all", "open", "in-progress", "resolved", "closed", "wontfix"];
const TYPE_FILTERS = ["all", "bug", "security", "requirement", "enhancement"];

// ── Component ──
export default function IssueTracker({ rootPath, theme, onOpenFile, onNavigateTask }: Props) {
  const { t } = useI18n();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<IssueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Issue>>({ type: "bug" });
  const [noteInput, setNoteInput] = useState("");

  const basePath = `${API_BASE}/api/coding-issues?path=${encodeURIComponent(rootPath)}`;

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = statusFilter !== "all" ? `&status=${statusFilter}` : "";
      const typeParam = typeFilter !== "all" ? `&type=${typeFilter}` : "";
      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "";
      const res = await fetch(`${basePath}${statusParam}${typeParam}${searchParam}`);
      const data = await res.json();
      setIssues(data.issues || []);
    } catch (err) { console.error("[IssueTracker] fetch error:", err); }
    setLoading(false);
  }, [basePath, statusFilter, typeFilter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-issues/stats?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) setStats(await res.json());
    } catch {}
  }, [rootPath]);

  useEffect(() => { fetchIssues(); }, [fetchIssues]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const selected = issues.find(i => i.id === selectedId);

  const handleCreate = async (form: Partial<Issue>) => {
    try {
      const res = await fetch(basePath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (res.ok) { setShowCreate(false); await fetchIssues(); await fetchStats(); }
    } catch (err) { console.error("[IssueTracker] create error:", err); }
  };

  const handleUpdate = async (id: string, patch: Partial<Issue>) => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-issues/${id}?path=${encodeURIComponent(rootPath)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (res.ok) { await fetchIssues(); await fetchStats(); setEditing(false); }
    } catch (err) { console.error("[IssueTracker] update error:", err); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete ${id}?`)) return;
    try {
      await fetch(`${API_BASE}/api/coding-issues/${id}?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" });
      setSelectedId(null); await fetchIssues(); await fetchStats();
    } catch (err) { console.error("[IssueTracker] delete error:", err); }
  };

  const handleAddNote = async () => {
    if (!selectedId || !noteInput.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-issues/${selectedId}/notes?path=${encodeURIComponent(rootPath)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: noteInput.trim(), by: "human" }) });
      if (res.ok) { setNoteInput(""); await fetchIssues(); }
    } catch {}
  };

  const handleImport = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-issues/import-known?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
      const data = await res.json();
      alert(data.imported > 0 ? `✅ Imported ${data.imported} issues` : `No new issues`);
      await fetchIssues(); await fetchStats();
    } catch (err) { alert("Import failed: " + (err as Error).message); }
  };

  const startEdit = (issue: Issue) => {
    setEditing(true);
    setEditForm({ title: issue.title, status: issue.status, priority: issue.priority, type: issue.type, severity: issue.severity, labels: issue.labels, description: issue.description, reproduction: issue.reproduction, solution: issue.solution });
  };

  const inputStyle = { background: theme.bg, color: theme.text, borderColor: theme.borderLight } as React.CSSProperties;

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* Left: Issue List */}
      <div className="w-1/2 flex flex-col border-r" style={{ borderColor: theme.borderLight }}>
        {stats && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap" style={{ background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}` }}>
            <span style={{ color: theme.text, opacity: 0.6 }}>Issues: <b>{stats.total}</b></span>
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.open.bg, color: STATUS_STYLES.open.text }}>Open: {stats.open}</span>
            {stats.inProgress > 0 && <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES["in-progress"].bg, color: STATUS_STYLES["in-progress"].text }}>In Progress: {stats.inProgress}</span>}
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.resolved.bg, color: STATUS_STYLES.resolved.text }}>Resolved: {stats.resolved}</span>
            {stats.byType && Object.entries(stats.byType).filter(([, v]) => v > 0).map(([k, v]) => {
              const ts = TYPE_STYLES[k];
              return ts ? <span key={k} className="px-1.5 py-0.5 rounded" style={{ background: ts.bg, color: ts.text }}>{ts.icon} {v}</span> : null;
            })}
          </div>
        )}
        <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-xs px-1.5 py-1 rounded border" style={inputStyle}>
            {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === "all" ? "All Status" : s}</option>)}
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="text-xs px-1.5 py-1 rounded border" style={inputStyle}>
            {TYPE_FILTERS.map(s => { const ts = TYPE_STYLES[s]; return <option key={s} value={s}>{s === "all" ? "All Types" : ts ? `${ts.icon} ${ts.label}` : s}</option>; })}
          </select>
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search issues..." className="flex-1 text-xs px-2 py-1 rounded border outline-none min-w-0" style={inputStyle} />
          <button onClick={() => setShowCreate(true)} className="text-xs px-2 py-1 rounded font-medium shrink-0" style={{ background: theme.accentBg, color: theme.accent }}>+ New</button>
          <button onClick={handleImport} className="text-xs px-1.5 py-1 rounded shrink-0" style={{ background: theme.bgMuted, color: theme.text }} title="Import KNOWN-ISSUES.md">⬆️</button>
          <button onClick={() => { fetchIssues(); fetchStats(); }} className="text-xs px-1.5 py-1 rounded shrink-0" style={{ background: theme.bgMuted, color: theme.text }}>🔄</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>Loading...</div>
          : issues.length === 0 ? <div className="flex flex-col items-center justify-center h-full gap-2 text-sm" style={{ color: theme.text, opacity: 0.4 }}><div className="text-3xl">🐛</div><div>No issues</div></div>
          : issues.map(issue => {
            const st = STATUS_STYLES[issue.status] || STATUS_STYLES.open;
            const pr = PRIORITY_STYLES[issue.priority] || PRIORITY_STYLES.medium;
            const ty = TYPE_STYLES[issue.type] || TYPE_STYLES.bug;
            const isSelected = issue.id === selectedId;
            return (
              <div key={issue.id} onClick={() => { setSelectedId(issue.id); setEditing(false); }} className="px-3 py-2.5 cursor-pointer border-b transition-colors" style={{ borderColor: theme.borderLight, background: isSelected ? theme.accentBg : "transparent" }} onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }} onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
                <div className="flex items-start gap-2">
                  <div className="mt-1 shrink-0 flex items-center gap-1">
                    <span className="text-xs">{ty.icon}</span>
                    <div className="w-2 h-2 rounded-full" style={{ background: pr.dot }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="text-xs font-mono shrink-0" style={{ color: theme.text, opacity: 0.5 }}>{issue.id}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: ty.bg, color: ty.text }}>{ty.label}</span>
                      {issue.severity && <span className="text-[10px] shrink-0">{SEVERITY_STYLES[issue.severity]?.label}</span>}
                      {issue.linkedTaskIds.length > 0 && <span className="text-[10px] px-1 py-0.5 rounded shrink-0" style={{ background: theme.bgMuted, color: theme.text }}>📋 {issue.linkedTaskIds.length}</span>}
                    </div>
                    <div className="text-sm font-medium truncate" style={{ color: theme.text }}>{issue.title}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Detail / Create */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showCreate ? (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold" style={{ color: theme.text }}>🐛 New Issue</h2>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Title</label><input type="text" value={editForm.title || ""} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} /></div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Type</label><select value={editForm.type || "bug"} onChange={e => setEditForm({ ...editForm, type: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="bug">🐛 Bug</option><option value="security">🔒 Security</option><option value="requirement">📋 Requirement</option><option value="enhancement">✨ Enhancement</option></select></div>
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Severity</label><select value={editForm.severity || ""} onChange={e => setEditForm({ ...editForm, severity: e.target.value as any || null })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="">—</option><option value="critical">🔴 Critical</option><option value="major">🟠 Major</option><option value="minor">🟡 Minor</option><option value="info">🔵 Info</option></select></div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Priority</label><select value={editForm.priority || "medium"} onChange={e => setEditForm({ ...editForm, priority: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Status</label><select value={editForm.status || "open"} onChange={e => setEditForm({ ...editForm, status: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="open">Open</option><option value="in-progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="wontfix">Won't Fix</option></select></div>
            </div>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Description</label><textarea value={editForm.description || ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y" style={inputStyle} /></div>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Reproduction</label><textarea value={editForm.reproduction || ""} onChange={e => setEditForm({ ...editForm, reproduction: e.target.value })} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y font-mono" style={inputStyle} /></div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => handleCreate(editForm)} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent }}>✅ Create</button>
              <button onClick={() => setShowCreate(false)} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>Cancel</button>
            </div>
          </div>
        ) : !selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}><div className="text-4xl">🐛</div><div className="text-sm">Select an issue</div></div>
        ) : editing ? (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold" style={{ color: theme.text }}>✏️ Edit {selected.id}</h2>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Title</label><input type="text" value={editForm.title || ""} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} /></div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Type</label><select value={editForm.type || "bug"} onChange={e => setEditForm({ ...editForm, type: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="bug">🐛 Bug</option><option value="security">🔒 Security</option><option value="requirement">📋 Requirement</option><option value="enhancement">✨ Enhancement</option></select></div>
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Severity</label><select value={editForm.severity || ""} onChange={e => setEditForm({ ...editForm, severity: e.target.value as any || null })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="">—</option><option value="critical">🔴 Critical</option><option value="major">🟠 Major</option><option value="minor">🟡 Minor</option><option value="info">🔵 Info</option></select></div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Priority</label><select value={editForm.priority || "medium"} onChange={e => setEditForm({ ...editForm, priority: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Status</label><select value={editForm.status || "open"} onChange={e => setEditForm({ ...editForm, status: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="open">Open</option><option value="in-progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="wontfix">Won't Fix</option></select></div>
            </div>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Description</label><textarea value={editForm.description || ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y" style={inputStyle} /></div>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Reproduction</label><textarea value={editForm.reproduction || ""} onChange={e => setEditForm({ ...editForm, reproduction: e.target.value })} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y font-mono" style={inputStyle} /></div>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Solution</label><textarea value={editForm.solution || ""} onChange={e => setEditForm({ ...editForm, solution: e.target.value })} rows={2} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y" style={inputStyle} /></div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => handleUpdate(selected.id, editForm)} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent }}>✅ Save</button>
              <button onClick={() => setEditing(false)} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            {(() => {
              const st = STATUS_STYLES[selected.status] || STATUS_STYLES.open;
              const pr = PRIORITY_STYLES[selected.priority] || PRIORITY_STYLES.medium;
              const ty = TYPE_STYLES[selected.type] || TYPE_STYLES.bug;
              return (
                <>
                  <div className="flex items-start justify-between gap-2 mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-mono" style={{ color: theme.text, opacity: 0.5 }}>{selected.id}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                        <span className="text-[10px] px-1 py-0.5 rounded inline-flex items-center gap-1" style={{ background: theme.bgMuted, color: theme.text }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: pr.dot }} /> {pr.label}</span>
                        <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: ty.bg, color: ty.text }}>{ty.icon} {ty.label}</span>
                        {selected.severity && <span className="text-[10px]">{SEVERITY_STYLES[selected.severity]?.label}</span>}
                      </div>
                      <h2 className="text-lg font-bold" style={{ color: theme.text }}>{selected.title}</h2>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => startEdit(selected)} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>✏️ Edit</button>
                      <button onClick={() => handleDelete(selected.id)} className="text-xs px-2 py-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>🗑️</button>
                    </div>
                  </div>
                  {/* Linked Tasks */}
                  {selected.linkedTaskIds.length > 0 && (
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>📋 Linked Tasks ({selected.linkedTaskIds.length})</h3>
                      <div className="flex gap-1 flex-wrap">
                        {selected.linkedTaskIds.map(tid => (
                          <button key={tid} onClick={() => onNavigateTask?.(tid)} className="text-xs px-2 py-1 rounded font-mono hover:underline" style={{ background: theme.accentBg, color: theme.accent }}>{tid}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-4 text-xs mb-4" style={{ color: theme.text, opacity: 0.5 }}>
                    <span>📅 Created: {new Date(selected.createdAt).toLocaleString()}</span>
                    <span>🔄 Updated: {new Date(selected.updatedAt).toLocaleString()}</span>
                    {selected.resolvedAt && <span>✅ Resolved: {new Date(selected.resolvedAt).toLocaleString()}</span>}
                  </div>
                  {selected.labels.length > 0 && <div className="flex gap-1 mb-4 flex-wrap">{selected.labels.map(l => <span key={l} className="text-xs px-2 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>🏷️ {l}</span>)}</div>}
                  {selected.description && <div className="mb-4"><h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>Description</h3><div style={{ color: theme.text }}><MarkdownText>{selected.description}</MarkdownText></div></div>}
                  {selected.reproduction && <div className="mb-4"><h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>Reproduction</h3><div className="p-2 rounded" style={{ background: theme.bgMuted }}><MarkdownText>{selected.reproduction}</MarkdownText></div></div>}
                  {selected.solution && <div className="mb-4"><h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>Solution</h3><div style={{ color: theme.text }}><MarkdownText>{selected.solution}</MarkdownText></div></div>}
                  {selected.relatedFiles.length > 0 && <div className="mb-4"><h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>Related Files</h3><div className="flex flex-col gap-1">{selected.relatedFiles.map(f => <button key={f} onClick={() => onOpenFile?.(f)} className="text-sm text-left px-2 py-1 rounded font-mono hover:underline" style={{ background: theme.bgMuted, color: theme.accent }}>📄 {f}</button>)}</div></div>}
                  {/* Notes */}
                  <div className="mb-4">
                    <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>Discussion</h3>
                    {selected.notes.length > 0 && <div className="flex flex-col gap-2 mb-2">{selected.notes.map((note, i) => <div key={i} className="flex gap-2 items-start"><span className="text-xs shrink-0">{note.by === "agent" || note.by === "em" ? "🤖" : "👤"}</span><div className="text-sm flex-1" style={{ color: theme.text }}><MarkdownText>{note.content}</MarkdownText><div className="text-[10px] mt-0.5" style={{ opacity: 0.4 }}>{new Date(note.at).toLocaleString()}</div></div></div>)}</div>}
                    <div className="flex gap-2">
                      <input type="text" value={noteInput} onChange={e => setNoteInput(e.target.value)} placeholder="Add a note..." className="flex-1 text-xs px-2 py-1.5 rounded border outline-none" style={inputStyle} onKeyDown={e => { if (e.key === "Enter" && noteInput.trim()) { e.preventDefault(); handleAddNote(); } }} />
                      <button onClick={handleAddNote} disabled={!noteInput.trim()} className="text-xs px-2 py-1 rounded font-medium shrink-0" style={{ background: noteInput.trim() ? theme.accentBg : theme.bgMuted, color: noteInput.trim() ? theme.accent : theme.text, opacity: noteInput.trim() ? 1 : 0.5 }}>💬</button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
