import Icon from "./components/Icon";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import WelcomePage from "./pages/WelcomePage";
import AICrew from "./pages/AICrew";
import FactoryDocument from "./pages/FactoryDocument";
import FileViewer from "./pages/FileViewer";
import ProjectDashboard from "./pages/ProjectDashboard";
import SidebarFileTree from "./components/SidebarFileTree";

import { SidebarSection, NavItem } from "./components/ui/shared";
import { Skill } from "./types";
import { ThemeProvider, useTheme, THEMES, ThemeId, THEME_GROUPS } from "./theme";
import { cn } from "./utils";

const STORAGE_PROJECT_KEY = "aieoc.project";

// Migrate from old key name
try {
  const oldVal = localStorage.getItem("aieos.project");
  if (oldVal && !localStorage.getItem(STORAGE_PROJECT_KEY)) {
    localStorage.setItem(STORAGE_PROJECT_KEY, oldVal);
    localStorage.removeItem("aieos.project");
  }
  const oldRecent = localStorage.getItem("aieos.recent-projects");
  if (oldRecent && !localStorage.getItem("aieoc.recent-projects")) {
    localStorage.setItem("aieoc.recent-projects", oldRecent);
    localStorage.removeItem("aieos.recent-projects");
  }
} catch {}

function AppInner() {
  const [projectRoot, setProjectRoot] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_PROJECT_KEY) || null;
  });
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem(STORAGE_PROJECT_KEY));

  const [activePage, setActivePage] = useState<string>("codebase");
  const [openTabs, setOpenTabs] = useState<string[]>(["codebase"]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [crew, setCrew] = useState<Skill[]>([]);
  const [factoryFiles, setFactoryFiles] = useState<string[]>([]);

  const loadCrew = useCallback(async () => {
    try {
      const resp = await fetch("http://127.0.0.1:4097/api/crew");
      if (resp.ok) setCrew(await resp.json());
    } catch {}
  }, []);

  const loadFactoryFiles = useCallback(async () => {
    try {
      const resp = await fetch("http://127.0.0.1:4097/api/factory-content");
      if (resp.ok) {
        const data = await resp.json();
        setFactoryFiles(data.map((f: any) => f.filename));
      }
    } catch {}
  }, []);

  useEffect(() => { loadCrew(); loadFactoryFiles(); }, [loadCrew, loadFactoryFiles]);

  const handleSelectProject = (path: string) => {
    setProjectRoot(path);
    setShowWelcome(false);
    setActivePage("codebase");
    setOpenTabs(["codebase"]);
  };

  const openApp = (id: string) => {
    setOpenTabs((prev) => prev.includes(id) ? prev : [...prev, id]);
    setActivePage(id);
  };

  const closeTab = (id: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      if (activePage === id) setActivePage(next.length > 0 ? next[next.length - 1] : "codebase");
      return next;
    });
  };

  const [instanceCounter, setInstanceCounter] = useState(0);
  const openEmployee = (employeeId: string) => {
    const tabId = `employee.${employeeId}#${instanceCounter}`;
    setInstanceCounter((c) => c + 1);
    openApp(tabId);
  };

  // File click → open as a new tab with file path as ID
  const handleSelectFile = (path: string) => {
    const tabId = `file://${path}`;
    openApp(tabId);
  };

  const projectName = projectRoot?.split("/").filter(Boolean).pop() || "";

  const { info: themeInfo, theme, setTheme } = useTheme();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);

  const factoryNav = useMemo(() => {
    const staticItems = [{ id: "factory.crew", label: "AI Crew" }];
    const mdItems = factoryFiles.map(f => ({
      id: `factory.md.${f}`,
      label: f.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
    }));
    return [...mdItems, ...staticItems];
  }, [factoryFiles]);

  if (showWelcome || !projectRoot) {
    return <WelcomePage onSelect={handleSelectProject} />;
  }

  const labelFor = (id: string): string => {
    if (id === "codebase") return projectName;
    if (id.startsWith("factory.")) return factoryNav.find(n => n.id === id)?.label ?? id;
    if (id.startsWith("employee.")) {
      const empId = id.split("#")[0].slice(9);
      const emp = crew.find(s => s.id === empId);
      return emp ? emp.codename : empId;
    }
    if (id.startsWith("file://")) {
      const fullPath = id.slice(7);
      return fullPath.split("/").pop() || fullPath;
    }
    return id;
  };

  // Track which file paths are open (for sidebar highlight)
  const openFilePaths = new Set(openTabs.filter(t => t.startsWith("file://")).map(t => t.slice(7)));
  const activeFilePath = activePage.startsWith("file://") ? activePage.slice(7) : null;

  const renderPage = (pageId: string) => {
    if (pageId === "factory.crew") return <AICrew openEmployee={openEmployee} onCrewChanged={loadCrew} />;
    if (pageId.startsWith("factory.md.")) {
      const file = pageId.slice(11);
      const label = factoryNav.find(n => n.id === pageId)?.label ?? file;
      return <FactoryDocument file={file} headerIcon="scroll" headerTitle={label} headerSub="" />;
    }
    if (pageId === "codebase") {
      return <ProjectDashboard projectRoot={projectRoot!} openEmployee={openEmployee} />;
    }
    if (pageId.startsWith("file://")) {
      const filePath = pageId.slice(7);
      return <FileViewer filePath={filePath} projectRoot={projectRoot} />;
    }
    if (pageId.startsWith("employee.")) {
      const employeeId = pageId.split("#")[0].slice(9);
      const EmpWs = React.lazy(() => import("./pages/EmployeeWorkspaceV2"));
      return (
        <React.Suspense fallback={<div className="flex items-center justify-center h-full text-stone-400">Loading...</div>}>
          <EmpWs employeeId={employeeId} projectRoot={projectRoot || undefined} />
        </React.Suspense>
      );
    }
    return <div className="p-8 text-stone-400">Page not found: {pageId}</div>;
  };


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
          <span className="text-xs font-bold tracking-tight text-white" style={{ fontFamily: "'SF Pro Display', sans-serif" }}>AI-Native Engineering Operation System</span>
        </div>
        {/* Theme dropdown */}
        <div className="relative">
          <button
            onClick={() => setThemeMenuOpen(!themeMenuOpen)}
            className="flex items-center gap-1.5 w-8 h-8 rounded-full bg-white/90 hover:bg-white shadow-sm border border-stone-200 text-base justify-center transition-colors"
          >
            <span>{THEMES[theme]?.emoji}</span>
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
                        <span className="text-lg mt-0.5">{t.emoji}</span>
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
                          {t.feeling && <p className="text-[10px] text-stone-300 mt-0.5">💬 {t.feeling}</p>}
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
          "flex-shrink-0 flex flex-col transition-all duration-200 overflow-hidden border-r",
          sidebarOpen ? "w-60" : "w-0"
        )} style={{ backgroundColor: "white", borderColor: themeInfo.accentBorder + "60" }}>
          <div className="flex flex-col overflow-y-auto flex-1" style={{ scrollbarWidth: "thin" }}>

            {/* Factory */}
            <SidebarSection title="Factory">
              <div>
                {factoryNav.map((item) => (
                  <NavItem key={item.id} active={activePage === item.id} label={item.label} onClick={() => openApp(item.id)} accentColor={themeInfo.accent} accentBg={themeInfo.accentBg} />
                ))}
              </div>
            </SidebarSection>

            {/* Code Base — file tree */}
            <SidebarSection title="Code Base">
              <SidebarFileTree
                projectRoot={projectRoot}
                activeFilePath={activeFilePath}
                openFilePaths={openFilePaths}
                onSelectFile={handleSelectFile}
              />
            </SidebarSection>
          </div>

          {/* Switch project */}
          <div className="px-3 py-2 border-t shrink-0" style={{ borderColor: themeInfo.accentBorder + "60" }}>
            <button
              onClick={() => { setProjectRoot(null); setShowWelcome(true); setOpenTabs(["codebase"]); setActivePage("codebase"); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{ color: themeInfo.accentHover + "99" }}
              onMouseEnter={e => { e.currentTarget.style.color = themeInfo.accent; e.currentTarget.style.backgroundColor = themeInfo.accentBg; }}
              onMouseLeave={e => { e.currentTarget.style.color = themeInfo.accentHover + "99"; e.currentTarget.style.backgroundColor = ""; }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 .75.75V21m-6 0H9m4.5 0h6m-6 0V9m0 12H3.75a.75.75 0 0 1-.75-.75V13.5m16.5 0V3.75a.75.75 0 0 0-.75-.75H4.5a.75.75 0 0 0-.75.75v9.75m15 0h-1.5" />
              </svg>
              Switch Project
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* Tabs */}
          <div className="flex w-full items-end gap-0.5 overflow-x-auto px-3 pt-1.5 border-b" style={{ scrollbarWidth: 'none', backgroundColor: themeInfo.accentBg, borderColor: themeInfo.accentBorder + "60" }}>
            {openTabs.map((tabId) => {
              const isActive = activePage === tabId;
              const isCodebase = tabId === "codebase";
              return (
                <div
                  key={tabId}
                  onClick={() => setActivePage(tabId)}
                  className={cn(
                    "group relative flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm transition-all rounded-t-md",
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
                  {!isCodebase && (
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
                {renderPage(tabId)}
              </div>
            ))}
          </div>
        </main>
      </div>
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
