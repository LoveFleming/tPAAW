/**
 * PAAW Project Board — 專案管理看板
 * Dashboard + Detail（Board / Gantt 兩種視圖）+ 完整 CRUD
 */

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import API_BASE from "../api";
import GanttChart from "./GanttChart";
import ProjectAiPanel from "../components/ProjectAiPanel";

// ── Types ──
interface Task {
  id: string; name: string; status: string; priority: string;
  start: string; end: string; assignee: string;
}
interface Category {
  id: string; name: string; icon: string; description: string;
  tasks: Task[];
}
interface Milestone {
  id: string; name: string; status: string; note: string; date: string;
}
interface Project {
  id: string; name: string; icon: string; description: string;
  status: string; startDate: string; targetDate: string;
  repo: string; dashboard: string;
  categories: Category[]; milestones: Milestone[];
}
interface ProjectSummary {
  id: string; name: string; icon: string; description: string;
  status: string; startDate: string; targetDate: string;
  taskDone: number; taskTotal: number; taskPct: number;
  milestonesTotal: number; milestonesDone: number;
}

// ── Helpers ──
function sb(s: string) {
  if (s === "done") return { text: "已完成", bg: "#ecfdf5", color: "#065f46" };
  if (s === "progress" || s === "in-progress") return { text: "進行中", bg: "#eff6ff", color: "#1e40af" };
  if (s === "todo") return { text: "待辦", bg: "#fefce8", color: "#854d0e" };
  return { text: s, bg: "#f5f5f4", color: "#57534e" };
}
function pb(p: string) {
  if (p === "high") return { text: "高", bg: "#fef2f2", color: "#991b1b" };
  if (p === "medium") return { text: "中", bg: "#fefce8", color: "#854d0e" };
  return { text: "低", bg: "#ecfdf5", color: "#065f46" };
}
function pctColor(p: number) {
  if (p >= 70) return "#22c55e";
  if (p >= 40) return "#3b82f6";
  if (p >= 20) return "#f59e0b";
  return "#ef4444";
}
const inputCls = "w-full text-sm rounded-lg border px-3 py-2 outline-none transition-colors";

// ── Modal Helper Component ──
function Modal({ title, onClose, children, tk }: { title: string; onClose: () => void; children: React.ReactNode; tk: any }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.3)" }} onClick={onClose}>
      <div className="rounded-xl shadow-xl max-w-md w-full mx-4 p-5" style={{ background: tk.bg }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold" style={{ color: tk.textPrimary }}>{title}</h3>
          <button onClick={onClose} className="text-lg leading-none" style={{ color: tk.textMuted }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// Main Component
// ════════════════════════════════════════
export default function ProjectBoard() {
  const { t: tt } = useI18n();
  const { info: th } = useTheme();
  const tk = {
    bg: "#fff", bgMuted: "#fafafa", bgHover: th.accentLight || "#f5f5f4",
    border: th.accentBorder || "#e5e5e5", borderLight: "#f0f0f0",
    textPrimary: "#374151", textSecondary: "#6b7280", textMuted: "#9ca3af",
    accent: th.accent, accentBg: th.accentBg, accentText: th.accentText,
  };

  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [view, setView] = useState<"dashboard" | "detail">("dashboard");
  const [detailTab, setDetailTab] = useState<"board" | "gantt">("board");
  const [modal, setModal] = useState<null | { type: string; data?: any }>(null);
  const [aiPanel, setAiPanel] = useState<{ open: boolean; context: string; prompt?: string }>({ open: false, context: "" });

  // API helpers
  const api = {
    get: async (p: string) => (await fetch(`${API_BASE}${p}`)).json(),
    post: async (p: string, b?: any) => (await fetch(`${API_BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json(),
    put: async (p: string, b: any) => (await fetch(`${API_BASE}${p}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json(),
    del: async (p: string) => (await fetch(`${API_BASE}${p}`, { method: "DELETE" })).json(),
  };

  const loadSummaries = useCallback(async () => {
    const data = await api.get("/api/projects");
    setSummaries(data.projects || []);
  }, []);

  const loadProject = useCallback(async (id: string) => {
    const data = await api.get(`/api/projects/${id}`);
    if (data.project) setActive(data.project);
  }, []);

  useEffect(() => { loadSummaries(); }, [loadSummaries]);

  const refresh = async () => {
    if (active) await loadProject(active.id);
    await loadSummaries();
  };

  const openProject = async (id: string) => {
    await loadProject(id);
    setView("detail");
    setDetailTab("board");
  };

  // ── Actions ──
  const saveProject = async (data: any) => {
    if (data._isNew) {
      await api.post("/api/projects", { name: data.name, icon: data.icon, description: data.description, status: data.status });
    } else {
      await api.put(`/api/projects/${active!.id}`, data);
    }
    setModal(null);
    await refresh();
  };

  const deleteProject = async (id: string) => {
    if (!confirm(tt("project.confirmDeleteProject"))) return;
    await api.del(`/api/projects/${id}`);
    setView("dashboard");
    setActive(null);
    loadSummaries();
  };

  const addCategory = async (name: string, icon: string, desc: string) => {
    await api.post(`/api/projects/${active!.id}/categories`, { name, icon, description: desc });
    await refresh();
  };

  const updateCategory = async (catId: string, data: any) => {
    await api.put(`/api/projects/${active!.id}/categories/${catId}`, data);
    setModal(null);
    await refresh();
  };

  const deleteCategory = async (catId: string) => {
    if (!confirm(tt("project.confirmDeleteCategory"))) return;
    await api.del(`/api/projects/${active!.id}/categories/${catId}`);
    await refresh();
  };

  const addTask = async (catId: string, name: string, priority: string, start: string, end: string) => {
    await api.post(`/api/projects/${active!.id}/tasks`, { categoryId: catId, name, priority, start, end });
    await refresh();
  };

  const updateTask = async (taskId: string, data: any) => {
    await api.put(`/api/projects/${active!.id}/tasks/${taskId}`, data);
    setModal(null);
    await refresh();
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm(tt("project.confirmDeleteTask"))) return;
    await api.del(`/api/projects/${active!.id}/tasks/${taskId}`);
    await refresh();
  };

  const cycleTaskStatus = async (task: Task) => {
    const next = task.status === "done" ? "todo" : task.status === "todo" ? "progress" : "done";
    await api.put(`/api/projects/${active!.id}/tasks/${task.id}`, { status: next });
    await refresh();
  };

  const addMilestone = async (name: string, date: string) => {
    await api.post(`/api/projects/${active!.id}/milestones`, { name, date });
    await refresh();
  };

  const updateMilestone = async (msId: string, data: any) => {
    await api.put(`/api/projects/${active!.id}/milestones/${msId}`, data);
    setModal(null);
    await refresh();
  };

  const deleteMilestone = async (msId: string) => {
    if (!confirm(tt("project.confirmDeleteMilestone"))) return;
    await api.del(`/api/projects/${active!.id}/milestones/${msId}`);
    await refresh();
  };

  // ════════════════════════════════════════
  // DASHBOARD VIEW
  // ════════════════════════════════════════
  if (view === "dashboard") {
    const totalTasks = summaries.reduce((s, p) => s + p.taskTotal, 0);
    const doneTasks = summaries.reduce((s, p) => s + p.taskDone, 0);
    const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    return (
      <div className="flex h-full" style={{ background: tk.bg }}>
      {/* Main content */}
      <div className="flex-1 overflow-auto min-w-0">
        <div className="max-w-5xl mx-auto p-6">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl font-bold" style={{ color: tk.textPrimary }}>📋 Project Board</h1>
            <div className="flex items-center gap-2">
              <button onClick={() => setAiPanel({ open: true, context: tt("project.aiContextManage"), prompt: tt("project.aiPromptNewProject") })}
                className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors"
                style={{ background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe" }}>
                🤖 AI 建專案
              </button>
              <button onClick={() => setModal({ type: "project-new" })}
                className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors"
                style={{ background: tk.accentBg, color: tk.accentText, border: `1px solid ${tk.accent}` }}>
                ＋ 新專案
              </button>
            </div>
          </div>
          <p className="text-sm mb-6" style={{ color: tk.textSecondary }}>專案管理看板</p>

          {/* Overall stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: tt("project.statProjects"), value: summaries.length, sub: "進行中" },
              { label: tt("project.statTotalTasks"), value: totalTasks, sub: `${doneTasks} ${tt("project.statCompleted")}` },
              { label: tt("project.statCompletionRate"), value: `${overallPct}%`, sub: tt("project.statOverallProgress") },
              { label: tt("project.statMilestones"), value: `${summaries.reduce((s, p) => s + p.milestonesDone, 0)}/${summaries.reduce((s, p) => s + p.milestonesTotal, 0)}`, sub: "已完成" },
            ].map((s, i) => (
              <div key={i} className="rounded-xl border p-4" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                <div className="text-xs uppercase tracking-wider" style={{ color: tk.textMuted }}>{s.label}</div>
                <div className="text-2xl font-bold mt-1" style={{ color: tk.textPrimary }}>{s.value}</div>
                <div className="text-xs mt-0.5" style={{ color: tk.textSecondary }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Project cards */}
          <div className="grid md:grid-cols-2 gap-4">
            {summaries.map(p => (
              <div key={p.id} onClick={() => openProject(p.id)}
                className="rounded-xl border p-5 cursor-pointer transition-all hover:shadow-md"
                style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{p.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" style={{ color: tk.textPrimary }}>{p.name}</div>
                    <div className="text-xs truncate" style={{ color: tk.textMuted }}>{p.description}</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={sb(p.status)}>{sb(p.status).text}</span>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#e5e5e5" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${p.taskPct}%`, background: pctColor(p.taskPct) }} />
                  </div>
                  <span className="text-xs font-medium shrink-0" style={{ color: tk.textSecondary }}>{p.taskDone}/{p.taskTotal} · {p.taskPct}%</span>
                </div>
                {p.milestonesTotal > 0 && (
                  <div className="text-xs mt-2" style={{ color: tk.textMuted }}>🏁 {p.milestonesDone}/{p.milestonesTotal} 里程碑</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* New project modal */}
        {modal?.type === "project-new" && (
          <ProjectFormModal tk={tk} tt={tt} onClose={() => setModal(null)} onSave={saveProject} />
        )}
      </div>

      {/* AI Side Panel — inside Project App */}
      {aiPanel.open && (
        <div className="w-[420px] shrink-0 border-l" style={{ borderColor: tk.borderLight }}>
          <ProjectAiPanel
            context={aiPanel.context}
            initialPrompt={aiPanel.prompt}
            tk={tk}
            onClose={() => setAiPanel({ open: false, context: "" })}
          />
        </div>
      )}
    </div>
    );
  }

  // ════════════════════════════════════════
  // DETAIL VIEW
  // ════════════════════════════════════════
  if (!active) return <div className="p-8" style={{ color: tk.textMuted }}>載入中…</div>;

  const allTasks = active.categories.flatMap(c => c.tasks);
  const doneN = allTasks.filter(t => t.status === "done").length;
  const progN = allTasks.filter(t => t.status === "progress").length;
  const totalN = allTasks.length;
  const pctN = totalN > 0 ? Math.round((doneN / totalN) * 100) : 0;

  return (
    <div className="flex h-full" style={{ background: tk.bg }}>
    {/* Main content */}
    <div className="flex-1 overflow-auto min-w-0">
      <div className="max-w-5xl mx-auto p-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => { setView("dashboard"); setActive(null); }}
            className="text-sm hover:underline" style={{ color: tk.accent }}>← Dashboard</button>
          <div className="flex items-center gap-2">
            <button onClick={() => setDetailTab("board")}
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: detailTab === "board" ? tk.accentBg : "transparent", color: detailTab === "board" ? tk.accentText : tk.textSecondary, border: `1px solid ${detailTab === "board" ? tk.accent : tk.border}` }}>
              📋 Board
            </button>
            <button onClick={() => setDetailTab("gantt")}
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: detailTab === "gantt" ? tk.accentBg : "transparent", color: detailTab === "gantt" ? tk.accentText : tk.textSecondary, border: `1px solid ${detailTab === "gantt" ? tk.accent : tk.border}` }}>
              📅 Gantt
            </button>
            <span className="w-px h-5 mx-1" style={{ background: tk.borderLight }} />
            <button onClick={() => setModal({ type: "project-edit" })}
              className="text-xs px-2 py-1.5 rounded-lg" style={{ color: tk.textSecondary, border: `1px solid ${tk.border}` }}>✏️ 編輯</button>
            <button onClick={() => setAiPanel({ open: true, context: `專案「${active.name}」(ID: ${active.id})，狀態: ${active.status}，完成率: ${pctN}%`, prompt: `幫我管理專案「${active.name}」` })}
              className="text-xs px-2.5 py-1.5 rounded-lg font-medium" style={{ background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe" }}>🤖 專案助理</button>
            {active.id !== "paaw" && (
              <button onClick={() => deleteProject(active.id)}
                className="text-xs px-2 py-1.5 rounded-lg" style={{ color: "#ef4444", border: "1px solid #fecaca" }}>🗑️ 刪除</button>
            )}
          </div>
        </div>

        {/* Project header */}
        <div className="flex items-start gap-4 mb-6">
          <span className="text-4xl">{active.icon}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold" style={{ color: tk.textPrimary }}>{active.name}</h1>
            <p className="text-sm mt-1" style={{ color: tk.textSecondary }}>{active.description}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={sb(active.status)}>{sb(active.status).text}</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#eff6ff", color: "#1e40af" }}>📅 {active.startDate} → {active.targetDate}</span>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: tt("project.statCompletionRate"), value: `${pctN}%`, color: pctColor(pctN) },
            { label: "已完成", value: doneN, color: "#22c55e" },
            { label: "進行中", value: progN, color: "#3b82f6" },
            { label: "待辦", value: totalN - doneN - progN, color: "#9ca3af" },
          ].map((s, i) => (
            <div key={i} className="rounded-xl border p-4" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
              <div className="text-xs uppercase tracking-wider" style={{ color: tk.textMuted }}>{s.label}</div>
              <div className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── BOARD TAB ── */}
        {detailTab === "board" && (
          <>
            {/* Categories */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold" style={{ color: tk.textPrimary }}>分類任務</h2>
              <button onClick={() => setModal({ type: "category-new" })}
                className="text-xs px-2 py-1 rounded-lg" style={{ color: tk.accent, border: `1px solid ${tk.border}` }}>＋ 分類</button>
            </div>
            <div className="space-y-4 mb-8">
              {active.categories.map(cat => {
                const cDone = cat.tasks.filter(t => t.status === "done").length;
                const cTotal = cat.tasks.length;
                const cPct = cTotal > 0 ? Math.round((cDone / cTotal) * 100) : 0;
                return (
                  <div key={cat.id} className="rounded-xl border p-5" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                    {/* Category header */}
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold flex items-center gap-2" style={{ color: tk.textPrimary }}>
                        <span>{cat.icon}</span> {cat.name}
                        <span className="text-xs font-normal" style={{ color: tk.textMuted }}>{cPct}%</span>
                      </h3>
                      <div className="flex items-center gap-1 opacity-0 hover:opacity-100 transition-opacity" style={{ opacity: 0.7 }}>
                        <button onClick={() => setModal({ type: "task-new", data: { catId: cat.id } })}
                          className="text-xs px-1.5 py-0.5 rounded" style={{ color: tk.accent }}>＋任務</button>
                        <button onClick={() => setModal({ type: "category-edit", data: cat })}
                          className="text-xs px-1.5 py-0.5 rounded" style={{ color: tk.textSecondary }}>✏️</button>
                        <button onClick={() => deleteCategory(cat.id)}
                          className="text-xs px-1.5 py-0.5 rounded" style={{ color: "#ef4444" }}>🗑️</button>
                      </div>
                    </div>
                    <p className="text-xs mb-3" style={{ color: tk.textMuted }}>{cat.description}</p>
                    <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: "#e5e5e5" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${cPct}%`, background: pctColor(cPct) }} />
                    </div>
                    {/* Tasks */}
                    <div className="space-y-1">
                      {cat.tasks.map(task => {
                        const s = sb(task.status);
                        const p = pb(task.priority);
                        return (
                          <div key={task.id} className="group flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-white/60 transition-colors">
                            <button onClick={() => cycleTaskStatus(task)} className="text-sm shrink-0" title={tt("project.clickSwitchStatus")}>
                              {task.status === "done" ? "✅" : task.status === "progress" ? "🔧" : "⬜"}
                            </button>
                            <span className="flex-1 text-sm" style={{
                              color: tk.textPrimary,
                              textDecoration: task.status === "done" ? "line-through" : "none",
                              opacity: task.status === "done" ? 0.6 : 1,
                            }}>{task.name}</span>
                            {task.start && task.end && (
                              <span className="text-xs hidden md:inline shrink-0" style={{ color: tk.textMuted }}>
                                {task.start} ~ {task.end}
                              </span>
                            )}
                            <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: p.bg, color: p.color }}>{p.text}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: s.bg, color: s.color }}>{s.text}</span>
                            <div className="flex items-center gap-0.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                              <button onClick={() => setModal({ type: "task-edit", data: { task, catId: cat.id } })}
                                className="text-xs px-1 rounded hover:bg-gray-100" style={{ color: tk.textMuted }}>✏️</button>
                              <button onClick={() => deleteTask(task.id)}
                                className="text-xs px-1 rounded hover:bg-gray-100" style={{ color: "#ef4444" }}>🗑️</button>
                            </div>
                          </div>
                        );
                      })}
                      {/* Quick add task */}
                      <QuickAddTask tt={tt} onAdd={(name, priority, start, end) => addTask(cat.id, name, priority, start, end)} tk={tk} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Milestones */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold" style={{ color: tk.textPrimary }}>{tt("project.statMilestones")}</h2>
              <button onClick={() => setModal({ type: "milestone-new" })}
                className="text-xs px-2 py-1 rounded-lg" style={{ color: tk.accent, border: `1px solid ${tk.border}` }}>＋ 里程碑</button>
            </div>
            <div className="space-y-2 mb-8">
              {active.milestones.map(m => {
                const s = sb(m.status);
                return (
                  <div key={m.id} className="group flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                    <span className="text-lg shrink-0">{m.status === "done" ? "✅" : m.status === "progress" ? "🔧" : "⬜"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm" style={{ color: tk.textPrimary }}>{m.name}</div>
                      {m.note && <div className="text-xs mt-0.5" style={{ color: tk.textMuted }}>{m.note}</div>}
                    </div>
                    {m.date && <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: s.bg, color: s.color }}>{m.date}</span>}
                    <div className="flex items-center gap-0.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setModal({ type: "milestone-edit", data: m })}
                        className="text-xs px-1 rounded hover:bg-gray-100" style={{ color: tk.textMuted }}>✏️</button>
                      <button onClick={() => deleteMilestone(m.id)}
                        className="text-xs px-1 rounded hover:bg-gray-100" style={{ color: "#ef4444" }}>🗑️</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── GANTT TAB ── */}
        {detailTab === "gantt" && (
          <GanttChart project={active} tk={tk} />
        )}
      </div>
      {/* end max-w-5xl */}

      {/* ── Modals ── */}
      {modal?.type === "project-edit" && (
        <ProjectFormModal tk={tk} tt={tt} project={active} onClose={() => setModal(null)} onSave={saveProject} />
      )}
      {modal?.type === "category-new" && (
        <CategoryFormModal tk={tk} tt={tt} onClose={() => setModal(null)} onSave={(n, i, d) => { addCategory(n, i, d); setModal(null); }} />
      )}
      {modal?.type === "category-edit" && (
        <CategoryFormModal tk={tk} tt={tt} category={modal.data} onClose={() => setModal(null)}
          onSave={(n, i, d) => updateCategory(modal.data.id, { name: n, icon: i, description: d })} />
      )}
      {modal?.type === "task-new" && (
        <TaskFormModal tk={tk} tt={tt} onClose={() => setModal(null)}
          onSave={(n, p, s, e) => { addTask(modal.data.catId, n, p, s, e); setModal(null); }} />
      )}
      {modal?.type === "task-edit" && (
        <TaskFormModal tk={tk} tt={tt} task={modal.data.task} onClose={() => setModal(null)}
          onSave={(n, p, s, e, st) => updateTask(modal.data.task.id, { name: n, priority: p, start: s, end: e, status: st })} />
      )}
      {modal?.type === "milestone-new" && (
        <MilestoneFormModal tk={tk} tt={tt} onClose={() => setModal(null)}
          onSave={(n, d) => { addMilestone(n, d); setModal(null); }} />
      )}
      {modal?.type === "milestone-edit" && (
        <MilestoneFormModal tk={tk} tt={tt} milestone={modal.data} onClose={() => setModal(null)}
          onSave={(n, d) => updateMilestone(modal.data.id, { name: n, date: d })} />
      )}
    </div> {/* end flex-1 */}

    {/* AI Side Panel — inside Project App */}
    {aiPanel.open && (
      <div className="w-[420px] shrink-0 border-l" style={{ borderColor: tk.borderLight }}>
        <ProjectAiPanel
          context={aiPanel.context}
          initialPrompt={aiPanel.prompt}
          tk={tk}
          onClose={() => setAiPanel({ open: false, context: "" })}
        />
      </div>
    )}
    </div>
    );
}

// ════════════════════════════════════════
// Quick Add Task (inline)
// ════════════════════════════════════════
function QuickAddTask({ onAdd, tk, tt }: { onAdd: (name: string, priority: string, start: string, end: string) => void; tk: any; tt: (k: string, f?: string) => string }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)}
        className="text-xs px-2 py-1 rounded w-full text-left hover:bg-white/50 transition-colors"
        style={{ color: tk.textMuted }}>＋ 新任務…</button>
    );
  }
  return (
    <div className="flex items-center gap-1 py-1 px-2 rounded-lg" style={{ background: "#fff", border: `1px solid ${tk.border}` }}>
      <input autoFocus value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && name.trim()) { onAdd(name.trim(), "medium", "", ""); setName(""); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
        placeholder={tt("project.taskNamePlaceholder")}
        className="flex-1 text-sm outline-none bg-transparent" style={{ color: tk.textPrimary }} />
      <button onClick={() => { if (name.trim()) { onAdd(name.trim(), "medium", "", ""); setName(""); setEditing(false); } }}
        className="text-xs px-2 py-0.5 rounded" style={{ background: tk.accentBg, color: tk.accentText }}>{tt("common.confirm")}</button>
      <button onClick={() => setEditing(false)}
        className="text-xs px-2 py-0.5 rounded" style={{ color: tk.textMuted }}>{tt("common.cancel")}</button>
    </div>
  );
}

// ════════════════════════════════════════
// Form Modals
// ════════════════════════════════════════
function ProjectFormModal({ tk, tt, project, onClose, onSave }: { tk: any; tt: (k: string, f?: string) => string; project?: any; onClose: () => void; onSave: (d: any) => void }) {
  const [name, setName] = useState(project?.name || "");
  const [icon, setIcon] = useState(project?.icon || "📋");
  const [desc, setDesc] = useState(project?.description || "");
  const [status, setStatus] = useState(project?.status || "todo");
  const [startDate, setStartDate] = useState(project?.startDate || new Date().toISOString().slice(0, 10));
  const [targetDate, setTargetDate] = useState(project?.targetDate || "");
  return (
    <Modal title={project ? tt("project.editProject") : tt("project.newProject")} onClose={onClose} tk={tk}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className={inputCls} style={{ width: 48, textAlign: "center", borderColor: tk.border, color: tk.textPrimary }} value={icon} onChange={e => setIcon(e.target.value)} />
          <input className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} placeholder={tt("project.namePlaceholder")} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <textarea className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary, resize: "none" }} rows={2} placeholder={tt("common.description")} value={desc} onChange={e => setDesc(e.target.value)} />
        <div className="flex gap-2">
          <select className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="todo">{tt("project.statusTodo")}</option>
            <option value="in-progress">{tt("project.statusProgress")}</option>
            <option value="done">{tt("project.statusDone")}</option>
          </select>
          <input type="date" className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} value={startDate} onChange={e => setStartDate(e.target.value)} />
          <input type="date" className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} value={targetDate} onChange={e => setTargetDate(e.target.value)} />
        </div>
        <button onClick={() => onSave({ _isNew: !project, name, icon, description: desc, status, startDate, targetDate })}
          disabled={!name.trim()}
          className="w-full text-sm font-medium rounded-lg py-2 transition-colors disabled:opacity-40"
          style={{ background: tk.accentBg, color: tk.accentText, border: `1px solid ${tk.accent}` }}>
          儲存
        </button>
      </div>
    </Modal>
  );
}

function CategoryFormModal({ tk, tt, category, onClose, onSave }: { tk: any; tt: (k: string, f?: string) => string; category?: any; onClose: () => void; onSave: (n: string, i: string, d: string) => void }) {
  const [name, setName] = useState(category?.name || "");
  const [icon, setIcon] = useState(category?.icon || "📁");
  const [desc, setDesc] = useState(category?.description || "");
  return (
    <Modal title={category ? tt("project.editCategory") : tt("project.newCategory")} onClose={onClose} tk={tk}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className={inputCls} style={{ width: 48, textAlign: "center", borderColor: tk.border, color: tk.textPrimary }} value={icon} onChange={e => setIcon(e.target.value)} />
          <input className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} placeholder={tt("project.categoryNamePlaceholder")} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <input className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} placeholder={tt("common.description")} value={desc} onChange={e => setDesc(e.target.value)} />
        <button onClick={() => name.trim() && onSave(name.trim(), icon, desc)}
          disabled={!name.trim()}
          className="w-full text-sm font-medium rounded-lg py-2 disabled:opacity-40"
          style={{ background: tk.accentBg, color: tk.accentText, border: `1px solid ${tk.accent}` }}>
          儲存
        </button>
      </div>
    </Modal>
  );
}

function TaskFormModal({ tk, tt, task, onClose, onSave }: { tk: any; tt: (k: string, f?: string) => string; task?: any; onClose: () => void; onSave: (n: string, p: string, s: string, e: string, st: string) => void }) {
  const [name, setName] = useState(task?.name || "");
  const [priority, setPriority] = useState(task?.priority || "medium");
  const [status, setStatus] = useState(task?.status || "todo");
  const [start, setStart] = useState(task?.start || "");
  const [end, setEnd] = useState(task?.end || "");
  return (
    <Modal title={task ? tt("project.editTask") : tt("project.newTask")} onClose={onClose} tk={tk}>
      <div className="space-y-3">
        <input autoFocus className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} placeholder={tt("project.taskNamePlaceholder")} value={name} onChange={e => setName(e.target.value)} />
        <div className="flex gap-2">
          <select className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="high">高優先</option>
            <option value="medium">中優先</option>
            <option value="low">低優先</option>
          </select>
          {task && (
            <select className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="todo">{tt("project.statusTodo")}</option>
              <option value="progress">{tt("project.statusProgress")}</option>
              <option value="done">{tt("project.statusDone")}</option>
            </select>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <label className="text-xs block mb-1" style={{ color: tk.textMuted }}>開始日</label>
            <input type="date" className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="text-xs block mb-1" style={{ color: tk.textMuted }}>結束日</label>
            <input type="date" className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} value={end} onChange={e => setEnd(e.target.value)} />
          </div>
        </div>
        <button onClick={() => name.trim() && onSave(name.trim(), priority, start, end, status)}
          disabled={!name.trim()}
          className="w-full text-sm font-medium rounded-lg py-2 disabled:opacity-40"
          style={{ background: tk.accentBg, color: tk.accentText, border: `1px solid ${tk.accent}` }}>
          儲存
        </button>
      </div>
    </Modal>
  );
}

function MilestoneFormModal({ tk, tt, milestone, onClose, onSave }: { tk: any; tt: (k: string, f?: string) => string; milestone?: any; onClose: () => void; onSave: (n: string, d: string) => void }) {
  const [name, setName] = useState(milestone?.name || "");
  const [date, setDate] = useState(milestone?.date || "");
  return (
    <Modal title={milestone ? tt("project.editMilestone") : tt("project.newMilestone")} onClose={onClose} tk={tk}>
      <div className="space-y-3">
        <input autoFocus className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} placeholder={tt("project.milestoneNamePlaceholder")} value={name} onChange={e => setName(e.target.value)} />
        <div>
          <label className="text-xs block mb-1" style={{ color: tk.textMuted }}>日期（或月份）</label>
          <input type="date" className={inputCls} style={{ borderColor: tk.border, color: tk.textPrimary }} value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button onClick={() => name.trim() && onSave(name.trim(), date)}
          disabled={!name.trim()}
          className="w-full text-sm font-medium rounded-lg py-2 disabled:opacity-40"
          style={{ background: tk.accentBg, color: tk.accentText, border: `1px solid ${tk.accent}` }}>
          儲存
        </button>
      </div>
    </Modal>
  );
}
