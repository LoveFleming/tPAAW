import React, { useEffect, useState } from "react";
import { useTheme } from "../theme";
import Icon from "../components/Icon";

interface Widget {
  id: string;
  label: string;
  count: number;
  pass?: number;
  fail?: number;
  gaps?: number;
  value?: number;
  status: "ok" | "warning" | "danger" | "empty";
}

interface DashboardData {
  name: string;
  scannedAt: string | null;
  widgets: Widget[];
}

const EMPTY_WIDGETS: Widget[] = [
  { id: "specs", label: "Specs", count: 0, status: "empty" },
  { id: "tests", label: "Tests", count: 0, status: "empty" },
  { id: "runbooks", label: "Runbooks", count: 0, status: "empty" },
  { id: "coverage", label: "Coverage", count: 0, value: 0, status: "empty" },
];

const STATUS_STYLE: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  ok:      { bg: "bg-emerald-50",  border: "border-emerald-200", text: "text-emerald-600", icon: "check" },
  warning: { bg: "bg-amber-50",    border: "border-amber-200",   text: "text-amber-600",   icon: "warning" },
  danger:  { bg: "bg-rose-50",     border: "border-rose-200",    text: "text-rose-600",    icon: "cross" },
  empty:   { bg: "bg-stone-50",    border: "border-stone-200",   text: "text-stone-400",   icon: "" },
};

export default function ProjectDashboard({ projectRoot, openEmployee }: { projectRoot: string; openEmployee?: (id: string) => void }) {
  const { info: t } = useTheme();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`http://127.0.0.1:4097/api/project-dashboard?root=${encodeURIComponent(projectRoot)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [projectRoot]);

  const projectName = projectRoot.split("/").filter(Boolean).pop() || projectRoot;

  const widgets = data?.widgets ?? EMPTY_WIDGETS;
  const hasData = data?.scannedAt != null;

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: t.accentBg }}>
      <div className="max-w-5xl mx-auto py-6 px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4" style={{ color: t.accent }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
            </svg>
            <h1 className="text-sm font-semibold text-stone-800">Dashboard — {projectName}</h1>
          </div>
          {hasData && (
            <span className="text-[10px] text-stone-400">Scanned: {new Date(data.scannedAt!).toLocaleString()}</span>
          )}
        </div>

        {loading ? (
          <div className="text-center py-20 text-stone-400">
            <div className="text-lg animate-pulse">⏳</div>
            <p className="text-sm mt-2">Loading dashboard...</p>
          </div>
        ) : (
          <>
            {/* Widget Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {widgets.map(w => {
                const s = STATUS_STYLE[w.status] || STATUS_STYLE.empty;
                return (
                  <div key={w.id} className={`rounded-xl border p-4 ${s.bg} ${s.border}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">{w.label}</span>
                      {s.icon ? <Icon name={s.icon} size={14} className={s.text} /> : <span className="text-xs">—</span>}
                    </div>
                    {w.status === "empty" ? (
                      <div className="text-2xl font-bold text-stone-300">—</div>
                    ) : (
                      <div className="text-2xl font-bold" style={{ color: t.accent }}>{w.count}</div>
                    )}
                    {w.id === "tests" && w.status !== "empty" && (
                      <div className="text-[10px] mt-1 text-stone-400">
                        <span className="text-emerald-500">{w.pass ?? 0} pass</span>
                        {" / "}
                        <span className="text-rose-500">{w.fail ?? 0} fail</span>
                      </div>
                    )}
                    {w.id === "runbooks" && w.status !== "empty" && w.gaps != null && w.gaps > 0 && (
                      <div className="text-[10px] mt-1 text-rose-400">{w.gaps} error code gaps</div>
                    )}
                    {w.id === "coverage" && w.status !== "empty" && (
                      <div className="text-[10px] mt-1 text-stone-400">{w.value ?? 0}%</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* No data — call to action */}
            {!hasData && (
              <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: t.accentBorder }}>
                <div className="mb-3"><Icon name="rocket" size={28} /></div>
                <p className="text-sm font-semibold text-stone-600 mb-1">No dashboard data yet</p>
                <p className="text-xs text-stone-400 mb-4">
                  Run the <span className="font-mono px-1 py-0.5 rounded" style={{ backgroundColor: t.accentLight, color: t.accentText }}>Dashboard Setup</span> skill to initialize dashboard structure.
                </p>
                <button
                  onClick={() => openEmployee?.("ai.skill-designer")}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white cursor-pointer hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: t.accent }}
                >
                  <span><Icon name="clipboard" size={14} /></span> Ask 小春 林 to run "Dashboard Setup"
                </button>
              </div>
            )}

            {/* Has data — detail sections */}
            {hasData && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {["specs", "tests", "runbooks"].map(cat => {
                  const w = widgets.find(x => x.id === cat);
                  if (!w || w.count === 0) return null;
                  return (
                    <div key={cat} className="rounded-xl border bg-white p-4" style={{ borderColor: t.accentBorder }}>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">{cat}</h3>
                      <p className="text-sm" style={{ color: t.accentText }}>{w.count} {cat} found</p>
                      <p className="text-[10px] text-stone-400 mt-1">Click files in sidebar to view details</p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
