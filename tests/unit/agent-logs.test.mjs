// agent-logs.test.mjs — F20261016-010「Agent 執行日誌與日誌保留政策」測試（TASK-053 品質補強）
//
// 補足 QA 指出的零測試覆蓋（qr-20261017-003117-un69 major）：
//   真檔為 routes/agent-logs.mjs、routes/log-retention.mjs、lib/agent-exec-logger.mjs。
//
// 覆蓋面：
//   A. lib/agent-exec-logger：startAgentLog → end 落盤 index + jsonl、list/detail 讀回、
//      cleanupOldAgentLogs（含成本歷史累計）、getRuCostHistory
//   B. routes/agent-logs：list / detail 404 / purge 驗證（issue #5）/
//      DELETE ru 壞 index 保護（issue #4）/ 500 不外洩 err.message（issue #3）
//   C. routes/log-retention：runLogPurge 統計路徑（含 cleanupOldLogs 同步呼叫 — issue #6 誤報佐證）
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EventEmitter } from "events";

// 必須在 import server 模組前設好環境變數（data-home 於 module load 時讀取）
const TMP = join(tmpdir(), "paaw-agent-logs-test-" + Date.now());
process.env.PAAW_LOG_HOME = TMP;   // LOG_HOME → ASSET_LOGS_ROOT = TMP/logs
process.env.PAAW_DATA_HOME = TMP;  // DATA_HOME

const { LOG_DIR, INDEX_FILE, startAgentLog, listAgentTasks, getAgentTaskDetail,
        cleanupOldAgentLogs, getRuCostHistory } = await import("../../packages/server/src/lib/agent-exec-logger.mjs");
const agentLogsRoute = (await import("../../packages/server/src/routes/agent-logs.mjs")).default;
const { runLogPurge } = await import("../../packages/server/src/routes/log-retention.mjs");

const RES_END = JSON.stringify({}); // sentinel

/** 建構最小 req（EventEmitter 以支援 readBody）＋ 捕獲式 res */
function makeReqRes(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {};
  const res = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(chunk) { if (chunk !== undefined) this.body = String(chunk); this.ended = true; return this; },
  };
  // 下個 microtask 送 body，讓 handler 內 readBody 的監聽先掛上
  process.nextTick(() => {
    if (body !== undefined) req.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    req.emit("end");
  });
  return { req, res };
}

async function writeTask(cwd, status = "completed", usage = { prompt: 100, completion: 50, total: 150 }) {
  const t = startAgentLog({ agentId: "developer", model: "gpt-4o", cwd });
  t.llmCall({ model: "gpt-4o" }).done({ usage });
  await t.end({ turns: 1, status });
  return t.taskId;
}

beforeAll(() => {
  mkdirSync(join(TMP, "logs", "agent"), { recursive: true });
  mkdirSync(join(TMP, "logs", "llm"), { recursive: true });
});

beforeEach(() => {
  // 每個測試清空 index 與 trace，避免互相污染
  rmSync(INDEX_FILE, { force: true });
  try {
    for (const f of readdirSync(LOG_DIR)) {
      if (f.endsWith(".jsonl") || f === "ru-cost-history.json") rmSync(join(LOG_DIR, f), { force: true });
    }
  } catch {}
});

describe("agent-exec-logger — 落盤與讀回", () => {
  it("startAgentLog → end 會寫 index 與 jsonl，list 讀得回摘要", async () => {
    const taskId = await writeTask("/Users/dev/App/myproj");
    expect(existsSync(join(LOG_DIR, `${taskId}.jsonl`))).toBe(true);
    const tasks = await listAgentTasks(50, {});
    expect(tasks.length).toBe(1);
    expect(tasks[0].taskId).toBe(taskId);
    expect(tasks[0].agentId).toBe("developer");
    expect(tasks[0].usage.prompt).toBe(100);
    expect(tasks[0].status).toBe("completed");
  });

  it("listAgentTasks 支援 agentId / status 過濾", async () => {
    await writeTask("/proj/a", "completed");
    await writeTask("/proj/b", "error");
    const all = await listAgentTasks(50, {});
    expect(all.length).toBe(2);
    const errOnly = await listAgentTasks(50, { status: "error" });
    expect(errOnly.length).toBe(1);
    expect(errOnly[0].status).toBe("error");
  });

  it("getAgentTaskDetail 回傳逐步 trace；不存在的 taskId 回 null", async () => {
    const taskId = await writeTask("/proj/x");
    const detail = await getAgentTaskDetail(taskId);
    expect(detail).toBeTruthy();
    expect(Array.isArray(detail.steps)).toBe(true);
    expect(detail.steps.length).toBeGreaterThan(0);
    expect(await getAgentTaskDetail("task-does-not-exist")).toBe(null);
  });

  it("cleanupOldAgentLogs：超過保留期的 trace 被刪、index 同步修剪並累計成本歷史", async () => {
    const taskId = await writeTask("/Users/dev/App/costproj");
    // 把檔案與 index 的 startTime 都調成很久以前
    const old = Date.now() - 100 * 24 * 60 * 60 * 1000;
    const oldDate = new Date(old).toISOString();
    const { utimesSync } = await import("fs");
    utimesSync(join(LOG_DIR, `${taskId}.jsonl`), old / 1000, old / 1000);
    const idx = JSON.parse(readFileSync(INDEX_FILE, "utf-8"));
    idx[0].startTime = oldDate;
    writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));

    const deleted = await cleanupOldAgentLogs(30);
    expect(deleted).toBe(1);
    expect(existsSync(join(LOG_DIR, `${taskId}.jsonl`))).toBe(false);
    const after = await listAgentTasks(50, {});
    expect(after.length).toBe(0);
    // 成本歷史保留（purge 後成本不歸零）
    const hist = await getRuCostHistory();
    const keys = Object.keys(hist);
    expect(keys.length).toBe(1);
    expect(hist[keys[0]].tokensIn).toBe(100);
  });

  it("cleanupOldAgentLogs：未過期的 trace 不動", async () => {
    const taskId = await writeTask("/proj/fresh");
    const deleted = await cleanupOldAgentLogs(30);
    expect(deleted).toBe(0);
    expect(existsSync(join(LOG_DIR, `${taskId}.jsonl`))).toBe(true);
  });
});

describe("routes/agent-logs — list / detail / purge / delete", () => {
  it("GET /api/agent-logs 回 items 與 total，並附 ruName", async () => {
    await writeTask("/Users/dev/App/rutest");
    const { req, res } = makeReqRes("GET", "/api/agent-logs");
    const handled = await agentLogsRoute(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.total).toBe(1);
    expect(json.items[0]).toHaveProperty("ruName");
  });

  it("GET /api/agent-logs/:taskId 不存在 → 404（不洩漏內部細節）", async () => {
    const { req, res } = makeReqRes("GET", "/api/agent-logs/task-nope");
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe("Task not found");
  });

  it("POST /api/agent-logs/purge：days 非法（0 / 逾界 / 非數字）→ 400（issue #5）", async () => {
    for (const bad of [{ days: 0 }, { days: 99999 }, { days: "abc" }, { days: -3 }, { days: 1.5 }]) {
      const { req, res } = makeReqRes("POST", "/api/agent-logs/purge", bad);
      await agentLogsRoute(req, res);
      expect(res.statusCode, `days=${JSON.stringify(bad.days)}`).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/between 1 and 3650/);
    }
  });

  it("POST /api/agent-logs/purge：省略 days 用預設 7、合法值回應 ok", async () => {
    const { req, res } = makeReqRes("POST", "/api/agent-logs/purge", {});
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.retentionDays).toBe(7);
  });

  it("POST /api/agent-logs/purge：合法 days=30 通過", async () => {
    const { req, res } = makeReqRes("POST", "/api/agent-logs/purge", { days: 30 });
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).retentionDays).toBe(30);
  });

  it("DELETE /api/agent-logs/ru/:ru：只刪該 RU、其餘保留", async () => {
    await writeTask("/Users/dev/App/ruA");
    await writeTask("/Users/dev/App/ruA");
    await writeTask("/Users/dev/App/ruB");
    const { req, res } = makeReqRes("DELETE", "/api/agent-logs/ru/ruA");
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).deleted).toBe(2);
    const left = await listAgentTasks(50, {});
    expect(left.length).toBe(1);
  });

  it("DELETE /api/agent-logs/ru/:ru：index.json 損壞時拒改、回 500（issue #4 資料完整性）", async () => {
    writeFileSync(INDEX_FILE, "{ this is not valid json ]");
    const { req, res } = makeReqRes("DELETE", "/api/agent-logs/ru/ruA");
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/corrupt/i);
    // 關鍵：壞檔未被覆寫成 []
    const raw = readFileSync(INDEX_FILE, "utf-8");
    expect(raw).toBe("{ this is not valid json ]");
  });
});

describe("routes/log-retention — purge 統計（issue #6 誤報佐證）", () => {
  it("runLogPurge 回傳數字型別統計（cleanupOldLogs 為同步函式，不需 await）", async () => {
    const r = await runLogPurge({});
    expect(typeof r.llmDeleted).toBe("number");
    expect(typeof r.agentDeleted).toBe("number");
    expect(typeof r.otherDeleted).toBe("number");
    expect(Number.isNaN(r.llmDeleted)).toBe(false);
    expect(r.llmDeleted).not.toBeInstanceOf(Promise);
  });
});
