/**
 * pre-hooks.mjs — Developer 寫入前硬限制
 *
 * 每次 AI 要 write_file / edit_file / delete_file 前都會跑。
 * 程式碼檢查，AI 無法繞過。
 */

import { isTestFile } from './language-profiles.mjs';
import { existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

// ─── Developer 角色限制 ───────────────────────────────────────

const FORBIDDEN_PATH_PATTERNS = [
  // 測試檔案由 Tester (Divya) 負責
  { pattern: /\.test\./, reason: '測試檔案由 Tester (Divya) 負責' },
  { pattern: /\.spec\./, reason: '測試檔案由 Tester (Divya) 負責' },
  { pattern: /__tests__\//, reason: '測試檔案由 Tester (Divya) 負責' },
  { pattern: /\/tests?\//, reason: '測試檔案由 Tester (Divya) 負責' },
  { pattern: /_test\.go$/, reason: '測試檔案由 Tester (Divya) 負責' },
  { pattern: /Test\.java$/, reason: '測試檔案由 Tester (Divya) 負責' },
  { pattern: /test_.*\.py$/, reason: '測試檔案由 Tester (Divya) 負責' },

  // 專案設定由 EM 管理
  { pattern: /\.paaw\//, reason: '專案設定由 EM 管理' },
  { pattern: /CODING-STANDARDS\.md/, reason: 'Coding Standards 由 EM 管理' },

  // CI/CD 和 infra 設定
  { pattern: /\.github\/workflows\//, reason: 'CI/CD 設定由 EM 或 Helpdesk 管理' },
  { pattern: /Dockerfile/, reason: 'Docker 設定由 Helpdesk 管理' },
  { pattern: /docker-compose/, reason: 'Docker 設定由 Helpdesk 管理' },
  { pattern: /nginx.*\.conf/, reason: 'Infra 設定由 Helpdesk 管理' },
  { pattern: /\.env$/, reason: '環境變數檔案不可直接修改' },
];

// ─── 主檢查函數 ─────────────────────────────────────────────────

/**
 * Pre-write hook: 檢查 AI 是否可以寫入這個檔案。
 *
 * @param {string} filePath - AI 要寫入的檔案路徑（相對或絕對）
 * @param {string} projectRoot - 專案根目錄
 * @param {object} options
 * @param {string[]} options.plannedFiles - Phase 1 plan 裡的檔案清單
 * @param {string[]} options.projectLangs - 偵測到的語言
 * @returns {{ allowed: boolean, reason?: string, warning?: string }}
 */
export function checkWriteAllowed(filePath, projectRoot, options = {}) {
  const { plannedFiles = [], projectLangs = [] } = options;

  // ① 正規化路徑
  const normalized = normalizePath(filePath, projectRoot);
  if (!normalized) {
    return { allowed: false, reason: `路徑無效或超出專案目錄: ${filePath}` };
  }

  // ② 路徑穿越攻擊防護
  if (normalized.includes('..')) {
    return { allowed: false, reason: `路徑不允許包含 .. : ${filePath}` };
  }

  const relPath = relative(projectRoot, normalized).replace(/\\/g, '/');

  // ③ 角色限制：forbidden paths
  for (const rule of FORBIDDEN_PATH_PATTERNS) {
    if (rule.pattern.test(relPath)) {
      return { allowed: false, reason: rule.reason };
    }
  }

  // ④ 測試檔案檢查（用 language-profiles 的 testDirPatterns）
  if (projectLangs.length > 0 && isTestFile(relPath, projectLangs)) {
    return { allowed: false, reason: '測試檔案由 Tester (Divya) 負責' };
  }

  // ⑤ Plan 對比（warning，不擋）
  let warning = null;
  if (plannedFiles.length > 0) {
    const inPlan = plannedFiles.some(p => pathsMatch(p, relPath));
    if (!inPlan) {
      warning = `${relPath} 不在原始 plan 裡，允許但記錄`;
    }
  }

  return { allowed: true, warning };
}

/**
 * Pre-delete hook: 刪除檔案前檢查（更嚴格）
 */
export function checkDeleteAllowed(filePath, projectRoot, options = {}) {
  const { plannedFiles = [] } = options;

  const normalized = normalizePath(filePath, projectRoot);
  if (!normalized) {
    return { allowed: false, reason: `路徑無效: ${filePath}` };
  }

  const relPath = relative(projectRoot, normalized).replace(/\\/g, '/');

  // 所有 forbidden patterns 也適用於刪除
  for (const rule of FORBIDDEN_PATH_PATTERNS) {
    if (rule.pattern.test(relPath)) {
      return { allowed: false, reason: rule.reason };
    }
  }

  // 刪除必須在 plan 裡（硬限制）
  const inPlan = plannedFiles.some(p => pathsMatch(p, relPath));
  if (!inPlan) {
    return { allowed: false, reason: `${relPath} 不在 plan 裡，不可刪除` };
  }

  return { allowed: true };
}

// ─── Helpers ───────────────────────────────────────────────────

function normalizePath(filePath, projectRoot) {
  if (!filePath || typeof filePath !== 'string') return null;

  let abs;
  if (isAbsolute(filePath)) {
    abs = filePath;
  } else {
    abs = resolve(projectRoot, filePath);
  }

  // 確認在專案目錄內
  const root = resolve(projectRoot);
  if (!abs.startsWith(root)) {
    return null;
  }

  return abs;
}

function pathsMatch(planned, actual) {
  const a = planned.replace(/^\.\//, '').replace(/\\/g, '/');
  const b = actual.replace(/^\.\//, '').replace(/\\/g, '/');
  return a === b;
}

// ─── Bash command pre-check ────────────────────────────────────

const FORBIDDEN_COMMANDS = [
  { pattern: /rm\s+-rf\s+\//, reason: '禁止 rm -rf 根目錄' },
  { pattern: /git\s+push\s+--force(?!.*--with-lease)/, reason: '請使用 git push --force-with-lease' },
  { pattern: /git\s+reset\s+--hard/, reason: '禁止 git reset --hard，請用 git stash' },
  { pattern: /DROP\s+TABLE/i, reason: '禁止 DROP TABLE' },
  { pattern: /--no-verify/, reason: '禁止跳過 hook 驗證' },
  { pattern: /chmod\s+777/, reason: '禁止 chmod 777' },
  { pattern: /curl.*\|\s*(bash|sh)/, reason: '禁止 pipe to shell' },
];

/**
 * Pre-bash hook: 檢查 AI 要執行的 bash 命令
 *
 * @param {string} command
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkBashAllowed(command) {
  if (!command || typeof command !== 'string') {
    return { allowed: true };
  }

  for (const rule of FORBIDDEN_COMMANDS) {
    if (rule.pattern.test(command)) {
      return { allowed: false, reason: rule.reason };
    }
  }

  return { allowed: true };
}
