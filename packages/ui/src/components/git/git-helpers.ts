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
