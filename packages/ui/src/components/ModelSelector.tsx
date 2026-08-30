/**
 * ModelSelector — 共用 Provider + Model 下拉選單
 *
 * 顯示所有 Provider 的所有 Model，按 Provider 分組。
 * 跟聊天視窗的 model picker 一樣的 UI。
 *
 * - 初始值：user preference 的 feature 對應 model，沒有就用 defaultModel
 * - 選擇後：自動存到 user preference（feature → "providerId/modelId"）
 * - 所有 AI 介面都用這個元件，統一 model 選擇行為
 *
 * Usage:
 *   <ModelSelector feature="skillBuilder" value={model} onChange={setModel} />
 *
 * value 格式："{providerId}/{modelId}" 或 "{modelId}"（只用 active provider）
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import API_BASE from "../api";

// ── Types ──
interface ModelInfo { id: string; name: string; }
interface ProviderInfo { id: string; name: string; models: ModelInfo[]; }

interface ModelsApiResponse {
  providers: ProviderInfo[];
  activeProviderId: string;
  defaultModel: string;
}

// ── Cache ──
const prefCache: Record<string, string> = {};
let providersCache: ProviderInfo[] = [];
let activeProviderCache = "";
let defaultModelCache = "";
let prefLoaded = false;

async function ensurePrefsLoaded() {
  if (prefLoaded) return;
  prefLoaded = true;
  try {
    const [prefRes, modelsRes] = await Promise.all([
      fetch(`${API_BASE}/api/user/preferences`).then(r => r.ok ? r.json() : {}),
      fetch(`${API_BASE}/api/models`).then(r => r.ok ? r.json() : {}),
    ]);
    Object.assign(prefCache, prefRes);
    const data = modelsRes as any;
    if (data.providers) {
      // New format: { providers: [...], activeProviderId, defaultModel }
      providersCache = data.providers;
      activeProviderCache = data.activeProviderId || "";
      defaultModelCache = data.defaultModel || "";
    } else if (data.models) {
      // Old format: { models: [...], current } — wrap into single provider
      providersCache = [{ id: activeProviderCache || "active", name: "Default", models: data.models }];
      defaultModelCache = data.current || "";
    }
  } catch {}
  // ⚠️ 失敗不留髒 cache：沒載到 providers 就允許下次重試
  //（2026-08-30 bug：頁面載入瞬間 fetch 失敗 → providers 永遠空 → 全部 ModelSelector 消失到重新整理）
  if (providersCache.length === 0) prefLoaded = false;
}

export async function getModelForFeature(feature: string): Promise<string> {
  await ensurePrefsLoaded();
  const pref = prefCache[feature] || "";
  if (pref) {
    // Validate: if the stored model's provider/model doesn't exist, fallback
    const { providerId, modelId } = parseValue(pref);
    const provider = providersCache.find(p => p.id === providerId);
    if (provider?.models.some(m => m.id === modelId)) return pref;
    // Stale preference — fallback to active provider's first model
    const activeProvider = providersCache.find(p => p.id === activeProviderCache);
    if (activeProvider?.models.length) {
      const resolved = formatValue(activeProvider.id, activeProvider.models[0].id);
      // Auto-correct the stored preference
      saveModelForFeature(feature, resolved);
      return resolved;
    }
  }
  if (defaultModelCache) return formatValue(activeProviderCache, defaultModelCache);
  return "";
}

export async function saveModelForFeature(feature: string, value: string) {
  prefCache[feature] = value;
  try {
    await fetch(`${API_BASE}/api/user/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [feature]: value }),
    });
  } catch {}
}

/** 解析 value → { providerId, modelId } */
function parseValue(value: string): { providerId: string; modelId: string } {
  if (value.includes("/")) {
    const [pid, mid] = value.split("/", 2);
    return { providerId: pid, modelId: mid };
  }
  return { providerId: activeProviderCache, modelId: value };
}

/** 格式化 → "providerId/modelId" */
function formatValue(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

interface ModelSelectorProps {
  feature: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function ModelSelector({ feature, value, onChange, className, style }: ModelSelectorProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>(providersCache);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Resolve a valid model value: accept models in the list AND custom model IDs
  // (custom IDs are passed through as-is — provider may accept models not in its config list)
  function resolveValidModelWith(provList: ProviderInfo[], val: string): string {
    if (!val) return "";
    const { providerId, modelId } = parseValue(val);
    const provider = provList.find(p => p.id === providerId);
    if (provider?.models.some(m => m.id === modelId)) return val;
    // Model not in the provider's configured list — check if it looks like a custom model ID
    // (provider exists, just model isn't pre-listed). Pass it through.
    if (provider) return val;
    // Provider doesn't exist either — fallback to active provider
    const activeProvider = provList.find(p => p.id === activeProviderCache);
    if (activeProvider?.models.length) {
      return formatValue(activeProvider.id, activeProvider.models[0].id);
    }
    // Last resort: first available provider's first model
    const anyProvider = provList[0];
    if (anyProvider?.models.length) {
      return formatValue(anyProvider.id, anyProvider.models[0].id);
    }
    return val;
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await ensurePrefsLoaded();
      if (cancelled) return;
      const loaded = providersCache.length > 0 ? providersCache : [];
      setProviders(loaded);
      if (loaded.length === 0) {
        // server 可能正在重啟 — 3 秒後重試（原 bug：失敗一次 selector 就永久消失）
        setTimeout(load, 3000);
        return;
      }
      // Validate and resolve model using freshly loaded providers
      let resolved = "";
      if (!value) {
        const pref = prefCache[feature];
        if (pref) {
          resolved = resolveValidModelWith(loaded, pref);
          if (resolved !== pref) saveModelForFeature(feature, resolved);
        } else if (defaultModelCache) {
          resolved = resolveValidModelWith(loaded, formatValue(activeProviderCache, defaultModelCache));
        }
      } else {
        resolved = resolveValidModelWith(loaded, value);
        if (resolved !== value) saveModelForFeature(feature, resolved);
      }
      if (resolved) onChange(resolved);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Close on outside click + auto-detect dropdown direction
  useEffect(() => {
    if (!open) return;
    // Measure available space — if not enough room above, drop down instead
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceAbove = rect.top;
      const DROPDOWN_HEIGHT = 320; // max-h-80 = 20rem = 320px
      setDropUp(spaceAbove >= DROPDOWN_HEIGHT);
    }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Resolve display value: validate current value against providers
  const { providerId: curPid, modelId: curMid } = parseValue(resolveValidModelWith(providers, value));

  const handleSelect = useCallback(async (pid: string, mid: string) => {
    const v = formatValue(pid, mid);
    onChange(v);
    setOpen(false);
    await saveModelForFeature(feature, v);
  }, [feature, onChange]);

  // Find display name
  const curProvider = providers.find(p => p.id === curPid);
  const curModel = curProvider?.models.find(m => m.id === curMid);
  const displayName = curModel?.name || curModel?.id || curMid || "Select Model";

  // 沒載到 providers：顯示「載入中」chip（auto-retry 中），不再無聲消失讓人以為 UI 壞了
  if (providers.length === 0) {
    return (
      <button
        type="button"
        onClick={() => { ensurePrefsLoaded().then(() => setProviders(providersCache.length > 0 ? providersCache : [])); }}
        className="text-[11px] px-2 py-1 rounded-lg border text-stone-400"
        style={{ borderColor: "#d6d3d1", ...style }}
      >
        🤖 model 載入中…
      </button>
    );
  }

  return (
    <div ref={ref} className="relative" style={style}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={className ? `${className} flex items-center justify-between gap-1` : "text-[11px] px-2 py-1 rounded-lg border transition-colors hover:bg-stone-50 flex items-center justify-between gap-1"}
        style={!className ? { borderColor: "#d6d3d1", color: "#78716c" } : undefined}
      >
        🤖 {displayName}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className={dropUp
            ? "absolute right-0 bottom-full mb-1 w-56 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden z-[9999] max-h-80 overflow-y-auto"
            : "absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden z-[9999] max-h-80 overflow-y-auto"}
        >
          {providers.map(p => {
            const isCurrentProvider = curPid === p.id;
            const hasCurModel = p.models.some(m => m.id === curMid);
            return (
            <div key={p.id}>
              <div className="px-3 py-1.5 bg-stone-50 border-b border-stone-100 sticky top-0">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{p.name}</span>
              </div>
              {p.models.map(m => {
                const selected = isCurrentProvider && curMid === m.id;
                return (
                  <button
                    key={`${p.id}/${m.id}`}
                    type="button"
                    onClick={() => handleSelect(p.id, m.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-stone-50 transition-colors ${selected ? "bg-stone-50 font-medium" : ""}`}
                  >
                    <span className="flex-1">{m.name || m.id}</span>
                    {selected && <span className="text-emerald-500">✓</span>}
                  </button>
                );
              })}
              {/* Show custom model ID if current value isn't in the list */}
              {isCurrentProvider && !hasCurModel && curMid && (
                <div className="px-3 py-2 text-sm bg-amber-50 border-t border-amber-100">
                  <span className="flex items-center gap-2">
                    <span className="flex-1 text-amber-700">{curMid} <span className="text-[10px] text-amber-400">(custom)</span></span>
                    <span className="text-emerald-500">✓</span>
                  </span>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
