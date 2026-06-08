import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  type Connection,
  type NodeProps,
  type Node,
  type Edge,
  BackgroundVariant,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ── Types ──
interface WFNode {
  id: string;
  type: "skill";
  skillId: string;
  appName?: string;
  name: string;
  position: { x: number; y: number };
  config: { inputMapping: Record<string, string> };
}
interface WFEdge {
  id: string;
  source: string;
  target: string;
}
interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  nodes: WFNode[];
  edges: WFEdge[];
  inputSchema: { properties: Record<string, any>; required: string[] };
}

interface ExecLogEntry {
  nodeId: string;
  nodeName: string;
  status: "running" | "success" | "error" | "pending";
  input?: any;
  output?: any;
  error?: string;
  durationMs?: number;
}

// ── API base ──
const API = "http://127.0.0.1:4097";

// ── Preview text helper ──
function previewText(output: any): string {
  if (!output) return "";
  if (typeof output === "string") return output.slice(0, 30);
  if (output.translation) return output.translation.slice(0, 30);
  if (output.cards) return `${output.cards.length} 張卡片`;
  if (output.idioms) return `${output.idioms.length} 個片語`;
  const str = JSON.stringify(output);
  return str.slice(0, 30);
}

// ── Custom Skill Node ──
function SkillNode({ data, selected }: NodeProps) {
  const status = data.status as string || "idle";
  const statusColor =
    status === "running" ? "bg-amber-400" :
    status === "success" ? "bg-emerald-500" :
    status === "error" ? "bg-red-500" :
    "bg-stone-300";

  const statusIcon =
    status === "running" ? "⏳" :
    status === "success" ? "✅" :
    status === "error" ? "❌" :
    "";

  const preview = data.output ? previewText(data.output) : "";

  return (
    <div className={`px-4 py-3 rounded-xl shadow-sm border transition-all cursor-pointer ${
      selected ? "border-violet-400 shadow-md ring-2 ring-violet-100" : "border-stone-200 hover:border-stone-300 hover:shadow-sm"
    } bg-white`}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-stone-300 !border-2 !border-white" />
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusColor} ${status === "running" ? "animate-pulse" : ""}`} />
        <span className="font-semibold text-sm text-stone-800">{data.label as string}</span>
        {statusIcon && <span className="text-xs">{statusIcon}</span>}
      </div>
      <div className="text-xs text-stone-400 ml-[18px]">{data.skillId as string}</div>
      {preview && (
        <div className="mt-1.5 text-xs text-stone-500 ml-[18px] truncate">
          {preview}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-stone-300 !border-2 !border-white" />
    </div>
  );
}

const nodeTypes = { skill: SkillNode };

// ── Result Panel ──
function ResultPanel({ entry, nodeName, onClose }: { entry: ExecLogEntry | null; nodeName: string; onClose: () => void }) {
  if (!entry || !entry.output) return null;

  const output = entry.output;

  // Try to render structured output nicely
  const renderOutput = () => {
    // Translation result
    if (output.translation) {
      return (
        <div className="space-y-3">
          <div>
            <div className="text-xs font-semibold text-stone-500 mb-1">翻譯結果</div>
            <div className="text-sm text-stone-800 bg-white rounded-lg p-3 border border-stone-100">{output.translation}</div>
          </div>
          {output.special_words && output.special_words.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-stone-500 mb-1">特殊詞 ({output.special_words.length})</div>
              <div className="space-y-1">
                {output.special_words.map((w: any, i: number) => (
                  <div key={i} className="text-xs bg-white rounded-lg p-2 border border-stone-100 flex justify-between">
                    <span className="font-medium text-stone-700">{w.word}</span>
                    <span className="text-stone-400">{w.type} → {w.translation}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Idiom/Card result
    if (output.cards || output.idioms) {
      const items = output.cards || output.idioms || [];
      return (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-stone-500 mb-1">
            {output.cards ? `學習卡 (${items.length})` : `片語 (${items.length})`}
          </div>
          <div className="space-y-2">
            {items.map((card: any, i: number) => (
              <div key={i} className="bg-white rounded-lg p-3 border border-stone-100 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-stone-800">{card.word || card.phrase}</span>
                  {card.phonetic && <span className="text-xs text-stone-400">{card.phonetic}</span>}
                  {card.translation && <span className="text-xs text-stone-500">→ {card.translation}</span>}
                </div>
                {card.classic_sentence && (
                  <div className="text-xs text-stone-600">
                    <span className="text-stone-400">例句：</span>
                    {typeof card.classic_sentence === "object"
                      ? `${card.classic_sentence.en || ""} — ${card.classic_sentence.zh || ""}`
                      : card.classic_sentence}
                  </div>
                )}
                {card.joke && (
                  <div className="text-xs text-amber-600 italic">😄 {card.joke}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Generic JSON output
    return (
      <pre className="text-xs bg-white rounded-lg p-3 border border-stone-100 overflow-auto max-h-[60vh] whitespace-pre-wrap text-stone-700">
        {JSON.stringify(output, null, 2)}
      </pre>
    );
  };

  return (
    <div className="w-80 border-l border-stone-200 bg-stone-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 bg-white">
        <div>
          <div className="text-sm font-semibold text-stone-800">{nodeName}</div>
          {entry.durationMs != null && <div className="text-xs text-stone-400">{entry.durationMs}ms</div>}
        </div>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-sm">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {renderOutput()}
      </div>
    </div>
  );
}

// ── Main Component ──
export default function WorkflowBuilder() {
  // Workflow list & current
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [currentWf, setCurrentWf] = useState<WorkflowDef | null>(null);

  // React Flow state
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState<Edge>([]);

  // Execution
  const [execLog, setExecLog] = useState<ExecLogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [workflowInput, setWorkflowInput] = useState("");
  const [showLog, setShowLog] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Selected node for Result Panel
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Derived: selected log entry
  const selectedLogEntry = useMemo(() => {
    if (!selectedNodeId) return null;
    return execLog.find(e => e.nodeId === selectedNodeId && (e.status === "success" || e.status === "error")) || null;
  }, [selectedNodeId, execLog]);

  // Derived: selected node name
  const selectedNodeName = useMemo(() => {
    if (!selectedNodeId || !currentWf) return "";
    return currentWf.nodes.find(n => n.id === selectedNodeId)?.name || "";
  }, [selectedNodeId, currentWf]);

  // ── Load workflow list ──
  useEffect(() => {
    fetch(`${API}/api/paaw/workflows`)
      .then(r => r.json())
      .then((list: WorkflowDef[]) => {
        setWorkflows(list);
        if (list.length > 0 && !currentWf) loadWorkflow(list[0].id);
      })
      .catch(() => {});
  }, []);

  // ── Load single workflow ──
  const loadWorkflow = useCallback((id: string) => {
    fetch(`${API}/api/paaw/workflows/${id}`)
      .then(r => r.json())
      .then((wf: WorkflowDef) => {
        setCurrentWf(wf);
        setExecLog([]);
        setSelectedNodeId(null);
        const nodes: Node[] = wf.nodes.map(n => ({
          id: n.id,
          type: "skill",
          position: n.position,
          data: { label: n.name, skillId: n.skillId, status: "idle" },
        }));
        const edges: Edge[] = wf.edges.map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: { stroke: "#a1a1aa", strokeWidth: 2 },
        }));
        setRfNodes(nodes);
        setRfEdges(edges);
      })
      .catch(() => {});
  }, [setRfNodes, setRfEdges]);

  // ── Handle node click ──
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(prev => prev === node.id ? null : node.id);
  }, []);

  // ── Handle pane click (deselect) ──
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // ── Connect nodes via drag ──
  const onConnect = useCallback((connection: Connection) => {
    setRfEdges(eds => addEdge({
      ...connection,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: { stroke: "#a1a1aa", strokeWidth: 2 },
    }, eds));
  }, [setRfEdges]);

  // ── Resolve template values ──
  function resolveTemplate(template: string, context: Record<string, any>): any {
    if (!template.startsWith("{{") || !template.endsWith("}}")) return template;
    const path = template.slice(2, -2).trim();
    const parts = path.split(".");
    let val: any = context;
    for (const p of parts) {
      if (val == null) return undefined;
      val = val[p];
    }
    return val;
  }

  // ── Run workflow ──
  const runWorkflow = useCallback(async () => {
    if (!currentWf) return;
    let input: any = {};
    try { input = JSON.parse(workflowInput); } catch { input = { text: workflowInput }; }

    setIsRunning(true);
    setExecLog([]);
    setSelectedNodeId(null);

    const ctx: Record<string, any> = { workflow: { input }, node: {} };
    const sorted = topologicalSort(currentWf.nodes, currentWf.edges);
    const log: ExecLogEntry[] = [];
    let lastSuccessId: string | null = null;

    for (const node of sorted) {
      setRfNodes(nds => nds.map(n =>
        n.id === node.id ? { ...n, data: { ...n.data, status: "running" } } : n
      ));
      log.push({ nodeId: node.id, nodeName: node.name, status: "running" });
      setExecLog([...log]);

      const resolvedInput: Record<string, any> = {};
      for (const [key, template] of Object.entries(node.config.inputMapping || {})) {
        resolvedInput[key] = resolveTemplate(template, ctx);
      }

      const start = Date.now();
      try {
        const resp = await fetch(`${API}/api/paaw/skill-exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appId: node.appName || "translate",
            skillId: node.skillId,
            input: resolvedInput,
          }),
        });
        const result = await resp.json();
        const durationMs = Date.now() - start;

        if (result.error) {
          log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "error", error: result.error, durationMs };
          setRfNodes(nds => nds.map(n =>
            n.id === node.id ? { ...n, data: { ...n.data, status: "error" } } : n
          ));
          break;
        }

        const output = result.result || result;
        log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "success", input: resolvedInput, output, durationMs };
        ctx.node[node.id] = { output };
        lastSuccessId = node.id;

        setRfNodes(nds => nds.map(n =>
          n.id === node.id ? { ...n, data: { ...n.data, status: "success", output } } : n
        ));
      } catch (err: any) {
        const durationMs = Date.now() - start;
        log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "error", error: err.message, durationMs };
        setRfNodes(nds => nds.map(n =>
          n.id === node.id ? { ...n, data: { ...n.data, status: "error" } } : n
        ));
        break;
      }
      setExecLog([...log]);
    }

    setIsRunning(false);
    // Auto-select last successful node
    if (lastSuccessId) {
      setSelectedNodeId(lastSuccessId);
    }
  }, [currentWf, workflowInput, setRfNodes]);

  // ── Topological sort ──
  function topologicalSort(nodes: WFNode[], edges: WFEdge[]): WFNode[] {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const inDegree = new Map(nodes.map(n => [n.id, 0]));
    const adj = new Map(nodes.map(n => [n.id, [] as string[]]));
    for (const e of edges) {
      adj.get(e.source)?.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    const sorted: WFNode[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const n = nodeMap.get(id);
      if (n) sorted.push(n);
      for (const next of adj.get(id) || []) {
        inDegree.set(next, (inDegree.get(next) || 0) - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }
    return sorted;
  }

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [execLog]);

  const totalMs = useMemo(() =>
    execLog.reduce((sum, e) => sum + (e.durationMs || 0), 0),
    [execLog]
  );

  // ── Save workflow ──
  const saveWorkflow = useCallback(() => {
    if (!currentWf) return;
    const updated = {
      ...currentWf,
      nodes: currentWf.nodes.map(n => {
        const rfNode = rfNodes.find(rn => rn.id === n.id);
        return rfNode ? { ...n, position: rfNode.position } : n;
      }),
      edges: rfEdges.map(e => ({ id: e.id, source: e.source, target: e.target })),
    };
    fetch(`${API}/api/paaw/workflows/${currentWf.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    }).then(() => {
      setCurrentWf(updated);
      setWorkflows(wfs => wfs.map(w => w.id === updated.id ? updated : w));
    });
  }, [currentWf, rfNodes, rfEdges]);

  // ── Render ──
  return (
    <div className="flex h-full w-full">
      {/* ── Left: Workflow List ── */}
      <div className="w-56 border-r border-stone-200 bg-stone-50 flex flex-col">
        <div className="p-3 border-b border-stone-200">
          <h3 className="font-semibold text-sm text-stone-700">Workflows</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {workflows.map(wf => (
            <button
              key={wf.id}
              onClick={() => loadWorkflow(wf.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                currentWf?.id === wf.id
                  ? "bg-violet-100 text-violet-800 font-medium"
                  : "hover:bg-stone-100 text-stone-600"
              }`}
            >
              <span className="mr-1.5">{wf.icon}</span>
              {wf.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Center: Canvas + Log ── */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-200 bg-white">
          <span className="mr-1">{currentWf?.icon}</span>
          <h2 className="font-semibold text-sm text-stone-800">{currentWf?.name || "Workflow Builder"}</h2>
          <span className="text-xs text-stone-400 ml-2">{currentWf?.description}</span>
          <div className="flex-1" />
          <button
            onClick={saveWorkflow}
            className="px-3 py-1.5 text-xs rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors"
          >
            💾 Save
          </button>
          <button
            onClick={runWorkflow}
            disabled={isRunning || !currentWf}
            className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              isRunning
                ? "bg-amber-100 text-amber-700 cursor-wait"
                : "bg-violet-600 hover:bg-violet-700 text-white"
            }`}
          >
            {isRunning ? "⏳ Running..." : "▶ Run"}
          </button>
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-100 bg-stone-50">
          <span className="text-xs text-stone-500 font-medium">Input:</span>
          <input
            type="text"
            value={workflowInput}
            onChange={e => setWorkflowInput(e.target.value)}
            placeholder='輸入文字，例如：蘋果'
            className="flex-1 px-3 py-1.5 text-xs bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        {/* Canvas */}
        <div className="flex-1 relative" style={{ minHeight: 0 }}>
          <div className="w-full h-full">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onRfNodesChange}
            onEdgesChange={onRfEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 40, y: 80, zoom: 1 }}
            snapToGrid
            snapGrid={[16, 16]}
            proOptions={{ hideAttribution: true }}
            className="bg-stone-50"
          >
            <Controls position="bottom-right" />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d6d3d1" />
          </ReactFlow>
          </div>
        </div>

        {/* Execution Log */}
        {showLog && execLog.length > 0 && (
          <div className="h-44 border-t border-stone-200 bg-white overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-1.5 bg-stone-50 border-b border-stone-100 sticky top-0">
              <span className="text-xs font-semibold text-stone-600">
                Execution Log
                {totalMs > 0 && <span className="ml-2 text-stone-400">{totalMs}ms</span>}
              </span>
              <button onClick={() => setShowLog(false)} className="text-stone-400 hover:text-stone-600 text-xs">✕</button>
            </div>
            <div className="p-2 space-y-1 text-xs font-mono">
              {execLog.map((entry, i) => (
                <div
                  key={i}
                  onClick={() => { if (entry.output) setSelectedNodeId(entry.nodeId); }}
                  className={`flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    selectedNodeId === entry.nodeId ? "ring-1 ring-violet-300 bg-violet-50" :
                    entry.status === "success" ? "bg-emerald-50 hover:bg-emerald-100" :
                    entry.status === "error" ? "bg-red-50" :
                    entry.status === "running" ? "bg-amber-50" :
                    "bg-stone-50"
                  }`}
                >
                  <span className="mt-0.5">
                    {entry.status === "success" ? "✅" : entry.status === "error" ? "❌" : entry.status === "running" ? "⏳" : "⬜"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-stone-700">{entry.nodeName}</span>
                      {entry.durationMs != null && <span className="text-stone-400">{entry.durationMs}ms</span>}
                    </div>
                    {entry.error && (
                      <div className="text-red-600 mt-0.5">{entry.error}</div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
        {!showLog && execLog.length > 0 && (
          <button
            onClick={() => setShowLog(true)}
            className="absolute bottom-4 right-4 px-3 py-1.5 bg-stone-800 text-white text-xs rounded-lg shadow-lg hover:bg-stone-700"
          >
            📋 Show Log
          </button>
        )}
      </div>

      {/* ── Right: Result Panel ── */}
      {selectedLogEntry && (
        <ResultPanel
          entry={selectedLogEntry}
          nodeName={selectedNodeName}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}
