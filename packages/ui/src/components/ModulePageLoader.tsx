import { useEffect, useState, useCallback, type ComponentType } from "react";
import { loadModulePage, invalidateModulePage } from "../moduleRuntime";
import API_BASE from "../api";

/**
 * ModulePageLoader — runtime 動態 import 載入 app module 的 UI 頁（M3，2026-10-12）
 * 取代原本 build-time 的 import.meta.glob，讓「匯入模組 → 直接可用」不必 rebuild。
 * 未指定 page 時，自己嚮 API 查 manifest.nav.page（避免 stale closure）。
 *
 * page 由呼叫端（App.tsx openAppModule）帶入並編進 tabId（module:<id>:<page>），
 * 讓「點 nav 開頁」不需要多一次 manifest round-trip；未帶才 fallback 查 manifest。
 */
export default function ModulePageLoader({ moduleId, page }: { moduleId: string; page?: string }) {
  const [Comp, setComp] = useState<ComponentType<any> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setComp(null);
    setErr(null);
    (async () => {
      let pg = page;
      if (!pg) {
        // 只在沒帶 page 時查 manifest；查詢本身失敗要回報，不可靜默退回 'Main'（M2）。
        let d: any = null;
        try {
          const res = await fetch(`${API_BASE}/api/apps/modules`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          d = await res.json();
        } catch (e: any) {
          throw new Error(`讀取模組清單失敗：${e?.message || String(e)}`);
        }
        const mod = (d?.modules || []).find((m: any) => m.id === moduleId);
        if (!mod) throw new Error(`找不到模組 ${moduleId}`);
        pg = mod?.nav?.page;
        if (!pg) throw new Error(`模組 ${moduleId} 沒有設定預設頁（nav.page）`);
      }
      return loadModulePage(moduleId, pg!);
    })()
      .then((c) => { if (alive) setComp(() => c as ComponentType<any>); })
      .catch((e) => { if (alive) setErr(e?.message || String(e)); });
    return () => { alive = false; };
  }, [moduleId, page, reloadKey]);

  // 重試：清掉 moduleRuntime 的 page 快取，避免拿到同一顆失敗/舊 Promise（M1/M4）。
  const retry = useCallback(() => {
    invalidateModulePage(moduleId);
    setReloadKey((k) => k + 1);
  }, [moduleId]);

  if (err) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "#b91c1c" }}>
        <div>📦 模組頁面載入失敗：{err}</div>
        <button
          type="button"
          onClick={retry}
          style={{ marginTop: 12, fontSize: 12, padding: "4px 12px", cursor: "pointer" }}
        >
          重試
        </button>
      </div>
    );
  }
  if (!Comp) return <div style={{ padding: 24, fontSize: 13, color: "#999" }}>📦 載入模組頁面…</div>;
  return <Comp />;
}
