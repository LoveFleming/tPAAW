/**
 * Refinery — extracts and distills knowledge from conversations
 * 
 * Three refining schedules:
 *   - Realtime: after each conversation turn
 *   - Daily: summarize day's conversations, update profile
 *   - Weekly: insights, patterns, index rebuild
 */
import type { Kysely } from "kysely";
import type { PaawDB } from "@paaw/db";
import stableStringify from "json-stable-stringify";
import { generateId, nowISO, todayStr } from "@paaw/shared";
import { MemoryStore } from "../memory/memory-store";

export class Refinery {
  constructor(
    private db: Kysely<PaawDB>,
    private memory: MemoryStore,
  ) {}

  // ── Realtime Refining (after each message) ────────────

  /**
   * Extract knowledge fragments from a conversation message.
   * Called after each assistant response.
   */
  async extractKnowledge(params: {
    userId: string;
    conversationId: string;
    userMessage: string;
    assistantMessage: string;
    intent?: string;
  }): Promise<void> {
    // Simple keyword-based extraction for MVP
    // Future: use LLM to extract knowledge points
    const { userId, conversationId, userMessage, assistantMessage, intent } = params;

    // Check if the conversation contains decision/preference indicators
    const preferencePatterns = [
      /我喜歡(.+?)(?:，|。|$)/gu,
      /以後(.+?)就好/gu,
      /我偏好(.+?)(?:，|。|$)/gu,
      /都用(.+?)吧/gu,
      /prefer(?:s?)?\s+(.+?)(?:\.|,|$)/giu,
    ];

    for (const pattern of preferencePatterns) {
      const matches = userMessage.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          await this.memory.remember({
            userId,
            layer: "interaction",
            key: `preference:${Date.now()}`,
            content: match[1].trim(),
            tags: ["preference", intent || "general"].filter(Boolean),
            sourceType: "chat",
            sourceId: conversationId,
          });
        }
      }
    }

    // Track intent usage
    if (intent) {
      await this.memory.remember({
        userId,
        layer: "working",
        key: `intent:${intent}:${todayStr()}`,
        content: JSON.stringify({ intent, date: todayStr(), timestamp: nowISO() }),
        tags: ["intent-tracking"],
        sourceType: "chat",
        sourceId: conversationId,
      });
    }
  }

  // ── Daily Refining (cron, once per day) ───────────────

  /**
   * Generate daily summary from all conversations of the day.
   * Update user profile with new preferences.
   */
  async dailyRefine(userId: string): Promise<void> {
    const date = todayStr();

    // Gather today's memories
    const workingMemories = await this.memory.recall({
      userId,
      layer: "working",
      limit: 100,
    });

    const interactionMemories = await this.memory.recall({
      userId,
      layer: "interaction",
      limit: 50,
    });

    // Build summary from today's data
    // MVP: simple concatenation. Future: use LLM to summarize.
    const todayWorking = workingMemories.filter(m => m.content.includes(date));
    const intentCounts: Record<string, number> = {};
    
    for (const m of todayWorking) {
      try {
        const data = JSON.parse(m.content);
        if (data.intent) {
          intentCounts[data.intent] = (intentCounts[data.intent] || 0) + 1;
        }
      } catch {}
    }

    // Store daily summary
    const id = generateId("ds");
    await this.db.insertInto("daily_summaries").values({
      id,
      user_id: userId,
      date,
      summary: `${todayWorking.length} interactions today. Intents: ${Object.entries(intentCounts).map(([k, v]) => `${k}(${v})`).join(", ") || "none"}`,
      highlights_json: JSON.stringify(interactionMemories.slice(0, 5).map(m => m.content)),
      skills_used_json: "[]",
      intent_counts_json: JSON.stringify(intentCounts),
      mood: "neutral",
    }).execute();

    // Update profile from interaction memories
    const preferences = interactionMemories.filter(m =>
      m.tags?.includes("preference")
    );

    for (const pref of preferences) {
      await this.memory.remember({
        userId,
        layer: "profile",
        key: `pref:${pref.key}`,
        content: pref.content,
        tags: pref.tags,
        sourceType: pref.sourceType,
        sourceId: pref.sourceId,
      });
    }

    // Clean up expired working memories
    await this.memory.cleanup(userId);
  }

  // ── Weekly Refining (cron, once per week) ─────────────

  /**
   * Generate weekly insights from daily summaries.
   */
  async weeklyRefine(userId: string): Promise<void> {
    // Get recent daily summaries (last 7 days)
    const summaries = await this.db.selectFrom("daily_summaries")
      .where("user_id", "=", userId)
      .orderBy("date", "desc")
      .limit(7)
      .selectAll()
      .execute();

    if (summaries.length === 0) return;

    // Aggregate intent counts
    const weeklyIntents: Record<string, number> = {};
    for (const s of summaries) {
      try {
        const counts = JSON.parse(s.intent_counts_json || "{}");
        for (const [intent, count] of Object.entries(counts)) {
          weeklyIntents[intent] = (weeklyIntents[intent] || 0) + Number(count);
        }
      } catch {}
    }

    // Store weekly insight as a profile memory
    const topIntents = Object.entries(weeklyIntents)
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .slice(0, 5);

    await this.memory.remember({
      userId,
      layer: "profile",
      key: "weekly-insights",
      content: stableStringify({
        week: summaries[summaries.length - 1]?.date,
        topIntents: Object.fromEntries(topIntents),
        totalDays: summaries.length,
        moodSummary: summaries.map(s => s.mood).join(","),
      }) ?? "",
      tags: ["weekly-insight"],
    });
  }
}
