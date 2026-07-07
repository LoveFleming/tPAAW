# A2A SDK × TaskStore — 關係總覽

> **Version:** 1.0.0
> **Last Updated:** 2026-07-07
> **Scope:** PAAW + Agent Orchestrator

---

## 一句話

> **A2A SDK 管狀態「怎麼流」（狀態機 + 通訊），TaskStore 管狀態「存哪」（persistence）。SDK 不綁定存儲方式，你插什麼 store 進去，它就用什麼。**

---

## 📐 架構全景

```
┌─────────────────────────────────────────────────────────┐
│                    外部客戶端                             │
│         (Agent Orchestrator / 其他 Agent)                 │
└──────────────────────────┬──────────────────────────────┘
                           │ JSON-RPC 2.0 over HTTP
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  @a2a-js/sdk                             │
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │ Agent        │  │ ClientFactory │  │ Express      │ │
│  │ Executor     │  │ (A2A Client)  │  │ Adapter      │ │
│  │ (狀態機)     │  │ (發請求)       │  │ (JSON-RPC)   │ │
│  └──────┬───────┘  └───────────────┘  └──────────────┘ │
│         │                                                │
│         │ 每次 state 變化                                │
│         │ → taskStore.save(task)                         │
│         ▼                                                │
│  ┌──────────────────────────────────────────┐           │
│  │        TaskStore Interface                │           │
│  │  save(task) / load(taskId)                │           │
│  │  ← SDK 只要求這兩個方法                    │           │
│  └─────────────────────┬────────────────────┘           │
│                        │                                 │
└────────────────────────┼────────────────────────────────┘
                         │ 你決定怎麼實作
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  你的 TaskStore 實作                      │
│                                                          │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ InMemoryTaskStore│ │ JsonFileStore│  │ SqliteStore│ │
│  │ (SDK 內建)       │  │ (我們寫的)    │  │ (未來)     │ │
│  │ 重啟就消失        │  │ JSON 檔案     │  │ 持久 DB   │ │
│  └─────────────────┘  └──────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 🧩 SDK 做什麼 vs 你做什麼

| 角色 | 誰做 | 做什麼 |
|---|---|---|
| **Task 狀態機** | SDK (`AgentExecutor`) | `submitted → working → completed / failed / input-required` |
| **TaskStore 合約** | SDK (`ITaskStore`) | 定義 `save(task)` + `load(taskId)` 兩個方法 |
| **狀態存哪** | **你決定** | SDK 不管你用記憶體、JSON 檔、SQLite、Redis |
| **通訊協議** | SDK | JSON-RPC 2.0、SSE streaming、webhook push notification |
| **Agent Card** | SDK | `/.well-known/agent.json` 能力發現 |
| **業務邏輯** | 你 | HelpDesk、Agent Loop、tools、Skill |

---

## 🔄 A2A SDK 管理的 Task 狀態機

```
                    message/send
                        │
                        ▼
                 ┌─────────────┐
                 │  submitted  │
                 └──────┬──────┘
                        │ AgentExecutor 開始處理
                        ▼
                 ┌─────────────┐
                 │   working   │  ←──── SDK 呼叫 taskStore.save()
                 └──────┬──────┘      每次狀態變化都存
                        │
           ┌────────────┼────────────┐
           │            │            │
           ▼            ▼            ▼
    ┌────────────┐ ┌──────────┐ ┌───────────┐
    │ completed  │ │  failed  │ │  input-   │
    └────────────┘ └──────────┘ │ required  │
                                └───────────┘
```

**SDK 的 `AgentExecutor` 在每次狀態變化時呼叫 `taskStore.save(task)`：**

```
使用者發 message/send
  ↓
AgentExecutor 收到 → 建立新 Task (state: submitted)
  → taskStore.save(task)        ← SDK 呼叫你的 store
  ↓
開始處理 → state: working
  → taskStore.save(task)        ← SDK 呼叫你的 store
  ↓
Agent Loop 跑完 → state: completed
  → taskStore.save(task)        ← SDK 呼叫你的 store
```

---

## 📦 SDK 提供的東西

```
@a2a-js/sdk (npm 套件)
├── Task 狀態機
│   ├── AgentExecutor      ← 執行引擎，管理 task 生命週期
│   └── 5 個狀態: submitted | working | input-required | completed | failed
│
├── TaskStore Interface
│   ├── ITaskStore          ← 合約：只要 save + load
│   └── InMemoryTaskStore   ← 預設實作（記憶體，重啟就消失）
│
├── 通訊層
│   ├── ClientFactory       ← A2A Client（主動呼叫遠端 Agent）
│   ├── Express Adapter     ← JSON-RPC 端點
│   ├── SSE Streaming       ← message/stream 即時串流
│   └── Webhook             ← push notification 非同步通知
│
└── Agent Card
    └── /.well-known/agent.json ← 能力宣告與發現
```

---

## 🔌 TaskStore Interface — 最小合約

SDK 只要求實作兩個方法：

```typescript
interface TaskStore {
  save(task: Task): Promise<void>;
  load(taskId: string): Promise<Task | undefined>;
}
```

就這樣。只要這兩個方法實作了，SDK 的狀態機就能正常運作。

---

## 🗂️ 我們的兩套實作

### 1. Agent Orchestrator（正式 implements SDK interface）

```typescript
// agent-orchestrator/src/json-file-task-store.ts

import type { TaskStore as ITaskStore } from "@a2a-js/sdk/server";

export class JsonFileTaskStore implements ITaskStore {
  // ✅ 正式 implements，TypeScript 型別檢查
  async save(task: Task): Promise<void> { ... }
  async load(taskId: string): Promise<Task | undefined> { ... }

  // 擴充方法（SDK 不要求，我們自己加的）
  async list(filter?) { ... }
  async delete(taskId) { ... }
  async appendEvent(taskId, event) { ... }
  async appendMemory(taskId, memory) { ... }
  async saveTokens(taskId, usage) { ... }
  async saveCheckpoint(taskId, data) { ... }
  async saveTrace(taskId, trace) { ... }
}
```

✅ TypeScript 型別安全，換實作不會拼錯方法名

### 2. PAAW Server（鴨子型別，無 formal implements）

```javascript
// tPAAW/packages/server/src/lib/task-persistence.mjs

export class JsonTaskPersistence {
  // ⚠️ 方法名跟 SDK 對得上，但沒有正式 implements
  async save(task) { ... }
  async load(taskId) { ... }
  // ...同樣的擴充方法
}
```

⚠️ 純 JS，沒有型別約束，拼錯方法名不會報錯

---

## 🔧 怎麼換 TaskStore

```typescript
// 方式一：用 SDK 內建的（記憶體，開發用）
const taskStore = new InMemoryTaskStore();

// 方式二：用我們的 JSON 檔案版（目前正式環境）
const taskStore = new JsonFileTaskStore("./data/a2a-tasks");

// 方式三：未來寫 SQLite 版
class SqliteTaskStore implements ITaskStore {
  async save(task: Task): Promise<void> { /* INSERT OR REPLACE */ }
  async load(taskId: string): Promise<Task | undefined> { /* SELECT */ }
}
const taskStore = new SqliteTaskStore("./data/tasks.db");

// 方式四：未來寫 Redis 版
class RedisTaskStore implements ITaskStore {
  async save(task: Task): Promise<void> { /* redis.set(task.id, ...) */ }
  async load(taskId: string): Promise<Task | undefined> { /* redis.get(taskId) */ }
}
const taskStore = new RedisTaskStore("redis://localhost:6379");
```

**不管換什麼，SDK 完全不用改。** 只要 `save` 和 `load` 實作對了，AgentExecutor 就能正常跑狀態機。

---

## 📁 相關檔案

```
agent-orchestrator/
└── src/
    ├── server.ts                    ← 用 JsonFileTaskStore
    └── json-file-task-store.ts      ← implements ITaskStore

tPAAW/
├── packages/server/src/
│   ├── routes/a2a.mjs               ← A2A 端點（自己寫的 JSON-RPC）
│   └── lib/task-persistence.mjs     ← JsonTaskPersistence（無 SDK interface）
├── data/a2a-tasks/                  ← JSON 檔案實際存放處
└── docs/
    ├── a2a-taskpersistence-agentloop-architecture.md  ← 三層完整架構
    └── a2a-sdk-taskstore-relationship.md              ← 本文件
```

---

## 📌 重點回顧

1. **A2A SDK = 通訊 + 狀態機** — JSON-RPC 協議、SSE streaming、webhook、Task 生命週期
2. **TaskStore = 持久化** — 狀態每次變化都存一次，重啟不丟
3. **SDK 只要求 `save` + `load`** — 其他都不管
4. **存哪你決定** — 記憶體、JSON、SQLite、Redis 都行
5. **Agent Orchestrator 正式 implements** — TypeScript 型別安全
6. **PAAW Server 用鴨子型別** — 能跑但沒有型別保護，建議未來統一

---

*Generated for Fleming — 2026-07-07*
