import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import JsonViewer from "../components/JsonViewer";
import { useTheme } from "../theme";
import { FileIcon } from "../components/Icon";
import { pathBasename } from "../utils";
import hljs from "highlight.js";
import "highlight.js/styles/github.css"; // Light theme matching the white background

const API_BASE = "http://127.0.0.1:4097";

function fileIconElement(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return <FileIcon ext={ext} size={12} />;
}

// Map file extension to highlight.js language
function detectLanguage(name: string): string | undefined {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript",
    java: "java",
    xml: "xml", svg: "xml", xsd: "xml", xsl: "xml",
    yaml: "yaml", yml: "yaml",
    json: "json",
    md: "markdown", markdown: "markdown",
    py: "python",
    go: "go",
    rs: "rust",
    sql: "sql",
    sh: "bash", bash: "bash", zsh: "bash",
    css: "css", scss: "scss", less: "less",
    html: "xml", htm: "xml",
    dockerfile: "dockerfile",
    makefile: "makefile",
    toml: "ini",
  };
  return map[ext];
}

function detectFileType(name: string): "markdown" | "json" | "code" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "json") return "json";
  return "code";
}

// ── Markdown View (theme-aware prose) ──
function MarkdownView({ content }: { content: string }) {
  const { info: t } = useTheme();
  const [MarkdownComponent, setComponent] = useState<React.ComponentType<{ children: string }> | null>(null);
  const [gfmPlugin, setGfmPlugin] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      import("react-markdown"),
      import("remark-gfm"),
    ]).then(([mdMod, gfmMod]) => {
      setGfmPlugin(() => gfmMod.default);
      setComponent(() => mdMod.default as any);
    });
  }, []);

  if (!MarkdownComponent || !gfmPlugin) {
    return <pre className="p-6 text-sm font-mono text-stone-700 whitespace-pre-wrap">{content}</pre>;
  }

  return (
    <div
      className="p-6 max-w-4xl prose prose-sm prose-table:border prose-table:border-collapse prose-th:border prose-th:border-stone-300 prose-th:px-3 prose-th:py-1.5 prose-td:border prose-td:border-stone-300 prose-td:px-3 prose-td:py-1.5"
      style={{
        // @ts-ignore CSS custom properties via style
        "--tw-prose-body": t.accentText,
        "--tw-prose-headings": t.accentText,
        "--tw-prose-links": t.accent,
        "--tw-prose-bold": t.accentText,
        "--tw-prose-code": t.accent,
        "--tw-prose-pre-bg": "#1c1917",
        "--tw-prose-pre-code": "#e7e5e4",
        color: "#57534e",
      } as React.CSSProperties}
    >
      <MarkdownComponent remarkPlugins={[gfmPlugin]}>{content}</MarkdownComponent>
    </div>
  );
}

// ── Syntax-highlighted Code View with line numbers ──
function CodeView({ content, fileName }: { content: string; fileName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);

  const lines = content.split("\n");
  const lineCount = lines.length;
  const lang = detectLanguage(fileName);

  // Highlight the code
  const highlighted = useMemo(() => {
    if (!lang) {
      // Auto-detect
      try {
        const result = hljs.highlightAuto(content);
        return result.value;
      } catch {
        return escapeHtml(content);
      }
    }
    try {
      const result = hljs.highlight(content, { language: lang, ignoreIllegals: true });
      return result.value;
    } catch {
      return escapeHtml(content);
    }
  }, [content, lang]);

  // Sync scroll between line numbers and code
  const handleScroll = useCallback(() => {
    if (containerRef.current && lineNumRef.current) {
      lineNumRef.current.scrollTop = containerRef.current.scrollTop;
    }
  }, []);

  // Line number width (dynamic)
  const lineNumWidth = Math.max(3, String(lineCount).length) * 10 + 16;

  return (
    <div className="flex h-full">
      {/* Line numbers */}
      <div
        ref={lineNumRef}
        className="shrink-0 overflow-hidden select-none border-r"
        style={{
          width: lineNumWidth,
          backgroundColor: "#f8f8f8",
          borderColor: "#e5e5e5",
        }}
      >
        <div className="py-4">
          {lines.map((_, i) => (
            <div
              key={i}
              className="text-right pr-3 text-xs leading-5 font-mono"
              style={{ color: "#b0b0b0", height: 20 }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Code */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <pre className="py-4 px-4 text-sm leading-5 font-mono" style={{ tabSize: 2 }}>
          <code
            ref={codeRef}
            className={lang ? `language-${lang}` : ""}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>
    </div>
  );
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Main Component ──
interface Props {
  filePath: string;
  projectRoot: string;
}

export default function FileViewer({ filePath, projectRoot }: Props) {
  const { info: t } = useTheme();
  const [content, setContent] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ size: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const parsedJson = useMemo(() => {
    if (!content || detectFileType(pathBasename(filePath)) !== "json") return null;
    try { return JSON.parse(content); } catch { return null; }
  }, [content, filePath]);

  useEffect(() => {
    if (!filePath) { setContent(null); setMeta(null); return; }
    setLoading(true);
    setContent(null);
    setMeta(null);
    fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(data => {
        setContent(data.content);
        setMeta({ size: data.size });
      })
      .catch(() => setContent("// Unable to load file"))
      .finally(() => setLoading(false));
  }, [filePath]);

  const relativePath = filePath.replace(new RegExp(`^${projectRoot.replace(/[\\/]+/g, '/').replace(/\/$/, '')}/?`), '');
  const fileName = pathBasename(filePath);
  const fileType = detectFileType(fileName);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* File header bar — theme-aware */}
      <div className="px-4 py-1.5 border-b flex items-center justify-between shrink-0"
        style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs">{fileIconElement(fileName)}</span>
          <span className="text-xs font-mono truncate" style={{ color: t.accentText }}>{relativePath}</span>
        </div>
        {meta && (
          <div className="flex items-center gap-3 text-[11px] shrink-0" style={{ color: t.accentHover }}>
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
        <div className="flex-1 flex flex-col bg-white min-h-0 overflow-hidden">
          {fileType === "json" && parsedJson !== null && <JsonViewer data={parsedJson} />}
          {fileType === "json" && parsedJson === null && <div className="flex-1 overflow-hidden"><CodeView content={content} fileName={fileName} /></div>}
          {fileType === "markdown" && <div className="flex-1 overflow-auto"><MarkdownView content={content} /></div>}
          {fileType === "code" && <div className="flex-1 overflow-hidden"><CodeView content={content} fileName={fileName} /></div>}
        </div>
      ) : null}
    </div>
  );
}
