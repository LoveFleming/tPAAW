/**
 * MindMapViewer — AI 互動式心智圖 Viewer
 *
 * 功能：
 * 1. 選檔案/目錄 → AI 產生心智圖
 * 2. 直接貼文字 → AI 產生心智圖
 * 3. SVG 互動式渲染（縮放、拖曳、展開/收合）
 * 4. 儲存/載入心智圖
 *
 * Inspired by NotebookLM's mind map feature.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";

// ── Types ──

interface MindMapNode {
  title: string;
  color?: string;
  children?: MindMapNode[];
  collapsed?: boolean;
}

interface MindMapData {
  root: MindMapNode;
  summary?: string;
}

interface SavedMindMap {
  id: string;
  name: string;
  summary: string;
  createdAt: string;
}

interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
}

// ── Layout Constants ──

const NODE_RADIUS = { root: 38, l1: 28, l2: 22, leaf: 18 };
const FONT_SIZE = { root: 14, l1: 12, l2: 11, leaf: 10 };
const MIN_NODE_SPACING = 80;
const LEVEL_DISTANCE = [0, 160, 130, 110, 95];

// ── MindMap Layout Engine ──
// Radial tree layout: compute (x, y) for each node

interface PositionedNode {
  node: MindMapNode;
  x: number;
  y: number;
  angle: number;
  level: number;
  parent: PositionedNode | null;
  width: number; // subtree angular width
}

function computeSubtreeWidth(node: MindMapNode): number {
  if (!node.children || node.children.length === 0 || node.collapsed) return 1;
  return node.children.reduce((sum, c) => sum + computeSubtreeWidth(c), 0);
}

function layoutRadial(
  root: MindMapNode,
  centerX: number,
  centerY: number,
): PositionedNode[] {
  const nodes: PositionedNode[] = [];

  function layout(
    node: MindMapNode,
    level: number,
    startAngle: number,
    endAngle: number,
    parent: PositionedNode | null,
  ) {
    const midAngle = (startAngle + endAngle) / 2;
    const radius = LEVEL_DISTANCE[Math.min(level, LEVEL_DISTANCE.length - 1)];
    const x = level === 0 ? centerX : centerX + radius * Math.cos(midAngle);
    const y = level === 0 ? centerY : centerY + radius * Math.sin(midAngle);

    const positioned: PositionedNode = {
      node, x, y, angle: midAngle, level, parent,
      width: endAngle - startAngle,
    };
    nodes.push(positioned);

    if (!node.children || node.children.length === 0 || node.collapsed) return;

    const totalWidth = computeSubtreeWidth(node);
    let currentAngle = startAngle;
    for (const child of node.children) {
      const childWidth = computeSubtreeWidth(child);
      const childAngleRange = (endAngle - startAngle) * (childWidth / totalWidth);
      layout(child, level + 1, currentAngle, currentAngle + childAngleRange, positioned);
      currentAngle += childAngleRange;
    }
  }

  layout(root, 0, 0, Math.PI * 2, null);
  return nodes;
}

// ── SVG Path for edges (curved) ──

function edgePath(from: PositionedNode, to: PositionedNode): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dr = Math.sqrt(dx * dx + dy * dy) * 1.8;
  return `M ${from.x} ${from.y} A ${dr} ${dr} 0 0 1 ${to.x} ${to.y}`;
}

// ── Color helpers ──

function getNodeRadius(level: number): number {
  if (level === 0) return NODE_RADIUS.root;
  if (level === 1) return NODE_RADIUS.l1;
  if (level === 2) return NODE_RADIUS.l2;
  return NODE_RADIUS.leaf;
}

function getNodeFont(level: number): number {
  if (level === 0) return FONT_SIZE.root;
  if (level === 1) return FONT_SIZE.l1;
  if (level === 2) return FONT_SIZE.l2;
  return FONT_SIZE.leaf;
}

function lightenColor(hex: string, amount: number = 0.85): string {
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return hex;
  const r = Math.round(parseInt(m[1], 16) + (255 - parseInt(m[1], 16)) * (1 - amount));
  const g = Math.round(parseInt(m[2], 16) + (255 - parseInt(m[2], 16)) * (1 - amount));
  const b = Math.round(parseInt(m[3], 16) + (255 - parseInt(m[3], 16)) * (1 - amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Main Component ──

export default function MindMapViewer() {
  // State
  const [mindMap, setMindMap] = useState<MindMapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "text">("select");
  const [prompt, setPrompt] = useState("請整理這份內容的知識結構，做成心智圖");
  const [inputText, setInputText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [browserPath, setBrowserPath] = useState<string>("");
  const [browserDirs, setBrowserDirs] = useState<FileItem[]>([]);
  const [browserFiles, setBrowserFiles] = useState<FileItem[]>([]);
  const [savedMaps, setSavedMaps] = useState<SavedMindMap[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Pan & Zoom
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const W = 1200;
  const H = 800;

  // ── Browse directories ──
  const browsePath = useCallback(async (path: string) => {
    setBrowserPath(path);
    try {
      const resp = await fetch(`/api/fs/browse-files?path=${encodeURIComponent(path)}`);
      const data = await resp.json();
      setBrowserDirs((data.directories || []).map((d: any) => ({ name: d.name, path: d.path, isDir: true })));
      setBrowserFiles((data.files || []).map((f: any) => ({ name: f.name, path: f.path, isDir: false })));
    } catch (err) {
      setBrowserDirs([]);
      setBrowserFiles([]);
    }
  }, []);

  // Initial browse
  useEffect(() => {
    browsePath(browserPath || (window as any).__PAAW_ROOT__ || "/");
  }, []);

  // ── Generate mind map from files/dir ──
  const generateFromFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body: any = { prompt };
      if (selectedDir) body.dir = selectedDir;
      else if (selectedFiles.length > 0) body.files = selectedFiles;
      else {
        setError("請選擇檔案或目錄");
        setLoading(false);
        return;
      }

      const resp = await fetch("/api/mindmap/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.error || "產生失敗");
      }
      setMindMap(data.mindMap);
      setTransform({ x: 0, y: 0, scale: 1 });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedFiles, selectedDir, prompt]);

  // ── Generate mind map from text ──
  const generateFromText = useCallback(async () => {
    if (inputText.trim().length < 10) {
      setError("請輸入至少 10 個字的內容");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/mindmap/from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText, prompt }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.error || "產生失敗");
      }
      setMindMap(data.mindMap);
      setTransform({ x: 0, y: 0, scale: 1 });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [inputText, prompt]);

  // ── Save / Load ──
  const loadSavedList = useCallback(async () => {
    try {
      const resp = await fetch("/api/mindmap/list");
      const data = await resp.json();
      setSavedMaps(data.mindmaps || []);
    } catch {}
  }, []);

  const loadMindMap = useCallback(async (id: string) => {
    try {
      const resp = await fetch(`/api/mindmap/get?id=${id}`);
      const data = await resp.json();
      if (data.mindMap) {
        setMindMap(data.mindMap);
        setTransform({ x: 0, y: 0, scale: 1 });
        setShowSaved(false);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const saveMindMap = useCallback(async () => {
    if (!mindMap || !saveName.trim()) return;
    try {
      await fetch("/api/mindmap/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName,
          mindMap,
          summary: mindMap.summary,
        }),
      });
      setShowSaveDialog(false);
      setSaveName("");
    } catch (err: any) {
      setError(err.message);
    }
  }, [mindMap, saveName]);

  // ── Toggle node collapse ──
  const toggleNode = useCallback((path: number[]) => {
    if (!mindMap) return;
    const newMap = JSON.parse(JSON.stringify(mindMap));
    let node = newMap.root;
    for (let i = 1; i < path.length; i++) node = node.children[path[i]];
    node.collapsed = !node.collapsed;
    setMindMap(newMap);
  }, [mindMap]);

  // ── Pan & Zoom handlers ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setTransform(prev => ({ ...prev, x: panStart.current.tx + dx, y: panStart.current.ty + dy }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({
      ...prev,
      scale: Math.max(0.2, Math.min(5, prev.scale * delta)),
    }));
  }, []);

  const fitToScreen = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  // ── Compute layout ──
  const positionedNodes = useMemo(() => {
    if (!mindMap?.root) return [];
    return layoutRadial(mindMap.root, W / 2, H / 2);
  }, [mindMap]);

  const edges = useMemo(() => {
    return positionedNodes
      .filter(n => n.parent !== null)
      .map(n => ({ from: n.parent!, to: n }));
  }, [positionedNodes]);

  // ── Render node path for toggle ──
  const nodePaths = useMemo(() => {
    const paths: Map<PositionedNode, number[]> = new Map();
    function walk(nodes: PositionedNode[], current: number[]) {
      for (const n of nodes) {
        // Reconstruct path from level
      }
    }
    // Build path map from positionedNodes
    const pathMap: Map<PositionedNode, number[]> = new Map();
    const rootP = positionedNodes.find(n => n.level === 0);
    if (rootP) pathMap.set(rootP, [0]);

    // BFS to assign paths
    const queue = [rootP].filter(Boolean) as PositionedNode[];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentPath = pathMap.get(current)!;
      const children = positionedNodes.filter(n => n.parent === current);
      children.forEach((child, i) => {
        pathMap.set(child, [...currentPath, i]);
        queue.push(child);
      });
    }
    return pathMap;
  }, [positionedNodes]);

  // ── Export SVG ──
  const exportSVG = useCallback(() => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mindmap.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0f172a", color: "#e2e8f0" }}>
      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
        background: "#1e293b", borderBottom: "1px solid #334155", flexShrink: 0,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, marginRight: 8 }}>🧠 Mind Map</span>
        {mindMap && (
          <button onClick={() => { setMindMap(null); setSelectedFiles([]); setSelectedDir(null); }}
            style={btnStyle}>
            ← 新建
          </button>
        )}
        {mindMap && <button onClick={fitToScreen} style={btnStyle}>🔍 重置視圖</button>}
        {mindMap && <button onClick={exportSVG} style={btnStyle}>⬇ 匯出 SVG</button>}
        {mindMap && <button onClick={() => setShowSaveDialog(true)} style={btnStyle}>💾 儲存</button>}
        <button onClick={() => { loadSavedList(); setShowSaved(true); }} style={btnStyle}>📂 載入</button>
        <div style={{ flex: 1 }} />
        {error && <span style={{ color: "#f87171", fontSize: 13 }}>{error}</span>}
      </div>

      {/* ── Main Area ── */}
      {!mindMap ? (
        /* ── Input Panel ── */
        <div style={{ flex: 1, overflow: "auto", padding: 24, maxWidth: 900, margin: "0 auto", width: "100%" }}>
          {/* Mode Tabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <button
              onClick={() => setMode("select")}
              style={mode === "select" ? activeTabStyle : tabStyle}
            >📁 選擇檔案/目錄</button>
            <button
              onClick={() => setMode("text")}
              style={mode === "text" ? activeTabStyle : tabStyle}
            >✏️ 貼上文字</button>
          </div>

          {/* Prompt Input — 移到下方 */}

          {mode === "select" ? (
            /* File Browser */
            <div>
              <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => browsePath(browserPath ? browserPath.split("/").slice(0, -1).join("/") || "/" : "/")}
                  style={btnStyle}
                >↑</button>
                <span style={{ fontSize: 13, color: "#94a3b8", fontFamily: "monospace" }}>{browserPath || "/"}</span>
              </div>

              <div style={{
                background: "#1e293b", borderRadius: 8, border: "1px solid #334155",
                maxHeight: 350, overflow: "auto", padding: 8,
              }}>
                {/* Directory option */}
                <div
                  onClick={() => { setSelectedDir(browserPath); setSelectedFiles([]); }}
                  style={{
                    padding: "8px 12px", cursor: "pointer", borderRadius: 4,
                    background: selectedDir === browserPath ? "#4F46E533" : "transparent",
                    display: "flex", alignItems: "center", gap: 8,
                  }}
                >
                  <span>📂</span>
                  <span style={{ fontWeight: 600 }}>選擇整個目錄: {browserPath.split("/").pop() || "/"}</span>
                  {selectedDir === browserPath && <span style={{ color: "#818cf8" }}>✓</span>}
                </div>

                {browserDirs.map(d => (
                  <div
                    key={d.path}
                    onClick={() => browsePath(d.path)}
                    onDoubleClick={() => { setSelectedDir(d.path); }}
                    style={{
                      padding: "6px 12px", cursor: "pointer", borderRadius: 4,
                      display: "flex", alignItems: "center", gap: 8,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "#334155"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span>📁</span>
                    <span>{d.name}</span>
                  </div>
                ))}

                {browserFiles.map(f => {
                  const selected = selectedFiles.includes(f.path);
                  return (
                    <div
                      key={f.path}
                      onClick={() => {
                        setSelectedDir(null);
                        setSelectedFiles(prev => selected ? prev.filter(p => p !== f.path) : [...prev, f.path]);
                      }}
                      style={{
                        padding: "6px 12px", cursor: "pointer", borderRadius: 4,
                        background: selected ? "#4F46E533" : "transparent",
                        display: "flex", alignItems: "center", gap: 8,
                      }}
                      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "#334155"; }}
                      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span>{selected ? "✅" : "📄"}</span>
                      <span>{f.name}</span>
                    </div>
                  );
                })}
              </div>

              {/* Selection Summary */}
              <div style={{ marginTop: 12, fontSize: 13, color: "#94a3b8" }}>
                {selectedDir && `已選目錄: ${selectedDir}`}
                {selectedFiles.length > 0 && `已選 ${selectedFiles.length} 個檔案`}
              </div>

              {/* AI Prompt */}
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
                  AI 提示詞
                </label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  rows={16}
                  style={{
                    width: "100%", padding: "10px 12px", background: "#1e293b",
                    border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0",
                    fontSize: 14, fontFamily: "monospace", resize: "vertical", lineHeight: 1.6,
                  }}
                />
              </div>

              <button
                onClick={generateFromFiles}
                disabled={loading || (!selectedDir && selectedFiles.length === 0)}
                style={{
                  ...btnStyle,
                  marginTop: 16,
                  background: loading || (!selectedDir && selectedFiles.length === 0) ? "#334155" : "#4F46E5",
                  fontSize: 15, padding: "10px 24px",
                  cursor: loading || (!selectedDir && selectedFiles.length === 0) ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "⟳ AI 產生中..." : "🧠 產生心智圖"}
              </button>
            </div>
          ) : (
            /* Text Input */
            <div>
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="貼上你想整理成心智圖的文字內容..."
                style={{
                  width: "100%", minHeight: 250, padding: 12, background: "#1e293b",
                  border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0",
                  fontSize: 14, fontFamily: "monospace", resize: "vertical",
                }}
              />

              {/* AI Prompt */}
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
                  AI 提示詞
                </label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  rows={16}
                  style={{
                    width: "100%", padding: "10px 12px", background: "#1e293b",
                    border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0",
                    fontSize: 14, fontFamily: "monospace", resize: "vertical", lineHeight: 1.6,
                  }}
                />
              </div>
              <button
                onClick={generateFromText}
                disabled={loading || inputText.trim().length < 10}
                style={{
                  ...btnStyle,
                  marginTop: 12,
                  background: loading || inputText.trim().length < 10 ? "#334155" : "#4F46E5",
                  fontSize: 15, padding: "10px 24px",
                  cursor: loading || inputText.trim().length < 10 ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "⟳ AI 產生中..." : "🧠 產生心智圖"}
              </button>
            </div>
          )}

          {loading && (
            <div style={{
              marginTop: 24, textAlign: "center", padding: 40,
              color: "#818cf8", fontSize: 15,
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🧠⚡</div>
              AI 正在分析內容並整理知識結構...
            </div>
          )}
        </div>
      ) : (
        /* ── Mind Map Canvas ── */
        <div
          style={{ flex: 1, position: "relative", overflow: "hidden", cursor: isPanning.current ? "grabbing" : "grab" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {mindMap.summary && (
            <div style={{
              position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
              background: "#1e293bee", padding: "4px 16px", borderRadius: 20,
              fontSize: 13, color: "#94a3b8", zIndex: 10, border: "1px solid #334155",
            }}>
              {mindMap.summary}
            </div>
          )}

          {/* Zoom indicator */}
          <div style={{
            position: "absolute", bottom: 12, right: 12,
            background: "#1e293bee", padding: "4px 10px", borderRadius: 4,
            fontSize: 12, color: "#64748b", zIndex: 10,
          }}>
            {Math.round(transform.scale * 100)}%
          </div>

          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <radialGradient id="bg-grad">
                <stop offset="0%" stopColor="#1e293b" />
                <stop offset="100%" stopColor="#0f172a" />
              </radialGradient>
            </defs>
            <rect width={W} height={H} fill="url(#bg-grad)" />

            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
              {/* Edges */}
              {edges.map((edge, i) => (
                <path
                  key={`edge-${i}`}
                  d={edgePath(edge.from, edge.to)}
                  fill="none"
                  stroke={edge.to.node.color || "#475569"}
                  strokeWidth={Math.max(1, 4 - edge.to.level)}
                  opacity={0.5}
                />
              ))}

              {/* Nodes */}
              {positionedNodes.map((pn, i) => {
                const r = getNodeRadius(pn.level);
                const fontSize = getNodeFont(pn.level);
                const color = pn.node.color || "#6366f1";
                const hasChildren = pn.node.children && pn.node.children.length > 0;
                const isCollapsed = pn.node.collapsed;
                const path = nodePaths.get(pn);

                return (
                  <g
                    key={`node-${i}`}
                    transform={`translate(${pn.x} ${pn.y})`}
                    style={{ cursor: hasChildren ? "pointer" : "default" }}
                    onClick={() => { if (hasChildren && path && pn.level > 0) toggleNode(path); }}
                  >
                    {/* Node circle */}
                    <circle
                      r={r}
                      fill={pn.level === 0 ? color : lightenColor(color, 0.3)}
                      stroke={color}
                      strokeWidth={pn.level === 0 ? 3 : 2}
                      opacity={0.95}
                    />

                    {/* Collapse indicator */}
                    {hasChildren && pn.level > 0 && (
                      <circle
                        r={6}
                        cx={r * 0.72}
                        cy={-r * 0.72}
                        fill="#1e293b"
                        stroke="#64748b"
                        strokeWidth={1}
                      />
                    )}
                    {hasChildren && pn.level > 0 && (
                      <text
                        x={r * 0.72}
                        y={-r * 0.72 + 3}
                        textAnchor="middle"
                        fontSize={8}
                        fill="#94a3b8"
                      >
                        {isCollapsed ? "+" : "−"}
                      </text>
                    )}

                    {/* Node label */}
                    <text
                      textAnchor="middle"
                      dy={fontSize * 0.35}
                      fontSize={fontSize}
                      fill={pn.level === 0 ? "#ffffff" : "#1e293b"}
                      fontWeight={pn.level <= 1 ? 700 : 500}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {pn.node.title.length > 12 ? pn.node.title.slice(0, 11) + "…" : pn.node.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}

      {/* ── Save Dialog ── */}
      {showSaveDialog && mindMap && (
        <div style={overlayStyle}>
          <div style={dialogStyle}>
            <h3 style={{ margin: "0 0 16px 0" }}>💾 儲存心智圖</h3>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="輸入名稱..."
              style={{
                width: "100%", padding: "8px 12px", background: "#0f172a",
                border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 14,
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setShowSaveDialog(false)} style={btnStyle}>取消</button>
              <button
                onClick={saveMindMap}
                disabled={!saveName.trim()}
                style={{
                  ...btnStyle,
                  background: saveName.trim() ? "#4F46E5" : "#334155",
                }}
              >儲存</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Saved List Dialog ── */}
      {showSaved && (
        <div style={overlayStyle}>
          <div style={{ ...dialogStyle, maxHeight: 500, overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>📂 已存的心智圖</h3>
              <button onClick={() => setShowSaved(false)} style={btnStyle}>✕</button>
            </div>
            {savedMaps.length === 0 ? (
              <p style={{ color: "#64748b", textAlign: "center", padding: 24 }}>尚未儲存任何心智圖</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {savedMaps.map(m => (
                  <div
                    key={m.id}
                    onClick={() => loadMindMap(m.id)}
                    style={{
                      padding: "10px 14px", background: "#0f172a", borderRadius: 6,
                      cursor: "pointer", border: "1px solid #334155",
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#4F46E5"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#334155"}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
                    {m.summary && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{m.summary}</div>}
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                      {new Date(m.createdAt).toLocaleString("zh-TW")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ──

const btnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "#334155",
  border: "1px solid #475569",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const tabStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  color: "#94a3b8",
  fontSize: 14,
  cursor: "pointer",
};

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: "#4F46E5",
  border: "1px solid #6366f1",
  color: "#ffffff",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const dialogStyle: React.CSSProperties = {
  background: "#1e293b",
  borderRadius: 12,
  padding: 24,
  minWidth: 400,
  maxWidth: 500,
  border: "1px solid #334155",
};
