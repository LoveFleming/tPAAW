/**
 * Tool Registry Init — 把現有 tools 註冊到共享 toolRegistry
 *
 * Phase 1: Adapter 模式
 * - Loop A (paaw-agent-loop.mjs) 的 tools 不改，直接 export → register
 * - Loop B (tools/index.mjs) 的 tools 也 register 進來
 * - 新 tool 從此只需要 toolRegistry.register()
 *
 * 之後 Phase 2-3：各 loop 改用 toolRegistry.getDefinitions() / execute()
 */

import { toolRegistry } from "./tool-registry.mjs";
import { PAAW_TOOLS, executeTool } from "./paaw-agent-loop.mjs";

/**
 * 初始化：註冊 Loop A 的所有 tools 到 registry
 */
export function initLoopATools() {
  if (toolRegistry.initialized) return;

  for (const def of PAAW_TOOLS) {
    const name = def.function?.name;
    if (!name) continue;

    toolRegistry.register({
      name,
      definition: def,
      source: "paaw-agent-loop",
      handler: async (args, ctx) => {
        // 模擬 OpenAI tool call 格式
        const call = {
          id: `registry-${name}-${Date.now()}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        };
        const result = await executeTool(
          call,
          ctx.cwd || ctx.rootDir,
          ctx.rootDir,
          ctx.onEvent,
          ctx.agentId,
        );
        return result;
      },
    });
  }

  toolRegistry.initialized = true;
  console.log(`[ToolRegistry] Initialized with ${toolRegistry.getNames().length} tools from paaw-agent-loop`);
}

/**
 * 動態註冊 Loop B (tools/index.mjs) 的 tools
 * 這些是 chat/a2a 用的 app tools（notes, apps, cron, memory 等）
 */
export async function initLoopBTools() {
  const { getToolsAndHandlers } = await import("../tools/index.mjs");
  const { tools: definitions, handlers } = await getToolsAndHandlers();

  let count = 0;
  for (const def of definitions) {
    const name = def.function?.name;
    if (!name) continue;
    // Skip if already registered by Loop A
    if (toolRegistry.has(name)) continue;

    const handler = handlers[name];
    if (!handler) continue;

    toolRegistry.register({
      name,
      definition: def,
      source: "tools/index.mjs",
      handler: async (args, ctx) => {
        return await handler(args, ctx);
      },
    });
    count++;
  }

  console.log(`[ToolRegistry] Registered ${count} tools from tools/index.mjs`);

  // ── 載入外部 Tool Providers (data/tools/) ──
  const { initProviderTools } = await import("../tools/provider-loader.mjs");
  await initProviderTools();
}

/**
 * 便利函數：一次初始化全部
 */
export async function initAllTools() {
  initLoopATools();
  await initLoopBTools();
  console.log(`[ToolRegistry] Total tools: ${toolRegistry.getNames().length}`);
  console.log(`[ToolRegistry] Tools: ${toolRegistry.getNames().join(", ")}`);
}

/**
 * 手動註冊新 tool（給外部模組用）
 */
export function registerTool(entry) {
  toolRegistry.register(entry);
}

/**
 * Merge shared registry tools into a ToolEngine instance.
 * Call this AFTER constructing ToolEngine, BEFORE running it.
 *
 * Tools already registered in ToolEngine (by name) are NOT overwritten.
 * Only new tools from the shared registry are injected.
 *
 * @param {import("../tool-engine/index.mjs").ToolEngine} engine
 * @param {object} ctx — context to pass to registry handlers { cwd, rootDir, agentId, ... }
 */
export function injectRegistryTools(engine, ctx = {}) {
  if (!toolRegistry.initialized) return;

  const existingNames = new Set(engine.registry.listNames());
  const allDefs = toolRegistry.getDefinitions();
  let added = 0;

  for (const def of allDefs) {
    const name = def.function?.name;
    if (!name || existingNames.has(name)) continue;

    engine.registerTool({
      name,
      description: def.function?.description || name,
      parameters: def.function?.parameters || { type: "object", properties: {} },
      execute: async (args, execCtx) => {
        const mergedCtx = { ...ctx, ...execCtx, cwd: execCtx?.cwd || ctx.cwd };
        const result = await toolRegistry.execute(name, args, mergedCtx);
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    });
    added++;
  }

  if (added > 0) {
    console.log(`[ToolRegistry] Injected ${added} tools into ToolEngine (total: ${engine.registry.listNames().length})`);
  }
}
