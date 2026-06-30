/**
 * ModelSelector — 共用 model 下拉選單
 *
 * - 初始值：user preference API 的 feature 對應 model，沒有就用 defaultModel
 * - 選擇後：自動存到 user preference（feature → modelId）
 * - 所有 AI 介面都用這個元件，統一 model 選擇行為
 *
 * Usage:
 *   <ModelSelector feature="skillBuilder" value={model} onChange={setModel} />
 */
import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";

// Cache: feature → modelId (from user preference)
const prefCache: Record<string, string> = {};
let defaultModelCache = "";
let modelsCache: { id: string; name: string }[] = [];
let prefLoaded = false;

async function ensurePrefsLoaded() {
  if (prefLoaded) return;
  prefLoaded = true;
  try {
    const [prefRes, modelsRes] = await Promise.all([
      fetch(`${API_BASE}/api/user/preferences`).then(r => r.ok ? r.json() : {}),
      fetch(`${API_BASE}/api/models`).then(r => r.ok ? r.json() : { models: [], current: "" }),
    ]);
    Object.assign(prefCache, prefRes);
    defaultModelCache = modelsRes.current || "";
    modelsCache = modelsRes.models || [];
  } catch {}
}

export async function getModelForFeature(feature: string): Promise<string> {
  await ensurePrefsLoaded();
  return prefCache[feature] || defaultModelCache || "";
}

export async function saveModelForFeature(feature: string, modelId: string) {
  prefCache[feature] = modelId;
  try {
    await fetch(`${API_BASE}/api/user/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [feature]: modelId }),
    });
  } catch {}
}

interface ModelSelectorProps {
  feature: string;              // e.g. "skillBuilder", "vibeCoding", "crewChat"
  value: string;
  onChange: (model: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function ModelSelector({ feature, value, onChange, className, style }: ModelSelectorProps) {
  const [models, setModels] = useState<{ id: string; name: string }[]>(modelsCache);

  useEffect(() => {
    ensurePrefsLoaded().then(() => {
      setModels(modelsCache.length > 0 ? modelsCache : []);
      // If no value set, load from preference
      if (!value && prefCache[feature]) {
        onChange(prefCache[feature]);
      } else if (!value && defaultModelCache) {
        onChange(defaultModelCache);
      }
    });
  }, []);

  const handleChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    onChange(newModel);
    await saveModelForFeature(feature, newModel);
  }, [feature, onChange]);

  if (models.length === 0) return null;

  return (
    <select
      value={value}
      onChange={handleChange}
      className={className || "text-xs px-2 py-1.5 border border-stone-200 rounded-lg bg-white min-w-[140px]"}
      style={style}
      title={`Model for ${feature}`}
    >
      {models.map(m => (
        <option key={m.id} value={m.id}>{m.name || m.id}</option>
      ))}
    </select>
  );
}
