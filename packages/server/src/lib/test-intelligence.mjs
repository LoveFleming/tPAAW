/**
 * test-intelligence.mjs — Test Intelligence for AI agents
 *
 * Answers the critical question: "If I change file X, which tests should I run?"
 *
 * Layers:
 * 1. Test Discovery — find all test files, classify by type (unit/integration/e2e)
 * 2. Test → Code Mapping — which production code each test covers
 * 3. Code → Test Reverse Map — given a production file, which tests cover it
 * 4. Feature → Tests — given a feature, which tests validate it
 * 5. Coverage Gaps — production code with no tests
 *
 * Output: .paaw/code-intelligence/test-intelligence.json
 */

import { join, basename, dirname, extname, relative, resolve } from "path";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { parseProject } from "./tree-sitter-parser.mjs";

// ── Test file patterns ──

const TEST_PATTERNS = [
  // JavaScript/TypeScript
  /^(.+)\.test\.(js|mjs|cjs|jsx|ts|tsx)$/,
  /^(.+)\.spec\.(js|mjs|cjs|jsx|ts|tsx)$/,
  /^test[_-](.+)\.(js|mjs|cjs|jsx|ts|tsx)$/,
  /^(.+)[_-]test\.(js|mjs|cjs|jsx|ts|tsx)$/,
  /^(.+)\.e2e\.(js|mjs|cjs|jsx|ts|tsx)$/,
  /^(.+)\.integration\.(js|mjs|cjs|jsx|ts|tsx)$/,
  // Python
  /^test[_-](.+)\.(py)$/,
  /^(.+)[_-]test\.(py)$/,
  // Java
  /^(.+)Test\.(java)$/,
  /^(.+)IT\.(java)$/,  // Integration test
  /^(.+)E2E\.(java)$/,
];

// ── Classify test type ──

function classifyTestType(fileName, filePath, content = "") {
  // By filename
  if (/\.e2e\./.test(fileName) || /e2e[_-]/.test(fileName) || /E2E\.java$/.test(fileName)) {
    return "e2e";
  }
  if (/\.integration\./.test(fileName) || /IT\.java$/.test(fileName) || /integration/i.test(filePath)) {
    return "integration";
  }
  if (/\.unit\./.test(fileName) || /unit/i.test(filePath)) {
    return "unit";
  }

  // By directory
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes("/e2e/") || lowerPath.includes("/__e2e__/")) return "e2e";
  if (lowerPath.includes("/integration/") || lowerPath.includes("/__integration__/")) return "integration";
  if (lowerPath.includes("/unit/") || lowerPath.includes("/__tests__/") || lowerPath.includes("/__unit__/")) return "unit";

  // By content heuristics
  const contentLower = content.toLowerCase();
  if (contentLower.includes("describe") || contentLower.includes("it(") || contentLower.includes("test(") || contentLower.includes("expect(")) {
    // Has test assertions — likely unit test by default
    return "unit";
  }

  return "unit"; // default
}

// ── Find tested functions ──

function findTestedFunctions(testFile, productionFile) {
  const tested = new Set();

  if (!testFile.functions || !productionFile.functions) return [];

  for (const testFn of testFile.functions) {
    if (!testFn.calls) continue;
    for (const call of testFn.calls) {
      const simpleName = call.callee.split(".").pop();
      // Check if this call references a production function
      if (productionFile.functions.some(f => f.name === simpleName)) {
        tested.add(simpleName);
      }
      // Also check exports
      if (productionFile.exports.some(e => e.name === simpleName)) {
        tested.add(simpleName);
      }
    }
  }

  return [...tested];
}

// ── Main: Build Test Intelligence ──

/**
 * @param {string} projectRoot
 * @param {string} paawRoot
 * @returns {Promise<{ summary: object, data: object }>}
 */
export async function buildTestIntelligence(projectRoot, paawRoot) {
  // Parse all source files (including test files)
  const parsedResult = await parseProject(projectRoot, paawRoot, {
    // 無上限（2026-08-22）
  });

  // Separate test files from production files
  const testFiles = [];
  const productionFiles = [];

  for (const file of parsedResult.files) {
    const fileName = basename(file.file);
    const isTest = TEST_PATTERNS.some(p => p.test(fileName)) ||
                   file.file.toLowerCase().includes("/test/") ||
                   file.file.toLowerCase().includes("/tests/") ||
                   file.file.toLowerCase().includes("/__tests__/");

    if (isTest) {
      const testType = classifyTestType(fileName, file.file);
      testFiles.push({ ...file, testType });
    } else {
      productionFiles.push(file);
    }
  }

  // Build test → production mapping
  const testToCode = [];
  const codeToTest = {};

  for (const testFile of testFiles) {
    const matches = [];

    // Strategy 1: Naming convention
    const testBaseName = basename(testFile.file).replace(/\.(test|spec|e2e|integration)\..*$/, "").replace(/^(test[_-]|.+(?:[_-]test|Test|IT|E2E))\..*$/, "$1");
    for (const prodFile of productionFiles) {
      const prodBaseName = basename(prodFile.file).replace(/\.(js|mjs|cjs|jsx|ts|tsx|py|java)$/, "");
      if (testBaseName === prodBaseName || testBaseName === prodBaseName.replace(/^[A-Z]/, c => c.toLowerCase())) {
        const testedFns = findTestedFunctions(testFile, prodFile);
        matches.push({
          productionFile: prodFile.file,
          matchType: "naming",
          testedFunctions: testedFns,
          confidence: "high",
        });
        // Reverse map
        if (!codeToTest[prodFile.file]) codeToTest[prodFile.file] = [];
        codeToTest[prodFile.file].push({
          testFile: testFile.file,
          testType: testFile.testType,
          testedFunctions: testedFns,
        });
      }
    }

    // Strategy 2: Import analysis
    if (matches.length === 0 && testFile.imports) {
      for (const imp of testFile.imports) {
        if (!imp.source.startsWith(".")) continue;
        const fromDir = dirname(testFile.file);
        let resolved = join(fromDir, imp.source).replace(/\\/g, "/");
        while (resolved.includes("/../")) {
          resolved = resolved.replace(/[^/]+\/\.\.\//, "");
        }
        resolved = resolved.replace(/^\.\//, "");

        for (const ext of ["", ".js", ".mjs", ".ts", ".tsx", ".jsx"]) {
          const candidate = resolved + ext;
          const prodFile = productionFiles.find(f => f.file === candidate);
          if (prodFile) {
            const testedFns = findTestedFunctions(testFile, prodFile);
            matches.push({
              productionFile: prodFile.file,
              matchType: "import",
              testedFunctions: testedFns,
              confidence: "high",
            });
            if (!codeToTest[prodFile.file]) codeToTest[prodFile.file] = [];
            codeToTest[prodFile.file].push({
              testFile: testFile.file,
              testType: testFile.testType,
              testedFunctions: testedFns,
            });
            break;
          }
        }
      }
    }

    testToCode.push({
      testFile: testFile.file,
      testType: testFile.testType,
      functionCount: testFile.functions.length,
      matches,
    });
  }

  // Build coverage gaps — production files with no tests
  const coverageGaps = productionFiles
    .filter(f => !codeToTest[f.file])
    .map(f => ({
      file: f.file,
      functionCount: f.functions.length,
      exportCount: f.exports.length,
    }))
    .sort((a, b) => b.functionCount - a.functionCount);

  // Build feature → tests mapping
  const featuresPath = join(projectRoot, ".paaw", "features", "FEATURES.json");
  const featureToTests = [];
  if (existsSync(featuresPath)) {
    try {
      const features = JSON.parse(readFileSync(featuresPath, "utf-8"));
      for (const feature of features.features || []) {
        const tests = new Set();
        for (const codeFile of (feature.codeFiles || [])) {
          const testEntries = codeToTest[codeFile];
          if (testEntries) {
            for (const entry of testEntries) {
              tests.add(entry.testFile);
            }
          }
        }
        // Also check feature test files directly
        for (const testFile of (feature.tests || [])) {
          tests.add(testFile);
        }
        if (tests.size > 0) {
          featureToTests.push({
            featureId: feature.id,
            featureName: feature.name,
            tests: [...tests],
          });
        }
      }
    } catch {}
  }

  // Build "what to run" map: given a changed file, which tests to run
  const whatToRun = {};
  for (const [prodFile, testEntries] of Object.entries(codeToTest)) {
    whatToRun[prodFile] = testEntries.map(t => ({
      testFile: t.testFile,
      testType: t.testType,
      reason: `Tests ${t.testedFunctions.length > 0 ? `covering: ${t.testedFunctions.join(", ")}` : "this file"}`,
    }));
  }

  // Stats
  const stats = {
    totalTestFiles: testFiles.length,
    byType: {
      unit: testFiles.filter(t => t.testType === "unit").length,
      integration: testFiles.filter(t => t.testType === "integration").length,
      e2e: testFiles.filter(t => t.testType === "e2e").length,
    },
    totalMappings: testToCode.reduce((s, t) => s + t.matches.length, 0),
    coverageGapFiles: coverageGaps.length,
    coverageRate: productionFiles.length > 0
      ? `${((1 - coverageGaps.length / productionFiles.length) * 100).toFixed(1)}%`
      : "N/A",
    featureTestCoverage: featureToTests.length,
  };

  const data = {
    testFiles: testFiles.map(t => ({
      file: t.file,
      type: t.testType,
      functionCount: t.functions.length,
      functionNames: t.functions.map(f => f.name).slice(0, 20),
    })),
    testToCode,
    codeToTest,
    whatToRun,
    coverageGaps,
    featureToTests,
    stats,
  };

  // Save
  const ciDir = join(projectRoot, ".paaw", "code-intelligence");
  if (!existsSync(ciDir)) {
    import("fs").then(fs => fs.mkdirSync(ciDir, { recursive: true }));
  } else {
    // ciDir already exists from code-intelligence.mjs
  }
  // Ensure dir
  try { 
    const fs = await import("fs");
    if (!fs.existsSync(ciDir)) fs.mkdirSync(ciDir, { recursive: true });
    fs.writeFileSync(join(ciDir, "test-intelligence.json"), JSON.stringify(data, null, 2), "utf-8");
  } catch {}

  return { summary: stats, data };
}
