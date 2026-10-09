// ── audit-log.mjs — AI 安全審計中樞（2026-10-10 Fleming 需求）──
//
// 「AI 犯傻」= 觸發任何安全防護（白名單/沙箱/guard/doom loop/路徑違規/審批）。
// 每一筆犯傻事件：
//   ① 落盤 log/logs/audit/audit-YYYY-MM-DD.jsonl（事實來源，ES 斷線也不丟）
//   ② 即時送 Elasticsearch paaw-audit-YYYY.MM.dd（獨立 index，與 agent-logs 分流）
//      — 經 es-shipper.mjs shipAuditEvent（PAAW_ES_URL 未設定 = 關閉，零開銷）
//   ③ 呼叫端拿回完整 doc → 自行回饋 agent（tool result 附引導）與使用者（security_notice SSE）
//
// 設計原則：審計永不影響主流程 — 所有 IO 都 try/catch，錯了就丟，agent loop 照跑。
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import os from "os";
import { ASSET_LOGS_ROOT } from "../data-home.mjs";
import { runContextALS } from "./proc-ledger.mjs";

const AUDIT_DIR = join(ASSET_LOGS_ROOT, "audit");

// ── kind → 防護層對照（audit 事件自描述，ES 端可 aggregation）──
const KIND_LAYER = {
  network_block: "network-whitelist",   // 網路白名單（srt 沙箱擋非白名單網域）
  sandbox_fs_deny: "sandbox",           // 沙箱檔案系統（機密 denyRead / 專案外禁寫）
  shell_guard: "shell-guard",           // process 越界（pkill/kill PAAW 鐵律）
  script_guard: "script-guard",         // 危險 script 內容（C 層）
  script_guard_entry: "script-guard",   // 執行入口檔寫入（A 層：git hooks/launchd/rc）
  path_violation: "path-guard",         // 讀寫越界（allowed roots 之外）
  doom_loop: "doom-loop",               // 同參數重複呼叫第 3 次起
  approval_request: "approval",         // 危險指令送審批卡
  approval_decision: "approval",        // 使用者審批決策（once/always/deny）
  env_exec_block: "env-exec",           // chat 助理環境工具白名單攔截
};

// ── host stamp（audit 檔自帶機器資訊 — 多機部署分得清誰）──
let _HOST = null;
function hostInfo() {
  if (_HOST) return _HOST;
  let ip = "";
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      const hit = (list || []).find(n => n.family === "IPv4" && !n.internal);
      if (hit) { ip = hit.address; break; }
    }
  } catch { /* best-effort */ }
  _HOST = { hostName: os.hostname() || "unknown", hostIp: ip || "unknown" };
  return _HOST;
}

export function auditFileFor(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return join(AUDIT_DIR, `audit-${y}-${m}-${d}.jsonl`);
}

/**
 * 記一筆安全審計事件。永不 throw、永不阻塞（sync append 檔案 + async ship ES）。
 * @param {object} evt
 *   kind      必填 — 見 KIND_LAYER
 *   severity  block | warn | info（預設 warn）
 *   tool      觸發的工具名（bash / write_file / env_exec …）
 *   command   完整指令/參數（cap 4000 字 — ES bulk 防爆，檔案留全）
 *   reason    攔截理由（guard message 等）
 *   domains   網域陣列（network_block 用）
 *   detail    任意補充 JSON
 *   agentId / cwd — 呼叫端給
 * @returns 完整 doc（含 eid / @timestamp / runId / host）
 */
export function logAuditEvent(evt) {
  evt = evt || {}; // 壞形狀輸入也不 throw（審計永不影響主流程）
  const rc = (() => { try { return runContextALS.getStore() || {}; } catch { return {}; } })();
  const h = hostInfo();
  const doc = {
    eid: randomUUID(),
    version: 1,
    kind: String(evt.kind || "unknown"),
    severity: ["block", "warn", "info"].includes(evt.severity) ? evt.severity : "warn",
    layer: evt.layer || KIND_LAYER[evt.kind] || "unknown",
    tool: evt.tool || null,
    command: evt.command != null ? String(evt.command).slice(0, 4000) : null,
    reason: evt.reason != null ? String(evt.reason).slice(0, 2000) : null,
    domains: Array.isArray(evt.domains) ? evt.domains.slice(0, 20) : undefined,
    detail: evt.detail !== undefined ? JSON.parse(JSON.stringify(evt.detail)) : undefined,
    agentId: evt.agentId || null,
    runId: rc.runId || null,
    ruSlug: rc.ruSlug || null,
    cwd: evt.cwd || null,
    ...h,
    "@timestamp": new Date().toISOString(),
  };
  if (doc.detail === undefined) delete doc.detail;
  if (doc.domains === undefined) delete doc.domains;
  // ① 落盤（事實來源）
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(auditFileFor(), JSON.stringify(doc) + "\n");
  } catch { /* 審計失敗不影響主流程 */ }
  // ② 送 ES（paaw-audit-* 獨立 index；未設定 PAAW_ES_URL = no-op）
  try {
    import("./es-shipper.mjs").then(m => m.shipAuditEvent(doc)).catch(() => {});
  } catch { /* no-op */ }
  return doc;
}

// ══════════════════════════════════════════
// ── bash 輸出安全掃描：白名單阻擋 / 沙箱拒絕 偵測（2026-10-10）──
// 沙箱擋掉連線時輸出只有 cryptic 簽名（curl 000 exit 28 / Operation not permitted / EPERM），
// 這裡翻譯成人話：agent 知道去哪設定、使用者收到 security_notice、audit 落 ES。
// ══════════════════════════════════════════

const NET_FAIL_RE = /(curl:\s*\((?:6|7|28|35)\)|Could not resolve host|unable to resolve|Connection timed out|Connection refused|connection timed out; no servers could be reached|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|Network is unreachable|fetch failed)/i;
const FS_DENY_RE = /(operation not permitted|EPERM)/i;
// npm 自己的 EPERM（cache 檔鎖 unlink/rename）不是沙箱事件 — 排除
const FS_DENY_FALSE_POSITIVE_RE = /EPERM:\s*operation not permitted,\s*(unlink|rename|mkdir)/i;

/** 從指令抽出候選外部 host：URL / git@host: / net 工具參數 */
export function extractHosts(command) {
  const cmd = String(command || "");
  const hosts = new Set();
  // https?://host[:port]/…
  for (const m of cmd.matchAll(/https?:\/\/([a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9])(?::\d+)?/g)) hosts.add(m[1].toLowerCase());
  // git@host:repo / ssh://host/…
  for (const m of cmd.matchAll(/(?:git@|ssh:\/\/)([a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]):/g)) hosts.add(m[1].toLowerCase());
  // curl/wget/ping/dig 的裸網域參數（避免誤抓檔名 — 只認這幾個工具後面的 token）
  for (const m of cmd.matchAll(/(?:curl|wget|ping|dig|nslookup|host)\s+(?:-[a-zA-Z-]+\s+)*((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g)) hosts.add(m[1].toLowerCase());
  // localhost / IP 不是「外部網域」
  return [...hosts].filter(h => h !== "localhost" && !/^\d+\.\d+\.\d+\.\d+$/.test(h));
}

/** host 是否允許：精確匹配或允許網域的 subdomain（example.com 允許 → api.example.com 也允許） */
export function isHostAllowed(host, allowedDomains) {
  return allowedDomains.some(d => {
    const dd = String(d).toLowerCase().trim();
    return host === dd || host.endsWith("." + dd);
  });
}

/** 指令中的非白名單網域（給 agent 提示用） */
export function nonWhitelistedHosts(command, allowedDomains) {
  return extractHosts(command).filter(h => !isHostAllowed(h, allowedDomains));
}

/**
 * 掃 bash/env_exec 輸出 → 偵測「被安全防護擋掉」的跡象。
 * @returns null | { type: "network_block"|"sandbox_fs_deny", domains?, exitCode, agentNotice, userNotice }
 * 回傳的物件已附帶給 agent 的引導（tool result 附加）與給使用者的通知（security_notice SSE）。
 */
export function scanCommandOutput({ command, output, allowedDomains, agentId, cwd, tool = "bash", audit = true }) {
  const out = String(output || "");
  if (!out) return null;
  const exitMatch = out.match(/Exit code:\s*(\d+)\s*$/);
  const exitCode = exitMatch ? Number(exitMatch[1]) : null;

  // ── 網路白名單阻擋：指令含非白名單網域 + 網路失敗簽名 ──
  const hosts = nonWhitelistedHosts(command, allowedDomains || []);
  if (hosts.length > 0 && NET_FAIL_RE.test(out)) {
    const hostList = hosts.slice(0, 5).join("、");
    if (audit) logAuditEvent({ kind: "network_block", severity: "block", tool, command, domains: hosts, reason: `連線非白名單網域被沙箱阻擋（exit=${exitCode ?? "?"}）`, detail: { exitCode, outputTail: out.slice(-600) }, agentId, cwd });
    return {
      type: "network_block", domains: hosts, exitCode,
      agentNotice: `\n\n🌐 [PAAW 網路白名單] 偵測到對非白名單網域的連線被沙箱阻擋：${hostList}。這不是網路故障，是 PAAW 安全防護。若這是任務必要的外部服務，請用 ask_user 向使用者說明，請他到「設定 → 🛡 安全」分頁把該網域加入網路白名單（儲存後立即生效，無需重啟）。在此之前不要重試同一個連線。`,
      userNotice: `🌐 安全防護：AI 嘗試連線到非白名單網域 ${hostList}，已阻擋並記錄審計。若為必要服務，可到「設定 → 🛡 安全」加入該網域。`,
    };
  }

  // ── 沙箱檔案系統拒絕：機密 denyRead / 專案外禁寫（EPERM 家族，排除 npm 誤報）──
  if (FS_DENY_RE.test(out) && !FS_DENY_FALSE_POSITIVE_RE.test(out)) {
    if (audit) logAuditEvent({ kind: "sandbox_fs_deny", severity: "warn", tool, command, reason: "指令觸發 OS 權限拒絕（Operation not permitted / EPERM）— 可能讀取受保護檔案（~/.ssh、.env、providers.json）或寫入專案外路徑", detail: { exitCode, outputTail: out.slice(-600) }, agentId, cwd });
    return {
      type: "sandbox_fs_deny", exitCode,
      agentNotice: `\n\n🔒 [PAAW 沙箱防護] 指令觸發 OS 權限拒絕（Operation not permitted / EPERM）— 可能是讀取受保護檔案（~/.ssh、.env、providers.json）或寫入專案目錄外的路徑。此事件已記錄安全審計。請調整做法：在專案目錄內操作；需要機密設定時請使用者手動處理。`,
      userNotice: `🔒 沙箱防護：AI 指令觸發權限拒絕（機密檔案防讀 / 專案外禁寫），已記錄安全審計。`,
    };
  }

  return null;
}
