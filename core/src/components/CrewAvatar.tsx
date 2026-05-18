import React from "react";

const COLORS: Record<string, { bg: string; fg: string; accent: string }> = {
    "ai.spec": { bg: "#FEF3C7", fg: "#92400E", accent: "#F59E0B" },
    "ai.api": { bg: "#DBEAFE", fg: "#1E40AF", accent: "#3B82F6" },
    "ai.contract": { bg: "#D1FAE5", fg: "#065F46", accent: "#10B981" },
    "ai.unit": { bg: "#E0E7FF", fg: "#3730A3", accent: "#6366F1" },
    "ai.coverage": { bg: "#FCE7F3", fg: "#9D174D", accent: "#EC4899" },
    "ai.e2e": { bg: "#FEE2E2", fg: "#991B1B", accent: "#EF4444" },
    "ai.runbook": { bg: "#CCFBF1", fg: "#134E4A", accent: "#14B8A6" },
    "ai.flow": { bg: "#E9D5FF", fg: "#6B21A8", accent: "#A855F7" },
    "ai.rca": { bg: "#FED7AA", fg: "#9A3412", accent: "#F97316" },
    "ai.gatekeeper": { bg: "#F3F4F6", fg: "#1F2937", accent: "#6B7280" },
    "ai.node-dev": { bg: "#CFFAFE", fg: "#155E75", accent: "#06B6D4" },
};

// SVG path-based icons (no emoji — works on all platforms including Linux)
const SVG_ICONS: Record<string, { path: string; viewBox?: string }> = {
    "ai.spec": { path: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
    "ai.api": { path: "M13 10V3L4 14h7v7l9-11h-7z" },
    "ai.contract": { path: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
    "ai.unit": { path: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" },
    "ai.coverage": { path: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
    "ai.e2e": { path: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    "ai.runbook": { path: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
    "ai.flow": { path: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
    "ai.rca": { path: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" },
    "ai.gatekeeper": { path: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
    "ai.node-dev": { path: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" },
};

const DEFAULT_ICON = { path: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" };

interface AvatarProps {
    crewId: string;
    codename: string;
    size?: number;
}

export default function CrewAvatar({ crewId, codename, size = 120 }: AvatarProps) {
    const color = COLORS[crewId] ?? { bg: "#F3F4F6", fg: "#1F2937", accent: "#6B7280" };
    const icon = SVG_ICONS[crewId] ?? DEFAULT_ICON;
    const initial = codename.charAt(0).toUpperCase();

    return (
        <svg width={size} height={size} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
            {/* Background circle */}
            <circle cx="60" cy="60" r="58" fill={color.bg} stroke={color.accent} strokeWidth="2" />
            {/* Inner pattern - tech grid */}
            <circle cx="60" cy="60" r="45" fill="none" stroke={color.accent} strokeWidth="0.5" opacity="0.3" />
            <circle cx="60" cy="60" r="30" fill="none" stroke={color.accent} strokeWidth="0.5" opacity="0.2" />
            {/* Icon (SVG path — works everywhere) */}
            <g transform="translate(30, 18) scale(2.5)">
                <path
                    d={icon.path}
                    fill="none"
                    stroke={color.fg}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </g>
            {/* Codename initial */}
            <text x="60" y="90" textAnchor="middle" dominantBaseline="middle"
                fontSize="14" fontWeight="bold" fill={color.fg} fontFamily="monospace">
                {codename}
            </text>
            {/* Accent dot */}
            <circle cx="95" cy="25" r="8" fill={color.accent} />
            <text x="95" y="28" textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="white" fontWeight="bold">
                {initial}
            </text>
        </svg>
    );
}
