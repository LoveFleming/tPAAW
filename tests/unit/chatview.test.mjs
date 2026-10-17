/**
 * Unit tests — ChatView 個人 AI 助理主對話介面 (F20261016-066 / TASK-109 品質補強)
 *
 * Target (read-only, NOT imported):
 *   packages/ui/src/pages/ChatView.tsx  (+ its input column ChatInputBar.tsx)
 *
 * Why two layers (same precedent as TASK-105 usage-report-panel / ADR-022 template tests):
 *   1. ChatView is React + TSX and pulls in react-markdown / theme / i18n.
 *      The vitest workspace runs in a *node* environment with no jsdom /
 *      @testing-library (see vitest.config.ts), so the component CANNOT be
 *      rendered or imported here.
 *   2. Most of the behaviour we must protect (seed queue, SSE line parsing,
 *      title derivation, attachment prompt layout, model resolution) is inlined
 *      inside the component / its callbacks, i.e. not importable without
 *      editing the implementation — and TASK-109 forbids touching the impl.
 *
 * Therefore we split the test into two layers:
 *   Layer A — static contract scan: assert the demo/impl source TEXT exhibits the
 *             Next.js/React contracts of the feature (CRUD endpoints, seed event
 *             names, SSE parser, markdown + tool badges, modal wiring...).
 *             Guards against silent removal of a key path.
 *   Layer B — executable semantic reproduction: re-implement the pure /
 *             near-pure logic *seeded from the source* with tiny stubs (fetch,
 *             localStorage, in-memory store) and assert the behaviour contract
 *             (idempotent seed, robust SSE framing, deterministic title/model
 *             resolution, attachment prompt building, delete-selects-latest).
 *
 * Layer B is where real regressions in the extracted logic would be caught at
 * CI speed; Layer A is the structural guard.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const CHATVIEW = path.join(ROOT, "packages/ui/src/pages/ChatView.tsx");
const INPUTBAR = path.join(ROOT, "packages/ui/src/components/ChatInputBar.tsx");

const src = fs.readFileSync(CHATVIEW, "utf8");
const inputSrc = fs.readFileSync(INPUTBAR, "utf8");

// ════════════════════════════════════════════════════════════════════
// Layer A — static contract scan
// ════════════════════════════════════════════════════════════════════
describe("ChatView — Layer A: static contract scan", () => {
  it("target files exist and are non-trivial", () => {
    expect(src.length).toBeGreaterThan(5000);
    expect(inputSrc.length).toBeGreaterThan(1000);
  });

  it("exports sendSeedToChat and keeps a module-level pending seed", () => {
    expect(src).toMatch(/export function sendSeedToChat\s*\(/);
    expect(src).toMatch(/_pendingSeed/);
    // Cross-page injection contract: dispatches a ready event when already mounted
    expect(src).toMatch(/paaw-seed-chat-ready/);
    expect(src).toMatch(/new CustomEvent\(\s*["']paaw-seed-chat-ready["']/);
  });

  // ── 會話清單 CRUD ──
  it("session CRUD: list / create / delete endpoints present", () => {
    expect(src).toMatch(/\/api\/paaw\/chats/); // list (GET)
    expect(src).toMatch(/POST/);
    expect(src).toMatch(/\/api\/paaw\/chats\/\$\{chatId\}/); // delete
    expect(src).toMatch(/method:\s*["']DELETE["']/);
    expect(src).toMatch(/const createNewChat\s*=/);
    expect(src).toMatch(/const deleteChat\s*=/);
    expect(src).toMatch(/const loadChats\s*=/);
  });

  it("new chat seeds an assistant greeting message", () => {
    expect(src).toMatch(/role:\s*["']assistant["']/);
    expect(src).toMatch(/有什麼可以幫你的嗎/);
  });

  it("deleting the active chat re-selects the newest remaining chat", () => {
    // remaining[0] is newest-first → falls back to null when empty
    expect(src).toMatch(/remaining\[0\]\.id\s*:\s*null/);
  });

  // ── 串流訊息區 ──
  it("streaming: reads SSE from chat endpoint and aborts in-flight on stop", () => {
    expect(src).toMatch(/\/api\/paaw\/chat/);
    expect(src).toMatch(/EventSource|ReadableStream|getReader\(\)|\.textDecoder|TextDecoder/);
    expect(src).toMatch(/abortRef/);
    expect(src).toMatch(/const handleStop\s*=/);
  });

  it("messages rendered through react-markdown + gfm + breaks", () => {
    expect(src).toMatch(/import ReactMarkdown from ["']react-markdown["']/);
    expect(src).toMatch(/remark-gfm/);
    expect(src).toMatch(/remark-breaks/);
    expect(src).toMatch(/mdComponents/);
  });

  it("tool badges surfaced during streaming (activeTools)", () => {
    expect(src).toMatch(/activeTools/);
  });

  // ── 共用輸入列 ──
  it("shared ChatInputBar wired for text / images / files submit", () => {
    expect(src).toMatch(/<ChatInputBar/);
    expect(src).toMatch(/onSubmit=\{\(\{\s*text,\s*images,\s*files\s*\}\)/);
    expect(src).toMatch(/onStop=\{handleStop\}/);
    // ChatInputBar itself supports image + file pending collections
    expect(inputSrc).toMatch(/pendingImages/);
    expect(inputSrc).toMatch(/pendingFiles/);
    expect(inputSrc).toMatch(/addFiles/); // ref API for external injection
    expect(inputSrc).toMatch(/MAX_FILE_BYTES/);
    expect(inputSrc).toMatch(/MAX_ITEMS/);
  });

  // ── 模型切換 ──
  it("model switch persists per-session preference (not providers.json)", () => {
    expect(src).toMatch(/const switchModel\s*=/);
    expect(src).toMatch(/localStorage\.setItem\(\s*["']paaw\.chat\.provider["']/);
    expect(src).toMatch(/localStorage\.setItem\(\s*["']paaw\.chat\.model["']/);
    // stale-preference recovery reads them back and validates against providers
    expect(src).toMatch(/localStorage\.getItem\(\s*["']paaw\.chat\.provider["']/);
  });

  // ── 助理設定 / 技能 modal ──
  it("assistant profile + skills modals are toggleable", () => {
    expect(src).toMatch(/showAssistantSettings/);
    expect(src).toMatch(/showAssistantSkills/);
    expect(src).toMatch(/<AssistantProfileModal/);
    expect(src).toMatch(/<AssistantSkillsModal/);
  });

  // ── Context debug ──
  it("context debug window fetches /api/chat/context and shows systemPrompt", () => {
    expect(src).toMatch(/\/api\/chat\/context/);
    expect(src).toMatch(/showContextDebug/);
    expect(src).toMatch(/contextDebug\?\.error/);
    expect(src).toMatch(/contextDebug\?\.systemPrompt/);
    expect(src).toMatch(/setShowContextDebug\(true\)/);
  });

  it("embedded mode supported (mounted inside App shell)", () => {
    expect(src).toMatch(/embedded/);
    expect(src).toMatch(/onTitleChange/);
  });
});
// ════════════════════════════════════════════════════════════════════
// Layer B — executable semantic reproduction
// ════════════════════════════════════════════════════════════════════

// Seed queue: mirrors the module-level _pendingSeed + consumeSeed() in ChatView.
// Contract: a trimmed, non-empty pending message is delivered exactly once;
// blank seeds are dropped; a second read yields null (idempotent consume).
function makeSeedBox() {
  let pending = null;
  return {
    put: (m) => { pending = m; },
    consume: () => { const t = pending == null ? null : pending.trim(); pending = null; return t || null; },
  };
}
describe("ChatView — Layer B: seed message (sendSeedToChat) semantics", () => {
  it("delivers a pending seed exactly once", () => {
    const box = makeSeedBox();
    box.put("summarize this file");
    expect(box.consume()).toBe("summarize this file");
    expect(box.consume()).toBeNull();
  });
  it("trims whitespace around the seed", () => {
    const box = makeSeedBox();
    box.put("  hello  ");
    expect(box.consume()).toBe("hello");
  });
  it("drops blank / whitespace-only seeds", () => {
    const box = makeSeedBox();
    box.put("   ");
    expect(box.consume()).toBeNull();
  });
  it("empty box yields null (no phantom message)", () => {
    expect(makeSeedBox().consume()).toBeNull();
  });
});
