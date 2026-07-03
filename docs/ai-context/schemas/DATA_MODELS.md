# Contract / Schema / Data Model

> 每個 schema 的驗證：直接看程式碼或執行 grep

---

## App (data/apps/{id}/app.json)

**Schema 定義位置：** `packages/shared/src/schemas/index.ts` — `AppDefinition`

| 欄位 | 型別 | 必填 | 意義 | 驗證 |
|---|---|---|---|---|
| id | string | ✅ | 唯一識別 | `grep "id.*Type.String" packages/shared/src/schemas/index.ts` |
| name | string | ✅ | 顯示名稱 | 同上 |
| description | string | ✅ | 描述 | 同上 |
| version | string | | 版本 (default "1.0.0") | 同上 |
| type | "data" / "skill-based" | | App 類型 | 實際由 app.json 設定 |
| dataShape | "array" / "object" / "none" | | 資料形態 | `grep "dataShape" packages/server/src/tools/index.mjs \| head -5` |
| schema | JSON Schema object | | 資料結構定義 | `grep "schema.*properties" packages/shared/src/schemas/index.ts` |
| triggers | string[] | | 觸發關鍵字 | `grep "triggers" packages/server/src/tools/index.mjs` |
| skills | AppSkillRef[] | | 組成的 Skills | `grep "AppSkillRef" packages/shared/src/schemas/index.ts` |
| icon | string | | 圖示 | — |
| status | string | | 發布狀態 | — |

**ID 格式驗證：** `grep "a-z0-9_" packages/server/src/routes/apps.mjs` → `^[a-z][a-z0-9_]*$`

**資料生命週期：**
1. 建立：POST /api/apps → 建立 app.json + 初始 app-data
2. 使用：Chat 中 tool calling / 直接 app-data CRUD
3. 修改：PATCH /api/apps/:id
4. 資料 CRUD：GET/PUT /api/app-data/:appId

**實例驗證：** `cat data/apps/pocket/app.json | python3 -m json.tool`

---

## Skill (SKILL.md format)

**格式：** Frontmatter (YAML-like) + Markdown body

```markdown
---
id: skill-id
name: Skill Name
runner: prompt|data|api|script
---

Body with {{placeholders}}
```

**Schema 定義位置：** `packages/shared/src/schemas/index.ts` — `SkillDefinition`

| 欄位 | 型別 | 必填 | 意義 |
|---|---|---|---|
| id | string | ✅ | 唯一識別 |
| name | string | ✅ | 顯示名稱 |
| description | string | ✅ | 描述 |
| input | object | ✅ | 輸入欄位 |
| output | object | ✅ | 輸出欄位 |
| execution | SkillExecutionConfig | ✅ | 執行設定 |
| samples | SkillSample[] | | 範例 |
| access | object | | 存取控制 |

> 驗證：`grep -n "SkillDefinition\|SkillInputField\|SkillExecutionConfig" packages/shared/src/schemas/index.ts`

**Frontmatter 解析：** `packages/server/src/context-engine.mjs: parseSkillFrontmatter()`

> 驗證：`grep -n "parseSkillFrontmatter" packages/server/src/context-engine.mjs`

---

## Chat Session (data/chats/{id}.json)

| 欄位 | 型別 | 必填 | 意義 |
|---|---|---|---|
| id | string | ✅ | 對話 ID |
| title | string | | 標題 |
| messages | Message[] | ✅ | 訊息列表 |
| createdAt | ISO string | | 建立時間 |
| updatedAt | ISO string | | 更新時間 |

> 驗證：`cat data/chats/$(ls data/chats/ \| head -1)` — 看一個實例

---

## Crew (data/crews/{id}.json)

| 欄位 | 型別 | 必填 | 意義 |
|---|---|---|---|
| id | string | ✅ | 員工 ID |
| name | string | ✅ | 名稱 |
| rolePrompt | string | | 角色提示詞 |
| avatar | string | | 頭像 |
| skills | string[] | | 可用 Skills |

> 驗證：`cat data/crews/00-ai.factory-assistant.json | python3 -m json.tool | head -20`

---

## Provider Config (data/config/providers.json)

| 欄位 | 型別 | 必填 | 意義 |
|---|---|---|---|
| active | string | ✅ | 目前 provider ID |
| defaultModel | string | ✅ | 預設模型 |
| providers | Record<string, ProviderDef> | ✅ | Provider 定義 |

每個 ProviderDef：
| 欄位 | 型別 | 意義 |
|---|---|---|
| name | string | 顯示名稱 |
| baseURL | string | API base URL |
| apiKey | string | API 金鑰（⚠️ 明文） |
| models | {id, name}[] | 可用模型列表 |

> ⚠️ **安全風險：** API key 明文存 JSON。.gitignore 已排除 data/ 但仍需注意。
> 驗證：`cat data/config/providers.json | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'  {k}: key={\"***\" if v.get(\"apiKey\") else \"MISSING\"}') for k,v in d['providers'].items()]"`

---

## DB Tables (SQLite, 9 張表)

**Migration 位置：** `packages/db/src/migrate.ts`
**Type 定義位置：** `packages/db/src/types.ts`

| 表名 | 用途 | 主要欄位 |
|---|---|---|
| runs | Skill 執行記錄 | id, skill_id, status, runner_type, input_json, output_json |
| conversations | 對話 session | id, user_id, type, status, message_count |
| chat_messages | 對話訊息 | id, conversation_id, role, content, intent |
| data_store | Data runner 資料 | id, model_id, data_json, deleted_at |
| cron_logs | 排程日誌 | id, cron_job_id, status, error_message |
| memory | 多層記憶 | id, layer (profile/interaction/working/knowledge), content, embedding |
| api_keys | App API 金鑰 | id, app_id, key_hash, key_prefix, permissions |
| daily_summaries | 每日摘要 | id, user_id, date, summary, mood |
| skill_meta | Skill 統計 | skill_id, total_runs, success_rate, avg_duration_ms |

> 驗證表數量：`grep "CREATE TABLE" packages/db/src/migrate.ts | wc -l` → 9
> 驗證表名稱：`grep "CREATE TABLE IF NOT EXISTS" packages/db/src/migrate.ts | sed 's/.*EXISTS /  - /'`

**重要注意：** 所有 JSON 欄位（input_json, output_json, tags_json 等）存的是 JSON string，不是原生 JSON。讀取時需 `JSON.parse()`。

> 驗證：`grep "_json" packages/db/src/types.ts | head -10`
