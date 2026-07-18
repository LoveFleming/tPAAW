/**
 * post-hooks.mjs — Tester 寫入後硬驗證
 *
 * 寫完測試後：syntax check + run test
 */

import { execSync } from 'node:child_process';
import { extname } from 'node:path';
import { LANGUAGE_PROFILES, getLanguageForFile } from './language-profiles.mjs';

/**
 * Post-write: syntax check 測試檔案
 */
export async function verifyAfterWrite(filePath, projectRoot, projectLangs) {
  const ext = extname(filePath);
  const langKey = getLanguageForFile(filePath, projectLangs);
  const result = { passed: true, errors: [], checks: {} };

  if (!langKey) {
    result.checks.skipped = true;
    return result;
  }

  const profile = LANGUAGE_PROFILES[langKey];
  if (profile?.syntaxCheck) {
    const cmd = profile.syntaxCheck(filePath);
    try {
      execSync(cmd, { timeout: 15000, encoding: 'utf-8', cwd: projectRoot });
      result.checks.syntax = { passed: true };
    } catch (err) {
      const errMsg = (err.stderr || err.message || '').trim().slice(0, 500);
      result.checks.syntax = { passed: false, error: errMsg };
      result.passed = false;
      result.errors.push(`Syntax error in test file:\n${errMsg}`);
    }
  }

  return result;
}

/**
 * Phase 3: 跑測試驗證
 */
export async function verifyTests(projectRoot, projectLangs) {
  const details = {};
  let testPassed = true;

  for (const lang of projectLangs) {
    const profile = LANGUAGE_PROFILES[lang];
    if (!profile?.testCmd) continue;

    const cmd = profile.testCmd();
    try {
      execSync(cmd, {
        cwd: projectRoot, timeout: 120000, encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      details.test = { passed: true, lang, cmd };
    } catch (err) {
      const output = (err.stdout || err.stderr || '').slice(-2000);
      details.test = { passed: false, lang, cmd, error: output };
      testPassed = false;
    }
  }

  return { testPassed, details };
}
