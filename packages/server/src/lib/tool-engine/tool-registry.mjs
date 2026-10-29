/**
 * Tool Registry — 統一的工具註冊與執行 (.mjs)
 *
 * 所有 tool 都透過 registry 統一管理：
 * - 註冊 executor
 * - 取得 tool definitions（給 LLM）
 * - 執行 tool call
 */

export class ToolRegistry {
  constructor() {
    this.executors = new Map()
  }

  /** 註冊一個 executor */
  register(executor) {
    this.executors.set(executor.name, executor)
  }

  /** 批次註冊 */
  registerAll(executors) {
    for (const ex of executors) {
      this.register(ex)
    }
  }

  /** 移除 */
  unregister(name) {
    this.executors.delete(name)
  }

  /** 取得所有 tool definitions（OpenAI format） */
  getToolDefinitions() {
    const tools = []
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

  /** 取得單個 definition */
  getToolDef(name) {
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
  has(name) {
    return this.executors.has(name)
  }

  /** 執行一個 tool call */
  async execute(name, args) {
    const executor = this.executors.get(name)
    if (!executor) {
      return { text: `未知工具：${name}`, error: true }
    }
    try {
      return await executor.execute(args)
    } catch (err) {
      return { text: `工具執行錯誤 (${name}): ${err.message}`, error: true }
    }
  }

  /** 列出所有工具名稱 */
  listNames() {
    return Array.from(this.executors.keys())
  }

  /** 清除所有 */
  clear() {
    this.executors.clear()
  }
}