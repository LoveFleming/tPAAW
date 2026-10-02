import { Risk } from "../types";

export function fmtTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString();
}

export function cn(...xs: Array<string | false | null | undefined>) {
    return xs.filter(Boolean).join(" ");
}

/** Cross-platform path basename - handles both / and \ separators */
export function pathBasename(p: string): string {
    return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

/** Cross-platform path split - handles both / and \ separators */
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
