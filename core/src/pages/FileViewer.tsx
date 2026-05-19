import React, { useState, useEffect, useMemo } from "react";
import JsonViewer from "../components/JsonViewer";
import { useTheme } from "../theme";
import { FileIcon } from "../components/Icon";
import { pathBasename } from "../utils";

const API_BASE = "http://127.0.0.1:4097";

function fileIconElement(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return <FileIcon ext={ext} size={12} />;
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

  useEffect(() => {
    import("react-markdown").then((mod) => {
      setComponent(() => mod.default as any);
    });
  }, []);

  if (!MarkdownComponent) {
    return <pre className="p-6 text-sm font-mono text-stone-700 whitespace-pre-wrap">{content}</pre>;
  }

  return (
    <div
      className="p-6 max-w-4xl prose prose-sm"
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
      <MarkdownComponent>{content}</MarkdownComponent>
    </div>
  );
}

// ── Code View ──
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
          {fileType === "json" && parsedJson === null && <div className="flex-1 overflow-auto"><CodeView content={content} /></div>}
          {fileType === "markdown" && <div className="flex-1 overflow-auto"><MarkdownView content={content} /></div>}
          {fileType === "code" && <div className="flex-1 overflow-auto"><CodeView content={content} /></div>}
        </div>
      ) : null}
    </div>
  );
}
