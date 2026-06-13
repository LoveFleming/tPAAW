/**
 * Tool Registry — 統一的工具註冊與執行
 *
 * 所有 tool 都透過 registry 統一管理：
 * - 註冊 executor
 * - 取得 tool definitions（給 LLM）
 * - 執行 tool call
 * - 重試、錯誤處理
 */

import type { ToolExecutor, ToolDef, ToolResult } from './types'

export class ToolRegistry {
  private executors: Map<string, ToolExecutor> = new Map()

  /** 註冊一個 executor */
  register(executor: ToolExecutor): void {
    this.executors.set(executor.name, executor)
  }

  /** 批次註冊 */
  registerAll(executors: ToolExecutor[]): void {
    for (const ex of executors) {
      this.register(ex)
    }
  }

  /** 移除一個 executor */
  unregister(name: string): void {
    this.executors.delete(name)
  }

  /** 取得所有 tool definitions（轉成 OpenAI format） */
  getToolDefinitions(): ToolDef[] {
    const tools: ToolDef[] = []
    for (const ex of this.executors.values()) {
      tools.push({
        type: 'function',
        function: {
          name: ex.name,
          description: ex.description,
          parameters: ex.parameters,
        },
      })
    }
    return tools
  }

  /** 取得單個 tool definition */
  getToolDef(name: string): ToolDef | undefined {
    const ex = this.executors.get(name)
    if (!ex) return undefined
    return {
      type: 'function',
      function: {
        name: ex.name,
        description: ex.description,
        parameters: ex.parameters,
      },
    }
  }

  /** 檢查是否已註冊 */
  has(name: string): boolean {
    return this.executors.has(name)
  }

  /** 執行一個 tool call */
  async execute(name: string, args: Record<string, any>): Promise<ToolResult> {
    const executor = this.executors.get(name)
    if (!executor) {
      return { text: `未知工具：${name}`, error: true }
    }

    try {
      return await executor.execute(args)
    } catch (err: any) {
      return { text: `工具執行錯誤 (${name}): ${err.message}`, error: true }
    }
  }

  /** 取得所有已註冊的工具名稱 */
  listNames(): string[] {
    return Array.from(this.executors.keys())
  }

  /** 取得 executor（給特殊用途，如自訂註冊邏輯） */
  getExecutor(name: string): ToolExecutor | undefined {
    return this.executors.get(name)
  }

  /** 清除所有註冊 */
  clear(): void {
    this.executors.clear()
  }
}