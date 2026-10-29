# PAAW — Personal AI Assistant Workspace

**Build your personal AI Workforce.**

PAAW（個人 AI 助理工作區）讓知識工作者用 AI 打造自己的工具：AI 幫你記資料，再把記下來的東西放大成可執行的能力。

> 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 形成能力飛輪
>
> Humans build tools with AI → AI remembers for you → AI amplifies what you know.

---

## ✨ Features

### 🤖 AI Crew — your AI team
Every member has its own role, skills, personality, memory and conversation history. Crews collaborate through the A2A protocol.

### 💬 Chat Assistant with Tools
All your apps are available in the chat window. Say「幫我加書籤」and the bookmark tool runs — no coding required.

### 🔧 Skill Builder — the smallest capability unit
Skills are PAAW's building blocks: prompt + input schema + context + tool access + deterministic script + guardrails. Apps, Workflows, Crews and CronJobs all call Skills.

### 📦 App Builder — apps without code
Describe what you want; the App Builder generates a working app (data-driven or skill-based) with a UI, a chat tool, and an API. Every new app automatically becomes a chat tool.

### 🔁 Workflow Builder
Chain skills and apps into repeatable workflows.

### 🧠 Knowledge / Memory / Notes
Local-first knowledge base, distilled chat memory and notebooks. Your data stays on your machine.

### ⚙️ Execution Center
CronJobs, execution monitoring, audit logs.

### 👨‍💻 Coding App — Release Unit AI Control Plane
An AI coding workspace with deterministic evidence: auto-dispatch, review boundaries, test/coverage evidence matrix, release units with human decision gates. LLMs reason; programs prove; humans decide.

---

## 🚀 Quickstart (use it directly)

Requirements: **Node.js 22.5+** (uses `node:sqlite`), npm 10+.

```bash
# 1. Install
npm install

# 2. Configure an LLM provider (get a key from OpenRouter / Z.ai / OpenAI ...)
cp data/config/providers.example.json data/config/providers.json
#    → edit providers.json, fill in your apiKey

# 3. Build & run (production mode)
npm run build
npm start
#    open http://localhost:4097
```

Optional: `cp .env.example .env` for ports / observability settings.

### Development mode

```bash
npm run dev
# UI  → http://localhost:5173 (Vite)
# API → http://localhost:4097
```

### Docker

```bash
docker compose up -d
```

---

## 📁 Project structure

```
packages/
  ui/        React + Vite dashboard
  server/    Node ESM API server (no framework, :4097)
  shared/    shared types
  db/        SQLite (node:sqlite) ORM & migrations
  context/   context engine
  engine/    execution engine
data/        product seed data (prompts, skills, apps, workflows, crews)
  config/    your runtime config lives here (providers.json — never commit real keys)
tests/       vitest unit tests + Playwright e2e
scripts/     dev/release tooling
```

`data/` doubles as your **local-first workspace**: chats, notes, app data and knowledge live in `data/` and are yours. Personal/runtime paths are gitignored.

---

## 🔐 Security model

- Local-first: your data and API keys stay on your machine (`data/config/providers.json` is gitignored — never commit real keys)
- Security kernel on every tool call: parameter checks, exec pattern blocking, protected system paths, rate limiting, audit log
- AI bash sandbox with network whitelist + approval cards for dangerous commands
- Semgrep-based code scanning in the Coding App (bring your own rules — see Settings)

## 🛠 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome — especially new skills, example apps and i18n improvements.

## 📄 License

[MIT](./LICENSE) © 2026 Fleming
