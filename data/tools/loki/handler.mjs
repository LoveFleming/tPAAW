/**
 * Loki Tool Provider Handler
 *
 * Tools: query_logs, log_stats
 *
 * Config (config.json):
 *   { "url": "http://loki:3100", "token": "optional" }
 */

const { existsSync, readFileSync } = await import("fs");
const { resolve } = await import("path");
const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../../");
const configFile = resolve(PAAW_ROOT, "data/tools/loki/config.json");
let config = {};
if (existsSync(configFile)) {
  try { config = JSON.parse(readFileSync(configFile, "utf-8")); } catch {}
}

function getBaseUrl() {
  const url = config.url;
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

function buildHeaders() {
  const headers = {};
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;
  return headers;
}

function formatLogResults(data) {
  if (!data.data?.result) return "（無 log）";
  if (data.data.result.length === 0) return "（無 log）";
  const streams = data.data.result;
  const lines = [];
  for (const stream of streams) {
    const labels = stream.stream ? Object.entries(stream.stream)
      .map(([k, v]) => `${k}="${v}"`).join(" ") : "";
    lines.push(`📊 { ${labels} } (${stream.values?.length || 0} entries)`);
    const values = stream.values || [];
    const showCount = Math.min(values.length, 50); // cap output
    for (let i = 0; i < showCount; i++) {
      const v = values[i];
      const ts = v[0];
      const text = v[1];
      // Convert nanosecond timestamp to readable time
      const date = new Date(Number(ts) / 1_000_000);
      const timeStr = date.toTimeString().slice(0, 8);
      lines.push(`  ${timeStr} ${text}`);
    }
    if (values.length > showCount) {
      lines.push(`  ... and ${values.length - showCount} more`);
    }
  }
  return lines.join("\n");
}

function formatStatsResults(data) {
  if (!data.data?.result) return "（無資料）";
  if (data.data.result.length === 0) return "（無資料）";
  const lines = data.data.result.map(r => {
    const labels = r.metric ? Object.entries(r.metric)
      .filter(([k]) => k !== "__name__")
      .map(([k, v]) => `${k}="${v}"`).join(", ") : "series";
    const values = r.values || [];
    const lastVal = values.length > 0 ? values[values.length - 1][1] : "N/A";
    return `{ ${labels} } — last=${lastVal} (${values.length} samples)`;
  });
  return lines.join("\n");
}

export default async function handler(args, ctx) {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return {
      text: "⚠️ Loki 未設定。請在 data/tools/loki/config.json 設定：\n```json\n{ \"url\": \"http://loki:3100\" }\n```",
    };
  }

  try {
    const hasStep = !!args.step;
    const isStats = hasStep; // log_stats has step, query_logs doesn't

    if (isStats) {
      // Range query (metric query for stats)
      const params = new URLSearchParams({
        query: args.query,
        start: args.start || new Date(Date.now() - 3600000).toISOString(),
        end: args.end || new Date().toISOString(),
        step: args.step || "5m",
      });
      const resp = await fetch(`${baseUrl}/loki/api/v1/query_range?${params}`, {
        headers: buildHeaders(),
        signal: AbortSignal.timeout(15000),
      });
      const data = await resp.json();
      if (!resp.ok) return { text: `❌ Loki API 錯誤：${data.error || resp.status}`, error: true };
      return { text: formatStatsResults(data), data };
    }

    // Log query
    const params = new URLSearchParams({
      query: args.query,
      limit: String(args.limit || 100),
      start: args.start || new Date(Date.now() - 3600000).toISOString(),
      end: args.end || new Date().toISOString(),
    });
    const resp = await fetch(`${baseUrl}/loki/api/v1/query_range?${params}`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    const data = await resp.json();
    if (!resp.ok) return { text: `❌ Loki API 錯誤：${data.error || resp.status}`, error: true };
    return { text: formatLogResults(data), data };

  } catch (err) {
    return { text: `❌ Loki 查詢失敗：${err.message}`, error: true };
  }
}
