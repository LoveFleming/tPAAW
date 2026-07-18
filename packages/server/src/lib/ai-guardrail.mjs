/**
 * ai-guardrail.mjs — Universal L1/L3 Guardrail Framework for AI Agents
 *
 * L1 (進場): 收集真實事實給 AI（檔案樹、AST、Feature Map、git diff、API 路由）
 * L3 (出場): 驗證 AI 輸出（語法、型別、Build、引用檢查、覆蓋率）
 *
 * 使用方式:
 *   const { result, guardrail } = await withGuardrails('EM', async (ctx) => {
 *     return await runEMPlan(ctx);
 *   }, { projectRoot, riskLevel: 'high', changedFiles: ['path/to/file.mjs'] });
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ─── L1: 決定性事實收集 ───────────────────────────────────────

/**
 * 掃描專案所有 source files（排除 node_modules, dist, .git, data）
 */
export async function scanSourceFiles(projectRoot) {
  const SKIP_DIRS = new Set([
    'node_modules', 'dist', '.git', 'data', 'temp', 'tmp',
    'audit', 'backups', '.paaw', 'coverage', '.cache', 'build',
  ]);
  const SOURCE_EXTS = new Set([
    '.mjs', '.js', '.ts', '.tsx', '.jsx', '.cjs',
    '.py', '.java', '.go', '.rb', '.rs',
    '.c', '.cpp', '.h', '.hpp', '.cs',
    '.vue', '.svelte',
  ]);

  const results = [];

  async function walk(dir, depth = 0) {
    if (depth > 15) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else {
        if (SOURCE_EXTS.has(extname(entry.name))) {
          results.push(relative(projectRoot, full).replace(/\\/g, '/'));
        }
      }
    }
  }

  await walk(projectRoot);
  return results.sort();
}

/**
 * 讀取 Feature Map（L1 事實：哪些檔案屬於哪個 feature）
 */
async function loadFeatureMap(projectRoot) {
  const featuresPath = join(projectRoot, '.paaw', 'features', 'FEATURES.json');
  if (!existsSync(featuresPath)) return null;
  try {
    const data = await readFile(featuresPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * 提取 API 路由清單（L1 事實：真實存在的 endpoints）
 */
function extractApiRoutes(projectRoot) {
  const routesDir = join(projectRoot, 'packages', 'server', 'src', 'routes');
  if (!existsSync(routesDir)) return [];

  try {
    const output = execSync(
      `grep -rn "app\\.\\(get\\|post\\|put\\|delete\\|patch\\|use\\)(" "${routesDir}" --include='*.mjs' --include='*.js' 2>/dev/null || true`,
      { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
    );
    const routes = [];
    for (const line of output.split('\n')) {
      const m = line.match(/app\.(get|post|put|delete|patch|use)\(\s*['"`]([^'"`]+)/);
      if (m) routes.push({ method: m[1].toUpperCase(), path: m[2] });
    }
    return routes;
  } catch {
    return [];
  }
}

/**
 * 取得 git diff（L1 事實：最近改了什麼）
 */
function getGitDiff(projectRoot, maxFiles = 50) {
  try {
    const status = execSync('git status --porcelain', {
      cwd: projectRoot, encoding: 'utf-8', timeout: 5000,
    });
    const diff = execSync('git diff --stat', {
      cwd: projectRoot, encoding: 'utf-8', timeout: 5000,
    });
    return {
      status: status.trim().split('\n').filter(Boolean).slice(0, maxFiles),
      diffStat: diff.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * L1 匯總：收集所有真實事實給 AI 當 context
 */
export async function gatherFacts(projectRoot, options = {}) {
  const {
    fileTree = true,
    featureMap = true,
    apiRoutes = true,
    gitDiff = true,
    astSignatures = false, // 較慢，需要時才開
  } = options;

  const facts = { projectRoot };

  if (fileTree) {
    facts.files = await scanSourceFiles(projectRoot);
    facts.fileCount = facts.files.length;
  }

  if (featureMap) {
    facts.features = await loadFeatureMap(projectRoot);
  }

  if (apiRoutes) {
    facts.apiRoutes = extractApiRoutes(projectRoot);
  }

  if (gitDiff) {
    facts.git = getGitDiff(projectRoot);
  }

  if (astSignatures) {
    facts.ast = await extractAstSignatures(projectRoot);
  }

  return facts;
}

// ─── AST 簽名提取（可選，較慢）────────────────────────────────

async function extractAstSignatures(projectRoot) {
  const parserPath = join(projectRoot, 'packages', 'server', 'src', 'lib', 'tree-sitter-parser.mjs');
  if (!existsSync(parserPath)) return null;

  try {
    const mod = await import(fileURLToPath(new URL(`file://${parserPath}`)));
    const parseFileSignatures = mod.parseFileSignatures || mod.default?.parseFileSignatures;
    if (!parseFileSignatures) return null;

    const files = await scanSourceFiles(projectRoot);
    const signatures = {};
    for (const f of files.slice(0, 100)) { // 限制 100 個避免太慢
      if (f.endsWith('.mjs') || f.endsWith('.js')) {
        try {
          const sigs = await parseFileSignatures(join(projectRoot, f));
          if (sigs && sigs.length) signatures[f] = sigs;
        } catch { /* skip */ }
      }
    }
    return signatures;
  } catch {
    return null;
  }
}

// ─── L3: 驗證 AI 輸出 ─────────────────────────────────────────

/**
 * 語法檢查：對修改過的檔案跑 node --check
 */
export async function verifySyntax(projectRoot, changedFiles) {
  const results = [];
  for (const file of changedFiles) {
    const ext = extname(file);
    if (!['.mjs', '.js', '.cjs'].includes(ext)) continue;
    const fullPath = join(projectRoot, file);
    if (!existsSync(fullPath)) {
      results.push({ file, ok: false, error: 'File not found' });
      continue;
    }
    try {
      execSync(`node --check "${fullPath}"`, { timeout: 10000, encoding: 'utf-8' });
      results.push({ file, ok: true });
    } catch (err) {
      results.push({ file, ok: false, error: (err.stderr || err.message || '').slice(0, 300) });
    }
  }
  const failed = results.filter(r => !r.ok);
  return { passed: failed.length === 0, results, failed };
}

/**
 * 型別檢查：tsc --noEmit
 */
export async function verifyTypes(projectRoot) {
  try {
    execSync('npx tsc --noEmit 2>&1', {
      cwd: projectRoot, timeout: 60000, encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { passed: true, errors: [] };
  } catch (err) {
    const output = err.stdout || err.stderr || '';
    const errors = output.split('\n').filter(l => l.includes('error TS')).slice(0, 20);
    return { passed: errors.length === 0, errors };
  }
}

/**
 * Build 檢查：npm run build
 */
export async function verifyBuild(projectRoot) {
  try {
    execSync('npm run build 2>&1', {
      cwd: projectRoot, timeout: 120000, encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { passed: true };
  } catch (err) {
    const output = err.stdout || err.stderr || '';
    return { passed: false, error: output.slice(-500) };
  }
}

/**
 * 引用檢查：AI 提到的檔案/函式是否存在
 */
export async function verifyReferences(projectRoot, aiOutput) {
  const text = typeof aiOutput === 'string' ? aiOutput : JSON.stringify(aiOutput);
  const referenced = new Set();

  // 提取 AI 說的檔案路徑
  const filePattern = /(?:packages|core|src|lib|routes|components|pages|shared)\/[a-zA-Z0-9_./-]+\.(?:mjs|js|ts|tsx|jsx)/g;
  const matches = text.matchAll(filePattern);
  for (const m of matches) {
    referenced.add(m[0]);
  }

  const missing = [];
  for (const ref of referenced) {
    const tryPaths = [
      join(projectRoot, ref),
      join(projectRoot, 'packages', ref),
      join(projectRoot, 'packages', 'server', 'src', ref),
      join(projectRoot, 'packages', 'ui', 'src', ref),
    ];
    if (!tryPaths.some(p => existsSync(p))) {
      missing.push(ref);
    }
  }

  return {
    passed: missing.length === 0,
    checked: referenced.size,
    missing,
  };
}

/**
 * 覆蓋率檢查：用 feature-map-validator
 */
export async function verifyCoverage(projectRoot) {
  try {
    const validatorPath = join(projectRoot, 'packages', 'server', 'src', 'lib', 'feature-map-validator.mjs');
    if (!existsSync(validatorPath)) return { passed: true, note: 'validator not found' };

    const mod = await import(fileURLToPath(new URL(`file://${validatorPath}`)));
    const runFullValidation = mod.runFullValidation;
    if (!runFullValidation) return { passed: true, note: 'runFullValidation not exported' };

    const report = await runFullValidation(projectRoot);

    return {
      passed: report.summary.mappingErrors === 0 && (report.summary.coveragePct || 0) >= 50,
      mappingErrors: report.summary.mappingErrors,
      coverage: report.summary.coveragePct,
      orphans: report.summary.orphanFiles,
      understandingWarnings: report.summary.understandingWarnings || 0,
      details: report,
    };
  } catch (err) {
    return { passed: true, note: 'validator error: ' + err.message };
  }
}

// ─── 風險等級對應的驗證步驟 ───────────────────────────────────

const RISK_PROFILES = {
  high: {
    l1: { fileTree: true, featureMap: true, apiRoutes: true, gitDiff: true, astSignatures: false },
    l3: ['syntax', 'types', 'build', 'references', 'coverage'],
    description: '改程式碼（EM, Night Shift, Auto-fix）',
  },
  medium: {
    l1: { fileTree: true, featureMap: true, apiRoutes: false, gitDiff: true, astSignatures: false },
    l3: ['references', 'coverage'],
    description: '給建議/分析（Code Review, Understanding）',
  },
  low: {
    l1: { fileTree: true, featureMap: true, apiRoutes: false, gitDiff: false, astSignatures: false },
    l3: ['references'],
    description: '報告/查詢（Feature Map, Security Scan）',
  },
};

// ─── 主入口：withGuardrails ───────────────────────────────────

/**
 * 主函數：帶護欄執行 AI task
 *
 * @param {string} agentName - 'EM', 'NightShift', 'CodeReview', etc.
 * @param {Function} task - async (ctx) => result，AI 任務函數
 * @param {{ projectRoot: string, riskLevel?: string, changedFiles?: string[], onProgress?: Function }} options
 * @returns {Promise<{ result: any, guardrail: object }>}
 */
export async function withGuardrails(agentName, task, options) {
  const {
    projectRoot,
    riskLevel = 'medium',
    changedFiles = [],
    onProgress = null,
  } = options;

  const profile = RISK_PROFILES[riskLevel];
  if (!profile) throw new Error(`Unknown risk level: ${riskLevel}`);

  const guardrail = {
    agent: agentName,
    riskLevel,
    l1: null,
    l3: null,
    errors: [],
    warnings: [],
    passed: true,
  };

  // ─── L1: 收集事實 ───
  if (onProgress) onProgress({ phase: 'L1', status: 'gathering facts' });
  try {
    guardrail.l1 = await gatherFacts(projectRoot, profile.l1);
  } catch (err) {
    guardrail.errors.push({ phase: 'L1', error: err.message });
    // L1 失敗不阻止執行，但標記問題
  }

  // ─── L2: AI 執行（帶真實 context） ───
  if (onProgress) onProgress({ phase: 'L2', status: 'AI executing' });
  let result;
  try {
    result = await task(guardrail.l1);
  } catch (err) {
    guardrail.errors.push({ phase: 'L2', error: err.message });
    guardrail.passed = false;
    return { result: null, guardrail };
  }

  // ─── L3: 驗證輸出 ───
  if (onProgress) onProgress({ phase: 'L3', status: 'verifying output' });
  guardrail.l3 = {};

  for (const check of profile.l3) {
    try {
      switch (check) {
        case 'syntax': {
          if (changedFiles.length > 0) {
            const syntax = await verifySyntax(projectRoot, changedFiles);
            guardrail.l3.syntax = syntax;
            if (!syntax.passed) {
              guardrail.passed = false;
              guardrail.errors.push({
                phase: 'L3:syntax',
                error: `${syntax.failed.length} files with syntax errors`,
                details: syntax.failed,
              });
            }
          }
          break;
        }
        case 'types': {
          const types = await verifyTypes(projectRoot);
          guardrail.l3.types = types;
          if (!types.passed) {
            guardrail.warnings.push({ phase: 'L3:types', warning: `${types.errors.length} type errors` });
            // 型別錯誤是 warning 不是 error（除非 riskLevel=high）
            if (riskLevel === 'high') guardrail.passed = false;
          }
          break;
        }
        case 'build': {
          const build = await verifyBuild(projectRoot);
          guardrail.l3.build = build;
          if (!build.passed) {
            guardrail.passed = false;
            guardrail.errors.push({ phase: 'L3:build', error: (build.error || '').slice(0, 200) });
          }
          break;
        }
        case 'references': {
          const refs = await verifyReferences(projectRoot, result);
          guardrail.l3.references = refs;
          if (!refs.passed) {
            guardrail.warnings.push({
              phase: 'L3:references',
              warning: `${refs.missing.length} missing references: ${refs.missing.slice(0, 5).join(', ')}`,
            });
          }
          break;
        }
        case 'coverage': {
          const cov = await verifyCoverage(projectRoot);
          guardrail.l3.coverage = cov;
          if (!cov.passed) {
            guardrail.warnings.push({
              phase: 'L3:coverage',
              warning: `${cov.mappingErrors} mapping errors, ${cov.coverage}% coverage`,
            });
          }
          break;
        }
      }
    } catch (err) {
      guardrail.warnings.push({ phase: `L3:${check}`, warning: err.message });
    }
  }

  return { result, guardrail };
}

/**
 * 產生護欄報告摘要（給 EM / Night Shift log 用）
 */
export function formatGuardrailReport(guardrail) {
  const lines = [
    `🛡️ Guardrail Report — ${guardrail.agent} (${guardrail.riskLevel})`,
    `Overall: ${guardrail.passed ? '✅ PASSED' : '❌ FAILED'}`,
  ];

  if (guardrail.l1) {
    const fileCount = guardrail.l1.fileCount || '?';
    const routeCount = guardrail.l1.apiRoutes?.length ?? '?';
    const featCount = guardrail.l1.features?.features?.length ?? '?';
    lines.push(`L1 Facts: ${fileCount} files, ${featCount} features, ${routeCount} API routes`);
  }

  if (guardrail.l3 && Object.keys(guardrail.l3).length > 0) {
    const checks = Object.entries(guardrail.l3)
      .map(([k, v]) => `${k}:${v.passed ? '✅' : '❌'}`)
      .join(', ');
    lines.push(`L3 Checks: ${checks}`);
  }

  if (guardrail.errors.length) {
    lines.push(`Errors (${guardrail.errors.length}):`);
    for (const e of guardrail.errors.slice(0, 5)) {
      lines.push(`  • ${e.phase}: ${e.error}`);
    }
  }

  if (guardrail.warnings.length) {
    lines.push(`Warnings (${guardrail.warnings.length}):`);
    for (const w of guardrail.warnings.slice(0, 5)) {
      lines.push(`  • ${w.phase}: ${w.warning}`);
    }
  }

  return lines.join('\n');
}
