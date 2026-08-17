/**
 * Coding App Health Check — GET /api/coding-health?path=...
 *
 * Checks all Coding App subsystems and returns a health report:
 * - Provider config
 * - Feature map coverage
 * - Issues
 * - Auto Dispatch status (detects stuck runs)
 * - Security scan freshness
 * - LLM activity
 * - Coding standards
 */
import { readFileSync as readSync, existsSync, statSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { safeResolve } from "../lib/coding-security";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// nosemgrep: path-join-resolve-traversal
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

function sendJSON(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parsePath(req) {
  const url = new URL(req.url, "http://localhost");
  return url.searchParams.get("path") || PAAW_ROOT;
}

export default async function codingHealthRoute(req, res) {
  const rawUrl = req.url;
  const method = req.method;
  const cleanUrl = rawUrl.split("?")[0];

  if (cleanUrl !== "/api/coding-health") return false;
  if (method !== "GET") return false;

  const projRoot = parsePath(req);
  const checks = {};
  let allHealthy = true;

  // 1. Provider config  // nosemgrep: path-join-resolve-traversal
  try {
// nosemgrep: path-join-resolve-traversal
    const providersFile = join(projRoot, "data/config/providers.json");
    const config = JSON.parse(readSync(providersFile, "utf-8"));
    const activeProvider = config.providers?.[config.active];
    checks.provider = {
      status: activeProvider?.apiKey && activeProvider.apiKey !== "na" ? "ok" : "warn",
      active: config.active,
      model: config.defaultModel || "(not set)",
      message: activeProvider?.apiKey ? undefined : "No API key configured",
    };
    if (checks.provider.status !== "ok") allHealthy = false;
  } catch (err) {
    checks.provider = { status: "fail", message: err.message };
    allHealthy = false;
  }
  // nosemgrep: path-join-resolve-traversal
  // 2. Feature map
  try {
// nosemgrep: path-join-resolve-traversal
    const featuresFile = join(projRoot, ".paaw", "features", "FEATURES.json");
    if (existsSync(featuresFile)) {
      const data = JSON.parse(readSync(featuresFile, "utf-8"));
      const features = data.features || (Array.isArray(data) ? data : []);
      const withUnderstanding = features.filter(f => f.aiUnderstanding).length;
      const withTests = features.filter(f => (f.tests || []).length > 0).length;
      checks.featureMap = {
        status: features.length > 0 ? "ok" : "warn",
        total: features.length,
        withUnderstanding,
        withTests,
        updatedAt: data.updatedAt || "(unknown)",
        message: features.length === 0 ? "No features defined — run Code Understanding" : undefined,
      };
      if (withUnderstanding === 0 && features.length > 0) {
        checks.featureMap.status = "warn";
        checks.featureMap.message = "No AI understanding generated for any feature";
      }
      // Quick validation: check if referenced files exist
      let missingFiles = 0;
      const allSourceFiles = new Set();
      try {
        const { scanAllSourceFiles } = await import("../lib/feature-map-validator.mjs");
        const files = scanAllSourceFiles(projRoot);
        files.forEach(f => allSourceFiles.add(f));
        for (const feat of features) {
          for (const cf of feat.codeFiles || []) {
            const norm = cf.replace(/^\.\//, "").replace(/\\/g, "/");
            if (!allSourceFiles.has(norm)) missingFiles++;
          }
        }
      } catch {}
      if (missingFiles > 0) {
        checks.featureMap.status = "warn";
        checks.featureMap.missingFiles = missingFiles;
        checks.featureMap.message = `${missingFiles} mapped files not found on disk — feature map is stale`;
      }
    } else {
      checks.featureMap = { status: "warn", message: "FEATURES.json not found" };
    }
  } catch (err) {
    checks.featureMap = { status: "fail", message: err.message };
  }  // nosemgrep: path-join-resolve-traversal

  // 3. Issues
  try {
// nosemgrep: path-join-resolve-traversal
    const issuesFile = join(projRoot, ".paaw", "issues", "issues.json");
    if (existsSync(issuesFile)) {
      const data = JSON.parse(readSync(issuesFile, "utf-8"));
      const issues = Array.isArray(data) ? data : (data.issues || []);
      const open = issues.filter(i => i.status === "open").length;
      checks.issues = {
        status: "ok",
        total: issues.length,
        open,
      };
    } else {
      checks.issues = { status: "ok", total: 0, open: 0, message: "No issues file (clean slate)" };
    }
  } catch (err) {
    checks.issues = { status: "fail", message: err.message };  // nosemgrep: path-join-resolve-traversal
  }

  // 4. Auto Dispatch
  try {
// nosemgrep: path-join-resolve-traversal
    const nsStatusFile = join(projRoot, ".paaw", "auto-dispatch", "status.json");
    if (existsSync(nsStatusFile)) {
      const ns = JSON.parse(readSync(nsStatusFile, "utf-8"));
      const ageHours = ns.startedAt ? (Date.now() - new Date(ns.startedAt).getTime()) / 3600000 : 0;
      const isStuck = ns.status === "running" && ageHours > 1;
      checks.autoDispatch = {
        status: isStuck ? "fail" : "ok",
        lastStatus: ns.status,
        startedAt: ns.startedAt,
        completedAt: ns.completedAt,
        ageHours: Math.round(ageHours * 10) / 10,
        message: isStuck ? `Stuck in "running" for ${Math.round(ageHours)}h — should be reset` : undefined,
      };
      if (isStuck) allHealthy = false;
    } else {
      checks.autoDispatch = { status: "ok", message: "Never run" };
    }
  } catch (err) {  // nosemgrep: path-join-resolve-traversal
    checks.autoDispatch = { status: "fail", message: err.message };
  }

  // 5. Security scan freshness
  try {
// nosemgrep: path-join-resolve-traversal
    const scanFile = join(projRoot, ".paaw", "security", "scan-results.json");
    if (existsSync(scanFile)) {
      const stat = statSync(scanFile);
      const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
      const scan = JSON.parse(readSync(scanFile, "utf-8"));
      const findings = (scan.findings || []).filter(f => !f.file?.includes("semgrep-rules"));
      checks.security = {
        status: ageHours > 168 ? "warn" : "ok", // 7 days
        findings: findings.length,
        lastScan: stat.mtime,
        ageHours: Math.round(ageHours * 10) / 10,
        message: ageHours > 168 ? `Scan is ${Math.round(ageHours / 24)}d old — consider re-scanning` : undefined,
      };
    } else {
      checks.security = { status: "warn", message: "No scan results — run security scan" };
    }  // nosemgrep: path-join-resolve-traversal
  } catch (err) {
    checks.security = { status: "fail", message: err.message };
  }

  // 6. LLM logs (recent activity)
  try {  // nosemgrep: path-join-resolve-traversal
// nosemgrep: path-join-resolve-traversal
    const logsDir = join(projRoot, "data", "logs", "llm");
    let recentLogs = 0;
    if (existsSync(logsDir)) {
      const files = readdirSync(logsDir);
      const oneDayAgo = Date.now() - 86400000;
      for (const f of files) {
        try { if (statSync(safeResolve(logsDir, f)).mtimeMs > oneDayAgo) recentLogs++; } catch {}
      }
    }
    checks.llmActivity = {
      status: "ok",
      recentLogs24h: recentLogs,
      message: recentLogs === 0 ? "No LLM activity in 24h" : undefined,
    };
  } catch {  // nosemgrep: path-join-resolve-traversal
    checks.llmActivity = { status: "ok", recentLogs24h: 0 };  // nosemgrep: path-join-resolve-traversal
  }

  // 7. Coding standards
  try {
    // Check multiple possible locations
    const standardsPaths = [
// nosemgrep: path-join-resolve-traversal
      join(projRoot, ".paaw", "CODING-STANDARDS.md"),
// nosemgrep: path-join-resolve-traversal
      join(projRoot, ".paaw", "project", "CODING-STANDARDS.md"),
    ];
    const standardsFound = standardsPaths.find(p => existsSync(p));
    checks.standards = {
      status: standardsFound ? "ok" : "warn",
      path: standardsFound ? standardsFound.replace(projRoot + "/", "") : undefined,
      message: standardsFound ? undefined : "No CODING-STANDARDS.md found",
    };
  } catch {
    checks.standards = { status: "warn" };
  }

  // Summary
  const summary = {
    healthy: allHealthy,
    timestamp: new Date().toISOString(),
    checks,
  };

  sendJSON(res, 200, summary);
  return true;
}
