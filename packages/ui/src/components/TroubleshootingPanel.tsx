/**
 * TroubleshootingPanel — 🔧 維運頁
 *
 * 「可維運」— 出事知道怎麼查、怎麼修、怎麼退。
 *
 * 左（2026-10-09 Fleming 改版，像 Handover 的資訊層次）：
 * 左（2026-10-10 17:17 Fleming：排障 12 問移除 — TS Guide 條目 + side chat 已覆蓋）：
 *   ① 🧯 TS Guide 條目庫（症狀→原因→修法→證據；human/confirmed 重生成保留）
 * 右：Ops AI 助理（讀 log 幫診斷）
 *
 * 「AI 寫 Runbook」：注入 deterministic 證據（git 狀態 + releases + 現有 runbooks +
 * 真 API 清單）→ AI 用真實 API 路徑寫診斷/驗證步驟，不憑空掰 URL。
 * git/服務狀態不佔 UI（git tab 已有）但保留在 AI 證據裡。
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";
import { useColResize, ColResizer } from "./ColResizer"; // 2026-10-09：side chat 左右 splitter

interface OpsStatus {
  initialized: boolean;
  overview: {
    name: string | null; version: string | null;
    startCmd: string | null; testCmd: string | null;
    ports: string[]; dataDirs: string[]; deps: string[]; workspaces: string[]; envKeys: string[];
  } | null;
  git: {
    isRepo: boolean;
    branch: string | null;
    dirty: boolean;
    dirtyFiles: string[];
    lastCommits: string[];
  };
  runbooks: { id: string; title: string; bytes: number; mtime?: string; headings: string[]; source?: "human" | "ai" }[];
  scripts: Record<string, string>;
  releases: { id: string; taskId: string; title: string; releasedAt: string; note: string | null }[];
  checkedAt: string;
}

interface Props {
  rootPath: string;
  theme: any;
}

export default function TroubleshootingPanel({ rootPath, theme: tk }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const chatRef = useRef<AgentSideChatHandle>(null);
  // 2026-10-09 Fleming：Ops side chat 左右 splitter + 對話持久化 + model selector（跟 QA browser 同款）
  const opsPane = useColResize(520, 300, 760); // 2026-10-09：與 Handover/Release Manager 統一

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-ops/status?path=${encodeURIComponent(rootPath)}`);
      setStatus(await res.json());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => { refresh(); }, [refresh]);

  // ═══ 🧯 TS Guide（2026-10-10 Fleming：up-to-date 排障條目庫 — 純手動觸發，絕不自動燒 token）═══
  interface TsgEntry { id: string; symptom: string; cause: string; fixSteps: string[]; feature?: string | null; evidence: { type: string; ref: string }[]; status: "ai-draft" | "confirmed" | "human"; confirmedAt?: string; lastEditAt?: string }
  interface TsgGuide { generatedAt: string; entries: TsgEntry[]; gaps: string[]; factsSummary?: { fixCommits: number; bugTasks: number; agentLogErrors: number }; aiError?: string }
  const [tsg, setTsg] = useState<TsgGuide | null>(null);
  const [tsgLoading, setTsgLoading] = useState(false);
  const [tsgOpen, setTsgOpen] = useState<string | null>(null);
  const [tsgRemarks, setTsgRemarks] = useState<{ id: string; text: string; at: string }[]>([]);
  const [tsgRemarkText, setTsgRemarkText] = useState("");
  // 條目新增/編輯（2026-10-10 Fleming 17:03：AI 漏寫 SOP 人隨時補）
  const [entryForm, setEntryForm] = useState<{ mode: "add" | "edit"; id?: string; symptom: string; cause: string; fixStepsText: string; evidenceText: string; feature: string } | null>(null);
  const [tsgRemarkSaving, setTsgRemarkSaving] = useState(false);
  const composingRef = useRef(false); // IME 三層保護

  const loadTsg = useCallback(async () => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-trouble/guide?path=${encodeURIComponent(rootPath)}`);
      if (r.ok) { const d = await r.json(); setTsg(d.guide || null); setTsgRemarks(d.remarks || []); }
    } catch { /* silent */ }
  }, [rootPath]);

  const generateTsg = useCallback(async () => {
    if (!rootPath || tsgLoading) return;
    setTsgLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-trouble/guide?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
      if (r.ok) { const d = await r.json(); setTsg(d.guide || null); setTsgRemarks(d.remarks || []); }
    } catch { /* silent */ }
    setTsgLoading(false);
  }, [rootPath, tsgLoading]);

  const confirmTsg = useCallback(async (id: string, unconfirm = false) => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-trouble/confirm?path=${encodeURIComponent(rootPath)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, unconfirm }),
      });
      if (r.ok) { const d = await r.json(); setTsg(d.guide || null); }
    } catch { /* silent */ }
  }, [rootPath]);

  const addTsgRemark = useCallback(async () => {
    const text = tsgRemarkText.trim();
    if (!text || tsgRemarkSaving || !rootPath) return;
    setTsgRemarkSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-trouble/remark?path=${encodeURIComponent(rootPath)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      });
      if (r.ok) { const d = await r.json(); setTsgRemarks(d.remarks || []); setTsgRemarkText(""); }
    } catch { /* silent */ }
    setTsgRemarkSaving(false);
  }, [tsgRemarkText, tsgRemarkSaving, rootPath]);

  const delTsgRemark = useCallback(async (id: string) => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-trouble/remark?path=${encodeURIComponent(rootPath)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r.ok) { const d = await r.json(); setTsgRemarks(d.remarks || []); }
    } catch { /* silent */ }
  }, [rootPath]);

  const saveEntry = useCallback(async () => {
    if (!entryForm || !rootPath || !entryForm.symptom.trim()) return;
    const fixSteps = entryForm.fixStepsText.split("\n").map(x => x.trim()).filter(Boolean);
    const payload: Record<string, unknown> = {
      symptom: entryForm.symptom, cause: entryForm.cause, fixSteps,
      evidenceText: entryForm.evidenceText, feature: entryForm.feature || null,
    };
    try {
      const url = `${API_BASE}/api/coding-trouble/entry?path=${encodeURIComponent(rootPath)}`;
      const r = entryForm.mode === "add"
        ? await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, id: entryForm.id }) });
      if (r.ok) { const d = await r.json(); setTsg(d.guide || null); setEntryForm(null); }
    } catch { /* silent */ }
  }, [entryForm, rootPath]);

  useEffect(() => { loadTsg(); }, [loadTsg]);

  return (
    <div className="flex h-full min-h-0">
      {/* ── 左：內容區 ── */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="px-5 py-3 border-b sticky top-0 bg-white/95 backdrop-blur z-10 flex items-center gap-2" style={{ borderColor: tk.borderLight }}>
          <span className="text-lg">🔧</span>
          <h2 className="text-sm font-bold text-stone-800">{t("ops.title")}</h2>
          <span className="ml-auto" />
        </div>

        {loading && <div className="p-8 text-center text-xs text-stone-400 animate-pulse">{t("common.loading")}</div>}

        {!loading && status && (
          <div className="p-5 space-y-5">
            {/* ═══ ① 🧯 TS Guide — up-to-date 排障條目庫（2026-10-10）═══ */}
            <section data-testid="tsg-section" className="border rounded-xl overflow-hidden bg-gradient-to-b from-orange-50/50 to-white" style={{ borderColor: tk.borderLight }}>
              <div className="flex items-center gap-2 px-3.5 py-2.5">
                <span>🧯</span>
                <span className="text-xs font-bold text-stone-700">{t("tsg.title")}</span>
                {tsg && <>
                  <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 text-[10px] font-bold">{tsg.entries.filter(e => e.status === "confirmed").length}/{tsg.entries.length} {t("tsg.confirmedShort")}</span>
                  <span className="text-[10px] text-stone-400">{tsg.generatedAt.slice(0, 16).replace("T", " ")}</span>
                  <button onClick={generateTsg} disabled={tsgLoading}
                    className="text-[10px] px-2 py-0.5 rounded border disabled:opacity-40 hover:bg-stone-50" style={{ borderColor: tk.borderLight }}>
                    {tsgLoading ? "…" : `↻ ${t("tsg.regenerate")}`}
                  </button>
                </>}
                <span className="ml-auto" />
                <button onClick={() => setEntryForm({ mode: "add", symptom: "", cause: "", fixStepsText: "", evidenceText: "", feature: "" })}
                  className="text-[10px] px-2 py-0.5 rounded border hover:bg-stone-50" style={{ borderColor: tk.borderLight }}>
                  + {t("tsg.addEntry")}
                </button>
                {!tsg && !tsgLoading && (
                  <button onClick={generateTsg} className="text-[11px] px-3 py-1.5 rounded-lg text-white font-medium" style={{ backgroundColor: "#ea580c" }}>
                    ✨ {t("tsg.generate")}
                  </button>
                )}
              </div>
              <div className="border-t px-3.5 py-2.5 space-y-2.5" style={{ borderColor: tk.borderLight }}>
                {tsgLoading && !tsg && <div className="text-[11px] text-stone-400 animate-pulse">{t("tsg.generating")}</div>}
                {!tsgLoading && !tsg && <div className="text-[11px] text-stone-400">{t("tsg.none")}</div>}
                {tsg?.aiError && <div className="text-[11px] text-amber-600">⚠️ {tsg.aiError}</div>}
                {tsg?.factsSummary && (
                  <div className="text-[10px] text-stone-400">{t("tsg.minedFrom")}: git fix ×{tsg.factsSummary.fixCommits} · bug task ×{tsg.factsSummary.bugTasks} · log err ×{tsg.factsSummary.agentLogErrors}</div>
                )}
                {tsg?.entries.map(e => (
                  <div key={e.id} className="border rounded-lg overflow-hidden bg-white" style={{ borderColor: tk.borderLight }}>
                    <button onClick={() => setTsgOpen(tsgOpen === e.id ? null : e.id)} className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-stone-50">
                      <span className="text-[11px] font-medium text-stone-800 flex-1 leading-snug">{e.symptom}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${e.status === "confirmed" ? "bg-green-100 text-green-700" : e.status === "human" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {e.status === "confirmed" ? `✓ ${t("tsg.confirmed")}` : e.status === "human" ? `✍️ ${t("tsg.human")}` : t("tsg.draft")}
                      </span>
                    </button>
                    {tsgOpen === e.id && (
                      <div className="border-t px-3 py-2.5 space-y-2" style={{ borderColor: tk.borderLight }}>
                        {e.feature && <div className="text-[10px] text-stone-400">📦 {e.feature}</div>}
                        <div className="text-[11px] text-stone-600 leading-relaxed"><span className="font-bold">{t("tsg.cause")}</span>{e.cause}</div>
                        {e.fixSteps.length > 0 && (
                          <div className="bg-stone-50 rounded-lg p-2 space-y-0.5">
                            <div className="text-[10px] font-bold text-stone-500 mb-0.5">🔧 {t("tsg.fixSteps")}</div>
                            {e.fixSteps.map((st, i) => <div key={i} className="text-[11px] text-stone-600 flex gap-1.5"><span className="text-stone-400 font-mono">{i + 1}.</span><span>{st}</span></div>)}
                          </div>
                        )}
                        {e.evidence.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {e.evidence.map((ev, i) => (
                              <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500" title={ev.ref}>{ev.type}: {ev.ref.slice(0, 36)}</span>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button onClick={() => setEntryForm({ mode: "edit", id: e.id, symptom: e.symptom, cause: e.cause, fixStepsText: e.fixSteps.join("\n"), evidenceText: e.evidence.find(x => x.type === "human")?.ref || "", feature: e.feature || "" })}
                            className="text-[10px] px-2.5 py-1 rounded-lg border hover:bg-stone-50" style={{ borderColor: tk.borderLight }}>
                            ✏️ {t("tsg.edit")}
                          </button>
                          <button onClick={() => confirmTsg(e.id, e.status === "confirmed")}
                            className={`text-[10px] px-2.5 py-1 rounded-lg font-bold ${e.status === "confirmed" ? "border hover:bg-stone-50" : "text-white hover:opacity-90"}`}
                            style={e.status === "confirmed" ? { borderColor: tk.borderLight } : { backgroundColor: "#16a34a" }}>
                            {e.status === "confirmed" ? t("tsg.unconfirm") : `✓ ${t("tsg.confirm")}`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {entryForm && (
                  <div className="border rounded-lg bg-white p-2.5 space-y-2" style={{ borderColor: "#ea580c" }} data-testid="tsg-entry-form">
                    <div className="text-[10px] font-bold text-stone-600">{entryForm.mode === "add" ? `➕ ${t("tsg.addEntry")}` : `✏️ ${t("tsg.edit")}`}</div>
                    <textarea value={entryForm.symptom} onChange={(ev) => setEntryForm({ ...entryForm, symptom: ev.target.value })} placeholder={t("tsg.symptomPh")} rows={2}
                      className="w-full text-[11px] rounded-lg border px-2 py-1.5 focus:outline-none focus:ring-1" style={{ borderColor: tk.borderLight }} />
                    <textarea value={entryForm.cause} onChange={(ev) => setEntryForm({ ...entryForm, cause: ev.target.value })} placeholder={t("tsg.causePh")} rows={2}
                      className="w-full text-[11px] rounded-lg border px-2 py-1.5 focus:outline-none focus:ring-1" style={{ borderColor: tk.borderLight }} />
                    <textarea value={entryForm.fixStepsText} onChange={(ev) => setEntryForm({ ...entryForm, fixStepsText: ev.target.value })} placeholder={t("tsg.stepsPh")} rows={4}
                      className="w-full text-[11px] rounded-lg border px-2 py-1.5 font-mono focus:outline-none focus:ring-1" style={{ borderColor: tk.borderLight }} />
                    <div className="flex gap-2">
                      <input value={entryForm.feature} onChange={(ev) => setEntryForm({ ...entryForm, feature: ev.target.value })} placeholder={t("tsg.featurePh")}
                        className="flex-1 text-[11px] rounded-lg border px-2 py-1 focus:outline-none focus:ring-1" style={{ borderColor: tk.borderLight }} />
                      <input value={entryForm.evidenceText} onChange={(ev) => setEntryForm({ ...entryForm, evidenceText: ev.target.value })} placeholder={t("tsg.evidencePh")}
                        className="flex-1 text-[11px] rounded-lg border px-2 py-1 focus:outline-none focus:ring-1" style={{ borderColor: tk.borderLight }} />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEntryForm(null)} className="text-[11px] px-3 py-1 rounded-lg border hover:bg-stone-50" style={{ borderColor: tk.borderLight }}>{t("tsg.cancel")}</button>
                      <button onClick={saveEntry} disabled={!entryForm.symptom.trim()} className="text-[11px] px-3 py-1 rounded-lg text-white font-bold disabled:opacity-40" style={{ backgroundColor: "#ea580c" }}>{t("tsg.save")}</button>
                    </div>
                  </div>
                )}
                {tsg?.gaps && tsg.gaps.length > 0 && (
                  <div className="bg-amber-50 rounded-lg p-2 space-y-0.5">
                    <div className="text-[10px] font-bold text-amber-700">⚠️ {t("tsg.gaps")}</div>
                    {tsg.gaps.map((g, i) => <div key={i} className="text-[11px] text-amber-600">• {g}</div>)}
                  </div>
                )}
                {/* ✍️ 人員注記（獨立檔 — 重生成永不覆蓋）*/}
                <div className="pt-1">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[10px] font-bold text-stone-500">✍️ {t("tsg.remarkTitle")}</span>
                    {tsgRemarks.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold">{tsgRemarks.length}</span>}
                  </div>
                  {tsgRemarks.map(r => (
                    <div key={r.id} className="flex items-start gap-2 group mb-1">
                      <span className="text-[9px] text-amber-600 font-mono mt-0.5">{(r.at || "").slice(5, 10)}</span>
                      <div className="text-[11px] text-stone-700 leading-relaxed flex-1">{r.text}</div>
                      <button onClick={() => delTsgRemark(r.id)} className="opacity-0 group-hover:opacity-100 text-[10px] text-stone-400 hover:text-red-500">✕</button>
                    </div>
                  ))}
                  <div className="flex gap-2 items-start">
                    <textarea
                      value={tsgRemarkText}
                      onChange={(ev) => setTsgRemarkText(ev.target.value)}
                      onCompositionStart={() => (composingRef.current = true)}
                      onCompositionEnd={() => (composingRef.current = false)}
                      onKeyDown={(ev) => {
                        if (composingRef.current || ev.nativeEvent.isComposing || ev.keyCode === 229) return;
                        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); addTsgRemark(); }
                      }}
                      placeholder={t("tsg.remarkPlaceholder")}
                      rows={2}
                      className="flex-1 text-[11px] rounded-lg border px-2.5 py-1.5 resize-y focus:outline-none focus:ring-1"
                      style={{ borderColor: tk.borderLight }}
                    />
                    <button onClick={addTsgRemark} disabled={!tsgRemarkText.trim() || tsgRemarkSaving}
                      className="text-[11px] px-3 py-1.5 rounded-lg text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: "#ea580c" }}>
                      {tsgRemarkSaving ? "…" : t("tsg.remarkAdd")}
                    </button>
                  </div>
                </div>
              </div>
            </section>


          </div>
        )}
      </div>

      {/* ── 右：Ops AI 助理 ── */}
      {/* 2026-10-09 Fleming：跟 QA browser 同款 — splitter 可拖寬 + 三按鈕（persistCrewId）+ model selector */}
      <ColResizer onDown={opsPane.startDrag} className="hidden md:block" />
      <div className="shrink-0 hidden md:block" style={{ width: opsPane.width }}>
        <AgentSideChat
          ref={chatRef}
          agentId="ops"
          agentName={t("ops.agentName")}
          agentEmoji="🔧"
          greeting={t("ops.agentGreeting")}
          cwd={rootPath}
          accent={tk.accent}
          accentHover={tk.accentHover || tk.accent}
          height="100%"
          persistCrewId="coding.ops-side"
          modelFeature="sideChat.ops"
          suggestions={[
            { label: t("ops.sug.diagnose"), prompt: t("ops.sug.diagnosePrompt") },
            { label: t("ops.sug.rollback"), prompt: t("ops.sug.rollbackPrompt") },
          ]}
        />
      </div>
    </div>
  );
}
