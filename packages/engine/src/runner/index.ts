/**
 * Skill Runner — Unified execution engine
 * 
 * All skill runs go through this, regardless of trigger source.
 * Dispatches to the correct runner based on skill.execution.runner.
 */
import type { RunContext, RunResult, RunnerType } from "@paaw/shared";
import { measureMs, resolveTemplate } from "@paaw/shared";
import type { RunsRepo } from "@paaw/db";

// ── Runner Interface ────────────────────────────────────

export interface SkillExecutor {
  execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>>;
}

// ── Prompt Runner ───────────────────────────────────────

/** Minimal LLM caller contract injected by the host (server owns providers). */
export type LlmCaller = (messages: Array<{ role: string; content: string }>, model?: string) => Promise<Record<string, any>>;

export class PromptRunner implements SkillExecutor {
  constructor(private llmCaller?: LlmCaller) {}

  async execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>> {
    const { systemPrompt, model } = config;

    // Resolve template vars in system prompt
    const resolvedPrompt = systemPrompt
      ? resolvePromptTemplate(systemPrompt, input)
      : "You are a helpful assistant. Process the following input and return a JSON result.";

    // Build messages for LLM call
    const messages = [
      { role: "system", content: resolvedPrompt },
      { role: "user", content: JSON.stringify(input) },
    ];

    // The runner must actually call the LLM. If the host did not inject a
    // caller we fail loud instead of returning a fake "messages" payload that
    // looks like a successful run (a silent success is worse than an error).
    if (!this.llmCaller) {
      throw new Error(
        "PromptRunner requires an llmCaller but none was injected (check createRunner deps)"
      );
    }

    return await this.llmCaller(messages, model);
  }
}

function resolvePromptTemplate(template: string, input: Record<string, any>): string {
  // Reuse the shared template engine so prompt substitution stays consistent
  // with workflow/app templates and inherits its prototype-pollution guard.
  // `resolveTemplate` fills missing keys with "" (shared semantics), so an
  // unresolved {{x}} no longer leaks the raw placeholder into the prompt.
  return resolveTemplate(template, input);
}

// ── Data Runner ─────────────────────────────────────────

export class DataRunner implements SkillExecutor {
  constructor(private dataStoreRepo: any) {}

  async execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>> {
    const { dataModel, operation } = config;

    // Fail loud when the runner has no backing store instead of hitting a
    // runtime NPE on the first `this.dataStoreRepo.*` access.
    if (!this.dataStoreRepo) {
      throw new Error("DataRunner requires a dataStoreRepo but none was injected (check createRunner deps)");
    }

    switch (operation) {
      case "create": {
        // DataStoreRepo.create returns the new record id (string). Wrap it so
        // the runner output never leaks a bare string into output_json.
        const id = await this.dataStoreRepo.create(dataModel, context.userId, input);
        return { id, created: true };
      }
      case "read": {
        const row = await this.dataStoreRepo.read(input.id);
        if (!row) return { found: false, record: null };
        // IDOR guard: a read must never return another user's row. The repo
        // only filters by id, so ownership is enforced here.
        this._assertOwnership(row, context.userId, "read");
        return { found: true, record: this._toRecord(row) };
      }
      case "update": {
        const { id, ...data } = input;
        // Verify ownership before mutating (repo.update only filters by id).
        const existing = await this.dataStoreRepo.read(id);
        if (!existing) throw new Error(`Record not found: ${id}`);
        this._assertOwnership(existing, context.userId, "update");
        await this.dataStoreRepo.update(id, data);
        return { updated: true, id };
      }
      case "delete": {
        // Verify ownership before soft-deleting (repo.softDelete only filters by id).
        const existing = await this.dataStoreRepo.read(input.id);
        if (!existing) throw new Error(`Record not found: ${input.id}`);
        this._assertOwnership(existing, context.userId, "delete");
        await this.dataStoreRepo.softDelete(input.id);
        return { deleted: true, id: input.id };
      }
      case "search":
        return this.dataStoreRepo.search(dataModel, context.userId, {
          query: input.query,
          filters: input.filters,
          sort: input.sort,
          page: input.page,
          pageSize: input.pageSize,
        });
      case "aggregate":
      case "export":
        // Declared in DataOperation but intentionally not implemented by the
        // in-memory MVP store. Throw a clear, actionable error rather than a
        // generic "unknown operation" so callers can distinguish "not yet
        // supported" from "typo".
        throw new Error(
          `Data operation "${operation}" is declared in DataOperation but not yet implemented by DataRunner`
        );
      default:
        throw new Error(`Unknown data operation: ${operation}`);
    }
  }

  /** Reject access to a row owned by a different user. */
  private _assertOwnership(row: { user_id?: string }, userId: string, op: string): void {
    if (row.user_id !== undefined && row.user_id !== userId) {
      throw new Error(`Record access denied for ${op}: row is not owned by the current user`);
    }
  }

  /** Normalise a persisted row into the runner's output shape. */
  private _toRecord(row: { id: string; data_json: string; created_at?: string; updated_at?: string }): Record<string, any> {
    return {
      id: row.id,
      ...JSON.parse(row.data_json),
      _createdAt: row.created_at,
      _updatedAt: row.updated_at,
    };
  }
}

// ── API Runner ──────────────────────────────────────────

const DEFAULT_API_TIMEOUT_MS = 30_000;

/**
 * Guard the outbound URL used by the API runner. `url` comes from an
 * untrusted skill definition, so we block obvious SSRF targets (non-https,
 * loopback / private / link-local hosts). This is a baseline defence, not a
 * substitute for the platform's network whitelist.
 */
function assertSafeApiUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid API url: ${rawUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`API runner only allows https URLs (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();
  const isBlocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isBlocked) {
    throw new Error(`API runner blocked private/loopback host: ${host}`);
  }
  return parsed;
}

const DEFAULT_API_MAX_RETRIES = 2;
const DEFAULT_API_BASE_BACKOFF_MS = 200;

export class ApiRunner implements SkillExecutor {
  async execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>> {
    const {
      url,
      method = "GET",
      headers = {},
      auth,
      timeout = DEFAULT_API_TIMEOUT_MS,
      maxRetries = DEFAULT_API_MAX_RETRIES,
    } = config;

    const safeUrl = assertSafeApiUrl(String(url));

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
      // Never follow redirects (prevents redirect-based SSRF bypass).
      redirect: "error",
    };

    if (method !== "GET" && method !== "HEAD") {
      fetchOptions.body = JSON.stringify(input);
    }

    // Retry only *retryable* failures: network errors, timeouts, 429 and 5xx.
    // 4xx (other than 429) are caller errors and must not be retried.
    // Backoff is exponential with full jitter to avoid thundering herds.
    const attempts = Math.max(0, maxRetries) + 1;
    let lastErr: any;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let response: Response;
      let retryAfterMs: number | undefined;
      try {
        response = await fetch(safeUrl, { ...fetchOptions, signal: controller.signal });
      } catch (err: any) {
        clearTimeout(timer);
        lastErr = err?.name === "AbortError"
          ? new Error(`API call timed out after ${timeout}ms: ${safeUrl.href}`)
          : err;
        if (attempt < attempts - 1) {
          await sleepWithJitter(attempt, DEFAULT_API_BASE_BACKOFF_MS);
          continue;
        }
        throw lastErr;
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          return await response.json();
        }
        return { content: await response.text() };
      }

      const retryable = response.status === 429 || response.status >= 500;
      const err = new Error(`API call failed: ${response.status} ${response.statusText}`);
      if (!retryable || attempt >= attempts - 1) {
        throw err;
      }
      // Honour Retry-After when present (seconds), else exponential backoff.
      const ra = Number(response.headers.get("retry-after"));
      retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
      lastErr = err;
      await sleepWithJitter(attempt, DEFAULT_API_BASE_BACKOFF_MS, retryAfterMs);
    }

    // Unreachable in practice (loop throws), but keeps the type checker happy.
    throw lastErr ?? new Error("API call failed");
  }
}

/** Exponential backoff with full jitter; `overrideMs` (e.g. Retry-After) wins. */
function sleepWithJitter(attempt: number, baseMs: number, overrideMs?: number): Promise<void> {
  const ceiling = overrideMs ?? baseMs * 2 ** attempt;
  const delay = Math.random() * ceiling;
  return new Promise((resolve) => setTimeout(resolve, delay));
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

/**
 * Single source of truth for script-language → sandbox runtime mapping.
 * Both the file-based and inline execution paths share this table so the two
 * mappings can never drift apart (previously duplicated switch statements).
 *
 * `cli`/`fileArgs` are used for file execution; `stdinArgs` for inline
 * execution where the program is piped via stdin (never via -e/-c or env, so
 * the source stays inside the sandbox execution contract).
 */
const LANGUAGE_RUNTIMES: Record<string, { cli: string; fileArgs: (path: string) => string[]; stdinArgs: string[] }> = {
  javascript: { cli: "node", fileArgs: (p) => [p], stdinArgs: ["--input-type=module", "-"] },
  shell: { cli: "bash", fileArgs: (p) => [p], stdinArgs: ["-s"] },
  python: { cli: "python3", fileArgs: (p) => [p], stdinArgs: ["-"] },
};

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  bash: "shell",
  sh: "shell",
  py: "python",
};

function resolveLanguageRuntime(language: string): { cli: string; fileArgs: (path: string) => string[]; stdinArgs: string[] } {
  const canonical = LANGUAGE_ALIASES[language] || language;
  const runtime = LANGUAGE_RUNTIMES[canonical];
  if (!runtime) throw new Error(`Unsupported script language: ${language}`);
  return runtime;
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
      },
      timeout: opts.timeout,
      stdin: script, // pipe script as stdin
    });

    return this._parseResult(result);
  }

  /** Map language to sandbox runtime + args for file execution */
  private _buildExecCommand(scriptPath: string, language: string): { cli: string; args: string[] } {
    const runtime = resolveLanguageRuntime(language);
    return { cli: runtime.cli, args: runtime.fileArgs(scriptPath) };
  }

  /**
   * Map language to sandbox runtime for inline execution.
   *
   * The script is always fed via stdin (never via `-e`/`-c` or env vars) so
   * the source is not embedded in the process argv / environment — that
   * keeps the script inside the sandbox execution contract.
   */
  private _buildInlineCommand(language: string): { cli: string; args: string[] } {
    const runtime = resolveLanguageRuntime(language);
    return { cli: runtime.cli, args: runtime.stdinArgs };
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
    // Give the HTTP round-trip a bit more headroom than the script itself,
    // so a hung sandbox never blocks the caller forever.
    const httpTimeout = opts.timeout + 5_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), httpTimeout);

    try {
      const res = await fetch(`${getSandboxUrl()}/api/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          cli: opts.cli,
          args: opts.args,
          cwd: opts.cwd,
          env: opts.env,
          timeout: opts.timeout,
          stdin: opts.stdin,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Sandbox error: ${err.error || res.status}`);
      }

      return res.json();
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(`Sandbox request timed out after ${httpTimeout}ms at ${getSandboxUrl()}`);
      }
      // If sandbox is unreachable, throw clear error
      if (err.cause?.code === "ECONNREFUSED") {
        throw new Error(`Sandbox CLI Service unavailable at ${getSandboxUrl()}. Is it running?`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Parse sandbox stdout into structured result */
  private _parseResult(result: { stdout: string; exitCode: number }): Record<string, any> {
    if (result.exitCode !== 0) {
      throw new Error(`Script exited with code ${result.exitCode}: ${result.stdout}`);
    }

    // Only treat stdout as structured JSON when the *entire* trimmed output
    // parses as JSON. A leading "{" or "[" is not enough: a script that logs
    // a prefix line (e.g. "[info] starting") plus JSON would previously pass
    // the loose check, fail JSON.parse, and silently drop the structured
    // result into a plain text field. We test-parse and only fall back to
    // text when parsing genuinely fails.
    const trimmed = result.stdout.trim();
    if (trimmed) {
      try {
        return JSON.parse(trimmed) as Record<string, any>;
      } catch {
        // Not valid JSON — return the raw text, but say so explicitly.
      }
    }

    return { output: result.stdout, format: "text" };
  }
}

// ── Runner ──────────────────────────────────────

export function createRunner(type: RunnerType, deps?: { dataStoreRepo?: any; llmCaller?: LlmCaller }): SkillExecutor {
  switch (type) {
    case "prompt": return new PromptRunner(deps?.llmCaller);
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
  llmCaller?: LlmCaller;
}): Promise<RunResult> {
  const { skillId, input, execution, context, runsRepo, dataStoreRepo, llmCaller } = params;
  
  // Create run record.
  //
  // NOTE on appId: RunContext.source has no `appId` field — only workflowId.
  // Previously this wrote workflowId into the `app_id` column whenever the
  // source was an "app", mislabelling workflow runs as app runs. We stop
  // populating app_id from workflowId; if a real appId is ever added to
  // source it should be threaded explicitly.
  const runId = await runsRepo.create({
    skillId,
    userId: context.userId,
    runnerType: execution.runner,
    input,
    workflowId: context.source.workflowId,
    workflowRunId: context.source.workflowId ? context.runId : undefined,
    nodeId: context.source.nodeId,
    cronJobId: context.source.cronJobId,
  });

  const startedAt = Date.now();
  try {
    // Mark as running
    await runsRepo.start(runId);

    // Create runner and execute
    const runner = createRunner(execution.runner, { dataStoreRepo, llmCaller });
    const { result: output, ms } = await measureMs(() =>
      runner.execute(input, execution.config, { ...context, runId })
    );

    // Record success
    await runsRepo.complete(runId, output, ms);

    return { runId, status: "completed", output, durationMs: ms };
  } catch (err: any) {
    // Measure the real elapsed time from the start of execution — not a
    // no-op (previously produced ~0ms and hid how long the failure took).
    const durationMs = Date.now() - startedAt;
    // Preserve the error class so failures are diagnosable (a bare
    // `err.message` loses whether it was a timeout, validation, or NPE).
    const reason = err?.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err?.message;
    await runsRepo.fail(runId, reason, durationMs);
    return { runId, status: "failed", error: reason, durationMs };
  }
}
