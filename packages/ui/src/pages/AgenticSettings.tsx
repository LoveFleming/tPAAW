import { useState, useEffect, useCallback } from "react";

const API = "";

interface Binding {
  id: string;
  workflowId: string;
  toolName: string;
  description: string;
  triggers: string[];
  defaults: {
    title: string;
    menu: string;
    roomId: string;
    participants: string[];
    deadline: string;
  };
  agenticPlatformUrl: string;
  enabled: boolean;
}

interface ActiveRun {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: string;
  turns: number;
  toolCallCount: number;
  startedAt: string;
  lastTool: string | null;
}

interface WorkflowInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export default function AgenticSettings() {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [editing, setEditing] = useState<Binding | null>(null);
  const [saving, setSaving] = useState(false);
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [platformOnline, setPlatformOnline] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/agentic-bindings`);
      const d = await r.json();
      setBindings(d.bindings || []);
    } catch {}
    try {
      const r = await fetch(`${API}/api/paaw/workflows`);
      const d = await r.json();
      setWorkflows(Array.isArray(d) ? d : []);
    } catch {}
  }, []);

  const checkPlatform = useCallback(async () => {
    try {
      const r = await fetch("http://localhost:4200/api/workflows");
      setPlatformOnline(r.ok);
    } catch { setPlatformOnline(false); }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch("http://localhost:4200/api/runs");
      const d = await r.json();
      setRuns(d.active || []);
    } catch { setRuns([]); }
  }, []);

  useEffect(() => {
    load(); checkPlatform(); loadRuns();
    const poll = setInterval(loadRuns, 5000);
    return () => clearInterval(poll);
  }, [load, checkPlatform, loadRuns]);

  const save = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    const config: Record<string, any> = {};
    for (const b of bindings) {
      if (b.id === editing.id) {
        config[editing.id] = { ...editing };
        delete (config[editing.id] as any).id;
      } else {
        const { id, ...rest } = b;
        config[id] = rest;
      }
    }
    try {
      await fetch(`${API}/api/agentic-bindings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      await load(); setEditing(null);
    } catch (err) { alert(String(err)); }
    setSaving(false);
  }, [editing, bindings, load]);

  // ── Edit form ──
  if (editing) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setEditing(null)}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-stone-100 transition-colors text-stone-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-base font-bold text-stone-800">{editing.defaults.title}</h2>
          <label className="ml-auto flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" checked={editing.enabled}
              onChange={e => setEditing({ ...editing, enabled: e.target.checked })}
              className="rounded border-stone-300" />
            Enabled
          </label>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tool Name" value={editing.toolName}
              onChange={v => setEditing({ ...editing, toolName: v })} mono />
            <Field label="Workflow ID" value={editing.workflowId}
              onChange={v => setEditing({ ...editing, workflowId: v })} mono />
          </div>

          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">
              Description (shown to AI)
            </label>
            <textarea value={editing.description}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300" />
          </div>

          <Field label="Trigger Keywords (separated by 、)" full
            value={editing.triggers.join("、")}
            onChange={v => setEditing({ ...editing, triggers: v.split("、").map(s => s.trim()).filter(Boolean) })} />

          <div className="border-t border-stone-100 pt-4">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Default Parameters</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title" value={editing.defaults.title}
                onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, title: v } })} />
              <Field label="Room ID" value={editing.defaults.roomId}
                onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, roomId: v } })} mono />
              <Field label="Deadline" value={editing.defaults.deadline}
                onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, deadline: v } })} />
              <Field label="Participants (comma-separated)"
                value={editing.defaults.participants.join(", ")}
                onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, participants: v.split(",").map((s: string) => s.trim()).filter(Boolean) } })} />
            </div>
          </div>

          <Field label="Agentic Platform URL" full
            value={editing.agenticPlatformUrl}
            onChange={v => setEditing({ ...editing, agenticPlatformUrl: v })} mono />

          <button onClick={save} disabled={saving}
            className="w-full py-2.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg font-medium transition-colors disabled:opacity-40">
            {saving ? "Saving..." : "💾 Save"}
          </button>
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-base font-bold text-stone-800">Agentic Workflows</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          platformOnline ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
        }`}>
          {platformOnline === null ? "⏳" : platformOnline ? "Online" : "Offline"}
        </span>
      </div>

      {/* Info */}
      <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5">
        <p className="text-sm text-stone-600 leading-relaxed">
          These workflows become <strong>chat tools</strong> for your AI assistant. Users can trigger them with natural language — no commands needed.
        </p>
      </div>

      {/* Bindings */}
      <div className="space-y-2">
        {bindings.length > 0 && <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Chat Tool Bindings</p>}
        {bindings.map(b => (
          <div key={b.id} className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-2 h-2 rounded-full ${b.enabled ? "bg-emerald-500" : "bg-stone-300"}`} />
              <span className="text-sm font-semibold text-stone-800">{b.defaults?.title || b.workflowId}</span>
              <code className="text-xs text-stone-400">{b.toolName}</code>
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => setEditing(b)}
                  className="px-2.5 py-1 text-xs bg-stone-100 hover:bg-stone-200 rounded-lg text-stone-600 transition-colors">
                  Edit
                </button>
                <button onClick={async () => {
                  if (!confirm(`刪除 binding「${b.defaults?.title || b.workflowId}」？`)) return;
                  const config: Record<string, any> = {};
                  for (const ob of bindings) { if (ob.id !== b.id) { const { id, ...rest } = ob; config[id] = rest; } }
                  await fetch(`${API}/api/agentic-bindings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
                  load();
                }}
                  className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="刪除">🗑</button>
              </div>
            </div>
            <p className="text-sm text-stone-500 mb-2.5 leading-relaxed">{b.description}</p>
            <div className="flex flex-wrap gap-1">
              {b.triggers?.map(t => (
                <span key={t} className="text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full">{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* All Workflows */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Available Workflows ({workflows.length})</p>
        {workflows.map(wf => {
          const hasBinding = bindings.some(b => b.workflowId === wf.id);
          return (
            <div key={wf.id} className="bg-white rounded-xl border border-stone-200 shadow-sm p-3 flex items-center gap-3">
              <span className="text-lg">{wf.icon || "🔗"}</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-stone-800">{wf.name}</span>
                {wf.description && <span className="text-xs text-stone-400 ml-2">{wf.description}</span>}
              </div>
              {hasBinding
                ? <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full font-medium">已綁定</span>
                : <span className="text-xs px-2 py-0.5 bg-stone-100 text-stone-400 rounded-full">未綁定</span>}
            </div>
          );
        })}
        {workflows.length === 0 && (
          <div className="text-center py-8 bg-white rounded-xl border border-stone-200">
            <p className="text-sm text-stone-400">沒有 workflow。到 Workflow Builder 建一個吧！</p>
          </div>
        )}
      </div>

      {/* Active runs */}
      {runs.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Active Runs</p>
          </div>
          {runs.map(r => (
            <div key={r.runId} className="flex items-center gap-3 py-2 border-b border-stone-100 last:border-0">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-stone-800">{r.workflowName}</span>
                <span className="text-xs text-stone-400 ml-2">Turn {r.turns} · {r.toolCallCount} tools</span>
              </div>
              {r.lastTool && <code className="text-xs text-stone-400">→ {r.lastTool}</code>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, mono }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean;
}) {
  return (
    <div className={mono ? "" : ""}>
      <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)}
        className={`w-full px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 ${mono ? "font-mono" : ""}`} />
    </div>
  );
}
