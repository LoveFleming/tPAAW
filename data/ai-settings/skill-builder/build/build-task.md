# Skill Build 轉換任務

## 你的任務

你會收到一份 skill-source.md（使用 @@@section@@@ 分隔的 UI 編輯格式），你的任務是將它轉換為完整的、可執行的 package/SKILL.md（標準 markdown section 格式）。

## 轉換規則

- @@@purpose@@@ → ## Purpose
- @@@steps@@@ → ## Deterministic Script（含 ### Tool Access, ### Execution Steps, ### Business Rules）
- @@@output@@@ → ## Output Contract（必須包含 JSON schema 和輸出模式）
- @@@error_handling@@@ → 併入 ### Error Handling
- @@@guardrails@@@ → ## Guardrails
- @@@validation@@@ → ## Validation
- frontmatter 保留不動
- 必須符合 data/skills/physical-skill/skill-creator/SKILL.md 的標準格式

## 輸入

下面的 skill-source.md（@@@ 格式）是你這次要轉換的內容。
