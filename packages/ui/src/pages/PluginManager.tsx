import { useState, useEffect, useCallback } from "react";

const API = "";

interface Plugin {
  id: string;
  name: string;
  icon?: string;
  url: string;
  enabled: boolean;
}

export default function PluginManager() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [editing, setEditing] = useState<Plugin | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/plugins`);
      const d = await r.json();
      setPlugins(d.plugins || []);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveAll = useCallback(async (list: Plugin[]) => {
    setSaving(true);
    const config: Record<string, any> = {};
    for (const p of list) {
      const { id, ...rest } = p;
      config[id] = rest;
    }
    try {
      await fetch(`${API}/api/plugins`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setPlugins(list);
      setEditing(null);
    } catch (err) { alert(String(err)); }
    setSaving(false);
  }, []);

  const toggle = useCallback((p: Plugin) => {
    const updated = plugins.map(x => x.id === p.id ? { ...x, enabled: !x.enabled } : x);
    saveAll(updated);
  }, [plugins, saveAll]);

  const remove = useCallback((p: Plugin) => {
    if (!confirm(`Delete plugin "${p.name}"?`)) return;
    const updated = plugins.filter(x => x.id !== p.id);
    saveAll(updated);
  }, [plugins, saveAll]);

  const add = useCallback(() => {
    setEditing({
      id: `plugin-${Date.now()}`,
      name: "New Plugin",
      icon: "🔌",
      url: "http://localhost:0000",
      enabled: true,
    });
  }, []);

  const saveEdit = useCallback(() => {
    if (!editing) return;
    const exists = plugins.some(p => p.id === editing.id);
    const updated = exists
      ? plugins.map(p => p.id === editing.id ? editing : p)
      : [...plugins, editing];
    saveAll(updated);
  }, [editing, plugins, saveAll]);

  // ── Edit view ──
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
          <h2 className="text-base font-bold text-stone-800">{plugins.some(p => p.id === editing.id) ? "Edit" : "Add"} Plugin</h2>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">Icon</label>
              <input value={editing.icon || ""} onChange={e => setEditing({ ...editing, icon: e.target.value })}
                placeholder="🔌"
                className="w-full px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg text-center text-lg" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">Name</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">ID (unique key)</label>
            <input value={editing.id} onChange={e => setEditing({ ...editing, id: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-stone-300" />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">URL</label>
            <input value={editing.url} onChange={e => setEditing({ ...editing, url: e.target.value })}
              placeholder="http://localhost:4200"
              className="w-full px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-stone-300" />
            <p className="text-xs text-stone-400 mt-1">This URL will be embedded as an iframe in the sidebar.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" checked={editing.enabled}
              onChange={e => setEditing({ ...editing, enabled: e.target.checked })}
              className="rounded border-stone-300" />
            Enabled
          </label>
          <button onClick={saveEdit} disabled={saving}
            className="w-full py-2.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg font-medium transition-colors disabled:opacity-40">
            {saving ? "Saving..." : "💾 Save"}
          </button>
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-stone-800">Plugins</h2>
        <button onClick={add}
          className="px-3 py-1.5 text-sm bg-stone-800 hover:bg-stone-900 text-white rounded-lg font-medium transition-colors flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Add
        </button>
      </div>

      {/* Info */}
      <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5">
        <p className="text-sm text-stone-600">
          Plugins are embedded as iframes in the PAAW sidebar. Add any web app URL and it will appear as a navigation item.
        </p>
      </div>

      {/* Plugin list */}
      <div className="space-y-2">
        {plugins.map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <span className="text-lg">{p.icon || "🔌"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-stone-800">{p.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                    p.enabled ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-400"
                  }`}>
                    {p.enabled ? "Active" : "Disabled"}
                  </span>
                </div>
                <div className="text-xs text-stone-400 font-mono truncate">{p.url}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* Toggle */}
                <button onClick={() => toggle(p)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${p.enabled ? "bg-emerald-500" : "bg-stone-200"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    p.enabled ? "translate-x-4" : "translate-x-0.5"
                  }`} />
                </button>
                {/* Edit */}
                <button onClick={() => setEditing(p)}
                  className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors text-stone-400 hover:text-stone-600">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                {/* Delete */}
                <button onClick={() => remove(p)}
                  className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-stone-400 hover:text-red-500">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
        {plugins.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-stone-200">
            <p className="text-2xl mb-2">🔌</p>
            <p className="text-sm text-stone-400">No plugins configured</p>
            <button onClick={add}
              className="mt-3 text-sm text-stone-600 hover:text-stone-800 font-medium underline">
              Add your first plugin
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
