/**
 * Approval Manager — 批准系統
 *
 * 敏感操作需要用戶確認才能執行。
 * 支援多種批准模式：
 * - always: 每次都要批准
 * - on-miss: 政策不確定時要求批准
 * - auto: 自動批准（開發模式）
 * - deny: 拒絕所有（最高安全模式）
 */

export class ApprovalManager {
  constructor(options = {}) {
    this.mode = options.mode || 'always'  // always | on-miss | auto | deny
    this.pending = new Map()  // id → { toolName, args, timestamp }
    this.timeout = options.timeout || 120_000  // 2 分鐘未批准自動過期
    this.history = new Map()  // toolName → { approved, denied }
  }

  /**
   * 請求批准
   * @returns {{ id: string, status: 'pending' }}
   */
  async request(toolName, args, context = {}) {
    if (this.mode === 'deny') {
      return { id: null, status: 'denied', reason: 'Approval mode: deny' }
    }
    if (this.mode === 'auto') {
      return { id: null, status: 'approved' }
    }

    const id = `approval:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`

    const record = {
      id,
      toolName,
      args,
      agentId: context.agentId || 'default',
      sessionKey: context.sessionKey || 'anonymous',
      timestamp: Date.now(),
      status: 'pending',  // pending | approved | denied | expired
    }

    this.pending.set(id, record)

    // 自動過期
    setTimeout(() => {
      const r = this.pending.get(id)
      if (r && r.status === 'pending') {
        r.status = 'expired'
        this.pending.delete(id)
      }
    }, this.timeout)

    return { id, status: 'pending' }
  }

  /** 批准 */
  approve(id) {
    const record = this.pending.get(id)
    if (!record) return false
    if (record.status !== 'pending') return false

    record.status = 'approved'
    this.pending.delete(id)

    // 記錄歷史
    const key = record.toolName
    if (!this.history.has(key)) this.history.set(key, { approved: 0, denied: 0 })
    this.history.get(key).approved++

    return true
  }

  /** 拒絕 */
  deny(id) {
    const record = this.pending.get(id)
    if (!record) return false
    if (record.status !== 'pending') return false

    record.status = 'denied'
    this.pending.delete(id)

    const key = record.toolName
    if (!this.history.has(key)) this.history.set(key, { approved: 0, denied: 0 })
    this.history.get(key).denied++

    return true
  }

  /** 檢查批准狀態 */
  getStatus(id) {
    const record = this.pending.get(id)
    if (!record) return { status: 'not_found' }
    return { id: record.id, status: record.status, toolName: record.toolName }
  }

  /** 取得待批准的列表 */
  listPending() {
    return Array.from(this.pending.values())
      .filter(r => r.status === 'pending')
      .map(r => ({ id: r.id, toolName: r.toolName, args: r.args, timestamp: r.timestamp }))
  }

  /** 清除歷史 */
  clearHistory() {
    this.history.clear()
  }
}