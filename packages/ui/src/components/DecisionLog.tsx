/**
 * DecisionLog — Browse and manage ADR records in .paaw/DECISIONS.md
 *
 * Features:
 * - Parse ADR entries from DECISIONS.md
 * - Display as timeline cards
 * - Add new decision (with form)
 * - Read full decision detail
 */
import React, { useEffect, useState, useCallback } from "react";
import API_BASE from "../api";

// ── Types ──

interface ADR {
  id: string;
  title: string;
  date?: string;
  status?: string;
  context?: string;
  decision?: string;
  consequences?: string;
}

interface DecisionLogProps {
  projectRoot: string;
  refreshKey?: number;
}

// ── Parse ADRs from markdown ──

function parseADRs(md: string): ADR[] {
  const adrs: ADR[] = [];
  const lines = md.split("\n");
  let current: ADR | null = null;

  for (const line of lines) {
    const adrMatch = line.match(/^##\s+(ADR-\d+):\s*(.+)$/);
    if (adrMatch) {
      if (current) adrs.push(current);
      current = { id: adrMatch[1], title: adrMatch[2] };
      continue;
    }
    if (!current) continue;

    const m = line.match(/^-\s*\*\*(.+?)\*\*:\s*(.+)$/);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2];
      if (key.includes("日期") || key === "date") current.date = val;
      else if (key.includes("狀態") || key === "status") current.status = val;
      else if (key.includes("背景") || key === "context") current.context = val;
      else if (key.includes("決定") || key === "decision") current.decision = val;
      else if (key.includes("後果") || key === "consequences") current.consequences = val;
    }
  }
  if (current) adrs.push(current);
  return adrs;
}

const STATUS_STYLES: Record<string, string> = {
  accepted: "bg-green-100 text-green-700",
  proposed: "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700",
  deprecated: "bg-stone-100 text-stone-500",
  superseded: "bg-amber-100 text-amber-700",
};

const TYPE_ICONS: Record<string, string> = {
  "架构": "🏗️",
  "技術": "🔧",
  "工具": "🛠️",
  "模式": "📐",
  "default": "🧠",
};

// ── Component ──

export default function DecisionLog({ projectRoot, refreshKey = 0 }: DecisionLogProps) {
  const [adrs, setAdrs] = useState<ADR[]>([]);
  const [selected, setSelected] = useState<ADR | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newAdr, setNewAdr] = useState({ title: "", context: "", decision: "", consequences: "" });
  const [saving, setSaving] = useState(false);

  const loadDecisions = useCallback(async () => {
    if (!projectRoot) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/decisions?path=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        const md = await res.text();
        setAdrs(parseADRs(md));
      }
    } catch {}
    setLoading(false);
  }, [projectRoot]);

  useEffect(() => { loadDecisions(); }, [loadDecisions, refreshKey]);

  const handleAdd = async () => {
    if (!newAdr.title || !newAdr.decision) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/coding-project/decisions?path=${encodeURIComponent(projectRoot)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAdr),
      });
      setNewAdr({ title: "", context: "", decision: "", consequences: "" });
      setShowNew(false);
      await loadDecisions();
    } catch {}
    setSaving(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-stone-200 bg-stone-50 text-xs shrink-0">
        <span className="font-semibold text-stone-600">🧠 Decisions</span>
        <span className="text-xs text-stone-400">({adrs.length})</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowNew(!showNew)}
          className="px-1.5 py-0.5 rounded text-xs text-blue-600 hover:bg-blue-50 font-medium"
        >
          ➕ New ADR
        </button>
        <button
          onClick={loadDecisions}
          className="px-1 py-0.5 rounded text-xs text-stone-400 hover:text-stone-600"
        >
          ↻
        </button>
      </div>

      {/* New ADR form */}
      {showNew && (
        <div className="border-b border-stone-200 bg-blue-50 p-3 space-y-2 shrink-0">
          <input
            type="text"
            value={newAdr.title}
            onChange={e => setNewAdr({ ...newAdr, title: e.target.value })}
            placeholder="Decision title (e.g. Use useRef for IME composition)"
            className="w-full text-xs px-2 py-1.5 rounded border border-blue-200 bg-white focus:border-blue-400 outline-none"
            autoFocus
          />
          <textarea
            value={newAdr.context}
            onChange={e => setNewAdr({ ...newAdr, context: e.target.value })}
            placeholder="Context: Why is this decision needed?"
            rows={2}
            className="w-full text-xs px-2 py-1.5 rounded border border-blue-200 bg-white focus:border-blue-400 outline-none resize-none"
          />
          <textarea
            value={newAdr.decision}
            onChange={e => setNewAdr({ ...newAdr, decision: e.target.value })}
            placeholder="Decision: What was decided?"
            rows={2}
            className="w-full text-xs px-2 py-1.5 rounded border border-blue-200 bg-white focus:border-blue-400 outline-none resize-none"
          />
          <input
            type="text"
            value={newAdr.consequences}
            onChange={e => setNewAdr({ ...newAdr, consequences: e.target.value })}
            placeholder="Consequences (optional)"
            className="w-full text-xs px-2 py-1.5 rounded border border-blue-200 bg-white focus:border-blue-400 outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!newAdr.title || !newAdr.decision || saving}
              className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 font-medium"
            >
              {saving ? "Saving..." : "Save ADR"}
            </button>
            <button onClick={() => setShowNew(false)} className="text-xs px-2 py-1 text-stone-400">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ADR list + detail */}
      <div className="flex flex-1 min-h-0">
        {/* List */}
        <div className="w-48 border-r border-stone-200 overflow-y-auto bg-white" style={{ scrollbarWidth: "thin" }}>
          {loading && <div className="px-2 py-1 text-xs text-stone-400 animate-pulse">Loading...</div>}
          {adrs.length === 0 && !loading && (
            <div className="px-2 py-4 text-xs text-stone-400 text-center">
              <div className="text-xl mb-1">🧠</div>
              No decisions yet.<br />
              <span className="text-xs">AI-recorded ADRs<br />and manual entries<br />will appear here.</span>
            </div>
          )}
          {adrs.map(adr => (
            <div
              key={adr.id}
              onClick={() => setSelected(adr)}
              className={`px-2 py-1.5 cursor-pointer border-b border-stone-100 ${
                selected?.id === adr.id ? "bg-blue-50" : "hover:bg-stone-50"
              }`}
            >
              <div className="flex items-center gap-1">
                <span className="text-xs font-mono text-stone-400">{adr.id}</span>
                {adr.status && (
                  <span className={`text-[10px] px-1 rounded font-bold uppercase ${STATUS_STYLES[adr.status.toLowerCase()] || "bg-stone-100 text-stone-500"}`}>
                    {adr.status}
                  </span>
                )}
              </div>
              <div className={`text-sm mt-0.5 leading-snug ${selected?.id === adr.id ? "text-blue-700 font-medium" : "text-stone-700"}`}>
                {adr.title}
              </div>
              {adr.date && <div className="text-xs text-stone-400 mt-0.5">{adr.date}</div>}
            </div>
          ))}
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto bg-white p-3" style={{ scrollbarWidth: "thin" }}>
          {selected ? (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-mono text-stone-400">{selected.id}</div>
                <h3 className="text-sm font-bold text-stone-800 mt-0.5">{selected.title}</h3>
              </div>
              {selected.date && (
                <div className="text-xs text-stone-400">📅 {selected.date}</div>
              )}
              {selected.context && (
                <div>
                  <div className="text-xs font-semibold text-stone-500 mb-0.5">📋 Background</div>
                  <div className="text-sm text-stone-600 leading-relaxed">{selected.context}</div>
                </div>
              )}
              {selected.decision && (
                <div>
                  <div className="text-xs font-semibold text-stone-500 mb-0.5">✅ Decision</div>
                  <div className="text-sm text-stone-700 leading-relaxed font-medium">{selected.decision}</div>
                </div>
              )}
              {selected.consequences && (
                <div>
                  <div className="text-xs font-semibold text-stone-500 mb-0.5">⚠️ Consequences</div>
                  <div className="text-sm text-stone-600 leading-relaxed">{selected.consequences}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-stone-300 text-sm">
              <div className="text-center">
                <div className="text-2xl mb-2">🧠</div>
                <div>Select an ADR to view details</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
