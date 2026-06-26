/**
 * Tool Engine — 聊天後面的「隱藏 CLI」
 *
 * Chat 介面只負責收發文字。
 * Tool Engine 在背景管理所有工具呼叫邏輯（ReAct loop），
 * 並整合 Security Kernel 做安全檢查。
 *
 * 2026-06-26: 加入 Result Validation（error detection + success verification）
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

// ── Result Validation ──

/**
 * 判斷 tool name 是否為寫入操作（add / update / delete / set）
 */
function isWriteOperation(name) {
  return /_(add|update|delete|set)$/.test(name)
}

/**
 * 從 tool name 推導出對應的 verify 操作
 * pocket_add → pocket_get
 * pocket_update → pocket_get
 * pocket_delete → pocket_list
 */
function getVerifyToolName(name) {
  if (/_delete$/.test(name)) return name.replace(/_delete$/, '_list')
  return name.replace(/_(add|update|set)$/, '_get')
}

/**
 * 從 write 操作的 args 和 result 中提取 verify 時需要的 lookup id
 */
function extractVerifyId(writeName, args, result) {
  // add 操作：result 裡有 record.id
  if (/_add$/.test(writeName)) {
    return result?.record?.id || result?.id || args?.id || null
  }
  // update 操作：args 裡有 id
  if (/_update$/.test(writeName)) {
    return args?.id || null
  }
  return null
}

/**
 * Error Detection — 檢查 tool result 是否為錯誤
 * 回傳 null（沒問題）或錯誤描述字串
 */
function detectToolError(result) {
  if (!result) return '工具回傳了空結果'
  if (result.error === true) return result.text || '工具執行失敗'
  if (result.success === false) return result.text || '工具執行失敗'
  if (result.text && result.text.startsWith('❌')) return result.text
  return null
}

/**
 * Success Verification — 寫入操作後回查確認
 * 回傳 { verified: true/false, detail: string }
 */
async function verifyWriteResult(toolName, args, result, registry) {
  const id = extractVerifyId(toolName, args, result)
  const verifyName = getVerifyToolName(toolName)

  // delete 特殊處理：用 list 確認資料不在了
  if (/_delete$/.test(toolName)) {
    const deletedId = args?.id
    if (!deletedId) return { verified: true, detail: '刪除完成（無 ID 可回查）' }
    try {
      const verifyResult = await registry.execute(verifyName, {})
      const records = verifyResult?.records || []
      const stillExists = records.some(r => r.id === deletedId)
      if (stillExists) {
        return { verified: false, detail: `⚠️ 刪除後 ID ${deletedId} 仍存在於資料中` }
      }
      return { verified: true, detail: `✅ 已確認 ID ${deletedId} 已刪除` }
    } catch {
      return { verified: true, detail: '刪除完成（無法回查）' }
    }
  }

  // add / update：用 get 確認資料存在
  if (!id) return { verified: true, detail: '操作完成（無 ID 可回查）' }
  if (!registry.has(verifyName)) return { verified: true, detail: '操作完成（無對應的 verify 工具）' }

  try {
    const verifyResult = await registry.execute(verifyName, { id })
    if (detectToolError(verifyResult)) {
      return { verified: false, detail: `⚠️ 寫入後回查失敗：${detectToolError(verifyResult)}` }
    }
    return { verified: true, detail: `✅ 已確認資料存在（ID: ${id}）` }
  } catch (err) {
    return { verified: false, detail: `⚠️ 回查失敗：${err.message}` }
  }
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
        if (round > 0) {
          // Round 2+ — 印最後幾個 messages 看 tool result 格式
          const last3 = messages.slice(-3).map(m => ({ role: m.role, contentLen: typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length, tool_call_id: m.tool_call_id, tool_calls: m.tool_calls?.length }))
          console.log(`[ToolEngine] Round ${round + 1} last 3 msgs:`, JSON.stringify(last3))
        }

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

            // ── Result Validation ──
            // 1. Error Detection
            const errMsg = detectToolError(result)
            if (errMsg) {
              console.log(`[ToolEngine]   ❌ tool error detected: ${tc.function.name} → ${errMsg}`)
              const enriched = {
                ...result,
                _validation: { error: true, message: errMsg },
              }
              yield { type: 'tool_end', name: tc.function.name, result: enriched }
              if (this.security) {
                await this.security.recordResult(tc.function.name, args, result, { sessionKey: this.sessionKey, agentId: this.agentId, duration: Date.now() - startTime })
              }
              // 明確告訴 LLM 工具失敗了
              messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({
                ...result,
                _validation: { error: true, message: errMsg },
                _instruction: '⚠️ 工具執行失敗。你必須如實告訴使用者操作沒有成功，不要假裝成功。',
              }) })
              console.log(`[ToolEngine]   ← tool error pushed: ${tc.function.name}`)
              continue
            }

            // 2. Success Verification（只對寫入操作）
            let verifyDetail = null
            if (isWriteOperation(tc.function.name)) {
              const verify = await verifyWriteResult(tc.function.name, args, result, this.registry)
              verifyDetail = verify
              console.log(`[ToolEngine]   🔍 verify: ${tc.function.name} → ${verify.verified ? 'PASS' : 'FAIL'} ${verify.detail}`)

              // 把驗證結果附加到 tool result，讓 LLM 知道
              const enriched = {
                ...result,
                _validation: { verified: verify.verified, detail: verify.detail },
              }
              yield { type: 'tool_end', name: tc.function.name, result: enriched }
            } else {
              yield { type: 'tool_end', name: tc.function.name, result }
            }

            if (this.security) {
              await this.security.recordResult(tc.function.name, args, result, { sessionKey: this.sessionKey, agentId: this.agentId, duration: Date.now() - startTime })
            }

            // 組裝給 LLM 的 message（含驗證結果）
            const msgContent = verifyDetail
              ? { ...result, _validation: { verified: verifyDetail.verified, detail: verifyDetail.detail } }
              : result
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(msgContent) })
            console.log(`[ToolEngine]   ← tool result pushed: ${tc.function.name} id=${tc.id} verified=${verifyDetail?.verified ?? 'N/A'} msgs=${messages.length}`)
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