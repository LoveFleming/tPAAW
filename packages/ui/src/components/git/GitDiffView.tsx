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
  // 2026-09-12：Commits 模式 — working tree 有變更時（幾乎永遠有，.paaw runtime 持續寫檔）
  // 原本「最近提交」只在 diffText 空時 render，實務上永遠看不到 → 加獨立切換鈕常開
  const [showCommits, setShowCommits] = useState(false);

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
          <button
            onClick={() => setShowCommits(v => !v)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-md font-medium transition-all",
              showCommits
                ? "bg-stone-700 text-white shadow-sm"
                : "text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            )}
          >
            📜 Commits
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
      {diffText && diffFile?.startsWith("__commit__") ? (
        // Commit detail：左檔案 list / 右單檔 diff（2026-09-12 Fleming 要求的格局）
        <CommitDetailView diffText={diffText} theme={theme} />
      ) : diffText && !showCommits ? (
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

// ── Commit Detail：per-file 拆分（左檔案 list / 右單檔 diff）──
// 2026-09-12 Fleming：commit 點進去要看左邊檔案、右邊該檔 diff（GitHub/VSCode 風格），取代整包潑文字
interface CommitFileEntry {
  path: string;
  oldPath?: string; // rename 用
  status: "M" | "A" | "D" | "R";
  adds: number;
  dels: number;
  diffText: string;
}

function splitDiffByFiles(diffText: string): CommitFileEntry[] {
  if (!diffText) return [];
  const lines = diffText.split("\n");
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (cur.length) chunks.push(cur);
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) chunks.push(cur);

  const entries: CommitFileEntry[] = [];
  for (const chunk of chunks) {
    const head = chunk[0] || "";
    const m = head.match(/^diff --git a\/(.+?) b\/(.+)$/);
    let path = m ? m[2] : head;
    let oldPath: string | undefined;
    let status: CommitFileEntry["status"] = "M";
    let adds = 0, dels = 0;
    let inHunk = false;
    for (const line of chunk) {
      if (line.startsWith("new file mode")) status = "A";
      else if (line.startsWith("deleted file mode")) status = "D";
      else if (line.startsWith("rename from ")) {
        status = "R";
        oldPath = line.slice("rename from ".length).trim();
      } else if (line.startsWith("@@ ")) {
        inHunk = true;
      } else if (inHunk) {
        if (line.startsWith("+") && !line.startsWith("+++")) adds++;
        else if (line.startsWith("-") && !line.startsWith("---")) dels++;
      }
    }
    // rename 的 diff header b/ 可能是新名；path 取 b 側，oldPath 另記
    entries.push({ path, oldPath, status, adds, dels, diffText: chunk.join("\n") });
  }
  return entries;
}

const STATUS_STYLE: Record<CommitFileEntry["status"], { icon: string; cls: string; title: string }> = {
  M: { icon: "M", cls: "bg-amber-100 text-amber-600", title: "Modified" },
  A: { icon: "A", cls: "bg-emerald-100 text-emerald-600", title: "Added" },
  D: { icon: "D", cls: "bg-red-100 text-red-600", title: "Deleted" },
  R: { icon: "R", cls: "bg-blue-100 text-blue-600", title: "Renamed" },
};

function CommitDetailView({ diffText, theme }: { diffText: string; theme: { accent: string; borderLight: string } }) {
  const files = useMemo(() => splitDiffByFiles(diffText), [diffText]);
  const [sel, setSel] = useState(0);
  const selected = files[Math.min(sel, Math.max(0, files.length - 1))];

  if (!files.length) {
    return <div className="flex-1 flex items-center justify-center text-xs text-stone-400">No changes in this commit</div>;
  }

  const dirOf = (p: string) => {
    const i = p.lastIndexOf("/");
    return i > 0 ? p.slice(0, i + 1) : "";
  };
  const baseOf = (p: string) => p.split("/").pop() || p;

  return (
    <div className="flex-1 flex min-h-0">
      {/* 左：檔案清單 */}
      <div className="w-64 shrink-0 flex flex-col min-h-0 border-r" style={{ borderColor: theme.borderLight, backgroundColor: "#fafaf9" }}>
        <div className="px-3 py-2 text-[11px] font-bold text-stone-500 sticky top-0 bg-[#fafaf9] z-10 border-b shrink-0" style={{ borderColor: theme.borderLight }}>
          Files changed · {files.length}
        </div>
        <div className="flex-1 overflow-auto py-1">
          {files.map((f, i) => {
            const st = STATUS_STYLE[f.status];
            const active = i === (selected ? files.indexOf(selected) : 0);
            return (
              <button
                key={f.path + i}
                onClick={() => setSel(i)}
                className={cn(
                  "w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors",
                  active ? "bg-white shadow-sm" : "hover:bg-stone-100/60"
                )}
              >
                <span className={cn("text-[10px] font-mono font-bold w-4 h-4 flex items-center justify-center rounded shrink-0", st.cls)} title={st.title}>{st.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className={cn("block text-[11px] truncate font-medium", active ? "text-stone-800" : "text-stone-600")}>{baseOf(f.path)}</span>
                  <span className="block text-[10px] text-stone-400 truncate">{dirOf(f.path)}</span>
                </span>
                <span className="text-[10px] font-mono shrink-0 leading-tight text-right">
                  {f.adds > 0 && <span className="text-emerald-600">+{f.adds}</span>}
                  {f.adds > 0 && f.dels > 0 && <br />}
                  {f.dels > 0 && <span className="text-red-500">−{f.dels}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* 右：選中檔 diff */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected && (
          <>
            <div className="px-3 py-1.5 text-xs font-mono text-stone-500 border-b shrink-0 flex items-center gap-2" style={{ borderColor: theme.borderLight }}>
              <span className={cn("text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded", STATUS_STYLE[selected.status].cls)}>{STATUS_STYLE[selected.status].icon}</span>
              <span className="truncate">{selected.status === "R" && selected.oldPath ? `${selected.oldPath} → ${selected.path}` : selected.path}</span>
            </div>
            <div className="flex-1 overflow-auto">
              <DiffViewer diffText={selected.diffText} />
            </div>
          </>
        )}
      </div>
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
