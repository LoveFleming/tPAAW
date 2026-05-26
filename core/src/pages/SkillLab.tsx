import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "../utils";
import TerminalConsole from "../components/TerminalConsole";

// ── Types ──
interface TrainingFile {
    name: string;
    path: string;
}

// ── Constants ──
const API_BASE = "http://127.0.0.1:4097";
const LS_KEY_TRAINING_FILE = "skilllab.trainingFile";
const LS_KEY_TRAINING_PROMPT = "skilllab.trainingPrompt";
const LS_KEY_TEST_PROMPT = "skilllab.testPrompt";

// ── Auto-save textarea with debounce ──
function AutoSaveEditor({
    label,
    value,
    onChange,
    placeholder,
    storageKey,
    rows = 10,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    storageKey: string;
    rows?: number;
}) {
    const [draft, setDraft] = useState(value);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();
    const savedRef = useRef(false);

    // Sync external value changes (e.g., loaded from file)
    useEffect(() => {
        if (!savedRef.current) setDraft(value);
        savedRef.current = false;
    }, [value]);

    const handleChange = (v: string) => {
        setDraft(v);
        onChange(v);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            localStorage.setItem(storageKey, v);
        }, 500);
    };

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-3 py-1.5 border-b" style={{ borderColor: "#e7e5e4" }}>
                <span className="text-xs font-semibold text-stone-600">{label}</span>
                <span className="text-[10px] text-stone-400">{draft.length} 字</span>
            </div>
            <textarea
                value={draft}
                onChange={e => handleChange(e.target.value)}
                placeholder={placeholder}
                rows={rows}
                className="flex-1 w-full px-3 py-2 text-sm font-mono resize-none focus:outline-none border-0"
                style={{ minHeight: 120, lineHeight: 1.6 }}
                spellCheck={false}
            />
        </div>
    );
}

// ── Main SkillLab Page ──
export default function SkillLab() {
    const [trainingFiles, setTrainingFiles] = useState<TrainingFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<string>("");
    const [trainingPrompt, setTrainingPrompt] = useState(() => localStorage.getItem(LS_KEY_TRAINING_PROMPT) || "");
    const [testPrompt, setTestPrompt] = useState(() => localStorage.getItem(LS_KEY_TEST_PROMPT) || "");
    const [fileContent, setFileContent] = useState<string>("");
    const [cli, setCli] = useState<"qwen" | "claude" | "opencode">("qwen");
    const [consoleKey, setConsoleKey] = useState(0);
    const [mode, setMode] = useState<"train" | "test">("train");
    const [workingDir, setWorkingDir] = useState<string>("");
    const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty">("saved");

    // Load training files list
    useEffect(() => {
        fetch(`${API_BASE}/api/skill-lab/training-files`)
            .then(r => r.ok ? r.json() : [])
            .then((files: TrainingFile[]) => setTrainingFiles(files))
            .catch(() => {});
    }, []);

    // Load working directory
    useEffect(() => {
        fetch(`${API_BASE}/api/aioc-root`)
            .then(r => r.ok ? r.json() : {})
            .then((d: { aiocRoot?: string }) => { if (d.aiocRoot) setWorkingDir(d.aiocRoot); })
            .catch(() => {});
    }, []);

    // Restore last selected file
    useEffect(() => {
        const saved = localStorage.getItem(LS_KEY_TRAINING_FILE);
        if (saved) {
            setSelectedFile(saved);
            loadFileContent(saved);
        }
    }, []);

    const loadFileContent = useCallback((path: string) => {
        fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(path)}`)
            .then(r => r.ok ? r.json() : null)
            .then((data: { content?: string } | null) => {
                if (data?.content) setFileContent(data.content);
                else setFileContent("");
            })
            .catch(() => setFileContent(""));
    }, []);

    const handleSelectFile = (path: string) => {
        setSelectedFile(path);
        localStorage.setItem(LS_KEY_TRAINING_FILE, path);
        loadFileContent(path);
    };

    // Save file content back to disk
    const saveFile = useCallback(async (content: string) => {
        if (!selectedFile) return;
        setSaveStatus("saving");
        try {
            await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(selectedFile)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });
            setSaveStatus("saved");
        } catch {
            setSaveStatus("dirty");
        }
    }, [selectedFile]);

    // Auto-save file content with debounce
    const fileSaveTimer = useRef<ReturnType<typeof setTimeout>>();
    const handleFileEdit = useCallback((newContent: string) => {
        setFileContent(newContent);
        setSaveStatus("dirty");
        clearTimeout(fileSaveTimer.current);
        fileSaveTimer.current = setTimeout(() => saveFile(newContent), 1000);
    }, [saveFile]);

    // Build the combined prompt to send to CLI
    const buildPrompt = useCallback(() => {
        if (mode === "train") {
            return [
                trainingPrompt || "# Training Prompt\n(尚未設定訓練 prompt)",
                "",
                "---",
                "# Training Skill File",
                selectedFile ? `File: ${selectedFile}` : "(尚未選擇檔案)",
                "",
                fileContent || "(空的)",
            ].join("\n");
        } else {
            return [
                testPrompt || "# Test Prompt\n(尚未設定測試 prompt)",
                "",
                "---",
                "# Current Skill Content",
                fileContent || "(空的)",
            ].join("\n");
        }
    }, [mode, trainingPrompt, testPrompt, selectedFile, fileContent]);

    // Send to CLI
    const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
    const [chatStarted, setChatStarted] = useState(false);
    const [restartTrigger, setRestartTrigger] = useState(0);

    const handleSend = () => {
        const prompt = buildPrompt();
        setInitialPrompt(prompt);
        setChatStarted(true);
        setConsoleKey(prev => prev + 1);
    };

    const handleResend = () => {
        const prompt = buildPrompt();
        setInitialPrompt(prompt);
        setRestartTrigger(prev => prev + 1);
    };

    return (
        <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: "#fafaf9" }}>
            {/* ── Header ── */}
            <div className="shrink-0 px-4 py-2 border-b flex items-center gap-4" style={{ borderColor: "#e7e5e4" }}>
                <div className="flex items-center gap-2">
                    <span className="text-lg">🧪</span>
                    <h2 className="text-sm font-bold text-stone-800">Skill Lab</h2>
                </div>

                {/* Training file selector */}
                <div className="flex items-center gap-2 ml-4">
                    <label className="text-[11px] font-medium text-stone-500">Training File:</label>
                    <select
                        value={selectedFile}
                        onChange={e => handleSelectFile(e.target.value)}
                        className="text-xs px-2 py-1 border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-200"
                        style={{ minWidth: 200 }}
                    >
                        <option value="">-- 選擇 Training Skill File --</option>
                        {trainingFiles.map(f => (
                            <option key={f.path} value={f.path}>
                                {f.name}
                            </option>
                        ))}
                    </select>
                    {selectedFile && (
                        <span className="text-[10px] text-stone-400" title={selectedFile}>
                            {selectedFile.split(/[/\\]/).pop()}
                        </span>
                    )}
                    {saveStatus === "saving" && <span className="text-[10px] text-amber-500">💾 saving...</span>}
                    {saveStatus === "saved" && <span className="text-[10px] text-green-500">✓ saved</span>}
                    {saveStatus === "dirty" && <span className="text-[10px] text-rose-500">● unsaved</span>}
                </div>

                {/* CLI selector */}
                <div className="flex items-center gap-2">
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

                {/* Mode toggle */}
                <div className="flex rounded-lg overflow-hidden border border-stone-200">
                    <button
                        onClick={() => setMode("train")}
                        className={cn("px-3 py-1 text-xs font-medium transition-colors", mode === "train" ? "bg-blue-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50")}
                    >
                        🎓 Train
                    </button>
                    <button
                        onClick={() => setMode("test")}
                        className={cn("px-3 py-1 text-xs font-medium transition-colors", mode === "test" ? "bg-emerald-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50")}
                    >
                        🧪 Test
                    </button>
                </div>

                {/* Send buttons */}
                <div className="flex gap-1.5 ml-auto">
                    {!chatStarted ? (
                        <button
                            onClick={handleSend}
                            disabled={!selectedFile || (!trainingPrompt && !testPrompt)}
                            className={cn(
                                "px-4 py-1.5 text-xs font-bold rounded-lg transition-colors",
                                selectedFile && (trainingPrompt || testPrompt)
                                    ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                                    : "bg-stone-200 text-stone-400 cursor-not-allowed"
                            )}
                        >
                            ▶ 開始訓練
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={handleResend}
                                disabled={mode === "train" ? !trainingPrompt : !testPrompt}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-bold rounded-lg transition-colors",
                                    (mode === "train" ? trainingPrompt : testPrompt)
                                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                                        : "bg-stone-200 text-stone-400 cursor-not-allowed"
                                )}
                            >
                                🔄 {mode === "train" ? "重新訓練" : "重新測試"}
                            </button>
                            <button
                                onClick={() => { setChatStarted(false); setInitialPrompt(undefined); setConsoleKey(prev => prev + 1); }}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50"
                            >
                                ✕ Reset
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Body: 3-panel layout ── */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* Left: Training Skill File Editor */}
                <div className="flex flex-col border-r" style={{ width: "35%", borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b" style={{ borderColor: "#e7e5e4" }}>
                        <span className="text-xs font-semibold text-stone-600">
                            📄 {selectedFile ? selectedFile.split(/[/\\]/).pop() : "Training File"}
                        </span>
                        <span className="text-[10px] text-stone-400">{fileContent.length} 字</span>
                    </div>
                    <textarea
                        value={fileContent}
                        onChange={e => handleFileEdit(e.target.value)}
                        placeholder={selectedFile ? "編輯 training skill file..." : "← 先選擇一個 training file"}
                        className="flex-1 w-full px-3 py-2 text-sm font-mono resize-none focus:outline-none border-0"
                        style={{ lineHeight: 1.6 }}
                        spellCheck={false}
                        disabled={!selectedFile}
                    />
                </div>

                {/* Middle: Prompt Editors (stacked) */}
                <div className="flex flex-col border-r" style={{ width: "30%", borderColor: "#e7e5e4" }}>
                    <AutoSaveEditor
                        label="🎓 Training Prompt (送給 AI 產生/修改 skill)"
                        value={trainingPrompt}
                        onChange={setTrainingPrompt}
                        placeholder={"輸入訓練 prompt...\n\n例：請根據以下 training file 規格，鍛造一個完整的 Skill。\n注意 userInputs 的格式要符合 YAML 規範。"}
                        storageKey={LS_KEY_TRAINING_PROMPT}
                    />
                    <div style={{ height: 1, backgroundColor: "#e7e5e4" }} />
                    <AutoSaveEditor
                        label="🧪 Test Prompt (用簡單輸入測試 skill)"
                        value={testPrompt}
                        onChange={setTestPrompt}
                        placeholder={"輸入測試 prompt...\n\n例：用這個 skill 分析 /src/utils/index.ts 的錯誤處理是否完整。"}
                        storageKey={LS_KEY_TEST_PROMPT}
                    />
                </div>

                {/* Right: Terminal */}
                <div className="flex flex-col flex-1 min-w-0" style={{ backgroundColor: "#1a1a2e" }}>
                    {!chatStarted ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <span className="text-4xl">🧪</span>
                            <p className="text-stone-400 text-sm">
                                {selectedFile ? "設定好 prompt 後按 ▶ 開始" : "← 先選擇一個 Training File"}
                            </p>
                            {trainingFiles.length === 0 && (
                                <p className="text-stone-400 text-xs">
                                    沒有找到 training files。在 skills/ 目錄下建立 <code className="bg-stone-200 px-1 rounded">*-training.md</code> 檔案
                                </p>
                            )}
                        </div>
                    ) : (
                        <TerminalConsole
                            key={`skilllab-${consoleKey}`}
                            cwd={workingDir || undefined}
                            cli={cli}
                            approvalMode="yolo"
                            initialPrompt={initialPrompt}
                            restartTrigger={restartTrigger}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
