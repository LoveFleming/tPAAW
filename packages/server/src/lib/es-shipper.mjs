/**
 * ES Log Shipper（原生版，2026-10-04 Fleming 需求）
 *
 * 環境變數（.env）：
 *   PAAW_ES_URL（或相容別名 ELASTICSEARCH_URL）= ES 位址，例：http://127.0.0.1:9200
 *   → 有設定才開啟：agent 執行 log（LLM 呼叫 / tokens / 成本）即時送 Elasticsearch
 *   → 沒設定 = 功能完全關閉，零开销、零報錯
 *
 * 資料契約（與外部 ship-agent-logs.mjs v3 冪等相容，dashboard 通用）：
 *   _id       = agent-logs:<taskId>.jsonl:<recNo>（1-based，與檔案行號對齊）
 *   doc shape = 原始事件欄位 + stamp { source:"agent-logs", _source_file, _line,
 *               agentId, taskId, cwd, ruName, @timestamp }
 *   index     = paaw-agent-logs-YYYY.MM.dd（@timestamp 分日）
 *
 * 失敗策略：ES 不可達時 console.error（60s 冷卻）後丟棄該批 — 檔案仍是事實來源，
 * 外部 shipper 可補灌；絕不影響 agent loop。
 */
import { resolveRuName } from "./ru-resolver.mjs";

const FLUSH_SIZE = 50;
const FLUSH_MS = 5000;
const ERR_COOLDOWN_MS = 60000;

const state = {
  enabled: false,
  url: "",
  buf: [],
  timer: null,
  lastErrAt: 0,
};

function esUrl() {
  return (process.env.PAAW_ES_URL || process.env.ELASTICSEARCH_URL || "").trim().replace(/\/+$/, "");
}

async function es(path, opts) {
  const r = await fetch(state.url + path, opts);
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
  return body;
}

/** 冪等建立 index template（keyword mappings，與外部 shipper 相同） */
async function putTemplate() {
  await es("/_index_template/paaw-agent-logs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      index_patterns: ["paaw-agent-logs-*"],
      template: {
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings: {
          properties: {
            source: { type: "keyword" }, phase: { type: "keyword" }, model: { type: "keyword" },
            agentId: { type: "keyword" }, taskId: { type: "keyword" }, route: { type: "keyword" },
            ruName: { type: "keyword" }, _source_file: { type: "keyword" },
          },
        },
      },
    }),
  });
}

function logErr(scope, e) {
  const now = Date.now();
  if (now - state.lastErrAt < ERR_COOLDOWN_MS) return;
  state.lastErrAt = now;
  console.error(`[es-shipper] ${scope} 失敗（本分鐘不再重複）：${e.message}`);
}

async function flush() {
  if (!state.enabled || state.buf.length === 0) return;
  const batch = state.buf.splice(0, state.buf.length);
  const nd = [];
  for (const { id, doc } of batch) {
    nd.push(JSON.stringify({ index: { _index: `paaw-agent-logs-${doc["@timestamp"].slice(0, 10).replace(/-/g, ".")}`, _id: id } }));
    nd.push(JSON.stringify(doc));
  }
  try {
    const body = await es("/_bulk", { method: "POST", headers: { "Content-Type": "application/x-ndjson" }, body: nd.join("\n") + "\n" });
    const errors = (JSON.parse(body).items || []).filter(it => it.index?.error).length;
    if (errors) logErr("bulk", new Error(`${errors}/${batch.length} 筆被 ES 拒絕`));
  } catch (e) {
    logErr("bulk", e);
  }
}

/** server 啟動時呼叫一次。回傳是否啟用 */
export function initEsShipper() {
  const url = esUrl();
  if (!url) {
    console.log("[es-shipper] 未設定 PAAW_ES_URL — ES log shipping 關閉");
    return false;
  }
  state.url = url;
  state.enabled = true;
  state.timer = setInterval(flush, FLUSH_MS);
  state.timer.unref?.(); // 不阻擋 process 結束
  putTemplate().then(
    () => console.log(`[es-shipper] ES log shipping 開啟 → ${url}`),
    e => logErr("template", e),
  );
  return true;
}

/**
 * agent-exec-logger 每寫一筆事件呼叫（關閉時 no-op）。
 * @param {{taskId:string, recNo:number, entry:object, startTime:number, taskInfo:object|null}} args
 */
export function shipAgentLogEvent({ taskId, recNo, entry, startTime, taskInfo }) {
  if (!state.enabled) return;
  try {
    const tsMs = startTime + (typeof entry._ts === "number" ? entry._ts : 0);
    const doc = { ...entry };
    doc._source_file = `agent-logs/${taskId}.jsonl`;
    doc._line = recNo;
    doc.source = "agent-logs";
    if (taskInfo) {
      if (taskInfo.agentId) doc.agentId = taskInfo.agentId;
      if (taskInfo.taskId) doc.taskId = taskInfo.taskId;
      if (taskInfo.cwd) {
        doc.cwd = taskInfo.cwd;
        doc.ruName = resolveRuName(taskInfo.cwd);
      }
    }
    doc["@timestamp"] = new Date(tsMs).toISOString();
    state.buf.push({ id: `agent-logs:${taskId}.jsonl:${recNo}`, doc });
    if (state.buf.length >= FLUSH_SIZE) flush().catch(() => {});
  } catch {
    /* shipping 永不影響主流程 */
  }
}

export function isEsShipperEnabled() {
  return state.enabled;
}
