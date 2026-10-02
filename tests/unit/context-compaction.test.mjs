import { describe, it, expect } from "vitest";
import {
  estimateMessageTokens,
  shouldCompact,
  partitionMessages,
} from "../../packages/server/src/lib/context-compaction.mjs";

const TOKEN_APPROX = (s) => Math.ceil(s.length / 4);

describe("estimateMessageTokens — token 估算（compaction 決策的基礎）", () => {
  it("空陣列 = 0", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it("純文字訊息 ≈ 內容 + 10 overhead", () => {
    const text = "a".repeat(400);
    const n = estimateMessageTokens([{ role: "user", content: text }]);
    expect(n).toBeGreaterThan(TOKEN_APPROX(text));
    expect(n).toBeLessThan(TOKEN_APPROX(text) + 30);
  });

  it("tool_calls 計入 name + arguments", () => {
    const base = [{ role: "assistant", content: "" }];
    const withTc = [{
      role: "assistant", content: "",
      tool_calls: [{ function: { name: "read_file", arguments: '{"path":"/a/b.ts"}' } }],
    }];
    expect(estimateMessageTokens(withTc)).toBeGreaterThan(estimateMessageTokens(base));
  });

  it("tool_call_id 每則 +5", () => {
    const noId = estimateMessageTokens([{ role: "tool", content: "ok" }]);
    const withId = estimateMessageTokens([{ role: "tool", content: "ok", tool_call_id: "call_1" }]);
    expect(withId - noId).toBe(5);
  });

  it("vision array content 圖片計入（一張 ≈1600）", () => {
    const txt = estimateMessageTokens([{ role: "user", content: "hello" }]);
    const img = estimateMessageTokens([{ role: "user", content: [
      { type: "text", text: "hello" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,xxx" } },
    ] }]);
    expect(img - txt).toBeGreaterThan(1000);
  });
});

describe("shouldCompact — compaction 觸發決策", () => {
  it("低用量 → healthy 不觸發", () => {
    const r = shouldCompact([{ role: "user", content: "hi" }], 128000);
    expect(r.shouldCompact).toBe(false);
    expect(r.reason).toContain("healthy");
  });

  it("超過 budget（contextWindow - maxOutput）→ overflow 觸發", () => {
    const big = [{ role: "user", content: "x".repeat(600000) }]; // ~150k tok > 111616 budget
    const r = shouldCompact(big, 128000);
    expect(r.shouldCompact).toBe(true);
    expect(r.reason).toContain("overflow");
  });

  it("approaching：過門檻且訊息數達標才觸發", () => {
    // 造一個介於 trigger threshold 與 budget 之間的用量（多則小訊息）
    const msgs = Array.from({ length: 950 }, () => ({ role: "user", content: "x".repeat(400) })); // ~110 tok/則 ≈ 104k（過 75% 門檻、未溢出）
    const r = shouldCompact(msgs, 128000);
    expect(r.currentTokens).toBeLessThan(r.budget); // 未溢出
    expect(r.shouldCompact).toBe(true);            // 但過 trigger 門檻且訊息數夠多
    expect(r.reason).toContain("approaching");
    // 訊息太少 → 即使過門檻也不觸發（MIN_MESSAGES_FOR_COMPACTION 護欄）
    const r2 = shouldCompact([msgs[0]], 128000);
    expect(r2.shouldCompact).toBe(false);
  });
});

describe("partitionMessages — head/compactable/tail 切分", () => {
  const mk = (role, n = 40) => ({ role, content: "m".repeat(n) });

  it("≤4 則全在 head，不切", () => {
    const msgs = [mk("system"), mk("user"), mk("assistant"), mk("user")];
    const r = partitionMessages(msgs, 128000);
    expect(r.head).toHaveLength(4);
    expect(r.compactable).toHaveLength(0);
    expect(r.tail).toHaveLength(0);
  });

  it("head = system 連續 + 第一則 user（含其後全部從 idx 繼續分）", () => {
    const msgs = [mk("system"), mk("system"), mk("user"), mk("assistant"), mk("user"), mk("assistant")];
    const r = partitionMessages(msgs, 128000);
    expect(r.head.map(m => m.role)).toEqual(["system", "system", "user"]);
  });

  it("三段不重疊、聯集 = 原訊息", () => {
    const msgs = [mk("system"), mk("user"), ...Array.from({ length: 30 }, (_, i) => mk(i % 2 ? "assistant" : "user"))];
    const r = partitionMessages(msgs, 128000);
    const all = [...r.head, ...r.compactable, ...r.tail];
    expect(all).toHaveLength(msgs.length);
    expect(all[0]).toBe(msgs[0]);
    expect(all[all.length - 1]).toBe(msgs[msgs.length - 1]);
  });

  it("tail 至少保留近期訊息（預算內）", () => {
    const msgs = [mk("system"), mk("user"), ...Array.from({ length: 20 }, (_, i) => mk(i % 2 ? "assistant" : "user", 200))];
    const r = partitionMessages(msgs, 128000);
    expect(r.tail.length).toBeGreaterThanOrEqual(6);
    expect(r.tail[r.tail.length - 1]).toBe(msgs[msgs.length - 1]);
  });
});
