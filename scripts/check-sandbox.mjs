#!/usr/bin/env node
/**
 * scripts/check-sandbox.mjs — PAAW 沙箱自我檢查（macOS / Linux / Windows 都能跑）
 *
 * 目的：不用讀程式碼，跑這支就知道沙箱「實際行為」對不對。
 * 用法：node scripts/check-sandbox.mjs            （在 PAAW 根目錄跑）
 *       node scripts/check-sandbox.mjs --verbose  （印出每一步的原始輸出）
 * 離開碼：0 = 全過；1 = 有 FAIL
 *
 * 對應 DEPLOY.md 的驗收清單 ①~⑤，並多驗 6 項邊界行為。
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";

const VERBOSE = process.argv.includes("--verbose");
const results = [];
const ok = (n, d = "") => results.push({ s: "PASS", n, d });
const bad = (n, d = "") => results.push({ s: "FAIL", n, d });
const skip = (n, d = "") => results.push({ s: "SKIP", n, d });
const info = (n, d = "") => results.push({ s: "INFO", n, d });

let sb;
try {
  sb = await import("../packages/server/src/lib/paaw-sandbox.mjs");
} catch (e) {
  console.error("❌ 載入 paaw-sandbox.mjs 失敗：", e.message);
  process.exit(1);
}
const { execSandboxed, sandboxAvailable, activeBackend, needsNetworkAllow, sandboxTempRoots } = sb;

// RU：優先 $PAAW_SELFCHECK_RU，其次系統 temp；若落在沙箱的 denied 路徑內（例如 ~/.ssh、~/.openclaw）
// 就退到 PAAW 專案內的暫存目錄 —— 因為 denied 優先於 readwrite，寫什麼都會被擋。
import { LOG_HOME } from "../packages/server/src/data-home.mjs";
const inside = (p, d) => p === d || p.startsWith(d + "/") || p.startsWith(d + "\\");
const deniedList = (sb.buildMxcFsPolicy ? sb.buildMxcFsPolicy(process.cwd()).deniedPaths : []);
let RU = process.env.PAAW_SELFCHECK_RU || join(tmpdir(), "paaw-selfcheck");
if (deniedList.some((d) => inside(RU, d))) RU = join(process.cwd(), ".paaw-selfcheck-tmp");
rmSync(RU, { recursive: true, force: true });
mkdirSync(RU, { recursive: true });

// 跟 agent loop 一樣把 log/tmp 環境變數帶進沙箱（不然 $PAAW_APP_CONSOLE_DIR 是空的）
const SB_ENV = {
  PAAW_LOG_HOME: LOG_HOME,
  PAAW_APP_CONSOLE_DIR: join(LOG_HOME, "app-console", "selfcheck"),
  PAAW_TMP: join(LOG_HOME, "tmp", "selfcheck"),
};

const run = (cmd, opts = {}) => execSandboxed(cmd, { cwd: RU, timeoutMs: 45000, env: SB_ENV, ...opts });
const sh = (r) => ((r?.stdout || "") + (r?.stderr || "")).trim();
const log = (label, r) => { if (VERBOSE) console.log(`   [${label}] code=${r?.code} sb=${r?.sandboxed}\n   out: ${sh(r).slice(0, 300).replace(/\n/g, "\n        ")}`); };

console.log("\n🛡 PAAW 沙箱自我檢查  —  RU:", RU, "\n");

// ① 後端與可用性
const avail = await sandboxAvailable();
const backend = activeBackend();
info("偵測到的後端 (activeBackend)", String(backend));
if (avail) ok("① 沙箱可用 (sandboxAvailable=true)", `backend=${backend}`);
else bad("① 沙箱可用", "sandboxAvailable=false → 未安裝 @microsoft/mxc-sdk 或平台不支援（設定頁會顯示紅字 ⚠️）");

if (!avail) {
  console.log("沙箱不可用 → 後續行為測試全部跳過（先裝 MXC：scripts/install-mxc-offline.sh）\n");
}

// ② RU（專案目錄）內可寫
if (avail) {
  const r = await run('echo hello > inru.txt && cat inru.txt'); log("RU 內寫檔", r);
  (r.code === 0 && sh(r).includes("hello")) ? ok("② 專案(RU)內可讀寫") : bad("② 專案(RU)內可讀寫", `code=${r.code} ${sh(r).slice(0,150)}`);
}

// ③ 家目錄 / RU 外：應被拒
if (avail) {
  const target = join(homedir(), `paaw-selfcheck-pwned-${Date.now()}.txt`);
  const r = await run(`echo x > "${target}"`); log("寫 HOME", r);
  const wrote = existsSync(target);
  if (wrote) { bad("③ 沙箱外(家目錄)寫入被擋", "竟然寫成功了！sandbox 沒生效"); rmSync(target, { force: true }); }
  else ok("③ 沙箱外(家目錄)寫入被擋");
  const r2 = await run(`ls "${homedir()}/.ssh" 2>&1`); log("讀 ~/.ssh", r2);
  /Operation not permitted|Permission denied|permission denied/i.test(sh(r2))
    ? ok("④ 讀 ~/.ssh 被擋") : (existsSync(join(homedir(), ".ssh")) ? bad("④ 讀 ~/.ssh 被擋", sh(r2).slice(0,120)) : skip("④ 讀 ~/.ssh 被擋", "此機器沒有 ~/.ssh"));
}

// ⑤ log 根 / temp 可寫（agent 導出 app log 用）
if (avail) {
  const r = await run('d="$PAAW_APP_CONSOLE_DIR"; mkdir -p "$d" && echo x > "$d/selfcheck.log" && echo ok'); log("log 根", r);
  sh(r).includes("ok") ? ok("⑤ $PAAW_APP_CONSOLE_DIR(=$PAAW_LOG_HOME)可寫") : bad("⑤ log 根可寫", `code=${r.code} ${sh(r).slice(0,150)}`);
  const r2 = await run('echo x > "$TMPDIR/paaw-selfcheck-tmp" && echo ok'); log("TMPDIR", r2);
  sh(r2).includes("ok") ? ok("⑥ $TMPDIR 可寫") : bad("⑥ $TMPDIR 可寫", `code=${r2.code}`);
}

// ⑦ 開發常用指令：git / node / python
if (avail) {
  const r = await run('git init -q . 2>/dev/null; git -c user.email=a@b -c user.name=a commit -q --allow-empty -m x 2>/dev/null && git log --oneline | head -1'); log("git", r);
  r.code === 0 && /\w{7}/.test(sh(r)) ? ok("⑦ 沙箱內 git 可 init/commit") : bad("⑦ 沙箱內 git", `code=${r.code} ${sh(r).slice(0,150)}`);
  const r2 = await run('node -e "console.log(\'node-ok\')"'); log("node", r2);
  sh(r2).includes("node-ok") ? ok("⑧ 沙箱內 node 可跑") : bad("⑧ 沙箱內 node", sh(r2).slice(0,120));
  const r3 = await run('python3 -c "print(\'py-ok\')" 2>/dev/null || python -c "print(\'py-ok\')" 2>/dev/null'); log("python", r3);
  sh(r3).includes("py-ok") ? ok("⑨ 沙箱內 python 可跑") : skip("⑨ 沙箱內 python", "此機器沒有 python（不影響）");
}

// ⑩ 網路：需要網路的指令放行 / 一般指令被斷網
if (avail) {
  const r = await run('curl -s -m 8 -o /dev/null -w "%{http_code}" https://example.com/ 2>&1', { network: "allow" }); log("curl allow", r);
  /^2\d\d|^3\d\d/.test(sh(r)) ? ok("⑩ 需要網路時可連外（curl）") : skip("⑩ curl 連外", `無外網或公司 proxy？(${sh(r).slice(0,60)})`);
  const r2 = await run('node -e "fetch(\'https://example.com\').then(()=>console.log(\'NET_OPEN\')).catch(()=>console.log(\'NET_BLOCKED\'))"', { network: "deny" }); log("node fetch deny", r2);
  const o = sh(r2);
  o.includes("NET_BLOCKED") ? ok("⑪ 一般指令被斷網（node fetch → 被擋）")
    : o.includes("NET_OPEN") ? bad("⑪ 一般指令被斷網", "竟然連出去了！MXC 網路政策沒生效") : skip("⑪ 一般指令斷網", o.slice(0,80));
}

// ⑫ 回歸守門：沙箱標記不得污染結構化輸出（2026-10-13 bug #4）
try {
  const src = await (await import("fs/promises")).readFile(new URL("../packages/server/src/lib/paaw-agent-loop.mjs", import.meta.url), "utf8");
  const m = [...src.matchAll(/🛡沙箱[內内]（MXC）/g)];
  const guarded = /opts\.marker \?/.test(src);
  (guarded && m.length <= 2) ? ok("⑫ 沙箱標記只給 bash tool（結構化輸出乾淨）")
    : bad("⑫ 沙箱標記守門", `opts.marker 守門=${guarded}, 標記出現 ${m.length} 次`);
} catch (e) { skip("⑫ 標記守門", e.message); }

rmSync(RU, { recursive: true, force: true });

// 報告
console.log("─".repeat(64));
for (const r of results) {
  const icon = r.s === "PASS" ? "✅" : r.s === "FAIL" ? "❌" : r.s === "SKIP" ? "⏭️ " : "ℹ️ ";
  console.log(`${icon} ${r.n}${r.d ? "  — " + r.d : ""}`);
}
const fails = results.filter((r) => r.s === "FAIL").length;
console.log("─".repeat(64));
console.log(fails === 0 ? "🎉 全部通過（沒有 FAIL）" : `❌ 有 ${fails} 項 FAIL —— 請把上面這段貼給 Fleming 看`);
console.log("註：PASS 只代表這幾項『實際行為』對；不代表全部程式無 bug。\n");
process.exit(fails === 0 ? 0 : 1);
