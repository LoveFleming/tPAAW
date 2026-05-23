import React, { useState, useCallback, useEffect } from "react";
import { ThemeProvider, useTheme, THEMES, THEME_GROUPS, ThemeId } from "../theme";
import { cn } from "../utils";
import Icon from "../components/Icon";

interface Factory {
  id: string;
  name: string;
  icon: string;
  description: string;
}

interface Props {
  factories: Factory[];
  selectedFactoryId: string;
  onSelect: (factoryId: string) => void;
  onBack: () => void;
  aiocRoot: string;
  onFactoriesChanged: () => void;
}

function FactoryEntryInner({ factories, selectedFactoryId, onSelect, onBack, aiocRoot, onFactoriesChanged }: Props) {
  const { info: t, theme, setTheme } = useTheme();
  const [creating, setCreating] = useState(false);
  const [newFactory, setNewFactory] = useState({
    id: "",
    name: "",
    icon: "🏭",
    description: "",
    copyFrom: "",
  });

  const handleCreate = useCallback(async () => {
    if (!newFactory.id || !newFactory.name) return;
    try {
      const resp = await fetch("http://127.0.0.1:4097/api/factories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newFactory),
      });
      if (resp.ok) {
        onFactoriesChanged();
        setCreating(false);
        setNewFactory({ id: "", name: "", icon: "🏭", description: "", copyFrom: "" });
      } else {
        const err = await resp.json();
        alert(err.error || "Create failed");
      }
    } catch (err: any) {
      alert(err.message);
    }
  }, [newFactory, onFactoriesChanged]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(`確定要刪除工廠 "${id}" 嗎？`)) return;
    try {
      const resp = await fetch(`http://127.0.0.1:4097/api/factories/${id}`, { method: "DELETE" });
      if (resp.ok) {
        onFactoriesChanged();
      } else {
        const err = await resp.json();
        alert(err.error || "Delete failed");
      }
    } catch (err: any) {
      alert(err.message);
    }
  }, [onFactoriesChanged]);

  const ICON_OPTIONS = ["🏭", "🧵", "🔧", "⚡", "🚀", "🏗️", "🎯", "🛡️", "🤖", "🔬", "📊", "🎨"];

  return (
    <div className="h-screen flex flex-col items-center justify-center" style={{ backgroundColor: t.accentBg }}>
      {/* Theme selector top-right */}
      <div className="absolute top-4 right-4">
        <button
          onClick={() => setTheme(theme === THEME_GROUPS[0].themes[0].id ? THEME_GROUPS[0].themes[1]?.id ?? THEME_GROUPS[0].themes[0].id : THEME_GROUPS[0].themes[0].id)}
          className="w-8 h-8 rounded-full bg-white/80 hover:bg-white shadow-sm border border-stone-200 flex items-center justify-center text-base transition-colors"
        >
          <Icon name={theme} size={18} />
        </button>
      </div>

      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-stone-800 mb-2" style={{ fontFamily: "'SF Pro Display', sans-serif" }}>
          🏭 AI Factory
        </h1>
        <p className="text-stone-500 text-sm">選擇一個 AI Factory 開始工作</p>
        <p className="text-stone-400 text-xs mt-1">AI-Native Operation Center</p>
      </div>

      {/* Factory grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl w-full px-6 mb-6">
        {factories.map((f) => {
          const isSelected = f.id === selectedFactoryId;
          return (
            <button
              key={f.id}
              onClick={() => onSelect(f.id)}
              className={cn(
                "flex flex-col items-center p-6 rounded-2xl border-2 bg-white transition-all hover:shadow-lg hover:-translate-y-1 text-left",
              )}
              style={{
                borderColor: isSelected ? t.accent : t.accentBorder,
                boxShadow: isSelected ? `0 0 0 1px ${t.accent}20` : undefined,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = t.accentBorder; }}
            >
              <span className="text-4xl mb-3">{f.icon}</span>
              <span className="text-base font-bold text-stone-800 mb-1">{f.name}</span>
              <span className="text-xs text-stone-400 font-mono">{f.id}</span>
              {f.description && <span className="text-xs text-stone-500 mt-2 text-center line-clamp-2">{f.description}</span>}
              {isSelected && (
                <span className="mt-3 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: t.accentLight, color: t.accent }}>
                  ✓ CURRENT
                </span>
              )}
              {/* Delete button for non-fabric-service */}
              {f.id !== "fabric-service" && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(f.id); }}
                  className="mt-2 text-[10px] text-rose-400 hover:text-rose-600 transition-colors"
                >
                  刪除
                </button>
              )}
            </button>
          );
        })}

        {/* Create new factory card */}
        <button
          onClick={() => setCreating(true)}
          className="flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed bg-white/50 hover:bg-white transition-all min-h-[180px] group"
          style={{ borderColor: t.accentBorder }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = t.accentBorder; }}
        >
          <span className="text-3xl mb-2 group-hover:scale-110 transition-transform" style={{ color: t.accentBorder }}>+</span>
          <span className="text-sm font-bold" style={{ color: t.accent + "aa" }}>Create New Factory</span>
        </button>
      </div>

      {/* Create Factory Modal */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setCreating(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-stone-200"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-stone-800 mb-4">🆕 Create New Factory</h3>

            <div className="space-y-3">
              {/* Icon */}
              <div>
                <label className="text-xs font-semibold text-stone-500 block mb-1">Icon</label>
                <div className="flex gap-1.5 flex-wrap">
                  {ICON_OPTIONS.map(icon => (
                    <button
                      key={icon}
                      onClick={() => setNewFactory(p => ({ ...p, icon }))}
                      className={cn(
                        "w-8 h-8 rounded-lg text-lg flex items-center justify-center border transition-colors",
                        newFactory.icon === icon ? "border-stone-800 bg-stone-100" : "border-stone-200 hover:border-stone-400"
                      )}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* ID */}
              <div>
                <label className="text-xs font-semibold text-stone-500 block mb-1">Factory ID (English, 用於目錄名稱)</label>
                <input
                  value={newFactory.id}
                  onChange={e => setNewFactory(p => ({ ...p, id: e.target.value.replace(/[^a-zA-Z0-9-_]/g, "") }))}
                  placeholder="例：my-product-api"
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400"
                />
              </div>

              {/* Name */}
              <div>
                <label className="text-xs font-semibold text-stone-500 block mb-1">名稱</label>
                <input
                  value={newFactory.name}
                  onChange={e => setNewFactory(p => ({ ...p, name: e.target.value }))}
                  placeholder="例：我的產品 API 工廠"
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-semibold text-stone-500 block mb-1">描述</label>
                <input
                  value={newFactory.description}
                  onChange={e => setNewFactory(p => ({ ...p, description: e.target.value }))}
                  placeholder="這個工廠負責什麼？"
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400"
                />
              </div>

              {/* Copy from */}
              <div>
                <label className="text-xs font-semibold text-stone-500 block mb-1">從現有 Factory 複製 (選填)</label>
                <select
                  value={newFactory.copyFrom}
                  onChange={e => setNewFactory(p => ({ ...p, copyFrom: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white"
                >
                  <option value="">— 不複製，從零開始 —</option>
                  {factories.map(f => (
                    <option key={f.id} value={f.id}>{f.icon} {f.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={handleCreate}
                disabled={!newFactory.id || !newFactory.name}
                className="flex-1 px-4 py-2 text-sm font-bold text-white rounded-xl transition-colors disabled:opacity-40"
                style={{ backgroundColor: t.accent }}
                onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) e.currentTarget.style.backgroundColor = t.accentHover; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = t.accent; }}
              >
                Create
              </button>
              <button
                onClick={() => setCreating(false)}
                className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 rounded-xl border border-stone-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FactoryEntryPage(props: Props) {
  return (
    <ThemeProvider>
      <FactoryEntryInner {...props} />
    </ThemeProvider>
  );
}
