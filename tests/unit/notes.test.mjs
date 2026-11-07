/**
 * F-035 筆記本管理與 AI 筆記整理 — notes.mjs 單元 / 整合測試（2026-10-17）
 *
 * 受測檔：packages/server/src/routes/notes.mjs（單檔 22 端點）
 * 資料媒介：DATA_HOME/notes/（notebooks.json、sections.json、各 notebook 目錄內單檔筆記、images/）
 *
 * 測試分兩層（沿用 TASK-049 / route-handler-api-template 慣例）：
 *   A 層（行為契約）— 綠燈。把「目前正常運作」的 API 契約釘住，防回歸。
 *   B 層（安全邊界）— 斷言路徑穿越（path traversal）應被阻擋。
 *       現況 notes.mjs 只有 DELETE /notebooks 有 sanitizeId 防護，其餘端點
 *       id 直接進 resolve()，故 B 層會以 FAIL 呈現 —— 這是「可回歸偵測的缺陷
 *       登錄」（對應 QA 報告 C1 等），tester 不改範本/實作，待 developer 修
 *       護欄後斷言自動轉綠。
 *
 * 隔離策略：
 *   1. notes.mjs 於 module-load 時由 DATA_HOME 算出 NOTES_DIR/IMAGES_DIR，
 *      而 DATA_HOME 讀 process.env.PAAW_DATA_HOME。故必須「先設 env、再動態
 *      import()」才能指向暫存目錄。
 *   2. 每個測試檔用 mkdtemp 的一次性目錄，afterAll 清除，絕不污染真實 data/。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let handleNotesRoutes;
let DATA_ROOT;
let NOTES_DIR;

// route handler 直接注入 mock req/res（不開 server）— 與 coding-handover.test.mjs 同法
function mockReq(method, url, body) {
  const bodyStr = body !== undefined ? JSON.stringify(body) : "";
  return {
    method,
    url,
    on(ev, cb) {
      if (ev === "data" && bodyStr) cb(bodyStr);
      if (ev === "end") cb();
      if (ev === "error") cb();
    },
  };
}
function mockRes() {
  const r = { code: 0, body: null, headers: null };
  r.writeHead = (c, h) => { r.code = c; if (h) r.headers = h; return r; };
  r.end = (b) => { r.body = String(b ?? ""); return r; };
  return r;
}
async function call(method, url, body) {
  const res = mockRes();
  const handled = await handleNotesRoutes(mockReq(method, url, body), res);
  return { handled, code: res.code, json: tryJson(res.body), raw: res.body, headers: res.headers };
}
function tryJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

beforeAll(async () => {
  // 1) 先建立一次性 DATA_HOME 並注入 env，再 import（時序至關重要）
  DATA_ROOT = mkdtempSync(join(tmpdir(), "paaw-notes-test-"));
  process.env.PAAW_DATA_HOME = DATA_ROOT;
  ({ default: handleNotesRoutes } = await import("../../packages/server/src/routes/notes.mjs"));
  NOTES_DIR = resolve(DATA_ROOT, "notes");
});

afterAll(() => {
  try { rmSync(DATA_ROOT, { recursive: true, force: true }); } catch {}
  delete process.env.PAAW_DATA_HOME;
});

// ════════════════════════════════════════════════════════════
// A 層：行為契約（預期全綠）
// ════════════════════════════════════════════════════════════

describe("A. Notebook (Project) CRUD", () => {
  it("GET /notebooks 首次應給預設『我的筆記』並落地 notebooks.json", async () => {
    const r = await call("GET", "/api/notes/notebooks");
    expect(r.code).toBe(200);
    expect(Array.isArray(r.json.notebooks)).toBe(true);
    expect(r.json.notebooks[0].id).toBe("default");
    expect(existsSync(join(NOTES_DIR, "notebooks.json"))).toBe(true);
  });

  it("POST /notebooks 建立後回 201 且可於 GET 見到", async () => {
    const c = await call("POST", "/api/notes/notebooks", { name: "工作", icon: "💼", color: "#111111" });
    expect(c.code).toBe(201);
    expect(c.json.ok).toBe(true);
    const nb = c.json.notebook;
    expect(nb.name).toBe("工作");

    const g = await call("GET", "/api/notes/notebooks");
    expect(g.json.notebooks.some(n => n.id === nb.id)).toBe(true);
  });

  it("PUT /notebooks 改名 / 顏色 / icon", async () => {
    const c = await call("POST", "/api/notes/notebooks", { name: "暫存" });
    const id = c.json.notebook.id;
    const u = await call("PUT", `/api/notes/notebooks?id=${id}`, { name: "改名後", color: "#ABCDEF", icon: "🔥" });
    expect(u.code).toBe(200);
    expect(u.json.notebook.name).toBe("改名後");
    expect(u.json.notebook.color).toBe("#ABCDEF");
    expect(u.json.notebook.icon).toBe("🔥");
  });

  it("PUT /notebooks 不存在的 id → 404", async () => {
    const u = await call("PUT", "/api/notes/notebooks?id=does-not-exist", { name: "x" });
    expect(u.code).toBe(404);
  });

  it("DELETE /notebooks 移除 notebook 及其目錄", async () => {
    const c = await call("POST", "/api/notes/notebooks", { name: "待刪" });
    const id = c.json.notebook.id;
    const d = await call("DELETE", `/api/notes/notebooks?id=${id}`);
    expect(d.code).toBe(200);
    expect(existsSync(resolve(NOTES_DIR, id))).toBe(false);
    const g = await call("GET", "/api/notes/notebooks");
    expect(g.json.notebooks.some(n => n.id === id)).toBe(false);
  });
});

describe("A. Section CRUD", () => {
  it("GET /sections 對空 notebook 會補一個『未分類』default", async () => {
    const r = await call("GET", "/api/notes/sections?notebook=default");
    expect(r.code).toBe(200);
    expect(r.json.sections.some(s => s.id === "default")).toBe(true);
  });

  it("POST /sections 建立後 GET 可見（same notebook）", async () => {
    const c = await call("POST", "/api/notes/sections", { notebookId: "default", name: "研究", icon: "🔬" });
    expect(c.code).toBe(201);
    const id = c.json.section.id;
    const g = await call("GET", "/api/notes/sections?notebook=default");
    expect(g.json.sections.some(s => s.id === id && s.name === "研究")).toBe(true);
  });

  it("PUT /sections 改名，不存在 → 404", async () => {
    const c = await call("POST", "/api/notes/sections", { notebookId: "default", name: "舊名" });
    const id = c.json.section.id;
    const u = await call("PUT", `/api/notes/sections?id=${id}`, { name: "新名" });
    expect(u.code).toBe(200);
    expect(u.json.section.name).toBe("新名");
    const miss = await call("PUT", "/api/notes/sections?id=nope", { name: "x" });
    expect(miss.code).toBe(404);
  });
});

describe("A. Note CRUD / list / get", () => {
  let noteId;

  it("POST /create → 201，欄位與預設值正確", async () => {
    const c = await call("POST", "/api/notes/create", {
      notebookId: "default", sectionId: "default",
      title: "第一則", content: "<p>hello</p>", tags: ["a", "b"],
    });
    expect(c.code).toBe(201);
    expect(c.json.note.title).toBe("第一則");
    expect(c.json.note.pinned).toBe(false);
    expect(c.json.note.tags).toEqual(["a", "b"]);
    noteId = c.json.note.id;
  });

  it("GET /get 取得單一筆記；不存在 → 404", async () => {
    const g = await call("GET", `/api/notes/get?id=${noteId}&notebook=default`);
    expect(g.code).toBe(200);
    expect(g.json.note.id).toBe(noteId);
    const miss = await call("GET", "/api/notes/get?id=nope&notebook=default");
    expect(miss.code).toBe(404);
  });

  it("GET /list 列出筆記（含 excerpt、coverImage 欄）", async () => {
    const l = await call("GET", "/api/notes/list?notebook=default");
    expect(l.code).toBe(200);
    const n = l.json.notes.find(x => x.id === noteId);
    expect(n).toBeTruthy();
    expect(n.title).toBe("第一則");
    expect(String(n.excerpt)).toContain("hello");
  });

  it("PUT /update 改 title/content/tags；不存在 → 404", async () => {
    const u = await call("PUT", `/api/notes/update?id=${noteId}&notebook=default`, {
      title: "改標題", content: "<p>world</p>", tags: ["z"],
    });
    expect(u.code).toBe(200);
    expect(u.json.note.title).toBe("改標題");
    expect(u.json.note.tags).toEqual(["z"]);
    const miss = await call("PUT", "/api/notes/update?id=nope&notebook=default", { title: "x" });
    expect(miss.code).toBe(404);
  });

  it("DELETE /delete 移除筆記檔（idempotent：再刪仍 200）", async () => {
    const c = await call("POST", "/api/notes/create", { notebookId: "default", title: "刪我" });
    const id = c.json.note.id;
    const d1 = await call("DELETE", `/api/notes/delete?id=${id}&notebook=default`);
    expect(d1.code).toBe(200);
    expect(existsSync(resolve(NOTES_DIR, "default", `${id}.json`))).toBe(false);
    const d2 = await call("DELETE", `/api/notes/delete?id=${id}&notebook=default`);
    expect(d2.code).toBe(200); // 不應拋錯
  });
});

describe("A. Move / Pin", () => {
  it("PUT /move 換 section 後 get 反映新 sectionId", async () => {
    const c = await call("POST", "/api/notes/create", { notebookId: "default", sectionId: "default", title: "搬移" });
    const id = c.json.note.id;
    const m = await call("PUT", `/api/notes/move?id=${id}&notebook=default`, { sectionId: "sec-target" });
    expect(m.code).toBe(200);
    const g = await call("GET", `/api/notes/get?id=${id}&notebook=default`);
    expect(g.json.note.sectionId).toBe("sec-target");
  });

  it("PUT /move 不存在 → 404", async () => {
    const m = await call("PUT", "/api/notes/move?id=nope&notebook=default", { sectionId: "x" });
    expect(m.code).toBe(404);
  });

  it("PUT /pin 切換 pinned（toggle）", async () => {
    const c = await call("POST", "/api/notes/create", { notebookId: "default", title: "釘我" });
    const id = c.json.note.id;
    const p1 = await call("PUT", `/api/notes/pin?id=${id}&notebook=default`);
    expect(p1.json.pinned).toBe(true);
    const p2 = await call("PUT", `/api/notes/pin?id=${id}&notebook=default`);
    expect(p2.json.pinned).toBe(false);
    const miss = await call("PUT", "/api/notes/pin?id=nope&notebook=default");
    expect(miss.code).toBe(404);
  });
});

describe("A. Search / Tags / By-tag / Recent", () => {
  it("GET /search 空 q → 空結果（不退搜全庫）", async () => {
    const r = await call("GET", "/api/notes/search?q=");
    expect(r.code).toBe(200);
    expect(r.json.results).toEqual([]);
  });

  it("GET /search 命中 title / content / tag", async () => {
    const c = await call("POST", "/api/notes/create", {
      notebookId: "default", title: "獨特字串ZQX", content: "<p>內文含 KeYwOrD</p>", tags: ["spezialtag"],
    });
    const id = c.json.note.id;
    const byTitle = await call("GET", "/api/notes/search?q=ZQX");
    expect(byTitle.json.results.some(x => x.id === id)).toBe(true);
    const byContent = await call("GET", "/api/notes/search?q=keyword");
    expect(byContent.json.results.some(x => x.id === id)).toBe(true);
    const byTag = await call("GET", "/api/notes/search?q=spezialtag");
    expect(byTag.json.results.some(x => x.id === id)).toBe(true);
  });

  it("GET /tags 彙整標籤與計數（依 count 降冪）", async () => {
    await call("POST", "/api/notes/create", { notebookId: "default", title: "t1", tags: ["dup"] });
    await call("POST", "/api/notes/create", { notebookId: "default", title: "t2", tags: ["dup"] });
    await call("POST", "/api/notes/create", { notebookId: "default", title: "t3", tags: ["solo"] });
    const r = await call("GET", "/api/notes/tags");
    expect(r.code).toBe(200);
    const dup = r.json.tags.find(t => t.name === "dup");
    expect(dup.count).toBeGreaterThanOrEqual(2);
    expect(r.json.tags.findIndex(t => t.name === "dup")).toBeLessThanOrEqual(
      r.json.tags.findIndex(t => t.name === "solo"),
    );
  });

  it("GET /by-tag 只回含該 tag 的筆記", async () => {
    const c = await call("POST", "/api/notes/create", { notebookId: "default", title: "byTag", tags: ["onlythis"] });
    const r = await call("GET", "/api/notes/by-tag?tag=onlythis");
    expect(r.code).toBe(200);
    expect(r.json.results.some(x => x.id === c.json.note.id)).toBe(true);
    expect(r.json.results.every(x => x.tags.includes("onlythis"))).toBe(true);
  });

  it("GET /recent?limit= 限制筆數", async () => {
    const r = await call("GET", "/api/notes/recent?limit=2");
    expect(r.code).toBe(200);
    expect(r.json.notes.length).toBeLessThanOrEqual(2);
  });
});

describe("A. Image upload / serve", () => {
  it("POST /upload-image 存檔並回可服務的 url", async () => {
    const png1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const u = await call("POST", "/api/notes/upload-image", { data: png1x1, filename: "dot.png" });
    expect(u.code).toBe(201);
    expect(u.json.ok).toBe(true);
    expect(u.json.url).toBe(`/api/notes/images/${u.json.filename}`);
    expect(existsSync(resolve(NOTES_DIR, "images", u.json.filename))).toBe(true);
  });

  it("POST /upload-image 缺 data → 400", async () => {
    const u = await call("POST", "/api/notes/upload-image", {});
    expect(u.code).toBe(400);
  });

  it("GET /images/:filename 回 200 與正確 MIME；不存在 → 404", async () => {
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const u = await call("POST", "/api/notes/upload-image", { data: `data:image/png;base64,${b64}`, filename: "pic.png" });
    const g = await call("GET", u.json.url);
    expect(g.code).toBe(200);
    expect(g.headers["Content-Type"]).toBe("image/png");
    const miss = await call("GET", "/api/notes/images/nope-xyz.png");
    expect(miss.code).toBe(404);
  });
});

describe("A. AI write 輸入驗證（不打真 LLM）", () => {
  it("content 太短 → 400（不觸發 LLM）", async () => {
    const r = await call("POST", "/api/notes/ai-write", { content: "hi" });
    expect(r.code).toBe(400);
    expect(r.json.error).toContain("短");
  });

  it("缺 content → 400", async () => {
    const r = await call("POST", "/api/notes/ai-write", { prompt: "整理" });
    expect(r.code).toBe(400);
  });
});

describe("A. Fallthrough", () => {
  it("OPTIONS 與未知路徑回 false（交還 router）", async () => {
    expect((await call("OPTIONS", "/api/notes/notebooks")).handled).toBe(false);
    expect((await call("GET", "/api/notes/unknown-xyz")).handled).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// B 層：安全邊界 —— 路徑穿越防護（缺陷登錄；綠=已修）
//
// 現況：只有 DELETE /notebooks 走 sanitizeId。其餘端點的 id 直接進
// resolve(NOTES_DIR, ...) → `../` 可逃出 notes/ 讀寫宿主任意檔（QA C1）。
// 以下斷言採「安全預期」：通過代表護欄已生效；失敗=真陽性缺陷。
// 為避免測試「實際造成破壞」，把哨兵檔放在暫存 DATA_ROOT 內（notes 的上一層），
// 只驗證「是否可穿越」，不寫危害系統的位置。
// ════════════════════════════════════════════════════════════

describe("B. Path traversal — 安全預期（現況未防護者會 FAIL，屬已知缺陷）", () => {
  const SECRET = "sentinel-outside-notes";

  beforeAll(() => {
    // 放在 NOTES_DIR 的上一層（DATA_ROOT/secret.txt），模擬 notes/ 外但可控的檔案
    writeFileSync(join(DATA_ROOT, "secret.txt"), SECRET, "utf-8");
    mkdirSync(NOTES_DIR, { recursive: true });
  });

  // ── 已防護：DELETE /notebooks（基準，應綠） ──
  it("DELETE /notebooks?id=../secret 應被 400 PATH_TRAVERSAL 阻擋（已防護）", async () => {
    const r = await call("DELETE", "/api/notes/notebooks?id=../secret");
    expect(r.code).toBe(400);
    expect(r.json && r.json.code).toBe("PATH_TRAVERSAL");
  });

  // ── 未防護端點（登錄為可回歸偵測的缺陷） ──
  it("[缺陷 C1] GET /get?id=../secret 不應讀到 notes/ 外的檔（讀不到 = 綠）", async () => {
    const r = await call("GET", "/api/notes/get?id=../secret&notebook=default");
    // 安全預期：不得成功回應 notes/ 外的內容
    const leaked = r.code === 200 && r.json && JSON.stringify(r.json).includes(SECRET);
    expect(leaked).toBe(false);
  });

  it("[缺陷 C2] GET /images/:name 不應服務 notes/images 外的檔", async () => {
    // filename 帶 ../ 試圖讀 DATA_ROOT/secret.txt
    const r = await call("GET", "/api/notes/images/../../secret.txt");
    const leaked = r.code === 200 && String(r.raw).includes(SECRET);
    expect(leaked).toBe(false);
  });

  it("[缺陷 C1] DELETE /delete?id=../secret 不應刪到 notes/ 外的檔", async () => {
    await call("POST", "/api/notes/create", { notebookId: "default", title: "x" });
    // 先確保哨兵存在
    writeFileSync(join(DATA_ROOT, "secret.txt"), SECRET, "utf-8");
    await call("DELETE", "/api/notes/delete?id=../secret&notebook=default");
    // 安全預期：哨兵檔不應被刪
    expect(existsSync(join(DATA_ROOT, "secret.txt"))).toBe(true);
  });

  it("[缺陷 C1] GET /list?notebook=../ 不應列出 notes/ 外的目錄", async () => {
    const r = await call("GET", "/api/notes/list?notebook=..");
    // 安全預期：不應洩漏 notes/ 上一層（DATA_ROOT）的檔案
    const leaked = r.code === 200 && r.json && JSON.stringify(r.json).includes("secret.txt");
    expect(leaked).toBe(false);
  });
});
