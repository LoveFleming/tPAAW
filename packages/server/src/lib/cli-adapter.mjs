/**
 * CliAdapter — Unified CLI abstraction layer for PAAW
 * 
 * Each CLI tool gets a JSON config file in data/config/cli-adapters/
 * This class reads the config and provides a unified interface.
 * 
 * Usage:
 *   const adapter = await CliAdapter.load("qwen");
 *   const bin = adapter.getBin();
 *   const args = adapter.buildArgs("noninteractive", { approvalMode: "yolo", maxTurns: 50 });
 *   const opts = adapter.spawnOptions({ cwd: "/path" });
 */

import { readFile, readdir } from "fs/promises";
import { resolve, join } from "path";

const DEFAULT_ADAPTERS_DIR = "data/config/cli-adapters";

export class CliAdapter {
  /** @type {import("./cli-adapter.types").CliAdapterConfig} */
  config;
  platform;

  constructor(config, platform = process.platform) {
    this.config = config;
    this.platform = platform;
  }

  // ── Static loaders ──

  /**
   * Load a CLI adapter by id
   * @param {string} id - Adapter id (e.g. "qwen", "claude")
   * @param {string} [paawRoot] - PAAW root directory
   * @returns {Promise<CliAdapter>}
   */
  static async load(id, paawRoot = process.env.PAAW_ROOT || ".") {
    const configPath = resolve(paawRoot, DEFAULT_ADAPTERS_DIR, `${id}.json`);
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    return new CliAdapter(config, process.platform);
  }

  /**
   * Load all available adapters
   * @param {string} [paawRoot] - PAAW root directory
   * @returns {Promise<CliAdapter[]>}
   */
  static async loadAll(paawRoot = process.env.PAAW_ROOT || ".") {
    const dir = resolve(paawRoot, DEFAULT_ADAPTERS_DIR);
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const adapters = [];
    for (const name of entries.filter(f => f.endsWith(".json"))) {
      try {
        const raw = await readFile(join(dir, name), "utf-8");
        adapters.push(new CliAdapter(JSON.parse(raw), process.platform));
      } catch { /* skip broken configs */ }
    }
    return adapters;
  }

  // ── Identity ──

  get id() { return this.config.id; }
  get name() { return this.config.name; }
  get description() { return this.config.description || ""; }

  // ── Binary resolution ──

  /**
   * Get the CLI binary path for the current platform
   * @param {string} [platform] - Override platform
   * @returns {string}
   */
  getBin(platform) {
    const p = platform || this.platform;
    const bins = this.config.bins || {};
    // Try exact platform match, then linux as fallback
    return bins[p] || bins.linux || this.config.id;
  }

  /**
   * Whether this CLI needs shell:true on the given platform
   * @param {string} [platform]
   * @returns {boolean}
   */
  needsShell(platform) {
    const p = platform || this.platform;
    const shellConfig = this.config.shell || {};
    return !!shellConfig[p];
  }

  // ── Mode handling ──

  /**
   * Check if a mode is supported
   * @param {string} mode - "interactive" or "noninteractive"
   * @returns {boolean}
   */
  supportsMode(mode) {
    return !!(this.config.modes && this.config.modes[mode]);
  }

  /**
   * Build CLI arguments for a given mode
   * @param {string} mode - "interactive" or "noninteractive"
   * @param {object} params - Template parameters
   * @param {string} [params.approvalMode] - "yolo" | "default" | etc.
   * @param {number|string} [params.maxTurns] - Max session turns
   * @param {string} [params.model] - Model override
   * @returns {string[]}
   */
  buildArgs(mode, params = {}) {
    const modeConfig = this.config.modes?.[mode];
    if (!modeConfig) return [];

    return (modeConfig.args || []).map(arg => {
      if (typeof arg !== "string") return String(arg);
      return arg
        .replace("{approvalMode}", params.approvalMode || "yolo")
        .replace("{maxTurns}", String(params.maxTurns || 50))
        .replace("{model}", params.model || "")
        .replace("{outputFormat}", params.outputFormat || "text");
    });
  }

  /**
   * How to pass the prompt to the CLI
   * @param {string} mode - "interactive" or "noninteractive"
   * @returns {"file"|"stdin"|"arg"} 
   */
  promptVia(mode) {
    const modeConfig = this.config.modes?.[mode];
    return modeConfig?.promptVia || "arg";
  }

  // ── Spawn helpers ──

  /**
   * Build spawn options for child_process.spawn
   * @param {object} [opts]
   * @param {string} [opts.cwd] - Working directory
   * @param {object} [opts.env] - Environment variables
   * @returns {object}
   */
  spawnOptions(opts = {}) {
    const result = {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    };
    if (this.needsShell()) {
      result.shell = true;
    }
    return result;
  }

  /**
   * Full spawn command info for debugging
   * @param {string} mode
   * @param {object} params
   * @param {string} promptFilePath
   * @returns {{ bin: string, args: string[], opts: object }}
   */
  spawnInfo(mode, params, promptFilePath) {
    const bin = this.getBin();
    const baseArgs = this.buildArgs(mode, params);
    
    // Add prompt based on promptVia method
    const via = this.promptVia(mode);
    let args;
    if (via === "file") {
      args = [...baseArgs, promptFilePath];
    } else if (via === "arg") {
      args = [...baseArgs, params.prompt || ""];
    } else {
      // stdin — args only, prompt written to stdin after spawn
      args = baseArgs;
    }

    return { bin, args, opts: this.spawnOptions({ cwd: params.cwd }) };
  }

  // ── Capabilities ──

  /**
   * Get capability info
   * @param {string} key - Capability key
   * @returns {*}
   */
  capability(key) {
    return this.config.capabilities?.[key];
  }

  /**
   * Check if a capability is supported
   * @param {string} key
   * @returns {boolean}
   */
  hasCapability(key) {
    const cap = this.config.capabilities?.[key];
    return cap !== undefined && cap !== false;
  }

  /**
   * Get max turns config
   * @returns {{ param: string, default: number, min: number } | false}
   */
  get maxTurnsConfig() {
    return this.capability("maxTurns");
  }

  /**
   * Available approval modes
   * @returns {string[]}
   */
  get approvalModes() {
    return this.capability("approvalModes") || ["default"];
  }

  // ── Serialization ──

  /** Return JSON-safe config for API responses */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      bin: this.getBin(),
      needsShell: this.needsShell(),
      modes: Object.keys(this.config.modes || {}),
      capabilities: this.config.capabilities || {},
    };
  }
}
