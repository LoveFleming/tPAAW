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
import JsonViewer from "../components/JsonViewer";
import { fileEmoji } from "../components/FileEmoji";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";

import API_BASE from "../api";
import DirectoryExplorer from "../components/DirectoryExplorer";
import SidebarFileTree from "../components/SidebarFileTree";
import CodeIntelPage from "../components/CodeIntelPage";
import TestsPage from "../components/TestsPage";
import EMDashboard from "../components/EMDashboard";
import { GitPanel } from "../components/git";
import { BrowserPanel } from "../components/browser/BrowserPanel";
import DiffViewer from "../components/DiffViewer";
import StandardsEditor from "../components/StandardsEditor";
import SessionHistory from "../components/SessionHistory";

import DecisionLog from "../components/DecisionLog";
import ModelSelector from "../components/ModelSelector";
import { ChatMessages, type ChatMessageItem } from "../components/ChatMessages";
import IssueTracker from "../components/IssueTracker";
import TaskBoard from "../components/TaskBoard";
import ReleaseManagerPanel from "../components/ReleaseManagerPanel";
import HandoverPanel from "../components/HandoverPanel";
import TroubleshootingPanel from "../components/TroubleshootingPanel";
import TabErrorBoundary from "../components/TabErrorBoundary";
import FeatureMap from "../components/FeatureMap";
import { SubTaskDetail } from "../components/AutoDispatchPanel";
import ApiMapSidebar from "../components/ApiMapSidebar";
import AgentSideChat, { type AgentSideChatHandle } from "../components/AgentSideChat";
import CrewManager from "../components/CrewManager";
// ReportsTab removed — merged into AutoDispatchPanel
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
type MainTabType = "editor" | "viewer" | "git" | "api" | "browser" | "terminal" | "ai-crew" | "standards" | "sessions" | "decisions" | "em-dashboard" | "prompts" | "issues" | "tasks" | "features" | "security" | "crew-manager" | "subtask-detail" | "release-manager" | "handover" | "troubleshooting" | "code-intel" | "tests";

interface MainTab {
  id: string;
  type: MainTabType;
  label: string;
  icon: string;
  closable: boolean;
  crewId?: string;
  filePath?: string;
  data?: any;
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

// Chat scroll cache — crewId → scrollTop（FileViewer scroll cache 同款）
// 切換 agent tab 時 remount（key={activeCrew}）會丟失捲動位置，用 cache 還原
const _chatScrollCache = new Map<string, number>();
// 效能：空陣列模組級身分（inline [] 每鍵新建 → agentToolLog 身分變 → 打爆 ChatMessages memo）
const EMPTY_TOOL_LOG: Array<{ name: string; args: string; result: string }> = [];
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

// ── API Tester response body：JSON 自動 pretty / 樹狀檢視，非 JSON 原樣顯示 ──
function ApiResponseBody({ body }: { body: string }) {
  const { t: tt } = useI18n();
  const [view, setView] = useState<"tree" | "raw">("tree");
  const [copied, setCopied] = useState(false);
  let parsed: unknown = null;
  try { parsed = JSON.parse(body); } catch { /* not JSON */ }
  const isJson = parsed !== null && typeof parsed === "object"; // object/array 才進樹狀；純量/文字用 pretty raw
  const pretty = tryFormatJson(body);
  const copy = () => {
    navigator.clipboard.writeText(pretty).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const btn = "text-xs px-2 py-1 rounded-md border transition-colors";
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      {/* Toolbar: Tree/Raw 切換 + 複製 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isJson && (
          <>
            <button onClick={() => setView("tree")} className={cn(btn, view === "tree" ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50")}>🌳 {tt("vibe.apiViewTree")}</button>
            <button onClick={() => setView("raw")} className={cn(btn, view === "raw" ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50")}>📄 {tt("vibe.apiViewRaw")}</button>
          </>
        )}
        <button onClick={copy} className={cn(btn, "ml-auto bg-white text-stone-600 border-stone-300 hover:bg-stone-50")}>{copied ? "✅" : "📋"} {tt("vibe.apiCopy")}</button>
      </div>
      {isJson && view === "tree" ? (
        <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-stone-300 bg-white">
          <JsonViewer data={parsed} compact />
        </div>
      ) : (
        <pre className="flex-1 text-sm font-mono bg-stone-800 text-green-300 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words min-h-0">
          {pretty}
        </pre>
      )}
    </div>
  );
}

// Safety: ensure value is a renderable string (not object/array/null)
function safeStr(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") { try { return JSON.stringify(v, null, 2); } catch { return "{}"; } }
  return String(v);
}

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
// ── Editor Tab Content (extracted so each tab can have its own useMemo/hljs) ──
function EditorTabContent({ tabId, filePath, tabData, isActive, isEditing, textareaRef, lineNumWidth, handleContentChange, stopEditing, handleCodeViewClick, startEditing, tk, tt, openFile }: {
  tabId: string;
  filePath: string;
  tabData: OpenTab | undefined;
  isActive: boolean;
  isEditing: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  lineNumWidth: number;
  handleContentChange: (v: string) => void;
  stopEditing: () => void;
  handleCodeViewClick: (e: React.MouseEvent) => void;
  startEditing: () => void;
  tk: any;
  tt: (k: string) => string;
  openFile: (path: string) => void;
}) {
  const tabHighlighted = useMemo(() => {
    if (!tabData?.content) return "";
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const langMap: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", json: "json", md: "markdown", py: "python", go: "go", rs: "rust", java: "java", yaml: "yaml", yml: "yaml", xml: "xml", html: "xml", css: "css", scss: "scss", sh: "bash", sql: "sql" };
    const lang = langMap[ext];
    try {
      return lang ? hljs.highlight(tabData.content, { language: lang, ignoreIllegals: true }).value : hljs.highlightAuto(tabData.content).value;
    } catch { return escapeHtml(tabData.content); }
  }, [tabData?.content, filePath]);

  const tabLineCount = tabData?.content?.split("\n").length ?? 0;

  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden"
      style={{ visibility: isActive ? "visible" : "hidden", zIndex: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}
    >
      {tabData ? (
        isEditing ? (
          <div className="flex h-full w-full">
            <div className="shrink-0 select-none overflow-hidden" style={{ color: tk.textMuted, backgroundColor: tk.bgMuted, borderRight: `1px solid ${tk.borderLight}`, width: lineNumWidth }}>
              <div className="py-3">
                {Array.from({ length: tabLineCount }, (_, i) => (
                  <div key={i} className="pr-3 text-sm font-mono leading-5" style={{ height: 20 }}>{i + 1}</div>
                ))}
              </div>
            </div>
            <textarea ref={isActive ? textareaRef : undefined} value={tabData.content} onChange={e => handleContentChange(e.target.value)}
              onBlur={stopEditing}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); stopEditing(); } }}
              className="flex-1 min-w-0 p-3 text-[13px] font-mono leading-5 resize-none outline-none bg-white"
              style={{ tabSize: 2, whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto" }} spellCheck={false} />
          </div>
        ) : (
          <div className="h-full w-full overflow-auto cursor-text" onClick={handleCodeViewClick} onDoubleClick={startEditing}>
            <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: lineNumWidth }} />
                <col />
              </colgroup>
              <tbody className="font-mono text-[13px]" style={{ tabSize: 2 }}>
                {tabHighlighted.split("\n").map((htmlLine: string, i: number) => (
                  <tr key={i}>
                    <td
                      className="text-right pr-3 select-none border-r sticky left-0 z-10"
                      style={{ backgroundColor: tk.bgMuted, borderColor: tk.borderLight, color: tk.textMuted, lineHeight: "20px", height: "20px", whiteSpace: "nowrap", verticalAlign: "top", fontSize: "12px" }}
                    >
                      {i + 1}
                    </td>
                    <td className="pl-4" style={{ lineHeight: "20px", height: "20px", whiteSpace: "pre", verticalAlign: "top" }}
                      dangerouslySetInnerHTML={{ __html: htmlLine || "&nbsp;" }} />
                  </tr>
                ))}
              </tbody>
            </table>
            {isActive && (
              <div className="absolute bottom-3 right-3 text-xs text-stone-300 bg-white/80 px-2 py-1 rounded border" style={{ borderColor: tk.borderInput }}>
                {tt("vibe.clickToEdit")} · Cmd+S {tt("vibe.save")} · {tt("vibe.autoSave")}
              </div>
            )}
          </div>
        )
      ) : (
        <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">
          <button onClick={() => openFile(filePath)}
            className="px-3 py-1.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-600 text-sm">重新載入檔案</button>
        </div>
      )}
    </div>
  );
}

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
  // Sidebar 視圖：檔案樹 vs Release Unit 樹（2026-08-22，North Star：RU 是導航第一原則）
  const [fileTreeHidden, setFileTreeHidden] = useState(false);
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

  // ── Archive panel state (must be before useEffect that references them) ──
  const [showArchivePanel, setShowArchivePanel] = useState(false);
  const [viewingArchive, setViewingArchive] = useState<string | null>(null);

  // Sync activeCrew when switching tabs (crew tabs have crewId)
  useEffect(() => {
    if (activeMainTab?.type === "ai-crew" && activeMainTab.crewId) {
      setActiveCrew(activeMainTab.crewId);
      // Only fetch profile if not already cached — avoids re-fetch on every tab switch
      if (!crewProfile[activeMainTab.crewId]) {
        fetch(`${API_BASE}/api/coding-crew/${activeMainTab.crewId}`).then(r => (r.ok ? r.json() : null)).then(data => {
          if (data) setCrewProfile(prev => ({ ...prev, [activeMainTab.crewId!]: data }));
        }).catch(() => {});
      }
      // Refresh archived conversations only when archive panel is open
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

    // ── Sync: also remove matching openTabs entry when closing a file tab ──
    // This is the core fix — closing a main tab must also clean up openTabs,
    // otherwise stale editor state persists and causes blank content / wrong activeTab.
    const closingTab = (mainTabsRef.current || []).find(t => t.id === id);
    if (closingTab?.filePath) {
      setOpenTabs(prev => prev.filter(ot => ot.path !== closingTab.filePath));
      // If the closed tab was active, move activeTabId to remaining
      if (activeTabId === closingTab.filePath) {
        const remaining = (openTabsRef.current || []).filter(ot => ot.path !== closingTab.filePath);
        setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
    }

    setMainTabs(prev => {
      const remaining = prev.filter(t => t.id !== id);
      return remaining;
    });
    // Use functional update to avoid stale activeMainTabId closure
    setActiveMainTabId(prev => {
      if (prev !== id) return prev; // not closing the active tab, keep it
      const remaining = mainTabsRef.current.filter(t => t.id !== id);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : DASHBOARD_TAB_ID;
    });
  }, [mainTabs, activeTabId]);

  const openNewTerminal = useCallback(() => {
    if (!rootPath) return;
    // VSCode-style numbering: reuse lowest available number
    const existingNumbers = mainTabs
      .filter(t => t.type === "terminal")
      .map(t => {
        const m = t.label.match(/^Terminal\s+(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter(n => n > 0);
    let num = 1;
    while (existingNumbers.includes(num)) num++;
    const tabId = `tool:terminal#${num}-${Date.now()}`;
    openMainTab({ id: tabId, type: "terminal", label: `Terminal ${num}`, icon: "\u2328\uFE0F", closable: true });
  }, [openMainTab, rootPath, mainTabs]);

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
  // 聊天捲動容器：跟底用容器自身 scrollTo（scrollIntoView 會連帶捲動祖先容器 → 頁面跳動）
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatNearBottomRef = useRef(true);
  const [crewLoading, setCrewLoading] = useState<Record<string, boolean>>({}); // crewId → chatLoading
  const domainAbortRef = useRef<AbortController | null>(null); // abort for domain AI (spec/test/bug/docs/maintain)
  const [crewAgentRunning, setCrewAgentRunning] = useState<Record<string, boolean>>({}); // crewId → agentRunning
  const [crewAgentAction, setCrewAgentAction] = useState<Record<string, string>>({}); // crewId → agentAction
  const [crewAgentToolLog, setCrewAgentToolLog] = useState<Record<string, Array<{name: string; args: string; result: string}>>>({}); // crewId → toolLog
  const chatLoading = activeCrew ? !!crewLoading[activeCrew] : false;
  const agentRunning = activeCrew ? !!crewAgentRunning[activeCrew] : false;
  const agentAction = activeCrew ? (crewAgentAction[activeCrew] || "") : "";
  const agentToolLog = activeCrew ? (crewAgentToolLog[activeCrew] || EMPTY_TOOL_LOG) : EMPTY_TOOL_LOG;
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
  const composingRef = useRef(false); // IME composition guard
  const prevChatLenRef = useRef(0);
  const loadingFileRef = useRef(false);
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs; // keep in sync
  const mainTabsRef = useRef(mainTabs);
  mainTabsRef.current = mainTabs; // keep in sync
  const tabBarRef = useRef<HTMLDivElement>(null);
  // Crew profile data
  const [crewProfile, setCrewProfile] = useState<Record<string, any>>({});
  const [loadedCrews, setLoadedCrews] = useState<Set<string>>(new Set()); // track which crew conversations have been loaded from server
  const [archivedConversations, setArchivedConversations] = useState<Record<string, any[]>>({}); // crewId → list of archives
  // (showArchivePanel & viewingArchive moved above — before the useEffect that references them)
  const [showContextDebug, setShowContextDebug] = useState(false);
  const [contextDebug, setContextDebug] = useState<any>(null);

  // ── Right Panel Tab State ──
  const [rightTab, setRightTab] = useState<"chat" | "standards" | "sessions" | "decisions" | "prompts" | "status">("chat");


  // ── Recent Projects State ──
  const [recentProjects, setRecentProjects] = useState<{ path: string; name: string; hasPaaw: boolean }[]>([]);
  const [showRecentProjects, setShowRecentProjects] = useState(false);

  // ── New Project State ──
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectStep, setNewProjectStep] = useState(1); // 1=template, 2=config, 3=creating
  const [newProjectTemplate, setNewProjectTemplate] = useState("react-vite");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [newProjectParent, setNewProjectParent] = useState("");
  const [newProjectCreating, setNewProjectCreating] = useState(false);
  const [newProjectError, setNewProjectError] = useState("");

  // ── Project Menu State ──
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showSearchMenu, setShowSearchMenu] = useState(false);
  const [showCrewMenu, setShowCrewMenu] = useState(false);
  const [showTerminalMenu, setShowTerminalMenu] = useState(false);
  // ── Agent System Context Viewer ──
  const [agentContextData, setAgentContextData] = useState<{ agentId: string; agentName: string; baseSystemPrompt: string; dynamicContext: { source: string; content: string }[]; totalLength: number } | null>(null);
  const [agentContextLoading, setAgentContextLoading] = useState(false);

  // ── Click-outside: close all toolbar dropdowns ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If click is outside any toolbar dropdown trigger AND outside dropdown panels, close all menus
      if (!target.closest(".toolbar-dropdown-trigger") && !target.closest(".toolbar-dropdown-panel")) {
        setShowProjectMenu(false);
        setShowSearchMenu(false);
        setShowCrewMenu(false);
        setShowTerminalMenu(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // ── Coding Crew Definitions (dynamic from project crew API) ──
  const [codingCrews, setCodingCrews] = useState<Array<{ id: string; emoji: string; title: string; mode: "chat"; agentId: string; imageUrl?: string }>>([
    { id: "coding.architect", emoji: "🏛️", title: "架構師", mode: "chat" as const, agentId: "architect" },
    { id: "coding.developer", emoji: "💻", title: "Developer", mode: "chat" as const, agentId: "developer" },
    { id: "coding.tester", emoji: "🧪", title: "Tester", mode: "chat" as const, agentId: "tester" },
    { id: "coding.doc-writer", emoji: "📝", title: "Doc Writer", mode: "chat" as const, agentId: "doc-writer" },
    // Helpdesk hidden from sidebar
    { id: "coding.qa", emoji: "🔬", title: "QA", mode: "chat" as const, agentId: "qa" },
    { id: "coding.ops", emoji: "🔧", title: "Ops 維運", mode: "chat" as const, agentId: "ops" },
    { id: "coding.handover", emoji: "🤝", title: "Handover 交接", mode: "chat" as const, agentId: "handover" },
    { id: "coding.rm", emoji: "🚦", title: "Release Manager", mode: "chat" as const, agentId: "rm" },
  ]);
  // 效能：badge 衍生陣列 useMemo（inline .map 每鍵新建身分 → 打爆 ChatMessages 的 MessageRow memo）
  const agentToolBadges = useMemo(() => agentToolLog.map(t => ({ name: t.name, status: t.result !== "..." ? "done" as const : "running" as const })), [agentToolLog]);
  const assignableChatAgents = useMemo(() => codingCrews
    .filter(c => c.id !== activeCrew)
    .map(c => ({ id: c.id, emoji: c.emoji, title: c.title })), [codingCrews, activeCrew]);

  // Refresh coding crew from API when rootPath changes
  const refreshCodingCrew = useCallback(async () => {
    if (!rootPath) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/crew?path=${encodeURIComponent(rootPath)}`);
      const data = await res.json();
      if (data.agents && Array.isArray(data.agents)) {
        const crews = data.agents
          .filter((a: any) => a.id !== "coding.em")
          .map((a: any) => ({
            id: a.id,
            emoji: a.emoji || "🤖",
            title: `${a.codename || a.title || a.id}`,
            mode: "chat" as const,
            agentId: a.id.replace(/^(coding\.|custom\.)/, ""),
            imageUrl: a.imageUrl || undefined,
          }));
        setCodingCrews(crews);
      }
    } catch {}
  }, [rootPath]);

  useEffect(() => { refreshCodingCrew(); }, [refreshCodingCrew]);

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
    setSidebarTab("ru");
    setOpenTabs([]);
    setActiveTabId(null);
    setMainTabs([DASHBOARD_TAB]);
    setActiveMainTabId(DASHBOARD_TAB_ID);
    tabsRestoredRef.current = null;
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

  // emModelRef moved after emModel declaration (line ~1306) to avoid TDZ

  const startAiInitialize = useCallback(async (forceRerun = false) => {
    if (!rootPath || aiInitializing) return;
    setAiInitializing(true);
    const currentModel = emModelRef.current || emModel;
    const steps = [
      { id: "scan", name: "🔍 掃描專案結構" },
      { id: "feature-map", name: "🗺️ Feature Map" },
      { id: "code-intelligence", name: "🧠 Code Intelligence" },
      { id: "test-intelligence", name: "🧪 Test Intelligence" },
    ];
    setAiInitSteps(steps.map(s => ({ ...s, status: "pending" as const })));

    try {
      const res = await fetch(`${API_BASE}/api/coding-project/ai-initial?path=${encodeURIComponent(rootPath)}${forceRerun ? "&force=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: currentModel || undefined }) });
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
                  // 首次掃描完成 → 自動開 Features tab；重新掃描 → 不跳走（2026-08-19 fix）
                  if (!(mainTabsRef.current || []).some(t => t.id === "tool:features")) {
                    openMainTab({ id: "tool:features", type: "features", label: "Features", icon: "🗺️", closable: true });
                  }
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

  const [gitTab, setGitTab] = useState<"status" | "log" | "diff" | "blame" | "review">("status");
  const [gitCommitMsg, setGitCommitMsg] = useState("");
  const [gitActionMsg, setGitActionMsg] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [aiCommitLoading, setAiCommitLoading] = useState(false);
  const [gitReviews, setGitReviews] = useState<{ id: string; ts: string; comment: string; branch?: string; files?: string[] }[]>([]);

  // ── Staged Changes Summary (from agents) ──
  interface StagedChangeSummary {
    exists: boolean;
    agent?: string;
    codename?: string;
    task?: string;
    taskId?: string;
    summary?: string;
    files?: { path: string; reason: string }[];
    howToTest?: string;
    risk?: string;
    createdAt?: string;
  }
  const [stagedSummary, setStagedSummary] = useState<StagedChangeSummary | null>(null);
  const [projectLoopMode, setProjectLoopMode] = useState<"mini" | "full">("mini");
  const [activeCodingTaskId, setActiveCodingTaskId] = useState<string | null>(null);
  const [activeTaskPipeline, setActiveTaskPipeline] = useState<Record<string, any> | null>(null);
  const [showStagedDetail, setShowStagedDetail] = useState(false);

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
  const [apiGroupCollapsed, setApiGroupCollapsed] = useState<Record<string, boolean>>({});
  const apiStreamAbortRef = useRef<AbortController | null>(null);
  const a2aAbortRef = useRef<AbortController | null>(null); // for interrupting A2A agent streams

  // ── Coding Behavior Tracking ──
  const codingLogRef = useRef<CodingEvent[]>([]);
  const distillTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showDirExplorer, setShowDirExplorer] = useState(false);

  // ── Derived: sync activeTab with activeMainTab ──
  // activeTabId is the sidebar tab; but the MAIN panel is driven by activeMainTab.
  // When activeMainTab is an editor, resolve the matching OpenTab from its filePath.
  // This ensures editor content always matches the selected main tab,
  // even if activeTabId lags behind (close-then-reopen race).
  const activeTab = useMemo(() => {
    if (activeMainTab?.type === "editor" && activeMainTab.filePath) {
      // Prefer the main tab's filePath (single source of truth for what's shown)
      const byFilePath = openTabs.find(ot => ot.path === activeMainTab.filePath);
      if (byFilePath) return byFilePath;
    }
    // Fallback: legacy path via activeTabId (for viewer/side panel scenarios)
    return openTabs.find(ot => ot.id === activeTabId) || null;
  }, [openTabs, activeTabId, activeMainTab]);

  // ═══════════════════════════════════════════════
  // Init: load from server APIs (with localStorage fallback)
  // ═══════════════════════════════════════════════
  useEffect(() => {
    (async () => {
      // Load root path
      const root = localStorage.getItem("paaw.vibeide.rootPath");
      if (root) { setRootPath(root); expandDir(root); registerRu(root); setSidebarTab("files"); }
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

  // Derive loopMode from projectPhase (loaded from auto-dispatch config)
  const PHASE_TO_LOOP_MODE: Record<string, "mini" | "full"> = { bootstrap: "mini", mvp: "mini", growth: "mini", stable: "full", refactor: "full" };
  // Priority: TASKS.json loopMode (manual switch / synced from phase) > phase-derived
  useEffect(() => {
    if (!rootPath) return;
    fetch(`${API_BASE}/api/coding-tasks/project/loop-mode?path=${encodeURIComponent(rootPath)}`)
      .then(r => r.json())
      .then(data => {
        if (data.loopMode === "mini" || data.loopMode === "full") {
          setProjectLoopMode(data.loopMode);
        } else {
          // No explicit loopMode — derive from auto-dispatch projectPhase
          return fetch(`${API_BASE}/api/coding-auto-dispatch/config?path=${encodeURIComponent(rootPath)}`)
            .then(r => r.json())
            .then(cfg => {
              const phase = cfg.projectPhase || "bootstrap";
              setProjectLoopMode(PHASE_TO_LOOP_MODE[phase] || "mini");
            });
        }
      })
      .catch(() => {});
  }, [rootPath]);

  // EM Dashboard loop mode switch — PUT + local update
  const handleLoopModeChange = useCallback((mode: "mini" | "full") => {
    if (!rootPath) return;
    setProjectLoopMode(mode); // optimistic
    fetch(`${API_BASE}/api/coding-tasks/project/loop-mode?path=${encodeURIComponent(rootPath)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loopMode: mode }),
    })
      .then(r => r.json())
      .then(data => { if (!data.ok) setProjectLoopMode(mode === "mini" ? "full" : "mini"); }) // revert on failure
      .catch(() => setProjectLoopMode(mode === "mini" ? "full" : "mini"));
  }, [rootPath]);

  // Load active task pipeline when activeCodingTaskId changes
  useEffect(() => {
    if (!activeCodingTaskId || !rootPath) { setActiveTaskPipeline(null); return; }
    fetch(`${API_BASE}/api/coding-tasks/${encodeURIComponent(activeCodingTaskId)}?path=${encodeURIComponent(rootPath)}`)
      .then(r => r.json())
      .then(data => { if (data.pipeline) setActiveTaskPipeline(data.pipeline); })
      .catch(() => {});
  }, [activeCodingTaskId, rootPath]);

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

  // ── Persist main tabs to localStorage (per project) ──
  // Guard: don't save until restore has completed for this rootPath
  useEffect(() => {
    if (!rootPath) return;
    // Don't save until restore effect has run for this rootPath
    if (tabsRestoredRef.current !== rootPath) return;
    // Only persist closable tabs; skip dashboard
    const tabsToSave = mainTabs.filter(t => t.id !== DASHBOARD_TAB_ID);
    // Don't overwrite saved tabs with just-dashboard state on race condition
    // Only save if there are actual closable tabs OR we intentionally closed all
    if (tabsToSave.length === 0) {
      // Check if we actually had tabs before — if the restore hasn't happened yet, skip
      const existing = localStorage.getItem(`paaw.vibeide.tabs:${rootPath}`);
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          if (parsed.tabs?.length > 0) {
            // There were saved tabs but current state has none — this is the pre-restore state
            // Only allow overwriting if we've been through a user action (close all tabs)
            // We can detect this: tabsRestoredRef was set AND mainTabs only has dashboard
            // This is fine — the user explicitly closed all tabs
          }
        } catch {}
      }
    }
    try {
      localStorage.setItem(`paaw.vibeide.tabs:${rootPath}`, JSON.stringify({ tabs: tabsToSave, activeMainTabId }));
      console.log(`[CodingIDE] Saved ${tabsToSave.length} tabs to localStorage, active=${activeMainTabId}`, tabsToSave.map(t => `${t.type}:${t.id}`).join(", "));
    } catch (e) {
      console.warn(`[CodingIDE] Failed to save tabs:`, e);
    }
  }, [mainTabs, activeMainTabId, rootPath]);

  // ── Restore main tabs when project loads ──
  const tabsRestoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!rootPath || tabsRestoredRef.current === rootPath) return;
    tabsRestoredRef.current = rootPath;
    console.log(`[CodingIDE] Restore effect fired, rootPath=${rootPath}`);
    (async () => {
    try {
      // 🌱 Fresh-import guard：沒有 .paaw 的 project 視為「剛 import」—
      // 不 restore 上次的 tabs（可能全是基於舊 .paaw 的工具頁），清掉 localStorage，
      // 讓使用者從 dashboard 初始狀態（code understanding 引導）開始
      let hasPaaw = true;
      try {
        const ctxRes = await fetch(`${API_BASE}/api/coding-project/context?path=${encodeURIComponent(rootPath)}`);
        hasPaaw = ctxRes.ok; // 404 = 無 .paaw
      } catch { /* 探測失敗 — 保守 restore */ }
      if (!hasPaaw) {
        try { localStorage.removeItem(`paaw.vibeide.tabs:${rootPath}`); } catch {}
        console.log(`[CodingIDE] No .paaw — fresh import state: reset tabs to dashboard (CU bootstrap)`);
        // 回到初始狀態：只留 dashboard（EM / Code Understanding 引導入口），
        // 清掉前一個專案殘留的 tabs 與 editor 檔案
        setMainTabs([DASHBOARD_TAB]);
        setActiveMainTabId(DASHBOARD_TAB_ID);
        setOpenTabs([]);
        setActiveTabId(null);
        return;
      }
      const saved = localStorage.getItem(`paaw.vibeide.tabs:${rootPath}`);
      if (!saved) {
        console.log(`[CodingIDE] No saved tabs found in localStorage`);
      } else {
        console.log(`[CodingIDE] Found saved tabs data (${saved.length} chars)`);
      }
      if (saved) {
        const { tabs: savedTabs, activeMainTabId: savedActive } = JSON.parse(saved);
        console.log(`[CodingIDE] Parsed ${savedTabs?.length || 0} saved tabs, active=${savedActive}`);
        if (Array.isArray(savedTabs) && savedTabs.length > 0) {
          // Filter out tabs with invalid types (e.g. removed "memory" type)
          const VALID_TYPES = new Set(["editor", "viewer", "git", "api", "browser", "terminal", "ai-crew", "standards", "sessions", "decisions", "em-dashboard", "prompts", "issues", "tasks", "features", "security", "crew-manager", "release-manager", "handover", "troubleshooting", "code-intel", "tests"]);
          const validTabs = savedTabs.filter((t: MainTab) => VALID_TYPES.has(t.type));
          console.log(`[CodingIDE] Valid tabs after filter: ${validTabs.length}/${savedTabs.length}`, validTabs.map((t: MainTab) => `${t.type}:${t.id}`).join(", "));
          // Restore tabs (dashboard is already present)
          const existingIds = new Set((mainTabsRef.current || []).map(t => t.id));
          const newTabs = validTabs.filter((t: MainTab) => !existingIds.has(t.id));
          console.log(`[CodingIDE] New tabs to restore: ${newTabs.length} (existing: ${existingIds.size})`);
          if (newTabs.length > 0) {
            setMainTabs(prev => [DASHBOARD_TAB, ...prev.filter(t => t.id !== DASHBOARD_TAB_ID), ...newTabs]);
          }
          // Restore active tab (delay to ensure tabs are rendered)
          const validActive = validTabs.find((t: MainTab) => t.id === savedActive);
          if (validActive && savedActive !== DASHBOARD_TAB_ID) {
            setTimeout(() => setActiveMainTabId(savedActive), 50);
          }
          // Reload editor tab file contents
          validTabs.filter((t: MainTab) => t.type === "editor" && t.filePath).forEach((t: MainTab) => {
            fetch(`${API_BASE}/api/vibe-fs/read?path=${encodeURIComponent(t.filePath!)}`)
              .then(r => r.json())
              .then(data => {
                if (data.content !== undefined) {
                  setOpenTabs(prev => {
                    if (prev.find(ot => ot.path === t.filePath)) return prev;
                    return [...prev, { id: t.filePath!, name: t.filePath!.split(/[\\/]/).pop() || t.filePath!, path: t.filePath!, content: data.content, originalContent: data.content, modified: false, language: getLanguage(t.filePath!), hljsLang: getHljsLang(t.filePath!), lastSaved: data.modified }];
                  });
                }
              }).catch(() => {});
          });

          // Pre-load conversations for restored AI crew tabs
          const crewTabs = validTabs.filter((t: MainTab) => t.type === "ai-crew" && t.crewId);
          for (const tab of crewTabs) {
            try {
              const res = await fetch(`${API_BASE}/api/coding-crew/conversations/${encodeURIComponent(tab.crewId!)}?cwd=${encodeURIComponent(rootPath)}`);
              const data = await res.json();
              if (data.messages && data.messages.length > 0) {
                setCrewConversations(prev => ({ ...prev, [tab.crewId!]: data.messages }));
              }
              setLoadedCrews(prev => new Set(prev).add(tab.crewId!));
            } catch {}
          }
        }
      }
    } catch {}
    })();
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
  // Release Unit Tabs（2026-08-27：RU = 專案目錄；sidebar tab strip）
  // 每個 RU 記住自己的樹展開狀態，切換不重置
  // ═══════════════════════════════════════════════
  const [releaseUnits, setReleaseUnits] = useState<{ id: string; path: string; label: string; exists?: boolean }[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"ru" | "files">("ru");
  const ruTreeCacheRef = useRef<Map<string, { expandedDirs: Set<string>; dirContents: Record<string, FsItem[]> }>>(new Map());

  // 載入 RU registry（GET /api/ru/workspaces）
  useEffect(() => {
    fetch(`${API_BASE}/api/ru/workspaces`)
      .then(r => r.json())
      .then(d => setReleaseUnits(d.units || []))
      .catch(() => {});
  }, []);

  // 註冊 RU（票等，伺服器以 resolved path 去重）
  const registerRu = useCallback((path: string) => {
    fetch(`${API_BASE}/api/ru/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.unit) setReleaseUnits(prev => prev.some(u => u.path === d.unit.path) ? prev : [...prev, d.unit]);
      })
      .catch(() => {});
  }, []);

  // 切換 RU：快取目前樹狀態 → 還原目標樹狀態（沒快體就展開 root）→ 註冊
  const switchRu = useCallback((path: string) => {
    if (rootPath && rootPath !== path) {
      ruTreeCacheRef.current.set(rootPath, { expandedDirs: expandedDirsRef.current, dirContents: dirContentsRef.current });
    }
    const cached = ruTreeCacheRef.current.get(path);
    if (cached) {
      setExpandedDirs(cached.expandedDirs); expandedDirsRef.current = cached.expandedDirs;
      setDirContents(cached.dirContents); dirContentsRef.current = cached.dirContents;
    } else {
      setExpandedDirs(new Set()); expandedDirsRef.current = new Set();
      setDirContents({}); dirContentsRef.current = {};
    }
    loadingDirsRef.current = new Set();
    setRootPath(path);
    setSidebarTab("files");
    expandDir(path);
    registerRu(path);
  }, [rootPath, expandDir, registerRu]);

  // 移除 RU（只移 tab，不碰檔案）
  const removeRu = useCallback((unit: { id: string; path: string; label: string }) => {
    if (!window.confirm(tt("ru.removeConfirm"))) return;
    setReleaseUnits(prev => prev.filter(u => u.id !== unit.id));
    fetch(`${API_BASE}/api/ru/workspaces?id=${unit.id}`, { method: "DELETE" }).catch(() => {});
    if (rootPath === unit.path) { setRootPath(""); setSidebarTab("ru"); }
  }, [rootPath]);

  // ═══════════════════════════════════════════════
  // File Operations
  // ═══════════════════════════════════════════════
  // API Tester 右欄 Developer AI（外部注入訊息用）
  const apiDevChatRef = useRef<AgentSideChatHandle>(null);
  const openFile = useCallback(async (path: string) => {
    if (loadingFileRef.current) return; // prevent double-click race

    // Check both openTabs (editor) and mainTabs (viewer) for existing file
    const existingEditor = (openTabsRef.current || []).find(ot => ot.path === path);
    if (existingEditor) {
      setActiveTabId(existingEditor.id);
      setActiveMainTabId(`file:${path}`);
      return;
    }

    // Viewer files (md/json) are tracked in mainTabs only
    const mainTabId = `file:${path}`;
    const name = path.split(/[\\/]/).pop() || path;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const useViewer = ["md", "markdown"].includes(ext);

    if (useViewer) {
      // openMainTab handles dedup + activate
      openMainTab({ id: mainTabId, type: "viewer", label: name, icon: getFileIcon(name), closable: true, filePath: path });
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
        openMainTab({ id: mainTabId, type: "editor", label: name, icon: getFileIcon(name), closable: true, filePath: path });
        logEvent("open_file", { path, language: tab.language });
      }
    } catch {}
    setLoadingFile(false);
    loadingFileRef.current = false;
  }, [logEvent, openMainTab]);

  const closeTab = useCallback((id: string) => {
    setOpenTabs(prev => prev.filter(ot => ot.id !== id));
    if (activeTabId === id) {
      const remaining = (openTabsRef.current || []).filter(ot => ot.id !== id);
      setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
    closeMainTab(`file:${id}`);
    logEvent("close_file", { path: id });
  }, [activeTabId, logEvent, closeMainTab]);

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
  const handleCodeViewClick = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    // Don't enter edit mode when user was selecting text
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    startEditing();
  }, [startEditing]);

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
  const [emModel, setEmModel] = useState<string>(""); // EM Dashboard has its own model
  const emModelRef = useRef(emModel);
  emModelRef.current = emModel;
  const [adRefreshTrigger, setAdRefreshTrigger] = useState(0);
  const codingModel = activeCrew ? (crewModels[activeCrew] || "") : "";
  const setCodingModel = useCallback((model: string) => {
    if (!activeCrew) return;
    setCrewModels(prev => ({ ...prev, [activeCrew]: model }));
  }, [activeCrew]);

const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;

    // ── No auto-archive on send: user may want to continue a conversation ──
    // Archived conversations are still viewable in sidebar; new session via button only.

    const userMsg: ChatMessage = { role: "user", content: chatInput.trim(), ts: new Date().toISOString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setViewingArchive(null); // exit archive viewing when user sends a message
    logEvent("ai_chat", { prompt: chatInput.trim().slice(0, 200) });

    // ── Domain AI mode (spec, test, bug, docs, maintain) ──
    if (["spec", "test", "bug", "docs", "maintain"].includes(chatMode)) {
      setChatLoading(true);
      const domainAbort = new AbortController();
      domainAbortRef.current = domainAbort;
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
          signal: domainAbort.signal,
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
        if (err.name === "AbortError") {
          setChatMessages(prev => [...prev, { role: "assistant", content: "⏹️ 已中斷", ts: new Date().toISOString() }]);
        } else {
          setChatMessages(prev => [...prev, { role: "assistant", content: `❌ ${chatMode.toUpperCase()} AI error: ${err.message}`, ts: new Date().toISOString() }]);
        }
      }
      setChatLoading(false); setAgentAction("");
      domainAbortRef.current = null;
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
          "coding.em": "em",
          "coding.ops": "ops",
          "coding.handover": "handover",
          "coding.rm": "rm",
        };
        const a2aAgentId = CREW_TO_AGENT[activeCrew || ""] || activeCrew?.replace(/^coding\./, "") || "architect";
        const a2aAbort = new AbortController();
        a2aAbortRef.current = a2aAbort;
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
          signal: a2aAbort.signal,
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
        let currentEvent = ""; // track SSE event type

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("event: ") || line.startsWith("data: ")) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7).trim();
                continue;
              }
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));

                  // thinking events — show thinking indicator (model is reasoning, not executing)
                  if (currentEvent === "thinking" && data.content) {
                    setAgentAction("💭 思考中...");
                  }

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
                      project_info: "📋 專案資訊",
                      project_edit: "✏️ 專案編輯",
                      record_decision: "📝 記錄決策",
                      docs: "📝 文件管理",
                      diff: "🔍 比較差異",
                      ask_user: "❓ 詢問用戶",
                      browser_test: "🌐 瀏覽器測試",
                      browser_navigate: "🌐 開啟網頁",
                      browser_read: "📖 讀取頁面",
                      browser_screenshot: "📸 頁面截圖",
                      browser_click: "🖱️ 點擊",
                      browser_type: "⌨️ 輸入",
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

                  // tool result — track silently + switch back to thinking indicator
                  if (data.name && data.result !== undefined && data.result !== "...") {
                    // Model now thinks about next step after seeing tool result
                    setAgentAction("💭 思考中...");
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

                  // info events — show compaction progress briefly in action indicator
                  if (currentEvent === "info" && data.message) {
                    // Show compaction messages (e.g. "📦 自動壓縮對話...") in action indicator
                    if (data.message.includes("壓縮") || data.message.includes("compact")) {
                      setAgentAction(data.message);
                    }
                  }

                  // interrupted event — agent was stopped by user
                  if (currentEvent === "interrupted" || data.message?.includes?.("interrupted") || data.message?.includes?.("Interrupted")) {
                    const intMsg: ChatMessage = { role: "assistant", content: `⏹️ Agent 已中斷${data.turns ? ` (執行了 ${data.turns} 輪)` : ""}。你可以繼續對話來恢復。`, ts: new Date().toISOString() };
                    if (silentToolCalls.length > 0) intMsg._toolCalls = silentToolCalls;
                    setChatMessages(prev => [...prev, intMsg]);
                    finalContent = "[interrupted]"; // prevent "no output" fallback
                    break; // exit while(reader) loop
                  }

                  // final content — THE ONLY thing that creates a visible message
                  if (data.content && data.done) {
                    finalContent = data.content;
                    setAgentAction("\u200B"); // clear action indicator
                    const finalMsg: ChatMessage = { role: "assistant", content: finalContent, ts: new Date().toISOString() };
                    if (silentToolCalls.length > 0) finalMsg._toolCalls = silentToolCalls;
                    setChatMessages(prev => [...prev, finalMsg]);

                    // ── EM Auto-Dispatch: detect dispatch directives in EM's response ──
                    if (activeCrew === "coding.em" && finalContent) {
                      const dispatchRegex = /📋\s*\*\*派工[：:]\s*(\w+)\*\*[\s\S]*?\*\*任務[：:]\*\*\s*([\s\S]*?)\*\*[\s\S]*?\*\*優先級[：:]\*\*\s*(\w+)/g;
                      let match;
                      while ((match = dispatchRegex.exec(finalContent)) !== null) {
                        const [_, dispatchAgent, dispatchTask, dispatchPriority] = match;
                        const agentNames: Record<string, string> = { architect: "林曉薇", developer: "Priya", tester: "Divya", "doc-writer": "Megan", qa: "武大安", helpdesk: "小春" };
                        const agentEmoji: Record<string, string> = { architect: "🏛️", developer: "💻", tester: "🧪", "doc-writer": "📝", qa: "🔬", helpdesk: "🌸" };
                        const agentName = agentNames[dispatchAgent] || dispatchAgent;
                        // Show dispatch status in chat
                        setChatMessages(prev => [...prev, { role: "assistant", content: `⏳ ${agentEmoji[dispatchAgent] || "🔧"} ${agentName} 執行中...\n**任務：**${dispatchTask.trim().slice(0, 100)}`, ts: new Date().toISOString(), _emDispatch: true } as any]);
                        // Call dispatch API
                        fetch(`${API_BASE}/api/coding-crew/dispatch`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ agentId: dispatchAgent, task: dispatchTask.trim(), cwd: rootPath, priority: dispatchPriority }),
                        }).then(async r => {
                          if (!r.ok) {
                            const errText = await r.text();
                            setChatMessages(prev => [...prev, { role: "assistant", content: `❌ 派工失敗 (${dispatchAgent}): ${errText.slice(0, 200)}`, ts: new Date().toISOString() }]);
                            return;
                          }
                          // Read SSE stream from dispatch
                          const reader = r.body?.getReader();
                          const decoder = new TextDecoder();
                          let dispatchResult = "";
                          let buffer = "";
                          let currentEvent = "";
                          if (!reader) return;
                          while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split("\n");
                            buffer = lines.pop() || "";
                            for (const line of lines) {
                              try {
                                if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
                                if (line.startsWith("data:")) {
                                  const evt = JSON.parse(line.slice(5).trim());
                                  // runAgentLoopStream SSE events
                                  if (currentEvent === "text" && evt.text) dispatchResult += evt.text;
                                  else if (currentEvent === "done") {
                                    setChatMessages(prev => [...prev, { role: "assistant", content: `✅ ${agentEmoji[dispatchAgent] || "🔧"} ${agentName} 完成\n${dispatchResult ? "**結果：**" + dispatchResult.slice(0, 500) : "(無輸出)"}`, ts: new Date().toISOString() }]);
                                  } else if (currentEvent === "error") {
                                    setChatMessages(prev => [...prev, { role: "assistant", content: `❌ ${agentEmoji[dispatchAgent] || "🔧"} ${agentName} 錯誤：${(evt.error || "unknown").slice(0, 200)}`, ts: new Date().toISOString() }]);
                                  }
                                }
                              } catch {} finally { if (!line.startsWith("event:")) currentEvent = ""; }
                            }
                          }
                        }).catch(err => {
                          setChatMessages(prev => [...prev, { role: "assistant", content: `❌ 派工錯誤 (${dispatchAgent}): ${err.message}`, ts: new Date().toISOString() }]);
                        });
                      }
                    }
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
        if (err.name === "AbortError") {
          // User interrupted — already handled via SSE interrupted event
          // If no interrupted event was received, show a message
          if (finalContent !== "[interrupted]") {
            setChatMessages(prev => [...prev, { role: "assistant" as const, content: "⏹️ Agent 已中斷。你可以繼續對話來恢復。", ts: new Date().toISOString() }]);
          }
        } else {
          setChatMessages(prev => [...prev, { role: "assistant" as const, content: `❌ Error: ${err.message}`, ts: new Date().toISOString() }]);
        }
      }
      setChatLoading(false); setAgentAction("");
      if (isAgentMode) setAgentRunning(false);
      a2aAbortRef.current = null;
    }
  }, [chatInput, chatLoading, chatMode, activeTab, rootPath, logEvent, codingModel, activeCrew]);

  // 追蹤使用者是否在底部附近：串流中只在使用者没往上翻時跟底（onScroll 在容器 div 上）

  // 跟底捲動：新訊息 smooth；串流內容成長 instant（smooth 被 chunk 打斷重啟 → 抖動）
  const chatLastLenRef = useRef(0);
  const chatScrollToBottom = useCallback((smooth: boolean) => {
    requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" });
    });
  }, []);
  const prevChatCrewRef = useRef<string | null>(null); // 偵測 agent tab 切換（chatMessages 長度比較跨 crew 無意義）
  useEffect(() => {
    const crewSwitched = prevChatCrewRef.current !== activeCrew;
    prevChatCrewRef.current = activeCrew;
    const isNewMessage = chatMessages.length > prevChatLenRef.current;
    prevChatLenRef.current = chatMessages.length;
    const lastLen = chatMessages.length ? (chatMessages[chatMessages.length - 1].content || "").length : 0;
    const contentGrew = lastLen > chatLastLenRef.current;
    chatLastLenRef.current = lastLen;

    if (crewSwitched) {
      // Agent tab 切換：還原上次的捲動位置，不跳底（FileViewer scroll cache 同款）
      // 沒 cache（首次開啟/新對話）才落在底部
      if (chatMessages.length > 0 && activeCrew) {
        const crewId = activeCrew;
        const saved = _chatScrollCache.get(crewId);
        requestAnimationFrame(() => {
          const el = chatScrollRef.current;
          if (!el || el.scrollHeight <= el.clientHeight) return;
          if (saved != null) {
            el.scrollTop = saved;
            chatNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          } else {
            el.scrollTop = el.scrollHeight;
            chatNearBottomRef.current = true;
          }
        });
      }
      return; // 切換這次不跑跟底邏輯（長度比較跨 crew 本來就無意義）
    }

    if (isNewMessage) {
      chatScrollToBottom(true);
    } else if (contentGrew && chatLoading && chatNearBottomRef.current) {
      // 串流中 chunk 成長：直接釘底，不做動畫
      chatScrollToBottom(false);
    }
  }, [chatMessages, chatLoading, chatScrollToBottom, activeCrew]);

  // Alias for inline usage in AI crew tab
  const sendChatMessage = useCallback((msg: string) => {
    setChatInput(msg);
    // Use micro-task to ensure state is set before sendChat reads it
    setTimeout(() => sendChat(), 0);
  }, [sendChat]);

  // ── Assign message to another agent: switch crew + auto-send ──
  const assignToAgent = useCallback(async (agentId: string, messageContent: string) => {
    const targetCrew = codingCrews.find(c => c.id === agentId);
    if (!targetCrew) return;

    const quotedContent = `> ${messageContent.slice(0, 500)}${messageContent.length > 500 ? "..." : ""}\n\n請幫我處理以上內容。`;
    const userMsg: ChatMessage = { role: "user", content: quotedContent, ts: new Date().toISOString() };

    // 1. Switch crew + tab
    setActiveCrew(targetCrew.id);
    setChatMode(targetCrew.mode);
    openMainTab({ id: `crew:${targetCrew.id}`, type: "ai-crew", label: targetCrew.title, icon: targetCrew.emoji || "🤖", closable: true, crewId: targetCrew.id });

    // 2. Add message to target crew's conversation
    setCrewConversations(prev => ({
      ...prev,
      [targetCrew.id]: [...(prev[targetCrew.id] || []), userMsg],
    }));

    // 3. Send to target agent via A2A
    const CREW_TO_AGENT: Record<string, string> = {
      "coding.architect": "architect",
      "coding.helpdesk": "helpdesk",
      "coding.developer": "developer",
      "coding.tester": "tester",
      "coding.doc-writer": "doc-writer",
      "coding.qa": "qa",
      "coding.em": "em",
      "coding.ops": "ops",
      "coding.handover": "handover",
      "coding.rm": "rm",
    };
    const a2aAgentId = CREW_TO_AGENT[targetCrew.id] || targetCrew.id.replace(/^coding\./, "");
    const modelForCrew = crewModels[targetCrew.id] || "";

    setCrewAgentRunning(prev => ({ ...prev, [targetCrew.id]: true }));
    setCrewAgentAction(prev => ({ ...prev, [targetCrew.id]: "thinking" }));

    try {
      const res = await fetch(`${API_BASE}/a2a/${a2aAgentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: { role: "user", parts: [{ type: "text", text: quotedContent }] },
            context: { cwd: rootPath || undefined },
            metadata: modelForCrew ? { model: modelForCrew } : undefined,
            conversationHistory: (crewConversations[targetCrew.id] || []).map(({ _greeting, ...rest }: any) => rest),
          },
          id: `assign-${Date.now()}`,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        setCrewConversations(prev => ({
          ...prev,
          [targetCrew.id]: [...(prev[targetCrew.id] || []), { role: "assistant", content: `❌ Agent error: ${errText.slice(0, 200)}`, ts: new Date().toISOString() }],
        }));
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let finalContent = "";
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "thinking") {
              setCrewAgentAction(prev => ({ ...prev, [targetCrew.id]: "thinking" }));
            } else if (evt.type === "tool_call") {
              setCrewAgentAction(prev => ({ ...prev, [targetCrew.id]: `tool:${evt.name || "?"}` }));
            } else if (evt.type === "tool_result") {
              setCrewAgentAction(prev => ({ ...prev, [targetCrew.id]: "thinking" }));
            } else if (evt.type === "content" || evt.type === "text") {
              finalContent += evt.text || evt.content || "";
            } else if (evt.type === "done" || evt.type === "complete") {
              finalContent += evt.text || evt.content || evt.result?.content || "";
            }
          } catch {}
        }
      }

      const reply = finalContent.trim() || "(已完成，無輸出)";
      setCrewConversations(prev => ({
        ...prev,
        [targetCrew.id]: [...(prev[targetCrew.id] || []), { role: "assistant", content: reply, ts: new Date().toISOString() }],
      }));
    } catch (err: any) {
      setCrewConversations(prev => ({
        ...prev,
        [targetCrew.id]: [...(prev[targetCrew.id] || []), { role: "assistant", content: `❌ 指派失敗: ${err.message}`, ts: new Date().toISOString() }],
      }));
    } finally {
      setCrewAgentRunning(prev => ({ ...prev, [targetCrew.id]: false }));
      setCrewAgentAction(prev => ({ ...prev, [targetCrew.id]: "" }));
    }
  }, [codingCrews, rootPath, crewConversations, crewModels, openMainTab]);

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return; // IME guard
    if (e.key === "Enter" && !e.shiftKey) {
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

  const loadGitDiff = useCallback(async (file?: string, cached?: boolean, mode?: string) => {
    if (!rootPath) return;
    const params = new URLSearchParams({ path: rootPath });
    if (file) params.set("file", file);
    if (cached) params.set("cached", "true");
    if (mode) params.set("mode", mode);
    try { const res = await fetch(`${API_BASE}/api/vibe-git/diff?${params}`); const data = await res.json(); setGitDiff(data.diff || ""); setGitDiffFile(file || ""); setGitDiffCached(!!cached); } catch {}
  }, [rootPath]);

  const loadBlame = useCallback(async (filePath: string) => {
    if (!rootPath) return;
    try { const res = await fetch(`${API_BASE}/api/vibe-git/blame?path=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(filePath)}`); const data = await res.json(); setBlameData(data.lines || []); setBlameFile(filePath); setGitTab("blame"); setActiveSubPanel("blame"); } catch {}
  }, [rootPath]);

  // ── QA Code Review: send staged diff to QA agent (武大安) ──
  const [qaReviewLoading, setQaReviewLoading] = useState(false);
  const [qaReview, setQaReview] = useState("");
  const [qaVerdict, setQaVerdict] = useState<{ verdict: string; issues: number; critical: number; summary: string; feedback: string } | null>(null);
  // ── Parse QA verdict from review text ──
  function parseQaVerdict(text: string): { verdict: string; issues: number; critical: number; summary: string; feedback: string } | null {
    const match = text.match(/---QA_VERDICT---[\s\S]*?---END_VERDICT---/);
    if (!match) return null;
    const block = match[0];
    const verdict = (block.match(/verdict:\s*(pass|conditional|rework)/)?.[1] || "").toLowerCase();
    const issues = parseInt(block.match(/issues:\s*(\d+)/)?.[1] || "0");
    const critical = parseInt(block.match(/critical:\s*(\d+)/)?.[1] || "0");
    const summary = (block.match(/summary:\s*(.+)/)?.[1] || "").trim();
    const feedback = (block.match(/feedback:\s*([\s\S]*?)(?=---END_VERDICT---|$)/)?.[1] || "").trim();
    if (!verdict) return null;
    return { verdict, issues, critical, summary, feedback };
  }

  const runQaReview = useCallback(async () => {
    if (!rootPath) return;
    setQaReviewLoading(true);
    setQaReview("");
    setGitTab("review");
    try {
      // Get staged diff (fallback to working diff)
      let diffText = gitDiff;
      if (!diffText) {
        const diffRes = await fetch(`${API_BASE}/api/vibe-git/diff?path=${encodeURIComponent(rootPath)}&cached=true`);
        const diffData = await diffRes.json();
        diffText = diffData.diff || "";
      }
      if (!diffText) {
        const diffRes = await fetch(`${API_BASE}/api/vibe-git/diff?path=${encodeURIComponent(rootPath)}`);
        diffText = (await diffRes.json()).diff || "";
      }
      // Build review request for QA agent — 強調結構化 verdict
      const fileList = gitStatus?.staged?.map(f => f.path).join(", ") || gitStatus?.all?.map(f => f.path).join(", ") || "";
      const reviewTask = `請 review 以下 staged diff，這是另一個 agent 剛完成的變更。

**變更檔案：** ${fileList}
**分支：** ${gitStatus?.branch || "unknown"}

**Diff：**
\n${'```'}diff
${diffText.slice(0, 12000)}
${'```'}\n
請檢查：
1. ⚠️ 潛在 bug 或邊界情況
2. 🔒 安全問題
3. 🔄 跨平台相容性
4. ♿ 可訪問性
5. 📝 缺漏的錯誤處理
6. 🧪 建議的測試步驟

⚠️ **重要：你的回覆最後必須包含結構化 verdict 區塊：**
\`\`\`
---QA_VERDICT---
verdict: pass 或 conditional 或 rework
issues: 數字
critical: 數字
summary: 一句話總結
feedback: 具體修正建議（rework 時必須給）
---END_VERDICT---
\`\`\`

${gitLog[0] ? `**最近 commit：** ${gitLog[0].short} ${gitLog[0].subject}` : ""}`;

      const res = await fetch(`${API_BASE}/api/coding-crew/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "qa", task: reviewTask, cwd: rootPath }),
      });
      if (!res.ok) {
        const errText = await res.text();
        setQaReview(`❌ QA Agent 派工失敗: ${errText.slice(0, 200)}`);
        setQaReviewLoading(false);
        return;
      }
      // Read SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let result = "";
      let buffer = "";
      let currentEvent = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
            if (line.startsWith("data:")) {
              try {
                const evt = JSON.parse(line.slice(5).trim());
                if (currentEvent === "text" && evt.text) {
                  result += evt.text;
                  setQaReview(result);
                }
              } catch {}
            }
          }
        }
      }

      // ══ Parse QA verdict and drive pipeline ══
      const verdict = parseQaVerdict(result);
      if (verdict) {
        setQaVerdict(verdict);
        // Find active task to update pipeline
        if (activeCodingTaskId) {
          try {
            if (verdict.verdict === "pass") {
              // ✅ Pass → advance QA phase → commit phase awaits human
              await fetch(`${API_BASE}/api/coding-tasks/${encodeURIComponent(activeCodingTaskId)}/pipeline/advance?path=${encodeURIComponent(rootPath)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phase: "qa", result: verdict.summary, by: "qa-agent" }),
              });
            } else if (verdict.verdict === "rework") {
              // ❌ Rework → reject QA phase → return to implement
              await fetch(`${API_BASE}/api/coding-tasks/${encodeURIComponent(activeCodingTaskId)}/pipeline/reject?path=${encodeURIComponent(rootPath)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  phase: "qa",
                  status: "rework",
                  reason: verdict.summary,
                  feedback: verdict.feedback,
                  by: "qa-agent",
                  returnTo: "implement",
                }),
              });
            }
            // conditional → leave for human to decide
          } catch (e: any) {
            console.error("Pipeline action failed:", e.message);
          }
        }
      }

      // Save review to server
      try {
        await fetch(`${API_BASE}/api/vibe-git/reviews?path=${encodeURIComponent(rootPath)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: result, branch: gitStatus?.branch, files: gitStatus?.staged?.map(f => f.path), diffLength: diffText?.length, verdict: verdict?.verdict || null }),
        });
      } catch {}
    } catch (err: any) { setQaReview(`❌ Error: ${err.message}`); }
    setQaReviewLoading(false);
  }, [rootPath, gitDiff, gitLog, gitStatus, activeCodingTaskId]);

  // Auto-refresh git when panel opens or when switching to git tab
  useEffect(() => {
    if (showGitPanel) { refreshGitStatus(); refreshGitLog(); loadGitDiff(); }
  }, [showGitPanel]);

  useEffect(() => {
    if (activeMainTab?.type === "git" && rootPath) { refreshGitStatus(); refreshGitLog(); loadGitDiff(); }
  }, [activeMainTab?.type, rootPath]);

  // 2026-08-16: git 面板可見時定期輪詢 status+log（背景 agent commit 不會自己冒出來，
  // 之前只只在開 panel/切 tab 抓一次，開著不動就永遠舊名單）
  const gitVisible = showGitPanel || activeMainTab?.type === "git";
  useEffect(() => {
    if (!gitVisible || !rootPath) return;
    const iv = setInterval(() => { refreshGitStatus(); refreshGitLog(); }, 15000);
    return () => clearInterval(iv);
  }, [gitVisible, rootPath, refreshGitStatus, refreshGitLog]);

  // Fetch staged-changes summary when entering git tab or opening git panel
  useEffect(() => {
    if ((activeMainTab?.type === "git" || showGitPanel) && rootPath) {
      fetch(`${API_BASE}/api/coding-staged/changes?path=${encodeURIComponent(rootPath)}`)
        .then(r => r.json()).then(data => {
          setStagedSummary(data);
          if (data.taskId) setActiveCodingTaskId(data.taskId);
        }).catch(() => {});
    }
  }, [activeMainTab?.type, rootPath, showGitPanel]);

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
        const item: ApiHistoryItem = { id: `req-${Date.now()}`, ts: new Date().toISOString(), method: apiMethod, url: apiUrl, status: status || 200, elapsed, headers: [...apiHeaders], body: apiBody, streamMode: apiStreamMode, streamResponse: accumulated };
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
        onSelect={(path) => { switchRu(path); setShowDirExplorer(false); }}
        onClose={() => setShowDirExplorer(false)}
        title="📂 選擇專案目錄"
      />
    )}

    {/* New Project Dialog */}
    {showNewProject && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!newProjectCreating) { setShowNewProject(false); setNewProjectStep(1); } }}>
        <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center gap-2 px-5 pt-5 pb-3">
            <span className="text-xl">🚀</span>
            <h3 className="text-base font-semibold text-stone-800">New Project</h3>
            {newProjectStep > 1 && !newProjectCreating && (
              <button onClick={() => setNewProjectStep(newProjectStep - 1)} className="ml-auto text-xs text-stone-400 hover:text-stone-600">← Back</button>
            )}
          </div>

          {/* Step indicator */}
          <div className="px-5 pb-3 flex gap-1.5">
            {[1,2,3].map(s => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${newProjectStep >= s ? 'bg-emerald-500' : 'bg-stone-200'}`} />
            ))}
          </div>

          <div className="px-5 pb-5 overflow-y-auto max-h-[60vh]">
            {/* ── STEP 1: Template Gallery ── */}
            {newProjectStep === 1 && (
              <div>
                <p className="text-sm text-stone-500 mb-3">選擇專案版型</p>
                <div className="grid grid-cols-1 gap-3">
                  {/* React + Vite + Node.js Fullstack */}
                  <button
                    onClick={() => { setNewProjectTemplate("react-vite"); setNewProjectStep(2); }}
                    className={`group flex items-start gap-3 p-3 rounded-lg border-2 transition-all text-left hover:shadow-md ${newProjectTemplate === "react-vite" ? "border-emerald-400 bg-emerald-50/50" : "border-stone-200 hover:border-stone-300"}`}
                  >
                    <div className="w-16 h-12 rounded bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0 text-white text-xl font-bold">⚛</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-stone-800">⚡ React + Vite + Node.js</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Fullstack</span>
                      </div>
                      <p className="text-xs text-stone-500 mt-0.5">前後端分離架構，Vite 開發伺服器 + Express API，AI 自動生成專案骨架與基本 UI</p>
                      <div className="flex gap-1 mt-1.5">
                        {"React,Vite,TypeScript,Express,Tailwind".split(",").map(t => (
                          <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-stone-100 text-stone-500">{t}</span>
                        ))}
                      </div>
                    </div>
                  </button>
                </div>
                <p className="text-stone-400 text-xs mt-4">💡 選好版型後進入下一步描述你的專案需求</p>
              </div>
            )}

            {/* ── STEP 2: Config ── */}
            {newProjectStep === 2 && (
              <div className="space-y-3">
                {/* Selected template badge */}
                <div className="flex items-center gap-2 p-2 bg-stone-50 rounded-lg">
                  <span className="text-sm">⚡</span>
                  <span className="text-xs font-medium text-stone-600">React + Vite + Node.js</span>
                  <button onClick={() => setNewProjectStep(1)} className="text-[10px] text-stone-400 hover:text-stone-600 ml-auto">換版型</button>
                </div>

                {/* Project Name */}
                <div>
                  <label className="text-xs font-medium text-stone-500 mb-1 block">專案名稱 *</label>
                  <input
                    value={newProjectName}
                    onChange={e => { setNewProjectName(e.target.value); setNewProjectError(""); }}
                    placeholder="my-awesome-project"
                    className="w-full text-sm font-mono px-3 py-2 border rounded-lg bg-stone-50 outline-none focus:border-emerald-400"
                    style={{ borderColor: newProjectError ? "#ef4444" : undefined }}
                    autoFocus
                  />
                </div>

                {/* Description — what to build */}
                <div>
                  <label className="text-xs font-medium text-stone-500 mb-1 block">描述你想做什麼 *</label>
                  <textarea
                    value={newProjectDesc}
                    onChange={e => { setNewProjectDesc(e.target.value); setNewProjectError(""); }}
                    placeholder={"例：一個待辦事項 App，可以新增、完成、刪除任務，有登入功能"}
                    rows={3}
                    className="w-full text-sm px-3 py-2 border rounded-lg bg-stone-50 outline-none focus:border-emerald-400 resize-none"
                  />
                  <p className="text-[10px] text-stone-400 mt-1">AI 會根據你的描述自動生成專案骨架和基本 UI</p>
                </div>

                {/* Parent Directory */}
                <div>
                  <label className="text-xs font-medium text-stone-500 mb-1 block">存放目錄 *</label>
                  <input
                    value={newProjectParent}
                    onChange={e => { setNewProjectParent(e.target.value); setNewProjectError(""); }}
                    placeholder="/Users/you/projects"
                    className="w-full text-sm font-mono px-3 py-2 border rounded-lg bg-stone-50 outline-none focus:border-emerald-400"
                    style={{ borderColor: newProjectError ? "#ef4444" : undefined }}
                  />
                </div>

                {/* Preview path */}
                {newProjectParent && newProjectName.trim() && (
                  <div className="text-[10px] text-stone-400 font-mono bg-stone-50 rounded px-2 py-1.5 truncate">
                    📁 {newProjectParent}/{newProjectName.trim()}
                  </div>
                )}

                {newProjectError && (
                  <div className="text-xs text-red-500 bg-red-50 rounded px-2 py-1.5">{newProjectError}</div>
                )}
              </div>
            )}

            {/* ── STEP 3: Creating ── */}
            {newProjectStep === 3 && (
              <div className="py-6 flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-[3px] border-emerald-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm font-medium text-stone-700">AI 正在建立專案骨架...</p>
                <p className="text-xs text-stone-400">這可能需要 1-2 分鐘</p>
              </div>
            )}
          </div>

          {/* Footer buttons */}
          {newProjectStep !== 3 && (
            <div className="flex justify-end gap-2 px-5 pb-4 pt-2 border-t border-stone-100">
              <button
                onClick={() => { setShowNewProject(false); setNewProjectStep(1); }}
                className="text-xs px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600"
              >取消</button>
              {newProjectStep === 2 && (
                <button
                  onClick={async () => {
                    if (!newProjectName.trim() || !newProjectParent.trim() || !newProjectDesc.trim()) {
                      setNewProjectError("請填寫所有欄位");
                      return;
                    }
                    setNewProjectCreating(true);
                    setNewProjectError("");
                    setNewProjectStep(3);
                    try {
                      // Step 1: Create project directory + .paaw/
                      const res = await fetch(`${API_BASE}/api/coding-project/create`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: newProjectName.trim(),
                          parentDir: newProjectParent.trim(),
                          initGit: true,
                          initPaaw: true,
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) {
                        setNewProjectError(data.error || `Error ${res.status}`);
                        setNewProjectStep(2);
                        setNewProjectCreating(false);
                        return;
                      }

                      // Step 2: Open the new project
                      setShowNewProject(false);
                      setNewProjectStep(1);
                      switchRu(data.path);

                      // Step 3: Send scaffold prompt to developer agent
                      const scaffoldPrompt = `我剛建立了一個新的 Node.js + React + Vite 專案，請幫我搭建完整的專案骨架。\n\n專案名稱：${newProjectName.trim()}\n專案描述：${newProjectDesc.trim()}\n\n請建立以下結構：\n1. 前端：React + Vite + TypeScript + Tailwind CSS\n   - src/App.tsx — 主頁面，根據描述生成基本 UI\n   - src/main.tsx — 入口\n   - index.html\n2. 後端：Node.js + Express\n   - server/index.ts — API server，基本 health check endpoint\n3. 設定檔\n   - package.json（前後端 scripts）\n   - tsconfig.json\n   - vite.config.ts\n   - tailwind.config.js\n   - .gitignore\n4. 安裝依賴並確認可以啟動\n\n根據我的描述「${newProjectDesc.trim()}」生成對應的基本 UI 和 API。保持簡潔可用，不用完美。`;

                      setChatMessages(prev => [...prev, { role: "user" as const, content: scaffoldPrompt, ts: new Date().toISOString() }]);
                      setTimeout(() => sendChatMessage(scaffoldPrompt), 100);

                    } catch (err: any) {
                      setNewProjectError(err.message || "Unknown error");
                      setNewProjectStep(2);
                    }
                    setNewProjectCreating(false);
                  }}
                  disabled={newProjectCreating || !newProjectName.trim() || !newProjectParent.trim() || !newProjectDesc.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🤖 AI 建立專案
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )}

    <div className="h-full flex flex-col w-full overflow-hidden" style={{ backgroundColor: "#fff" }}>
      {/* ── Top Bar ── */}
      <div className="flex items-center h-9 px-2 border-b shrink-0 select-none" style={{ backgroundColor: tk.toolbarBg, borderColor: tk.toolbarBorder }}>
        {/* ── Left-side toolbar: all features with icon + name ── */}
        {/* 🗂️ File tree 顯隱切換（2026-08-16 Fleming 要求；08-19 移到最前 — 控制左側欄的開關放最左邊） */}
        <button onClick={() => setFileTreeHidden(v => !v)}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: fileTreeHidden ? tk.toolbarActive : "transparent", color: tk.toolbarTextMuted }}
          onMouseEnter={e => { if (!fileTreeHidden) e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = fileTreeHidden ? tk.toolbarActive : "transparent"; }}
          title={fileTreeHidden ? "顯示檔案樹" : "隱藏檔案樹"}>{fileTreeHidden ? "📁" : "🗂️"}</button>
        {/* ⚡ Project */}
        <div className="relative ml-1">
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
                    <button key={rp.path} onClick={() => { setShowProjectMenu(false); switchRu(rp.path); }}
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
            <span className="text-xs">🤖</span> Agent
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
                    setChatInput(""); // clear chat input when switching crews
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
                    {crew.imageUrl ? (
                      <img src={`${API_BASE}${crew.imageUrl}`} className="w-[18px] h-[18px] rounded-full object-cover shrink-0" alt="" />
                    ) : (
                      <span>{crew.emoji}</span>
                    )} <span className="truncate">{crew.title}</span>
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
        <button onClick={() => openMainTab({ id: "tool:browser", type: "browser", label: "BROWSER", icon: "🌐", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:browser" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:browser") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:browser") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:browser" ? tk.toolbarActive : "transparent"; }}
          title={tt("browser.title")}>🌐 BROWSER</button>
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
        <button onClick={() => openMainTab({ id: "tool:tasks", type: "tasks", label: "Tasks", icon: "📌", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:tasks" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:tasks") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:tasks") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:tasks" ? tk.toolbarActive : "transparent"; }}
          title="Tasks">📌 Tasks</button>
        <button onClick={() => openMainTab({ id: "tool:features", type: "features", label: "Features", icon: "🗺️", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:features" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:features") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:features") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:features" ? tk.toolbarActive : "transparent"; }}
          title={tt("feature.title")}>🗺️ Features</button>
          <button onClick={() => openMainTab({ id: "tool:crew", type: "crew-manager", label: "AI Crew", icon: "👥", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:crew" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:crew") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:crew") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:crew" ? tk.toolbarActive : "transparent"; }}
          title="AI Crew 管理">👥 AI Crew</button>
        <button onClick={() => openMainTab({ id: "tool:security", type: "security", label: "Security", icon: "🔒", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:security" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:security") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:security") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:security" ? tk.toolbarActive : "transparent"; }}
          title="Security Scan">🔒 Security</button>
        <button onClick={() => openMainTab({ id: "tool:release", type: "release-manager", label: "Release Manager", icon: "🚦", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:release" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:release") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:release") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:release" ? tk.toolbarActive : "transparent"; }}
          title={tt("rm.title")}>🚦 Release</button>
        <button onClick={() => openMainTab({ id: "tool:handover", type: "handover", label: "Handover", icon: "🤝", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:handover" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:handover") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:handover") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:handover" ? tk.toolbarActive : "transparent"; }}
          title={tt("ho.title")}>🤝 Handover</button>
        <button onClick={() => openMainTab({ id: "tool:troubleshooting", type: "troubleshooting", label: "Troubleshooting", icon: "🔧", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:troubleshooting" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:troubleshooting") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:troubleshooting") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:troubleshooting" ? tk.toolbarActive : "transparent"; }}
          title={tt("ops.title")}>🔧 Ops</button>
        <button onClick={() => openMainTab({ id: "tool:code-intel", type: "code-intel", label: tt("codeIntel.toolbar"), icon: "📞", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:code-intel" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:code-intel") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:code-intel") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:code-intel" ? tk.toolbarActive : "transparent"; }}
          title={tt("codeIntel.toolbar")}>📞 Intel</button>
        <button onClick={() => openMainTab({ id: "tool:tests", type: "tests", label: tt("tests.toolbar"), icon: "🧪", closable: true })}
          className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors")}
          style={{ backgroundColor: activeMainTab?.id === "tool:tests" ? tk.toolbarActive : "transparent", color: mainTabs.some(t => t.id === "tool:tests") ? tk.toolbarText : tk.toolbarTextMuted }}
          onMouseEnter={e => { if (activeMainTab?.id !== "tool:tests") e.currentTarget.style.backgroundColor = tk.toolbarHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = activeMainTab?.id === "tool:tests" ? tk.toolbarActive : "transparent"; }}
          title={tt("tests.toolbar")}>🧪 Tests</button>

      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex min-h-0">
        {/* ── File Explorer（可隱藏）── */}
        {!fileTreeHidden && (<>
        <div className="flex flex-col shrink-0 select-none" style={{ width: sidebarWidth, backgroundColor: "#fff" }}>
          {/* ── Sidebar tabs：① Release Unit ② Files Explorer（未選 RU 鎖定）── */}
          <div className="flex items-stretch gap-0.5 px-1 pt-1 shrink-0" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
            <button onClick={() => setSidebarTab("ru")}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs shrink-0 transition-colors ${sidebarTab === "ru" ? "text-stone-800 font-semibold" : "text-stone-400 hover:text-stone-600"}`}
              style={{ borderBottom: `2px solid ${sidebarTab === "ru" ? tk.accent : "transparent"}` }}
              title={tt("ru.tabTooltip")}>📦 {tt("ru.tabRu", "Release Unit")}{releaseUnits.length > 0 && <span className="text-[10px] font-normal text-stone-400">{releaseUnits.length}</span>}</button>
            <button onClick={() => { if (rootPath) setSidebarTab("files"); }}
              disabled={!rootPath}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs shrink-0 transition-colors ${sidebarTab === "files" && rootPath ? "text-stone-800 font-semibold" : rootPath ? "text-stone-400 hover:text-stone-600" : "text-stone-300 cursor-not-allowed"}`}
              style={{ borderBottom: `2px solid ${sidebarTab === "files" && rootPath ? tk.accent : "transparent"}` }}
              title={rootPath ? tt("ru.tabFiles", "Files Explorer") : tt("ru.filesDisabled")}>🗂 {tt("ru.tabFiles", "Files Explorer")}</button>
          </div>
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
            {sidebarTab === "files" && rootPath ? (
              <SidebarFileTree
                projectRoot={rootPath}
                activeFilePath={activeMainTab?.filePath || activeTabId}
                openFilePaths={new Set(mainTabs.filter(t => t.filePath).map(t => t.filePath!))}
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
              <div className="flex flex-col h-full p-3 gap-2 overflow-y-auto">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-stone-400">{tt("ru.manager", "Release Units")}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">{releaseUnits.length}</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setShowDirExplorer(true)}
                    className="flex-1 text-xs px-2 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold">
                    📂 {tt("ru.import", "Import")}
                  </button>
                  <button onClick={() => { setNewProjectParent(""); setNewProjectName(""); setNewProjectError(""); setShowNewProject(true); }}
                    className="flex-1 text-xs px-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                    ➕ {tt("vibe.newProject", "New Project")}
                  </button>
                </div>
                {releaseUnits.map(u => (
                  <div key={u.id} onClick={() => switchRu(u.path)}
                    className="group flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-blue-50 cursor-pointer text-sm">
                    <span className="shrink-0">{u.exists === false ? "⚠️" : "📦"}</span>
                    <span className="truncate flex-1 text-stone-700" title={u.path}>{u.label}</span>
                    {rootPath === u.path && <span className="text-[10px] text-emerald-600 font-bold" title={tt("ru.active", "active")}>●</span>}
                    <button onClick={e => { e.stopPropagation(); removeRu(u); }}
                      className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 text-xs shrink-0" title={tt("ru.remove", "Remove")}>✕</button>
                  </div>
                ))}
                {releaseUnits.length === 0 && (
                  <div className="text-xs text-stone-400 text-center mt-8 leading-relaxed">{tt("ru.empty")}</div>
                )}
                {recentProjects.length > 0 && (
                  <div className="border-t border-stone-100 pt-2 mt-2">
                    <div className="text-[10px] font-semibold text-stone-400 mb-1">{tt("vibe.recentProjects", "Recent Projects")}</div>
                    {recentProjects.slice(0, 5).map(rp => (
                      <button key={rp.path} onClick={() => { switchRu(rp.path); }}
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 rounded flex items-center gap-1.5 truncate">
                        <span className="shrink-0">{rp.hasPaaw ? "🤖" : "📁"}</span> <span className="truncate text-stone-600">{rp.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-auto pt-2 border-t border-stone-100 text-[10px] text-stone-400 leading-relaxed">{tt("ru.hint")}</div>
              </div>
            )}
          </div>
          {/* ── .paaw/ Project Knowledge removed (agents maintain via API) ── */}
        </div>

        {/* Sidebar resize */}
        <div className="w-px cursor-col-resize hover:w-0.5 hover:bg-blue-400 active:bg-blue-500 transition-all shrink-0"
          onMouseDown={e => startResize("sidebar", e)} style={{ backgroundColor: tk.borderLight }} />
        </>)}

        {/* ── Center: Unified Tab System ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab Bar — all tabs (files + tools + AI crew) */}
          <div ref={tabBarRef} className="flex items-end shrink-0 overflow-x-auto" style={{ backgroundColor: tk.bgMuted, borderBottom: `1px solid ${tk.borderLight}` }}>
            {mainTabs.map(tab => {
              const isEditorFile = tab.type === "editor";
              const fileTab = isEditorFile ? openTabs.find(ot => ot.id === tab.filePath) : null;
              const isActive = activeMainTabId === tab.id;
              return (
                <div key={tab.id}
                  ref={el => { if (isActive && el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); }}
                  className={cn("group flex items-center gap-1 px-3 py-1 cursor-pointer select-none text-xs shrink-0 transition-colors",
                    isActive ? "bg-white text-stone-800" : "text-stone-400 hover:bg-stone-100")}
                  style={isActive ? { borderTop: `2px solid ${tk.accent}` } : { borderTop: "2px solid transparent" }}
                  onClick={() => { setActiveMainTabId(tab.id); if (isEditorFile) setActiveTabId(tab.filePath || null); }}>
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

            {/* === EDITOR — keep all editor tabs alive (hidden) to preserve scroll === */}
            {mainTabs.filter(t => t.type === "editor" && t.filePath).map(tab => {
              const isActive = activeMainTab?.id === tab.id;
              const tabData = openTabs.find(ot => ot.path === tab.filePath);
              return (
                <EditorTabContent
                  key={tab.id}
                  tabId={tab.id}
                  filePath={tab.filePath || ""}
                  tabData={tabData}
                  isActive={isActive}
                  isEditing={isActive && isEditing}
                  textareaRef={textareaRef}
                  lineNumWidth={lineNumWidth}
                  handleContentChange={handleContentChange}
                  stopEditing={stopEditing}
                  handleCodeViewClick={handleCodeViewClick}
                  startEditing={startEditing}
                  tk={tk}
                  tt={tt}
                  openFile={openFile}
                />
              );
            })}

            {/* === FILE VIEWER — keep all viewer tabs alive (hidden) to preserve scroll === */}
            {mainTabs.filter(t => t.type === "viewer" && t.filePath).map(tab => {
              const isActive = activeMainTab?.id === tab.id;
              return (
                <div
                  key={tab.id}
                  className="absolute inset-0 flex flex-col overflow-hidden"
                  style={{ visibility: isActive ? "visible" : "hidden", zIndex: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}
                >
                  <FileViewer filePath={tab.filePath!} projectRoot={rootPath} active={isActive} />
                </div>
              );
            })}

            {/* === GIT PANEL (New Component) === */}
            {activeMainTab?.type === "browser" && (
              <BrowserPanel API_BASE={API_BASE} />
            )}
            {activeMainTab?.type === "git" && (
              <GitPanel
                rootPath={rootPath!}
                API_BASE={API_BASE}
                gitStatus={gitStatus}
                gitLog={gitLog}
                gitDiff={gitDiff}
                gitDiffFile={gitDiffFile}
                gitDiffCached={gitDiffCached}
                gitCommitMsg={gitCommitMsg}
                gitActionMsg={gitActionMsg}
                selectedFiles={selectedFiles}
                aiCommitLoading={aiCommitLoading}
                stagedSummary={stagedSummary}
                qaReview={qaReview}
                qaVerdict={qaVerdict}
                qaReviewLoading={qaReviewLoading}
                gitReviews={gitReviews}
                blameData={blameData}
                blameFile={blameFile}
                activeCodingTask={activeCodingTaskId ? { id: activeCodingTaskId, title: stagedSummary?.task || "", pipeline: activeTaskPipeline } : null}
                projectLoopMode={projectLoopMode}
                setGitTab={setGitTab}
                setGitCommitMsg={setGitCommitMsg}
                setGitActionMsg={setGitActionMsg}
                setSelectedFiles={setSelectedFiles}
                setGitDiffFile={setGitDiffFile}
                setGitDiff={setGitDiff}
                setGitDiffCached={setGitDiffCached}
                setActiveSubPanel={setActiveSubPanel}
                setStagedSummary={setStagedSummary}
                refreshGitStatus={refreshGitStatus}
                refreshGitLog={refreshGitLog}
                loadGitDiff={loadGitDiff}
                runQaReview={runQaReview}
                fmtTime={fmtTime}
                theme={tk}
                tt={tt}
              />
            )}

            {/* === API TESTER === */}
            {/* === API TESTER（三欄：API 地圖 | 測試台 | Developer AI）=== */}
            {activeMainTab?.type === "api" && (
              <div className="flex-1 flex min-w-0 overflow-hidden" data-testid="api-tester-page">
                {/* 左欄：API 地圖宮殿 */}
                <div className="shrink-0 border-r hidden lg:flex flex-col" style={{ width: 264, borderColor: tk.borderLight }}>
                  <ApiMapSidebar
                    rootPath={rootPath}
                    onPick={(m, p) => {
                      const base = rootPath ? `http://localhost:${new URL(API_BASE).port}` : API_BASE;
                      setApiUrl(`${base}${p}`);
                      setApiMethod(m || "GET");
                      setApiStreamMode(false);
                    }}
                    onOpenFile={(abs) => { openFile(abs); }}
                    onAskAi={(prompt) => { apiDevChatRef.current?.send(prompt); }}
                    borderLight={tk.borderLight}
                  />
                </div>
                {/* 中欄：request builder + response（原有）*/}
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
                    {/* Fallback: project API routes grouped by path segment */}
                    {projectApiExamples.length === 0 && projectApis.length > 0 && (() => {
                      // Group APIs by first path segment
                      const groups: Record<string, typeof projectApis> = {};
                      for (const api of projectApis) {
                        const parts = api.path.replace(/^\/+/, "").split("/");
                        const group = parts.length > 1 ? parts[0] : "root";
                        if (!groups[group]) groups[group] = [];
                        groups[group].push(api);
                      }
                      const groupNames = Object.keys(groups).sort();
                      return groupNames.map(gName => {
                        const apis = groups[gName];
                        const collapsed = apiGroupCollapsed[gName] !== false; // default collapsed
                        return (
                          <div key={`grp-${gName}`} className="mb-1">
                            <button onClick={() => setApiGroupCollapsed(prev => ({ ...prev, [gName]: !collapsed }))}
                              className="text-xs font-semibold text-stone-500 hover:text-stone-700 flex items-center gap-1 mb-0.5">
                              <span className="text-[10px]">{collapsed ? "▸" : "▾"}</span>
                              <span className="text-blue-500">/{gName}</span>
                              <span className="text-stone-400 font-normal">({apis.length})</span>
                            </button>
                            {!collapsed && (
                              <div className="flex flex-wrap gap-1 ml-3 mb-1">
                                {apis.map((api, i) => (
                                  <button key={`proj-${gName}-${i}`} onClick={() => {
                                    const base = rootPath ? `http://localhost:${new URL(API_BASE).port}` : API_BASE;
                                    setApiUrl(`${base}${api.path}`);
                                    setApiMethod(api.method || "GET");
                                    setApiStreamMode(false);
                                  }}
                                    className="text-xs px-2 py-0.5 rounded-full border border-blue-200 text-blue-600 hover:bg-blue-50"
                                    title={api.file || api.path}>
                                    {api.method} {api.path.length > 30 ? `…${api.path.slice(-27)}` : api.path}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                    {/* Generic test endpoints */}
                    {projectApiExamples.length === 0 && projectApis.length === 0 && (
                      <span className="text-xs text-stone-400 italic">No project APIs found — agent 寫 API 時會自動產生 sample</span>
                    )}
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
                        {apiStreamContent ? tryFormatJson(apiStreamContent) : "⏳ Waiting for response..."}
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
                      <ApiResponseBody body={apiResponse.body} />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-stone-400 text-xs">
                      <span className="text-2xl">📥</span>
                      <p>{tt("vibe.apiNoResponse")}</p>
                    </div>
                  )}
                </div>
              </div>
                {/* 右欄：Developer AI 助理 */}
                <div className="shrink-0 border-l hidden xl:flex flex-col" style={{ width: 340, borderColor: tk.borderLight }}>
                  <AgentSideChat
                    ref={apiDevChatRef}
                    agentId="developer"
                    agentName={tt("apiMap.devAiName")}
                    agentEmoji="💻"
                    greeting={tt("apiMap.devAiGreeting")}
                    cwd={rootPath}
                    accent="#2563eb"
                    height="100%"
                    placeholder={tt("apiMap.devAiPlaceholder")}
                  />
                </div>
              </div>
            )}


            {/* === AI CREW / EMPLOYEE CHAT TAB === */}
            {activeCrew && (() => {
              const crew = codingCrews.find(c => c.id === activeCrew);
              const profile = crewProfile[activeCrew] as any;
              const rolePrompt = profile?.rolePrompt || "";
              const roleSummary = rolePrompt.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('你是') && l.length > 5) || rolePrompt.slice(0, 80);
              const hasProject = !!rootPath;
              const isCrewActive = activeMainTab?.type === "ai-crew" && activeMainTab?.crewId === activeCrew;
              return (
              <div key={activeCrew} className="absolute inset-0 flex flex-col min-w-0 bg-white"
                style={{ visibility: isCrewActive ? "visible" : "hidden", zIndex: isCrewActive ? 1 : 0, pointerEvents: isCrewActive ? "auto" : "none" }}>
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
                      </div>
                      <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">{profile?.description || roleSummary}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Conversation count badge */}
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
                      <ModelSelector feature={`codingIDE.${activeCrew}`} value={codingModel} onChange={setCodingModel} />
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
                <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "thin" }} onScroll={(e) => {
                  const el = e.currentTarget;
                  chatNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  if (activeCrew) _chatScrollCache.set(activeCrew, el.scrollTop); // FileViewer scroll cache 同款
                }}>
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
                    activeTools={agentToolBadges}
                    endRef={chatEndRef}
                    assignableAgents={assignableChatAgents}
                    onAssignToAgent={assignToAgent}
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
                      onCompositionStart={() => { composingRef.current = true; }}
                      onCompositionEnd={() => { composingRef.current = false; }}
                      onKeyDown={handleChatKeyDown}
                      placeholder={`問 ${crew?.title}...`}
                      className="flex-1 text-sm px-3 py-2 rounded-lg resize-none outline-none border focus:border-blue-400"
                      style={{ borderColor: tk.borderInput, backgroundColor: "white" }}
                      rows={2}
                    />
                    {chatLoading && (
                      <button
                        onClick={() => {
                          // Immediately update UI state — don't wait for SSE/stream to close
                          setChatLoading(false);
                          setAgentRunning(false);
                          setAgentAction("");

                          // Abort whatever is running
                          if (a2aAbortRef.current) {
                            a2aAbortRef.current.abort();
                            a2aAbortRef.current = null;
                          }
                          if (domainAbortRef.current) {
                            domainAbortRef.current.abort();
                            domainAbortRef.current = null;
                          }
                          // Tell server to kill the running stream (agent mode)
                          const aid = activeCrew?.replace(/^coding\./, "") || "architect";
                          fetch(`${API_BASE}/api/coding-crew/interrupt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: aid }) }).catch(() => {});
                          fetch(`${API_BASE}/api/a2a/interrupt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: aid }) }).catch(() => {});

                          // Add interrupted message if not already there
                          setChatMessages(prev => {
                            const last = prev[prev.length - 1];
                            if (last?.content?.includes("中斷")) return prev; // already has interrupt msg
                            return [...prev, { role: "assistant" as const, content: "⏹️ Agent 已中斷。", ts: new Date().toISOString() }];
                          });
                        }}
                        className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors"
                        title="中斷"
                      >中斷</button>
                    )}
                    <button
                      onClick={() => { if (!chatInput.trim()) return; sendChat(); }}
                      disabled={chatLoading || !chatInput.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40 transition-colors"
                      style={{ backgroundColor: chatLoading ? '#a1a1aa' : tk.accent }}>
                      送出
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
                onStartCodeUnderstanding={startAiInitialize}
                codeUnderstanding={{ running: aiInitializing, steps: aiInitSteps }}
                model={emModel}
                onModelChange={setEmModel}
                loopMode={projectLoopMode}
                onLoopModeChange={handleLoopModeChange}
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
                openMainTab={openMainTab}
                adRefreshTrigger={adRefreshTrigger}
              />
            </div>

            {/* === TERMINAL TABS === */}
            {/* Stack terminals with absolute positioning when inactive — avoids flex-1
                taking space, while keeping xterm container at full size so FitAddon works.
                Active: normal flex-1 in flow. Inactive: absolute inset-0 + visibility:hidden + z-1. */}
            {mainTabs.filter(t => t.type === "terminal").length > 0 && (
              <div
                className={activeMainTab?.type === "terminal" ? "flex-1 relative min-h-0" : "absolute inset-0"}
                style={activeMainTab?.type === "terminal" ? undefined : { visibility: "hidden", zIndex: -1 }}
              >
                {mainTabs.filter(t => t.type === "terminal").map(tab => {
                  const isActive = activeMainTab?.id === tab.id;
                  return (
                    <div
                      key={tab.id}
                      className="absolute inset-0 flex flex-col min-w-0"
                      style={{
                        visibility: isActive ? "visible" : "hidden",
                        zIndex: isActive ? 1 : 0,
                      }}
                    >
                      <div className="flex-1 min-h-0 bg-[#1e1717]">
                        {rootPath && <ShellTerminal key={tab.id} cwd={rootPath} active={isActive} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* === ISSUES TAB === */}
            {/* === RELEASE / HANDOVER / TROUBLESHOOTING TABS === (keep mounted, hide with CSS) */}
            {mainTabs.some(t => t.type === "release-manager") && rootPath && (
              <div key="tool:release" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "release-manager" ? undefined : "none" }}>
                <ReleaseManagerPanel
                  rootPath={rootPath}
                  theme={{ borderLight: tk.borderLight, accent: tk.accent }}
                  onOpenEMDashboard={() => openMainTab({ id: DASHBOARD_TAB_ID, type: "em-dashboard", label: "EM 大總管", icon: "🎖️", closable: false })}
                />
              </div>
            )}
            {mainTabs.some(t => t.type === "handover") && rootPath && (
              <div key="tool:handover" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "handover" ? undefined : "none" }}>
                <HandoverPanel
                  rootPath={rootPath}
                  theme={{ borderLight: tk.borderLight, accent: tk.accent }}
                  onOpenEMDashboard={() => openMainTab({ id: DASHBOARD_TAB_ID, type: "em-dashboard", label: "EM 大總管", icon: "🎖️", closable: false })}
                />
              </div>
            )}
            {mainTabs.some(t => t.type === "troubleshooting") && rootPath && (
              <div key="tool:troubleshooting" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "troubleshooting" ? undefined : "none" }}>
                <TroubleshootingPanel
                  rootPath={rootPath}
                  theme={{ borderLight: tk.borderLight, accent: tk.accent }}
                />
              </div>
            )}
            {/* === Code Intelligence 頁（📞 Call Graph / 🔗 Deps / 🎯 Impact / 🩺 Health + Architect AI）=== */}
            {mainTabs.filter(t => t.type === "code-intel").map(tab => (
              <div key={tab.id} className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTabId === tab.id ? undefined : "none" }}>
                <TabErrorBoundary label={tab.label}>
                  <CodeIntelPage rootPath={rootPath} onOpenFile={openFile} />
                </TabErrorBoundary>
              </div>
            ))}
            {/* === Tests 頁（🧪 對照表 + 缺口 + Tester AI）=== */}
            {mainTabs.filter(t => t.type === "tests").map(tab => (
              <div key={tab.id} className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTabId === tab.id ? undefined : "none" }}>
                <TabErrorBoundary label={tab.label}>
                  <TestsPage rootPath={rootPath} onOpenFile={openFile} />
                </TabErrorBoundary>
              </div>
            ))}
            {/* === Issues Tab === (keep mounted, hide with CSS) === */}
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

            {/* === TASKS TAB === */}
            {mainTabs.some(t => t.type === "tasks") && rootPath && (
              <div key="tool:tasks" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "tasks" ? undefined : "none" }}>
                <TaskBoard
                  rootPath={rootPath}
                  visible={activeMainTab?.type === "tasks"}
                  theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, accent: tk.accent, accentBg: tk.accentBg, text: tk.text }}
                  onOpenFile={openFile}
                  onNavigateIssue={(issueId) => {
                    // Open issues tab and select the issue
                    if (!mainTabs.some(t => t.id === "tool:issues")) {
                      openMainTab({ id: "tool:issues", type: "issues", label: "Issues", icon: "📋", closable: true });
                    }
                    setActiveMainTabId("tool:issues");
                  }}
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

            {/* === Security Tab === (keep mounted, hide with CSS) */}
            {mainTabs.some(t => t.type === "security") && rootPath && (
              <div key="tool:security" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "security" ? undefined : "none" }}>
                <SecurityTab
                  rootPath={rootPath}
                  theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, accent: tk.accent, accentBg: tk.accentBg, text: tk.text }}
                  onOpenFile={openFile}
                  onDispatchAgent={async (agentId, task) => {
                    try {
                      const res = await fetch(`${API_BASE}/api/coding-crew/dispatch`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ agentId, task, cwd: rootPath }),
                      });
                      const data = await res.json();
                      if (res.status === 409 || data.busy) {
                        alert(`⚠️ ${agentId} 正在忙碌中，請稍後再派工`);
                      } else if (!data.ok && data.error) {
                        alert(`❌ 派工失敗：${data.error}`);
                      } else {
                        // Switch to developer tab to see the result
                        const devCrewId = "coding.developer";
                        if (!mainTabs.some(t => t.id === `crew:${devCrewId}`)) {
                          setMainTabs(prev => [...prev, { id: `crew:${devCrewId}`, type: "ai-crew", label: "💻 Developer", icon: "💻", closable: true }]);
                        }
                        setActiveMainTab(prev => ({ ...prev, id: `crew:${devCrewId}`, type: "ai-crew", label: "💻 Developer" }));
                      }
                    } catch (err: any) {
                      alert(`❌ 派工錯誤：${err.message}`);
                    }
                  }}
                  agentBusy={(agentId: string) => !!crewAgentRunning[`coding.${agentId}`]}
                />
              </div>
            )}

            {/* === Crew Manager Tab === */}
            {mainTabs.some(t => t.type === "crew-manager") && rootPath && (
              <div key="tool:crew" className="flex-1 flex flex-col min-w-0"
                style={{ display: activeMainTab?.type === "crew-manager" ? undefined : "none" }}>
                <CrewManager
                  rootPath={rootPath}
                  theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, border: tk.borderInput, accent: tk.accent, accentLight: tk.accentLight, accentText: tk.accentText, text: tk.textPrimary }}
                  onCrewChanged={refreshCodingCrew}
                />
              </div>
            )}

            {/* === Sub-task Detail Tab === */}
            {activeMainTab?.type === "subtask-detail" && (
              <div key={activeMainTab.id} className="flex-1 flex flex-col min-w-0">
                <SubTaskDetail
                  theme={{ bg: tk.bg, bgMuted: tk.bgMuted, borderLight: tk.borderLight, accent: tk.accent, accentBg: tk.accentBg, text: tk.text }}
                  data={activeMainTab.data}
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
                      onClick={() => { openFile(file.path); setActiveSubPanel("editor"); setShowSearch(false); }}
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
                {typeof contextDebug?.totalLength === "number" && (
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
                      {safeStr(contextDebug.baseSystemPrompt)}
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
                      {safeStr(contextDebug.systemPromptPreview)}
                    </pre>
                  </div>
                )}
                {/* Dynamic Context Sections */}
                {contextDebug.dynamicContext?.map((ctx: { source: string; content?: string }, i: number) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">⚡ {ctx.source}</span>
                      <span className="text-[10px] text-stone-500">{(ctx.content?.length ?? 0).toLocaleString()} chars</span>
                    </div>
                    <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: "200px", overflowY: "auto" }}>
                      {safeStr(ctx.content)}
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
                    {safeStr(agentContextData.baseSystemPrompt) || "(empty)"}
                  </pre>
                </div>
                {/* Dynamic Context Sections */}
                {agentContextData.dynamicContext?.map((ctx, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">⚡ {ctx.source}</span>
                      <span className="text-[10px] text-stone-500">{(ctx.content?.length ?? 0).toLocaleString()} chars</span>
                    </div>
                    <pre className="text-xs text-stone-300 bg-stone-900/80 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-stone-800" style={{ maxHeight: "200px", overflowY: "auto" }}>
                      {safeStr(ctx.content)}
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
