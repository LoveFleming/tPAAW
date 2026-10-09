# Coding App — AI Coding 安全防護

> 2026-10-09 版。對應實作：`lib/script-guard.mjs`、`lib/shell-guard.mjs`、`lib/env-exec-tool.mjs`（commit afee4540 等）。
> 原則一句話：**該快的全速跑，該問的才問 — 擋越權靠代碼，不靠 AI 自律。**

---

## 部署環境的隔離脈絡（2026-10-09 Fleming 補充）

- **公司開發機本來就連不到 production**（公司網路政策）— PAAW 跑在公司機上時，這層隔離由公司環境提供
- **家裡 Mac mini 與公司無關** — 防護 = script-guard 系（pattern 掃描/越權攔截，跨平台自帶）
- 網路層沙箱（macOS sandbox-exec / Linux unshare-net / Windows AppContainer）為**未實作選項**，需要時另行拍板
## 威脅模型

PAAW 是 localhost 單人工具，防的不是駭客，是兩種情況：

1. **AI 被操縱** — prompt injection（網頁 / 檔案 / issue 內容夾帶指令，讓 AI 執行惡意操作）
2. **AI 出錯** — 自信地跑出毀滅性指令（rm 錯目錄、kill 錯 process）

攻擊鏈永遠是同一條：**寫檔（write_file）→ 執行（bash / npm / 未來某次 build）**

---

## 防線總覽（由外到內）

```
① 最小權限      哪些工具看得到        toolGroups / toolsDeny / CHAT_BLOCKED_TOOLS
② 檔案邊界      哪些路徑寫得到        isPathAllowed（cwd 限制 + WRITE_BLACKLIST）
③ 執行入口攔截  哪些檔案絕不能寫      script-guard A
④ Process 鐵律  哪些 process 碰不得   shell-guard（pkill/killall 擋、PAAW 自身不可啟停）
⑤ 內容掃描      執行前掃 script 內容  script-guard C（bash）+ B（env_exec）
⑥ 人審流程      出了事誰把關          ask_user / QA·RM review / no-push 紀律
⑦ 審計追蹤      事後怎麼查            action log / agent memory / LLM log → ES
```

---

## ① 最小權限（工具層）

- **toolGroups**：每個 crew 只拿需要的工具組
  - coding 系（developer/tester 等）：core-read + write + bash
  - 維運系（ops/helpdesk/qa）：core-read 為主，**沒有 bash**
- **toolsDeny**：firmware 級工具黑名單，`.paaw` 覆蓋不了（module crew 定義）
- **CHAT_BLOCKED_TOOLS**：chat 助理（林雨晴）看不到 bash / write_file / edit_file / git — 她只有 `env_exec` 白名單工具

## ② 檔案邊界（路徑層）

- 寫入只限 **cwd（該 RU 專案目錄）內**，跨目錄要使用者加 workspace
- PAAW 自身的 packages/core/knowledge 目錄有 WRITE_BLACKLIST
- 外部 workspace 掛載為 read-only reference

## ③ 執行入口檔案攔截（script-guard A）

**這些檔案 AI 永遠不可寫** — 因為它們會在「人不在場」時被執行：

| 類型 | 路徑 |
|---|---|
| Git hooks | `.git/hooks/**` |
| Launchd | `~/Library/LaunchAgents/*.plist`、`/Library/LaunchDaemons/**` |
| Crontab | `/etc/crontab` 等 |
| Shell rc | `~/.zshrc`、`~/.zprofile`、`~/.bashrc`、`~/.profile`（限 home） |
| SSH | `~/.ssh/**` |
| 偽裝執行檔 | `node_modules/.bin/**` |
| 自啟動 | `~/.config/autostart/**` |

掛在 `write_file` / `edit_file` handler — 命中即擋，訊息引導 agent 請人工處理。
`package.json` **不在此列**（AI coding 常態需要加 dependency）→ 由 ⑤ 的執行時掃描補防。

## ④ Process 鐵律（shell-guard，2026-09-13 定調）

- `pkill` / `killall` / `taskkill` 一律擋
- `kill` 只放行**本 RU 受控 dev-server pid**
- PAAW coding app 自身（paaw-server / tPAAW vite / port 4097·4098·4100·5173）永遠不可啟停

## ⑤ 內容掃描（script-guard B+C — 2026-10-09 上線）

**該快的全速跑**：正常 AI coding（寫測試腳本、跑 build、乾淨專案 npm install）零摩擦。

### C：bash 執行前掃描（掛在 shell-guard 之後；v2 起語言無關）

觸發點：
- **raw bash 指令本身先掃**（語言無關）— 直接 `curl|x` 下載即執行、`osascript`、外部 URL 組合，不管什麼語言形式
- **直譯器執行檔案**：node / python / ruby / perl / php / lua / deno / bun / tsx / powershell / osascript → 讀檔掃內容
- **shebang 直跑**：`./xxx.sh`、`./xxx.py`（chmod +x 後直接執行）也掃
- **inline code**：`node -e` / `python -c` / `ruby -e` / `php -r` / `powershell -Command` → 掃字串
- **編譯型**：gcc / clang / g++ / go build / cargo build / javac → 編譯前掃 **source 檔**（binary 掃不了，原始碼掃得到）
- `npm run <script>` → 解析 package.json scripts 值掃描（防 AI 先加惡意 script 再跑）

網路 API 偵測跨語言：JS(fetch/axios/node-fetch/got) · Python(requests/urllib/http.client/socket) · Ruby(Net::HTTP/open-uri) · PHP(file_get_contents/curl_init) · PowerShell(Invoke-WebRequest/iwr/irm) · 通用 curl/wgit

危險 pattern（故意粗爆 — injection payload 通常就是這三件套）：

| Pattern | 偵測 |
|---|---|
| 網路外傳 | curl/wget/fetch/http.request + **外部 URL**（localhost 放行） |
| 持久化 | launchd / crontab / git hooks / shell rc / osascript |
| 破壞性 | `rm -rf /`·`~`、killall、pkill、diskutil erase、dd、mkfs |
| 下載即執行 | `curl ... \| sh` 管線 |
| **越權 push** | `git push`（v3 起一律擋 — no-push 紀律技術化，push 是人的動作） |
| **機密路徑** | bash 碰 `~/.ssh` / `data/config/providers.json` / `.env`（v3 起擋 — 防「搬進專案等人 push」的 git 外傳） |

命中 → 擋下 + 引導 agent 用 `ask_user` 向人說明意圖；未命中 → 直接執行。

### B：env_exec（林雨晴專用）補釘

- `npm install / ci / update`：package.json 或 lock 有**未 commit 變更** → 要求先跟使用者確認（npm install 會跑套件 postinstall = 任意代碼）→ 使用者同意後帶 `confirmDirty: true` 才放行
- `npm run`：script 必須已存在於 package.json + 內容掃描同 C

## ⑥ 人審流程

- ask_user：危險操作（⑤ 攔截後）由人決定
- QA / RM reviewer + 決策卡：release 前 review
- **no-push 紀律**：AI commit 不 push，push 是人的動作（bug 流向：公司↔home 分兩邊各自修）

## ⑦ 審計追蹤

- action log（agent 交接簿）+ agent memory — 每 RU 保留
- LLM log / coding actions → Elasticsearch（paaw-agent-logs 索引，Kibana Dashboard「PAAW Agent 執行報表」）
- conversation_history：每個 agent 可查自己 RU 的歷史對話（含工具行為）

---

## 測試與驗證

- 單元測試：`tests/unit/script-guard.test.mjs`（21 cases — 攔截/放行/邊界）
- 整合實測：executeTool 真實路徑 4 案（寫 git hook 攔 / 正常 script 直跑 / 惡意 script 攔 / npm run evil 攔）
- 全套 unit 665 tests + E2E 135 tests 定期跑（`npm test` / `npm run test:e2e`，E2E 走隔離 instance）

---

## 已知限制（誠實講）

1. **掃描式非密不通風** — 混淆過的 payload（base64 編碼、動態組 URL、分段下載）理論上可繞過 pattern；v2 起直譯器/編譯/raw 指令三層都掃（語言無關），但這是縱深防禦不是密不通風 — 殘餘風險靠 ⑥ 人審 + ⑦ 審計兜底
2. **網路 egress 沒擋** — bash 仍可 curl 下載（只有內容掃描事前攔 script 檔；直接 curl 指令靠 shell-guard 不含此項）— 如需更強可上 sandbox-exec / 容器，目前判定過度設計
3. **npx 可跑任意套件** — env_exec 白名單含 npx；供應鏈信任靠 npm registry + lockfile（npm ci）
4. **dev_server / ru_verify 跑的 npm script** 未掛 C 掃描（只跑白名單 action：build/lint/test/dev）— script 值仍可能被改過，靠 ② 路徑限制 + 人審補
5. **MCP 未接入** — 未來接入時規則：只接自己寫的或信任的 MCP server（tool description 是 prompt injection 入口）；能力邊界由 MCP server 定義，PAAW 端用 toolGroups/toolsDeny 控可見性

---

## 擴充原則（未來加防護時）

- 新工具上線 → 檢查：需要 agentId 嗎（executeTool 注入名單）？路徑基底是 RU 還是 PAAW root？
- 新掃描 pattern → 加進 `script-guard.mjs` 共用庫，別散落各 handler
- 判斷準則不變：**擋越權 / 擋捏造證據 = 代碼；教 AI 做事的規則 = 廢話**（重複犯才沉澱條目）
