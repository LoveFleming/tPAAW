/**
 * DecisionCard.tsx — R1 Review Boundary 證據決策卡
 *
 * 核心鐵律：人 review 的不是 diff，是決策。
 * 先看 CHANGE / WHY / IMPACT / VERIFICATION / RISK / NEEDS_HUMAN，
 * diff 藏在 [Show Code] 後面。
 *
 * 資料來源：GET /api/coding-evidence/task/:taskId（gatherTaskEvidence 聚合）
 */

import React, { useState } from "react";
import { cn } from "../../utils";

export interface EvidenceDecisionCard {
  taskId: string;
  title: string;
  type?: string;
  status?: string;
  risk?: string | { category?: string; level?: string };
  spec?: {
    description?: string | null;
    acceptanceCriteria?: string | null;
    spec?: unknown | null;
  } | null;
  changes?: {
    summary?: unknown;
    diffStat?: { files?: number; insertions?: number | null; deletions?: number | null; range?: string } | null;
    relatedFiles?: string[];
  } | null;
  git?: {
    commit?: string | null;
    branch?: string | null;
    workingTree?: { branch?: string; dirty?: boolean; files?: string[] } | null;
  } | null;
  verification?: {
    testResult?: unknown;
    qaResult?: unknown;
    coverage?: number | null;
    pipeline?: Record<string, { status: string; by?: string; at?: string; reason?: string; result?: string; feedback?: string }> | null;
    repairLoop?: unknown;
  } | null;
  reviewBoundary?: {
    hasScope?: boolean;
    summary?: { total?: number; expected?: number; unexpected?: number; hasUnexpected?: boolean };
    expectedFiles?: { path: string; status?: string }[];
    unexpectedFiles?: { path: string; status?: string; features?: { id?: string; name?: string }[] }[];
  } | null;
  needsHumanDecision?: boolean;
  trustScore?: { score?: number; items?: { name?: string; label?: string; score?: number }[]; riskPenalty?: number; label?: string; reason?: string[] };
}

interface DecisionCardProps {
  evidence: EvidenceDecisionCard | null;
  loading?: boolean;
  onShowCode?: (path?: string) => void;
  /** i18n */
  t?: (key: string, fallback?: string) => string;
}

const RISK_LABEL: Record<string, string> = { low: "低", medium: "中", high: "高", critical: "關鍵" };
const RISK_COLOR: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

export default function DecisionCard({ evidence, loading, onShowCode, t = (k, f) => f || k }: DecisionCardProps) {
  const [showCode, setShowCode] = useState(false);

  if (loading) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-4 text-xs text-stone-400 animate-pulse">
        ⚙️ 收集證據、組決策卡…
      </div>
    );
  }

  if (!evidence) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-25 p-3 text-xs text-stone-400">
        尚無證據決策卡（沒有進行中的 task 或證據不足）— 有 AI 改動時這裡會長出 CHANGE / WHY / IMPACT / VERIFICATION / RISK。
      </div>
    );
  }

  const risk = typeof evidence.risk === "string" ? evidence.risk.toLowerCase() : (evidence.risk?.level || "").toLowerCase();
  const rb = evidence.reviewBoundary;
  const hasUnexpected = rb?.summary?.hasUnexpected || (rb?.unexpectedFiles?.length ?? 0) > 0;
  const expectedCount = rb?.summary?.expected ?? rb?.expectedFiles?.length ?? 0;
  const unexpectedCount = rb?.summary?.unexpected ?? rb?.unexpectedFiles?.length ?? 0;
  const diffStat = evidence.changes?.diffStat;
  const commit = evidence.git?.commit;
  const trust = evidence.trustScore;
  const files = (rb?.expectedFiles ?? []).map(f => f.path);

  return (
    <div className="rounded-lg border border-violet-200 overflow-hidden bg-gradient-to-b from-violet-25 to-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border-b border-violet-100">
        <span className="text-sm">📋</span>
        <span className="text-xs font-bold text-violet-800 truncate flex-1">{evidence.title}</span>
        {evidence.type && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white text-stone-500 font-semibold">{evidence.type}</span>
        )}
        {trust?.label && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold">
            🛡 {trust.label}
          </span>
        )}
        {trust?.score != null && !trust?.label && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold">
            🛡 信任 {trust.score}
          </span>
        )}
        {evidence.needsHumanDecision && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">🚧 需人決策</span>
        )}
      </div>

      {/* Decision Fields */}
      <div className="px-3 py-2 space-y-2 text-xs">
        {/* WHY */}
        <div className="flex items-start gap-2">
          <span className="shrink-0 w-14 text-[10px] font-bold text-stone-400 uppercase pt-0.5">Why</span>
          <span className="text-stone-700 leading-relaxed">
            {evidence.spec?.description || evidence.title || "(未提供需求說明)"}
          </span>
        </div>

        {/* CHANGE */}
        <div className="flex items-start gap-2">
          <span className="shrink-0 w-14 text-[10px] font-bold text-stone-400 uppercase pt-0.5">Change</span>
          <div className="flex-1 min-w-0">
            {diffStat ? (
              <span className="text-stone-600">
                <span className="font-bold">{diffStat.files ?? 0}</span> 檔
                {diffStat.insertions != null && <span className="text-emerald-600"> +{diffStat.insertions}</span>}
                {diffStat.deletions != null && <span className="text-red-500"> -{diffStat.deletions}</span>}
                {diffStat.range && <span className="text-stone-400">（{diffStat.range}）</span>}
              </span>
            ) : (
              <span className="text-stone-400">—</span>
            )}
            {commit && <span className="text-[10px] font-mono text-blue-500 ml-1">{commit.slice(0, 7)}</span>}
          </div>
        </div>

        {/* IMPACT */}
        <div className="flex items-start gap-2">
          <span className="shrink-0 w-14 text-[10px] font-bold text-stone-400 uppercase pt-0.5">Impact</span>
          <div className="flex-1 min-w-0">
            <div className="text-stone-600">
              在 scope 內 <span className="font-bold text-emerald-600">{expectedCount}</span> 檔
              {hasUnexpected && (
                <span className="ml-2 text-red-600">scope 外 <span className="font-bold">{unexpectedCount}</span> 檔 ⚠️</span>
              )}
            </div>
            {hasUnexpected && (rb?.unexpectedFiles ?? []).length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {(rb!.unexpectedFiles ?? []).slice(0, 4).map((f, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[10px] text-red-600">
                    <span>•</span>
                    <span className="truncate flex-1 font-mono">{f.path}</span>
                    {(f.features ?? []).length > 0 && (
                      <span className="text-[9px] text-stone-400 shrink-0">→ {(f.features ?? []).map(x => x.name || x.id).join(", ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* VERIFICATION */}
        <div className="flex items-start gap-2">
          <span className="shrink-0 w-14 text-[10px] font-bold text-stone-400 uppercase pt-0.5">Verify</span>
          <div className="flex-1 flex flex-wrap gap-1">
            {evidence.verification?.pipeline ? (
              Object.entries(evidence.verification.pipeline).map(([phase, p]) => {
                const st = p?.status;
                const icon = st === "done" ? "✅" : st === "in_progress" ? "🔵" : st === "rework" || st === "failed" ? "❌" : st === "awaiting_human" ? "🚧" : "⏳";
                return (
                  <span key={phase} className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded font-semibold",
                    st === "done" ? "bg-emerald-100 text-emerald-700" :
                    st === "in_progress" ? "bg-blue-100 text-blue-700" :
                    st === "rework" || st === "failed" ? "bg-red-100 text-red-700" :
                    st === "awaiting_human" ? "bg-amber-100 text-amber-700" :
                    "bg-stone-100 text-stone-500"
                  )}>
                    {icon} {phase}
                  </span>
                );
              })
            ) : (
              <span className="text-stone-400">—</span>
            )}
            {evidence.verification?.coverage != null && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-semibold">🧪 cov {Math.round(evidence.verification.coverage * 100)}%</span>
            )}
          </div>
        </div>

        {/* RISK */}
        <div className="flex items-start gap-2">
          <span className="shrink-0 w-14 text-[10px] font-bold text-stone-400 uppercase pt-0.5">Risk</span>
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-bold", RISK_COLOR[risk] || "bg-stone-100 text-stone-500")}>
            {RISK_LABEL[risk] || risk || "未評估"}
          </span>
          {evidence.needsHumanDecision && (
            <span className="text-[10px] text-red-500 font-medium">需人拍板（scope 外變更）</span>
          )}
        </div>
      </div>

      {/* Footer: Show Code / trust reason */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-25 border-t border-stone-100">
        <button
          onClick={() => setShowCode(s => !s)}
          className="text-[10px] px-2 py-1 rounded bg-white border border-stone-200 text-stone-600 hover:border-violet-300 hover:text-violet-600 font-medium transition-colors"
        >
          {showCode ? "▲ Hide Code" : "▼ Show Code"}
        </button>
        {trust?.reason?.length ? (
          <span className="text-[9px] text-stone-400 truncate flex-1" title={trust.reason.join("\n")}>
            {trust.reason.slice(0, 2).join(" · ")}
          </span>
        ) : trust?.score != null ? (
          <span className="text-[9px] text-stone-400 truncate flex-1">
            evidence-based（信任分 {trust.score}）
          </span>
        ) : (
          <span className="text-[9px] text-stone-300 flex-1">evidence-based</span>
        )}
      </div>

      {/* Show Code → file list → click to view diff */}
      {showCode && (
        <div className="px-3 py-2 border-t border-stone-100 space-y-1 max-h-40 overflow-y-auto">
          <div className="text-[9px] font-bold text-stone-400 uppercase mb-1">影響檔案（點擊看 diff）</div>
          {files.length > 0 ? (
            files.map((path, i) => (
              <button
                key={i}
                onClick={() => onShowCode?.(path)}
                className="w-full text-left flex items-center gap-1.5 text-[10px] font-mono text-stone-600 hover:text-violet-600 hover:bg-violet-25 rounded px-1 py-0.5 transition-colors"
              >
                <span className="text-stone-300">▸</span>
                <span className="truncate">{path}</span>
              </button>
            ))
          ) : (
            <div className="text-[10px] text-stone-400">無已對應檔案</div>
          )}
        </div>
      )}
    </div>
  );
}