/**
 * Shell Tool Provider Handler
 *
 * Tools: exec_command, health_check
 *
 * Config (config.json):
 *   {
 *     "allowedCommands": ["curl", "wget", "dig", "nslookup", "ping", "traceroute"],
 *     "blockedCommands": ["rm -rf", "shutdown", "reboot", "mkfs"],
 *     "workdir": "/tmp"
 *   }
 */

const { existsSync, readFileSync } = await import("fs");
const { resolve } = await import("path");
const { execSync } = await import("child_process");

const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../../");
const configFile = resolve(PAAW_ROOT, "data/tools/shell/config.json");
let config = {};
if (existsSync(configFile)) {
  try { config = JSON.parse(readFileSync(configFile, "utf-8")); } catch {}
}

// Commands that are always blocked
const DEFAULT_BLOCKED = ["rm -rf /", "mkfs", "shutdown", "reboot", "dd if=", ":(){ :|:&", "fork bomb"];
const BLOCKED = [...DEFAULT_BLOCKED, ...(config.blockedCommands || [])];

// Commands that are safe (read-only)
const SAFE_PATTERNS = [
  /^(curl|wget|dig|nslookup|ping|traceroute|nc|telnet)\s/i,
  /^(df|du|free|vmstat|iostat|mpstat|top|htop|ps|uptime|who|w|last)\s?/i,
  /^(cat|head|tail|less|more|wc|grep|awk|sed|sort|uniq|cut|tr)\s/i,
  /^(ls|ll|stat|file|find|locate)\s?/i,
  /^(date|cal|echo|printf|env|printenv|id|whoami|hostname|uname)\s?/i,
  /^(docker|kubectl)\s+(get|describe|logs|top|ps|stats|inspect|info)\s/i,
  /^(systemctl|service)\s+(status|list-units|list-jobs)\s/i,
  /^(journalctl|dmesg)\s/i,
  /^(netstat|ss|lsof|iptraf|tcpdump)\s?/i,
  /^(ip|ifconfig|route|arp)\s?(addr|link|route|show|list)?/i,
];

// Commands that are destructive
const DESTRUCTIVE_PATTERNS = [
  /\b(rm|del|erase|rmdir)\b/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\b(mkfs|fdisk|parted)\b/i,
  /\b(dd)\s+if=/i,
  /\b(chmod|chown|chgrp)\b/i,
  /\b(kill|killall|pkill)\b/i,
  /\b(docker|kubectl)\s+(delete|rm|stop|kill|restart|rollout|scale|apply|exec)\b/i,
  /\b(systemctl|service)\s+(start|stop|restart|enable|disable)\b/i,
  /\biptables|ufw|firewall-cmd|nft\b/i,
];

function isBlocked(cmd) {
  return BLOCKED.some(pattern => cmd.toLowerCase().includes(pattern.toLowerCase()));
}

function isSafe(cmd) {
  return SAFE_PATTERNS.some(re => re.test(cmd.trim()));
}

function isDestructive(cmd) {
  return DESTRUCTIVE_PATTERNS.some(re => re.test(cmd));
}

function runCommand(cmd, workdir, timeout) {
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: (timeout || 15) * 1000,
      maxBuffer: 1024 * 512,
      cwd: workdir || config.workdir || "/",
      env: { ...process.env },
    });
    return { ok: true, output: output.toString() };
  } catch (err) {
    return {
      ok: false,
      output: (err.stderr?.toString() || err.stdout?.toString() || err.message).trim(),
    };
  }
}

function truncateOutput(text, maxLines = 80) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
}

export default async function handler(args, ctx) {
  const toolName = ctx?.toolName || args.__toolName;

  // ── health_check ──
  if (toolName === "health_check" || (args.url && !args.command)) {
    const url = args.url;
    const method = args.method || "GET";
    const expected = args.expectedStatus || 200;
    const headers = args.headers || {};

    const start = Date.now();
    try {
      const resp = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      const elapsed = Date.now() - start;
      const body = await resp.text();
      const bodyPreview = body.slice(0, 200);

      const statusIcon = resp.status === expected ? "✅" : "❌";
      const latencyIcon = elapsed < 100 ? "⚡" : elapsed < 500 ? "🟢" : elapsed < 2000 ? "🟡" : "🔴";

      return {
        text: `${statusIcon} ${method} ${url}\n${latencyIcon} Latency: ${elapsed}ms\nStatus: ${resp.status} (expected ${expected})\nBody: ${bodyPreview}${body.length > 200 ? "..." : ""}`,
        data: { status: resp.status, latency: elapsed, ok: resp.status === expected, body: bodyPreview },
      };
    } catch (err) {
      const elapsed = Date.now() - start;
      return {
        text: `❌ ${method} ${url} 失敗（${elapsed}ms）：${err.message}`,
        error: true,
      };
    }
  }

  // ── exec_command ──
  if (toolName === "exec_command" || args.command) {
    const cmd = args.command;

    // Check blocked
    if (isBlocked(cmd)) {
      return { text: `🚫 此命令已被封鎖：\`${cmd}\``, error: true };
    }

    const destructive = isDestructive(cmd);
    const safe = isSafe(cmd);

    // If destructive and not confirmed → preview
    if (destructive && !args.confirm) {
      return {
        text: `⚠️ **破壞性命令** — 需要確認才能執行：\n\`\`\`bash\n${cmd}\n\`\`\`\n\n確認執行？請帶 \`confirm: true\` 再次呼叫。`,
        data: { command: cmd, requiresConfirm: true, destructive: true },
      };
    }

    // Execute
    const result = runCommand(cmd, args.workdir, args.timeout);
    if (!result.ok) return { text: `❌ 命令執行失敗（exit non-zero）：\n\`\`\`\n${truncateOutput(result.output)}\n\`\`\``, error: true };
    return { text: `\`\`\`\n${truncateOutput(result.output)}\n\`\`\`` };
  }

  return { text: "❓ 請提供 command 或 url 參數" };
}
