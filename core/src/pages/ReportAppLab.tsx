import React, { useState, useEffect, useRef } from "react";
import { cn } from "../utils";
import { useTheme } from "../theme";
import { SkillDefinition } from "../types";

const API = "http://127.0.0.1:4097";

type RightTab = "terminal" | "preview";

interface TrainRun {
    id: string;
    skillId: string;
    status: "running" | "done" | "error";
    output: string;
    htmlPath?: string;
}

interface TrainingRecord {
    id: string;
    reportName: string;
    skillId: string;
    skillName: string;
    template: string;
    prompt: string;
    generatedAt: string;
    htmlPath?: string;
    status: "trained" | "published";
}

const DEFAULT_PROMPT = `你是一個前端報表開發專家。請產出一個完整的 HTML 報表頁面。

## 報表規格
- Template 類型: {{TEMPLATE}}
- 報表名稱: {{REPORT_NAME}}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.35)" }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border" style={{ borderColor: t.accentBorder }}>
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

// ── Training File Viewer Dialog ──
function TrainingFileDialog({
    records,
    onLoad,
    onClose,
}: {
    records: TrainingRecord[];
    onLoad: (rec: TrainingRecord) => void;
    onClose: () => void;
}) {
    const { info: t } = useTheme();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.35)" }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border" style={{ borderColor: t.accentBorder }}>
                <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#e7e5e4" }}>
                    <h3 className="text-sm font-bold text-stone-700">📁 訓練紀錄</h3>
                    <button onClick={onClose} className="text-stone-400 hover:text-red-400 text-lg leading-none">&times;</button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                    {records.length === 0 ? (
                        <div className="text-center text-stone-400 text-xs py-10">還沒有訓練紀錄</div>
                    ) : (
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-stone-500 border-b" style={{ borderColor: "#e7e5e4" }}>
                                    <th className="px-4 py-2 font-semibold">Report 名稱</th>
                                    <th className="px-4 py-2 font-semibold">基底 Skill</th>
                                    <th className="px-4 py-2 font-semibold">Template</th>
                                    <th className="px-4 py-2 font-semibold">狀態</th>
                                    <th className="px-4 py-2 font-semibold">時間</th>
                                    <th className="px-4 py-2 font-semibold">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {records.map((rec, i) => (
                                    <tr key={rec.id || i} className="border-b hover:bg-stone-50" style={{ borderColor: "#f5f5f4" }}>
                                        <td className="px-4 py-2 font-semibold text-stone-700">{rec.reportName}</td>
                                        <td className="px-4 py-2 text-stone-500 font-mono text-[10px]">{rec.skillName || rec.skillId}</td>
                                        <td className="px-4 py-2">{TEMPLATES.find(t => t.id === rec.template)?.icon || "📊"} {rec.template}</td>
                                        <td className="px-4 py-2">
                                            <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-semibold",
                                                rec.status === "published" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                                                {rec.status === "published" ? "已上架" : "已訓練"}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-stone-400 whitespace-nowrap">{rec.generatedAt ? new Date(rec.generatedAt).toLocaleString() : "-"}</td>
                                        <td className="px-4 py-2">
                                            <button onClick={() => { onLoad(rec); onClose(); }}
                                                className="text-[10px] px-2 py-1 rounded-md font-semibold text-white"
                                                style={{ backgroundColor: t.accent }}>
                                                載入
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function ReportAppLab() {
    const { info: t } = useTheme();
    const [skills, setSkills] = useState<SkillDefinition[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState("dashboard");
    const [reportName, setReportName] = useState("");
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);

    const [rightTab, setRightTab] = useState<RightTab>("terminal");
    const [trainRun, setTrainRun] = useState<TrainRun | null>(null);
    const [published, setPublished] = useState(false);
    const [publishing, setPublishing] = useState(false);

    // Dialog states
    const [showSkillPicker, setShowSkillPicker] = useState(false);
    const [showTrainingFiles, setShowTrainingFiles] = useState(false);
    const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);

    const termRef = useRef<HTMLPreElement>(null);
    const previewRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        fetch(`${API}/api/skills`).then(r => r.json()).then(setSkills).catch(() => {});
    }, []);

    // Load training records from localStorage
    useEffect(() => {
        try {
            const saved = localStorage.getItem("reportLab.trainingRecords");
            if (saved) setTrainingRecords(JSON.parse(saved));
        } catch {}
    }, []);

    // Auto-scroll terminal
    useEffect(() => {
        if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
    }, [trainRun?.output]);

    const saveTrainingRecord = (rec: TrainingRecord) => {
        const updated = [rec, ...trainingRecords.filter(r => r.id !== rec.id)];
        setTrainingRecords(updated);
        localStorage.setItem("reportLab.trainingRecords", JSON.stringify(updated));
    };

    const handleSelectSkill = (sk: SkillDefinition) => {
        setSelectedSkill(sk);
        if (!reportName) setReportName(sk.name + "-report");
    };

    const handleLoadRecord = (rec: TrainingRecord) => {
        setReportName(rec.reportName);
        setSelectedTemplate(rec.template);
        setPrompt(rec.prompt || DEFAULT_PROMPT);
        // Re-select the skill if still available
        const sk = skills.find(s => s.id === rec.skillId);
        if (sk) setSelectedSkill(sk);
    };

    const handleTrain = async () => {
        if (!selectedSkill || !reportName) return;

        const runId = `train-${Date.now()}`;
        const run: TrainRun = { id: runId, skillId: selectedSkill.id, status: "running", output: "" };
        setTrainRun(run);
        setRightTab("terminal");
        setPublished(false);

        // Fill prompt template
        const filledPrompt = prompt
            .replace(/\{\{TEMPLATE\}\}/g, selectedTemplate)
            .replace(/\{\{REPORT_NAME\}\}/g, reportName)
            .replace(/\{\{SKILL_ID\}\}/g, selectedSkill.id);

        try {
            const resp = await fetch(`${API}/api/report-train`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    skillId: selectedSkill.id,
                    reportName,
                    template: selectedTemplate,
                    prompt: filledPrompt,
                    runId,
                }),
            });

            const reader = resp.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.type === "stdout" || msg.type === "stderr") {
                            setTrainRun(prev => prev ? { ...prev, output: prev.output + msg.data + "\n" } : prev);
                        }
                        if (msg.type === "done") {
                            setTrainRun(prev => prev ? { ...prev, status: "done", htmlPath: msg.data?.htmlPath } : prev);
                            // Save training record
                            saveTrainingRecord({
                                id: runId,
                                reportName,
                                skillId: selectedSkill.id,
                                skillName: selectedSkill.name,
                                template: selectedTemplate,
                                prompt,
                                generatedAt: new Date().toISOString(),
                                htmlPath: msg.data?.htmlPath,
                                status: "trained",
                            });
                            if (msg.data?.htmlPath) {
                                setRightTab("preview");
                                loadPreview(msg.data.htmlPath);
                            }
                        }
                        if (msg.type === "error") {
                            setTrainRun(prev => prev ? { ...prev, status: "error", output: prev.output + "\n❌ " + msg.data?.message + "\n" } : prev);
                        }
                    } catch {}
                }
            }
        } catch (err: any) {
            setTrainRun(prev => prev ? { ...prev, status: "error", output: prev.output + "\n❌ " + err.message + "\n" } : prev);
        }
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
        if (!trainRun?.htmlPath || !selectedSkill) return;
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
            if (data.ok) {
                setPublished(true);
                // Update training record status
                const updated = trainingRecords.map(r =>
                    r.htmlPath === trainRun.htmlPath ? { ...r, status: "published" as const } : r
                );
                setTrainingRecords(updated);
                localStorage.setItem("reportLab.trainingRecords", JSON.stringify(updated));
            }
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
            {showTrainingFiles && (
                <TrainingFileDialog
                    records={trainingRecords}
                    onLoad={handleLoadRecord}
                    onClose={() => setShowTrainingFiles(false)}
                />
            )}

            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                <span className="text-lg">🎨</span>
                <h2 className="text-sm font-bold" style={{ color: t.accentText }}>Report App Training Lab</h2>
                <span className="text-xs text-stone-400 ml-2">Design → Train → Preview → Publish</span>
                {/* Training Files button in header */}
                <button onClick={() => setShowTrainingFiles(true)}
                    className="ml-auto px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-stone-50 transition-colors flex items-center gap-1.5"
                    style={{ borderColor: t.accentBorder, color: t.accent }}>
                    📁 訓練紀錄
                    {trainingRecords.length > 0 && (
                        <span className="bg-stone-200 text-stone-600 rounded-full px-1.5 py-0.5 text-[10px] font-bold">{trainingRecords.length}</span>
                    )}
                </button>
            </div>

            <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* ========== LEFT PANEL ========== */}
                <div className="flex flex-col border-r overflow-y-auto" style={{ width: "40%", minWidth: 340, borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
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
                            <label className="text-xs font-bold text-stone-500">Report 名稱</label>
                            <input value={reportName} onChange={e => setReportName(e.target.value)}
                                className={inputCls} style={{ borderColor: "#d6d3d1" }} placeholder="my-report" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-stone-500">Template</label>
                            <div className="grid grid-cols-2 gap-1.5 mt-1">
                                {TEMPLATES.map(tmpl => (
                                    <button key={tmpl.id} onClick={() => setSelectedTemplate(tmpl.id)}
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

                    {/* Prompt Editor */}
                    <div className="p-4 flex-1 flex flex-col min-h-0">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-stone-500">📝 Prompt (可手動調整)</label>
                            <button onClick={() => setPrompt(DEFAULT_PROMPT)} className="text-[10px] text-stone-400 hover:text-stone-600">Reset</button>
                        </div>
                        <textarea
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            className="flex-1 w-full px-3 py-2 border rounded-lg text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-stone-300"
                            style={{ borderColor: "#d6d3d1", minHeight: 200 }}
                            spellCheck={false}
                        />
                        <div className="flex gap-2 mt-3">
                            <button onClick={handleTrain}
                                disabled={!selectedSkill || !reportName || trainRun?.status === "running"}
                                className="flex-1 py-2 rounded-lg text-xs font-bold text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                                style={{ backgroundColor: t.accent }}>
                                {trainRun?.status === "running"
                                    ? <><span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Training...</>
                                    : "🚀 開始訓練"}
                            </button>
                            {trainRun?.status === "done" && !published && (
                                <button onClick={handlePublish} disabled={publishing}
                                    className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50">
                                    {publishing ? "..." : "📤 上架"}
                                </button>
                            )}
                        </div>
                        {published && (
                            <div className="mt-2 p-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700 font-semibold text-center">
                                ✅ 已上架！重啟後 sidebar Apps 會出現
                            </div>
                        )}
                    </div>
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
                        {trainRun?.status === "running" && (
                            <span className="ml-auto text-[10px] text-stone-400 pr-3 flex items-center gap-1">
                                <span className="inline-block w-2 h-2 bg-amber-400 rounded-full animate-pulse" /> running
                            </span>
                        )}
                    </div>

                    {/* Terminal Tab */}
                    {rightTab === "terminal" && (
                        <pre ref={termRef}
                            className="flex-1 p-4 text-xs font-mono text-stone-300 overflow-auto bg-stone-900 whitespace-pre-wrap"
                            style={{ tabSize: 2 }}>
                            {trainRun?.output || "# 選好 Skill → 調整 Prompt → 按 開始訓練\n# CLI 輸出會出現在這裡\n"}
                        </pre>
                    )}

                    {/* Preview Tab */}
                    {rightTab === "preview" && (
                        trainRun?.status === "done" ? (
                            <iframe ref={previewRef} className="flex-1 w-full border-0 bg-white" title="Report Preview" />
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
