/**
 * Provider Adapter — AI Provider 抽象層 (.mjs)
 *
 * 把不同 provider 的 API 差異擋在外面。
 * 目前實作 OpenAI-compatible（Qwen、DeepSeek、GLM 都支援）
 */

// ── OpenAI-compatible Provider ──

export class OpenAICompatibleAdapter {
  constructor(config) {
    this.config = config
    this.name = `openai-compat:${config.id}`
  }

  /**
   * 發送 chat completion 請求，回傳 async generator
   * 每次 yield 一個 chunk：{ type, ... }
   */
  async *chat(messages, tools, model) {
    const baseURL = this.config.baseURL.replace(/\/+$/, '')
    const url = `${baseURL}/chat/completions`
    const modelName = model || this.config.defaultModel

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.extraHeaders,
    }

    const body = {
      model: modelName,
      messages,
      stream: true,
      max_tokens: 4096,
    }

    if (tools.length > 0) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    console.log(`[Provider] ← ${url} status=${response.status} model=${modelName}`)

    if (!response.ok) {
      const errText = await response.text()
      yield { type: 'error', message: `API error ${response.status}: ${errText.slice(0, 300)}` }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // 累積 tool calls（index → { id, name, args }）
    const pendingTools = new Map()

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

            // Text
            if (delta?.content) {
              yield { type: 'text', delta: delta.content }
            }

            // Tool calls delta
            const tcDeltas = delta?.tool_calls
            if (tcDeltas) {
              for (const tc of tcDeltas) {
                const index = tc.index ?? 0
                if (tc.id) {
                  pendingTools.set(index, {
                    id: tc.id,
                    name: tc.function?.name || '',
                    args: tc.function?.arguments || '',
                  })
                  yield { type: 'tool_call_begin', index, id: tc.id, name: tc.function?.name || '' }
                } else if (tc.function?.arguments) {
                  const existing = pendingTools.get(index)
                  if (existing) existing.args += tc.function.arguments
                  yield { type: 'tool_call_arg', index, delta: tc.function.arguments }
                }
              }
            }

            // Finish
            if (finishReason === 'tool_calls') {
              console.log(`[Provider] finishReason=tool_calls, count=${pendingTools.size}`)
              const toolCalls = []
              for (const [, call] of pendingTools) {
                console.log(`[Provider]   tool: ${call.name}, argsLen=${call.args.length}`)
                toolCalls.push({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: call.args },
                })
              }
              yield { type: 'done', finishReason, toolCalls }
              pendingTools.clear()
              break
            }

            if (finishReason === 'stop') {
              console.log(`[Provider] finishReason=stop`)
              yield { type: 'done', finishReason, toolCalls: [] }
              break
            }
          } catch {
            // parse error, skip
          }
        }
      }

      // Stream ended naturally without finish_reason
      if (pendingTools.size > 0) {
        const toolCalls = []
        for (const [, call] of pendingTools) {
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

// ── Factory ──

export function createProviderAdapter(config) {
  // 現在全部走 OpenAI-compatible
  return new OpenAICompatibleAdapter(config)
}