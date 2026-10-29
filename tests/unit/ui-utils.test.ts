/**
 * Unit tests — packages/ui/src/utils/index.ts + packages/ui/src/utils/stableStringify.ts
 *
 * Covers the frontend base utility layer that the rest of the UI depends on:
 *   - stableStringify()  (deterministic JSON — UI 版，與 server 版行為對齊)
 *   - cn()               (className joiner)
 *   - pathBasename()     (cross-platform, handles / and \)
 *   - pathStartsWith()   (cross-platform prefix boundary)
 *   - pathRelative()     (cross-platform prefix strip)
 *   - fmtChatTime()      (當日 / 昨天 / 更早 / 跨年 規則)
 *   - fmtTime()          (locale string passthrough)
 *
 * Scope rationale: TASK-116 review (F20261016-073) flagged that UI 版
 * stableStringify 零測試覆蓋、path 函式邊界未測。此檔補上關鍵路徑。
 *
 * Strategy: pure functions with no external deps — import via relative path
 * (vitest.config.ts 只 alias @server / @shared，未 alias UI 套件)。
 */
import { describe, it, expect } from "vitest";
import {
  stableStringify,
  cn,
  pathBasename,
  pathStartsWith,
  pathRelative,
  fmtChatTime,
  fmtTime,
} from "../../packages/ui/src/utils/index";

// ═══════════════════════════════════════════════════════════════
// stableStringify() — 與 server 版行為對齊
// ═══════════════════════════════════════════════════════════════

describe("stableStringify() — deterministic JSON", () => {
  it("同內容不同插入順序 → 字串相等", () => {
    const a = stableStringify({ x: 1, y: { b: 2, a: 3 } });
    const b = stableStringify({ y: { a: 3, b: 2 }, x: 1 });
    expect(a).toBe(b);
  });

  it("原始 JSON.stringify 順序敏感（對照組）", () => {
    expect(JSON.stringify({ x: 1, y: 2 })).not.toBe(JSON.stringify({ y: 2, x: 1 }));
  });

  it("array 順序保持不變（只有 object key 排序）", () => {
    expect(stableStringify({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it("深層巢狀全部排序", () => {
    expect(stableStringify({ z: { c: { b: 1, a: 2 } }, a: 0 })).toBe(
      '{"a":0,"z":{"c":{"a":2,"b":1}}}',
    );
  });

  it("primitives 與 null/undefined 行為對齊 JSON.stringify", () => {
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hi")).toBe('"hi"');
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe(undefined);
  });
});

// ═══════════════════════════════════════════════════════════════
// cn()
// ═══════════════════════════════════════════════════════════════

describe("cn()", () => {
  it("以空格串接所有 truthy 值", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("過濾掉 false / null / undefined", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("全部為 falsy 時回傳空字串", () => {
    expect(cn(false, null, undefined)).toBe("");
  });

  it("空輸入回傳空字串", () => {
    expect(cn()).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════
// pathBasename()
// ═══════════════════════════════════════════════════════════════

describe("pathBasename()", () => {
  it("POSIX 路徑取最後一段", () => {
    expect(pathBasename("/a/b/c.ts")).toBe("c.ts");
  });

  it("Windows 路徑（反斜線）取最後一段", () => {
    expect(pathBasename("C:\\a\\b\\c.ts")).toBe("c.ts");
  });

  it("混合分隔符", () => {
    expect(pathBasename("/a\\b/c.ts")).toBe("c.ts");
  });

  it("結尾多餘分隔符會被剝除（目錄路徑）", () => {
    expect(pathBasename("/a/b/")).toBe("b");
    expect(pathBasename("a\\\\")).toBe("a");
  });

  it("單一檔名原樣回傳", () => {
    expect(pathBasename("c.ts")).toBe("c.ts");
  });

  it("空字串安全回傳空字串", () => {
    expect(pathBasename("")).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════
// pathStartsWith()
// ═══════════════════════════════════════════════════════════════

describe("pathStartsWith()", () => {
  it("child 路徑以 POSIX 分隔符開頭 → true", () => {
    expect(pathStartsWith("/a/b", "/a")).toBe(true);
  });

  it("child 路徑以 Windows 分隔符開頭 → true", () => {
    expect(pathStartsWith("\\a\\b", "\\a")).toBe(true);
  });

  it("完全相同 → true（邊界）", () => {
    expect(pathStartsWith("/a/b", "/a/b")).toBe(true);
  });

  it("前綴不形成路徑邊界（/ab vs /a）→ false（關鍵邊界）", () => {
    expect(pathStartsWith("/ab", "/a")).toBe(false);
  });

  it("不相關路徑 → false", () => {
    expect(pathStartsWith("/x/y", "/a")).toBe(false);
  });

  it("空字串前綴 → 只匹配空字串本身", () => {
    expect(pathStartsWith("", "")).toBe(true);
    expect(pathStartsWith("/a", "")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// pathRelative()
// ═══════════════════════════════════════════════════════════════

describe("pathRelative()", () => {
  it("剝除 POSIX 前綴與分隔符", () => {
    expect(pathRelative("/a/b/c.ts", "/a")).toBe("b/c.ts");
  });

  it("剝除 Windows 前綴與分隔符", () => {
    expect(pathRelative("\\a\\b\\c.ts", "\\a")).toBe("b\\c.ts");
  });

  it("完全相同 → 空字串", () => {
    expect(pathRelative("/a/b", "/a/b")).toBe("");
  });

  it("非前綴（未形成路徑邊界）→ 原文回傳", () => {
    expect(pathRelative("/other", "/a")).toBe("/other");
  });
});

// ═══════════════════════════════════════════════════════════════
// fmtChatTime()
// ═══════════════════════════════════════════════════════════════

describe("fmtChatTime()", () => {
  it("空 / null / undefined → 空字串", () => {
    expect(fmtChatTime()).toBe("");
    expect(fmtChatTime("")).toBe("");
    expect(fmtChatTime(null as unknown as string)).toBe("");
  });

  it("無效日期 → 空字串", () => {
    expect(fmtChatTime("not-a-date")).toBe("");
  });

  it("當日 → 只顯示時間（不含『昨天』或日期）", () => {
    const out = fmtChatTime(new Date());
    expect(out).not.toContain("昨天");
    expect(out).not.toContain("/");
    expect(out.length).toBeGreaterThan(0);
  });

  it("昨天 → 以『昨天 』開頭", () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    expect(fmtChatTime(y)).toMatch(/^昨天 /);
  });

  it("更早（當年）→ M/D 時間格式", () => {
    const now = new Date();
    // 取當年 1/1（若今天是 1/1 或 1/2 則跳過，避免落回『昨天/當日』區間）
    const d = new Date(now.getFullYear(), 0, 1, 10, 30);
    const out = fmtChatTime(d);
    if (now.getMonth() === 0 && now.getDate() <= 2) {
      // 邊界日：不強制格式，只確認有輸出
      expect(typeof out).toBe("string");
    } else {
      expect(out).toMatch(/^1\/1 /);
    }
  });

  it("跨年 → 以 YYYY/M/D 開頭", () => {
    const now = new Date();
    const d = new Date(now.getFullYear() - 1, 11, 31, 10, 30);
    expect(fmtChatTime(d)).toMatch(new RegExp(`^${now.getFullYear() - 1}/12/31 `));
  });

  it("接受 Date 物件 / ISO 字串 / 毫秒數", () => {
    const d = new Date();
    expect(fmtChatTime(d)).toBe(fmtChatTime(d.toISOString()));
    expect(fmtChatTime(d)).toBe(fmtChatTime(d.getTime()));
  });
});

// ═══════════════════════════════════════════════════════════════
// fmtTime()
// ═══════════════════════════════════════════════════════════════

describe("fmtTime()", () => {
  it("回傳對應日期字串（等於 toLocaleString）", () => {
    const iso = "2026-01-02T03:04:05.000Z";
    expect(fmtTime(iso)).toBe(new Date(iso).toLocaleString());
  });
});
