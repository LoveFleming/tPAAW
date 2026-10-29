/**
 * Audit Log — 稽核日誌
 *
 * 記錄所有 tool call 的完整軌跡：
 * - 誰發起的（agentId, sessionKey）
 * - 叫了什麼 tool（toolName）
 * - 帶什麼參數（args）
 * - 結果如何（allowed/blocked/error）
 * - 花了多久
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export class AuditLog {
  constructor(options = {}) {
    this.dir = options.dir || join(dirname(fileURLToPath(import.meta.url)), '../../../data/audit')
    this.enabled = options.enabled !== false
    this.buffer = []
    this.flushInterval = options.flushInterval || 5000  // 每 5 秒寫一次
    this._timer = null
    this._file = null
  }

  /** 初始化 */
  async init() {
    if (!this.enabled) return
    await mkdir(this.dir, { recursive: true }).catch(() => {})
    this._file = join(this.dir, `audit-${new Date().toISOString().slice(0, 10)}.jsonl`)
    this._startFlushTimer()
  }

  /** 記錄一條稽核事件 */
  log(event, data = {}) {
    if (!this.enabled) return
    this.buffer.push({
      timestamp: new Date().toISOString(),
      event,
      ...data,
    })

    // 也輸出到 console（開發時有用）
    if (process.env.NODE_ENV === 'development') {
      const t = data.toolName || data.event
      const s = data.reason ? ` [${data.reason}]` : ''
      console.log(`[Audit] ${event}: ${t}${s}`)
    }
  }

  /** 強制 flush */
  async flush() {
    if (this.buffer.length === 0 || !this._file) return
    const batch = this.buffer.slice()
    this.buffer = []
    try {
      await appendFile(this._file, batch.map(r => JSON.stringify(r)).join('\n') + '\n')
    } catch (err) {
      console.error('[Audit] Failed to write:', err.message)
    }
  }

  /** 取得今天的稽核記錄 */
  async getTodayLog() {
    if (!this._file) return []
    try {
      const { readFile } = await import('node:fs/promises')
      const content = await readFile(this._file, 'utf-8')
      return content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    } catch {
      return []
    }
  }

  /** 取得最近 N 條記錄 */
  async getRecent(n = 50) {
    const today = await this.getTodayLog()
    return today.slice(-n)
  }

  _startFlushTimer() {
    this._timer = setInterval(() => this.flush(), this.flushInterval)
    this._timer.unref()
  }

  /** 釋放資源 */
  async dispose() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    await this.flush()
  }
}