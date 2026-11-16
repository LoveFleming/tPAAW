/**
 * ProjectMdPage — 📄 Prod Spec（PROJECT.md）編輯頁
 *
 * 2026-11-16 Fleming：product spec 做在 project page（不另開頁/agent）；tab 改名 Prod Spec、跟 PAAW project 解耦
 * 2026-11-16 Fleming（晚）：AI Overview 區、User Remarks 區先後移除 — 頁面只剩 Product Spec
 * - 📄 Product Spec（人+AI 共寫 — 8 節 schema；✨ AI 初稿只在空著時可按）
 * 檔案：.paaw/PROJECT.md（marker 切區，server lib/project-md.mjs 同 schema）
 */

import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import { uiAlert } from "./ui/uiFeedback";

interface Props {
  rootPath: string;
  theme?: { bg?: string; bgMuted?: string; borderLight?: string; accent?: string; accentBg?: string; text?: string };
}

export default function ProjectMdPage({ rootPath, theme }: Props) {
  const { t } = useI18n();
  const tk = theme || {};
  const [exists, setExists] = useState<boolean | null>(null); // null = loading
  const [specSection, setSpecSection] = useState("");
  const [specEditing, setSpecEditing] = useState("");
  const [specDirty, setSpecDirty] = useState(false);
  const [specSaving, setSpecSaving] = useState(false);
  const [specDrafting, setSpecDrafting] = useState(false);

  const load = useCallback(async () => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/project-md?path=${encodeURIComponent(rootPath)}`);
      const d = await r.json();
      setExists(!!d.exists);
      setSpecSection(d.specSection || "");
      setSpecEditing(d.specSection || "");
      setSpecDirty(false);
    } catch {
      setExists(false);
    }
  }, [rootPath]);

  useEffect(() => { setExists(null); load(); }, [load]);

  const saveSpec = async () => {
    if (!rootPath || specSaving) return;
    setSpecSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/project-md?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specSection: specEditing }),
      });
      if (!r.ok) throw new Error(await r.text());
      uiAlert(`✅ ${t("projectMd.specSaved")}`);
      await load();
    } catch (e: any) {
      uiAlert(`${t("projectMd.saveFail")}: ${e?.message || e}`);
    }
    setSpecSaving(false);
  };

  const draftSpec = async () => {
    if (!rootPath || specDrafting) return;
    setSpecDrafting(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/project-md/spec-draft?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "failed");
      if (!d.generated) throw new Error(t("projectMd.specDraftNoCode"));
      uiAlert(`✅ ${t("projectMd.specDraftDone")}${d.source === "llm" ? "（AI）" : "（確定性）"}`);
      await load();
    } catch (e: any) {
      uiAlert(`${t("projectMd.specDraftFail")}: ${e?.message || e}`);
    }
    setSpecDrafting(false);
  };

  if (!rootPath) return null;
  if (exists === null) {
    return <div className="flex items-center justify-center h-full text-stone-400 text-sm">⏳ {t("projectMd.loading")}</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: tk.bg || "#fff" }}>
      <div className="w-full h-full px-6 py-4 flex flex-col overflow-y-auto">

        {/* ── 📄 Product Spec（人+AI 共寫）── */}
        <section className="rounded-xl border flex-1 min-h-0 flex flex-col" style={{ borderColor: tk.borderLight || "#e7e5e4" }}>
          <div className="px-4 py-2.5 flex items-center gap-2 border-b flex-none" style={{ borderColor: tk.borderLight || "#e7e5e4", background: tk.bgMuted || "#fafaf9" }}>
            <span className="text-sm font-bold">📄 {t("projectMd.specTitle")}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">{t("projectMd.coWrite")}</span>
            <div className="flex-1" />
            {specDirty && <span className="text-[10px] text-amber-600">{t("projectMd.unsaved")}</span>}
            {!specSection && !specDirty && (
              <button
                onClick={draftSpec}
                disabled={specDrafting || specDirty}
                className="text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40"
                style={{ borderColor: tk.borderLight || "#e7e5e4", color: tk.accent || "#8b5e3c" }}
                title={t("projectMd.specDraftTitle")}
              >{specDrafting ? `⏳ ${t("projectMd.specDrafting")}` : `✨ ${t("projectMd.specDraftBtn")}`}</button>
            )}
            <button
              onClick={() => { setSpecEditing(specSection); setSpecDirty(false); }}
              disabled={!specDirty || specSaving}
              className="text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-30"
              style={{ borderColor: tk.borderLight || "#e7e5e4", color: "#78716c" }}
            >{t("projectMd.revert")}</button>
            <button
              onClick={saveSpec}
              disabled={!specDirty || specSaving}
              className="text-xs px-3 py-1 rounded-lg text-white disabled:opacity-40 font-medium"
              style={{ backgroundColor: tk.accent || "#8b5e3c" }}
            >{specSaving ? "…" : t("projectMd.save")}</button>
          </div>
          <div className="p-3 flex-1 min-h-0 flex flex-col">
            <textarea
              value={specEditing}
              onChange={(e) => { setSpecEditing(e.target.value); setSpecDirty(true); }}
              placeholder={t("projectMd.specPlaceholder")}
              className="w-full flex-1 text-sm rounded-lg border px-3 py-2 resize-none focus:outline-none focus:border-stone-400 bg-white leading-relaxed font-mono"
              style={{ borderColor: tk.borderLight || "#e7e5e4" }}
            />
            <p className="text-[10px] text-stone-400 mt-1.5">{t("projectMd.specHint")}</p>
          </div>
        </section>

      </div>
    </div>
  );
}
