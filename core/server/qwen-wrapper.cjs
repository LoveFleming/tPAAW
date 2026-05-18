// Windows wrapper for qwen CLI
// This file lives in a path without spaces, so node-pty can spawn it directly.
// It then requires the actual qwen cli.js which may be under "C:\Program Files\..."
const path = require("path");

// Find qwen cli.js - check common Windows locations
const fs = require("fs");
const appData = process.env.APPDATA || "";
const nodeDir = path.dirname(process.execPath);

const candidates = [
  path.join(nodeDir, "node_modules", "@qwen-code", "qwen-code", "cli.js"),
  path.join(appData, "npm", "node_modules", "@qwen-code", "qwen-code", "dist", "index.js"),
  path.join(appData, "npm", "node_modules", "@qwen-code", "qwen-code", "cli.js"),
  path.join(nodeDir, "node_modules", "@anthropic-ai", "qwen-code", "dist", "cli.js"),
];

let entry = null;
for (const p of candidates) {
  if (fs.existsSync(p)) {
    entry = p;
    console.error(`[qwen-wrapper] Using: ${p}`);
    break;
  }
}

if (!entry) {
  console.error("[qwen-wrapper] ERROR: Could not find qwen cli.js entry point");
  process.exit(1);
}

// Pass through all CLI args
process.argv = [process.argv[0], entry, ...process.argv.slice(2)];

// Load and execute
require(entry);
