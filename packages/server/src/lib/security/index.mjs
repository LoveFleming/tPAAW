/**
 * Security Kernel — PAAW 安全核心
 *
 * 每一個 tool call 都是攻擊面。
 * 每一個 API key 都是資產。
 * 每一個 user message 都是隱私。
 *
 * Security Kernel 負責統一管理：
 * - Policy Pipeline（政策管線）
 * - Approval System（批准系統）
 * - Secret Store（加密金鑰儲存）
 * - Audit Log（稽核日誌）
 * - Rate Limiter（速率限制）
 */

import { PolicyPipeline } from './policy-pipeline.mjs'
import { ApprovalManager } from './approval.mjs'
import { SecretStore } from './secret-store.mjs'
import { AuditLog } from './audit-log.mjs'

export class SecurityKernel {
  constructor(options = {}) {
    this.pipeline = new PolicyPipeline()
    this.approval = new ApprovalManager(options.approval)
    this.secrets = new SecretStore(options.secrets)
    this.audit = new AuditLog(options.audit)

    // 註冊內建政策
    this._registerBuiltinPolicies()
  }

  /** 註冊內建安全政策 */
  _registerBuiltinPolicies() {
    // 1. 參數驗證（避免注入）
    this.pipeline.add('param_injection_check', async (ctx) => {
      if (typeof ctx.args === 'string') {
        // 太長或有可疑字元
        if (ctx.args.length > 50000) {
          return { blocked: true, reason: '參數過長' }
        }
        if (/[<>]/.test(ctx.args) && ctx.toolName === 'exec') {
          return { blocked: true, reason: '包含可疑字元' }
        }
      }
      return { blocked: false }
    })

    // 2. exec tool 的安全檢查
    this.pipeline.add('exec_security', async (ctx) => {
      if (ctx.toolName !== 'exec') return { blocked: false }

      const cmd = ctx.args?.command || ctx.args?.cmd || ''
      // 禁止的關鍵字
      const forbidden = [
        'rm -rf /', 'mkfs', 'dd if=', ':(){ :|:& };:', // fork bomb
        '>/dev/sda', '>/dev/nvme', 'chmod 777 /',
        'wget http://', 'curl http://',  // 遠端下載
      ]
      for (const pattern of forbidden) {
        if (cmd.includes(pattern)) {
          return { blocked: true, reason: `禁止的指令模式: ${pattern}` }
        }
      }
      return { blocked: false }
    })

    // 3. fs tool 的安全檢查
    this.pipeline.add('fs_security', async (ctx) => {
      const fsTools = new Set(['fs_write', 'fs_delete', 'fs_rename', 'fs_copy', 'fs_create_file'])
      if (!fsTools.has(ctx.toolName)) return { blocked: false }

      const path = ctx.args?.path || ctx.args?.target || ''
      // 保護 PAAW 系統目錄
      const protectedPaths = ['/data/config/', '/data/db/']
      for (const pp of protectedPaths) {
        if (path.includes(pp)) {
          return { blocked: true, reason: `保護的系統目錄: ${pp}` }
        }
      }
      return { blocked: false }
    })

    // 4. Rate limit
    this.pipeline.add('rate_limit', async (ctx) => {
      const key = `${ctx.sessionKey}:${ctx.toolName}`
      const allowed = this.pipeline.rateLimiter?.check(key, ctx.now)
      if (allowed === false) {
        return { blocked: true, reason: '速率限制，請稍後再試' }
      }
      return { blocked: false }
    })
  }

  /**
   * 執行完整的 tool call 安全檢查
   * @returns {Promise<{allowed: boolean, reason?: string, approval?: boolean}>}
   */
  async checkToolCall(toolName, args, context = {}) {
    const ctx = {
      toolName,
      args,
      sessionKey: context.sessionKey || 'anonymous',
      agentId: context.agentId || 'default',
      now: Date.now(),
    }

    // 稽核紀錄開始
    this.audit.log('tool_call_start', ctx)

    // 政策管線
    const result = await this.pipeline.run(ctx)

    if (result.blocked) {
      this.audit.log('tool_call_blocked', { ...ctx, reason: result.reason })
      return { allowed: false, reason: result.reason }
    }

    // 是否需要批准
    if (result.approvalRequired) {
      this.audit.log('tool_call_pending_approval', ctx)
      return { allowed: false, reason: '需要批准', approval: true }
    }

    this.audit.log('tool_call_allowed', ctx)
    return { allowed: true }
  }

  /** 記錄 tool call 結果 */
  async recordResult(toolName, args, result, context = {}) {
    this.audit.log('tool_call_end', {
      toolName,
      args,
      result,
      sessionKey: context.sessionKey || 'anonymous',
      agentId: context.agentId || 'default',
      timestamp: Date.now(),
      duration: context.duration,
    })
  }

  /** 初始化 — 載入加密 keys */
  async init() {
    await this.secrets.init()
    await this.audit.init()
    return this
  }

  /** 釋放資源 */
  async dispose() {
    await this.secrets.dispose()
  }
}