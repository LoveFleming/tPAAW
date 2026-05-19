# AIEOC — AI Engineering Operating Center

**AI 進駐工程環境，協助建立工程秩序與品質治理。**

AIEOC 是一套獨立的 AI 軟體工廠作業系統，可以套用在任何 code base 上。它提供 Dashboard 讓人有一個好的操作介面來操作 AI，讓舊系統也能擁有工程秩序與品質治理。

## 核心概念

- 🏭 **AI Software Factory** — 用半導體製造的概念管理軟體開發流程
- 🧠 **舒緩杏仁核** — 主題色系依心理學設計，幫助工程師在不同情緒狀態下保持專注
- 🤖 **AI 員工團隊** — 每個 AI 員工有自己的角色、技能和 personality
- 🔧 **跨 CLI 支援** — Skills 只存一份，Qwen / Claude Code / OpenCode 都能用

## 目錄結構

```
aieoc/
├── core/                   ← 主程式（Dashboard UI + API Server）
│   ├── src/                ← React + TypeScript frontend
│   ├── server/             ← Express API server
│   └── public/             ← 靜態資源
├── crew/                   ← AI 員工定義
│   ├── 00-ai.skill-designer.json
│   ├── 01-ai.guide.json
│   ├── 02-ai.spec.json
│   ├── 03-ai.node-dev.json
│   ├── 04-ai.qa.json
│   └── 05-ai.troubleshooting.json
├── factory/                ← 工廠文件（自動 render 到左側選單）
│   ├── constitution.md
│   ├── standards.md
│   └── quick-tour.md
├── skills/                 ← AI 技能（只一份，所有 CLI 共用）
│   ├── factory-tour/
│   ├── cli-test/
│   └── dashboard-setup/
├── providers/              ← 各 CLI 設定
│   ├── qwen/
│   ├── opencode/
│   └── claude/
└── conversations/          ← 對話歷史（by project path hash）
```

## 快速開始

### 安裝 Dashboard

```bash
cd aieoc/core
npm install
```

### 安裝 AI CLI 工具

AIEOC 支援三種 AI coding CLI，安裝後即可從 Dashboard 直接啟動。

#### Qwen Code

```bash
# npm 全域安裝
npm install -g @qwen-code/qwen-code

# 或 macOS Homebrew
brew install qwen-code

# 驗證
qwen --version
```

#### Claude Code

```bash
# npm 全域安裝
npm install -g @anthropic-ai/claude-code

# 或 macOS Homebrew
brew install claude-code

# 驗證
claude --version
```

#### OpenCode

```bash
# macOS Homebrew
brew install opencode

# 驗證
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

AIEOC 最核心的功能是 **讓你分門別類累積建立自己的 Skills**。

Skill 是什麼？就是你讓 AI 做事的方法論：

- 你怎麼分析一個 code base
- 你怎麼建立測試
- 你怎麼做 code review
- 你怎麼排錯
- 你怎麼部署

這些方法論，就是你的工程智慧。AIEOC 幫你把這些智慧變成可重用、可分享的 Skill。

### Skill 生命週期

1. **發現問題** — 你找到一個反覆出現的工程問題
2. **建立 Skill** — 把解法寫成結構化的 SKILL.md
3. **指派給 AI 員工** — 讓對應角色的 AI 使用這個 Skill
4. **持續累積** — 每次使用可以優化，越來越精準
5. **跨專案重用** — 同一個 Skill 可以套用到不同 code base

> **Skills 是你的工程資產。** 寫程式的 AI 滿街都是，但你的 Skills 別人沒有。這才是 AIEOC 的價值。

### Skill Input — 給 AI 明確的指令

每個 Skill 執行時，你需要提供 **Input**，告訴 AI 這次要處理什麼。好的 Input 讓 AI 產出更精準：

- **具體明確** — 「分析 src/services/ 下的錯誤處理」比「看一下程式碼」好得多
- **提供脈絡** — 說明目標、範圍、限制條件
- **可重複使用** — 輸入過的 Input 會自動保留，下次可以直接選取重用

在員工工作區啟動 Skill 時：

1. 如果 Skill 有定義必填欄位，會跳出 **Input 對話框** 讓你填寫
2. 填完後點 **啟動**，AI 就會帶著你的 Input 開始工作
3. 過去填過的 Input 會顯示在 **「已存輸入」** 下拉選單，可以直接選取

> 💡 把你每次成功讓 AI 產出好結果的 Input 記下來，這就是你的最佳實務。AIEOC 會自動幫你保留這些輸入。

## AI 員工團隊

| 員工 | 角色 | 專長 |
|------|------|------|
| 小春 林 Koharu Hayashi | AI Skill Designer | 技能設計、流程架構、Dashboard Setup、CLI Test |
| 林語晴 Sunny Lin | Factory Guide | 工廠導覽、角色推薦、FAQ |
| 陳哲宇 Ethan Chen | Spec Architect | 需求分析、API 合約 |
| 安妮卡·拉奧 Anika Rao | Node Developer | 節點開發、Contract 驗證 |
| 彼得 Piotr Kowalski | QA Engineer | 品質保證、測試設計 |
| 蘇菲亞 Sophia Carter | Troubleshooting Engineer | 故障排除、根因分析 |

## Dashboard

每個 Project 進入 AIEOC 後會看到 Dashboard，包含四個指標 widget：

- 📋 **Specs** — 規格文件數量
- 🧪 **Tests** — 測試數量與通過率
- 📖 **Runbooks** — 操作手冊數量與覆蓋率
- 📊 **Coverage** — 測試覆蓋率

初始狀態為空，由 AI 員工執行 **Dashboard Setup** skill 建立資料結構。

## 跨 CLI 使用

AIEOC 支援多種 AI coding CLI，設定檔統一在 `providers/` 目錄：

```bash
# 用 Qwen 開啟
cd /path/to/aieoc && qwen

# 用 Claude Code 開啟
cd /path/to/aieoc && claude

# 用 OpenCode 開啟
cd /path/to/aieoc && opencode
```

所有 CLI 共用同一份 `skills/`，零設定直接使用。

## 技術棧

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Server**: Express (Node.js)
- **Icons**: Inline SVG（不使用 emoji，確保 Mac/Windows/Linux 一致顯示）
- **Data**: JSON files（無需資料庫）

## License

MIT
