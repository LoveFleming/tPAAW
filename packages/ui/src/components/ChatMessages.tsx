/**
 * ChatMessages — Reusable chat message list component
 *
 * Features:
 *   - Markdown rendering (ReactMarkdown + remark-gfm)
 *   - Avatar (photo URL or emoji fallback)
 *   - Name + timestamp header
 *   - Bubbles: assistant = white card, user = stone-50
 *   - Loading indicator (bouncing dots + "思考中")
 *   - Tool badges (running/done/error)
 *   - All content left-aligned (matches PAAW ChatView style)
 *
 * Used by: ChatView (林雨晴), CodingIDE (AI agents)
 */

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { fmtChatTime } from "../utils";
import API_BASE from "../api";

export interface ChatToolBadge {
  name: string;
  status?: "running" | "done" | "error";
}

export interface ChatMessageItem {
  role: "user" | "assistant" | "system" | string;
  content: string;
  ts?: string;
  timestamp?: number;
  _thinking?: boolean;
  _thinkingHistory?: string[];
  [k: string]: any;
}

export interface AssignableAgent {
  id: string;
  emoji?: string;
  title: string;
}

export interface ChatMessagesProps {
  messages: ChatMessageItem[];
  /** Accent color for avatars, buttons, etc. */
  accent?: string;
  /** Accent hover color for gradients */
  accentHover?: string;
  /** Assistant display name */
  assistantName?: string;
  /** User display name */
  userName?: string;
  /** Assistant avatar image URL (full or relative) */
  assistantAvatar?: string;
  /** Assistant emoji fallback (if no avatar) */
  assistantEmoji?: string;
  /** Whether AI is currently loading/thinking */
  loading?: boolean;
  /** Active tool badges to show */
  activeTools?: ChatToolBadge[];
  agentAction?: string; // current action label for typing indicator
  /** Render markdown in user messages too? (default: false, plain text) */
  userMarkdown?: boolean;
  /** Custom link handler */
  onLinkClick?: (href: string, e: React.MouseEvent) => void;
  /** Custom deep link handler for notes/apps */
  onDeepLink?: (type: string, params: Record<string, string>) => void;
  /** Ref for the scroll-to-bottom element */
  endRef?: React.RefObject<HTMLDivElement>;
  /** Additional class name for the container */
  className?: string;
  /** Agents that can be assigned via right-click */
  assignableAgents?: AssignableAgent[];
  /** Called when user right-clicks a message and picks an agent */
  onAssignToAgent?: (agentId: string, messageContent: string) => void;
}

// ── Helpers ──

function formatTime(ts?: string, timestamp?: number): string {
  if (ts) return fmtChatTime(ts);
  if (timestamp) return fmtChatTime(timestamp);
  return "";
}

// ── Markdown Components ──

// 效能：預設參數陣列必須是模組級身分（inline [] 每次新建 → 打爆 handleMessageContextMenu
// 的 useCallback → onContextMenu prop 變 → 所有 MessageRow memo 失效 → 每鍵全列 markdown 重 parse）
const EMPTY_TOOLS: ChatToolBadge[] = [];
const EMPTY_AGENTS: AssignableAgent[] = [];

const markdownComponents = (accent?: string, onDeepLink?: (type: string, params: Record<string, string>) => void) => ({
  a: ({ node, href, ...props }: any) => {
    // 攔截筆記 deep link
    if (href && href.startsWith("#/notes") && onDeepLink) {
      try {
        const u = new URL("http://dummy" + href.slice(1));
        const params: Record<string, string> = {};
        u.searchParams.forEach((v: string, k: string) => { params[k] = v; });
        return <a {...props} href={href} onClick={(e) => { e.preventDefault(); onDeepLink("notes", params); }} style={{ color: "inherit", textDecoration: "underline", cursor: "pointer" }} />;
      } catch { /* fallback */ }
    }
    // 攔截 App deep link
    if (href && href.startsWith("#/app:") && onDeepLink) {
      const appId = href.slice(6);
      return <a {...props} href={href} onClick={(e) => { e.preventDefault(); onDeepLink("app", { id: appId }); }} style={{ color: accent, textDecoration: "underline", cursor: "pointer", fontWeight: 500 }} />;
    }
    return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
  },
});

// ── Avatar ──

function ChatAvatar({
  role,
  assistantAvatar,
  assistantEmoji,
  accent,
  accentHover,
  userName = "你",
}: {
  role: string;
  assistantAvatar?: string;
  assistantEmoji?: string;
  accent?: string;
  accentHover?: string;
  userName?: string;
}) {
  if (role === "assistant") {
    if (assistantAvatar) {
      return <img src={assistantAvatar} className="w-8 h-8 rounded-full object-cover" alt="" />;
    }
    return (
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
        style={{ backgroundColor: (accent || "#10b981") + "22", border: `1px solid ${(accent || "#10b981")}33` }}>
        {assistantEmoji || "🤖"}
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
      style={{ background: `linear-gradient(135deg, ${accent || "#10b981"}, ${accentHover || accent || "#10b981"})` }}>
      {userName}
    </div>
  );
}

// ── Loading Indicator ──

function LoadingIndicator({ accent, label = "思考中" }: { accent?: string; label?: string }) {
  const color = accent || "#10b981";
  const isThinking = label.includes("思考") || label.includes("thinking") || label.includes("規劃") || label === "思考中";
  return (
    <div className="flex items-center gap-2 py-2">
      {isThinking ? (
        // 思考中：3 bouncing dots + 較淡的文字
        <div className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color, animationDelay: "0ms" }} />
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color, animationDelay: "200ms" }} />
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color, animationDelay: "400ms" }} />
        </div>
      ) : (
        // 執行指令：spinning icon + 醒目文字
        <span className="w-3.5 h-3.5 border-[2px] border-current border-t-transparent rounded-full animate-spin" style={{ borderColor: color, borderTopColor: "transparent" }} />
      )}
      <span className={`text-xs font-medium ${isThinking ? "opacity-70" : ""}`} style={{ color }}>{label}</span>
    </div>
  );
}

// ── Tool Badges ──

function ToolBadges({ tools }: { tools: ChatToolBadge[] }) {
  if (!tools.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-stone-100">
      {tools.map((tool, i) => (
        <div key={i} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
          tool.status === "running" ? "bg-amber-50 text-amber-600 border border-amber-200" :
          tool.status === "done" ? "bg-emerald-50 text-emerald-600 border border-emerald-200" :
          tool.status === "error" ? "bg-rose-50 text-rose-600 border border-rose-200" :
          "bg-stone-50 text-stone-600 border border-stone-200"
        }`}>
          {tool.status === "running" && <span className="w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" />}
          {tool.status === "done" && <span>✅</span>}
          {tool.status === "error" && <span>❌</span>}
          <span>{tool.name}</span>
        </div>
      ))}
    </div>
  );
}

// ── MessageRow — memo 化：串流 chunk 只重繪正在長大的訊息，歷史訊息全部跳過 ──
// （沒有 memo 時每個 SSE chunk 都重跑全部歷史訊息的 react-markdown parse → 掉帧+高度跳動）
const MessageRow = React.memo(function MessageRow({
  msg, isLastAssistant, assistantName, userName, assistantAvatar, assistantEmoji,
  accent, accentHover, userMarkdown, loading, activeTools, mdComponents, onContextMenu,
}: {
  msg: ChatMessageItem;
  isLastAssistant: boolean;
  assistantName: string; userName: string;
  assistantAvatar?: string; assistantEmoji?: string;
  accent?: string; accentHover?: string;
  userMarkdown?: boolean;
  loading?: boolean;
  activeTools: ChatToolBadge[];
  mdComponents: Record<string, any>;
  onContextMenu: (e: React.MouseEvent, msg: ChatMessageItem) => void;
}) {
  return (
    <div className="flex justify-start">
      <div className="flex gap-2.5 max-w-[95%]">
        {/* Avatar */}
        <div className="flex-shrink-0 mt-1">
          <ChatAvatar
            role={msg.role}
            assistantAvatar={assistantAvatar}
            assistantEmoji={assistantEmoji}
            accent={accent}
            accentHover={accentHover}
            userName={userName}
          />
        </div>
        {/* Bubble */}
        <div className="min-w-0">
          {/* Name + time */}
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium text-stone-600">
              {msg.role === "assistant" ? assistantName : userName}
            </span>
            {(msg.ts || msg.timestamp) && (
              <span className="text-[10px] text-stone-300">
                {formatTime(msg.ts, msg.timestamp)}
              </span>
            )}
          </div>
          {/* Content */}
          <div
            onContextMenu={(e) => onContextMenu(e, msg)}
            className={`px-4 py-3 text-sm leading-relaxed rounded-2xl ${
            msg.role === "assistant"
              ? msg._thinking
                ? "bg-stone-50 border border-stone-200 text-stone-500 italic"
                : "bg-white shadow-sm border border-stone-100 text-stone-700"
              : "bg-stone-50 text-stone-700"
          }`}>
            {/* Thinking history — shown collapsed above the final answer */}
            {msg.role === "assistant" && msg._thinkingHistory && msg._thinkingHistory.length > 0 && !msg._thinking && (
              <details className="mb-2 group">
                <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-500 select-none flex items-center gap-1">
                  <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                  <span>思考過程 ({msg._thinkingHistory.length} 段)</span>
                </summary>
                <div className="mt-1.5 pl-4 border-l-2 border-stone-100 space-y-1.5 max-h-60 overflow-y-auto">
                  {msg._thinkingHistory.map((think, ti) => (
                    <div key={ti} className="text-xs text-stone-400 italic whitespace-pre-wrap">
                      {think.replace(/^💭\s*/, "")}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {msg.role === "assistant" ? (
              <div className="prose prose-stone prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
                {msg.content ? (
                  msg._thinking ? (
                    // Thinking bubble: plain text, no markdown rendering, with subtle pulse
                    <div className="text-xs text-stone-400 whitespace-pre-wrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accent || "#10b981" }} />
                        {msg.content.replace(/^💭\s*/, "")}
                      </span>
                    </div>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>
                      {msg.content}
                    </ReactMarkdown>
                  )
                ) : (
                  <LoadingIndicator accent={accent} />
                )}
                {/* Tool badges only on non-thinking messages */}
                {!msg._thinking && loading && isLastAssistant && activeTools.length > 0 && (
                  <ToolBadges tools={activeTools} />
                )}
              </div>
            ) : (
              <>
                {/* 👁 Vision Phase 2：user 訊息的圖片縮圖（2026-08-30）*/}
                {Array.isArray((msg as any).images) && (msg as any).images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(msg as any).images.map((img: string, ii: number) => (
                      <img key={ii} src={img.startsWith("http") || img.startsWith("/") ? img : `${API_BASE}${img.startsWith("/") ? "" : "/api/"}${img}`} alt="" className="w-36 h-36 object-cover rounded-xl border border-stone-200 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => window.open(img.startsWith("http") || img.startsWith("/") ? img : `${API_BASE}/api/${img}`, "_blank")} />
                    ))}
                  </div>
                )}
                {userMarkdown ? (
                  <div className="prose prose-stone prose-sm max-w-none prose-p:my-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// ── Main Component ──

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  messages,
  accent = "#10b981",
  accentHover,
  assistantName = "AI",
  userName = "你",
  assistantAvatar,
  assistantEmoji,
  loading = false,
  activeTools = EMPTY_TOOLS,
  agentAction = "",
  userMarkdown = false,
  onDeepLink,
  endRef,
  className = "",
  assignableAgents = EMPTY_AGENTS,
  onAssignToAgent,
}) => {
  // 穩定身分：讓 MessageRow 的 memo 不會被每次 render 新建的 function 打破
  const mdComponents = React.useMemo(() => markdownComponents(accent, onDeepLink), [accent, onDeepLink]);

  // ── Right-click context menu state ──
  const [ctxMenu, setCtxMenu] = React.useState<{ x: number; y: number; msg: ChatMessageItem } | null>(null);
  const [showAgentPicker, setShowAgentPicker] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
        setShowAgentPicker(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setCtxMenu(null); setShowAgentPicker(false); }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [ctxMenu]);

  const handleMessageContextMenu = React.useCallback((e: React.MouseEvent, msg: ChatMessageItem) => {
    if (!onAssignToAgent || assignableAgents.length === 0) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, msg });
  }, [onAssignToAgent, assignableAgents]);

  const handlePickAgent = (agentId: string) => {
    if (ctxMenu && onAssignToAgent) {
      // Use mouse-selected text if available, otherwise fall back to full message
      const selection = window.getSelection()?.toString().trim();
      const content = selection || ctxMenu.msg.content;
      onAssignToAgent(agentId, content);
    }
    setCtxMenu(null);
    setShowAgentPicker(false);
  };

  return (
    <div className={`w-full px-4 py-4 space-y-3 ${className}`}>
      {messages.map((msg, i) => (
        <MessageRow
          key={i}
          msg={msg}
          isLastAssistant={msg.role === "assistant" && i === messages.length - 1}
          assistantName={assistantName}
          userName={userName}
          assistantAvatar={assistantAvatar}
          assistantEmoji={assistantEmoji}
          accent={accent}
          accentHover={accentHover}
          userMarkdown={userMarkdown}
          loading={loading}
          activeTools={activeTools}
          mdComponents={mdComponents}
          onContextMenu={handleMessageContextMenu}
        />
      ))}

      {/* Loading indicator — shows typing + current action (like Discord/OpenClaw) */}
      {loading && (
        <div className="flex justify-start">
          <div className="flex gap-2.5">
            <div className="flex-shrink-0 mt-1">
              <ChatAvatar
                role="assistant"
                assistantAvatar={assistantAvatar}
                assistantEmoji={assistantEmoji}
                accent={accent}
                accentHover={accentHover}
              />
            </div>
            <div>
              <span className="text-xs font-medium text-stone-600">{assistantName}</span>
              <LoadingIndicator accent={accent} label={agentAction || "思考中"} />
            </div>
          </div>
        </div>
      )}

      {endRef && <div ref={endRef} />}

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] bg-white rounded-lg shadow-lg border border-stone-200 py-1"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {!showAgentPicker ? (
            <>
              <button
                onClick={() => setShowAgentPicker(true)}
                className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-blue-50 flex items-center gap-2"
              >
                <span>📤</span>
                <span>指派給 Agent...</span>
              </button>
              <button
                onClick={() => {
                  const sel = window.getSelection()?.toString().trim();
                  navigator.clipboard?.writeText(sel || ctxMenu.msg.content);
                  setCtxMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-2"
              >
                <span>📋</span>
                <span>複製文字</span>
              </button>
            </>
          ) : (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold text-stone-400 border-b border-stone-100">
                指派給 Agent
              </div>
              <div className="max-h-60 overflow-y-auto">
                {assignableAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => handlePickAgent(agent.id)}
                    className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-blue-50 flex items-center gap-2"
                  >
                    <span className="text-base">{agent.emoji || "🤖"}</span>
                    <span>{agent.title}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ChatMessages;
