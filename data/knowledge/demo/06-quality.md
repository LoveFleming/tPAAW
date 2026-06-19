# 高品質：一致性的祕密

## 品質問題的根因 = 不一致

每個人寫法不同 → 結果不同 → 品質浮動

## PAAW 怎麼確保一致性

### 📐 固定格式的 Skill 定義

```
Purpose → Inputs → Script → Guardrails → Output → Validation
```

AI 在**框架內**寫，不是亂寫

### 🛡️ 三層品質保障

| 層級 | 機制 | 效果 |
|------|------|------|
| 預防 | Guardrails | 防呆，不讓錯誤發生 |
| 驗證 | Output Contract | 輸出格式不對就擋下 |
| 回饋 | 知識飛輪 | 越用越準，越用越穩 |

### 品質數據化

- Output Contract → 可自動驗證，不用人工 review
- Validation → 每次執行都檢查
- Skill 版本控 → 改壞了可回滾
