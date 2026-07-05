/**
 * BrowserDevTools — Mini DevTools panel for BrowserPreview
 *
 * Tabs:
 * - Console: shows intercepted console.log/error/warn/info
 * - Network: shows fetch/XHR requests (limited via postMessage)
 * - Info: shows iframe status and metadata
 *
 * Designed to sit below the BrowserPreview iframe.
 */
import React, { useState, useRef, useEffect } from "react";

// ── Types ──

export interface ConsoleEntry {
  method: string;
  args: string[];
  timestamp: number;
  source?: string;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  duration?: number;
  timestamp: number;
}

interface BrowserDevToolsProps {
  consoleLogs: ConsoleEntry[];
  networkLogs?: NetworkEntry[];
  iframeUrl?: string;
  onClearConsole?: () => void;
}

// ── Method colors ──

const METHOD_STYLES: Record<string, { color: string; bg: string; icon: string }> = {
  log:   { color: "text-stone-600",  bg: "",           icon: "📋" },
  info:  { color: "text-blue-600",   bg: "bg-blue-25", icon: "ℹ️" },
  warn:  { color: "text-amber-600",  bg: "bg-amber-25", icon: "⚠️" },
  error: { color: "text-red-600",    bg: "bg-red-25",  icon: "❌" },
  debug: { color: "text-purple-600", bg: "",           icon: "🐛" },
};

// ── Component ──

export default function BrowserDevTools({
  consoleLogs,
  networkLogs = [],
  iframeUrl,
  onClearConsole,
}: BrowserDevToolsProps) {
  const [tab, setTab] = useState<"console" | "network" | "info">("console");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [consoleLogs, autoScroll]);

  const errorCount = consoleLogs.filter(l => l.method === "error").length;
  const warnCount = consoleLogs.filter(l => l.method === "warn").length;

  // ── Render ──

  return (
    <div className="flex flex-col border-t border-stone-300 bg-white select-none" style={{ height: 160 }}>
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-stone-200 bg-stone-50 shrink-0">
        <button
          onClick={() => setTab("console")}
          className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
            tab === "console" ? "bg-stone-200 text-stone-700" : "text-stone-400 hover:bg-stone-100"
          }`}
        >
          📋 Console
          {consoleLogs.length > 0 && (
            <span className="ml-1 text-[9px] text-stone-400">({consoleLogs.length})</span>
          )}
          {errorCount > 0 && <span className="ml-1 text-[9px] text-red-500 font-bold">{errorCount}</span>}
          {warnCount > 0 && <span className="ml-1 text-[9px] text-amber-500 font-bold">{warnCount}</span>}
        </button>

        <button
          onClick={() => setTab("network")}
          className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
            tab === "network" ? "bg-stone-200 text-stone-700" : "text-stone-400 hover:bg-stone-100"
          }`}
        >
          🌐 Network
          {networkLogs.length > 0 && (
            <span className="ml-1 text-[9px] text-stone-400">({networkLogs.length})</span>
          )}
        </button>

        <button
          onClick={() => setTab("info")}
          className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
            tab === "info" ? "bg-stone-200 text-stone-700" : "text-stone-400 hover:bg-stone-100"
          }`}
        >
          ℹ️ Info
        </button>

        <div className="flex-1" />

        {/* Console actions */}
        {tab === "console" && (
          <>
            <label className="flex items-center gap-1 text-[9px] text-stone-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
                className="w-2.5 h-2.5"
              />
              Auto-scroll
            </label>
            {onClearConsole && (
              <button
                onClick={onClearConsole}
                className="text-[10px] px-1.5 py-0.5 rounded text-stone-400 hover:bg-stone-200 hover:text-stone-600"
                title="Clear console"
              >
                🗑️ Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>

        {/* ── Console Tab ── */}
        {tab === "console" && (
          <div className="font-mono text-[11px]">
            {consoleLogs.length === 0 ? (
              <div className="px-3 py-4 text-center text-stone-300 text-[11px]">
                No console output.
                <br />
                <span className="text-[10px]">Console.log from the iframe will appear here.</span>
              </div>
            ) : (
              consoleLogs.map((log, i) => {
                const style = METHOD_STYLES[log.method] || METHOD_STYLES.log;
                const time = new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false });
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-1.5 px-2 py-0.5 border-b border-stone-50 ${style.bg}`}
                  >
                    <span className="text-[9px] text-stone-300 shrink-0 mt-0.5">{time}</span>
                    <span className="text-[10px] shrink-0 mt-0.5">{style.icon}</span>
                    <span className={`flex-1 break-all ${style.color}`}>
                      {log.args.join(" ")}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Network Tab ── */}
        {tab === "network" && (
          <div className="font-mono text-[11px]">
            {networkLogs.length === 0 ? (
              <div className="px-3 py-4 text-center text-stone-300 text-[11px]">
                No network requests captured.
                <br />
                <span className="text-[10px]">Fetch/XHR from the iframe will appear here.</span>
              </div>
            ) : (
              networkLogs.map((req, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-0.5 border-b border-stone-50">
                  <span
                    className={`text-[9px] px-1 rounded font-bold shrink-0 ${
                      req.status && req.status < 300
                        ? "bg-green-100 text-green-600"
                        : req.status && req.status < 400
                        ? "bg-amber-100 text-amber-600"
                        : "bg-red-100 text-red-600"
                    }`}
                  >
                    {req.status || "—"}
                  </span>
                  <span className="text-[9px] text-stone-400 shrink-0">{req.method}</span>
                  <span className="flex-1 truncate text-stone-600">{req.url}</span>
                  {req.duration != null && (
                    <span className="text-[9px] text-stone-300 shrink-0">{req.duration}ms</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Info Tab ── */}
        {tab === "info" && (
          <div className="px-3 py-2 text-[11px] text-stone-600 space-y-1">
            <div>
              <span className="text-stone-400">URL:</span>{" "}
              <span className="font-mono">{iframeUrl || "(not loaded)"}</span>
            </div>
            <div>
              <span className="text-stone-400">Console entries:</span> {consoleLogs.length}
            </div>
            <div>
              <span className="text-stone-400">Network requests:</span> {networkLogs.length}
            </div>
            <div className="pt-2 text-[10px] text-stone-400">
              <div className="font-semibold mb-1">💡 How console interception works:</div>
              <div>The iframe page needs to postMessage its console output to the parent window.</div>
              <div className="mt-1">For your own dev server, add this script to intercept:</div>
              <pre className="mt-1 p-2 bg-stone-100 rounded text-[10px] overflow-x-auto">{`<script>
['log','error','warn','info'].forEach(m => {
  const orig = console[m];
  console[m] = (...args) => {
    orig(...args);
    parent.postMessage({
      type: 'console', method: m,
      args: args.map(String)
    }, '*');
  };
});
</script>`}</pre>
              </div>
          </div>
        )}
      </div>
    </div>
  );
}
