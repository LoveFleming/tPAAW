// coding-review-board.test.mjs — F20261016-037「Code Review 委員會會議記錄瀏覽」測試（TASK-080 品質補強）
//
// 受測檔：packages/server/src/routes/coding-review-board.mjs
// QA 現況：qr-20261017-015433-pdac（warn, CONDITIONAL）；qr-20261017-015349-6ecz 指出 M3 零測試。
// 本檔補關鍵路徑測試（不重做實作）：
//   A. parseReport（純函式）：metadata 解析、舊格式容忍、缺欄位、格式異常、mtime fallback
//   B. route（整合）：LIST 與 REPORT 端點的實際 HTTP 行為、404、路徑遍歷防護
//
// 測試策略：直接以 capture-style req/res 呼叫 route（同 coding-ops.test.mjs 慣例），
// route 使用 req.url / res.writeHead / res.end，無需真 HTTP server。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseReport } from "../../packages/server/src/routes/coding-review-board.mjs";
import reviewBoardRoutes from "../../packages/server/src/routes/coding-review-board.mjs";

// ── 測試替身：capture-style req/res ──
function makeReqRes(method, url) {
  const req = { method, url, headers: {} };
  const res = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(chunk) { if (chunk !== undefined) this.body = String(chunk); return this; },
  };
  return { req, res };
}
async function callRoute(method, url) {
  const { req, res } = makeReqRes(method, url);
  await reviewBoardRoutes(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

// ── fixture：一份「現行 runner 格式」的完整 report（依 coding-review-runner.mjs L336-368 產出格式） ──
const FULL_REPORT = [
  "# Multi-Model Code Review Report",
  "",
  "- 時間：2026-10-17T01:54:33.000Z",
  "- Range：`HEAD~1..HEAD`（path: `packages/server/`）",
  "- CommitSHAs：a1b2c3d e4f5a6b",
  "- 檔案數：3",
  "- Reviewers：`zai/glm-5.1`、`anthropic/claude-4.5`",
  "- 結論：**request-changes**（critical 1 / major 2 / minor 3）",
  "",
  "## Findings",
  "",
  "### 🔴 packages/server/src/foo.mjs:42 🤝 共識",
  "- **severity**：critical　**models**：`zai/glm-5.1`、`anthropic/claude-4.5`",
  "- `zai/glm-5.1`：path traversal　→ 修法：use safeResolve",
  "",
  "### 🟠 packages/server/src/bar.mjs:10 ◇ 單獨 🚩分歧",
  "- **severity**：major　**models**：`zai/glm-5.1`",
  "- `zai/glm-5.1`：unbounded readFile",
  "",
  "## 🚩 分歧（待人/EM 仲裁）",
  "",
  "- **severity 衝突** `packages/server/src/bar.mjs:10`",
  "  - 🔴 `zai/glm-5.1` 說 major：unbounded readFile",
  "  - ⬜ `anthropic/claude-4.5` 說 (silent)",
  "",
  "## 各 Reviewer 明細",
  "",
  "- `zai/glm-5.1`：2 findings（12s）",
  "- `anthropic/claude-4.5`：1 findings、⚠️ 1 筆退件（行號不在 diff 內）（8s）",
  "",
  "## 退件的幻覺 findings（未採計）",
  "",
  "- [anthropic/claude-4.5] packages/server/src/ghost.mjs:99 hallucinated finding",
].join("\n");

// ── 專案根目錄 fixture ──
let PROJECT;
beforeEach(() => {
  PROJECT = mkdtempSync(join(tmpdir(), "review-board-test-"));
});
afterEach(() => {
  if (PROJECT) rmSync(PROJECT, { recursive: true, force: true });
});

function seedReport(dir, filename, content) {
  const rbDir = join(PROJECT, ".paaw", "review-board");
  mkdirSync(rbDir, { recursive: true });
  writeFileSync(join(rbDir, filename), content, "utf8");
  return dir;
}

// ═══════════════════════════════════════════════════════════════════
// A. parseReport — 純函式 metadata 解析
// ═══════════════════════════════════════════════════════════════════
describe("parseReport — metadata 解析（現行 runner 格式）", () => {
  it("完整 report：時間/Range/reviewers/結論/嚴重度統計 全部正確解析", () => {
    const meta = parseReport("2026-10-17T01-54-33.md", FULL_REPORT);
    expect(meta.file).toBe("2026-10-17T01-54-33.md");
    expect(meta.at).toBe("2026-10-17T01:54:33.000Z");
    expect(meta.range).toBe("HEAD~1..HEAD");
    expect(meta.pathFilter).toBe("packages/server/");
    expect(meta.reviewers).toEqual(["zai/glm-5.1", "anthropic/claude-4.5"]);
    expect(meta.decision).toBe("request-changes");
    expect(meta.counts).toEqual({ critical: 1, major: 2, minor: 3 });
    expect(meta.commitShas).toEqual(["a1b2c3d", "e4f5a6b"]);
    expect(meta.fileCount).toBe("3");
    expect(meta.runnerFormat).toBe(true);
  });

  it("findings 只計 `### ` 標題，且 consensus/disputes 數量正確", () => {
    const meta = parseReport("x.md", FULL_REPORT);
    // 2 個 ### findings（一個 🤝共識、一個 🚩分歧）
    expect(meta.findings.length).toBe(2);
    expect(meta.findings[0]).toContain("foo.mjs:42");
    expect(meta.consensus).toBe(1);
    expect(meta.disputes).toBe(1);
  });

  it("缺 path 過濾時 pathFilter 為 null（而非 true）", () => {
    const md = [
      "# Multi-Model Code Review Report",
      "- 時間：2026-10-17T00:00:00.000Z",
      "- Range：`HEAD~1..HEAD`",
      "- Reviewers：`m/a`",
      "- 結論：**approve**（critical 0 / major 0 / minor 0）",
    ].join("\n");
    const meta = parseReport("x.md", md);
    expect(meta.range).toBe("HEAD~1..HEAD");
    expect(meta.pathFilter).toBeNull();
  });

  it("結論為 inconclusive → decision 與 counts 仍可解析", () => {
    const md = [
      "- 時間：2026-10-17T00:00:00.000Z",
      "- Range：`HEAD~1..HEAD`",
      "- Reviewers：`m/a` ⚠️、`m/b` ⚠️",
      "- 結論：**inconclusive**（critical 0 / major 0 / minor 0）",
      "## Findings",
      "（⛔ inconclusive — 全數 reviewer 失敗）",
    ].join("\n");
    const meta = parseReport("x.md", md);
    expect(meta.decision).toBe("inconclusive");
    expect(meta.counts).toEqual({ critical: 0, major: 0, minor: 0 });
    expect(meta.findings).toEqual([]);
  });

  it("空字串 / 完全非 report 格式 → 所有欄位回 null 或空，不 throw", () => {
    const meta = parseReport("empty.md", "");
    expect(meta.at).toBeNull();
    expect(meta.range).toBeNull();
    expect(meta.decision).toBeNull();
    expect(meta.counts).toBeNull();
    expect(meta.findings).toEqual([]);
    expect(meta.reviewers).toEqual([]);
    expect(meta.runnerFormat).toBe(false);
  });

  it("缺時間欄位但有 mtimeMs → at fallback 成 mtime 的 ISO 字串", () => {
    const mtime = Date.parse("2026-10-01T00:00:00.000Z");
    const md = ["- Range：`HEAD~1..HEAD`", "- Reviewers：`m/a`"].join("\n");
    const meta = parseReport("x.md", md, mtime);
    expect(meta.at).toBe(new Date(mtime).toISOString());
    expect(meta.range).toBe("HEAD~1..HEAD");
  });

  it("缺時間欄位且無 mtimeMs → at 為 null（不硬猜）", () => {
    const meta = parseReport("x.md", "- Reviewers：`m/a`");
    expect(meta.at).toBeNull();
  });

  it("Reviewers 行含錯誤標記 ⚠️ → 只抽出反引號內的 model 名", () => {
    const md = "- Reviewers：`zai/glm-5.1` ⚠️、`anthropic/claude-4.5`";
    const meta = parseReport("x.md", md);
    expect(meta.reviewers).toEqual(["zai/glm-5.1", "anthropic/claude-4.5"]);
  });

  it("結論行格式異常（缺 severity 括號）→ decision/counts 皆 null，不 throw", () => {
    const md = "- 結論：**request-changes**";
    const meta = parseReport("x.md", md);
    expect(meta.decision).toBeNull();
    expect(meta.counts).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. route 整合 — LIST / REPORT 端點 HTTP 行為
// ═══════════════════════════════════════════════════════════════════
describe("GET /api/coding-review-board/list", () => {
  it("缺 path 參數 → 400 Missing path", async () => {
    const { status, json } = await callRoute("GET", "/api/coding-review-board/list");
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/Missing path/);
  });

  it("目錄不存在 → 200 exists:false、空陣列、latest:null", async () => {
    const { status, json } = await callRoute("GET", `/api/coding-review-board/list?path=${encodeURIComponent(PROJECT)}`);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, exists: false, reports: [], latest: null });
  });

  it("多份 report → 依檔名（時間前綴）新→舊排序，count/latest 正確", async () => {
    seedReport(PROJECT, "2026-10-17T01-00-00.md", FULL_REPORT);
    seedReport(PROJECT, "2026-10-17T02-00-00.md", FULL_REPORT.replace("2026-10-17T01:54:33.000Z", "2026-10-17T02:00:00.000Z"));
    seedReport(PROJECT, "2026-10-17T03-00-00.md", FULL_REPORT.replace("2026-10-17T01:54:33.000Z", "2026-10-17T03:00:00.000Z"));
    const { status, json } = await callRoute("GET", `/api/coding-review-board/list?path=${encodeURIComponent(PROJECT)}`);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.exists).toBe(true);
    expect(json.count).toBe(3);
    // 最新在前
    expect(json.reports[0].file).toBe("2026-10-17T03-00-00.md");
    expect(json.reports[2].file).toBe("2026-10-17T01-00-00.md");
    expect(json.latest.file).toBe("2026-10-17T03-00-00.md");
  });

  it("非 .md 檔被忽略（只列 .md）", async () => {
    seedReport(PROJECT, "2026-10-17T01-00-00.md", FULL_REPORT);
    const rbDir = join(PROJECT, ".paaw", "review-board");
    writeFileSync(join(rbDir, "notes.txt"), "should be ignored", "utf8");
    writeFileSync(join(rbDir, "raw.json"), "{}", "utf8");
    const { json } = await callRoute("GET", `/api/coding-review-board/list?path=${encodeURIComponent(PROJECT)}`);
    expect(json.count).toBe(1);
    expect(json.reports.every(r => r.file.endsWith(".md"))).toBe(true);
  });
});

describe("GET /api/coding-review-board/report", () => {
  it("缺 path 參數 → 400 Missing path", async () => {
    const { status, json } = await callRoute("GET", "/api/coding-review-board/report?file=x.md");
    expect(status).toBe(400);
    expect(json.error).toMatch(/Missing path/);
  });

  it("缺 file 參數 → 400 Invalid file", async () => {
    const { status, json } = await callRoute("GET", `/api/coding-review-board/report?path=${encodeURIComponent(PROJECT)}`);
    expect(status).toBe(400);
    expect(json.error).toMatch(/Invalid file/);
  });

  it("合法檔名 → 200 回傳全文 markdown（與檔案內容一字不差）", async () => {
    seedReport(PROJECT, "2026-10-17T01-54-33.md", FULL_REPORT);
    const { status, json } = await callRoute(
      "GET",
      `/api/coding-review-board/report?path=${encodeURIComponent(PROJECT)}&file=2026-10-17T01-54-33.md`,
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.file).toBe("2026-10-17T01-54-33.md");
    expect(json.content).toBe(FULL_REPORT);
  });

  it("檔案不存在 → 404 Not found", async () => {
    seedReport(PROJECT, "2026-10-17T01-54-33.md", FULL_REPORT);
    const { status, json } = await callRoute(
      "GET",
      `/api/coding-review-board/report?path=${encodeURIComponent(PROJECT)}&file=does-not-exist.md`,
    );
    expect(status).toBe(404);
    expect(json.error).toMatch(/Not found/);
  });

  it("路徑遍歷防護：file 含 ../ → 400 Invalid file（不得讀專案外檔案）", async () => {
    for (const attack of ["../secret.md", "../../etc/passwd.md", "sub/dir.md", "..\\win.md"]) {
      const { status, json } = await callRoute(
        "GET",
        `/api/coding-review-board/report?path=${encodeURIComponent(PROJECT)}&file=${encodeURIComponent(attack)}`,
      );
      expect(status, `attack="${attack}" 應被拒`).toBe(400);
      expect(json.error).toMatch(/Invalid file/);
    }
  });

  it("非 .md 檔名（如 payload.txt）→ 400 Invalid file", async () => {
    const { status } = await callRoute(
      "GET",
      `/api/coding-review-board/report?path=${encodeURIComponent(PROJECT)}&file=${encodeURIComponent("payload.txt")}`,
    );
    expect(status).toBe(400);
  });

  it("未知路徑（非 list/report）→ 回 false 交由後續路由處理", async () => {
    const { req, res } = makeReqRes("GET", `/api/coding-review-board/unknown`);
    const ret = await reviewBoardRoutes(req, res);
    expect(ret).toBe(false);
    expect(res.statusCode).toBeNull(); // 未寫入任何回應
  });
});
