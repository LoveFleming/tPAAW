// 2026-10-19 修根因隨附測試 — CHANGELOG 自動生成器收斂 + code review 排除 .paaw
// 事件：委員會 major「CHANGELOG 條目污染」（task 硬切 80 字元殘片 + diff-stat 條目 +
// 同日多個 ### changed 未合併）；Fleming 決策 .paaw/ 不納入 code review。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../");
const { PaawProject } = await import(join(ROOT, "packages/server/src/lib/paaw-project.mjs"));
const { _buildDiffContext } = await import(join(ROOT, "packages/server/src/lib/coding-review-runner.mjs"));

let tmp;
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
};

beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), "paaw-changelog-test-")); });
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("appendChangelog — 同日同分類合併", () => {
  it("兩筆同分類 → 單一 ### 區塊兩行 bullet", async () => {
    const root = join(tmp, "merge");
    const p = new PaawProject(root); await p.init();
    await p.appendChangelog({ type: "changed", description: "第一筆" });
    await p.appendChangelog({ type: "changed", description: "第二筆" });
    const content = readFileSync(join(root, ".paaw/changelog/CHANGELOG.md"), "utf8");
    const changedBlocks = content.split("\n").filter(l => l === "### changed");
    expect(changedBlocks.length).toBe(1);
    expect(content).toContain("- 第一筆");
    expect(content).toContain("- 第二筆");
  });

  it("不同分類 → 各自區塊", async () => {
    const root = join(tmp, "merge2");
    const p = new PaawProject(root); await p.init();
    await p.appendChangelog({ type: "fixed", description: "修 A" });
    await p.appendChangelog({ type: "added", description: "加 B" });
    const content = readFileSync(join(root, ".paaw/changelog/CHANGELOG.md"), "utf8");
    expect(content).toContain("### fixed");
    expect(content).toContain("### added");
  });

  it("描述含換行/連續空白 → 壓成單行", async () => {
    const root = join(tmp, "flatten");
    const p = new PaawProject(root); await p.init();
    await p.appendChangelog({ type: "changed", description: "多行\n\n描述   有  空白" });
    const content = readFileSync(join(root, ".paaw/changelog/CHANGELOG.md"), "utf8");
    expect(content).toContain("- 多行 描述 有 空白");
  });
});

describe("generateChangelogFromSession — 收斂", () => {
  const tc = (name, args) => ({ name, args: JSON.stringify(args) });

  it("只動 .paaw/** 的 session 不寫 changelog（防自我污染迴圈）", async () => {
    const root = join(tmp, "paawonly");
    const p = new PaawProject(root); await p.init();
    const r = await p.generateChangelogFromSession({
      task: "清理 changelog 污染條目",
      toolCalls: [tc("write_file", { path: join(root, ".paaw/changelog/CHANGELOG.md"), content: "# x" })],
    });
    expect(r.skipped).toBe("paaw-only");
    // 仍會建初始檔（ensure 結構），但不應有 session 條目
    const content = readFileSync(join(root, ".paaw/changelog/CHANGELOG.md"), "utf8");
    expect(content).not.toContain("清理 changelog");
  });

  it("一般 session：一筆乾淨摘要，無 diff-stat 條目、無 (N modified) 後綴", async () => {
    const root = join(tmp, "normal");
    const p = new PaawProject(root); await p.init();
    const long = "【目標】修復 ADR-004 e2e 去 socket 化。這段是後面的細節描述，內容很長很長很長很長很長很長很長很長很長很長很長，用來驗證句界截斷。";
    const r = await p.generateChangelogFromSession({
      task: long,
      toolCalls: [tc("write_file", { path: join(root, "src/app.js"), content: "export default 1" })],
    });
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].description).not.toMatch(/lines across/);
    expect(r.entries[0].description).not.toMatch(/\(\d+ modified\)/);
    expect(r.entries[0].description.length).toBeLessThanOrEqual(82); // 80 + 省略號容許
    expect(r.entries[0].description).toMatch(/[。…]$/); // 截在句界或加省略號，不硬切
  });
});

describe("code review 範圍 — 排除 .paaw", () => {
  it("_buildDiffContext 的 files/diff/stat 不含 .paaw", () => {
    const repo = join(tmp, "repo");
    mkdirSync(join(repo, ".paaw", "changelog"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, ".gitignore"), ".paaw/api-tester/\n");
    writeFileSync(join(repo, "src", "base.js"), "export const a = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "base");
    // 第二個 commit：同時動 .paaw（runtime 產物）與 src（交付 code）
    writeFileSync(join(repo, ".paaw", "changelog", "CHANGELOG.md"), "## 2026-10-19\n- auto junk\n");
    writeFileSync(join(repo, "src", "base.js"), "export const a = 2; // changed\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "touch paaw + src");

    const ctx = _buildDiffContext(repo, "HEAD~1..HEAD");
    expect(ctx.files).toContain("src/base.js");
    expect(ctx.files.some(f => f.startsWith(".paaw/"))).toBe(false);
    expect(ctx.diff).toContain("changed");
    expect(ctx.diff).not.toContain("auto junk");
    expect(ctx.stat).toContain("src/base.js");
    expect(ctx.stat).not.toContain(".paaw/");
  });
});
