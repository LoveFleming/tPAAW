#!/usr/bin/env node
/**
 * dev-services.sh equivalent — starts all three services for development
 *
 * Usage:
 *   node src/lib/sandbox/start-services.mjs
 *
 * Starts:
 *   1. CLI Service    :4099  (CLI execution, PTY)
 *   2. File Service   :4100  (file sync, review gate)
 *   3. PAAW Server    :4097  (API + UI) + :4098 (PTY WS, proxied)
 *
 * In production: CLI Service + File Service run in Docker sandbox,
 *               PAAW Server runs on host.
 */

import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");

const services = [
  {
    name: "CLI-SVC",
    script: resolve(__dirname, "cli-service.mjs"),
    env: { CLI_SERVICE_PORT: "4099" },
    color: "\x1b[36m", // cyan
  },
  {
    name: "FILE-SVC",
    script: resolve(__dirname, "file-service.mjs"),
    env: { FILE_SERVICE_PORT: "4100" },
    color: "\x1b[35m", // magenta
  },
  {
    name: "PAAW",
    script: resolve(__dirname, "../../paaw-server.mjs"),
    env: {
      PAAW_PORT: "4097",
      PAAW_WS_PORT: "4098",
      CLI_SERVICE_URL: "http://localhost:4099",
      FILE_SERVICE_URL: "http://localhost:4100",
      PAAW_USE_REMOTE_CLI: "true",
    },
    color: "\x1b[32m", // green
  },
];

console.log("🚀 Starting PAAW sandbox services...\n");

const procs = [];

for (const svc of services) {
  const proc = spawn("node", [svc.script], {
    env: { ...process.env, ...svc.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  procs.push(proc);

  const prefix = `${svc.color}[${svc.name}]\x1b[0m`;

  proc.stdout.on("data", (data) => {
    data.toString().split("\n").filter(Boolean).forEach(line => {
      console.log(`${prefix} ${line}`);
    });
  });

  proc.stderr.on("data", (data) => {
    data.toString().split("\n").filter(Boolean).forEach(line => {
      console.error(`${prefix} ${line}`);
    });
  });

  proc.on("exit", (code) => {
    console.log(`${prefix} exited with code ${code}`);
  });
}

// ── Graceful shutdown ──

function shutdown() {
  console.log("\n🛑 Shutting down...");
  for (const proc of procs) {
    proc.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
