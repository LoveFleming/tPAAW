/**
 * EvidenceCard — Evidence Package 決策卡
 *
 * 「人不 review 碼，人 review 證據」
 * 一頁看完 AI 產出的證據包：Spec 對照、變更統計、驗證狀態、
 * Pipeline 完成度、風險分級、Trust Score，加上 Approve / Reject 行動。
 *
 * 資料來源：GET /api/coding-evidence/task/:taskId
 * 行動：Approve → pipeline advance（既有 API）；Reject → pipeline reject
 */
import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface TrustItem {
  name: string;
  label: string;
  score: number;
  max: number;
}

interface Evidence {
  taskId: string;
  title: string;
  type: string;
  status: string;
  risk: { category: string; level: string };
  spec: { description: string | null; acceptanceCriteria: string[] | null; spec: unknown };
  changes: {
    summary: string | null;
    diffStat: { files: number; insertions: number | null; deletions: number | null; range?: string } | null;
    relatedFiles: string[];
  };
  git: { commit: string | null; branch: string | null; workingTree: { dirty: boolean; files: string[] } };
  verification: {
    testResult: { passed?: number; failed?: number; status?: string } | null;
    qaResult: { status?: string; overall?: string; passed?: boolean } | null;
    coverage: string | number | null;
    pipeline: Record<string, { status: string }> | null;
    repairLoop: { count: number; max: number; history: Array<{ round: number; at?: string; passed?: number; failed?: number; reason?: string; escalated?: boolean }> } | null;
  };
  provenance: {
    createdBy: string | null;
    updatedAt: string | null;
    notes: Array<{ by: string; at: string; content: string }>;
    executionResult: { agent: string | null; success: boolean | null; summary: string | null } | null;
  };
  trustScore: { score: number; items: TrustItem[]; riskPenalty: number };
  generatedAt: string;
}

const PHASES = ["spec", "implement", "review", "test", "qa", "docs", "commit"];

const PHASE_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  done: "●",
  awaiting_human: "✋",
  rejected: "✕",
  blocked: "⊘",
  needs_human: "🛑",
  rework: "🔁",
};

function riskColor(level: string): string {
  return level === "high" ? "#ef4444" : level === "medium" ? "#f59e0b" : "#22c55e";
}

function scoreColor(score: number): string {
  return score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
}

export default function EvidenceCard({
  rootPath,
  taskId,
  theme,
  onClose,
  onDecision,
}: {
  rootPath: string;
  taskId: string;
  theme: any;
  onClose: () => void;
  onDecision?: (decision: "approved" | "rejected", taskId: string) => void;
}) {
  const { t } = useI18n();
  const [ev, setEv] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<"" | "ok" | "err">("");
  const [repairing, setRepairing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/coding-evidence/task/${encodeURIComponent(taskId)}?path=${encodeURIComponent(rootPath)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEv(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [taskId, rootPath]);

  useEffect(() => { load(); }, [load]);

  const triggerRepair = async () => {
    setRepairing(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/coding-tasks/${encodeURIComponent(taskId)}/repair-loop/run?path=${encodeURIComponent(rootPath)}`,
        { method: "POST", headers: { "Content-Type": "application/json" } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 202 accepted — 背景跑，稍後手動刷新看結果
      setTimeout(() => load(), 3000);
    } catch {
      setResult("err");
    } finally {
      setRepairing(false);
    }
  };

  const approve = async () => {
    setActing(true);
    try {
      // commit 階段（或最後一個 awaiting_human 階段）標 done + advance
      const res = await fetch(
        `${API_BASE}/api/coding-tasks/${encodeURIComponent(taskId)}/pipeline/advance?path=${encodeURIComponent(rootPath)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "commit", by: "human" }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult("ok");
      onDecision?.("approved", taskId);
    } catch {
      setResult("err");
    } finally {
      setActing(false);
    }
  };

  const reject = async () => {
    setActing(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/coding-tasks/${encodeURIComponent(taskId)}/pipeline/reject?path=${encodeURIComponent(rootPath)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "commit", reason: rejectReason || t("evidence.rejectDefaultReason"), by: "human", backTo: "implement" }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult("ok");
      setShowReject(false);
      onDecision?.("rejected", taskId);
    } catch {
      setResult("err");
    } finally {
      setActing(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: theme.bg,
    border: `1px solid ${theme.borderLight}`,
    borderRadius: 10,
    padding: 16,
  };
  const sectionStyle: React.CSSProperties = {
    background: theme.bgMuted,
    border: `1px solid ${theme.borderLight}`,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", opacity: 0.55, letterSpacing: 0.5 };
  const btn = (bg: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    cursor: acting ? "wait" : "pointer",
    background: bg,
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    opacity: acting ? 0.6 : 1,
    ...extra,
  });

  if (loading) {
    return (
      <div style={cardStyle} className="text-sm">
        ⏳ {t("evidence.loading")}…
      </div>
    );
  }
  if (error || !ev) {
    return (
      <div style={cardStyle}>
        <div className="text-sm" style={{ color: "#ef4444" }}>❌ {t("evidence.loadFail")}: {error}</div>
        <button className="mt-2 text-xs underline" style={{ background: "none", border: "none", color: theme.accent, cursor: "pointer" }} onClick={onClose}>
          {t("evidence.close")}
        </button>
      </div>
    );
  }

  const testPassed = ev.verification.testResult?.passed ?? 0;
  const testFailed = ev.verification.testResult?.failed ?? 0;
  const testOk = ev.verification.testResult ? testFailed === 0 && (testPassed > 0 || ev.verification.testResult.status === "pass") : null;
  const qaOk = ev.verification.qaResult
    ? (ev.verification.qaResult.status === "pass" || ev.verification.qaResult.overall === "pass" || ev.verification.qaResult.passed === true)
    : null;
  const ds = ev.changes.diffStat;
  const riskC = riskColor(ev.risk.level);
  const scoreC = scoreColor(ev.trustScore.score);

  return (
    <div style={cardStyle}>
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-xs font-mono" style={{ opacity: 0.5 }}>{ev.taskId}</div>
          <div className="text-sm font-semibold truncate" style={{ color: theme.text }}>{ev.title}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-xs font-bold px-2 py-1 rounded"
            style={{ background: `${riskC}22`, color: riskC, border: `1px solid ${riskC}55` }}
          >
            {t(`evidence.risk.${ev.risk.level}`)} · {t(`evidence.category.${ev.risk.category}`) || ev.risk.category}
          </span>
          <button className="text-xs px-2" style={{ background: "none", border: "none", color: theme.text, opacity: 0.5, cursor: "pointer" }} onClick={onClose}>✕</button>
        </div>
      </div>

      {/* ── Trust Score ── */}
      <div style={sectionStyle}>
        <div className="flex items-center justify-between mb-1">
          <span style={labelStyle}>🛡️ {t("evidence.trustScore")}</span>
          <span className="text-lg font-bold" style={{ color: scoreC }}>{ev.trustScore.score}<span style={{ fontSize: 12, opacity: 0.5 }}>/100</span></span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: theme.borderLight, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${ev.trustScore.score}%`, background: scoreC, transition: "width .3s" }} />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs" style={{ opacity: 0.75 }}>
          {ev.trustScore.items.map((it) => (
            <span key={it.name}>
              {it.label}: <b>{it.score}</b>/{it.max}
            </span>
          ))}
          {ev.trustScore.riskPenalty !== 0 && (
            <span style={{ color: "#f59e0b" }}>{t("evidence.riskPenalty")}: {ev.trustScore.riskPenalty}</span>
          )}
        </div>
      </div>

      {/* ── Pipeline ── */}
      {ev.verification.pipeline && (
        <div style={sectionStyle}>
          <div style={labelStyle} className="mb-2">📊 {t("evidence.pipeline")}</div>
          <div className="flex items-center gap-1 flex-wrap">
            {PHASES.map((ph) => {
              const st = ev.verification.pipeline?.[ph]?.status || "pending";
              const color = st === "done" ? "#22c55e" : st === "awaiting_human" ? "#f59e0b" : st === "rejected" ? "#ef4444" : theme.borderLight;
              return (
                <span key={ph} className="text-xs px-2 py-1 rounded font-mono" style={{ border: `1px solid ${color}`, color, opacity: st === "pending" ? 0.45 : 1 }}>
                  {PHASE_ICON[st] || "○"} {ph}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Repair Loop（方案 C：有界修復迴圈）── */}
      {ev.verification.repairLoop && ev.verification.repairLoop.count > 0 && (
        <div style={{ ...sectionStyle, borderColor: ev.verification.pipeline?.test?.status === "needs_human" ? "#ef444466" : theme.borderLight }}>
          <div className="flex items-center justify-between">
            <span style={labelStyle}>🔁 {t("evidence.repairLoop")}</span>
            <span className="text-xs font-bold" style={{ color: ev.verification.pipeline?.test?.status === "needs_human" ? "#ef4444" : "#f59e0b" }}>
              {ev.verification.pipeline?.test?.status === "needs_human"
                ? `🛑 ${t("evidence.repairExhausted")}`
                : `${t("evidence.repairRound")} ${ev.verification.repairLoop.count}/${ev.verification.repairLoop.max}`}
            </span>
          </div>
          {ev.verification.repairLoop.history?.length > 0 && (
            <div className="text-xs mt-1 space-y-0.5" style={{ opacity: 0.7 }}>
              {ev.verification.repairLoop.history.slice(-3).map((h: any, i: number) => (
                <div key={i}>• R{h.round}: {h.passed}✓ {h.failed}✗ {h.escalated ? "🛑" : ""}</div>
              ))}
            </div>
          )}
          {ev.verification.pipeline?.test?.status !== "needs_human" && ev.verification.pipeline?.implement?.status === "in_progress" && (
            <button
              className="text-xs mt-2 px-3 py-1.5 rounded font-semibold"
              style={{ background: "#f59e0b", color: "#fff", border: "none", cursor: "pointer" }}
              onClick={triggerRepair}
              disabled={repairing}
            >
              {repairing ? "⏳" : "🔧"} {t("evidence.runRepair")}
            </button>
          )}
        </div>
      )}

      {/* ── Spec vs Changes vs Verification（三欄）── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
        {/* Spec */}
        <div style={sectionStyle} className="mb-0">
          <div style={labelStyle} className="mb-1">📋 {t("evidence.spec")}</div>
          <div className="text-xs" style={{ opacity: 0.8 }}>
            {ev.spec.acceptanceCriteria?.length ? (
              <ul className="list-disc pl-4 space-y-0.5">
                {ev.spec.acceptanceCriteria.slice(0, 5).map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            ) : ev.spec.description ? (
              <span>{ev.spec.description.slice(0, 180)}{(ev.spec.description.length || 0) > 180 ? "…" : ""}</span>
            ) : (
              <span style={{ opacity: 0.4 }}>{t("evidence.noSpec")}</span>
            )}
          </div>
        </div>
        {/* Changes */}
        <div style={sectionStyle} className="mb-0">
          <div style={labelStyle} className="mb-1">🔧 {t("evidence.changes")}</div>
          <div className="text-xs" style={{ opacity: 0.8 }}>
            {ds ? (
              <>
                <div>{ds.files} {t("evidence.files")}{ds.insertions != null ? ` · +${ds.insertions} −${ds.deletions}` : ""}</div>
                <div style={{ opacity: 0.5 }}>{ds.range === "working-tree" ? t("evidence.workingTree") : ds.range}</div>
              </>
            ) : (
              <span style={{ opacity: 0.4 }}>{t("evidence.noDiff")}</span>
            )}
            {ev.changes.relatedFiles.length > 0 && (
              <div className="mt-1 font-mono" style={{ opacity: 0.55 }}>{ev.changes.relatedFiles.slice(0, 3).join(", ")}{ev.changes.relatedFiles.length > 3 ? "…" : ""}</div>
            )}
          </div>
        </div>
        {/* Verification */}
        <div style={sectionStyle} className="mb-0">
          <div style={labelStyle} className="mb-1">🧪 {t("evidence.verification")}</div>
          <div className="text-xs space-y-1" style={{ opacity: 0.8 }}>
            <div>
              {testOk == null ? "⚪" : testOk ? "✅" : "❌"} {t("evidence.tests")}
              {ev.verification.testResult && <span className="ml-1 opacity-70">({testPassed}✓ {testFailed}✗)</span>}
            </div>
            <div>{qaOk == null ? "⚪" : qaOk ? "✅" : "❌"} {t("evidence.qa")}</div>
            <div>{ev.verification.coverage != null ? "✅" : "⚪"} {t("evidence.coverage")}: <b>{ev.verification.coverage ?? "—"}</b></div>
          </div>
        </div>
      </div>

      {/* ── Provenance ── */}
      <details style={sectionStyle}>
        <summary className="text-xs cursor-pointer" style={{ opacity: 0.6 }}>🧾 {t("evidence.provenance")} — {t("evidence.createdBy")}: {ev.provenance.createdBy || "—"} · {ev.provenance.updatedAt?.slice(0, 16).replace("T", " ")}</summary>
        {ev.provenance.executionResult?.summary && (
          <div className="text-xs mt-2 p-2 rounded font-mono" style={{ background: theme.bg, opacity: 0.7, whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>
            {ev.provenance.executionResult.summary}
          </div>
        )}
        {ev.provenance.notes.length > 0 && (
          <div className="text-xs mt-2 space-y-1" style={{ opacity: 0.6 }}>
            {ev.provenance.notes.map((n, i) => (
              <div key={i}>• [{n.by}] {n.content}</div>
            ))}
          </div>
        )}
        <div className="text-xs mt-2" style={{ opacity: 0.45 }}>{t("evidence.gitState")}: {ev.git.workingTree.dirty ? `⚠️ ${ev.git.workingTree.files.length} ${t("evidence.dirtyFiles")}` : "✅ clean"}{ev.git.commit ? ` · ${ev.git.commit.slice(0, 8)}` : ""}</div>
      </details>

      {/* ── Actions ── */}
      {result === "ok" ? (
        <div className="text-sm mt-1 font-semibold" style={{ color: "#22c55e" }}>✅ {t("evidence.decisionRecorded")}</div>
      ) : result === "err" ? (
        <div className="text-sm mt-1" style={{ color: "#ef4444" }}>❌ {t("evidence.actionFail")}</div>
      ) : showReject ? (
        <div className="mt-1">
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t("evidence.rejectPlaceholder")}
            rows={2}
            className="w-full text-xs p-2 rounded"
            style={{ background: theme.bgMuted, color: theme.text, border: `1px solid ${theme.borderLight}`, resize: "vertical" }}
          />
          <div className="flex gap-2 mt-1">
            <button style={btn("#ef4444")} onClick={reject} disabled={acting}>✕ {t("evidence.confirmReject")}</button>
            <button style={btn(theme.borderLight, { color: theme.text })} onClick={() => setShowReject(false)} disabled={acting}>{t("evidence.cancel")}</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-1">
          <button style={btn("#22c55e")} onClick={approve} disabled={acting}>✅ {t("evidence.approve")}</button>
          <button style={btn("#ef4444")} onClick={() => setShowReject(true)} disabled={acting}>✕ {t("evidence.reject")}</button>
          <span className="text-xs ml-auto" style={{ opacity: 0.4 }}>{t("evidence.approveHint")}</span>
        </div>
      )}
    </div>
  );
}
