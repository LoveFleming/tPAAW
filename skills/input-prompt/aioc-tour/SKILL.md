---
id: aioc-tour
name: AIOC 導覽
version: 1.0.0
description: 互動式導覽，帶領操作員認識 AIOC 的概念、架構、操作流程與核心價值
category: tutorial
suggestedRoles:
  - Factory Assistant
  - Factory Guide
tags:
  - aioc
  - onboarding
  - tutorial
userInputs:
  - id: visitor_background
    label: 你的背景
    description: 幫助調整導覽的深淺和比喻方式
    placeholder: 例：我是後端工程師 / 我是 PM，第一次用 AI 工具 / 隨便聊聊
    required: false
    type: text
    group: 🎯 導覽偏好
  - id: tour_focus
    label: 特別想了解
    description: 有特別想知道的部分嗎？不填就從頭開始
    placeholder: 例：Skills 怎麼用 / 怎麼建團隊 / 全部都聽
    required: false
    type: text
    group: 🎯 導覽偏好
useSkills: []
---

# AIOC 導覽

## 目的
讓新操作員在 15 分鐘內理解 AIOC 是什麼、怎麼用、為什麼 Skills 是最重要的資產。

## 觸發時機
- 操作員第一次使用 AIOC
- 操作員想了解 AIOC 的整體概念
- 工廠特助判斷操作員需要基礎認識

## 執行步驟

互動式導覽，每次介紹一站，等操作員回應後再繼續。

### 第 1 站：AIOC 是什麼
用一句話開場：
> 「AIOC 是你的 AI 作戰中心。你在這裡管理 AI 團隊、累積工作技能、指派任務。」

解說重點：
- AIOC = AI-Native Operation Center
- 不是另一個 AI 聊天工具，是一套**讓人跟 AI 協作的作業模式**
- 核心理念：你累積的 Skills 才是資產，AI 只是執行者

### 第 2 站：四個核心概念
1. **Factory（工廠）** → 獨立的工作空間，各有各的制度和團隊
2. **Crew（員工）** → AI 團隊成員，有角色、名字、專長
3. **Skill（技能）** → 把「怎麼讓 AI 做好一件事」的方法論寫下來
4. **Working Base（工作目錄）** → AI CLI 實際動手改 code 的地方

### 第 3 站：工作流程
```
開 AIOC → 選工廠 → 選 Working Base → 選員工 → 選技能（或純對話）→ AI 開始工作
```

### 第 4 站：Skills 為什麼是最重要的資產
> 「寫 code 的 AI 滿街都是，但你的 Skills 別人沒有。」

Skill 生命週期：
1. 發現反覆出現的工程問題
2. 找到好的解法
3. 寫成結構化的 Skill
4. 指派給對應的 AI 員工
5. 每次使用持續優化
6. 跨工廠、跨專案重用

### 第 5 站：目錄結構
```
aioc/
├── core/        ← Dashboard 主程式
├── factories/   ← 各工廠（員工、文件）
├── skills/      ← 共享技能池
└── providers/   ← CLI 設定
```

### 第 6 站：下一步
根據操作員情況推薦：
- 第一次用？→ 用「建立工廠制度」技能
- 想試試看？→ 找一個員工純對話
- 有具體需求？→ 推薦合適的員工和技能
- 想建 Skill？→ 找小春（AI Skill Creator）

## 產出
操作員理解 AIOC 核心概念，知道下一步要做什麼。

## Guardrails
- 不要一次倒太多資訊，讓操作員消化
- 看人調整深淺（工程師講技術、管理者講價值）
- 繁體中文回答，技術術語保留英文

## 品質檢查
- 操作員能用自己的話說出 Skills 為什麼重要
- 操作員知道下一步要做什麼
