// ── exec-approvals：AI bash 審批卡登記（2026-10-09，Fleming 拍板三點之三）──
// script-guard 攔截危險指令 → UI 審批卡（✅准許一次 ♾️永遠 ❌拒絕）
// 決策模型（抄 OpenClaw exec approvals）：
//   once   = 記憶體，單次消耗，10 分鐘過期
//   always = <RU>/.paaw/exec-approvals.json 永久（同指令雜湊）
//   deny   = 不記錄（本來就是擋的狀態）

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";

const ONCE_TTL_MS = 10 * 60 * 1000;

// in-memory
const _pending = new Map(); // id → { command, cwd, reason, createdAt }
const _once = new Map();    // hash → { createdAt, expiresAt }

function hashOf(command) {
  return createHash("sha256").update(String(command).trim()).digest("hex").slice(0, 24);
}

function storePath(cwd) {
  return join(cwd || process.cwd(), ".paaw", "exec-approvals.json");
}

function readAlways(cwd) {
  try {
    const p = storePath(cwd);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch { return {}; }
}

function writeAlways(cwd, map) {
  const p = storePath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(map, null, 2), "utf-8");
}

/** 註冊待審批（bash 被攔時呼叫）→ 回 approval id */
export function requestApproval(command, cwd, reason) {
  const id = "apr_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  _pending.set(id, { command: String(command), cwd, reason: String(reason || ""), createdAt: Date.now() });
  // pending 清理：超過 30 分鐘的丟掉
  for (const [k, v] of _pending) if (Date.now() - v.createdAt > 30 * 60 * 1000) _pending.delete(k);
  appendLog(cwd, { type: "request", id, command: String(command), reason: String(reason || ""), decided: null });
  return id;
}

/** 使用者決策。回 { ok, action, command, cwd, alsoIds } */
export function decideApproval(id, action) {
  const entry = _pending.get(id);
  if (!entry) return { ok: false, error: "找不到待審批項目（可能已過期）" };
  if (action !== "once" && action !== "always" && action !== "deny") {
    return { ok: false, error: "action 必須是 once / always / deny" };
  }
  _pending.delete(id);
  if (action === "once") {
    _once.set(hashOf(entry.command), { createdAt: Date.now(), expiresAt: Date.now() + ONCE_TTL_MS });
  } else if (action === "always") {
    const map = readAlways(entry.cwd);
    map[hashOf(entry.command)] = { command: entry.command, allowedAt: new Date().toISOString() };
    writeAlways(entry.cwd, map);
  }
  appendLog(entry.cwd, { type: "decision", id, command: entry.command, reason: entry.reason, decided: action });
  // 2026-10-13（Fleming）：agent 重試同一條被攔指令 → 每次都送一張新卡（不同 id、同 command）→
  // UI 會一次出現多張卡，按了一張其他張還掛著，使用者以為沒生效。
  // 審批效力本來就是「整條指令」為單位（once/always 都按 sha256(指令) 記）→ 決策一次就把同指令的待審批一起結掉。
  const alsoIds = [];
  for (const [k, v] of _pending) {
    if (v.command === entry.command) {
      _pending.delete(k);
      alsoIds.push(k);
      appendLog(v.cwd, { type: "decision", id: k, command: v.command, reason: v.reason, decided: action, note: "同指令批次結案" });
    }
  }
  return { ok: true, action, command: entry.command, cwd: entry.cwd, alsoIds };
}

/** bash 執行前檢查：已被核准？回 "once"（消耗）/"always"/null */
export function consumeApproval(command, cwd) {
  const h = hashOf(command);
  // once（帶 TTL，消耗制）
  const o = _once.get(h);
  if (o) {
    if (Date.now() < o.expiresAt) {
      _once.delete(h);
      return "once";
    }
    _once.delete(h);
  }
  // always（永久檔）
  const map = readAlways(cwd);
  if (map[h]) return "always";
  return null;
}

/** 目前 pending 清單（UI/debug 用） */
export function listPending() {
  return [..._pending.entries()].map(([id, v]) => ({ id, ...v }));
}

// ── 永久准許清單（2026-10-11 Fleming：現在完全看不到也撤不掉 = 最大盲點）──

/** 列出該 RU 已永久准許的指令 */
export function listAlways(cwd) {
  const map = readAlways(cwd);
  return Object.entries(map)
    .map(([hash, v]) => ({ hash, command: String(v?.command || ""), allowedAt: v?.allowedAt || "" }))
    .sort((a, b) => String(b.allowedAt).localeCompare(String(a.allowedAt)));
}

/** 撤銷一筆永久准許（依雜湊） */
export function revokeAlways(cwd, hash) {
  const map = readAlways(cwd);
  if (!map[hash]) return { ok: false, error: "找不到此紀錄（可能已撤銷）" };
  const command = String(map[hash]?.command || "");
  delete map[hash];
  writeAlways(cwd, map);
  appendLog(cwd, { type: "decision", id: "revoke_" + hash, command, reason: "使用者撤銷永久准許", decided: "revoked" });
  return { ok: true, command, hash };
}

// ── 審批紀錄（2026-10-11 E：決策要留存，reload 後看得到當時准了什麼）──

function logPath(cwd) {
  return join(cwd || process.cwd(), ".paaw", "exec-approval-log.jsonl");
}

function appendLog(cwd, rec) {
  try {
    const p = logPath(cwd);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify({ ...rec, at: new Date().toISOString() }) + "\n", "utf-8");
  } catch { /* 記錄失敗不擋主流程 */ }
}

/** 讀審批紀錄（request + decision 合併成卡片資料；最近 limit 筆，新→舊） */
export function listApprovalHistory(cwd, limit = 50) {
  try {
    const p = logPath(cwd);
    if (!existsSync(p)) return [];
    const lines = readFileSync(p, "utf-8").split("\n").filter(Boolean);
    const byId = new Map();
    for (const l of lines) {
      let r; try { r = JSON.parse(l); } catch { continue; }
      const cur = byId.get(r.id) || { id: r.id, command: r.command || "", reason: r.reason || "", decided: null, at: r.at };
      if (r.type === "request") { cur.command = r.command || cur.command; cur.reason = r.reason || cur.reason; cur.at = r.at; }
      if (r.type === "decision") { cur.decided = r.decided; cur.decidedAt = r.at; }
      byId.set(r.id, cur);
    }
    return [...byId.values()].slice(-limit).reverse();
  } catch { return []; }
}
