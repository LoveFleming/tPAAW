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
   *
   * 文字以 provider 逐字串流的方式即時 yield；provider error 會向上傳遞為
   * error chunk 後結束，不會被誤判為正常完成。
   */
  async *run(
    systemPrompt: string,
    userMessages: ChatMessage[],
    model?: string
  ): AsyncIterableIterator<EngineChunk> {
    // ── 輸入驗證：system prompt 與 messages 角色 ──
    if (typeof systemPrompt !== 'string') {
      yield { type: 'error', message: 'Invalid system prompt: expected string' }
      return
    }
    if (!Array.isArray(userMessages)) {
      yield { type: 'error', message: 'Invalid messages: expected array' }
      return
    }
    const validRoles = new Set(['system', 'user', 'assistant', 'tool'])
    for (const m of userMessages) {
      if (!m || typeof m !== 'object' || !validRoles.has(m.role)) {
        yield { type: 'error', message: `Invalid message role: ${String(m?.role)}` }
        return
      }
    }

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

      // ── 送給 LLM（逐字串流，文字即時 yield） ──
      const roundGen = this._chatRoundStream(messages, tools, model)
      let roundResult: { toolCalls: ToolCallDef[]; error?: string }
      while (true) {
        const step = await roundGen.next()
        if (step.done) {
          roundResult = step.value
          break
        }
        // 累積本輪文字到 fullText（對齊 done.fullText 契約）
        if (step.value.type === 'text') {
          fullText += step.value.delta
        }
        yield step.value
      }

      if (roundResult.error) {
        // provider 出錯：往上傳遞錯誤，不得當成正常結束而 yield done
        yield { type: 'error', message: roundResult.error }
        return
      }

      if (roundResult.toolCalls.length === 0) {
        // 沒有 tool calls → 結束
        yield { type: 'done', fullText }
        return
      }

      // ── 執行所有 tool calls ──
      for (const tc of roundResult.toolCalls) {
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
   * 單輪 chat — 送 messages 給 provider，逐字 stream 文字，回傳本輪結果
   *
   * 回傳 { toolCalls, error }：error 有值代表 provider 失敗，run() 需向上傳遞。
   */
  private async *_chatRoundStream(
    messages: ChatMessage[],
    tools: ToolDef[],
    model?: string
  ): AsyncGenerator<EngineChunk, { toolCalls: ToolCallDef[]; error?: string }> {
    const toolCalls: ToolCallDef[] = []
    let roundText = ''

    for await (const chunk of this.provider.chat(messages, tools, model)) {
      switch (chunk.type) {
        case 'text':
          roundText += chunk.delta
          yield { type: 'text', delta: chunk.delta }
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
          return { toolCalls: chunk.toolCalls }

        case 'error':
          return { toolCalls: [], error: chunk.message }
      }
    }
    return { toolCalls }
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