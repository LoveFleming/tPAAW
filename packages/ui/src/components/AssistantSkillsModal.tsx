/**
 * AssistantSkillsModal — 個人助理（林雨晴）技能勾選（2026-10-09 Fleming）
 *
 * 勾選的 skill 存 paaw data（data/assistant-skills.json），實體複製到 data/assistant-skills/，
 * 並由 context-engine 注入到林雨晴的 system prompt（清單 + 路徑 + 內容）。
 */
import { useEffect, useMemo, useState } from "react";

const API_BASE = "";

interface Skill { id: string; name: string; description: string; domain?: string; kind: string; sourcePath?: string; }

interface Props {
  themeInfo: { accent: string; accentBg: string };
  onClose: () => void;
  onSaved?: () => void;
}

export default function AssistantSkillsModal({ themeInfo, onClose, onSaved }: Props) {
  const [available, setAvailable] = useState<Skill[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/assistant-skills`)
      .then(r => r.json())
      .then(d => {
        if (d?.error) throw new Error(d.error);
        setAvailable(d.available || []);
        setSelected(new Set(d.bound || []));
        setInitial(d.bound || []);
      })
      .catch(() => setMsg("❌ 載入失敗"))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return available.filter(s => !q || s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q));
  }, [available, search]);

  const dirty = useMemo(() => {
    const a = [...selected].sort().join(","), b = [...initial].sort().join(",");
    return a !== b;
  }, [selected, initial]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/assistant-skills`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: [...selected] }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setInitial(d.bound || []);
      setMsg("✅ 已儲存（提示詞下次對話生效）");
      onSaved?.();
    } catch { setMsg("❌ 儲存失敗"); }
    setTimeout(() => setMsg(""), 2500);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-stone-100">
          <div>
            <h3 className="text-base font-bold text-stone-800">🧩 個人助理技能設定</h3>
            <p className="text-[11px] text-stone-400 mt-0.5">勾選林雨晴可使用的技能 — 存於 PAAW data（跟著你走）；啟用後會注入提示詞（清單 + 路徑 + 內容）</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-lg leading-none px-1">✕</button>
        </div>

        <div className="shrink-0 px-5 py-2.5 border-b border-stone-100 flex items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜尋技能…"
            className="flex-1 text-sm px-3 py-1.5 rounded-lg border border-stone-200 focus:border-stone-400 outline-none" />
          <span className="text-xs text-stone-500 shrink-0">已選 <b className="text-stone-800">{selected.size}</b> / {available.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2" style={{ scrollbarWidth: "thin" }}>
          {loading ? (
            <div className="text-center text-stone-400 text-sm py-10">載入中…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-stone-400 text-sm py-10">沒有符合的技能</div>
          ) : filtered.map(s => {
            const on = selected.has(s.id);
            return (
              <label key={s.id} className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-stone-50 cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="mt-1 accent-emerald-600" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-stone-800 truncate">{s.name}</span>
                    <span className="text-[10px] text-stone-400 font-mono shrink-0">{s.id}</span>
                    {s.domain && <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 shrink-0">{s.domain}</span>}
                  </div>
                  {s.description && <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2">{s.description}</p>}
                </div>
              </label>
            );
          })}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-stone-100 flex items-center gap-3">
          <button onClick={save} disabled={saving || !dirty}
            className="px-5 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-40"
            style={{ backgroundColor: themeInfo.accent }}>
            {saving ? "儲存中..." : "💾 儲存技能綁定"}
          </button>
          {dirty && <span className="text-xs text-amber-600">有未儲存的變更</span>}
          {msg && <span className="text-xs text-stone-600">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
