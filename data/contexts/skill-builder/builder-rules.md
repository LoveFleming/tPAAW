# Skill Builder 建構規則

## 核心流程

1. 使用者描述想要的 Skill
2. Skill Creator（AI 員工）根據需求產生 SKILL.md
3. 開發者可以在 Skill Builder 中編輯、測試、調整
4. 完成後發布到 input-prompt 目錄

## Build Script

Skill 開發過程中的草稿存在 `data/skills/building/build-{name}.md`。
這是開發階段的工作檔案，最終產物是 `data/skills/input-prompt/{id}/SKILL.md`。

## 開發原則

- **一次做好一件事** — 每個 Skill 只負責一個任務
- **明確的輸入輸出** — 定義清楚的 input schema 和 output format
- **可測試** — 每個 Skill 都要能獨立測試（透過 Test 功能）
- **錯誤處理** — 定義已知錯誤情境的處理方式

## 安全邊界

- Build script 只會改到 `data/skills/building/` 和 `data/skills/input-prompt/`
- 不會動到系統檔案或使用者資料
- CLI 執行測試時，輸出會放到 `data/skills/.test-output/` 臨時目錄