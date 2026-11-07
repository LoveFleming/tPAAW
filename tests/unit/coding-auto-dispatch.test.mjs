/**
 * Unit tests — F20261016-030 自動派工執行控制 API（Auto Dispatch HTTP 控制面）
 * Target: packages/server/src/routes/coding-auto-dispatch.mjs
 *
 * 7 端點：start / preview / stop / reset / status / report / last-run
 *
 * 策略（TASK-073 品質補強）：
 *   - 直接呼叫 route 的 default export，注入假的 req/res（沿用本 repo route 測試慣例）
 *   - 真實 fs + tmp 專案目錄（透過 ?path=<tmp> 指定 projRoot）驗證狀態持久化
 *   - 委派層用 vi.mock 隔離：
 *       * auto-dispatch-manager.mjs → runAutoDispatch（start 非同步派工的執行引擎）
 *       * auto-dispatch-shared.mjs  → scanTasksForDispatch（preview 的 task 掃描）
 *     route 用 dynamic `await import()` 載入這兩個模組，vi.mock 對 dynamic import 同樣生效。
 *   - action-log.mjs 用 mock 隔離（last-run 會讀 action log，避免依賴真實 .paaw）
 *
 * 註：本檔只補測試，不改實作。發現的實作缺陷以「expect 描述現況」方式登錄，
 *     不在此修改；若為缺陷會於報告中標明並回報。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Mock 委派層：auto-dispatch-manager.mjs ──
// start 端點在回應後才會 `await import("../lib/auto-dispatch-manager.mjs")` 呼叫 runAutoDispatch。
const mockRunAutoDispatch = vi.fn();
const mockPlanEMSession = vi.fn();
const mockExecuteEMSession = vi.fn();
const mockRunParallelSession = vi.fn();
vi.mock("../../packages/server/src/lib/auto-dispatch-manager.mjs", () => ({
  runAutoDispatch: (...args) => mockRunAutoDispatch(...args),
  planEMSession: (...args) => mockPlanEMSession(...args),
  executeEMSession: (...args) => mockExecuteEMSession(...args),
  runParallelSession: (...args) => mockRunParallelSession(...args),
  a2aCallAgent: vi.fn(),
}));

// ── Mock 委派層：auto-dispatch-shared.mjs ──
// preview 端點 `await import("../lib/auto-dispatch-shared.mjs")` 呼叫 scanTasksForDispatch。
const mockScanTasksForDispatch = vi.fn();
vi.mock("../../packages/server/src/lib/auto-dispatch-shared.mjs", () => ({
  scanTasksForDispatch: (...args) => mockScanTasksForDispatch(...args),
  gatherContext: vi.fn(),
  buildSituationReport: vi.fn(),
}));

// ── Mock action-log.mjs（last-run 會讀 action log）──
const mockListActionLog = vi.fn();
vi.mock("../../packages/server/src/lib/action-log.mjs", () => ({
  listActionLog: (...args) => mockListActionLog(...args),
}));

// ── Mock em-config.mjs（preview 會讀 EM config 的 maxTasks）──
vi.mock("../../packages/server/src/lib/em-config.mjs", () => ({
  readEMConfig: () => ({ taskDecomposition: { maxSubtasks: 100 } }),
}));

// 動態 import 受測路由（在 mocks 之後）
const routeModule = await import("../../packages/server/src/routes/coding-auto-dispatch.mjs");
const codingAutoDispatchRoute = routeModule.default;

// ── 測試替身：假 req/res ──
function fakeReq({ method = "GET", url = "/", body } = {}) {
  const listeners = {};
  const req = {
    method,
    url,
    on(event, cb) {
      (listeners[event] ||= []).push(cb);
      return req;
    },
    // 觸發 data/end（非同步，模擬真實 stream）
    _emit() {
      if (body !== undefined) {
        (listeners["data"] || []).forEach((cb) => cb(Buffer.from(body)));
      }
      (listeners["end"] || []).forEach((cb) => cb());
    },
  };
  // 延後觸發，讓 handler 先註冊 listener
  queueMicrotask(() => req._emit());
  return req;
}

function fakeRes() {
  let resolveFinished;
  const finished = new Promise((r) => { resolveFinished = r; });
  const res = {
    statusCode: null,
    headers: null,
    body: "",
    headersSent: false,
    writeHead(code, headers) {
      res.statusCode = code;
      res.headers = headers;
      res.headersSent = true;
    },
    end(chunk) {
      if (chunk !== undefined) res.body += chunk.toString();
      resolveFinished();
    },
    finished,
  };
  return res;
}

// 呼叫 route 並等「回應已送出」（不等背景 delegate 跑完 — start 是 respond-then-run 設計）
// handler promise 存到 _lastHandler 供 afterEach 等待收尾，避免背景寫檔撞上 rmSync。
let _lastHandler = null;
async function call(method, url, body) {
  const req = fakeReq({ method, url, body: body !== undefined ? JSON.stringify(body) : undefined });
  const res = fakeRes();
  _lastHandler = codingAutoDispatchRoute(req, res).catch(() => {});
  await res.finished;
  return res;
}

function json(res) {
  return JSON.parse(res.body);
}

// projRoot 由 ?path= 指定
function pathUrl(base, root) {
  return `${base}?path=${encodeURIComponent(root)}`;
}

const AUTO_DISPATCH_DIR = ".paaw/auto-dispatch";
const STATUS_FILE = "status.json";

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "adr-unit-"));
  mkdirSync(join(root, AUTO_DISPATCH_DIR), { recursive: true });
  mockRunAutoDispatch.mockReset();
  mockScanTasksForDispatch.mockReset();
  mockListActionLog.mockReset();
  mockListActionLog.mockResolvedValue({ entries: [] });
  // 讓非同步的 runAutoDispatch 預設回一個立即 resolve 的 Promise
  mockRunAutoDispatch.mockResolvedValue({ report: "# report\n" });
});

afterEach(async () => {
  // 等背景 handler 收尾（delegate/狀態寫檔）再刪 tmp，避免 ENOENT 噴進未來的測試
  await _lastHandler;
  rmSync(root, { recursive: true, force: true });
});

function writeStatus(obj) {
  writeFileSync(join(root, AUTO_DISPATCH_DIR, STATUS_FILE), JSON.stringify(obj, null, 2));
}

function readStatus() {
  return JSON.parse(readFileSync(join(root, AUTO_DISPATCH_DIR, STATUS_FILE), "utf-8"));
}

// ============================================================================
// POST /start
// ============================================================================
describe("POST /api/coding-auto-dispatch/start", () => {
  it("happy path — 回 200、ok:true、回報 mode 與 startedAt", async () => {
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    expect(res.statusCode).toBe(200);
    const data = json(res);
    expect(data.ok).toBe(true);
    expect(data.mode).toBe("em");
    expect(typeof data.startedAt).toBe("string");
    expect(data.message).toContain("Night shift started");
  });

  it("happy path — 立即初始化 status.json 為 running", async () => {
    // 回應送出當下 delegate 還在跑 — 卡住它才能觀察到 running 中間態
    // gate 先建好（release 同步賦值），避免 handler 尚未執行到 delegate 時 release 還是 undefined
    let release = () => {};
    const gate = new Promise((r) => { release = r; });
    mockRunAutoDispatch.mockImplementation(() => gate.then(() => ({ report: "x" })));
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    const st = readStatus();
    expect(st.status).toBe("running");
    expect(st.mode).toBe("em");
    expect(st.totalAgents).toBe(0); // em 模式 = 0
    expect(st.completedAgents).toBe(0);
    release();
  });

  it("mode=parallel — totalAgents 設為 6", async () => {
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "parallel" });
    expect(readStatus().totalAgents).toBe(6);
  });

  it("無 body — 預設 mode=em，不報錯", async () => {
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/start", root));
    expect(res.statusCode).toBe(200);
    expect(json(res).mode).toBe("em");
  });

  it("並行防護 — 執行中重複 start 回 409", async () => {
    // 讓首次 runAutoDispatch 卡住不 resolve，維持 _activeRuns 佔用
    let release = () => {};
    const gate = new Promise((r) => { release = r; });
    mockRunAutoDispatch.mockImplementation(() => gate.then(() => ({ report: "x" })));

    const first = await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    expect(first.statusCode).toBe(200);

    const second = await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    expect(second.statusCode).toBe(409);
    expect(json(second).ok).toBe(false);
    expect(json(second).error).toContain("已在執行中");

    release();
    // 等非同步 finally 釋放 guard
    await new Promise((r) => setTimeout(r, 20));
  });

  it("guard 釋放後可再次 start", async () => {
    const r1 = await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    expect(r1.statusCode).toBe(200);
    // 預設 mock 立即 resolve → guard 於 finally 釋放
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    expect(r2.statusCode).toBe(200);
  });

  it("委派層錯誤 — 非同步標 status=failed 且不影響已回 200 的回應", async () => {
    mockRunAutoDispatch.mockRejectedValue(new Error("boom-delegate"));
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    expect(res.statusCode).toBe(200); // 回應先行
    // 等非同步 catch 寫入 failed
    await new Promise((r) => setTimeout(r, 30));
    const st = readStatus();
    expect(st.status).toBe("failed");
    expect(st.error).toContain("boom-delegate");
  });

  it("委派層成功 — 非同步標 status=completed 並寫入 report.md", async () => {
    mockRunAutoDispatch.mockResolvedValue({ report: "# done report" });
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    await new Promise((r) => setTimeout(r, 30));
    expect(readStatus().status).toBe("completed");
    const reportPath = join(root, AUTO_DISPATCH_DIR, "report.md");
    expect(existsSync(reportPath)).toBe(true);
    expect(readFileSync(reportPath, "utf-8")).toContain("done report");
  });

  it("runAutoDispatch 收到 root/mode/model/since 參數", async () => {
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em", model: "gpt-x", since: "2026-01-01" });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockRunAutoDispatch).toHaveBeenCalledTimes(1);
    const arg = mockRunAutoDispatch.mock.calls[0][0];
    expect(arg.rootDir).toBe(root); // route 傳參名為 rootDir（2026-08-29 sendSSE 重構後）
    expect(arg.mode).toBe("em");
    expect(arg.modelOverride).toBe("gpt-x");
    expect(arg.since).toBe("2026-01-01");
  });
});

// ============================================================================
// POST /preview
// ============================================================================
describe("POST /api/coding-auto-dispatch/preview", () => {
  it("happy path — 回 200 且展開 scan 結果（委派層隔離）", async () => {
    mockScanTasksForDispatch.mockReturnValue({
      workList: [{ agent: "developer", task: "執行 TASK-1", priority: "high", sourceRef: "TASK-1" }],
      situationReport: "## report",
      stats: { total: 1, open: 1, pending: 0, close: 0, ignore: 0 },
      excluded: [],
      openCount: 1,
      noWorkReason: "ok",
    });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/preview", root), {});
    expect(res.statusCode).toBe(200);
    const data = json(res);
    expect(data.ok).toBe(true);
    expect(data.workList).toHaveLength(1);
    expect(data.openCount).toBe(1);
    expect(mockScanTasksForDispatch).toHaveBeenCalledTimes(1);
  });

  it("無單 — workList 空並帶 noWorkReason", async () => {
    mockScanTasksForDispatch.mockReturnValue({
      workList: [], situationReport: "no work", stats: {}, excluded: [], openCount: 0,
      noWorkReason: "沒有 open task",
    });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/preview", root), {});
    expect(res.statusCode).toBe(200);
    expect(json(res).workList).toHaveLength(0);
    expect(json(res).noWorkReason).toContain("沒有 open task");
  });

  it("委派層丟錯 — 回 500", async () => {
    mockScanTasksForDispatch.mockImplementation(() => { throw new Error("scan-fail"); });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/preview", root), {});
    expect(res.statusCode).toBe(500);
    expect(json(res).error).toContain("scan-fail");
  });

  it("傳遞 taskId 給委派層", async () => {
    mockScanTasksForDispatch.mockReturnValue({ workList: [], stats: {}, excluded: [], openCount: 0 });
    await call("POST", pathUrl("/api/coding-auto-dispatch/preview", root), { taskId: "TASK-9" });
    expect(mockScanTasksForDispatch).toHaveBeenCalledWith(root, expect.objectContaining({ taskId: "TASK-9" }));
  });
});

// ============================================================================
// POST /stop
// ============================================================================
describe("POST /api/coding-auto-dispatch/stop", () => {
  it("無 status 檔 — 回 ok:false『Not running』", async () => {
    rmSync(join(root, AUTO_DISPATCH_DIR, STATUS_FILE), { force: true });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/stop", root), {});
    expect(res.statusCode).toBe(200);
    expect(json(res).ok).toBe(false);
    expect(json(res).message).toBe("Not running");
  });

  it("status 非 running — 回 ok:false", async () => {
    writeStatus({ status: "completed", mode: "em" });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/stop", root), {});
    expect(res.statusCode).toBe(200);
    expect(json(res).ok).toBe(false);
  });

  it("殭屍 running（無活 dispatch）— stop 直接把狀態標 interrupted", async () => {
    writeStatus({ status: "running", mode: "em", events: [] });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/stop", root), {});
    expect(res.statusCode).toBe(200);
    expect(json(res).ok).toBe(true);
    expect(json(res).message).toContain("Orphaned");
    expect(readStatus().status).toBe("interrupted");
  });
});

// ============================================================================
// POST /reset
// ============================================================================
describe("POST /api/coding-auto-dispatch/reset", () => {
  it("無 status 檔 — 回 ok:true『No status file to reset』", async () => {
    rmSync(join(root, AUTO_DISPATCH_DIR, STATUS_FILE), { force: true });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/reset", root), {});
    expect(res.statusCode).toBe(200);
    expect(json(res).ok).toBe(true);
    expect(json(res).message).toContain("No status file");
  });

  it("happy path — 強制將 running 標為 interrupted 並寫回", async () => {
    writeStatus({ status: "running", mode: "em" });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/reset", root), {});
    expect(res.statusCode).toBe(200);
    expect(json(res).ok).toBe(true);
    expect(json(res).message).toBe("Status reset");
    const st = readStatus();
    expect(st.status).toBe("interrupted");
    expect(st.error).toBe("Manually reset by user");
    expect(typeof st.completedAt).toBe("string");
  });

  it("reset 已完成狀態亦可 — 冪等", async () => {
    writeStatus({ status: "completed", mode: "em" });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/reset", root), {});
    expect(res.statusCode).toBe(200);
    expect(readStatus().status).toBe("interrupted");
  });

  it("status 檔損毀（非法 JSON）— 回 500", async () => {
    writeFileSync(join(root, AUTO_DISPATCH_DIR, STATUS_FILE), "{ not json");
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/reset", root), {});
    expect(res.statusCode).toBe(500);
    expect(json(res).error).toContain("Failed to reset");
  });
});

// ============================================================================
// GET /status
// ============================================================================
describe("GET /api/coding-auto-dispatch/status", () => {
  it("無 status 檔 — 回 status=never", async () => {
    rmSync(join(root, AUTO_DISPATCH_DIR, STATUS_FILE), { force: true });
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/status", root));
    expect(res.statusCode).toBe(200);
    expect(json(res).status).toBe("never");
  });

  it("回傳 status.json 現況", async () => {
    writeStatus({ status: "completed", mode: "parallel", completedAgents: 6 });
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/status", root));
    expect(res.statusCode).toBe(200);
    const data = json(res);
    expect(data.status).toBe("completed");
    expect(data.mode).toBe("parallel");
    expect(data.completedAgents).toBe(6);
  });

  it("孤兒偵測 — running 但無活 dispatch → 自動降為 interrupted", async () => {
    // 本 process 的 _activeRuns 沒有此 root（未 start）→ status 應被修正
    writeStatus({ status: "running", mode: "em", events: [] });
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/status", root));
    expect(res.statusCode).toBe(200);
    expect(json(res).status).toBe("interrupted");
    // 檔案也被寫回修正值（持久化）
    expect(readStatus().status).toBe("interrupted");
  });

  it("status 檔損毀 — 回 status=error（不丟例外）", async () => {
    writeFileSync(join(root, AUTO_DISPATCH_DIR, STATUS_FILE), "{ broken");
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/status", root));
    expect(res.statusCode).toBe(200);
    expect(json(res).status).toBe("error");
  });
});

// ============================================================================
// GET /report
// ============================================================================
describe("GET /api/coding-auto-dispatch/report", () => {
  it("無 report 檔 — 回 { report: '' }", async () => {
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/report", root));
    expect(res.statusCode).toBe(200);
    expect(json(res).report).toBe("");
  });

  it("有 report 檔 — 回 markdown 全文與正確 Content-Type", async () => {
    writeFileSync(join(root, AUTO_DISPATCH_DIR, "report.md"), "# 派工報告\n內容");
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/report", root));
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toContain("text/markdown");
    expect(res.body).toContain("# 派工報告");
    expect(res.body).toContain("內容");
  });
});

// ============================================================================
// GET /last-run
// ============================================================================
describe("GET /api/coding-auto-dispatch/last-run", () => {
  it("無任何紀錄 — hasRun=false、since=今天", async () => {
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/last-run", root));
    expect(res.statusCode).toBe(200);
    const data = json(res);
    expect(data.hasRun).toBe(false);
    expect(data.lastRunAt).toBeNull();
    expect(data.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("有 status（completedAt）— lastRunBy=auto-dispatch、帶 mode", async () => {
    writeStatus({ status: "completed", mode: "em", completedAt: "2026-03-01T10:00:00.000Z", startedAt: "2026-03-01T09:00:00.000Z" });
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/last-run", root));
    const data = json(res);
    expect(data.hasRun).toBe(true);
    expect(data.lastRunBy).toBe("auto-dispatch");
    expect(data.lastRunMode).toBe("em");
    expect(data.since).toBe("2026-03-01");
  });

  it("只有 startedAt（未完成）— 仍視為有 run", async () => {
    writeStatus({ status: "running", mode: "parallel", startedAt: "2026-04-02T08:00:00.000Z" });
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/last-run", root));
    const data = json(res);
    expect(data.hasRun).toBe(true);
    expect(data.lastRunBy).toBe("auto-dispatch");
    expect(data.lastRunMode).toBe("parallel");
  });

  it("有 reports 目錄 — lastRunBy=auto-dispatch-reports（無 status 時靠報告）", async () => {
    mkdirSync(join(root, ".paaw", "auto-dispatch", "reports"), { recursive: true });
    writeFileSync(join(root, ".paaw", "auto-dispatch", "reports", "2026-05-10.md"), "# r");
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/last-run", root));
    const data = json(res);
    expect(data.hasRun).toBe(true);
    expect(data.lastRunBy).toBe("auto-dispatch-reports");
    expect(data.since).toBe("2026-05-10");
  });
});

// ============================================================================
// 邊界／其他
// ============================================================================
describe("coding-auto-dispatch — 邊界與路由匹配", () => {
  it("未知路徑 — 回 false（未處理，交由下一層路由）", async () => {
    const req = fakeReq({ method: "GET", url: pathUrl("/api/coding-auto-dispatch/nope", root) });
    const res = fakeRes();
    const handled = await codingAutoDispatchRoute(req, res);
    expect(handled).toBe(false);
    expect(res.statusCode).toBeNull(); // 未寫回應
  });

  it("錯誤 HTTP method（GET start）— 回 false 未處理", async () => {
    const req = fakeReq({ method: "GET", url: pathUrl("/api/coding-auto-dispatch/start", root) });
    const res = fakeRes();
    const handled = await codingAutoDispatchRoute(req, res);
    expect(handled).toBe(false);
  });

  it("無 ?path 參數 — 退回 PAAW_ROOT（不丟例外，仍回 200）", async () => {
    const res = await call("GET", "/api/coding-auto-dispatch/status");
    expect(res.statusCode).toBe(200);
    // PAAW_ROOT 專案本身可能有 status；重點是不丟例外且為合法 JSON
    expect(() => json(res)).not.toThrow();
  });
});
