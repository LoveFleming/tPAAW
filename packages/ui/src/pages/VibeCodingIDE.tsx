/**
 * VibeCodingIDE — VS Code-like IDE for AI-assisted coding
 *
 * Layout:
 *  ┌──────┬──────────────────────────────────────┐
 *  │ File │  Tab Bar                              │
 *  │ Exp  │──────────────────────────────────────│
 *  │      │  Code Editor (auto-save)              │
 *  │      │                                       │
 *  │      │──────────────────────────────────────│
 *  │      │  Terminal Panel (resizable, bottom)   │
 *  └──────┴──────────────────────────────────────┘
 *
 * Features:
 *  - File Explorer (tree view, expand/collapse folders)
 *  - Tab-based file editor with syntax highlighting
 *  - Auto-save with debounce (2s after edit)
 *  - Resizable terminal panel at bottom
 *  - Coding behavior tracking (opened files, edits, time spent)
 *  - Quick actions for AI CLI prompts
 *  - Session management + history
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTheme } from "../theme";
import { cn } from "../utils";
import TerminalConsole from "../components/TerminalConsole";

const API_BASE = "http://127.0.0.1:4097";

// ── Types ──
interface FsItem {
  name: string;
  path: string;
  isDirectory: boolean;
  extension: string | null;
}

interface OpenTab {
  id: string;       // file path
  name: string;
  path: string;
  content: string;
  originalContent: string;
  modified: boolean;
  language: string;
  lastSaved?: string;
}

interface CliSession {
  id: string;
  name: string;
  cli: string;
  model: string;
  cwd: string;
  approvalMode: string;
  systemPrompt: string;
  createdAt: string;
}

interface CodingEvent {
  type: "open_file" | "edit_file" | "save_file" | "close_file" | "terminal_cmd" | "session_start";
  ts: string;
  data: Record<string, any>;
}

// ── Helpers ──
const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  ts: { icon: "TS", color: "#3178C6" },
  tsx: { icon: "TX", color: "#3178C6" },
  js: { icon: "JS", color: "#F7DF1E" },
  jsx: { icon: "JX", color: "#F7DF1E" },
  mjs: { icon: "MJ", color: "#F7DF1E" },
  json: { icon: "{}", color: "#F9A825" },
  md: { icon: "MD", color: "#083FA1" },
  css: { icon: "#", color: "#563D7C" },
  html: { icon: "</>", color: "#E34C26" },
  py: { icon: "PY", color: "#3572A5" },
  go: { icon: "GO", color: "#00ADD8" },
  rs: { icon: "RS", color: "#DEA584" },
  sh: { icon: "SH", color: "#89E051" },
  yaml: { icon: "YL", color: "#CB171E" },
  yml: { icon: "YL", color: "#CB171E" },
  toml: { icon: "TM", color: "#9C4221" },
  sql: { icon: "DB", color: "#E38C00" },
  graphql: { icon: "GQ", color: "#E535AB" },
  env: { icon: "EV", color: "#ECD53F" },
  lock: { icon: "🔒", color: "#6B7280" },
};

const CLI_OPTIONS = [
  { id: "qwen", label: "Qwen Code", icon: "🟣", color: "#8B5CF6" },
  { id: "claude", label: "Claude Code", icon: "🟠", color: "#F97316" },
  { id: "opencode", label: "OpenCode", icon: "🔵", color: "#3B82F6" },
  { id: "aider", label: "Aider", icon: "🟢", color: "#10B981" },
  { id: "custom", label: "Custom", icon: "⚪", color: "#6B7280" },
];

const APPROVAL_MODES = [
  { id: "yolo", label: "YOLO", icon: "🚀" },
  { id: "auto-edit", label: "Auto Edit", icon: "✏️" },
  { id: "default", label: "Default", icon: "🔒" },
];

const QUICK_ACTIONS = [
  { id: "refactor", label: "重構", icon: "🔧", prompt: "請重構這個檔案，改善可讀性和效能" },
  { id: "debug", label: "Debug", icon: "🐛", prompt: "請找出並修復程式中的 bug" },
  { id: "feature", label: "新功能", icon: "✨", prompt: "我要新增一個功能，請先了解現有架構再開始" },
  { id: "review", label: "Review", icon: "👀", prompt: "請 review 目前開啟的程式碼" },
  { id: "test", label: "寫測試", icon: "🧪", prompt: "請為目前的程式碼寫單元測試" },
  { id: "docs", label: "寫文件", icon: "📝", prompt: "請為這個檔案寫文件和註解" },
  { id: "explain", label: "解釋", icon: "💡", prompt: "請解釋這段程式碼在做什麼" },
  { id: "optimize", label: "優化", icon: "⚡", prompt: "請優化這段程式碼的效能" },
];

function getFileIcon(name: string) {
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  if (name === "package.json") return { icon: "📦", color: "#43853D" };
  if (name === "tsconfig.json") return { icon: "TS", color: "#3178C6" };
  if (name === ".env" || name.startsWith(".env.")) return { icon: "EV", color: "#ECD53F" };
  if (name === "Dockerfile") return { icon: "🐳", color: "#2496ED" };
  if (name === "Makefile") return { icon: "MK", color: "#427819" };
  if (name === "README.md") return { icon: "📖", color: "#083FA1" };
  return FILE_ICONS[ext] || { icon: "📄", color: "#6B7280" };
}

function getLanguage(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript",
    json: "json", md: "markdown", css: "css", html: "html", py: "python", go: "go",
    rs: "rust", sh: "bash", yaml: "yaml", yml: "yaml", toml: "toml", sql: "sql",
  };
  return map[ext] || "text";
}

export default function VibeCodingIDE() {
  const { info: themeInfo } = useTheme();

  // ── Layout State ──
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [terminalHeight, setTerminalHeight] = useState(250);
  const [showTerminal, setShowTerminal] = useState(true);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const resizingSidebar = useRef(false);
  const resizingTerminal = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartY = useRef(0);
  const resizeStartSize = useRef(0);

  // ── File Explorer State ──
  const [rootPath, setRootPath] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Record<string, FsItem[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // ── Editor State ──
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Terminal / Session State ──
  const [sessions, setSessions] = useState<CliSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const termRef = useRef<any>(null);

  // ── Coding Behavior Tracking ──
  const [codingLog, setCodingLog] = useState<CodingEvent[]>([]);
  const sessionStartRef = useRef<string>(new Date().toISOString());

  // ── New Session Form ──
  const [formCli, setFormCli] = useState("qwen");
  const [formModel, setFormModel] = useState("");
  const [formCwd, setFormCwd] = useState("");
  const [formApproval, setFormApproval] = useState("yolo");
  const [formName, setFormName] = useState("");

  const activeTab = useMemo(() => openTabs.find(t => t.id === activeTabId), [openTabs, activeTabId]);
  const activeSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId]);

  // ── Load sessions + root path from localStorage ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem("paaw.vibeide.sessions");
      if (saved) { const p = JSON.parse(saved); setSessions(p); if (p.length > 0) setActiveSessionId(p[0].id); }
      const root = localStorage.getItem("paaw.vibeide.rootPath");
      if (root) { setRootPath(root); expandDir(root); }
      const tabs = localStorage.getItem("paaw.vibeide.tabs");
      if (tabs) { const t = JSON.parse(tabs as string); setOpenTabs(t.open); if (t.active) setActiveTabId(t.active); }
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("paaw.vibeide.sessions", JSON.stringify(sessions)); } catch {}
  }, [sessions]);

  useEffect(() => {
    try { localStorage.setItem("paaw.vibeide.rootPath", rootPath); } catch {}
  }, [rootPath]);

  useEffect(() => {
    try { localStorage.setItem("paaw.vibeide.tabs", JSON.stringify({ open: openTabs, active: activeTabId })); } catch {}
  }, [openTabs, activeTabId]);

  // ── Track coding behavior ──
  const logEvent = useCallback((type: CodingEvent["type"], data: Record<string, any>) => {
    const event: CodingEvent = { type, ts: new Date().toISOString(), data };
    setCodingLog(prev => [...prev, event]);
  }, []);

  // ── File Explorer ──
  const expandDir = useCallback(async (path: string) => {
    if (dirContents[path] || loadingDirs.has(path)) return;
    setLoadingDirs(prev => new Set(prev).add(path));
    try {
      const res = await fetch(`${API_BASE}/api/vibe-fs/list?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.items) {
        setDirContents(prev => ({ ...prev, [path]: data.items }));
        setExpandedDirs(prev => new Set(prev).add(path));
      }
    } catch {}
    setLoadingDirs(prev => { const n = new Set(prev); n.delete(path); return n; });
  }, [dirContents, loadingDirs]);

  const toggleDir = useCallback((path: string) => {
    if (expandedDirs.has(path)) {
      setExpandedDirs(prev => { const n = new Set(prev); n.delete(path); return n; });
    } else {
      expandDir(path);
    }
  }, [expandedDirs, expandDir]);

  // ── File Operations ──
  const openFile = useCallback(async (path: string) => {
    const existing = openTabs.find(t => t.path === path);
    if (existing) { setActiveTabId(existing.id); return; }
    setLoadingFile(true);
    try {
      const res = await fetch(`${API_BASE}/api/vibe-fs/read?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.content !== undefined) {
        const name = path.split("/").pop() || path;
        const tab: OpenTab = {
          id: path, name, path,
          content: data.content, originalContent: data.content,
          modified: false, language: getLanguage(name), lastSaved: data.modified,
        };
        setOpenTabs(prev => [...prev, tab]);
        setActiveTabId(path);
        logEvent("open_file", { path, language: tab.language });
      }
    } catch {}
    setLoadingFile(false);
  }, [openTabs, logEvent]);

  const closeTab = useCallback((id: string) => {
    setOpenTabs(prev => prev.filter(t => t.id !== id));
    if (activeTabId === id) {
      const remaining = openTabs.filter(t => t.id !== id);
      setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
    logEvent("close_file", { path: id });
  }, [activeTabId, openTabs, logEvent]);

  const saveFile = useCallback(async (tab: OpenTab) => {
    if (!tab.modified) return;
    try {
      await fetch(`${API_BASE}/api/vibe-fs/write`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: tab.path, content: tab.content }),
      });
      setOpenTabs(prev => prev.map(t =>
        t.id === tab.id ? { ...t, originalContent: t.content, modified: false, lastSaved: new Date().toISOString() } : t
      ));
      logEvent("save_file", { path: tab.path, size: tab.content.length });
    } catch {}
  }, [logEvent]);

  // Auto-save with debounce
  const handleContentChange = useCallback((newContent: string) => {
    if (!activeTabId) return;
    setOpenTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, content: newContent, modified: newContent !== t.originalContent } : t
    ));
    logEvent("edit_file", { path: activeTabId });

    // Debounced auto-save (2s)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const current = openTabs.find(t => t.id === activeTabId);
      if (current?.modified) saveFile(current);
    }, 2000);
  }, [activeTabId, openTabs, saveFile, logEvent]);

  // Keyboard shortcut: Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activeTab?.modified) saveFile(activeTab);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, saveFile]);

  // ── Session Management ──
  const createSession = useCallback(() => {
    const id = `vibe-${Date.now()}`;
    const name = formName || `${CLI_OPTIONS.find(c => c.id === formCli)?.label || formCli}`;
    const session: CliSession = {
      id, name, cli: formCli, model: formModel, cwd: formCwd || rootPath,
      approvalMode: formApproval, systemPrompt: "",
      createdAt: new Date().toISOString(),
    };
    setSessions(prev => [session, ...prev]);
    setActiveSessionId(id);
    setShowSessionPanel(false);
    setFormName("");
    if (!rootPath && session.cwd) { setRootPath(session.cwd); expandDir(session.cwd); }
    logEvent("session_start", { cli: formCli, cwd: session.cwd });
  }, [formCli, formModel, formCwd, formApproval, formName, rootPath, expandDir, logEvent]);

  // ── Quick Action → Terminal ──
  const sendPrompt = useCallback((prompt: string) => {
    if (termRef.current) termRef.current.sendPrompt(prompt);
  }, []);

  // ── Resize Handlers ──
  const handleSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingSidebar.current = true;
    resizeStartX.current = e.clientX;
    resizeStartSize.current = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizingSidebar.current) return;
      const delta = ev.clientX - resizeStartX.current;
      setSidebarWidth(Math.max(180, Math.min(450, resizeStartSize.current + delta)));
    };
    const onUp = () => { resizingSidebar.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const handleTerminalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingTerminal.current = true;
    resizeStartY.current = e.clientY;
    resizeStartSize.current = terminalHeight;
    const onMove = (ev: MouseEvent) => {
      if (!resizingTerminal.current) return;
      const delta = resizeStartY.current - ev.clientY;
      setTerminalHeight(Math.max(100, Math.min(600, resizeStartSize.current + delta)));
    };
    const onUp = () => { resizingTerminal.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [terminalHeight]);

  // ── File Explorer Render ──
  const renderTree = (parentPath: string, depth: number) => {
    const items = dirContents[parentPath];
    if (!items) return null;
    return items.map(item => {
      const fi = getFileIcon(item.name);
      const isExpanded = expandedDirs.has(item.path);
      if (item.isDirectory) {
        return (
          <div key={item.path}>
            <div
              className={cn("flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-stone-100 text-xs select-none", rootPath === item.path && "bg-stone-100")}
              style={{ paddingLeft: depth * 12 + 8 }}
              onClick={() => toggleDir(item.path)}
            >
              <span className="text-[10px] text-stone-400 w-3 shrink-0">{isExpanded ? "▾" : "▸"}</span>
              <span className="text-[10px] shrink-0">📁</span>
              <span className="truncate text-stone-700 font-medium">{item.name}</span>
            </div>
            {isExpanded && renderTree(item.path, depth + 1)}
          </div>
        );
      }
      return (
        <div
          key={item.path}
          className={cn("flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-stone-100 text-xs select-none",
            activeTabId === item.path && "bg-blue-50 text-blue-700")}
          style={{ paddingLeft: depth * 12 + 20 }}
          onClick={() => openFile(item.path)}
        >
          <span className="text-[9px] font-bold shrink-0 w-4 text-center" style={{ color: fi.color }}>{fi.icon}</span>
          <span className="truncate">{item.name}</span>
          {openTabs.find(t => t.id === item.path)?.modified && <span className="text-[8px] text-amber-500 ml-auto shrink-0">●</span>}
        </div>
      );
    });
  };

  // ── Line numbers for editor ──
  const lineCount = useMemo(() => (activeTab?.content || "").split("\n").length, [activeTab?.content]);

  // ── Modified tab count for status ──
  const modifiedCount = useMemo(() => openTabs.filter(t => t.modified).length, [openTabs]);

  return (
    <div className="h-full flex flex-col w-full overflow-hidden" style={{ backgroundColor: "#f5f5f4" }}>
      {/* ── Top Bar ── */}
      <div className="flex items-center h-10 px-3 border-b shrink-0 select-none" style={{ backgroundColor: "#fff", borderColor: "#e5e5e5" }}>
        <span className="text-sm font-bold text-stone-700">⚡ Vibe Coding</span>
        <div className="flex-1" />
        {/* Quick actions */}
        <div className="flex items-center gap-1 mr-2">
          {QUICK_ACTIONS.map(a => (
            <button key={a.id} onClick={() => sendPrompt(a.prompt)} title={a.prompt}
              className="px-2 py-1 rounded text-[10px] font-semibold hover:bg-stone-100 text-stone-500 hover:text-stone-700 transition-colors">
              {a.icon} {a.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowSessionPanel(!showSessionPanel)}
          className={cn("text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors",
            showSessionPanel ? "bg-stone-800 text-white border-stone-800" : "text-stone-500 border-stone-200 hover:bg-stone-50")}>
          {activeSession ? `${activeSession.name}` : "+ Session"}
        </button>
        <button onClick={() => setShowTerminal(!showTerminal)}
          className={cn("text-xs px-2.5 py-1 rounded-lg border font-semibold ml-1.5 transition-colors",
            showTerminal ? "bg-stone-800 text-white border-stone-800" : "text-stone-500 border-stone-200 hover:bg-stone-50")}>
          ⌨️ Terminal
        </button>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex min-h-0">
        {/* ── File Explorer Sidebar ── */}
        <div className="flex flex-col border-r shrink-0 select-none" style={{ width: sidebarWidth, backgroundColor: "#fff", borderColor: "#e5e5e5" }}>
          {/* Root path input */}
          <div className="px-2 py-2 border-b" style={{ borderColor: "#f0f0f0" }}>
            <div className="flex items-center gap-1.5">
              <input value={rootPath} onChange={e => setRootPath(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && rootPath) { expandDir(rootPath); setExpandedDirs(new Set()); } }}
                placeholder="Project root path..."
                className="flex-1 text-[11px] font-mono px-2 py-1.5 border rounded bg-stone-50 outline-none focus:border-blue-400"
                style={{ borderColor: "#e0e0e0" }} />
              <button onClick={() => { expandDir(rootPath); setExpandedDirs(new Set()); }}
                className="text-xs px-2 py-1.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors">
                📂
              </button>
            </div>
          </div>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto py-1" style={{ fontSize: 12 }}>
            {rootPath ? renderTree(rootPath, 0) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
                <span className="text-3xl">📂</span>
                <p className="text-xs text-stone-400">輸入專案路徑<br />開始瀏覽檔案</p>
              </div>
            )}
          </div>

          {/* Sidebar footer */}
          <div className="px-2 py-1.5 border-t flex items-center gap-1" style={{ borderColor: "#f0f0f0" }}>
            <span className="text-[10px] text-stone-400">{rootPath ? rootPath.split("/").pop() : "No project"}</span>
            <span className="flex-1" />
            {codingLog.length > 0 && <span className="text-[10px] text-stone-300">{codingLog.length} actions</span>}
          </div>
        </div>

        {/* ── Sidebar Resize Handle ── */}
        <div className="w-1 cursor-col-resize hover:bg-blue-300 active:bg-blue-500 transition-colors shrink-0"
          onMouseDown={handleSidebarResize} style={{ backgroundColor: "#e5e5e5" }} />

        {/* ── Editor + Terminal Area ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* ── Tab Bar ── */}
          <div className="flex items-end border-b shrink-0 overflow-x-auto" style={{ backgroundColor: "#f5f5f4", borderColor: "#e5e5e5" }}>
            {openTabs.map(tab => {
              const fi = getFileIcon(tab.name);
              return (
                <div key={tab.id}
                  className={cn("group flex items-center gap-1.5 px-3 py-1.5 border-r cursor-pointer select-none text-xs min-w-0 shrink-0 transition-colors",
                    activeTabId === tab.id ? "bg-white text-stone-800 border-t-2" : "text-stone-400 hover:bg-stone-100 border-t-2 border-t-transparent")}
                  style={activeTabId === tab.id ? { borderTopColor: themeInfo.accent } : {}}
                  onClick={() => setActiveTabId(tab.id)}>
                  <span className="text-[9px] font-bold shrink-0" style={{ color: fi.color }}>{fi.icon}</span>
                  <span className="truncate max-w-[120px]">{tab.name}</span>
                  {tab.modified && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />}
                  <button onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                    className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 text-[10px] ml-1 transition-all">✕</button>
                </div>
              );
            })}
            {openTabs.length === 0 && (
              <div className="px-4 py-2 text-xs text-stone-300">No files open</div>
            )}
          </div>

          {/* ── Editor Area ── */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {activeTab ? (
              <div className="flex-1 flex min-w-0 overflow-hidden">
                {/* Line numbers */}
                <div className="shrink-0 select-none text-right pr-3 pt-3 text-[11px] font-mono leading-[1.5] bg-white overflow-hidden"
                  style={{ color: "#c0c0c0", minWidth: 45, backgroundColor: "#fafaf9" }}>
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                {/* Code editor */}
                <textarea
                  value={activeTab.content}
                  onChange={e => handleContentChange(e.target.value)}
                  className="flex-1 min-w-0 p-3 text-[13px] font-mono leading-[1.5] resize-none outline-none bg-white"
                  style={{ tabSize: 2, whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto" }}
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
                <div className="text-5xl">⚡</div>
                <h2 className="text-lg font-bold text-stone-600">Vibe Coding IDE</h2>
                <p className="text-stone-400 text-sm text-center max-w-md leading-relaxed">
                  在左邊打開專案資料夾，點擊檔案開始編輯。<br />
                  底部終端機可以跑 AI CLI（Qwen Code、Claude Code 等）。<br />
                  所有操作自動記錄，隨時可以蒸餾成知識。
                </p>
                <div className="flex gap-2 mt-2">
                  {CLI_OPTIONS.map(cli => (
                    <span key={cli.id} className="text-[11px] px-2.5 py-1 rounded-full border font-semibold"
                      style={{ borderColor: cli.color + "40", color: cli.color, backgroundColor: cli.color + "08" }}>
                      {cli.icon} {cli.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Session Panel (overlay) ── */}
            {showSessionPanel && (
              <div className="absolute right-2 top-12 w-80 bg-white rounded-xl shadow-2xl border z-50 overflow-hidden" style={{ borderColor: "#e0e0e0" }}>
                <div className="px-4 py-3 border-b font-bold text-sm text-stone-700 flex items-center gap-2" style={{ borderColor: "#f0f0f0" }}>
                  ⚡ Sessions
                  <span className="flex-1" />
                  <button onClick={() => setShowSessionPanel(false)} className="text-stone-400 hover:text-stone-700">✕</button>
                </div>
                {/* Active sessions */}
                <div className="max-h-48 overflow-y-auto">
                  {sessions.map(s => {
                    const cliOpt = CLI_OPTIONS.find(c => c.id === s.cli);
                    return (
                      <div key={s.id}
                        className={cn("flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-stone-50 text-xs border-b", activeSessionId === s.id && "bg-blue-50")}
                        style={{ borderColor: "#f5f5f5" }}
                        onClick={() => { setActiveSessionId(s.id); setShowSessionPanel(false); }}>
                        <span>{cliOpt?.icon || "⚪"}</span>
                        <span className="font-semibold text-stone-700 flex-1 truncate">{s.name}</span>
                        <span className="text-[10px] text-stone-400 font-mono">{s.cli}</span>
                        <button onClick={e => { e.stopPropagation(); setSessions(prev => prev.filter(x => x.id !== s.id)); if (activeSessionId === s.id) setActiveSessionId(null); }}
                          className="text-stone-300 hover:text-red-500">✕</button>
                      </div>
                    );
                  })}
                </div>
                {/* New session form */}
                <div className="p-3 border-t space-y-2" style={{ borderColor: "#f0f0f0", backgroundColor: "#fafaf9" }}>
                  <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Session 名稱"
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg outline-none" style={{ borderColor: "#ddd" }} />
                  <div className="flex gap-1">
                    {CLI_OPTIONS.map(cli => (
                      <button key={cli.id} onClick={() => setFormCli(cli.id)}
                        className={cn("flex-1 py-1.5 rounded text-[10px] font-semibold border transition-colors",
                          formCli === cli.id ? "text-white" : "border-stone-200 text-stone-500")}
                        style={formCli === cli.id ? { backgroundColor: cli.color, borderColor: cli.color } : {}}>
                        {cli.icon}
                      </button>
                    ))}
                  </div>
                  <input value={formModel} onChange={e => setFormModel(e.target.value)} placeholder="Model（留空用預設）"
                    className="w-full text-[10px] px-2.5 py-1.5 border rounded-lg font-mono outline-none" style={{ borderColor: "#ddd" }} />
                  <input value={formCwd || rootPath} onChange={e => setFormCwd(e.target.value)} placeholder="工作目錄"
                    className="w-full text-[10px] px-2.5 py-1.5 border rounded-lg font-mono outline-none" style={{ borderColor: "#ddd" }} />
                  <div className="flex gap-1">
                    {APPROVAL_MODES.map(m => (
                      <button key={m.id} onClick={() => setFormApproval(m.id)}
                        className={cn("flex-1 py-1.5 rounded text-[10px] font-semibold border transition-colors",
                          formApproval === m.id ? "border-stone-400 bg-white text-stone-700" : "border-stone-200 text-stone-400")}
                      >{m.icon} {m.label}</button>
                    ))}
                  </div>
                  <button onClick={createSession}
                    className="w-full py-2 rounded-lg text-xs font-bold text-white transition-all active:scale-95"
                    style={{ backgroundColor: themeInfo.accent }}>
                    🚀 Start Session
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Terminal Resize Handle ── */}
          {showTerminal && (
            <div className="h-1 cursor-row-resize hover:bg-blue-300 active:bg-blue-500 transition-colors shrink-0"
              onMouseDown={handleTerminalResize} style={{ backgroundColor: "#e5e5e5" }} />
          )}

          {/* ── Terminal Panel ── */}
          {showTerminal && (
            <div className="shrink-0 flex flex-col" style={{ height: terminalHeight }}>
              {/* Terminal header */}
              <div className="flex items-center px-3 py-1 border-b shrink-0 select-none" style={{ backgroundColor: "#1e1e2e", borderColor: "#313244" }}>
                <span className="text-[10px] text-stone-400 font-semibold">
                  {activeSession ? `${activeSession.name} (${activeSession.cli})` : "Terminal — Create a session to start"}
                </span>
                <span className="flex-1" />
                {activeSession && (
                  <div className="flex items-center gap-1">
                    {QUICK_ACTIONS.slice(0, 5).map(a => (
                      <button key={a.id} onClick={() => sendPrompt(a.prompt)} title={a.label}
                        className="text-[9px] px-1.5 py-0.5 rounded text-stone-400 hover:text-white hover:bg-stone-700 transition-colors">
                        {a.icon}
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setShowTerminal(false)} className="text-stone-500 hover:text-white text-[10px] ml-2">✕</button>
              </div>
              {/* Terminal body */}
              <div className="flex-1 min-h-0">
                {activeSession ? (
                  <TerminalConsole key={activeSession.id} ref={termRef}
                    cli={activeSession.cli} model={activeSession.model || undefined}
                    cwd={activeSession.cwd} approvalMode={activeSession.approvalMode} />
                ) : (
                  <div className="flex items-center justify-center h-full" style={{ backgroundColor: "#1e1e2e" }}>
                    <p className="text-xs text-stone-500">點擊上方 ⚡ Sessions 建立 CLI session</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Status Bar ── */}
      <div className="flex items-center h-6 px-3 border-t shrink-0 select-none text-[10px]" style={{ backgroundColor: "#fff", borderColor: "#e5e5e5" }}>
        {activeTab && (
          <>
            <span className="text-stone-500">{activeTab.language}</span>
            <span className="text-stone-300 mx-1.5">|</span>
            <span className="text-stone-500">UTF-8</span>
            <span className="text-stone-300 mx-1.5">|</span>
            <span className="text-stone-500">{activeTab.content.split("\n").length} lines</span>
            <span className="text-stone-300 mx-1.5">|</span>
            <span className="text-stone-400 font-mono truncate max-w-[300px]">{activeTab.path}</span>
          </>
        )}
        <span className="flex-1" />
        {modifiedCount > 0 && <span className="text-amber-500 mr-2">{modifiedCount} unsaved</span>}
        {activeSession && (
          <span className="text-stone-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {activeSession.cli} · {activeSession.cwd.split("/").pop()}
          </span>
        )}
        <span className="text-stone-300 mx-1.5">|</span>
        <span className="text-stone-400">{codingLog.length} actions tracked</span>
      </div>
    </div>
  );
}
