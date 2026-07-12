/**
 * IssueTracker — Lightweight issue tracking panel for Coding IDE
 *
 * Features:
 *  - Issue list with filter (status, priority, label, search)
 *  - Issue detail view with edit
 *  - Create new issue
 *  - Import from KNOWN-ISSUES.md
 *  - Stats summary bar
 */
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import API_BASE from "../api";

// ── Types ──
interface Issue {
  id: string;
  title: string;
  status: "open" | "in-progress" | "resolved" | "closed" | "wontfix";
  priority: "critical" | "high" | "medium" | "low";
  labels: string[];
  assignee: string | null;
  description: string;
  reproduction: string;
  solution: string;
  relatedFiles: string[];
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

// ── Status / Priority colors ──
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
  low:      { dot: "#22c55e", label: "Low" },
};

const STATUS_FILTERS = ["all", "open", "in-progress", "resolved", "closed", "wontfix"];

// ── Component ──
export default function IssueTracker({ rootPath, theme, onOpenFile }: Props) {
  const { tt } = useI18n();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<IssueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Issue>>({});

  const basePath = `${API_BASE}/api/coding-issues?path=${encodeURIComponent(rootPath)}`;

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = statusFilter !== "all" ? `&status=${statusFilter}` : "";
      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "";
      const res = await fetch(`${basePath}${statusParam}${searchParam}`);
      const data = await res.json();
      setIssues(data.issues || []);
    } catch (err) {
      console.error("[IssueTracker] fetch error:", err);
    }
    setLoading(false);
  }, [basePath, statusFilter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-issues/stats?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) setStats(await res.json());
    } catch {}
  }, [rootPath]);

  useEffect(() => { fetchIssues(); }, [fetchIssues]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const selected = issues.find(i => i.id === selectedId);

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
      alert("Import failed: " + err.message);
    }
  };

  // ── Start editing ──
  const startEdit = (issue: Issue) => {
    setEditing(true);
    setEditForm({
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
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
      {/* === Left: Issue List === */}
      <div className="w-1/2 flex flex-col border-r" style={{ borderColor: theme.borderLight }}>
        {/* Stats bar */}
        {stats && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap" style={{ background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}` }}>
            <span style={{ color: theme.text, opacity: 0.6 }}>
              {tt("issue.total")}: <b>{stats.total}</b>
            </span>
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.open.bg, color: STATUS_STYLES.open.text }}>
              {tt("issue.open")}: {stats.open}
            </span>
            {stats.inProgress > 0 && (
              <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES["in-progress"].bg, color: STATUS_STYLES["in-progress"].text }}>
                {tt("issue.inProgress")}: {stats.inProgress}
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.resolved.bg, color: STATUS_STYLES.resolved.text }}>
              {tt("issue.resolved")}: {stats.resolved}
            </span>
            {stats.byPriority.critical > 0 && (
              <span className="px-1.5 py-0.5 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>
                🔴 {stats.byPriority.critical} {tt("issue.critical")}
              </span>
            )}
          </div>
        )}

        {/* Filter & search */}
        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded border"
            style={{ borderColor: theme.borderLight, background: theme.bg, color: theme.text }}
          >
            {STATUS_FILTERS.map(s => (
              <option key={s} value={s}>
                {s === "all" ? tt("issue.allStatus") : tt(`issue.${s === "in-progress" ? "inProgress" : s}`) || s}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={tt("issue.searchPlaceholder")}
            className="flex-1 text-xs px-2 py-1 rounded border outline-none"
            style={{ borderColor: theme.borderLight, background: theme.bg, color: theme.text }}
          />
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs px-2 py-1 rounded font-medium"
            style={{ background: theme.accentBg, color: theme.accent }}
          >
            + {tt("issue.new")}
          </button>
          <button
            onClick={handleImport}
            className="text-xs px-2 py-1 rounded"
            style={{ background: theme.bgMuted, color: theme.text }}
            title={tt("issue.importKnown")}
          >
            ⬆️
          </button>
          <button
            onClick={() => { fetchIssues(); fetchStats(); }}
            className="text-xs px-2 py-1 rounded"
            style={{ background: theme.bgMuted, color: theme.text }}
            title={tt("issue.refresh")}
          >
            🔄
          </button>
        </div>

        {/* Issue list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              {tt("issue.loading")}
            </div>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-sm" style={{ color: theme.text, opacity: 0.4 }}>
              <div className="text-3xl">📋</div>
              <div>{tt("issue.empty")}</div>
            </div>
          ) : (
            issues.map(issue => {
              const st = STATUS_STYLES[issue.status] || STATUS_STYLES.open;
              const pr = PRIORITY_STYLES[issue.priority] || PRIORITY_STYLES.medium;
              const isSelected = issue.id === selectedId;
              return (
                <div
                  key={issue.id}
                  onClick={() => { setSelectedId(issue.id); setEditing(false); }}
                  className="px-3 py-2.5 cursor-pointer border-b transition-colors"
                  style={{
                    borderColor: theme.borderLight,
                    background: isSelected ? theme.accentBg : "transparent",
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.bgMuted; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="flex items-start gap-2">
                    {/* Priority dot */}
                    <div className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: pr.dot }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-mono shrink-0" style={{ color: theme.text, opacity: 0.5 }}>{issue.id}</span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: st.bg, color: st.text }}
                        >
                          {st.label}
                        </span>
                      </div>
                      <div className="text-sm font-medium truncate" style={{ color: theme.text }}>
                        {issue.title}
                      </div>
                      {issue.labels.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {issue.labels.map(l => (
                            <span key={l} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text, opacity: 0.7 }}>
                              {l}
                            </span>
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

      {/* === Right: Detail / Create === */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showCreate ? (
          <IssueForm
            mode="create"
            form={{ status: "open", priority: "medium", labels: [], title: "", description: "", reproduction: "", solution: "" }}
            onChange={setEditForm}
            onSubmit={() => handleCreate(editForm)}
            onCancel={() => setShowCreate(false)}
            theme={theme}
            tt={tt}
          />
        ) : !selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: theme.text, opacity: 0.4 }}>
            <div className="text-4xl">🐛</div>
            <div className="text-sm">{tt("issue.selectPrompt")}</div>
          </div>
        ) : editing ? (
          <IssueForm
            mode="edit"
            form={editForm}
            onChange={setEditForm}
            onSubmit={() => handleUpdate(selected.id, editForm)}
            onCancel={() => setEditing(false)}
            theme={theme}
            tt={tt}
          />
        ) : (
          <IssueDetail
            issue={selected}
            theme={theme}
            tt={tt}
            onEdit={() => startEdit(selected)}
            onDelete={() => handleDelete(selected.id)}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    </div>
  );
}

// ── Issue Detail View ──
function IssueDetail({ issue, theme, tt, onEdit, onDelete, onOpenFile }: {
  issue: Issue;
  theme: any;
  tt: (k: string) => string;
  onEdit: () => void;
  onDelete: () => void;
  onOpenFile?: (p: string) => void;
}) {
  const st = STATUS_STYLES[issue.status] || STATUS_STYLES.open;
  const pr = PRIORITY_STYLES[issue.priority] || PRIORITY_STYLES.medium;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono" style={{ color: theme.text, opacity: 0.5 }}>{issue.id}</span>
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: st.bg, color: st.text }}>{st.label}</span>
            <span className="text-[10px] px-2 py-0.5 rounded inline-flex items-center gap-1" style={{ background: theme.bgMuted, color: theme.text }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: pr.dot }} />
              {pr.label}
            </span>
          </div>
          <h2 className="text-lg font-bold" style={{ color: theme.text }}>{issue.title}</h2>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={onEdit} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>
            ✏️ {tt("issue.edit")}
          </button>
          <button onClick={onDelete} className="text-xs px-2 py-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>
            🗑️
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="flex gap-4 text-xs mb-4" style={{ color: theme.text, opacity: 0.5 }}>
        <span>📅 {tt("issue.created")}: {new Date(issue.createdAt).toLocaleString()}</span>
        <span>🔄 {tt("issue.updated")}: {new Date(issue.updatedAt).toLocaleString()}</span>
        {issue.resolvedAt && <span>✅ {tt("issue.resolved")}: {new Date(issue.resolvedAt).toLocaleString()}</span>}
      </div>

      {/* Labels */}
      {issue.labels.length > 0 && (
        <div className="flex gap-1 mb-4 flex-wrap">
          {issue.labels.map(l => (
            <span key={l} className="text-xs px-2 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>
              🏷️ {l}
            </span>
          ))}
        </div>
      )}

      {/* Description */}
      {issue.description && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{tt("issue.description")}</h3>
          <p className="text-sm" style={{ color: theme.text }}>{issue.description}</p>
        </div>
      )}

      {/* Reproduction */}
      {issue.reproduction && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{tt("issue.reproduction")}</h3>
          <pre className="text-sm p-2 rounded whitespace-pre-wrap" style={{ background: theme.bgMuted, color: theme.text }}>{issue.reproduction}</pre>
        </div>
      )}

      {/* Solution */}
      {issue.solution && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{tt("issue.solution")}</h3>
          <p className="text-sm" style={{ color: theme.text }}>{issue.solution}</p>
        </div>
      )}

      {/* Related files */}
      {issue.relatedFiles.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase mb-1" style={{ color: theme.text, opacity: 0.5 }}>{tt("issue.relatedFiles")}</h3>
          <div className="flex flex-col gap-1">
            {issue.relatedFiles.map(f => (
              <button
                key={f}
                onClick={() => onOpenFile?.(f)}
                className="text-sm text-left px-2 py-1 rounded font-mono hover:underline"
                style={{ background: theme.bgMuted, color: theme.accent }}
              >
                📄 {f}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Issue Form (create / edit) ──
function IssueForm({ mode, form, onChange, onSubmit, onCancel, theme, tt }: {
  mode: "create" | "edit";
  form: Partial<Issue>;
  onChange: (f: Partial<Issue>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  theme: any;
  tt: (k: string) => string;
}) {
  const set = (key: string, val: any) => onChange({ ...form, [key]: val });

  const inputStyle = {
    background: theme.bg,
    color: theme.text,
    borderColor: theme.borderLight,
  } as React.CSSProperties;

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      <h2 className="text-lg font-bold" style={{ color: theme.text }}>
        {mode === "create" ? tt("issue.newTitle") : tt("issue.editTitle")}
      </h2>

      {/* Title */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{tt("issue.titleLabel")}</label>
        <input
          type="text"
          value={form.title || ""}
          onChange={e => set("title", e.target.value)}
          className="w-full text-sm px-2 py-1.5 rounded border outline-none"
          style={inputStyle}
          placeholder={tt("issue.titlePlaceholder")}
        />
      </div>

      {/* Status & Priority */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{tt("issue.statusLabel")}</label>
          <select
            value={form.status || "open"}
            onChange={e => set("status", e.target.value)}
            className="w-full text-sm px-2 py-1.5 rounded border"
            style={inputStyle}
          >
            <option value="open">{tt("issue.open")}</option>
            <option value="in-progress">{tt("issue.inProgress")}</option>
            <option value="resolved">{tt("issue.resolved")}</option>
            <option value="closed">{tt("issue.closed")}</option>
            <option value="wontfix">{tt("issue.wontfix")}</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{tt("issue.priorityLabel")}</label>
          <select
            value={form.priority || "medium"}
            onChange={e => set("priority", e.target.value)}
            className="w-full text-sm px-2 py-1.5 rounded border"
            style={inputStyle}
          >
            <option value="critical">{tt("issue.critical")}</option>
            <option value="high">{tt("issue.high")}</option>
            <option value="medium">{tt("issue.medium")}</option>
            <option value="low">{tt("issue.low")}</option>
          </select>
        </div>
      </div>

      {/* Labels */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{tt("issue.labelsLabel")}</label>
        <input
          type="text"
          value={(form.labels || []).join(", ")}
          onChange={e => set("labels", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
          className="w-full text-sm px-2 py-1.5 rounded border outline-none"
          style={inputStyle}
          placeholder={tt("issue.labelsPlaceholder")}
        />
      </div>

      {/* Description */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{tt("issue.description")}</label>
        <textarea
          value={form.description || ""}
          onChange={e => set("description", e.target.value)}
          rows={3}
          className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y"
          style={inputStyle}
        />
      </div>

      {/* Reproduction */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{tt("issue.reproduction")}</label>
        <textarea
          value={form.reproduction || ""}
          onChange={e => set("reproduction", e.target.value)}
          rows={3}
          className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y font-mono"
          style={inputStyle}
        />
      </div>

      {/* Solution */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{tt("issue.solution")}</label>
        <textarea
          value={form.solution || ""}
          onChange={e => set("solution", e.target.value)}
          rows={2}
          className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y"
          style={inputStyle}
        />
      </div>

      {/* Related files */}
      <div>
        <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{tt("issue.relatedFiles")}</label>
        <input
          type="text"
          value={(form.relatedFiles || []).join(", ")}
          onChange={e => set("relatedFiles", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
          className="w-full text-sm px-2 py-1.5 rounded border outline-none"
          style={inputStyle}
          placeholder={tt("issue.relatedFilesPlaceholder")}
        />
      </div>

      {/* Buttons */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={onSubmit}
          className="text-sm px-4 py-1.5 rounded font-medium"
          style={{ background: theme.accentBg, color: theme.accent }}
        >
          ✅ {mode === "create" ? tt("issue.create") : tt("issue.save")}
        </button>
        <button
          onClick={onCancel}
          className="text-sm px-4 py-1.5 rounded"
          style={{ background: theme.bgMuted, color: theme.text }}
        >
          {tt("issue.cancel")}
        </button>
      </div>
    </div>
  );
}
