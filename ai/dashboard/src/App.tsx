import Icon from "./components/Icon";
import React, { useCallback, useEffect, useState } from "react";

import WelcomePage from "./pages/WelcomePage";
import AICrew from "./pages/AICrew";
import FactoryDocument from "./pages/FactoryDocument";
import FileViewer from "./pages/FileViewer";
import SidebarFileTree from "./components/SidebarFileTree";

import { SidebarSection, NavItem } from "./components/ui/shared";
import { Skill } from "./types";
import { ThemeProvider, useTheme, THEMES, ThemeId } from "./theme";
import { cn } from "./utils";

const STORAGE_PROJECT_KEY = "aieos.project";

function AppInner() {
  const [projectRoot, setProjectRoot] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_PROJECT_KEY) || null;
  });
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem(STORAGE_PROJECT_KEY));

  const [activePage, setActivePage] = useState<string>("codebase");
  const [openTabs, setOpenTabs] = useState<string[]>(["codebase"]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [crew, setCrew] = useState<Skill[]>([]);
  const loadCrew = useCallback(async () => {
    try {
      const resp = await fetch("http://127.0.0.1:4097/api/crew");
      if (resp.ok) setCrew(await resp.json());
    } catch {}
  }, []);

  useEffect(() => { loadCrew(); }, [loadCrew]);

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

  if (showWelcome || !projectRoot) {
    return <WelcomePage onSelect={handleSelectProject} />;
  }

  const projectName = projectRoot.split("/").filter(Boolean).pop() || projectRoot;

  const factoryNav = [
    { id: "factory.constitution", label: "Constitution" },
    { id: "factory.standards", label: "Standards" },
    { id: "factory.crew", label: "AI Crew" },
  ];

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
    if (pageId === "factory.constitution") return <FactoryDocument file="constitution" headerIcon="scroll" headerTitle="Constitution" headerSub="工廠憲法 — 核心原則與價值" />;
    if (pageId === "factory.standards") return <FactoryDocument file="standards" headerIcon="ruler" headerTitle="Standards" headerSub="工程標準與規範" />;
    if (pageId === "factory.crew") return <AICrew openEmployee={openEmployee} onCrewChanged={loadCrew} />;
    if (pageId === "codebase") {
      return (
        <div className="flex-1 flex items-center justify-center text-stone-400">
          <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-12 h-12 mx-auto mb-3 text-stone-300">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <p className="text-sm">Select a file from the sidebar</p>
            <p className="text-xs text-stone-300 mt-1">Each file opens in its own tab</p>
          </div>
        </div>
      );
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
          <EmpWs employeeId={employeeId} />
        </React.Suspense>
      );
    }
    return <div className="p-8 text-stone-400">Page not found: {pageId}</div>;
  };

  const { info: themeInfo, theme, setTheme } = useTheme();

  return (
    <div className="h-screen flex flex-col bg-stone-50 text-stone-800 font-sans overflow-hidden" style={{ "--tw-selection-color": themeInfo.accentLight } as React.CSSProperties}>
      {/* ── Header ── */}
      <header className="h-11 flex items-center justify-between px-3 shrink-0 z-10 border-b border-stone-200" style={{ background: themeInfo.gradient }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 -ml-1 rounded-lg text-white/80 hover:bg-white/20 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <span className="text-sm font-bold tracking-tight text-white" style={{ fontFamily: "'SF Pro Display', sans-serif" }}>AIEOS</span>
        </div>
        {/* Project / Switch Code Base */}
        <button
          onClick={() => setShowWelcome(true)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white text-xs"
          title="Switch Code Base"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
          </svg>
          <span className="truncate max-w-[120px]">{projectName}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 opacity-50">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="flex items-center gap-1">
          {(Object.keys(THEMES) as ThemeId[]).map(id => (
            <button key={id} onClick={() => setTheme(id)} className={cn("w-6 h-6 rounded-full text-xs flex items-center justify-center transition-all", theme === id ? "bg-white/30 ring-2 ring-white" : "hover:bg-white/20")} title={THEMES[id].label}>
              <Icon name={THEMES[id].icon} size={14} />
            </button>
          ))}
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
              onClick={() => setShowWelcome(true)}
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
                    "group relative flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs transition-all rounded-t-md",
                    isActive
                      ? "bg-white font-medium shadow-sm"
                      : "hover:bg-white/50"
                  )}
                  style={isActive
                    ? { color: themeInfo.accentText }
                    : { color: themeInfo.accentText + "88" }
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
