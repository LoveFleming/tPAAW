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

let _projectsCache = null;
let _projectsCacheAt = 0;
let _pricingCache = null;
let _pricingCacheAt = 0;
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

/**
 * Resolve RU (project) name from a working directory path.
 * Match priority: rootPath exact/子目錄前緅 → alias/id 任一路徑 segment（含 basename）
 *              → alias/id segment 前緣 → PAAW 自身偵測（fallback，最後才判）。
 * PAAW 自身偵測必須放最後：agent-sre 等 repo 若 clone 在 PAAW 安裝目錄內，
 * 先走 alias 比對才不會被 blanket 判成 PAAW（2026-08-19 公司機案例）。
 * @param {string} cwd
 * @returns {string|null} project name, or null if no match
 */
export function resolveRuName(cwd) {
  if (!cwd) return null;
  const projects = _loadProjects();
  const norm = _normPath(cwd);
  const segments = norm.split("/").filter(Boolean);

  // 1. rootPath exact or prefix（cwd 在專案子目錄內也算）
  for (const p of projects) {
    if (!p.rootPath) continue;
    const rp = _normPath(p.rootPath);
    if (!rp) continue;
    if (norm === rp || norm.startsWith(rp + "/")) return _displayName(p);
  }
  // 2. alias / id 出現在任一路徑 segment（basename 是最後一個 segment，原本就行為保留）
  const _tokens = (p) => [
    ...(Array.isArray(p.aliases) ? p.aliases.map(a => String(a).toLowerCase()) : []),
    String(p.id || "").toLowerCase(),
  ].filter(t => t.length > 0);
  for (const p of projects) {
    if (_tokens(p).some(t => segments.includes(t))) return _displayName(p);
  }
  // 3. alias / id 作為 segment 前緣（clone 資料夾常見變體：tPAAW-main、agent-sre-dev、paaw_backup）
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
