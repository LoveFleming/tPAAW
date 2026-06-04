# AIOC vs OpenClaw — 架構對比分析

> 兩套系統有相似的味道，但定位和格局不同。這份文件幫助理解兩者的關係、差異、以及互補的可能。

---

## 一句話定位

| | AIOC | OpenClaw |
|---|---|---|
| **本質** | AI 工廠 orchestration platform | AI agent 運行框架 |
| **比喻** | 工業園區的管理中心 | 一個全能的私人管家 |
| **核心價值** | 組織多個 AI agent 協作，累積可重用的 Skills | 讓一個 AI agent 擁有記憶、工具、排程，成為長期夥伴 |

---

## 架構層級對比

| 層級 | AIOC | OpenClaw |
|---|---|---|
| **多 Agent 協作** | Crew（工廠裡的角色分工） | Subagent（spawn 獨立子 session） |
| **Agent 身份** | 每個 Crew Member 有名字、角色、性格 | 單一 main agent，subagent 無獨立身份 |
| **多 Model 路由** | 不同 crew member 可以用不同 model | 不同 session 可以用不同 model |
| **技能系統** | Skills（input-prompt + physical-skill + training） | Skills（SKILL.md） |
| **技能生命週期** | 訓練 → 測試 → 鍛造 → 打包 → 部署 | 手動撰寫 SKILL.md |
| **記憶/上下文** | Training files + Factory docs（制度文件） | MEMORY.md + memory/（每日筆記 + 長期記憶） |
| **工具調用** | 外接 CLI tools（Qwen / Claude / OpenCode） | 內建工具（exec、read/write、web、cron） |
| **終端機整合** | Skill Lab terminal（UI 內嵌 PTY） | 內建 PTY（exec + process） |
| **排程** | （尚未實作） | cron jobs（提醒、定期任務、背景工作） |
| **持久記憶** | （依賴 docs 和 training files） | MEMORY.md 跨 session 持久化 |
| **通知/觸發** | Dashboard 內互動 | Discord / Signal / Telegram / Webhook |
| **執行環境** | 本地 dev server（Vite + Express） | Gateway 常駐進程 + 沙箱 |

---

## 核心差異

### 1. 開放性 vs 封閉性

**AIOC 是開放的 orchestration 層**
- 不綁定特定 AI engine
- Qwen Code、Claude Code、OpenCode 可以互換
- 未來可以接入任何新的 AI CLI
- Skills 是標準化的 Markdown，任何 agent 都能讀

**OpenClaw 是封閉的 agent 框架**
- Agent 只能是 OpenClaw 自己
- 工具和行為由框架定義
- 優點是整合度高、體驗一致
- 缺點是擴充性受限於框架升級

### 2. 組織模式

**AIOC — 工廠模式**
```
Factory（工廠）
├── Crews（員工）→ 多人分工
├── Skills（技能）→ 共享技能池
├── Docs（制度）→ 憲法、規範
└── Working Base（產線）→ 實際專案目錄
```

**OpenClaw — 單 Agent 模式**
```
Agent（管家）
├── Tools（工具箱）→ exec、web、cron
├── Memory（記憶）→ MEMORY.md + memory/
├── Skills（技能）→ SKILL.md
└── Sessions（對話）→ main + subagents
```

### 3. 技能管理

| | AIOC | OpenClaw |
|---|---|---|
| **技能類型** | input-prompt（純指令）、physical-skill（有檔案）、training（訓練用） | 單一 SKILL.md |
| **建立流程** | Skill Lab：訓練 Prompt → 測試 → 鍛造 → 打包 | 手動寫或由 agent 生成 |
| **跨專案重用** | 全域 Skills Pool，所有工廠共享 | 限於 agent 的 workspace |
| **版本管理** | version 欄位 + Git | 依賴 Git |

### 4. 記憶與學習

| | AIOC | OpenClaw |
|---|---|---|
| **短期記憶** | CLI session 內的對話 | Session 對話歷史 |
| **長期記憶** | Factory docs、Training files | MEMORY.md（curated wisdom） |
| **每日紀錄** | （無） | memory/YYYY-MM-DD.md |
| **主動學習** | 透過 Training files 訓練 | Heartbeat 時自動回顧記憶 |
| **跨 session 延續** | 依賴 docs 傳遞 | 自動讀取記憶檔案 |

---

## 互補的地圖

AIOC 和 OpenClaw 不是競爭關係，而是可以互補：

```
OpenClaw（管家層）
├── 日常溝通、提醒、排程
├── 跨系統整合（Discord、Email、Calendar）
├── 持久記憶和上下文延續
└── 可以觸發 AIOC 的任務

AIOC（工廠層）
├── 結構化的 AI 協作流程
├── Skills 的鍛造、累積、重用
├── 多 Agent（Qwen/Claude/OpenCode）彈性調度
└── 輸出結果給 OpenClaw 彙整
```

**具體整合場景：**
- OpenClaw cron 觸發 → 呼叫 AIOC API → 啟動工廠任務
- AIOC Skill 產出 → OpenClaw 讀取結果 → 通知人類
- OpenClaw 當入口 → 自然語言 → 路由到 AIOC 對應的 Crew
- AIOC 的 Skills Pool 成為 OpenClaw agent 可引用的知識庫

---

## AIOC 可以從 OpenClaw 借鏡的功能

| 功能 | 說明 | 實作難度 |
|---|---|---|
| **持久記憶** | `memory/` + `MEMORY.md` 機制，跨 session 記住重要決策 | ⭐ 低 |
| **Cron 排程** | 定時觸發 skill 或 crew 任務 | ⭐⭐ 中 |
| **Subagent 平行處理** | 多 crew member 平行執行 + 結果彙整 | ⭐⭐ 中 |
| **事件驅動** | Webhook 觸發 skill、檔案變動觸發 agent | ⭐⭐ 中 |
| **Heartbeat 主動巡檢** | 定期自動檢查狀態、整理記憶、主動通知 | ⭐ 低 |

---

## 總結

| 維度 | AIOC 贏 | OpenClaw 贏 |
|---|---|---|
| **多 Agent 調度** | ✅ 多引擎、多角色 | 單 agent + 臨時 subagent |
| **技能管理** | ✅ 完整生命週期 | 基礎 SKILL.md |
| **開放性** | ✅ 可插任何 AI engine | 封閉框架 |
| **記憶延續** | 依賴文件 | ✅ 自動記憶管理 |
| **整合能力** | Dashboard 內 | ✅ 多平台通知、排程、webhook |
| **個人化** | 工廠級 | ✅ Agent 級（更深） |
| **上手門檻** | 需要設定工廠 | ✅ 開箱即用 |

**結論：** AIOC 是「調度中心」，OpenClaw 是「全能管家」。兩者互補大於競爭。AIOC 的格局更大（orchestration），OpenClaw 的體驗更深（personal agent）。最好的架構是讓它們協作 — OpenClaw 當入口和記憶層，AIOC 當執行和 Skills 層。

---

*最後更新：2026-05-31*
