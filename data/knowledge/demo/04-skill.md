# PAAW 三層能力架構

## 1️⃣ Skill — 最小能力單元

不是隨機的 LLM 對話，是**有框架的 deterministic script**：

- **Purpose** — 明確定義做什麼
- **Inputs** — 型別安全的輸入
- **Deterministic Script** — 固定執行步驟
- **Guardrails** — 防呆機制
- **Output Contract** — 保證輸出格式
- **Validation** — 自動驗證結果

**同樣 input → 永遠同樣 output**

## 2️⃣ App Builder — 說一句話就建好

從想法到上線，不需要寫部署腳本：
- 描述需求 → AI 生成 Skill + App
- 自動註冊為 Chat Tool
- 聊天視窗和 App 視窗都能用

## 3️⃣ 知識飛輪 — 越用越強

App 產生資料 → AI 讀取分析 → 產生洞見 → 改進 Skill

---

@file: /Users/steward/App/tAgent/data/knowledge/demo/sample-skill.md
