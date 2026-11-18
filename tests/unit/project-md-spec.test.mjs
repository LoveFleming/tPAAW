// project-md-spec.test.mjs — Product Spec 8 節 schema + generateFullSpec + spec_write 整份寫入
//
// 2026-11-18 Fleming 需求：每節各有簡潔 schema（GHS FR 風格）；人貼內容給曉薇 → 一次填整份 8 節。
// 受測：packages/server/src/lib/project-md.mjs（SPEC_SECTION_SCHEMAS / generateFullSpec / split/join）
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const lib = await import("../../packages/server/src/lib/project-md.mjs");
const { SPEC_SECTION_SCHEMAS, splitSpecSections, joinSpecSections, parseProjectMd, buildProjectMd, generateFullSpec, generateSpecSection } = lib;

const TMP = mkdtempSync(join(tmpdir(), "projmd-spec-"));

beforeAll(() => {
  writeFileSync(join(TMP, "package.json"), JSON.stringify({ name: "demo-app", description: "test" }), "utf-8");
});

afterAll(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

describe("SPEC_SECTION_SCHEMAS", () => {
  it("8 節各帶格式 schema", () => {
    expect(SPEC_SECTION_SCHEMAS).toHaveLength(8);
    for (const s of SPEC_SECTION_SCHEMAS) {
      expect(s.n).toBeGreaterThanOrEqual(1);
      expect(s.n).toBeLessThanOrEqual(8);
      expect(s.format.length).toBeGreaterThan(20);
    }
  });
  it("FR 節 schema 是 GHS FR 條目格式（Requirement / Acceptance Criteria / Business Rule）", () => {
    const fr = SPEC_SECTION_SCHEMAS[1];
    expect(fr.format).toContain("FR-01");
    expect(fr.format).toContain("**Requirement**");
    expect(fr.format).toContain("**Acceptance Criteria**");
    expect(fr.format).toContain("**Business Rule**");
  });
});

describe("split/join round-trip", () => {
  it("8 節切了再合回不丟內容", () => {
    const parts = Array.from({ length: 8 }, (_, i) => `### 第${i + 1}節內容\n\n- 要點 A${i}\n- 要點 B${i}`);
    const md = joinSpecSections(parts);
    const back = splitSpecSections(md);
    for (let i = 0; i < 8; i++) expect(back[i]).toContain(`要點 A${i}`);
  });
  it("空字串切 8 個空節", () => {
    expect(splitSpecSections("")).toEqual(new Array(8).fill(""));
  });
});

describe("parse/build", () => {
  it("marker 檔 round-trip：spec 區保留下來", () => {
    const spec = joinSpecSections(new Array(8).fill("內容 X"));
    const md = buildProjectMd("demo", null, null, spec);
    const parsed = parseProjectMd(md);
    expect(parsed.specSection).toContain("內容 X");
  });
});

/** 假 LLM：每節回帶節號的 markdown */
const fakeLLM = async ({ messages }) => {
  const m = messages[0].content.match(/目標 section：## (\d)\./);
  const n = m ? m[1] : "?";
  return { content: `這是第 ${n} 節（AI 生成）\n\n- 要點${n}` };
};

describe("generateFullSpec（貼內容 → 一次填 8 節）", () => {
  it("逐節生成寫入 PROJECT.md，8 節都有內容", async () => {
    // 預放 side chat 對話（人貼的內容）+ 舊 spec（其中一節失敗要保留舊值）
    const convDir = join(TMP, ".paaw", "coding-memory", "conversations", "coding.spec-side");
    mkdirSync(convDir, { recursive: true });
    writeFileSync(join(convDir, "active.json"), JSON.stringify({ messages: [
      { role: "user", content: "這是我的產品規格：（貼上 GHS 規格全文…）" },
      { role: "assistant", content: "收到，我來整理成 8 節" },
    ] }), "utf-8");

    const r = await generateFullSpec(TMP, { callLLM: fakeLLM });
    expect(r.written).toBe(true);
    expect(r.sections).toHaveLength(8);
    const md = readFileSync(join(TMP, ".paaw", "project", "PROJECT.md"), "utf-8");
    for (let i = 1; i <= 8; i++) expect(md).toContain(`這是第 ${i} 節（AI 生成）`);
  });
  it("單節失敗保留原內容", async () => {
    let call = 0;
    const flaky = async ({ messages }) => {
      call++;
      const m = messages[0].content.match(/目標 section：## (\d)\./);
      if (m && m[1] === "5") throw new Error("boom");
      return { content: `重生成 ${m[1]}` };
    };
    const r = await generateFullSpec(TMP, { callLLM: flaky });
    expect(r.written).toBe(true);
    expect(r.failed).toEqual([5]);
    const md = readFileSync(join(TMP, ".paaw", "project", "PROJECT.md"), "utf-8");
    expect(md).toContain("重生成 1");
    expect(md).toContain("這是第 5 節（AI 生成）"); // 第 5 節保留原值
  });
  it("全部失敗不寫入", async () => {
    const md0 = readFileSync(join(TMP, ".paaw", "project", "PROJECT.md"), "utf-8");
    const r = await generateFullSpec(TMP, { callLLM: async () => { throw new Error("down"); } });
    expect(r.written).toBe(false);
    expect(readFileSync(join(TMP, ".paaw", "project", "PROJECT.md"), "utf-8")).toBe(md0);
  });
  it("無 LLM 直接拒絕", async () => {
    expect((await generateFullSpec(TMP, {})).written).toBe(false);
  });
});

describe("generateSpecSection（單節帶 schema prompt）", () => {
  it("prompt 帶該節格式 schema，只動該節", async () => {
    let seenPrompt = "";
    const rec = async ({ messages }) => { seenPrompt = messages[0].content; return { content: "新單節內容" }; };
    const r = await generateSpecSection(TMP, 0, { callLLM: rec });
    expect(r.written).toBe(true);
    expect(seenPrompt).toContain("FR-01"); // section 2（index 1）schema 關鍵字
    const parsed = parseProjectMd(readFileSync(join(TMP, ".paaw", "project", "PROJECT.md"), "utf-8"));
    const parts = splitSpecSections(parsed.specSection);
    expect(parts[0]).toContain("新單節內容");
    expect(parts[1]).toContain("重生成 2"); // 其他節未動
  });
});
