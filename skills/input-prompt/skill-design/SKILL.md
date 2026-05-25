---
id: skill-design
name: Skill Design
version: 1.0.0
description: 使用 skill-creator 方法論設計新的 AI 技能，從需求到完整的 SKILL.md
userInputs:
  - id: skill_creation_prompts
    label: Skill Creation Prompts
    description: 描述你想建立的技能，包含目的、使用場景、期望行為
    placeholder: "例：我需要一個技能來掃描 Java 專案的目錄結構，自動識別模組邊界，產出 release unit 清單。目標使用者是 QA，要在 CI pipeline 裡自動跑。"
    required: true
    type: textarea
    multiline: true
    rows: 10
---

你正在使用 skill-creator 方法論來設計 AI 技能。請遵循以下流程：

參考檔案：skills/skill-creator/SKILL.md（完整的技能設計指南）

設計步驟：
1. 了解需求 — 蒐集具體使用範例，確認技能觸發場景
2. 規劃內容 — 決定需要哪些 scripts、references、assets
3. 初始化 — 使用 scripts/init_skill.py 建立技能目錄結構
4. 編寫 SKILL.md — 撰寫 frontmatter（name, description）和 body
5. 打包驗證 — 使用 scripts/package_skill.py 驗證並打包
6. 迭代優化 — 根據實際使用結果持續改善

關鍵原則：
- 簡潔優先：只放 Codex 不知道的資訊
- 漸進式揭露：metadata → SKILL.md body → bundled resources
- 適當的自由度：脆弱操作用 script，靈活任務用文字指引
- 先讀 skills/skill-creator/SKILL.md 取得完整設計指南