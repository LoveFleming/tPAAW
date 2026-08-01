/**
 * SkillPicker — Dynamic skill selection for CrewManager
 *
 * Fetches available skills from /api/coding-project/skills,
 * shows bound/unbound status, supports search + category filter.
 */
import React, { useState, useEffect, useMemo } from "react";
import { cn } from "../utils";
import API_BASE from "../api";

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: string; // "physical" | "input-prompt"
}

interface SkillPickerProps {
  rootPath: string;
  selected: string[];
  onChange: (skills: string[]) => void;
  theme: {
    bg: string;
    bgMuted: string;
    borderLight: string;
    accent: string;
    text: string;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  "generation": "產出",
  "knowledge": "知識",
  "meta": "元工具",
  "": "其他",
};

const CATEGORY_COLORS: Record<string, string> = {
  "generation": "#10b981",
  "knowledge": "#3b82f6",
  "meta": "#f59e0b",
  "": "#6b7280",
};

export default function SkillPicker({ rootPath, selected, onChange, theme: t }: SkillPickerProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");

  useEffect(() => {
    fetch(`${API_BASE}/api/coding-project/skills`)
      .then(r => r.json())
      .then(data => {
        setSkills(data.skills || []);
      })
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const cats = new Set(skills.map(s => s.category || ""));
    return Array.from(cats);
  }, [skills]);

  const filtered = useMemo(() => {
    let result = skills;
    if (filterCat) result = result.filter(s => (s.category || "") === filterCat);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [skills, search, filterCat]);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  if (loading) {
    return <div className="text-sm text-stone-400 py-4 text-center">載入技能列表中...</div>;
  }

  if (skills.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-3xl mb-2">📦</div>
        <div className="text-sm text-stone-500 mb-1">目前沒有可用的 Skill</div>
        <div className="text-xs text-stone-400">
          在 Skill Builder 建立技能後，就可以掛載到 Agent
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search + Filter */}
      <div className="flex items-center gap-2">
        <input
          placeholder="🔍 搜尋技能..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 text-xs border rounded-lg"
          style={{ borderColor: t.borderLight }}
        />
        {categories.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterCat("")}
              className={cn("text-[10px] px-2 py-1 rounded transition-colors",
                filterCat === "" ? "text-white" : "text-stone-400 hover:bg-stone-100")}
              style={filterCat === "" ? { backgroundColor: t.accent } : {}}
            >
              全部
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCat(cat)}
                className={cn("text-[10px] px-2 py-1 rounded transition-colors",
                  filterCat === cat ? "text-white" : "hover:bg-stone-100")}
                style={filterCat === cat ? { backgroundColor: CATEGORY_COLORS[cat] || t.accent } : { color: CATEGORY_COLORS[cat] || "#6b7280" }}
              >
                {CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bound skills summary */}
      {selected.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap p-2 bg-indigo-50 rounded-lg border border-indigo-200">
          <span className="text-[10px] font-semibold text-indigo-600">已掛載:</span>
          {selected.map(id => {
            const skill = skills.find(s => s.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-white rounded border border-indigo-200">
                {skill?.name || id}
                <button onClick={() => toggle(id)} className="text-red-400 hover:text-red-600 ml-0.5">✕</button>
              </span>
            );
          })}
        </div>
      )}

      {/* Skill list */}
      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {filtered.map(skill => {
          const bound = selected.includes(skill.id);
          const catColor = CATEGORY_COLORS[skill.category || ""] || "#6b7280";
          return (
            <label
              key={skill.id}
              className={cn(
                "flex items-start gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-all",
                bound ? "bg-indigo-50 border-indigo-200 shadow-sm" : "hover:bg-stone-50"
              )}
              style={!bound ? { borderColor: t.borderLight } : {}}
            >
              <input
                type="checkbox"
                checked={bound}
                onChange={() => toggle(skill.id)}
                className="w-3.5 h-3.5 mt-0.5 accent-indigo-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-stone-700">{skill.name}</span>
                  <span
                    className="text-[9px] px-1 py-0.5 rounded font-medium"
                    style={{ backgroundColor: catColor + "20", color: catColor }}
                  >
                    {CATEGORY_LABELS[skill.category || ""] || skill.category || "?"}
                  </span>
                  <span className="text-[9px] text-stone-400 font-mono">{skill.kind}</span>
                </div>
                <div className="text-[11px] text-stone-400 mt-0.5">{skill.description || "(無描述)"}</div>
              </div>
              {bound && <span className="text-[10px] text-indigo-500 font-medium shrink-0">✓</span>}
            </label>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-sm text-stone-400 py-4 text-center">
          {search ? `沒有匹配「${search}」的技能` : "沒有技能"}
        </div>
      )}
    </div>
  );
}
