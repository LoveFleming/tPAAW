import React, { useState, useEffect, useCallback } from "react";
import { cn } from "../utils";
import Icon from "../components/Icon";
import DirectoryExplorer from "../components/DirectoryExplorer";
import { pathBasename } from "../utils";

const API_BASE = "http://127.0.0.1:4097";

interface RecentProject {
  path: string;
  name: string;
  lastOpened: string;
}



// ── Main Welcome Page ──
interface Props {
  onSelect: (path: string) => void;
}

export default function WelcomePage({ onSelect }: Props) {
  const [inputPath, setInputPath] = useState("");
  const [error, setError] = useState("");
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/paaw/ui-state`)
      .then(r => r.json())
      .then(state => {
        const paths: string[] = state.recentProjects || [];
        setRecentProjects(paths.map(p => ({ path: p, name: pathBasename(p), lastOpened: "" })));
      })
      .catch(() => {});
  }, []);

  const handleSelect = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) { setError("Please enter or select a path"); return; }
    // Save via API
    fetch(`${API_BASE}/api/paaw/ui-state`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lastProject: trimmed,
        recentProjects: [trimmed, ...recentProjects.filter(p => p.path !== trimmed).map(p => p.path)].slice(0, 10),
      }),
    }).catch(() => {});
    onSelect(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSelect(inputPath);
  };

  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  const handleNativeFolderPicker = () => {
    setShowFolderBrowser(true);
  };

  const handleFolderSelect = (path: string) => {
    setShowFolderBrowser(false);
    setInputPath(path);
    handleSelect(path);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-stone-900 via-stone-800 to-stone-900">
      <div className="w-full max-w-lg mx-4">
        {/* Logo / Title */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-400 to-amber-500 shadow-lg shadow-orange-500/25 mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="white" className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight" style={{ fontFamily: "'SF Pro Display', system-ui, sans-serif" }}>
            PAAW
          </h1>
          <p className="text-stone-400 mt-2 text-lg">AI-native Engineering Operation System</p>
        </div>

        {/* Main Card */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
          <label className="block text-sm font-medium text-stone-300 mb-2">
            Open a project
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={inputPath}
              onChange={(e) => { setInputPath(e.target.value); setError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="/path/to/your/project"
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-stone-500 focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 text-sm font-mono"
            />
            <button
              onClick={handleNativeFolderPicker}
              className="px-4 py-3 border border-white/10 rounded-xl text-stone-300 hover:bg-white/5 hover:text-white transition-all text-sm"
              title="Browse folders"
            >
              <Icon name="folder" size={16} />
            </button>
            <button
              onClick={() => handleSelect(inputPath)}
              className="px-6 py-3 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-medium rounded-xl hover:from-orange-600 hover:to-amber-600 transition-all shadow-lg shadow-orange-500/20 text-sm whitespace-nowrap"
            >
              Open
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>

        {/* Directory Explorer */}
        {showFolderBrowser && (
          <DirectoryExplorer
            onSelect={handleFolderSelect}
            onClose={() => setShowFolderBrowser(false)}
            title="📂 選擇專案目錄"
          />
        )}

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-3 px-1">Recent Projects</h3>
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
              {recentProjects.map((p, i) => (
                <button
                  key={p.path}
                  onClick={() => handleSelect(p.path)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors group",
                    i < recentProjects.length - 1 && "border-b border-white/5"
                  )}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-stone-500 group-hover:text-orange-400 transition-colors shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-stone-300 font-medium truncate group-hover:text-white transition-colors">{p.name}</div>
                    <div className="text-xs text-stone-600 font-mono truncate">{p.path}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-stone-600 text-xs mt-6">
          Select a source code project to begin · Constitution &amp; Standards apply globally
        </p>
      </div>
    </div>
  );
}
