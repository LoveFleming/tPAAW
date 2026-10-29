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

    // 5. Approval gate（2026-10-17 TASK-164）
    // 此前 ApprovalManager 被實例化卻從未被呼叫，審批機制在 ToolEngine 路徑實質失效：
    // chat.mjs 生產環境設 approval.mode='always' 也毫無作用，任何 exec/寫入工具都不會被擋下等批准。
    // 現在：有副作用的工具（exec / fs 寫入 / *_add|update|delete|set）標記 approvalRequired，
    // 唯讀工具（*_get / *_list / *_search …）放行，避免純查詢卻每次都被卡住。
    this.pipeline.add('approval_gate', async (ctx) => {
      if (this._isReadOnlyTool(ctx.toolName)) return { blocked: false }
      return { blocked: false, approvalRequired: true }
    })
  }

  /**
   * 是否為唯讀工具（無副作用）→ 免人工批准。
   * 判斷原則：唯讀 = 只查不寫。白名單式放行，其餘一律要求批准（fail-closed）。
   */
  _isReadOnlyTool(toolName) {
    const name = String(toolName || '')
    // 讀取型字尾
    if (/_(get|list|search|read|query|find|status|info|stats|history)$/.test(name)) return true
    // 常見唯讀工具
    if (/^(project_info|read_file|glob|grep|list_|get_)/.test(name)) return true
    // 明確危險 / 寫入：絕不免批准（fall-through = false）
    return false
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
      // 2026-10-17 TASK-164：接上 ApprovalManager（此前從未被呼叫 = 審批實質失效）。
      // 依 mode 語意：
      //   auto  → 立即通過（開發模式）
      //   deny  → 直接擋下
      //   always/on-miss → 建立 pending 審批單，回 approval 資訊給呼叫端轉 UI 審批卡。
      const req = await this.approval.request(toolName, args, {
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
      })

      if (req.status === 'approved') {
        this.audit.log('tool_call_approved', { ...ctx, approvalId: null })
        return { allowed: true, approval: false, approvalId: req.id }
      }
      if (req.status === 'denied') {
        this.audit.log('tool_call_blocked', { ...ctx, reason: req.reason || 'approval denied' })
        return { allowed: false, reason: req.reason || '需要批准（已拒絕）', approval: true }
      }

      // pending：需要使用者決策
      this.audit.log('tool_call_pending_approval', { ...ctx, approvalId: req.id })
      return { allowed: false, reason: '需要批准', approval: true, approvalId: req.id }
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
    // 2026-10-17 TASK-164：ToolEngine 每次 run() 結束就 dispose 一個短命 engine，
    // 若不清 audit flush timer + flush 尾批 buffer，會殘留 timer（memory leak）且漏記最後一批稽核事件。
    try { await this.audit.dispose() } catch { /* 記錄失敗不擋 */ }
    await this.secrets.dispose()
  }
}