import { useState, useCallback, useEffect, useMemo } from "react";

type WFNodeType = "start" | "end" | "skill";
type EndOutputTarget = "chat" | "file";

interface WFNode {
  id: string; type: WFNodeType; skillId?: string; appName?: string; name: string;
  position: { x: number; y: number };
  config: { inputMapping: Record<string, string>; outputTarget?: EndOutputTarget; outputFilePath?: string };
}
interface WFEdge { id: string; source: string; target: string; }
interface WorkflowDef {
  id: string; name: string; description: string; icon: string;
  nodes: WFNode[]; edges: WFEdge[];
  inputSchema: { properties: Record<string, any>; required: string[] };
}
interface UserInputDef {
  id: string; label: string; description?: string; placeholder?: string;
  required?: boolean; type?: string; multiline?: boolean; rows?: number; group?: string;
}
interface ExecLogEntry {
  nodeId: string; nodeName: string; status: "running" | "success" | "error" | "pending";
  input?: any; output?: any; error?: string; durationMs?: number; type?: WFNodeType;
}
interface ExecHistoryEntry {
  id: string; timestamp: string; input: string; log: ExecLogEntry[];
  totalMs: number; success: boolean;
}

import API from "../api";

function ResultCards({ output }: { output: any }) {
  if (!output) return <div className="text-xs text-stone-400 italic">無結果</div>;
  if (output.html) return <div className="rounded-lg overflow-hidden border border-stone-200 shadow-sm"><iframe srcDoc={output.html} className="w-full border-0" style={{ minHeight: 300 }} sandbox="allow-same-origin" title="result" /></div>;
  if (output.translation) {
    return <div className="space-y-3">
      <div className="bg-white rounded-lg p-3 border border-stone-100"><div className="text-xs font-semibold text-stone-500 mb-1">翻譯結果</div><div className="text-sm text-stone-800">{output.translation}</div></div>
      {output.special_words?.length > 0 && <div><div className="text-xs font-semibold text-stone-500 mb-2">特殊詞彙 ({output.special_words.length})</div><div className="space-y-2">{output.special_words.map((w: any, i: number) => <div key={i} className="bg-white rounded-lg p-3 border border-stone-100"><div className="flex items-center justify-between"><span className="font-medium text-sm text-stone-800">{w.word}</span><span className="text-xs text-stone-400">{w.type}</span></div><div className="text-xs text-stone-500 mt-1">→ {w.translation}</div></div>)}</div></div>}
    </div>;
  }
  if (output.cards || output.idioms) {
    const items = output.cards || output.idioms || [];
    return <div className="space-y-2"><div className="text-xs font-semibold text-stone-500 mb-1">{output.cards ? `學習卡 (${items.length})` : `片語 (${items.length})`}</div>
      {items.map((c: any, i: number) => <div key={i} className="bg-white rounded-lg p-3 border border-stone-100 space-y-1.5"><div className="flex items-center gap-2"><span className="font-semibold text-sm text-stone-800">{c.word || c.phrase}</span>{c.phonetic && <span className="text-xs text-stone-400">{c.phonetic}</span>}{c.translation && <span className="text-xs text-stone-500">→ {c.translation}</span>}</div>{c.classic_sentence && <div className="text-xs text-stone-600">{typeof c.classic_sentence === "object" ? `${c.classic_sentence.en || c.classic_sentence.sentence || ""} — ${c.classic_sentence.zh || c.classic_sentence.translation || ""}` : c.classic_sentence}</div>}{c.fun_fact && <div className="text-xs text-amber-600 italic">😄 {c.fun_fact.content || c.fun_fact}</div>}{c.joke && <div className="text-xs text-amber-600 italic">😄 {c.joke}</div>}</div>)}
    </div>;
  }
  return <pre className="text-xs bg-white rounded-lg p-3 border border-stone-100 overflow-auto max-h-[60vh] whitespace-pre-wrap text-stone-700">{JSON.stringify(output, null, 2)}</pre>;
}

function topoSort(nodes: WFNode[], edges: WFEdge[]): WFNode[] {
  const nm = new Map(nodes.map(n => [n.id, n])); const id = new Map(nodes.map(n => [n.id, 0])); const adj = new Map(nodes.map(n => [n.id, [] as string[]]));
  for (const e of edges) { adj.get(e.source)?.push(e.target); id.set(e.target, (id.get(e.target) || 0) + 1); }
  const q: string[] = []; for (const [k, v] of id) if (v === 0) q.push(k);
  const r: WFNode[] = []; while (q.length) { const i = q.shift()!; const n = nm.get(i); if (n) r.push(n); for (const nx of adj.get(i) || []) { id.set(nx, (id.get(nx) || 0) - 1); if (id.get(nx) === 0) q.push(nx); } } return r;
}

function resolveTemplate(t: string, ctx: Record<string, any>): any {
  if (!t.startsWith("{{") || !t.endsWith("}}")) return t;
  const parts = t.slice(2, -2).trim().split("."); let v: any = ctx;
  for (const p of parts) { if (v == null) return undefined; v = v[p]; } return v;
}

function typeIcon(type?: WFNodeType) {
  if (type === "start") return "🟢";
  if (type === "end") return "🔵";
  return "⚡";
}

function formatTime(ts: string) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── Main ──
export default function WorkflowExec() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [currentWf, setCurrentWf] = useState<WorkflowDef | null>(null);
  const [execLog, setExecLog] = useState<ExecLogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [execHistory, setExecHistory] = useState<ExecHistoryEntry[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  // Dynamic inputs from Start block
  const [dynamicInputs, setDynamicInputs] = useState<UserInputDef[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const totalMs = useMemo(() => execLog.reduce((s, e) => s + (e.durationMs || 0), 0), [execLog]);
  const successCount = useMemo(() => execLog.filter(e => e.status === "success").length, [execLog]);
  const errorCount = useMemo(() => execLog.filter(e => e.status === "error").length, [execLog]);
  const selectedLogEntry = useMemo(() => { if (!selectedNodeId) return null; return execLog.find(e => e.nodeId === selectedNodeId) || null; }, [selectedNodeId, execLog]);
  const endNode = useMemo(() => currentWf?.nodes.find(n => n.type === "end"), [currentWf]);
  const outputTarget = endNode?.config.outputTarget || "chat";
  const fullFlow = useMemo(() => currentWf ? topoSort(currentWf.nodes, currentWf.edges) : [], [currentWf]);

  const viewingHistory = useMemo(() => {
    if (!selectedHistoryId) return null;
    return execHistory.find(h => h.id === selectedHistoryId) || null;
  }, [selectedHistoryId, execHistory]);
  const historyLog = viewingHistory?.log || [];
  const historySelectedEntry = useMemo(() => {
    if (!selectedNodeId || !viewingHistory) return null;
    return historyLog.find(e => e.nodeId === selectedNodeId) || null;
  }, [selectedNodeId, viewingHistory, historyLog]);

  useEffect(() => { fetch(`${API}/api/paaw/workflows`).then(r => r.json()).then((l: WorkflowDef[]) => { setWorkflows(l); }).catch(() => {}); }, []);

  const loadHistory = useCallback((wfId: string) => {
    fetch(`${API}/api/paaw/workflows/${wfId}/exec-history`).then(r => r.json()).then((h: ExecHistoryEntry[]) => { setExecHistory(h); }).catch(() => { setExecHistory([]); });
  }, []);

  // Find first skill node connected to Start
  const firstSkillNode = useMemo(() => {
    if (!currentWf) return null;
    const startEdge = currentWf.edges.find(e => e.source === "start");
    if (!startEdge) return null;
    return currentWf.nodes.find(n => n.id === startEdge.target) || null;
  }, [currentWf]);

  // Load dynamic inputs when workflow or first skill changes
  useEffect(() => {
    if (!firstSkillNode) { setDynamicInputs([]); return; }
    const appId = firstSkillNode.appName || "translate";
    const skillId = firstSkillNode.skillId;
    if (!skillId) { setDynamicInputs([]); return; }
    fetch(`${API}/api/paaw/skills/${appId}/${skillId}/inputs`)
      .then(r => r.json())
      .then((data: { userInputs: UserInputDef[] }) => {
        setDynamicInputs(data.userInputs || []);
        // Initialize input values with empty strings
        const vals: Record<string, string> = {};
        (data.userInputs || []).forEach(u => { vals[u.id] = ""; });
        setInputValues(vals);
      })
      .catch(() => { setDynamicInputs([]); });
  }, [firstSkillNode]);

  const selectWf = useCallback((id: string) => {
    fetch(`${API}/api/paaw/workflows/${id}`).then(r => r.json()).then((wf: WorkflowDef) => {
      setCurrentWf(wf); setExecLog([]); setSelectedNodeId(null); setSelectedHistoryId(null);
      loadHistory(id);
    }).catch(() => {});
  }, [loadHistory]);

  const saveHistory = useCallback(async (wfId: string, inputStr: string, log: ExecLogEntry[], totalMs: number) => {
    const entry: ExecHistoryEntry = {
      id: "exec-" + Date.now(), timestamp: new Date().toISOString(),
      input: inputStr, log, totalMs, success: !log.some(l => l.status === "error"),
    };
    await fetch(`${API}/api/paaw/workflows/${wfId}/exec-history`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry),
    });
    loadHistory(wfId);
  }, [loadHistory]);

  const runWorkflow = useCallback(async () => {
    if (!currentWf) return;

    // Build input from dynamic fields
    let input: Record<string, any>;
    if (dynamicInputs.length > 0) {
      input = {};
      for (const u of dynamicInputs) {
        const val = inputValues[u.id];
        if (u.required && !val) { showToast(`⚠️ 請填寫 ${u.label}`); return; }
        input[u.id] = val;
      }
    } else {
      // Fallback: use text input
      const rawText = inputValues["_text"] || "";
      if (!rawText) { showToast("⚠️ 請輸入資料"); return; }
      try { input = JSON.parse(rawText); } catch { input = { text: rawText }; }
    }

    setIsRunning(true); setExecLog([]); setSelectedNodeId(null); setSelectedHistoryId(null);
    const ctx: Record<string, any> = { workflow: { input }, node: {} };
    const skillNodes = currentWf.nodes.filter(n => n.type === "skill");
    const skillEdges = currentWf.edges.filter(e => {
      const sn = currentWf.nodes.find(n => n.id === e.source);
      const tn = currentWf.nodes.find(n => n.id === e.target);
      return sn?.type === "skill" && tn?.type === "skill";
    });
    const sorted = topoSort(skillNodes, skillEdges);
    const log: ExecLogEntry[] = [];
    let lastId: string | null = null;

    for (const node of sorted) {
      log.push({ nodeId: node.id, nodeName: node.name, status: "running", type: node.type }); setExecLog([...log]);
      const ri: Record<string, any> = {};
      for (const [k, t] of Object.entries(node.config.inputMapping || {})) ri[k] = resolveTemplate(t, ctx);
      const start = Date.now();
      try {
        const resp = await fetch(`${API}/api/paaw/skill-exec`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appId: node.appName || "translate", skillId: node.skillId, input: ri }),
        });
        const result = await resp.json(); const dur = Date.now() - start;
        if (result.error) {
          log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "error", error: result.error, durationMs: dur, type: node.type }; break;
        }
        const output = result.result || result;
        log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "success", input: ri, output, durationMs: dur, type: node.type };
        ctx.node[node.id] = { output }; lastId = node.id;
      } catch (err: any) {
        log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "error", error: err.message, durationMs: Date.now() - start, type: node.type }; break;
      }
      setExecLog([...log]);
    }

    // End block: handle output
    const endCfg = currentWf.nodes.find(n => n.type === "end")?.config;
    const lastOutput = lastId ? ctx.node[lastId]?.output : null;

    if (lastOutput) {
      if (endCfg?.outputTarget === "file" && endCfg.outputFilePath) {
        try {
          const filePath = endCfg.outputFilePath.replace(/\{\{workflow\.input\.(.+?)\}\}/g, (_: string, k: string) => input[k] || "");
          await fetch(`${API}/api/paaw/file-write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: filePath, content: typeof lastOutput === "string" ? lastOutput : JSON.stringify(lastOutput, null, 2) }) });
          log.push({ nodeId: "end", nodeName: "End (📁)", status: "success", output: { file: filePath }, durationMs: 0, type: "end" });
        } catch (err: any) {
          log.push({ nodeId: "end", nodeName: "End (📁)", status: "error", error: err.message, durationMs: 0, type: "end" });
        }
        setExecLog([...log]);
      } else {
        // Output to chat — send to PAAW chat
        try {
          const outputText = typeof lastOutput === "string" ? lastOutput : JSON.stringify(lastOutput, null, 2);
          await fetch(`${API}/api/paaw/workflow-output-chat`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId: "default", content: outputText, workflowName: currentWf.name }),
          });
          log.push({ nodeId: "end", nodeName: "End (💬)", status: "success", output: { chatSent: true, preview: typeof lastOutput === "string" ? lastOutput.slice(0, 100) : "JSON result" }, durationMs: 0, type: "end" });
          setExecLog([...log]);
        } catch (err: any) {
          log.push({ nodeId: "end", nodeName: "End (💬)", status: "error", error: err.message, durationMs: 0, type: "end" });
          setExecLog([...log]);
        }
      }
    }

    setIsRunning(false);
    const runTotalMs = log.reduce((s, e) => s + (e.durationMs || 0), 0);
    if (lastId) setSelectedNodeId(lastId);
    const hasError = log.some(l => l.status === "error");
    showToast(hasError ? "❌ 執行失敗" : `✅ 已輸出到${endCfg?.outputTarget === "file" ? "檔案" : "交談"}`);
    saveHistory(currentWf.id, JSON.stringify(input), log, runTotalMs);
  }, [currentWf, dynamicInputs, inputValues, saveHistory]);

  const viewHistory = useCallback((entry: ExecHistoryEntry) => {
    setSelectedHistoryId(entry.id); setExecLog([]); setSelectedNodeId(null);
  }, []);

  const exitHistory = useCallback(() => { setSelectedHistoryId(null); setSelectedNodeId(null); }, []);

  const displayLog = viewingHistory ? historyLog : execLog;
  const displaySelectedEntry = viewingHistory ? historySelectedEntry : selectedLogEntry;

  // Group dynamic inputs by group
  const inputGroups = useMemo(() => {
    const groups: Record<string, UserInputDef[]> = {};
    for (const u of dynamicInputs) {
      const g = u.group || "default";
      if (!groups[g]) groups[g] = [];
      groups[g].push(u);
    }
    return groups;
  }, [dynamicInputs]);

  return (
    <div className="flex h-full w-full relative bg-stone-50">
      {toast && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg shadow-lg">{toast}</div>}

      {/* Left: Workflow list + History */}
      <div className="w-56 border-r border-stone-200 bg-white flex flex-col">
        <div className="p-3 border-b border-stone-200">
          <h3 className="font-semibold text-sm text-stone-700">▶ Workflows</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="p-2 space-y-1">
            {workflows.map(wf => {
              const hasStart = wf.nodes.some(n => n.type === "start");
              const hasEnd = wf.nodes.some(n => n.type === "end");
              const skillCount = wf.nodes.filter(n => n.type === "skill").length;
              return (
                <button key={wf.id} onClick={() => selectWf(wf.id)} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${currentWf?.id === wf.id ? "bg-violet-100 text-violet-800" : "hover:bg-stone-50 text-stone-600"}`}>
                  <div className="flex items-center gap-2"><span>{wf.icon}</span><span className={currentWf?.id === wf.id ? "font-medium" : ""}>{wf.name}</span></div>
                  <div className="text-[10px] text-stone-400 mt-0.5 ml-6 flex items-center gap-1.5">
                    {hasStart && <span>🟢</span>}{skillCount > 0 && <span>⚡{skillCount}</span>}{hasEnd && <span>🔵</span>}
                  </div>
                </button>
              );
            })}
          </div>
          {currentWf && execHistory.length > 0 && (
            <div>
              <div className="px-3 py-1.5 border-t border-b border-stone-100 bg-stone-50">
                <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">執行紀錄</div>
              </div>
              <div className="p-2 space-y-1">
                {execHistory.map(h => (
                  <button key={h.id} onClick={() => viewHistory(h)} className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${selectedHistoryId === h.id ? "bg-violet-100 ring-1 ring-violet-300" : "hover:bg-stone-50"}`}>
                    <div className="flex items-center gap-1.5"><span>{h.success ? "✅" : "❌"}</span><span className="font-medium text-stone-700">{formatTime(h.timestamp)}</span></div>
                    <div className="flex items-center gap-2 mt-0.5 ml-5"><span className="text-stone-400">{h.totalMs}ms</span><span className="text-stone-300 truncate">{h.input}</span></div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="shrink-0 border-b border-stone-200 bg-white">
          <div className="flex items-center gap-3 px-4 py-2">
            <span className="text-xl">{currentWf?.icon || "🔗"}</span>
            <h2 className="font-bold text-sm text-stone-800">{currentWf?.name || "選擇 Workflow"}</h2>
            {currentWf && <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">{outputTarget === "chat" ? "💬 交談" : "📁 檔案"}</span>}
            <div className="flex-1" />
            {viewingHistory && <button onClick={exitHistory} className="text-xs text-violet-600 hover:text-violet-800 font-medium px-2 py-1 rounded-lg hover:bg-violet-50">← 回到執行</button>}
          </div>

          {/* Dynamic Input Form from Start block */}
          {!viewingHistory && currentWf && (
            <div className="px-4 pb-3">
              {dynamicInputs.length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(inputGroups).map(([group, inputs]) => (
                    <div key={group}>
                      {group !== "default" && <div className="text-xs font-semibold text-stone-500 mb-1.5">{group}</div>}
                      <div className={`grid ${inputs.length <= 2 ? "grid-cols-2" : "grid-cols-1"} gap-2`}>
                        {inputs.map(u => (
                          <div key={u.id}>
                            <label className="text-[10px] font-semibold text-stone-500 block mb-0.5">
                              {u.label} {u.required && <span className="text-red-400">*</span>}
                            </label>
                            {u.multiline ? (
                              <textarea value={inputValues[u.id] || ""} onChange={e => setInputValues(v => ({ ...v, [u.id]: e.target.value }))}
                                placeholder={u.placeholder} rows={u.rows || 2}
                                className="w-full px-3 py-1.5 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none" />
                            ) : (
                              <input type="text" value={inputValues[u.id] || ""} onChange={e => setInputValues(v => ({ ...v, [u.id]: e.target.value }))}
                                placeholder={u.placeholder}
                                className="w-full px-3 py-1.5 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button onClick={runWorkflow} disabled={isRunning}
                    className={`px-5 py-2 text-sm rounded-lg font-medium transition-colors ${isRunning ? "bg-amber-100 text-amber-700 cursor-wait" : "bg-violet-600 hover:bg-violet-700 text-white"}`}>
                    {isRunning ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border-[1.5px] border-amber-500 border-t-transparent rounded-full animate-spin" />
                        Running...
                      </span>
                    ) : "▶ Run"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400 shrink-0">🟢</span>
                  <input type="text" value={inputValues["_text"] || ""} onChange={e => setInputValues(v => ({ ...v, _text: e.target.value }))}
                    placeholder="輸入文字" className="flex-1 px-3 py-1.5 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" />
                  <button onClick={runWorkflow} disabled={isRunning}
                    className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-colors shrink-0 ${isRunning ? "bg-amber-100 text-amber-700 cursor-wait" : "bg-violet-600 hover:bg-violet-700 text-white"}`}>
                    {isRunning ? (
                      <span className="inline-flex items-center justify-center w-6 h-6">
                        <span className="w-3.5 h-3.5 border-[1.5px] border-amber-500 border-t-transparent rounded-full animate-spin" />
                      </span>
                    ) : "▶ Run"}
                  </button>
                </div>
              )}
            </div>
          )}
          {viewingHistory && (
            <div className="flex items-center gap-2 px-4 pb-2">
              <span className="text-xs text-stone-400">📋 {formatTime(viewingHistory.timestamp)}</span>
              {viewingHistory.success ? <span className="text-xs text-emerald-500 font-medium">✅ 成功</span> : <span className="text-xs text-red-500 font-medium">❌ 失敗</span>}
              <span className="text-xs text-stone-400">{viewingHistory.totalMs}ms</span>
            </div>
          )}
        </div>

        {/* Upper: Flow visualization (25%) */}
        {currentWf && fullFlow.length > 0 && (
          <div className="shrink-0 border-b border-stone-200 bg-white" style={{ height: "25%" }}>
            <div className="flex items-center gap-1 overflow-x-auto h-full px-4 py-2">
              {fullFlow.map((node, i) => {
                const logEntry = displayLog.find(e => e.nodeId === node.id);
                const status = logEntry?.status || "pending";
                const isStart = node.type === "start";
                const isEnd = node.type === "end";
                const statusStyle = isStart ? "border-emerald-300 bg-emerald-50" : isEnd ? "border-indigo-300 bg-indigo-50" : status === "running" ? "border-amber-400 bg-amber-50" : status === "success" ? "border-emerald-400 bg-emerald-50" : status === "error" ? "border-red-400 bg-red-50" : "border-stone-200 bg-white";
                const statusIcon = isStart ? "🟢" : isEnd ? "🔵" : status === "running" ? null : status === "success" ? "✅" : status === "error" ? "❌" : "⚡";
                return (
                  <div key={node.id} className="flex items-center shrink-0">
                    <button onClick={() => { if (logEntry) setSelectedNodeId(node.id); }}
                      className={`flex flex-col items-center gap-1 px-4 py-3 rounded-xl border-2 text-xs font-medium transition-all ${statusStyle} ${selectedNodeId === node.id ? "ring-2 ring-violet-400 shadow-sm" : ""}`}>
                      <span className="text-base">{statusIcon || <span className="inline-flex items-center justify-center w-4 h-4"><span className="w-3.5 h-3.5 border-[1.5px] border-amber-500 border-t-transparent rounded-full animate-spin" /></span>}</span>
                      <span className="text-stone-700 font-semibold">{node.name}</span>
                      {!isStart && !isEnd && node.skillId && <span className="text-stone-400 text-[10px]">{node.skillId}</span>}
                      {isEnd && <span className="text-[10px]">{outputTarget === "chat" ? "💬" : "📁"}</span>}
                      {logEntry?.durationMs != null && <span className="text-[10px] text-stone-400">{logEntry.durationMs}ms</span>}
                      {logEntry?.error && <span className="text-[10px] text-red-400 truncate max-w-[80px]">{logEntry.error}</span>}
                    </button>
                    {i < fullFlow.length - 1 && <span className="text-stone-300 mx-2 text-lg">→</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Lower: Result area (75%) */}
        <div className="flex-1 overflow-y-auto bg-white" style={{ minHeight: 0 }}>
          {!currentWf && <div className="flex items-center justify-center h-full"><div className="text-center text-stone-400"><div className="text-4xl mb-3">🔗</div><div className="text-sm">從左側選擇一個 Workflow</div></div></div>}
          {currentWf && displayLog.length === 0 && !isRunning && (
            <div className="flex items-center justify-center h-full"><div className="text-center text-stone-400">
              <div className="text-4xl mb-3">▶</div>
              <div className="text-sm">填寫輸入欄位，按 Run 執行</div>
              {dynamicInputs.length > 0 && <div className="text-xs mt-1">🟢 {dynamicInputs.length} 個輸入欄位（來自 {firstSkillNode?.skillId}）</div>}
            </div></div>
          )}
          {isRunning && displayLog.length > 0 && (
            <div className="p-5 space-y-2">
              <div className="text-xs font-semibold text-stone-500 mb-2">執行中...</div>
              {displayLog.map((entry, i) => (
                <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border ${entry.status === "running" ? "border-amber-200 bg-amber-50" : entry.status === "success" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                  <span>{typeIcon(entry.type)}</span>
                  <div className="flex-1"><span className="text-sm font-medium text-stone-700">{entry.nodeName}</span></div>
                  {entry.status === "running" && <span className="inline-flex items-center justify-center w-4 h-4"><span className="w-3 h-3 border-[1.5px] border-amber-500 border-t-transparent rounded-full animate-spin" /></span>}
                  {entry.durationMs != null && <span className="text-xs text-stone-400">{entry.durationMs}ms</span>}
                </div>
              ))}
            </div>
          )}
          {!isRunning && displayLog.length > 0 && (
            <div className="h-full flex flex-col">
              <div className="flex items-center gap-1 px-4 py-2 border-b border-stone-100 bg-stone-50/50 shrink-0">
                <span className="text-xs font-semibold text-stone-500 mr-2">結果:</span>
                {displayLog.filter(e => e.output || e.error).map(e => (
                  <button key={e.nodeId} onClick={() => setSelectedNodeId(e.nodeId)}
                    className={`text-xs px-3 py-1 rounded-lg transition-colors ${selectedNodeId === e.nodeId ? "bg-violet-100 text-violet-700 font-semibold" : e.status === "error" ? "text-red-500 hover:bg-red-50" : "text-stone-500 hover:bg-stone-100"}`}>
                    {typeIcon(e.type)} {e.nodeName}
                  </button>
                ))}
                <div className="flex-1" />
                <span className="text-[10px] text-stone-400">✅{successCount} {errorCount > 0 && <span className="text-red-400">❌{errorCount}</span>} ⏱{viewingHistory ? viewingHistory.totalMs : totalMs}ms</span>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {displaySelectedEntry?.output?.chatSent && (
                  <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 flex items-center gap-3 mb-3">
                    <span className="text-2xl">💬</span>
                    <div>
                      <div className="text-sm font-semibold text-emerald-800">已輸出到交談視窗</div>
                      <div className="text-xs text-emerald-600 mt-0.5">結果已發送到 PAAW 交談，切換到「💬 交談」tab 查看</div>
                    </div>
                  </div>
                )}
                {displaySelectedEntry?.output?.file && (
                  <div className="bg-amber-50 rounded-lg p-3 border border-amber-200 flex items-center gap-2 mb-3">
                    <span>📁</span>
                    <span className="text-sm text-amber-700">結果已寫入：<code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs">{displaySelectedEntry.output.file}</code></span>
                  </div>
                )}
                {displaySelectedEntry?.output && !displaySelectedEntry.output.chatSent && !displaySelectedEntry.output.file && <ResultCards output={displaySelectedEntry.output} />}
                {displaySelectedEntry?.error && (
                  <div className="bg-red-50 rounded-xl p-4 border border-red-200 space-y-3">
                    <div className="flex items-center gap-2"><span className="text-lg">❌</span><div className="text-sm font-semibold text-red-800">{displaySelectedEntry.nodeName} — 執行失敗</div></div>
                    <div className="bg-white/80 rounded-lg p-3 border border-red-100">
                      <div className="text-xs font-semibold text-red-600 mb-1">Error Log</div>
                      <pre className="text-xs text-red-700 whitespace-pre-wrap break-words">{displaySelectedEntry.error}</pre>
                    </div>
                    {displaySelectedEntry.input && (
                      <div className="bg-white/80 rounded-lg p-3 border border-stone-200">
                        <div className="text-xs font-semibold text-stone-500 mb-1">Input</div>
                        <pre className="text-xs text-stone-600 whitespace-pre-wrap break-words">{JSON.stringify(displaySelectedEntry.input, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
                {!displaySelectedEntry && <div className="text-xs text-stone-400 italic">點擊上方步驟查看結果</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
