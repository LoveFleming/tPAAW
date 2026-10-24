/**
 * script-guard.mjs — AI 寫檔/執行安全掃描（2026-10-09 Fleming 拍板 A+B+C 掃描版）
 *
 * 原則（Evidence-Driven）：該快的全速跑，該問的才問。
 *  - 正常 AI coding（寫測試腳本、跑 build、npm install 乾淨專案）零摩擦
 *  - 只攔「執行入口檔案寫入」與「危險 pattern 的 script 執行」
 *
 * A. persistentEntryBlock(path) — 執行入口檔案（git hooks/launchd/shell rc/ssh）AI 不可寫
 * C. guardScriptExecution(cmd, cwd) — bash 跑 node/python/sh 檔案前掃內容；
 *    npm run <script> 解析 package.json scripts 值掃描；node -e / python -c inline 掃描
 * B. env_exec 用 scanScriptContent + npm install dirty 檢查（見 env-exec-tool.mjs）
 *
 * Pattern 故意粗爆（blunt）：injection payload 通常就是 curl 外傳 + 持久化 + 破壞三件套。
 * localhost 明確放行（測試常打本地 API）。
 */
import { readFileSync, existsSync } from "fs";
import { resolve as resolvePath, isAbsolute } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";

const HOME = homedir();

// ── 信任範圍 ──
// 專案自己的地盤（RU 工作目錄）＋ 暫存區
// 這些範圍內的檔案讀寫 = AI 的合法活動範圍，不該一直跳審批卡。
function trustedRoots(cwd) {
  const roots = [];
  if (cwd) roots.push(resolvePath(cwd));
  for (const t of ["/tmp", "/private/tmp", resolvePath(HOME, ".npm"), resolvePath(HOME, ".cache")]) {
    try { if (existsSync(t)) roots.push(t); } catch { /* ignore */ }
  }
  return roots;
}

function insideTrusted(absPath, cwd) {
  if (!absPath) return false;
  let abs;
  try { abs = resolvePath(absPath); } catch { return false; }
  for (const r of trustedRoots(cwd)) {
    if (abs === r || abs.startsWith(r + "/")) return true;
  }
  return false;
}

/** 機密路徑只擋「RU 之外」的（2026-10-13 Fleming）：~/.ssh 永遠擋；
 *  專案內的 .env / providers.json = 開發常態（讀值 debug），放行但留審計。 */
function secretPathHit(cmd, cwd) {
  const text = String(cmd || "");
  if (/(~\/\.ssh|\/\.ssh\/|\.ssh[\\/]id_|\.ssh[\\/])/.test(text)) {
    return { hit: true, why: "SSH 金鑰/設定" };
  }
  const re = /(?:^|[\s"'=:(])([^\s"'`;|&()]*?(?:\/\.env\b|\.env\b|providers\.json\b|id_rsa\b|id_ed25519\b))/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1].replace(/["']$/, "");
    if (!raw) continue;
    const abs = raw.startsWith("~")
      ? resolvePath(HOME, raw.replace(/^~[\\/]?/, ""))
      : (isAbsolute(raw) ? raw : resolvePath(cwd || process.cwd(), raw));
    if (!insideTrusted(abs, cwd)) return { hit: true, why: `機密檔（專案外）：${raw}` };
  }
  return { hit: false };
}

// ── A. 執行入口檔案（AI 永遠不可寫 — 寫了會在「人不在場」時執行）──
const PERSISTENT_ENTRY_RULES = [
  { test: (p) => /[\\/]\.git[\\/]hooks[\\/]/.test(p), name: "git hooks" },
  { test: (p) => /[\\/]Library[\\/]LaunchAgents[\\/].*\.plist$/.test(p) || /[\\/]Library[\\/]LaunchDaemons[\\/]/.test(p), name: "launchd plist" },
  { test: (p) => /^[\\/](etc|Library)[\\/]cron/i.test(p) || /crontab/i.test(p.split(/[\\/]/).pop() || ""), name: "crontab" },
  { test: (p) => /^(\.zshrc|\.zprofile|\.zshenv|\.bashrc|\.bash_profile|\.profile)$/i.test(p.split(/[\\/]/).pop() || "") && p.startsWith(HOME), name: "shell rc" },
  { test: (p) => p.startsWith(HOME + "/.ssh") || p.startsWith(HOME + "\\.ssh"), name: "ssh 設定" },
  { test: (p) => /[\\/]node_modules[\\/]\.bin[\\/]/.test(p), name: "node_modules/.bin" },
  { test: (p) => /[\\/]\.config[\\/]autostart[\\/]/.test(p), name: "autostart" },
  // 2026-10-13 Windows 持久化入口
  { test: (p) => /[\\/]Start Menu[\\/]Programs[\\/]Startup([\\/]|$)/i.test(p), name: "Windows Startup" },
];

export function persistentEntryBlock(pathStr) {
  if (!pathStr) return null;
  const abs = isAbsolute(pathStr) ? pathStr : resolvePath(process.cwd(), pathStr);
  for (const r of PERSISTENT_ENTRY_RULES) {
    if (r.test(abs)) {
      return {
        blocked: true,
        name: r.name,
        message: `🚫 安全攔截：${abs}\n「${r.name}」是執行入口檔案（會在你不在場時被執行），AI 不可寫入。\n如真有需求：請人工修改，或請使用者明確指示後由人工操作。\n（script-guard A — 2026-10-09）`,
      };
    }
  }
  return null;
}

// ── 危險 pattern（內容掃描 — B/C 共用）──
// 跨語言網路 API：JS(fetch/axios/node-fetch/got)、Python(requests/urllib/http.client/socket)、
// Ruby(Net::HTTP/open-uri)、PHP(file_get_contents/curl_init)、PowerShell(Invoke-WebRequest/iwr)、通用 curl/wget
// 2026-10-13 大改（Fleming）：原本 NET_TOOLS(fetch/axios/requests…) + EXT_URL「同時出現就擋」
// 會把正常程式碼全部誤判 —— 原始碼裡有 fetch + 外部 API 網址是常態（monitor.mjs、SDK client…），
// 連 `grep -n slice(-10) ./monitor.mjs` 都因讀檔掃描被擋，等於不能開發。
// 新原則：
//   1) 只看「真的在對外連」：網路工具出現在指令位置（行首/&&/;/|/( 之後）且帶外部 URL
//   2) 檔案內容不再用寬鬆的網路 API 啟發式 —— 對外連線的守門交給沙箱（MXC deny-by-default + 輸出審計）
//      ＋執行後輸出審計（audit-log scanCommandOutput）。事實靠機制，不靠猜字串。
// localhost / 127.0.0.1 / 變數開頭不算（測試常打本地 API）
const EXT_URL_SRC = "https?:\\/\\/(?!localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]|\\$\\{?[A-Z_])";
const EXT_URL = new RegExp(EXT_URL_SRC, "i");
// NET_CMD：網路工具在「指令位置」（含引號內，如 execSync("curl https://…")）且帶外部 URL 才算外傳
const NET_CMD = new RegExp("(?:^|[\\n;&|(=]|\\|\\|)\\s*[\"'\x60]?\\s*(?:sudo\\s+)?(?:curl|wget|nc|ncat|telnet|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\\b[^\\n]{0,400}?" + EXT_URL_SRC, "i");
// 跨平台持久化（2026-10-13 加 Windows：schtasks / Register-ScheduledTask / reg add / sc create）
const PERSISTENCE = /(LaunchAgents|launchctl|crontab|\.git[\\/]hooks|\.zshrc|\.bashrc|autostart|osascript|schtasks|Register-ScheduledTask|reg\s+add\b|sc\s+create\b)/i;
// 非 rm 類的破壞性操作（一律擋）
const DESTRUCTIVE_NONRM = /(killall|pkill|diskutil\s+erase|\bdd\s+if=|mkfs|shutdown\s+-|reboot\b)/;

// ── rm 目標分級（2026-10-11 Fleming：AI 在 tmp 刪暫存檔不該被擋）──
// 舊規則 `rm -[rf]+ (/|~|$HOME|C:\)` 把任何絕對路徑都算破壞性 → `rm -f /tmp/flake.txt` 誤判
// 新規則：只有「系統根 / 家目錄 / 磁碟根 / RU 以外的絕對路徑」才危險；temp 區一律放行
const TEMP_ROOTS = /^(?:\/tmp|\/private\/tmp|\/var\/folders|\/private\/var\/folders|\$TMPDIR|\$TMP|\$TEMP|\$\{[A-Z_]*TMP[A-Z_]*\}|\$PAAW_TMP|\$\{PAAW_TMP\})(?:[\/]|$)/i;
const WIN_TEMP = /^[A-Za-z]:\\[^\n]*\\AppData\\Local\\Temp(?:\\|$)/i;

function rmTargetDangerous(t, cwd) {
  if (/^(?:~|\$HOME|\$\{HOME\})(?:[\/]|$)/.test(t)) return true;   // ~ / $HOME
  if (/^[A-Za-z]:\\/.test(t)) return !WIN_TEMP.test(t);              // Windows 磁碟根（%TEMP% 放行）
  if (t === "/" || t === "/*") return true;                          // 根目錄
  if (!t.startsWith("/")) return false;                              // 相對路徑 → RU 內，放行
  if (TEMP_ROOTS.test(t)) return false;                              // /tmp、$TMPDIR、$PAAW_TMP…
  if (/[\/]log[\/]tmp(?:[\/]|$)/.test(t)) return false;               // PAAW 自己的 log/tmp（$PAAW_TMP 實體路徑）
  if (cwd) {                                                          // RU 工作區內 → 視為 AI 的合法活動範圍
    try {
      const abs = resolvePath(t);
      const base = resolvePath(cwd);
      if (abs === base || abs.startsWith(base + "/")) return false;
    } catch { /* ignore */ }
  }
  return true;
}

function rmDangerous(text, cwd) {
  for (const m of text.matchAll(/\brm\s+((?:-[a-zA-Z]+\s+)*)([^&|;\n]*)/g)) {
    if (!/[rf]/.test(m[1] || "")) continue;                          // 無 -r/-f → 非此規則
    const targets = String(m[2]).trim().split(/\s+/).filter(t => t && !t.startsWith("-"));
    if (!targets.length) continue;
    for (const t of targets) if (rmTargetDangerous(t.replace(/["']/g, ""), cwd)) return true;
  }
  return false;
}

export function scanScriptContent(content, source = "script", opts = {}) {
  const text = String(content || "");
  const cwd = opts && opts.cwd;
  if (!text) return { dangerous: false, reason: "" };

  if (PERSISTENCE.test(text)) {
    return { dangerous: true, reason: `偵測到持久化操作（launchd/crontab/git hooks/shell rc/schtasks/排程工作）`, source };
  }
  if (DESTRUCTIVE_NONRM.test(text) || rmDangerous(text, cwd)) {
    return { dangerous: true, reason: `偵測到破壞性操作（rm 系統/家目錄路徑、killall、diskutil、dd）`, source };
  }
  // 下載即執行（含 PowerShell：iwr … | iex）
  // 2026-10-24（TASK-033 誤判）：`curl ... | python3 -m json.tool` 是 API 測試標準排版慣用語
  // （python 只當 formatter、不執行下載內容）— pipe 後接 -m json[.tool] 放行，不算下載即執行
  if (/\b(curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod|irm)\b[^|;&\n]{0,300}\|(?!\|)(?!\s*python3?\s+-m\s+json(?:\.tool)?\b)[^\n]{0,200}?\b(sh|bash|zsh|dash|python3?|pwsh|powershell|iex|Invoke-Expression)\b/i.test(text)) {
    return { dangerous: true, reason: `偵測到「下載即執行」管線（curl|sh、iwr|iex）`, source };
  }
  if (NET_CMD.test(text)) {
    // 2026-10-13 Fleming：對外網路請求「不再跳審批卡」— 沙箱（MXC deny-by-default）
    // 才是真正的守門，事後還有輸出審計。這裡只回報（放行）讓 caller 記一筆 security_notice。
    return { dangerous: false, network: true, reason: `對外部 URL 發出的網路請求（localhost 以外）`, source };
  }
  return { dangerous: false, reason: "" };
}

function blockMsg(r, file) {
  return `🚫 安全攔截（script-guard）：${file ? `即將執行的 ${file}` : "即將執行的指令"} — ${r.reason}。\n這類內容需要人工確認。請改用 ask_user 向使用者說明意圖並取得同意後，由人工執行。\n（若為誤判：外部下載改人工、localhost 測試照常。趕碼時可在 設定 → 🛡 安全 → 開發模式 暫時關閉審批）`;
}

// ── 指令分段（粗略、保守：不特別處理引號內的分隔符；只用來判斷「誰在被執行」）──
function splitSegments(cmd) {
  return String(cmd).split(/\s*(?:&&|\|\||;|\n|\|)\s*/).map((s) => s.trim()).filter(Boolean);
}

// 該段的第一個指令（跳過 sudo / VAR=VAL 前綴）
function firstWord(seg) {
  const toks = String(seg).trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(toks[i]) || toks[i] === "sudo" || toks[i] === "command" || toks[i] === "exec" || toks[i] === "time")) i++;
  return toks[i] || "";
}

// 純讀取/非直譯器指令：參數裡的檔案只是被「看」或被工具處理，不是被直譯器執行 → 不做內容掃描
const READONLY_CMDS = /^(?:grep|egrep|fgrep|rg|ag|cat|bat|head|tail|sed|awk|gawk|less|more|find|fd|wc|sort|uniq|diff|echo|printf|ls|tree|stat|file|which|type|jq|xxd|od|nl|strings|test|true|false|dirname|basename|realpath|readlink|column|cut|tr|tee|touch|mkdir|rm|mv|cp|chmod|chown|git|npm|yarn|pnpm|bun|pip|pip3|cargo|go|make|npx)$/i;
// 直譯器（後面接檔名 = 真的在執行該檔）
const INTERPRETER = /^(?:node|nodejs|python3?|deno|bun|tsx|bash|sh|zsh|dash|ruby|perl|php|lua|powershell|pwsh|osascript)$/i;
const COMPILER = /^(?:gcc|clang|clang\+\+|g\+\+|cc|cc\+|go|cargo|javac)$/i;

// ── C. bash 指令的 script 執行掃描 ──
const SCRIPT_EXTS = "mjs|cjs|js|ts|mts|cts|tsx|jsx|py|pyw|sh|zsh|bash|rb|pl|pm|php|lua|ps1|psm1|tcl";

// ── 越權與機密防護（2026-10-09 v3；2026-10-13 機密路徑改成只擋 RU 外 — 見 secretPathHit）──
// no-push 紀律技術化：AI 永遠不 push，push 是人的動作
const GIT_PUSH = /\bgit\b[^&|;\n]{0,40}?\bpush\b/;

export function guardScriptExecution(command, cwd) {
  const cmd = String(command || "");
  let networkReason = null;
  const noteNetwork = (r) => { if (r && r.network && !networkReason) networkReason = r.reason || "對外網路請求"; };

  // 0) raw 指令本身先掃（語言無關）— 直接 curl|sh、osascript、外部 URL 下載等，不管什麼語言/形式
  const rawScan = scanScriptContent(cmd, "bash command", { cwd });
  if (rawScan.dangerous) return { blocked: true, message: blockMsg(rawScan, null) };
  noteNetwork(rawScan);
  // 0a) 越權：git push 一律擋（no-push 紀律技術化）
  if (GIT_PUSH.test(cmd)) return { blocked: true, message: "🚫 安全攔截（script-guard）：git push 是人的動作，AI 不執行 push（no-push 紀律）。commit 完留給使用者決定。若你判斷必須 push，請用 ask_user 說明理由取得同意。" };
  // 0b) 機密路徑：只擋「專案（RU）之外」的（~/.ssh、/etc/.env…）— 專案內的 .env/providers.json
  //     是開發常態（讀值 debug），放行但留審計（2026-10-13 Fleming：審批不該擋正常開發）
  const sec = secretPathHit(cmd, cwd);
  if (sec.hit) return { blocked: true, message: `🚫 安全攔截（script-guard）：bash 指令涉及專案外的機密路徑（${sec.why}）。AI 不經 bash 觸碰這些檔案。若確有需要（debug），請用 ask_user 向使用者說明，由人工執行。` };

  // inline code: node -e / python -c / ruby -e / perl -e / php -r / powershell -Command
  const inlineMatch = cmd.match(/\b(node|python3?|deno|bun|ruby|perl|php|powershell|pwsh)\s+(?:-e|-c|-r|-Command)\s+(['"`])([\s\S]*?)\2/);
  if (inlineMatch) {
    const r = scanScriptContent(inlineMatch[3], "inline code", { cwd });
    if (r.dangerous) return { blocked: true, message: blockMsg(r, null) };
    noteNetwork(r);
  }

  // script file: **只在「該段真的在執行這個檔」時才掃內容**（2026-10-13）
  //   舊碼用 `\b(node|bash|…)\s+file` 整條指令比對 + `(^|[&;|\s])…/x.sh`，
  //   結果 `grep -n slice(-10) ./monitor.mjs`（檔案只是 grep 的參數）也被當成「即將執行」而讀檔掃描 → 正常開發被擋。
  //   現在改成逐段判斷：只有該段的第一個指令是直譯器，或該段本身就是執行一個檔案，才掃。
  const fileMatches = [];
  for (const seg of splitSegments(cmd)) {
    const w = firstWord(seg);
    if (!w) continue;
    const base = w.split(/[\\/]/).pop() || w;
    if (READONLY_CMDS.test(base)) continue; // grep/cat/find/git… 參數裡的檔只是被讀 → 不掃
    // 直譯器直跑：node x.mjs / python x.py / ruby x.rb
    const interp = INTERPRETER.test(base) ? seg.match(new RegExp(`\\b${base}\\s+(?:"[^"]*"\\s+)?((?:[\\w./-]*\\/)?[\\w.-]+\\.(?:${SCRIPT_EXTS}))\\b`)) : null;
    if (interp) fileMatches.push([null, null, interp[1]]);
    // 直接執行檔：./x.sh、/abs/x.py（該段第一個字就是檔名）
    if (/^(?:\.\/|\/)/.test(w) && new RegExp(`\\.(?:${SCRIPT_EXTS})$`, "i").test(base)) fileMatches.push([null, null, w]);
    // 編譯型：編譯時掃 source（binary 掃不了，原始碼掃得到）
    if (COMPILER.test(base)) {
      for (const cm of seg.matchAll(/((?:[\w./-]*\/)?[\w.-]+\.(?:c|cc|cpp|cxx|h|go|rs|java))\b/g)) fileMatches.push([null, null, cm[1]]);
    }
  }
  for (const m of fileMatches) {
    const f = isAbsolute(m[2]) ? m[2] : resolvePath(cwd || process.cwd(), m[2]);
    if (!existsSync(f)) continue; // 還沒寫出來的檔案掃不到，交給寫入攔截
    try {
      const content = readFileSync(f, "utf-8").slice(0, 200_000);
      const r = scanScriptContent(content, f, { cwd });
      if (r.dangerous) return { blocked: true, message: blockMsg(r, m[2]) };
      noteNetwork(r);
    } catch { /* 讀不到就放行給 shell 自然報錯 */ }
  }

  // install 類（npm/pip install 等）：執行前掃 package.json「全部」scripts —
  // npm install 會自動跑 preinstall/install/postinstall/prepare — AI 先塞惡意 hook 再 install 的鏈在這裡斷
  if (/\b(npm|yarn|pnpm|bun)\s+(install|i|ci|update|add)\b/.test(cmd)) {
    try {
      const pkgPath = resolvePath(cwd || process.cwd(), "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        for (const [k, v] of Object.entries(pkg.scripts || {})) {
          const r = scanScriptContent(String(v), `package.json:scripts.${k}`, { cwd });
          if (r.dangerous) return { blocked: true, message: blockMsg(r, `package.json scripts.${k}（npm install 會自動執行）`) };
          noteNetwork(r);
        }
      }
    } catch { /* package.json 讀不到 → npm 自己會失敗，放行 */ }
  }

  // npm run <script>：解析 package.json scripts 值掃描
  const npmRun = cmd.match(/\bnpm\s+run\s+([\w:-]+)/);
  if (npmRun) {
    const pkgPath = resolvePath(cwd || process.cwd(), "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const scriptVal = (pkg.scripts || {})[npmRun[1]];
        if (scriptVal) {
          const r = scanScriptContent(scriptVal, `npm run ${npmRun[1]}`, { cwd });
          if (r.dangerous) return { blocked: true, message: blockMsg(r, `package.json:scripts.${npmRun[1]}`) };
          noteNetwork(r);
        }
      } catch { /* package.json 壞掉 → npm 自己會報錯 */ }
    }
  }

  return { blocked: false, network: networkReason };
}

// ── B. env_exec 用：npm install 前檢查 package.json/lock 是否乾淨 ──
// 回傳 true = 乾淨（或非 git repo / 無 package.json）；false = 有未 commit 變更
export function isPackageJsonClean(cwd) {
  const dir = cwd || process.cwd();
  if (!existsSync(resolvePath(dir, "package.json"))) return true;
  try {
    execFileSync("git", ["-C", dir, "diff", "--quiet", "HEAD", "--", "package.json", "package-lock.json"], { stdio: "ignore", timeout: 5000 });
    return true; // exit 0 = 無差異
  } catch (err) {
    // 非 git repo（err.status null + ENOENT）視為乾淨；有 diff（status 1）= dirty
    if (err.status === 1) return false;
    return true;
  }
}
