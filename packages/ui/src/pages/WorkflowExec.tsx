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
interface ExecLogEntry { nodeId: string; nodeName: string; status: "running" | "success" | "error" | "pending"; input?: any; output?: any; error?: string; durationMs?: number; type?: WFNodeType; }

const API = "http://127.0.0.1:4097";

// ── Result Cards ──
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

// ── Node type icon ──
function typeIcon(type?: WFNodeType) {
  if (type === "start") return "🟢";
  if (type === "end") return "🔴";
  return "⚡";
}

// ── Main ──
export default function WorkflowExec() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [currentWf, setCurrentWf] = useState<WorkflowDef | null>(null);
  const [execLog, setExecLog] = useState<ExecLogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [workflowInput, setWorkflowInput] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const totalMs = useMemo(() => execLog.reduce((s, e) => s + (e.durationMs || 0), 0), [execLog]);
  const successCount = useMemo(() => execLog.filter(e => e.status === "success").length, [execLog]);
  const errorCount = useMemo(() => execLog.filter(e => e.status === "error").length, [execLog]);
  const selectedLogEntry = useMemo(() => { if (!selectedNodeId) return null; return execLog.find(e => e.nodeId === selectedNodeId) || null; }, [selectedNodeId, execLog]);

  // Find end node config
  const endNode = useMemo(() => currentWf?.nodes.find(n => n.type === "end"), [currentWf]);
  const outputTarget = endNode?.config.outputTarget || "chat";

  useEffect(() => { fetch(`${API}/api/paaw/workflows`).then(r => r.json()).then((l: WorkflowDef[]) => { setWorkflows(l); }).catch(() => {}); }, []);

  const selectWf = useCallback((id: string) => {
    fetch(`${API}/api/paaw/workflows/${id}`).then(r => r.json()).then((wf: WorkflowDef) => {
      setCurrentWf(wf); setExecLog([]); setSelectedNodeId(null);
    }).catch(() => {});
  }, []);

  const runWorkflow = useCallback(async () => {
    if (!currentWf) return;
    let input: any = {}; try { input = JSON.parse(workflowInput); } catch { input = { text: workflowInput }; }
    setIsRunning(true); setExecLog([]); setSelectedNodeId(null);
    const ctx: Record<string, any> = { workflow: { input }, node: {} };
    // Filter out start/end from execution — only run skill nodes
    const skillNodes = currentWf.nodes.filter(n => n.type === "skill");
    const skillEdges = currentWf.edges.filter(e => { const sn = currentWf.nodes.find(n => n.id === e.source); const tn = currentWf.nodes.find(n => n.id === e.target); return sn?.type === "skill" && tn?.type === "skill"; });
    const sorted = topoSort(skillNodes, skillEdges);
    const log: ExecLogEntry[] = [];
    let lastId: string | null = null;

    for (const node of sorted) {
      log.push({ nodeId: node.id, nodeName: node.name, status: "running", type: node.type }); setExecLog([...log]);
      const ri: Record<string, any> = {}; for (const [k, t] of Object.entries(node.config.inputMapping || {})) ri[k] = resolveTemplate(t, ctx);
      const start = Date.now();
      try {
        const resp = await fetch(`${API}/api/paaw/skill-exec`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: node.appName || "translate", skillId: node.skillId, input: ri }) });
        const result = await resp.json(); const dur = Date.now() - start;
        if (result.error) { log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "error", error: result.error, durationMs: dur, type: node.type }; break; }
        const output = result.result || result; log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "success", input: ri, output, durationMs: dur, type: node.type }; ctx.node[node.id] = { output }; lastId = node.id;
      } catch (err: any) { log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "error", error: err.message, durationMs: Date.now() - start, type: node.type }; break; }
      setExecLog([...log]);
    }

    // Handle end node output
    const endCfg = currentWf.nodes.find(n => n.type === "end")?.config;
    if (endCfg?.outputTarget === "file" && endCfg.outputFilePath && lastId) {
      const lastOutput = ctx.node[lastId]?.output;
      if (lastOutput) {
        try {
          const filePath = endCfg.outputFilePath.replace(/\{\{workflow\.input\.(.+?)\}\}/g, (_, k) => input[k] || "");
          await fetch(`${API}/api/paaw/file-write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: filePath, content: typeof lastOutput === "string" ? lastOutput : JSON.stringify(lastOutput, null, 2) }) });
          log.push({ nodeId: "end", nodeName: "End", status: "success", output: { file: filePath }, durationMs: 0, type: "end" });
        } catch (err: any) {
          log.push({ nodeId: "end", nodeName: "End", status: "error", error: err.message, durationMs: 0, type: "end" });
        }
        setExecLog([...log]);
      }
    }

    setIsRunning(false);
    if (lastId) setSelectedNodeId(lastId);
    showToast(log.some(l => l.status === "error") ? "❌ 執行失敗" : "✅ 執行完成");
  }, [currentWf, workflowInput]);

  // Full flow for visualization (includes start/end)
  const fullFlow = useMemo(() => {
    if (!currentWf) return [];
    return topoSort(currentWf.nodes, currentWf.edges);
  }, [currentWf]);

  return (
    <div className="flex h-full w-full relative bg-stone-50">
      {toast && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg shadow-lg">{toast}</div>}

      {/* Left: Workflow list */}
      <div className="w-56 border-r border-stone-200 bg-white flex flex-col">
        <div className="p-3 border-b border-stone-200">
          <h3 className="font-semibold text-sm text-stone-700">▶ Workflow Exec</h3>
          <div className="text-[10px] text-stone-400 mt-0.5">選擇 → 輸入 → 執行</div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {workflows.map(wf => {
            const hasStart = wf.nodes.some(n => n.type === "start");
            const hasEnd = wf.nodes.some(n => n.type === "end");
            const skillCount = wf.nodes.filter(n => n.type === "skill").length;
            return (
              <button key={wf.id} onClick={() => selectWf(wf.id)} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${currentWf?.id === wf.id ? "bg-violet-100 text-violet-800" : "hover:bg-stone-50 text-stone-600"}`}>
                <div className="flex items-center gap-2">
                  <span>{wf.icon}</span>
                  <span className={currentWf?.id === wf.id ? "font-medium" : ""}>{wf.name}</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5 ml-6 flex items-center gap-1.5">
                  {hasStart && <span>🟢</span>}{skillCount > 0 && <span>⚡{skillCount}</span>}{hasEnd && <span>🔴</span>}
                  {!hasStart || !hasEnd ? <span className="text-amber-500">⚠️缺{!hasStart ? "Start" : "End"}</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 bg-white">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{currentWf?.icon || "🔗"}</span>
            <div>
              <h2 className="font-bold text-stone-800">{currentWf?.name || "選擇一個 Workflow"}</h2>
              <div className="text-xs text-stone-400">{currentWf?.description || "從左側選擇要執行的 Workflow"}</div>
            </div>
            {outputTarget && currentWf && (
              <div className="ml-4 text-xs px-2.5 py-1 rounded-full bg-stone-100 text-stone-500">
                輸出: {outputTarget === "chat" ? "💬 聊天" : "📁 檔案"}
              </div>
            )}
          </div>
          {execLog.length > 0 && (
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5 text-xs"><span className="text-stone-400">Steps:</span><span className="font-semibold text-stone-700">{execLog.length}</span></div>
              <div className="flex items-center gap-1.5 text-xs"><span className="text-stone-400">✅:</span><span className="font-semibold text-emerald-600">{successCount}</span></div>
              {errorCount > 0 && <div className="flex items-center gap-1.5 text-xs"><span className="text-stone-400">❌:</span><span className="font-semibold text-red-600">{errorCount}</span></div>}
              <div className="flex items-center gap-1.5 text-xs"><span className="text-stone-400">⏱:</span><span className="font-semibold text-stone-700">{totalMs}ms</span></div>
            </div>
          )}
        </div>

        {/* Input + Run */}
        <div className="px-6 py-3 border-b border-stone-100 bg-stone-50 flex items-center gap-3">
          <span className="text-xs text-stone-500 font-medium shrink-0">🟢 輸入:</span>
          <input type="text" value={workflowInput} onChange={e => setWorkflowInput(e.target.value)} placeholder='輸入文字，例如：蘋果' className="flex-1 px-3 py-2 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" />
          <button onClick={runWorkflow} disabled={isRunning || !currentWf} className={`px-5 py-2 text-sm rounded-lg font-medium transition-colors shrink-0 ${isRunning ? "bg-amber-100 text-amber-700 cursor-wait" : "bg-violet-600 hover:bg-violet-700 text-white"}`}>
            {isRunning ? "⏳ Running..." : "▶ Run"}
          </button>
        </div>

        {/* Flow visualization */}
        {currentWf && fullFlow.length > 0 && (
          <div className="px-6 py-3 border-b border-stone-100 bg-white">
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {fullFlow.map((node, i) => {
                const logEntry = execLog.find(e => e.nodeId === node.id);
                const status = logEntry?.status || "pending";
                const isStart = node.type === "start";
                const isEnd = node.type === "end";
                const statusStyle = isStart ? "border-emerald-300 bg-emerald-50" : isEnd ? "border-rose-300 bg-rose-50" : status === "running" ? "border-amber-400 bg-amber-50" : status === "success" ? "border-emerald-400 bg-emerald-50" : status === "error" ? "border-red-400 bg-red-50" : "border-stone-200 bg-white";
                const statusIcon = isStart ? "🟢" : isEnd ? "🔴" : status === "running" ? "⏳" : status === "success" ? "✅" : status === "error" ? "❌" : "⚡";
                return (
                  <div key={node.id} className="flex items-center">
                    <button onClick={() => { if (logEntry?.output || logEntry?.error) setSelectedNodeId(node.id); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-colors ${statusStyle} ${selectedNodeId === node.id ? "ring-2 ring-violet-300" : ""} ${!isStart && !isEnd ? "cursor-pointer" : ""}`}>
                      <span>{statusIcon}</span>
                      <span className="text-stone-700">{node.name}</span>
                      {!isStart && !isEnd && node.skillId && <span className="text-stone-400">{node.skillId}</span>}
                      {isEnd && <span className="text-stone-400">{(node.config.outputTarget || "chat") === "chat" ? "💬" : "📁"}</span>}
                    </button>
                    {i < fullFlow.length - 1 && <span className="text-stone-300 mx-1">→</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Result area */}
        <div className="flex-1 overflow-y-auto">
          {!currentWf && (
            <div className="flex items-center justify-center h-full"><div className="text-center text-stone-400"><div className="text-4xl mb-3">🔗</div><div className="text-sm">從左側選擇一個 Workflow 開始</div></div></div>
          )}
          {currentWf && execLog.length === 0 && !isRunning && (
            <div className="flex items-center justify-center h-full"><div className="text-center text-stone-400"><div className="text-4xl mb-3">▶</div><div className="text-sm">輸入資料，按 Run 執行 Workflow</div><div className="text-xs mt-1">🟢 Start → {currentWf.nodes.filter(n => n.type === "skill").length} 個積木 → 🔴 End</div></div></div>
          )}
          {isRunning && execLog.length > 0 && (
            <div className="p-6 space-y-3">
              <div className="text-xs font-semibold text-stone-500">執行中...</div>
              {execLog.map((entry, i) => (
                <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${entry.status === "running" ? "border-amber-200 bg-amber-50" : entry.status === "success" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                  <span className="text-sm">{typeIcon(entry.type)}</span>
                  <div className="flex-1"><div className="text-sm font-medium text-stone-700">{entry.nodeName}</div>{entry.error && <div className="text-xs text-red-500 mt-0.5">{entry.error}</div>}</div>
                  {entry.durationMs != null && <span className="text-xs text-stone-400">{entry.durationMs}ms</span>}
                </div>
              ))}
            </div>
          )}
          {!isRunning && execLog.length > 0 && (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="text-sm font-semibold text-stone-700">執行結果</div>
                <div className="flex items-center gap-2">
                  {execLog.filter(e => e.output || e.error).map(e => (
                    <button key={e.nodeId} onClick={() => setSelectedNodeId(e.nodeId)} className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${selectedNodeId === e.nodeId ? "bg-violet-100 text-violet-700 font-medium" : "text-stone-500 hover:bg-stone-100"}`}>
                      {typeIcon(e.type)} {e.nodeName}
                    </button>
                  ))}
                </div>
              </div>
              {/* File output indicator */}
              {selectedLogEntry?.output?.file && (
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200 flex items-center gap-2">
                  <span>📁</span>
                  <span className="text-sm text-amber-700">結果已寫入：<code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs">{selectedLogEntry.output.file}</code></span>
                </div>
              )}
              {selectedLogEntry?.output && !selectedLogEntry.output.file && <ResultCards output={selectedLogEntry.output} />}
              {selectedLogEntry?.error && <div className="bg-red-50 rounded-lg p-4 border border-red-200"><div className="text-sm font-medium text-red-700">錯誤</div><div className="text-xs text-red-600 mt-1">{selectedLogEntry.error}</div></div>}
              {!selectedLogEntry && execLog.length > 0 && <div className="text-xs text-stone-400 italic">點擊上方步驟查看結果</div>}
            </div>
          )}
        </div>
      </div>

      {/* Right: Execution Log */}
      {execLog.length > 0 && (
        <div className="w-56 border-l border-stone-200 bg-white flex flex-col">
          <div className="px-3 py-2.5 border-b border-stone-200 bg-stone-50">
            <div className="text-xs font-semibold text-stone-600">Execution Log {totalMs > 0 && <span className="ml-1.5 text-stone-400">{totalMs}ms</span>}</div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {execLog.map((entry, i) => (
              <button key={i} onClick={() => setSelectedNodeId(entry.nodeId)} className={`w-full flex items-start gap-1.5 px-2 py-2 rounded-lg text-left transition-colors ${selectedNodeId === entry.nodeId ? "bg-violet-50 ring-1 ring-violet-300" : entry.status === "success" ? "bg-emerald-50/50 hover:bg-emerald-100" : entry.status === "error" ? "bg-red-50/50" : entry.status === "running" ? "bg-amber-50/50" : "bg-stone-50"}`}>
                <span className="text-xs mt-0.5">{typeIcon(entry.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-stone-700 truncate">{entry.nodeName}</div>
                  {entry.durationMs != null && <div className="text-[10px] text-stone-400">{entry.durationMs}ms</div>}
                  {entry.error && <div className="text-[10px] text-red-500 truncate">{entry.error}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
