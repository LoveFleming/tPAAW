/**
 * Shared Tool Registry — 所有 agent loop 共用的 tool 註冊中心
 *
 * OCP 原則：
 * - Registry 本身是 open（隨時可以 register 新 tool）
 * - Agent loop 是 closed（不改 loop 就能用新 tool）
 *
 * 用法：
 *   import { toolRegistry } from "./tool-registry.mjs";
 *
 *   // 註冊 tool（任何模組都可以註冊）
 *   toolRegistry.register({
 *     name: "my_tool",
 *     definition: { type: "function", function: { name: "my_tool", ... } },
 *     handler: async (args, ctx) => { return "result"; }
 *   });
 *
 *   // 取得所有 tool definitions（餵給 LLM）
 *   const defs = toolRegistry.getDefinitions();
 *
 *   // 執行 tool
 *   const result = await toolRegistry.execute("my_tool", args, ctx);
 */

// ── Types ──
// ToolEntry = {
//   name: string
//   definition: { type: "function", function: { name, description, parameters } }
//   handler: (args, ctx) => Promise<string | object>
//   source?: string  // 哪個模組註冊的（debug 用）
// }

const _tools = new Map();
let _initialized = false;

export const toolRegistry = {
  /**
   * 註冊一個 tool。如果同名 tool 已存在，覆蓋並印 warning。
   */
  register(entry) {
    if (!entry?.name || !entry?.definition || !entry?.handler) {
      throw new Error(`[ToolRegistry] Invalid tool entry: missing name/definition/handler`);
    }
    if (_tools.has(entry.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: ${entry.name}`);
    }
    _tools.set(entry.name, {
      name: entry.name,
      definition: entry.definition,
      handler: entry.handler,
      source: entry.source || "unknown",
    });
  },

  /**
   * 批量註冊。
   */
  registerAll(entries, source = "unknown") {
    for (const entry of entries) {
      this.register({ ...entry, source: entry.source || source });
    }
  },

  /**
   * 取得所有 tool definitions（OpenAI function-calling 格式）。
   * 可選 filter：只回傳指定名稱的 tools。
   */
  getDefinitions(filter) {
    const result = [];
    for (const [, entry] of _tools) {
      if (filter && !filter.includes(entry.name)) continue;
      result.push(entry.definition);
    }
    return result;
  },

  /**
   * 取得所有 tool 名稱。
   */
  getNames() {
    return Array.from(_tools.keys());
  },

  /**
   * 執行一個 tool。
   * @param name tool name
   * @param args parsed arguments object
   * @param ctx { rootDir, agentId, sessionId, cwd, onEvent, ... }
   * @returns handler return value (string or object)
   */
  async execute(name, args, ctx) {
    const entry = _tools.get(name);
    if (!entry) {
      return { error: `Unknown tool: ${name}` };
    }
    try {
      return await entry.handler(args, ctx);
    } catch (err) {
      console.error(`[ToolRegistry] Tool "${name}" error:`, err.message);
      return { error: `Tool "${name}" failed: ${err.message}` };
    }
  },

  /**
   * 檢查 tool 是否存在。
   */
  has(name) {
    return _tools.has(name);
  },

  /**
   * 列出所有已註冊 tools（debug 用）。
   */
  list() {
    return Array.from(_tools.values()).map(e => ({
      name: e.name,
      source: e.source,
    }));
  },

  /**
   * 清除所有註冊（主要給測試用）。
   */
  clear() {
    _tools.clear();
    _initialized = false;
  },

  get initialized() {
    return _initialized;
  },

  set initialized(v) {
    _initialized = v;
  },
};
