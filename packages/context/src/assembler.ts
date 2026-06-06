/**
 * Context Assembler — builds the context bundle for each AI turn
 * 
 * This is what gets injected into the LLM prompt so the AI knows
 * who the user is, what they've been doing, and what's relevant now.
 */
import type { Kysely } from "kysely";
import type { tAgentDB } from "@tagent/db";
import type { ContextBundle } from "@tagent/shared";
import { MemoryStore } from "../memory/memory-store";

// Token budget constants (rough estimates)
const MAX_CONTEXT_TOKENS = 4000;
const PROFILE_MAX_TOKENS = 500;
const RECENT_MESSAGES_MAX = 10;
const MEMORY_MAX_TOKENS = 1500;
const SKILLS_MAX_TOKENS = 500;

function estimateTokens(text: string): number {
  // Rough: 1 token ≈ 4 chars for English, ≈ 2 chars for Chinese
  return Math.ceil(text.length / 3);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 3;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "...";
}

export class ContextAssembler {
  constructor(
    private db: Kysely<tAgentDB>,
    private memory: MemoryStore,
  ) {}

  /**
   * Build the full context bundle for an AI turn.
   */
  async build(params: {
    userId: string;
    currentPage?: string;
    userMessage?: string;
  }): Promise<ContextBundle> {
    const { userId, currentPage, userMessage } = params;

    // Step 1: Profile (always included)
    const profileMemories = await this.memory.recall({
      userId,
      layer: "profile",
      limit: 20,
    });

    const profile: ContextBundle["profile"] = {};
    const profileText: string[] = [];
    for (const m of profileMemories) {
      profileText.push(`[${m.key}] ${m.content}`);
      if (estimateTokens(profileText.join("\n")) > PROFILE_MAX_TOKENS) break;
    }

    // Step 2: Recent messages
    const recentConv = await this.db.selectFrom("conversations")
      .where("user_id", "=", userId)
      .where("type", "=", "chat")
      .where("status", "=", "active")
      .orderBy("last_message_at", "desc")
      .limit(1)
      .selectAll()
      .executeTakeFirst();

    let recentMessages: ContextBundle["recentMessages"] = [];
    if (recentConv) {
      const messages = await this.db.selectFrom("chat_messages")
        .where("conversation_id", "=", recentConv.id)
        .orderBy("created_at", "desc")
        .limit(RECENT_MESSAGES_MAX)
        .selectAll()
        .execute();

      recentMessages = messages.reverse().map(m => ({
        role: m.role,
        content: truncateToTokens(m.content, 200),
      }));
    }

    // Step 3: Relevant memories (semantic search if user message provided)
    let relevantMemories: ContextBundle["relevantMemories"] = [];
    if (userMessage) {
      // Extract keywords from user message for search
      const keywords = userMessage
        .replace(/[。，！？、；：""''（）【】《》\s]+/g, " ")
        .split(" ")
        .filter(w => w.length > 1)
        .slice(0, 3);

      for (const keyword of keywords) {
        const results = await this.memory.search({
          userId,
          query: keyword,
          limit: 3,
        });
        relevantMemories.push(...results);
      }

      // Deduplicate and limit
      const seen = new Set<string>();
      relevantMemories = relevantMemories.filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      }).slice(0, 5);
    }

    // Step 4: Available skills (lightweight list)
    // For MVP, we'll return a static list. Future: load from skill registry.
    const availableSkills: ContextBundle["availableSkills"] = [
      // These will be dynamically loaded from data/skills/pool/ in production
    ];

    // Step 5: Active tasks
    const activeTasks: ContextBundle["activeTasks"] = [];
    const workingMemories = await this.memory.recall({
      userId,
      layer: "working",
      limit: 5,
    });
    for (const m of workingMemories) {
      try {
        const data = JSON.parse(m.content);
        if (data.intent) {
          activeTasks.push({
            id: m.id,
            description: `${data.intent} (${data.date})`,
            status: "in-progress",
          });
        }
      } catch {}
    }

    return {
      profile: profileText.length > 0
        ? { preferences: profileText.join("\n"), updatedAt: new Date().toISOString() }
        : {},
      recentMessages,
      relevantMemories: relevantMemories.map(m => ({
        content: truncateToTokens(m.content, 100),
        score: m.score,
      })),
      activeTasks,
      availableSkills,
      currentPage,
    };
  }

  /**
   * Render the context bundle as a text block for LLM injection.
   * This is what actually goes into the system prompt.
   */
  renderText(bundle: ContextBundle): string {
    const parts: string[] = [];

    if (bundle.profile && Object.keys(bundle.profile).length > 0) {
      parts.push(`## 使用者資訊\n${bundle.profile.preferences}`);
    }

    if (bundle.recentMessages.length > 0) {
      parts.push("## 最近對話\n" + bundle.recentMessages
        .map(m => `${m.role === "user" ? "使用者" : "語晴"}: ${m.content}`)
        .join("\n"));
    }

    if (bundle.relevantMemories.length > 0) {
      parts.push("## 相關記憶\n" + bundle.relevantMemories
        .map(m => `- ${m.content}`)
        .join("\n"));
    }

    if (bundle.activeTasks.length > 0) {
      parts.push("## 進行中的任務\n" + bundle.activeTasks
        .map(t => `- ${t.description}`)
        .join("\n"));
    }

    if (bundle.currentPage) {
      parts.push(`## 目前頁面: ${bundle.currentPage}`);
    }

    return parts.join("\n\n");
  }
}
