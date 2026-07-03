# Project Overview

> 驗證：`cd /Users/steward/App/tAgent && cat package.json | head -5`

## 解決什麼問題

PAAW (Personal AI Assistant Workspace) 解決的核心問題：

> **不會寫程式的人也能用 AI 打造自己的工具，並在聊天/App 視窗使用這些工具。**

傳統 AI 助手只能對話，PAAW 讓使用者透過對話或 Builder 介面建立可重複使用的 Skill、App、Workflow，這些產出物自動成為聊天中的 Tool，形成能力飛輪：

> 人用 AI 做工具 → AI 幫你記資料 → AI 放大你記的資料

## 主要使用者

- **非技術使用者**：透過聊天或 App Builder 建立/使用工具
- **軟體工程師**：透過 Skill Builder / Coding IDE 建立進階工具
- **AI Agent**：作為執行引擎，呼叫 Skill/App 完成任務

## 核心功能

1. **Chat Assistant** — 所有 App/Tool 在聊天視窗都可用的 AI 助手
2. **Skill Builder** — 技能建構器，最小能力單元（4 種 runner）
3. **App Builder** — 應用建構器，資料驅動或 Skill-based
4. **Workflow Builder** — 工作流建構器，多步驟自動化
5. **Cron Jobs** — 排程任務
6. **Knowledge / Files** — 知識與檔案管理
7. **Coding IDE** — 內建終端機 + AI Agent Loop
8. **Context Engine** — 統一的 context 組裝系統

> 驗證 Context Engine 有 12 個 target：`grep -n 'case "' packages/server/src/context-engine.mjs`

## 系統邊界

### PAAW 負責
- Skill/App/Workflow 的定義、執行、CRUD
- AI 聊天（串流 + Tool-calling ReAct loop）
- Context 組裝（多層 context 注入）
- 檔案管理、使用者設定、排程與自動化

### PAAW 不負責
- LLM 模型訓練（只呼叫外部 API）
- 使用者認證/登入系統（目前無 auth）
- 多租戶隔離（單人使用設計）
- 大規模分散式部署（單機 SQLite + 檔案系統）
- 外部服務的直接整合（透過 API runner 代理）

## 系統邊界證據

- 無 auth：`grep -c "auth\|login\|session" packages/server/src/paaw-server.mjs` → 0
- CORS 全開：`grep "Access-Control-Allow-Origin" packages/server/src/paaw-server.mjs` → `*`
- 單人設計：DB tables 有 user_id 欄位但全部寫死同一個 user
