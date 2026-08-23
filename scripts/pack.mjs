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
import { createReadStream, createWriteStream, cpSync, mkdirSync, rmSync, statSync, existsSync, writeFileSync, readFileSync } from "node:fs";
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
const GLOBAL_EXCLUDES = [".git", "node_modules", ".DS_Store"];
const ROOT_EXCLUDES = [
  "/data", "/.paaw", "/.openclaw", "/logs", "/backups",
  "/dist", "/storage", "/tmp", "/temp", "/test-results", "/tests", "/coverage", "/nul",
  "/.env", "/.env.dev",
  "/AGENTS.md", "/SOUL.md", "/USER.md", "/IDENTITY.md", "/HEARTBEAT.md", "/TOOLS.md",
  "/vitest.config.ts", "/playwright.config.ts",
];
const EXCLUDES = [...GLOBAL_EXCLUDES, ...ROOT_EXCLUDES].map((e) => `--exclude=${e}`).join(" ");

execSync(`rsync -a ${EXCLUDES} ./ "${STAGE}/"`, { cwd: ROOT, stdio: "pipe" });

// ---------- 3. data-seed（scripts/seed + 產品級 ai-settings overlay）----------

console.log("▸ data-seed 播種（scripts/seed + ai-settings）…");
cpSync(join(ROOT, "scripts/seed"), join(STAGE, "data-seed"), { recursive: true });
mkdirSync(join(STAGE, "data-seed/ai-settings"), { recursive: true });
cpSync(join(ROOT, "data/ai-settings"), join(STAGE, "data-seed/ai-settings"), { recursive: true });

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

