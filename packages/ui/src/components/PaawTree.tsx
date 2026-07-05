/**
 * PaawTree — .paaw/ project knowledge directory tree
 *
 * Shows in Coding IDE sidebar, below the file explorer.
 * Displays .paaw/ files with icons and allows clicking to open.
 */
import React, { useEffect, useState, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

// ── Types ──

interface PaawNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  children?: PaawNode[];
}

interface PaawTreeProps {
  projectRoot: string;
  onOpenFile: (path: string, name: string) => void;
  refreshKey?: number;
}

// ── File icons ──

function paawFileIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "project.md") return "📋";
  if (lower === "architecture.md") return "🏗️";
  if (lower === "decisions.md") return "🧠";
  if (lower === "changelog.md") return "📝";
  if (lower === "coding-standards.md") return "📏";
  if (lower === "context.md") return "🔍";
  if (lower.endsWith(".md")) return "📄";
  if (lower.endsWith(".json")) return "🔧";
  return "📄";
}

const BASE_INDENT = 8;
const DEPTH_STEP = 14;

// ── Tree Node (recursive) ──

function TreeItem({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
}: {
  node: PaawNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string, name: string) => void;
}) {
  const indent = BASE_INDENT + depth * DEPTH_STEP;
  const isExpanded = expanded.has(node.path);

  if (node.type === "dir") {
    return (
      <div>
        <div
          className="flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-stone-100 rounded text-xs select-none"
          style={{ paddingLeft: indent }}
          onClick={() => onToggle(node.path)}
        >
          <span className="text-[10px] text-stone-400">{isExpanded ? "▼" : "▶"}</span>
          <span className="text-xs">{isExpanded ? "📂" : "📁"}</span>
          <span className="truncate text-stone-700">{node.name}</span>
          {node.children && (
            <span className="text-[10px] text-stone-300 ml-auto">{node.children.length}</span>
          )}
        </div>
        {isExpanded && node.children?.map(child => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-blue-50 rounded text-xs select-none group"
      style={{ paddingLeft: indent + 14 }}
      onClick={() => onOpenFile(node.path, node.name)}
      title={node.path}
    >
      <span className="text-xs">{paawFileIcon(node.name)}</span>
      <span className="truncate text-stone-700">{node.name}</span>
      {node.size != null && node.size > 0 && (
        <span className="text-[9px] text-stone-300 ml-auto group-hover:hidden">
          {node.size > 1024 ? `${Math.round(node.size / 1024)}K` : `${node.size}B`}
        </span>
      )}
    </div>
  );
}

// ── Main Component ──

export default function PaawTree({ projectRoot, onOpenFile, refreshKey = 0 }: PaawTreeProps) {
  const { t } = useI18n();
  const [tree, setTree] = useState<PaawNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState<boolean | null>(null);

  // Check if .paaw/ exists and load tree
  const loadTree = useCallback(async () => {
    if (!projectRoot) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/tree?path=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        const data = await res.json();
        setTree(data);
        setInitialized(true);
        // Auto-expand top-level
        setExpanded(new Set([data.path]));
      } else if (res.status === 404) {
        setInitialized(false);
        setTree(null);
      }
    } catch {
      setInitialized(null);
    } finally {
      setLoading(false);
    }
  }, [projectRoot]);

  useEffect(() => {
    loadTree();
  }, [loadTree, refreshKey]);

  // Auto-expand .paaw root and sessions/standards dirs
  useEffect(() => {
    if (tree && expanded.size === 1) {
      const toExpand = new Set([tree.path]);
      const findDirs = (node: PaawNode) => {
        if (node.type === "dir" && ["sessions", "standards", "prompts", "api-logs"].includes(node.name)) {
          toExpand.add(node.path);
        }
        node.children?.forEach(findDirs);
      };
      if (tree.children) tree.children.forEach(findDirs);
      setExpanded(toExpand);
    }
  }, [tree]);

  const handleToggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleInit = async () => {
    if (!projectRoot) return;
    try {
      await fetch(`${API_BASE}/api/coding-project/init?path=${encodeURIComponent(projectRoot)}`, { method: "POST" });
      await loadTree();
    } catch (err) {
      console.error("[PaawTree] init failed:", err);
    }
  };

  const handleGenerate = async () => {
    if (!projectRoot) return;
    try {
      await fetch(`${API_BASE}/api/coding-project/generate-overview?path=${encodeURIComponent(projectRoot)}`, { method: "POST" });
      await loadTree();
    } catch (err) {
      console.error("[PaawTree] generate failed:", err);
    }
  };

  // ── Not initialized state ──
  if (initialized === false) {
    return (
      <div className="flex flex-col gap-2 px-3 py-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-500">
          <span>🤖</span>
          <span>.paaw/</span>
        </div>
        <p className="text-[11px] text-stone-400 leading-relaxed">
          Initialize AI project knowledge to let AI remember context, decisions, and coding standards.
        </p>
        <button
          onClick={handleInit}
          className="text-xs px-2 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 font-semibold transition-colors"
        >
          ⚡ Initialize .paaw/
        </button>
      </div>
    );
  }

  // ── Loading state ──
  if (loading && !tree) {
    return (
      <div className="px-3 py-2 text-xs text-stone-400 animate-pulse">Loading .paaw/...</div>
    );
  }

  // ── Empty/error state ──
  if (!tree) {
    return null;
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 select-none"
        style={{ borderTop: "1px solid #e5e5e5", backgroundColor: "#fafafa" }}
      >
        <span className="text-[10px]">🤖</span>
        <span className="text-[11px] font-semibold text-stone-500">Project Knowledge</span>
        <button
          onClick={handleGenerate}
          className="ml-auto text-[10px] text-blue-500 hover:text-blue-700 font-medium opacity-60 hover:opacity-100"
          title="Auto-generate PROJECT.md from codebase"
        >
          ✨
        </button>
        <button
          onClick={loadTree}
          className="text-[10px] text-stone-400 hover:text-stone-600 opacity-60 hover:opacity-100"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* Tree */}
      <div className="py-1">
        {tree.children && tree.children.length > 0 ? (
          tree.children.map(child => (
            <TreeItem
              key={child.path}
              node={child}
              depth={0}
              expanded={expanded}
              onToggle={handleToggle}
              onOpenFile={onOpenFile}
            />
          ))
        ) : (
          <div className="px-3 py-2 text-[11px] text-stone-400">No files yet</div>
        )}
      </div>
    </div>
  );
}
