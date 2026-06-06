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
  systemPrompt: string;   // The prompt body (below frontmatter)
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
  systemPrompt: "",
  tags: "",
  visibility: "private",
};

// ── Markdown ↔ SkillForm conversion ──

function parseSkillMd(content: string): SkillForm {
  const form = { ...EMPTY_SKILL };

  // Parse frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    form.systemPrompt = content.trim();
    return form;
  }

  const fm = fmMatch[1];
  form.systemPrompt = content.slice(fmMatch[0].length).trim();

  // Simple YAML-like parser for frontmatter
  const lines = fm.split("\n");
  for (const line of lines) {
    const m = line.match(/^(\w+):\s*(.*)/);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = rawVal.trim();

    if (key === "id") form.id = val;
    else if (key === "name") form.name = val;
    else if (key === "version") form.version = val;
    else if (key === "description") form.description = val;
    else if (key === "runner") form.runner = val as SkillForm["runner"];
    else if (key === "tags") form.tags = val;
    else if (key === "visibility") form.visibility = val as SkillForm["visibility"];
  }

  // Parse userInputs array
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

  return form;
}

function buildSkillMd(form: SkillForm): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${form.id || "untitled"}`);
  lines.push(`name: ${form.name || "Untitled"}`);
  lines.push(`version: ${form.version || "1.0.0"}`);
  if (form.description) lines.push(`description: ${form.description}`);
  lines.push(`runner: ${form.runner}`);
  if (form.visibility) lines.push(`visibility: ${form.visibility}`);
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
  if (form.systemPrompt) lines.push(form.systemPrompt);
  return lines.join("\n");
}

// ── Section Component ──
function Section({ title, icon, children, collapsible, defaultOpen = true }: {
  title: string; icon: string; children: React.ReactNode;
  collapsible?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-stone-200 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-stone-50 hover:bg-stone-100 transition-colors text-left"
        onClick={() => collapsible && setOpen(!open)}
      >
        <span>{icon}</span>
        <span className="text-sm font-bold text-stone-700">{title}</span>
        {collapsible && (
          <span className="ml-auto text-stone-400 text-xs">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && <div className="px-4 py-3 space-y-3">{children}</div>}
    </div>
  );
}

// ── Field Row ──
function FieldRow({ label, children, hint }: {
  label: string; children: React.ReactNode; hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-stone-400 mt-0.5">{hint}</p>}
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
    fetch(`${API_BASE}/api/tagent-root`)
      .then(r => r.ok ? r.json() : {})
      .then((d: { tagentRoot?: string }) => { if (d.tagentRoot) setWorkingDir(d.tagentRoot); })
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
      const content = buildSkillMd(f);
      await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(selectedPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setSaveStatus("saved");
    } catch { setSaveStatus("dirty"); }
  }, [selectedPath]);

  // Auto-save debounce
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

  // Update form field helper
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

  // Select file
  const handleSelectFile = (path: string) => {
    setSelectedPath(path);
    loadFile(path);
  };

  // New file
  const handleCreate = async () => {
    const name = newFileName.trim();
    if (!name) return;
    const slug = name.replace(/\.md$/, "").replace(/\s+/g, "-").toLowerCase().replace(/^build-/, "");
    const fileName = name.endsWith(".md") ? name : `build-${slug}.md`;
    const fullPath = `${workingDir || "."}/skills/building/${fileName}`;

    const newForm: SkillForm = {
      ...EMPTY_SKILL,
      id: slug,
      name: name.replace(/\.md$/, ""),
    };
    const content = buildSkillMd(newForm);

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

  // Send to terminal
  const handleBuild = () => {
    setSending(true);
    const prompt = buildSkillMd(form);
    if (!chatStarted) {
      setInitialPrompt(prompt);
      setChatStarted(true);
      setConsoleKey(prev => prev + 1);
    } else {
      terminalRef.current?.sendPrompt(prompt);
    }
    setTimeout(() => setSending(false), 300);
  };

  // ── Render ──
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: "#fafaf9" }}>
      {/* ── Header ── */}
      <div className="shrink-0 px-4 py-2 border-b flex items-center gap-3" style={{ borderColor: "#e7e5e4" }}>
        <span className="text-lg">🔨</span>
        <h2 className="text-sm font-bold text-stone-800">Skill Builder</h2>

        {/* File selector */}
        <div className="flex items-center gap-1.5">
          <select
            value={selectedPath}
            onChange={e => handleSelectFile(e.target.value)}
            className="text-xs px-2 py-1 border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-200"
            style={{ minWidth: 220 }}
          >
            <option value="">-- {t("common.select", "選擇")} Skill --</option>
            {files.map(f => (
              <option key={f.path} value={f.path}>{f.name}</option>
            ))}
          </select>
          <button
            onClick={() => { setShowNewDialog(true); setNewFileName(""); }}
            className="px-2 py-1 text-xs font-medium rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
          >
            ＋ Build New Skill
          </button>
          {saveStatus === "saving" && <span className="text-[10px] text-amber-500">💾</span>}
          {saveStatus === "saved" && selectedPath && <span className="text-[10px] text-green-500">✓ saved</span>}
          {saveStatus === "dirty" && <span className="text-[10px] text-rose-500">● unsaved</span>}
        </div>

        {/* CLI selector */}
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] font-medium text-stone-500">CLI:</label>
          <select value={cli} onChange={e => setCli(e.target.value as typeof cli)}
            className="text-xs px-2 py-1 border border-stone-200 rounded-lg bg-white">
            <option value="qwen">Qwen</option>
            <option value="claude">Claude Code</option>
            <option value="opencode">OpenCode</option>
          </select>
        </div>

        {/* Build button */}
        <button
          onClick={handleBuild}
          disabled={!form.id || !form.systemPrompt}
          className={cn(
            "ml-auto px-4 py-1.5 text-xs font-bold rounded-lg transition-colors",
            form.id && form.systemPrompt
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-stone-200 text-stone-400 cursor-not-allowed"
          )}
        >
          🔨 Build Skill
        </button>

        {chatStarted && (
          <button
            onClick={() => { setChatStarted(false); setInitialPrompt(undefined); setConsoleKey(prev => prev + 1); }}
            className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50"
          >
            ✕ Reset
          </button>
        )}
      </div>

      {/* ── New File Dialog ── */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowNewDialog(false)}>
          <div className="bg-white rounded-xl shadow-2xl border border-stone-200 w-96 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-stone-800 mb-3">📄 建立新的 Skill</h3>
            <p className="text-xs text-stone-500 mb-2">檔案會建立在 <code className="bg-stone-100 px-1 rounded">skills/building/</code></p>
            <input
              type="text" value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
              placeholder="skill 名稱，例：root-cause（檔案會自動命名為 build-root-cause.md）"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 mb-3"
              autoFocus
            />
            {!newFileName.endsWith(".md") && newFileName.trim() && (
              <p className="text-[10px] text-stone-400 mb-2">→ build-{newFileName.trim().replace(/\s+/g, "-").toLowerCase().replace(/^build-/, "")}.md</p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewDialog(false)} className="px-3 py-1.5 text-xs rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">{t("common.cancel")}</button>
              <button onClick={handleCreate} disabled={!newFileName.trim()}
                className={cn("px-4 py-1.5 text-xs font-bold rounded-lg", newFileName.trim() ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-stone-200 text-stone-400")}>
                {t("common.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Body: Form (left) + Terminal (right) ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Skill Builder Form */}
        <div className="flex flex-col border-r overflow-y-auto" style={{ width: "50%", borderColor: "#e7e5e4", backgroundColor: "#fff" }}>
          {!selectedPath ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
              <span className="text-3xl">🔨</span>
              <p className="text-stone-400 text-sm text-center">選擇或建立一個 Skill 開始</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* ── Basic Info ── */}
              <Section title="基本資訊" icon="📋">
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Skill ID">
                    <input type="text" value={form.id}
                      onChange={e => update("id", e.target.value.replace(/\s+/g, "-").toLowerCase())}
                      placeholder="例：root-cause"
                      className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 font-mono" />
                  </FieldRow>
                  <FieldRow label="名稱">
                    <input type="text" value={form.name}
                      onChange={e => update("name", e.target.value)}
                      placeholder="例：Root Cause Analysis"
                      className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </FieldRow>
                  <FieldRow label="版本">
                    <input type="text" value={form.version}
                      onChange={e => update("version", e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 font-mono" />
                  </FieldRow>
                  <FieldRow label="Runner 類型">
                    <select value={form.runner} onChange={e => update("runner", e.target.value as SkillForm["runner"])}
                      className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100">
                      <option value="prompt">🎓 Prompt (LLM)</option>
                      <option value="data">📊 Data (Auto CRUD)</option>
                      <option value="api">🌐 API (HTTP)</option>
                      <option value="script">⚙️ Script (JS Sandbox)</option>
                    </select>
                  </FieldRow>
                </div>
                <FieldRow label="描述">
                  <textarea value={form.description}
                    onChange={e => update("description", e.target.value)}
                    placeholder="這個 skill 做什麼？"
                    rows={2}
                    className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none" />
                </FieldRow>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Tags">
                    <input type="text" value={form.tags}
                      onChange={e => update("tags", e.target.value)}
                      placeholder="tag1, tag2, tag3"
                      className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </FieldRow>
                  <FieldRow label="Visibility">
                    <select value={form.visibility} onChange={e => update("visibility", e.target.value as SkillForm["visibility"])}
                      className="w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100">
                      <option value="private">🔒 Private</option>
                      <option value="team">👥 Team</option>
                      <option value="public">🌐 Public</option>
                    </select>
                  </FieldRow>
                </div>
              </Section>

              {/* ── Input Fields ── */}
              <Section title={`輸入欄位 (${form.inputs.length})`} icon="📝">
                {form.inputs.length === 0 && (
                  <p className="text-xs text-stone-400 text-center py-2">尚無欄位，點下方按鈕新增</p>
                )}
                {form.inputs.map((inp, idx) => (
                  <div key={idx} className="border border-stone-100 rounded-lg p-3 space-y-2 bg-stone-50/50 relative group">
                    <button
                      onClick={() => removeInput(idx)}
                      className="absolute top-2 right-2 text-stone-300 hover:text-rose-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    >✕</button>
                    <div className="grid grid-cols-3 gap-2">
                      <FieldRow label="ID">
                        <input type="text" value={inp.id}
                          onChange={e => updateInput(idx, { id: e.target.value.replace(/\s+/g, "_").toLowerCase() })}
                          placeholder="field_id"
                          className="w-full px-2 py-1 text-xs border border-stone-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-200 font-mono" />
                      </FieldRow>
                      <FieldRow label="Label">
                        <input type="text" value={inp.label}
                          onChange={e => updateInput(idx, { label: e.target.value })}
                          placeholder="欄位名稱"
                          className="w-full px-2 py-1 text-xs border border-stone-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-200" />
                      </FieldRow>
                      <FieldRow label="類型">
                        <div className="flex gap-2 mt-0.5">
                          <label className="flex items-center gap-1 text-[10px]">
                            <input type="checkbox" checked={inp.required}
                              onChange={e => updateInput(idx, { required: e.target.checked })} />
                            必填
                          </label>
                          <label className="flex items-center gap-1 text-[10px]">
                            <input type="checkbox" checked={inp.multiline}
                              onChange={e => updateInput(idx, { multiline: e.target.checked })} />
                            多行
                          </label>
                        </div>
                      </FieldRow>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <FieldRow label="說明">
                        <input type="text" value={inp.description}
                          onChange={e => updateInput(idx, { description: e.target.value })}
                          placeholder="這個欄位收集什麼？"
                          className="w-full px-2 py-1 text-xs border border-stone-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-200" />
                      </FieldRow>
                      <FieldRow label="Placeholder">
                        <input type="text" value={inp.placeholder}
                          onChange={e => updateInput(idx, { placeholder: e.target.value })}
                          placeholder="輸入提示..."
                          className="w-full px-2 py-1 text-xs border border-stone-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-200" />
                      </FieldRow>
                    </div>
                  </div>
                ))}
                <button onClick={addInput}
                  className="w-full py-2 text-xs font-medium text-blue-600 border border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition-colors">
                  ＋ 新增欄位
                </button>
              </Section>

              {/* ── System Prompt / Skill Body ── */}
              <Section title="Skill Prompt" icon="🧠" collapsible defaultOpen={true}>
                <FieldRow label="系統提示 / Skill 指令" hint="這是 skill 的核心邏輯，會成為 markdown 檔案 frontmatter 下方的內容">
                  <textarea value={form.systemPrompt}
                    onChange={e => update("systemPrompt", e.target.value)}
                    placeholder={"輸入這個 skill 的執行邏輯...\n\n例：\n1. 分析使用者輸入的錯誤訊息\n2. 搜尋相關 log\n3. 產生結構化報告"}
                    rows={12}
                    className="w-full px-3 py-2 text-sm font-mono border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                    style={{ lineHeight: 1.6 }}
                    spellCheck={false} />
                </FieldRow>
              </Section>

              {/* ── Preview ── */}
              <Section title="Markdown 預覽" icon="📄" collapsible defaultOpen={false}>
                <pre className="text-xs font-mono text-stone-600 bg-stone-50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto border border-stone-100">
                  {buildSkillMd(form)}
                </pre>
              </Section>
            </div>
          )}
        </div>

        {/* Right: Terminal */}
        <div className="flex flex-col flex-1 min-w-0" style={{ backgroundColor: "#1a1a2e" }}>
          {!chatStarted ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
              <span className="text-4xl">🔨</span>
              <p className="text-stone-400 text-sm text-center">
                填好表單後按 <strong>🔨 Build Skill</strong> 送出給 AI
              </p>
              <p className="text-stone-500 text-xs text-center">AI 會根據你的定義生成完整 skill</p>
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
