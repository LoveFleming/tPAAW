# Skill Build 任務

## 你的任務

你會收到一份 skill-source.md（使用 @@@section@@@ 分隔的源碼格式），你的任務是將它**編譯**成完整的、可執行的 package/SKILL.md（Skill Artifact）。

**這不是照抄！** 你是 compiler，不是 copy-paste 工具。

## 編譯 ≠ 照抄

源碼是使用者用自然語言寫的粗略指令，**可能不完整、可能有邏輯缺口**。你的工作是：

1. **理解意圖** — 使用者想達成什麼效果？
2. **補齊細節** — 源碼只說「生成食譜」，你要推斷出完整的執行流程
3. **修正邏輯** — 步驟順序不對？修正。缺少錯誤處理？補上。
4. **產出可執行 artifact** — AI runtime 讀到 SKILL.md 就能直接跑

### 照抄 ❌ vs 編譯 ✅

源碼 `@@@steps@@@` 可能只寫「1. 根據食材生成食譜 2. 輸出結果」→ 你要展開成完整的 Tool Access + Execution Steps + Business Rules + Error Handling。

## 格式對照

| skill-source.md（源碼） | SKILL.md（artifact） | 編譯做的事 |
|---|---|---|
| `@@@purpose@@@` | `## Purpose` | 格式轉換 |
| — | `## Inputs` | **新增** — 從 frontmatter userInputs 整理成文字說明 |
| `@@@steps@@@` | `## Deterministic Script` | **擴充** — 補齊 Tool Access / Execution Steps / Business Rules / Error Handling |
| `@@@output@@@` | `## Output Contract` | 源碼的 → 編譯成 JSON schema 格式 |
| `@@@guardrails@@@` | `## Guardrails` | 源碼的 → 編譯，可能補強 |
| `@@@validation@@@` | `## Validation` | 源碼的 → 編譯，可能補強 |
| `@@@examples@@@` | （併入 Execution Steps） | 範例輔助理解，不單獨成 section |
| `@@@build_log@@@` | **更新 build_log** | **重要！** Build 完成後，在源碼的 build_log 加一筆紀錄 |

## build_log — 建構紀錄

每次 Build 都要在源碼的 `@@@build_log@@@` 追加一筆紀錄，格式：

```markdown
## v2 — 2026-07-22 (AI Build)
- 補齊：Error Handling（源碼未指定，compiler 推斷需要）
- 新增：Tool Access（/api/workspace/write）
- 調整：steps 從抽象描述改為具體 SOP
- 微調：Output Contract 加入 JSON schema
```

這確保人跟 AI 的建構過程不會遺漏。

## 編譯重點

1. **Inputs section 必須新增** — 從 frontmatter 的 userInputs 整理出文字說明
2. **Execution Steps 必須具體** — 每一步都要能讓 AI runtime 直接執行，像 SOP
3. **Tool Access 必須明確** — 列出這個 Skill 需要什麼 API / 工具
4. **Error Handling 至少 2 種情境** — 源碼的 steps 裡可能沒寫，你要推斷
5. **Output Contract 必須有 JSON schema** — 源碼可能只描述大概，你要定義清楚
6. **Examples 和 Notes 不單獨成 section** — 有用的內容併入對應 section

## 輸入

下面的 skill-source.md（源碼）是你這次要編譯的內容。
