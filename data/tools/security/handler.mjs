/**
 * Security Tool Provider Handler
 *
 * Tools: scan_rbac, check_ssl, scan_deps
 *
 * Config (config.json):
 *   {
 *     "kubectlPath": "kubectl",
 *     "defaultNamespace": "",
 *     "trivyPath": "trivy"
 *   }
 */

const { existsSync, readFileSync } = await import("fs");
const { resolve } = await import("path");
const { execSync } = await import("child_process");

const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../../");
const configFile = resolve(PAAW_ROOT, "data/tools/security/config.json");
let config = {};
if (existsSync(configFile)) {
  try { config = JSON.parse(readFileSync(configFile, "utf-8")); } catch {}
}

const KUBECTL = config.kubectlPath || "kubectl";

function runCmd(cmd, timeout = 20000) {
  try {
    return { ok: true, output: execSync(cmd, { encoding: "utf-8", timeout: timeout * 1000, maxBuffer: 1024 * 512, env: { ...process.env } }) };
  } catch (err) {
    return { ok: false, output: (err.stderr?.toString() || err.stdout?.toString() || err.message).trim() };
  }
}

function hasBin(bin) {
  try { execSync(`which ${bin}`, { encoding: "utf-8" }); return true; } catch { return false; }
}

// ── RBAC Scanner ──

function scanRbac(namespace, opts) {
  const findings = [];
  const nsFlag = namespace ? `-n ${namespace}` : "--all-namespaces";

  if (!hasBin(KUBECTL)) {
    return { text: `⚠️ 找不到 \`${KUBECTL}\`，無法掃描 RBAC。` };
  }

  // 1. ClusterRoleBindings with cluster-admin
  const crbResult = runCmd(`${KUBECTL} get clusterrolebinding -o json`);
  if (crbResult.ok) {
    try {
      const crbs = JSON.parse(crbResult.output);
      for (const crb of crbs.items || []) {
        const roleName = crb.roleRef?.name;
        if (roleName === "cluster-admin") {
          for (const subj of crb.subjects || []) {
            findings.push({
              severity: "🔴 Critical",
              title: `cluster-admin 權限`,
              detail: `${subj.kind} "${subj.name}"${subj.namespace ? ` in ns/${subj.namespace}` : ""} 擁有 cluster-admin 權限`,
              fix: "確認是否真的需要 cluster-admin，考慮改用更細粒度的 Role",
            });
          }
        }
      }
    } catch {}
  }

  // 2. Privileged pods
  if (opts.checkPrivileged !== false) {
    const podsResult = runCmd(`${KUBECTL} get pods ${nsFlag} -o json`);
    if (podsResult.ok) {
      try {
        const pods = JSON.parse(podsResult.output);
        for (const pod of pods.items || []) {
          const podName = `${pod.metadata.namespace}/${pod.metadata.name}`;
          for (const ctr of pod.spec?.containers || []) {
            const sc = ctr.securityContext || {};
            if (sc.privileged === true) {
              findings.push({ severity: "🔴 Critical", title: `Privileged Pod`, detail: `${podName} container ${ctr.name} 跑在 privileged mode`, fix: "移除 securityContext.privileged: true" });
            }
            if (sc.runAsRoot === true || (!sc.runAsNonRoot && pod.spec?.securityContext?.runAsNonRoot !== true)) {
              // Only flag if explicitly running as root without non-root
              if (sc.runAsUser === 0) {
                findings.push({ severity: "🟠 High", title: `Root Container`, detail: `${podName} container ${ctr.name} runAsUser: 0`, fix: "設定 runAsNonRoot: true 或指定非 0 的 runAsUser" });
              }
            }
            if (sc.allowPrivilegeEscalation === true) {
              findings.push({ severity: "🟠 High", title: `Allow Privilege Escalation`, detail: `${podName} container ${ctr.name} 允許提權`, fix: "設定 allowPrivilegeEscalation: false" });
            }
          }
          // hostPath
          if (opts.checkHostPath !== false) {
            for (const vol of pod.spec?.volumes || []) {
              if (vol.hostPath) {
                findings.push({ severity: "🟠 High", title: `HostPath Mount`, detail: `${podName} 掛載 hostPath: ${vol.hostPath.path}`, fix: "避免使用 hostPath，改用 PVC" });
              }
            }
            // hostNetwork
            if (pod.spec?.hostNetwork) {
              findings.push({ severity: "🟠 High", title: `Host Network`, detail: `${podName} 使用 hostNetwork`, fix: "除非必要（如 CNI plugin），否則不要用 hostNetwork" });
            }
          }
        }
      } catch {}
    }
  }

  // 3. Default service account in use
  const saResult = runCmd(`${KUBECTL} get pods ${nsFlag} -o json`);
  if (saResult.ok) {
    try {
      const pods = JSON.parse(saResult.output);
      for (const pod of pods.items || []) {
        const sa = pod.spec?.serviceAccountName;
        if (sa === "default") {
          // Only flag if automount token and has binding
          findings.push({ severity: "🔵 Low", title: `Default ServiceAccount`, detail: `${pod.metadata.namespace}/${pod.metadata.name} 使用 default SA`, fix: "建立專用 SA 並限制權限" });
        }
      }
    } catch {}
  }

  if (findings.length === 0) {
    return { text: "✅ RBAC 掃描完成，沒有發現嚴重問題。" };
  }

  const summary = { "🔴 Critical": 0, "🟠 High": 0, "🟡 Medium": 0, "🔵 Low": 0 };
  for (const f of findings) summary[f.severity] = (summary[f.severity] || 0) + 1;

  const lines = findings.map(f => `${f.severity} **${f.title}**\n   ${f.detail}\n   💡 ${f.fix}`);
  return {
    text: `🔒 RBAC 安全掃描結果（${namespace || "全 cluster"}）\n\n${Object.entries(summary).filter(([,v]) => v > 0).map(([k,v]) => `${k}: ${v}`).join("  ")}\n\n${lines.join("\n\n")}`,
    data: { findings, count: findings.length },
  };
}

// ── SSL Checker ──

function checkSsl(host, port) {
  const target = `${host}:${port || 443}`;
  // Use openssl s_client
  if (!hasBin("openssl")) {
    return { text: "⚠️ 找不到 openssl，無法檢查 SSL。" };
  }

  const cmd = `echo | openssl s_client -connect ${target} -servername ${host} 2>/dev/null | openssl x509 -noout -dates -issuer -subject -text 2>/dev/null`;
  const result = runCmd(cmd);
  if (!result.ok || !result.output) {
    return { text: `❌ 無法連接 ${target} 或取得 SSL 資訊` };
  }

  const output = result.output;

  // Parse cert dates
  const notBefore = output.match(/notBefore=(.+)/)?.[1]?.trim();
  const notAfter = output.match(/notAfter=(.+)/)?.[1]?.trim();
  const issuer = output.match(/issuer=(.+)/)?.[1]?.trim();
  const subject = output.match(/subject=(.+)/)?.[1]?.trim();

  // Calculate days to expiry
  let daysLeft = null;
  if (notAfter) {
    const expiry = new Date(notAfter);
    daysLeft = Math.ceil((expiry - Date.now()) / (1000 * 60 * 60 * 24));
  }

  // Check protocol version
  const protocolCmd = `echo | openssl s_client -connect ${target} -servername ${host} 2>/dev/null | grep -E "Protocol|Cipher"`;
  const protoResult = runCmd(protocolCmd);
  const protoLine = protoResult.output?.trim() || "";

  // Severity
  let severity = "✅";
  if (daysLeft !== null) {
    if (daysLeft < 0) severity = "🔴 Critical";
    else if (daysLeft < 7) severity = "🔴 Critical";
    else if (daysLeft < 30) severity = "🟠 High";
    else if (daysLeft < 90) severity = "🟡 Medium";
  }

  const lines = [
    `${severity} SSL/TLS 憑證檢查：${target}`,
    `📅 有效期限：${notBefore || "?"} → ${notAfter || "?"}`,
    `⏰ 剩餘天數：${daysLeft !== null ? daysLeft + " 天" : "未知"}`,
    `🔑 簽發者：${issuer || "?"}`,
    `👤 Subject：${subject || "?"}`,
  ];
  if (protoLine) lines.push(`🔐 ${protoLine.replace(/\n/g, " | ")}`);

  // Check for TLS 1.0/1.1
  if (protoLine.includes("TLSv1 ") || protoLine.includes("TLSv1.0")) {
    lines.push("\n⚠️ 偵測到 TLS 1.0 — 已被棄用，建議停用");
  }
  if (protoLine.includes("TLSv1.1")) {
    lines.push("\n⚠️ 偵測到 TLS 1.1 — 已被棄用，建議停用");
  }

  return { text: lines.join("\n"), data: { host: target, daysLeft, issuer, notBefore, notAfter } };
}

// ── Dependency Scanner ──

function scanDeps(projectPath, scanner, severity) {
  const cwd = projectPath || ".";
  let useScanner = scanner || "auto";

  // Auto-detect
  if (useScanner === "auto") {
    if (existsSync(resolve(cwd, "package.json"))) useScanner = "npm";
    else if (existsSync(resolve(cwd, "requirements.txt")) || existsSync(resolve(cwd, "pyproject.toml"))) useScanner = "pip";
    else if (hasBin("trivy")) useScanner = "trivy";
    else return { text: "❌ 無法自動偵測專案類型。請指定 scanner 參數。" };
  }

  let cmd, result;

  if (useScanner === "npm") {
    cmd = `npm audit --json 2>/dev/null`;
    result = runCmd(`cd ${cwd} && ${cmd}`);
    if (!result.ok && !result.output) {
      return { text: `❌ npm audit 失敗。確認 ${cwd} 有 package-lock.json` };
    }
    try {
      const audit = JSON.parse(result.output);
      const vulns = audit.vulnerabilities || {};
      const stats = { critical: 0, high: 0, moderate: 0, low: 0 };
      const details = [];

      for (const [pkg, info] of Object.entries(vulns)) {
        const sev = info.severity;
        if (sev) stats[sev] = (stats[sev] || 0) + 1;
        const sevEmoji = sev === "critical" ? "🔴" : sev === "high" ? "🟠" : sev === "moderate" ? "🟡" : "🔵";
        if (sev === "critical" || sev === "high" || (severity === "all" && sev)) {
          const fixStr = info.fixAvailable ? (typeof info.fixAvailable === "object" ? `升級 ${info.fixAvailable.name}@${info.fixAvailable.version}` : "有修復版本") : "暫無修復";
          details.push(`${sevEmoji} [${sev?.toUpperCase()}] ${pkg}@${info.range || "?"} — ${fixStr}`);
        }
      }

      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      const sevFilter = severity || "high";
      const showCount = sevFilter === "all" ? total : (stats.critical || 0) + (stats.high || 0) + (sevFilter === "moderate" ? (stats.moderate || 0) : 0) + (sevFilter === "low" ? (stats.low || 0) : 0);

      if (total === 0) return { text: "✅ npm audit 通過，沒有發現漏洞。" };

      const summary = `找到 ${total} 個漏洞：🔴 ${stats.critical}  🟠 ${stats.high}  🟡 ${stats.moderate}  🔵 ${stats.low}`;
      return {
        text: `🔒 npm audit 結果（${cwd}）\n\n${summary}\n\n${details.slice(0, 30).join("\n")}${details.length > 30 ? `\n... 還有 ${details.length - 30} 個` : ""}\n\n💡 執行 \`npm audit fix\` 修復。`,
        data: { stats, total },
      };
    } catch {
      return { text: `❌ npm audit 輸出解析失敗。` };
    }
  }

  if (useScanner === "pip") {
    if (!hasBin("pip-audit") && !hasBin("pip")) {
      return { text: "⚠️ 需要 pip-audit。安裝：`pip install pip-audit`" };
    }
    cmd = `cd ${cwd} && pip-audit --format json 2>/dev/null || pip-audit -r requirements.txt --format json 2>/dev/null`;
    result = runCmd(cmd, 60);
    if (!result.ok) {
      return { text: `❌ pip-audit 失敗：${result.output.slice(0, 200)}` };
    }
    try {
      const audit = JSON.parse(result.output);
      const deps = audit.dependencies || [];
      if (deps.length === 0) return { text: "✅ pip-audit 通過，沒有發現漏洞。" };
      const lines = deps.filter(d => d.vulns?.length > 0).map(d => {
        return `🔴 ${d.name}@${d.version} — ${d.vulns.length} 個漏洞`;
      });
      return { text: `🔒 pip-audit 結果（${cwd}）\n\n找到 ${lines.length} 個有漏洞的套件：\n${lines.join("\n")}` };
    } catch {
      return { text: "❌ pip-audit 輸出解析失敗。" };
    }
  }

  if (useScanner === "trivy") {
    if (!hasBin("trivy")) {
      return { text: "⚠️ 找不到 trivy。安裝：https://trivy.dev/" };
    }
    cmd = `trivy fs --format json --severity ${severity?.toUpperCase() || "HIGH,CRITICAL"} ${cwd}`;
    result = runCmd(cmd, 60);
    if (!result.ok) {
      return { text: `❌ trivy 掃描失敗：${result.output.slice(0, 200)}` };
    }
    try {
      const scan = JSON.parse(result.output);
      const results = scan.Results || [];
      const vulns = results.flatMap(r => r.Vulnerabilities || []);
      if (vulns.length === 0) return { text: "✅ trivy 掃描完成，沒有發現 HIGH/CRITICAL 漏洞。" };
      const lines = vulns.slice(0, 30).map(v => {
        const sev = v.Severity || "?";
        const emoji = sev === "CRITICAL" ? "🔴" : "🟠";
        return `${emoji} [${sev}] ${v.PkgName}@${v.InstalledVersion} → ${v.FixedVersion || "no fix"} (${v.VulnerabilityID})`;
      });
      return {
        text: `🔒 trivy 掃描結果（${cwd}）\n\n找到 ${vulns.length} 個漏洞：\n${lines.join("\n")}${vulns.length > 30 ? `\n... 還有 ${vulns.length - 30} 個` : ""}`,
      };
    } catch {
      return { text: "❌ trivy 輸出解析失敗。" };
    }
  }

  return { text: `❓ 未知的 scanner: ${useScanner}` };
}

// ── Main handler ──

export default async function handler(args, ctx) {
  const toolName = ctx?.toolName || args.__toolName;

  try {
    if (toolName === "scan_rbac" || (!toolName && args.namespace !== undefined)) {
      return scanRbac(args.namespace, { checkPrivileged: args.checkPrivileged, checkHostPath: args.checkHostPath });
    }
    if (toolName === "check_ssl" || (!toolName && args.host)) {
      return checkSsl(args.host, args.port);
    }
    if (toolName === "scan_deps" || (!toolName && (args.projectPath !== undefined || args.scanner))) {
      return scanDeps(args.projectPath, args.scanner, args.severity);
    }
    return { text: "❓ 未知的 security 操作。" };
  } catch (err) {
    return { text: `❌ 安全掃描失敗：${err.message}`, error: true };
  }
}
