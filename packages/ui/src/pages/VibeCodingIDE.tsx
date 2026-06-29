/**
 * VibeCodingIDE — All-in-one AI coding environment
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
import { FileIcon } from "../components/Icon";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";

import API_BASE from "../api";
import DirectoryExplorer from "../components/DirectoryExplorer";

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

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const METHOD_COLORS: Record<string, string> = {
  GET: "#10B981", POST: "#3B82F6", PUT: "#F59E0B", PATCH: "#8B5CF6",
  DELETE: "#EF4444", HEAD: "#6B7280", OPTIONS: "#6B7280",
};

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
export default function VibeCodingIDE() {
  const { info: themeInfo } = useTheme();
  const { t } = useI18n();

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
  }), [themeInfo]);

  // ── Layout State ──
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [aiPanelWidth, setAiPanelWidth] = useState(360);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showApiTester, setShowApiTester] = useState(false);
  const [activeSubPanel, setActiveSubPanel] = useState<"editor" | "diff" | "blame" | "api-tester">("editor");
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

  useEffect(() => { try { localStorage.setItem("paaw.vibeide.rootPath", rootPath); } catch {} }, [rootPath]);
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
    if (dirContents[path] || loadingDirs.has(path)) return;
    setLoadingDirs(prev => new Set(prev).add(path));
    try {
      const res = await fetch(`${API_BASE}/api/vibe-fs/list?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.items) { setDirContents(prev => ({ ...prev, [path]: data.items })); setExpandedDirs(prev => new Set(prev).add(path)); }
    } catch {}
    setLoadingDirs(prev => { const n = new Set(prev); n.delete(path); return n; });
  }, [dirContents, loadingDirs]);

  const toggleDir = useCallback((path: string) => {
    if (expandedDirs.has(path)) setExpandedDirs(prev => { const n = new Set(prev); n.delete(path); return n; });
    else expandDir(path);
  }, [expandedDirs, expandDir]);

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
        const name = path.split("/").pop() || path;
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
  const [chatMode, setChatMode] = useState<"chat" | "agent">("agent");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentToolLog, setAgentToolLog] = useState<Array<{name: string; args: string; result: string}>>([]);

const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput.trim(), ts: new Date().toISOString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    logEvent("ai_chat", { prompt: chatInput.trim().slice(0, 200) });

    if (chatMode === "agent") {
      // ── PAAW Agent Loop (self-owned runtime, no external CLI) ──
      setChatLoading(true);
      setAgentRunning(true);
      setAgentToolLog([]);
      try {
        const context = activeTab ? `\n\n[Current file: ${activeTab.path}]\n\`\`\`${activeTab.hljsLang}\n${activeTab.content.slice(0, 3000)}\n\`\`\`` : "";
        const res = await fetch(`${API_BASE}/api/agent-run/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: userMsg.content + context,
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

  // ── File Explorer Tree Render ──
  // VS Code style: compact indent + guide lines, handles 10+ levels without widening
  // BASE_INDENT matches NavItem paddingLeft (28px) so tree items align with sidebar nav items
  const BASE_INDENT = 28;
  const DEPTH_STEP = 10;
  const GUIDE_COLOR = "#e5e5e5";

  const renderTree = (parentPath: string, depth: number) => {
    const items = dirContents[parentPath];
    if (!items) return null;
    const indentPx = BASE_INDENT + depth * DEPTH_STEP;
    return items.map(item => {
      // Build indent guide lines for each ancestor level (VS Code style)
      const guides = Array.from({ length: depth }, (_, i) => (
        <span key={i} className="shrink-0" style={{
          width: `${DEPTH_STEP}px`,
          borderLeft: `1px solid ${GUIDE_COLOR}`,
          alignSelf: "stretch",
          marginLeft: i === 0 ? `${BASE_INDENT}px` : 0,
        }} />
      ));

      if (item.isDirectory) {
        const isExpanded = expandedDirs.has(item.path);
        return (
          <div key={item.path}>
            <button
              onClick={() => toggleDir(item.path)}
              className="flex w-full items-center pr-2 py-[3px] text-left text-[13px] leading-tight transition-colors"
              style={{
                color: "#78716c",
                height: "22px",
              }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = tk.bgMuted; e.currentTarget.style.color = "#374151"; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = "#78716c"; }}
            >
              {guides}
              <span className="flex items-center shrink-0" style={{ width: `${DEPTH_STEP}px`, justifyContent: "center" }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                  className={cn("w-3 h-3 transition-transform duration-150", isExpanded ? "" : "-rotate-90")}
                  style={{ color: "#9ca3af" }}
                >
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </span>
              <span className="truncate ml-0.5">{item.name}</span>
            </button>
            {isExpanded && renderTree(item.path, depth + 1)}
          </div>
        );
      }
      const isActive = activeTabId === item.path;
      const isOpen = openTabs.some(ot => ot.id === item.path);
      const ext = item.name.includes(".") ? item.name.split(".").pop()! : "";
      const modified = openTabs.find(ot => ot.id === item.path)?.modified;
      return (
        <button
          key={item.path}
          onClick={() => openFile(item.path)}
          className="flex w-full items-center pr-2 text-left text-[13px] leading-tight transition-colors"
          style={{
            height: "22px",
            borderLeft: isActive ? "2px solid #3b82f6" : "2px solid transparent",
            backgroundColor: isActive ? "#eff6ff" : undefined,
            color: isActive ? "#1e40af" : isOpen ? "#3b82f6aa" : "#78716c",
            fontWeight: isActive ? 600 : 400,
          }}
          onMouseEnter={e => { if (!isActive) { e.currentTarget.style.backgroundColor = "#fafafa"; e.currentTarget.style.color = "#374151"; } }}
          onMouseLeave={e => { if (!isActive) { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = isOpen ? "#3b82f6aa" : "#78716c"; } }}
        >
          {guides}
          <span className="flex items-center shrink-0" style={{ width: `${DEPTH_STEP}px`, justifyContent: "center" }}>
            <FileIcon ext={ext} size={13} />
          </span>
          <span className="truncate ml-0.5">{item.name}</span>
          {modified && <span className="text-[9px] text-amber-500 ml-auto shrink-0 pr-1">●</span>}
        </button>
      );
    });
  };

  // ═══════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════
  return (
    <>
    {/* Directory Explorer Modal */}
    {showDirExplorer && (
      <DirectoryExplorer
        initialPath={rootPath || undefined}
        onSelect={(path) => { setRootPath(path); setShowDirExplorer(false); expandDir(path); setExpandedDirs(new Set()); }}
        onClose={() => setShowDirExplorer(false)}
        title="📂 選擇專案目錄"
      />
    )}
    <div className="h-full flex flex-col w-full overflow-hidden" style={{ backgroundColor: "#fff" }}>
      {/* ── Top Bar ── */}
      <div className="flex items-center h-9 px-3 border-b shrink-0 select-none" style={{ backgroundColor: "#fff", borderColor: "#e5e5e5" }}>
        <span className="text-sm font-bold text-stone-700">{t("vibe.title")}</span>

        {/* Search shortcut buttons */}
        <button onClick={() => { setShowQuickOpen(true); setQuickOpenQuery(""); setQuickOpenResults([]); setQuickOpenIndex(0); }}
          className="ml-2 text-xs px-2 py-1 rounded-lg border border-stone-200 text-stone-400 hover:bg-stone-50 hover:text-stone-600 transition-colors flex items-center gap-1"
          title="Quick Open (Cmd+P)">
          🔍 <span className="text-[10px]">⌘P</span>
        </button>
        <button onClick={() => { setShowSearch(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
          className="ml-1 text-xs px-2 py-1 rounded-lg border border-stone-200 text-stone-400 hover:bg-stone-50 hover:text-stone-600 transition-colors flex items-center gap-1"
          title="Search (Cmd+Shift+F)">
          📋 <span className="text-[10px]">⇧⌘F</span>
        </button>

        <div className="flex-1" />
        <button onClick={() => { setShowGitPanel(!showGitPanel); if (!showGitPanel) { setActiveSubPanel("diff"); } }}
          className={cn("text-xs px-2 py-1 rounded-lg border font-semibold transition-colors mr-1",
            showGitPanel ? "bg-stone-800 text-white border-stone-800" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
          {t("vibe.git")}
        </button>
        <button onClick={() => { setShowApiTester(!showApiTester); if (!showApiTester) { setActiveSubPanel("api-tester"); } }}
          className={cn("text-xs px-2 py-1 rounded-lg border font-semibold transition-colors mr-1",
            showApiTester ? "bg-stone-800 text-white border-stone-800" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
          {t("vibe.api")}
        </button>
        <button onClick={() => setShowAiPanel(!showAiPanel)}
          className={cn("text-xs px-2 py-1 rounded-lg border font-semibold transition-colors mr-1",
            showAiPanel ? "bg-stone-800 text-white border-stone-800" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
          {t("vibe.ai")}
        </button>
        <button onClick={() => setShowTerminal(!showTerminal)}
          disabled={!rootPath}
          className={cn("text-xs px-2 py-1 rounded-lg border font-semibold transition-colors",
            showTerminal ? "bg-stone-800 text-white border-stone-800" : "text-stone-400 border-stone-200 hover:bg-stone-50",
            !rootPath && "opacity-30 cursor-not-allowed")}>
          {t("vibe.term")}
        </button>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex min-h-0">
        {/* ── File Explorer ── */}
        <div className="flex flex-col shrink-0 select-none" style={{ width: sidebarWidth, backgroundColor: "#fff" }}>
          <div className="px-2 py-1.5 " style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
            <div className="flex items-center gap-1.5">
              <input value={rootPath} onChange={e => setRootPath(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && rootPath) { expandDir(rootPath); setExpandedDirs(new Set()); } }}
                placeholder={t("vibe.projectPath")}
                className="flex-1 text-sm font-mono px-2 py-1 border rounded bg-stone-50 outline-none focus:border-blue-400" style={{ borderColor: tk.borderInput }} />
              <button onClick={() => setShowDirExplorer(true)}
                className="text-xs px-1.5 py-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-600" title="瀏覽選擇目錄">📂</button>
            </div>
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
          <div className="flex-1 overflow-y-auto py-0.5" style={{ fontSize: 14 }}>
            {rootPath ? renderTree(rootPath, 0) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
                <span className="text-3xl">📂</span>
                <p className="text-xs text-stone-400">{t("vibe.noProject")}</p>
              </div>
            )}
          </div>
          <div className="px-2 py-1 flex items-center" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
            <span className="text-xs text-stone-400 truncate">{rootPath ? rootPath.split("/").pop() : "No project"}</span>
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
              const fi = getFileIcon(tab.name);
              return (
                <div key={tab.id}
                  className={cn("group flex items-center gap-1 px-3 py-1 cursor-pointer select-none text-xs shrink-0 transition-colors",
                    activeTabId === tab.id ? "bg-white text-stone-800" : "text-stone-400 hover:bg-stone-100")}
                  style={activeTabId === tab.id ? { borderTop: "2px solid #3b82f6" } : { borderTop: "2px solid transparent" }}
                  onClick={() => { setActiveTabId(tab.id); setIsEditing(false); setActiveSubPanel("editor"); }}>
                  <span className="text-xs font-bold shrink-0" style={{ color: fi.color }}>{fi.icon}</span>
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
            {activeSubPanel === "editor" && openTabs.length === 0 && <div className="px-4 py-1.5 text-xs text-stone-300">{t("vibe.noFilesOpen")}</div>}
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
                      {t("vibe.clickToEdit")} · Cmd+S {t("vibe.save")} · {t("vibe.autoSave")}
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
                      {gitT === "status" ? t("vibe.gitStatus") : gitT === "diff" ? t("vibe.gitDiff") : gitT === "blame" ? t("vibe.gitBlame") : t("vibe.gitReview")}
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
                        <div className="text-xs font-bold text-emerald-500 mb-1">{t('vibe.gitStaged')} ({gitStatus.staged.length})</div>
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
                        <div className="text-xs font-bold text-amber-500 mb-1">{t('vibe.gitUnstaged')} ({gitStatus.unstaged.length})</div>
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
                        <div className="text-xs font-bold text-stone-400 mb-1">{t('vibe.gitUntracked')} ({gitStatus.untracked.length})</div>
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
                        <div className="text-xs font-bold text-stone-500 mb-1">{t('vibe.gitRecent')}</div>
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
                      <span className="text-xs font-bold text-stone-500">{gitDiffFile || t("vibe.allChanges")}</span>
                      <label className="flex items-center gap-1 text-xs text-stone-400 cursor-pointer">
                        <input type="checkbox" checked={gitDiffCached} onChange={e => { setGitDiffCached(e.target.checked); loadGitDiff(gitDiffFile || undefined, e.target.checked); }} className="w-3 h-3" />
                        Staged only
                      </label>
                      <span className="flex-1" />
                      {activeTab && <button onClick={() => loadBlame(activeTab.path)} className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-500 hover:bg-stone-200">{t('vibe.gitBlameFile')}</button>}
                      <button onClick={generateAiComment} disabled={!gitDiff} className="text-xs px-2 py-0.5 rounded text-white disabled:opacity-40" style={{ backgroundColor: tk.accent }}>🤖 AI Review</button>
                    </div>
                    {gitDiff ? (
                      <pre className="p-3 text-sm font-mono leading-5 overflow-x-auto">
                        <code dangerouslySetInnerHTML={{ __html: highlightedDiff }} />
                      </pre>
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-stone-400">{t('vibe.gitNoChanges')}</div>
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
                      <span className="text-xs font-bold text-stone-700">🤖 {t("vibe.gitReview")}</span>
                      <span className="flex-1" />
                      <button onClick={generateAiComment} disabled={aiCommentLoading || !gitDiff}
                        className="text-xs px-3 py-1 rounded text-white disabled:opacity-40 active:scale-95"
                        style={{ backgroundColor: tk.accent }}>
                        {aiCommentLoading ? `⏳ ${t("vibe.gitReviewing")}` : t("vibe.gitNewReview")}
                      </button>
                    </div>
                    {aiCommentLoading ? (
                      <div className="flex items-center justify-center h-32 text-stone-400 text-sm animate-pulse">🤖 {t("vibe.gitReviewing")}</div>
                    ) : aiComment ? (
                      <div className="prose prose-sm max-w-none text-xs leading-relaxed whitespace-pre-wrap">{aiComment}</div>
                    ) : null}
                    {/* Review History */}
                    {gitReviews.length > 0 && (
                      <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${tk.borderLight}` }}>
                        <div className="text-xs font-bold text-stone-500 mb-2">📜 {t("vibe.gitReviewHistory")} ({gitReviews.length})</div>
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
                        <p>{t("vibe.gitReviewHint")}</p>
                        <p>{t("vibe.gitReviewHint2")}</p>
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
                      <span className="text-xs font-bold text-stone-500">{t('vibe.apiHeaders')}</span>
                      <button onClick={e => { e.stopPropagation(); addHeader(); }} className="text-xs text-blue-500 hover:text-blue-600">{t("vibe.apiAddHeader")}</button>
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
                        <span className="text-xs font-bold text-stone-500 shrink-0">{t('vibe.apiBody')}</span>
                        <button onClick={() => setApiBody(tryFormatJson(apiBody))}
                          className="text-xs text-stone-400 hover:text-stone-600">📐 {t("vibe.format")}</button>
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
                          <summary className="text-xs font-bold text-stone-400 cursor-pointer hover:text-stone-600">{t('vibe.apiRespHeaders')}</summary>
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
                      <p>{t("vibe.apiNoResponse")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === Empty state === */}
            {activeSubPanel === "editor" && !activeTab && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8">
                <div className="text-5xl">⚡</div>
                <h2 className="text-lg font-bold text-stone-600">Vibe Coding IDE</h2>
                <p className="text-stone-400 text-sm text-center max-w-md leading-relaxed">
                  {t("vibe.welcomeLine1")}<br />
                  {t("vibe.welcomeLine2")}<br />
                  {t("vibe.welcomeLine3")}<br />
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
                <span className="text-[10px] text-stone-500">{rootPath ? rootPath.split("/").pop() : "~"}</span>
                <button onClick={() => setShowTerminal(false)} className="text-stone-500 hover:text-white text-xs ml-2">✕</button>
              </div>
              <div className="flex-1 min-h-0">
                <ShellTerminal cwd={rootPath || undefined} />
              </div>
            </div>
          )}
        </div>

        {/* ── AI Chat Sidebar ── */}
        {showAiPanel && (
          <>
            <div className="w-px cursor-col-resize hover:w-0.5 hover:bg-blue-400 active:bg-blue-500 transition-all shrink-0"
              onMouseDown={e => startResize("ai", e)} style={{ backgroundColor: tk.border }} />
            <div className="flex flex-col shrink-0 select-none" style={{ width: aiPanelWidth, backgroundColor: "#fff" }}>
              <div className="flex items-center px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
                <span className="text-sm font-bold text-stone-700">{t("vibe.aiChat")}</span>
                {activeTab && <span className="text-sm text-stone-400 ml-2 truncate">({activeTab.name})</span>}
                <span className="flex-1" />
                {/* Mode toggle: Agent vs Chat */}
                <div className="flex items-center gap-1 mr-2">
                  <button onClick={() => setChatMode("agent")}
                    className={cn("text-xs px-2.5 py-1 rounded-full border font-semibold transition-colors",
                      chatMode === "agent" ? "bg-purple-100 text-purple-700 border-purple-300" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
                    🤖 Agent
                  </button>
                  <button onClick={() => setChatMode("chat")}
                    className={cn("text-xs px-2.5 py-1 rounded-full border font-semibold transition-colors",
                      chatMode === "chat" ? "bg-blue-100 text-blue-700 border-blue-300" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>
                    💬 Chat
                  </button>
                </div>
                {agentRunning && <span className="text-xs text-purple-500 animate-pulse mr-2">⚡ Running...</span>}
                <button onClick={() => setShowAiPanel(false)} className="text-stone-400 hover:text-stone-700 text-xs">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3" style={{ fontSize: 13 }}>
                {chatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-2">
                    <span className="text-3xl">🤖</span>
                    <p className="text-stone-400 text-sm">{t("vibe.aiAskFile")}<br />{t("vibe.aiAutoContextDesc")}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[t("vibe.aiQuickExplain"), t("vibe.aiQuickProblem"), t("vibe.aiQuickComment"), t("vibe.aiQuickPerf")].map(q => (
                        <button key={q} onClick={() => setChatInput(q)}
                          className="text-sm px-2.5 py-1.5 rounded-full border border-stone-200 text-stone-500 hover:bg-stone-50 hover:border-stone-300 transition-colors">{q}</button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={cn("rounded-lg px-3 py-2.5 text-sm leading-relaxed", msg.role === "user" ? "bg-stone-100 text-stone-700" : "bg-blue-50 text-stone-700")}>
                    <div className="text-xs font-bold text-stone-400 mb-1">{msg.role === "user" ? t("vibe.aiYou") : "🤖 AI"}</div>
                    <pre className="whitespace-pre-wrap font-sans break-words text-sm" style={{ fontFamily: "inherit" }}>{msg.content}</pre>
                  </div>
                ))}
                {chatLoading && <div className="text-sm text-stone-400 animate-pulse px-3 flex items-center gap-1.5"><span className="w-3 h-3 border-[1.5px] border-stone-400 border-t-transparent rounded-full animate-spin" />{t("vibe.aiThinking")}</div>}
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
                    placeholder={t("vibe.aiPlaceholder")}
                    className="flex-1 text-sm px-3 py-2 border rounded-lg resize-none outline-none focus:border-blue-400"
                    style={{ borderColor: "#ddd", minHeight: 38, maxHeight: 120 }} rows={1} />
                  <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                    className="px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40 transition-all active:scale-95 shrink-0"
                    style={{ backgroundColor: tk.accent }}>Send</button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-stone-300">Enter 發送 · Shift+Enter 換行</span>
                  {activeTab && <span className="text-xs text-stone-300">· 自動帶入 {activeTab.name}</span>}
                </div>
              </div>
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
                placeholder="搜尋檔案... (依路徑或檔名)"
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
              placeholder="搜尋檔案內容..."
              className="flex-1 text-sm px-2 py-1 border rounded outline-none focus:border-blue-400"
              style={{ borderColor: tk.borderInput }}
            />
            {/* Toggle buttons */}
            <button onClick={() => { setSearchCaseSensitive(!searchCaseSensitive); }} title="區分大小寫"
              className={cn("text-xs px-1.5 py-1 rounded font-bold border transition-colors", searchCaseSensitive ? "bg-stone-700 text-white border-stone-700" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>Aa</button>
            <button onClick={() => { setSearchWholeWord(!searchWholeWord); }} title="全字匹配"
              className={cn("text-xs px-1.5 py-1 rounded font-bold border transition-colors", searchWholeWord ? "bg-stone-700 text-white border-stone-700" : "text-stone-400 border-stone-200 hover:bg-stone-50")}>W</button>
            <button onClick={() => { setSearchUseRegex(!searchUseRegex); }} title="正則表達式"
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
