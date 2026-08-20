#!/usr/bin/env node
/**
 * runtime-guard-scanner.mjs
 *
 * Scans .tsx/.ts files for two classes of runtime bugs:
 *
 * 1. TDZ — variable used before its declaration line
 *    Pattern: identifier referenced (use, useRef, useState arg) above its
 *    const/let declaration in the same file scope.
 *
 * 2. Null-iterable — for...of / .map() / .filter() / .forEach() / .reduce()
 *    called on a value that might be null/undefined without Array.isArray
 *    or optional chaining guard.
 *
 * Usage:
 *   node runtime-guard-scanner.mjs <dir> [--fix-hints]
 *
 * Output: list of findings with file:line and reason.
 * Exit code: 0 = clean, 1 = findings found
 */

import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative } from "path";

const ROOT = process.argv[2] || ".";
const VERBOSE = process.argv.includes("--verbose");
const FIX_HINTS = process.argv.includes("--fix-hints");

// ── File discovery ──
function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules" || name === "dist" || name === "build") continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (/\.[jt]sx?$/.test(name)) acc.push(full);
  }
  return acc;
}

// ── TDZ Detection ──
// Strategy: find all `const X = ...` / `let X = ...` / `var X = ...` declarations,
// then check if X appears on an earlier line (excluding import statements).
// For useRef(X) / useState(X) specifically, we flag if X is declared later.

function scanTDZ(filePath, src) {
  const lines = src.split("\n");
  const findings = [];

  // Collect declaration line numbers: name → first decl line
  const decls = new Map(); // varName → lineNum (1-indexed)
  const declRegex = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip import lines
    if (line.trim().startsWith("import ")) continue;
    // Skip comments
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

    let m;
    declRegex.lastIndex = 0;
    while ((m = declRegex.exec(line)) !== null) {
      const name = m[1];
      if (!decls.has(name)) decls.set(name, i + 1); // first declaration wins
    }
  }

  // Now scan for usage of each declared variable before its declaration line
  // Focus on: useRef(X), useState(X), and direct references in expressions
  for (const [name, declLine] of decls) {
    for (let i = 0; i < declLine - 1; i++) {
      const line = lines[i];
      if (line.trim().startsWith("import ")) continue;
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

      // Check for useRef(name) or useState(name) — the exact bug pattern
      const useRefPattern = new RegExp(`\\buseRef\\(${name}\\b`);
      const useStatePattern = new RegExp(`\\buseState\\(${name}\\b`);
      const directRefPattern = new RegExp(`\\b${name}\\b`);

      if (useRefPattern.test(line) || useStatePattern.test(line)) {
        findings.push({
          type: "TDZ",
          file: filePath,
          line: i + 1,
          declLine,
          varName: name,
          reason: `useRef/useState(${name}) on line ${i+1}, but ${name} is declared on line ${declLine}`,
          hint: FIX_HINTS ? `Move the useRef/useState to after line ${declLine}` : undefined,
        });
        break; // one finding per var is enough
      }
    }
  }

  return findings;
}

// ── Null-iterable Detection ──
// Pattern: for (const X of EXPR) or EXPR.map/filter/forEach/reduce/flatMap/entries()
// where EXPR is a property access (a.b.c) without Array.isArray guard or ?. guard
// in the same function scope.

function scanNullIterable(filePath, src) {
  const lines = src.split("\n");
  const findings = [];

  // Patterns to check:
  // 1. for (const X of EXPR) — EXPR should be guarded
  // 2. EXPR.map(...) / .filter(...) / .forEach(...) / .reduce(...) / .flatMap(...)
  // We focus on property-access EXPRs (e.g., gitStatus.staged) that lack guards.

  const iterMethods = ["map", "filter", "forEach", "reduce", "flatMap", "entries", "keys", "values", "some", "every", "find", "findIndex"];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // ── Pattern 1: for...of ──
    // for (const X of a.b.c) → check if a.b.c has guard
    const forOfMatch = line.match(/for\s*\(\s*(?:const|let)\s+\w+\s+of\s+(.+?)\s*\)/);
    if (forOfMatch) {
      const expr = forOfMatch[1].trim();
      // Skip if it's a simple variable (likely fine) or already has Array.isArray nearby
      if (expr.includes(".") && !expr.includes("?.") && !expr.includes("Array.isArray")) {
        // Check surrounding 5 lines for Array.isArray guard
        const context = lines.slice(Math.max(0, i - 5), i + 5).join(" ");
        if (!context.includes("Array.isArray")) {
          findings.push({
            type: "NULL_ITERABLE",
            file: filePath,
            line: lineNum,
            expr,
            reason: `for...of on "${expr}" without Array.isArray guard`,
            hint: FIX_HINTS ? `Add: const safe = Array.isArray(${expr}) ? ${expr} : [];` : undefined,
          });
        }
      }
    }

    // ── Pattern 2: .map() / .filter() / etc on property access ──
    // gitStatus.staged.filter(...) → flagged if no guard
    for (const method of iterMethods) {
      // Match: EXPR.method( where EXPR contains a dot (property access)
      const regex = new RegExp(`(\\w+\\.\\w+(?:\\.\\w+)*)\\.${method}\\(`);
      const m = line.match(regex);
      if (m) {
        const expr = m[1];
        // Skip if already guarded nearby
        const context = lines.slice(Math.max(0, i - 3), i + 3).join(" ");
        if (context.includes("Array.isArray") || context.includes(`${expr}?.`) || context.includes(`${expr} ||`)) {
          continue;
        }
        // Skip if it's a known-safe pattern (e.g., imported array, useState result)
        // We only flag property-access chains
        findings.push({
          type: "NULL_ITERABLE",
          file: filePath,
          line: lineNum,
          expr,
          method,
          reason: `.${method}() on "${expr}" without null/Array.isArray guard`,
          hint: FIX_HINTS ? `Guard: (Array.isArray(${expr}) ? ${expr} : []).${method}(...)` : undefined,
        });
      }
    }
  }

  return findings;
}

// ── Main ──
const files = walk(ROOT);
let totalFindings = 0;
const results = [];

for (const file of files) {
  let src;
  try { src = readFileSync(file, "utf-8"); } catch { continue; }

  const rel = relative(process.cwd(), file);
  const tdz = scanTDZ(rel, src);
  const nullIter = scanNullIterable(rel, src);

  if (tdz.length || nullIter.length) {
    results.push({ file: rel, tdz, nullIter });
    totalFindings += tdz.length + nullIter.length;
  }
}

// ── Report ──
if (results.length === 0) {
  console.log("✅ No TDZ or null-iterable issues found.");
  process.exit(0);
}

console.log(`\n🔍 Runtime Guard Scanner — ${totalFindings} finding(s) in ${results.length} file(s)\n`);

for (const { file, tdz, nullIter } of results) {
  if (tdz.length) {
    console.log(`━━━ TDZ (used before declaration) ━━━`);
    for (const f of tdz) {
      console.log(`  ${f.file}:${f.line}  ${f.varName}  ← declared at line ${f.declLine}`);
      console.log(`    ${f.reason}`);
      if (f.hint) console.log(`    💡 ${f.hint}`);
    }
  }
  if (nullIter.length) {
    console.log(`━━━ NULL_ITERABLE (unguarded .method on property access) ━━━`);
    for (const f of nullIter) {
      console.log(`  ${f.file}:${f.line}  ${f.expr}.${f.method}()`);
      console.log(`    ${f.reason}`);
      if (f.hint) console.log(`    💡 ${f.hint}`);
    }
  }
  console.log("");
}

console.log(`Total: ${totalFindings} finding(s)`);
process.exit(1);
