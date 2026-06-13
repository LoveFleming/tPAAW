/**
 * Provider Adapter — AI Provider 抽象層
 *
 * 概念：把不同 provider 的 API 差異擋在外面
 * ┌──────────┐   ┌────────────────┐   ┌──────────┐
 * │ ToolEngine│ → │ ProviderAdapter│ → │ Qwen API │
 * │           │   │                │   │ OpenAI   │
 * │           │   │                │   │ Claude   │
 * └──────────┘   └────────────────┘   └──────────┘
 *
 * 目前實作：OpenAI-compatible（Qwen、DeepSeek、GLM 都支援）
 */

import type { ProviderAdapter, ProviderConfig, ChatMessage, ToolDef, ProviderChunk, ToolCallDef } from './types'

// ── OpenAI-compatible Provider ──

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly name: string
  private config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
    this.name = `openai-compat:${config.id}`
  }

  async *chat(
    messages: ChatMessage[],
    tools: ToolDef[],
    model?: string
  ): AsyncIterableIterator<ProviderChunk> {
    const baseURL = this.config.baseURL.replace(/\/+$/, '')
    const url = `${baseURL}/chat/completions`
    const modelName = model || this.config.defaultModel

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.extraHeaders,
    }

    const body: Record<string, any> = {
      model: modelName,
      messages,
      stream: true,
      max_tokens: 4096,
    }

    // 只有在有 tools 時才送工具定義
    if (tools.length > 0) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text()
      yield { type: 'error', message: `API error ${response.status}: ${errText.slice(0, 300)}` }
      return
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // 累積完整的 tool calls
    let pendingToolCalls: Map<number, { id: string; name: string; args: string }> = new Map()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const choice = parsed.choices?.[0]
            if (!choice) continue

            const finishReason = choice.finish_reason
            const delta = choice.delta

            // Text content
            if (delta?.content) {
              yield { type: 'text', delta: delta.content }
            }

            // Tool calls delta
            const tcDeltas = delta?.tool_calls
            if (tcDeltas) {
              for (const tc of tcDeltas) {
                const index = tc.index ?? 0

                if (tc.id) {
                  // 新的 tool call 開始
                  pendingToolCalls.set(index, {
                    id: tc.id,
                    name: tc.function?.name || '',
                    args: tc.function?.arguments || '',
                  })
                  yield {
                    type: 'tool_call_begin',
                    index,
                    id: tc.id,
                    name: tc.function?.name || '',
                  }
                } else if (tc.function?.arguments) {
                  // 累積 arguments delta
                  const existing = pendingToolCalls.get(index)
                  if (existing) {
                    existing.args += tc.function.arguments
                  }
                  yield { type: 'tool_call_arg', index, delta: tc.function.arguments }
                }
              }
            }

            // Finish — 組裝完整的 tool calls
            if (finishReason === 'tool_calls') {
              const toolCalls: ToolCallDef[] = []
              for (const [, call] of pendingToolCalls) {
                toolCalls.push({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: call.args },
                })
              }
              yield { type: 'done', finishReason, toolCalls }
              pendingToolCalls.clear()
              break // stream 結束了
            }

            if (finishReason === 'stop') {
              yield { type: 'done', finishReason, toolCalls: [] }
              break
            }
          } catch {
            // parse error, skip non-JSON lines
          }
        }
      }

      // 如果 stream 自然結束而沒有 finish_reason
      if (pendingToolCalls.size > 0) {
        const toolCalls: ToolCallDef[] = []
        for (const [, call] of pendingToolCalls) {
          toolCalls.push({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.args },
          })
        }
        yield { type: 'done', finishReason: 'tool_calls', toolCalls }
      } else {
        yield { type: 'done', finishReason: 'stop', toolCalls: [] }
      }
    } finally {
      reader.releaseLock()
    }
  }
}

// ── Adapter Factory ──

export function createProviderAdapter(config: ProviderConfig): ProviderAdapter {
  // 依 provider id 選擇 adapter
  // 現在全部走 OpenAI-compatible（Qwen、DeepSeek、GLM 都行）
  // 之後可以加 AnthropicAdapter、CustomAdapter 等
  return new OpenAICompatibleAdapter(config)
}