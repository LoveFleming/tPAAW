import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../utils";
import AgentConsole, { AgentConsoleHandle } from "../components/AgentConsole";

// ── Types ──
interface TrainingFile {
    name: string;
    path: string;
}

// ── Constants ──
import API_BASE from "../api";
const LS_KEY_TRAINING_FILE = "skilllab.trainingFile";

// ── Parse training file into sections ──
function parseTrainingFile(content: string): { training: string; test: string } {
    let training = "";
    let test = "";

    // Find section positions
    const trainIdx = content.search(/##\s*訓練\s*Prompt/i);
    const testIdx = content.search(/##\s*測試\s*Prompt/i);

    if (trainIdx === -1 && testIdx === -1) {
        // No markers — everything goes to training
        training = content.trim();
    } else if (trainIdx !== -1 && testIdx !== -1) {
        // Both markers exist
        const afterTrain = content.indexOf('\n', trainIdx) + 1; // skip the ## line
        training = content.slice(afterTrain, testIdx).trim();
        const afterTest = content.indexOf('\n', testIdx) + 1;
        test = content.slice(afterTest).trim();
    } else if (trainIdx !== -1) {
        const afterTrain = content.indexOf('\n', trainIdx) + 1;
        training = content.slice(afterTrain).trim();
    } else {
        const afterTest = content.indexOf('\n', testIdx) + 1;
        test = content.slice(afterTest).trim();
    }

    return { training, test };
}

function buildFileContent(training: string, test: string): string {
    const parts: string[] = [];
    if (training.trim() || test.trim()) {
        // Reconstruct with section markers
        parts.push("# Training Skill\n");
        parts.push("## 訓練 Prompt\n");
        parts.push(training.trim() + "\n");
        parts.push("## 測試 Prompt\n");
        parts.push(test.trim() + "\n");
    }
    return parts.join("\n");
}

// ── Prompt Editor with auto-save + send button ──
function PromptEditor({
    label,
    emoji,
    value,
    onChange,
    placeholder,
    sendLabel,
    sendColor,
    onSend,
    sending,
}: {
    label: string;
    emoji: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    sendLabel: string;
    sendColor: string;
    onSend: () => void;
    sending?: boolean;
}) {
    const [draft, setDraft] = useState(value);

    useEffect(() => { setDraft(value); }, [value]);

    const handleChange = (v: string) => {
        setDraft(v);
        onChange(v);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSend();
        }
    };

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-3 py-1.5 border-b shrink-0" style={{ borderColor: "#e7e5e4" }}>
                <span className="text-xs font-semibold text-stone-600">{emoji} {label}</span>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-stone-400">{draft.length} 字</span>
                    <button
                        onClick={onSend}
                        disabled={sending || !draft.trim()}
                        className={cn(
                            "px-2.5 py-0.5 text-[11px] font-bold rounded-md transition-colors",
                            draft.trim() && !sending
                                ? "text-white hover:opacity-90 shadow-sm"
                                : "bg-stone-200 text-stone-400 cursor-not-allowed"
                        )}
                        style={{ backgroundColor: draft.trim() && !sending ? sendColor : undefined }}
                    >
                        {sending ? "⏳" : "▶"} {sendLabel}
                    </button>
                </div>
            </div>
            <textarea
                value={draft}
                onChange={e => handleChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="flex-1 w-full px-3 py-2 text-sm font-mono resize-none focus:outline-none border-0"
                style={{ minHeight: 80, lineHeight: 1.6 }}
                spellCheck={false}
            />
        </div>
    );
}

// ── Main SkillLab Page ──
export default function SkillLab() {
    const [trainingFiles, setTrainingFiles] = useState<TrainingFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<string>("");
    const [trainingPrompt, setTrainingPrompt] = useState("");
    const [testPrompt, setTestPrompt] = useState("");
    const [cli, setCli] = useState<"qwen" | "claude" | "opencode">("qwen");
    const [consoleKey, setConsoleKey] = useState(0);
    const [workingDir, setWorkingDir] = useState<string>("");
    const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty">("saved");

    // New file dialog
    const [showNewFileDialog, setShowNewFileDialog] = useState(false);
    const [newFileName, setNewFileName] = useState("");

    // Terminal state
    const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
    const [chatStarted, setChatStarted] = useState(false);
    const [sendingTrain, setSendingTrain] = useState(false);
    const [sendingTest, setSendingTest] = useState(false);

    // Track last loaded content to avoid save loops
    const loadingRef = useRef(false);

    // ── Data loading ──
    const loadTrainingFiles = useCallback(() => {
        fetch(`${API_BASE}/api/skill-lab/training-files`)
            .then(r => r.ok ? r.json() : [])
            .then((files: TrainingFile[]) => setTrainingFiles(files))
            .catch(() => {});
    }, []);

    useEffect(() => { loadTrainingFiles(); }, [loadTrainingFiles]);

    useEffect(() => {
        fetch(`${API_BASE}/api/paaw-root`)
            .then(r => r.ok ? r.json() : {})
            .then((d: { paawRoot?: string }) => { if (d.paawRoot) setWorkingDir(d.paawRoot); })
            .catch(() => {});
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem(LS_KEY_TRAINING_FILE);
        if (saved) { setSelectedFile(saved); loadFileContent(saved); }
    }, []);

    // ── File operations ──
    const loadFileContent = useCallback((path: string) => {
        loadingRef.current = true;
        fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(path)}`)
            .then(r => r.ok ? r.json() : null)
            .then((data: { content?: string } | null) => {
                const parsed = parseTrainingFile(data?.content || "");
                setTrainingPrompt(parsed.training);
                setTestPrompt(parsed.test);
                setSaveStatus("saved");
            })
            .catch(() => { setTrainingPrompt(""); setTestPrompt(""); })
            .finally(() => { loadingRef.current = false; });
    }, []);

    const handleSelectFile = (path: string) => {
        setSelectedFile(path);
        localStorage.setItem(LS_KEY_TRAINING_FILE, path);
        loadFileContent(path);
    };

    const saveFile = useCallback(async (training: string, test: string) => {
        if (!selectedFile || loadingRef.current) return;
        setSaveStatus("saving");
        try {
            const content = buildFileContent(training, test);
            await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(selectedFile)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });
            setSaveStatus("saved");
        } catch { setSaveStatus("dirty"); }
    }, [selectedFile]);

    // Auto-save with debounce when either prompt changes
    const saveTimer = useRef<ReturnType<typeof setTimeout>>();
    const trainingRef = useRef(trainingPrompt);
    const testRef = useRef(testPrompt);
    trainingRef.current = trainingPrompt;
    testRef.current = testPrompt;

    const triggerAutoSave = useCallback(() => {
        setSaveStatus("dirty");
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            saveFile(trainingRef.current, testRef.current);
        }, 800);
    }, [saveFile]);

    const handleTrainingChange = useCallback((v: string) => {
        setTrainingPrompt(v);
        triggerAutoSave();
    }, [triggerAutoSave]);

    const handleTestChange = useCallback((v: string) => {
        setTestPrompt(v);
        triggerAutoSave();
    }, [triggerAutoSave]);

    // ── Load template and replace placeholders ──
    const loadTemplate = async (skillName: string, fullPath: string): Promise<string> => {
        const templatePath = `${workingDir || "."}/skills/training/_template.md`;
        try {
            const r = await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(templatePath)}`);
            if (r.ok) {
                const data = await r.json();
                if (data?.content) {
                    return data.content
                        .replace(/\{\{SKILL_NAME\}\}/g, skillName)
                        .replace(/\{\{PAAW_BASE\}\}/g, workingDir || ".")
                        .replace(/\{\{FILE_PATH\}\}/g, fullPath);
                }
            }
        } catch { /* fallback */ }
        // Fallback if template not found
        const base = workingDir || ".";
        return `# Training: ${skillName}\n\n## 系統環境（System Context）\n\n你是 PAAW Skill 鍛造專家。\n- **PAAW Base**: \`${base}\`\n- **Input-Prompt Skills**: \`${base}/skills/input-prompt/\`\n- **Physical Skills**: \`${base}/skills/physical-skill/\`\n- **本檔案實體路徑**: \`${fullPath}\`\n\n---\n\n## 訓練 Prompt\n\n\n\n## 測試 Prompt\n\n`;
    };

    // ── Create new training file ──
    const handleCreateFile = async () => {
        const name = newFileName.trim();
        if (!name) return;
        const fileName = name.endsWith(".md") ? name : `${name}.md`;
        const fullPath = `${workingDir || "."}/skills/training/${fileName}`;
        try {
            const content = await loadTemplate(name, fullPath);
            await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(fullPath)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });
            setShowNewFileDialog(false);
            setNewFileName("");
            loadTrainingFiles();
            handleSelectFile(fullPath);
        } catch { /* ignore */ }
    };

    // ── Terminal ref for sending prompts without restart ──
    const terminalRef = useRef<AgentConsoleHandle>(null);

    // ── Send to CLI ──
    const sendToTerminal = useCallback((prompt: string) => {
        if (!prompt.trim()) return;
        if (!chatStarted) {
            // First time: start terminal with initialPrompt
            setInitialPrompt(prompt);
            setChatStarted(true);
            setConsoleKey(prev => prev + 1);
        } else {
            // Already running: just send text to existing PTY
            terminalRef.current?.sendPrompt(prompt);
        }
    }, [chatStarted]);

    const handleTrain = () => {
        setSendingTrain(true);
        sendToTerminal(trainingPrompt);
        setTimeout(() => setSendingTrain(false), 300);
    };

    const handleTest = () => {
        setSendingTest(true);
        sendToTerminal(testPrompt);
        setTimeout(() => setSendingTest(false), 300);
    };

    return (
        <div className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: "#fafaf9" }}>
            {/* ── Header ── */}
            <div className="shrink-0 px-4 py-2 border-b flex items-center gap-3" style={{ borderColor: "#e7e5e4" }}>
                <div className="flex items-center gap-2">
                    <span className="text-lg">🧪</span>
                    <h2 className="text-sm font-bold text-stone-800">Skill Lab</h2>
                </div>

                {/* File selector + new */}
                <div className="flex items-center gap-1.5">
                    <select
                        value={selectedFile}
                        onChange={e => handleSelectFile(e.target.value)}
                        className="text-xs px-2 py-1 border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-200"
                        style={{ minWidth: 220 }}
                    >
                        <option value="">-- 選擇 Training File --</option>
                        {trainingFiles.map(f => (
                            <option key={f.path} value={f.path}>{f.name}</option>
                        ))}
                    </select>
                    <button
                        onClick={() => { setShowNewFileDialog(true); setNewFileName(""); }}
                        className="px-2 py-1 text-xs font-medium rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 transition-colors"
                        title="新增 Training File"
                    >
                        ＋New
                    </button>
                    {selectedFile && (
                        <span className="text-[10px] text-stone-400 max-w-[120px] truncate" title={selectedFile}>
                            {selectedFile.split(/[/\\]/).pop()}
                        </span>
                    )}
                    {saveStatus === "saving" && <span className="text-[10px] text-amber-500">💾</span>}
                    {saveStatus === "saved" && <span className="text-[10px] text-green-500">✓</span>}
                    {saveStatus === "dirty" && <span className="text-[10px] text-rose-500">●</span>}
                </div>

                {/* CLI selector */}
                <div className="flex items-center gap-1.5">
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

                {chatStarted && (
                    <button
                        onClick={() => { setChatStarted(false); setInitialPrompt(undefined); setConsoleKey(prev => prev + 1); }}
                        className="ml-auto px-2.5 py-1 text-[11px] font-medium rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50"
                    >
                        ✕ Reset Terminal
                    </button>
                )}
            </div>

            {/* ── New File Dialog ── */}
            {showNewFileDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowNewFileDialog(false)}>
                    <div className="bg-white rounded-xl shadow-2xl border border-stone-200 w-96 p-5" onClick={e => e.stopPropagation()}>
                        <h3 className="text-sm font-bold text-stone-800 mb-3">📄 新增 Training File</h3>
                        <p className="text-xs text-stone-500 mb-2">檔案會建立在 <code className="bg-stone-100 px-1 rounded">skills/training/</code> 目錄下</p>
                        <input
                            type="text"
                            value={newFileName}
                            onChange={e => setNewFileName(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") handleCreateFile(); }}
                            placeholder="檔案名稱，例：train-my-skill"
                            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 mb-3"
                            autoFocus
                        />
                        {!newFileName.endsWith(".md") && newFileName.trim() && (
                            <p className="text-[10px] text-stone-400 mb-2">→ {newFileName.trim()}.md</p>
                        )}
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowNewFileDialog(false)} className="px-3 py-1.5 text-xs rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">取消</button>
                            <button
                                onClick={handleCreateFile}
                                disabled={!newFileName.trim()}
                                className={cn("px-4 py-1.5 text-xs font-bold rounded-lg", newFileName.trim() ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-stone-200 text-stone-400")}
                            >
                                建立
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Body: 2-panel layout ── */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* Left: Prompt Editors (full width, stacked) */}
                <div className="flex flex-col border-r" style={{ width: "45%", borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
                    {!selectedFile ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
                            <span className="text-3xl">🧪</span>
                            <p className="text-stone-400 text-sm text-center">← 選擇或建立一個 Training File 開始</p>
                        </div>
                    ) : (
                        <>
                            <PromptEditor
                                label="訓練 Prompt"
                                emoji="🎓"
                                value={trainingPrompt}
                                onChange={handleTrainingChange}
                                placeholder={"輸入訓練 prompt，告訴 AI 怎麼產生/修改 skill...\n\n例：請根據以下規格鍛造一個完整的 Skill。\n注意 userInputs 格式要符合 YAML 規範。\n\nCtrl+Enter 快速送出"}
                                sendLabel="Train"
                                sendColor="#2563eb"
                                onSend={handleTrain}
                                sending={sendingTrain}
                            />
                            <div style={{ height: 1, backgroundColor: "#e7e5e4" }} />
                            <PromptEditor
                                label="測試 Prompt"
                                emoji="🧪"
                                value={testPrompt}
                                onChange={handleTestChange}
                                placeholder={"輸入測試 prompt，用簡單輸入驗證 skill...\n\n例：用這個 skill 分析 src/utils/ 的錯誤處理。\n\nCtrl+Enter 快速送出"}
                                sendLabel="Test"
                                sendColor="#059669"
                                onSend={handleTest}
                                sending={sendingTest}
                            />
                        </>
                    )}
                </div>

                {/* Right: Terminal */}
                <div className="flex flex-col flex-1 min-w-0" style={{ backgroundColor: "#1a1a2e" }}>
                    {!chatStarted ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
                            <span className="text-4xl">🧪</span>
                            <p className="text-stone-400 text-sm text-center">
                                寫好 prompt 後按 <strong>▶ Train</strong> 或 <strong>▶ Test</strong> 送出
                            </p>
                            <p className="text-stone-500 text-xs text-center">Ctrl+Enter 快速送出</p>
                        </div>
                    ) : (
                        <AgentConsole
                            ref={terminalRef}
                            key={`skilllab-${consoleKey}`}
                            cwd={workingDir || undefined}
                            initialPrompt={initialPrompt}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
