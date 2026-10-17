/**
 * Integration tests — audit-log route handler (F20261016-052 / TASK-095 quality retrofit)
 *
 * 受測檔：packages/server/src/routes/audit-log.mjs（GET /api/audit-log、/api/audit-log/dates）
 * 資料媒介：{ASSET_LOGS_ROOT}/audit/audit-YYYY-MM-DD.jsonl（事實來源）
 *
 * 這層是「真實可執行的整合測試」：directly 呼叫 default export handler，注入 mock
 * req/res（不開 server），並用一次性暫存 audit 目錄餵合成 JSONL——驗證面板依賴的
 * API 契約（日期清單、日期/severity/q filter、全貌統計、截斷、400 防護、唯讀鐵律）。
 *
 * 隔離策略（沿用 notes.test.mjs / coding-handover.test.mjs 慣例）：
 *   1. ASSET_LOGS_ROOT 由 data-home.mjs 於 module-load 時讀 env 計算，故必須
 *      「先設 env、再動態 import()」。
 *   2. 每個測試用 mkdtemp 的一次性目錄，afterAll 清除，絕不污染真實 log/。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "paaw-audit-route-"));
process.env.PAAW_LOG_HOME = TMP; // 必須在 import 前設 — data-home 讀 env
process.env.PAAW_DATA_HOME = TMP;

let handler;
let AUDIT_DIR;

// ── mock req/res（route handler 直接注入）──
function mockReq(method, url) {
  return { method, url };
}
function mockRes() {
  const res = {
    _status: 200,
    _body: "",
    writeHead(code, _headers) { res._status = code; return res; },
    end(chunk) { res._body = chunk || ""; return res; },
  };
  return res;
}

async function call(method, url) {
  const req = mockReq(method, url);
  const res = mockRes();
  const handled = await handler(req, res);
  let json = null;
  try { json = JSON.parse(res._body); } catch { /* non-json */ }
  return { handled, status: res._status, body: json, raw: res._body };
}

function writeDay(date, events) {
  const lines = events.map(e => JSON.stringify(e)).join("\n");
  writeFileSync(join(AUDIT_DIR, `audit-${date}.jsonl`), lines + "\n", "utf-8");
}

beforeAll(async () => {
  const mod = await import("../../packages/server/src/routes/audit-log.mjs");
  handler = mod.default;
  // ASSET_LOGS_ROOT = PAAW_LOG_HOME (data-home)；audit 子目錄
  AUDIT_DIR = join(TMP, "audit");
  mkdirSync(AUDIT_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  // 清空 audit 目錄，讓每個案例獨立
  rmSync(AUDIT_DIR, { recursive: true, force: true });
  mkdirSync(AUDIT_DIR, { recursive: true });
});

const DAY1 = [
  { eid: "e1", "@timestamp": "2026-10-10T01:00:00Z", kind: "network_block", severity: "block", layer: "network-whitelist", tool: "bash", command: "curl https://evil.example.com", agentId: "coding.architect", domains: ["evil.example.com"] },
  { eid: "e2", "@timestamp": "2026-10-10T02:00:00Z", kind: "shell_guard", severity: "warn", layer: "shell-guard", tool: "bash", command: "rm -rf /", agentId: "coding.developer" },
  { eid: "e3", "@timestamp": "2026-10-10T03:00:00Z", kind: "path_violation", severity: "info", layer: "path-safety", reason: "探測 ../etc/passwd" },
];

// ── GET /api/audit-log/dates ──

describe("GET /api/audit-log/dates", () => {
  it("回傳空清單 + latest=null（無任何 audit 檔）", async () => {
    const { handled, status, body } = await call("GET", "/api/audit-log/dates");
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dates).toEqual([]);
    expect(body.latest).toBeNull();
  });

  it("列出所有日期並新→舊排序，latest 為最新", async () => {
    writeDay("2026-10-10", DAY1);
    writeDay("2026-10-12", [{ eid: "x", kind: "doom_loop", severity: "warn" }]);
    const { body } = await call("GET", "/api/audit-log/dates");
    expect(body.dates).toEqual(["2026-10-12", "2026-10-10"]);
    expect(body.latest).toBe("2026-10-12");
  });

  it("忽略不符 audit-YYYY-MM-DD.jsonl 命名規則的檔案", async () => {
    writeDay("2026-10-10", DAY1);
    writeFileSync(join(AUDIT_DIR, "notes.txt"), "junk", "utf-8");
    writeFileSync(join(AUDIT_DIR, "audit-bad.jsonl"), "{}", "utf-8");
    const { body } = await call("GET", "/api/audit-log/dates");
    expect(body.dates).toEqual(["2026-10-10"]);
  });
});

// ── GET /api/audit-log ──

describe("GET /api/audit-log — happy path & 全貌統計", () => {
  it("無 date 參數 → 預設讀最新一天，回傳事件 + 統計", async () => {
    writeDay("2026-10-10", DAY1);
    const { handled, status, body } = await call("GET", "/api/audit-log");
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.date).toBe("2026-10-10");
    expect(body.exists).toBe(true);
    expect(body.total).toBe(3);
    expect(body.count).toBe(3);
    expect(body.events).toHaveLength(3);
    // 新→舊
    expect(body.events[0].eid).toBe("e3");
    expect(body.events[2].eid).toBe("e1");
  });

  it("統計用全部事件（不受 filter 影響），四維度 byKind/bySeverity/byLayer/byAgent", async () => {
    writeDay("2026-10-10", DAY1);
    const { body } = await call("GET", "/api/audit-log?severity=block");
    // 只回 1 筆 filter 後事件
    expect(body.count).toBe(1);
    // 但統計涵蓋全部 3 筆
    expect(body.stats.bySeverity).toEqual({ block: 1, warn: 1, info: 1 });
    expect(body.stats.byKind.network_block).toBe(1);
    expect(body.stats.byKind.shell_guard).toBe(1);
    expect(body.stats.byLayer["network-whitelist"]).toBe(1);
    expect(body.stats.byAgent["coding.architect"]).toBe(1);
    expect(body.stats.byAgent["coding.developer"]).toBe(1);
  });

  it("severity 缺漏值以 warn 計入 bySeverity；kind 缺漏以 unknown 計", async () => {
    writeDay("2026-10-10", [{ eid: "no-sev", kind: "x" }, { eid: "no-kind", severity: "info" }]);
    const { body } = await call("GET", "/api/audit-log");
    expect(body.stats.bySeverity.warn).toBe(1);
    expect(body.stats.bySeverity.info).toBe(1);
    expect(body.stats.byKind.unknown).toBe(1);
    expect(body.stats.byLayer.unknown).toBe(2);
  });

  it("跳過 malformed JSON 行（不讓壞行炸掉整份報表）", async () => {
    const good = JSON.stringify(DAY1[0]);
    writeFileSync(join(AUDIT_DIR, "audit-2026-10-10.jsonl"), `${good}\n{ broken json\n\n${good}\n`, "utf-8");
    const { body } = await call("GET", "/api/audit-log");
    expect(body.total).toBe(2);
    expect(body.ok).toBe(true);
  });
});

describe("GET /api/audit-log — filter（面板日期/嚴重度/搜尋依賴）", () => {
  beforeEach(() => writeDay("2026-10-10", DAY1));

  it("severity filter 只回該嚴重度事件", async () => {
    const { body } = await call("GET", "/api/audit-log?severity=warn");
    expect(body.count).toBe(1);
    expect(body.events[0].eid).toBe("e2");
  });

  it("kinds filter 支援逗號分隔多值", async () => {
    const { body } = await call("GET", "/api/audit-log?kinds=network_block,path_violation");
    expect(body.count).toBe(2);
    expect(body.events.map(e => e.eid).sort()).toEqual(["e1", "e3"]);
  });

  it("q 全文搜尋跨 kind/tool/command/reason/agentId/layer（大小寫無關）", async () => {
    const byCommand = await call("GET", "/api/audit-log?q=evil");
    expect(byCommand.body.count).toBe(1);
    expect(byCommand.body.events[0].eid).toBe("e1");

    const byReason = await call("GET", "/api/audit-log?q=PASSWD");
    expect(byReason.body.count).toBe(1);
    expect(byReason.body.events[0].eid).toBe("e3");

    const byAgent = await call("GET", "/api/audit-log?q=developer");
    expect(byAgent.body.count).toBe(1);
    expect(byAgent.body.events[0].eid).toBe("e2");
  });

  it("q + severity 疊加（AND）", async () => {
    const { body } = await call("GET", "/api/audit-log?severity=block&q=evil");
    expect(body.count).toBe(1);
    expect(body.events[0].eid).toBe("e1");
  });

  it("q 無命中 → count=0、events 空、但 exists=true 且統計仍在", async () => {
    const { body } = await call("GET", "/api/audit-log?q=zzz-nomatch");
    expect(body.count).toBe(0);
    expect(body.events).toEqual([]);
    expect(body.exists).toBe(true);
    expect(body.stats.bySeverity.block).toBe(1);
  });
});

describe("GET /api/audit-log — 截斷與 limit", () => {
  it("limit 預設 300；超過時 truncated=true 且 count 保留全量（面板需能顯示被截掉數量）", async () => {
    const many = Array.from({ length: 305 }, (_, i) => ({ eid: `b${i}`, kind: "doom_loop", severity: "warn" }));
    writeDay("2026-10-10", many);
    const { body } = await call("GET", "/api/audit-log");
    expect(body.total).toBe(305);
    expect(body.count).toBe(305);
    expect(body.events).toHaveLength(300);
    expect(body.truncated).toBe(true);
  });

  it("limit 可調，且被夾在 [1, 2000]", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ eid: `b${i}`, kind: "doom_loop", severity: "warn" }));
    writeDay("2026-10-10", many);
    expect((await call("GET", "/api/audit-log?limit=3")).body.events).toHaveLength(3);
    // 上限夾到 2000（10 筆 → 全回，truncated=false）
    expect((await call("GET", "/api/audit-log?limit=99999")).body.events).toHaveLength(10);
    // 下限夾到 1
    expect((await call("GET", "/api/audit-log?limit=0")).body.events).toHaveLength(1);
  });
});

describe("GET /api/audit-log — 安全邊界（唯讀鐵律 + 路徑穿越防護）", () => {
  it("不合法 date 格式 → 400", async () => {
    const { status, body } = await call("GET", "/api/audit-log?date=../etc/passwd");
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("合法格式但不存在的日期 → exists=false、events 空（面板顯示 none 狀態）", async () => {
    const { status, body } = await call("GET", "/api/audit-log?date=1999-01-01");
    expect(status).toBe(200);
    expect(body.exists).toBe(false);
    expect(body.events).toEqual([]);
  });

  it("完全無 audit 目錄時不炸，回空結果", async () => {
    rmSync(AUDIT_DIR, { recursive: true, force: true });
    const { status, body } = await call("GET", "/api/audit-log");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.events).toEqual([]);
    mkdirSync(AUDIT_DIR, { recursive: true });
  });

  it("非 GET → 回傳 false（不攔截，交還上層 router）", async () => {
    const { handled } = await call("POST", "/api/audit-log");
    expect(handled).toBe(false);
  });
});
