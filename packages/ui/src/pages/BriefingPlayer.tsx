import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import API from "../api";

// Inject marker pulse animation once
if (typeof document !== "undefined" && !document.getElementById("briefing-anim")) {
  const style = document.createElement("style");
  style.id = "briefing-anim";
  style.textContent = `
    @keyframes briefing-pulse {
      0%, 100% { transform: translate(-50%, -50%) scale(1); }
      50% { transform: translate(-50%, -50%) scale(1.18); }
    }
    .briefing-topbar:hover .briefing-nav-btn { opacity: 1; }
    .briefing-nav-btn { opacity: 0; transition: opacity 0.15s; }
    .briefing-nav-btn:hover { opacity: 1; }
    .briefing-nav-btn:disabled { opacity: 0 !important; pointer-events: none; }
  `;
  document.head.appendChild(style);
}

// ── Custom pencil cursor for pen drawing mode ──
const PENCIL_CURSOR_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">' +
  '<path d="M2 16 L4 11 L12 3 L15 6 L7 14 Z" fill="#facc15" stroke="#333" stroke-width="0.8" stroke-linejoin="round"/>' +
  '<path d="M2 16 L4 11 L7 14 Z" fill="#a0a0a0" stroke="#333" stroke-width="0.8" stroke-linejoin="round"/>' +
  '<rect x="12" y="2.5" width="3.2" height="3" transform="rotate(45 12 2.5)" fill="#d4a017" stroke="#333" stroke-width="0.6"/>' +
  '<circle cx="2" cy="16" r="0.8" fill="#222"/>' +
  '</svg>'
);
const PENCIL_CURSOR = `url("data:image/svg+xml,${PENCIL_CURSOR_SVG}") 2 16, crosshair`;

// ── Syntax highlighting for ref overlay ──
import hljs from "highlight.js/lib/common";
import java from "highlight.js/lib/languages/java";
import yaml from "highlight.js/lib/languages/yaml";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import properties from "highlight.js/lib/languages/properties";
import "highlight.js/styles/github.css";

hljs.registerLanguage("java", java);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("properties", properties);

function getHljsLang(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript",
    json: "json", md: "markdown", css: "css", html: "xml", xml: "xml",
    py: "python", go: "go", rs: "rust", sh: "bash", shell: "bash",
    yaml: "yaml", yml: "yaml", toml: "ini",
    sql: "sql", java: "java", kt: "java", scala: "scala",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    dockerfile: "dockerfile", makefile: "makefile",
    conf: "ini", cfg: "ini", properties: "properties", env: "bash",
    graphql: "graphql", vue: "xml", svelte: "xml",
  };
  return map[ext] || "";
}

// ── Types ──
interface Slide {
  id: string;
  name: string;
  image: string | null;
  markdown: string | null;
  sortKey: string;
}

interface BriefingDir {
  path: string;
  name: string;
}

interface ParsedMarkdown {
  content: string;
  fileRefs: string[];
}

function normalizePath(p: string): string {
  // Convert Windows backslashes to forward slashes for consistent handling
  return p.replace(/\\+/g, "/");
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:/.test(p);
}

function pathBasename(p: string): string {
  const normalized = normalizePath(p);
  return normalized.split("/").pop() || p;
}

function joinPath(dir: string, rel: string): string {
  const nd = normalizePath(dir);
  const nr = normalizePath(rel);
  if (nd.endsWith("/")) return nd + nr;
  return nd + "/" + nr;
}

function parseMarkdown(rawText: string, mdDir: string): ParsedMarkdown {
  const separatorIdx = rawText.indexOf("\n---\n");
  let contentPart = rawText;
  let refsPart = "";

  if (separatorIdx >= 0) {
    contentPart = rawText.slice(0, separatorIdx).trim();
    refsPart = rawText.slice(separatorIdx + 5).trim();
  }

  const allRefs: string[] = [];
  const refRegex = /@file:\s*(.+)/g;
  let match;
  while ((match = refRegex.exec(contentPart)) !== null) {
    let p = match[1].trim();
    p = normalizePath(p);
    if (!isAbsolutePath(p)) p = joinPath(mdDir, p);
    allRefs.push(p);
  }
  contentPart = contentPart.replace(/@file:\s*.+/g, "").trim();

  while ((match = refRegex.exec(refsPart)) !== null) {
    let p = match[1].trim();
    p = normalizePath(p);
    if (!isAbsolutePath(p)) p = joinPath(mdDir, p);
    allRefs.push(p);
  }

  return { content: contentPart, fileRefs: allRefs };
}

// ── Beautified markdown renderer (theme-aware) ──
function renderMarkdown(md: string, theme?: any): React.ReactNode {
  const lines = md.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = "";
  let tableRows: string[] = [];
  const accent = theme?.accent || "#6366f1";

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const dataRows = tableRows.filter(r => !r.includes("|---") && !r.includes("|:--"));
    if (dataRows.length === 0) { tableRows = []; return; }

    const parseRow = (row: string) =>
      row.split("|").slice(1, -1).map(c => c.trim());

    const headerCells = parseRow(dataRows[0]);
    const bodyRows = dataRows.slice(1).map(parseRow);

    elements.push(
      <div key={`table-${elements.length}`} className="my-3 overflow-x-auto rounded-lg border" style={{ borderColor: accent + "25" }}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ background: accent + "10" }}>
              {headerCells.map((cell, ci) => (
                <th key={ci} className="px-3 py-2 text-left font-semibold whitespace-nowrap" style={{ color: accent, borderBottom: `2px solid ${accent}30` }}>
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri} className="hover:bg-stone-50/80 transition-colors" style={{ borderBottom: ri < bodyRows.length - 1 ? `1px solid ${accent}10` : "none" }}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-stone-600">{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
  };

  lines.forEach((line, i) => {
    if (line.trim().startsWith("```")) {
      if (tableRows.length) flushTable();
      if (inCodeBlock) {
        const displayedLang = codeLang || "code";
        elements.push(
          <div key={`code-${i}`} className="my-3 rounded-xl overflow-hidden border" style={{ borderColor: accent + "20" }}>
            <div className="flex items-center justify-between px-3 py-1.5" style={{ background: accent + "08", borderBottom: `1px solid ${accent}15` }}>
              <span className="text-[10px] font-mono font-medium" style={{ color: accent + "aa" }}>{displayedLang}</span>
              <span className="text-[10px] text-stone-300">📋</span>
            </div>
            <pre className="bg-stone-50 p-4 overflow-x-auto text-xs leading-relaxed">
              <code className="text-stone-700">{codeLines.join("\n")}</code>
            </pre>
          </div>
        );
        codeLines = [];
        codeLang = "";
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
      }
      return;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    if (line.trim().startsWith("|")) {
      tableRows.push(line.trim());
      return;
    } else if (tableRows.length > 0) {
      flushTable();
    }

    if (line.startsWith("# ")) {
      elements.push(
        <div key={i} className="mt-4 mb-2">
          <h1 className="text-xl font-bold text-stone-800 leading-tight">{line.slice(2)}</h1>
          <div className="mt-1.5 h-0.5 w-12 rounded-full" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}30)` }} />
        </div>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <div key={i} className="mt-3.5 mb-1.5">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full" style={{ background: accent }} />
            <h2 className="text-base font-bold text-stone-700 leading-tight">{line.slice(3)}</h2>
          </div>
        </div>
      );
    } else if (line.startsWith("### ")) {
      elements.push(
        <div key={i} className="mt-2.5 mb-1">
          <h3 className="text-sm font-semibold text-stone-600 leading-tight pl-3" style={{ borderLeft: `2px solid ${accent}50` }}>{line.slice(4)}</h3>
        </div>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex items-start gap-2 my-1 ml-1">
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
          <span className="text-sm text-stone-600 leading-relaxed">{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1] || "1";
      const text = line.replace(/^\d+\.\s/, "");
      elements.push(
        <div key={i} className="flex items-start gap-2 my-1 ml-1">
          <span className="mt-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white shrink-0" style={{ background: accent }}>{num}</span>
          <span className="text-sm text-stone-600 leading-relaxed">{renderInline(text)}</span>
        </div>
      );
    } else if (line.startsWith("> ")) {
      elements.push(
        <div key={i} className="my-2 pl-3 py-1.5 rounded-r-lg" style={{ borderLeft: `3px solid ${accent}60`, background: accent + "06" }}>
          <span className="text-sm text-stone-500 italic leading-relaxed">{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === "---") {
      elements.push(
        <div key={i} className="my-3 flex items-center gap-2">
          <div className="flex-1 h-px" style={{ background: accent + "20" }} />
          <span className="text-stone-300 text-xs">✦</span>
          <div className="flex-1 h-px" style={{ background: accent + "20" }} />
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-sm text-stone-600 leading-relaxed my-1">{renderInline(line)}</p>);
    }
  });

  if (tableRows.length > 0) flushTable();

  if (inCodeBlock && codeLines.length > 0) {
    const displayedLang = codeLang || "code";
    elements.push(
      <div key="code-final" className="my-3 rounded-xl overflow-hidden border" style={{ borderColor: accent + "20" }}>
        <div className="flex items-center justify-between px-3 py-1.5" style={{ background: accent + "08", borderBottom: `1px solid ${accent}15` }}>
          <span className="text-[10px] font-mono font-medium" style={{ color: accent + "aa" }}>{displayedLang}</span>
          <span className="text-[10px] text-stone-300">📋</span>
        </div>
        <pre className="bg-stone-50 p-4 overflow-x-auto text-xs leading-relaxed">
          <code className="text-stone-700">{codeLines.join("\n")}</code>
        </pre>
      </div>
    );
  }

  return <div>{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-stone-800">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-700 text-xs font-mono border border-stone-200/80">{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

// ── Full-screen Reference Overlay ──
function RefOverlay({ refPath, onClose, theme }: { refPath: string; onClose: () => void; theme: any }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/fs/file?path=${encodeURIComponent(refPath)}`)
      .then(r => r.json())
      .then(data => { setContent(data.content || ""); setError(""); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [refPath]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const fileName = pathBasename(refPath);
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const hljsLang = getHljsLang(fileName);

  const highlightedHtml = (() => {
    if (!content || !hljsLang) return null;
    try {
      const result = hljs.highlight(content, { language: hljsLang, ignoreIllegals: true });
      return result.value;
    } catch {
      return null;
    }
  })();

  const isMarkdown = ext === "md" || ext === "markdown";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ backgroundColor: "rgba(250,250,249,0.97)" }}
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between px-5 py-2.5 shrink-0"
        style={{ borderBottom: `1px solid ${theme.accentBorder}` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{isMarkdown ? "📝" : "📄"}</span>
          <span className="text-sm font-mono text-stone-700">{fileName}</span>
          <span className="text-[10px] text-stone-400 uppercase px-1.5 py-0.5 rounded bg-stone-100">{ext}</span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 rounded-lg text-xs text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
        >
          ✕ 關閉 (Esc)
        </button>
      </div>

      <div
        className="flex-1 overflow-auto"
        style={{ scrollbarWidth: "thin" }}
        onClick={e => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-rose-500 text-sm">❌ {error}</div>
        ) : isMarkdown ? (
          <div className="p-6" style={{ maxWidth: "900px", margin: "0 auto" }}>
            {renderMarkdown(content || "", theme)}
          </div>
        ) : (
          <pre className="p-6 text-sm font-mono leading-relaxed overflow-auto" style={{ maxWidth: "1100px", margin: "0 auto" }}>
            {highlightedHtml ? (
              <code className={`language-${hljsLang} hljs`} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
            ) : (
              <code className="text-stone-700">{content}</code>
            )}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Main BriefingPlayer Component ──
export default function BriefingPlayer({ initialDir }: { initialDir?: string | null }) {
  const { info: t } = useTheme();
  const { t: tt } = useI18n();

  const [briefingDirs, setBriefingDirs] = useState<BriefingDir[]>([]);
  const [selectedDir, setSelectedDir] = useState<string>(initialDir || "");
  const [slides, setSlides] = useState<Slide[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [overviewMode, setOverviewMode] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [parsedMd, setParsedMd] = useState<ParsedMarkdown>({ content: "", fileRefs: [] });
  const [mdLoading, setMdLoading] = useState(false);
  const [notesContent, setNotesContent] = useState("");
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [refOverlay, setRefOverlay] = useState<string | null>(null);
  const [showFileDropdown, setShowFileDropdown] = useState(false);

  // ── Drawing / Annotation ──
  type DrawMode = "none" | "pen" | "marker";
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [strokesBySlide, setStrokesBySlide] = useState<Record<number, { x: number; y: number }[][]>>({});
  const [markersBySlide, setMarkersBySlide] = useState<Record<number, { x: number; y: number; icon: string }[]>>({});
  const [activeStroke, setActiveStroke] = useState<{ x: number; y: number }[]>([]);
  const [selectedIcon, setSelectedIcon] = useState("💡");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Discover briefing directories ──
  const loadBriefingDirs = useCallback(async () => {
    try {
      const rootResp = await fetch(`${API}/api/paaw-root`);
      const rootData = await rootResp.json();
      const briefingsRoot = `${rootData.paawRoot}/data/briefings`;
      const resp = await fetch(`${API}/api/fs/browse?path=${encodeURIComponent(briefingsRoot)}`);
      if (!resp.ok) { setBriefingDirs([]); return; }
      const data = await resp.json();
      const dirs: BriefingDir[] = (data.directories || []).map((d: any) => ({ path: d.path, name: d.name }));
      setBriefingDirs(dirs);
    } catch { setBriefingDirs([]); }
  }, []);

  useEffect(() => { loadBriefingDirs(); }, [loadBriefingDirs]);

  // ── Load slides ──
  const loadSlides = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const resp = await fetch(`${API}/api/fs/tree?root=${encodeURIComponent(dirPath)}`);
      const tree = await resp.json();
      const fileMap = new Map<string, string>();
      const collect = (node: any) => {
        if (node.type === "file") fileMap.set(node.name, node.path);
        (node.children || []).forEach(collect);
      };
      collect(tree);

      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
      const slideMap = new Map<string, Slide>();
      fileMap.forEach((fullPath, name) => {
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        const baseName = name.replace(/\.[^.]+$/, "");
        if (imageExts.includes(ext)) {
          const existing = slideMap.get(baseName) || { id: baseName, name: baseName, image: null, markdown: null, sortKey: baseName };
          existing.image = fullPath;
          slideMap.set(baseName, existing);
        } else if (ext === "md" && name !== "notes.md") {
          const existing = slideMap.get(baseName) || { id: baseName, name: baseName, image: null, markdown: null, sortKey: baseName };
          existing.markdown = fullPath;
          slideMap.set(baseName, existing);
        }
      });
      const sorted = Array.from(slideMap.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      setSlides(sorted);
      setCurrentIdx(0);
    } catch { setSlides([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (initialDir) {
      loadSlides(initialDir);
      setSelectedDir(initialDir);
    } else {
      // Sidebar click — always go back to dir picker
      setSelectedDir("");
      setSlides([]);
      resetAllAnnotations();
    }
  }, [initialDir, loadSlides]);

  // ── Load markdown content ──
  useEffect(() => {
    const slide = slides[currentIdx];
    if (!slide?.markdown) { setParsedMd({ content: "", fileRefs: [] }); return; }
    let cancelled = false;
    setMdLoading(true);
    fetch(`${API}/api/fs/file?path=${encodeURIComponent(slide.markdown)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const text = data.content || "";
        const normalizedMdPath = normalizePath(slide.markdown!);
        const mdDir = normalizedMdPath.substring(0, normalizedMdPath.lastIndexOf("/"));
        setParsedMd(parseMarkdown(text, mdDir));
      })
      .catch(() => { if (!cancelled) setParsedMd({ content: "", fileRefs: [] }); })
      .finally(() => { if (!cancelled) setMdLoading(false); });
    return () => { cancelled = true; };
  }, [currentIdx, slides]);

  // ── Load notes.md ──
  useEffect(() => {
    if (!selectedDir) { setNotesContent(""); return; }
    const notesPath = `${selectedDir}/notes.md`;
    fetch(`${API}/api/fs/file?path=${encodeURIComponent(notesPath)}`)
      .then(r => { if (r.ok) return r.json(); throw new Error("no notes"); })
      .then(data => setNotesContent(data.content || ""))
      .catch(() => setNotesContent(""));
  }, [selectedDir]);

  const imageUrl = useMemo(() => {
    const slide = slides[currentIdx];
    if (!slide?.image) return null;
    return `${API}/api/fs/file?path=${encodeURIComponent(slide.image)}`;
  }, [currentIdx, slides]);

  // ── Keyboard navigation ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "ArrowRight": case " ": case "PageDown":
          e.preventDefault();
          if (overviewMode) { setOverviewMode(false); return; }
          setCurrentIdx(i => Math.min(i + 1, slides.length - 1)); break;
        case "ArrowLeft": case "PageUp":
          e.preventDefault();
          if (overviewMode) { setOverviewMode(false); return; }
          setCurrentIdx(i => Math.max(i - 1, 0)); break;
        case "o": case "O": e.preventDefault(); setOverviewMode(v => !v); break;
        case "n": case "N": e.preventDefault(); setShowNotes(v => !v); break;
        case "f": case "F":
          e.preventDefault();
          if (!fullscreen) { containerRef.current?.requestFullscreen?.(); setFullscreen(true); }
          else { document.exitFullscreen?.(); setFullscreen(false); }
          break;
        case "d": case "D": e.preventDefault(); toggleMode("pen"); break;
        case "h": case "H": e.preventDefault(); toggleMode("marker"); break;
        case "e": case "E": e.preventDefault(); clearAnnotations(); break;
        case "Escape": if (overviewMode) setOverviewMode(false); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [slides.length, overviewMode, fullscreen, drawMode]);

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ── Browse directories ──
  const [browsePath, setBrowsePath] = useState("");
  const [browseDirs, setBrowseDirs] = useState<any[]>([]);
  const [browseParent, setBrowseParent] = useState<string | null>(null);

  const browseForPicker = useCallback((path: string) => {
    fetch(`${API}/api/fs/browse?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => { setBrowsePath(data.currentPath); setBrowseParent(data.parent || null); setBrowseDirs(data.directories || []); })
      .catch(() => {});
  }, []);

  // ── Drawing helpers ──
  const drawingRef = useRef(false);
  const draggingMarkerRef = useRef<number | null>(null);
  const currentIdxRef = useRef(currentIdx);
  currentIdxRef.current = currentIdx;
  // Active stroke stored in ref to avoid per-mousemove re-renders (Chrome crash fix)
  const activeStrokeRef = useRef<{ x: number; y: number }[]>([]);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const MIN_POINT_DIST = 0.003; // minimum relative distance between points

  const getRelPos = (clientX: number, clientY: number) => {
    const el = contentAreaRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  // Draw active stroke segment directly on canvas (no React re-render)
  const drawActiveSegment = useCallback(() => {
    const canvas = canvasRef.current;
    const container = contentAreaRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width; canvas.height = rect.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Redraw all committed strokes + active stroke in one pass
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = t.accent;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.shadowBlur = 6; ctx.shadowColor = t.accent + "66";
    const committed = strokesBySlide[currentIdxRef.current] || [];
    const active = activeStrokeRef.current;
    for (const stroke of [...committed, ...(active.length > 1 ? [active] : [])]) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x * canvas.width, stroke[i].y * canvas.height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [t, strokesBySlide]);

  const resetAllAnnotations = useCallback(() => {
    setStrokesBySlide({}); setMarkersBySlide({}); setActiveStroke([]); setDrawMode("none"); drawingRef.current = false;
  }, []);

  const penStrokes = strokesBySlide[currentIdx] || [];
  const markers = markersBySlide[currentIdx] || [];

  const clearAnnotations = useCallback(() => {
    setStrokesBySlide(prev => { const n = { ...prev }; delete n[currentIdx]; return n; });
    setMarkersBySlide(prev => { const n = { ...prev }; delete n[currentIdx]; return n; });
    setActiveStroke([]); drawingRef.current = false;
  }, [currentIdx]);

  const toggleMode = useCallback((mode: "pen" | "marker") => {
    setDrawMode(prev => prev === mode ? "none" : mode);
    setActiveStroke([]); drawingRef.current = false;
  }, []);

  const handleContentMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-annotation-ui]')) return;
    if (drawMode === "pen") {
      e.preventDefault(); drawingRef.current = true;
      const pos = getRelPos(e.clientX, e.clientY);
      activeStrokeRef.current = [pos];
      lastPointRef.current = pos;
    } else if (drawMode === "marker") {
      e.preventDefault();
      const pos = getRelPos(e.clientX, e.clientY);
      setMarkersBySlide(prev => ({ ...prev, [currentIdx]: [...(prev[currentIdx] || []), { ...pos, icon: selectedIcon }] }));
    }
  };

  const handleMarkerMouseDown = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation(); e.preventDefault();
    if (e.button !== 0) return;
    draggingMarkerRef.current = idx;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (drawingRef.current) {
        // Throttle: skip points too close together to avoid flooding
        const pos = getRelPos(e.clientX, e.clientY);
        const last = lastPointRef.current;
        if (last) {
          const dx = pos.x - last.x, dy = pos.y - last.y;
          if (dx * dx + dy * dy < MIN_POINT_DIST * MIN_POINT_DIST) return;
        }
        activeStrokeRef.current.push(pos);
        lastPointRef.current = pos;
        // Draw directly on canvas — no React state update
        drawActiveSegment();
        return;
      }
      if (draggingMarkerRef.current !== null) {
        e.preventDefault();
        const pos = getRelPos(e.clientX, e.clientY);
        setMarkersBySlide(prev => ({ ...prev, [currentIdxRef.current]: (prev[currentIdxRef.current] || []).map((m, i) => i === draggingMarkerRef.current ? { ...m, ...pos } : m) }));
      }
    };
    const onUp = () => {
      if (drawingRef.current) {
        drawingRef.current = false;
        const stroke = activeStrokeRef.current;
        activeStrokeRef.current = [];
        lastPointRef.current = null;
        if (stroke.length > 1) {
          // Commit stroke to state (single update, triggers canvas re-render)
          setStrokesBySlide(s => ({ ...s, [currentIdxRef.current]: [...(s[currentIdxRef.current] || []), stroke] }));
        }
        setActiveStroke([]); // clear any residual state
      }
      draggingMarkerRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drawActiveSegment]);

  // Render canvas — only re-renders when committed strokes change (NOT during active drawing)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = contentAreaRef.current;
    if (!canvas || !container) return;
    const render = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width; canvas.height = rect.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = t.accent;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.shadowBlur = 6; ctx.shadowColor = t.accent + "66";
      for (const stroke of penStrokes) {
        if (stroke.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
        for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x * canvas.width, stroke[i].y * canvas.height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    render();
    // ResizeObserver kept stable — only depends on container size, not stroke data
    const ro = new ResizeObserver(render);
    ro.observe(container);
    return () => ro.disconnect();
  }, [strokesBySlide, currentIdx, t]); // removed activeStroke — drawing uses ref now

  if (loading && !selectedDir) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400 text-sm gap-2">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading...
      </div>
    );
  }

  // ── No directory selected ──
  if (!selectedDir) {
    return (
      <div className="flex flex-col h-full" style={{ backgroundColor: t.accentBg }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{ borderColor: t.accentBorder }}>
          <span className="text-lg">🎤</span>
          <span className="text-sm font-bold" style={{ color: t.accentText }}>{tt("briefing.title", tt("sidebar.briefingPlayer"))}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🎤</div>
            <h2 className="text-lg font-bold text-stone-700 mb-1">{tt("briefing.title", tt("sidebar.briefingPlayer"))}</h2>
            <p className="text-sm text-stone-400">選擇一個簡報目錄開始播放</p>
          </div>
          {briefingDirs.length > 0 && (
            <div className="w-full max-w-md space-y-1.5 mb-4">
              {briefingDirs.map(d => (
                <button
                  key={d.path}
                  onClick={() => { resetAllAnnotations(); setSelectedDir(d.path); loadSlides(d.path); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:shadow-md text-left bg-white"
                  style={{ borderColor: t.accentBorder }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = t.accentBorder; }}
                >
                  <span className="text-xl">📂</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-stone-700 truncate">{d.name}</div>
                    <div className="text-[10px] text-stone-400 truncate font-mono">{d.path}</div>
                  </div>
                  <span className="text-stone-300">▶</span>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => { setShowDirPicker(true); browseForPicker(""); }}
            className="text-sm px-4 py-2 rounded-lg border border-dashed transition-colors"
            style={{ borderColor: t.accentBorder, color: t.accent }}
          >
            📁 瀏覽其他目錄...
          </button>
          {briefingDirs.length === 0 && (
            <div className="mt-8 text-center text-xs text-stone-400 max-w-md">
              <p className="mb-1">💡 將圖片和 markdown 放在同一個目錄中：</p>
              <pre className="text-left bg-stone-100 rounded-lg p-3 text-[10px] font-mono text-stone-500">
{`my-briefing/
├── 01-intro.png
├── 01-intro.md
├── 02-demo.png
├── 02-demo.md
└── notes.md (optional)`}
              </pre>
            </div>
          )}
          {showDirPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowDirPicker(false)}>
              <div className="bg-white rounded-2xl shadow-2xl border flex flex-col" style={{ borderColor: t.accentBorder, width: "min(500px, 90vw)", maxHeight: "70vh" }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b rounded-t-2xl" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                  <h3 className="text-sm font-bold" style={{ color: t.accentText }}>📁 選擇簡報目錄</h3>
                  <button onClick={() => setShowDirPicker(false)} className="text-stone-400 hover:text-stone-600 text-lg">✕</button>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: t.accentBorder + "40" }}>
                  <button onClick={() => browseParent && browseForPicker(browseParent)} disabled={!browseParent} className="px-2 py-1 rounded border text-sm disabled:opacity-30" style={{ borderColor: t.accentBorder, color: t.accent }}>↩</button>
                  <div className="flex-1 text-xs font-mono text-stone-500 truncate px-2 py-1 rounded border" style={{ borderColor: t.accentBorder + "40" }}>{browsePath || "/"}</div>
                </div>
                <div className="flex-1 overflow-y-auto min-h-[200px]">
                  {browseDirs.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 text-sm">沒有子目錄</div>
                  ) : (
                    browseDirs.filter(d => !d.name.startsWith(".")).map(d => (
                      <button key={d.path} onClick={() => browseForPicker(d.path)} onDoubleClick={() => { resetAllAnnotations(); setSelectedDir(d.path); loadSlides(d.path); setShowDirPicker(false); }} className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors">
                        <span>📁</span><span className="text-stone-700">{d.name}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="flex items-center justify-between px-5 py-3 border-t rounded-b-2xl" style={{ borderColor: t.accentBorder + "40", backgroundColor: t.accentBg + "40" }}>
                  <span className="text-xs text-stone-400">雙擊目錄確認</span>
                  <div className="flex gap-2">
                    <button onClick={() => setShowDirPicker(false)} className="px-3 py-1.5 text-sm rounded border" style={{ borderColor: t.accentBorder, color: t.accentText }}>{tt("common.cancel")}</button>
                    <button onClick={() => { if (browsePath) { resetAllAnnotations(); setSelectedDir(browsePath); loadSlides(browsePath); setShowDirPicker(false); } }} className="px-4 py-1.5 text-sm font-bold text-white rounded" style={{ backgroundColor: t.accent }}>選擇此目錄</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Overview mode ──
  if (overviewMode) {
    return (
      <div className="flex flex-col h-full" style={{ backgroundColor: t.accentBg }} ref={containerRef}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0" style={{ borderColor: t.accentBorder }}>
          <span className="text-sm font-medium" style={{ color: t.accentText }}>📊 Overview — {slides.length} slides</span>
          <button onClick={() => setOverviewMode(false)} className="text-xs px-3 py-1 rounded border transition-colors" style={{ borderColor: t.accentBorder, color: t.accentText }}>Esc 返回</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {slides.map((slide, idx) => (
              <button key={slide.id} onClick={() => { setCurrentIdx(idx); setOverviewMode(false); }} className="group relative rounded-lg overflow-hidden border bg-white transition-all hover:scale-[1.02]" style={{ borderColor: t.accentBorder, aspectRatio: "16/10" }}>
                {slide.image ? (
                  <img src={`${API}/api/fs/file?path=${encodeURIComponent(slide.image)}`} alt={slide.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-stone-100">
                    <span className="text-xs text-stone-400 px-2 text-center truncate">{slide.name}</span>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/60 to-transparent">
                  <span className="text-[10px] text-white/90 font-mono">{String(idx + 1).padStart(2, "0")} {slide.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const slide = slides[currentIdx];

  // ── Empty state ──
  if (slides.length === 0) {
    return (
      <div className="flex flex-col h-full" style={{ backgroundColor: t.accentBg }}>
        <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b" style={{ borderColor: t.accentBorder }}>
          <button onClick={() => { resetAllAnnotations(); setSelectedDir(""); setSlides([]); }} className="text-xs px-2.5 py-1 rounded text-stone-500 hover:text-stone-800 hover:bg-stone-200/50 transition-colors">← {tt("briefing.changeDir", "切換目錄")}</button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-4xl mb-3 opacity-30">📭</div>
          <p className="text-stone-400 text-sm mb-1">此目錄沒有可播放的簡報</p>
          <p className="text-stone-300 text-xs">需要圖片或 Markdown 檔案</p>
        </div>
      </div>
    );
  }

  // ── Main slide view ──
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: t.accentBg }} ref={containerRef}>
      {/* Top bar */}
      <div className="briefing-topbar flex items-center justify-between px-3 py-2 shrink-0 bg-white border-b" style={{ borderColor: t.accentBorder }}>
        <div className="flex items-center gap-2">
          <button onClick={() => { resetAllAnnotations(); setSelectedDir(""); setSlides([]); }} className="text-xs px-2.5 py-1 rounded text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors">← {tt("briefing.changeDir", "切換目錄")}</button>
          <span className="text-[10px] text-stone-300">|</span>
          <span className="text-xs text-stone-500 font-medium truncate max-w-[300px]">📂 {selectedDir.split("/").pop()}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrentIdx(i => Math.max(i - 1, 0))} disabled={currentIdx === 0} className="px-2 py-1 rounded text-stone-500 hover:text-stone-800 hover:bg-stone-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-sm">←</button>
          <span className="text-xs text-stone-500 font-mono px-2">{currentIdx + 1} / {slides.length}</span>
          <button onClick={() => setCurrentIdx(i => Math.min(i + 1, slides.length - 1))} disabled={currentIdx === slides.length - 1} className="px-2 py-1 rounded text-stone-500 hover:text-stone-800 hover:bg-stone-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-sm">→</button>
          <span className="text-[10px] text-stone-300 mx-1">|</span>
          <button onClick={() => setOverviewMode(true)} className={`px-2 py-1 rounded text-xs transition-colors ${overviewMode ? "text-white" : "text-stone-500 hover:text-stone-800 hover:bg-stone-100"}`} style={overviewMode ? { background: t.accent } : {}} title="Overview (O)">📊</button>
          <button onClick={() => setShowNotes(v => !v)} className={`px-2 py-1 rounded text-xs transition-colors ${showNotes ? "text-white" : "text-stone-500 hover:text-stone-800 hover:bg-stone-100"}`} style={showNotes ? { background: t.accent } : {}} title="Notes (N)">📝</button>
          <button onClick={() => { if (!fullscreen) { containerRef.current?.requestFullscreen?.(); } else { document.exitFullscreen?.(); } }} className="px-2 py-1 rounded text-xs text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors" title="Fullscreen (F)">{fullscreen ? "🗗" : "⛶"}</button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-stone-200 shrink-0">
        <div className="h-full transition-all duration-300" style={{ width: `${slides.length > 0 ? ((currentIdx + 1) / slides.length) * 100 : 0}%`, backgroundColor: t.accent }} />
      </div>

      {/* Main content */}
      <div
        ref={contentAreaRef}
        className="flex-1 flex overflow-hidden relative group"
        style={{ cursor: drawMode === "pen" ? PENCIL_CURSOR : drawMode === "marker" ? "copy" : "default" }}
        onMouseDown={drawMode !== "none" ? handleContentMouseDown : undefined}
      >
        {imageUrl && (
          <div className="flex items-center justify-center overflow-hidden p-3" style={{ flex: imageUrl && slide?.markdown && (parsedMd.content || mdLoading) ? "0 0 62%" : "1 1 auto" }}>
            <img src={imageUrl} alt={slide?.name} className="max-w-full max-h-full object-contain rounded-lg shadow-xl bg-white" />
          </div>
        )}

        {/* Markdown content — only render if slide has markdown */}
        {slide?.markdown && (parsedMd.content || mdLoading) && (
          <div
            className="overflow-y-auto bg-gradient-to-b from-white to-stone-50/50"
            style={{
              flex: imageUrl ? "1 1 38%" : "1 1 auto",
              scrollbarWidth: "thin",
              borderLeft: imageUrl ? `1px solid ${t.accentBorder}60` : "none",
              maxWidth: imageUrl ? undefined : "760px",
              margin: imageUrl ? undefined : "0 auto",
            }}
          >
            <div
              className="flex flex-col justify-center min-h-full px-6 py-6"
            >
            {mdLoading ? (
              <div className="flex items-center justify-center py-4 text-stone-400 text-xs gap-1.5">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading content...
              </div>
            ) : parsedMd.content ? (
              <div className="text-stone-700">{renderMarkdown(parsedMd.content, t)}</div>
            ) : (
              <div className="flex items-center justify-center py-8"><span className="text-stone-300 text-sm">No content</span></div>
            )}
            </div>
          </div>
        )}

        {/* Notes sidebar */}
        {showNotes && notesContent && (
          <div className="border-l overflow-y-auto px-4 py-3 shrink-0" style={{ borderColor: t.accentBorder, width: "260px", scrollbarWidth: "thin", backgroundColor: t.accentBg }}>
            <div className="text-[10px] mb-2 uppercase tracking-wide" style={{ color: t.accentText }}>📝 Speaker Notes</div>
            <div className="text-xs text-stone-600 leading-relaxed whitespace-pre-wrap">{notesContent}</div>
          </div>
        )}

        {/* Canvas overlay */}
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-30" />

        {/* Markers */}
        {markers.map((m, i) => (
          <div
            key={i}
            className="absolute z-30 select-none"
            style={{
              left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: "translate(-50%, -50%)",
              fontSize: m.icon === "🤖" ? 36 : 28, cursor: "grab",
              animation: "briefing-pulse 1.5s ease-in-out infinite",
              filter: m.icon === "🤖"
                ? `drop-shadow(0 0 10px ${t.accent}aa) drop-shadow(0 0 4px ${t.accent}66)`
                : "drop-shadow(0 0 6px rgba(0,0,0,0.2))",
              pointerEvents: "auto",
            }}
            onMouseDown={(e) => handleMarkerMouseDown(e, i)}
            onDoubleClick={(e) => { e.stopPropagation(); setMarkersBySlide(prev => ({ ...prev, [currentIdx]: (prev[currentIdx] || []).filter((_, idx) => idx !== i) })); }}
            title={tt("briefing.dragMove")}
          >
            {m.icon}
            {m.icon === "🤖" && (
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: t.accentBg, border: `1px solid ${t.accentBorder}`, color: t.accentText }}>AI can help</div>
            )}
          </div>
        ))}

        {/* Floating toolbar */}
        <div data-annotation-ui className="absolute z-40" style={{ bottom: 12, left: "50%", transform: "translateX(-50%)" }}>
          <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-xl bg-white border shadow-lg" style={{ borderColor: t.accentBorder }}>
            <button onClick={() => toggleMode("pen")} className="px-2.5 py-1.5 rounded-lg text-sm transition-all" style={{ background: drawMode === "pen" ? t.accentBg : "transparent" }} title={tt("briefing.penTool")}>✏️</button>
            <span className="text-stone-200 text-xs mx-0.5">|</span>
            {[
              { icon: "💡", label: "重點" }, { icon: "⭐", label: "重要" }, { icon: "❗", label: "注意" },
              { icon: "👈", label: "看這" }, { icon: "✅", label: tt("common.confirm") }, { icon: "🤖", label: tt("appBuilder.ai") },
            ].map(({ icon, label }) => {
              const isActive = drawMode === "marker" && selectedIcon === icon;
              return (
                <button key={icon} onClick={() => { setSelectedIcon(icon); toggleMode("marker"); }} className="px-2 py-1.5 rounded-lg text-sm transition-all" style={{ background: isActive ? t.accentBg : "transparent", filter: isActive ? "none" : "grayscale(0.5) opacity(0.6)" }} title={`${label} (H)`}>{icon}</button>
              );
            })}
            <span className="text-stone-200 text-xs mx-0.5">|</span>
            <button onClick={clearAnnotations} className="px-2.5 py-1.5 rounded-lg text-sm text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-all" title={tt("briefing.clearAnnotations")}>🗑️</button>
          </div>
        </div>

        {/* Mode indicator */}
        {drawMode !== "none" && (
          <div data-annotation-ui className="absolute z-40" style={{ top: 8, left: "50%", transform: "translateX(-50%)" }}>
            <div className="px-3 py-1 rounded-full text-xs" style={{ background: t.accentBg, border: `1px solid ${t.accentBorder}`, color: t.accentText }}>
              {drawMode === "pen" ? tt("briefing.penMode") : `📍 標記模式 (${selectedIcon})`}
            </div>
          </div>
        )}

        {/* File refs dropdown — bottom-left floating button */}
        {parsedMd.fileRefs.length > 0 && (
          <div data-annotation-ui className="absolute z-40" style={{ bottom: 12, left: 12 }}>
            <div className="relative">
              <button
                onClick={() => setShowFileDropdown(v => !v)}
                className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border shadow-lg transition-all hover:shadow-md"
                style={{ borderColor: showFileDropdown ? t.accent : t.accentBorder }}
                title={tt("briefing.referenceFiles")}
              >
                <span className="text-sm">📎</span>
                <span className="text-xs font-medium" style={{ color: t.accentText }}>附件</span>
                <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1" style={{ background: t.accent }}>{parsedMd.fileRefs.length}</span>
              </button>
              {showFileDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowFileDropdown(false)} />
                  <div
                    className="absolute bottom-full mb-2 left-0 z-50 rounded-xl border shadow-xl bg-white py-1 min-w-[240px] max-h-[300px] overflow-y-auto"
                    style={{ borderColor: t.accentBorder, scrollbarWidth: "thin" }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400 border-b sticky top-0 bg-white" style={{ borderColor: t.accentBorder + "40" }}>
                      📎 參考檔案 ({parsedMd.fileRefs.length})
                    </div>
                    {parsedMd.fileRefs.map(refPath => {
                      const fname = pathBasename(refPath);
                      const isActive = refOverlay === refPath;
                      return (
                        <button
                          key={refPath}
                          onClick={() => { setRefOverlay(isActive ? null : refPath); setShowFileDropdown(false); }}
                          className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-stone-50 transition-colors"
                          style={isActive ? { background: t.accentBg, color: t.accentText } : { color: "#57534E" }}
                          title={refPath}
                        >
                          <span className="shrink-0">📄</span>
                          <span className="font-mono truncate flex-1">{fname}</span>
                          {isActive && <span className="shrink-0 text-[9px]">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Side click zones for prev/next — no icon, just hover highlight */}
        {currentIdx > 0 && (
          <button onClick={() => setCurrentIdx(i => i - 1)} className="absolute left-0 top-0 bottom-0 z-20 w-16 hover:bg-black/5 transition-all cursor-pointer" title={tt("briefing.prevPage")} />
        )}
        {currentIdx < slides.length - 1 && (
          <button onClick={() => setCurrentIdx(i => i + 1)} className="absolute right-0 top-0 bottom-0 z-20 w-16 hover:bg-black/5 transition-all cursor-pointer" title={tt("briefing.nextPage")} />
        )}
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 bg-white border-t" style={{ borderColor: t.accentBorder }}>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-stone-300">← → 翻頁</span>
          <span className="text-[10px] text-stone-300">O 概覽</span>
          <span className="text-[10px] text-stone-300">N 備忘</span>
          <span className="text-[10px] text-stone-300">F 全螢幕</span>
          <span className="text-[10px] text-stone-300">D 手繪</span>
          <span className="text-[10px] text-stone-300">H 標記</span>
          <span className="text-[10px] text-stone-300">E 清除</span>
        </div>
      </div>

      {refOverlay && <RefOverlay refPath={refOverlay} onClose={() => setRefOverlay(null)} theme={t} />}
    </div>
  );
}
