import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../utils";
import { useTheme } from "../theme";
import { SkillDefinition } from "../types";
import TerminalConsole, { TerminalConsoleHandle } from "../components/TerminalConsole";

const API = "http://127.0.0.1:4097";

// Memoized terminal to prevent re-render on parent state changes (fix flicker)
const MemoizedTerminal = React.memo(React.forwardRef(function MemoizedTerminal(
    { consoleKey, cli, initialPrompt }: { consoleKey: string; cli: string; initialPrompt: string },
    ref: React.Ref<TerminalConsoleHandle>
) {
    return (
        <TerminalConsole
            ref={ref}
            key={consoleKey}
            cwd={undefined}
            cli={cli as any}
            approvalMode="yolo"
            initialPrompt={initialPrompt}
        />
    );
}));

type RightTab = "terminal" | "preview";

interface TrainRun {
    id: string;
    skillId: string;
    status: "running" | "done" | "error";
    output: string;
    htmlPath?: string;
}

interface TrainingFile {
    name: string;
    path: string;
}

// ── Parse training file into sections ──
function parseTrainingFile(content: string): { config: string; prompt: string; test: string } {
    let config = "";
    let prompt = "";
    let test = "";

    const configIdx = content.search(/##\s*報表設定/i);
    const promptIdx = content.search(/##\s*訓練\s*Prompt/i);
    const testIdx = content.search(/##\s*測試\s*Prompt/i);

    if (configIdx === -1 && promptIdx === -1 && testIdx === -1) {
        // No markers — everything goes to prompt
        prompt = content.trim();
    } else {
        const firstIdx = [configIdx, promptIdx, testIdx].filter(i => i >= 0).reduce((a, b) => Math.min(a, b), Infinity);
        // Header before first section
        if (firstIdx > 0) config = content.slice(0, firstIdx).trim();

        if (configIdx !== -1) {
            const afterConfig = content.indexOf('\n', configIdx) + 1;
            const endConfig = [promptIdx, testIdx].filter(i => i > configIdx).reduce((a, b) => Math.min(a, b), content.length);
            config = content.slice(afterConfig, endConfig).trim();
        }
        if (promptIdx !== -1) {
            const afterPrompt = content.indexOf('\n', promptIdx) + 1;
            const endPrompt = [testIdx].filter(i => i > promptIdx).reduce((a, b) => Math.min(a, b), content.length);
            prompt = content.slice(afterPrompt, endPrompt).trim();
        }
        if (testIdx !== -1) {
            const afterTest = content.indexOf('\n', testIdx) + 1;
            test = content.slice(afterTest).trim();
        }
    }

    return { config, prompt, test };
}

function buildFileContent(config: string, prompt: string, test: string, reportName: string, template: string, skillId: string): string {
    const parts: string[] = [];
    parts.push(`# App Training: ${reportName || "untitled"}\n`);
    parts.push(`## 報表設定\n`);
    parts.push(`- App 名稱: ${reportName || "untitled"}\n`);
    parts.push(`- Template: ${template || "dashboard"}\n`);
    parts.push(`- 基底 Skill: ${skillId || ""}\n`);
    parts.push(`- 建立時間: ${new Date().toISOString()}\n`);
    if (config.trim()) parts.push(`\n${config.trim()}\n`);
    parts.push(`\n## 訓練 Prompt\n`);
    parts.push(`${prompt.trim()}\n`);
    parts.push(`\n## 測試 Prompt\n`);
    parts.push(`${test.trim()}\n`);
    return parts.join("\n");
}

const DEFAULT_PROMPT = `你是一個前端報表開發專家。請產出一個完整的 HTML 報表頁面。

## 報表規格
- Template 類型: {{TEMPLATE}}
- App 名稱: {{REPORT_NAME}}
- 可用參數: {{PARAMS}}

## 技術要求
1. 純 HTML，所有 CSS 和 JS 都內聯
2. 用 Chart.js (CDN: https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js) 畫圖表
3. 用 marked.js (CDN: https://cdn.jsdelivr.net/npm/marked/marked.min.js) render markdown
4. 頂部有 query bar：根據參數定義生成 select/input 控件 + Execute 按鈕
5. Execute 按鈕 POST /api/skill-exec/{{SKILL_ID}}，body: { params, cli: "qwen" }
6. 用 NDJSON 串流讀取結果，用 marked.parse() render markdown
7. 風格：白色卡片 + stone 色系
8. 響應式設計
9. 用合理的假數據做 static 展示部分

## 重要
- 只輸出 HTML 代碼，不要用 markdown code block 包住
- 不要任何解釋，直接輸出完整 HTML
- HTML 開頭是 <!DOCTYPE html>`;

const TEMPLATES = [
    { id: "dashboard", name: "Dashboard", icon: "📊", desc: "KPI cards + charts" },
    { id: "table", name: "Table", icon: "📋", desc: "Data table + filters" },
    { id: "chart", name: "Chart", icon: "📈", desc: "Charts focused" },
    { id: "mixed", name: "Mixed", icon: "🎛️", desc: "Charts + table + AI analysis" },
];

// ── Skill Picker Popup Dialog ──
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
    const [search, setSearch] = useState("");
    const filtered = skills.filter(sk =>
        sk.name.toLowerCase().includes(search.toLowerCase()) ||
        sk.id.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
            onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border" style={{ borderColor: t.accentBorder }}
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#e7e5e4" }}>
                    <h3 className="text-sm font-bold text-stone-700">📦 選擇基底 Skill</h3>
                    <button onClick={onClose} className="text-stone-400 hover:text-red-400 text-lg leading-none">&times;</button>
                </div>
                <div className="px-5 pt-3">
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="搜尋 skill 名稱或 ID..."
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-stone-300"
                        style={{ borderColor: "#d6d3d1" }}
                        autoFocus
                    />
                </div>
                <div className="max-h-72 overflow-y-auto p-3 space-y-1.5">
                    {filtered.map(sk => (
                        <button key={sk.id} onClick={() => { onSelect(sk); onClose(); }}
                            className="w-full text-left p-3 border rounded-lg hover:shadow-sm hover:border-stone-300 transition-all text-sm"
                            style={{ borderColor: "#e7e5e4" }}>
                            <span className="font-semibold text-stone-700">{sk.name}</span>
                            <span className="text-[10px] text-stone-400 ml-2 font-mono">{sk.id}</span>
                        </button>
                    ))}
                    {filtered.length === 0 && (
                        <div className="text-center text-stone-400 text-xs py-6">找不到符合的 Skill</div>
                    )}
                </div>
                <div className="px-5 py-3 border-t text-xs text-stone-400" style={{ borderColor: "#e7e5e4" }}>
                    共 {filtered.length} / {skills.length} 個 Skill
                </div>
            </div>
        </div>
    );
}

// ── New File Dialog ──
function NewFileDialog({
    onCreate,
    onClose,
    accent,
}: {
    onCreate: (name: string) => void;
    onClose: () => void;
    accent: string;
}) {
    const [name, setName] = useState("");
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl border border-stone-200 w-96 p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-sm font-bold text-stone-800 mb-3">📄 新增 App Training File</h3>
                <p className="text-xs text-stone-500 mb-2">檔案會建立在 <code className="bg-stone-100 px-1 rounded">skills/training/</code> 目錄下</p>
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") onCreate(name); }}
                    placeholder="檔案名稱，例：train-daily-app"
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 mb-3"
                    autoFocus
                />
                {!name.endsWith(".md") && name.trim() && (
                    <p className="text-[10px] text-stone-400 mb-2">→ {name.trim()}.md</p>
                )}
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">取消</button>
                    <button
                        onClick={() => onCreate(name)}
                        disabled={!name.trim()}
                        className={cn("px-4 py-1.5 text-xs font-bold rounded-lg", name.trim() ? "text-white hover:opacity-90" : "bg-stone-200 text-stone-400")}
                        style={{ backgroundColor: name.trim() ? accent : undefined }}>
                        建立
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function AppLab() {
    const { info: t } = useTheme();
    const [skills, setSkills] = useState<SkillDefinition[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState("dashboard");
    const [reportName, setReportName] = useState("");
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
    const [testPrompt, setTestPrompt] = useState("");
    const [cli, setCli] = useState<"qwen" | "claude" | "opencode">("qwen");

    // Training file
    const [trainingFiles, setTrainingFiles] = useState<TrainingFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<string>("");
    const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty">("saved");

    const [rightTab, setRightTab] = useState<RightTab>("terminal");
    const [trainRun, setTrainRun] = useState<TrainRun | null>(null);
    const [published, setPublished] = useState(false);
    const [chatStarted, setChatStarted] = useState(false);
    const [initialPrompt, setInitialPrompt] = useState("");
    const [consoleKey, setConsoleKey] = useState(0);
    const [sendingTrain, setSendingTrain] = useState(false);
    const [sendingTest, setSendingTest] = useState(false);
    const terminalRef = useRef<TerminalConsoleHandle>(null);
    const [publishing, setPublishing] = useState(false);

    // Dialog states
    const [showSkillPicker, setShowSkillPicker] = useState(false);
    const [showNewFileDialog, setShowNewFileDialog] = useState(false);
    const [workingDir, setWorkingDir] = useState<string>("");

    const previewRef = useRef<HTMLIFrameElement>(null);
    const loadingRef = useRef(false);

    // ── Data loading ──
    useEffect(() => {
        fetch(`${API}/api/skills`).then(r => r.json()).then(setSkills).catch(() => {});
    }, []);

    useEffect(() => {
        fetch(`${API}/api/aioc-root`)
            .then(r => r.ok ? r.json() : {})
            .then((d: { aiocRoot?: string }) => { if (d.aiocRoot) setWorkingDir(d.aiocRoot); })
            .catch(() => {});
    }, []);

    const loadTrainingFiles = useCallback(() => {
        fetch(`${API}/api/report-lab/training-files`)
            .then(r => r.ok ? r.json() : [])
            .then((files: TrainingFile[]) => setTrainingFiles(files))
            .catch(() => {});
    }, []);

    useEffect(() => { loadTrainingFiles(); }, [loadTrainingFiles]);

    // ── File operations ──
    const loadFileContent = useCallback((path: string) => {
        loadingRef.current = true;
        fetch(`${API}/api/fs/file?path=${encodeURIComponent(path)}`)
            .then(r => r.ok ? r.json() : null)
            .then((data: { content?: string } | null) => {
                const parsed = parseTrainingFile(data?.content || "");
                setPrompt(parsed.prompt || DEFAULT_PROMPT);
                setTestPrompt(parsed.test || "");
                // Parse config section for reportName, template, skillId
                if (parsed.config) {
                    const nameMatch = parsed.config.match(/Report\s*名稱:\s*(.+)/);
                    const tmplMatch = parsed.config.match(/Template:\s*(\w+)/);
                    const skillMatch = parsed.config.match(/基底\s*Skill:\s*(.+)/);
                    if (nameMatch) setReportName(nameMatch[1].trim());
                    if (tmplMatch) setSelectedTemplate(tmplMatch[1].trim());
                    if (skillMatch) {
                        const sk = skills.find(s => s.id === skillMatch[1].trim());
                        if (sk) setSelectedSkill(sk);
                    }
                }
                setSaveStatus("saved");
            })
            .catch(() => { setPrompt(DEFAULT_PROMPT); setTestPrompt(""); })
            .finally(() => { loadingRef.current = false; });
    }, [skills]);

    useEffect(() => {
        const saved = localStorage.getItem("appLab.selectedFile");
        if (saved) { setSelectedFile(saved); loadFileContent(saved); }
    }, [loadFileContent]);

    const handleSelectFile = (path: string) => {
        setSelectedFile(path);
        localStorage.setItem("appLab.selectedFile", path);
        loadFileContent(path);
    };

    // ── Auto-save ──
    const saveFile = useCallback(async (p: string, tp: string, rn: string, tmpl: string, sid: string) => {
        if (!selectedFile || loadingRef.current) return;
        setSaveStatus("saving");
        try {
            const content = buildFileContent("", p, tp, rn, tmpl, sid);
            await fetch(`${API}/api/fs/file?path=${encodeURIComponent(selectedFile)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });
            setSaveStatus("saved");
        } catch { setSaveStatus("dirty"); }
    }, [selectedFile]);

    const saveTimer = useRef<ReturnType<typeof setTimeout>>();
    const promptRef = useRef(prompt);
    const testPromptRef = useRef(testPrompt);
    const reportNameRef = useRef(reportName);
    const templateRef = useRef(selectedTemplate);
    const skillIdRef = useRef(selectedSkill?.id || "");
    promptRef.current = prompt;
    testPromptRef.current = testPrompt;
    reportNameRef.current = reportName;
    templateRef.current = selectedTemplate;
    skillIdRef.current = selectedSkill?.id || "";

    const triggerAutoSave = useCallback(() => {
        setSaveStatus("dirty");
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            saveFile(promptRef.current, testPromptRef.current, reportNameRef.current, templateRef.current, skillIdRef.current);
        }, 800);
    }, [saveFile]);

    const handlePromptChange = (v: string) => { setPrompt(v); triggerAutoSave(); };
    const handleTestChange = (v: string) => { setTestPrompt(v); triggerAutoSave(); };
    const handleReportNameChange = (v: string) => { setReportName(v); triggerAutoSave(); };
    const handleTemplateChange = (v: string) => { setSelectedTemplate(v); triggerAutoSave(); };

    const handleSelectSkill = (sk: SkillDefinition) => {
        setSelectedSkill(sk);
        if (!reportName) setReportName(sk.name + "-report");
        skillIdRef.current = sk.id;
        triggerAutoSave();
    };

    // ── Create new training file ──
    const handleCreateFile = async (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const fileName = trimmed.endsWith(".md") ? trimmed : `app-${trimmed}.md`;
        const fullPath = `${workingDir || "."}/skills/training/${fileName}`;
        const sid = selectedSkill?.id || "";
        const rn = reportName || trimmed;
        const content = buildFileContent("", prompt, testPrompt, rn, selectedTemplate, sid);
        try {
            await fetch(`${API}/api/fs/file?path=${encodeURIComponent(fullPath)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });
            setShowNewFileDialog(false);
            loadTrainingFiles();
            handleSelectFile(fullPath);
        } catch { /* ignore */ }
    };

    // ── Send prompt to PTY terminal ──
    const sendToTerminal = useCallback((p: string) => {
        if (!p.trim()) return;
        if (!chatStarted) {
            setInitialPrompt(p);
            setChatStarted(true);
            setConsoleKey(prev => prev + 1);
        } else {
            terminalRef.current?.sendPrompt(p);
        }
    }, [chatStarted]);

    const handleTrain = () => {
        if (!reportName) return;
        setSendingTrain(true);
        setRightTab("terminal");
        const skillId = selectedSkill?.id || "no-skill";
        const filledPrompt = prompt
            .replace(/\{\{TEMPLATE\}\}/g, selectedTemplate)
            .replace(/\{\{REPORT_NAME\}\}/g, reportName)
            .replace(/\{\{SKILL_ID\}\}/g, skillId);
        sendToTerminal(filledPrompt);
        setTimeout(() => setSendingTrain(false), 300);
    };

    const handleTest = () => {
        if (!testPrompt.trim()) return;
        setSendingTest(true);
        setRightTab("terminal");
        const skillId = selectedSkill?.id || "no-skill";
        const filledTest = testPrompt
            .replace(/\{\{TEMPLATE\}\}/g, selectedTemplate)
            .replace(/\{\{REPORT_NAME\}\}/g, reportName)
            .replace(/\{\{SKILL_ID\}\}/g, skillId);
        sendToTerminal(filledTest);
        setTimeout(() => setSendingTest(false), 300);
    };

    const loadPreview = (htmlPath: string) => {
        const timer = setInterval(() => {
            if (!previewRef.current) return;
            const doc = previewRef.current.contentDocument;
            if (!doc) return;
            clearInterval(timer);
            fetch(`${API}/api/report-preview?path=${encodeURIComponent(htmlPath)}`)
                .then(r => r.text())
                .then(html => { doc.open(); doc.write(html); doc.close(); })
                .catch(() => {});
        }, 200);
    };

    const handlePublish = async () => {
        if (!trainRun?.htmlPath) return;
        setPublishing(true);
        try {
            const resp = await fetch(`${API}/api/report-publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    htmlPath: trainRun.htmlPath,
                    skillId: selectedSkill.id,
                    reportName,
                }),
            });
            const data = await resp.json();
            if (data.ok) setPublished(true);
        } catch {}
        setPublishing(false);
    };

    const inputCls = "w-full px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-1";

    return (
        <div className="h-full flex flex-col" style={{ backgroundColor: "#fafaf9" }}>
            {/* Dialogs */}
            {showSkillPicker && (
                <SkillPickerDialog
                    skills={skills}
                    onSelect={handleSelectSkill}
                    onClose={() => setShowSkillPicker(false)}
                />
            )}
            {showNewFileDialog && (
                <NewFileDialog
                    onCreate={handleCreateFile}
                    onClose={() => setShowNewFileDialog(false)}
                    accent={t.accent}
                />
            )}

            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                <span className="text-lg">🎨</span>
                <h2 className="text-sm font-bold" style={{ color: t.accentText }}>App Lab</h2>
                <span className="text-xs text-stone-400 ml-2">Design → Train → Preview → Publish</span>

                {/* Training file selector + new */}
                <div className="flex items-center gap-1.5 ml-4">
                    <select
                        value={selectedFile}
                        onChange={e => handleSelectFile(e.target.value)}
                        className="text-xs px-2 py-1 border rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-200"
                        style={{ minWidth: 200, borderColor: "#d6d3d1" }}>
                        <option value="">-- 選擇 Training File --</option>
                        {trainingFiles.map(f => (
                            <option key={f.path} value={f.path}>{f.name}</option>
                        ))}
                    </select>
                    <button onClick={() => { setShowNewFileDialog(true); }}
                        className="px-2 py-1 text-xs font-medium rounded-lg border bg-white text-stone-600 hover:bg-stone-50 transition-colors"
                        style={{ borderColor: "#d6d3d1" }}>
                        ＋New
                    </button>
                    {saveStatus === "saving" && <span className="text-[10px] text-amber-500">💾</span>}
                    {saveStatus === "saved" && selectedFile && <span className="text-[10px] text-green-500">✓</span>}
                    {saveStatus === "dirty" && <span className="text-[10px] text-rose-500">●</span>}
                </div>

                {/* CLI selector */}
                <div className="flex items-center gap-1.5 ml-2">
                    <label className="text-[11px] font-medium text-stone-500">CLI:</label>
                    <select
                        value={cli}
                        onChange={e => setCli(e.target.value as "qwen" | "claude" | "opencode")}
                        className="text-xs px-2 py-1 border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-200"
                    >
                        <option value="qwen">Qwen</option>
                        <option value="claude">Claude Code</option>
                        <option value="opencode">OpenCode</option>
                    </select>
                </div>
            </div>

            <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* ========== LEFT PANEL ========== */}
                <div className="flex flex-col border-r overflow-y-auto" style={{ width: "40%", minWidth: 340, borderColor: "#e7e5e4", backgroundColor: "#fff" }}>

                    {!selectedFile ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
                            <span className="text-3xl">🎨</span>
                            <p className="text-stone-400 text-sm text-center">選擇或建立一個 App Training File 開始</p>
                            <button onClick={() => setShowNewFileDialog(true)}
                                className="px-4 py-2 text-xs font-bold rounded-lg text-white"
                                style={{ backgroundColor: t.accent }}>
                                ＋ 建立新 Training File
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Skill Selector — Popup trigger */}
                            <div className="p-4 border-b" style={{ borderColor: "#e7e5e4" }}>
                                <h3 className="text-xs font-bold text-stone-500 mb-2">📦 基底 Skill</h3>
                                {!selectedSkill ? (
                                    <button onClick={() => setShowSkillPicker(true)}
                                        className="w-full p-3 border-2 border-dashed rounded-lg text-sm text-stone-400 hover:text-stone-600 hover:border-stone-300 transition-colors flex items-center justify-center gap-2"
                                        style={{ borderColor: "#d6d3d1" }}>
                                        <span className="text-lg">+</span> 選擇 Skill...
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2 p-2 rounded-lg border" style={{ borderColor: t.accent, backgroundColor: t.accentBg }}>
                                        <span className="text-sm font-bold text-stone-700">{selectedSkill.name}</span>
                                        <span className="text-[10px] text-stone-400 font-mono">{selectedSkill.id}</span>
                                        <div className="ml-auto flex gap-1">
                                            <button onClick={() => setShowSkillPicker(true)}
                                                className="text-[10px] px-2 py-1 rounded-md border hover:bg-stone-50"
                                                style={{ borderColor: t.accentBorder, color: t.accent }}>
                                                換
                                            </button>
                                            <button onClick={() => setSelectedSkill(null)} className="text-xs text-stone-400 hover:text-red-400">✕</button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Config */}
                            <div className="p-4 border-b space-y-3" style={{ borderColor: "#e7e5e4" }}>
                                <div>
                                    <label className="text-xs font-bold text-stone-500">App 名稱</label>
                                    <input value={reportName} onChange={e => handleReportNameChange(e.target.value)}
                                        className={inputCls} style={{ borderColor: "#d6d3d1" }} placeholder="my-app" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-stone-500">Template</label>
                                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                                        {TEMPLATES.map(tmpl => (
                                            <button key={tmpl.id} onClick={() => handleTemplateChange(tmpl.id)}
                                                className={cn("p-2 border rounded-lg text-left transition-all text-xs",
                                                    selectedTemplate === tmpl.id ? "border-blue-400 bg-blue-50" : "hover:border-stone-300")}
                                                style={selectedTemplate !== tmpl.id ? { borderColor: "#e7e5e4" } : {}}>
                                                <span className="mr-1">{tmpl.icon}</span>
                                                <span className="font-semibold">{tmpl.name}</span>
                                                <div className="text-[10px] text-stone-400">{tmpl.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Training Prompt Editor */}
                            <div className="flex flex-col flex-1 min-h-0 border-b" style={{ borderColor: "#e7e5e4" }}>
                                <div className="flex items-center justify-between px-4 py-1.5 border-b shrink-0" style={{ borderColor: "#e7e5e4" }}>
                                    <span className="text-xs font-semibold text-stone-600">🎓 訓練 Prompt</span>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => handlePromptChange(DEFAULT_PROMPT)} className="text-[10px] text-stone-400 hover:text-stone-600">Reset</button>
                                        <button onClick={handleTrain}
                                            disabled={!reportName || !prompt.trim()}
                                            className={cn("px-2.5 py-0.5 text-[11px] font-bold rounded-md transition-colors",
                                                reportName && prompt.trim()
                                                    ? "text-white hover:opacity-90 shadow-sm"
                                                    : "bg-stone-200 text-stone-400 cursor-not-allowed")}
                                            style={{ backgroundColor: reportName && prompt.trim() ? t.accent : undefined }}>
                                            {sendingTrain ? "⏳" : "▶"} Train
                                        </button>
                                    </div>
                                </div>
                                <textarea
                                    value={prompt}
                                    onChange={e => handlePromptChange(e.target.value)}
                                    className="flex-1 w-full px-3 py-2 text-xs font-mono resize-none focus:outline-none"
                                    style={{ minHeight: 120, lineHeight: 1.6 }}
                                    spellCheck={false}
                                    placeholder="輸入訓練 prompt..."
                                />
                            </div>

                            {/* Test Prompt Editor */}
                            <div className="flex flex-col flex-1 min-h-0">
                                <div className="flex items-center justify-between px-4 py-1.5 border-b shrink-0" style={{ borderColor: "#e7e5e4" }}>
                                    <span className="text-xs font-semibold text-stone-600">🧪 測試 Prompt</span>
                                    <button onClick={handleTest}
                                        disabled={!testPrompt.trim()}
                                        className={cn("px-2.5 py-0.5 text-[11px] font-bold rounded-md transition-colors",
                                            testPrompt.trim()
                                                ? "text-white hover:opacity-90 shadow-sm"
                                                : "bg-stone-200 text-stone-400 cursor-not-allowed")}
                                        style={{ backgroundColor: testPrompt.trim() ? "#059669" : undefined }}>
                                        {sendingTest ? "⏳" : "▶"} Test
                                    </button>
                                </div>
                                <textarea
                                    value={testPrompt}
                                    onChange={e => handleTestChange(e.target.value)}
                                    className="flex-1 w-full px-3 py-2 text-xs font-mono resize-none focus:outline-none"
                                    style={{ minHeight: 80, lineHeight: 1.6 }}
                                    spellCheck={false}
                                    placeholder="輸入測試 prompt，用簡單輸入驗證 app..."
                                />
                            </div>

                            {/* Action buttons */}
                            <div className="p-4 border-t" style={{ borderColor: "#e7e5e4" }}>
                                <div className="flex gap-2">
                                    {trainRun?.status === "done" && !published && (
                                        <button onClick={handlePublish} disabled={publishing}
                                            className="flex-1 py-2 rounded-lg text-xs font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50">
                                            {publishing ? "..." : "📤 上架"}
                                        </button>
                                    )}
                                </div>
                                {published && (
                                    <div className="p-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700 font-semibold text-center">
                                        ✅ 已上架！重啟後 sidebar Apps 會出現
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* ========== RIGHT PANEL — Tabs ========== */}
                <div className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: "#f5f5f4" }}>
                    {/* Tab Bar */}
                    <div className="flex items-center border-b shrink-0" style={{ borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
                        <button onClick={() => setRightTab("terminal")}
                            className={cn("px-4 py-2 text-xs font-semibold transition-colors border-b-2",
                                rightTab === "terminal" ? "border-stone-700 text-stone-700" : "border-transparent text-stone-400 hover:text-stone-600")}>
                            💻 Terminal
                        </button>
                        <button onClick={() => setRightTab("preview")}
                            className={cn("px-4 py-2 text-xs font-semibold transition-colors border-b-2",
                                rightTab === "preview" ? "border-stone-700 text-stone-700" : "border-transparent text-stone-400 hover:text-stone-600")}>
                            🖼️ Preview
                            {trainRun?.status === "done" && <span className="ml-1 text-green-500">●</span>}
                        </button>
                    </div>

                    {/* Terminal Tab */}
                    {rightTab === "terminal" && (
                        !chatStarted ? (
                            <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
                                <span className="text-4xl">🧪</span>
                                <p className="text-stone-400 text-sm text-center">
                                    寫好 prompt 後按 <strong>▶ Train</strong> 或 <strong>▶ Test</strong> 送出
                                </p>
                                <p className="text-stone-500 text-xs text-center">Ctrl+Enter 快速送出</p>
                            </div>
                        ) : (
                            <MemoizedTerminal
                                ref={terminalRef}
                                consoleKey={`applab-${consoleKey}`}
                                cli={cli}
                                initialPrompt={initialPrompt}
                            />
                        )
                    )}

                    {/* Preview Tab */}
                    {rightTab === "preview" && (
                        trainRun?.status === "done" ? (
                            <iframe ref={previewRef} className="flex-1 w-full border-0 bg-white" title="App Preview" />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full gap-2">
                                <span className="text-3xl">{trainRun?.status === "running" ? "⏳" : "🖼️"}</span>
                                <p className="text-stone-400 text-xs">
                                    {trainRun?.status === "running" ? "訓練中，完成後自動切到這裡" : "訓練完成後這裡會顯示預覽"}
                                </p>
                            </div>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}
