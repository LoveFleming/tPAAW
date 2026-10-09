// ── exec-approvals：AI bash 審批卡登記（2026-10-09，Fleming 拍板三點之三）──
// script-guard 攔截危險指令 → UI 審批卡（✅准許一次 ♾️永遠 ❌拒絕）
// 決策模型（抄 OpenClaw exec approvals）：
//   once   = 記憶體，單次消耗，10 分鐘過期
//   always = <RU>/.paaw/exec-approvals.json 永久（同指令雜湊）
//   deny   = 不記錄（本來就是擋的狀態）

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
  return id;
}

/** 使用者決策。回 { ok, action } */
export function decideApproval(id, action) {
  const entry = _pending.get(id);
  if (!entry) return { ok: false, error: "找不到待審批項目（可能已過期）" };
  _pending.delete(id);
  if (action === "once") {
    _once.set(hashOf(entry.command), { createdAt: Date.now(), expiresAt: Date.now() + ONCE_TTL_MS });
  } else if (action === "always") {
    const map = readAlways(entry.cwd);
    map[hashOf(entry.command)] = { command: entry.command, allowedAt: new Date().toISOString() };
    writeAlways(entry.cwd, map);
  } else if (action !== "deny") {
    return { ok: false, error: "action 必須是 once / always / deny" };
  }
  return { ok: true, action, command: entry.command };
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
