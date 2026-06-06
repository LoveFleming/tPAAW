/**
 * tAgent Data Store Repository — CRUD for data runner
 */
import type { Kysely } from "kysely";
import type { tAgentDB } from "../types";
import { generateId, nowISO } from "@tagent/shared";

export class DataStoreRepo {
  constructor(private db: Kysely<tAgentDB>) {}

  async create(modelId: string, userId: string, data: Record<string, any>): Promise<string> {
    const id = generateId("ds");
    const now = nowISO();
    await this.db.insertInto("data_store").values({
      id,
      model_id: modelId,
      user_id: userId,
      data_json: JSON.stringify(data),
      deleted_at: null,
    }).execute();
    return id;
  }

  async read(id: string) {
    return this.db.selectFrom("data_store")
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .selectAll()
      .executeTakeFirst();
  }

  async update(id: string, data: Partial<Record<string, any>>): Promise<void> {
    const existing = await this.read(id);
    if (!existing) throw new Error(`Record not found: ${id}`);

    const merged = { ...JSON.parse(existing.data_json), ...data };
    await this.db.updateTable("data_store")
      .set({ data_json: JSON.stringify(merged) })
      .where("id", "=", id)
      .execute();
  }

  async softDelete(id: string): Promise<void> {
    await this.db.updateTable("data_store")
      .set({ deleted_at: nowISO() })
      .where("id", "=", id)
      .execute();
  }

  async search(modelId: string, userId: string, options?: {
    query?: string;
    filters?: Record<string, any>;
    sort?: { field: string; order: "asc" | "desc" };
    page?: number;
    pageSize?: number;
  }) {
    // For MVP, load all and filter in JS. Optimize later with SQL.
    let rows = await this.db.selectFrom("data_store")
      .where("model_id", "=", modelId)
      .where("user_id", "=", userId)
      .where("deleted_at", "is", null)
      .selectAll()
      .execute();

    let items = rows.map(r => ({ id: r.id, ...JSON.parse(r.data_json), _createdAt: r.created_at, _updatedAt: r.updated_at }));

    // Filter
    if (options?.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        items = items.filter(item => item[key] === value);
      }
    }

    // Text search (simple substring match)
    if (options?.query) {
      const q = options.query.toLowerCase();
      items = items.filter(item =>
        Object.values(item).some(v => typeof v === "string" && v.toLowerCase().includes(q))
      );
    }

    // Sort
    if (options?.sort) {
      const { field, order } = options.sort;
      items.sort((a, b) => {
        const va = a[field] ?? "";
        const vb = b[field] ?? "";
        const cmp = String(va).localeCompare(String(vb));
        return order === "desc" ? -cmp : cmp;
      });
    }

    // Pagination
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const total = items.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    items = items.slice(start, start + pageSize);

    return { items, pagination: { page, pageSize, total, totalPages } };
  }
}
