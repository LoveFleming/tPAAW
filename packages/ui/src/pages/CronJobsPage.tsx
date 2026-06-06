import React, { useState, useEffect, useRef } from "react";
import { useTheme } from "../theme";

const API = "http://127.0.0.1:4097";

interface CronJob {
    id: string;
    name: string;
    type: "report" | "reminder";
    reminderText?: string;
    reportAppId: string;
    schedule: string;
    prompt: string;
    params: Record<string, string>;
    enabled: boolean;
    createdAt: string;
    lastRun: string | null;
    lastStatus: string | null;
}

interface LogEntry {
    runId: string;
    status: string;
    ts: string;
    outputLength?: number;
    hasHtml?: boolean;
    resultFile?: string;
    error?: string;
}

interface ResultFile {
    file: string;
    name: string;
    type: "html" | "text";
}

interface ReportApp {
    id: string;
    name: string;
}

const PRESETS = [
    { label: "每小時", expr: "0 * * * *" },
    { label: "每天 9:00", expr: "0 9 * * *" },
    { label: "每天 18:00", expr: "0 18 * * *" },
    { label: "每 6 小時", expr: "0 */6 * * *" },
    { label: "每天 0:00", expr: "0 0 * * *" },
    { label: "每周一 9:00", expr: "0 9 * * 1" },
];

type RightTab = "logs" | "results" | "result-view";

export default function CronJobsPage() {
    const { info: t } = useTheme();
    const [jobs, setJobs] = useState<CronJob[]>([]);
    const [apps, setApps] = useState<ReportApp[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [results, setResults] = useState<ResultFile[]>([]);
    const [selectedJob, setSelectedJob] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [rightTab, setRightTab] = useState<RightTab>("logs");
    const [viewingResult, setViewingResult] = useState<string | null>(null);

    const [formName, setFormName] = useState("");
    const [formType, setFormType] = useState<"report" | "reminder">("reminder");
    const [formAppId, setFormAppId] = useState("");
    const [formSchedule, setFormSchedule] = useState("0 9 * * *");
    const [formPrompt, setFormPrompt] = useState("");
    const [formReminderText, setFormReminderText] = useState("");
    const [formParams, setFormParams] = useState<{ key: string; value: string }[]>([]);

    const resultIframeRef = useRef<HTMLIFrameElement>(null);

    const reload = () => {
        fetch(`${API}/api/cron-jobs`).then(r => r.json()).then(setJobs).catch(() => {});
        fetch(`${API}/api/skills`)
            .then(r => r.json())
            .then((data: any[]) => setApps(data.filter(s => s.hasApp).map(s => ({ id: s.id, name: s.name }))))
            .catch(() => {});
    };

    useEffect(() => { reload(); }, []);

    const loadJobDetail = (jobId: string) => {
        setSelectedJob(jobId);
        setRightTab("logs");
        setViewingResult(null);
        fetch(`${API}/api/cron-jobs/${jobId}/logs`).then(r => r.json()).then(setLogs).catch(() => setLogs([]));
        fetch(`${API}/api/cron-jobs/${jobId}/results`).then(r => r.json()).then(setResults).catch(() => setResults([]));
    };

    const addParam = () => setFormParams([...formParams, { key: "", value: "" }]);
    const removeParam = (idx: number) => setFormParams(formParams.filter((_, i) => i !== idx));
    const updateParam = (idx: number, field: "key" | "value", val: string) => {
        const updated = [...formParams];
        updated[idx] = { ...updated[idx], [field]: val };
        setFormParams(updated);
    };

    const handleCreate = async () => {
        if (!formName) return;
        if (formType === "report" && !formAppId) return;
        const params: Record<string, string> = {};
        formParams.forEach(p => { if (p.key) params[p.key] = p.value; });
        await fetch(`${API}/api/cron-jobs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: formName,
                type: formType,
                reminderText: formReminderText,
                reportAppId: formAppId,
                schedule: formSchedule,
                prompt: formPrompt,
                params,
            }),
        });
        setFormName(""); setFormType("reminder"); setFormAppId(""); setFormSchedule("0 9 * * *"); setFormPrompt(""); setFormReminderText(""); setFormParams([]);
        setShowCreate(false);
        reload();
    };

    const handleToggle = async (job: CronJob) => {
        await fetch(`${API}/api/cron-jobs/${job.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: !job.enabled }),
        });
        reload();
    };

    const handleDelete = async (id: string) => {
        await fetch(`${API}/api/cron-jobs/${id}`, { method: "DELETE" });
        if (selectedJob === id) { setSelectedJob(null); setLogs([]); setResults([]); }
        reload();
    };

    const handleRunNow = async (id: string) => {
        await fetch(`${API}/api/cron-jobs/${id}/run`, { method: "POST" });
        setTimeout(() => loadJobDetail(id), 3000);
    };

    const viewResult = (file: string) => {
        if (!selectedJob) return;
        setViewingResult(file);
        setRightTab("result-view");
        const path = `${API}/api/cron-result?path=${encodeURIComponent(`/Users/steward/App/tAgent/logs/cron-results/${selectedJob}/${file}`)}`;
        setTimeout(() => {
            if (!resultIframeRef.current) return;
            const doc = resultIframeRef.current.contentDocument;
            if (!doc) return;
            if (file.endsWith(".html")) {
                resultIframeRef.current.src = path;
            } else {
                fetch(path).then(r => r.text()).then(text => {
                    doc.open();
                    doc.write(`<html><body style="font-family:monospace;font-size:14px;white-space:pre-wrap;padding:20px;background:#1e1e1e;color:#d4d4d4;">${text.replace(/</g, "&lt;")}</body></html>`);
                    doc.close();
                });
            }
        }, 100);
    };

    const statusIcon = (status: string | null) => {
        if (!status) return "⏸️";
        if (status === "done") return "✅";
        if (status === "error") return "❌";
        return "🔄";
    };

    const selectedJobData = jobs.find(j => j.id === selectedJob);

    return (
        <div className="h-full flex" style={{ backgroundColor: "#fafaf9" }}>
            {/* Left: Job List */}
            <div className="w-96 flex flex-col border-r" style={{ borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
                <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0" style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}>
                    <span className="text-xl">⏰</span>
                    <h2 className="text-sm font-bold" style={{ color: t.accentText }}>Cron Jobs</h2>
                    <span className="text-xs text-stone-400 ml-1">{jobs.length}</span>
                    <button onClick={() => setShowCreate(!showCreate)}
                        className="ml-auto text-sm font-bold px-3 py-1 rounded-lg text-white"
                        style={{ backgroundColor: t.accent }}>
                        + New
                    </button>
                </div>

                {/* Create Form */}
                {showCreate && (
                    <div className="p-4 border-b space-y-3" style={{ borderColor: "#e7e5e4", backgroundColor: "#fafaf9" }}>
                        <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Job 名稱（例如：吃保健品提醒）"
                            className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "#d6d3d1" }} />
                        {/* Type selector */}
                        <div className="flex gap-2">
                            <button onClick={() => setFormType("reminder")}
                                className={`flex-1 py-2 rounded-lg text-sm font-bold border ${formType === "reminder" ? "border-amber-400 bg-amber-50 text-amber-700" : "border-stone-200 text-stone-400"}`}>
                                ⏰ 提醒
                            </button>
                            <button onClick={() => setFormType("report")}
                                className={`flex-1 py-2 rounded-lg text-sm font-bold border ${formType === "report" ? "border-blue-400 bg-blue-50 text-blue-700" : "border-stone-200 text-stone-400"}`}>
                                📊 報告
                            </button>
                        </div>
                        {formType === "reminder" ? (
                            <input value={formReminderText} onChange={e => setFormReminderText(e.target.value)} placeholder="提醒內容（例如：該吃保健品了！）"
                                className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "#d6d3d1" }} />
                        ) : (
                            <>
                                <select value={formAppId} onChange={e => setFormAppId(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "#d6d3d1" }}>
                                    <option value="">選擇 Report App</option>
                                    {apps.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                                </select>
                                <textarea value={formPrompt} onChange={e => setFormPrompt(e.target.value)} placeholder="Prompt (可選)"
                                    className="w-full px-3 py-2 border rounded-lg text-sm font-mono resize-none" rows={2} style={{ borderColor: "#d6d3d1" }} />
                            </>
                        )}
                        <div>
                            <div className="text-xs text-stone-500 mb-1.5 font-semibold">排程</div>
                            <input value={formSchedule} onChange={e => setFormSchedule(e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg text-sm font-mono" style={{ borderColor: "#d6d3d1" }} />
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {PRESETS.map(p => (
                                    <button key={p.expr} onClick={() => setFormSchedule(p.expr)}
                                        className={`text-xs px-2 py-1 rounded-md border ${formSchedule === p.expr ? "border-blue-400 bg-blue-50 text-blue-600" : "border-stone-200 text-stone-500"}`}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* Params */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs text-stone-500 font-semibold">參數</span>
                                <button onClick={addParam} className="text-xs text-blue-500 font-semibold">+ Add</button>
                            </div>
                            {formParams.map((p, i) => (
                                <div key={i} className="flex gap-1.5 mb-1.5">
                                    <input value={p.key} onChange={e => updateParam(i, "key", e.target.value)} placeholder="key"
                                        className="flex-1 px-2 py-1.5 border rounded-md text-xs font-mono" style={{ borderColor: "#d6d3d1" }} />
                                    <input value={p.value} onChange={e => updateParam(i, "value", e.target.value)} placeholder="value"
                                        className="flex-1 px-2 py-1.5 border rounded-md text-xs font-mono" style={{ borderColor: "#d6d3d1" }} />
                                    <button onClick={() => removeParam(i)} className="text-red-400 text-sm px-1">✕</button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleCreate} disabled={!formName || (formType === "report" && !formAppId)}
                                className="flex-1 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                                style={{ backgroundColor: t.accent }}>建立</button>
                            <button onClick={() => setShowCreate(false)}
                                className="px-4 py-2 rounded-lg text-sm border text-stone-500" style={{ borderColor: "#d6d3d1" }}>取消</button>
                        </div>
                    </div>
                )}

                {/* Job List */}
                <div className="flex-1 overflow-y-auto">
                    {jobs.length === 0 && !showCreate && (
                        <div className="flex flex-col items-center justify-center h-64 gap-3">
                            <span className="text-4xl">⏰</span>
                            <p className="text-stone-400 text-sm">沒有 Cron Job</p>
                        </div>
                    )}
                    {jobs.map(job => (
                        <div key={job.id}
                            onClick={() => loadJobDetail(job.id)}
                            className={`px-4 py-3 border-b cursor-pointer transition-colors hover:bg-stone-50 ${selectedJob === job.id ? "bg-blue-50/50 border-l-2" : ""}`}
                            style={{ borderColor: "#e7e5e4", borderLeftColor: selectedJob === job.id ? t.accent : undefined }}>
                            <div className="flex items-center gap-2">
                                <span className="text-sm">{statusIcon(job.lastStatus)}</span>
                                <span className="text-sm">{job.type === "reminder" ? "⏰" : "📊"}</span>
                                <span className="text-sm font-semibold text-stone-700 flex-1 truncate">{job.name}</span>
                                <button onClick={e => { e.stopPropagation(); handleToggle(job); }}
                                    className={`text-xs px-2 py-0.5 rounded-md font-semibold ${job.enabled ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-400"}`}>
                                    {job.enabled ? "ON" : "OFF"}
                                </button>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-xs text-stone-400 font-mono">{job.schedule}</span>
                                <span className="text-xs text-stone-300">→</span>
                                <span className="text-xs text-stone-500 truncate">{job.reportAppId}</span>
                            </div>
                            {job.lastRun && (
                                <div className="text-xs text-stone-400 mt-1">
                                    Last: {new Date(job.lastRun).toLocaleString("zh-TW")}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Right: Detail */}
            <div className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: "#fafaf9" }}>
                {!selectedJob ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <span className="text-4xl">📋</span>
                        <p className="text-stone-400 text-sm">選擇一個 Job 查看詳情</p>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="px-5 py-3 border-b shrink-0 flex items-center gap-3" style={{ borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
                            <span className="text-xl">{statusIcon(selectedJobData?.lastStatus ?? null)}</span>
                            <div className="flex-1 min-w-0">
                                <div className="text-base font-bold text-stone-700">{selectedJobData?.name}</div>
                                <div className="text-xs text-stone-400 mt-0.5">
                                    <span className="font-mono">{selectedJobData?.schedule}</span>
                                    <span className="mx-1.5 text-stone-300">→</span>
                                    <span className="text-stone-500">{selectedJobData?.type === "reminder" ? "⏰ 提醒" : selectedJobData?.reportAppId}</span>
                                    {selectedJobData?.type === "reminder" && selectedJobData?.reminderText && (
                                        <span className="ml-2 text-amber-600">{selectedJobData.reminderText}</span>
                                    )}
                                    {selectedJobData?.params && Object.keys(selectedJobData.params).length > 0 && (
                                        <>
                                            <span className="mx-1.5 text-stone-300">|</span>
                                            {Object.entries(selectedJobData.params).map(([k, v]) => (
                                                <span key={k} className="mr-2"><span className="text-stone-400">{k}</span>=<span className="text-stone-600">{v}</span></span>
                                            ))}
                                        </>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => handleRunNow(selectedJob)}
                                className="text-sm font-bold px-4 py-2 rounded-lg text-white"
                                style={{ backgroundColor: t.accent }}>
                                ▶ Run Now
                            </button>
                            <button onClick={() => handleDelete(selectedJob)}
                                className="text-sm font-bold px-3 py-2 rounded-lg border text-red-500 border-red-200 hover:bg-red-50">
                                🗑️
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex items-center border-b shrink-0" style={{ borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
                            <button onClick={() => { setRightTab("logs"); setViewingResult(null); }}
                                className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${rightTab === "logs" ? "border-stone-700 text-stone-700" : "border-transparent text-stone-400"}`}>
                                📋 執行紀錄 ({logs.length})
                            </button>
                            <button onClick={() => { setRightTab("results"); setViewingResult(null); }}
                                className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${rightTab === "results" ? "border-stone-700 text-stone-700" : "border-transparent text-stone-400"}`}>
                                📊 結果 ({results.length})
                            </button>
                        </div>

                        {/* Logs Tab */}
                        {rightTab === "logs" && (
                            <div className="flex-1 overflow-y-auto p-5">
                                {logs.length === 0 ? (
                                    <div className="text-stone-400 text-sm text-center py-10">沒有執行紀錄</div>
                                ) : (
                                    <div className="space-y-3">
                                        {[...logs].reverse().map((log, i) => (
                                            <div key={i} className="p-4 border rounded-xl text-sm" style={{
                                                borderColor: log.status === "error" ? "#fecaca" : log.status === "done" ? "#bbf7d0" : "#e7e5e4",
                                                backgroundColor: log.status === "error" ? "#fef2f2" : log.status === "done" ? "#f0fdf4" : "#fff"
                                            }}>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-base">{log.status === "error" ? "❌" : log.status === "done" ? "✅" : "🔄"}</span>
                                                    <span className="font-semibold text-stone-700">{log.status}</span>
                                                    {log.hasHtml && <span className="text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">HTML</span>}
                                                    {log.outputLength != null && <span className="text-xs text-stone-400">{log.outputLength} chars</span>}
                                                    <span className="text-xs text-stone-400 ml-auto">{new Date(log.ts).toLocaleString("zh-TW")}</span>
                                                </div>
                                                {log.error && <div className="text-red-500 text-sm mt-2">{log.error}</div>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Results Tab */}
                        {rightTab === "results" && (
                            <div className="flex-1 overflow-y-auto p-5">
                                {results.length === 0 ? (
                                    <div className="text-stone-400 text-sm text-center py-10">沒有結果，按 Run Now 執行一次</div>
                                ) : (
                                    <div className="space-y-3">
                                        {results.map((r, i) => (
                                            <button key={i} onClick={() => viewResult(r.file)}
                                                className="w-full text-left p-4 border rounded-xl hover:shadow-sm transition-all flex items-center gap-4"
                                                style={{ borderColor: "#e7e5e4" }}>
                                                <span className="text-2xl">{r.type === "html" ? "📄" : "📝"}</span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-semibold text-stone-700">{r.name.replace(/-/g, " ").replace(/T/g, " ")}</div>
                                                    <div className="text-xs text-stone-400">{r.type.toUpperCase()}</div>
                                                </div>
                                                <span className="text-sm text-stone-400">→</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Result View Tab */}
                        {rightTab === "result-view" && (
                            <iframe ref={resultIframeRef} className="flex-1 w-full border-0 bg-white" title="Result" />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
