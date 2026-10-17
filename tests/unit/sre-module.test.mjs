// sre module 單元測試 — Grafana 巡檢（deterministic 掃描）/ crews sync / 檔案櫃樹
import { describe, it, beforeAll, afterAll } from "vitest";
import { strict as assert } from "assert";
import http from "node:http";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";

const ROUTE = "../../installed-apps/sre/server/routes";

/** mock req（EventEmitter — readBody 用 req.on("data"/"end")） */
function mockReq(method, url, bodyObj) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  setImmediate(() => {
    if (bodyObj !== undefined) req.emit("data", Buffer.from(JSON.stringify(bodyObj)));
    req.emit("end");
  });
  return req;
}
function mockRes() {
  return {
    code: 0, body: "",
    writeHead(c) { this.code = c; },
    end(b) { this.body = b || ""; },
    json() { return JSON.parse(this.body || "null"); },
  };
}
async function call(handler, { method = "GET", url, body }) {
  const res = mockRes();
  const handled = await handler(mockReq(method, url, body), res);
  return { handled, res, data: res.json() };
}

// ── fake Grafana ──
let fake, fakePort;
beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const j = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/api/health") return j({ database: "ok", version: "11.2.0" });
    if (u.pathname === "/api/datasources") return j([{ uid: "prom", name: "Prometheus", type: "prometheus" }, { uid: "loki", name: "Loki", type: "loki" }]);
    if (u.pathname.startsWith("/api/datasources/uid/")) return j(u.pathname.includes("loki") ? { status: "error", message: "connection refused" } : { status: "OK" });
    if (u.pathname === "/api/search") return j([{ title: "A", folderTitle: "SRE" }, { title: "B", folderTitle: "SRE" }]);
    if (u.pathname === "/api/prometheus/grafana/api/v1/rules") return j({ data: { groups: [{ name: "g", rules: [{ name: "HighErrorRate", state: "firing", alerts: [{}] }] }] } });
    res.writeHead(404); res.end("{}");
  });
  await new Promise(r => fake.listen(0, "127.0.0.1", r));
  fakePort = fake.address().port;
});
afterAll(async () => { await new Promise(r => fake.close(r)); });

describe("sre module", () => {
  const cfgPath = join(process.cwd(), "data/installed-apps/sre/config/grafana.json");
  let cfgBackup = null;
  let reportFile = null;

  it("grafana inspect：健康/資料源(含個別 health)/面板/告警 → 摘要 + 報告落檔 + 待處理 action items", async () => {
    cfgBackup = existsSync(cfgPath) ? readFileSync(cfgPath, "utf-8") : null;
    const grafana = (await import(`${ROUTE}/grafana.mjs`)).default;

    // 設定連線（指向 fake grafana）
    const put = await call(grafana, { method: "PUT", url: "/api/sre/grafana", body: { baseUrl: `http://127.0.0.1:${fakePort}`, token: "test" } });
    assert.equal(put.res.code, 200);
    assert.equal(put.data.config.token, "••••••", "token 回應要遮罩");

    const r = await call(grafana, { method: "POST", url: "/api/sre/grafana/inspect", body: {} });
    assert.equal(r.res.code, 200);
    const d = r.data;
    assert.equal(d.ok, true);
    // 一顆壞資料源 → 至少 1 個 error；firing 告警 → 至少 1 個 warn
    assert.equal(d.summary.errors, 1, `errors=${d.summary.errors}`);
    assert.ok(d.summary.warns >= 1);
    assert.equal(d.summary.status, "🔴");
    const lbls = d.checks.map(c => c.label).join("|");
    assert.ok(lbls.includes("Grafana 健康") && lbls.includes("資料源 Loki") && lbls.includes("面板") && lbls.includes("HighErrorRate"), lbls);
    // 報告落檔 + 可被 briefing/radar 掃到的標記
    assert.ok(d.reportPath && existsSync(d.reportPath), "報告要落檔");
    reportFile = d.reportPath;
    const md = readFileSync(d.reportPath, "utf-8");
    assert.ok(md.includes("> status: 🔴"));
    assert.ok(/\[due:\d{4}-\d{2}-\d{2}\]/.test(md), "報告要有 [due:] 標記讓雷達掃");
    assert.ok(/- \[ \] .*來源:Grafana巡檢/.test(md), "待處理要落成 checkbox");
  });

  it("grafana：未設定連線 → 明確錯誤（不幻想數字）", async () => {
    // 暫時清空設定
    const saved = existsSync(cfgPath) ? readFileSync(cfgPath, "utf-8") : null;
    try { if (existsSync(cfgPath)) writeFileSync(cfgPath, "{}"); } catch {}
    const grafana = (await import(`${ROUTE}/grafana.mjs`)).default;
    const r = await call(grafana, { method: "POST", url: "/api/sre/grafana/inspect", body: {} });
    assert.equal(r.res.code, 400);
    assert.equal(r.data.configured, false);
    if (saved !== null) writeFileSync(cfgPath, saved);
  });

  it("crews sync：模板同步進 data/crews（冪等，第二次不重寫）", async () => {
    const { ensureBuiltinCrews, BUILTIN_FUNCTIONS } = await import(`${ROUTE}/crews.mjs`);
    ensureBuiltinCrews();
    const chief = join(process.cwd(), "data/crews/sre.chief.json");
    assert.ok(existsSync(chief), "sre.chief crew 要同步到 data/crews");
    const c = JSON.parse(readFileSync(chief, "utf-8"));
    assert.equal(c.id, "sre.chief");
    assert.deepEqual(c.toolGroups, ["core", "memory"]);
    assert.ok(c.rolePrompt.includes("SRE 總管"));
    assert.equal(ensureBuiltinCrews().length, 0, "第二次同步應為 0（冪等）");
    assert.equal(BUILTIN_FUNCTIONS.length, 7, "七個職能專家");
    for (const f of BUILTIN_FUNCTIONS) assert.ok(f.agentId.startsWith("sre."), f.agentId);
  });

  it("dossiers 樹：_global 永遠在、職能櫃 kind=function、服務櫃 kind=service", async () => {
    const { ensureBuiltinCrews } = await import(`${ROUTE}/crews.mjs`);
    ensureBuiltinCrews();
    const dossiers = (await import(`${ROUTE}/dossiers.mjs`)).default;
    const r = await call(dossiers, { method: "GET", url: "/api/sre/dossiers" });
    assert.equal(r.res.code, 200);
    const ids = r.data.services.map(s => s.id);
    assert.equal(ids[0], "_global", "_global 要排第一");
    const fn = r.data.services.filter(s => s.kind === "function").map(s => s.id);
    for (const want of ["grafana", "incident", "slo"]) assert.ok(fn.includes(want), `缺職能櫃 ${want}`);
  });

  it("radar/briefing 掃描標記：due/milestone/expires 三型可解析", () => {
    const RE = /\[(due|milestone|expires):(2\d{3}-\d{2}-\d{2})\]\s*(.+)/g;
    const md = "- [due:2026-10-20] 下次巡檢覆核\n- [milestone:2026-11-01] 壓測演練 — 通過\n- [expires:2026-12-01] token 到期";
    const found = [...md.matchAll(RE)];
    assert.equal(found.length, 3);
    assert.deepEqual(found.map(m => m[1]), ["due", "milestone", "expires"]);
  });

  it("cleanup：還原設定、移除測試報告", () => {
    if (cfgBackup !== null) writeFileSync(cfgPath, cfgBackup);
    else if (existsSync(cfgPath)) rmSync(cfgPath, { force: true });
    if (reportFile && existsSync(reportFile)) rmSync(reportFile, { force: true });
    assert.ok(true);
  });
});
