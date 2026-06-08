/**
 * Memory Store — manages all memory layers for a user
 */
import type { Kysely } from "kysely";
import type { PaawDB } from "@paaw/db";
import { generateId, nowISO } from "@paaw/shared";

export interface MemoryEntry {
  id: string;
  layer: "profile" | "interaction" | "working" | "knowledge";
  key: string;
  content: string;
  tags?: string[];
  sourceType?: string;
  sourceId?: string;
  createdAt: string;
}

export class MemoryStore {
  constructor(private db: Kysely<PaawDB>) {}

  /**
   * Store a memory entry
   */
  async remember(params: {
    userId: string;
    layer: MemoryEntry["layer"];
    key: string;
    content: string;
    tags?: string[];
    sourceType?: string;
    sourceId?: string;
  }): Promise<string> {
    const id = generateId("mem");
    const now = nowISO();

    // Upsert: if same userId+layer+key exists, update content
    const existing = await this.db.selectFrom("memory")
      .where("user_id", "=", params.userId)
      .where("layer", "=", params.layer)
      .where("key", "=", params.key)
      .selectAll()
      .executeTakeFirst();

    if (existing) {
      await this.db.updateTable("memory")
        .set({
          content: params.content,
          tags_json: params.tags ? JSON.stringify(params.tags) : null,
          updated_at: now,
        })
        .where("id", "=", existing.id)
        .execute();
      return existing.id;
    }

    await this.db.insertInto("memory").values({
      id,
      user_id: params.userId,
      layer: params.layer,
      key: params.key,
      content: params.content,
      embedding: null,
      tags_json: params.tags ? JSON.stringify(params.tags) : null,
      source_type: params.sourceType ?? null,
      source_id: params.sourceId ?? null,
    }).execute();

    return id;
  }

  /**
   * Recall memories by layer
   */
  async recall(params: {
    userId: string;
    layer?: MemoryEntry["layer"];
    key?: string;
    limit?: number;
  }): Promise<MemoryEntry[]> {
    let query = this.db.selectFrom("memory")
      .where("user_id", "=", params.userId);

    if (params.layer) query = query.where("layer", "=", params.layer);
    if (params.key) query = query.where("key", "=", params.key);

    query = query.orderBy("created_at", "desc");
    if (params.limit) query = query.limit(params.limit);

    const rows = await query.selectAll().execute();

    return rows.map(r => ({
      id: r.id,
      layer: r.layer as MemoryEntry["layer"],
      key: r.key,
      content: r.content,
      tags: r.tags_json ? JSON.parse(r.tags_json) : undefined,
      sourceType: r.source_type ?? undefined,
      sourceId: r.source_id ?? undefined,
      createdAt: r.created_at!,
    }));
  }

  /**
   * Search memories by content (simple text match for MVP)
   * Future: use vector similarity search
   */
  async search(params: {
    userId: string;
    query: string;
    layer?: MemoryEntry["layer"];
    limit?: number;
  }): Promise<Array<MemoryEntry & { score: number }>> {
    let q = this.db.selectFrom("memory")
      .where("user_id", "=", params.userId)
      .where("content", "like", `%${params.query}%`);

    if (params.layer) q = q.where("layer", "=", params.layer);

    const rows = await q
      .orderBy("created_at", "desc")
      .limit(params.limit ?? 10)
      .selectAll()
      .execute();

    return rows.map(r => ({
      id: r.id,
      layer: r.layer as MemoryEntry["layer"],
      key: r.key,
      content: r.content,
      tags: r.tags_json ? JSON.parse(r.tags_json) : undefined,
      sourceType: r.source_type ?? undefined,
      sourceId: r.source_id ?? undefined,
      createdAt: r.created_at!,
      score: 1.0, // MVP: no semantic scoring
    }));
  }

  /**
   * Delete a memory
   */
  async forget(memoryId: string): Promise<void> {
    await this.db.deleteFrom("memory").where("id", "=", memoryId).execute();
  }

  /**
   * Clean up expired working memories
   */
  async cleanup(userId: string): Promise<number> {
    const now = nowISO();
    const result = await this.db.deleteFrom("memory")
      .where("user_id", "=", userId)
      .where("layer", "=", "working")
      .where("expires_at", "is not", null)
      .where("expires_at", "<", now)
      .executeTakeFirst();

    return Number(result.numDeletedRows);
  }
}
