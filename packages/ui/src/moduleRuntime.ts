/**
 * moduleRuntime.ts — 模組 UI runtime 動態 import（M3，2026-10-12）
 *
 * 目的：installed-apps/<id>/ui/pages/*.tsx 不必在 PAAW build 時編入。
 *       匯入模組後即可開頁，無需 `npm run build`。
 *
 * 機制：
 *   1. server 端用 esbuild 即時 bundle 模組頁（TSX → ESM），
 *      把 `react` / `react-dom` / `@paaw-ui/*` 標成 external，改寫成 `paaw-sdk:<spec>`。
 *   2. 本檔把每個 `paaw-sdk:<spec>` 換成一個 shim blob URL，
 *      shim 會 re-export「app 自己那份模組實例」→ React context（theme/i18n）單一實例，
 *      不會出現兩份 React / 兩份 theme context。
 *   3. 把改寫後的 JS 包成 Blob URL 動態 import → 取得 default export 元件。
 *
 * 注意：樣式（Tailwind class）仍由 PAAW build 時掃描 installed-apps/** 產生
 *       （tailwind content 已含 ../../installed-apps/**）。全新模組的新 class
 *       需 rebuild 才有 CSS；既有模組（class 已掃過）不受影響。
 */
import API_BASE from "./api";

/** bare specifier → app 的實例 */
const BARE: Record<string, () => Promise<any>> = {
  "react": () => import("react"),
  "react/jsx-runtime": () => import("react/jsx-runtime"),
  "react-dom": () => import("react-dom"),
  "react-dom/client": () => import("react-dom/client"),
};

/** app 自己的 src/** 模組（對應 vite alias @paaw-ui → src） */
const APP_GLOB = import.meta.glob("./**/*.{ts,tsx}");

function appLoader(spec: string): (() => Promise<any>) | null {
  const rel = "./" + spec.slice("@paaw-ui/".length);
  const cands = [rel, `${rel}.ts`, `${rel}.tsx`, `${rel}/index.ts`, `${rel}/index.tsx`];
  for (const c of cands) if (APP_GLOB[c]) return APP_GLOB[c] as () => Promise<any>;
  return null;
}

const VALID_IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * Shim blob URL 的快取。key 為 SDK specifier。
 * 注意：只快取「成功」的 Promise — 失敗的 Promise 一律從快取移除，
 * 否則同一個 spec 會在整個 session 內永久失敗（見 B2）。
 * shim 內容僅是值快照（非 ESM live binding），對共享模組（fn/const）已足夠。
 */
const shimCache = new Map<string, Promise<string>>();

/** 取得某個 SDK specifier 的 shim blob URL（成功才快取，失敗自清） */
function shimUrl(spec: string): Promise<string> {
  const hit = shimCache.get(spec);
  if (hit) return hit;
  const p = (async () => {
    let mod: any;
    if (BARE[spec]) mod = await BARE[spec]();
    else if (spec.startsWith("@paaw-ui/")) {
      const loader = appLoader(spec);
      if (!loader) throw new Error(`模組 SDK 找不到：${spec}`);
      mod = await loader();
    } else throw new Error(`未知的 SDK specifier：${spec}`);

    const w = window as any;
    w.__PAAW_SDK__ = w.__PAAW_SDK__ || {};
    w.__PAAW_SDK__[spec] = mod;

    const names = Object.keys(mod).filter(n => n !== "default" && VALID_IDENT.test(n));
    const src =
      `const M = window.__PAAW_SDK__[${JSON.stringify(spec)}];\n` +
      `export default (M && "default" in M && M.default !== undefined) ? M.default : M;\n` +
      names.map(n => `export const ${n} = M[${JSON.stringify(n)}];\n`).join("");
    return URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  })();
  // 失敗必須自清快取，否則 rejected Promise 會永久殘留（B2）。
  const guarded = p.catch((e) => { shimCache.delete(spec); throw e; });
  shimCache.set(spec, guarded);
  return guarded;
}

function injectModuleCss(moduleId: string, page: string, css: string) {
  const id = `paaw-modcss-${moduleId}-${page}`;
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/** blob URL fetch timeout（ms）— 避免 server 502/hang 時永遠停在載入中（B3/M4）。 */
const FETCH_TIMEOUT_MS = 15000;

const pageCache = new Map<string, Promise<any>>();

/**
 * 清除模組頁快取（含指定 moduleId 的所有 page）。
 * 供 dev 免 rebuild 編輯迴圈使用：模組頁改動後重開即拿新元件（M1）。
 * 等同 server 端 esbuild 的 mtime 快取語意；不帶參數則清全部。
 */
export function invalidateModulePage(moduleId?: string) {
  if (!moduleId) { pageCache.clear(); return; }
  const prefix = `${moduleId}:`;
  for (const k of pageCache.keys()) if (k.startsWith(prefix)) pageCache.delete(k);
}

/** 動態載入模組頁元件（moduleId + page 名）。回傳 default export 元件。 */
export function loadModulePage(moduleId: string, page: string): Promise<any> {
  const key = `${moduleId}:${page}`;
  const hit = pageCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE}/api/apps/modules/${encodeURIComponent(moduleId)}/ui-bundle.js?page=${encodeURIComponent(page)}`,
        { signal: ctrl.signal },
      );
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error(`模組 UI bundle 逾時（${FETCH_TIMEOUT_MS}ms）`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`模組 UI bundle 失敗（HTTP ${res.status}）`);
    let data: any;
    try {
      data = await res.json();
    } catch {
      // server 500/502 回 HTML 或空 body → res.json() 會丟 SyntaxError（B3）
      throw new Error(`模組 UI bundle 回應非 JSON（HTTP ${res.status}）`);
    }
    if (!data?.ok) throw new Error(data?.error || "模組 UI bundle 失敗");
    let js: string = data.js || "";
    const specs: string[] = (data.specifiers || []).slice().sort((a: string, b: string) => b.length - a.length);
    for (const s of specs) {
      const u = await shimUrl(s);
      js = js.split(`paaw-sdk:${s}`).join(u);
    }
    if (data.css) injectModuleCss(moduleId, page, data.css);
    const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (!mod.default) throw new Error("模組頁沒有 default export");
      return mod.default;
    } finally {
      URL.revokeObjectURL(url);
    }
  })().catch(e => { pageCache.delete(key); throw e; });
  pageCache.set(key, p);
  return p;
}
