/**
 * code-intelligence.mjs — Deterministic Code Intelligence for AI agents
 *
 * Builds structured, queryable data from Tree-sitter AST analysis:
 * 1. Call Graph: function → function call relationships
 * 2. API → Function Chain: route → handler → callee chain
 * 3. Dependency Graph: file → file import relationships
 * 4. Test → Code Map: test file → production code mappings
 * 5. Symbol Index: all symbols (functions, classes, exports) across project
 *
 * Output: JSON files in .paaw/code-intelligence/
 *
 * This is the "Code Context Package" that AI agents consume when:
 * - Taking over development tasks
 * - Debugging ("which functions are involved in this feature?")
 * - Refactoring ("what calls this function? what breaks if I change it?")
 * - Code review ("what tests cover this code?")
 */

import { resolve, join, extname, basename, relative, dirname } from "path";
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { diffWriteJson } from "./stable-hash.mjs";
import { parseProject, formatForAI } from "./tree-sitter-parser.mjs";

// ── 1. Call Graph ──

/**
 * Build a call graph from parsed project data
 * Nodes: functions (file:name)
 * Edges: caller → callee
 */
export function buildCallGraph(parsedResult) {
  const nodes = [];
  const edges = [];
  const nodeSet = new Set(); // dedup

  for (const file of parsedResult.files) {
    for (const fn of file.functions) {
      const nodeId = `${file.file}:${fn.name}`;
      if (!nodeSet.has(nodeId)) {
        nodeSet.add(nodeId);
        nodes.push({
          id: nodeId,
          name: fn.name,
          file: file.file,
          line: 0, // Tree-sitter doesn't give us line numbers easily in this format
          kind: fn.kind,
          async: fn.async || false,
        });
      }

      // Add edges from calls
      if (fn.calls) {
        for (const call of fn.calls) {
          const calleeId = resolveCallTarget(call.callee, file, parsedResult);
          if (calleeId) {
            edges.push({
              caller: nodeId,
              callee: calleeId,
              type: call.type,
            });
          } else {
            // Unresolved call — still record the raw callee name
            edges.push({
              caller: nodeId,
              callee: call.callee,
              type: call.type,
              resolved: false,
            });
          }
        }
      }
    }

    // Also extract calls from class methods
    for (const cls of file.classes) {
      // Class-level calls would need method bodies — we already capture
      // them if methods are also in file.functions (Java case)
    }
  }

  // Build reverse index: callee → callers (who calls me?)
  const callersOf = {};
  for (const edge of edges) {
    if (!callersOf[edge.callee]) callersOf[edge.callee] = [];
    callersOf[edge.callee].push(edge.caller);
  }

  // Build forward index: caller → callees (who do I call?)
  const calleesOf = {};
  for (const edge of edges) {
    if (!calleesOf[edge.caller]) calleesOf[edge.caller] = [];
    calleesOf[edge.caller].push(edge.callee);
  }

  return {
    nodes,
    edges,
    callersOf,    // callee → [callers]
    calleesOf,    // caller → [callees]
    stats: {
      totalFunctions: nodes.length,
      totalCalls: edges.length,
      resolvedCalls: edges.filter(e => e.resolved !== false).length,
      unresolvedCalls: edges.filter(e => e.resolved === false).length,
    },
  };
}

/**
 * Try to resolve a call expression to a specific function
 * Strategies:
 * 1. Direct call: foo() → search all files for function named "foo"
 * 2. Method call: obj.method() → search for method in class/file that exports "obj"
 * 3. Imported call: importedFn() → search import sources
 */
function resolveCallTarget(calleeName, currentFile, parsedResult) {
  // Strip method receiver for resolution attempt
  // e.g., "this.foo" → "foo", "self.bar" → "bar"
  const parts = calleeName.split(".");
  const simpleName = parts.length > 1 ? parts[parts.length - 1] : calleeName;

  // Strategy 1: Look for a function with this name in the same file
  const sameFileFn = currentFile.functions.find(f => f.name === simpleName);
  if (sameFileFn) {
    return `${currentFile.file}:${simpleName}`;
  }

  // Strategy 2: Look in imported files
  for (const imp of currentFile.imports) {
    // Find the file that matches this import source
    const targetFile = resolveImportPath(imp.source, currentFile.file, parsedResult);
    if (targetFile) {
      // Check if the imported name matches
      for (const name of imp.names) {
        const cleanName = name.replace(/^.* as /, "");
        if (cleanName === simpleName) {
          // Check if target file has this function
          const targetFn = targetFile.functions.find(f => f.name === simpleName);
          if (targetFn) {
            return `${targetFile.file}:${simpleName}`;
          }
          // Check if it's an exported function
          const targetExp = targetFile.exports.find(e => e.name === simpleName);
          if (targetExp) {
            return `${targetFile.file}:${simpleName}`;
          }
        }
      }
    }
  }

  // Strategy 3: Search all files for a uniquely named function
  const matches = [];
  for (const file of parsedResult.files) {
    if (file.functions.some(f => f.name === simpleName)) {
      matches.push(`${file.file}:${simpleName}`);
    }
    if (file.exports.some(e => e.name === simpleName)) {
      matches.push(`${file.file}:${simpleName}`);
    }
  }
  // Only resolve if exactly one match (avoid ambiguity)
  if (matches.length === 1) {
    return matches[0];
  }

  return null; // unresolved
}

/**
 * Resolve an import source path to a file in the parsed results
 */
function resolveImportPath(source, fromFile, parsedResult) {
  // Relative imports: ./foo, ../bar
  if (source.startsWith(".")) {
    const fromDir = dirname(fromFile);
    // Resolve relative to project root (not absolute path)
    // fromFile is like "packages/server/src/routes/chat.mjs"
    // fromDir is "packages/server/src/routes"
    // source "../lib/llm-utils.mjs" → "packages/server/src/lib/llm-utils.mjs"
    let resolved = join(fromDir, source).replace(/\\/g, "/");
    // Normalize ../
    while (resolved.includes("/../")) {
      resolved = resolved.replace(/[^/]+\/\.\.\//, "");
    }
    resolved = resolved.replace(/^\.\//, "");

    // Try with extensions
    for (const ext of ["", ".js", ".mjs", ".ts", ".tsx", ".jsx", "/index.js", "/index.mjs", "/index.ts"]) {
      const candidate = resolved + ext;
      const found = parsedResult.files.find(f => f.file === candidate);
      if (found) return found;
    }
  }

  // Absolute/package imports — try to match by package name
  // e.g., "@paaw/db" → packages/db/src/index.ts
  if (source.startsWith("@paaw/")) {
    const pkgName = source.replace("@paaw/", "");
    const candidates = [
      `packages/${pkgName}/src/index.ts`,
      `packages/${pkgName}/src/index.mjs`,
      `packages/${pkgName}/index.ts`,
    ];
    for (const c of candidates) {
      const found = parsedResult.files.find(f => f.file === c);
      if (found) return found;
    }
  }

  return null;
}

// ── 2. API → Function Chain ──

/**
 * Build API → Function chain map
 * For each route, trace: route → handler → callees
 */
export function buildApiFunctionMap(parsedResult, callGraph) {
  const routes = [];

  for (const file of parsedResult.files) {
    for (const route of file.routes) {
      const routeEntry = {
        method: route.method,
        path: route.path,
        file: file.file,
        handler: "",
        callChain: [],
      };

      // Try to find the handler function
      // For PAAW-style routes (if method === "POST" && path === "/api/chat"),
      // the handler is the code inside the if block
      // For Express-style (router.post('/path', handler)),
      // the handler is the second argument

      // Find functions in the same file that are likely handlers
      // Heuristic: functions that contain calls matching route handling patterns
      const handlerCandidates = file.functions.filter(fn => {
        if (!fn.calls) return false;
        // Look for typical handler calls: res.json, res.send, res.writeHead, etc.
        return fn.calls.some(c =>
          c.callee.includes("res.") ||
          c.callee.includes("response.") ||
          c.callee.includes("reply.") ||
          c.callee.includes("next(") ||
          c.callee.includes("sendSSE") ||
          c.callee.includes("writeFile") ||
          c.callee.includes("readFile")
        );
      });

      if (handlerCandidates.length > 0) {
        // Pick the most likely handler (most calls = most logic)
        const handler = handlerCandidates.sort((a, b) =>
          (b.calls?.length || 0) - (a.calls?.length || 0)
        )[0];
        routeEntry.handler = handler.name;

        // Build call chain from handler
        const handlerId = `${file.file}:${handler.name}`;
        routeEntry.callChain = traceCallChain(handlerId, callGraph, new Set(), 5);
      }

      routes.push(routeEntry);
    }
  }

  return {
    routes,
    stats: {
      totalRoutes: routes.length,
      withHandler: routes.filter(r => r.handler).length,
      withoutHandler: routes.filter(r => !r.handler).length,
    },
  };
}

/**
 * Trace call chain from a function, up to maxDepth
 * Returns array of { function, depth, file }
 */
function traceCallChain(funcId, callGraph, visited, maxDepth) {
  if (visited.has(funcId) || maxDepth <= 0) return [];
  visited.add(funcId);

  const chain = [];
  const callees = callGraph.calleesOf[funcId] || [];

  for (const callee of callees) {
    // Skip external/unresolved calls
    if (!callee.includes(":")) {
      chain.push({ function: callee, depth: maxDepth, file: "", resolved: false });
      continue;
    }

    const [file, name] = callee.split(":");
    chain.push({ function: name, depth: 5 - maxDepth, file, resolved: true });

    // Recurse
    const subChain = traceCallChain(callee, callGraph, visited, maxDepth - 1);
    chain.push(...subChain);
  }

  return chain;
}

// ── 3. Dependency Graph ──

/**
 * Build file-level dependency graph from imports/exports
 */
export function buildDependencyGraph(parsedResult) {
  const files = {};
  const edges = [];

  for (const file of parsedResult.files) {
    const fileId = file.file;
    if (!files[fileId]) {
      files[fileId] = {
        path: fileId,
        language: file.language,
        imports: [],
        importedBy: [],
        exports: file.exports.map(e => e.name),
      };
    }

    for (const imp of file.imports) {
      const targetFile = resolveImportPath(imp.source, file.file, parsedResult);
      const targetPath = targetFile ? targetFile.file : imp.source;

      files[fileId].imports.push({
        source: imp.source,
        resolved: !!targetFile,
        targetFile: targetFile ? targetFile.file : null,
        names: imp.names,
      });

      if (targetFile) {
        // Add reverse edge
        if (!files[targetFile.file]) {
          files[targetFile.file] = {
            path: targetFile.file,
            language: targetFile.language,
            imports: [],
            importedBy: [],
            exports: targetFile.exports.map(e => e.name),
          };
        }
        files[targetFile.file].importedBy.push({
          source: file.file,
          names: imp.names,
        });

        edges.push({ from: fileId, to: targetFile.file, names: imp.names });
      }
    }
  }

  return {
    files,
    edges,
    stats: {
      totalFiles: Object.keys(files).length,
      totalEdges: edges.length,
      resolvedImports: edges.length,
      unresolvedImports: Object.values(files).reduce(
        (sum, f) => sum + f.imports.filter(i => !i.resolved).length, 0
      ),
    },
  };
}

// ── 4. Test → Code Map ──

/**
 * Map test files to production code they test
 * Strategies:
 * 1. Naming: foo.test.ts → foo.ts, foo.spec.js → foo.js
 * 2. Import analysis: test file imports production file
 * 3. Pattern: *.test.*, *.spec.*, test_*, *_test.*
 */
export function buildTestCodeMap(parsedResult) {
  const mappings = [];

  const TEST_PATTERNS = [
    /^(.+)\.test\.(js|mjs|cjs|jsx|ts|tsx)$/,
    /^(.+)\.spec\.(js|mjs|cjs|jsx|ts|tsx)$/,
    /^test[_-](.+)\.(js|mjs|cjs|jsx|ts|tsx|py|java|go)$/,
    /^(.+)[_-]test\.(js|mjs|cjs|jsx|ts|tsx|py|java|go)$/,
  ];

  for (const file of parsedResult.files) {
    const fileName = basename(file.file);
    let productionFile = null;
    let matchType = null;

    // Strategy 1: Naming convention
    for (const pattern of TEST_PATTERNS) {
      const match = fileName.match(pattern);
      if (match) {
        const baseName = match[1];
        // Find production file with this base name
        for (const ext of [".js", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".java", ".go"]) {
          const candidate = join(dirname(file.file), baseName + ext);
          const found = parsedResult.files.find(f => f.file === candidate);
          if (found) {
            productionFile = found;
            matchType = "naming";
            break;
          }
        }
        if (productionFile) break;
      }
    }

    // Strategy 2: Import analysis
    if (!productionFile && file.imports.length > 0) {
      for (const imp of file.imports) {
        if (!imp.source.startsWith(".")) continue;
        const target = resolveImportPath(imp.source, file.file, parsedResult);
        if (target && !target.file.includes(".test.") && !target.file.includes(".spec.")) {
          productionFile = target;
          matchType = "import";
          break;
        }
      }
    }

    // Strategy 2.5: Go package 慣例 — *_test.go 測同目錄同 package
    if (!productionFile && /_test\.go$/.test(fileName)) {
      const base = fileName.replace(/_test\.go$/, "");
      const dir = dirname(file.file);
      // 2.5a: 同名 base.go（Go 慣例 foo_test.go ↔ foo.go）
      const exact = parsedResult.files.find(f => f.file === join(dir, base + ".go").replace(/\\/g, "/"));
      if (exact) {
        productionFile = exact;
        matchType = "naming";
      } else {
        // 2.5b: 同目錄其他 .go — 只挑有叫用交集的（evidence-based，避免誤配）
        const dirFiles = parsedResult.files.filter(f => dirname(f.file) === dir && f.file.endsWith(".go") && !/_test\.go$/.test(f.file));
        const called = new Set();
        for (const fn of file.functions) {
          for (const c of fn.calls || []) called.add(c.callee.split(".").pop());
        }
        const shared = dirFiles.filter(df => df.functions.some(f => called.has(f.name)));
        if (shared.length >= 1) {
          for (const df of shared) {
            const testedFunctions = [...called].filter(n => df.functions.some(f => f.name === n));
            mappings.push({ testFile: file.file, productionFile: df.file, matchType: "package", testedFunctions, testCount: file.functions.length });
          }
          productionFile = null; // 已手動 push，跳過底下單檔 push
          continue;
        }
      }
    }

    if (productionFile) {
      const testedFunctions = [];
      for (const fn of file.functions) {
        if (!fn.calls) continue;
        // Check if test function references production functions
        for (const call of fn.calls) {
          const simpleName = call.callee.split(".").pop();
          if (productionFile.functions.some(f => f.name === simpleName)) {
            if (!testedFunctions.includes(simpleName)) {
              testedFunctions.push(simpleName);
            }
          }
        }
      }

      mappings.push({
        testFile: file.file,
        productionFile: productionFile.file,
        matchType,
        testedFunctions,
        testCount: file.functions.length,
      });
    }
  }

  return {
    mappings,
    stats: {
      totalTestFiles: parsedResult.files.filter(f =>
        TEST_PATTERNS.some(p => p.test(basename(f.file)))
      ).length,
      matchedTests: mappings.length,
      totalTestedFunctions: mappings.reduce((s, m) => s + m.testedFunctions.length, 0),
    },
  };
}

// ── 5. Symbol Index ──

/**
 * Build a flat symbol index for fast lookup
 * Agents can query: "find function X" or "find class Y"
 */
export function buildSymbolIndex(parsedResult) {
  const symbols = [];

  for (const file of parsedResult.files) {
    for (const fn of file.functions) {
      symbols.push({
        type: "function",
        name: fn.name,
        file: file.file,
        kind: fn.kind,
        async: fn.async || false,
        params: fn.params,
        callCount: fn.calls?.length || 0,
      });
    }
    for (const cls of file.classes) {
      symbols.push({
        type: "class",
        name: cls.name,
        file: file.file,
        methods: cls.methods,
      });
    }
    for (const exp of file.exports) {
      symbols.push({
        type: "export",
        name: exp.name,
        file: file.file,
        kind: exp.kind,
        isDefault: exp.isDefault,
      });
    }
    for (const route of file.routes) {
      symbols.push({
        type: "route",
        name: `${route.method} ${route.path}`,
        file: file.file,
        method: route.method,
        path: route.path,
      });
    }
    for (const comp of file.components) {
      symbols.push({
        type: "component",
        name: comp.name,
        file: file.file,
        kind: comp.kind,
      });
    }
  }

  // Build name → symbols index
  const byName = {};
  for (const sym of symbols) {
    if (!byName[sym.name]) byName[sym.name] = [];
    byName[sym.name].push(sym);
  }

  return {
    symbols,
    byName,
    stats: {
      total: symbols.length,
      functions: symbols.filter(s => s.type === "function").length,
      classes: symbols.filter(s => s.type === "class").length,
      exports: symbols.filter(s => s.type === "export").length,
      routes: symbols.filter(s => s.type === "route").length,
      components: symbols.filter(s => s.type === "component").length,
    },
  };
}

// ── 6. Full Code Intelligence Builder ──

/**
 * Run full code intelligence analysis and save to .paaw/code-intelligence/
 *
 * @param {string} projectRoot - project root
 * @param {string} paawRoot - PAAW installation root
 * @returns {Promise<{ stats: object, files: string[] }>}
 */
export async function buildCodeIntelligence(projectRoot, paawRoot) {
  // Parse all source files
  const parsedResult = await parseProject(projectRoot, paawRoot); // 無上限（2026-08-22 Fleming 要求）

  // Build all intelligence layers
  const callGraph = buildCallGraph(parsedResult);
  const apiFunctionMap = buildApiFunctionMap(parsedResult, callGraph);
  const dependencyGraph = buildDependencyGraph(parsedResult);
  const testCodeMap = buildTestCodeMap(parsedResult);
  const symbolIndex = buildSymbolIndex(parsedResult);

  // Save to .paaw/code-intelligence/
  const ciDir = join(projectRoot, ".paaw", "code-intelligence");
  if (!existsSync(ciDir)) mkdirSync(ciDir, { recursive: true });

  const outputs = {
    "call-graph.json": callGraph,
    "api-function-map.json": apiFunctionMap,
    "dependency-graph.json": dependencyGraph,
    "test-code-map.json": testCodeMap,
    "symbol-index.json": symbolIndex,
    "file-map.json": {
      files: parsedResult.files.map(f => ({
        file: f.file,
        language: f.language,
        exports: f.exports,
        imports: f.imports,
        functions: f.functions.map(fn => ({
          name: fn.name,
          kind: fn.kind,
          async: fn.async,
          params: fn.params,
          callCount: fn.calls?.length || 0,
          calls: (fn.calls || []).map(c => c.callee),
        })),
        classes: f.classes,
        routes: f.routes,
        components: f.components,
      })),
      stats: parsedResult.stats,
    },
  };

  // Content-addressed 寫入：內容指紋相同 → skip（mtime 不動 → git 零 diff）2026-08-22
  const writtenFiles = Object.keys(outputs);
  for (const [filename, data] of Object.entries(outputs)) {
    diffWriteJson(join(ciDir, filename), data);
  }

  // Build summary
  const summary = {
    generatedAt: new Date().toISOString(),
    filesParsed: parsedResult.stats.parsedFiles,
    totalFiles: parsedResult.stats.totalFiles,
    languages: parsedResult.stats.languages,
    callGraph: callGraph.stats,
    apiFunctionMap: apiFunctionMap.stats,
    dependencyGraph: dependencyGraph.stats,
    testCodeMap: testCodeMap.stats,
    symbolIndex: symbolIndex.stats,
    outputFiles: writtenFiles,
    outputDir: ".paaw/code-intelligence/",
  };

  // Save summary（generatedAt 不算內容 — 只有實質變更才會連同它一起重寫）
  diffWriteJson(join(ciDir, "summary.json"), summary, { ignoreKeys: ["generatedAt"] });

  return { summary, parsedResult };
}

// ── 7. Context Package Builder (for AI agents) ──

/**
 * Build a Code Context Package for a specific task
 * This is what an AI agent receives when taking over a task
 *
 * @param {string} projectRoot
 * @param {string} paawRoot
 * @param {object} query - { featureName?, filePath?, functionName?, routePath? }
 * @returns {Promise<object>} - structured context package
 */
export async function buildContextPackage(projectRoot, paawRoot, query = {}) {
  const ciDir = join(projectRoot, ".paaw", "code-intelligence");

  // Load cached intelligence
  const loadJson = (name) => {
    const p = join(ciDir, name);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
  };

  const callGraph = loadJson("call-graph.json");
  const apiFunctionMap = loadJson("api-function-map.json");
  const dependencyGraph = loadJson("dependency-graph.json");
  const testCodeMap = loadJson("test-code-map.json");
  const symbolIndex = loadJson("symbol-index.json");
  const fileMap = loadJson("file-map.json");

  if (!callGraph || !symbolIndex) {
    // Intelligence not built yet — build now
    await buildCodeIntelligence(projectRoot, paawRoot);
    return buildContextPackage(projectRoot, paawRoot, query);
  }

  const context = {
    query,
    relatedFiles: new Set(),
    relatedFunctions: new Set(),
    relatedRoutes: [],
    relatedTests: [],
    callers: [],  // who calls these functions
    callees: [],  // what these functions call
    dependencies: [], // file dependencies
  };

  // ── Query by file path ──
  if (query.filePath) {
    const file = fileMap?.files.find(f => f.file === query.filePath);
    if (file) {
      context.relatedFiles.add(file.file);
      for (const fn of file.functions) {
        context.relatedFunctions.add(`${file.file}:${fn.name}`);
      }
      // Add dependencies (imports)
      const dep = dependencyGraph?.files[file.file];
      if (dep) {
        for (const imp of dep.imports.filter(i => i.resolved)) {
          context.relatedFiles.add(imp.targetFile);
          context.dependencies.push({ from: file.file, to: imp.targetFile, names: imp.names });
        }
        for (const impBy of dep.importedBy) {
          context.relatedFiles.add(impBy.source);
          context.dependencies.push({ from: impBy.source, to: file.file, names: impBy.names });
        }
      }
    }
  }

  // ── Query by function name ──
  if (query.functionName) {
    const symbols = symbolIndex.byName[query.functionName] || [];
    for (const sym of symbols) {
      if (sym.type === "function") {
        const funcId = `${sym.file}:${sym.name}`;
        context.relatedFunctions.add(funcId);
        context.relatedFiles.add(sym.file);
        // Add callers
        const callers = callGraph?.callersOf[funcId] || [];
        context.callers.push(...callers);
        // Add callees
        const callees = callGraph?.calleesOf[funcId] || [];
        context.callees.push(...callees);
      }
    }
  }

  // ── Query by route path ──
  if (query.routePath) {
    const routes = apiFunctionMap?.routes.filter(
      r => r.path === query.routePath ||
           r.path === query.routePath + "/*" ||
           query.routePath.startsWith(r.path.replace(/\/\*$/, ""))
    ) || [];
    for (const route of routes) {
      context.relatedRoutes.push(route);
      context.relatedFiles.add(route.file);
      if (route.handler) {
        context.relatedFunctions.add(`${route.file}:${route.handler}`);
      }
      for (const chain of route.callChain) {
        if (chain.file) context.relatedFiles.add(chain.file);
        if (chain.resolved) context.relatedFunctions.add(`${chain.file}:${chain.function}`);
      }
    }
  }

  // ── Query by feature name ──
  if (query.featureName) {
    // Load FEATURES.json
    const featuresPath = join(projectRoot, ".paaw", "features", "FEATURES.json");
    if (existsSync(featuresPath)) {
      const features = JSON.parse(readFileSync(featuresPath, "utf-8"));
      const feature = features.features?.find(
        f => f.name === query.featureName || f.id === query.featureName
      );
      if (feature) {
        for (const cf of (feature.codeFiles || [])) {
          context.relatedFiles.add(cf);
        }
        for (const api of (feature.apis || [])) {
          context.relatedRoutes.push(api);
          if (api.file) context.relatedFiles.add(api.file);
        }
        for (const test of (feature.tests || [])) {
          context.relatedTests.push(test);
        }
      }
    }
  }

  // ── Find related tests ──
  for (const file of context.relatedFiles) {
    const testMapping = testCodeMap?.mappings.find(m => m.productionFile === file);
    if (testMapping) {
      context.relatedTests.push(testMapping.testFile);
    }
  }

  // Convert sets to arrays
  context.relatedFiles = [...context.relatedFiles];
  context.relatedFunctions = [...context.relatedFunctions];
  context.relatedTests = [...new Set(context.relatedTests)];

  return context;
}
