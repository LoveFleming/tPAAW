/**
 * error-code-scan.mjs — Error Codes by Feature（2026-09-05）
 *
 * CU 機器步驟：掃出 codebase 所有 error code → 用 Feature Map 歸屬 → 驗證規則。
 * 純 deterministic，零 LLM token（鐵律：事實靠程式，LLM 只註解）。
 *
 * 規則 per-RU 可配置：{ru}/.paaw/error-code-rules.json
 *   { "pattern": "^(SYS|BIZ|EXT)_[A-Z0-9]+(?:_[A-Z0-9]+){2,}$",
 *     "classes": ["SYS","BIZ","EXT"],        // 可選：第一段合法值
 *     "areas":  ["CTRL","ORCH","NODE","FW"], // 可選：第二段合法值
 *     "families": { "CTRL": ["REQUEST","AUTH",...] } } // 可選：第三段 per-area 合法值
 *
 * 產出：{ru}/.paaw/error-codes.json
 *   { scannedAt, rulesUsed, total, uniqueCodes, byFeature[], unmapped[], violations[], annotations }
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative, extname } from "path";

// ── 預設規則（Error Code Rules v1 相容；per-RU 可覆蓋） ──
const DEFAULT_RULES = {
  pattern: "^(SYS|BIZ|EXT)_[A-Z0-9]+(?:_[A-Z0-9]+){2,}$",
  classes: ["SYS", "BIZ", "EXT"],
  areas: null,   // null = 不檢查（domain 自訂）
  families: null, // null = 不檢查
};

const SOURCE_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".java",
  ".kt", ".kts", ".rs", ".rb", ".php", ".cs", ".swift", ".scala",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".paaw", "dist", "build", "out", "coverage",
  ".next", ".nuxt", "vendor", "target", "__pycache__", ".venv", "venv",
  "semgrep-rules", "fixtures", "data", ".cache",
]);

const THROW_HINT = /throw|raise|new\s+\w*Error|createError|reject\(|AppError|HttpError|BizError/i;

function _loadRules(root) {
  const p = join(root, ".paaw", "error-code-rules.json");
  try {
    const custom = JSON.parse(readFileSync(p, "utf-8"));
    return { ...DEFAULT_RULES, ...custom };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

function* _walk(dir, root) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* _walk(p, root);
    } else if (e.isFile() && SOURCE_EXTS.has(extname(e.name))) {
      yield p;
    }
  }
}

/** 驗證單一 code — 回傳 issues[]（空 = 合規） */
function _validate(code, rules) {
  const issues = [];
  const segs = code.split("_");
  const [cls, area, family] = segs;
  if (rules.classes && !rules.classes.includes(cls)) issues.push(`class '${cls}' 不在合法值 ${rules.classes.join("/")}`);
  if (rules.areas && !rules.areas.includes(area)) issues.push(`area '${area}' 不在合法值 ${rules.areas.join("/")}`);
  if (rules.families) {
    const fams = Array.isArray(rules.families) ? rules.families : rules.families[area];
    if (fams && !fams.includes(family)) issues.push(`family '${family}' 不在 ${area} 的合法值`);
  }
  if (segs.length < 3) issues.push(`只有 ${segs.length} 段（規範至少 3 段）`);
  return issues;
}

/**
 * 掃描 → 歸 feature → 驗證 → 寫 .paaw/error-codes.json
 * 回傳 summary（供 CU step_done / API）
 */
export function scanErrorCodes(root, opts = {}) {
  const projectRoot = resolve(root);
  const rules = _loadRules(projectRoot);
  const codeRegex = new RegExp(rules.pattern.startsWith("^") ? rules.pattern : `^${rules.pattern}$`, "g");

  // file → features（從 Feature Map）
  const fileToFeatures = new Map(); // normalized rel path → [{id, name}]
  try {
    const fm = JSON.parse(readFileSync(join(projectRoot, ".paaw", "features", "FEATURES.json"), "utf-8"));
    const features = Array.isArray(fm) ? fm : (fm.features || []);
    for (const f of features) {
      for (const cf of [...(f.codeFiles || []), ...(f.tests || [])]) {
        const rel = String(cf).replace(/\\/g, "/");
        if (!fileToFeatures.has(rel)) fileToFeatures.set(rel, []);
        fileToFeatures.get(rel).push({ id: f.id || f.name, name: f.name });
      }
    }
  } catch {
    // 沒有 feature map → 全部進 unmapped（掃描照跑，不擋）
  }

  const findings = []; // {code, file, line, kind, context}
  const allEntries = [];
  for (const filePath of _walk(projectRoot, projectRoot)) {
    let lines;
    try { lines = readFileSync(filePath, "utf-8").split("\n"); } catch { continue; }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 抓字串字面值裡的候選（誤抓註解也沒差 — 驗證層處理；context 供人看）
      const candidates = line.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,}/g);
      if (!candidates) continue;
      for (const cand of candidates) {
        codeRegex.lastIndex = 0;
        if (!codeRegex.test(cand)) continue;
        const rel = relative(projectRoot, filePath).replace(/\\/g, "/");
        findings.push({
          code: cand,
          file: rel,
          line: i + 1,
          kind: THROW_HINT.test(line) ? "throw" : "reference",
          context: line.trim().slice(0, 160),
        });
      }
    }
  }

  // 歸 feature + 驗證
  const relPathKey = (f) => f.file.replace(/^\.\//, "");
  const byFeatureMap = new Map(); // featureId → {featureId, featureName, codes[]}
  const unmapped = [];
  const codeLocations = new Map(); // code → Set(files)（跨檔重複偵測）

  for (const f of findings) {
    const feats = fileToFeatures.get(relPathKey(f)) || [];
    const issues = _validate(f.code, rules);
    if (!codeLocations.has(f.code)) codeLocations.set(f.code, new Set());
    codeLocations.get(f.code).add(f.file);
    const entry = { code: f.code, file: f.file, line: f.line, kind: f.kind, context: f.context, issues };
    allEntries.push(entry);

    if (feats.length === 0) {
      unmapped.push(entry);
    } else {
      for (const feat of feats) {
        if (!byFeatureMap.has(feat.id)) {
          byFeatureMap.set(feat.id, { featureId: feat.id, featureName: feat.name, codes: [] });
        }
        byFeatureMap.get(feat.id).codes.push(entry);
      }
    }
  }

  // 跨檔重複 → 標記 issue（info 性質，不擋）— entry 是同一物件參照，直接補
  for (const entry of allEntries) {
    if ((codeLocations.get(entry.code)?.size || 0) > 1) {
      if (!entry.issues.includes("跨檔出現")) entry.issues.push("跨檔出現");
    }
  }
  const violFinal = allEntries.filter(e => e.issues.length);

  const byFeature = [...byFeatureMap.values()].map(g => ({
    ...g,
    codes: g.codes.sort((a, b) => a.code.localeCompare(b.code) || a.file.localeCompare(b.file)),
    uniqueCount: new Set(g.codes.map(c => c.code)).size,
  })).sort((a, b) => b.uniqueCount - a.uniqueCount);

  const result = {
    scannedAt: new Date().toISOString(),
    rulesUsed: rules,
    total: findings.length,
    uniqueCodes: codeLocations.size,
    featureCount: byFeature.length,
    byFeature,
    unmapped,
    violations: violFinal.filter(v => v.issues.length),
  };

  if (opts.write !== false) {
    // 保留既有 LLM 註解（重掃不洗掉）
    let annotations = {};
    try { annotations = JSON.parse(readFileSync(join(projectRoot, ".paaw", "error-codes.json"), "utf-8")).annotations || {}; } catch {}
    writeFileSync(join(projectRoot, ".paaw", "error-codes.json"), JSON.stringify({ ...result, annotations }, null, 2));
  }
  return result;
}
