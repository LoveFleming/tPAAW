/**
 * Prometheus Tool Provider Handler
 *
 * Tools: query_promql, prom_query_range, list_alerts
 *
 * Config (config.json):
 *   { "url": "http://prometheus:9090", "token": "optional-bearer-token" }
 *
 * If no config.url is set, returns a helpful message telling user to configure.
 */

const CONFIG_URL = "url";
const CONFIG_TOKEN = "token";

function getConfigUrl(config) {
  const url = config[CONFIG_URL];
  if (!url) return null;
  return url.replace(/\/+$/, ""); // strip trailing slash
}

function buildHeaders(config) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (config[CONFIG_TOKEN]) {
    headers["Authorization"] = `Bearer ${config[CONFIG_TOKEN]}`;
  }
  return headers;
}

async function fetchProm(baseUrl, path, params, config) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url, {
    method: "GET",
    headers: buildHeaders(config),
    signal: AbortSignal.timeout(15000),
  });
  const data = await resp.json();
  if (!resp.ok) {
    return { error: true, status: resp.status, message: data.error || data.message || `HTTP ${resp.status}` };
  }
  return data;
}

function formatInstantResult(data) {
  if (!data.result) return "（無資料）";
  if (data.resultType === "vector") {
    if (data.result.length === 0) return "（無資料）";
    const lines = data.result.map(r => {
      const labels = r.metric ? Object.entries(r.metric)
        .filter(([k]) => k !== "__name__")
        .map(([k, v]) => `${k}="${v}"`).join(", ") : "";
      const value = Array.isArray(r.value) ? r.value[1] : r.value;
      return `{ ${labels || "result"} } = ${value}`;
    });
    return lines.join("\n");
  }
  if (data.resultType === "scalar") {
    return Array.isArray(data.result) ? data.result[1] : String(data.result);
  }
  return JSON.stringify(data.result, null, 2);
}

function formatRangeResult(data) {
  if (!data.result) return "（無資料）";
  if (data.result.length === 0) return "（無資料）";
  // Summarize each series: label + sample count + last value
  const lines = data.result.map(r => {
    const labels = r.metric ? Object.entries(r.metric)
      .filter(([k]) => k !== "__name__")
      .map(([k, v]) => `${k}="${v}"`).join(", ") : "series";
    const values = r.values || [];
    const lastVal = values.length > 0 ? values[values.length - 1][1] : "N/A";
    return `{ ${labels} } — ${values.length} samples, last=${lastVal}`;
  });
  return lines.join("\n");
}

function formatAlerts(data) {
  if (!data.data?.alerts || data.data.alerts.length === 0) {
    return "✅ 目前沒有 firing alerts";
  }
  return data.data.alerts.map(a => {
    const labels = a.labels || {};
    const annotations = a.annotations || {};
    const severity = labels.severity || "unknown";
    const alertname = labels.alertname || "unknown";
    const emoji = severity === "critical" ? "🔴" : severity === "warning" ? "🟡" : "🔵";
    const summary = annotations.summary || "";
    const description = annotations.description || "";
    return `${emoji} [${severity.toUpperCase()}] ${alertname}\n   ${summary}${description ? `\n   ${description}` : ""}\n   Active at: ${a.activeAt || "?"}`;
  }).join("\n\n");
}

// ── Handler ──

export default async function handler(args, ctx) {
  const toolName = ctx?.toolName || args.__toolName;

  // Load config from the provider context
  // The provider-loader passes config via closure, but for script handlers
  // we need to read it from the provider dir
  const { existsSync, readFileSync } = await import("fs");
  const { resolve } = await import("path");
  const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../../");
  const configFile = resolve(PAAW_ROOT, "data/tools/prometheus/config.json");
  let config = {};
  if (existsSync(configFile)) {
    try { config = JSON.parse(readFileSync(configFile, "utf-8")); } catch {}
  }

  const baseUrl = getConfigUrl(config);
  if (!baseUrl) {
    return {
      text: "⚠️ Prometheus 未設定。請在 data/tools/prometheus/config.json 設定：\n```json\n{ \"url\": \"http://prometheus:9090\" }\n```",
    };
  }

  try {
    // Determine which tool was called based on the handler invocation
    // Since provider-loader registers each tool separately, this handler
    // is actually called per-tool. We detect by the args shape.
    const hasRangeArgs = args.start && args.end;
    const isAlertsCall = args.state !== undefined || args.severity !== undefined || args.__toolName === "list_alerts";

    if (isAlertsCall) {
      // List alerts
      const params = {};
      if (args.state && args.state !== "all") params.state = args.state;
      const data = await fetchProm(baseUrl, "/api/v1/alerts", params, config);
      if (data.error) return { text: `❌ Prometheus API 錯誤：${data.message}`, error: true };
      return { text: formatAlerts(data), data };
    }

    if (hasRangeArgs) {
      // Range query
      const params = {
        query: args.query,
        start: args.start,
        end: args.end,
        step: args.step || "60s",
      };
      const data = await fetchProm(baseUrl, "/api/v1/query_range", params, config);
      if (data.error) return { text: `❌ Prometheus API 錯誤：${data.message}`, error: true };
      return { text: formatRangeResult(data), data };
    }

    // Instant query (default)
    const params = { query: args.query };
    if (args.time) params.time = args.time;
    const data = await fetchProm(baseUrl, "/api/v1/query", params, config);
    if (data.error) return { text: `❌ Prometheus API 錯誤：${data.message}`, error: true };
    return { text: formatInstantResult(data), data };

  } catch (err) {
    return { text: `❌ Prometheus 查詢失敗：${err.message}`, error: true };
  }
}
