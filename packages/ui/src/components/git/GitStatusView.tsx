/**
 * GitStatusView.tsx — Git Status 分組顯示
 * 
 * selectedKeys = Set<fileKey> — "S::path" / "U::path"
 * 同名檔案 staged vs unstaged 各自獨立
 */

import React, { useMemo, useState } from "react";
import { cn } from "../../utils";
import { groupGitFiles, GitFileStatus, classifyGitFile, fileKey, pathFromFileKey } from "./git-helpers";
import GitFileGroupCard from "./GitFileGroup";

interface StagedSummary {
  exists: boolean;
  agent?: string;
  codename?: string;
  task?: string;
  taskId?: string;
  codeFiles?: { path: string; reason: string }[];
  paawFiles?: { path: string; reason: string }[];
  files?: { path: string; reason: string }[];
  howToTest?: string;
  risk?: string;
  createdAt?: string;
}

interface GitStatusViewProps {
  gitStatus: {
    branch: string;
    staged: GitFileStatus[];
    unstaged: GitFileStatus[];
    untracked: GitFileStatus[];
    all: GitFileStatus[];
  } | null;
  selectedKeys: Set<string>;
  onToggleKey: (key: string) => void;
  onSelectKeys: (keys: string[], selected: boolean) => void;
  onFileClick: (path: string, isStaged: boolean) => void;
  stagedSummary: StagedSummary | null;
  onPull: () => void;
  onPush: () => void;
  onRefresh: () => void;
  gitLog: { short: string; subject: string; date: string; author: string }[];
  fmtTime: (iso: string) => string;
  onApplySummary: (msg: string) => void;
  onQaReview: () => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onUnstageFile: (path: string) => void;
  onStageFile: (path: string) => void;
  qaReviewLoading: boolean;
  // ── Pipeline state ──
  pipeline: Record<string, { status: string; by?: string; at?: string; result?: string; reason?: string; feedback?: string }> | null;
  loopMode: "full" | "mini";
  projectLoopMode: "full" | "mini";
  setProjectLoopMode: (mode: "full" | "mini") => void;
  qaVerdict: { verdict: string; issues: number; critical: number; summary: string; feedback: string } | null;
  onSpecApprove: () => void;
  onSpecReject: () => void;
  theme: { accent: string; borderLight: string; bg: string; };
}

export default function GitStatusView({
  gitStatus,
  selectedKeys,
  onToggleKey,
  onSelectKeys,
  onFileClick,
  stagedSummary,
  onPull,
  onPush,
  onRefresh,
  gitLog,
  fmtTime,
  onApplySummary,
  onQaReview,
  onSelectAll,
  onClearAll,
  onUnstageFile,
  onStageFile,
  qaReviewLoading,
  pipeline,
  loopMode,
  projectLoopMode,
  setProjectLoopMode,
  qaVerdict,
  onSpecApprove,
  onSpecReject,
  theme,
}: GitStatusViewProps) {
  const [showStagedDetail, setShowStagedDetail] = useState(false);

  // ── Pipeline progress helpers ──
  const PIPELINE_PHASES = ["spec", "implement", "review", "test", "qa", "docs", "commit"];
  const MINI_LOOP_PHASES = ["implement", "commit"];
  const activePhases = loopMode === "mini" ? MINI_LOOP_PHASES : PIPELINE_PHASES;

  const phaseEmoji: Record<string, string> = {
    spec: "📋", implement: "💻", review: "👀", test: "🧪", qa: "🔬", docs: "📝", commit: "🚀"
  };

  const phaseStatusIcon = (status: string) => {
    switch (status) {
      case "done": return "✅";
      case "in_progress": return "🔵";
      case "rework": return "🔄";
      case "failed": return "❌";
      case "awaiting_human": return "🚧";
      case "pending": return "⏳";
      default: return "⏳";
    }
  };

  // Check if spec is awaiting human
  const specAwaiting = pipeline?.spec?.status === "awaiting_human";
  // Check if QA is rework
  const qaRework = pipeline?.qa?.status === "rework";
  // Check if commit is awaiting human
  const commitAwaiting = pipeline?.commit?.status === "awaiting_human";

  // 合併 staged + unstaged + untracked，標記 isStaged
  const allFiles = useMemo(() => {
    if (!gitStatus) return [];
    const result: (GitFileStatus & { staged: boolean })[] = [];
    for (const f of gitStatus.staged) result.push({ ...f, staged: true });
    for (const f of gitStatus.unstaged) result.push({ ...f, staged: false });
    for (const f of gitStatus.untracked) result.push({ ...f, staged: false });
    return result;
  }, [gitStatus]);

  // AI auto-dispatch staged files
  const aiStagedPaths = useMemo(() => {
    if (!stagedSummary?.exists) return new Set<string>();
    const paths = new Set<string>();
    (stagedSummary.codeFiles ?? stagedSummary.files ?? []).forEach(f => paths.add(f.path));
    (stagedSummary.paawFiles ?? []).forEach(f => paths.add(f.path));
    return paths;
  }, [stagedSummary]);

  const aiStagedFiles = useMemo(() => {
    if (!gitStatus || aiStagedPaths.size === 0) return [];
    return gitStatus.staged.filter(f => aiStagedPaths.has(f.path));
  }, [gitStatus, aiStagedPaths]);

  const remainingFiles = useMemo(() => {
    return allFiles.filter(f => !aiStagedPaths.has(f.path));
  }, [allFiles, aiStagedPaths]);

  const fileGroups = useMemo(() => groupGitFiles(remainingFiles), [remainingFiles]);

  const codeCount = allFiles.filter(f => classifyGitFile(f.path) === "code").length;
  const paawCount = allFiles.filter(f => classifyGitFile(f.path) === "paaw").length;

  if (!gitStatus) {
    return <div className="flex-1 flex items-center justify-center text-xs text-stone-400">Loading...</div>;
  }

  const hasAiStaged = aiStagedFiles.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Branch Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-xs font-bold text-stone-600 flex items-center gap-1.5">
          <span className="text-emerald-500">🌿</span>
          <span className="font-mono">{gitStatus.branch}</span>
        </div>
        {codeCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">{codeCount} code</span>}
        {paawCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 font-bold">{paawCount} .paaw</span>}
        <span className="flex-1" />
        <button onClick={onPull} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium">⬇ Pull</button>
        <button onClick={onPush} className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors font-medium">⬆ Push</button>
        <button onClick={onRefresh} className="text-xs text-stone-400 hover:text-stone-600 px-1.5 py-0.5 rounded hover:bg-stone-50">🔄</button>
      </div>

      {/* ══ Pipeline Phase Progress Bar ══ */}
      {pipeline && (
        <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
          <div className="flex items-center gap-1 px-3 py-2 bg-stone-50 border-b border-stone-100">
            <span className="text-xs">🔄</span>
            <span className="text-[10px] font-bold text-stone-600">Pipeline</span>
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-1 cursor-pointer select-none transition-all active:scale-95",
              loopMode === "mini" ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-blue-100 text-blue-700 hover:bg-blue-200"
            )}
            onClick={() => setProjectLoopMode(loopMode === "mini" ? "full" : "mini")}
            title={`Click to switch to ${loopMode === "mini" ? "Full Loop" : "Mini Loop"}`}
            >
              {loopMode === "mini" ? "Mini Loop" : "Full Loop"}
            </span>
            {qaRework && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold ml-1">
                🔄 Rework
              </span>
            )}
            {qaVerdict && (
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-1",
                qaVerdict.verdict === "pass" ? "bg-emerald-100 text-emerald-700" :
                qaVerdict.verdict === "conditional" ? "bg-amber-100 text-amber-700" :
                "bg-red-100 text-red-700"
              )}>
                QA: {qaVerdict.verdict}
              </span>
            )}
          </div>
          <div className="flex items-stretch px-3 py-2 gap-0.5">
            {activePhases.map((phase, i) => {
              const ps = pipeline[phase]?.status || "pending";
              const icon = phaseStatusIcon(ps);
              const isCurrent = ps === "in_progress" || ps === "awaiting_human" || ps === "rework";
              const bg = ps === "done" ? "bg-emerald-50" :
                         ps === "in_progress" ? "bg-blue-50" :
                         ps === "rework" ? "bg-red-50" :
                         ps === "awaiting_human" ? "bg-amber-50" :
                         ps === "failed" ? "bg-red-50" :
                         "bg-stone-50";
              return (
                <div key={phase} className={cn("flex-1 flex flex-col items-center gap-0.5 py-1 rounded-md", bg)}>
                  <span className="text-[10px]">{icon}</span>
                  <span className={cn("text-[9px] font-bold", isCurrent ? "text-stone-700" : "text-stone-400")}>
                    {phase}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Spec awaiting human banner */}
          {specAwaiting && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-t border-amber-200">
              <span className="text-sm">🚧</span>
              <span className="text-xs text-amber-700 font-bold flex-1">Spec 等確認 — Architect 寫好了，請確認方向</span>
              <button onClick={onSpecApprove} className="text-[10px] px-2 py-1 rounded-md bg-emerald-500 text-white font-bold hover:bg-emerald-600 active:scale-95 transition-all">
                ✅ Approve
              </button>
              <button onClick={onSpecReject} className="text-[10px] px-2 py-1 rounded-md bg-red-500 text-white font-bold hover:bg-red-600 active:scale-95 transition-all">
                ❌ Reject
              </button>
            </div>
          )}
          {/* Commit awaiting human banner */}
          {commitAwaiting && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border-t border-emerald-200">
              <span className="text-sm">🚀</span>
              <span className="text-xs text-emerald-700 font-bold flex-1">QA 已通過 — 等你 Commit & Push</span>
            </div>
          )}
          {/* Rework feedback banner */}
          {qaRework && pipeline.qa?.feedback && (
            <div className="px-3 py-2 bg-red-50 border-t border-red-200">
              <div className="text-[10px] font-bold text-red-700 mb-0.5">🔄 Rework Feedback</div>
              <div className="text-[10px] text-red-600 leading-relaxed">{pipeline.qa.feedback}</div>
            </div>
          )}
        </div>
      )}

      {/* ══ AI Auto Dispatch ══ */}
      {hasAiStaged && stagedSummary?.exists && (
        <div className={cn(
          "rounded-lg border-2 overflow-hidden shadow-sm",
          qaRework ? "border-red-300 bg-red-50" : "border-violet-300 bg-violet-50"
        )}>
          <div className={cn(
            "flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none transition-colors",
            qaRework ? "bg-red-100 hover:bg-red-150" : "bg-violet-100 hover:bg-violet-150"
          )}
            onClick={() => setShowStagedDetail(!showStagedDetail)}
          >
            <span className="text-base">{qaRework ? "🔄" : "🤖"}</span>
            <div className="flex-1 min-w-0">
              <div className={cn("text-xs font-bold", qaRework ? "text-red-800" : "text-violet-800")}>
                {qaRework ? "AI Auto Dispatch — Rework 中" : "AI Auto Dispatch — 等 Review"}
              </div>
              <div className={cn("text-[10px] truncate", qaRework ? "text-red-600" : "text-violet-600")}>
                {stagedSummary.agent || "Agent"}：{stagedSummary.task?.slice(0, 60) || stagedSummary.codename || "Auto task"}
              </div>
              {/* Pipeline phase indicator */}
              {pipeline && (
                <div className="flex items-center gap-1 mt-0.5">
                  {activePhases.map(phase => {
                    const ps = pipeline[phase]?.status || "pending";
                    if (ps === "pending" || ps === "done") return null;
                    return (
                      <span key={phase} className={cn(
                        "text-[9px] px-1 py-0.5 rounded font-bold",
                        ps === "in_progress" ? "bg-blue-100 text-blue-700" :
                        ps === "rework" ? "bg-red-100 text-red-700" :
                        ps === "awaiting_human" ? "bg-amber-100 text-amber-700" :
                        "bg-stone-100 text-stone-500"
                      )}>
                        {phaseStatusIcon(ps)} {phase}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* Full Loop: QA Review button */}
              {loopMode === "full" && (
                <button onClick={(e) => { e.stopPropagation(); onQaReview(); }}
                  disabled={qaReviewLoading}
                  className={cn(
                    "text-[10px] px-2 py-1 rounded-md font-bold transition-all active:scale-95",
                    qaReviewLoading
                      ? "bg-orange-300 text-white cursor-wait"
                      : "bg-orange-500 text-white hover:bg-orange-600"
                  )}>
                  {qaReviewLoading ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin">⚙️</span> Reviewing...
                    </span>
                  ) : (
                    "🔬 QA Review"
                  )}
                </button>
              )}
              {/* Mini Loop: Human review hint */}
              {loopMode === "mini" && (
                <span className="text-[10px] px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 font-bold">
                  👤 你驗功能 → Commit
                </span>
              )}
              <button onClick={(e) => {
                e.stopPropagation();
                const s = stagedSummary!;
                const codeOnly = s.codeFiles || s.files || [];
                const lines = [`[${s.task || s.codename || 'update'}]`];
                for (const f of codeOnly) lines.push(`- ${f.path}: ${f.reason}`);
                if (s.howToTest) lines.push('', 'Test:', s.howToTest);
                onApplySummary(lines.join('\n'));
              }}
                className="text-[10px] px-1.5 py-0.5 rounded bg-violet-200 text-violet-700 hover:bg-violet-300 font-bold">
                📋 帶入
              </button>
              <span className="text-[10px] text-violet-400">{showStagedDetail ? "▲" : "▼"}</span>
            </div>
          </div>
          <div className="px-3 py-1.5 divide-y divide-violet-100">
            {aiStagedFiles.map((f, i) => {
              const isCode = classifyGitFile(f.path) === "code";
              return (
                <div key={`ai-${i}`} className="flex items-center gap-2 py-1 text-xs">
                  <span className={cn("font-bold w-4 shrink-0", isCode ? "text-emerald-500" : "text-stone-400")}>{f.status}</span>
                  <span className={cn("truncate flex-1 cursor-pointer", isCode ? "text-stone-700 font-medium" : "text-stone-400")}
                    onClick={() => onFileClick(f.path, true)}>{f.path}</span>
                  {(() => {
                    const summary = stagedSummary!.codeFiles?.find(sf => sf.path === f.path)
                      ?? stagedSummary!.paawFiles?.find(sf => sf.path === f.path)
                      ?? stagedSummary!.files?.find(sf => sf.path === f.path);
                    return summary ? <span className="text-[10px] text-violet-500 truncate max-w-[40%] shrink-0">{summary.reason}</span> : null;
                  })()}
                  {isCode ? <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-600 shrink-0">code</span>
                    : <span className="text-[10px] px-1 py-0.5 rounded bg-stone-100 text-stone-400 shrink-0">.paaw</span>}
                </div>
              );
            })}
          </div>
          {showStagedDetail && (
            <div className="px-3 py-2 text-xs space-y-1.5 border-t border-violet-200 bg-violet-25">
              {stagedSummary.howToTest && (
                <div className="flex items-start gap-1"><span className="shrink-0">🧪</span><span className="text-stone-500 text-[11px]">{stagedSummary.howToTest}</span></div>
              )}
              {stagedSummary.risk && stagedSummary.risk !== "無" && (
                <div className="flex items-start gap-1"><span className="shrink-0 text-red-400">⚠️</span><span className="text-red-500 text-[11px]">{stagedSummary.risk}</span></div>
              )}
            </div>
          )}
        </div>
      )}

      {/* File Groups */}
      {fileGroups.length > 0 ? (
        <div className="space-y-2">
          {fileGroups.map(g => (
            <GitFileGroupCard
              key={g.category}
              group={g}
              selectedKeys={selectedKeys}
              onToggleKey={onToggleKey}
              onSelectKeys={onSelectKeys}
              onFileClick={onFileClick}
              onUnstageFile={onUnstageFile}
              onStageFile={onStageFile}
            />
          ))}
        </div>
      ) : !hasAiStaged ? (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-stone-400 text-xs">
          <span className="text-2xl">✨</span><p>Working tree clean</p>
        </div>
      ) : null}

      {/* Select All / Clear */}
      {allFiles.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <button onClick={onSelectAll} className="text-[10px] text-blue-500 hover:underline font-medium">Select All</button>
          <span className="text-stone-300">·</span>
          <button onClick={onClearAll} className="text-[10px] text-stone-400 hover:underline font-medium">Clear</button>
          <span className="text-[10px] text-stone-400">{selectedKeys.size} selected</span>
        </div>
      )}

      {/* Recent Commits */}
      {gitLog.length > 0 && (
        <div className="pt-2" style={{ borderTop: `1px solid ${theme.borderLight}` }}>
          <div className="text-xs font-bold text-stone-500 mb-1.5 flex items-center gap-1.5"><span>📜</span><span>Recent</span></div>
          <div className="space-y-0.5">
            {gitLog.slice(0, 8).map((c, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 text-xs group">
                <span className="text-[10px] font-mono text-blue-500 shrink-0 bg-blue-50 px-1 rounded">{c.short}</span>
                <span className="text-stone-600 truncate flex-1">{c.subject}</span>
                <span className="text-stone-400 shrink-0 text-[10px]">{fmtTime(c.date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
