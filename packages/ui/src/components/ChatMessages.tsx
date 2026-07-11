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

export interface ChatToolBadge {
  name: string;
  status?: "running" | "done" | "error";
}

export interface ChatMessageItem {
  role: "user" | "assistant" | "system";
  content: string;
  ts?: string;
  timestamp?: number;
  _thinking?: boolean;
  _thinkingHistory?: string[];
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
}

// ── Helpers ──

function formatTime(ts?: string, timestamp?: number): string {
  const date = ts ? new Date(ts) : timestamp ? new Date(timestamp) : null;
  if (!date) return "";
  return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

// ── Markdown Components ──

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
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: "0ms" }} />
        <span className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: "150ms" }} />
        <span className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: "300ms" }} />
      </div>
      <span className="text-xs font-medium" style={{ color }}>{label}</span>
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
  activeTools = [],
  userMarkdown = false,
  onDeepLink,
  endRef,
  className = "",
}) => {
  const mdComponents = markdownComponents(accent, onDeepLink);

  return (
    <div className={`w-full px-4 py-4 space-y-3 ${className}`}>
      {messages.map((msg, i) => {
        const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
        return (
          <div key={i} className="flex justify-start">
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
                <div className={`px-4 py-3 text-sm leading-relaxed rounded-2xl ${
                  msg.role === "assistant"
                    ? "bg-white shadow-sm border border-stone-100 text-stone-700"
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                          {msg.content}
                        </ReactMarkdown>
                      ) : (
                        <LoadingIndicator accent={accent} />
                      )}
                      {loading && isLastAssistant && activeTools.length > 0 && (
                        <ToolBadges tools={activeTools} />
                      )}
                    </div>
                  ) : userMarkdown ? (
                    <div className="prose prose-stone prose-sm max-w-none prose-p:my-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Loading indicator (when no streaming content yet) */}
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
              <LoadingIndicator accent={accent} />
            </div>
          </div>
        </div>
      )}

      {endRef && <div ref={endRef} />}
    </div>
  );
};

export default ChatMessages;
