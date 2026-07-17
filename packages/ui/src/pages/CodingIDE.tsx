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
import EMDashboard from "../components/EMDashboard";
import StandardsEditor from "../components/StandardsEditor";
import SessionHistory from "../components/SessionHistory";
import BrowserPreview from "../components/BrowserPreview";
import BrowserDevTools, { type ConsoleEntry } from "../components/BrowserDevTools";
import DecisionLog from "../components/DecisionLog";
import ModelSelector from "../components/ModelSelector";
import { ChatMessages, type ChatMessageItem } from "../components/ChatMessages";
import IssueTracker from "../components/IssueTracker";
import AgentMemoryPanel from "../components/AgentMemoryPanel";
import FeatureMap from "../components/FeatureMap";
import NightShiftPanel from "../components/NightShiftPanel";
import SecurityTab from "../components/SecurityTab";
import FileViewer from "../pages/FileViewer";

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

// ── Main Tab Types ──
type MainTabType = "editor" | "viewer" | "git" | "api" | "browser" | "terminal" | "ai-crew" | "standards" | "sessions" | "decisions" | "health" | "em-dashboard" | "prompts" | "issues" | "memory" | "features" | "nightshift" | "security";

interface MainTab {
  id: string;
  type: MainTabType;
  label: string;
  icon: string;
  closable: boolean;
  crewId?: string;
  filePath?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  _thinking?: boolean; // internal flag for intermediate thinking bubbles
  _thinkingHistory?: string[]; // preserved thinking texts before final answer replaces them
  _toolCalls?: { name: string; args?: string; result?: string }[]; // tool calls made in this turn
  _streaming?: boolean; // true while content is being streamed in (OpenClaw style)
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

  // ── Main Tabs (unified: editor files + tools + AI crew) ──
  // Code Dashboard is always the first tab (landing page, not closable)
  const DASHBOARD_TAB_ID = "tool:code-dashboard";
  const DASHBOARD_TAB: MainTab = { id: DASHBOARD_TAB_ID, type: "em-dashboard", label: "EM 大總管", icon: "🎖️", closable: false };
  const [mainTabs, setMainTabs] = useState<MainTab[]>([DASHBOARD_TAB]);
  const [activeMainTabId, setActiveMainTabId] = useState<string>(DASHBOARD_TAB_ID);
  const activeMainTab = useMemo(() => mainTabs.find(t => t.id === activeMainTabId), [mainTabs, activeMainTabId]);

  // Sync activeCrew when switching tabs (crew tabs have crewId)
  useEffect(() => {
    if (activeMainTab?.type === "ai-crew" && activeMainTab.crewId) {
      setActiveCrew(activeMainTab.crewId);
      // Refresh archived conversations when switching crew tab
      if (rootPath && showArchivePanel) {
        loadArchivedConversations(activeMainTab.crewId, rootPath);
      }
    }
  }, [activeMainTab?.type, activeMainTab?.crewId, rootPath, showArchivePanel]);

  const openMainTab = useCallback((tab: MainTab) => {
    setMainTabs(prev => {
      const existing = prev.find(t => t.id === tab.id);
      if (existing) return prev;
      // Ensure dashboard tab stays first
      return [DASHBOARD_TAB, ...prev.filter(t => t.id !== DASHBOARD_TAB_ID), tab];
    });
    // Always activate the tab (existing or new)
    setActiveMainTabId(tab.id);
  }, []);

  const closeMainTab = useCallback((id: string) => {
    if (id === DASHBOARD_TAB_ID) return; // Dashboard cannot be closed
    setMainTabs(prev => {
      const remaining = prev.filter(t => t.id !== id);
      if (activeMainTabId === id) {
        setActiveMainTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : DASHBOARD_TAB_ID);
      }
      return remaining;
    });
  }, [activeMainTabId]);

  // ── Open new Browser / Terminal instances ──
  const openNewBrowser = useCallback(() => {
    const count = browserCounterRef.current++;
    const tabId = `tool:browser#${count}`;
    openMainTab({ id: tabId, type: "browser", label: `Browser ${count + 1}`, icon: "\uD83D\uDC41\uFE0F", closable: true });
  }, [openMainTab]);

  const openNewTerminal = useCallback(() => {
    if (!rootPath) return;
    const count = terminalCounterRef.current++;
    const tabId = `tool:terminal#${count}`;
    openMainTab({ id: tabId, type: "terminal", label: `Terminal ${count + 1}`, icon: "\u2328\uFE0F", closable: true });
  }, [openMainTab, rootPath]);

  const [loadingFile, setLoadingFile] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);


  const [activeCrew, setActiveCrew] = useState<string | null>(null);

  // ── AI Chat State (per-crew conversations) ──
  const [crewConversations, setCrewConversations] = useState<Record<string, ChatMessage[]>>({});
  const chatMessages = useMemo(() => activeCrew ? (crewConversations[activeCrew] || []) : [], [activeCrew, crewConversations]);
  const setChatMessages = useCallback((fn: (prev: ChatMessage[]) => ChatMessage[]) => {
    if (!activeCrew) return;
    setCrewConversations(prev => {
      const current = prev[activeCrew] || [];
      const next = typeof fn === 'function' ? fn(current) : fn;
      return { ...prev, [activeCrew]: next };
    });
  }, [activeCrew]);
  const [chatInput, setChatInput] = useState("");
  const [crewLoading, setCrewLoading] = useState<Record<string, boolean>>({}); // crewId → chatLoading
  const [crewAgentRunning, setCrewAgentRunning] = useState<Record<string, boolean>>({}); // crewId → agentRunning
  const [crewAgentAction, setCrewAgentAction] = useState<Record<string, string>>({}); // crewId → agentAction
  const [crewAgentToolLog, setCrewAgentToolLog] = useState<Record<string, Array<{name: string; args: string; result: string}>>>({}); // crewId → toolLog
  const chatLoading = activeCrew ? !!crewLoading[activeCrew] : false;
  const agentRunning = activeCrew ? !!crewAgentRunning[activeCrew] : false;
  const agentAction = activeCrew ? (crewAgentAction[activeCrew] || "") : "";
  const agentToolLog = activeCrew ? (crewAgentToolLog[activeCrew] || []) : [];
  const setChatLoading = useCallback((v: boolean) => { if (activeCrew) setCrewLoading(prev => ({ ...prev, [activeCrew]: v })); }, [activeCrew]);
  const setAgentRunning = useCallback((v: boolean) => { if (activeCrew) setCrewAgentRunning(prev => ({ ...prev, [activeCrew]: v })); }, [activeCrew]);
  const setAgentAction = useCallback((v: string) => { if (activeCrew) setCrewAgentAction(prev => ({ ...prev, [activeCrew]: v })); }, [activeCrew]);
  const setAgentToolLog = useCallback((v: Array<{name: string; args: string; result: string}> | ((prev: Array<{name: string; args: string; result: string}>) => Array<{name: string; args: string; result: string}>)) => {
    if (!activeCrew) return;
    if (typeof v === "function") {
      setCrewAgentToolLog(prev => {
        const current = prev[activeCrew] || [];
        const next = v(current);
        return { ...prev, [activeCrew]: next };
      });
    } else {
      setCrewAgentToolLog(prev => ({ ...prev, [activeCrew]: v }));
    }
  }, [activeCrew]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const prevChatLenRef = useRef(0);
  const loadingFileRef = useRef(false);
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs; // keep in sync
  // Crew profile data
  const [crewProfile, setCrewProfile] = useState<Record<string, any>>({});
  const [loadedCrews, setLoadedCrews] = useState<Set<string>>(new Set()); // track which crew conversations have been loaded from server
  const [archivedConversations, setArchivedConversations] = useState<Record<string, any[]>>({}); // crewId → list of archives
  const [showArchivePanel, setShowArchivePanel] = useState(false);
  const [viewingArchive, setViewingArchive] = useState<string | null>(null); // archiveId when viewing an archived conversation
  const [showContextDebug, setShowContextDebug] = useState(false);
  const [contextDebug, setContextDebug] = useState<any>(null);

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
  const [showBrowserMenu, setShowBrowserMenu] = useState(false);
  const [showTerminalMenu, setShowTerminalMenu] = useState(false);
  // ── Agent System Context Viewer ──
  const [agentContextData, setAgentContextData] = useState<{ agentId: string; agentName: string; baseSystemPrompt: string; dynamicContext: { source: string; content: string }[]; totalLength: number } | null>(null);
  const [agentContextLoading, setAgentContextLoading] = useState(false);
  // ── Multi-instance counters for Browser & Terminal ──
  const browserCounterRef = useRef(0);
  const terminalCounterRef = useRef(0);

  // ── Click-outside: close all toolbar dropdowns ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If click is outside any toolbar dropdown trigger AND outside dropdown panels, close all menus
      if (!target.closest(".toolbar-dropdown-trigger") && !target.closest(".toolbar-dropdown-panel")) {
        setShowProjectMenu(false);
        setShowSearchMenu(false);
        setShowCrewMenu(false);
        setShowBrowserMenu(false);
        setShowTerminalMenu(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // ── Coding Crew Definitions ──
  const codingCrews = [
    { id: "coding.architect", emoji: "🏛️", title: "林曉薇 架構師", mode: "chat" as const, agentId: "architect" },
    { id: "coding.developer", emoji: "💻", title: "普里亞 Developer", mode: "chat" as const, agentId: "developer" },
    { id: "coding.tester", emoji: "🧪", title: "迪維雅 Test Agent", mode: "chat" as const, agentId: "tester" },
    { id: "coding.doc-writer", emoji: "📝", title: "梅根 Document Agent", mode: "chat" as const, agentId: "doc-writer" },
    { id: "coding.helpdesk", emoji: "🌸", title: "小春 林 Helpdesk", mode: "chat" as const, agentId: "helpdesk" },
    { id: "coding.qa", emoji: "🩺", title: "武大安 QA Agent", mode: "chat" as const, agentId: "qa" },
  ];

  // ── EM Orchestration State ──
  const [emRunning, setEmRunning] = useState(false);
  const [emLog, setEmLog] = useState<string[]>([]);

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
    setChatMessages(() => []);
    try { localStorage.removeItem("paaw.vibeide.rootPath"); } catch {}
  }, [rootPath]);

  // ── Code Understanding State ──
  const [aiInitializing, setAiInitializing] = useState(false);
  const [aiInitSteps, setAiInitSteps] = useState<Array<{ id: string; name: string; status: "pending" | "running" | "done" | "error" | "skip"; size?: number; error?: string }>>([]);
  const [paawRefreshKey, setPaawRefreshKey] = useState(0);
  const [showAiInitPanel, setShowAiInitPanel] = useState(false);

  // ── AI Prompt Management State ──
  const [aiPrompts, setAiPrompts] = useState<Array<{ filename: string; name: string; defaultContent: string; customContent: string | null; activeContent: string; hasOverride: boolean; size: number }>>([]);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editingPromptContent, setEditingPromptContent] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);

  // ── Code Status Dashboard State ──
  const [domainAutoPrompt, setDomainAutoPrompt] = useState<{ mode: string; prompt: string } | null>(null);

  const startAiInitialize = useCallback(async () => {
    if (!rootPath || aiInitializing) return;
    setAiInitializing(true);
    const steps = [
      { id: "scan", name: "🔍 掃描專案結構" },
      { id: "architecture", name: "📐 Architecture Map" },
      { id: "feature-map", name: "🗺️ Feature Map" },
      { id: "api-spec", name: "📡 API Contract" },
      { id: "code-intelligence", name: "🧠 Code Intelligence" },
      { id: "test-intelligence", name: "🧪 Test Intelligence" },
      { id: "error-mapping", name: "🐛 Error Map + Runbooks" },
      { id: "security-scan", name: "🔒 Security Scan" },
      { id: "standards", name: "🏛️ Coding Standards" },
      { id: "overview", name: "📊 PROJECT.md" },
      { id: "change-intelligence", name: "🔄 Change Intelligence" },
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
                if (data.message === "Code Understanding complete") {
                  setAiInitializing(false);
                  setPaawRefreshKey(k => k + 1);
                  // Auto-open Features tab after Code Understanding completes
                  openMainTab({ id: "tool:features", type: "features", label: "Features", icon: "🗺️", closable: true });
                }
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      setAiInitSteps(prev => prev.map(s => ({ ...s, status: "error" as const, error: err.message })));
      setPaawRefreshKey(k => k + 1);
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
  const [gitCommitMsg, setGitCommitMsg] = useState("");
  const [gitActionMsg, setGitActionMsg] = useState<string | null>(null);
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
  const [projectApis, setProjectApis] = useState<{ method: string; path: string; file: string }[]>([]);
  const [projectApiExamples, setProjectApiExamples] = useState<{ method: string; endpoint: string; description: string; request: any; response: any }[]>([]);
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
    })();
  }, []);

  // Load project APIs when rootPath changes
  useEffect(() => {
    if (!rootPath) { setProjectApis([]); return; }
    fetch(`${API_BASE}/api/api-tester/project-apis?root=${encodeURIComponent(rootPath)}`)
      .then(r => r.json())
      .then(data => {
        setProjectApis(data.routes || []);
        setProjectApiExamples(data.examples || []);
      })
      .catch(() => { setProjectApis([]); setProjectApiExamples([]); });
  }, [rootPath]);

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
  // Crew Conversation Persistence — load on crew switch, save after each turn
  // ═══════════════════════════════════════════════
  // Load crew conversation from server when activeCrew changes
  useEffect(() => {
    if (!activeCrew || !rootPath) return;
    if (loadedCrews.has(activeCrew)) return; // already loaded (or in-memory)
    // If we already have messages in state (e.g. from greeting), don't overwrite
    if (crewConversations[activeCrew] && crewConversations[activeCrew].length > 0) {
      setLoadedCrews(prev => new Set(prev).add(activeCrew));
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(activeCrew)}?cwd=${encodeURIComponent(rootPath)}`);
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          // Don't count greeting from server — it was saved before the _greeting fix
          setCrewConversations(prev => ({ ...prev, [activeCrew]: data.messages }));
        }
        setLoadedCrews(prev => new Set(prev).add(activeCrew));
      } catch {
        setLoadedCrews(prev => new Set(prev).add(activeCrew));
      }
    })();
  }, [activeCrew, rootPath, loadedCrews, crewConversations]);

  // Save crew conversation to server (debounced)
  const saveConversationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeCrew || !rootPath) return;
    const messages = crewConversations[activeCrew];
    if (!messages || messages.length === 0) return;
    // Don't save if only greeting messages (no real conversation yet)
    const hasRealMessages = messages.some(m => !m._greeting && m.role === "user");
    if (!hasRealMessages) return;
    // Debounce: save 2 seconds after last change
    if (saveConversationTimerRef.current) clearTimeout(saveConversationTimerRef.current);
    saveConversationTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(activeCrew)}?cwd=${encodeURIComponent(rootPath)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Strip _greeting flag before saving — greeting is UI-only
          body: JSON.stringify({ messages: messages.map(({ _greeting, ...rest }) => rest) }),
        });
      } catch {}
    }, 2000);
    return () => { if (saveConversationTimerRef.current) clearTimeout(saveConversationTimerRef.current); };
  }, [crewConversations, activeCrew, rootPath]);

  // Reset loaded crews when project changes
  useEffect(() => {
    setLoadedCrews(new Set());
    setCrewConversations({});
    setArchivedConversations({});
    setViewingArchive(null);
    setShowArchivePanel(false);
  }, [rootPath]);

  // ═══════════════════════════════════════════════
  // Conversation Archive Actions
  // ═══════════════════════════════════════════════
  // Start new conversation — archive active session + start fresh (like /new)
  const startNewConversation = useCallback(async () => {
    if (!activeCrew || !rootPath) return;
    const current = crewConversations[activeCrew] || [];
    if (current.length === 0) return; // nothing to archive
    try {
      await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(activeCrew)}/new-session?cwd=${encodeURIComponent(rootPath)}`, {
        method: "POST",
      });
      // Clear current conversation
      setCrewConversations(prev => ({ ...prev, [activeCrew]: [] }));
      setViewingArchive(null);
      setShowArchivePanel(false);
      // Refresh session list
      loadArchivedConversations(activeCrew, rootPath);
    } catch {}
  }, [activeCrew, rootPath, crewConversations]);

  // Load session list for a crew (active + history)
  const loadArchivedConversations = useCallback(async (crewId: string, cwd: string) => {
    const effectiveCwd = cwd || rootPath;
    if (!effectiveCwd) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(crewId)}/sessions?cwd=${encodeURIComponent(effectiveCwd)}`);
      const data = await res.json();
      setArchivedConversations(prev => ({ ...prev, [crewId]: data.sessions || [] }));
    } catch {
      setArchivedConversations(prev => ({ ...prev, [crewId]: [] }));
    }
  }, [rootPath]);

  // Load a specific session (view history, or continue in current)
  const loadArchivedConversation = useCallback(async (sessionId: string) => {
    if (!activeCrew || !rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(activeCrew)}/sessions/${encodeURIComponent(sessionId)}?cwd=${encodeURIComponent(rootPath)}`);
      const data = await res.json();
      if (data.messages) {
        setCrewConversations(prev => ({ ...prev, [activeCrew]: data.messages }));
        setViewingArchive(sessionId);
        setShowArchivePanel(false);
      }
    } catch {}
  }, [activeCrew, rootPath]);

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
    if (loadingFileRef.current) return; // prevent double-click race
    const existing = openTabsRef.current.find(ot => ot.path === path);
    if (existing) { setActiveTabId(existing.id); return; }

    // Decide viewer vs editor based on file type
    const name = path.split(/[\\/]/).pop() || path;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const useViewer = ["md", "markdown", "json"].includes(ext);

    if (useViewer) {
      // Open as viewer tab (FileViewer handles md/json rendering)
      openMainTab({ id: `file:${path}`, type: "viewer", label: name, icon: getFileIcon(name), closable: true, filePath: path });
      return;
    }

    setLoadingFile(true);
    loadingFileRef.current = true;
    try {
      const res = await fetch(`${API_BASE}/api/vibe-fs/read?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.content !== undefined) {
        const tab: OpenTab = { id: path, name, path, content: data.content, originalContent: data.content, modified: false, language: getLanguage(name), hljsLang: getHljsLang(name), lastSaved: data.modified };
        setOpenTabs(prev => {
          // Double-check not already added
          if (prev.find(ot => ot.path === path)) return prev;
          return [...prev, tab];
        });
        setActiveTabId(path);
        setIsEditing(false);
        // Open as main tab too
        openMainTab({ id: `file:${path}`, type: "editor", label: name, icon: getFileIcon(name), closable: true, filePath: path });
        logEvent("open_file", { path, language: tab.language });
      }
    } catch {}
    setLoadingFile(false);
    loadingFileRef.current = false;
  }, [logEvent, openMainTab]);

  const closeTab = useCallback((id: string) => {
    setOpenTabs(prev => prev.filter(ot => ot.id !== id));
    if (activeTabId === id) { const remaining = openTabs.filter(ot => ot.id !== id); setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null); }
    closeMainTab(`file:${id}`);
    logEvent("close_file", { path: id });
  }, [activeTabId, openTabs, logEvent, closeMainTab]);

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
  // agentRunning/agentToolLog are now per-crew (derived from crewAgentRunning/crewAgentToolLog above)
  const [crewModels, setCrewModels] = useState<Record<string, string>>({}); // crewId → model
  const codingModel = activeCrew ? (crewModels[activeCrew] || "") : "";
  const setCodingModel = useCallback((model: string) => {
    if (!activeCrew) return;
    setCrewModels(prev => ({ ...prev, [activeCrew]: model }));
  }, [activeCrew]);

const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;

    // ── Auto-archive: if last message was >30 min ago, archive current and start fresh ──
    if (activeCrew && rootPath) {
      const msgs = crewConversations[activeCrew] || [];
      const lastRealMsg = [...msgs].reverse().find(m => m.role === "user" && !m._greeting);
      if (lastRealMsg?.ts) {
        const lastTs = new Date(lastRealMsg.ts).getTime();
        const gapMs = Date.now() - lastTs;
        if (gapMs > 30 * 60 * 1000 && msgs.some(m => m.role === "user" && !m._greeting)) {
          try {
            await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(activeCrew)}/new-session?cwd=${encodeURIComponent(rootPath)}`, { method: "POST" });
            setCrewConversations(prev => ({ ...prev, [activeCrew]: [] }));
            // Refresh archive list
            const sessRes = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(activeCrew)}/sessions?cwd=${encodeURIComponent(rootPath)}`);
            const sessData = await sessRes.json();
            setArchivedConversations(prev => ({ ...prev, [activeCrew]: sessData.sessions || [] }));
          } catch {}
        }
      }
    }

    const userMsg: ChatMessage = { role: "user", content: chatInput.trim(), ts: new Date().toISOString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setViewingArchive(null); // exit archive viewing when user sends a message
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
            model: codingModel || undefined,
            history: chatMessages.filter(m => !m._thinking).map(m => ({ role: m.role, content: m.content })),
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
      setChatLoading(false); setAgentAction("");
    } else {
      // ── Both agent + chat mode: A2A domain agent dispatch ──
      const isAgentMode = chatMode === "agent";
      setChatLoading(true);
      if (isAgentMode) { setAgentRunning(true); setAgentToolLog([]); }

      try {
        // ── A2A JSON-RPC: message/stream ──
        // Map crewId → A2A agentId
        const CREW_TO_AGENT: Record<string, string> = {
          "coding.architect": "architect",
          "coding.helpdesk": "helpdesk",
          "coding.developer": "developer",
          "coding.tester": "tester",
          "coding.doc-writer": "doc-writer",
          "coding.qa": "qa",
        };
        const a2aAgentId = CREW_TO_AGENT[activeCrew || ""] || activeCrew?.replace(/^coding\./, "") || "architect";
        const res = await fetch(`${API_BASE}/a2a/${a2aAgentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "message/stream",
            params: {
              message: { role: "user", parts: [{ type: "text", text: userMsg.content }] },
              context: {
                cwd: rootPath || undefined,
                ...(activeTab ? { activeFile: activeTab.path, activeFileContent: activeTab.content.slice(0, 3000) } : {}),
              },
              metadata: codingModel ? { model: codingModel } : undefined,
              conversationHistory: (crewConversations[activeCrew || "coding.architect"] || []).map(({ _greeting, ...rest }) => rest),
            },
            id: `msg-${Date.now()}`,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          setChatMessages(prev => [...prev, { role: "assistant", content: `❌ Agent error: ${errText.slice(0, 200)}`, ts: new Date().toISOString() }]);
          setChatLoading(false); setAgentAction(""); if (isAgentMode) setAgentRunning(false); return;
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let finalContent = "";
        // Accumulate tool calls + thinking silently — only show final answer (OpenClaw style)
        const silentToolCalls: { name: string; args?: string; result?: string }[] = [];
        let buffer = "";

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("event: ") || line.startsWith("data: ")) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));

                  // thinking events — silently ignored (OpenClaw style: just show typing)
                  // No bubble created, no overwrite, no fake data displayed

                  // tool call — track silently for conversation history + show action in typing indicator
                  if (data.name && data.args !== undefined) {
                    // Update typing indicator with current action
                    const actionLabels = {
                      read_file: "📖 讀取檔案",
                      write_file: "✏️ 寫入檔案",
                      edit_file: "✏️ 編輯檔案",
                      glob: "🔍 搜尋檔案",
                      grep: "🔍 搜尋內容",
                      bash: "⚡ 執行指令",
                      git: "🔄 Git 操作",
                      project_context: "📋 讀取專案資訊",
                      project_decisions: "📋 讀取決策紀錄",
                      project_issues: "📋 讀取 Issue",
                      record_decision: "📝 記錄決策",
                      update_changelog: "📝 更新 Changelog",
                      update_docs: "📝 更新文件",
                      diff: "🔍 比較差異",
                      ask_user: "❓ 詢問用戶",
                      browser_test: "🌐 瀏覽器測試",
                    };
                    const actionLabel = actionLabels[data.name] || `🔧 ${data.name}`;
                    // Show file name if available
                    const argsObj = typeof data.args === "string" ? (() => { try { return JSON.parse(data.args); } catch { return {}; } })() : data.args;
                    const detail = argsObj?.path || argsObj?.file || argsObj?.pattern || argsObj?.command || "";
                    setAgentAction(detail ? `${actionLabel} ${detail.split(/[\/\\]/).pop()}` : actionLabel);

                    if (isAgentMode) {
                      setAgentToolLog(prev => [...prev, { name: data.name, args: typeof data.args === "string" ? data.args : JSON.stringify(data.args), result: "..." }]);
                    }
                    silentToolCalls.push({ name: data.name, args: typeof data.args === "string" ? data.args : JSON.stringify(data.args) });
                  }

                  // tool result — track silently
                  if (data.name && data.result !== undefined && data.result !== "...") {
                    if (isAgentMode) {
                      setAgentToolLog(prev => {
                        const updated = [...prev];
                        const idx = updated.length - 1;
                        if (idx >= 0 && updated[idx].name === data.name) {
                          updated[idx] = { ...updated[idx], result: data.result };
                        }
                        return updated;
                      });
                    }
                    // Update silent tracking
                    const lastTool = silentToolCalls[silentToolCalls.length - 1];
                    if (lastTool && lastTool.name === data.name) {
                      lastTool.result = data.result;
                    }
                  }

                  // info events — silently ignored (typing indicator covers this)

                  // final content — THE ONLY thing that creates a visible message
                  if (data.content && data.done) {
                    finalContent = data.content;
                    setAgentAction(""); // clear action indicator
                    const finalMsg: ChatMessage = { role: "assistant", content: finalContent, ts: new Date().toISOString() };
                    if (silentToolCalls.length > 0) finalMsg._toolCalls = silentToolCalls;
                    setChatMessages(prev => [...prev, finalMsg]);
                  }

                  // error
                  if (data.error) {
                    const errMsg: ChatMessage = { role: "assistant", content: `❌ Error: ${data.error}`, ts: new Date().toISOString() };
                    if (silentToolCalls.length > 0) errMsg._toolCalls = silentToolCalls;
                    setChatMessages(prev => [...prev, errMsg]);
                  }
                } catch {}
              }
            }
          }
        }

        // Stream ended without final content — generate summary from tool calls
        if (!finalContent) {
          if (silentToolCalls.length > 0) {
            // Tool calls were made but no final answer — summarize what was done
            const toolSummary = silentToolCalls.map(tc => {
              if (tc.result) return `🔧 ${tc.name}: ${tc.result.slice(0, 150)}`;
              return `🔧 ${tc.name}: ${typeof tc.args === "string" ? tc.args.slice(0, 100) : "..."}`;
            }).join("\n");
            const finalMsg: ChatMessage = { role: "assistant", content: `已執行以下操作：\n${toolSummary}`, ts: new Date().toISOString() };
            finalMsg._toolCalls = silentToolCalls;
            setChatMessages(prev => [...prev, finalMsg]);
          } else {
            setChatMessages(prev => [...prev, { role: "assistant" as const, content: "(Agent completed with no output)", ts: new Date().toISOString() }]);
          }
        }
      } catch (err: any) {
        setChatMessages(prev => [...prev, { role: "assistant" as const, content: `❌ Error: ${err.message}`, ts: new Date().toISOString() }]);
      }
      setChatLoading(false); setAgentAction("");
      if (isAgentMode) setAgentRunning(false);
    }
  }, [chatInput, chatLoading, chatMode, activeTab, rootPath, logEvent]);

  // Only auto-scroll when NEW messages arrive (not on tab switch or re-render)
  useEffect(() => {
    if (chatMessages.length > prevChatLenRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevChatLenRef.current = chatMessages.length;
  }, [chatMessages]);

  // Alias for inline usage in AI crew tab
  const sendChatMessage = useCallback((msg: string) => {
    setChatInput(msg);
    // Use micro-task to ensure state is set before sendChat reads it
    setTimeout(() => sendChat(), 0);
  }, [sendChat]);

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendChat();
    }
  }, [sendChat]);

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
      // Auto-load diff if not available
      let currentDiff = gitDiff;
      if (!currentDiff) {
        const diffRes = await fetch(`${API_BASE}/api/vibe-git/diff?path=${encodeURIComponent(rootPath)}`);
        const diffData = await diffRes.json();
        currentDiff = diffData.diff || "";
        setGitDiff(currentDiff);
      }
      const res = await fetch(`${API_BASE}/api/vibe-git/ai-comment?path=${encodeURIComponent(rootPath)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff: currentDiff, commits: gitLog.slice(0, 5), context: activeTab ? `Current file: ${activeTab.path}` : "" }),
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

  // Auto-refresh git when panel opens or when switching to git tab
  useEffect(() => {
    if (showGitPanel) { refreshGitStatus(); refreshGitLog(); loadGitDiff(); }
  }, [showGitPanel]);

  useEffect(() => {
    if (activeMainTab?.type === "git" && rootPath) { refreshGitStatus(); refreshGitLog(); loadGitDiff(); }
  }, [activeMainTab?.type, rootPath]);

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
    {/* EM Orchestration Floating Panel */}
    {(emRunning || emLog.length > 0) && (
      <div className="fixed bottom-4 right-4 w-96 max-h-80 bg-white border border-amber-300 rounded-lg shadow-xl z-50 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-200">
          <span className="text-sm font-semibold text-amber-800">🎖️ EM 自動調度</span>
          <button onClick={() => { if (!emRunning) { setEmLog([]); } }} className="text-xs text-stone-400 hover:text-stone-600">{emRunning ? "執行中..." : "關閉 ✕"}</button>
        </div>
        <div className="overflow-y-auto max-h-64 p-3 space-y-1">
          {emLog.map((line, i) => (
            <div key={i} className="text-xs text-stone-700 leading-relaxed">{line}</div>
          ))}
          {emRunning && <div className="text-xs text-amber-600 animate-pulse">⏳ 執行中...</div>}
        </div>
      </div>
    )}

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

    <div className="h-full flex flex-col w-full overflow-hidden" style={{ backgroundColor: "#fff" }}>
      {/* ── Top Bar ── */}
      <div className="flex items-center h-9 px-2 border-b shrink-0 select-none" style={{ backgroundColor: tk.toolbarBg, borderColor: tk.toolbarBorder }}>
        {/* ── Left-side toolbar: all features with icon + name ── */}
        {/* ⚡ Project */}
        <div className="relative">
          <button onClick={() => setShowProjectMenu(!showProjectMenu)}
            className="toolbar-dropdown-trigger flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors" style={{ color: tk.toolbarText }} onMouseEnter={e => e.currentTarget.style.backgroundColor = tk.toolbarHover} onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
            <span className="text-xs">⚡</span> {tt("vibe.projectMenu", "Project")}
            <span className="text-[10px]" style={{ color: tk.toolbarTextMuted }}>▼</span>
          </button>
          {showProjectMenu && (
            <div className="toolbar-dropdown-panel absolute top-full left-0 mt-1 w-56 bg-white border border-stone-200 rounded-lg shadow-2xl z-50 py-1" onClick={e => e.stopPropagation()}>
              <button onClick={() => { setShowProjectMenu(false); setNewProjectParent(rootPath ? rootPath.split("/").slice(0, -1).join("/") || rootPath : ""); setNewProjectName(""); setNewProjectError(""); setShowNewProject(true); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 text-stone-700 flex items-center gap-2">
                <span>➕</span> {tt("vibe.newProject", "New Project")}
              </button>
              <button onClick={() => { setShowProjectMenu(false); setShowDirExplorer(true); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-stone-700 flex items-center gap-2">
                <span>📂</span> {tt("vibe.importProject", "Import Project")}
              </button>
              {rootPath && (
                <button onClick={() => { setShowProjectMenu(false); closeProject(); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2">
                  <span>✕</span> {tt("vibe.closeProject")}
                </button>
              )}
              {recentProjects.length > 0 && (
                <>
                  <div className="border-t border-stone-100 my-1" />
                  <div className="px-3 py-1 text-xs font-semibold text-stone-400">{tt("vibe.recentProjects", "Recent Projects")}</div>
                  {recentProjects.slice(0, 8).map(rp => (
                    <button key={rp.path} onClick={() => { setShowProjectMenu(false); setRootPath(rp.path); setExpandedDirs(new Set()); setDirContents({}); dirContentsRef.current = {}; expandDir(rp.path); }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2 truncate">
                      <span className="shrink-0">{rp.hasPaaw ? "🤖" : "📁"}</span> <span className="truncate">{rp.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* 🤖 AI dropdown (AI Crew menu) */}
        <div className="relative ml-1">
          <button onClick={() => setShowCrewMenu(!showCrewMenu)}
            className={cn("toolbar-dropdown-trigger flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
            style={{ backgroundColor: (activeCrew || aiInitializing) ? tk.accent + "33" : "transparent", color: (activeCrew || aiInitializing) ? tk.accent : tk.toolbarText }}
            onMouseEnter={e => { if (!activeCrew && !aiInitializing) e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
            onMouseLeave={e => { if (!activeCrew && !aiInitializing) e.currentTarget.style.backgroundColor = activeCrew ? tk.accent + "33" : "transparent"; }}>
            <span className="text-xs">🤖</span> AI
            <span className="text-[10px]" style={{ color: tk.toolbarTextMuted }}>▼</span>
          </button>
          {showCrewMenu && (
            <div className="toolbar-dropdown-panel absolute top-full left-0 mt-1 w-56 bg-white border border-stone-200 rounded-lg shadow-2xl z-50 py-1" onClick={e => e.stopPropagation()}>
              <div className="px-3 py-1 text-xs font-semibold text-stone-400">{tt("vibe.crewSelect", "選擇 AI 人員")}</div>
              {codingCrews.map(crew => (
                <div key={crew.id} className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center gap-2 truncate">
                  <button onClick={() => {
                    setShowCrewMenu(false);
                    setActiveCrew(crew.id);
                    setChatMode(crew.mode);
                    openMainTab({ id: `crew:${crew.id}`, type: "ai-crew", label: crew.title, icon: crew.emoji || "🤖", closable: true, crewId: crew.id });
                    fetch(`${API_BASE}/api/coding-crew/${crew.id}`).then(r => r.json()).then(data => {
                      setCrewProfile(prev => ({ ...prev, [crew.id]: data }));
                      if (!crewConversations[crew.id] || crewConversations[crew.id].length === 0) {
                        const greeting = data?.chatConfig?.greeting || `嗨！我是${data?.codename || crew.title}，有什麼我可以幫忙的嗎？`;
                        setCrewConversations(prev => ({ ...prev, [crew.id]: [{ role: "assistant", content: greeting, _greeting: true }] }));
                      }
                    }).catch(() => {});
                  }}
                    className={cn("flex-1 text-left flex items-center gap-2 truncate",
                      activeCrew === crew.id && "text-emerald-700 font-semibold")}>
                    <span>{crew.emoji}</span> <span>{crew.title}</span>
                    {activeCrew === crew.id && <span className="ml-auto text-emerald-500">●</span>}
                  </button>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    setShowCrewMenu(false);
                    setAgentContextLoading(true);
                    setAgentContextData(null);
                    try {
                      const res = await fetch(`${API_BASE}/a2a/${crew.agentId}/system-prompt${rootPath ? `?cwd=${encodeURIComponent(rootPath)}` : ""}`);
                      const data = await res.json();
                      setAgentContextData(data);
                    } catch (err: any) {
                      setAgentContextData({ agentId: crew.agentId, agentName: crew.title, baseSystemPrompt: `Error: ${err.message}`, dynamicContext: [], totalLength: 0 });
                    }
                    setAgentContextLoading(false);
                  }} title="查看 System Context" className="shrink-0 text-stone-400 hover:text-blue-600 hover:bg-blue-50 px-1 py-0.5 rounded text-xs">
                    🔍
                  </button>
                </div>
              ))}

              {/* Divider + EM Trigger */}
              <div className="border-t border-stone-200 my-1"></div>
              <button
                onClick={async () => {
                  setShowCrewMenu(false);
                  if (emRunning) return;
                  setEmRunning(true);
                  setEmLog([]);
                  try {
                    const res = await fetch(`${API_BASE}/api/coding-crew/em-run`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ cwd: rootPath || undefined }),
                    });
                    const reader = res.body?.getReader();
                    const decoder = new TextDecoder();
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
                            const d = JSON.parse(line.slice(6));
                            if (d.message) setEmLog(prev => [...prev, d.message]);
                          } catch {}
                        }
                      }
                    }
                  } catch (err: any) {
                    setEmLog(prev => [...prev, `❌ EM error: ${err.message}`]);
                  }
                  setEmRunning(false);
                }}
                disabled={emRunning || !rootPath}
                className={cn("w-full text-left px-3 py-2 text-sm hover:bg-amber-50 flex items-center gap-2 text-amber-700 font-semibold",
                  (emRunning || !rootPath) && "opacity-50 cursor-not-allowed")}
              >
                <span>🚀</span>
                <span>{emRunning ? "EM 執行中..." : "EM 自動調度"}</span>
              </button>
            </div>
          )}
        </div>

        {/* 搜尋 dropdown — 移除重複 🔍 icon，只保留名稱 */}
        <div className="relative ml-1">
          <button onClick={() => setShowSearchMenu(!showSearchMenu)}
            className="toolbar-dropdown-trigger flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors" style={{ color: tk.toolbarText }} onMouseEnter={e => e.currentTarget.style.backgroundColor = tk.toolbarHover} onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
            {tt("vibe.search", "搜尋")}
            <span className="text-[10px]" style={{ color: tk.toolbarTextMuted }}>▼</span>
          </button>
          {showSearchMenu && (
            <div className="toolbar-dropdown-panel absolute top-full left-0 mt-1 w-56 bg-white border border-stone-200 rounded-lg shadow-2xl z-50 py-1" onClick={e => e.stopPropagation()}>
              <button onClick={() => { setShowSearchMenu(false); setShowQuickOpen(true); setQuickOpenQuery(""); setQuickOpenResults([]); setQuickOpenIndex(0); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-stone-700 flex items-center gap-2">
                <span>📄</span> Quick Open <span className="ml-auto text-[10px] text-stone-400">⌘P</span>
              </button>
              <button onClick={() => { setShowSearchMenu(false); setShowSearch(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-stone-700 flex items-center gap-2">
                <span>📋</span> Find & Replace <span className="ml-auto text-[10px] text-stone-400">⇧⌘F</span>
              </button>
            </div>
          )}
        </div>

        {/* 👁️ Browser dropdown — multi-instance */}
        <div className="relative ml-1">
          <button onClick={() => setShowBrowserMenu(!showBrowserMenu)}
            className="toolbar-dropdown-trigger flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors"
            style={{ backgroundColor: mainTabs.some(t => t.type === "browser") ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.type === "browser") ? tk.toolbarText : tk.toolbarTextMuted }}
            onMouseEnter={e => { if (!mainTabs.some(t => t.type === "browser")) e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = mainTabs.some(t => t.type === "browser") ? tk.toolbarActive : "transparent"; }}>
            👁️ Browser <span className="text-[10px]" style={{ color: tk.toolbarTextMuted }}>▼</span>
          </button>
          {showBrowserMenu && (
            <div className="toolbar-dropdown-panel absolute top-full left-0 mt-1 w-56 bg-white border border-stone-200 rounded-lg shadow-2xl z-50 py-1" onClick={e => e.stopPropagation()}>
              <button onClick={() => { setShowBrowserMenu(false); openNewBrowser(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-stone-700 flex items-center gap-2">
                <span>➕</span> New Browser
              </button>
              {mainTabs.filter(t => t.type === "browser").length > 0 && (
                <>
                  <div className="border-t border-stone-100 my-1" />
                  <div className="px-3 py-1 text-xs font-semibold text-stone-400">Open Browsers</div>
                  {mainTabs.filter(t => t.type === "browser").map(tab => (
                    <button key={tab.id} onClick={() => { setShowBrowserMenu(false); setActiveMainTabId(tab.id); }}
                      className={cn("w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 truncate",
                        activeMainTabId === tab.id && "bg-blue-50 text-blue-700 font-semibold")}>
                      <span>{tab.icon}</span> <span>{tab.label}</span>
                      {activeMainTabId === tab.id && <span className="ml-auto text-blue-500">●</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* ⌨️ Terminal dropdown — multi-instance */}
        <div className="relative ml-1">
          <button onClick={() => { if (rootPath) setShowTerminalMenu(!showTerminalMenu); }}
            disabled={!rootPath}
            className={cn("toolbar-dropdown-trigger flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors",
              !rootPath && "opacity-20 cursor-not-allowed")}
            style={{ backgroundColor: mainTabs.some(t => t.type === "terminal") ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.type === "terminal") ? tk.toolbarText : tk.toolbarTextMuted }}
            onMouseEnter={e => { if (rootPath && !mainTabs.some(t => t.type === "terminal")) e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = mainTabs.some(t => t.type === "terminal") ? tk.toolbarActive : "transparent"; }}>
            ⌨️ Terminal <span className="text-[10px]" style={{ color: tk.toolbarTextMuted }}>▼</span>
          </button>
          {showTerminalMenu && rootPath && (
            <div className="toolbar-dropdown-panel absolute top-full left-0 mt-1 w-56 bg-white border border-stone-200 rounded-lg shadow-2xl z-50 py-1" onClick={e => e.stopPropagation()}>
              <button onClick={() => { setShowTerminalMenu(false); openNewTerminal(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-stone-700 flex items-center gap-2">
                <span>➕</span> New Terminal
              </button>
              {mainTabs.filter(t => t.type === "terminal").length > 0 && (
                <>
                  <div className="border-t border-stone-100 my-1" />
                  <div className="px-3 py-1 text-xs font-semibold text-stone-400">Open Terminals</div>
                  {mainTabs.filter(t => t.type === "terminal").map(tab => (
                    <button key={tab.id} onClick={() => { setShowTerminalMenu(false); setActiveMainTabId(tab.id); }}
                      className={cn("w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 truncate",
                        activeMainTabId === tab.id && "bg-blue-50 text-blue-700 font-semibold")}>
                      <span>{tab.icon}</span> <span>{tab.label}</span>
                      {activeMainTabId === tab.id && <span className="ml-auto text-blue-500">●</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Non-dropdown tool buttons */}
        <button onClick={() => openMainTab({ id: "tool:git", type: "git", label: "GIT", icon: "🔀", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:git" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:git") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:git") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:git" ? tk.toolbarActive : "transparent"; }}
          title={tt("vibe.git")}>🔀 GIT</button>
        <button onClick={() => openMainTab({ id: "tool:api", type: "api", label: "API Tester", icon: "🌐", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:api" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:api") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:api") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:api" ? tk.toolbarActive : "transparent"; }}
          title={tt("vibe.api")}>🌐 API</button>
        <button onClick={() => openMainTab({ id: "tool:issues", type: "issues", label: "Issues", icon: "📋", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:issues" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:issues") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:issues") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:issues" ? tk.toolbarActive : "transparent"; }}
          title={tt("issue.title")}>📋 Issues</button>
        <button onClick={() => openMainTab({ id: "tool:memory", type: "memory", label: "Memory", icon: "🧠", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:memory" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:memory") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:memory") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:memory" ? tk.toolbarActive : "transparent"; }}
          title={tt("memory.title")}>🧠 Memory</button>
        <button onClick={() => openMainTab({ id: "tool:features", type: "features", label: "Features", icon: "🗺️", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:features" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:features") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:features") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:features" ? tk.toolbarActive : "transparent"; }}
          title={tt("feature.title")}>🗺️ Features</button>
          <button onClick={() => openMainTab({ id: "tool:nightshift", type: "nightshift", label: "Night Shift", icon: "🌙", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:nightshift" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:nightshift") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:nightshift") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:nightshift" ? tk.toolbarActive : "transparent"; }}
          title={tt("nightShift.title")}>🌙 Night Shift</button>
        <button onClick={() => openMainTab({ id: "tool:security", type: "security", label: "Security", icon: "🔒", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:security" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:security") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:security") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:security" ? tk.toolbarActive : "transparent"; }}
          title="Security Scan">🔒 Security</button>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex min-h-0">
        {/* ── File Explorer ── */}
        <div className="flex flex-col shrink-0 select-none" style={{ width: sidebarWidth, backgroundColor: "#fff" }}>
          <div className="px-2 py-0" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
            {/* Git branch indicator */}
            {gitStatus?.branch && (
              <div className="flex items-center gap-1 py-1">
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
          {/* ── .paaw/ Project Knowledge removed (agents maintain via API) ── */}
        </div>

        {/* Sidebar resize */}
        <div className="w-px cursor-col-resize hover:w-0.5 hover:bg-blue-400 active:bg-blue-500 transition-all shrink-0"
          onMouseDown={e => startResize("sidebar", e)} style={{ backgroundColor: tk.borderLight }} />

        {/* ── Center: Unified Tab System ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab Bar — all tabs (files + tools + AI crew) */}
          <div className="flex items-end shrink-0 overflow-x-auto" style={{ backgroundColor: tk.bgMuted, borderBottom: `1px solid ${tk.borderLight}` }}>
            {mainTabs.map(tab => {
              const isEditorFile = tab.type === "editor";
              const fileTab = isEditorFile ? openTabs.find(ot => ot.id === tab.filePath) : null;
              const isActive = activeMainTabId === tab.id;
              return (
                <div key={tab.id}
                  className={cn("group flex items-center gap-1 px-3 py-1 cursor-pointer select-none text-xs shrink-0 transition-colors",
                    isActive ? "bg-white text-stone-800" : "text-stone-400 hover:bg-stone-100")}
                  style={isActive ? { borderTop: `2px solid ${tk.accent}` } : { borderTop: "2px solid transparent" }}
                  onClick={() => { setActiveMainTabId(tab.id); if (isEditorFile && fileTab) setActiveTabId(fileTab.id); }}>
                  <span className="text-sm shrink-0">{tab.icon}</span>
                  <span className="truncate max-w-[120px]">{tab.label}</span>
                  {isEditorFile && fileTab?.modified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                  {tab.closable && (
                    <button onClick={e => { e.stopPropagation(); closeMainTab(tab.id); }}
                      className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 text-xs ml-1">✕</button>
                  )}
                </div>
              );
            })}
            {/* Show hint only when dashboard is the sole tab */}
            {mainTabs.length === 1 && mainTabs[0].id === DASHBOARD_TAB_ID && <div className="px-4 py-1.5 text-xs text-stone-300">{tt("vibe.noFilesOpen")}</div>}
          </div>
          {/* ── Content Area ── */}
          <div className="flex-1 flex min-h-0 overflow-hidden relative">

            {/* === EDITOR === */}
            {activeMainTab?.type === "editor" && activeTab && (
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

            {/* === FILE VIEWER (Markdown / JSON rendered) === */}
            {activeMainTab?.type === "viewer" && activeMainTab.filePath && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <FileViewer filePath={activeMainTab.filePath} projectRoot={rootPath} active={true} />
              </div>
            )}

            {/* === GIT PANEL (Diff / Blame / Status / Review) === */}
            {activeMainTab?.type === "git" && (
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
                {gitTab === "status" && (
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {/* Branch + Action Buttons */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-xs font-bold text-stone-500">🌿 {gitStatus?.branch || "..."}</div>
                      <span className="flex-1" />
                      <button onClick={async () => {
                        setGitActionMsg("Pulling...");
                        try {
                          const r = await fetch(`${API_BASE}/api/vibe-git/pull?path=${encodeURIComponent(rootPath!)}`, { method: "POST" });
                          const d = await r.json();
                          setGitActionMsg(d.ok ? `✅ ${d.output || d.message}` : `❌ ${d.error}`);
                          refreshGitStatus(); refreshGitLog();
                        } catch (e: any) { setGitActionMsg(`❌ ${e.message}`); }
                      }} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">⬇ Pull</button>
                      <button onClick={async () => {
                        if (!gitStatus?.staged?.length && !gitStatus?.unstaged?.length && !gitStatus?.untracked?.length) {
                          setGitActionMsg("Nothing to commit"); return;
                        }
                        // Stage all
                        const files = gitStatus.all?.map(f => f.path) || ["."];
                        setGitActionMsg("Staging...");
                        const addRes = await fetch(`${API_BASE}/api/vibe-git/add?path=${encodeURIComponent(rootPath!)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
                        const addData = await addRes.json();
                        if (!addData.ok) { setGitActionMsg(`❌ Stage failed: ${addData.error}`); return; }
                        if (!gitCommitMsg.trim()) { setGitActionMsg("⚠️ Enter commit message first"); refreshGitStatus(); return; }
                        setGitActionMsg("Committing...");
                        const commitRes = await fetch(`${API_BASE}/api/vibe-git/commit?path=${encodeURIComponent(rootPath!)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: gitCommitMsg.trim() }) });
                        const commitData = await commitRes.json();
                        if (!commitData.ok) { setGitActionMsg(`❌ Commit failed: ${commitData.error}`); refreshGitStatus(); return; }
                        setGitActionMsg(`✅ ${commitData.output || commitData.message}`);
                        setGitCommitMsg("");
                        refreshGitStatus(); refreshGitLog();
                      }} className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors">✅ Commit All</button>
                      <button onClick={async () => {
                        setGitActionMsg("Pushing...");
                        try {
                          const r = await fetch(`${API_BASE}/api/vibe-git/push?path=${encodeURIComponent(rootPath!)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
                          const d = await r.json();
                          setGitActionMsg(d.ok ? `✅ ${d.output || d.message}` : `❌ ${d.error}`);
                          refreshGitStatus(); refreshGitLog();
                        } catch (e: any) { setGitActionMsg(`❌ ${e.message}`); }
                      }} className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors">⬆ Push</button>
                    </div>
                    {/* Commit message input */}
                    <div className="flex items-center gap-2">
                      <input
                        value={gitCommitMsg}
                        onChange={e => setGitCommitMsg(e.target.value)}
                        placeholder="Commit message..."
                        className="flex-1 text-xs px-2 py-1.5 rounded border border-stone-200 focus:border-stone-400 focus:outline-none bg-white text-stone-700"
                        onKeyDown={e => { if (e.key === "Enter" && gitCommitMsg.trim()) { (e.target as HTMLElement).parentElement?.querySelector?.('[data-commit-btn]')?.dispatchEvent(new MouseEvent('click')); } }}
                      />
                    </div>
                    {/* Action feedback */}
                    {gitActionMsg && (
                      <div className={`text-xs px-2 py-1.5 rounded ${gitActionMsg.startsWith("✅") ? "bg-emerald-50 text-emerald-700" : gitActionMsg.startsWith("❌") ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                        {gitActionMsg}
                        <button onClick={() => setGitActionMsg(null)} className="ml-2 text-stone-400 hover:text-stone-600">✕</button>
                      </div>
                    )}
                    {gitStatus ? (<>
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
                    </>) : (
                      <div className="flex-1 flex items-center justify-center text-xs text-stone-400">Loading...</div>
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
                      <button onClick={generateAiComment} disabled={aiCommentLoading}
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
            {activeMainTab?.type === "api" && (
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
                            } else { alert("尚未產出 API Test Payload。先點 🧠 Code Understanding"); }
                          } else { alert("尚未產出 API Test Payload。先點 🧠 Code Understanding"); }
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
                    {/* Project APIs with payload examples */}
                    {projectApiExamples.length > 0 && projectApiExamples.slice(0, 20).map((ex, i) => (
                      <button key={`ex-${i}`} onClick={() => {
                        const base = rootPath ? `http://localhost:${new URL(API_BASE).port}` : API_BASE;
                        let url = `${base}${ex.endpoint}`;
                        // Replace path params like {id} with example values
                        if (ex.request?.params) {
                          for (const [k, v] of Object.entries(ex.request.params)) {
                            url = url.replace(`{${k}}`, String(v));
                          }
                        }
                        setApiUrl(url);
                        setApiMethod(ex.method || "GET");
                        setApiStreamMode(false);
                        if (ex.request?.headers) {
                          setApiHeaders(Object.entries(ex.request.headers).map(([key, value]) => ({ key, value: String(value), enabled: true })));
                        }
                        if (ex.request?.body) {
                          setApiBody(JSON.stringify(ex.request.body, null, 2));
                        }
                      }}
                        className="text-xs px-2 py-0.5 rounded-full border border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                        title={`${ex.description}\n${JSON.stringify(ex.request?.body || {}, null, 2).slice(0, 200)}`}>
                        {ex.method} {ex.endpoint.length > 22 ? `…${ex.endpoint.slice(-19)}` : ex.endpoint}
                      </button>
                    ))}
                    {/* Fallback: project API routes (no examples) */}
                    {projectApiExamples.length === 0 && projectApis.length > 0 && projectApis.slice(0, 15).map((api, i) => (
                      <button key={`proj-${i}`} onClick={() => {
                        const base = rootPath ? `http://localhost:${new URL(API_BASE).port}` : API_BASE;
                        setApiUrl(`${base}${api.path}`);
                        setApiMethod(api.method || "GET");
                        setApiStreamMode(false);
                      }}
                        className="text-xs px-2 py-0.5 rounded-full border border-blue-200 text-blue-600 hover:bg-blue-50"
                        title={api.file || api.path}>
                        {api.method} {api.path.length > 25 ? `…${api.path.slice(-22)}` : api.path}
                      </button>
                    ))}
                    {/* Generic test endpoints */}
                    {projectApiExamples.length === 0 && projectApis.length === 0 && (
                      <span className="text-xs text-stone-400 italic">No project APIs found — run CU init first</span>
                    )}
                    <div className="w-px h-4 bg-stone-200 mx-1" />
                    {[
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
            {activeMainTab?.type === "browser" && (
              <div key={activeMainTab.id} className="flex-1 flex flex-col min-w-0">
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

            {/* === AI CREW / EMPLOYEE CHAT TAB === */}
            {activeMainTab?.type === "ai-crew" && activeCrew && (() => {
              const crew = codingCrews.find(c => c.id === activeCrew);
              const profile = crewProfile[activeCrew] as any;
              const rolePrompt = profile?.rolePrompt || "";
              const roleSummary = rolePrompt.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('你是') && l.length > 5) || rolePrompt.slice(0, 80);
              const hasProject = !!rootPath;
              return (
              <div key={activeCrew} className="flex-1 flex flex-col min-w-0 bg-white">
                {/* Profile header */}
                <div className="shrink-0 px-4 py-3 relative" style={{ borderBottom: `1px solid ${tk.borderLight}`, background: `linear-gradient(135deg, ${tk.accent}11 0%, ${tk.accentBg} 100%)` }}>
                  <div className="flex items-center gap-3">
                    {profile?.imageUrl ? (
                      <img src={`${API_BASE}${profile.imageUrl}`} className="w-10 h-10 rounded-full object-cover" style={{ border: `2px solid ${tk.accent}44` }} />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl" style={{ backgroundColor: tk.accent + "22", border: `2px solid ${tk.accent}44` }}>
                        {crew?.emoji || "🤖"}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-stone-800">{profile?.codename || crew?.title || "AI"}</span>
                        {profile?.chatConfig?.model && <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{profile.chatConfig.model}</span>}
                        {hasProject && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">📁 有專案</span>}
                      </div>
                      <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">{profile?.description || roleSummary}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Conversation count badge */}
                      {chatMessages.length > 0 && !viewingArchive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500">{chatMessages.length} 則</span>
                      )}
                      {viewingArchive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">📂 歷史</span>
                      )}
                      {/* History button */}
                      <button
                        onClick={() => {
                          if (!showArchivePanel && activeCrew && rootPath) loadArchivedConversations(activeCrew, rootPath);
                          setShowArchivePanel(!showArchivePanel);
                        }}
                        className="text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100 transition-colors"
                        title="歷史對話"
                      >
                        📋
                      </button>
                      {/* Context debug button */}
                      <button
                        onClick={async () => {
                          if (!activeCrew) return;
                          const agentId = activeCrew.replace(/^coding\./, "");
                          try {
                            const res = await fetch(`${API_BASE}/a2a/${encodeURIComponent(agentId)}/system-prompt${rootPath ? `?cwd=${encodeURIComponent(rootPath)}` : ""}`);
                            const data = await res.json();
                            setContextDebug(data);
                            setShowContextDebug(true);
                          } catch (e: any) {
                            setContextDebug({ error: e.message });
                            setShowContextDebug(true);
                          }
                        }}
                        className="text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100 transition-colors"
                        title="查看注入的 Context & Prompts"
                      >
                        🔍
                      </button>
                      {/* New conversation button */}
                      <button
                        onClick={startNewConversation}
                        disabled={chatMessages.length === 0}
                        className="text-xs px-2 py-1 rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30 transition-colors"
                        title="開新對話"
                      >
                        ✨
                      </button>
                      <ModelSelector feature="codingIDE" value={codingModel} onChange={setCodingModel} />
                    </div>
                  </div>
                </div>

                {/* Session panel — rendered inline below header */}
                {showArchivePanel && activeCrew && (
                  <div className="bg-white border-b shadow-sm" style={{ borderColor: tk.borderLight, maxHeight: "200px", overflowY: "auto" }}>
                    <div className="flex items-center justify-between px-4 py-2 border-b sticky top-0 bg-white z-10" style={{ borderColor: tk.borderLight }}>
                      <span className="text-sm font-semibold text-stone-700">📜 對話 Sessions</span>
                      <button onClick={() => setShowArchivePanel(false)} className="text-stone-400 hover:text-stone-600 text-sm">✕</button>
                    </div>
                    {(archivedConversations[activeCrew] || []).length === 0 ? (
                      <div className="px-4 py-4 text-center text-sm text-stone-400">尚無對話記錄</div>
                    ) : (
                        (archivedConversations[activeCrew] || []).map((sess: any) => (
                          <button
                            key={sess.sessionId}
                            onClick={() => !sess.isActive && loadArchivedConversation(sess.sessionId)}
                            className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b transition-colors"
                            style={{ borderColor: tk.borderLight, opacity: sess.isActive ? 0.7 : 1 }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-stone-700 truncate">
                                {sess.isActive && <span className="text-green-500 mr-1">●</span>}
                                {sess.title || "對話"}
                              </span>
                              <span className="text-[10px] text-stone-400 shrink-0 ml-2">{sess.messageCount} 則</span>
                            </div>
                            <div className="text-[10px] text-stone-400 mt-0.5">
                              {sess.lastUpdated ? new Date(sess.lastUpdated).toLocaleString("zh-TW", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                            </div>
                          </button>
                        ))
                      )}
                  </div>
                )}

                {/* Chat messages */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "thin" }}>
                  {chatMessages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                      {profile?.imageUrl ? (
                        <img src={`${API_BASE}${profile.imageUrl}`} className="w-16 h-16 rounded-full object-cover" style={{ border: `2px solid ${tk.accent}33` }} />
                      ) : (
                        <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl" style={{ backgroundColor: tk.accent + "15" }}>
                          {crew?.emoji || "🤖"}
                        </div>
                      )}
                      <div className="text-center">
                        <p className="text-sm font-semibold text-stone-700">{profile?.codename || crew?.title} 已就緒</p>
                        <p className="text-xs text-stone-400 mt-1 max-w-xs">
                          {profile?.chatConfig?.greeting ? profile.chatConfig.greeting.split('\n')[0] :
                           chatMode === "agent" ? "Agent 模式：可直接執行指令、讀寫檔案" :
                           chatMode === "chat" ? "Chat 模式：純對話討論" :
                           `${chatMode.toUpperCase()} 模式`}
                        </p>
                      </div>
                      {/* Quick actions */}
                      <div className="flex flex-wrap gap-1.5 mt-2 justify-center max-w-md">
                        {chatMode === "agent" && [
                          { label: "分析架構", prompt: "請分析這個專案的架構，指出優點和可改進之處" },
                          { label: "Code Review", prompt: "請 review 最近的程式碼變更" },
                          { label: "重構建議", prompt: "請找出需要重構的程式碼並給建議" },
                        ].map(a => (
                          <button key={a.label} onClick={() => { setChatInput(a.prompt); }}
                            className="text-[10px] px-2.5 py-1 rounded-full border border-stone-200 text-stone-500 hover:bg-stone-50 hover:border-stone-300 transition-colors">
                            {a.label}
                          </button>
                        ))}
                        {chatMode === "chat" && [
                          { label: "技術諮詢", prompt: "我有個技術問題想請教" },
                          { label: "架構討論", prompt: "我想討論一下系統架構的方向" },
                        ].map(a => (
                          <button key={a.label} onClick={() => { setChatInput(a.prompt); }}
                            className="text-[10px] px-2.5 py-1 rounded-full border border-stone-200 text-stone-500 hover:bg-stone-50 hover:border-stone-300 transition-colors">
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <ChatMessages
                    messages={chatMessages}
                    accent={tk.accent}
                    accentHover={tk.accentHover || tk.accent}
                    assistantName={profile?.codename || crew?.title || "AI"}
                    userName="你"
                    assistantAvatar={profile?.imageUrl ? `${API_BASE}${profile.imageUrl}` : undefined}
                    assistantEmoji={crew?.emoji || "🤖"}
                    loading={chatLoading}
                    agentAction={agentAction}
                    activeTools={agentToolLog.map(t => ({ name: t.name, status: t.result !== "..." ? "done" as const : "running" as const }))}
                    endRef={chatEndRef}
                  />
                </div>

                {/* Agent tool log */}
                {agentRunning && agentToolLog.length > 0 && (
                  <div className="shrink-0 max-h-32 overflow-y-auto border-t px-3 py-2 space-y-1" style={{ borderColor: tk.borderLight, scrollbarWidth: "thin" }}>
                    <div className="text-xs font-semibold text-stone-400 mb-1">⚡ Tool Calls</div>
                    {agentToolLog.slice(-8).map((t, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px]">
                        <span className={t.result !== "..." ? "text-green-500" : "text-blue-400 animate-pulse"}>
                          {t.result !== "..." ? "✓" : "⏳"}
                        </span>
                        <span className="font-mono text-stone-600">{t.name}</span>
                        <span className="text-stone-400 truncate max-w-[200px]">{t.args}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Chat input */}
                <div className="shrink-0 px-4 py-2.5" style={{ borderTop: `1px solid ${tk.borderLight}`, backgroundColor: tk.bgMuted }}>
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={chatInputRef}
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={handleChatKeyDown}
                      placeholder={`問 ${crew?.title}...`}
                      className="flex-1 text-sm px-3 py-2 rounded-lg resize-none outline-none border focus:border-blue-400"
                      style={{ borderColor: tk.borderInput, backgroundColor: "white" }}
                      rows={2}
                    />
                    <button
                      onClick={() => { if (!chatInput.trim()) return; sendChat(); }}
                      disabled={chatLoading || !chatInput.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40 transition-colors"
                      style={{ backgroundColor: tk.accent }}>
                      ↵
                    </button>
                  </div>
                </div>
              </div>
              );
            })()}

            {/* === EM DASHBOARD (Landing Page) === */}
            {/* Always mounted, hidden with CSS to preserve chat state across tab switches */}
            <div
              className={activeMainTab?.type === "em-dashboard" ? "contents" : ""}
              style={activeMainTab?.type !== "em-dashboard" ? { display: "none" } : undefined}
            >
              <EMDashboard
                rootPath={rootPath}
                theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, accent: tk.accent, accentBg: tk.accentBg, text: tk.text }}
                onOpenFile={openFile}
                onStartCodeUnderstanding={startAiInitialize}
                codeUnderstanding={{ running: aiInitializing, steps: aiInitSteps }}
                model={codingModel}
                onModelChange={setCodingModel}
                onDispatchToCrew={(crewId, message) => {
                  // Switch to the crew tab and pre-fill the chat input
                  const crew = codingCrews.find(c => c.id === crewId);
                  if (crew) {
                    setActiveCrew(crew.id);
                    setChatMode(crew.mode);
                    openMainTab({ id: `crew:${crew.id}`, type: "ai-crew", label: crew.title, icon: crew.emoji || "🤖", closable: true, crewId: crew.id });
                    // Fetch crew profile if not already loaded
                    if (!crewProfile[crew.id]) {
                      fetch(`${API_BASE}/api/coding-crew/${crew.id}`).then(r => r.json()).then(data => {
                        setCrewProfile(prev => ({ ...prev, [crew.id]: data }));
                      });
                    }
                    // Pre-fill the message
                    setChatInput(message);
                    setTimeout(() => chatInputRef.current?.focus(), 300);
                  }
                }}
                onOpenReportTab={(reportId) => {
                  // Open the appropriate report tab based on reportId
                  const reportTabMap: Record<string, { type: string; label: string; icon: string }> = {
                    "security": { type: "security", label: "Security Report", icon: "🔒" },
                    "code-intelligence": { type: "features", label: "Code Intelligence", icon: "🗺️" },
                    "test-intelligence": { type: "features", label: "Test Intelligence", icon: "🧪" },
                    "change-intelligence": { type: "features", label: "Change Intelligence", icon: "🔄" },
                    "em-report": { type: "em-dashboard", label: "EM Dashboard", icon: "🎖️" },
                  };
                  const tabInfo = reportTabMap[reportId] || reportTabMap["em-report"];
                  openMainTab({ id: `report:${reportId}`, type: tabInfo.type as any, label: tabInfo.label, icon: tabInfo.icon, closable: true });
                }}
              />
            </div>

            {/* === TERMINAL TAB === */}
            {/* Terminal: always mount, hide with CSS to preserve WebSocket + PTY session */}
            <div
              className="flex-1 flex flex-col min-w-0"
              style={{ display: activeMainTab?.type === "terminal" ? undefined : "none" }}
            >
              <div className="flex-1 min-h-0 bg-[#1e1717]">
                {rootPath && <ShellTerminal cwd={rootPath} />}
              </div>
            </div>

            {/* === ISSUES TAB === */}
            {/* === Issues Tab === (keep mounted, hide with CSS) */}
            {mainTabs.some(t => t.type === "issues") && rootPath && (
              <div key="tool:issues" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "issues" ? undefined : "none" }}>
                <IssueTracker
                  rootPath={rootPath}
                  theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, accent: tk.accent, accentBg: tk.accentBg, text: tk.text }}
                  onOpenFile={openFile}
                />
              </div>
            )}

            {/* === MEMORY TAB === (keep mounted, hide with CSS) */}
            {mainTabs.some(t => t.type === "memory") && rootPath && (
              <div key="tool:memory" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "memory" ? undefined : "none" }}>
                <AgentMemoryPanel
                  rootPath={rootPath}
                  theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, accent: tk.accent, accentBg: tk.accentBg, text: tk.text }}
                />
              </div>
            )}

            {/* === FEATURES TAB === (keep mounted, hide with CSS) */}
            {mainTabs.some(t => t.type === "features") && rootPath && (
              <div key="tool:features" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "features" ? undefined : "none" }}>
                <FeatureMap
                  rootPath={rootPath}
                  theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, accent: tk.accent, accentBg: tk.accentBg, text: tk.text }}
                  onOpenFile={openFile}
                />
              </div>
            )}

            {/* === Night Shift === (keep mounted, hide with CSS) */}
            {mainTabs.some(t => t.type === "nightshift") && (
              <div key="tool:nightshift" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "nightshift" ? undefined : "none" }}>
                <NightShiftPanel
                  theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, accent: tk.accent, accentBg: tk.accentBg, text: tk.text }}
                  rootPath={rootPath}
                />
              </div>
            )}

            {/* === Security Tab === (keep mounted, hide with CSS) */}
            {mainTabs.some(t => t.type === "security") && rootPath && (
              <div key="tool:security" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "security" ? undefined : "none" }}>
                <SecurityTab
                  rootPath={rootPath}
                  theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, accent: tk.accent, accentBg: tk.accentBg, text: tk.text }}
                  onOpenFile={openFile}
                />
              </div>
            )}

            {/* === No tab selected === */}
            {!activeMainTab && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8">
                <div className="text-5xl">⚡</div>
                <h2 className="text-lg font-bold text-stone-600">{tt("vibe.welcome")}</h2>
                <p className="text-stone-400 text-sm text-center max-w-md leading-relaxed">
                  {tt("vibe.welcomeLine1")}<br />
                  {tt("vibe.welcomeLine2")}<br />
                  {tt("vibe.welcomeLine3")}
                </p>
              </div>
            )}

          </div>

          {/* Terminal — moved to main tab, bottom panel removed */}
        </div>
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

      {/* ── Context Debug Modal (🔍 button in chat header) ── */}
      {showContextDebug && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={() => { setShowContextDebug(false); setContextDebug(null); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-[700px] max-w-[90vw] max-h-[80vh] bg-[#1a1a2e] rounded-xl shadow-2xl border border-stone-700 flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-700">
              <h3 className="text-sm font-bold text-stone-100 flex items-center gap-2">
                🔍 Context & Prompts
              </h3>
              <div className="flex items-center gap-3">
                {contextDebug?.totalLength != null && (
                  <span className="text-xs text-stone-400">
                    Total: {contextDebug.totalLength.toLocaleString()} chars
                  </span>
                )}
                <button onClick={() => { setShowContextDebug(false); setContextDebug(null); }} className="text-stone-400 hover:text-white text-lg">✕</button>
              </div>
            </div>
            {contextDebug?.error ? (
              <div className="flex-1 flex items-center justify-center text-red-400 text-sm p-6">Error: {contextDebug.error}</div>
            ) : contextDebug ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: "thin" }}>
                {/* Agent Info */}
                {contextDebug.agentId && (
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">🤖 {contextDebug.agentName || contextDebug.agentId}</span>
                    {contextDebug.contextProviders?.length > 0 && (
                      <span className="text-[10px] text-stone-500">providers: {contextDebug.contextProviders.join(", ")}</span>
                    )}
                  </div>
                )}
                {/* Base System Prompt */}
                {contextDebug.baseSystemPrompt && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">📋 Base System Prompt</span>
                      <span className="text-[10px] text-stone-500">{(contextDebug.baseSystemPrompt.length || 0).toLocaleString()} chars</span>
                    </div>
                    <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: "300px", overflowY: "auto" }}>
                      {contextDebug.baseSystemPrompt}
                    </pre>
                  </div>
                )}
                {/* System Prompt Preview (compact) */}
                {contextDebug.systemPromptPreview && !contextDebug.baseSystemPrompt && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">📋 System Prompt Preview</span>
                      <span className="text-[10px] text-stone-500">{contextDebug.systemPromptLength?.toLocaleString()} chars total</span>
                    </div>
                    <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: "300px", overflowY: "auto" }}>
                      {contextDebug.systemPromptPreview}
                    </pre>
                  </div>
                )}
                {/* Dynamic Context Sections */}
                {contextDebug.dynamicContext?.map((ctx: { source: string; content: string }, i: number) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">⚡ {ctx.source}</span>
                      <span className="text-[10px] text-stone-500">{ctx.content.length.toLocaleString()} chars</span>
                    </div>
                    <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: "200px", overflowY: "auto" }}>
                      {ctx.content}
                    </pre>
                  </div>
                ))}
                {(!contextDebug.dynamicContext || contextDebug.dynamicContext.length === 0) && !contextDebug.baseSystemPrompt && !contextDebug.systemPromptPreview && (
                  <div className="text-xs text-stone-500">No context data available.</div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">No data</div>
            )}
          </div>
        </div>
      )}

      {/* ── Agent System Context Modal ── */}
      {(agentContextData || agentContextLoading) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={() => { setAgentContextData(null); setAgentContextLoading(false); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-[700px] max-w-[90vw] max-h-[80vh] bg-[#1a1a2e] rounded-xl shadow-2xl border border-stone-700 flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-700">
              <h3 className="text-sm font-bold text-stone-100 flex items-center gap-2">
                🔍 System Context: {agentContextLoading ? "Loading..." : agentContextData?.agentName || agentContextData?.agentId}
              </h3>
              <div className="flex items-center gap-3">
                {agentContextData && (
                  <span className="text-xs text-stone-400">
                    Total: {(agentContextData.totalLength || 0).toLocaleString()} chars
                  </span>
                )}
                <button onClick={() => { setAgentContextData(null); setAgentContextLoading(false); }} className="text-stone-400 hover:text-white text-lg">✕</button>
              </div>
            </div>
            {agentContextLoading ? (
              <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">Loading context...</div>
            ) : agentContextData ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: "thin" }}>
                {/* Base System Prompt */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">📋 Base System Prompt</span>
                    <span className="text-[10px] text-stone-500">{(agentContextData.baseSystemPrompt?.length || 0).toLocaleString()} chars</span>
                  </div>
                  <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: "300px", overflowY: "auto" }}>
                    {agentContextData.baseSystemPrompt || "(empty)"}
                  </pre>
                </div>
                {/* Dynamic Context Sections */}
                {agentContextData.dynamicContext?.map((ctx, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">⚡ {ctx.source}</span>
                      <span className="text-[10px] text-stone-500">{ctx.content.length.toLocaleString()} chars</span>
                    </div>
                    <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: "200px", overflowY: "auto" }}>
                      {ctx.content}
                    </pre>
                  </div>
                ))}
                {(!agentContextData.dynamicContext || agentContextData.dynamicContext.length === 0) && (
                  <div className="text-xs text-stone-500">No dynamic context injected.</div>
                )}
              </div>
            ) : null}
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
