/**
 * git-helpers.ts — Git UI 工具函數
 * 
 * 核心概念：程式碼是主角，.paaw 是配角
 * 檔案分類 → 分組顯示 → 視覺層次
 */

// ── Types ──
export interface GitFileStatus {
  status: string;
  path: string;
  staged?: boolean;
}

/**
 * 唯一識別一個 git file entry
 * 同一個 path 可能同時出現在 staged 和 unstaged
 * 用 path + staged 狀態組合當 key
 */
export function fileKey(f: GitFileStatus): string {
  return `${f.staged ? "S" : "U"}::${f.path}`;
}

/**
 * 從 fileKey 取回 path（用於 git add/commit API）
 */
export function pathFromFileKey(key: string): string {
  return key.replace(/^[SU]::/, "");
}

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

export type FileCategory = "code" | "paaw" | "config" | "docs" | "other";

export interface GitFileGroup {
  category: FileCategory;
  label: string;
  emoji: string;
  files: GitFileStatus[];
  defaultExpanded: boolean;
  color: string;        // accent color (tailwind name)
  bgColor: string;      // background tint
  borderColor: string;  // left border color
}

// ── File Classification ──

/**
 * 將 git 檔案路徑分類
 * 核心原則：程式碼最重要，.paaw 退讓
 */
export function classifyGitFile(path: string): FileCategory {
  // .paaw/ — AI workspace files
  if (/^\.paaw[/\\]/.test(path)) return "paaw";

  // Config files
  if (
    path === "package.json" ||
    path === "package-lock.json" ||
    path === "pnpm-lock.yaml" ||
    path === "yarn.lock" ||
    path === "tsconfig.json" ||
    path === "tsconfig.*.json" ||
    path === ".gitignore" ||
    path === ".env" ||
    path === ".env.*" ||
    path === "docker-compose.yml" ||
    path === "Dockerfile" ||
    path === ".eslintrc*" ||
    path === ".prettierrc*" ||
    path === "vite.config.*" ||
    path === "vitest.config.*" ||
    path === "jest.config.*" ||
    path === "rollup.config.*" ||
    path === "webpack.config.*" ||
    path === ".paawrc" ||
    path === ".paawrc.json"
  ) return "config";

  // Config directories
  if (/^[.](?:env|vscode|idea|github|gitlab|paaw)[/\\]/.test(path)) return "config";
  if (/^(?:config|conf|settings)[/\\]/.test(path)) return "config";

  // Docs
  if (/^README/i.test(path)) return "docs";
  if (/^(?:docs|documentation)[/\\]/.test(path)) return "docs";
  if (/\.(md|mdx|rst|txt)$/i.test(path) && !/\.d\.ts$/.test(path)) return "docs";
  if (/^(?:LICENSE|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT)/i.test(path)) return "docs";

  // Code files — the most important category
  if (/\.(mjs|js|jsx|ts|tsx|py|go|rs|java|c|cpp|cc|cxx|h|hpp|cs|rb|php|swift|kt|scala|clj|hs|elm|vue|svelte|astro)$/i.test(path)) return "code";
  if (/\.(css|scss|sass|less|styl|pcss|postcss)$/i.test(path)) return "code";
  if (/\.(html|htm|svg|xml)$/i.test(path)) return "code";
  if (/\.(sql|graphql|gql|prisma)$/i.test(path)) return "code";
  if (/\.(sh|bash|zsh|fish|ps1|bat|cmd)$/i.test(path)) return "code";
  if (/\.(yaml|yml|toml)$/i.test(path) && !/^docker-compose/.test(path)) return "config";
  if (/\.test\./i.test(path) || /\.spec\./i.test(path)) return "code";
  if (/\.(json|jsonc|json5)$/i.test(path) && path !== "package.json" && path !== "tsconfig.json") return "other";

  // Default
  return "other";
}

// ── Group Configuration ──

const GROUP_CONFIG: Record<FileCategory, Omit<GitFileGroup, "files">> = {
  code: {
    category: "code",
    label: "Code Changes",
    emoji: "📝",
    defaultExpanded: true,
    color: "emerald",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-400",
  },
  paaw: {
    category: "paaw",
    label: "AI Workspace",
    emoji: "🤖",
    defaultExpanded: false,
    color: "stone",
    bgColor: "bg-stone-50",
    borderColor: "border-stone-300",
  },
  config: {
    category: "config",
    label: "Config",
    emoji: "⚙️",
    defaultExpanded: false,
    color: "blue",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-300",
  },
  docs: {
    category: "docs",
    label: "Docs",
    emoji: "📖",
    defaultExpanded: false,
    color: "amber",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-300",
  },
  other: {
    category: "other",
    label: "Other",
    emoji: "📎",
    defaultExpanded: false,
    color: "stone",
    bgColor: "bg-stone-50",
    borderColor: "border-stone-200",
  },
};

/**
 * 將 git file list 分組
 * 排序：code > config > docs > other > paaw（.paaw 最後、最不顯眼）
 */
export function groupGitFiles(files: GitFileStatus[]): GitFileGroup[] {
  const categoryOrder: FileCategory[] = ["code", "config", "docs", "other", "paaw"];

  const groups = new Map<FileCategory, GitFileStatus[]>();
  for (const f of files) {
    const cat = classifyGitFile(f.path);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(f);
  }

  return categoryOrder
    .filter(cat => groups.has(cat) && groups.get(cat)!.length > 0)
    .map(cat => ({
      ...GROUP_CONFIG[cat],
      files: groups.get(cat)!,
    }));
}

/**
 * 取得分類標籤文字
 */
export function getCategoryLabel(category: FileCategory): string {
  return GROUP_CONFIG[category].label;
}

/**
 * 取得 git status 符號對應的 emoji
 */
export function getStatusEmoji(status: string): string {
  switch (status) {
    case "M": return "✎";
    case "A": return "✚";
    case "D": return "✖";
    case "R": return "➜";
    case "C": return "⧉";
    case "?": return "?";
    default: return status;
  }
}

// ── Feature-First 分組（FILE-FEATURES 查表，純 deterministic）──

/**
 * FILE-FEATURES.json 裡的一個 feature 反查項目
 */
export interface FeatureRef {
  id?: string;
  name?: string;
  tags?: string[];
}

/**
 * file path → feature refs 的反查表（GET /api/coding-features/file-map 回傳）
 */
export type FeatureFileMap = Record<string, FeatureRef[]>;

/**
 * 查某個 git 檔案命中哪些 feature（純查表，回空陣列 = 未對應）
 */
export function featuresForPath(
  path: string,
  featureMap: FeatureFileMap | null | undefined
): FeatureRef[] {
  if (!featureMap) return [];
  const hit = featureMap[path] ?? featureMap[path.replace(/\\/g, "/")];
  return Array.isArray(hit) ? hit.filter(Boolean) : [];
}

/**
 * Feature-first 分組：把 git files 依 FILE-FEATURES 歸到對應 feature 卡
 *
 * - 對應到 feature 的 code 檔 → 依 feature 分組（feature 是主角）
 * - 有 feature 對應但非 code（.paaw / config / docs）→ 也歸 feature（給脈絡，但次要）
 * - 沒有任何 feature 對應 → 進 unmapped（defensive，讓洞一眼可見）
 */
export interface FeatureGroup {
  featureId?: string;
  /** 顯示名：feature name（缺則用 id） */
  name: string;
  files: GitFileStatus[];
}

/**
 * 將 git files 依 feature 分組。回傳 { groups, unmapped }
 * - groups: 依 feature 聚合的 code 檔（維持遇到順序）
 * - unmapped: 沒對應到任何 feature 的 code 檔
 * - 非 code 檔一律不進 feature 分組（另有 category 分組處理）
 */
export function groupGitFilesByFeature(
  files: (GitFileStatus & { staged: boolean })[],
  featureMap: FeatureFileMap | null | undefined
): { groups: FeatureGroup[]; unmapped: GitFileStatus[] } {
  const groups: FeatureGroup[] = [];
  const groupByKey = new Map<string, FeatureGroup>();
  const unmapped: GitFileStatus[] = [];

  for (const f of files) {
    // 只有 code 檔參與 feature 分組；.paaw/config/docs/other 交給 category 分組
    const cat = classifyGitFile(f.path);
    if (cat !== "code") {
      unmapped.push(f);
      continue;
    }

    const refs = featuresForPath(f.path, featureMap);
    if (refs.length === 0) {
      unmapped.push(f);
      continue;
    }

    // 一個檔可能對應多個 feature → 每個都進（檔案會重複出現在多張卡，屬正常）
    for (const ref of refs) {
      const name = ref.name || ref.id || "Unnamed feature";
      const key = ref.id || name;
      let g = groupByKey.get(key);
      if (!g) {
        g = { featureId: ref.id, name, files: [] };
        groupByKey.set(key, g);
        groups.push(g);
      }
      g.files.push(f);
    }
  }

  return { groups, unmapped };
}

/**
 * Phase D：cross-feature / unexpected 旗標（Change Boundary 視覺化，純 deterministic）
 */

/**
 * 找出 cross-feature 檔案：一檔命中 ≥2 個 feature
 * 回傳 Set<path>（正規化為 /）
 */
export function crossFeaturePaths(
  files: GitFileStatus[],
  featureMap: FeatureFileMap | null | undefined
): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    if (featuresForPath(f.path, featureMap).length >= 2) {
      out.add(f.path.replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * 找出 unexpected（scope 外）檔案：
 * - evidence.reviewBoundary.unexpectedFiles 列出的 path 一律算
 * - 有 scope（hasScope）時：working tree 的 code 檔不在 expectedFiles → 也算
 * 沒有 evidence / 沒 scope → 回空集合（不誤報）
 */
export function unexpectedOutOfScopePaths(
  files: (GitFileStatus & { staged?: boolean })[],
  evidence: { reviewBoundary?: {
    hasScope?: boolean;
    expectedFiles?: { path: string }[];
    unexpectedFiles?: { path: string }[];
  } | null } | null | undefined
): Set<string> {
  const out = new Set<string>();
  const rb = evidence?.reviewBoundary;
  if (!rb) return out;
  for (const f of rb.unexpectedFiles ?? []) out.add(f.path.replace(/\\/g, "/"));
  if (rb.hasScope && Array.isArray(rb.expectedFiles)) {
    const expected = new Set((rb.expectedFiles).map(f => f.path.replace(/\\/g, "/")));
    for (const f of files) {
      const p = f.path.replace(/\\/g, "/");
      if (classifyGitFile(p) === "code" && !expected.has(p)) out.add(p);
    }
  }
  return out;
}

/**
 * 取得 status 顏色 class
 */
export function getStatusColorClass(status: string, isStaged: boolean): string {
  if (isStaged) {
    switch (status) {
      case "A": return "text-emerald-600";
      case "M": return "text-emerald-500";
      case "D": return "text-red-500";
      default: return "text-emerald-400";
    }
  }
  switch (status) {
    case "M": return "text-amber-500";
    case "A": return "text-emerald-500";
    case "D": return "text-red-500";
    case "?": return "text-stone-400";
    default: return "text-stone-400";
  }
}
