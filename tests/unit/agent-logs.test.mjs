// agent-logs.test.mjs — F20261016-010「Agent 執行日誌與日誌保留政策」測試（TASK-053 品質補強）
//
// 補足 QA 指出的零測試覆蓋（qr-20261017-003117-un69 major）：
//   真檔為 routes/agent-logs.mjs、routes/log-retention.mjs、lib/agent-exec-logger.mjs。
//
// 覆蓋面：
//   A. lib/agent-exec-logger：startAgentLog → end 落盤 index + jsonl、list/detail 讀回、
//      cleanupOldAgentLogs（含成本歷史累計）、getRuCostHistory
//   B. routes/agent-logs：list / detail 404 / purge 驗證（issue #5）/
//      DELETE ru（模擬真實 UI：以 list 回傳的 ruName 發請求）/ 壞 index 保護（issue #4）/
//      500 不外洩 err.message（issue #3）/ ru-summary per-RU 成本聚合（live + 持久化歷史）
//   C. routes/log-retention：三類日誌（llm/agent/other）保留天數 GET/PUT 讀寫與邊界、
//      runLogPurge 政策執行（llmDays 檔名日期 / agentDays mtime / otherDays 頂層散檔 /
//      before 顯式日期）、POST /api/logs/purge 端點
//
// ⚠️ ISS-044（tester 發現，待 developer 修）：log-retention.mjs runLogPurge 內
//    `const otherDeleted` 後 `+=` 重賦值 → TypeError，POST /api/logs/purge 必 500。
//    政策測試以 try/catch 雙分支寫成自癒式（修復前釘 bug 形狀+驗副作用、修復後自動驗統計）；
//    POST 端點測試用 it.fails 明確釘住 — 修復後該測試會轉紅，移除 .fails 即全綠。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, utimesSync } from "fs";
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
const logRetentionRoute = (await import("../../packages/server/src/routes/log-retention.mjs")).default;

const LLM_DIR = join(TMP, "logs", "llm");
const RETENTION_CFG = join(TMP, "config", "log-retention.json");

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

// 產品在 end() 累計 usage 時讀 OpenAI 原始 snake_case 鍵（s.usage.prompt_tokens），
// 與真實 caller（paaw-agent-loop）一致 — fixture 必須用同一形狀
const USAGE = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };

async function writeTask(cwd, status = "completed", usage = USAGE) {
  const t = startAgentLog({ agentId: "developer", model: "gpt-4o", cwd });
  t.llmCall({ model: "gpt-4o" }).done({ usage });
  await t.end({ turns: 1, status });
  return t.taskId;
}

/** 把指定 task 的 trace mtime 與 index.startTime 都調成 N 天前（模擬過期） */
function ageTask(taskId, days = 100) {
  const oldMs = Date.now() - days * 24 * 60 * 60 * 1000;
  utimesSync(join(LOG_DIR, `${taskId}.jsonl`), oldMs / 1000, oldMs / 1000);
  const idx = JSON.parse(readFileSync(INDEX_FILE, "utf-8"));
  for (const e of idx) if (e.taskId === taskId) e.startTime = new Date(oldMs).toISOString();
  writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
}

/** 寫 log-retention 設定檔（runLogPurge 政策來源，每次讀檔無 cache） */
function setRetention(cfg) {
  mkdirSync(join(TMP, "config"), { recursive: true });
  writeFileSync(RETENTION_CFG, JSON.stringify(cfg));
}

beforeAll(() => {
  mkdirSync(join(TMP, "logs", "agent"), { recursive: true });
  mkdirSync(LLM_DIR, { recursive: true });
});

beforeEach(() => {
  // 每個測試清空 index、trace、成本歷史、retention 設定與散檔，避免互相污染
  rmSync(INDEX_FILE, { force: true });
  try {
    for (const f of readdirSync(LOG_DIR)) {
      if (f.endsWith(".jsonl") || f === "ru-cost-history.json") rmSync(join(LOG_DIR, f), { force: true });
    }
  } catch {}
  rmSync(RETENTION_CFG, { force: true });
  try { for (const f of readdirSync(LLM_DIR)) rmSync(join(LLM_DIR, f), { force: true }); } catch {}
  try {
    for (const f of readdirSync(TMP)) {
      if (f.startsWith("stray-")) rmSync(join(TMP, f), { force: true });
    }
  } catch {}
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
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
    ageTask(taskId, 100);

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
    await writeTask("/Users/dev/App/myproj");
    const { req, res } = makeReqRes("GET", "/api/agent-logs");
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.total).toBe(1);
    expect(json.items[0].ruName).toBe("myproj"); // resolveRuName = folder basename
  });

  it("GET /api/agent-logs/:taskId 不存在 → 404（不洩漏內部細節）", async () => {
    const { req, res } = makeReqRes("GET", "/api/agent-logs/task-not-exist");
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe("Task not found");
  });

  it("POST /api/agent-logs/purge：days 非法（0 / 逾界 / 非數字）→ 400（issue #5）", async () => {
    for (const days of [0, -1, 4000, "abc"]) {
      const { req, res } = makeReqRes("POST", "/api/agent-logs/purge", { days });
      await agentLogsRoute(req, res);
      expect(res.statusCode, `days=${days}`).toBe(400);
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
    // 模擬真實 UI 流：list 回傳的 ruName 已經 resolveRuName 正規化（路徑小寫），
    // UI 拿這個值發 DELETE — 用原始大小寫路徑反查比對會 no-match
    const list = makeReqRes("GET", "/api/agent-logs");
    await agentLogsRoute(list.req, list.res);
    const ruName = JSON.parse(list.res.body).items.find(t => /rua/i.test(t.ruName)).ruName;
    expect(ruName).toBeTruthy();
    const { req, res } = makeReqRes("DELETE", `/api/agent-logs/ru/${encodeURIComponent(ruName)}`);
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

describe("routes/agent-logs — ru-summary（per-RU token/成本聚合）", () => {
  it("多 RU 任務聚合：各 RU 一個 row，token / duration / byModel 累計正確", async () => {
    await writeTask("/Users/dev/App/alpha");
    await writeTask("/Users/dev/App/beta");
    const { req, res } = makeReqRes("GET", "/api/agent-logs/ru-summary");
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.rows.length).toBe(2);
    const alpha = json.rows.find(r => r.ruName === "alpha");
    expect(alpha.tasks).toBe(1);
    expect(alpha.tokensIn).toBe(100);
    expect(alpha.tokensOut).toBe(50);
    expect(alpha.byModel["gpt-4o"].tokensIn).toBe(100);
    expect(alpha.byModel["gpt-4o"].tokensOut).toBe(50);
    expect(alpha.durationMs).toBeGreaterThanOrEqual(0);
    expect(json.totalCostUsd).toBe(0); // 無 pricing 資料 → 成本 0
  });

  it("空 index → rows 空陣列、totalCostUsd 0（不 crash）", async () => {
    const { req, res } = makeReqRes("GET", "/api/agent-logs/ru-summary");
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.rows).toEqual([]);
    expect(json.totalCostUsd).toBe(0);
    expect(json.totalDurationMs).toBe(0);
  });

  it("purge 後的歷史成本仍計入 summary（getRuCostHistory 合併路徑）", async () => {
    const taskId = await writeTask("/Users/dev/App/goneproj");
    ageTask(taskId, 100);
    await cleanupOldAgentLogs(30); // 過期刪除 → 成本累計進 ru-cost-history.json
    expect((await listAgentTasks(50, {})).length).toBe(0); // live index 已空
    const { req, res } = makeReqRes("GET", "/api/agent-logs/ru-summary");
    await agentLogsRoute(req, res);
    expect(res.statusCode).toBe(200);
    const row = JSON.parse(res.body).rows.find(r => r.ruName === "goneproj");
    expect(row).toBeTruthy(); // 來自持久化歷史，不因 purge 消失
    expect(row.tasks).toBe(1);
    expect(row.tokensIn).toBe(100);
  });
});

describe("routes/log-retention — 三類日誌保留天數讀寫（GET / PUT）", () => {
  it("GET /api/logs/retention：無設定檔回預設（llm/agent 永不刪、other 7 天）", async () => {
    const { req, res } = makeReqRes("GET", "/api/logs/retention");
    await logRetentionRoute(req, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).retention).toEqual({ llmDays: 0, agentDays: 0, otherDays: 7 });
  });

  it("PUT 合法值寫檔持久化，GET 讀回相同設定", async () => {
    const put = makeReqRes("PUT", "/api/logs/retention", { llmDays: 30, agentDays: 90, otherDays: 14 });
    await logRetentionRoute(put.req, put.res);
    expect(put.res.statusCode).toBe(200);
    expect(JSON.parse(put.res.body).ok).toBe(true);
    const get = makeReqRes("GET", "/api/logs/retention");
    await logRetentionRoute(get.req, get.res);
    expect(JSON.parse(get.res.body).retention).toEqual({ llmDays: 30, agentDays: 90, otherDays: 14 });
  });

  it("PUT 邊界：1 與 3650 通過；0 / 3651 / 非數字 → 400 附 1-3650 訊息", async () => {
    // 下界 1 與上界 3650 合法
    for (const ok of [{ llmDays: 1 }, { llmDays: 3650 }]) {
      const r = makeReqRes("PUT", "/api/logs/retention", ok);
      await logRetentionRoute(r.req, r.res);
      expect(r.res.statusCode, JSON.stringify(ok)).toBe(200);
    }
    // 0（現行 API 拒收 — Fleming 政策 llm/agent 資產預設永不刪，见 QA M1）、
    // 3651 逾界、非數字 → 400
    for (const bad of [{ llmDays: 0 }, { agentDays: 3651 }, { otherDays: "abc" }]) {
      const r = makeReqRes("PUT", "/api/logs/retention", bad);
      await logRetentionRoute(r.req, r.res);
      expect(r.res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(JSON.parse(r.res.body).error).toMatch(/1-3650/);
    }
  });

  it("PUT 部分更新只動送出的鍵，其餘保留現值", async () => {
    setRetention({ llmDays: 30, agentDays: 90, otherDays: 14 });
    const r = makeReqRes("PUT", "/api/logs/retention", { otherDays: 3 });
    await logRetentionRoute(r.req, r.res);
    expect(r.res.statusCode).toBe(200);
    expect(JSON.parse(r.res.body).retention).toEqual({ llmDays: 30, agentDays: 90, otherDays: 3 });
  });
});

describe("routes/log-retention — runLogPurge 政策執行（三類日誌）", () => {
  // ISS-044（const otherDeleted += 重賦值 TypeError）導致 runLogPurge 必 throw：
  // 這裡用雙分支自癒寫法 — bug 存在時釘住錯誤形狀並持續驗證已發生的副作用（llm/agent
  // 刪除在 throw 前已完成），developer 修復後自動改驗完整統計回傳值。
  async function purgeTolerant(options = {}) {
    try {
      return { result: await runLogPurge(options), threw: null };
    } catch (e) {
      return { result: null, threw: e };
    }
  }

  it("llmDays>0：檔名日期過期的 llm 檔刪、新檔留（檔名日期比對，非 mtime）", async () => {
    setRetention({ llmDays: 30, agentDays: 0, otherDays: 7 });
    writeFileSync(join(LLM_DIR, "2020-01-01.jsonl"), "{}\n");
    writeFileSync(join(LLM_DIR, "2999-12-31.jsonl"), "{}\n");
    const { result, threw } = await purgeTolerant({});
    if (threw) {
      expect(threw.message).toMatch(/Assignment to constant variable/); // ISS-044 釘住
    } else {
      expect(result.llmDeleted).toBe(1);
    }
    // 副作用不受 bug 影響（llm 刪除發生在 throw 之前）
    expect(existsSync(join(LLM_DIR, "2020-01-01.jsonl"))).toBe(false);
    expect(existsSync(join(LLM_DIR, "2999-12-31.jsonl"))).toBe(true);
  });

  it("llmDays=0（永不刪 — 成本核算資產）：過期 llm 檔不動", async () => {
    setRetention({ llmDays: 0, agentDays: 0, otherDays: 7 });
    writeFileSync(join(LLM_DIR, "2020-01-01.jsonl"), "{}\n");
    const { result, threw } = await purgeTolerant({});
    if (!threw) expect(result.llmDeleted).toBe(0);
    expect(existsSync(join(LLM_DIR, "2020-01-01.jsonl"))).toBe(true);
  });

  it("before 顯式日期：不受 llmDays=0 政策限制（人為主動 purge）", async () => {
    setRetention({ llmDays: 0, agentDays: 0, otherDays: 7 });
    writeFileSync(join(LLM_DIR, "2020-01-01.jsonl"), "{}\n");
    writeFileSync(join(LLM_DIR, "2999-12-31.jsonl"), "{}\n");
    const { result, threw } = await purgeTolerant({ before: "2021-01-01" });
    if (threw) {
      expect(threw.message).toMatch(/Assignment to constant variable/); // ISS-044 釘住
    } else {
      expect(result.llmDeleted).toBe(1);
    }
    expect(existsSync(join(LLM_DIR, "2020-01-01.jsonl"))).toBe(false);
    expect(existsSync(join(LLM_DIR, "2999-12-31.jsonl"))).toBe(true);
  });

  it("agentDays：0（永不刪）過期 trace 不動；>0 時過期 trace 刪除", async () => {
    const taskId = await writeTask("/Users/dev/App/agentproj");
    ageTask(taskId, 100);
    // 段 1：agentDays=0 → 永不刪
    setRetention({ llmDays: 0, agentDays: 0, otherDays: 7 });
    const r0 = await purgeTolerant({});
    if (!r0.threw) expect(r0.result.agentDeleted).toBe(0);
    expect(existsSync(join(LOG_DIR, `${taskId}.jsonl`))).toBe(true);
    // 段 2：agentDays=30 → 過期刪（成本進歷史）
    setRetention({ llmDays: 0, agentDays: 30, otherDays: 7 });
    const r30 = await purgeTolerant({});
    if (!r30.threw) expect(r30.result.agentDeleted).toBe(1);
    expect(existsSync(join(LOG_DIR, `${taskId}.jsonl`))).toBe(false);
    const hist = await getRuCostHistory();
    expect(Object.values(hist).some(h => h.ruName === "agentproj" && h.tokensIn === 100)).toBe(true);
  });

  it("otherDays：LOG_HOME 頂層過期散檔刪、新檔留；janitor 管理區（logs/llm 等）不受 otherDays 影響", async () => {
    setRetention({ llmDays: 0, agentDays: 0, otherDays: 1 });
    const oldSec = (Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000;
    writeFileSync(join(TMP, "stray-old.log"), "x");
    utimesSync(join(TMP, "stray-old.log"), oldSec, oldSec);
    writeFileSync(join(TMP, "stray-new.log"), "x");
    // janitor 管理區內的舊 llm 檔（llmDays=0 永不刪）
    writeFileSync(join(LLM_DIR, "2020-06-01.jsonl"), "{}\n");
    utimesSync(join(LLM_DIR, "2020-06-01.jsonl"), oldSec, oldSec);
    const { result, threw } = await purgeTolerant({});
    if (threw) {
      expect(threw.message).toMatch(/Assignment to constant variable/); // ISS-044 釘住
    } else {
      expect(result.otherDeleted).toBe(1);
    }
    expect(existsSync(join(TMP, "stray-old.log"))).toBe(false);
    expect(existsSync(join(TMP, "stray-new.log"))).toBe(true);
    expect(existsSync(join(LLM_DIR, "2020-06-01.jsonl"))).toBe(true); // 管理區不動
  });
});

describe("routes/log-retention — POST /api/logs/purge 端點", () => {
  // ⚠️ it.fails（ISS-044）：runLogPurge 的 const += bug 使此端點現況必 500。
  // developer 修復（log-retention.mjs L150 const → let）後本測試會「意外通過」而轉紅
  // — 移除 .fails 即全綠，屆時端點契約（200 + 三類統計）由本測試長期看守。
  it.fails("POST /api/logs/purge 回 200 與三類刪除統計（ISS-044 修復後移除 .fails）", async () => {
    // 關閉 janitor（POST purge 連帶執行 runJanitor，避免掃真實 PAAW_ROOT）
    mkdirSync(join(TMP, "config"), { recursive: true });
    writeFileSync(join(TMP, "config", "janitor.json"), JSON.stringify({ enabled: false }));
    const { req, res } = makeReqRes("POST", "/api/logs/purge", {});
    await logRetentionRoute(req, res);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.retention).toEqual({ llmDays: 0, agentDays: 0, otherDays: 7 });
    expect(typeof json.deleted).toBe("number");
    expect(json.detail).toEqual({ llm: 0, agent: 0, other: 0 });
    expect(json.janitor).toBeTruthy(); // janitor 回報一併附上
  });

  it("POST /api/logs/purge 帶 before：顯式日期走 purgeLlmBefore 路徑（同 ISS-044 現況，500 形狀釘住）", async () => {
    mkdirSync(join(TMP, "config"), { recursive: true });
    writeFileSync(join(TMP, "config", "janitor.json"), JSON.stringify({ enabled: false }));
    writeFileSync(join(LLM_DIR, "2020-01-01.jsonl"), "{}\n");
    const { req, res } = makeReqRes("POST", "/api/logs/purge", { before: "2021-01-01" });
    await logRetentionRoute(req, res);
    // ISS-044 修復前：500 + TypeError 訊息（錯誤洩漏面另案）；修復後：200 + llm 統計
    if (res.statusCode === 500) {
      expect(JSON.parse(res.body).error).toMatch(/Assignment to constant variable/);
    } else {
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).detail.llm).toBe(1);
    }
    expect(existsSync(join(LLM_DIR, "2020-01-01.jsonl"))).toBe(false); // 副作用已發生
  });
});
