import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import JsonViewer from "../components/JsonViewer";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import { fileEmoji } from "../components/FileEmoji";
import { pathBasename } from "../utils";
import hljs from "highlight.js";
import "highlight.js/styles/github.css"; // Light theme matching the white background

import API_BASE from "../api";

function fileIconElement(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return <span className="text-xs shrink-0">{fileEmoji(ext)}</span>;
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

function detectFileType(name: string): "markdown" | "json" | "image" | "code" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "json") return "json";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image";
  return "code";
}

// ── Image View ──
function ImageView({ filePath }: { filePath: string }) {
  const { info: t } = useTheme();
  const url = `${API_BASE}/api/fs/file?path=${encodeURIComponent(filePath)}`;
  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-auto" style={{ backgroundColor: t.accentBg }}>
      <img
        src={url}
        alt={pathBasename(filePath)}
        className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
          (e.target as HTMLImageElement).parentElement!.innerHTML = `<div class=\"text-stone-400 text-sm\">Failed to load image</div>`;
        }}
      />
    </div>
  );
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
      className="p-6 max-w-none prose prose-sm prose-table:border prose-table:border-collapse prose-th:border prose-th:border-stone-300 prose-th:px-3 prose-th:py-1.5 prose-td:border prose-td:border-stone-300 prose-td:px-3 prose-td:py-1.5"
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

  // Line number width (dynamic)
  const lineNumWidth = Math.max(3, String(lineCount).length) * 10 + 16;

  // Split highlighted HTML into per-line chunks
  const highlightedLines = useMemo(() => {
    const temp = document.createElement("div");
    temp.innerHTML = highlighted;
    // hljs outputs <span>s that may span multiple lines — split by \n
    const html = temp.innerHTML;
    return html.split("\n");
  }, [highlighted]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto w-full h-full"
    >
      <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: lineNumWidth }} />
          <col />
        </colgroup>
        <tbody className="font-mono text-sm" style={{ tabSize: 2 }}>
          {highlightedLines.map((htmlLine, i) => (
            <tr key={i}>
              <td
                className="text-right pr-3 select-none border-r sticky left-0 z-10"
                style={{
                  backgroundColor: "#f8f8f8",
                  borderColor: "#e5e5e5",
                  color: "#b0b0b0",
                  fontSize: "12px",
                  lineHeight: "20px",
                  height: "20px",
                  whiteSpace: "nowrap",
                  verticalAlign: "top",
                }}
              >
                {i + 1}
              </td>
              <td
                className="pl-4"
                style={{ lineHeight: "20px", height: "20px", whiteSpace: "pre", verticalAlign: "top" }}
                dangerouslySetInnerHTML={{ __html: htmlLine || "&nbsp;" }}
              />
            </tr>
          ))}
        </tbody>
      </table>
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
  active?: boolean;
}

export default function FileViewer({ filePath, projectRoot, active }: Props) {
  const { t: tt } = useI18n();
  const { info: t } = useTheme();
  const [content, setContent] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ size: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Esc to exit fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  const parsedJson = useMemo(() => {
    if (!content || detectFileType(pathBasename(filePath)) !== "json") return null;
    try { return JSON.parse(content); } catch { return null; }
  }, [content, filePath]);

  // Track last loaded filePath to know when to re-fetch
  const [loadedPath, setLoadedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) { setContent(null); setMeta(null); setLoadedPath(null); return; }
    // Already loaded this file? Don't re-fetch (preserves scroll position)
    if (loadedPath === filePath) return;
    const fileName = pathBasename(filePath);
    const fileType = detectFileType(fileName);
    // For images, don't fetch content — ImageView uses direct URL
    if (fileType === "image") {
      setContent(""); // trigger loaded state
      setMeta({ size: 0 });
      setLoading(false);
      setLoadedPath(filePath);
      return;
    }
    setLoading(true);
    setContent(null);
    setMeta(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    // Retry logic: up to 3 attempts with 500ms delay
    const doFetch = (attempt = 0) => {
      fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(filePath)}`, { signal: controller.signal })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(data => {
          if (data.error) throw new Error(data.error);
          setContent(data.content ?? "");
          setMeta({ size: data.size ?? 0 });
          setLoading(false);
          setLoadedPath(filePath);
        })
        .catch((err) => {
          if (err.name === 'AbortError') {
            setContent(`// Unable to load file: Request timed out`);
            setLoading(false);
            setLoadedPath(filePath); // Mark as loaded to prevent retry loop
            return;
          }
          if (attempt < 2) {
            setTimeout(() => doFetch(attempt + 1), 500);
          } else {
            setContent(`// Unable to load file: ${err.message}`);
            setLoading(false);
            setLoadedPath(filePath); // Mark as loaded to prevent retry loop
          }
        });
    };
    doFetch(0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filePath, loadedPath]);

  const safeRoot = projectRoot || '';
  const relativePath = safeRoot ? filePath.replace(new RegExp(`^${safeRoot.replace(/[\\/]+/g, '/').replace(/\/$/, '')}/?`), '') : filePath;
  const fileName = pathBasename(filePath);
  const fileType = detectFileType(fileName);

  return (
    <div className={fullscreen ? "fixed inset-0 z-50 bg-white flex flex-col" : "h-full flex flex-col min-h-0"}>
      {/* File header bar — theme-aware */}
      <div className="px-4 py-1.5 border-b flex items-center justify-between shrink-0"
        style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs">{fileIconElement(fileName)}</span>
          <span className="text-sm font-semibold truncate" style={{ color: t.accentText }}>{fileName}</span>
          {meta && (
            <span className="text-[11px] shrink-0" style={{ color: t.accentHover }}>
              {(meta.size / 1024).toFixed(1)} KB
            </span>
          )}
        </div>
        <button
          onClick={() => setFullscreen(!fullscreen)}
          className="px-2 py-1 rounded-lg text-xs font-bold border transition-colors"
          style={{ borderColor: t.accentBorder, color: t.accent }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accent; e.currentTarget.style.color = "white"; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = t.accent; }}
        >
          {fullscreen ? tt("fileViewer.exitFullscreen") : tt("fileViewer.fullscreen")}
        </button>
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
          {fileType === "image" && <ImageView filePath={filePath} />}
          {fileType === "code" && <div className="flex-1 overflow-hidden"><CodeView content={content} fileName={fileName} /></div>}
        </div>
      ) : null}
    </div>
  );
}
