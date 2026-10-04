/**
 * ModulePickerModal — 🧩 從 App Module 建立 Release Unit（2026-10-04）
 *
 * GET /api/apps/modules（含 dir）→ 點選 → POST /api/ru/workspaces {path, label: 🧩…}
 * → onPicked(path, label)（CodingIDE switchRu + 開 onboarding）
 *
 * FDE 工作台：persona app 模組本體用 coding app 開發（EM 派工 → 委員會 review），
 * 模組目錄 = installed-apps/<id>，in-place 開發、改完重啟生效。
 */
import React, { useEffect, useState } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";

interface Props {
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; text: string };
  onClose: () => void;
  onPicked: (path: string, label: string) => void;
}

type Mod = { id: string; name: string; version: string; nav?: { label?: string; emoji?: string } | null; enabled: boolean; error?: string | null; dir?: string | null };

export default function ModulePickerModal({ theme: t, onClose, onPicked }: Props) {
  const { t: i18n } = useI18n();
  const [mods, setMods] = useState<Mod[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/apps/modules`)
      .then(r => r.json())
      .then(d => setMods(d.modules || []))
      .catch(() => setMods([]));
  }, []);

  const pick = async (m: Mod) => {
    if (!m.dir || busy) return;
    setBusy(m.id); setErr("");
    try {
      const label = `🧩 ${m.nav?.label || m.name}`.slice(0, 40);
      const res = await fetch(`${API_BASE}/api/ru/workspaces`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: m.dir, label }),
      });
      const data = await res.json();
      if (!res.ok || !data.unit) throw new Error(data.error || `HTTP ${res.status}`);
      onPicked(data.unit.path, label);
    } catch (e: any) {
      setErr(e.message || "register failed");
      setBusy("");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={busy ? undefined : onClose}>
      <div className="rounded-2xl shadow-2xl w-[460px] max-h-[80vh] overflow-hidden flex flex-col"
        style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.borderLight}` }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b flex items-center" style={{ borderColor: t.borderLight }}>
          <div className="font-bold">🧩 {i18n("ru.modulePicker.title", "Load App Module")}</div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">✕</button>
        </div>
        <div className="p-4 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          <div className="text-xs text-stone-400 mb-3 leading-relaxed">
            {i18n("ru.modulePicker.hint", "把 installed-apps 的模組註冊成 Release Unit — 用 coding app 直接開發模組本體（EM 派工 → 委員會 review），改完重啟生效")}
          </div>
          {mods === null && <div className="text-sm text-stone-400">…</div>}
          {mods !== null && mods.length === 0 && (
            <div className="text-sm text-stone-400">{i18n("ru.modulePicker.empty", "沒有可載入的模組 — 先到 📦 App Modules scaffold 一個")}</div>
          )}
          <div className="flex flex-col gap-1.5">
            {mods && mods.map(m => (
              <button key={m.id} disabled={!m.dir || !!busy} onClick={() => pick(m)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors hover:border-stone-400 disabled:opacity-40"
                style={{ borderColor: t.borderLight, backgroundColor: t.bgMuted }}>
                <span className="text-lg shrink-0">{m.nav?.emoji || "📦"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{m.nav?.label || m.name}</span>
                  <span className="block text-[11px] text-stone-400 font-mono truncate">{m.id} · v{m.version}{m.dir ? "" : " · no dir"}</span>
                </span>
                {m.error && <span className="text-[10px] text-red-500 shrink-0" title={m.error}>⚠️</span>}
                {!m.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-200 text-stone-500 shrink-0">{i18n("ru.modulePicker.disabled", "disabled")}</span>}
                {busy === m.id ? <span className="text-xs text-stone-400 shrink-0">…</span> : <span className="text-stone-300 shrink-0">→</span>}
              </button>
            ))}
          </div>
          {err && <div className="mt-3 text-xs text-red-600">❌ {err}</div>}
        </div>
      </div>
    </div>
  );
}
