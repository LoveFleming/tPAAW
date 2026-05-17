import React, { useState } from "react";
import { cn, badgeClasses } from "../../utils";
import { Risk } from "../../types";

export { cn };

export function Card({
    title,
    children,
    right,
    className,
}: {
    title?: React.ReactNode;
    children: React.ReactNode;
    right?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("bg-white p-4 shadow-sm border border-zinc-200", className)}>
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
const NAV_ICONS: Record<string, { emoji: string; label: string }> = {
    "Constitution": { emoji: "📜", label: "Constitution" },
    "Standards":    { emoji: "📏", label: "Standards" },
    "AI Crew":      { emoji: "👥", label: "AI Crew" },
};

export function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="mt-1">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex w-full items-center px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400 hover:text-stone-600 transition-colors"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={cn("w-3 h-3 mr-2 transition-transform", isOpen ? "" : "-rotate-90")}
                >
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
                <span>{title}</span>
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
}: {
    active: boolean;
    label: string;
    onClick: () => void;
    right?: React.ReactNode;
}) {
    const iconInfo = NAV_ICONS[label];

    return (
        <button
            onClick={onClick}
            className={cn(
                "flex w-full items-center justify-between pr-4 py-1.5 text-left text-sm transition-colors",
                active
                    ? "bg-orange-50 text-orange-700 font-semibold"
                    : "text-stone-500 hover:text-stone-700 hover:bg-stone-50"
            )}
            style={{ paddingLeft: active ? "38px" : "40px", borderLeft: active ? "3px solid #f97316" : "3px solid transparent" }}
        >
            <div className="flex items-center gap-2.5 min-w-0">
                {iconInfo && <span className="text-xs shrink-0">{iconInfo.emoji}</span>}
                <span className="truncate">{label}</span>
            </div>
            {right}
        </button>
    );
}
