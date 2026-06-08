/**
 * PAAW Chat / Conversations Repository
 */
import type { Kysely } from "kysely";
import type { PaawDB } from "../types";
import { generateId, nowISO } from "@paaw/shared";

export class ChatsRepo {
  constructor(private db: Kysely<PaawDB>) {}

  async createConversation(params: {
    userId: string;
    type?: "chat" | "skill-lab" | "app-lab";
  }): Promise<string> {
    const id = generateId("conv");
    const now = nowISO();
    await this.db.insertInto("conversations").values({
      id,
      user_id: params.userId,
      type: params.type ?? "chat",
      status: "active",
      summary: null,
      tags_json: null,
      message_count: 0,
      started_at: now,
      last_message_at: now,
    }).execute();
    return id;
  }

  async addMessage(params: {
    conversationId: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    contentType?: "text" | "image" | "file" | "action";
    intent?: string;
    model?: string;
    tokensUsed?: number;
    latencyMs?: number;
    metadata?: Record<string, any>;
  }): Promise<string> {
    const id = generateId("msg");
    await this.db.insertInto("chat_messages").values({
      id,
      conversation_id: params.conversationId,
      role: params.role,
      content: params.content,
      content_type: params.contentType ?? "text",
      intent: params.intent ?? null,
      actions_json: null,
      skill_run_ids_json: null,
      model: params.model ?? null,
      tokens_used: params.tokensUsed ?? null,
      latency_ms: params.latencyMs ?? null,
      metadata_json: params.metadata ? JSON.stringify(params.metadata) : null,
    }).execute();

    // Update conversation
    const now = nowISO();
    await this.db.updateTable("conversations")
      .set({
        message_count: this.db.fn("message_count + 1"),
        last_message_at: now,
        updated_at: now,
      })
      .where("id", "=", params.conversationId)
      .execute();

    return id;
  }

  async getConversation(convId: string) {
    return this.db.selectFrom("conversations").where("id", "=", convId).selectAll().executeTakeFirst();
  }

  async getMessages(convId: string, options?: { limit?: number; offset?: number }) {
    let query = this.db.selectFrom("chat_messages")
      .where("conversation_id", "=", convId)
      .orderBy("created_at", "asc");

    if (options?.limit) query = query.limit(options.limit);
    if (options?.offset) query = query.offset(options.offset);

    return query.selectAll().execute();
  }

  async listConversations(userId: string, options?: { type?: string; limit?: number }) {
    let query = this.db.selectFrom("conversations")
      .where("user_id", "=", userId)
      .orderBy("last_message_at", "desc");

    if (options?.type) query = query.where("type", "=", options.type);
    if (options?.limit) query = query.limit(options.limit);

    return query.selectAll().execute();
  }

  async closeConversation(convId: string): Promise<void> {
    await this.db.updateTable("conversations")
      .set({ status: "closed", updated_at: nowISO() })
      .where("id", "=", convId)
      .execute();
  }
}
