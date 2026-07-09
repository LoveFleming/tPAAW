/**
 * CodingIDE — All-in-one AI coding environment
 *
 * Layout:
 *  ┌──────┬──────────────────────────┬─────────┐
 *  │ File │  Tab Bar                 │  AI     │
 *  │ Exp  │──────────────────────────│ Chat    │
 *  │      │  Code Editor (highlight) │ Sidebar │
 *  │      │  / Diff View / Blame     │         │
 *  │      │  / API Tester            │         │
 *  │      │──────────────────────────│         │
 *  │      │  Terminal Panel (resize) │         │
 *  └──────┴──────────────────────────┴─────────┘
 *
 * Panels (top bar toggle):
 *  - 🤖 AI Chat — PAAW chat integration with file context
 *  - 🔀 Git — status, diff, blame, AI auto-comment
 *  - 🌐 API Tester — Postman-like request builder
 *  - ⌨️ Terminal — Real shell terminal (resizable)
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import ShellTerminal from "../components/ShellTerminal";
import { fileEmoji } from "../components/FileEmoji";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";

import API_BASE from "../api";
import DirectoryExplorer from "../components/DirectoryExplorer";
import SidebarFileTree from "../components/SidebarFileTree";
import PaawTree from "../components/PaawTree";
import StandardsEditor from "../components/StandardsEditor";
import SessionHistory from "../components/SessionHistory";
import BrowserPreview from "../components/BrowserPreview";
import BrowserDevTools, { type ConsoleEntry } from "../components/BrowserDevTools";
import DecisionLog from "../components/DecisionLog";
import ProjectHealth from "../components/ProjectHealth";
import ModelSelector from "../components/ModelSelector";

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

// Git types
interface GitFileStatus { status: string; path: string; }
interface GitCommit { hash: string; short: string; author: string; email: string; date: string; subject: string; }
interface BlameLine { hash: string; author: string; authorMail: string; authorTime: string; summary: string; finalLine: number; content: string; }

// API Tester types
interface ApiHeader { key: string; value: string; enabled: boolean; }
interface ApiResponse { status: number; statusText: string; headers: Record<string, string>; body: string; elapsed: number; size: number; error?: boolean; }
interface ApiHistoryItem { id: string; ts: string; method: string; url: string; status: number; elapsed: number; headers?: ApiHeader[]; body?: string; streamMode?: boolean; response?: ApiResponse; streamResponse?: string; }

// ── Constants ──
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const METHOD_COLORS: Record<string, string> = {
  GET: "#10B981", POST: "#3B82F6", PUT: "#F59E0B", PATCH: "#8B5CF6",
  DELETE: "#EF4444", HEAD: "#6B7280", OPTIONS: "#6B7280",
};

// ── Helpers ──
function getFileIcon(name: string): string {
  if (name === "package.json") return "📦";
  if (name === "Dockerfile") return "🐳";
  if (name === "README.md") return "📖";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return fileEmoji(ext);
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

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function tryFormatJson(str: string): string {
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
}

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function CodingIDE() {
  const { info: themeInfo } = useTheme();
  const { t: tt } = useI18n();

  // Theme tokens for consistent UI
  const tk = useMemo(() => ({
    bg: "#fff",
    bgMuted: "#fafafa",
    bgHover: themeInfo.accentLight || "#f5f5f4",
    border: themeInfo.accentBorder || "#e5e5e5",
    borderLight: "#f0f0f0",
    borderInput: "#e0e0e0",
    textMuted: "#9ca3af",
    textPrimary: "#374151",
    textSecondary: "#6b7280",
    accent: themeInfo.accent,
    accentLight: themeInfo.accentLight,
    accentBg: themeInfo.accentBg,
    accentBorder: themeInfo.accentBorder,
    accentText: themeInfo.accentText,
    accentHover: themeInfo.accentHover,
    // Toolbar tokens (derived from accent)
    toolbarBg: themeInfo.accentText || "#1e1e1e",     // dark version of accent
    toolbarBorder: themeInfo.accentBorder || "#333",
    toolbarText: "rgba(255,255,255,0.9)",
    toolbarTextMuted: "rgba(255,255,255,0.5)",
    toolbarHover: "rgba(255,255,255,0.1)",
    toolbarActive: "rgba(255,255,255,0.15)",
    toolbarAccent: themeInfo.accent,
  }), [themeInfo]);

  // ── Layout State ──
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [aiPanelWidth, setAiPanelWidth] = useState(360);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showApiTester, setShowApiTester] = useState(false);
  const [activeSubPanel, setActiveSubPanel] = useState<"editor" | "diff" | "blame" | "api-tester" | "browser">("editor");
  const resizingRef = useRef<{ type: "sidebar" | "ai" | "terminal"; startX: number; startY: number; startSize: number } | null>(null);

  // ── Quick Open State (Cmd+P) ──
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenResults, setQuickOpenResults] = useState<{ path: string; name: string; score: number }[]>([]);
  const [quickOpenIndex, setQuickOpenIndex] = useState(0);
  const quickOpenRef = useRef<HTMLInputElement>(null);

  // ── Global Search State (Cmd+Shift+F) ──
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ path: string; filename: string; matches: { line: number; content: string; start: number; end: number }[] }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchUseRegex, setSearchUseRegex] = useState(false);
  const [searchInclude, setSearchInclude] = useState("");
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── File Explorer State ──
  const [rootPath, setRootPath] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Record<string, FsItem[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  // Refs to avoid stale closures in expandDir/toggleDir
  const dirContentsRef = useRef(dirContents);
  const loadingDirsRef = useRef(loadingDirs);
  const expandedDirsRef = useRef(expandedDirs);

  // ── Editor State ──
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);


  // ── AI Chat State ──
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Right Panel Tab State ──
  const [rightTab, setRightTab] = useState<"chat" | "standards" | "sessions" | "decisions" | "health" | "prompts" | "status">("chat");

  // ── Browser Preview State ──
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserConsoleLogs, setBrowserConsoleLogs] = useState<ConsoleEntry[]>([]);

  // ── Recent Projects State ──
  const [recentProjects, setRecentProjects] = useState<{ path: string; name: string; hasPaaw: boolean }[]>([]);
  const [showRecentProjects, setShowRecentProjects] = useState(false);

  // ── New Project State ──
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectParent, setNewProjectParent] = useState("");
  const [newProjectInitGit, setNewProjectInitGit] = useState(true);
  const [newProjectInitPaaw, setNewProjectInitPaaw] = useState(true);
  const [newProjectCreating, setNewProjectCreating] = useState(false);
  const [newProjectError, setNewProjectError] = useState("");

  // ── Project Menu State ──
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showSearchMenu, setShowSearchMenu] = useState(false);
  const [showCrewMenu, setShowCrewMenu] = useState(false);
  const [activeCrew, setActiveCrew] = useState<string | null>(null);

  // ── Coding Crew Definitions ──
  const codingCrews = [
    { id: "coding.architect", emoji: "🏛️", title: "架構師", mode: "chat" as const },
    { id: "coding.spec-writer", emoji: "📐", title: "規格師", mode: "spec" as const },
    { id: "coding.developer", emoji: "💻", title: "開發人員", mode: "agent" as const },
    { id: "coding.unit-tester", emoji: "🧪", title: "Unit Test", mode: "test" as const },
    { id: "coding.e2e-tester", emoji: "🎭", title: "E2E Tester", mode: "test" as const },
    { id: "coding.doc-writer", emoji: "📝", title: "文件製作員", mode: "docs" as const },
  ];

  // Close / unload project
  const closeProject = useCallback(() => {
    if (!rootPath) return;
    // Remove from recent projects
    fetch(`${API_BASE}/api/coding-project/recent?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" })
      .then(r => r.json()).then(data => { if (Array.isArray(data)) setRecentProjects(data); }).catch(() => {});
    // Clear state
    setRootPath("");
    setOpenTabs([]);
    setActiveTabId(null);
    setExpandedDirs(new Set());
    setDirContents({});
    dirContentsRef.current = {};
    setGitStatus(null);
    setGitLog([]);
    setGitDiff("");
    setChatMessages([]);
    try { localStorage.removeItem("paaw.vibeide.rootPath"); } catch {}
  }, [rootPath]);

  // ── AI Initialize State ──
  const [aiInitializing, setAiInitializing] = useState(false);
  const [aiInitSteps, setAiInitSteps] = useState<Array<{ id: string; name: string; status: "pending" | "running" | "done" | "error" | "skip"; size?: number; error?: string }>>([]);
  const [showAiInitPanel, setShowAiInitPanel] = useState(false);

  // ── AI Prompt Management State ──
  const [aiPrompts, setAiPrompts] = useState<Array<{ filename: string; name: string; defaultContent: string; customContent: string | null; activeContent: string; hasOverride: boolean; size: number }>>([]);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editingPromptContent, setEditingPromptContent] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);

  // ── Code Status Dashboard State ──
  const [codeStatus, setCodeStatus] = useState<{ initialized: boolean; scores: Record<string, { score: number; items: Array<{ name: string; status: string; detail: string }> }> } | null>(null);
  const [expandedArea, setExpandedArea] = useState<string | null>(null);
  const [fixingArea, setFixingArea] = useState<string | null>(null);
  const [fixProgress, setFixProgress] = useState<Array<{ step: string; name?: string; status: "running" | "done" | "error" | "skip" }>>([]);
  const [domainAutoPrompt, setDomainAutoPrompt] = useState<{ mode: string; prompt: string } | null>(null);

  const startAiInitialize = useCallback(async () => {
    if (!rootPath || aiInitializing) return;
    setAiInitializing(true);
    setShowAiInitPanel(true);
    const steps = [
      { id: "scan", name: "🔍 掃描專案結構" },
      { id: "api-spec", name: "📝 產出 API Spec" },
      { id: "error-mapping", name: "🐛 產出 Error Mapping" },
      { id: "test-payload", name: "🧪 產出 API Test Payload" },
      { id: "standards", name: "📏 產出 Coding Standards" },
      { id: "faq", name: "🤖 產出 HelpDesk FAQ" },
      { id: "overview", name: "📊 產出 PROJECT.md" },
    ];
    setAiInitSteps(steps.map(s => ({ ...s, status: "pending" as const })));

    try {
      const res = await fetch(`${API_BASE}/api/coding-project/ai-initial?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
      if (!res.ok || !res.body) {
        setAiInitSteps(prev => prev.map(s => ({ ...s, status: "error" as const, error: `HTTP ${res.status}` })));
        setAiInitializing(false); return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event: ") || line.startsWith("data: ")) {
            try {
              if (line.startsWith("data: ")) {
                const data = JSON.parse(line.slice(6));
                // Handle events based on the event type from the previous line
                if (data.step) {
                  if (data.reason) {
                    // step_skip
                    setAiInitSteps(prev => prev.map(s => s.id === data.step ? { ...s, status: "skip" as const } : s));
                  } else if (data.error) {
                    // step_error
                    setAiInitSteps(prev => prev.map(s => s.id === data.step ? { ...s, status: "error" as const, error: data.error } : s));
                  } else if (data.preview !== undefined) {
                    // step_done
                    setAiInitSteps(prev => prev.map(s => s.id === data.step ? { ...s, status: "done" as const, size: data.size } : s));
                  } else {
                    // step_start
                    setAiInitSteps(prev => prev.map(s => s.id === data.step ? { ...s, status: "running" as const } : s));
                  }
                }
                if (data.message === "AI Initialize complete") {
                  setAiInitializing(false);
                  // Refresh status after AI Init
                  fetch(`${API_BASE}/api/coding-project/status?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).then(setCodeStatus).catch(() => {});
                }
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      setAiInitSteps(prev => prev.map(s => ({ ...s, status: "error" as const, error: err.message })));
    }
    setAiInitializing(false);
  }, [rootPath, aiInitializing]);

  // ── Git State ──
  const [gitStatus, setGitStatus] = useState<{ branch: string; staged: GitFileStatus[]; unstaged: GitFileStatus[]; untracked: GitFileStatus[]; all: GitFileStatus[] } | null>(null);
  const [gitLog, setGitLog] = useState<GitCommit[]>([]);
  const [gitDiff, setGitDiff] = useState("");
  const [gitDiffFile, setGitDiffFile] = useState("");
  const [gitDiffCached, setGitDiffCached] = useState(false);
  const [blameData, setBlameData] = useState<BlameLine[] | null>(null);
  const [blameFile, setBlameFile] = useState("");
  const [aiComment, setAiComment] = useState("");
  const [aiCommentLoading, setAiCommentLoading] = useState(false);
  const [gitTab, setGitTab] = useState<"status" | "log" | "diff" | "blame" | "review">("status");
  const [gitReviews, setGitReviews] = useState<{ id: string; ts: string; comment: string; branch?: string; files?: string[] }[]>([]);

  // ── API Tester State ──
  const [apiMethod, setApiMethod] = useState("GET");
  const [apiUrl, setApiUrl] = useState("");
  const [apiHeaders, setApiHeaders] = useState<ApiHeader[]>([
    { key: "Content-Type", value: "application/json", enabled: true },
  ]);
  const [apiBody, setApiBody] = useState("");
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiHistory, setApiHistory] = useState<ApiHistoryItem[]>([]);
  const [apiTab, setApiTab] = useState<"request" | "response" | "history">("request");
  const [apiStreamMode, setApiStreamMode] = useState(false);
  const [apiStreamContent, setApiStreamContent] = useState("");
  const [apiStreamInfo, setApiStreamInfo] = useState<{ status: number; statusText: string; contentType: string } | null>(null);
  const apiStreamAbortRef = useRef<AbortController | null>(null);

  // ── Coding Behavior Tracking ──
  const codingLogRef = useRef<CodingEvent[]>([]);
  const distillTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showDirExplorer, setShowDirExplorer] = useState(false);

  const activeTab = useMemo(() => openTabs.find(ot => ot.id === activeTabId), [openTabs, activeTabId]);

  // ═══════════════════════════════════════════════
  // Init: load from server APIs (with localStorage fallback)
  // ═══════════════════════════════════════════════
  useEffect(() => {
    (async () => {
      // Load root path
      const root = localStorage.getItem("paaw.vibeide.rootPath");
      if (root) { setRootPath(root); expandDir(root); }
      // Load API history from server
      try {
        const res = await fetch(`${API_BASE}/api/api-tester/history`);
        const data = await res.json();
        if (data.history?.length) setApiHistory(data.history);
      } catch {
        try { const hist = localStorage.getItem("paaw.api-tester.history"); if (hist) setApiHistory(JSON.parse(hist)); } catch {}
      }
      // Load AI chat history from server
      try {
        const res = await fetch(`${API_BASE}/api/vibe-chat?sessionId=vibe-ide`);
        const data = await res.json();
        if (data.messages?.length) setChatMessages(data.messages);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    try { localStorage.setItem("paaw.vibeide.rootPath", rootPath); } catch {}
    // Save to recent projects server-side
    if (rootPath) {
      fetch(`${API_BASE}/api/coding-project/recent?path=${encodeURIComponent(rootPath)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).catch(() => {});
    }
  }, [rootPath]);

  // Load recent projects on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/coding-project/recent`).then(r => r.json()).then(data => { if (Array.isArray(data)) setRecentProjects(data); }).catch(() => {});
  }, []);
  useEffect(() => {
    try { localStorage.setItem("paaw.api-tester.history", JSON.stringify(apiHistory.slice(0, 50))); } catch {}
  }, [apiHistory]);

  // ═══════════════════════════════════════════════
  // Coding Behavior Tracking → Distillation Engine
  // ═══════════════════════════════════════════════
  const logEvent = useCallback((type: CodingEvent["type"], data: Record<string, any>) => {
    codingLogRef.current = [...codingLogRef.current, { type, ts: new Date().toISOString(), data }];
  }, []);

  useEffect(() => {
    distillTimerRef.current = setInterval(async () => {
      const events = codingLogRef.current;
      if (events.length === 0) return;
      codingLogRef.current = [];
      try {
        await fetch(`${API_BASE}/api/distill/record`, {
          method: "POST", headers: { "Content-Type": "application/json" },
        });
      } catch {}
    }, 30_000);
    return () => { if (distillTimerRef.current) clearInterval(distillTimerRef.current); };
  }, [rootPath, openTabs]);

  // ═══════════════════════════════════════════════
  // File Explorer
  // ═══════════════════════════════════════════════
  const expandDir = useCallback(async (path: string) => {
    // Guard with refs — no stale closure, no dependency array changes
    if (dirContentsRef.current[path] || loadingDirsRef.current.has(path)) return;
    setLoadingDirs(prev => { const n = new Set(prev); n.add(path); loadingDirsRef.current = n; return n; });
    try {
      const res = await fetch(`${API_BASE}/api/vibe-fs/list?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.items) {
        setDirContents(prev => { const next = { ...prev, [path]: data.items }; dirContentsRef.current = next; return next; });
        setExpandedDirs(prev => { const n = new Set(prev); n.add(path); expandedDirsRef.current = n; return n; });
      }
    } catch {}
    setLoadingDirs(prev => { const n = new Set(prev); n.delete(path); loadingDirsRef.current = n; return n; });
  }, []);

  const toggleDir = useCallback((path: string) => {
    if (expandedDirsRef.current.has(path)) {
      // Collapse — use functional update, no async side effects
      setExpandedDirs(prev => { const n = new Set(prev); n.delete(path); expandedDirsRef.current = n; return n; });
    } else {
      // Expand — call expandDir outside setState
      expandDir(path);
    }
  }, [expandDir]);

  // ═══════════════════════════════════════════════
  // File Operations
  // ═══════════════════════════════════════════════
  const openFile = useCallback(async (path: string) => {
    const existing = openTabs.find(ot => ot.path === path);
    if (existing) { setActiveTabId(existing.id); return; }
    setLoadingFile(true);
    try {
      const res = await fetch(`${API_BASE}/api/vibe-fs/read?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.content !== undefined) {
        const name = path.split(/[\\/]/).pop() || path;
        const tab: OpenTab = { id: path, name, path, content: data.content, originalContent: data.content, modified: false, language: getLanguage(name), hljsLang: getHljsLang(name), lastSaved: data.modified };
        setOpenTabs(prev => [...prev, tab]);
        setActiveTabId(path);
        setIsEditing(false);
        setActiveSubPanel("editor");
        logEvent("open_file", { path, language: tab.language });
      }
    } catch {}
    setLoadingFile(false);
  }, [openTabs, logEvent]);

  const closeTab = useCallback((id: string) => {
    setOpenTabs(prev => prev.filter(ot => ot.id !== id));
    if (activeTabId === id) { const remaining = openTabs.filter(ot => ot.id !== id); setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null); }
    logEvent("close_file", { path: id });
  }, [activeTabId, openTabs, logEvent]);

  const saveFile = useCallback(async (tab: OpenTab) => {
    if (!tab.modified) return;
    try {
      await fetch(`${API_BASE}/api/vibe-fs/write`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: tab.path, content: tab.content }) });
      setOpenTabs(prev => prev.map(ot => ot.id === tab.id ? { ...ot, originalContent: ot.content, modified: false, lastSaved: new Date().toISOString() } : ot));
      logEvent("save_file", { path: tab.path, size: tab.content.length });
    } catch {}
  }, [logEvent]);

  const startEditing = useCallback(() => { setIsEditing(true); setTimeout(() => textareaRef.current?.focus(), 50); }, []);
  const stopEditing = useCallback(() => { setIsEditing(false); if (activeTab?.modified) saveFile(activeTab); }, [activeTab, saveFile]);

  const handleContentChange = useCallback((newContent: string) => {
    if (!activeTabId) return;
    setOpenTabs(prev => prev.map(ot => ot.id === activeTabId ? { ...ot, content: newContent, modified: newContent !== ot.originalContent } : ot));
    logEvent("edit_file", { path: activeTabId });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { const current = openTabs.find(ot => ot.id === activeTabId); if (current?.modified) saveFile(current); }, 3000);
  }, [activeTabId, openTabs, saveFile, logEvent]);

  // Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (activeTab?.modified) saveFile(activeTab); }
      // Cmd+P — Quick Open
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        setShowQuickOpen(true);
        setQuickOpenQuery("");
        setQuickOpenResults([]);
        setQuickOpenIndex(0);
      }
      // Cmd+Shift+F — Global Search
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      // Escape — close modals
      if (e.key === "Escape") {
        setShowQuickOpen(false);
        if (!searchQuery) setShowSearch(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, saveFile, searchQuery]);

  // ── Fuzzy match scorer (subsequence + scoring) ──
  const fuzzyMatch = useCallback((query: string, target: string): number => {
    if (!query) return 1;
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    let qi = 0, score = 0, streak = 0, lastMatch = -1;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        score += 1 + streak * 2; // consecutive bonus
        streak++;
        // Word boundary bonus
        if (ti === 0 || t[ti - 1] === "/" || t[ti - 1] === "." || t[ti - 1] === "_" || t[ti - 1] === "-") score += 5;
        lastMatch = ti;
        qi++;
      } else {
        streak = 0;
      }
    }
    return qi === q.length ? score : -1;
  }, []);

  // ── Quick Open: collect all files from dirContents ──
  const allFiles = useMemo(() => {
    const files: { path: string; name: string }[] = [];
    for (const items of Object.values(dirContents)) {
      for (const item of items) {
        if (!item.isDirectory) {
          files.push({ path: item.path, name: item.name });
        }
      }
    }
    return files;
  }, [dirContents]);

  // ── Quick Open: filter files when query changes ──
  useEffect(() => {
    if (!showQuickOpen) return;
    if (!quickOpenQuery.trim()) {
      // Show recently opened tabs first
      const recent = openTabs.map(ot => ({ path: ot.path, name: ot.name, score: 100 }));
      setQuickOpenResults(recent);
      return;
    }
    const scored = allFiles
      .map(f => ({ ...f, score: fuzzyMatch(quickOpenQuery, f.path) }))
      .filter(f => f.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
    setQuickOpenResults(scored);
    setQuickOpenIndex(0);
  }, [quickOpenQuery, showQuickOpen, allFiles, fuzzyMatch, openTabs]);

  // ── Quick Open: open file ──
  const quickOpenSelect = useCallback((path: string) => {
    setShowQuickOpen(false);
    setQuickOpenQuery("");
    openFile(path);
  }, [openFile]);

  // ── Quick Open: focus input when shown ──
  useEffect(() => {
    if (showQuickOpen) setTimeout(() => quickOpenRef.current?.focus(), 50);
  }, [showQuickOpen]);

  // ── Global Search: run search ──
  const runSearch = useCallback(async () => {
    if (!searchQuery.trim() || !rootPath) return;
    setSearching(true);
    setSearchExpanded(new Set());
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        path: rootPath,
        case: String(searchCaseSensitive),
        wholeword: String(searchWholeWord),
        regex: String(searchUseRegex),
      });
      if (searchInclude) params.set("include", searchInclude);
      const res = await fetch(`${API_BASE}/api/vibe-fs/search?${params}`);
      const data = await res.json();
      setSearchResults(data.results || []);
      // Auto-expand first 5 files
      const top5 = (data.results || []).slice(0, 5).map((r: any) => r.path);
      setSearchExpanded(new Set(top5));
    } catch (err) {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, rootPath, searchCaseSensitive, searchWholeWord, searchUseRegex, searchInclude]);

  // ── Global Search: debounced trigger ──
  useEffect(() => {
    if (!showSearch || !searchQuery.trim()) return;
    const t = setTimeout(() => runSearch(), 300);
    return () => clearTimeout(t);
  }, [searchQuery, searchCaseSensitive, searchWholeWord, searchUseRegex, searchInclude, showSearch, runSearch]);

  // ═══════════════════════════════════════════════
  // AI Chat Sidebar
  // ═══════════════════════════════════════════════
  const [chatMode, setChatMode] = useState<"chat" | "agent" | "spec" | "test" | "bug" | "docs" | "maintain">("agent");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentToolLog, setAgentToolLog] = useState<Array<{name: string; args: string; result: string}>>([]);
  const [codingModel, setVibeModel] = useState<string>("");

const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput.trim(), ts: new Date().toISOString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    logEvent("ai_chat", { prompt: chatInput.trim().slice(0, 200) });

    // ── Domain AI mode (spec, test, bug, docs, maintain) ──
    if (["spec", "test", "bug", "docs", "maintain"].includes(chatMode)) {
      setChatLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/coding-project/domain-ai?path=${encodeURIComponent(rootPath)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: chatMode,
            prompt: userMsg.content,
            history: chatMessages.slice(-8).map(m => ({ role: m.role, content: m.content })),
            crewId: activeCrew || undefined,
          }),
        });
        if (!res.ok || !res.body) {
          const errText = await res.text();
          setChatMessages(prev => [...prev, { role: "assistant", content: `❌ ${chatMode.toUpperCase()} AI error: ${errText.slice(0, 200)}`, ts: new Date().toISOString() }]);
          setChatLoading(false); return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content !== undefined && data.message === undefined) {
                  assistantContent = data.content;
                }
                if (data.error) {
                  assistantContent = `❌ Error: ${data.error}`;
                }
              } catch {}
            }
          }
          // Update streaming content
          if (assistantContent) {
            setChatMessages(prev => {
              const last = prev[prev.length - 1];
              return last?.role === "assistant" ? [...prev.slice(0, -1), { ...last, content: assistantContent }] : [...prev, { role: "assistant", content: assistantContent, ts: new Date().toISOString() }];
            });
          }
        }
        if (!assistantContent) {
          setChatMessages(prev => [...prev, { role: "assistant", content: `(${chatMode.toUpperCase()} AI completed with no output)`, ts: new Date().toISOString() }]);
        }
      } catch (err: any) {
        setChatMessages(prev => [...prev, { role: "assistant", content: `❌ ${chatMode.toUpperCase()} AI error: ${err.message}`, ts: new Date().toISOString() }]);
      }
      setChatLoading(false);
    } else if (chatMode === "agent") {
      // ── PAAW Agent Loop (self-owned runtime, no external CLI) ──
      setChatLoading(true);
      setAgentRunning(true);
      setAgentToolLog([]);
      try {
        const context = activeTab ? `\n\n[Current file: ${activeTab.path}]\n\`\`\`${activeTab.hljsLang}\n${activeTab.content.slice(0, 3000)}\n\`\`\`` : "";
        // Fetch system context from API for CodingIDE
        let vibeSystemPrompt = "";
        try {
          const ctxRes = await fetch(`${API_BASE}/api/context/vibe-coding`);
          if (ctxRes.ok) { const ctx = await ctxRes.json(); vibeSystemPrompt = ctx.systemPrompt || ""; }
        } catch {}

        let crewSystemAdd = "";
        if (activeCrew) {
          try {
            const crewRes = await fetch(`${API_BASE}/api/coding-crew/${activeCrew}`);
            if (crewRes.ok) {
              const crewData = await crewRes.json();
              crewSystemAdd = `\n\n[AI 人員角色]\n${crewData.rolePrompt || ""}\n`;
            }
          } catch {}
        }

        const res = await fetch(`${API_BASE}/api/agent-run/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: userMsg.content + context,
            systemPrompt: vibeSystemPrompt + crewSystemAdd,
            model: codingModel || undefined,
            cwd: rootPath || undefined,
            maxTurns: 15,
            timeout: 90,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          setChatMessages(prev => [...prev, { role: "assistant", content: `❌ Agent error: ${errText.slice(0, 200)}`, ts: new Date().toISOString() }]);
          setChatLoading(false); setAgentRunning(false); return;
        }

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
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content && data.done) {
                  assistantContent = data.content;
                  setChatMessages(prev => [...prev, { role: "assistant", content: assistantContent, ts: new Date().toISOString() }]);
                } else if (data.name && data.args !== undefined) {
                  setAgentToolLog(prev => [...prev, { name: data.name, args: typeof data.args === "string" ? data.args : JSON.stringify(data.args), result: data.result || "..." }]);
                } else if (data.content) {
                  assistantContent = data.content;
                  setChatMessages(prev => {
                    const last = prev[prev.length - 1];
                    return last?.role === "assistant" ? [...prev.slice(0, -1), { ...last, content: `💭 ${assistantContent}` }] : prev;
                  });
                }
              } catch {}
            }
          }
        }
        if (!assistantContent) {
          setChatMessages(prev => [...prev, { role: "assistant", content: "(agent completed with no output)", ts: new Date().toISOString() }]);
        }
      } catch (err: any) {
        setChatMessages(prev => [...prev, { role: "assistant", content: `❌ Agent error: ${err.message}`, ts: new Date().toISOString() }]);
      }
      setChatLoading(false);
      setAgentRunning(false);
    } else {
      // ── Legacy Chat SSE mode ──
      setChatLoading(true);
      try {
        const context = activeTab ? `\n\n[Current file: ${activeTab.path}]\n\`\`\`${activeTab.hljsLang}\n${activeTab.content.slice(0, 3000)}\n\`\`\`` : "";
        const res = await fetch(`${API_BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: userMsg.content + context }], providerId: "default", appId: "vibe-coding" }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
              try { const chunk = JSON.parse(line.slice(6)); if (chunk.content) { assistantContent += chunk.content; setChatMessages(prev => { const last = prev[prev.length - 1]; return last?.role === "assistant" ? [...prev.slice(0, -1), { ...last, content: assistantContent }] : [...prev, { role: "assistant", content: assistantContent, ts: new Date().toISOString() }]; }); } } catch {}
            }
          }
        }
        if (assistantContent) setChatMessages(prev => { const last = prev[prev.length - 1]; return last?.role === "assistant" && last.content === assistantContent ? prev : [...prev, { role: "assistant", content: assistantContent, ts: new Date().toISOString() }]; });
      } catch (err: any) { setChatMessages(prev => [...prev, { role: "assistant", content: `❌ Error: ${err.message}`, ts: new Date().toISOString() }]); }
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, chatMode, activeTab, rootPath, logEvent]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // Handle domain AI auto-prompt from Dashboard
  useEffect(() => {
    if (domainAutoPrompt && showAiPanel) {
      const { prompt } = domainAutoPrompt;
      setDomainAutoPrompt(null);
      setChatInput(prompt);
      // Auto-send after a short delay to let state settle
      setTimeout(() => {
        const sendBtn = document.querySelector("[data-send-chat]") as HTMLButtonElement;
        if (sendBtn) sendBtn.click();
      }, 100);
    }
  }, [domainAutoPrompt, showAiPanel]);

  // ═══════════════════════════════════════════════
  // Git Operations
  // ═══════════════════════════════════════════════
  const refreshGitStatus = useCallback(async () => {
    if (!rootPath) return;
    try { const res = await fetch(`${API_BASE}/api/vibe-git/status?path=${encodeURIComponent(rootPath)}`); const data = await res.json(); setGitStatus(data); } catch {}
  }, [rootPath]);

  const refreshGitLog = useCallback(async () => {
    if (!rootPath) return;
    try { const res = await fetch(`${API_BASE}/api/vibe-git/log?path=${encodeURIComponent(rootPath)}&count=30`); const data = await res.json(); setGitLog(data.commits || []); } catch {}
  }, [rootPath]);

  const loadGitDiff = useCallback(async (file?: string, cached?: boolean) => {
    if (!rootPath) return;
    const params = new URLSearchParams({ path: rootPath });
    if (file) params.set("file", file);
    if (cached) params.set("cached", "true");
    try { const res = await fetch(`${API_BASE}/api/vibe-git/diff?${params}`); const data = await res.json(); setGitDiff(data.diff || ""); setGitDiffFile(file || ""); setGitDiffCached(!!cached); } catch {}
  }, [rootPath]);

  const loadBlame = useCallback(async (filePath: string) => {
    if (!rootPath) return;
    try { const res = await fetch(`${API_BASE}/api/vibe-git/blame?path=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(filePath)}`); const data = await res.json(); setBlameData(data.lines || []); setBlameFile(filePath); setGitTab("blame"); setActiveSubPanel("blame"); } catch {}
  }, [rootPath]);

  const generateAiComment = useCallback(async () => {
    if (!rootPath) return;
    setAiCommentLoading(true);
    setAiComment("");
    try {
      const res = await fetch(`${API_BASE}/api/vibe-git/ai-comment?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff: gitDiff, commits: gitLog.slice(0, 5), context: activeTab ? `Current file: ${activeTab.path}` : "" }),
      });
      const data = await res.json();
      setAiComment(data.comment || "No comment generated");
      setGitTab("review");
      // Save review to server
      try {
        await fetch(`${API_BASE}/api/vibe-git/reviews?path=${encodeURIComponent(rootPath)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: data.comment, branch: gitStatus?.branch, files: gitStatus?.all?.map(f => f.path), diffLength: gitDiff?.length }),
        });
      } catch {}
    } catch (err: any) { setAiComment(`❌ Error: ${err.message}`); }
    setAiCommentLoading(false);
  }, [rootPath, gitDiff, gitLog, activeTab, gitStatus]);

  // Auto-refresh git when panel opens
  useEffect(() => {
    if (showGitPanel) { refreshGitStatus(); refreshGitLog(); loadGitDiff(); }
  }, [showGitPanel]);

  // Load git reviews when entering review tab
  useEffect(() => {
    if (gitTab === "review" && rootPath) {
      fetch(`${API_BASE}/api/vibe-git/reviews?path=${encodeURIComponent(rootPath)}`)
        .then(r => r.json()).then(data => { if (data.reviews) setGitReviews(data.reviews); }).catch(() => {});
    }
  }, [gitTab, rootPath]);

  // ═══════════════════════════════════════════════
  // API Tester
  // ═══════════════════════════════════════════════
  const sendApiRequest = useCallback(async () => {
    if (!apiUrl.trim() || apiLoading) return;

    // ── Streaming mode ──
    if (apiStreamMode) {
      setApiLoading(true);
      setApiTab("response");
      setApiStreamContent("");
      setApiStreamInfo(null);
      const startTime = Date.now();
      const ac = new AbortController();
      apiStreamAbortRef.current = ac;
      const headersObj: Record<string, string> = {};
      apiHeaders.filter(h => h.enabled && h.key).forEach(h => { headersObj[h.key] = h.value; });
      try {
        const res = await fetch(`${API_BASE}/api/api-tester/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: apiMethod, url: apiUrl.trim(), headers: headersObj, body: apiBody }),
          signal: ac.signal,
        });
        const status = parseInt(res.headers.get("X-Response-Status") || "0", 10);
        const statusText = res.headers.get("X-Response-Status-Text") || "";
        const contentType = res.headers.get("Content-Type") || "";
        setApiStreamInfo({ status, statusText, contentType });

        const reader = res.body?.getReader();
        if (!reader) { setApiStreamContent("No response body"); setApiLoading(false); return; }
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          accumulated += chunk;
          setApiStreamContent(accumulated);
        }

        const elapsed = Date.now() - startTime;
        const item: ApiHistoryItem = { id: `req-${Date.now()}`, ts: new Date().toISOString(), method: apiMethod, url: apiUrl, status: status || 200, elapsed, headers: [...apiHeaders], body: apiBody, streamMode: apiStreamMode, streamResponse: apiStreamContent };
        setApiHistory(prev => [item, ...prev].slice(0, 50));
        try { await fetch(`${API_BASE}/api/api-tester/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }); } catch {}
      } catch (err: any) {
        if (err.name === "AbortError") {
          setApiStreamContent(prev => prev + "\n\n[⏹ Aborted by user]");
        } else {
          setApiStreamContent(`❌ Error: ${err.message}`);
        }
      }
      apiStreamAbortRef.current = null;
      setApiLoading(false);
      return;
    }

    // ── Normal (non-streaming) mode ──
    setApiLoading(true);
    setApiResponse(null);
    setApiTab("response");
    const headersObj: Record<string, string> = {};
    apiHeaders.filter(h => h.enabled && h.key).forEach(h => { headersObj[h.key] = h.value; });
    try {
      const res = await fetch(`${API_BASE}/api/api-tester/proxy`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: apiMethod, url: apiUrl.trim(), headers: headersObj, body: apiBody }),
      });
      const data = await res.json();
      setApiResponse(data);
      // Save to history
      const item: ApiHistoryItem = { id: `req-${Date.now()}`, ts: new Date().toISOString(), method: apiMethod, url: apiUrl, status: data.status, elapsed: data.elapsed, headers: [...apiHeaders], body: apiBody, streamMode: apiStreamMode, response: data };
      setApiHistory(prev => [item, ...prev].slice(0, 50));
      // Save to server
      try { await fetch(`${API_BASE}/api/api-tester/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }); } catch {}
    } catch (err: any) { setApiResponse({ status: 0, statusText: "Error", headers: {}, body: err.message, elapsed: 0, size: 0, error: true }); }
    setApiLoading(false);
  }, [apiMethod, apiUrl, apiHeaders, apiBody, apiLoading, apiStreamMode]);

  const loadApiHistory = useCallback(async () => {
    try { const res = await fetch(`${API_BASE}/api/api-tester/history`); const data = await res.json(); if (data.history) setApiHistory(data.history); } catch {}
  }, []);

  const addHeader = useCallback(() => setApiHeaders(prev => [...prev, { key: "", value: "", enabled: true }]), []);
  const removeHeader = useCallback((i: number) => setApiHeaders(prev => prev.filter((_, idx) => idx !== i)), []);
  const updateHeader = useCallback((i: number, field: "key" | "value" | "enabled", val: string | boolean) => {
    setApiHeaders(prev => prev.map((h, idx) => idx === i ? { ...h, [field]: val } : h));
  }, []);

  // ═══════════════════════════════════════════════
  // ═══════════════════════════════════════════════
  // Resize Handlers
  // ═══════════════════════════════════════════════
  const startResize = useCallback((type: "sidebar" | "ai" | "terminal", e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX; const startY = e.clientY;
    const startSize = type === "sidebar" ? sidebarWidth : type === "ai" ? aiPanelWidth : terminalHeight;
    resizingRef.current = { type, startX, startY, startSize };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const r = resizingRef.current;
      if (r.type === "sidebar") setSidebarWidth(Math.max(180, Math.min(450, r.startSize + ev.clientX - r.startX)));
      else if (r.type === "ai") setAiPanelWidth(Math.max(280, Math.min(700, r.startSize + r.startX - ev.clientX)));
      else setTerminalHeight(Math.max(100, Math.min(600, r.startSize + r.startY - ev.clientY)));
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
    try { return activeTab.hljsLang ? hljs.highlight(activeTab.content, { language: activeTab.hljsLang, ignoreIllegals: true }).value : hljs.highlightAuto(activeTab.content).value; }
    catch { return escapeHtml(activeTab.content); }
  }, [activeTab?.content, activeTab?.hljsLang]);

  // Diff highlighting
  const highlightedDiff = useMemo(() => {
    if (!gitDiff) return "";
    try { return hljs.highlight(gitDiff, { language: "diff", ignoreIllegals: true }).value; }
    catch { return escapeHtml(gitDiff); }
  }, [gitDiff]);

  const lines = useMemo(() => (activeTab?.content || "").split("\n"), [activeTab?.content]);
  const lineCount = lines.length;
  const lineNumWidth = Math.max(3, String(lineCount).length) * 10 + 16;
  const modifiedCount = useMemo(() => openTabs.filter(ot => ot.modified).length, [openTabs]);


  // ═══════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════
  return (
    <>
    {/* Directory Explorer Modal */}
    {showDirExplorer && (
      <DirectoryExplorer
        initialPath={rootPath || undefined}
        onSelect={(path) => { setRootPath(path); setShowDirExplorer(false); setExpandedDirs(new Set()); setDirContents({}); dirContentsRef.current = {}; loadingDirsRef.current = new Set(); expandDir(path); }}
        onClose={() => setShowDirExplorer(false)}
        title="📂 選擇專案目錄"
      />
    )}

    {/* New Project Dialog */}
    {showNewProject && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!newProjectCreating) setShowNewProject(false); }}>
        <div className="bg-white rounded-xl shadow-2xl w-[420px] p-5" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">🚀</span>
            <h3 className="text-base font-semibold text-stone-800">{tt("vibe.newProject", "New Project")}</h3>
          </div>

          <div className="space-y-3">
            {/* Project Name */}
            <div>
              <label className="text-xs font-medium text-stone-500 mb-1 block">{tt("vibe.projectName", "Project Name")}</label>
              <input
                value={newProjectName}
                onChange={e => { setNewProjectName(e.target.value); setNewProjectError(""); }}
                onKeyDown={e => { if (e.key === "Enter" && newProjectName.trim() && newProjectParent.trim()) { /* trigger create */ } }}
                placeholder="my-awesome-project"
                className="w-full text-sm font-mono px-3 py-2 border rounded-lg bg-stone-50 outline-none focus:border-emerald-400"
                style={{ borderColor: newProjectError ? "#ef4444" : undefined }}
                autoFocus
              />
            </div>

            {/* Parent Directory */}
            <div>
              <label className="text-xs font-medium text-stone-500 mb-1 block">{tt("vibe.parentDir", "Parent Directory")}</label>
              <div className="flex gap-1.5">
                <input
                  value={newProjectParent}
                  onChange={e => { setNewProjectParent(e.target.value); setNewProjectError(""); }}
                  placeholder="/Users/you/projects"
                  className="flex-1 text-sm font-mono px-3 py-2 border rounded-lg bg-stone-50 outline-none focus:border-emerald-400"
                  style={{ borderColor: newProjectError ? "#ef4444" : undefined }}
                />
                <button onClick={async () => {
                  // Use DirectoryExplorer to pick parent dir
                  // For now, just append a note
                }} className="text-xs px-2 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600" title={tt("coding.browseDir")}>📂</button>
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer">
                <input type="checkbox" checked={newProjectInitGit} onChange={e => setNewProjectInitGit(e.target.checked)} className="accent-emerald-600" />
                Git Init
              </label>
              <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer">
                <input type="checkbox" checked={newProjectInitPaaw} onChange={e => setNewProjectInitPaaw(e.target.checked)} className="accent-emerald-600" />
                .paaw/ Init
              </label>
            </div>

            {/* Preview path */}
            {newProjectParent && newProjectName.trim() && (
              <div className="text-[10px] text-stone-400 font-mono bg-stone-50 rounded px-2 py-1.5 truncate">
                📁 {newProjectParent}/{newProjectName.trim()}
              </div>
            )}

            {/* Error */}
            {newProjectError && (
              <div className="text-xs text-red-500 bg-red-50 rounded px-2 py-1.5">{newProjectError}</div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-stone-100">
            <button
              onClick={() => setShowNewProject(false)}
              disabled={newProjectCreating}
              className="text-xs px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600"
            >{tt("vibe.cancel")}</button>
            <button
              onClick={async () => {
                if (!newProjectName.trim() || !newProjectParent.trim()) {
                  setNewProjectError(tt("vibe.newProjectRequired", "Please fill in project name and parent directory"));
                  return;
                }
                setNewProjectCreating(true);
                setNewProjectError("");
                try {
                  const res = await fetch(`${API_BASE}/api/coding-project/create`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: newProjectName.trim(),
                      parentDir: newProjectParent.trim(),
                      initGit: newProjectInitGit,
                      initPaaw: newProjectInitPaaw,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setNewProjectError(data.error || `Error ${res.status}`);
                    setNewProjectCreating(false);
                    return;
                  }
                  // Success — open the new project
                  setShowNewProject(false);
                  setRootPath(data.path);
                  setExpandedDirs(new Set());
                  setDirContents({});
                  dirContentsRef.current = {};
                  loadingDirsRef.current = new Set();
                  expandDir(data.path);
                  try { localStorage.setItem("paaw.vibeide.rootPath", data.path); } catch {}
                } catch (err: any) {
                  setNewProjectError(err.message || "Unknown error");
                }
                setNewProjectCreating(false);
              }}
              disabled={newProjectCreating || !newProjectName.trim() || !newProjectParent.trim()}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {newProjectCreating ? tt("vibe.creating", "Creating...") : tt("vibe.createProject", "Create")}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* AI Initialize Progress Panel */}
    {showAiInitPanel && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!aiInitializing) setShowAiInitPanel(false); }}>
        <div className="bg-white rounded-2xl shadow-2xl border flex flex-col" style={{ width: "min(520px, 90vw)", maxHeight: "70vh" }} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3 border-b rounded-t-2xl" style={{ backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }}>
            <h3 className="text-base font-bold text-emerald-700">🚀 AI Initialize</h3>
            {!aiInitializing && (
              <button onClick={() => setShowAiInitPanel(false)} className="text-stone-400 hover:text-stone-600 text-lg">✕</button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {aiInitSteps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-3 py-2">
                <span className="text-lg shrink-0">
                  {step.status === "done" ? "✅" : step.status === "running" ? "⏳" : step.status === "error" ? "❌" : step.status === "skip" ? "⏭️" : "⬜"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm font-medium", step.status === "running" ? "text-emerald-700" : step.status === "done" ? "text-stone-600" : step.status === "error" ? "text-red-500" : "text-stone-400")}>
                    {step.name}
                    {step.status === "running" && <span className="ml-2 inline-block animate-pulse">●</span>}
                  </div>
                  {step.status === "done" && step.size && (
                    <div className="text-[10px] text-stone-300">{step.size.toLocaleString()} chars</div>
                  )}
                  {step.status === "error" && step.error && (
                    <div className="text-[10px] text-red-400">{step.error}</div>
                  )}
                  {step.status === "skip" && (
                    <div className="text-[10px] text-stone-300">Skipped</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: "#f0f0f0" }}>
            <span className="text-xs text-stone-400">
              {aiInitializing ? "AI 正在分析專案..." : `${aiInitSteps.filter(s => s.status === "done").length}/${aiInitSteps.length} 完成`}
            </span>
            {!aiInitializing && aiInitSteps.some(s => s.status === "done") && (
              <button onClick={() => setShowAiInitPanel(false)} className="px-4 py-1.5 text-sm font-bold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700">
                完成 ✅
              </button>
            )}
          </div>
        </div>
      </div>
    )}
    <div className="h-full flex flex-col w-full overflow-hidden" style={{ backgroundColor: "#fff" }}>
      {/* ── Top Bar ── */}
      <div className="flex items-center h-9 px-2 border-b shrink-0 select-none" style={{ backgroundColor: tk.toolbarBg, borderColor: tk.toolbarBorder }}>
        {/* ⚡ Title + Project Menu */}
        <div className="relative">
          <button onClick={() => setShowProjectMenu(!showProjectMenu)}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded font-semibold transition-colors" style={{ color: tk.toolbarText }} onMouseEnter={e => e.currentTarget.style.backgroundColor = tk.toolbarHover} onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
            <span className="text-sm">⚡</span> {tt("vibe.projectMenu", "Project")}
            <span className="text-[10px]" style={{ color: tk.toolbarTextMuted }}>▼</span>
          </button>
          {showProjectMenu && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-stone-200 rounded-lg shadow-2xl z-50 py-1" onClick={e => e.stopPropagation()}>
              <button onClick={() => { setShowProjectMenu(false); setNewProjectParent(rootPath ? rootPath.split("/").slice(0, -1).join("/") || rootPath : ""); setNewProjectName(""); setNewProjectError(""); setShowNewProject(true); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 text-stone-700 flex items-center gap-2">
                <span>➕</span> {tt("vibe.newProject", "New Project")}
              </button>
              <button onClick={() => { setShowProjectMenu(false); setShowDirExplorer(true); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-stone-700 flex items-center gap-2">
                <span>📂</span> {tt("vibe.importProject", "Import Project")}
              </button>
              {rootPath && (
                <button onClick={() => { setShowProjectMenu(false); closeProject(); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 text-red-600 flex items-center gap-2">
                  <span>✕</span> {tt("vibe.closeProject")}
                </button>
              )}
              {recentProjects.length > 0 && (
                <>
                  <div className="border-t border-stone-100 my-1" />
                  <div className="px-3 py-1 text-[10px] font-semibold text-stone-400">{tt("vibe.recentProjects", "Recent Projects")}</div>
                  {recentProjects.slice(0, 8).map(rp => (
                    <button key={rp.path} onClick={() => { setShowProjectMenu(false); setRootPath(rp.path); setExpandedDirs(new Set()); setDirContents({}); dirContentsRef.current = {}; expandDir(rp.path); }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2 truncate">
                      <span className="shrink-0">{rp.hasPaaw ? "🤖" : "📁"}</span> <span className="truncate">{rp.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* AI Initialize */}
        {rootPath && (
          <button onClick={startAiInitialize}
            disabled={aiInitializing}
            className={cn("ml-2 text-xs px-2 py-0.5 rounded font-bold transition-colors",
              aiInitializing ? "opacity-60" : "")}
            style={{ backgroundColor: aiInitializing ? tk.toolbarHover : tk.accent + "33", color: aiInitializing ? tk.toolbarText : tk.accent }}>
            {aiInitializing ? "⏳ AI Init..." : "🚀 AI Init"}
          </button>
        )}

        {/* Search dropdown */}
        <div className="relative ml-2">
          <button onClick={() => setShowSearchMenu(!showSearchMenu)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors" style={{ color: tk.toolbarText }} title="Search">
            🔍 <span className="text-[10px]" style={{ color: tk.toolbarTextMuted }}>▼</span>
          </button>
          {showSearchMenu && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-stone-200 rounded-lg shadow-2xl z-50 py-1" onClick={e => e.stopPropagation()}>
              <button onClick={() => { setShowSearchMenu(false); setShowQuickOpen(true); setQuickOpenQuery(""); setQuickOpenResults([]); setQuickOpenIndex(0); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-stone-700 flex items-center gap-2">
                <span>📄</span> Quick Open <span className="ml-auto text-[10px] text-stone-400">⌘P</span>
              </button>
              <button onClick={() => { setShowSearchMenu(false); setShowSearch(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-stone-700 flex items-center gap-2">
                <span>📋</span> Find & Replace <span className="ml-auto text-[10px] text-stone-400">⇧⌘F</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex-1" />
        {/* Crew dropdown */}
        <div className="relative">
          <button onClick={() => setShowCrewMenu(!showCrewMenu)}
            className={cn("text-xs px-2 py-1 rounded transition-colors mr-0.5")}
            style={{ backgroundColor: activeCrew ? tk.accent + "33" : "transparent", color: activeCrew ? tk.accent : tk.toolbarTextMuted }}
            title={tt("vibe.crew", "AI Crew")}>👥</button>
          {showCrewMenu && (
            <div className="absolute top-full right-0 mt-1 w-56 bg-white border border-stone-200 rounded-lg shadow-2xl z-50 py-1" onClick={e => e.stopPropagation()}>
              <div className="px-3 py-1 text-[10px] font-semibold text-stone-400">{tt("vibe.crewSelect", "選擇 AI 人員")}</div>
              {codingCrews.map(crew => (
                <button key={crew.id} onClick={() => { setShowCrewMenu(false); setActiveCrew(crew.id); setChatMode(crew.mode); setShowAiPanel(true); setRightTab("chat"); }}
                  className={cn("w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 flex items-center gap-2 truncate",
                    activeCrew === crew.id && "bg-emerald-50 text-emerald-700 font-semibold")}>
                  <span>{crew.emoji}</span> <span>{crew.title}</span>
                  {activeCrew === crew.id && <span className="ml-auto text-emerald-500">●</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Right-side tool icons */}
        <button onClick={() => { setShowGitPanel(!showGitPanel); if (!showGitPanel) { setActiveSubPanel("diff"); } }}
          className={cn("text-xs px-2 py-1 rounded transition-colors mr-0.5")}
          style={{ backgroundColor: showGitPanel ? tk.toolbarActive : "transparent", color: showGitPanel ? tk.toolbarText : tk.toolbarTextMuted }}
          title={tt("vibe.git")}>🔀</button>
        <button onClick={() => { setShowApiTester(!showApiTester); if (!showApiTester) { setActiveSubPanel("api-tester"); } }}
          className={cn("text-xs px-2 py-1 rounded transition-colors mr-0.5")}
          style={{ backgroundColor: showApiTester ? tk.toolbarActive : "transparent", color: showApiTester ? tk.toolbarText : tk.toolbarTextMuted }}
          title={tt("vibe.api")}>🌐</button>
        <button onClick={() => { setShowBrowser(!showBrowser); if (!showBrowser) { setActiveSubPanel("browser"); } }}
          className={cn("text-xs px-2 py-1 rounded transition-colors mr-0.5")}
          style={{ backgroundColor: showBrowser ? tk.toolbarActive : "transparent", color: showBrowser ? tk.toolbarText : tk.toolbarTextMuted }}
          title="Browser">👁️</button>
        <button onClick={() => setShowAiPanel(!showAiPanel)}
          className={cn("text-xs px-2 py-1 rounded transition-colors mr-0.5")}
          style={{ backgroundColor: showAiPanel ? tk.accent + "33" : "transparent", color: showAiPanel ? tk.accent : tk.toolbarTextMuted }}
          title="AI Chat">🤖</button>
        <button onClick={() => setShowTerminal(!showTerminal)}
          disabled={!rootPath}
          className={cn("text-xs px-2 py-1 rounded transition-colors",
            !rootPath && "opacity-20 cursor-not-allowed")}
          style={{ backgroundColor: showTerminal ? tk.toolbarActive : "transparent", color: showTerminal ? tk.toolbarText : tk.toolbarTextMuted }}
          title={tt("vibe.term")}>⌨️</button>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex min-h-0">
        {/* ── File Explorer ── */}
        <div className="flex flex-col shrink-0 select-none" style={{ width: sidebarWidth, backgroundColor: "#fff" }}>
          <div className="px-2 py-1.5" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
            {/* Git branch indicator */}
            {gitStatus?.branch && (
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-semibold border border-emerald-200">🔀 {gitStatus.branch}</span>
                {(gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length) > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-semibold">
                    {gitStatus.staged.length}↑ {gitStatus.unstaged.length}● {gitStatus.untracked.length}?
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {rootPath ? (
              <SidebarFileTree
                projectRoot={rootPath}
                activeFilePath={activeTabId}
                openFilePaths={new Set(openTabs.map(ot => ot.id))}
                onSelectFile={(path) => openFile(path)}
                onEditFile={(path) => openFile(path)}
                onOpenInBriefingPlayer={() => {}}
                onAiSummary={(path, name, isDir) => {
                  setChatMessages(prev => [...prev, {
                    role: "user", content: isDir ? `請幫我摘要這個資料夾的內容：${path}` : `請幫我摘要這個檔案的內容：${path}`, ts: new Date().toISOString()
                  }]);
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
                <span className="text-4xl">💻</span>
                <p className="text-sm font-medium text-stone-500">{tt("vibe.addProject", "加入你的 Code Project")}</p>
                <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
                  <button onClick={() => { setNewProjectParent(""); setNewProjectName(""); setNewProjectError(""); setShowNewProject(true); }}
                    className="text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                    ➕ {tt("vibe.newProject", "New Project")}
                  </button>
                  <button onClick={() => setShowDirExplorer(true)}
                    className="text-xs px-3 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold">
                    📂 {tt("vibe.importProject", "Import Project")}
                  </button>
                  {recentProjects.length > 0 && (
                    <div className="border-t border-stone-200 pt-2 mt-1">
                      <div className="text-[10px] font-semibold text-stone-400 mb-1">{tt("vibe.recentProjects")}</div>
                      {recentProjects.slice(0, 5).map(rp => (
                        <button key={rp.path} onClick={() => { setRootPath(rp.path); setExpandedDirs(new Set()); setDirContents({}); dirContentsRef.current = {}; expandDir(rp.path); }}
                          className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 rounded flex items-center gap-1.5 truncate">
                          <span className="shrink-0">{rp.hasPaaw ? "🤖" : "📁"}</span> <span className="truncate text-stone-600">{rp.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* ── .paaw/ Project Knowledge ── */}
          {rootPath && (
            <div style={{ borderTop: `1px solid ${tk.borderLight}`, maxHeight: "40%", overflowY: "auto", scrollbarWidth: "thin" }}>
              <PaawTree
                projectRoot={rootPath}
                onOpenFile={(path, name) => openFile(path)}
              />
            </div>
          )}
          <div className="px-2 py-1 flex items-center" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
            <span className="text-xs text-stone-400 truncate">{rootPath ? rootPath.split(/[\\/]/).pop() : "No project"}</span>
          </div>
        </div>

        {/* Sidebar resize */}
        <div className="w-px cursor-col-resize hover:w-0.5 hover:bg-blue-400 active:bg-blue-500 transition-all shrink-0"
          onMouseDown={e => startResize("sidebar", e)} style={{ backgroundColor: tk.borderLight }} />

        {/* ── Center: Editor + Git/API Panels + Terminal ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab Bar */}
          <div className="flex items-end shrink-0 overflow-x-auto" style={{ backgroundColor: "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
            {activeSubPanel === "editor" && openTabs.map(tab => {
              return (
                <div key={tab.id}
                  className={cn("group flex items-center gap-1 px-3 py-1 cursor-pointer select-none text-xs shrink-0 transition-colors",
                    activeTabId === tab.id ? "bg-white text-stone-800" : "text-stone-400 hover:bg-stone-100")}
                  style={activeTabId === tab.id ? { borderTop: "2px solid #3b82f6" } : { borderTop: "2px solid transparent" }}
                  onClick={() => { setActiveTabId(tab.id); setIsEditing(false); setActiveSubPanel("editor"); }}>
                  <span className="text-xs shrink-0">{getFileIcon(tab.name)}</span>
                  <span className="truncate max-w-[120px]">{tab.name}</span>
                  {tab.modified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                  <button onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                    className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 text-xs ml-1">✕</button>
                </div>
              );
            })}
            {activeSubPanel === "diff" && <div className="px-4 py-1.5 text-xs font-semibold text-stone-600 bg-white" style={{ borderTop: "2px solid #3b82f6" }}>🔀 Diff {gitDiffFile && <span className="text-stone-400 font-normal">— {gitDiffFile}</span>}</div>}
            {activeSubPanel === "blame" && <div className="px-4 py-1.5 text-xs font-semibold text-stone-600 bg-white" style={{ borderTop: "2px solid #3b82f6" }}>🔍 Blame — {blameFile}</div>}
            {activeSubPanel === "api-tester" && <div className="px-4 py-1.5 text-xs font-semibold text-stone-600 bg-white" style={{ borderTop: "2px solid #3b82f6" }}>🌐 API Tester</div>}
            {activeSubPanel === "browser" && <div className="px-4 py-1.5 text-xs font-semibold text-stone-600 bg-white" style={{ borderTop: "2px solid #3b82f6" }}>🌐 Browser Preview</div>}
            {activeSubPanel === "editor" && openTabs.length === 0 && <div className="px-4 py-1.5 text-xs text-stone-300">{tt("vibe.noFilesOpen")}</div>}
          </div>

          {/* ── Content Area: Editor / Diff / Blame / API Tester ── */}
          <div className="flex-1 flex min-h-0 overflow-hidden relative">

            {/* === EDITOR === */}
            {activeSubPanel === "editor" && activeTab && (
              <div className="flex-1 flex min-w-0 overflow-hidden">
                <div className="shrink-0 select-none text-right overflow-hidden"
                  style={{ color: tk.textMuted, backgroundColor: tk.bgMuted, borderRight: `1px solid ${tk.borderLight}`, width: lineNumWidth }}>
                  <div className="py-3">
                    {Array.from({ length: lineCount }, (_, i) => (
                      <div key={i} className="pr-3 text-sm font-mono leading-5" style={{ height: 20 }}>{i + 1}</div>
                    ))}
                  </div>
                </div>
                {isEditing ? (
                  <textarea ref={textareaRef} value={activeTab.content} onChange={e => handleContentChange(e.target.value)}
                    onBlur={stopEditing}
                    onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); stopEditing(); } }}
                    className="flex-1 min-w-0 p-3 text-[13px] font-mono leading-5 resize-none outline-none bg-white"
                    style={{ tabSize: 2, whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto" }} spellCheck={false} />
                ) : (
                  <div className="flex-1 overflow-auto cursor-text" onClick={startEditing} onDoubleClick={startEditing}>
                    <pre ref={highlightRef} className="py-3 px-4 text-[13px] leading-5 font-mono" style={{ tabSize: 2 }}>
                      <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
                    </pre>
                    <div className="absolute bottom-3 right-3 text-xs text-stone-300 bg-white/80 px-2 py-1 rounded border" style={{ borderColor: tk.borderInput }}>
                      {tt("vibe.clickToEdit")} · Cmd+S {tt("vibe.save")} · {tt("vibe.autoSave")}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* === GIT PANEL (Diff / Blame / Status / Review) === */}
            {(activeSubPanel === "diff" || activeSubPanel === "blame") && showGitPanel && (
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Git sub-tabs */}
                <div className="flex items-center px-2 py-1 shrink-0 gap-0.5" style={{ backgroundColor: tk.bg, borderBottom: `1px solid ${tk.borderLight}` }}>
                  {(["status", "diff", "blame", "review"] as const).map(gitT => (
                    <button key={gitT} onClick={() => { setGitTab(gitT); if (gitT === "diff") setActiveSubPanel("diff"); if (gitT === "blame" && blameData) setActiveSubPanel("blame"); }}
                      className={cn("px-2.5 py-1 rounded text-xs font-semibold transition-colors",
                        gitTab === gitT ? "bg-stone-100 text-stone-700" : "text-stone-400 hover:text-stone-600")}>
                      {gitT === "status" ? tt("vibe.gitStatus") : gitT === "diff" ? tt("vibe.gitDiff") : gitT === "blame" ? tt("vibe.gitBlame") : tt("vibe.gitReview")}
                    </button>
                  ))}
                  <span className="flex-1" />
                  <button onClick={() => { refreshGitStatus(); refreshGitLog(); loadGitDiff(); }} className="text-xs text-stone-400 hover:text-stone-600 px-1.5 py-0.5 rounded hover:bg-stone-50">🔄</button>
                </div>

                {/* Git Status */}
                {gitTab === "status" && gitStatus && (
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    <div>
                      <div className="text-xs font-bold text-stone-500 mb-1">🌿 Branch: {gitStatus.branch}</div>
                    </div>
                    {gitStatus.staged.length > 0 && (
                      <div>
                        <div className="text-xs font-bold text-emerald-500 mb-1">{tt('vibe.gitStaged')} ({gitStatus.staged.length})</div>
                        {gitStatus.staged.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 py-0.5 text-xs hover:bg-stone-50 px-1 rounded cursor-pointer"
                            onClick={() => { loadGitDiff(f.path, true); setGitTab("diff"); setActiveSubPanel("diff"); }}>
                            <span className="text-xs font-bold text-emerald-500 w-4">{f.status}</span>
                            <span className="text-stone-600 truncate flex-1">{f.path}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {gitStatus.unstaged.length > 0 && (
                      <div>
                        <div className="text-xs font-bold text-amber-500 mb-1">{tt('vibe.gitUnstaged')} ({gitStatus.unstaged.length})</div>
                        {gitStatus.unstaged.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 py-0.5 text-xs hover:bg-stone-50 px-1 rounded cursor-pointer"
                            onClick={() => { loadGitDiff(f.path, false); setGitTab("diff"); setActiveSubPanel("diff"); }}>
                            <span className="text-xs font-bold text-amber-500 w-4">{f.status}</span>
                            <span className="text-stone-600 truncate flex-1">{f.path}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {gitStatus.untracked.length > 0 && (
                      <div>
                        <div className="text-xs font-bold text-stone-400 mb-1">{tt('vibe.gitUntracked')} ({gitStatus.untracked.length})</div>
                        {gitStatus.untracked.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 py-0.5 text-xs px-1">
                            <span className="text-xs font-bold text-stone-400 w-4">?</span>
                            <span className="text-stone-500 truncate">{f.path}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Recent commits */}
                    {gitLog.length > 0 && (
                      <div>
                        <div className="text-xs font-bold text-stone-500 mb-1">{tt('vibe.gitRecent')}</div>
                        {gitLog.slice(0, 8).map((c, i) => (
                          <div key={i} className="flex items-center gap-2 py-0.5 text-xs">
                            <span className="text-xs font-mono text-blue-500 shrink-0">{c.short}</span>
                            <span className="text-stone-600 truncate flex-1">{c.subject}</span>
                            <span className="text-stone-400 shrink-0">{fmtTime(c.date)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Diff View */}
                {gitTab === "diff" && (
                  <div className="flex-1 overflow-auto">
                    <div className="flex items-center gap-2 px-3 py-1.5 sticky top-0 bg-white z-10" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
                      <span className="text-xs font-bold text-stone-500">{gitDiffFile || tt("vibe.allChanges")}</span>
                      <label className="flex items-center gap-1 text-xs text-stone-400 cursor-pointer">
                        <input type="checkbox" checked={gitDiffCached} onChange={e => { setGitDiffCached(e.target.checked); loadGitDiff(gitDiffFile || undefined, e.target.checked); }} className="w-3 h-3" />
                        Staged only
                      </label>
                      <span className="flex-1" />
                      {activeTab && <button onClick={() => loadBlame(activeTab.path)} className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-500 hover:bg-stone-200">{tt('vibe.gitBlameFile')}</button>}
                      <button onClick={generateAiComment} disabled={!gitDiff} className="text-xs px-2 py-0.5 rounded text-white disabled:opacity-40" style={{ backgroundColor: tk.accent }}>🤖 AI Review</button>
                    </div>
                    {gitDiff ? (
                      <pre className="p-3 text-sm font-mono leading-5 overflow-x-auto">
                        <code dangerouslySetInnerHTML={{ __html: highlightedDiff }} />
                      </pre>
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-stone-400">{tt('vibe.gitNoChanges')}</div>
                    )}
                  </div>
                )}

                {/* Blame View */}
                {gitTab === "blame" && blameData && (
                  <div className="flex-1 overflow-auto">
                    <div className="flex items-center gap-2 px-3 py-1.5 sticky top-0 bg-white z-10" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
                      <span className="text-xs font-bold text-stone-500">🔍 Blame — {blameFile}</span>
                    </div>
                    <table className="w-full text-sm font-mono" style={{ borderCollapse: "collapse" }}>
                      <tbody>
                        {blameData.map((line, i) => {
                          const prevHash = i > 0 ? blameData[i - 1].hash : "";
                          const showAuthor = line.hash !== prevHash;
                          return (
                            <tr key={i} className={cn(showAuthor ? "" : "")} style={{ borderTop: showAuthor ? "1px solid #e5e5e5" : "none" }}>
                              <td className="px-2 py-0 text-right text-stone-300 select-none w-8 shrink-0">{line.finalLine}</td>
                              <td className="px-2 py-0 w-32 shrink-0 truncate" style={{ color: showAuthor ? "#3B82F6" : "#c0c0c0" }}>
                                {showAuthor ? (
                                  <span className="flex flex-col">
                                    <span className="truncate font-semibold">{line.author}</span>
                                    <span className="text-xs text-stone-400 truncate">{line.short || line.hash?.slice(0, 7)} · {fmtTime(line.authorTime)}</span>
                                  </span>
                                ) : <span className="text-stone-200">│</span>}
                              </td>
                              <td className="px-2 py-0 text-stone-700 leading-5 whitespace-pre">{line.content}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* AI Review */}
                {gitTab === "review" && (
                  <div className="flex-1 overflow-auto p-3">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-bold text-stone-700">🤖 {tt("vibe.gitReview")}</span>
                      <span className="flex-1" />
                      <button onClick={generateAiComment} disabled={aiCommentLoading || !gitDiff}
                        className="text-xs px-3 py-1 rounded text-white disabled:opacity-40 active:scale-95"
                        style={{ backgroundColor: tk.accent }}>
                        {aiCommentLoading ? `⏳ ${tt("vibe.gitReviewing")}` : tt("vibe.gitNewReview")}
                      </button>
                    </div>
                    {aiCommentLoading ? (
                      <div className="flex items-center justify-center h-32 text-stone-400 text-sm animate-pulse">🤖 {tt("vibe.gitReviewing")}</div>
                    ) : aiComment ? (
                      <div className="prose prose-sm max-w-none text-xs leading-relaxed whitespace-pre-wrap">{aiComment}</div>
                    ) : null}
                    {/* Review History */}
                    {gitReviews.length > 0 && (
                      <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
                        <div className="text-xs font-bold text-stone-500 mb-2">📜 {tt("vibe.gitReviewHistory")} ({gitReviews.length})</div>
                        {gitReviews.filter(r => r.comment !== aiComment).slice(0, 10).map((r, i) => (
                          <details key={r.id || i} className="mb-2">
                            <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700">
                              {r.branch && <span className="text-emerald-500 mr-1">🔀 {r.branch}</span>}
                              {fmtTime(r.ts)}
                              {r.files && <span className="text-stone-400 ml-1">· {r.files.length} files</span>}
                            </summary>
                            <div className="text-sm text-stone-600 mt-1 whitespace-pre-wrap leading-relaxed border-l-2 pl-3" style={{ borderColor: "#e5e5e5" }}>
                              {r.comment?.slice(0, 500)}{r.comment?.length > 500 ? "..." : ""}
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                    {!aiComment && gitReviews.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-32 gap-2 text-stone-400 text-xs">
                        <span className="text-2xl">🤖</span>
                        <p>{tt("vibe.gitReviewHint")}</p>
                        <p>{tt("vibe.gitReviewHint2")}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* === API TESTER === */}
            {activeSubPanel === "api-tester" && showApiTester && (
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top: Request Builder ── */}
                <div data-api-panel="request" className="shrink-0 overflow-y-auto p-3 space-y-2 flex flex-col" style={{ flex: "0 0 50%", borderBottom: `1px solid ${tk.borderLight}`, maxHeight: "70%" }}>
                  {/* Title bar + History dropdown */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-stone-500">🌐 API Tester</span>
                    <span className="flex-1" />
                    {rootPath && (
                      <button onClick={async () => {
                        try {
                          const res = await fetch(`${API_BASE}/api/coding-project/file?path=${encodeURIComponent(rootPath)}&file=test-payloads/all-payloads.json`);
                          if (res.ok) {
                            const data = await res.json();
                            if (data.content) {
                              try {
                                const payloads = JSON.parse(data.content);
                                if (payloads.tests?.[0]?.request) {
                                  const t = payloads.tests[0];
                                  setApiMethod(t.request.method || "GET");
                                  setApiUrl(t.request.path || "");
                                  if (t.request.headers) setApiHeaders(Object.entries(t.request.headers).map(([k, v]) => ({ key: k, value: String(v), enabled: true })));
                                  if (t.request.body) setApiBody(typeof t.request.body === "string" ? t.request.body : JSON.stringify(t.request.body, null, 2));
                                  alert(`已載入第 1 個 test payload（共 ${payloads.tests.length} 個）`);
                                } else if (payloads.endpoint) {
                                  setApiMethod(payloads.tests?.[0]?.request?.method || payloads.request?.method || "GET");
                                  setApiUrl(payloads.endpoint.split(" ").pop() || payloads.request?.path || "");
                                }
                              } catch { alert("AI test payload 格式有誤，請在 .paaw/test-payloads/ 檢查"); }
                            } else { alert("尚未產出 API Test Payload。先點 🚀 AI Initialize"); }
                          } else { alert("尚未產出 API Test Payload。先點 🚀 AI Initialize"); }
                        } catch { alert("載入失敗"); }
                      }} className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 hover:bg-emerald-200 font-bold" title="載入 AI 產出的 test payload">
                        🧪 AI
                      </button>
                    )}
                    {apiHistory.length > 0 && (
                      <div className="relative group">
                        <button className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 hover:bg-stone-200 font-semibold">
                          📜 {apiHistory.length}
                        </button>
                        {/* Dropdown */}
                        <div className="absolute right-0 top-full mt-1 w-80 max-h-64 overflow-y-auto bg-white rounded-lg shadow-xl border z-50 hidden group-hover:block" style={{ borderColor: tk.borderInput }}>
                          <div className="flex items-center px-3 py-1.5 sticky top-0 bg-white z-10" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
                            <span className="text-xs font-bold text-stone-500">History</span>
                            <span className="flex-1" />
                            <button onClick={() => setApiHistory([])} className="text-xs text-red-400 hover:text-red-600">Clear</button>
                          </div>
                          {apiHistory.map((h, hi) => (
                            <div key={h.id || hi} className="flex flex-col px-3 py-1.5 hover:bg-stone-50 cursor-pointer" style={{ borderBottom: "1px solid #f5f5f5" }}
                              onClick={() => { setApiMethod(h.method); setApiUrl(h.url); if (h.headers) setApiHeaders(h.headers); if (h.body !== undefined) setApiBody(h.body); if (h.streamMode !== undefined) setApiStreamMode(h.streamMode); }}>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold w-10 shrink-0" style={{ color: METHOD_COLORS[h.method] || "#6B7280" }}>{h.method}</span>
                                <span className="text-stone-600 truncate flex-1 font-mono text-xs">{h.url}</span>
                                <span className="text-xs font-bold shrink-0" style={{ color: h.status < 300 ? "#10B981" : h.status < 400 ? "#F59E0B" : "#EF4444" }}>{h.status}</span>
                                <span className="text-xs text-stone-400 shrink-0">{h.elapsed}ms</span>
                              </div>
                              {/* Response preview for e2e */}
                              {(h.response?.body || h.streamResponse) && (
                                <pre className="text-xs font-mono text-stone-400 mt-0.5 truncate">{tryFormatJson(h.response?.body || h.streamResponse || "").slice(0, 120)}</pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Quick URLs */}
                  <div className="flex flex-wrap gap-1 mb-1">
                    {[
                      { label: "PAAW Chat", url: `${API_BASE}/api/chat`, method: "POST" },
                      { label: "PAAW Status", url: `${API_BASE}/api/vibe-git/status`, method: "GET" },
                      { label: "PAAW FS", url: `${API_BASE}/api/vibe-fs/list`, method: "GET" },
                      { label: "Distill Config", url: `${API_BASE}/api/distill/config`, method: "GET" },
                      { label: "JSONPlaceholder", url: "https://jsonplaceholder.typicode.com/posts/1", method: "GET" },
                      { label: "HTTPBin", url: "https://httpbin.org/get", method: "GET" },
                      { label: "⚡ LLM Stream", url: "", method: "POST", stream: true },
                    ].map(q => (
                      <button key={q.label} onClick={() => {
                        if (q.url) setApiUrl(q.url);
                        setApiMethod(q.method);
                        if (q.stream) {
                          setApiStreamMode(true);
                          setApiHeaders([
                            { key: "Content-Type", value: "application/json", enabled: true },
                            { key: "Authorization", value: "Bearer YOUR_API_KEY", enabled: true },
                          ]);
                          setApiBody(JSON.stringify({
                            model: "gpt-4o-mini",
                            messages: [{ role: "user", content: "Say hello in 3 languages" }],
                            stream: true,
                          }, null, 2));
                        } else {
                          setApiStreamMode(false);
                        }
                      }}
                        className={cn("text-xs px-2 py-0.5 rounded-full border transition-colors",
                          q.stream ? "border-purple-200 text-purple-500 hover:bg-purple-50" : "border-stone-200 text-stone-500 hover:bg-stone-50 hover:border-stone-300")}>
                        {q.label}
                      </button>
                    ))}
                  </div>
                  {/* URL bar */}
                  <div className="flex items-center gap-2">
                    <select value={apiMethod} onChange={e => setApiMethod(e.target.value)}
                      className="text-sm font-bold px-2 py-1.5 border rounded-lg outline-none cursor-pointer"
                      style={{ borderColor: "#ddd", color: METHOD_COLORS[apiMethod] }}>
                      {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input value={apiUrl} onChange={e => setApiUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) sendApiRequest(); }}
                      placeholder="https://api.example.com/endpoint"
                      className="flex-1 text-sm font-mono px-3 py-1.5 border rounded-lg outline-none focus:border-blue-400"
                      style={{ borderColor: "#ddd" }} />
                    <button
                      onClick={() => setApiStreamMode(!apiStreamMode)}
                      className={cn("text-xs px-2 py-1.5 rounded-lg border font-semibold transition-colors",
                        apiStreamMode ? "bg-purple-600 text-white border-purple-600" : "text-stone-400 border-stone-200 hover:bg-stone-50")}
                      title="Toggle streaming mode (for LLM SSE endpoints)">
                      ⚡ Stream
                    </button>
                    {apiLoading && apiStreamMode ? (
                      <button onClick={() => apiStreamAbortRef.current?.abort()}
                        className="px-3 py-1.5 rounded-lg text-sm font-bold text-white bg-red-500 hover:bg-red-600 active:scale-95 transition-all">
                        ⏹ Stop
                      </button>
                    ) : (
                      <button onClick={sendApiRequest} disabled={apiLoading || !apiUrl.trim()}
                        className="px-4 py-1.5 rounded-lg text-sm font-bold text-white disabled:opacity-40 active:scale-95 transition-transform"
                        style={{ backgroundColor: tk.accent }}>
                        {apiLoading ? "⏳" : "Send"}
                      </button>
                    )}
                  </div>
                  {/* Headers (collapsible) */}
                  <details open>
                    <summary className="flex items-center gap-2 cursor-pointer select-none">
                      <span className="text-xs font-bold text-stone-500">{tt('vibe.apiHeaders')}</span>
                      <button onClick={e => { e.stopPropagation(); addHeader(); }} className="text-xs text-blue-500 hover:text-blue-600">{tt("vibe.apiAddHeader")}</button>
                      <span className="text-xs text-stone-400">{apiHeaders.filter(h => h.enabled).length}/{apiHeaders.length}</span>
                    </summary>
                    {apiHeaders.map((h, i) => (
                      <div key={i} className="flex items-center gap-1.5 mb-1">
                        <input type="checkbox" checked={h.enabled} onChange={e => updateHeader(i, "enabled", e.target.checked)} className="w-3 h-3" />
                        <input value={h.key} onChange={e => updateHeader(i, "key", e.target.value)} placeholder="Key"
                          className="flex-1 text-xs font-mono px-2 py-1 border rounded outline-none" style={{ borderColor: "#ddd" }} />
                        <input value={h.value} onChange={e => updateHeader(i, "value", e.target.value)} placeholder="Value"
                          className="flex-1 text-xs font-mono px-2 py-1 border rounded outline-none" style={{ borderColor: "#ddd" }} />
                        <button onClick={() => removeHeader(i)} className="text-stone-300 hover:text-red-500 text-xs">✕</button>
                      </div>
                    ))}
                  </details>
                  {/* Body */}
                  {apiMethod !== "GET" && apiMethod !== "HEAD" && (
                    <div className="flex flex-col flex-1 min-h-0">
                      <div className="flex items-center gap-2 mb-1 shrink-0">
                        <span className="text-xs font-bold text-stone-500 shrink-0">{tt('vibe.apiBody')}</span>
                        <button onClick={() => setApiBody(tryFormatJson(apiBody))}
                          className="text-xs text-stone-400 hover:text-stone-600">📐 {tt("vibe.format")}</button>
                      </div>
                      <textarea value={apiBody} onChange={e => setApiBody(e.target.value)}
                        placeholder='{"key": "value"}'
                        className="w-full flex-1 min-h-0 text-sm font-mono px-3 py-2 border rounded-lg outline-none focus:border-blue-400 resize-none"
                        style={{ borderColor: "#ddd" }} />
                    </div>
                  )}
                </div>

                {/* ── Splitter ── */}
                <div className="h-px cursor-row-resize hover:h-1 hover:bg-blue-400 active:bg-blue-500 transition-all shrink-0"
                  onMouseDown={e => {
                    e.preventDefault();
                    const container = e.currentTarget.parentElement;
                    if (!container) return;
                    const startY = e.clientY;
                    const reqPanel = container.querySelector('[data-api-panel="request"]') as HTMLElement;
                    const respPanel = container.querySelector('[data-api-panel="response"]') as HTMLElement;
                    if (!reqPanel || !respPanel) return;
                    const startReqH = reqPanel.offsetHeight;
                    const totalH = container.offsetHeight;
                    const onMove = (ev: MouseEvent) => {
                      const delta = ev.clientY - startY;
                      const newReqH = Math.max(120, Math.min(totalH - 120, startReqH + delta));
                      const pct = (newReqH / totalH) * 100;
                      reqPanel.style.flex = `0 0 ${pct}%`;
                      respPanel.style.flex = `1 1 ${100 - pct}%`;
                    };
                    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
                    document.addEventListener("mousemove", onMove);
                    document.addEventListener("mouseup", onUp);
                  } } style={{ backgroundColor: tk.border }} />

                {/* ── Bottom: Response Viewer ── */}
                <div data-api-panel="response" className="flex-1 overflow-y-auto p-3 min-h-0">
                  {/* ── Streaming response ── */}
                  {apiStreamMode && (apiStreamContent || apiLoading) ? (
                    <div className="flex flex-col h-full gap-2">
                      <div className="flex items-center gap-2 shrink-0">
                        {apiStreamInfo && (
                          <span className="text-xs font-bold" style={{ color: apiStreamInfo.status < 300 ? "#10B981" : apiStreamInfo.status < 400 ? "#F59E0B" : "#EF4444" }}>
                            {apiStreamInfo.status || "..."} {apiStreamInfo.statusText}
                          </span>
                        )}
                        {apiLoading && <span className="text-xs text-purple-500 animate-pulse">⚡ streaming...</span>}
                      </div>
                      <pre className="flex-1 text-sm font-mono bg-stone-900 text-green-300 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words min-h-0">
                        {apiStreamContent || "⏳ Waiting for response..."}
                      </pre>
                    </div>
                  ) : /* ── Normal response ── */ apiResponse ? (
                    <div className="flex flex-col h-full gap-2">
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-bold" style={{ color: apiResponse.status < 300 ? "#10B981" : apiResponse.status < 400 ? "#F59E0B" : "#EF4444" }}>
                          {apiResponse.status} {apiResponse.statusText}
                        </span>
                        <span className="text-xs text-stone-400">{apiResponse.elapsed}ms · {fmtBytes(apiResponse.size)}</span>
                      </div>
                      {Object.keys(apiResponse.headers).length > 0 && (
                        <details className="shrink-0">
                          <summary className="text-xs font-bold text-stone-400 cursor-pointer hover:text-stone-600">{tt('vibe.apiRespHeaders')}</summary>
                          <div className="text-xs font-mono bg-stone-50 rounded-lg p-2 space-y-0.5 mt-1">
                            {Object.entries(apiResponse.headers).map(([k, v]) => (
                              <div key={k}><span className="text-blue-600">{k}</span>: <span className="text-stone-600">{v}</span></div>
                            ))}
                          </div>
                        </details>
                      )}
                      <pre className="flex-1 text-sm font-mono bg-stone-800 text-green-300 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words min-h-0">
                        {apiResponse.body}
                      </pre>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-stone-400 text-xs">
                      <span className="text-2xl">📥</span>
                      <p>{tt("vibe.apiNoResponse")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === BROWSER PREVIEW === */}
            {activeSubPanel === "browser" && showBrowser && (
              <div className="flex-1 flex flex-col min-w-0">
                <BrowserPreview
                  projectRoot={rootPath || ""}
                  onConsoleLog={(entry) => setBrowserConsoleLogs(prev => [...prev.slice(-200), entry])}
                />
                <BrowserDevTools
                  consoleLogs={browserConsoleLogs}
                  onClearConsole={() => setBrowserConsoleLogs([])}
                  iframeUrl={undefined}
                />
              </div>
            )}

            {/* === Empty state === */}
            {activeSubPanel === "editor" && !activeTab && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8">
                <div className="text-5xl">⚡</div>
                <h2 className="text-lg font-bold text-stone-600">{tt("vibe.welcome")}</h2>
                <p className="text-stone-400 text-sm text-center max-w-md leading-relaxed">
                  {tt("vibe.welcomeLine1")}<br />
                  {tt("vibe.welcomeLine2")}<br />
                  {tt("vibe.welcomeLine3")}<br />
                  🤖 AI Chat — 對著檔案問問題
                </p>
              </div>
            )}

          </div>

          {/* Terminal resize handle */}
          {showTerminal && <div className="h-px cursor-row-resize hover:h-1 hover:bg-blue-400 active:bg-blue-500 transition-all shrink-0"
            onMouseDown={e => startResize("terminal", e)} style={{ backgroundColor: tk.border }} />}

          {/* Terminal */}
          {showTerminal && (
            <div className="shrink-0 flex flex-col" style={{ height: terminalHeight }}>
              <div className="flex items-center px-2 py-0.5 shrink-0 select-none" style={{ backgroundColor: "#1e1717", borderBottom: "1px solid #2d2424" }}>
                <span className="text-xs text-stone-400 font-semibold">
                  Terminal
                </span>
                <span className="flex-1" />
                <span className="text-[10px] text-stone-500">{rootPath ? rootPath.split(/[\\/]/).pop() : "~"}</span>
                <button onClick={() => setShowTerminal(false)} className="text-stone-500 hover:text-white text-xs ml-2">✕</button>
              </div>
              <div className="flex-1 min-h-0">
                <ShellTerminal cwd={rootPath || undefined} />
              </div>
            </div>
          )}
        </div>

        {/* ── Right Panel: Chat / Standards / Sessions ── */}
        {showAiPanel && (
          <>
            <div className="w-px cursor-col-resize hover:w-0.5 hover:bg-blue-400 active:bg-blue-500 transition-all shrink-0"
              onMouseDown={e => startResize("ai", e)} style={{ backgroundColor: tk.border }} />
            <div className="flex flex-col shrink-0 select-none" style={{ width: aiPanelWidth, backgroundColor: "#fff" }}>
              {/* Tab Bar */}
              <div className="flex items-center px-2 py-1.5 shrink-0 gap-0.5" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
                <button onClick={() => setRightTab("chat")}
                  className={cn("text-xs px-2.5 py-1 rounded-md font-semibold transition-colors",
                    rightTab === "chat" ? "bg-blue-100 text-blue-700" : "text-stone-400 hover:bg-stone-50")}>
                  🤖 Chat
                </button>
                <button onClick={() => setRightTab("standards")}
                  className={cn("text-xs px-2.5 py-1 rounded-md font-semibold transition-colors",
                    rightTab === "standards" ? "bg-purple-100 text-purple-700" : "text-stone-400 hover:bg-stone-50")}>
                  📏 Standards
                </button>
                <button onClick={() => setRightTab("sessions")}
                  className={cn("text-xs px-2.5 py-1 rounded-md font-semibold transition-colors",
                    rightTab === "sessions" ? "bg-green-100 text-green-700" : "text-stone-400 hover:bg-stone-50")}>
                  📜 Sessions
                </button>
                <button onClick={() => setRightTab("decisions")}
                  className={cn("text-xs px-2.5 py-1 rounded-md font-semibold transition-colors",
                    rightTab === "decisions" ? "bg-amber-100 text-amber-700" : "text-stone-400 hover:bg-stone-50")}>
                  🧠 ADR
                </button>
                <button onClick={() => setRightTab("health")}
                  className={cn("text-xs px-2.5 py-1 rounded-md font-semibold transition-colors",
                    rightTab === "health" ? "bg-teal-100 text-teal-700" : "text-stone-400 hover:bg-stone-50")}>
                  📊 Health
                </button>
                <button onClick={() => { setRightTab("status"); if (rootPath) fetch(`${API_BASE}/api/coding-project/status?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).then(setCodeStatus).catch(() => {}); }}
                  className={cn("text-xs px-2.5 py-1 rounded-md font-semibold transition-colors",
                    rightTab === "status" ? "bg-emerald-100 text-emerald-700" : "text-stone-400 hover:bg-stone-50")}>
                  🏥 Status
                </button>
                <button onClick={() => { setRightTab("prompts"); if (rootPath) fetch(`${API_BASE}/api/coding-project/prompts?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).then(data => { if (Array.isArray(data)) setAiPrompts(data); }).catch(() => {}); }}
                  className={cn("text-xs px-2.5 py-1 rounded-md font-semibold transition-colors",
                    rightTab === "prompts" ? "bg-orange-100 text-orange-700" : "text-stone-400 hover:bg-stone-50")}>
                  🎯 Prompts
                </button>
                <span className="flex-1" />
                {rightTab === "chat" && (
                  <button onClick={() => setShowAiPanel(false)} className="text-stone-400 hover:text-stone-700 text-xs px-1">✕</button>
                )}
                {rightTab !== "chat" && (
                  <button onClick={() => setShowAiPanel(false)} className="text-stone-400 hover:text-stone-700 text-xs px-1">✕</button>
                )}
              </div>

              {/* ── Chat Tab Content ── */}
              {rightTab === "chat" && (<>
              <div className="flex items-center px-3 py-1.5 shrink-0" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
                {activeTab && <span className="text-sm text-stone-400 ml-1 truncate">📄 {activeTab.name}</span>}
                <span className="flex-1" />
                {/* Mode toggle */}
                <div className="flex items-center gap-0.5 mr-2 flex-wrap">
                  <button onClick={() => setChatMode("agent")}
                    className={cn("text-[10px] px-2 py-1 rounded-full border font-semibold transition-colors",
                      chatMode === "agent" ? "bg-purple-100 text-purple-700 border-purple-300" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
                    🤖 Agent
                  </button>
                  <button onClick={() => setChatMode("chat")}
                    className={cn("text-[10px] px-2 py-1 rounded-full border font-semibold transition-colors",
                      chatMode === "chat" ? "bg-blue-100 text-blue-700 border-blue-300" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
                    💬 Chat
                  </button>
                  <span className="text-stone-200 mx-0.5">|</span>
                  <button onClick={() => setChatMode("spec")}
                    className={cn("text-[10px] px-1.5 py-1 rounded-full border font-semibold transition-colors",
                      chatMode === "spec" ? "bg-blue-50 text-blue-600 border-blue-200" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
                    📋 Spec
                  </button>
                  <button onClick={() => setChatMode("test")}
                    className={cn("text-[10px] px-1.5 py-1 rounded-full border font-semibold transition-colors",
                      chatMode === "test" ? "bg-purple-50 text-purple-600 border-purple-200" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
                    🧪 Test
                  </button>
                  <button onClick={() => setChatMode("bug")}
                    className={cn("text-[10px] px-1.5 py-1 rounded-full border font-semibold transition-colors",
                      chatMode === "bug" ? "bg-red-50 text-red-600 border-red-200" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
                    🐛 Bug
                  </button>
                  <button onClick={() => setChatMode("docs")}
                    className={cn("text-[10px] px-1.5 py-1 rounded-full border font-semibold transition-colors",
                      chatMode === "docs" ? "bg-amber-50 text-amber-600 border-amber-200" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
                    📖 Docs
                  </button>
                  <button onClick={() => setChatMode("maintain")}
                    className={cn("text-[10px] px-1.5 py-1 rounded-full border font-semibold transition-colors",
                      chatMode === "maintain" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
                    🔧 Maintain
                  </button>
                </div>
                <ModelSelector feature="coding" value={codingModel} onChange={setVibeModel} />
                {agentRunning && <span className="text-xs text-purple-500 animate-pulse mr-2">⚡ Running...</span>}
                {activeCrew && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold mr-2">
                    {codingCrews.find(c => c.id === activeCrew)?.emoji} {codingCrews.find(c => c.id === activeCrew)?.title}
                  </span>
                )}
                {["spec","test","bug","docs","maintain"].includes(chatMode) && (
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-bold mr-2",
                    chatMode === "spec" ? "bg-blue-50 text-blue-600" :
                    chatMode === "test" ? "bg-purple-50 text-purple-600" :
                    chatMode === "bug" ? "bg-red-50 text-red-600" :
                    chatMode === "docs" ? "bg-amber-50 text-amber-600" :
                    "bg-emerald-50 text-emerald-600")}>
                    {chatMode.toUpperCase()} AI
                  </span>
                )}
                <button onClick={() => setShowAiPanel(false)} className="text-stone-400 hover:text-stone-700 text-xs">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3" style={{ fontSize: 13 }}>
                {chatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-2">
                    <span className="text-3xl">🤖</span>
                    <p className="text-stone-400 text-sm">{tt("vibe.aiAskFile")}<br />{tt("vibe.aiAutoContextDesc")}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[tt("vibe.aiQuickExplain"), tt("vibe.aiQuickProblem"), tt("vibe.aiQuickComment"), tt("vibe.aiQuickPerf"), tt("vibe.aiQuickReview", "🔍 Review")].map(q => (
                        <button key={q} onClick={() => {
                          const isReview = q.includes("Review") || q.includes("review") || q.includes("レビュー");
                          if (isReview) {
                            setChatInput("請幫我 review 這個專案的整體狀況：git status、最近修改、架構、和需要注意的事項。");
                          } else {
                            setChatInput(q);
                          }
                        }}
                          className={cn("text-sm px-2.5 py-1.5 rounded-full border transition-colors",
                            q.includes("Review") ? "border-purple-200 text-purple-600 hover:bg-purple-50" : "border-stone-200 text-stone-500 hover:bg-stone-50 hover:border-stone-300")}>{q}</button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={cn("rounded-lg px-3 py-2.5 text-sm leading-relaxed", msg.role === "user" ? "bg-stone-100 text-stone-700" : "bg-blue-50 text-stone-700")}>
                    <div className="text-xs font-bold text-stone-400 mb-1">{msg.role === "user" ? tt("vibe.aiYou") : tt("vibe.ai")}</div>
                    <pre className="whitespace-pre-wrap font-sans break-words text-sm" style={{ fontFamily: "inherit" }}>{msg.content}</pre>
                  </div>
                ))}
                {chatLoading && <div className="text-sm text-stone-400 animate-pulse px-3 flex items-center gap-1.5"><span className="w-3 h-3 border-[1.5px] border-stone-400 border-t-transparent rounded-full animate-spin" />{tt("vibe.aiThinking")}</div>}
                <div ref={chatEndRef} />
              </div>
              {/* Agent Tool Log */}
              {agentToolLog.length > 0 && (
                <div className="px-3 py-2 shrink-0" style={{ borderTop: `1px solid ${tk.borderLight}`, maxHeight: 150, overflowY: "auto" }}>
                  <div className="text-xs font-bold text-purple-500 mb-1">⚡ Agent Tools ({agentToolLog.length})</div>
                  {agentToolLog.map((t, i) => (
                    <div key={i} className="text-xs text-stone-500 py-0.5 border-b" style={{ borderColor: "#f5f5f5" }}>
                      <span className="font-semibold text-purple-600">{t.name}</span>
                      <span className="text-stone-400 ml-1">{t.args?.slice(0, 60)}</span>
                      {t.result && <span className="text-emerald-500 ml-1">✓ {t.result.slice(0, 50)}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="px-2 py-2 shrink-0" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
                <div className="flex items-end gap-1.5">
                  <textarea value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setChatInput(""); sendChat(); } }}
                    placeholder={tt("vibe.aiPlaceholder")}
                    className="flex-1 text-sm px-3 py-2 border rounded-lg resize-none outline-none focus:border-blue-400"
                    style={{ borderColor: "#ddd", minHeight: 38, maxHeight: 120 }} rows={1} />
                  <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} data-send-chat
                    className="px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40 transition-all active:scale-95 shrink-0"
                    style={{ backgroundColor: tk.accent }}>Send</button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-stone-300">Enter 發送 · Shift+Enter 換行</span>
                  {activeTab && <span className="text-xs text-stone-300">· 自動帶入 {activeTab.name}</span>}
                </div>
              </div>
              </>)}

              {/* ── Standards Tab Content ── */}
              {rightTab === "standards" && (
                <div className="flex-1 min-h-0">
                  <StandardsEditor projectRoot={rootPath || ""} />
                </div>
              )}

              {/* ── Sessions Tab Content ── */}
              {rightTab === "sessions" && (
                <div className="flex-1 min-h-0">
                  <SessionHistory projectRoot={rootPath || ""} />
                </div>
              )}

              {/* ── Decisions Tab Content ── */}
              {rightTab === "decisions" && (
                <div className="flex-1 min-h-0">
                  <DecisionLog projectRoot={rootPath || ""} />
                </div>
              )}

              {/* ── Health Tab Content ── */}
              {rightTab === "health" && (
                <div className="flex-1 min-h-0">
                  <ProjectHealth projectRoot={rootPath || ""} />
                </div>
              )}
              {rightTab === "prompts" && (
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth: "thin" }}>
                  <div className="text-xs text-stone-400 mb-2">AI Initialize 使用的 Prompt 模板。自訂會覆蓋預設。</div>
                  {aiPrompts.map(p => (
                    <div key={p.filename} className="border rounded-lg p-3" style={{ borderColor: p.hasOverride ? "#fbbf24" : "#e5e5e5", backgroundColor: p.hasOverride ? "#fffbeb" : "#fff" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-stone-700">{p.name}</span>
                        {p.hasOverride && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 font-bold">自訂</span>}
                        <span className="flex-1" />
                        <button onClick={() => { setEditingPrompt(p.filename); setEditingPromptContent(p.activeContent); }}
                          className="text-xs px-2 py-1 rounded bg-stone-100 text-stone-600 hover:bg-stone-200">✏️ 編輯</button>
                        {p.hasOverride && (
                          <button onClick={async () => {
                            if (!confirm("確定要恢復預設 prompt？")) return;
                            await fetch(`${API_BASE}/api/coding-project/prompts/${p.filename}?path=${encodeURIComponent(rootPath)}`, { method: "DELETE" });
                            const updated = await fetch(`${API_BASE}/api/coding-project/prompts?path=${encodeURIComponent(rootPath)}`).then(r => r.json());
                            if (Array.isArray(updated)) setAiPrompts(updated);
                          }} className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-600 hover:bg-amber-100">↩ 預設</button>
                        )}
                      </div>
                      <div className="text-[10px] text-stone-400 truncate">{p.activeContent.slice(0, 100)}...</div>
                      <div className="text-[10px] text-stone-300 mt-0.5">{p.size.toLocaleString()} chars</div>
                    </div>
                  ))}
                  {editingPrompt && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingPrompt(null)}>
                      <div className="bg-white rounded-2xl shadow-2xl border flex flex-col" style={{ width: "min(640px, 90vw)", height: "min(70vh, 500px)" }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-2 border-b" style={{ backgroundColor: "#fff7ed", borderColor: "#fed7aa" }}>
                          <h3 className="text-sm font-bold text-orange-700">✏️ {editingPrompt}</h3>
                          <button onClick={() => setEditingPrompt(null)} className="text-stone-400 hover:text-stone-600">✕</button>
                        </div>
                        <textarea value={editingPromptContent} onChange={e => setEditingPromptContent(e.target.value)}
                          className="flex-1 p-3 text-sm font-mono resize-none outline-none" style={{ tabSize: 2 }} spellCheck={false} />
                        <div className="px-4 py-2 border-t flex items-center justify-between" style={{ borderColor: "#f0f0f0" }}>
                          <span className="text-[10px] text-stone-400">儲存後會覆蓋預設 prompt</span>
                          <div className="flex gap-2">
                            <button onClick={() => setEditingPrompt(null)} className="px-3 py-1.5 text-xs rounded-lg border border-stone-200 text-stone-600">取消</button>
                            <button onClick={async () => {
                              setPromptSaving(true);
                              await fetch(`${API_BASE}/api/coding-project/prompts/${editingPrompt}?path=${encodeURIComponent(rootPath)}`, {
                                method: "PUT", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ content: editingPromptContent }),
                              });
                              const updated = await fetch(`${API_BASE}/api/coding-project/prompts?path=${encodeURIComponent(rootPath)}`).then(r => r.json());
                              if (Array.isArray(updated)) setAiPrompts(updated);
                              setPromptSaving(false);
                              setEditingPrompt(null);
                            }} disabled={promptSaving}
                              className="px-4 py-1.5 text-xs font-bold text-white rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-50">
                              {promptSaving ? "儲存中..." : "💾 儲存"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {aiPrompts.length === 0 && (
                    <div className="text-center py-8 text-xs text-stone-400">開啟專案後可管理 AI Prompt</div>
                  )}
                </div>
              )}
              {rightTab === "status" && (
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "thin" }}>
                  {!codeStatus?.initialized && (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-3">🏥</div>
                      <div className="text-sm text-stone-400 mb-2">尚無專案健康資料</div>
                      <button onClick={() => { if (rootPath) fetch(`${API_BASE}/api/coding-project/status?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).then(setCodeStatus).catch(() => {}); }}
                        className="px-4 py-1.5 text-xs font-bold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700">
                        🔄 重新掃描
                      </button>
                    </div>
                  )}
                  {codeStatus?.initialized && (() => {
                    const areas = [
                      { key: "spec", icon: "📋", label: "Spec", color: "#3b82f6" },
                      { key: "test", icon: "🧪", label: "Test", color: "#8b5cf6" },
                      { key: "bug", icon: "🐛", label: "Bug/Error", color: "#ef4444" },
                      { key: "docs", icon: "📖", label: "Docs", color: "#f59e0b" },
                      { key: "maintain", icon: "🔧", label: "Maintain", color: "#10b981" },
                    ];
                    const maxScore = 100;
                    return (
                      <>
                        <div className="text-xs text-stone-400 mb-1">專案健康度大盤 · <button onClick={async () => { const s = await fetch(`${API_BASE}/api/coding-project/status?path=${encodeURIComponent(rootPath)}`).then(r => r.json()); setCodeStatus(s); }} className="text-emerald-600 hover:underline">刷新</button></div>
                        {/* Score cards row */}
                        <div className="grid grid-cols-5 gap-1.5">
                          {areas.map(a => {
                            const sc = codeStatus.scores?.[a.key];
                            const score = Math.min(sc?.score || 0, maxScore);
                            const pct = Math.round((score / maxScore) * 100);
                            const barColor = pct >= 70 ? a.color : pct >= 40 ? "#f59e0b" : "#ef4444";
                            return (
                              <div key={a.key} onClick={() => setExpandedArea(expandedArea === a.key ? null : a.key)}
                                className={cn("cursor-pointer rounded-lg p-2 text-center border-2 transition-all",
                                  expandedArea === a.key ? "border-stone-400 bg-stone-50" : "border-transparent hover:border-stone-200")}>
                                <div className="text-lg">{a.icon}</div>
                                <div className="text-[10px] text-stone-400 mt-0.5">{a.label}</div>
                                <div className="text-lg font-bold mt-0.5" style={{ color: barColor }}>{pct}</div>
                                <div className="w-full h-1 rounded-full bg-stone-100 mt-1">
                                  <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {/* Expanded detail */}
                        {expandedArea && codeStatus.scores?.[expandedArea] && (
                          <div className="border rounded-lg overflow-hidden" style={{ borderColor: areas.find(a => a.key === expandedArea)?.color || "#e5e5e5" }}>
                            <div className="px-3 py-2 flex items-center gap-2" style={{ backgroundColor: areas.find(a => a.key === expandedArea)?.color + "10" }}>
                              <span className="text-base">{areas.find(a => a.key === expandedArea)?.icon}</span>
                              <span className="text-sm font-bold" style={{ color: areas.find(a => a.key === expandedArea)?.color }}>{areas.find(a => a.key === expandedArea)?.label} Details</span>
                              <span className="flex-1" />
                              <button onClick={async () => {
                                if (fixingArea) return;
                                setFixingArea(expandedArea);
                                setFixProgress([]);
                                const res = await fetch(`${API_BASE}/api/coding-project/ai-fix?path=${encodeURIComponent(rootPath)}`, {
                                  method: "POST", headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ area: expandedArea }),
                                });
                                if (!res.ok || !res.body) { setFixingArea(null); return; }
                                const reader = res.body.getReader();
                                const decoder = new TextDecoder();
                                let buf = "";
                                while (true) {
                                  const { done, value } = await reader.read();
                                  if (done) break;
                                  buf += decoder.decode(value, { stream: true });
                                  const lines = buf.split("\n"); buf = lines.pop() || "";
                                  for (const line of lines) {
                                    if (line.startsWith("data: ")) {
                                      try {
                                        const d = JSON.parse(line.slice(6));
                                        if (d.step) {
                                          if (d.error) {
                                            setFixProgress(prev => [...prev, { step: d.step, status: "error" as const }]);
                                          } else if (d.preview !== undefined) {
                                            setFixProgress(prev => [...prev, { step: d.step, status: "done" as const }]);
                                          } else if (d.reason) {
                                            setFixProgress(prev => [...prev, { step: d.step, status: "skip" as const }]);
                                          } else {
                                            setFixProgress(prev => [...prev, { step: d.step, name: d.name, status: "running" as const }]);
                                          }
                                        }
                                        if (d.scores) setCodeStatus({ initialized: true, scores: d.scores });
                                        if (d.message?.includes("complete")) setFixingArea(null);
                                      } catch {}
                                    }
                                  }
                                }
                                setFixingArea(null);
                              }} disabled={!!fixingArea}
                                className={cn("text-[10px] px-2 py-1 rounded-full font-bold",
                                  fixingArea ? "bg-stone-100 text-stone-400" : "bg-emerald-100 text-emerald-600 hover:bg-emerald-200")}>
                                🤖 Auto Fix
                              </button>
                              <button onClick={() => {
                                const modeMap: Record<string, string> = { spec: "spec", test: "test", bug: "bug", docs: "docs", maintain: "maintain" };
                                const labelMap: Record<string, string> = { spec: "Spec", test: "Test", bug: "Bug/Error", docs: "Docs", maintain: "Maintainability" };
                                setChatMode(modeMap[expandedArea] as any);
                                setDomainAutoPrompt({ mode: expandedArea, prompt: `分析 ${labelMap[expandedArea]} 區域的缺口，列出要補的項目` });
                                setShowAiPanel(true);
                                setRightTab("chat");
                              }} className="text-[10px] px-2 py-1 rounded-full font-bold bg-purple-50 text-purple-600 hover:bg-purple-100">
                                💬 Chat AI
                              </button>
                            </div>
                            {/* Fix progress */}
                            {fixingArea === expandedArea && fixProgress.length > 0 && (
                              <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 space-y-1">
                                {fixProgress.map((fp, i) => (
                                  <div key={i} className="text-[10px] flex items-center gap-1.5">
                                    <span>{fp.status === "done" ? "✅" : fp.status === "running" ? "⏳" : fp.status === "error" ? "❌" : "⏭️"}</span>
                                    <span className={fp.status === "running" ? "text-amber-700 animate-pulse" : "text-stone-500"}>{fp.name || fp.step}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Items */}
                            <div className="divide-y divide-stone-100">
                              {codeStatus.scores[expandedArea].items.map((item, i) => (
                                <div key={i} className="px-3 py-2 flex items-center gap-2">
                                  <span className="text-sm">{item.status === "ok" ? "✅" : item.status === "warn" ? "⚠️" : item.status === "missing" ? "❌" : "ℹ️"}</span>
                                  <span className="text-xs font-medium text-stone-700">{item.name}</span>
                                  <span className="flex-1" />
                                  <span className={cn("text-[10px]",
                                    item.status === "ok" ? "text-emerald-500" : item.status === "warn" ? "text-amber-500" : item.status === "missing" ? "text-red-400" : "text-stone-400")}>
                                    {item.detail}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Quick actions */}
                        <div className="mt-2 space-y-1.5">
                          <div className="text-[10px] text-stone-400 font-bold">⚡ Quick Actions</div>
                          <div className="flex flex-wrap gap-1.5">
                            <button onClick={() => { setChatMode("spec"); setDomainAutoPrompt({ mode: "spec", prompt: "分析 Spec 區域的缺口，列出要補的項目" }); setShowAiPanel(true); setRightTab("chat"); }} className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium">📋 Spec AI</button>
                            <button onClick={() => { setChatMode("test"); setDomainAutoPrompt({ mode: "test", prompt: "分析 Test 覆蓋率缺口，列出缺少的 test payload 和測試" }); setShowAiPanel(true); setRightTab("chat"); }} className="text-[10px] px-2.5 py-1 rounded-full bg-purple-50 text-purple-600 hover:bg-purple-100 font-medium">🧪 Test AI</button>
                            <button onClick={() => { setChatMode("docs"); setDomainAutoPrompt({ mode: "docs", prompt: "分析文件缺失和過時的內容，列出需要更新的項目" }); setShowAiPanel(true); setRightTab("chat"); }} className="text-[10px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 font-medium">📖 Docs AI</button>
                            <button onClick={() => { startAiInitialize(); }} className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium">🚀 Full AI Init</button>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Quick Open Modal (Cmd+P) ── */}
      {showQuickOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setShowQuickOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
          <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center px-4 py-3 border-b border-stone-100">
              <span className="text-stone-400 mr-2">🔍</span>
              <input
                ref={quickOpenRef}
                value={quickOpenQuery}
                onChange={e => setQuickOpenQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setQuickOpenIndex(i => Math.min(i + 1, quickOpenResults.length - 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setQuickOpenIndex(i => Math.max(i - 1, 0)); }
                  if (e.key === "Enter") { e.preventDefault(); if (quickOpenResults[quickOpenIndex]) quickOpenSelect(quickOpenResults[quickOpenIndex].path); }
                }}
                placeholder={tt("coding.searchFilePlaceholder")}
                className="flex-1 text-sm outline-none bg-transparent"
              />
              <span className="text-[10px] text-stone-300 ml-2 shrink-0">⌘P</span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {quickOpenResults.length === 0 && quickOpenQuery && (
                <div className="px-4 py-8 text-center text-sm text-stone-400">沒有匹配的檔案</div>
              )}
              {quickOpenResults.length === 0 && !quickOpenQuery && (
                <div className="px-4 py-8 text-center text-sm text-stone-400">開始輸入以搜尋檔案...</div>
              )}
              {quickOpenResults.map((file, i) => (
                <div
                  key={file.path}
                  className={cn("flex items-center gap-2 px-4 py-2 cursor-pointer text-sm", i === quickOpenIndex ? "bg-blue-50" : "hover:bg-stone-50")}
                  onClick={() => quickOpenSelect(file.path)}
                  onMouseEnter={() => setQuickOpenIndex(i)}
                >
                  <span className="text-stone-400">📄</span>
                  <span className="font-medium text-stone-700 truncate">{file.name}</span>
                  <span className="text-[11px] text-stone-400 truncate flex-1 ml-2">{file.path.replace(rootPath, "").replace(/^\//, "")}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-1.5 border-t border-stone-100 flex items-center gap-3 text-[10px] text-stone-400">
              <span>↑↓ 導覽</span>
              <span>Enter 開啟</span>
              <span>Esc 關閉</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Global Search Panel (Cmd+Shift+F) ── */}
      {showSearch && (
        <div className="absolute top-9 left-0 right-0 z-30 bg-white border-b shadow-lg" style={{ borderColor: tk.border, maxHeight: "50vh" }}>
          {/* Search header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-100">
            <span className="text-stone-400">📋</span>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") runSearch(); }}
              placeholder={tt("coding.searchContentPlaceholder")}
              className="flex-1 text-sm px-2 py-1 border rounded outline-none focus:border-blue-400"
              style={{ borderColor: tk.borderInput }}
            />
            {/* Toggle buttons */}
            <button onClick={() => { setSearchCaseSensitive(!searchCaseSensitive); }} title={tt("coding.caseSensitive")}
              className={cn("text-xs px-1.5 py-1 rounded font-bold border transition-colors", searchCaseSensitive ? "bg-stone-700 text-white border-stone-700" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>Aa</button>
            <button onClick={() => { setSearchWholeWord(!searchWholeWord); }} title={tt("coding.wholeWord")}
              className={cn("text-xs px-1.5 py-1 rounded font-bold border transition-colors", searchWholeWord ? "bg-stone-700 text-white border-stone-700" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>W</button>
            <button onClick={() => { setSearchUseRegex(!searchUseRegex); }} title={tt("coding.useRegex")}
              className={cn("text-xs px-1.5 py-1 rounded font-bold border transition-colors", searchUseRegex ? "bg-stone-700 text-white border-stone-700" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>.*</button>
            <input
              value={searchInclude}
              onChange={e => setSearchInclude(e.target.value)}
              placeholder="include: *.ts,*.mjs"
              className="text-xs px-2 py-1 border rounded outline-none focus:border-blue-400 w-36"
              style={{ borderColor: tk.borderInput }}
            />
            {searching && <span className="w-4 h-4 border-[1.5px] border-stone-400 border-t-transparent rounded-full animate-spin" />}
            <button onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }} className="text-stone-400 hover:text-stone-700 text-xs ml-1">✕</button>
          </div>

          {/* Search results */}
          <div className="overflow-y-auto" style={{ maxHeight: "calc(50vh - 50px)" }}>
            {searchResults.length === 0 && !searching && searchQuery && (
              <div className="px-4 py-6 text-center text-sm text-stone-400">沒有找到結果</div>
            )}
            {searchResults.length === 0 && !searchQuery && (
              <div className="px-4 py-6 text-center text-sm text-stone-400">輸入關鍵字開始搜尋檔案內容</div>
            )}
            {searchResults.map(file => {
              const isExpanded = searchExpanded.has(file.path);
              return (
                <div key={file.path} className="border-b border-stone-50">
                  {/* File header */}
                  <div
                    className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-stone-50"
                    onClick={() => {
                      const next = new Set(searchExpanded);
                      if (next.has(file.path)) next.delete(file.path); else next.add(file.path);
                      setSearchExpanded(next);
                    }}
                  >
                    <span className="text-[10px] text-stone-400 w-3">{isExpanded ? "▼" : "▶"}</span>
                    <span className="text-stone-400">📄</span>
                    <span className="text-xs font-medium text-stone-700 truncate flex-1">{file.filename}</span>
                    <span className="text-[10px] text-stone-400 truncate max-w-[40%]">{file.path.replace(rootPath, "").replace(/^\//, "")}</span>
                    <span className="text-[10px] text-stone-400 bg-stone-100 px-1.5 rounded-full shrink-0">{file.matches.length}</span>
                  </div>
                  {/* Matches */}
                  {isExpanded && file.matches.map((match, mi) => (
                    <div
                      key={mi}
                      className="flex items-start gap-2 px-3 py-0.5 pl-8 cursor-pointer hover:bg-blue-50 text-xs"
                      onClick={() => { openFile(file.path); setActiveSubPanel("editor"); }}
                    >
                      <span className="text-stone-400 shrink-0 w-8 text-right">{match.line}</span>
                      <span className="text-stone-600 truncate">{highlightMatch(match.content, searchQuery, searchCaseSensitive)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
    </>
  );
}

// ── Highlight match in search result ──
function highlightMatch(text: string, query: string, caseSensitive: boolean): React.ReactNode {
  if (!query) return text;
  try {
    const flags = caseSensitive ? "g" : "gi";
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, flags));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 text-stone-900 rounded px-0.5">{part}</mark>
        : part
    );
  } catch {
    return text;
  }
}
