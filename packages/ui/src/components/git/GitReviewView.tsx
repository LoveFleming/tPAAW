/**
 * GitReviewView.tsx — QA Code Review 結構化呈現
 * 
 * Loading 狀態超醒目：全屏動畫 + 步驟提示
 */

import React from "react";
import { cn } from "../../utils";

interface GitReviewViewProps {
  qaReview: string | null;
  qaReviewLoading: boolean;
  qaVerdict: { verdict: string; issues: number; critical: number; summary: string; feedback: string } | null;
  gitReviews: { id: string; ts: string; comment: string; branch?: string; files?: string[] }[];
  onRunReview: () => void;
  onApprove: () => void;
  onRework: () => void;
  fmtTime: (iso: string) => string;
  theme: {
    accent: string;
    borderLight: string;
  };
}

function parseReviewSections(text: string): { title: string; content: string; icon: string; severity: "info" | "warning" | "error" }[] {
  const sections: { title: string; content: string; icon: string; severity: "info" | "warning" | "error" }[] = [];
  const lines = text.split("\n");
  let currentSection: { title: string; content: string; icon: string; severity: "info" | "warning" | "error" } = { title: "Summary", content: "", icon: "📋", severity: "info" };

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      if (currentSection.content.trim()) sections.push({ ...currentSection });
      const title = headerMatch[1].trim();
      const icon = title.includes("Issue") || title.includes("Bug") || title.includes("問題") ? "⚠️" :
                   title.includes("Suggestion") || title.includes("建議") ? "💡" :
                   title.includes("Test") || title.includes("測試") ? "🧪" :
                   title.includes("Security") || title.includes("安全") ? "🔒" :
                   title.includes("Summary") || title.includes("摘要") ? "📋" : "📝";
      const severity = icon === "⚠️" ? "warning" : icon === "🔒" ? "error" : "info";
      currentSection = { title, content: "", icon, severity };
    } else {
      currentSection.content += line + "\n";
    }
  }
  if (currentSection.content.trim()) sections.push({ ...currentSection });
  if (sections.length === 0) {
    sections.push({ title: "Review", content: text, icon: "🔬", severity: "info" });
  }
  return sections;
}

export default function GitReviewView({
  qaReview,
  qaReviewLoading,
  qaVerdict,
  gitReviews,
  onRunReview,
  onApprove,
  onRework,
  fmtTime,
  theme,
}: GitReviewViewProps) {
  const sections = qaReview ? parseReviewSections(qaReview) : [];

  return (
    <div className="flex-1 overflow-auto flex flex-col">
      {/* ══════════════════════════════════════════════════════
          LOADING STATE — 超醒目全屏
          ══════════════════════════════════════════════════════ */}
      {qaReviewLoading && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-violet-50 to-white">
          {/* 主動畫 */}
          <div className="relative mb-4">
            <div className="text-5xl animate-pulse">🔬</div>
            <div className="absolute -top-1 -right-1 text-lg animate-bounce">⚡</div>
          </div>

          {/* 狀態文字 */}
          <div className="text-center space-y-2">
            <div className="text-sm font-bold text-violet-800">
              QA Agent 正在 Review
            </div>
            <div className="text-xs text-violet-500">
              檢查 staged changes 的 bug、安全、跨平台問題...
            </div>
          </div>

          {/* 進度步驟 */}
          <div className="mt-6 space-y-2 w-full max-w-xs">
            {[
              { icon: "📂", label: "讀取 staged diff", done: !!qaReview },
              { icon: "🔍", label: "檢查程式碼品質", done: qaReview && qaReview.length > 100 },
              { icon: "🔒", label: "安全 & 跨平台掃描", done: qaReview && qaReview.length > 500 },
              { icon: "📝", label: "撰寫 review 報告", done: qaReview && qaReview.length > 1000 },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0",
                  step.done ? "bg-emerald-100 text-emerald-600" : "bg-violet-100 text-violet-400 animate-pulse"
                )}>
                  {step.done ? "✓" : step.icon}
                </span>
                <span className={cn(
                  step.done ? "text-emerald-600 font-medium" : "text-violet-400"
                )}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>

          {/* Streaming preview — 如果已有部分結果 */}
          {qaReview && qaReview.length > 0 && (
            <div className="mt-4 w-full max-w-xs">
              <div className="text-[10px] text-stone-400 mb-1">即時預覽...</div>
              <div className="text-xs text-stone-500 bg-white rounded-lg border border-stone-200 p-3 max-h-32 overflow-auto whitespace-pre-wrap leading-relaxed">
                {qaReview.slice(-500)}
                <span className="inline-block w-1.5 h-3 bg-violet-400 animate-pulse ml-0.5" />
              </div>
            </div>
          )}

          {/* 等待提示 */}
          <div className="mt-4 text-[10px] text-stone-400">
            QA Agent 透過 AI 分析 staged diff，約需 10-30 秒
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          RESULT — Review 完成
          ══════════════════════════════════════════════════════ */}
      {!qaReviewLoading && qaReview && (
        <div className="flex-1 overflow-auto p-3 space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            <span className="text-sm">🔬</span>
            <span className="text-xs font-bold text-stone-700">QA Code Review</span>
            <span className="text-[10px] text-stone-400">完成</span>
            <span className="flex-1" />
            <button onClick={onRunReview} className="text-xs px-3 py-1.5 rounded-md text-white active:scale-95 font-medium transition-all" style={{ backgroundColor: theme.accent }}>
              🔄 Re-review
            </button>
          </div>

          {/* ══ Verdict Banner ══ */}
          {qaVerdict && (
            <div className={cn(
              "rounded-lg border-2 p-3",
              qaVerdict.verdict === "pass" ? "border-emerald-300 bg-emerald-50" :
              qaVerdict.verdict === "conditional" ? "border-amber-300 bg-amber-50" :
              "border-red-300 bg-red-50"
            )}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">
                  {qaVerdict.verdict === "pass" ? "✅" : qaVerdict.verdict === "conditional" ? "⚠️" : "🔄"}
                </span>
                <span className={cn(
                  "text-sm font-bold",
                  qaVerdict.verdict === "pass" ? "text-emerald-700" :
                  qaVerdict.verdict === "conditional" ? "text-amber-700" :
                  "text-red-700"
                )}>
                  {qaVerdict.verdict === "pass" ? "PASS — 品質達標" :
                   qaVerdict.verdict === "conditional" ? "CONDITIONAL — 有小問題" :
                   "REWORK — 退回重修"}
                </span>
                <span className="flex-1" />
                <span className="text-[10px] text-stone-400">
                  {qaVerdict.issues} issues · {qaVerdict.critical} critical
                </span>
              </div>
              <div className="text-xs text-stone-600 leading-relaxed">
                {qaVerdict.summary}
              </div>
              {qaVerdict.feedback && qaVerdict.verdict !== "pass" && (
                <div className="mt-2 pt-2 text-xs text-stone-700 border-t border-stone-200 whitespace-pre-wrap">
                  <span className="font-bold">Feedback：</span>\n{qaVerdict.feedback}
                </div>
              )}
            </div>
          )}

          {/* Structured sections (from review text) */}
          {sections.length > 1 && (
            <div className="space-y-2">
              {sections.map((s, i) => (
                <div key={i} className={cn(
                  "rounded-lg border overflow-hidden",
                  s.severity === "warning" ? "border-amber-200" :
                  s.severity === "error" ? "border-red-200" :
                  "border-stone-200"
                )}>
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-xs font-bold",
                    s.severity === "warning" ? "bg-amber-50 text-amber-700" :
                    s.severity === "error" ? "bg-red-50 text-red-700" :
                    "bg-stone-50 text-stone-600"
                  )}>
                    <span>{s.icon}</span>
                    <span>{s.title}</span>
                  </div>
                  <div className="px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-stone-600">
                    {s.content.trim()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ══ Action Buttons — 接 pipeline ══ */}
          <div className="flex items-center gap-2 pt-2" style={{ borderTop: `1px solid ${theme.borderLight}` }}>
            {qaVerdict?.verdict === "rework" && (
              <button onClick={onRework}
                className="text-xs px-4 py-2 rounded-md bg-red-500 text-white hover:bg-red-600 font-bold transition-all active:scale-95">
                🔄 Rework — 退回 Dev
              </button>
            )}
            <button onClick={onApprove}
              className={cn(
                "text-xs px-4 py-2 rounded-md font-bold transition-all active:scale-95",
                qaVerdict?.verdict === "pass"
                  ? "bg-emerald-500 text-white hover:bg-emerald-600"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              )}>
              ✅ Approve
            </button>
            <button onClick={onRework}
              className="text-xs px-3 py-2 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold transition-colors">
              ⚠️ Rework
            </button>
            <button onClick={onRunReview} className="text-xs px-3 py-2 rounded-md bg-stone-50 text-stone-600 hover:bg-stone-100 font-medium transition-colors">
              🔄 Re-review
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          EMPTY STATE — 還沒跑過 review
          ══════════════════════════════════════════════════════ */}
      {!qaReviewLoading && !qaReview && gitReviews.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3">
          <span className="text-4xl">🔬</span>
          <div className="text-center space-y-1.5">
            <p className="text-sm font-medium text-stone-500">No review yet</p>
            <p className="text-xs text-stone-400">點「開始 Review」讓 QA Agent 審查 staged changes</p>
            <p className="text-[10px] text-stone-300">QA 會檢查 bug、安全、跨平台、測試建議</p>
          </div>
          <button onClick={onRunReview} className="mt-2 text-xs px-4 py-2 rounded-md text-white font-bold transition-all active:scale-95" style={{ backgroundColor: theme.accent }}>
            🔍 開始 Review
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          HISTORY — Review 歷史
          ══════════════════════════════════════════════════════ */}
      {!qaReviewLoading && gitReviews.length > 0 && (
        <div className="shrink-0 border-t p-3 space-y-2" style={{ borderColor: theme.borderLight }}>
          <div className="text-xs font-bold text-stone-500 flex items-center gap-1.5">
            <span>📜</span>
            <span>Review 歷史 ({gitReviews.length})</span>
          </div>
          {gitReviews.filter(r => r.comment !== qaReview).slice(0, 10).map((r, i) => (
            <details key={r.id || i} className="rounded-lg border border-stone-200 overflow-hidden">
              <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700 px-3 py-2 bg-stone-50 hover:bg-stone-100 transition-colors flex items-center gap-2">
                {r.branch && <span className="text-emerald-500 font-medium">🔀 {r.branch}</span>}
                <span>{fmtTime(r.ts)}</span>
                {r.files && <span className="text-stone-400">· {r.files.length} files</span>}
              </summary>
              <div className="text-xs text-stone-600 px-3 py-2 whitespace-pre-wrap leading-relaxed border-l-2 border-stone-200 ml-3">
                {r.comment?.slice(0, 800)}{r.comment?.length > 800 ? "..." : ""}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
