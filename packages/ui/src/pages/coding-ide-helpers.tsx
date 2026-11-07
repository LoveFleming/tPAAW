// coding-ide-helpers.tsx — 2026-11-07 從 CodingIDE.tsx 機械抽取（不改行為）
// 模組層共用：types + ToolLogRow + 檔案/語言 helpers + EditorTabContent + highlightMatch
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
import { stableStringify, cn } from "../utils";
import ShellTerminal from "../components/ShellTerminal";
import Icon from "../components/Icon";
import ConsoleLogView from "../components/ConsoleLogView";
import JanitorPanel from "../components/JanitorPanel";
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
import RuCloneModal from "../components/RuCloneModal";
import RuOnboardingModal from "../components/RuOnboardingModal";
import { GitPanel } from "../components/git";
import { BrowserPanel } from "../components/browser/BrowserPanel";
import DiffViewer from "../components/DiffViewer";
import SessionHistory from "../components/SessionHistory";

import DecisionLog from "../components/DecisionLog";
import ProjectMdPage from "../components/ProjectMdPage"; // 📖 PROJECT.md（schema v2 — 2026-10-09）
import ModelSelector from "../components/ModelSelector";
import { ChatMessages, type ChatMessageItem } from "../components/ChatMessages";
import IssueTracker from "../components/IssueTracker";
import QaRecords from "../components/QaRecords";
import DispatchReports from "../components/DispatchReports"; // 📄 派工報告 tab page（2026-10-25：EM modal → 獨立 tab，入口 👷 生產 menu）
import TaskBoard from "../components/TaskBoard";
import ReleaseManagerPanel from "../components/ReleaseManagerPanel";
import CodeReviewBoardPanel from "../components/CodeReviewBoardPanel";
import HandoverPanel from "../components/HandoverPanel";
import TroubleshootingPanel from "../components/TroubleshootingPanel";
import TabErrorBoundary from "../components/TabErrorBoundary";
import ApiMapView from "../components/FeatureMap";
import ApiMapSidebar from "../components/ApiMapSidebar";
import ApiTesterTabs from "../components/ApiTesterTabs";
import ApiRequestTabSheet, { type ApiRequestTabSheetHandle } from "../components/ApiRequestTabSheet";
import AgentSideChat, { type AgentSideChatHandle } from "../components/AgentSideChat";
import { useColResize, ColResizer } from "../components/ColResizer"; // 2026-10-09：side chat 左右 splitter
import CrewManager from "../components/CrewManager";
// ReportsTab removed — merged into AutoDispatchPanel
import SecurityTab from "../components/SecurityTab";
import { pasteMayContainImage, extractPasteFiles } from "../utils/pasteFiles";
import FileViewer from "../pages/FileViewer";
import { uiAlert, uiAlertError, uiConfirm } from "../components/ui/uiFeedback";
// ┚ Tool Log 列（2026-10-24 Fleming：長指令摺疊、只顯示前後摘要 — heredoc 整段攤開看不到 agent 在幹嘛）

function ToolLogRow({ name, args, running }: { name: string; args: string; running: boolean }) {
  const { t: tt } = useI18n();
  const [open, setOpen] = useState(false);
  // 從 args JSON 抽人類可讀重點：bash → command，其他 → path/file/pattern/query
  let detail = args;
  try {
    const o = JSON.parse(args);
    detail = o?.command || o?.path || o?.file || o?.pattern || o?.query || args;
  } catch { /* 非 JSON 原樣 */ }
  const lines = detail.split("\n");
  const isLong = detail.length > 140 || lines.length > 3;
  const head = lines[0].slice(0, 100);
  const tail = lines[lines.length - 1].slice(-60);
  const hidden = lines.length - 2;
  return (
    <div className="text-[10px]">
      <div className="flex items-center gap-1.5">
        <span className={running ? "text-blue-400 animate-pulse" : "text-green-500"}>{running ? "⏳" : "✓"}</span>
        <span className="font-mono text-stone-600">{name}</span>
        {!isLong ? (
          <span className="text-stone-400 truncate max-w-[480px]" title={detail}>{detail}</span>
        ) : open ? (
          <button onClick={() => setOpen(false)} className="text-stone-500 hover:text-stone-700 font-mono">▾ {tt("coding.toolLogToggle")}</button>
        ) : (
          <button onClick={() => setOpen(true)} className="text-left text-stone-400 hover:text-stone-600 max-w-[480px] font-mono" title={tt("coding.toolLogToggle")}>
            {head} <span className="text-amber-500">⋯{tt("coding.toolLogHiddenLines").replace("{n}", String(hidden))}⋯</span> {tail}
          </button>
        )}
      </div>
      {open && (
        <pre className="mt-1 ml-6 p-2 rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 whitespace-pre-wrap break-all max-h-56 overflow-auto font-mono text-[10px]">{detail}</pre>
      )}
    </div>
  );
}


// crewId → a2a agentId（chat 發送與 stream-state 重連共用 — 2026-09-11）
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
const crewToAgentId = (crewId: string) => CREW_TO_AGENT[crewId] || crewId.replace(/^coding\./, "");

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
type MainTabType = "editor" | "viewer" | "git" | "api" | "browser" | "terminal" | "ai-crew" | "sessions" | "decisions" | "em-dashboard" | "prompts" | "issues" | "tasks" | "features" | "security" | "crew-manager" | "subtask-detail" | "release-manager" | "review-board" | "handover" | "troubleshooting" | "code-intel" | "tests" | "qa-records" | "dispatch-reports" | "project" | "ru-info";

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
  files?: { name: string; size: number }[]; // 📄 文字檔附件（2026-09-14）
  _thinking?: boolean; // internal flag for intermediate thinking bubbles
  _thinkingHistory?: string[]; // preserved thinking texts before final answer replaces them
  _toolCalls?: { name: string; args?: string; result?: string }[]; // tool calls made in this turn
  _streaming?: boolean; // true while content is being streamed in (OpenClaw style)
  _greeting?: boolean; // true for auto-generated greeting bubbles (excluded from conversationHistory)
  _approval?: { id: string; command: string; reason?: string; decided?: string | null }; // 🛡 審批卡（2026-10-09）
  _security?: { kind: string; domains?: string[]; message: string }; // 🛡 安全通知卡（2026-10-10）
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
interface ApiHistoryItem { id: string; ts: string; method: string; url: string; status: number; elapsed: number; headers?: ApiHeader[]; body?: string; streamMode?: boolean; response?: ApiResponse; streamResponse?: string; source?: "agent" | "human"; agent?: string; }

// ── Constants ──

// Chat scroll cache — crewId → scrollTop（FileViewer scroll cache 同款）
// 切換 agent tab 時 remount（key={activeCrew}）會丟失捲動位置，用 cache 還原
const _chatScrollCache = new Map<string, number>();
// 效能：空陣列模組級身分（inline [] 每鍵新建 → agentToolLog 身分變 → 打爆 ChatMessages memo）
const EMPTY_TOOL_LOG: Array<{ name: string; args: string; result: string }> = [];
// 2026-10-03：檔案樹 onOpenInBriefingPlayer 佔位 — 模組級常數避免每次 render 新身分打爆 memo
const TREE_NOOP = () => {};
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
            <textarea ref={(isActive ? textareaRef : undefined) as React.Ref<HTMLTextAreaElement>} value={tabData.content} onChange={e => handleContentChange(e.target.value)}
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

function highlightMatch(text: string, query: string, caseSensitive: boolean): React.ReactNode {
  if (!query) return text;
  try {
    const flags = caseSensitive ? "g" : "gi";
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, flags)); // nosemgrep: detect-non-literal-regexp — escaped 已全量跳脫（L4254）
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 text-stone-900 rounded px-0.5">{part}</mark>
        : part
    );
  } catch {
    return text;
  }
}


export type { ApiHeader, ApiHistoryItem, ApiResponse, BlameLine, ChatMessage, CodingEvent, FsItem, GitCommit, GitFileStatus, MainTab, MainTabType, OpenTab };
export { CREW_TO_AGENT, EMPTY_TOOL_LOG, EditorTabContent, TREE_NOOP, ToolLogRow, _chatScrollCache, crewToAgentId, escapeHtml, fmtTime, getFileIcon, getHljsLang, getLanguage, highlightMatch, safeStr };
