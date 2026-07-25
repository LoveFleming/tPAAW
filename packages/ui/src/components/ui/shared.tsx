import React, { useState } from "react";
import { cn, badgeClasses } from "../../utils";
import { Risk } from "../../types";
import Icon from "../Icon";

export { cn };

export function Card({
    title,
    children,
    right,
    className,
    style,
}: {
    title?: React.ReactNode;
    children: React.ReactNode;
    right?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}) {
    return (
        <div className={cn("bg-white p-4 shadow-sm border border-zinc-200", className)} style={style}>
            {title && (
                <div className="mb-3 flex items-center justify-between gap-3 title">
                    <div className="text-lg font-normal text-stone-800">{title}</div>
                    {right}
                </div>
            )}
            {children}
        </div>
    );
}

export function RiskBadge({ risk }: { risk: Risk }) {
    return (
        <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs", badgeClasses(risk))}>
            <span className="inline-block h-2 w-2 rounded-full bg-current opacity-60" />
            {risk}
        </span>
    );
}

export function CodeBlock({ text }: { text: string }) {
    return (
        <pre className="overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-950 p-3 font-mono text-xs text-zinc-100">
            {text}
        </pre>
    );
}

// ── Nav Icon helper ──
// Match by page-type suffix so i18n label changes don't break icon lookup
const NAV_EMOJI_PATTERNS: { match: RegExp; emoji: string }[] = [
    { match: /constitution|憲法/i, emoji: "📜" },
    { match: /standards|規範|基準/i, emoji: "📏" },
    { match: /crew|成員|チーム/i, emoji: "👥" },
    { match: /skill.*pool|技能池/i, emoji: "✨" },
    { match: /skill.*builder|技能建構|スキルビルダ/i, emoji: "🧠" },
    { match: /skill/i, emoji: "✨" },
    { match: /app.*builder|app builder/i, emoji: "🚀" },
    { match: /app.*pool|應用程式池|^apps$|^app$/i, emoji: "📊" },
    { match: /report.*lab|報告實驗/i, emoji: "🧪" },
    { match: /workflow.*builder|workflow.*editor|工作流.*建/i, emoji: "📋" },
    { match: /workflow|工作流|ワークフロー/i, emoji: "🔄" },
    { match: /cron|schedul|定期実行|排程/i, emoji: "⏰" },
    { match: /coding|程式|コーディング/i, emoji: "⚡" },
    { match: /prompts|提示詞/i, emoji: "💻" },
    { match: /backup|備份|バックアップ/i, emoji: "🛡️" },
    { match: /work.*sync/i, emoji: "🔄" },
    { match: /ai.*settings|AI 設定/i, emoji: "⚙️" },
    { match: /briefing|簡報/i, emoji: "🎤" },
    { match: /mind.*map|心智圖/i, emoji: "🗺️" },
    { match: /notes|筆記|ノート/i, emoji: "📓" },
    { match: /projects|專案|プロジェクト/i, emoji: "📋" },
    { match: /helpdesk|客服/i, emoji: "🎧" },
    { match: /llm.*log/i, emoji: "📡" },
];

function findEmoji(label: string): string | undefined {
    for (const { match, emoji } of NAV_EMOJI_PATTERNS) {
        if (match.test(label)) return emoji;
    }
    return undefined;
}

export function SidebarSection({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="mt-1">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex w-full items-center px-4 py-2 text-[13px] font-bold uppercase tracking-wider text-stone-500 hover:text-stone-700 transition-colors"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={cn("w-3 h-3 mr-2 transition-transform", isOpen ? "" : "-rotate-90")}
                >
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
                <span className="flex-1 text-left">{title}</span>
                {right}
            </button>
            {isOpen && <div className="pb-1">{children}</div>}
        </div>
    );
}

export function NavItem({
    active,
    label,
    onClick,
    right,
    accentColor = "#f97316",
    accentBg = "#fff7ed",
}: {
    active: boolean;
    label: string;
    onClick: () => void;
    right?: React.ReactNode;
    accentColor?: string;
    accentBg?: string;
}) {
    const emoji = findEmoji(label);

    return (
        <button
            onClick={onClick}
            className={cn(
                "flex w-full items-center justify-between pr-4 py-1.5 text-left text-[15px] transition-colors",
            )}
            style={{
                paddingLeft: active ? "26px" : "28px",
                borderLeft: active ? `3px solid ${accentColor}` : "3px solid transparent",
                backgroundColor: active ? accentBg : undefined,
                color: active ? accentColor : "#78716c",
                fontWeight: active ? 600 : 400,
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.backgroundColor = accentBg; e.currentTarget.style.color = accentColor; } }}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = "#78716c"; } }}
        >
            <div className="flex items-center gap-2.5 min-w-0">
                {emoji && <span className="text-[15px] shrink-0" style={{ width: 16, textAlign: "center" }}>{emoji}</span>}
                <span className="truncate">{label}</span>
            </div>
            {right}
        </button>
    );
}
