# Skill Test 規則

## 測試邏輯

用剛 build 好的 SKILL.md + 使用者輸入，直接跑一次，看能不能正常產出。

能跑 → 可以發佈。
不能跑 → 回報錯誤。

## Prompt 組裝

```
請使用剛 build 好的 Skill（data/skills/building/{skill-id}/package/SKILL.md）執行以下使用者輸入，驗證 Skill 是否能正常產出結果。

## User Input
{使用者填的測試值}

照 SKILL.md 的 Output Contract 輸出到指定目錄。如果正常產出，代表可以發佈。
```

就這樣。不需要拆解 Purpose、Steps、Guardrails 等，直接讓 CLI 讀 SKILL.md 執行。
