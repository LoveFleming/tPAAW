/**
 * RuSkillManagerModal — 📚 RU Skill 資產管理（Skill Instance Model，2026-09-05）
 *
 * 「skill 是 Release Unit 的資產」— 管理 {ru}/.paaw/skills/ 內的實例：
 *   - RU 內技能：狀態徽章（🟢已跟版 / ✏️已客製 / ↕可跟版 / ⚠️來源不存在 / 💥損壞）
 *     + 動作：更新（跟版）/ 看內容 / 移除（連 crew 綁定一起解）
 *   - 全域可用：還沒進 RU 的模板 → [+] clone 進來
 *
 * API：GET/DELETE ru-skills、POST ru-skills/sync|add（全部零 LLM token）
 */
import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";

interface SkillItem { id: string; name: string; status: string; bound: boolean; syncedAt: string | null }
interface AvailItem { id: string; name: string }
interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; text: string };
  onClose: () => void;
  onChanged?: () => void;
}

const STATUS_META: Record<string, { icon: string; cls: string; key: string }> = {
  synced:     { icon: "🟢", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", key: "rusk.stSynced" },
  customized: { icon: "✏️", cls: "bg-amber-50 text-amber-700 border-amber-200",      key: "rusk.stCustomized" },
  behind:     { icon: "↕️", cls: "bg-blue-50 text-blue-700 border-blue-200",          key: "rusk.stBehind" },
  orphan:     { icon: "⚠️", cls: "bg-stone-100 text-stone-500 border-stone-200",     key: "rusk.stOrphan" },
  broken:     { icon: "💥", cls: "bg-red-50 text-red-700 border-red-200",             key: "rusk.stBroken" },
};

export default function RuSkillManagerModal({ rootPath, theme: t, onClose, onChanged }: Props) {
  const { t: i18n } = useI18n();
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [available, setAvailable] = useState<AvailItem[]>([]);
  const [busyId, setBusyId] = useState("");
  const [msg, setMsg] = useState("");
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewContent, setViewContent] = useState("");
  const [showAvail, setShowAvail] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/ru-skills?path=${encodeURIComponent(rootPath)}`);
      const d = await res.json();
      setSkills(d.skills || []);
      setAvailable(d.available || []);
    } catch { setMsg("load failed"); }
    setLoading(false);
  }, [rootPath]);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, kind: "sync" | "add" | "remove") => {
    if (kind === "remove" && !confirm(i18n("rusk.removeConfirm").replace("{id}", id))) return;
    setBusyId(id + kind); setMsg("");
    try {
      let res: Response;
      if (kind === "sync") {
        res = await fetch(`${API_BASE}/api/coding-project/ru-skills/sync`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: rootPath, skillId: id }),
        });
      } else if (kind === "add") {
        res = await fetch(`${API_BASE}/api/coding-project/ru-skills/add`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: rootPath, skillId: id }),
        });
      } else {
        res = await fetch(`${API_BASE}/api/coding-project/ru-skills?path=${encodeURIComponent(rootPath)}&skillId=${encodeURIComponent(id)}`, { method: "DELETE" });
      }
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (kind === "sync" && d.summary?.[0]?.action === "customized") setMsg(i18n("rusk.msgCustomized"));
      else setMsg("");
      await load();
      onChanged?.();
    } catch (e: any) { setMsg(`❌ ${e.message}`); }
    setBusyId("");
  };

  const viewSkill = async (id: string) => {
    setViewId(id); setViewContent("…");
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/ru-skills?path=${encodeURIComponent(rootPath)}&skillId=${encodeURIComponent(id)}`);
      const d = await res.json();
      setViewContent(d.ok ? d.content : `❌ ${d.error}`);
    } catch (e: any) { setViewContent(`❌ ${e.message}`); }
  };

  const syncAll = async () => {
    setBusyId("__all__"); setMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/ru-skills/sync`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath }),
      });
      const d = await res.json();
      const up = (d.summary || []).filter((s: any) => s.action === "updated").length;
      const cu = (d.summary || []).filter((s: any) => s.action === "customized").length;
      setMsg(i18n("rusk.msgSyncAll").replace("{u}", String(up)).replace("{c}", String(cu)));
      await load();
      onChanged?.();
    } catch (e: any) { setMsg(`❌ ${e.message}`); }
    setBusyId("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col" style={{ border: `1px solid ${t.borderLight}`, maxHeight: "85vh" }} onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="px-5 py-3.5 border-b flex items-center gap-3 shrink-0" style={{ borderColor: t.borderLight, background: t.bgMuted }}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-stone-800">📚 {i18n("rusk.title")}</div>
            <div className="text-[11px] text-stone-500 mt-0.5 font-mono truncate">{rootPath}/.paaw/skills/</div>
          </div>
          <button onClick={syncAll} disabled={!!busyId}
            className="text-xs px-3 py-1.5 rounded-lg border bg-white hover:bg-stone-50 text-stone-600 font-medium disabled:opacity-40 shrink-0" style={{ borderColor: t.borderLight }}>
            {busyId === "__all__" ? "…" : `↕️ ${i18n("rusk.syncAll")}`}
          </button>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-lg leading-none px-2 shrink-0">✕</button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-xs text-stone-400 animate-pulse py-8 text-center">{i18n("ss.loading")}</div>
          ) : (
            <>
              <div className="text-[11px] font-bold text-stone-500 mb-2">{i18n("rusk.inRu")}（{skills.length}）</div>
              <div className="space-y-1.5 mb-4">
                {skills.length === 0 && <div className="text-xs text-stone-400 py-3 text-center border rounded-lg" style={{ borderColor: t.borderLight }}>{i18n("rusk.empty")}</div>}
                {skills.map(s => {
                  const meta = STATUS_META[s.status] || STATUS_META.orphan;
                  return (
                    <div key={s.id} className="flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-stone-50" style={{ borderColor: t.borderLight }}>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-stone-700 truncate">
                          {s.name}
                          {s.bound && <span title={i18n("rusk.boundHint")} className="ml-1">🔗</span>}
                        </div>
                        <div className="text-[10px] text-stone-400 font-mono truncate">{s.id}</div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${meta.cls}`}>{meta.icon} {i18n(meta.key)}</span>
                      {s.status === "behind" || s.status === "broken" ? (
                        <button onClick={() => act(s.id, "sync")} disabled={!!busyId}
                          className="text-[10px] px-2.5 py-1 rounded-lg text-white font-semibold disabled:opacity-40 shrink-0" style={{ background: t.accent }}>
                          {busyId === s.id + "sync" ? "…" : i18n("rusk.updateBtn")}
                        </button>
                      ) : null}
                      <button onClick={() => viewSkill(s.id)} className="text-[10px] px-2 py-1 rounded-lg border bg-white text-stone-500 hover:bg-stone-100 shrink-0" style={{ borderColor: t.borderLight }}>
                        {viewId === s.id ? i18n("rusk.closeView") : i18n("rusk.viewBtn")}
                      </button>
                      <button onClick={() => act(s.id, "remove")} disabled={!!busyId}
                        className="text-[10px] px-2 py-1 rounded-lg border bg-white text-red-500 hover:bg-red-50 disabled:opacity-40 shrink-0" style={{ borderColor: t.borderLight }}>
                        {busyId === s.id + "remove" ? "…" : "🗑"}
                      </button>
                    </div>
                  );
                })}
                {viewId && (
                  <pre className="text-[10px] font-mono bg-stone-900 text-stone-100 rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap">{viewContent}</pre>
                )}
              </div>

              {/* available */}
              <div className="border-t pt-3" style={{ borderColor: t.borderLight }}>
                <button onClick={() => setShowAvail(!showAvail)} className="text-[11px] font-bold text-stone-500 hover:text-stone-700 w-full text-left">
                  {showAvail ? "▾" : "▸"} {i18n("rusk.available")}（{available.length}）
                </button>
                {showAvail && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {available.map(a => (
                      <button key={a.id} onClick={() => act(a.id, "add")} disabled={!!busyId}
                        title={a.id}
                        className="text-[10px] px-2.5 py-1 rounded-full border bg-white hover:bg-emerald-50 hover:border-emerald-300 text-stone-600 disabled:opacity-40" style={{ borderColor: t.borderLight }}>
                        {busyId === a.id + "add" ? "…" : "＋"} {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t flex items-center justify-between shrink-0" style={{ borderColor: t.borderLight, background: t.bgMuted }}>
          <span className="text-[10px] text-stone-400">{msg || i18n("rusk.hint")}</span>
          <button onClick={onClose} className="text-xs px-4 py-1.5 rounded-lg text-white font-semibold" style={{ background: t.accent }}>{i18n("ss.close")}</button>
        </div>
      </div>
    </div>
  );
}
