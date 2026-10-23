/**
 * Review Boundary ⊕ 橫切關注點（③ Change/Review Boundary）測試
 * 改動碰到散在多條 feature 的橫切符號（如 Budget Control）→ review 警示。
 */
import { describe, it, expect } from "vitest";
import { _crosscutTouches } from "../../packages/server/src/lib/review-boundary.mjs";

const concepts = [
  {
    id: "CC-009",
    name: "Budget / Quota 額度控制",
    aiName: "虛擬金鑰與計費額度",
    crossFeatureCount: 4,
    features: ["F-037", "F-040", "F-042", "F-044"],
    dominantShare: 0.38,
    evidence: [
      { file: "src/globals.ts", line: 292, symbol: "VIRTUAL_KEY" },
      { file: "src/shared/services/cache/utils/rateLimiter.ts", line: 5, symbol: "RATE_LIMIT_LUA" },
    ],
  },
  {
    id: "CC-010",
    name: "Rate Limiting",
    crossFeatureCount: 4,
    features: ["F-037", "F-040"],
    dominantShare: 0.4,
    evidence: [{ file: "src/globals.ts", line: 301, symbol: "API_KEY_RATE_LIMIT_CHECK_START" }],
  },
];

describe("review-boundary crosscut touches", () => {
  it("改動檔命中 evidence → 回報 concept + 命中檔", () => {
    const m = _crosscutTouches(["src/globals.ts"], concepts);
    expect(m.has("src/globals.ts")).toBe(true);
    const ids = m.get("src/globals.ts").map((c) => c.conceptId).sort();
    expect(ids).toEqual(["CC-009", "CC-010"]);
    // aiName 優先
    expect(m.get("src/globals.ts").find((c) => c.conceptId === "CC-009").name).toBe("虛擬金鑰與計費額度");
  });

  it("沒命中的檔案不回報", () => {
    const m = _crosscutTouches(["src/unrelated.ts"], concepts);
    expect(m.size).toBe(0);
  });

  it("Windows 反斜線路徑也要命中（歸一化）", () => {
    const m = _crosscutTouches(["src\\shared\\services\\cache\\utils\\rateLimiter.ts"], concepts);
    expect(m.size).toBe(1);
    expect(m.get("src/shared/services/cache/utils/rateLimiter.ts")[0].conceptId).toBe("CC-009");
  });
});
