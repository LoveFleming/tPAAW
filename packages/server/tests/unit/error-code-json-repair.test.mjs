/**
 * repairTruncatedJson 測試（2026-10-16）
 *
 * 背景：glm-5.1 error-codes 回應 40336 chars finish=stop，壞在 position 19467（中段），
 * 舊版 closers 只按文末算 → 中段切點補錯括號 → 全救不回。新版 per-safePos closers。
 */
import { describe, it, expect } from "vitest";
import { repairTruncatedJson } from "../../src/lib/error-code-scan.mjs";

describe("repairTruncatedJson", () => {
  it("完整 JSON 不需修復場景：正常回物件（直呼也應過）", () => {
    const v = repairTruncatedJson('{"conventions":"none","byFeature":[{"featureId":"f1"}]}');
    expect(v).toEqual({ conventions: "none", byFeature: [{ featureId: "f1" }] });
  });

  it("截斷 mid-string（max_tokens 砍半）→ 救回完整前綴（半寫的 code 物件正確閉合）", () => {
    const txt = '{"byFeature":[{"featureId":"f1","codes":[{"code":"E_A","message":"partial';
    const v = repairTruncatedJson(txt);
    expect(v.byFeature).toHaveLength(1);
    expect(v.byFeature[0].featureId).toBe("f1");
    expect(v.byFeature[0].codes[0]).toEqual({ code: "E_A" }); // 半寫的 message 被丟，code 保住
  });

  it("截斷正好切在 key 後（Expected ':' 錯誤形態）→ 救回前綴", () => {
    const txt = '{"byFeature":[{"featureId":"f1","codes":[]},{"featureId"';
    const v = repairTruncatedJson(txt);
    expect(v.byFeature).toHaveLength(1);
    expect(v.byFeature[0].featureId).toBe("f1");
  });

  it("中段壞點（字串值內未跳脫引號）→ 救回壞點之前的完整元素（2026-10-16 新能力）", () => {
    // f1 的 summary 內有裸引號 → parse 從此炸掉；後面還有 f2/f3 兩萬字也一樣要丟
    const txt = JSON.stringify({
      conventions: "none",
      byFeature: [
        { featureId: "f1", summary: "ok", codes: [{ code: "E_1", file: "a.mjs" }] },
        { featureId: "f2", summary: '壞點前 "OK" 壞點後', codes: [] },
        { featureId: "f3", summary: "tail", codes: [] },
      ],
    }).replace('"壞點前 \\"OK\\" 壞點後"', '"壞點前 "OK" 壞點後"'); // 注入裸引號
    expect(() => JSON.parse(txt)).toThrow(); // 確認這份素材真的是壞的
    const v = repairTruncatedJson(txt);
    // 壞點在 f2 內 → f1 完整救回；f2/f3 在壞點後丟棄（可接受的資料損失，之後重跑補）
    expect(v.byFeature.map(f => f.featureId)).toContain("f1");
    expect(v.conventions).toBe("none");
  });

  it("深層巢狀截斷：closers 數量要對", () => {
    const txt = '{"a":{"b":[{"c":[1,2,{"d":"e"';
    const v = repairTruncatedJson(txt);
    expect(v.a.b[0].c).toEqual([1, 2, { d: "e" }]); // 切點在完整 value 後 → 連 d 物件都閉合保住
  });
});
