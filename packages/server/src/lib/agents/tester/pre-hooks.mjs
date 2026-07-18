/**
 * pre-hooks.mjs — Tester 寫入前硬限制
 *
 * Tester 只能寫測試檔案，不能改 source code。
 */

import { isTestFilePath } from './language-profiles.mjs';
import { resolve, relative, isAbsolute } from 'node:path';

// Tester 不能碰的目錄（比 Developer 更嚴格）
const FORBIDDEN_SOURCE_PATTERNS = [
  { pattern: /\/src\//, reason: 'Tester 不可修改 src/ 原始碼，只能寫測試檔案' },
  { pattern: /\/routes\//, reason: 'Tester 不可修改 API 路由' },
  { pattern: /\/lib\//, reason: 'Tester 不可修改 lib/ 程式碼' },
  { pattern: /\.paaw\//, reason: '專案設定由 EM 管理' },
  { pattern: /Dockerfile/, reason: 'Infra 設定不可修改' },
  { pattern: /\.env$/, reason: '環境變數不可修改' },
];

/**
 * Tester pre-write check: 只能寫測試檔案
 */
export function checkWriteAllowed(filePath, projectRoot) {
  const normalized = normalizePath(filePath, projectRoot);
  if (!normalized) {
    return { allowed: false, reason: `路徑無效: ${filePath}` };
  }

  const relPath = relative(projectRoot, normalized).replace(/\\/g, '/');

  // 必須是測試檔案路徑
  if (!isTestFilePath(relPath)) {
    return {
      allowed: false,
      reason: `Tester 只能寫測試檔案（路徑需包含 test/spec）。${relPath} 不是測試路徑`,
    };
  }

  // 不能是 source code（雙重保險）
  for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
    if (rule.pattern.test(relPath) && !isTestFilePath(relPath)) {
      return { allowed: false, reason: rule.reason };
    }
  }

  return { allowed: true };
}

/**
 * Tester bash pre-check: 只能跑測試相關命令
 */
const ALLOWED_BASH_PATTERNS = [
  /^npm\s+test/,
  /^npx\s+(jest|vitest|mocha|pytest)/,
  /^python3?\s+(-m\s+)?pytest/,
  /^python3?\s+-m\s+unittest/,
  /^mvn\s+test/,
  /^\.\/gradlew\s+test/,
  /^go\s+test/,
  /^cargo\s+test/,
  /^make\s+test/,
  /^ctest/,
  // Allow reading/diagnostic commands
  /^cat\s/,
  /^head\s/,
  /^tail\s/,
  /^wc\s/,
  /^grep\s/,
  /^find\s/,
  /^ls\s/,
  /^sed\s+-n/,
  /^node\s+--check/,
];

const FORBIDDEN_BASH_PATTERNS = [
  { pattern: /git\s+push/, reason: 'Tester 不可 push' },
  { pattern: /git\s+commit/, reason: 'Tester 不可 commit' },
  { pattern: /git\s+reset/, reason: 'Tester 不可 reset' },
  { pattern: /rm\s+-rf/, reason: '禁止 rm -rf' },
  { pattern: /npm\s+install/, reason: 'Tester 不可安裝套件' },
  { pattern: /npm\s+run\s+build/, reason: 'Tester 只跑測試，不跑 build' },
];

export function checkBashAllowed(command) {
  if (!command) return { allowed: true };

  for (const rule of FORBIDDEN_BASH_PATTERNS) {
    if (rule.pattern.test(command)) {
      return { allowed: false, reason: rule.reason };
    }
  }

  return { allowed: true };
}

function normalizePath(filePath, projectRoot) {
  if (!filePath) return null;
  let abs;
  if (isAbsolute(filePath)) {
    abs = filePath;
  } else {
    abs = resolve(projectRoot, filePath);
  }
  const root = resolve(projectRoot);
  if (!abs.startsWith(root)) return null;
  return abs;
}
