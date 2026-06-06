/**
 * tAgent Runs Repository
 */
import type { Kysely } from "kysely";
import type { tAgentDB, RunsTable } from "../types";
import { generateId, nowISO, measureMs } from "@tagent/shared";

export class RunsRepo {
  constructor(private db: Kysely<tAgentDB>) {}

  async create(params: {
    skillId: string;
    userId: string;
    runnerType: RunsTable["runner_type"];
    input: Record<string, any>;
    appId?: string;
    workflowId?: string;
    workflowRunId?: string;
    nodeId?: string;
    cronJobId?: string;
    model?: string;
  }): Promise<string> {
    const id = generateId("run");
    await this.db.insertInto("runs").values({
      id,
      skill_id: params.skillId,
      app_id: params.appId ?? null,
      workflow_id: params.workflowId ?? null,
      workflow_run_id: params.workflowRunId ?? null,
      node_id: params.nodeId ?? null,
      cron_job_id: params.cronJobId ?? null,
      user_id: params.userId,
      status: "pending",
      runner_type: params.runnerType,
      input_json: JSON.stringify(params.input),
      output_json: null,
      error_message: null,
      duration_ms: null,
      model: params.model ?? null,
      tokens_used: null,
      started_at: nowISO(),
      completed_at: null,
    }).execute();
    return id;
  }

  async start(runId: string): Promise<void> {
    await this.db.updateTable("runs")
      .set({ status: "running" })
      .where("id", "=", runId)
      .execute();
  }

  async complete(runId: string, output: Record<string, any>, durationMs: number, tokensUsed?: number): Promise<void> {
    await this.db.updateTable("runs")
      .set({
        status: "completed",
        output_json: JSON.stringify(output),
        duration_ms: durationMs,
        tokens_used: tokensUsed ?? null,
        completed_at: nowISO(),
      })
      .where("id", "=", runId)
      .execute();
  }

  async fail(runId: string, error: string, durationMs: number): Promise<void> {
    await this.db.updateTable("runs")
      .set({
        status: "failed",
        error_message: error,
        duration_ms: durationMs,
        completed_at: nowISO(),
      })
      .where("id", "=", runId)
      .execute();
  }

  async getById(runId: string) {
    return this.db.selectFrom("runs").where("id", "=", runId).selectAll().executeTakeFirst();
  }

  async listByUser(userId: string, options?: { skillId?: string; status?: string; limit?: number; offset?: number }) {
    let query = this.db.selectFrom("runs")
      .where("user_id", "=", userId)
      .orderBy("started_at", "desc");

    if (options?.skillId) query = query.where("skill_id", "=", options.skillId);
    if (options?.status) query = query.where("status", "=", options.status);
    if (options?.limit) query = query.limit(options.limit);
    if (options?.offset) query = query.offset(options.offset);

    return query.selectAll().execute();
  }

  async cancel(runId: string): Promise<void> {
    await this.db.updateTable("runs")
      .set({ status: "cancelled", completed_at: nowISO() })
      .where("id", "=", runId)
      .execute();
  }
}
