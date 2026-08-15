import { Risk, RunStatus } from "../types";

export function nowIso() {
    return new Date().toISOString();
}

export function fmtTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString();
}

export function cn(...xs: Array<string | false | null | undefined>) {
    return xs.filter(Boolean).join(" ");
}

export function shortId(id: string) {
    return id.slice(0, 8);
}

export function safeJsonParse<T>(s: string): T | null {
    try {
        return JSON.parse(s) as T;
    } catch {
        return null;
    }
}

export function randId() {
    return (
        Math.random().toString(16).slice(2) +
        Math.random().toString(16).slice(2) +
        Math.random().toString(16).slice(2)
    ).slice(0, 24);
}

export function badgeClasses(risk: Risk) {
    if (risk === "safe") return "border-green-200 bg-green-50 text-green-700";
    if (risk === "guarded") return "border-amber-200 bg-amber-50 text-amber-800";
    return "border-red-200 bg-red-50 text-red-700";
}

export function statusClasses(s: RunStatus) {
    if (s === "success") return "bg-green-100 text-green-700";
    if (s === "failed") return "bg-red-100 text-red-700";
    if (s === "running") return "bg-blue-100 text-blue-700";
    return "bg-amber-100 text-amber-700";
}

/** Cross-platform path basename - handles both / and \ separators */
export function pathBasename(p: string): string {
    return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

/** Cross-platform path split - handles both / and \ separators */
export function pathSplit(p: string): string[] {
    return p.split(/[\\/]/).filter(Boolean);
}

/** Check if a path starts with a given prefix, handling both / and \ separators */
export function pathStartsWith(p: string, prefix: string): boolean {
    return p.startsWith(prefix + "/") || p.startsWith(prefix + "\\") || p === prefix;
}

/** Get the relative portion after the prefix, stripping leading separator */
export function pathRelative(p: string, prefix: string): string {
    if (p.startsWith(prefix + "/")) return p.slice(prefix.length + 1);
    if (p.startsWith(prefix + "\\")) return p.slice(prefix.length + 1);
    if (p === prefix) return "";
    return p;
}

/**
 * 聊天時間戳顯示（跨日規則）：
 *   當日  → 上午10:30（跟舊行為一致）
 *   昨天  → 昨天 上午10:30
 *   更早  → 8/14 上午10:30（當年）
 *   跨年  → 2025/12/31 上午10:30
 * 所有 AI 聊天視窗統一用這個，不要再各自 toLocaleTimeString。
 */
export function fmtChatTime(input?: string | number | Date): string {
    if (input === undefined || input === null || input === "") return "";
    const date = input instanceof Date ? input : new Date(input);
    if (isNaN(date.getTime())) return "";
    const now = new Date();
    const time = date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
    if (sameDay) return time;
    const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (
        date.getFullYear() === yest.getFullYear() &&
        date.getMonth() === yest.getMonth() &&
        date.getDate() === yest.getDate()
    ) {
        return `昨天 ${time}`;
    }
    if (date.getFullYear() !== now.getFullYear()) {
        return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${time}`;
    }
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}
