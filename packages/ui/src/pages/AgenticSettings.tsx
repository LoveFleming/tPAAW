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

export default function AgenticSettings() {
  const [bindings, setBindings] = useState<Binding[]>([]);
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
  }, []);

  const checkPlatform = useCallback(async () => {
    try {
      const r = await fetch("http://localhost:4200/api/workflows");
      setPlatformOnline(r.ok);
    } catch {
      setPlatformOnline(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch("http://localhost:4200/api/runs");
      const d = await r.json();
      setRuns(d.active || []);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    load();
    checkPlatform();
    loadRuns();
    const poll = setInterval(() => { loadRuns(); }, 5000);
    return () => clearInterval(poll);
  }, [load, checkPlatform, loadRuns]);

  const save = useCallback(async () => {
    if (!editing) return;
    setSaving(true);

    // Build full config object
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      await load();
      setEditing(null);
    } catch (err) {
      alert(String(err));
    }
    setSaving(false);
  }, [editing, bindings, load]);

  // ── Render: Editing form ──

  if (editing) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setEditing(null)} className="text-stone-400 hover:text-stone-600 text-sm">← Cancel</button>
          <h2 className="text-lg font-bold text-stone-800">編輯 {editing.defaults.title}</h2>
          <label className="ml-auto flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" checked={editing.enabled}
              onChange={e => setEditing({ ...editing, enabled: e.target.checked })} />
            啟用
          </label>
        </div>

        {/* Settings */}
        <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="工具名稱（chat tool name）" value={editing.toolName}
              onChange={v => setEditing({ ...editing, toolName: v })} mono />
            <Field label="Workflow ID" value={editing.workflowId}
              onChange={v => setEditing({ ...editing, workflowId: v })} mono />
          </div>

          <div>
            <label className="text-xs font-semibold text-stone-500 block mb-1">工具描述（林雨晴會看到這段）</label>
            <textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}
              rows={3} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg" />
          </div>

          <div>
            <label className="text-xs font-semibold text-stone-500 block mb-1">觸發關鍵字（林雨晴看到這些詞會聯想到這個工具）</label>
            <input value={editing.triggers.join("、")} onChange={e => setEditing({ ...editing, triggers: e.target.value.split("、").map(s => s.trim()).filter(Boolean) })}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg" />
          </div>

          <div className="border-t border-stone-100 pt-3">
            <h3 className="text-xs font-semibold text-stone-400 mb-3">預設參數</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="標題" value={editing.defaults.title}
                onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, title: v } })} />
              <Field label="目標聊天室 ID" value={editing.defaults.roomId}
                onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, roomId: v } })} mono />
              <Field label="截止時間" value={editing.defaults.deadline}
                onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, deadline: v } })} />
              <Field label="預設參與者（逗號分隔）" value={editing.defaults.participants.join(", ")}
                onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, participants: v.split(",").map((s: string) => s.trim()).filter(Boolean) } })} />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-stone-500 block mb-1">菜單範本（可留空，啟動時再填）</label>
            <textarea value={editing.defaults.menu} onChange={e => setEditing({ ...editing, defaults: { ...editing.defaults, menu: e.target.value } })}
              placeholder="珍奶 $65&#10;紅茶 $40&#10;奶綠 $70" rows={5}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg font-mono" />
          </div>

          <Field label="Agentic Platform URL" value={editing.agenticPlatformUrl}
            onChange={v => setEditing({ ...editing, agenticPlatformUrl: v })} mono />

          <button onClick={save} disabled={saving}
            className="w-full py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold transition disabled:opacity-50">
            {saving ? "儲存中..." : "💾 儲存設定"}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: List ──

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-stone-800">🤖 Agentic Workflow 設定</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${platformOnline ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
          {platformOnline === null ? "⏳" : platformOnline ? "Platform: Online" : "Platform: Offline"}
        </span>
      </div>

      {/* Info card */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
        <p className="text-sm text-violet-900">
          💡 這裡設定的 workflow 會自動變成<strong>林雨晴的聊天工具</strong>。
          使用者在聊天視窗說「訂下午茶」，林雨晴就會自動啟動 workflow，不用任何指令。
        </p>
      </div>

      {/* Bindings */}
      <div className="space-y-3">
        {bindings.map(b => (
          <div key={b.id} className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${b.enabled ? "bg-emerald-500" : "bg-stone-300"}`} />
              <span className="font-semibold text-stone-800">{b.defaults?.title || b.workflowId}</span>
              <span className="text-xs text-stone-400 font-mono">{b.toolName}</span>
              <button onClick={() => setEditing(b)}
                className="ml-auto px-3 py-1 text-xs bg-stone-100 hover:bg-stone-200 rounded-lg">編輯</button>
            </div>
            <p className="text-sm text-stone-600 mb-2">{b.description}</p>
            <div className="flex flex-wrap gap-1.5">
              {b.triggers?.map(t => (
                <span key={t} className="text-xs px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full">{t}</span>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-xs text-stone-500">
              <div>📋 聊天室: <code className="text-stone-700">{b.defaults?.roomId || "—"}</code></div>
              <div>⏰ 截止: <span className="text-stone-700">{b.defaults?.deadline || "—"}</span></div>
              <div>👥 參與者: <span className="text-stone-700">{b.defaults?.participants?.length || 0} 人</span></div>
            </div>
          </div>
        ))}
        {bindings.length === 0 && (
          <div className="text-center text-stone-400 py-12 bg-white rounded-xl border border-stone-200">
            尚未設定任何 agentic workflow
          </div>
        )}
      </div>

      {/* Active runs */}
      {runs.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <h3 className="text-xs font-semibold text-stone-600 mb-3">⚡ 進行中的 Workflow</h3>
          {runs.map(r => (
            <div key={r.runId} className="flex items-center gap-3 py-2 border-b border-stone-100 last:border-0">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm font-medium text-stone-800">{r.workflowName}</span>
              <span className="text-xs text-stone-400">Turn {r.turns} · {r.toolCallCount} tools</span>
              {r.lastTool && <span className="text-xs text-stone-400 font-mono ml-auto">→ {r.lastTool}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reusable field ──

function Field({ label, value, onChange, mono }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-stone-500 block mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)}
        className={`w-full px-3 py-1.5 text-sm border border-stone-200 rounded-lg ${mono ? "font-mono" : ""}`} />
    </div>
  );
}
