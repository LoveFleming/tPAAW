import Icon from "./components/Icon";
import DirectoryExplorer from "./components/DirectoryExplorer";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FactoryEntryPage from "./pages/FactoryEntryPage";
import AICrew from "./pages/AICrew";
import SkillsPage from "./pages/SkillsPage";
import SkillLab from "./pages/SkillLab";
import ReportAppLab from "./pages/ReportAppLab";
import ReportAppsPage from "./pages/ReportAppsPage";
import CronJobsPage from "./pages/CronJobsPage";
import FileViewer from "./pages/FileViewer";
import SidebarFileTree from "./components/SidebarFileTree";

import { SidebarSection, NavItem } from "./components/ui/shared";
import { Crew } from "./types";
import { ThemeProvider, useTheme, THEMES, ThemeId, THEME_GROUPS } from "./theme";
import { cn, pathBasename } from "./utils";

const STORAGE_PROJECT_KEY = "aioc.project";

// Simple hash for short readable IDs
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

// Scope key = factoryId + working base hash
function makeScopeKey(factoryId: string, projectRoot: string | null): string {
  if (!projectRoot) return `${factoryId}:_default`;
  // Normalize backslashes to forward slashes so Windows C:\xxx and C:/xxx
  // always produce the same hash (stable scope key across OS path formats)
  const normalized = projectRoot.replace(/\\/g, "/");
  const dirName = normalized.split("/").pop() || "root";
  return `${factoryId}:${dirName}_${simpleHash(normalized)}`;
}

// Parse tab ID into components
function parseTabId(tabId: string): { scopeKey: string; factoryId: string; pageType: string } {
  const firstColon = tabId.indexOf(":");
  if (firstColon === -1) return { scopeKey: "", factoryId: "", pageType: tabId };
  const factoryId = tabId.slice(0, firstColon);
  const rest = tabId.slice(firstColon + 1);
  const secondColon = rest.indexOf(":");
  if (secondColon === -1) return { scopeKey: tabId, factoryId, pageType: "" };
  const rootHash = rest.slice(0, secondColon);
  const pageType = rest.slice(secondColon + 1);
  return { scopeKey: `${factoryId}:${rootHash}`, factoryId, pageType };
}

// Migrate from old key name
try {
  const oldVal = localStorage.getItem("aieos.project");
  if (oldVal && !localStorage.getItem(STORAGE_PROJECT_KEY)) {
    localStorage.setItem(STORAGE_PROJECT_KEY, oldVal);
    localStorage.removeItem("aieos.project");
  }
  const oldRecent = localStorage.getItem("aieos.recent-projects");
  if (oldRecent && !localStorage.getItem("aioc.recent-projects")) {
    localStorage.setItem("aioc.recent-projects", oldRecent);
    localStorage.removeItem("aieos.recent-projects");
  }
} catch {}

function AppInner() {
  const STORAGE_FACTORY_KEY = "aioc.factory";

  /** Normalize path to forward slashes for consistent scope keys on all OS */
  const normPath = (p: string | null): string | null => p ? p.replace(/\\/g, "/") : null;

  const [showFactoryEntry, setShowFactoryEntry] = useState(false);

  const [projectRoot, setProjectRoot] = useState<string | null>(() => {
    const lastFactory = localStorage.getItem(STORAGE_FACTORY_KEY) || "default";
    return normPath(localStorage.getItem(`aioc.project.${lastFactory}`));
  });
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>(() => {
    return localStorage.getItem(STORAGE_FACTORY_KEY) || "default";
  });

  // All tabs across all scopes, keyed by scopeKey = factoryId:rootHash
  const scopeStateRef = useRef<Record<string, { projectRoot: string | null; activePage: string; openTabs: string[] }>>({});
  const [activePage, setActivePage] = useState<string>(() => {
    const factoryId = localStorage.getItem(STORAGE_FACTORY_KEY) || "default";
    const root = normPath(localStorage.getItem(`aioc.project.${factoryId}`));
    return `${makeScopeKey(factoryId, root)}:crew`;
  });
  const [openTabs, setOpenTabs] = useState<string[]>(() => {
    const factoryId = localStorage.getItem(STORAGE_FACTORY_KEY) || "default";
    const root = normPath(localStorage.getItem(`aioc.project.${factoryId}`));
    return [`${makeScopeKey(factoryId, root)}:crew`];
  });
  const currentScope = useMemo(() => makeScopeKey(selectedFactoryId, projectRoot), [selectedFactoryId, projectRoot]);
  // visibleTabs: only tabs belonging to current scope (factory + working base)
  const visibleTabs = useMemo(() => {
    const prefix = currentScope + ":";
    return openTabs.filter(t => t.startsWith(prefix));
  }, [openTabs, currentScope]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("aioc.sidebar-width");
    return saved ? parseInt(saved, 10) : 240;
  });

  const [factories, setFactories] = useState<{id: string; name: string; icon: string; description: string}[]>([]);
  const [crew, setCrew] = useState<Crew[]>([]);
  const crewByFactoryRef = useRef<Record<string, Crew[]>>({});
  const [factoryFiles, setFactoryFiles] = useState<string[]>([]);
  const [aiocRoot, setAiocRoot] = useState("");
  const [skillApps, setSkillApps] = useState<{id: string; name: string}[]>([]);

  const loadFactories = useCallback(async () => {
    try {
      const resp = await fetch("http://127.0.0.1:4097/api/factories");
      if (resp.ok) setFactories(await resp.json());
    } catch {}
  }, []);

  const loadCrew = useCallback(async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:4097/api/crew?factory=${selectedFactoryId}`);
      if (resp.ok) {
        const data = await resp.json();
        setCrew(data);
        crewByFactoryRef.current[selectedFactoryId] = data;
      }
    } catch {}
  }, [selectedFactoryId]);

  const loadFactoryFiles = useCallback(async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:4097/api/factory-content?factory=${selectedFactoryId}`);
      if (resp.ok) {
        const data = await resp.json();
        setFactoryFiles(data.map((f: any) => f.filename));
      }
    } catch {}
    try {
      const r = await fetch("http://127.0.0.1:4097/api/models?cli=qwen");
      const d = await r.json();
      if (d.aiocRoot) setAiocRoot(d.aiocRoot);
    } catch {}
  }, [selectedFactoryId]);

  const loadSkillApps = useCallback(async () => {
    try {
      const resp = await fetch("http://127.0.0.1:4097/api/skills");
      if (resp.ok) {
        const data = await resp.json();
        setSkillApps(data.filter((s: any) => s.hasApp).map((s: any) => ({ id: s.id, name: s.name })));
      }
    } catch {}
  }, []);

  useEffect(() => { loadFactories(); loadCrew(); loadFactoryFiles(); loadSkillApps(); }, [loadFactories, loadCrew, loadFactoryFiles, loadSkillApps]);

  // Auto-refresh factory docs every 3 seconds
  useEffect(() => {
    if (!selectedFactoryId) return;
    loadFactoryFiles();
    const interval = setInterval(loadFactoryFiles, 3000);
    return () => clearInterval(interval);
  }, [selectedFactoryId, loadFactoryFiles]);

  const handleSelectProject = (path: string) => {
    // Save current scope tabs
    const currentPrefix = currentScope + ":";
    const currentScopeTabs = openTabs.filter(t => t.startsWith(currentPrefix));
    scopeStateRef.current[currentScope] = {
      projectRoot,
      activePage: currentScopeTabs.length > 0 ? activePage : currentPrefix + "crew",
      openTabs: currentScopeTabs,
    };

    setProjectRoot(path);
    setShowFactoryEntry(false);

    // Compute new scope
    const newScope = makeScopeKey(selectedFactoryId, path);
    const newPrefix = newScope + ":";
    const saved = scopeStateRef.current[newScope];
    const existingScopeTabs = openTabs.filter(t => t.startsWith(newPrefix));

    if (existingScopeTabs.length > 0) {
      // Already mounted — just switch visibility
      const savedActive = saved?.activePage && openTabs.includes(saved.activePage) ? saved.activePage : existingScopeTabs[0];
      setActivePage(savedActive);
    } else if (saved) {
      // Restore saved tabs
      const merged = [...openTabs, ...saved.openTabs];
      const seen = new Set<string>();
      const unique = merged.filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });
      setOpenTabs(unique);
      setActivePage(saved.activePage && unique.includes(saved.activePage) ? saved.activePage : `${newScope}:crew`);
    } else {
      // New scope — add crew tab
      const crewTab = `${newScope}:crew`;
      setOpenTabs(prev => prev.includes(crewTab) ? prev : [...prev, crewTab]);
      setActivePage(crewTab);
    }

    // Save per-factory projectRoot (normalize backslashes for consistent scope keys)
    const normalized = normPath(path)!;
    localStorage.setItem(`aioc.project.${selectedFactoryId}`, normalized);
    // Update recent projects
    try {
      const existing = JSON.parse(localStorage.getItem("aioc.recent-projects") || "[]") as string[];
      const updated = [normalized, ...existing.filter((p: string) => p !== normalized)].slice(0, 10);
      localStorage.setItem("aioc.recent-projects", JSON.stringify(updated));
    } catch {}
  };

  const enterFactory = (factoryId: string) => {
    switchFactory(factoryId);
    setShowFactoryEntry(false);
  };

  const goToFactoryEntry = () => {
    setShowFactoryEntry(true);
    loadFactories();
  };

  const switchFactory = (factoryId: string) => {
    // Save current scope's active page
    const currentPrefix = currentScope + ":";
    const currentScopeTabs = openTabs.filter(t => t.startsWith(currentPrefix));
    scopeStateRef.current[currentScope] = {
      projectRoot,
      activePage: currentScopeTabs.length > 0 ? activePage : currentPrefix + "crew",
      openTabs: currentScopeTabs,
    };

    // Compute new scope
    const savedRoot = normPath(localStorage.getItem(`aioc.project.${factoryId}`));
    const newScope = makeScopeKey(factoryId, savedRoot);
    const newPrefix = newScope + ":";
    const saved = scopeStateRef.current[newScope];

    // Check if target scope already has tabs in openTabs
    const existingScopeTabs = openTabs.filter(t => t.startsWith(newPrefix));

    if (existingScopeTabs.length > 0) {
      // Tabs already mounted — just switch visibility (no reload)
      const savedActive = saved?.activePage && openTabs.includes(saved.activePage) ? saved.activePage : existingScopeTabs[0];
      setActivePage(savedActive);
    } else {
      // No tabs for this scope yet — restore from saved or create crew tab
      const restoredTabs = saved?.openTabs ?? [`${newScope}:crew`];
      const merged = [...openTabs, ...restoredTabs];
      const seen = new Set<string>();
      const unique = merged.filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });
      setOpenTabs(unique);
      setActivePage(saved?.activePage && unique.includes(saved.activePage) ? saved.activePage : `${newScope}:crew`);
    }

    // Restore projectRoot
    if (savedRoot) {
      setProjectRoot(savedRoot);
    } else {
      setProjectRoot(null);
    }

    setSelectedFactoryId(factoryId);
    localStorage.setItem(STORAGE_FACTORY_KEY, factoryId);
  };

  const openApp = (id: string) => {
    // If id already contains a scope prefix (from factoryNav), use it directly
    const fullId = id.includes(":") ? id : `${currentScope}:${id}`;
    setOpenTabs((prev) => prev.includes(fullId) ? prev : [...prev, fullId]);
    setActivePage(fullId);
  };

  const closeTab = (id: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      if (activePage === id) setActivePage(next.length > 0 ? next[next.length - 1] : `${currentScope}:crew`);
      return next;
    });
  };

  const instanceCounterRef = useRef(0);
  const openEmployee = useCallback((employeeId: string) => {
    const count = instanceCounterRef.current++;
    const tabId = `${currentScope}:employee.${employeeId}#${count}`;
    setOpenTabs((prev) => [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const handleSelectFile = (path: string) => {
    const fullId = `${currentScope}:wfile://${path}`;
    setOpenTabs((prev) => prev.includes(fullId) ? prev : [...prev, fullId]);
    setActivePage(fullId);
  };

  const projectName = projectRoot ? pathBasename(projectRoot) : "";

  const { info: themeInfo, theme, setTheme } = useTheme();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [factoryMenuOpen, setFactoryMenuOpen] = useState(false);
  const [showDirExplorer, setShowDirExplorer] = useState(false);
  const handlePickWorkingBase = useCallback(() => {
    setShowDirExplorer(true);
  }, []);

  const handleDirSelect = useCallback((path: string) => {
    handleSelectProject(path);
    setShowDirExplorer(false);
  }, []);

  const recentProjects = useMemo(() => {
    try {
      return (JSON.parse(localStorage.getItem("aioc.recent-projects") || "[]") as {path: string; name: string; lastOpened: string}[]);
    } catch { return []; }
  }, [projectRoot]);

  const factoryNav = useMemo(() => {
    const staticItems = [
      { id: `${currentScope}:crew`, label: "AI Crew" },
    ];
    const fileItems = factoryFiles.map(f => {
      const stripped = f.replace(/^\d{2}-/, "");
      return {
        sortKey: f,
        id: `${currentScope}:file.${f}`,
        label: stripped.replace(/\.(md|json|yaml|yml|txt)$/i, "").split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      };
    }).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return [...fileItems, ...staticItems];
  }, [factoryFiles, currentScope]);

  const skillLabCounterRef = useRef(0);
  const openSkillLab = useCallback(() => {
    const count = skillLabCounterRef.current++;
    const tabId = `${currentScope}:skilllab#${count}`;
    setOpenTabs((prev) => [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const openReportAppLab = useCallback(() => {
    const tabId = `${currentScope}:reportapplab`;
    setOpenTabs((prev) => prev.includes(tabId) ? prev : [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const openReportApps = useCallback(() => {
    const tabId = `${currentScope}:reportapps`;
    setOpenTabs((prev) => prev.includes(tabId) ? prev : [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const openSkillAppById = useCallback((skillId: string) => {
    const tabId = `${currentScope}:skillapp.${skillId}`;
    setOpenTabs((prev) => prev.includes(tabId) ? prev : [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const openCronJobs = useCallback(() => {
    const tabId = `${currentScope}:cronjobs`;
    setOpenTabs((prev) => prev.includes(tabId) ? prev : [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const skillNav = useMemo(() => [
    { id: `${currentScope}:skills`, label: "Skill Pool" },
  ], [currentScope]);

  const skillAppNav = useMemo(() =>
    skillApps.map(s => ({
      id: `${currentScope}:skillapp.${s.id}`,
      label: `📊 ${s.name}`,
      skillId: s.id,
    })),
  [skillApps, currentScope]);

  const labelFor = useCallback((fullId: string): string => {
    const { factoryId, pageType } = parseTabId(fullId);
    if (pageType === "crew") return "AI Crew";
    if (pageType === "skills") return "Skill Pool";
    if (pageType.startsWith("skilllab")) return "Skill Lab";
    if (pageType === "reportapplab") return "Report Lab";
    if (pageType === "reportapps") return "Report Apps";
    if (pageType === "cronjobs") return "Cron Jobs";
    if (pageType.startsWith("skillapp.")) {
      const appId = pageType.slice(9);
      return skillAppNav.find(n => n.skillId === appId)?.label ?? appId;
    }
    if (pageType.startsWith("file.")) {
      const fileName = pageType.slice(5);
      return factoryNav.find(n => n.id === fullId)?.label ?? fileName;
    }
    if (pageType.startsWith("employee.")) {
      const empId = pageType.split("#")[0].slice(9);
      const factoryCrew = crewByFactoryRef.current[factoryId] ?? crew;
      const emp = factoryCrew.find(s => s.id === empId);
      return emp ? emp.codename : empId;
    }
    if (pageType.startsWith("wfile://")) {
      return pathBasename(pageType.slice(8));
    }
    return pageType;
  }, [factoryNav, crew]);

  // Track which file paths are open (for sidebar highlight)
  const openFilePaths = useMemo(() => new Set(
    openTabs.filter(t => { const { pageType } = parseTabId(t); return pageType.startsWith("wfile://"); })
      .map(t => { const { pageType } = parseTabId(t); return pageType.slice(8); })
  ), [openTabs]);
  const activeFilePath = (() => {
    const { pageType } = parseTabId(activePage);
    return pageType.startsWith("wfile://") ? pageType.slice(8) : null;
  })();

  const EmployeeWorkspaceLazy = useMemo(() => React.lazy(() => import("./pages/EmployeeWorkspace")), []);

  // Sidebar resize handler
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const handleSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    const handleMove = (ev: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const newWidth = Math.max(160, Math.min(500, sidebarDragRef.current.startWidth + ev.clientX - sidebarDragRef.current.startX));
      setSidebarWidth(newWidth);
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      sidebarDragRef.current = null;
      // Save to localStorage
      setSidebarWidth(w => {
        localStorage.setItem("aioc.sidebar-width", w.toString());
        return w;
      });
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [sidebarWidth]);

  const renderPage = useCallback((fullId: string, active?: boolean) => {
    const { scopeKey, factoryId, pageType } = parseTabId(fullId);

    if (pageType === "crew") {
      return <AICrew openEmployee={openEmployee} onCrewChanged={loadCrew} factoryId={factoryId || selectedFactoryId} />;
    }
    if (pageType === "skills") {
      return <SkillsPage />;
    }
    if (pageType.startsWith("skilllab")) {
      return <SkillLab />;
    }
    if (pageType === "reportapplab") {
      return <ReportAppLab />;
    }
    if (pageType === "reportapps") {
      return <ReportAppsPage onOpenApp={openSkillAppById} />;
    }
    if (pageType === "cronjobs") {
      return <CronJobsPage />;
    }
    if (pageType.startsWith("skillapp.")) {
      const skillId = pageType.slice(9);
      return (
        <div className="h-full flex flex-col" style={{ backgroundColor: "#fafaf9" }}>
          <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0" style={{ borderColor: "#e7e5e4" }}>
            <span className="text-lg">📊</span>
            <span className="text-sm font-bold text-stone-700">{skillAppNav.find(n => n.skillId === skillId)?.label ?? skillId}</span>
            <span className="text-xs text-stone-400 ml-2">Skill App</span>
          </div>
          <iframe
            src={`http://127.0.0.1:4097/api/skill-app/${skillId}`}
            className="flex-1 w-full border-0"
            style={{ minHeight: 400 }}
            title={skillId}
          />
        </div>
      );
    }
    if (pageType.startsWith("file.")) {
      const fileName = pageType.slice(5);
      if (!aiocRoot || !factoryId) return <div className="p-8 text-stone-400">Loading...</div>;
      const filePath = `${aiocRoot}/factories/${factoryId}/docs/${fileName}`;
      const tabProjectRoot = scopeStateRef.current[scopeKey]?.projectRoot ?? projectRoot;
      return <FileViewer filePath={filePath} projectRoot={tabProjectRoot} active={active} />;
    }
    if (pageType.startsWith("wfile://")) {
      const filePath = pageType.slice(8);
      const tabProjectRoot = scopeStateRef.current[scopeKey]?.projectRoot ?? projectRoot;
      return <FileViewer filePath={filePath} projectRoot={tabProjectRoot} active={active} />;
    }
    if (pageType.startsWith("employee.")) {
      const employeeId = pageType.split("#")[0].slice(9);
      const tabCrew = crewByFactoryRef.current[factoryId] ?? crew;
      const tabProjectRoot = scopeStateRef.current[scopeKey]?.projectRoot
        ?? normPath(localStorage.getItem(`aioc.project.${factoryId}`))
        ?? projectRoot;
      return (
        <React.Suspense fallback={<div className="flex items-center justify-center h-full text-stone-400">Loading...</div>}>
          <EmployeeWorkspaceLazy employeeId={employeeId} projectRoot={tabProjectRoot || undefined} crew={tabCrew} factoryId={factoryId} />
        </React.Suspense>
      );
    }
    return <div className="p-8 text-stone-400">Page not found: {pageType}</div>;
  }, [projectRoot, aiocRoot, crew, selectedFactoryId]);

  // Early return AFTER all hooks
  if (showFactoryEntry) {
    return (
      <FactoryEntryPage
        factories={factories}
        selectedFactoryId={selectedFactoryId}
        onSelect={enterFactory}
        onBack={() => setShowFactoryEntry(false)}
        aiocRoot={aiocRoot}
        onFactoriesChanged={loadFactories}
      />
    );
  }


  return (
    <div className="h-screen flex flex-col text-stone-800 font-sans overflow-hidden" style={{ backgroundColor: themeInfo.accentBg, "--tw-selection-color": themeInfo.accentLight } as React.CSSProperties}>
      {/* ── Header ── */}
      <header className="h-11 flex items-center justify-between px-3 shrink-0 z-10 border-b border-stone-200" style={{ background: themeInfo.gradient }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 -ml-1 rounded-lg text-white/80 hover:bg-white/20 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-white" style={{ fontFamily: "'SF Pro Display', sans-serif" }}>AI-Native Operation Center</span>
          {/* Factory panel in header */}
          {factories.length > 0 && (
            <div className="relative ml-3">
              <button
                onClick={() => setFactoryMenuOpen(!factoryMenuOpen)}
                className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white/20 hover:bg-white/30 text-white/90 text-sm font-semibold transition-colors cursor-pointer"
                style={{ fontFamily: "'SF Pro Display', sans-serif" }}
              >
                {factories.find(f => f.id === selectedFactoryId)?.icon || "🏭"} {factories.find(f => f.id === selectedFactoryId)?.name || selectedFactoryId}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={cn("w-3 h-3 transition-transform", factoryMenuOpen ? "" : "rotate-180")}>
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </button>
              {factoryMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setFactoryMenuOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 w-56 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden z-50">
                    <div className="px-3 py-1.5 border-b border-stone-100 bg-stone-50">
                      <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">🏭 AI Factory</span>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                      {factories.filter(f => f.id !== "default").map(f => (
                        <button
                          key={f.id}
                          onClick={() => { switchFactory(f.id); setFactoryMenuOpen(false); }}
                          className={cn(
                            "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                            f.id === selectedFactoryId ? "bg-stone-50" : "hover:bg-stone-50"
                          )}
                        >
                          <span className="text-sm">{f.icon}</span>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className={cn("text-sm", f.id === selectedFactoryId ? "font-semibold text-stone-800" : "text-stone-600")}>{f.name}</span>
                            {f.id === selectedFactoryId && (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" style={{ color: themeInfo.accent }}>
                                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-stone-200">
                      <button
                        onClick={() => { setFactoryMenuOpen(false); goToFactoryEntry(); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-stone-500 hover:text-stone-700 hover:bg-stone-50 transition-colors"
                      >
                        <span className="text-sm">➕</span>
                        <span>Create New Factory</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {/* Theme dropdown */}
        <div className="relative">
          <button
            onClick={() => setThemeMenuOpen(!themeMenuOpen)}
            className="flex items-center gap-1.5 w-8 h-8 rounded-full bg-white/90 hover:bg-white shadow-sm border border-stone-200 text-base justify-center transition-colors"
          >
            <Icon name={theme} size={18} />
          </button>
          {/* Dropdown */}
          {themeMenuOpen && (
            <>
              {/* Backdrop to close on click outside */}
              <div className="fixed inset-0 z-40" onClick={() => setThemeMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden z-50">
                <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50">
                  <p className="text-xs font-bold text-stone-600">🎨 選擇主題色調</p>
                  <p className="text-[10px] text-stone-400 mt-0.5">不同色系可以舒緩不同的杏仁核狀態</p>
                </div>
                <div className="max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {THEME_GROUPS.map(group => (
                  <div key={group.label}>
                    <div className="px-4 py-1.5 bg-stone-50/50 border-b border-stone-100">
                      <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{group.label}</span>
                    </div>
                    {group.themes.map(t => (
                      <button
                        key={t.id}
                        onClick={() => { setTheme(t.id); setThemeMenuOpen(false); }}
                        className={cn(
                          "w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors",
                          theme === t.id ? "bg-stone-50" : "hover:bg-stone-50"
                        )}
                      >
                        <span className="mt-0.5"><Icon name={t.id} size={18} /></span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm font-semibold", theme === t.id ? "text-stone-800" : "text-stone-600")}>{t.label}</span>
                            {theme === t.id && (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" style={{ color: t.accent }}>
                                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                          <p className="text-[11px] text-stone-400 mt-0.5">{t.desc}</p>
                          {t.feeling && <p className="text-[10px] text-stone-300 mt-0.5 flex items-center gap-1"><Icon name="chat" size={10} /> {t.feeling}</p>}
                        </div>
                        <div className="flex gap-0.5 mt-1 shrink-0">
                          <span className="w-3 h-3 rounded-full border border-stone-200" style={{ backgroundColor: t.accent }} />
                          <span className="w-3 h-3 rounded-full border border-stone-200" style={{ backgroundColor: t.accentLight }} />
                          <span className="w-3 h-3 rounded-full border border-stone-200" style={{ backgroundColor: t.accentBg }} />
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ── */}
        <aside className={cn(
          "flex-shrink-0 flex flex-col overflow-hidden border-r",
          !sidebarOpen && "w-0"
        )} style={{ width: sidebarOpen ? sidebarWidth : 0, backgroundColor: "white", borderColor: themeInfo.accentBorder + "60", transition: sidebarDragRef.current ? "none" : "width 200ms" }}>
          <div className="flex flex-col overflow-y-auto flex-1" style={{ scrollbarWidth: "thin" }}>

            {/* Factory */}
            <SidebarSection title="Factory">
              <div>
                {factoryNav.map((item) => (
                  <NavItem key={item.id} active={activePage === item.id} label={item.label} onClick={() => openApp(item.id)} accentColor={themeInfo.accent} accentBg={themeInfo.accentBg} />
                ))}
              </div>
            </SidebarSection>

            {/* Skills */}
            <SidebarSection title="Skills">
              <div>
                {skillNav.map((item) => (
                  <NavItem key={item.id} active={activePage === item.id} label={item.label} onClick={() => openApp(item.id)} accentColor={themeInfo.accent} accentBg={themeInfo.accentBg} />
                ))}
                <NavItem
                  active={false}
                  label="Skill Lab"
                  onClick={openSkillLab}
                  accentColor={themeInfo.accent}
                  accentBg={themeInfo.accentBg}
                />
              </div>
            </SidebarSection>

            {/* Apps */}
            <SidebarSection title="Apps">
              <div>
                <NavItem
                  active={activePage.endsWith(":reportapplab")}
                  label="App Lab"
                  onClick={openReportAppLab}
                  accentColor={themeInfo.accent}
                  accentBg={themeInfo.accentBg}
                />
                <NavItem
                  active={activePage.endsWith(":reportapps")}
                  label="Apps"
                  onClick={openReportApps}
                  accentColor={themeInfo.accent}
                  accentBg={themeInfo.accentBg}
                />
                <NavItem
                  active={activePage.endsWith(":cronjobs")}
                  label="Cron Jobs"
                  onClick={openCronJobs}
                  accentColor={themeInfo.accent}
                  accentBg={themeInfo.accentBg}
                />
              </div>
            </SidebarSection>

            {/* Working Base — file tree */}
            <SidebarSection title="Working Base">
              {projectRoot ? (
                <SidebarFileTree
                  projectRoot={projectRoot}
                  activeFilePath={activeFilePath}
                  openFilePaths={openFilePaths}
                  onSelectFile={handleSelectFile}
                />
              ) : (
                <div className="px-2 py-3">
                  <button
                    onClick={() => handlePickWorkingBase()}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed transition-colors"
                    style={{ borderColor: themeInfo.accentBorder, color: themeInfo.accentHover }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = themeInfo.accent; e.currentTarget.style.color = themeInfo.accent; e.currentTarget.style.backgroundColor = themeInfo.accentBg; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = themeInfo.accentBorder; e.currentTarget.style.color = themeInfo.accentHover; e.currentTarget.style.backgroundColor = ""; }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
                    </svg>
                    Select Working Base
                  </button>
                </div>
              )}
            </SidebarSection>
          </div>

          {/* Switch Working Base */}
          <div className="px-3 py-2 border-t shrink-0" style={{ borderColor: themeInfo.accentBorder + "60" }}>
            <button
              onClick={() => handlePickWorkingBase()}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{ color: themeInfo.accentHover + "99" }}
              onMouseEnter={e => { e.currentTarget.style.color = themeInfo.accent; e.currentTarget.style.backgroundColor = themeInfo.accentBg; }}
              onMouseLeave={e => { e.currentTarget.style.color = themeInfo.accentHover + "99"; e.currentTarget.style.backgroundColor = ""; }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
              </svg>
              Switch Working Base
            </button>
          </div>
        </aside>

        {/* Sidebar resize handle */}
        {sidebarOpen && (
          <div
            onMouseDown={handleSidebarDragStart}
            className="flex-shrink-0 w-1.5 cursor-col-resize hover:bg-stone-300/50 active:bg-stone-400/50 transition-colors relative group"
            style={{ zIndex: 10 }}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* ── Main ── */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* Tabs — multi-row wrap */}
          <div className="flex w-full items-end gap-0.5 flex-wrap px-3 pt-1.5 border-b" style={{ backgroundColor: themeInfo.accentBg, borderColor: themeInfo.accentBorder + "60" }}>
            {visibleTabs.map((tabId) => {
              const isActive = activePage === tabId;
              const isPinned = (() => { const { pageType } = parseTabId(tabId); return pageType === "crew"; })();
              return (
                <div
                  key={tabId}
                  onClick={() => setActivePage(tabId)}
                  className={cn(
                    "group relative flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm transition-all rounded-t-md shrink-0",
                    isActive
                      ? "bg-white shadow-sm"
                      : "hover:bg-white/50"
                  )}
                  style={isActive
                    ? { color: themeInfo.accentText, fontWeight: 600 }
                    : { color: themeInfo.accentText + "88", fontWeight: 400 }
                  }
                >
                  <span className="truncate whitespace-nowrap max-w-[160px]">{labelFor(tabId)}</span>
                  {!isPinned && (
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tabId); }}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-stone-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-2.5 w-2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            {openTabs.map((tabId) => (
              <div key={tabId} className="absolute inset-0" style={{ visibility: activePage === tabId ? "visible" : "hidden", pointerEvents: activePage === tabId ? "auto" : "none" }}>
                {renderPage(tabId, activePage === tabId)}
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Working Base Selection — Directory Explorer */}
      {showDirExplorer && (
        <DirectoryExplorer
          initialPath={projectRoot || undefined}
          onSelect={handleDirSelect}
          onClose={() => setShowDirExplorer(false)}
          title="📂 選擇 Working Base"
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
