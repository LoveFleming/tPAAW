/**
 * Feature Risk Scan 單元測試（2026-10-10）
 * 構成面掃描：SQL CRUD / DDL migration / API 介面 / 外部服務 / mutating outbound
 * 嚴重度計算：S0（select/無）< S1（insert/update/mutating outbound）< S2（delete/DDL）
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanFeatureRisk, isValidSeverity, SEVERITY_LEVELS } from "../../packages/server/src/lib/feature-risk-scan.mjs";

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "risk-scan-"));
  const rels = [];
  for (const [name, content] of Object.entries(files)) {
    const slash = name.lastIndexOf("/");
    if (slash > 0) mkdirSync(join(dir, name.slice(0, slash)), { recursive: true });
    writeFileSync(join(dir, name), content);
    rels.push(name);
  }
  return { dir, rels };
}

test("S0：純 SELECT → 低風險", async () => {
  const { dir, rels } = fixture({
    "repo.mjs": 'const rows = db.prepare("SELECT id, name FROM users WHERE id = ?").all(id);\nconst q2 = `SELECT * FROM quiz_results ORDER BY created_at DESC`;',
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.equal(r.computedSeverity, "S0");
  assert.equal(r.dataTouch.length, 2);
  const targets = r.dataTouch.map(d => d.target).sort();
  assert.deepEqual(targets, ["quiz_results", "users"]);
  assert.ok(r.dataTouch.every(d => d.ops.includes("select")));
  rmSync(dir, { recursive: true, force: true });
});

test("S1：INSERT/UPDATE → 中風險", async () => {
  const { dir, rels } = fixture({
    "save.mjs": 'db.run("INSERT INTO learning_log (uid, score) VALUES (?, ?)");\ndb.run("UPDATE users SET streak = streak + 1 WHERE id = ?");',
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.equal(r.computedSeverity, "S1");
  const ops = new Set(r.dataTouch.flatMap(d => d.ops));
  assert.ok(ops.has("insert"));
  assert.ok(ops.has("update"));
  rmSync(dir, { recursive: true, force: true });
});

test("S2：DELETE → 高風險", async () => {
  const { dir, rels } = fixture({
    "del.mjs": 'db.run("DELETE FROM sessions WHERE expired = 1");',
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.equal(r.computedSeverity, "S2");
  rmSync(dir, { recursive: true, force: true });
});

test("S2：CREATE/ALTER/DROP TABLE（migration）→ 高風險", async () => {
  const { dir, rels } = fixture({
    "migrate.sql": "CREATE TABLE audit_events (id INTEGER PRIMARY KEY);\nALTER TABLE users ADD COLUMN tier TEXT;",
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.equal(r.computedSeverity, "S2");
  assert.equal(r.migration, true);
  rmSync(dir, { recursive: true, force: true });
});

test("migration 檔名判定（無 DDL 內容但檔名含 migration）", async () => {
  const { dir, rels } = fixture({
    "migrations/001-init.mjs": 'export const up = (db) => db.run("SELECT 1");',
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.equal(r.migration, true);
  assert.equal(r.computedSeverity, "S2");
  rmSync(dir, { recursive: true, force: true });
});

test("S1：mutating outbound（fetch POST）→ 中風險", async () => {
  const { dir, rels } = fixture({
    "notify.mjs": 'await fetch("https://api.example.com/v1/notify", { method: "POST", body: JSON.stringify(msg) });',
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.equal(r.computedSeverity, "S1");
  assert.equal(r.mutatingOutbound, true);
  assert.deepEqual(r.externalCalls, ["api.example.com"]);
  rmSync(dir, { recursive: true, force: true });
});

test("外部 URL 抽取：localhost 排除、大小寫正規化、去重", async () => {
  const { dir, rels } = fixture({
    "a.mjs": 'fetch("http://localhost:9200/_search"); fetch("https://GitHub.com/api"); fetch("https://github.com/repos"); fetch("http://127.0.0.1:4097/api");',
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.deepEqual(r.externalCalls, ["github.com"]);
  rmSync(dir, { recursive: true, force: true });
});

test("API surface：/api/... 字串抽取 + :param 截斷", async () => {
  const { dir, rels } = fixture({
    "route.mjs": 'if (url === "/api/coding-features") {}\nconst m = url.match(/^\\/api\\/coding-features\\/([^/?]+)\\/severity$/);\nrouter.get("/api/ru/model/:id");',
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.ok(r.apiSurface.includes("/api/coding-features"));
  // regex 樣式 /^\/api\/coding-features\/...$/ 抽出的同名 path 去重後同一筆
  assert.ok(r.apiSurface.includes("/api/ru/model")); // :id 變數段截斷
  rmSync(dir, { recursive: true, force: true });
});

test("SQL 關鍵字誤捕排除（FROM SELECT 等）", async () => {
  const { dir, rels } = fixture({
    "weird.mjs": 'const q = "SELECT * FROM select WHERE x = 1";', // 表名是保留字 → 應被丟棄
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.equal(r.computedSeverity, "S0"); // 只剩 select → S0
  rmSync(dir, { recursive: true, force: true });
});

test("INSERT OR REPLACE INTO 也算 insert", async () => {
  const { dir, rels } = fixture({
    "cache.mjs": 'db.run("INSERT OR REPLACE INTO cache (k, v) VALUES (?, ?)", [k, v]);',
  });
  const r = await scanFeatureRisk(dir, { codeFiles: rels });
  assert.equal(r.computedSeverity, "S1");
  assert.ok(r.dataTouch.some(d => d.target === "cache" && d.ops.includes("insert")));
  rmSync(dir, { recursive: true, force: true });
});

test("無 codeFiles / 檔案不存在 → S0 不炸", async () => {
  const r1 = await scanFeatureRisk("/tmp", { codeFiles: [] });
  assert.equal(r1.computedSeverity, "S0");
  const r2 = await scanFeatureRisk("/tmp", { codeFiles: ["nope/missing.mjs"] });
  assert.equal(r2.computedSeverity, "S0");
  assert.equal(r2.fileCount, 0);
});

test("isValidSeverity", () => {
  for (const s of SEVERITY_LEVELS) assert.ok(isValidSeverity(s));
  assert.ok(!isValidSeverity("S3"));
  assert.ok(!isValidSeverity("high"));
  assert.ok(!isValidSeverity(""));
});

test("真實 tPAAW 程式碼掃描煙霧測試（coding-features 路由檔）", async () => {
  const r = await scanFeatureRisk(process.cwd(), {
    codeFiles: ["packages/server/src/routes/coding-features.mjs"],
  });
  // 此檔只有讀寫 FEATURES.json（無 SQL）+ /api/ 路由字串一堆
  assert.ok(r.apiSurface.some(p => p.startsWith("/api/coding-features")));
  assert.ok(r.fileCount >= 1);
});
