/**
 * Elasticsearch Adapter
 *
 * 搜尋公司 Elasticsearch / OpenSearch。
 * 支援: full-text search, aggregation, doc count.
 *
 * 接真實 ES 只要在 init() 設定 baseUrl + credentials。
 */

export const id = "elasticsearch";
export const name = "Elasticsearch 搜尋引擎";

let _client = null;
let _baseUrl = null;
let _headers = {};

export async function init(config) {
  _baseUrl = config.baseUrl || process.env.ES_URL || "http://localhost:9200";
  const username = config.username || process.env.ES_USER;
  const password = config.password || process.env.ES_PASS;
  const apiKey = config.apiKey || process.env.ES_API_KEY;

  _headers = { "Content-Type": "application/json" };
  if (apiKey) {
    _headers["Authorization"] = `ApiKey ${apiKey}`;
  } else if (username && password) {
    _headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }
}

export const tools = [
  {
    name: "es_search",
    description: "在 Elasticsearch 中執行全文搜尋。回傳匹配的文件列表。",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "string", description: "索引名稱（例如 logs-*, users, articles）" },
        query: { type: "string", description: "搜尋關鍵字（Lucene query syntax）" },
        size: { type: "number", description: "回傳筆數上限（預設 10）", default: 10 },
        fields: { type: "array", items: { type: "string" }, description: "只回傳指定欄位" },
      },
      required: ["index", "query"],
    },
  },
  {
    name: "es_count",
    description: "計算 Elasticsearch 索引中匹配查詢的文件數量。",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "string", description: "索引名稱" },
        query: { type: "string", description: "搜尋查詢（match_all 表示全部）" },
      },
      required: ["index"],
    },
  },
  {
    name: "es_aggregate",
    description: "對 Elasticsearch 索引執行聚合查詢（group by + count/sum/avg）。",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "string", description: "索引名稱" },
        field: { type: "string", description: "聚合欄位（例如 status, category）" },
        metric: { type: "string", enum: ["count", "sum", "avg", "max", "min"], default: "count" },
        metricField: { type: "string", description: "計算的數值欄位（sum/avg/max/min 用）" },
        size: { type: "number", description: "回傳分組數量上限", default: 10 },
      },
      required: ["index", "field"],
    },
  },
];

export async function execute(toolName, args, config) {
  switch (toolName) {
    case "es_search":
      return await _search(args);
    case "es_count":
      return await _count(args);
    case "es_aggregate":
      return await _aggregate(args);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

async function _esRequest(method, path, body) {
  const url = `${_baseUrl}/${path}`;
  try {
    const resp = await fetch(url, {
      method,
      headers: _headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json();
    if (!resp.ok) return { error: data.error?.reason || `ES error ${resp.status}` };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function _search({ index, query, size = 10, fields }) {
  const body = {
    query: query === "match_all" || !query
      ? { match_all: {} }
      : { query_string: { query } },
    size,
  };
  if (fields?._source) body._source = fields;

  const result = await _esRequest("POST", `${index}/_search`, body);
  if (result.error) return result;

  const hits = (result.hits?.hits || []).map(h => ({
    _id: h._id,
    _score: h._score,
    ...h._source,
  }));

  return {
    total: result.hits?.total?.value ?? hits.length,
    hits,
  };
}

async function _count({ index, query }) {
  const body = query && query !== "match_all"
    ? { query: { query_string: { query } } }
    : { query: { match_all: {} } };

  const result = await _esRequest("POST", `${index}/_count`, body);
  if (result.error) return result;

  return { count: result.count };
}

async function _aggregate({ index, field, metric = "count", metricField, size = 10 }) {
  const aggBody = {};
  const aggName = `by_${field}`;

  if (metric === "count") {
    aggBody[aggName] = { terms: { field, size } };
  } else if (metricField) {
    aggBody[aggName] = {
      terms: { field, size },
      aggs: { metric: { [metric]: { field: metricField } } },
    };
  } else {
    aggBody[aggName] = { terms: { field, size } };
  }

  const result = await _esRequest("POST", `${index}/_search`, {
    size: 0,
    aggs: aggBody,
  });
  if (result.error) return result;

  const buckets = (result.aggregations?.[aggName]?.buckets || []).map(b => {
    const row = { key: b.key, doc_count: b.doc_count };
    if (b.metric) row[metric] = b.metric.value;
    return row;
  });

  return { buckets, total_buckets: buckets.length };
}
