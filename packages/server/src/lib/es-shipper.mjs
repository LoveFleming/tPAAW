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
import os from "node:os";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveRuName } from "./ru-resolver.mjs";
import { getModelPricing, calcCostUsd } from "./ru-resolver.mjs";
import { agentRoleLabel } from "./release-unit/cost.mjs";

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

// ── ship-time enrichment（2026-10-08 Fleming：log 檔不動，ES 端自帶機器/release 資訊，單一 index 免 join）──

/** 機器資訊（startup 解析一次）：hostname + 首個非 internal IPv4 — 多機部署分得清誰 */
let HOST = null;
function hostInfo() {
  if (HOST) return HOST;
  let ip = "";
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      const hit = (list || []).find(n => n.family === "IPv4" && !n.internal);
      if (hit) { ip = hit.address; break; }
    }
  } catch { /* ip stamp best-effort */ }
  HOST = { hostName: os.hostname() || "unknown", hostIp: ip || "unknown" };
  return HOST;
}

/**
 * Release anchor：事件自帶「發生當下的 release 週期」— releaseId = 最近一次已結案 released 的 RR。
 * 同一週期的事件共享同 releaseId → Kibana 端 filter releaseId=X 就是「上次 release → 這次 release」視窗，零 join。
 * releaseId="pre-first-release" = 首次 release 前的週期。
 */
const RR_CACHE = new Map(); // projectDir → { at, released: [{id, closedAt}] }（5min TTL）
function releasedRRs(projectDir) {
  const now = Date.now();
  let c = RR_CACHE.get(projectDir);
  if (!c || now - c.at > 300_000) {
    const out = [];
    try {
      const dir = join(projectDir, ".paaw", "release-requests");
      for (const f of readdirSync(dir)) {
        if (!/^RR-.*\.json$/.test(f)) continue;
        try {
          const rr = JSON.parse(readFileSync(join(dir, f), "utf-8"));
          if (rr?.status === "released" && rr.closedAt) out.push({ id: rr.id, closedAt: rr.closedAt });
        } catch { /* 單檔壞損不影響其他 */ }
      }
      out.sort((a, b) => a.closedAt.localeCompare(b.closedAt));
    } catch { /* 專案沒有 release-requests → pre-first-release */ }
    c = { at: now, released: out };
    RR_CACHE.set(projectDir, c);
  }
  return c.released;
}
function releaseAnchorAt(projectDir, isoTs) {
  if (!projectDir) return null;
  let pick = null;
  for (const r of releasedRRs(projectDir)) {
    if (r.closedAt <= isoTs) pick = r; else break;
  }
  return pick ? { releaseId: pick.id, releaseAt: pick.closedAt } : { releaseId: "pre-first-release", releaseAt: null };
}

/** 金額攤平（ship 時結算，與 cost.mjs 同優先序：provider cost > 定價估算 > unknown）— log 檔本身不動 */
function stampMoney(doc, usage, model) {
  if (!usage) return;
  doc.promptTokens = usage.prompt_tokens ?? usage.prompt ?? 0;
  doc.completionTokens = usage.completion_tokens ?? usage.completion ?? 0;
  doc.totalTokens = usage.total_tokens ?? usage.total ?? (doc.promptTokens + doc.completionTokens);
  if (typeof usage.cost === "number") {
    doc.costUsd = usage.cost; doc.costSource = "provider";
  } else {
    const pricing = getModelPricing(model);
    if (pricing && (pricing.input || pricing.output)) {
      doc.costUsd = calcCostUsd({ prompt: doc.promptTokens, completion: doc.completionTokens }, pricing);
      doc.costSource = "estimated";
    } else {
      doc.costUsd = 0; doc.costSource = "unknown-pricing";
    }
  }
}

/** 逐 doc stamp：host + release 週期 + roleLabel + 攤平 tokens/金額（只加欄位，不改原值） */
function enrichDoc(doc) {
  const h = hostInfo();
  doc.hostName = h.hostName;
  doc.hostIp = h.hostIp;
  const anchor = releaseAnchorAt(doc.cwd || null, doc["@timestamp"]);
  if (anchor) {
    doc.releaseId = anchor.releaseId;
    if (anchor.releaseAt) doc.releaseAt = anchor.releaseAt;
  }
  if (doc.agentId) doc.roleLabel = agentRoleLabel(doc.agentId);
  if (doc.usage) stampMoney(doc, doc.usage, doc.model);
}

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
          // 未顯式映射的字串一律 keyword（著 en enrich 欄位在舊動態 text mapping 下 term query 會失準）
          dynamic_templates: [
            { strings_as_keyword: { match_mapping_type: "string", mapping: { type: "keyword" } } },
          ],
          properties: {
            source: { type: "keyword" }, phase: { type: "keyword" }, model: { type: "keyword" },
            agentId: { type: "keyword" }, taskId: { type: "keyword" }, route: { type: "keyword" },
            ruName: { type: "keyword" }, _source_file: { type: "keyword" },
            // ship-time enrichment（2026-10-08）：單一 index 免 join
            hostName: { type: "keyword" }, hostIp: { type: "keyword" },
            releaseId: { type: "keyword" }, releaseAt: { type: "date" },
            roleLabel: { type: "keyword" }, costSource: { type: "keyword" },
            costUsd: { type: "double" },
            promptTokens: { type: "long" }, completionTokens: { type: "long" }, totalTokens: { type: "long" },
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
    enrichDoc(doc); // ship-time stamp：host/release/role/金額 — 單一 index 免 join
    state.buf.push({ id: `agent-logs:${taskId}.jsonl:${recNo}`, doc });
    if (state.buf.length >= FLUSH_SIZE) flush().catch(() => {});
  } catch {
    /* shipping 永不影響主流程 */
  }
}

export function isEsShipperEnabled() {
  return state.enabled;
}
