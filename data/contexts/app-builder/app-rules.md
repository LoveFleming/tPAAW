# PAAW — Personal AI Assistant Workspace — App Builder 規則

> 此文件是 AI 建構 App 的統一規範。
> 透過 API 可讀取和修改：`GET/PUT /api/tagent/app-rules`
> 聊天系統、App Builder、CLI 都遵循這份規則。

---

## 一、核心理念

**一句話：build your personal AI workforce**

- 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 能力飛輪
- 不會寫程式的人也能用 AI 打造自己的工具，並在聊天/App 視窗使用
- 每個 App 都自動產生 Tool，不需要手動寫 integration code

---

## 二、App 類型

### 1. 資料型 App（Data App）
- `dataShape: "array"` 或 `"object"`
- 自動產生 CRUD tools：`{appId}_add, _list, _get, _update, _delete`
- 適合：待辦事項、筆記、記憶、追蹤器
- 資料存在 `data/app-data/{appId}.json`

### 2. 技能型 App（Skill-based App）
- `type: "skill-based"` + `dataShape: "array"`（存執行歷史）
- 自動產生 `{appId}_exec` tool（Skill + CLI 執行）
- 需要定義 `triggers`（觸發關鍵字）和 `schema`（輸入參數）
- Skill 定義在 `data/apps/{appId}/skills/*/SKILL.md`
- 每次執行後自動存結果到 app-data（統一歷史）
- 適合：翻譯器、摘要器、分析器、任何 AI 執行任務

### 3. 混合型 App
- 同時有 `type: "skill-based"` + `dataShape: "array"`
- 有 `{appId}_exec`（Skill 執行）+ CRUD tools（資料管理）
- 適合：翻譯器（執行翻譯 + 保留歷史 + 管理詞彙庫）

---

## 三、Skill 定義格式（SKILL.md）

每個 Skill 是最小的能力單元，像 source code，但有固定格式：

```markdown
# Skill

## Purpose
這個 Skill 做什麼（一句話）

## Inputs
- input_name: type — 說明

## Deterministic Script

### Tool Access
這個 Skill 需要什麼工具

### Execution Steps
1. 步驟一
2. 步驟二
3. ...

### Business Rules
- 規則一
- 規則二

### Error Handling
- 錯誤情境 → 處理方式

## Guardrails
- 安全限制
- 品質限制

## Output Contract
輸出的 JSON 結構定義

## Validation
如何驗證輸出正確
```

---

## 四、App 定義 Schema（app.json）

```json
{
  "id": "lowercase_english_id",
  "name": "App 顯示名稱",
  "icon": "🌐",
  "description": "一句話描述",
  "status": "published | draft",
  "type": "skill-based | data",
  "dataShape": "array | object | none",
  "triggers": ["觸發關鍵字1", "keyword2"],
  "schema": {
    "type": "object",
    "properties": {
      "field_name": {
        "type": "string | number | boolean",
        "description": "欄位說明",
        "required": true | false,
        "default": "預設值"
      }
    }
  },
  "aiPrompt": "AI 操作此 App 的簡短提示",
  "version": "1.0.0",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

---

## 五、建構規則

### 當使用者說「我要做一個 XX app」時：

1. **分析需求** — 使用者想要什麼功能？是資料管理還是 AI 執行？
2. **決定 App 類型**：
   - 需要執行 AI 任務 → `type: "skill-based"`
   - 只需要存取資料 → `type: "data"`
   - 兩者都要 → 混合型
3. **定義 Schema** — 輸入/輸出的欄位結構
4. **設定 Triggers** — 使用者在聊天中會說什麼來觸發這個 app？
5. **建立 SKILL.md** — 如果是 skill-based，寫 deterministic script
6. **建立 app.html** — App 視窗的 UI（可選，AI 可以幫忙生成）
7. **發布** — `status: "published"` 即可在聊天中使用

### 自動產生的能力：
- ✅ 聊天 Tool（AI 可呼叫）
- ✅ 觸發關鍵字路由（說一句話就觸發）
- ✅ 資料儲存 → AI 可讀取產生洞見
- ✅ App 視窗 UI（如果有 app.html）
- ✅ Import/Export 分享（`/api/tagent/apps/:id/export`）

---

## 六、Import/Export 格式

### Export（`GET /api/tagent/apps/:id/export`）
回傳一個 JSON bundle，包含 app 的所有檔案：

```json
{
  "manifest": "tagent-app-v1",
  "exportedAt": "ISO-8601",
  "app": { ...app.json 內容... },
  "skills": {
    "skill-name": "... SKILL.md 內容 ..."
  },
  "html": "... app.html 內容（可選）...",
  "data": [ ... app-data 內容（可選）... ]
}
```

### Import（`POST /api/tagent/apps/import`）
接收同一個 JSON bundle，自動建立：
- `data/apps/{id}.json` — App 定義
- `data/apps/{id}/skills/*/SKILL.md` — Skill 定義
- `data/apps/{id}/app.html` — App UI
- `data/app-data/{id}.json` — 初始資料

---

## 七、安全邊界

**CLI 只能改目標 App 的檔案，不能動其他目錄的資料。**

- ✅ 只能寫入 `data/apps/{appId}/` 目錄（app.html、SKILL.md 等）
- ✅ 只能寫入 `data/apps/{appId}.json`（app 定義）
- ❌ **禁止修改** `data/app-data/`（那是使用者資料）
- ❌ **禁止修改** `data/chats/`（那是聊天記錄）
- ❌ **禁止修改** `data/config/`（那是系統設定）
- ❌ **禁止修改** `packages/`（那是程式碼）
- ❌ **禁止修改** `core/`（那是程式碼）

一句話：**只改 app 本身的 code，不要碰別的 app 或系統檔。**

---

## 八、品質守門

每個新建的 App 都應該：
1. 有清楚的 `description`
2. Schema 完整（required 欄位標示清楚）
3. 如果是 skill-based，至少有一個 SKILL.md
4. triggers 至少 2 個關鍵字（一個中文、一個英文）
5. aiPrompt 簡潔明確（AI 知道何時該用）

---

*此文件由 Fleming 定義，作為 PAAW 的統一規範。*
*更新日期：2026-06-07*
