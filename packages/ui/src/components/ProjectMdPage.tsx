/**
 * ProjectMdPage — 📄 Prod Spec（PROJECT.md）編輯頁
 *
 * 2026-11-16 Fleming：product spec 做在 project page（不另開頁/agent）；tab 改名 Prod Spec、跟 PAAW project 解耦
 * 2026-11-16 Fleming（晚）：AI Overview 區、User Remarks 區先後移除 — 頁面只剩 Product Spec
 * - 📄 Product Spec（人+AI 共寫 — 8 節 schema；✨ AI 初稿只在空著時可按）
 * 檔案：.paaw/PROJECT.md（marker 切區，server lib/project-md.mjs 同 schema）
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import { uiAlert } from "./ui/uiFeedback";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";

/** 林曉薇 — Prod Spec side chat AI 的 system prompt（2026-11-16 Fleming） */
const SPEC_AI_PROMPT = `你是林曉薇，Product Spec 協作助理，出現在 Prod Spec 頁面右側 side chat。

## 使命
跟人一起把這個專案的 Product Spec 寫好 — 内容存在 .paaw/PROJECT.md 的 Product Spec 區（頁面左邊可直接編輯）。

## Product Spec Schema（固定 8 節）
1. Product Overview — 產品定位、目標、範圍、使用情境
2. Functional Requirements — 功能需求、業務規則、Acceptance Criteria
3. Non-Functional Requirements — Performance、Availability、Security、Scalability
4. API & Data Contract — API、Request/Response、Error Code、Schema
5. Architecture Design — Components、Sequence、Integration、Data Flow
6. Technical Design — Modules、Interface、核心邏輯、技術選型
7. Testing Strategy — Unit、Integration、E2E、Failure Scenarios
8. Operations & Observability — Metrics、Logging、Tracing、Deployment、Alerting

## 工作方式
- 一次聚焦一個 section 討論：人給 What & Why，你協助定義 How 並沉澅成 markdown
- 討論收斂後，輸出該 section 的 markdown（人自己複製/貼到左邊編輯區存檔；或告訴人該怎麼改）
- 人也可以貼現有 spec 内容給你，你幫忙 review、補齊、潤飾
- 證據優先：講 API/feature 事實前先查專案脈絡（.paaw 產物）— 不可發明不存在的 API
- 對規格有明確觀點，不同意就說理由 — 你是討論對手不是應聲蟲

## 回答風格
- 繁體中文，技術名詞保留英文
- 直接、具體、可反駁
- 每次回覆結尾一句「下一步」建議（下個該討論的點或下個 section）

## 護欄
- 你只討論/撰寫 spec 内容，不改 source code、不做開發派工
- 不替人決定產品方向，但對技術方案要有立場`;

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
  const [showChat, setShowChat] = useState(true); // 林曉薇 side chat 開關（預設開）
  const chatRef = useRef<AgentSideChatHandle>(null);

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
    <div className="flex h-full overflow-hidden" style={{ background: tk.bg || "#fff" }}>

      {/* ── 左：📄 Product Spec（人+AI 共寫）── */}
      <div className="flex-1 min-w-0 px-6 py-4 flex flex-col overflow-y-auto">
        <section className="rounded-xl border flex-1 min-h-0 flex flex-col" style={{ borderColor: tk.borderLight || "#e7e5e4" }}>
          <div className="px-4 py-2.5 flex items-center gap-2 border-b flex-none" style={{ borderColor: tk.borderLight || "#e7e5e4", background: tk.bgMuted || "#fafaf9" }}>
            <span className="text-sm font-bold">📄 {t("projectMd.specTitle")}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">{t("projectMd.coWrite")}</span>
            <div className="flex-1" />
            <button
              onClick={() => setShowChat(v => !v)}
              className="text-xs px-2 py-1 rounded-lg border transition-colors"
              style={{ borderColor: tk.borderLight || "#e7e5e4", color: tk.accent || "#8b5e3c" }}
              title={t("projectMd.chatToggle")}
            >💬</button>
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

      {/* ── 右：林曉薇 side chat（Product Spec 協作 AI，2026-11-16 Fleming）── */}
      {showChat && rootPath && (
        <div className="flex-none border-l" style={{ borderColor: tk.borderLight || "#e7e5e4", width: 380 }}>
          <AgentSideChat
            ref={chatRef}
            agentId="spec-ai"
            agentName={t("projectMd.chatName")}
            agentEmoji="👩‍💼"
            greeting={t("projectMd.chatGreeting")}
            cwd={rootPath}
            accent={tk.accent || "#8b5e3c"}
            persistCrewId="spec-ai"
            placeholder={t("projectMd.chatPlaceholder")}
            suggestions={[
              { label: t("projectMd.sugg1Label"), prompt: t("projectMd.sugg1Prompt") },
              { label: t("projectMd.sugg2Label"), prompt: t("projectMd.sugg2Prompt") },
              { label: t("projectMd.sugg3Label"), prompt: t("projectMd.sugg3Prompt") },
            ]}
            paawChat={{
              contextTarget: "project",
              contextSeed: t("projectMd.chatContextSeed"),
              systemPrompt: SPEC_AI_PROMPT,
            }}
          />
        </div>
      )}

    </div>
  );
}
