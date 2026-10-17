/**
 * module-ui-bundle.mjs — 模組 UI runtime bundle（M3，2026-10-12）
 *
 * 目的：讓 installed-apps/<id>/ui/pages/*.tsx 不必在 PAAW build（vite）時編入，
 *       匯入模組後即可用，無需 `npm run build`。
 *
 * 作法：用 esbuild 即時把模組頁 bundle 成 ESM。
 *   - react / react-dom / @paaw-ui/* → external，改寫成 `paaw-sdk:<spec>`，
 *     由前端換成指向 app 自身模組實例的 shim → 保證單一 React / 單一 theme context。
 *   - 其餘（模組自己的相對 import、highlight.js...）一律 bundle 進去。
 *   - .css 抽成獨立輸出，前端注入 <style>。
 *
 * 依賴：esbuild（root dependencies）。
 */
import { existsSync, statSync } from "fs";
import { join } from "path";
import { PAAW_ROOT } from "../routes/shared.mjs";

const MODULES_DIR = join(PAAW_ROOT, "installed-apps");

let _esbuild = null;
async function getEsbuild() {
  if (!_esbuild) _esbuild = import("esbuild").then(m => m.default || m);
  return _esbuild;
}

const EXTERNALS = [
  { filter: /^react$|^react\/.+$|^react-dom$|^react-dom\/.+$/, prefix: "" },
  { filter: /^@paaw-ui\/.+$/, prefix: "" },
];
const paawSdkPlugin = {
  name: "paaw-sdk-externals",
  setup(build) {
    for (const e of EXTERNALS) {
      build.onResolve({ filter: e.filter }, (a) => ({ path: "paaw-sdk:" + a.path, external: true }));
    }
  },
};

const PAAGE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const ID_RE = /^[a-z][a-z0-9-]*$/;

const cache = new Map(); // `${id}:${page}` -> { mtime, result }

export async function bundleModuleUi(id, page) {
  if (!ID_RE.test(id || "")) return { ok: false, error: "模組 id 不合法" };
  if (!PAAGE_RE.test(page || "")) return { ok: false, error: "page 名稱不合法" };
  const entry = join(MODULES_DIR, id, "ui", "pages", `${page}.tsx`);
  if (!existsSync(entry)) return { ok: false, error: `找不到 ${id}/ui/pages/${page}.tsx` };

  const mtime = statSync(entry).mtimeMs;
  const key = `${id}:${page}`;
  const hit = cache.get(key);
  if (hit && hit.mtime === mtime) return hit.result;

  let result;
  try {
    const esbuild = await getEsbuild();
    const out = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      outdir: ".", // 僅作為輸出檔名標籤（write:false，完全不寫檔；非真實寫入路徑）
      format: "esm",
      target: ["es2020"],
      jsx: "automatic",
      loader: {
        ".css": "css",
        ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl",
        ".svg": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl",
      },
      plugins: [paawSdkPlugin],
      logLevel: "silent",
      absWorkingDir: PAAW_ROOT,
    });
    let js = "", css = "";
    for (const f of out.outputFiles) {
      if (f.path.endsWith(".css")) css += f.text;
      else js += f.text;
    }
    const specifiers = [...new Set([...js.matchAll(/paaw-sdk:([^"'\s`]+)/g)].map(m => m[1]))];
    result = { ok: true, js, css, specifiers };
  } catch (e) {
    const msg = (e && (e.message || (e.errors || []).map(x => x.text).join("; "))) || String(e);
    result = { ok: false, error: `bundle 失敗：${msg}` };  // nosemgrep: unsafe-formatstring
  }
  cache.set(key, { mtime, result });
  return result;
}

/** 匯入/移除模組後清掉該模組的 bundle 快取 */
export function invalidateModuleUiBundle(id) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${id}:`)) cache.delete(k);
}
