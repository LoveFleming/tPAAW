/**
 * Provider Adapter — AI Provider 抽象層 (.mjs)
 *
 * 把不同 provider 的 API 差異擋在外面。
 * 目前實作 OpenAI-compatible（Qwen、DeepSeek、GLM 都支援）
 *
 * 2026-06-22: 加入 retry 機制 + idle timeout + 詳細 logging
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
   *
   * 加 retry：429 / 5xx 自動重試（最多 3 次，指數退避）
   * 加 timeout：connect 2min, read idle 60s
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

    const MAX_RETRIES = 3
    let lastError = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
        console.log(`[Provider] Retry attempt ${attempt}/${MAX_RETRIES} after ${delayMs}ms...`)
        await new Promise(r => setTimeout(r, delayMs))
      }

      console.log(`[Provider] → POST ${url} model=${modelName} msgs=${messages.length} tools=${tools.length} attempt=${attempt}`)

      const controller = new AbortController()
      const connectTimeoutMs = 30_000  // 30s to get first byte
      const overallTimeoutMs = 180_000  // 3min max per attempt
      const readIdleMs = 60_000         // 60s no data → abort

      let connectTimer = setTimeout(() => {
        console.log(`[Provider] Connect timeout (${connectTimeoutMs}ms), aborting`)
        controller.abort()
      }, connectTimeoutMs)

      const overallTimer = setTimeout(() => {
        console.log(`[Provider] Overall timeout (${overallTimeoutMs}ms), aborting`)
        controller.abort()
      }, overallTimeoutMs)

      let lastChunkTime = Date.now()
      const idleCheck = setInterval(() => {
        if (Date.now() - lastChunkTime > readIdleMs) {
          console.log(`[Provider] Read idle timeout (${readIdleMs}ms), aborting`)
          controller.abort()
        }
      }, 10_000)

      let response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (fetchErr) {
        clearTimeout(connectTimer)
        clearTimeout(overallTimer)
        clearInterval(idleCheck)
        if (fetchErr.name === 'AbortError') {
          lastError = '連線逾時'
          console.log(`[Provider] Fetch aborted (timeout), attempt=${attempt}`)
          continue // retry
        }
        yield { type: 'error', message: `網路錯誤: ${fetchErr.message}` }
        return
      }

      // Got response — clear connect timer
      clearTimeout(connectTimer)
      console.log(`[Provider] ← Status ${response.status}`)

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        clearTimeout(overallTimer)
        clearInterval(idleCheck)

        const retryable = response.status === 429 || response.status >= 500
        if (retryable && attempt < MAX_RETRIES) {
          console.log(`[Provider] ${response.status} retryable, will retry (body: ${errText.slice(0, 200)})`)
          // Respect Retry-After header if present
          const retryAfter = response.headers.get('retry-after')
          if (retryAfter) {
            const waitSec = parseInt(retryAfter, 10) || 2
            console.log(`[Provider] Retry-After: ${waitSec}s`)
            await new Promise(r => setTimeout(r, waitSec * 1000))
          }
          lastError = `API ${response.status}: ${errText.slice(0, 200)}`
          continue // retry
        }
        yield { type: 'error', message: `API error ${response.status}: ${errText.slice(0, 300)}` }
        return
      }

      // ── Stream reading ──
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const pendingTools = new Map()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          lastChunkTime = Date.now()

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

        // Success — return from generator
        return
      } catch (err) {
        if (err.name === 'AbortError') {
          console.log(`[Provider] Stream aborted (idle/overall timeout), attempt=${attempt}`)
          lastError = 'AI 回應逾時'
          // Don't yield error yet — might retry
          continue
        }
        throw err
      } finally {
        clearTimeout(overallTimer)
        clearInterval(idleCheck)
        try { reader.releaseLock() } catch {}
      }
    }

    // All retries exhausted
    console.log(`[Provider] All ${MAX_RETRIES + 1} attempts failed. Last: ${lastError}`)
    yield { type: 'error', message: lastError || 'AI 回應失敗，請稍後再試' }
  }
}

// ── Factory ──

export function createProviderAdapter(config) {
  // 現在全部走 OpenAI-compatible
  return new OpenAICompatibleAdapter(config)
}
