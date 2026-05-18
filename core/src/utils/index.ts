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
