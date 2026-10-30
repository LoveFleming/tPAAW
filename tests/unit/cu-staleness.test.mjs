// cu-staleness.test.mjs — CU staleness 內容導向判定測試（2026-10-30：mtime → git diff 程式碼過濾）
//
// 受測：packages/server/src/routes/coding.mjs computeCuStaleness（export for test）
//      packages/server/src/lib/cu-source-scan.mjs changedSourceFilesSince / getHeadCommit
//
// 核心情境：git pull/checkout 刷新全部 mtime 但內容零變更 → 不誤報 stale；
// 純 doc/圖/locale 變更 → 不 stale；實際程式碼變更 → stale；
// 非 git 專案 / 舊 cu-status 無 codeCommit → fallback mtime 行為。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

const { computeCuStaleness } = await import("../../packages/server/src/routes/coding.mjs");
const { changedSourceFilesSince, getHeadCommit } = await import("../../packages/server/src/lib/cu-source-scan.mjs");

let root;
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf-8" }).trim();
const commitAll = (msg) => {
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", msg);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cu-staleness-"));
  git("init", "-q");
  writeFileSync(join(root, "src.js"), "console.log(1);\n");
  commitAll("init");
});
afterAll(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

const artifact = () => {
  mkdirSync(join(root, ".paaw"), { recursive: true });
  writeFileSync(join(root, ".paaw", "scan.json"), "{}");
};
const stepsWith = (extra = {}) => ({
  scan: { status: "done", codeMtime: 0, ...extra },
});
// 隔離：丢弃上一个 test 留下的未提交变史，保持 working tree 干净
const cleanTree = () => git("checkout", "--", ".");

describe("changedSourceFilesSince", () => {
  it("非 git 專案回 null（呼叫端 fallback mtime）", async () => {
    const plain = mkdtempSync(join(tmpdir(), "cu-plain-"));
    try {
      expect(await changedSourceFilesSince(plain, "deadbeef")).toBeNull();
      expect(await getHeadCommit(plain)).toBeNull();
    } finally { rmSync(plain, { recursive: true, force: true }); }
  });

  it("watermark commit 不存在（歷史改寫）回 null", async () => {
    expect(await changedSourceFilesSince(root, "0123456789abcdef0123456789abcdef01234567")).toBeNull();
  });

  it("只留程式碼檔：doc/locale/圖 不算", async () => {
    const c0 = await getHeadCommit(root);
    writeFileSync(join(root, "README.md"), "doc\n");
    writeFileSync(join(root, "zh.json"), "{}\n");
    writeFileSync(join(root, "logo.svg"), "<svg/>");
    commitAll("docs");
    const changed = await changedSourceFilesSince(root, c0);
    expect(changed).toEqual([]);
  });

  it("程式碼變更（含未提交）會被抓到", async () => {
    const c0 = await getHeadCommit(root);
    writeFileSync(join(root, "src.js"), "console.log(2);\n");
    const changed = await changedSourceFilesSince(root, c0);
    expect(changed).toContain("src.js");
  });
});

describe("computeCuStaleness（git repo）", () => {
  it("git pull 式 mtime 刷新、內容零變更 → 不 stale", async () => {
    cleanTree();
    const c0 = await getHeadCommit(root);
    // 模擬 git pull 刷新所有 mtime：touch 全部 source 檔
    const now = new Date();
    utimesSync(join(root, "src.js"), now, now);
    artifact();
    const stale = await computeCuStaleness(root, stepsWith({ codeCommit: c0 }), now.getTime() + 1e6);
    expect(stale).toEqual([]);
  });

  it("純 doc 變更 commit → 不 stale", async () => {
    cleanTree();
    const c0 = await getHeadCommit(root);
    writeFileSync(join(root, "NOTES.md"), "notes\n");
    commitAll("docs only");
    artifact();
    const stale = await computeCuStaleness(root, stepsWith({ codeCommit: c0 }), Date.now() + 1e6);
    expect(stale).toEqual([]);
  });

  it("程式碼變更 commit → stale", async () => {
    cleanTree();
    const c0 = await getHeadCommit(root);
    writeFileSync(join(root, "src.js"), "console.log(3);\n");
    commitAll("code change");
    artifact();
    const stale = await computeCuStaleness(root, stepsWith({ codeCommit: c0 }), 0);
    expect(stale.map(s => s.id)).toContain("scan");
  });

  it("step 非 done → 永不 stale", async () => {
    artifact();
    const stale = await computeCuStaleness(root, { scan: { status: "pending" } }, Date.now() + 1e6);
    expect(stale).toEqual([]);
  });
});

describe("computeCuStaleness fallback（非 git / 無 codeCommit）", () => {
  it("無 codeCommit → 舊 mtime 行為：code 比 watermark 新才 stale", async () => {
    artifact();
    const past = Date.now() - 3600_000;
    utimesSync(join(root, ".paaw", "scan.json"), new Date(past), new Date(past));
    // codeLastModified 舊於產出 → 不 stale
    expect(await computeCuStaleness(root, stepsWith({ codeMtime: past }), past - 1000)).toEqual([]);
    // codeLastModified 遠新於產出 → stale（mtime fallback 生效）
    const stale = await computeCuStaleness(root, stepsWith({ codeMtime: past }), Date.now() + 1e6);
    expect(stale.map(s => s.id)).toContain("scan");
  });

  it("產出檔不存在但 status=done → stale（git 與 mtime 路徑皆然）", async () => {
    const c0 = await getHeadCommit(root);
    const stale = await computeCuStaleness(root, stepsWith({ codeCommit: c0 }), 0);
    // scan.json 已在上一個 describe 重寫；這裡先刪掉再驗（.paaw 不在 git repo 內也沒關係，existsSync 為準）
    rmSync(join(root, ".paaw", "scan.json"), { force: true });
    const stale2 = await computeCuStaleness(root, stepsWith({ codeCommit: c0 }), 0);
    expect(stale2.map(s => s.id)).toContain("scan");
    expect(Array.isArray(stale)).toBe(true);
  });
});
