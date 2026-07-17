/**
 * dependency-context.mjs — Pre-edit dependency injection for AI agents
 *
 * When an AI agent is about to modify a file, this module:
 * 1. Looks up the file in Code Intelligence data
 * 2. Finds who imports/depends on this file (importedBy)
 * 3. Finds who calls functions defined in this file (callersOf)
 * 4. Returns a structured context string the AI can use
 *    to understand the impact of its changes
 *
 * This prevents "改東壞西" (fix one thing, break another)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Load code intelligence data from .paaw/code-intelligence/
 */
function _loadCI(cwd) {
  const ciDir = join(cwd, ".paaw", "code-intelligence");
  const data = {
    callGraph: null,
    depGraph: null,
    fileMap: null,
    testCodeMap: null,
  };

  try {
    const cgPath = join(ciDir, "call-graph.json");
    if (existsSync(cgPath)) data.callGraph = JSON.parse(readFileSync(cgPath, "utf-8"));
  } catch {}
  try {
    const dgPath = join(ciDir, "dependency-graph.json");
    if (existsSync(dgPath)) data.depGraph = JSON.parse(readFileSync(dgPath, "utf-8"));
  } catch {}
  try {
    const fmPath = join(ciDir, "file-map.json");
    if (existsSync(fmPath)) data.fileMap = JSON.parse(readFileSync(fmPath, "utf-8"));
  } catch {}
  try {
    const tcPath = join(ciDir, "test-code-map.json");
    if (existsSync(tcPath)) data.testCodeMap = JSON.parse(readFileSync(tcPath, "utf-8"));
  } catch {}

  return data;
}

/**
 * Get dependency context for a file about to be modified.
 * Returns a structured string the AI can use to understand impact.
 *
 * @param {string} cwd - Project root
 * @param {string} filePath - File about to be modified (relative or absolute)
 * @returns {string} Context string, or empty string if no data
 */
export function getDependencyContext(cwd, filePath) {
  const ci = _loadCI(cwd);
  if (!ci.callGraph && !ci.depGraph) return "";

  // Normalize path: make relative to cwd
  const normPath = filePath.replace(cwd + "/", "").replace(cwd + "\\", "").replace(/^\//, "");

  const parts = [];

  // ── 1. File-level dependents (who imports this file) ──
  if (ci.depGraph?.files?.[normPath]) {
    const fileInfo = ci.depGraph.files[normPath];
    const importedBy = fileInfo.importedBy || [];
    const exports = fileInfo.exports || [];

    if (importedBy.length > 0) {
      parts.push(`📂 誰依賴這個檔案（改這裡會影響它們）：`);
      for (const dep of importedBy.slice(0, 20)) {
        parts.push(`  → ${dep}`);
      }
      if (importedBy.length > 20) {
        parts.push(`  ... 還有 ${importedBy.length - 20} 個`);
      }
    }

    if (exports.length > 0) {
      parts.push(`📤 這個檔案 export 了什麼（其他檔案可能用到）：`);
      for (const exp of exports.slice(0, 15)) {
        const name = typeof exp === "string" ? exp : exp.name;
        parts.push(`  → ${name}`);
      }
    }
  }

  // ── 2. Function-level callers (who calls functions defined in this file) ──
  if (ci.callGraph?.callersOf) {
    const callersOf = ci.callGraph.callersOf;
    // Find all entries where the function belongs to this file
    const relevantCallers = Object.entries(callersOf)
      .filter(([funcId]) => funcId.startsWith(normPath + ":"))
      .slice(0, 30);

    if (relevantCallers.length > 0) {
      parts.push(`🔗 誰呼叫了這個檔案的 functions：`);
      for (const [funcId, callers] of relevantCallers) {
        const funcName = funcId.split(":").pop();
        const callerList = callers.slice(0, 8).map(c => {
          const cFile = c.split(":").slice(0, -1).join(":");
          const cName = c.split(":").pop();
          return `${cName}() in ${cFile}`;
        });
        parts.push(`  ${funcName}() ← ${callerList.join(", ")}${callers.length > 8 ? ` ... +${callers.length - 8} more` : ""}`);
      }
    }
  }

  // ── 3. What this file imports (what it depends on) ──
  if (ci.depGraph?.files?.[normPath]) {
    const fileInfo = ci.depGraph.files[normPath];
    const imports = fileInfo.imports || [];
    const internalImports = imports.filter(imp => imp.targetFile);

    if (internalImports.length > 0) {
      parts.push(`📥 這個檔案依賴了誰（改它們也要小心）：`);
      for (const imp of internalImports.slice(0, 15)) {
        const names = (imp.names || []).slice(0, 5).join(", ");
        parts.push(`  → ${imp.targetFile}${names ? ` (${names})` : ""}`);
      }
    }
  }

  // ── 4. Related test files ──
  if (ci.testCodeMap) {
    const tcMap = ci.testCodeMap;
    // testCodeMap might have: sourceFile → testFiles mapping
    const testFiles = tcMap[normPath] || tcMap.sourceToTest?.[normPath] || [];

    if (testFiles.length > 0) {
      parts.push(`🧪 相關測試檔案（改完建議跑這些）：`);
      for (const tf of testFiles.slice(0, 10)) {
        parts.push(`  → ${typeof tf === "string" ? tf : tf.file || tf.path}`);
      }
    }
  }

  if (parts.length === 0) return "";

  return [
    `⚠️ 【改動影響分析】你要修改的 ${normPath} 有以下依賴關係，改之前請確認不會破壞：`,
    "",
    ...parts,
    "",
    "💡 建議：修改後檢查以上列出的檔案，確認功能正常。",
  ].join("\n");
}

/**
 * Get affected test files for a list of changed files.
 * Used for post-edit verification.
 *
 * @param {string} cwd - Project root
 * @param {string[]} changedFiles - List of changed file paths (relative)
 * @returns {string[]} List of test files that should be run
 */
export function getAffectedTests(cwd, changedFiles) {
  const ci = _loadCI(cwd);
  const testFiles = new Set();

  for (const filePath of changedFiles) {
    const normPath = filePath.replace(cwd + "/", "").replace(cwd + "\\", "").replace(/^\//, "");

    // Direct test mapping
    if (ci.testCodeMap) {
      const tcMap = ci.testCodeMap;
      const tests = tcMap[normPath] || tcMap.sourceToTest?.[normPath] || [];
      for (const t of tests) {
        testFiles.add(typeof t === "string" ? t : t.file || t.path);
      }
    }

    // Also check dependents — if we changed an imported file, tests for importers might break too
    if (ci.depGraph?.files?.[normPath]) {
      const importedBy = ci.depGraph.files[normPath].importedBy || [];
      for (const dep of importedBy) {
        if (ci.testCodeMap) {
          const tcMap = ci.testCodeMap;
          const depTests = tcMap[dep] || tcMap.sourceToTest?.[dep] || [];
          for (const t of depTests) {
            testFiles.add(typeof t === "string" ? t : t.file || t.path);
          }
        }
      }
    }

    // Convention-based: find test files that match the changed file name
    const basename = normPath.replace(/\.\w+$/, "");
    const testPatterns = [
      `${basename}.test.`,
      `${basename}.spec.`,
      `${basename}_test.`,
      normPath.replace("/src/", "/test/").replace(/\.\w+$/, `.test.`),
    ];
    // We'll just note these — actual file existence check would be done by the runner
  }

  return [...testFiles].filter(Boolean);
}

/**
 * Get a concise impact summary for a file modification.
 * Shorter version of getDependencyContext for quick injection into system prompt.
 *
 * @param {string} cwd - Project root
 * @param {string} filePath - File about to be modified
 * @returns {{ importedBy: string[], callers: { func: string, callers: string[] }[], testFiles: string[] }}
 */
export function getImpactSummary(cwd, filePath) {
  const ci = _loadCI(cwd);
  const normPath = filePath.replace(cwd + "/", "").replace(cwd + "\\", "").replace(/^\//, "");

  const result = {
    importedBy: [],
    callers: [],
    testFiles: [],
  };

  if (ci.depGraph?.files?.[normPath]) {
    result.importedBy = ci.depGraph.files[normPath].importedBy || [];
  }

  if (ci.callGraph?.callersOf) {
    const relevantCallers = Object.entries(ci.callGraph.callersOf)
      .filter(([funcId]) => funcId.startsWith(normPath + ":"))
      .slice(0, 20);
    for (const [funcId, callers] of relevantCallers) {
      result.callers.push({
        func: funcId.split(":").pop(),
        callers: callers.slice(0, 5),
      });
    }
  }

  if (ci.testCodeMap) {
    const tcMap = ci.testCodeMap;
    const tests = tcMap[normPath] || tcMap.sourceToTest?.[normPath] || [];
    result.testFiles = tests.map(t => typeof t === "string" ? t : t.file || t.path).filter(Boolean);
  }

  return result;
}
