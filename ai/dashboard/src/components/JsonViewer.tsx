import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { cn } from "../utils";
import { useTheme } from "../theme";

// ── Types ──
type JsonValue = string | number | boolean | null | object | unknown[];

// ── Helpers ──
function getType(v: unknown): "string" | "number" | "boolean" | "null" | "object" | "array" {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v as "string" | "number" | "boolean" | "object";
}

function getChildCount(v: unknown): number | undefined {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") return Object.keys(v as object).length;
  return undefined;
}

function isExpandable(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v as object).length > 0;
  return false;
}

function truncate(str: string, max = 300): { text: string; truncated: boolean } {
  if (str.length <= max) return { text: str, truncated: false };
  return { text: str.slice(0, max) + "…", truncated: true };
}

function matchesSearch(value: unknown, query: string): boolean {
  const lq = query.toLowerCase();
  if (typeof value === "string") return value.toLowerCase().includes(lq);
  if (typeof value === "number" || typeof value === "boolean") return String(value).toLowerCase().includes(lq);
  return false;
}

function findMatchingPaths(obj: unknown, query: string, prefix = "$"): Set<string> {
  const paths = new Set<string>();
  if (!query) return paths;
  const lq = query.toLowerCase();

  function walk(v: unknown, path: string) {
    if (typeof v === "object" && v !== null) {
      const entries = Array.isArray(v)
        ? v.map((val, i) => [String(i), val] as [string, unknown])
        : Object.entries(v as Record<string, unknown>);
      for (const [k, val] of entries) {
        const childPath = `${path}.${k}`;
        if (k.toLowerCase().includes(lq)) paths.add(path);
        if (matchesSearch(val, lq)) paths.add(path);
        walk(val, childPath);
      }
    }
  }
  walk(obj, prefix);
  return paths;
}

function expandableEntries(data: unknown): [string, unknown][] {
  if (Array.isArray(data)) return data.map((v, i) => [String(i), v]);
  if (data && typeof data === "object") return Object.entries(data as Record<string, unknown>);
  return [];
}

// ── Type Badge (theme-aware) ──
function TypeBadge({ type, count }: { type: string; count?: number }) {
  const { info: t } = useTheme();
  const badgeMap: Record<string, string> = {
    string: t.badgeString,
    number: t.badgeNumber,
    boolean: t.badgeBoolean,
    null: t.badgeNull,
    object: t.badgeObject,
    array: t.badgeArray,
  };
  const labels: Record<string, string> = {
    string: "str", number: "num", boolean: "bool", null: "null",
    object: count !== undefined ? `{${count}}` : "obj",
    array: count !== undefined ? `[${count}]` : "arr",
  };
  return (
    <span className={cn("inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-medium border leading-none", badgeMap[type] ?? t.badgeNull)}>
      {labels[type] ?? type}
    </span>
  );
}

// ── Copy Button ──
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { info: t } = useTheme();
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-stone-200/80 transition-all"
      title={label ?? "Copy"}
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-emerald-500">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-stone-400">
          <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
          <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
        </svg>
      )}
    </button>
  );
}

// ── Value Renderer (theme-aware syntax colors) ──
function ValueDisplay({ value, type, highlighted }: { value: JsonValue; type: string; highlighted?: boolean }) {
  const { info: t } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const hl = highlighted ? "bg-yellow-200/60 rounded px-0.5" : "";

  if (type === "string") {
    const str = value as string;
    const { text, truncated } = truncate(str, expanded ? 99999 : 300);
    return (
      <span className={cn(hl)}>
        <span className={cn(t.syntaxString)}>\"{text}\"</span>
        {truncated && (
          <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="ml-1 text-[10px] hover:underline" style={{ color: t.accent }}>
            {expanded ? "show less" : "show more"}
          </button>
        )}
      </span>
    );
  }
  if (type === "number") return <span className={cn(t.syntaxNumber, hl)}>{String(value)}</span>;
  if (type === "boolean") return <span className={cn(t.syntaxBoolean, "font-medium", hl)}>{String(value)}</span>;
  if (type === "null") return <span className="text-stone-400 italic">null</span>;
  return null;
}

// ── Row Component ──
const JsonRow = React.memo(function JsonRow({
  keyName, value, depth, path, expanded, onToggle, searchQuery,
}: {
  keyName: string; value: unknown; depth: number; path: string;
  expanded: boolean; onToggle: (path: string) => void; searchQuery: string;
}) {
  const { info: t } = useTheme();
  const type = getType(value);
  const childCount = getChildCount(value);
  const expandable = isExpandable(value);
  const keyHighlighted = !!(searchQuery && keyName.toLowerCase().includes(searchQuery.toLowerCase()));
  const valueHighlighted = !!(searchQuery && matchesSearch(value, searchQuery));
  const valueJson = useMemo(() => {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }, [value]);

  return (
    <div className="group" style={{ paddingLeft: `${depth * 16}px` }}>
      <div
        className={cn("flex items-start gap-1.5 py-[3px] px-2 rounded-sm cursor-pointer transition-colors text-[13px] font-mono leading-relaxed")}
        onClick={() => expandable && onToggle(path)}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = t.accentBg)}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "")}
      >
        {expandable ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
            className={cn("w-3 h-3 mt-[5px] shrink-0 transition-transform duration-150", expanded ? "" : "-rotate-90")}
            style={{ color: t.accent }}
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {keyName && (
          <span className={cn("shrink-0", t.syntaxKey, keyHighlighted && "bg-yellow-200/60 rounded px-0.5")}>
            {keyName}
            <span className="text-stone-300">: </span>
          </span>
        )}

        {!expandable ? (
          <span className="min-w-0 break-all">
            <ValueDisplay value={value as JsonValue} type={type} highlighted={valueHighlighted} />
          </span>
        ) : expanded ? (
          <span className="text-stone-400 text-[11px]">{type === "array" ? "Array" : "Object"}</span>
        ) : (
          <span className="text-stone-400 text-[11px] truncate">
            {type === "array" ? `[${childCount ?? 0} items]` : `{${childCount ?? 0} props}`}
          </span>
        )}

        <TypeBadge type={type} count={childCount} />
        <CopyButton value={valueJson} label="Copy value" />
      </div>
    </div>
  );
});

// ── Recursive Tree Renderer ──
function JsonTree({
  data, keyName, depth, path, expandedSet, onToggle, searchQuery,
}: {
  data: unknown; keyName: string; depth: number; path: string;
  expandedSet: Set<string>; onToggle: (path: string) => void; searchQuery: string;
}) {
  const isExpanded = expandedSet.has(path);
  return (
    <div>
      <JsonRow keyName={keyName} value={data} depth={depth} path={path}
        expanded={isExpanded} onToggle={onToggle} searchQuery={searchQuery} />
      {isExpanded && expandableEntries(data).map(([k, v]) => (
        <JsonTree key={k} data={v} keyName={k} depth={depth + 1}
          path={`${path}.${k}`} expandedSet={expandedSet} onToggle={onToggle} searchQuery={searchQuery} />
      ))}
    </div>
  );
}

// ── Main Component ──
interface JsonViewerProps {
  data: unknown;
  title?: string;
  compact?: boolean;
  readOnly?: boolean;
}

export default function JsonViewer({ data, title, compact = false, readOnly = false }: JsonViewerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set(["$"]));
  const { info: t } = useTheme();

  const allPaths = useMemo(() => {
    const paths = new Set<string>();
    function walk(v: unknown, p: string) {
      paths.add(p);
      if (typeof v === "object" && v !== null) {
        const entries = Array.isArray(v)
          ? v.map((val, i) => [String(i), val] as [string, unknown])
          : Object.entries(v as Record<string, unknown>);
        for (const [k, val] of entries) walk(val, `${p}.${k}`);
      }
    }
    walk(data, "$");
    return paths;
  }, [data]);

  useEffect(() => {
    if (!searchQuery) return;
    const matching = findMatchingPaths(data, searchQuery);
    setExpandedSet(prev => {
      const next = new Set(prev);
      for (const p of matching) next.add(p);
      return next;
    });
  }, [searchQuery, data]);

  const handleToggle = useCallback((path: string) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const fullJson = useMemo(() => {
    try { return JSON.stringify(data, null, 2); } catch { return String(data); }
  }, [data]);

  if (data === null || data === undefined) {
    return (
      <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
        <span className="italic">null or empty data</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
        {/* Search */}
        <div className="flex-1 relative max-w-xs">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
          </svg>
          <input
            type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search keys & values…"
            className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-lg text-stone-700 placeholder-stone-400 focus:outline-none focus:ring-1"
            style={{ backgroundColor: "white", borderColor: t.accentBorder, ...(searchQuery ? { boxShadow: `0 0 0 1px ${t.accent}` } : {}) }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setExpandedSet(new Set(allPaths))}
            className="text-[11px] px-2.5 py-1 rounded-md border transition-colors"
            style={{ borderColor: t.accentBorder, color: t.accentText, backgroundColor: "white" }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accentLight; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "white"; }}
          >
            Expand All
          </button>
          <button onClick={() => setExpandedSet(new Set(["$"]))}
            className="text-[11px] px-2.5 py-1 rounded-md border transition-colors"
            style={{ borderColor: t.accentBorder, color: t.accentText, backgroundColor: "white" }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accentLight; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "white"; }}
          >
            Collapse
          </button>
          <CopyButton value={fullJson} label="Copy JSON" />
        </div>
      </div>

      {/* Tree */}
      <div className={cn("flex-1 overflow-auto", compact ? "p-2" : "p-4")} style={{ scrollbarWidth: "thin" }}>
        <div className="font-mono text-[13px] leading-relaxed">
          <JsonTree data={data} keyName="" depth={0} path="$"
            expandedSet={expandedSet} onToggle={handleToggle} searchQuery={searchQuery} />
        </div>
      </div>
    </div>
  );
}
