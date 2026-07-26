/**
 * Grafana Adapter
 *
 * 查詢 Grafana dashboard / datasource。
 * 支援: dashboard lookup, datasource query, alert status.
 *
 * 接真實 Grafana 在 init() 設定 baseUrl + API token。
 */

export const id = "grafana";
export const name = "Grafana 監控儀表板";

let _baseUrl = null;
let _headers = {};

export async function init(config) {
  _baseUrl = (config.baseUrl || process.env.GRAFANA_URL || "http://localhost:3000").replace(/\/$/, "");
  const token = config.apiToken || process.env.GRAFANA_API_KEY || process.env.GRAFANA_TOKEN;
  _headers = { "Content-Type": "application/json" };
  if (token) _headers["Authorization"] = `Bearer ${token}`;
}

export const tools = [
  {
    name: "grafana_dashboards",
    description: "搜尋 Grafana dashboard 列表。可用關鍵字過濾。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜尋關鍵字（dashboard 標題）" },
        tag: { type: "string", description: "按標籤過濾" },
        limit: { type: "number", description: "回傳數量上限", default: 20 },
      },
    },
  },
  {
    name: "grafana_datasource_query",
    description: "對 Grafana datasource 執行查詢（Prometheus, InfluxDB, etc.）。",
    inputSchema: {
      type: "object",
      properties: {
        datasource: { type: "string", description: "Datasource 名稱（例如 Prometheus）" },
        expr: { type: "string", description: "查詢表達式（例如 PromQL: up{job=\"api\"}）" },
        range: {
          type: "object",
          properties: {
            from: { type: "string", description: "起始時間（例如 now-1h）" },
            to: { type: "string", description: "結束時間（例如 now）" },
          },
        },
      },
      required: ["datasource", "expr"],
    },
  },
  {
    name: "grafana_alerts",
    description: "查詢 Grafana alert rules 狀態（firing, pending, ok）。",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: ["all", "firing", "pending", "normal", "no_data"],
          description: "警報狀態過濾",
          default: "all",
        },
        dashboard: { type: "string", description: "只看指定 dashboard 的警報" },
      },
    },
  },
];

export async function execute(toolName, args, config) {
  switch (toolName) {
    case "grafana_dashboards":
      return await _searchDashboards(args);
    case "grafana_datasource_query":
      return await _queryDatasource(args);
    case "grafana_alerts":
      return await _getAlerts(args);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

async function _grafanaGet(path) {
  try {
    const resp = await fetch(`${_baseUrl}/api${path}`, { headers: _headers });
    const data = await resp.json();
    if (!resp.ok) return { error: data.message || `Grafana error ${resp.status}` };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function _grafanaPost(path, body) {
  try {
    const resp = await fetch(`${_baseUrl}/api${path}`, {
      method: "POST",
      headers: _headers,
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) return { error: data.message || `Grafana error ${resp.status}` };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function _searchDashboards({ query, tag, limit = 20 }) {
  let path = `/search?limit=${limit}`;
  if (query) path += `&query=${encodeURIComponent(query)}`;
  if (tag) path += `&tag=${encodeURIComponent(tag)}`;

  const result = await _grafanaGet(path);
  if (result.error) return result;

  const dashboards = (Array.isArray(result) ? result : []).map(d => ({
    id: d.id,
    uid: d.uid,
    title: d.title,
    url: d.url,
    tags: d.tags || [],
    folderTitle: d.folderTitle,
  }));

  return { dashboards, count: dashboards.length };
}

async function _queryDatasource({ datasource, expr, range }) {
  const from = range?.from || "now-1h";
  const to = range?.to || "now";

  const result = await _grafanaPost("/ds/query", {
    queries: [{
      refId: "A",
      datasource: { type: "prometheus", uid: datasource },
      expr,
      range: true,
    }],
    from,
    to,
  });

  if (result.error) return result;

  // Extract results
  const frames = result.results?.A?.frames || [];
  const data = frames.map(f => ({
    schema: f.schema?.fields?.map(field => ({ name: field.name, type: field.type })) || [],
    values: f.data?.values || [],
  }));

  return { datasource, expr, from, to, frames: data };
}

async function _getAlerts({ state = "all", dashboard }) {
  let path = "/alertmanager/grafana/api/v2/alerts";
  if (state !== "all") path += `?state=${state}`;

  const result = await _grafanaGet(path);
  if (result.error) return result;

  let alerts = Array.isArray(result) ? result : [];

  if (dashboard) {
    alerts = alerts.filter(a =>
      a.labels?.alertname?.toLowerCase().includes(dashboard.toLowerCase()) ||
      a.annotations?.summary?.toLowerCase().includes(dashboard.toLowerCase())
    );
  }

  return {
    alerts: alerts.map(a => ({
      status: a.status?.state || "unknown",
      name: a.labels?.alertname || "unnamed",
      severity: a.labels?.severity || "info",
      summary: a.annotations?.summary || "",
      startsAt: a.startsAt,
      value: a.value,
    })),
    total: alerts.length,
  };
}
