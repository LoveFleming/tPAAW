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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
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
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}path=${encodeURIComponent(root)}`;
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
// TASK-059（2026-11-07）補強：Run History / 對帳歸檔 / interrupted 契約 / 活 runnerPid / body.cwd
// 依 QA 報告 qr-20261107-115922-az6g：L1（/runs /run 零測試）、M3/M1（interrupted 覆寫契約）、
// D2（runnerPid 活 pid 分支）、L2（preview body.cwd）、M4（歸檔路徑）。
// ============================================================================
describe("GET /api/coding-auto-dispatch/runs 與 /run — run history 查詢", () => {
  function writeRun(id, obj) {
    mkdirSync(join(root, AUTO_DISPATCH_DIR, "runs"), { recursive: true });
    writeFileSync(join(root, AUTO_DISPATCH_DIR, "runs", `${id}.json`), JSON.stringify(obj, null, 2));
  }

  it("無 runs 目錄 — 回空清單", async () => {
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/runs", root));
    expect(res.statusCode).toBe(200);
    expect(json(res).runs).toEqual([]);
  });

  it("列出 runs — 每筆帶 id/status/mode 摘要欄位", async () => {
    writeRun("2026-06-01T10-00-00-000Z-em", { startedAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-01T11:00:00.000Z", status: "completed", mode: "em", completedAgents: 3, totalAgents: 0 });
    writeRun("2026-06-02T10-00-00-000Z-parallel", { startedAt: "2026-06-02T10:00:00.000Z", completedAt: "2026-06-02T12:00:00.000Z", status: "failed", mode: "parallel", completedAgents: 1, totalAgents: 6, error: "boom" });
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/runs", root));
    expect(res.statusCode).toBe(200);
    const runs = json(res).runs;
    expect(runs).toHaveLength(2);
    // 檔名倒序（新→舊）
    expect(runs[0].id).toBe("2026-06-02T10-00-00-000Z-parallel");
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toBe("boom");
    expect(runs[1].id).toBe("2026-06-01T10-00-00-000Z-em");
    expect(runs[1].completedAgents).toBe(3);
  });

  it("runs 目錄有壞 JSON — 該筆被過濾不影響其他", async () => {
    writeRun("good-1", { startedAt: "2026-06-01T10:00:00.000Z", status: "completed", mode: "em" });
    writeFileSync(join(root, AUTO_DISPATCH_DIR, "runs", "bad.json"), "{ not json");
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/runs", root));
    expect(res.statusCode).toBe(200);
    expect(json(res).runs).toHaveLength(1);
    expect(json(res).runs[0].id).toBe("good-1");
  });

  it("GET /run — 非法 id（路徑字元）回 400", async () => {
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/run?id=../evil", root));
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toBe("Invalid run id");
  });

  it("GET /run — 不存在的 id 回 404", async () => {
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/run?id=nope-1", root));
    expect(res.statusCode).toBe(404);
    expect(json(res).error).toBe("Run not found");
  });

  it("GET /run — 回完整 run 快照", async () => {
    writeRun("run-x", { startedAt: "2026-06-01T10:00:00.000Z", status: "interrupted", mode: "em", events: [{ type: "info" }] });
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/run?id=run-x", root));
    expect(res.statusCode).toBe(200);
    expect(json(res).status).toBe("interrupted");
    expect(json(res).events).toHaveLength(1);
  });

  it("L1 現況釘樁 — reset 後 status=interrupted 但 runs/ 快照不變（兩處 view 可能矛盾，QA L1）", async () => {
    writeRun("r-live", { startedAt: "2026-06-01T10:00:00.000Z", status: "running", mode: "em" });
    writeStatus({ status: "running", mode: "em" });
    await call("POST", pathUrl("/api/coding-auto-dispatch/reset", root), {});
    expect(readStatus().status).toBe("interrupted");
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/run?id=r-live", root));
    expect(json(res).status).toBe("running"); // append-only：歷史快照不隨 reset 改
  });
});

describe("start 的殭屍對帳與歸檔（_reconcileAndArchivePrevious / _archiveRun）", () => {
  const DEAD_PID = 2147483647; // 超出 pid 範圍 → ESRCH，保證不活
  function runsDir() { return join(root, AUTO_DISPATCH_DIR, "runs"); }
  function listRuns() {
    return readdirSync(runsDir()).filter(f => f.endsWith(".json"));
  }

  it("上一輪殭屍 running（runnerPid 已死）— 開新輪前標 interrupted 並歸檔", async () => {
    writeStatus({ status: "running", mode: "em", runnerPid: DEAD_PID, startedAt: "2026-06-01T09:00:00.000Z" });
    let release = () => {};
    const gate = new Promise((r) => { release = r; });
    mockRunAutoDispatch.mockImplementation(() => gate.then(() => ({ report: "x" })));
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    expect(res.statusCode).toBe(200);
    // 舊輪已歸檔為 interrupted
    const files = listRuns();
    expect(files).toHaveLength(1);
    const archived = JSON.parse(readFileSync(join(runsDir(), files[0]), "utf-8"));
    expect(archived.status).toBe("interrupted");
    expect(archived.error).toContain("no longer alive");
    // status.json 是新輪的 running（非殭屍殘留）
    const st = readStatus();
    expect(st.status).toBe("running");
    expect(st.startedAt).not.toBe("2026-06-01T09:00:00.000Z");
    release();
  });

  it("上一輪正常結束（completed）— 直接歸檔不改狀態", async () => {
    writeStatus({ status: "completed", mode: "parallel", startedAt: "2026-06-01T09:00:00.000Z", runnerPid: process.pid });
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    await new Promise((r) => setTimeout(r, 30));
    const files = listRuns();
    // 至少兩份：上一輪 completed 快照 + 本輪 completed 快照
    const statuses = files.map(f => JSON.parse(readFileSync(join(runsDir(), f), "utf-8")).status);
    expect(statuses).toContain("completed");
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it("委派層成功 — final 完成態快照落地 runs/（append-only）", async () => {
    mockRunAutoDispatch.mockResolvedValue({ report: "# ok" });
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    await new Promise((r) => setTimeout(r, 30));
    expect(readStatus().status).toBe("completed");
    const files = listRuns();
    expect(files.length).toBeGreaterThanOrEqual(1);
    const snap = JSON.parse(readFileSync(join(runsDir(), files[0]), "utf-8"));
    expect(snap.status).toBe("completed");
    expect(snap.archivedAt).toBeTruthy();
  });

  it("委派層失敗 — failed 快照落地 runs/", async () => {
    mockRunAutoDispatch.mockRejectedValue(new Error("kaboom"));
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    await new Promise((r) => setTimeout(r, 30));
    expect(readStatus().status).toBe("failed");
    const files = listRuns();
    const snap = JSON.parse(readFileSync(join(runsDir(), files[0]), "utf-8"));
    expect(snap.status).toBe("failed");
    expect(snap.error).toContain("kaboom");
  });

  it("interrupted 契約（QA M3）— reset 後委派層完成，final 更新被跳過，狀態保持 interrupted", async () => {
    let release = () => {};
    const gate = new Promise((r) => { release = r; });
    mockRunAutoDispatch.mockImplementation(() => gate.then(() => ({ report: "# late" })));
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    // 派工進行中使用者 reset → interrupted
    await call("POST", pathUrl("/api/coding-auto-dispatch/reset", root), {});
    expect(readStatus().status).toBe("interrupted");
    release();
    await new Promise((r) => setTimeout(r, 30));
    // 委派層「完成」不可覆寫使用者的 reset（updateStatusFile L50 契約）
    expect(readStatus().status).toBe("interrupted");
  });

  it("M4 現況釘樁 — final 歸檔在 mutator 內：interrupted skip 時完成態快照不落地", async () => {
    let release = () => {};
    const gate = new Promise((r) => { release = r; });
    mockRunAutoDispatch.mockImplementation(() => gate.then(() => ({ report: "# late" })));
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    await call("POST", pathUrl("/api/coding-auto-dispatch/reset", root), {});
    release();
    await new Promise((r) => setTimeout(r, 30));
    // 歸檔在 mutator 內 → 被 interrupted skip 一併吞掉（QA M4：完成態快照永久丟失）
    const files = existsSync(runsDir()) ? listRuns() : [];
    expect(files).toHaveLength(0);
  });

  it("sendSSE 事件寫入 events ring buffer 並截斷至 80 筆", async () => {
    let release = () => {};
    const gate = new Promise((r) => { release = r; });
    mockRunAutoDispatch.mockImplementation(async (opts) => {
      for (let i = 0; i < 90; i++) opts.sendSSE("info", `event-${i}`);
      await gate;
      return { report: "# r" };
    });
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    await new Promise((r) => setTimeout(r, 30)); // start 是 respond-then-run — 等 sendSSE 事件落盤再讀
    const st = readStatus();
    expect(st.status).toBe("running");
    expect(st.events.length).toBe(80);
    expect(st.events[st.events.length - 1].message).toBe("event-89");
    expect(st.lastEvent.message).toBe("event-89");
    release();
  });

  it("task_done 事件更新 agents map 與 completedAgents", async () => {
    let release = () => {};
    const gate = new Promise((r) => { release = r; });
    mockRunAutoDispatch.mockImplementation(async (opts) => {
      opts.sendSSE("task_start", { index: 1, total: 2, agent: "developer", message: "go" });
      opts.sendSSE("task_done", { index: 1, total: 2, agent: "developer", preview: "done-1" });
      await gate;
      return { report: "# r" };
    });
    await call("POST", pathUrl("/api/coding-auto-dispatch/start", root), { mode: "em" });
    await new Promise((r) => setTimeout(r, 30)); // 等 sendSSE 事件落盤
    const st = readStatus();
    expect(st.agents["developer"].status).toBe("completed");
    expect(st.agents["developer"].report).toBe("done-1");
    expect(st.completedAgents).toBe(1);
    release();
  });
});

describe("runnerPid 活 pid 分支（QA D2 — 2026-10-17 修復熱區的回歸保護）", () => {
  it("stop — runnerPid 為本 process（活）→ 走 stopRequested 路徑而非殭屍路徑", async () => {
    writeStatus({ status: "running", mode: "em", runnerPid: process.pid, events: [] });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/stop", root), {});
    expect(res.statusCode).toBe(200);
    expect(json(res).ok).toBe(true);
    expect(json(res).message).toContain("Interrupt requested");
    const st = readStatus();
    expect(st.status).toBe("running");
    expect(st.stopRequested).toBe(true);
  });

  it("status — runnerPid 為本 process（活）且 running → 不誤觸發孤兒偵測", async () => {
    writeStatus({ status: "running", mode: "em", runnerPid: process.pid });
    const res = await call("GET", pathUrl("/api/coding-auto-dispatch/status", root));
    expect(res.statusCode).toBe(200);
    expect(json(res).status).toBe("running"); // 不可被降級為 interrupted
    expect(readStatus().status).toBe("running");
  });

  // DEFECT（2026-11-07）：stop 端點的救援分支（route L346-351「status 拉回 running」）是 dead code —
  // updateStatusFile 開頭的 `if (current.status === "interrupted") return null` 守衛在 mutator 之前
  // 就短路，導致 status=interrupted（即使 runner 還活著）時 stop 只回 "Not running"，無法下停。
  // 此測試釘住「現況行為」；developer 修復（例：守衛放行 runner 活著的 interrupted）後應改回期望 ok:true。
  it("DEFECT-STOP-INTERRUPTED：status=interrupted 且 runner 活著 → stop 目前回 Not running（救援分支被守衛短路）", async () => {
    writeStatus({ status: "interrupted", mode: "em", runnerPid: process.pid, events: [] });
    const res = await call("POST", pathUrl("/api/coding-auto-dispatch/stop", root), {});
    expect(res.statusCode).toBe(200);
    expect(json(res).ok).toBe(false);
    expect(json(res).message).toBe("Not running");
    const st = readStatus();
    expect(st.status).toBe("interrupted"); // 未被拉回 running
    expect(st.stopRequested).toBeUndefined();
  });
});

describe("preview 的 root 解析（QA L2 — body.cwd 分支）", () => {
  it("無 ?path 但 body.cwd 指定 → 掃描以 cwd 為 root", async () => {
    mockScanTasksForDispatch.mockReturnValue({ workList: [], stats: {}, excluded: [], openCount: 0 });
    const res = await call("POST", "/api/coding-auto-dispatch/preview", { cwd: root });
    expect(res.statusCode).toBe(200);
    expect(mockScanTasksForDispatch).toHaveBeenCalledWith(root, expect.anything());
  });

  it("?path 優先於 body.cwd", async () => {
    mockScanTasksForDispatch.mockReturnValue({ workList: [], stats: {}, excluded: [], openCount: 0 });
    const other = mkdtempSync(join(tmpdir(), "adr-alt-"));
    try {
      await call("POST", pathUrl("/api/coding-auto-dispatch/preview", other), { cwd: root });
      expect(mockScanTasksForDispatch).toHaveBeenCalledWith(other, expect.anything());
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
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
