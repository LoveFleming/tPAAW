# Tool Builder 使用指南

## 什麼是 Tool Builder？

Tool Builder 讓你建立自訂 API Tool，註冊到 PAAW 的 Tool Registry 之後，AI 在聊天視窗就能呼叫。

核心流程：

> 定義 Tool → 註冊到 Registry → AI 聊天時自動看到 → LLM 呼叫 → Server 發 HTTP 請求

---

## 三步建立 Tool

### Step 1：選擇服務

從模板列表選一個預設服務，或直接新增空白 Tool。

### Step 2：設定 Tool

#### 基本資料

| 欄位 | 說明 | 範例 |
|------|------|------|
| Tool ID | 唯一識別碼，小寫英文數字 | `notify` |
| Tool 名稱 | 顯示名稱 | `notify_send` |
| 描述 | Tool 做什麼（AI 會看這個決定要不要用） | `發送通知訊息` |
| 圖示 | Emoji | 📢 |

#### API 設定（runner = api）

| 欄位 | 說明 | 範例 |
|------|------|------|
| Method | HTTP 方法 | `POST` |
| URL | API 端點，可用 `{{參數名}}` | `https://api.example.com/notify` |

**Headers** — Key-Value 編輯器：

| Key | Value | 說明 |
|-----|-------|------|
| Content-Type | application/json | 固定 |
| Authorization | `Bearer {{…api_key}}` | `…` 開頭代表從 config 讀 |

**Body（JSON）**：

```json
{
  "id": "{{@nanoid}}",
  "message": "{{message}}"
}
```

> Body 裡如果需要唯一 ID，用 `{{@nanoid}}` 讓 Server 自動產生，不用 AI 傳。

#### 參數定義

定義 LLM 可以傳什麼參數。格式是 JSON Schema。

> ⚠️ **唯一 ID 不要放在參數裡！** 在 Body 裡用 `{{@nanoid}}` 讓 Server 自動產。參數只放 AI 需要決定的業務資料（像訊息內容）。

```json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "要發送的訊息內容"
    }
  },
  "required": ["message"]
}
```

- `properties` — 每個參數的 `type`（string / number / boolean）和 `description`
- `required` — 必填參數列表

#### Config 設定（API Key 等）

放敏感資訊（API Key、Token），不會暴露給 LLM：

```json
{
  "api_key": {
    "type": "string",
    "secret": true,
    "required": true,
    "description": "Notify API Key"
  }
}
```

### Step 3：完成

建立後到「管理 Tools」頁面填入 Config 值（API Key 等）。

---

## 模板替換規則

Server 收到 LLM 的呼叫後，會替換 URL / Headers / Body 裡的模板：

### 參數引用

| 模板 | 來源 | 範例 |
|------|------|------|
| `{{參數名}}` | LLM 傳入的參數 | `{{message}}` → `你好！` |
| `{{…configKey}}` 或 `{{...configKey}}` | 從 config.json 讀取 | `{{…api_key}}` → `sk-xxxxx` |

### 內建產生器

| 模板 | 來源 | 範例 |
|------|------|------|
| `{{@nanoid}}` | Server 自動產生 21 字元隨機 ID | `V1StGXR8_Z5jdHi6B-myT` |
| `{{@nanoid:10}}` | Server 產生自訂長度的隨機 ID | `IRFa-VaR2` |
| `{{@uuid}}` | Server 產生 UUID v4 | `3b241101-e2bb-4...` |
| `{{@timestamp}}` | Server 產生毫秒 timestamp | `1721805600000` |
| `{{@isodate}}` | Server 產生 ISO 日期 | `2026-07-24T08:30:00.000Z` |

替換是遞迴的，Body 裡巢狀物件的字串值也會被替換。每次呼叫都會重新產生新的值。

---

## 完整範例：notify_send（payload 自帶 nanoid）

### Tool Builder 填法

**基本資料：**
- Tool ID：`notify`
- Tool 名稱：`notify_send`
- 描述：`發送通知訊息`
- 圖示：📢

**API 設定：**
- Method：POST
- URL：`https://api.example.com/notify`
- Headers：
  - `Content-Type` → `application/json`
  - `Authorization` → `Bearer {{…api_key}}`
- Body：
  ```json
  {
    "id": "{{@nanoid}}",
    "message": "{{message}}"
  }
  ```

**參數定義（只有 AI 需要決定的內容）：**
```json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "要發送的訊息內容"
    }
  },
  "required": ["message"]
}
```

**Config 設定：**
```json
{
  "api_key": {
    "type": "string",
    "secret": true,
    "required": true,
    "description": "Notify API Key"
  }
}
```

### 呼叫流程

1. LLM 決定呼叫 `notify_send`
2. LLM 傳入參數：`{ message: "你好！" }`
3. Server 替換模板：
   - URL：`https://api.example.com/notify`
   - Header：`Authorization: Bearer ***`（從 config 讀）
   - Body：`{"id": "V1StGXR8_Z5jdHi6B-myT", "message": "你好！"}`
     - `{{@nanoid}}` → Server 自動產生隨機 ID
     - `{{message}}` → LLM 傳入的訊息
4. Server 發出 HTTP POST
5. API 端收到已帶 ID 的完整 payload

### 對應的 tool.json 檔案

建立後 PAAW 會在 `data/tools/notify/` 產生：

```json
{
  "name": "notify_send",
  "description": "發送通知訊息",
  "parameters": {
    "type": "object",
    "properties": {
      "message": { "type": "string", "description": "要發送的訊息內容" }
    },
    "required": ["message"]
  },
  "runner": "api",
  "api": {
    "method": "POST",
    "url": "https://api.example.com/notify",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer {{…api_key}}"
    },
    "body": {
      "id": "{{@nanoid}}",
      "message": "{{message}}"
    }
  },
  "enabled": true
}
```

### ❌ 反例：不要把 ID 放在參數裡讓 AI 傳

```json
{
  "properties": {
    "nanoid": { "type": "string", "description": "用戶的 Nano ID" },
    "message": { "type": "string", "description": "訊息" }
  }
}
```

這樣 AI 會被要求傳 nanoid，但 AI 不會產生可靠的唯一 ID。

✅ **正確做法**：在 Body 裡用 `{{@nanoid}}`，Server 自動產生：
```json
{
  "body": {
    "id": "{{@nanoid}}",
    "message": "{{message}}"
  }
}
```

---

## 現有範例：discord_send

PAAW 內建的 Discord Tool：

```json
{
  "name": "discord_send",
  "description": "發送 Discord 訊息到指定頻道",
  "parameters": {
    "type": "object",
    "properties": {
      "channel": { "type": "string", "description": "頻道 ID" },
      "message": { "type": "string", "description": "訊息內容" }
    },
    "required": ["channel", "message"]
  },
  "runner": "api",
  "api": {
    "method": "POST",
    "url": "https://discord.com/api/v10/channels/{{channel}}/messages",
    "headers": {
      "Authorization": "***",
      "Content-Type": "application/json"
    },
    "body": {
      "content": "{{message}}"
    }
  }
}
```

> discord_send 的 `channel` 是已知值（AI 從上下文查到），所以放在參數裡合理。

---

## 內建產生器詳解

### `{{@nanoid}}` / `{{@nanoid:N}}`

產生 URL-safe 隨機 ID，適合當 record 的唯一識別。

- 預設長度 21 字元，碰撞機率極低
- 可自訂長度：`{{@nanoid:10}}` 產生 10 字元
- **每次呼叫都會產生新的 ID**

### `{{@uuid}}`

產生 UUID v4（標準格式 `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`）。

### `{{@timestamp}}`

產生毫秒級 timestamp（如 `1721805600000`），適合當時間戳記。

### `{{@isodate}}`

產生 ISO 8601 日期字串（如 `2026-07-24T08:30:00.000Z`），適合當 createdAt 欄位。

---

## 管理功能

在「管理 Tools」頁面可以：

- ⚙️ 設定 Config 值（API Key 等）
- 🧪 測試 Tool（輸入參數，看回傳結果）
- ⏸️/▶️ 啟用/停用 Tool
- 🗑️ 刪除 Tool

---

## 注意事項

- **參數名不要用保留字**：避免用 `__proto__`、`constructor` 等
- **Config 值加密儲存**：`secret: true` 的欄位在 config.json 裡會遮蔽顯示
- **URL 中的 `{{參數}}`**：適合用在 path parameter，如 `/users/{{userId}}`
- **Body 中的 `{{參數}}`**：適合用在 request body 的值
- **API 回傳格式**：Server 會嘗試 parse JSON，失敗就當純文字回傳
- **唯一 ID 用 `{{@nanoid}}`**：不要讓 LLM 生 ID，在 Body 裡用內建產生器最可靠
