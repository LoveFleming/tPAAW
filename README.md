# PAAW — Personal AI Assistant Workspace

**Build your personal AI Workforce.**

PAAW 讓知識工作者用 AI 打造自己的工具，AI 幫你記資料，再把記下來的東西放大成可執行的能力。

> 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 形成能力飛輪

## 核心概念

- 🤖 **AI Crew** — 自組 AI 團隊，每個成員有角色、技能、個性
- 🔧 **Skill** — 最小能力單元，可被 App、Workflow、AI Crew、CronJob 叫用
- 📦 **App** — 資料驅動或 Skill-based，自動產生聊天 Tool
- ⏰ **CronJob** — 排程執行 Skill 或 App
- 💬 **Chat** — 所有 App 在聊天視窗都能用，觸發關鍵字自動路由

## 目錄結構

```
paaw/
├── packages/                   ← Monorepo（npm workspaces）
│   ├── ui/                     ← React 前端 (Vite + Tailwind)
│   ├── server/                 ← HTTP + WebSocket API server
│   ├── shared/                 ← 共用型別、工具、Schema
│   ├── db/                     ← SQLite + Kysely ORM
│   ├── context/                ← Context 組裝、記憶管理
│   ├── engine/                 ← Skill/Workflow 執行引擎
│   └── data/                   ← Runtime data (SQLite)
├── data/                       ← 使用者資料
│   ├── crews/                  ← AI 成員定義 JSON
│   ├── skills/                 ← Skills 定義
│   ├── apps/                   ← App 定義 + 資料
│   ├── config/                 ← Provider、使用者設定
│   ├── chats/                  ← 對話歷史
│   └── db/                     ← SQLite 資料庫
├── apps/                       ← App 實體目錄
├── docs/                       ← 文件
└── skills/                     ← （舊位置，逐步遷移至 data/skills/）
```

## 快速開始

```bash
npm install
npm run dev
```

Dashboard 在 http://localhost:5173，API server 在 http://localhost:4097。

## 技術棧

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + i18n
- **Server**: Node.js HTTP + WebSocket (node-pty)
- **Database**: SQLite + Kysely
- **Architecture**: npm workspaces monorepo

## License

MIT
