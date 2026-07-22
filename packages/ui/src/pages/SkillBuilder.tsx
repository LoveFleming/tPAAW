import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import { useTheme } from "../theme";
import AgentConsole, { AgentConsoleHandle } from "../components/AgentConsole";
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
  examples: string; buildLog: string;
  tags: string; visibility: "private" | "team" | "public";
}

interface TrainingFile { name: string; path: string; }
interface OutputFile { name: string; path: string; size: number; type: string; ext: string; }

// ── Constants ──
import ModelSelector from "../components/ModelSelector";
import API_BASE from "../api";

const EMPTY_FIELD: InputField = { id: "", label: "", description: "", placeholder: "", required: false, multiline: false };
const DEFAULT_OUTPUT_FIELD: InputField = { id: "output_path", label: "輸出路徑", description: "Skill 執行結果的儲存路徑", placeholder: "例：output/report.html", required: true, multiline: false };
const EMPTY_SKILL: SkillForm = { id: "", name: "", version: "1.0.0", description: "", runner: "prompt", inputs: [DEFAULT_OUTPUT_FIELD], purpose: "", steps: "", outputFormat: "", guardrails: "", validation: "", systemPrompt: "", examples: "", buildLog: "", tags: "", visibility: "private" };

// ── Helpers ──
function buildPromptFromFields(form: SkillForm): string {
  const parts: string[] = [];
  // Always output all sections so Advanced mode shows the full template
  parts.push(`@@@purpose@@@\n${form.purpose || ""}`);
  if (form.inputs.length > 0) {
    parts.push("@@@inputs@@@\n" + form.inputs.map(inp => `- **${inp.label}**${inp.required ? " (required)" : " (optional)"}: ${inp.description || inp.placeholder}`).join("\n"));
  }
  parts.push(`@@@steps@@@\n${form.steps || ""}`);
  parts.push(`@@@output@@@\n${form.outputFormat || ""}`);
  parts.push(`@@@guardrails@@@\n${form.guardrails || ""}`);
  parts.push(`@@@validation@@@\n${form.validation || ""}`);
  parts.push(`@@@examples@@@\n${form.examples || ""}`);
  parts.push(`@@@build_log@@@\n${form.buildLog || ""}`);
  return parts.join("\n\n");
}

function parseSkillMd(content: string): SkillForm {
  const form = { ...EMPTY_SKILL };
  // Strip stray text before frontmatter (e.g. leftover "yaml" after code fence removal)
  const fmStart = content.indexOf("---");
  if (fmStart > 0) content = content.slice(fmStart);
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
  // ── Parse body sections using @@@section@@@ delimiters (safe with markdown content) ──
  const SECTION_MAP: Record<string, string> = {
    "@@@purpose@@@": "Purpose",
    "@@@inputs@@@": "Inputs",
    "@@@steps@@@": "Steps",
    "@@@output@@@": "Output",
    "@@@examples@@@": "Examples",
    "@@@guardrails@@@": "Guardrails",
    "@@@validation@@@": "Validation",
    "@@@build_log@@@": "Build_Log",
    // Legacy compat
    "@@@error_handling@@@": "Error_Handling",
    "@@@notes@@@": "Build_Log",
  };
  const bodyLines = body.split("\n");
  let currentSection: string | null = null;
  let sectionBuffer: string[] = [];
  const sections = new Map<string, string>();

  const flushSection = () => {
    if (currentSection) sections.set(currentSection, sectionBuffer.join("\n").trim());
    sectionBuffer = [];
  };

  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (SECTION_MAP[trimmed]) {
      flushSection();
      currentSection = SECTION_MAP[trimmed];
    } else if (currentSection) {
      sectionBuffer.push(line);
    }
  }
  flushSection();

  // Also try legacy ## format for backward compatibility
  if (sections.size === 0) {
    // Map standard markdown headings to form field names
    const MARKDOWN_SECTION_MAP: Record<string, string> = {
      "Purpose": "Purpose",
      "Inputs": "Inputs",
      "Deterministic Script": "Steps",
      "Output Contract": "Output",
      "Output": "Output",
      "Error Handling": "Error_Handling",
      "Guardrails": "Guardrails",
      "Validation": "Validation",
      "Examples": "Examples",
      "Build Log": "Build_Log",
      "Notes": "Build_Log",
    };
    let legacySection: string | null = null;
    let legacyBuffer: string[] = [];
    const flushLegacy = () => {
      if (legacySection) sections.set(legacySection, legacyBuffer.join("\n").trim());
      legacyBuffer = [];
    };
    for (const line of bodyLines) {
      const h = line.match(/^## (.+)$/);  // Only match ## (not ### sub-sections)
      if (h) {
        const heading = h[1].trim();
        // Match heading (including sub-sections like "### Execution Steps")
        const mapped = MARKDOWN_SECTION_MAP[heading];
        if (mapped) {
          flushLegacy();
          legacySection = mapped;
          continue;
        }
      }
      if (legacySection) {
        legacyBuffer.push(line);
      }
    }
    flushLegacy();
  }

  form.purpose = sections.get("Purpose") || "";
  form.steps = sections.get("Steps") || "";
  form.outputFormat = sections.get("Output") || "";
  form.examples = sections.get("Examples") || "";
  form.guardrails = sections.get("Guardrails") || "";
  form.validation = sections.get("Validation") || "";
  form.buildLog = sections.get("Build_Log") || "";
  // Legacy: merge Error_Handling into steps (it's a sub-section of Deterministic Script)
  const legacyError = sections.get("Error_Handling");
  if (legacyError && !form.steps.includes("Error Handling")) {
    form.steps = form.steps + "\n\n### Error Handling\n" + legacyError;
  }
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
        <span className="text-sm">{icon}</span>
        <div className="flex-1">
          <span className="text-sm font-bold text-stone-800">{title}</span>
          {hint && <span className="ml-2 text-sm text-stone-400">{hint}</span>}
        </div>
        {required && <span className="text-xs text-rose-400 font-medium">必填</span>}
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
  const { t } = useI18n();
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3 relative group">
      <button onClick={() => onRemove(index)} className="absolute top-3 right-3 text-stone-300 hover:text-rose-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">{t("skillBuilder.fieldLabelLabel", "欄位名稱")} *</label>
          <input type="text" value={field.label} onChange={e => { const label = e.target.value; onUpdate(index, { label, id: label.replace(/\s+/g, "_").toLowerCase().replace(/[^a-z0-9_]/g, "") || field.id }); }} placeholder={t("skillBuilder.fieldLabelPlaceholder")} className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">{t("skillBuilder.fieldValueLabel", "輸入提示")}</label>
          <input type="text" value={field.placeholder} onChange={e => onUpdate(index, { placeholder: e.target.value })} placeholder={t("skillBuilder.fieldValuePlaceholder")} className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-600 mb-1">{t("skillBuilder.fieldDescLabel", "說明")}</label>
        <input type="text" value={field.description} onChange={e => onUpdate(index, { description: e.target.value })} placeholder={t("skillBuilder.fieldDescPlaceholder")} className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm text-stone-600 cursor-pointer"><input type="checkbox" checked={field.required} onChange={e => onUpdate(index, { required: e.target.checked })} className="rounded border-stone-300" /> {t("skillBuilder.requiredLabel", "必填")}</label>
        <label className="flex items-center gap-1.5 text-sm text-stone-600 cursor-pointer"><input type="checkbox" checked={field.multiline} onChange={e => onUpdate(index, { multiline: e.target.checked })} className="rounded border-stone-300" /> {t("skillBuilder.multilineLabel", "多行輸入")}</label>
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
          <span className="text-xs text-stone-500">{typeIcon(file.type)} {file.type.toUpperCase()}</span>
          <div className="flex-1" />
          <button onClick={() => setMode("rendered")} className={cn("px-2 py-0.5 text-xs rounded transition-colors", mode === "rendered" ? "text-white" : "text-stone-400 border border-stone-600 hover:bg-stone-700")} style={mode === "rendered" ? { background: accent } : {}}>Rendered</button>
          <button onClick={() => setMode("raw")} className={cn("px-2 py-0.5 text-xs rounded transition-colors", mode === "raw" ? "text-white" : "text-stone-400 border border-stone-600 hover:bg-stone-700")} style={mode === "raw" ? { background: accent } : {}}>Raw</button>
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
  const [showAIGen, setShowAIGen] = useState(false);
  const [aiGenName, setAiGenName] = useState("");
  const [aiGenDesc, setAiGenDesc] = useState("");
  const [aiGenLoading, setAiGenLoading] = useState(false);
  const [aiGenPromptPreview, setAiGenPromptPreview] = useState<{system: string; user: string} | null>(null);
  const [workingDir, setWorkingDir] = useState("");

  // Builder mode: visual (step cards) vs advanced (raw prompt)
  const [builderMode, setBuilderMode] = useState<"visual" | "advanced">("visual");
  const [rawBuildPrompt, setRawBuildPrompt] = useState("");
  const lastSyncSource = useRef<"visual" | "advanced" | null>(null);

  // Builder Agent (interactive)
  const [model, setModel] = useState("");
  const [consoleKey, setConsoleKey] = useState(0);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
  const [buildSystemPrompt, setBuildSystemPrompt] = useState<string | undefined>();
  const [chatStarted, setChatStarted] = useState(false);
  const terminalRef = useRef<AgentConsoleHandle>(null);
  const loadingRef = useRef(false);

  // Load models from provider config
  // Skill creator
  const [skillCreatorContent, setSkillCreatorContent] = useState("");
  const [skillConfig, setSkillConfig] = useState({ testTimeout: 0, maxToolCalls: 0 });

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
  const [showPromptPreview, setShowPromptPreview] = useState(false);

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
    fetch(`${API_BASE}/api/skill-builder/build-files`).then(r => r.ok ? r.json() : []).then((f: TrainingFile[]) => setFiles(f)).catch(() => {});
  }, []);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    fetch(`${API_BASE}/api/ai-settings/agent-config`).then(r => r.json()).then(data => {
      setSkillConfig({ testTimeout: data.timeoutSeconds, maxToolCalls: data.maxTurns });
    }).catch(() => {});
  }, []);

  // Load skill-builder context on mount so AgentConsole always has the right system prompt
  useEffect(() => {
    fetch(`${API_BASE}/api/ai-settings/skill-builder/build`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillDef: "" }),
    }).then(r => r.ok ? r.json() : null).then((ctx: any) => {
      if (ctx?.systemPrompt) setBuildSystemPrompt(ctx.systemPrompt);
    }).catch(() => {});
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
      fetch(`${API_BASE}/api/paaw/file-write`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: currentPath, content }),
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
    const basePath = `${workingDir || "."}/data/skills/building/${slug}`;
    const fullPath = `${basePath}/skill-source.md`;
    const newForm: SkillForm = { ...EMPTY_SKILL, id: slug, name: raw.replace(/\.md$/, "") };
    // Create skill-source.md (original source, read-only after build)
    await fetch(`${API_BASE}/api/paaw/file-write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: fullPath, content: buildSkillMd(newForm) }) });
    // Create package/ directory with initial SKILL.md
    const pkgPath = `${basePath}/package/SKILL.md`;
    await fetch(`${API_BASE}/api/paaw/file-write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: pkgPath, content: buildSkillMd(newForm) }) });
    setShowNewDialog(false); setNewFileName(""); loadFiles(); setSelectedPath(fullPath); setForm(newForm);
    const initInputs: Record<string, string> = {};
    newForm.inputs.forEach(inp => { initInputs[inp.id] = inp.id === "output_path" ? "" : ""; });
    setTestInputs(initInputs);
    setSaveStatus("saved"); setTab("builder");
  };

  // ── AI Generate: input name + description → AI generates content → write → reload ──
  const handleAIGenerate = async () => {
    const name = aiGenName.trim();
    const desc = aiGenDesc.trim();
    if (!name || !desc) return;
    setAiGenLoading(true);

    const slug = name.replace(/\.md$/, "").replace(/\s+/g, "-").toLowerCase().replace(/^build-/, "");
    const basePath = `${workingDir || "."}/data/skills/building/${slug}`;
    const fullPath = `${basePath}/skill-source.md`;
    const pkgPath = `${basePath}/package/SKILL.md`;
    const requirement = `Skill 名稱：${name}\n功能描述：${desc}`;

    // 1. Call AI to generate full SKILL.md content (BEFORE creating any files)
    try {
      const res = await fetch(`${API_BASE}/api/skills/ai-generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement, model: model || undefined }),
      });
      const data = await res.json();
      if (data.error) { alert("AI 生成失敗：" + data.error); return; }

      // Save prompt info for preview
      if (data.systemPrompt || data.userMessage) {
        setAiGenPromptPreview({ system: data.systemPrompt || "", user: data.userMessage || "" });
      }

      // 2. Parse AI output and fill form
      const parsed = parseSkillMd(data.content || "");
      // Ensure id/name match user input
      if (!parsed.id || parsed.id === "untitled") parsed.id = slug;
      if (!parsed.name || parsed.name === "Untitled") parsed.name = name;
      // Preserve user description
      if (desc && !parsed.description) parsed.description = desc;

      // 3. Write files — skill-source.md uses @@@ format (for UI), package/SKILL.md uses raw AI markdown
      const sourceContent = buildSkillMd(parsed);  // @@@ format for UI editing
      const pkgContent = (data.content || "").trim();   // raw AI markdown output = executable SKILL.md
      await fetch(`${API_BASE}/api/paaw/file-write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: fullPath, content: sourceContent }) });
      await fetch(`${API_BASE}/api/paaw/file-write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: pkgPath, content: pkgContent }) });

      // 4. Reload file list and select the new file
      await loadFiles();
      setSelectedPath(fullPath);
      setForm(parsed);
      const inputs: Record<string, string> = {};
      parsed.inputs.forEach(inp => { inputs[inp.id] = ""; });
      setTestInputs(inputs);
      setSaveStatus("saved");
      setTab("builder");

      setShowAIGen(false); setAiGenName(""); setAiGenDesc("");
    } catch (err: any) {
      alert("AI 生成失敗：" + err.message);
    } finally {
      setAiGenLoading(false);
    }
  };


  const [promptPreview, setPromptPreview] = useState(false);
  const [promptPreviewContent, setPromptPreviewContent] = useState<{system: string; prompt: string} | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [showUserPrompt, setShowUserPrompt] = useState(false);

  const handlePreviewPrompt = async () => {
    let systemPrompt = buildSystemPrompt || "";
    let userPrompt = "";
    if (builderMode === "advanced" && rawBuildPrompt.trim()) {
      userPrompt = rawBuildPrompt.trim();
    } else {
      const skillDef = buildSkillMd(form);
      userPrompt = skillDef;
    }
    // Fetch FINAL system prompt (exactly what AI will receive)
    try {
      const res = await fetch(`${API_BASE}/api/ai-settings/skill-builder/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillDef: userPrompt, model }),
      });
      if (res.ok) {
        const ctx = await res.json();
        if (ctx.systemPrompt) systemPrompt = ctx.systemPrompt;
        if (ctx.prompt) userPrompt = ctx.prompt;
      }
    } catch {}
    setPromptPreviewContent({ system: systemPrompt, prompt: userPrompt });
    setPromptPreview(true);
  };

  // ── Build: interactive Agent ──
  const handleBuild = async () => {
    let prompt: string;
    if (builderMode === "advanced" && rawBuildPrompt.trim()) {
      // Advanced mode: use raw prompt directly
      prompt = rawBuildPrompt.trim();
    } else {
      // Visual mode: build from form fields
      const skillDef = buildSkillMd(form);
      prompt = skillDef;
      try {
        const res = await fetch(`${API_BASE}/api/ai-settings/skill-builder/build`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillDef }),
        });
        if (res.ok) {
          const ctx = await res.json();
          prompt = ctx.prompt || skillDef;
          if (ctx.systemPrompt) setBuildSystemPrompt(ctx.systemPrompt);
        }
      } catch { /* context-engine unavailable, use raw skillDef */ }
    }
    // Always rebuild AgentConsole to ensure latest systemPrompt is sent via WS spawn
    setInitialPrompt(prompt);
    setChatStarted(true);
    setConsoleKey(prev => prev + 1);
  };

  // ── Test: just use the built SKILL.md + user input ──
  // Output goes to test-output/ (separate from package/) so it can be reviewed independently
  const buildTestPrompt = () => {
    const testOutputDir = `data/skills/building/${form.id || "untitled"}/test-output`;

    // 1. User inputs — the actual test data
    const userInputLines: string[] = [];
    if (form.inputs.length > 0) {
      for (const inp of form.inputs) {
        if (inp.id === "output_path") {
          userInputLines.push(`${inp.label}: ${testOutputDir}`);
        } else {
          userInputLines.push(`${inp.label}: ${testInputs[inp.id] || "(未提供)"}`);
        }
      }
    }

    // 2. Simple prompt: built skill + user input → test if publishable
    return `請使用剛 build 好的 Skill（data/skills/building/${form.id || "untitled"}/package/SKILL.md）執行以下使用者輸入，驗證 Skill 是否能正常產出結果。

## User Input
${userInputLines.join("\n")}

照 SKILL.md 的 Output Contract 輸出到指定目錄。如果正常產出，代表可以發佈。`;
  };

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

    const prompt = buildTestPrompt();
    // Test mode: output goes to test-output/ (not package/), always overwritten
    const testOutputDir = `data/skills/building/${form.id || "untitled"}/test-output`;
    // Clean previous test output
    try { await fetch(`${API_BASE}/api/fs/rmdir?path=${encodeURIComponent(testOutputDir)}`, { method: "DELETE" }); } catch {}

    try {
      const res = await fetch(`${API_BASE}/api/skill-test/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: form.id || "untitled", prompt, cwd: workingDir || undefined, timeout: skillConfig.testTimeout, maxToolCalls: skillConfig.maxToolCalls, model: model || undefined }),
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
                setTestError(`AI 完成但沒有寫入檔案。輸出如下：\n\n${event.stdout.slice(0, 2000)}`);
              } else if (event.debug) {
                setTestError(`AI 完成但沒有輸出檔案。${event.debug}`);
              } else if (event.error) {
                setTestError(`AI 完成但沒有輸出檔案：${event.error}`);
              } else {
                setTestError("AI 完成但沒有輸出檔案。可能沒有正確儲存到指定目錄。");
              }
            } else if (event.type === "error") {
              clearInterval(elapsedTimer);
              setTestError(event.message || "AI 執行失敗");
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

  // ── Publish: move skill from building/ to physical-skill/ ──
  const handlePublish = async () => {
    if (!form.id || form.id === "untitled") return;
    setPublishStatus("publishing");
    try {
      const res = await fetch(`${API_BASE}/api/skills/${form.id}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "physical-skill" }),
      });
      const data = await res.json();
      if (data.ok) { setPublishStatus("done"); setTimeout(() => setPublishStatus(""), 3000); }
      else { setPublishStatus("error"); setTimeout(() => setPublishStatus(""), 3000); }
    } catch { setPublishStatus("error"); setTimeout(() => setPublishStatus(""), 3000); }
  };

  const canPublish = outputFiles.length > 0;

  const canBuild = builderMode === "advanced" ? rawBuildPrompt.trim().length > 0 : form.purpose.trim().length > 0;
  const hasEmptyRequired = form.inputs.some(inp => inp.required && !(testInputs[inp.id] || "").trim() && inp.id !== "output_path");
  const canTest = canBuild && !hasEmptyRequired;

  // ━━━━━━━━━━━━━━━━━━ RENDER ━━━━━━━━━━━━━━━━━━
  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: bg }}>

      {/* ── Header ── */}
      <div className="shrink-0 px-5 py-2.5 border-b flex items-center gap-3 bg-white" style={{ borderColor: border + "30" }}>
        <span className="text-sm">🔨</span>
        <h2 className="text-sm font-bold text-stone-800">Skill Builder</h2>
        <div className="flex items-center gap-1.5">
          <select value={selectedPath} onChange={e => handleSelectFile(e.target.value)} className="text-xs px-2 py-1.5 border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1" style={{ minWidth: 200, "--tw-ring-color": accent } as React.CSSProperties}>
            <option value="">-- {t("common.select", t("common.select"))} Skill --</option>
            {files.map(f => {
              const label = f.name.replace(/^building\//, "").replace(/\/skill-source\.md$/, "").replace(/^build-/, "").replace(/\.md$/, "");
              return <option key={f.path} value={f.path}>{label}</option>;
            })}
          </select>
          <button onClick={() => { setShowNewDialog(true); setNewFileName(""); }} className="px-3 py-1.5 text-xs font-medium rounded-lg text-white transition-colors" style={{ background: accent }}>＋ New</button>
          <button onClick={() => { setShowAIGen(true); setAiGenName(""); setAiGenDesc(""); }} className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1" style={{ background: "transparent", color: accent, border: `1px solid ${accent}40` }}>✨ AI Generate</button>
          {saveStatus === "saving" && <span className="text-xs text-amber-500">💾</span>}
          {saveStatus === "saved" && selectedPath && <span className="text-xs text-green-500">✓</span>}
          {saveStatus === "dirty" && <span className="text-xs text-rose-500">●</span>}
        </div>
        <div className="flex items-center gap-2 ml-2">
          <ModelSelector feature="skillBuilder" value={model} onChange={setModel} />
      </div>
      </div>

      {/* ── New File Dialog ── */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowNewDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-96 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-stone-800 mb-1">📄 建立新的 Skill</h3>
            <p className="text-xs text-stone-500 mb-4">給 Skill 一個名字</p>
            <input type="text" value={newFileName} onChange={e => setNewFileName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleCreate(); }} placeholder={t("skillBuilder.fileNamePlaceholder")} className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 mb-2" style={{ "--tw-ring-color": accent + "40" } as React.CSSProperties} autoFocus />
            {newFileName.trim() && <p className="text-sm text-stone-400 mb-4">→ {newFileName.trim().replace(/\s+/g, "-").toLowerCase()}/skill-source.md</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowNewDialog(false)} className="px-4 py-2 text-sm rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50">{t("common.cancel")}</button>
              <button onClick={handleCreate} disabled={!newFileName.trim()}
                className={cn("px-5 py-2 text-sm font-bold rounded-xl text-white", newFileName.trim() ? "hover:opacity-90" : "bg-stone-200 text-stone-400")}
                style={newFileName.trim() ? { background: accent } : {}}>{t("common.create")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Generate Dialog ── */}
      {showAIGen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !aiGenLoading && setShowAIGen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-[520px] max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-stone-800 mb-1">✨ AI 產生 Skill</h3>
            <p className="text-xs text-stone-500 mb-4">輸入 Skill 名稱和功能描述，AI 會照格式產出完整的 SKILL.md，產生後你可以直接修改</p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Skill 名稱 *</label>
                <input
                  type="text"
                  value={aiGenName}
                  onChange={e => setAiGenName(e.target.value)}
                  placeholder={t("skillBuilder.skillIdPlaceholder")}
                  className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2"
                  style={{ "--tw-ring-color": accent + "40" } as React.CSSProperties}
                  autoFocus
                  disabled={aiGenLoading}
                />
                {aiGenName.trim() && <p className="text-sm text-stone-400 mt-1">→ {aiGenName.trim().replace(/\s+/g, "-").toLowerCase()}/skill-source.md</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">功能描述 *</label>
                <textarea
                  value={aiGenDesc}
                  onChange={e => setAiGenDesc(e.target.value)}
                  placeholder={t("skillBuilder.descPlaceholder")}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none"
                  style={{ lineHeight: 1.6, "--tw-ring-color": accent + "40" } as React.CSSProperties}
                  disabled={aiGenLoading}
                />
              </div>
            </div>

            {/* Prompt Preview */}
            {aiGenPromptPreview && (
              <div className="mb-4 border border-stone-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-stone-50 border-b border-stone-200">
                  <span className="text-xs font-bold text-stone-600">📋 AI Generate Prompt 預覽</span>
                  <button onClick={() => setAiGenPromptPreview(null)} className="text-stone-400 hover:text-stone-600 text-xs">✕</button>
                </div>
                <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
                  <div>
                    <p className="text-xs font-bold text-stone-500 mb-1">System Prompt ({aiGenPromptPreview.system.length} chars)</p>
                    <pre className="text-xs text-stone-600 bg-stone-50 rounded-lg p-2 whitespace-pre-wrap max-h-32 overflow-y-auto">{aiGenPromptPreview.system}</pre>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-stone-500 mb-1">User Message ({aiGenPromptPreview.user.length} chars)</p>
                    <pre className="text-xs text-stone-600 bg-stone-50 rounded-lg p-2 whitespace-pre-wrap">{aiGenPromptPreview.user}</pre>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setAiGenPromptPreview({ system: "(點擊 Generate 後顯示實際 prompt)", user: "" })}
                className="text-xs text-stone-400 hover:text-stone-600 underline"
                disabled={aiGenLoading}
              >查看上次 Prompt</button>
              <div className="flex gap-2">
                <button onClick={() => { if (!aiGenLoading) { setShowAIGen(false); setAiGenName(""); setAiGenDesc(""); } }} className="px-4 py-2 text-sm rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50" disabled={aiGenLoading}>{t("common.cancel")}</button>
                <button onClick={handleAIGenerate} disabled={!aiGenName.trim() || !aiGenDesc.trim() || aiGenLoading}
                  className={cn("px-5 py-2 text-sm font-bold rounded-xl text-white flex items-center gap-2", aiGenName.trim() && aiGenDesc.trim() && !aiGenLoading ? "hover:opacity-90" : "bg-stone-200 text-stone-400")}
                  style={aiGenName.trim() && aiGenDesc.trim() && !aiGenLoading ? { background: accent } : {}}>
                  {aiGenLoading && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {aiGenLoading ? t("skillBuilder.generating") : t("skillBuilder.generateButton")}
                </button>
              </div>
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
              ▶️ Test{outputFiles.length > 0 && <span className="ml-1 text-xs" style={{ color: accent }}>({outputFiles.length})</span>}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ── Builder Tab ── */}
            {tab === "builder" && (
              !selectedPath ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                  <span className="text-5xl">🔨</span>
                  <div className="text-center"><p className="text-stone-600 text-sm font-medium">建立一個新的 AI Skill</p><p className="text-stone-400 text-sm mt-1">點 <strong style={{ color: accent }}>＋ New</strong> 或 <strong style={{ color: accent }}>✨ AI Generate</strong> 讓 AI 幫你產生</p></div>
                </div>
              ) : (
                <div className="p-5 space-y-4 pb-24">
                  {/* ── Skill Metadata ── */}
                  <div className="flex gap-3 mb-4">
                    <div className="flex-1">
                      <label className="text-sm font-bold text-stone-500 mb-1.5 block">Skill ID</label>
                      <input type="text" value={form.id} onChange={e => update("id", e.target.value)} placeholder={t("skillBuilder.idPlaceholder")} className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2" style={{ "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-bold text-stone-500 mb-1.5 block">Skill Name</label>
                      <input type="text" value={form.name} onChange={e => update("name", e.target.value)} placeholder={t("skillBuilder.namePlaceholder")} className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2" style={{ "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                    </div>
                  </div>

                  {/* ── Mode Toggle: Visual vs Advanced (synced) ── */}
                  <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-xl w-fit">
                    <button onClick={() => {
                      // Switching to Visual: parse raw prompt back into form
                      if (builderMode === "advanced" && rawBuildPrompt.trim()) {
                        const parsed = parseSkillMd(rawBuildPrompt);
                        setForm(parsed);
                        const inputs: Record<string, string> = {};
                        parsed.inputs.forEach(inp => { inputs[inp.id] = ""; });
                        setTestInputs(inputs);
                        triggerSave();
                      }
                      setBuilderMode("visual");
                    }}
                      className={cn("px-4 py-1.5 text-sm font-medium rounded-lg transition-colors",
                        builderMode === "visual" ? "text-white shadow-sm" : "text-stone-500 hover:text-stone-700")}
                      style={builderMode === "visual" ? { background: accent } : {}}>
                      📝 Visual
                    </button>
                    <button onClick={() => {
                      // Switching to Advanced: assemble form into raw prompt
                      if (builderMode === "visual") {
                        setRawBuildPrompt(buildSkillMd(form));
                      }
                      setBuilderMode("advanced");
                    }}
                      className={cn("px-4 py-1.5 text-sm font-medium rounded-lg transition-colors",
                        builderMode === "advanced" ? "text-white shadow-sm" : "text-stone-500 hover:text-stone-700")}
                      style={builderMode === "advanced" ? { background: accent } : {}}>
                      ⚡ Advanced
                    </button>
                  </div>

                  {/* ── Advanced Mode: Raw Prompt Editor ── */}
                  {builderMode === "advanced" ? (
                    <div className="space-y-3">
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <p className="text-sm text-amber-700">
                          ⚡ <strong>Advanced Mode</strong> — 直接編輯 Build Skill Prompt。切回 Visual 會自動解析回表單欄位。
                        </p>
                      </div>
                      <textarea
                        value={rawBuildPrompt}
                        onChange={e => setRawBuildPrompt(e.target.value)}
                        placeholder={t("skillBuilder.rawPromptPlaceholder")}
                        rows={24}
                        className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-y font-mono"
                        style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30", minHeight: "400px" } as React.CSSProperties}
                      />
                      <p className="text-sm text-stone-400">💡 與 Visual 模式同步 — 切回 Visual 會將內容解析回表單</p>
                    </div>
                  ) : (
                  <>
                  <StepCard number={1} icon="🎯" title="Purpose" hint={t("skillBuilder.hintPurpose")} required accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.purpose} onChange={e => update("purpose", e.target.value)} placeholder={t("skillBuilder.purposePlaceholder")} rows={3} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                    <p className="text-sm text-stone-400">💡 想像你在跟一個新同事解釋這個任務</p>
                  </StepCard>
                  <StepCard number={2} icon="📝" title="Inputs" hint={t("skillBuilder.hintInputs")} accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    {form.inputs.length === 0 && (<div className="text-center py-4"><p className="text-sm text-stone-400 mb-3">這個 Skill 需要使用者輸入什麼資訊？</p><button onClick={addInput} className="px-4 py-2 text-sm font-medium border rounded-xl hover:opacity-80" style={{ color: accent, borderColor: accent + "40" }}>＋ 新增輸入欄位</button></div>)}
                    <div className="space-y-3">{form.inputs.map((inp, idx) => <InputFieldCard key={idx} field={inp} index={idx} onUpdate={updateInput} onRemove={removeInput} />)}</div>
                    {form.inputs.length > 0 && <button onClick={addInput} className="w-full py-2.5 text-sm font-medium border border-dashed rounded-xl hover:opacity-80" style={{ color: accent, borderColor: accent + "40" }}>＋ 新增欄位</button>}
                  </StepCard>
                  <StepCard number={3} icon="🧠" title="Steps" hint="AI 應該怎麼做？" required accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.steps} onChange={e => update("steps", e.target.value)} placeholder={t("skillBuilder.stepsPlaceholder")} rows={8} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={4} icon="📋" title="Output" hint={t("skillBuilder.hintOutput")} accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.outputFormat} onChange={e => update("outputFormat", e.target.value)} placeholder={t("skillBuilder.outputPlaceholder")} rows={6} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={5} icon="📖" title="Examples" hint={t("skillBuilder.hintExamples")} accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.examples} onChange={e => update("examples", e.target.value)} placeholder={t("skillBuilder.examplesPlaceholder")} rows={5} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={6} icon="🛡️" title="Guardrails" hint={t("skillBuilder.hintGuardrails")} accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.guardrails} onChange={e => update("guardrails", e.target.value)} placeholder={t("skillBuilder.guardrailsPlaceholder")} rows={5} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={7} icon="✅" title="Validation" hint={t("skillBuilder.hintValidation")} accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.validation} onChange={e => update("validation", e.target.value)} placeholder={t("skillBuilder.validationPlaceholder")} rows={5} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  <StepCard number={8} icon="🏗️" title="Build Log" hint={t("skillBuilder.hintBuildLog")} accent={accent} accentLight={theme.accentLight} accentBorder={border}>
                    <textarea value={form.buildLog} onChange={e => update("buildLog", e.target.value)} placeholder={t("skillBuilder.buildLogPlaceholder")} rows={6} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 resize-none" style={{ lineHeight: 1.6, "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                  </StepCard>
                  </>
                  )}
                </div>
              )
            )}

            {/* ── Test Tab ── */}
            {tab === "test" && (
              <div className="p-5 space-y-4 pb-24">
                {!selectedPath ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3"><span className="text-4xl">▶️</span><p className="text-sm text-stone-400">請先選擇或建立一個 Skill</p></div>
                ) : (
                  <>
                    <div className="border rounded-2xl overflow-hidden bg-white" style={{ borderColor: accent + "30" }}>
                      <div className="px-4 py-2.5 border-b" style={{ borderColor: accent + "15", background: theme.accentLight + "30" }}>
                        <span className="text-sm font-bold" style={{ color: accentText }}>▶️ 測試輸入</span>
                        <span className="ml-2 text-sm text-stone-400">{form.name || form.id}</span>
                      </div>
                      <div className="p-4 space-y-3">
                        {form.inputs.length > 0 ? form.inputs.map(inp => {
                          const isOutputPath = inp.id === "output_path";
                          const fixedTestPath = `data/skills/building/${form.id || "untitled"}/test-output`;
                          return (
                          <div key={inp.id}>
                            <label className="block text-sm font-medium text-stone-600 mb-1">{inp.label} {inp.required && <span className="text-rose-400">*</span>}{isOutputPath && <span className="ml-1 text-stone-400 font-normal">（測試固定：{fixedTestPath}）</span>}</label>
                            {inp.multiline && !isOutputPath ? (
                              <textarea value={testInputs[inp.id] || ""} onChange={e => setTestInputs(prev => ({ ...prev, [inp.id]: e.target.value }))} placeholder={inp.placeholder || `輸入 ${inp.label}...`} rows={3} className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 resize-none" style={{ "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                            ) : (
                              <input type="text" value={isOutputPath ? fixedTestPath : (testInputs[inp.id] || "")} onChange={e => { if (!isOutputPath) setTestInputs(prev => ({ ...prev, [inp.id]: e.target.value })); }} readOnly={isOutputPath} placeholder={inp.placeholder || `輸入 ${inp.label}...`} className={"w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2" + (isOutputPath ? " bg-stone-50 text-stone-500" : "")} style={{ "--tw-ring-color": accent + "30" } as React.CSSProperties} />
                            )}
                          </div>
                          );
                        }) : <p className="text-sm text-stone-400">這個 Skill 沒有定義輸入欄位，直接按「執行測試」。</p>}
                      </div>
                    </div>

                    {showPromptPreview && (
                      <div className="border border-stone-200 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2 bg-stone-50 border-b border-stone-200">
                          <span className="text-xs font-semibold text-stone-600">📋 送給 AI 的完整提示詞</span>
                          <button onClick={() => { navigator.clipboard?.writeText(buildTestPrompt()); }} className="text-sm text-stone-400 hover:text-stone-600">{t("knowledge.copy")}</button>
                        </div>
                        <pre className="p-4 text-xs text-stone-700 overflow-auto max-h-64 whitespace-pre-wrap leading-relaxed">{buildTestPrompt()}</pre>
                      </div>
                    )}

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
                    className="px-4 py-2 text-sm font-bold rounded-xl text-white transition-all shadow-sm"
                    style={!canBuild ? { background: "#e7e5e4", color: "#a8a29e" } : { background: `linear-gradient(135deg, ${accent}, ${accentHover})` }}>
                    🔨 Build
                  </button>
                  <button onClick={handlePreviewPrompt}
                    className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50"
                    title="查看完整提示詞">
                    📋 Prompt
                  </button>
                  {chatStarted && <button onClick={() => { setChatStarted(false); setInitialPrompt(undefined); setConsoleKey(p => p + 1); }} className="ml-auto px-3 py-1.5 text-[11px] rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50">✕ 重置</button>}
                </>
              )}
              {tab === "test" && (
                <div className="flex items-center gap-3">
                  <button onClick={handleTest} disabled={!canTest || testRunning}
                    className="px-4 py-2 text-sm font-bold rounded-xl text-white transition-all shadow-sm flex items-center gap-2"
                    style={!canTest || testRunning ? { background: "#e7e5e4", color: "#a8a29e" } : { background: `linear-gradient(135deg, ${accent}, ${accentHover})` }}>
                    {testRunning && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {testRunning ? `${t("skillBuilder.testRunning")} ${testElapsed}s` : t("skillBuilder.runTest")}
                  </button>
                  <button onClick={() => setShowPromptPreview(!showPromptPreview)}
                    className="px-3 py-2 text-sm font-medium rounded-xl border border-stone-200 hover:bg-stone-50 transition-all flex items-center gap-1.5 text-stone-600">
                    📋 預覽提示詞
                  </button>
                  <button onClick={handlePublish} disabled={!canPublish || publishStatus === "publishing"}
                    className="ml-auto px-4 py-2.5 text-sm font-bold rounded-xl transition-all shadow-sm"
                    style={!canPublish || publishStatus === "publishing"
                      ? { background: "#e7e5e4", color: "#a8a29e" }
                      : publishStatus === "done" ? { background: "#16a34a", color: "#fff" }
                      : publishStatus === "error" ? { background: "#dc2626", color: "#fff" }
                      : { background: "#fff", color: accent, border: `1.5px solid ${accent}` }}>
                    {publishStatus === "publishing" ? t("skillBuilder.publishing")
                      : publishStatus === "done" ? t("skillBuilder.published")
                      : publishStatus === "error" ? t("skillBuilder.publishFailed")
                      : "🚀 發佈"}
                  </button>
                  {hasEmptyRequired && !testRunning && <span className="text-[11px] text-rose-400">⚠️ 請填寫所有必填欄位</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ━━ Right Panel ━━ */}
        <div className="flex flex-col flex-1 min-w-0" style={{ backgroundColor: "#1e1e2e" }}>

          {/* Builder: interactive Agent — always mounted, hidden via display */}
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
              <AgentConsole ref={terminalRef} key={`sb-${consoleKey}-${model}`} cwd={workingDir || undefined} model={model || undefined} initialPrompt={initialPrompt} systemPrompt={buildSystemPrompt} />
            )}
          </div>

          {/* Test: spinner → file list + content viewer — always mounted, hidden via display */}
          <div style={{ display: tab === "test" ? "flex" : "none" }} className="flex-col flex-1 min-h-0">
            {testRunning ? (
              /* ── Running: spinner with elapsed ── */
              <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                <div className="relative">
                  <div className="w-16 h-16 border-4 rounded-full animate-spin" style={{ borderColor: accent + "30", borderTopColor: accent }} />
                  <span className="absolute inset-0 flex items-center justify-center text-base font-bold" style={{ color: accent }}>{testElapsed}</span>
                </div>
                <div className="text-center">
                  <p className="text-stone-300 text-sm font-medium">AI 正在執行 Skill 測試</p>
                  <p className="text-stone-500 text-xs mt-1">等待產出結果檔案...</p>
                </div>
              </div>
            ) : outputFiles.length > 0 ? (
              /* ── Done: file list (top) + content viewer (bottom) ── */
              <div className="flex flex-col h-full">
                {/* File List Bar */}
                <div className="shrink-0 border-b border-stone-700">
                  <div className="px-3 py-2 flex items-center gap-2 border-b border-stone-700/50">
                    <span className="text-xs font-bold text-stone-300">📁 輸出檔案</span>
                    <span className="text-xs text-stone-500">{outputFiles.length} files</span>
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
                  <p className="text-stone-400 text-sm">填入輸入，按 <strong className="text-white">{t("skillBuilder.runTest")}</strong></p>
                  <p className="text-stone-500 text-xs mt-2">AI 會把結果存到 test-output 目錄，完成後自動顯示</p>
                </div>
              </div>
            )
            }
          </div>
        </div>
      </div>

      {/* Prompt Preview Modal */}
      {promptPreview && promptPreviewContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setPromptPreview(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden" style={{ maxHeight: "80vh" }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: theme.accentBorder, backgroundColor: theme.accentBg }}>
              <h2 className="text-lg font-bold" style={{ color: theme.accentText }}>📋 Prompt 預覽</h2>
              <button onClick={() => setPromptPreview(false)} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">&times;</button>
            </div>
            {/* Content */}
            <div className="overflow-auto p-6 space-y-5" style={{ maxHeight: "calc(80vh - 64px)" }}>
              <fieldset className="space-y-2">
                <legend onClick={() => setShowSystemPrompt(v => !v)} className="text-sm font-bold border-b pb-1 w-full cursor-pointer select-none flex items-center gap-2" style={{ color: theme.accentText, borderColor: theme.accentBorder }}>
                  <span>🟢 System Prompt</span>
                  <span className="text-stone-400 font-normal">({promptPreviewContent.system.length} chars)</span>
                  <span className="ml-auto text-stone-400">{showSystemPrompt ? "▼" : "▶"}</span>
                </legend>
                {showSystemPrompt && (
                  <pre className="text-sm whitespace-pre-wrap break-words bg-stone-50 rounded-lg p-4 border border-stone-200 overflow-auto" style={{ maxHeight: "30vh", lineHeight: 1.7, fontFamily: "ui-monospace, monospace" }}>{promptPreviewContent.system}</pre>
                )}
              </fieldset>
              <fieldset className="space-y-2">
                <legend onClick={() => setShowUserPrompt(v => !v)} className="text-sm font-bold border-b pb-1 w-full cursor-pointer select-none flex items-center gap-2" style={{ color: theme.accentText, borderColor: theme.accentBorder }}>
                  <span>🟡 User Prompt</span>
                  <span className="text-stone-400 font-normal">({promptPreviewContent.prompt.length} chars)</span>
                  <span className="ml-auto text-stone-400">{showUserPrompt ? "▼" : "▶"}</span>
                </legend>
                {showUserPrompt && (
                  <pre className="text-sm whitespace-pre-wrap break-words bg-stone-50 rounded-lg p-4 border border-stone-200 overflow-auto" style={{ maxHeight: "30vh", lineHeight: 1.7, fontFamily: "ui-monospace, monospace" }}>{promptPreviewContent.prompt}</pre>
                )}
              </fieldset>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
