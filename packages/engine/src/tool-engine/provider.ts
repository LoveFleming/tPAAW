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

// ── 預設值（可被 ProviderConfig 覆寫） ──
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_BASE_RETRY_DELAY_MS = 1000

/** 判定為可重試的 HTTP status（429 / 5xx） */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/** 指數退避 + jitter，避免多個請求同時重試造成雪崩 */
function retryDelayMs(attempt: number): number {
  const exp = DEFAULT_BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
  const jitter = Math.random() * DEFAULT_BASE_RETRY_DELAY_MS
  return exp + jitter
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
    // 若 baseURL 已含 /chat/completions 就不再重複拼接
    const url = baseURL.endsWith('/chat/completions') ? baseURL : `${baseURL}/chat/completions`
    const modelName = model || this.config.defaultModel
    const maxTokens = this.config.maxTokens ?? DEFAULT_MAX_TOKENS
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.extraHeaders,
    }

    // 逃生口（extraBody）最後套用，允許覆寫任何預設欄位
    const body: Record<string, any> = {
      model: modelName,
      messages,
      stream: true,
      max_tokens: maxTokens,
      ...this.config.extraBody,
    }

    // 只有在有 tools 時才送工具定義
    if (tools.length > 0 && body.tools === undefined) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    // ── 建立連線（含 timeout + retry/backoff） ──
    let response: Response | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!res.ok) {
          const errText = await res.text()
          // 可重試的失敗（429 / 5xx）且在預算內 → 退避後重試
          if (isRetryableStatus(res.status) && attempt < maxRetries) {
            clearTimeout(timer)
            await sleep(retryDelayMs(attempt))
            continue
          }
          yield { type: 'error', message: `API error ${res.status}: ${errText.slice(0, 300)}` }
          return
        }

        response = res
        break
      } catch (err: any) {
        // timeout / 連線中斷屬可重試失敗
        if (attempt < maxRetries) {
          clearTimeout(timer)
          await sleep(retryDelayMs(attempt))
          continue
        }
        const reason = err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err?.message || String(err)
        yield { type: 'error', message: `API request failed: ${reason}` }
        return
      } finally {
        clearTimeout(timer)
      }
    }

    if (!response) {
      yield { type: 'error', message: 'API request failed: no response after retries' }
      return
    }

    if (!response.body) {
      yield { type: 'error', message: 'API error: response body is null (no stream)' }
      return
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // 累積完整的 tool calls 與本輪文字
    const pendingToolCalls: Map<number, { id: string; name: string; args: string }> = new Map()
    let fullText = ''

    /** 送出 done 並標記是否已結束，避免重複 yield */
    const buildDone = (finishReason: string | null, toolCalls: ToolCallDef[]): ProviderChunk => ({
      type: 'done',
      finishReason,
      toolCalls,
      fullText,
    })
    const collectToolCalls = (): ToolCallDef[] => {
      const out: ToolCallDef[] = []
      for (const [, call] of pendingToolCalls) {
        out.push({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.args },
        })
      }
      return out
    }

    let finished = false
    try {
      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // 同時處理 \n 與 \r\n 換行；保留最後一行（可能被 chunk 邊界切斷）
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''

        for (const rawLine of lines) {
          // SSE 事件行：忽略 event:/id:/註解行，只處理 data:
          const line = rawLine.trimStart()
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trimStart()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const choice = parsed.choices?.[0] // nosemgrep: no-stringify-keys — 誤報：JSON.parse HTTP 回應的陣列存取，非 stringify 當 key
            if (!choice) continue

            const finishReason = choice.finish_reason
            const delta = choice.delta

            // Text content
            if (delta?.content) {
              fullText += delta.content
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
              yield buildDone(finishReason, collectToolCalls())
              pendingToolCalls.clear()
              finished = true
              break // stream 結束了
            }

            if (finishReason === 'stop') {
              yield buildDone(finishReason, [])
              finished = true
              break
            }
          } catch {
            // parse error, skip non-JSON lines
          }
        }
      }

      // 如果 stream 自然結束而沒有 finish_reason（且尚未 finished）
      if (!finished) {
        if (pendingToolCalls.size > 0) {
          yield buildDone('tool_calls', collectToolCalls())
        } else {
          yield buildDone('stop', [])
        }
      }
    } finally {
      // 中途 break 時必須 cancel，否則 HTTP body stream 會洩漏
      try {
        await reader.cancel()
      } catch {
        // reader 已關閉，忽略
      }
      reader.releaseLock()
    }
  }
}

// ── Adapter Provider ──

export function createProviderAdapter(config: ProviderConfig): ProviderAdapter {
  // 依 provider id 選擇 adapter
  // 現在全部走 OpenAI-compatible（Qwen、DeepSeek、GLM 都行）
  // 之後可以加 AnthropicAdapter、CustomAdapter 等
  return new OpenAICompatibleAdapter(config)
}