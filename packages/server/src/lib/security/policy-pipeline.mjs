/**
 * Policy Pipeline — 政策管線
 *
 * 每個 tool call 都要通過一連串的政策檢查。
 * 每個 policy 是一個 middleware，可以 block 或 pass。
 *
 * Pipeline:
 *   tool call → [policy, policy, policy, ...] → allowed / blocked
 */

export class PolicyPipeline {
  constructor() {
    this.policies = []
    this.rateLimiter = null
  }

  /** 新增政策（順序決定優先級） */
  add(name, handler) {
    this.policies.push({ name, handler })
  }

  /** 在指定位置插入 */
  insertBefore(targetName, name, handler) {
    const idx = this.policies.findIndex(p => p.name === targetName)
    if (idx === -1) {
      this.policies.unshift({ name, handler })
    } else {
      this.policies.splice(idx, 0, { name, handler })
    }
  }

  /** 移除政策 */
  remove(name) {
    this.policies = this.policies.filter(p => p.name !== name)
  }

  /** 設定 rate limiter */
  setRateLimiter(limiter) {
    this.rateLimiter = limiter
  }

  /**
   * 執行管線
   * @returns {{ blocked: boolean, reason?: string, approvalRequired?: boolean }}
   */
  async run(ctx) {
    for (const policy of this.policies) {
      try {
        const result = await policy.handler(ctx)
        if (result.blocked) {
          return { blocked: true, reason: result.reason || `Policy blocked: ${policy.name}` }
        }
        if (result.approvalRequired) {
          return { blocked: false, approvalRequired: true }
        }
      } catch (err) {
        // Policy 本身噴錯 → 安全降級（擋下來）
        console.error(`[Security] Policy ${policy.name} error:`, err.message)
        return { blocked: true, reason: `Internal security error: ${policy.name}` }
      }
    }
    return { blocked: false }
  }
}