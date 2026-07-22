/**
 * IssueTracker — Task management panel for Coding IDE
 *
 * Features:
 *  - Task list with filter (status, type, search)
 *  - Task detail view with edit
 *  - Create new task
 *  - Decompose task into sub-tasks
 *  - Parent/child navigation
 *  - Add notes (discussion log)
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
  parentId: string | null;
  type: "requirement" | "bug" | "security" | "chore";
  status: "open" | "in-progress" | "resolved" | "closed" | "wontfix";
  priority: "critical" | "high" | "medium" | "low";
  effort: "S" | "M" | "L" | "XL" | null;
  labels: string[];
  assignee: string | null;
  description: string;
  reproduction: string;
  solution: string;
  relatedFiles: string[];
  notes: { by: string; at: string; content: string }[];
  executionResult: { summary: string; filesChanged: string[]; success: boolean } | null;
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
  byType: { requirement: number; bug: number; security: number; chore: number };
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
  onOpenFile?: (path: string) => void;
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

const EFFORT_STYLES: Record<string, { label: string; color: string }> = {
  S:  { label: "S", color: "#22c55e" },
  M:  { label: "M", color: "#3b82f6" },
  L:  { label: "L", color: "#f59e0b" },
  XL: { label: "XL", color: "#dc2626" },
};

const STATUS_FILTERS = ["all", "open", "in-progress", "resolved", "closed", "wontfix"];
const TYPE_FILTERS = ["all", "requirement", "bug", "security", "chore"];

// ── Component ──
export default function IssueTracker({ rootPath, theme, onOpenFile }: Props) {
  const { t } = useI18n();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<IssueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showDecompose, setShowDecompose] = useState(false);
  const [decomposeForm, setDecomposeForm] = useState<{ title: string; type: string; effort: string; assignee: string; description: string }[]>([
    { title: "", type: "", effort: "S", assignee: "", description: "" },
  ]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Issue>>({ type: "requirement" });
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
    } catch (err) {
      console.error("[IssueTracker] fetch error:", err);
    }
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
  // Get child tasks for selected parent
  const childTasks = issues.filter(i => i.parentId === selectedId);
  // Get parent task if selected is a child
  const parentTask = selected?.parentId ? issues.find(i => i.id === selected.parentId) : null;

  // ── Navigate to a task (by id, may need to load if filtered out) ──
  const navigateToTask = (id: string) => {
    // If the task is in current list, just select it
    if (issues.find(i => i.id === id)) {
      setSelectedId(id);
      setEditing(false);
      return;
    }
    // Otherwise clear filters and select
    setStatusFilter("all");
    setTypeFilter("all");
    setSearchQuery("");
    setSelectedId(id);
    setEditing(false);
  };

  // ── Create issue ──
  const handleCreate = async (form: Partial<Issue>) => {
    try {
      const res = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowCreate(false);
        await fetchIssues();
        await fetchStats();
      }
    } catch (err) {
      console.error("[IssueTracker] create error:", err);
    }
  };

  // ── Update issue ──
  const handleUpdate = async (id: string, patch: Partial<Issue>) => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-issues/${id}?path=${encodeURIComponent(rootPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        await fetchIssues();
        await fetchStats();
        setEditing(false);
      }
    } catch (err) {
      console.error("[IssueTracker] update error:", err);
    }
  };

  // ── Delete issue ──
  const handleDelete = async (id: string) => {
    if (!confirm(`Delete ${id}?`)) return;
    try {
      await fetch(`${API_BASE}/api/coding-issues/${id}?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" });
      setSelectedId(null);
      await fetchIssues();
      await fetchStats();
    } catch (err) {
      console.error("[IssueTracker] delete error:", err);
    }
  };

  // ── Decompose task ──
  const handleDecompose = async () => {
    if (!selectedId) return;
    const validSubs = decomposeForm.filter(s => s.title.trim());
    if (validSubs.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-issues/decompose?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId: selectedId,
          subTasks: validSubs.map(s => ({
            title: s.title.trim(),
            type: s.type || undefined,
            effort: s.effort || undefined,
            assignee: s.assignee || undefined,
            description: s.description || undefined,
          })),
          createdBy: "human",
        }),
      });
      const data = await res.json();
      if (data.subTasks) {
        setShowDecompose(false);
        setDecomposeForm([{ title: "", type: "", effort: "S", assignee: "", description: "" }]);
        await fetchIssues();
        await fetchStats();
      } else {
        alert(`Decompose failed: ${data.error || "unknown"}`);
      }
    } catch (err) {
      alert("Decompose failed: " + (err as Error).message);
    }
  };

  // ── Add note ──
  const handleAddNote = async () => {
    if (!selectedId || !noteInput.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-issues/${selectedId}/notes?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteInput.trim(), by: "human" }),
      });
      if (res.ok) {
        setNoteInput("");
        await fetchIssues();
      }
    } catch (err) {
      console.error("[IssueTracker] add note error:", err);
    }
  };

  // ── Import from KNOWN-ISSUES.md ──
  const handleImport = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-issues/import-known?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
      const data = await res.json();
      if (data.imported > 0) {
        alert(`✅ Imported ${data.imported} issues from KNOWN-ISSUES.md`);
      } else {
        alert(`No new issues to import (total: ${data.total})`);
      }
      await fetchIssues();
      await fetchStats();
    } catch (err) {
      alert("Import failed: " + (err as Error).message);
    }
  };

  // ── Start editing ──
  const startEdit = (issue: Issue) => {
    setEditing(true);
    setEditForm({
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      type: issue.type,
      effort: issue.effort,
      labels: issue.labels,
      description: issue.description,
      reproduction: issue.reproduction,
      solution: issue.solution,
      assignee: issue.assignee,
    });
  };

  // ── Render ──
  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* === Left: Task List === */}
      <div className="w-1/2 flex flex-col border-r" style={{ borderColor: theme.borderLight }}>
        {/* Stats bar */}
        {stats && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap" style={{ background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}` }}>
            <span style={{ color: theme.text, opacity: 0.6 }}>
              {t("issue.total")}: <b>{stats.total}</b>
            </span>
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.open.bg, color: STATUS_STYLES.open.text }}>
              {t("issue.open")}: {stats.open}
            </span>
            {stats.inProgress > 0 && (
              <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES["in-progress"].bg, color: STATUS_STYLES["in-progress"].text }}>
                {t("issue.inProgress")}: {stats.inProgress}
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.resolved.bg, color: STATUS_STYLES.resolved.text }}>
              {t("issue.resolved")}: {stats.resolved}
            </span>
            {stats.byType && Object.entries(stats.byType).filter(([, v]) => v > 0).map(([k, v]) => {
              const ts = TYPE_STYLES[k];
              return ts ? (
                <span key={k} className="px-1.5 py-0.5 rounded" style={{ background: ts.bg, color: ts.text }}>
                  {ts.icon} {v}
                </span>
              ) : null;
            })}
            {stats.byPriority.critical > 0 && (
              <span className="px-1.5 py-0.5 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>
                🔴 {stats.byPriority.critical} {t("issue.critical")}
              </span>
            )}
          </div>
        )}

        {/* Filter & search */}
        <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-xs px-1.5 py-1 rounded border"
            style={{ borderColor: theme.borderLight, background: theme.bg, color: theme.text }}
          >
            {STATUS_FILTERS.map(s => (
              <option key={s} value={s}>
                {s === "all" ? t("issue.allStatus") : t(`issue.${s === "in-progress" ? "inProgress" : s}`) || s}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="text-xs px-1.5 py-1 rounded border"
            style={{ borderColor: theme.borderLight, background: theme.bg, color: theme.text }}
          >
            {TYPE_FILTERS.map(s => {
              const ts = TYPE_STYLES[s];
              return (
                <option key={s} value={s}>
                  {s === "all" ? "All Types" : ts ? `${ts.icon} ${ts.label}` : s}
                </option>
              );
            })}
          </select>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t("issue.searchPlaceholder")}
            className="flex-1 text-xs px-2 py-1 rounded border outline-none min-w-0"
            style={{ borderColor: theme.borderLight, background: theme.bg, color: theme.text }}
          />
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs px-2 py-1 rounded font-medium shrink-0"
            style={{ background: theme.accentBg, color: theme.accent }}
          >
            + {t("issue.new")}
          </button>
          <button
            onClick={handleImport}
            className="text-xs px-1.5 py-1 rounded shrink-0"
            style={{ background: theme.bgMuted, color: theme.text }}
            title={t("issue.importKnown")}
          >
            ⬆️
          </button>
          <button
            onClick={() => { fetchIssues(); fetchStats(); }}
            className="text-xs px-1.5 py-1 rounded shrink-0"
            style={{ background: theme.bgMuted, color: theme.text }}
            title={t("issue.refresh")}
          >
            🔄
          </button>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              {t("issue.loading")}
            </div>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              <div className="text-3xl">📋</div>
              <div>{t("issue.empty")}</div>
            </div>
          ) : (
            issues.map(issue => {
              const st = STATUS_STYLES[issue.status] || STATUS_STYLES.open;
              const pr = PRIORITY_STYLES[issue.priority] || PRIORITY_STYLES.medium;
              const ty = TYPE_STYLES[issue.type] || TYPE_STYLES.requirement;
              const isSelected = issue.id === selectedId;
              const isChild = !!issue.parentId;
              return (
                <div
                  key={issue.id}
                  onClick={() => { setSelectedId(issue.id); setEditing(false); setShowDecompose(false); }}
                  className="px-3 py-2.5 cursor-pointer border-b transition-colors"
                  style={{
                    borderColor: theme.borderLight,
                    background: isSelected ? theme.accentBg : "transparent",
                    paddingLeft: isChild ? "2rem" : undefined,
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-1 shrink-0 flex items-center gap-1">
                      <span className="text-xs">{isChild ? "↳" : ty.icon}</span>
                      {!isChild && <div className="w-2 h-2 rounded-full" style={{ background: pr.dot }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-xs font-mono shrink-0" style={{ color: theme.text, opacity: 0.5 }}>{issue.id}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: ty.bg, color: ty.text }}>{ty.label}</span>
                        {issue.effort && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-bold" style={{ background: EFFORT_STYLES[issue.effort]?.color + "20", color: EFFORT_STYLES[issue.effort]?.color }}>
                            {issue.effort}
                          </span>
                        )}
                        {issue.executionResult && (
                          <span className="text-[10px] shrink-0">{issue.executionResult.success ? "⚡✅" : "⚡❌"}</span>
                        )}
                      </div>
                      <div className="text-sm font-medium truncate" style={{ color: theme.text }}>{issue.title}</div>
                      {issue.labels.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {issue.labels.map(l => (
                            <span key={l} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text, opacity: 0.7 }}>{l}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* === Right: Detail / Create / Decompose === */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showCreate ? (
          <IssueForm
            mode="create"
            form={{ status: "open", priority: "medium", type: "requirement", labels: [], title: "", description: "", reproduction: "", solution: "" }}
            onChange={setEditForm}
            onSubmit={() => handleCreate(editForm)}
            onCancel={() => setShowCreate(false)}
            theme={theme}
            t={t}
          />
        ) : showDecompose && selected ? (
          <DecomposeForm
            parent={selected}
            subs={decomposeForm}
            onChange={setDecomposeForm}
            onSubmit={handleDecompose}
            onCancel={() => { setShowDecompose(false); setDecomposeForm([{ title: "", type: "", effort: "S", assignee: "", description: "" }]); }}
            theme={theme}
            t={t}
          />
        ) : !selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">📋</div>
            <div className="text-sm">{t("issue.selectPrompt")}</div>
          </div>
        ) : editing ? (
          <IssueForm
            mode="edit"
            form={editForm}
            onChange={setEditForm}
            onSubmit={() => handleUpdate(selected.id, editForm)}
            onCancel={() => setEditing(false)}
            theme={theme}
            t={t}
          />
        ) : (
          <TaskDetail
            issue={selected}
            childTasks={childTasks}
            parentTask={parentTask || null}
            theme={theme}
            t={t}
            noteInput={noteInput}
            onNoteInputChange={setNoteInput}
            onAddNote={handleAddNote}
            onEdit={() => startEdit(selected)}
            onDelete={() => handleDelete(selected.id)}
            onDecompose={() => setShowDecompose(true)}
            onNavigate={navigateToTask}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    </div>
  );
}

// ── Task Detail View ──
function TaskDetail({ issue, childTasks, parentTask, theme, t, noteInput, onNoteInputChange, onAddNote, onEdit, onDelete, onDecompose, onNavigate, onOpenFile }: {
  issue: Issue;
  childTasks: Issue[];
  parentTask: Issue | null;
  theme: any;
  t: (k: string) => string;
  noteInput: string;
  onNoteInputChange: (v: string) => void;
  onAddNote: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDecompose: () => void;
  onNavigate: (id: string) => void;
  onOpenFile?: (p: string) => void;
}) {
  const st = STATUS_STYLES[issue.status] || STATUS_STYLES.open;
  const pr = PRIORITY_STYLES[issue.priority] || PRIORITY_STYLES.medium;
  const ty = TYPE_STYLES[issue.type] || TYPE_STYLES.requirement;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-mono" style={{ color: theme.text, opacity: 0.5 }}>{issue.id}</span>
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: st.bg, color: st.text }}>{st.label}</span>
            <span className="text-[10px] px-2 py-0.5 rounded inline-flex items-center gap-1" style={{ background: theme.bgMuted, color: theme.text }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: pr.dot }} /> {pr.label}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: ty.bg, color: ty.text }}>{ty.icon} {ty.label}</span>
            {issue.effort && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: (EFFORT_STYLES[issue.effort] || EFFORT_STYLES.M).color + "20", color: (EFFORT_STYLES[issue.effort] || EFFORT_STYLES.M).color }}>
                Effort: {issue.effort}
              </span>
            )}
            {issue.assignee && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>👤 {issue.assignee}</span>
            )}
            {issue.executionResult && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#1e1b4b", color: "#c4b5fd" }}>
                ⚡ {issue.executionResult.success ? "✅" : "❌"}
              </span>
            )}
          </div>
          <h2 className="text-lg font-bold" style={{ color: theme.text }}>{issue.title}</h2>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={onDecompose} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }} title="✂️ Decompose into sub-tasks">
            ✂️ {t("issue.decompose") || "Split"}
          </button>
          <button onClick={onEdit} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>
            ✏️ {t("issue.edit")}
          </button>
          <button onClick={onDelete} className="text-xs px-2 py-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>
            🗑️
          </button>
        </div>
      </div>

      {/* Parent task link */}
      {parentTask && (
        <div className="mb-3 p-2 rounded flex items-center gap-2" style={{ background: theme.bgMuted }}>
          <span className="text-xs" style={{ opacity: 0.6 }}>⬆️ Parent:</span>
          <button onClick={() => onNavigate(parentTask.id)} className="text-xs font-mono px-1.5 py-0.5 rounded hover:underline" style={{ color: theme.accent }}>
            {parentTask.id}: {parentTask.title}
          </button>
        </div>
      )}

      {/* Child tasks */}
      {childTasks.length > 0 && (
        <div className="mb-3">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>📌 Sub-tasks ({childTasks.length})</h3>
          <div className="flex flex-col gap-1">
            {childTasks.map(child => {
              const cst = STATUS_STYLES[child.status] || STATUS_STYLES.open;
              const cty = TYPE_STYLES[child.type] || TYPE_STYLES.requirement;
              return (
                <button
                  key={child.id}
                  onClick={() => onNavigate(child.id)}
                  className="flex items-center gap-2 text-xs text-left px-2 py-1.5 rounded hover:underline"
                  style={{ background: theme.bgMuted, color: theme.text }}
                >
                  <span className="font-mono shrink-0" style={{ opacity: 0.5 }}>{child.id}</span>
                  <span className="text-[10px] px-1 py-0.5 rounded shrink-0" style={{ background: cst.bg, color: cst.text }}>{cst.label}</span>
                  <span className="truncate flex-1">{child.title}</span>
                  {child.effort && <span className="shrink-0 font-bold" style={{ color: (EFFORT_STYLES[child.effort] || EFFORT_STYLES.S).color }}>{child.effort}</span>}
                  {child.executionResult && <span className="shrink-0">{child.executionResult.success ? "⚡✅" : "⚡❌"}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="flex gap-4 text-xs mb-4" style={{ color: theme.text, opacity: 0.5 }}>
        <span>📅 {t("issue.created")}: {new Date(issue.createdAt).toLocaleString()}</span>
        <span>🔄 {t("issue.updated")}: {new Date(issue.updatedAt).toLocaleString()}</span>
        {issue.resolvedAt && <span>✅ {t("issue.resolved")}: {new Date(issue.resolvedAt).toLocaleString()}</span>}
      </div>

      {/* Labels */}
      {Array.isArray(issue.labels) && issue.labels.length > 0 && (
        <div className="flex gap-1 mb-4 flex-wrap">
          {issue.labels.map(l => (
            <span key={l} className="text-xs px-2 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>🏷️ {l}</span>
          ))}
        </div>
      )}

      {/* Description */}
      {issue.description && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{t("issue.description")}</h3>
          <div style={{ color: theme.text }}><MarkdownText>{issue.description}</MarkdownText></div>
        </div>
      )}

      {/* Reproduction */}
      {issue.reproduction && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{t("issue.reproduction")}</h3>
          <div className="p-2 rounded" style={{ background: theme.bgMuted }}><MarkdownText>{issue.reproduction}</MarkdownText></div>
        </div>
      )}

      {/* Solution */}
      {issue.solution && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{t("issue.solution")}</h3>
          <div style={{ color: theme.text }}><MarkdownText>{issue.solution}</MarkdownText></div>
        </div>
      )}

      {/* Related files */}
      {Array.isArray(issue.relatedFiles) && issue.relatedFiles.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{t("issue.relatedFiles")}</h3>
          <div className="flex flex-col gap-1">
            {issue.relatedFiles.map(f => (
              <button key={f} onClick={() => onOpenFile?.(f)} className="text-sm text-left px-2 py-1 rounded font-mono hover:underline" style={{ background: theme.bgMuted, color: theme.accent }}>
                📄 {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Execution Result */}
      {issue.executionResult && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>⚡ {t("issue.executionResult")}</h3>
          <div className="p-2 rounded" style={{ background: "#1e1b4b", color: "#c4b5fd" }}>
            <div className="text-sm">{issue.executionResult.success ? "✅" : "❌"} {issue.executionResult.summary}</div>
            {issue.executionResult.filesChanged?.length > 0 && (
              <div className="mt-1 text-xs" style={{ opacity: 0.8 }}>Files: {issue.executionResult.filesChanged.join(", ")}</div>
            )}
          </div>
        </div>
      )}

      {/* Notes (discussion log) + Add note */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{t("issue.notes")}</h3>
        {Array.isArray(issue.notes) && issue.notes.length > 0 && (
          <div className="flex flex-col gap-2 mb-2">
            {issue.notes.map((note, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-xs shrink-0" title={new Date(note.at).toLocaleString()}>
                  {note.by === "agent" || note.by === "em" ? "🤖" : "👤"}
                </span>
                <div className="text-sm flex-1" style={{ color: theme.text }}>
                  <MarkdownText>{note.content}</MarkdownText>
                  <div className="text-[10px] mt-0.5" style={{ opacity: 0.4 }}>{new Date(note.at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Add note input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={noteInput}
            onChange={e => onNoteInputChange(e.target.value)}
            placeholder="Add a note..."
            className="flex-1 text-xs px-2 py-1.5 rounded border outline-none"
            style={{ borderColor: theme.borderLight, background: theme.bg, color: theme.text }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && noteInput.trim()) { e.preventDefault(); onAddNote(); } }}
          />
          <button
            onClick={onAddNote}
            disabled={!noteInput.trim()}
            className="text-xs px-2 py-1 rounded font-medium shrink-0"
            style={{ background: noteInput.trim() ? theme.accentBg : theme.bgMuted, color: noteInput.trim() ? theme.accent : theme.text, opacity: noteInput.trim() ? 1 : 0.5 }}
          >
            💬
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Decompose Form ──
function DecomposeForm({ parent, subs, onChange, onSubmit, onCancel, theme, t }: {
  parent: Issue;
  subs: { title: string; type: string; effort: string; assignee: string; description: string }[];
  onChange: (subs: { title: string; type: string; effort: string; assignee: string; description: string }[]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  theme: any;
  t: (k: string) => string;
}) {
  const updateSub = (idx: number, key: string, val: string) => {
    const next = [...subs];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  };

  const addSubRow = () => {
    onChange([...subs, { title: "", type: "", effort: "S", assignee: "", description: "" }]);
  };

  const removeSubRow = (idx: number) => {
    if (subs.length <= 1) return;
    onChange(subs.filter((_, i) => i !== idx));
  };

  const inputStyle = { background: theme.bg, color: theme.text, borderColor: theme.borderLight } as React.CSSProperties;

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      <h2 className="text-lg font-bold" style={{ color: theme.text }}>✂️ {t("issue.decomposeTitle") || "Decompose Task"}</h2>
      <div className="text-sm" style={{ color: theme.text, opacity: 0.6 }}>
        Split <b>{parent.id}: {parent.title}</b> into smaller sub-tasks
      </div>

      {/* Sub-task rows */}
      {subs.map((sub, idx) => (
        <div key={idx} className="p-3 rounded border" style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold" style={{ color: theme.text, opacity: 0.5 }}>Sub-task {idx + 1}</span>
            {subs.length > 1 && (
              <button onClick={() => removeSubRow(idx)} className="text-xs px-1 rounded" style={{ color: "#dc2626" }}>✕</button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={sub.title}
              onChange={e => updateSub(idx, "title", e.target.value)}
              placeholder="Sub-task title (e.g. 修 XSS in handleSubmit)"
              className="w-full text-sm px-2 py-1.5 rounded border outline-none"
              style={inputStyle}
            />
            <div className="flex gap-2">
              <select
                value={sub.type}
                onChange={e => updateSub(idx, "type", e.target.value)}
                className="text-xs px-1.5 py-1 rounded border"
                style={inputStyle}
              >
                <option value="">Same as parent</option>
                <option value="requirement">📋 Requirement</option>
                <option value="bug">🐛 Bug</option>
                <option value="security">🔒 Security</option>
                <option value="chore">🔧 Chore</option>
              </select>
              <select
                value={sub.effort}
                onChange={e => updateSub(idx, "effort", e.target.value)}
                className="text-xs px-1.5 py-1 rounded border"
                style={inputStyle}
              >
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
              </select>
              <input
                type="text"
                value={sub.assignee}
                onChange={e => updateSub(idx, "assignee", e.target.value)}
                placeholder="Assignee"
                className="text-xs px-1.5 py-1 rounded border outline-none flex-1"
                style={inputStyle}
              />
            </div>
            <input
              type="text"
              value={sub.description}
              onChange={e => updateSub(idx, "description", e.target.value)}
              placeholder="Description (optional)"
              className="text-xs px-2 py-1 rounded border outline-none"
              style={inputStyle}
            />
          </div>
        </div>
      ))}

      <button onClick={addSubRow} className="text-xs px-2 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>
        + Add sub-task
      </button>

      {/* Buttons */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={onSubmit}
          disabled={!subs.some(s => s.title.trim())}
          className="text-sm px-4 py-1.5 rounded font-medium"
          style={{ background: theme.accentBg, color: theme.accent, opacity: subs.some(s => s.title.trim()) ? 1 : 0.5 }}
        >
          ✂️ {t("issue.decompose") || "Split"}
        </button>
        <button
          onClick={onCancel}
          className="text-sm px-4 py-1.5 rounded"
          style={{ background: theme.bgMuted, color: theme.text }}
        >
          {t("issue.cancel")}
        </button>
      </div>
    </div>
  );
}

// ── Issue Form (create / edit) ──
function IssueForm({ mode, form, onChange, onSubmit, onCancel, theme, t }: {
  mode: "create" | "edit";
  form: Partial<Issue>;
  onChange: (f: Partial<Issue>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  theme: any;
  t: (k: string) => string;
}) {
  const set = (key: string, val: any) => onChange({ ...form, [key]: val });

  const inputStyle = { background: theme.bg, color: theme.text, borderColor: theme.borderLight } as React.CSSProperties;

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      <h2 className="text-lg font-bold" style={{ color: theme.text }}>
        {mode === "create" ? t("issue.newTitle") : t("issue.editTitle")}
      </h2>

      {/* Title */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.titleLabel")}</label>
        <input type="text" value={form.title || ""} onChange={e => set("title", e.target.value)} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} placeholder={t("issue.titlePlaceholder")} />
      </div>

      {/* Type & Effort */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.typeLabel")}</label>
          <select value={form.type || "requirement"} onChange={e => set("type", e.target.value)} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
            <option value="requirement">📋 Requirement</option>
            <option value="bug">🐛 Bug</option>
            <option value="security">🔒 Security</option>
            <option value="chore">🔧 Chore</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.effortLabel")}</label>
          <select value={form.effort || ""} onChange={e => set("effort", e.target.value || null)} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
            <option value="">—</option>
            <option value="S">S (Small)</option>
            <option value="M">M (Medium)</option>
            <option value="L">L (Large)</option>
            <option value="XL">XL (Extra Large)</option>
          </select>
        </div>
      </div>

      {/* Status & Priority */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.statusLabel")}</label>
          <select value={form.status || "open"} onChange={e => set("status", e.target.value)} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
            <option value="open">{t("issue.open")}</option>
            <option value="in-progress">{t("issue.inProgress")}</option>
            <option value="resolved">{t("issue.resolved")}</option>
            <option value="closed">{t("issue.closed")}</option>
            <option value="wontfix">{t("issue.wontfix")}</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.priorityLabel")}</label>
          <select value={form.priority || "medium"} onChange={e => set("priority", e.target.value)} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
            <option value="critical">{t("issue.critical")}</option>
            <option value="high">{t("issue.high")}</option>
            <option value="medium">{t("issue.medium")}</option>
            <option value="low">{t("issue.low")}</option>
          </select>
        </div>
      </div>

      {/* Assignee */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>Assignee</label>
        <input type="text" value={form.assignee || ""} onChange={e => set("assignee", e.target.value)} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} placeholder="e.g. em, developer, tester" />
      </div>

      {/* Labels */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.labelsLabel")}</label>
        <input type="text" value={(form.labels || []).join(", ")} onChange={e => set("labels", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} placeholder={t("issue.labelsPlaceholder")} />
      </div>

      {/* Description */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.description")}</label>
        <textarea value={form.description || ""} onChange={e => set("description", e.target.value)} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y" style={inputStyle} />
      </div>

      {/* Reproduction */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.reproduction")}</label>
        <textarea value={form.reproduction || ""} onChange={e => set("reproduction", e.target.value)} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y font-mono" style={inputStyle} />
      </div>

      {/* Solution */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.solution")}</label>
        <textarea value={form.solution || ""} onChange={e => set("solution", e.target.value)} rows={2} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y" style={inputStyle} />
      </div>

      {/* Related files */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("issue.relatedFiles")}</label>
        <input type="text" value={(form.relatedFiles || []).join(", ")} onChange={e => set("relatedFiles", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} placeholder={t("issue.relatedFilesPlaceholder")} />
      </div>

      {/* Buttons */}
      <div className="flex gap-2 mt-2">
        <button onClick={onSubmit} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent }}>
          ✅ {mode === "create" ? t("issue.create") : t("issue.save")}
        </button>
        <button onClick={onCancel} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>
          {t("issue.cancel")}
        </button>
      </div>
    </div>
  );
}
