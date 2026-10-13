/**
 * grafana — 📈 Grafana 巡檢（deterministic，零 LLM：事實靠程式打 API 掃描）
 *
 *   GET  /api/sre/grafana                 → 設定（token 遮罩）+ 歷史報告清單
 *   PUT  /api/sre/grafana  {baseUrl,token,verifyTls,datasourceHealth?}  → 存設定
 *   POST /api/sre/grafana/inspect         → 跑巡檢：健康/資料源/面板/告警 → 落巡檢報告
 *   GET  /api/sre/grafana/report?file=X   → 讀一份巡檢報告（md）
 *
 * 設定檔：<root>/config/grafana.json
 * 報告落：<root>/dossiers/_global/grafana-YYYY-MM-DD-HHmm.md
 *
 * 只用 Node 內建 http/https（不引入依賴）；verifyTls=false 可接自簽憑證。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import http from "node:http";
import https from "node:https";
import { readBody, normalizePath, PAAW_ROOT } from "./shared.mjs";

const CFG = join(PAAW_ROOT, "config", "grafana.json");
const REPORTS = join(PAAW_ROOT, "dossiers", "_global");

async function parseBody(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function loadCfg() {
  try { return JSON.parse(readFileSync(CFG, "utf-8")); } catch { return {}; }
}
function saveCfg(c) {
  mkdirSync(join(PAAW_ROOT, "config"), { recursive: true });
  writeFileSync(CFG, JSON.stringify(c, null, 2));
}

/** 極簡 GET JSON（node http/https；timeout + 可關 TLS 驗證） */
function httpJson(urlStr, { token = "", verifyTls = true, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: `URL 不合法：${urlStr}` }); }
    const mod = u.protocol === "https:" ? https : http;
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = mod.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: "GET", headers,
      rejectUnauthorized: u.protocol === "https:" ? verifyTls !== false : undefined,
    }, (r) => {
      let data = "";
      r.on("data", (d) => { data += d; if (data.length > 4_000_000) req.destroy(); });
      r.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* 非 JSON（如 /api/health 舊版回純文字） */ }
        resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, json, text: json ? "" : data.slice(0, 400) });
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`timeout ${timeoutMs}ms`)); });
    req.end();
  });
}

function pad(n) { return String(n).padStart(2, "0"); }
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function today(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function plusDays(from, n) { const d = new Date(from); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

/** 跑巡檢 → { ok, summary, checks[], markdown } */
async function runInspect(cfg) {
  const base = String(cfg.baseUrl || "").replace(/\/+$/, "");
  const token = String(cfg.token || "");
  const verifyTls = cfg.verifyTls !== false;
  const checks = [];
  const issues = [];

  const add = (id, label, level, detail, extra = {}) => {
    checks.push({ id, label, level, detail, ...extra });
    if (level === "warn" || level === "error") issues.push({ id, label, level, detail });
  };

  // ① 健康
  const health = await httpJson(`${base}/api/health`, { token, verifyTls });
  if (health.ok) {
    const db = health.json?.database || (health.text.includes("ok") ? "ok" : "");
    const ver = health.json?.version || "";
    add("health", "Grafana 健康", db === "ok" || health.ok ? "ok" : "warn", `HTTP ${health.status}${ver ? ` · v${ver}` : ""}${db ? ` · db:${db}` : ""}`);
    if (db && db !== "ok") add("health-db", "資料庫狀態", "error", `database=${db}`);
  } else {
    add("health", "Grafana 健康", "error", health.error || `HTTP ${health.status}`);
  }

  // ② 資料源
  const ds = await httpJson(`${base}/api/datasources`, { token, verifyTls });
  if (ds.ok && Array.isArray(ds.json)) {
    const byType = {};
    for (const d of ds.json) byType[d.type] = (byType[d.type] || 0) + 1;
    add("datasources", "資料源", "ok", `${ds.json.length} 個（${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(", ")}）`, { count: ds.json.length });
    // 逐個健康檢查（上限 8，避免打爆）
    if (cfg.datasourceHealth !== false) {
      for (const d of ds.json.slice(0, 8)) {
        const h = await httpJson(`${base}/api/datasources/uid/${encodeURIComponent(d.uid)}/health`, { token, verifyTls });
        const st = (h.json?.status || "").toUpperCase();
        const bad = !h.ok || (st && st !== "OK");
        add(`ds:${d.name}`, `資料源 ${d.name}（${d.type}）`, bad ? "error" : "ok", bad ? (h.json?.message || h.error || st || `HTTP ${h.status}`) : "OK");
      }
    }
  } else {
    add("datasources", "資料源", "warn", ds.error || `HTTP ${ds.status}（可能需要 token 或權限不足）`);
  }

  // ③ 面板 / 資料夾
  const dash = await httpJson(`${base}/api/search?type=dash-db&limit=1000`, { token, verifyTls });
  if (dash.ok && Array.isArray(dash.json)) {
    const folders = new Set(dash.json.map(d => d.folderTitle).filter(Boolean));
    add("dashboards", "面板", "ok", `${dash.json.length} 張面板 / ${folders.size} 個資料夾`, { count: dash.json.length });
  } else {
    add("dashboards", "面板", "warn", dash.error || `HTTP ${dash.status}`);
  }

  // ④ 告警（unified alerting 優先，alertmanager 備援）
  const rules = await httpJson(`${base}/api/prometheus/grafana/api/v1/rules`, { token, verifyTls });
  if (rules.ok && rules.json?.data?.groups) {
    let firing = 0, pending = 0, total = 0;
    for (const g of rules.json.data.groups) for (const r of (g.rules || [])) {
      total++;
      if (r.state === "firing") firing++;
      else if (r.state === "pending") pending++;
    }
    add("alerts", "告警規則", firing ? "warn" : "ok", `共 ${total} 條規則 · firing ${firing} · pending ${pending}`, { firing, pending, total });
    if (firing) for (const g of rules.json.data.groups) for (const r of (g.rules || [])) if (r.state === "firing") add(`alert:${r.name}`, `🔥 firing:${r.name}`, "warn", (r.alerts || []).length ? `${(r.alerts).length} 個實例` : g.name || "");
  } else {
    const am = await httpJson(`${base}/api/alertmanager/grafana/api/v2/alerts`, { token, verifyTls });
    if (am.ok && Array.isArray(am.json)) {
      const active = am.json.filter(a => (a.status?.state || "active") !== "suppressed");
      add("alerts", "告警（Alertmanager）", active.length ? "warn" : "ok", `active ${active.length} / 全部 ${am.json.length}`, { firing: active.length });
      for (const a of active.slice(0, 20)) add(`alert:${a.labels?.alertname || "alert"}`, `🔥 ${a.labels?.alertname || "alert"}`, "warn", `${a.labels?.severity || ""} ${a.annotations?.summary || ""}`.trim());
    } else {
      add("alerts", "告警", "warn", rules.error || `HTTP ${rules.status}（讀不到告警；可能權限不足或未啟用）`);
    }
  }

  const errors = checks.filter(c => c.level === "error").length;
  const warns = checks.filter(c => c.level === "warn").length;
  const status = errors ? "🔴" : warns ? "🟡" : "🟢";
  const summary = { status, errors, warns, ok: checks.filter(c => c.level === "ok").length, total: checks.length, at: new Date().toISOString(), baseUrl: base };

  const lines = [];
  lines.push(`# 📈 Grafana 巡檢報告 — ${stamp()}`);
  lines.push("");
  lines.push(`> status: ${status}`);
  lines.push(`> target: ${base}`);
  lines.push("");
  lines.push(`## 總結`);
  lines.push(`- 檢查項：${summary.total}（✅ ${summary.ok} / ⚠️ ${warns} / ❌ ${errors}）`);
  lines.push(`- 結果：${status} ${errors ? "有需處理項目" : warns ? "有注意事項" : "全數正常"}`);
  lines.push("");
  lines.push(`## 逐項結果`);
  for (const c of checks) {
    const icon = c.level === "error" ? "❌" : c.level === "warn" ? "⚠️" : "✅";
    lines.push(`- ${icon} **${c.label}** — ${c.detail}`);
  }
  if (issues.length) {
    lines.push("");
    lines.push(`## 待處理（給 📈 監控巡檢員 / 服務管家）`);
    for (const i of issues) lines.push(`- [ ] ${i.level === "error" ? "❗" : "⚠️"} ${i.label}：${i.detail}｜來源:Grafana巡檢`);
    lines.push("");
    lines.push(`- [due:${plusDays(new Date(), 2)}] 覆核上述巡檢待處理項`);
  }
  lines.push("");
  lines.push(`- [due:${plusDays(new Date(), 7)}] 下次 Grafana 巡檢覆核（自動排程建議）`);
  return { summary, checks, markdown: lines.join("\n") };
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (!p.startsWith("/api/sre/grafana")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };

  try {
    // 設定
    if (req.method === "GET" && p === "/api/sre/grafana") {
      const cfg = loadCfg();
      const masked = { ...cfg, token: cfg.token ? "••••••" : "" };
      let history = [];
      try {
        history = readdirSync(REPORTS).filter(f => /^grafana-.*\.md$/.test(f)).sort().reverse().slice(0, 20)
          .map(f => ({ file: f, at: f.replace(/^grafana-|\.md$/g, "") }));
      } catch { /* 無報告 */ }
      return json(200, { config: masked, configured: !!cfg.baseUrl, history, reportsRoot: normalizePath(REPORTS) });
    }

    if (req.method === "PUT" && p === "/api/sre/grafana") {
      const body = await parseBody(req);
      const baseUrl = String(body.baseUrl || "").trim().replace(/\/+$/, "");
      if (baseUrl && !/^https?:\/\//.test(baseUrl)) return json(400, { error: "baseUrl 需以 http:// 或 https:// 開頭" });
      const cur = loadCfg();
      const next = {
        baseUrl,
        token: body.token === undefined ? (cur.token || "") : String(body.token || ""),
        verifyTls: body.verifyTls === undefined ? (cur.verifyTls !== false) : body.verifyTls !== false,
        datasourceHealth: body.datasourceHealth === undefined ? (cur.datasourceHealth !== false) : body.datasourceHealth !== false,
      };
      saveCfg(next);
      return json(200, { ok: true, config: { ...next, token: next.token ? "••••••" : "" } });
    }

    // 跑巡檢
    if (req.method === "POST" && p === "/api/sre/grafana/inspect") {
      const body = await parseBody(req).catch(() => ({}));
      const cfg = { ...loadCfg(), ...(body.baseUrl ? { baseUrl: String(body.baseUrl) } : {}) };
      if (!cfg.baseUrl) return json(400, { error: "尚未設定 Grafana — 到「📈 Grafana 巡檢」填入 baseUrl 與 API token", configured: false });
      const { summary, checks, markdown } = await runInspect(cfg);
      let reportPath = null;
      try {
        mkdirSync(REPORTS, { recursive: true });
        const file = `grafana-${stamp()}.md`;
        writeFileSync(join(REPORTS, file), markdown, "utf-8");
        reportPath = normalizePath(join(REPORTS, file));
      } catch (e) { /* 落檔失敗不擋回報 */ }
      return json(200, { ok: true, summary, checks, markdown, reportPath });
    }

    // 讀報告
    if (req.method === "GET" && p === "/api/sre/grafana/report") {
      const file = url.searchParams.get("file") || "";
      if (!/^grafana-[\w.-]+\.md$/.test(file)) return json(400, { error: "檔名不合法" });
      const fp = join(REPORTS, file);
      if (!existsSync(fp)) return json(404, { error: "報告不存在" });
      return json(200, { file, content: readFileSync(fp, "utf-8") });
    }

    return json(405, { error: "method not allowed" });
  } catch (e) {
    return json(500, { error: e.message });
  }
}
