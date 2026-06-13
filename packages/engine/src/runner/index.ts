/**
 * Skill Runner — Unified execution engine
 * 
 * All skill runs go through this, regardless of trigger source.
 * Dispatches to the correct runner based on skill.execution.runner.
 */
import type { RunContext, RunResult, RunnerType } from "@paaw/shared";
import { generateId, nowISO, measureMs } from "@paaw/shared";
import type { RunsRepo } from "@paaw/db";

// ── Runner Interface ────────────────────────────────────

export interface SkillExecutor {
  execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>>;
}

// ── Prompt Runner ───────────────────────────────────────

export class PromptRunner implements SkillExecutor {
  async execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>> {
    const { systemPrompt, model, ...rest } = config;
    
    // Resolve template vars in system prompt
    const resolvedPrompt = systemPrompt
      ? resolvePromptTemplate(systemPrompt, input)
      : "You are a helpful assistant. Process the following input and return a JSON result.";

    // Build messages for LLM call
    const messages = [
      { role: "system", content: resolvedPrompt },
      { role: "user", content: JSON.stringify(input) },
    ];

    // For now, return a structured response. The actual LLM call
    // will be wired through the server's existing chat infrastructure.
    // This runner focuses on the execution pattern.
    return {
      _runner: "prompt",
      _model: model || "default",
      messages,
      ...rest,
    };
  }
}

function resolvePromptTemplate(template: string, input: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return input[key] !== undefined ? String(input[key]) : `{{${key}}}`;
  });
}

// ── Data Runner ─────────────────────────────────────────

export class DataRunner implements SkillExecutor {
  constructor(private dataStoreRepo: any) {}

  async execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>> {
    const { dataModel, operation } = config;

    switch (operation) {
      case "create":
        return this.dataStoreRepo.create(dataModel, context.userId, input);
      case "read":
        return this.dataStoreRepo.read(input.id);
      case "update":
        const { id, ...data } = input;
        await this.dataStoreRepo.update(id, data);
        return { updated: true, id };
      case "delete":
        await this.dataStoreRepo.softDelete(input.id);
        return { deleted: true, id: input.id };
      case "search":
        return this.dataStoreRepo.search(dataModel, context.userId, {
          query: input.query,
          filters: input.filters,
          sort: input.sort,
          page: input.page,
          pageSize: input.pageSize,
        });
      default:
        throw new Error(`Unknown data operation: ${operation}`);
    }
  }
}

// ── API Runner ──────────────────────────────────────────

export class ApiRunner implements SkillExecutor {
  async execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>> {
    const { url, method = "GET", headers = {}, auth, ...rest } = config;

    // Build headers with auth
    const finalHeaders: Record<string, string> = { ...headers };
    if (auth) {
      if (auth.type === "bearer") {
        finalHeaders["Authorization"] = `Bearer ${context.secrets[auth.secretRef] || ""}`;
      } else if (auth.type === "api-key") {
        finalHeaders[auth.header || "X-API-Key"] = context.secrets[auth.secretRef] || "";
      }
    }

    // Build fetch options
    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", ...finalHeaders },
    };

    if (method !== "GET" && method !== "HEAD") {
      fetchOptions.body = JSON.stringify(input);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return { content: await response.text() };
  }
}

// ── Script Runner (Sandbox) ────────────────────────────
//
// Script execution is delegated to the CLI Service (sandbox).
// The script + input are sent via HTTP API, executed in isolation,
// and the result is returned.
//
// Supported languages: javascript, shell, python
//
// Sandbox endpoint: POST /api/exec
// Body: { cli: <runtime>, args: [...], cwd, env, timeout }
//

/**
 * Sandbox CLI Service URL.
 * Resolved at call time so env changes take effect without restart.
 */
function getSandboxUrl(): string {
  try {
    // @ts-ignore — process may not be typed in this package but exists at runtime
    return (globalThis.process?.env?.CLI_SERVICE_URL) || "http://localhost:4099";
  } catch {
    return "http://localhost:4099";
  }
}

export class ScriptRunner implements SkillExecutor {
  /**
   * Execute a skill script in the sandbox.
   *
   * config.script  — the script source code (inline)
   * config.scriptPath — path to script file in sandbox /workspace
   * config.language — "javascript" | "shell" | "python"
   * config.timeout — execution timeout in ms (default 30000)
   * config.cwd — working directory in sandbox
   * config.env — extra env vars for sandbox
   */
  async execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>> {
    const {
      script,
      scriptPath,
      language = "javascript",
      timeout = 30000,
      cwd,
      env,
    } = config;

    // ── Resolve what to execute ──
    if (scriptPath) {
      // Execute a script file already in sandbox /workspace
      return this._execFile(scriptPath, language, input, { timeout, cwd, env });
    }

    if (script) {
      // Inline script — write to temp file in sandbox, then execute
      return this._execInline(script, language, input, { timeout, cwd, env });
    }

    throw new Error("ScriptRunner requires either `script` or `scriptPath` in config");
  }

  /** Execute a script file that already exists in the sandbox */
  private async _execFile(
    scriptPath: string,
    language: string,
    input: Record<string, any>,
    opts: { timeout: number; cwd?: string; env?: Record<string, string> }
  ): Promise<Record<string, any>> {
    const { cli, args } = this._buildExecCommand(scriptPath, language);

    const result = await this._callSandbox({
      cli,
      args,
      cwd: opts.cwd || "/workspace",
      env: {
        ...opts.env,
        SKILL_INPUT: JSON.stringify(input),
      },
      timeout: opts.timeout,
    });

    return this._parseResult(result);
  }

  /** Write inline script to temp file, execute, then clean up */
  private async _execInline(
    script: string,
    language: string,
    input: Record<string, any>,
    opts: { timeout: number; cwd?: string; env?: Record<string, string> }
  ): Promise<Record<string, any>> {
    // For inline scripts, we use a different approach:
    // 1. Write script to a temp file via File Service or sandbox FS
    // 2. Execute it
    // 3. Clean up
    //
    // For now, shell-based approach: pipe script via stdin
    const { cli, args } = this._buildInlineCommand(language);

    const result = await this._callSandbox({
      cli,
      args,
      cwd: opts.cwd || "/workspace",
      env: {
        ...opts.env,
        SKILL_INPUT: JSON.stringify(input),
        SKILL_SCRIPT: script,
      },
      timeout: opts.timeout,
      stdin: script, // pipe script as stdin
    });

    return this._parseResult(result);
  }

  /** Map language to sandbox runtime + args for file execution */
  private _buildExecCommand(scriptPath: string, language: string): { cli: string; args: string[] } {
    switch (language) {
      case "javascript":
      case "js":
        return { cli: "node", args: [scriptPath] };
      case "shell":
      case "bash":
      case "sh":
        return { cli: "bash", args: [scriptPath] };
      case "python":
      case "py":
        return { cli: "python3", args: [scriptPath] };
      default:
        throw new Error(`Unsupported script language: ${language}`);
    }
  }

  /** Map language to sandbox runtime for inline (stdin) execution */
  private _buildInlineCommand(language: string): { cli: string; args: string[] } {
    switch (language) {
      case "javascript":
      case "js":
        return { cli: "node", args: ["--input-type=module", "-e", "process.env.SKILL_SCRIPT || ''"] };
      case "shell":
      case "bash":
      case "sh":
        return { cli: "bash", args: ["-s"] };
      case "python":
      case "py":
        return { cli: "python3", args: ["-c", "__import__('os').environ.get('SKILL_SCRIPT','')"] };
      default:
        throw new Error(`Unsupported script language: ${language}`);
    }
  }

  /** Call the CLI Service sandbox API */
  private async _callSandbox(opts: {
    cli: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout: number;
    stdin?: string;
  }): Promise<{ stdout: string; exitCode: number }> {
    try {
      const res = await fetch(`${getSandboxUrl()}/api/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cli: opts.cli,
          args: opts.args,
          cwd: opts.cwd,
          env: opts.env,
          timeout: opts.timeout,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Sandbox error: ${err.error || res.status}`);
      }

      return res.json();
    } catch (err: any) {
      // If sandbox is unreachable, throw clear error
      if (err.cause?.code === "ECONNREFUSED") {
        throw new Error(`Sandbox CLI Service unavailable at ${getSandboxUrl()}. Is it running?`);
      }
      throw err;
    }
  }

  /** Parse sandbox stdout into structured result */
  private _parseResult(result: { stdout: string; exitCode: number }): Record<string, any> {
    if (result.exitCode !== 0) {
      throw new Error(`Script exited with code ${result.exitCode}: ${result.stdout}`);
    }

    // Try to parse stdout as JSON
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Not valid JSON, return as text
      }
    }

    return { output: result.stdout };
  }
}

// ── Runner Factory ──────────────────────────────────────

export function createRunner(type: RunnerType, deps?: { dataStoreRepo?: any }): SkillExecutor {
  switch (type) {
    case "prompt": return new PromptRunner();
    case "data": return new DataRunner(deps?.dataStoreRepo);
    case "api": return new ApiRunner();
    case "script": return new ScriptRunner();
    default: throw new Error(`Unknown runner type: ${type}`);
  }
}

// ── Execute Skill ───────────────────────────────────────

export async function executeSkill(params: {
  skillId: string;
  input: Record<string, any>;
  execution: { runner: RunnerType; mode: "sync" | "async"; timeout: number; config: Record<string, any> };
  context: RunContext;
  runsRepo: RunsRepo;
  dataStoreRepo?: any;
}): Promise<RunResult> {
  const { skillId, input, execution, context, runsRepo, dataStoreRepo } = params;
  
  // Create run record
  const runId = await runsRepo.create({
    skillId,
    userId: context.userId,
    runnerType: execution.runner,
    input,
    appId: context.source.type === "app" ? context.source.workflowId : undefined,
    workflowId: context.source.workflowId,
    workflowRunId: context.source.workflowId ? context.runId : undefined,
    nodeId: undefined,
    cronJobId: context.source.cronJobId,
  });

  try {
    // Mark as running
    await runsRepo.start(runId);

    // Create runner and execute
    const runner = createRunner(execution.runner, { dataStoreRepo });
    const { result: output, ms } = await measureMs(() =>
      runner.execute(input, execution.config, { ...context, runId })
    );

    // Record success
    await runsRepo.complete(runId, output, ms);

    return { runId, status: "completed", output, durationMs: ms };
  } catch (err: any) {
    const { ms } = await measureMs(async () => {}); // placeholder
    const durationMs = ms;
    await runsRepo.fail(runId, err.message, durationMs);
    return { runId, status: "failed", error: err.message, durationMs };
  }
}
