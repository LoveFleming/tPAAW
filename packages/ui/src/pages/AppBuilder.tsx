import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../utils";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import { SkillDefinition } from "../types";
import AgentConsole, { AgentConsoleHandle } from "../components/AgentConsole";

import API from "../api";
import ModelSelector from "../components/ModelSelector";

const TEMPLATE_ICONS: Record<string, string> = {
    custom: "✨",
    "sidebar-tabs": "🗂️",
    dashboard: "📊",
    table: "📋",
    chart: "📈",
    mixed: "🎛️",
};

// ── Types ──
type Step = 1 | 2 | 3;
interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    text: string;
    ts: number;
}

interface HistoryEntry {
    id: string;
    name: string;
    template: string;
    status: string;
    generatedAt: string;
    description: string;
}

// ── Template Data with Visual Mockups ──
interface TemplateDef {
    id: string;
    name: string;
    icon: string;
    desc: string;
    mockup: string; // SVG inline
}

const TEMPLATES: TemplateDef[] = [
    {
        id: "custom",
        name: "不選版型",
        icon: "✨",
        desc: "完全自由發揮,用描述決定一切",
        mockup: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="140" rx="6" fill="#1e293b"/>
            <text x="100" y="60" fill="#475569" font-size="28" text-anchor="middle">✨</text>
            <text x="100" y="85" fill="#64748b" font-size="8" text-anchor="middle">Free Style</text>
            <text x="100" y="100" fill="#475569" font-size="6" text-anchor="middle">用描述打造你要的頁面</text>
        </svg>`,
    },
    {
        id: "sidebar-tabs",
        name: "Sidebar + Tabs",
        icon: "🗂️",
        desc: "左側選單 + 右側分頁,像 Dashboard 後台",
        mockup: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="140" rx="6" fill="#1e293b"/>
            <rect x="0" y="0" width="45" height="140" rx="6" fill="#0f172a"/>
            <rect x="8" y="12" width="28" height="6" rx="2" fill="#3b82f6"/>
            <rect x="8" y="24" width="28" height="4" rx="1" fill="#334155"/>
            <rect x="8" y="32" width="28" height="4" rx="1" fill="#475569"/>
            <rect x="8" y="40" width="28" height="4" rx="1" fill="#334155"/>
            <rect x="8" y="48" width="28" height="4" rx="1" fill="#334155"/>
            <rect x="8" y="60" width="28" height="4" rx="1" fill="#334155"/>
            <rect x="8" y="68" width="28" height="4" rx="1" fill="#334155"/>
            <rect x="8" y="76" width="28" height="4" rx="1" fill="#334155"/>
            <circle cx="22" cy="125" r="8" fill="#334155"/>
            <text x="22" y="128" fill="#94a3b8" font-size="6" text-anchor="middle">👤</text>
            <rect x="52" y="10" width="40" height="12" rx="3" fill="#334155"/>
            <text x="72" y="19" fill="#94a3b8" font-size="5" text-anchor="middle">Tab 1</text>
            <rect x="96" y="10" width="40" height="12" rx="3" fill="#3b82f6"/>
            <text x="116" y="19" fill="#f1f5f9" font-size="5" text-anchor="middle">Tab 2</text>
            <rect x="140" y="10" width="40" height="12" rx="3" fill="#334155"/>
            <text x="160" y="19" fill="#94a3b8" font-size="5" text-anchor="middle">Tab 3</text>
            <rect x="52" y="28" width="65" height="50" rx="4" fill="#334155"/>
            <text x="84" y="48" fill="#64748b" font-size="5" text-anchor="middle">Content Area</text>
            <rect x="122" y="28" width="65" height="50" rx="4" fill="#334155"/>
            <rect x="130" y="40" width="20" height="3" rx="1" fill="#475569"/>
            <rect x="130" y="48" width="35" height="3" rx="1" fill="#475569"/>
            <rect x="130" y="56" width="25" height="3" rx="1" fill="#475569"/>
            <rect x="52" y="84" width="135" height="46" rx="4" fill="#334155"/>
            <rect x="60" y="92" width="55" height="5" rx="1" fill="#475569"/>
            <rect x="120" y="92" width="55" height="5" rx="1" fill="#475569"/>
            <rect x="60" y="102" width="119" height="4" rx="1" fill="#1e293b"/>
            <rect x="60" y="110" width="119" height="4" rx="1" fill="#1e293b"/>
            <rect x="60" y="118" width="119" height="4" rx="1" fill="#1e293b"/>
        </svg>`,
    },
    {
        id: "dashboard",
        name: "Dashboard",
        icon: "📊",
        desc: "KPI cards + charts,適合概覽",
        mockup: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="140" rx="6" fill="#1e293b"/>
            <rect x="10" y="10" width="55" height="35" rx="4" fill="#334155"/>
            <text x="38" y="25" fill="#94a3b8" font-size="5" text-anchor="middle">Tasks</text>
            <text x="38" y="38" fill="#22c55e" font-size="12" font-weight="bold" text-anchor="middle">42</text>
            <rect x="72" y="10" width="55" height="35" rx="4" fill="#334155"/>
            <text x="100" y="25" fill="#94a3b8" font-size="5" text-anchor="middle">Done</text>
            <text x="100" y="38" fill="#3b82f6" font-size="12" font-weight="bold" text-anchor="middle">18</text>
            <rect x="134" y="10" width="55" height="35" rx="4" fill="#334155"/>
            <text x="162" y="25" fill="#94a3b8" font-size="5" text-anchor="middle">Progress</text>
            <text x="162" y="38" fill="#f59e0b" font-size="12" font-weight="bold" text-anchor="middle">67%</text>
            <rect x="10" y="52" width="88" height="78" rx="4" fill="#334155"/>
            <rect x="18" y="110" width="12" height="12" rx="2" fill="#22c55e" transform="rotate(180 24 116)"/>
            <rect x="34" y="95" width="12" height="27" rx="2" fill="#3b82f6" transform="rotate(180 40 108)"/>
            <rect x="50" y="85" width="12" height="37" rx="2" fill="#f59e0b" transform="rotate(180 56 103)"/>
            <rect x="66" y="100" width="12" height="22" rx="2" fill="#8b5cf6" transform="rotate(180 72 111)"/>
            <rect x="82" y="108" width="12" height="14" rx="2" fill="#ef4444" transform="rotate(180 88 115)"/>
            <rect x="104" y="52" width="86" height="78" rx="4" fill="#334155"/>
            <circle cx="147" cy="90" r="25" fill="none" stroke="#334155" stroke-width="8"/>
            <circle cx="147" cy="90" r="25" fill="none" stroke="#22c55e" stroke-width="8" stroke-dasharray="110 47" stroke-dashoffset="0" transform="rotate(-90 147 90)"/>
            <text x="147" y="93" fill="#f1f5f9" font-size="9" font-weight="bold" text-anchor="middle">70%</text>
        </svg>`,
    },
    {
        id: "table",
        name: "Table",
        icon: "📋",
        desc: "Data table + filters,適合清單",
        mockup: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="140" rx="6" fill="#1e293b"/>
            <rect x="10" y="10" width="50" height="14" rx="3" fill="#334155"/>
            <rect x="65" y="10" width="50" height="14" rx="3" fill="#334155"/>
            <rect x="120" y="10" width="35" height="14" rx="3" fill="#3b82f6"/>
            <text x="137" y="20" fill="#f1f5f9" font-size="6" text-anchor="middle">Filter</text>
            <rect x="10" y="30" width="180" height="16" rx="2" fill="#475569"/>
            <text x="20" y="41" fill="#94a3b8" font-size="6">Name</text>
            <text x="80" y="41" fill="#94a3b8" font-size="6">Status</text>
            <text x="140" y="41" fill="#94a3b8" font-size="6">Date</text>
            <rect x="10" y="50" width="180" height="14" rx="2" fill="#334155"/>
            <rect x="73" y="53" width="30" height="8" rx="2" fill="#22c55e33"/>
            <text x="80" y="59" fill="#22c55e" font-size="5">Done</text>
            <rect x="10" y="68" width="180" height="14" rx="2" fill="#1e293b"/>
            <rect x="73" y="71" width="38" height="8" rx="2" fill="#3b82f633"/>
            <text x="80" y="77" fill="#3b82f6" font-size="5">Active</text>
            <rect x="10" y="86" width="180" height="14" rx="2" fill="#334155"/>
            <rect x="73" y="89" width="30" height="8" rx="2" fill="#f59e0b33"/>
            <text x="80" y="95" fill="#f59e0b" font-size="5">Todo</text>
            <rect x="10" y="104" width="180" height="14" rx="2" fill="#1e293b"/>
            <rect x="73" y="107" width="30" height="8" rx="2" fill="#22c55e33"/>
            <text x="80" y="113" fill="#22c55e" font-size="5">Done</text>
            <rect x="60" y="124" width="22" height="8" rx="2" fill="#334155"/>
            <rect x="85" y="124" width="22" height="8" rx="2" fill="#3b82f6"/>
            <rect x="110" y="124" width="22" height="8" rx="2" fill="#334155"/>
        </svg>`,
    },
    {
        id: "chart",
        name: "Chart",
        icon: "📈",
        desc: "Charts focused,適合趨勢分析",
        mockup: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="140" rx="6" fill="#1e293b"/>
            <text x="100" y="20" fill="#94a3b8" font-size="6" text-anchor="middle">Trend Overview</text>
            <polyline points="15,110 40,90 65,95 90,60 115,55 140,40 165,45 185,30" fill="none" stroke="#3b82f6" stroke-width="2"/>
            <polyline points="15,115 40,100 65,105 90,80 115,75 140,65 165,70 185,55" fill="none" stroke="#22c55e" stroke-width="2"/>
            <circle cx="90" cy="60" r="3" fill="#3b82f6"/>
            <circle cx="140" cy="40" r="3" fill="#3b82f6"/>
            <circle cx="185" cy="30" r="3" fill="#3b82f6"/>
            <rect x="40" y="120" width="8" height="4" rx="1" fill="#3b82f6"/>
            <text x="52" y="124" fill="#94a3b8" font-size="5">Series A</text>
            <rect x="90" y="120" width="8" height="4" rx="1" fill="#22c55e"/>
            <text x="102" y="124" fill="#94a3b8" font-size="5">Series B</text>
        </svg>`,
    },
    {
        id: "mixed",
        name: "Mixed",
        icon: "🎛️",
        desc: "Charts + table + AI 分析",
        mockup: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="140" rx="6" fill="#1e293b"/>
            <rect x="10" y="10" width="88" height="55" rx="4" fill="#334155"/>
            <rect x="16" y="48" width="8" height="12" rx="1" fill="#22c55e" transform="rotate(180 20 54)"/>
            <rect x="28" y="38" width="8" height="22" rx="1" fill="#3b82f6" transform="rotate(180 32 49)"/>
            <rect x="40" y="42" width="8" height="18" rx="1" fill="#f59e0b" transform="rotate(180 44 51)"/>
            <rect x="52" y="50" width="8" height="10" rx="1" fill="#8b5cf6" transform="rotate(180 56 55)"/>
            <rect x="64" y="52" width="8" height="8" rx="1" fill="#ef4444" transform="rotate(180 68 56)"/>
            <rect x="104" y="10" width="86" height="55" rx="4" fill="#334155"/>
            <polyline points="112,50 130,38 150,42 170,28 180,25" fill="none" stroke="#3b82f6" stroke-width="1.5"/>
            <circle cx="170" cy="28" r="2" fill="#3b82f6"/>
            <rect x="10" y="72" width="180" height="58" rx="4" fill="#334155"/>
            <rect x="16" y="78" width="50" height="5" rx="1" fill="#475569"/>
            <rect x="80" y="78" width="35" height="5" rx="1" fill="#475569"/>
            <rect x="125" y="78" width="55" height="5" rx="1" fill="#475569"/>
            <rect x="16" y="90" width="168" height="6" rx="1" fill="#1e293b"/>
            <rect x="16" y="100" width="168" height="6" rx="1" fill="#1e293b"/>
            <rect x="16" y="110" width="168" height="6" rx="1" fill="#1e293b"/>
            <rect x="80" y="93" width="22" height="3" rx="1" fill="#22c55e33"/>
            <rect x="80" y="103" width="28" height="3" rx="1" fill="#3b82f633"/>
        </svg>`,
    },
];

const USER_PROMPT_TEMPLATE = `請根據以下規格建立 App:

## App 規格
- Template 類型: {{TEMPLATE}}
- App 名稱: {{REPORT_NAME}}
- 需求描述: {{PARAMS}}
- 綁定 Skill: {{SKILL_ID}}

## 技術要求
1. 純 HTML,所有 CSS 和 JS 都內聯
2. 可用 Chart.js (CDN: https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js) 畫圖表
3. 可用 marked.js (CDN: https://cdn.jsdelivr.net/npm/marked/marked.min.js) render markdown
4. 風格:深色主題(stone/slate 色系)或根據描述調整
5. 響應式設計
6. 用合理的假數據做 static 展示
7. 如指定 sidebar-tabs 版型:左側固定選單(icon + 文字)+ 右側分頁切換內容

## 如果是 skill-based App
- 請同時建立 SKILL.md(按 app-builder 規範的格式)
- 定義 Purpose、Inputs、Deterministic Script、Guardrails、Output Contract
- 設定觸發關鍵字(triggers)

## 輸出指示
- 只輸出 HTML 代碼
- HTML 開頭是 <!DOCTYPE html>
- 如果要建立 SKILL.md,用 write_file 工具寫入`;

// ── Skill Picker Dialog ──
function SkillPickerDialog({
    skills,
    onSelect,
    onClose,
}: {
    skills: SkillDefinition[];
    onSelect: (sk: SkillDefinition) => void;
    onClose: () => void;
}) {
    const { info: t } = useTheme();
    const { t: tt } = useI18n();
    const [search, setSearch] = useState("");
    const filtered = skills.filter(sk =>
        sk.name.toLowerCase().includes(search.toLowerCase()) ||
        sk.id.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border" style={{ borderColor: t.accentBorder }}
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#e7e5e4" }}>
                    <h3 className="text-sm font-bold text-stone-700">📦 {tt("appBuilder.selectBaseSkill", "選擇基底 Skill")}</h3>
                    <button onClick={onClose} className="text-stone-400 hover:text-red-400 text-lg leading-none">&times;</button>
                </div>
                <div className="px-5 pt-3">
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder={tt("appBuilder.searchSkillPlaceholder")} autoFocus
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-stone-300"
                        style={{ borderColor: "#d6d3d1" }} />
                </div>
                <div className="max-h-72 overflow-y-auto p-3 space-y-1.5">
                    {filtered.map(sk => (
                        <button key={sk.id} onClick={() => { onSelect(sk); onClose(); }}
                            className="w-full text-left p-3 border rounded-lg hover:shadow-sm transition-all text-sm"
                            style={{ borderColor: "#e7e5e4" }}>
                            <span className="font-semibold text-stone-700">{sk.name}</span>
                            <span className="text-xs text-stone-400 ml-2 font-mono">{sk.id}</span>
                        </button>
                    ))}
                    {filtered.length === 0 && (
                        <div className="text-center text-stone-400 text-xs py-6">找不到符合的 Skill</div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Main Component ──
export default function AppBuilder() {
  const { t: tt } = useI18n();
    const { info: t } = useTheme();

    // ── Flow state ──
    const [step, setStep] = useState<Step>(1);
    const [selectedTemplate, setSelectedTemplate] = useState<string>("");
    const [reportName, setReportName] = useState("");
    const [description, setDescription] = useState("");
    const [model, setModel] = useState("");
    const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null);

    // Model loaded via ModelSelector with user preference

    // ── Prompt Preview ──
    const [promptPreview, setPromptPreview] = useState(false);
    const [promptPreviewContent, setPromptPreviewContent] = useState<{system: string; prompt: string} | null>(null);

    const handlePreviewPrompt = async () => {
        let sysPrompt = "(System prompt is loaded automatically by agent loop from context engine)";
        let userPrompt = "";
        const skillId = selectedSkill?.id || "no-skill";
        const outputInstruction = `\n\n---\n**重要指示：** \n1. 只能修改 data/apps/${reportId}/ 目錄下的檔案（app.html、SKILL.md 等）。\n2. **禁止修改**其他 app 的檔案、data/app-data/、data/chats/、data/config/、packages/、core/。\n3. 將最終的 HTML 結果直接寫入檔案 data/apps/${reportId}/app.html。\n4. 如果要建立 SKILL.md，寫入 data/apps/${reportId}/skills/${skillId}/SKILL.md。\n5. 完成後輸出 DONE。`;
        userPrompt = USER_PROMPT_TEMPLATE
            .replace(/\{\{TEMPLATE\}\}/g, selectedTemplate)
            .replace(/\{\{REPORT_NAME\}\}/g, reportName)
            .replace(/\{\{SKILL_ID\}\}/g, skillId)
            .replace(/\{\{PARAMS\}\}/g, description) + outputInstruction;
        if (systemPromptOverride) {
            userPrompt = `[System Override]\n${systemPromptOverride}\n\n---\n${userPrompt}`;
        }
        // Fetch actual system prompt from context engine for preview
        try {
            const res = await fetch(`${API}/api/context/app-builder`);
            if (res.ok) {
                const ctx = await res.json();
                if (ctx.systemPrompt) sysPrompt = ctx.systemPrompt;
            }
        } catch {}
        setPromptPreviewContent({ system: sysPrompt, prompt: userPrompt });
        setPromptPreview(true);
    };

    // ── Advanced settings (collapsed by default) ──
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [systemPromptOverride, setSystemPromptOverride] = useState("");
    // NOTE: System prompt is loaded by agent loop's context engine automatically.
    // This field is only for user overrides (advanced).

    // Load the real system prompt from context engine (to pass to AgentConsole)
    const [agentSystemPrompt, setAgentSystemPrompt] = useState("");
    useEffect(() => {
        fetch(`${API}/api/context/app-builder`)
            .then(r => r.ok ? r.json() : null)
            .then(ctx => { if (ctx?.systemPrompt) setAgentSystemPrompt(ctx.systemPrompt); })
            .catch(() => {});
    }, []);

    // ── Chat / Terminal state ──
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [generating, setGenerating] = useState(false);
    const generatingRef = useRef(false);
    const [consoleKey, setConsoleKey] = useState(0);
    const [initialPrompt, setInitialPrompt] = useState("");
    const [chatStarted, setChatStarted] = useState(false);
    const terminalRef = useRef<AgentConsoleHandle>(null);

        // ── Derived values (must be before everything that uses them) ──
    const reportId = reportName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-)$/g, "");
    const previewUrl = reportId ? `${API}/api/app/${reportId}` : null;

    // ── Save app builder chat to server ──
    const saveAppChat = useCallback(async (appId: string, msgs: ChatMessage[]) => {
        if (!appId || msgs.length === 0) return;
        try {
            await fetch(`${API}/api/paaw/app-chat/${appId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: msgs }),
            });
        } catch {}
    }, []);

    // ── Load app builder chat from server ──
    const loadAppChat = useCallback(async (appId: string): Promise<ChatMessage[]> => {
        if (!appId) return [];
        try {
            const resp = await fetch(`${API}/api/paaw/app-chat/${appId}`);
            if (resp.ok) {
                const data = await resp.json();
                return data.messages || [];
            }
        } catch {}
        return [];
    }, []);

    // ── Agent done handler ──
    const handleCliDone = useCallback(() => {
        // Only accept cliDone if we're actively generating
        if (!generatingRef.current) {
            console.log('[AppBuilder] Ignored cliDone - not generating');
            return;
        }
        console.log('[AppBuilder] cliDone fired - refreshing preview');
        pollStoppedRef.current = true;
        setPreviewReady(true);
        setPreviewKey(Date.now());
        setGenerating(false); generatingRef.current = false;
        setChatMessages(prev => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].role === "assistant" && updated[i].text.includes("處理中")) {
                    updated[i] = { ...updated[i], text: tt("appBuilder.done") };
                    break;
                }
            }
            // Save updated chat to server
            saveAppChat(reportId, updated);
            return updated;
        });
    }, [reportId, saveAppChat]);

    // ── Preview state ──
    const [previewKey, setPreviewKey] = useState(0);
    const [previewReady, setPreviewReady] = useState(false);
    const [pollTrigger, setPollTrigger] = useState(0);

    // ── Poll app file status until it exists with new mtime ──
    const pollStartRef = useRef(0);
    const pollStoppedRef = useRef(false);

    useEffect(() => {
        if (pollTrigger === 0 || !reportId) return;
        pollStartRef.current = Date.now();
        pollStoppedRef.current = false;
        setPreviewReady(false);
        let stopped = false;
        let lastSeenMtime = 0;
        let fileExistedDuringWarmup = false;
        let pollCount = 0;

        // Shared completion handler - called when polling detects app is ready
        const finishPolling = (reason: string) => {
            if (stopped) return;
            clearInterval(timer);
            stopped = true;
            console.log(`[Poll] finishPolling: ${reason}`);
            setPreviewReady(true);
            setPreviewKey(Date.now());
            setGenerating(false); generatingRef.current = false;
            fetch(`${API}/api/app/${reportId}/publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            }).catch(() => {});
            setChatMessages(prev => {
                const updated = [...prev];
                for (let i = updated.length - 1; i >= 0; i--) {
                    if (updated[i].role === "assistant") {
                        updated[i] = { ...updated[i], text: tt("appBuilder.done") };
                        break;
                    }
                }
                saveAppChat(reportId, updated);
                return updated;
            });
        };

        const timer = setInterval(() => {
            if (stopped || pollStoppedRef.current) return;
            pollCount++;
            fetch(`${API}/api/app/${reportId}/status`)
                .then(r => r.json())
                .then(({ exists, mtime }) => {
                    if (stopped || pollStoppedRef.current) return;
                    // Skip first 2 polls (4s warmup) but track file existence
                    if (pollCount <= 2) {
                        if (exists) fileExistedDuringWarmup = true;
                        return;
                    }
                    if (!exists || !mtime) return;
                    // Case 1: File didn't exist during warmup → newly created → DONE
                    if (!fileExistedDuringWarmup) {
                        finishPolling(`new file appeared (mtime=${mtime})`);
                        return;
                    }
                    // Case 2: File existed → wait for mtime change
                    if (!lastSeenMtime) {
                        lastSeenMtime = mtime;
                        console.log(`[Poll #${pollCount}] baseline mtime=${mtime}`);
                        return;
                    }
                    if (mtime > lastSeenMtime) {
                        finishPolling(`mtime changed ${lastSeenMtime} → ${mtime}`);
                    }
                })
                .catch(() => {});
            if (Date.now() - pollStartRef.current > 600000) {
                clearInterval(timer);
                stopped = true;
            }
        }, 2000);
        return () => { clearInterval(timer); stopped = true; };
    }, [pollTrigger, reportId]);

    // ── Data ──
    const [skills, setSkills] = useState<SkillDefinition[]>([]);
    const [showSkillPicker, setShowSkillPicker] = useState(false);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [workingDir, setWorkingDir] = useState("");

    // ── Existing apps ──
    const [existingApps, setExistingApps] = useState<{id: string; name: string; description: string; template: string; status: string}[]>([]);
    const [editingAppId, setEditingAppId] = useState<string | null>(null);
    const [showAppPicker, setShowAppPicker] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [showRevisionLog, setShowRevisionLog] = useState(false);

    // ── App Settings panel (edit mode) ──
    const [showSettings, setShowSettings] = useState(false);
    const [appSettings, setAppSettings] = useState<{
        name: string; icon: string; description: string; type: string;
        dataShape: string; engine: string; aiPrompt: string; triggers: string;
        schema: string;
        skillsText: string;
    }>({ name: "", icon: "", description: "", type: "data", dataShape: "array", engine: "paaw-agent", aiPrompt: "", triggers: "", schema: "", skillsText: "" });
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsSaved, setSettingsSaved] = useState(false);

    // ── Load skills ──
    useEffect(() => {
        fetch(`${API}/api/skills`).then(r => r.json()).then(setSkills).catch(() => {});
    }, []);

    useEffect(() => {
        fetch(`${API}/api/paaw-root`)
            .then(r => r.ok ? r.json() : {})
            .then((d: { paawRoot?: string }) => { if (d.paawRoot) setWorkingDir(d.paawRoot + "/data"); })
            .catch(() => {});
    }, []);

    // ── Load existing apps (also used as history) ──
    const loadExistingApps = useCallback(() => {
        fetch(`${API}/api/apps`)
            .then(r => r.json())
            .then((apps: any[]) => {
                setExistingApps(apps);
                setHistory(apps.map(app => ({
                    id: app.id,
                    name: app.name,
                    template: app.template,
                    status: app.status,
                    generatedAt: app.generatedAt,
                    description: app.description,
                })));
            })
            .catch(() => {});
    }, []);
    useEffect(() => { loadExistingApps(); }, [loadExistingApps]);

    // ── Load existing app for editing ──
    const handleEditApp = useCallback(async (appId: string) => {
        setEditingAppId(appId);
        setReportName(appId);
        setStep(3);
        setPreviewReady(true);
        setPreviewKey(Date.now());
        setShowAppPicker(false);
        setShowSettings(false);
        // Load app.json settings
        try {
            const resp = await fetch(`${API}/api/apps`);
            const apps = await resp.json();
            const app = apps.find((a: any) => a.id === appId);
            if (app) {
                setAppSettings({
                    name: app.name || "",
                    icon: app.icon || "",
                    description: app.description || "",
                    type: app.type || "data",
                    dataShape: app.dataShape || "array",
                    engine: app.engine || "paaw-agent",
                    aiPrompt: app.aiPrompt || "",
                    triggers: (app.triggers || []).join(", "),
                    schema: app.schema ? JSON.stringify(app.schema, null, 2) : "",
                    skillsText: app.skills ? JSON.stringify(app.skills, null, 2) : "",
                });
            }
        } catch {}
        // Load previous chat messages from server
        const savedChat = await loadAppChat(appId);
        if (savedChat.length > 0) {
            setChatStarted(true);
            setChatMessages(savedChat);
        } else {
            setChatStarted(false);
            setChatMessages([]);
        }
    }, [loadAppChat]);

    // ── Unpublish app ──
    const handleUnpublish = useCallback((appId: string) => {
        if (!confirm(`確定要下架「${appId}」嗎?app.html 會被移除,但 app.json 會保留。`)) return;
        fetch(`${API}/api/app/${appId}`, { method: "DELETE" })
            .then(r => r.json())
            .then(() => loadExistingApps())
            .catch(() => {});
    }, [loadExistingApps]);

    // ── Save app settings ──
    const handleSaveSettings = useCallback(async () => {
        if (!editingAppId) return;
        setSettingsSaving(true);
        setSettingsSaved(false);
        try {
            const changes: Record<string, any> = {
                name: appSettings.name,
                icon: appSettings.icon,
                description: appSettings.description,
                type: appSettings.type,
                dataShape: appSettings.dataShape,
                engine: appSettings.engine,
                aiPrompt: appSettings.aiPrompt,
                triggers: appSettings.triggers.split(",").map((s: string) => s.trim()).filter(Boolean),
            };
            if (appSettings.schema.trim()) {
                try { changes.schema = JSON.parse(appSettings.schema); } catch {}
            }
            if (appSettings.skillsText.trim()) {
                try { changes.skills = JSON.parse(appSettings.skillsText); } catch {}
            }
            await fetch(`${API}/api/apps/${editingAppId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(changes),
            });
            setSettingsSaved(true);
            setTimeout(() => setSettingsSaved(false), 2000);
        } catch {}
        setSettingsSaving(false);
    }, [editingAppId, appSettings]);

        // ── Send to terminal ──
    const sendToTerminal = useCallback((text: string) => {
        if (!text.trim()) return;
        if (!chatStarted) {
            setInitialPrompt(text);
            setChatStarted(true);
            setConsoleKey(prev => prev + 1);
        } else {
            terminalRef.current?.sendPrompt(text);
        }
    }, [chatStarted]);

    // ── Generate ──
    const handleGenerate = useCallback(() => {
        if (!reportName || !selectedTemplate) return;

        setChatMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: "user",
            text: description || `用 ${selectedTemplate} 模板建立「${reportName}」`,
            ts: Date.now(),
        }]);

        setGenerating(true); generatingRef.current = true;
        setStep(3);
        setPreviewReady(false);
        setPollTrigger(t => t + 1);

        const skillId = selectedSkill?.id || "no-skill";
        const workDir = workingDir ? `${workingDir}/apps/${reportId}` : `data/apps/${reportId}`;
        const outputInstruction = `\n\n---\n**重要指示:** \n1. 只能修改 data/apps/${reportId}/ 目錄下的檔案(app.html、SKILL.md 等)。\n2. **禁止修改**其他 app 的檔案、data/app-data/、data/chats/、data/config/、packages/、core/。\n3. 將最終的 HTML 結果直接寫入檔案 data/apps/${reportId}/app.html。\n4. 如果要建立 SKILL.md,寫入 data/apps/${reportId}/skills/${skillId}/SKILL.md。\n5. 完成後輸出 DONE。\n6. **Working Directory:${workDir}**`;
        const filledPrompt = USER_PROMPT_TEMPLATE
            .replace(/\{\{TEMPLATE\}\}/g, selectedTemplate)
            .replace(/\{\{REPORT_NAME\}\}/g, reportName)
            .replace(/\{\{SKILL_ID\}\}/g, skillId)
            .replace(/\{\{PARAMS\}\}/g, description) + outputInstruction;
        // Append user's system prompt override if provided
        const finalPrompt = systemPromptOverride
            ? `[System Override]\n${systemPromptOverride}\n\n---\n${filledPrompt}`
            : filledPrompt;

        sendToTerminal(finalPrompt);

        // Add assistant message placeholder
        setTimeout(() => {
            setChatMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                text: "🔄 正在生成中...",
                ts: Date.now(),
            }]);
        }, 1000);
    }, [reportName, selectedTemplate, description, systemPromptOverride, selectedSkill, reportId, sendToTerminal, workingDir]);

    // ── Chat send (iterative refinement) ──
    const handleChatSend = useCallback(() => {
        const input = chatInput;
        if (!input.trim()) return;
        setChatInput("");
        const msg = input.trim();
        setChatMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: "user",
            text: msg,
            ts: Date.now(),
        }]);

        // Build modification history for context
        const userMessages = chatMessages.filter(m => m.role === "user");
        const isRefinement = chatMessages.length > 0; // first generate has assistant placeholder
        let historyBlock = "";
        if (isRefinement && userMessages.length > 0) {
            historyBlock = "\n\n**修改記錄(之前的對話):**\n" + userMessages.map((m, i) => `${i + 1}. ${m.text}`).join("\n") + "\n";
        }

        // Send to terminal for processing
        const workDir = workingDir ? `${workingDir}/apps/${reportId}` : `data/apps/${reportId}`;
        const refinement = `${historyBlock}${msg}\n\n修改完成後請更新 data/apps/${reportId}/app.html。完成後輸出 DONE。\n**Working Directory:${workDir}**`;
        sendToTerminal(refinement);

        // Start polling for preview update
        setGenerating(true); generatingRef.current = true;
        setPreviewReady(false);
        setPollTrigger(t => t + 1);

        setTimeout(() => {
            setChatMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                text: "🔄 處理中...",
                ts: Date.now(),
            }]);
        }, 500);
    }, [chatInput, reportId, sendToTerminal, saveAppChat]);

    // ── Step indicators ──
    const steps = [
        { n: 1, label: tt("appBuilder.stepTemplate"), icon: "🎨" },
        { n: 2, label: tt("appBuilder.stepDescribe"), icon: "✏️" },
        { n: 3, label: tt("appBuilder.stepGenerate"), icon: "🚀" },
    ];

    // ──────────────────────────────────────────────
    // RENDER
    // ──────────────────────────────────────────────
    return (
        <div className="h-full flex flex-col w-full" style={{ backgroundColor: "#fafaf9" }}>
            {/* Dialogs */}
            {showSkillPicker && (
                <SkillPickerDialog skills={skills} onSelect={(sk) => {
                    setSelectedSkill(sk);
                    if (!reportName) setReportName(sk.name + "-app");
                    setShowSkillPicker(false);
                }} onClose={() => setShowSkillPicker(false)} />
            )}

            {/* App Picker Dialog */}
            {showAppPicker && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowAppPicker(false)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border" style={{ borderColor: t.accentBorder }}
                        onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#e7e5e4" }}>
                            <h3 className="text-sm font-bold text-stone-700">📝 選擇現有 App 修改</h3>
                            <button onClick={() => setShowAppPicker(false)} className="text-stone-400 hover:text-red-400 text-lg leading-none">&times;</button>
                        </div>
                        <div className="max-h-80 overflow-y-auto p-3 space-y-1.5">
                            {existingApps.length === 0 && (
                                <div className="text-center text-stone-400 text-xs py-8">還沒有 App,先建一個吧!</div>
                            )}
                            {existingApps.map(app => (
                                <div key={app.id}
                                    className="w-full text-left p-3 border rounded-lg hover:shadow-sm hover:border-stone-300 transition-all text-sm group"
                                    style={{ borderColor: "#e7e5e4" }}>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => handleEditApp(app.id)} className="flex items-center gap-2 flex-1 min-w-0">
                                            <span className="text-lg">{TEMPLATE_ICONS[app.template] || "📊"}</span>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-stone-700 truncate">{app.name}</div>
                                                <div className="text-xs text-stone-400 font-mono">{app.id}</div>
                                            </div>
                                        </button>
                                        <span className={cn(
                                            "text-xs px-2 py-0.5 rounded-full font-semibold",
                                            app.status === "published" ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-500"
                                        )}>{app.status === "published" ? "Published" : "Draft"}</span>
                                        <button onClick={() => handleEditApp(app.id)}
                                            className="text-stone-300 group-hover:text-stone-500 transition-colors text-xs">修改 →</button>
                                        {app.status === "published" && (
                                            <button onClick={() => handleUnpublish(app.id)}
                                                className="text-stone-300 group-hover:text-red-400 transition-colors text-xs ml-1"
                                                title={tt("common.unpublish")}>🗑️</button>
                                        )}
                                        {/* Export App */}
                                        <button onClick={async (e) => {
                                            e.stopPropagation();
                                            try {
                                                const resp = await fetch(`${API}/api/paaw/apps/${app.id}/export`);
                                                if (!resp.ok) { alert(tt("appBuilder.exportFailed")); return; }
                                                const blob = await resp.blob();
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement("a");
                                                a.href = url; a.download = `${app.id}-bundle.json`; a.click();
                                                URL.revokeObjectURL(url);
                                            } catch (err: any) { alert(`匯出失敗: ${err.message}`); }
                                        }}
                                            className="text-stone-300 group-hover:text-blue-400 transition-colors text-xs ml-1"
                                            title={tt("common.export")}>📦</button>
                                    </div>
                                    {app.description && <div className="text-xs text-stone-500 mt-1 line-clamp-1">{app.description}</div>}
                                </div>
                            ))}
                        </div>
                        <div className="px-5 py-3 border-t flex items-center gap-2" style={{ borderColor: "#e7e5e4" }}>
                            <span className="text-sm text-stone-400">共 {existingApps.length} 個 App</span>
                            <div className="ml-auto flex items-center gap-2">
                                {/* Import App */}
                                <label className="text-xs px-2.5 py-1 rounded-lg border cursor-pointer hover:bg-stone-50 transition-colors flex items-center gap-1" style={{ borderColor: "#d6d3d1", color: "#444" }}>
                                    📥 匯入
                                    <input type="file" accept=".json" className="hidden" onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        try {
                                            const text = await file.text();
                                            const bundle = JSON.parse(text);
                                            const resp = await fetch(`${API}/api/paaw/apps/import`, {
                                                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bundle),
                                            });
                                            const data = await resp.json();
                                            if (data.ok) { alert(`✅ ${data.message}`); loadExistingApps(); } else { alert(`❌ ${data.error}`); }
                                        } catch (err: any) { alert(`❌ 匯入失敗: ${err.message}`); }
                                        e.target.value = "";
                                    }} />
                                </label>
                                <button onClick={() => setShowAppPicker(false)} className="text-stone-500 hover:text-stone-700 text-sm">{tt("vibe.close")}</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Header ── */}
            <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0"
                style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                <span className="text-lg">🎨</span>
                <h2 className="text-sm font-bold" style={{ color: t.accentText }}>{tt("sidebar.appBuilder")}</h2>

                {/* Mode toggle */}
                <div className="flex items-center gap-1 ml-3 p-0.5 rounded-lg bg-white border" style={{ borderColor: t.accentBorder }}>
                    <button
                        onClick={() => { setEditingAppId(null); setStep(1); setReportName(""); setDescription(""); setPreviewReady(false); setChatStarted(false); setChatMessages([]); }}
                        className={cn("px-2.5 py-1 rounded-md text-sm font-semibold transition-all", !editingAppId ? "text-white shadow-sm" : "text-stone-500 hover:text-stone-700")}
                        style={!editingAppId ? { backgroundColor: t.accent } : undefined}
                    >✨ 新建</button>
                    <button
                        onClick={() => setShowAppPicker(true)}
                        className={cn("px-2.5 py-1 rounded-md text-sm font-semibold transition-all flex items-center gap-1", editingAppId ? "text-white shadow-sm" : "text-stone-500 hover:text-stone-700")}
                        style={editingAppId ? { backgroundColor: t.accent } : undefined}
                    >📝 修改{editingAppId ? `: ${editingAppId}` : ""} <span className="bg-stone-200 px-1 rounded text-[9px]">{existingApps.length}</span></button>
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-1 ml-4">
                    {steps.map((s, i) => (
                        <React.Fragment key={s.n}>
                            <button
                                onClick={() => { if (s.n < step || (s.n === 2 && selectedTemplate) || (s.n === 3 && selectedTemplate && reportName)) setStep(s.n as Step); }}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold transition-all",
                                    step === s.n ? "text-white shadow-sm" : step > s.n ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-400 cursor-not-allowed"
                                )}
                                style={step === s.n ? { backgroundColor: t.accent } : undefined}
                            >
                                <span>{step > s.n ? "✓" : s.icon}</span>
                                <span>{s.label}</span>
                            </button>
                            {i < steps.length - 1 && (
                                <div className={cn("w-6 h-px", step > s.n ? "bg-green-300" : "bg-stone-200")} />
                            )}
                        </React.Fragment>
                    ))}
                </div>

                {/* Right side: history + agent */}
                <div className="flex items-center gap-2 ml-auto">
                    <div className="relative">
                        <button onClick={() => setShowAppPicker(true)} className="flex items-center gap-1 text-xs px-2 py-1 border rounded-lg bg-white hover:bg-stone-50 transition-colors"
                            style={{ borderColor: "#d6d3d1" }}>
                            📜 歷史 <span className="text-xs bg-stone-100 px-1 rounded">{history.length}</span>
                        </button>
                    </div>
                    <ModelSelector feature="appBuilder" value={model} onChange={setModel} />
                </div>
            </div>

            {/* ── Content ── */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {/* ============ STEP 1: Template Gallery ============ */}
                {step === 1 && (
                    <div className="h-full flex flex-col items-center justify-center p-8 overflow-y-auto">
                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-stone-800 mb-2">選擇版型</h2>
                            <p className="text-stone-500 text-sm">挑一個你喜歡的佈局,後面可以再微調</p>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-5 max-w-3xl w-full">
                            {TEMPLATES.map(tmpl => (
                                <button key={tmpl.id}
                                    onClick={() => { setSelectedTemplate(tmpl.id); setStep(2); }}
                                    className={cn(
                                        "group flex flex-col border-2 rounded-xl overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5",
                                        selectedTemplate === tmpl.id ? "border-blue-400 shadow-md" : "border-stone-200 hover:border-stone-300"
                                    )}
                                    style={{ backgroundColor: "#fff" }}>
                                    {/* Mockup */}
                                    <div className="aspect-[200/140] bg-stone-100 flex items-center justify-center p-2 transition-colors group-hover:bg-stone-50">
                                        <div dangerouslySetInnerHTML={{ __html: tmpl.mockup }} className="w-full h-full" />
                                    </div>
                                    {/* Info */}
                                    <div className="p-3 text-left">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-lg">{tmpl.icon}</span>
                                            <span className="font-bold text-base text-stone-800">{tmpl.name}</span>
                                        </div>
                                        <p className="text-xs text-stone-500">{tmpl.desc}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                        {/* Custom hint */}
                        <p className="text-stone-400 text-xs mt-8">💡 選好版型後進入下一步描述你的需求</p>
                    </div>
                )}

                {/* ============ STEP 2: Describe ============ */}
                {step === 2 && (
                    <div className="h-full flex flex-col items-center justify-center p-8 overflow-y-auto">
                        <div className="w-full max-w-2xl">
                            {/* Selected template preview (small) */}
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-32 h-20 rounded-lg border border-stone-200 overflow-hidden bg-stone-100 p-1">
                                    {TEMPLATES.find(t => t.id === selectedTemplate) && (
                                        <div dangerouslySetInnerHTML={{ __html: TEMPLATES.find(t => t.id === selectedTemplate)!.mockup }} className="w-full h-full" />
                                    )}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">{TEMPLATES.find(t => t.id === selectedTemplate)?.icon}</span>
                                        <span className="font-bold text-stone-800">{TEMPLATES.find(t => t.id === selectedTemplate)?.name}</span>
                                    </div>
                                    <button onClick={() => setStep(1)} className="text-sm text-stone-400 hover:text-stone-600 mt-1">← 換一個</button>
                                </div>
                            </div>

                            {/* App Name */}
                            <div className="mb-4">
                                <label className="block text-sm font-bold text-stone-500 mb-1">App 名稱 *</label>
                                <input value={reportName}
                                    onChange={e => setReportName(e.target.value)}
                                    placeholder={tt("appBuilder.idPlaceholder")}
                                    className="w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    style={{ borderColor: "#d6d3d1" }} />
                            </div>

                            {/* Description - natural language */}
                            <div className="mb-4">
                                <label className="block text-sm font-bold text-stone-500 mb-1">描述你想要什麼 *</label>
                                <textarea value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder={tt("appBuilder.descPlaceholder")}
                                    rows={4}
                                    className="w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                                    style={{ borderColor: "#d6d3d1", lineHeight: 1.6 }} />
                                <p className="text-xs text-stone-400 mt-1">💡 越具體越好:配色、佈局、功能、資料來源...</p>
                            </div>

                            {/* Skill binding */}
                            <div className="mb-4">
                                <label className="block text-sm font-bold text-stone-500 mb-1">綁定 Skill(選填)</label>
                                {!selectedSkill ? (
                                    <button onClick={() => setShowSkillPicker(true)}
                                        className="w-full p-3 border-2 border-dashed rounded-xl text-sm text-stone-400 hover:text-stone-600 hover:border-stone-300 transition-colors"
                                        style={{ borderColor: "#d6d3d1" }}>
                                        + 選擇 Skill...
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2 p-3 rounded-xl border"
                                        style={{ borderColor: t.accent, backgroundColor: t.accentBg }}>
                                        <span className="text-sm font-bold text-stone-700">{selectedSkill.name}</span>
                                        <span className="text-xs text-stone-400 font-mono">{selectedSkill.id}</span>
                                        <div className="ml-auto flex gap-1">
                                            <button onClick={() => setShowSkillPicker(true)} className="text-xs px-2 py-1 rounded-md border"
                                                style={{ borderColor: t.accentBorder, color: t.accent }}>換</button>
                                            <button onClick={() => setSelectedSkill(null)} className="text-sm text-stone-400 hover:text-red-400">✕</button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Advanced (collapsed) */}
                            <div className="mb-6">
                                <button onClick={() => setShowAdvanced(!showAdvanced)}
                                    className="flex items-center gap-1 text-sm text-stone-400 hover:text-stone-600 transition-colors">
                                    <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
                                    進階設定(System Prompt)
                                </button>
                                {showAdvanced && (
                                    <textarea value={systemPromptOverride}
                                        onChange={e => setSystemPromptOverride(e.target.value)}
                                        placeholder="留空 = 使用預設 System Prompt（App Builder 規則自動載入）"
                                        rows={4}
                                        className="w-full mt-2 px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none"
                                        style={{ borderColor: "#d6d3d1", lineHeight: 1.6 }} />
                                )}
                            </div>

                            {/* Generate button */}
                            <button
                                onClick={handleGenerate}
                                disabled={!reportName.trim()}
                                className={cn(
                                    "w-full py-3 rounded-xl text-sm font-bold transition-all",
                                    reportName.trim()
                                        ? "text-white hover:opacity-90 shadow-md"
                                        : "bg-stone-200 text-stone-400 cursor-not-allowed"
                                )}
                                style={{ backgroundColor: reportName.trim() ? t.accent : undefined }}>
                                🚀 開始生成
                            </button>
                        </div>
                    </div>
                )}

                {/* ============ STEP 3: Generate & Preview ============ */}
                {step === 3 && <><div className={"h-full " + (fullscreen ? "flex flex-col" : "grid grid-rows-2")}>
                        {/* Top: Preview */}
                        <div className={fullscreen ? "flex-1 min-h-0" : "min-h-0 border-b"} style={{ borderColor: fullscreen ? undefined : "#e7e5e4", backgroundColor: "#f5f5f4" }}>
                            <div className="flex items-center gap-2 px-4 py-1.5 border-b bg-white shrink-0" style={{ borderColor: "#e7e5e4" }}>
                                <span className="text-sm font-semibold text-stone-500">🖼️ Preview</span>
                                {previewUrl && <span className="text-xs text-stone-400 font-mono">{reportId}</span>}
                                <div className="ml-auto flex gap-2">
                                    {editingAppId && (
                                        <button onClick={() => setShowSettings(true)}
                                            className="text-xs text-stone-400 hover:text-stone-600 font-semibold">{tt("sidebar.settings")}</button>
                                    )}
                                    {previewReady && (
                                        <span className="text-xs text-green-500">✅ 已生成</span>
                                    )}
                                    {generating && (
                                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 font-medium">
                                            <span className="w-3 h-3 border-[1.5px] border-amber-500 border-t-transparent rounded-full animate-spin" />
                                            AI 生成中...
                                        </span>
                                    )}
                                    <button onClick={() => { setPreviewReady(false); setPollTrigger(t => t + 1); setPreviewKey(Date.now()); }}
                                        className="text-xs text-stone-400 hover:text-stone-600">🔄</button>
                                    <button onClick={handlePreviewPrompt}
                                        className="text-xs text-stone-400 hover:text-stone-600" title="查看完整提示詞">📋 Prompt</button>
                                    {previewReady && previewUrl && (
                                        <button onClick={() => setFullscreen(f => !f)}
                                            className="text-xs text-stone-400 hover:text-stone-600" title={fullscreen ? tt("common.exitFullscreen") : tt("appBuilder.fullscreenPreview")}>{fullscreen ? "✕" : "⛶"}</button>
                                    )}
                                </div>
                            </div>
                            <div className="h-full min-h-0">
                                {previewReady && previewUrl ? (
                                    <iframe key={previewKey} src={`${previewUrl}?_t=${previewKey}`}
                                        className="w-full h-full border-0 bg-white" title="Preview" />
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-stone-400 text-sm gap-3">
                                        {generating ? (
                                            <>
                                                <span className="w-10 h-10 border-[3px] border-amber-400 border-t-transparent rounded-full animate-spin" />
                                                <p className="font-medium text-amber-600">AI 正在生成你的 App...</p>
                                                <p className="text-xs text-stone-500">生成完成後會自動顯示預覽</p>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-3xl">🖼️</span>
                                                <p>{previewUrl ? tt("appBuilder.waitingGenerate") : tt("appBuilder.setAppName")}</p>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Bottom: Terminal - AgentConsole fills entire terminal area + chat input */}
                        {!fullscreen && (
                        <div className="min-h-0 flex flex-col" style={{ backgroundColor: "#1e1e1e" }}>
                            <div className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0" style={{ borderColor: "#333" }}>
                                <span className="text-sm font-semibold text-stone-400">💻 Terminal</span>
                                <span className="text-[9px] text-stone-500">({model ? model.split("/").pop() : "default"})</span>
                                {chatMessages.length > 0 && (
                                    <button onClick={() => setShowRevisionLog(true)}
                                        className="ml-auto text-xs text-stone-500 hover:text-stone-300 flex items-center gap-1"
                                        title="查看修改記錄">
                                        📝 修改記錄 <span className="text-[9px] bg-stone-700 px-1 rounded">{chatMessages.filter(m => m.role === "user").length}</span>
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 min-h-0">
                                {chatStarted ? (
                                    <AgentConsole
                                        key={`applab-${consoleKey}-${model}`}
                                        ref={terminalRef}
                                        cwd={workingDir ? `${workingDir}/apps/${reportId}` : undefined}
                                        model={model || undefined}
                                        systemPrompt={agentSystemPrompt || undefined}
                                        initialPrompt={initialPrompt}
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-stone-500 text-xs">
                                        按「開始生成」後 terminal 會啟動
                                    </div>
                                )}
                            </div>
                            {/* Chat input for refinement */}
                            {chatStarted && (
                            <div className="shrink-0 p-2 border-t" style={{ borderColor: "#333" }}>
                                <div className="flex gap-2">
                                    <textarea
                                        value={chatInput}
                                        onChange={e => setChatInput(e.target.value)}
                                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); handleChatSend(); } }}
                                        placeholder={tt("appBuilder.refinePlaceholder")}
                                        rows={2}
                                        className="flex-1 px-3 py-2 bg-stone-800 border rounded-lg text-sm text-stone-200 placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-600 resize-none"
                                        style={{ borderColor: "#444", lineHeight: 1.5 }}
                                    />
                                    <button onClick={handleChatSend}
                                        disabled={!chatInput.trim()}
                                        className={cn(
                                            "px-3 py-2 rounded-lg text-sm font-bold transition-colors",
                                            chatInput.trim() ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-stone-700 text-stone-500 cursor-not-allowed"
                                        )}>
                                        送出
                                    </button>
                                </div>
                            </div>
                            )}
                        </div>
                        )}
                    </div>

                    {/* 📝 修改記錄 Modal */}
                    {showRevisionLog && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowRevisionLog(false)}>
                            <div className="bg-stone-900 rounded-xl shadow-2xl w-full max-w-lg border border-stone-700 overflow-hidden" style={{ maxHeight: "80vh" }} onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between px-5 py-3 border-b border-stone-700 shrink-0">
                                    <h3 className="text-sm font-bold text-stone-200">📝 修改記錄</h3>
                                    <button onClick={() => setShowRevisionLog(false)} className="text-stone-500 hover:text-red-400 text-lg leading-none">&times;</button>
                                </div>
                                <div className="overflow-y-auto p-4 space-y-2" style={{ maxHeight: "calc(80vh - 50px)" }}>
                                    {chatMessages.length === 0 && (
                                        <div className="text-center text-stone-500 text-sm py-8">還沒有修改記錄</div>
                                    )}
                                    {chatMessages.filter(m => m.role === "user").map((msg, idx) => (
                                        <div key={msg.id} className="bg-stone-800 rounded-lg px-4 py-2.5">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-bold text-blue-400">#{idx + 1}</span>
                                                <span className="text-[10px] text-stone-500">{new Date(msg.ts).toLocaleTimeString()}</span>
                                            </div>
                                            <div className="text-sm text-stone-300 whitespace-pre-wrap">{msg.text}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ⚙️ Settings Panel (edit mode only) */}
                    {editingAppId && showSettings && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowSettings(false)}>
                            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border overflow-hidden"
                                style={{ borderColor: t.accentBorder, maxHeight: "90vh" }}
                                onClick={e => e.stopPropagation()}>
                                {/* Header */}
                                <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ borderColor: "#e7e5e4", backgroundColor: t.accentBg }}>
                                    <h3 className="text-sm font-bold" style={{ color: t.accentText }}>⚙️ App 設定 - {editingAppId}</h3>
                                    <div className="flex items-center gap-2">
                                        {settingsSaved && <span className="text-xs text-green-600 font-semibold">{tt("common.saved")}</span>}
                                        <button onClick={() => setShowSettings(false)} className="text-stone-400 hover:text-red-400 text-lg leading-none">&times;</button>
                                    </div>
                                </div>
                                {/* Body */}
                                <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: "calc(90vh - 60px)" }}>
                                    {/* Row: name + icon */}
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="col-span-2">
                                            <label className="block text-sm font-semibold text-stone-500 mb-1">App 名稱</label>
                                            <input value={appSettings.name} readOnly
                                                className="w-full px-3 py-2 border rounded-lg text-sm bg-stone-50 text-stone-500"
                                                style={{ borderColor: "#d6d3d1" }} />
                                            <p className="text-xs text-stone-400 mt-0.5">名稱在 Step 2 決定</p>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-stone-500 mb-1">Icon (emoji)</label>
                                            <input value={appSettings.icon}
                                                onChange={e => setAppSettings(p => ({ ...p, icon: e.target.value }))}
                                                placeholder="📦"
                                                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-stone-300 text-center text-lg"
                                                style={{ borderColor: "#d6d3d1" }} />
                                        </div>
                                    </div>
                                    {/* Description */}
                                    <div>
                                        <label className="block text-sm font-semibold text-stone-500 mb-1">{tt("common.description")}</label>
                                        <textarea value={appSettings.description}
                                            onChange={e => setAppSettings(p => ({ ...p, description: e.target.value }))}
                                            rows={2}
                                            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none"
                                            style={{ borderColor: "#d6d3d1", lineHeight: 1.5 }} />
                                    </div>
                                    {/* Row: type + dataShape + cli */}
                                    <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-sm font-semibold text-stone-500 mb-1">Type</label>
                                            <select value={appSettings.type}
                                                onChange={e => setAppSettings(p => ({ ...p, type: e.target.value }))}
                                                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-stone-300"
                                                style={{ borderColor: "#d6d3d1" }}>
                                                <option value="data">data</option>
                                                <option value="skill-based">skill-based</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-stone-500 mb-1">Data Shape</label>
                                            <select value={appSettings.dataShape}
                                                onChange={e => setAppSettings(p => ({ ...p, dataShape: e.target.value }))}
                                                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-stone-300"
                                                style={{ borderColor: "#d6d3d1" }}>
                                                <option value="array">array</option>
                                                <option value="object">object</option>
                                                <option value="none">none</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-stone-500 mb-1">Engine</label>
                                            <input value={appSettings.engine} readOnly
                                                className="w-full px-3 py-2 border rounded-lg text-sm bg-stone-50 text-stone-400"
                                                style={{ borderColor: "#d6d3d1" }} />
                                        </div>
                                    </div>
                                    {/* Triggers */}
                                    <div>
                                        <label className="block text-sm font-semibold text-stone-500 mb-1">觸發關鍵字 (逗號分隔)</label>
                                        <input value={appSettings.triggers}
                                            onChange={e => setAppSettings(p => ({ ...p, triggers: e.target.value }))}
                                            placeholder={tt("appBuilder.skillHintPlaceholder")}
                                            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono text-xs"
                                            style={{ borderColor: "#d6d3d1" }} />
                                    </div>
                                    {/* AI Prompt */}
                                    <div>
                                        <label className="block text-sm font-semibold text-stone-500 mb-1">AI Prompt(給 LLM 的 App 操作提示)</label>
                                        <textarea value={appSettings.aiPrompt}
                                            onChange={e => setAppSettings(p => ({ ...p, aiPrompt: e.target.value }))}
                                            rows={4}
                                            className="w-full px-3 py-2 border rounded-lg text-sm font-mono text-xs focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none"
                                            style={{ borderColor: "#d6d3d1", lineHeight: 1.5 }} />
                                    </div>
                                    {/* Schema (JSON) */}
                                    <div>
                                        <label className="block text-sm font-semibold text-stone-500 mb-1">Schema (JSON)</label>
                                        <textarea value={appSettings.schema}
                                            onChange={e => setAppSettings(p => ({ ...p, schema: e.target.value }))}
                                            rows={8}
                                            className="w-full px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none"
                                            style={{ borderColor: "#d6d3d1", lineHeight: 1.5 }} />
                                    </div>
                                    {/* Skills (JSON array) */}
                                    <div>
                                        <label className="block text-sm font-semibold text-stone-500 mb-1">綁定的 Skills (JSON 陣列)</label>
                                        <textarea value={appSettings.skillsText}
                                            onChange={e => setAppSettings(p => ({ ...p, skillsText: e.target.value }))}
                                            rows={6}
                                            placeholder='[{ "id": "translate", "path": "./skills/translate/SKILL.md", "role": "main" }]'
                                            className="w-full px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none"
                                            style={{ borderColor: "#d6d3d1", lineHeight: 1.5 }} />
                                        <p className="text-xs text-stone-400 mt-1">每個 skill: {`{ id, path, role }`},role 可選 main / support</p>
                                    </div>
                                </div>
                                {/* Footer */}
                                <div className="flex items-center justify-end gap-3 px-5 py-3 border-t shrink-0" style={{ borderColor: "#e7e5e4", backgroundColor: t.accentBg }}>
                                    <button onClick={() => setShowSettings(false)}
                                        className="px-4 py-2 text-sm font-medium rounded-lg border transition-colors"
                                        style={{ borderColor: "#d6d3d1", color: "#444" }}>{tt("common.cancel")}</button>
                                    <button onClick={handleSaveSettings}
                                        disabled={settingsSaving}
                                        className="px-5 py-2 text-sm font-bold text-white rounded-lg transition-colors disabled:opacity-50"
                                        style={{ backgroundColor: t.accent }}
                                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accentHover; }}
                                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = t.accent; }}>
                                        {settingsSaving ? tt("common.saving") : tt("appBuilder.saveButton")}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ━━ Prompt Preview Modal ━━ */}
                    {promptPreview && promptPreviewContent && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPromptPreview(false)}>
                            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl border overflow-hidden" style={{ maxHeight: "90vh" }} onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ borderColor: "#e7e5e4" }}>
                                    <h3 className="text-sm font-bold text-stone-700">📋 完整提示詞預覽</h3>
                                    <button onClick={() => setPromptPreview(false)} className="text-stone-400 hover:text-red-400 text-lg leading-none">&times;</button>
                                </div>
                                <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: "calc(90vh - 60px)" }}>
                                    <div>
                                        <div className="text-xs font-bold text-stone-500 mb-1">System Prompt</div>
                                        <pre className="bg-stone-50 border rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[40vh] overflow-y-auto" style={{ borderColor: "#e7e5e4", lineHeight: 1.6 }}>{promptPreviewContent.system}</pre>
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-stone-500 mb-1">User Prompt</div>
                                        <pre className="bg-stone-50 border rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[40vh] overflow-y-auto" style={{ borderColor: "#e7e5e4", lineHeight: 1.6 }}>{promptPreviewContent.prompt}</pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>}
            </div>
        </div>
    );
}
