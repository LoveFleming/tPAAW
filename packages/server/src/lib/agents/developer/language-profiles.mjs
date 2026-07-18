/**
 * language-profiles.mjs — Multi-language detection and command mapping
 *
 * Used by post-hooks.mjs to know which check command to run per file extension.
 * Used by orchestrator.mjs Phase 0 to tell AI what language the project uses.
 */

import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';

// ─── Language Profiles ─────────────────────────────────────────

export const LANGUAGE_PROFILES = {

  javascript: {
    label: 'JavaScript',
    detect: (root) => {
      if (!existsSync(join(root, 'package.json'))) return false;
      if (existsSync(join(root, 'tsconfig.json'))) return false;
      return true;
    },
    extensions: ['.mjs', '.js', '.cjs', '.jsx'],
    syntaxCheck: (file) => `node --check "${file}"`,
    typeCheck: null,
    lintCheck: null, // user can opt-in via eslint config
    buildCmd: () => 'npm run build 2>&1',
    testCmd: () => 'npm test 2>&1',
    testDirPatterns: [/test\//, /tests\//, /__tests__\//, /\.test\./, /\.spec\./],
  },

  typescript: {
    label: 'TypeScript',
    detect: (root) => existsSync(join(root, 'tsconfig.json')),
    extensions: ['.ts', '.tsx'],
    syntaxCheck: null, // tsc --noEmit covers syntax + types
    typeCheck: () => 'npx tsc --noEmit 2>&1',
    lintCheck: null,
    buildCmd: () => 'npm run build 2>&1',
    testCmd: () => 'npm test 2>&1',
    testDirPatterns: [/test\//, /tests\//, /__tests__\//, /\.test\./, /\.spec\./],
  },

  python: {
    label: 'Python',
    detect: (root) =>
      existsSync(join(root, 'pyproject.toml')) ||
      existsSync(join(root, 'requirements.txt')) ||
      existsSync(join(root, 'setup.py')),
    extensions: ['.py'],
    syntaxCheck: (file) => `python3 -m py_compile "${file}"`,
    typeCheck: null, // mypy is opt-in
    lintCheck: null, // ruff is opt-in
    buildCmd: () => 'pip install -e . 2>&1 || true',
    testCmd: () => 'python3 -m pytest 2>&1',
    testDirPatterns: [/test_/, /tests\//, /_test\.py$/, /conftest\.py$/],
  },

  java_maven: {
    label: 'Java (Maven)',
    detect: (root) => existsSync(join(root, 'pom.xml')),
    extensions: ['.java'],
    syntaxCheck: null, // javac runs inside mvn compile
    typeCheck: null,
    lintCheck: null,
    buildCmd: () => 'mvn compile -q 2>&1',
    testCmd: () => 'mvn test 2>&1',
    testDirPatterns: [/src\/test\//, /Test\.java$/, /IT\.java$/],
  },

  java_gradle: {
    label: 'Java (Gradle)',
    detect: (root) =>
      existsSync(join(root, 'build.gradle')) ||
      existsSync(join(root, 'build.gradle.kts')),
    extensions: ['.java'],
    syntaxCheck: null,
    typeCheck: null,
    lintCheck: null,
    buildCmd: () => './gradlew compileJava -q 2>&1',
    testCmd: () => './gradlew test 2>&1',
    testDirPatterns: [/src\/test\//, /Test\.java$/, /IT\.java$/],
  },

  go: {
    label: 'Go',
    detect: (root) => existsSync(join(root, 'go.mod')),
    extensions: ['.go'],
    syntaxCheck: (file) => `go vet "${file}" 2>&1`,
    typeCheck: null,
    lintCheck: null,
    buildCmd: () => 'go build ./... 2>&1',
    testCmd: () => 'go test ./... 2>&1',
    testDirPatterns: [/_test\.go$/],
  },

  rust: {
    label: 'Rust',
    detect: (root) => existsSync(join(root, 'Cargo.toml')),
    extensions: ['.rs'],
    syntaxCheck: null, // cargo check covers it
    typeCheck: null,
    lintCheck: null,
    buildCmd: () => 'cargo build 2>&1',
    testCmd: () => 'cargo test 2>&1',
    testDirPatterns: [/tests\//, /#\[test\]/],
  },

  c_cpp: {
    label: 'C/C++',
    detect: (root) =>
      existsSync(join(root, 'CMakeLists.txt')) ||
      existsSync(join(root, 'Makefile')) ||
      existsSync(join(root, 'configure')),
    extensions: ['.c', '.cpp', '.h', '.hpp'],
    syntaxCheck: (file) => {
      // Use gcc for C, g++ for C++
      const ext = extname(file);
      const compiler = (ext === '.cpp' || ext === '.hpp') ? 'g++' : 'gcc';
      return `${compiler} -fsyntax-only "${file}" 2>&1`;
    },
    typeCheck: null,
    lintCheck: null,
    buildCmd: () => {
      if (existsSync('CMakeLists.txt')) return 'cmake --build build 2>&1 || cmake -B build && cmake --build build 2>&1';
      return 'make 2>&1';
    },
    testCmd: () => 'make test 2>&1 || ctest 2>&1',
    testDirPatterns: [/test_/, /_test\./, /\/tests\//],
  },
};

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Detect which languages a project uses.
 * @param {string} projectRoot
 * @returns {string[]} Array of profile keys, e.g. ['typescript', 'python']
 */
export function detectLanguages(projectRoot) {
  const found = [];
  for (const [key, profile] of Object.entries(LANGUAGE_PROFILES)) {
    if (profile.detect(projectRoot)) {
      found.push(key);
    }
  }

  // Also detect secondary languages by scanning file extensions
  // (e.g., a JS project might have a few Python scripts)
  if (found.length === 0) {
    // No build config found — extension-based detection happens in orchestrator
  }

  return found;
}

/**
 * Get the language profile for a specific file.
 * @param {string} filePath
 * @param {string[]} projectLangs — from detectLanguages()
 * @returns {string|null} profile key
 */
export function getLanguageForFile(filePath, projectLangs) {
  const ext = extname(filePath);
  for (const lang of projectLangs) {
    const profile = LANGUAGE_PROFILES[lang];
    if (profile && profile.extensions.includes(ext)) {
      return lang;
    }
  }
  // Fallback: match by extension alone
  for (const [key, profile] of Object.entries(LANGUAGE_PROFILES)) {
    if (profile.extensions.includes(ext)) return key;
  }
  return null;
}

/**
 * Check if a file path matches any test directory pattern.
 * @param {string} filePath
 * @param {string[]} projectLangs
 * @returns {boolean}
 */
export function isTestFile(filePath, projectLangs) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const lang of projectLangs) {
    const profile = LANGUAGE_PROFILES[lang];
    if (!profile) continue;
    for (const pattern of profile.testDirPatterns) {
      if (pattern.test(normalized)) return true;
    }
  }
  // Fallback: common patterns
  return /[\/_]tests?[\/_]/.test(normalized) || /\.test\./.test(normalized) || /\.spec\./.test(normalized);
}

/**
 * Get all supported source extensions across all profiles.
 * @returns {string[]}
 */
export function getAllSourceExtensions() {
  const exts = new Set();
  for (const profile of Object.values(LANGUAGE_PROFILES)) {
    for (const ext of profile.extensions) exts.add(ext);
  }
  return [...exts];
}
