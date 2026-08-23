/**
 * Agentic Bindings API — 管理聊天工具 ↔ Agentic Platform workflow 的綁定
 *
 * GET   /api/agentic-bindings         — 列出所有 bindings
 * POST  /api/agentic-bindings         — 儲存全部 bindings
 * POST  /api/agentic-bindings/:id/run — 手動啟動某個 workflow（測試用）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { readBody, json, PATHS } from "./context.mjs";

const CONFIG_FILE = join(PATHS.CONFIG_ROOT, "agentic-bindings.json");

function _readConfig() {
  // 缺檔/壞檔回空 — 不自動寫預設（ensure-default pattern 已拔）
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) || {};
  } catch {
    return {};
  }
}

async function _writeConfig(config) {
  mkdirSync(PATHS.CONFIG_ROOT, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export default async function agenticBindingRoutes(req, res) {
  const path = (req.url || "").split("?")[0];

  // GET /api/agentic-bindings
  if (req.method === "GET" && path === "/api/agentic-bindings") {
    try {
      const config = _readConfig();
      const bindings = Object.entries(config).map(([id, b]) => ({
        id,
        ...b,
        defaults: b.defaults || {},
      }));
      json(res, { bindings });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // POST /api/agentic-bindings — save all
  if (req.method === "POST" && path === "/api/agentic-bindings") {
    try {
      const body = JSON.parse(await readBody(req));
      await _writeConfig(body);

      // Reload tool registry
      const { reloadBindings } = await import("../lib/agentic-binding.mjs");
      reloadBindings(PATHS.CONFIG_ROOT);

      json(res, { ok: true });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/agentic-bindings/:id/runs — 從 Agentic Platform 拉執行歷史
  if (req.method === "GET" && path.includes("/api/agentic-bindings/") && path.endsWith("/runs")) {
    const id = path.split("/api/agentic-bindings/")[1].replace("/runs", "");
    const config = _readConfig();
    const binding = config[id];
    if (!binding) { json(res, { error: "Binding not found" }, 404); return true; }

    try {
      const baseUrl = binding.agenticPlatformUrl || "http://localhost:4200";
      const resp = await fetch(`${baseUrl}/api/runs`);
      const data = await resp.json();
      json(res, data);
    } catch (err) {
      json(res, { error: err.message, active: [], count: 0 });
    }
    return true;
  }

  return false;
}
