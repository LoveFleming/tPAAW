/**
 * ProjectMdPage — 📖 PROJECT.md（schema v2）檢視/編輯頁
 *
 * 2026-10-09 Fleming 需求：維運/交接/troubleshooting agent 要有專案說明可參考。
 * - 上半：📌 User Remarks（人寫區 — textarea + 儲存；AI/CU 絕不覆蓋）
 * - 下半：🤖 AI Overview（CU 每次重寫 — 唯讀渲染 + 🔄 手動重新生成）
 * 檔案：.paaw/PROJECT.md（marker 切兩區，server lib/project-md.mjs 同 schema）
 */

import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import MarkdownText from "./MarkdownText";
import { uiAlert } from "./ui/uiFeedback";

interface Props {
  rootPath: string;
  theme?: { bg?: string; bgMuted?: string; borderLight?: string; accent?: string; accentBg?: string; text?: string };
}

export default function ProjectMdPage({ rootPath, theme }: Props) {
  const { t } = useI18n();
  const tk = theme || {};
  const [exists, setExists] = useState<boolean | null>(null); // null = loading
  const [userSection, setUserSection] = useState("");
  const [aiSection, setAiSection] = useState("");
  const [editing, setEditing] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);

  const load = useCallback(async () => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/project-md?path=${encodeURIComponent(rootPath)}`);
      const d = await r.json();
      setExists(!!d.exists);
      setUserSection(d.userSection || "");
      setEditing(d.userSection || "");
      setAiSection(d.aiSection || "");
      setDirty(false);
    } catch {
      setExists(false);
    }
  }, [rootPath]);

  useEffect(() => { setExists(null); load(); }, [load]);

  const save = async () => {
    if (!rootPath || saving) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/project-md?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userSection: editing }),
      });
      if (!r.ok) throw new Error(await r.text());
      uiAlert(`✅ ${t("projectMd.saved")}`);
      setDirty(false);
      await load();
    } catch (e: any) {
      uiAlert(`${t("projectMd.saveFail")}: ${e?.message || e}`);
    }
    setSaving(false);
  };

  const regenerate = async () => {
    if (!rootPath || regen) return;
    setRegen(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/project-md/regenerate?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "failed");
      uiAlert(`✅ ${t("projectMd.regenDone")}${d.aiSource === "llm" ? "（AI）" : "（確定性）"}`);
      await load();
    } catch (e: any) {
      uiAlert(`${t("projectMd.regenFail")}: ${e?.message || e}`);
    }
    setRegen(false);
  };

  if (!rootPath) return null;
  if (exists === null) {
    return <div className="flex items-center justify-center h-full text-stone-400 text-sm">⏳ {t("projectMd.loading")}</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: tk.bg || "#fff" }}>
      <div className="w-full h-full px-6 py-4 space-y-5 flex flex-col">

        {/* ── 上半：User Remarks（人寫區）── */}
        <section className="rounded-xl border flex-none" style={{ borderColor: tk.borderLight || "#e7e5e4" }}>
          <div className="px-4 py-2.5 flex items-center gap-2 border-b" style={{ borderColor: tk.borderLight || "#e7e5e4", background: tk.bgMuted || "#fafaf9" }}>
            <span className="text-sm font-bold">📌 {t("projectMd.userRemarks")}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{t("projectMd.humanOnly")}</span>
            <div className="flex-1" />
            {dirty && <span className="text-[10px] text-amber-600">{t("projectMd.unsaved")}</span>}
            <button
              onClick={() => { setEditing(userSection); setDirty(false); }}
              disabled={!dirty || saving}
              className="text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-30"
              style={{ borderColor: tk.borderLight || "#e7e5e4", color: "#78716c" }}
            >{t("projectMd.revert")}</button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="text-xs px-3 py-1 rounded-lg text-white disabled:opacity-40 font-medium"
              style={{ backgroundColor: tk.accent || "#8b5e3c" }}
            >{saving ? "…" : t("projectMd.save")}</button>
          </div>
          <div className="p-3">
            <textarea
              value={editing}
              onChange={(e) => { setEditing(e.target.value); setDirty(true); }}
              rows={8}
              placeholder={t("projectMd.userPlaceholder")}
              className="w-full text-sm rounded-lg border px-3 py-2 resize-y focus:outline-none focus:border-stone-400 bg-white leading-relaxed"
              style={{ borderColor: tk.borderLight || "#e7e5e4" }}
            />
            <p className="text-[10px] text-stone-400 mt-1.5">{t("projectMd.userHint")}</p>
          </div>
        </section>

        {/* ── 下半：AI Overview（CU 生成區）── */}
        <section className="rounded-xl border flex-1 min-h-0 flex flex-col" style={{ borderColor: tk.borderLight || "#e7e5e4" }}>
          <div className="px-4 py-2.5 flex items-center gap-2 border-b flex-none" style={{ borderColor: tk.borderLight || "#e7e5e4", background: tk.bgMuted || "#fafaf9" }}>
            <span className="text-sm font-bold">🤖 {t("projectMd.aiOverview")}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">{t("projectMd.autoGen")}</span>
            <div className="flex-1" />
            <button
              onClick={regenerate}
              disabled={regen}
              className="text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40"
              style={{ borderColor: tk.borderLight || "#e7e5e4", color: tk.accent || "#8b5e3c" }}
              title={t("projectMd.regenTitle")}
            >{regen ? `⏳ ${t("projectMd.regening")}` : "🔄"}</button>
          </div>
          <div className="p-4 overflow-y-auto flex-1 min-h-0">
            {aiSection ? (
              <div className="text-sm leading-relaxed" style={{ color: tk.text || "#44403c" }}>
                <MarkdownText>{aiSection}</MarkdownText>
              </div>
            ) : (
              <div className="text-center py-8 text-stone-400 text-sm">
                <div className="text-2xl mb-2">🤖</div>
                {exists ? t("projectMd.noAiYet") : t("projectMd.notExists")}
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
