/**
 * MindMapViewer — AI 心智圖（markmap引擎）
 *
 * 使用 markmap-view 渲染，AI 輸出 Markdown 自動排版。
 * 全部顏色跟隨 PAAW 主題，支援縮放、拖曳、展開/收合、SVG 匯出、儲存/載入。
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { useTheme } from "../theme";

const transformer = new Transformer();

// ── Types ──

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

// ── 根據主題 accent 產生 markmap 色系（5 色） ──

function themeColors(accent: string): string[] {
  const palette: Record<string, string[]> = {
    "sunny":           ["#F59E0B", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6"],
    "sky":             ["#3B82F6", "#06B6D4", "#8B5CF6", "#F59E0B", "#EC4899"],
    "calm-anxiety":    ["#4A7BA7", "#5B9BD5", "#6BBFB8", "#A8C5E0", "#7B9EA8"],
    "calm-tension":    ["#2D6A4F", "#52B788", "#74C69D", "#95D5B2", "#40916C"],
    "calm-anger":      ["#78716C", "#A8A29E", "#B89B7A", "#9C8B7A", "#6B5D54"],
    "boost-creative":  ["#7C3AED", "#A78BFA", "#06B6D4", "#EC4899", "#F59E0B"],
    "calm-exhaustion": ["#B45309", "#D97706", "#92400E", "#C2841A", "#78350F"],
  };
  for (const [, colors] of Object.entries(palette)) {
    if (colors[0].toLowerCase() === accent.toLowerCase()) return colors;
  }
  return [accent, "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6"];
}

// ── hex 加透明度 ──
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `${hex}${a}`;
}

// ── Main Component ──

export default function MindMapViewer() {
  const { info: themeInfo, theme: themeId } = useTheme();

  // 主題衍生色 — 不再用深色 hardcode
  const panelBg     = withAlpha(themeInfo.accent, 0.10);
  const inputBg     = withAlpha(themeInfo.accent, 0.06);
  const borderColor = withAlpha(themeInfo.accent, 0.25);
  const hoverBg     = withAlpha(themeInfo.accent, 0.15);
  const toolbarBg   = withAlpha(themeInfo.accent, 0.12);
  const textColor   = themeInfo.accentText;
  const subText     = withAlpha(themeInfo.accentText, 0.65);

  // Mind map state
  const [markdown, setMarkdown] = useState<string>("");
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

  // markmap
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<Markmap | null>(null);

  // ── 建立或更新 markmap ──
  useEffect(() => {
    if (!markdown || !svgRef.current) return;

    const { root } = transformer.transform(markdown);
    const colors = themeColors(themeInfo.accent);

    const options = {
      color: (node: any) => {
        const depth = node?.state?.depth ?? 0;
        return colors[depth % colors.length];
      },
      initialExpandLevel: 3,
      pan: true,
      zoom: true,
      duration: 300,
      maxWidth: 300,
      spacingHorizontal: 80,
      spacingVertical: 20,
      style: (id: string) => `
        .${id} {
          --markmap-text-color: ${textColor};
          --markmap-circle-open-bg: ${themeInfo.accent};
          --markmap-a-color: ${themeInfo.accent};
          --markmap-a-hover-color: ${themeInfo.accentHover};
          --markmap-code-bg: ${panelBg};
          --markmap-code-color: ${textColor};
          --markmap-font: 400 15px/22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .${id} foreignObject div { color: ${textColor} !important; }
        .${id} .markmap-node text { fill: ${textColor}; }
        .${id} .markmap-node > circle { stroke-width: 2.5; }
        .${id} .markmap-link { stroke-width: 2; opacity: 0.5; }
      `,
    };

    if (!mmRef.current) {
      mmRef.current = Markmap.create(svgRef.current, options);
    } else {
      mmRef.current.setOptions(options);
    }
    mmRef.current.setData(root);
    setTimeout(() => mmRef.current?.fit(), 200);
  }, [markdown, themeId]);

  // ── Browse directories ──
  const browsePath = useCallback(async (path: string) => {
    setBrowserPath(path);
    try {
      const resp = await fetch(`/api/fs/browse-files?path=${encodeURIComponent(path)}`);
      const data = await resp.json();
      setBrowserDirs((data.directories || []).map((d: any) => ({ name: d.name, path: d.path, isDir: true })));
      setBrowserFiles((data.files || []).map((f: any) => ({ name: f.name, path: f.path, isDir: false })));
    } catch {
      setBrowserDirs([]);
      setBrowserFiles([]);
    }
  }, []);

  useEffect(() => {
    browsePath(browserPath || (window as any).__PAAW_ROOT__ || "/");
  }, []);

  // ── Generate from files ──
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
      if (!resp.ok || !data.success) throw new Error(data.error || "產生失敗");
      setMarkdown(data.markdown);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedFiles, selectedDir, prompt]);

  // ── Generate from text ──
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
      if (!resp.ok || !data.success) throw new Error(data.error || "產生失敗");
      setMarkdown(data.markdown);
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
      if (data.markdown) {
        setMarkdown(data.markdown);
        setShowSaved(false);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const saveMindMap = useCallback(async () => {
    if (!markdown || !saveName.trim()) return;
    try {
      await fetch("/api/mindmap/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName, markdown }),
      });
      setShowSaveDialog(false);
      setSaveName("");
    } catch (err: any) {
      setError(err.message);
    }
  }, [markdown, saveName]);

  // ── Toolbar ──
  const fitToScreen = useCallback(() => mmRef.current?.fit(), []);
  const zoomIn = useCallback(() => mmRef.current?.rescale(1.25), []);
  const zoomOut = useCallback(() => mmRef.current?.rescale(0.8), []);

  const exportSVG = useCallback(() => {
    if (!svgRef.current) return;
    const svgEl = svgRef.current.cloneNode(true) as SVGElement;
    svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", themeInfo.accentBg);
    svgEl.insertBefore(bg, svgEl.firstChild);
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mindmap.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, [themeInfo]);

  // ── 動態 styles ──
  const btnStyle: React.CSSProperties = {
    padding: "6px 14px",
    background: hoverBg,
    border: `1px solid ${borderColor}`,
    borderRadius: 6,
    color: textColor,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const tabStyle: React.CSSProperties = {
    padding: "8px 16px",
    background: panelBg,
    border: `1px solid ${borderColor}`,
    borderRadius: 6,
    color: subText,
    fontSize: 14,
    cursor: "pointer",
  };

  const activeTabStyle: React.CSSProperties = {
    ...tabStyle,
    background: themeInfo.accent,
    border: `1px solid ${themeInfo.accent}`,
    color: "#ffffff",
  };

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  };

  const dialogStyle: React.CSSProperties = {
    background: themeInfo.accentBg,
    borderRadius: 12,
    padding: 24,
    minWidth: 400,
    maxWidth: 500,
    border: `1px solid ${borderColor}`,
  };

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: themeInfo.accentBg, color: textColor,
    }}>
      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
        background: toolbarBg, borderBottom: `2px solid ${themeInfo.accent}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, marginRight: 8, color: themeInfo.accent }}>
          🧠 Mind Map
        </span>
        {markdown && (
          <button onClick={() => { setMarkdown(""); setSelectedFiles([]); setSelectedDir(null); mmRef.current = null; }} style={btnStyle}>
            ← 新建
          </button>
        )}
        {markdown && <button onClick={zoomIn} style={btnStyle}>🔍+ 放大</button>}
        {markdown && <button onClick={zoomOut} style={btnStyle}>🔍− 縮小</button>}
        {markdown && <button onClick={fitToScreen} style={btnStyle}>⛶ 符合視窗</button>}
        {markdown && <button onClick={exportSVG} style={btnStyle}>⬇ SVG</button>}
        {markdown && <button onClick={() => setShowSaveDialog(true)} style={btnStyle}>💾 儲存</button>}
        <button onClick={() => { loadSavedList(); setShowSaved(true); }} style={btnStyle}>📂 載入</button>
        <div style={{ flex: 1 }} />
        {error && <span style={{ color: "#ef4444", fontSize: 13 }}>{error}</span>}
      </div>

      {/* ── Main Area ── */}
      {!markdown ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px 24px", maxWidth: 900, margin: "0 auto", width: "100%", minHeight: 0 }}>
          {/* Mode Tabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexShrink: 0 }}>
            <button onClick={() => setMode("select")} style={mode === "select" ? activeTabStyle : tabStyle}>
              📁 選擇檔案/目錄
            </button>
            <button onClick={() => setMode("text")} style={mode === "text" ? activeTabStyle : tabStyle}>
              ✏️ 貼上文字
            </button>
          </div>

          {mode === "select" ? (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              {/* Path bar */}
              <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => browsePath(browserPath ? browserPath.split("/").slice(0, -1).join("/") || "/" : "/")}
                  style={btnStyle}
                >↑</button>
                <span style={{ fontSize: 13, color: subText, fontFamily: "monospace" }}>{browserPath || "/"}</span>
              </div>

              {/* File list */}
              <div style={{
                background: panelBg, borderRadius: 8, border: `1px solid ${borderColor}`,
                flex: 2, minHeight: 0, overflow: "auto", padding: 8,
              }}>
                <div
                  onClick={() => { setSelectedDir(browserPath); setSelectedFiles([]); }}
                  style={{
                    padding: "8px 12px", cursor: "pointer", borderRadius: 4,
                    background: selectedDir === browserPath ? withAlpha(themeInfo.accent, 0.2) : "transparent",
                    display: "flex", alignItems: "center", gap: 8,
                  }}
                >
                  <span>📂</span>
                  <span style={{ fontWeight: 600, color: textColor }}>選擇整個目錄: {browserPath.split("/").pop() || "/"}</span>
                  {selectedDir === browserPath && <span style={{ color: themeInfo.accent }}>✓</span>}
                </div>

                {browserDirs.map(d => (
                  <div
                    key={d.path}
                    onClick={() => browsePath(d.path)}
                    style={{ padding: "6px 12px", cursor: "pointer", borderRadius: 4, display: "flex", alignItems: "center", gap: 8, color: textColor }}
                    onMouseEnter={e => e.currentTarget.style.background = hoverBg}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span>📁</span><span>{d.name}</span>
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
                        background: selected ? withAlpha(themeInfo.accent, 0.2) : "transparent",
                        display: "flex", alignItems: "center", gap: 8, color: textColor,
                      }}
                      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = hoverBg; }}
                      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span>{selected ? "✅" : "📄"}</span><span>{f.name}</span>
                    </div>
                  );
                })}
              </div>

              {/* Selection Summary */}
              <div style={{ marginTop: 6, fontSize: 13, color: subText, flexShrink: 0 }}>
                {selectedDir && `已選目錄: ${selectedDir}`}
                {selectedFiles.length > 0 && `已選 ${selectedFiles.length} 個檔案`}
              </div>

              {/* AI Prompt */}
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: 6 }}>
                <label style={{ fontSize: 13, color: subText, marginBottom: 4, flexShrink: 0 }}>
                  AI 提示詞
                </label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  style={{
                    width: "100%", flex: 1, minHeight: 0, padding: "10px 12px",
                    background: inputBg,
                    border: `1px solid ${borderColor}`, borderRadius: 6, color: textColor,
                    fontSize: 14, fontFamily: "monospace", resize: "none", lineHeight: 1.6,
                  }}
                />
              </div>

              <button
                onClick={generateFromFiles}
                disabled={loading || (!selectedDir && selectedFiles.length === 0)}
                style={{
                  ...btnStyle, marginTop: 10, flexShrink: 0,
                  background: loading || (!selectedDir && selectedFiles.length === 0) ? withAlpha(themeInfo.accent, 0.2) : themeInfo.accent,
                  color: "#fff",
                  fontSize: 15, padding: "10px 24px",
                  cursor: loading || (!selectedDir && selectedFiles.length === 0) ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "⟳ AI 產生中..." : "🧠 產生心智圖"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              {/* Text input */}
              <div style={{ display: "flex", flexDirection: "column", flex: 2, minHeight: 0 }}>
                <label style={{ fontSize: 13, color: subText, marginBottom: 4, flexShrink: 0 }}>
                  要整理的內容
                </label>
                <textarea
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder="貼上你想整理成心智圖的文字內容..."
                  style={{
                    width: "100%", flex: 1, minHeight: 0, padding: 12,
                    background: inputBg,
                    border: `1px solid ${borderColor}`, borderRadius: 8, color: textColor,
                    fontSize: 14, fontFamily: "monospace", resize: "none",
                  }}
                />
              </div>

              {/* AI Prompt */}
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: 8 }}>
                <label style={{ fontSize: 13, color: subText, marginBottom: 4, flexShrink: 0 }}>
                  AI 提示詞
                </label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  style={{
                    width: "100%", flex: 1, minHeight: 0, padding: "10px 12px",
                    background: inputBg,
                    border: `1px solid ${borderColor}`, borderRadius: 6, color: textColor,
                    fontSize: 14, fontFamily: "monospace", resize: "none", lineHeight: 1.6,
                  }}
                />
              </div>

              <button
                onClick={generateFromText}
                disabled={loading || inputText.trim().length < 10}
                style={{
                  ...btnStyle, marginTop: 10, flexShrink: 0,
                  background: loading || inputText.trim().length < 10 ? withAlpha(themeInfo.accent, 0.2) : themeInfo.accent,
                  color: "#fff",
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
              color: themeInfo.accent, fontSize: 15,
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🧠⚡</div>
              AI 正在分析內容並整理知識結構...
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, position: "relative", overflow: "hidden", background: themeInfo.accentBg }}>
          <svg ref={svgRef} style={{ width: "100%", height: "100%" }} />
        </div>
      )}

      {/* ── Save Dialog ── */}
      {showSaveDialog && markdown && (
        <div style={overlayStyle}>
          <div style={dialogStyle}>
            <h3 style={{ margin: "0 0 16px 0", color: textColor }}>💾 儲存心智圖</h3>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="輸入名稱..."
              style={{
                width: "100%", padding: "8px 12px", background: inputBg,
                border: `1px solid ${borderColor}`, borderRadius: 6, color: textColor, fontSize: 14,
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setShowSaveDialog(false)} style={btnStyle}>取消</button>
              <button
                onClick={saveMindMap}
                disabled={!saveName.trim()}
                style={{ ...btnStyle, background: saveName.trim() ? themeInfo.accent : withAlpha(themeInfo.accent, 0.2), color: "#fff" }}
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
              <h3 style={{ margin: 0, color: textColor }}>📂 已存的心智圖</h3>
              <button onClick={() => setShowSaved(false)} style={btnStyle}>✕</button>
            </div>
            {savedMaps.length === 0 ? (
              <p style={{ color: subText, textAlign: "center", padding: 24 }}>尚未儲存任何心智圖</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {savedMaps.map(m => (
                  <div
                    key={m.id}
                    onClick={() => loadMindMap(m.id)}
                    style={{
                      padding: "10px 14px", background: inputBg, borderRadius: 6,
                      cursor: "pointer", border: `1px solid ${borderColor}`,
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = themeInfo.accent}
                    onMouseLeave={e => e.currentTarget.style.borderColor = borderColor}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, color: textColor }}>{m.name}</div>
                    {m.summary && <div style={{ fontSize: 12, color: subText, marginTop: 2 }}>{m.summary}</div>}
                    <div style={{ fontSize: 11, color: withAlpha(themeInfo.accentText, 0.45), marginTop: 2 }}>
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
