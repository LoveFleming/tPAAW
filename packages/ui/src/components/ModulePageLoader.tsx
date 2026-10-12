import { useEffect, useState, type ComponentType } from "react";
import { loadModulePage } from "../moduleRuntime";
import API_BASE from "../api";

/**
 * ModulePageLoader — runtime 動態 import 載入 app module 的 UI 頁（M3，2026-10-12）
 * 取代原本 build-time 的 import.meta.glob，讓「匯入模組 → 直接可用」不必 rebuild。
 * 未指定 page 時，自己嚮 API 查 manifest.nav.page（避免 stale closure）。
 */
export default function ModulePageLoader({ moduleId, page }: { moduleId: string; page?: string }) {
  const [Comp, setComp] = useState<ComponentType<any> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setComp(null);
    setErr(null);
    (async () => {
      let pg = page;
      if (!pg) {
        const d = await fetch(`${API_BASE}/api/apps/modules`).then(r => r.json()).catch(() => null);
        pg = (d?.modules || []).find((m: any) => m.id === moduleId)?.nav?.page || "Main";
      }
      return loadModulePage(moduleId, pg!);
    })()
      .then((c) => { if (alive) setComp(() => c as ComponentType<any>); })
      .catch((e) => { if (alive) setErr(e?.message || String(e)); });
    return () => { alive = false; };
  }, [moduleId, page]);

  if (err) return <div style={{ padding: 24, fontSize: 13, color: "#b91c1c" }}>📦 模組頁面載入失敗：{err}</div>;
  if (!Comp) return <div style={{ padding: 24, fontSize: 13, color: "#999" }}>📦 載入模組頁面…</div>;
  return <Comp />;
}
