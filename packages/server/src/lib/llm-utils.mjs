/**
 * LLM API Utilities — Retry, Sanitize, Validate
 *
 * 解決公司 LLM model 常見問題：
 * 1. API 回空白內容或只有隱藏字元（zero-width space, BOM 等）
 * 2. 連線失敗、timeout、ECONNRESET
 * 3. HTTP 5xx 暫時性錯誤
 * 4. response JSON 壞掉
 *
 * 使用方式：
 *   import { callLLMWithRetry, sanitizeContent, isMeaningfulContent } from '../lib/llm-utils.mjs'
 *
 * 2026-06-27 初版
 */

// ── 配置 ──

const DEFAULT_MAX_RETRIES = 2;           // reduced from 5 — most providers handle 429 internally now, no need to retry 5 times
const DEFAULT_BASE_DELAY_MS = 1000;     // first retry wait 1s (was 2s — most providers don't need long waits)
const DEFAULT_MAX_DELAY_MS = 10000;     // max 10s between retries (was 30s — too long for non-rate-limited providers)
const DEFAULT_TIMEOUT_MS = 60_000;    // API call timeout 60s

// ── AI Call Logging ──
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { mkdirSync, appendFileSync } from "fs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Resolve default model from provider config ──
// Never hardcode a specific model. Chain: defaultModel → active provider's first model → "default"
export function resolveDefaultModel(providerConfig) {
  if (providerConfig?.defaultModel) return providerConfig.defaultModel;
  const activeId = providerConfig?.active;
  const active = providerConfig?.providers?.[activeId];
  const firstModel = active?.models?.[0];
  if (firstModel) return typeof firstModel === "string" ? firstModel : firstModel.id;
  return "default"; // last resort — never a hardcoded model name
}

// 判定為 retryable 的 HTTP status
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

// 判定為 retryable 的 error code
const RETRYABLE_ERR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

// ── 隱藏字元清理 ──

/**
 * 清理 LLM 回應中的隱藏/無形字元
 * - Zero-width space (U+200B, U+200C, U+200D)
 * - Zero-width non-joiner (U+200C)
 * - BOM (U+FEFF)
 * - Soft hyphen (U+00AD)
 * - 各種 invisible Unicode
 *
 * @param {string} text
 * @returns {string} 清理後的文字
 */
export function sanitizeContent(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    // BOM
    .replace(/\uFEFF/g, '')
    // Zero-width characters
    .replace(/[\u200B\u200C\u200D\u200E\u200F]/g, '')
    // Zero-width no-break space (NBSP sometimes used as zero-width)
    .replace(/\u2060/g, '')
    // Word joiner
    .replace(/\u2063/g, '')
    // Invisible characters
    .replace(/[\u00AD\u2061\u2062\u2064]/g, '')
    // 左右 text direction marks
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    // 連續多個空行壓成兩個
    .replace(/\n{4,}/g, '\n\n\n')
    // trim 頭尾
    .trim();
}

/**
 * 檢查 LLM 回應是否有實質內容
 * 不只是空白、隱藏字元、或單獨標點
 *
 * @param {string} content
 * @returns {boolean}
 */
export function isMeaningfulContent(content) {
  if (!content) return false;
  const cleaned = sanitizeContent(content);
  if (cleaned.length === 0) return false;

  // 全部是空白/換行/tab
  if (/^\s*$/.test(cleaned)) return false;

  // 去掉所有空白後長度為 0
  const noSpace = cleaned.replace(/\s+/g, '');
  if (noSpace.length === 0) return false;

  // 只剩標點符號
  if (/^[。，．.、,;；!！?？\s]+$/.test(cleaned)) return false;

  return true;
}

// ── Sleep helper ──

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 計算 backoff delay（exponential + jitter）──

function calcBackoff(attempt, baseDelay, maxDelay) {
  const exp = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // jitter: 50%~100% of exponential
  return Math.floor(exp * (0.5 + Math.random() * 0.5));
}

// ── 判定是否該 retry ──

function isRetryableError(err, respStatus) {
  // HTTP status 判定
  if (respStatus && RETRYABLE_STATUS.has(respStatus)) return true;

  // Error code 判定
  if (err) {
    const code = err.code || err.cause?.code;
    if (code && RETRYABLE_ERR_CODES.has(code)) return true;

    // TypeError: fetch failed (Node.js undici)
    if (err.name === 'TypeError' && err.message?.includes('fetch')) return true;

    // 通用 network error 關鍵字
    const msg = err.message?.toLowerCase() || '';
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('socket')) return true;
  }

  return false;
}

// ── AbortController timeout ──

function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 不要讓 timer 卡住 process 退出
  if (timer.unref) timer.unref();
  return { controller, timer };
}

// ── 核心：帶 retry 的 fetch ──

/**
 * 帶 retry + timeout 的 fetch
 *
 * @param {string} url
 * @param {Object} options - fetch options
 * @param {Object} [opts] - 額外設定
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.baseDelayMs=1000]
 * @param {number} [opts.maxDelayMs=15000]
 * @param {number} [opts.timeoutMs=60000]
 * @param {Function} [opts.onRetry] - callback(retryInfo) for logging
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, opts = {}) {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onRetry = null,
  } = opts;
  const _startTime = Date.now();
  let _body = null;
  try { _body = JSON.parse(options.body || '{}'); } catch {}

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { controller, timer } = createTimeoutController(timeoutMs);

    try {
      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // 如果是 retryable HTTP status，retry
      if (isRetryableError(null, resp.status) && attempt < maxRetries) {
        const retryAfter = resp.headers.get('Retry-After');
        let delay;
        if (retryAfter) {
          const parsed = Number(retryAfter);
          delay = parsed > 0 ? parsed * 1000 : calcBackoff(attempt, baseDelayMs, maxDelayMs);
          delay = Math.min(delay, 60_000);
        } else {
          delay = calcBackoff(attempt, baseDelayMs, maxDelayMs);
        }
        const retryInfo = {
          attempt: attempt + 1,
          maxRetries,
          status: resp.status,
          delayMs: delay,
          retryAfter: !!retryAfter,
          url,
        };
        if (onRetry) onRetry(retryInfo);
        console.warn(`[LLM-Utils] Retry ${attempt + 1}/${maxRetries} in ${delay}ms (HTTP ${resp.status}${retryAfter ? ', Retry-After: ' + retryAfter : ''})`);
        await sleep(delay);
        continue;
      }

      // Log result before returning
      return resp;

    } catch (err) {
      clearTimeout(timer);

      // AbortError = timeout
      if (err.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${timeoutMs}ms`);
        lastError.code = 'TIMEOUT';
      } else {
        lastError = err;
      }

      // 判定是否 retryable
      if (attempt < maxRetries && isRetryableError(lastError)) {
        const delay = calcBackoff(attempt, baseDelayMs, maxDelayMs);
        const retryInfo = {
          attempt: attempt + 1,
          maxRetries,
          error: lastError.message,
          code: lastError.code,
          delayMs: delay,
          url,
        };
        if (onRetry) onRetry(retryInfo);
        console.warn(`[LLM-Utils] Retry ${attempt + 1}/${maxRetries} in ${delay}ms (${lastError.message})`);
        await sleep(delay);
        continue;
      }

      // Log error before throwing

      throw lastError;
    }
  }

  // 不應該到這裡，但以防萬一
  throw lastError || new Error('fetchWithRetry: unknown failure');
}

// ── 核心：帶 retry 的 LLM chat completion call（非串流）──

/**
 * 完整的 LLM call 包裝：retry + timeout + 內容驗證 + sanitize
 *
 * @param {string} apiUrl - 完整 API URL
 * @param {Object} headers - request headers
 * @param {Object} body - request body (model, messages, etc.)
 * @param {Object} [opts] - 額外設定
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.timeoutMs=60000]
 * @param {boolean} [opts.validateContent=true] - 驗證回應有實質內容
 * @param {boolean} [opts.sanitize=true] - 清理隱藏字元
 * @returns {Promise<{content: string, raw: Object, attempts: number}>}
 */
export async function callLLMWithRetry(apiUrl, headers, body, opts = {}) {
  const {
    maxRetries = 2,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    validateContent = true,
    sanitize = true,
  } = opts;
  const _startTime = Date.now();
  const _callId = `llm-${_startTime}-${Math.random().toString(36).slice(2, 8)}`;

  // ── LLM Request Log ──
  _writeLlmLog({
    id: _callId,
    ts: new Date(_startTime).toISOString(),
    phase: "request",
    model: body.model || "?",
    stream: false,
    apiUrl: apiUrl.replace(/\/v.*$/, "/..."),
    messageCount: body.messages?.length,
    messagesPreview: body.messages?.map(m => ({ role: m.role, len: (m.content || "").length, preview: (m.content || "").slice(0, 200) })),
    toolsCount: body.tools?.length || 0,
    toolNames: (body.tools || []).map(t => t.function?.name).filter(Boolean),
    maxTokens: body.max_tokens,
    caller: opts.caller || null,
  });

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }, {
        maxRetries: 0, // 內層不 retry，由外層統一控制
        timeoutMs,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`LLM API error ${resp.status}: ${errText.slice(0, 500)}`);
      }

      // 解析 JSON（防壞）
      let data;
      try {
        data = await resp.json();
      } catch (jsonErr) {
        throw new Error(`LLM API returned invalid JSON: ${jsonErr.message}`);
      }

      // 取出 content
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error('LLM API returned no choices');
      }

      let content = choice.message?.content || '';

      // sanitize 隱藏字元
      if (sanitize) {
        content = sanitizeContent(content);
      }

      // 驗證有實質內容（只對純文字回應做，tool_calls 可能 content 為空）
      const hasToolCalls = choice.message?.tool_calls?.length > 0;
      if (validateContent && !hasToolCalls && !isMeaningfulContent(content)) {
        console.warn(`[LLM-Utils] Attempt ${attempt + 1}: response content is empty/whitespace/hidden-only`);
        if (attempt < maxRetries) {
          const delay = calcBackoff(attempt, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS);
          console.warn(`[LLM-Utils] Retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        // 最後一次還是空的，回傳空字串讓 caller 處理
        console.warn('[LLM-Utils] All retries exhausted on empty content');
      }

      // Log successful call
      _writeLlmLog({
        id: _callId,
        ts: new Date().toISOString(),
        phase: "response",
        model: body.model || "?",
        stream: false,
        durationMs: Date.now() - _startTime,
        error: null,
        finishReason: choice.finish_reason || null,
        contentLen: content.length,
        contentPreview: content.slice(0, 500),
        toolCalls: (choice.message?.tool_calls || []).map(tc => ({ name: tc.function?.name, argsLen: (tc.function?.arguments || "").length })),
        usage: data.usage || null,
        caller: opts.caller || null,
        attempts: attempt + 1,
      });

      return {
        content,
        raw: data,
        choices: data.choices,
        finishReason: choice.finish_reason,
        toolCalls: choice.message?.tool_calls || null,
        attempts: attempt + 1,
      };

    } catch (err) {
      lastError = err;

      // Log error
      _writeLlmLog({
        id: _callId,
        ts: new Date().toISOString(),
        phase: "response",
        model: body.model || "?",
        stream: false,
        durationMs: Date.now() - _startTime,
        error: err.message?.slice(0, 500) || String(err),
        caller: opts.caller || null,
        attempts: attempt + 1,
      });

      // 如果是 retryable 且還有 retry 次數
      if (attempt < maxRetries) {
        const status = err.message?.match(/HTTP (\d+)/)?.[1];
        const isRetryable = isRetryableError(err, status ? parseInt(status) : null);

        if (isRetryable) {
          const delay = calcBackoff(attempt, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS);
          console.warn(`[LLM-Utils] Retry ${attempt + 1}/${maxRetries} in ${delay}ms (${err.message.slice(0, 100)})`);
          await sleep(delay);
          continue;
        }
      }

      // 非 retryable 或最後一次，直接拋出
      throw err;
    }
  }

  throw lastError || new Error('callLLMWithRetry: exhausted all retries');
}

// ── 串流用：帶 retry 的 fetch（給 streaming provider 用）──

/**
 * 串流版的 retry fetch
 * 只在「連線階段」retry，串流開始後不 retry
 *
 * @param {string} url
 * @param {Object} options - fetch options
 * @param {Object} [opts]
 * @returns {Promise<Response>}
 */
export async function fetchStreamWithRetry(url, options = {}, opts = {}) {
  const {
    maxRetries = 2,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onRetry = null,
  } = opts;
  const _startTime = Date.now();
  let _body = null;
  try { _body = JSON.parse(options.body || '{}'); } catch {}

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { controller, timer } = createTimeoutController(timeoutMs);

    try {
      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // retryable status → retry
      if (isRetryableError(null, resp.status) && attempt < maxRetries) {
        // Respect Retry-After header if present
        const retryAfter = resp.headers.get('Retry-After');
        let delay;
        if (retryAfter) {
          const parsed = Number(retryAfter);
          // Retry-After can be seconds or HTTP-date
          delay = parsed > 0 ? parsed * 1000 : calcBackoff(attempt, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS);
          delay = Math.min(delay, 60_000); // cap at 60s even with Retry-After
        } else {
          delay = calcBackoff(attempt, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS);
        }
        if (onRetry) onRetry({ attempt: attempt + 1, status: resp.status, delayMs: delay, retryAfter: !!retryAfter });
        console.warn(`[LLM-Utils] Stream retry ${attempt + 1}/${maxRetries} in ${delay}ms (HTTP ${resp.status}${retryAfter ? ', Retry-After: ' + retryAfter : ''})`);
        await sleep(delay);
        continue;
      }

      // 非 retryable status 或最後一次 → 回傳
      // Log stream request (success or final non-retryable error)
      if (resp.ok) {
      } else {
      }
      return resp;

    } catch (err) {
      clearTimeout(timer);

      lastError = err.name === 'AbortError'
        ? Object.assign(new Error(`Stream timeout after ${timeoutMs}ms`), { code: 'TIMEOUT' })
        : err;

      if (attempt < maxRetries && isRetryableError(lastError)) {
        const delay = calcBackoff(attempt, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS);
        if (onRetry) onRetry({ attempt: attempt + 1, error: lastError.message, code: lastError.code, delayMs: delay });
        console.warn(`[LLM-Utils] Stream retry ${attempt + 1}/${maxRetries} in ${delay}ms (${lastError.message})`);
        await sleep(delay);
        continue;
      }

      // Log timeout/connection error

      throw lastError;
    }
  }

  throw lastError || new Error('fetchStreamWithRetry: exhausted all retries');
}

// ── LLM Log Writer (shared by callLLMWithRetry and callLLM) ──
const _PAAW_ROOT = resolve(dirname(__filename), "../../../../");

function _writeLlmLog(entry) {
  try {
    const logDir = join(_PAAW_ROOT, "data", "llm-logs");
    mkdirSync(logDir, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    const logPath = join(logDir, `${dateStr}.jsonl`);
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch (_e) { /* never fail the LLM call for a logging error */ }
}
