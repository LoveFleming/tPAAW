import React, { useEffect, useState, useCallback } from "react";
import { cn } from "../utils";

interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
  lazy?: boolean;
}

const API_BASE = "http://127.0.0.1:4097";

async function fetchTree(root: string): Promise<TreeNode> {
  const resp = await fetch(`${API_BASE}/api/fs/tree?root=${encodeURIComponent(root)}`);
  if (!resp.ok) throw new Error("Failed to load tree");
  return resp.json();
}

async function fetchLazyChildren(root: string, subpath: string): Promise<TreeNode> {
  const resp = await fetch(`${API_BASE}/api/fs/tree-deep?root=${encodeURIComponent(root)}&subpath=${encodeURIComponent(subpath)}`);
  if (!resp.ok) throw new Error("Failed to load children");
  return resp.json();
}

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "📘", tsx: "📘", js: "📙", jsx: "📙", mjs: "📙",
    json: "📋", md: "📝", css: "🎨", html: "🌐",
    py: "🐍", java: "☕", go: "🐹", rs: "🦀",
    yaml: "⚙️", yml: "⚙️", toml: "⚙️", env: "🔐",
    sh: "📜", bash: "📜", zsh: "📜",
    png: "🖼️", jpg: "🖼️", svg: "🖼️", gif: "🖼️",
    txt: "📄", lock: "🔒",
  };
  return map[ext] || "📄";
}

// ── Tree Node ──
function TreeNodeView({
  node,
  root,
  depth,
  selectedPath,
  onSelectFile,
  onToggleDir,
  expanded,
}: {
  node: TreeNode;
  root: string;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  expanded: Set<string>;
}) {
  const isDir = node.type === "dir";
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <button
        onClick={() => isDir ? onToggleDir(node.path) : onSelectFile(node.path)}
        className={cn(
          "w-full flex items-center gap-1.5 py-[3px] text-[11px] hover:bg-orange-50 transition-colors text-left rounded-sm",
          isSelected ? "bg-orange-100 text-orange-700 font-medium" : "text-stone-600"
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        title={node.path}
      >
        {isDir ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
            className={cn("w-3 h-3 text-amber-500 shrink-0 transition-transform", isExpanded ? "" : "-rotate-90")}>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        ) : (
          <span className="w-3 shrink-0 text-center text-[9px] leading-none">{fileIcon(node.name)}</span>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              root={root}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              expanded={expanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sidebar File Tree ──
interface Props {
  projectRoot: string;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

export default function SidebarFileTree({ projectRoot, selectedFile, onSelectFile }: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTree(projectRoot)
      .then((data) => {
        if (!cancelled) {
          setTree(data);
          setExpanded(new Set([projectRoot]));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectRoot]);

  const handleToggleDir = useCallback(async (dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });

    // Lazy load
    if (tree) {
      const findNode = (nodes: TreeNode, target: string): TreeNode | null => {
        if (nodes.path === target) return nodes;
        if (nodes.children) {
          for (const c of nodes.children) {
            const found = findNode(c, target);
            if (found) return found;
          }
        }
        return null;
      };
      const node = findNode(tree, dirPath);
      if (node && node.lazy && !node.children) {
        try {
          const subpath = dirPath.slice(projectRoot.length);
          const loaded = await fetchLazyChildren(projectRoot, subpath);
          setTree((prev) => {
            if (!prev) return prev;
            const clone = JSON.parse(JSON.stringify(prev));
            const target = findNode(clone, dirPath);
            if (target) { target.children = loaded.children; target.lazy = false; }
            return clone;
          });
        } catch { /* ignore */ }
      }
    }
  }, [tree, projectRoot]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 text-stone-400 text-xs">
        <svg className="animate-spin h-3 w-3 mr-1.5" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading...
      </div>
    );
  }

  if (!tree) return null;

  return (
    <div className="overflow-y-auto flex-1 py-1" style={{ scrollbarWidth: "thin" }}>
      <TreeNodeView
        node={tree}
        root={projectRoot}
        depth={0}
        selectedPath={selectedFile}
        onSelectFile={onSelectFile}
        onToggleDir={handleToggleDir}
        expanded={expanded}
      />
    </div>
  );
}
