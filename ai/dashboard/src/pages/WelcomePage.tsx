import React, { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "../utils";

const STORAGE_KEY = "aieos.project";
const API_BASE = "http://127.0.0.1:4097";

interface RecentProject {
  path: string;
  name: string;
  lastOpened: string;
}

interface DirEntry {
  name: string;
  path: string;
}

interface BrowseResult {
  currentPath: string;
  parent: string | null;
  directories: DirEntry[];
}

function getRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem("aieos.recent-projects");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function addRecentProject(path: string) {
  const projects = getRecentProjects().filter(p => p.path !== path);
  const name = path.split("/").filter(Boolean).pop() || path;
  projects.unshift({ path, name, lastOpened: new Date().toISOString() });
  localStorage.setItem("aieos.recent-projects", JSON.stringify(projects.slice(0, 10)));
}

// ── Folder Picker Modal ──
function FolderPickerModal({ onClose, onSelect }: { onClose: () => void; onSelect: (path: string) => void }) {
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/api/fs/browse?path=${encodeURIComponent(path)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to browse");
      setBrowseResult(data);
      setSelectedDir(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    browse("/Users/steward/App");
  }, [browse]);

  // Keyboard: Enter to confirm, Escape to close, Backspace to go up
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && selectedDir) onSelect(selectedDir);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, onSelect, selectedDir]);

  // Build breadcrumb segments
  const segments = browseResult?.currentPath.split("/").filter(Boolean) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-stone-900 border border-white/10 rounded-2xl w-full max-w-lg mx-4 shadow-2xl shadow-black/50 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Choose a folder</h2>
            <button onClick={onClose} className="text-stone-500 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Breadcrumb */}
          {browseResult && (
            <div className="flex items-center gap-0.5 text-xs font-mono overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              <button onClick={() => browse("/")} className="text-stone-500 hover:text-orange-400 transition-colors shrink-0">/</button>
              {segments.map((seg, i) => {
                const partialPath = "/" + segments.slice(0, i + 1).join("/");
                return (
                  <React.Fragment key={partialPath}>
                    <span className="text-stone-600 shrink-0">/</span>
                    <button
                      onClick={() => browse(partialPath)}
                      className="text-stone-400 hover:text-orange-400 transition-colors truncate max-w-[100px] shrink-0"
                    >
                      {seg}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Directory List */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1 min-h-0" style={{ scrollbarWidth: "thin" }}>
          {/* Parent */}
          {browseResult?.parent && (
            <button
              onClick={() => browse(browseResult.parent!)}
              className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-white/5 transition-colors"
            >
              <span className="text-stone-500 text-sm">📁</span>
              <span className="text-sm text-stone-400">..</span>
            </button>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12 text-stone-500">
              <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading...
            </div>
          )}

          {!loading && browseResult?.directories.length === 0 && (
            <div className="py-12 text-center text-stone-500 text-sm">Empty directory</div>
          )}

          {!loading && browseResult?.directories.map((dir) => {
            const isSelected = selectedDir === dir.path;
            return (
              <button
                key={dir.path}
                onClick={() => setSelectedDir(isSelected ? null : dir.path)}
                onDoubleClick={() => onSelect(dir.path)}
                className={cn(
                  "w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors",
                  isSelected
                    ? "bg-orange-500/15 text-orange-300"
                    : "hover:bg-white/5 text-stone-300"
                )}
              >
                <span className="text-sm">{isSelected ? "📂" : "📁"}</span>
                <span className="text-sm font-medium truncate">{dir.name}</span>
                {isSelected && (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-orange-400 shrink-0 ml-auto">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between gap-3">
          {/* Manual path input */}
          <div className="flex-1 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Or type a path..."
              defaultValue={browseResult?.currentPath}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) browse(val);
                }
              }}
              className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-stone-500 focus:outline-none focus:border-orange-400 font-mono"
            />
          </div>
          <button
            onClick={() => selectedDir ? onSelect(selectedDir) : null}
            disabled={!selectedDir}
            className={cn(
              "px-5 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap",
              selectedDir
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/20 hover:from-orange-600 hover:to-amber-600"
                : "bg-white/5 text-stone-600 cursor-not-allowed"
            )}
          >
            Open
          </button>
        </div>
        {error && <div className="px-5 pb-3 text-red-400 text-xs">{error}</div>}
      </div>
    </div>
  );
}

// ── Main Welcome Page ──
interface Props {
  onSelect: (path: string) => void;
}

export default function WelcomePage({ onSelect }: Props) {
  const [inputPath, setInputPath] = useState("");
  const [error, setError] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const recentProjects = getRecentProjects();

  const handleSelect = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) { setError("Please enter or select a path"); return; }
    addRecentProject(trimmed);
    localStorage.setItem(STORAGE_KEY, trimmed);
    onSelect(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSelect(inputPath);
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
            AIEOS
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
              onClick={() => setShowPicker(true)}
              className="px-4 py-3 border border-white/10 rounded-xl text-stone-300 hover:bg-white/5 hover:text-white transition-all text-sm"
              title="Browse folders"
            >
              📂
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

      {/* Folder Picker Popup */}
      {showPicker && (
        <FolderPickerModal
          onClose={() => setShowPicker(false)}
          onSelect={(path) => { setShowPicker(false); handleSelect(path); }}
        />
      )}
    </div>
  );
}
