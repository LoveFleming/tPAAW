/**
 * TaskBoard — Task management panel for Coding IDE
 *
 * Features:
 *  - 3 view modes: List | Pipeline (Kanban) | Overnight
 *  - Task list with source icons and pipeline mini-bar
 *  - Pipeline kanban board (7 columns)
 *  - Overnight queue and results
 *  - Task detail with pipeline progress, spec, changes, test/QA results, git controls
 *  - Parent/child navigation, decompose, notes
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";
import MarkdownText from "./MarkdownText";

// ── Types ──
// ── Feature-first Task Model (2026-09-01) ──
// Status: open | close | pending | ignore
// Type:   dev | test | docs
// Every task has a featureId

interface Task {
  id: string;
  featureId: string | null;
  title: string;
  type: "dev" | "test" | "docs";
  parentId: string | null;
  status: "open" | "close" | "pending" | "ignore";
  priority: "critical" | "high" | "medium" | "low";
  labels: string[];
  assignee: string | null;
  description: string;
  relatedFiles: string[];
  notes: { by: string; at: string; content: string }[];
  result: string | null;
  git?: { staged?: boolean; commitSha?: string; backupBranch?: string } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  createdBy: string;
  source?: { type?: string; sessionId?: string; issueId?: string; note?: string } | null;
}

interface TaskStats {
  total: number;
  open: number;
  pending: number;
  close: number;
  ignore: number;
  byType: { dev: number; test: number; docs: number };
  byAssignee: Record<string, { total: number; open: number; close: number }>;
}

interface Props {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  byAssignee: Record<string, { total: number; open: number; resolved: number }>;
}

interface Props {
  rootPath: string;
  /** true when this tab is the visible main tab; triggers auto-refetch on re-show */
  visible?: boolean;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string };
  onOpenFile?: (path: string) => void;
  onNavigateIssue?: (issueId: string) => void;
}

// ── Constants ──
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open:    { bg: "#fef2f2", text: "#dc2626", label: "Open" },
  pending: { bg: "#fffbeb", text: "#d97706", label: "Pending" },
  close:   { bg: "#f0fdf4", text: "#16a34a", label: "Close" },
  ignore:  { bg: "#f5f5f4", text: "#78716c", label: "Ignore" },
};

const PRIORITY_STYLES: Record<string, { dot: string; label: string }> = {
  critical: { dot: "#dc2626", label: "Critical" },
  high:     { dot: "#ea580c", label: "High" },
  medium:   { dot: "#facc15", label: "Medium" },
  low:      { dot: "#78716c", label: "Low" },
};

const TYPE_STYLES: Record<string, { icon: string; bg: string; text: string; label: string }> = {
  dev:  { icon: "🔨", bg: "#eff6ff", text: "#2563eb", label: "Dev" },
  test: { icon: "🧪", bg: "#fef2f2", text: "#dc2626", label: "Test" },
  docs: { icon: "📖", bg: "#f5f5f4", text: "#78716c", label: "Docs" },
};

const STATUS_FILTERS = ["all", "open", "pending", "close", "ignore"];
const TYPE_FILTERS = ["all", "dev", "test", "docs"];


// ── Helper functions ──
function getTaskSourceIcon(task: Task): string {
  return TYPE_STYLES[task.type]?.icon || "🔨";
}


// ── Component ──
export default function TaskBoard({ rootPath, theme, onOpenFile, onNavigateIssue, visible = true }: Props) {
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
  const [showEvidence, setShowEvidence] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Task>>({ type: "dev" });
  const [noteInput, setNoteInput] = useState("");
  const [decomposeSubs, setDecomposeSubs] = useState([{ title: "", type: "dev", assignee: "", description: "" }]);
  // viewMode, pipelineOverview, overnight state removed — list view only
  const [diffModal, setDiffModal] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState("");

  // IME composition refs
  const searchRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const commitMsgRef = useRef<HTMLTextAreaElement>(null);

  const basePath = `${API_BASE}/api/coding-tasks?path=${encodeURIComponent(rootPath)}`;
  const pathParam = encodeURIComponent(rootPath);
  const inputStyle = { background: theme.bg, color: theme.text, borderColor: theme.borderLight } as React.CSSProperties;

  // ── Data fetching ──
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
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/stats?path=${pathParam}`);
      if (res.ok) setStats(await res.json());
    } catch {}
  }, [pathParam]);

  // Pipeline/overnight fetch removed — list view only
  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Auto-reload when the tab becomes visible again (tabs are kept mounted + hidden via CSS,
  // so switching back to the Tasks tab would otherwise show stale/empty data after an
  // agent created tasks via chat in another tab)
  const prevVisibleRef = useRef<boolean>(visible);
  useEffect(() => {
    if (visible && prevVisibleRef.current === false) {
      fetchTasks();
      fetchStats();
    }
    prevVisibleRef.current = visible;
  }, [visible, fetchTasks, fetchStats]);

  const selected = tasks.find(t => t.id === selectedId);
  const childTasks = tasks.filter(t => t.parentId === selectedId);
  const parentTask = selected?.parentId ? tasks.find(t => t.id === selected.parentId) : null;

  const navigateTo = (id: string) => {
    setSelectedId(id);
    setEditing(false);
    setShowDecompose(false);
    setShowCreate(false);
  };

  // ── CRUD handlers ──
  const handleCreate = async (form: Partial<Task>) => {
    try {
      const res = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowCreate(false);
        fetchTasks();
        fetchStats();
      }
    } catch {}
  };

  const handleUpdate = async (id: string, patch: Partial<Task>) => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/${id}?path=${pathParam}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        fetchTasks();
        fetchStats();
        setEditing(false);
      }
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete ${id}?`)) return;
    try {
      await fetch(`${API_BASE}/api/coding-tasks/${id}?path=${pathParam}`, { method: "DELETE" });
      setSelectedId(null);
      fetchTasks();
      fetchStats();
    } catch {}
  };

  const handleDecompose = async () => {
    if (!selectedId) return;
    const validSubs = decomposeSubs.filter(s => s.title.trim());
    if (!validSubs.length) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/decompose?path=${pathParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: selectedId, subTasks: validSubs, createdBy: "human" }),
      });
      const data = await res.json();
      if (data.subTasks) {
        setShowDecompose(false);
        setDecomposeSubs([{ title: "", type: "dev", assignee: "", description: "" }]);
        fetchTasks();
        fetchStats();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch (err) {
      alert("Failed: " + (err as Error).message);
    }
  };

  const handleAddNote = async () => {
    if (!selectedId || !noteInput.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/${selectedId}/notes?path=${pathParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteInput.trim(), by: "human" }),
      });
      if (res.ok) {
        setNoteInput("");
        fetchTasks();
      }
    } catch {}
  };

  // Pipeline handlers removed (feature-first: use status directly)

  // ── Git handlers ──
  const handleGitStage = async (taskId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/${taskId}/git/stage?path=${pathParam}`, { method: "POST" });
      if (res.ok) {
        fetchTasks();
      }
    } catch {}
  };

  const handleGitCommit = async (taskId: string, message: string, push: boolean) => {
    if (!message.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/${taskId}/git/commit?path=${pathParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, push }),
      });
      if (res.ok) {
        fetchTasks();
      }
    } catch {}
  };

  const handleGitRestore = async (taskId: string) => {
    if (!confirm("Restore to base commit? This will discard all changes.")) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/${taskId}/git/restore?path=${pathParam}`, { method: "POST" });
      if (res.ok) {
        fetchTasks();
      }
    } catch {}
  };

  const handleViewDiff = async (taskId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/${taskId}/git/diff?path=${pathParam}`);
      if (res.ok) {
        const text = await res.text();
        setDiffModal(text);
      }
    } catch {}
  };

  const startEdit = (task: Task) => {
    setEditing(true);
    setEditForm({
      title: task.title, status: task.status, priority: task.priority,
      type: task.type, featureId: task.featureId, assignee: task.assignee, description: task.description,
    });
  };

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* Left: Task List / Pipeline / Overnight */}
      <div className="w-1/2 flex flex-col border-r" style={{ borderColor: theme.borderLight }}>
        {/* Stats bar with refresh */}
        {stats && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap" style={{ background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}` }}>
            <span style={{ color: theme.text, opacity: 0.6 }}>{t("task.tasks", "Tasks")}: <b>{stats.total}</b></span>
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.open.bg, color: STATUS_STYLES.open.text }}>{t("task.open", "Open")}: {stats.open}</span>
            {stats.pending > 0 && <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.pending.bg, color: STATUS_STYLES.pending.text }}>{t("task.pending", "Pending")}: {stats.pending}</span>}
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.close.bg, color: STATUS_STYLES.close.text }}>{t("task.done", "Done")}: {stats.close}</span>
            <div className="flex-1" />
            <button
              onClick={() => { fetchTasks(); fetchStats(); }}
              className="text-xs px-1.5 py-1 rounded shrink-0"
              style={{ background: theme.bg, color: theme.text }}
            >
              🔄
            </button>
          </div>
        )}

        {/* ─── LIST VIEW ─── */}
        {(
          <>
            <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-xs px-1.5 py-1 rounded border" style={inputStyle}>
                {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === "all" ? t("task.allStatus", "All Status") : s}</option>)}
              </select>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="text-xs px-1.5 py-1 rounded border" style={inputStyle}>
                {TYPE_FILTERS.map(s => { const ts = TYPE_STYLES[s]; return <option key={s} value={s}>{s === "all" ? t("task.allTypes", "All Types") : ts ? `${ts.icon} ${ts.label}` : s}</option>; })}
              </select>
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t("task.searchPlaceholder", "Search tasks...")}
                className="flex-1 text-xs px-2 py-1 rounded border outline-none min-w-0"
                style={inputStyle}
              />
              <button onClick={() => setShowCreate(true)} className="text-xs px-2 py-1 rounded font-medium shrink-0" style={{ background: theme.accentBg, color: theme.accent }}>+ {t("task.new", "New")}</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>{t("task.loading", "Loading...")}</div>
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-sm" style={{ color: theme.text, opacity: 0.4 }}>
                  <div className="text-3xl">📋</div>
                  <div>{t("task.noTasks", "No tasks")}</div>
                </div>
              ) : (
                tasks.map(task => {
                  const st = STATUS_STYLES[task.status] || STATUS_STYLES.open;
                  const pr = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium;
                  const ty = TYPE_STYLES[task.type] || TYPE_STYLES.chore;
                  const sourceIcon = getTaskSourceIcon(task);
                  const isSelected = task.id === selectedId;
                  const isChild = !!task.parentId;
                  return (
                    <div
                      key={task.id}
                      onClick={() => navigateTo(task.id)}
                      className="px-3 py-2.5 cursor-pointer border-b transition-colors"
                      style={{ borderColor: theme.borderLight, background: isSelected ? theme.accentBg : "transparent", paddingLeft: isChild ? "2rem" : undefined }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-1 shrink-0 flex items-center gap-1">
                          <span className="text-xs">{isChild ? "↳" : sourceIcon}</span>
                          {!isChild && <div className="w-2 h-2 rounded-full" style={{ background: pr.dot }} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <span className="text-xs font-mono shrink-0" style={{ color: theme.text, opacity: 0.5 }}>{task.id}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: ty.bg, color: ty.text }}>{ty.label}</span>
                            {task.featureId && <span className="text-[10px] px-1 py-0.5 rounded shrink-0" style={{ background: theme.bgMuted, color: theme.text, opacity: 0.6 }}>{task.featureId}</span>}
                            {task.assignee && <span className="text-[10px] shrink-0">👤{task.assignee}</span>}
                            {task.result && <span className="text-[10px] shrink-0" title={task.result}>⚡</span>}
                          </div>
                          <div className="text-sm font-medium truncate" style={{ color: theme.text }}>{task.title}</div>
                          
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

      </div>

      {/* Right: Detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected && !showCreate && !showDecompose ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">📋</div>
            <div className="text-sm">{t("task.selectTask", "Select a task")}</div>
          </div>
        ) : showCreate ? (
          <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold" style={{ color: theme.text }}>📋 {t("task.newTask", "New Task")}</h2>
            <div>
              <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.title", "Title")}</label>
              <input ref={titleRef} type="text" value={editForm.title || ""} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} placeholder={t("task.titlePlaceholder", "What needs to be done?")} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.type", "Type")}</label>
                <select value={editForm.type || "dev"} onChange={e => setEditForm({ ...editForm, type: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
                  <option value="dev">🔨 Dev</option>
                  <option value="test">🧪 Test</option>
                  <option value="docs">📖 Docs</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Feature ID *</label>
                <input value={editForm.featureId || ""} onChange={e => setEditForm({ ...editForm, featureId: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle} placeholder="F20260901-001" />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.priority", "Priority")}</label>
                <select value={editForm.priority || "medium"} onChange={e => setEditForm({ ...editForm, priority: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
                  <option value="critical">{t("task.critical", "Critical")}</option>
                  <option value="high">{t("task.high", "High")}</option>
                  <option value="medium">{t("task.medium", "Medium")}</option>
                  <option value="low">{t("task.low", "Low")}</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.assignee", "Assignee")}</label>
                <input type="text" value={editForm.assignee || ""} onChange={e => setEditForm({ ...editForm, assignee: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} placeholder="developer, tester, em..." />
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.description", "Description")}</label>
              <textarea ref={descRef} value={editForm.description || ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={8} className="w-full flex-1 text-sm px-2 py-1.5 rounded border outline-none resize-y" style={{ ...inputStyle, minHeight: "120px" }} />
            </div>
            {/* New: Source type */}
            <div>
              <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.source", "Source")}</label>
              <select
                value={(editForm as any).sourceType || "manual"}
                onChange={e => setEditForm({ ...editForm, source: { type: e.target.value as any } } as any)}
                className="w-full text-sm px-2 py-1.5 rounded border"
                style={inputStyle}
              >
                <option value="vibe">🌊 Vibe</option>
                <option value="discussion">💬 Discussion</option>
                <option value="pm">📋 PM</option>
                <option value="issue">🐛 Issue</option>
                <option value="security">🔒 Security</option>
                <option value="manual">🔧 Manual</option>
              </select>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                onClick={() => { if (editForm.title?.trim()) handleCreate(editForm); }}
                className="text-sm px-4 py-1.5 rounded font-medium"
                style={{ background: theme.accentBg, color: theme.accent }}
              >
                {t("task.create", "Create")}
              </button>
              <button onClick={() => { setShowCreate(false); setEditForm({ type: "dev" }); }} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>
                {t("task.cancel", "Cancel")}
              </button>
            </div>
          </div>
        </div>
        ) : showDecompose ? (
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-lg font-bold mb-3" style={{ color: theme.text }}>✂️ {t("task.decompose", "Decompose")}: {selectedId}</h2>
            {decomposeSubs.map((sub, idx) => (
              <div key={idx} className="flex gap-2 mb-2 items-end">
                <input value={sub.title} onChange={e => { const n = [...decomposeSubs]; n[idx] = { ...n[idx], title: e.target.value }; setDecomposeSubs(n); }} className="flex-1 text-sm px-2 py-1.5 rounded border" style={inputStyle} placeholder="Sub-task title" />
                <button onClick={() => setDecomposeSubs(decomposeSubs.filter((_, i) => i !== idx))} className="text-xs px-2 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>×</button>
              </div>
            ))}
            <button onClick={() => setDecomposeSubs([...decomposeSubs, { title: "", type: "dev", assignee: "", description: "" }])} className="text-xs px-2 py-1.5 rounded mt-1" style={{ background: theme.bgMuted, color: theme.text }}>+ {t("task.addSubTask", "Add sub-task")}</button>
            <div className="flex gap-3 mt-3">
              <button onClick={handleDecompose} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent }}>{t("task.decompose", "Decompose")}</button>
              <button onClick={() => { setShowDecompose(false); setDecomposeSubs([{ title: "", type: "dev", assignee: "", description: "" }]); }} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>{t("task.cancel", "Cancel")}</button>
            </div>
          </div>
        ) : selected ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg font-bold" style={{ color: theme.text }}>{selected.id}</span>
              <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: STATUS_STYLES[selected.status]?.bg, color: STATUS_STYLES[selected.status]?.text }}>{STATUS_STYLES[selected.status]?.label}</span>
              {selected.featureId && <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: theme.bgMuted, color: theme.text, opacity: 0.7 }}>📌 {selected.featureId}</span>}
            </div>
            <div className="text-base font-semibold mb-2" style={{ color: theme.text }}>{selected.title}</div>
            {selected.description && <div className="text-sm mb-3" style={{ color: theme.text, opacity: 0.8 }}><MarkdownText>{selected.description}</MarkdownText></div>}
            {selected.result && <div className="mb-3 p-2 rounded text-sm" style={{ background: theme.bgMuted, color: theme.text }}><strong>Result:</strong> {selected.result}</div>}
            {/* Notes */}
            <div className="mb-3">
              <h4 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.6 }}>{t("task.notes", "Notes")}</h4>
              {selected.notes?.map((n, i) => (
                <div key={i} className="text-sm mb-1" style={{ color: theme.text, opacity: 0.8 }}>
                  <span className="text-xs" style={{ opacity: 0.5 }}>{n.by} · {new Date(n.at).toLocaleString()}</span>
                  <div>{n.content}</div>
                </div>
              ))}
              <div className="flex gap-2 mt-1">
                <input ref={noteRef} value={noteInput} onChange={e => setNoteInput(e.target.value)}
                  onCompositionStart={() => { if (noteRef.current) (noteRef.current as any)._composing = true; }}
                  onCompositionEnd={() => { if (noteRef.current) (noteRef.current as any)._composing = false; }}
                  onKeyDown={e => { if (e.key === "Enter" && !((noteRef.current as any)?._composing || e.nativeEvent.isComposing || e.keyCode === 229)) { e.preventDefault(); handleAddNote(); } }}
                  className="flex-1 text-sm px-2 py-1.5 rounded border" style={inputStyle} placeholder="Add note..."
                />
                <button onClick={handleAddNote} className="text-sm px-3 py-1.5 rounded" style={{ background: theme.accentBg, color: theme.accent }}>+</button>
              </div>
            </div>
            {/* Status change */}
            <div className="flex gap-2 mb-3">
              {(["open", "pending", "close", "ignore"] as const).map(s => (
                <button key={s} onClick={() => handleUpdate(selected.id, { status: s })} className="text-xs px-2 py-1 rounded" style={{ background: STATUS_STYLES[s].bg, color: STATUS_STYLES[s].text, opacity: selected.status === s ? 1 : 0.5 }}>{STATUS_STYLES[s].label}</button>
              ))}
            </div>
            {/* Git controls */}
            <div className="flex gap-2 mb-3">
              <button onClick={() => handleViewDiff(selected.id)} className="text-xs px-2 py-1 rounded" style={{ background: theme.bgMuted, color: theme.text }}>Diff</button>
              <button onClick={() => handleGitStage(selected.id)} className="text-xs px-2 py-1 rounded" style={{ background: theme.bgMuted, color: theme.text }}>Stage</button>
              <button onClick={() => { const msg = prompt("Commit message:"); if (msg) handleGitCommit(selected.id, msg, true); }} className="text-xs px-2 py-1 rounded" style={{ background: theme.bgMuted, color: theme.text }}>Commit</button>
              <button onClick={() => handleDelete(selected.id)} className="text-xs px-2 py-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>Delete</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  // ── Diff Modal ──
  function renderDiffModal() {
    if (!diffModal) return null;
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.5)" }}>
        <div className="w-[80vw] h-[80vh] rounded-lg p-4 overflow-auto" style={{ background: theme.bg }}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-bold" style={{ color: theme.text }}>Diff</span>
            <button onClick={() => setDiffModal(null)} className="text-sm px-2 py-1 rounded" style={{ background: theme.bgMuted, color: theme.text }}>Close</button>
          </div>
          <pre className="text-xs overflow-auto" style={{ color: theme.text, opacity: 0.8 }}>{diffModal}</pre>
        </div>
      </div>
    );
  }
}
