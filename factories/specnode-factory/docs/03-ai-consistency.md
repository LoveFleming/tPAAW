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

## 成熟 Skill 的六個組成要素

訓練 Skill 時，不只是訓練 prompt。成熟的 Skill 應該同時包含：

1. **Instructions**：AI 要怎麼做事
2. **Rules**：AI 不能做什麼
3. **Samples**：正確輸出的範例
4. **Tools**：Python / API / DB / JaCoCo / parser
5. **Validation**：怎麼檢查結果對不對
6. **Guardrails**：什麼情況要停止、警告、拒絕或交給人

這表示不是只做 prompt engineering，而是在做 **Skill Engineering / AI Workflow Engineering**。

## Python Script 為什麼是 AI 落地的關鍵

Python script / deterministic tools 是 AI 落地的關鍵部分。
因為它們可以把資料取得、計算、比對、validation、guardrail 從「AI 自己說有檢查」變成「程式真的有檢查」。

> **AI 負責理解與產出，Python 負責證明與把關。**

### 實例：Coverage Report Skill

AI 不自己猜 coverage。它訓練時就準備好：

- `build_runner.py`：執行 Maven / Gradle
- `jacoco_parser.py`：解析 JaCoCo XML
- `node_mapper.py`：把 API spec 裡的 nodes 對到 class
- `coverage_validator.py`：檢查 covered + missed = total
- `markdown_reporter.py`：輸出固定格式 markdown

這些 script 就是落地的關鍵，因為它們讓結果比較 deterministic。

### 邊界提醒

Python script 讓關鍵步驟可重現、可測試、可驗證，所以比單靠 AI 穩定很多。
但 script 本身也要測試，也要版本管理，也要被 review。

---

> **一句話：**
> Skill 決定 AI 怎麼工作；Python tool 決定結果怎麼被驗證。
>
> AI 落地不能只靠 prompt；要讓 AI 產出工具，讓工具執行關鍵邏輯、驗證結果、形成 guardrail。
