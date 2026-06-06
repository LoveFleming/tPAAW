---
id: factory-constitution
name: 建立工廠制度
version: 1.0.0
description: 協助制定工廠的憲法、標準規範、Error Code Rules 與團隊規則
category: setup
suggestedRoles:
  - Factory Assistant
tags:
  - constitution
  - standards
  - error-code
  - setup
userInputs:
  - id: constitution_type
    label: 要建什麼制度
    description: 想先建立哪種制度？
    placeholder: 例：全部都建 / 先寫憲法 / Error Code Rules
    required: true
    type: text
    group: 📋 制度類型
  - id: factory_background
    label: 工廠背景
    description: 這個工廠做什麼產品？團隊多大？有什麼特別的狀況？
    placeholder: 例：這是一個 Java API 服務工廠，3 人團隊，做金融微服務...
    required: false
    type: textarea
    multiline: true
    group: 📎 背景
useSkills: []
---

# 建立工廠制度

## 目的
幫新工廠建立完整的制度體系，讓 AI 員工有明確的規範可以遵循。

## 觸發時機
- 新建工廠後，第一次設定制度
- 工廠缺少憲法或標準規範
- 操作員想要建立或更新 Error Code Rules

## 執行步驟

### 1. 蒐集工廠背景
先問清楚：
- 做什麼產品？什麼語言/框架？
- 團隊多大？有哪些角色？
- 有沒有既有的規範或習慣？

### 2. 依需求制定制度

**工廠憲法 (Constitution)**
- 核心價值是什麼
- AI 員工的行為準則
- 協作基本原則
- 安全邊界 (Guardrails)

**標準規範 (Standards)**
- 程式碼風格標準
- 命名慣例
- 檔案結構規範
- Git Commit 規範

**Error Code Rules**
- 錯誤碼格式定義
- 分類體系：BIZ_（業務）/ SYS_（系統）/ EXT_（外部）/ ORCH_（編排）
- 錯誤處理標準流程
- 範例與模板

**團隊規範**
- AI 員工角色分工
- 技能命名與分類原則
- 文件維護規則

### 3. 產出文件
產出 markdown 文件，存入工廠的 `docs/` 目錄。

## 產出
- `docs/constitution.md` — 工廠憲法
- `docs/standards.md` — 標準規範
- 可直接使用的完整制度文件

## Guardrails
- 不要一次倒出模板，先問清楚背景再量身打造
- 好的制度是從實際需求長出來的，不是抄來的
- 制度要具體可執行，不要寫空話

## 品質檢查
- AI 員工讀了制度後知道怎麼做事
- Error Code 格式一致、無衝突
- 操作員認同制度內容
