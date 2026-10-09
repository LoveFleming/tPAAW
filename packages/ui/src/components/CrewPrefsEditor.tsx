import API_BASE from "../api";
import React, { useState, useEffect } from "react";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import Icon from "./Icon";

interface CrewPrefs {
  displayName?: string;
  avatarUrl?: string;
  greeting?: string;
  tone?: string;
  notes?: string;
}

interface CrewPrefsEditorProps {
  crew: { id: string; title?: string; codename?: string; imageUrl?: string };
  onSaved?: () => void;
  onCancel?: () => void;
}

const TONE_OPTIONS = [
  { value: "", labelKey: "crew.prefs.toneDefault" },
  { value: "concise", labelKey: "crew.prefs.toneConcise" },
  { value: "detailed", labelKey: "crew.prefs.toneDetailed" },
  { value: "casual", labelKey: "crew.prefs.toneCasual" },
  { value: "professional", labelKey: "crew.prefs.toneProfessional" },
];

/**
 * 員工偏好編輯器（2026-10-09）— 外觀層：頭像/顯示名/開場白/語氣/備註
 * firmware crew 行為唯讀；偏好存 data/crew-preferences.json（user 層，module 更新蓋不到）
 */
export default function CrewPrefsEditor({ crew, onSaved, onCancel }: CrewPrefsEditorProps) {
  const { t } = useI18n();
  const { info: theme } = useTheme();
  const [prefs, setPrefs] = useState<CrewPrefs>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/crew-preferences/${crew.id}`)
      .then(r => r.json())
      .then((d: CrewPrefs) => setPrefs(d || {}))
      .catch(() => setPrefs({}));
  }, [crew.id]);

  const set = (k: keyof CrewPrefs, v: string) => setPrefs(p => ({ ...p, [k]: v }));

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch(`${API_BASE}/api/uploads`, { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Upload failed (${resp.status})`);
      set("avatarUrl", data.url || data.path || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/crew-preferences/${crew.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Save failed (${resp.status})`);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const avatarSrc = prefs.avatarUrl
    ? (prefs.avatarUrl.startsWith("/") ? `${API_BASE}${prefs.avatarUrl}` : prefs.avatarUrl)
    : (crew.imageUrl?.startsWith("/")
      ? `${API_BASE}/api/crew-pic/${crew.imageUrl.split("/").pop()}`
      : crew.imageUrl);

  const inputCls = "w-full text-xs px-2.5 py-1.5 rounded-lg border outline-none focus:border-stone-400 transition-colors bg-white";
  const inputStyle = { borderColor: theme.accentBorder, color: theme.accentText };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="w-[480px] max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-bold text-stone-800">{t("crew.prefs.title")}</div>
            <div className="font-mono text-[10px] text-stone-400 mt-0.5">{crew.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 border border-stone-200">🔒 {t("crew.prefs.lockedHint")}</span>
            <button onClick={onCancel} className="p-1 rounded-lg hover:bg-stone-100 text-stone-400"><Icon name="x" size={16} /></button>
          </div>
        </div>

        {/* Avatar preview */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-16 h-16 rounded-xl border overflow-hidden flex items-center justify-center shrink-0" style={{ borderColor: theme.accentBorder, backgroundColor: theme.accentBg }}>
            {avatarSrc ? (
              <img src={avatarSrc} alt="avatar" className="w-full h-full object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <span className="text-2xl">👤</span>
            )}
          </div>
          <div className="flex-1">
            <label className="text-[10px] font-semibold text-stone-400 block mb-1">{t("crew.prefs.avatar")}</label>
            <div className="flex gap-2">
              <input
                value={prefs.avatarUrl || ""}
                onChange={e => set("avatarUrl", e.target.value)}
                placeholder="https://… or /api/uploads/…"
                className={inputCls}
                style={inputStyle}
              />
              <label className="px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer shrink-0 hover:bg-stone-50" style={{ borderColor: theme.accentBorder, color: theme.accent }}>
                {uploading ? "…" : `📷 ${t("crew.prefs.upload")}`}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
              </label>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-stone-400 block mb-1">{t("crew.prefs.displayName")}</label>
            <input
              value={prefs.displayName || ""}
              onChange={e => set("displayName", e.target.value)}
              placeholder={crew.title || crew.id}
              className={inputCls}
              style={inputStyle}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-stone-400 block mb-1">{t("crew.prefs.greeting")}</label>
            <input
              value={prefs.greeting || ""}
              onChange={e => set("greeting", e.target.value)}
              placeholder={t("crew.prefs.greetingPlaceholder")}
              className={inputCls}
              style={inputStyle}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-stone-400 block mb-1">{t("crew.prefs.tone")}</label>
            <select
              value={prefs.tone || ""}
              onChange={e => set("tone", e.target.value)}
              className={inputCls}
              style={inputStyle}
            >
              {TONE_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-stone-400 block mb-1">{t("crew.prefs.notes")}</label>
            <textarea
              value={prefs.notes || ""}
              onChange={e => set("notes", e.target.value)}
              rows={2}
              className={inputCls}
              style={inputStyle}
            />
          </div>
        </div>

        {error && <div className="text-xs text-red-500 mt-3">⚠️ {error}</div>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold border text-stone-500 hover:bg-stone-50" style={{ borderColor: theme.accentBorder }}>
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-white shadow-sm disabled:opacity-50"
            style={{ backgroundColor: theme.accent }}
          >
            {saving ? "…" : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
