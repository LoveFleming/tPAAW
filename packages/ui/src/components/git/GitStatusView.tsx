/**
 * GitStatusView.tsx — Git Status 分組顯示
 * 
 * 核心改進：
 * 1. Code / .paaw / Config / Docs 分組顯示
 * 2. Code 組永遠展開且最顯眼
 * 3. .paaw 組預設收折，視覺退讓
 * 4. Agent Summary 獨立卡片
 * 5. Commit Bar 獨立出來
 */

import React, { useMemo, useState } from "react";
import { cn } from "../../utils";
import { groupGitFiles, GitFileStatus, GitFileGroup as GitFileGroupType, classifyGitFile } from "./git-helpers";
import GitFileGroupCard from "./GitFileGroup";

interface GitStatusViewProps {
  gitStatus: {
    branch: string;
    staged: GitFileStatus[];
    unstaged: GitFileStatus[];
    untracked: GitFileStatus[];
    all: GitFileStatus[];
  } | null;
  selectedFiles: Set<string>;
  onToggleFile: (path: string) => void;
  onFileClick: (path: string, isStaged: boolean) => void;
  /** Staged changes summary from agent */
  stagedSummary: {
    exists: boolean;
    agent?: string;
    codename?: string;
    task?: string;
    codeFiles?: { path: string; reason: string }[];
    paawFiles?: { path: string; reason: string }[];
    files?: { path: string; reason: string }[];
    howToTest?: string;
    risk?: string;
    createdAt?: string;
  } | null;
  /** Callbacks for git actions */
  onPull: () => void;
  onPush: () => void;
  onRefresh: () => void;
  /** Git log for recent commits */
  gitLog: { short: string; subject: string; date: string; author: string }[];
  /** Format time helper */
  fmtTime: (iso: string) => string;
  /** Staged summary actions */
  onApplySummary: (msg: string) => void;
  onQaReview: () => void;
  /** Theme colors */
  theme: {
    accent: string;
    borderLight: string;
    bg: string;
  };
}

export default function GitStatusView({
  gitStatus,
  selectedFiles,
  onToggleFile,
  onFileClick,
  stagedSummary,
  onPull,
  onPush,
  onRefresh,
  gitLog,
  fmtTime,
  onApplySummary,
  onQaReview,
  theme,
}: GitStatusViewProps) {
  const [showStagedDetail, setShowStagedDetail] = useState(false);

  // 合併 staged + unstaged + untracked，標記 isStaged
  const allFiles = useMemo(() => {
    if (!gitStatus) return [];
    const result: (GitFileStatus & { staged: boolean })[] = [];
    for (const f of gitStatus.staged) result.push({ ...f, staged: true });
    for (const f of gitStatus.unstaged) result.push({ ...f, staged: false });
    for (const f of gitStatus.untracked) result.push({ ...f, staged: false });
    return result;
  }, [gitStatus]);

  // 分組
  const fileGroups = useMemo(() => groupGitFiles(allFiles), [allFiles]);

  // Code vs .paaw 檔案數量統計
  const codeCount = allFiles.filter(f => classifyGitFile(f.path) === "code").length;
  const paawCount = allFiles.filter(f => classifyGitFile(f.path) === "paaw").length;

  if (!gitStatus) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-stone-400">
        Loading...
      </div>
    );
  }

  const hasStaged = gitStatus.staged.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* ── Branch Bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-xs font-bold text-stone-600 flex items-center gap-1.5">
          <span className="text-emerald-500">🌿</span>
          <span className="font-mono">{gitStatus.branch}</span>
        </div>
        {codeCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">
            {codeCount} code
          </span>
        )}
        {paawCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 font-bold">
            {paawCount} .paaw
          </span>
        )}
        <span className="flex-1" />
        <button onClick={onPull} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium">
          ⬇ Pull
        </button>
        <button onClick={onPush} className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors font-medium">
          ⬆ Push
        </button>
        <button onClick={onRefresh} className="text-xs text-stone-400 hover:text-stone-600 px-1.5 py-0.5 rounded hover:bg-stone-50">
          🔄
        </button>
      </div>

      {/* ── Agent Summary Card (when staged) ── */}
      {hasStaged && stagedSummary?.exists && (
        <div className="rounded-lg border border-violet-200 bg-violet-25 overflow-hidden">
          <button
            onClick={() => setShowStagedDetail(!showStagedDetail)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left bg-violet-50 hover:bg-violet-100 transition-colors"
          >
            <span className="text-sm">🤖</span>
            <span className="text-xs font-bold text-violet-700">
              {stagedSummary.agent || "Agent"}: {stagedSummary.task?.slice(0, 50) || "Staged changes"}
            </span>
            {(stagedSummary.codeFiles ?? stagedSummary.files) && (
              <span className="text-[10px] text-violet-500">
                · {(stagedSummary.codeFiles ?? stagedSummary.files)?.length} files
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                const s = stagedSummary!;
                const codeOnly = s.codeFiles || s.files || [];
                const lines = [`[${s.task || s.codename || 'update'}]`];
                for (const f of codeOnly) lines.push(`- ${f.path}: ${f.reason}`);
                if (s.howToTest) lines.push('', 'Test:', s.howToTest);
                onApplySummary(lines.join('\n'));
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 hover:bg-violet-200 font-bold"
            >
              📋 帶入
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQaReview();
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 hover:bg-orange-200 font-bold"
            >
              🔬 QA
            </button>
            <span className="text-[10px] text-violet-400">
              {showStagedDetail ? "▲" : "▼"}
            </span>
          </button>

          {showStagedDetail && (
            <div className="px-3 py-2 text-xs space-y-1.5 bg-violet-25">
              {/* Code files (primary) */}
              {(stagedSummary.codeFiles ?? stagedSummary.files ?? [])?.length > 0 && (
                <div className="space-y-0.5">
                  <div className="font-bold text-emerald-600 text-[10px] uppercase tracking-wider">📝 Code</div>
                  {(stagedSummary.codeFiles ?? stagedSummary.files)!.slice(0, 6).map((f, i) => (
                    <div key={i} className="flex items-baseline gap-1.5 pl-2">
                      <span className="font-mono text-emerald-600 shrink-0 max-w-[40%] truncate text-[11px]">
                        {f.path.split(/[\\/]/).pop()}
                      </span>
                      <span className="text-stone-300">·</span>
                      <span className="text-stone-500 truncate flex-1 text-[11px]">{f.reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* .paaw files (secondary) */}
              {stagedSummary.paawFiles && stagedSummary.paawFiles.length > 0 && (
                <div className="space-y-0.5">
                  <div className="font-bold text-stone-400 text-[10px] uppercase tracking-wider">🤖 .paaw</div>
                  {stagedSummary.paawFiles.slice(0, 4).map((f, i) => (
                    <div key={i} className="flex items-baseline gap-1.5 pl-2">
                      <span className="font-mono text-stone-400 shrink-0 max-w-[40%] truncate text-[11px]">
                        {f.path.split(/[\\/]/).pop()}
                      </span>
                      <span className="text-stone-300">·</span>
                      <span className="text-stone-400 truncate flex-1 text-[11px]">{f.reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* How to test */}
              {stagedSummary.howToTest && (
                <div className="flex items-start gap-1 pt-1" style={{ borderTop: "1px solid #ede9fe" }}>
                  <span className="shrink-0">🧪</span>
                  <span className="text-stone-500 text-[11px]">{stagedSummary.howToTest}</span>
                </div>
              )}
              {/* Risk */}
              {stagedSummary.risk && stagedSummary.risk !== "無" && (
                <div className="flex items-start gap-1">
                  <span className="shrink-0 text-red-400">⚠️</span>
                  <span className="text-red-500 text-[11px]">{stagedSummary.risk}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── File Groups ── */}
      {fileGroups.length > 0 ? (
        <div className="space-y-2">
          {fileGroups.map(g => (
            <GitFileGroupCard
              key={g.category}
              group={g}
              selectedFiles={selectedFiles}
              onToggleFile={onToggleFile}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-stone-400 text-xs">
          <span className="text-2xl">✨</span>
          <p>Working tree clean</p>
        </div>
      )}

      {/* ── Select All / Clear ── */}
      {allFiles.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => {
              const all = new Set<string>();
              gitStatus.staged.forEach(f => all.add(f.path));
              gitStatus.unstaged.forEach(f => all.add(f.path));
              gitStatus.untracked.forEach(f => all.add(f.path));
              // This is a simplified approach - parent should handle this
            }}
            className="text-[10px] text-blue-500 hover:underline"
          >
            Select All
          </button>
          <span className="text-stone-300">·</span>
          <button
            className="text-[10px] text-stone-400 hover:underline"
          >
            Clear
          </button>
          <span className="text-[10px] text-stone-400">{selectedFiles.size} selected</span>
        </div>
      )}

      {/* ── Recent Commits ── */}
      {gitLog.length > 0 && (
        <div className="pt-2" style={{ borderTop: `1px solid ${theme.borderLight}` }}>
          <div className="text-xs font-bold text-stone-500 mb-1.5 flex items-center gap-1.5">
            <span>📜</span>
            <span>Recent</span>
          </div>
          <div className="space-y-0.5">
            {gitLog.slice(0, 8).map((c, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 text-xs group">
                <span className="text-[10px] font-mono text-blue-500 shrink-0 bg-blue-50 px-1 rounded">
                  {c.short}
                </span>
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
