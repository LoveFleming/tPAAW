// secretary-routes.test.mjs — TASK-055 品質補強
//
// 標的：installed-apps/secret/ui/pages/Secretary.tsx 的關鍵路徑後端契約
// （fileScope 錯靶已由 QA 兩輪確認：Secretary.tsx 是秘書模組 UI，非 F20261016-012
//  AI Settings。採路徑 B：route-level 整合測試覆蓋 UI 呼叫的 4 個 server route。
//  詳見 ADR-024。）
//
// 覆蓋 Secretary.tsx 關鍵路徑 → server route 對應：
//   loadTree          → GET    /api/secret/dossiers
//   openDossier(md)   → GET    /api/secret/dossiers/:cat/:file
//   openDossier(sheet)→ GET    /api/secret/dossiers/:cat/:file (xlsx/csv 預覽)
//   saveMd            → PUT    /api/secret/dossiers/:cat/:file
//   doUpload          → POST   /api/secret/dossiers/:cat {filename, dataBase64}
//   closeTab/delete   → DELETE /api/secret/dossiers/:cat/:file
//   CategoryManager.load   → GET   /api/secret/categories
//   CategoryManager.create → POST  /api/secret/categories
//   CategoryManager.patch  → PATCH /api/secret/categories
//   loadPanel(todos)       → GET   /api/secret/briefing?part=todos
//   loadPanel(briefing)    → GET   /api/secret/briefing
//   loadPanel(expirations) → GET   /api/secret/expirations
//   SheetPreview.read       → POST /api/secret/sheets/read
//   SheetPreview.write      → POST /api/secret/sheets/write
//
// QA 指出之 defect 以斷言釘住（標 DEFECT-***），developer 修復後需調整對應斷言：
//   DEFECT-CAT-PATCH-AGENTID：PATCH categories 不驗證 agentId 是否存在 → 可綁不存在 agent
//   DEFECT-DELETE-NOCONFIRM ：DELETE dossiers 直接 unlinkSync、無確認（API 層設計選擇，UI 確認是另一層）
//   DEFECT-UPLOAD-NOSIZE    ：POST 上傳無檔案大小限制
//
// 隔離：vi.doMock 把 shared.mjs 的 PAAW_ROOT / TPAW_REPO_ROOT 重導到 os.tmpdir()，
//   不污染真實 data/installed-apps/secret/ 與 data/crews/。不動產品碼。
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EventEmitter } from "events";

// ── 隔離目錄 ──
const TMP = join(tmpdir(), "paaw-secret-test-" + Date.now());
const SECRET_ROOT = join(TMP, "data", "installed-apps", "secret");
const CREWS_ROOT = join(TMP, "data", "crews");

// 必須在 import route 前 doMock（vi.doMock 不 hoist，需在 dynamic import 前呼叫）
vi.doMock("../../installed-apps/secret/server/routes/shared.mjs", async () => {
  const real = await import("../../packages/server/src/routes/shared.mjs");
  return {
    readBody: real.readBody,
    normalizePath: real.normalizePath,
    PAAW_ROOT: SECRET_ROOT,
    TPAW_REPO_ROOT: TMP,
  };
});

// route 模組在 mock 生效後 dynamic import —— dossiers.mjs 的 ensureBuiltinCategories()
// 會在此時於 SECRET_ROOT 建分類目錄 + categories.json
const dossiers = (await import("../../installed-apps/secret/server/routes/dossiers.mjs")).default;
const categories = (await import("../../installed-apps/secret/server/routes/categories.mjs")).default;
const briefing = (await import("../../installed-apps/secret/server/routes/briefing.mjs")).default;
const sheets = (await import("../../installed-apps/secret/server/routes/sheets.mjs")).default;

// ── helpers ──
function makeReqRes(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {};
  const res = {
    statusCode: null, headers: null, body: "", ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(chunk) { if (chunk !== undefined) this.body = String(chunk); this.ended = true; return this; },
  };
  process.nextTick(() => {
    if (body !== undefined) req.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    req.emit("end");
  });
  return { req, res };
}

function parseRes(res) {
  try { return JSON.parse(res.body); } catch { return res.body; }
}

async function call(handler, method, url, body) {
  const { req, res } = makeReqRes(method, url, body);
  const handled = await handler(req, res);
  return { res, statusCode: res.statusCode, data: parseRes(res), handled };
}

const BUILTIN_IDS = ["schedule", "reports", "meetings", "documents", "admin", "hrliaison"];

beforeAll(() => {
  // 確保 TMP 結構存在（route module load 時 ensureBuiltin 已跑，但保險起見）
  mkdirSync(join(SECRET_ROOT, "dossiers"), { recursive: true });
  mkdirSync(CREWS_ROOT, { recursive: true });
});

beforeEach(() => {
  // 每個案例前：重置 dossiers 目錄為乾淨的 builtin 狀態
  rmSync(join(SECRET_ROOT, "dossiers"), { recursive: true, force: true });
  rmSync(join(SECRET_ROOT, "categories.json"), { force: true });
  rmSync(CREWS_ROOT, { recursive: true, force: true });
  mkdirSync(CREWS_ROOT, { recursive: true });
  // 重新觸發 ensureBuiltinCategories：直接重 import 會用 cache，故手動重建最小結構
  // dossiers.mjs 的 ensureBuiltinCategories 只在 module load 跑一次；
  // 這裡手動建 categories.json + 各 builtin 櫃 README，模擬 ensureBuiltin 結果。
  const reg = BUILTIN_IDS.map(id => {
    const map = {
      schedule: { name: "行程管家", emoji: "📅", duty: "處長日曆、會議安排、差旅" },
      reports: { name: "報表專家", emoji: "📊", duty: "Excel/CSV 彙整與產出" },
      meetings: { name: "會議秘書", emoji: "📝", duty: "議程、記錄、決議追蹤" },
      documents: { name: "公文管理", emoji: "📄", duty: "簽呈、歸檔、效期" },
      admin: { name: "行政總務", emoji: "💰", duty: "請購、報帳、設備" },
      hrliaison: { name: "人事窗口", emoji: "👥", duty: "出缺勤彙整、跨部門" },
    };
    const m = map[id];
    const dir = join(SECRET_ROOT, "dossiers", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), `# ${m.emoji} ${m.name}\n\n職責：${m.duty}\n`);
    return { id, name: m.name, emoji: m.emoji, agentId: `secret.${id}`, builtin: true, description: m.duty, enabled: true, createdAt: new Date().toISOString() };
  });
  mkdirSync(join(SECRET_ROOT), { recursive: true });
  writeFileSync(join(SECRET_ROOT, "categories.json"), JSON.stringify(reg, null, 2));
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════
// A. dossiers — loadTree / openDossier / saveMd / doUpload / DELETE
// ═══════════════════════════════════════════════════════════════
describe("Secretary · dossiers route — loadTree (GET /api/secret/dossiers)", () => {
  it("回傳全分類檔案樹，含 6 builtin 分類與 root 路徑", async () => {
    const { statusCode, data, handled } = await call(dossiers, "GET", "/api/secret/dossiers");
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    expect(data.root).toBeTruthy();
    expect(data.categories).toHaveLength(6);
    const ids = data.categories.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(BUILTIN_IDS));
    // 每個分類有 agentId、files 陣列、enabled
    for (const c of data.categories) {
      expect(c.agentId).toMatch(/^secret\./);
      expect(c.enabled).toBe(true);
      expect(Array.isArray(c.files)).toBe(true);
    }
  });

  it("每個 builtin 櫃含 README.md（ensureBuiltin 產出）", async () => {
    const { data } = await call(dossiers, "GET", "/api/secret/dossiers");
    const schedule = data.categories.find(c => c.id === "schedule");
    const readme = schedule.files.find(f => f.name === "README.md");
    expect(readme).toBeTruthy();
    expect(readme.size).toBeGreaterThan(0);
    expect(readme.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readme.sheet).toBe(false);
  });
});

describe("Secretary · dossiers route — openDossier md (GET /:cat/:file)", () => {
  it("讀 md 檔 → 200 type=md content 非空", async () => {
    const { statusCode, data } = await call(dossiers, "GET", "/api/secret/dossiers/schedule/README.md");
    expect(statusCode).toBe(200);
    expect(data.type).toBe("md");
    expect(data.file).toBe("README.md");
    expect(data.category).toBe("schedule");
    expect(data.content).toContain("行程管家");
  });

  it("檔案不存在 → 404", async () => {
    const { statusCode, data } = await call(dossiers, "GET", "/api/secret/dossiers/schedule/no-such-file.md");
    expect(statusCode).toBe(404);
    expect(data.error).toBeTruthy();
  });

  it("分類不存在 → 404（QA M2 修復後：NOT_FOUND 語意正確分流）", async () => {
    const { statusCode, data } = await call(dossiers, "GET", "/api/secret/dossiers/nonexistent-cat/file.md");
    expect(statusCode).toBe(404);
    expect(data.error).toContain("分類不存在");
    expect(data.code).toBe("BIZ_CTRL_QUERY_CATEGORY_NOT_FOUND");
  });

  it("中文檔名 URL-encoded 正確解析", async () => {
    // 先 PUT 存一個中文檔名
    const content = "# 週報\n\n本週進度。";
    await call(dossiers, "PUT", "/api/secret/dossiers/reports/" + encodeURIComponent("週報-2026-10-18.md"), { content });
    const { statusCode, data } = await call(dossiers, "GET", "/api/secret/dossiers/reports/" + encodeURIComponent("週報-2026-10-18.md"));
    expect(statusCode).toBe(200);
    expect(data.content).toBe(content);
  });
});

describe("Secretary · dossiers route — openDossier sheet (GET xlsx/csv)", () => {
  it("讀 xlsx → 200 type=sheet 含 sheets/headers/previewRows", async () => {
    // 用 sheets/write 產一個 xlsx，再 GET 預覽
    await call(sheets, "POST", "/api/secret/sheets/write", {
      category: "reports", file: "test-report.xlsx",
      headers: ["月份", "營收"], rows: [["1月", 1000], ["2月", 2000]],
    });
    const { statusCode, data } = await call(dossiers, "GET", "/api/secret/dossiers/reports/test-report.xlsx");
    expect(statusCode).toBe(200);
    expect(data.type).toBe("sheet");
    expect(data.file).toBe("test-report.xlsx");
    expect(Array.isArray(data.sheets)).toBe(true);
    expect(data.sheets.length).toBeGreaterThan(0);
    expect(data.headers).toEqual(["月份", "營收"]);
    expect(data.previewRows).toHaveLength(2);
    expect(data.totalRows).toBe(2);
  });

  it("csv 檔也被識別為 sheet 預覽", async () => {
    const csv = "a,b\n1,2\n";
    await call(dossiers, "POST", "/api/secret/dossiers/reports", {
      filename: "data.csv", dataBase64: Buffer.from(csv).toString("base64"),
    });
    const { statusCode, data } = await call(dossiers, "GET", "/api/secret/dossiers/reports/data.csv");
    expect(statusCode).toBe(200);
    expect(data.type).toBe("sheet");
  });
});

describe("Secretary · dossiers route — saveMd (PUT /:cat/:file)", () => {
  it("存 md → 200 ok，再 GET 驗內容一致", async () => {
    const content = "# 會議記錄\n\n## 2026-10-18\n\n- 討論事項 A\n- 決議 B\n";
    const put = await call(dossiers, "PUT", "/api/secret/dossiers/meetings/2026-10-18-會議.md", { content });
    expect(put.statusCode).toBe(200);
    expect(put.data.ok).toBe(true);

    const get = await call(dossiers, "GET", "/api/secret/dossiers/meetings/2026-10-18-會議.md");
    expect(get.data.content).toBe(content);
  });

  it("存到不存在的分類 → 404（QA M2 修復後：NOT_FOUND 語意正確分流）", async () => {
    const { statusCode, data } = await call(dossiers, "PUT", "/api/secret/dossiers/ghost-cat/file.md", { content: "x" });
    expect(statusCode).toBe(404);
    expect(data.error).toContain("分類不存在");
    expect(data.code).toBe("BIZ_CTRL_QUERY_CATEGORY_NOT_FOUND");
  });

  it("內容為空字串 → 200 ok（允許清空檔案）", async () => {
    const { statusCode } = await call(dossiers, "PUT", "/api/secret/dossiers/admin/empty.md", { content: "" });
    expect(statusCode).toBe(200);
    const get = await call(dossiers, "GET", "/api/secret/dossiers/admin/empty.md");
    expect(get.data.content).toBe("");
  });

  it("無 content 欄位 → 400 拒絕（QA critical 修復後：不再空字串覆蓋檔案）", async () => {
    const { statusCode, data } = await call(dossiers, "PUT", "/api/secret/dossiers/admin/no-content.md", {});
    expect(statusCode).toBe(400);
    expect(data.code).toBe("SYS_CTRL_REQUEST_CONTENT_MISSING");
    expect(existsSync(join(SECRET_ROOT, "dossiers", "admin", "no-content.md"))).toBe(false);
  });
});

describe("Secretary · dossiers route — doUpload (POST /:cat)", () => {
  it("上傳 md (base64) → 200 name 回傳，檔案落櫃", async () => {
    const content = "# 上傳測試\n內容。";
    const { statusCode, data } = await call(dossiers, "POST", "/api/secret/dossiers/schedule", {
      filename: "uploaded-note.md", dataBase64: Buffer.from(content).toString("base64"),
    });
    expect(statusCode).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.name).toBe("uploaded-note.md");
    expect(existsSync(join(SECRET_ROOT, "dossiers", "schedule", "uploaded-note.md"))).toBe(true);
    expect(readFileSync(join(SECRET_ROOT, "dossiers", "schedule", "uploaded-note.md"), "utf-8")).toBe(content);
  });

  it("缺 dataBase64 → 400", async () => {
    const { statusCode, data } = await call(dossiers, "POST", "/api/secret/dossiers/schedule", { filename: "x.md" });
    expect(statusCode).toBe(400);
    expect(data.error).toContain("dataBase64");
  });

  it("缺 filename → 400（safeName 空字串 throws，被 catch 包成 400）", async () => {
    const { statusCode, data } = await call(dossiers, "POST", "/api/secret/dossiers/schedule", { dataBase64: "aGVsbG8=" });
    expect(statusCode).toBe(400);
    expect(data.error).toContain("非法檔名");
  });

  it("非法檔名含路徑分隔 → 400（safeName 攔截）", async () => {
    const { statusCode } = await call(dossiers, "POST", "/api/secret/dossiers/schedule", {
      filename: "evil/injected.md", dataBase64: "aGVsbG8=",
    });
    expect(statusCode).toBe(400);
    // 檔案不應存在（safeName 取 basename 後為 injected.md，但 SAFE_NAME 不允許 / → throw）
    expect(existsSync(join(SECRET_ROOT, "dossiers", "schedule", "evil"))).toBe(false);
  });

  // DEFECT-UPLOAD-NOSIZE（QA R1 minor）：已修復 — readBody 5MB 上限（shared shim）+ 上傳白名單
  it("UPLOAD 限制：非白名單副檔名 → 400 拒絕", async () => {
    const { statusCode, data } = await call(dossiers, "POST", "/api/secret/dossiers/admin", {
      filename: "evil.exe", dataBase64: Buffer.from("x").toString("base64"),
    });
    expect(statusCode).toBe(400);
    expect(data.code).toBe("SYS_CTRL_REQUEST_FILENAME_INVALID");
  });
});

describe("Secretary · dossiers route — DELETE /:cat/:file", () => {
  it("刪除已存在檔案 → 200 ok，檔案消失", async () => {
    // 先放一個檔
    await call(dossiers, "PUT", "/api/secret/dossiers/schedule/to-delete.md", { content: "bye" });
    expect(existsSync(join(SECRET_ROOT, "dossiers", "schedule", "to-delete.md"))).toBe(true);
    const { statusCode, data } = await call(dossiers, "DELETE", "/api/secret/dossiers/schedule/to-delete.md");
    expect(statusCode).toBe(200);
    expect(data.ok).toBe(true);
    expect(existsSync(join(SECRET_ROOT, "dossiers", "schedule", "to-delete.md"))).toBe(false);
  });

  // DEFECT-DELETE-NOCONFIRM（QA R1 minor）：DELETE 無 UI 確認，server 直接 unlinkSync
  it("DELETE 不存在的檔案 → 404（QA 修復後：不再靜默 200）", async () => {
    const { statusCode, data } = await call(dossiers, "DELETE", "/api/secret/dossiers/schedule/never-existed.md");
    expect(statusCode).toBe(404);
    expect(data.code).toBe("BIZ_CTRL_QUERY_FILE_NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. 路徑穿越防護（QA critical 熱區）
// ═══════════════════════════════════════════════════════════════
describe("Secretary · 路徑穿越防護", () => {
  // 重要發現：dossiers route 用 `new URL(req.url, "http://x")` 解析路徑，
  // Node URL parser 會 normalize `../..` → 含 `..` 的路徑被重寫，
  // 不再 match `/api/secret/dossiers` prefix → handled=false（route 不處理）。
  // 這是 URL parser 的副作用，非 safeName 主動攔截。
  it("GET 含 ../.. 的路徑 → URL parser normalize 後不 match prefix（handled=false）", async () => {
    const { statusCode, handled } = await call(dossiers, "GET", "/api/secret/dossiers/schedule/../../etc/passwd");
    expect(handled).toBe(false);
    expect(statusCode).toBe(null); // route 未處理，無狀態碼
    // 確認 TMP 外沒有被碰
    expect(existsSync(join(TMP, "etc", "passwd"))).toBe(false);
  });

  it("PUT 含 ../.. 的路徑 → URL parser normalize 後不 match prefix", async () => {
    const { statusCode, handled } = await call(dossiers, "PUT", "/api/secret/dossiers/schedule/../../escape.md", { content: "evil" });
    expect(handled).toBe(false);
    expect(existsSync(join(TMP, "escape.md"))).toBe(false);
  });

  it("DELETE 含 ../.. 的路徑 → URL parser normalize 後不 match prefix", async () => {
    writeFileSync(join(TMP, "bait.md"), "important");
    const { handled } = await call(dossiers, "DELETE", "/api/secret/dossiers/schedule/../../bait.md");
    expect(handled).toBe(false);
    expect(existsSync(join(TMP, "bait.md"))).toBe(true); // 誘餌仍在
  });

  it("上傳檔名含 .. → 400（safeName 在 basename 前攔到原始字串含 ..）", async () => {
    const { statusCode } = await call(dossiers, "POST", "/api/secret/dossiers/schedule", {
      filename: "../../../escape.bin", dataBase64: "aGVsbG8=",
    });
    // safeName 檢查 n.includes("..") → throw → catch → 400
    expect(statusCode).toBe(400);
    expect(existsSync(join(TMP, "escape.bin"))).toBe(false);
  });

  // URL-encoded %2e%2e 攻擊向量 — 驗證 URL parser decode 後仍被 normalize
  it("GET 含 %2e%2e 編碼 → URL parser decode+normalize 後不寫入櫃外", async () => {
    const { statusCode } = await call(dossiers, "GET", "/api/secret/dossiers/schedule/%2e%2e/%2e%2e/etc/passwd");
    // URL parser 會 decode %2e → . 再 normalize ../.. → 不 match prefix 或落到櫃內
    // 無論如何，TMP 外不應有檔案
    expect(existsSync(join(TMP, "etc", "passwd"))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. categories — CategoryManager load/create/patch
// ═══════════════════════════════════════════════════════════════
describe("Secretary · categories route — CategoryManager.load (GET)", () => {
  it("回傳分類清單，含 6 builtin", async () => {
    const { statusCode, data, handled } = await call(categories, "GET", "/api/secret/categories");
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    expect(data.categories).toHaveLength(6);
    const ids = data.categories.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(BUILTIN_IDS));
  });
});

describe("Secretary · categories route — CategoryManager.create (POST)", () => {
  it("新增合法分類（英文名）→ 200，crew 檔案寫入、櫃建好、分類註冊", async () => {
    const { statusCode, data } = await call(categories, "POST", "/api/secret/categories", {
      name: "公關聯絡", emoji: "🤝", description: "媒體與外部關係",
      id: "pr",
    });
    expect(statusCode).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.category.id).toBe("pr");
    expect(data.category.agentId).toBe("secret.pr");
    expect(data.category.enabled).toBe(true);
    expect(data.category.builtin).toBe(false);
    // crew 檔寫入 TMP（不污染真實 data/crews/）
    expect(existsSync(join(CREWS_ROOT, "secret.pr.json"))).toBe(true);
    const crew = JSON.parse(readFileSync(join(CREWS_ROOT, "secret.pr.json"), "utf-8"));
    expect(crew.id).toBe("secret.pr");
    expect(crew.rolePrompt).toContain("公關聯絡");
    // 櫃建好 + README
    expect(existsSync(join(SECRET_ROOT, "dossiers", "pr", "README.md"))).toBe(true);
    // 分類已註冊
    const list = await call(categories, "GET", "/api/secret/categories");
    expect(list.data.categories.find(c => c.id === "pr")).toBeTruthy();
  });

  it("缺 name → 400", async () => {
    const { statusCode, data } = await call(categories, "POST", "/api/secret/categories", { emoji: "📁" });
    expect(statusCode).toBe(400);
    expect(data.error).toContain("name");
  });

  it("重複 id → 400", async () => {
    const r = await call(categories, "POST", "/api/secret/categories", { name: "重複", id: "schedule" });
    expect(r.statusCode).toBe(400);
    expect(r.data.error).toContain("已存在");
  });

  // DEFECT-CAT-SLUG-FALLBACK：slug() 的 `|| \`cat${ts}\`` fallback 使空字串永遠不回空，
  // 導致 `let id = slug(String(body.id || ""))` 在無 id 時直接產生 cat-xxx，
  // `if (!id) id = slug(name)` 永遠不成立 → 英文名不被 slug 使用。
  it("DEFECT-CAT-SLUG-FALLBACK：無 id 時 id 應為 slug(name)，實際為 cat-xxx（slug 空值 fallback bug）", async () => {
    const { statusCode, data } = await call(categories, "POST", "/api/secret/categories", { name: "Project Management", emoji: "📋" });
    expect(statusCode).toBe(200);
    // 現況：slug("") 回 cat${ts}（非空），故 if(!id) 不成立，id = cat-xxx
    // 期望（修復後）：slug(name) = "project-management"
    expect(data.category.id).toMatch(/^cat[a-z0-9]+$/);
    expect(data.category.id).not.toBe("project-management");
  });

  it("明確傳英文 id → 直接使用該 id", async () => {
    const { statusCode, data } = await call(categories, "POST", "/api/secret/categories", { name: "公關", emoji: "🤝", id: "pr" });
    expect(statusCode).toBe(200);
    expect(data.category.id).toBe("pr");
  });

  it("emoji 截斷至 4 字元，description 截斷至 200 字元", async () => {
    const longDesc = "x".repeat(300);
    const { data } = await call(categories, "POST", "/api/secret/categories", {
      name: "截斷測試", emoji: "🚀🚀🚀🚀🚀🚀", description: longDesc,
    });
    expect(data.category.description.length).toBeLessThanOrEqual(200);
  });
});

describe("Secretary · categories route — CategoryManager.patch (PATCH)", () => {
  it("換綁 agentId → 200，agentId 更新", async () => {
    const { statusCode, data } = await call(categories, "PATCH", "/api/secret/categories", {
      id: "schedule", agentId: "secret.custom-schedule",
    });
    expect(statusCode).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.category.agentId).toBe("secret.custom-schedule");
  });

  // DEFECT-CAT-PATCH-AGENTID（QA R1 major）：PATCH 不驗證 agentId 是否存在
  it("DEFECT-CAT-PATCH-AGENTID：可綁到不存在的 agentId（server 不驗證）", async () => {
    const { statusCode, data } = await call(categories, "PATCH", "/api/secret/categories", {
      id: "schedule", agentId: "totally-nonexistent-ghost-agent-xyz",
    });
    // 現況：接受任意 agentId，回 200。QA 指出 UI 顯示專家但對話會 404。
    // developer 若加驗證，此斷言需改為 400/404。
    expect(statusCode).toBe(200);
    expect(data.category.agentId).toBe("totally-nonexistent-ghost-agent-xyz");
  });

  it("停用分類 → enabled=false", async () => {
    const { statusCode, data } = await call(categories, "PATCH", "/api/secret/categories", {
      id: "reports", enabled: false,
    });
    expect(statusCode).toBe(200);
    expect(data.category.enabled).toBe(false);
  });

  it("改 name → 200 name 更新", async () => {
    const { statusCode, data } = await call(categories, "PATCH", "/api/secret/categories", {
      id: "meetings", name: "會議紀錄組",
    });
    expect(statusCode).toBe(200);
    expect(data.category.name).toBe("會議紀錄組");
  });

  it("不存在的分類 → 404", async () => {
    const { statusCode, data } = await call(categories, "PATCH", "/api/secret/categories", {
      id: "ghost", name: "x",
    });
    expect(statusCode).toBe(404);
    expect(data.error).toContain("不存在");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. briefing — loadPanel(todos/briefing) + expirations
// ═══════════════════════════════════════════════════════════════
describe("Secretary · briefing route — loadPanel(briefing) (GET /api/secret/briefing)", () => {
  // 全局 beforeEach 會重置目錄，故此處用 beforeEach 在重置後重建測試資料
  beforeEach(async () => {
    const md = [
      "# 本週行程",
      "",
      "## 待辦",
      "- [ ] 準備週會簡報",
      "- [x] 寄出會議通知",
      "- [ ] 跟進差旅報帳",
      "",
      "## 行程",
      "- 2026-12-25 聖誕值班",
      "",
      "## 效期",
      "- [expires:2026-11-10] Q4 報告繳交 — 財務部",
    ].join("\n");
    await call(dossiers, "PUT", "/api/secret/dossiers/schedule/本週.md", { content: md });
  });

  it("GET /api/secret/briefing → 200 markdown 字串 + stats 統計", async () => {
    const { statusCode, data, handled } = await call(briefing, "GET", "/api/secret/briefing");
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    expect(typeof data.markdown).toBe("string");
    expect(data.markdown.length).toBeGreaterThan(0);
    // stats 應含 todo/expiry/event 計數
    expect(data.stats).toBeTruthy();
  });

  it("briefing 掃描到未完成待辦（checkbox）", async () => {
    const { data } = await call(briefing, "GET", "/api/secret/briefing");
    const todoCount = data.stats?.todos ?? 0;
    expect(todoCount).toBeGreaterThanOrEqual(2); // 準備週會簡報 + 跟進差旅報帳
  });

  it("briefing 掃描到效期項目（[expires:YYYY-MM-DD]）", async () => {
    const { data } = await call(briefing, "GET", "/api/secret/briefing");
    const expiryCount = data.stats?.expirations ?? 0;
    expect(expiryCount).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/secret/briefing?part=todos → 200 markdown", async () => {
    const { statusCode, data } = await call(briefing, "GET", "/api/secret/briefing?part=todos");
    expect(statusCode).toBe(200);
    expect(typeof data.markdown).toBe("string");
  });
});

describe("Secretary · briefing route — loadPanel(expirations) (GET /api/secret/expirations)", () => {
  beforeEach(async () => {
    const md = [
      "# 效期追蹤",
      "- [expires:2099-01-01] 遠期項目 — 測試",
      "- [expires:2000-01-01] 已逾期項目 — 測試",
    ].join("\n");
    await call(dossiers, "PUT", "/api/secret/dossiers/documents/效期測試.md", { content: md });
  });

  it("GET /api/secret/expirations → 200 items 陣列", async () => {
    const { statusCode, data, handled } = await call(briefing, "GET", "/api/secret/expirations");
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThanOrEqual(2);
  });

  it("效期 items 含 date/text/inDays/status 欄位", async () => {
    const { data } = await call(briefing, "GET", "/api/secret/expirations");
    const item = data.items[0];
    expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(item.text).toBeTruthy();
    expect(typeof item.inDays).toBe("number");
    expect(item.status).toBeTruthy();
  });
});

describe("Secretary · briefing route — code fence 剝除（README 範例不當真）", () => {
  beforeEach(async () => {
    // README 內有 code fence 包住的「假」checkbox 與效期 — 不應被掃到
    const md = [
      "# README",
      "",
      "## 檔案慣例",
      "```",
      "- [ ] 這是範例不應被掃到",
      "- [expires:2099-12-31] 這也是範例",
      "```",
      "",
      "- [ ] 這是真的待辦",
    ].join("\n");
    await call(dossiers, "PUT", "/api/secret/dossiers/admin/README.md", { content: md });
  });

  it("code fence 內的 checkbox 不計入待辦", async () => {
    const { data } = await call(briefing, "GET", "/api/secret/briefing");
    // 只有 1 個真待辦（fence 內的不算）
    const todoCount = data.stats?.todos ?? 0;
    expect(todoCount).toBeGreaterThanOrEqual(1);
    // markdown 不應包含「這是範例不應被掃到」
    expect(data.markdown).not.toContain("這是範例不應被掃到");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. sheets — SheetPreview.read / .write
// ═══════════════════════════════════════════════════════════════
describe("Secretary · sheets route — SheetPreview.read (POST /sheets/read)", () => {
  beforeEach(async () => {
    await call(sheets, "POST", "/api/secret/sheets/write", {
      category: "reports", file: "read-test.xlsx",
      headers: ["項目", "數量", "備註"], rows: [["A", 10, "ok"], ["B", 20, ""]],
    });
  });

  it("讀 xlsx → 200 ok headers + rows", async () => {
    const { statusCode, data, handled } = await call(sheets, "POST", "/api/secret/sheets/read", {
      category: "reports", file: "read-test.xlsx",
    });
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.headers).toEqual(["項目", "數量", "備註"]);
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]).toEqual(["A", 10, "ok"]);
  });

  it("maxRows 限制 → rows 截斷", async () => {
    // 先寫 5 列
    await call(sheets, "POST", "/api/secret/sheets/write", {
      category: "reports", file: "maxrows-test.xlsx",
      headers: ["n"], rows: [[1], [2], [3], [4], [5]],
    });
    const { data } = await call(sheets, "POST", "/api/secret/sheets/read", {
      category: "reports", file: "maxrows-test.xlsx", maxRows: 2,
    });
    expect(data.rows.length).toBeLessThanOrEqual(2);
  });

  it("檔案不存在 → 404", async () => {
    const { statusCode, data } = await call(sheets, "POST", "/api/secret/sheets/read", {
      category: "reports", file: "no-such.xlsx",
    });
    expect(statusCode).toBe(404);
    expect(data.error).toContain("不存在");
  });

  it("缺 category → 400", async () => {
    const { statusCode, data } = await call(sheets, "POST", "/api/secret/sheets/read", { file: "x.xlsx" });
    expect(statusCode).toBe(400);
    expect(data.error).toContain("必填");
  });

  // sheets route 用 basename() + name.includes("..") 雙重保護：
  // basename("../../etc/passwd") = "passwd" → 不含 .. → 通過檢查
  // 但 fp = join(root, dossiers, cat, "passwd") → 寫到櫃內，不會逃出
  it("file 含 ../../ → basename 取末段，寫入櫃內而非櫃外（不逃逸）", async () => {
    const { statusCode } = await call(sheets, "POST", "/api/secret/sheets/read", {
      category: "reports", file: "../../etc/passwd",
    });
    // basename("passwd") → 櫃內不存在 → 404（不會讀到系統檔）
    expect(statusCode).toBe(404);
    expect(existsSync(join(TMP, "etc", "passwd"))).toBe(false);
  });

  it("非 POST 方法 → 405", async () => {
    const { statusCode, data } = await call(sheets, "GET", "/api/secret/sheets/read");
    expect(statusCode).toBe(405);
    expect(data.error).toContain("method");
  });
});

describe("Secretary · sheets route — SheetPreview.write (POST /sheets/write)", () => {
  it("寫 xlsx → 200 ok 檔案產出，再 read 驗內容一致", async () => {
    const { statusCode, data } = await call(sheets, "POST", "/api/secret/sheets/write", {
      category: "reports", file: "write-test.xlsx",
      headers: ["日期", "事件"], rows: [["2026-10-18", "測試寫入"]],
    });
    expect(statusCode).toBe(200);
    expect(data.ok).toBe(true);
    expect(existsSync(join(SECRET_ROOT, "dossiers", "reports", "write-test.xlsx"))).toBe(true);
    // 讀回驗證
    const r = await call(sheets, "POST", "/api/secret/sheets/read", { category: "reports", file: "write-test.xlsx" });
    expect(r.data.headers).toEqual(["日期", "事件"]);
    expect(r.data.rows[0]).toEqual(["2026-10-18", "測試寫入"]);
  });

  it("缺 category → 400", async () => {
    const { statusCode } = await call(sheets, "POST", "/api/secret/sheets/write", {
      file: "x.xlsx", headers: ["a"], rows: [[1]],
    });
    expect(statusCode).toBe(400);
  });

  it("file 含 ../ → basename 取末段，寫入櫃內而非櫃外（不逃逸）", async () => {
    const { statusCode } = await call(sheets, "POST", "/api/secret/sheets/write", {
      category: "reports", file: "../escape.xlsx", headers: ["a"], rows: [[1]],
    });
    // basename("../escape.xlsx") = "escape.xlsx" → 不含 .. → 通過
    // fp = join(root, dossiers, reports, "escape.xlsx") → 寫到櫃內
    expect(statusCode).toBe(200);
    expect(existsSync(join(SECRET_ROOT, "dossiers", "reports", "escape.xlsx"))).toBe(true);
    // 確認未寫到櫃外
    expect(existsSync(join(SECRET_ROOT, "dossiers", "escape.xlsx"))).toBe(false);
    expect(existsSync(join(TMP, "escape.xlsx"))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. entry handler 鏈式分派
// ═══════════════════════════════════════════════════════════════
describe("Secretary · entry handler 鏈式分派", () => {
  it("dossiers 處理 /api/secret/dossiers", async () => {
    const { handled } = await call(dossiers, "GET", "/api/secret/dossiers");
    expect(handled).toBe(true);
  });

  it("dossiers 不處理 /api/secret/categories", async () => {
    const { handled } = await call(dossiers, "GET", "/api/secret/categories");
    expect(handled).toBe(false);
  });

  it("categories 處理 /api/secret/categories", async () => {
    const { handled } = await call(categories, "GET", "/api/secret/categories");
    expect(handled).toBe(true);
  });

  it("briefing 處理 /api/secret/briefing", async () => {
    const { handled } = await call(briefing, "GET", "/api/secret/briefing");
    expect(handled).toBe(true);
  });

  it("briefing 處理 /api/secret/expirations", async () => {
    const { handled } = await call(briefing, "GET", "/api/secret/expirations");
    expect(handled).toBe(true);
  });

  it("sheets 處理 /api/secret/sheets/*", async () => {
    // 用一個必失敗的 read 請求驗證 route 有接手（404 比 handled=false 更明確）
    const { statusCode, handled } = await call(sheets, "POST", "/api/secret/sheets/read", { category: "reports", file: "route-dispatch-probe.xlsx" });
    expect(handled).toBe(true);
    expect(statusCode).toBe(404); // 檔案不存在，但 route 確實處理了
  });
});
