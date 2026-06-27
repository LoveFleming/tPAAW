/**
 * PAAW Project Board — 專案管理看板
 * Dashboard + Project Detail（主題整合）
 */

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "../theme";
import API_BASE from "../api";

interface Task {
  id: string;
  name: string;
  status: "done" | "progress" | "todo";
  priority: "high" | "medium" | "low";
}

interface Category {
  id: string;
  name: string;
  icon: string;
  description: string;
  tasks: Task[];
}

interface Milestone {
  id: string;
  name: string;
  status: "done" | "progress" | "todo";
  note: string;
  date: string;
}

interface Project {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: string;
  startDate: string;
  targetDate: string;
  repo: string;
  dashboard: string;
  categories: Category[];
  milestones: Milestone[];
}

interface ProjectSummary {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: string;
  startDate: string;
  targetDate: string;
  taskDone: number;
  taskTotal: number;
  taskPct: number;
  milestonesTotal: number;
  milestonesDone: number;
}

function statusBadge(status: string) {
  if (status === "done") return { text: "已完成", bg: "#ecfdf5", color: "#065f46" };
  if (status === "progress") return { text: "進行中", bg: "#eff6ff", color: "#1e40af" };
  if (status === "in-progress") return { text: "進行中", bg: "#eff6ff", color: "#1e40af" };
  if (status === "todo") return { text: "未開始", bg: "#fefce8", color: "#854d0e" };
  return { text: status, bg: "#f5f5f4", color: "#57534e" };
}

function priorityBadge(priority: string) {
  if (priority === "high") return { text: "高", bg: "#fef2f2", color: "#991b1b" };
  if (priority === "medium") return { text: "中", bg: "#fefce8", color: "#854d0e" };
  return { text: "低", bg: "#ecfdf5", color: "#065f46" };
}

function progressColor(pct: number) {
  if (pct >= 70) return "#22c55e";
  if (pct >= 40) return "#3b82f6";
  if (pct >= 20) return "#f59e0b";
  return "#ef4444";
}

export default function ProjectBoard() {
  const { info: th } = useTheme();
  const tk = {
    bg: "#fff", bgMuted: "#fafafa", bgHover: th.accentLight || "#f5f5f4",
    border: th.accentBorder || "#e5e5e5", borderLight: "#f0f0f0",
    textPrimary: "#374151", textSecondary: "#6b7280", textMuted: "#9ca3af",
    accent: th.accent, accentBg: th.accentBg, accentText: th.accentText,
  };

  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [view, setView] = useState<"dashboard" | "detail">("dashboard");
  const [loading, setLoading] = useState(false);

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
    if (data.project) setActiveProject(data.project);
  }, []);

  useEffect(() => { loadSummaries(); }, [loadSummaries]);

  const openProject = async (id: string) => {
    setLoading(true);
    await loadProject(id);
    setView("detail");
    setLoading(false);
  };

  // ── Task toggle ──
  const toggleTask = async (task: Task) => {
    if (!activeProject) return;
    const next = task.status === "done" ? "todo" : task.status === "todo" ? "progress" : "done";
    await api.put(`/api/projects/${activeProject.id}/tasks/${task.id}`, { status: next });
    await loadProject(activeProject.id);
  };

  // ── Dashboard View ──
  if (view === "dashboard") {
    const totalTasks = summaries.reduce((s, p) => s + p.taskTotal, 0);
    const doneTasks = summaries.reduce((s, p) => s + p.taskDone, 0);
    const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    return (
      <div className="h-full overflow-auto" style={{ background: tk.bg }}>
        <div className="max-w-5xl mx-auto p-6">
          <h1 className="text-2xl font-bold mb-1" style={{ color: tk.textPrimary }}>📋 Project Board</h1>
          <p className="text-sm mb-6" style={{ color: tk.textSecondary }}>專案管理看板</p>

          {/* Overall stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "專案數", value: summaries.length, sub: "進行中" },
              { label: "總任務", value: totalTasks, sub: `${doneTasks} 完成` },
              { label: "完成率", value: `${overallPct}%`, sub: "整體進度" },
              { label: "里程碑", value: `${summaries.reduce((s, p) => s + p.milestonesDone, 0)}/${summaries.reduce((s, p) => s + p.milestonesTotal, 0)}`, sub: "已完成" },
            ].map((s, i) => (
              <div key={i} className="rounded-xl border p-4" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                <div className="text-xs uppercase tracking-wider" style={{ color: tk.textMuted }}>{s.label}</div>
                <div className="text-2xl font-bold mt-1" style={{ color: tk.textPrimary }}>{s.value}</div>
                <div className="text-xs mt-0.5" style={{ color: tk.textSecondary }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Project cards */}
          <h2 className="text-lg font-semibold mb-3" style={{ color: tk.textPrimary }}>專案列表</h2>
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
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
                    style={statusBadge(p.status)}>{statusBadge(p.status).text}</span>
                </div>
                {/* Progress */}
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#e5e5e5" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${p.taskPct}%`, background: progressColor(p.taskPct) }} />
                  </div>
                  <span className="text-xs font-medium shrink-0" style={{ color: tk.textSecondary }}>{p.taskDone}/{p.taskTotal} · {p.taskPct}%</span>
                </div>
                {p.milestonesTotal > 0 && (
                  <div className="text-xs mt-2" style={{ color: tk.textMuted }}>
                    🏁 {p.milestonesDone}/{p.milestonesTotal} 里程碑
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Detail View ──
  if (!activeProject) return <div className="p-8" style={{ color: tk.textMuted }}>載入中...</div>;

  const allTasks = activeProject.categories.flatMap(c => c.tasks);
  const done = allTasks.filter(t => t.status === "done").length;
  const progress = allTasks.filter(t => t.status === "progress").length;
  const total = allTasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="h-full overflow-auto" style={{ background: tk.bg }}>
      <div className="max-w-5xl mx-auto p-6">
        {/* Back */}
        <button onClick={() => { setView("dashboard"); setActiveProject(null); }}
          className="text-sm mb-4 hover:underline" style={{ color: tk.accent }}>← 回 Dashboard</button>

        {/* Project header */}
        <div className="flex items-start gap-4 mb-6">
          <span className="text-4xl">{activeProject.icon}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold" style={{ color: tk.textPrimary }}>{activeProject.name}</h1>
            <p className="text-sm mt-1" style={{ color: tk.textSecondary }}>{activeProject.description}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={statusBadge(activeProject.status)}>{statusBadge(activeProject.status).text}</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#eff6ff", color: "#1e40af" }}>📅 {activeProject.startDate} → {activeProject.targetDate}</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "完成率", value: `${pct}%`, color: progressColor(pct) },
            { label: "已完成", value: done, color: "#22c55e" },
            { label: "進行中", value: progress, color: "#3b82f6" },
            { label: "未開始", value: total - done - progress, color: "#9ca3af" },
          ].map((s, i) => (
            <div key={i} className="rounded-xl border p-4" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
              <div className="text-xs uppercase tracking-wider" style={{ color: tk.textMuted }}>{s.label}</div>
              <div className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Categories */}
        <h2 className="text-lg font-semibold mb-3" style={{ color: tk.textPrimary }}>📋 分類任務</h2>
        <div className="space-y-4 mb-8">
          {activeProject.categories.map(cat => {
            const cDone = cat.tasks.filter(t => t.status === "done").length;
            const cTotal = cat.tasks.length;
            const cPct = cTotal > 0 ? Math.round((cDone / cTotal) * 100) : 0;

            return (
              <div key={cat.id} className="rounded-xl border p-5" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold flex items-center gap-2" style={{ color: tk.textPrimary }}>
                    <span>{cat.icon}</span> {cat.name}
                  </h3>
                  <span className="text-sm font-medium" style={{ color: tk.textSecondary }}>{cPct}%</span>
                </div>
                <p className="text-xs mb-3" style={{ color: tk.textMuted }}>{cat.description}</p>
                {/* Progress bar */}
                <div className="h-1.5 rounded-full overflow-hidden mb-4" style={{ background: "#e5e5e5" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${cPct}%`, background: progressColor(cPct) }} />
                </div>
                {/* Task list */}
                <div className="space-y-1">
                  {cat.tasks.map(task => {
                    const sb = statusBadge(task.status);
                    const pb = priorityBadge(task.priority);
                    return (
                      <div key={task.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-white/60 transition-colors cursor-pointer"
                        onClick={() => toggleTask(task)}>
                        <span className="text-sm shrink-0">
                          {task.status === "done" ? "✅" : task.status === "progress" ? "🔧" : "⬜"}
                        </span>
                        <span className="flex-1 text-sm" style={{
                          color: tk.textPrimary,
                          textDecoration: task.status === "done" ? "line-through" : "none",
                          opacity: task.status === "done" ? 0.6 : 1,
                        }}>{task.name}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: pb.bg, color: pb.color }}>{pb.text}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: sb.bg, color: sb.color }}>{sb.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Milestones */}
        <h2 className="text-lg font-semibold mb-3" style={{ color: tk.textPrimary }}>🏁 里程碑</h2>
        <div className="space-y-2 mb-8">
          {activeProject.milestones.map(m => {
            const sb = statusBadge(m.status);
            return (
              <div key={m.id} className="flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
                <span className="text-lg shrink-0">
                  {m.status === "done" ? "✅" : m.status === "progress" ? "🔧" : "⬜"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm" style={{ color: tk.textPrimary }}>{m.name}</div>
                  {m.note && <div className="text-xs mt-0.5" style={{ color: tk.textMuted }}>{m.note}</div>}
                </div>
                {m.date && <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: sb.bg, color: sb.color }}>{m.date}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
