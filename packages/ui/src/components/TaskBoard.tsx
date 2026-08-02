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
interface PipelinePhase {
  status: string; // pending | in_progress | done | rejected | blocked
  by?: string;
  at?: string;
  assignTo?: string; // human | ai_overnight
}

interface TaskSource {
  type: string; // vibe | discussion | pm | issue | security | manual
  sessionId?: string;
  issueId?: string;
  note?: string;
}

interface TaskChanges {
  filesAdded: string[];
  filesModified: string[];
  filesDeleted: string[];
  diffStat?: string;
}

interface TaskSpec {
  description: string;
  acceptanceCriteria: string[];
  fileScope: string[];
  outOfScope: string[];
}

interface TestResult {
  testsWritten: string[];
  passed: number;
  failed: number;
  coverage?: string;
  coverageGaps?: string[];
}

interface QaResult {
  autoChecks: Array<{ rule: string; passed: boolean; detail?: string }>;
  manualChecks?: Array<{ label: string; checked: boolean }>;
  overall: string;
}

interface DocsResult {
  files: Array<{ path: string; action: string }>;
  generatedAt: string;
}

interface TaskGit {
  baseCommit: string;
  branch: string | null;
  staged: boolean;
  committedSha: string | null;
}

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
  // New pipeline fields (all optional for backward compat)
  pipeline?: Record<string, PipelinePhase>;
  source?: TaskSource;
  changes?: TaskChanges;
  spec?: TaskSpec;
  testResult?: TestResult;
  qaResult?: QaResult;
  docsResult?: DocsResult;
  git?: TaskGit;
  discussion?: Array<{ summary: string; at: string }>;
}

interface TaskStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  byAssignee: Record<string, { total: number; open: number; resolved: number }>;
}

interface PipelineOverview {
  phases: Record<string, { count: number; taskIds: string[] }>;
  total: number;
}

interface OvernightResult {
  taskId: string;
  taskTitle: string;
  phase: string;
  status: string; // passed | failed | partial
  summary?: string;
  errors?: string[];
  duration?: string;
}

interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string };
  onOpenFile?: (path: string) => void;
  onNavigateIssue?: (issueId: string) => void;
}

// ── Constants ──
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

const EFFORT_STYLES: Record<string, { color: string }> = {
  S: { color: "#22c55e" }, M: { color: "#3b82f6" }, L: { color: "#f59e0b" }, XL: { color: "#dc2626" },
};

const SOURCE_ICONS: Record<string, string> = {
  vibe: "🌊", discussion: "💬", pm: "📋", issue: "🐛", security: "🔒", manual: "🔧",
};

const PIPELINE_PHASES = ["SPEC", "IMPLEMENT", "REVIEW", "TEST", "QA", "DOCS", "DONE"] as const;
type PipelinePhaseName = typeof PIPELINE_PHASES[number];

const PIPELINE_PHASE_ICONS: Record<string, string> = {
  SPEC: "📝", IMPLEMENT: "🔨", REVIEW: "👁️", TEST: "🧪", QA: "✅", DOCS: "📖", DONE: "🎉",
};

const PHASE_STATUS_ICONS: Record<string, string> = {
  done: "✅", in_progress: "🔄", pending: "⏳", rejected: "❌", blocked: "⚠️",
};

const STATUS_FILTERS = ["all", "open", "in-progress", "resolved", "closed"];
const TYPE_FILTERS = ["all", "requirement", "bug", "security", "chore"];

type ViewMode = "list" | "pipeline" | "overnight";

// ── Helper functions ──
function getTaskSourceIcon(task: Task): string {
  if (task.source?.type && SOURCE_ICONS[task.source.type]) return SOURCE_ICONS[task.source.type];
  return TYPE_STYLES[task.type]?.icon || "📋";
}

function getCurrentPhase(task: Task): PipelinePhaseName | null {
  if (!task.pipeline) return null;
  for (const phase of PIPELINE_PHASES) {
    const p = task.pipeline[phase];
    if (p && p.status !== "done") return phase;
  }
  return "DONE";
}

function getPhaseMiniBar(task: Task): { phase: PipelinePhaseName; done: boolean }[] {
  const pipeline = task.pipeline;
  if (!pipeline) return [];
  return PIPELINE_PHASES.map(phase => {
    const p = pipeline[phase];
    return { phase, done: p?.status === "done" };
  });
}

function getAssigneeIcon(assignTo?: string): string {
  if (assignTo === "ai_overnight") return "🌙";
  if (assignTo === "human") return "☀️";
  return "👤";
}

// ── Component ──
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
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [pipelineOverview, setPipelineOverview] = useState<PipelineOverview | null>(null);
  const [overnightQueue, setOvernightQueue] = useState<Task[]>([]);
  const [overnightResults, setOvernightResults] = useState<OvernightResult[]>([]);
  const [diffModal, setDiffModal] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [showSpecForm, setShowSpecForm] = useState(false);

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

  const fetchPipelineOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/pipeline/overview?path=${pathParam}`);
      if (res.ok) {
        const data = await res.json();
        setPipelineOverview(data);
      }
    } catch {}
  }, [pathParam]);

  const fetchOvernightQueue = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/overnight-queue?path=${pathParam}`);
      if (res.ok) {
        const data = await res.json();
        setOvernightQueue(data.tasks || []);
      }
    } catch {}
  }, [pathParam]);

  const fetchOvernightResults = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/overnight-queue/results?path=${pathParam}`);
      if (res.ok) {
        const data = await res.json();
        setOvernightResults(data.results || []);
      }
    } catch {}
  }, [pathParam]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    if (viewMode === "pipeline") fetchPipelineOverview();
    if (viewMode === "overnight") { fetchOvernightQueue(); fetchOvernightResults(); }
  }, [viewMode, fetchPipelineOverview, fetchOvernightQueue, fetchOvernightResults]);

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
        if (viewMode === "pipeline") fetchPipelineOverview();
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
      if (viewMode === "pipeline") fetchPipelineOverview();
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
        setDecomposeSubs([{ title: "", type: "", effort: "S", assignee: "", description: "" }]);
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

  // ── Pipeline handlers ──
  const handleAdvancePhase = async (taskId: string, phase: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/${taskId}/pipeline/advance?path=${pathParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, status: "done", result: {} }),
      });
      if (res.ok) {
        fetchTasks();
        fetchPipelineOverview();
      }
    } catch {}
  };

  const handleRejectPhase = async (taskId: string, phase: string) => {
    const feedback = prompt(`Reject ${phase} — feedback:`);
    if (!feedback) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/${taskId}/pipeline/reject?path=${pathParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, feedback, backTo: "IMPLEMENT" }),
      });
      if (res.ok) {
        fetchTasks();
        fetchPipelineOverview();
      }
    } catch {}
  };

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

  // ── Overnight handlers ──
  const handleStartOvernightRun = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-tasks/overnight-queue/run?path=${pathParam}`, { method: "POST" });
      if (res.ok) {
        fetchOvernightQueue();
        fetchOvernightResults();
      }
    } catch {}
  };

  const startEdit = (task: Task) => {
    setEditing(true);
    setEditForm({
      title: task.title, status: task.status, priority: task.priority,
      type: task.type, effort: task.effort, assignee: task.assignee, description: task.description,
    });
  };

  // ── View mode toggle ──
  const renderViewToggle = () => (
    <div className="flex items-center gap-0.5 px-1 py-1 rounded" style={{ background: theme.bgMuted }}>
      {(["list", "pipeline", "overnight"] as ViewMode[]).map(mode => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          className="text-xs px-2.5 py-1 rounded font-medium transition-colors"
          style={{
            background: viewMode === mode ? theme.accentBg : "transparent",
            color: viewMode === mode ? theme.accent : theme.text,
            opacity: viewMode === mode ? 1 : 0.6,
          }}
        >
          {mode === "list" && `📋 ${t("task.listView", "List")}`}
          {mode === "pipeline" && `🔧 ${t("task.pipelineView", "Pipeline")}`}
          {mode === "overnight" && `🌙 ${t("task.overnightView", "Overnight")}`}
        </button>
      ))}
    </div>
  );

  // ── Task card mini pipeline bar ──
  const renderPhaseMiniBar = (task: Task) => {
    const phases = getPhaseMiniBar(task);
    if (phases.length === 0) return null;
    return (
      <div className="flex items-center gap-0.5 mt-1">
        {phases.map((p, i) => (
          <React.Fragment key={p.phase}>
            <div
              className="w-4 h-1.5 rounded-sm"
              style={{ background: p.done ? "#22c55e" : theme.borderLight }}
              title={p.phase}
            />
            {i < phases.length - 1 && <div className="w-1 h-px" style={{ background: theme.borderLight }} />}
          </React.Fragment>
        ))}
      </div>
    );
  };

  // ── Pipeline progress bar (detail) ──
  const renderPipelineProgressBar = (task: Task) => {
    if (!task.pipeline) return null;
    const currentPhase = getCurrentPhase(task);
    return (
      <div className="mb-4 p-3 rounded" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>
        <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: theme.text, opacity: 0.6 }}>
          {t("task.pipelineProgress", "Pipeline Progress")}
        </h3>
        <div className="flex items-center gap-1 overflow-x-auto">
          {PIPELINE_PHASES.map((phase, i) => {
            const p = task.pipeline![phase];
            const status = p?.status || "pending";
            const icon = PHASE_STATUS_ICONS[status] || "⏳";
            const isCurrent = phase === currentPhase;
            return (
              <React.Fragment key={phase}>
                <div className="flex flex-col items-center gap-1 shrink-0" style={{ minWidth: 70 }}>
                  <div className="text-xs font-bold" style={{ color: isCurrent ? theme.accent : theme.text, opacity: isCurrent ? 1 : 0.7 }}>
                    {PIPELINE_PHASE_ICONS[phase]} {phase}
                  </div>
                  <div className="text-base">{icon}</div>
                  {p?.by && <div className="text-[10px]" style={{ opacity: 0.5 }}>{getAssigneeIcon(p.assignTo)} {p.by}</div>}
                  {p?.at && <div className="text-[10px]" style={{ opacity: 0.3 }}>{new Date(p.at).toLocaleDateString()}</div>}
                  {isCurrent && (
                    <div className="flex gap-1 mt-1">
                      <button
                        onClick={() => handleAdvancePhase(task.id, phase)}
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ background: theme.accentBg, color: theme.accent }}
                      >
                        {t("task.advance", "Advance ▶")}
                      </button>
                      <button
                        onClick={() => handleRejectPhase(task.id, phase)}
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: "#fef2f2", color: "#dc2626" }}
                      >
                        ❌
                      </button>
                    </div>
                  )}
                </div>
                {i < PIPELINE_PHASES.length - 1 && (
                  <div className="shrink-0" style={{ minWidth: 12, height: 1, background: theme.borderLight, alignSelf: "center", marginTop: -20 }} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Spec section ──
  const renderSpecSection = (task: Task) => {
    if (!task.spec) return null;
    return (
      <div className="mb-4 p-3 rounded" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>
        <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: theme.text, opacity: 0.6 }}>
          {t("task.spec", "📝 Spec")}
        </h3>
        {task.spec.description && (
          <div className="text-sm mb-2" style={{ color: theme.text }}>
            <MarkdownText>{task.spec.description}</MarkdownText>
          </div>
        )}
        {task.spec.acceptanceCriteria.length > 0 && (
          <div className="mb-2">
            <div className="text-xs font-medium mb-1" style={{ color: theme.text, opacity: 0.7 }}>
              {t("task.acceptanceCriteria", "Acceptance Criteria")}
            </div>
            {task.spec.acceptanceCriteria.map((criteria, i) => (
              <div key={i} className="flex items-start gap-2 text-sm mb-1" style={{ color: theme.text }}>
                <input type="checkbox" readOnly className="mt-0.5 shrink-0" />
                <span>{criteria}</span>
              </div>
            ))}
          </div>
        )}
        {task.spec.fileScope.length > 0 && (
          <div className="mb-2">
            <div className="text-xs font-medium mb-1" style={{ color: theme.text, opacity: 0.7 }}>
              {t("task.fileScope", "File Scope")}
            </div>
            <div className="flex flex-col gap-1">
              {task.spec.fileScope.map((f, i) => (
                <button key={i} onClick={() => onOpenFile?.(f)} className="text-sm text-left font-mono hover:underline" style={{ color: theme.accent }}>
                  📄 {f}
                </button>
              ))}
            </div>
          </div>
        )}
        {task.spec.outOfScope.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1" style={{ color: theme.text, opacity: 0.7 }}>
              {t("task.outOfScope", "Out of Scope")}
            </div>
            <div className="text-sm" style={{ color: theme.text, opacity: 0.5 }}>
              {task.spec.outOfScope.join(", ")}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Changes section ──
  const renderChangesSection = (task: Task) => {
    if (!task.changes) return null;
    const c = task.changes;
    const totalFiles = c.filesAdded.length + c.filesModified.length + c.filesDeleted.length;
    return (
      <div className="mb-4 p-3 rounded" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase" style={{ color: theme.text, opacity: 0.6 }}>
            {t("task.changes", "📁 Changes")}
          </h3>
          <button
            onClick={() => handleViewDiff(task.id)}
            className="text-xs px-2 py-0.5 rounded font-medium"
            style={{ background: theme.accentBg, color: theme.accent }}
          >
            {t("task.viewDiff", "View Diff")}
          </button>
        </div>
        <div className="text-xs mb-2" style={{ color: theme.text, opacity: 0.6 }}>
          {totalFiles} files {c.diffStat ? `(${c.diffStat})` : ""}
        </div>
        <div className="flex flex-col gap-0.5">
          {c.filesAdded.map((f, i) => (
            <div key={`a${i}`} className="text-sm font-mono" style={{ color: "#16a34a" }}>+ {f}</div>
          ))}
          {c.filesModified.map((f, i) => (
            <div key={`m${i}`} className="text-sm font-mono" style={{ color: "#d97706" }}>M {f}</div>
          ))}
          {c.filesDeleted.map((f, i) => (
            <div key={`d${i}`} className="text-sm font-mono" style={{ color: "#dc2626" }}>- {f}</div>
          ))}
        </div>
      </div>
    );
  };

  // ── Test result section ──
  const renderTestResultSection = (task: Task) => {
    if (!task.testResult) return null;
    const tr = task.testResult;
    const total = tr.passed + tr.failed;
    return (
      <div className="mb-4 p-3 rounded" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>
        <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: theme.text, opacity: 0.6 }}>
          {t("task.testResult", "🧪 Test Result")}
        </h3>
        <div className="flex items-center gap-3 text-sm mb-2" style={{ color: theme.text }}>
          <span style={{ color: tr.failed > 0 ? "#dc2626" : "#16a34a" }}>
            {tr.passed}/{total} {t("task.passed", "passed")}
          </span>
          {tr.coverage && <span style={{ opacity: 0.7 }}>{t("task.coverage", "Coverage")}: {tr.coverage}</span>}
        </div>
        {tr.testsWritten.length > 0 && (
          <div className="mb-2">
            <div className="text-xs font-medium mb-1" style={{ opacity: 0.7 }}>{t("task.testsWritten", "Tests Written")}</div>
            {tr.testsWritten.map((test, i) => (
              <div key={i} className="text-sm font-mono mb-0.5" style={{ color: theme.text, opacity: 0.8 }}>✓ {test}</div>
            ))}
          </div>
        )}
        {tr.coverageGaps && tr.coverageGaps.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1" style={{ color: "#d97706" }}>{t("task.coverageGaps", "Coverage Gaps")}</div>
            {tr.coverageGaps.map((gap, i) => (
              <div key={i} className="text-sm" style={{ color: "#d97706", opacity: 0.8 }}>⚠ {gap}</div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── QA result section ──
  const renderQaResultSection = (task: Task) => {
    if (!task.qaResult) return null;
    const qa = task.qaResult;
    return (
      <div className="mb-4 p-3 rounded" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>
        <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: theme.text, opacity: 0.6 }}>
          {t("task.qaResult", "✅ QA Result")}
        </h3>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-bold" style={{
            color: qa.overall === "passed" ? "#16a34a" : qa.overall === "failed" ? "#dc2626" : "#d97706"
          }}>
            {qa.overall.toUpperCase()}
          </span>
        </div>
        {qa.autoChecks.length > 0 && (
          <div className="mb-2">
            <div className="text-xs font-medium mb-1" style={{ opacity: 0.7 }}>{t("task.autoChecks", "Auto Checks")}</div>
            {qa.autoChecks.map((check, i) => (
              <div key={i} className="flex items-center gap-2 text-sm mb-0.5" style={{ color: theme.text }}>
                <span>{check.passed ? "✅" : "❌"}</span>
                <span className="flex-1">{check.rule}</span>
                {check.detail && <span className="text-xs" style={{ opacity: 0.5 }}>{check.detail}</span>}
              </div>
            ))}
          </div>
        )}
        {qa.manualChecks && qa.manualChecks.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1" style={{ opacity: 0.7 }}>{t("task.manualChecks", "Manual Checks")}</div>
            {qa.manualChecks.map((check, i) => (
              <div key={i} className="flex items-center gap-2 text-sm mb-0.5" style={{ color: theme.text }}>
                <span>{check.checked ? "☑️" : "☐"}</span>
                <span>{check.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Git section ──
  const renderGitSection = (task: Task) => {
    const g = task.git;
    return (
      <div className="mb-4 p-3 rounded" style={{ background: theme.bgMuted, border: `1px solid ${theme.borderLight}` }}>
        <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: theme.text, opacity: 0.6 }}>
          {t("task.git", "🔗 Git")}
        </h3>
        {g && (
          <div className="text-xs mb-2 flex flex-col gap-0.5" style={{ color: theme.text, opacity: 0.7 }}>
            <div>📌 {t("task.baseCommit", "Base")}: <code style={{ fontSize: 11 }}>{g.baseCommit.slice(0, 8)}</code></div>
            <div>🌿 {t("task.branch", "Branch")}: {g.branch || "—"}</div>
            <div>{g.staged ? "📦" : "⬜"} {t("task.staged", "Staged")}: {g.staged ? "Yes" : "No"}</div>
            {g.committedSha && <div>✅ {t("task.committed", "Committed")}: <code style={{ fontSize: 11 }}>{g.committedSha.slice(0, 8)}</code></div>}
          </div>
        )}
        {/* Commit message preview */}
        <div className="mb-2">
          <textarea
            ref={commitMsgRef}
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder={t("task.commitMsgPlaceholder", "Commit message (auto-generate or type)...")}
            rows={2}
            className="w-full text-xs px-2 py-1.5 rounded border outline-none resize-y font-mono"
            style={inputStyle}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => handleGitStage(task.id)}
            className="text-xs px-2 py-1 rounded font-medium"
            style={{ background: theme.accentBg, color: theme.accent }}
          >
            {t("task.stageFiles", "📦 Stage")}
          </button>
          <button
            onClick={() => handleGitCommit(task.id, commitMsg || `${task.id}: ${task.title}`, true)}
            disabled={!commitMsg.trim() && !task.title}
            className="text-xs px-2 py-1 rounded font-medium"
            style={{
              background: commitMsg.trim() || task.title ? theme.accentBg : theme.bgMuted,
              color: commitMsg.trim() || task.title ? theme.accent : theme.text,
              opacity: commitMsg.trim() || task.title ? 1 : 0.5,
            }}
          >
            {t("task.commitPush", "🚀 Commit & Push")}
          </button>
          <button
            onClick={() => handleGitRestore(task.id)}
            className="text-xs px-2 py-1 rounded"
            style={{ background: "#fef2f2", color: "#dc2626" }}
          >
            {t("task.restore", "↩️ Restore")}
          </button>
        </div>
      </div>
    );
  };

  // ── Diff modal ──
  const renderDiffModal = () => {
    if (!diffModal) return null;
    return (
      <div
        onClick={() => setDiffModal(null)}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ background: theme.bg, border: `1px solid ${theme.borderLight}`, borderRadius: 8, maxWidth: "80vw", maxHeight: "80vh", overflow: "auto", padding: 16 }}
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold" style={{ color: theme.text }}>{t("task.diff", "Diff")}</h3>
            <button onClick={() => setDiffModal(null)} className="text-xs px-2 py-1 rounded" style={{ background: theme.bgMuted, color: theme.text }}>✕</button>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap" style={{ color: theme.text }}>
            {diffModal}
          </pre>
        </div>
      </div>
    );
  };

  // ── Task card for kanban ──
  const renderKanbanCard = (task: Task) => {
    const ty = TYPE_STYLES[task.type] || TYPE_STYLES.chore;
    const sourceIcon = getTaskSourceIcon(task);
    const currentPhase = getCurrentPhase(task);
    const assignTo = currentPhase ? task.pipeline?.[currentPhase]?.assignTo : undefined;
    return (
      <div
        key={task.id}
        onClick={() => navigateTo(task.id)}
        className="p-2 rounded cursor-pointer border mb-2 transition-colors"
        style={{
          borderColor: theme.borderLight,
          background: theme.bg,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = theme.borderLight; }}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs">{sourceIcon}</span>
          <span className="text-xs font-mono shrink-0" style={{ color: theme.text, opacity: 0.5 }}>{task.id}</span>
          <span className="text-[10px] px-1 rounded" style={{ background: ty.bg, color: ty.text }}>{getAssigneeIcon(assignTo)}</span>
        </div>
        <div className="text-xs font-medium mb-1" style={{ color: theme.text }}>{task.title}</div>
        <div className="flex items-center gap-1 flex-wrap">
          {task.effort && (
            <span className="text-[10px] px-1 py-0.5 rounded font-bold"
              style={{ background: (EFFORT_STYLES[task.effort] || EFFORT_STYLES.S).color + "20", color: (EFFORT_STYLES[task.effort] || EFFORT_STYLES.S).color }}>
              {task.effort}
            </span>
          )}
          {task.executionResult && (
            <span className="text-[10px]">{task.executionResult.success ? "⚡✅" : "⚡❌"}</span>
          )}
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>
      {/* Left: Task List / Pipeline / Overnight */}
      <div className="w-1/2 flex flex-col border-r" style={{ borderColor: theme.borderLight }}>
        {/* Top bar with view toggle + stats */}
        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
          {renderViewToggle()}
          <div className="flex-1" />
          <button
            onClick={() => { fetchTasks(); fetchStats(); if (viewMode === "pipeline") fetchPipelineOverview(); if (viewMode === "overnight") { fetchOvernightQueue(); fetchOvernightResults(); } }}
            className="text-xs px-1.5 py-1 rounded shrink-0"
            style={{ background: theme.bg, color: theme.text }}
          >
            🔄
          </button>
        </div>

        {/* Stats bar (list mode only) */}
        {viewMode === "list" && stats && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap" style={{ background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}` }}>
            <span style={{ color: theme.text, opacity: 0.6 }}>{t("task.tasks", "Tasks")}: <b>{stats.total}</b></span>
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.open.bg, color: STATUS_STYLES.open.text }}>{t("task.open", "Open")}: {stats.open}</span>
            {stats.inProgress > 0 && <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES["in-progress"].bg, color: STATUS_STYLES["in-progress"].text }}>{t("task.active", "Active")}: {stats.inProgress}</span>}
            <span className="px-1.5 py-0.5 rounded" style={{ background: STATUS_STYLES.resolved.bg, color: STATUS_STYLES.resolved.text }}>{t("task.done", "Done")}: {stats.resolved}</span>
          </div>
        )}

        {/* ─── LIST VIEW ─── */}
        {viewMode === "list" && (
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
                            {task.effort && <span className="text-[10px] px-1 py-0.5 rounded shrink-0 font-bold" style={{ background: (EFFORT_STYLES[task.effort] || EFFORT_STYLES.S).color + "20", color: (EFFORT_STYLES[task.effort] || EFFORT_STYLES.S).color }}>{task.effort}</span>}
                            {task.assignee && <span className="text-[10px] shrink-0">👤{task.assignee}</span>}
                            {task.executionResult && <span className="text-[10px] shrink-0">{task.executionResult.success ? "⚡✅" : "⚡❌"}</span>}
                          </div>
                          <div className="text-sm font-medium truncate" style={{ color: theme.text }}>{task.title}</div>
                          {renderPhaseMiniBar(task)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ─── PIPELINE VIEW (Kanban) ─── */}
        {viewMode === "pipeline" && (
          <div className="flex-1 overflow-x-auto">
            {/* Summary bar */}
            <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap" style={{ borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
              {PIPELINE_PHASES.map(phase => {
                const count = pipelineOverview?.phases?.[phase]?.count ?? tasks.filter(t => getCurrentPhase(t) === phase).length;
                return (
                  <span key={phase} className="flex items-center gap-1">
                    {PIPELINE_PHASE_ICONS[phase]} <b style={{ color: theme.text }}>{count}</b>
                  </span>
                );
              })}
            </div>
            {/* Kanban columns */}
            <div className="flex gap-2 p-2 h-full" style={{ minWidth: "fit-content" }}>
              {PIPELINE_PHASES.map(phase => {
                const phaseTasks = tasks.filter(t => getCurrentPhase(t) === phase);
                return (
                  <div key={phase} className="flex flex-col rounded" style={{ width: 200, minWidth: 200, background: theme.bgMuted }}>
                    <div className="px-2 py-2 text-xs font-bold sticky top-0" style={{ color: theme.text, borderBottom: `1px solid ${theme.borderLight}`, background: theme.bgMuted }}>
                      {PIPELINE_PHASE_ICONS[phase]} {phase} <span style={{ opacity: 0.5 }}>({phaseTasks.length})</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1.5">
                      {phaseTasks.length === 0 ? (
                        <div className="text-xs text-center py-4" style={{ opacity: 0.3 }}>—</div>
                      ) : (
                        phaseTasks.map(task => renderKanbanCard(task))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── OVERNIGHT VIEW ─── */}
        {viewMode === "overnight" && (
          <div className="flex-1 overflow-y-auto">
            {/* Tonight's Queue */}
            <div className="px-3 py-2 sticky top-0" style={{ background: theme.bgMuted, borderBottom: `1px solid ${theme.borderLight}`, zIndex: 1 }}>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase" style={{ color: theme.text, opacity: 0.7 }}>
                  🌙 {t("task.tonightsQueue", "Tonight's Queue")} ({overnightQueue.length})
                </h3>
                <button
                  onClick={handleStartOvernightRun}
                  className="text-xs px-2.5 py-1 rounded font-medium"
                  style={{ background: theme.accentBg, color: theme.accent }}
                >
                  ▶️ {t("task.startOvernightRun", "Start Overnight Run")}
                </button>
              </div>
            </div>
            {overnightQueue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-sm" style={{ color: theme.text, opacity: 0.4 }}>
                <div className="text-3xl">🌙</div>
                <div>{t("task.noOvernightTasks", "No tasks queued for overnight")}</div>
              </div>
            ) : (
              <div className="p-2">
                {/* Group by phase */}
                {PIPELINE_PHASES.map(phase => {
                  const phaseTasks = overnightQueue.filter(t => getCurrentPhase(t) === phase);
                  if (phaseTasks.length === 0) return null;
                  return (
                    <div key={phase} className="mb-3">
                      <div className="text-xs font-bold mb-1" style={{ color: theme.text, opacity: 0.6 }}>
                        {PIPELINE_PHASE_ICONS[phase]} {phase}
                      </div>
                      {phaseTasks.map(task => (
                        <div
                          key={task.id}
                          onClick={() => navigateTo(task.id)}
                          className="px-2 py-1.5 rounded cursor-pointer border mb-1"
                          style={{ borderColor: theme.borderLight, background: theme.bg }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs">{getTaskSourceIcon(task)}</span>
                            <span className="text-xs font-mono" style={{ opacity: 0.5 }}>{task.id}</span>
                            <span className="text-xs flex-1 truncate" style={{ color: theme.text }}>{task.title}</span>
                            <span className="text-[10px]">🌙</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Last Results */}
            <div className="px-3 py-2 sticky" style={{ background: theme.bgMuted, borderTop: `1px solid ${theme.borderLight}`, borderBottom: `1px solid ${theme.borderLight}` }}>
              <h3 className="text-xs font-semibold uppercase" style={{ color: theme.text, opacity: 0.7 }}>
                ☀️ {t("task.lastResults", "Last Results")} ({overnightResults.length})
              </h3>
            </div>
            {overnightResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-sm" style={{ color: theme.text, opacity: 0.4 }}>
                <div className="text-3xl">☀️</div>
                <div>{t("task.noResults", "No overnight results yet")}</div>
              </div>
            ) : (
              <div className="p-2">
                {overnightResults.map((result, i) => (
                  <div
                    key={i}
                    onClick={() => navigateTo(result.taskId)}
                    className="px-2 py-1.5 rounded cursor-pointer border mb-1"
                    style={{ borderColor: theme.borderLight, background: theme.bg }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">
                        {result.status === "passed" ? "✅" : result.status === "failed" ? "❌" : "⚠️"}
                      </span>
                      <span className="text-xs font-mono" style={{ opacity: 0.5 }}>{result.taskId}</span>
                      <span className="text-xs flex-1 truncate" style={{ color: theme.text }}>{result.taskTitle}</span>
                      {result.duration && <span className="text-[10px]" style={{ opacity: 0.4 }}>{result.duration}</span>}
                    </div>
                    {result.summary && (
                      <div className="text-xs mt-0.5" style={{ color: theme.text, opacity: 0.6 }}>{result.summary}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold" style={{ color: theme.text }}>📋 {t("task.newTask", "New Task")}</h2>
            <div>
              <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.title", "Title")}</label>
              <input ref={titleRef} type="text" value={editForm.title || ""} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} placeholder={t("task.titlePlaceholder", "What needs to be done?")} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.type", "Type")}</label>
                <select value={editForm.type || "chore"} onChange={e => setEditForm({ ...editForm, type: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
                  <option value="requirement">📋 {t("task.requirement", "Requirement")}</option>
                  <option value="bug">🐛 Bug</option>
                  <option value="security">🔒 {t("task.security", "Security")}</option>
                  <option value="chore">🔧 {t("task.chore", "Chore")}</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.effort", "Effort")}</label>
                <select value={editForm.effort || ""} onChange={e => setEditForm({ ...editForm, effort: e.target.value as any || null })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
                  <option value="">—</option>
                  <option value="S">S</option><option value="M">M</option><option value="L">L</option><option value="XL">XL</option>
                </select>
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
            <div>
              <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.description", "Description")}</label>
              <textarea ref={descRef} value={editForm.description || ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y" style={inputStyle} />
            </div>
            {/* New: Source type */}
            <div>
              <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.source", "Source")}</label>
              <select
                value={(editForm as any).sourceType || "manual"}
                onChange={e => setEditForm({ ...editForm, source: { type: e.target.value } } as any)}
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
            {/* New: Spec fields (collapsible) */}
            <div>
              <button
                onClick={() => setShowSpecForm(!showSpecForm)}
                className="text-xs font-semibold uppercase flex items-center gap-1"
                style={{ color: theme.text, opacity: 0.6 }}
              >
                {showSpecForm ? "▼" : "▶"} {t("task.specFields", "Spec (optional)")}
              </button>
              {showSpecForm && (
                <div className="mt-2 p-3 rounded border flex flex-col gap-2" style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
                  <div>
                    <label className="text-xs block mb-1" style={{ opacity: 0.6 }}>{t("task.specDescription", "Spec Description")}</label>
                    <textarea
                      value={(editForm as any).specDesc || ""}
                      onChange={e => setEditForm({ ...editForm, spec: { ...(editForm as any).spec, description: e.target.value } } as any)}
                      rows={2}
                      className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ opacity: 0.6 }}>{t("task.acceptanceCriteria", "Acceptance Criteria")} (one per line)</label>
                    <textarea
                      value={(editForm as any).specCriteria || ""}
                      onChange={e => setEditForm({ ...editForm, spec: { ...(editForm as any).spec, acceptanceCriteria: e.target.value.split("\n").filter(Boolean) } } as any)}
                      rows={3}
                      className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ opacity: 0.6 }}>{t("task.fileScope", "File Scope")} (one per line)</label>
                    <textarea
                      value={(editForm as any).specScope || ""}
                      onChange={e => setEditForm({ ...editForm, spec: { ...(editForm as any).spec, fileScope: e.target.value.split("\n").filter(Boolean) } } as any)}
                      rows={2}
                      className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y font-mono"
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => handleCreate(editForm)} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent }}>✅ {t("task.create", "Create")}</button>
              <button onClick={() => setShowCreate(false)} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>{t("task.cancel", "Cancel")}</button>
            </div>
          </div>
        ) : showDecompose && selected ? (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold" style={{ color: theme.text }}>✂️ {t("task.decompose", "Decompose")} {selected.id}</h2>
            <div className="text-sm" style={{ color: theme.text, opacity: 0.6 }}>{t("task.splitInto", "Split")} <b>{selected.title}</b> {t("task.intoSubTasks", "into sub-tasks")}</div>
            {decomposeSubs.map((sub, idx) => (
              <div key={idx} className="p-3 rounded border" style={{ borderColor: theme.borderLight, background: theme.bgMuted }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold" style={{ opacity: 0.5 }}>#{idx + 1}</span>
                  {decomposeSubs.length > 1 && <button onClick={() => setDecomposeSubs(decomposeSubs.filter((_, i) => i !== idx))} className="text-xs px-1 rounded" style={{ color: "#dc2626" }}>✕</button>}
                </div>
                <input type="text" value={sub.title} onChange={e => { const n = [...decomposeSubs]; n[idx] = { ...n[idx], title: e.target.value }; setDecomposeSubs(n); }} placeholder={t("task.subTaskTitle", "Sub-task title")} className="w-full text-sm px-2 py-1.5 rounded border outline-none mb-2" style={inputStyle} />
                <div className="flex gap-2">
                  <select value={sub.effort} onChange={e => { const n = [...decomposeSubs]; n[idx] = { ...n[idx], effort: e.target.value }; setDecomposeSubs(n); }} className="text-xs px-1.5 py-1 rounded border" style={inputStyle}><option value="S">S</option><option value="M">M</option><option value="L">L</option></select>
                  <input type="text" value={sub.assignee} onChange={e => { const n = [...decomposeSubs]; n[idx] = { ...n[idx], assignee: e.target.value }; setDecomposeSubs(n); }} placeholder={t("task.assignee", "Assignee")} className="flex-1 text-xs px-1.5 py-1 rounded border outline-none" style={inputStyle} />
                </div>
              </div>
            ))}
            <button onClick={() => setDecomposeSubs([...decomposeSubs, { title: "", type: "", effort: "S", assignee: "", description: "" }])} className="text-xs px-2 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>+ {t("task.addSubTask", "Add sub-task")}</button>
            <div className="flex gap-2 mt-2">
              <button onClick={handleDecompose} disabled={!decomposeSubs.some(s => s.title.trim())} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent, opacity: decomposeSubs.some(s => s.title.trim()) ? 1 : 0.5 }}>✂️ {t("task.split", "Split")}</button>
              <button onClick={() => { setShowDecompose(false); setDecomposeSubs([{ title: "", type: "", effort: "S", assignee: "", description: "" }]); }} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>{t("task.cancel", "Cancel")}</button>
            </div>
          </div>
        ) : editing ? (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold" style={{ color: theme.text }}>✏️ {t("task.edit", "Edit")} {selected!.id}</h2>
            <div>
              <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.title", "Title")}</label>
              <input type="text" value={editForm.title || ""} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.type", "Type")}</label>
                <select value={editForm.type || "chore"} onChange={e => setEditForm({ ...editForm, type: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
                  <option value="requirement">📋</option><option value="bug">🐛</option><option value="security">🔒</option><option value="chore">🔧</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.effort", "Effort")}</label>
                <select value={editForm.effort || ""} onChange={e => setEditForm({ ...editForm, effort: e.target.value as any || null })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
                  <option value="">—</option><option value="S">S</option><option value="M">M</option><option value="L">L</option><option value="XL">XL</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.status", "Status")}</label>
                <select value={editForm.status || "open"} onChange={e => setEditForm({ ...editForm, status: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
                  <option value="open">Open</option><option value="in-progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.priority", "Priority")}</label>
                <select value={editForm.priority || "medium"} onChange={e => setEditForm({ ...editForm, priority: e.target.value as any })} className="w-full text-sm px-2 py-1.5 rounded border" style={inputStyle}>
                  <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.assignee", "Assignee")}</label>
                <input type="text" value={editForm.assignee || ""} onChange={e => setEditForm({ ...editForm, assignee: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded border outline-none" style={inputStyle} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase block mb-1" style={{ color: theme.text, opacity: 0.6 }}>{t("task.description", "Description")}</label>
              <textarea value={editForm.description || ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full text-sm px-2 py-1.5 rounded border outline-none resize-y" style={inputStyle} />
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => handleUpdate(selected!.id, editForm)} className="text-sm px-4 py-1.5 rounded font-medium" style={{ background: theme.accentBg, color: theme.accent }}>✅ {t("task.save", "Save")}</button>
              <button onClick={() => setEditing(false)} className="text-sm px-4 py-1.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>{t("task.cancel", "Cancel")}</button>
            </div>
          </div>
        ) : selected && (
          <div className="flex-1 overflow-y-auto p-4">
            {(() => {
              const st = STATUS_STYLES[selected.status] || STATUS_STYLES.open;
              const pr = PRIORITY_STYLES[selected.priority] || PRIORITY_STYLES.medium;
              const ty = TYPE_STYLES[selected.type] || TYPE_STYLES.chore;
              const sourceIcon = getTaskSourceIcon(selected);
              return (
                <>
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2 mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-base">{sourceIcon}</span>
                        <span className="text-xs font-mono" style={{ opacity: 0.5 }}>{selected.id}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                        <span className="text-[10px] px-1 py-0.5 rounded inline-flex items-center gap-1" style={{ background: theme.bgMuted, color: theme.text }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: pr.dot }} />{pr.label}
                        </span>
                        <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: ty.bg, color: ty.text }}>{ty.icon} {ty.label}</span>
                        {selected.effort && <span className="text-[10px] px-1 py-0.5 rounded font-bold" style={{ background: (EFFORT_STYLES[selected.effort] || EFFORT_STYLES.S).color + "20", color: (EFFORT_STYLES[selected.effort] || EFFORT_STYLES.S).color }}>{selected.effort}</span>}
                        {selected.assignee && <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: theme.bgMuted, color: theme.text }}>👤 {selected.assignee}</span>}
                        {selected.executionResult && <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: "#1e1b4b", color: "#c4b5fd" }}>⚡ {selected.executionResult.success ? "✅" : "❌"}</span>}
                      </div>
                      <h2 className="text-lg font-bold" style={{ color: theme.text }}>{selected.title}</h2>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => setShowDecompose(true)} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }} title="Decompose">✂️</button>
                      <button onClick={() => startEdit(selected)} className="text-xs px-2 py-1 rounded" style={{ background: theme.accentBg, color: theme.accent }}>✏️</button>
                      <button onClick={() => handleDelete(selected.id)} className="text-xs px-2 py-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>🗑️</button>
                    </div>
                  </div>

                  {/* Linked Issue */}
                  {selected.linkedIssueId && (
                    <div className="mb-3 p-2 rounded flex items-center gap-2" style={{ background: theme.bgMuted }}>
                      <span className="text-xs" style={{ opacity: 0.6 }}>🐛 {t("task.issue", "Issue")}:</span>
                      <button onClick={() => onNavigateIssue?.(selected.linkedIssueId!)} className="text-xs font-mono px-1.5 py-0.5 rounded hover:underline" style={{ color: theme.accent }}>{selected.linkedIssueId}</button>
                    </div>
                  )}

                  {/* Parent */}
                  {parentTask && (
                    <div className="mb-3 p-2 rounded flex items-center gap-2" style={{ background: theme.bgMuted }}>
                      <span className="text-xs" style={{ opacity: 0.6 }}>⬆️ {t("task.parent", "Parent")}:</span>
                      <button onClick={() => navigateTo(parentTask.id)} className="text-xs font-mono px-1.5 py-0.5 rounded hover:underline" style={{ color: theme.accent }}>{parentTask.id}: {parentTask.title}</button>
                    </div>
                  )}

                  {/* Children */}
                  {childTasks.length > 0 && (
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>📌 {t("task.subTasks", "Sub-tasks")} ({childTasks.length})</h3>
                      <div className="flex flex-col gap-1">
                        {childTasks.map(child => {
                          const cst = STATUS_STYLES[child.status] || STATUS_STYLES.open;
                          return (
                            <button key={child.id} onClick={() => navigateTo(child.id)} className="flex items-center gap-2 text-xs text-left px-2 py-1.5 rounded hover:underline" style={{ background: theme.bgMuted, color: theme.text }}>
                              <span className="font-mono shrink-0" style={{ opacity: 0.5 }}>{child.id}</span>
                              <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: cst.bg, color: cst.text }}>{cst.label}</span>
                              <span className="truncate flex-1">{child.title}</span>
                              {child.effort && <span className="shrink-0 font-bold" style={{ color: (EFFORT_STYLES[child.effort] || EFFORT_STYLES.S).color }}>{child.effort}</span>}
                              {child.executionResult && <span className="shrink-0">{child.executionResult.success ? "⚡✅" : "⚡❌"}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Timestamps */}
                  <div className="flex gap-4 text-xs mb-4" style={{ color: theme.text, opacity: 0.5 }}>
                    <span>📅 {new Date(selected.createdAt).toLocaleString()}</span>
                    <span>🔄 {new Date(selected.updatedAt).toLocaleString()}</span>
                    {selected.resolvedAt && <span>✅ {new Date(selected.resolvedAt).toLocaleString()}</span>}
                  </div>

                  {/* Description */}
                  {selected.description && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>{t("task.description", "Description")}</h3>
                      <div style={{ color: theme.text }}><MarkdownText>{selected.description}</MarkdownText></div>
                    </div>
                  )}

                  {/* Related Files */}
                  {selected.relatedFiles.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>{t("task.relatedFiles", "Related Files")}</h3>
                      <div className="flex flex-col gap-1">
                        {selected.relatedFiles.map(f => (
                          <button key={f} onClick={() => onOpenFile?.(f)} className="text-sm text-left px-2 py-1 rounded font-mono hover:underline" style={{ background: theme.bgMuted, color: theme.accent }}>📄 {f}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Execution Result */}
                  {selected.executionResult && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>⚡ {t("task.executionResult", "Execution Result")}</h3>
                      <div className="p-2 rounded" style={{ background: "#1e1b4b", color: "#c4b5fd" }}>
                        <div className="text-sm">{selected.executionResult.success ? "✅" : "❌"} {selected.executionResult.summary}</div>
                        {selected.executionResult.filesChanged?.length > 0 && (
                          <div className="mt-1 text-xs" style={{ opacity: 0.8 }}>{t("task.files", "Files")}: {selected.executionResult.filesChanged.join(", ")}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── NEW: Pipeline Progress Bar ── */}
                  {renderPipelineProgressBar(selected)}

                  {/* ── NEW: Spec section ── */}
                  {renderSpecSection(selected)}

                  {/* ── NEW: Changes section ── */}
                  {renderChangesSection(selected)}

                  {/* ── NEW: Test Result ── */}
                  {renderTestResultSection(selected)}

                  {/* ── NEW: QA Result ── */}
                  {renderQaResultSection(selected)}

                  {/* ── NEW: Git section ── */}
                  {renderGitSection(selected)}

                  {/* Discussion / Notes */}
                  <div className="mb-4">
                    <h3 className="text-xs font-semibold uppercase mb-1" style={{ opacity: 0.5 }}>{t("task.discussion", "Discussion")}</h3>
                    {/* Discussion summaries */}
                    {selected.discussion && selected.discussion.length > 0 && (
                      <div className="flex flex-col gap-1 mb-2">
                        {selected.discussion.map((d, i) => (
                          <div key={i} className="text-xs p-2 rounded" style={{ background: theme.bgMuted, color: theme.text, opacity: 0.8 }}>
                            💬 {d.summary}
                            <span className="text-[10px] ml-2" style={{ opacity: 0.4 }}>{new Date(d.at).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {selected.notes.length > 0 && (
                      <div className="flex flex-col gap-2 mb-2">
                        {selected.notes.map((note, i) => (
                          <div key={i} className="flex gap-2 items-start">
                            <span className="text-xs shrink-0">{note.by === "agent" || note.by === "em" ? "🤖" : "👤"}</span>
                            <div className="text-sm flex-1" style={{ color: theme.text }}>
                              <MarkdownText>{note.content}</MarkdownText>
                              <div className="text-[10px] mt-0.5" style={{ opacity: 0.4 }}>{new Date(note.at).toLocaleString()}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        ref={noteRef}
                        type="text"
                        value={noteInput}
                        onChange={e => setNoteInput(e.target.value)}
                        placeholder={t("task.addNote", "Add a note...")}
                        className="flex-1 text-xs px-2 py-1.5 rounded border outline-none"
                        style={inputStyle}
                        onKeyDown={e => { if (e.key === "Enter" && noteInput.trim()) { e.preventDefault(); handleAddNote(); } }}
                      />
                      <button
                        onClick={handleAddNote}
                        disabled={!noteInput.trim()}
                        className="text-xs px-2 py-1 rounded font-medium shrink-0"
                        style={{
                          background: noteInput.trim() ? theme.accentBg : theme.bgMuted,
                          color: noteInput.trim() ? theme.accent : theme.text,
                          opacity: noteInput.trim() ? 1 : 0.5,
                        }}
                      >
                        💬
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Diff Modal */}
      {renderDiffModal()}
    </div>
  );
}
