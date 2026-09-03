/**
 * GitFileGroup.tsx — Git 檔案分組卡片組件
 * 
 * key = fileKey(f) = "S::path" / "U::path"
 * 同名檔案 staged vs unstaged 各自獨立
 */

import React, { useState } from "react";
import { cn } from "../../utils";
import { GitFileGroup as GitFileGroupType, getStatusEmoji, getStatusColorClass, fileKey } from "./git-helpers";

interface GitFileGroupProps {
  group: GitFileGroupType;
  selectedKeys: Set<string>;
  onToggleKey: (key: string) => void;
  onSelectKeys: (keys: string[], selected: boolean) => void;
  onFileClick: (path: string, isStaged: boolean) => void;
  onUnstageFile?: (path: string) => void;
  onStageFile?: (path: string) => void;
  className?: string;
}

export default function GitFileGroupCard({
  group,
  selectedKeys,
  onToggleKey,
  onSelectKeys,
  onFileClick,
  onUnstageFile,
  onStageFile,
  className,
}: GitFileGroupProps) {
  const [expanded, setExpanded] = useState(group.defaultExpanded);
  const isCode = group.category === "code";
  const isPaaw = group.category === "paaw";

  const allKeys = group.files.map(f => fileKey(f));
  const allSelected = allKeys.length > 0 && allKeys.every(k => selectedKeys.has(k));
  const someSelected = allKeys.some(k => selectedKeys.has(k));

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-all",
        isCode ? "border-emerald-200 bg-white" : isPaaw ? "border-stone-200 bg-stone-25" : "border-stone-200 bg-white",
        className
      )}
    >
      {/* Group Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
          isCode ? "bg-emerald-50 hover:bg-emerald-100" : isPaaw ? "bg-stone-50 hover:bg-stone-100" : "bg-stone-50 hover:bg-stone-100"
        )}
      >
        <span className={cn("text-[10px] transition-transform", expanded ? "rotate-0" : "-rotate-90")}>▼</span>
        <span className="text-sm">{group.emoji}</span>
        <span className={cn("text-xs font-bold", isCode ? "text-emerald-700" : isPaaw ? "text-stone-500" : "text-stone-600")}>
          {group.label}
        </span>
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
          isCode ? "bg-emerald-100 text-emerald-700" : isPaaw ? "bg-stone-200 text-stone-500" : "bg-stone-100 text-stone-500"
        )}>
          {group.files.length}
        </span>
        <span className="flex-1" />
        {expanded && (
          <button
            type="button"
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors",
              allSelected ? "bg-emerald-100 text-emerald-600 hover:bg-red-50 hover:text-red-500"
                : someSelected ? "bg-stone-100 text-stone-500 hover:bg-emerald-50 hover:text-emerald-600"
                : "text-stone-400 hover:text-emerald-600"
            )}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSelectKeys(allKeys, !allSelected);
            }}
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
      </button>

      {/* File List */}
      {expanded && (
        <div className={cn("divide-y", isCode ? "divide-emerald-100" : "divide-stone-100")}>
          {group.files.map((f, i) => {
            const isStaged = f.staged ?? false;
            const fk = fileKey(f);
            const emoji = getStatusEmoji(f);
            const colorClass = getStatusColorClass(f, isStaged);

            return (
              <div
                key={fk}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors group",
                  isCode ? "hover:bg-emerald-25" : "hover:bg-stone-50"
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.has(fk)}
                  onChange={() => onToggleKey(fk)}
                  className={cn("w-3 h-3 shrink-0 rounded", isCode ? "accent-emerald-500" : "accent-stone-400")}
                />
                <span className={cn("font-bold w-4 shrink-0", colorClass)}>{emoji}</span>
                <span className={cn("w-4 shrink-0 text-[10px] font-mono", colorClass)}>{f.status}</span>
                <span
                  className={cn(
                    "truncate flex-1 cursor-pointer",
                    isCode ? "text-stone-700 hover:text-emerald-700" : "text-stone-500 hover:text-stone-700"
                  )}
                  onClick={() => onFileClick(f.path, isStaged)}
                  title={f.path}
                >
                  {f.path}
                </span>
                {/* Staged: unstage ✕ | Unstaged: stage + */}
                {isStaged ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onUnstageFile?.(f.path); }}
                    className="text-[9px] px-1 py-0.5 rounded shrink-0 font-medium bg-emerald-50 text-emerald-500 hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="Unstage this file"
                  >
                    staged ✕
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onStageFile?.(f.path); }}
                    className="text-[9px] px-1 py-0.5 rounded shrink-0 font-medium bg-amber-50 text-amber-500 hover:bg-emerald-50 hover:text-emerald-500 transition-colors"
                    title="Stage this file (git add)"
                  >
                    + stage
                  </button>
                )}
                {isPaaw && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-stone-100 text-stone-400 shrink-0">.paaw</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
