/**
 * surrogate-safety.test.mjs — 孤兒 surrogate 清毒 + 安全截斷測試（2026-09-14 fix）
 *
 * 回歸場景（Fleming 回報）：多輪開發後 LLM API 500 — 工具輸出截斷切在
 * emoji 中間留下孤兒 \ud83d（high half），進歷史後每輪 LLM call 都炸。
 */
import { describe, it, expect } from "vitest";
import {
  stripLoneSurrogates,
  cutSafeStart,
  cutSafeEnd,
  jsonStringifySafe,
} from "../../packages/server/src/lib/llm-utils.mjs";
import { smartTruncateToolResult } from "../../packages/server/src/lib/context-truncation.mjs";

const LONE_HIGH = "\ud83d";          // 孤兒 high（emoji 😅 = \ud83d\ude05 的前半）
const EMOJI = "\ud83d\ude05";        // 😅 完整 pair
const LONE_LOW = "\ude05";           // 孤兒 low

function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1) || 0;
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      const p = s.charCodeAt(i - 1) || 0;
      if (!(p >= 0xd800 && p <= 0xdbff)) return true;
    }
  }
  return false;
}

describe("stripLoneSurrogates", () => {
  it("🔴 回歸案例：移除孤兒 \\ud83d，保留完整 emoji", () => {
    const poisoned = `開發完成${LONE_HIGH}，測試通過${EMOJI}`;
    const clean = stripLoneSurrogates(poisoned);
    expect(hasLoneSurrogate(clean)).toBe(false);
    expect(clean).toBe(`開發完成，測試通過${EMOJI}`);
  });
  it("移除孤兒 low surrogate", () => {
    expect(stripLoneSurrogates(`a${LONE_LOW}b`)).toBe("ab");
  });
  it("乾淨字串原樣回傳（含合法 emoji）", () => {
    const s = `正常 ${EMOJI} 中文 abc`;
    expect(stripLoneSurrogates(s)).toBe(s);
  });
});

describe("cutSafeStart / cutSafeEnd — 截斷不切 surrogate pair", () => {
  it("🔴 回歸案例：切點落在 emoji 前半 → 多剁 1 字元不產生孤兒", () => {
    // 5 個 'a' + emoji（2 code units）+ 'b'：切在 6（emoji 的 high half 上）
    const s = "aaaaa" + EMOJI + "b";
    const cut = cutSafeStart(s, 6);
    expect(cut).toBe("aaaaa"); // high half 被剁掉
    expect(hasLoneSurrogate(cut)).toBe(false);
  });
  it("尾巴截斷：切點落在 low half → 剁掉", () => {
    const s = "x" + EMOJI + "ccccc";
    const cut = cutSafeEnd(s, 6); // 取後 6：low half + 5c → 剁 low half
    expect(cut).toBe("ccccc");
    expect(hasLoneSurrogate(cut)).toBe(false);
  });
  it("切點不在 pair 上 → 跟 slice 一樣", () => {
    expect(cutSafeStart("hello world", 5)).toBe("hello");
    expect(cutSafeEnd("hello world", 5)).toBe("world");
  });
});

describe("jsonStringifySafe — LLM 邊界清毒", () => {
  it("🔴 回歸案例：中毒歷史送 LLM 前自動清乾淨", () => {
    const body = {
      model: "glm-5.1",
      messages: [
        { role: "user", content: "讀檔" },
        { role: "tool", content: `...檔案內容${LONE_HIGH}（truncated, 104826 bytes total）` },
        { role: "assistant", content: `我看完了${EMOJI}` },
      ],
    };
    const json = jsonStringifySafe(body);
    const parsed = JSON.parse(json);
    for (const m of parsed.messages) {
      expect(hasLoneSurrogate(m.content)).toBe(false);
    }
    expect(parsed.messages[2].content).toBe(`我看完了${EMOJI}`); // 合法 emoji 保留
  });
});

describe("smartTruncateToolResult — 源頭不產毒", () => {
  it("🔴 回歸案例：emoji 在截斷邊界 → 輸出無孤兒 surrogate", () => {
    // 造一個 tool output：前 6000 字元 + emoji 密集 + 後 8000 字元（帶 error 觸發 head+tail 模式）
    const head = "H".repeat(6000);
    const emojiWall = EMOJI.repeat(50);
    const tail = "E".repeat(200) + " error: something failed";
    const text = head + emojiWall + "M".repeat(50000) + tail; // 超過 12k 才會截斷
    const out = smartTruncateToolResult(text, 12000);
    expect(out.length).toBeLessThan(text.length);
    expect(hasLoneSurrogate(out)).toBe(false);
  });
  it("head-only 模式同樣安全", () => {
    const text = "a".repeat(5000) + EMOJI.repeat(100) + "b".repeat(10000); // 尾巴無重要 pattern → head-only
    const out = smartTruncateToolResult(text, 12000, { minHead: 5000, minTail: 8000 });
    expect(hasLoneSurrogate(out)).toBe(false);
  });
});
