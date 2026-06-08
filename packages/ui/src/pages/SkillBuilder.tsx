import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import TerminalConsole, { TerminalConsoleHandle } from "../components/TerminalConsole";

// ── Types ──
interface InputField {
  id: string;
  label: string;
  description: string;
  placeholder: string;
  required: boolean;
  multiline: boolean;
}

interface SkillForm {
  id: string;
  name: string;
  version: string;
  description: string;
  runner: "prompt" | "data" | "api" | "script";
  inputs: InputField[];
  // Structured prompt fields (for normal users)
  purpose: string;         // Purpose — 這個 Skill 做什麼
  steps: string;           // Steps — AI 應該怎麼做
  outputFormat: string;    // Output — 輸出長什麼樣子
  guardrails: string;      // Guardrails — 安全限制
  validation: string;      // Validation — 怎麼確認結果正確
  // Raw prompt (for expert mode)
  systemPrompt: string;
  tags: string;
  visibility: "private" | "team" | "public";
}

interface TrainingFile {
  name: string;
  path: string;
}

// ── Constants ──
const API_BASE = "http://127.0.0.1:4097";

const EMPTY_FIELD: InputField = {
  id: "", label: "", description: "", placeholder: "",
  required: false, multiline: false,
};

const EMPTY_SKILL: SkillForm = {
  id: "", name: "", version: "1.0.0", description: "",
  runner: "prompt",
  inputs: [],
  purpose: "",
  steps: "",
  outputFormat: "",
  guardrails: "",
  validation: "",
  systemPrompt: "",
  tags: "",
  visibility: "private",
};

// ── Build structured prompt from fields ──
function buildPromptFromFields(form: SkillForm): string {
  const parts: string[] = [];
  if (form.purpose) parts.push(`## Purpose\n${form.purpose}`);
  if (form.inputs.length > 0) {
    parts.push("## Inputs\n" + form.inputs.map(inp =>
      `- **${inp.label}**${inp.required ? " (required)" : " (optional)"}: ${inp.description || inp.placeholder}`
    ).join("\n"));
  }
  if (form.steps) parts.push(`## Steps\n${form.steps}`);
  if (form.outputFormat) parts.push(`## Output\n${form.outputFormat}`);
  if (form.guardrails) parts.push(`## Guardrails\n${form.guardrails}`);
  if (form.validation) parts.push(`## Validation\n${form.validation}`);
  return parts.join("\n\n");
}

// ── Parse skill md ──
function parseSkillMd(content: string): SkillForm {
  const form = { ...EMPTY_SKILL };
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    form.systemPrompt = content.trim();
    return form;
  }

  const fm = fmMatch[1];
  const body = content.slice(fmMatch[0].length).trim();
  form.systemPrompt = body;

  // Parse frontmatter
  const lines = fm.split("\n");
  for (const line of lines) {
    const m = line.match(/^(\w+):\s*(.*)/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === "id") form.id = val.trim();
    else if (key === "name") form.name = val.trim();
    else if (key === "version") form.version = val.trim();
    else if (key === "description") form.description = val.trim();
    else if (key === "runner") form.runner = val.trim() as SkillForm["runner"];
    else if (key === "tags") form.tags = val.trim();
    else if (key === "visibility") form.visibility = val.trim() as SkillForm["visibility"];
  }

  // Parse userInputs
  const inputsMatch = fm.match(/userInputs:\s*\n((?:\s+- .+\n?)*)/);
  if (inputsMatch) {
    const inputBlocks = inputsMatch[1].split(/\n\s*-\s+id:/).filter(Boolean);
    for (const block of inputBlocks) {
      const field: InputField = { ...EMPTY_FIELD };
      const idM = block.match(/^(\S+)/);
      if (idM) field.id = idM[1];
      const labelM = block.match(/label:\s*(.+)/);
      if (labelM) field.label = labelM[1].trim();
      const descM = block.match(/description:\s*(.+)/);
      if (descM) field.description = descM[1].trim();
      const phM = block.match(/placeholder:\s*"([^"]*)"/);
      if (phM) field.placeholder = phM[1];
      const reqM = block.match(/required:\s*(true|false)/);
      if (reqM) field.required = reqM[1] === "true";
      const mlM = block.match(/multiline:\s*(true|false)/);
      if (mlM) field.multiline = mlM[1] === "true";
      if (field.id) form.inputs.push(field);
    }
  }

  // Try to parse structured sections from body
  const purposeM = body.match(/## Purpose\n([\s\S]*?)(?=\n## |\n*$)/);
  if (purposeM) form.purpose = purposeM[1].trim();

  const stepsM = body.match(/## Steps\n([\s\S]*?)(?=\n## |\n*$)/);
  if (stepsM) form.steps = stepsM[1].trim();

  const outputM = body.match(/## Output\n([\s\S]*?)(?=\n## |\n*$)/);
  if (outputM) form.outputFormat = outputM[1].trim();

  const guardM = body.match(/## Guardrails\n([\s\S]*?)(?=\n## |\n*$)/);
  if (guardM) form.guardrails = guardM[1].trim();

  const valM = body.match(/## Validation\n([\s\S]*?)(?=\n## |\n*$)/);
  if (valM) form.validation = valM[1].trim();

  return form;
}

// ── Build full markdown from form ──
function buildSkillMd(form: SkillForm, expertMode: boolean): string {
  const promptBody = expertMode ? form.systemPrompt : buildPromptFromFields(form);

  const lines: string[] = ["---"];
  lines.push(`id: ${form.id || "untitled"}`);
  lines.push(`name: ${form.name || "Untitled"}`);
  lines.push(`version: ${form.version || "1.0.0"}`);
  if (form.description) lines.push(`description: ${form.description}`);
  lines.push(`runner: ${form.runner}`);
  if (form.visibility && form.visibility !== "private") lines.push(`visibility: ${form.visibility}`);
  if (form.tags) lines.push(`tags: ${form.tags}`);

  if (form.inputs.length > 0) {
    lines.push("userInputs:");
    for (const inp of form.inputs) {
      lines.push(`  - id: ${inp.id || "field"}`);
      lines.push(`    label: ${inp.label || inp.id}`);
      if (inp.description) lines.push(`    description: ${inp.description}`);
      if (inp.placeholder) lines.push(`    placeholder: "${inp.placeholder}"`);
      lines.push(`    required: ${inp.required}`);
      lines.push(`    multiline: ${inp.multiline}`);
    }
  }

  lines.push("---");
  lines.push("");
  if (promptBody) lines.push(promptBody);
  return lines.join("\n");
}

// ── Step Card ──
function StepCard({ number, icon, title, hint, children, required }: {
  number: number; icon: string; title: string; hint?: string;
  children: React.ReactNode; required?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-3 bg-white hover:bg-stone-50 transition-colors text-left"
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-stone-800 text-white text-xs font-bold">{number}</span>
        <span className="text-base">{icon}</span>
        <div className="flex-1">
          <span className="text-sm font-bold text-stone-800">{title}</span>
          {hint && <span className="ml-2 text-xs text-stone-400">{hint}</span>}
        </div>
        {required && <span className="text-[10px] text-rose-400 font-medium">必填</span>}
        <span className="text-stone-300 text-xs">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-5 py-4 border-t border-stone-100 bg-stone-50/30 space-y-3">{children}</div>}
    </div>
  );
}

// ── Input Field Card ──
function InputFieldCard({ field, index, onUpdate, onRemove }: {
  field: InputField; index: number;
  onUpdate: (idx: number, patch: Partial<InputField>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3 relative group">
      <button
        onClick={() => onRemove(index)}
        className="absolute top-3 right-3 text-stone-300 hover:text-rose-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
      >✕</button>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">欄位名稱 *</label>
          <input type="text" value={field.label}
            onChange={e => {
              const label = e.target.value;
              onUpdate(index, {
                label,
                id: label.replace(/\s+/g, "_").toLowerCase().replace(/[^a-z0-9_]/g, "") || field.id,
              });
            }}
            placeholder="例：錯誤訊息"
            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">輸入提示</label>
          <input type="text" value={field.placeholder}
            onChange={e => onUpdate(index, { placeholder: e.target.value })}
            placeholder="例：貼上你看到的錯誤訊息..."
            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-600 mb-1">說明</label>
        <input type="text" value={field.description}
          onChange={e => onUpdate(index, { description: e.target.value })}
          placeholder="這個欄位收集什麼資訊？"
          className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </div>

      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer">
          <input type="checkbox" checked={field.required}
            onChange={e => onUpdate(index, { required: e.target.checked })}
            className="rounded border-stone-300" />
          必填
        </label>
        <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer">
          <input type="checkbox" checked={field.multiline}
            onChange={e => onUpdate(index, { multiline: e.target.checked })}
            className="rounded border-stone-300" />
          多行輸入
        </label>
      </div>
    </div>
  );
}

// ── Main SkillBuilder Page ──
export default function SkillBuilder() {
  const { t } = useI18n();
  const [form, setForm] = useState<SkillForm>({ ...EMPTY_SKILL });
  const [files, setFiles] = useState<TrainingFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty">("saved");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [expertMode, setExpertMode] = useState(false);

  // Terminal
  const [cli, setCli] = useState<"qwen" | "claude" | "opencode">("qwen");
  const [consoleKey, setConsoleKey] = useState(0);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
  const [chatStarted, setChatStarted] = useState(false);
  const [sending, setSending] = useState(false);
  const terminalRef = useRef<TerminalConsoleHandle>(null);
  const loadingRef = useRef(false);

  // ── Data loading ──
  const loadFiles = useCallback(() => {
    fetch(`${API_BASE}/api/skill-lab/build-files`)
      .then(r => r.ok ? r.json() : [])
      .then((f: TrainingFile[]) => setFiles(f))
      .catch(() => {});
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    fetch(`${API_BASE}/api/paaw-root`)
      .then(r => r.ok ? r.json() : {})
      .then((d: { paawRoot?: string }) => { if (d.paawRoot) setWorkingDir(d.paawRoot); })
      .catch(() => {});
  }, []);

  // ── File operations ──
  const loadFile = useCallback((path: string) => {
    loadingRef.current = true;
    fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(path)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { content?: string } | null) => {
        const parsed = parseSkillMd(data?.content || "");
        setForm(parsed);
        setSaveStatus("saved");
      })
      .catch(() => { setForm({ ...EMPTY_SKILL }); })
      .finally(() => { loadingRef.current = false; });
  }, []);

  const saveFile = useCallback(async (f: SkillForm) => {
    if (!selectedPath || loadingRef.current) return;
    setSaveStatus("saving");
    try {
      const content = buildSkillMd(f, expertMode);
      await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(selectedPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setSaveStatus("saved");
    } catch { setSaveStatus("dirty"); }
  }, [selectedPath, expertMode]);

  // Auto-save
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const formRef = useRef(form);
  formRef.current = form;

  const triggerSave = useCallback(() => {
    setSaveStatus("dirty");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveFile(formRef.current);
    }, 800);
  }, [saveFile]);

  const update = <K extends keyof SkillForm>(key: K, value: SkillForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    triggerSave();
  };

  // Input field CRUD
  const addInput = () => {
    const n = form.inputs.length + 1;
    const field: InputField = { ...EMPTY_FIELD, id: `field_${n}`, label: `欄位 ${n}` };
    update("inputs", [...form.inputs, field]);
  };

  const removeInput = (idx: number) => {
    update("inputs", form.inputs.filter((_, i) => i !== idx));
  };

  const updateInput = (idx: number, patch: Partial<InputField>) => {
    const next = [...form.inputs];
    next[idx] = { ...next[idx], ...patch };
    update("inputs", next);
  };

  // Select / New file
  const handleSelectFile = (path: string) => {
    setSelectedPath(path);
    loadFile(path);
  };

  const handleCreate = async () => {
    const raw = newFileName.trim();
    if (!raw) return;
    const slug = raw.replace(/\.md$/, "").replace(/\s+/g, "-").toLowerCase().replace(/^build-/, "");
    const fileName = raw.endsWith(".md") ? raw : `build-${slug}.md`;
    const fullPath = `${workingDir || "."}/data/skills/building/${fileName}`;

    const newForm: SkillForm = {
      ...EMPTY_SKILL,
      id: slug,
      name: raw.replace(/\.md$/, ""),
    };
    const content = buildSkillMd(newForm, false);

    await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(fullPath)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    setShowNewDialog(false);
    setNewFileName("");
    loadFiles();
    setSelectedPath(fullPath);
    setForm(newForm);
    setSaveStatus("saved");
  };

  // Build
  const handleBuild = () => {
    setSending(true);
    const prompt = buildSkillMd(form, expertMode);
    if (!chatStarted) {
      setInitialPrompt(prompt);
      setChatStarted(true);
      setConsoleKey(prev => prev + 1);
    } else {
      terminalRef.current?.sendPrompt(prompt);
    }
    setTimeout(() => setSending(false), 300);
  };

  // Check if skill is buildable
  const canBuild = form.purpose.trim() || (expertMode && form.systemPrompt.trim());

  // ── Render ──
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: "#fafaf9" }}>
      {/* ── Header ── */}
      <div className="shrink-0 px-5 py-2.5 border-b flex items-center gap-3 bg-white" style={{ borderColor: "#e7e5e4" }}>
        <span className="text-lg">🔨</span>
        <h2 className="text-sm font-bold text-stone-800">Skill Builder</h2>

        <div className="flex items-center gap-1.5">
          <select value={selectedPath} onChange={e => handleSelectFile(e.target.value)}
            className="text-xs px-2 py-1.5 border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-200"
            style={{ minWidth: 200 }}>
            <option value="">-- {t("common.select", "選擇")} Skill --</option>
            {files.map(f => <option key={f.path} value={f.path}>{f.name}</option>)}
          </select>
          <button onClick={() => { setShowNewDialog(true); setNewFileName(""); }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-stone-800 text-white hover:bg-stone-700 transition-colors">
            ＋ Build New Skill
          </button>
          {saveStatus === "saving" && <span className="text-[10px] text-amber-500">💾</span>}
          {saveStatus === "saved" && selectedPath && <span className="text-[10px] text-green-500">✓</span>}
          {saveStatus === "dirty" && <span className="text-[10px] text-rose-500">●</span>}
        </div>

        {/* Expert toggle */}
        <div className="flex items-center gap-2 ml-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <div className={cn("relative w-8 h-4 rounded-full transition-colors", expertMode ? "bg-blue-500" : "bg-stone-300")}
              onClick={() => setExpertMode(!expertMode)}>
              <div className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform", expertMode ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <span className="text-[11px] text-stone-500">{expertMode ? "Expert" : "Simple"}</span>
          </label>
        </div>

        {/* CLI + Build */}
        <select value={cli} onChange={e => setCli(e.target.value as typeof cli)}
          className="text-xs px-2 py-1.5 border border-stone-200 rounded-lg bg-white ml-1">
          <option value="qwen">Qwen</option>
          <option value="claude">Claude Code</option>
          <option value="opencode">OpenCode</option>
        </select>

        <button onClick={handleBuild} disabled={!canBuild}
          className={cn("ml-auto px-5 py-1.5 text-sm font-bold rounded-lg transition-colors",
            canBuild ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm" : "bg-stone-200 text-stone-400 cursor-not-allowed"
          )}>
          🔨 Build
        </button>

        {chatStarted && (
          <button onClick={() => { setChatStarted(false); setInitialPrompt(undefined); setConsoleKey(p => p + 1); }}
            className="px-2 py-1 text-[11px] rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50">✕</button>
        )}
      </div>

      {/* ── New File Dialog ── */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowNewDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-96 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-stone-800 mb-1">📄 建立新的 Skill</h3>
            <p className="text-xs text-stone-500 mb-4">給 Skill 一個名字，檔案會建立在 <code className="bg-stone-100 px-1 rounded">skills/building/</code></p>
            <input type="text" value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
              placeholder="例：log-analyzer、weekly-report"
              className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 mb-2"
              autoFocus />
            {newFileName.trim() && (
              <p className="text-[11px] text-stone-400 mb-4">→ build-{newFileName.trim().replace(/\s+/g, "-").toLowerCase()}.md</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowNewDialog(false)} className="px-4 py-2 text-sm rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50">{t("common.cancel")}</button>
              <button onClick={handleCreate} disabled={!newFileName.trim()}
                className={cn("px-5 py-2 text-sm font-bold rounded-xl", newFileName.trim() ? "bg-stone-800 text-white hover:bg-stone-700" : "bg-stone-200 text-stone-400")}>
                {t("common.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Builder Form */}
        <div className="flex flex-col border-r overflow-y-auto" style={{ width: "50%", borderColor: "#e7e5e4", backgroundColor: "#fafaf9" }}>
          {!selectedPath ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
              <span className="text-5xl">🔨</span>
              <div className="text-center">
                <p className="text-stone-600 text-base font-medium">建立一個新的 AI Skill</p>
                <p className="text-stone-400 text-sm mt-1">點 <strong>＋ Build New Skill</strong> 開始</p>
              </div>
            </div>
          ) : expertMode ? (
            /* ── Expert Mode: raw markdown ── */
            <div className="p-4">
              <div className="border border-stone-200 rounded-2xl overflow-hidden bg-white">
                <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50">
                  <span className="text-xs font-bold text-stone-600">Markdown 原始碼</span>
                </div>
                <textarea value={form.systemPrompt}
                  onChange={e => update("systemPrompt", e.target.value)}
                  placeholder={"輸入完整的 skill 定義...\n\n---\nid: my-skill\nname: My Skill\n---\n\n## 目的\n..."}
                  className="w-full px-4 py-3 text-sm font-mono border-0 resize-none focus:outline-none"
                  style={{ minHeight: "calc(100vh - 200px)", lineHeight: 1.7 }}
                  spellCheck={false} />
              </div>
            </div>
          ) : (
            /* ── Simple Mode: step-by-step ── */
            <div className="p-5 space-y-4">

              {/* Step 1: Purpose */}
              <StepCard number={1} icon="🎯" title="Purpose" hint="這個 Skill 做什麼？" required>
                <textarea value={form.purpose}
                  onChange={e => update("purpose", e.target.value)}
                  placeholder={"例：根據錯誤訊息和 log，分析問題的根因並產生報告\n\n例：將會議錄音轉成結構化的會議紀錄\n\n例：每週自動整理專案進度，寄出摘要信"}
                  rows={3}
                  className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                  style={{ lineHeight: 1.6 }} />
                <p className="text-[11px] text-stone-400"> 💡 想像你在跟一個新同事解釋這個任務</p>
              </StepCard>

              {/* Step 2: Inputs */}
              <StepCard number={2} icon="📝" title="Inputs" hint="需要使用者提供什麼？">
                {form.inputs.length === 0 && (
                  <div className="text-center py-4">
                    <p className="text-xs text-stone-400 mb-3">這個 Skill 需要使用者輸入什麼資訊？</p>
                    <button onClick={addInput}
                      className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors">
                      ＋ 新增輸入欄位
                    </button>
                  </div>
                )}
                <div className="space-y-3">
                  {form.inputs.map((inp, idx) => (
                    <InputFieldCard key={idx} field={inp} index={idx}
                      onUpdate={updateInput} onRemove={removeInput} />
                  ))}
                </div>
                {form.inputs.length > 0 && (
                  <button onClick={addInput}
                    className="w-full py-2.5 text-sm font-medium text-blue-600 border border-dashed border-blue-200 rounded-xl hover:bg-blue-50 transition-colors">
                    ＋ 新增欄位
                  </button>
                )}
                <p className="text-[11px] text-stone-400"> 💡 如果不需要使用者輸入，可以跳過這步</p>
              </StepCard>

              {/* Step 3: Steps */}
              <StepCard number={3} icon="🧠" title="Steps" hint="AI 應該怎麼做？一步一步寫清楚" required>
                <textarea value={form.steps}
                  onChange={e => update("steps", e.target.value)}
                  placeholder={"寫下 AI 應該遵循的步驟：\n\n1. 讀取使用者提供的錯誤訊息\n2. 分析可能的錯誤類型（網路、權限、資料格式...）\n3. 根據系統架構圖，追蹤相關的服務鏈\n4. 比對近期的 log，找出時間相關的事件\n5. 綜合以上資訊，產生根因分析報告"}
                  rows={8}
                  className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                  style={{ lineHeight: 1.6 }} />
                <p className="text-[11px] text-stone-400"> 💡 像寫 SOP 一樣，步驟越清楚，AI 表現越好</p>
              </StepCard>

              {/* Step 4: Output */}
              <StepCard number={4} icon="📋" title="Output" hint="輸出長什麼樣子？給個範例">
                <textarea value={form.outputFormat}
                  onChange={e => update("outputFormat", e.target.value)}
                  placeholder={"描述你期望的輸出格式：\n\n## 根因分析報告\n\n### 問題摘要\n（一句話描述問題）\n\n### 影響範圍\n- 受影響服務：...\n- 使用者影響：...\n\n### 根因\n- 直接原因：...\n- 根本原因：...\n\n### 建議\n1. ...\n2. ..."}
                  rows={6}
                  className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                  style={{ lineHeight: 1.6 }} />
                <p className="text-[11px] text-stone-400"> 💡 給一個範例，AI 就知道你想要的格式</p>
              </StepCard>

              {/* Step 5: Guardrails */}
              <StepCard number={5} icon="🛡️" title="Guardrails" hint="安全限制與注意事項">
                <textarea value={form.guardrails}
                  onChange={e => update("guardrails", e.target.value)}
                  placeholder={"什麼不能做？什麼要特別小心？\n\n例：\n- 只分析最近 7 天的 log\n- 不要猜測沒有證據支持的原因\n- 如果資訊不足，明確說明需要什麼額外資訊\n- 不要刪除或修改任何檔案\n- 輸出語言跟使用者輸入一致\n- 超過 1000 筆資料時只取樣分析，並說明"}
                  rows={5}
                  className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                  style={{ lineHeight: 1.6 }} />
                <p className="text-[11px] text-stone-400"> 💡 定義邊界，防止 AI 做出不預期的事</p>
              </StepCard>

              {/* Step 6: Validation */}
              <StepCard number={6} icon="✅" title="Validation" hint="怎麼確認結果是正確的？">
                <textarea value={form.validation}
                  onChange={e => update("validation", e.target.value)}
                  placeholder={"怎麼驗證 AI 的輸出品質？\n\n例：\n- 報告必須包含「根因」和「建議」兩個區塊\n- 所有提到的數據都要有出處\n- 如果找不到明確根因，必須標注為「待確認」\n- 執行時間不應超過 30 秒\n- 輸出不能是空的"}
                  rows={5}
                  className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                  style={{ lineHeight: 1.6 }} />
                <p className="text-[11px] text-stone-400"> 💡 清楚的驗證條件 = 可信賴的結果</p>
              </StepCard>

              {/* Preview */}
              <div className="border border-stone-200 rounded-2xl overflow-hidden bg-white">
                <button className="w-full flex items-center gap-2 px-5 py-3 hover:bg-stone-50 transition-colors text-left"
                  onClick={() => {}}>
                  <span>📄</span>
                  <span className="text-sm font-bold text-stone-700">預覽產出的 Markdown</span>
                </button>
                <details className="px-5 pb-4">
                  <summary className="sr-only">預覽</summary>
                  <pre className="text-xs font-mono text-stone-500 bg-stone-50 p-4 rounded-xl overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto border border-stone-100">
                    {buildSkillMd(form, false)}
                  </pre>
                </details>
              </div>
            </div>
          )}
        </div>

        {/* Right: Terminal */}
        <div className="flex flex-col flex-1 min-w-0" style={{ backgroundColor: "#1a1a2e" }}>
          {!chatStarted ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
              <span className="text-5xl opacity-30">🔨</span>
              <div className="text-center">
                <p className="text-stone-400 text-sm">
                  填好左邊的表單，按 <strong className="text-white">🔨 Build</strong>
                </p>
                <p className="text-stone-500 text-xs mt-2">AI 會根據你的定義生成完整 skill</p>
              </div>
            </div>
          ) : (
            <TerminalConsole
              ref={terminalRef}
              key={`builder-${consoleKey}`}
              cwd={workingDir || undefined}
              cli={cli}
              approvalMode="yolo"
              initialPrompt={initialPrompt}
            />
          )}
        </div>
      </div>
    </div>
  );
}
