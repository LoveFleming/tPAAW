/**
 * Cross-platform CLI binary resolution.
 *
 * Loads bin paths from data/config/cli-adapters/*.json at runtime,
 * with env var override. Replaces all hardcoded /opt/homebrew paths.
 *
 * Usage:
 *   import { resolveCliBin } from "./lib/cli-resolve.mjs";
 *   const bin = resolveCliBin("qwen");
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

const ENV_VARS = { qwen: "QWEN_BIN", claude: "CLAUDE_BIN", opencode: "OPENCODE_BIN" };

const DEFAULTS = {
  qwen: { darwin: "qwen", linux: "qwen", win32: "qwen.cmd" },
  claude: { darwin: "claude", linux: "claude", win32: "claude.cmd" },
  opencode: { darwin: "opencode", linux: "opencode", win32: "opencode.cmd" },
};

let _binsCache = null;
let _cacheRoot = null;

function loadBins(paawRoot) {
  // Re-load if root changed (mainly for tests)
  if (_binsCache && _cacheRoot === paawRoot) return _binsCache;
  _binsCache = {};
  _cacheRoot = paawRoot;
  const dir = resolve(paawRoot, "data/config/cli-adapters");
  if (!existsSync(dir)) return _binsCache;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const cfg = JSON.parse(readFileSync(join(dir, f), "utf-8"));
        if (cfg.id && cfg.bins) _binsCache[cfg.id] = cfg.bins;
      } catch { /* skip */ }
    }
  } catch { /* dir read error */ }
  return _binsCache;
}

/**
 * Resolve a CLI binary path for the current platform.
 * Priority: env var → cli-adapter JSON → sensible default.
 * @param {string} cliType - "qwen" | "claude" | "opencode" | etc.
 * @param {string} [paawRoot] - PAAW root dir (auto-detected if omitted)
 * @returns {string}
 */
export function resolveCliBin(cliType, paawRoot) {
  const root = paawRoot || _autoRoot();
  const envVar = ENV_VARS[cliType];
  if (envVar && process.env[envVar]) return process.env[envVar];

  const platform = process.platform;
  const binKey = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";

  const bins = loadBins(root);
  if (bins[cliType] && bins[cliType][binKey]) return bins[cliType][binKey];

  const def = DEFAULTS[cliType] || DEFAULTS.qwen;
  return def[binKey];
}

/** True if current platform is Windows */
export function isWindows() {
  return process.platform === "win32";
}

function _autoRoot() {
  // Walk up from CWD to find data/config/cli-adapters
  // Fallback: use PAAW_ROOT env or cwd
  return process.env.PAAW_ROOT || process.cwd();
}
