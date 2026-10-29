/**
 * RuCloneModal — 🌐 從 Git Repo 建立 Release Unit
 *
 * POST /api/ru/clone（server git clone）→ POST /api/ru/workspaces（註冊 + crew 種子）
 * → onCloned(path)（CodingIDE switchRu + 開 onboarding）
 */
import React, { useState } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";

interface Props {
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; text: string };
  onClose: () => void;
  onCloned: (path: string) => void;
}

const PARENT_KEY = "paaw.ruClone.parentDir";

export default function RuCloneModal({ theme: t, onClose, onCloned }: Props) {
  const { t: i18n } = useI18n();
  const [gitUrl, setGitUrl] = useState("");
  const [parentDir, setParentDir] = useState(() => {
    try { return localStorage.getItem(PARENT_KEY) || ""; } catch { return ""; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!gitUrl.trim() || !parentDir.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      try { localStorage.setItem(PARENT_KEY, parentDir.trim()); } catch {}
      const res = await fetch(`${API_BASE}/api/ru/clone`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gitUrl: gitUrl.trim(), parentDir: parentDir.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail ? `${data.error}：${data.detail}` : (data.error || `HTTP ${res.status}`));
      // 註冊 RU（server 會 seed crew 進 .paaw/agents/）
      const reg = await fetch(`${API_BASE}/api/ru/workspaces`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: data.path }),
      });
      if (!reg.ok) {
        const rj = await reg.json().catch(() => ({}));
        throw new Error(rj.error || `register failed (HTTP ${reg.status})`);
      }
      onCloned(data.path);
    } catch (e: any) {
      setErr(e.message || "clone failed");
    }
    setBusy(false);
  };

  const inputCls = "w-full text-sm font-mono px-3 py-2 border rounded-lg bg-stone-50 outline-none focus:border-emerald-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.35)" }} onClick={() => { if (!busy) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" style={{ border: `1px solid ${t.borderLight}` }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: t.borderLight, background: t.bgMuted }}>
          <div className="text-sm font-bold text-stone-800">🌐 {i18n("ru.cloneTitle")}</div>
          {!busy && <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-lg leading-none px-2">✕</button>}
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-stone-500 mb-1 block">{i18n("ru.cloneUrl")} *</label>
            <input className={inputCls} style={{ borderColor: err ? "#ef4444" : undefined }} value={gitUrl}
              onChange={e => { setGitUrl(e.target.value); setErr(""); }}
              placeholder="https://github.com/user/repo.git" autoFocus
              onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) submit(); }} />
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 mb-1 block">{i18n("ru.cloneParent")} *</label>
            <input className={inputCls} style={{ borderColor: err ? "#ef4444" : undefined }} value={parentDir}
              onChange={e => { setParentDir(e.target.value); setErr(""); }}
              placeholder="/Users/you/App" />
          </div>
          {err && <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg p-2.5 break-all">❌ {err}</div>}
          {busy && <div className="text-xs text-stone-500 animate-pulse">{i18n("ru.cloneRunning")}</div>}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: t.borderLight, background: t.bgMuted }}>
          <button onClick={onClose} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border text-stone-600 hover:bg-white disabled:opacity-40" style={{ borderColor: t.borderLight }}>
            {i18n("ss.close")}
          </button>
          <button onClick={submit} disabled={busy || !gitUrl.trim() || !parentDir.trim()}
            className="text-xs px-4 py-1.5 rounded-lg text-white font-semibold disabled:opacity-40" style={{ background: t.accent }}>
            {busy ? "…" : i18n("ru.cloneBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
