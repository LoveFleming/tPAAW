/**
 * Tool Engine — 統一的 Tool Calling 引擎型別
 *
 * 聊天後面的「隱藏 CLI」：負責 Provider 通訊、ReAct loop、Tool 執行。
 * Chat 介面只負責收發文字，Tool Engine 在背景管理所有工具呼叫邏輯。
 */

// ── Provider Adapter ──

/** Provider 設定的統一格式 */
export interface ProviderConfig {
  id: string
  baseURL: string
  apiKey: string
  defaultModel: string
  /** 額外 header（如 OpenRouter 的 HTTP-Referer） */
  extraHeaders?: Record<string, string>
}

/** OpenAI-compatible chat message */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCallDef[]
  tool_call_id?: string
  name?: string
}

/** Tool definition（OpenAI format） */
export interface ToolFunctionDef {
  name: string
  description: string
  parameters: Record<string, any>
}

export interface ToolDef {
  type: 'function'
  function: ToolFunctionDef
}

/** Tool call from LLM response */
export interface ToolCallDef {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/** Provider streaming chunk */
export type ProviderChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call_begin'; index: number; id: string; name: string }
  | { type: 'tool_call_arg'; index: number; delta: string }
  | { type: 'done'; finishReason: string | null; toolCalls: ToolCallDef[] }
  | { type: 'error'; message: string }

// ── Tool Engine ──

/** Tool executor — 註冊給引擎的實際執行函數 */
export interface ToolExecutor {
  name: string
  description: string
  parameters: Record<string, any>
  execute: (args: Record<string, any>) => Promise<ToolResult>
}

/** Tool 執行結果 */
export interface ToolResult {
  text: string
  error?: boolean
  raw?: any
  records?: any[]
  app?: any
  data?: Record<string, any>
}

/** Engine streaming chunk */
export type EngineChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; name: string; args: Record<string, any> }
  | { type: 'tool_end'; name: string; result: ToolResult }
  | { type: 'done'; fullText: string }
  | { type: 'error'; message: string }

/** Engine 初始化參數 */
export interface ToolEngineOptions {
  provider: ProviderConfig
  tools: ToolDef[]
  executors: Map<string, ToolExecutor>
  /** 最大 tool 循環次數（預設 5） */
  maxToolRounds?: number
  /** 是否輸出原始 stream chunk（除錯用） */
  debug?: boolean
}

// ── Provider Adapter 介面 ──

export interface ProviderAdapter {
  readonly name: string
  /**
   * 發送 chat completion 請求，回傳 async iterable chunk
   * 支援 streaming，每個 chunk 是一個 ProviderChunk
   */
  chat(
    messages: ChatMessage[],
    tools: ToolDef[],
    model?: string
  ): AsyncIterableIterator<ProviderChunk>
}