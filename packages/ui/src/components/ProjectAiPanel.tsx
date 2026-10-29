/**
 * ProjectAiPanel — 內嵌於 Project App 的 AI 對話面板
 *
 * 2026-10-09 Fleming：UI 統一 — 直接用 AgentSideChat（side chat 全站共用元件）。
 * model selector / 📋 歷史 / 🧠 prompt 檢視 / 💬 新對話 / 🖼️📄 上傳 /
 * thinking + tool badges / 停止鈕 — 全部跟 coding app side chat 一致。
 * Transport：/api/paaw/chat（contextTarget="project"，server context-engine 注入專案脈絡）。
 */

import { useRef, useEffect } from "react";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";
import { useI18n } from "../i18n";

interface Props {
  /** Context seed: what the AI should know about */
  context: string;
  /** Initial prompt when panel opens（預填輸入框，不自動送出） */
  initialPrompt?: string;
  /** Theme tokens from parent */
  tk: any;
  onClose: () => void;
}

export default function ProjectAiPanel({ context, initialPrompt, tk, onClose }: Props) {
  const { t } = useI18n();
  const chatRef = useRef<AgentSideChatHandle>(null);

  useEffect(() => {
    if (initialPrompt) chatRef.current?.setText(initialPrompt);
  }, [initialPrompt]);

  return (
    <AgentSideChat
      ref={chatRef}
      agentId="project-ai"
      agentName="AI 專案助理"
      agentEmoji="🤖"
      greeting="問我任何關於專案的問題 — 我熟悉這個專案的脈絡"
      cwd="@paaw"
      persistCrewId="project-ai"
      modelFeature="project-ai"
      paawChat={{ contextTarget: "project", contextSeed: context }}
      height="100%"
      accent={tk?.accent || "#2563eb"}
      placeholder="問我任何關於專案的問題…"
      suggestions={[
        { label: "🏗️ 建專案", prompt: t("projectAi.newProjectPrompt") },
        { label: "📊 分析專案", prompt: t("projectAi.analyzePrompt") },
        { label: "⚠️ 找風險", prompt: t("projectAi.delayPrompt") },
      ]}
      onClose={onClose}
    />
  );
}
