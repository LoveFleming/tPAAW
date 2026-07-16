/**
 * import-check.mjs — Startup import validation
 * 
 * Catches missing exports, wrong function names, and broken imports
 * BEFORE user hits the endpoint at runtime.
 * 
 * Add to server startup: node packages/server/src/lib/import-check.mjs
 */

const CHECKS = [
  // [module path, expected exports]
  ["../lib/paaw-agent-loop.mjs", ["resolveLLMConfig", "setAgentConfig", "callLLM", "runAgentLoop", "runAgentLoopStream", "trimMessagesToFit"]],
  ["../lib/semgrep-runner.mjs", ["runSemgrep", "diagnoseSemgrep", "isSemgrepAvailable", "buildFullScanCommand", "detectRulePacks", "formatForAI", "formatCondensed"]],
  ["../lib/paaw-project.mjs", ["createPaawProject"]],
  ["../lib/domain-agent-registry.mjs", ["getAgentByCrewId", "buildSystemPrompt"]],
  ["../lib/action-log.mjs", ["listActionLog", "loadAgentMemory"]],
  ["../lib/bridge/paaw-bridge.mjs", []],
  ["../routes/shared.mjs", ["PORT", "PAAW_ROOT"]],
  ["../routes/coding.mjs", []],
  ["../routes/a2a.mjs", []],
];

async function checkImports() {
  const errors = [];
  const warnings = [];

  for (const [modPath, expectedExports] of CHECKS) {
    try {
      const mod = await import(modPath);
      
      for (const name of expectedExports) {
        if (!(name in mod)) {
          errors.push(`❌ ${modPath}: missing export "${name}"`);
        } else if (typeof mod[name] === "undefined") {
          errors.push(`❌ ${modPath}: export "${name}" is undefined`);
        }
      }

      // Also check: are there dynamic imports inside this module that might fail?
      // (We can't statically analyze those, but we log what's available)
      const available = Object.keys(mod).filter(k => k !== "default" && typeof mod[k] !== "undefined");
      if (expectedExports.length > 0) {
        console.log(`✅ ${modPath}: ${available.join(", ")}`);
      }
    } catch (e) {
      errors.push(`❌ ${modPath}: import failed — ${e.message}`);
    }
  }

  // Also check: dynamic imports used in route files
  const DYNAMIC_IMPORTS = [
    // coding.mjs uses these
    { file: "../routes/coding.mjs", imports: [
      { from: "../lib/paaw-agent-loop.mjs", names: ["trimMessagesToFit"] },
      { from: "../lib/semgrep-runner.mjs", names: ["runSemgrep", "diagnoseSemgrep", "buildFullScanCommand", "detectRulePacks"] },
    ]},
    { file: "../routes/a2a.mjs", imports: [
      { from: "../lib/paaw-agent-loop.mjs", names: ["trimMessagesToFit"] },
    ]},
  ];

  for (const check of DYNAMIC_IMPORTS) {
    for (const imp of check.imports) {
      try {
        const mod = await import(imp.from);
        for (const name of imp.names) {
          if (!(name in mod)) {
            errors.push(`❌ ${check.file} imports "${name}" from ${imp.from} — NOT EXPORTED`);
          } else if (typeof mod[name] === "undefined") {
            errors.push(`❌ ${check.file} imports "${name}" from ${imp.from} — undefined`);
          }
        }
      } catch (e) {
        errors.push(`❌ ${check.file} → ${imp.from}: import failed — ${e.message}`);
      }
    }
  }

  console.log("\n═══ Import Check Results ═══");
  if (errors.length === 0) {
    console.log("✅ All imports OK — no missing exports\n");
  } else {
    console.log("❌ Found issues:\n");
    for (const e of errors) console.log(e);
    console.log("");
  }

  if (warnings.length > 0) {
    console.log("⚠️ Warnings:");
    for (const w of warnings) console.log(w);
    console.log("");
  }

  return errors.length === 0;
}

// Run
const isStandalone = process.argv[1]?.endsWith("import-check.mjs");
const strict = process.argv.includes("--strict");

checkImports().then(ok => {
  if (isStandalone && strict) {
    process.exit(ok ? 0 : 1);
  } else if (!ok) {
    console.log("[PAAW] ⚠️ Import check found issues — some features may fail at runtime\n");
  }
}).catch(e => {
  console.error("[PAAW] Import check crashed (non-fatal):", e.message);
  if (isStandalone && strict) process.exit(2);
});
