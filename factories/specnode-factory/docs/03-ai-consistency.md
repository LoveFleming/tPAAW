# 如何讓 AI 有一致性的產出？

核心觀念：
**不要只靠 Prompt，要用 Skill + Tool + Guardrail 讓 AI 受控工作。**

## 做法

### 1. 固定任務範圍
明確定義 AI 可以做什麼、不能做什麼。

### 2. 固定輸入與輸出格式
讓每次產出都有相同結構。

### 3. 提供 Rules / Docs / Samples
把標準、範例、注意事項放進 Skill。

### 4. 關鍵計算交給工具
例如 Python、JaCoCo、API、DB 查詢，避免 AI 自己猜。

### 5. 加入 Guardrails
限制高風險行為，例如不可編造資料、不可修改 source code、失敗要停止。

### 6. 定義驗收標準
明確定義什麼叫 PASS / WARN / FAIL。

---

> **一句話：**
> Prompt 讓 AI 回答一次；Skill 讓 AI 依照規則、工具與 Guardrails 穩定做事。
