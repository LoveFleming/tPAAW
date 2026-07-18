/**
 * post-hooks.mjs — Developer 寫入後硬驗證
 *
 * 每次 AI 寫完/edit 完檔案後自動跑。
 * 根據檔案副檔名決定跑哪種 check。
 * 失敗時把錯誤推回 AI 讓它修。
 */

import { execSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { LANGUAGE_PROFILES, getLanguageForFile } from './language-profiles.mjs';

// ─── 主驗證函數 ─────────────────────────────────────────────────

/**
 * Post-write hook: 寫入檔案後驗證
 *
 * @param {string} filePath - 剛寫入的檔案（絕對路徑）
 * @param {string} projectRoot
 * @param {string[]} projectLangs - detectLanguages() 結果
 * @returns {Promise<{ passed: boolean, errors: string[], checks: object }>}
 */
export async function verifyAfterWrite(filePath, projectRoot, projectLangs) {
  const ext = extname(filePath);
  const langKey = getLanguageForFile(filePath, projectLangs);

  const result = {
    passed: true,
    errors: [],
    checks: {},
  };

  if (!langKey) {
    // 不是已知語言的檔案（JSON, MD, YAML 等）— 不檢查
    result.checks.skipped = true;
    result.checks.reason = `No language profile for extension: ${ext}`;
    return result;
  }

  const profile = LANGUAGE_PROFILES[langKey];
  if (!profile) {
    result.checks.skipped = true;
    return result;
  }

  // ① Syntax check（per-file，快）
  if (profile.syntaxCheck) {
    const cmd = profile.syntaxCheck(filePath);
    try {
      execSync(cmd, { timeout: 15000, encoding: 'utf-8', cwd: projectRoot });
      result.checks.syntax = { passed: true, cmd };
    } catch (err) {
      const errMsg = (err.stderr || err.stdout || err.message || '').trim().slice(0, 500);
      result.checks.syntax = { passed: false, cmd, error: errMsg };
      result.passed = false;
      result.errors.push(`Syntax error in ${filePath}:\n${errMsg}`);
    }
  }

  // ② Type check — 只對 TypeScript 跑（整個專案，不是 per-file）
  // 注意：typeCheck 在 Phase 3 一次跑，這裡不重複
  // （因為 tsc --noEmit 是全專案的，per-file 跑太慢）

  // ③ Lint check（如果使用者有裝）
  // 不強制跑，只在有設定檔時跑
  if (profile.lintCheck && hasLintConfig(projectRoot)) {
    const cmd = profile.lintCheck(filePath);
    try {
      execSync(cmd, { timeout: 30000, encoding: 'utf-8', cwd: projectRoot });
      result.checks.lint = { passed: true };
    } catch (err) {
      // lint 失敗是 warning，不是 error
      const errMsg = (err.stderr || err.stdout || '').trim().slice(0, 300);
      result.checks.lint = { passed: false, error: errMsg, warning: true };
    }
  }

  return result;
}

// ─── 整體驗證（Phase 3 用）─────────────────────────────────────

/**
 * Phase 3 整體驗證：build + type check + test
 * 對整個專案跑，不是 per-file。
 *
 * @param {string} projectRoot
 * @param {string[]} projectLangs
 * @returns {Promise<{ buildPassed: boolean, typePassed: boolean, testPassed: boolean, details: object }>}
 */
export async function verifyProject(projectRoot, projectLangs) {
  const details = {};
  let buildPassed = true;
  let typePassed = true;
  let testPassed = true;

  for (const lang of projectLangs) {
    const profile = LANGUAGE_PROFILES[lang];
    if (!profile) continue;

    // Build check
    if (profile.buildCmd) {
      const cmd = profile.buildCmd();
      try {
        const output = execSync(cmd, {
          cwd: projectRoot, timeout: 120000, encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        details.build = { passed: true, lang, cmd };
      } catch (err) {
        const output = (err.stdout || err.stderr || '').slice(-1000);
        details.build = { passed: false, lang, cmd, error: output };
        buildPassed = false;
      }
    }

    // Type check
    if (profile.typeCheck) {
      const cmd = profile.typeCheck();
      try {
        execSync(cmd, {
          cwd: projectRoot, timeout: 60000, encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        details.typeCheck = { passed: true, lang, cmd };
      } catch (err) {
        const output = (err.stdout || err.stderr || '');
        const errors = output.split('\n').filter(l => l.includes('error')).slice(0, 10);
        details.typeCheck = { passed: false, lang, cmd, errors };
        typePassed = false;
      }
    }

    // Test check — 記住「改之前」的狀態，避免假陽性
    if (profile.testCmd) {
      const cmd = profile.testCmd();
      try {
        execSync(cmd, {
          cwd: projectRoot, timeout: 120000, encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        details.test = { passed: true, lang, cmd };
      } catch (err) {
        const output = (err.stdout || err.stderr || '').slice(-1000);
        details.test = { passed: false, lang, cmd, error: output };
        testPassed = false;
      }
    }
  }

  return { buildPassed, typePassed, testPassed, details };
}

// ─── Helpers ───────────────────────────────────────────────────

function hasLintConfig(projectRoot) {
  const configs = [
    '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.mjs',
    'eslint.config.js', 'eslint.config.mjs',
    '.pylintrc', 'ruff.toml', '.ruff.toml',
    '.golangci.yml', '.golangci.yaml',
  ];
  return configs.some(c => existsSync(join(projectRoot, c)));
}
