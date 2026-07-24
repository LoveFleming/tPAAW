import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../utils";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";

import API from "../api";

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

interface HeaderRow {
  key: string;
  value: string;
}

// ── JSON Textarea with string-state + blur validation ──
function JsonEditor({
  label,
  value,
  onChange,
  placeholder,
  rows = 6,
  error,
  setError,
  t,
}: {
  label?: string;
  value: string;
  onChange: (parsed: Record<string, any>) => void;
  placeholder?: string;
  rows?: number;
  error: string;
  setError: (e: string) => void;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <div>
      {label && <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{label}</span>}
      <textarea
        className="block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm font-mono bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
        style={{ borderColor: error ? "#ef4444" : undefined }}
        value={value}
        onChange={e => { /* update string immediately */ }}
        onBlur={(e) => {
          try {
            const parsed = JSON.parse(e.target.value);
            onChange(parsed);
            setError("");
          } catch (err: any) {
            setError(err.message);
          }
        }}
        rows={rows}
        placeholder={placeholder}
      />
      {error && <p className="mt-1 text-xs text-red-500">JSON 格式錯誤：{error}</p>}
    </div>
  );
}

// ── Main Component ──
export default function ToolBuilder() {
  const { t } = useI18n();
  const { info: ti } = useTheme();

  const [step, setStep] = useState<Step>(1);
  const [tools, setTools] = useState<ToolProvider[]>([]);
  const [templates, setTemplates] = useState<ToolTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  // Step 2 form — structured state
  const [toolId, setToolId] = useState("");
  const [toolName, setToolName] = useState("");
  const [toolDesc, setToolDesc] = useState("");
  const [toolIcon, setToolIcon] = useState("🔧");
  const [toolRunner, setToolRunner] = useState("api");
  const [toolParams, setToolParams] = useState<Record<string, any>>({ type: "object", properties: {} });
  const [toolApi, setToolApi] = useState<Record<string, any>>({ method: "POST", url: "", headers: { "Content-Type": "application/json" }, body: {} });
  const [toolConfig, setToolConfig] = useState<Record<string, any>>({});
  const [toolTags, setToolTags] = useState<string[]>([]);

  // Editable string state for JSON fields (so user can type freely)
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([{ key: "Content-Type", value: "application/json" }]);
  const [bodyStr, setBodyStr] = useState("{}");
  const [bodyError, setBodyError] = useState("");
  const [configStr, setConfigStr] = useState("{}");
  const [configError, setConfigError] = useState("");
  const [paramsStr, setParamsStr] = useState('{\n  "type": "object",\n  "properties": {}\n}');
  const [paramsError, setParamsError] = useState("");

  // Manager
  const [showManager, setShowManager] = useState(false);
  const [testingTool, setTestingTool] = useState<string | null>(null);
  const [testParams, setTestParams] = useState<Record<string, any>>({});
  const [testResult, setTestResult] = useState<any>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configToolId, setConfigToolId] = useState<string | null>(null);
  const [configToolName, setConfigToolName] = useState("");

  // ── Load tools & templates ──
  const loadTools = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/tools`);
      const data = await res.json();
      setTools(data.tools || []);
    } catch (err) {
      console.error("Failed to load tools:", err);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/tools/templates`);
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err) {
      console.error("Failed to load templates:", err);
    }
  }, []);

  useEffect(() => {
    loadTools();
    loadTemplates();
  }, [loadTools, loadTemplates]);

  // ── Header rows ↔ toolApi.headers sync ──
  const syncHeadersToApi = useCallback((rows: HeaderRow[]) => {
    const hdrs: Record<string, string> = {};
    for (const r of rows) {
      if (r.key.trim()) hdrs[r.key.trim()] = r.value;
    }
    setToolApi(prev => ({ ...prev, headers: hdrs }));
  }, []);

  const updateHeaderRow = (idx: number, field: "key" | "value", val: string) => {
    setHeaderRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      syncHeadersToApi(next);
      return next;
    });
  };

  const addHeaderRow = () => {
    setHeaderRows(prev => {
      const next = [...prev, { key: "", value: "" }];
      syncHeadersToApi(next);
      return next;
    });
  };

  const removeHeaderRow = (idx: number) => {
    setHeaderRows(prev => {
      const next = prev.filter((_, i) => i !== idx);
      syncHeadersToApi(next);
      return next;
    });
  };

  // ── Template selection ──
  const handleSelectTemplate = (templateId: string) => {
    const tmpl = templates.find(t => t.id === templateId);
    if (tmpl) {
      setToolId(tmpl.id);
      setToolName(tmpl.toolDef.name || "");
      setToolDesc(tmpl.toolDef.description || tmpl.description);
      setToolIcon(tmpl.icon);
      setToolRunner(tmpl.toolDef.runner || "api");

      const params = tmpl.toolDef.parameters || { type: "object", properties: {} };
      setToolParams(params);
      setParamsStr(JSON.stringify(params, null, 2));
      setParamsError("");

      const api = tmpl.toolDef.api || { method: "POST", url: "", headers: {}, body: {} };
      setToolApi(api);
      const hdrs = api.headers || {};
      setHeaderRows(Object.entries(hdrs).map(([k, v]) => ({ key: k, value: String(v) })));
      const bdy = api.body || {};
      setBodyStr(JSON.stringify(bdy, null, 2));
      setBodyError("");

      const cfg = tmpl.toolDef.config || {};
      setToolConfig(cfg);
      setConfigStr(JSON.stringify(cfg, null, 2));
      setConfigError("");

      setToolTags(tmpl.toolDef.tags || []);
    }
    setStep(2);
  };

  // ── Create tool ──
  const handleCreate = async () => {
    if (!toolId || !toolName) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: toolId,
          name: toolName,
          description: toolDesc,
          runner: toolRunner,
          parameters: toolParams,
          api: toolRunner === "api" ? toolApi : undefined,
          config: toolConfig,
          icon: toolIcon,
          tags: toolTags,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(t("toolBuilder.createFailed", "建立失敗") + ": " + (data.error || ""));
        return;
      }
      await loadTools();
      setStep(3);
    } catch (err: any) {
      alert(t("toolBuilder.createFailed", "建立失敗") + ": " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  // ── Toggle enable/disable ──
  const handleToggle = async (tid: string) => {
    try {
      await fetch(`${API}/api/tools/${tid}/toggle`, { method: "POST" });
      await loadTools();
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  // ── Delete tool ──
  const handleDelete = async (tid: string) => {
    if (!confirm(t("toolBuilder.confirmDelete", "確定要刪除這個 Tool 嗎？"))) return;
    try {
      await fetch(`${API}/api/tools/${tid}`, { method: "DELETE" });
      await loadTools();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // ── Test tool ──
  const handleTest = async (tid: string) => {
    setTestingTool(tid);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/api/tools/${tid}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: testParams }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message });
    }
  };

  // ── Save config ──
  const handleSaveConfig = async () => {
    if (!configToolId) return;
    try {
      await fetch(`${API}/api/tools/${configToolId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configValues),
      });
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
    setConfigToolName(tool.name);
    fetch(`${API}/api/tools/${tool.id}`)
      .then(r => r.json())
      .then((detail: any) => {
        const vals: Record<string, string> = {};
        const schema = detail.configSchema || tool.configSchema;
        for (const key of Object.keys(schema)) {
          vals[key] = detail.config?.[key] || "";
        }
        setConfigValues(vals);
        setShowConfigModal(true);
      })
      .catch(() => {
        setConfigValues({});
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
    <div className="flex flex-col h-full bg-stone-50 dark:bg-stone-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-center gap-3">
          <span className="text-xl">🔧</span>
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
            {t("toolBuilder.title", "Tool Builder")}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={cn("px-3 py-1.5 text-sm rounded-md border transition-colors", showManager ? "font-semibold" : "")}
            style={{
              background: showManager ? ti.accentBg : "transparent",
              color: showManager ? ti.accent : "#78716c",
              borderColor: showManager ? ti.accent : "#d6d3d1",
            }}
            onClick={() => setShowManager(!showManager)}
          >
            {t("toolBuilder.manager", "管理 Tools")}
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded-md border transition-colors bg-transparent text-stone-500 border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-900"
            onClick={() => {
              setShowManager(false);
              setStep(1);
              setToolId("");
              setToolName("");
              setToolDesc("");
              setToolIcon("🔧");
              setToolRunner("api");
              setToolParams({ type: "object", properties: {} });
              setToolApi({ method: "POST", url: "", headers: { "Content-Type": "application/json" }, body: {} });
              setToolConfig({});
              setToolTags([]);
              setHeaderRows([{ key: "Content-Type", value: "application/json" }]);
              setBodyStr("{}");
              setBodyError("");
              setConfigStr("{}");
              setConfigError("");
              setParamsStr('{\n  "type": "object",\n  "properties": {}\n}');
              setParamsError("");
            }}
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
          ti={ti}
        />
      ) : (
        /* ── Tool Builder Steps ── */
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Step indicator */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-stone-200 dark:border-stone-800">
            {steps.map((s, i) => (
              <React.Fragment key={s.n}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      background: step >= s.n ? ti.accent : "#e7e5e4",
                      color: step >= s.n ? "#fff" : "#a8a29e",
                    }}
                  >
                    {step > s.n ? "✓" : s.n}
                  </div>
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className="flex-1 h-px mx-2" style={{ background: step > s.n ? ti.accent : "#d6d3d1" }} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Step content */}
          <div className="flex-1 overflow-auto">
            {step === 1 && (
              <div className="p-6 max-w-3xl mx-auto">
                <h3 className="text-base font-semibold mb-4 text-stone-900 dark:text-stone-100">
                  {t("toolBuilder.selectService", "選擇要連接的服務")}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {templates.map(tmpl => (
                    <button
                      key={tmpl.id}
                      className="flex flex-col items-start p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 hover:shadow-md transition-all"
                      onClick={() => handleSelectTemplate(tmpl.id)}
                    >
                      <span className="text-2xl mb-2">{tmpl.icon}</span>
                      <span className="font-semibold text-sm text-stone-900 dark:text-stone-100">{tmpl.name}</span>
                      <span className="text-xs mt-1 text-stone-500 dark:text-stone-400">{tmpl.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="p-6 max-w-3xl mx-auto space-y-4">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {t("toolBuilder.configureTool", "設定 Tool")}
                </h3>

                {/* Basic info */}
                <div className="space-y-3 p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                    {t("toolBuilder.toolId", "Tool ID")}
                    <input
                      className="mt-1 block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                      value={toolId}
                      onChange={e => setToolId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
                      placeholder="例：discord"
                    />
                  </label>

                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                    {t("toolBuilder.toolName", "Tool 名稱")}
                    <input
                      className="mt-1 block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                      value={toolName}
                      onChange={e => setToolName(e.target.value)}
                      placeholder="例：discord_send"
                    />
                  </label>

                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                    {t("toolBuilder.description", "描述")}
                    <textarea
                      className="mt-1 block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                      value={toolDesc}
                      onChange={e => setToolDesc(e.target.value)}
                      rows={2}
                      placeholder="這個 Tool 做什麼..."
                    />
                  </label>

                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                    {t("toolBuilder.icon", "圖示")}
                    <input
                      className="mt-1 block w-16 px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm text-center bg-stone-50 dark:bg-stone-800"
                      value={toolIcon}
                      onChange={e => setToolIcon(e.target.value)}
                    />
                  </label>
                </div>

                {/* API config */}
                {toolRunner === "api" && (
                  <div className="space-y-3 p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
                    <h4 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
                      {t("toolBuilder.apiConfig", "API 設定")}
                    </h4>

                    <div className="grid grid-cols-4 gap-3">
                      <label className="col-span-1 text-sm font-medium text-stone-700 dark:text-stone-300">
                        Method
                        <select
                          className="mt-1 block w-full px-2 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                          value={toolApi.method}
                          onChange={e => setToolApi({ ...toolApi, method: e.target.value })}
                        >
                          <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                        </select>
                      </label>
                      <label className="col-span-3 text-sm font-medium text-stone-700 dark:text-stone-300">
                        URL
                        <input
                          className="mt-1 block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm font-mono bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                          value={toolApi.url}
                          onChange={e => setToolApi({ ...toolApi, url: e.target.value })}
                          placeholder="https://api.example.com/endpoint/{{param}}"
                        />
                      </label>
                    </div>

                    {/* Headers — key-value editor */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Headers</span>
                        <button
                          className="px-2 py-1 rounded text-xs border border-stone-300 dark:border-stone-600 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                          onClick={addHeaderRow}
                        >
                          + {t("toolBuilder.addHeader", "新增")}
                        </button>
                      </div>
                      <div className="space-y-2">
                        {headerRows.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              className="flex-1 px-2.5 py-1.5 rounded-md border border-stone-300 dark:border-stone-600 text-sm font-mono bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                              value={row.key}
                              onChange={e => updateHeaderRow(idx, "key", e.target.value)}
                              placeholder="Header name"
                            />
                            <input
                              className="flex-1 px-2.5 py-1.5 rounded-md border border-stone-300 dark:border-stone-600 text-sm font-mono bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                              value={row.value}
                              onChange={e => updateHeaderRow(idx, "value", e.target.value)}
                              placeholder="Value / {{…configKey}}"
                            />
                            <button
                              className="px-1.5 py-1 rounded text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                              onClick={() => removeHeaderRow(idx)}
                              title={t("toolBuilder.removeHeader", "刪除")}
                            >✕</button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Body — JSON with string state */}
                    <div>
                      <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                        Body (JSON)
                      </span>
                      <textarea
                        className="block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm font-mono bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                        style={{ borderColor: bodyError ? "#ef4444" : undefined }}
                        value={bodyStr}
                        onChange={e => {
                          setBodyStr(e.target.value);
                          setBodyError("");
                        }}
                        onBlur={() => {
                          try {
                            const parsed = JSON.parse(bodyStr);
                            setToolApi(prev => ({ ...prev, body: parsed }));
                            setBodyError("");
                          } catch (err: any) {
                            setBodyError(err.message);
                          }
                        }}
                        rows={6}
                      />
                      {bodyError && <p className="mt-1 text-xs text-red-500">JSON 格式錯誤：{bodyError}</p>}
                    </div>

                    <p className="text-xs text-stone-500">
                      {t("toolBuilder.templateHint", "用 {{參數名}} 代表 LLM 傳入的參數，{{…key}} 讀 config，{{@nanoid}}/{{@uuid}}/{{@timestamp}} 自動產生 ID")}
                    </p>
                  </div>
                )}

                {/* Config schema */}
                <div className="space-y-3 p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
                  <h4 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
                    {t("toolBuilder.configSchema", "Config 設定（API Key 等）")}
                  </h4>
                  <textarea
                    className="block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm font-mono bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                    style={{ borderColor: configError ? "#ef4444" : undefined }}
                    value={configStr}
                    onChange={e => {
                      setConfigStr(e.target.value);
                      setConfigError("");
                    }}
                    onBlur={() => {
                      try {
                        const parsed = JSON.parse(configStr);
                        setToolConfig(parsed);
                        setConfigError("");
                      } catch (err: any) {
                        setConfigError(err.message);
                      }
                    }}
                    rows={6}
                    placeholder='{"token": {"type": "string", "secret": true, "required": true, "description": "API Token"}}'
                  />
                  {configError && <p className="mt-1 text-xs text-red-500">JSON 格式錯誤：{configError}</p>}
                </div>

                {/* Parameters schema */}
                <div className="space-y-3 p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
                  <h4 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
                    {t("toolBuilder.parameters", "參數定義")}
                  </h4>
                  <textarea
                    className="block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm font-mono bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                    style={{ borderColor: paramsError ? "#ef4444" : undefined }}
                    value={paramsStr}
                    onChange={e => {
                      setParamsStr(e.target.value);
                      setParamsError("");
                    }}
                    onBlur={() => {
                      try {
                        const parsed = JSON.parse(paramsStr);
                        setToolParams(parsed);
                        setParamsError("");
                      } catch (err: any) {
                        setParamsError(err.message);
                      }
                    }}
                    rows={6}
                  />
                  {paramsError && <p className="mt-1 text-xs text-red-500">JSON 格式錯誤：{paramsError}</p>}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    className="px-4 py-2 rounded-md text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors"
                    onClick={() => setStep(1)}
                  >
                    ← {t("toolBuilder.back", "上一步")}
                  </button>
                  <button
                    className={cn("px-6 py-2 rounded-md text-sm font-semibold text-white transition-colors", loading && "opacity-50 cursor-not-allowed")}
                    style={{ background: ti.accent }}
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
                <h3 className="text-lg font-semibold mb-2 text-stone-900 dark:text-stone-100">
                  {t("toolBuilder.created", "Tool 已建立！")}
                </h3>
                <p className="text-sm mb-6 text-stone-500">
                  {t("toolBuilder.createdHint", "請在管理頁面填入 API Token 等設定值")}
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    className="px-4 py-2 rounded-md text-sm font-semibold text-white"
                    style={{ background: ti.accent }}
                    onClick={() => setShowManager(true)}
                  >
                    {t("toolBuilder.goConfig", "前往設定")}
                  </button>
                  <button
                    className="px-4 py-2 rounded-md text-sm text-stone-500 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 transition-colors"
                    onClick={() => { setStep(1); setToolId(""); setToolName(""); }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowConfigModal(false)}>
          <div
            className="w-full max-w-md p-6 rounded-xl shadow-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-4 text-stone-900 dark:text-stone-100">
              ⚙️ {t("toolBuilder.configTitle", "設定")} — {configToolName}
            </h3>
            {Object.entries(configValues).map(([key]) => (
              <label key={key} className="block mb-3">
                <span className="text-sm font-medium text-stone-700 dark:text-stone-300">{key}</span>
                <input
                  className="mt-1 block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                  type="password"
                  value={configValues[key] || ""}
                  onChange={e => setConfigValues({ ...configValues, [key]: e.target.value })}
                />
              </label>
            ))}
            {Object.keys(configValues).length === 0 && (
              <p className="text-sm text-stone-500">{t("toolBuilder.noConfig", "這個 Tool 不需要額外設定")}</p>
            )}
            <div className="flex items-center gap-3 mt-6">
              <button
                className="px-4 py-2 rounded-md text-sm font-semibold text-white"
                style={{ background: ti.accent }}
                onClick={handleSaveConfig}
              >
                {t("toolBuilder.saveConfig", "儲存")}
              </button>
              <button
                className="px-4 py-2 rounded-md text-sm text-stone-500 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 transition-colors"
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
  ti,
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
  ti: any;
}) {
  const [testParamsStr, setTestParamsStr] = useState("{}");

  if (tools.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-4xl mb-3">🔧</div>
          <p className="text-sm text-stone-500">{t("toolBuilder.noTools", "還沒有安裝任何 Tool")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-2">
      {tools.map(tool => (
        <div
          key={tool.id}
          className="flex items-center justify-between p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-xl">{tool.icon}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate text-stone-900 dark:text-stone-100">{tool.name}</span>
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    background: tool.enabled ? ti.accentBg : "#f5f5f4",
                    color: tool.enabled ? ti.accent : "#a8a29e",
                  }}
                >
                  {tool.enabled ? t("toolBuilder.enabled", "啟用") : t("toolBuilder.disabled", "停用")}
                </span>
                {!tool.configFilled && tool.enabled && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                    {t("toolBuilder.configNeeded", "需設定")}
                  </span>
                )}
              </div>
              <p className="text-xs truncate text-stone-500">
                {tool.description} · runner={tool.runner}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-4">
            <button
              className="px-2.5 py-1 rounded text-xs border border-stone-200 dark:border-stone-600 text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
              onClick={() => onConfig(tool)}
              title={t("toolBuilder.config", "設定")}
            >
              ⚙️
            </button>
            <button
              className="px-2.5 py-1 rounded text-xs border border-stone-200 dark:border-stone-600 text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
              onClick={() => { setTestResult(null); onTest(tool.id); }}
              title={t("toolBuilder.test", "測試")}
              disabled={!tool.enabled}
            >
              🧪
            </button>
            <button
              className="px-2.5 py-1 rounded text-xs border transition-colors"
              style={{
                borderColor: tool.enabled ? "#fca5a5" : "#e7e5e4",
                color: tool.enabled ? "#dc2626" : "#a8a29e",
              }}
              onClick={() => onToggle(tool.id)}
              title={tool.enabled ? t("toolBuilder.disable", "停用") : t("toolBuilder.enable", "啟用")}
            >
              {tool.enabled ? "⏸️" : "▶️"}
            </button>
            <button
              className="px-2.5 py-1 rounded text-xs border border-stone-200 dark:border-stone-600 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
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
        <div className="mt-4 p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
          <h4 className="text-sm font-semibold mb-3 text-stone-900 dark:text-stone-100">
            🧪 {t("toolBuilder.testTitle", "測試")} — {testingTool}
          </h4>
          <textarea
            className="block w-full px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 text-sm font-mono mb-3 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
            value={testParamsStr}
            onChange={e => setTestParamsStr(e.target.value)}
            onBlur={() => {
              try { setTestParams(JSON.parse(testParamsStr)); } catch {}
            }}
            rows={4}
            placeholder='{"channel": "123", "message": "Hello"}'
          />
          <button
            className="px-4 py-1.5 rounded-md text-sm font-semibold text-white"
            style={{ background: ti.accent }}
            onClick={() => onTest(testingTool)}
          >
            {t("toolBuilder.runTest", "執行測試")}
          </button>
          {testResult && (
            <pre className={cn("mt-3 p-3 rounded-md text-xs font-mono overflow-auto max-h-48", testResult.ok ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300")}>
              {JSON.stringify(testResult, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
