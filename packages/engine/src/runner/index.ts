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

// ── Script Runner ───────────────────────────────────────

export class ScriptRunner implements SkillExecutor {
  async execute(input: Record<string, any>, config: Record<string, any>, context: RunContext): Promise<Record<string, any>> {
    const { script, language = "javascript" } = config;

    if (language !== "javascript") {
      throw new Error(`Unsupported script language: ${language}`);
    }

    // For MVP: use Function constructor as sandbox
    // Future: use QuickJS or VM2 for proper isolation
    const fn = new Function(
      "input", "context", "fetch",
      `return (async () => { ${script} })();`
    );

    return await fn(input, context, fetch);
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
