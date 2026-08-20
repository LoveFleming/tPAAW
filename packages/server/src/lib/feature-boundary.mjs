/**
 * feature-boundary.mjs — Context Boundary for Feature Guardrail
 *
 * Given a set of changed/staged files, resolve which features are involved
 * and build a Feature File Tree that limits AI's context scope.
 *
 * Architecture:
 *   Changed Files → Feature Match → File Tree → inject into agent prompt
 *
 * This is the "Context Boundary" from the Feature Guardrail design:
 *   "使用者說改某 feature → PAAW 只給該 feature 的 file tree，不丟整個 repo"
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Load FEATURES.json and FILE-FEATURES.json from .paaw/
 * @param {string} rootDir — project root (the imported coding project)
 * @returns {{ features: Array, fileFeatureMap: Object } | null}
 */
export function loadFeatureData(rootDir) {
  const featuresFile = join(rootDir, ".paaw", "features", "FEATURES.json");
  const fileFeaturesFile = join(rootDir, ".paaw", "features", "FILE-FEATURES.json");

  if (!existsSync(featuresFile)) return null;

  try {
    const fData = JSON.parse(readFileSync(featuresFile, "utf-8"));
    const features = fData.features || (Array.isArray(fData) ? fData : []);

    let fileFeatureMap = {};
    if (existsSync(fileFeaturesFile)) {
      const ffData = JSON.parse(readFileSync(fileFeaturesFile, "utf-8"));
      fileFeatureMap = ffData.files || ffData;
    }

    return { features, fileFeatureMap };
  } catch {
    return null;
  }
}

/**
 * Given a list of file paths, find which features they belong to.
 * @param {string[]} filePaths — relative file paths (e.g. ["packages/server/src/routes/crew.mjs"])
 * @param {Object} fileFeatureMap — { "path/to/file": [{ id, name, tags }] }
 * @returns {Map<string, { id: string, name: string, matchedFiles: string[] }>} matched features
 */
export function matchFeaturesForFiles(filePaths, fileFeatureMap) {
  const result = new Map();

  for (const fp of filePaths) {
    const normalized = fp.replace(/\\/g, "/");
    // Direct match
    const match = fileFeatureMap[normalized];
    if (match && Array.isArray(match)) {
      for (const feat of match) {
        if (!result.has(feat.id)) {
          result.set(feat.id, { id: feat.id, name: feat.name, matchedFiles: [] });
        }
        result.get(feat.id).matchedFiles.push(normalized);
      }
    } else {
      // Partial match — file might be under a mapped directory
      for (const [mapPath, feats] of Object.entries(fileFeatureMap)) {
        if (normalized.startsWith(mapPath.replace(/\/[^/]+$/, "") + "/")) {
          // File is in same directory as a mapped file — not a strong match, skip
        }
      }
    }
  }

  return result;
}

/**
 * Build a Feature File Tree for context injection.
 *
 * Output format:
 * ```
 * Feature: Agent Management [F-001] (active)
 * │
 * ├─ Code Files
 * │  ├─ packages/server/src/routes/crew.mjs  ← changed
 * │  ├─ packages/server/src/routes/coding-memory.mjs
 * │  └─ packages/server/src/lib/paaw-agent-loop.mjs  ← changed
 * │
 * ├─ APIs
 * │  ├─ POST /api/v1/agents/crew/assign
 * │  └─ GET /api/v1/agents/crew/{crewId}/status
 * │
 * ├─ Tests
 * │  └─ (no tests mapped)
 * │
 * └─ Runbooks
 *    └─ (no runbooks)
 * ```
 *
 * @param {Object} feature — a single feature from FEATURES.json
 * @param {string[]} changedFiles — files that changed (for marking ← changed)
 * @returns {string} formatted tree
 */
export function buildFeatureFileTree(feature, changedFiles = []) {
  const changed = new Set(changedFiles.map(f => f.replace(/\\/g, "/")));
  const mark = (f) => changed.has(f) ? "  ← changed" : "";

  const lines = [];
  lines.push(`Feature: ${feature.name} [${feature.id}] (${feature.status})`);
  if (feature.description) lines.push(`  ${feature.description}`);
  lines.push("│");

  // Code Files
  const codeFiles = feature.codeFiles || [];
  lines.push("├─ Code Files");
  if (codeFiles.length === 0) {
    lines.push("│  └─ (unmapped — no code files registered)");
  } else {
    for (let i = 0; i < codeFiles.length; i++) {
      const prefix = i === codeFiles.length - 1 ? "└─" : "├─";
      lines.push(`│  ${prefix} ${codeFiles[i]}${mark(codeFiles[i])}`);
    }
  }

  // APIs
  const apis = feature.apis || [];
  lines.push("├─ APIs");
  if (apis.length === 0) {
    lines.push("│  └─ (none)");
  } else {
    for (let i = 0; i < apis.length; i++) {
      const prefix = i === apis.length - 1 ? "└─" : "├─";
      lines.push(`│  ${prefix} ${apis[i].method} ${apis[i].path}`);
    }
  }

  // Tests
  const tests = feature.tests || [];
  lines.push("├─ Tests");
  if (tests.length === 0) {
    lines.push("│  └─ (no tests mapped)");
  } else {
    for (let i = 0; i < tests.length; i++) {
      const prefix = i === tests.length - 1 ? "└─" : "├─";
      lines.push(`│  ${prefix} ${typeof tests[i] === "string" ? tests[i] : tests[i].path || tests[i].name}${mark(typeof tests[i] === "string" ? tests[i] : tests[i].path || "")}`);
    }
  }

  // Runbooks
  const runbooks = feature.runbooks || [];
  lines.push("└─ Runbooks");
  if (runbooks.length === 0) {
    lines.push("   └─ (no runbooks)");
  } else {
    for (let i = 0; i < runbooks.length; i++) {
      const prefix = i === runbooks.length - 1 ? "└─" : "├─";
      lines.push(`   ${prefix} ${typeof runbooks[i] === "string" ? runbooks[i] : runbooks[i].path || runbooks[i].name}`);
    }
  }

  return lines.join("\n");
}

/**
 * Build the full Context Boundary text for injection into agent prompt.
 *
 * This is the main entry point for Context Boundary.
 * Given changed files, it:
 * 1. Matches features
 * 2. Builds file trees for each matched feature
 * 3. Lists ALL files in matched features (the allowed scope)
 * 4. Lists UNMATCHED changed files (potential boundary violations)
 *
 * @param {string} rootDir — project root
 * @param {string[]} changedFiles — files that changed
 * @returns {{ boundaryText: string, featureIds: string[], allowedFiles: string[], unmatchedFiles: string[] }}
 */
export function buildContextBoundary(rootDir, changedFiles = []) {
  const data = loadFeatureData(rootDir);
  if (!data) {
    return {
      boundaryText: "(No Feature Map available — run Code Understanding first)",
      featureIds: [],
      allowedFiles: [],
      unmatchedFiles: changedFiles,
    };
  }

  const { features, fileFeatureMap } = data;
  const matched = matchFeaturesForFiles(changedFiles, fileFeatureMap);

  if (matched.size === 0) {
    return {
      boundaryText: "(No features matched for changed files — working without boundary)",
      featureIds: [],
      allowedFiles: [],
      unmatchedFiles: changedFiles,
    };
  }

  // Build file trees for each matched feature
  const parts = [];
  const featureIds = [];
  const allowedFiles = new Set();

  for (const [featId, featMatch] of matched) {
    const feature = features.find(f => f.id === featId);
    if (!feature) continue;

    featureIds.push(featId);
    const tree = buildFeatureFileTree(feature, changedFiles);
    parts.push(tree);

    // Collect all files in this feature as allowed scope
    for (const f of feature.codeFiles || []) allowedFiles.add(f.replace(/\\/g, "/"));
    for (const t of feature.tests || []) {
      const p = typeof t === "string" ? t : t.path || "";
      if (p) allowedFiles.add(p.replace(/\\/g, "/"));
    }
    // Also include the matched files themselves — they may not be in codeFiles yet
    for (const f of featMatch.matchedFiles) allowedFiles.add(f.replace(/\\/g, "/"));
  }

  // Find unmatched changed files
  const unmatchedFiles = changedFiles.filter(f => !allowedFiles.has(f.replace(/\\/g, "/")));

  // Build the boundary text
  let boundaryText = `## 🎯 Feature Context Boundary\n\n`;
  boundaryText += `Active features: ${featureIds.length} | Allowed files: ${allowedFiles.size} | Changed files: ${changedFiles.length}\n\n`;

  for (const tree of parts) {
    boundaryText += "```\n" + tree + "\n```\n\n";
  }

  if (unmatchedFiles.length > 0) {
    boundaryText += `### ⚠️ Changed files outside feature boundary\n`;
    boundaryText += `These files are NOT in the matched features. If you need to modify them, explain why:\n`;
    for (const f of unmatchedFiles) {
      boundaryText += `- ${f}\n`;
    }
    boundaryText += "\n";
  }

  boundaryText += `### Boundary Rules\n`;
  boundaryText += `- Work within the feature files listed above — they are your **context boundary**\n`;
  boundaryText += `- If you must modify a file outside the boundary, use ask_user to explain why first\n`;
  boundaryText += `- Prefer modifying files marked "← changed" — they are already in the diff\n`;

  return {
    boundaryText,
    featureIds,
    allowedFiles: [...allowedFiles],
    unmatchedFiles,
  };
}
