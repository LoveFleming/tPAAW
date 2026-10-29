/**
 * Emoji file/folder icons —統一所有 tree view 的圖示
 * Mac/Windows 原生支援，Linux 需裝 fonts-noto-color-emoji（npm postinstall 自動裝）
 * 所有 PAAW 檔案圖示統一走這裡，不用 Icon.tsx 的 SVG file icons
 */

const EMOJI_MAP: Record<string, string> = {
  // Code
  ts: "💠", tsx: "💠", js: "💠", jsx: "💠", mjs: "💠", cjs: "💠",
  py: "🐍", java: "☕", go: "🐹", rs: "🦀", rb: "💎",
  // Config
  json: "🔧", yaml: "🔧", yml: "🔧", toml: "🔧", ini: "🔧",
  // Web
  css: "🎨", scss: "🎨", less: "🎨", html: "🌐", vue: "🌐", svelte: "🌐",
  // Docs
  md: "📝", txt: "📄", pdf: "📕", doc: "📘", docx: "📘",
  // Images
  png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", svg: "🖼️", webp: "🖼️", ico: "🖼️",
  // Shell
  sh: "🐚", bash: "🐚", zsh: "🐚", fish: "🐚",
  // Data
  xml: "📰", csv: "📊", sql: "🗄️",
  // Build
  lock: "🔒", env: "🔐",
  // Archive
  zip: "📦", tar: "📦", gz: "📦",
};

export function fileEmoji(ext: string): string {
  if (!ext) return "📄";
  return EMOJI_MAP[ext.toLowerCase()] || "📄";
}
