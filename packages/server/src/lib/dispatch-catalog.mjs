/**
 * dispatch-catalog.mjs — 派工工作目錄（Job Catalog，2026-11-08 Fleming）
 *
 * 定位：EM 自動派工的「工作分類」單一真相來源（server 宣告式 manifest）。
 *   - DispatchWizard popup modal 吃這份 → 動態長場景卡 + 參數表單
 *   - 之後 chat NL 觸發也對照這份 catalog 解析（同一套 job 定義）
 *   - 加新工作（user manual / UI 照相 / vision 檢查…）= 這裡加一個 manifest + server entrypoint，
 *     前端不用改
 *
 * 設計原則（同 auto-dispatch）：
 *   收集用決定性程式，規劃用 LLM。catalog 只描述「工作 + 流程 + 條件」，不含執行邏輯。
 *
 * entrypoint.kind：
 *   "em-job"     → POST /api/coding-crew/em-job {cwd, job, action, maxTickets}
 *   "auto-start" → POST /api/coding-auto-dispatch/start?path=<cwd> {taskId?}（task-driven 閉環）
 *   "dispatch"   → POST /api/coding-crew/dispatch {agentId, task, priority, cwd}（SSE）
 *   "review-run" → POST /api/coding-crew/review-board-run {cwd, ref?, path?}（SSE）
 */

// 👤 直接派工的 agent 選單（static defaults；之後可從 project crew 動態帶入）
export const DIRECT_AGENTS = [
  { id: "coding.developer", label: "💻 Developer 開發" },
  { id: "coding.qa", label: "🧪 QA 品管" },
  { id: "coding.tester", label: "🔬 Tester 測試" },
  { id: "coding.architect", label: "📐 Architect 架構" },
  { id: "coding.helpdesk", label: "🛟 Helpdesk 支援" },
  { id: "coding.doc-writer", label: "📝 Doc-writer 文件" },
  { id: "coding.rm", label: "🎖️ RM Release" },
  { id: "coding.ops", label: "🔧 Ops 維運" },
];

export const DISPATCH_CATALOG = [
  {
    id: "open-tasks",
    emoji: "✅",
    label: "完成 open tasks",
    desc: "把專案 open 的 task 全部做完：掃 TASKS.json → 依 spec/type 派 agent → QA review 開的新單同一輪自動接續（閉環）直到沒新單",
    flow: ["掃 open tasks", "EM 規劃派工", "agent 逐一執行", "QA 開的新單自動接續", "統一完成報告"],
    preconditions: "中斷過的 plan 會優先續跑；失敗的單標 pending 等人處理（不自動重試）",
    entrypoint: { kind: "auto-start", url: "/api/coding-auto-dispatch/start" },
    params: [],
  },
  {
    id: "review-board",
    emoji: "🏛️",
    label: "開 review 委員會",
    desc: "多位 AI 資深 reviewer 各自獨立審最近的變更，互不通氣；程式當仲裁：行號驗證退幻覺、共識併合、分歧標記待人裁。判 critical 自動開修復單",
    flow: ["取最近 N 天變更", "多 model 獨立審查", "程式仲裁（共識/分歧）", "critical 自動開修復單", "報告落檔 .paaw/review-board/"],
    preconditions: "reviewer 名單由 EM 設定 reviewConfig.reviewModels 決定（沒開 multiAgentReview 就單席）",
    entrypoint: { kind: "review-run", url: "/api/coding-crew/review-board-run" },
    params: [
      { id: "days", label: "最近變更天數", type: "number", default: 7, min: 1, max: 90 },
    ],
  },
  {
    id: "security-loop",
    emoji: "🛡️",
    label: "安全閉環",
    desc: "semgrep 安全掃描 → findings 按 severity 分組 → 開修復單（之後可接「完成 open tasks」把修復單做完）",
    flow: ["security 掃描", "findings 全部分組", "LLM triage 開修復單（不設上限）", "（可再觸發 ✅ 完成 open tasks 修復）"],
    preconditions: "掃描結果不存在或 >7 天會自動先開「重掃」單",
    entrypoint: { kind: "em-job", url: "/api/coding-crew/em-job", job: "security-fix" },
    params: [],
  },
  {
    id: "test-gen",
    emoji: "🧪",
    label: "測試補洞",
    desc: "覆蓋率報告找缺口 → 開 test 單給 tester 補測試",
    flow: ["覆蓋率分析", "找缺口", "LLM triage 開 test 單"],
    preconditions: "需要先有覆蓋率報告（沒有會回報原因不硬開單）",
    entrypoint: { kind: "em-job", url: "/api/coding-crew/em-job", job: "test-gen" },
    params: [],
  },
  {
    id: "release-prep",
    emoji: "📦",
    label: "Release 準備",
    desc: "盤點 release 現況 → 依 checklist 開單（build / QA / docs / 打包）",
    flow: ["release 現況盤點", "checklist 開單", "（可再觸發 ✅ 完成 open tasks 跑單）"],
    preconditions: "建議先跑過 CU 掃描讓 feature/API map 新鮮",
    entrypoint: { kind: "em-job", url: "/api/coding-crew/em-job", job: "release-prep" },
    params: [],
  },
  {
    id: "direct",
    emoji: "👤",
    label: "直接派一人",
    desc: "指定一個 agent + 任務描述，直接出工（不經 EM 規劃）",
    flow: ["指定 agent + 任務", "agent 串流執行", "結果見派工報告"],
    preconditions: "",
    entrypoint: { kind: "dispatch", url: "/api/coding-crew/dispatch" },
    params: [
      { id: "agentId", label: "指派 Agent", type: "select", options: DIRECT_AGENTS.map(a => a.id), optionLabels: DIRECT_AGENTS.map(a => a.label), default: "coding.developer" },
      { id: "task", label: "任務描述", type: "textarea", required: true, placeholder: "要 agent 做什麼（越具體越好：改哪個 feature、驗收標準）" },
    ],
  },
];
