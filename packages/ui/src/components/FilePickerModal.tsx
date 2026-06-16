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

interface FilePickerModalProps {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
  title?: string;
}

export default function FilePickerModal({ open, onClose, onPick, title = "選擇檔案" }: FilePickerModalProps) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [activeWs, setActiveWs] = useState<string>("");
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  // Load tree when workspace changes
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

  // Lazy load directory
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

  const handleConfirm = () => {
    if (selectedFile) {
      onPick(selectedFile);
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-stone-200 overflow-hidden flex flex-col" style={{ maxHeight: "80vh" }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-stone-50 shrink-0">
          <h3 className="text-sm font-bold text-stone-700">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-rose-400 text-lg leading-none">&times;</button>
        </div>

        {/* Workspace selector */}
        {workspaces.length > 1 && (
          <div className="px-4 py-2 border-b border-stone-100 shrink-0">
            <div className="flex flex-wrap gap-1">
              {workspaces.map(ws => (
                <button key={ws}
                  onClick={() => { setActiveWs(ws); setSelectedFile(null); }}
                  className={`px-2 py-1 text-[10px] rounded-md font-medium transition-colors ${
                    activeWs === ws ? "bg-stone-700 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                  }`}>
                  {ws.split("/").pop()}
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
              selectedFile={selectedFile}
              onSelect={setSelectedFile}
            />
          )}
          {!loading && (!tree?.children || tree.children.length === 0) && (
            <div className="text-xs text-stone-400 text-center py-8">此工作區沒有檔案</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50 shrink-0">
          <span className="text-[10px] text-stone-400 truncate max-w-[60%]">
            {selectedFile ? selectedFile.split("/").pop() : "未選擇"}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-100">
              取消
            </button>
            <button onClick={handleConfirm}
              disabled={!selectedFile}
              className="px-4 py-1.5 text-xs font-bold text-white rounded-lg bg-stone-700 hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed">
              匯入
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recursive tree rendering ──
function PickerTree({ nodes, depth, expandedPaths, onToggle, selectedFile, onSelect }: {
  nodes: TreeNode[]; depth: number; expandedPaths: Set<string>;
  onToggle: (path: string) => void; selectedFile: string | null; onSelect: (path: string) => void;
}) {
  return (
    <>
      {nodes.map(node => {
        const isDir = node.type === "dir";
        const isExpanded = expandedPaths.has(node.path);
        const isSelected = selectedFile === node.path;
        const indent = 8 + depth * 14;

        return (
          <div key={node.path}>
            <button
              onClick={() => {
                if (isDir) onToggle(node.path);
                else onSelect(node.path);
              }}
              className={`flex w-full items-center gap-1.5 pr-2 py-1 text-xs text-left transition-colors ${
                isSelected ? "bg-blue-50 text-blue-700 font-medium" : "text-stone-600 hover:bg-stone-50"
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
                selectedFile={selectedFile}
                onSelect={onSelect}
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
