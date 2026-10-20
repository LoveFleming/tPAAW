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
  network_block: "network-whitelist",   // 網路白名單（舊 srt 沙箱時代擋非白名單網域；MXC 時代為審計參考）
  sandbox_fs_deny: "sandbox",           // 沙箱檔案系統（機密 denyRead / 專案外禁寫）
  shell_guard: "shell-guard",           // process 越界（pkill/kill PAAW 鐵律）
  script_guard: "script-guard",         // 危險 script 內容（C 層）
  script_guard_entry: "script-guard",   // 執行入口檔寫入（A 層：git hooks/launchd/rc）
  path_violation: "path-guard",         // 讀寫越界（allowed roots 之外）
  doom_loop: "doom-loop",               // 同參數重複呼叫第 3 次起
  block_retry: "policy-violation",      // 被擋後仍重試同一目標（明知故犯）
  approval_request: "approval",         // 危險指令送審批卡
  approval_decision: "approval",        // 使用者審批決策（once/always/deny）
  approval_granted: "approval",         // 批核後命令真的執行（2026-10-13：審批卡改為真暫停等待）
  network_notice: "network-whitelist",  // 對外網路請求（不擋，交給沙箱把關 — 2026-10-13）
  script_guard_bypassed: "script-guard", // 開發模式略過 script-guard 審批（有記錄可查）
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

const NET_FAIL_RE = /(curl:\s*\((?:6|7|28|35|56|60)\)|CONNECT tunnel failed|Could not resolve host|unable to resolve|Connection timed out|Connection refused|connection timed out; no servers could be reached|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|Network is unreachable|fetch failed)/i;
// 2026-10-13：跨平台 — macOS seatbelt=EPERM/Operation not permitted；Windows ProcessContainer=Access is denied；
// Node 工具鏈（含 MXC/bwrap 經 Node 回報）=EACCES。刻意不收裸 "Permission denied"（shell 工具一般權限錯
// 也會印這句 → 誤報；2026-10-13 保持保守，不擴大誤判面）。
const FS_DENY_RE = /(operation not permitted|EPERM|EACCES|access is denied|ERROR_ACCESS_DENIED)/i;
// ── 通用網路阻擋偵測（2026-10-11 Fleming）──
// 指令含網路意圖（URL / 網路工具）但解析不出具體網域時（例如 host 寫在 script/config 裡），
// 仍要發通知告訴使用者去哪裡設白名單 — 不能默默卡住。
const NET_HINT_RE = /(https?:\/\/|git@|ssh:\/\/|\b(curl|wget|ping|dig|nslookup|traceroute|npm|npx|yarn|pnpm|bun|pip3?|uv|cargo|go|git|brew|apt|apt-get|yum|dnf|docker|wrangler|aws|gcloud|az|kubectl|helm|terraform|node|python3?|deno|ruby|php|java|dotnet|requests|httpx|axios|fetch)\b)/i;
// 本機連線（localhost/loopback）不是「對外」— 不要誤報成白名單問題
const LOCAL_RE = /(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])/i;
// npm 自己的 EPERM（cache 檔鎖 unlink/rename）不是沙箱事件 — 排除
const FS_DENY_FALSE_POSITIVE_RE = /(EPERM|EACCES):\s*(operation not permitted|permission denied)[,:]?\s*(unlink|rename|mkdir|chmod|chown|utime)/i;
// ── 2026-10-20（Fleming B 案）：搜尋工具的「單檔跳過」通知不算被擋 ──
// 教訓（tpaaw-gateway 誤殺事件）：grep -r 掃 repo 必然掃到機密檔（providers.json）→
// 印一行 `grep: ./data/config/providers.json: Operation not permitted`，掃描本身成功繼續；
// 舊版卻把整條指令記 sandbox_fs_deny，30 分鐘累計 3 次 → developer run 被强制停機。
// 格式認定：行首 `grep:/rg:/find:/ag:/ack:` 前綴 = 工具自己跳過該檔繼續跑。
const FS_SKIP_NOTICE_RE = /^\s*(?:grep|rg|find|ag|ack):\s/i;

// ── 明知故犯偵測（2026-10-11 Fleming）──
// 原則：白名單/護欄有意義的前提是「被擋就不能自己繞」。AI 被明確告知不可後仍重試 →
// 第 2 次起記 audit，第 3 次直接停這個 run（executeTool 設 stopReason）。
const _blockAttempts = new Map(); // ruSlug::kind::targets -> {n, at}
const BLOCK_ATTEMPT_TTL_MS = 30 * 60 * 1000; // 同一 RU 30 分鐘內的被擋嘗試累計（跨 run、跨重派）
function _noteBlockAttempt(kind, targets) {
  // key 用 ruSlug（同一專案的父/子 agent 共用）而非 runId，
  // 否則 EM 每次重派都是新 run → 計數歸零 → 重派永遠抓不到（2026-10-11 漏洞修正）。
  let ru = "norun";
  try { const st = runContextALS.getStore(); ru = st?.ruSlug || st?.runId || "norun"; } catch { /* no ALS */ }
  if (_blockAttempts.size > 1000) _blockAttempts.clear();
  const key = `${ru}::${kind}::${(targets || []).join(",")}`;
  const now = Date.now();
  const cur = _blockAttempts.get(key);
  const n = (cur && now - cur.at < BLOCK_ATTEMPT_TTL_MS) ? cur.n + 1 : 1;
  _blockAttempts.set(key, { n, at: now });
  return n;
}
function _repeatNote(attempt, what) {
  if (attempt < 2) return "";
  return `\n\n⛔ 這是你第 ${attempt} 次嘗試已被擋的${what} — 已記錄審計。${attempt >= 3 ? "本工作已停止。" : "立刻停止重試；"}改用 ask_user 請人處理（設定 → 🛡 安全）。`;
}

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
  // 錯誤訊息裡的裸網域（ENOTFOUND api.foo.com / Failed to connect to api.foo.com port 443）
  for (const m of cmd.matchAll(/(?:ENOTFOUND|getaddrinfo|resolve host:?|Failed to connect to|Unable to connect to|connect to)\s*:?\s*(?:ENOTFOUND\s+)?([a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9])/gi)) {
    const h = m[1].toLowerCase();
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) hosts.add(h);
  }
  // env-var 指定外部 host（DEMO_HOST=api.foo.com / API_URL=api.foo.com）
  for (const m of cmd.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*(?:HOST|URL|DOMAIN|ENDPOINT|API)[A-Za-z0-9_]*=([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) {
    hosts.add(m[1].toLowerCase());
  }
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
 * @param sandboxActive 沙箱此刻是否生效（通用網路阻擋分支只在沙箱有效時才發，避免純離線誤報）
 * @returns null | { type: "network_block"|"sandbox_fs_deny", domains?, exitCode, agentNotice, userNotice }
 * 回傳的物件已附帶給 agent 的引導（tool result 附加）與給使用者的通知（security_notice SSE）。
 */
export function scanCommandOutput({ command, output, allowedDomains, agentId, cwd, tool = "bash", audit = true, sandboxActive = true }) {
  const out = String(output || "");
  if (!out) return null;
  // 2026-10-20（B 案）：runShell 是先附 "Exit code: N" 再接 "🛡沙箱內（MXC）" 標記 →
  // 舊版 /Exit code:\s*(\d+)\s*$/ 的 $ 錨點永遠匹配不到（audit 裡 exitCode 全是 null）。
  // 取最後一筆（runShell 的附加行一定在最尾；runShell 只在非零退出才附）→ null 即成功。
  const exitMatches = [...out.matchAll(/Exit code:\s*(\d+)/g)];
  const exitCode = exitMatches.length ? Number(exitMatches[exitMatches.length - 1][1]) : null;
  const netFailed = NET_FAIL_RE.test(out);
  const allowed = allowedDomains || [];

  // ── 網路白名單阻擋（精確）：非白名單網域（指令或錯誤訊息中）+ 網路失敗簽名 ──
  // 同時掃 output — host 常只出現在錯誤訊息裡（"Could not resolve host: x"）
  const hosts = [...new Set([...nonWhitelistedHosts(command, allowed), ...nonWhitelistedHosts(out, allowed)])];
  if (hosts.length > 0 && netFailed) {
    const hostList = hosts.slice(0, 5).join("、");
    const attempt = _noteBlockAttempt("network_block_host", hosts);
    const repeat = attempt >= 2;
    if (audit) logAuditEvent({ kind: "network_block", severity: "block", tool, command, domains: hosts, reason: `連線非白名單網域被沙箱阻擋（exit=${exitCode ?? "?"}）` + (repeat ? ` — 第 ${attempt} 次重試（明知故犯）` : ""), detail: { exitCode, attempt, outputTail: out.slice(-600) }, agentId, cwd });
    if (repeat && audit) logAuditEvent({ kind: "block_retry", severity: "block", tool, command, domains: hosts, reason: `被擋後仍重試非白名單網域（第 ${attempt} 次）— 明知故犯`, detail: { attempt }, agentId, cwd });
    return {
      type: "network_block", domains: hosts, exitCode, attempt, repeatOffense: repeat, stopRun: attempt >= 3,
      agentNotice: `\n\n🌐 [PAAW 網路白名單] 偵測到對非白名單網域的連線被沙箱阻擋：${hostList}。這不是網路故障，是 PAAW 安全防護。**不要重試同一個連線**；若這是任務必要的外部服務，說明白要連哪個 host、為什麼，請人去「設定 → 🛡 安全 → 網路白名單」加上（儲存後立即生效）。${_repeatNote(attempt, "網域")}`,
      userNotice: `🌐 安全防護：AI 嘗試連線到非白名單網域 ${hostList}，已阻擋並記錄審計。若為必要服務，可到「設定 → 🛡 安全 → 網路白名單」加入該網域。` + (repeat ? `（AI 已重試第 ${attempt} 次）` : ""),
    };
  }

  // ── 網路阻擋（通用）：有網路意圖但完全解析不出網域（host 藏在 script/config 裡）+ 網路失敗簽名 ──
  // 目的（Fleming 2026-10-11）：只要對外連線被卡，一定要有訊息告訴使用者去哪裡設定允許的對外 host。
  // 防誤報：若錯誤訊息裡的網域都在白名單内（例如 npm 離線但 registry 已允許）→ 是真斷網不是阻擋，不發。
  const outHosts = extractHosts(out);
  const failureHostLooksAllowed = outHosts.length > 0 && outHosts.every(h => isHostAllowed(h, allowed));
  if (
    hosts.length === 0 && netFailed && sandboxActive && !failureHostLooksAllowed &&
    NET_HINT_RE.test(String(command || "")) &&
    !LOCAL_RE.test(String(command || "")) && !LOCAL_RE.test(out)
  ) {
    if (audit) logAuditEvent({ kind: "network_block", severity: "warn", tool, command, reason: `對外連線失敗（未能從指令解析出網域）— 疑似沙箱網路白名單阻擋（exit=${exitCode ?? "?"}）`, detail: { exitCode, outputTail: out.slice(-600) }, agentId, cwd });
    const attempt = _noteBlockAttempt("network_block_generic", []);
    const repeat = attempt >= 2;
    if (repeat && audit) logAuditEvent({ kind: "block_retry", severity: "block", tool, command, reason: `被擋後仍重試對外連線（第 ${attempt} 次）— 明知故犯`, detail: { attempt }, agentId, cwd });
    return {
      type: "network_block", domains: [], exitCode, attempt, repeatOffense: repeat, stopRun: attempt >= 3,
      agentNotice: `\n\n🌐 [PAAW 網路白名單] 偵測到對外連線失敗。這很可能是 PAAW 沙箱白名單阻擋（不是一般網路故障）。**不要重複重試**；若這是任務必要的外部服務，說明白要連哪個 host、為什麼，請人去「設定 → 🛡 安全 → 網路白名單」加上目標 host。${_repeatNote(attempt, "對外連線")}`,
      userNotice: `🌐 網路防護：AI 的對外連線失敗，可能被沙箱白名單阻擋。若為必要服務，請到「設定 → 🛡 安全 → 網路白名單」加入目標網域（host），儲存後立即生效。`,
    };
  }

  // ── 沙箱檔案系統拒絕（2026-10-20 Fleming B 案重構：兩級判定，不再强制停 run）──
  // ① 單檔跳過（grep -r 掃到機密檔等）：指令成功、工具自己跳過 → 只記 info 審計，不發信號。
  // ② 真被擋（EPERM 是本指令的主要結果）：記 warn 審計 + 引導 agent，但**不進 block-attempt
  //    計數、不再 stopRun** — 防護已在執行層完成（沙箱本身擋掉該次操作），輸出掃描只負責翻譯，
  //    不再升級懲罰。強制停 run 保留給 network_block（那才是「被明確告知後仍重試」）。
  //    （誤殺實例：讀 review 報告，內容引用 audit 的 "Operation not permitted" 原文 → 中獎計數。）
  if (FS_DENY_RE.test(out) && !FS_DENY_FALSE_POSITIVE_RE.test(out)) {
    const denyLines = out.split(/\r?\n/).filter(l => FS_DENY_RE.test(l) && !FS_DENY_FALSE_POSITIVE_RE.test(l));
    const skipOnly = denyLines.length > 0 && denyLines.every(l => FS_SKIP_NOTICE_RE.test(l));
    if (skipOnly && exitCode == null) {
      // ① 指令成功、只有單檔被跳過 — 不是安全事件，落 info 審計即可（可觀測、不打擾）
      if (audit) logAuditEvent({ kind: "sandbox_fs_deny", severity: "info", tool, command, reason: "掃描工具跳過受保護檔案（單檔 skip，指令本身成功）— 非安全事件", detail: { exitCode, skipOnly: true, denyLines: denyLines.slice(0, 5), outputTail: out.slice(-600) }, agentId, cwd });
      return null;
    }
    // ② 真被擋：audit warn + 引導；不計數、不停 run（stopRun 恆 false）
    if (audit) logAuditEvent({ kind: "sandbox_fs_deny", severity: "warn", tool, command, reason: "指令觸發 OS 權限拒絕（Operation not permitted / EPERM）— 可能讀取受保護檔案（~/.ssh、.env、providers.json）或寫入專案外路徑", detail: { exitCode, skipOnly, outputTail: out.slice(-600) }, agentId, cwd });
    return {
      type: "sandbox_fs_deny", exitCode, attempt: 1, repeatOffense: false, stopRun: false,
      agentNotice: `\n\n🔒 [PAAW 沙箱防護] 這次操作被沙箱權限拒絕（Operation not permitted / EPERM）— 該路徑受保護或在專案目錄外。已記錄安全審計。改在專案目錄內操作；需要機密設定時請使用者手動處理。`,
      userNotice: `🔒 沙箱防護：AI 指令觸發權限拒絕（機密檔案防讀 / 專案外禁寫），已記錄安全審計。`,
    };
  }

  return null;
}
