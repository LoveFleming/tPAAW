/**
 * GitFileGroup.tsx — Git 檔案分組卡片組件
 * 
 * 分類顯示：Code（主）→ Config → Docs → Other → .paaw（最不顯眼）
 * 每個分組是一張可收折的卡片
 */

import React, { useState } from "react";
import { cn } from "../../utils";
import { GitFileGroup as GitFileGroupType, getStatusEmoji, getStatusColorClass } from "./git-helpers";

interface GitFileGroupProps {
  group: GitFileGroupType;
  selectedFiles: Set<string>;
  onToggleFile: (path: string) => void;
  onFileClick: (path: string, isStaged: boolean) => void;
  /** 額外 className */
  className?: string;
}

export default function GitFileGroupCard({
  group,
  selectedFiles,
  onToggleFile,
  onFileClick,
  className,
}: GitFileGroupProps) {
  const [expanded, setExpanded] = useState(group.defaultExpanded);
  const isCode = group.category === "code";
  const isPaaw = group.category === "paaw";

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-all",
        isCode
          ? "border-emerald-200 bg-white"
          : isPaaw
          ? "border-stone-200 bg-stone-25"
          : "border-stone-200 bg-white",
        className
      )}
    >
      {/* Group Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
          isCode
            ? "bg-emerald-50 hover:bg-emerald-100"
            : isPaaw
            ? "bg-stone-50 hover:bg-stone-100"
            : "bg-stone-50 hover:bg-stone-100"
        )}
      >
        {/* Expand/Collapse indicator */}
        <span className={cn(
          "text-[10px] transition-transform",
          expanded ? "rotate-0" : "-rotate-90"
        )}>
          ▼
        </span>

        {/* Category emoji + label */}
        <span className="text-sm">{group.emoji}</span>
        <span className={cn(
          "text-xs font-bold",
          isCode ? "text-emerald-700" : isPaaw ? "text-stone-500" : "text-stone-600"
        )}>
          {group.label}
        </span>

        {/* File count badge */}
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
          isCode
            ? "bg-emerald-100 text-emerald-700"
            : isPaaw
            ? "bg-stone-200 text-stone-500"
            : "bg-stone-100 text-stone-500"
        )}>
          {group.files.length}
        </span>

        <span className="flex-1" />

        {/* Select all in group */}
        {expanded && (
          <span
            className="text-[10px] text-stone-400 hover:text-stone-600"
            onClick={(e) => {
              e.stopPropagation();
              // Toggle all in group
              const allSelected = group.files.every(f => selectedFiles.has(f.path));
              group.files.forEach(f => {
                if (allSelected && selectedFiles.has(f.path)) onToggleFile(f.path);
                else if (!allSelected && !selectedFiles.has(f.path)) onToggleFile(f.path);
              });
            }}
          >
            {group.files.every(f => selectedFiles.has(f.path)) ? "Deselect" : "Select all"}
          </span>
        )}
      </button>

      {/* File List */}
      {expanded && (
        <div className={cn(
          "divide-y",
          isCode ? "divide-emerald-100" : "divide-stone-100"
        )}>
          {group.files.map((f, i) => {
            const isStaged = f.staged ?? false;
            const emoji = getStatusEmoji(f.status);
            const colorClass = getStatusColorClass(f.status, isStaged);

            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors group",
                  isCode
                    ? "hover:bg-emerald-25"
                    : "hover:bg-stone-50"
                )}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selectedFiles.has(f.path)}
                  onChange={() => onToggleFile(f.path)}
                  className={cn(
                    "w-3 h-3 shrink-0 rounded",
                    isCode ? "accent-emerald-500" : "accent-stone-400"
                  )}
                />

                {/* Status symbol */}
                <span className={cn("font-bold w-4 shrink-0", colorClass)}>
                  {emoji}
                </span>

                {/* Status letter */}
                <span className={cn("w-4 shrink-0 text-[10px] font-mono", colorClass)}>
                  {f.status}
                </span>

                {/* File path — clickable to view diff */}
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

                {/* Category tag for .paaw files */}
                {isPaaw && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-stone-100 text-stone-400 shrink-0">
                    .paaw
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
