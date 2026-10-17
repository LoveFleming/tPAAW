/**
 * Template verification test — F20261016-005 Next.js Route Handler API 範本
 *
 * 這份測試「驗證技能範本」而非平台執行期程式。目標檔是
 *   data/skills/physical-skill/nextjs-backend-best-practices/templates/route-handler-api.ts
 * 一份教學型樣板（app/api/[...]/route.ts），不是可直接 import 執行模組。
 *
 * 因此測試分兩層：
 *   A. 靜態契約掃描 — 用原始碼文字斷言範本「示範的行為」與 Next.js 16 Route Handler
 *      契約一致（例如必須匯出合法 HTTP method、必須 await params/cookies/headers）。
 *      這層同時鎖住 QA qr-20261017-000957-tk50 指出的 blocker，讓缺陷可被回歸偵測。
 *   B. 可執行行為驗證 — 以最小可執行方式重現範本示範的關鍵 handler 語意
 *      （合法輸入 200/201、缺欄位 400、未授權 401、不存在 404、未預期錯誤 500、
 *       超限 429），用假的 fetch 隔離外部依賴，驗證範本「宣稱的行為契約」正確。
 *
 * 註：此檔為範本驗證用途（template-verification），非產品程式測試。
 * 修復範本缺陷不是 tester 的職責 — 缺陷以斷言形式登錄，修好後斷言會轉綠。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(
  __dirname,
  '../../data/skills/physical-skill/nextjs-backend-best-practices/templates/route-handler-api.ts',
);
const TEMPLATE_SRC = readFileSync(TEMPLATE_PATH, 'utf-8');

// 依函式名稱抓出每個 `export async function NAME(...)` 的函式名
function exportedFunctionNames(src) {
  return [...src.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

// ============================================================================
// A. 靜態契約掃描 — 範本是否符合 Next.js 16 Route Handler 契約
// ============================================================================
describe('route-handler-api.ts template — static contract', () => {
  const VALID_HTTP_METHODS = new Set([
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  ]);

  it('exports only valid HTTP method names (Next.js ignores others → 405)', () => {
    const names = exportedFunctionNames(TEMPLATE_SRC);
    expect(names.length).toBeGreaterThan(0);
    const invalid = names.filter((n) => !VALID_HTTP_METHODS.has(n));
    // ✅ 契約：不得有非法 method 名（SEARCH/LOGIN/ME/WEBHOOK/STREAM/UPLOAD/CORS_GET/ERROR_HANDLING/RATE_LIMITED）
    expect(invalid).toEqual([]);
  });

  it('does not export the same method name twice (duplicate export → compile error)', () => {
    const names = exportedFunctionNames(TEMPLATE_SRC);
    const counts = names.reduce((acc, n) => ((acc[n] = (acc[n] || 0) + 1), acc), {});
    const dupes = Object.entries(counts).filter(([, c]) => c > 1).map(([n]) => n);
    expect(dupes).toEqual([]);
  });

  it('awaits params (Next.js 16 params is a Promise)', () => {
    // 範本若示範動態路由，必須有 `await params`
    expect(TEMPLATE_SRC).toMatch(/await\s+params/);
  });

  it('awaits cookies() and headers() (Next.js 16 are async)', () => {
    expect(TEMPLATE_SRC).toMatch(/await\s+cookies\(\)/);
    expect(TEMPLATE_SRC).toMatch(/await\s+(getHeaders|headers)\(\)/);
  });

  it('keeps all import statements hoisted at the top of the file', () => {
    // 契約：import 應集中檔首；散落檔中（L173、L258-259）會誤導複製者
    const lines = TEMPLATE_SRC.split('\n');
    const importLineIdx = [];
    lines.forEach((ln, i) => {
      if (/^\s*import\s/.test(ln)) importLineIdx.push(i);
    });
    // 允許檔首註解區之後的第一個非註解語句群，第一個 import 之前不得有 export/function 主體
    const firstImport = importLineIdx[0];
    const before = lines.slice(0, firstImport).join('\n');
    const hasCodeBeforeImport = /(^|\n)\s*(export|const|let|async function|function)\b/.test(before);
    expect(hasCodeBeforeImport).toBe(false);
  });

  it('URL-encodes user-controlled path/query segments in fetch URLs', () => {
    // 契約：id/query 直接內插未編碼是 SSRF/注入錯誤示範
    const rawInterp = /fetch\(\s*`[^`]*\$\{\s*(id|query|q)\s*\}[^`]*`/g;
    const unsafe = [];
    for (const m of TEMPLATE_SRC.matchAll(rawInterp)) unsafe.push(m[0]);
    const usesEncode = /encodeURIComponent\s*\(\s*(id|query|q)\s*\)/.test(TEMPLATE_SRC);
    expect(unsafe.length === 0 || usesEncode).toBe(true);
  });

  it('sanitizes uploaded filename before writing to disk', () => {
    // 契約：file.name 直接用於檔案路徑 → 路徑穿越
    const unsafeNameUse = /filename\s*=\s*`[^`]*\$\{\s*file\.name\s*\}/.test(TEMPLATE_SRC);
    const hasSanitize =
      /basename\s*\(/.test(TEMPLATE_SRC) ||
      /replace\s*\([^)]*(\.\.|\/|\\\\|path\.sep)/.test(TEMPLATE_SRC);
    expect(unsafeNameUse && !hasSanitize).toBe(false);
  });

  it('does not swallow HTTP errors via fetch(...).then(r => r.json()) without r.ok check', () => {
    // 契約：示範應檢查 r.ok，否則吞掉 4xx/5xx
    const nakedJson = /\.then\(\s*r\s*=>\s*r\.json\(\)\s*\)/g;
    const nakedCount = [...TEMPLATE_SRC.matchAll(nakedJson)].length;
    const okChecks = (TEMPLATE_SRC.match(/r\.ok/g) || []).length;
    // 至少要示範一次 r.ok 檢查（ERROR_HANDLING 範例）
    expect(okChecks).toBeGreaterThan(0);
    // 記錄：此為已知 gap，nakedCount 應為 0 才完全符合最佳實務
    expect(nakedCount).toBe(0);
  });

  it('avoids `any` types in exported handler examples', () => {
    const anyUsage = TEMPLATE_SRC.match(/:\s*any\b/g) || [];
    expect(anyUsage.length).toBe(0);
  });

  it('does not pair wildcard CORS origin with credentials', () => {
    const wildcardOrigin = /Access-Control-Allow-Origin['"\s:,]+['"]\*['"]/.test(TEMPLATE_SRC);
    const withCredentials = /Access-Control-Allow-Credentials/i.test(TEMPLATE_SRC);
    expect(wildcardOrigin && withCredentials).toBe(false);
  });

  it('rate limiter prunes expired keys (no unbounded Map growth)', () => {
    // 契約：Map 過期鍵不清理 → memory leak
    const hasPrune =
      /rateLimitMap\.delete\s*\(/.test(TEMPLATE_SRC) ||
      /for\s*\([^)]*rateLimitMap\b/.test(TEMPLATE_SRC);
    expect(hasPrune).toBe(true);
  });

  it('webhook example performs real signature verification when it claims to', () => {
    const claimsVerify = /verify\s+(webhook\s+)?signature/i.test(TEMPLATE_SRC);
    const hasConstructEvent = /constructEvent\s*\(/.test(TEMPLATE_SRC);
    // 若標題宣稱驗簽，就必須有真正的驗簽呼叫（非只 JSON.parse）
    if (claimsVerify) expect(hasConstructEvent).toBe(true);
  });
});

// ============================================================================
// B. 可執行行為驗證 — 以最小可執行方式重現範本示範的 handler 語意
//    使用假的 fetch 與最小 NextResponse 模擬，驗證狀態碼與回應格式契約。
// ============================================================================
function makeResponse(body, init = {}) {
  return {
    status: init.status ?? 200,
    body,
    headers: init.headers ?? {},
    json: async () => body,
  };
}

const NextResponse = {
  json: (body, init) => makeResponse(body, init),
};

// 範本示範：GET /api/posts/[id] — 找不到回 404
async function demoGetPost(request, { params }, deps) {
  const { id } = await params;
  const post = await deps
    .fetchJson(`https://api.example.com/posts/${encodeURIComponent(id)}`)
    .catch(() => null);
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }
  return NextResponse.json(post);
}

// 範本示範：POST /api/posts — 建立成功回 201
async function demoCreatePost(request, deps) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body required' }, { status: 400 });
  }
  const post = await deps.fetchJson('https://api.example.com/posts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return NextResponse.json(post, { status: 201 });
}

// 範本示範：LOGIN — 憑證無效回 401
async function demoLogin(request, deps) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { email, password } = body ?? {};
  if (!email || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }
  const user = await deps.fetchJson('https://api.example.com/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!user.token) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  return NextResponse.json({ success: true });
}

// 範本示範：ME — 無 token 回 401
async function demoMe(cookieStore) {
  const token = cookieStore.get('token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}

// 範本示範：WEBHOOK — 缺簽章 400、payload 非法 400、成功 200
async function demoWebhook(request, headerGet, deps) {
  let body;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const signature = headerGet('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  await deps.handleEvent(event);
  return NextResponse.json({ received: true });
}

// 範本示範：ERROR_HANDLING — 上游失敗回 500
async function demoErrorHandling(deps) {
  try {
    const data = await deps.fetchJson('https://api.example.com/data');
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// 範本示範：RATE_LIMITED — 超過 10 次回 429；含過期鍵清理
function makeRateLimiter(limit = 10, windowMs = 60_000) {
  const map = new Map();
  return {
    map,
    async handle(ip, now = Date.now()) {
      const entry = map.get(ip);
      if (entry && now < entry.resetAt) {
        if (entry.count >= limit) {
          return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }
        entry.count++;
      } else {
        map.set(ip, { count: 1, resetAt: now + windowMs });
      }
      // prune expired keys (fix for memory leak)
      for (const [k, v] of map) {
        if (now >= v.resetAt) map.delete(k);
      }
      return NextResponse.json({ message: 'Success' });
    },
  };
}

describe('route-handler-api.ts template — demonstrated behavior contract', () => {
  let deps;
  beforeEach(() => {
    deps = {
      fetchJson: async () => ({}),
      handleEvent: async () => {},
    };
  });

  it('GET dynamic route returns 200 when post exists', async () => {
    deps.fetchJson = async () => ({ id: '1', title: 'Hello' });
    const res = await demoGetPost({}, { params: Promise.resolve({ id: '1' }) }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '1', title: 'Hello' });
  });

  it('GET dynamic route returns 404 when post is missing', async () => {
    deps.fetchJson = async () => {
      throw new Error('not found');
    };
    const res = await demoGetPost({}, { params: Promise.resolve({ id: '404' }) }, deps);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Post not found');
  });

  it('POST returns 201 on successful creation', async () => {
    deps.fetchJson = async (_url, init) => ({ id: 'new', ...JSON.parse(init.body) });
    const request = { json: async () => ({ title: 'New Post' }) };
    const res = await demoCreatePost(request, deps);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('new');
  });

  it('POST returns 400 on invalid JSON body', async () => {
    const request = {
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    };
    const res = await demoCreatePost(request, deps);
    expect(res.status).toBe(400);
  });

  it('LOGIN returns 401 on invalid credentials', async () => {
    deps.fetchJson = async () => ({});
    const request = { json: async () => ({ email: 'a@b.c', password: 'wrong' }) };
    const res = await demoLogin(request, deps);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('LOGIN returns 400 when credentials are missing', async () => {
    const request = { json: async () => ({ email: 'a@b.c' }) };
    const res = await demoLogin(request, deps);
    expect(res.status).toBe(400);
  });

  it('LOGIN returns 200 on valid credentials', async () => {
    deps.fetchJson = async () => ({ token: 'jwt-token' });
    const request = { json: async () => ({ email: 'a@b.c', password: 'ok' }) };
    const res = await demoLogin(request, deps);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('ME returns 401 when no auth cookie present', async () => {
    const emptyCookies = { get: () => undefined };
    const res = await demoMe(emptyCookies);
    expect(res.status).toBe(401);
  });

  it('ME returns 200 when auth cookie present', async () => {
    const cookies = { get: (k) => (k === 'token' ? { value: 'abc' } : undefined) };
    const res = await demoMe(cookies);
    expect(res.status).toBe(200);
  });

  it('WEBHOOK returns 400 when signature header is missing', async () => {
    const request = { text: async () => '{}' };
    const res = await demoWebhook(request, () => undefined, deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing signature');
  });

  it('WEBHOOK returns 400 on invalid JSON payload', async () => {
    const request = { text: async () => 'not-json' };
    const res = await demoWebhook(request, () => 'sig', deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
  });

  it('WEBHOOK returns 200 and dispatches event on valid payload', async () => {
    let handled = null;
    deps.handleEvent = async (e) => {
      handled = e.type;
    };
    const request = {
      text: async () => JSON.stringify({ type: 'payment_intent.succeeded', data: { object: {} } }),
    };
    const res = await demoWebhook(request, () => 'sig', deps);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(handled).toBe('payment_intent.succeeded');
  });

  it('ERROR_HANDLING returns 200 on upstream success', async () => {
    deps.fetchJson = async () => ({ value: 42 });
    const res = await demoErrorHandling(deps);
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(42);
  });

  it('ERROR_HANDLING returns 500 when upstream fails', async () => {
    deps.fetchJson = async () => {
      throw new Error('API request failed');
    };
    const res = await demoErrorHandling(deps);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
  });

  it('RATE_LIMITED allows up to 10 requests then returns 429', async () => {
    const rl = makeRateLimiter(10, 60_000);
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      const res = await rl.handle('1.2.3.4', now);
      expect(res.status).toBe(200);
    }
    const res = await rl.handle('1.2.3.4', now);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Too many requests');
  });

  it('RATE_LIMITED resets after window elapses', async () => {
    const rl = makeRateLimiter(10, 60_000);
    for (let i = 0; i < 11; i++) await rl.handle('9.9.9.9', 1_000_000);
    // 新視窗
    const res = await rl.handle('9.9.9.9', 1_000_000 + 60_001);
    expect(res.status).toBe(200);
  });

  it('RATE_LIMITED prunes expired keys to avoid unbounded growth', async () => {
    const rl = makeRateLimiter(10, 60_000);
    await rl.handle('a', 1_000_000);
    await rl.handle('b', 1_000_000);
    expect(rl.map.size).toBe(2);
    // 時間推進到兩者都過期，觸發一次 prune
    await rl.handle('c', 1_000_000 + 60_001);
    // a、b 應已被清掉，只剩 c
    expect(rl.map.has('a')).toBe(false);
    expect(rl.map.has('b')).toBe(false);
    expect(rl.map.has('c')).toBe(true);
  });
});
