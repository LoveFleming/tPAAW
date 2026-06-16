import React, { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";

import API_BASE from "../api";
import FileImportPicker from "./FileImportPicker";

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

// ── Context Menu ──
interface CtxState {
  x: number; y: number;
  node: TreeNode;
  parentPath: string;
}

function CtxMenu({ menu, onAction, onClose }: {
  menu: CtxState; onAction: (action: string, menu: CtxState) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const items: { label: string; icon: string; action: string; danger?: boolean }[] = [];
  items.push({ label: t("knowledge.newFolder", "新增資料夾"), icon: "📁", action: "newFolder" });
  items.push({ label: t("knowledge.newFile", "新增檔案"), icon: "📄", action: "newFile" });
  items.push({ label: "匯入檔案", icon: "📥", action: "importFile" });
  items.push({ label: t("knowledge.rename", "重新命名"), icon: "✏️", action: "rename" });
  items.push({ label: t("knowledge.copy", "複製"), icon: "📋", action: "duplicate" });
  items.push({ label: t("knowledge.delete", "刪除"), icon: "🗑️", action: "delete", danger: true });

  return (
    <div ref={ref} className="fixed z-[9999] bg-white border border-stone-200 rounded-xl shadow-2xl py-1 min-w-[180px]"
      style={{ left: menu.x, top: menu.y }}>
      {items.map(item => (
        <button key={item.action}
          onClick={() => { onAction(item.action, menu); onClose(); }}
          className={cn("w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors",
            item.danger ? "text-rose-600 hover:bg-rose-50" : "text-stone-700 hover:bg-stone-50"
          )}
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── File icon helper ──
function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const iconMap: Record<string, string> = {
    md: "📝", txt: "📄", json: "🔧", yaml: "🔧", yml: "🔧",
    ts: "💠", tsx: "💠", js: "💠", jsx: "💠",
    css: "🎨", html: "🌐", py: "🐍",
    png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", svg: "🖼️", webp: "🖼️",
    pdf: "📕", doc: "📘", docx: "📘",
  };
  return <span className="text-xs">{iconMap[ext] || "📄"}</span>;
}

// ── Tree Node View ──
const NodeView = React.memo(function NodeView({
  node, depth, expandedPaths, onToggle, selectedPath, onSelect,
  onCtx, renamingNode, onRename, onOpenFile,
}: {
  node: TreeNode; depth: number; expandedPaths: Set<string>;
  onToggle: (path: string) => void; selectedPath: string | null;
  onSelect: (path: string) => void; onCtx: (e: React.MouseEvent, node: TreeNode) => void;
  renamingNode: string | null; onRename: (oldPath: string, newName: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const isDir = node.type === "dir";
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isRenaming = renamingNode === node.path;
  const indent = 8 + depth * 14;

  const handleRename = (newName: string) => {
    onRename(node.path, newName);
  };

  return (
    <div>
      <button
        onClick={() => {
          if (isDir) onToggle(node.path);
          else { onSelect(node.path); onOpenFile(node.path); }
        }}
        onContextMenu={e => onCtx(e, node)}
        className={cn("flex w-full items-center gap-1.5 pr-2 py-1 text-xs text-left transition-colors",
          isSelected ? "bg-stone-100 text-stone-800 font-medium" : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
        )}
        style={{ paddingLeft: indent }}
      >
        {isDir ? (
          <span className={cn("transition-transform text-[10px]", isExpanded ? "" : "-rotate-90")}>▾</span>
        ) : (
          <FileIcon name={node.name} />
        )}
        {isRenaming ? (
          <RenameInput
            defaultValue={node.name}
            onConfirm={handleRename}
            onCancel={() => onRename(node.path, node.name)} // cancel = no-op
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </button>
      {isDir && isExpanded && node.children && node.children.map(child => (
        <NodeView
          key={child.path} node={child} depth={depth + 1}
          expandedPaths={expandedPaths} onToggle={onToggle}
          selectedPath={selectedPath} onSelect={onSelect}
          onCtx={onCtx} renamingNode={renamingNode}
          onRename={onRename} onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
});

// ── New item input (appears inline) ──
function NewItemInput({ parentPath, type, onConfirm, onCancel }: {
  parentPath: string; type: "file" | "folder";
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

  return (
    <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: 22 }}>
      <span className="text-xs">{type === "folder" ? "📁" : "📄"}</span>
      <input
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") handleConfirm(); if (e.key === "Escape") onCancel(); }}
        onBlur={() => { if (value.trim()) handleConfirm(); else onCancel(); }}
        placeholder={type === "folder" ? "資料夾名稱" : "檔案名稱"}
        className="flex-1 px-1 py-0 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white"
      />
    </div>
  );
}

// ── Main KnowledgeTree Component ──
export default function KnowledgeTree({ onOpenFile }: { onOpenFile?: (path: string) => void }) {
  const { t } = useI18n();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null);
  const [renamingNode, setRenamingNode] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<{ parentPath: string; type: "file" | "folder" } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [existingNames, setExistingNames] = useState<string[]>([]);

  const [rootPath, setRootPath] = useState("");

  // Resolve knowledge root from paaw-root API
  useEffect(() => {
    fetch(`${API_BASE}/api/paaw-root`)
      .then(r => r.json())
      .then(d => { if (d.paawRoot) setRootPath(`${d.paawRoot}/data/knowledge`); })
      .catch(() => {});
  }, []);

  const ROOT = rootPath;

  // Load tree
  const refresh = useCallback(() => {
    if (!ROOT) return;
    fetch(`${API_BASE}/api/fs/tree?root=${encodeURIComponent(ROOT)}`)
      .then(r => r.json())
      .then((data: TreeNode) => {
        setTree(data);
        setExpandedPaths(prev => {
          const next = new Set(prev);
          next.add(ROOT);
          return next;
        });
      })
      .catch(() => {});
  }, [ROOT]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh
  useEffect(() => {
    const iv = setInterval(refresh, 15000);
    return () => clearInterval(iv);
  }, [refresh]);

  // Toggle directory
  const handleToggle = useCallback(async (dirPath: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath);
      return next;
    });

    // Lazy load if needed
    if (tree) {
      const findAndLoad = async (nodes: TreeNode[]): Promise<boolean> => {
        for (const n of nodes) {
          if (n.path === dirPath && n.lazy) {
            try {
              const subpath = dirPath.slice(ROOT.length + 1);
              const resp = await fetch(`${API_BASE}/api/fs/tree-deep?root=${encodeURIComponent(ROOT)}&subpath=${encodeURIComponent(subpath)}`);
              const loaded = await resp.json();
              setTree(prev => {
                if (!prev) return prev;
                const clone: TreeNode = JSON.parse(JSON.stringify(prev));
                const target = findNode(clone, dirPath);
                if (target) { target.children = loaded.children; target.lazy = false; }
                return clone;
              });
            } catch {}
            return true;
          }
          if (n.children && await findAndLoad(n.children)) return true;
        }
        return false;
      };
      if (tree.children) findAndLoad(tree.children);
    }
  }, [tree, ROOT]);

  // Context menu — always show all options (newFolder, newFile, rename, duplicate, delete)
  // For files, the parent dir is used for newFolder/newFile
  const handleCtx = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    // Use the node as-is — CtxMenu now always shows full options regardless of dir/file
    const parentPath = node.path.includes("/") ? node.path.substring(0, node.path.lastIndexOf("/")) : ROOT;
    setCtxMenu({ x: e.clientX, y: e.clientY, node, parentPath });
  }, [ROOT]);

  // Actions
  const handleAction = useCallback(async (action: string, menu: CtxState) => {
    const { node, parentPath } = menu;

    switch (action) {
      case "newFolder": {
        // For files, use parent directory; for dirs use the dir itself
        const folderTarget = node.type === "dir" ? node.path : parentPath;
        setExpandedPaths(prev => new Set([...prev, folderTarget]));
        setNewItem({ parentPath: folderTarget, type: "folder" });
        break;
      }
      case "newFile": {
        const fileTarget = node.type === "dir" ? node.path : parentPath;
        setExpandedPaths(prev => new Set([...prev, fileTarget]));
        setNewItem({ parentPath: fileTarget, type: "file" });
        break;
      }
      case "importFile": {
        setShowPicker(true);
        break;
      }
      case "rename": {
        setRenamingNode(node.path);
        break;
      }
      case "duplicate": {
        try {
          const ext = node.name.includes(".") ? "." + node.name.split(".").pop() : "";
          const baseName = node.name.replace(ext, "");
          const destPath = `${parentPath}/${baseName}-copy${ext}`;
          await fetch(`${API_BASE}/api/fs/copy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ srcPath: node.path, destPath }),
          });
          refresh();
        } catch {}
        break;
      }
      case "delete": {
        if (confirm(`${t("knowledge.confirmDelete", "確定要刪除")} ${node.name}?`)) {
          await fetch(`${API_BASE}/api/fs/item?path=${encodeURIComponent(node.path)}`, { method: "DELETE" });
          refresh();
        }
        break;
      }
    }
  }, [refresh, t]);

  // Create new file/folder
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
      refresh();
    } catch {}
    setNewItem(null);
  }, [refresh]);

  // Rename
  const handleRename = useCallback(async (oldPath: string, newName: string) => {
    setRenamingNode(null);
    const oldName = oldPath.split("/").pop() || "";
    if (newName === oldName) return;
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
    const newPath = `${parentPath}/${newName}`;
    try {
      await fetch(`${API_BASE}/api/fs/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath, newPath }),
      });
      refresh();
    } catch {}
  }, [refresh]);

  // Open file in editor
  const handleOpenFile = useCallback((path: string) => {
    onOpenFile?.(path);
  }, [onOpenFile]);

  // Root context menu handler — works on empty area too
  const handleRootCtx = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!ROOT) return;
    // Fake a root directory node so context menu works on empty space
    const rootNode: TreeNode = { name: "knowledge", path: ROOT, type: "dir", children: tree?.children ?? [] };
    setCtxMenu({ x: e.clientX, y: e.clientY, node: rootNode, parentPath: ROOT });
  }, [ROOT, tree]);

  // Collect existing names in knowledge root for duplicate check
  useEffect(() => {
    if (!tree?.children) { setExistingNames([]); return; }
    setExistingNames(tree.children.map(c => c.name));
  }, [tree]);

  // Import file from anywhere on the filesystem into knowledge (clone/copy)
  const handleImport = useCallback(async (srcPath: string) => {
    if (!ROOT) return;
    const name = srcPath.split("/").pop() || "imported-file";
    const destPath = `${ROOT}/${name}`;
    try {
      const resp = await fetch(`${API_BASE}/api/fs/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ srcPath, destPath }),
      });
      if (resp.ok) {
        refresh();
      } else {
        const err = await resp.json().catch(() => ({}));
        alert(`匯入失敗: ${err.error || resp.statusText}`);
      }
    } catch (e) {
      alert(`匯入失敗: ${e}`);
    }
  }, [ROOT, refresh]);

  return (
    <div className="flex flex-col h-full" onContextMenu={handleRootCtx}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-stone-100 shrink-0">
        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Knowledge</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowPicker(true)}
            className="text-[10px] text-stone-400 hover:text-stone-700 font-medium flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-stone-100 transition-colors"
            title="匯入任意檔案到 Knowledge"
          >
            📄 匯入檔案
          </button>
        </div>
      </div>

      {/* File Import Picker — browse entire filesystem */}
      <FileImportPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onPick={handleImport}
        existingNames={existingNames}
        title="匯入檔案到 Knowledge"
      />

      {/* Tree */}
      <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: "thin" }}>
        {tree?.children && tree.children.length > 0 && tree.children.map(child => (
          <NodeView
            key={child.path} node={child} depth={1}
            expandedPaths={expandedPaths} onToggle={handleToggle}
            selectedPath={selectedPath} onSelect={setSelectedPath}
            onCtx={handleCtx} renamingNode={renamingNode}
            onRename={handleRename} onOpenFile={handleOpenFile}
          />
        ))}
        {(!tree?.children || tree.children.length === 0) && (
          <div className="px-4 py-6 text-xs text-stone-400 text-center">
            {t("knowledge.empty", "右鍵新增檔案或資料夾")}
          </div>
        )}

        {/* New item inline input */}
        {newItem && (
          <NewItemInput
            parentPath={newItem.parentPath}
            type={newItem.type}
            onConfirm={handleCreate}
            onCancel={() => setNewItem(null)}
          />
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <CtxMenu menu={ctxMenu} onAction={handleAction} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}

// ── Helpers ──
function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root;
  for (const c of root.children ?? []) {
    const found = findNode(c, path);
    if (found) return found;
  }
  return null;
}
