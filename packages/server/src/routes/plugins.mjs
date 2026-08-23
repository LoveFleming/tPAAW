/**
 * Plugins API — manage external plugin integrations
 *
 * GET  /api/plugins          — list all plugins
 * POST /api/plugins          — save plugins config
 * GET  /api/plugins/:id      — get one plugin
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { readBody, json, PATHS } from "./context.mjs";

const rawUrl_path = (req) => (req.url || "").split("?")[0];

const CONFIG_FILE = join(PATHS.CONFIG_ROOT, "plugins.json");

export async function handlePluginRoutes(req, res) {
  const path = rawUrl_path(req);
  // GET /api/plugins
  if (req.method === "GET" && path === "/api/plugins") {
    let config = {};
    try {
      if (existsSync(CONFIG_FILE)) config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) || {};
    } catch (err) {
      config = {};
    }
    try {
      const plugins = Object.entries(config).map(([id, p]) => ({
        id,
        name: p.name || id,
        icon: p.icon || "🔌",
        url: p.url || "",
        enabled: p.enabled !== false,
      }));
      json(res, { plugins });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // POST /api/plugins — save full config
  if (req.method === "POST" && path === "/api/plugins") {
    try {
      const body = JSON.parse(await readBody(req));
      await mkdir(PATHS.CONFIG_ROOT, { recursive: true });
      await writeFile(CONFIG_FILE, JSON.stringify(body, null, 2), "utf-8");
      json(res, { ok: true });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  return false;
}

export default handlePluginRoutes;
