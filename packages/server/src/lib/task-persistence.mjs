/**
 * TaskPersistenceAdapter — 抽象 task 持久層
 *
 * Interface:
 *   save(task)                     — 儲存/更新整個 task
 *   load(taskId)                   — 載入單一 task
 *   updateStatus(taskId, status)   — 更新狀態
 *   appendArtifact(taskId, artifact) — 附加 artifact
 *   appendEvent(taskId, event)     — 附加事件 (tool call, message, etc.)
 *   appendMemory(taskId, memory)   — 附加記憶片段
 *   saveTokens(taskId, usage)      — 記錄 token 用量
 *   saveCheckpoint(taskId, data)   — 儲存檢查點
 *   saveTrace(taskId, trace)       — 儲存追蹤記錄
 *   list(filter?)                  — 列出所有 tasks
 *   delete(taskId)                 — 刪除 task
 *   findByContext(contextId)       — 用 contextId 查找
 */

// ── Types ──

/**
 * @typedef {Object} TaskRecord
 * @property {string} id
 * @property {string} contextId
 * @property {Object} status - { state, timestamp }
 * @property {Object} message - original user message
 * @property {Array} history - conversation messages
 * @property {Array} artifacts - produced artifacts
 * @property {Object} metadata - { toolsUsed, model, liveState, ... }
 * @property {Array} [events] - tool calls, lifecycle events
 * @property {Array} [memory] - accumulated memory fragments
 * @property {Object} [tokenUsage] - { prompt, completion, total }
 * @property {Array} [checkpoints] - snapshots for rollback
 * @property {Array} [trace] - detailed execution trace
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 */

// ── JSON File Implementation ──

import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export class JsonTaskPersistence {
  /**
   * @param {string} dataDir - Directory to store task JSON files
   * @param {Object} [opts]
   * @param {number} [opts.maxCheckpoints=10] - Max checkpoints per task
   * @param {number} [opts.maxEvents=500] - Max events kept in task file
   */
  constructor(dataDir, opts = {}) {
    this.dir = dataDir;
    this.maxCheckpoints = opts.maxCheckpoints ?? 10;
    this.maxEvents = opts.maxEvents ?? 500;
    this._initialized = false;
  }

  async _ensureDir() {
    if (!this._initialized) {
      await mkdir(this.dir, { recursive: true });
      this._initialized = true;
    }
  }

  _path(taskId) {
    // Sanitize: only allow alphanumeric, dash, underscore
    const safe = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "");
    return resolve(this.dir, `${safe}.json`);
  }

  // ── Core CRUD ──

  /**
   * Save (create or update) a full task record.
   * @param {Object} task
   * @returns {Promise<Object>} the saved task
   */
  async save(task) {
    await this._ensureDir();
    const now = new Date().toISOString();
    if (!task.createdAt) task.createdAt = now;
    task.updatedAt = now;
    await writeFile(this._path(task.id), JSON.stringify(task, null, 2), "utf-8");
    return task;
  }

  /**
   * Load a task by ID.
   * @param {string} taskId
   * @returns {Promise<Object|null>}
   */
  async load(taskId) {
    try {
      const raw = await readFile(this._path(taskId), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Delete a task.
   * @param {string} taskId
   */
  async delete(taskId) {
    try { await unlink(this._path(taskId)); } catch {}
  }

  /**
   * List all tasks, optionally filtered.
   * @param {Object} [filter] - { contextId, state, agentType }
   * @returns {Promise<Object[]>}
   */
  async list(filter = {}) {
    await this._ensureDir();
    try {
      const files = await readdir(this.dir);
      const tasks = [];
      for (const f of files.filter(f => f.endsWith(".json")).sort().reverse()) {
        try {
          tasks.push(JSON.parse(await readFile(resolve(this.dir, f), "utf-8")));
        } catch {}
      }
      if (filter.contextId) return tasks.filter(t => t.contextId === filter.contextId);
      if (filter.state) return tasks.filter(t => t.status?.state === filter.state);
      return tasks;
    } catch {
      return [];
    }
  }

  /**
   * Find the latest task in a given context.
   * @param {string} contextId
   * @returns {Promise<Object|null>}
   */
  async findByContext(contextId) {
    const tasks = await this.list({ contextId });
    return tasks.length > 0 ? tasks[0] : null;
  }

  // ── Partial Updates ──

  /**
   * Update task status.
   * @param {string} taskId
   * @param {Object} status - { state, timestamp? }
   * @returns {Promise<Object|null>}
   */
  async updateStatus(taskId, status) {
    const task = await this.load(taskId);
    if (!task) return null;
    task.status = { ...status, timestamp: status.timestamp || new Date().toISOString() };
    return this.save(task);
  }

  /**
   * Append an artifact to a task.
   * @param {string} taskId
   * @param {Object} artifact
   * @returns {Promise<Object|null>}
   */
  async appendArtifact(taskId, artifact) {
    const task = await this.load(taskId);
    if (!task) return null;
    if (!task.artifacts) task.artifacts = [];
    task.artifacts.push(artifact);
    return this.save(task);
  }

  /**
   * Append an event (tool call, lifecycle, etc.)
   * @param {string} taskId
   * @param {Object} event - { type, name, input?, output?, ts? }
   * @returns {Promise<Object|null>}
   */
  async appendEvent(taskId, event) {
    const task = await this.load(taskId);
    if (!task) return null;
    if (!task.events) task.events = [];
    task.events.push({ ...event, ts: event.ts || Date.now() });
    // Trim if too many events
    if (task.events.length > this.maxEvents) {
      task.events = task.events.slice(-this.maxEvents);
    }
    return this.save(task);
  }

  /**
   * Append a memory fragment.
   * @param {string} taskId
   * @param {Object} memory - { type, content, ts? }
   * @returns {Promise<Object|null>}
   */
  async appendMemory(taskId, memory) {
    const task = await this.load(taskId);
    if (!task) return null;
    if (!task.memory) task.memory = [];
    task.memory.push({ ...memory, ts: memory.ts || Date.now() });
    return this.save(task);
  }

  /**
   * Save token usage for a task.
   * @param {string} taskId
   * @param {Object} usage - { prompt, completion, total }
   * @returns {Promise<Object|null>}
   */
  async saveTokens(taskId, usage) {
    const task = await this.load(taskId);
    if (!task) return null;
    if (!task.tokenUsage) task.tokenUsage = { prompt: 0, completion: 0, total: 0 };
    task.tokenUsage.prompt += usage.prompt || 0;
    task.tokenUsage.completion += usage.completion || 0;
    task.tokenUsage.total += usage.total || 0;
    task.tokenUsage.lastUpdated = new Date().toISOString();
    return this.save(task);
  }

  /**
   * Save a checkpoint (snapshot for rollback).
   * @param {string} taskId
   * @param {Object} data - checkpoint data
   * @param {string} [label] - optional label
   * @returns {Promise<Object|null>}
   */
  async saveCheckpoint(taskId, data, label) {
    const task = await this.load(taskId);
    if (!task) return null;
    if (!task.checkpoints) task.checkpoints = [];
    task.checkpoints.push({
      id: `cp_${Date.now()}`,
      label: label || `checkpoint-${task.checkpoints.length + 1}`,
      data: JSON.parse(JSON.stringify(data)),
      ts: new Date().toISOString(),
    });
    // Keep only recent checkpoints
    if (task.checkpoints.length > this.maxCheckpoints) {
      task.checkpoints = task.checkpoints.slice(-this.maxCheckpoints);
    }
    return this.save(task);
  }

  /**
   * Save/append a trace entry.
   * @param {string} taskId
   * @param {Object} trace - { round, question, response, status, tools? }
   * @returns {Promise<Object|null>}
   */
  async saveTrace(taskId, trace) {
    const task = await this.load(taskId);
    if (!task) return null;
    if (!task.trace) task.trace = [];
    task.trace.push({ ...trace, ts: trace.ts || Date.now() });
    return this.save(task);
  }
}
