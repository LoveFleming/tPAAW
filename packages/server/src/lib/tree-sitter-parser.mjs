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
  ".go": "go",
};

// Go route 註冊物件名白名單（gin/echo/chi/fiber/gorilla/net-http 慣例變數名）
const GO_ROUTER_RE = /^(r|router|route|routes|app|api|e|g|s|srv|server|mux|http|grp|rg|group|v1|v2|v3|admin|auth|public|private|internal|web|mobile|open)$/i;

// Go 字串 literal 去 quote（"x" 與 `x`）
function stripGoString(text) {
  return text.replace(/^"|"$/g, "").replace(/^`|`$/g, "");
}

// Go receiver text → type 短名："(u *pkg.User)" → "User"
function goReceiverType(receiverText) {
  const inner = receiverText.replace(/^\(|\)$/g, "").trim();
  const parts = inner.split(/\s+/);
  const t = parts[parts.length - 1] || "";
  return t.replace(/^\*/, "").split(".").pop();
}

// Go route handler 名（第一個非字串 arg：identifier / selector_expression）
function goHandlerName(args) {
  const arg = args.children.find(c => c.type === "identifier" || c.type === "selector_expression");
  return arg ? arg.text : "";
}

// ── Grammar WASM paths (resolved relative to PAAW_ROOT) ──

function getGrammarWasmPath(lang, paawRoot) {
  // grammars are in node_modules at PAAW_ROOT (monorepo root)
  const paths = {
    javascript: join(paawRoot, "node_modules", "tree-sitter-javascript", "tree-sitter-javascript.wasm"),
    typescript: join(paawRoot, "node_modules", "tree-sitter-typescript", "tree-sitter-typescript.wasm"),
    tsx: join(paawRoot, "node_modules", "tree-sitter-typescript", "tree-sitter-tsx.wasm"),
    python: join(paawRoot, "node_modules", "tree-sitter-python", "tree-sitter-python.wasm"),
    java: join(paawRoot, "node_modules", "tree-sitter-java", "tree-sitter-java.wasm"),
    go: join(paawRoot, "node_modules", "tree-sitter-go", "tree-sitter-go.wasm"),
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
 * Extract calls made within a function body
 * Returns array of { callee, args, type }
 */
function extractCalls(funcNode) {
  const calls = [];
  const body = funcNode.childForFieldName("body") || funcNode;
  if (!body) return calls;

  walkNode(body, (node) => {
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (!fn) return;

      let callee = "";
      let callType = "direct"; // direct, method, chained

      if (fn.type === "identifier") {
        // foo() — direct call
        callee = fn.text;
        callType = "direct";
      } else if (fn.type === "member_expression") {
        // obj.method() or obj.foo.bar()
        const obj = fn.childForFieldName("object");
        const prop = fn.childForFieldName("property");
        const objText = obj ? obj.text : "";
        const propText = prop ? prop.text : "";
        if (objText && propText) {
          callee = `${objText}.${propText}`;
          callType = objText.includes(".") ? "chained" : "method";
        }
      } else if (fn.type === "selector_expression") {
        // Go: obj.Method() — Go grammar 欄位是 operand/field（不是 JS 的 object/property）
        const opd = fn.childForFieldName("operand");
        const fld = fn.childForFieldName("field");
        if (opd && fld) {
          callee = `${opd.text}.${fld.text}`;
          callType = opd.text.includes(".") ? "chained" : "method";
        }
      } else if (fn.type === "call_expression") {
        // foo()() — nested call
        callee = fn.text.slice(0, 60);
        callType = "nested";
      }

      if (callee) {
        const args = node.childForFieldName("arguments");
        const argCount = args ? args.children.filter(c => c.type !== "," && c.type !== "(" && c.type !== ")").length : 0;
        calls.push({ callee, type: callType, argCount });
      }
    }
  }, 0, 30); // deeper walk for call extraction

  return calls;
}

// ── Java Spring annotation → route（GetMapping/PostMapping/RequestMapping…）──
function javaAnnotationRoute(annoNode) {
  // web-tree-sitter childForFieldName 對部分 field 失效 — 掃 children fallback
  if (annoNode.type !== "annotation" && annoNode.type !== "marker_annotation") return null; // @Xxx(...) vs @Xxx
  const annoName = ((annoNode.childForFieldName("name") || annoNode.children.find(c => c.type === "identifier" || c.type === "scoped_identifier"))?.text || "").split(".").pop();
  const MAPPING = { GetMapping: "GET", PostMapping: "POST", PutMapping: "PUT", DeleteMapping: "DELETE", PatchMapping: "PATCH", RequestMapping: "" };
  if (!(annoName in MAPPING)) return null;
  const args = annoNode.childForFieldName("arguments") || annoNode.children.find(c => c.type === "annotation_argument_list");
  let pathStr = "";
  let httpMethod = "";
  if (args) {
    for (const child of args.children) {
      if (child.type === "string_literal") {
        if (!pathStr) pathStr = child.text.replace(/^"|"$/g, "");
      } else if (child.type === "assignment_expression" || child.type === "element_value_pair") {
        const l = child.childForFieldName("left")?.text || child.children[0]?.text || "";
        const r = child.childForFieldName("right") || child.children[2];
        if (!r) continue;
        if ((l === "value" || l === "path") && r.type === "string_literal") pathStr = r.text.replace(/^"|"$/g, "");
        if (l === "method") {
          const m = /RequestMethod\.(\w+)/.exec(r.text);
          if (m) httpMethod = m[1].toUpperCase();
        }
      }
    }
  }
  if (!pathStr) return { method: httpMethod || MAPPING[annoName] || "GET", path: "" }; // marker annotation（@PostMapping 無 path）→ 用 class prefix
  return { method: httpMethod || MAPPING[annoName] || "GET", path: pathStr };
}

/**
 * Extract structured info from a single file's AST
 */
function extractFileInfo(tree, filePath, language) {
  let javaRoutePrefix = ""; // class-level @RequestMapping prefix
  const goGroupPrefix = {};     // gin/echo: v1 := r.Group("/v1") → var name → prefix（支援巢狀鏈）
  const goPendingMethods = {};  // Go receiver type → [methods]（method_declaration 可能早於 struct 定義）
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
    // ── Imports (Go) ──
    if (node.type === "import_declaration" && language === "go") {
      // import "fmt" / import ( "x" // alias y "z" )
      const specs = [];
      for (const c of node.children) {
        if (c.type === "import_spec") specs.push(c);
        if (c.type === "import_spec_list") for (const s of c.children) if (s.type === "import_spec") specs.push(s);
      }
      for (const s of specs) {
        const p = s.childForFieldName("path");
        if (!p) continue;
        const source = stripGoString(p.text);
        const parts = source.split("/");
        const alias = s.childForFieldName("name")?.text;
        info.imports.push({ source, names: [alias || parts[parts.length - 1] || parts[0]] });
      }
    }

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

    // ── Java class-level @RequestMapping prefix（classes 清單由下方既有 class 分支處理）──
    if (language === "java" && node.type === "class_declaration") {
      const mods = node.children.find(c => c.type === "modifiers");
      if (mods) {
        for (const c of mods.children) {
          if (c.type === "annotation" && (c.childForFieldName("name")?.text || c.children.find(x => x.type === "identifier")?.text || "").endsWith("RequestMapping")) {
            const ri = javaAnnotationRoute(c);
            if (ri && ri.path) javaRoutePrefix = ri.path;
          }
        }
      }
    }

    // ── Java method declarations + Spring mapping annotations ──
    if (node.type === "method_declaration" && language === "java") {
      const name = node.childForFieldName("name")?.text || "";
      const params = node.childForFieldName("parameters")?.text || "";
      if (name) {
        info.functions.push({ name, kind: "method", async: false, params });
      }
      // Spring routes：@GetMapping("/x") / @RequestMapping(value="/x", method=RequestMethod.POST)
      const mods = node.children.find(c => c.type === "modifiers");
      if (mods) {
        for (const c of mods.children) {
          if (c.type !== "annotation" && c.type !== "marker_annotation") continue;
          const ri = javaAnnotationRoute(c);
          if (ri && (ri.path || javaRoutePrefix)) info.routes.push({ method: ri.method, path: (javaRoutePrefix || "") + ri.path, handler: name });
        }
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

    // ── Function declarations（JS/TS 專用 — Go 走上方 Go branch，避免重複 push）──
    if (node.type === "function_declaration" && language !== "go") {
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
            const calls = extractCalls(value);
            info.functions.push({ name, kind: "arrow", async: !!asyncKw, params, calls });
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

    // ── Python function definitions（pytest test_* 也在這進清單）──
    if (language === "python" && node.type === "function_definition") {
      const name = node.childForFieldName("name")?.text || "";
      const params = node.childForFieldName("parameters")?.text || "()";
      if (name) info.functions.push({ name, kind: "function", async: false, params });
    }

    // ── Python routes：@app.get("/x") / @router.post("/x") / @app.route("/x", methods=["POST"]) ──
    if (language === "python" && node.type === "decorated_definition") {
      const def = node.children.find(c => c.type === "function_definition" || c.type === "class_definition");
      const handler = def?.childForFieldName("name")?.text || "";
      const PY_HTTP = ["get", "post", "put", "patch", "delete", "head", "options", "route", "api_route"];
      for (const dec of node.children) {
        if (dec.type !== "decorator") continue;
        const call = dec.children.find(c => c.type === "call");
        if (!call) continue;
        const fn = call.childForFieldName("function");
        if (!fn || fn.type !== "attribute") continue; // 只認 obj.method 形態
        const prop = fn.childForFieldName("attribute")?.text || "";
        const obj = fn.childForFieldName("object")?.text || "";
        if (!PY_HTTP.includes(prop)) continue;
        if (!/^(app|router|api|bp|blueprint|ns|web|server|fastapi|flask)/i.test(obj)) continue;
        const args = call.childForFieldName("arguments");
        if (!args) continue;
        let pathStr = "";
        for (const c of args.children) {
          if (c.type === "string") {
            pathStr = c.text.replace(/^[rRbBfFuU]{0,2}['"]/, "").replace(/['"]$/, "");
            break;
          }
        }
        if (!pathStr) continue;
        let m = "";
        if (prop === "route" || prop === "api_route") {
          m = "GET"; // Flask 預設 GET/HEAD/OPTIONS
          for (const c of args.children) {
            if (c.type === "keyword_argument" && (c.childForFieldName("name")?.text || "") === "methods") {
              const mm = /["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/.exec((c.childForFieldName("value")?.text) || "");
              if (mm) m = mm[1];
            }
          }
        } else {
          m = prop.toUpperCase();
        }
        info.routes.push({ method: m, path: pathStr, handler });
      }
    }

    // ── Go functions（call graph 主要來源）──
    if (language === "go" && node.type === "function_declaration") {
      const name = node.childForFieldName("name")?.text || "";
      const params = node.childForFieldName("parameters")?.text || "()";
      if (name) {
        info.functions.push({ name, kind: "function", async: false, params, calls: extractCalls(node) });
        if (/^[A-Z]/.test(name)) info.exports.push({ kind: "function", name, isDefault: false }); // Go 大寫 = exported
      }
    }

    // ── Go methods（receiver method；短名進 functions 讓 call graph resolve 得到 obj.Method）──
    if (language === "go" && node.type === "method_declaration") {
      const name = node.childForFieldName("name")?.text || "";
      const receiver = node.childForFieldName("receiver")?.text || "()";
      const params = node.childForFieldName("parameters")?.text || "()";
      if (name) {
        info.functions.push({ name, kind: "method", async: false, params: `${receiver} ${params}`, calls: extractCalls(node) });
        const rt = goReceiverType(receiver);
        (goPendingMethods[rt] = goPendingMethods[rt] || []).push(name);
        if (/^[A-Z]/.test(name)) info.exports.push({ kind: "method", name, isDefault: false });
      }
    }

    // ── Go struct → classes（type User struct { ... }）──
    if (language === "go" && node.type === "type_spec") {
      const name = node.childForFieldName("name")?.text || "";
      const typeVal = node.childForFieldName("type");
      if (name && typeVal && typeVal.type === "struct_type") {
        info.classes.push({ name, methods: [] });
        if (/^[A-Z]/.test(name)) info.exports.push({ kind: "class", name, isDefault: false });
      }
    }

    // ── Go gin/echo group prefix：v1 := r.Group("/v1") / v2 := v1.Group("/v2")（巢狀串接）──
    if (language === "go" && node.type === "short_var_declaration") {
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      const varName = left?.children.find(c => c.type === "identifier")?.text;
      const call = right?.children.find(c => c.type === "call_expression");
      if (varName && call) {
        const cfn = call.childForFieldName("function");
        if (cfn?.type === "selector_expression" && (cfn.childForFieldName("field")?.text || "") === "Group") {
          const cargs = call.childForFieldName("arguments");
          const s = cargs?.children.find(c => c.type === "interpreted_string_literal" || c.type === "raw_string_literal");
          if (s) {
            const opd = cfn.childForFieldName("operand")?.text || "";
            goGroupPrefix[varName] = (goGroupPrefix[opd] || "") + stripGoString(s.text);
          }
        }
      }
    }

    // ── Go routes ──
    // gin/echo: r.GET("/x", h)（全大寫 verb）；chi/fiber: r.Get("/x", h)（首字大寫）
    // gorilla/mux + net/http: r.HandleFunc("/x", h) / http.HandleFunc / mux.Handle + .Methods("POST") 鏈
    if (language === "go" && node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      const args = node.childForFieldName("arguments");
      if (fn && fn.type === "selector_expression" && args) {
        const fld = fn.childForFieldName("field")?.text || "";
        const opd = fn.childForFieldName("operand")?.text || "";
        const GO_VERBS = {
          GET: "GET", POST: "POST", PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE", HEAD: "HEAD", OPTIONS: "OPTIONS", Any: "ANY",
          Get: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE", Head: "HEAD", Options: "OPTIONS",
        };
        const firstStr = () => args.children.find(c => c.type === "interpreted_string_literal" || c.type === "raw_string_literal");
        if ((fld in GO_VERBS) && GO_ROUTER_RE.test(opd)) {
          const s = firstStr();
          if (s) info.routes.push({ method: GO_VERBS[fld], path: (goGroupPrefix[opd] || "") + stripGoString(s.text), handler: goHandlerName(args) });
        } else if ((fld === "HandleFunc" || fld === "Handle") && GO_ROUTER_RE.test(opd)) {
          const s = firstStr();
          if (s) {
            // 被 .Methods("POST") 鏈住 → 這節點先被訪問，method 由外層 Methods 分支補上，這裡別重複 push
            const outer = node.parent?.parent; // selector_expression → 外層 call_expression(.Methods)
            const outerFld = outer?.type === "call_expression" ? outer.childForFieldName("function")?.childForFieldName("field")?.text : "";
            const chained = /^Methods?$/.test(outerFld || "");
            if (!chained) info.routes.push({ method: "ANY", path: stripGoString(s.text), handler: goHandlerName(args) });
          }
        } else if ((fld === "Methods" || fld === "Method") && opd) {
          // gorilla/mux：r.HandleFunc("/x", h).Methods("POST", "GET") — operand 是內層 HandleFunc call
          const inner = fn.childForFieldName("operand");
          if (inner && inner.type === "call_expression") {
            const ifn = inner.childForFieldName("function");
            const iargs = inner.childForFieldName("arguments");
            if (ifn?.type === "selector_expression" && iargs) {
              const ifld = ifn.childForFieldName("field")?.text || "";
              if (ifld === "HandleFunc" || ifld === "Handle") {
                const s = iargs.children.find(c => c.type === "interpreted_string_literal" || c.type === "raw_string_literal");
                if (s) {
                  const path = stripGoString(s.text);
                  const methods = args.children
                    .filter(c => c.type === "interpreted_string_literal" || c.type === "raw_string_literal")
                    .map(c => stripGoString(c.text).toUpperCase())
                    .filter(m => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(m));
                  if (methods.length === 0) methods.push("ANY");
                  for (const m of methods) {
                    info.routes.push({ method: m, path, handler: goHandlerName(iargs) });
                  }
                }
              }
            }
          }
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
          // req.method === "GET" / method === "GET"（route 檔局部變數慣例，2026-08-22）
          if (n.type === "binary_expression" && (n.text.includes("req.method") || /\bmethod\s*===/.test(n.text))) {
            const right = n.childForFieldName("right");
            if (right && right.type === "string") {
              method = right.text.replace(/^['"]|['"]$/g, "");
            }
          }
          // path === "/api/..." / url === "/api/..."（url 局部變數慣例，146 處 route 檔使用）
          if (n.type === "binary_expression" && (n.text.includes("path") || /\burl\s*===/.test(n.text))) {
            const right = n.childForFieldName("right");
            if (right && right.type === "string") {
              pathStr = right.text.replace(/^['"]|['"]$/g, "");
            }
          }
          // path.startsWith("/api/...") / url.startsWith("/api/...")
          if (n.type === "call_expression" && (n.text.includes("path.startsWith") || n.text.includes("url.startsWith"))) {
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

  // Go：method_declaration 可能早於/晚於 struct 定義（甚至跨檔）— 統一補掛到 class entries
  for (const [typeName, methods] of Object.entries(goPendingMethods)) {
    if (!/^[A-Z]/.test(typeName)) continue; // 非匯出型別（int 等基底）不建 class
    let cls = info.classes.find(c => c.name === typeName);
    if (!cls) {
      cls = { name: typeName, methods: [] };
      info.classes.push(cls);
    }
    for (const m of methods) {
      if (!cls.methods.includes(m)) cls.methods.push(m);
    }
  }

  return info;
}

// ── Scan project and parse all source files ──

/**
 * @param {string} projectRoot - project root directory
 * @param {string} paawRoot - PAAW installation root (for grammar WASM paths)
 * @param {object} options - { maxFiles?: number, maxBytes?: number }（預設無上限）
 * @returns {Promise<{ files: object[], stats: object }>}
 */
export async function parseProject(projectRoot, paawRoot, options = {}) {
  const maxFiles = options.maxFiles || 0; // 0 = 無上限
  const maxBytes = options.maxBytes || 0; // 0 = 無上限

  await initParser(paawRoot);

  // Collect source files
  const sourceFiles = [];
  const SKIP_DIRS = new Set(["node_modules", ".git", ".paaw", "dist", "build", "coverage", ".next", ".nuxt", "vendor", "__pycache__", "testdata", "backups", "temp", "tmp", "data"]);
  const SOURCE_EXTS = new Set(Object.keys(LANG_MAP));

  function walkDir(dir) {
    if (maxFiles > 0 && sourceFiles.length >= maxFiles) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (maxFiles > 0 && sourceFiles.length >= maxFiles) break;
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && SOURCE_EXTS.has(extname(entry.name))) {
          try {
            const stat = statSync(fullPath);
            if (maxBytes > 0 && stat.size > maxBytes) continue; // 0 = 不限
            sourceFiles.push(fullPath);
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
