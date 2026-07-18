/**
 * language-profiles.mjs (Tester version)
 * Re-exports from developer — same language detection, different test commands.
 * Tester focuses on testDirPatterns and testRunner commands.
 */

import { LANGUAGE_PROFILES as PROFILES } from '../developer/language-profiles.mjs';

export {
  detectLanguages,
  LANGUAGE_PROFILES,
  getLanguageForFile,
  isTestFile,
  getAllSourceExtensions,
} from '../developer/language-profiles.mjs';

/**
 * Tester can ONLY write to test directories.
 */
export function isTestFilePath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    /\/(test|tests|__tests__)\//.test(normalized) ||
    /\.test\./.test(normalized) ||
    /\.spec\./.test(normalized) ||
    /_test\.go$/.test(normalized) ||
    /Test\.java$/.test(normalized) ||
    /test_.*\.py$/.test(normalized) ||
    /_test\.py$/.test(normalized) ||
    /\/tests?\//.test(normalized)
  );
}

/**
 * Get the test runner command.
 */
export function getTestRunner(projectLangs) {
  for (const lang of projectLangs) {
    const profile = PROFILES[lang];
    if (profile?.testCmd) {
      return { cmd: profile.testCmd(), lang };
    }
  }
  return { cmd: 'npm test 2>&1', lang: 'default' };
}
