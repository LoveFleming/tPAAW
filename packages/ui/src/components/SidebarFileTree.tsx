import React, { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "../utils";
import { useTheme } from "../theme";
import { FileIcon } from "./Icon";
import { useI18n } from "../i18n";
import API_BASE from "../api";
import FileImportPicker from "./FileImportPicker";
import MoveFolderPicker from "./MoveFolderPicker";

// ── Types ──
interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
  lazy?: boolean;
}

// ── Inline rename input ──
function RenameInput({ defaultValue, onConfirm, onCancel }: {
  defaultValue: string; onConfirm: (name: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => { if (value.trim() && value.trim() !== defaultValue) onConfirm(value.trim()); else onCancel(); }}
      className="w-full px-1 py-0 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white"
      onClick={e => e.stopPropagation()}
    />
  );
}

// ── New item input (appears inline) ──
function NewItemInput({ parentPath, depth, type, onConfirm, onCancel }: {
  parentPath: string; depth: number; type: "file" | "folder";
  onConfirm: (path: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const ext = type === "file" ? ".md" : "";
  const handleConfirm = () => {
    const name = value.trim();
    if (!name) { onCancel(); return; }
    const fullName = name.endsWith(ext) ? name : name + ext;
    onConfirm(`${parentPath}/${fullName}`);
  };

  const indent = BASE_INDENT + depth * DEPTH_STEP;

  return (
    <div className="flex items-center gap-1 py-[2px]" style={{ paddingLeft: `${indent}px` }}>
      <span className="flex items-center shrink-0" style={{ width: `${DEPTH_STEP}px`, justifyContent: "center" }}>
        {type === "folder" ? <FileIcon ext="" size={13} /> : <FileIcon ext="md" size={13} />}
      </span>
      <input
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") handleConfirm(); if (e.key === "Escape") onCancel(); }}
        onBlur={() => { if (value.trim()) handleConfirm(); else onCancel(); }}
        placeholder={type === "folder" ? "資料夾名稱" : "檔案名稱"}
        className="flex-1 px-1 py-0 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white mr-4"
      />
    </div>
  );
}

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

function ContextMenu({ menu, onAction, onClose }: {
  menu: CtxMenuState;
  onAction: (action: string, menu: CtxMenuState) => void;
  onClose: () => void;
}) {
  const { info: t } = useTheme();
  const { t: ti18n } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

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

  // Measure menu height after render and flip up if it would overflow viewport
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const menuH = rect.height;
    let x = menu.x;
    let y = menu.y;
    // Flip up if menu would overflow bottom edge
    if (y + menuH > window.innerHeight - 8) {
      y = Math.max(8, y - menuH);
    }
    // Clamp horizontal if menu would overflow right edge
    if (x + rect.width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    setPos({ x, y });
  }, []);

  const itemStyle: React.CSSProperties = {
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
    color: "#374151",
    whiteSpace: "nowrap",
    transition: "background 0.1s",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  };

  // Workspace root: only show 移除目錄
  if (menu.isWsRoot) {
    return (
      <div
        ref={ref}
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
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
        <div
          style={{ ...itemStyle, color: "#ef4444" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          onClick={() => { onAction("removeWorkspace", menu); onClose(); }}
        >
          🗑️ 移除目錄
        </div>
      </div>
    );
  }

  // Non-root: same items as KnowledgeTree
  const items: { label: string; icon: string; action: string; danger?: boolean }[] = [];
  items.push({ label: ti18n("knowledge.newFolder", "新增資料夾"), icon: "📁", action: "newFolder" });
  items.push({ label: ti18n("knowledge.newFile", "新增檔案"), icon: "📄", action: "newFile" });
  items.push({ label: "匯入檔案", icon: "📥", action: "importFile" });
  items.push({ label: "移動到...", icon: "📦", action: "move" });
  if (menu.isDir) {
    items.push({ label: "開啟簡報", icon: "🎤", action: "briefingPlayer" });
  }
  items.push({ label: "編輯檔案", icon: "✏️", action: "edit" });
  items.push({ label: ti18n("knowledge.rename", "重新命名"), icon: "✏️", action: "rename" });
  items.push({ label: ti18n("knowledge.copy", "複製"), icon: "📋", action: "duplicate" });
  items.push({ label: "複製路徑", icon: "📎", action: "copyPath" });
  items.push({ label: "AI 摘要", icon: "🤖", action: "aiSummary" });
  items.push({ label: ti18n("knowledge.delete", "刪除"), icon: "🗑️", action: "delete", danger: true });

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
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
      {items.map(item => (
        <div
          key={item.action}
          style={item.danger ? { ...itemStyle, color: "#ef4444" } : itemStyle}
          onMouseEnter={e => (e.currentTarget.style.background = item.danger ? "#fef2f2" : "#f3f4f6")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          onClick={() => { onAction(item.action, menu); onClose(); }}
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

let globalCtxMenuSetter: ((m: CtxMenuState | null) => void) | null = null;
function closeGlobalCtxMenu() { globalCtxMenuSetter?.(null); }

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

// VS Code style indent: compact steps + indent guide lines
// BASE_INDENT matches NavItem paddingLeft (28px) so tree items align with sidebar nav items
const BASE_INDENT = 28;
const DEPTH_STEP = 10;
const GUIDE_COLOR = "#e5e5e5";
const MAX_INDENT_DEPTH = 30;

const TreeNodeView = React.memo(function TreeNodeView({
  node, depth, activeFilePath, openFilePaths, onSelectFile, onToggleDir, expandedPaths, projectRoot,
  isWorkspaceRoot, onCtx, renamingNode, onRename,
}: {
  node: TreeNode; depth: number; activeFilePath: string | null; openFilePaths: Set<string>;
  onSelectFile: (path: string) => void; onToggleDir: (path: string) => void; expandedPaths: Set<string>;
  projectRoot: string;
  isWorkspaceRoot?: boolean;
  onCtx: (e: React.MouseEvent, fullPath: string, relativePath: string, isDir: boolean, name: string, isWsRoot?: boolean) => void;
  renamingNode: string | null;
  onRename: (oldPath: string, newName: string) => void;
}) {
  const { info: t } = useTheme();
  const isDir = node.type === "dir";
  const isExpanded = expandedPaths.has(node.path);
  const isActive = !isDir && activeFilePath === node.path;
  const isOpen = !isDir && openFilePaths.has(node.path);
  const isRenaming = renamingNode === node.path;

  const effectiveDepth = Math.min(depth, MAX_INDENT_DEPTH);

  // Indent guide lines (VS Code style)
  const guides = Array.from({ length: effectiveDepth }, (_, i) => (
    <span key={i} className="shrink-0" style={{
      width: `${DEPTH_STEP}px`,
      borderLeft: `1px solid ${GUIDE_COLOR}`,
      alignSelf: "stretch",
      marginLeft: i === 0 ? `${BASE_INDENT}px` : 0,
    }} />
  ));

  const handleCtx = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isWorkspaceRoot) {
      onCtx(e, node.path, "", true, node.name, true);
      return;
    }
    const relPath = relativePath(node.path, projectRoot);
    onCtx(e, node.path, relPath, node.type === "dir", node.name);
  }, [node.path, node.name, projectRoot, isWorkspaceRoot, onCtx]);

  const showDepthHint = depth > MAX_INDENT_DEPTH;

  return (
    <div>
      <button
        onClick={() => isDir ? onToggleDir(node.path) : onSelectFile(node.path)}
        onContextMenu={handleCtx}
        className={cn("flex w-full items-center pr-2 text-left text-[13px] leading-tight transition-colors")}
        style={{
          height: "22px",
          borderLeft: isActive ? `2px solid ${t.accent}` : "2px solid transparent",
          backgroundColor: isActive ? t.accentBg : undefined,
          color: isActive ? t.accent : isOpen ? t.accent + "aa" : "#78716c",
          fontWeight: isActive ? 600 : 400,
        }}
        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.backgroundColor = t.accentBg; e.currentTarget.style.color = t.accent; } }}
        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = isOpen ? t.accent + "aa" : "#78716c"; } }}
      >
        {guides}
        <span className="flex items-center shrink-0" style={{ width: `${DEPTH_STEP}px`, justifyContent: "center" }}>
          {isDir ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
              className={cn("w-3 h-3 transition-transform duration-150", isExpanded ? "" : "-rotate-90")}
              style={{ color: t.accent }}
            >
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          ) : (
            fileIconElement(node.name)
          )}
        </span>
        {showDepthHint && (
          <span style={{ color: t.accent + "40", fontSize: 10, letterSpacing: -1 }}>··</span>
        )}
        {isRenaming ? (
          <RenameInput
            defaultValue={node.name}
            onConfirm={(newName) => onRename(node.path, newName)}
            onCancel={() => onRename(node.path, node.name)}
          />
        ) : (
          <span className="truncate ml-0.5">{node.name}</span>
        )}
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
              onCtx={onCtx}
              renamingNode={renamingNode}
              onRename={onRename}
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
  onEditFile?: (path: string) => void;
  onOpenInBriefingPlayer?: (dir: string) => void;
  onAiSummary?: (path: string, name: string, isDir: boolean) => void;
}

export default function SidebarFileTree({ projectRoot, activeFilePath, openFilePaths, onSelectFile, startDepth = 0, onRemoveWorkspace, onEditFile, onOpenInBriefingPlayer, onAiSummary }: Props) {
  const { info: t } = useTheme();
  const { t: ti18n } = useI18n();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CtxMenuState | null>(null);
  const [renamingNode, setRenamingNode] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<{ parentPath: string; depth: number; type: "file" | "folder" } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<"import" | "move">("import");
  const [importTargetDir, setImportTargetDir] = useState<string>("");
  const [moveTarget, setMoveTarget] = useState<{ node: TreeNode } | null>(null);
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
    const merged: TreeNode = { ...fresh };
    if (existing.children && fresh.children) {
      merged.children = fresh.children.map(fc => {
        const ec = existing.children!.find(c => c.path === fc.path);
        if (ec && ec.type === "dir" && ec.children && !ec.lazy) {
          return mergeTree(ec, fc);
        }
        return fc;
      });
    } else if (existing.children && !existing.lazy) {
      merged.children = existing.children;
      merged.lazy = false;
    }
    return merged;
  }, []);

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

  // ── Context menu handler for tree nodes ──
  const handleCtx = useCallback((e: React.MouseEvent, fullPath: string, relPath: string, isDir: boolean, name: string, isWsRoot?: boolean) => {
    closeGlobalCtxMenu();
    globalCtxMenuSetter?.({ x: e.clientX, y: e.clientY, fullPath, relativePath: relPath, isDir, name, isWsRoot });
  }, []);

  // ── Context menu actions ──
  const handleAction = useCallback(async (action: string, menu: CtxMenuState) => {
    const { fullPath, name, isDir } = menu;
    const parentPath = fullPath.includes("/") ? fullPath.substring(0, fullPath.lastIndexOf("/")) : projectRoot;

    switch (action) {
      case "removeWorkspace": {
        onRemoveWorkspace?.(menu.fullPath);
        break;
      }
      case "newFolder": {
        const folderTarget = isDir ? fullPath : parentPath;
        setExpandedPaths(prev => new Set([...prev, folderTarget]));
        // Calculate depth for indentation
        const depth = folderTarget === projectRoot ? 1 : 2;
        setNewItem({ parentPath: folderTarget, depth, type: "folder" });
        break;
      }
      case "newFile": {
        const fileTarget = isDir ? fullPath : parentPath;
        setExpandedPaths(prev => new Set([...prev, fileTarget]));
        const depth = fileTarget === projectRoot ? 1 : 2;
        setNewItem({ parentPath: fileTarget, depth, type: "file" });
        break;
      }
      case "importFile": {
        const importDir = isDir ? fullPath : parentPath;
        setImportTargetDir(importDir);
        setPickerMode("import");
        setShowPicker(true);
        break;
      }
      case "move": {
        setMoveTarget({ node: { name, path: fullPath, type: isDir ? "dir" : "file" } });
        setPickerMode("move");
        setShowPicker(true);
        break;
      }
      case "briefingPlayer": {
        if (isDir) {
          onOpenInBriefingPlayer?.(fullPath);
        }
        break;
      }
      case "rename": {
        setRenamingNode(fullPath);
        break;
      }
      case "edit": {
        onEditFile?.(fullPath);
        break;
      }
      case "copyPath": {
        try { await navigator.clipboard.writeText(fullPath); } catch {}
        break;
      }
      case "aiSummary": {
        onAiSummary?.(fullPath, name, isDir);
        break;
      }
      case "duplicate": {
        try {
          const ext = name.includes(".") ? "." + name.split(".").pop() : "";
          const baseName = name.replace(ext, "");
          const destPath = `${parentPath}/${baseName}-copy${ext}`;
          await fetch(`${API_BASE}/api/fs/copy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ srcPath: fullPath, destPath }),
          });
          refreshTree();
        } catch {}
        break;
      }
      case "delete": {
        setConfirmDelete(menu);
        break;
      }
    }
  }, [projectRoot, onRemoveWorkspace, onEditFile, onOpenInBriefingPlayer, onAiSummary, refreshTree]);

  // ── Rename handler ──
  const handleRename = useCallback(async (oldPath: string, newName: string) => {
    setRenamingNode(null);
    const oldName = oldPath.split("/").pop() || "";
    if (newName === oldName) return;
    const parent = oldPath.substring(0, oldPath.lastIndexOf("/"));
    const newPath = `${parent}/${newName}`;
    try {
      await fetch(`${API_BASE}/api/fs/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath, newPath }),
      });
      refreshTree();
    } catch {}
  }, [refreshTree]);

  // ── Create new file/folder ──
  const handleCreate = useCallback(async (fullPath: string) => {
    const name = fullPath.split("/").pop() || "";
    const isFile = name.includes(".");
    try {
      if (isFile) {
        await fetch(`${API_BASE}/api/fs/create-file`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: fullPath, content: `# ${name.replace(/\.[^.]+$/, "")}\n\n` }),
        });
      } else {
        await fetch(`${API_BASE}/api/fs/mkdir`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: fullPath }),
        });
      }
      refreshTree();
    } catch {}
    setNewItem(null);
  }, [refreshTree]);

  // ── Import file handler ──
  const handleImport = useCallback(async (srcPath: string) => {
    const targetDir = importTargetDir || projectRoot;
    const name = srcPath.split("/").pop() || "imported-file";
    const destPath = `${targetDir}/${name}`;
    try {
      const resp = await fetch(`${API_BASE}/api/fs/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ srcPath, destPath }),
      });
      if (resp.ok) {
        refreshTree();
      } else {
        const err = await resp.json().catch(() => ({}));
        alert(`匯入失敗: ${err.error || resp.statusText}`);
      }
    } catch (e) {
      alert(`匯入失敗: ${e}`);
    }
  }, [importTargetDir, projectRoot, refreshTree]);

  // ── Move handler ──
  const handleMove = useCallback(async (destDir: string) => {
    if (!moveTarget) return;
    const { node } = moveTarget;
    const destPath = `${destDir}/${node.name}`;
    if (node.path === destPath) {
      setMoveTarget(null);
      return;
    }
    try {
      const resp = await fetch(`${API_BASE}/api/fs/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath: node.path, newPath: destPath }),
      });
      if (resp.ok) {
        refreshTree();
      } else {
        const err = await resp.json().catch(() => ({}));
        alert(`移動失敗: ${err.error || resp.statusText}`);
      }
    } catch (e) {
      alert(`移動失敗: ${e}`);
    }
    setMoveTarget(null);
  }, [moveTarget, refreshTree]);

  // ── Existing names for duplicate check ──
  const [existingNames, setExistingNames] = useState<string[]>([]);
  useEffect(() => {
    if (!tree?.children) { setExistingNames([]); return; }
    setExistingNames(tree.children.map(c => c.name));
  }, [tree]);

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
        onCtx={handleCtx}
        renamingNode={renamingNode}
        onRename={handleRename}
      />

      {/* New item inline input */}
      {newItem && (
        <NewItemInput
          parentPath={newItem.parentPath}
          depth={newItem.depth}
          type={newItem.type}
          onConfirm={handleCreate}
          onCancel={() => setNewItem(null)}
        />
      )}

      {/* File Import Picker */}
      <FileImportPicker
        open={showPicker && pickerMode === "import"}
        onClose={() => { setShowPicker(false); setImportTargetDir(""); }}
        onPick={handleImport}
        existingNames={existingNames}
        title={importTargetDir ? `匯入檔案到 ${importTargetDir.split("/").pop()}` : "匯入檔案"}
      />

      {/* Move Picker */}
      {moveTarget && (
        <MoveFolderPicker
          open={showPicker && pickerMode === "move"}
          onClose={() => { setShowPicker(false); setMoveTarget(null); }}
          onPick={handleMove}
          rootPath={projectRoot}
          itemName={moveTarget.node.name}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          onAction={handleAction}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Delete confirmation */}
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
              <span style={{ fontFamily: "monospace", fontSize: 12 }}>{confirmDelete.relativePath || confirmDelete.name}</span>
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
