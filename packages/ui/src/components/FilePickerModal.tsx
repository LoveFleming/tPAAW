import React, { useEffect, useState, useCallback } from "react";
import API_BASE from "../api";

// ── Types ──
interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
  lazy?: boolean;
}

type PickerMode = "file" | "dir";

interface FilePickerModalProps {
  open: boolean;
  mode: PickerMode;
  onClose: () => void;
  onPick: (path: string) => void;
  existingNames: string[]; // names already in target directory
  title?: string;
}

export default function FilePickerModal({ open, mode, onClose, onPick, existingNames = [], title }: FilePickerModalProps) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [activeWs, setActiveWs] = useState<string>("");
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dupAction, setDupAction] = useState<"ask" | "overwrite" | "skip">("ask");

  // Load workspaces
  useEffect(() => {
    if (!open) return;
    fetch(`${API_BASE}/api/paaw/workspaces`)
      .then(r => r.json())
      .then(d => {
        const dirs = d.directories || [];
        setWorkspaces(dirs);
        if (dirs.length > 0 && !activeWs) setActiveWs(dirs[0]);
      })
      .catch(() => {});
  }, [open]);

  // Reset selection when mode changes
  useEffect(() => { setSelectedPath(null); }, [mode]);

  // Load tree
  const loadTree = useCallback(() => {
    if (!activeWs) return;
    setLoading(true);
    fetch(`${API_BASE}/api/fs/tree?root=${encodeURIComponent(activeWs)}`)
      .then(r => r.json())
      .then((data: TreeNode) => {
        setTree(data);
        setExpandedPaths(new Set([activeWs]));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeWs]);

  useEffect(() => {
    if (open && activeWs) loadTree();
  }, [open, activeWs, loadTree]);

  // Lazy load
  const handleToggle = useCallback(async (dirPath: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath);
      return next;
    });

    if (tree) {
      const findAndLoad = async (nodes: TreeNode[]): Promise<boolean> => {
        for (const n of nodes) {
          if (n.path === dirPath && n.lazy) {
            try {
              const subpath = dirPath.slice(activeWs.length + 1);
              const resp = await fetch(`${API_BASE}/api/fs/tree-deep?root=${encodeURIComponent(activeWs)}&subpath=${encodeURIComponent(subpath)}`);
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
  }, [tree, activeWs]);

  // Selection validation
  const selectedName = selectedPath?.split(/[\\/]/).pop() || "";
  const isDuplicate = selectedName && existingNames.includes(selectedName);
  const canConfirm = selectedPath && (!isDuplicate || dupAction === "overwrite");

  const handleConfirm = () => {
    if (!selectedPath || !canConfirm) return;
    if (isDuplicate && dupAction === "skip") { onClose(); return; }
    onPick(selectedPath);
    onClose();
  };

  if (!open) return null;

  const modeLabel = mode === "dir" ? "目錄" : "檔案";
  const modeIcon = mode === "dir" ? "📁" : "📄";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-stone-200 overflow-hidden flex flex-col" style={{ maxHeight: "80vh" }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-stone-50 shrink-0">
          <h3 className="text-sm font-bold text-stone-700">{title || `匯入${modeLabel}`}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-rose-400 text-lg leading-none">&times;</button>
        </div>

        {/* Workspace selector */}
        {workspaces.length > 1 && (
          <div className="px-4 py-2 border-b border-stone-100 shrink-0">
            <div className="flex flex-wrap gap-1">
              {workspaces.map(ws => (
                <button key={ws}
                  onClick={() => { setActiveWs(ws); setSelectedPath(null); }}
                  className={`px-2 py-1 text-[10px] rounded-md font-medium transition-colors ${
                    activeWs === ws ? "bg-stone-700 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                  }`}>
                  {ws.split(/[\\/]/).pop()}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tree */}
        <div className="overflow-y-auto flex-1 p-2" style={{ minHeight: 200 }}>
          {loading && <div className="text-xs text-stone-400 text-center py-4">載入中...</div>}
          {!loading && tree?.children && tree.children.length > 0 && (
            <PickerTree
              nodes={tree.children}
              depth={0}
              expandedPaths={expandedPaths}
              onToggle={handleToggle}
              selectedPath={selectedPath}
              onSelect={(path, type) => {
                // file mode: only select files; dir mode: only select dirs
                if (mode === "file" && type === "file") setSelectedPath(path);
                if (mode === "dir" && type === "dir") setSelectedPath(path);
              }}
              mode={mode}
            />
          )}
          {!loading && (!tree?.children || tree.children.length === 0) && (
            <div className="text-xs text-stone-400 text-center py-8">此工作區沒有檔案</div>
          )}
        </div>

        {/* Duplicate warning */}
        {isDuplicate && (
          <div className="px-4 py-2 border-t border-amber-200 bg-amber-50 shrink-0">
            <div className="flex items-center gap-2 text-xs text-amber-700">
              <span>⚠️</span>
              <span><b>{selectedName}</b> 已存在於 Knowledge</span>
            </div>
            <div className="flex gap-2 mt-1.5">
              <button onClick={() => setDupAction("overwrite")}
                className={`px-2.5 py-1 text-[10px] rounded font-medium ${dupAction === "overwrite" ? "bg-rose-500 text-white" : "bg-white border border-stone-300 text-stone-600"}`}>
                覆蓋
              </button>
              <button onClick={() => setDupAction("skip")}
                className={`px-2.5 py-1 text-[10px] rounded font-medium ${dupAction === "skip" ? "bg-stone-500 text-white" : "bg-white border border-stone-300 text-stone-600"}`}>
                取消匯入
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50 shrink-0">
          <span className="text-[10px] text-stone-400 truncate max-w-[60%]">
            {selectedPath ? `${modeIcon} ${selectedName}` : `請選擇${modeLabel}`}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-100">
              取消
            </button>
            <button onClick={handleConfirm}
              disabled={!canConfirm}
              className="px-4 py-1.5 text-xs font-bold text-white rounded-lg bg-stone-700 hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed">
              匯入{modeLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recursive tree rendering ──
function PickerTree({ nodes, depth, expandedPaths, onToggle, selectedPath, onSelect, mode }: {
  nodes: TreeNode[]; depth: number; expandedPaths: Set<string>;
  onToggle: (path: string) => void; selectedPath: string | null;
  onSelect: (path: string, type: "dir" | "file") => void; mode: PickerMode;
}) {
  return (
    <>
      {nodes.map(node => {
        const isDir = node.type === "dir";
        const isExpanded = expandedPaths.has(node.path);
        const isSelected = selectedPath === node.path;
        const indent = 8 + depth * 14;

        // Dim non-selectable items (wrong type for current mode)
        const isSelectable = (mode === "file" && !isDir) || (mode === "dir" && isDir);

        return (
          <div key={node.path}>
            <button
              onClick={() => {
                if (isDir) {
                  onToggle(node.path);
                  if (mode === "dir") onSelect(node.path, "dir");
                } else {
                  if (mode === "file") onSelect(node.path, "file");
                }
              }}
              className={`flex w-full items-center gap-1.5 pr-2 py-1 text-xs text-left transition-colors ${
                isSelected ? "bg-blue-50 text-blue-700 font-medium"
                  : isSelectable ? "text-stone-600 hover:bg-stone-50"
                  : "text-stone-300"
              }`}
              style={{ paddingLeft: indent }}
            >
              {isDir ? (
                <span className={`text-[10px] transition-transform ${isExpanded ? "" : "-rotate-90"}`}>▾</span>
              ) : (
                <span className="text-[10px]">📄</span>
              )}
              <span className="truncate">{node.name}</span>
            </button>
            {isDir && isExpanded && node.children && (
              <PickerTree
                nodes={node.children}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                selectedPath={selectedPath}
                onSelect={onSelect}
                mode={mode}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root;
  for (const c of root.children ?? []) {
    const found = findNode(c, path);
    if (found) return found;
  }
  return null;
}
