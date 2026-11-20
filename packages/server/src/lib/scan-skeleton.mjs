/**
 * CU scan 決定論骨架（2026-11-20 Fleming：scan step 拆機械/智慧兩層）
 *
 * 機械層（本檔，純程式免 token）：projectName / projectType / language / framework / runtime /
 *   entryPoints / keyDirectories — 這些從 package.json + 檔案樹就能確定，LLM 不許發明。
 * 智慧層（scan-project.md prompt）：summary / modules 語意 / techDebt / healthGaps。
 *
 * 用法（routes/coding.mjs scan step）：
 *   1. prompt 注入 skeleton（LLM 必須照抄這些欄位）
 *   2. LLM 輸出存 scan.json 後，用 enforceScanSkeleton() 把機械欄位強制覆寫回程式版（防幻覺）
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { walkSourceFiles } from "./cu-source-scan.mjs";

const FRAMEWORK_HINTS = [
  { fw: "React", dep: "react" }, { fw: "Vue", dep: "vue" }, { fw: "Svelte", dep: "svelte" },
  { fw: "Next.js", dep: "next" }, { fw: "Nuxt", dep: "nuxt" }, { fw: "Angular", dep: "@angular/core" },
  { fw: "Express", dep: "express" }, { fw: "Fastify", dep: "fastify" }, { fw: "Koa", dep: "koa" },
  { fw: "Vite", dep: "vite" }, { fw: "Electron", dep: "electron" }, { fw: "NestJS", dep: "@nestjs/core" },
];

/** 純程式解析專案骨架 — 不 call LLM、秒級 */
export function buildScanSkeleton(root) {
  const skeleton = {
    projectName: null, projectType: "other", language: null, framework: null,
    runtime: null, entryPoints: [], keyDirectories: { source: null, tests: null, config: null, docs: null },
    _meta: { sourceFileCount: 0, topDirs: [] },
  };
  try {
    const pkgPath = join(root, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      skeleton.projectName = pkg.name || null;
      skeleton.runtime = "Node.js";
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const fws = FRAMEWORK_HINTS.filter(h => deps[h.dep]).map(h => h.fw);
      if (fws.length) skeleton.framework = fws.join(" + ");
      else {
        // monorepo：framework 常在子包 — 掃 packages/*/+package.json 的 deps
        try {
          const rd = readdirSync;
          for (const sub of rd(join(root, "packages"))) {
            const subPkgPath = join(root, "packages", sub, "package.json");
            if (!existsSync(subPkgPath)) continue;
            const subPkg = JSON.parse(readFileSync(subPkgPath, "utf-8"));
            const subDeps = { ...(subPkg.dependencies || {}), ...(subPkg.devDependencies || {}) };
            for (const h of FRAMEWORK_HINTS.filter(x => subDeps[x.dep])) {
              if (!fws.includes(h.fw)) fws.push(h.fw);
            }
          }
          if (fws.length) skeleton.framework = fws.join(" + ");
        } catch {}
      }
      // entryPoints：main > bin > scripts.start 解析
      const eps = [];
      if (typeof pkg.main === "string" && pkg.main) eps.push(pkg.main);
      if (pkg.bin) {
        for (const b of Object.values(pkg.bin)) eps.push(typeof b === "string" ? b : b && b.main).filter(Boolean);
      }
      if (pkg.scripts && typeof pkg.scripts.start === "string") {
        const m = pkg.scripts.start.match(/(\S+\.(?:mjs|js|cjs|ts))\b/);
        if (m) eps.push(m[1]);
      }
      for (const ep of eps) {
        if (!skeleton.entryPoints.includes(ep) && existsSync(join(root, ep))) skeleton.entryPoints.push(ep);
      }
      if (pkg.workspaces || existsSync(join(root, "pnpm-workspace.yaml"))) skeleton.projectType = "monorepo";
    }
  } catch {}
  // 語言 + 目錄偵測（walker 同一套 source 規則）
  try {
    const { files } = walkSourceFiles(root, { maxFiles: 5000 });
    skeleton._meta.sourceFileCount = files.length;
    const extCount = {};
    const dirCount = {};
    for (const f of files) {
      const p = f.replace(/\\/g, "/");
      const name = p.slice(p.lastIndexOf("/") + 1);
      const dot = name.lastIndexOf(".");
      if (dot > 0) {
        const ext = name.slice(dot).toLowerCase();
        extCount[ext] = (extCount[ext] || 0) + 1;
      }
      const dir = p.includes("/") ? p.slice(0, p.indexOf("/")) : ".";
      dirCount[dir] = (dirCount[dir] || 0) + 1;
    }
    const topExt = Object.entries(extCount).sort((a, b) => b[1] - a[1])[0];
    if (topExt) {
      skeleton.language = topExt[0] === ".tsx" || topExt[0] === ".ts" ? "TypeScript" :
        topExt[0] === ".jsx" || topExt[0] === ".js" || topExt[0] === ".mjs" || topExt[0] === ".cjs" ? "JavaScript" :
        topExt[0].replace(".", "").toUpperCase();
    }
    skeleton._meta.topDirs = Object.entries(dirCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d, n]) => `${d}/ (${n})`);
    // keyDirectories 慣例偵測
    const has = (d) => existsSync(join(root, d));
    const sourceCandidates = ["src", "lib", "app", "packages", "source"].filter(has);
    const testCandidates = ["test", "tests", "__tests__", "spec"].filter(has);
    const docsCandidates = ["docs", "doc", "documentation"].filter(has);
    if (sourceCandidates.length) skeleton.keyDirectories.source = sourceCandidates[0];
    if (testCandidates.length) skeleton.keyDirectories.tests = testCandidates[0];
    if (docsCandidates.length) skeleton.keyDirectories.docs = docsCandidates[0];
    const configFiles = ["package.json", "tsconfig.json", "vite.config.ts", "vite.config.mjs", "webpack.config.js", ".eslintrc.json", "eslint.config.mjs"].filter(f => existsSync(join(root, f)));
    if (configFiles.length) skeleton.keyDirectories.config = "(root)";
    // projectType 補判（非 monorepo 時）
    if (skeleton.projectType === "other") {
      const hasServer = /express|fastify|koa|@nestjs/i.test(skeleton.framework || "");
      const hasUi = /react|vue|svelte|angular/i.test(skeleton.framework || "");
      skeleton.projectType = hasServer && hasUi ? "web-app" : hasServer ? "api-server" : hasUi ? "web-app" : "library";
    }
  } catch {}
  if (!skeleton.projectName) {
    // fallback: root 目錄名
    try { skeleton.projectName = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null; } catch {}
  }
  return skeleton;
}

/** 把骨架寫入 .paaw/scan-skeleton.json（機械層 step + 重掃用） */
export function serializeSkeleton(skeleton) {
  return JSON.stringify(skeleton, null, 2);
}

/** 讀回已存的骨架（scan LLM step 用 — 單一事實來源：檔案版優先，不存在回 null） */
export function loadScanSkeleton(paawReadJson) {
  try {
    const raw = paawReadJson("scan-skeleton.json");
    return raw && typeof raw === "object" ? raw : null;
  } catch { return null; }
}
/** 把骨架的機械欄位強制覆寫回 scan.json（LLM 只保留語意欄位） */
export function enforceScanSkeleton(scanJson, skeleton) {
  if (!scanJson || typeof scanJson !== "object") return scanJson;
  const out = { ...scanJson };
  out.projectName = skeleton.projectName || out.projectName;
  out.projectType = skeleton.projectType || out.projectType;
  out.language = skeleton.language || out.language;
  out.framework = skeleton.framework || out.framework;
  out.runtime = skeleton.runtime || out.runtime;
  if (Array.isArray(skeleton.entryPoints) && skeleton.entryPoints.length) out.entryPoints = skeleton.entryPoints;
  out.keyDirectories = { ...(out.keyDirectories || {}), ...skeleton.keyDirectories };
  return out;
}
