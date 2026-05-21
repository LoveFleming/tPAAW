import React, { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "../utils";
import { useTheme } from "../theme";
import { FileIcon } from "./Icon";

// ── Context Menu ──
interface CtxMenuState {
  x: number;
  y: number;
  fullPath: string;
  relativePath: string;
}

function ContextMenu({ menu, onClose }: { menu: CtxMenuState; onClose: () => void }) {
  const { info: t } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* fallback */ }
    onClose();
  };

  const itemStyle: React.CSSProperties = {
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
    color: t.text,
    whiteSpace: "nowrap",
    transition: "background 0.1s",
  };

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: menu.x,
        top: menu.y,
        zIndex: 9999,
        background: t.cardBg,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        padding: "4px 0",
        minWidth: 180,
        overflow: "hidden",
      }}
    >
      <div
        style={itemStyle}
        onMouseEnter={e => (e.currentTarget.style.background = t.accentBg)}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        onClick={() => copy(menu.fullPath)}
      >
        📋 Copy Path
      </div>
      <div
        style={itemStyle}
        onMouseEnter={e => (e.currentTarget.style.background = t.accentBg)}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        onClick={() => copy(menu.relativePath)}
      >
        📄 Copy Relative Path
      </div>
    </div>
  );
}

let globalCtxMenuSetter: ((m: CtxMenuState | null) => void) | null = null;
function closeGlobalCtxMenu() { globalCtxMenuSetter?.(null); }

interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
  lazy?: boolean;
}

const API_BASE = "http://127.0.0.1:4097";

function fileIconElement(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return <FileIcon ext={ext} size={14} />;
}

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root;
  for (const c of root.children ?? []) {
    const found = findNode(c, path);
    if (found) return found;
  }
  return null;
}

const BASE_INDENT = 26;
const DEPTH_STEP = 14;

const TreeNodeView = React.memo(function TreeNodeView({
  node, depth, activeFilePath, openFilePaths, onSelectFile, onToggleDir, expandedPaths, projectRoot,
}: {
  node: TreeNode; depth: number; activeFilePath: string | null; openFilePaths: Set<string>;
  onSelectFile: (path: string) => void; onToggleDir: (path: string) => void; expandedPaths: Set<string>;
  projectRoot: string;
}) {
  const { info: t } = useTheme();
  const isDir = node.type === "dir";
  const isExpanded = expandedPaths.has(node.path);
  const isActive = !isDir && activeFilePath === node.path;
  const isOpen = !isDir && openFilePaths.has(node.path);

  const handleCtx = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const relPath = node.path.startsWith(projectRoot + "/") ? node.path.slice(projectRoot.length + 1) : node.path.startsWith(projectRoot) ? node.path.slice(projectRoot.length) : node.path;
    closeGlobalCtxMenu();
    globalCtxMenuSetter?.({ x: e.clientX, y: e.clientY, fullPath: node.path, relativePath: relPath });
  }, [node.path, projectRoot]);

  return (
    <div>
      <button
        onClick={() => isDir ? onToggleDir(node.path) : onSelectFile(node.path)}
        onContextMenu={handleCtx}
        className={cn("flex w-full items-center justify-between pr-4 py-1.5 text-left text-sm transition-colors")}
        style={{
          paddingLeft: `${BASE_INDENT + depth * DEPTH_STEP}px`,
          borderLeft: isActive ? `3px solid ${t.accent}` : "3px solid transparent",
          backgroundColor: isActive ? t.accentBg : undefined,
          color: isActive ? t.accent : isOpen ? t.accent + "aa" : "#78716c",
          fontWeight: isActive ? 600 : 400,
        }}
        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.backgroundColor = t.accentBg; e.currentTarget.style.color = t.accent; } }}
        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = isOpen ? t.accent + "aa" : "#78716c"; } }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {isDir ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
              className={cn("w-3.5 h-3.5 shrink-0 transition-transform duration-150", isExpanded ? "" : "-rotate-90")}
              style={{ color: t.accent }}
            >
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          ) : (
            <span className="shrink-0">{fileIconElement(node.name)}</span>
          )}
          <span className="truncate">{node.name}</span>
        </div>
      </button>
      {isDir && isExpanded && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              openFilePaths={openFilePaths}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              expandedPaths={expandedPaths}
              projectRoot={projectRoot}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// ── Sidebar File Tree ──
interface Props {
  projectRoot: string;
  activeFilePath: string | null;
  openFilePaths: Set<string>;
  onSelectFile: (path: string) => void;
}

export default function SidebarFileTree({ projectRoot, activeFilePath, openFilePaths, onSelectFile }: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const treeRef = useRef<TreeNode | null>(null);
  treeRef.current = tree;

  // register global setter so tree nodes can open context menu
  useEffect(() => {
    globalCtxMenuSetter = setCtxMenu;
    return () => { globalCtxMenuSetter = null; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/fs/tree?root=${encodeURIComponent(projectRoot)}`)
      .then(r => r.json())
      .then((data: TreeNode) => {
        if (!cancelled) {
          setTree(data);
          setExpandedPaths(new Set([projectRoot]));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectRoot]);

  const handleToggleDir = useCallback(async (dirPath: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });

    const currentTree = treeRef.current;
    if (!currentTree) return;
    const node = findNode(currentTree, dirPath);
    if (!node || !node.lazy || node.children) return;

    try {
      const subpath = dirPath.slice(projectRoot.length);
      const resp = await fetch(`${API_BASE}/api/fs/tree-deep?root=${encodeURIComponent(projectRoot)}&subpath=${encodeURIComponent(subpath)}`);
      const loaded: TreeNode = await resp.json();
      setTree(prev => {
        if (!prev) return prev;
        const clone: TreeNode = JSON.parse(JSON.stringify(prev));
        const target = findNode(clone, dirPath);
        if (target) {
          target.children = loaded.children;
          target.lazy = false;
        }
        return clone;
      });
    } catch { /* ignore */ }
  }, [projectRoot]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 text-stone-400 text-xs gap-1.5">
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading...
      </div>
    );
  }

  if (!tree?.children) return null;

  return (
    <div className="overflow-y-auto" style={{ scrollbarWidth: "thin", maxHeight: "calc(100vh - 300px)" }}>
      <TreeNodeView
        node={tree}
        depth={0}
        activeFilePath={activeFilePath}
        openFilePaths={openFilePaths}
        onSelectFile={onSelectFile}
        onToggleDir={handleToggleDir}
        expandedPaths={expandedPaths}
        projectRoot={projectRoot}
      />
      {ctxMenu && <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}
