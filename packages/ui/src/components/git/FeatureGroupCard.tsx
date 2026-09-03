/**
 * FeatureGroupCard.tsx — Feature-first 檔案分組卡片
 *
 * Phase A：檔案按 Feature 分組取代扁平清單。
 * feature 是主角（violet 主視覺），檔名是配角。
 * 同一檔可能對應多個 feature → 重複出現在多張卡屬正常。
 */

import React, { useState } from "react";
import { cn } from "../../utils";
import {
  GitFileStatus,
  FeatureGroup,
  getStatusEmoji,
  getStatusColorClass,
  fileKey,
} from "./git-helpers";

interface FeatureGroupCardProps {
  group: FeatureGroup;
  /** 此卡是否為「未對應 feature」的 fallback（unmapped code） */
  unmapped?: boolean;
  selectedKeys: Set<string>;
  onToggleKey: (key: string) => void;
  onSelectKeys: (keys: string[], selected: boolean) => void;
  onFileClick: (path: string, isStaged: boolean) => void;
  onUnstageFile?: (path: string) => void;
  onStageFile?: (path: string) => void;
}

export default function FeatureGroupCard({
  group,
  unmapped = false,
  selectedKeys,
  onToggleKey,
  onSelectKeys,
  onFileClick,
  onUnstageFile,
  onStageFile,
}: FeatureGroupCardProps) {
  const [expanded, setExpanded] = useState(true);

  const allKeys = group.files.map(f => fileKey(f));
  const allSelected = allKeys.length > 0 && allKeys.every(k => selectedKeys.has(k));
  const someSelected = allKeys.some(k => selectedKeys.has(k));

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-all",
        unmapped
          ? "border-amber-200 bg-white"
          : "border-violet-200 bg-white"
      )}
    >
      {/* Feature Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
          unmapped
            ? "bg-amber-50 hover:bg-amber-100"
            : "bg-violet-50 hover:bg-violet-100"
        )}
      >
        <span className={cn("text-[10px] transition-transform", expanded ? "rotate-0" : "-rotate-90")}>▼</span>
        <span className="text-sm">{unmapped ? "🧩" : "🎯"}</span>
        <span className={cn("text-xs font-bold", unmapped ? "text-amber-700" : "text-violet-700")}>
          {group.name}
        </span>
        {!unmapped && group.featureId && (
          <span className="text-[9px] text-violet-400 font-mono">{group.featureId}</span>
        )}
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
          unmapped ? "bg-amber-100 text-amber-700" : "bg-violet-100 text-violet-700"
        )}>
          {group.files.length}
        </span>
        <span className="flex-1" />
        {unmapped && (
          <span className="text-[9px] text-amber-500 mr-1">未對應 feature</span>
        )}
        {expanded && (
          <button
            type="button"
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors",
              allSelected ? "bg-violet-200 text-violet-700 hover:bg-red-100 hover:text-red-500"
                : someSelected ? "bg-white text-stone-500 hover:bg-violet-100 hover:text-violet-600"
                : "text-stone-400 hover:text-violet-600"
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
        <div className="divide-y divide-violet-100">
          {group.files.map((f, i) => {
            const isStaged = f.staged ?? false;
            const fk = fileKey(f);
            const emoji = getStatusEmoji(f.status);
            const colorClass = getStatusColorClass(f.status, isStaged);

            return (
              <div
                key={fk}
                className="flex items-center gap-2 px-3 py-1.5 text-xs transition-colors group hover:bg-violet-25"
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.has(fk)}
                  onChange={() => onToggleKey(fk)}
                  className="w-3 h-3 shrink-0 rounded accent-violet-500"
                />
                <span className={cn("font-bold w-4 shrink-0", colorClass)}>{emoji}</span>
                <span className={cn("w-4 shrink-0 text-[10px] font-mono", colorClass)}>{f.status}</span>
                <span
                  className="truncate flex-1 cursor-pointer text-stone-700 hover:text-violet-700"
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}