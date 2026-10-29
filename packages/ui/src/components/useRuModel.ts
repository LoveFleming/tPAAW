/**
 * useRuModel — 共用 Release Unit Model hook（feature-first UI 的資料源）
 *
 * 三個頁面都用：ApiMapSidebar（feature 分組）、TestsPage（feature 測試分組）、
 * CodeIntelPage（feature 限縮 + impact 填檔）。
 *
 * 模組級 cache（60s TTL）— 三頁同開只打一次 API。
 */

import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4097";

export interface RuFeatureLite {
  id: string;
  name: string;
  status?: string;
  files?: string[];
  apis?: { method: string; path: string }[];
  tests?: { file: string; kind?: string | null }[];
  apiCount?: number;
  testCount?: number;
  fileCount?: number;
}

export interface RuModelLite {
  features?: RuFeatureLite[];
  apis?: { method: string; path: string; file?: string; handler?: string | null; featureIds?: string[] }[];
  headSha?: string;
}

const cache = new Map<string, { at: number; data: RuModelLite }>();
const TTL_MS = 60_000;

export function useRuModel(rootPath?: string | null): RuModelLite | null {
  const [model, setModel] = useState<RuModelLite | null>(null);

  useEffect(() => {
    if (!rootPath) { setModel(null); return; }
    const hit = cache.get(rootPath);
    if (hit && Date.now() - hit.at < TTL_MS) { setModel(hit.data); return; }
    let cancelled = false;
    fetch(`${API_BASE}/api/ru/model?path=${encodeURIComponent(rootPath)}`)
      .then(r => r.json())
      .then((d: RuModelLite) => {
        if (cancelled || !d || (d as any).error) return;
        cache.set(rootPath, { at: Date.now(), data: d });
        setModel(d);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rootPath]);

  return model;
}

/** featureId → name map（方便顯示） */
export function featureNameMap(model: RuModelLite | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of model?.features || []) m.set(f.id, f.name);
  return m;
}
