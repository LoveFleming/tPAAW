/**
 * coding-handover.mjs — Handover（交接）API Routes
 *
 * 「人要可以很容易懂、可以接手、指揮 AI 開發和維運」
 *
 * 交接包 = 新工程師（或新 AI agent）接手一個 Release Unit 所需的最小上下文：
 *   專案是什麼（PROJECT/ARCHITECTURE）→ 為什麼這樣設計（DECISIONS）
 *   → 最近改了什麼（CHANGELOG + git log）→ 進行中的工作（active tasks）
 *   → 怎麼跑起來（scripts）
 *
 * Routes:
 *   GET  /api/coding-handover/bundle?path=...    — 交接包聚合（即時，deterministic 零 token）
 *   POST /api/coding-handover/generate           — 生成 .paaw/HANDOVER.md
 *   GET  /api/coding-handover/brief?path=...     — AI 摘要包（quickstart/決策挖掘/地雷區；2026-10-10）
 *   POST /api/coding-handover/brief?path=...     — 懶生成/重生成 brief（1 次 LLM；CU 不觸發 — Fleming 拍板進頁才燒）
 *   PUT  /api/coding-handover/remark?path=...    — 人員注記（獨立檔 handover-remarks.json — 重生成永不覆蓋）
 *   DELETE /api/coding-handover/remark?path=&id= — 刪注記
 *
 * 2026-10-10 Fleming 拍板：brief 懶生成（進 handover page 才觸發，平時/CU 不燒 token）；
 * 人員注記是作者資產永久保留；「為什麼」= AI 從 git/task 挖 + evidence，人 optional 補注記。
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { exec as _exec } from "child_process";
import { promisify } from "util";
import { buildHandoverState, writeHandoverState, loadHandoverState } from "../lib/release-unit/handover-state.mjs";
import { callProjectLLM, PAAW_ROOT } from "./coding-helpers.mjs"; // 2026-11-08 修：coding.mjs 已改 import 不再 re-export，6 模組載入失敗
import { stableStringify } from "../lib/stable-stringify.mjs";
import { loadFeatures } from "../lib/feature-registry.mjs";

const execAsync = promisify(_exec);

// .paaw 重構後知識檔案在子目錄（見 paaw-project.mjs FILE_MAP）
// Slim CU：只保留人寫的 PROJECT.md + Coding Standards
const KNOWLEDGE_SOURCES = [
  { key: "project", file: "project/PROJECT.md", label: "專案概覽" },
];

async function readKnowledgeFile(projectPath, rel) {
  const p = join(projectPath, ".paaw", rel);
  if (existsSync(p)) return readFile(p, "utf-8");
  // fallback：重構前的根目錄位置（e.g. .paaw/PROJECT.md）
  const legacy = join(projectPath, ".paaw", rel.split("/").pop());
  if (existsSync(legacy)) return readFile(legacy, "utf-8");
  return null;
}

async function gitLog(projectPath, n = 15) {
  try {
    const { stdout } = await execAsync(`git log --oneline -n ${n}`, { cwd: projectPath, timeout: 10000 });
    return stdout.trim().split("\n").filter(Boolean);
  } catch { return []; }
}

async function gitStatusShort(projectPath) {
  try {
    const { stdout } = await execAsync("git status --porcelain | head -20", { cwd: projectPath, timeout: 10000 });
    const lines = stdout.trim().split("\n").filter(Boolean);
    return { dirty: lines.length > 0, files: lines };
  } catch { return { dirty: false, files: [] }; }
}

async function loadPackageInfo(projectPath) {
  const pkgFile = join(projectPath, "package.json");
  if (!existsSync(pkgFile)) return null;
  try {
    const pkg = JSON.parse(await readFile(pkgFile, "utf-8"));
    return {
      name: pkg.name || null,
      scripts: pkg.scripts || {},
      dependencies: Object.keys(pkg.dependencies || {}),
      devDependenciesCount: Object.keys(pkg.devDependencies || {}).length,
    };
  } catch { return null; }
}

async function loadActiveTasks(projectPath) {
  const tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
  if (!existsSync(tasksFile)) return [];
  try {
    const data = JSON.parse(await readFile(tasksFile, "utf-8"));
    return (data.tasks || [])
      .filter(t => ["open", "in-progress", "todo"].includes(t.status))
      .slice(0, 10)
      .map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority || "normal" }));
  } catch { return []; }
}

async function loadReleasesSummary(projectPath) {
  const dir = join(projectPath, ".paaw", "releases");
  if (!existsSync(dir)) return [];
  const { readdir } = await import("fs/promises");
  const files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 5);
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(await readFile(join(dir, f), "utf-8"));
      out.push({ id: r.id, taskId: r.taskId, title: r.title, releasedAt: r.releasedAt });
    } catch { /* skip */ }
  }
  return out;
}

async function buildBundle(projectPath) {
  const initialized = existsSync(join(projectPath, ".paaw"));
  const knowledge = {};
  for (const src of KNOWLEDGE_SOURCES) {
    knowledge[src.key] = await readKnowledgeFile(projectPath, src.file);
  }
  const [log, status, pkg, activeTasks, releases] = await Promise.all([
    gitLog(projectPath),
    gitStatusShort(projectPath),
    loadPackageInfo(projectPath),
    loadActiveTasks(projectPath),
    loadReleasesSummary(projectPath),
  ]);
  return {
    initialized,
    generatedAt: new Date().toISOString(),
    knowledge,
    git: { log, status },
    package: pkg,
    activeTasks,
    releases,
    hasKnowledge: !!knowledge.project,
  };
}

function renderHandoverMd(bundle) {
  const k = bundle.knowledge;
  const L = [];
  L.push("# HANDOVER — 交接文件");
  L.push("");
  L.push(`> 生成時間：${bundle.generatedAt}`);
  L.push("> 這份文件是給下一位工程師（或 AI agent）的最小接手上下文。");
  L.push("");
  L.push("## 1. 這是什麼專案？");
  L.push("");
  L.push(k.project ? k.project.split("\n").slice(0, 40).join("\n") : "_(尚未建立 PROJECT.md — 請人工填寫)_");
  L.push("");
  L.push("## 2. 最近變更");
  L.push("");
  if (bundle.git.log.length) {
    L.push("### Git 歷史（最近 15 筆）");
    L.push("```");
    L.push(bundle.git.log.join("\n"));
    L.push("```");
  }
  L.push("");
  L.push("## 3. 進行中的工作");
  L.push("");
  if (bundle.activeTasks.length) {
    for (const t of bundle.activeTasks) L.push(`- [${t.status}] ${t.id} — ${t.title}（${t.priority}）`);
  } else {
    L.push("_(沒有進行中的 task)_");
  }
  L.push("");
  L.push("## 4. 怎麼跑起來");
  L.push("");
  if (bundle.package?.scripts && Object.keys(bundle.package.scripts).length) {
    const common = ["dev", "start", "build", "test", "lint"];
    L.push("```bash");
    for (const s of common) {
      if (bundle.package.scripts[s]) L.push(`npm run ${s}    # ${bundle.package.scripts[s].slice(0, 60)}`);
    }
    L.push("```");
  } else {
    L.push("_(沒有 package.json scripts — 依專案類型自行確認)_");
  }
  L.push("");
  L.push("## 5. Release 歷史（最近 5 筆）");
  L.push("");
  if (bundle.releases.length) {
    for (const r of bundle.releases) L.push(`- ${r.releasedAt} — ${r.id} — ${r.title}`);
  } else {
    L.push("_(尚未有 release 記錄)_");
  }
  L.push("");
  L.push("## 7. 接手指引");
  L.push("");
  L.push("1. 讀完 1–3 節建立全貌");
  L.push("2. `git log` 看最近改動方向");
  L.push("3. 檢查第 5 節進行中 task，跟 EM 確認優先序");
  L.push("4. 有問題問 Handover AI 助理（它讀得到這份知識庫）");
  return L.join("\n");
}

// ═══ AI 摘要包 brief（2026-10-10）— 懶生成：進 handover page 才觸發 ═══

function briefFilePath(projectPath) { return join(projectPath, ".paaw", "handover-brief.json"); } // nosemgrep: path-join-resolve-traversal — local-first：使用者自選專案根目錄
function remarksFilePath(projectPath) { return join(projectPath, ".paaw", "handover-remarks.json"); } // nosemgrep: path-join-resolve-traversal — 同上

async function loadBrief(projectPath) {
  try { return JSON.parse(await readFile(briefFilePath(projectPath), "utf-8")); } catch { return null; }
}
async function loadRemarks(projectPath) {
  try { const r = JSON.parse(await readFile(remarksFilePath(projectPath), "utf-8")); return Array.isArray(r) ? r : []; } catch { return []; }
}
async function saveJson(pathAbs, obj) {
  const { mkdir } = await import("fs/promises");
  await mkdir(join(pathAbs, ".."), { recursive: true }); // nosemgrep: detect-non-literal-fs-filename — local-first
  await writeFile(pathAbs, stableStringify(obj) + "\n", "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first
}

// deterministic 原料（零 token）：features+severity / tasks / git log / scripts
async function collectBriefFacts(projectPath) {
  const facts = { features: [], tasks: [], gitLog: [], scripts: {}, pkgName: "", engines: null, hasReadme: false, hasEnvExample: false };
  try {
    const features = loadFeatures(projectPath); // coding.db
    facts.features = features.map(f => ({ name: f.name, severity: f.severity || f.severitySuggested || null, desc: String(f.description || "").slice(0, 120) }));
  } catch { /* CU 未跑 */ }
  try {
    const raw = JSON.parse(await readFile(join(projectPath, ".paaw", "tasks", "TASKS.json"), "utf-8"));
    const tasks = Array.isArray(raw) ? raw : (raw.tasks || []);
    facts.tasks = tasks.slice().sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))).slice(0, 20)
      .map(t => ({ title: String(t.title || t.name || "").slice(0, 100), commit: t.git?.commit || t.changes?.commit || null }));
  } catch { /* 無 tasks */ }
  try {
    const { stdout } = await execAsync("git log --oneline --no-color -60", { cwd: projectPath, timeout: 10000 });
    facts.gitLog = stdout.trim().split("\n").filter(Boolean);
  } catch { /* 非 git repo */ }
  try {
    const pkg = JSON.parse(await readFile(join(projectPath, "package.json"), "utf-8"));
    facts.scripts = pkg.scripts || {}; facts.pkgName = pkg.name || ""; facts.engines = pkg.engines || null;
  } catch { /* 無 package.json */ }
  facts.hasReadme = existsSync(join(projectPath, "README.md")) || existsSync(join(projectPath, "README.zh-TW.md"));
  facts.hasEnvExample = existsSync(join(projectPath, ".env.example"));
  return facts;
}

// 1 次 LLM：summary + quickstart + 決策挖掘（帶 evidence，挖不到標 gap）+ 地雷區
async function generateBriefAi(facts) {
  const prompt = `You are a senior engineer preparing a handover brief for the next developer of this release unit.
Analyze the FACTS and output STRICT JSON only (no markdown fence).

FACTS:
- package: ${facts.pkgName || "(unknown)"}${facts.engines ? ` engines=${JSON.stringify(facts.engines)}` : ""}
- scripts: ${JSON.stringify(facts.scripts).slice(0, 600)}
- readme: ${facts.hasReadme}; .env.example: ${facts.hasEnvExample}
- features (${facts.features.length}): ${facts.features.map(f => `${f.name}[${f.severity || "?"}]`).slice(0, 40).join(", ")}
- recent tasks: ${facts.tasks.slice(0, 12).map(t => t.title).join(" | ")}
- git log (newest first):
${facts.gitLog.slice(0, 60).join("\n")}

OUTPUT JSON:
{
  "summary": "一句話：這系統是什麼（zh-TW）",
  "quickstart": { "steps": ["起手步驟（從 scripts/事實推導，不確定標(?)）"], "env": ["環境需求"] },
  "decisions": [ { "title": "決策", "why": "為什麼（從 commit/task 訊息推導）", "evidence": "真實 commit hash 或 task 標題", "gap": false } ],
  "dangerZones": ["最危險區域（severity S2 優先 + fix hotspot）"]
}
Rules: decisions 最多 8 條；evidence 必須真實存在於 git log/task — 不編造；重要決策無痕跡 → gap=true evidence=（無紀錄）；dangerZones 最多 5 條；全部 zh-TW。`;

  const result = await callProjectLLM({
    messages: [
      { role: "system", content: "You are a precise code analyst. Output STRICT JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  }, { caller: "handover-brief" });

  const m = (result?.content || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]);
    return {
      summary: String(d.summary || "").slice(0, 400),
      quickstart: {
        steps: Array.isArray(d.quickstart?.steps) ? d.quickstart.steps.slice(0, 12).map(x => String(x).slice(0, 200)) : [],
        env: Array.isArray(d.quickstart?.env) ? d.quickstart.env.slice(0, 8).map(x => String(x).slice(0, 120)) : [],
      },
      decisions: Array.isArray(d.decisions) ? d.decisions.slice(0, 8).map(x => ({
        title: String(x?.title || "").slice(0, 120), why: String(x?.why || "").slice(0, 400),
        evidence: String(x?.evidence || "").slice(0, 160), gap: !!x?.gap,
      })).filter(x => x.title) : [],
      dangerZones: Array.isArray(d.dangerZones) ? d.dangerZones.slice(0, 5).map(x => String(x).slice(0, 160)) : [],
    };
  } catch { return null; }
}

// ── Route Handler ──

// ═══ Handover 文件 v2 — 證據採集 + 一鍵生成（2026-11-08）═══

function handoverDocPath(projectPath) { return join(projectPath, ".paaw", "handover", "handover-doc.json"); } // nosemgrep: path-join-resolve-traversal — local-first

async function loadHandoverDoc(projectPath) {
  try { return JSON.parse(await readFile(handoverDocPath(projectPath), "utf-8")); } catch { return null; }
}

// 跨平台檔案掃描（MEMORY 紀律：絕不用 Unix find/grep — 公司 Windows 會炸）
function walkProject(projectPath, { maxFiles = 500, maxDepth = 4, maxBytes = 200 * 1024 } = {}) {
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "vendor", ".paaw", "tmp", ".cache", "__pycache__"]);
  const files = [];
  const walk = (dir, depth) => {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= maxFiles) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.size > maxBytes) continue;
      files.push({ path: p, rel: p.slice(projectPath.length + 1), size: st.size });
    }
  };
  walk(projectPath, 0);
  return files;
}

async function collectDocFacts(projectPath) {
  const facts = {
    pkg: null, scripts: {}, envKeys: [], hasEnvExample: false,
    dbFiles: [], dataDirs: [], sqliteDeps: [],
    externalDeps: [], authFiles: [], cacheFiles: [], portHits: [],
    riskFeatures: [], hotFiles: [], aiWorkflow: {}, readmeHead: "",
  };
  try {
    const pkg = JSON.parse(await readFile(join(projectPath, "package.json"), "utf-8"));
    facts.pkg = { name: pkg.name, version: pkg.version, workspaces: pkg.workspaces || null, engines: pkg.engines || null };
    facts.scripts = pkg.scripts || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const depNames = Object.keys(deps);
    const SERVICE_PATTERNS = {
      "OpenAI": /openai/, "Anthropic/Claude": /anthropic/, "Google AI": /(@google|gemini)/, "AWS": /aws-sdk|@aws/, "Cloudflare": /wrangler|cloudflare/,
      "LINE": /linebot|@line/, "Slack": /@slack|slack-sdk/, "Discord": /discord\.js/, "Telegram": /telegraf|grammy/, "Stripe": /stripe/,
      "SMTP/Email": /nodemailer|@sendgrid/, "Redis": /redis|ioredis/, "SQLite": /better-sqlite3|sqlite3|prisma|drizzle|@libsql/,
      "Playwright/瀏覽器": /playwright|puppeteer/, "向量库": /chromadb|qdrant|pinecone|pgvector/,
    };
    for (const [label, re] of Object.entries(SERVICE_PATTERNS)) {
      const hit = depNames.filter(d => re.test(d));
      if (hit.length) { facts.externalDeps.push(`${label}: ${hit.slice(0, 3).join(", ")}`); if (/SQLite|Redis/.test(label)) facts.sqliteDeps.push(label); }
    }
  } catch { /* 無 package.json */ }
  // env key 名（絕不讀值）
  for (const envName of [".env.example", ".env"]) {
    const p = join(projectPath, envName);
    if (!existsSync(p)) continue;
    if (envName === ".env.example") facts.hasEnvExample = true;
    try {
      const keys = (await readFile(p, "utf-8")).split("\n").map(l => l.split("=")[0].trim()).filter(k => k && !k.startsWith("#"));
      facts.envKeys.push(...keys.slice(0, 30));
    } catch { /* EPERM */ }
  }
  // 環境版本線索（2026-11-08 Fleming：接手的人要知道 Node 版本）
  for (const vf of [".nvmrc", ".node-version"]) {
    const p = join(projectPath, vf);
    if (existsSync(p)) { try { facts.envKeys.push(`${vf}=${(await readFile(p, "utf-8")).trim()}`); } catch {} }
  }
  facts.envKeys = [...new Set(facts.envKeys)];
  // 檔案掃描（node_modules/.git/.paaw 跳過）
  const files = walkProject(projectPath);
  for (const f of files) {
    const low = f.rel.toLowerCase();
    if (/\.(db|sqlite|sqlite3)$/.test(low)) facts.dbFiles.push(f.rel);
    if (/(^|\/)(data|uploads?|storage|assets)\//.test(low) && !facts.dataDirs.includes(low.split("/")[0])) facts.dataDirs.push(low.split("/")[0] + "/");
    if (/(auth|login|session|jwt|passport|middleware)/.test(low) && /\.(ts|tsx|mjs|js|py)$/.test(low)) facts.authFiles.push(f.rel);
    if (/cache/.test(low) && /\.(ts|tsx|mjs|js)$/.test(low)) facts.cacheFiles.push(f.rel);
  }
  facts.dbFiles = facts.dbFiles.slice(0, 10); facts.dataDirs = facts.dataDirs.slice(0, 6);
  facts.authFiles = facts.authFiles.slice(0, 12); facts.cacheFiles = facts.cacheFiles.slice(0, 12);
  // 內容掃描：port / cache 使用點 / 認證機制線索（讀前 200 檔內容，200KB 上限已在 walk 過濾）
  try {
    const fsMod = _requireFs();
    let scanned = 0;
    for (const f of files) {
      if (scanned >= 200) break;
      if (!/\.(ts|tsx|mjs|js|py|json|example)$/.test(f.rel)) continue;
      let txt; try { txt = readFileSync(f.path, "utf-8"); } catch { continue; }
      scanned++;
      const port = txt.match(/port["'?\s:=]+(\d{4,5})/i);
      if (port && facts.portHits.length < 6 && !facts.portHits.includes(port[1])) facts.portHits.push(port[1]);
      if (/jwt\.sign|verifyToken|bearer|passport|bcrypt|argon2|createHash\(.{0,20}(password|secret)/i.test(txt) && !facts.authFiles.includes(f.rel)) facts.authFiles.push(f.rel);
      if (/(in-memory cache|memoiz|lru|ttl|Cache-Control|max-age=|new Map\(\)[^;]{0,40}cache)/i.test(txt) && !facts.cacheFiles.includes(f.rel)) facts.cacheFiles.push(f.rel);
    }
  } catch { /* 掃描失敗不影響其他面向 */ }
  facts.authFiles = facts.authFiles.slice(0, 14); facts.cacheFiles = facts.cacheFiles.slice(0, 14);
  // 風險：S2/S1 features + git 熱點檔
  try {
    const features = loadFeatures(projectPath);
    facts.riskFeatures = features.filter(f => ["S2", "S1"].includes(f.severity)).slice(0, 8).map(f => `${f.name}[${f.severity}]`);
  } catch { /* coding.db 未建 */ }
  try {
    const { stdout } = await execAsync("git log --name-only --pretty=format: -100", { cwd: projectPath, timeout: 10000 });
    const counts = {};
    for (const l of stdout.split("\n")) { const t = l.trim(); if (t) counts[t] = (counts[t] || 0) + 1; }
    facts.hotFiles = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, c]) => `${f} (${c}次)`);
  } catch { /* 非 git repo */ }
  // AI 工作流線索
  facts.aiWorkflow = {
    hasPaaw: existsSync(join(projectPath, ".paaw")),
    hasTasks: existsSync(join(projectPath, ".paaw", "tasks", "TASKS.json")),
    hasCrews: existsSync(join(projectPath, ".paaw", "agents")),
    hasCodingDb: existsSync(join(projectPath, ".paaw", "coding.db")),
  };
  // README 開頭
  for (const rn of ["README.md", "README.zh-TW.md", "readme.md"]) {
    const p = join(projectPath, rn);
    if (existsSync(p)) { try { facts.readmeHead = (await readFile(p, "utf-8")).slice(0, 800); } catch {} break; }
  }
  return facts;
}

const HO_DOC_SECTIONS = [
  { key: "positioning", icon: "🎯", title: "專案定位" },
  { key: "techStack", icon: "🧱", title: "技術棧" },
  { key: "storage", icon: "💾", title: "Storage 資料儲存" },
  { key: "externalServices", icon: "🔌", title: "外部服務與金鑰" },
  { key: "auth", icon: "🔐", title: "認證方式" },
  { key: "cache", icon: "⚡", title: "Cache 機制" },
  { key: "risks", icon: "⚠️", title: "高風險區" },
  { key: "aiWorkflow", icon: "🛠️", title: "AI 開發方式（教 AI 做事）" },
  { key: "quickstart", icon: "▶️", title: "怎麼跑起來" },
];

async function generateHandoverDoc(projectPath) {
  const facts = await collectDocFacts(projectPath);
  const sectionList = HO_DOC_SECTIONS.map(s => `- ${s.key}（${s.title}）`).join("\n");
  const prompt = `你是資深工程師，為下一位接手「${facts.pkg?.name || "此專案"}」的人寫交接文件。只能根據以下真實掃描證據寫，寫不出來的面向誠實標「（未發現線索，需人工確認）」，絕不編造。

證據（自動掃描）：
- package: ${JSON.stringify(facts.pkg)}${facts.pkg?.workspaces ? "（monorepo workspaces）" : ""}${facts.pkg?.engines ? `；Node 版本需求 engines=${JSON.stringify(facts.pkg.engines)}` : ""}
- scripts: ${JSON.stringify(facts.scripts).slice(0, 500)}
- env 變數名（只有名字，值不外洩）: ${facts.envKeys.slice(0, 20).join(", ") || "（無 .env）"}${facts.hasEnvExample ? "；有 .env.example" : ""}
- DB 檔案: ${facts.dbFiles.join(", ") || "（沒掃到 .db/.sqlite）"}；DB 相關依賴: ${facts.sqliteDeps.join(", ") || "無"}
- 資料目錄: ${facts.dataDirs.join(", ") || "（無 data/uploads/storage 目錄）"}
- 外部服務依賴: ${facts.externalDeps.join("；") || "（無已知第三方服務依賴）"}
- 認證相關檔案: ${facts.authFiles.join(", ") || "（未掃到 auth/login/session/jwt 檔）"}
- Cache 相關檔案: ${facts.cacheFiles.join(", ") || "（未掃到 cache 相關檔）"}
- Port 線索: ${facts.portHits.join(", ") || "（未掃到）"}
- 高風險 features（S1/S2）: ${facts.riskFeatures.join(", ") || "（無 severity 標記或 coding.db 未建）"}
- Git 熱點檔（最近 100 commits 最多改）: ${facts.hotFiles.join(", ") || "（非 git repo）"}
- AI 工作流: .paaw=${facts.aiWorkflow.hasPaaw} TASKS.json=${facts.aiWorkflow.hasTasks} coding.db=${facts.aiWorkflow.hasCodingDb}
- README 開頭：\n${facts.readmeHead || "（無 README）"}

輸出 STRICT JSON（無 markdown fence）：
{
${HO_DOC_SECTIONS.map(s => `  "${s.key}": "markdown 字串（zh-TW，精簡，每節 3-8 行，可用列表）"`).join(",\n")}
}
規則：storage 要講「哪些資料在哪、哪些是使用者資料不能亂刪」；externalServices 要列服務+金鑰在 .env 的變數名；auth 描述登入/token 機制與檔案位置；cache 講哪裡有 cache/何時失效/改資料要清什麼；risks 結合熱點檔+severity；aiWorkflow 教「在 PAAW coding app 裡怎麼開發此專案：SA 開 task → EM 派工給 developer/tester → 委員會 review → release」，並註明專案的 .paaw 狀態；quickstart 給實際 npm 指令（從 scripts）+ env 設定步驟，最後加「**接手第一步**」3 步起手式（含：開一個小 task 給 EM 跑一輪練手感）。`;

  const [mainRes, faqMd] = await Promise.all([
    callProjectLLM({
      messages: [
        { role: "system", content: "You are a precise code analyst. Output STRICT JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }, { caller: "handover-doc" }),
    generateHelpdeskFaq(projectPath, facts),
  ]);

  let sections = {};
  try {
    const m = (mainRes?.content || "").match(/\{[\s\S]*\}/);
    const d = JSON.parse(m[0]);
    for (const s of HO_DOC_SECTIONS) {
      if (typeof d[s.key] === "string" && d[s.key].trim()) sections[s.key] = d[s.key].slice(0, 4000);
    }
  } catch { /* JSON 解析失敗 → sections 空手，UI 顯示失敗訊息 */ }
  if (!Object.keys(sections).length) throw new Error("AI 未回傳可解析的 sections");
  const doc = {
    version: 2,
    generatedAt: new Date().toISOString(),
    sections,
    faq: faqMd || "（FAQ 生成失敗 — 可重新一鍵生成）",
    meta: { filesScanned: true, envKeyCount: facts.envKeys.length },
  };
  const { mkdir } = await import("fs/promises");
  await mkdir(join(projectPath, ".paaw", "handover"), { recursive: true }); // nosemgrep: detect-non-literal-fs-filename — local-first
  await writeFile(handoverDocPath(projectPath), stableStringify(doc) + "\n", "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first
  return doc;
}

// 疑難排解 FAQ：helpdesk agent 的 rolePrompt + 專案證據 → 常見問題 Q&A（Fleming 2026-11-08：疑難排解要 helpdesk agent 回答）
async function generateHelpdeskFaq(projectPath, facts) {
  let rolePrompt = "";
  try {
    const crewFile = join(PAAW_ROOT, "packages", "modules", "coding", "crews", "coding.helpdesk.json");
    const alt = join(PAAW_ROOT, "data", "crews", "coding.helpdesk.json");
    rolePrompt = existsSync(crewFile) ? (await readFile(crewFile, "utf-8")) : existsSync(alt) ? (await readFile(alt, "utf-8")) : "";
    rolePrompt = (JSON.parse(rolePrompt).rolePrompt || "").slice(0, 1500);
  } catch { /* fallback 空白 — 用通用 helpdesk 語氣 */ }
  const q = `專案「${facts.pkg?.name || "?"}」交接 FAQ：請根據證據回答 5-7 個接手的人最常問的問題（怎麼跑起來/測試怎麼跑/db 壞了怎麼辦/環境變數缺了會怎樣/log 在哪看/改了前端沒生效…依證據調整）。
證據：scripts=${JSON.stringify(facts.scripts).slice(0, 300)}；env keys=${facts.envKeys.slice(0, 15).join(",")}；db=${facts.dbFiles.join(",")}；ports=${facts.portHits.join(",")}。
輸出 markdown（zh-TW）：### Q：…\n答：…每題 2-4 行，不確定的誠實說。`;
  try {
    const r = await callProjectLLM({
      messages: [
    { role: "system", content: rolePrompt || "你是細心的事案 helpdesk 工程師，回答精準誠實。" },
        { role: "user", content: q },
      ],
      temperature: 0.3,
    }, { caller: "handover-faq" });
    return (r?.content || "").slice(0, 4000);
  } catch { return null; }
}

export default async function handoverRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  if (!url.startsWith("/api/coding-handover")) return next?.() ?? false;

  const projectPath = q.get("path");

  if (url === "/api/coding-handover/state" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      return res.status(400).json({ error: "path required" });
    }
    // ?refresh=1 → 現場重建並落地；否則讓快取（自動保鮮的 handover-state.json）優先
    if (q.get("refresh") === "1") {
      const st = await writeHandoverState(projectPath);
      return res.json(st);
    }
    const st = await loadHandoverState(projectPath);
    return res.json(st);
  }

  if (url === "/api/coding-handover/bundle" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      return res.status(400).json({ error: "path required" });
    }
    const bundle = await buildBundle(projectPath);
    return res.json(bundle);
  }

  // ── brief：AI 摘要包（懶生成）──
  if (url === "/api/coding-handover/brief" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    const [brief, remarks] = await Promise.all([loadBrief(projectPath), loadRemarks(projectPath)]);
    return res.json({ brief, remarks });
  }
  if (url === "/api/coding-handover/brief" && method === "POST") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    const facts = await collectBriefFacts(projectPath);
    const ai = await generateBriefAi(facts);
    const brief = {
      version: 1,
      generatedAt: new Date().toISOString(),
      severityCounts: {
        S2: facts.features.filter(f => f.severity === "S2").length,
        S1: facts.features.filter(f => f.severity === "S1").length,
        S0: facts.features.filter(f => f.severity === "S0").length,
        unconfirmed: facts.features.filter(f => !f.severity).length,
      },
      ai: ai || { error: "AI 摘要生成失敗 — 可按重新生成重試（deterministic 部分不受影響）" },
    };
    await saveJson(briefFilePath(projectPath), brief);
    return res.json({ ok: true, brief, remarks: await loadRemarks(projectPath) });
  }

  // ── remark：人員注記（獨立檔 — brief 重生成永不覆蓋）──
  if (url === "/api/coding-handover/remark" && method === "PUT") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch { /* empty */ }
    const text = String(body.text || "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: "text required" });
    const remarks = await loadRemarks(projectPath);
    remarks.push({
      id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      target: String(body.target || "general").slice(0, 80),
      text, author: String(body.author || "user").slice(0, 40), at: new Date().toISOString(),
    });
    await saveJson(remarksFilePath(projectPath), remarks);
    return res.json({ ok: true, remarks });
  }
  if (url === "/api/coding-handover/remark" && method === "DELETE") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    const id = String(q.get("id") || "");
    const remarks = (await loadRemarks(projectPath)).filter(r => r.id !== id);
    await saveJson(remarksFilePath(projectPath), remarks);
    return res.json({ ok: true, remarks });
  }

  // ═══ Handover 文件 v2（2026-11-08 Fleming：面向式交接 — 一鍵生成，人不介入）═══
  // 面向：專案定位/技術棧/Storage/外部服務/認證/Cache/高風險區/AI 開發方式（SA 開 task→EM 派工）/怎麼跑起來 — AI 從專案實檔採證據生 markdown；疑難排解 = helpdesk agent 出 FAQ。Remarks 人工永遠不動。
  if (url === "/api/coding-handover/doc" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    const doc = await loadHandoverDoc(projectPath);
    const remarks = await loadRemarks(projectPath);
    return res.json({ doc, remarks });
  }
  if (url === "/api/coding-handover/doc" && method === "POST") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    try {
      const doc = await generateHandoverDoc(projectPath);
      return res.json({ ok: true, doc, remarks: await loadRemarks(projectPath) });
    } catch (err) {
      console.error("[handover-doc] generate failed:", err?.message || err);
      return res.status(500).json({ error: `生成失敗：${String(err?.message || err).slice(0, 200)}` });
    }
  }

  if (url === "/api/coding-handover/generate" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch { /* empty */ }
    const path = body.path || projectPath;
    if (!path || !existsSync(path)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    const bundle = await buildBundle(path);
    const md = renderHandoverMd(bundle);
    const { mkdir } = await import("fs/promises");
    const paawDir = join(path, ".paaw"); // nosemgrep: path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
    if (!existsSync(paawDir)) await mkdir(paawDir, { recursive: true }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    const file = join(paawDir, "HANDOVER.md"); // nosemgrep: path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
    await writeFile(file, md, "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    return res.json({ ok: true, file: ".paaw/HANDOVER.md", bytes: md.length });
  }

  return next?.() ?? false;
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; });
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(""));
  });
}
