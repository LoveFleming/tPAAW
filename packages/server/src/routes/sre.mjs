/**
 * SRE Dashboard API
 *
 *   GET /api/sre/status    — Provider 連線狀態 + 配置檢查
 *   GET /api/sre/alerts    — 目前 firing alerts（透過 list_alerts handler）
 *   GET /api/sre/health    — 快速健康檢查摘要
 *   GET /api/sre/actions   — 最近 SRE 決策/操作紀錄
 *   POST /api/sre/query    — 直接執行 PromQL 查詢
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { toolRegistry } from "../lib/tool-registry.mjs";

const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../");
const TOOLS_DIR = resolve(PAAW_ROOT, "data/tools");
const DECISIONS_FILE = resolve(PAAW_ROOT, "data/decisions.json");

// ── Helpers ──

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function getProviderConfig(providerId) {
  const configFile = resolve(TOOLS_DIR, providerId, "config.json");
  if (!existsSync(configFile)) return null;
  try { return JSON.parse(readFileSync(configFile, "utf-8")); } catch { return null; }
}

function isProviderConfigured(providerId) {
  const config = getProviderConfig(providerId);
  if (!config) return false;
  return !!(config.url && config.url.length > 0);
}

function getProviderToolCount(providerId) {
  // Check multi-tool pattern
  const multiDir = resolve(TOOLS_DIR, providerId, "tools");
  const singleFile = resolve(TOOLS_DIR, providerId, "tool.json");
  if (existsSync(multiDir)) {
    return readdirSync(multiDir).filter(f => f.endsWith(".json")).length;
  }
  if (existsSync(singleFile)) return 1;
  return 0;
}

async function callToolHandler(toolName, args) {
  const handler = toolRegistry.getHandler(toolName);
  if (!handler) return { error: `Handler not registered: ${toolName}` };
  try {
    return await handler(args, { toolName });
  } catch (err) {
    return { error: err.message };
  }
}

// ── Route Handler ──

export default async function sreRoutes(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }

  // ── GET /api/sre/status — Provider 連線狀態 ──
  if (req.method === "GET" && path === "/api/sre/status") {
    const providers = [
      { id: "prometheus", label: "Prometheus", emoji: "📊", toolGroup: "sre-prometheus", tools: ["query_promql", "prom_query_range", "list_alerts"] },
      { id: "loki", label: "Loki", emoji: "📋", toolGroup: "sre-loki", tools: ["query_logs", "log_stats"] },
      { id: "k8s", label: "Kubernetes", emoji: "🗂️", toolGroup: "sre-k8s", tools: ["kubectl_get", "kubectl_describe", "kubectl_logs", "kubectl_top", "kubectl_apply"] },
      { id: "shell", label: "Shell", emoji: "🖥️", toolGroup: "sre-shell", tools: ["exec_command", "health_check"] },
      { id: "security", label: "Security", emoji: "🔒", toolGroup: "sre-security", tools: ["scan_rbac", "check_ssl", "scan_deps"] },
      { id: "docs", label: "Runbooks", emoji: "📖", toolGroup: "sre-docs", tools: ["read_runbook", "list_runbooks"] },
    ];

    const status = providers.map(p => {
      const config = getProviderConfig(p.id);
      const configured = isProviderConfigured(p.id);
      const toolCount = getProviderToolCount(p.id);
      const registered = p.tools.every(t => toolRegistry.getHandler(t));
      return {
        ...p,
        configured,
        toolCount,
        registered,
        hasConfig: !!config,
        status: !configured && p.id !== "docs" && p.id !== "security" && p.id !== "shell" ? "pending" : registered ? "ready" : "error",
      };
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ providers: status }));
    return true;
  }

  // ── GET /api/sre/alerts — 目前 firing alerts ──
  if (req.method === "GET" && path === "/api/sre/alerts") {
    if (!isProviderConfigured("prometheus")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ alerts: [], configured: false, message: "Prometheus 未設定" }));
      return true;
    }

    const result = await callToolHandler("list_alerts", { state: "firing" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      alerts: result.data?.data?.alerts || [],
      text: result.text || "",
      configured: true,
    }));
    return true;
  }

  // ── GET /api/sre/health — 快速健康檢查 ──
  if (req.method === "GET" && path === "/api/sre/health") {
    const checks = {};

    // Check kubectl availability
    if (isProviderConfigured("k8s") || true) {
      const k8sResult = await callToolHandler("kubectl_get", { resource: "nodes", output: "name" });
      checks.k8s = {
        available: !k8sResult.error,
        nodes: k8sResult.text ? k8sResult.text.split("\n").filter(Boolean).length : 0,
        raw: k8sResult.error ? k8sResult.error : k8sResult.text?.slice(0, 200),
      };
    }

    // Check prometheus
    if (isProviderConfigured("prometheus")) {
      const promResult = await callToolHandler("query_promql", { query: "up" });
      checks.prometheus = {
        available: !promResult.error,
        targets: promResult.data?.result?.length || 0,
      };
    } else {
      checks.prometheus = { available: false, configured: false };
    }

    // Overall health
    const allHealthy = Object.values(checks).every(c => c.available || c.configured === false);
    checks.overall = {
      healthy: allHealthy,
      timestamp: new Date().toISOString(),
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(checks));
    return true;
  }

  // ── GET /api/sre/actions — 最近 SRE 決策/操作紀錄 ──
  if (req.method === "GET" && path === "/api/sre/actions") {
    let decisions = [];
    if (existsSync(DECISIONS_FILE)) {
      try {
        const data = JSON.parse(readFileSync(DECISIONS_FILE, "utf-8"));
        decisions = (data.decisions || data || [])
          .filter(d => d.agentId?.startsWith("sre-") || d.source?.includes("sre"))
          .slice(-20)
          .reverse();
      } catch {}
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ actions: decisions }));
    return true;
  }

  // ── POST /api/sre/query — 直接執行 PromQL ──
  if (req.method === "POST" && path === "/api/sre/query") {
    try {
      const body = JSON.parse(await readBody(req));
      const { query, range, start, end, step } = body;

      if (!query) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "query is required" }));
        return true;
      }

      let result;
      if (range) {
        result = await callToolHandler("prom_query_range", {
          query,
          start: start || new Date(Date.now() - 3600000).toISOString(),
          end: end || new Date().toISOString(),
          step: step || "60s",
        });
      } else {
        result = await callToolHandler("query_promql", { query });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result }));
      return true;
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  return false;
}
