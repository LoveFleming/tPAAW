import React, { useState, useEffect, useMemo } from "react";
import { JsonView, allExpanded, collapseAllNested, darkStyles, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";

const API_BASE = "http://127.0.0.1:4097";

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "📘", tsx: "📘", js: "📙", jsx: "📙", mjs: "📙",
    json: "📋", md: "📝", css: "🎨", html: "🌐",
    py: "🐍", java: "☕", go: "🐹", rs: "🦀",
    yaml: "⚙️", yml: "⚙️", toml: "⚙️",
    sh: "📜", txt: "📄", lock: "🔒",
  };
  return map[ext] || "📄";
}

function detectLang(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "html",
    py: "python", java: "java", go: "go", rs: "rust",
    yaml: "yaml", yml: "yaml", sh: "bash", sql: "sql",
  };
  return map[ext] || "text";
}

function detectFileType(name: string): "markdown" | "json" | "code" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "json") return "json";
  return "code";
}

// ── JSON View — collapsible tree ──
function JsonTreeView({ content }: { content: string }) {
  const [collapsed, setCollapsed] = useState(false);

  const parsed = useMemo(() => {
    try { return JSON.parse(content); }
    catch { return { error: "Invalid JSON", raw: content }; }
  }, [content]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-stone-100 bg-stone-50/50 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="text-[11px] px-2 py-0.5 rounded bg-stone-100 text-stone-500 hover:bg-orange-50 hover:text-orange-600 transition-colors"
        >
          Expand All
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="text-[11px] px-2 py-0.5 rounded bg-stone-100 text-stone-500 hover:bg-orange-50 hover:text-orange-600 transition-colors"
        >
          Collapse
        </button>
      </div>
      {/* Tree */}
      <div className="flex-1 overflow-auto p-4" style={{ scrollbarWidth: "thin" }}>
        <div className="text-sm font-mono">
          <JsonView
            data={parsed}
            shouldExpandNode={collapsed ? collapseAllNested : allExpanded}
            style={defaultStyles}
          />
        </div>
      </div>
    </div>
  );
}

// ── Markdown View ──
function MarkdownView({ content }: { content: string }) {
  const [MarkdownComponent, setComponent] = useState<React.ComponentType<{ children: string }> | null>(null);

  useEffect(() => {
    import("react-markdown").then((mod) => {
      setComponent(() => mod.default as any);
    });
  }, []);

  if (!MarkdownComponent) {
    return <pre className="p-6 text-sm font-mono text-stone-700 whitespace-pre-wrap">{content}</pre>;
  }

  return (
    <div className="p-6 max-w-4xl prose prose-stone prose-sm prose-headings:text-stone-800 prose-a:text-orange-600 prose-code:text-orange-700 prose-code:bg-orange-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-stone-900 prose-pre:text-stone-100">
      <MarkdownComponent>{content}</MarkdownComponent>
    </div>
  );
}

// ── Code View (default) ──
function CodeView({ content }: { content: string }) {
  return (
    <pre className="p-6 text-sm font-mono text-stone-700 whitespace-pre-wrap leading-relaxed" style={{ tabSize: 2 }}>
      <code>{content}</code>
    </pre>
  );
}

// ── Main Component ──
interface Props {
  filePath: string;
  projectRoot: string;
}

export default function FileViewer({ filePath, projectRoot }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ size: number; lang: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath) { setContent(null); setMeta(null); return; }
    setLoading(true);
    setContent(null);
    setMeta(null);
    fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(data => {
        setContent(data.content);
        const name = filePath.split("/").pop() || "";
        setMeta({ size: data.size, lang: detectLang(name) });
      })
      .catch(() => setContent("// Unable to load file"))
      .finally(() => setLoading(false));
  }, [filePath]);

  const relativePath = filePath.slice(projectRoot.length + 1);
  const fileName = filePath.split("/").pop() || "";
  const fileType = detectFileType(fileName);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* File header bar */}
      <div className="px-4 py-1.5 border-b border-stone-200 bg-stone-50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs">{fileIcon(fileName)}</span>
          <span className="text-xs font-mono text-stone-600 truncate">{relativePath}</span>
        </div>
        {meta && (
          <div className="flex items-center gap-3 text-[11px] text-stone-400 shrink-0">
            <span>{meta.lang}</span>
            <span>{(meta.size / 1024).toFixed(1)} KB</span>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">
          <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading...
        </div>
      ) : content !== null ? (
        <div className="flex-1 overflow-auto bg-white" style={{ scrollbarWidth: "thin" }}>
          {fileType === "json" && <JsonTreeView content={content} />}
          {fileType === "markdown" && <MarkdownView content={content} />}
          {fileType === "code" && <CodeView content={content} />}
        </div>
      ) : null}
    </div>
  );
}
