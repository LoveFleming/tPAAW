/**
 * release-unit/adapters.mjs — Language Adapter 層
 *
 * Release Unit Tool 化的語言抽象：每個 adapter 提供
 *   detect(root)          — 偵測專案是否為此語言/技術棧
 *   sourceExts            — 要掃的副檔名
 *   importRegexes         — 此語言的 import 語法（供依賴圖掃描）
 *   commentStrip(content) — 移除註解，避免掃到註解裡的 import
 *   verifyCommands(root)  — build / lint / test / type-check 對應指令
 *
 * 跨平台鐵律：這裡不 spawn find/ls，一切用 Node fs（Windows 相容）。
 */

import { readFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ── 共用：讀 package.json ──
async function readJsonSafe(file) {
  try { return JSON.parse(readFileSync(file, "utf-8")); } catch { return null; }
}

/** 解析 tsconfig/jsconfig 的 compilerOptions.paths（簡易版：支援 alias 前綴 + 一個 *） */
export function parsePathAliases(root) {
  for (const cfgName of ["tsconfig.json", "jsconfig.json", "tsconfig.app.json"]) {
    const cfgPath = join(root, cfgName);
    if (!existsSync(cfgPath)) continue;
    try {
      let text = readFileSync(cfgPath, "utf-8");
      // JSONC：去註解與 trailing comma
      text = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const cfg = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
      const paths = cfg?.compilerOptions?.paths || {};
      const baseUrl = cfg?.compilerOptions?.baseUrl || ".";
      const aliases = [];
      for (const [pattern, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets) || targets.length === 0) continue;
        aliases.push({
          // "@/*" → prefix "@"，isWildcard
          prefix: pattern.replace(/\/\*$/, ""),
          isWildcard: pattern.endsWith("*"),
          target: targets[0].replace(/^\.\//, "").replace(/\/\*$/, ""),
          baseUrl,
        });
      }
      if (aliases.length) return { configName: cfgName, aliases };
    } catch {}
  }
  return { configName: null, aliases: [] };
}

// ── JS / TS adapter ──
export const jsTsAdapter = {
  id: "js-ts",
  label: "JavaScript / TypeScript",
  async detect(root) {
    const pkg = await readJsonSafe(join(root, "package.json"));
    return !!pkg || existsSync(join(root, "tsconfig.json"));
  },
  sourceExts: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  importRegexes: [
    // ESM: import x from '...'; import '...'; export * from '...'; export {a} from '...'
    /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]{0,200}?from\s+)?["']([^"']+)["']/g,
    // CJS: const x = require('...')  /  require('...')
    /(?:^|\n)\s*(?:const|let|var)\s+[\w${},\s]+=\s*require\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*require\(\s*["']([^"']+)["']\s*\)/g,
    // Dynamic: import('...') / require.resolve('...')
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ],
  stripComments(content) {
    // 保守 strip：行註解 + 區塊註解（不處理字串中的 //，誤差可接受——regex 只認行首縮排的 import）
    return content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/[^\n]*/g, "$1");
  },
  async verifyCommands(root) {
    const pkg = await readJsonSafe(join(root, "package.json"));
    const scripts = pkg?.scripts || {};
    const cmds = {};
    const pm = existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm"
      : existsSync(join(root, "yarn.lock")) ? "yarn"
      : "npm";
    if (scripts.build) cmds.build = `${pm} run build`;
    if (scripts.lint) cmds.lint = `${pm} run lint`;
    if (scripts.test) cmds.test = `${pm} test`;
    if (scripts["type-check"] || scripts.typecheck || scripts.tsc) {
      cmds["type-check"] = `${pm} run ${scripts["type-check"] ? "type-check" : scripts.typecheck ? "typecheck" : "tsc"}`;
    } else if (existsSync(join(root, "tsconfig.json"))) {
      cmds["type-check"] = "npx tsc --noEmit";
    }
    return cmds;
  },
};

// ── Python adapter ──
export const pythonAdapter = {
  id: "python",
  label: "Python",
  async detect(root) {
    return existsSync(join(root, "pyproject.toml"))
      || existsSync(join(root, "requirements.txt"))
      || existsSync(join(root, "setup.py"));
  },
  sourceExts: [".py"],
  // from x.y import z / import x.y
  importRegexes: [
    /(?:^|\n)\s*from\s+([.\w]+)\s+import\s+/g,
    /(?:^|\n)\s*import\s+([.\w]+(?:\s*,\s*[.\w]+)*)/g,
  ],
  stripComments(content) {
    return content.replace(/(^|\s)#[^\n]*/g, "$1");
  },
  async verifyCommands(root) {
    const cmds = {};
    const pyproject = existsSync(join(root, "pyproject.toml"));
    const reqs = await readJsonSafe(join(root, "requirements.txt")); // 不會是 JSON，只是嘗試讀
    // pytest
    if (existsSync(join(root, "tests")) || pyproject || reqs) cmds.test = "python -m pytest";
    // ruff（有 pyproject 就假設可用）
    if (pyproject) cmds.lint = "python -m ruff check .";
    return cmds;
  },
};

// ── Go adapter ──
export const goAdapter = {
  id: "go",
  label: "Go",
  async detect(root) {
    return existsSync(join(root, "go.mod"));
  },
  sourceExts: [".go"],
  importRegexes: [
    /(?:^|\n)\s*(?:_\s*)?"([\w./\-@]+)"/g, // import "..." / import block 內的 "..."
  ],
  stripComments(content) {
    return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  },
  async verifyCommands() {
    return {
      build: "go build ./...",
      lint: "go vet ./...",
      test: "go test ./...",
      "type-check": "go build ./...", // Go build 即型別檢查
    };
  },
};

// ── Rust adapter ──
export const rustAdapter = {
  id: "rust",
  label: "Rust",
  async detect(root) {
    return existsSync(join(root, "Cargo.toml"));
  },
  sourceExts: [".rs"],
  // use std::collections::HashMap; / pub use crate::util::helper; / extern crate foo;
  importRegexes: [
    /(?:^|\n)\s*(?:pub\s+)?use\s+([\w:]+)/g,
    /(?:^|\n)\s*extern\s+crate\s+(\w+)/g,
  ],
  stripComments(content) {
    return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  },
  async verifyCommands() {
    return {
      build: "cargo build",
      test: "cargo test",
      "type-check": "cargo check", // rustc 前置檢查即型別檢查（比 build 快）
    };
  },
};

// ── Java adapter（Quarkus / Maven）──
export const javaAdapter = {
  id: "java",
  label: "Java (Quarkus / Maven)",
  async detect(root) {
    const pom = join(root, "pom.xml");
    if (!existsSync(pom)) return false;
    try {
      const text = readFileSync(pom, "utf-8");
      // Quarkus 專案：pom 內含 io.quarkus groupId 或 quarkus-maven-plugin
      if (text.includes("io.quarkus") || text.includes("quarkus-maven-plugin")) return true;
    } catch {}
    // 一般 Maven 專案：pom + src/main/java
    return existsSync(join(root, "src", "main", "java"));
  },
  sourceExts: [".java"],
  // import java.util.List; / import static x.y.Z.member;（static 捕捉到 class 段，剝成員名）
  importRegexes: [
    /(?:^|\n)\s*import\s+static\s+([\w.]+)\.[\w]+\s*;/g,
    /(?:^|\n)\s*import\s+(?!static\b)([\w.]+)\s*;/g,
  ],
  stripComments(content) {
    return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  },
  async verifyCommands(root) {
    // 跨平台：有 wrapper 用 wrapper（win32 = mvnw.cmd），否則系統 mvn
    const hasWrapper = existsSync(join(root, "mvnw")) || existsSync(join(root, "mvnw.cmd"));
    const mvn = hasWrapper ? (process.platform === "win32" ? "mvnw.cmd" : "./mvnw") : "mvn";
    return {
      build: `${mvn} package -DskipTests -q`,
      test: `${mvn} test`,
      "type-check": `${mvn} compile -q`, // javac 編譯即型別檢查
    };
  },
};

// ── Generic fallback（其他語言：regex 掃 import，無 verify 指令推斷）──
export const genericAdapter = {
  id: "generic",
  label: "Generic",
  async detect() { return true; }, // 永遠 fallback 成立
  sourceExts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".rb", ".php", ".rs", ".kt", ".cs", ".swift"],
  importRegexes: [
    /(?:^|\n)\s*import\s+(?:[\w.]*\s+from\s+)?["']([^"']+)["']/g,
    /(?:^|\n)\s*(?:const|let|var)\s+[\w${},\s]+=\s*require\(\s*["']([^"']+)["']\s*\)/g,
  ],
  stripComments(content) {
    return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)(\/\/|#)[^\n]*/g, "$1");
  },
  async verifyCommands() { return {}; },
};

// ── Registry ──
const ADAPTERS = [jsTsAdapter, pythonAdapter, goAdapter, rustAdapter, javaAdapter, genericAdapter];

/** 偵測專案語言 → 回傳第一個 detect 通過的 adapter（generic 兜底） */
export async function detectAdapter(root) {
  for (const a of ADAPTERS) {
    try { if (await a.detect(root)) return a; } catch {}
  }
  return genericAdapter;
}

/** 讀 package.json（沒有回 null） */
export { readJsonSafe };

/** 掃 tech stack 摘要（給 overview / context 用） */
export async function detectTechStack(root) {
  const adapter = await detectAdapter(root);
  const pkg = await readJsonSafe(join(root, "package.json"));
  const frameworks = [];
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const CHECKS = [
      ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["next", "Next.js"], ["nuxt", "Nuxt"],
      ["express", "Express"], ["fastify", "Fastify"], ["koa", "Koa"], ["@nestjs/core", "NestJS"],
      ["vite", "Vite"], ["webpack", "Webpack"], ["vitest", "Vitest"], ["jest", "Jest"], ["playwright", "Playwright"],
      ["electron", "Electron"], ["typescript", "TypeScript"], ["tailwindcss", "Tailwind CSS"],
      ["django", "Django"], ["fastapi", "FastAPI"], ["flask", "Flask"],
    ];
    for (const [dep, label] of CHECKS) if (deps?.[dep]) frameworks.push(label);
  }
  let pm = null;
  if (existsSync(join(root, "package.json"))) {
    pm = existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm"
      : existsSync(join(root, "yarn.lock")) ? "yarn" : "npm";
  }
  return {
    adapter: adapter.id,
    language: adapter.label,
    packageManager: pm,
    frameworks: frameworks.slice(0, 12),
    packageName: pkg?.name || null,
  };
}
