/**
 * Gantt Chart — 甘特圖元件
 * 時間軸 + 任務條 + 里程碑 + 今日線
 */

import { useMemo, useState } from "react";
import { useI18n } from "../i18n";

interface GanttTask {
  id: string;
  name: string;
  status: string;
  priority: string;
  start: string;
  end: string;
}

interface GanttCategory {
  id: string;
  name: string;
  icon: string;
  tasks: GanttTask[];
}

interface GanttMilestone {
  id: string;
  name: string;
  status: string;
  note: string;
  date: string;
}

interface Project {
  id: string;
  name: string;
  categories: GanttCategory[];
  milestones: GanttMilestone[];
  startDate: string;
  targetDate: string;
}

function parseDate(s: string): number | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d.getTime();
}

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function statusColor(status: string): string {
  if (status === "done") return "#22c55e";
  if (status === "progress" || status === "in-progress") return "#3b82f6";
  if (status === "todo") return "#d1d5db";
  return "#9ca3af";
}

function monthLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dayLabel(ts: number): string {
  return String(new Date(ts).getDate());
}

interface Props {
  project: Project;
  tk: any;
}

export default function GanttChart({ project, tk }: Props) {
  const { t: tt } = useI18n();
  const [zoom, setZoom] = useState<"day" | "week" | "month">("week");

  // 收集所有有日期的任務 + 里程碑
  const { minDate, maxDate, scheduledTasks, unscheduledTasks, milestones } = useMemo(() => {
    const sTasks: { cat: GanttCategory; task: GanttTask }[] = [];
    const uTasks: { cat: GanttCategory; task: GanttTask }[] = [];
    const mStones: GanttMilestone[] = [];
    let dates: number[] = [];

    for (const cat of project.categories) {
      for (const t of cat.tasks) {
        const s = parseDate(t.start);
        const e = parseDate(t.end);
        if (s && e) {
          sTasks.push({ cat, task: t });
          dates.push(s, e);
        } else if (s) {
          sTasks.push({ cat, task: { ...t, end: t.start } });
          dates.push(s);
        } else {
          uTasks.push({ cat, task: t });
        }
      }
    }

    for (const m of project.milestones) {
      const d = parseDate(m.date || "");
      if (d) {
        mStones.push(m);
        dates.push(d);
      }
    }

    // 也考慮專案日期
    const ps = parseDate(project.startDate);
    const pe = parseDate(project.targetDate);
    if (ps) dates.push(ps);
    if (pe) dates.push(pe);

    if (dates.length === 0) {
      const now = Date.now();
      dates = [now, now + 30 * 86400000];
    }

    const min = Math.min(...dates);
    const max = Math.max(...dates);
    // padding
    const padDays = zoom === "day" ? 3 : zoom === "week" ? 7 : 30;
    return {
      minDate: min - padDays * 86400000,
      maxDate: max + padDays * 86400000,
      scheduledTasks: sTasks,
      unscheduledTasks: uTasks,
      milestones: mStones,
    };
  }, [project, zoom]);

  const totalDays = Math.ceil((maxDate - minDate) / 86400000);
  const dayWidth = zoom === "day" ? 36 : zoom === "week" ? 18 : 7;
  const timelineWidth = totalDays * dayWidth;

  // 生成月份刻度
  const monthTicks = useMemo(() => {
    const ticks: { ts: number; label: string }[] = [];
    let cur = new Date(minDate);
    cur.setUTCDate(1);
    cur.setUTCHours(0, 0, 0, 0);
    while (cur.getTime() <= maxDate) {
      const ts = cur.getTime();
      if (ts >= minDate - 86400000 * 32) {
        ticks.push({ ts, label: monthLabel(ts) });
      }
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    return ticks;
  }, [minDate, maxDate]);

  // 今日線
  const today = Date.now();
  const todayOffset = Math.max(0, Math.floor((today - minDate) / 86400000));
  const todayLeft = todayOffset * dayWidth;

  function taskBarStyle(task: GanttTask) {
    const s = parseDate(task.start)!;
    const e = parseDate(task.end || task.start)!;
    const left = Math.floor((s - minDate) / 86400000) * dayWidth;
    const days = Math.max(1, Math.ceil((e - s) / 86400000) + 1);
    const width = days * dayWidth;
    return { left, width };
  }

  function milestonePos(dateStr: string) {
    const d = parseDate(dateStr)!;
    return Math.floor((d - minDate) / 86400000) * dayWidth;
  }

  // 按 category 分組已排程任務
  const catGroups = useMemo(() => {
    const map = new Map<string, { cat: GanttCategory; tasks: { task: GanttTask }[] }>();
    for (const { cat, task } of scheduledTasks) {
      if (!map.has(cat.id)) map.set(cat.id, { cat, tasks: [] });
      map.get(cat.id)!.tasks.push({ task });
    }
    return Array.from(map.values());
  }, [scheduledTasks]);

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: tk.borderLight, background: tk.bg }}>
        <span className="text-sm font-medium" style={{ color: tk.textPrimary }}>📅 {project.name} — 甘特圖</span>
        <div className="flex items-center gap-1">
          {(["day", "week", "month"] as const).map(z => (
            <button key={z} onClick={() => setZoom(z)}
              className="text-xs px-2 py-1 rounded font-medium transition-colors"
              style={{
                background: zoom === z ? tk.accentBg : "transparent",
                color: zoom === z ? tk.accentText : tk.textSecondary,
                border: `1px solid ${zoom === z ? tk.accent : tk.border}`,
              }}>
              {z === "day" ? "日" : z === "week" ? "週" : "月"}
            </button>
          ))}
        </div>
      </div>

      {/* Gantt body */}
      <div className="flex" style={{ minHeight: 300 }}>
        {/* Left: task labels */}
        <div className="shrink-0 border-r" style={{ width: 220, borderColor: tk.borderLight }}>
          {/* Header spacer */}
          <div className="h-14 border-b flex items-end px-3 pb-1" style={{ borderColor: tk.borderLight }}>
            <span className="text-xs font-medium" style={{ color: tk.textMuted }}>任務 / 分類</span>
          </div>
          {/* Category rows */}
          {catGroups.map(({ cat, tasks }) => (
            <div key={cat.id}>
              {/* Category header */}
              <div className="h-8 flex items-center px-3 border-b" style={{ borderColor: tk.borderLight, background: "#fafafa" }}>
                <span className="text-xs font-semibold truncate" style={{ color: tk.textPrimary }}>
                  {cat.icon} {cat.name}
                </span>
              </div>
              {/* Task rows */}
              {tasks.map(({ task }) => (
                <div key={task.id} className="h-7 flex items-center px-3 border-b" style={{ borderColor: tk.borderLight }}>
                  <span className="text-xs truncate" style={{ color: tk.textSecondary }}>{task.name}</span>
                </div>
              ))}
            </div>
          ))}
          {/* Milestones header */}
          {milestones.length > 0 && (
            <div className="h-8 flex items-center px-3 border-b" style={{ borderColor: tk.borderLight, background: "#fafafa" }}>
              <span className="text-xs font-semibold" style={{ color: tk.textPrimary }}>🏁 里程碑</span>
            </div>
          )}
          {milestones.map(m => (
            <div key={m.id} className="h-7 flex items-center px-3 border-b" style={{ borderColor: tk.borderLight }}>
              <span className="text-xs truncate" style={{ color: tk.textSecondary }}>{m.name}</span>
            </div>
          ))}
        </div>

        {/* Right: timeline */}
        <div className="flex-1 overflow-x-auto">
          <div style={{ width: Math.max(timelineWidth, 400), position: "relative" }}>
            {/* Month header */}
            <div className="h-8 border-b relative" style={{ borderColor: tk.borderLight, width: "100%" }}>
              {monthTicks.map((tick, i) => {
                const left = Math.floor((tick.ts - minDate) / 86400000) * dayWidth;
                return (
                  <div key={i} className="absolute top-0 h-full flex items-center px-1"
                    style={{ left, minWidth: 40 }}>
                    <span className="text-xs font-medium" style={{ color: tk.textSecondary }}>{tick.label}</span>
                  </div>
                );
              })}
            </div>
            {/* Day header (only for day/week zoom) */}
            {zoom !== "month" && (
              <div className="h-6 border-b relative" style={{ borderColor: tk.borderLight, width: "100%" }}>
                {Array.from({ length: totalDays }, (_, i) => {
                  const ts = minDate + i * 86400000;
                  const d = new Date(ts).getUTCDate();
                  const isWeekStart = new Date(ts).getUTCDay() === 1;
                  if (zoom === "week" && !isWeekStart && d % 5 !== 1) return null;
                  return (
                    <div key={i} className="absolute top-0 h-full flex items-center justify-center"
                      style={{ left: i * dayWidth, width: dayWidth }}>
                      <span className="text-[10px]" style={{ color: tk.textMuted }}>{d}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Today line */}
            {todayOffset >= 0 && todayOffset <= totalDays && (
              <div className="absolute top-0 bottom-0 z-10 pointer-events-none"
                style={{ left: todayLeft, width: 2, background: "#ef4444", opacity: 0.5 }}>
                <div className="absolute -top-0 text-[9px] px-1 rounded-b"
                  style={{ background: "#ef4444", color: "#fff", left: 2 }}>
                  今天
                </div>
              </div>
            )}
            {/* Category + task rows */}
            {catGroups.map(({ cat, tasks }) => (
              <div key={cat.id}>
                {/* Category row background */}
                <div className="h-8 border-b relative" style={{ borderColor: tk.borderLight, background: "#fafafa" }} />
                {/* Task bars */}
                {tasks.map(({ task }) => {
                  const { left, width } = taskBarStyle(task);
                  const color = statusColor(task.status);
                  return (
                    <div key={task.id} className="h-7 border-b relative flex items-center"
                      style={{ borderColor: tk.borderLight }}>
                      <div className="absolute rounded h-4 flex items-center px-1.5 overflow-hidden"
                        style={{
                          left: left + 2,
                          width: Math.max(width - 4, 30),
                          background: color,
                          opacity: task.status === "todo" ? 0.4 : 0.85,
                        }}>
                        <span className="text-[10px] text-white font-medium truncate whitespace-nowrap">
                          {task.name}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Milestone diamonds */}
            {milestones.length > 0 && (
              <div className="h-8 border-b" style={{ borderColor: tk.borderLight, background: "#fafafa" }} />
            )}
            {milestones.map(m => (
              <div key={m.id} className="h-7 border-b relative flex items-center"
                style={{ borderColor: tk.borderLight }}>
                <div className="absolute" style={{ left: milestonePos(m.date || m.note) - 6 }}>
                  <div style={{
                    width: 12, height: 12,
                    background: m.status === "done" ? "#22c55e" : m.status === "progress" ? "#3b82f6" : "#f59e0b",
                    transform: "rotate(45deg)",
                    borderRadius: 2,
                  }} />
                </div>
                <div className="absolute text-[10px] truncate" style={{
                  left: milestonePos(m.date || m.note) + 16,
                  color: tk.textSecondary,
                  maxWidth: 100,
                }}>
                  {m.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Unscheduled tasks */}
      {unscheduledTasks.length > 0 && (
        <div className="border-t px-4 py-3" style={{ borderColor: tk.borderLight, background: tk.bg }}>
          <div className="text-xs font-medium mb-2" style={{ color: tk.textMuted }}>未排程任務（{unscheduledTasks.length}）</div>
          <div className="flex flex-wrap gap-2">
            {unscheduledTasks.map(({ cat, task }) => (
              <span key={task.id} className="text-xs px-2 py-1 rounded-full"
                style={{ background: "#f5f5f4", color: tk.textSecondary, border: `1px solid ${tk.borderLight}` }}>
                {cat.icon} {task.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="border-t px-4 py-2 flex items-center gap-4" style={{ borderColor: tk.borderLight, background: tk.bg }}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: "#22c55e" }} />
          <span className="text-xs" style={{ color: tk.textMuted }}>已完成</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: "#3b82f6" }} />
          <span className="text-xs" style={{ color: tk.textMuted }}>進行中</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: "#d1d5db" }} />
          <span className="text-xs" style={{ color: tk.textMuted }}>未開始</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rotate-45" style={{ background: "#f59e0b" }} />
          <span className="text-xs" style={{ color: tk.textMuted }}>里程碑</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="w-0.5 h-3" style={{ background: "#ef4444" }} />
          <span className="text-xs" style={{ color: tk.textMuted }}>今天</span>
        </div>
      </div>
    </div>
  );
}
