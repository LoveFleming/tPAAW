/**
 * Provider Adapter — AI Provider 抽象層 (.mjs)
 *
 * 把不同 provider 的 API 差異擋在外面。
 * 目前實作 OpenAI-compatible（Qwen、DeepSeek、GLM 都支援）
 *
 * 2026-06-22: 清理掉 supportsTools/supportsToolChoice 等複雜設定
 *             只保留 maxTools（簡單明確）
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
    // 如果 baseURL 已包含 /chat/completions 就不再拼
    const url = baseURL.endsWith('/chat/completions') ? baseURL : `${baseURL}/chat/completions`
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

    // Tools — 如果有 maxTools 就截斷
    if (tools.length > 0) {
      const maxTools = this.config.maxTools || tools.length
      const trimmed = tools.slice(0, maxTools)
      if (trimmed.length < tools.length) {
        console.log(`[Provider] Trimmed tools from ${tools.length} to ${trimmed.length} (maxTools=${maxTools})`)
      }
      body.tools = trimmed
      // 不帶 tool_choice — 很多 OpenAI-compatible server 不支援，會回空內容
      // AI 自然會判斷要不要用 tool，不需要強制 auto
    }

    console.log(`[Provider] → POST ${url} model=${modelName} msgs=${messages.length} tools=${body.tools?.length || 0}`)
    console.log(`[Provider] Request body size: ${JSON.stringify(body).length} bytes`)
    // 印 request body 關鍵欄位，跟 Postman 比較
    console.log(`[Provider] Body keys:`, Object.keys(body),
      `stream=${body.stream}, max_tokens=${body.max_tokens},`,
      `tool_choice=${body.tool_choice}, tools_count=${body.tools?.length}`)
    if (body.tools?.length > 0) {
      console.log(`[Provider] Tool names:`, body.tools.map(t => t.function.name).join(', '))
    }
    // ★ 完整 payload — 寫到 temp file + 印 log
    const os = await import('os')
    const fs = await import('fs')
    const payloadPath = `${os.tmpdir()}/paaw-payload-${Date.now()}.json`
    fs.writeFileSync(payloadPath, JSON.stringify(body, null, 2))
    console.log(`[Provider] Payload written to: ${payloadPath}`)
    console.log(`[Provider] Headers:`, JSON.stringify(headers, null, 2))
    console.log(`[Provider] URL: ${url}`)

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    } catch (fetchErr) {
      console.log(`[Provider] Fetch error: ${fetchErr.message}`)
      yield { type: 'error', message: `連線錯誤: ${fetchErr.message}` }
      return
    }

    console.log(`[Provider] ← status=${response.status} model=${modelName}`)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.log(`[Provider] Error body: ${errText.slice(0, 500)}`)
      yield { type: 'error', message: `API error ${response.status}: ${errText.slice(0, 300)}` }
      return
    }

    // 印 response headers — 可能有不支援的線索
    console.log(`[Provider] Response headers:`, Object.fromEntries([...response.headers.entries()].slice(0, 10)))

    if (!response.body) {
      console.log(`[Provider] No response body!`)
      yield { type: 'error', message: 'API 回應沒有 body（可能不支援 streaming）' }
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
        if (done) {
          console.log(`[Provider] Stream ended (reader.done=true)`)
          break
        }

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
                } else if (tc.function?.arguments) {
                  const existing = pendingTools.get(index)
                  if (existing) existing.args += tc.function.arguments
                }
              }
            }

            // Finish
            if (finishReason === 'tool_calls') {
              const toolCalls = []
              for (const [, call] of pendingTools) {
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
              yield { type: 'done', finishReason: 'stop', toolCalls: [] }
              break
            }
          } catch {
            // parse error, skip
          }
        }
      }

      // Stream ended without finish_reason — yield whatever we have
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
      try { reader.releaseLock() } catch {}
    }
  }
}

// ── Factory ──

export function createProviderAdapter(config) {
  return new OpenAICompatibleAdapter(config)
}
