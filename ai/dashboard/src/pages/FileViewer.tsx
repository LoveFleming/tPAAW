import React, { useState, useEffect, useMemo } from "react";
import { cn } from "../utils";

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

// ── JSON View ──
function JsonView({ content }: { content: string }) {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }, [content]);

  return (
    <pre className="p-6 text-sm font-mono text-stone-700 leading-relaxed whitespace-pre" style={{ tabSize: 2 }}>
      <code>{formatted}</code>
    </pre>
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
  filePath: string | null;
  projectRoot: string;
}

export default function FileViewer({ filePath, projectRoot }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ size: number; lang: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath) { setContent(null); setMeta(null); return; }
    setLoading(true);
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

  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-stone-400">
        <div className="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-12 h-12 mx-auto mb-3 text-stone-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <p className="text-sm">Select a file from the sidebar to view</p>
          <p className="text-xs text-stone-300 mt-1">Read-only preview</p>
        </div>
      </div>
    );
  }

  const relativePath = filePath.slice(projectRoot.length + 1);
  const fileName = filePath.split("/").pop() || "";
  const fileType = detectFileType(fileName);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* File header */}
      <div className="px-4 py-1.5 border-b border-stone-200 bg-stone-50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs">{fileIcon(fileName)}</span>
          <span className="text-sm font-mono text-stone-700 truncate">{relativePath}</span>
        </div>
        {meta && (
          <div className="flex items-center gap-3 text-xs text-stone-400 shrink-0">
            <span>{meta.lang}</span>
            <span>{(meta.size / 1024).toFixed(1)} KB</span>
          </div>
        )}
      </div>

      {/* File content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">Loading...</div>
      ) : content !== null ? (
        <div className="flex-1 overflow-auto bg-white">
          {fileType === "markdown" && <MarkdownView content={content} />}
          {fileType === "json" && <JsonView content={content} />}
          {fileType === "code" && <CodeView content={content} />}
        </div>
      ) : null}
    </div>
  );
}
