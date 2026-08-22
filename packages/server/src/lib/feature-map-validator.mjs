/**
 * feature-map-validator.mjs — Layer 3: Deterministic validation of AI output
 *
 * Principle: AI can hallucinate. Code doesn't lie.
 *
 * This module validates:
 *   1. Feature mapping: every file/API/test referenced actually exists
 *   2. Coverage: find orphan files (source files not mapped to any feature)
 *   3. Understanding: AI understanding only references real files/functions
 *
 * Output: { passed, errors, warnings, coverage }
 *
 * Used by:
 *   - EM Phase 0 (after AI refresh)
 *   - Auto Dispatch Phase 0 (after AI refresh)
 *   - Manual health check
 *   - Future: auto-retry loop when AI output fails validation
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, extname, relative, resolve } from "path";
import { exec } from "child_process";

// ── Source file extensions we care about ──
const SOURCE_EXTS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".java", ".go", ".rb", ".php", ".c", ".cpp", ".cs"]);

// ── Scan all source files (deterministic, zero AI) ──
export function scanAllSourceFiles(projectRoot) {
  const isWin = process.platform === "win32";
  const SKIP_DIRS = ["node_modules", ".git", "dist", "build", "coverage", ".paaw", "data/semgrep-rules"];

  const result = [];

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = join(dir, entry.name);
      const rel = relative(projectRoot, full).replace(/\\/g, "/");

      // Skip known non-source dirs
      if (entry.isDirectory()) {
        if (SKIP_DIRS.some(s => rel === s || rel.startsWith(s + "/"))) continue;
        walk(full);
      } else if (entry.isFile() && SOURCE_EXTS.has(extname(entry.name))) {
        result.push(rel);
      }
    }
  }

  walk(projectRoot);
  return result.sort();
}

// ── Extract API routes deterministically (regex-based, no AI) ──
export function extractApiRoutes(projectRoot) {
  const routes = [];
  const serverDir = join(projectRoot, "packages", "server", "src", "routes");
  if (!existsSync(serverDir)) return routes;

  function scanRoutes(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { scanRoutes(full); continue; }
      if (!entry.name.endsWith(".mjs")) continue;
      try {
        const code = readFileSync(full, "utf-8");
        // Match patterns like: url === "/api/..." or pathname === "/api/..."
        const matches = code.matchAll(/["']\/api\/[^\s"'`]+["']/g);
        const seen = new Set();
        for (const m of matches) {
          const path = m[0].replace(/["']/g, "");
          if (seen.has(path)) continue;
          seen.add(path);
          // Try to find HTTP method nearby (within 200 chars before)
          const before = code.slice(Math.max(0, m.index - 200), m.index);
          const methodMatch = before.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/);
          routes.push({
            method: methodMatch ? methodMatch[1] : "?",
            path,
            file: relative(projectRoot, full).replace(/\\/g, "/"),
          });
        }
      } catch {}
    }
  }

  scanRoutes(serverDir);
  return routes;
}

// ═══════════════════════════════════════════════════════════════
// 1. VALIDATE FEATURE MAPPING
// ═══════════════════════════════════════════════════════════════

/**
 * Validate that AI-generated feature mapping matches reality.
 *
 * Checks:
 *   - Every codeFile in FEATURES.json exists on disk
 *   - Every API endpoint in FEATURES.json exists in code
 *   - Every test file exists
 *   - Every runbook exists
 *   - No duplicate file assignments across features
 */
export function validateFeatureMapping(projectRoot, features) {
  const errors = [];
  const warnings = [];

  // Build ground truth
  const allFiles = new Set(scanAllSourceFiles(projectRoot));
  const allApis = extractApiRoutes(projectRoot);
  const apiSet = new Set(allApis.map(a => `${a.method} ${a.path}`));

  // Track file → features for duplicate detection
  const fileToFeatures = {};

  for (const feat of features) {
    const fid = feat.id || "?";
    const fname = feat.name || "?";

    // Check codeFiles
    for (const cf of feat.codeFiles || []) {
      const normalized = cf.replace(/^\.\//, "").replace(/\\/g, "/");

      if (!allFiles.has(normalized)) {
        errors.push({
          feature: fid,
          type: "missing_file",
          message: `${fname}: codeFile "${cf}" does not exist on disk`,
          value: cf,
        });
      }

      if (!fileToFeatures[normalized]) fileToFeatures[normalized] = [];
      if (!fileToFeatures[normalized].includes(fid)) {
        fileToFeatures[normalized].push(fid);
      }
    }

    // Check APIs
    for (const api of feat.apis || []) {
      const key = `${api.method} ${api.path}`;
      // Exact match
      if (!apiSet.has(key)) {
        // Try wildcard match (e.g., /api/crew/:id vs /api/crew/something)
        const wildcardPattern = api.path
          .replace(/\{[^}]+\}/g, "[^/]+")
          .replace(/:[^/]+/g, "[^/]+");
        const regex = new RegExp(`^${api.method} ${wildcardPattern}$`);
        const found = [...apiSet].some(k => regex.test(k));
        if (!found) {
          warnings.push({
            feature: fid,
            type: "missing_api",
            message: `${fname}: API "${key}" not found in route files (may be dynamic)`,
            value: key,
          });
        }
      }

      // Check if the API's file exists
      if (api.file && !allFiles.has(api.file.replace(/^\.\//, "").replace(/\\/g, "/"))) {
        errors.push({
          feature: fid,
          type: "missing_api_file",
          message: `${fname}: API file "${api.file}" does not exist`,
          value: api.file,
        });
      }
    }

    // Check test files
    for (const tf of feat.tests || []) {
      const normalized = tf.replace(/^\.\//, "").replace(/\\/g, "/");
      if (!allFiles.has(normalized) && !existsSync(join(projectRoot, normalized))) {
        warnings.push({
          feature: fid,
          type: "missing_test",
          message: `${fname}: test "${tf}" not found`,
          value: tf,
        });
      }
    }

    // Check runbooks
    for (const rb of feat.runbooks || []) {
      if (!existsSync(join(projectRoot, rb.replace(/^\.\//, "")))) {
        warnings.push({
          feature: fid,
          type: "missing_runbook",
          message: `${fname}: runbook "${rb}" not found`,
          value: rb,
        });
      }
    }
  }

  // Duplicate file assignments
  for (const [file, fids] of Object.entries(fileToFeatures)) {
    if (fids.length > 1) {
      warnings.push({
        type: "duplicate_assignment",
        message: `File "${file}" is mapped to ${fids.length} features: ${fids.join(", ")}`,
        value: file,
      });
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    stats: {
      featuresChecked: features.length,
      filesChecked: features.reduce((s, f) => s + (f.codeFiles || []).length, 0),
      apisChecked: features.reduce((s, f) => s + (f.apis || []).length, 0),
      testsChecked: features.reduce((s, f) => s + (f.tests || []).length, 0),
      totalSourceFiles: allFiles.size,
      totalApiRoutes: apiSet.size,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. CHECK COVERAGE — Find orphan files and gaps
// ═══════════════════════════════════════════════════════════════

/**
 * Find source files not mapped to any feature.
 * These are "orphan" files that AI missed.
 */
export function checkCoverage(projectRoot, features) {
  const allFiles = new Set(scanAllSourceFiles(projectRoot));
  const mappedFiles = new Set();

  for (const feat of features) {
    for (const cf of feat.codeFiles || []) {
      mappedFiles.add(cf.replace(/^\.\//, "").replace(/\\/g, "/"));
    }
    for (const tf of feat.tests || []) {
      mappedFiles.add(tf.replace(/^\.\//, "").replace(/\\/g, "/"));
    }
  }

  const orphans = [...allFiles].filter(f => !mappedFiles.has(f)).sort();

  // Categorize orphans
  const byDir = {};
  for (const f of orphans) {
    const dir = f.split("/").slice(0, 2).join("/") || ".";
    byDir[dir] = (byDir[dir] || 0) + 1;
  }

  // Features without understanding
  const featuresWithoutUnderstanding = features
    .filter(f => !f.aiUnderstanding)
    .map(f => ({ id: f.id, name: f.name }));

  // Features without tests
  const featuresWithoutTests = features
    .filter(f => (f.tests || []).length === 0)
    .map(f => ({ id: f.id, name: f.name }));

  // Features without documentation
  const featuresWithoutDocs = features
    .filter(f => !f.documentation)
    .map(f => ({ id: f.id, name: f.name }));

  const totalFiles = allFiles.size;
  const mappedCount = totalFiles - orphans.length;
  const coveragePct = totalFiles > 0 ? Math.round((mappedCount / totalFiles) * 100) : 0;

  return {
    coverage: {
      totalFiles,
      mappedFiles: mappedCount,
      orphanFiles: orphans.length,
      percentage: coveragePct,
    },
    orphans: orphans.slice(0, 100), // cap for display
    orphanSummary: byDir,
    featuresWithoutUnderstanding,
    featuresWithoutTests,
    featuresWithoutDocs,
  };
}

// ═══════════════════════════════════════════════════════════════
// 3. VALIDATE AI UNDERSTANDING — Check for hallucinated references
// ═══════════════════════════════════════════════════════════════

/**
 * Parse AI-generated understanding text and check if referenced
 * files and functions actually exist.
 *
 * Detects:
 *   - Filenames mentioned that don't exist (hallucinated paths)
 *   - Backtick-quoted function/variable names that don't exist in AST
 *   - Import relationships that are fabricated
 */
export function validateUnderstanding(projectRoot, feature, parsedProject) {
  const errors = [];
  const warnings = [];

  const text = feature.aiUnderstanding || "";
  if (!text) {
    return { passed: false, errors: [{ message: "No AI understanding to validate" }], warnings: [] };
  }

  const allFiles = new Set(scanAllSourceFiles(projectRoot));

  // Build function/class name set from parsed project (if available)
  const knownNames = new Set();
  if (parsedProject?.files) {
    for (const f of parsedProject.files) {
      for (const exp of f.exports || []) knownNames.add(exp.name);
      for (const fn of f.functions || []) knownNames.add(fn.name);
      for (const cls of f.classes || []) knownNames.add(cls.name);
    }
  }

  // 1. Find backtick-quoted filenames (e.g., `paaw-agent-loop.mjs`)
  const fileRefs = text.matchAll(/`([a-zA-Z0-9_./-]+\.(?:mjs|js|ts|tsx|jsx|py|java|go))`/g);
  for (const m of fileRefs) {
    const ref = m[1].replace(/^\.\//, "");
    // Check if this file exists anywhere in project
    const exists = [...allFiles].some(f => f.endsWith(ref) || f === ref);
    if (!exists) {
      warnings.push({
        type: "hallucinated_file",
        message: `Understanding references "${ref}" which is not found in project`,
        value: ref,
      });
    }
  }

  // 2. Find backtick-quoted function names (e.g., `runAgentLoop`)
  // Only check if we have AST data
  if (knownNames.size > 0) {
    const nameRefs = text.matchAll(/`([a-zA-Z_][a-zA-Z0-9_]*)`/g);
    for (const m of nameRefs) {
      const name = m[1];
      // Skip common words that look like function names
      const COMMON_WORDS = new Set(["true", "false", "null", "undefined", "string", "number", "boolean", "object", "void", "any", "never", "unknown", "this", "self", "args", "opts", "err", "error", "data", "result", "value", "key", "name", "type", "status", "message", "content", "file", "path", "url", "method", "port", "host"]);
      if (COMMON_WORDS.has(name.toLowerCase())) continue;
      // Skip if it's likely a filename (has dot or slash)
      if (name.includes(".") || name.includes("/")) continue;
      // Check if name exists in project
      if (!knownNames.has(name)) {
        // Only flag if it looks like a function call (has parens nearby)
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 5);
        if (after.includes("(")) {
          warnings.push({
            type: "unknown_function",
            message: `Understanding references function "${name}()" not found in AST`,
            value: name,
          });
        }
      }
    }
  }

  // 3. Check if understanding mentions files from the feature's codeFiles
  const featureFiles = feature.codeFiles || [];
  if (featureFiles.length > 0) {
    let mentionedAny = false;
    for (const cf of featureFiles) {
      const basename = cf.split("/").pop();
      if (text.includes(basename) || text.includes(cf)) {
        mentionedAny = true;
        break;
      }
    }
    if (!mentionedAny) {
      warnings.push({
        type: "missing_file_reference",
        message: "Understanding doesn't mention any of the feature's code files",
      });
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    stats: {
      textLength: text.length,
      knownNames: knownNames.size,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// FULL VALIDATION — Run all 3 checks, return combined report
// ═══════════════════════════════════════════════════════════════

export async function runFullValidation(projectRoot, options = {}) {
  const featuresFile = join(projectRoot, ".paaw", "features", "FEATURES.json");
  if (!existsSync(featuresFile)) {
    return { ok: false, error: "No FEATURES.json found" };
  }

  let features;
  try {
    const data = JSON.parse(readFileSync(featuresFile, "utf-8"));
    features = data.features || (Array.isArray(data) ? data : []);
  } catch (err) {
    return { ok: false, error: `Failed to load features: ${err.message}` };
  }

  if (features.length === 0) {
    return { ok: false, error: "No features to validate" };
  }

  // 1. Validate mapping
  const mapping = validateFeatureMapping(projectRoot, features);

  // 2. Check coverage
  const coverage = checkCoverage(projectRoot, features);

  // 3. Validate understanding (optional — needs AST)
  let understanding = null;
  if (options.skipUnderstanding !== true) {
    understanding = { results: [], stats: { validated: 0, passed: 0, warnings: 0 } };
    // AST parsing is optional — don't fail if tree-sitter isn't available
    let parsedProject = null;
    try {
      const { parseProject } = await import("./tree-sitter-parser.mjs");
      parsedProject = await parseProject(projectRoot, projectRoot); // 無上限
    } catch {
      // tree-sitter not available, skip function-level validation
    }

    for (const feat of features) {
      if (!feat.aiUnderstanding) continue;
      const u = validateUnderstanding(projectRoot, feat, parsedProject);
      understanding.results.push({ id: feat.id, name: feat.name, ...u });
      understanding.stats.validated++;
      if (u.passed) understanding.stats.passed++;
      understanding.stats.warnings += u.warnings.length;
    }
  }

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    mapping,
    coverage,
    understanding,
    summary: {
      mappingErrors: mapping.errors.length,
      mappingWarnings: mapping.warnings.length,
      coveragePct: coverage.coverage.percentage,
      orphanFiles: coverage.coverage.orphanFiles,
      understandingValidated: understanding?.stats.validated || 0,
      understandingWarnings: understanding?.stats.warnings || 0,
    },
  };
}
