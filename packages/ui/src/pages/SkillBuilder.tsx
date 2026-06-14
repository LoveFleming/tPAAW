import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import { useTheme } from "../theme";
import TerminalConsole, { TerminalConsoleHandle } from "../components/TerminalConsole";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Types ──
interface InputField {
  id: string; label: string; description: string; placeholder: string;
  required: boolean; multiline: boolean;
}

interface SkillForm {
  id: string; name: string; version: string; description: string;
  runner: "prompt" | "data" | "api" | "script";
  inputs: InputField[];
  purpose: string; steps: string; outputFormat: string;
  guardrails: string; validation: string; systemPrompt: string;
  tags: string; visibility: "private" | "team" | "public";
}

interface TrainingFile { name: string; path: string; }
interface OutputFile { name: string; path: string; size: number; type: string; ext: string; }

// ── Constants ──
const API_BASE = "http://127.0.0.1:4097";

const EMPTY_FIELD: InputField = { id: "", label: "", description: "", placeholder: "", required: false, multiline: false };
const DEFAULT_OUTPUT_FIELD: InputField = { id: "output_path", label: "輸出路徑", description: "Skill 執行結果的儲存路徑", placeholder: "例：output/report.html", required: true, multiline: false };
const EMPTY_SKILL: SkillForm = { id: "", name: "", version: "1.0.0", description: "", runner: "prompt", inputs: [DEFAULT_OUTPUT_FIELD], purpose: "", steps: "", outputFormat: "", guardrails: "", validation: "", systemPrompt: "", tags: "", visibility: "private" };

// ── Helpers ──
function buildPromptFromFields(form: SkillForm): string {
  const parts: string[] = [];
  if (form.purpose) parts.push(`## Purpose\n${form.purpose}`);
  if (form.inputs.length > 0) {
    parts.push("## Inputs\n" + form.inputs.map(inp => `- **${inp.label}**${inp.required ? " (required)" : " (optional)"}: ${inp.description || inp.placeholder}`).join("\n"));
  }
  if (form.steps) parts.push(`## Steps\n${form.steps}`);
  if (form.outputFormat) parts.push(`## Output\n${form.outputFormat}`);
  if (form.guardrails) parts.push(`## Guardrails
${form.guardrails}`);
  if (form.examples) parts.push(`## Examples
${form.examples}`);
  if (form.validation) parts.push(`## Validation
${form.validation}`);
  if (form.notes) parts.push(`## Notes
${form.notes}`);
  return parts.join("\n\n");
}

function parseSkillMd(content: string): SkillForm {
  const form = { ...EMPTY_SKILL };
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) { form.systemPrompt = content.trim(); return form; }
  const fm = fmMatch[1];
  const body = content.slice(fmMatch[0].length).trim();
  form.systemPrompt = body;
  // Reset inputs before parsing from file — avoid duplicates from EMPTY_SKILL default
  form.inputs = [];
  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === "id") form.id = val.trim();
    else if (key === "name") form.name = val.trim();
    else if (key === "version") form.version = val.trim();
    else if (key === "description") form.description = val.trim();
    else if (key === "runner") form.runner = val.trim() as SkillForm["runner"];
    else if (key === "tags") form.tags = val.trim();
    else if (key === "examples") form.examples = val.trim();
    else if (key === "notes") form.notes = val.trim();
    else if (key === "visibility") form.visibility = val.trim() as SkillForm["visibility"];
  }
  const inputsMatch = fm.match(/userInputs:\s*\n([\s\S]*?)(?=\n\S|\s*$)/);
  if (inputsMatch) {
    const blocks = inputsMatch[1].split(/\s*-\s+id:\s*/).filter(Boolean);
    for (const block of blocks) {
      const field: InputField = { ...EMPTY_FIELD };
      const idM = block.match(/^(\S+)/); if (idM) field.id = idM[1].trim();
      const labelM = block.match(/label:\s*(.+)/); if (labelM) field.label = labelM[1].trim();
      const descM = block.match(/description:\s*(.+)/); if (descM) field.description = descM[1].trim();
      const phM = block.match(/placeholder:\s*"([^"]*)"/); if (phM) field.placeholder = phM[1];
      const reqM = block.match(/required:\s*(true|false)/); if (reqM) field.required = reqM[1] === "true";
      const mlM = block.match(/multiline:\s*(true|false)/); if (mlM) field.multiline = mlM[1] === "true";
      if (field.id) form.inputs.push(field);
    }
  }
  // ── Parse body sections line-by-line (only known headings, not any ##) ──
  const KNOWN_SECTIONS = ["Purpose", "Steps", "Output", "Examples", "Guardrails", "Validation", "Notes"];
  const SECTION_SET = new Set(KNOWN_SECTIONS);
  const bodyLines = body.split("\n");
  let currentSection: string | null = null;
  let sectionBuffer: string[] = [];
  const sections = new Map<string, string>();

  const flushSection = () => {
    if (currentSection) sections.set(currentSection, sectionBuffer.join("\n").trim());
    sectionBuffer = [];
  };

  for (const line of bodyLines) {
    const h = line.match(/^## (.+)$/);
    if (h && SECTION_SET.has(h[1].trim())) {
      flushSection();
      currentSection = h[1].trim();
    } else if (currentSection) {
      sectionBuffer.push(line);
    }
  }
  flushSection();

  form.purpose = sections.get("Purpose") || "";
  form.steps = sections.get("Steps") || "";
  form.outputFormat = sections.get("Output") || "";
  form.examples = sections.get("Examples") || "";
  form.guardrails = sections.get("Guardrails") || "";
  form.validation = sections.get("Validation") || "";
  form.notes = sections.get("Notes") || "";
  return form;
}

function buildSkillMd(form: SkillForm): string {
  const promptBody = buildPromptFromFields(form);
  const lines: string[] = ["---"];
  lines.push(`id: ${form.id || "untitled"}`);
  lines.push(`name: ${form.name || "Untitled"}`);
  if (form.description) lines.push(`description: ${form.description}`);
  if (form.visibility && form.visibility !== "private") lines.push(`visibility: ${form.visibility}`);
  if (form.tags) lines.push(`tags: ${form.tags}`);
  if (form.examples) lines.push(`examples: ${form.examples}`);
  if (form.notes) lines.push(`notes: ${form.notes}`);
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
  lines.push("---", "");
  if (promptBody) lines.push(promptBody);
  return lines.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function typeIcon(type: string): string {
  switch (type) {
    case "json": return "🔢";
    case "html": return "🌐";
    case "markdown": return "📝";
    case "image": return "🖼️";
    case "csv": return "📊";
    case "yaml": return "⚙️";
    default: return "📄";
  }
}

// ── Step Card ──
function StepCard({ number, icon, title, hint, children, required, accent, accentLight, accentBorder }: {
  number: number; icon: string; title: string; hint?: string;
  children: React.ReactNode; required?: boolean;
  accent: string; accentLight: string; accentBorder: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border rounded-2xl overflow-hidden shadow-sm" style={{ borderColor: accentBorder + "40" }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-5 py-3 bg-white hover:bg-stone-50/80 transition-colors text-left">
        <span className="flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold" style={{ background: accent }}>{number}</span>
        <span className="text-base">{icon}</span>
        <div className="flex-1">
          <span className="text-sm font-bold text-stone-800">{title}</span>
          {hint && <span className="ml-2 text-xs text-stone-400">{hint}</span>}
        </div>
        {required && <span className="text-[10px] text-rose-400 font-medium">必填</span>}
        <span className="text-stone-300 text-xs">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-5 py-4 border-t space-y-3" style={{ borderColor: accentBorder + "20", backgroundColor: accentLight + "30" }}>{children}</div>}
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
      <button onClick={() => onRemove(index)} className="absolute top-3 right-3 text-stone-300 hover:text-rose-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">欄位名稱 *</label>
          <input type="text" value={field.label} onChange={e => { const label = e.target.value; onUpdate(index, { label, id: label.replace(/\s+/g, "_").toLowerCase().replace(/[^a-z0-9_]/g, "") || field.id }); }} placeholder="例：錯誤訊息" className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">輸入提示</label>
          <input type="text" value={field.placeholder} onChange={e => onUpdate(index, { placeholder: e.target.value })} placeholder="例：貼上你看到的錯誤訊息..." className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-stone-600 mb-1">說明</label>
        <input type="text" value={field.description} onChange={e => onUpdate(index, { description: e.target.value })} placeholder="這個欄位收集什麼資訊？" className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer"><input type="checkbox" checked={field.required} onChange={e => onUpdate(index, { required: e.target.checked })} className="rounded border-stone-300" /> 必填</label>
        <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer"><input type="checkbox" checked={field.multiline} onChange={e => onUpdate(index, { multiline: e.target.checked })} className="rounded border-stone-300" /> 多行輸入</label>
      </div>
    </div>
  );
}

// ── Content Viewer (right side, dark bg) ──
function ContentViewer({ file, content, accent }: { file: OutputFile; content: string; accent: string }) {
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");
  // Reset mode when file changes
  useEffect(() => { setMode("rendered"); }, [file.path]);

  if (file.type === "image") {
    return (
      <div className="flex items-center justify-center p-4">
        <img src={`data:image/${file.ext === "svg" ? "svg+xml" : file.ext};base64,${btoa(content)}`} alt={file.name} className="max-w-full max-h-[500px] rounded border border-stone-700" />
      </div>
    );
  }

  const showToggle = ["html", "json", "markdown", "csv"].includes(file.type);

  return (
    <div className="flex flex-col h-full">
      {showToggle && (
        <div className="shrink-0 px-4 py-1.5 border-b border-stone-700 flex items-center gap-2">
          <span className="text-[10px] text-stone-500">{typeIcon(file.type)} {file.type.toUpperCase()}</span>
          <div className="flex-1" />
          <button onClick={() => setMode("rendered")} className={cn("px-2 py-0.5 text-[10px] rounded transition-colors", mode === "rendered" ? "text-white" : "text-stone-400 border border-stone-600 hover:bg-stone-700")} style={mode === "rendered" ? { background: accent } : {}}>Rendered</button>
          <button onClick={() => setMode("raw")} className={cn("px-2 py-0.5 text-[10px] rounded transition-colors", mode === "raw" ? "text-white" : "text-stone-400 border border-stone-600 hover:bg-stone-700")} style={mode === "raw" ? { background: accent } : {}}>Raw</button>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {mode === "raw" ? (
          <pre className="text-xs font-mono text-stone-300 whitespace-pre-wrap break-words p-4" style={{ lineHeight: 1.6 }}>{content}</pre>
        ) : file.type === "html" ? (
          <iframe srcDoc={content} className="w-full border-0" style={{ minHeight: 400 }} sandbox="allow-scripts" title={file.name} />
        ) : file.type === "json" ? (
          <pre className="text-xs font-mono text-stone-300 whitespace-pre-wrap p-4" style={{ lineHeight: 1.6 }}>{(() => { try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; } })()}</pre>
        ) : file.type === "markdown" ? (
          <div className="prose prose-invert max-w-none text-sm p-4"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
        ) : file.type === "csv" ? (
          <div className="overflow-auto p-4">
            <table className="text-xs border-collapse">
              <tbody>{content.trim().split("\n").map((r, i) => (
                <tr key={i} className={i === 0 ? "font-bold" : "text-stone-300"} style={i === 0 ? { color: accent } : {}}>
                  {r.split(",").map((cell, j) => <td key={j} className="px-3 py-1 border border-stone-700">{cell.trim()}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <pre className="text-xs font-mono text-stone-300 whitespace-pre-wrap break-words p-4" style={{ lineHeight: 1.6 }}>{content}</pre>
        )}
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main SkillBuilder Page
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function SkillBuilder() {
  const { t } = useI18n();
  const { info: theme } = useTheme();

  const [form, setForm] = useState<SkillForm>({ ...EMPTY_SKILL });
  const [files, setFiles] = useState<TrainingFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty">("saved");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [workingDir, setWorkingDir] = useState("");

  // Builder CLI (interactive)
  const [cli, setCli] = useState<"qwen" | "claude" | "opencode">("qwen");
  const [consoleKey, setConsoleKey] = useState(0);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
  const [chatStarted, setChatStarted] = useState(false);
  const terminalRef = useRef<TerminalConsoleHandle>(null);
  const loadingRef = useRef(false);

  // Skill creator
  const [skillCreatorContent, setSkillCreatorContent] = useState("");
  const [skillConfig, setSkillConfig] = useState({ testTimeout: 600, maxToolCalls: 50 });

  // ── Publish state ──
  const [publishStatus, setPublishStatus] = useState<"" | "publishing" | "done" | "error">("");

  // Test state
  const [testInputs, setTestInputs] = useState<Record<string, string>>({});
  const [testRunning, setTestRunning] = useState(false);
  const [testElapsed, setTestElapsed] = useState(0);
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<OutputFile | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [testError, setTestError] = useState<string>("");

  // Tabs
  const [tab, setTab] = useState<"builder" | "test">("builder");

  // Theme shortcuts
  const bg = theme.accentBg;
  const border = theme.accentBorder;
  const accent = theme.accent;
  const accentHover = theme.accentHover;
  const accentText = theme.accentText;

  // ── Data loading ──
  const loadFiles = useCallback(() => {
    fetch(`${API_BASE}/api/skill-lab/build-files`).then(r => r.ok ? r.json() : []).then((f: TrainingFile[]) => setFiles(f)).catch(() => {});
  }, []);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    fetch(`${API_BASE}/api/paaw/skill-config`).then(r => r.json()).then(data => { if (data) setSkillConfig({ testTimeout: data.testTimeout || 600, maxToolCalls: data.maxToolCalls || 50 }); }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/paaw-root`).then(r => r.ok ? r.json() : {}).then((d: { paawRoot?: string }) => { if (d.paawRoot) setWorkingDir(d.paawRoot); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!workingDir) return;
    fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(`${workingDir}/data/skills/physical-skill/skill-creator/SKILL.md`)}`)
      .then(r => r.ok ? r.json() : null).then((data) => { if (data?.content) setSkillCreatorContent(data.content); }).catch(() => {});
  }, [workingDir]);

  // ── File operations ──
  const loadFile = useCallback((path: string) => {
    loadingRef.current = true;
    fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(path)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { content?: string } | null) => {
        const parsed = parseSkillMd(data?.content || "");
        setForm(parsed);
        const inputs: Record<string, string> = {};
        parsed.inputs.forEach(inp => { inputs[inp.id] = ""; });
        setTestInputs(inputs);
        setSaveStatus("saved");
      })
      .catch(() => { setForm({ ...EMPTY_SKILL }); })
      .finally(() => { loadingRef.current = false; });
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const formRef = useRef(form); formRef.current = form;
  const selectedPathRef = useRef(selectedPath); selectedPathRef.current = selectedPath;

  const triggerSave = useCallback(() => {
    setSaveStatus("dirty");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const currentForm = formRef.current;
      const currentPath = selectedPathRef.current;
      if (!currentPath || loadingRef.current) return;
      const content = buildSkillMd(currentForm);
      setSaveStatus("saving");
      fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(currentPath)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
      }).then(r => { if (r.ok) setSaveStatus("saved"); else setSaveStatus("dirty"); }).catch(() => setSaveStatus("dirty"));
    }, 600);
  }, []);

  const update = <K extends keyof SkillForm>(key: K, value: SkillForm[K]) => { setForm(prev => ({ ...prev, [key]: value })); triggerSave(); };
  const addInput = () => { const n = form.inputs.length + 1; update("inputs", [...form.inputs, { ...EMPTY_FIELD, id: `field_${n}`, label: `欄位 ${n}` }]); };
  const removeInput = (idx: number) => update("inputs", form.inputs.filter((_, i) => i !== idx));
  const updateInput = (idx: number, patch: Partial<InputField>) => { const next = [...form.inputs]; next[idx] = { ...next[idx], ...patch }; update("inputs", next); };

  const handleSelectFile = (path: string) => { setSelectedPath(path); loadFile(path); setTab("builder"); };

  const handleCreate = async () => {
    const raw = newFileName.trim(); if (!raw) return;
    const slug = raw.replace(/\.md$/, "").replace(/\s+/g, "-").toLowerCase().replace(/^build-/, "");
    const fileName = raw.endsWith(".md") ? raw : `build-${slug}.md`;
    const fullPath = `${workingDir || "."}/data/skills/building/${fileName}`;
    const newForm: SkillForm = { ...EMPTY_SKILL, id: slug, name: raw.replace(/\.md$/, "") };
    await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(fullPath)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: buildSkillMd(newForm) }) });
    setShowNewDialog(false); setNewFileName(""); loadFiles(); setSelectedPath(fullPath); setForm(newForm);
    const initInputs: Record<string, string> = {};
    newForm.inputs.forEach(inp => { initInputs[inp.id] = inp.id === "output_path" ? "" : ""; });
    setTestInputs(initInputs);
    setSaveStatus("saved"); setTab("builder");
  };

  // ── Build: interactive CLI ──
  const handleBuild = async () => {
    const skillDef = buildSkillMd(form);
    // Load AI settings context
    let contextSection = "";
    try {
      for (const file of ["skill-format", "builder-rules"]) {
        const r = await fetch(`${API_BASE}/api/ai-settings/skill-builder/${file}.md`);
        if (r.ok) { const d = await r.json(); if (d.content) contextSection += `\n### ${file.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}\n${d.content}\n`; }
      }
    } catch { /* settings unavailable, continue without */ }
    const prompt = contextSection ? `${contextSection}\n\n---\n\n請根據以上規則建立以下 Skill 的完整 SKILL.md：\n\n${skillDef}` : skillDef;
    if (!chatStarted) { setInitialPrompt(prompt); setChatStarted(true); setConsoleKey(prev => prev + 1); }
    else { terminalRef.current?.sendPrompt(prompt); }
  };

  // ── Test: non-interactive CLI → SSE → auto show files ──
  const handleTest = async () => {
    setTestRunning(true);
    setTestError("");
    setOutputFiles([]);
    setSelectedFile(null);
    setFileContent("");
    setTestElapsed(0);

    // Timer for elapsed seconds
    const startTime = Date.now();
    const elapsedTimer = setInterval(() => setTestElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);

    // Build test prompt — override output_path with system temp path
    const skillDef = buildSkillMd(form);

    // Load AI settings context
    let contextSection = "";
    try {
      for (const file of ["skill-format", "builder-rules"]) {
        const r = await fetch(`${API_BASE}/api/ai-settings/skill-builder/${file}.md`);
        if (r.ok) { const d = await r.json(); if (d.content) contextSection += `\n### ${file.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}\n${d.content}\n`; }
      }
    } catch { /* settings unavailable */ }
    const contextSkillDef = contextSection ? `${contextSection}\n\n---\n\n根據以上規則建立的 Skill：\n\n${skillDef}` : skillDef;
    const testOutputDir = `${workingDir || "."}/data/skills/.test-output/${form.id || "untitled"}`;
    let prompt = `## 測試任務\n\n請執行以下 Skill 並將所有輸出結果存為檔案。\n\n### Skill 定義\n${contextSkillDef}`;
    if (form.inputs.length > 0) {
      const inputSection = form.inputs.map(inp => {
        if (inp.id === "output_path") return `**${inp.label}**: ${testOutputDir} （測試模式：固定輸出到系統暫存路徑）`;
        return `**${inp.label}**: ${testInputs[inp.id] || "(未提供)"}`;
      }).join("\n");
      prompt += `\n\n### 測試輸入\n${inputSection}`;
    }

    try {
      const res = await fetch(`${API_BASE}/api/skill-test/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: form.id || "untitled", prompt, cwd: workingDir || undefined, timeout: skillConfig.testTimeout, maxToolCalls: skillConfig.maxToolCalls }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "done") {
              clearInterval(elapsedTimer);
              if (event.files && event.files.length > 0) {
                setOutputFiles(event.files);
                // Auto-select first file
                loadFileContent(event.files[0]);
              } else if (event.stdout) {
                setTestError(`CLI 完成但沒有寫入檔案。CLI 輸出如下：\n\n${event.stdout.slice(0, 2000)}`);
              } else if (event.debug) {
                setTestError(`CLI 完成但沒有輸出檔案。${event.debug}`);
              } else if (event.error) {
                setTestError(`CLI 完成但沒有輸出檔案：${event.error}`);
              } else {
                setTestError("CLI 完成但沒有輸出檔案。CLI 可能沒有正確儲存到指定目錄。");
              }
            } else if (event.type === "error") {
              clearInterval(elapsedTimer);
              setTestError(event.message || "CLI 執行失敗");
            }
          } catch {}
        }
      }
    } catch (err: any) {
      clearInterval(elapsedTimer);
      setTestError(`API 錯誤: ${err.message}`);
    } finally {
      setTestRunning(false);
    }
  };

  const loadFileContent = async (file: OutputFile) => {
    setSelectedFile(file);
    try {
      const res = await fetch(`${API_BASE}/api/skill-test/file-content?path=${encodeURIComponent(file.path)}`);
      const data = await res.json();
      setFileContent(data.content || "");
    } catch {
      setFileContent("(無法讀取檔案)");
    }
  };

  // ── Publish: move skill from building/ to input-prompt/ ──
  const handlePublish = async () => {
    if (!form.id || form.id === "untitled") return;
    setPublishStatus("publishing");
    try {
      // Ensure latest content is saved first
      const content = buildSkillMd(form);
      if (selectedPath) {
        await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(selectedPath)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
        });
      }
      const res = await fetch(`${API_BASE}/api/skills/${form.id}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "input-prompt" }),
      });
      const data = await res.json();
      if (data.ok) { setPublishStatus("done"); setTimeout(() => setPublishStatus(""), 3000); }
      else { setPublishStatus("error"); setTimeout(() => setPublishStatus(""), 3000); }
    } catch { setPublishStatus("error"); setTimeout(() => setPublishStatus(""), 3000); }
  };

  const canPublish = !!(form.id && form.id !== "untitled" && form.purpose.trim() && selectedPath?.includes("/building/"));

  const canBuild = form.purpose.trim();
  const hasEmptyRequired = form.inputs.some(inp => inp.required && !(testInputs[inp.id] || "").trim() && inp.id !== "output_path");
  const canTest = canBuild && !hasEmptyRequired;

  // ━━━━━━━━━━━━━━━━━━ RENDER ━━━━━━━━━━━━━━━━━━
  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: bg }}>

      {/* ── Header ── */}
      <div className="shrink-0 px-5 py-2.5 border-b flex items-center gap-3 bg-white" style={{ borderColor: border + "30" }}>
        <span className="text-lg">🔨</span>
        <h2 className="text-sm font-bold text-stone-800">Skill Builder</h2>
        <div className="flex items-center gap-1.5">
          <select value={selectedPath} onChange={e => handleSelectFile(e.target.value)} className="text-xs px-2 py-1.5 border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1" style={{ minWidth: 200, "--tw-ring-color": accent } as React.CSSProperties}>
            <option value="">-- {t("common.select", "選擇")} Skill --</option>
            {files.map(f => <option key={f.path} value={f.path}>{f.name}</option>)}
          </select>
          <button onClick={() => { setShowNewDialog(true); setNewFileName(""); }} className="px-3 py-1.5 text-xs font-medium rounded-lg text-white transition-colors" style={{ background: accent }}>＋ New</button>
          {saveStatus === "saving" && <span className="text-[10px] text-amber-500">💾</span>}
          {saveStatus === "saved" && selectedPath && <span className="text-[10px] text-green-500">✓</span>}
          {saveStatus === "dirty" && <span className="text-[10px] text-rose-500">●</span>}
        </div>
        <div className="flex items-center gap-2 ml-2">
          <select value={cli} onChange={e => setCli(e.target.value as typeof cli)} className="text-xs px-2 py-1.5 border border-stone-200 rounded-lg bg-white">
          <option value="qwen">Qwen</option>
          <option value="claude">Claude Code</option>
          <option value="opencode">OpenCode</option>
        </select>
      </div>
      </div>

      {/* ── New File Dialog ── */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowNewDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-96 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-stone-800 mb-1">📄 建立新的 Skill</h3>
            <p className="text-xs text-stone-500 mb-4">給 Skill 一個名字</p>
            <input type="text" value={newFileName} onChange={e => setNewFileName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleCreate(); }} placeholder="例：translate、log-analyzer" className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 mb-2" style={{ "--tw-ring-color": accent + "40" } as React.CSSProperties} autoFocus />
            {newFileName.trim() && <p className="text-[11px] text-stone-400 mb-4">→ build-{newFileName.trim().replace(/\s+/g, "-").toLowerCase()}.md</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowNewDialog(false)} className="px-4 py-2 text-sm rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50">{t("common.cancel")}</button>
              <button onClick={handleCreate} disabled={!newFileName.trim()}
                className={cn("px-5 py-2 text-sm font-bold rounded-xl text-white", newFileName.trim() ? "hover:opacity-90" : "bg-stone-200 text-stone-400")}
                style={newFileName.trim() ? { background: accent } : {}}>{t("common.create")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ━━ Left Panel ━━ */}
        <div className="flex flex-col border-r" style={{ width: "50%", borderColor: border + "30", backgroundColor: bg }}>
          <div className="shrink-0 flex border-b bg-white" style={{ borderColor: border + "30" }}>
            <button onClick={() => setTab("builder")}
              className={cn("flex-1 py-2.5 text-xs font-bold transition-colors text-center", tab === "builder" ? "border-b-2" : "text-stone-500 hover:text-stone-700")}
              style={tab === "builder" ? { color: accent, borderColor: accent, background: theme.accentLight + "40" } : {}}>
              🔨 Builder
            </button>
            <button onClick={() => setTab("test")}
              className={cn("flex-1 py-2.5 text-xs font-bold transition-colors text-center", tab === "test" ? "border-b-2" : "text-stone-500 hover:text-stone-700")}
              style={tab === "test" ? { color: accent, borderColor: accent, background: theme.accentLight + "40" } : {}}>
              ▶️ Test{outputFiles.length > 0 && <span className="ml-1 text-[10px]" style={{ color: accent }}>({outputFiles.length})</span>}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ── Builder Tab ── */}
            {tab === "builder" && (
              !selectedPath ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                  <span className="text-5xl">🔨</span>
                  <div className="text-center"><p className="text-stone-600 text-base font-medium">建立一個新的 AI Skill</p><p className="text-stone-400 text-sm mt-1">點 <strong style={{ color: accent }}>＋ New</strong> 或選擇已有的 build script</p></div>
                </div>
              ) : (
                <div className="p-5 space-y-4 pb-24">
                  {/* ── Skill Metadata ── */}
                  <div className="flex gap-3 mb-4">
                    <div className="flex-1">
                      <label className="text-xs font-bold text-stone-500 mb-1.5 block">Skill ID</label>
                      <input type="text" value={form.id} onChange={e => update("id", e.target.value)} placeholder="例：error-analyzer" className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2" style={{ "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-bold text-stone-500 mb-1.5 block">Skill Name</label>
                      <input type="text" value={form.name} onChange={e => update("name", e.target.value)} placeholder="例：錯誤分析器" className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2" style={{ "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                    </div>
                  </div>
                  <StepCard number={1} icon="🎯" title="Purpose" hint="這個 Skill 做什麼？" required accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.purpose} onChange={e => update("purpose", e.target.value)} placeholder="例：根據錯誤訊息和 log，分析問題的根因並產生報告" rows={3} className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                    <p className="text-[11px] text-stone-400">💡 想像你在跟一個新同事解釋這個任務</p>
                  </StepCard>
                  <StepCard number={2} icon="📝" title="Inputs" hint="需要使用者提供什麼？" accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    {form.inputs.length === 0 && (<div className="text-center py-4"><p className="text-xs text-stone-400 mb-3">這個 Skill 需要使用者輸入什麼資訊？</p><button onClick={addInput} className="px-4 py-2 text-sm font-medium border rounded-xl hover:opacity-80" style={{ color: accent, borderColor: accent + "40" }}>＋ 新增輸入欄位</button></div>)}
                    <div className="space-y-3">{form.inputs.map((inp, idx) => <InputFieldCard key={idx} field={inp} index={idx} onUpdate={updateInput} onRemove={removeInput} />)}</div>
                    {form.inputs.length > 0 && <button onClick={addInput} className="w-full py-2.5 text-sm font-medium border border-dashed rounded-xl hover:opacity-80" style={{ color: accent, borderColor: accent + "40" }}>＋ 新增欄位</button>}
                  </StepCard>
                  <StepCard number={3} icon="🧠" title="Steps" hint="AI 應該怎麼做？" required accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.steps} onChange={e => update("steps", e.target.value)} placeholder={"寫下 AI 應該遵循的步驟：\n1. ...\n2. ..."} rows={8} className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={4} icon="📋" title="Output" hint="輸出長什麼樣子？" accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.outputFormat} onChange={e => update("outputFormat", e.target.value)} placeholder="描述你期望的輸出格式" rows={6} className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={5} icon="📖" title="Examples" hint="使用範例" accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.examples} onChange={e => update("examples", e.target.value)} placeholder="列出這個 Skill 的使用情境或範例\n例：使用者說「幫我分析這個錯誤」→ AI 讀取錯誤訊息、產出根因報告" rows={5} className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={6} icon="🛡️" title="Guardrails" hint="安全限制" accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.guardrails} onChange={e => update("guardrails", e.target.value)} placeholder="什麼不能做？什麼要特別小心？" rows={5} className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={7} icon="✅" title="Validation" hint="怎麼確認結果正確？" accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.validation} onChange={e => update("validation", e.target.value)} placeholder="怎麼驗證 AI 的輸出品質？" rows={5} className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={8} icon="📝" title="Notes" hint="備註" accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.notes} onChange={e => update("notes", e.target.value)} placeholder="開發者備註或額外說明" rows={4} className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                </div>
              )
            )}

            {/* ── Test Tab ── */}
            {tab === "test" && (
              <div className="p-5 space-y-4 pb-24">
                {!selectedPath ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3"><span className="text-4xl">▶️</span><p className="text-xs text-stone-400">請先選擇或建立一個 Skill</p></div>
                ) : (
                  <>
                    <div className="border rounded-2xl overflow-hidden bg-white" style={{ borderColor: accent + "30" }}>
                      <div className="px-4 py-2.5 border-b" style={{ borderColor: accent + "15", background: theme.accentLight + "30" }}>
                        <span className="text-xs font-bold" style={{ color: accentText }}>▶️ 測試輸入</span>
                        <span className="ml-2 text-[10px] text-stone-400">{form.name || form.id}</span>
                      </div>
                      <div className="p-4 space-y-3">
                        {form.inputs.length > 0 ? form.inputs.map(inp => {
                          const isOutputPath = inp.id === "output_path";
                          const testOutputDisplay = `data/skills/.test-output/${form.id || "untitled"}`;
                          return (
                          <div key={inp.id}>
                            <label className="block text-xs font-medium text-stone-600 mb-1">{inp.label} {inp.required && <span className="text-rose-400">*</span>} {isOutputPath && <span className="text-stone-400 font-normal">（測試模式固定路徑）</span>}</label>
                            {inp.multiline && !isOutputPath ? (
                              <textarea value={testInputs[inp.id] || ""} onChange={e => setTestInputs(prev => ({ ...prev, [inp.id]: e.target.value }))} placeholder={inp.placeholder || `輸入 ${inp.label}...`} rows={3} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 resize-none" style={{ "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                            ) : (
                              <input type="text" value={isOutputPath ? testOutputDisplay : (testInputs[inp.id] || "")} onChange={e => { if (!isOutputPath) setTestInputs(prev => ({ ...prev, [inp.id]: e.target.value })); }} readOnly={isOutputPath} placeholder={inp.placeholder || `輸入 ${inp.label}...`} className={"w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2" + (isOutputPath ? " bg-stone-50 text-stone-500" : "")} style={{ "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                            )}
                          </div>
                          );
                        }) : <p className="text-xs text-stone-400">這個 Skill 沒有定義輸入欄位，直接按「執行測試」。</p>}
                      </div>
                    </div>

                    {testError && (
                      <div className="border border-rose-200 rounded-xl p-4 bg-rose-50">
                        <p className="text-sm font-medium text-rose-700">❌ 測試失敗</p>
                        <p className="text-xs text-rose-500 mt-1">{testError}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Sticky Action Bar ── */}
          {selectedPath && (
            <div className="shrink-0 border-t px-5 py-3 bg-white flex items-center gap-3" style={{ borderColor: border + "30" }}>
              {tab === "builder" && (
                <>
                  <button onClick={handleBuild} disabled={!canBuild}
                    className="px-6 py-2.5 text-sm font-bold rounded-xl text-white transition-all shadow-sm"
                    style={!canBuild ? { background: "#e7e5e4", color: "#a8a29e" } : { background: `linear-gradient(135deg, ${accent}, ${accentHover})` }}>
                    🔨 Build
                  </button>
                  <button onClick={handlePublish} disabled={!canPublish || publishStatus === "publishing"}
                    className="px-4 py-2.5 text-sm font-bold rounded-xl transition-all shadow-sm"
                    style={!canPublish || publishStatus === "publishing"
                      ? { background: "#e7e5e4", color: "#a8a29e" }
                      : publishStatus === "done" ? { background: "#16a34a", color: "#fff" }
                      : publishStatus === "error" ? { background: "#dc2626", color: "#fff" }
                      : { background: "#fff", color: accent, border: `1.5px solid ${accent}` }}>
                    {publishStatus === "publishing" ? "⏳ 發佈中..."
                      : publishStatus === "done" ? "✅ 已發佈"
                      : publishStatus === "error" ? "❌ 失敗"
                      : "🚀 發佈"}
                  </button>
                  {chatStarted && <button onClick={() => { setChatStarted(false); setInitialPrompt(undefined); setConsoleKey(p => p + 1); }} className="ml-auto px-3 py-1.5 text-[11px] rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50">✕ 重置</button>}
                </>
              )}
              {tab === "test" && (
                <div className="flex items-center gap-3">
                  <button onClick={handleTest} disabled={!canTest || testRunning}
                    className="px-6 py-2.5 text-sm font-bold rounded-xl text-white transition-all shadow-sm flex items-center gap-2"
                    style={!canTest || testRunning ? { background: "#e7e5e4", color: "#a8a29e" } : { background: `linear-gradient(135deg, ${accent}, ${accentHover})` }}>
                    {testRunning && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {testRunning ? `執行中... ${testElapsed}s` : "▶️ 執行測試"}
                  </button>
                  {hasEmptyRequired && !testRunning && <span className="text-[11px] text-rose-400">⚠️ 請填寫所有必填欄位</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ━━ Right Panel ━━ */}
        <div className="flex flex-col flex-1 min-w-0" style={{ backgroundColor: "#1e1e2e" }}>

          {/* Builder: interactive CLI — always mounted, hidden via display */}
          <div style={{ display: tab === "builder" ? "flex" : "none" }} className="flex-col flex-1 min-h-0">
            {!chatStarted ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                <span className="text-5xl opacity-30">🔨</span>
                <div className="text-center">
                  <p className="text-stone-400 text-sm">按底部 <strong className="text-white">🔨 Build</strong> 開始</p>
                  <p className="text-stone-500 text-xs mt-2">Skill Creator 幫你產出 SKILL.md</p>
                </div>
              </div>
            ) : (
              <TerminalConsole ref={terminalRef} key={`cli-${consoleKey}`} cwd={workingDir || undefined} cli={cli} approvalMode="yolo" initialPrompt={initialPrompt} />
            )}
          </div>

          {/* Test: spinner → file list + content viewer — always mounted, hidden via display */}
          <div style={{ display: tab === "test" ? "flex" : "none" }} className="flex-col flex-1 min-h-0">
            {testRunning ? (
              /* ── Running: spinner with elapsed ── */
              <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                <div className="relative">
                  <div className="w-16 h-16 border-4 rounded-full animate-spin" style={{ borderColor: accent + "30", borderTopColor: accent }} />
                  <span className="absolute inset-0 flex items-center justify-center text-lg font-bold" style={{ color: accent }}>{testElapsed}</span>
                </div>
                <div className="text-center">
                  <p className="text-stone-300 text-sm font-medium">CLI 正在執行 Skill 測試</p>
                  <p className="text-stone-500 text-xs mt-1">等待 AI 產出結果檔案...</p>
                </div>
              </div>
            ) : outputFiles.length > 0 ? (
              /* ── Done: file list (top) + content viewer (bottom) ── */
              <div className="flex flex-col h-full">
                {/* File List Bar */}
                <div className="shrink-0 border-b border-stone-700">
                  <div className="px-3 py-2 flex items-center gap-2 border-b border-stone-700/50">
                    <span className="text-xs font-bold text-stone-300">📁 輸出檔案</span>
                    <span className="text-[10px] text-stone-500">{outputFiles.length} files</span>
                  </div>
                  <div className="flex overflow-x-auto px-2 py-1.5 gap-1" style={{ scrollbarWidth: "thin" }}>
                    {outputFiles.map(f => (
                      <button key={f.path} onClick={() => loadFileContent(f)}
                        className={cn("shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors",
                          selectedFile?.path === f.path ? "text-white" : "text-stone-400 hover:text-stone-200 hover:bg-stone-700/50")}
                        style={selectedFile?.path === f.path ? { background: accent } : {}}>
                        <span>{typeIcon(f.type)}</span>
                        <span className="font-medium">{f.name}</span>
                        <span className="text-[9px] opacity-60">{formatSize(f.size)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* Content Viewer */}
                <div className="flex-1 overflow-auto">
                  {selectedFile ? (
                    <ContentViewer file={selectedFile} content={fileContent} accent={accent} />
                  ) : (
                    <div className="flex items-center justify-center h-full"><p className="text-stone-500 text-xs">點選上方檔案預覽</p></div>
                  )}
                </div>
              </div>
            ) : testError ? (
              /* ── Error ── */
              <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
                <span className="text-4xl">❌</span>
                <p className="text-rose-400 text-sm font-medium">測試失敗</p>
                <p className="text-rose-500/70 text-xs text-center max-w-md">{testError}</p>
              </div>
            ) : (
              /* ── Idle ── */
              <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                <span className="text-5xl opacity-30">▶️</span>
                <div className="text-center">
                  <p className="text-stone-400 text-sm">填入輸入，按 <strong className="text-white">▶️ 執行測試</strong></p>
                  <p className="text-stone-500 text-xs mt-2">CLI 會把結果存到 temp 目錄，完成後自動顯示</p>
                </div>
              </div>
            )
            }
          </div>
        </div>
      </div>
    </div>
  );
}
