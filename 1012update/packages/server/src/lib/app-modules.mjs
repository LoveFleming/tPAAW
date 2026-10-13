/**
 * app-modules.mjs — App Module Registry（M1 核心，2026-10-03）
 *
 * PAAW 可組裝底座：persona app（learning / 秘書 / PM ...）以模組掛載。
 *
 * 模組目錄（code，可 zip 出貨）：
 *   installed-apps/<id>/
 *   ├── manifest.json   { id, name, version, nav:{label,emoji,page}, server:{entry}, enabled }
 *   ├── server/entry.mjs   default export (req,res)=>boolean，掛在 /api/<moduleId>/ 命名空間（模組 route 自帶完整 path match）
 *   └── ui/pages/*.tsx     頁面（vite alias @apps/<id>/ui/pages/*；build 時編入）
 *
 * 資料目錄（不隨出貨）：
 *   data/installed-apps/<id>/   — 模組自己的 db/檔案（PAAW_ROOT shim 指這裡）
 *
 * 鐵律：模組挂載失敗大聲報（沿 2026-09-06 route 載入教訓），不得靜默跳過。
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, renameSync } from "fs";
import { join, resolve, dirname, sep } from "path";
import AdmZip from "adm-zip";

import { PAAW_ROOT } from "../routes/shared.mjs"; // 走本體同一顆 root（2026-10-03 教訓：自己算層數少爬一層=模組全部隱形）
const MODULES_DIR = join(PAAW_ROOT, "installed-apps");
export const MODULE_DATA_ROOT = (id) => join(PAAW_ROOT, "data", "installed-apps", id);

/** 列出所有模組（讀 manifest；壞的標 error 不炸全域） */
export function listAppModules() {
  if (!existsSync(MODULES_DIR)) return [];
  const out = [];
  for (const name of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const mf = join(MODULES_DIR, name.name, "manifest.json");
    if (!existsSync(mf)) continue;
    try {
      const m = JSON.parse(readFileSync(mf, "utf8"));
      out.push({
        id: m.id || name.name,
        name: m.name || name.name,
        version: m.version || "0.0.0",
        nav: m.nav || null,               // { label, emoji, page }
        serverEntry: m.server?.entry || "server/entry.mjs",
        enabled: m.enabled !== false,
        dataDir: MODULE_DATA_ROOT(m.id || name.name),
        dir: join(MODULES_DIR, name.name),
      });
    } catch (e) {
      out.push({ id: name.name, name: name.name, error: `manifest 解析失敗：${e.message}`, enabled: false });
    }
  }
  return out;
}

/** 載入啟用中模組的 server handlers（啟動時呼叫一次；失敗大聲報） */
export async function loadAppModuleRoutes() {
  const handlers = [];
  for (const m of listAppModules()) {
    if (!m.enabled || m.error || !m.serverEntry) continue;
    const entry = join(m.dir, m.serverEntry);
    try {
      const mod = await import(entry);
      if (typeof mod.default !== "function") throw new Error("entry.mjs 沒有 default export (req,res)=>boolean");
      handlers.push({ id: m.id, name: m.name, handler: mod.default });
      console.log(`[AppModule] ✅ ${m.id} v${m.version} 已掛載（${m.name}）`);
    } catch (e) {
      console.error(`[AppModule] ❌ ${m.id} 掛載失敗：${e.message}`);  // nosemgrep: unsafe-formatstring
    }
  }
  return handlers;
}

/** S5：scaffold 新模組骨架（Module Manager / EM 指令用） */
export function scaffoldAppModule({ id, name, emoji }) {
  if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) return { ok: false, error: "id 必須小寫字母開頭、只含 a-z0-9-" };
  const dir = join(MODULES_DIR, id);
  if (existsSync(dir)) return { ok: false, error: `installed-apps/${id} 已存在` };
  mkdirSync(join(dir, "server"), { recursive: true });
  mkdirSync(join(dir, "ui", "pages"), { recursive: true });
  mkdirSync(MODULE_DATA_ROOT(id), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    id, name: name || id, version: "0.1.0", enabled: true,
    nav: { label: name || id, emoji: emoji || "📦", page: "Main" },
    server: { entry: "server/entry.mjs" },
  }, null, 2));
  writeFileSync(join(dir, "server", "entry.mjs"),
`/**
 * ${id} module — server entry（scaffold 產生）
 * route 檔放同目錄 routes/，這裡依序 try；path 建議統一 /api/${id}/... 前綴
 */
export default async function handler(req, res) {
  // const r1 = (await import("./routes/example.mjs")).default;
  // if (await r1(req, res)) return true;
  return false;
}
`);
  writeFileSync(join(dir, "ui", "pages", "Main.tsx"),
`export default function Main() {
  return <div style={{ padding: 24 }}>📦 ${(name || id)} module — scaffold 完成，把這頁換成真的。</div>;
}
`);
  return { ok: true, dir, dataDir: MODULE_DATA_ROOT(id) };
}

/** M2：匯出模組為 zip（頂層目錄 = <id>/，解開即 installed-apps/<id>/；不含 data） */
export function exportAppModule(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(id || "")) return { ok: false, error: "模組 id 不合法" };
  const dir = join(MODULES_DIR, id);
  if (!existsSync(dir)) return { ok: false, error: `installed-apps/${id} 不存在` };
  let version = "0.0.0";
  try { version = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).version || "0.0.0"; } catch {}
  try {
    const zip = new AdmZip();
    zip.addLocalFolder(dir, id);
    return { ok: true, buffer: zip.toBuffer(), filename: `${id}-${version}.zip` };
  } catch (e) {
    return { ok: false, error: `打包失敗：${e.message}` };
  }
}

/** M2：匯入模組 zip（buffer）→ installed-apps/<id>/；已存在則拒絕；逐檔 resolve 邊界檢查防 zip-slip */
export function importAppModule(buffer) {
  if (!buffer || !buffer.length) return { ok: false, error: "空檔案" };
  let zip;
  try { zip = new AdmZip(buffer); } catch (e) { return { ok: false, error: `不是有效的 zip：${e.message}` }; }
  const rels = [];
  for (const entry of zip.getEntries()) {
    const n = entry.entryName.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!n || n === "/") continue;
    if (n.startsWith("__MACOSX/") || n.endsWith(".DS_Store")) continue;
    if (n.startsWith("/") || /^[a-zA-Z]:/.test(n) || n.split("/").includes("..")) {
      return { ok: false, error: `不安全的 zip 路徑：${entry.entryName}` };
    }
    rels.push({ entry, rel: n });
  }
  if (!rels.length) return { ok: false, error: "zip 內沒有檔案" };
  // 決定 id：優先 <top>/manifest.json；否則讀頂層 manifest.json 的 id
  const tops = [...new Set(rels.map(r => r.rel.split("/")[0]))];
  let id, prefix = "";
  if (tops.length === 1 && rels.some(r => r.rel === `${tops[0]}/manifest.json`)) {
    id = tops[0]; prefix = `${id}/`;
  } else {
    const mf = rels.find(r => r.rel === "manifest.json");
    if (!mf) return { ok: false, error: "zip 內找不到 manifest.json（需在頂層或 <id>/manifest.json）" };
    try { id = JSON.parse(mf.entry.getData().toString("utf8")).id; } catch (e) { return { ok: false, error: `manifest.json 解析失敗：${e.message}` }; }
  }
  if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) return { ok: false, error: `模組 id 不合法：${id}` };
  const dir = join(MODULES_DIR, id);
  if (existsSync(dir)) return { ok: false, error: `installed-apps/${id} 已存在（請先移除再匯入）` };
  try {
    mkdirSync(dir, { recursive: true });
    for (const { entry, rel } of rels) {
      const sub = prefix && rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
      if (!sub) continue;
      const target = resolve(dir, sub);
      if (target !== dir && !target.startsWith(dir + sep)) throw new Error(`路徑逃逸：${rel}`);
      if (entry.isDirectory) { mkdirSync(target, { recursive: true }); continue; }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.getData());
    }
  } catch (e) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: `解壓失敗：${e.message}` };
  }
  const mf = join(dir, "manifest.json");
  if (!existsSync(mf)) { try { rmSync(dir, { recursive: true, force: true }); } catch {} return { ok: false, error: "解壓後找不到 manifest.json" }; }
  let man; try { man = JSON.parse(readFileSync(mf, "utf8")); } catch (e) { return { ok: false, error: `manifest.json 解析失敗：${e.message}` }; }
  if (man.id && man.id !== id) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: `manifest.id(${man.id}) 與 zip 目錄(${id}) 不符` };
  }
  return { ok: true, id, name: man.name || id, version: man.version || "0.0.0", nav: man.nav || null, buildRequired: true, restartRequired: true };
}

/** M2：移除模組（code）— 移到 installed-apps/.removed/（可還原；不動 data/installed-apps/<id>） */
export function removeAppModule(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(id || "")) return { ok: false, error: "模組 id 不合法" };
  const dir = join(MODULES_DIR, id);
  if (!existsSync(dir)) return { ok: false, error: `installed-apps/${id} 不存在` };
  try {
    const bin = join(MODULES_DIR, ".removed");
    mkdirSync(bin, { recursive: true });
    const dest = join(bin, `${id}-${Date.now()}`);
    renameSync(dir, dest);
    return { ok: true, id, movedTo: dest, dataKept: MODULE_DATA_ROOT(id) };
  } catch (e) {
    return { ok: false, error: `移除失敗：${e.message}` };
  }
}

/** S5：manifest patch（enable/disable / 改 nav） */
export function patchAppModule(id, patch = {}) {
  const mf = join(MODULES_DIR, id, "manifest.json");
  if (!existsSync(mf)) return { ok: false, error: `module ${id} 不存在` };
  const m = JSON.parse(readFileSync(mf, "utf8"));
  for (const k of ["name", "version", "enabled"]) if (k in patch) m[k] = patch[k];
  if (patch.nav) m.nav = { ...(m.nav || {}), ...patch.nav };
  writeFileSync(mf, JSON.stringify(m, null, 2));
  return { ok: true, module: m };
}
