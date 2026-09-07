#!/usr/bin/env node
/**
 * scripts/pack.mjs — PAAW package 打包（第一次能 build 出可發佈的 zip）
 *
 * 用法:
 *   node scripts/pack.mjs                    # build UI + 打包到 dist/
 *   node scripts/pack.mjs --skip-build       # 跳過 vite build（UI 已建）
 *   node scripts/pack.mjs --publish URL --token XXX
 *                                            # 打包後直接推到 tpaaw-package
 *
 * 產出:
 *   dist/paaw-<version>.zip                  # 完整 code + data-seed/（不含 node_modules、不含 data/）
 *   dist/paaw-<version>.manifest.json        # { version, sha256, size, releasedAt }
 *
 * zip 內容 = 使用者機器 versions/<v>/ 的內容:
 *   package.json / package-lock.json / packages/(含 ui/dist) / scripts/ / data-seed/ ...
 *   data-seed/ 只在「使用者機器沒有 data/」時被播種，更新永不覆蓋 data/
 */

import { execSync } from "node:child_process";
import { createReadStream, createWriteStream, cpSync, mkdirSync, rmSync, statSync, existsSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const SKIP_BUILD = args.includes("--skip-build");
const PUBIdx = args.indexOf("--publish");
const TOKENIdx = args.indexOf("--token");
const PUBLISH_URL = PUBIdx >= 0 ? args[PUBIdx + 1] : null;
const TOKEN = TOKENIdx >= 0 ? args[TOKENIdx + 1] : process.env.PUBLISH_TOKEN || "";

// ---------- 0. 版本 ----------

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json")));
const VERSION = pkg.version;
if (!/^\d+\.\d+\.\d+/.test(VERSION)) {
  console.error(`✗ package.json version "${VERSION}" 不合法（需 x.y.z）`);
  process.exit(1);
}

// ---------- 1. build UI ----------

if (!SKIP_BUILD) {
  console.log("▸ vite build packages/ui …");
  execSync("npx vite build", { cwd: join(ROOT, "packages/ui"), stdio: "inherit" });
} else {
  console.log("▸ --skip-build：沿用現有 packages/ui/dist");
}
if (!existsSync(join(ROOT, "packages/ui/dist/index.html"))) {
  console.error("✗ packages/ui/dist/index.html 不存在，UI 沒建好");
  process.exit(1);
}

// ---------- 2. stage（repo 減去開發/個人/機器專屬）----------

const STAGE = join(ROOT, "dist", `stage-paaw-${VERSION}`);
const ZIP_PATH = join(ROOT, "dist", `paaw-${VERSION}.zip`);
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

console.log("▸ stage 檔案（排除開發/個人資料）…");
// rsync 規則：無斜前綴 = 任何層級 match；/ 前綴 = 只 match repo 根
// 「dist」必須根鎖定，否則 packages/ui/dist（UI build 產物）會被誤殺
// .paaw / temp / logs 任何層級都不該出貨（packages/server/.paaw 的 master.key、
// packages/*/temp 的 stream log 都曾漏進 zip）；data 只能根鎖定（packages/ui/src/data 是原始碼）
const GLOBAL_EXCLUDES = [".git", "node_modules", ".DS_Store", ".paaw", "temp", "logs"];
const ROOT_EXCLUDES = [
  "/data", "/.openclaw", "/backups",
  "/dist", "/storage", "/tmp", "/test-results", "/tests", "/coverage", "/nul",
  "/log",  // 2026-09-06 三目錄架構：runtime 垃圾跟 code 走，開機自建，永不打包
  "/.env", "/.env.dev",
  "/packages/data", "/packages/server/data",
  "/docs-paaw-sync-*",
  "/AGENTS.md", "/SOUL.md", "/USER.md", "/IDENTITY.md", "/HEARTBEAT.md", "/TOOLS.md",
  "/vitest.config.ts", "/playwright.config.ts",
];
const EXCLUDES = [...GLOBAL_EXCLUDES, ...ROOT_EXCLUDES].map((e) => `--exclude=${e}`).join(" ");

execSync(`rsync -a ${EXCLUDES} ./ "${STAGE}/"`, { cwd: ROOT, stdio: "pipe" });

// ---------- 3. data-seed（scripts/seed 骨架 + 產品資產 overlay）----------

console.log("▸ data-seed 播種（骨架 + 產品資產）…");
cpSync(join(ROOT, "scripts/seed"), join(STAGE, "data-seed"), { recursive: true });
mkdirSync(join(STAGE, "data-seed/ai-settings"), { recursive: true });
cpSync(join(ROOT, "data/ai-settings"), join(STAGE, "data-seed/ai-settings"), { recursive: true });

// crews 模板（coding.* + my.assistant + pic 頭像）— 沒播種的話 fresh install
// 的 coding app 0 個 agent、crew 系統全空。conversation/ 是 runtime 對話狀態，不播種。
mkdirSync(join(STAGE, "data-seed/crews"), { recursive: true });
for (const entry of readdirSync(join(ROOT, "data/crews"))) {
  if (entry === "conversation") continue;
  cpSync(join(ROOT, "data/crews", entry), join(STAGE, "data-seed/crews", entry), { recursive: true });
}

// 產品功能資產（2026-09-07 補齊 — 用 git ls-files 帶出，deterministic 且不含個人/runtime 內容）
// 沒這批的話 fresh install：CU/C4 引擎沒 prompt、Code Intel 沒掃描規則、skill library 全空。
const DATA_ASSETS = [
  { dir: "prompts",       exclude: [".paaw/"] },                 // CU/C4/error-code 引擎 prompts
  { dir: "semgrep-rules", exclude: [".paaw/"] },                 // Code Intel 掃描規則（含 golang 169）
  { dir: "skills",        exclude: [".paaw/"] },                 // skill library（排除開發 session）
  { dir: "apps",          exclude: [".paaw/", ".bak"] },         // 產品 demo apps（排除開發 session/.bak）
  { dir: "workflows",     exclude: [".paaw/", "_exec-history/"] }, // 範例 workflows（排除執行歷史）
];
const SEED_CONFIG_ALLOW = ["providers.example.json", "plugins.json"]; // 出廠預設；backup.json/distilled-memory/user.json 是個人/runtime 不出貨
const tracked = execSync("git ls-files data/", { cwd: ROOT, encoding: "utf8" })
  .split("\n").map(s => s.trim()).filter(Boolean);
let seeded = 0;
for (const rel of tracked) {
  // data/<dir>/<rest...>
  const sub = rel.slice("data/".length);
  const top = sub.split("/")[0];
  const asset = DATA_ASSETS.find(a => a.dir === top);
  let ship = false;
  if (asset) ship = !asset.exclude.some(x => sub.includes(x));
  else if (top === "config") ship = SEED_CONFIG_ALLOW.includes(sub.split("/")[1] || "");
  if (!ship) continue;
  const dest = join(STAGE, "data-seed", sub);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(ROOT, rel), dest);
  seeded++;
}
console.log(`  產品資產 overlay：${seeded} 檔（prompts/semgrep-rules/skills/apps/workflows/config 出廠預設）`);

// ---------- 3.5 self-check：出貨包不該出現的東西 ----------

const FORBIDDEN = [
  "log",                       // runtime 垃圾（開機自建）
  "node_modules",
  ".paaw",
  "data-seed/config/backup.json",
  "data-seed/config/distilled-memory",
  "data-seed/config/user.json",
  "data-seed/config/ui-state.json",
  "data-seed/config/recent-projects.json",
  "data-seed/config/agentic-bindings.json",
  "data-seed/notes/default",   // 個人筆記
  "data-seed/distill/knowledge", // 個人蒸餾記憶
  "data-seed/crews/conversation",
];
const violations = [];
const scanDir = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    const rel = p.slice(STAGE.length + 1);
    if (FORBIDDEN.includes(rel)) { violations.push(rel); continue; }
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === ".paaw") { violations.push(rel); continue; }
      scanDir(p);
    }
  }
};
scanDir(STAGE);
// knowledge 骨架只允許 .gitkeep（個人知識庫絕不出貨）
const kn = join(STAGE, "data-seed/knowledge");
if (existsSync(kn)) {
  const extra = readdirSync(kn).filter(f => f !== ".gitkeep");
  if (extra.length) violations.push(`data-seed/knowledge 內容: ${extra.join(", ")}`);
}
if (violations.length) {
  console.error("✗ self-check 失敗 — 出貨包出現不該有的內容:");
  for (const v of violations) console.error("   " + v);
  process.exit(1);
}
console.log("  self-check ✓（無 log/、無 .paaw、無 node_modules、無個人資料）");

// ---------- 4. zip ----------

console.log("▸ zip …");
rmSync(ZIP_PATH, { force: true });
execSync(`zip -rq "${ZIP_PATH}" .`, { cwd: STAGE, stdio: "pipe" });
const size = statSync(ZIP_PATH).size;

// ---------- 5. sha256 + manifest ----------

const sha256 = await new Promise((resolvePromise) => {
  const h = createHash("sha256");
  createReadStream(ZIP_PATH).on("data", (c) => h.update(c)).on("end", () => resolvePromise(h.digest("hex")));
});

const manifest = {
  version: VERSION,
  sha256,
  size,
  file: `paaw-${VERSION}.zip`,
  releasedAt: new Date().toISOString(),
};
const manifestPath = join(ROOT, "dist", `paaw-${VERSION}.manifest.json`);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`\n✓ paaw-${VERSION}.zip  ${(size / 1048576).toFixed(1)} MB  sha256=${sha256.slice(0, 16)}…`);
console.log(`  ${manifestPath}`);
rmSync(STAGE, { recursive: true, force: true });

// ---------- 6. publish（可選）----------

if (PUBLISH_URL) {
  if (!TOKEN) {
    console.error("✗ --publish 需要 --token 或 $PUBLISH_TOKEN");
    process.exit(1);
  }
  console.log(`▸ publish → ${PUBLISH_URL} …`);
  const buf = await new Promise((resolvePromise) => {
    const chunks = [];
    createReadStream(ZIP_PATH).on("data", (c) => chunks.push(c)).on("end", () => resolvePromise(Buffer.concat(chunks)));
  });
  const res = await fetch(`${PUBLISH_URL.replace(/\/$/, "")}/api/publish?version=${VERSION}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip" },
    body: buf,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`✗ publish 失敗 ${res.status}:`, JSON.stringify(out));
    process.exit(1);
  }
  console.log(`✓ published → stable=${out.stable?.version} sha256=${out.published?.sha256?.slice(0, 16)}…`);
}

