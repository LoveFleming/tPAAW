/**
 * ProjectHealth — Dashboard showing project health metrics
 *
 * Metrics:
 * - .paaw/ completeness (PROJECT.md, DECISIONS.md, CHANGELOG.md, CODING-STANDARDS.md, sessions/, standards/)
 * - Git health (uncommitted changes, stale branches, last commit)
 * - Dependency health (outdated, vulnerabilities via npm audit)
 * - Code stats (file count, total lines, languages)
 * - Session activity (recent AI sessions, success rate)
 */
import React, { useEffect, useState, useCallback } from "react";
import { cn } from "../utils";
import API_BASE from "../api";

// ── Types ──

interface HealthData {
  paawCompleteness: {
    initialized: boolean;
    files: { name: string; exists: boolean; size?: number }[];
    score: number; // 0-100
  };
  git: {
    branch: string;
    uncommitted: number;
    lastCommit?: string;
    lastCommitDate?: string;
    remote?: string;
  };
  codeStats: {
    totalFiles: number;
    totalLines: number;
    languages: { lang: string; files: number; percent: number }[];
  };
  sessions: {
    total: number;
    recent: number; // last 7 days
    successRate: number;
  };
  dependencies?: {
    total: number;
    outdated?: number;
  };
  fixItems?: FixItem[];
}

interface FixItem {
  id: string;
  severity: "high" | "medium" | "low";
  category: string;
  title: string;
  description: string;
  fixPlan: {
    steps: { agent: string; task: string; files?: string[] }[];
    estimatedMinutes: number;
  };
}

interface ProjectHealthProps {
  projectRoot: string;
  refreshKey?: number;
}

// ── Score colors ──

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

// ── Component ──

export default function ProjectHealth({ projectRoot, refreshKey = 0 }: ProjectHealthProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHealth = useCallback(async () => {
    if (!projectRoot) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/health?path=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch {}
    setLoading(false);
  }, [projectRoot]);

  useEffect(() => { loadHealth(); }, [loadHealth, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400 text-sm animate-pulse">
        Analyzing project health...
      </div>
    );
  }

  if (!health) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400 text-sm">
        Unable to load health data.
      </div>
    );
  }

  const { paawCompleteness, git, codeStats, sessions, dependencies } = health;

  // Detect initial project (no source code files yet — .paaw/ templates don't count)
  const isInitial = !codeStats?.totalFiles || codeStats.totalFiles === 0;

  if (isInitial) {
    return (
      <div className="flex flex-col h-full overflow-y-auto items-center justify-center gap-3 p-8" style={{ scrollbarWidth: "thin" }}>
        <div className="text-4xl">🌱</div>
        <div className="text-sm font-bold text-stone-500">Initial Project</div>
        <div className="text-xs text-stone-400 text-center max-w-xs">專案剛建立，還沒有程式碼。讓 Developer Agent 幫你搭建骨架後，健康指標就會開始運作。</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      {/* Overall Score */}
      <div className="px-4 py-3 border-b border-stone-200 bg-gradient-to-b from-stone-50 to-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
              <circle cx="28" cy="28" r="24" fill="none" stroke="#e5e5e5" strokeWidth="4" />
              <circle
                cx="28" cy="28" r="24" fill="none" stroke="currentColor"
                strokeWidth="4" strokeLinecap="round"
                className={scoreColor(paawCompleteness.score)}
                strokeDasharray={`${(paawCompleteness.score / 100) * 150.8} 150.8`}
              />
            </svg>
            <div className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${scoreColor(paawCompleteness.score)}`}>
              {paawCompleteness.score}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold text-stone-700">Project Health</div>
            <div className="text-sm text-stone-400">
              {paawCompleteness.score >= 80 ? "🟢 Healthy" : paawCompleteness.score >= 50 ? "🟡 Needs attention" : "🔴 At risk"}
            </div>
          </div>
          <div className="flex-1" />
          <button onClick={loadHealth} className="text-sm text-stone-400 hover:text-stone-600">↻</button>
        </div>
      </div>

      {/* .paaw/ Completeness */}
      <div className="px-4 py-3 border-b border-stone-100">
        <div className="text-sm font-semibold text-stone-600 mb-2">📁 .paaw/ Knowledge</div>
        {paawCompleteness.files.map(f => (
          <div key={f.name} className="flex items-center gap-2 py-0.5">
            <span className="text-sm">{f.exists ? "✅" : "⚪"}</span>
            <span className={`text-sm ${f.exists ? "text-stone-600" : "text-stone-300"}`}>{f.name}</span>
            {f.exists && f.size != null && (
              <span className="text-xs text-stone-300 ml-auto">
                {f.size > 1024 ? `${Math.round(f.size / 1024)}K` : `${f.size}B`}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Git Health */}
      <div className="px-4 py-3 border-b border-stone-100">
        <div className="text-sm font-semibold text-stone-600 mb-2">🌿 Git</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <div className="text-stone-400">Branch</div>
          <div className="text-stone-600 font-mono">{git.branch || "—"}</div>

          <div className="text-stone-400">Uncommitted</div>
          <div className={git.uncommitted > 0 ? "text-amber-600 font-medium" : "text-green-600"}>
            {git.uncommitted} file{git.uncommitted !== 1 ? "s" : ""}
          </div>

          {git.lastCommit && (
            <>
              <div className="text-stone-400">Last commit</div>
              <div className="text-stone-500 truncate" title={git.lastCommit}>{git.lastCommit.slice(0, 40)}</div>
            </>
          )}
          {git.lastCommitDate && (
            <>
              <div className="text-stone-400">When</div>
              <div className="text-stone-500">{git.lastCommitDate}</div>
            </>
          )}
          {git.remote && (
            <>
              <div className="text-stone-400">Remote</div>
              <div className="text-stone-500 truncate" title={git.remote}>{git.remote.replace(/^https?:\/\/.*\//, "").replace(/\.git$/, "")}</div>
            </>
          )}
        </div>
      </div>

      {/* Code Stats */}
      <div className="px-4 py-3 border-b border-stone-100">
        <div className="text-sm font-semibold text-stone-600 mb-2">📊 Code Stats</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm mb-2">
          <div className="text-stone-400">Total files</div>
          <div className="text-stone-600">{codeStats.totalFiles}</div>
          <div className="text-stone-400">Total lines</div>
          <div className="text-stone-600">{codeStats.totalLines.toLocaleString()}</div>
        </div>
        {codeStats.languages.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {codeStats.languages.slice(0, 6).map(lang => (
              <span key={lang.lang} className="text-xs px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">
                {lang.lang} {lang.percent}%
              </span>
            ))}
          </div>
        )}
      </div>

      {/* AI Session Activity */}
      <div className="px-4 py-3 border-b border-stone-100">
        <div className="text-sm font-semibold text-stone-600 mb-2">🤖 AI Activity</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <div className="text-stone-400">Total sessions</div>
          <div className="text-stone-600">{sessions.total}</div>
          <div className="text-stone-400">Recent (7d)</div>
          <div className="text-stone-600">{sessions.recent}</div>
          <div className="text-stone-400">Success rate</div>
          <div className={sessions.successRate >= 80 ? "text-green-600 font-medium" : sessions.successRate >= 50 ? "text-amber-600" : "text-red-600"}>
            {sessions.total > 0 ? `${sessions.successRate}%` : "—"}
          </div>
        </div>
      </div>

      {/* Dependencies */}
      {dependencies && (
        <div className="px-4 py-3 border-b border-stone-100">
          <div className="text-sm font-semibold text-stone-600 mb-2">📦 Dependencies</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <div className="text-stone-400">Total</div>
            <div className="text-stone-600">{dependencies.total}</div>
            {dependencies.outdated != null && (
              <>
                <div className="text-stone-400">Outdated</div>
                <div className={dependencies.outdated > 0 ? "text-amber-600 font-medium" : "text-green-600"}>
                  {dependencies.outdated}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Fix Items — Actionable health issues */}
      {health.fixItems && health.fixItems.length > 0 && (
        <div className="px-4 py-3 border-b border-stone-100">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-stone-600">🔧 可修復項目</span>
            <span className="text-xs text-stone-400">({health.fixItems.length})</span>
          </div>
          {health.fixItems.map((item) => (
            <div key={item.id} className={cn(
              "rounded-lg border mb-2 overflow-hidden",
              item.severity === "high" ? "border-red-200" :
              item.severity === "medium" ? "border-amber-200" :
              "border-stone-200"
            )}>
              <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs",
                item.severity === "high" ? "bg-red-50" :
                item.severity === "medium" ? "bg-amber-50" :
                "bg-stone-50"
              )}>
                <span>{item.severity === "high" ? "🔴" : item.severity === "medium" ? "🟡" : "🟢"}</span>
                <span className="font-bold text-stone-700 flex-1">{item.title}</span>
                <span className="text-[10px] text-stone-400">{item.category}</span>
              </div>
              <div className="px-3 py-1.5 text-[11px] text-stone-500">{item.description}</div>
              <div className="px-3 py-1.5 flex items-center gap-1.5 flex-wrap">
                {item.fixPlan.steps.map((step, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 font-medium">
                    {step.agent}: {step.task.slice(0, 30)}{step.task.length > 30 ? "..." : ""}
                  </span>
                ))}
                <span className="text-[10px] text-stone-300">~{item.fixPlan.estimatedMinutes}min</span>
              </div>
              <div className="px-3 py-1.5 border-t border-stone-100 flex justify-end">
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch(`${API_BASE}/api/coding-tasks/health-fix?path=${encodeURIComponent(projectRoot)}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          title: `🏥 ${item.title}`,
                          description: item.description,
                          fixPlan: item.fixPlan,
                          source: "code-health",
                        }),
                      });
                      const data = await r.json();
                      if (data.ok) {
                        alert(`✅ 已派給 EM！\nParent: ${data.parent.title}\nSub-tasks: ${data.subTasks.length}`);
                        loadHealth();
                      } else {
                        alert(`❌ 失敗: ${data.error}`);
                      }
                    } catch (e: any) {
                      alert(`❌ Error: ${e.message}`);
                    }
                  }}
                  className="text-[10px] px-2.5 py-1 rounded-md bg-violet-500 text-white font-bold hover:bg-violet-600 active:scale-95 transition-all"
                >
                  🏥 派給 EM
                </button>
              </div>
            </div>
          ))}
          {/* Fix All button */}
          {health.fixItems.length > 1 && (
            <div className="flex justify-end mt-1">
              <button
                onClick={async () => {
                  const confirmed = confirm(`一次派 ${health.fixItems!.length} 個修復項目給 EM？`);
                  if (!confirmed) return;
                  try {
                    const allSteps = health.fixItems!.flatMap(item => item.fixPlan.steps);
                    const totalMin = health.fixItems!.reduce((sum, item) => sum + item.fixPlan.estimatedMinutes, 0);
                    const r = await fetch(`${API_BASE}/api/coding-tasks/health-fix?path=${encodeURIComponent(projectRoot)}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        title: `🏥 Health Fix: ${health.fixItems!.length} items`,
                        description: health.fixItems!.map(i => `- ${i.title}`).join("\n"),
                        fixPlan: { steps: allSteps, estimatedMinutes: totalMin },
                        source: "code-health-batch",
                      }),
                    });
                    const data = await r.json();
                    if (data.ok) {
                      alert(`✅ 全部派給 EM！\nParent: ${data.parent.title}\nSub-tasks: ${data.subTasks.length}`);
                      loadHealth();
                    } else {
                      alert(`❌ 失敗: ${data.error}`);
                    }
                  } catch (e: any) {
                    alert(`❌ Error: ${e.message}`);
                  }
                }}
                className="text-[10px] px-3 py-1.5 rounded-md bg-violet-500 text-white font-bold hover:bg-violet-600 active:scale-95 transition-all"
              >
                🏥 全部派給 EM
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />
      <div className="px-4 py-2 text-xs text-stone-300 text-center shrink-0">
        Health data is cached. Click ↻ to refresh.
      </div>
    </div>
  );
}
