/**
 * Tool Provider — MCP Hub Wrapper
 *
 * 這是向後相容的薄包裝。
 * 實際邏輯全部走 MCP Hub（mcp-hub.mjs）。
 *
 * 舊的 data/tools/ script provider 仍然支援，
 * 但推薦使用 MCP server 架構。
 */

export {
  loadMCPServers as loadToolProviders,
  getAllToolDefinitions,
  getToolDefinitions,
  executeToolCall,
  listProviders,
} from "./mcp-hub.mjs";
