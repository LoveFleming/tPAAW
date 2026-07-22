# Skill AI Generate 輸出規則

## Output Format — 必須使用 @@@ 源碼格式

AI generate 產出的是 **skill-source.md**（源碼），不是最終的 SKILL.md（artifact）。

### 必須包含的 @@@ 欄位

```
@@@purpose@@@       — Skill 的目的（必填）
@@@steps@@@        — 執行步驟（必填，含 Tool Access / Execution Steps / Business Rules / Error Handling）
@@@output@@@       — 輸出格式（必填，含 JSON schema + 輸出模式）
@@@guardrails@@@   — 安全限制（必填）
@@@validation@@@   — 驗證規則（必填）
@@@examples@@@     — 執行範例（選填，可留空）
@@@build_log@@@    — 建構紀錄（選填，AI Generate 填初始版本即可）
```

### ❌ 已移除的欄位

- `@@@error_handling@@@` — 已併入 `@@@steps@@@` 的 `### Error Handling` 子標題
- `@@@notes@@@` — 已改為 `@@@build_log@@@`（有明確用途：記錄建構過程）

### ❌ 不要用 ## 標題格式

```
## Purpose          ← ❌ 這是 artifact 格式，AI generate 不要用
## Deterministic Script  ← ❌ 同上
```

### ✅ 用 @@@ 格式

```
@@@purpose@@@       ← ✅ 正確
@@@steps@@@         ← ✅ 正確（Error Handling 在裡面的 ### 子標題）
@@@build_log@@@     ← ✅ 取代舊的 @@@notes@@@
```

## 其他規則

- 只輸出 skill-source.md 內容，不加任何解釋
- 不加 markdown code fence
- 不使用任何工具，直接輸出文字
- 語言：繁體中文，技術術語保留英文
