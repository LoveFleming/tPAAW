/**
 * RU (Release Unit) resolution + model pricing utilities.
 * 一個 release unit 對應一個 project（data/projects/*.json）。
 * Agent 執行紀錄用 cwd 反查 RU name；token 成本用 providers.json 的 pricing 計算。
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// lib → src → server → packages → PAAW root（4 層）
const PAAW_ROOT = join(__dirname, "..", "..", "..", "..");
const PROJECTS_DIR = join(PAAW_ROOT, "data", "projects");
const PROVIDERS_FILE = join(PAAW_ROOT, "data", "config", "providers.json");
const RECENT_FILE = join(PAAW_ROOT, "data", "config", "recent-projects.json");

let _projectsCache = null;
let _projectsCacheAt = 0;
let _pricingCache = null;
let _pricingCacheAt = 0;
let _recentCache = null;
let _recentCacheAt = 0;
const CACHE_TTL_MS = 30_000;

function _loadProjects() {
  const now = Date.now();
  if (_projectsCache && now - _projectsCacheAt < CACHE_TTL_MS) return _projectsCache;
  const out = [];
  try {
    for (const f of readdirSync(PROJECTS_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const p = JSON.parse(readFileSync(join(PROJECTS_DIR, f), "utf-8"));
        out.push(p);
      } catch {}
    }
  } catch {}
  _projectsCache = out;
  _projectsCacheAt = now;
  return out;
}

function _loadPricing() {
  const now = Date.now();
  if (_pricingCache && now - _pricingCacheAt < CACHE_TTL_MS) return _pricingCache;
  const map = new Map(); // key: model id (lowercase) → { input, output } USD per 1M tokens
  try {
    const cfg = JSON.parse(readFileSync(PROVIDERS_FILE, "utf-8"));
    for (const prov of Object.values(cfg.providers || {})) {
      for (const m of prov.models || []) {
        if (!m.pricing) continue;
        const price = {
          input: Number(m.pricing.inputPerMillion ?? m.pricing.input ?? 0) || 0,
          output: Number(m.pricing.outputPerMillion ?? m.pricing.output ?? 0) || 0,
        };
        map.set(String(m.id).toLowerCase(), price);
        // 短名（去掉 provider prefix）也註冊，例如 "z-ai/glm-5.1" → "glm-5.1"
        const short = String(m.id).split("/").pop().toLowerCase();
        if (!map.has(short)) map.set(short, price);
      }
    }
  } catch {}
  _pricingCache = map;
  _pricingCacheAt = now;
  return map;
}

/**
 * Coding app 匯入的專案（recent-projects.json）。
 * 這是 RU 對應的第一依據：cwd 落在哪個匯入 root 下就屬於那個 RU（路徑比對，不看資料夾名）。
 */
function _loadRecentProjects() {
  const now = Date.now();
  if (_recentCache && now - _recentCacheAt < CACHE_TTL_MS) return _recentCache;
  let list = [];
  try {
    list = JSON.parse(readFileSync(RECENT_FILE, "utf-8"));
  } catch {}
  _recentCache = Array.isArray(list) ? list.filter(r => r && typeof r.path === "string" && r.path) : [];
  _recentCacheAt = now;
  return _recentCache;
}

/**
 * Normalize a path for matching: forward slashes, no trailing slash, lowercase.
 * Windows 反斜線路徑（公司機 clientContext.cwd 傳來）也能比對。
 */
function _normPath(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Short display name: shortName > name 的「—」前段 > id。
 * e.g. "PAAW — Personal AI Assistant Workspace" → "PAAW"
 */
function _displayName(p) {
  if (p.shortName) return String(p.shortName);
  const head = String(p.name || "").split(/\s*[—–]\s*/)[0].trim();
  return head || p.id || "?";
}

/** alias/id tokens（lowercase）— 供路徑 segment 比對 */
function _tokens(p) {
  return [
    ...(Array.isArray(p.aliases) ? p.aliases.map(a => String(a).toLowerCase()) : []),
    String(p.id || "").toLowerCase(),
  ].filter(t => t.length > 0);
}

/**
 * Resolve RU (project) name from a working directory path.
 * Match priority（依「具體程度」排序，不是依來源）：
 *   1. 路徑裡最深的 alias/id segment 全等命中（cwd 越深越具體 — import root 底下的外部 repo 也認得）
 *   2. Coding app 匯入的專案 root（recent-projects.json）— 路徑比對、最長前緅赢
 *      （Fleming 2026-08-19 定調：RU 依據 = import 的 root folder，不是資料夾名稱猜測）
 *   3. data/projects rootPath exact/子目錄前緅 → alias/id segment 前緣
 *   4. PAAW 自身偵測（fallback，最後才判）
 * 匯入專案若能對應到 data/projects 的 RU（alias/id 命中 basename）→ 顯示 RU 名（如 Agent SRE）；
 * 否則顯示匯入時的專案名（root folder name）。
 * @param {string} cwd
 * @returns {string|null} project name, or null if no match
 */
export function resolveRuName(cwd) {
  if (!cwd) return null;
  const projects = _loadProjects();
  const norm = _normPath(cwd);
  const segments = norm.split("/").filter(Boolean);

  // 1. 最深的 alias/id segment 全等命中（segment 越深越具體，優先於 import root 的前緅判定）
  let aliasHit = null; // { idx, proj }
  for (const p of projects) {
    for (const t of _tokens(p)) {
      let idx = segments.length - 1;
      while (idx >= 0) {
        if (segments[idx] === t && (!aliasHit || idx > aliasHit.idx)) { aliasHit = { idx, proj: p }; break; }
        idx--;
      }
    }
  }

  // 2. Coding app 匯入專案：路徑比對（最長前緅赢，nested clone 也正確）
  const recent = _loadRecentProjects();
  let best = null; // { rp, rpLen, rec }
  for (const r of recent) {
    const rp = _normPath(r.path);
    if (!rp) continue;
    if (norm === rp || norm.startsWith(rp + "/")) {
      if (!best || rp.length > best.rp.length) best = { rp, rec: r };
    }
  }

  // alias 命中在 import root basename 或更深 → alias 赢（import root 底下的外部 repo）
  if (aliasHit && (!best || aliasHit.idx >= best.rp.split("/").filter(Boolean).length - 1)) {
    return _displayName(aliasHit.proj);
  }
  if (best) {
    // 匯入 root 的 folder name 對應到 data/projects RU（alias/id）→ 用 RU 顯示名
    const base = best.rp.split("/").filter(Boolean).pop() || "";
    const ruProj = projects.find(p => _tokens(p).some(t => t === base || (t.length >= 4 && base.startsWith(t))));
    if (ruProj) return _displayName(ruProj);
    return String(best.rec.name || base || "?").trim() || "?";
  }

  // 3a. rootPath exact or prefix（cwd 在專案子目錄內也算）
  for (const p of projects) {
    if (!p.rootPath) continue;
    const rp = _normPath(p.rootPath);
    if (!rp) continue;
    if (norm === rp || norm.startsWith(rp + "/")) return _displayName(p);
  }
  // 3b. alias / id 作為 segment 前緣（clone 資料夾常見變體：tPAAW-main、agent-sre-dev、paaw_backup）
  //    只用長 token（≥ 4 字）避免誤判
  for (const p of projects) {
    if (_tokens(p).filter(t => t.length >= 4).some(t => segments.some(s => s.startsWith(t)))) return _displayName(p);
  }
  // 4. PAAW 自身偵測（fallback）— cwd 在 PAAW 安裝目錄內任何子路徑 → PAAW project
  //    放最後：先讓其他 RU 的 rootPath/alias 比對，避免 PAAW 目錄內的外部 repo 被 blanket 蓋掉
  const paawRoot = _normPath(process.env.PAAW_ROOT || PAAW_ROOT);
  if (paawRoot && (norm === paawRoot || norm.startsWith(paawRoot + "/"))) {
    const paawProj = projects.find(p => String(p.id || "").toLowerCase() === "paaw");
    return (paawProj && _displayName(paawProj)) || "PAAW";
  }
  return null;
}

/**
 * Get pricing (USD per 1M tokens) for a model id.
 * @param {string} modelId e.g. "z-ai/glm-5.1" or "glm-5.1"
 * @returns {{input:number, output:number}|null}
 */
export function getModelPricing(modelId) {
  if (!modelId) return null;
  const map = _loadPricing();
  return map.get(String(modelId).toLowerCase()) || null;
}

/**
 * Calculate cost in USD from an OpenAI-style usage object.
 * @param {{prompt_tokens?:number, completion_tokens?:number}|null} usage
 * @param {{input:number, output:number}} pricing
 * @returns {number} cost USD (0 if unknown pricing)
 */
export function calcCostUsd(usage, pricing) {
  if (!usage || !pricing) return 0;
  const inTok = usage.prompt_tokens || 0;
  const outTok = usage.completion_tokens || 0;
  return (inTok / 1_000_000) * pricing.input + (outTok / 1_000_000) * pricing.output;
}

/** Cost for a single LLM step: model + usage → USD. */
export function stepCostUsd(model, usage) {
  return calcCostUsd(usage, getModelPricing(model));
}
