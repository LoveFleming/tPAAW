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
}

export async function getModelForFeature(feature: string): Promise<string> {
  await ensurePrefsLoaded();
  return prefCache[feature] || defaultModelCache || "";
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensurePrefsLoaded().then(() => {
      setProviders(providersCache.length > 0 ? providersCache : []);
      if (!value) {
        const pref = prefCache[feature];
        if (pref) onChange(pref);
        else if (defaultModelCache) onChange(formatValue(activeProviderCache, defaultModelCache));
      }
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const { providerId: curPid, modelId: curMid } = parseValue(value);

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

  if (providers.length === 0) return null;

  return (
    <div ref={ref} className="relative" style={style}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={className || "text-[11px] px-2 py-1 rounded-lg border transition-colors hover:bg-stone-50 flex items-center gap-1"}
        style={!className ? { borderColor: "#d6d3d1", color: "#78716c" } : undefined}
      >
        🤖 {displayName}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden z-50 max-h-80 overflow-y-auto">
          {providers.map(p => (
            <div key={p.id}>
              <div className="px-3 py-1.5 bg-stone-50 border-b border-stone-100 sticky top-0">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{p.name}</span>
              </div>
              {p.models.map(m => {
                const selected = curPid === p.id && curMid === m.id;
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
