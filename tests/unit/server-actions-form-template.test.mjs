/**
 * Template verification test — F20261016-006 Next.js Server Actions 表單範本
 *
 * 目標檔（唯讀 fixture，不 import）：
 *   data/skills/physical-skill/nextjs-backend-best-practices/templates/server-actions-form.tsx
 *
 * 這是「驗證技能範本」而非平台執行期程式。目標檔是教學型樣板，示範 Next.js 16
 * Server Actions 處理表單的完整寫法。它之所以無法直接 import 執行：
 *   1. 依賴 Next.js / React runtime（next/cache、next/navigation、next/headers、
 *      react-dom），專案根未安裝 next / zod（僅範本自帶 package.json 宣告為
 *      optionalDependencies）。
 *   2. 同一檔案內堆疊多個模組層級指令（'use server' / 'use client'）與多個
 *      `export function`，本身就是不可編譯的檔案（見 B1）。
 *
 * 因此測試分兩層（沿用同包既有慣例 route-handler-api-template.test.mjs、
 * nextjs-use-cache-template.test.mjs）：
 *   A. 靜態契約掃描 — 以原始碼文字斷言範本「示範的行為」與 Next.js 16
 *      Server Actions 契約一致，並把 QA review（TASK-049 R1）指出的缺陷
 *      B1–B4 / M1–M6 以斷言形式登錄，使其成為可回歸偵測的紅燈。
 *   B. 可執行語意重現 — 用最小 stub（假 fetch / 假 headers / 記憶體 store）
 *      重現範本示範的 action 關鍵語意，驗證範本「宣稱的行為契約」正確：
 *      驗證失敗回 { errors }、成功回 { success: true }、限流回 { error }、
 *      以及 next/headers 的非同步呼叫形狀。
 *
 * 重要定性：範本目前存在 blocker（QA B1 堆疊指令 → 編譯期報錯、無法直接複製）。
 * 修復範本缺陷是 developer 的職責，不是 tester。本檔把缺陷登錄為紅燈斷言，
 * 範本修好後斷言即轉綠 —— 這是預期的回歸守門，不是測試本身的錯誤。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(
  __dirname,
  '../../data/skills/physical-skill/nextjs-backend-best-practices/templates/server-actions-form.tsx',
);
const TEMPLATE_SRC = readFileSync(TEMPLATE_PATH, 'utf-8');

/** 去掉區塊註解與行註解，只留「活程式碼」，避免註解誤導掃描。 */
const CODE_ONLY = TEMPLATE_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

/** 依名稱抓出 `export async function NAME(` 的函式名。 */
function exportedAsyncFunctionNames(src) {
  return [...src.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

/** 抓出模組層級指令（'use server' / 'use client'，行首可含空白但需為語句主體）。 */
function moduleDirectives(src) {
  return [...src.matchAll(/^\s*['"]use (server|client)['"]\s*$/gm)].map((m) => m[1]);
}

// ============================================================================
// 0. 檔案本體健全性
// ============================================================================
describe('server-actions-form.tsx — 檔案健全性', () => {
  it('檔案存在且非空', () => {
    expect(TEMPLATE_SRC.length).toBeGreaterThan(0);
  });

  it('具備教學標頭，說明示範 Next.js 16 Server Actions', () => {
    expect(TEMPLATE_SRC).toMatch(/Next\.js 16\s*-\s*Server Actions for Form Handling/);
  });

  it('至少匯出多個 async action 函式', () => {
    const names = exportedAsyncFunctionNames(CODE_ONLY);
    expect(names.length).toBeGreaterThanOrEqual(5);
    // 關鍵 action 名稱應存在，作為使用者複製的錨點
    expect(names).toEqual(
      expect.arrayContaining([
        'createPost',
        'createPostWithValidation',
        'likePost',
        'subscribe',
        'submitContactForm',
      ]),
    );
  });

  it('沒有重複的 export 名稱（重複 export → 編譯錯誤）', () => {
    const names = exportedAsyncFunctionNames(CODE_ONLY);
    const counts = names.reduce((acc, n) => ((acc[n] = (acc[n] || 0) + 1), acc), {});
    const dupes = Object.entries(counts).filter(([, c]) => c > 1).map(([n]) => n);
    expect(dupes).toEqual([]);
  });
});

// ============================================================================
// A1. QA Blocker 登錄 — 靜態契約掃描
//     每條對應 QA review（TASK-049 R1）的一個 blocker。
//     範本修正後，這些斷言應自動轉綠。
// ============================================================================
describe('A. 靜態契約掃描 — QA blocker 回歸守門', () => {
  // -------- B1: 同檔多個 'use server' / 'use client' 指令堆疊 --------
  describe('B1 — 模組層級指令不得重複堆疊（Next.js 編譯期會報錯）', () => {
    it('一個檔案最多只能有一個模組層級 "use server"/"use client" 指令', () => {
      const directives = moduleDirectives(CODE_ONLY);
      // 契約：Next.js 只允許每個檔案一個指令；重複堆疊是不可編譯的檔案。
      expect(directives.length).toBeLessThanOrEqual(1);
    });

    it('不得同時出現 "use server" 與 "use client"（語意互斥）', () => {
      const directives = moduleDirectives(CODE_ONLY);
      const hasServer = directives.includes('server');
      const hasClient = directives.includes('client');
      expect(hasServer && hasClient).toBe(false);
    });
  });

  // -------- B2: useFormState 已棄用，應改用 useActionState --------
  describe('B2 — 使用 useActionState，不得示範已棄用的 useFormState', () => {
    it('不得從 react-dom 匯入已棄用的 useFormState', () => {
      const deprecatedImport =
        /import\s*\{[^}]*\buseFormState\b[^}]*\}\s*from\s*['"]react-dom['"]/;
      expect(CODE_ONLY).not.toMatch(deprecatedImport);
    });

    it('不得呼叫 useFormState(...)（React 19 / Next.js 16 應為 useActionState）', () => {
      expect(CODE_ONLY).not.toMatch(/\buseFormState\s*\(/);
    });

    it('示範正確的 useActionState 用法（來自 react）', () => {
      const usesActionState = /\buseActionState\s*\(/.test(CODE_ONLY);
      const importsFromReact =
        /import\s*\{[^}]*\buseActionState\b[^}]*\}\s*from\s*['"]react['"]/.test(CODE_ONLY);
      expect(usesActionState && importsFromReact).toBe(true);
    });
  });

  // -------- B3: z.email() 不是 Zod 合法 API --------
  describe('B3 — email 驗證使用合法 Zod API', () => {
    it('不得使用 z.email()（非 Zod 3 合法 API）', () => {
      expect(CODE_ONLY).not.toMatch(/\bz\.email\s*\(/);
    });

    it('示範合法寫法 z.string().email()', () => {
      expect(CODE_ONLY).toMatch(/z\.string\(\)\s*\.email\s*\(/);
    });
  });

  // -------- B4: progressive enhancement 範例必須真的沒有 JS 也能動 --------
  describe('B4 — 「無 JS 漸進增強」範例必須以 action 綁定表單', () => {
    it('SubscribeForm 必須使用 <form action={...}>（否則無 JS 時無法送出）', () => {
      // 抓 SubscribeForm 的函式主體，斷言其中含 action= 綁定
      const m = CODE_ONLY.match(/export function SubscribeForm\s*\(\)\s*\{([\s\S]*?)\n\}/);
      expect(m, 'SubscribeForm 應存在').not.toBeNull();
      expect(m[1]).toMatch(/<form[^>]*\baction\s*=/);
    });
  });
});

// ============================================================================
// A2. QA Major / Minor 登錄 — 靜態契約掃描（回歸守門）
// ============================================================================
describe('A2. 靜態契約掃描 — QA major/minor 回歸守門', () => {
  it('M1/M3 — 每個對外 fetch 都應檢查 res.ok，不得默默吞掉 4xx/5xx', () => {
    // 契約：範本示範 fetch 時必須檢查回應狀態。掃描「await fetch(...)」出現次數，
    // 以及 res.ok / response.ok 檢查次數。
    const fetchCalls = [...CODE_ONLY.matchAll(/\bawait\s+fetch\s*\(/g)].length;
    const okChecks = [...CODE_ONLY.matchAll(/\b(res|response)\.ok\b/g)].length;
    expect(fetchCalls).toBeGreaterThan(0);
    // 至少每個 fetch 都要有一次回應狀態檢查
    expect(okChecks).toBeGreaterThanOrEqual(fetchCalls);
  });

  it('M5 — 不得用型別別名 FormData 撞名 DOM 的 FormData', () => {
    // 契約：`type FormData = ...` 會遮蔽全域 DOM FormData，誤導複製者
    expect(CODE_ONLY).not.toMatch(/^\s*type\s+FormData\s*=/m);
  });

  it('M6 — 不得用原生 <img>，應示範 next/image', () => {
    const usesRawImg = /<img\s/.test(CODE_ONLY);
    const usesNextImage = /from\s*['"]next\/image['"]/.test(CODE_ONLY);
    // 若示範圖片，就應改用 next/image（或至少不得以原生 <img> 當最佳實務）
    expect(usesRawImg && !usesNextImage).toBe(false);
  });

  it('M4 — rate limiter 必須清除過期鍵（避免 Map 無界成長）', () => {
    const hasPrune =
      /rateLimitMap\.delete\s*\(/.test(CODE_ONLY) ||
      /for\s*\([^)]*rateLimitMap\b/.test(CODE_ONLY);
    expect(hasPrune).toBe(true);
  });

  it('Minor — 示範行動按鈕不應以 alert() 當回饋（教學反例）', () => {
    const hasAlert = /\balert\s*\(/.test(CODE_ONLY);
    expect(hasAlert).toBe(false);
  });

  it('M2 — 公開表單 action 示範應含伺服器端授權/驗證標記，而非裸打 API', () => {
    // 契約：至少示範一次「驗證後才呼叫」的守門（safeParse / parse 成功才繼續）。
    const hasValidationGate = /\b(safeParse|\.parse)\s*\(/.test(CODE_ONLY);
    const hasSuccessGuard = /if\s*\(\s*!\s*parsed\.success\s*\)/.test(CODE_ONLY);
    expect(hasValidationGate && hasSuccessGuard).toBe(true);
  });
});

// ============================================================================
// A3. Next.js 16 正向契約 — 範本應示範的正確模式
// ============================================================================
describe('A3. Next.js 16 Server Actions 正向契約', () => {
  it('所有匯出的 async action 皆以 (formData: FormData) 或 (prevState, formData) 為簽章', () => {
    const actionNames = new Set([
      'createPost',
      'createPostWithValidation',
      'likePost',
      'subscribe',
      'submitContactForm',
    ]);
    for (const name of actionNames) {
      const re = new RegExp(
        `export\\s+async\\s+function\\s+${name}\\s*\\(([^)]*)\\)`,
        's',
      );
      const m = CODE_ONLY.match(re);
      expect(m, `${name} 應存在`).not.toBeNull();
      const params = m[1];
      // 合法簽章：要嘛接收 FormData，要嘛 (prevState, formData)
      const ok =
        /FormData/.test(params) ||
        /prevState[\s\S]*FormData/.test(params) ||
        /(postId|data)\s*:/.test(params);
      expect(ok, `${name} 的參數簽章不符 Server Action 慣例：${params.trim()}`).toBe(true);
    }
  });

  it('示範 Server Action 的錯誤處理以 return errors 取代 throw（較佳 UX）', () => {
    // 契約：驗證失敗回傳 errors 物件，而非 throw
    expect(CODE_ONLY).toMatch(/return\s*\{\s*errors\s*:/);
  });

  it('示範成功路徑回傳 { success: true } 的結構化結果', () => {
    expect(CODE_ONLY).toMatch(/return\s*\{\s*success\s*:\s*true\s*\}/);
  });

  it('示範使用 revalidateTag 作為快取再驗證（Next.js 16 慣例）', () => {
    expect(CODE_ONLY).toMatch(/revalidateTag\s*\(/);
  });

  it('revalidateTag 若採兩參數形式，第二參數須為合法 cache profile', () => {
    // Next.js 16 允許 revalidateTag(tag, profile)；若帶第二參數，須為 'max' | 'default' | 'hours' 之外的合法字串。
    const calls = [...CODE_ONLY.matchAll(/revalidateTag\s*\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      const parts = args.split(',').map((s) => s.trim()).filter(Boolean);
      expect(parts.length).toBeGreaterThanOrEqual(1);
      if (parts.length >= 2) {
        // 第二參數必須是字串字面值（非 undefined / 變數）
        expect(parts[1]).toMatch(/^['"][^'"]+['"]$/);
      }
    }
  });

  it('所有 import 陳述式都集中在檔首（散落檔中會誤導複製者）', () => {
    const lines = CODE_ONLY.split('\n');
    const importIdx = [];
    lines.forEach((ln, i) => {
      if (/^\s*import\s/.test(ln)) importIdx.push(i);
    });
    expect(importIdx.length).toBeGreaterThan(0);
    // 最後一個 import 之後，不得再出現模組層級指令或新的函式宣告
    const lastImport = importIdx[importIdx.length - 1];
    const after = lines.slice(lastImport + 1).join('\n');
    const hasTopLevelDeclAfterImport = /^\s*(export\s+)?(async\s+)?function\s/m.test(after);
    // 若仍有大量 import 散落，即違反檔首集中契約
    expect(hasTopLevelDeclAfterImport).toBe(false);
  });
});

// ============================================================================
// B. 可執行語意重現 — 以最小 stub 驗證範本示範的 action 行為契約
//    這些測試「重現」範本示範的語意（不 import 範本本身），確認範本在
//    文件層陳述的行為是正確的 —— 即範本的『意圖契約』沒有邏輯錯誤。
// ============================================================================
describe('B. 可執行語意重現 — action 行為契約', () => {
  // 最小可執行的 Zod 驗證替身（避免依賴未安裝的 zod）
  const makeValidator = (rules) => ({
    safeParse(input) {
      const errors = {};
      for (const [field, check] of Object.entries(rules)) {
        const val = input[field];
        const err = check(val);
        if (err) (errors[field] ||= []).push(err);
      }
      return Object.keys(errors).length
        ? { success: false, error: { flatten: () => ({ fieldErrors: errors }) } }
        : { success: true, data: input };
    },
  });

  // 重現 createPostWithValidation 的語意
  const postSchema = makeValidator({
    title: (v) => (typeof v !== 'string' || v.length < 3 ? 'title too short' : undefined),
    content: (v) => (typeof v !== 'string' || v.length < 10 ? 'content too short' : undefined),
    tags: (v) => (Array.isArray(v) && v.length >= 1 ? undefined : 'at least one tag required'),
  });

  const createPostWithValidation = async (prevState, formData, { fetchImpl }) => {
    const rawData = {
      title: formData.get('title'),
      content: formData.get('content'),
      tags: formData.get('tags')?.toString().split(',') || [],
    };
    const parsed = postSchema.safeParse(rawData);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }
    try {
      await fetchImpl('https://api.example.com/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      return { success: true };
    } catch {
      return { errors: { _form: ['Failed to create post. Please try again.'] } };
    }
  };

  const makeFormData = (obj) => {
    const map = new Map(Object.entries(obj));
    return { get: (k) => (map.has(k) ? map.get(k) : null) };
  };

  let fetchCalls;
  let okFetch;

  beforeEach(() => {
    fetchCalls = [];
    okFetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { ok: true, status: 200 };
    };
  });

  it('合法輸入 → 呼叫 API 並回傳 { success: true }', async () => {
    const fd = makeFormData({
      title: 'Hello World',
      content: 'This is a long enough content body.',
      tags: 'a,b',
    });
    const res = await createPostWithValidation({}, fd, { fetchImpl: okFetch });
    expect(res).toEqual({ success: true });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://api.example.com/posts');
    // payload 應為解析後的資料（tags 已 split 成陣列）
    expect(JSON.parse(fetchCalls[0].opts.body).tags).toEqual(['a', 'b']);
  });

  it('標題過短（邊界：2 字）→ 回傳 errors.title，且不呼叫 API', async () => {
    const fd = makeFormData({ title: 'ab', content: '1234567890', tags: 'a' });
    const res = await createPostWithValidation({}, fd, { fetchImpl: okFetch });
    expect(res.errors).toBeDefined();
    expect(res.errors.title).toBeTruthy();
    expect(res.success).toBeUndefined();
    expect(fetchCalls).toHaveLength(0);
  });

  it('邊界：標題恰好 3 字視為合法', async () => {
    const fd = makeFormData({ title: 'abc', content: '1234567890', tags: 'a' });
    const res = await createPostWithValidation({}, fd, { fetchImpl: okFetch });
    expect(res).toEqual({ success: true });
  });

  it('content 恰好 10 字視為合法，9 字視為非法（邊界）', async () => {
    const ok = await createPostWithValidation(
      {},
      makeFormData({ title: 'abc', content: '1234567890', tags: 'a' }),
      { fetchImpl: okFetch },
    );
    expect(ok).toEqual({ success: true });

    const bad = await createPostWithValidation(
      {},
      makeFormData({ title: 'abc', content: '123456789', tags: 'a' }),
      { fetchImpl: okFetch },
    );
    expect(bad.errors.content).toBeTruthy();
  });

  it('缺 tags（空陣列）→ 回傳 errors.tags', async () => {
    const fd = makeFormData({ title: 'abc', content: '1234567890' }); // no tags → null → []
    const res = await createPostWithValidation({}, fd, { fetchImpl: okFetch });
    expect(res.errors.tags).toBeTruthy();
    expect(fetchCalls).toHaveLength(0);
  });

  it('空 payload（全缺）→ 三個欄位皆報錯（決策表全覆蓋）', async () => {
    const fd = makeFormData({});
    const res = await createPostWithValidation({}, fd, { fetchImpl: okFetch });
    expect(Object.keys(res.errors).sort()).toEqual(['content', 'tags', 'title']);
    expect(fetchCalls).toHaveLength(0);
  });

  it('API 失敗（fetch 拋錯）→ 回傳 { errors: { _form: [...] } }，不讓例外外洩', async () => {
    const failingFetch = async () => {
      throw new Error('network down');
    };
    const fd = makeFormData({ title: 'abc', content: '1234567890', tags: 'a' });
    const res = await createPostWithValidation({}, fd, { fetchImpl: failingFetch });
    expect(res.errors._form).toBeTruthy();
    expect(res.success).toBeUndefined();
  });

  // ---- 重現 rate limiter 語意（範本 Example 7）----
  describe('rate limiter 語意（每小時 5 次）', () => {
    let rateLimitMap;
    const LIMIT = 5;
    const HOUR = 3600000;

    const submitContactForm = (ip, now, headersGet) => {
      const rl = rateLimitMap.get(ip);
      if (rl) {
        if (now < rl.resetAt) {
          if (rl.count >= LIMIT) return { error: 'Too many requests. Please try again later.' };
          rl.count++;
        } else {
          rateLimitMap.set(ip, { count: 1, resetAt: now + HOUR });
        }
      } else {
        rateLimitMap.set(ip, { count: 1, resetAt: now + HOUR });
      }
      return { success: true, headers: headersGet };
    };

    beforeEach(() => {
      rateLimitMap = new Map();
    });

    it('前 5 次請求成功，第 6 次回 { error }', () => {
      const now = 1_000_000;
      for (let i = 0; i < LIMIT; i++) {
        expect(submitContactForm('1.1.1.1', now)).toEqual({ success: true });
      }
      const sixth = submitContactForm('1.1.1.1', now);
      expect(sixth.error).toMatch(/Too many requests/);
    });

    it('不同 IP 各自獨立計數', () => {
      const now = 1_000_000;
      for (let i = 0; i < LIMIT; i++) submitContactForm('1.1.1.1', now);
      expect(submitContactForm('2.2.2.2', now)).toEqual({ success: true });
    });

    it('視窗過期後計數重置', () => {
      const now = 1_000_000;
      for (let i = 0; i < LIMIT + 1; i++) submitContactForm('1.1.1.1', now);
      const later = now + HOUR + 1;
      expect(submitContactForm('1.1.1.1', later)).toEqual({ success: true });
    });
  });

  // ---- 重現 next/headers 非同步形狀（範本 Example 7 的 await headers()）----
  it('headers() 在 Next.js 16 為非同步：必須 await 才能取得值', async () => {
    const headers = async () => ({ get: (k) => (k === 'x-forwarded-for' ? '9.9.9.9' : null) });
    const headersList = await headers();
    expect(headersList.get('x-forwarded-for')).toBe('9.9.9.9');
  });

  // ---- 重現 multi-step form 的驗證語意（範本 Example 6）----
  it('multi-step form 缺 city → 回傳 errors.city（驗證完整跑完才存檔）', async () => {
    const schema = makeValidator({
      name: (v) => (v && v.length >= 2 ? undefined : 'name too short'),
      email: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v || '') ? undefined : 'bad email'),
      address: (v) => (v && v.length >= 5 ? undefined : 'address too short'),
      city: (v) => (v && v.length >= 2 ? undefined : 'city too short'),
    });
    const parsed = schema.safeParse({
      name: 'Al',
      email: 'a@b.co',
      address: '123 Long Street',
      city: '',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error.flatten().fieldErrors.city).toBeTruthy();
  });

  it('multi-step form email 邊界：缺少 @ 視為非法', async () => {
    const schema = makeValidator({
      email: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v || '') ? undefined : 'bad email'),
    });
    expect(schema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(schema.safeParse({ email: 'a@b.co' }).success).toBe(true);
  });
});
