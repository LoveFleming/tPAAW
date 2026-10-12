import { useState, useEffect, useCallback } from "react";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import { uiAlertError, uiConfirm } from "../components/ui/uiFeedback";
import { cn } from "../utils";
import API_BASE from "../api";

/**
 * App Modules（可組裝底座 S5，2026-10-03）— FDE 工作台
 * 列出 installed-apps/ 模組、enable/disable、scaffold 新模組。
 */

interface AppModule {
  id: string;
  name: string;
  version: string;
  nav?: { label: string; emoji?: string; page: string } | null;
  enabled: boolean;
  error?: string | null;
}

export default function AppModules() {
  const { info: th } = useTheme();
  const { t } = useI18n();
  const [modules, setModules] = useState<AppModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("📦");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/apps/modules`)
      .then(r => r.json())
      .then(d => setModules(d.modules || []))
      .catch(() => uiAlertError("載入模組清單失敗"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (m: AppModule) => {
    const r = await fetch(`${API_BASE}/api/apps/modules/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !m.enabled }),
    }).then(x => x.json()).catch(() => null);
    if (r?.ok) {
      load();
    } else uiAlertError(`切換失敗：${r?.error || "unknown"}`);
  };

  const create = async () => {
    if (!newId.trim()) { uiAlertError("id 必填（小寫字母開頭，如 pm / secretary）"); return; }
    const r = await fetch(`${API_BASE}/api/apps/modules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: newId.trim(), name: newName.trim() || newId.trim(), emoji: newEmoji.trim() || "📦" }),
    }).then(x => x.json()).catch(() => null);
    if (r?.ok) {
      setNewId(""); setNewName(""); setCreating(false);
      load();
    } else uiAlertError(`scaffold 失敗：${r?.error || "unknown"}`);
  };

  return (
    <div className="h-full overflow-auto bg-stone-50">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-stone-800">📦 App Modules</h2>
            <p className="text-xs mt-1 text-stone-500">
              可組裝底座 — persona app 模組管理（installed-apps/）· 資料各模組自帶（data/installed-apps/&lt;id&gt;/）
            </p>
          </div>
          <button
            onClick={() => setCreating(v => !v)}
            className="text-xs px-3 py-1.5 rounded-md text-white hover:opacity-90"
            style={{ background: th.accent }}
          >➕ Create Module</button>
        </div>

        {creating && (
          <div className="rounded-lg border border-stone-200 bg-white p-4 mb-4 space-y-2">
            <p className="text-xs font-bold text-stone-700">Scaffold 新模組骨架</p>
            <div className="grid grid-cols-12 gap-2">
              <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="id（小寫，如 pm）" className="col-span-4 text-xs px-2 py-1.5 rounded border border-stone-200" />
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="名稱（如 PM 工作台）" className="col-span-5 text-xs px-2 py-1.5 rounded border border-stone-200" />
              <input value={newEmoji} onChange={e => setNewEmoji(e.target.value)} placeholder="📦" className="col-span-1 text-xs px-2 py-1.5 rounded border border-stone-200 text-center" />
              <button onClick={create} className="col-span-2 text-xs px-2 py-1.5 rounded text-white bg-emerald-500 hover:bg-emerald-600">建立</button>
            </div>
            <p className="text-[10px] text-stone-400">產生 manifest + server entry + UI 頁面骨架（installed-apps/&lt;id&gt;/），之後用 coding app 團隊開發內容</p>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-stone-400">載入中…</p>
        ) : modules.length === 0 ? (
          <p className="text-sm text-stone-400">目前沒有模組。用 Create Module 開第一個。</p>
        ) : (
          <div className="space-y-2">
            {modules.map(m => (
              <div key={m.id} className="rounded-lg border border-stone-200 bg-white p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-stone-800">
                    {m.nav?.emoji || "📦"} {m.name} <span className="text-[10px] font-normal text-stone-400">v{m.version} · {m.id}</span>
                  </p>
                  <p className="text-xs mt-0.5 text-stone-500">
                    {m.error ? `⚠️ ${m.error}` : `${m.enabled ? "🟢 啟用中" : "⚪ 已停用"}${m.nav ? ` · nav: ${m.nav.label}` : " · 無 nav"}`}
                  </p>
                </div>
                <button
                  onClick={() => uiConfirm(`要${m.enabled ? "停用" : "啟用"} ${m.name} 嗎？（server routes 重啟後生效）`).then(ok => { if (ok) toggle(m); })}
                  className={cn("text-xs px-3 py-1.5 rounded-md border border-stone-200 hover:border-stone-300",
                    m.enabled ? "text-stone-500" : "text-emerald-600 font-medium")}
                >{m.enabled ? "停用" : "啟用"}</button>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-stone-400 mt-6">
          出貨流程：模組目錄 zip（installed-apps/&lt;id&gt;/，不含 data）→ 客戶 PAAW 解開 → npm run build → 重啟 → 掛載。資料各機自帶，永不隨碼出走。
        </p>
      </div>
    </div>
  );
}
