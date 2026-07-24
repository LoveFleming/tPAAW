/**
 * Kubernetes Tool Provider Handler
 *
 * Tools: kubectl_get, kubectl_describe, kubectl_logs, kubectl_top, kubectl_apply
 *
 * Config (config.json):
 *   {
 *     "kubectlPath": "kubectl",        // optional, default "kubectl"
 *     "defaultNamespace": "default",   // optional
 *     "context": "my-cluster",         // optional, kubectl context
 *     "dryRunByDefault": true          // default true — apply requires confirm
 *   }
 */

const { existsSync, readFileSync } = await import("fs");
const { resolve } = await import("path");
const { execFileSync } = await import("child_process");

const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../../");
const configFile = resolve(PAAW_ROOT, "data/tools/k8s/config.json");
let config = {};
if (existsSync(configFile)) {
  try { config = JSON.parse(readFileSync(configFile, "utf-8")); } catch {}
}

const KUBECTL = config.kubectlPath || "kubectl";
const DEFAULT_NS = config.defaultNamespace || "default";
const CONTEXT = config.context; // optional

// Commands that are read-only (safe)
const SAFE_COMMANDS = new Set(["get", "describe", "logs", "top", "explain", "version", "cluster-info", "auth can-i"]);

// Commands that are destructive (require confirm)
const DESTRUCTIVE_KEYWORDS = ["delete", "rollout restart", "rollout undo", "scale", "apply", "replace", "patch", "edit", "exec", "port-forward"];

function buildBaseArgs() {
  const args = [];
  if (CONTEXT) args.push("--context", CONTEXT);
  return args;
}

function isDestructive(action) {
  const lower = action.toLowerCase().trim();
  return DESTRUCTIVE_KEYWORDS.some(kw => lower.startsWith(kw) || lower.includes(kw));
}

function runKubectl(args, timeout = 15000) {
  try {
    const output = execFileSync(KUBECTL, args, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 1024 * 512, // 512KB
      env: { ...process.env },
    });
    return { ok: true, output };
  } catch (err) {
    const output = err.stderr?.toString() || err.stdout?.toString() || err.message;
    return { ok: false, output: output.trim() };
  }
}

function truncateOutput(text, maxLines = 80) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines truncated)`;
}

export default async function handler(args, ctx) {
  // Check kubectl availability
  try {
    execFileSync("which", [KUBECTL], { encoding: "utf-8" });
  } catch {
    return {
      text: `⚠️ 找不到 \`${KUBECTL}\`。請確認 kubectl 已安裝且在 PATH 中。\n若需指定路徑，在 data/tools/k8s/config.json 設定：\n\`\`\`json\n{ "kubectlPath": "/usr/local/bin/kubectl" }\n\`\`\``,
    };
  }

  const toolName = ctx?.toolName || args.__toolName || "";
  const ns = args.namespace || DEFAULT_NS;

  try {
    // ── kubectl_get ──
    if (toolName === "kubectl_get" || (!toolName && args.resource && !args.pod)) {
      const kArgs = [...buildBaseArgs(), "get", args.resource];
      if (args.name) kArgs.push(args.name);
      kArgs.push("-n", ns);
      if (args.labels) kArgs.push("-l", args.labels);
      const fmt = args.output || "wide";
      if (fmt === "wide") kArgs.push("-o", "wide");
      else if (fmt === "json") kArgs.push("-o", "json");
      else if (fmt === "yaml") kArgs.push("-o", "yaml");
      else if (fmt === "name") kArgs.push("-o", "name");
      if (args.namespace === "--all-namespaces" || ns === "--all-namespaces") {
        kArgs[kArgs.indexOf("-n")] = "--all-namespaces";
        kArgs.splice(kArgs.indexOf(ns), 1);
      }

      const result = runKubectl(kArgs);
      if (!result.ok) return { text: `❌ kubectl get 失敗：\n\`\`\`\n${result.output}\n\`\`\``, error: true };
      return { text: `\`\`\`\n${truncateOutput(result.output)}\n\`\`\`` };
    }

    // ── kubectl_describe ──
    if (toolName === "kubectl_describe" || (!toolName && args.resource && args.name && !args.pod)) {
      const kArgs = [...buildBaseArgs(), "describe", args.resource, args.name, "-n", ns];
      const result = runKubectl(kArgs);
      if (!result.ok) return { text: `❌ kubectl describe 失敗：\n\`\`\`\n${result.output}\n\`\`\``, error: true };
      return { text: `\`\`\`\n${truncateOutput(result.output)}\n\`\`\`` };
    }

    // ── kubectl_logs ──
    if (toolName === "kubectl_logs" || (!toolName && args.pod)) {
      const kArgs = [...buildBaseArgs(), "logs", args.pod, "-n", ns];
      if (args.container) kArgs.push("-c", args.container);
      if (args.previous) kArgs.push("--previous");
      if (args.tail) kArgs.push("--tail", String(args.tail));
      if (args.since) kArgs.push("--since", args.since);

      const result = runKubectl(kArgs);
      if (!result.ok) return { text: `❌ kubectl logs 失敗：\n\`\`\`\n${result.output}\n\`\`\``, error: true };
      return { text: `\`\`\`\n${truncateOutput(result.output, 100)}\n\`\`\`` };
    }

    // ── kubectl_top ──
    if (toolName === "kubectl_top") {
      const kArgs = [...buildBaseArgs(), "top", args.resource];
      if (args.resource === "pods") {
        kArgs.push("-n", ns);
        if (args.labels) kArgs.push("-l", args.labels);
      }
      kArgs.push("--headers");

      const result = runKubectl(kArgs);
      if (!result.ok) return { text: `❌ kubectl top 失敗：\n\`\`\`\n${result.output}\n\`\`\`\n（可能需要安裝 metrics-server）`, error: true };
      return { text: `\`\`\`\n${truncateOutput(result.output)}\n\`\`\`` };
    }

    // ── kubectl_apply (destructive — requires confirm) ──
    if (toolName === "kubectl_apply" || args.action) {
      const action = args.action;
      const namespace = args.namespace || DEFAULT_NS;

      if (!args.confirm) {
        // Preview mode — show what will run, don't execute
        const destructive = isDestructive(action);
        const warning = destructive
          ? "⚠️ **破壞性操作** — 以下命令會改變叢集狀態：\n"
          : "";
        return {
          text: `${warning}\`\`\`bash\nkubectl ${action} -n ${namespace}\n\`\`\`\n\n確認執行？請帶 ` + "`confirm: true`" + ` 再次呼叫。`,
          data: { action, namespace, requiresConfirm: true, destructive },
        };
      }

      // Confirmed — execute
      const kArgs = [...buildBaseArgs(), ...action.split(/\s+/), "-n", namespace];
      const result = runKubectl(kArgs, 30000);
      if (!result.ok) return { text: `❌ kubectl 執行失敗：\n\`\`\`\n${result.output}\n\`\`\``, error: true };
      return { text: `✅ 執行完成：\n\`\`\`\n${truncateOutput(result.output)}\n\`\`\`` };
    }

    return { text: "❓ 未知的 k8s 操作。請指定 toolName 或提供正確的參數。" };
  } catch (err) {
    return { text: `❌ k8s 操作失敗：${err.message}`, error: true };
  }
}
