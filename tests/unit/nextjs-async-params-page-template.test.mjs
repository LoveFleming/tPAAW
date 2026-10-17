/**
 * Template verification test — F20261016-002 Next.js 16 非同步 Params 頁面範本
 *
 * 目標檔（唯讀 fixture，不作為一般模組 import）：
 *   data/skills/physical-skill/nextjs-backend-best-practices/templates/async-params-page.tsx
 *
 * 測試分三層（沿用同包慣例 server-actions-form-template.test.mjs /
 * nextjs-async-params-template.test.mjs，見 ADR-022）：
 *
 *   0. 檔案健全性 — 教學標頭、單一 default export 等 page.tsx 模組契約。
 *   A. 靜態契約掃描 — 斷言範本示範的行為符合 Next.js 16 契約：
 *      params/searchParams 為 Promise、必須 await、無同步存取反例；
 *      並將 QA review（TASK-045，qr-20261017-101416-tmje）確認的
 *      TASK-154 修正（fetchJson 容錯、explicit return notFound()、
 *      Array.isArray 守衛、openGraph images 條件）登錄為綠燈守門。
 *   B. 真實執行驗證 — 本檔是教學範本但結構乾淨（無指令堆疊、無重複
 *      export），與 server-actions-form.tsx 不同：它唯一的外部 runtime
 *      依賴是 next/navigation（notFound）。因此以 esbuild（repo 既有
 *      devDependency）將 TSX 轉譯為 CJS、以 Module._load stub 掉
 *      next/navigation，再用 react-dom/server（repo 既有）實際執行元件
 *      與 generateMetadata / generateStaticParams —— 這是「整合層渲染
 *      測試」：涵蓋真實 App Router 請求會走到的關鍵路徑（await
 *      params → fetch → notFound/render → metadata → static params）。
 *      專案未安裝 next（範本僅宣告為 optionalDependencies），起真實
 *      Next.js dev server 屬過重依賴，依任務指示不引入。
 *
 * 未修的 QA minor 以 it.todo 登錄（修範本是 Developer 職責，非 tester）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Module from 'node:module';
import { transformSync } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(
  __dirname,
  '../../data/skills/physical-skill/nextjs-backend-best-practices/templates/async-params-page.tsx',
);
const TEMPLATE_SRC = readFileSync(TEMPLATE_PATH, 'utf-8');

/** 去掉區塊註解與行註解，只留「活程式碼」，避免註解內容誤導掃描。 */
const CODE_ONLY = TEMPLATE_SRC.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

// ============================================================================
// B 層共用：真實轉譯 + stub 載入 + 渲染工具
// ============================================================================
const NOT_FOUND_MARKER = '__TEST_NOT_FOUND__';

/** 以 esbuild 轉譯範本並在 stub 環境下載入，回傳模組 exports。 */
function loadTemplateModule() {
  const { code } = transformSync(TEMPLATE_SRC, {
    loader: 'tsx',
    format: 'cjs',
    jsx: 'automatic',
  });

  const stubs = {
    'next/navigation': { notFound: () => NOT_FOUND_MARKER },
    next: {},
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    const m = new Module(TEMPLATE_PATH, null);
    m.filename = TEMPLATE_PATH;
    // 由範本位置逐層往上找 node_modules，讓 react/jsx-runtime 解析到 repo root
    m.paths = [];
    let dir = dirname(TEMPLATE_PATH);
    for (;;) {
      m.paths.push(join(dir, 'node_modules'));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    m._compile(code, TEMPLATE_PATH);
    return m.exports;
  } finally {
    Module._load = origLoad;
  }
}

let MOD;
const ORIGINAL_FETCH = globalThis.fetch;

/** 渲染輔助：以待給定 params/searchParams 的 Promise 呼叫頁面元件並輸出 HTML。 */
async function renderPage({ params, searchParams }) {
  const element = await MOD.default({ params, searchParams });
  return element === NOT_FOUND_MARKER ? NOT_FOUND_MARKER : renderToStaticMarkup(element);
}

/** fetch stub 工廠：記錄請求 URL，依情境回應。 */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  return calls;
}

const jsonResponse = (data) => ({ ok: true, status: 200, json: async () => data });

beforeAll(() => {
  MOD = loadTemplateModule();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ============================================================================
// 0. 檔案健全性與 page.tsx 模組契約
// ============================================================================
describe('async-params-page.tsx — 檔案健全性', () => {
  it('檔案存在且非空', () => {
    expect(TEMPLATE_SRC.length).toBeGreaterThan(0);
  });

  it('具備教學標頭，說明 Next.js 16 params/searchParams 為 async（breaking change）', () => {
    expect(TEMPLATE_SRC).toMatch(/Next\.js 16 - Async Params Page Template/);
    expect(TEMPLATE_SRC).toMatch(/BREAKING CHANGE.*params and searchParams are now async/s);
  });

  it('單一 default export（PostPage），無重複 export 名稱', () => {
    const names = [...CODE_ONLY.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)]
      .map((m) => (m[0].includes('default') ? 'default' : m[1]));
    const named = names.filter((n) => n !== 'default');
    expect(names.filter((n) => n === 'default')).toHaveLength(1);
    expect(new Set(named).size).toBe(named.length);
  });

  it('named exports 皆為 App Router page.tsx 允許的區段設定 / 慣例出口', () => {
    // page 檔只允許 default + generateMetadata/generateStaticParams/dynamic/revalidate 等
    const allowed = new Set(['generateMetadata', 'generateStaticParams', 'dynamic', 'revalidate']);
    const named = [...CODE_ONLY.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const illegal = named.filter((n) => !allowed.has(n));
    expect(illegal).toEqual([]);
  });

  it("無 'use client' / 'use server' 模組指令堆疊（純伺服器頁面檔）", () => {
    expect(CODE_ONLY).not.toMatch(/^\s*['"]use (client|server)['"]/m);
  });
});

// ============================================================================
// A. 靜態契約掃描 — Next.js 16 async params 契約
// ============================================================================
describe('A. 靜態契約掃描 — params / searchParams 必須以 Promise + await 存取', () => {
  it('props 型別宣告 params 為 Promise<{ id: string }>', () => {
    expect(CODE_ONLY).toMatch(/params:\s*Promise<\{\s*id:\s*string\s*\}>/);
  });

  it('props 型別宣告 searchParams 為 Promise<{ query?: string }>', () => {
    expect(CODE_ONLY).toMatch(/searchParams:\s*Promise<\{\s*query\?:\s*string\s*\}>/);
  });

  it('頁面元件為 async function（default export）', () => {
    expect(CODE_ONLY).toMatch(/export\s+default\s+async\s+function\s+PostPage/);
  });

  it('頁面元件內以 const { id } = await params 解構', () => {
    expect(CODE_ONLY).toMatch(/const\s*\{\s*id\s*\}\s*=\s*await\s+params/);
  });

  it('頁面元件內 await searchParams 後才解構 query', () => {
    expect(CODE_ONLY).toMatch(/const\s*\{\s*query\s*\}\s*=\s*\(await\s+searchParams\)/);
  });

  it('活程式碼無 params.<key> 同步存取反例', () => {
    expect(CODE_ONLY).not.toMatch(/\bparams\.[A-Za-z_]/);
  });

  it('活程式碼無 searchParams.<key> 同步存取反例', () => {
    expect(CODE_ONLY).not.toMatch(/\bsearchParams\.[A-Za-z_]/);
  });

  it('generateMetadata 亦為 async 並 await params', () => {
    expect(CODE_ONLY).toMatch(/export\s+async\s+function\s+generateMetadata/);
    // generateMetadata 內有自己的 await params（await 出現 ≥ 3 處：page/metadata/static 區塊之外另計）
    const awaitParamsCount = [...CODE_ONLY.matchAll(/await\s+params/g)].length;
    expect(awaitParamsCount).toBeGreaterThanOrEqual(2);
  });

  it('generateStaticParams 存在且為 async', () => {
    expect(CODE_ONLY).toMatch(/export\s+async\s+function\s+generateStaticParams/);
  });

  it('匯出區段設定 dynamic 與 revalidate', () => {
    expect(CODE_ONLY).toMatch(/export\s+const\s+dynamic/);
    expect(CODE_ONLY).toMatch(/export\s+const\s+revalidate/);
  });

  it('migration 註記涵蓋 codemod 指令（@next/codemod）', () => {
    expect(TEMPLATE_SRC).toContain('@next/codemod');
  });
});

describe('A. 靜態契約掃描 — TASK-154 容錯修正守門（QA 確認已修，須維持）', () => {
  it('共用 fetchJson<T>(url, fallback) 容錯助手：!res.ok 回 fallback、例外回 fallback', () => {
    expect(CODE_ONLY).toMatch(/async\s+function\s+fetchJson<T>\(\s*url:\s*string,\s*fallback:\s*T\s*\)/);
    expect(CODE_ONLY).toMatch(/if\s*\(!res\.ok\)\s*return\s+fallback/);
    expect(CODE_ONLY).toMatch(/catch\s*\{\s*return\s+fallback\s*\}/);
  });

  it('page 元件：notFound() 以顯式 return 呼叫（型別收斂，非依賴 never 推斷）', () => {
    expect(CODE_ONLY).toMatch(/return\s+notFound\(\)/);
  });

  it('generateStaticParams：以 Array.isArray 守衛非陣列回應，fallback 為空陣列', () => {
    expect(CODE_ONLY).toMatch(/fetchJson<Array<\{\s*id:\s*string\s*\}>>/);
    expect(CODE_ONLY).toMatch(/if\s*\(!Array\.isArray\(posts\)\)\s*\{\s*return\s*\[\]\s*\}/);
  });

  it('generateMetadata：coverImage 存在才帶入 openGraph.images（不得產出 [undefined]）', () => {
    expect(CODE_ONLY).toMatch(/images:\s*post\.coverImage\s*\?\s*\[\s*post\.coverImage\s*\]\s*:\s*undefined/);
  });

  it('三個 fetch 呼叫端（page / metadata / static params）皆走 fetchJson 助手', () => {
    const callers = [...CODE_ONLY.matchAll(/fetchJson<Post\s*\|\s*null>/g)].length;
    expect(callers).toBe(2); // page + generateMetadata
    expect(CODE_ONLY).toMatch(/fetchJson<Array</);
  });
});

// ============================================================================
// B. 真實執行驗證 — 轉譯後以 react-dom/server 渲染（整合層渲染測試）
// ============================================================================
describe('B. 頁面元件 — await Promise 後渲染正確內容', () => {
  it('正常值：params={id} + searchParams={query} → 渲染標題、內文與 Search query', async () => {
    const calls = stubFetch(() => jsonResponse({ title: 'Hello Next 16', content: 'Body text' }));
    const html = await renderPage({
      params: Promise.resolve({ id: '42' }),
      searchParams: Promise.resolve({ query: 'react' }),
    });
    expect(html).toContain('<h1>Hello Next 16</h1>');
    expect(html).toContain('<p>Body text</p>');
    expect(html).toContain('Search query: react');
    expect(calls[0].url).toBe('https://api.example.com/posts/42');
  });

  it('邊界：空 searchParams（{}）→ 不渲染 Search query 段落', async () => {
    stubFetch(() => jsonResponse({ title: 'Hello Next 16', content: 'Body text' }));
    const html = await renderPage({
      params: Promise.resolve({ id: '42' }),
      searchParams: Promise.resolve({}),
    });
    expect(html).toContain('<h1>Hello Next 16</h1>');
    expect(html).not.toContain('Search query');
  });

  it('邊界：await 後為 undefined（範本以 ?? {} 守衛）→ 正常渲染不炸', async () => {
    stubFetch(() => jsonResponse({ title: 'T', content: 'C' }));
    const html = await renderPage({
      params: Promise.resolve({ id: '1' }),
      searchParams: Promise.resolve(undefined),
    });
    expect(html).toContain('<h1>T</h1>');
    expect(html).not.toContain('Search query');
  });

  it('證明真正 await：params 為延遲 10ms 才 resolve 的 Promise → 仍取到正確 id 並渲染', async () => {
    const calls = stubFetch(() => jsonResponse({ title: 'Late', content: 'resolved-later' }));
    const lateParams = new Promise((resolve) => setTimeout(() => resolve({ id: 'late-id' }), 10));
    const html = await renderPage({ params: lateParams, searchParams: Promise.resolve({}) });
    expect(html).toContain('<h1>Late</h1>');
    expect(calls[0].url).toBe('https://api.example.com/posts/late-id');
  });

  it('query 含 HTML 特殊字元 → react 渲染自動跳脫（不以 raw HTML 注入）', async () => {
    stubFetch(() => jsonResponse({ title: 'T', content: 'C' }));
    const html = await renderPage({
      params: Promise.resolve({ id: '1' }),
      searchParams: Promise.resolve({ query: '<script>x</script> & "q"' }),
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('B. 頁面元件 — notFound 路徑（fetch 容錯的三種失敗）', () => {
  it('API 回 404（!res.ok）→ 回傳 notFound()', async () => {
    stubFetch(() => ({ ok: false, status: 404, json: async () => ({}) }));
    const out = await renderPage({
      params: Promise.resolve({ id: 'missing' }),
      searchParams: Promise.resolve({}),
    });
    expect(out).toBe(NOT_FOUND_MARKER);
  });

  it('fetch 網路例外（throw）→ 回傳 notFound() 而非讓例外外洩', async () => {
    stubFetch(() => {
      throw new Error('network down');
    });
    const out = await renderPage({
      params: Promise.resolve({ id: '1' }),
      searchParams: Promise.resolve({}),
    });
    expect(out).toBe(NOT_FOUND_MARKER);
  });

  it('回應非 JSON（json() 拋 SyntaxError，如 HTML 錯誤頁）→ 回傳 notFound()', async () => {
    stubFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('<html>'); } }));
    const out = await renderPage({
      params: Promise.resolve({ id: '1' }),
      searchParams: Promise.resolve({}),
    });
    expect(out).toBe(NOT_FOUND_MARKER);
  });
});

describe('B. generateMetadata — 非同步 metadata 契約', () => {
  it('正常值：回傳文章標題 / excerpt / openGraph，並 await params 取得 id', async () => {
    const calls = stubFetch(() => jsonResponse({ title: 'T1', excerpt: 'E1', coverImage: 'https://img/c.png' }));
    const meta = await MOD.generateMetadata({ params: Promise.resolve({ id: '9' }) });
    expect(meta.title).toBe('T1');
    expect(meta.description).toBe('E1');
    expect(meta.openGraph.images).toEqual(['https://img/c.png']);
    expect(calls[0].url).toBe('https://api.example.com/posts/9');
  });

  it('邊界：無 coverImage → openGraph.images 為 undefined（不得是 [undefined]）', async () => {
    stubFetch(() => jsonResponse({ title: 'T2', excerpt: 'E2' }));
    const meta = await MOD.generateMetadata({ params: Promise.resolve({ id: '1' }) });
    expect(meta.openGraph.images).toBeUndefined();
  });

  it('文章不存在 → 回 { title: "Post Not Found" }', async () => {
    stubFetch(() => ({ ok: false, status: 404, json: async () => ({}) }));
    const meta = await MOD.generateMetadata({ params: Promise.resolve({ id: 'x' }) });
    expect(meta).toEqual({ title: 'Post Not Found' });
  });
});

describe('B. generateStaticParams — build 期容錯（TASK-154 修正）', () => {
  it('正常值：回 [{id:"a"},{id:"b"}]', async () => {
    stubFetch(() => jsonResponse([{ id: 'a' }, { id: 'b' }]));
    expect(await MOD.generateStaticParams()).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('邊界：API 回「空陣列」→ 回 []（build 不炸）', async () => {
    stubFetch(() => jsonResponse([]));
    expect(await MOD.generateStaticParams()).toEqual([]);
  });

  it('邊界：API 回非陣列物件（bare object）→ Array.isArray 守衛回 []', async () => {
    stubFetch(() => jsonResponse({ error: true }));
    expect(await MOD.generateStaticParams()).toEqual([]);
  });

  it('fetch 失敗（網路例外）→ fallback 回 []（next build 不中止）', async () => {
    stubFetch(() => {
      throw new Error('down');
    });
    expect(await MOD.generateStaticParams()).toEqual([]);
  });
});

describe('B. 區段設定 export — dynamic / revalidate', () => {
  it("dynamic = 'force-static' 且註解標明讀 searchParams 時應改 force-dynamic", () => {
    expect(MOD.dynamic).toBe('force-static');
    expect(TEMPLATE_SRC).toMatch(/force-dynamic.*searchParams|searchParams.*force-dynamic|reading\s+searchParams/s);
  });

  it('revalidate = 3600（每小時重驗證）', () => {
    expect(MOD.revalidate).toBe(3600);
  });
});

// ============================================================================
// C. QA 未修發現 — 登錄為 todo（修範本是 Developer 職責）
// ============================================================================
describe('C. QA 未修 minor — 以 todo 追蹤（qr-20261017-101416-tmje）', () => {
  it.todo(
    "[QA minor] L153 dynamic='force-static' 與讀取 searchParams 語意張力：建議 searchParams 示範移至註解區或移除 dynamic export",
  );
  it.todo(
    '[QA minor] Migration Notes「Next.js 15 (OLD): sync」表述不精確：Promise 化自 15 生效、16 完全移除 sync 存取，建議改「≤15 legacy sync access（16 移除）」',
  );
  it.todo(
    '[QA nano] fetch 未示範 cache 選項（next: { revalidate }），可補一行對照示範「快取需 opt-in」',
  );
});
