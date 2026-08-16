/**
 * GitPanel.tsx — Git 主面板
 * 
 * 整合所有 Git 子組件，取代 CodingIDE.tsx 內聯的 Git Panel
 * 
 * 設計原則：
 * 1. Code 是主角，.paaw 是配角
 * 2. 分組顯示 + 視覺層次
 * 3. Commit Bar 固定底部
 * 4. Tab 切換：Status / Diff / Blame / Review
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "../../utils";
import GitStatusView from "./GitStatusView";
import GitDiffView from "./GitDiffView";
import GitReviewView from "./GitReviewView";
import GitCommitBar from "./GitCommitBar";
import { classifyGitFile, fileKey, pathFromFileKey } from "./git-helpers";

// ── Types ──
interface GitFileStatus {
  status: string;
  path: string;
}

interface GitCommit {
  hash: string;
  short: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

interface BlameLine {
  hash: string;
  author: string;
  authorMail: string;
  authorTime: string;
  summary: string;
  finalLine: number;
  content: string;
  short?: string;
}

interface StagedChangeSummary {
  exists: boolean;
  agent?: string;
  codename?: string;
  task?: string;
  codeFiles?: { path: string; reason: string }[];
  paawFiles?: { path: string; reason: string }[];
  files?: { path: string; reason: string }[];
  howToTest?: string;
  risk?: string;
  createdAt?: string;
}

interface GitPanelProps {
  rootPath: string;
  API_BASE: string;

  // ── Git State ──
  gitStatus: {
    branch: string;
    staged: GitFileStatus[];
    unstaged: GitFileStatus[];
    untracked: GitFileStatus[];
    all: GitFileStatus[];
  } | null;
  gitLog: GitCommit[];
  gitDiff: string;
  gitDiffFile: string;
  gitDiffCached: boolean;
  gitCommitMsg: string;
  gitActionMsg: string | null;
  selectedFiles: Set<string>;
  aiCommitLoading: boolean;
  stagedSummary: StagedChangeSummary | null;
  qaReview: string | null;
  qaVerdict: { verdict: string; issues: number; critical: number; summary: string; feedback: string } | null;
  qaReviewLoading: boolean;
  gitReviews: { id: string; ts: string; comment: string; branch?: string; files?: string[] }[];

  // ── Blame ──
  blameData: BlameLine[] | null;
  blameFile: string;

  // ── Active task for pipeline actions ──
  activeCodingTask: { id: string; title: string; loopModeOverride?: string | null; effectiveLoopMode?: string; pipeline?: Record<string, any> } | null;
  // ── Project-level loop mode ──
  projectLoopMode: "mini" | "full";

  // ── Setters (passed through) ──
  setGitTab: (tab: "status" | "diff" | "blame" | "review") => void;
  setGitCommitMsg: (msg: string) => void;
  setGitActionMsg: (msg: string | null) => void;
  setSelectedFiles: (files: Set<string>) => void;
  setGitDiffFile: (file: string) => void;
  setGitDiff: (diff: string) => void;
  setGitDiffCached: (cached: boolean) => void;
  setActiveSubPanel: (panel: string) => void;
  setStagedSummary: (summary: StagedChangeSummary | null) => void;

  // ── Callbacks ──
  refreshGitStatus: () => void;
  refreshGitLog: () => void;
  loadGitDiff: (file?: string, cached?: boolean, commit?: string) => void;
  runQaReview: () => void;

  // ── Helpers ──
  fmtTime: (iso: string) => string;

  // ── Theme ──
  theme: {
    accent: string;
    borderLight: string;
    bg: string;
    bgMuted: string;
  };

  // ── i18n ──
  tt: (key: string, fallback?: string) => string;
}

type GitTab = "status" | "diff" | "blame" | "review";

export default function GitPanel(props: GitPanelProps) {
  const {
    rootPath,
    API_BASE,
    gitStatus,
    gitLog,
    gitDiff,
    gitDiffFile,
    gitDiffCached,
    gitCommitMsg,
    gitActionMsg,
    selectedFiles,
    aiCommitLoading,
    stagedSummary,
    qaReview,
    qaVerdict,
    qaReviewLoading,
    gitReviews,
    blameData,
    blameFile,
    activeCodingTask,
    projectLoopMode,
    setGitTab: setExternalGitTab,
    setGitCommitMsg,
    setGitActionMsg,
    setSelectedFiles,
    setGitDiffFile,
    setGitDiff,
    setGitDiffCached,
    setActiveSubPanel,
    setStagedSummary,
    refreshGitStatus,
    refreshGitLog,
    loadGitDiff,
    runQaReview,
    fmtTime,
    theme,
    tt,
  } = props;

  const [gitTab, setLocalGitTab] = useState<GitTab>("status");
  const [unpushed, setUnpushed] = useState<{ ahead: number; behind: number; commits: { hash?: string; short: string; subject: string; author: string; date: string }[] } | null>(null);

  // 待推送清單：人的 review queue（agent commit 不 push，人在這裡看過再推）
  const fetchUnpushed = useCallback(async () => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/vibe-git/unpushed?path=${encodeURIComponent(rootPath)}`);
      const d = await r.json();
      setUnpushed(d.error ? null : d);
    } catch { setUnpushed(null); }
  }, [rootPath, API_BASE]);

  useEffect(() => {
    fetchUnpushed();
    const iv = setInterval(fetchUnpushed, 15000);
    return () => clearInterval(iv);
  }, [fetchUnpushed]);

  const setGitTab = useCallback((tab: GitTab) => {
    setLocalGitTab(tab);
    setExternalGitTab(tab);
  }, [setExternalGitTab]);

  // ── Selected keys (fileKey = "S::path" / "U::path") ──
  // Internal state uses fileKey for uniqueness
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Sync with parent's selectedFiles (path-based) on mount / when gitStatus changes
  // But internally we track by fileKey for correctness
  useEffect(() => {
    // When gitStatus changes, recompute selectedKeys from selectedFiles prop
    if (!gitStatus) return;
    const allFiles: (GitFileStatus & { staged: boolean })[] = [];
    for (const f of gitStatus.staged) allFiles.push({ ...f, staged: true });
    for (const f of gitStatus.unstaged) allFiles.push({ ...f, staged: false });
    for (const f of gitStatus.untracked) allFiles.push({ ...f, staged: false });
    // Map selectedFiles (paths) → selectedKeys (fileKeys)
    // If a path is selected and appears in both staged+unstaged, select both keys
    const newKeys = new Set<string>();
    for (const f of allFiles) {
      if (selectedFiles.has(f.path)) newKeys.add(fileKey(f));
    }
    setSelectedKeys(newKeys);
  }, [gitStatus, selectedFiles]);

  // ── Toggle single file by key ──
  const toggleKey = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // ── Select multiple keys at once ──
  const selectKeys = useCallback((keys: string[], selected: boolean) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      for (const k of keys) {
        if (selected) next.add(k); else next.delete(k);
      }
      return next;
    });
  }, []);

  // ── Select All / Clear ──
  const selectAllFiles = useCallback(() => {
    if (!gitStatus) return;
    const allKeys: string[] = [];
    for (const f of gitStatus.staged) allKeys.push(fileKey({ ...f, staged: true }));
    for (const f of gitStatus.unstaged) allKeys.push(fileKey({ ...f, staged: false }));
    for (const f of gitStatus.untracked) allKeys.push(fileKey({ ...f, staged: false }));
    selectKeys(allKeys, true);
  }, [gitStatus, selectKeys]);

  const clearAllFiles = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  // ── Get selected paths (for commit API) from selectedKeys ──
  const getSelectedPaths = useCallback((): string[] => {
    return Array.from(selectedKeys).map(k => pathFromFileKey(k));
  }, [selectedKeys]);

  // ── Selected count (by unique paths) ──
  const selectedPathCount = useMemo(() => {
    return new Set(Array.from(selectedKeys).map(k => pathFromFileKey(k))).size;
  }, [selectedKeys]);

  // ── File click → view diff ──
  const handleFileClick = useCallback((path: string, isStaged: boolean) => {
    loadGitDiff(path, isStaged);
    setGitTab("diff");
    setActiveSubPanel("diff");
  }, [loadGitDiff, setGitTab, setActiveSubPanel]);

  // ── Git actions ──
  const handlePull = useCallback(async () => {
    setGitActionMsg("Pulling...");
    try {
      const r = await fetch(`${API_BASE}/api/vibe-git/pull?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
      const d = await r.json();
      setGitActionMsg(d.ok ? `✅ ${d.output || d.message}` : `❌ ${d.error}`);
      refreshGitStatus();
      refreshGitLog();
      fetchUnpushed();
    } catch (e: any) { setGitActionMsg(`❌ ${e.message}`); }
  }, [rootPath, API_BASE, setGitActionMsg, refreshGitStatus, refreshGitLog, fetchUnpushed]);

  const handlePush = useCallback(async () => {
    setGitActionMsg("Pushing...");
    try {
      const r = await fetch(`${API_BASE}/api/vibe-git/push?path=${encodeURIComponent(rootPath)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      setGitActionMsg(d.ok ? `✅ ${d.output || d.message}` : `❌ ${d.error}`);
      refreshGitStatus();
      refreshGitLog();
      fetchUnpushed();
    } catch (e: any) { setGitActionMsg(`❌ ${e.message}`); }
  }, [rootPath, API_BASE, setGitActionMsg, refreshGitStatus, refreshGitLog, fetchUnpushed]);

  const handleRefresh = useCallback(() => {
    refreshGitStatus();
    refreshGitLog();
    loadGitDiff();
    if (rootPath) {
      fetch(`${API_BASE}/api/coding-staged/changes?path=${encodeURIComponent(rootPath)}`)
        .then(r => r.json())
        .then(data => setStagedSummary(data))
        .catch(() => {});
    }
  }, [rootPath, API_BASE, refreshGitStatus, refreshGitLog, loadGitDiff, setStagedSummary]);

  // ── QA Approve — human overrides, advance pipeline ──
  const handleQaApprove = useCallback(async () => {
    if (!activeCodingTask?.id || !rootPath) return;
    setGitActionMsg("✅ Human approved — advancing pipeline...");
    try {
      // Advance QA phase (if not already done)
      const pipeline = activeCodingTask.pipeline;
      if (pipeline?.qa?.status !== "done") {
        await fetch(`${API_BASE}/api/coding-tasks/${encodeURIComponent(activeCodingTask.id)}/pipeline/advance?path=${encodeURIComponent(rootPath)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "qa", result: "Human approved after review", by: "human" }),
        });
      }
      setGitActionMsg("✅ Pipeline advanced to commit phase");
    } catch (e: any) {
      setGitActionMsg(`❌ ${e.message}`);
    }
  }, [activeCodingTask, rootPath, API_BASE, setGitActionMsg]);

  // ── QA Rework — human triggers rework, reject pipeline ──
  const handleQaRework = useCallback(async () => {
    if (!activeCodingTask?.id || !rootPath) return;
    const feedback = qaVerdict?.feedback || "Human requested rework";
    setGitActionMsg("🔄 Rework — returning to implement phase...");
    try {
      await fetch(`${API_BASE}/api/coding-tasks/${encodeURIComponent(activeCodingTask.id)}/pipeline/reject?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "qa",
          status: "rework",
          reason: feedback,
          feedback,
          by: "human",
          returnTo: "implement",
        }),
      });
      setGitActionMsg("🔄 Rework — Dev will be re-dispatched");
    } catch (e: any) {
      setGitActionMsg(`❌ ${e.message}`);
    }
  }, [activeCodingTask, rootPath, API_BASE, qaVerdict, setGitActionMsg]);

  // ── Spec Approve — human confirms spec, advance to implement ──
  const handleSpecApprove = useCallback(async () => {
    if (!activeCodingTask?.id || !rootPath) return;
    setGitActionMsg("✅ Spec approved — starting implementation...");
    try {
      await fetch(`${API_BASE}/api/coding-tasks/${encodeURIComponent(activeCodingTask.id)}/pipeline/advance?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "spec", result: "Human approved spec", by: "human" }),
      });
      setGitActionMsg("✅ Spec approved — Dev will be dispatched");
    } catch (e: any) {
      setGitActionMsg(`❌ ${e.message}`);
    }
  }, [activeCodingTask, rootPath, API_BASE, setGitActionMsg]);

  // ── Spec Reject — reject spec, return to spec ──
  const handleSpecReject = useCallback(async () => {
    if (!activeCodingTask?.id || !rootPath) return;
    setGitActionMsg("❌ Spec rejected — rewriting spec...");
    try {
      await fetch(`${API_BASE}/api/coding-tasks/${encodeURIComponent(activeCodingTask.id)}/pipeline/reject?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "spec",
          status: "rework",
          reason: "Human rejected spec",
          by: "human",
          returnTo: "spec",
        }),
      });
      setGitActionMsg("❌ Spec rejected — Architect will rewrite");
    } catch (e: any) {
      setGitActionMsg(`❌ ${e.message}`);
    }
  }, [activeCodingTask, rootPath, API_BASE, setGitActionMsg]);
  const handleUnstageFile = useCallback(async (path: string) => {
    if (!rootPath) return;
    setGitActionMsg(`Unstaging ${path.split(/[\\/]/).pop()}...`);
    try {
      const r = await fetch(`${API_BASE}/api/vibe-git/unstage?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: path }),
      });
      const d = await r.json();
      if (d.ok) {
        setGitActionMsg(`✅ Unstaged: ${path.split(/[\\/]/).pop()}`);
      } else {
        setGitActionMsg(`❌ ${d.error}`);
      }
      refreshGitStatus();
      refreshGitLog();
    } catch (e: any) {
      setGitActionMsg(`❌ ${e.message}`);
    }
  }, [rootPath, API_BASE, setGitActionMsg, refreshGitStatus, refreshGitLog]);

  // ── Stage file (git add) ──
  const handleStageFile = useCallback(async (path: string) => {
    if (!rootPath) return;
    setGitActionMsg(`Staging ${path.split(/[\\/]/).pop()}...`);
    try {
      const r = await fetch(`${API_BASE}/api/vibe-git/add?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [path] }),
      });
      const d = await r.json();
      if (d.ok) {
        setGitActionMsg(`✅ Staged: ${path.split(/[\\/]/).pop()}`);
      } else {
        setGitActionMsg(`❌ ${d.error}`);
      }
      refreshGitStatus();
      refreshGitLog();
    } catch (e: any) {
      setGitActionMsg(`❌ ${e.message}`);
    }
  }, [rootPath, API_BASE, setGitActionMsg, refreshGitStatus, refreshGitLog]);

  // ── Commit actions ──
  const handleCommitSelected = useCallback(async () => {
    const files = getSelectedPaths();
    if (files.length === 0) { setGitActionMsg("⚠️ No files selected — check boxes below"); return; }
    if (!gitCommitMsg.trim()) { setGitActionMsg("⚠️ Enter commit message first"); return; }
    setGitActionMsg(`Staging ${files.length} file(s)...`);
    const addRes = await fetch(`${API_BASE}/api/vibe-git/add?path=${encodeURIComponent(rootPath)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
    const addData = await addRes.json();
    if (!addData.ok) { setGitActionMsg(`❌ Stage failed: ${addData.error}`); return; }
    setGitActionMsg("Committing...");
    const commitRes = await fetch(`${API_BASE}/api/vibe-git/commit?path=${encodeURIComponent(rootPath)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: gitCommitMsg.trim() }) });
    const commitData = await commitRes.json();
    if (!commitData.ok) { setGitActionMsg(`❌ Commit failed: ${commitData.error}`); refreshGitStatus(); return; }
    setGitActionMsg(`✅ Committed ${files.length} file(s): ${commitData.output || commitData.message}`);
    setGitCommitMsg("");
    setSelectedKeys(new Set());
    try { await fetch(`${API_BASE}/api/coding-staged/changes?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" }); setStagedSummary(null); } catch {}
    refreshGitStatus();
    refreshGitLog();
  }, [getSelectedPaths, gitCommitMsg, rootPath, API_BASE, setGitActionMsg, setGitCommitMsg, setSelectedKeys, setStagedSummary, refreshGitStatus, refreshGitLog]);

  const handleCommitAll = useCallback(async () => {
    if (!gitStatus?.staged?.length && !gitStatus?.unstaged?.length && !gitStatus?.untracked?.length) {
      setGitActionMsg("Nothing to commit"); return;
    }
    const files = gitStatus.all?.map(f => f.path) || ["."];
    setGitActionMsg("Staging...");
    const addRes = await fetch(`${API_BASE}/api/vibe-git/add?path=${encodeURIComponent(rootPath)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
    const addData = await addRes.json();
    if (!addData.ok) { setGitActionMsg(`❌ Stage failed: ${addData.error}`); return; }
    if (!gitCommitMsg.trim()) { setGitActionMsg("⚠️ Enter commit message first"); refreshGitStatus(); return; }
    setGitActionMsg("Committing...");
    const commitRes = await fetch(`${API_BASE}/api/vibe-git/commit?path=${encodeURIComponent(rootPath)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: gitCommitMsg.trim() }) });
    const commitData = await commitRes.json();
    if (!commitData.ok) { setGitActionMsg(`❌ Commit failed: ${commitData.error}`); refreshGitStatus(); return; }
    setGitActionMsg(`✅ ${commitData.output || commitData.message}`);
    setGitCommitMsg("");
    setSelectedKeys(new Set());
    try { await fetch(`${API_BASE}/api/coding-staged/changes?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" }); setStagedSummary(null); } catch {}
    refreshGitStatus();
    refreshGitLog();
  }, [gitStatus, gitCommitMsg, rootPath, API_BASE, setGitActionMsg, setGitCommitMsg, setSelectedFiles, setStagedSummary, refreshGitStatus, refreshGitLog]);

  // ── AI commit message ──
  const handleAiGenerateMsg = useCallback(async (codeOnly: boolean) => {
    if (!rootPath) return;
    setGitActionMsg(null);  // Will be set by the commit bar via aiCommitLoading
    try {
      let diffText = "";
      const selFiles = getSelectedPaths();
      if (selFiles.length > 0) {
        for (const fp of selFiles) {
          if (codeOnly && classifyGitFile(fp) !== "code") continue;
          const r = await fetch(`${API_BASE}/api/vibe-git/diff?path=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(fp)}`);
          const d = await r.json();
          if (d.diff) diffText += d.diff + "\n";
        }
      } else {
        diffText = gitDiff;
        if (!diffText) {
          const r = await fetch(`${API_BASE}/api/vibe-git/diff?path=${encodeURIComponent(rootPath)}`);
          const d = await r.json();
          diffText = d.diff || "";
        }
        // 沒勾選且 working diff 空 → fallback 讀 staged（agent 已 git add 的場景）
        if (!diffText) {
          const r = await fetch(`${API_BASE}/api/vibe-git/diff?path=${encodeURIComponent(rootPath)}&mode=staged`);
          const d = await r.json();
          diffText = d.diff || "";
        }
        // If codeOnly, filter the diff
        if (codeOnly && diffText) {
          const lines = diffText.split("\n");
          const filtered: string[] = [];
          let include = true;
          for (const line of lines) {
            if (line.startsWith("diff --git ")) {
              const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
              const filePath = match ? match[2] : "";
              include = classifyGitFile(filePath) === "code";
            }
            if (include) filtered.push(line);
          }
          diffText = filtered.join("\n");
        }
      }
      if (!diffText) { setGitActionMsg("⚠️ No code diff to analyze"); return; }
      const res = await fetch(`${API_BASE}/api/vibe-git/ai-commit-msg?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff: diffText, files: selFiles.length > 0 ? selFiles : undefined }),
      });
      const data = await res.json();
      if (data.message) {
        setGitCommitMsg(data.message);
        setGitActionMsg("✅ AI generated commit message (code only)");
      } else {
        setGitActionMsg(`⚠️ ${data.error || "AI couldn't generate a message"}`);
      }
    } catch (e: any) { setGitActionMsg(`❌ ${e.message}`); }
  }, [rootPath, API_BASE, selectedFiles, gitDiff, setGitCommitMsg, setGitActionMsg]);

  // ── Apply staged summary to commit msg ──
  const handleApplySummary = useCallback((msg: string) => {
    setGitCommitMsg(msg);
    setGitTab("status");
  }, [setGitCommitMsg, setGitTab]);

  // ── Diff mode change ──
  const handleDiffModeChange = useCallback((mode: "working" | "staged" | "head") => {
    if (mode === "working") { loadGitDiff(undefined, false); setGitDiffFile(""); setGitDiffCached(false); }
    else if (mode === "staged") { loadGitDiff(undefined, true); setGitDiffFile(""); setGitDiffCached(true); }
    else if (mode === "head") { loadGitDiff(undefined, false, "HEAD"); setGitDiffFile("__HEAD__"); }
  }, [loadGitDiff, setGitDiffFile, setGitDiffCached]);

  // ── Commit click in diff ──
  const handleCommitClick = useCallback(async (hash: string) => {
    setGitDiffFile("__commit__" + hash);
    try {
      const res = await fetch(`${API_BASE}/api/vibe-git/diff?path=${encodeURIComponent(rootPath)}&commit=${encodeURIComponent(hash)}`);
      const data = await res.json();
      setGitDiff(data.diff || "");
      setLocalGitTab("diff");
    } catch {}
  }, [rootPath, API_BASE, setGitDiffFile, setGitDiff]);

  // ── Tab labels ──
  const tabConfig: { id: GitTab; label: string }[] = [
    { id: "status", label: tt("vibe.gitStatus") },
    { id: "diff", label: tt("vibe.gitDiff") },
    { id: "blame", label: tt("vibe.gitBlame") },
    { id: "review", label: "🔬 Review" },
  ];

  // Determine active diff mode
  const activeDiffMode: "working" | "staged" | "head" = gitDiffCached ? "staged" : gitDiffFile === "__HEAD__" ? "head" : "working";

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* ── Git sub-tabs ── */}
      <div className="flex items-center px-2 py-1 shrink-0 gap-0.5" style={{ backgroundColor: theme.bg, borderBottom: `1px solid ${theme.borderLight}` }}>
        {tabConfig.map(t => (
          <button
            key={t.id}
            onClick={() => {
              setGitTab(t.id);
              if (t.id === "diff") setActiveSubPanel("diff");
              if (t.id === "blame" && blameData) setActiveSubPanel("blame");
            }}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1",
              gitTab === t.id
                ? "bg-white text-stone-700 shadow-sm"
                : "text-stone-400 hover:text-stone-600 hover:bg-white/50"
            )}
          >
            {t.label}
          </button>
        ))}
        <span className="flex-1" />
        <button
          onClick={handleRefresh}
          className="text-xs text-stone-400 hover:text-stone-600 px-1.5 py-0.5 rounded hover:bg-stone-50 transition-colors"
        >
          🔄
        </button>
      </div>

      {/* ── Tab Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Status */}
        {gitTab === "status" && (
          <GitStatusView
            gitStatus={gitStatus}
            unpushed={unpushed}
            onCommitClick={handleCommitClick}
            selectedKeys={selectedKeys}
            onToggleKey={toggleKey}
            onSelectKeys={selectKeys}
            onFileClick={handleFileClick}
            stagedSummary={stagedSummary}
            onPull={handlePull}
            onPush={handlePush}
            onRefresh={handleRefresh}
            gitLog={gitLog}
            fmtTime={fmtTime as any}
            onApplySummary={handleApplySummary}
            onQaReview={runQaReview}
            onSelectAll={selectAllFiles}
            onClearAll={clearAllFiles}
            onUnstageFile={handleUnstageFile}
            onStageFile={handleStageFile}
            qaReviewLoading={qaReviewLoading}
            pipeline={activeCodingTask?.pipeline || null}
            loopMode={projectLoopMode}
            projectLoopMode={projectLoopMode}
            qaVerdict={qaVerdict}
            onSpecApprove={handleSpecApprove}
            onSpecReject={handleSpecReject}
            theme={theme}
          />
        )}

        {/* Diff */}
        {gitTab === "diff" && (
          <GitDiffView
            diffText={gitDiff}
            diffMode={activeDiffMode}
            diffFile={gitDiffFile}
            gitLog={gitLog}
            onDiffModeChange={handleDiffModeChange}
            onCommitClick={handleCommitClick}
            onQaReview={runQaReview}
            qaReviewLoading={qaReviewLoading}
            hasStagedChanges={!!gitStatus?.staged?.length}
            fmtTime={fmtTime as any}
            theme={theme}
          />
        )}

        {/* Blame */}
        {gitTab === "blame" && blameData && (
          <div className="flex-1 overflow-auto">
            <div className="flex items-center gap-2 px-3 py-1.5 sticky top-0 bg-white z-10" style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
              <span className="text-xs font-bold text-stone-500">🔍 Blame — {blameFile}</span>
            </div>
            <table className="w-full text-sm font-mono" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {blameData.map((line, i) => {
                  const prevHash = i > 0 ? blameData[i - 1].hash : "";
                  const showAuthor = line.hash !== prevHash;
                  return (
                    <tr key={i} style={{ borderTop: showAuthor ? "1px solid #e5e5e5" : "none" }}>
                      <td className="px-2 py-0 text-right text-stone-300 select-none w-8 shrink-0">{line.finalLine}</td>
                      <td className="px-2 py-0 w-32 shrink-0 truncate" style={{ color: showAuthor ? "#3B82F6" : "#c0c0c0" }}>
                        {showAuthor ? (
                          <span className="flex flex-col">
                            <span className="truncate font-semibold">{line.author}</span>
                            <span className="text-xs text-stone-400 truncate">{line.short || line.hash?.slice(0, 7)} · {fmtTime(line.authorTime)}</span>
                          </span>
                        ) : <span className="text-stone-200">│</span>}
                      </td>
                      <td className="px-2 py-0 text-stone-700 leading-5 whitespace-pre">{line.content}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Review */}
        {gitTab === "review" && (
          <GitReviewView
            qaReview={qaReview}
            qaVerdict={qaVerdict}
            qaReviewLoading={qaReviewLoading}
            gitReviews={gitReviews}
            onRunReview={runQaReview}
            onApprove={handleQaApprove}
            onRework={handleQaRework}
            fmtTime={fmtTime as any}
            theme={theme}
          />
        )}
      </div>

      {/* ── Commit Bar (fixed bottom) ── */}
      <GitCommitBar
        commitMsg={gitCommitMsg}
        onCommitMsgChange={setGitCommitMsg}
        selectedCount={selectedPathCount}
        stagedFiles={gitStatus?.staged || []}
        allFiles={gitStatus?.all || []}
        onCommitSelected={handleCommitSelected}
        onCommitAll={handleCommitAll}
        onAiGenerateMsg={handleAiGenerateMsg}
        aiLoading={aiCommitLoading}
        actionMsg={gitActionMsg}
        onClearActionMsg={() => setGitActionMsg(null)}
        theme={theme}
      />
    </div>
  );
}
