/**
 * TaskBoard — Task management panel for Coding IDE
 *
 * Tasks = actionable work items (派工、執行、追蹤)
 * Issues = problem/requirement records → IssueTracker
 *
 * Features:
 *  - Task list with filter (status, type, assignee, search)
 *  - Task detail with edit, decompose, dispatch
 *  - Parent/child navigation
 *  - Execution result display
 *  - Linked issue display
 */
import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";
import MarkdownText from "./MarkdownText";

// ── Types ──
interface Task {
  id: string;
  title: string;
  type: "requirement" | "bug" | "security" | "chore";
  parentId: string | null;
  linkedIssueId: string | null;
  status: "open" | "in-progress" | "resolved" | "closed" | "wontfix";
  priority: "critical" | "high" | "medium" | "low";
  effort: "S" | "M" | "L" | "XL" | null;
  labels: string[];
  assignee: string | null;
  description: string;
  relatedFiles: string[];
  notes: { by: string; at: string; content: string }[];
  executionResult: { summary: string; filesChanged: string[]; success: boolean } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  createdBy: string;
}

interface TaskStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  byAssignee: Record<string, { total: number; open: number; resolved: number }>;
}

interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string };
  onOpenFile?: (path: string) => void;
  onNavigateIssue?: (issueId: string) => void;
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
  requirement: { icon: "📋", bg: "#eff6ff", text: "#2563eb", label: "Requirement" },
  bug:         { icon: "🐛", bg: "#fef2f2", text: "#dc2626", label: "Bug" },
  security:    { icon: "🔒", bg: "#fdf4ff", text: "#9333ea", label: "Security" },
  chore:       { icon: "🔧", bg: "#f5f5f4", text: "#78716c", label: "Chore" },
};

const EFFORT_STYLES: Record<string, { color: string }> = { S: { color: "#22c55e" }, M: { color: "#3b82f6" }, L: { color: "#f59e0b" }, XL: { color: "#dc2626" } };

const STATUS_FILTERS = ["all", "open", "in-progress", "resolved", "closed"];
const TYPE_FILTERS = ["all", "requirement", "bug", "security", "chore"];

export default function TaskBoard({ rootPath, theme, onOpenFile, onNavigateIssue }: Props) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showDecompose, setShowDecompose] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Task>>({ type: "chore" });
  const [noteInput, setNoteInput] = useState("");
  const [decomposeSubs, setDecomposeSubs] = useState([{ title: "", type: "", effort: "S", assignee: "", description: "" }]);

  const basePath = `${API_BASE}/api/coding-tasks?path=${encodeURIComponent(rootPath)}`;
  const inputStyle = { background: theme.bg, color: theme.text, borderColor: theme.borderLight } as React.CSSProperties;

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const sp = statusFilter !== "all" ? `&status=${statusFilter}` : "";
      const tp = typeFilter !== "all" ? `&type=${typeFilter}` : "";
      const sq = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "";
      const res = await fetch(`${basePath}${sp}${tp}${sq}`);
      setTasks((await res.json()).tasks || []);
    } catch {}
    setLoading(false);
  }, [basePath, statusFilter, typeFilter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try { const res = await fetch(`${API_BASE}/api/coding-tasks/stats?path=${encodeURIComponent(rootPath)}`); if (res.ok) setStats(await res.json()); } catch {}
  }, [rootPath]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const selected = tasks.find(t => t.id === selectedId);
  const childTasks = tasks.filter(t => t.parentId === selectedId);
  const parentTask = selected?.parentId ? tasks.find(t => t.id === selected.parentId) : null;

  const navigateTo = (id: string) => { setSelectedId(id); setEditing(false); setShowDecompose(false); };

  const handleCreate = async (form: Partial<Task>) => {
    try { const res = await fetch(basePath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); if (res.ok) { setShowCreate(false); fetchTasks(); fetchStats(); } } catch {}
  };
  const handleUpdate = async (id: string, patch: Partial<Task>) => {
    try { const res = await fetch(`${API_BASE}/api/coding-tasks/${id}?path=${encodeURIComponent(rootPath)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }); if (res.ok) { fetchTasks(); fetchStats(); setEditing(false); } } catch {}
  };
  const handleDelete = async (id: string) => {
    if (!confirm(`Delete ${id}?`)) return;
    try { await fetch(`${API_BASE}/api/coding-tasks/${id}?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" }); setSelectedId(null); fetchTasks(); fetchStats(); } catch {}
  };
  const handleDecompose = async () => {
    if (!selectedId) return;
    const validSubs = decomposeSubs.filter(s => s.title.trim());
    if (!validSubs.length) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/decompose?path=${encodeURIComponent(rootPath)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId: selectedId, subTasks: validSubs, createdBy: "human" }) });
      const data = await res.json();
      if (data.subTasks) { setShowDecompose(false); setDecomposeSubs([{ title: "", type: "", effort: "S", assignee: "", description: "" }]); fetchTasks(); fetchStats(); }
      else alert(`Failed: ${data.error}`);
    } catch (err) { alert("Failed: " + (err as Error).message); }
  };
  const handleAddNote = async () => {
    if (!selectedId || !noteInput.trim()) return;
    try { const res = await fetch(`${API_BASE}/api/coding-tasks/${selectedId}/notes?path=${encodeURIComponent(rootPath)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: noteInput.trim(), by: "human" }) }); if (res.ok) { setNoteInput(""); fetchTasks(); } } catch {}
  };

  const startEdit = (task: Task) => { setEditing(true); setEditForm({ title: task.title, status: task.status, priority: task.priority, type: task.type, effort: task.effort, assignee: task.assignee, description: task.description }); };

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* Left: Task List */}
      <div className="w-1/2 flex flex-col border-r" style={{ borderColor: theme.borderLight }}>
        {stats && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap" style={{ background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}` }}>
            <span style={{ color: theme.text, opacity: 0.6 }}>Tasks: <b>{stats.total}</b></span>
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.open.bg, color: STATUS_STYLES.open.text }}>Open: {stats.open}</span>
            {stats.inProgress > 0 && <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES["in-progress"].bg, color: STATUS_STYLES["in-progress"].text }}>Active: {stats.inProgress}</span>}
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.resolved.bg, color: STATUS_STYLES.resolved.text }}>Done: {stats.resolved}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-xs px-1.5 py-1 rounded border" style={inputStyle}>{STATUS_FILTERS.map(s => <option key={s} value={s}>{s === "all" ? "All Status" : s}</option>)}</select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="text-xs px-1.5 py-1 rounded border" style={inputStyle}>{TYPE_FILTERS.map(s => { const ts = TYPE_STYLES[s]; return <option key={s} value={s}>{s === "all" ? "All Types" : ts ? `${ts.icon} ${ts.label}` : s}</option>; })}</select>
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search tasks..." className="flex-1 text-xs px-2 py-1 rounded border outline-none min-w-0" style={inputStyle} />
          <button onClick={() => setShowCreate(true)} className="text-xs px-2 py-1 rounded font-medium shrink-0" style={{ background: theme.accentBg, color: theme.accent }}>+ New</button>
          <button onClick={() => { fetchTasks(); fetchStats(); }} className="text-xs px-1.5 py-1 rounded shrink-0" style={{ background: theme.bgMuted, color: theme.text }}>🔄</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>Loading...</div>
          : tasks.length === 0 ? <div className="flex flex-col items-center justify-center h-full gap-2 text-sm" style={{ color: theme.text, opacity: 0.4 }}><div className="text-3xl">📋</div><div>No tasks</div></div>
          : tasks.map(task => {
            const st = STATUS_STYLES[task.status] || STATUS_STYLES.open;
            const pr = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium;
            const ty = TYPE_STYLES[task.type] || TYPE_STYLES.chore;
            const isSelected = task.id === selectedId;
            const isChild = !!task.parentId;
            return (
              <div key={task.id} onClick={() => navigateTo(task.id)} className="px-3 py-2.5 cursor-pointer border-b transition-colors" style={{ borderColor: theme.borderLight, background: isSelected ? theme.accentBg : "transparent", paddingLeft: isChild ? "2rem" : undefined }} onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }} onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
                <div className="flex items-start gap-2">
                  <div className="mt-1 shrink-0 flex items-center gap-1"><span className="text-xs">{isChild ? "↳" : ty.icon}</span>{!isChild && <div className="w-2 h-2 rounded-full" style={{ background: pr.dot }} />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="text-xs font-mono shrink-0" style={{ color: theme.text, opacity: 0.5 }}>{task.id}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: ty.bg, color: ty.text }}>{ty.label}</span>
                      {task.effort && <span className="text-[10px] px-1 py-0.5 rounded shrink-0 font-bold" style={{ background: (EFFORT_STYLES[task.effort] || EFFORT_STYLES.S).color + "20", color: (EFFORT_STYLES[task.effort] || EFFORT_STYLES.S).color }}>{task.effort}</span>}
                      {task.assignee && <span className="text-[10px] shrink-0">👤{task.assignee}</span>}
                      {task.executionResult && <span className="text-[10px] shrink-0">{task.executionResult.success ? "⚡✅" : "⚡❌"}</span>}
                    </div>
                    <div className="text-sm font-medium truncate" style={{ color: theme.text }}>{task.title}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected && !showCreate && !showDecompose ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}><div className="text-4xl">📋</div><div className="text-sm">Select a task</div></div>
        ) : showCreate ? (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold" style={{ color: theme.text }}>📋 New Task</h2>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Title</label><input type="text" value={editForm.title || ""} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} placeholder="What needs to be done?" /></div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Type</label><select value={editForm.type || "chore"} onChange={e => setEditForm({ ...editForm, type: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="requirement">📋 Requirement</option><option value="bug">🐛 Bug</option><option value="security">🔒 Security</option><option value="chore">🔧 Chore</option></select></div>
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Effort</label><select value={editForm.effort || ""} onChange={e => setEditForm({ ...editForm, effort: e.target.value as any || null })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="">—</option><option value="S">S</option><option value="M">M</option><option value="L">L</option><option value="XL">XL</option></select></div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Priority</label><select value={editForm.priority || "medium"} onChange={e => setEditForm({ ...editForm, priority: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Assignee</label><input type="text" value={editForm.assignee || ""} onChange={e => setEditForm({ ...editForm, assignee: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} placeholder="developer, tester, em..." /></div>
            </div>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Description</label><textarea value={editForm.description || ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y" style={inputStyle} /></div>
            <div className="flex gap-2 mt-2"><button onClick={() => handleCreate(editForm)} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent }}>✅ Create</button><button onClick={() => setShowCreate(false)} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>Cancel</button></div>
          </div>
        ) : showDecompose && selected ? (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold" style={{ color: theme.text }}>✂️ Decompose {selected.id}</h2>
            <div className="text-sm" style={{ color: theme.text, opacity: 0.6 }}>Split <b>{selected.title}</b> into sub-tasks</div>
            {decomposeSubs.map((sub, idx) => (
              <div key={idx} className="p-3 rounded border" style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
                <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold" style={{ opacity: 0.5 }}>#{idx + 1}</span>{decomposeSubs.length > 1 && <button onClick={() => setDecomposeSubs(decomposeSubs.filter((_, i) => i !== idx))} className="text-xs px-1 rounded" style={{ color: "#dc2626" }}>✕</button>}</div>
                <input type="text" value={sub.title} onChange={e => { const n = [...decomposeSubs]; n[idx] = { ...n[idx], title: e.target.value }; setDecomposeSubs(n); }} placeholder="Sub-task title" className="w-full text-sm px-2 py-1.5 rounded border outline-none mb-2" style={inputStyle} />
                <div className="flex gap-2">
                  <select value={sub.effort} onChange={e => { const n = [...decomposeSubs]; n[idx] = { ...n[idx], effort: e.target.value }; setDecomposeSubs(n); }} className="text-xs px-1.5 py-1 rounded border" style={inputStyle}><option value="S">S</option><option value="M">M</option><option value="L">L</option></select>
                  <input type="text" value={sub.assignee} onChange={e => { const n = [...decomposeSubs]; n[idx] = { ...n[idx], assignee: e.target.value }; setDecomposeSubs(n); }} placeholder="Assignee" className="flex-1 text-xs px-1.5 py-1 rounded border outline-none" style={inputStyle} />
                </div>
              </div>
            ))}
            <button onClick={() => setDecomposeSubs([...decomposeSubs, { title: "", type: "", effort: "S", assignee: "", description: "" }])} className="text-xs px-2 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>+ Add sub-task</button>
            <div className="flex gap-2 mt-2"><button onClick={handleDecompose} disabled={!decomposeSubs.some(s => s.title.trim())} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent, opacity: decomposeSubs.some(s => s.title.trim()) ? 1 : 0.5 }}>✂️ Split</button><button onClick={() => { setShowDecompose(false); setDecomposeSubs([{ title: "", type: "", effort: "S", assignee: "", description: "" }]); }} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>Cancel</button></div>
          </div>
        ) : editing ? (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold" style={{ color: theme.text }}>✏️ Edit {selected!.id}</h2>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Title</label><input type="text" value={editForm.title || ""} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} /></div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Type</label><select value={editForm.type || "chore"} onChange={e => setEditForm({ ...editForm, type: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="requirement">📋</option><option value="bug">🐛</option><option value="security">🔒</option><option value="chore">🔧</option></select></div>
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Effort</label><select value={editForm.effort || ""} onChange={e => setEditForm({ ...editForm, effort: e.target.value as any || null })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="">—</option><option value="S">S</option><option value="M">M</option><option value="L">L</option><option value="XL">XL</option></select></div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Status</label><select value={editForm.status || "open"} onChange={e => setEditForm({ ...editForm, status: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="open">Open</option><option value="in-progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div>
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Priority</label><select value={editForm.priority || "medium"} onChange={e => setEditForm({ ...editForm, priority: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
              <div className="flex-1"><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Assignee</label><input type="text" value={editForm.assignee || ""} onChange={e => setEditForm({ ...editForm, assignee: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} /></div>
            </div>
            <div><label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Description</label><textarea value={editForm.description || ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y" style={inputStyle} /></div>
            <div className="flex gap-2 mt-2"><button onClick={() => handleUpdate(selected!.id, editForm)} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent }}>✅ Save</button><button onClick={() => setEditing(false)} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>Cancel</button></div>
          </div>
        ) : selected && (
          <div className="flex-1 overflow-y-auto p-4">
            {(() => {
              const st = STATUS_STYLES[selected.status] || STATUS_STYLES.open;
              const pr = PRIORITY_STYLES[selected.priority] || PRIORITY_STYLES.medium;
              const ty = TYPE_STYLES[selected.type] || TYPE_STYLES.chore;
              return (
                <>
                  <div className="flex items-start justify-between gap-2 mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-mono" style={{ opacity: 0.5 }}>{selected.id}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                        <span className="text-[10px] px-1 py-0.5 rounded inline-flex items-center gap-1" style={{ background: theme.bgMuted, color: theme.text }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: pr.dot }} />{pr.label}</span>
                        <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: ty.bg, color: ty.text }}>{ty.icon} {ty.label}</span>
                        {selected.effort && <span className="text-[10px] px-1 py-0.5 rounded font-bold" style={{ background: (EFFORT_STYLES[selected.effort] || EFFORT_STYLES.S).color + "20", color: (EFFORT_STYLES[selected.effort] || EFFORT_STYLES.S).color }}>{selected.effort}</span>}
                        {selected.assignee && <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>👤 {selected.assignee}</span>}
                        {selected.executionResult && <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: "#1e1b4b", color: "#c4b5fd" }}>⚡ {selected.executionResult.success ? "✅" : "❌"}</span>}
                      </div>
                      <h2 className="text-lg font-bold" style={{ color: theme.text }}>{selected.title}</h2>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => setShowDecompose(true)} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }} title="Decompose">✂️ Split</button>
                      <button onClick={() => startEdit(selected)} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>✏️</button>
                      <button onClick={() => handleDelete(selected.id)} className="text-xs px-2 py-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>🗑️</button>
                    </div>
                  </div>
                  {/* Linked Issue */}
                  {selected.linkedIssueId && (
                    <div className="mb-3 p-2 rounded flex items-center gap-2" style={{ background: theme.bgMuted }}>
                      <span className="text-xs" style={{ opacity: 0.6 }}>🐛 Issue:</span>
                      <button onClick={() => onNavigateIssue?.(selected.linkedIssueId!)} className="text-xs font-mono px-1.5 py-0.5 rounded hover:underline" style={{ color: theme.accent }}>{selected.linkedIssueId}</button>
                    </div>
                  )}
                  {/* Parent */}
                  {parentTask && (
                    <div className="mb-3 p-2 rounded flex items-center gap-2" style={{ background: theme.bgMuted }}>
                      <span className="text-xs" style={{ opacity: 0.6 }}>⬆️ Parent:</span>
                      <button onClick={() => navigateTo(parentTask.id)} className="text-xs font-mono px-1.5 py-0.5 rounded hover:underline" style={{ color: theme.accent }}>{parentTask.id}: {parentTask.title}</button>
                    </div>
                  )}
                  {/* Children */}
                  {childTasks.length > 0 && (
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>📌 Sub-tasks ({childTasks.length})</h3>
                      <div className="flex flex-col gap-1">
                        {childTasks.map(child => { const cst = STATUS_STYLES[child.status] || STATUS_STYLES.open; return (
                          <button key={child.id} onClick={() => navigateTo(child.id)} className="flex items-center gap-2 text-xs text-left px-2 py-1.5 rounded hover:underline" style={{ background: theme.bgMuted, color: theme.text }}>
                            <span className="font-mono shrink-0" style={{ opacity: 0.5 }}>{child.id}</span>
                            <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: cst.bg, color: cst.text }}>{cst.label}</span>
                            <span className="truncate flex-1">{child.title}</span>
                            {child.effort && <span className="shrink-0 font-bold" style={{ color: (EFFORT_STYLES[child.effort] || EFFORT_STYLES.S).color }}>{child.effort}</span>}
                            {child.executionResult && <span className="shrink-0">{child.executionResult.success ? "⚡✅" : "⚡❌"}</span>}
                          </button>
                        ); })}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-4 text-xs mb-4" style={{ color: theme.text, opacity: 0.5 }}>
                    <span>📅 {new Date(selected.createdAt).toLocaleString()}</span>
                    <span>🔄 {new Date(selected.updatedAt).toLocaleString()}</span>
                    {selected.resolvedAt && <span>✅ {new Date(selected.resolvedAt).toLocaleString()}</span>}
                  </div>
                  {selected.description && <div className="mb-4"><h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>Description</h3><div style={{ color: theme.text }}><MarkdownText>{selected.description}</MarkdownText></div></div>}
                  {selected.relatedFiles.length > 0 && <div className="mb-4"><h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>Related Files</h3><div className="flex flex-col gap-1">{selected.relatedFiles.map(f => <button key={f} onClick={() => onOpenFile?.(f)} className="text-sm text-left px-2 py-1 rounded font-mono hover:underline" style={{ background: theme.bgMuted, color: theme.accent }}>📄 {f}</button>)}</div></div>}
                  {selected.executionResult && <div className="mb-4"><h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>⚡ Execution Result</h3><div className="p-2 rounded" style={{ background: "#1e1b4b", color: "#c4b5fd" }}><div className="text-sm">{selected.executionResult.success ? "✅" : "❌"} {selected.executionResult.summary}</div>{selected.executionResult.filesChanged?.length > 0 && <div className="mt-1 text-xs" style={{ opacity: 0.8 }}>Files: {selected.executionResult.filesChanged.join(", ")}</div>}</div></div>}
                  {/* Notes */}
                  <div className="mb-4">
                    <h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>Discussion</h3>
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
