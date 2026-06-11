/**
 * VibeCodingIDE — VS Code-like IDE for AI-assisted coding
 *
 * Layout:
 *  ┌──────┬──────────────────────────┬─────────┐
 *  │ File │  Tab Bar                 │  AI     │
 *  │ Exp  │──────────────────────────│ Chat    │
 *  │      │  Code Editor (highlight) │ Sidebar │
 *  │      │                          │         │
 *  │      │──────────────────────────│         │
 *  │      │  Terminal Panel (resize) │         │
 *  └──────┴──────────────────────────┴─────────┘
 *
 * Features:
 *  - File Explorer (tree view)
 *  - Syntax-highlighted code editor (hljs) with auto-save
 *  - Tab-based file management
 *  - AI Chat sidebar (PAAW chat integration)
 *  - Terminal panel (resizable)
 *  - Coding behavior tracking → Distillation Engine
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTheme } from "../theme";
import { cn } from "../utils";
import TerminalConsole from "../components/TerminalConsole";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";

const API_BASE = "http://127.0.0.1:4097";

// ── Types ──
interface FsItem {
  name: string;
  path: string;
  isDirectory: boolean;
  extension: string | null;
}

interface OpenTab {
  id: string;
  name: string;
  path: string;
  content: string;
  originalContent: string;
  modified: boolean;
  language: string;
  hljsLang: string;
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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

interface CodingEvent {
  type: "open_file" | "edit_file" | "save_file" | "close_file" | "terminal_cmd" | "session_start" | "ai_chat";
  ts: string;
  data: Record<string, any>;
}

// ── Constants ──
const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  ts: { icon: "TS", color: "#3178C6" }, tsx: { icon: "TX", color: "#3178C6" },
  js: { icon: "JS", color: "#F7DF1E" }, jsx: { icon: "JX", color: "#F7DF1E" },
  mjs: { icon: "MJ", color: "#F7DF1E" }, json: { icon: "{}", color: "#F9A825" },
  md: { icon: "MD", color: "#083FA1" }, css: { icon: "#", color: "#563D7C" },
  html: { icon: "</>", color: "#E34C26" }, py: { icon: "PY", color: "#3572A5" },
  go: { icon: "GO", color: "#00ADD8" }, rs: { icon: "RS", color: "#DEA584" },
  sh: { icon: "SH", color: "#89E051" }, yaml: { icon: "YL", color: "#CB171E" },
  yml: { icon: "YL", color: "#CB171E" }, sql: { icon: "DB", color: "#E38C00" },
  env: { icon: "EV", color: "#ECD53F" }, lock: { icon: "🔒", color: "#6B7280" },
  toml: { icon: "TM", color: "#9C4221" }, graphql: { icon: "GQ", color: "#E535AB" },
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

// ── Helpers ──
function getFileIcon(name: string) {
  if (name === "package.json") return { icon: "📦", color: "#43853D" };
  if (name === "tsconfig.json") return { icon: "TS", color: "#3178C6" };
  if (name === "Dockerfile") return { icon: "🐳", color: "#2496ED" };
  if (name === "Makefile") return { icon: "MK", color: "#427819" };
  if (name === "README.md") return { icon: "📖", color: "#083FA1" };
  const ext = name.includes(".") ? name.split(".").pop()! : "";
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

function getHljsLang(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript",
    json: "json", md: "markdown", css: "css", html: "xml", py: "python", go: "go",
    rs: "rust", sh: "bash", yaml: "yaml", yml: "yaml", toml: "ini", sql: "sql",
  };
  return map[ext] || "";
}

function escapeHtml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function VibeCodingIDE() {
  const { info: themeInfo } = useTheme();

  // ── Layout State ──
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [aiPanelWidth, setAiPanelWidth] = useState(320);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [showTerminal, setShowTerminal] = useState(true);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const resizingRef = useRef<{ type: "sidebar" | "ai" | "terminal"; startX: number; startY: number; startSize: number } | null>(null);

  // ── File Explorer State ──
  const [rootPath, setRootPath] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Record<string, FsItem[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // ── Editor State ──
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorScrollRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  // ── Terminal / Session State ──
  const [sessions, setSessions] = useState<CliSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const termRef = useRef<any>(null);

  // ── AI Chat State ──
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Coding Behavior Tracking ──
  const codingLogRef = useRef<CodingEvent[]>([]);
  const distillTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── New Session Form ──
  const [formCli, setFormCli] = useState("qwen");
  const [formModel, setFormModel] = useState("");
  const [formCwd, setFormCwd] = useState("");
  const [formApproval, setFormApproval] = useState("yolo");
  const [formName, setFormName] = useState("");

  const activeTab = useMemo(() => openTabs.find(t => t.id === activeTabId), [openTabs, activeTabId]);
  const activeSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId]);

  // ═══════════════════════════════════════════════
  // Init: load saved state
  // ═══════════════════════════════════════════════
  useEffect(() => {
    try {
      const saved = localStorage.getItem("paaw.vibeide.sessions");
      if (saved) { const p = JSON.parse(saved); setSessions(p); if (p.length > 0) setActiveSessionId(p[0].id); }
      const root = localStorage.getItem("paaw.vibeide.rootPath");
      if (root) { setRootPath(root); expandDir(root); }
    } catch {}
  }, []);

  useEffect(() => { try { localStorage.setItem("paaw.vibeide.sessions", JSON.stringify(sessions)); } catch {} }, [sessions]);
  useEffect(() => { try { localStorage.setItem("paaw.vibeide.rootPath", rootPath); } catch {} }, [rootPath]);

  // ═══════════════════════════════════════════════
  // 1. Coding Behavior Tracking → Distillation Engine
  // ═══════════════════════════════════════════════
  const logEvent = useCallback((type: CodingEvent["type"], data: Record<string, any>) => {
    const event: CodingEvent = { type, ts: new Date().toISOString(), data };
    codingLogRef.current = [...codingLogRef.current, event];
  }, []);

  // Flush coding events to distill engine every 30s
  useEffect(() => {
    distillTimerRef.current = setInterval(async () => {
      const events = codingLogRef.current;
      if (events.length === 0) return;
      codingLogRef.current = [];
      try {
        await fetch(`${API_BASE}/api/distill/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "vibe-coding",
            events,
            rootPath,
            activeFiles: openTabs.map(t => t.path),
            session: activeSession ? { cli: activeSession.cli, cwd: activeSession.cwd } : null,
          }),
        });
      } catch {}
    }, 30_000);
    return () => { if (distillTimerRef.current) clearInterval(distillTimerRef.current); };
  }, [rootPath, openTabs, activeSession]);

  // ═══════════════════════════════════════════════
  // File Explorer
  // ═══════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════
  // File Operations
  // ═══════════════════════════════════════════════
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
          modified: false, language: getLanguage(name), hljsLang: getHljsLang(name),
          lastSaved: data.modified,
        };
        setOpenTabs(prev => [...prev, tab]);
        setActiveTabId(path);
        setIsEditing(false);
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

  // Switch between view (highlighted) and edit (textarea) modes
  const startEditing = useCallback(() => {
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const stopEditing = useCallback(() => {
    setIsEditing(false);
    // Auto-save on blur
    if (activeTab?.modified) saveFile(activeTab);
  }, [activeTab, saveFile]);

  const handleContentChange = useCallback((newContent: string) => {
    if (!activeTabId) return;
    setOpenTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, content: newContent, modified: newContent !== t.originalContent } : t
    ));
    logEvent("edit_file", { path: activeTabId });
    // Debounced auto-save (3s)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const current = openTabs.find(t => t.id === activeTabId);
      if (current?.modified) saveFile(current);
    }, 3000);
  }, [activeTabId, openTabs, saveFile, logEvent]);

  // Cmd+S
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

  // ═══════════════════════════════════════════════
  // 2. AI Chat Sidebar
  // ═══════════════════════════════════════════════
  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput.trim(), ts: new Date().toISOString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    logEvent("ai_chat", { prompt: chatInput.trim().slice(0, 200) });

    try {
      // Build context from active file
      const context = activeTab
        ? `\n\n[Current file: ${activeTab.path}]\n\`\`\`${activeTab.hljsLang}\n${activeTab.content.slice(0, 3000)}\n\`\`\``
        : "";

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMsg.content + context }],
          providerId: "default",
          appId: "vibe-coding",
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Read SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const chunk = JSON.parse(line.slice(6));
              if (chunk.content) {
                assistantContent += chunk.content;
                setChatMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [...prev.slice(0, -1), { ...last, content: assistantContent }];
                  }
                  return [...prev, { role: "assistant", content: assistantContent, ts: new Date().toISOString() }];
                });
              }
            } catch {}
          }
        }
      }
      // Final update
      if (assistantContent) {
        setChatMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.content === assistantContent) return prev;
          return [...prev, { role: "assistant", content: assistantContent, ts: new Date().toISOString() }];
        });
      }
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: "assistant", content: `❌ Error: ${err.message}`, ts: new Date().toISOString() }]);
    }
    setChatLoading(false);
  }, [chatInput, chatLoading, activeTab, logEvent]);

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // ═══════════════════════════════════════════════
  // Session Management
  // ═══════════════════════════════════════════════
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

  const sendPrompt = useCallback((prompt: string) => {
    if (termRef.current) termRef.current.sendPrompt(prompt);
  }, []);

  // ═══════════════════════════════════════════════
  // Resize Handlers
  // ═══════════════════════════════════════════════
  const startResize = useCallback((type: "sidebar" | "ai" | "terminal", e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startSize = type === "sidebar" ? sidebarWidth : type === "ai" ? aiPanelWidth : terminalHeight;
    resizingRef.current = { type, startX, startY, startSize };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const r = resizingRef.current;
      if (r.type === "sidebar") {
        setSidebarWidth(Math.max(180, Math.min(450, r.startSize + ev.clientX - r.startX)));
      } else if (r.type === "ai") {
        setAiPanelWidth(Math.max(240, Math.min(600, r.startSize + r.startX - ev.clientX)));
      } else {
        setTerminalHeight(Math.max(100, Math.min(600, r.startSize + r.startY - ev.clientY)));
      }
    };
    const onUp = () => { resizingRef.current = null; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth, aiPanelWidth, terminalHeight]);

  // ═══════════════════════════════════════════════
  // Highlighted code rendering
  // ═══════════════════════════════════════════════
  const highlightedCode = useMemo(() => {
    if (!activeTab) return "";
    try {
      if (activeTab.hljsLang) {
        return hljs.highlight(activeTab.content, { language: activeTab.hljsLang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(activeTab.content).value;
    } catch {
      return escapeHtml(activeTab.content);
    }
  }, [activeTab?.content, activeTab?.hljsLang]);

  const lines = useMemo(() => (activeTab?.content || "").split("\n"), [activeTab?.content]);
  const lineCount = lines.length;
  const lineNumWidth = Math.max(3, String(lineCount).length) * 10 + 16;
  const modifiedCount = useMemo(() => openTabs.filter(t => t.modified).length, [openTabs]);

  // ── File Explorer Tree Render ──
  const renderTree = (parentPath: string, depth: number) => {
    const items = dirContents[parentPath];
    if (!items) return null;
    return items.map(item => {
      const fi = getFileIcon(item.name);
      const isExpanded = expandedDirs.has(item.path);
      if (item.isDirectory) {
        return (
          <div key={item.path}>
            <div className={cn("flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-stone-100 text-xs select-none")}
              style={{ paddingLeft: depth * 12 + 8 }} onClick={() => toggleDir(item.path)}>
              <span className="text-[10px] text-stone-400 w-3 shrink-0">{isExpanded ? "▾" : "▸"}</span>
              <span className="text-[10px] shrink-0">📁</span>
              <span className="truncate text-stone-700 font-medium">{item.name}</span>
            </div>
            {isExpanded && renderTree(item.path, depth + 1)}
          </div>
        );
      }
      return (
        <div key={item.path}
          className={cn("flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-stone-100 text-xs select-none",
            activeTabId === item.path && "bg-blue-50 text-blue-700")}
          style={{ paddingLeft: depth * 12 + 20 }} onClick={() => openFile(item.path)}>
          <span className="text-[9px] font-bold shrink-0 w-4 text-center" style={{ color: fi.color }}>{fi.icon}</span>
          <span className="truncate">{item.name}</span>
          {openTabs.find(t => t.id === item.path)?.modified && <span className="text-[8px] text-amber-500 ml-auto shrink-0">●</span>}
        </div>
      );
    });
  };

  // ═══════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════
  return (
    <div className="h-full flex flex-col w-full overflow-hidden" style={{ backgroundColor: "#f5f5f4" }}>
      {/* ── Top Bar ── */}
      <div className="flex items-center h-9 px-3 border-b shrink-0 select-none" style={{ backgroundColor: "#fff", borderColor: "#e5e5e5" }}>
        <span className="text-sm font-bold text-stone-700">⚡ Vibe Coding</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 mr-2 overflow-hidden">
          {QUICK_ACTIONS.map(a => (
            <button key={a.id} onClick={() => sendPrompt(a.prompt)} title={`${a.label}: ${a.prompt}`}
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition-colors whitespace-nowrap">
              {a.icon} {a.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAiPanel(!showAiPanel)}
          className={cn("text-[10px] px-2 py-1 rounded-lg border font-semibold transition-colors",
            showAiPanel ? "bg-stone-800 text-white border-stone-800" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
          🤖 AI
        </button>
        <button onClick={() => setShowSessionPanel(!showSessionPanel)}
          className={cn("text-[10px] px-2 py-1 rounded-lg border font-semibold ml-1 transition-colors",
            showSessionPanel ? "bg-stone-800 text-white border-stone-800" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
          {activeSession ? `${activeSession.name}` : "+ Session"}
        </button>
        <button onClick={() => setShowTerminal(!showTerminal)}
          className={cn("text-[10px] px-2 py-1 rounded-lg border font-semibold ml-1 transition-colors",
            showTerminal ? "bg-stone-800 text-white border-stone-800" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
          ⌨️ Term
        </button>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex min-h-0">
        {/* ── File Explorer ── */}
        <div className="flex flex-col border-r shrink-0 select-none" style={{ width: sidebarWidth, backgroundColor: "#fff", borderColor: "#e5e5e5" }}>
          <div className="px-2 py-1.5 border-b" style={{ borderColor: "#f0f0f0" }}>
            <div className="flex items-center gap-1.5">
              <input value={rootPath} onChange={e => setRootPath(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && rootPath) { expandDir(rootPath); setExpandedDirs(new Set()); } }}
                placeholder="Project path..."
                className="flex-1 text-[11px] font-mono px-2 py-1 border rounded bg-stone-50 outline-none focus:border-blue-400" style={{ borderColor: "#e0e0e0" }} />
              <button onClick={() => { expandDir(rootPath); setExpandedDirs(new Set()); }}
                className="text-xs px-1.5 py-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-600">📂</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-0.5" style={{ fontSize: 12 }}>
            {rootPath ? renderTree(rootPath, 0) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
                <span className="text-3xl">📂</span>
                <p className="text-xs text-stone-400">輸入專案路徑開始瀏覽</p>
              </div>
            )}
          </div>
          <div className="px-2 py-1 border-t flex items-center" style={{ borderColor: "#f0f0f0" }}>
            <span className="text-[10px] text-stone-400 truncate">{rootPath ? rootPath.split("/").pop() : "No project"}</span>
          </div>
        </div>

        {/* Sidebar resize */}
        <div className="w-1 cursor-col-resize hover:bg-blue-300 active:bg-blue-500 transition-colors shrink-0"
          onMouseDown={e => startResize("sidebar", e)} style={{ backgroundColor: "#e5e5e5" }} />

        {/* ── Editor + Terminal ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab Bar */}
          <div className="flex items-end border-b shrink-0 overflow-x-auto" style={{ backgroundColor: "#f5f5f4", borderColor: "#e5e5e5" }}>
            {openTabs.map(tab => {
              const fi = getFileIcon(tab.name);
              return (
                <div key={tab.id}
                  className={cn("group flex items-center gap-1 px-3 py-1 border-r cursor-pointer select-none text-xs shrink-0 transition-colors",
                    activeTabId === tab.id ? "bg-white text-stone-800" : "text-stone-400 hover:bg-stone-100")}
                  style={activeTabId === tab.id ? { borderTop: `2px solid ${themeInfo.accent}` } : { borderTop: "2px solid transparent" }}
                  onClick={() => { setActiveTabId(tab.id); setIsEditing(false); }}>
                  <span className="text-[9px] font-bold shrink-0" style={{ color: fi.color }}>{fi.icon}</span>
                  <span className="truncate max-w-[120px]">{tab.name}</span>
                  {tab.modified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                  <button onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                    className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 text-[10px] ml-1">✕</button>
                </div>
              );
            })}
            {openTabs.length === 0 && <div className="px-4 py-1.5 text-xs text-stone-300">No files open</div>}
          </div>

          {/* Editor */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {activeTab ? (
              <div className="flex-1 flex min-w-0 overflow-hidden">
                {/* Line numbers */}
                <div className="shrink-0 select-none text-right overflow-hidden"
                  style={{ color: "#b0b0b0", backgroundColor: "#fafaf9", borderRight: "1px solid #eee", width: lineNumWidth }}>
                  <div className="py-3">
                    {Array.from({ length: lineCount }, (_, i) => (
                      <div key={i} className="pr-3 text-[11px] font-mono leading-5" style={{ height: 20 }}>{i + 1}</div>
                    ))}
                  </div>
                </div>
                {/* Editor area */}
                {isEditing ? (
                  /* Edit mode: textarea */
                  <textarea
                    ref={textareaRef}
                    value={activeTab.content}
                    onChange={e => handleContentChange(e.target.value)}
                    onBlur={stopEditing}
                    onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); stopEditing(); } }}
                    className="flex-1 min-w-0 p-3 text-[13px] font-mono leading-5 resize-none outline-none bg-white"
                    style={{ tabSize: 2, whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto" }}
                    spellCheck={false}
                  />
                ) : (
                  /* View mode: syntax highlighted */
                  <div className="flex-1 overflow-auto cursor-text" onClick={startEditing}
                    onDoubleClick={startEditing}>
                    <pre ref={highlightRef} className="py-3 px-4 text-[13px] leading-5 font-mono" style={{ tabSize: 2 }}>
                      <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
                    </pre>
                    {/* Edit hint overlay */}
                    <div className="absolute bottom-3 right-3 text-[10px] text-stone-300 bg-white/80 px-2 py-1 rounded border" style={{ borderColor: "#e0e0e0" }}>
                      Click to edit · Cmd+S save · Auto-save 3s
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8">
                <div className="text-5xl">⚡</div>
                <h2 className="text-lg font-bold text-stone-600">Vibe Coding IDE</h2>
                <p className="text-stone-400 text-sm text-center max-w-md leading-relaxed">
                  左邊打開專案 → 點擊檔案瀏覽（點擊進入編輯）<br />
                  🤖 AI 側邊欄可對著當前檔案問問題<br />
                  所有操作自動記錄 → 定時蒸餾成知識
                </p>
              </div>
            )}

            {/* Session overlay */}
            {showSessionPanel && (
              <div className="absolute right-2 top-10 w-72 bg-white rounded-xl shadow-2xl border z-50 overflow-hidden" style={{ borderColor: "#e0e0e0" }}>
                <div className="px-3 py-2 border-b font-bold text-xs text-stone-700 flex items-center gap-2" style={{ borderColor: "#f0f0f0" }}>
                  ⚡ Sessions <span className="flex-1" />
                  <button onClick={() => setShowSessionPanel(false)} className="text-stone-400 hover:text-stone-700">✕</button>
                </div>
                <div className="max-h-36 overflow-y-auto">
                  {sessions.map(s => {
                    const cliOpt = CLI_OPTIONS.find(c => c.id === s.cli);
                    return (
                      <div key={s.id}
                        className={cn("flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-stone-50 text-xs border-b", activeSessionId === s.id && "bg-blue-50")}
                        style={{ borderColor: "#f5f5f5" }}
                        onClick={() => { setActiveSessionId(s.id); setShowSessionPanel(false); }}>
                        <span>{cliOpt?.icon || "⚪"}</span>
                        <span className="font-semibold text-stone-700 flex-1 truncate">{s.name}</span>
                        <button onClick={e => { e.stopPropagation(); setSessions(prev => prev.filter(x => x.id !== s.id)); if (activeSessionId === s.id) setActiveSessionId(null); }}
                          className="text-stone-300 hover:text-red-500">✕</button>
                      </div>
                    );
                  })}
                </div>
                <div className="p-2.5 border-t space-y-1.5" style={{ borderColor: "#f0f0f0", backgroundColor: "#fafaf9" }}>
                  <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Session name"
                    className="w-full text-[11px] px-2 py-1.5 border rounded outline-none" style={{ borderColor: "#ddd" }} />
                  <div className="flex gap-0.5">
                    {CLI_OPTIONS.map(cli => (
                      <button key={cli.id} onClick={() => setFormCli(cli.id)}
                        className={cn("flex-1 py-1 rounded text-[10px] font-semibold border transition-colors",
                          formCli === cli.id ? "text-white" : "border-stone-200 text-stone-500")}
                        style={formCli === cli.id ? { backgroundColor: cli.color, borderColor: cli.color } : {}}>
                        {cli.icon}
                      </button>
                    ))}
                  </div>
                  <input value={formModel} onChange={e => setFormModel(e.target.value)} placeholder="Model"
                    className="w-full text-[10px] px-2 py-1 border rounded font-mono outline-none" style={{ borderColor: "#ddd" }} />
                  <input value={formCwd || rootPath} onChange={e => setFormCwd(e.target.value)} placeholder="Working dir"
                    className="w-full text-[10px] px-2 py-1 border rounded font-mono outline-none" style={{ borderColor: "#ddd" }} />
                  <div className="flex gap-0.5">
                    {APPROVAL_MODES.map(m => (
                      <button key={m.id} onClick={() => setFormApproval(m.id)}
                        className={cn("flex-1 py-1 rounded text-[10px] font-semibold border",
                          formApproval === m.id ? "border-stone-400 bg-white text-stone-700" : "border-stone-200 text-stone-400")}>{m.icon} {m.label}</button>
                    ))}
                  </div>
                  <button onClick={createSession}
                    className="w-full py-1.5 rounded text-[11px] font-bold text-white active:scale-95 transition-transform"
                    style={{ backgroundColor: themeInfo.accent }}>🚀 Start</button>
                </div>
              </div>
            )}
          </div>

          {/* Terminal resize handle */}
          {showTerminal && <div className="h-1 cursor-row-resize hover:bg-blue-300 active:bg-blue-500 transition-colors shrink-0"
            onMouseDown={e => startResize("terminal", e)} style={{ backgroundColor: "#e5e5e5" }} />}

          {/* Terminal */}
          {showTerminal && (
            <div className="shrink-0 flex flex-col" style={{ height: terminalHeight }}>
              <div className="flex items-center px-2 py-0.5 border-b shrink-0 select-none" style={{ backgroundColor: "#1e1e2e", borderColor: "#313244" }}>
                <span className="text-[10px] text-stone-400 font-semibold">
                  {activeSession ? `${activeSession.name} (${activeSession.cli})` : "Terminal"}
                </span>
                <span className="flex-1" />
                {activeSession && QUICK_ACTIONS.slice(0, 5).map(a => (
                  <button key={a.id} onClick={() => sendPrompt(a.prompt)} title={a.label}
                    className="text-[9px] px-1 py-0.5 rounded text-stone-400 hover:text-white hover:bg-stone-700">{a.icon}</button>
                ))}
                <button onClick={() => setShowTerminal(false)} className="text-stone-500 hover:text-white text-[10px] ml-2">✕</button>
              </div>
              <div className="flex-1 min-h-0">
                {activeSession ? (
                  <TerminalConsole key={activeSession.id} ref={termRef}
                    cli={activeSession.cli} model={activeSession.model || undefined}
                    cwd={activeSession.cwd} approvalMode={activeSession.approvalMode} />
                ) : (
                  <div className="flex items-center justify-center h-full" style={{ backgroundColor: "#1e1e2e" }}>
                    <p className="text-xs text-stone-500">點擊 + Session 建立 CLI session</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 2. AI Chat Sidebar ── */}
        {showAiPanel && (
          <>
            {/* AI panel resize handle */}
            <div className="w-1 cursor-col-resize hover:bg-blue-300 active:bg-blue-500 transition-colors shrink-0"
              onMouseDown={e => startResize("ai", e)} style={{ backgroundColor: "#e5e5e5" }} />
            <div className="flex flex-col border-l shrink-0 select-none" style={{ width: aiPanelWidth, backgroundColor: "#fff", borderColor: "#e5e5e5" }}>
              {/* AI header */}
              <div className="flex items-center px-3 py-2 border-b shrink-0" style={{ borderColor: "#f0f0f0" }}>
                <span className="text-xs font-bold text-stone-700">🤖 AI Chat</span>
                {activeTab && <span className="text-[9px] text-stone-400 ml-2 truncate">({activeTab.name})</span>}
                <span className="flex-1" />
                <button onClick={() => setShowAiPanel(false)} className="text-stone-400 hover:text-stone-700 text-xs">✕</button>
              </div>
              {/* Chat messages */}
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3" style={{ fontSize: 13 }}>
                {chatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-2">
                    <span className="text-2xl">🤖</span>
                    <p className="text-stone-400 text-xs">
                      對著當前開啟的檔案問 AI<br />
                      自動帶入檔案內容作為 context
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {["解釋這段 code", "有什麼問題？", "幫我加註解", "效能可以更好嗎？"].map(q => (
                        <button key={q} onClick={() => setChatInput(q)}
                          className="text-[10px] px-2 py-1 rounded-full border border-stone-200 text-stone-500 hover:bg-stone-50 hover:border-stone-300 transition-colors">
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={cn("rounded-lg px-3 py-2 text-xs leading-relaxed",
                    msg.role === "user" ? "bg-stone-100 text-stone-700" : "bg-blue-50 text-stone-700")}>
                    <div className="text-[9px] font-bold text-stone-400 mb-1">{msg.role === "user" ? "👤 You" : "🤖 AI"}</div>
                    <pre className="whitespace-pre-wrap font-sans break-words" style={{ fontFamily: "inherit" }}>{msg.content}</pre>
                  </div>
                ))}
                {chatLoading && <div className="text-xs text-stone-400 animate-pulse px-3">🤖 Thinking...</div>}
                <div ref={chatEndRef} />
              </div>
              {/* Chat input */}
              <div className="px-2 py-2 border-t shrink-0" style={{ borderColor: "#f0f0f0" }}>
                <div className="flex items-end gap-1.5">
                  <textarea value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                    placeholder="問 AI 關於這個檔案..."
                    className="flex-1 text-xs px-2.5 py-1.5 border rounded-lg resize-none outline-none focus:border-blue-400"
                    style={{ borderColor: "#ddd", minHeight: 36, maxHeight: 100 }} rows={1} />
                  <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40 transition-all active:scale-95 shrink-0"
                    style={{ backgroundColor: themeInfo.accent }}>Send</button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] text-stone-300">Enter 發送 · Shift+Enter 換行</span>
                  {activeTab && <span className="text-[9px] text-stone-300">· 自動帶入 {activeTab.name}</span>}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Status Bar ── */}
      <div className="flex items-center h-5 px-3 border-t shrink-0 select-none text-[10px]" style={{ backgroundColor: "#fff", borderColor: "#e5e5e5" }}>
        {activeTab && (
          <>
            <span className="text-stone-500">{activeTab.language}</span>
            <span className="text-stone-300 mx-1">|</span>
            <span className="text-stone-500">{lineCount} lines</span>
            {activeTab.modified && <><span className="text-stone-300 mx-1">|</span><span className="text-amber-500">modified</span></>}
            <span className="text-stone-300 mx-1">|</span>
            <span className="text-stone-400 font-mono truncate max-w-[250px]">{activeTab.path}</span>
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
        <span className="text-stone-300 mx-1">|</span>
        <span className="text-stone-400">tracked</span>
      </div>
    </div>
  );
}
