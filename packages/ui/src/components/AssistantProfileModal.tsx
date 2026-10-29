/**
 * AssistantProfileModal — 個人助理（林雨晴）基本資料編輯（2026-10-09 Fleming）
 *
 * 從 PAAW 設定頁移到林雨晴聊天視窗右上角 icon。
 * - 使用者可變層：頭像 / 顯示名 / 開場白 / 語氣 / 備註 → data/crew-preferences.json
 * - 系統提示詞（行為）由 assistant module 維護，不可改
 */
import { useEffect, useState } from "react";

const API_BASE = "";

interface Props {
  themeInfo: { accent: string; accentBorder: string; accentBg: string };
  onClose: () => void;
  onSaved?: () => void;
}

interface Prefs { avatarUrl?: string; displayName?: string; tone?: string; greeting?: string; notes?: string; }
interface CrewInfo { codename?: string; description?: string; imageUrl?: string; }

function Badge({ set, label }: { set: boolean; label: string }) {
  return set
    ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-normal">已自訂</span>
    : <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-normal">{label}</span>;
}

export default function AssistantProfileModal({ themeInfo, onClose, onSaved }: Props) {
  const [prefs, setPrefs] = useState<Prefs>({});
  const [info, setInfo] = useState<CrewInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/crew/my.assistant`)
      .then(r => r.json())
      .then(d => { if (d && !d.error) setInfo(d); })
      .catch(() => {});
    fetch(`${API_BASE}/api/crew-preferences/my.assistant`)
      .then(r => r.json())
      .then(d => setPrefs(d && !d.error ? d : {}))
      .catch(() => {});
  }, []);

  const uploadAvatar = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/uploads`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        const d = await res.json();
        if (d?.url) setPrefs(p => ({ ...p, avatarUrl: d.url }));
      } catch {}
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/crew-preferences/my.assistant`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error();
      setMsg("✅ 已儲存");
      onSaved?.();
    } catch { setMsg("❌ 儲存失敗"); }
    setTimeout(() => setMsg(""), 2500);
    setSaving(false);
  };

  const noneSet = !(prefs.avatarUrl || prefs.displayName || prefs.tone || prefs.greeting || prefs.notes);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-stone-100">
          <div>
            <h3 className="text-base font-bold text-stone-800">🧑‍💼 個人助理設定</h3>
            <p className="text-[11px] text-stone-400 mt-0.5">{info?.description || "照片、名字、開場白、語氣 — personal profile（data/，跟著使用者走）"}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-lg leading-none px-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {noneSet && (
            <div className="text-[11px] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700">
              ℹ️ 目前尚未設定 — 以下全部使用<b>系統預設</b>（來自 assistant module）。
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl border border-stone-200 overflow-hidden flex items-center justify-center bg-stone-50 shrink-0">
              {prefs.avatarUrl ? (
                <img src={prefs.avatarUrl.startsWith("/") ? `${API_BASE}${prefs.avatarUrl}` : prefs.avatarUrl} className="w-full h-full object-contain" />
              ) : info?.imageUrl ? (
                <img src={`${API_BASE}${info.imageUrl}`} className="w-full h-full object-contain" />
              ) : (
                <span className="text-2xl">🧑‍💼</span>
              )}
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-stone-800">{prefs.displayName || info?.codename || "林雨晴"}</div>
              <label className="mt-1 inline-block px-3 py-1.5 rounded-lg border border-stone-200 text-xs cursor-pointer hover:bg-stone-50">
                📷 上傳照片
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); }} />
              </label>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-stone-500 block mb-1">頭像網址<Badge set={!!prefs.avatarUrl} label="系統預設" /></label>
            <input value={prefs.avatarUrl || ""} onChange={e => setPrefs(p => ({ ...p, avatarUrl: e.target.value }))}
              placeholder={info?.imageUrl ? `預設：${info.imageUrl}` : "/api/uploads/…"}
              className="w-full text-sm px-3 py-2 rounded-lg border border-stone-200 focus:border-stone-400 outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-stone-500 block mb-1">顯示名稱<Badge set={!!prefs.displayName} label={`系統預設：${info?.codename || "林雨晴"}`} /></label>
              <input value={prefs.displayName || ""} onChange={e => setPrefs(p => ({ ...p, displayName: e.target.value }))}
                placeholder={info?.codename || "林雨晴 Rainy Lin"}
                className="w-full text-sm px-3 py-2 rounded-lg border border-stone-200 focus:border-stone-400 outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-500 block mb-1">語氣<Badge set={!!prefs.tone} label="系統預設（不調整）" /></label>
              <select value={prefs.tone || ""} onChange={e => setPrefs(p => ({ ...p, tone: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-stone-200 bg-white focus:border-stone-400 outline-none">
                <option value="">預設（不調整）</option>
                <option value="concise">簡潔</option>
                <option value="detailed">詳細</option>
                <option value="casual">輕鬆</option>
                <option value="professional">專業</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-stone-500 block mb-1">開場白（新對話第一句）<Badge set={!!prefs.greeting} label="系統預設（無）" /></label>
            <input value={prefs.greeting || ""} onChange={e => setPrefs(p => ({ ...p, greeting: e.target.value }))}
              placeholder="例：嗨！我是林雨晴 ☔"
              className="w-full text-sm px-3 py-2 rounded-lg border border-stone-200 focus:border-stone-400 outline-none" />
          </div>

          <div>
            <label className="text-xs font-semibold text-stone-500 block mb-1">備註（只有你看）<Badge set={!!prefs.notes} label="系統預設（無）" /></label>
            <textarea value={prefs.notes || ""} onChange={e => setPrefs(p => ({ ...p, notes: e.target.value }))} rows={2}
              className="w-full text-sm px-3 py-2 rounded-lg border border-stone-200 focus:border-stone-400 outline-none resize-none" />
          </div>
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-stone-100 flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="px-5 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: themeInfo.accent }}>
            {saving ? "儲存中..." : "💾 儲存基本資料"}
          </button>
          {msg && <span className="text-xs text-stone-600">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
