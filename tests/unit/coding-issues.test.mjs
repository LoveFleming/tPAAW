/**
 * coding-issues.test.mjs — F-014 編碼專案議題追蹤與已知問題匯入
 *
 * 受測：packages/server/src/routes/coding-issues.mjs（default export route handler）
 *
 * 測試策略：整合層 — 用真實 node:http server 掛上 route handler，打真實 HTTP
 * 請求（含 query/body），對 temp 專案根目錄（非 tPAAW 自身）驗證端到端行為。
 * 每個 case 用獨立的 mkdtemp 專案根，確保隔離與可重現。
 *
 * 覆蓋端點：
 *   GET    /api/coding-issues                — list（filter status/priority/label/type/search + 排序）
 *   GET    /api/coding-issues/:id            — 單筆（+ 404）
 *   POST   /api/coding-issues                — create（+ 400 缺 title / 非法 JSON）
 *   PUT    /api/coding-issues/:id            — update（+ resolvedAt 狀態機 / 404）
 *   DELETE /api/coding-issues/:id            — delete（+ 404）
 *   POST   /api/coding-issues/:id/notes      — 追加筆記（+ 400 空內容 / 404）
 *   GET    /api/coding-issues/stats          — 統計彙總
 *   POST   /api/coding-issues/import-known   — KNOWN-ISSUES.md 匯入（+ 404 缺檔 / 重複匯入去重）
 *
 * 邊界：缺 path 參數、空 ISSUES.json、損壞 JSON、非 array issues、未知路由 pass-through。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import codingIssuesRoute from "../../packages/server/src/routes/coding-issues.mjs";

// ── Test harness ──

let server, baseUrl, projRoot;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(async (req, res) => {
      const handled = await codingIssuesRoute(req, res);
      if (!handled) { res.writeHead(404); res.end("not found"); }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => server.close(resolve));
}

async function req(method, path, { body, rawBody } = {}) {
  const url = `${baseUrl}${path}`;
  const opts = { method, headers: {} };
  let payload;
  if (rawBody !== undefined) {
    payload = rawBody;
    opts.headers["Content-Type"] = "application/json";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...opts, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

/** 便捷：帶 path 的 query */
function q(params) {
  return new URLSearchParams(params).toString();
}

function issuesFile() {
  return join(projRoot, ".paaw", "issues", "ISSUES.json");
}

function seedIssues(issues) {
  mkdirSync(join(projRoot, ".paaw", "issues"), { recursive: true });
  writeFileSync(issuesFile(), JSON.stringify({ issues, updatedAt: new Date().toISOString() }, null, 2));
}

function readIssues() {
  return JSON.parse(readFileSync(issuesFile(), "utf-8")).issues;
}

beforeEach(async () => {
  projRoot = mkdtempSync(join(tmpdir(), "paaw-issues-test-"));
  await startServer();
});
afterEach(async () => {
  await stopServer();
  rmSync(projRoot, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
describe("coding-issues — 參數與 pass-through", () => {
  it("非 /api/coding-issues 路由 → return false (pass-through)", async () => {
    const handled = await codingIssuesRoute({ method: "GET", url: "/api/other" }, {});
    expect(handled).toBe(false);
  });

  it("缺 path query 參數 → 400", async () => {
    const r = await req("GET", "/api/coding-issues");
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/path/i);
  });
});

// ─────────────────────────────────────────────────────────────
describe("coding-issues — CRUD", () => {
  it("POST create → 201，回傳新 issue 帶 ISS-1 id 與預設值", async () => {
    const r = await req("POST", `/api/coding-issues?${q({ path: projRoot })}`, {
      body: { title: "Login fails on mobile" },
    });
    expect(r.status).toBe(201);
    expect(r.json.id).toBe("ISS-1");
    expect(r.json.title).toBe("Login fails on mobile");
    expect(r.json.type).toBe("bug");
    expect(r.json.status).toBe("open");
    expect(r.json.priority).toBe("medium");
    expect(r.json.createdAt).toBeTruthy();
    // 已落檔
    expect(readIssues()).toHaveLength(1);
  });

  it("POST create 缺 title → 400，未落檔", async () => {
    const r = await req("POST", `/api/coding-issues?${q({ path: projRoot })}`, {
      body: { description: "no title" },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/title/i);
    expect(existsSync(issuesFile())).toBe(false);
  });

  it("POST create 空白 title → 400", async () => {
    const r = await req("POST", `/api/coding-issues?${q({ path: projRoot })}`, {
      body: { title: "   " },
    });
    expect(r.status).toBe(400);
  });

  it("POST create 非法 JSON → 400 Invalid JSON", async () => {
    const r = await req("POST", `/api/coding-issues?${q({ path: projRoot })}`, {
      rawBody: "{not json",
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/invalid json/i);
  });

  it("id 遞增：連續建立 → ISS-1, ISS-2（取現有最大 +1）", async () => {
    seedIssues([{ id: "ISS-7", title: "old" }]);
    const r = await req("POST", `/api/coding-issues?${q({ path: projRoot })}`, { body: { title: "new" } });
    expect(r.json.id).toBe("ISS-8");
  });

  it("GET list → 回傳 { issues }", async () => {
    seedIssues([{ id: "ISS-1", title: "a" }, { id: "ISS-2", title: "b" }]);
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot })}`);
    expect(r.status).toBe(200);
    expect(r.json.issues).toHaveLength(2);
  });

  it("GET list 對空/不存在的檔案 → 空陣列（不報錯）", async () => {
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot })}`);
    expect(r.status).toBe(200);
    expect(r.json.issues).toEqual([]);
  });

  it("GET /:id → 單筆；不存在 → 404", async () => {
    seedIssues([{ id: "ISS-1", title: "solo" }]);
    const ok = await req("GET", `/api/coding-issues/ISS-1?${q({ path: projRoot })}`);
    expect(ok.status).toBe(200);
    expect(ok.json.title).toBe("solo");

    const miss = await req("GET", `/api/coding-issues/ISS-999?${q({ path: projRoot })}`);
    expect(miss.status).toBe(404);
  });

  it("PUT /:id 更新欄位並保留 id；404 當不存在", async () => {
    seedIssues([{ id: "ISS-1", title: "orig", status: "open", priority: "low" }]);
    const r = await req("PUT", `/api/coding-issues/ISS-1?${q({ path: projRoot })}`, {
      body: { title: "updated", priority: "high" },
    });
    expect(r.status).toBe(200);
    expect(r.json.id).toBe("ISS-1");
    expect(r.json.title).toBe("updated");
    expect(r.json.priority).toBe("high");
    expect(r.json.updatedAt).toBeTruthy();

    const miss = await req("PUT", `/api/coding-issues/ISS-999?${q({ path: projRoot })}`, { body: { title: "x" } });
    expect(miss.status).toBe(404);
  });

  it("PUT 狀態機：resolved 設 resolvedAt；轉回 open 清空 resolvedAt", async () => {
    seedIssues([{ id: "ISS-1", title: "t", status: "open", resolvedAt: null }]);
    const toResolved = await req("PUT", `/api/coding-issues/ISS-1?${q({ path: projRoot })}`, { body: { status: "resolved" } });
    expect(toResolved.json.resolvedAt).toBeTruthy();

    const backToOpen = await req("PUT", `/api/coding-issues/ISS-1?${q({ path: projRoot })}`, { body: { status: "open" } });
    expect(backToOpen.json.resolvedAt).toBeNull();
  });

  it("DELETE /:id → ok + deleted；404 當不存在", async () => {
    seedIssues([{ id: "ISS-1", title: "bye" }]);
    const r = await req("DELETE", `/api/coding-issues/ISS-1?${q({ path: projRoot })}`);
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.deleted.id).toBe("ISS-1");
    expect(readIssues()).toHaveLength(0);

    const miss = await req("DELETE", `/api/coding-issues/ISS-1?${q({ path: projRoot })}`);
    expect(miss.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
describe("coding-issues — list 過濾與排序", () => {
  beforeEach(() => {
    seedIssues([
      { id: "ISS-1", title: "Auth bug", status: "open", priority: "high", type: "bug", labels: ["auth"] },
      { id: "ISS-2", title: "Slow query", status: "in-progress", priority: "critical", type: "enhancement", labels: ["perf"] },
      { id: "ISS-3", title: "XSS hole", status: "resolved", priority: "critical", type: "security", labels: ["auth", "sec"] },
    ]);
  });

  it("filter by status（逗號分隔）", async () => {
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot, status: "open,in-progress" })}`);
    expect(r.json.issues.map(i => i.id).sort()).toEqual(["ISS-1", "ISS-2"]);
  });

  it("filter by priority", async () => {
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot, priority: "critical" })}`);
    expect(r.json.issues.map(i => i.id).sort()).toEqual(["ISS-2", "ISS-3"]);
  });

  it("filter by label", async () => {
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot, label: "auth" })}`);
    expect(r.json.issues.map(i => i.id).sort()).toEqual(["ISS-1", "ISS-3"]);
  });

  it("filter by type", async () => {
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot, type: "security" })}`);
    expect(r.json.issues.map(i => i.id)).toEqual(["ISS-3"]);
  });

  it("search 大小寫不敏感（title/description/id）", async () => {
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot, search: "xss" })}`);
    expect(r.json.issues.map(i => i.id)).toEqual(["ISS-3"]);
  });

  it("排序：status 優先（open 先於 in-progress 先於 resolved），再依 priority", async () => {
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot })}`);
    expect(r.json.issues.map(i => i.id)).toEqual(["ISS-1", "ISS-2", "ISS-3"]);
  });
});

// ─────────────────────────────────────────────────────────────
describe("coding-issues — stats 統計彙總", () => {
  it("正確彙總 total / 各狀態 / byPriority / byType", async () => {
    seedIssues([
      { id: "ISS-1", status: "open", priority: "high", type: "bug" },
      { id: "ISS-2", status: "open", priority: "critical", type: "security" },
      { id: "ISS-3", status: "in-progress", priority: "medium", type: "requirement" },
      { id: "ISS-4", status: "resolved", priority: "low", type: "enhancement" },
    ]);
    const r = await req("GET", `/api/coding-issues/stats?${q({ path: projRoot })}`);
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(4);
    expect(r.json.open).toBe(2);
    expect(r.json.inProgress).toBe(1);
    expect(r.json.resolved).toBe(1);
    expect(r.json.byPriority).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
    expect(r.json.byType).toEqual({ bug: 1, security: 1, requirement: 1, enhancement: 1 });
  });

  it("空專案 → 全 0", async () => {
    const r = await req("GET", `/api/coding-issues/stats?${q({ path: projRoot })}`);
    expect(r.json.total).toBe(0);
    expect(r.json.byPriority.critical).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
describe("coding-issues — notes 筆記追加", () => {
  it("POST notes → 追加帶 by/at/content 的筆記", async () => {
    seedIssues([{ id: "ISS-1", title: "t", notes: [] }]);
    const r = await req("POST", `/api/coding-issues/ISS-1/notes?${q({ path: projRoot })}`, {
      body: { content: "reproduced on iOS 17", by: "qa" },
    });
    expect(r.status).toBe(200);
    expect(r.json.notes).toHaveLength(1);
    expect(r.json.notes[0].content).toBe("reproduced on iOS 17");
    expect(r.json.notes[0].by).toBe("qa");
    expect(r.json.notes[0].at).toBeTruthy();
    // 落檔
    expect(readIssues()[0].notes).toHaveLength(1);
  });

  it("POST notes 空內容 → 400", async () => {
    seedIssues([{ id: "ISS-1", notes: [] }]);
    const r = await req("POST", `/api/coding-issues/ISS-1/notes?${q({ path: projRoot })}`, { body: { content: "  " } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/note content/i);
  });

  it("POST notes 對不存在 issue → 404", async () => {
    seedIssues([{ id: "ISS-1" }]);
    const r = await req("POST", `/api/coding-issues/ISS-999/notes?${q({ path: projRoot })}`, { body: { content: "hi" } });
    expect(r.status).toBe(404);
  });

  it("notes 缺欄位（舊資料無 notes）→ 初始化為陣列後追加", async () => {
    seedIssues([{ id: "ISS-1", title: "legacy" }]);
    const r = await req("POST", `/api/coding-issues/ISS-1/notes?${q({ path: projRoot })}`, { body: { content: "n1" } });
    expect(r.status).toBe(200);
    expect(r.json.notes).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
describe("coding-issues — import-known (KNOWN-ISSUES.md)", () => {
  const KNOWN_MD = `# Known Issues

## Open Issues

### KI-1: Login timeout on slow network
- **影響:** users cannot sign in
- **Workaround:** retry
- **優先級:** high
- **相關:** src/auth/login.ts, src/net/timeout.ts

### KI-2: Memory leak in scheduler
- **影響:** RAM grows over time
- **優先級:** critical

## Resolved Issues

### KI-3: Typo in welcome screen
- **影響:** cosmetic
`;

  function seedKnown(md) {
    writeFileSync(join(projRoot, "KNOWN-ISSUES.md"), md);
  }

  it("匯入 open + resolved 區塊，KI-N → ISS-N，欄位解析正確", async () => {
    seedKnown(KNOWN_MD);
    const r = await req("POST", `/api/coding-issues/import-known?${q({ path: projRoot })}`);
    expect(r.status).toBe(200);
    expect(r.json.imported).toBe(3);
    expect(r.json.total).toBe(3);

    const saved = readIssues();
    const ki1 = saved.find(i => i.id === "ISS-1");
    expect(ki1.title).toBe("Login timeout on slow network");
    expect(ki1.status).toBe("open");
    expect(ki1.priority).toBe("high");
    expect(ki1.description).toBe("users cannot sign in");
    expect(ki1.solution).toBe("retry");
    expect(ki1.relatedFiles).toEqual(["src/auth/login.ts", "src/net/timeout.ts"]);

    const ki3 = saved.find(i => i.id === "ISS-3");
    expect(ki3.status).toBe("closed"); // resolved 區塊 → closed
    expect(ki3.resolvedAt).toBeTruthy();
  });

  it("重複匯入 → 已存在 id 不重複（去重）", async () => {
    seedKnown(KNOWN_MD);
    await req("POST", `/api/coding-issues/import-known?${q({ path: projRoot })}`);
    const second = await req("POST", `/api/coding-issues/import-known?${q({ path: projRoot })}`);
    expect(second.status).toBe(200);
    expect(second.json.imported).toBe(0);   // 無新增
    expect(second.json.total).toBe(3);      // 總數不變
  });

  it("缺 KNOWN-ISSUES.md → 404", async () => {
    const r = await req("POST", `/api/coding-issues/import-known?${q({ path: projRoot })}`);
    expect(r.status).toBe(404);
    expect(r.json.error).toMatch(/not found/i);
  });

  it("空檔 / 無任何 ### KI- 條目 → 匯入 0 筆（不報錯）", async () => {
    seedKnown("# Known Issues\n\n## Open Issues\n\n（尚無）\n");
    const r = await req("POST", `/api/coding-issues/import-known?${q({ path: projRoot })}`);
    expect(r.status).toBe(200);
    expect(r.json.imported).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
describe("coding-issues — 檔案讀寫健壯性", () => {
  it("ISSUES.json 內容非法 JSON → list 回空陣列（graceful）", async () => {
    mkdirSync(join(projRoot, ".paaw", "issues"), { recursive: true });
    writeFileSync(issuesFile(), "{ broken json");
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot })}`);
    expect(r.status).toBe(200);
    expect(r.json.issues).toEqual([]);
  });

  it("ISSUES.json 的 issues 非陣列 → list 回空陣列（graceful）", async () => {
    mkdirSync(join(projRoot, ".paaw", "issues"), { recursive: true });
    writeFileSync(issuesFile(), JSON.stringify({ issues: "not-an-array" }));
    const r = await req("GET", `/api/coding-issues?${q({ path: projRoot })}`);
    expect(r.status).toBe(200);
    expect(r.json.issues).toEqual([]);
  });

  it("未知子路由（POST /api/coding-issues/foo/bar）→ 404 pass-through", async () => {
    const r = await req("POST", `/api/coding-issues/foo/bar?${q({ path: projRoot })}`);
    expect(r.status).toBe(404);
  });
});
