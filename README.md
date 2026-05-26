# AIOC — AI-Native Operation Center

**讓人跟 AI 協作更順暢的操作介面。**

AIOC 提供一個友善的 Dashboard，讓工程師用直覺的方式操作 AI — 管理對話、累積技能、切換專案。不管你用哪個 AI CLI，都能在這裡找到一致的操作體驗。

## 核心概念

- 🖥️ **友善操作介面** — Dashboard 讓你用圖形介面管理 AI 員工、技能和對話，不用背指令
- 🧠 **舒緩杏仁核** — 主題色系依心理學設計，幫助工程師在不同情緒狀態下保持專注
- 🤖 **自組 AI 團隊** — 自己定義 AI 成員的角色、技能和 personality，組建你的專屬 AI 團隊
- 🔧 **跨 CLI 支援** — Skills 只存一份，Qwen / Claude Code / OpenCode 都能用

## 目錄結構

```
aioc/
├── core/                   ← 主程式（Dashboard UI + API Server）
│   ├── src/                ← React + TypeScript frontend
│   ├── server/             ← Express API server
│   └── public/             ← 靜態資源
├── factories/              ← 各工廠定義
│   ├── default/            ← 預設模板
│   │   ├── crews/          ← 員工 JSON
│   │   └── docs/           ← 工廠文件
│   └── specnode-factory/   ← 範例工廠
│       ├── crews/
│       └── docs/
├── skills/                 ← 共享 AI 技能（所有工廠、所有 CLI 共用）
│   ├── cli-test/
│   ├── dashboard-setup/
│   ├── factory-tour/
│   └── java-unit-test/
└── providers/              ← 各 CLI 設定
    ├── qwen/
    ├── opencode/
    └── claude/
```

> Skills 只存一份在 `skills/`，所有工廠和 CLI 共用。員工可選 0~多個技能，也可以純 Prompt 模式。

## 快速開始

### 安裝 Dashboard

```bash
cd aioc/core
npm install
```

### 安裝 AI CLI 工具

AIOC 支援三種 AI coding CLI，安裝後即可從 Dashboard 直接啟動。

#### Qwen Code

```bash
npm install -g @qwen-code/qwen-code
qwen --version
```

#### Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

#### OpenCode

```bash
brew install opencode
opencode version
```

> 安裝完任何一個 CLI 後，Dashboard 會自動偵測。也可以三個都裝，在不同 Skill 切換使用。

### 啟動

```bash
npm run dev
```

Dashboard 會在 http://localhost:5173 啟動。

### 選擇 Project

啟動後會看到 Welcome 頁面，輸入你的 project 路徑（或點資料夾選擇器），即可進入 Dashboard。

## 主題色系 — 舒緩杏仁核

不同色系可以舒緩不同的杏仁核狀態：

| 主題 | 色系 | 適用情境 |
|------|------|---------|
| ☀️ 陽光 | 溫暖金黃 | 日常使用、好心情 |
| 🌤️ 藍天 | 清澈藍 | 日常使用、輕鬆愉快 |
| 🌊 舒緩焦慮 | 深海藍 | 擔心未來、停不下來 |
| 🌲 舒緩緊張 | 森林綠 | 被 deadline 追著跑 |
| 🪵 舒緩憤怒 | 木質棕 | 容易 irritated、內耗 |
| ☕ 舒緩疲憊 | 暖奶茶色 | 腦袋累、被掏空 |
| 🔮 靈感爆發 | 深紫藍 | 創造力爆發 |

## Skills — 最重要的資產

AIOC 最核心的功能是 **讓你分門別類累積建立自己的 Skills**。

Skill 是什麼？就是你讓 AI 做事的方法論：

- 你怎麼分析一個 code base
- 你怎麼建立測試
- 你怎麼做 code review
- 你怎麼排錯
- 你怎麼部署

這些方法論，就是你的工程智慧。AIOC 幫你把這些智慧變成可重用、可分享的 Skill。

### Skill 生命週期

1. **發現問題** — 你找到一個反覆出現的工程問題
2. **建立 Skill** — 把解法寫成結構化的 SKILL.md
3. **指派給 AI 員工** — 讓對應角色的 AI 使用這個 Skill
4. **持續累積** — 每次使用可以優化，越來越精準
5. **跨專案重用** — 同一個 Skill 可以套用到不同 code base

> **Skills 是你的工程資產。** 寫程式的 AI 滿街都是，但你的 Skills 別人沒有。這才是 AIOC 的價值。

### Skill Input — 給 AI 明確的指令

每個 Skill 執行時，你需要提供 **Input**，告訴 AI 這次要處理什麼。好的 Input 讓 AI 產出更精準：

- **具體明確** — 「分析 src/services/ 下的錯誤處理」比「看一下程式碼」好得多
- **提供脈絡** — 說明目標、範圍、限制條件
- **可重複使用** — 輸入過的 Input 會自動保留，下次可以直接選取重用

> 💡 把你每次成功讓 AI 產出好結果的 Input 記下來，這就是你的最佳實務。AIOC 會自動幫你保留這些輸入。

## 自組 AI 團隊

AIOC 讓你**自己定義 AI 成員** — 幫每個 AI 取名字、設角色、寫 personality、配技能。就像組建一個真正的團隊。

每個 AI 成員用一個 JSON 檔案定義，放在 `crew/` 目錄下：

- **名字與形象** — 取個有感的名字和頭貼，讓協作更有溫度
- **角色定位** — 定義這個 AI 負責什麼工作、擅長什麼
- **技能配置** — 為每個角色打造專屬的 Skill 清單
- **對話風格** — 透過 rolePrompt 和 greeting 塑造獨特的溝通方式

> 💡 內建的團隊只是範例。你可以自由新增、修改、替換任何成員，打造最適合你工作流程的 AI 團隊。

### 內建團隊範例

| 員工 | 角色 | 專長 |
|------|------|------|
| 小春 林 Koharu Hayashi | AI Skill Designer | 技能設計、流程架構 |
| 林語晴 Sunny Lin | Guide | 導覽、角色推薦、FAQ |
| 林曉薇 Xiaowei Lin | Spec Architect | 需求分析、API 合約 |
| 普里亞·夏爾馬 Priya Sharma | Node Developer | 節點開發、Contract 驗證 |
| 迪維雅·雷迪 Divya Reddy | QA Engineer | 品質保證、測試設計 |
| 梅根·布魯克斯 Megan Brooks | Troubleshooting Engineer | 故障排除、根因分析 |

## 跨 CLI 使用

AIOC 支援多種 AI coding CLI，設定檔統一在 `providers/` 目錄：

```bash
# 用 Qwen 開啟
cd /path/to/aioc && qwen

# 用 Claude Code 開啟
cd /path/to/aioc && claude

# 用 OpenCode 開啟
cd /path/to/aioc && opencode
```

所有 CLI 共用同一份 `skills/`，零設定直接使用。

## 技術棧

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Server**: Express (Node.js)
- **Icons**: Inline SVG（不使用 emoji，確保跨平台一致顯示）
- **Data**: JSON files（無需資料庫）

## License

MIT
