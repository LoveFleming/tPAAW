# What is AIOC?

## AI-Native Operation Center

AIOC 是 **AI Factory 的作業中心**，讓不同產品、不同角色、不同流程，都能建立、管理、使用並累積自己的 AI Skills。

## AI Factory 是什麼？

AI Factory 是一套 **AI-native 的工作生產模式**，透過：

- 📜 **標準 (Standards)** — 程式碼風格、命名規範、檔案結構
- 📋 **規則 (Rules)** — Error Code Rules、Git Commit 規範
- 📖 **範例 (Examples)** — 最佳實務、成功案例
- 🛡️ **Guardrails** — 安全邊界、行為準則
- 🔧 **Skills** — 可重用的工作方法論

讓人與 AI 能安全協作，提升品質與交付速度。

## 核心架構

```
AIOC (AI-Native Operation Center)
│
├── factories/                    ← 你的 AI 工廠們
│   ├── specnode-factory/         ← 一個工廠
│   │   ├── crews/                ← AI 員工
│   │   ├── skills/               ← 技能（最重要的資產）
│   │   └── docs/                 ← 憲法、標準、文件
│   └── your-new-factory/         ← 另一個工廠
│
├── core/                         ← Dashboard + API Server
└── providers/                    ← AI CLI 設定（Qwen / Claude / OpenCode）
```

## 關鍵概念

| 概念 | 說明 |
|------|------|
| **Factory** | 一個獨立的 AI 工作空間，有自己的員工、技能、制度 |
| **Crews** | AI 團隊成員，每個人有名字、角色、技能和 personality |
| **Skills** | 可重用的工作方法論 — 你最重要的資產 |
| **Docs** | 工廠的制度文件：憲法、標準、Error Code Rules |
| **Working Base** | AI CLI 實際工作的專案目錄 |

## 工作流程

```
1. 建立或選擇 Factory
2. 選擇 Working Base（你的專案目錄）
3. 派遣 AI 員工執行任務
4. 累積 Skills（越用越精準）
5. 跨專案、跨工廠重用 Skills
```

## 為什麼需要 AIOC？

- **寫程式的 AI 滿街都是，但你的 Skills 別人沒有** — 這才是真正的價值
- 不同產品可以有獨立的工廠，互不干擾
- Skills 只存一份，Qwen / Claude / OpenCode 都能用
- 制度和 Guardrails 確保 AI 在安全範圍內工作

## 技術棧

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Server**: Express (Node.js)
- **AI CLI**: Qwen Code / Claude Code / OpenCode
- **Data**: JSON files（無需資料庫）
