/**
 * Provider Adapter — AI Provider 抽象層 (.mjs)
 *
 * 把不同 provider 的 API 差異擋在外面。
 * 目前實作 OpenAI-compatible（Qwen、DeepSeek、GLM 都支援）
 *
 * 2026-06-22: 退回上週四乾淨版本 + URL 檢查 + fetch try-catch
 * 2026-06-27: 加 fetchStreamWithRetry + 內容 sanitize
 */

import { fetchStreamWithRetry, sanitizeContent } from '../llm-utils.mjs'
import { fileURLToPath } from 'url'
import { dirname, resolve as pathResolve, join } from 'path'
import { existsSync, mkdirSync, appendFileSync } from 'fs'

const __providerDir = dirname(fileURLToPath(import.meta.url))
const PAAW_ROOT = pathResolve(__providerDir, '../../../../')

/** Append an LLM log entry to data/llm-logs/YYYY-MM-DD.jsonl */
function _llmLog(entry) {
  try {
    const logDir = join(PAAW_ROOT, "data", "logs", "llm")
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
    const dateStr = new Date().toISOString().slice(0, 10)
    const logPath = join(logDir, `${dateStr}.jsonl`)
    appendFileSync(logPath, JSON.stringify(entry) + '\n')
  } catch {}
}

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
    const providerId = this.config.id || 'unknown'
    const streamStartTime = Date.now()
    let requestBody = null // will be set after body is built

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

    console.log(`[Provider] → POST ${url} model=${modelName} msgs=${messages.length} tools=${tools.length}`)

    // ── LLM Request Log ──
    const callId = `llm-${streamStartTime}-${Math.random().toString(36).slice(2, 8)}`
    _llmLog({
      id: callId,
      ts: new Date(streamStartTime).toISOString(),
      phase: 'request',
      agentId: this.config.agentId || 'unknown',
      model: modelName,
      stream: true,
      caller: this.config.caller || 'tool-engine',
      messageCount: messages.length,
      toolNames: (tools || []).map(t => t.function?.name).filter(Boolean),
    })

    requestBody = body
    const fs = await import('fs')
    const nodePath = await import('path')
    const tempDir = nodePath.join(PAAW_ROOT, 'temp')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    const payloadPath = nodePath.join(tempDir, `payload-${Date.now()}.json`)
    fs.writeFileSync(payloadPath, JSON.stringify(body, null, 2))
    console.log(`[Provider] Payload: ${payloadPath}`)
    console.log(`[Provider] URL: ${url}`)

    let response
    try {
      response = await fetchStreamWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }, {
        maxRetries: 3,
        timeoutMs: 300_000,
        readTimeoutMs: 600_000,
        onRetry: (info) => console.log(`[Provider] ${info.error ? info.error : 'HTTP ' + info.status} → retry ${info.attempt} in ${info.delayMs}ms`),
      })
    } catch (fetchErr) {
      console.log(`[Provider] Fetch error after retries: ${fetchErr.message}`)
      yield { type: 'error', message: `連線錯誤（已 retry）: ${fetchErr.message}` }
      return
    }

    console.log(`[Provider] ← status=${response.status}`)

    if (!response.ok) {
      const errText = await response.text()
      console.log(`[Provider] Error body: ${errText.slice(0, 500)}`)
      yield { type: 'error', message: `API error ${response.status}: ${errText.slice(0, 300)}` }
      return
    }

    if (!response.body) {
      yield { type: 'error', message: 'API 回應沒有 body' }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // 累積 tool calls（index → { id, name, args }）
    const pendingTools = new Map()
    let doneEmitted = false
    let lastFinishReason = null
    let accumulatedContentLen = 0
    let accumulatedToolCalls = []

    // ★ 寫 streaming result 到 temp
    const streamLogPath = nodePath.join(tempDir, `stream-${Date.now()}.log`)
    let streamLog = ''
    const logStream = (line) => { streamLog += line + '\n' }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          logStream('=== STREAM ENDED ===')
          break
        }

        const rawChunk = decoder.decode(value, { stream: true })
        logStream(`--- CHUNK ${Date.now()} bytes=${value?.length} ---`)
        logStream(rawChunk)

        buffer += rawChunk
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            logStream('[DONE] received')
            continue
          }

          try {
            const parsed = JSON.parse(data)
            logStream(`PARSED: ${JSON.stringify(parsed).slice(0, 300)}`)
            const choice = parsed.choices?.[0]
            if (!choice) {
              logStream(`NO CHOICE: ${JSON.stringify(parsed).slice(0, 200)}`)
              continue
            }

            const finishReason = choice.finish_reason
            const delta = choice.delta

            // Text
            if (delta?.content) {
              // Only strip invisible chars per-chunk; DON'T trim (would eat \n at chunk boundaries)
              const cleanDelta = delta.content
                .replace(/\uFEFF/g, '')
                .replace(/[\u200B\u200C\u200D\u200E\u200F]/g, '')
                .replace(/\u2060/g, '')
                .replace(/\u2063/g, '')
                .replace(/[\u00AD\u2061\u2062\u2064]/g, '')
                .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
              if (cleanDelta) {
                accumulatedContentLen += cleanDelta.length
                yield { type: 'text', delta: cleanDelta }
              }
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
              logStream(`FINISH: tool_calls, count=${pendingTools.size}`)
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
              lastFinishReason = finishReason
              accumulatedToolCalls = toolCalls.map(tc => ({ name: tc.function?.name, argsLen: (tc.function?.arguments || '').length }))
              doneEmitted = true
              pendingTools.clear()
              break
            }

            if (finishReason === 'stop') {
              logStream(`FINISH: stop`)
              console.log(`[Provider] finishReason=stop`)
              yield { type: 'done', finishReason, toolCalls: [] }
              lastFinishReason = finishReason
              doneEmitted = true
              break
            }
          } catch (parseErr) {
            logStream(`PARSE ERROR: ${parseErr.message} data=${data.slice(0, 200)}`)
          }
        }
      }

      // Stream ended naturally without finish_reason
      if (!doneEmitted) {
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
      }
    } finally {
      // ── LLM Response Log + clean up temp files ──
      try {
        const durationMs = Date.now() - streamStartTime
        _llmLog({
          id: callId,
          ts: new Date().toISOString(),
          phase: 'response',
          agentId: this.config.agentId || 'unknown',
          model: modelName,
          stream: true,
          durationMs,
          finishReason: lastFinishReason || 'stop',
          contentLen: accumulatedContentLen,
          toolCalls: accumulatedToolCalls,
          caller: this.config.caller || 'tool-engine',
        })
        console.log(`[Provider] Stream log: ${streamLogPath}`)
        fs.writeFileSync(streamLogPath, streamLog)
      } catch {}
      // Clean up temp payload file
      try { fs.unlinkSync(payloadPath) } catch {}
      reader.releaseLock()
    }
  }
}

// ── Provider ──

export function createProviderAdapter(config) {
  return new OpenAICompatibleAdapter(config)
}
