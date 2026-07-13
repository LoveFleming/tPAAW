/**
 * tree-sitter-parser.mjs — Parse project source files with Tree-sitter
 * Extracts structured info: imports, exports, functions, classes, routes, React components
 * Output: JSON array of per-file summaries → feed to AI for feature mapping
 */

import { resolve, join, extname, basename, dirname, relative } from "path";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";

let _parser = null;
let _languages = {};
let _initialized = false;

// ── Language detection by extension ──

const LANG_MAP = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".java": "java",
};

// ── Grammar WASM paths (resolved relative to PAAW_ROOT) ──

function getGrammarWasmPath(lang, paawRoot) {
  // grammars are in node_modules at PAAW_ROOT (monorepo root)
  const paths = {
    javascript: join(paawRoot, "node_modules", "tree-sitter-javascript", "tree-sitter-javascript.wasm"),
    typescript: join(paawRoot, "node_modules", "tree-sitter-typescript", "tree-sitter-typescript.wasm"),
    tsx: join(paawRoot, "node_modules", "tree-sitter-typescript", "tree-sitter-tsx.wasm"),
    python: join(paawRoot, "node_modules", "tree-sitter-python", "tree-sitter-python.wasm"),
    java: join(paawRoot, "node_modules", "tree-sitter-java", "tree-sitter-java.wasm"),
  };
  return paths[lang] || null;
}

// ── Initialize parser (lazy, once) ──

async function initParser(paawRoot) {
  if (_initialized) return;
  const wts = await import("web-tree-sitter");
  await wts.Parser.init();
  _parser = new wts.Parser();
  _wts = wts;
  _initialized = true;
}

let _wts = null;

async function getLanguage(lang, paawRoot) {
  if (_languages[lang]) return _languages[lang];
  const wasmPath = getGrammarWasmPath(lang, paawRoot);
  if (!wasmPath || !existsSync(wasmPath)) return null;
  const language = await _wts.Language.load(wasmPath);
  _languages[lang] = language;
  return language;
}

// ── Walk AST and extract structured info ──

function walkNode(node, visitor, depth = 0, maxDepth = 20) {
  if (depth > maxDepth) return;
  visitor(node, depth);
  for (const child of node.children) {
    walkNode(child, visitor, depth + 1, maxDepth);
  }
}

/**
 * Extract structured info from a single file's AST
 */
function extractFileInfo(tree, filePath, language) {
  const info = {
    file: filePath,
    language,
    exports: [],      // { kind, name, isDefault }
    imports: [],      // { source, names: [] }
    functions: [],    // { name, kind, async, params }
    classes: [],      // { name, methods: [] }
    routes: [],       // { method, path, handler }
    components: [],   // { name, kind }  (React components)
  };

  const root = tree.rootNode;

  walkNode(root, (node) => {
    // ── Imports (Java) ──
    if (node.type === "import_declaration" && language === "java") {
      // import java.util.List;  or  import java.util.*;
      const scopedId = node.children.find(c => c.type === "scoped_identifier" || c.type === "wildcard_import");
      if (scopedId) {
        const source = scopedId.text;
        const parts = source.split(".");
        const lastName = parts[parts.length - 1];
        info.imports.push({ source, names: [lastName] });
      }
    }

    // ── Java method declarations ──
    if (node.type === "method_declaration" && language === "java") {
      const name = node.childForFieldName("name")?.text || "";
      const params = node.childForFieldName("parameters")?.text || "";
      if (name) {
        info.functions.push({ name, kind: "method", async: false, params });
      }
    }

    // ── Imports (JS/TS) ──
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source");
      const source = sourceNode ? sourceNode.text.replace(/^['"]|['"]$/g, "") : "";
      const clause = node.childForFieldName("clause");
      const names = [];
      if (clause) {
        // named imports: import { A, B } from 'x'
        walkNode(clause, (n) => {
          if (n.type === "import_specifier") {
            const ident = n.childForFieldName("name");
            if (ident) names.push(ident.text);
          }
          // namespace import: import * as X from 'x'
          if (n.type === "namespace_import") {
            const ident = n.childForFieldName("name");
            if (ident) names.push(`* as ${ident.text}`);
          }
          // default import side: import X from 'x'
          if (n.type === "identifier") {
            names.push(n.text);
          }
        }, 0, 3);
      }
      if (source) {
        info.imports.push({ source, names });
      }
    }

    // ── Exports ──
    if (node.type === "export_statement") {
      const defaultKw = node.children.find(c => c.type === "default");
      // export default function X
      const decl = node.children.find(c =>
        c.type === "function_declaration" ||
        c.type === "lexical_declaration" ||
        c.type === "class_declaration" ||
        c.type === "arrow_function" ||
        c.type === "identifier"
      );
      if (decl) {
        if (decl.type === "function_declaration") {
          const name = decl.childForFieldName("name")?.text || "";
          info.exports.push({ kind: "function", name, isDefault: !!defaultKw });
        } else if (decl.type === "class_declaration") {
          const name = decl.childForFieldName("name")?.text || "";
          info.exports.push({ kind: "class", name, isDefault: !!defaultKw });
        } else if (decl.type === "lexical_declaration") {
          // export const X = ...
          for (const child of decl.children) {
            if (child.type === "variable_declarator") {
              const name = child.childForFieldName("name")?.text || "";
              if (name) info.exports.push({ kind: "variable", name, isDefault: !!defaultKw });
            }
          }
        } else if (decl.type === "identifier") {
          // export default X
          info.exports.push({ kind: "value", name: decl.text, isDefault: true });
        }
      }
      // export { A, B }
      const exportClause = node.children.find(c => c.type === "export_clause");
      if (exportClause) {
        walkNode(exportClause, (n) => {
          if (n.type === "export_specifier") {
            const name = n.childForFieldName("name")?.text || "";
            info.exports.push({ kind: "named", name, isDefault: false });
          }
        }, 0, 3);
      }
    }

    // ── Function declarations ──
    if (node.type === "function_declaration") {
      const name = node.childForFieldName("name")?.text || "";
      const asyncKw = node.children.find(c => c.type === "async");
      const params = node.childForFieldName("parameters")?.text || "";
      info.functions.push({ name, kind: "function", async: !!asyncKw, params });
    }

    // ── Arrow functions assigned to const/let ──
    if (node.type === "lexical_declaration") {
      for (const child of node.children) {
        if (child.type === "variable_declarator") {
          const name = child.childForFieldName("name")?.text || "";
          const value = child.childForFieldName("value");
          if (value && value.type === "arrow_function") {
            const asyncKw = value.children.find(c => c.type === "async");
            const params = value.childForFieldName("parameters")?.text || "";
            info.functions.push({ name, kind: "arrow", async: !!asyncKw, params });
          }
        }
      }
    }

    // ── Class declarations ──
    if (node.type === "class_declaration") {
      const name = node.childForFieldName("name")?.text || "";
      const body = node.childForFieldName("body");
      const methods = [];
      if (body) {
        walkNode(body, (n) => {
          if (n.type === "method_definition" || n.type === "public_field_definition") {
            const mname = n.childForFieldName("name")?.text || "";
            if (mname) methods.push(mname);
          }
          // Java methods: method_declaration
          if (n.type === "method_declaration") {
            const mname = n.childForFieldName("name")?.text || "";
            if (mname) methods.push(mname);
          }
        }, 0, 3);
      }
      info.classes.push({ name, methods });

      // For Java, classes are also exports (public class = file's export)
      if (language === "java") {
        const modifiers = node.childForFieldName("modifiers");
        const isPublic = modifiers && modifiers.text.includes("public");
        if (isPublic) {
          info.exports.push({ kind: "class", name, isDefault: false });
        }
      }
    }

    // ── Route patterns: router.get('/path', ...), app.post('/path', ...) ──
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      const args = node.childForFieldName("arguments");
      if (fn && fn.type === "member_expression" && args) {
        const prop = fn.childForFieldName("property")?.text || "";
        const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "all", "use"];
        // Skip false positives: header accesses like res.headers.get('content-type')
        const obj = fn.childForFieldName("object")?.text || "";
        const isLikelyRoute = /^(router|app|server|route|api|express|fastify|koa|\.)/.test(obj) || obj === "";
        if (HTTP_METHODS.includes(prop) && isLikelyRoute) {
          // First string arg = route path
          const firstArg = args.children.find(c => c.type === "string");
          if (firstArg) {
            const path = firstArg.text.replace(/^['"]|['"]$/g, "");
            info.routes.push({ method: prop.toUpperCase(), path, handler: "" });
          }
        }
      }
    }

    // ── PAAW-style routes: if (req.method === "POST" && path === "/api/...") ──
    if (node.type === "if_statement") {
      // Look for pattern: req.method === "POST" and path === "/api/..."
      const condition = node.childForFieldName("condition");
      if (condition) {
        let method = "";
        let pathStr = "";
        // Walk condition to find string comparisons
        walkNode(condition, (n) => {
          // req.method === "GET" or req.method === "POST"
          if (n.type === "binary_expression" && n.text.includes("req.method")) {
            const right = n.childForFieldName("right");
            if (right && right.type === "string") {
              method = right.text.replace(/^['"]|['"]$/g, "");
            }
          }
          // path === "/api/..." or path.startsWith("/api/...")
          if (n.type === "binary_expression" && n.text.includes("path")) {
            const right = n.childForFieldName("right");
            if (right && right.type === "string") {
              pathStr = right.text.replace(/^['"]|['"]$/g, "");
            }
          }
          // path.startsWith("/api/...")
          if (n.type === "call_expression" && n.text.includes("path.startsWith")) {
            const callArgs = n.childForFieldName("arguments");
            if (callArgs) {
              const firstArg = callArgs.children.find(c => c.type === "string");
              if (firstArg) {
                pathStr = firstArg.text.replace(/^['"]|['"]$/g, "") + "/*";
              }
            }
          }
        }, 0, 5);
        if (method && pathStr && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) && pathStr.startsWith("/")) {
          info.routes.push({ method, path: pathStr, handler: "" });
        }
      }
    }

    // ── React components: function Xxx() returning JSX / PascalCase functions ──
    if (node.type === "function_declaration" || node.type === "arrow_function") {
      const nameNode = node.type === "function_declaration"
        ? node.childForFieldName("name")
        : null;
      // Check if name is PascalCase → likely React component
      if (nameNode && /^[A-Z]/.test(nameNode.text)) {
        info.components.push({ name: nameNode.text, kind: node.type === "function_declaration" ? "function" : "arrow" });
      }
    }
    // Also check: const Xxx = () => JSX
    if (node.type === "lexical_declaration") {
      for (const child of node.children) {
        if (child.type === "variable_declarator") {
          const name = child.childForFieldName("name")?.text || "";
          const value = child.childForFieldName("value");
          if (/^[A-Z]/.test(name) && value && (value.type === "arrow_function" || value.type === "function_expression")) {
            info.components.push({ name, kind: value.type === "arrow_function" ? "arrow" : "function" });
          }
        }
      }
    }
  });

  return info;
}

// ── Scan project and parse all source files ──

/**
 * @param {string} projectRoot - project root directory
 * @param {string} paawRoot - PAAW installation root (for grammar WASM paths)
 * @param {object} options - { maxFiles: 500, maxBytes: 100KB per file }
 * @returns {Promise<{ files: object[], stats: object }>}
 */
export async function parseProject(projectRoot, paawRoot, options = {}) {
  const maxFiles = options.maxFiles || 500;
  const maxBytes = options.maxBytes || 100_000; // 100KB per file

  await initParser(paawRoot);

  // Collect source files
  const sourceFiles = [];
  const SKIP_DIRS = new Set(["node_modules", ".git", ".paaw", "dist", "build", "coverage", ".next", ".nuxt", "vendor", "__pycache__", "backups", "temp", "tmp", "data"]);
  const SOURCE_EXTS = new Set(Object.keys(LANG_MAP));

  function walkDir(dir) {
    if (sourceFiles.length >= maxFiles) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (sourceFiles.length >= maxFiles) break;
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && SOURCE_EXTS.has(extname(entry.name))) {
          try {
            const stat = statSync(fullPath);
            if (stat.size <= maxBytes) {
              sourceFiles.push(fullPath);
            }
          } catch {}
        }
      }
    } catch {}
  }

  walkDir(projectRoot);

  // Parse each file
  const results = [];
  const errors = [];
  const langStats = {};

  for (const filePath of sourceFiles) {
    const ext = extname(filePath);
    const langName = LANG_MAP[ext];
    if (!langName) continue;

    const lang = await getLanguage(langName, paawRoot);
    if (!lang) {
      errors.push({ file: filePath, error: `No grammar for ${langName}` });
      continue;
    }

    try {
      const code = readFileSync(filePath, "utf-8");
      _parser.setLanguage(lang);
      const tree = _parser.parse(code);

      if (!tree || !tree.rootNode) {
        errors.push({ file: filePath, error: "Parse returned null tree" });
        continue;
      }

      const relPath = relative(projectRoot, filePath).replace(/\\/g, "/");
      const fileInfo = extractFileInfo(tree, relPath, langName);

      // Only include files that have meaningful content
      const hasContent = fileInfo.exports.length > 0 ||
        fileInfo.imports.length > 0 ||
        fileInfo.functions.length > 0 ||
        fileInfo.classes.length > 0 ||
        fileInfo.routes.length > 0 ||
        fileInfo.components.length > 0;

      if (hasContent) {
        results.push(fileInfo);
      }

      langStats[langName] = (langStats[langName] || 0) + 1;
      tree.delete(); // free memory
    } catch (err) {
      errors.push({ file: relative(projectRoot, filePath), error: err.message });
    }
  }

  return {
    files: results,
    stats: {
      totalFiles: sourceFiles.length,
      parsedFiles: results.length,
      errors: errors.length,
      languages: langStats,
    },
    errors: errors.slice(0, 20), // cap error list
  };
}

/**
 * Format parsed results as text for AI consumption
 * Two outputs:
 *   1. "feature-map context" — concise per-file summary for feature mapping
 *   2. "file-feature context" — for reverse mapping (file → features)
 */
export function formatForAI(parsedResult) {
  const lines = [];

  lines.push(`# Project Source Analysis (Tree-sitter)`);
  lines.push(`Parsed ${parsedResult.stats.parsedFiles} of ${parsedResult.stats.totalFiles} source files`);
  lines.push(`Languages: ${Object.entries(parsedResult.stats.languages).map(([k,v]) => `${k}(${v})`).join(", ")}`);
  lines.push("");

  for (const file of parsedResult.files) {
    lines.push(`## ${file.file} [${file.language}]`);

    if (file.imports.length > 0) {
      lines.push(`  Imports:`);
      for (const imp of file.imports) {
        const names = imp.names.length > 0 ? imp.names.join(", ") : "*";
        lines.push(`    ${names} ← ${imp.source}`);
      }
    }

    if (file.exports.length > 0) {
      lines.push(`  Exports:`);
      for (const exp of file.exports) {
        lines.push(`    ${exp.isDefault ? "default " : ""}${exp.kind}: ${exp.name}`);
      }
    }

    if (file.functions.length > 0) {
      lines.push(`  Functions:`);
      for (const fn of file.functions) {
        lines.push(`    ${fn.async ? "async " : ""}${fn.kind} ${fn.name}${fn.params}`);
      }
    }

    if (file.classes.length > 0) {
      lines.push(`  Classes:`);
      for (const cls of file.classes) {
        lines.push(`    class ${cls.name} { ${cls.methods.join(", ")} }`);
      }
    }

    if (file.routes.length > 0) {
      lines.push(`  Routes:`);
      for (const route of file.routes) {
        lines.push(`    ${route.method} ${route.path}`);
      }
    }

    if (file.components.length > 0) {
      lines.push(`  React Components:`);
      for (const comp of file.components) {
        lines.push(`    ${comp.kind}: ${comp.name}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate a condensed summary suitable for AI context windows
 * (shorter than formatForAI — just key signals per file)
 */
export function formatCondensed(parsedResult) {
  const lines = [];

  for (const file of parsedResult.files) {
    const parts = [];

    // Exports → what this file provides
    if (file.exports.length > 0) {
      parts.push("↑" + file.exports.map(e => `${e.isDefault ? "★" : ""}${e.name}`).join(","));
    }

    // Imports → what this file depends on
    if (file.imports.length > 0) {
      parts.push("↓" + file.imports.map(i => i.source).join(","));
    }

    // Routes
    if (file.routes.length > 0) {
      parts.push("⚡" + file.routes.map(r => `${r.method} ${r.path}`).join(" | "));
    }

    // React components
    if (file.components.length > 0) {
      parts.push("⚛" + file.components.map(c => c.name).join(","));
    }

    // Functions (top-level only, skip internals)
    if (file.functions.length > 0) {
      parts.push("ƒ" + file.functions.map(f => f.name).join(","));
    }

    // Classes
    if (file.classes.length > 0) {
      parts.push("⊕" + file.classes.map(c => c.name).join(","));
    }

    if (parts.length > 0) {
      lines.push(`${file.file} → ${parts.join(" | ")}`);
    }
  }

  return lines.join("\n");
}
