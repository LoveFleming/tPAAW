/**
 * GitDiffView.tsx — 分組 Diff 檢視
 * 
 * 核心改進：
 * 1. Code diff 和 .paaw diff 分開顯示
 * 2. Code diff 預設展開，.paaw 預設收折
 * 3. 每個分組有獨立的展開/收折
 * 4. 保留原有的 Working/Staged/Last Commit 切換
 */

import React, { useMemo, useState } from "react";
import { cn } from "../../utils";
import { classifyGitFile, FileCategory } from "./git-helpers";
import DiffViewer from "../DiffViewer";

// ── Types ──
interface DiffFileGroup {
  category: FileCategory;
  label: string;
  emoji: string;
  defaultExpanded: boolean;
  diffText: string;  // Raw diff text for this group
}

interface GitDiffViewProps {
  /** Full diff text */
  diffText: string;
  /** Which diff mode is active */
  diffMode: "working" | "staged" | "head";
  /** Specific file being diffed */
  diffFile?: string;
  /** Git log for commit list when no diff */
  gitLog: { hash: string; short: string; subject: string; author: string; date: string }[];
  /** Callbacks */
  onDiffModeChange: (mode: "working" | "staged" | "head") => void;
  onCommitClick: (hash: string) => void;
  onQaReview: () => void;
  qaReviewLoading: boolean;
  hasStagedChanges: boolean;
  /** Format time */
  fmtTime: (iso: string) => string;
  /** Theme */
  theme: {
    accent: string;
    borderLight: string;
  };
}

/**
 * 從 unified diff text 中按檔案分類拆分
 */
function splitDiffByCategory(diffText: string): DiffFileGroup[] {
  if (!diffText) return [];

  const lines = diffText.split("\n");
  const chunks: { category: FileCategory; lines: string[] }[] = [];
  let currentCategory: FileCategory | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      // New file — flush previous
      if (currentCategory !== null) {
        chunks.push({ category: currentCategory, lines: [...currentLines] });
      }
      // Determine category from file path
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const filePath = match ? match[2] : match?.[1] || "";
      currentCategory = classifyGitFile(filePath);
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  // Flush last
  if (currentCategory !== null) {
    chunks.push({ category: currentCategory, lines: [...currentLines] });
  }

  // Group by category, maintaining order: code > config > docs > other > paaw
  const categoryOrder: FileCategory[] = ["code", "config", "docs", "other", "paaw"];
  const categoryConfig: Record<FileCategory, { label: string; emoji: string; defaultExpanded: boolean }> = {
    code: { label: "Code Changes", emoji: "📝", defaultExpanded: true },
    config: { label: "Config", emoji: "⚙️", defaultExpanded: true },
    docs: { label: "Docs", emoji: "📖", defaultExpanded: true },
    other: { label: "Other", emoji: "📎", defaultExpanded: true },
    paaw: { label: "AI Workspace (.paaw)", emoji: "🤖", defaultExpanded: false },
  };

  const grouped = new Map<FileCategory, string[]>();
  for (const chunk of chunks) {
    if (!grouped.has(chunk.category)) grouped.set(chunk.category, []);
    grouped.get(chunk.category)!.push(...chunk.lines);
  }

  return categoryOrder
    .filter(cat => grouped.has(cat))
    .map(cat => ({
      category: cat,
      ...categoryConfig[cat],
      diffText: grouped.get(cat)!.join("\n"),
    }));
}

export default function GitDiffView({
  diffText,
  diffMode,
  diffFile,
  gitLog,
  onDiffModeChange,
  onCommitClick,
  onQaReview,
  qaReviewLoading,
  hasStagedChanges,
  fmtTime,
  theme,
}: GitDiffViewProps) {
  // Split diff into categorized groups
  const diffGroups = useMemo(() => splitDiffByCategory(diffText), [diffText]);

  // Count files per group
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of diffGroups) {
      counts[g.category] = (g.diffText.match(/^diff --git /gm) || []).length;
    }
    return counts;
  }, [diffGroups]);

  return (
    <div className="flex-1 overflow-auto flex flex-col">
      {/* ── Diff Toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 sticky top-0 bg-white z-10 shrink-0"
        style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
        <div className="flex gap-0.5">
          <button
            onClick={() => onDiffModeChange("working")}
            className={cn(
              "text-xs px-2.5 py-1 rounded-md font-medium transition-all",
              diffMode === "working" && !diffFile
                ? "bg-stone-800 text-white shadow-sm"
                : "text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            )}
          >
            Working Tree
          </button>
          <button
            onClick={() => onDiffModeChange("staged")}
            className={cn(
              "text-xs px-2.5 py-1 rounded-md font-medium transition-all",
              diffMode === "staged"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            )}
          >
            Staged (已 add)
          </button>
          <button
            onClick={() => onDiffModeChange("head")}
            className={cn(
              "text-xs px-2.5 py-1 rounded-md font-medium transition-all",
              diffMode === "head" || diffFile === "__HEAD__"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            )}
          >
            Last Commit
          </button>
        </div>

        <span className="flex-1" />

        {/* File indicator */}
        {diffFile && diffFile !== "__HEAD__" && !diffFile.startsWith("__commit__") && (
          <span className="text-xs text-stone-400 truncate max-w-48 font-mono">{diffFile}</span>
        )}
        {diffFile?.startsWith("__commit__") && (
          <span className="text-xs font-mono text-stone-400">{diffFile.slice(10)}</span>
        )}

        {/* QA Review button */}
        <button
          onClick={onQaReview}
          disabled={qaReviewLoading || (!diffText && !hasStagedChanges)}
          className="text-xs px-2.5 py-1 rounded-md text-white disabled:opacity-40 font-medium transition-all"
          style={{ backgroundColor: theme.accent }}
        >
          {qaReviewLoading ? "⏳ Reviewing..." : "🔬 QA Review"}
        </button>
      </div>

      {/* ── Diff Content ── */}
      {diffText ? (
        <div className="flex-1 overflow-auto">
          {diffGroups.length > 1 ? (
            // Multiple categories — show grouped
            <div className="space-y-2 p-2">
              {diffGroups.map(g => (
                <DiffGroupSection key={g.category} group={g} fileCount={groupCounts[g.category] || 0} />
              ))}
            </div>
          ) : diffGroups.length === 1 ? (
            // Single category — show flat
            <DiffViewer diffText={diffText} />
          ) : (
            <div className="flex items-center justify-center h-32 text-xs text-stone-400">No changes</div>
          )}
        </div>
      ) : (
        /* No diff — show recent commits */
        <div className="flex-1 overflow-auto p-3 space-y-1">
          <div className="text-xs text-stone-400 mb-2 font-medium">最近提交（點擊查看 diff）</div>
          {gitLog.length > 0 ? gitLog.slice(0, 15).map((c, i) => (
            <div
              key={c.hash}
              className="flex items-start gap-2 p-2 rounded-lg hover:bg-stone-50 cursor-pointer text-xs transition-colors"
              onClick={() => onCommitClick(c.hash)}
            >
              <span className="font-mono text-blue-500 shrink-0 text-[11px] bg-blue-50 px-1 rounded">{c.short}</span>
              <div className="flex-1 min-w-0">
                <div className="text-stone-700 truncate">{c.subject}</div>
                <div className="text-stone-400 mt-0.5 text-[11px]">{c.author} · {fmtTime(c.date)}</div>
              </div>
              {i === 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 font-bold shrink-0">HEAD</span>
              )}
            </div>
          )) : (
            <div className="flex items-center justify-center h-32 text-xs text-stone-400">No commits yet</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Diff Group Section (collapsible) ──
function DiffGroupSection({ group, fileCount }: { group: DiffFileGroup; fileCount: number }) {
  const [collapsed, setCollapsed] = useState(!group.defaultExpanded);
  const isCode = group.category === "code";
  const isPaaw = group.category === "paaw";

  return (
    <div className={cn(
      "rounded-lg overflow-hidden border",
      isCode ? "border-emerald-200" : isPaaw ? "border-stone-200" : "border-stone-200"
    )}>
      {/* Group header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-bold transition-colors",
          isCode
            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : isPaaw
            ? "bg-stone-50 text-stone-500 hover:bg-stone-100"
            : "bg-stone-50 text-stone-600 hover:bg-stone-100"
        )}
      >
        <span className={cn("text-[10px] transition-transform", collapsed ? "-rotate-90" : "rotate-0")}>▼</span>
        <span>{group.emoji}</span>
        <span>{group.label}</span>
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded-full",
          isCode ? "bg-emerald-100 text-emerald-600" : "bg-stone-100 text-stone-500"
        )}>
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
        {isPaaw && (
          <span className="text-[10px] text-stone-400 ml-auto">auto-managed</span>
        )}
      </button>

      {/* Diff body */}
      {!collapsed && (
        <div className={cn(isPaaw && "opacity-80")}>
          <DiffViewer diffText={group.diffText} />
        </div>
      )}
    </div>
  );
}
