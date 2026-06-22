/**
 * Tool Engine — 聊天後面的「隱藏 CLI」
 *
 * Chat 介面只負責收發文字。
 * Tool Engine 在背景管理所有工具呼叫邏輯（ReAct loop），
 * 並整合 Security Kernel 做安全檢查。
 */

import { createProviderAdapter } from './provider.mjs'
import { ToolRegistry } from './tool-registry.mjs'
import { SecurityKernel } from '../security/index.mjs'

const DEFAULT_MAX_TOOL_ROUNDS = 5

// 偵測 LLM 假裝 tool call 的文字模式
const FAKE_TOOL_PATTERNS = [
  /> 🔧 \*\*/,           // > 🔧 **Pocket List**
  /> 📝 \*\*/,           // > 📝 **Todo Add**
  /> 📋 \*\*/,           // > 📋 **Todo List**
  /\[Tool Call\]/i,       // [Tool Call]
  /\[Calling tool/i,      // [Calling tool...]
  /tool_call.*executing/i, // tool_call executing
]

function looksLikeFakeToolCall(text) {
  if (!text) return false
  return FAKE_TOOL_PATTERNS.some(p => p.test(text))
}

export class ToolEngine {
  /**
   * @param {object} options
   */
  constructor(options) {
    this.provider = createProviderAdapter(options.provider)
    this.registry = new ToolRegistry()
    this.maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS
    this.debug = options.debug ?? false
    this.sessionKey = options.sessionKey || 'default'
    this.agentId = options.agentId || 'default'
    this.security = options.security ? new SecurityKernel(options.security) : null
    this.registry.registerAll(options.executors || [])
  }

  getToolDefinitions() { return this.registry.getToolDefinitions() }
  registerTool(executor) { this.registry.register(executor) }
  unregisterTool(name) { this.registry.unregister(name) }

  /**
   * 執行完整的 ReAct loop（streaming）
   */
  async *run(systemPrompt, userMessages, model) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...userMessages,
    ]

    if (this.security) await this.security.init()

    let totalText = ''
    const toolNames = this.registry.listNames()

    try {
      for (let round = 0; round < this.maxToolRounds; round++) {
        const tools = this.registry.getToolDefinitions()

        // ── 一輪 chat ──
        let roundText = ''
        const toolCalls = []
        let finishReason = null
        const roundStart = Date.now()

        console.log(`[ToolEngine] Round ${round + 1}/${this.maxToolRounds} calling provider... msgs=${messages.length} tools=${tools.length}`)

        for await (const chunk of this.provider.chat(messages, tools, model)) {
          switch (chunk.type) {
            case 'text':
              roundText += chunk.delta
              totalText += chunk.delta
              yield { type: 'text', delta: chunk.delta }
              break
            case 'tool_call_begin':
            case 'tool_call_arg':
              break
            case 'done':
              finishReason = chunk.finishReason
              toolCalls.push(...chunk.toolCalls)
              break
            case 'error':
              yield { type: 'error', message: chunk.message }
              return
          }
        }

        console.log(`[ToolEngine] Round ${round + 1}: finish=${finishReason} tools=${toolCalls.length} text=${roundText.length} elapsed=${Date.now() - roundStart}ms`)

        // Append assistant response
        const assistantMsg = { role: 'assistant', content: roundText || null }
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls
        messages.push(assistantMsg)

        // ── 有 tool calls → 執行 ──
        if (toolCalls.length > 0) {
          for (const tc of toolCalls) {
            let args = {}
            try { args = JSON.parse(tc.function.arguments) } catch { args = { raw: tc.function.arguments } }

            console.log(`[ToolEngine]   → execute: ${tc.function.name}(${JSON.stringify(args).slice(0, 120)})`)

            // Security check
            if (this.security) {
              const check = await this.security.checkToolCall(tc.function.name, args, { sessionKey: this.sessionKey, agentId: this.agentId })
              if (!check.allowed) {
                const reason = check.approval ? '等待用戶批准' : `安全性攔截: ${check.reason}`
                yield { type: 'tool_start', name: tc.function.name, args }
                yield { type: 'tool_end', name: tc.function.name, result: { text: reason, error: true, securityBlocked: true } }
                messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ text: reason, error: true }) })
                continue
              }
            }

            const startTime = Date.now()
            yield { type: 'tool_start', name: tc.function.name, args }
            const result = await this.registry.execute(tc.function.name, args)
            yield { type: 'tool_end', name: tc.function.name, result }

            if (this.security) {
              await this.security.recordResult(tc.function.name, args, result, { sessionKey: this.sessionKey, agentId: this.agentId, duration: Date.now() - startTime })
            }

            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
          }
          continue // 下一輪
        }

        // ── 沒有 tool calls ──

        // 偵測假裝 tool call → 重試一次
        if (looksLikeFakeToolCall(roundText) && round < this.maxToolRounds - 1) {
          console.log(`[ToolEngine]   ⚠️ 偵測到假裝的 tool call，重試...`)

          // 把假裝的文字從 totalText 扣掉
          totalText = totalText.slice(0, totalText.length - roundText.length)

          // 不 yield 額外文字（假裝的部分不顯示）
          // 但先 yield 一個提示
          yield { type: 'text', delta: '\n' }

          // 追加強制提示
          messages.push({
            role: 'user',
            content: `你剛才用文字模擬了工具執行結果，但沒有真的呼叫 tool。請重新操作，這次一定要用 tool_calls 格式真的呼叫對應的工具。可用工具：${toolNames.join(', ')}。不要用文字描述工具執行過程，直接呼叫工具就好。`,
          })

          // 下一輪重試
          continue
        }

        // 正常結束
        yield { type: 'done', fullText: totalText }
        return
      }

      yield { type: 'done', fullText: totalText }
    } finally {
      if (this.security) await this.security.dispose()
    }
  }
}

export function createToolEngine(provider, executors, options = {}) {
  return new ToolEngine({ provider, executors, ...options })
}