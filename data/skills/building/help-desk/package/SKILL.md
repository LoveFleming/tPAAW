---
id: help-desk
name: PAAW Help Desk
description: 回答有關 PAAW 的所有問題，涵蓋架構、Skill 系統、Workspace、API、CLI 等主題，透過消化 knowledge 與 source code 提供準確解答
category: knowledge
tags:
  - help
  - qa
  - paaw
  - knowledge
  - support
userInputs:
  - id: question
    label: 你的問題
    description: 你想了解的 PAAW 相關問題，例如架構、Skill 撰寫、Workspace 操作、API 用法等
    placeholder: 例如：PAAW 的 Skill 系統是怎麼運作的？
    required: true
    type: text
    multiline: true
  - id: depth
    label: 回答深度
    description: 控制回答的詳細程度
    placeholder: summary | standard | deep-dive
    required: false
    type: text
    multiline: false
  - id: include_source
    label: 是否引用來源
    description: 是否在回答中標註資料來源檔案，方便使用者自行查閱
    placeholder: true | false
    required: false
    type: text
    multiline: false
---

## Purpose

協助使用者解答任何與 PAAW 相關的問題。此 Skill 會主動搜尋 `knowledge` workspace 下 `about-paaw` 目錄中的所有文件，必要時深入 source code，以提供準確、有依據的回答。無論是概念理解、操作指引、架構解析或疑難排解，都能給出清晰且可執行的答案。

## Inputs

### question（必填）
你想了解的 PAAW 相關問題。可以是：
- 概念性問題（例：「什麼是 Skill？」）
- 操作性問題（例：「怎麼建立一個新的 Skill？」）
- 架構性問題（例：「PAAW 的 Workspace 機制是什麼？」）
- 疑難排解（例：「為什麼我的 Skill 執行失敗？」）

### depth（選填，預設 `standard`）
- `summary` — 簡短摘要，1-3 句話回答
- `standard` — 標準回答，包含說明與基本範例
- `deep-dive` — 深入解析，包含完整脈絡、source code 引用與進階用法

### include_source（選填，預設 `true`）
設為 `true` 時，回答末尾會附上參考的知識庫檔案路徑，方便使用者自行深入查閱。

## Deterministic Script

### Tool Access

- `file_list({ workspace: "knowledge" })` — 列出 knowledge workspace 的根目錄
- `file_list({ workspace: "knowledge", path: "about-paaw" })` — 列出 about-paaw 下的所有檔案
- `file_read({ workspace: "knowledge", path: "<file>" })` — 讀取 knowledge workspace 中的指定檔案
- `file_list({ workspace: "<user-workspace>" })` — 列出使用者 workspace 目錄
- `file_read({ workspace: "<user-workspace>", path: "<file>" })` — 讀取使用者 workspace 中的 source code

### Execution Steps

#### 步驟一：問題分類與關鍵字萃取

1. 解析使用者輸入的 `question`
2. 將問題分類為以下其中一種：
   - `concept` — 概念解釋（例：什麼是 X）
   - `how-to` — 操作指引（例：怎麼做 X）
   - `architecture` — 架構/設計（例：X 是怎麼設計的）
   - `troubleshooting` — 疑難排解（例：X 壞了怎麼辦）
3. 從問題中萃取 3-5 個搜尋關鍵字（英文與中文皆提取）

#### 步驟二：知識庫掃描

1. 執行 `file_list({ workspace: "knowledge" })` 取得根目錄結構
2. 執行 `file_list({ workspace: "knowledge", path: "about-paaw" })` 列出所有可用文件
3. 根據步驟一萃取的關鍵字，篩選出最相關的檔案（優先順序：檔名匹配 > 目錄匹配）
4. 逐一讀取相關檔案：`file_read({ workspace: "knowledge", path: "<matched-file>" })`
5. 若 `about-paaw` 下的文件不足以回答問題，往 knowledge 根目錄及其他子目錄擴大搜尋

#### 步驟三：Source Code 查閱（視需要）

1. 若知識庫文件無法完整回答問題，且問題涉及：
   - 內部實作細節
   - 具體 API 行為
   - 資料結構或格式定義
   - 執行流程或生命週期
2. 則掃描使用者 workspace 下的 source code 目錄
3. 使用關鍵字定位相關程式碼檔案並讀取
4. 從 source code 中提取答案，並轉化為使用者友善的說明

#### 步驟四：整合與撰寫回答

1. 根據 `depth` 參數決定回答的詳細程度：
   - `summary`：1-3 句話直接回答
   - `standard`：結構化回答，包含：
     - 直接回答
     - 補充說明（1-2 段）
     - 具體範例或操作步驟
   - `deep-dive`：完整解析，包含：
     - 背景與脈絡
     - 詳細技術說明
     - source code 引用（如適用）
     - 進階用法或注意事項
     - 相關延伸主題
2. 以繁體中文撰寫，技術術語保留英文
3. 若 `include_source` 為 `true`，在回答末尾附上：
   ```
   📚 參考來源：
   - knowledge/about-paaw/<file-name>
   - <workspace>/<source-file>（如適用）
   ```

#### 步驟五：品質檢查

1. 確認回答是否直接回應了使用者的問題
2. 確認所有技術術語的使用是否正確
3. 確認沒有編造不存在的事實（若有不確定之處，明確標示）
4. 若問題超出 PAAW 範圍，禮貌告知並引導至正確資源

### Business Rules

1. **知識庫優先**：所有回答必須優先基於 `knowledge/about-paaw` 下的文件，source code 僅作為補充
2. **誠實原則**：若知識庫與 source code 都找不到答案，必須明確告知「目前知識庫中沒有相關資訊」，不得編造內容
3. **語言一致性**：回答使用繁體中文，但 PAAW 的專有名詞（Skill、Workspace、CLI、SKILL.md 等）保留原文
4. **範圍限定**：只回答與 PAAW 直接相關的問題；若使用者問了不相關的問題，引導其回到 PAAW 主題
5. **時效性標註**：若 source code 中的行為可能與文件描述不一致，以 source code 為準並標註差異
6. **最小權限**：僅讀取回答問題所需的檔案，不無差別讀取所有檔案

### Error Handling

#### 情境一：knowledge workspace 為空或無法存取

- **偵測條件**：`file_list({ workspace: "knowledge" })` 回傳空結果或錯誤
- **處理方式**：
  1. 嘗試直接掃描使用者 workspace 下的 source code
  2. 若 source code 可用，基於 source code 回答並標註「此回答基於 source code，可能不如文件完整」
  3. 若 source code 也不可用，回覆：「目前無法存取知識庫與 source code，請確認 workspace 設定是否正確。」

#### 情境二：問題超出 PAAW 範圍或知識庫無涵蓋

- **偵測條件**：搜尋所有相關文件後，找不到與問題相關的內容
- **處理方式**：
  1. 明確告知使用者：「目前知識庫中沒有涵蓋這個主題。」
  2. 嘗試提供最接近的相關資訊作為參考
  3. 建議使用者可以查看的檔案或目錄
  4. 若問題完全與 PAAW 無關，禮貌說明此 Help Desk 僅回答 PAAW 相關問題

#### 情境三：使用者問題模糊或有多種解讀

- **偵測條件**：問題缺乏具體性，可能有兩種以上合理的解讀
- **處理方式**：
  1. 列出可能的解讀方向
  2. 針對最可能的解讀提供初步回答
  3. 邀請使用者進一步釐清問題

## Guardrails

1. **只可讀取**：此 Skill 僅進行檔案讀取與回答，不得寫入、修改或刪除任何檔案
2. **不執行程式碼**：不執行任何 source code，僅進行靜態閱讀與分析
3. **不洩露敏感資訊**：若 source code 中包含 API keys、密碼或其他敏感資訊，回答中不得包含這些內容
4. **回答長度上限**：`summary` 模式不超過 500 字；`standard` 模式不超過 2000 字；`deep-dive` 模式不超過 5000 字
5. **不得編造**：所有回答中的具體數據、行為描述、API 定義都必須有文件或 source code 作為依據
6. **單次回答範圍**：一次回答聚焦於一個主題；若使用者問題包含多個獨立子問題，逐一回答但提示可拆分提問以獲得更深入的回答

## Output Contract

**輸出模式：display**

此 Skill 為即時問答用途，回答直接顯示給使用者，不需要存檔。

```json
{
  "mode": "display",
  "format": "markdown",
  "schema": {
    "type": "object",
    "properties": {
      "category": {
        "type": "string",
        "description": "問題分類：concept | how-to | architecture | troubleshooting"
      },
      "answer": {
        "type": "string",
        "description": "回答本文，markdown 格式，根據 depth 決定詳細程度"
      },
      "sources": {
        "type": "array",
        "items": { "type": "string" },
        "description": "參考的檔案路徑列表（include_source 為 true 時提供）"
      },
      "confidence": {
        "type": "string",
        "enum": ["high", "medium", "low"],
        "description": "回答信心程度；high = 知識庫有明確記載，medium = 基於推斷或多份文件綜合，low = 主要基於 source code 推測"
      },
      "follow_up": {
        "type": "array",
        "items": { "type": "string" },
        "description": "建議的後續問題，幫助使用者深入探索"
      }
    },
    "required": ["category", "answer", "confidence"]
  },
  "example": {
    "category": "concept",
    "answer": "## Skill 是什麼？\n\nSkill 是 PAAW 中的可重複執行任務單元。每個 Skill 由一份 `SKILL.md` 定義，包含 Purpose、Inputs、Execution Steps、Output Contract 等 section。使用者只需提供 inputs，AI 就會按照 Skill 定義的步驟執行並產出結果。\n\n### 核心概念\n\n- **宣告式定義**：你定義「做什麼」和「輸出什麼」，由 AI runtime 負責「怎麼做」\n- **可組合**：Skill 可以呼叫其他 Skill\n- **可分享**：Skill 以純文字（markdown）形式存在，易於版本控管與分享\n\n### 範例\n\n一個翻譯 Skill 的結構：\n\n1. 使用者輸入要翻譯的文字\n2. Skill 指示 AI 翻譯成目標語言\n3. 結構化輸出翻譯結果",
    "sources": [
      "knowledge/about-paaw/skill-system.md",
      "knowledge/about-paaw/architecture.md"
    ],
    "confidence": "high",
    "follow_up": [
      "怎麼建立一個新的 Skill？",
      "Skill 的 Deterministic Script 是什麼？",
      "Skill 可以使用哪些工具？"
    ]
  }
}
```

## Validation

1. **問題非空**：`question` 不得為空字串或純空白
2. **depth 值合法**：若有提供 `depth`，必須是 `summary`、`standard` 或 `deep-dive` 之一；不合法值使用預設 `standard`
3. **include_source 值合法**：若有提供，必須是 `true` 或 `false`；不合法值使用預設 `true`
4. **回答必須包含**：`category`、`answer`、`confidence` 三個必填欄位
5. **confidence 校驗**：若 `confidence` 為 `low`，回答中必須包含免責聲明，說明此答案基於推測，建議查閱原始文件確認
6. **sources 校驗**：若 `include_source` 為 `true`，`sources` 不得為空陣列（除非知識庫完全沒有相關內容，此時須在 answer 中說明）
7. **回答長度校驗**：按 Guardrails 定義的長度上限檢查；若超出，自動精簡並在末尾附註「此為精簡版回答，可使用 deep-dive 模式獲取完整內容」