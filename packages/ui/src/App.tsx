import Icon from "./components/Icon";
import DirectoryExplorer from "./components/DirectoryExplorer";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ChatView from "./pages/ChatView";
import AICrew from "./pages/AICrew";
import SkillsPage from "./pages/SkillsPage";
import SkillBuilder from "./pages/SkillBuilder";
import AppLab from "./pages/AppLab";
import AppPool from "./pages/AppPool";
import CronJobsPage from "./pages/CronJobsPage";
import FileViewer from "./pages/FileViewer";
import SidebarFileTree from "./components/SidebarFileTree";
import KnowledgeTree from "./components/KnowledgeTree";
import OnboardingPage from "./pages/OnboardingPage";
import SettingsPage from "./pages/SettingsPage";

import { SidebarSection, NavItem } from "./components/ui/shared";
import { Crew } from "./types";
import { ThemeProvider, useTheme, THEMES, THEME_GROUPS, ThemeId } from "./theme";
import { useI18n } from "./i18n";
import { cn, pathBasename } from "./utils";

const STORAGE_PROJECT_KEY = "***";
const API_BASE = "http://127.0.0.1:4097";

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

function makeScopeKey(factoryId: string, projectRoot: string | null): string {
  if (!projectRoot) return `${factoryId}:_default`;
  const normalized = projectRoot.replace(/\\/g, "/");
  const dirName = normalized.split("/").pop() || "root";
  return `${factoryId}:${dirName}_${simpleHash(normalized)}`;
}

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

// Migrate from old keys
try {
  const oldVal = localStorage.getItem("aieos.project");
  if (oldVal && !localStorage.getItem(STORAGE_PROJECT_KEY)) {
    localStorage.setItem(STORAGE_PROJECT_KEY, oldVal);
    localStorage.removeItem("aieos.project");
  }
  const oldRecent = localStorage.getItem("aieos.recent-projects");
  if (oldRecent && !localStorage.getItem("tagent.recent-projects")) {
    localStorage.setItem("tagent.recent-projects", oldRecent);
    localStorage.removeItem("aieos.recent-projects");
  }
} catch {}

interface UserProfile {
  name: string;
  intro: string;
  style: string;
  onboarded?: boolean;
}

function AppInner() {
  const { t } = useI18n();
  const STORAGE_FACTORY_KEY = "***";
  const normPath = (p: string | null): string | null => p ? p.replace(/\\/g, "/") : null;

  // ── User Profile & Onboarding ──
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check user profile
    fetch(`${API_BASE}/api/tagent/user`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.onboarded) setProfile(data);
      })
      .catch(() => {});
    // Check provider & CLI config (info only, no blocking)
    fetch(`${API_BASE}/api/tagent/providers`).catch(() => {});
    fetch(`${API_BASE}/api/tagent/cli-config`).catch(() => {});
    setLoading(false);
  }, []);

  // ── Factory / Project state ──
  const [showFactoryEntry, setShowFactoryEntry] = useState(false);

  const [projectRoot, setProjectRoot] = useState<string | null>(() => {
    const lastFactory = localStorage.getItem(STORAGE_FACTORY_KEY) || "default";
    return normPath(localStorage.getItem(`tagent.project.${lastFactory}`));
  });
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>(() => {
    return localStorage.getItem(STORAGE_FACTORY_KEY) || "default";
  });

  const scopeStateRef = useRef<Record<string, { projectRoot: string | null; activePage: string; openTabs: string[] }>>({});

  // Default active page = chat (home)
  const [activePage, setActivePage] = useState<string>("_chat");
  const [openTabs, setOpenTabs] = useState<string[]>(["_chat"]);

  const currentScope = useMemo(() => makeScopeKey(selectedFactoryId, projectRoot), [selectedFactoryId, projectRoot]);
  const visibleTabs = useMemo(() => {
    return openTabs.filter(t => t === "_chat" || t === "_settings" || t.startsWith(currentScope + ":") || t.startsWith("workspace:"));
  }, [openTabs, currentScope]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("tagent.sidebar-width");
    return saved ? parseInt(saved, 10) : 260;
  });

  const [factories, setFactories] = useState<{id: string; name: string; icon: string; description: string}[]>([]);
  const [crew, setCrew] = useState<Crew[]>([]);
  const crewByFactoryRef = useRef<Record<string, Crew[]>>({});
  const [factoryFiles, setFactoryFiles] = useState<string[]>([]);
  const [tagentRoot, setTagentRoot] = useState("");
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
      if (d.tagentRoot) setTagentRoot(d.tagentRoot);
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

  useEffect(() => {
    if (!selectedFactoryId) return;
    loadFactoryFiles();
    const interval = setInterval(loadFactoryFiles, 3000);
    return () => clearInterval(interval);
  }, [selectedFactoryId, loadFactoryFiles]);

  // ── Navigation helpers ──
  const handleSelectProject = useCallback((path: string) => {
    const currentPrefix = currentScope + ":";
    const currentScopeTabs = openTabs.filter(t => t.startsWith(currentPrefix));
    scopeStateRef.current[currentScope] = {
      projectRoot,
      activePage: currentScopeTabs.length > 0 ? activePage : currentPrefix + "crew",
      openTabs: currentScopeTabs,
    };
    setProjectRoot(path);
    setShowFactoryEntry(false);
    const newScope = makeScopeKey(selectedFactoryId, path);
    const newPrefix = newScope + ":";
    const saved = scopeStateRef.current[newScope];
    const existingScopeTabs = openTabs.filter(t => t.startsWith(newPrefix));
    if (existingScopeTabs.length > 0) {
      const savedActive = saved?.activePage && openTabs.includes(saved.activePage) ? saved.activePage : existingScopeTabs[0];
      setActivePage(savedActive);
    } else if (saved) {
      const merged = [...openTabs, ...saved.openTabs];
      const seen = new Set<string>();
      const unique = merged.filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });
      setOpenTabs(unique);
      setActivePage(saved.activePage && unique.includes(saved.activePage) ? saved.activePage : `${newScope}:crew`);
    } else {
      const crewTab = `${newScope}:crew`;
      setOpenTabs(prev => prev.includes(crewTab) ? prev : [...prev, crewTab]);
      setActivePage(crewTab);
    }
    const normalized = normPath(path)!;
    localStorage.setItem(`tagent.project.${selectedFactoryId}`, normalized);
    try {
      const existing = JSON.parse(localStorage.getItem("tagent.recent-projects") || "[]") as string[];
      const updated = [normalized, ...existing.filter((p: string) => p !== normalized)].slice(0, 10);
      localStorage.setItem("tagent.recent-projects", JSON.stringify(updated));
    } catch {}
  }, [openTabs, activePage, currentScope, projectRoot, selectedFactoryId]);

  const enterFactory = (factoryId: string) => {
    switchFactory(factoryId);
    setShowFactoryEntry(false);
  };

  const goToFactoryEntry = () => {
    setShowFactoryEntry(true);
    loadFactories();
  };

  const switchFactory = (factoryId: string) => {
    const currentPrefix = currentScope + ":";
    const currentScopeTabs = openTabs.filter(t => t.startsWith(currentPrefix));
    scopeStateRef.current[currentScope] = {
      projectRoot,
      activePage: currentScopeTabs.length > 0 ? activePage : currentPrefix + "crew",
      openTabs: currentScopeTabs,
    };
    const savedRoot = normPath(localStorage.getItem(`tagent.project.${factoryId}`));
    const newScope = makeScopeKey(factoryId, savedRoot);
    const newPrefix = newScope + ":";
    const saved = scopeStateRef.current[newScope];
    const existingScopeTabs = openTabs.filter(t => t.startsWith(newPrefix));
    if (existingScopeTabs.length > 0) {
      const savedActive = saved?.activePage && openTabs.includes(saved.activePage) ? saved.activePage : existingScopeTabs[0];
      setActivePage(savedActive);
    } else {
      const restoredTabs = saved?.openTabs ?? [`${newScope}:crew`];
      const merged = [...openTabs, ...restoredTabs];
      const seen = new Set<string>();
      const unique = merged.filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });
      setOpenTabs(unique);
      setActivePage(saved?.activePage && unique.includes(saved.activePage) ? saved.activePage : `${newScope}:crew`);
    }
    if (savedRoot) { setProjectRoot(savedRoot); } else { setProjectRoot(null); }
    setSelectedFactoryId(factoryId);
    localStorage.setItem(STORAGE_FACTORY_KEY, factoryId);
  };

  const openApp = (id: string) => {
    const fullId = id.includes(":") ? id : `${currentScope}:${id}`;
    setOpenTabs((prev) => prev.includes(fullId) ? prev : [...prev, fullId]);
    setActivePage(fullId);
  };

  const closeTab = (id: string) => {
    if (id === "_chat") return; // Chat tab cannot be closed
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      if (activePage === id) setActivePage(next.length > 0 ? next[next.length - 1] : "_chat");
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
    const fullId = `workspace:wfile://${path}`;
    setOpenTabs((prev) => prev.includes(fullId) ? prev : [...prev, fullId]);
    setActivePage(fullId);
  };

  const [showDirExplorer, setShowDirExplorer] = useState(false);

  // ── Workspaces (multi-directory) ──
  const [workspaces, setWorkspaces] = useState<string[]>([]);

  const loadWorkspaces = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/tagent/workspaces`);
      if (resp.ok) {
        const data = await resp.json();
        setWorkspaces(data.directories || []);
      }
    } catch {}
  }, []);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  const addWorkspace = useCallback(async (dir: string) => {
    try {
      await fetch(`${API_BASE}/api/tagent/workspaces`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: dir }),
      });
      setWorkspaces(prev => prev.includes(dir) ? prev : [...prev, dir]);
    } catch {}
    setShowDirExplorer(false);
  }, []);

  const removeWorkspace = useCallback(async (dir: string) => {
    try {
      await fetch(`${API_BASE}/api/tagent/workspaces?dir=${encodeURIComponent(dir)}`, { method: "DELETE" });
    } catch {}
    setWorkspaces(prev => prev.filter(d => d !== dir));
  }, []);

  const handleDirSelect = useCallback((path: string) => {
    handleSelectProject(path);
    setShowDirExplorer(false);
  }, [handleSelectProject]);

  const factoryNav = useMemo(() => {
    const crewItem = { sortKey: `01-crew`, id: `${currentScope}:crew`, label: t("sidebar.aiCrew") };
    const fileItems = factoryFiles.map(f => {
      const stripped = f.replace(/^\d{2}-/, "");
      return {
        sortKey: `02-${f}`,
        id: `${currentScope}:file.${f}`,
        label: `📄 ${stripped.replace(/\.(md|json|yaml|yml|txt)$/i, "").split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}`,
      };
    });
    return [crewItem, ...fileItems].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [factoryFiles, currentScope, t]);

  const skillBuilderCounterRef = useRef(0);
  const openSkillLab = useCallback(() => {
    const count = skillBuilderCounterRef.current++;
    const tabId = `${currentScope}:skilllab#${count}`;
    setOpenTabs((prev) => [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const openAppLab = useCallback(() => {
    const tabId = `${currentScope}:reportapplab`;
    setOpenTabs((prev) => prev.includes(tabId) ? prev : [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const openAppPool = useCallback(() => {
    const tabId = `${currentScope}:reportapps`;
    setOpenTabs((prev) => prev.includes(tabId) ? prev : [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const openCronJobs = useCallback(() => {
    const tabId = `${currentScope}:cronjobs`;
    setOpenTabs((prev) => prev.includes(tabId) ? prev : [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const openSkillAppById = useCallback((skillId: string) => {
    const tabId = `${currentScope}:skillapp.${skillId}`;
    setOpenTabs((prev) => prev.includes(tabId) ? prev : [...prev, tabId]);
    setActivePage(tabId);
  }, [currentScope]);

  const skillNav = useMemo(() => [
    { id: `${currentScope}:skills`, label: t("sidebar.skillPool") },
  ], [currentScope, t]);

  const skillAppNav = useMemo(() =>
    skillApps.map(s => ({
      id: `${currentScope}:skillapp.${s.id}`,
      label: `📊 ${s.name}`,
      skillId: s.id,
    })),
  [skillApps, currentScope]);

  const labelFor = useCallback((fullId: string): string => {
    if (fullId === "_chat") return "🐾 " + t("chat.newChat");
    if (fullId === "_settings") return t("sidebar.settings");
    const { factoryId, pageType } = parseTabId(fullId);
    if (pageType === "crew") return t("sidebar.aiCrew");
    if (pageType === "skills") return t("sidebar.skillPool");
    if (pageType.startsWith("skilllab")) return t("sidebar.skillBuilder");
    if (pageType === "reportapplab") return t("sidebar.appLab");
    if (pageType === "reportapps") return t("sidebar.appPool");
    if (pageType === "cronjobs") return t("sidebar.cronJobs");
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
  }, [factoryNav, crew, t]);

  const openFilePaths = useMemo(() => new Set(
    openTabs.filter(t => { const { pageType } = parseTabId(t); return pageType.startsWith("wfile://"); })
      .map(t => { const { pageType } = parseTabId(t); return pageType.slice(8); })
  ), [openTabs]);
  const activeFilePath = (() => {
    const { pageType } = parseTabId(activePage);
    return pageType.startsWith("wfile://") ? pageType.slice(8) : null;
  })();

  const EmployeeWorkspaceLazy = useMemo(() => React.lazy(() => import("./pages/EmployeeWorkspace")), []);

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
      setSidebarWidth(w => { localStorage.setItem("tagent.sidebar-width", w.toString()); return w; });
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [sidebarWidth]);

  const renderPage = useCallback((fullId: string, active?: boolean) => {
    // ── Chat (home) ──
    if (fullId === "_chat") {
      return <ChatView profile={profile!} embedded />;
    }

    // ── Settings ──
    if (fullId === "_settings") {
      return <SettingsPage />;
    }

    const { scopeKey, factoryId, pageType } = parseTabId(fullId);

    if (pageType === "crew") {
      return <AICrew openEmployee={openEmployee} onCrewChanged={loadCrew} factoryId={factoryId || selectedFactoryId} />;
    }
    if (pageType === "skills") {
      return <SkillsPage />;
    }
    if (pageType.startsWith("skilllab")) {
      return <SkillBuilder />;
    }
    if (pageType === "reportapplab") {
      return <AppLab />;
    }
    if (pageType === "reportapps") {
      return <AppPool onOpenApp={openSkillAppById} />;
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
            <span className="text-xs text-stone-400 ml-2">App</span>
          </div>
          <iframe
            src={`http://127.0.0.1:4097/api/app/${skillId}`}
            onError={() => {
              const iframe = document.querySelector('iframe');
              if (iframe) iframe.src = `http://127.0.0.1:4097/api/skill-app/${skillId}`;
            }}
            className="flex-1 w-full border-0"
            style={{ minHeight: 400 }}
            title={skillId}
          />
        </div>
      );
    }
    if (pageType.startsWith("file.")) {
      const fileName = pageType.slice(5);
      if (!tagentRoot || !factoryId) return <div className="p-8 text-stone-400">Loading...</div>;
      const filePath = `${tagentRoot}/factories/${factoryId}/docs/${fileName}`;
      const tabProjectRoot = scopeStateRef.current[scopeKey]?.projectRoot ?? projectRoot;
      return <FileViewer filePath={filePath} projectRoot={tabProjectRoot} active={active} />;
    }
    if (pageType.startsWith("wfile://")) {
      const filePath = pageType.slice(8);
      return <FileViewer filePath={filePath} projectRoot={undefined} active={active} />;
    }
    if (pageType.startsWith("employee.")) {
      const employeeId = pageType.split("#")[0].slice(9);
      const tabCrew = crewByFactoryRef.current[factoryId] ?? crew;
      const tabProjectRoot = scopeStateRef.current[scopeKey]?.projectRoot
        ?? normPath(localStorage.getItem(`tagent.project.${factoryId}`))
        ?? projectRoot;
      return (
        <React.Suspense fallback={<div className="flex items-center justify-center h-full text-stone-400">Loading...</div>}>
          <EmployeeWorkspaceLazy employeeId={employeeId} projectRoot={tabProjectRoot || undefined} crew={tabCrew} factoryId={factoryId} />
        </React.Suspense>
      );
    }
    return <div className="p-8 text-stone-400">Page not found: {pageType}</div>;
  }, [projectRoot, tagentRoot, crew, selectedFactoryId, profile, skillAppNav]);

  // ── Theme ──
  const { info: themeInfo, theme, setTheme } = useTheme();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);

  // ── Early returns ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🐾</div>
          <div className="text-stone-400 text-sm">載入中...</div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return <OnboardingPage onComplete={(p) => setProfile(p)} />;
  }

  if (showFactoryEntry) {
    return (
      <FactoryEntryPage
        factories={factories}
        selectedFactoryId={selectedFactoryId}
        onSelect={enterFactory}
        onBack={() => setShowFactoryEntry(false)}
        tagentRoot={tagentRoot}
        onFactoriesChanged={loadFactories}
      />
    );
  }

  // ── Main Layout ──
  return (
    <div className="h-screen flex flex-col text-stone-800 font-sans overflow-hidden" style={{ backgroundColor: themeInfo.accentBg, "--tw-selection-color": themeInfo.accentLight } as React.CSSProperties}>
      {/* Header */}
      <header className="h-11 flex items-center justify-between px-3 shrink-0 z-10 border-b border-stone-200" style={{ background: themeInfo.gradient }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 -ml-1 rounded-lg text-white/80 hover:bg-white/20 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <button onClick={() => { setActivePage("_chat"); }} className="flex flex-col items-start leading-tight cursor-pointer hover:text-white/80 transition-colors" style={{ fontFamily: "'SF Pro Display', sans-serif" }}>
            <span className="text-sm font-semibold text-white tracking-tight">AI Capability Platform</span>
            <span className="text-[10px] font-normal text-white/50">Build, Manage and Execute AI Capabilities</span>
          </button>
        </div>
        {/* Theme */}
        <div className="relative">
          <button onClick={() => setThemeMenuOpen(!themeMenuOpen)} className="flex items-center gap-1.5 w-8 h-8 rounded-full bg-white/90 hover:bg-white shadow-sm border border-stone-200 text-base justify-center transition-colors">
            <Icon name={theme} size={18} />
          </button>
          {themeMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setThemeMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden z-50">
                <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50">
                  <p className="text-xs font-bold text-stone-600">🎨 選擇主題色調</p>
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
        {/* Sidebar */}
        <aside className={cn(
          "flex-shrink-0 flex flex-col overflow-hidden border-r",
          !sidebarOpen && "w-0"
        )} style={{ width: sidebarOpen ? sidebarWidth : 0, backgroundColor: "white", borderColor: themeInfo.accentBorder + "60", transition: sidebarDragRef.current ? "none" : "width 200ms" }}>
          <div className="flex flex-col overflow-y-auto flex-1" style={{ scrollbarWidth: "thin" }}>

            {/* 📚 Knowledge */}
            <SidebarSection title={t("sidebar.knowledge")}>
              <KnowledgeTree onOpenFile={handleSelectFile} />
            </SidebarSection>

            {/* 🏗 Build Capabilities */}
            <SidebarSection title={t("sidebar.build")}>
              <div>
                <NavItem active={false} label={t("sidebar.skillBuilder")} onClick={openSkillLab} accentColor={themeInfo.accent} accentBg={themeInfo.accentBg} />
                <NavItem active={activePage.endsWith(":reportapplab")} label={t("sidebar.appLab")} onClick={openAppLab} accentColor={themeInfo.accent} accentBg={themeInfo.accentBg} />
              </div>
            </SidebarSection>

            {/* ▶ Execution */}
            <SidebarSection title={t("sidebar.execution")}>
              <div>
                {factoryNav.filter(item => item.id.includes(":crew")).map((item) => (
                  <NavItem key={item.id} active={activePage === item.id} label={item.label} onClick={() => openApp(item.id)} accentColor={themeInfo.accent} accentBg={themeInfo.accentBg} />
                ))}
                {skillNav.map((item) => (
                  <NavItem key={item.id} active={activePage === item.id} label={item.label} onClick={() => openApp(item.id)} accentColor={themeInfo.accent} accentBg={themeInfo.accentBg} />
                ))}
                <NavItem active={activePage.endsWith(":reportapps")} label={t("sidebar.appPool")} onClick={openAppPool} accentColor={themeInfo.accent} accentBg={themeInfo.accentBg} />
                <NavItem active={activePage.endsWith(":cronjobs")} label={t("sidebar.cronJobs")} onClick={openCronJobs} accentColor={themeInfo.accent} accentBg={themeInfo.accentBg} />
              </div>
            </SidebarSection>

            {/* 📁 Workspaces */}
            <SidebarSection title={t("sidebar.workspaces")}>
              {workspaces.length === 0 && (
                <div className="px-2 py-3">
                  <button
                    onClick={() => setShowDirExplorer(true)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed transition-colors"
                    style={{ borderColor: themeInfo.accentBorder, color: themeInfo.accentHover }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = themeInfo.accent; e.currentTarget.style.color = themeInfo.accent; e.currentTarget.style.backgroundColor = themeInfo.accentBg; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = themeInfo.accentBorder; e.currentTarget.style.color = themeInfo.accentHover; e.currentTarget.style.backgroundColor = ""; }}
                  >
                    ＋ 加入目錄
                  </button>
                </div>
              )}
              {workspaces.map((dir) => (
                <div key={dir}>
                  <SidebarFileTree
                    projectRoot={dir}
                    activeFilePath={activeFilePath}
                    openFilePaths={openFilePaths}
                    onSelectFile={handleSelectFile}
                    onRemoveWorkspace={removeWorkspace}
                  />
                </div>
              ))}
            </SidebarSection>
          </div>

          {/* Add directory + Settings */}
          <div className="px-3 py-2 border-t shrink-0 space-y-1" style={{ borderColor: themeInfo.accentBorder + "60" }}>
            <button
              onClick={() => {
                if (!openTabs.includes("_settings")) setOpenTabs(prev => [...prev, "_settings"]);
                setActivePage("_settings");
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{ color: themeInfo.accentHover + "99" }}
              onMouseEnter={e => { e.currentTarget.style.color = themeInfo.accent; e.currentTarget.style.backgroundColor = themeInfo.accentBg; }}
              onMouseLeave={e => { e.currentTarget.style.color = themeInfo.accentHover + "99"; e.currentTarget.style.backgroundColor = ""; }}
            >
              <span>⚙️</span>
              設定
            </button>
            <button
              onClick={() => setShowDirExplorer(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{ color: themeInfo.accentHover + "99" }}
              onMouseEnter={e => { e.currentTarget.style.color = themeInfo.accent; e.currentTarget.style.backgroundColor = themeInfo.accentBg; }}
              onMouseLeave={e => { e.currentTarget.style.color = themeInfo.accentHover + "99"; e.currentTarget.style.backgroundColor = ""; }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              加入目錄
            </button>
          </div>
        </aside>

        {/* Sidebar resize */}
        {sidebarOpen && (
          <div
            onMouseDown={handleSidebarDragStart}
            className="flex-shrink-0 w-1.5 cursor-col-resize hover:bg-stone-300/50 active:bg-stone-400/50 transition-colors relative group"
            style={{ zIndex: 10 }}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* Main */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* Tabs */}
          <div className="flex w-full items-end gap-0.5 flex-wrap px-3 pt-1.5 border-b" style={{ backgroundColor: themeInfo.accentBg, borderColor: themeInfo.accentBorder + "60" }}>
            {visibleTabs.map((tabId) => {
              const isActive = activePage === tabId;
              const isPinned = tabId === "_chat";
              return (
                <div
                  key={tabId}
                  onClick={() => setActivePage(tabId)}
                  className={cn(
                    "group relative flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm transition-all rounded-t-md shrink-0",
                    isActive ? "bg-white shadow-sm" : "hover:bg-white/50"
                  )}
                  style={isActive ? { color: themeInfo.accentText, fontWeight: 600 } : { color: themeInfo.accentText + "88", fontWeight: 400 }}
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

      {/* Directory Explorer */}
      {showDirExplorer && (
        <DirectoryExplorer
          initialPath={workspaces[0] || undefined}
          onSelect={addWorkspace}
          onClose={() => setShowDirExplorer(false)}
          title="📂 加入目錄到 Workspaces"
        />
      )}

    </div>
  );
}

// ── FactoryEntryPage import (kept from original) ──
import FactoryEntryPage from "./pages/FactoryEntryPage";

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
