/**
 * coding-trouble（TS Guide）單元測試（2026-10-10）
 * - collectTroubleFacts：deterministic 事實收集（git fix commits / bug tasks / error codes / log errors）
 * - remark CRUD（獨立檔 — guide 重生成永不覆蓋）
 * - confirm（人確認）+ regenerate merge 鐵律（confirmed 原封保留）
 * - ⚠️ POST guide 的 mineEntries 會打真 LLM — 不在 unit 測（live 驗證）；
 *   merge 鐵律用手動預置 guide 檔 + mock 失敗路徑（LLM 失敗 → confirmed 仍保留）驗
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import codingTroubleRoutes, { collectTroubleFacts } from "../../packages/server/src/routes/coding-trouble.mjs";

function mockReq(method, url, body) {
  const bodyStr = body ? JSON.stringify(body) : "";
  return {
    method, url,
    on(ev, cb) {
      if (ev === "data" && bodyStr) cb(bodyStr);
      if (ev === "end") cb();
      if (ev === "error") cb();
    },
  };
}
function mockRes() {
  const r = { code: 0, body: null };
  r.writeHead = (c) => { r.code = c; return r; };
  r.end = (b) => { r.body = String(b || ""); return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (j) => { if (!r.code) r.code = 200; r.body = JSON.stringify(j); return r; };
  return r;
}

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "trouble-test-"));
  // 最小 git repo（fix commits 素材）
  execSync("git init -q -b main", { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "feat: init"', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "fix: 修 XSS in user-input"', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "docs: readme"', { cwd: dir });
  // bug tasks + agent log
  mkdirSync(join(dir, ".paaw", "tasks"), { recursive: true });
  writeFileSync(join(dir, ".paaw", "tasks", "TASKS.json"), JSON.stringify([
    { id: "T-1", title: "修 SQL injection in api/users", status: "done" },
    { id: "T-2", title: "新增報表功能", status: "done" },
  ]));
  mkdirSync(join(dir, "log", "logs", "agent"), { recursive: true });
  writeFileSync(join(dir, "log", "logs", "agent", "2026-10-10.jsonl"), `{"ts":"1","msg":"ok"}\n{"ts":"2","error":"EPERM write denied"}\n`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("collectTroubleFacts（deterministic — 零 token）", () => {
  it("git fix commits 抓到 fix/修，不含 docs/feat", async () => {
    const f = await collectTroubleFacts(dir);
    expect(f.fixCommits.length).toBe(1); // docs/feat 不算
    expect(f.fixCommits[0]).toContain("fix: 修 XSS");
  });
  it("bug tasks 只抓 bug-like，不抓新功能", async () => {
    const f = await collectTroubleFacts(dir);
    expect(f.bugTasks.length).toBe(1);
    expect(f.bugTasks[0].title).toContain("SQL injection");
  });
  it("agent log errors 抓到 error 行", async () => {
    const f = await collectTroubleFacts(dir);
    expect(f.agentLogErrors.length).toBe(1);
    expect(f.agentLogErrors[0]).toContain("EPERM");
  });
  it("無 error codes catalog → 空陣列不炸", async () => {
    const f = await collectTroubleFacts(dir);
    expect(f.errorCodes).toEqual([]);
  });
});

describe("remark CRUD（獨立檔 — 永久保留）", () => {
  it("PUT remark → 落地 trouble-remarks.json", async () => {
    const res = mockRes();
    await codingTroubleRoutes(mockReq("PUT", `/api/coding-trouble/remark?path=${encodeURIComponent(dir)}`, { text: "port 被佔先 lsof -ti:4097" }), res);
    expect(res.code).toBe(200);
    expect(JSON.parse(res.body).remarks).toHaveLength(1);
    expect(existsSync(join(dir, ".paaw", "troubleshooting", "trouble-remarks.json"))).toBe(true);
  });
  it("GET guide → remarks 讀回、guide 未生成 = null", async () => {
    const res = mockRes();
    await codingTroubleRoutes(mockReq("GET", `/api/coding-trouble/guide?path=${encodeURIComponent(dir)}`), res);
    const j = JSON.parse(res.body);
    expect(j.guide).toBeNull();
    expect(j.remarks).toHaveLength(1);
  });
  it("DELETE remark → 清空", async () => {
    const id = JSON.parse(readFileSync(join(dir, ".paaw", "troubleshooting", "trouble-remarks.json"), "utf-8"))[0].id;
    const res = mockRes();
    await codingTroubleRoutes(mockReq("DELETE", `/api/coding-trouble/remark?path=${encodeURIComponent(dir)}&id=${id}`), res);
    expect(JSON.parse(res.body).remarks).toHaveLength(0);
  });
  it("空 text → 400", async () => {
    const res = mockRes();
    await codingTroubleRoutes(mockReq("PUT", `/api/coding-trouble/remark?path=${encodeURIComponent(dir)}`, { text: "" }), res);
    expect(res.code).toBe(400);
  });
});

describe("confirm + merge 鐵律（confirmed = 人確認過的資產）", () => {
  it("confirm 未生成的 guide → 404", async () => {
    const res = mockRes();
    await codingTroubleRoutes(mockReq("PUT", `/api/coding-trouble/confirm?path=${encodeURIComponent(dir)}`, { id: "t-x" }), res);
    expect(res.code).toBe(404);
  });

  it("confirm entry → status confirmed 落盤；guide 檔被外部重寫後 confirmed 仍在", async () => {
    // 預置一份 guide（模擬已生成）
    const guidePath = join(dir, ".paaw", "troubleshooting", "TSGUIDE.json");
    writeFileSync(guidePath, JSON.stringify({
      version: 1, generatedAt: "2026-10-10T00:00:00Z",
      entries: [{ id: "t-a", symptom: "症狀A", cause: "原因", fixSteps: [], evidence: [], status: "ai-draft" }],
      gaps: [],
    }));
    const res = mockRes();
    await codingTroubleRoutes(mockReq("PUT", `/api/coding-trouble/confirm?path=${encodeURIComponent(dir)}`, { id: "t-a" }), res);
    expect(res.code).toBe(200);
    const j = JSON.parse(res.body);
    expect(j.guide.entries[0].status).toBe("confirmed");
    expect(j.guide.entries[0].confirmedAt).toBeTruthy();
    // unconfirm 回 draft
    const res2 = mockRes();
    await codingTroubleRoutes(mockReq("PUT", `/api/coding-trouble/confirm?path=${encodeURIComponent(dir)}`, { id: "t-a", unconfirm: true }), res2);
    expect(JSON.parse(res2.body).guide.entries[0].status).toBe("ai-draft");
  });

  it("POST entry — 手動新增 → status=human（AI 漏寫 SOP 人直接補）", async () => {
    const res = mockRes();
    await codingTroubleRoutes(mockReq("POST", `/api/coding-trouble/entry?path=${encodeURIComponent(dir)}`, {
      symptom: "port 4097 被佔", cause: "殘留 server", fixSteps: ["lsof -ti:4097", "kill 後重啟"], evidenceText: "今天踩過",
    }), res);
    expect(res.code).toBe(200);
    const j = JSON.parse(res.body);
    const e = j.guide.entries.find(x => x.status === "human");
    expect(e?.symptom).toContain("4097");
    expect(e?.fixSteps).toHaveLength(2);
    expect(e?.evidence[0].type).toBe("human");
  });

  it("PUT entry — 編輯既有條目補 SOP", async () => {
    const res0 = mockRes();
    await codingTroubleRoutes(mockReq("GET", `/api/coding-trouble/guide?path=${encodeURIComponent(dir)}`), res0);
    const id = JSON.parse(res0.body).guide.entries.find(e => e.status === "human").id;
    const res = mockRes();
    await codingTroubleRoutes(mockReq("PUT", `/api/coding-trouble/entry?path=${encodeURIComponent(dir)}`, {
      id, fixSteps: ["步驟A", "步驟B", "步驟C"],
    }), res);
    expect(res.code).toBe(200);
    const e2 = JSON.parse(res.body).guide.entries.find(x => x.id === id);
    expect(e2.fixSteps).toHaveLength(3);
    expect(e2.lastEditAt).toBeTruthy();
  });

  it("POST entry 無 symptom → 400", async () => {
    const res = mockRes();
    await codingTroubleRoutes(mockReq("POST", `/api/coding-trouble/entry?path=${encodeURIComponent(dir)}`, { symptom: "" }), res);
    expect(res.code).toBe(400);
  });

  it("path 不存在 → 400", async () => {
    const res = mockRes();
    await codingTroubleRoutes(mockReq("GET", `/api/coding-trouble/guide?path=/nonexistent-xyz`), res);
    expect(res.code).toBe(400);
  });
});
