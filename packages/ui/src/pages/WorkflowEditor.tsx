import { useState, useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow, Controls, Background, useNodesState, useEdgesState, addEdge,
  Handle, Position, type NodeProps, type Node, type Edge,
  BackgroundVariant, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ── Types ──
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
interface AppSkill { id: string; name: string; icon: string; skills: string[]; }

const API = "http://127.0.0.1:4097";

// ── Start Node ──
function StartNode({ data, selected }: NodeProps) {
  return (
    <div className={`px-5 py-3 rounded-2xl shadow-sm border-2 transition-all ${
      selected ? "border-emerald-500 shadow-lg ring-4 ring-emerald-200 bg-emerald-50" : "border-emerald-300 bg-emerald-50/80"}`}>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-white" />
      <div className="flex items-center gap-2">
        <span className="text-lg">🟢</span>
        <div>
          <div className="font-bold text-sm text-emerald-800">Start</div>
          <div className="text-[10px] text-emerald-600">輸入起點</div>
        </div>
      </div>
    </div>
  );
}

// ── End Node ──
function EndNode({ data, selected }: NodeProps) {
  const target = (data.outputTarget as string) || "chat";
  return (
    <div className={`px-5 py-3 rounded-2xl shadow-sm border-2 transition-all ${
      selected ? "border-rose-500 shadow-lg ring-4 ring-rose-200 bg-rose-50" : "border-rose-300 bg-rose-50/80"}`}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-rose-400 !border-2 !border-white" />
      <div className="flex items-center gap-2">
        <span className="text-lg">🔴</span>
        <div>
          <div className="font-bold text-sm text-rose-800">End</div>
          <div className="text-[10px] text-rose-600">{target === "chat" ? "💬 輸出到聊天" : "📁 輸出到檔案"}</div>
        </div>
      </div>
    </div>
  );
}

// ── Skill Node ──
function SkillNode({ data, selected }: NodeProps) {
  return (
    <div className={`px-4 py-3 rounded-xl shadow-sm border-2 transition-all cursor-pointer ${
      selected ? "border-violet-500 shadow-lg ring-4 ring-violet-200 bg-violet-50"
      : "border-stone-200 hover:border-stone-300 bg-white"}`}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-stone-300 !border-2 !border-white" />
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full bg-violet-400" />
        <span className="font-semibold text-sm text-stone-800">{data.label as string}</span>
      </div>
      <div className="text-xs text-stone-400 ml-[18px]">{data.skillId as string}</div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-stone-300 !border-2 !border-white" />
    </div>
  );
}

const nodeTypes = { start: StartNode, end: EndNode, skill: SkillNode };

// ── Node Config Panel ──
function NodeConfigPanel({ node, appSkills, onUpdate, onDelete, onClose }: {
  node: WFNode; appSkills: AppSkill[]; onUpdate: (p: Partial<WFNode>) => void; onDelete: () => void; onClose: () => void;
}) {
  const mapping = node.config.inputMapping || {};
  const selApp = appSkills.find(a => a.id === node.appName);
  const availSkills = selApp ? selApp.skills : [];
  const poolApp = appSkills.find(a => a.id === "_pool");

  // Start node config
  if (node.type === "start") {
    return (
      <div className="w-72 border-l border-stone-200 bg-white flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 bg-emerald-50">
          <span className="text-sm font-semibold text-emerald-800">🟢 Start 設定</span>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-sm">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-stone-500 block mb-1">名稱</label>
            <input type="text" value={node.name} onChange={e => onUpdate({ name: e.target.value })}
              className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300" />
          </div>
          <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
            <div className="text-xs font-semibold text-emerald-700 mb-1">💡 說明</div>
            <div className="text-xs text-emerald-600 space-y-1">
              <div>Start 是 workflow 的入口，使用者輸入的資料從這裡開始。</div>
              <div>後面的積木用 <code className="bg-emerald-100 px-1 rounded">{"{{workflow.input.xxx}}"}</code> 取得輸入值。</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // End node config
  if (node.type === "end") {
    return (
      <div className="w-72 border-l border-stone-200 bg-white flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 bg-rose-50">
          <span className="text-sm font-semibold text-rose-800">🔴 End 設定</span>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-sm">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-stone-500 block mb-1">名稱</label>
            <input type="text" value={node.name} onChange={e => onUpdate({ name: e.target.value })}
              className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-300" />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 block mb-2">輸出目的地</label>
            <div className="space-y-2">
              <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all ${
                (node.config.outputTarget || "chat") === "chat" ? "border-violet-400 bg-violet-50" : "border-stone-200 hover:border-stone-300"}`}>
                <input type="radio" name="outputTarget" value="chat" checked={(node.config.outputTarget || "chat") === "chat"}
                  onChange={() => onUpdate({ config: { ...node.config, outputTarget: "chat" } })} className="accent-violet-600" />
                <div>
                  <div className="text-sm font-medium text-stone-800">💬 聊天視窗</div>
                  <div className="text-[10px] text-stone-500">結果顯示在 PAAW 聊天視窗</div>
                </div>
              </label>
              <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all ${
                node.config.outputTarget === "file" ? "border-amber-400 bg-amber-50" : "border-stone-200 hover:border-stone-300"}`}>
                <input type="radio" name="outputTarget" value="file" checked={node.config.outputTarget === "file"}
                  onChange={() => onUpdate({ config: { ...node.config, outputTarget: "file" } })} className="accent-amber-600" />
                <div>
                  <div className="text-sm font-medium text-stone-800">📁 檔案路徑</div>
                  <div className="text-[10px] text-stone-500">結果寫入指定檔案</div>
                </div>
              </label>
            </div>
          </div>
          {node.config.outputTarget === "file" && (
            <div>
              <label className="text-xs font-semibold text-stone-500 block mb-1">檔案路徑</label>
              <input type="text" value={node.config.outputFilePath || ""}
                onChange={e => onUpdate({ config: { ...node.config, outputFilePath: e.target.value } })}
                className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono"
                placeholder="/path/to/output.json" />
              <div className="text-[10px] text-stone-400 mt-1">支援 <code className="bg-stone-100 px-1 rounded">{"{{workflow.input.xxx}}"}</code> 模板</div>
            </div>
          )}
          <div className="bg-rose-50 rounded-lg p-3 border border-rose-200">
            <div className="text-xs font-semibold text-rose-700 mb-1">💡 說明</div>
            <div className="text-xs text-rose-600 space-y-1">
              <div>End 是 workflow 的終點，前一個積木的輸出會送到這裡。</div>
              <div>選「聊天視窗」→ 結果顯示在 PAAW chat</div>
              <div>選「檔案路徑」→ 結果寫入指定檔案</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Skill node config (original)
  return (
    <div className="w-72 border-l border-stone-200 bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 bg-stone-50">
        <span className="text-sm font-semibold text-stone-800">🔧 積木設定</span>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-sm">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="text-xs font-semibold text-stone-500 block mb-1">名稱</label>
          <input type="text" value={node.name} onChange={e => onUpdate({ name: e.target.value })} className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div>
          <label className="text-xs font-semibold text-stone-500 block mb-1">App</label>
          <select value={node.appName || ""} onChange={e => { const a = appSkills.find(x => x.id === e.target.value); onUpdate({ appName: e.target.value, skillId: a?.skills?.[0] || "" }); }} className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300">
            <option value="">選擇 App</option>
            {appSkills.filter(a => a.id !== "_pool").map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-stone-500 block mb-1">Skill</label>
          <select value={node.skillId || ""} onChange={e => onUpdate({ skillId: e.target.value })} className="w-full px-3 py-1.5 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300">
            <option value="">選擇 Skill</option>
            {availSkills.map(s => <option key={s} value={s}>{s}</option>)}
            {poolApp?.skills?.map(s => <option key={s} value={s}>🗂️ {s}</option>)}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-stone-500">輸入映射</label>
            <button onClick={() => { let k = "input_1", n = 1; while (mapping[k]) { n++; k = "input_" + n; } onUpdate({ config: { inputMapping: { ...mapping, [k]: "" } } }); }} className="text-xs text-violet-600 hover:text-violet-800 font-medium">+ 新增</button>
          </div>
          <div className="space-y-2">
            {Object.entries(mapping).map(([key, val]) => (
              <div key={key} className="space-y-1">
                <div className="flex items-center gap-1">
                  <input type="text" value={key} onChange={e => { const n = { ...mapping }; delete n[key]; n[e.target.value] = val; onUpdate({ config: { inputMapping: n } }); }} className="flex-1 px-2 py-1 text-xs bg-stone-50 border border-stone-200 rounded font-mono" placeholder="key" />
                  <button onClick={() => { const n = { ...mapping }; delete n[key]; onUpdate({ config: { inputMapping: n } }); }} className="text-stone-400 hover:text-red-500 text-xs">✕</button>
                </div>
                <input type="text" value={val} onChange={e => onUpdate({ config: { inputMapping: { ...mapping, [key]: e.target.value } } })} className="w-full px-2 py-1 text-xs bg-white border border-stone-200 rounded font-mono" placeholder="{{workflow.input.text}} 或固定值" />
              </div>
            ))}
          </div>
          {Object.keys(mapping).length === 0 && <div className="text-xs text-stone-400 italic mt-1">尚未設定映射</div>}
          <div className="mt-2 text-[10px] text-stone-400 space-y-0.5">
            <div>💡 <code className="bg-stone-100 px-1 rounded">{"{{workflow.input.xxx}}"}</code> — workflow 輸入</div>
            <div>💡 <code className="bg-stone-100 px-1 rounded">{"{{node-1.output.xxx}}"}</code> — 前一個節點輸出</div>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-stone-200">
        <button onClick={onDelete} className="w-full py-1.5 text-xs rounded-lg text-red-600 hover:bg-red-50 border border-red-200 transition-colors">🗑 刪除節點</button>
      </div>
    </div>
  );
}

// ── Main: Workflow Builder ──
export default function WorkflowEditor() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [currentWf, setCurrentWf] = useState<WorkflowDef | null>(null);
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [appSkills, setAppSkills] = useState<AppSkill[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const selectedWFNode = useMemo(() => { if (!selectedNodeId || !currentWf) return null; return currentWf.nodes.find(n => n.id === selectedNodeId) || null; }, [selectedNodeId, currentWf]);

  useEffect(() => { fetch(`${API}/api/paaw/app-skills`).then(r => r.json()).then(setAppSkills).catch(() => {}); }, []);
  useEffect(() => {
    fetch(`${API}/api/paaw/workflows`).then(r => r.json()).then((l: WorkflowDef[]) => {
      setWorkflows(l);
      if (l.length > 0 && !currentWf) loadWorkflow(l[0].id);
    }).catch(() => {});
  }, []);

  const toRFNode = (n: WFNode): Node => {
    if (n.type === "start") return { id: n.id, type: "start", position: n.position, data: { label: "Start" } };
    if (n.type === "end") return { id: n.id, type: "end", position: n.position, data: { label: "End", outputTarget: n.config.outputTarget || "chat" } };
    return { id: n.id, type: "skill", position: n.position, data: { label: n.name, skillId: n.skillId || "" } };
  };

  const loadWorkflow = useCallback((id: string) => {
    fetch(`${API}/api/paaw/workflows/${id}`).then(r => r.json()).then((wf: WorkflowDef) => {
      setCurrentWf(wf); setSelectedNodeId(null);
      setRfNodes(wf.nodes.map(toRFNode));
      setRfEdges(wf.edges.map(e => ({ id: e.id, source: e.source, target: e.target, animated: true, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }, style: { stroke: "#a1a1aa", strokeWidth: 2 } })));
    }).catch(() => {});
  }, [setRfNodes, setRfEdges]);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => { setSelectedNodeId(p => p === node.id ? null : node.id); }, []);
  const onPaneClick = useCallback(() => { setSelectedNodeId(null); }, []);
  const onConnect = useCallback((c: any) => { setRfEdges(eds => addEdge({ ...c, animated: true, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }, style: { stroke: "#a1a1aa", strokeWidth: 2 } }, eds)); }, [setRfEdges]);

  const autoSave = useCallback((wf: WorkflowDef) => {
    const updated = { ...wf, nodes: wf.nodes.map(n => { const r = rfNodes.find(rn => rn.id === n.id); return r ? { ...n, position: r.position } : n; }), edges: rfEdges.map(e => ({ id: e.id, source: e.source, target: e.target })) };
    fetch(`${API}/api/paaw/workflows/${wf.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) }).then(() => { setCurrentWf(updated); setWorkflows(ws => ws.map(w => w.id === updated.id ? updated : w)); });
  }, [rfNodes, rfEdges]);

  const handleNodeUpdate = useCallback((patch: Partial<WFNode>) => {
    if (!currentWf || !selectedNodeId) return;
    const updated = { ...currentWf, nodes: currentWf.nodes.map(n => n.id === selectedNodeId ? { ...n, ...patch, config: patch.config ? { ...n.config, ...patch.config } : n.config } : n) };
    setCurrentWf(updated);
    // Update ReactFlow visual
    setRfNodes(nds => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const d = { ...n.data };
      if (patch.name) d.label = patch.name;
      if (patch.skillId) d.skillId = patch.skillId;
      if (patch.config?.outputTarget) d.outputTarget = patch.config.outputTarget;
      return { ...n, data: d };
    }));
    autoSave(updated); showToast("✅ Saved!");
  }, [currentWf, selectedNodeId, autoSave, setRfNodes]);

  const handleNodeDelete = useCallback(() => {
    if (!currentWf || !selectedNodeId) return;
    const node = currentWf.nodes.find(n => n.id === selectedNodeId);
    if (node?.type === "start" || node?.type === "end") { showToast("⚠️ 不能刪除 Start/End"); return; }
    const updated = { ...currentWf, nodes: currentWf.nodes.filter(n => n.id !== selectedNodeId), edges: currentWf.edges.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId) };
    setCurrentWf(updated); setRfNodes(nds => nds.filter(n => n.id !== selectedNodeId)); setRfEdges(eds => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null); autoSave(updated); showToast("🗑 已刪除");
  }, [currentWf, selectedNodeId, autoSave, setRfNodes, setRfEdges]);

  const addNode = useCallback(() => {
    if (!currentWf) return;
    const id = "node-" + Date.now();
    const newNode: WFNode = { id, type: "skill", skillId: "", name: "新積木", position: { x: 300 + Math.random() * 200, y: 80 + Math.random() * 120 }, config: { inputMapping: {} } };
    const updated = { ...currentWf, nodes: [...currentWf.nodes, newNode] };
    setCurrentWf(updated);
    setRfNodes(nds => [...nds, toRFNode(newNode)]);
    autoSave(updated); setSelectedNodeId(id);
  }, [currentWf, autoSave, setRfNodes]);

  const addWorkflow = useCallback(async () => {
    const id = "wf-" + Date.now();
    const startNode: WFNode = { id: "start", type: "start", name: "Start", position: { x: 50, y: 120 }, config: { inputMapping: {} } };
    const endNode: WFNode = { id: "end", type: "end", name: "End", position: { x: 700, y: 120 }, config: { inputMapping: {}, outputTarget: "chat" } };
    const wf: WorkflowDef = {
      id, name: "新 Workflow", description: "", icon: "🔗",
      nodes: [startNode, endNode], edges: [],
      inputSchema: { properties: { text: { type: "string" } }, required: ["text"] },
    };
    await fetch(`${API}/api/paaw/workflows`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wf) });
    setWorkflows(prev => [...prev, wf]);
    loadWorkflow(id);
  }, [loadWorkflow]);

  return (
    <div className="flex h-full w-full relative">
      {toast && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg shadow-lg">{toast}</div>}

      {/* Left: Workflow List */}
      <div className="w-56 border-r border-stone-200 bg-stone-50 flex flex-col">
        <div className="p-3 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-stone-700">🔗 Workflows</h3>
          <button onClick={addWorkflow} className="text-violet-600 hover:text-violet-800 text-sm font-medium">＋</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {workflows.map(wf => (
            <button key={wf.id} onClick={() => loadWorkflow(wf.id)} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${currentWf?.id === wf.id ? "bg-violet-100 text-violet-800 font-medium" : "hover:bg-stone-100 text-stone-600"}`}>
              <span className="mr-1.5">{wf.icon}</span>{wf.name}
            </button>
          ))}
        </div>
      </div>

      {/* Center: Canvas */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-200 bg-white">
          <span className="mr-1">{currentWf?.icon || "🔗"}</span>
          <h2 className="font-semibold text-sm text-stone-800">{currentWf?.name || "Workflow Builder"}</h2>
          <span className="text-xs text-stone-400 ml-2">{currentWf?.description}</span>
          <div className="flex-1" />
          <button onClick={addNode} className="px-3 py-1.5 text-xs rounded-lg font-medium bg-violet-600 hover:bg-violet-700 text-white transition-colors">+ 積木</button>
        </div>
        <div className="flex-1 relative" style={{ minHeight: 0 }}>
          <div className="w-full h-full">
            <ReactFlow nodes={rfNodes} edges={rfEdges} onNodesChange={onRfNodesChange} onEdgesChange={onRfEdgesChange} onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick}
              nodeTypes={nodeTypes} defaultViewport={{ x: 40, y: 80, zoom: 1 }} snapToGrid snapGrid={[16, 16]} proOptions={{ hideAttribution: true }} className="bg-stone-50">
              <Controls position="bottom-right" />
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d6d3d1" />
            </ReactFlow>
          </div>
        </div>
      </div>

      {/* Right: Node Config Panel */}
      {selectedWFNode && (
        <NodeConfigPanel node={selectedWFNode} appSkills={appSkills} onUpdate={handleNodeUpdate} onDelete={handleNodeDelete} onClose={() => setSelectedNodeId(null)} />
      )}
    </div>
  );
}
