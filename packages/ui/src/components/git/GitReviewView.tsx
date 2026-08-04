/**
 * GitReviewView.tsx — QA Code Review 結構化呈現
 * 
 * 核心改進：
 * 1. Review 結果結構化顯示（Summary / Issues / Suggestions / Tests）
 * 2. Approve / Request Changes 按鈕
 * 3. Review 歷史卡片化
 * 4. 空狀態更引導
 */

import React from "react";
import { cn } from "../../utils";

interface GitReviewViewProps {
  qaReview: string | null;
  qaReviewLoading: boolean;
  gitReviews: { id: string; ts: string; comment: string; branch?: string; files?: string[] }[];
  onRunReview: () => void;
  fmtTime: (iso: string) => string;
  theme: {
    accent: string;
    borderLight: string;
  };
}

/**
 * 嘗試將 QA review 文字解析為結構化區塊
 * 支援多種格式：markdown headers、emoji headers、numbered sections
 */
function parseReviewSections(text: string): { title: string; content: string; icon: string; severity: "info" | "warning" | "error" }[] {
  const sections: { title: string; content: string; icon: string; severity: "info" | "warning" | "error" }[] = [];

  // Try to split by markdown headers or emoji markers
  const lines = text.split("\n");
  let currentSection: { title: string; content: string; icon: string; severity: "info" | "warning" | "error" } = { title: "Summary", content: "", icon: "📋", severity: "info" };

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    const emojiMatch = line.match(/^([⚠️❌✅💡🧪📝🔍🐛🔒🎨♻️🚀])/);

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
    } else if (emojiMatch && line.trim().length < 30 && !currentSection.content) {
      // Standalone emoji line — might be a section marker
      if (currentSection.content.trim()) sections.push({ ...currentSection });
      currentSection = { title: line.replace(/[⚠️❌✅💡🧪📝🔍🐛🔒🎨♻️🚀]/g, "").trim() || "Section", content: "", icon: emojiMatch[1], severity: "info" };
    } else {
      currentSection.content += line + "\n";
    }
  }
  if (currentSection.content.trim()) sections.push({ ...currentSection });

  // If no sections parsed, show as single block
  if (sections.length === 0) {
    sections.push({ title: "Review", content: text, icon: "🔬", severity: "info" });
  }

  return sections;
}

export default function GitReviewView({
  qaReview,
  qaReviewLoading,
  gitReviews,
  onRunReview,
  fmtTime,
  theme,
}: GitReviewViewProps) {
  const sections = qaReview ? parseReviewSections(qaReview) : [];

  return (
    <div className="flex-1 overflow-auto p-3 space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <span className="text-sm">🔬</span>
        <span className="text-xs font-bold text-stone-700">QA Code Review</span>
        <span className="text-[10px] text-stone-400">由 AI 審查 staged changes</span>
        <span className="flex-1" />
        <button
          onClick={onRunReview}
          disabled={qaReviewLoading}
          className="text-xs px-3 py-1.5 rounded-md text-white disabled:opacity-40 active:scale-95 font-medium transition-all"
          style={{ backgroundColor: theme.accent }}
        >
          {qaReviewLoading ? "⏳ 審查中..." : "🔍 開始 Review"}
        </button>
      </div>

      {/* ── Loading ── */}
      {qaReviewLoading && (
        <div className="flex items-center justify-center h-32 text-stone-400 text-sm">
          <div className="flex flex-col items-center gap-2">
            <span className="text-3xl animate-pulse">🔬</span>
            <p className="text-xs">QA Agent 審查中...</p>
          </div>
        </div>
      )}

      {/* ── Review Result — Structured ── */}
      {qaReview && !qaReviewLoading && (
        <div className="space-y-2">
          {sections.map((s, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg border overflow-hidden",
                s.severity === "warning" ? "border-amber-200" :
                s.severity === "error" ? "border-red-200" :
                "border-stone-200"
              )}
            >
              {/* Section header */}
              <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs font-bold",
                s.severity === "warning" ? "bg-amber-50 text-amber-700" :
                s.severity === "error" ? "bg-red-50 text-red-700" :
                "bg-stone-50 text-stone-600"
              )}>
                <span>{s.icon}</span>
                <span>{s.title}</span>
              </div>
              {/* Section content */}
              <div className="px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-stone-600">
                {s.content.trim()}
              </div>
            </div>
          ))}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2" style={{ borderTop: `1px solid ${theme.borderLight}` }}>
            <button className="text-xs px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold transition-colors">
              ✅ Approve
            </button>
            <button className="text-xs px-3 py-1.5 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold transition-colors">
              ⚠️ Request Changes
            </button>
            <button
              onClick={onRunReview}
              className="text-xs px-3 py-1.5 rounded-md bg-stone-50 text-stone-600 hover:bg-stone-100 font-medium transition-colors"
            >
              🔄 Re-review
            </button>
          </div>
        </div>
      )}

      {/* ── Empty State ── */}
      {!qaReview && !qaReviewLoading && gitReviews.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 gap-3 text-stone-400">
          <span className="text-4xl">🔬</span>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-stone-500">No review yet</p>
            <p className="text-xs text-stone-400">點「開始 Review」讓 QA Agent 審查 staged changes</p>
            <p className="text-[10px] text-stone-300">QA 會檢查 bug、安全、跨平台、測試建議</p>
          </div>
        </div>
      )}

      {/* ── Review History ── */}
      {gitReviews.length > 0 && (
        <div className="pt-3 space-y-2" style={{ borderTop: `1px solid ${theme.borderLight}` }}>
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
