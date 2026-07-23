import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../utils";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import AgentConsole, { AgentConsoleHandle } from "../components/AgentConsole";
import API from "../api";
import ModelSelector from "../components/ModelSelector";

// ── Types ──
type Step = 1 | 2 | 3;

interface ToolProvider {
  id: string;
  name: string;
  description: string;
  runner: string;
  icon: string;
  enabled: boolean;
  configFilled: boolean;
  parameters: Record<string, any>;
  configSchema: Record<string, any>;
  tags: string[];
  dir: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ToolTemplate {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  toolDef: Record<string, any>;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
}

// ── Main Component ──
export default function ToolBuilder() {
  const { t } = useI18n();
  const themeInfo = useTheme();
  const accent = themeInfo.accent;
  const accentBg = themeInfo.accentBg;

  const [step, setStep] = useState<Step>(1);
  const [tools, setTools] = useState<ToolProvider[]>([]);
  const [templates, setTemplates] = useState<ToolTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 2 form
  const [toolId, setToolId] = useState("");
  const [toolName, setToolName] = useState("");
  const [toolDesc, setToolDesc] = useState("");
  const [toolIcon, setToolIcon] = useState("🔧");
  const [toolRunner, setToolRunner] = useState("api");
  const [toolParams, setToolParams] = useState<Record<string, any>>({ type: "object", properties: {} });
  const [toolApi, setToolApi] = useState<Record<string, any>>({ method: "POST", url: "", headers: { "Content-Type": "application/json" }, body: {} });
  const [toolConfig, setToolConfig] = useState<Record<string, any>>({});
  const [toolTags, setToolTags] = useState<string[]>([]);

  // Manager
  const [showManager, setShowManager] = useState(false);
  const [editingTool, setEditingTool] = useState<ToolProvider | null>(null);
  const [testingTool, setTestingTool] = useState<string | null>(null);
  const [testParams, setTestParams] = useState<Record<string, any>>({});
  const [testResult, setTestResult] = useState<any>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configToolId, setConfigToolId] = useState<string | null>(null);

  // AI Console
  const consoleRef = useRef<AgentConsoleHandle>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  // ── Load tools & templates ──
  const loadTools = useCallback(async () => {
    try {
      const res = await API.get("/api/tools");
      setTools(res.tools || []);
    } catch (err) {
      console.error("Failed to load tools:", err);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await API.get("/api/tools/templates");
      setTemplates(res.templates || []);
    } catch (err) {
      console.error("Failed to load templates:", err);
    }
  }, []);

  useEffect(() => {
    loadTools();
    loadTemplates();
  }, [loadTools, loadTemplates]);

  // ── Template selection ──
  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tmpl = templates.find(t => t.id === templateId);
    if (tmpl) {
      setToolId(tmpl.id);
      setToolName(tmpl.toolDef.name || "");
      setToolDesc(tmpl.toolDef.description || tmpl.description);
      setToolIcon(tmpl.icon);
      setToolRunner(tmpl.toolDef.runner || "api");
      setToolParams(tmpl.toolDef.parameters || { type: "object", properties: {} });
      setToolApi(tmpl.toolDef.api || { method: "POST", url: "", headers: {}, body: {} });
      setToolConfig(tmpl.toolDef.config || {});
      setToolTags(tmpl.toolDef.tags || []);
    }
    setStep(2);
  };

  // ── Create tool ──
  const handleCreate = async () => {
    if (!toolId || !toolName) return;
    setLoading(true);
    try {
      await API.post("/api/tools", {
        id: toolId,
        name: toolName,
        description: toolDesc,
        runner: toolRunner,
        parameters: toolParams,
        api: toolRunner === "api" ? toolApi : undefined,
        config: toolConfig,
        icon: toolIcon,
        tags: toolTags,
      });
      await loadTools();
      setStep(3);
    } catch (err: any) {
      alert(t("toolBuilder.createFailed", "建立失敗") + ": " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  // ── Toggle enable/disable ──
  const handleToggle = async (toolId: string) => {
    try {
      await API.post(`/api/tools/${toolId}/toggle`);
      await loadTools();
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  // ── Delete tool ──
  const handleDelete = async (toolId: string) => {
    if (!confirm(t("toolBuilder.confirmDelete", "確定要刪除這個 Tool 嗎？"))) return;
    try {
      await API.delete(`/api/tools/${toolId}`);
      await loadTools();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // ── Test tool ──
  const handleTest = async (toolId: string) => {
    setTestingTool(toolId);
    setTestResult(null);
    try {
      const res = await API.post(`/api/tools/${toolId}/test`, { params: testParams });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message });
    }
  };

  // ── Save config ──
  const handleSaveConfig = async () => {
    if (!configToolId) return;
    try {
      await API.put(`/api/tools/${configToolId}/config`, configValues);
      setShowConfigModal(false);
      setConfigToolId(null);
      await loadTools();
    } catch (err) {
      console.error("Save config failed:", err);
    }
  };

  // ── Open config modal ──
  const openConfigModal = (tool: ToolProvider) => {
    setConfigToolId(tool.id);
    // Load current config values
    API.get(`/api/tools/${tool.id}`).then((detail: any) => {
      const currentConfig = detail.config || {};
      setConfigValues(currentConfig);
      setShowConfigModal(true);
    });
  };

  // ── Step indicator ──
  const steps = [
    { n: 1, label: t("toolBuilder.step1", "選擇服務") },
    { n: 2, label: t("toolBuilder.step2", "設定 Tool") },
    { n: 3, label: t("toolBuilder.step3", "完成") },
  ];

  // ── Render ──
  return (
    <div className="flex flex-col h-full" style={{ background: themeInfo.bg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: themeInfo.border }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">🔧</span>
          <h2 className="text-lg font-semibold" style={{ color: themeInfo.fg }}>
            {t("toolBuilder.title", "Tool Builder")}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={cn("px-3 py-1.5 text-sm rounded-md border transition-colors", showManager ? "font-semibold" : "")}
            style={{
              background: showManager ? accentBg : "transparent",
              color: showManager ? accent : themeInfo.fgMuted,
              borderColor: showManager ? accent : themeInfo.border,
            }}
            onClick={() => setShowManager(!showManager)}
          >
            {t("toolBuilder.manager", "管理 Tools")}
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded-md border transition-colors"
            style={{ background: "transparent", color: themeInfo.fgMuted, borderColor: themeInfo.border }}
            onClick={() => { setShowManager(false); setStep(1); setSelectedTemplate(null); }}
          >
            + {t("toolBuilder.newTool", "新增 Tool")}
          </button>
        </div>
      </div>

      {showManager ? (
        /* ── Tool Manager ── */
        <ToolManager
          tools={tools}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onTest={handleTest}
          onConfig={openConfigModal}
          testingTool={testingTool}
          testParams={testParams}
          setTestParams={setTestParams}
          testResult={testResult}
          setTestResult={setTestResult}
          t={t}
          themeInfo={themeInfo}
          accent={accent}
          accentBg={accentBg}
        />
      ) : (
        /* ── Tool Builder Steps ── */
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Step indicator */}
          <div className="flex items-center gap-2 px-6 py-3 border-b" style={{ borderColor: themeInfo.border }}>
            {steps.map((s, i) => (
              <React.Fragment key={s.n}>
                <div className="flex items-center gap-2">
                  <div
                    className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold", step >= s.n ? "" : "")}
                    style={{
                      background: step >= s.n ? accent : themeInfo.bgSubtle,
                      color: step >= s.n ? "#fff" : themeInfo.fgMuted,
                    }}
                  >
                    {step > s.n ? "✓" : s.n}
                  </div>
                  <span className="text-sm" style={{ color: step >= s.n ? themeInfo.fg : themeInfo.fgMuted }}>
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className="flex-1 h-px mx-2" style={{ background: step > s.n ? accent : themeInfo.border }} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Step content */}
          <div className="flex-1 overflow-auto">
            {step === 1 && (
              <div className="p-6 max-w-3xl mx-auto">
                <h3 className="text-base font-semibold mb-4" style={{ color: themeInfo.fg }}>
                  {t("toolBuilder.selectService", "選擇要連接的服務")}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {templates.map(tmpl => (
                    <button
                      key={tmpl.id}
                      className="flex flex-col items-start p-4 rounded-lg border transition-all hover:shadow-md"
                      style={{
                        background: selectedTemplate === tmpl.id ? accentBg : themeInfo.cardBg,
                        borderColor: selectedTemplate === tmpl.id ? accent : themeInfo.border,
                        color: themeInfo.fg,
                      }}
                      onClick={() => handleSelectTemplate(tmpl.id)}
                    >
                      <span className="text-2xl mb-2">{tmpl.icon}</span>
                      <span className="font-semibold text-sm">{tmpl.name}</span>
                      <span className="text-xs mt-1" style={{ color: themeInfo.fgMuted }}>{tmpl.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="p-6 max-w-3xl mx-auto space-y-4">
                <h3 className="text-base font-semibold" style={{ color: themeInfo.fg }}>
                  {t("toolBuilder.configureTool", "設定 Tool")}
                </h3>

                {/* Basic info */}
                <div className="space-y-3 p-4 rounded-lg border" style={{ background: themeInfo.cardBg, borderColor: themeInfo.border }}>
                  <label className="block text-sm font-medium" style={{ color: themeInfo.fg }}>
                    {t("toolBuilder.toolId", "Tool ID")}
                    <input
                      className="mt-1 block w-full px-3 py-2 rounded-md border text-sm"
                      style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                      value={toolId}
                      onChange={e => setToolId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
                      placeholder="例：discord"
                    />
                  </label>

                  <label className="block text-sm font-medium" style={{ color: themeInfo.fg }}>
                    {t("toolBuilder.toolName", "Tool 名稱")}
                    <input
                      className="mt-1 block w-full px-3 py-2 rounded-md border text-sm"
                      style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                      value={toolName}
                      onChange={e => setToolName(e.target.value)}
                      placeholder="例：discord_send"
                    />
                  </label>

                  <label className="block text-sm font-medium" style={{ color: themeInfo.fg }}>
                    {t("toolBuilder.description", "描述")}
                    <textarea
                      className="mt-1 block w-full px-3 py-2 rounded-md border text-sm"
                      style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                      value={toolDesc}
                      onChange={e => setToolDesc(e.target.value)}
                      rows={2}
                      placeholder="這個 Tool 做什麼..."
                    />
                  </label>

                  <label className="block text-sm font-medium" style={{ color: themeInfo.fg }}>
                    {t("toolBuilder.icon", "圖示")}
                    <input
                      className="mt-1 block w-16 px-3 py-2 rounded-md border text-sm text-center"
                      style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                      value={toolIcon}
                      onChange={e => setToolIcon(e.target.value)}
                    />
                  </label>
                </div>

                {/* API config (runner=api) */}
                {toolRunner === "api" && (
                  <div className="space-y-3 p-4 rounded-lg border" style={{ background: themeInfo.cardBg, borderColor: themeInfo.border }}>
                    <h4 className="text-sm font-semibold" style={{ color: themeInfo.fg }}>
                      {t("toolBuilder.apiConfig", "API 設定")}
                    </h4>

                    <div className="grid grid-cols-4 gap-3">
                      <label className="col-span-1 text-sm font-medium" style={{ color: themeInfo.fg }}>
                        Method
                        <select
                          className="mt-1 block w-full px-2 py-2 rounded-md border text-sm"
                          style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                          value={toolApi.method}
                          onChange={e => setToolApi({ ...toolApi, method: e.target.value })}
                        >
                          <option>GET</option>
                          <option>POST</option>
                          <option>PUT</option>
                          <option>PATCH</option>
                          <option>DELETE</option>
                        </select>
                      </label>
                      <label className="col-span-3 text-sm font-medium" style={{ color: themeInfo.fg }}>
                        URL
                        <input
                          className="mt-1 block w-full px-3 py-2 rounded-md border text-sm font-mono"
                          style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                          value={toolApi.url}
                          onChange={e => setToolApi({ ...toolApi, url: e.target.value })}
                          placeholder="https://api.example.com/endpoint/{{param}}"
                        />
                      </label>
                    </div>

                    <label className="block text-sm font-medium" style={{ color: themeInfo.fg }}>
                      Headers (JSON)
                      <textarea
                        className="mt-1 block w-full px-3 py-2 rounded-md border text-sm font-mono"
                        style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                        value={JSON.stringify(toolApi.headers, null, 2)}
                        onChange={e => { try { setToolApi({ ...toolApi, headers: JSON.parse(e.target.value) }); } catch {} }}
                        rows={4}
                      />
                    </label>

                    <label className="block text-sm font-medium" style={{ color: themeInfo.fg }}>
                      Body (JSON)
                      <textarea
                        className="mt-1 block w-full px-3 py-2 rounded-md border text-sm font-mono"
                        style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                        value={JSON.stringify(toolApi.body, null, 2)}
                        onChange={e => { try { setToolApi({ ...toolApi, body: JSON.parse(e.target.value) }); } catch {} }}
                        rows={4}
                      />
                    </label>

                    <p className="text-xs" style={{ color: themeInfo.fgMuted }}>
                      {t("toolBuilder.templateHint", "用 {{參數名}} 代表 LLM 傳入的參數，用 {{…configKey}} 代表 config.json 裡的值")}
                    </p>
                  </div>
                )}

                {/* Config schema */}
                <div className="space-y-3 p-4 rounded-lg border" style={{ background: themeInfo.cardBg, borderColor: themeInfo.border }}>
                  <h4 className="text-sm font-semibold" style={{ color: themeInfo.fg }}>
                    {t("toolBuilder.configSchema", "Config 設定（API Key 等）")}
                  </h4>
                  <textarea
                    className="block w-full px-3 py-2 rounded-md border text-sm font-mono"
                    style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                    value={JSON.stringify(toolConfig, null, 2)}
                    onChange={e => { try { setToolConfig(JSON.parse(e.target.value)); } catch {} }}
                    rows={6}
                    placeholder='{"token": {"type": "string", "secret": true, "required": true, "description": "API Token"}}'
                  />
                </div>

                {/* Parameters schema */}
                <div className="space-y-3 p-4 rounded-lg border" style={{ background: themeInfo.cardBg, borderColor: themeInfo.border }}>
                  <h4 className="text-sm font-semibold" style={{ color: themeInfo.fg }}>
                    {t("toolBuilder.parameters", "參數定義")}
                  </h4>
                  <textarea
                    className="block w-full px-3 py-2 rounded-md border text-sm font-mono"
                    style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                    value={JSON.stringify(toolParams, null, 2)}
                    onChange={e => { try { setToolParams(JSON.parse(e.target.value)); } catch {} }}
                    rows={6}
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    className="px-4 py-2 rounded-md text-sm font-semibold transition-colors"
                    style={{ background: themeInfo.bgSubtle, color: themeInfo.fgMuted }}
                    onClick={() => setStep(1)}
                  >
                    ← {t("toolBuilder.back", "上一步")}
                  </button>
                  <button
                    className={cn("px-6 py-2 rounded-md text-sm font-semibold transition-colors", loading && "opacity-50 cursor-not-allowed")}
                    style={{ background: accent, color: "#fff" }}
                    onClick={handleCreate}
                    disabled={loading}
                  >
                    {loading ? t("toolBuilder.creating", "建立中...") : t("toolBuilder.create", "建立 Tool")}
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="p-6 max-w-2xl mx-auto text-center">
                <div className="text-5xl mb-4">✅</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: themeInfo.fg }}>
                  {t("toolBuilder.created", "Tool 已建立！")}
                </h3>
                <p className="text-sm mb-6" style={{ color: themeInfo.fgMuted }}>
                  {t("toolBuilder.createdHint", "請在管理頁面填入 API Token 等設定值")}
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    className="px-4 py-2 rounded-md text-sm font-semibold"
                    style={{ background: accent, color: "#fff" }}
                    onClick={() => { setShowManager(true); }}
                  >
                    {t("toolBuilder.goConfig", "前往設定")}
                  </button>
                  <button
                    className="px-4 py-2 rounded-md text-sm"
                    style={{ background: themeInfo.bgSubtle, color: themeInfo.fgMuted }}
                    onClick={() => { setStep(1); setSelectedTemplate(null); setToolId(""); setToolName(""); }}
                  >
                    {t("toolBuilder.createAnother", "再建一個")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Config Modal */}
      {showConfigModal && configToolId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-full max-w-md p-6 rounded-xl shadow-2xl" style={{ background: themeInfo.cardBg, color: themeInfo.fg }}>
            <h3 className="text-base font-semibold mb-4">
              ⚙️ {t("toolBuilder.configTitle", "設定")} — {configToolId}
            </h3>
            {Object.entries(configValues).map(([key, val]) => (
              <label key={key} className="block mb-3">
                <span className="text-sm font-medium">{key}</span>
                <input
                  className="mt-1 block w-full px-3 py-2 rounded-md border text-sm"
                  style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
                  type={typeof val === "string" && val.length > 20 ? "password" : "text"}
                  value={configValues[key] || ""}
                  onChange={e => setConfigValues({ ...configValues, [key]: e.target.value })}
                />
              </label>
            ))}
            {Object.keys(configValues).length === 0 && (
              <p className="text-sm" style={{ color: themeInfo.fgMuted }}>
                {t("toolBuilder.noConfig", "這個 Tool 不需要額外設定")}
              </p>
            )}
            <div className="flex items-center gap-3 mt-6">
              <button
                className="px-4 py-2 rounded-md text-sm font-semibold"
                style={{ background: accent, color: "#fff" }}
                onClick={handleSaveConfig}
              >
                {t("toolBuilder.saveConfig", "儲存")}
              </button>
              <button
                className="px-4 py-2 rounded-md text-sm"
                style={{ background: themeInfo.bgSubtle, color: themeInfo.fgMuted }}
                onClick={() => { setShowConfigModal(false); setConfigToolId(null); }}
              >
                {t("toolBuilder.cancel", "取消")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tool Manager Sub-component ──
function ToolManager({
  tools,
  onToggle,
  onDelete,
  onTest,
  onConfig,
  testingTool,
  testParams,
  setTestParams,
  testResult,
  setTestResult,
  t,
  themeInfo,
  accent,
  accentBg,
}: {
  tools: ToolProvider[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onConfig: (tool: ToolProvider) => void;
  testingTool: string | null;
  testParams: Record<string, any>;
  setTestParams: (v: Record<string, any>) => void;
  testResult: any;
  setTestResult: (v: any) => void;
  t: (key: string, fallback?: string) => string;
  themeInfo: any;
  accent: string;
  accentBg: string;
}) {
  if (tools.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-4xl mb-3">🔧</div>
          <p className="text-sm" style={{ color: themeInfo.fgMuted }}>
            {t("toolBuilder.noTools", "還沒有安裝任何 Tool")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-2">
      {tools.map(tool => (
        <div
          key={tool.id}
          className="flex items-center justify-between p-4 rounded-lg border"
          style={{ background: themeInfo.cardBg, borderColor: themeInfo.border }}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-xl">{tool.icon}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate" style={{ color: themeInfo.fg }}>
                  {tool.name}
                </span>
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    background: tool.enabled ? accentBg : themeInfo.bgSubtle,
                    color: tool.enabled ? accent : themeInfo.fgMuted,
                  }}
                >
                  {tool.enabled ? t("toolBuilder.enabled", "啟用") : t("toolBuilder.disabled", "停用")}
                </span>
                {!tool.configFilled && tool.enabled && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: "#fef3c7", color: "#92400e" }}>
                    {t("toolBuilder.configNeeded", "需設定")}
                  </span>
                )}
              </div>
              <p className="text-xs truncate" style={{ color: themeInfo.fgMuted }}>
                {tool.description} · runner={tool.runner}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-4">
            <button
              className="px-2.5 py-1 rounded text-xs border transition-colors"
              style={{ background: "transparent", borderColor: themeInfo.border, color: themeInfo.fgMuted }}
              onClick={() => onConfig(tool)}
              title={t("toolBuilder.config", "設定")}
            >
              ⚙️
            </button>
            <button
              className="px-2.5 py-1 rounded text-xs border transition-colors"
              style={{ background: "transparent", borderColor: themeInfo.border, color: themeInfo.fgMuted }}
              onClick={() => { setTestResult(null); onTest(tool.id); }}
              title={t("toolBuilder.test", "測試")}
              disabled={!tool.enabled}
            >
              🧪
            </button>
            <button
              className="px-2.5 py-1 rounded text-xs border transition-colors"
              style={{
                background: "transparent",
                borderColor: tool.enabled ? "#fca5a5" : accentBg,
                color: tool.enabled ? "#dc2626" : accent,
              }}
              onClick={() => onToggle(tool.id)}
              title={tool.enabled ? t("toolBuilder.disable", "停用") : t("toolBuilder.enable", "啟用")}
            >
              {tool.enabled ? "⏸️" : "▶️"}
            </button>
            <button
              className="px-2.5 py-1 rounded text-xs border transition-colors hover:bg-red-50"
              style={{ background: "transparent", borderColor: themeInfo.border, color: "#dc2626" }}
              onClick={() => onDelete(tool.id)}
              title={t("toolBuilder.delete", "刪除")}
            >
              🗑️
            </button>
          </div>
        </div>
      ))}

      {/* Test panel */}
      {testingTool && (
        <div className="mt-4 p-4 rounded-lg border" style={{ background: themeInfo.cardBg, borderColor: themeInfo.border }}>
          <h4 className="text-sm font-semibold mb-3" style={{ color: themeInfo.fg }}>
            🧪 {t("toolBuilder.testTitle", "測試")} — {testingTool}
          </h4>
          <textarea
            className="block w-full px-3 py-2 rounded-md border text-sm font-mono mb-3"
            style={{ background: themeInfo.inputBg, borderColor: themeInfo.border, color: themeInfo.fg }}
            value={JSON.stringify(testParams, null, 2)}
            onChange={e => { try { setTestParams(JSON.parse(e.target.value)); } catch {} }}
            rows={4}
            placeholder='{"channel": "123", "message": "Hello"}'
          />
          <button
            className="px-4 py-1.5 rounded-md text-sm font-semibold"
            style={{ background: accent, color: "#fff" }}
            onClick={() => onTest(testingTool)}
          >
            {t("toolBuilder.runTest", "執行測試")}
          </button>
          {testResult && (
            <pre className="mt-3 p-3 rounded-md text-xs font-mono overflow-auto max-h-48" style={{ background: themeInfo.bgSubtle, color: testResult.ok ? "#16a34a" : "#dc2626" }}>
              {JSON.stringify(testResult, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
