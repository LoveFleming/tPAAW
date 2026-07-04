# Skill AI Generate 輸出規則

## Output Rules

- 輸出必須是完整的 SKILL.md 檔案內容，包含 YAML frontmatter 和 markdown body
- frontmatter 必須包含: id, name, version, description, category, tags, userInputs
- 每個 userInput 必須有: id, label, description, placeholder, required, type, multiline
- body 必須使用標準 markdown section 標題（不用 @@@ 格式）：
  - `## Purpose` — 這個 Skill 做什麼
  - `## Inputs` — 輸入欄位說明
  - `## Deterministic Script`
    - `### Tool Access` — 可用工具
    - `### Execution Steps` — 執行步驟（要有編號、具體可執行）
    - `### Business Rules` — 業務規則
    - `### Error Handling` — 錯誤處理（至少 2 種情境）
  - `## Guardrails` — 安全限制
  - `## Output Contract` — 輸出格式（含 JSON schema 範例）
  - `## Validation` — 驗證規則
- 每個 section 都要寫實際內容，不要留空
- 語言：繁體中文，技術術語保留英文
- id 用英文 kebab-case
- Output Contract 必須包含「輸出模式：file | display | both」
- 只輸出 SKILL.md 內容，不加任何解釋或 markdown code fence
- 不要使用任何工具，直接輸出文字

## 參考模板

請參考 `data/skills/physical-skill/skill-creator/SKILL.md` 的 Output Format section 作為格式標準。
