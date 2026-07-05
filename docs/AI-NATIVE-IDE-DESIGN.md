# PAAW AI-Native Coding IDE — Design Document

> **願景**：把 PAAW Coding IDE 從「有 AI 助手的編輯器」升級成「AI 原生的開發環境」。
>
> AI 不只是陪你寫程式，它參與整個專案的生命週期 — 理解上下文、記住決策、自動更新文件、記錄變更、測試驗證。
>
> Repo: `LoveFleming/tPAAW` · Branch: `dev`
> 日期：2026-07-05

---

## 目錄

1. [設計理念](#1-設計理念)
2. [`.paaw/` 專案知識目錄](2-paaw-專案知識目錄)
3. [整體架構](#3-整體架構)
4. [核心模組設計](#4-核心模組設計)
5. [AI Agent 增强](#5-ai-agent-增強)
6. [Browser Tab 内建測試](#6-browser-tab-内建測試)
7. [Coding Standards 系統](#7-coding-standards-系統)
8. [UI 布局](#8-ui-佈局)
9. [資料流設計](#9-資料流設計)
10. [API 設計](#10-api-設計)
11. [實作路線圖](#11-實作路線圖)

---

## 1. 設計理念

### 現狀（v1 Coding IDE）

```
┌────────┬────────────────────┬──────────┐
│ Files  │  Code Editor       │  AI Chat │
│        │  ────────────────  │  (旁邊)   │
│        │  Terminal          │          │
└────────┴────────────────────┴──────────┘
```

AI 是「側邊助手」— 你問它才動，不問就不參與。

### 目標（v2 AI-Native）

```
┌────────┬────────────────────┬──────────┐
│ Files  │  Code Editor       │  AI Chat │
│ +      │  ────────────────  │  +       │
│ .paaw  │  Browser Preview   │  Context │
│ Docs   │  ────────────────  │  +       │
│        │  Terminal          │  Actions │
└────────┴────────────────────┴──────────┘
         ↕ AI 主動參與每個環節 ↕
```

**四個核心轉變：**

| 維度 | v1（現在） | v2（目標） |
|------|-----------|-----------|
| **AI 角色** | 被動助手（你問才答） | 主動參與者（改完碼自動更新文件、記錄決策） |
| **專案知識** | AI 每次重新理解專案 | `.paaw/` 持久化專案記憶，AI 帶著上下文工作 |
| **測試** | 跳到瀏覽器測試 | 内建 Browser Tab，IDE 内即寫即測 |
| **標準** | AI 不知道你的 coding standard | 可匯入/編輯的 Coding Standards，AI 自動遵守 |

### 設計原則

1. **AI 知道專案在做什麼** — `.paaw/` 讓 AI 帶著完整上下文工作
2. **AI 記得做了什麼** — 每次變更自動記錄 changelog + 決策
3. **AI 遵守你的標準** — Coding Standards 可定義、可匯入、可編輯
4. **不離開 IDE** — 寫碼、測試、預覽、文件、Git 全在一個視窗
5. **文件不是負擔** — AI 自動維護，工程師只需 review

---

## 2. `.paaw/` 專案知識目錄

### 2.1 為什麼需要？

現在 AI 每次對話都是「失憶」狀態。它不知道：
- 這個專案用什麼框架、什麼風格
- 上次改了什麼、為什麼這樣改
- 架構決策是什麼時候、由誰做的
- 哪些 API tool 被呼叫過、結果如何

`.paaw/` 解決這個問題 — 它是**專案級的 AI 記憶**。

### 2.2 目錄結構

```
your-project/
├── src/
├── package.json
└── .paaw/                        ← AI-Native 專案知識目錄
    ├── PROJECT.md                ← 專案概覽（自動生成 + 人工編輯）
    ├── ARCHITECTURE.md           ← 架構文件（AI 維護）
    ├── DECISIONS.md              ← 技術決策記錄 (ADR format)
    ├── CHANGELOG.md              ← AI 自動產生的變更記錄
    ├── CODING-STANDARDS.md       ← Coding 規範（可匯入、可編輯）
    ├── CONTEXT.md                ← AI 工作時的動態上下文（session-based）
    │
    ├── sessions/                 ← 每次 AI 互動的完整記錄
    │   ├── 2026-07-05-add-auth-api.md      ← 按日期 + 任務命名
    │   ├── 2026-07-05-fix-login-bug.md
    │   └── ...
    │
    ├── api-logs/                 ← API Tool 執行記錄
    │   ├── 2026-07-05-*.json     ← 按日期存放
    │   └── ...
    │
    ├── standards/                ← Coding Standards 子規則
    │   ├── typescript.md         ← TS 規範
    │   ├── react.md              ← React 規範
    │   ├── naming.md             ← 命名規範
    │   ├── git-commit.md         ← Commit message 規範
    │   └── security.md           ← 安全規範
    │
    ├── prompts/                  ← 專案自訂 prompt 模板
    │   ├── code-review.md        ← Code Review prompt
    │   ├── generate-test.md      ← 測試生成 prompt
    │   └── refactor.md           ← 重構 prompt
    │
    └── snapshots/                ← AI 修改前的檔案快照
        └── ...                   ← 用於 undo / diff 比較
```

### 2.3 各檔案職責

#### `PROJECT.md` — 專案概覽

```markdown
# Project: my-app

## 概述
一句話描述這個專案。

## 技術棧
- Frontend: React 19 + TypeScript + Vite
- Backend: Node.js + Express
- Database: SQLite

## 專案結構
src/
├── routes/       — API 路由
├── models/       — 資料模型
└── utils/        — 工具函數

## 啟動方式
npm run dev → http://localhost:3000

## 環境變數
PORT=3000
DATABASE_URL=...
```

> **產出方式**：首次打開專案時 AI 自動掃描 `package.json`、目錄結構、README，生成初版。之後 AI 每次大改架構時更新。

#### `DECISIONS.md` — Architecture Decision Records (ADR)

```markdown
# Technical Decisions

## ADR-001: 選擇 SQLite 而非 PostgreSQL
- **日期**: 2026-07-01
- **狀態**: Accepted
- **背景**: 單人使用，不需要併發，部署越簡單越好
- **決定**: 用 SQLite + sql.js
- **後果**: 無 ACID，但單人場景下可接受

## ADR-002: API 用 .mjs 而非 TypeScript
- **日期**: 2026-06-15
- **狀態**: Accepted
- **背景**: ...
```

> **產出方式**：AI 做架構決策時自動追加。工程師也可以手動加。

#### `CHANGELOG.md` — AI 自動變更記錄

```markdown
# Changelog

## 2026-07-05

### Added
- 新增 `/api/export` route，支援 CSV 匯出
  - 檔案: `src/routes/export.mjs` (new)

### Fixed
- 修正 login 頁面 IME Enter 問題
  - 檔案: `src/components/Login.tsx` (line 45-52)
  - 原因: 缺少 compositionstart/end event handler

### Changed
- 重構 user preferences API，統一走 /api/user/preferences
  - 檔案: `src/routes/user.mjs`
```

> **產出方式**：每次 AI 寫完碼，自動分析 git diff，生成 changelog 條目。

#### `CODING-STANDARDS.md` — 主檔（索引）

```markdown
# Coding Standards

本專案遵循以下 coding 規範。AI 在寫碼時必須遵守。

## 規範索引
- [TypeScript](./standards/typescript.md)
- [React](./standards/react.md)
- [命名規範](./standards/naming.md)
- [Git Commit](./standards/git-commit.md)
- [安全規範](./standards/security.md)

## 通用原則
1. 永遠處理 IME composition（useRef）
2. 新字串必須用 t() + 加 locale key
3. 改完碼一定要 commit + push
4. 不留 uncommitted local change
```

> **產出方式**：工程師透過 UI 編輯，或從範本匯入。AI 每次寫碼前讀取。

#### `sessions/*.md` — 互動記錄

```markdown
# Session: 2026-07-05 Fix Login Bug

## 任務
修正 login 頁面中文輸入選字按 Enter 會直接送出的問題

## AI 操作步驟
1. read_file: src/components/Login.tsx
2. grep: "onKeyDown\|isComposing" in src/components/
3. edit_file: src/components/Login.tsx (加入 composingRef)
4. read_file: src/components/Login.tsx (驗證修改)
5. bash: npm run build (確認無錯誤)

## 變更檔案
- `src/components/Login.tsx` — 加入 composingRef 三層保護

## 結果
✅ Build 通過，IME 問題已修復

## 學到的教訓
- compositionstart/end 一定要用 useRef 而非 useState
- 已更新到 CODING-STANDARDS.md
```

> **產出方式**：每次 AI Agent Loop 結束後自動生成。

#### `api-logs/*.json` — API Tool 執行記錄

```json
{
  "ts": "2026-07-05T09:30:00Z",
  "tool": "bash",
  "command": "npm run build",
  "exitCode": 0,
  "duration": 4521,
  "stdout": "...",
  "stderr": "",
  "sessionRef": "2026-07-05-fix-login-bug"
}
```

> **產出方式**：Agent Loop 中每次 tool call 自動記錄。

---

## 3. 整體架構

```
┌─────────────────────────────────────────────────────────────────┐
│                     AI-Native Coding IDE                         │
├──────────┬───────────────────────────────────┬──────────────────┤
│          │                                    │                  │
│  File    │  Tab Bar: editor | browser | git   │  AI Context      │
│  Explorer│  ───────────────────────────────   │  Panel           │
│          │                                    │                  │
│  +       │  ┌─────────┬─────────┬──────────┐ │  ┌────────────┐ │
│  .paaw   │  │ Code    │ Browser │  Git     │ │  │ Standards  │ │
│  Docs    │  │ Editor  │ Preview │  Review  │ │  │ Editor     │ │
│  Tree    │  │         │         │          │ │  ├────────────┤ │
│          │  │         │  ← live │          │ │  │ Decision   │ │
│  +       │  │         │  test   │          │ │  │ Log        │ │
│  Context │  │         │         │          │ │  ├────────────┤ │
│  Info    │  └─────────┴─────────┴──────────┘ │  │ Session    │ │
│          │  ───────────────────────────────   │  │ History    │ │
│          │  Terminal Panel (resize)           │  └────────────┘ │
│          │                                    │                  │
├──────────┴───────────────────────────────────┴──────────────────┤
│                      AI Agent Loop (Enhanced)                     │
│  讀取 .paaw/ → 寫碼 → 測試 → 更新文件 → 記錄 session             │
├──────────────────────────────────────────────────────────────────┤
│                      PAAW Server                                  │
│  context-engine ← .paaw/* + coding standards + agent-loop        │
│  + browser preview server                                        │
│  + .paaw file watcher                                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 核心模組設計

### 4.1 `.paaw/` Manager（後端）

**新增檔案**: `packages/server/src/lib/paaw-project.mjs`

負責：
- `.paaw/` 目錄的初始化、讀寫
- 專案知識的自動生成和更新
- Session 記錄的寫入
- Changelog 的自動產出
- API log 的收集

```javascript
// paaw-project.mjs 核心函式

class PaawProject {
  constructor(projectRoot) {
    this.root = projectRoot;
    this.paawDir = join(projectRoot, '.paaw');
  }

  // 初始化 .paaw/ 目錄
  async init() {
    await mkdir(this.paawDir, { recursive: true });
    await mkdir(join(this.paawDir, 'sessions'), { recursive: true });
    await mkdir(join(this.paawDir, 'api-logs'), { recursive: true });
    await mkdir(join(this.paawDir, 'standards'), { recursive: true });
    await mkdir(join(this.paawDir, 'prompts'), { recursive: true });
    // 生成初版 PROJECT.md（如果不存在）
    if (!existsSync(join(this.paawDir, 'PROJECT.md'))) {
      await this.generateProjectOverview();
    }
  }

  // 讀取完整 context（給 AI 用）
  async loadContext() {
    return {
      project: await this.readFile('PROJECT.md'),
      architecture: await this.readFile('ARCHITECTURE.md'),
      decisions: await this.readFile('DECISIONS.md'),
      standards: await this.loadStandards(),
      recentSessions: await this.loadRecentSessions(5),
      changelog: await this.readFile('CHANGELOG.md'),
    };
  }

  // 記錄一次 AI session
  async recordSession(sessionData) {
    const filename = `${today()}-${slugify(sessionData.task)}.md`;
    const content = this.renderSessionMd(sessionData);
    await writeFile(join(this.paawDir, 'sessions', filename), content);
  }

  // 自動更新 changelog
  async appendChangelog(changes) {
    // changes = { added: [], fixed: [], changed: [], deprecated: [] }
    // 解析 git diff，分類變更，追加到 CHANGELOG.md
  }

  // 記錄 API tool 執行
  async logApiCall(logEntry) {
    const filename = `${today()}-${Date.now()}.json`;
    await writeFile(join(this.paawDir, 'api-logs', filename), JSON.stringify(logEntry, null, 2));
  }

  // 生成專案概覽
  async generateProjectOverview() {
    // 讀取 package.json, 目錄結構, README
    // 用 AI 生成 PROJECT.md
  }
}
```

### 4.2 Browser Preview Tab（前端）

**新增檔案**: `packages/ui/src/components/BrowserPreview.tsx`

内建瀏覽器預覽，直接在 IDE 内測試 web app，不用跳到外部瀏覽器。

```
┌──────────────────────────────────────┐
│ 🌐 http://localhost:5173    [↻] [↗]  │  ← URL bar + reload + open external
├──────────────────────────────────────┤
│                                      │
│   <iframe>                           │  ← WebView（sandboxed）
│   即時渲染你的 app                    │
│                                      │
│                                      │
├──────────────────────────────────────┤
│ Console | Network | Elements         │  ← DevTools tabs（精簡版）
├──────────────────────────────────────┤
│ [console] > x                       │
│ [console] ← 2                       │  ← 攔截 console.log
└──────────────────────────────────────┘
```

**實作方案**：

| 方案 | 說明 | 優缺點 |
|------|------|--------|
| **A: iframe** | 用 `<iframe>` 嵌入 dev server URL | 最簡單，但不能存取跨域 cookie/localStorage |
| **B: WebView plugin** | 用 Electron/Tauri 的 WebView | 功能最完整，但需大改架構 |
| **C: proxy + iframe** | PAAW server proxy 轉發，注入 postMessage | 中等複雜，能攔截 console |

**推薦：方案 A（iframe）+ 方案 C（proxy for console）**

```tsx
// BrowserPreview.tsx 核心結構

function BrowserPreview({ projectRoot, devPort }) {
  const [url, setUrl] = useState(`http://localhost:${devPort}`);
  const [history, setHistory] = useState([url]);
  const [consoleLogs, setConsoleLogs] = useState([]);

  return (
    <div className="browser-preview">
      {/* URL Bar */}
      <div className="browser-toolbar">
        <button onClick={reload}>↻</button>
        <input value={url} onChange={navigate} />
        <button onClick={() => window.open(url)}>↗</button>
      </div>

      {/* WebView */}
      <iframe
        src={url}
        sandbox="allow-scripts allow-same-origin allow-forms"
        onLoad={captureConsole}
      />

      {/* DevTools Panel */}
      <div className="browser-devtools">
        <DevToolsTabs logs={consoleLogs} />
      </div>
    </div>
  );
}
```

**Console 攔截**（透過 proxy injection）：

```javascript
// PAAW server 在 dev server 的 HTML 中注入一段 script：
<script>
  // 攔截 console.log/error/warn，postMessage 給父頁面
  ['log', 'error', 'warn', 'info'].forEach(method => {
    const orig = console[method];
    console[method] = (...args) => {
      orig(...args);
      parent.postMessage({ type: 'console', method, args: args.map(String) }, '*');
    };
  });
  // 攔截未捕獲的錯誤
  window.addEventListener('error', (e) => {
    parent.postMessage({ type: 'error', message: e.message, filename: e.filename, line: e.lineno }, '*');
  });
</script>
```

### 4.3 Coding Standards Editor（前端）

**新增檔案**: `packages/ui/src/components/StandardsEditor.tsx`

```
┌──────────────────────────────────────────┐
│ 📏 Coding Standards         [📥 Import]  │
├──────────┬───────────────────────────────┤
│          │                                │
│ 通用     │  # TypeScript 規範             │
│ TS       │                                │
│ React    │  ## 命名                       │
│ 命名     │  - interface 用 PascalCase     │
│ Git      │  - 變數用 camelCase            │
│ 安全     │  - 常數用 UPPER_SNAKE          │
│ + New    │                                │
│          │  ## 型別                       │
│          │  - 永遠標明 return type        │
│          │  - 避免 any，用 unknown        │
│          │                                │
│          │  [Edit] [Save] [AI Generate]   │
│          │                                │
└──────────┴───────────────────────────────┘
```

功能：
- **左側樹狀目錄**：列出 `standards/` 下所有規範檔
- **右側 Markdown 編輯器**：線上編輯
- **📥 Import**：從範本匯入（PAAW 預設、AIRbnb、Google 等）
- **AI Generate**：讓 AI 根據現有 codebase 自動生成建議規範
- **即時生效**：存檔後，下一次 AI 寫碼就會讀取最新規範

### 4.4 Session History Panel（前端）

**新增檔案**: `packages/ui/src/components/SessionHistory.tsx`

```
┌──────────────────────────────────────────┐
│ 📋 Session History                       │
├──────────────────────────────────────────┤
│                                          │
│ 📅 2026-07-05                            │
│ ├─ 🔧 Fix login IME bug (3 files)        │
│ ├─ ✨ Add export API (1 file, new)       │
│ └─ ♻️ Refactor user prefs (5 files)      │
│                                          │
│ 📅 2026-07-04                            │
│ ├─ 🔧 Fix knowledge blank (2 files)      │
│ └─ ✨ Add i18n support (12 files)        │
│                                          │
│ [點擊展開詳情]                            │
│                                          │
│ ┌─ Fix login IME bug ──────────────────┐ │
│ │ 任務：修正中文輸入 Enter 問題         │ │
│ │ 變更：Login.tsx (+12 lines)          │ │
│ │ 工具：read, grep, edit, build        │ │
│ │ 結果：✅ Build 通過                  │ │
│ │ 教訓：useRef > useState for IME      │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### 4.5 Decision Log Panel（前端）

**新增檔案**: `packages/ui/src/components/DecisionLog.tsx`

```
┌──────────────────────────────────────────┐
│ 🧠 Decision Log (ADR)        [+ New ADR]  │
├──────────────────────────────────────────┤
│                                          │
│ ADR-003: 用 useRef 處理 IME composition  │
│ 日期：2026-07-04 | 狀態：✅ Accepted     │
│ ────────────────────────────────────────│
│ 背景：中文/日文選字按 Enter 會送出表單   │
│ 決定：useRef + 三層 fallback            │
│ 影響：所有新 textarea/input             │
│                                          │
│ ADR-002: API 用 .mjs 而非 TypeScript    │
│ 日期：2026-06-15 | 狀態：✅ Accepted     │
│ ...                                      │
│                                          │
└──────────────────────────────────────────┘
```

---

## 5. AI Agent 增强

### 5.1 新增 Tools

在現有 9 個 tools 基礎上，新增專案知識管理 tools：

| Tool | 說明 |
|------|------|
| `read_project_context` | 讀取 `.paaw/` 完整 context（PROJECT.md + ARCHITECTURE.md + standards） |
| `update_changelog` | 自動分析 git diff，追加 changelog 條目 |
| `record_decision` | 記錄一個技術決策到 DECISIONS.md |
| `update_docs` | 更新架構文件或相關 .md |
| `read_standards` | 讀取 coding standards |
| `browser_test` | 在内建 browser 中執行測試（導航、截圖、檢查元素） |

### 5.2 增強後的 Agent Loop

```
Agent Loop v2:

1. 啟動時：
   ├── 讀取 .paaw/PROJECT.md（專案概覽）
   ├── 讀取 .paaw/CODING-STANDARDS.md（規範）
   ├── 讀取 .paaw/DECISIONS.md（歷史決策）
   ├── 讀取最近 3 個 session 記錄
   └── 注入到 systemPrompt

2. 執行中：
   ├── 每次寫碼前：讀取相關 coding standard
   ├── 每次 tool call：記錄到 api-logs/
   ├── 偵測到架構決策時：提示記錄到 DECISIONS.md
   └── 偵測到新檔案/目錄時：提示更新 ARCHITECTURE.md

3. 完成後：
   ├── 分析 git diff
   ├── 自動生成 changelog 條目 → CHANGELOG.md
   ├── 生成 session 記錄 → sessions/YYYY-MM-DD-task.md
   ├── 如有架構變更 → 更新 ARCHITECTURE.md
   └── 如有值得記的教訓 → 提示加入 CODING-STANDARDS.md
```

### 5.3 System Prompt 增强

現有的 `agent-loop/system-prompt.md` 會被擴展：

```markdown
# PAAW Agent — System Prompt (v2)

You are PAAW Agent, an AI-native coding assistant.

## Project Context
{{PROJECT_OVERVIEW}}      ← from .paaw/PROJECT.md

## Coding Standards
{{CODING_STANDARDS}}      ← from .paaw/standards/*.md

## Recent Decisions
{{RECENT_DECISIONS}}      ← from .paaw/DECISIONS.md (last 5)

## Recent Sessions
{{RECENT_SESSIONS}}       ← from .paaw/sessions/ (last 3 summaries)

## Your Tools
... (existing 9 tools) +
- read_project_context — 查詢專案知識
- update_changelog — 更新變更記錄
- record_decision — 記錄技術決策
- update_docs — 更新文件
- browser_test — 瀏覽器測試

## Rules
1. 寫碼前先讀 coding standards，遵守規範
2. 改完碼後，如涉及新模式或教訓，更新 standards
3. 做架構決策時，記錄到 DECISIONS.md
4. 每次 session 結束，你的 changelog 和 session 記錄會自動生成
5. ...
```

---

## 6. Browser Tab 内建測試

### 6.1 三種使用模式

**模式 A: Dev Server 預覽**
- 自動偵測專案的 dev server port（Vite 5173, Next 3000 等）
- iframe 直接嵌入 `http://localhost:{port}`
- 支援 hot-reload

**模式 B: AI 測試模式**
- AI 用 `browser_test` tool 操作：
  - 導航到指定 URL
  - 點擊元素
  - 填寫表單
  - 截圖
  - 檢查 DOM 元素
- 測試結果記錄到 `.paaw/sessions/`

**模式 C: API 測試**
- 現有的 API Tester 功能整合進來
- 記錄到 `.paaw/api-logs/`

### 6.2 DevTools（精簡版）

| Tab | 功能 |
|-----|------|
| **Console** | 攔截 iframe 的 console.log/error/warn |
| **Network** | 攔截 fetch/XHR 請求（透過 proxy） |
| **Screenshots** | AI 截圖歷史 |

---

## 7. Coding Standards 系統

### 7.1 資料流

```
┌─────────────────────────────────────────────┐
│             Standards Editor (UI)            │
│   編輯 → 存檔到 .paaw/standards/*.md         │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│            File Watcher (server)             │
│   .paaw/standards/ 有變動 → 更新 cache       │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│         Context Engine (server)              │
│   組裝 systemPrompt 時注入最新 standards     │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│           AI Agent Loop                      │
│   AI 寫碼時遵守 standards                    │
└─────────────────────────────────────────────┘
```

### 7.2 Import 範本

預設提供以下範本可匯入：

| 範本 | 說明 |
|------|------|
| **PAAW Default** | PAAW 自己的 coding rules（IME, i18n, commit+push） |
| **TypeScript Strict** | 嚴格 TS 規範（no any, explicit return type） |
| **React Best Practice** | React 函數式組件、hooks 規範 |
| **Airbnb Style** | Airbnb JavaScript Style Guide 摘要 |
| **Google Style** | Google JavaScript/TypeScript Style |

Import 時會合併到現有的 `standards/` 目錄，不覆蓋已有檔案。

### 7.3 AI Auto-Generate

點 **AI Generate** 按鈕：
1. AI 掃描現有 codebase（讀取 `*.ts`, `*.tsx`, `*.mjs` 各 5-10 個檔案）
2. 分析命名風格、型別使用、錯誤處理模式
3. 生成建議規範
4. 工程師 review 後採用

---

## 8. UI 布局

### 8.1 主介面（v2）

```
┌──────┬─────────────────────────────────┬──────────────┐
│      │  [📄 Code] [🌐 Browser] [🔀 Git]│  AI Assistant │
│ File │                                 │              │
│ Tree ├─────────────────────────────────┤  [Chat]      │
│      │                                 │  [Standards] │
│ ─────│                                 │  [Decisions] │
│      │  Code Editor / Browser / Git    │  [Sessions]  │
│ .paaw│  (切換 tab)                      │  [Context]   │
│  📁  │                                 │              │
│  📄  │                                 │              │
│  📄  │                                 │              │
│ ─────│                                 │              │
│      ├─────────────────────────────────┤              │
│ Std  │                                 │              │
│ Promp│  Terminal (resize)              │              │
│      │                                 │              │
└──────┴─────────────────────────────────┴──────────────┘
```

### 8.2 左側欄增強

左側欄分為上下兩區：

**上半：File Explorer**（現有）
- 專案檔案樹

**下半：Project Knowledge**（新增）
- 📁 `.paaw/` 樹狀目錄
  - 📄 PROJECT.md
  - 📄 ARCHITECTURE.md
  - 📄 DECISIONS.md
  - 📄 CHANGELOG.md
  - 📁 sessions/
  - 📁 standards/
  - 📁 prompts/
  - 📁 api-logs/
- 📁 `standards/` 快速跳轉
- 📁 `prompts/` 快速跳轉

### 8.3 右側面板 Tab 切換

右側 AI Panel 改為多 tab：

| Tab | 內容 |
|-----|------|
| 💬 **Chat** | AI 對話（現有功能） |
| 📏 **Standards** | Coding Standards 編輯器 |
| 🧠 **Decisions** | ADR 決策記錄 |
| 📋 **Sessions** | 歷史 session 記錄 |
| 🔍 **Context** | 目前 AI 能看到的完整 context（debug 用） |

### 8.4 中間區域 Tab

中間區域新增 Browser tab：

| Tab | 內容 |
|-----|------|
| 📄 **Code** | 程式碼編輯器（現有） |
| 🌐 **Browser** | 内建瀏覽器預覽（新增） |
| 🔀 **Git** | Git 操作（現有） |
| 🧪 **Test** | 測試結果（新增，可選） |

---

## 9. 資料流設計

### 9.1 AI 寫碼完整流程（v2）

```
使用者輸入任務
    │
    ▼
┌─────────────────────────────────────────────────┐
│ 1. Context Assembly                             │
│    ├── 讀取 .paaw/PROJECT.md                    │
│    ├── 讀取 .paaw/CODING-STANDARDS.md           │
│    ├── 讀取 .paaw/DECISIONS.md (last 5)        │
│    ├── 讀取最近 3 個 session 摘要               │
│    └── 注入到 systemPrompt                      │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│ 2. Agent Loop (Enhanced)                        │
│    ├── AI 讀碼、寫碼、測試                      │
│    ├── 每次 tool call → 寫入 api-logs/          │
│    ├── 偵測架構決策 → 詢問是否記錄              │
│    └── 遵守 coding standards                    │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│ 3. Post-Completion (自動)                       │
│    ├── 分析 git diff                            │
│    ├── 生成 changelog → CHANGELOG.md            │
│    ├── 生成 session 記錄 → sessions/            │
│    ├── 如有架構變更 → 更新 ARCHITECTURE.md      │
│    ├── 如有新教訓 → 提示更新 STANDARDS          │
│    └── 可選：自動 browser 測試截圖              │
└─────────────────────────────────────────────────┘
```

### 9.2 Browser Test 流程

```
AI 或使用者觸發測試
    │
    ▼
Browser Preview Tab 開啟
    │
    ├── iframe 導航到 dev server URL
    │
    ├── 自動測試（AI 模式）:
    │   ├── browser_test tool → 導航、點擊、填表
    │   ├── postMessage 攔截 console/errors
    │   └── 截圖存到 .paaw/sessions/
    │
    └── 手動測試:
        ├── 使用者在 iframe 中操作
        ├── Console 攔截顯示在 DevTools
        └── 網路請求記錄
```

---

## 10. API 設計

### 10.1 新增 API Endpoints

| Method | Path | 說明 |
|--------|------|------|
| **GET** | `/api/project/:path/context` | 取得專案 `.paaw/` 完整 context |
| **POST** | `/api/project/:path/init` | 初始化 `.paaw/` 目錄 |
| **GET** | `/api/project/:path/standards` | 取得 coding standards |
| **PUT** | `/api/project/:path/standards/:name` | 更新特定 standard 檔案 |
| **POST** | `/api/project/:path/standards/import` | 匯入範本 |
| **POST** | `/api/project/:path/standards/ai-generate` | AI 生成建議規範 |
| **GET** | `/api/project/:path/decisions` | 取得 ADR 列表 |
| **POST** | `/api/project/:path/decisions` | 新增 ADR |
| **GET** | `/api/project/:path/sessions` | 取得 session 歷史 |
| **GET** | `/api/project/:path/sessions/:id` | 取得特定 session 詳情 |
| **GET** | `/api/project/:path/changelog` | 取得 changelog |
| **POST** | `/api/project/:path/browser/test` | 執行 browser 測試 |
| **GET** | `/api/project/:path/browser/console` | 取得 console 攔截記錄 |

### 10.2 Browser Proxy

| Method | Path | 說明 |
|--------|------|------|
| **GET** | `/api/browser/proxy?url=...` | Proxy 轉發（注入 console hook） |
| **WS** | `/ws/browser` | Browser DevTools WebSocket（即時 console/errors） |

---

## 11. 實作路線圖

### Phase 1: `.paaw/` 目錄 + Context 注入（MVP）

**目標**：AI 能讀到專案知識，帶著上下文工作

| 任務 | 檔案 | 說明 |
|------|------|------|
| 建立 `PaawProject` class | `server/lib/paaw-project.mjs` | 目錄管理、讀寫、context 組裝 |
| 初始化 API | `server/routes/project.mjs` | init、get context |
| 前端 `.paaw/` 樹 | `ui/components/PaawTree.tsx` | 左側欄知識目錄 |
| Agent Loop 讀取 `.paaw/` | `server/lib/paaw-agent-loop.mjs` | 啟動時注入 context |
| `PROJECT.md` 自動生成 | `server/lib/paaw-project.mjs` | 掃描 package.json + 目錄 |
| Session 自動記錄 | `server/lib/paaw-agent-loop.mjs` | Agent Loop 結束後寫入 |

### Phase 2: Standards 系統 + UI

**目標**：可編輯、可匯入的 Coding Standards

| 任務 | 檔案 |
|------|------|
| Standards CRUD API | `server/routes/project.mjs` |
| Standards Editor UI | `ui/components/StandardsEditor.tsx` |
| Import 範本 | `data/templates/standards/*.md` |
| AI Generate Standards | `server/routes/project.mjs` |
| Standards 注入 Agent Loop | `server/lib/paaw-agent-loop.mjs` |
| 右側面板 Tab 切換 | `ui/pages/CodingIDE.tsx` |

### Phase 3: Browser Tab

**目標**：IDE 内即寫即測

| 任務 | 檔案 |
|------|------|
| BrowserPreview 元件 | `ui/components/BrowserPreview.tsx` |
| iframe + URL bar | 同上 |
| Console 攔截（postMessage） | `server/routes/browser-proxy.mjs` |
| `browser_test` tool | `server/lib/paaw-agent-loop.mjs` |
| DevTools 面板（Console/Network） | `ui/components/BrowserDevTools.tsx` |
| 自動偵測 dev server port | `ui/components/BrowserPreview.tsx` |

### Phase 4: Session History + Decision Log + Changelog

**目標**：完整的專案知識生命週期

| 任務 | 檔案 |
|------|------|
| Session 自動生成（含 git diff 分析） | `server/lib/paaw-project.mjs` |
| Changelog 自動生成 | 同上 |
| Decision Log UI | `ui/components/DecisionLog.tsx` |
| Session History UI | `ui/components/SessionHistory.tsx` |
| `record_decision` tool | `server/lib/paaw-agent-loop.mjs` |
| `update_changelog` tool | 同上 |
| `update_docs` tool | 同上 |

### Phase 5: 潤飾與進階功能

| 任務 | 說明 |
|------|------|
| 自動偵測 dev server 啟動/停止 | 用 lsof 或 chokidar 監聯 |
| 多專案切換 | 支援同時開多個 project root |
| `.paaw/` Git 追蹤策略 | 可選：commit 到 repo / gitignore / 獨立 branch |
| AI 自動 Code Review | commit 前自動 review |
| 專案健康度 Dashboard | 技術債、測試覆蓋率、文件完整度 |
| Snapshot / Undo | AI 修改前自動快照 |

---

## 附錄 A：`.paaw/` vs 現有 PAAW data/

| 項目 | PAAW `data/` | 專案 `.paaw/` |
|------|-------------|--------------|
| 範圍 | PAAW 應用本身的全域知識 | 個別 coding 專案 |
| 位置 | PAAW 安裝目錄 | 每個專案的 root |
| 跟 Git | 不進 Git | 可選擇進 Git（團隊共享） |
| 內容 | AI settings, apps, skills, crews | 專案架構、決策、session、standards |

## 附錄 B：與 Cursor / Windsurf 的差異

| 維度 | Cursor/Windsurf | PAAW AI-Native IDE |
|------|----------------|-------------------|
| 專案知識 | `.cursorrules` 一個檔案 | `.paaw/` 完整目錄結構 |
| Session 記錄 | 無持久化 | `.paaw/sessions/` 完整記錄 |
| 決策記錄 | 無 | `.paaw/DECISIONS.md` (ADR) |
| Changelog | 無自動 | AI 自動生成 |
| Coding Standards | `.cursorrules` 手寫 | UI 編輯 + 範本匯入 + AI 生成 |
| Browser 預覽 | 無/外部 | IDE 内建 iframe + DevTools |
| 自主性 | AI 被動回應 | AI 主動更新文件、記錄決策 |
| 開放性 | 閉源 SaaS | 開源、自托管、資料完全自控 |

---

> **核心理念**：AI 不是一個聊天框，它是專案的共同作者。它知道專案的歷史、遵守你的規範、記得每次決策、自動維護文件。這才是 AI-Native。
