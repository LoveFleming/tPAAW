# Skill Build 任務

## 你的任務

你會收到一份 skill-source.md（使用 @@@section@@@ 分隔的源碼格式），你的任務是將它**編譯**成完整的、可執行的 package/SKILL.md（Skill Artifact）。

這不是機械式的格式轉換 — 你要理解源碼的意圖，推斷合理的執行邏輯，補齊細節，產出可以讓 AI runtime 直接執行的 artifact。

## 編譯規則

- @@@purpose@@@ → `## Purpose`
- @@@steps@@@ → `## Deterministic Script`（含 `### Tool Access`, `### Execution Steps`, `### Business Rules`）
- @@@output@@@ → `## Output Contract`（必須包含 JSON schema 和輸出模式）
- @@@error_handling@@@ → 併入 `### Error Handling`
- @@@guardrails@@@ → `## Guardrails`
- @@@validation@@@ → `## Validation`
- frontmatter 保留不動
- 必須符合 `data/skills/physical-skill/skill-creator/SKILL.md` 的標準格式

## 輸入

下面的 skill-source.md（源碼）是你這次要編譯的內容。
