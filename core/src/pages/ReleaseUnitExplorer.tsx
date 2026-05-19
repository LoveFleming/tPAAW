import React, { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "../utils";
import { FileIcon } from "../components/Icon";
import { pathBasename } from "../utils";

// ── Types ──
interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
  lazy?: boolean;
}

// ── API helpers ──
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

async function fetchFile(path: string): Promise<{ path: string; content: string; size: number }> {
  const resp = await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(path)}`);
  if (!resp.ok) throw new Error("Failed to load file");
  return resp.json();
}

// ── File icon helper ──
function fileIconElement(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return <FileIcon ext={ext} size={12} />;
}

// ── Language detection for syntax highlighting hint ──
function detectLang(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "html",
    py: "python", java: "java", go: "go", rs: "rust",
    yaml: "yaml", yml: "yaml", sh: "bash", bash: "bash",
    sql: "sql", graphql: "graphql", toml: "toml",
  };
  return map[ext] || "text";
}

// ── Tree Node Component ──
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
          "w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-orange-50 transition-colors text-left rounded",
          isSelected && "bg-orange-100 text-orange-700 font-medium",
          !isSelected && "text-stone-600"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={cn("w-3.5 h-3.5 text-amber-500 shrink-0 transition-transform", isExpanded ? "" : "-rotate-90")}
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        ) : (
          <span className="w-3.5 shrink-0 text-center">{fileIconElement(node.name)}</span>
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

// ── Main Component ──
interface Props {
  projectRoot: string;
  onFileSelect?: (path: string) => void;
}

export default function ReleaseUnitExplorer({ projectRoot }: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ path: string; size: number; lang: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Load initial tree
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTree(projectRoot)
      .then((data) => { if (!cancelled) { setTree(data); setExpanded(new Set([projectRoot])); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectRoot]);

  const handleToggleDir = useCallback(async (dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });

    // Lazy load children if needed
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
          // Merge children into tree
          setTree((prev) => {
            if (!prev) return prev;
            const clone = JSON.parse(JSON.stringify(prev));
            const target = findNode(clone, dirPath);
            if (target) {
              target.children = loaded.children;
              target.lazy = false;
            }
            return clone;
          });
        } catch { /* ignore */ }
      }
    }
  }, [tree, projectRoot]);

  const handleSelectFile = useCallback(async (filePath: string) => {
    setSelectedFile(filePath);
    setFileContent(null);
    setFileMeta(null);
    try {
      const data = await fetchFile(filePath);
      setFileContent(data.content);
      const name = pathBasename(filePath);
      setFileMeta({ path: data.path, size: data.size, lang: detectLang(name) });
    } catch {
      setFileContent("// Unable to load file");
    }
  }, []);

  const projectName = pathBasename(projectRoot);

  if (loading && !tree) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading project...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* File Tree Panel */}
      <div className="w-72 border-r border-stone-200 flex flex-col bg-white shrink-0">
        <div className="px-3 py-2 border-b border-stone-100 bg-stone-50">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-amber-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
            </svg>
            <span className="text-sm font-semibold text-stone-700 truncate">{projectName}</span>
          </div>
          <div className="text-[10px] text-stone-400 font-mono truncate mt-0.5">{projectRoot}</div>
        </div>
        <div ref={treeContainerRef} className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
          {tree && (
            <TreeNodeView
              node={tree}
              root={projectRoot}
              depth={0}
              selectedPath={selectedFile}
              onSelectFile={handleSelectFile}
              onToggleDir={handleToggleDir}
              expanded={expanded}
            />
          )}
        </div>
      </div>

      {/* File Content Panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {selectedFile && fileContent !== null ? (
          <>
            <div className="px-4 py-2 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs">{fileIconElement(pathBasename(selectedFile))}</span>
                <span className="text-sm font-mono text-stone-700 truncate">
                  {selectedFile.slice(projectRoot.length + 1)}
                </span>
              </div>
              {fileMeta && (
                <div className="flex items-center gap-3 text-xs text-stone-400 shrink-0">
                  <span>{fileMeta.lang}</span>
                  <span>{(fileMeta.size / 1024).toFixed(1)} KB</span>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              <pre className="p-4 text-sm font-mono text-stone-700 whitespace-pre-wrap leading-relaxed" style={{ tabSize: 2 }}>
                <code>{fileContent}</code>
              </pre>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-stone-400">
            <div className="text-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-12 h-12 mx-auto mb-3 text-stone-300">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              <p className="text-sm">Select a file to view its content</p>
              <p className="text-xs text-stone-300 mt-1">Read-only preview</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
