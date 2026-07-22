# Skill AI Generate 輸出規則

## Output Format — 必須使用 @@@ 源碼格式

AI generate 產出的是 **skill-source.md**（源碼），不是最終的 SKILL.md（artifact）。

源碼使用 `@@@section@@@` 分隔，讓 UI 表單可以解析每個欄位：

### 必須包含的 @@@ 欄位

```
@@@purpose@@@      — Skill 的目的（必填）
@@@steps@@@        — 執行步驟（必填，含 Tool Access / Execution Steps / Business Rules / Error Handling）
@@@output@@@       — 輸出格式（必填，含 JSON schema + 輸出模式）
@@@guardrails@@@    — 安全限制（必填）
@@@validation@@@   — 驗證規則（必填）
@@@examples@@@     — 範例（可選，可留空）
@@@notes@@@        — 備註（可選，可留空）
```

### frontmatter 必須包含

- id, name, description, category, tags
- userInputs — 每個必須有: id, label, description, placeholder, required, type, multiline
- **每個 Skill 都要有 output_path 欄位**

### ❌ 不要用 ## 標題格式

以下是 artifact 格式（Build 之後的產物），AI generate 不要輸出這個：
```
## Purpose          ← ❌ 不要
## Deterministic Script  ← ❌ 不要
```

### ✅ 用 @@@ 格式

```
@@@purpose@@@       ← ✅ 正確
@@@steps@@@         ← ✅ 正確
```

## 其他規則

- 只輸出 skill-source.md 內容，不加任何解釋
- 不加 markdown code fence 包住整份文件
- 不使用任何工具，直接輸出文字
- 語言：繁體中文，技術術語保留英文
