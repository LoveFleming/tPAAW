import Icon from "./components/Icon";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * AIEOS — AI-native Engineering Operation System
 *
 * Two-layer architecture:
 * - Factory (global): Constitution, Standards, AI Crew
 * - Release Unit (project): File explorer, AI interaction
 *
 * First visit → Welcome page to select a project
 * Subsequent visits → auto-open last project
 */

import WelcomePage from "./pages/WelcomePage";
import AICrew from "./pages/AICrew";
import FactoryDocument from "./pages/FactoryDocument";
import ReleaseUnitExplorer from "./pages/ReleaseUnitExplorer";

import { SidebarSection, NavItem } from "./components/ui/shared";
import { Skill, RunStatus, Run, Risk } from "./types";
import { ThemeProvider, useTheme, THEMES, ThemeId } from "./theme";
import { cn } from "./utils";

const STORAGE_PROJECT_KEY = "aieos.project";

function AppInner() {
  // ── Project state ──
  const [projectRoot, setProjectRoot] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_PROJECT_KEY) || null;
  });
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem(STORAGE_PROJECT_KEY));

  // ── Navigation state ──
  const [activePage, setActivePage] = useState<string>("release.files");
  const [openTabs, setOpenTabs] = useState<string[]>(["release.files"]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Dynamic crew data ──
  const [crew, setCrew] = useState<Skill[]>([]);
  const loadCrew = useCallback(async () => {
    try {
      const resp = await fetch("http://127.0.0.1:4097/api/crew");
      if (resp.ok) {
        const data = await resp.json();
        setCrew(data);
      }
    } catch { /* fallback to empty */ }
  }, []);

  useEffect(() => { loadCrew(); }, [loadCrew]);

  // ── Project selection ──
  const handleSelectProject = (path: string) => {
    setProjectRoot(path);
    setShowWelcome(false);
    setActivePage("release.files");
    setOpenTabs(["release.files"]);
  };

  const handleSwitchProject = () => {
    setShowWelcome(true);
  };

  // ── Tab management ──
  const openApp = (id: string) => {
    setOpenTabs((prev) => {
      if (!prev.includes(id)) return [...prev, id];
      return prev;
    });
    setActivePage(id);
  };

  const closeTab = (id: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      if (activePage === id) {
        setActivePage(next.length > 0 ? next[next.length - 1] : "release.files");
      }
      return next;
    });
  };

  // ── Employee workspace ──
  const [instanceCounter, setInstanceCounter] = useState(0);
  const openEmployee = (employeeId: string) => {
    const instanceId = `emp.${instanceCounter}`;
    setInstanceCounter((c) => c + 1);
    const tabId = `employee.${employeeId}#${instanceId}`;
    openApp(tabId);
  };

  // ── Welcome page ──
  if (showWelcome || !projectRoot) {
    return <WelcomePage onSelect={handleSelectProject} />;
  }

  // ── Sidebar nav definition ──
  const projectName = projectRoot.split("/").filter(Boolean).pop() || projectRoot;

  const factoryNav = [
    { id: "factory.constitution", label: "Constitution" },
    { id: "factory.standards", label: "Standards" },
    { id: "factory.crew", label: "AI Crew" },
  ];

  const releaseNav = [
    { id: "release.files", label: "File Structure" },
  ];

  const navSections = [
    { title: "🏭 Factory", items: factoryNav },
    { title: "📂 Release Unit", items: releaseNav },
  ];

  // ── Tab label resolver ──
  const labelFor = (id: string): string => {
    for (const section of navSections) {
      for (const item of section.items) {
        if (item.id === id) return item.label;
      }
    }
    if (id.startsWith("employee.")) {
      const [empPart] = id.split("#");
      const empId = empPart.slice(9);
      const emp = crew.find(s => s.id === empId);
      return emp ? emp.codename : empId;
    }
    return id;
  };

  // ── Page rendering ──
  const renderPage = (pageId: string) => {
    // Factory pages
    if (pageId === "factory.constitution") return <FactoryDocument file="constitution" headerIcon="scroll" headerTitle="Constitution" headerSub="工廠憲法 — 核心原則與價值" />;
    if (pageId === "factory.standards") return <FactoryDocument file="standards" headerIcon="ruler" headerTitle="Standards" headerSub="工程標準與規範" />;
    if (pageId === "factory.crew") return <AICrew openEmployee={openEmployee} onCrewChanged={loadCrew} />;

    // Release Unit pages
    if (pageId === "release.files") return <ReleaseUnitExplorer projectRoot={projectRoot} />;

    // Employee workspace (legacy, keeping compatibility)
    if (pageId.startsWith("employee.")) {
      const [empPart] = pageId.split("#");
      const employeeId = empPart.slice(9);
      // Lazy import to avoid breaking if EmployeeWorkspace is refactored
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
    <div className="h-screen flex flex-col bg-orange-50/40 text-stone-800 font-sans selection:bg-amber-200 overflow-hidden">
      {/* Top Header */}
      <header className="h-12 flex items-center justify-between px-4 shrink-0 z-10" style={{ background: themeInfo.gradient }}>
        <div className="flex items-center gap-4">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 -ml-1 rounded-full text-white/80 hover:bg-white/20 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold tracking-tight text-white drop-shadow-sm" style={{ fontFamily: "'SF Pro Display', sans-serif" }}>
              AIEOS
            </span>
            <span className="text-white/40 text-xs">|</span>
            <button
              onClick={handleSwitchProject}
              className="text-sm text-white/70 hover:text-white transition-colors truncate max-w-xs"
              title="Switch project"
            >
              {projectName}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(Object.keys(THEMES) as ThemeId[]).map(id => (
            <button
              key={id}
              onClick={() => setTheme(id)}
              className={cn(
                "w-6 h-6 rounded-full text-xs flex items-center justify-center transition-all",
                theme === id ? "bg-white/30 ring-2 ring-white" : "hover:bg-white/20"
              )}
              title={THEMES[id].label}
            >
              <Icon name={THEMES[id].icon} size={16} />
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={cn("bg-white border-r border-stone-200 flex-shrink-0 overflow-y-auto flex flex-col py-2 transition-all duration-200", sidebarOpen ? "w-56" : "w-0 border-r-0 overflow-hidden")}>
          <div className="flex flex-col">
            {navSections.map((section) => (
              <SidebarSection key={section.title} title={section.title}>
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <NavItem
                      key={item.id}
                      active={activePage === item.id}
                      label={item.label}
                      onClick={() => openApp(item.id)}
                    />
                  ))}
                </div>
              </SidebarSection>
            ))}
          </div>

          {/* Switch project button at bottom */}
          <div className="mt-auto px-3 py-2">
            <button
              onClick={handleSwitchProject}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-stone-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 .75.75V21m-6 0H9m4.5 0h6m-6 0V9m0 12H3.75a.75.75 0 0 1-.75-.75V13.5m16.5 0V3.75a.75.75 0 0 0-.75-.75H4.5a.75.75 0 0 0-.75.75v9.75m15 0h-1.5" />
              </svg>
              Switch Project
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-hidden bg-orange-50/40 flex flex-col">
          {/* Tabs */}
          <div className="flex w-full items-end gap-1 overflow-x-auto bg-stone-100 px-4 pt-2 border-b border-stone-200" style={{ scrollbarWidth: 'none' }}>
            {openTabs.map((tabId) => {
              const isActive = activePage === tabId;
              return (
                <div
                  key={tabId}
                  onClick={() => setActivePage(tabId)}
                  className={cn(
                    "group relative flex cursor-pointer items-center justify-between gap-3 px-4 py-1.5 text-sm transition-all border-t border-l border-r border-transparent rounded-t-md",
                    isActive
                      ? "bg-white text-orange-600 font-medium border-stone-200 -mb-px pb-[7px] shadow-sm"
                      : "bg-transparent text-stone-500 hover:bg-stone-200/50"
                  )}
                >
                  <span className="truncate whitespace-nowrap">{labelFor(tabId)}</span>
                  {tabId !== "release.files" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tabId); }}
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-orange-200",
                        isActive ? "text-stone-400 hover:text-rose-500" : "text-stone-400 opacity-0 group-hover:opacity-100 hover:text-rose-500"
                      )}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3 w-3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex-1 w-full flex flex-col min-h-0 overflow-hidden bg-orange-50/20 relative">
            {openTabs.map((tabId) => (
              <div
                key={tabId}
                className="absolute inset-0"
                style={{
                  visibility: activePage === tabId ? "visible" : "hidden",
                  pointerEvents: activePage === tabId ? "auto" : "none",
                }}
              >
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
