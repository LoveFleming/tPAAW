# Skill Test 規則

## 測試邏輯

Build 產出的 artifact（package/SKILL.md）就像剛 compile 完的程式 — 需要實際跑一次才知道能不能用。

用 artifact + 使用者輸入，直接跑一次，看輸出是否符合需求。

能跑 → 可以發佈。
不能跑 → 回報問題，使用者調整 skill-source.md 後重新 Build。

## 迭代流程

```
Build → Test → 通過？ → Yes → Publish
                 │
                 No → 調整 skill-source.md → 重新 Build → 重新 Test
```

## Prompt 組裝

```
請使用剛 build 好的 Skill（{{PAAW_ROOT}}/data/skills/building/{skill-id}/package/SKILL.md）執行以下使用者輸入，驗證 Skill 是否能正常產出結果。

## User Input
{使用者填的測試值}

照 SKILL.md 的 Output Contract 輸出到指定目錄。如果正常產出，代表可以發佈。
```

就這樣。不需要拆解 Purpose、Steps、Guardrails 等，直接讓 AI runtime 讀 SKILL.md 執行。
