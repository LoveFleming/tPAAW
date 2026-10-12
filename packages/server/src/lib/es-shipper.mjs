/**
 * ES Log Shipper（原生版，2026-10-04 Fleming 需求）
 *
 * 環境變數（.env，全部可自行修改）：
 *   PAAW_ES_URL（別名 ELASTICSEARCH_URL）        ES 位址，例：http://127.0.0.1:9200（也可寫 http://user:pass@host，會自動轉成 header）
 *   PAAW_ES_USERNAME（別名 ES_USERNAME）         帳號（Basic Auth；留空＝不帶認證）
 *   PAAW_ES_PASSWORD（別名 ES_PASSWORD）         密碼
 *   PAAW_ES_INDEX_PREFIX                         agent log index 前綴（預設 paaw-agent-logs）
 *   PAAW_ES_AUDIT_PREFIX                         審計 index 前綴（預設 paaw-audit）
 *   → 有設 URL 才開啟：agent 執行 log（LLM 呼叫 / tokens / 成本）即時送 Elasticsearch
 *   → 沒設 = 功能完全關閉，零开销、零報錯
 *
 * Index 命名規則（2026-10-12 Fleming）＝ prefix + yyyymm（月滾動，例：paaw-agent-logs-202610）
 *   prefix 結尾非 -/_/. 時自動補一個「-」；想完全自控就把分隔符寫進 prefix。
 *
 * 資料契約（與外部 ship-agent-logs.mjs v3 冪等相容，dashboard 通用）：
 *   _id       = agent-logs:<taskId>.jsonl:<recNo>（1-based，與檔案行號對齊）
 *   doc shape = 原始事件欄位 + stamp { source:"agent-logs", _source_file, _line,
 *               agentId, taskId, cwd, ruName, @timestamp }
 *   index     = paaw-agent-logs-YYYY.MM.dd（@timestamp 分日）
 *
 * 審計串流（2026-10-10 Fleming：AI 犯傻事件用不同 index 存完整資訊）：
 *   logAuditEvent（lib/audit-log.mjs）→ shipAuditEvent → paaw-audit-YYYY.MM.dd
 *   獨立 buffer / 獨立 template，與 agent-logs 完全分流；_id = audit:<eid>（冪等）
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
  auth: "",            // "Basic xxx"（帳密來自環境變數；空＝不帶 Authorization）
  prefix: "paaw-agent-logs",   // agent log index 前綴（PAAW_ES_INDEX_PREFIX）
  auditPrefix: "paaw-audit",   // 審計 index 前綴（PAAW_ES_AUDIT_PREFIX）
  buf: [],
  auditBuf: [], // 審計事件（paaw-audit-*，2026-10-10）
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

function envAny(...names) {
  for (const n of names) { const v = (process.env[n] || "").trim(); if (v) return v; }
  return "";
}

/** 解析 ES 連線設定：URL + Basic Auth（帳密可放環境變數，或直接內嵌在 URL） */
function esConfig() {
  let url = envAny("PAAW_ES_URL", "ELASTICSEARCH_URL");
  let auth = "";
  const u = envAny("PAAW_ES_USERNAME", "ES_USERNAME");
  const p = envAny("PAAW_ES_PASSWORD", "ES_PASSWORD");
  if (u) auth = "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  try {
    const parsed = new URL(url);
    if (parsed.username) {   // http://user:pass@host → 轉 header，避免帳密留在 URL/log
      if (!auth) {
        auth = "Basic " + Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`).toString("base64");
      }
      parsed.username = "";
      parsed.password = "";
      url = parsed.toString();
    }
  } catch { /* 非標準 URL → 原樣使用 */ }
  return { url: url.replace(/\/+$/, ""), auth };
}

/** index 前綴合法字元（ES 要求小寫；不得以 -/_/+ 開頭） */
function validPrefix(s) { return /^[a-z0-9][a-z0-9._-]*$/.test(s); }

/** index 命名規則：prefix + yyyymm（prefix 未以分隔符結尾 → 自動補一格「-」） */
function idxName(prefix, isoTs) {
  const ym = String(isoTs || "").slice(0, 7).replace(/-/g, "");
  if (!/^\d{6}$/.test(ym)) return null;
  const sep = /[-_.]$/.test(prefix) ? "" : "-";
  return `${prefix}${sep}${ym}`;
}

async function es(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.auth) headers.Authorization = state.auth;
  const r = await fetch(state.url + path, { ...opts, headers });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
  return body;
}

/** 冪等建立 index template（keyword mappings，與外部 shipper 相同） */
async function putTemplate() {
  await es(`/_index_template/${state.prefix}-template`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      index_patterns: [`${state.prefix}*`],
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

/** 審計 index template（paaw-audit-*，2026-10-10）— command/reason 開 text 才搜得到全文 */
async function putAuditTemplate() {
  await es(`/_index_template/${state.auditPrefix}-template`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      index_patterns: [`${state.auditPrefix}*`],
      template: {
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings: {
          dynamic_templates: [
            { strings_as_keyword: { match_mapping_type: "string", mapping: { type: "keyword" } } },
          ],
          properties: {
            "@timestamp": { type: "date" },
            source: { type: "keyword" },
            kind: { type: "keyword" }, severity: { type: "keyword" }, layer: { type: "keyword" },
            tool: { type: "keyword" }, agentId: { type: "keyword" }, runId: { type: "keyword" },
            ruSlug: { type: "keyword" }, hostName: { type: "keyword" }, hostIp: { type: "keyword" },
            domains: { type: "keyword" }, eid: { type: "keyword" }, version: { type: "long" },
            // 全文欄位：指令內容 / 攔截理由要能全文搜（match query）
            command: { type: "text" }, reason: { type: "text" },
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
    const idx = idxName(state.prefix, doc["@timestamp"]);
    if (!idx) continue;
    nd.push(JSON.stringify({ index: { _index: idx, _id: id } }));
    nd.push(JSON.stringify(doc));
  }
  if (!nd.length) return;
  try {
    const body = await es("/_bulk", { method: "POST", headers: { "Content-Type": "application/x-ndjson" }, body: nd.join("\n") + "\n" });
    const errors = (JSON.parse(body).items || []).filter(it => it.index?.error).length;
    if (errors) logErr("bulk", new Error(`${errors}/${batch.length} 筆被 ES 拒絕`));
  } catch (e) {
    logErr("bulk", e);
  }
}

/** 審計事件 flush（paaw-audit-* 獨立 index，2026-10-10）— 與 agent-logs 分流互不影響 */
async function flushAudit() {
  if (!state.enabled || state.auditBuf.length === 0) return;
  const batch = state.auditBuf.splice(0, state.auditBuf.length);
  const nd = [];
  for (const { id, doc } of batch) {
    const idx = idxName(state.auditPrefix, doc["@timestamp"]);
    if (!idx) continue;
    nd.push(JSON.stringify({ index: { _index: idx, _id: id } }));
    nd.push(JSON.stringify(doc));
  }
  if (!nd.length) return;
  try {
    const body = await es("/_bulk", { method: "POST", headers: { "Content-Type": "application/x-ndjson" }, body: nd.join("\n") + "\n" });
    const errors = (JSON.parse(body).items || []).filter(it => it.index?.error).length;
    if (errors) logErr("audit-bulk", new Error(`${errors}/${batch.length} 筆被 ES 拒絕`));
  } catch (e) {
    logErr("audit-bulk", e);
  }
}

/** server 啟動時呼叫一次。回傳是否啟用 */
export function initEsShipper() {
  const { url, auth } = esConfig();
  if (!url) {
    console.log("[es-shipper] 未設定 PAAW_ES_URL — ES log shipping 關閉");
    return false;
  }
  const pRaw = envAny("PAAW_ES_INDEX_PREFIX") || "paaw-agent-logs";
  const aRaw = envAny("PAAW_ES_AUDIT_PREFIX") || "paaw-audit";
  state.prefix = validPrefix(pRaw) ? pRaw : "paaw-agent-logs";
  state.auditPrefix = validPrefix(aRaw) ? aRaw : "paaw-audit";
  if (state.prefix !== pRaw) console.error(`[es-shipper] PAAW_ES_INDEX_PREFIX 不合法（${pRaw}）→ 回退 ${state.prefix}`);
  if (state.auditPrefix !== aRaw) console.error(`[es-shipper] PAAW_ES_AUDIT_PREFIX 不合法（${aRaw}）→ 回退 ${state.auditPrefix}`);
  state.url = url;
  state.auth = auth;
  state.enabled = true;
  state.timer = setInterval(() => { flush().catch(() => {}); flushAudit().catch(() => {}); }, FLUSH_MS);
  state.timer.unref?.(); // 不阻擋 process 結束
  putTemplate().then(
    () => console.log(`[es-shipper] ES log shipping 開啟 → ${url} | index ${state.prefix}-YYYYMM | 認證 ${auth ? "Basic(已設定)" : "無"}`),
    e => logErr("template", e),
  );
  putAuditTemplate().then(
    () => console.log(`[es-shipper] 審計事件 shipping 開啟 → ${state.auditPrefix}-YYYYMM`),
    e => logErr("audit-template", e),
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

/**
 * 審計事件入列（lib/audit-log.mjs 呼叫，2026-10-10）— paaw-audit-* 獨立 index。
 * doc 已是完整形狀（audit-log 端 stamp 過 host/runId/@timestamp）— 這裡只加 source 標記。
 * 關閉時 no-op；永不影響主流程。
 */
export function shipAuditEvent(doc) {
  if (!state.enabled) return;
  try {
    const d = { ...doc, source: "audit" };
    state.auditBuf.push({ id: `audit:${doc.eid}`, doc: d });
    if (state.auditBuf.length >= FLUSH_SIZE) flushAudit().catch(() => {});
  } catch {
    /* shipping 永不影響主流程 */
  }
}
