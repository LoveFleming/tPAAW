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
  isDir: boolean;
  name: string;
  isWsRoot?: boolean;
}

function ContextMenu({ menu, onDelete, onClose, onRemoveWorkspace }: { menu: CtxMenuState; onDelete: (menu: CtxMenuState) => void; onClose: () => void; onRemoveWorkspace?: (dir: string) => void; }) {
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
    color: "#374151",
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
        background: "#ffffff",
        border: `1px solid #e5e7eb`,
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        padding: "4px 0",
        minWidth: 180,
        overflow: "hidden",
      }}
    >
      {menu.isWsRoot ? (
        <div
          style={{ ...itemStyle, color: "#ef4444" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          onClick={() => { onRemoveWorkspace?.(menu.fullPath); onClose(); }}
        >
          🗑️ 移除目錄
        </div>
      ) : (
        <>
          <div
            style={itemStyle}
            onMouseEnter={e => (e.currentTarget.style.background = "#f3f4f6")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            onClick={() => copy(menu.fullPath)}
          >
            📋 Copy Path
          </div>
          <div
            style={{ ...itemStyle, color: "#ef4444" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            onClick={() => { onDelete(menu); }}
          >
            🗑️ Delete{menu.isDir ? " Folder" : ""}
          </div>
        </>
      )}
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

import API_BASE from "../api";

/** Check if a path starts with a given prefix, handling both / and \ separators */
function pathStartsWith(p: string, prefix: string): boolean {
  return p.startsWith(prefix + "/") || p.startsWith(prefix + "\\") || p === prefix;
}

/** Get the relative portion after the prefix, stripping leading separator */
function relativePath(p: string, prefix: string): string {
  if (p.startsWith(prefix + "/")) return p.slice(prefix.length + 1);
  if (p.startsWith(prefix + "\\")) return p.slice(prefix.length + 1);
  if (p === prefix) return "";
  return p;
}

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

// VSCode-style indent: compact steps, capped at max depth
const BASE_INDENT = 12;
const DEPTH_STEP = 10;
const MAX_INDENT_DEPTH = 15; // Beyond this, all items share the same indent level

const TreeNodeView = React.memo(function TreeNodeView({
  node, depth, activeFilePath, openFilePaths, onSelectFile, onToggleDir, expandedPaths, projectRoot,
  isWorkspaceRoot, onRemoveWorkspace,
}: {
  node: TreeNode; depth: number; activeFilePath: string | null; openFilePaths: Set<string>;
  onSelectFile: (path: string) => void; onToggleDir: (path: string) => void; expandedPaths: Set<string>;
  projectRoot: string;
  isWorkspaceRoot?: boolean;
  onRemoveWorkspace?: (dir: string) => void;
}) {
  const { info: t } = useTheme();
  const isDir = node.type === "dir";
  const isExpanded = expandedPaths.has(node.path);
  const isActive = !isDir && activeFilePath === node.path;
  const isOpen = !isDir && openFilePaths.has(node.path);

  // Cap the visual indent depth (VSCode style)
  const effectiveDepth = Math.min(depth, MAX_INDENT_DEPTH);
  const indentPx = BASE_INDENT + effectiveDepth * DEPTH_STEP;

  const handleCtx = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isWorkspaceRoot && onRemoveWorkspace) {
      closeGlobalCtxMenu();
      globalCtxMenuSetter?.({ x: e.clientX, y: e.clientY, fullPath: node.path, relativePath: "", isDir: true, name: node.name, isWsRoot: true });
      return;
    }
    const relPath = relativePath(node.path, projectRoot);
    closeGlobalCtxMenu();
    globalCtxMenuSetter?.({ x: e.clientX, y: e.clientY, fullPath: node.path, relativePath: relPath, isDir: node.type === "dir", name: node.name });
  }, [node.path, projectRoot, isWorkspaceRoot, onRemoveWorkspace]);

  // Show depth indicator for deeply nested items (dots to indicate skipped levels)
  const showDepthHint = depth > MAX_INDENT_DEPTH;

  return (
    <div>
      <button
        onClick={() => isDir ? onToggleDir(node.path) : onSelectFile(node.path)}
        onContextMenu={handleCtx}
        className={cn("flex w-full items-center justify-between pr-4 py-1.5 text-left text-sm transition-colors")}
        style={{
          paddingLeft: `${indentPx}px`,
          borderLeft: isActive ? `3px solid ${t.accent}` : "3px solid transparent",
          backgroundColor: isActive ? t.accentBg : undefined,
          color: isActive ? t.accent : isOpen ? t.accent + "aa" : "#78716c",
          fontWeight: isActive ? 600 : 400,
        }}
        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.backgroundColor = t.accentBg; e.currentTarget.style.color = t.accent; } }}
        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = isOpen ? t.accent + "aa" : "#78716c"; } }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
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
          {showDepthHint && (
            <span style={{ color: t.accent + "40", fontSize: 10, letterSpacing: -1 }}>··</span>
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
  startDepth?: number;
  onRemoveWorkspace?: (dir: string) => void;
}

export default function SidebarFileTree({ projectRoot, activeFilePath, openFilePaths, onSelectFile, startDepth = 0, onRemoveWorkspace }: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CtxMenuState | null>(null);
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
          setTree(prev => mergeTree(prev, data));
          setExpandedPaths(prev => {
            const next = new Set(prev);
            next.add(projectRoot);
            return next;
          });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectRoot]);

  // ── Merge fresh server tree into existing tree, preserving lazy-loaded children ──
  const mergeTree = useCallback((existing: TreeNode | null, fresh: TreeNode): TreeNode => {
    if (!existing) return fresh;
    // Start from fresh, but preserve existing loaded children where fresh is lazy
    const merged: TreeNode = { ...fresh };
    if (existing.children && fresh.children) {
      // Both have children → merge recursively, preserving lazy-loaded subtrees
      merged.children = fresh.children.map(fc => {
        const ec = existing.children!.find(c => c.path === fc.path);
        if (ec && ec.type === "dir" && ec.children && !ec.lazy) {
          return mergeTree(ec, fc);
        }
        return fc;
      });
    } else if (existing.children && !existing.lazy) {
      // Existing has loaded children but fresh is lazy (shallow) → preserve existing children
      merged.children = existing.children;
      merged.lazy = false;
    }
    return merged;
  }, []);

  // ── Auto-refresh tree every 10 seconds ──
  const refreshTree = useCallback(() => {
    if (!projectRoot) return;
    fetch(`${API_BASE}/api/fs/tree?root=${encodeURIComponent(projectRoot)}`)
      .then(r => r.json())
      .then((data: TreeNode) => {
        setTree(prev => mergeTree(prev, data));
      })
      .catch(() => {});
  }, [projectRoot, mergeTree]);

  useEffect(() => {
    if (!projectRoot) return;
    refreshTree();
    const interval = setInterval(refreshTree, 10000);
    return () => clearInterval(interval);
  }, [projectRoot, refreshTree]);

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
    if (!node) return;
    // Skip fetch if children are already loaded (not lazy)
    if (node.children && !node.lazy) return;

    try {
      const subpath = relativePath(dirPath, projectRoot);
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
    <div
      className="overflow-y-auto"
      style={{ scrollbarWidth: "thin", maxHeight: "calc(100vh - 300px)" }}
      onContextMenu={e => e.preventDefault()}
    >
      <TreeNodeView
        node={tree}
        depth={0}
        activeFilePath={activeFilePath}
        openFilePaths={openFilePaths}
        onSelectFile={onSelectFile}
        onToggleDir={handleToggleDir}
        expandedPaths={expandedPaths}
        projectRoot={projectRoot}
        isWorkspaceRoot={true}
        onRemoveWorkspace={onRemoveWorkspace}
      />
      {ctxMenu && <ContextMenu menu={ctxMenu} onDelete={(m) => { setCtxMenu(null); setConfirmDelete(m); }} onClose={() => setCtxMenu(null)} onRemoveWorkspace={onRemoveWorkspace} />}
      {confirmDelete && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setConfirmDelete(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#ffffff", border: `1px solid #e5e7eb`,
              borderRadius: 12, padding: "24px 28px", minWidth: 340, maxWidth: 420,
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1f2937", marginBottom: 8 }}>
              ⚠️ Delete {confirmDelete.isDir ? "Folder" : "File"}?
            </div>
            <div style={{ fontSize: 13, color: "#78716c", marginBottom: 20, wordBreak: "break-all" }}>
              {confirmDelete.isDir && (
                <span style={{ color: "#ef4444", fontWeight: 500 }}>This will delete the folder and all its contents recursively. </span>
              )}
              <span style={{ fontFamily: "monospace", fontSize: 12 }}>{confirmDelete.relativePath}</span>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  padding: "8px 20px", borderRadius: 6, border: `1px solid #d1d5db`,
                  background: "transparent", color: "#374151", cursor: "pointer", fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    const resp = await fetch(`${API_BASE}/api/fs/item?path=${encodeURIComponent(confirmDelete.fullPath)}`, { method: "DELETE" });
                    if (resp.ok) {
                      // Remove from expandedPaths
                      setExpandedPaths(prev => {
                        const next = new Set(prev);
                        for (const p of next) {
                          if (p === confirmDelete.fullPath || p.startsWith(confirmDelete.fullPath + "/") || p.startsWith(confirmDelete.fullPath + "\\")) next.delete(p);
                        }
                        return next;
                      });
                      refreshTree();
                    }
                  } catch { /* ignore */ }
                  setConfirmDelete(null);
                }}
                style={{
                  padding: "8px 20px", borderRadius: 6, border: "none",
                  background: "#ef4444", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500,
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
