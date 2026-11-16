/**
 * ProjectMdPage — 📄 Prod Spec（PROJECT.md）tab sheet 編輯頁
 *
 * 2026-11-16 Fleming：product spec 做在 project page；tab 改名 Prod Spec、跟 PAAW project 解耦
 * 2026-11-16 Fleming（晚）：AI Overview / User Remarks 區先後移除；改 8-section tab sheet
 * - 上方 8 個 section tab；單節編輯 + 儲存
 * - 右側林曉薇（架構師）side chat — 一個 section 一個 section 討論
 * - ✍️ 曉薇寫入本節：AI 依討論對話 + 專案事實寫入該節（人可以不用寫，全靠 AI）
 * 檔案：.paaw/PROJECT.md（marker 切區，server lib/project-md.mjs 同 schema）
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import { uiAlert } from "./ui/uiFeedback";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";

/** 林曉薇 — Prod Spec side chat AI 的 system prompt（2026-11-16 Fleming） */
const SPEC_AI_PROMPT = `你是林曉薇，Product Spec 架構師，出現在 Prod Spec 頁面右側 side chat。

## 使命
跟人**一個 section 一個 section討論**，把這個專案的 Product Spec 寫好 — 頁面左邊有 8 個 section tab，内容存在 .paaw/PROJECT.md 的 Product Spec 區。

## Product Spec Schema（固定 8 sections = 8 個 tab）
1. Product Overview — 產品定位、目標、範圍、使用情境
2. Functional Requirements — 功能需求、業務規則、Acceptance Criteria
3. Non-Functional Requirements — Performance、Availability、Security、Scalability
4. API & Data Contract — API、Request/Response、Error Code、Schema
5. Architecture Design — Components、Sequence、Integration、Data Flow
6. Technical Design — Modules、Interface、核心邏輯、技術選型
7. Testing Strategy — Unit、Integration、E2E、Failure Scenarios
8. Operations & Observability — Metrics、Logging、Tracing、Deployment、Alerting

## 工作方式
- 逐段討論：一次聚焦人目前打開的那個 section。人給 What & Why，你協助定義 How
- 討論收斂後跟人說「可以寫入了」— 人按左邊的「✍️ 曉薇寫入本節」按鈕，系統會把你們的討論結論寫進該 section（你要確保討論裡結論夠完整）
- 人也可以貼現有 section 內容給你，你幫忙 review、補齊、潤飾
- 證據優先：講 API/feature 事實前先查專案脈絡（.paaw 產物）— 不可發明不存在的 API
- 對規格有明確觀點，不同意就說理由 — 你是討論對手不是應聲蟲

## 回答風格
- 繁體中文，技術名詞保留英文
- 直接、具體、可反駁
- 每次回覆結尾一句「下一步」建議（下個該討論的點或下個 section）

## 護欄
- 你只討論/撰寫 spec 內容，不改 source code、不做開發派工
- 不替人決定產品方向，但對技術方案要有立場`;

interface Props {
  rootPath: string;
  theme?: { bg?: string; bgMuted?: string; borderLight?: string; accent?: string; accentBg?: string; text?: string };
}

export default function ProjectMdPage({ rootPath, theme }: Props) {
  const { t } = useI18n();
  const tk = theme || {};
  const [exists, setExists] = useState<boolean | null>(null); // null = loading
  const [sections, setSections] = useState<string[]>(new Array(8).fill("")); // server 切好的 8 節
  const [editings, setEditings] = useState<string[]>(new Array(8).fill(""));
  const [dirtySet, setDirtySet] = useState<Set<number>>(new Set());
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [writing, setWriting] = useState(false); // ✍️ 曉薇寫入中
  const [showChat, setShowChat] = useState(true); // 林曉薇 side chat 開關（預設開）
  const chatRef = useRef<AgentSideChatHandle>(null);

  const applyLoaded = (d: any) => {
    setExists(!!d.exists);
    const parts: string[] = (d.specSections && d.specSections.length === 8) ? d.specSections : new Array(8).fill("");
    setSections(parts);
    setEditings([...parts]);
    setDirtySet(new Set());
  };

  const load = useCallback(async () => {
    if (!rootPath) return;
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/project-md?path=${encodeURIComponent(rootPath)}`);
      applyLoaded(await r.json());
    } catch {
      setExists(false);
    }
  }, [rootPath]);

  useEffect(() => { setExists(null); load(); }, [load]);

  const dirty = dirtySet.has(activeIdx);

  const setSectionText = (idx: number, text: string) => {
    setEditings(prev => { const n = [...prev]; n[idx] = text; return n; });
    setDirtySet(prev => new Set(prev).add(idx));
  };

  const save = async () => {
    if (!rootPath || saving) return;
    setSaving(true);
    try {
      // 整份 spec = 8 節以「## N. 標題」合回（server joinSpecSections 同步、只差在客端暫存）
      const r = await fetch(`${API_BASE}/api/coding-project/project-md?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specSections: editings }),
      });
      if (!r.ok) throw new Error(await r.text());
      uiAlert(`✅ ${t("projectMd.specSaved")}`);
      await load();
    } catch (e: any) {
      uiAlert(`${t("projectMd.saveFail")}: ${e?.message || e}`);
    }
    setSaving(false);
  };

  /** ✍️ 曉薇寫入本節 — server 讀 side chat 討論紀錄 + 事實生成本節（人可以不用寫） */
  const aiWriteSection = async () => {
    if (!rootPath || writing) return;
    // 有未存編輯先擋，避免蓋掉人剛打的字
    if (dirty) { uiAlert(t("projectMd.saveFirst")); return; }
    setWriting(true);
    try {
      const r = await fetch(`${API_BASE}/api/coding-project/project-md/spec-section?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: activeIdx }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "failed");
      uiAlert(`✅ ${t("projectMd.aiWriteDone")}`);
      await load();
    } catch (e: any) {
      uiAlert(`${t("projectMd.aiWriteFail")}: ${e?.message || e}`);
    }
    setWriting(false);
  };

  if (!rootPath) return null;
  if (exists === null) {
    return <div className="flex items-center justify-center h-full text-stone-400 text-sm">⏳ {t("projectMd.loading")}</div>;
  }

  const tabLabels = [
    t("projectMd.sec1"), t("projectMd.sec2"), t("projectMd.sec3"), t("projectMd.sec4"),
    t("projectMd.sec5"), t("projectMd.sec6"), t("projectMd.sec7"), t("projectMd.sec8"),
  ];

  return (
    <div className="flex h-full overflow-hidden" style={{ background: tk.bg || "#fff" }}>

      {/* ── 左：📄 Product Spec（8-section tab sheet）── */}
      <div className="flex-1 min-w-0 px-6 py-4 flex flex-col overflow-hidden">
        <section className="rounded-xl border flex-1 min-h-0 flex flex-col" style={{ borderColor: tk.borderLight || "#e7e5e4" }}>

          {/* 8 個 section tabs */}
          <div className="flex items-stretch gap-1 border-b overflow-x-auto flex-none" style={{ borderColor: tk.borderLight || "#e7e5e4", background: tk.bgMuted || "#fafaf9" }}>
            {tabLabels.map((label, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${i === activeIdx ? "font-bold" : "opacity-60 hover:opacity-90"}`}
                style={{ borderBottomColor: i === activeIdx ? (tk.accent || "#8b5e3c") : "transparent", color: i === activeIdx ? (tk.accent || "#8b5e3c") : undefined }}
              >
                <span>{i + 1}. {label}</span>
                {sections[i] ? <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-none" title={t("projectMd.hasContent")} /> : <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: "#d6d3d1" }} />}
              </button>
            ))}
          </div>

          {/* toolbar */}
          <div className="px-4 py-2 flex items-center gap-2 border-b flex-none" style={{ borderColor: tk.borderLight || "#e7e5e4" }}>
            <span className="text-sm font-bold flex-1 truncate">📄 {activeIdx + 1}. {tabLabels[activeIdx]}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">{t("projectMd.coWrite")}</span>
            {dirty && <span className="text-[10px] text-amber-600">{t("projectMd.unsaved")}</span>}
            <button
              onClick={() => { setSectionText(activeIdx, sections[activeIdx]); setDirtySet(prev => { const n = new Set(prev); n.delete(activeIdx); return n; }); }}
              disabled={!dirty || saving}
              className="text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-30"
              style={{ borderColor: tk.borderLight || "#e7e5e4", color: "#78716c" }}
            >{t("projectMd.revert")}</button>
            <button
              onClick={aiWriteSection}
              disabled={writing || saving || dirty}
              className="text-xs px-2.5 py-1 rounded-lg text-white disabled:opacity-40 font-medium"
              style={{ backgroundColor: tk.accent || "#8b5e3c" }}
              title={t("projectMd.aiWriteTitle")}
            >{writing ? `⏳ ${t("projectMd.aiWriting")}` : `✍️ ${t("projectMd.aiWriteBtn")}`}</button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="text-xs px-3 py-1 rounded-lg text-white disabled:opacity-40 font-medium"
              style={{ backgroundColor: tk.accent || "#8b5e3c" }}
            >{saving ? "…" : t("projectMd.save")}</button>
            <button
              onClick={() => setShowChat(v => !v)}
              className="text-xs px-2 py-1 rounded-lg border transition-colors"
              style={{ borderColor: tk.borderLight || "#e7e5e4", color: tk.accent || "#8b5e3c" }}
              title={t("projectMd.chatToggle")}
            >💬</button>
          </div>

          {/* 編輯區 */}
          <div className="p-3 flex-1 min-h-0 flex flex-col">
            <textarea
              value={editings[activeIdx] || ""}
              onChange={(e) => setSectionText(activeIdx, e.target.value)}
              placeholder={t("projectMd.specPlaceholder")}
              className="w-full flex-1 text-sm rounded-lg border px-3 py-2 resize-none focus:outline-none focus:border-stone-400 bg-white leading-relaxed font-mono"
              style={{ borderColor: tk.borderLight || "#e7e5e4" }}
            />
            <p className="text-[10px] text-stone-400 mt-1.5">{t("projectMd.specHint")}</p>
          </div>
        </section>
      </div>

      {/* ── 右：林曉薇 side chat（Product Spec 架構師，一節一節討論）── */}
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
              { label: t("projectMd.sugg1Label"), prompt: `${t("projectMd.sugg1Prompt")}「${activeIdx + 1}. ${tabLabels[activeIdx]}」` },
              { label: t("projectMd.sugg2Label"), prompt: t("projectMd.sugg2Prompt") },
              { label: t("projectMd.sugg3Label"), prompt: `${t("projectMd.sugg3Prompt")}「${activeIdx + 1}. ${tabLabels[activeIdx]}」` },
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
