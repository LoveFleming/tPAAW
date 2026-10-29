/**
 * GitCommitBar.tsx — 固定底部的 Commit 輸入列
 * 
 * 特點：
 * 1. 永遠可見，不用捲動
 * 2. AI 生成 commit message 只看 code diff（可選看全部）
 * 3. 分組 commit：Code Only / All / .paaw Only
 * 4. IME composition 安全（useRef 追蹤）
 */

import React, { useRef, useState } from "react";
import { cn } from "../../utils";
import { classifyGitFile } from "./git-helpers";

interface GitCommitBarProps {
  commitMsg: string;
  onCommitMsgChange: (msg: string) => void;
  selectedCount: number;
  /** All staged files */
  stagedFiles: { path: string; status: string }[];
  /** All files (staged + unstaged + untracked) */
  allFiles: { path: string; status: string }[];
  /** Callbacks */
  onCommitSelected: () => void;
  onCommitAll: () => void;
  onAiGenerateMsg: (codeOnly: boolean) => void;
  /** State */
  aiLoading: boolean;
  actionMsg: string | null;
  onClearActionMsg: () => void;
  /** Theme */
  theme: {
    accent: string;
    borderLight: string;
  };
}

export default function GitCommitBar({
  commitMsg,
  onCommitMsgChange,
  selectedCount,
  stagedFiles,
  allFiles,
  onCommitSelected,
  onCommitAll,
  onAiGenerateMsg,
  aiLoading,
  actionMsg,
  onClearActionMsg,
  theme,
}: GitCommitBarProps) {
  const composingRef = useRef(false);
  const [showCommitMenu, setShowCommitMenu] = useState(false);

  // Count code vs .paaw files in selection
  const selectedCodeCount = stagedFiles.filter(p => classifyGitFile(p.path) === "code").length;
  const selectedPaawCount = stagedFiles.filter(p => classifyGitFile(p.path) === "paaw").length;
  const stagedCodeCount = stagedFiles.filter(f => classifyGitFile(f.path) === "code").length;
  const stagedPaawCount = stagedFiles.filter(f => classifyGitFile(f.path) === "paaw").length;

  return (
    <div className="shrink-0 border-t bg-white" style={{ borderColor: theme.borderLight }}>
      {/* Action feedback */}
      {actionMsg && (
        <div className={cn(
          "text-xs px-3 py-1.5",
          actionMsg.startsWith("✅") ? "bg-emerald-50 text-emerald-700" :
          actionMsg.startsWith("❌") ? "bg-red-50 text-red-700" :
          "bg-blue-50 text-blue-700"
        )}>
          {actionMsg}
          <button onClick={onClearActionMsg} className="ml-2 text-stone-400 hover:text-stone-600">✕</button>
        </div>
      )}

      {/* Commit input row */}
      <div className="flex items-center gap-1.5 px-3 py-2">
        {/* AI generate button */}
        <button
          onClick={() => onAiGenerateMsg(true)}  // default: code only
          disabled={aiLoading}
          className="text-xs px-2 py-1.5 rounded-md shrink-0 transition-colors font-medium"
          style={{ backgroundColor: "#f3e8ff", color: "#7c3aed" }}
          title="AI generate commit message (code diff only)"
        >
          {aiLoading ? "⏳" : "🤖"}
        </button>

        {/* Commit message input */}
        <input
          value={commitMsg}
          onChange={e => onCommitMsgChange(e.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={e => {
            if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter" && commitMsg.trim()) {
              e.preventDefault();
              onCommitSelected();
            }
          }}
          placeholder="Commit message... (🤖 = AI generate)"
          className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-stone-200 focus:border-stone-400 focus:outline-none bg-white text-stone-700 transition-colors"
        />

        {/* Commit Selected — primary action */}
        <button
          onClick={onCommitSelected}
          disabled={selectedCount === 0}
          className={cn(
            "text-xs px-3 py-1.5 rounded-md font-bold shrink-0 transition-all",
            "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600",
            "active:scale-95"
          )}
          data-commit-btn
        >
          ✅ Commit{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>

        {/* Commit All — dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowCommitMenu(!showCommitMenu)}
            className="text-xs px-2 py-1.5 rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors font-medium shrink-0"
          >
            📦 ▾
          </button>

          {showCommitMenu && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 z-40" onClick={() => setShowCommitMenu(false)} />
              {/* Menu */}
              <div className="absolute right-0 bottom-full mb-1 w-48 bg-white rounded-lg shadow-lg border border-stone-200 z-50 overflow-hidden">
                {/* Commit All */}
                <button
                  onClick={() => { onCommitAll(); setShowCommitMenu(false); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-stone-50 flex items-center gap-2"
                >
                  <span>📦</span>
                  <span className="flex-1">Commit All</span>
                  <span className="text-stone-400 text-[10px]">{allFiles.length} files</span>
                </button>
                {/* Commit Code Only */}
                {stagedCodeCount > 0 && (
                  <button
                    onClick={() => {
                      // Parent handles the logic — for now this is a signal
                      onCommitAll();  // TODO: pass codeOnly flag
                      setShowCommitMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 flex items-center gap-2"
                  >
                    <span>📝</span>
                    <span className="flex-1 text-emerald-700">Code Only</span>
                    <span className="text-emerald-400 text-[10px]">{stagedCodeCount} files</span>
                  </button>
                )}
                {/* AI Generate (full diff) */}
                <button
                  onClick={() => { onAiGenerateMsg(false); setShowCommitMenu(false); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-violet-50 flex items-center gap-2 border-t border-stone-100"
                >
                  <span>🤖</span>
                  <span className="flex-1 text-violet-700">AI Msg (full diff)</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
