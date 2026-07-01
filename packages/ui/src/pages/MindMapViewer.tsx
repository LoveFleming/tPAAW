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
import { useI18n } from "../i18n";
import API_BASE from "../api";

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
  const { t: tt } = useI18n();
  const { info: themeInfo, theme: themeId } = useTheme();

  // 跟 CodingIDE 一樣的 token 系統：白色外圍 + 主題色點綴
  const tk = {
    bg:           "#fff",
    bgMuted:      "#fafafa",
    bgHover:      themeInfo.accentLight || "#f5f5f4",
    border:       themeInfo.accentBorder || "#e5e5e5",
    borderLight:  "#f0f0f0",
    borderInput:  "#e0e0e0",
    textMuted:    "#9ca3af",
    textPrimary:  "#374151",
    textSecondary:"#6b7280",
    accent:       themeInfo.accent,
    accentBg:     themeInfo.accentBg,
    accentText:   themeInfo.accentText,
    accentHover:  themeInfo.accentHover,
    accentLight:  themeInfo.accentLight,
  };

  // Mind map state
  const [markdown, setMarkdown] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "text">("select");
  const [prompt, setPrompt] = useState(tt("mindmap.defaultPrompt"));
  const [inputText, setInputText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [browserPath, setBrowserPath] = useState<string>("");
  const [browserDirs, setBrowserDirs] = useState<FileItem[]>([]);
  const [browserFiles, setBrowserFiles] = useState<FileItem[]>([]);
  const [savedMaps, setSavedMaps] = useState<SavedMindMap[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [promptPreview, setPromptPreview] = useState(false);
  const [promptPreviewContent, setPromptPreviewContent] = useState<{system: string; user: string; model: string} | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [showUserPrompt, setShowUserPrompt] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // ── Model selector state ──
  const [providers, setProviders] = useState<Record<string, any>>({});
  const [activeProviderId, setActiveProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/paaw/providers`)
      .then(r => r.json())
      .then(data => {
        setProviders(data.providers || {});
        setActiveProviderId(data.active || "");
        setSelectedModel(data.defaultModel || "");
      })
      .catch(() => {});
  }, []);

  const allModels = useCallback(() => {
    const result: { providerId: string; providerName: string; modelId: string; modelName: string }[] = [];
    for (const [pid, p] of Object.entries(providers)) {
      for (const m of (p.models || [])) {
        result.push({ providerId: pid, providerName: p.name, modelId: m.id, modelName: m.name });
      }
    }
    return result;
  }, [providers]);

  const activeModelName = allModels().find(m => `${m.providerId}/${m.modelId}` === selectedModel || m.modelId === selectedModel)?.modelName || selectedModel || "預設";
  const fullModelForApi = useCallback(() => {
    if (!selectedModel) return undefined;
    if (selectedModel.includes("/")) return selectedModel;
    return `${activeProviderId}/${selectedModel}`;
  }, [selectedModel, activeProviderId]);

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
          --markmap-text-color: ${tk.textPrimary};
          --markmap-circle-open-bg: ${tk.accent};
          --markmap-a-color: ${tk.accent};
          --markmap-a-hover-color: ${tk.accentHover};
          --markmap-code-bg: ${tk.bgMuted};
          --markmap-code-color: ${tk.textPrimary};
          --markmap-font: 400 15px/22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .${id} foreignObject div { color: ${tk.textPrimary} !important; }
        .${id} .markmap-node text { fill: ${tk.textPrimary}; }
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

  // ── Preview Prompts ──
  const previewPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const textContent = mode === "text" ? inputText : "(從檔案讀取)";
      const body: any = { text: textContent, prompt, model: fullModelForApi() };
      const resp = await fetch("/api/mindmap/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || "預覽失敗");
      setPromptPreviewContent({ system: data.systemPrompt, user: data.userPrompt, model: data.model });
      setPromptPreview(true);
      setShowSystemPrompt(false);
      setShowUserPrompt(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [mode, inputText, prompt]);

  // ── Generate from files ──
  const generateFromFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body: any = { prompt };
      const model = fullModelForApi();
      if (model) body.model = model;
      if (selectedDir) body.dir = selectedDir;
      else if (selectedFiles.length > 0) body.files = selectedFiles;
      else {
        setError(tt("mindmap.selectFile"));
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
      setError(tt("mindmap.needMoreText"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/mindmap/from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText, prompt, model: fullModelForApi() }),
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
    bg.setAttribute("fill", tk.bgHover);
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
    background: tk.bgMuted,
    border: `1px solid ${tk.border}`,
    borderRadius: 6,
    color: tk.textSecondary,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const tabStyle: React.CSSProperties = {
    padding: "8px 16px",
    background: tk.bgMuted,
    border: `1px solid ${tk.borderLight}`,
    borderRadius: 6,
    color: tk.textSecondary,
    fontSize: 14,
    cursor: "pointer",
  };

  const activeTabStyle: React.CSSProperties = {
    ...tabStyle,
    background: tk.accent,
    border: `1px solid ${tk.accent}`,
    color: "#ffffff",
  };

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.25)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  };

  const dialogStyle: React.CSSProperties = {
    background: tk.bg,
    borderRadius: 12,
    padding: 24,
    minWidth: 400,
    maxWidth: 500,
    border: `1px solid ${tk.border}`,
    boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
  };

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: tk.bg, color: tk.textPrimary,
    }}>
      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
        background: tk.bg, borderBottom: `1px solid ${tk.border}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, marginRight: 8, color: tk.accent }}>
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
        {markdown && <button onClick={() => setShowSaveDialog(true)} style={btnStyle}>{tt("appBuilder.saveButton")}</button>}
        <button onClick={() => { loadSavedList(); setShowSaved(true); }} style={btnStyle}>📂 載入</button>
        {/* Model selector */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            style={{ ...btnStyle, minWidth: 120, justifyContent: "space-between" }}
            title="AI Model 偏好"
          >
            🤖 {activeModelName} ▾
          </button>
          {showModelDropdown && (
            <div style={{
              position: "absolute", top: "100%", right: 0, marginTop: 4,
              background: tk.bg, border: `1px solid ${tk.border}`, borderRadius: 8,
              boxShadow: "0 4px 16px rgba(0,0,0,0.1)", zIndex: 50,
              maxHeight: 300, overflow: "auto", minWidth: 200,
            }}>
              {allModels().map(m => {
                const fullId = `${m.providerId}/${m.modelId}`;
                const isActive = fullId === selectedModel || m.modelId === selectedModel;
                return (
                  <div
                    key={fullId}
                    onClick={() => { setSelectedModel(fullId); setShowModelDropdown(false); }}
                    style={{
                      padding: "8px 14px", cursor: "pointer", fontSize: 13,
                      display: "flex", alignItems: "center", gap: 6,
                      color: tk.textPrimary,
                      background: isActive ? tk.accentBg : "transparent",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = tk.bgHover}
                    onMouseLeave={e => e.currentTarget.style.background = isActive ? tk.accentBg : "transparent"}
                  >
                    {isActive && <span style={{ color: tk.accent }}>✓</span>}
                    <div>
                      <div style={{ fontWeight: 500 }}>{m.modelName}</div>
                      <div style={{ fontSize: 11, color: tk.textMuted }}>{m.providerName}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
                <span style={{ fontSize: 13, color: tk.textMuted, fontFamily: "monospace" }}>{browserPath || "/"}</span>
              </div>

              {/* File list */}
              <div style={{
                background: tk.bgMuted, borderRadius: 8, border: `1px solid ${tk.borderLight}`,
                flex: 2, minHeight: 0, overflow: "auto", padding: 8,
              }}>
                <div
                  onClick={() => { setSelectedDir(browserPath); setSelectedFiles([]); }}
                  style={{
                    padding: "8px 12px", cursor: "pointer", borderRadius: 4,
                    background: selectedDir === browserPath ? tk.accentBg : "transparent",
                    display: "flex", alignItems: "center", gap: 8,
                  }}
                >
                  <span>📂</span>
                  <span style={{ fontWeight: 600, color: tk.textPrimary }}>選擇整個目錄: {browserPath.split("/").pop() || "/"}</span>
                  {selectedDir === browserPath && <span style={{ color: tk.accent }}>✓</span>}
                </div>

                {browserDirs.map(d => (
                  <div
                    key={d.path}
                    onClick={() => browsePath(d.path)}
                    style={{ padding: "6px 12px", cursor: "pointer", borderRadius: 4, display: "flex", alignItems: "center", gap: 8, color: tk.textPrimary }}
                    onMouseEnter={e => e.currentTarget.style.background = tk.bgHover}
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
                        background: selected ? tk.accentBg : "transparent",
                        display: "flex", alignItems: "center", gap: 8, color: tk.textPrimary,
                      }}
                      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = tk.bgHover; }}
                      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span>{selected ? "✅" : "📄"}</span><span>{f.name}</span>
                    </div>
                  );
                })}
              </div>

              {/* Selection Summary */}
              <div style={{ marginTop: 6, fontSize: 13, color: tk.textMuted, flexShrink: 0 }}>
                {selectedDir && `已選目錄: ${selectedDir}`}
                {selectedFiles.length > 0 && `已選 ${selectedFiles.length} 個檔案`}
              </div>

              {/* AI Prompt */}
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: 6 }}>
                <label style={{ fontSize: 13, color: tk.textMuted, marginBottom: 4, flexShrink: 0 }}>
                  AI 提示詞
                </label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  style={{
                    width: "100%", flex: 1, minHeight: 0, padding: "10px 12px",
                    background: tk.bg,
                    border: `1px solid ${tk.borderInput}`, borderRadius: 6, color: tk.textPrimary,
                    fontSize: 14, fontFamily: "monospace", resize: "none", lineHeight: 1.6,
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexShrink: 0 }}>
                <button
                  onClick={generateFromFiles}
                  disabled={loading || (!selectedDir && selectedFiles.length === 0)}
                  style={{
                    ...btnStyle,
                    background: loading || (!selectedDir && selectedFiles.length === 0) ? tk.bgMuted : tk.accent,
                    color: loading || (!selectedDir && selectedFiles.length === 0) ? tk.textMuted : "#fff",
                    fontSize: 15, padding: "10px 24px",
                    cursor: loading || (!selectedDir && selectedFiles.length === 0) ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? tt("mindmap.generating") : tt("mindmap.generateButton")}
                </button>
                <button onClick={previewPrompts} disabled={loading}
                  style={{ ...btnStyle, fontSize: 13, padding: "8px 14px", background: tk.bg, border: `1px solid ${tk.border}`, color: tk.textPrimary, cursor: loading ? "not-allowed" : "pointer" }}
                  title="查看完整提示詞"
                >📋 Prompt</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              {/* Text input */}
              <div style={{ display: "flex", flexDirection: "column", flex: 2, minHeight: 0 }}>
                <label style={{ fontSize: 13, color: tk.textMuted, marginBottom: 4, flexShrink: 0 }}>
                  要整理的內容
                </label>
                <textarea
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder={tt("mindmap.textPlaceholder")}
                  style={{
                    width: "100%", flex: 1, minHeight: 0, padding: 12,
                    background: tk.bg,
                    border: `1px solid ${tk.borderInput}`, borderRadius: 8, color: tk.textPrimary,
                    fontSize: 14, fontFamily: "monospace", resize: "none",
                  }}
                />
              </div>

              {/* AI Prompt */}
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: 8 }}>
                <label style={{ fontSize: 13, color: tk.textMuted, marginBottom: 4, flexShrink: 0 }}>
                  AI 提示詞
                </label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  style={{
                    width: "100%", flex: 1, minHeight: 0, padding: "10px 12px",
                    background: tk.bg,
                    border: `1px solid ${tk.borderInput}`, borderRadius: 6, color: tk.textPrimary,
                    fontSize: 14, fontFamily: "monospace", resize: "none", lineHeight: 1.6,
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexShrink: 0 }}>
                <button
                  onClick={generateFromText}
                  disabled={loading || inputText.trim().length < 10}
                  style={{
                    ...btnStyle,
                    background: loading || inputText.trim().length < 10 ? tk.bgMuted : tk.accent,
                    color: loading || inputText.trim().length < 10 ? tk.textMuted : "#fff",
                    fontSize: 15, padding: "10px 24px",
                    cursor: loading || inputText.trim().length < 10 ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? tt("mindmap.generating") : tt("mindmap.generateButton")}
                </button>
                <button onClick={previewPrompts} disabled={loading}
                  style={{ ...btnStyle, fontSize: 13, padding: "8px 14px", background: tk.bg, border: `1px solid ${tk.border}`, color: tk.textPrimary, cursor: loading ? "not-allowed" : "pointer" }}
                  title="查看完整提示詞"
                >📋 Prompt</button>
              </div>
            </div>
          )}

          {loading && (
            <div style={{
              marginTop: 24, textAlign: "center", padding: 40,
              color: tk.accent, fontSize: 15,
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🧠⚡</div>
              AI 正在分析內容並整理知識結構...
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, position: "relative", overflow: "hidden", background: tk.accentBg }}>
          <svg ref={svgRef} style={{ width: "100%", height: "100%" }} />
        </div>
      )}

      {/* ── Save Dialog ── */}
      {showSaveDialog && markdown && (
        <div style={overlayStyle}>
          <div style={dialogStyle}>
            <h3 style={{ margin: "0 0 16px 0", color: tk.textPrimary }}>💾 儲存心智圖</h3>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder={tt("mindmap.namePlaceholder")}
              style={{
                width: "100%", padding: "8px 12px", background: tk.bgMuted,
                border: `1px solid ${tk.borderInput}`, borderRadius: 6, color: tk.textPrimary, fontSize: 14,
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setShowSaveDialog(false)} style={btnStyle}>{tt("common.cancel")}</button>
              <button
                onClick={saveMindMap}
                disabled={!saveName.trim()}
                style={{ ...btnStyle, background: saveName.trim() ? tk.accent : tk.bgMuted, color: saveName.trim() ? "#fff" : tk.textMuted }}
              >{tt("common.save")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Saved List Dialog ── */}
      {showSaved && (
        <div style={overlayStyle}>
          <div style={{ ...dialogStyle, maxHeight: 500, overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, color: tk.textPrimary }}>📂 已存的心智圖</h3>
              <button onClick={() => setShowSaved(false)} style={btnStyle}>✕</button>
            </div>
            {savedMaps.length === 0 ? (
              <p style={{ color: tk.textMuted, textAlign: "center", padding: 24 }}>尚未儲存任何心智圖</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {savedMaps.map(m => (
                  <div
                    key={m.id}
                    onClick={() => loadMindMap(m.id)}
                    style={{
                      padding: "10px 14px", background: tk.bgMuted, borderRadius: 6,
                      cursor: "pointer", border: `1px solid ${tk.borderLight}`,
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = tk.accent}
                    onMouseLeave={e => e.currentTarget.style.borderColor = tk.borderLight}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, color: tk.textPrimary }}>{m.name}</div>
                    {m.summary && <div style={{ fontSize: 12, color: tk.textSecondary, marginTop: 2 }}>{m.summary}</div>}
                    <div style={{ fontSize: 11, color: tk.textMuted, marginTop: 2 }}>
                      {new Date(m.createdAt).toLocaleString("zh-TW")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Prompt Preview Modal */}
      {promptPreview && promptPreviewContent && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setPromptPreview(false)}>
          <div style={{ background: "#1e1e2e", borderRadius: 12, width: "80vw", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #333" }}>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>📋 Prompt 預覽</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#888", fontSize: 11 }}>{promptPreviewContent.model}</span>
                <button onClick={() => setPromptPreview(false)} style={{ color: "#888", background: "none", border: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <h3 onClick={() => setShowSystemPrompt(v => !v)} style={{ color: "#34d399", fontSize: 12, fontWeight: 700, cursor: "pointer", userSelect: "none", margin: 0, marginBottom: 8 }}>
                  ═ System Prompt ({promptPreviewContent.system.length} chars) ═ {showSystemPrompt ? "▼" : "▶"}
                </h3>
                {showSystemPrompt && (
                  <pre style={{ color: "#d1d5db", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 12, maxHeight: "35vh", overflow: "auto", margin: 0 }}>{promptPreviewContent.system}</pre>
                )}
              </div>
              <div>
                <h3 onClick={() => setShowUserPrompt(v => !v)} style={{ color: "#fbbf24", fontSize: 12, fontWeight: 700, cursor: "pointer", userSelect: "none", margin: 0, marginBottom: 8 }}>
                  ═ User Prompt ({promptPreviewContent.user.length} chars) ═ {showUserPrompt ? "▼" : "▶"}
                </h3>
                {showUserPrompt && (
                  <pre style={{ color: "#d1d5db", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 12, maxHeight: "35vh", overflow: "auto", margin: 0 }}>{promptPreviewContent.user}</pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
