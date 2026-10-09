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

// ── A. 執行入口檔案（AI 永遠不可寫 — 寫了會在「人不在場」時執行）──
const PERSISTENT_ENTRY_RULES = [
  { test: (p) => /[\\/]\.git[\\/]hooks[\\/]/.test(p), name: "git hooks" },
  { test: (p) => /[\\/]Library[\\/]LaunchAgents[\\/].*\.plist$/.test(p) || /[\\/]Library[\\/]LaunchDaemons[\\/]/.test(p), name: "launchd plist" },
  { test: (p) => /^[\\/](etc|Library)[\\/]cron/i.test(p) || /crontab/i.test(p.split(/[\\/]/).pop() || ""), name: "crontab" },
  { test: (p) => /^(\.zshrc|\.zprofile|\.zshenv|\.bashrc|\.bash_profile|\.profile)$/i.test(p.split(/[\\/]/).pop() || "") && p.startsWith(HOME), name: "shell rc" },
  { test: (p) => p.startsWith(HOME + "/.ssh") || p.startsWith(HOME + "\\.ssh"), name: "ssh 設定" },
  { test: (p) => /[\\/]node_modules[\\/]\.bin[\\/]/.test(p), name: "node_modules/.bin" },
  { test: (p) => /[\\/]\.config[\\/]autostart[\\/]/.test(p), name: "autostart" },
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
const NET_TOOLS = /(\bfetch\s*\(|\bcurl\b|\bwget\b|http\.request|https\.request|net\.connect|axios|node-fetch|got\()/;
const EXT_URL = /https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\$\{?[A-Z_])/i;
const PERSISTENCE = /(LaunchAgents|launchctl|crontab|\.git[\\/]hooks|\.zshrc|autostart|osascript)/;
const DESTRUCTIVE = /(rm\s+-[rf]{1,2}\s+(\/|~|\$HOME|C:\\)|killall|pkill|diskutil\s+erase|\bdd\s+if=|mkfs|shutdown\s+-|reboot\b)/;

export function scanScriptContent(content, source = "script") {
  const text = String(content || "");
  if (!text) return { dangerous: false, reason: "" };

  if (PERSISTENCE.test(text)) {
    return { dangerous: true, reason: `偵測到持久化操作（launchd/crontab/git hooks/shell rc/osascript）`, source };
  }
  if (DESTRUCTIVE.test(text)) {
    return { dangerous: true, reason: `偵測到破壞性操作（rm -rf 系統路徑/killall/diskutil/dd）`, source };
  }
  if (NET_TOOLS.test(text) && EXT_URL.test(text)) {
    // 同時出現網路工具 + 外部 URL 才擋（測試打 localhost 放行）
    return { dangerous: true, reason: `偵測到對外部 URL 的網路請求（外傳通道）— localhost 以外`, source };
  }
  if (/\b(curl|wget)\b[^|;&]*\|[^\n]*(sh|bash|zsh|python)/i.test(text)) {
    return { dangerous: true, reason: `偵測到「下載即執行」管線（curl|sh）`, source };
  }
  return { dangerous: false, reason: "" };
}

function blockMsg(r, file) {
  return `🚫 安全攔截（script-guard）：${file ? `即將執行的 ${file}` : "即將執行的指令"} — ${r.reason}。\n這類內容需要人工確認。請改用 ask_user 向使用者說明意圖並取得同意後，由人工執行。\n（若為誤判，請調整腳本：外部下載改人工、localhost 測試照常）`;
}

// ── C. bash 指令的 script 執行掃描 ──
export function guardScriptExecution(command, cwd) {
  const cmd = String(command || "");

  // inline code: node -e / python -c
  const inlineMatch = cmd.match(/\b(node|python3?|deno|bun)\s+(?:-e|-c)\s+(['"])([\s\S]*?)\2/);
  if (inlineMatch) {
    const r = scanScriptContent(inlineMatch[3], "inline code");
    if (r.dangerous) return { blocked: true, message: blockMsg(r, null) };
  }

  // script file: node/python/sh 執行檔案（含 npx tsx）
  const fileMatches = [...cmd.matchAll(/\b(node|python3?|deno|bun|tsx|npx\s+tsx|bash|sh|zsh)\s+((?:[\w./-]*\/)?[\w.-]+\.(?:mjs|cjs|js|ts|py|sh|zsh))\b/g)];
  for (const m of fileMatches) {
    const f = isAbsolute(m[2]) ? m[2] : resolvePath(cwd || process.cwd(), m[2]);
    if (!existsSync(f)) continue; // 還沒寫出來的檔案掃不到，交給寫入攔截
    try {
      const content = readFileSync(f, "utf-8").slice(0, 200_000);
      const r = scanScriptContent(content, f);
      if (r.dangerous) return { blocked: true, message: blockMsg(r, m[2]) };
    } catch { /* 讀不到就放行給 shell 自然報錯 */ }
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
          const r = scanScriptContent(scriptVal, `npm run ${npmRun[1]}`);
          if (r.dangerous) return { blocked: true, message: blockMsg(r, `package.json:scripts.${npmRun[1]}`) };
        }
      } catch { /* package.json 壞掉 → npm 自己會報錯 */ }
    }
  }

  return { blocked: false };
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
