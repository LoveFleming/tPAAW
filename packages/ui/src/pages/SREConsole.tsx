/**
 * SREConsole — SRE Operations Console
 *
 * Layout:
 *  ┌──────────────┬──────────────────────────┐
 *  │  SRE Crew    │  Dashboard / Agent Console│
 *  │  List        │  (tab switch)             │
 *  │  + Tabs      │                          │
 *  │  + Actions   │                          │
 *  └──────────────┴──────────────────────────┘
 */
import API_BASE from "../api";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import { useTheme } from "../theme";
import MarkdownText from "../components/MarkdownText";
import AgentConsole, { type AgentConsoleHandle } from "../components/AgentConsole";
import SREDashboard from "./SREDashboard";

// ── Types ──
interface Crew {
  id: string;
  title: string;
  codename: string;
  emoji: string;
  description: string;
  imageUrl?: string;
  expertise?: string;
  chatConfig?: { greeting?: string };
  rolePrompt?: string;
}

const SRE_EMOJI: Record<string, string> = {
  "sre.commander": "🛡️",
  "sre.metrics": "📊",
  "sre.logs": "📋",
  "sre.runbook": "📖",
  "sre.responder": "🔧",
  "sre.security": "🔒",
};

const QUICK_ACTIONS = [
  { id: "check-latency", label: "查延遲", prompt: "幫我查各服務的 p99 latency，看有沒有異常飆高的", icon: "🔍" },
  { id: "check-errors", label: "查錯誤率", prompt: "幫我查最近 1 小時的 5xx 錯誤率，哪些 service 最高？", icon: "🔴" },
  { id: "check-resources", label: "資源使用", prompt: "幫我查各 service 的 CPU 和 Memory 使用率，有沒有接近極限的？", icon: "💻" },
  { id: "check-alerts", label: "查看 Alerts", prompt: "目前有哪些 firing alerts？依嚴重程度排列", icon: "🚨" },
  { id: "health-check", label: "健康檢查", prompt: "做一次全面健康檢查：latency、error rate、resource usage", icon: "❤️" },
  { id: "security-scan", label: "安全掃描", prompt: "做一次基本安全掃描，檢查有沒有高風險問題", icon: "🔒" },
];

const COMMANDER_ID = "sre.commander";

export default function SREConsole() {
  const { t: tt } = useI18n();
  const { info: t } = useTheme();

  const [crew, setCrew] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCrewId, setSelectedCrewId] = useState<string>(COMMANDER_ID);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [chatStarted, setChatStarted] = useState(false);
  const [consoleKey, setConsoleKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"console" | "dashboard">("console");

  const consoleRef = useRef<AgentConsoleHandle>(null);

  const loadCrew = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/crew`);
      if (resp.ok) {
        const all: Crew[] = await resp.json();
        setCrew(all.filter(c => c.id.startsWith("sre.")));
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadCrew(); }, [loadCrew]);

  const loadSystemPrompt = useCallback(async (crewId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/context/employee?crewId=${encodeURIComponent(crewId)}`);
      if (res.ok) {
        const ctx = await res.json();
        setSystemPrompt(ctx.systemPrompt || "");
      } else {
        const crewResp = await fetch(`${API_BASE}/api/crew/${encodeURIComponent(crewId)}`);
        if (crewResp.ok) {
          const crewData = await crewResp.json();
          setSystemPrompt(crewData.rolePrompt || "");
        }
      }
    } catch { setSystemPrompt(""); }
  }, []);

  const switchCrew = useCallback((crewId: string) => {
    setSelectedCrewId(crewId);
    setChatStarted(false);
    setConsoleKey(k => k + 1);
    loadSystemPrompt(crewId);
  }, [loadSystemPrompt]);

  useEffect(() => { loadSystemPrompt(COMMANDER_ID); }, [loadSystemPrompt]);

  const handleQuickAction = useCallback((prompt: string) => {
    if (selectedCrewId !== COMMANDER_ID) {
      switchCrew(COMMANDER_ID);
      setTimeout(() => {
        consoleRef.current?.sendPrompt(prompt);
        setChatStarted(true);
      }, 500);
    } else {
      consoleRef.current?.sendPrompt(prompt);
      setChatStarted(true);
    }
  }, [selectedCrewId, switchCrew]);

  const selectedCrew = useMemo(() => crew.find(c => c.id === selectedCrewId), [crew, selectedCrewId]);
  const isCommander = selectedCrewId === COMMANDER_ID;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-stone-400 text-sm animate-pulse">Loading SRE Console...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-stone-50">
      {/* ── Left Panel ── */}
      <div className="flex flex-col flex-shrink-0 border-r" style={{ width: 240, borderColor: t.accentBorder + "40", backgroundColor: "white" }}>
        {/* Header + Tabs */}
        <div className="px-4 py-3 border-b" style={{ borderColor: t.accentBorder + "40", backgroundColor: t.accentBg }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🛡️</span>
            <div>
              <div className="font-bold text-sm" style={{ color: t.accent }}>SRE Console</div>
              <div className="text-[10px] opacity-70">Site Reliability</div>
            </div>
          </div>
          {/* Tab Switcher */}
          <div className="flex gap-1 mt-2">
            <button
              onClick={() => setActiveTab("console")}
              className={cn("flex-1 text-[10px] py-1 rounded-md font-medium transition-colors",
                activeTab === "console" ? "text-white" : "text-stone-500 hover:bg-stone-100")}
              style={activeTab === "console" ? { backgroundColor: t.accent } : undefined}
            >
              💬 Console
            </button>
            <button
              onClick={() => setActiveTab("dashboard")}
              className={cn("flex-1 text-[10px] py-1 rounded-md font-medium transition-colors",
                activeTab === "dashboard" ? "text-white" : "text-stone-500 hover:bg-stone-100")}
              style={activeTab === "dashboard" ? { backgroundColor: t.accent } : undefined}
            >
              📊 Dashboard
            </button>
          </div>
        </div>

        {/* Quick Actions (Console tab + Commander only) */}
        {activeTab === "console" && isCommander && (
          <div className="px-3 py-2 border-b" style={{ borderColor: t.accentBorder + "20" }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5 px-1">Quick Actions</div>
            <div className="space-y-1">
              {QUICK_ACTIONS.map(action => (
                <button
                  key={action.id}
                  onClick={() => handleQuickAction(action.prompt)}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-xs hover:bg-stone-100 transition-colors"
                >
                  <span className="mr-1.5">{action.icon}</span>
                  <span className="text-stone-700">{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Crew List (Console tab only) */}
        {activeTab === "console" && (
          <div className="flex-1 overflow-y-auto px-3 py-2" style={{ scrollbarWidth: "thin" }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5 px-1">SRE Team</div>
            <div className="space-y-1">
              {crew.map(member => {
                const isSelected = member.id === selectedCrewId;
                const isCmd = member.id === COMMANDER_ID;
                return (
                  <button
                    key={member.id}
                    onClick={() => switchCrew(member.id)}
                    className={cn(
                      "w-full text-left px-2 py-2 rounded-lg transition-all border",
                      isSelected ? "border-2 shadow-sm" : "border-transparent hover:bg-stone-50"
                    )}
                    style={isSelected ? { borderColor: t.accent, backgroundColor: t.accentBg } : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base flex-shrink-0">{member.emoji || SRE_EMOJI[member.id] || "👤"}</span>
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-xs font-semibold truncate", isSelected ? "" : "text-stone-800")} style={isSelected ? { color: t.accent } : undefined}>
                          {member.title}
                          {isCmd && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 rounded">CMD</span>}
                        </div>
                        <div className="text-[10px] text-stone-400 truncate">{member.codename}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Dashboard tab shows mini summary instead of crew list */}
        {activeTab === "dashboard" && (
          <div className="flex-1 overflow-y-auto px-3 py-2" style={{ scrollbarWidth: "thin" }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5 px-1">Providers</div>
            <div className="space-y-1 text-[10px] text-stone-500">
              <div className="flex items-center gap-1.5 px-1 py-0.5"><span>📊</span> Prometheus</div>
              <div className="flex items-center gap-1.5 px-1 py-0.5"><span>📋</span> Loki</div>
              <div className="flex items-center gap-1.5 px-1 py-0.5"><span>🗂️</span> Kubernetes</div>
              <div className="flex items-center gap-1.5 px-1 py-0.5"><span>🖥️</span> Shell</div>
              <div className="flex items-center gap-1.5 px-1 py-0.5"><span>🔒</span> Security</div>
              <div className="flex items-center gap-1.5 px-1 py-0.5"><span>📖</span> Runbooks</div>
            </div>
            <div className="mt-3 px-1">
              <div className="text-[10px] text-stone-400 leading-relaxed">
                Dashboard 每 30 秒自動刷新。切到 Console 分頁可與 SRE 團隊對話。
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-3 py-2 border-t text-[10px] text-stone-400" style={{ borderColor: t.accentBorder + "20" }}>
          Phase 4 — Dashboard + Console
        </div>
      </div>

      {/* ── Right Panel ── */}
      {activeTab === "dashboard" ? (
        <div className="flex-1 min-w-0 overflow-hidden">
          <SREDashboard />
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-w-0">
          {/* Chat Header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b flex-shrink-0" style={{ borderColor: t.accentBorder + "40", backgroundColor: t.accentBg + "50" }}>
            {selectedCrew && (
              <>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: t.accent + "20", border: `2px solid ${t.accent}40` }}>
                  {selectedCrew.emoji || SRE_EMOJI[selectedCrew.id] || "👤"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-stone-800">{selectedCrew.title}</div>
                  <div className="text-xs text-stone-500">{selectedCrew.codename}</div>
                </div>
                {isCommander && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium" style={{ backgroundColor: "#f59e0b20", color: "#b45309" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Commander — 可 dispatch
                  </div>
                )}
              </>
            )}
          </div>

          {/* AgentConsole or Landing */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {!chatStarted && selectedCrew ? (
              <div className="h-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                <div className="max-w-2xl mx-auto mt-8 px-4 space-y-6 pb-8">
                  <div className="text-center">
                    <div className="text-4xl mb-3">{selectedCrew.emoji || SRE_EMOJI[selectedCrew.id]}</div>
                    <h2 className="text-xl font-bold text-stone-800">{selectedCrew.codename}</h2>
                    <p className="text-sm text-stone-500 mt-1">{selectedCrew.title}</p>
                  </div>

                  {selectedCrew.description && (
                    <div className="text-center text-sm text-stone-600 max-w-md mx-auto">{selectedCrew.description}</div>
                  )}

                  {selectedCrew.chatConfig?.greeting && (
                    <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-sm">
                      <MarkdownText>{selectedCrew.chatConfig.greeting}</MarkdownText>
                    </div>
                  )}

                  {isCommander && (
                    <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-sm">
                      <div className="text-xs font-semibold text-stone-500 mb-3">⚡ 快速指令</div>
                      <div className="grid grid-cols-2 gap-2">
                        {QUICK_ACTIONS.map(action => (
                          <button
                            key={action.id}
                            onClick={() => handleQuickAction(action.prompt)}
                            className="text-left px-3 py-2.5 rounded-xl border border-stone-200 hover:border-stone-300 hover:bg-stone-50 transition-all text-xs"
                          >
                            <div className="font-medium text-stone-700">
                              <span className="mr-1">{action.icon}</span>{action.label}
                            </div>
                            <div className="text-[10px] text-stone-400 mt-0.5 line-clamp-2">{action.prompt}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedCrew.expertise && (
                    <div className="bg-stone-50 rounded-xl p-3 border border-stone-100">
                      <div className="text-xs font-semibold text-stone-500 mb-2">專業技能</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedCrew.expertise.split("\n").filter(Boolean).map((skill, i) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-stone-200 text-stone-600">
                            {skill.trim()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <AgentConsole
                key={`sre-${consoleKey}`}
                ref={consoleRef}
                systemPrompt={systemPrompt || undefined}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
