/**
 * Tool Engine — 聊天後面的「隱藏 CLI」
 *
 *                    ┌─────────────────────┐
 *  Chat Route  ──→  │     Tool Engine      │
 *                    │                     │
 *                    │  ┌───────────────┐  │
 *                    │  │  Provider     │──┼──→ LLM API
 *                    │  │  Adapter      │  │
 *                    │  └──────┬────────┘  │
 *                    │         │           │
 *                    │  ┌──────▼────────┐  │
 *                    │  │  ReAct Loop   │  │
 *                    │  │  (max N 輪)    │  │
 *                    │  └──────┬────────┘  │
 *                    │         │           │
 *                    │  ┌──────▼────────┐  │
 *                    │  │  Tool         │  │
 *                    │  │  Registry     │──┼──→ App Tools
 *                    │  └───────────────┘  │
 *                    └─────────────────────┘
 *
 * 概念：
 * Chat 介面只負責收發文字。
 * Tool Engine 在背景管理所有工具呼叫邏輯（ReAct loop）。
 * 就像一個看不見的 CLI 在對話後面幫你操作。
 */

import type {
  ChatMessage,
  ToolDef,
  ToolExecutor,
  ToolResult,
  EngineChunk,
  ToolEngineOptions,
  ProviderAdapter,
  ToolCallDef,
} from './types'
import { createProviderAdapter } from './provider'
import { ToolRegistry } from './tool-registry'

const DEFAULT_MAX_TOOL_ROUNDS = 5

export class ToolEngine {
  private provider: ProviderAdapter
  private registry: ToolRegistry
  private maxToolRounds: number
  private debug: boolean

  constructor(options: ToolEngineOptions) {
    this.provider = createProviderAdapter(options.provider)
    this.registry = new ToolRegistry()
    this.maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS
    this.debug = options.debug ?? false

    // 註冊初始工具
    for (const ex of options.executors.values()) {
      this.registry.register(ex)
    }
  }

  /** 取得 tool definitions（給外部用，如檢查有哪些工具） */
  getToolDefinitions(): ToolDef[] {
    return this.registry.getToolDefinitions()
  }

  /** 註冊或更新一個工具 */
  registerTool(executor: ToolExecutor): void {
    this.registry.register(executor)
  }

  /** 移除一個工具 */
  unregisterTool(name: string): void {
    this.registry.unregister(name)
  }

  /**
   * 執行完整的 ReAct loop
   * 回傳 AsyncIterableIterator，Chat Route 可以直接 stream 給前端
   */
  async *run(
    systemPrompt: string,
    userMessages: ChatMessage[],
    model?: string
  ): AsyncIterableIterator<EngineChunk> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...userMessages,
    ]

    let fullText = ''
    const tools = this.registry.getToolDefinitions()

    for (let round = 0; round < this.maxToolRounds; round++) {
      if (this.debug) {
        yield { type: 'text', delta: `\n[Tool Engine] Round ${round + 1}/${this.maxToolRounds}\n` }
      }

      // ── 送給 LLM ──
      const toolCalls = await this._chatRound(messages, tools, model)

      if (toolCalls.length === 0) {
        // 沒有 tool calls → 結束
        yield { type: 'done', fullText }
        return
      }

      // ── 執行所有 tool calls ──
      for (const tc of toolCalls) {
        let args: Record<string, any> = {}
        try {
          args = JSON.parse(tc.function.arguments)
        } catch {
          args = { raw: tc.function.arguments }
        }

        yield { type: 'tool_start', name: tc.function.name, args }

        const result = await this.registry.execute(tc.function.name, args)

        yield { type: 'tool_end', name: tc.function.name, result }

        // Append tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        })
      }
    }

    // 超過最大輪數，強制結束
    if (this.debug) {
      yield { type: 'text', delta: `\n[Tool Engine] 已達最大工具呼叫次數 (${this.maxToolRounds})，結束\n` }
    }
    yield { type: 'done', fullText }
  }

  /**
   * 單輪 chat — 送 messages 給 provider，stream 文字，回傳 tool calls
   */
  private async *_chatRoundStream(
    messages: ChatMessage[],
    tools: ToolDef[],
    model?: string
  ): AsyncIterableIterator<EngineChunk> {
    const toolCalls: ToolCallDef[] = []
    let roundText = ''
    let currentToolInfo: { name: string; args: string } | null = null

    for await (const chunk of this.provider.chat(messages, tools, model)) {
      switch (chunk.type) {
        case 'text':
          roundText += chunk.delta
          yield { type: 'text', delta: chunk.delta }
          break

        case 'tool_call_begin':
          currentToolInfo = { name: chunk.name, args: '' }
          break

        case 'tool_call_arg':
          if (currentToolInfo) {
            currentToolInfo.args += chunk.delta
          }
          break

        case 'done':
          // 把這輪的文字加到 messages（assistant 的回應）
          if (roundText || chunk.toolCalls.length > 0) {
            const assistantMsg: ChatMessage = {
              role: 'assistant',
              content: roundText || null,
            }
            if (chunk.toolCalls.length > 0) {
              assistantMsg.tool_calls = chunk.toolCalls
            }
            messages.push(assistantMsg)
          }
          return chunk.toolCalls // 回傳這輪的 tool calls

        case 'error':
          yield { type: 'error', message: chunk.message }
          return []
      }
    }
    return []
  }

  /**
   * Internal: single chat round, returns tool calls
   */
  private async _chatRound(
    messages: ChatMessage[],
    tools: ToolDef[],
    model?: string
  ): Promise<ToolCallDef[]> {
    const toolCalls: ToolCallDef[] = []
    let roundText = ''

    for await (const chunk of this.provider.chat(messages, tools, model)) {
      switch (chunk.type) {
        case 'text':
          roundText += chunk.delta
          break
        case 'done':
          // Append assistant response
          if (roundText || chunk.toolCalls.length > 0) {
            const assistantMsg: ChatMessage = {
              role: 'assistant',
              content: roundText || null,
            }
            if (chunk.toolCalls.length > 0) {
              assistantMsg.tool_calls = chunk.toolCalls
            }
            messages.push(assistantMsg)
          }
          return chunk.toolCalls
        case 'error':
          console.error('[ToolEngine] Provider error:', chunk.message)
          return []
        default:
          break
      }
    }
    return []
  }
}

/**
 * 快速建立 ToolEngine 實例
 * 適合 Chat Route 直接使用
 */
export function createToolEngine(options: ToolEngineOptions): ToolEngine {
  return new ToolEngine(options)
}

export { ToolRegistry } from './tool-registry'
export type {
  ProviderAdapter,
  ProviderConfig,
  ProviderChunk,
  ChatMessage,
  ToolDef,
  ToolExecutor,
  ToolResult,
  EngineChunk,
  ToolEngineOptions,
} from './types'