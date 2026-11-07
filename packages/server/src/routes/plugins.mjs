/**
 * Plugins API — manage external plugin integrations.
 *
 * A plugin is a web app registered by URL and embedded as an iframe tab in the
 * PAAW sidebar. This route is the single source of truth for
 * {DATA_HOME}/config/plugins.json.
 *
 * GET  /api/plugins   — list all plugins
 * POST /api/plugins   — replace the full plugins config (validated)
 *
 * NOTE: there is intentionally NO GET /api/plugins/:id endpoint — the client
 * always fetches the full list. (A stale comment used to claim one existed.)
 */

import { readFile, writeFile, mkdir, rename, unlink } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { readBody, json, PATHS } from "./context.mjs";

const CONFIG_FILE = join(PATHS.CONFIG_ROOT, "plugins.json");

// ── Limits (named constants, no magic numbers) ──
const MAX_BODY_BYTES = 256 * 1024; // 256 KB — a plugin list is tiny; guards DoS
const MAX_PLUGINS = 100;
const MAX_ID_LEN = 64;
const MAX_NAME_LEN = 120;
const MAX_ICON_LEN = 16; // emoji or short glyph
const MAX_URL_LEN = 2048;

// Plugin ids become object keys and are echoed by the client into
// `plugin-<id>` page tab ids — restrict to a safe, printable charset so a
// crafted id can never be abused as a filename, path fragment, or DOM id.
// (PAAW path convention: reject path separators / traversal segments outright.)
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

// Only web-safe schemes are allowed for the iframe src. Anything else
// (javascript:, data:, file:, vbscript:, …) is rejected to prevent the
// embedded page from executing script in / escaping its frame.
const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);

/**
 * Validate a single URL string: non-empty, bounded length, parseable, and using
 * an allowed web scheme.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function validateUrl(raw, label) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: `${label}: url is required` };
  }
  const value = raw.trim();
  if (value.length > MAX_URL_LEN) {
    return { ok: false, error: `${label}: url exceeds ${MAX_URL_LEN} chars` };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: `${label}: url is not a valid absolute URL` };
  }
  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `${label}: url scheme "${parsed.protocol}" is not allowed (use http/https)` };
  }
  return { ok: true, value };
}

/**
 * Validate and normalize the whole config payload.
 * Accepts either:
 *   - { "<id>": { name, url, icon?, enabled? }, ... }   (canonical form), or
 *   - { plugins: [ { id, name, url, icon?, enabled? }, ... ] }  (array form).
 * Always returns the canonical object keyed by id.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function normalizeConfig(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "request body must be a JSON object of plugins" };
  }

  // Array form → object keyed by id (tolerate both shapes to match the UI).
  let entries;
  if (Array.isArray(body.plugins)) {
    entries = body.plugins.map((p) => [p && p.id, p]);
  } else {
    entries = Object.entries(body);
  }

  if (entries.length > MAX_PLUGINS) {
    return { ok: false, error: `too many plugins (max ${MAX_PLUGINS})` };
  }

  const out = {};
  for (const [rawId, p] of entries) {
    const id = typeof rawId === "string" ? rawId.trim() : rawId;
    const label = `plugin "${String(id).slice(0, MAX_ID_LEN)}"`;

    if (typeof id !== "string" || id === "") {
      return { ok: false, error: "each plugin must have a non-empty string id" };
    }
    if (id.length > MAX_ID_LEN) {
      return { ok: false, error: `${label}: id exceeds ${MAX_ID_LEN} chars` };
    }
    if (!ID_RE.test(id)) {
      return { ok: false, error: `${label}: id may only contain letters, digits, ".", "_" and "-"` };
    }
    if (Object.prototype.hasOwnProperty.call(out, id)) {
      return { ok: false, error: `${label}: duplicate id` };
    }
    if (p === null || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, error: `${label}: plugin entry must be an object` };
    }

    const urlResult = validateUrl(p.url, label);
    if (!urlResult.ok) return urlResult;

    const name = p.name === undefined || p.name === null ? "" : String(p.name);
    if (name.length > MAX_NAME_LEN) {
      return { ok: false, error: `${label}: name exceeds ${MAX_NAME_LEN} chars` };
    }

    let icon = "";
    if (p.icon !== undefined && p.icon !== null) {
      if (typeof p.icon !== "string" || p.icon.length > MAX_ICON_LEN) {
        return { ok: false, error: `${label}: icon must be a string of at most ${MAX_ICON_LEN} chars` };
      }
      icon = p.icon;
    }

    if (p.enabled !== undefined && typeof p.enabled !== "boolean") {
      return { ok: false, error: `${label}: enabled must be a boolean` };
    }

    out[id] = {
      name: name || id, // default to id when empty (matches GET fallback)
      icon: icon || "🔌",
      url: urlResult.value,
      enabled: p.enabled !== false,
    };
  }

  return { ok: true, value: out };
}

/** Read the config file. Distinguishes "missing" (empty ok) from "corrupt". */
async function readConfig() {
  let raw;
  try {
    raw = await readFile(CONFIG_FILE, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: true, value: {} };
    return { ok: false, error: err };
  }
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (text === "") return { ok: true, value: {} };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err, corrupt: true };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: new Error("config root is not an object"), corrupt: true };
  }
  return { ok: true, value: parsed };
}

/**
 * Serialize writes so concurrent POSTs cannot interleave read-modify-write and
 * lose updates (last-write-wins). Chained on the previous write's promise.
 */
let _writeChain = Promise.resolve();
function withWriteLock(fn) {
  const run = _writeChain.then(fn, fn);
  // Keep the chain alive regardless of individual outcome.
  _writeChain = run.catch(() => {});
  return run;
}

/** Atomic write: temp file + rename (rename is atomic within a filesystem). */
async function writeConfigAtomic(config) {
  await mkdir(PATHS.CONFIG_ROOT, { recursive: true });
  const tmp = `${CONFIG_FILE}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
    await rename(tmp, CONFIG_FILE);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export async function handlePluginRoutes(req, res) {
  const path = (req.url || "").split("?")[0];

  // ── GET /api/plugins — list all plugins ──
  if (req.method === "GET" && path === "/api/plugins") {
    const result = await readConfig();
    if (!result.ok) {
      // Never auto-reset a corrupt/missing file to {} (silent data loss).
      console.error(`⚠️ [plugins] failed to read ${CONFIG_FILE}: ${result.error?.message || result.error}`);
      const message = result.corrupt
        ? "plugins config is corrupted and could not be parsed"
        : "failed to read plugins config";
      json(res, { error: message }, 500);
      return true;
    }

    const plugins = Object.entries(result.value).map(([id, p]) => ({
      id,
      name: (p && p.name) || id,
      icon: (p && p.icon) || "🔌",
      url: (p && p.url) || "",
      enabled: !p || p.enabled !== false,
    }));
    json(res, { plugins });
    return true;
  }

  // ── POST /api/plugins — replace full config (validated, atomic) ──
  if (req.method === "POST" && path === "/api/plugins") {
    let raw;
    try {
      raw = await readBody(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err && err.code === "BODY_TOO_LARGE") {
        json(res, { error: "request body too large" }, 413);
        return true;
      }
      console.error(`⚠️ [plugins] failed to read request body: ${err?.message || err}`);
      json(res, { error: "failed to read request body" }, 400);
      return true;
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      json(res, { error: "request body is not valid JSON" }, 400);
      return true;
    }

    const normalized = normalizeConfig(body);
    if (!normalized.ok) {
      json(res, { error: normalized.error }, 400);
      return true;
    }

    try {
      await withWriteLock(() => writeConfigAtomic(normalized.value));
      json(res, { ok: true });
    } catch (err) {
      console.error(`⚠️ [plugins] failed to write ${CONFIG_FILE}: ${err?.message || err}`);
      // Generic message — never leak filesystem paths / internal details.
      json(res, { error: "failed to save plugins config" }, 500);
    }
    return true;
  }

  return false;
}

export default handlePluginRoutes;
