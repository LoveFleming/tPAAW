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
      <div className="flex items-center justify-center h-full text-stone-400 text-xs animate-pulse">
        Analyzing project health...
      </div>
    );
  }

  if (!health) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400 text-xs">
        Unable to load health data.
      </div>
    );
  }

  const { paawCompleteness, git, codeStats, sessions, dependencies } = health;

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
            <div className="text-xs text-stone-400">
              {paawCompleteness.score >= 80 ? "🟢 Healthy" : paawCompleteness.score >= 50 ? "🟡 Needs attention" : "🔴 At risk"}
            </div>
          </div>
          <div className="flex-1" />
          <button onClick={loadHealth} className="text-xs text-stone-400 hover:text-stone-600">↻</button>
        </div>
      </div>

      {/* .paaw/ Completeness */}
      <div className="px-4 py-3 border-b border-stone-100">
        <div className="text-xs font-semibold text-stone-600 mb-2">📁 .paaw/ Knowledge</div>
        {paawCompleteness.files.map(f => (
          <div key={f.name} className="flex items-center gap-2 py-0.5">
            <span className="text-xs">{f.exists ? "✅" : "⚪"}</span>
            <span className={`text-xs ${f.exists ? "text-stone-600" : "text-stone-300"}`}>{f.name}</span>
            {f.exists && f.size != null && (
              <span className="text-[10px] text-stone-300 ml-auto">
                {f.size > 1024 ? `${Math.round(f.size / 1024)}K` : `${f.size}B`}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Git Health */}
      <div className="px-4 py-3 border-b border-stone-100">
        <div className="text-xs font-semibold text-stone-600 mb-2">🌿 Git</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
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
        <div className="text-xs font-semibold text-stone-600 mb-2">📊 Code Stats</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-2">
          <div className="text-stone-400">Total files</div>
          <div className="text-stone-600">{codeStats.totalFiles}</div>
          <div className="text-stone-400">Total lines</div>
          <div className="text-stone-600">{codeStats.totalLines.toLocaleString()}</div>
        </div>
        {codeStats.languages.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {codeStats.languages.slice(0, 6).map(lang => (
              <span key={lang.lang} className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">
                {lang.lang} {lang.percent}%
              </span>
            ))}
          </div>
        )}
      </div>

      {/* AI Session Activity */}
      <div className="px-4 py-3 border-b border-stone-100">
        <div className="text-xs font-semibold text-stone-600 mb-2">🤖 AI Activity</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
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
          <div className="text-xs font-semibold text-stone-600 mb-2">📦 Dependencies</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
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

      <div className="flex-1" />
      <div className="px-4 py-2 text-[10px] text-stone-300 text-center shrink-0">
        Health data is cached. Click ↻ to refresh.
      </div>
    </div>
  );
}
