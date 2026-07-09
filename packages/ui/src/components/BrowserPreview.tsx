/**
 * BrowserPreview — IDE-internal browser tab for live testing
 *
 * Features:
 * - URL bar with navigation history (back/forward/reload)
 * - iframe sandbox to embed dev server
 * - Auto-detect dev server port from project config
 * - Console interception via injected script (postMessage)
 * - Open in external browser button
 * - communicates logs up to parent via onConsoleLog callback
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import API_BASE from "../api";

// ── Types ──

interface ConsoleEntry {
  method: string;
  args: string[];
  timestamp: number;
  source?: string;
}

interface BrowserPreviewProps {
  projectRoot: string;
  onConsoleLog?: (entry: ConsoleEntry) => void;
  initialUrl?: string;
}

// ── Common dev server ports to try ──

const COMMON_PORTS = [
  { port: 5173, label: "Vite" },
  { port: 3000, label: "Next.js / React" },
  { port: 4097, label: "PAAW API" },
  { port: 4100, label: "Agent Orchestrator" },
  { port: 8080, label: "HTTP Server" },
  { port: 3001, label: "Alt React" },
  { port: 4200, label: "Angular" },
];

// ── Component ──

export default function BrowserPreview({ projectRoot, onConsoleLog, initialUrl }: BrowserPreviewProps) {
  const [url, setUrl] = useState(initialUrl || "");
  const [inputUrl, setInputUrl] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectedPort, setDetectedPort] = useState<number | null>(null);
  const [showPortList, setShowPortList] = useState(false);
  const [portChecks, setPortChecks] = useState<Record<number, boolean>>({});
  const [activePorts, setActivePorts] = useState(COMMON_PORTS);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reloadKey = useRef(0);

  // ── Listen for console messages from iframe ──
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "console" && e.data.method && e.data.args) {
        onConsoleLog?.({
          method: e.data.method,
          args: e.data.args,
          timestamp: Date.now(),
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onConsoleLog]);

  // ── Navigate to URL ──
  const navigate = useCallback((targetUrl: string, pushHistory = true) => {
    let finalUrl = targetUrl.trim();
    if (!finalUrl) return;
    if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
      finalUrl = `http://${finalUrl}`;
    }
    setUrl(finalUrl);
    setInputUrl(finalUrl);
    setLoading(true);
    reloadKey.current++;
    if (pushHistory) {
      setHistory(prev => [...prev.slice(0, historyIndex + 1), finalUrl]);
      setHistoryIndex(prev => prev + 1);
    }
  }, [historyIndex]);

  // ── Back / Forward ──
  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setUrl(history[newIndex]);
      setInputUrl(history[newIndex]);
      reloadKey.current++;
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setUrl(history[newIndex]);
      setInputUrl(history[newIndex]);
      reloadKey.current++;
    }
  };

  // ── Reload ──
  const reload = () => {
    setLoading(true);
    reloadKey.current++;
    // Force iframe reload by toggling src
    if (iframeRef.current) {
      const src = iframeRef.current.src;
      iframeRef.current.src = "";
      setTimeout(() => { if (iframeRef.current) iframeRef.current.src = src; }, 50);
    }
  };

  // ── Auto-detect dev server port ──
  const detectPort = useCallback(async () => {
    setDetecting(true);

    // 1. Try reading .paaw/dev-config.json from project
    let devConfig: any = null;
    let configPorts: { port: number; label: string; path?: string }[] = [];
    let configDefaultUrl = "";
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/dev-config?path=${encodeURIComponent(projectRoot)}`);
      if (res.ok) devConfig = await res.json();
      if (devConfig?.browser?.ports) configPorts = devConfig.browser.ports;
      if (devConfig?.browser?.defaultUrl) configDefaultUrl = devConfig.browser.defaultUrl;
    } catch {}

    // If defaultUrl is set, use it directly
    if (configDefaultUrl) {
      navigate(configDefaultUrl);
      setDetecting(false);
      return;
    }

    // 2. Merge project ports with common ports (project ports first)
    const allPorts = [...configPorts, ...COMMON_PORTS.filter(cp => !configPorts.some(pp => pp.port === cp.port))];
    setActivePorts(allPorts);

    const checks: Record<number, boolean> = {};
    await Promise.all(allPorts.map(async ({ port }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`http://localhost:${port}`, {
          signal: controller.signal,
          mode: "no-cors",
        });
        clearTimeout(timeout);
        checks[port] = true;
      } catch {
        checks[port] = false;
      }
    }));
    setPortChecks(checks);

    // Auto-navigate to first responding port (project ports have priority)
    const firstAlive = allPorts.find(({ port }) => checks[port]);
    if (firstAlive) {
      setDetectedPort(firstAlive.port);
      navigate(`http://localhost:${firstAlive.port}`);
    }
    setDetecting(false);
  }, [navigate]);

  // ── Auto-detect on mount if no initialUrl ──
  useEffect(() => {
    if (!initialUrl && projectRoot) {
      detectPort();
    } else if (initialUrl) {
      navigate(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ──

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-stone-200 bg-stone-50 shrink-0">
        {/* Nav buttons */}
        <button
          onClick={goBack}
          disabled={historyIndex <= 0}
          className="text-xs px-1.5 py-1 rounded text-stone-500 hover:bg-stone-200 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Back"
        >
          ←
        </button>
        <button
          onClick={goForward}
          disabled={historyIndex >= history.length - 1}
          className="text-xs px-1.5 py-1 rounded text-stone-500 hover:bg-stone-200 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Forward"
        >
          →
        </button>
        <button
          onClick={reload}
          className="text-xs px-1.5 py-1 rounded text-stone-500 hover:bg-stone-200"
          title="Reload"
        >
          ↻
        </button>

        {/* URL bar */}
        <input
          type="text"
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") navigate(inputUrl); }}
          placeholder="http://localhost:5173"
          className="flex-1 text-xs px-3 py-1 rounded-lg border border-stone-200 bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
        />

        {/* Port detector */}
        <button
          onClick={() => { setShowPortList(!showPortList); if (!showPortList) detectPort(); }}
          className={cn("text-[10px] px-2 py-1 rounded font-medium transition-colors",
            detecting ? "text-purple-500 animate-pulse" : detectedPort ? "text-green-600" : "text-stone-400 hover:text-stone-600")}
          title="Detect dev server ports"
        >
          {detecting ? "🔍..." : detectedPort ? `🟢 :${detectedPort}` : "🔍 Detect"}
        </button>

        {/* Open external */}
        <button
          onClick={() => { if (url) window.open(url, "_blank"); }}
          disabled={!url}
          className="text-xs px-1.5 py-1 rounded text-stone-500 hover:bg-stone-200 disabled:opacity-30"
          title="Open in browser"
        >
          ↗
        </button>
      </div>

      {/* Port detection panel */}
      {showPortList && (
        <div className="border-b border-stone-200 bg-blue-50 px-2 py-1.5 shrink-0">
          <div className="text-[10px] text-blue-600 font-semibold mb-1">📡 Port Detection — click to open</div>
          <div className="flex flex-wrap gap-1.5">
            {activePorts.map(({ port, label }) => (
              <button
                key={port}
                onClick={() => { navigate(`http://localhost:${port}`); setShowPortList(false); }}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors",
                  portChecks[port]
                    ? "bg-green-100 text-green-700 border-green-300 hover:bg-green-200"
                    : "bg-stone-100 text-stone-400 border-stone-200"
                )}
              >
                {portChecks[port] ? "🟢" : "⚪"} :{port} {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* iframe */}
      <div className="flex-1 relative min-h-0">
        {url ? (
          <>
            {loading && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 animate-pulse z-10" />
            )}
            <iframe
              key={reloadKey.current}
              ref={iframeRef}
              src={url}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              onLoad={() => setLoading(false)}
              title="Browser Preview"
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-stone-300">
            <div className="text-center">
              <div className="text-4xl mb-3">🌐</div>
              <div className="text-sm text-stone-400 mb-2">No URL loaded</div>
              <button
                onClick={detectPort}
                disabled={detecting}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 font-medium"
              >
                {detecting ? "🔍 Detecting..." : "🔍 Auto-detect dev server"}
              </button>
              <div className="text-[10px] text-stone-300 mt-2">
                Or type a URL in the address bar above
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helper (inline cn to avoid import issues in some contexts) ──
function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
