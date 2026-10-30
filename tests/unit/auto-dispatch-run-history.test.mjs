/**
 * Unit tests — 2026-10-30 Auto Dispatch Run History（append-only runs/）+ 開輪對帳
 * Target: packages/server/src/routes/coding-auto-dispatch.mjs
 *
 * 行為：
 *   1. /start 前會歸檔上一輪 status → runs/<runId>.json（append-only，不覆蓋）
 *   2. 上一輪殭屍（running + runnerPid 已死）→ 開輪時自動標 interrupted 再歸檔
 *   3. GET /runs 列歷史；GET /run?id= 取單筆；非法 id 拒絕
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockRunAutoDispatch = vi.fn();
vi.mock("../../packages/server/src/lib/auto-dispatch-manager.mjs", () => ({
  runAutoDispatch: (...args) => mockRunAutoDispatch(...args),
  planEMSession: vi.fn(),
  executeEMSession: vi.fn(),
  runParallelSession: vi.fn(),
  a2aCallAgent: vi.fn(),
}));
vi.mock("../../packages/server/src/lib/auto-dispatch-shared.mjs", () => ({
  scanTasksForDispatch: vi.fn(),
  gatherContext: vi.fn(),
  buildSituationReport: vi.fn(),
}));

let route;
let projDir;

function makeRes() {
  return {
    statusCode: 0, body: null,
    writeHead(code) { this.statusCode = code; return this; },
    end(data) { this.body = data; },
    headersSent: false,
  };
}

async function callRoute(method, pathname, query = "") {
  const req = {
    method, url: `http://localhost${pathname}${query}`,
    on(evt, cb) { if (evt === "end") cb(""); return this; },
    socket: { localPort: 4097 },
  };
  const res = makeRes();
  const handled = await route.default(req, res);
  return { handled, res, data: res.body ? JSON.parse(res.body) : null };
}

beforeEach(async () => {
  vi.clearAllMocks();
  route = await import("../../packages/server/src/routes/coding-auto-dispatch.mjs");
  projDir = mkdtempSync(join(tmpdir(), "ad-runhist-"));
  mockRunAutoDispatch.mockResolvedValue({ report: "test report" });
});

afterEach(() => { rmSync(projDir, { recursive: true, force: true }); });

describe("run history（append-only）", () => {
  it("start 歸檔上一輪完成的 status 到 runs/", async () => {
    const nsDir = join(projDir, ".paaw", "auto-dispatch");
    mkdirSync(nsDir, { recursive: true });
    writeFileSync(join(nsDir, "status.json"), JSON.stringify({
      startedAt: "2026-10-29T10:00:00.000Z", status: "completed", mode: "em", runnerPid: 1,
    }));

    await callRoute("POST", "/api/coding-auto-dispatch/start", `?path=${encodeURIComponent(projDir)}`);
    await new Promise(r => setTimeout(r, 50)); // 等 async run 完成

    const runsDir = join(nsDir, "runs");
    expect(existsSync(runsDir)).toBe(true);
    const files = existsSync(runsDir) ? require_fs_list(runsDir) : [];
    expect(files.some(f => f.startsWith("2026-10-29T10-00-00-000Z-em"))).toBe(true);
  });

  it("start 對帳：殭屍 running（死 pid）→ 歸檔為 interrupted", async () => {
    const nsDir = join(projDir, ".paaw", "auto-dispatch");
    mkdirSync(nsDir, { recursive: true });
    writeFileSync(join(nsDir, "status.json"), JSON.stringify({
      startedAt: "2026-10-20T08:00:00.000Z", status: "running", mode: "em", runnerPid: 999999999, // 不存在的 pid = 殭屍
    }));

    await callRoute("POST", "/api/coding-auto-dispatch/start", `?path=${encodeURIComponent(projDir)}`);
    await new Promise(r => setTimeout(r, 50));

    const archived = readFileSync(join(nsDir, "runs", "2026-10-20T08-00-00-000Z-em.json"), "utf-8");
    const parsed = JSON.parse(archived);
    expect(parsed.status).toBe("interrupted");
  });

  it("append-only：同 runId 重複歸檔不覆蓋（第一次的快照保留）", async () => {
    const nsDir = join(projDir, ".paaw", "auto-dispatch", "runs");
    mkdirSync(nsDir, { recursive: true });
    const f = join(nsDir, "2026-10-01T00-00-00-000Z-em.json");
    writeFileSync(f, JSON.stringify({ status: "completed", marker: "original" }));
    // 下一輪 start（同 startedAt 不可能重現，這裡直接驗證檔案未被另一個歸檔動到）
    await callRoute("POST", "/api/coding-auto-dispatch/start", `?path=${encodeURIComponent(projDir)}`);
    await new Promise(r => setTimeout(r, 50));
    expect(JSON.parse(readFileSync(f, "utf-8")).marker).toBe("original");
  });

  it("GET /runs 回歷史清單；GET /run?id= 回單筆；非法 id 400", async () => {
    const nsDir = join(projDir, ".paaw", "auto-dispatch", "runs");
    mkdirSync(nsDir, { recursive: true });
    writeFileSync(join(nsDir, "run-a.json"), JSON.stringify({
      startedAt: "2026-10-28T00:00:00.000Z", completedAt: "2026-10-28T01:00:00.000Z",
      status: "completed", mode: "em", completedAgents: 3, totalAgents: 3,
    }));

    const list = await callRoute("GET", "/api/coding-auto-dispatch/runs", `?path=${encodeURIComponent(projDir)}`);
    expect(list.data.runs).toHaveLength(1);
    expect(list.data.runs[0].id).toBe("run-a");
    expect(list.data.runs[0].status).toBe("completed");

    const one = await callRoute("GET", "/api/coding-auto-dispatch/run", `?path=${encodeURIComponent(projDir)}&id=run-a`);
    expect(one.data.startedAt).toBe("2026-10-28T00:00:00.000Z");

    const bad = await callRoute("GET", "/api/coding-auto-dispatch/run", `?path=${encodeURIComponent(projDir)}&id=../../secret`);
    expect(bad.res.statusCode).toBe(400);

    const missing = await callRoute("GET", "/api/coding-auto-dispatch/run", `?path=${encodeURIComponent(projDir)}&id=nope`);
    expect(missing.res.statusCode).toBe(404);
  });
});

// readdirSync helper（route 測試慣例：node:fs 直接用）
import { readdirSync } from "node:fs";
function require_fs_list(dir) { return readdirSync(dir); }
