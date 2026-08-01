/**
 * AgentBuilder — Multi-step Custom Agent Creation Wizard
 *
 * Phase 4: AgentBuilder wizard
 * Step 1: Identity (id, codename, emoji, title, avatar)
 * Step 2: Personality (rolePrompt, expertise, guardrails, greeting)
 * Step 3: Capabilities (toolGroups, injectProjectContext, model)
 * Step 4: Preview & Create
 */
import React, { useState, useMemo, useEffect } from "react";
import { cn } from "../utils";
import API_BASE from "../api";

interface Provider {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

interface AgentBuilderProps {
  rootPath: string;
  theme: {
    bg: string;
    bgMuted: string;
    borderLight: string;
    border: string;
    accent: string;
    accentLight: string;
    accentText: string;
    text: string;
  };
  onClose: () => void;
  onCreated: (agentId: string) => void;
}

const TOOL_GROUPS = [
  { id: "core-read", name: "📖 核心讀取", desc: "讀檔案、目錄結構", tier: "basic" },
  { id: "core", name: "📖 核心讀寫", desc: "讀寫檔案、目錄結構", tier: "advanced" },
  { id: "memory", name: "💾 Memory", desc: "記憶讀寫", tier: "basic" },
  { id: "decisions", name: "📋 Decisions", desc: "決策記錄", tier: "basic" },
  { id: "project", name: "📂 Project Info", desc: "專案資訊、feature map", tier: "basic" },
  { id: "project-edit", name: "✏️ Project Edit", desc: "修改專案設定", tier: "advanced" },
  { id: "notes", name: "📝 Notes", desc: "筆記", tier: "basic" },
  { id: "tasks", name: "📌 Tasks", desc: "任務管理", tier: "basic" },
  { id: "docs", name: "📡 Docs", desc: "文檔生成", tier: "basic" },
  { id: "dispatch", name: "🚀 Dispatch", desc: "EM 調度權限", tier: "advanced" },
  { id: "browser", name: "🌐 Browser", desc: "瀏覽器操作", tier: "advanced" },
];

const EMOJI_CHOICES = ["🤖", "👩‍💻", "👨‍💻", "🧙", "🦸", "🕵️", "🎨", "📝", "🔧", "🔍", "⚡", "🌟", "🛡️", "📊", "🎯", "🧪", "📡", "🗂️", "💡", "🚀"];
const TITLE_CHOICES = ["Architect", "Developer", "Tester", "Reviewer", "Analyzer", "Writer", "Designer", "Researcher", "Consultant", "Specialist", "Engineer", "Operator"];

type WizardStep = 0 | 1 | 2 | 3;

export default function AgentBuilder({ rootPath, theme: t, onClose, onCreated }: AgentBuilderProps) {
  const [step, setStep] = useState<WizardStep>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);

  // ── Form state ──
  const [agentId, setAgentId] = useState("custom.");
  const [codename, setCodename] = useState("");
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("🤖");
  const [description, setDescription] = useState("");
  const [rolePrompt, setRolePrompt] = useState("");
  const [expertise, setExpertise] = useState("");
  const [greeting, setGreeting] = useState("");
  const [temperature, setTemperature] = useState(0.4);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [redirectRules, setRedirectRules] = useState("");
  const [refuseTopics, setRefuseTopics] = useState("");
  const [injectProjectContext, setInjectProjectContext] = useState(true);
  const [selectedTools, setSelectedTools] = useState<string[]>(["core-read", "memory", "project"]);
  const [modelChoice, setModelChoice] = useState(""); // empty = global default

  // ── Load providers for model picker ──
  useEffect(() => {
    fetch(`${API_BASE}/api/models`).then(r => r.json()).then(data => {
      if (data.providers) setProviders(data.providers);
    }).catch(() => {});
  }, []);

  const modelOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string; group: string }> = [
      { value: "", label: "（使用全域預設）", group: "" },
    ];
    for (const p of providers) {
      for (const m of p.models) {
        opts.push({ value: `${p.id}/${m.id}`, label: m.name || m.id, group: p.name });
      }
    }
    const known = new Set(opts.map(o => o.value));
    const common = [
      { value: "zai/glm-5.1", label: "GLM 5.1 (zai)" },
      { value: "openrouter/z-ai/glm-5.1", label: "GLM 5.1 (OpenRouter)" },
      { value: "openrouter/deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    ];
    for (const c of common) {
      if (!known.has(c.value)) opts.push({ value: c.value, label: c.label, group: "Other" });
    }
    return opts;
  }, [providers]);

  // ── Auto-fill rolePrompt when codename changes (if user hasn't typed) ──
  useEffect(() => {
    if (!rolePrompt && codename) {
      setRolePrompt(`你是${codename}，一位專業的 AI 工程夥伴。\n\n你的專長是${expertise || "協助軟體開發相關工作"}。\n\n請用專業但親切的態度回答問題，並在需要時主動提供技術建議。`);
    }
  }, [codename]); // eslint-disable-line

  useEffect(() => {
    if (!greeting && codename) {
      setGreeting(`嗨！我是${codename} ${emoji}\n\n有什麼我可以幫忙的嗎？`);
    }
  }, [codename, emoji]); // eslint-disable-line

  // ── Toggle tool ──
  const toggleTool = (id: string) => {
    setSelectedTools(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  // ── Quick templates ──
  const templates = [
    {
      name: "Code Reviewer",
      icon: "🔍",
      apply: () => {
        setCodename("張大明 Daoming Zhang");
        setTitle("Reviewer");
        setEmoji("🔍");
        setDescription("客製化 Code Review Agent，擅長審查程式碼品質與安全性");
        setExpertise("Code Review\nSecurity Analysis\nBest Practices\nClean Code");
        setSelectedTools(["core-read", "memory", "project", "decisions"]);
        setRedirectRules("實作程式碼修改 → Developer\n寫測試 → Tester");
        setRefuseTopics("非程式碼相關問題");
      },
    },
    {
      name: "DevOps Engineer",
      icon: "🚀",
      apply: () => {
        setCodename("陳志遠 Zhiyuan Chen");
        setTitle("DevOps");
        setEmoji("🚀");
        setDescription("DevOps 自動化專家，負責 CI/CD、部署、監控");
        setExpertise("CI/CD Pipeline\nDocker / Kubernetes\nMonitoring\nShell Scripting");
        setSelectedTools(["core", "memory", "project", "project-edit", "tasks"]);
        setRedirectRules("寫程式碼 → Developer\n寫文件 → Doc Writer");
        setRefuseTopics("非技術問題");
      },
    },
    {
      name: "Data Analyst",
      icon: "📊",
      apply: () => {
        setCodename("李雅婷 Yating Li");
        setTitle("Analyst");
        setEmoji("📊");
        setDescription("資料分析師，擅長從數據中萃取洞見");
        setExpertise("Data Analysis\nSQL\nVisualization\nStatistical Analysis");
        setSelectedTools(["core-read", "memory", "project", "docs"]);
        setRedirectRules("需要修改程式 → Developer");
        setRefuseTopics("非資料相關問題");
      },
    },
    {
      name: "Security Auditor",
      icon: "🛡️",
      apply: () => {
        setCodename("王建國 Jianguo Wang");
        setTitle("Security");
        setEmoji("🛡️");
        setDescription("安全性審計專家，負責弱點掃描與修復建議");
        setExpertise("Security Audit\nVulnerability Assessment\nOWASP Top 10\nPenetration Testing");
        setSelectedTools(["core-read", "memory", "project", "decisions", "tasks"]);
        setRedirectRules("修復安全問題 → Developer\n寫測試 → Tester");
        setRefuseTopics("非安全相關問題");
      },
    },
  ];

  // ── Validation per step ──
  const stepErrors = useMemo(() => {
    const errs: string[] = [];
    if (step === 0) {
      if (!agentId.startsWith("custom.") || agentId === "custom.") errs.push("ID 必須以 custom. 開頭");
      if (!agentId.match(/^custom\.[a-z0-9-]+$/)) errs.push("ID 只能用小寫英文、數字、連字號");
      if (!codename.trim()) errs.push("請輸入名字 (Codename)");
      if (!title.trim()) errs.push("請選擇角色 Title");
    }
    if (step === 1) {
      if (rolePrompt.trim().length < 20) errs.push("Role Prompt 至少需要 20 字");
    }
    return errs;
  }, [step, agentId, codename, title, rolePrompt]);

  const canAdvance = stepErrors.length === 0;

  // ── Create agent ──
  const handleCreate = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/crew?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: agentId,
          codename,
          title,
          emoji,
          description,
          rolePrompt,
          expertise,
          injectProjectContext,
          toolGroups: selectedTools,
          chatConfig: { greeting, temperature, maxTokens },
          guardrails: { redirectRules, refuseTopics },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onCreated(data.id);
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  };

  const steps = ["身份", "個性", "能力", "預覽"];
  const inputCls = "w-full px-3 py-2 text-sm border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-200";
  const inputStyle = { borderColor: t.borderLight };
  const labelCls = "text-xs font-semibold text-stone-600 mb-1 block";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: t.borderLight }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{emoji}</span>
            <div>
              <h2 className="text-lg font-bold text-stone-800">建立新 Agent</h2>
              <p className="text-xs text-stone-400">AgentBuilder Wizard — 4 步驟建立你的 AI 夥伴</p>
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl px-2">✕</button>
        </div>

        {/* Progress bar */}
        <div className="shrink-0 px-6 py-3 border-b" style={{ borderColor: t.borderLight }}>
          <div className="flex items-center gap-2">
            {steps.map((label, i) => (
              <React.Fragment key={i}>
                <div className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                  i === step ? "text-white shadow-sm" : i < step ? "text-white opacity-70" : "text-stone-400 bg-stone-100"
                )}
                style={i <= step ? { backgroundColor: t.accent } : {}}>
                  <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px]",
                    i === step ? "bg-white/25" : i < step ? "bg-white/25" : "bg-stone-300 text-white")}>
                    {i < step ? "✓" : i + 1}
                  </span>
                  {label}
                </div>
                {i < steps.length - 1 && (
                  <div className="flex-1 h-px" style={{ backgroundColor: i < step ? t.accent : t.borderLight }} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* ════ Step 0: Identity ════ */}
          {step === 0 && (
            <div className="space-y-5">
              {/* Quick templates */}
              <div>
                <label className={labelCls}>⚡ 快速範本（可選）</label>
                <div className="grid grid-cols-4 gap-2">
                  {templates.map(tpl => (
                    <button key={tpl.name} onClick={tpl.apply}
                      className="p-3 border rounded-lg hover:border-emerald-300 hover:bg-emerald-50/50 transition-all text-center group"
                      style={{ borderColor: t.borderLight }}>
                      <div className="text-xl mb-1 group-hover:scale-110 transition-transform">{tpl.icon}</div>
                      <div className="text-xs font-medium text-stone-600">{tpl.name}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>
                    Agent ID
                    <span className="text-stone-400 font-normal ml-1">（唯一識別碼）</span>
                  </label>
                  <input value={agentId} onChange={e => setAgentId(e.target.value)}
                    placeholder="custom.reviewer"
                    className={cn(inputCls, "font-mono")} style={inputStyle} />
                </div>
                <div>
                  <label className={labelCls}>Emoji</label>
                  <div className="flex gap-1 flex-wrap">
                    <input value={emoji} onChange={e => setEmoji(e.target.value)}
                      className={cn(inputCls, "text-center text-lg w-14 px-1")} style={inputStyle} maxLength={4} />
                    <div className="flex flex-wrap gap-0.5 max-w-[180px]">
                      {EMOJI_CHOICES.slice(0, 10).map(e => (
                        <button key={e} onClick={() => setEmoji(e)}
                          className={cn("w-7 h-7 rounded text-base hover:bg-stone-100 transition-colors",
                            emoji === e ? "bg-emerald-100 ring-1 ring-emerald-300" : "")}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>名字 (Codename)</label>
                  <input value={codename} onChange={e => setCodename(e.target.value)}
                    placeholder="張大明 Daoming Zhang"
                    className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <label className={labelCls}>角色 Title</label>
                  <input value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="Reviewer"
                    className={inputCls} style={inputStyle} list="title-suggestions" />
                  <datalist id="title-suggestions">
                    {TITLE_CHOICES.map(tl => <option key={tl} value={tl} />)}
                  </datalist>
                </div>
              </div>

              <div>
                <label className={labelCls}>描述</label>
                <input value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="一句話描述這個 Agent 的用途"
                  className={inputCls} style={inputStyle} />
              </div>
            </div>
          )}

          {/* ════ Step 1: Personality ════ */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className={labelCls}>
                  Role Prompt（系統提示詞）
                  <span className="text-stone-400 font-normal ml-2">{rolePrompt.length} chars</span>
                </label>
                <textarea value={rolePrompt} onChange={e => setRolePrompt(e.target.value)}
                  rows={10}
                  className="w-full px-3 py-2 text-xs border rounded-lg resize-y font-mono"
                  style={inputStyle}
                  placeholder="你是 XXX，一位專業的..." />
                <p className="text-[11px] text-stone-400 mt-1">
                  💡 定義 Agent 的核心身份、語氣、行為模式
                </p>
              </div>

              <div>
                <label className={labelCls}>專業能力</label>
                <textarea value={expertise} onChange={e => setExpertise(e.target.value)}
                  rows={3}
                  className={cn(inputCls, "resize-none")} style={inputStyle}
                  placeholder="Code Review&#10;Security Analysis&#10;Best Practices" />
              </div>

              <div>
                <label className={labelCls}>問候語 (Greeting)</label>
                <textarea value={greeting} onChange={e => setGreeting(e.target.value)}
                  rows={3}
                  className={cn(inputCls, "resize-none")} style={inputStyle}
                  placeholder="嗨！我是..." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>
                    Temperature
                    <span className="text-stone-400 font-normal ml-1">({temperature.toFixed(1)})</span>
                  </label>
                  <input type="range" min="0" max="1" step="0.1"
                    value={temperature}
                    onChange={e => setTemperature(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500" />
                  <div className="flex justify-between text-[10px] text-stone-400">
                    <span>精確</span><span>平衡</span><span>創意</span>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Max Tokens</label>
                  <select value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value))}
                    className={inputCls} style={inputStyle}>
                    <option value={2048}>2,048</option>
                    <option value={4096}>4,096</option>
                    <option value={8192}>8,192</option>
                    <option value={16384}>16,384</option>
                    <option value={32768}>32,768</option>
                  </select>
                </div>
              </div>

              {/* Guardrails */}
              <div className="border rounded-lg overflow-hidden" style={{ borderColor: t.borderLight }}>
                <div className="px-3 py-2 bg-stone-50 border-b text-xs font-semibold text-stone-600" style={{ borderColor: t.borderLight }}>
                  🛡️ Guardrails（護欄）
                </div>
                <div className="p-3 space-y-3">
                  <div>
                    <label className={labelCls}>轉導規則</label>
                    <textarea value={redirectRules} onChange={e => setRedirectRules(e.target.value)}
                      rows={2}
                      className="w-full px-2 py-1.5 text-xs border rounded resize-none" style={inputStyle}
                      placeholder="實作程式碼 → Developer&#10;寫測試 → Tester" />
                  </div>
                  <div>
                    <label className={labelCls}>拒絕主題</label>
                    <textarea value={refuseTopics} onChange={e => setRefuseTopics(e.target.value)}
                      rows={2}
                      className="w-full px-2 py-1.5 text-xs border rounded resize-none" style={inputStyle}
                      placeholder="非技術問題" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════ Step 2: Capabilities ════ */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Project context */}
              <div className={cn("rounded-lg border p-3 transition-colors", injectProjectContext ? "bg-emerald-50 border-emerald-200" : "")}
                style={!injectProjectContext ? { borderColor: t.borderLight } : {}}>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={injectProjectContext}
                    onChange={e => setInjectProjectContext(e.target.checked)}
                    className="w-4 h-4 accent-emerald-500" />
                  <div>
                    <div className="text-sm font-semibold text-stone-700">📂 專案知識注入</div>
                    <div className="text-[11px] text-stone-400">自動注入 .paaw/ 下的專案文檔到 system prompt</div>
                  </div>
                </label>
              </div>

              {/* Tool Groups */}
              <div>
                <label className={labelCls}>
                  🔧 Tool Groups（資料存取權限）
                  <span className="text-stone-400 font-normal ml-2">{selectedTools.length} 個已啟用</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {TOOL_GROUPS.map(tg => {
                    const enabled = selectedTools.includes(tg.id);
                    const isAdvanced = tg.tier === "advanced";
                    return (
                      <label key={tg.id}
                        className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-all",
                          enabled ? "bg-indigo-50 border-indigo-200 shadow-sm" : "hover:bg-stone-50")}
                        style={!enabled ? { borderColor: t.borderLight } : {}}>
                        <input type="checkbox" checked={enabled} onChange={() => toggleTool(tg.id)}
                          className="w-3.5 h-3.5 accent-indigo-500" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-stone-700 flex items-center gap-1">
                            {tg.name}
                            {isAdvanced && <span className="text-[8px] px-1 py-0.5 rounded bg-amber-100 text-amber-600 font-bold">ADV</span>}
                          </div>
                          <div className="text-[10px] text-stone-400 truncate">{tg.desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Model selection */}
              <div>
                <label className={labelCls}>🤖 模型選擇</label>
                <select value={modelChoice} onChange={e => setModelChoice(e.target.value)}
                  className={cn(inputCls, "bg-white")} style={inputStyle}>
                  {modelOptions.map(m => <option key={m.value || "_default"} value={m.value}>{m.group ? `[${m.group}] ` : ""}{m.label}</option>)}
                </select>
                <p className="text-[11px] text-stone-400 mt-1">
                  留空 = 使用全域預設模型。之後可在 CrewManager → 模型 tab 修改。
                </p>
              </div>

              {/* Quick presets */}
              <div className="flex gap-2">
                <button onClick={() => setSelectedTools(["core-read", "memory", "project"])}
                  className="text-xs px-3 py-1.5 rounded-lg border hover:bg-stone-50 transition-colors text-stone-500"
                  style={{ borderColor: t.borderLight }}>
                  📖 唯讀模式
                </button>
                <button onClick={() => setSelectedTools(["core", "memory", "project", "project-edit", "tasks", "decisions"])}
                  className="text-xs px-3 py-1.5 rounded-lg border hover:bg-stone-50 transition-colors text-stone-500"
                  style={{ borderColor: t.borderLight }}>
                  ✏️ 完整存取
                </button>
                <button onClick={() => setSelectedTools(["core-read", "memory", "project", "docs"])}
                  className="text-xs px-3 py-1.5 rounded-lg border hover:bg-stone-50 transition-colors text-stone-500"
                  style={{ borderColor: t.borderLight }}>
                  📝 文檔模式
                </button>
              </div>
            </div>
          )}

          {/* ════ Step 3: Preview ════ */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full text-4xl mb-3"
                  style={{ backgroundColor: (t.accent || "#10b981") + "15", border: `3px solid ${(t.accent || "#10b981")}33` }}>
                  {emoji}
                </div>
                <h3 className="text-lg font-bold text-stone-800">{codename}</h3>
                <p className="text-sm text-stone-400">{title} · <code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded">{agentId}</code></p>
                <p className="text-sm text-stone-500 mt-1 max-w-md mx-auto">{description || "(無描述)"}</p>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-stone-50 rounded-lg border" style={{ borderColor: t.borderLight }}>
                  <div className="font-semibold text-stone-600 mb-1">🧠 專業能力</div>
                  <div className="text-stone-500 whitespace-pre-wrap">{expertise || "(未設定)"}</div>
                </div>
                <div className="p-3 bg-stone-50 rounded-lg border" style={{ borderColor: t.borderLight }}>
                  <div className="font-semibold text-stone-600 mb-1">🔧 Tool Groups</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedTools.map(tg => (
                      <span key={tg} className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded">{tg}</span>
                    ))}
                  </div>
                </div>
                <div className="p-3 bg-stone-50 rounded-lg border" style={{ borderColor: t.borderLight }}>
                  <div className="font-semibold text-stone-600 mb-1">📂 專案知識</div>
                  <div className="text-stone-500">{injectProjectContext ? "✅ 注入" : "❌ 不注入"}</div>
                </div>
                <div className="p-3 bg-stone-50 rounded-lg border" style={{ borderColor: t.borderLight }}>
                  <div className="font-semibold text-stone-600 mb-1">🤖 模型</div>
                  <div className="text-stone-500">{modelChoice || "全域預設"}</div>
                </div>
              </div>

              {/* Role prompt preview */}
              <div className="p-3 bg-stone-50 rounded-lg border" style={{ borderColor: t.borderLight }}>
                <div className="font-semibold text-stone-600 mb-1 text-xs">
                  📝 Role Prompt <span className="text-stone-400 font-normal">({rolePrompt.length} chars)</span>
                </div>
                <pre className="text-xs text-stone-500 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">{rolePrompt}</pre>
              </div>

              {error && (
                <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  ❌ {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: t.borderLight }}>
          <div className="flex items-center gap-2">
            {stepErrors.map((err, i) => (
              <span key={i} className="text-xs text-red-400">⚠️ {err}</span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={() => setStep((step - 1) as WizardStep)}
                className="px-4 py-2 text-sm text-stone-500 hover:bg-stone-100 rounded-lg transition-colors">
                ← 上一步
              </button>
            )}
            {step < 3 ? (
              <button onClick={() => setStep((step + 1) as WizardStep)} disabled={!canAdvance}
                className="px-5 py-2 text-sm font-bold text-white rounded-lg transition-opacity"
                style={{ backgroundColor: t.accent, opacity: canAdvance ? 1 : 0.4 }}>
                下一步 →
              </button>
            ) : (
              <button onClick={handleCreate} disabled={saving}
                className="px-5 py-2 text-sm font-bold text-white rounded-lg"
                style={{ backgroundColor: t.accent, opacity: saving ? 0.6 : 1 }}>
                {saving ? "建立中..." : `✨ 建立 ${codename}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
