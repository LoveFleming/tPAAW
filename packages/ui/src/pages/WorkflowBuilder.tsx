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

// ── Custom Skill Node ──
function SkillNode({ data, selected }: NodeProps) {
  const status = data.status as string || "idle";
  const statusColor =
    status === "running" ? "bg-amber-400" :
    status === "success" ? "bg-emerald-500" :
    status === "error" ? "bg-red-500" :
    "bg-stone-400";

  return (
    <div className={`px-3 py-2 rounded-lg shadow-md border-2 min-w-[140px] transition-all ${
      selected ? "border-violet-500 shadow-violet-200" : "border-stone-200"
    } bg-white`}>
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-stone-400 !border-2 !border-white" />
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${statusColor} ${status === "running" ? "animate-pulse" : ""}`} />
        <span className="font-medium text-xs text-stone-800">{data.label as string}</span>
      </div>
      <div className="text-[10px] text-stone-400 mt-0.5">{data.skillId as string}</div>
      {data.output && (
        <div className="mt-1.5 text-[10px] bg-stone-50 rounded p-1 max-h-12 overflow-hidden font-mono">
          {typeof data.output === "string" ? data.output : JSON.stringify(data.output).slice(0, 60) + "..."}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-stone-400 !border-2 !border-white" />
    </div>
  );
}

const nodeTypes = { skill: SkillNode };

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
        // Convert to React Flow nodes
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

    // Build execution context
    const ctx: Record<string, any> = { workflow: { input }, node: {} };

    // Topological sort (linear for now: follow edges order)
    const sorted = topologicalSort(currentWf.nodes, currentWf.edges);

    const log: ExecLogEntry[] = [];

    for (const node of sorted) {
      // Mark running
      setRfNodes(nds => nds.map(n =>
        n.id === node.id ? { ...n, data: { ...n.data, status: "running" } } : n
      ));
      log.push({ nodeId: node.id, nodeName: node.name, status: "running" });
      setExecLog([...log]);

      // Resolve inputs
      const resolvedInput: Record<string, any> = {};
      for (const [key, template] of Object.entries(node.config.inputMapping || {})) {
        resolvedInput[key] = resolveTemplate(template, ctx);
      }

      const start = Date.now();
      try {
        // Call the skill exec endpoint
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
            n.id === node.id ? { ...n, data: { ...n.data, status: "error", output: result.error } } : n
          ));
          break;
        }

        const output = result.result || result;
        log[log.length - 1] = { nodeId: node.id, nodeName: node.name, status: "success", input: resolvedInput, output, durationMs };

        // Update context
        ctx.node[node.id] = { output };

        // Update node visual
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
  }, [currentWf, workflowInput, setRfNodes]);

  // ── Topological sort (simple DAG) ──
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

  // Total duration
  const totalMs = useMemo(() =>
    execLog.reduce((sum, e) => sum + (e.durationMs || 0), 0),
    [execLog]
  );

  // ── Save workflow (node positions) ──
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
    <div className="flex h-full">
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
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            proOptions={{ hideAttribution: true }}
          >
            <Controls position="bottom-right" />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d6d3d1" />
          </ReactFlow>
          </div>
        </div>

        {/* Execution Log */}
        {showLog && execLog.length > 0 && (
          <div className="h-48 border-t border-stone-200 bg-white overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-1.5 bg-stone-50 border-b border-stone-100 sticky top-0">
              <span className="text-xs font-semibold text-stone-600">
                Execution Log
                {totalMs > 0 && <span className="ml-2 text-stone-400">{totalMs}ms</span>}
              </span>
              <button onClick={() => setShowLog(false)} className="text-stone-400 hover:text-stone-600 text-xs">✕</button>
            </div>
            <div className="p-2 space-y-1 text-xs font-mono">
              {execLog.map((entry, i) => (
                <div key={i} className={`flex items-start gap-2 px-2 py-1.5 rounded ${
                  entry.status === "success" ? "bg-emerald-50" :
                  entry.status === "error" ? "bg-red-50" :
                  entry.status === "running" ? "bg-amber-50" :
                  "bg-stone-50"
                }`}>
                  <span className="mt-0.5">
                    {entry.status === "success" ? "✅" : entry.status === "error" ? "❌" : entry.status === "running" ? "⏳" : "⬜"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-stone-700">{entry.nodeName}</span>
                      {entry.durationMs != null && <span className="text-stone-400">{entry.durationMs}ms</span>}
                    </div>
                    {entry.output && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-stone-500 hover:text-stone-700">output</summary>
                        <pre className="mt-1 text-[10px] bg-white rounded p-2 overflow-x-auto max-h-32">
                          {JSON.stringify(entry.output, null, 2)}
                        </pre>
                      </details>
                    )}
                    {entry.error && (
                      <div className="text-red-600 mt-1">{entry.error}</div>
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
    </div>
  );
}
