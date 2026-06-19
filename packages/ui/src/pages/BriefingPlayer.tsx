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
  `;
  document.head.appendChild(style);
}

// ── Types ──
interface Slide {
  id: string;
  name: string;
  image: string | null;     // image path (relative or absolute)
  markdown: string | null;  // markdown path
  sortKey: string;          // for ordering
}

interface BriefingDir {
  path: string;
  name: string;
}

// ── Parse @file: references from markdown ──
// ── Parse markdown into content + file references ──
// Schema: markdown above first `---` separator is slide content.
//         Below `---` (or @file: lines) are reference files.
interface ParsedMarkdown {
  content: string;     // slide content (no @file lines)
  fileRefs: string[];  // resolved file paths
}

function parseMarkdown(rawText: string, mdDir: string): ParsedMarkdown {
  // Split on first standalone `---` line
  const separatorIdx = rawText.indexOf("\n---\n");
  let contentPart = rawText;
  let refsPart = "";

  if (separatorIdx >= 0) {
    contentPart = rawText.slice(0, separatorIdx).trim();
    refsPart = rawText.slice(separatorIdx + 5).trim(); // skip \n---\n
  }

  // Extract @file: refs from both parts (support inline @file too)
  const allRefs: string[] = [];
  const refRegex = /@file:\s*(.+)/g;
  let match;
  while ((match = refRegex.exec(contentPart)) !== null) {
    let p = match[1].trim();
    if (!p.startsWith("/")) p = mdDir + "/" + p;
    allRefs.push(p);
  }
  // Remove @file lines from content
  contentPart = contentPart.replace(/@file:\s*.+/g, "").trim();

  while ((match = refRegex.exec(refsPart)) !== null) {
    let p = match[1].trim();
    if (!p.startsWith("/")) p = mdDir + "/" + p;
    allRefs.push(p);
  }

  return { content: contentPart, fileRefs: allRefs };
}

// ── Simple markdown renderer (dark theme for briefing player) ──
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let tableRows: string[] = [];

  // Flush table helper
  const flushTable = () => {
    if (tableRows.length === 0) return;
    // Filter out separator rows
    const dataRows = tableRows.filter(r => !r.includes("|---") && !r.includes("|:--"));
    if (dataRows.length === 0) { tableRows = []; return; }

    // Parse cells
    const parseRow = (row: string) =>
      row.split("|").slice(1, -1).map(c => c.trim());

    const headerCells = parseRow(dataRows[0]);
    const bodyRows = dataRows.slice(1).map(parseRow);

    elements.push(
      <div key={`table-${elements.length}`} className="my-2 overflow-x-auto">
        <table className="w-full text-xs border-collapse" style={{ minWidth: "300px" }}>
          <thead>
            <tr>
              {headerCells.map((cell, ci) => (
                <th key={ci} className="px-3 py-1.5 text-left font-semibold text-white/90 border-b border-white/20 whitespace-nowrap">
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri} className="hover:bg-white/5 transition-colors">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-white/60 border-b border-white/8">
                    {renderInline(cell)}
                  </td>
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
    // Code block
    if (line.trim().startsWith("```")) {
      if (tableRows.length) flushTable();
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} className="bg-black/40 text-stone-100 rounded-lg p-3 my-2 overflow-x-auto text-xs border border-white/10">
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    // Table rows — collect consecutive | lines
    if (line.trim().startsWith("|")) {
      tableRows.push(line.trim());
      return;
    } else if (tableRows.length > 0) {
      flushTable();
    }

    // Headings
    if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="text-xl font-bold text-white mt-3 mb-1.5">{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="text-lg font-bold text-white/90 mt-2.5 mb-1">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="text-base font-semibold text-white/80 mt-2 mb-1">{line.slice(4)}</h3>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex items-start gap-1.5 ml-2 my-0.5">
          <span className="text-white/40 mt-0.5">•</span>
          <span className="text-sm text-white/70">{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-sm text-white/70 leading-relaxed my-0.5">{renderInline(line)}</p>);
    }
  });

  // Flush remaining
  if (tableRows.length > 0) flushTable();

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre key="code-final" className="bg-black/40 text-stone-100 rounded-lg p-3 my-2 overflow-x-auto text-xs border border-white/10">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }

  return <div>{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  // Bold **text** and inline code `text`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-white/90">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="px-1 py-0.5 rounded bg-white/10 text-white/80 text-xs font-mono">{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

// ── Full-screen Reference Overlay ──
function RefOverlay({ refPath, onClose }: { refPath: string; onClose: () => void }) {
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

  const fileName = refPath.split("/").pop() || refPath;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">📄</span>
          <span className="text-sm font-mono text-white/80">{fileName}</span>
          <span className="text-[10px] text-white/30 uppercase px-1.5 py-0.5 rounded bg-white/5">{ext}</span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          ✕ 關閉 (Esc)
        </button>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-auto"
        style={{ scrollbarWidth: "thin" }}
        onClick={e => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-white/40 text-sm gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-rose-400 text-sm">❌ {error}</div>
        ) : (
          <pre className="p-6 text-sm font-mono text-stone-100 leading-relaxed" style={{ maxWidth: "1100px", margin: "0 auto" }}>
            <code>{content}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Main BriefingPlayer Component ──
export default function BriefingPlayer() {
  const { info: t } = useTheme();
  const { t: tt } = useI18n();

  const [briefingDirs, setBriefingDirs] = useState<BriefingDir[]>([]);
  const [selectedDir, setSelectedDir] = useState<string>("");
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

  // ── Drawing / Annotation ──
  type DrawMode = "none" | "pen" | "marker";
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [penStrokes, setPenStrokes] = useState<{ x: number; y: number }[][]>([]);
  const [activeStroke, setActiveStroke] = useState<{ x: number; y: number }[]>([]);
  const [markers, setMarkers] = useState<{ x: number; y: number; icon: string }[]>([]);
  const [selectedIcon, setSelectedIcon] = useState("💡");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Discover briefing directories under data/briefings ──
  const loadBriefingDirs = useCallback(async () => {
    try {
      const rootResp = await fetch(`${API}/api/paaw-root`);
      const rootData = await rootResp.json();
      const briefingsRoot = `${rootData.paawRoot}/data/briefings`;

      const resp = await fetch(`${API}/api/fs/browse?path=${encodeURIComponent(briefingsRoot)}`);
      if (!resp.ok) {
        setBriefingDirs([]);
        return;
      }
      const data = await resp.json();
      const dirs: BriefingDir[] = (data.directories || []).map((d: any) => ({
        path: d.path,
        name: d.name,
      }));
      setBriefingDirs(dirs);
    } catch {
      setBriefingDirs([]);
    }
  }, []);

  useEffect(() => { loadBriefingDirs(); }, [loadBriefingDirs]);

  // ── Load slides from selected directory ──
  const loadSlides = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const resp = await fetch(`${API}/api/fs/tree?root=${encodeURIComponent(dirPath)}`);
      const tree = await resp.json();

      const fileMap = new Map<string, string>(); // basename → full path
      const collect = (node: any) => {
        if (node.type === "file") {
          fileMap.set(node.name, node.path);
        }
        (node.children || []).forEach(collect);
      };
      collect(tree);

      // Pair images with markdown by basename
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
    } catch {
      setSlides([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load markdown content for current slide ──
  useEffect(() => {
    const slide = slides[currentIdx];
    if (!slide?.markdown) {
      setParsedMd({ content: "", fileRefs: [] });
      return;
    }
    let cancelled = false;
    setMdLoading(true);
    fetch(`${API}/api/fs/file?path=${encodeURIComponent(slide.markdown)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const text = data.content || "";
        const mdDir = slide.markdown.substring(0, slide.markdown.lastIndexOf("/"));
        setParsedMd(parseMarkdown(text, mdDir));
      })
      .catch(() => { if (!cancelled) setParsedMd({ content: "", fileRefs: [] }); })
      .finally(() => { if (!cancelled) setMdLoading(false); });
    return () => { cancelled = true; };
  }, [currentIdx, slides]);

  // ── Load notes.md if exists ──
  useEffect(() => {
    if (!selectedDir) { setNotesContent(""); return; }
    const notesPath = `${selectedDir}/notes.md`;
    fetch(`${API}/api/fs/file?path=${encodeURIComponent(notesPath)}`)
      .then(r => { if (r.ok) return r.json(); throw new Error("no notes"); })
      .then(data => setNotesContent(data.content || ""))
      .catch(() => setNotesContent(""));
  }, [selectedDir]);

  // ── Image URL ──
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
        case "ArrowRight":
        case " ":
        case "PageDown":
          e.preventDefault();
          if (overviewMode) { setOverviewMode(false); return; }
          setCurrentIdx(i => Math.min(i + 1, slides.length - 1));
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          if (overviewMode) { setOverviewMode(false); return; }
          setCurrentIdx(i => Math.max(i - 1, 0));
          break;
        case "o":
        case "O":
          e.preventDefault();
          setOverviewMode(v => !v);
          break;
        case "n":
        case "N":
          e.preventDefault();
          setShowNotes(v => !v);
          break;
        case "f":
        case "F":
          e.preventDefault();
          if (!fullscreen) {
            containerRef.current?.requestFullscreen?.();
            setFullscreen(true);
          } else {
            document.exitFullscreen?.();
            setFullscreen(false);
          }
          break;
        case "d":
        case "D":
          e.preventDefault();
          toggleMode("pen");
          break;
        case "h":
        case "H":
          e.preventDefault();
          toggleMode("marker");
          break;
        case "e":
        case "E":
          e.preventDefault();
          clearAnnotations();
          break;
        case "Escape":
          if (drawMode !== "none") { setDrawMode("none"); setActiveStroke([]); break; }
          if (overviewMode) setOverviewMode(false);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [slides.length, overviewMode, fullscreen, drawMode]);

  // ── Fullscreen change listener ──
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ── Browse directories for picker ──
  const [browsePath, setBrowsePath] = useState("");
  const [browseDirs, setBrowseDirs] = useState<any[]>([]);
  const [browseParent, setBrowseParent] = useState<string | null>(null);

  const browseForPicker = useCallback((path: string) => {
    fetch(`${API}/api/fs/browse?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => {
        setBrowsePath(data.currentPath);
        setBrowseParent(data.parent || null);
        setBrowseDirs(data.directories || []);
      })
      .catch(() => {});
  }, []);

  // ── Drawing helpers ──
  const drawingRef = useRef(false);  // pen active tracking
  const draggingMarkerRef = useRef<number | null>(null);  // which marker is being dragged

  const getRelPos = (clientX: number, clientY: number) => {
    const el = contentAreaRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const clearAnnotations = useCallback(() => {
    setPenStrokes([]);
    setMarkers([]);
    setActiveStroke([]);
    drawingRef.current = false;
  }, []);

  const toggleMode = useCallback((mode: "pen" | "marker") => {
    setDrawMode(prev => prev === mode ? "none" : mode);
    setActiveStroke([]);
    drawingRef.current = false;
  }, []);

  // ── Content area mousedown: start pen or place marker ──
  const handleContentMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;

    // Don't draw/place if clicking on toolbar or marker elements
    const target = e.target as HTMLElement;
    if (target.closest('[data-annotation-ui]')) return;

    if (drawMode === "pen") {
      e.preventDefault();
      drawingRef.current = true;
      const pos = getRelPos(e.clientX, e.clientY);
      setActiveStroke([pos]);
    } else if (drawMode === "marker") {
      e.preventDefault();
      const pos = getRelPos(e.clientX, e.clientY);
      setMarkers(prev => [...prev, { ...pos, icon: selectedIcon }]);
    }
  };

  // ── Marker: click to place, drag existing to move ──
  const handleMarkerMouseDown = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    draggingMarkerRef.current = idx;
  };

  // Global mousemove/up for pen drawing AND marker dragging
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Pen drawing
      if (drawingRef.current) {
        const pos = getRelPos(e.clientX, e.clientY);
        setActiveStroke(prev => [...prev, pos]);
        return;
      }
      // Marker dragging
      if (draggingMarkerRef.current !== null) {
        e.preventDefault();
        const pos = getRelPos(e.clientX, e.clientY);
        setMarkers(prev => prev.map((m, i) => i === draggingMarkerRef.current ? { ...m, ...pos } : m));
      }
    };
    const onUp = () => {
      // Finish pen stroke
      if (drawingRef.current) {
        drawingRef.current = false;
        setActiveStroke(prev => {
          if (prev.length > 1) {
            const stroke = prev;
            queueMicrotask(() => setPenStrokes(s => [...s, stroke]));
          }
          return [];
        });
      }
      // Finish marker drag
      draggingMarkerRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Clear annotations on slide change
  useEffect(() => { clearAnnotations(); }, [currentIdx, clearAnnotations]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = contentAreaRef.current;
    if (!canvas || !container) return;

    const render = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "rgba(250, 204, 21, 0.85)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowBlur = 6;
      ctx.shadowColor = "rgba(250, 204, 21, 0.4)";

      const allStrokes = [...penStrokes];
      if (activeStroke.length > 0) allStrokes.push(activeStroke);
      for (const stroke of allStrokes) {
        if (stroke.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
        for (let i = 1; i < stroke.length; i++) {
          ctx.lineTo(stroke[i].x * canvas.width, stroke[i].y * canvas.height);
        }
        ctx.stroke();
      }
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(container);
    return () => ro.disconnect();
  }, [penStrokes, activeStroke]);
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

  // ── No directory selected: show selection screen ──
  if (!selectedDir) {
    return (
      <div className="flex flex-col h-full" style={{ backgroundColor: "#fafaf9" }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{ borderColor: t.accentBorder }}>
          <span className="text-lg">🎤</span>
          <span className="text-sm font-bold" style={{ color: t.accentText }}>{tt("briefing.title", "Briefing Player")}</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🎤</div>
            <h2 className="text-lg font-bold text-stone-700 mb-1">{tt("briefing.title", "Briefing Player")}</h2>
            <p className="text-sm text-stone-400">選擇一個簡報目錄開始播放</p>
          </div>

          {/* Known briefing dirs */}
          {briefingDirs.length > 0 && (
            <div className="w-full max-w-md space-y-1.5 mb-4">
              {briefingDirs.map(d => (
                <button
                  key={d.path}
                  onClick={() => { setSelectedDir(d.path); loadSlides(d.path); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:shadow-md text-left"
                  style={{ borderColor: t.accentBorder, backgroundColor: "#fff" }}
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

          {/* Browse filesystem */}
          <button
            onClick={() => { setShowDirPicker(true); browseForPicker(""); }}
            className="text-sm px-4 py-2 rounded-lg border border-dashed transition-colors"
            style={{ borderColor: t.accentBorder, color: t.accent }}
          >
            📁 瀏覽其他目錄...
          </button>

          {/* Empty state hint */}
          {briefingDirs.length === 0 && (
            <div className="mt-8 text-center text-xs text-stone-400 max-w-md">
              <p className="mb-1">💡 將圖片和 markdown 放在同一個目錄中：</p>
              <pre className="text-left bg-stone-100 rounded-lg p-3 text-[10px] font-mono text-stone-500">
{`my-briefing/
├── 01-intro.png
├── 01-intro.md
├── 02-demo.png
├── 02-demo.md
└── notes.md (optional)

Markdown 格式:
  # 標題
  簡報內容...

  ---

  @file: ../src/code.js
  @file: ../docs/api.md`}
              </pre>
            </div>
          )}

          {/* Directory Picker Modal */}
          {showDirPicker && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
              onClick={() => setShowDirPicker(false)}
            >
              <div
                className="bg-white rounded-2xl shadow-2xl border flex flex-col"
                style={{ borderColor: t.accentBorder, width: "min(500px, 90vw)", maxHeight: "70vh" }}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-3 border-b rounded-t-2xl" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                  <h3 className="text-sm font-bold" style={{ color: t.accentText }}>📁 選擇簡報目錄</h3>
                  <button onClick={() => setShowDirPicker(false)} className="text-stone-400 hover:text-stone-600 text-lg">✕</button>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: t.accentBorder + "40" }}>
                  <button
                    onClick={() => browseParent && browseForPicker(browseParent)}
                    disabled={!browseParent}
                    className="px-2 py-1 rounded border text-sm disabled:opacity-30"
                    style={{ borderColor: t.accentBorder, color: t.accent }}
                  >↩</button>
                  <div className="flex-1 text-xs font-mono text-stone-500 truncate px-2 py-1 rounded border" style={{ borderColor: t.accentBorder + "40" }}>
                    {browsePath || "/"}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto min-h-[200px]">
                  {browseDirs.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 text-sm">沒有子目錄</div>
                  ) : (
                    browseDirs.filter(d => !d.name.startsWith(".")).map(d => (
                      <button
                        key={d.path}
                        onClick={() => browseForPicker(d.path)}
                        onDoubleClick={() => { setSelectedDir(d.path); loadSlides(d.path); setShowDirPicker(false); }}
                        className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors"
                      >
                        <span>📁</span>
                        <span className="text-stone-700">{d.name}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="flex items-center justify-between px-5 py-3 border-t rounded-b-2xl" style={{ borderColor: t.accentBorder + "40", backgroundColor: t.accentBg + "40" }}>
                  <span className="text-xs text-stone-400">雙擊目錄確認</span>
                  <div className="flex gap-2">
                    <button onClick={() => setShowDirPicker(false)} className="px-3 py-1.5 text-sm rounded border" style={{ borderColor: t.accentBorder, color: t.accentText }}>取消</button>
                    <button
                      onClick={() => { if (browsePath) { setSelectedDir(browsePath); loadSlides(browsePath); setShowDirPicker(false); } }}
                      className="px-4 py-1.5 text-sm font-bold text-white rounded"
                      style={{ backgroundColor: t.accent }}
                    >選擇此目錄</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Overview mode (grid) ──
  if (overviewMode) {
    return (
      <div className="flex flex-col h-full" style={{ backgroundColor: "#0a0a0a" }} ref={containerRef}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 shrink-0">
          <span className="text-sm text-white/80 font-medium">
            📊 Overview — {slides.length} slides
          </span>
          <button
            onClick={() => setOverviewMode(false)}
            className="text-xs px-3 py-1 rounded border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
          >
            Esc 返回
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {slides.map((slide, idx) => (
              <button
                key={slide.id}
                onClick={() => { setCurrentIdx(idx); setOverviewMode(false); }}
                className="group relative rounded-lg overflow-hidden border border-white/10 hover:border-white/30 transition-all hover:scale-[1.02]"
                style={{ aspectRatio: "16/10" }}
              >
                {slide.image ? (
                  <img src={`${API}/api/fs/file?path=${encodeURIComponent(slide.image)}`} alt={slide.name}
                    className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-stone-800">
                    <span className="text-xs text-white/40 px-2 text-center truncate">{slide.name}</span>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent">
                  <span className="text-[10px] text-white/80 font-mono">{String(idx + 1).padStart(2, "0")} {slide.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Slide view ──
  const slide = slides[currentIdx];

  // Empty state: directory selected but no slides found
  if (slides.length === 0) {
    return (
      <div className="flex flex-col h-full" style={{ backgroundColor: "#1a1a1a" }}>
        <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
          <button
            onClick={() => { setSelectedDir(""); setSlides([]); }}
            className="text-xs px-2.5 py-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            ← {tt("briefing.changeDir", "切換目錄")}
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-4xl mb-3 opacity-30">📭</div>
          <p className="text-white/40 text-sm mb-1">此目錄沒有可播放的簡報</p>
          <p className="text-white/20 text-xs">需要圖片 (.png/.jpg/.jpeg/.gif/.webp/.svg) 或 Markdown (.md) 檔案</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: fullscreen ? "#0a0a0a" : "#1a1a1a" }} ref={containerRef}>
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectedDir(""); setSlides([]); }}
            className="text-xs px-2.5 py-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            ← {tt("briefing.changeDir", "切換目錄")}
          </button>
          <span className="text-[10px] text-white/30">|</span>
          <span className="text-xs text-white/50 font-medium truncate max-w-[300px]">
            📂 {selectedDir.split("/").pop()}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentIdx(i => Math.max(i - 1, 0))}
            disabled={currentIdx === 0}
            className="px-2 py-1 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-sm"
          >←</button>
          <span className="text-xs text-white/50 font-mono px-2">
            {currentIdx + 1} / {slides.length}
          </span>
          <button
            onClick={() => setCurrentIdx(i => Math.min(i + 1, slides.length - 1))}
            disabled={currentIdx === slides.length - 1}
            className="px-2 py-1 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-sm"
          >→</button>

          <span className="text-[10px] text-white/30 mx-1">|</span>

          <button
            onClick={() => setOverviewMode(true)}
            className={`px-2 py-1 rounded text-xs transition-colors ${overviewMode ? "bg-white/20 text-white" : "text-white/50 hover:text-white hover:bg-white/10"}`}
            title="Overview (O)"
          >📊</button>
          <button
            onClick={() => setShowNotes(v => !v)}
            className={`px-2 py-1 rounded text-xs transition-colors ${showNotes ? "bg-white/20 text-white" : "text-white/50 hover:text-white hover:bg-white/10"}`}
            title="Notes (N)"
          >📝</button>
          <button
            onClick={() => {
              if (!fullscreen) { containerRef.current?.requestFullscreen?.(); }
              else { document.exitFullscreen?.(); }
            }}
            className="px-2 py-1 rounded text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            title="Fullscreen (F)"
          >{fullscreen ? "🗗" : "⛶"}</button>
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="h-0.5 bg-white/5 shrink-0">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${slides.length > 0 ? ((currentIdx + 1) / slides.length) * 100 : 0}%`,
            backgroundColor: t.accent,
          }}
        />
      </div>

      {/* ── Main content: left image + right text ── */}
      <div
        ref={contentAreaRef}
        className="flex-1 flex overflow-hidden relative"
        style={{
          cursor: drawMode === "pen" ? "crosshair" : drawMode === "marker" ? "copy" : "default",
        }}
        onMouseDown={drawMode !== "none" ? handleContentMouseDown : undefined}
      >
        {/* Image — left side */}
        {imageUrl && (
          <div className="flex items-center justify-center overflow-hidden p-3" style={{ flex: "0 0 62%" }}>
            <img
              src={imageUrl}
              alt={slide?.name}
              className="max-w-full max-h-full object-contain rounded-lg shadow-xl"
            />
          </div>
        )}

        {/* Markdown content — right side */}
        <div
          className="overflow-y-auto px-5 py-3"
          style={{
            flex: imageUrl ? "1 1 38%" : "1 1 auto",
            scrollbarWidth: "thin",
            borderLeft: imageUrl ? "1px solid rgba(255,255,255,0.08)" : "none",
          }}
        >
          {mdLoading ? (
            <div className="flex items-center justify-center py-4 text-white/30 text-xs gap-1.5">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading content...
            </div>
          ) : parsedMd.content ? (
            <div className="text-white/90">
              {renderMarkdown(parsedMd.content)}
            </div>
          ) : !imageUrl ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-white/20 text-sm">No content</span>
            </div>
          ) : null}
        </div>

        {/* Notes sidebar */}
        {showNotes && notesContent && (
          <div
            className="border-l overflow-y-auto px-4 py-3 shrink-0"
            style={{
              borderColor: "rgba(255,255,255,0.1)",
              width: "260px",
              scrollbarWidth: "thin",
              backgroundColor: "rgba(0,0,0,0.2)",
            }}
          >
            <div className="text-[10px] text-white/40 mb-2 uppercase tracking-wide">📝 Speaker Notes</div>
            <div className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">
              {notesContent}
            </div>
          </div>
        )}

        {/* ── Canvas overlay (pen drawing) ── */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none z-30"
        />

        {/* ── Markers layer (draggable) ── */}
        {markers.map((m, i) => (
          <div
            key={i}
            className="absolute z-30 select-none"
            style={{
              left: `${m.x * 100}%`,
              top: `${m.y * 100}%`,
              transform: "translate(-50%, -50%)",
              fontSize: 28,
              cursor: "grab",
              animation: "briefing-pulse 1.5s ease-in-out infinite",
              filter: "drop-shadow(0 0 6px rgba(255,255,255,0.5))",
              pointerEvents: "auto",
            }}
            onMouseDown={(e) => handleMarkerMouseDown(e, i)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setMarkers(prev => prev.filter((_, idx) => idx !== i));
            }}
            title="拖曳移動 · 雙擊刪除"
          >
            {m.icon}
          </div>
        ))}

        {/* ── Floating toolbar ── */}
        <div data-annotation-ui className="absolute z-40" style={{ bottom: 12, left: "50%", transform: "translateX(-50%)" }}>
          <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-xl" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.1)" }}>
            {/* Pen */}
            <button
              onClick={() => toggleMode("pen")}
              className="px-2.5 py-1.5 rounded-lg text-sm transition-all"
              style={{ background: drawMode === "pen" ? "rgba(250,204,21,0.3)" : "transparent" }}
              title="手繪筆 (D)"
            >✏️</button>

            <span className="text-white/15 text-xs mx-0.5">|</span>

            {/* Markers */}
            {[
              { icon: "💡", label: "重點" },
              { icon: "⭐", label: "重要" },
              { icon: "❗", label: "注意" },
              { icon: "👈", label: "看這" },
              { icon: "✅", label: "確認" },
            ].map(({ icon, label }) => {
              const isActive = drawMode === "marker" && selectedIcon === icon;
              return (
                <button
                  key={icon}
                  onClick={() => { setSelectedIcon(icon); toggleMode("marker"); }}
                  className="px-2 py-1.5 rounded-lg text-sm transition-all"
                      style={{
                      background: isActive ? "rgba(250,204,21,0.3)" : "transparent",
                      filter: isActive ? "none" : "grayscale(0.5) opacity(0.6)",
                    }}
                  title={`${label} (H)`}
                >{icon}</button>
              );
            })}

            <span className="text-white/15 text-xs mx-0.5">|</span>

            {/* Clear */}
            <button
              onClick={clearAnnotations}
              className="px-2.5 py-1.5 rounded-lg text-sm text-rose-300/70 hover:text-rose-300 hover:bg-rose-500/10 transition-all"
              title="清除所有標註 (E)"
            >🗑️</button>
          </div>
        </div>

        {/* ── Mode indicator ── */}
        {drawMode !== "none" && (
          <div data-annotation-ui className="absolute z-40" style={{ top: 8, left: "50%", transform: "translateX(-50%)" }}>
            <div className="px-3 py-1 rounded-full text-xs text-white/90" style={{ background: "rgba(250,204,21,0.2)", border: "1px solid rgba(250,204,21,0.4)" }}>
              {drawMode === "pen" ? "✏️ 手繪模式" : `📍 標記模式 (${selectedIcon})`} — Esc 退出
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom ref bar + hints ── */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5" style={{ backgroundColor: "rgba(0,0,0,0.4)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {/* Ref file icons */}
        {parsedMd.fileRefs.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-white/30 uppercase tracking-wide">📎</span>
            {parsedMd.fileRefs.map(refPath => {
              const fname = refPath.split("/").pop() || refPath;
              const ext = fname.split(".").pop()?.toLowerCase() ?? "";
              const isActive = refOverlay === refPath;
              return (
                <button
                  key={refPath}
                  onClick={() => setRefOverlay(isActive ? null : refPath)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all ${isActive ? "bg-white/20 text-white" : "text-white/50 hover:text-white hover:bg-white/10"}`}
                  title={refPath}
                >
                  📄 {fname}
                </button>
              );
            })}
          </div>
        )}

        {/* Spacer + hints */}
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-white/20">← → 翻頁</span>
          <span className="text-[10px] text-white/20">O 概覽</span>
          <span className="text-[10px] text-white/20">N 備忘</span>
          <span className="text-[10px] text-white/20">F 全螢幕</span>
          <span className="text-[10px] text-white/20">D 手繪</span>
          <span className="text-[10px] text-white/20">H 標記</span>
          <span className="text-[10px] text-white/20">E 清除</span>
        </div>
      </div>

      {/* ── Ref overlay (full screen) ── */}
      {refOverlay && (
        <RefOverlay
          refPath={refOverlay}
          onClose={() => setRefOverlay(null)}
        />
      )}
    </div>
  );
}
