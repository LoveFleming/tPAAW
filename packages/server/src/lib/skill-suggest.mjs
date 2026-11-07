/**
 * skill-suggest.mjs — 語言/框架偵測 → per-agent skill 建議
 *
 * 鐵律：事實靠程式，LLM 只註解。
 *   偵測（副檔名統計 + manifest 解析）與建議（STACK_RULES 規則表）
 *   全部 deterministic、零 token、可重現。
 *   LLM 只做「為什麼適合」的一句話註解 + catalog 缺口點子（見 route annotate）。
 *
 * 用法：
 *   const r = await suggestSkills(projectPath);
 *   r.detection  — 掃描事實（語言/框架/測試/manifest）
 *   r.agents     — per-agent 建議（含 evidence + new/already 狀態）
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { DATA_HOME } from "../data-home.mjs";
import { readJson, readProjectAgent } from "./project-crew.mjs";

// ── 掃描設定 ──

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".paaw", "vendor", "target",
  "__pycache__", ".next", "coverage", ".turbo", ".cache", "out", "bin", "obj",
  ".venv", "venv", "Pods", ".idea", ".vscode",
  // 非源碼目錄（樣本/規則库/測試資料）— 掃了會誤判語言
  "data", "testdata", "test-data", "fixtures", "semgrep-rules",
  "__snapshots__", "__mocks__", "screenshots",
]);
const MAX_FILES = 20000; // 大 repo 防呆

const EXT_LANG = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java",
  ".kt": "kotlin", ".kts": "kotlin", ".swift": "swift", ".php": "php", ".cs": "csharp",
  ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".c": "cpp", ".h": "cpp", ".hpp": "cpp",
  ".rb": "ruby", ".vue": "vue", ".dart": "dart",
};

const MANIFEST_NAMES = new Set([
  "package.json", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts",
  "composer.json", "pubspec.yaml", "Gemfile", "requirements.txt", "pyproject.toml", "Pipfile",
]);

const LANG_LABEL = {
  typescript: "TypeScript", javascript: "JavaScript", python: "Python", go: "Go",
  rust: "Rust", java: "Java", kotlin: "Kotlin", swift: "Swift", php: "PHP",
  csharp: "C#", cpp: "C/C++", ruby: "Ruby", vue: "Vue", dart: "Dart",
};

// ── Manifest → framework 對應（deps key → stack id）──

const NPM_KEYS = [
  ["react", "react"], ["next", "nextjs"], ["vue", "vue"], ["@nestjs/core", "nestjs"],
  ["@angular/core", "angular"], ["react-native", "react-native"], ["nuxt", "vue"],
  ["@playwright/test", "playwright"], ["playwright", "playwright"],
  ["graphql", "graphql"], ["pg", "postgres"], ["postgres", "postgres"], ["postgresql", "postgres"],
  ["@kubernetes/client-node", "kubernetes"], ["k8s", "kubernetes"],
];
const PY_KEYS = [
  ["django", "django"], ["fastapi", "fastapi"], ["flask", "flask"],
  ["pandas", "pandas"], ["pyspark", "spark"], ["pytest", "pytest"],
  ["psycopg2", "postgres"], ["psycopg", "postgres"], ["asyncpg", "postgres"],
];

// ── 規則表：stack id → 建議 skill（含目標 agent）──
// agents 對象：developer 拿語言+框架；architect 拿核心語言+架構類；
// tester 拿測試 runner + 主語言；ops 拿基礎設施類。

const DEV = ["coding.developer"];
const DEV_ARCH = ["coding.developer", "coding.architect"];
const TESTER = ["coding.tester"];
const OPS = ["coding.ops"];

export const STACK_RULES = {
  // 語言
  typescript: { skills: [{ id: "typescript-pro", agents: DEV_ARCH }] },
  javascript: { skills: [{ id: "javascript-pro", agents: DEV }] },
  python: { skills: [{ id: "python-pro", agents: DEV_ARCH }] },
  go: { skills: [{ id: "golang-pro", agents: DEV_ARCH }] },
  rust: { skills: [{ id: "rust-engineer", agents: DEV_ARCH }] },
  java: { skills: [{ id: "java-architect", agents: DEV_ARCH }] },
  kotlin: { skills: [{ id: "kotlin-specialist", agents: DEV }] },
  swift: { skills: [{ id: "swift-expert", agents: DEV }] },
  php: { skills: [{ id: "php-pro", agents: DEV }] },
  csharp: { skills: [{ id: "csharp-developer", agents: DEV }, { id: "dotnet-core-expert", agents: DEV }] },
  cpp: { skills: [{ id: "cpp-pro", agents: DEV }] },
  ruby: { skills: [{ id: "rails-expert", agents: DEV }] },
  dart: { skills: [{ id: "flutter-expert", agents: DEV }] },
  // 前端框架
  react: { skills: [{ id: "react-expert", agents: DEV }, { id: "react-frontend-best-practices", agents: DEV }] },
  nextjs: { skills: [{ id: "nextjs-developer", agents: DEV }, { id: "nextjs-backend-best-practices", agents: DEV }] },
  vue: { skills: [{ id: "vue-expert", agents: DEV }] },
  nestjs: { skills: [{ id: "nestjs-expert", agents: DEV }] },
  angular: { skills: [{ id: "angular-architect", agents: DEV_ARCH }] },
  "react-native": { skills: [{ id: "react-native-expert", agents: DEV }] },
  flutter: { skills: [{ id: "flutter-expert", agents: DEV }] },
  // Python 生態
  django: { skills: [{ id: "django-expert", agents: DEV }] },
  fastapi: { skills: [{ id: "fastapi-expert", agents: DEV }] },
  pandas: { skills: [{ id: "pandas-pro", agents: DEV }] },
  spark: { skills: [{ id: "spark-engineer", agents: DEV }] },
  // JVM 生態
  spring: { skills: [{ id: "spring-boot-engineer", agents: DEV }] },
  laravel: { skills: [{ id: "laravel-specialist", agents: DEV }] },
  // 資料/基礎設施
  postgres: { skills: [{ id: "postgres-pro", agents: DEV }] },
  graphql: { skills: [{ id: "graphql-architect", agents: DEV_ARCH }] },
  terraform: { skills: [{ id: "terraform-engineer", agents: OPS }] },
  kubernetes: { skills: [{ id: "kubernetes-specialist", agents: OPS }] },
  // 測試
  playwright: { skills: [{ id: "playwright-expert", agents: TESTER }] },
};

// ── Catalog（skill id → 名稱）──

export function loadSkillCatalog() {
  const out = new Map();
  for (const sub of ["physical-skill", "input-prompt"]) {
    const dir = join(DATA_HOME, "skills", sub);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      let name = d.name;
      try {
        const raw = readFileSync(join(dir, d.name, "SKILL.md"), "utf-8");
        const nm = raw.match(/^name:\s*(.+)$/m);
        if (nm) name = nm[1].trim();
      } catch { /* 用目錄名 */ }
      out.set(d.name, { id: d.name, name, kind: sub });
    }
  }
  return out;
}

// ── 機械掃描 ──
// 純 readdirSync 遞迴（跨平台，不用 shell find — Windows 地雷）

export function detectStack(projectPath) {
  const extCounts = new Map();   // langId → { files, exts:Set }
  const manifests = [];          // { rel, name }
  let scanned = 0;

  const walk = (dir, depth) => {
    if (scanned >= MAX_FILES || depth > 6) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (scanned >= MAX_FILES) break;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else {
        scanned++;
        const dot = e.name.lastIndexOf(".");
        const ext = dot >= 0 ? e.name.slice(dot).toLowerCase() : "";
        const lang = EXT_LANG[ext];
        if (lang) {
          const cur = extCounts.get(lang) || { files: 0, exts: new Set() };
          cur.files++;
          cur.exts.add(ext);
          extCounts.set(lang, cur);
        }
        if (MANIFEST_NAMES.has(e.name) || ext === ".csproj" || ext === ".tf") {
          manifests.push({ rel: full.slice(projectPath.length + 1), name: e.name, full });
        }
        // k8s 目錄特徵（rel path 含 k8s/kubernetes/helm/charts）
        if (/(^|[/\\])(k8s|kubernetes|helm|charts)([/\\])/.test(full.slice(projectPath.length + 1))) {
          manifests.push({ rel: full.slice(projectPath.length + 1), name: "__k8s_dir__", full });
        }
      }
    }
  };
  walk(projectPath, 0);

  const totalCode = [...extCounts.values()].reduce((s, v) => s + v.files, 0);

  // ── 語言 stacks（副檔名 ≥3 個檔，或 manifest 背書）──
  const stacks = new Map(); // id → { id, kind, label, evidence, source }
  for (const [id, { files, exts }] of extCounts) {
    if (files < 3) continue;
    const share = totalCode > 0 ? Math.round((files / totalCode) * 100) : 0;
    stacks.set(id, {
      id, kind: "language", label: LANG_LABEL[id] || id,
      evidence: `${files} 個 ${[...exts].slice(0, 3).join("/")} 檔（${share}%）`,
      source: "ext",
    });
  }

  // ── Manifest 解析 → framework/test/infra stacks ──
  const addStack = (id, kind, label, evidence) => {
    if (stacks.has(id)) return; // 語言偵測優先（證據更具體）
    stacks.set(id, { id, kind, label, evidence, source: "manifest" });
  };
  const depHits = new Map(); // stackId → Set(depName)

  for (const m of manifests) {
    if (m.name === "__k8s_dir__") {
      addStack("kubernetes", "infra", "Kubernetes", "目錄：" + m.rel.split(/[\\/]/)[0]);
      continue;
    }
    if (m.name.endsWith(".tf")) {
      if (!stacks.has("terraform")) addStack("terraform", "infra", "Terraform", "manifest：" + m.rel);
      continue; // .tf 常常幾十個 — 不逐個讀內容
    }
    let content = null;
    try { content = readFileSync(m.full, "utf-8"); } catch { continue; }
    const rel = m.rel;

    if (m.name === "package.json") {
      let pkg; try { pkg = JSON.parse(content); } catch { continue; }
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [key, stackId] of NPM_KEYS) {
        if (deps[key]) {
          if (!depHits.has(stackId)) depHits.set(stackId, new Set());
          depHits.get(stackId).add(key);
        }
      }
    } else if (m.name === "requirements.txt" || m.name === "pyproject.toml" || m.name === "Pipfile") {
      for (const [key, stackId] of PY_KEYS) {
        if (new RegExp(`^\\s*["']?${key}(\\b|["'=<>~])`, "im").test(content)) {
          if (!depHits.has(stackId)) depHits.set(stackId, new Set());
          depHits.get(stackId).add(key);
        }
      }
    } else if (m.name === "go.mod") {
      addStack("go", "language", "Go", `manifest：${rel}`);
    } else if (m.name === "Cargo.toml") {
      addStack("rust", "language", "Rust", `manifest：${rel}`);
    } else if (m.name === "pom.xml" || m.name === "build.gradle") {
      addStack("java", "language", "Java", `manifest：${rel}`);
      if (/springframework/i.test(content)) depHits.set("spring", new Set(["springframework"]));
    } else if (m.name === "build.gradle.kts") {
      addStack("kotlin", "language", "Kotlin", `manifest：${rel}`);
      if (/springframework/i.test(content)) depHits.set("spring", new Set(["springframework"]));
    } else if (m.name === "composer.json") {
      addStack("php", "language", "PHP", `manifest：${rel}`);
      if (/"laravel\//.test(content)) depHits.set("laravel", new Set(["laravel"]));
    } else if (m.name === "pubspec.yaml") {
      if (/^\s*flutter:/m.test(content)) addStack("flutter", "framework", "Flutter", `manifest：${rel}`);
    } else if (m.name === "Gemfile") {
      if (/['"]rails['"]/i.test(content)) addStack("ruby", "language", "Ruby (Rails)", `manifest：${rel}`);
    } else if (ext(m.name) === ".csproj") {
      addStack("csharp", "language", "C#", `manifest：${rel}`);
    }
  }

  // dep 命中 → framework/test stacks
  const FW_LABEL = {
    react: "React", nextjs: "Next.js", vue: "Vue", nestjs: "NestJS", angular: "Angular",
    "react-native": "React Native", playwright: "Playwright", graphql: "GraphQL",
    postgres: "PostgreSQL", kubernetes: "Kubernetes", django: "Django", fastapi: "FastAPI",
    flask: "Flask", pandas: "pandas", spark: "Spark", pytest: "pytest", spring: "Spring Boot",
    laravel: "Laravel", flutter: "Flutter",
  };
  for (const [stackId, deps] of depHits) {
    addStack(stackId, "framework", FW_LABEL[stackId] || stackId, `依賴：${[...deps].join(", ")}`);
  }

  return {
    scannedFiles: scanned,
    stacks: [...stacks.values()].sort((a, b) => (a.kind === "language" ? 0 : 1) - (b.kind === "language" ? 0 : 1)),
    manifests: manifests.filter(m => m.name !== "__k8s_dir__").map(m => m.rel).slice(0, 20),
  };
}

function ext(name) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

// ── 建議產生（deterministic）──

const TARGET_AGENTS = ["coding.developer", "coding.architect", "coding.tester", "coding.ops"];

export function suggestSkills(projectPath, { catalog } = {}) {
  const detection = detectStack(projectPath);
  const cat = catalog || loadSkillCatalog();

  // 現有綁定：per-project 優先，fallback 全域 template
  const bindings = new Map();      // agentId → Set(skillId)
  const agentMeta = new Map();     // agentId → { title, source }
  for (const agentId of TARGET_AGENTS) {
    let def = readProjectAgent(projectPath, agentId);
    let source = "project";
    if (!def) {
      def = readJson(join(DATA_HOME, "crews", `${agentId}.json`));
      source = "global";
    }
    if (def) {
      bindings.set(agentId, new Set(def.skillIds || []));
      agentMeta.set(agentId, { title: def.title || agentId, codename: def.codename || "", source });
    }
  }

  // 規則比對
  const byAgent = new Map(); // agentId → Map(skillId → suggestion)
  for (const stack of detection.stacks) {
    const rule = STACK_RULES[stack.id];
    if (!rule) continue; // 偵測到但無 catalog skill（flask/electron…）→ AI 註解層處理缺口
    for (const s of rule.skills) {
      for (const agentId of s.agents) {
        if (!bindings.has(agentId)) continue; // 專案沒有這個 agent（如砍掉 ops）
        if (!byAgent.has(agentId)) byAgent.set(agentId, new Map());
        const cur = byAgent.get(agentId).get(s.id) || { skillId: s.id, stacks: [], status: "new" };
        cur.stacks.push({ id: stack.id, label: stack.label, evidence: stack.evidence });
        byAgent.get(agentId).set(s.id, cur);
      }
    }
  }

  let newCount = 0, alreadyCount = 0;
  const agents = [...bindings.keys()].filter(id => byAgent.has(id)).map(agentId => {
    const suggestions = [...byAgent.get(agentId).values()].map(s => {
      const inCatalog = cat.has(s.skillId);
      const status = bindings.get(agentId).has(s.skillId) ? "already" : "new";
      if (status === "new") newCount++; else alreadyCount++;
      return {
        skillId: s.skillId,
        skillName: cat.get(s.skillId)?.name || s.skillId,
        inCatalog,
        status,
        evidence: s.stacks.map(st => `${st.label}（${st.evidence}）`).join("；"),
        stacks: s.stacks.map(st => st.id),
      };
    });
    // new 排前面
    suggestions.sort((a, b) => (a.status === "new" ? 0 : 1) - (b.status === "new" ? 0 : 1));
    return {
      agentId,
      ...agentMeta.get(agentId),
      currentSkills: [...bindings.get(agentId)],
      suggestions,
    };
  });

  // 沒規則可配的偵測結果（catalog 缺口事實，給 AI 註解層與 UI 顯示）
  const unmatched = detection.stacks.filter(s => !STACK_RULES[s.id]).map(s => ({ id: s.id, label: s.label }));

  return {
    generatedAt: new Date().toISOString(),
    detection,
    unmatched,
    agents,
    summary: { newCount, alreadyCount, agentsWithNew: agents.filter(a => a.suggestions.some(s => s.status === "new")).length },
  };
}
