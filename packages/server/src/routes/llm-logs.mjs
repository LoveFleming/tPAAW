/**
 * LLM Logs API — 查詢所有 LLM 呼叫記錄
 *
 * GET    /api/llm-logs           — list paired logs (paginated: offset/limit/days/agent)
 * GET    /api/llm-logs/stats     — today's stats + availableDates
 * GET    /api/llm-logs/skills-usage — Skill 注入使用報表
 * DELETE /api/llm-logs           — clear logs (before date)
 * POST   /api/llm-logs/purge     — manually trigger retention cleanup
 *
 * 查詢端點在解析參數時做下限/上限驗證，避免 NaN 日期或負索引造成 500 / 分頁語意錯亂。
 */

import { readdirSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

import { DATA_HOME, ASSET_LOGS_ROOT } from "../data-home.mjs";

const DEFAULT_LOG_DIR = join(ASSET_LOGS_ROOT, "llm");

/**
 * 讀檔上限 — 單次查詢最多讀入的總行數（H2）。
 * llm 日誌永不刪、長期無上限成長，days 過大時全量讀入有 OOM/DoS 風險；
 * 超過此上限即停止累積並在回應標記 truncated=true（前端可提示資料不完整）。
 */
const MAX_TOTAL_LINES = 200_000;

function ensureLogDir(dir = DEFAULT_LOG_DIR) {
  mkdirSync(dir, { recursive: true });
}

/**
 * 安全整數解析（H1）：非法/NaN → fallback，並 clamp 到 [min, max]。
 * 避免 ?days=abc → NaN → Invalid Date → toISOString 丟例外 → 500；
 * 以及 ?offset=-100 → slice 負索引回傳尾端資料、分頁語意錯亂。
 */
export function safeInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  const base = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(base, min), max);
}

/** Auto-cleanup logs older than retentionDays (default 7) */
export function cleanupOldLogs(retentionDays = 7, dir = DEFAULT_LOG_DIR) {
  try {
    const files = readdirSync(dir).filter(f => f.endsWith(".jsonl"));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let deleted = 0;
    for (const f of files) {
      const dateStr = f.replace(".jsonl", "");
      if (dateStr < cutoffStr) {
        unlinkSync(join(dir, f));
        deleted++;
      }
    }
    if (deleted > 0) console.log(`[llm-logs] Cleaned up ${deleted} files older than ${retentionDays} days (before ${cutoffStr})`);
    return deleted;
  } catch (e) {
    console.error(`[llm-logs] Cleanup error: ${e.message}`);
    return 0;
  }
}

// Ensure dir on module load（purge 交給 log-retention 政策 — cron /api/logs/purge）
ensureLogDir();

/** Infer agentId from caller field for old logs that lack agentId */
function _callerToAgentId(caller) {
  if (!caller) return null;
  const map = {
    "auto-dispatch": "auto-dispatch",
    "tool-engine": "assistant",
    "chat": "assistant",
    "coding": "coding",
    "vibe-fs": "assistant",
    "notes": "assistant",
    "mindmap": "assistant",
    "skill-builder": "skill-builder",
    "vibe-sessions": "assistant",
    "overnight": "overnight",
    "a2a": "a2a-server",
    "a2a-helpdesk": "a2a-helpdesk",
  };
  return map[caller] || caller;
}

/**
 * 讀單檔 JSONL（H2 上限保護、M2 參數化 dir 以便測試注入）。
 * @returns {{ logs: object[], truncated: boolean }}
 */
export function readLogFile(dateStr, dir = DEFAULT_LOG_DIR, maxLines = MAX_TOTAL_LINES) {
  const logPath = join(dir, `${dateStr}.jsonl`);
  try {
    let raw = readFileSync(logPath, "utf-8");
    let truncated = false;
    const lines = raw.split("\n");
    if (lines.length > maxLines) {
      truncated = true;
      raw = lines.slice(0, maxLines).join("\n");
    }
    const logs = raw.split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    return { logs, truncated };
  } catch { return { logs: [], truncated: false }; }
}

function parseLogs(dateStr, dir = DEFAULT_LOG_DIR) {
  return readLogFile(dateStr, dir).logs;
}

/**
 * 讀取最近 days 天（含今天）的所有 log。
 * M1：`days` 語意 = 含今天共 days 天 → cutoff = 今天 - (days-1)，與 collectSkillsUsage 對齊。
 * H2：跨檔累積超過 MAX_TOTAL_LINES 即停止並標記 partial。
 * @returns {{ logs: object[], truncated: boolean }}
 */
export function parseAllLogs(days = 7, dir = DEFAULT_LOG_DIR) {
  ensureLogDir(dir);
  const files = readdirSync(dir).filter(f => f.endsWith(".jsonl")).sort().reverse();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const allLogs = [];
  let truncated = false;
  for (const f of files) {
    const dateStr = f.replace(".jsonl", "");
    if (dateStr < cutoffStr) continue;
    const remaining = MAX_TOTAL_LINES - allLogs.length;
    if (remaining <= 0) { truncated = true; break; }
    const { logs, truncated: fileTrunc } = readLogFile(dateStr, dir, remaining);
    allLogs.push(...logs);
    if (fileTrunc) { truncated = true; break; }
  }
  return { logs: allLogs, truncated };
}

/**
 * GET /api/llm-logs/skills-usage?days=7 — Skill 注入使用報表（2026-10-15）
 * 資料 = appendSkillBindings 每次注入寫的 phase:"skills" 證據行（程式 stamp，非 LLM 自述）
 * 聚合：by skill / by agent / by day。fast path：非 skills 行不做 JSON.parse。
 */
export function collectSkillsUsage(days = 7, dir = DEFAULT_LOG_DIR) {
  ensureLogDir(dir);
  const files = readdirSync(dir).filter(f => f.endsWith(".jsonl")).sort();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const bySkill = {}, byAgent = {}, byDay = {};
  for (const f of files) {
    const dateStr = f.replace(".jsonl", "");
    if (dateStr < cutoffStr) continue;
    let lines;
    try { lines = readFileSync(join(dir, f), "utf-8").split("\n"); } catch { continue; }
    for (const line of lines) {
      if (!line.includes('"phase":"skills"')) continue; // fast path：非 skills 證據行直接跳過
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.phase !== "skills" || !Array.isArray(e.skills)) continue;
      const agent = e.agentId || "unknown";
      const sectionChars = e.sectionChars || 0;
      const day = byDay[dateStr] || (byDay[dateStr] = { date: dateStr, count: 0, chars: 0 });
      day.count += 1; day.chars += sectionChars;
      const a = byAgent[agent] || (byAgent[agent] = { id: agent, count: 0, chars: 0, lastTs: e.ts, lastCwd: e.cwd || null, skills: {} });
      a.count += 1; a.chars += sectionChars;
      if (e.ts > (a.lastTs || "")) { a.lastTs = e.ts; a.lastCwd = e.cwd || a.lastCwd; }
      for (const sid of e.skills) {
        a.skills[sid] = (a.skills[sid] || 0) + 1;
        const s = bySkill[sid] || (bySkill[sid] = { id: sid, count: 0, sectionCharsTotal: 0, lastTs: e.ts, agents: {} });
        s.count += 1; s.sectionCharsTotal += sectionChars;
        s.agents[agent] = (s.agents[agent] || 0) + 1;
        if (e.ts > (s.lastTs || "")) s.lastTs = e.ts;
      }
    }
  }
  const skillRows = Object.values(bySkill)
    .map(s => ({
      ...s,
      avgSectionChars: s.count > 0 ? Math.round(s.sectionCharsTotal / s.count) : 0,
      agents: Object.entries(s.agents).map(([id, count]) => ({ id, count })).sort((x, y) => y.count - x.count),
    }))
    .sort((a, b) => b.count - a.count);
  const agentRows = Object.values(byAgent)
    .map(a => ({ ...a, skills: Object.entries(a.skills).map(([id, count]) => ({ id, count })).sort((x, y) => y.count - x.count) }))
    .sort((a, b) => b.count - a.count);
  return {
    days,
    totals: {
      injections: agentRows.reduce((n, a) => n + a.count, 0),
      skills: skillRows.length,
      agents: agentRows.length,
      chars: agentRows.reduce((n, a) => n + a.chars, 0),
    },
    bySkill: skillRows,
    byAgent: agentRows,
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Pair request + response logs by id。
 * M3：只認 request/response 兩個 phase（其餘如 'response-fallback' 不寫入動態鍵），
 * 並回傳 orphan 計數，讓呼叫端能觀測跨日/缺配對造成的靜默丟棄量。
 * @returns {{ paired: object[], orphanRequests: number, orphanPhases: Record<string, number> }}
 */
export function pairLogs(logs) {
  const byId = {};
  const orphanPhases = {};
  for (const log of logs) {
    if (!log.id) continue;
    if (log.phase !== "request" && log.phase !== "response") {
      orphanPhases[log.phase] = (orphanPhases[log.phase] || 0) + 1;
      continue;
    }
    if (!byId[log.id]) byId[log.id] = { request: null, response: null };
    byId[log.id][log.phase] = log;
  }
  const values = Object.values(byId);
  const orphanRequests = values.filter(p => !p.request).length;
  const paired = values
    .filter(p => p.request)
    .map(p => {
      const toolCalls = p.response?.toolCalls || [];
      const allowedTools = p.request.toolNames || [];
      // Audit: every tool call must be in the allowed tool list
      // If allowedTools is empty (old logs without toolNames), audit is N/A
      const hasAllowList = allowedTools.length > 0;
      const violations = hasAllowList
        ? toolCalls.filter(tc => tc.name && !allowedTools.includes(tc.name))
        : [];
      const auditOk = toolCalls.length === 0 ? null         // no tool calls → N/A
        : !hasAllowList ? null                                // no allow list → N/A
        : violations.length === 0;                            // has list + no violations → true
      const auditViolations = violations.map(v => ({
        tool: v.name,
        reason: `不在允許清單 [${allowedTools.slice(0, 10).join(", ")}${allowedTools.length > 10 ? ", ..." : ""}] 中`,
      }));
      return {
        id: p.request.id,
        ts: p.request.ts,
        agentId: p.request.agentId || p.response?.agentId || _callerToAgentId(p.request.caller || p.response?.caller) || "unknown",
        model: p.request.model || p.response?.model || "?",
        stream: p.request.stream ?? false,
        messageCount: p.request.messageCount ?? 0,
        images: p.request.images ?? null, // Vision Phase 4：含圖請求歸因（request log 的圖片總數）
        toolNames: allowedTools,
        durationMs: p.response?.durationMs ?? null,
        finishReason: p.response?.finishReason ?? null,
        contentLen: p.response?.contentLen ?? 0,
        contentPreview: p.response?.contentPreview || "",
        toolCalls,
        auditOk,
        auditViolations,
        auditNA: auditOk === null,
        usage: p.response?.usage || null,
        error: p.response?.error || null,
      };
    });
  return { paired, orphanRequests, orphanPhases };
}

/** Skill 回讀證據抽取：從單一 toolCall 的（name, args 原文）抽出 [.paaw/skills/<id>/<file>] 命中 */
function _skillReadHits(toolName, argsRaw) {
  const hits = [];
  const RE = /\.paaw\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._\-/]+)/g;
  if (toolName === "read_file") {
    try {
      const a = JSON.parse(argsRaw || "{}");
      const p = String(a.path || "").replace(/\\/g, "/");
      let m; RE.lastIndex = 0;
      while ((m = RE.exec(p))) hits.push({ skillId: m[1], file: m[2] });
    } catch { /* args 非 JSON → 退回字串掃描 */ }
  }
  if (hits.length === 0) {
    let m; RE.lastIndex = 0;
    while ((m = RE.exec(String(argsRaw || "")))) hits.push({ skillId: m[1], file: m[2] });
  }
  return hits;
}

/**
 * Skill Engagement — 掛載 vs 回讀對照（2026-10-22 Fleming：「skill 真的被使用」）
 * mounted-but-never-read = 掛了没人讀（context 浪費訊號）；read = 真實使用證據（程式記錄，非 AI 自述）
 */
export function collectSkillEngagement(days = 7, dir = DEFAULT_LOG_DIR) {
  ensureLogDir(dir);
  const files = readdirSync(dir).filter(f => f.endsWith(".jsonl")).sort();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const injected = {};   // skillId -> {count, agents:{}}
  const reads = {};      // skillId -> {count, agents:{}, files:{}, lastTs}
  const byDay = {};
  const agents = {};     // agentId -> {reads, skills:{}}
  let injectionEvents = 0;
  for (const f of files) {
    const dateStr = f.replace(".jsonl", "");
    if (dateStr < cutoffStr) continue;
    let lines;
    try { lines = readFileSync(join(dir, f), "utf-8").split("\n"); } catch { continue; }
    for (const line of lines) {
      if (!line.includes("skills")) continue; // fast path：注入行與回讀行都必含 skills 字串
      let e; try { e = JSON.parse(line); } catch { continue; }
      const agent = e.agentId || "unknown";
      if (e.phase === "skills" && Array.isArray(e.skills)) {
        const day = byDay[dateStr] || (byDay[dateStr] = { date: dateStr, injections: 0, reads: 0 });
        day.injections += 1;
        injectionEvents += 1;
        for (const sid of e.skills) {
          const s = injected[sid] || (injected[sid] = { count: 0, agents: {} });
          s.count += 1; s.agents[agent] = (s.agents[agent] || 0) + 1;
        }
      } else if (e.phase === "response" && Array.isArray(e.toolCalls)) {
        const dayHits = [];
        for (const tc of e.toolCalls) {
          for (const h of _skillReadHits(tc.name, tc.args)) {
            dayHits.push(h);
            const r = reads[h.skillId] || (reads[h.skillId] = { count: 0, agents: {}, files: {}, lastTs: e.ts });
            r.count += 1;
            r.agents[agent] = (r.agents[agent] || 0) + 1;
            r.files[h.file] = (r.files[h.file] || 0) + 1;
            if (e.ts > (r.lastTs || "")) r.lastTs = e.ts;
            const a = agents[agent] || (agents[agent] = { id: agent, reads: 0, skills: {} });
            a.reads += 1; a.skills[h.skillId] = (a.skills[h.skillId] || 0) + 1;
          }
        }
        if (dayHits.length) {
          const day = byDay[dateStr] || (byDay[dateStr] = { date: dateStr, injections: 0, reads: 0 });
          day.reads += dayHits.length;
        }
      }
    }
  }
  const allIds = [...new Set([...Object.keys(injected), ...Object.keys(reads)])];
  const bySkill = allIds.map(id => {
    const inj = injected[id] || { count: 0, agents: {} };
    const rd = reads[id] || { count: 0, agents: {}, files: {}, lastTs: null };
    return {
      id,
      injections: inj.count,
      reads: rd.count,
      readers: Object.entries(rd.agents).map(([aid, c]) => ({ id: aid, count: c })).sort((a, b) => b.count - a.count),
      topFiles: Object.entries(rd.files).map(([file, c]) => ({ file, count: c })).sort((a, b) => b.count - a.count).slice(0, 5),
      lastRead: rd.lastTs,
      mountNoRead: inj.count > 0 && rd.count === 0,
    };
  }).sort((a, b) => b.reads - a.reads || b.injections - a.injections);
  return {
    days,
    totals: {
      injections: injectionEvents,
      reads: Object.values(reads).reduce((s, x) => s + x.count, 0),
      skills: allIds.length,
      noReadSkills: bySkill.filter(s => s.mountNoRead).length,
    },
    bySkill,
    byAgent: Object.values(agents).sort((a, b) => b.reads - a.reads),
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export default async function llmLogsRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  // GET /api/llm-logs/skills-usage — Skill 注入使用報表（phase:"skills" 證據行聚合）
  if (url === "/api/llm-logs/skills-usage" && method === "GET") {
    try {
      const days = safeInt(q.get("days"), 7, 1, 365);
      res.writeHead(200, { "Content-Type": "application/json" }); // M5：統一錯誤/成功 header
      return res.end(JSON.stringify(collectSkillsUsage(days)));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" }); // M5：補 Content-Type
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

// GET /api/llm-logs/skill-engagement — Skill 真正被使用報表（2026-10-22：掛載 ≠ 使用）
// 證據分層：inject = prompt 事實（phase:skills）；read = agent 主動回讀 skill 檔案
// （response 行 toolCalls 的 args 出現 .paaw/skills/<id>/ 路徑 — read_file 精確解析、其他工具字串掃描）
// 誠實邊界：「遵循 skill 規則與否」是語意層，本報表不含 — 那層沒有 deterministic proof。
  if (url === "/api/llm-logs/skill-engagement" && method === "GET") {
    try {
      const days = safeInt(q.get("days"), 7, 1, 365);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(collectSkillEngagement(days)));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // GET /api/llm-logs — list paired logs
  if (url === "/api/llm-logs" && method === "GET") {
    try {
      // H1：days/limit/offset 全部做下限+上限驗證，避免 NaN 日期與負索引
      const days = safeInt(q.get("days"), 7, 1, 90);
      const agentFilter = q.get("agent") || null;
      const limit = safeInt(q.get("limit"), 200, 1, 1000);
      const offset = safeInt(q.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

      const { logs: allLogs, truncated } = parseAllLogs(days);
      const { paired, orphanRequests, orphanPhases } = pairLogs(allLogs);

      let filtered = paired;
      if (agentFilter) filtered = filtered.filter(l => l.agentId === agentFilter);
      // 2026-10-23 修正：最新在前。舊版直接 slice 檔頭（時間舊→新），limit=200 永遠只看到
      // 最新一天檔案的「前 200 筆」，正在跑的 live tail 永遠進不了列表（Fleming：「正在跑但沒 log」）
      filtered = filtered.slice().sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));

      const total = filtered.length;
      const items = filtered.slice(offset, offset + limit);

      // Compute summary
      const success = filtered.filter(l => !l.error).length;
      const errors = filtered.filter(l => l.error).length;
      const totalDurationMs = filtered.reduce((s, l) => s + (l.durationMs || 0), 0);
      const totalTokens = filtered.reduce((s, l) => s + ((l.usage?.prompt_tokens || 0) + (l.usage?.completion_tokens || 0)), 0);
      const totalPromptTokens = filtered.reduce((s, l) => s + (l.usage?.prompt_tokens || 0), 0);
      const totalCompletionTokens = filtered.reduce((s, l) => s + (l.usage?.completion_tokens || 0), 0);

      // By model breakdown
      const byModel = {};
      for (const l of filtered) {
        if (!byModel[l.model]) byModel[l.model] = { count: 0, tokens: 0, errors: 0, durationMs: 0 };
        byModel[l.model].count++;
        byModel[l.model].tokens += (l.usage?.prompt_tokens || 0) + (l.usage?.completion_tokens || 0);
        byModel[l.model].errors += l.error ? 1 : 0;
        byModel[l.model].durationMs += l.durationMs || 0;
      }

      // By agent breakdown
      const byAgent = {};
      for (const l of filtered) {
        if (!byAgent[l.agentId]) byAgent[l.agentId] = { count: 0, tokens: 0, errors: 0 };
        byAgent[l.agentId].count++;
        byAgent[l.agentId].tokens += (l.usage?.prompt_tokens || 0) + (l.usage?.completion_tokens || 0);
        byAgent[l.agentId].errors += l.error ? 1 : 0;
      }

      // Tool audit summary
      const auditOkCount = filtered.filter(l => l.auditOk === true).length;
      const auditFailCount = filtered.filter(l => l.auditOk === false).length;
      const auditNACount = filtered.filter(l => l.auditOk === null).length;
      const allViolations = filtered.flatMap(l => l.auditViolations || []);
      const violationCounts = {};
      for (const v of allViolations) {
        violationCounts[v.tool] = (violationCounts[v.tool] || 0) + 1;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        items,
        total,
        offset,
        limit,
        days,
        truncated,                        // H2：達讀檔上限時為 true，前端可提示資料不完整
        orphans: { requests: orphanRequests, phases: orphanPhases }, // M3：觀測靜默丟棄量
        summary: { success, errors, totalDurationMs, totalTokens, totalPromptTokens, totalCompletionTokens, byModel, byAgent, auditOk: auditOkCount, auditFail: auditFailCount, auditNA: auditNACount, violations: violationCounts },
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/llm-logs/stats — today's stats + availableDates
  if (url === "/api/llm-logs/stats" && method === "GET") {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const todayLogs = parseLogs(today);
      const { paired: todayPaired } = pairLogs(todayLogs);
      const todayTokens = todayPaired.reduce((s, l) => s + ((l.usage?.prompt_tokens || 0) + (l.usage?.completion_tokens || 0)), 0);
      const todayCalls = todayPaired.length;
      const todayErrors = todayPaired.filter(l => l.error).length;

      // Available log dates
      ensureLogDir();
      const dates = readdirSync(DEFAULT_LOG_DIR).filter(f => f.endsWith(".jsonl")).map(f => f.replace(".jsonl", "")).sort().reverse();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ today: { calls: todayCalls, errors: todayErrors, tokens: todayTokens }, availableDates: dates }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/llm-logs — delete logs before a date
  if (url === "/api/llm-logs" && method === "DELETE") {
    try {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
      const before = body.before || new Date().toISOString().slice(0, 10);
      ensureLogDir();
      const files = readdirSync(DEFAULT_LOG_DIR).filter(f => f.endsWith(".jsonl"));
      let deleted = 0;
      for (const f of files) {
        const dateStr = f.replace(".jsonl", "");
        if (dateStr < before) {
          unlinkSync(join(DEFAULT_LOG_DIR, f));
          deleted++;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted, before }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/llm-logs/purge — manually trigger cleanup
  if (url === "/api/llm-logs/purge" && method === "POST") {
    try {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
      const days = body.days || 7;
      const deleted = cleanupOldLogs(days);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted, retentionDays: days }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false; // not handled
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c))).toString();
}
