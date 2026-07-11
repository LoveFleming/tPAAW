# PAAW — Personal AI Assistant Workspace

> Build your personal AI workforce — 人用 AI 自己做工具，AI 幫你記資料，AI 放大你記的資料。

## Quick Facts

| | |
|---|---|
| Language | TypeScript + JavaScript (ESM) |
| Framework | React 18 + Vite + TailwindCSS (前端) / Node.js native (後端) |
| Runtime | Node.js 25+ |
| Package Manager | npm |
| Database | SQLite (better-sqlite3) |
| AI Model | GLM 5.1 (zhipuai) + OpenRouter fallback chain |
| Protocol | A2A (Agent-to-Agent) |
| Version | 0.1.0 |
| Last Updated | 2026-07-11 |

## 產品定位

PAAW 是一個 AI-Native 的個人助理工作台。核心價值主張：

> 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 形成能力飛輪

目標使用者：不需要會寫程式，只要描述需求，AI 幫你打造工具。

## 核心功能

1. **Chat Assistant** — 聊天視窗，所有 App 在聊天中都能用
2. **Skill Builder** — 最小能力單元（SKILL.md format），AI 可呼叫的確定性腳本
3. **App Builder** — 資料驅動或 Skill-based 應用，自動註冊為 Chat Tool
4. **Workflow Builder** — 工作流自動化
5. **Knowledge / Files** — 知識與檔案管理
6. **Memory** — 記憶管理（AI 跨對話記憶）
7. **Execution Center** — CronJob、監控
8. **Coding App (IDE)** — AI-Native 開發環境，含 AI Crew 團隊

## Architecture at a Glance

```
使用者（不會寫程式）
  ↓ 在聊天視窗或 App Builder 說「我要做一個 XX app」
  ↓
App Builder（AI 幫你建 Skill + App）
  ↓ 產出：app.json + SKILL.md + app.html
  ↓
自動註冊為 Chat Tool（AI 可呼叫）
  ↓
使用者從「聊天視窗」或「App 視窗」都能用
  ↓
App 產生的資料 → AI 讀取 → 產生洞見
```

## 專案結構

```
tPAAW/
├── packages/
│   ├── ui/           — React 前端（Vite build）
│   ├── server/       — Node.js API server (ESM, no build)
│   │   ├── src/routes/     — HTTP endpoints (crew, coding, a2a, vibe-sessions)
│   │   ├── src/lib/        — domain-agent-registry, paaw-agent-loop, context-providers
│   │   └── src/db/         — SQLite schema + queries
│   ├── shared/       — 共用型別 + shared.mjs (PAAW_ROOT, normalizePath)
│   ├── db/           — SQLite ORM (better-sqlite3)
│   ├── context/      — Context 管理
│   └── engine/       — 執行引擎
├── data/
│   ├── crews/        — AI 成員定義 (coding.*.json)
│   ├── skills/       — 技能定義 (SKILL.md)
│   ├── apps/         — App 定義
│   ├── prompts/      — Code Understanding prompt templates
│   └── config/       — 系統設定
├── .paaw/            — AI 知識庫 + 記憶（本檔案所在）
│   ├── coding-memory/     — 對話持久化 + 分派/操作 log
│   └── AGENT-MEMORY/      — AI 跨對話記憶
└── package.json
```

## Key Entry Points

| Entry | Path | Description |
|-------|------|-------------|
| Server | `packages/server/src/index.mjs` | API server bootstrap (port 3147) |
| UI Dev | `packages/ui/` | `npx vite dev` |
| UI Build | `packages/ui/dist/` | `npx vite build` |
| Agent Loop | `packages/server/src/lib/paaw-agent-loop.mjs` | AI tool-calling loop runtime |
| Agent Registry | `packages/server/src/lib/domain-agent-registry.mjs` | Crew 載入 + system prompt 組裝 |

## Quick Start

```bash
# Install
npm install

# Dev server (前端 + 後端)
cd packages/server && node src/index.mjs   # API on :3147
cd packages/ui && npx vite dev              # UI on :5173

# Production build
cd packages/ui && npx vite build            # 產出 dist/
cd packages/server && node src/index.mjs    # serve UI + API
```

## Knowledge Base Index

| Document | Path | What's Inside |
|----------|------|---------------|
| 📊 Project Status | `STATUS.md` | 目前進度、已完成/進行中/待做 |
| 🏛️ Decisions | `DECISIONS.md` | ADR — 為什麼這樣做 |
| 📝 Changelog | `CHANGELOG.md` | 每次改了什麼 |
| 🧪 Test Evidence | `TEST-EVIDENCE.md` | 驗收記錄 |
| ⚠️ Known Issues | `KNOWN-ISSUES.md` | 已知問題 |
| 📋 Next Actions | `NEXT-ACTIONS.md` | 下一步待辦 |
| 🤖 AI Operating Guide | `AI-OPERATING-GUIDE.md` | Backup 接手指南 |
| 📏 Coding Standards | `CODING-STANDARDS.md` | 跨平台路徑、IME、i18n 規範 |

## Project Health

- Knowledge completeness: 8/8 檔案已建立
- Test coverage: 手動驗證（無自動化測試）
- Tech debt: 見 `KNOWN-ISSUES.md`
