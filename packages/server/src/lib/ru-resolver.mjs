/**
 * RU (Release Unit) resolver + model pricing utilities.
 *
 * 核心概念：RU = Coding app 匯入的那個專案，跟 PAAW 內部的 product tracker 無關。
 *
 * RU name 解析優先序：
 *   1. Coding app 匯入的專案（recent-projects.json）— 路徑比對，最長前綴贏
 *      匯入時的名稱就是 RU 名，不 cross-ref data/projects/
 *   2. 專案自身 metadata — package.json name 欄位
 *   3. .paaw 內的 cu-status.json 或其他 project-level 設定
 *   4. Folder basename（最後手段）
 *   5. PAAW 自身偵測（cwd 落在 PAAW_ROOT 內 → "PAAW"）
 *
 * data/projects/*.json 是 PAAW 產品開發 roadmap，不參與 RU 解析。
 * providers.json pricing 仍由此模組提供（與 RU 解析無關）。
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// lib → src → server → packages → PAAW root（4 層）
const PAAW_ROOT = join(__dirname, "..", "..", "..", "..");
const RECENT_FILE = join(PAAW_ROOT, "data", "config", "recent-projects.json");
const PROVIDERS_FILE = join(PAAW_ROOT, "data", "config", "providers.json");

// ── Caches ──
let _recentCache = null;
let _recentCacheAt = 0;
let _pricingCache = null;
let _pricingCacheAt = 0;
const CACHE_TTL_MS = 30_000;

// ── Recent projects loader ──
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

// ── Path normalize ──
function _normPath(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// ── Package.json name reader ──
function _readPackageJsonName(dirPath) {
  try {
    const pkg = JSON.parse(readFileSync(join(dirPath, "package.json"), "utf-8"));
    return pkg.name || null;
  } catch {
    return null;
  }
}

// ── Pricing loader（與 RU 解析無關，保留給 token 成本計算）──
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
 * Resolve RU (Release Unit) name from a working directory path.
 *
 * RU = Coding app 匯入的那個專案。跟 PAAW product tracker (data/projects/) 無關。
 *
 * Match priority:
 *   1. Coding app 匯入專案（recent-projects.json）— 最長前綴贏
 *   2. 專案 package.json name
 *   3. Folder basename
 *   4. PAAW 自身偵測（cwd 在 PAAW_ROOT 內 → "PAAW"）
 *
 * @param {string} cwd
 * @returns {string|null} project name, or null if no match
 */
export function resolveRuName(cwd) {
  if (!cwd) return null;
  const norm = _normPath(cwd);
  const segments = norm.split("/").filter(Boolean);

  // ── 1. Coding app 匯入專案：路徑比對（最長前綴贏）──
  const recent = _loadRecentProjects();
  let best = null; // { rp, rec }
  for (const r of recent) {
    const rp = _normPath(r.path);
    if (!rp) continue;
    if (norm === rp || norm.startsWith(rp + "/")) {
      if (!best || rp.length > best.rp.length) best = { rp, rec: r };
    }
  }
  if (best) {
    // 匯入時的名稱就是 RU 名
    const name = String(best.rec.name || "").trim();
    if (name) return name;
    // 匯入時沒給名稱，用 folder basename
    const base = best.rp.split("/").filter(Boolean).pop() || "";
    if (base) return base;
  }

  // ── 2. PAAW 自身偵測（在 package.json 之前 — 避免 PAAW 內的子目錄被 @paaw/ui 等攔走）──
  const paawRoot = _normPath(process.env.PAAW_ROOT || PAAW_ROOT);
  if (paawRoot && (norm === paawRoot || norm.startsWith(paawRoot + "/"))) {
    return "PAAW";
  }

  // ── 3. 專案 root 的 package.json name ──
  // 讀匯入 root / cwd 本身的 package.json，不要往子目錄找
  const pkgName = _readPackageJsonName(cwd);
  if (pkgName) {
    // Strip @scope/ prefix (e.g. @paaw/ui → ui is too vague, use the raw name)
    const clean = pkgName.replace(/^@[^/]+\//, "");
    if (clean && clean.length >= 2) return clean;
  }

  // ── 4. Folder basename ──
  const basename = segments[segments.length - 1] || "";
  if (basename && basename.length > 0) return basename;

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
