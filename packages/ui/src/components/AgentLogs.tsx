import { useEffect, useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "";
type AgentTask = {
  taskId: string;
  agentId: string;
  prompt?: string; // deprecated
  model: string;
  cwd?: string;
  ruName?: string;
  startTime: string;
  durationMs: number;
  turns: number;
  status: string;
  stepCount: number;
  error: string | null;
  usage?: { prompt: number; completion: number; total: number } | null;
  costUsd?: number;
  models?: Array<{ model: string; prompt: number; completion: number; costUsd: number }>;
};

type RuSummaryRow = {
  ruName: string;
  tasks: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  byModel: Record<string, { tokensIn: number; tokensOut: number; costUsd: number }>;
};

type LogStep = {
  phase: string;
  _ts: number;
  stepId?: string;
  tool?: string;
  model?: string;
  duration?: number;
  turn?: number;
  messageCount?: number;
  contextTokens?: number;
  finishReason?: string;
  toolCallCount?: number;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  argsSummary?: string;
  resultLen?: number;
  resultPreview?: string;
  content?: string;
  totalDuration?: number;
  turns?: number;
  status?: string;
  error?: string;
};

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}

function fmtTokens(n?: number): string {
  if (!n) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(usd?: number): string {
  if (usd == null || usd === 0) return "-";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "text-emerald-600 bg-emerald-50",
  interrupted: "text-amber-600 bg-amber-50",
  error: "text-red-600 bg-red-50",
};

const PHASE_ICONS: Record<string, string> = {
  task_start: "🚀",
  task_end: "🏁",
  llm_start: "🧠",
  llm_end: "✅",
  tool_start: "🔧",
  tool_end: "✔️",
  thinking: "💭",
  thinking_end: "💭",
  error: "❌",
};

export default function AgentLogs() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [steps, setSteps] = useState<LogStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ agent: "", status: "" });
  const [ruSummary, setRuSummary] = useState<{ rows: RuSummaryRow[]; totalCostUsd: number } | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter.agent) params.set("agent", filter.agent);
      if (filter.status) params.set("status", filter.status);
      params.set("limit", "50");
      const r = await fetch(`${API_BASE}/api/agent-logs?${params}`);
      const data = await r.json();
      setTasks(data.items || []);
    } catch {}
  }, [filter]);

  const fetchRuSummary = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/agent-logs/ru-summary`);
      const data = await r.json();
      setRuSummary({ rows: data.rows || [], totalCostUsd: data.totalCostUsd || 0 });
    } catch {}
  }, []);

  const deleteRu = useCallback(async (ruName: string) => {
    if (!confirm(`確定刪除 ${ruName} 的所有執行記錄？`)) return;
    try {
      const r = await fetch(`${API_BASE}/api/agent-logs/ru/${encodeURIComponent(ruName)}`, { method: "DELETE" });
      const data = await r.json();
      if (data.ok) { fetchTasks(); fetchRuSummary(); }
      else { alert(data.error || "刪除失敗"); }
    } catch { alert("刪除失敗"); }
  }, [fetchTasks, fetchRuSummary]);

  useEffect(() => { fetchTasks(); fetchRuSummary(); }, [fetchTasks, fetchRuSummary]);

  const fetchDetail = useCallback(async (taskId: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/agent-logs/${taskId}`);
      const data = await r.json();
      setSteps(data.steps || []);
    } catch { setSteps([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selected) fetchDetail(selected);
  }, [selected, fetchDetail]);

  // Detail view
  if (selected) {
    const task = tasks.find(t => t.taskId === selected);
    return (
      <div className="p-4 space-y-3 h-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSelected(null)} className="px-3 py-1.5 text-sm rounded-lg bg-stone-100 hover:bg-stone-200 transition-colors">← 返回列表</button>
          {task && (
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <span className={`px-2 py-0.5 rounded font-medium ${STATUS_COLORS[task.status] || "text-stone-500 bg-stone-50"}`}>{task.status}</span>
              <span>{task.agentId}</span>
              <span>·</span>
              <span>{task.model}</span>
              <span>·</span>
              <span>{task.turns} turns</span>
              <span>·</span>
              <span>{fmtDuration(task.durationMs)}</span>
              <span>·</span>
              <span>{fmtTime(task.startTime)}</span>
            </div>
          )}
        </div>



        {/* Timeline */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-2 bg-stone-50 border-b border-stone-200 text-sm font-medium text-stone-600">
            執行時間線 ({steps.length} steps)
          </div>
          <div className="divide-y divide-stone-100 max-h-[60vh] overflow-y-auto">
            {loading && <div className="p-4 text-center text-stone-400 text-sm">載入中...</div>}
            {!loading && steps.map((step, i) => (
              <StepRow key={i} step={step} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="p-4 space-y-3 h-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-800">Agent 執行記錄</h2>
        <div className="flex items-center gap-2">
          <select value={filter.agent} onChange={e => setFilter(f => ({ ...f, agent: e.target.value }))} className="px-2 py-1 text-sm rounded border border-stone-300 bg-white">
            <option value="">全部 Agent</option>
            <option value="coding">coding</option>
            <option value="architect">architect</option>
            <option value="spec">spec</option>
            <option value="test">test</option>
            <option value="bug">bug</option>
            <option value="docs">docs</option>
            <option value="maintain">maintain</option>
            <option value="overnight">overnight</option>
          </select>
          <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="px-2 py-1 text-sm rounded border border-stone-300 bg-white">
            <option value="">全部狀態</option>
            <option value="completed">completed</option>
            <option value="interrupted">interrupted</option>
            <option value="error">error</option>
          </select>
          <button onClick={() => { fetchTasks(); fetchRuSummary(); }} className="px-3 py-1 text-sm rounded bg-stone-100 hover:bg-stone-200 transition-colors">🔄</button>
        </div>
      </div>

      {/* RU 成本統計 */}
      {ruSummary && ruSummary.rows.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-2 bg-stone-50 border-b border-stone-200 text-sm font-medium text-stone-600 flex items-center justify-between">
            <span>📦 Release Unit 成本統計</span>
            <span className="text-xs text-stone-400">總計 <span className="font-semibold text-stone-600">{fmtCost(ruSummary.totalCostUsd)}</span></span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50/50 border-b border-stone-100 text-stone-400 text-xs uppercase">
                <th className="px-3 py-1.5 text-left">RU / Project</th>
                <th className="px-3 py-1.5 text-right">Tasks</th>
                <th className="px-3 py-1.5 text-right">Tokens In</th>
                <th className="px-3 py-1.5 text-right">Tokens Out</th>
                <th className="px-3 py-1.5 text-right">成本</th>
                <th className="px-3 py-1.5 text-left">Model 明細</th>
                <th className="px-3 py-1.5 text-center w-10">刪</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {ruSummary.rows.map(r => (
                <tr key={r.ruName}>
                  <td className="px-3 py-1.5 font-medium text-stone-700">{r.ruName}</td>
                  <td className="px-3 py-1.5 text-right text-stone-500 tabular-nums">{r.tasks}</td>
                  <td className="px-3 py-1.5 text-right text-sky-600 tabular-nums">{fmtTokens(r.tokensIn)}</td>
                  <td className="px-3 py-1.5 text-right text-violet-600 tabular-nums">{fmtTokens(r.tokensOut)}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-700 tabular-nums font-semibold">{fmtCost(r.costUsd)}</td>
                  <td className="px-3 py-1.5 text-stone-400 text-xs">{Object.entries(r.byModel).map(([m, s]) => `${m.split("/").pop()} ${fmtCost(s.costUsd)}`).join(" · ")}</td>
                  <td className="px-3 py-1.5 text-center"><button onClick={e => { e.stopPropagation(); deleteRu(r.ruName); }} className="text-xs text-stone-300 hover:text-red-500 transition-colors" title={`刪除 ${r.ruName} 所有記錄`}>🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 text-xs uppercase">
              <th className="px-3 py-2 text-left">時間</th>
              <th className="px-3 py-2 text-left">Agent</th>
              <th className="px-3 py-2 text-left">狀態</th>
              <th className="px-3 py-2 text-left">RU</th>
              <th className="px-3 py-2 text-right">Turns</th>
              <th className="px-3 py-2 text-right">耗時</th>
              <th className="px-3 py-2 text-right">Tokens In/Out</th>
              <th className="px-3 py-2 text-right">成本</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-left">Prompt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {tasks.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-stone-400">尚無執行記錄</td></tr>
            )}
            {tasks.map(t => (
              <tr key={t.taskId} onClick={() => setSelected(t.taskId)} className="hover:bg-amber-50/50 cursor-pointer transition-colors">
                <td className="px-3 py-2 text-stone-500 whitespace-nowrap">{fmtTime(t.startTime)}</td>
                <td className="px-3 py-2 font-medium text-stone-700">{t.agentId}</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[t.status] || "text-stone-400 bg-stone-50"}`}>{t.status}</span>
                </td>
                <td className="px-3 py-2 text-stone-600 text-xs whitespace-nowrap">📦 {t.ruName || "-"}</td>
                <td className="px-3 py-2 text-right text-stone-500 tabular-nums">{t.turns}</td>
                <td className="px-3 py-2 text-right text-stone-500 tabular-nums font-medium">{fmtDuration(t.durationMs)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap">
                  <span className="text-sky-600">{fmtTokens(t.usage?.prompt)}</span>
                  <span className="text-stone-300 mx-0.5">/</span>
                  <span className="text-violet-600">{fmtTokens(t.usage?.completion)}</span>
                </td>
                <td className="px-3 py-2 text-right text-emerald-700 tabular-nums font-medium whitespace-nowrap">{fmtCost(t.costUsd)}</td>
                <td className="px-3 py-2 text-stone-400 text-xs">{t.model?.split("/").pop()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepRow({ step }: { step: LogStep }) {
  const icon = PHASE_ICONS[step.phase] || "·";
  const isStart = step.phase.endsWith("_start") || step.phase === "thinking" || step.phase === "task_start";
  const isEnd = step.phase.endsWith("_end") || step.phase === "task_end";
  const isTool = step.phase.startsWith("tool");
  const isLLM = step.phase.startsWith("llm");

  // For _end phases, show duration prominently
  if (isEnd && step.phase !== "task_end") {
    const label = isTool ? step.tool : isLLM ? "LLM" : "思考";
    return (
      <div className="px-4 py-1.5 flex items-center gap-3 text-sm bg-emerald-50/30">
        <span className="w-6 text-center">{icon}</span>
        <span className="font-medium text-stone-600 min-w-[120px]">{label}</span>
        {step.duration != null && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-600 tabular-nums">{fmtDuration(step.duration)}</span>
        )}
        {isLLM && step.usage && (
          <span className="text-xs text-stone-400">
            {step.usage.prompt_tokens || "?"}→{step.usage.completion_tokens || "?"} tokens
            {step.finishReason && ` · ${step.finishReason}`}
            {step.toolCallCount ? ` · ${step.toolCallCount} tools` : ""}
          </span>
        )}
        {isTool && (
          <span className="text-xs text-stone-400 truncate">
            {step.resultLen ? `${step.resultLen} chars` : ""}
            {step.resultPreview ? ` · ${step.resultPreview.slice(0, 100)}` : ""}
          </span>
        )}
        <span className="ml-auto text-xs text-stone-300 tabular-nums">{fmtDuration(step._ts)}</span>
      </div>
    );
  }

  // task_start
  if (step.phase === "task_start") {
    const info = (step as any).taskInfo;
    return (
      <div className="px-4 py-2 flex items-center gap-3 text-sm bg-blue-50/30">
        <span className="text-base">{icon}</span>
        <span className="font-bold text-stone-700">Task Start</span>
        {info && (
          <span className="text-xs text-stone-400">
            {info.agentId} · {info.model?.split("/").pop()} · maxTurns {info.maxTurns}
          </span>
        )}
        <span className="ml-auto text-xs text-stone-300 tabular-nums">0ms</span>
      </div>
    );
  }

  // task_end
  if (step.phase === "task_end") {
    return (
      <div className="px-4 py-2 flex items-center gap-3 text-sm bg-stone-50">
        <span className="text-base">{icon}</span>
        <span className="font-bold text-stone-700">Task End</span>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[step.status || ""] || "text-stone-500 bg-stone-50"}`}>{step.status}</span>
        <span className="text-xs text-stone-400">{step.turns} turns</span>
        <span className="px-2 py-0.5 rounded text-xs font-bold bg-stone-700 text-white tabular-nums">總耗時 {fmtDuration(step.totalDuration || 0)}</span>
        <span className="ml-auto text-xs text-stone-300 tabular-nums">{fmtDuration(step._ts)}</span>
      </div>
    );
  }

  // _start phases or thinking
  if (isStart) {
    const label = isTool ? step.tool : isLLM ? `LLM Turn ${step.turn}` : "思考中";
    return (
      <div className="px-4 py-1.5 flex items-center gap-3 text-sm">
        <span className="w-6 text-center">{icon}</span>
        <span className="font-medium text-stone-600 min-w-[120px]">{label}</span>
        {isLLM && (
          <span className="text-xs text-stone-400">
            {step.messageCount} msgs · ~{step.contextTokens ? `${(step.contextTokens / 1000).toFixed(0)}k` : "?"} tokens
          </span>
        )}
        {isTool && step.argsSummary && (
          <span className="text-xs text-stone-400 truncate">{step.argsSummary}</span>
        )}
        {!isTool && !isLLM && step.content && (
          <span className="text-xs text-stone-400 truncate max-w-md">{step.content.slice(0, 100)}</span>
        )}
        <span className="ml-auto text-xs text-stone-300 tabular-nums">{fmtDuration(step._ts)}</span>
      </div>
    );
  }

  // error
  if (step.phase === "error") {
    return (
      <div className="px-4 py-1.5 flex items-center gap-3 text-sm bg-red-50/50">
        <span className="w-6 text-center">{icon}</span>
        <span className="font-medium text-red-600">Error</span>
        <span className="text-xs text-red-400 truncate">{step.error}</span>
        <span className="ml-auto text-xs text-stone-300 tabular-nums">{fmtDuration(step._ts)}</span>
      </div>
    );
  }

  // fallback
  return (
    <div className="px-4 py-1.5 flex items-center gap-3 text-sm">
      <span className="w-6 text-center">{icon}</span>
      <span className="text-stone-500">{step.phase}</span>
      <span className="ml-auto text-xs text-stone-300 tabular-nums">{fmtDuration(step._ts)}</span>
    </div>
  );
}
