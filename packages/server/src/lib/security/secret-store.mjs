/**
 * Secret Store — 加密金鑰儲存
 *
 * API keys 不應該明文存在磁碟上。
 * Secret Store 提供：
 * - AES-256-GCM 加密/解密
 * - Master key 存放在系統 keychain 或檔案系統安全位置
 * - 運行中只在 memory 保留解密後的值
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32

export class SecretStore {
  constructor(options = {}) {
    this.keyPath = options.keyPath || join(dirname(fileURLToPath(import.meta.url)), '../../../.paaw/keys/master.key')
    this.decrypted = new Map()  // memory only cache
    this._masterKey = null
  }

  /** 初始化：讀取或建立 master key */
  async init() {
    await mkdir(dirname(this.keyPath), { recursive: true }).catch(() => {})

    if (existsSync(this.keyPath)) {
      const raw = await readFile(this.keyPath, 'utf-8')
      this._masterKey = Buffer.from(raw.trim(), 'hex')
    } else {
      // 第一次執行：生成新的 master key
      this._masterKey = randomBytes(KEY_LENGTH)
      await writeFile(this.keyPath, this._masterKey.toString('hex'), {
        mode: 0o600,  // only owner can read
      })
      console.log(`[SecretStore] Created master key: ${this.keyPath}`)
    }

    if (this._masterKey.length !== KEY_LENGTH) {
      throw new Error(`Invalid master key length: ${this._masterKey.length} (expected ${KEY_LENGTH})`)
    }
  }

  /**
   * 加密 — 回傳 encrypt:AES256:base64(iv):base64(cipher):base64(tag)
   */
  encrypt(plaintext) {
    if (!this._masterKey) throw new Error('SecretStore not initialized')
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this._masterKey, iv, { authTagLength: 16 })
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
    const tag = cipher.getAuthTag()

    const ivB64 = iv.toString('base64')
    const cipherB64 = encrypted.toString('base64')
    const tagB64 = tag.toString('base64')

    return `enc:AES256:${ivB64}:${cipherB64}:${tagB64}`
  }

  /**
   * 解密 — 從 enc:AES256: 格式還原
   */
  decrypt(encoded) {
    if (!this._masterKey) throw new Error('SecretStore not initialized')
    if (!encoded.startsWith('enc:AES256:')) return encoded  // 沒加密的直接回傳

    const parts = encoded.split(':')
    if (parts.length !== 5) throw new Error('Invalid encrypted format')

    const iv = Buffer.from(parts[2], 'base64')
    const encrypted = Buffer.from(parts[3], 'base64')
    const tag = Buffer.from(parts[4], 'base64')

    const decipher = createDecipheriv(ALGORITHM, this._masterKey, iv, { authTagLength: 16 })
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

    return decrypted.toString('utf-8')
  }

  /** 從 config 讀取 provider API key（自動解密） */
  resolveApiKey(provider) {
    const cacheKey = `provider:${provider.id}:apiKey`
    if (this.decrypted.has(cacheKey)) {
      return this.decrypted.get(cacheKey)
    }
    const plain = this.decrypt(provider.apiKey)
    this.decrypted.set(cacheKey, plain)
    return plain
  }

  /** 從 config 讀取所有 provider 的 key（一次性載入） */
  resolveAllProviderKeys(providersConfig) {
    for (const [id, provider] of Object.entries(providersConfig.providers || {})) {
      if (provider.apiKey && provider.apiKey.startsWith('enc:')) {
        this.resolveApiKey({ id, apiKey: provider.apiKey })
      }
    }
  }

  /** 清除 memory cache（安全操作） */
  clearCache() {
    // 覆寫記憶體中的 key
    for (const [key, value] of this.decrypted) {
      this.decrypted.set(key, 'x'.repeat(value.length))
    }
    this.decrypted.clear()
  }

  /** 釋放資源 */
  async dispose() {
    this.clearCache()
    this._masterKey = null
  }
}