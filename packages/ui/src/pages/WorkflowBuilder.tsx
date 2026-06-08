import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  ReactFlow, Controls, Background, useNodesState, useEdgesState, addEdge,
  Handle, Position, type Connection, type NodeProps, type Node, type Edge,
  BackgroundVariant, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

interface WFNode { id: string; type: "skill"; skillId: string; appName?: string; name: string; position: { x: number; y: number }; config: { inputMapping: Record<string, string> }; }
interface WFEdge { id: string; source: string; target: string; }
interface WorkflowDef { id: string; name: string; description: string; icon: string; nodes: WFNode[]; edges: WFEdge[]; inputSchema: { properties: Record<string, any>; required: string[] }; }
interface ExecLogEntry { nodeId: string; nodeName: string; status: "running" | "success" | "error" | "pending"; input?: any; output?: any; error?: string; durationMs?: number; }
interface AppSkill { id: string; name: string; icon: string; skills: string[]; }

const API = "http://127.0.0.1:4097";

function previewText(o: any): string {
  if (!o) return "";
  if (typeof o === "string") return o.slice(0, 30);
  if (o.translation) return o.translation.slice(0, 30);
  if (o.html) return "HTML 卡片";
  return JSON.stringify(o).slice(0, 30);
}

// ── Skill Node ──
function SkillNode({ data, selected }: NodeProps) {
  const s = (data.status as string) || "idle";
  const sc = s === "running" ? "bg-amber-400" : s === "success" ? "bg-emerald-500" : s === "error" ? "bg-red-500" : "bg-stone-300";
  const si = s === "running" ? "⏳" : s === "success" ? "✅" : s === "error" ? "❌" : "";
  const p = data.output ? previewText(data.output) : "";
  return (
    <div className={`px-4 py-3 rounded-xl shadow-sm border-2 transition-all cursor-pointer ${
      selected ? "border-violet-500 shadow-lg ring-4 ring-violet-200 bg-violet-50"
      : s === "success" ? "border-emerald-300 bg-emerald-50/50"
      : s === "error" ? "border-red-300 bg-red-50/50"
      : "border-stone-200 hover:border-stone-300 bg-white"}`}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-stone-300 !border-2 !border-white" />
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${sc} ${s === "running" ? "animate-pulse" : ""}`} />
        <span className="font-semibold text-sm text-stone-800">{data.label as string}</span>
        {si && <span className="text-xs">{si}</span>}
      </div>
      <div className="text-xs text-stone-400 ml-[18px]">{data.skillId as string}</div>
      {p && <div className="mt-1.5 text-xs text-stone-500 ml-[18px] truncate">{p}</div>}
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-stone-300 !border-2 !border-white" />
    </div>
  );
}
const nodeTypes = { skill: SkillNode };

// ── Result Cards ──
function ResultCards({ output }: { output: any }) {
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

// ── Node Config Panel ──
function NodeConfigPanel({ node, appSkills, onUpdate, onDelete, onTest, onClose, testing }: {
  node: WFNode; appSkills: AppSkill[]; onUpdate: (p: Partial<WFNode>) => void; onDelete: () => void; onTest: () => void; onClose: () => void; testing: boolean;
}) {
  const mapping = node.config.inputMapping || {};
  const selApp = appSkills.find(a => a.id === node.appName);
  const availSkills = selApp ? selApp.skills : [];
  const poolApp = appSkills.find(a => a.id === "_pool");
  return (
    <div className="w-72 border-l border-stone-200 bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 bg-stone-50">
        <span className="text-sm font-semibold text-stone-800">🔧 積木設定</span>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-sm">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div><label className="text-xs font-semibold text-stone-500 block mb-1">名稱</label><input type="text" value={node.name} onChange={e => onUpdate({ name: e.target.value })} className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" /></div>
        <div><label className="text-xs font-semibold text-stone-500 block mb-1">App</label><select value={node.appName || ""} onChange={e => { const a = appSkills.find(x => x.id === e.target.value); onUpdate({ appName: e.target.value, skillId: a?.skills?.[0] || "" }); }} className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"><option value="">選擇 App</option>{appSkills.filter(a => a.id !== "_pool").map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}</select></div>
        <div><label className="text-xs font-semibold text-stone-500 block mb-1">Skill</label><select value={node.skillId || ""} onChange={e => onUpdate({ skillId: e.target.value })} className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"><option value="">選擇 Skill</option>{availSkills.map(s => <option key={s} value={s}>{s}</option>)}{poolApp?.skills?.map(s => <option key={s} value={s}>🗂️ {s}</option>)}</select></div>
        <div>
          <div className="flex items-center justify-between mb-2"><label className="text-xs font-semibold text-stone-500">輸入映射</label><button onClick={() => { let k = "input_1", n = 1; while (mapping[k]) { n++; k = "input_" + n; } onUpdate({ config: { inputMapping: { ...mapping, [k]: "" } } }); }} className="text-xs text-violet-600 hover:text-violet-800 font-medium">+ 新增</button></div>
          <div className="space-y-2">{Object.entries(mapping).map(([key, val]) => <div key={key} className="space-y-1"><div className="flex items-center gap-1"><input type="text" value={key} onChange={e => { const n = { ...mapping }; delete n[key]; n[e.target.value] = val; onUpdate({ config: { inputMapping: n } }); }} className="flex-1 px-2 py-1 text-xs bg-stone-50 border border-stone-200 rounded font-mono" placeholder="key" /><button onClick={() => { const n = { ...mapping }; delete n[key]; onUpdate({ config: { inputMapping: n } }); }} className="text-stone-400 hover:text-red-500 text-xs">✕</button></div><input type="text" value={val} onChange={e => onUpdate({ config: { inputMapping: { ...mapping, [key]: e.target.value } } })} className="w-full px-2 py-1 text-xs bg-white border border-stone-200 rounded font-mono" placeholder="{{workflow.input.text}} 或固定值" /></div>)}</div>
          {Object.keys(mapping).length === 0 && <div className="text-xs text-stone-400 italic mt-1">尚未設定映射</div>}
          <div className="mt-2 text-[10px] text-stone-400 space-y-0.5"><div>💡 <code className="bg-stone-100 px-1 rounded">{"{{workflow.input.xxx}}"}</code> — workflow 輸入</div><div>💡 <code className="bg-stone-100 px-1 rounded">{"{{node-1.output.xxx}}"}</code> — 前一個節點輸出</div></div>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-stone-200 space-y-2">
        <button onClick={onTest} disabled={testing || !node.skillId} className={`w-full py-1.5 text-xs rounded-lg font-medium transition-colors ${testing ? "bg-amber-100 text-amber-700" : "bg-violet-600 hover:bg-violet-700 text-white"}`}>{testing ? "⏳ 測試中..." : "▶ 測試執行"}</button>
        <button onClick={onDelete} className="w-full py-1.5 text-xs rounded-lg text-red-600 hover:bg-red-50 border border-red-200 transition-colors">🗑 刪除節點</button>
      </div>
    </div>
  );
}

// ── Main Component ──
export default function WorkflowBuilder() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [currentWf, setCurrentWf] = useState<WorkflowDef | null>(null);
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState<Edge>([]);
  const [execLog, setExecLog] = useState<ExecLogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [workflowInput, setWorkflowInput] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [appSkills, setAppSkills] = useState<AppSkill[]>([]);
  const [testNodeId, setTestNodeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const selectedWFNode = useMemo(() => { if (!selectedNodeId || !currentWf) return null; return currentWf.nodes.find(n => n.id === selectedNodeId) || null; }, [selectedNodeId, currentWf]);
  const selectedLogEntry = useMemo(() => { if (!selectedNodeId) return null; return execLog.find(e => e.nodeId === selectedNodeId && (e.status === "success" || e.status === "error")) || null; }, [selectedNodeId, execLog]);
  const selectedNodeName = useMemo(() => { if (!selectedNodeId || !currentWf) return ""; return currentWf.nodes.find(n => n.id === selectedNodeId)?.name || ""; }, [selectedNodeId, currentWf]);
  const totalMs = useMemo(() => execLog.reduce((s, e) => s + (e.durationMs || 0), 0), [execLog]);

  // Panel mode
  const panelMode = useMemo(() => {
    if (!selectedNodeId) return null;
    if (showResult && selectedLogEntry) return "result";
    return "config";
  }, [selectedNodeId, showResult, selectedLogEntry]);

  useEffect(() => { fetch(`${API}/api/paaw/app-skills`).then(r => r.json()).then(setAppSkills).catch(() => {}); }, []);
  useEffect(() => { fetch(`${API}/api/paaw/workflows`).then(r => r.json()).then((l: WorkflowDef[]) => { setWorkflows(l); if (l.length > 0 && !currentWf) loadWorkflow(l[0].id); }).catch(() => {}); }, []);

  const loadWorkflow = useCallback((id: string) => {
    fetch(`${API}/api/paaw/workflows/${id}`).then(r => r.json()).then((wf: WorkflowDef) => {
      setCurrentWf(wf); setExecLog([]); setSelectedNodeId(null); setShowResult(false);
      setRfNodes(wf.nodes.map(n => ({ id: n.id, type: "skill", position: n.position, data: { label: n.name, skillId: n.skillId, status: "idle" } })));
      setRfEdges(wf.edges.map(e => ({ id: e.id, source: e.source, target: e.target, animated: true, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }, style: { stroke: "#a1a1aa", strokeWidth: 2 } })));
    }).catch(() => {});
  }, [setRfNodes, setRfEdges]);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => { setSelectedNodeId(p => p === node.id ? null : node.id); setShowResult(false); }, []);
  const onPaneClick = useCallback(() => { setSelectedNodeId(null); }, []);
  const onConnect = useCallback((c: Connection) => { setRfEdges(eds => addEdge({ ...c, animated: true, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }, style: { stroke: "#a1a1aa", strokeWidth: 2 } }, eds)); }, [setRfEdges]);

  const autoSave = useCallback((wf: WorkflowDef) => {
    const updated = { ...wf, nodes: wf.nodes.map(n => { const r = rfNodes.find(rn => rn.id === n.id); return r ? { ...n, position: r.position } : n; }), edges: rfEdges.map(e => ({ id: e.id, source: e.source, target: e.target })) };
    fetch(`${API}/api/paaw/workflows/${wf.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) }).then(() => { setCurrentWf(updated); setWorkflows(ws => ws.map(w => w.id === updated.id ? updated : w)); });
  }, [rfNodes, rfEdges]);

  const handleNodeUpdate = useCallback((patch: Partial<WFNode>) => {
    if (!currentWf || !selectedNodeId) return;
    const updated = { ...currentWf, nodes: currentWf.nodes.map(n => n.id === selectedNodeId ? { ...n, ...patch } : n) };
    setCurrentWf(updated);
    if (patch.name) setRfNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, label: patch.name } } : n));
    if (patch.skillId) setRfNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, skillId: patch.skillId } } : n));
    autoSave(updated); showToast("✅ Saved!");
  }, [currentWf, selectedNodeId, autoSave, setRfNodes]);

  const handleNodeDelete = useCallback(() => {
    if (!currentWf || !selectedNodeId) return;
    const updated = { ...currentWf, nodes: currentWf.nodes.filter(n => n.id !== selectedNodeId), edges: currentWf.edges.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId) };
    setCurrentWf(updated); setRfNodes(nds => nds.filter(n => n.id !== selectedNodeId)); setRfEdges(eds => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null); autoSave(updated); showToast("🗑 已刪除");
  }, [currentWf, selectedNodeId, autoSave, setRfNodes, setRfEdges]);

  const handleNodeTest = useCallback(async () => {
    if (!selectedWFNode) return;
    setTestNodeId(selectedNodeId);
    setRfNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, status: "running" } } : n));
    try {
      const resp = await fetch(`${API}/api/paaw/skill-exec`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: selectedWFNode.appName || "translate", skillId: selectedWFNode.skillId, input: selectedWFNode.config.inputMapping }) });
      const result = await resp.json();
      if (result.error) { setRfNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, status: "error" } } : n)); showToast("❌ " + result.error); }
      else { const output = result.result || result; setRfNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, status: "success", output } } : n)); setExecLog([{ nodeId: selectedNodeId!, nodeName: selectedWFNode.name, status: "success", output, durationMs: 0 }]); setShowResult(true); }
    } catch (err: any) { setRfNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, status: "error" } } : n)); showToast("❌ " + err.message); }
    setTestNodeId(null);
  }, [selectedWFNode, selectedNodeId, setRfNodes]);

  function resolveTemplate(t: string, ctx: Record<string, any>): any {
    if (!t.startsWith("{{") || !t.endsWith("}}")) return t;
    const parts = t.slice(2, -2).trim().split("."); let v: any = ctx;
    for (const p of parts) { if (v == null) return undefined; v = v[p]; } return v;
  }

  const runWorkflow = useCallback(async () => {
    if (!currentWf) return;
    let input: any = {}; try { input = JSON.parse(workflowInput); } catch { input = { text: workflowInput }; }
    setIsRunning(true); setExecLog([]); setSelectedNodeId(null); setShowResult(true);
    const ctx: Record<string, any> = { workflow: { input }, node: {} };
    const sorted = topoSort(currentWf.nodes, currentWf.edges); const log: ExecLogEntry[] = []; let lastId: string | null = null;
    for (const node of sorted) {
      setRfNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, status: "running" } } : n));
      log.push({ nodeId: node.id, nodeName: node.name, status: "running" }); setExecLog([...log]);
      const ri: Record<string, any> = {}; for (const [k, t] of Object.entries(node.config.inputMapping || {})) ri[k] = resolveTemplate(t, ctx);
      const start = Date.now();
      try {
        const resp = await fetch(`${API}/api/paaw/skill-exec`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: node.appName || "translate", skillId: node.skillId, input: ri }) });
        const result = await resp.json(); const dur = Date.now() - start;
        if (result.error) { log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "error", error: result.error, durationMs: dur }; setRfNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, status: "error" } } : n)); break; }
        const output = result.result || result; log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "success", input: ri, output, durationMs: dur }; ctx.node[node.id] = { output }; lastId = node.id;
        setRfNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, status: "success", output } } : n));
      } catch (err: any) { log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "error", error: err.message, durationMs: Date.now() - start }; setRfNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, status: "error" } } : n)); break; }
      setExecLog([...log]);
    }
    setIsRunning(false); if (lastId) setSelectedNodeId(lastId);
  }, [currentWf, workflowInput, setRfNodes]);

  function topoSort(nodes: WFNode[], edges: WFEdge[]): WFNode[] {
    const nm = new Map(nodes.map(n => [n.id, n])); const id = new Map(nodes.map(n => [n.id, 0])); const adj = new Map(nodes.map(n => [n.id, [] as string[]]));
    for (const e of edges) { adj.get(e.source)?.push(e.target); id.set(e.target, (id.get(e.target) || 0) + 1); }
    const q: string[] = []; for (const [k, v] of id) if (v === 0) q.push(k);
    const r: WFNode[] = []; while (q.length) { const i = q.shift()!; const n = nm.get(i); if (n) r.push(n); for (const nx of adj.get(i) || []) { id.set(nx, (id.get(nx) || 0) - 1); if (id.get(nx) === 0) q.push(nx); } } return r;
  }

  return (
    <div className="flex h-full w-full relative">
      {toast && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg shadow-lg">{toast}</div>}

      {/* Left: Workflow List */}
      <div className="w-56 border-r border-stone-200 bg-stone-50 flex flex-col">
        <div className="p-3 border-b border-stone-200"><h3 className="font-semibold text-sm text-stone-700">Workflows</h3></div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {workflows.map(wf => <button key={wf.id} onClick={() => loadWorkflow(wf.id)} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${currentWf?.id === wf.id ? "bg-violet-100 text-violet-800 font-medium" : "hover:bg-stone-100 text-stone-600"}`}><span className="mr-1.5">{wf.icon}</span>{wf.name}</button>)}
        </div>
      </div>

      {/* Center */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-200 bg-white">
          <span className="mr-1">{currentWf?.icon}</span>
          <h2 className="font-semibold text-sm text-stone-800">{currentWf?.name || "Workflow Builder"}</h2>
          <span className="text-xs text-stone-400 ml-2">{currentWf?.description}</span>
          <div className="flex-1" />
          <button onClick={runWorkflow} disabled={isRunning || !currentWf} className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${isRunning ? "bg-amber-100 text-amber-700 cursor-wait" : "bg-violet-600 hover:bg-violet-700 text-white"}`}>{isRunning ? "⏳ Running..." : "▶ Run"}</button>
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-100 bg-stone-50">
          <span className="text-xs text-stone-500 font-medium">Input:</span>
          <input type="text" value={workflowInput} onChange={e => setWorkflowInput(e.target.value)} placeholder='輸入文字，例如：蘋果' className="flex-1 px-3 py-1.5 text-xs bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        {/* Canvas */}
        <div className="flex-1 relative" style={{ minHeight: 0 }}>
          <div className="w-full h-full">
            <ReactFlow nodes={rfNodes} edges={rfEdges} onNodesChange={onRfNodesChange} onEdgesChange={onRfEdgesChange} onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick} nodeTypes={nodeTypes} defaultViewport={{ x: 40, y: 80, zoom: 1 }} snapToGrid snapGrid={[16, 16]} proOptions={{ hideAttribution: true }} className="bg-stone-50">
              <Controls position="bottom-right" />
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d6d3d1" />
            </ReactFlow>
          </div>
        </div>

        {/* Bottom: Result */}
        {showResult && selectedLogEntry && (
          <div className="h-64 border-t-2 border-violet-200 bg-stone-50 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-stone-100 sticky top-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-stone-800">{selectedNodeName}</span>
                {selectedLogEntry.durationMs != null && <span className="text-xs text-stone-400">{selectedLogEntry.durationMs}ms</span>}
              </div>
              <div className="flex items-center gap-2">
                {execLog.filter(e => e.status === "success").map(e => <button key={e.nodeId} onClick={() => { setSelectedNodeId(e.nodeId); setShowResult(true); }} className={`text-xs px-2 py-1 rounded transition-colors ${selectedNodeId === e.nodeId ? "bg-violet-100 text-violet-700 font-medium" : "text-stone-500 hover:bg-stone-100"}`}>{e.nodeName}</button>)}
                <button onClick={() => { setShowResult(false); }} className="text-stone-400 hover:text-stone-600 text-sm ml-2">✕</button>
              </div>
            </div>
            <div className="p-4"><ResultCards output={selectedLogEntry.output} /></div>
          </div>
        )}
      </div>

      {/* Right: Config Panel or Execution Log */}
      {panelMode === "config" && selectedWFNode && (
        <NodeConfigPanel node={selectedWFNode} appSkills={appSkills} onUpdate={handleNodeUpdate} onDelete={handleNodeDelete} onTest={handleNodeTest} onClose={() => setSelectedNodeId(null)} testing={testNodeId === selectedNodeId} />
      )}
      {panelMode === "result" && selectedLogEntry && (
        <div className="w-56 border-l border-stone-200 bg-white flex flex-col">
          <div className="px-3 py-2 border-b border-stone-200 bg-stone-50"><div className="text-xs font-semibold text-stone-600">Execution Log {totalMs > 0 && <span className="ml-1.5 text-stone-400">{totalMs}ms</span>}</div></div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {execLog.map((entry, i) => <div key={i} onClick={() => { if (entry.output || entry.error) { setSelectedNodeId(entry.nodeId); setShowResult(true); } }} className={`flex items-start gap-1.5 px-2 py-2 rounded-lg cursor-pointer transition-colors ${selectedNodeId === entry.nodeId ? "bg-violet-50 ring-1 ring-violet-300" : entry.status === "success" ? "bg-emerald-50 hover:bg-emerald-100" : entry.status === "error" ? "bg-red-50" : entry.status === "running" ? "bg-amber-50" : "bg-stone-50"}`}>
              <span className="text-xs mt-0.5">{entry.status === "success" ? "✅" : entry.status === "error" ? "❌" : "⏳"}</span>
              <div className="flex-1 min-w-0"><div className="text-xs font-medium text-stone-700 truncate">{entry.nodeName}</div>{entry.durationMs != null && <div className="text-[10px] text-stone-400">{entry.durationMs}ms</div>}{entry.error && <div className="text-[10px] text-red-500 truncate">{entry.error}</div>}</div>
            </div>)}
          </div>
          <div className="px-3 py-2 border-t border-stone-200">
            <button onClick={() => { setShowResult(false); }} className="w-full text-xs text-violet-600 hover:text-violet-800 font-medium py-1">🔧 編輯設定</button>
          </div>
        </div>
      )}
    </div>
  );
}
