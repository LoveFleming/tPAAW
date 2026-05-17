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
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

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
    setSelectedFile(null);
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

  const handleSelectFile = (path: string) => {
    setSelectedFile(path);
    if (activePage !== "codebase") setActivePage("codebase");
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
    return id;
  };

  const renderPage = (pageId: string) => {
    if (pageId === "factory.constitution") return <FactoryDocument file="constitution" headerIcon="scroll" headerTitle="Constitution" headerSub="工廠憲法 — 核心原則與價值" />;
    if (pageId === "factory.standards") return <FactoryDocument file="standards" headerIcon="ruler" headerTitle="Standards" headerSub="工程標準與規範" />;
    if (pageId === "factory.crew") return <AICrew openEmployee={openEmployee} onCrewChanged={loadCrew} />;
    if (pageId === "codebase") return <FileViewer filePath={selectedFile} projectRoot={projectRoot} />;
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
    <div className="h-screen flex flex-col bg-stone-50 text-stone-800 font-sans selection:bg-amber-200 overflow-hidden">
      {/* ── Header ── */}
      <header className="h-11 flex items-center justify-between px-3 shrink-0 z-10 border-b border-stone-200" style={{ background: themeInfo.gradient }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 -ml-1 rounded-lg text-white/80 hover:bg-white/20 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <span className="text-sm font-bold tracking-tight text-white" style={{ fontFamily: "'SF Pro Display', sans-serif" }}>AIEOS</span>
          <span className="text-white/30 text-xs">›</span>
          <button onClick={() => setShowWelcome(true)} className="text-xs text-white/60 hover:text-white transition-colors truncate max-w-[200px]" title="Switch project">
            {projectName}
          </button>
        </div>
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
          "bg-white border-r border-stone-200/80 flex-shrink-0 flex flex-col transition-all duration-200 overflow-hidden",
          sidebarOpen ? "w-60" : "w-0"
        )}>
          <div className="flex flex-col overflow-y-auto flex-1" style={{ scrollbarWidth: "thin" }}>
            {/* Factory */}
            <SidebarSection title="Factory">
              <div>
                {factoryNav.map((item) => (
                  <NavItem key={item.id} active={activePage === item.id} label={item.label} onClick={() => openApp(item.id)} />
                ))}
              </div>
            </SidebarSection>

            {/* Code Base — file tree indented */}
            <SidebarSection title="Code Base">
              <div className="ml-3">
                <SidebarFileTree
                  projectRoot={projectRoot}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                />
              </div>
            </SidebarSection>
          </div>

          {/* Switch project */}
          <div className="px-3 py-2 border-t border-stone-100 shrink-0">
            <button
              onClick={() => setShowWelcome(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-stone-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
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
          <div className="flex w-full items-end gap-0.5 overflow-x-auto bg-stone-100 px-3 pt-1.5 border-b border-stone-200" style={{ scrollbarWidth: 'none' }}>
            {openTabs.map((tabId) => {
              const isActive = activePage === tabId;
              return (
                <div
                  key={tabId}
                  onClick={() => setActivePage(tabId)}
                  className={cn(
                    "group relative flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs transition-all rounded-t-md",
                    isActive
                      ? "bg-white text-stone-800 font-medium shadow-sm"
                      : "text-stone-400 hover:text-stone-600 hover:bg-stone-200/50"
                  )}
                >
                  <span className="truncate whitespace-nowrap max-w-[160px]">{labelFor(tabId)}</span>
                  {tabId !== "codebase" && (
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
