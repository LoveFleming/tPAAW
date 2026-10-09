/**
 * env-exec-tool.mjs — 林雨晴（chat 助理）環境安裝工具（2026-10-09 Fleming 需求）
 *
 * 需求：林雨晴要能做「環境安裝的工作」（npm install / node·python 版本檢查 / brew 等），
 * 但 chat 助理不開放任意 bash（CHAT_BLOCKED_TOOLS 擋 bash 是對的）。
 *
 * 原則（Evidence-Driven）：代碼擋越權 — 白名單 + execFile(shell:false)，不是 prompt 自律。
 *  - 只認白名單指令前綴（npm/npx/node/python3/pip3/brew/which/uname/sw_vers/git --version/nvm/pyenv --version）
 *  - execFile 不走 shell → 沒有注入面（; | && > ` 全是無效字面參數）
 *  - shell-guard 再攔一層 process 越界（pkill/kill PAAW 等）
 *  - cwd 必須是已存在目錄；timeout 600s（npm install 可能很久）；輸出裁尾 6000 字
 *  - nvm 是 shell function 無法直接 exec — 走 node/python 版本檢查代替
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { isAbsolute, resolve as resolvePath } from "path";
import { guardShellProcessScope } from "./shell-guard.mjs";
import { scanScriptContent, isPackageJsonClean } from "./script-guard.mjs";
import { logAuditEvent, scanCommandOutput } from "./audit-log.mjs";

// 白名單：指令 → 允許的 subcommand/模式（null = 全部子指令皆可）
const WHITELIST = {
  npm: null,            // install/ci/update/uninstall/ls/outdated/run/test/--version
  npx: null,
  node: ["--version", "-v"], // 2026-10-09 23:10 拿掉 -e：scanScriptContent 未覆蓋 inline code，node 25 全域 fetch = 外傳面；要跑碼找 coding agent
  python3: ["--version", "-V"], // 同上拿掉 -c
  pip3: null,           // install/list/show/--version
  brew: null,           // install/upgrade/list/info/--version
  which: null,
  uname: null,
  sw_vers: null,
  git: ["--version", "status", "log", "branch"], // 環境檢查用，不含破壞性操作
  nvm: ["--version"],
  pyenv: ["--version", "versions", "version"],
};

// 禁字（雙保險：execFile 下這些只是字面參數，但先擋掉避免誤導）
const DENY_ARGS = ["sudo", "rm", "kill", "pkill", "killall", "launchctl", "osascript", "curl", "wget", "ssh", "scp"];

function validate(command) {
  const parts = String(command || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "空指令" };

  // sudo 前綴直接擋
  const bin = parts[0];
  const allowed = WHITELIST[bin];
  if (allowed === undefined) {
    return { ok: false, error: `🚫 指令「${bin}」不在環境安裝白名單。可用：${Object.keys(WHITELIST).join(" / ")}（sudo·rm·kill 等破壞性指令一律不行）` };
  }
  const args = parts.slice(1);
  if (DENY_ARGS.some(d => args.includes(d))) {
    return { ok: false, error: `🚫 參數含禁止指令（${DENY_ARGS.join("/")}）— 環境安裝工具不執行破壞性操作` };
  }
  if (Array.isArray(allowed) && args.length > 0) {
    const first = args[0];
    if (!allowed.includes(first)) {
      return { ok: false, error: `🚫 ${bin} 只允許：${allowed.join(" / ")}` };
    }
  }
  // npm 長駐指令擋掉（dev/start/serve 是 dev_server 工具的職責，且會佔住 agent loop）
  if ((bin === "npm" || bin === "npx") && /^run$/.test(args[0] || "") && /^(dev|start|serve|watch)$/.test(args[1] || "")) {
    return { ok: false, error: "🚫 長駐指令（npm run dev/start/serve/watch）請用 dev_server 工具，env_exec 只跑會結束的指令" };
  }
  return { ok: true, bin, args };
}

export const ENV_EXEC_TOOL_DEF = {
  type: "function",
  function: {
    name: "env_exec",
    description: "執行環境安裝/檢查指令（白名單制，非任意 shell）。可跑：npm install / npm ci / npm update / npm ls / npm outdated / npm run <script>（dev/start 除外）/ npx / node --version / python3 --version / pip3 install / brew install·upgrade / which / git --version 等環境設定工作。cwd 指專案目錄（npm install 一定要帶）。輸出含 stdout/stderr 尾段。不會跑 sudo、刪檔、kill、長駐 server。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "單一指令（不含 shell 管線/重導向），如：npm install" },
        cwd: { type: "string", description: "工作目錄絕對路徑（npm 相關必帶，如 /Users/xxx/App/learning-space）" },
        timeoutMs: { type: "number", description: "逾時毫秒，預設 600000（10 分鐘）" },
        confirmDirty: { type: "boolean", description: "package.json 有未 commit 變更仍要 npm install 時，先跟使用者確認後帶 true" },
      },
      required: ["command"],
    },
  },
};

export async function envExecHandler({ command, cwd, timeoutMs, confirmDirty }) {
  const v = validate(command);
  if (!v.ok) {
    logAuditEvent({ kind: "env_exec_block", severity: "block", tool: "env_exec", command, reason: v.error, detail: { caller: "chat" } });
    return v.error;
  }

  // ── script-guard B（2026-10-09）：npm 延遲執行防護 ──
  const sub = v.args[0] || "";
  if (v.bin === "npm" && ["install", "i", "ci", "update"].includes(sub)) {
    // npm install 會跑套件 postinstall（任意代碼）— package.json/lock 有未 commit 變更時要求先跟使用者確認
    if (!confirmDirty && !isPackageJsonClean(cwd || process.cwd())) {
      logAuditEvent({ kind: "script_guard", severity: "block", tool: "env_exec", command, reason: "package.json 有未 commit 變更時 npm install（需 confirmDirty）", detail: { caller: "chat" }, cwd });
      return `⚠️ 安全檢查：這個專案的 package.json / package-lock.json 有未 commit 的變更（可能是 AI 剛改的）。npm install 會執行套件的 postinstall 腳本（任意代碼）。請先跟使用者確認要安裝，確認後帶 confirmDirty: true 重跑。`;
    }
  }
  if (v.bin === "npm" && sub === "run") {
    // npm run <script> — 解析 package.json scripts 值掃描（AI 可先加惡意 script 再跑）
    const scriptName = v.args[1];
    if (scriptName) {
      try {
        const { readFileSync } = await import("fs");
        const { resolve: rp } = await import("path");
        const pkgPath = rp(cwd || process.cwd(), "package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const scriptVal = (pkg.scripts || {})[scriptName];
        if (!scriptVal) return `❌ package.json 裡沒有 script「${scriptName}」`;
        const r = scanScriptContent(scriptVal, `npm run ${scriptName}`);
        if (r.dangerous) {
          logAuditEvent({ kind: "script_guard", severity: "block", tool: "env_exec", command, reason: `npm run ${scriptName} — ${r.reason}`, detail: { caller: "chat", scriptVal }, cwd });
          return `🚫 安全攔截：npm run ${scriptName} — ${r.reason}。這類 script 需人工執行。`;
        }
      } catch (e) {
        if (String(e.message).includes("ENOENT")) return `❌ ${cwd} 下沒有 package.json`;
        // 其他解析錯誤放行，npm 自己會報
      }
    }
  }

  // shell-guard：process 越界防護（pkill/kill PAAW 鐵律）
  const guard = await guardShellProcessScope(command, cwd || process.cwd());
  if (guard.blocked) {
    logAuditEvent({ kind: "shell_guard", severity: "block", tool: "env_exec", command, reason: guard.message, detail: { caller: "chat" }, cwd });
    return guard.message;
  }

  // cwd 必須存在
  let workDir = process.cwd();
  if (cwd) {
    const abs = isAbsolute(cwd) ? cwd : resolvePath(process.cwd(), cwd);
    if (!existsSync(abs)) return `❌ cwd 不存在：${abs}`;
    workDir = abs;
  }

  const timeout = Math.min(Number(timeoutMs) || 600_000, 900_000); // cap 15 分鐘
  const startedAt = Date.now();

  // ── srt 沙箱包裹（2026-10-10 Fleming：所有 agent loop 安全係數最高）──
  // env_exec 原本裸 execFile — 惡意套件 postinstall 有完整網路外傳面。
  // 沙箱可用（macOS/Linux + 套件已裝）→ 包白名單網域 + 機密 denyRead + 專案外禁寫；
  // 不可用（公司 Windows 未裝 srt）→ 維持原 execFile（白名單+shell-guard+script-guard 仍在）。
  let sandboxed = false;
  let shellBin = v.bin, shellArgs = v.args;
  let _allowedDomains = null; // 掃描用白名單（沙箱開著才有意義，先取好 — callback 不是 async）
  try {
    if (process.platform !== "win32") {
      const { wrapWithSrt, sandboxAvailable, effectiveAllowedDomains } = await import("./paaw-sandbox.mjs");
      if (await sandboxAvailable()) _allowedDomains = effectiveAllowedDomains();
      if (_allowedDomains) {
        const quote = (a) => `'${String(a).replace(/'/g, `'\\''`)}'`; // POSIX 單引號跳脱
        const quotedCmd = [v.bin, ...v.args].map(quote).join(" ");
        const wrapped = await wrapWithSrt(quotedCmd, workDir);
        if (wrapped && wrapped !== quotedCmd) {
          shellBin = "/bin/zsh";
          shellArgs = ["-c", wrapped];
          sandboxed = true;
        }
      }
    }
  } catch { /* 沙箱失敗不擋路 — 退回原樣 */ }

  return await new Promise((resolveP) => {
    execFile(shellBin, shellArgs, {
      cwd: workDir,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        // brew / nvm 裝的 binary 在 homebrew 路徑（execFile 不吃 shell rc）
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
      },
    }, (err, stdout, stderr) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const tail = (s) => String(s || "").slice(-6000);
      let out = [tail(stdout), stderr ? `stderr:\n${tail(stderr)}` : ""].filter(Boolean).join("\n");
      if (err && !err.killed) out += `\nExit code: ${err.code ?? 1}`;
      // ── 安全審計（2026-10-10）：白名單阻擋/沙箱拒絕 → 引導 + audit（同 bash 工具）──
      try {
        const secHit = scanCommandOutput({ command, output: out, allowedDomains: _allowedDomains || [], agentId: "assistant", cwd: workDir, tool: "env_exec" });
        if (secHit) out += secHit.agentNotice;
      } catch { /* 審計失敗不影響 */ }
      if (err && err.killed) {
        resolveP(`⏱ 指令逾時（${elapsed}s，被中止）：\n${out}`);
      } else if (err) {
        // npm 等非零退出碼 = 有錯誤訊息可讀，把輸出帶回給 AI 診斷
        resolveP(`⚠️ 退出碼 ${err.code ?? "?"}（${elapsed}s）${sandboxed ? " 🛡沙箱内" : ""}\n${out || err.message}`);
      } else {
        resolveP(`✅ 完成（${elapsed}s）${sandboxed ? " 🛡沙箱内" : ""}\n${out || "（無輸出）"}`);
      }
    });
  });
}
