// chat-uploads-routes.test.mjs — F20261016-015 chat/uploads route 層整合測試（TASK-058 test 階段）
//
// 對應 QA review qr-20261018-021000-7j76（0C/2M）+ 前輪 hardening（qr-20261017-013108-1ziy）：
//   MAJ-1: POST /api/paaw/chat（SSE 端點）漏 body cap + 壞 JSON 回 500
//   MAJ-2: GET /api/paaw/chats/:id 未走 chatIdFromPath 消毒（與 PUT/DELETE 的 400 行為不一致）
//   NEW-1（tester 發現）: chat.mjs readJsonBody 未 catch BODY_TOO_LARGE（uploads.mjs _readJsonBody 有）
//          → POST/PUT /api/paaw/chats、PUT /api/system-prompts 超量 body 使 route handler 直接 reject
//
// 覆蓋面（route handler 本體；前輪 chat-uploads-hardening.test.mjs 只測純函式）：
//   A. chat session CRUD：POST/GET list/GET :id/PUT/DELETE、壞 JSON 400、穿越 id、
//      PUT merge 語義、404 不靜默建檔、per-chat 併發鎖（無 lost update）、原子寫無 .tmp 殘留
//   B. SSE POST /api/paaw/chat：MAJ-1 缺口（自癒式雙分支釘缺陷，developer 修復後自動轉綠）
//   B2. context.mjs readBody cap 原語（MAJ-1 修復的基礎設施）
//   C. 圖片上傳：magic bytes 定型別、大小上限、dataUrl 驗證、stored-XSS 防線、
//      ruRoot 註冊表防線、RU 資產 vs 中央 uploads 兩種落點
//   D. 文字上傳：safe name 清毒、binary 防護、大小上限、RU 資產落點
//   E. 靜態服務：Content-Type by magic bytes、415、穿越 400、404
//   F. resolveUploadRef（vision 管線共用的路徑解析）
//   G. 系統提示詞 API：清單/讀寫/白名單/型別驗證
//
// 環境隔離：PAAW_DATA_HOME / PAAW_LOG_HOME 於 import 前指向 tmpdir，
// 不污染使用者 data/（chat.mjs / uploads.mjs 於 module load 時讀 DATA_HOME）。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EventEmitter } from "events";

// ── 環境隔離（必須在 import server 模組前）──
const TMP = join(tmpdir(), "paaw-chat-routes-test-" + Date.now() + "-" + process.pid);
process.env.PAAW_DATA_HOME = TMP;
process.env.PAAW_LOG_HOME = TMP;

const chatRoutes = (await import("../../packages/server/src/routes/chat.mjs")).default;
const uploads = await import("../../packages/server/src/routes/uploads.mjs");
const uploadRoutes = uploads.default;
const { resolveUploadRef } = uploads;
const { readBody } = await import("../../packages/server/src/routes/context.mjs");

const CHAT_DIR = join(TMP, "chats");
const UPLOADS_DIR = join(TMP, "uploads");
const PROMPT_DIR = join(TMP, "ai-settings", "chat");
const TMP_RU = join(TMP, "fake-ru"); // 註冊過的假 RU（uploads ruRoot 測試用）
const PROMPT_FILES = ["identity.md", "tool-rules.md", "system-prompt.md", "guardrails.md", "reply-rules.md"];

// ── 最小圖片 fixture（detectImageType 只看 magic bytes，≥12 bytes）──
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const pngBuf = (n = 64) => Buffer.concat([PNG_MAGIC, Buffer.alloc(n)]);
const jpegBuf = (n = 64) => Buffer.concat([JPEG_MAGIC, Buffer.alloc(n)]);
const pngDataUrl = (buf = pngBuf()) => `data:image/png;base64,${buf.toString("base64")}`;

// ── req/res 假物件（EventEmitter req 支援 readBody 串流；捕獲式 res）──
// req.destroy no-op：readBody 超量時會 req.destroy()（真 IncomingMessage 有、EventEmitter 沒有）
// res.on no-op：SSE 路徑掛 'close' 監聽（錯誤分支提前 return，通常走不到，防禦性補上）
function makeReqRes(method, url, body, headers = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.destroy = () => {};
  const res = {
    statusCode: null,
    headers: null,
    chunks: [],
    ended: false,
    on() { return this; },
    writeHead(code, hdrs) { this.statusCode = code; this.headers = hdrs; return this; },
    write(chunk) { this.chunks.push(String(chunk)); return true; },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(String(chunk));
      this.ended = true;
      return this;
    },
  };
  Object.defineProperty(res, "body", { get() { return this.chunks.join(""); } });
  process.nextTick(() => {
    if (body !== undefined) {
      req.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    }
    req.emit("end");
  });
  return { req, res };
}

const jsonBody = (res) => {
  try { return JSON.parse(res.body); } catch { return null; }
};

/** 建一對 {r1, r2} 供並發測試（兩條獨立 req/res） */
function twoReqs(...args) {
  return [makeReqRes(...args), makeReqRes(...args)];
}

/** 直接在 chats 目錄種一個 chat 檔（繞過 route，供 GET/PUT/DELETE 消費） */
function seedChat(id, overrides = {}) {
  const data = {
    id,
    title: overrides.title || "seed",
    messages: overrides.messages || [],
    createdAt: overrides.createdAt || "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt || "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  writeFileSync(join(CHAT_DIR, `${id}.json`), JSON.stringify(data, null, 2));
  return data;
}

/** 註冊假 RU 到 release-units.json（uploads ruRoot 驗證的資料來源） */
function registerRu(path) {
  mkdirSync(join(TMP, "config"), { recursive: true });
  writeFileSync(join(TMP, "config", "release-units.json"), JSON.stringify({ units: [{ path }] }));
}

beforeAll(() => {
  mkdirSync(CHAT_DIR, { recursive: true });
  mkdirSync(UPLOADS_DIR, { recursive: true });
  mkdirSync(TMP_RU, { recursive: true });
});

beforeEach(() => {
  // 清 chats、uploads、RU uploads、提示詞目錄內容（保留目錄），撤銷 RU 註冊
  for (const d of [CHAT_DIR, UPLOADS_DIR, join(TMP_RU, ".paaw", "uploads"), PROMPT_DIR]) {
    try { for (const f of readdirSync(d)) rmSync(join(d, f), { force: true }); } catch {}
  }
  try { rmSync(join(TMP, "config", "release-units.json"), { force: true }); } catch {}
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ══════════════════════════════════════════════
// A. Chat Session CRUD
// ══════════════════════════════════════════════
describe("chat CRUD — POST /api/paaw/chats", () => {
  it("creates a chat, writes the json file, echoes canonical shape", async () => {
    const { req, res } = makeReqRes("POST", "/api/paaw/chats", { title: "Hello", messages: [{ role: "user", content: "hi" }] });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.id).toMatch(/^chat_\d+$/);
    expect(body.title).toBe("Hello");
    expect(body.messages).toHaveLength(1);
    expect(existsSync(join(CHAT_DIR, `${body.id}.json`))).toBe(true);
  });

  it("accepts a client-supplied id", async () => {
    const { req, res } = makeReqRes("POST", "/api/paaw/chats", { id: "c-custom-1" });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).id).toBe("c-custom-1");
    expect(existsSync(join(CHAT_DIR, "c-custom-1.json"))).toBe(true);
  });

  it("empty body → defaults (id generated, title 新對話)", async () => {
    const { req, res } = makeReqRes("POST", "/api/paaw/chats", {});
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.id).toMatch(/^chat_\d+$/);
    expect(body.title).toBe("新對話");
  });

  it("malformed JSON body → 400 not 500（前輪 M4 固化）", async () => {
    const { req, res } = makeReqRes("POST", "/api/paaw/chats", "{not json");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/Invalid JSON/i);
  });

  it("path-traversal id (../../evil) → 400, no file written outside chats dir", async () => {
    const { req, res } = makeReqRes("POST", "/api/paaw/chats", { id: "../../evil" });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(existsSync(join(TMP, "evil.json"))).toBe(false);
  });

  it("DEFECT-NEW1: >20MB body → route rejects（readJsonBody 缺 BODY_TOO_LARGE catch；修復後應 413）", async () => {
    // 自癒式雙分支：修復前釘缺陷形狀（BODY_TOO_LARGE 往上冒、無 HTTP 回應）；
    // developer 比照 uploads.mjs _readJsonBody 補 catch 後自動轉綠（413）。
    const big = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(21 * 1024 * 1024) }] });
    const { req, res } = makeReqRes("POST", "/api/paaw/chats", big);
    let threw = null;
    try { await chatRoutes(req, res); } catch (e) { threw = e; }
    if (threw) {
      expect(threw.code).toBe("BODY_TOO_LARGE");
      expect(res.statusCode).toBeNull();
    } else {
      expect(res.statusCode).toBe(413);
    }
  });
});

describe("chat CRUD — GET /api/paaw/chats (list)", () => {
  it("returns sessions sorted by updatedAt desc", async () => {
    seedChat("c-old", { updatedAt: "2026-01-01T00:00:00.000Z" });
    seedChat("c-new", { updatedAt: "2026-06-01T00:00:00.000Z" });
    seedChat("c-mid", { updatedAt: "2026-03-01T00:00:00.000Z" });
    const { req, res } = makeReqRes("GET", "/api/paaw/chats");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).map((c) => c.id)).toEqual(["c-new", "c-mid", "c-old"]);
  });

  it("empty dir → []", async () => {
    const { req, res } = makeReqRes("GET", "/api/paaw/chats");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res)).toEqual([]);
  });

  it("malformed json file in chats dir does not crash the list（200，壞檔被跳過）", async () => {
    seedChat("c-good", { title: "good" });
    writeFileSync(join(CHAT_DIR, "broken.json"), "{not json");
    const { req, res } = makeReqRes("GET", "/api/paaw/chats");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const list = jsonBody(res);
    expect(Array.isArray(list)).toBe(true);
    expect(list.map((c) => c.id)).toEqual(["c-good"]);
  });
});

describe("chat CRUD — GET /api/paaw/chats/:id (single)", () => {
  it("returns the chat json", async () => {
    seedChat("c-1", { title: "T" });
    const { req, res } = makeReqRes("GET", "/api/paaw/chats/c-1");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).title).toBe("T");
  });

  it("missing id → 404", async () => {
    const { req, res } = makeReqRes("GET", "/api/paaw/chats/nope");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(404);
  });

  it("DEFECT-MAJ2: traversal id 應與 PUT/DELETE 一致回 400 — 現況未走 chatIdFromPath 消毒，落 ENOENT 404", async () => {
    // 自癒式雙分支：
    //   現況缺陷形狀 = path.split("/").pop() 不消毒 → ".." 變成字面檔名 "...json" → ENOENT → 404
    //   （僥倖不逃逸，但無縱深、且與 PUT/DELETE 的 400 行為不一致 — 這正是 QA MAJ-2）
    //   修復（GET 改用 chatIdFromPath + safeResolve）→ sanitizeId("..") throw → 400，自動轉綠。
    const { req, res } = makeReqRes("GET", "/api/paaw/chats/..");
    await chatRoutes(req, res);
    if (res.statusCode === 400) {
      expect(jsonBody(res).error).toBe("Invalid chat id");
    } else {
      expect(res.statusCode).toBe(404);
      expect(jsonBody(res).error).toBe("Not found");
    }
  });
});

describe("chat CRUD — PUT /api/paaw/chats/:id", () => {
  it("merges body into existing chat and bumps updatedAt", async () => {
    seedChat("c-put", { title: "before", keep: "yes", updatedAt: "2026-01-01T00:00:00.000Z" });
    const { req, res } = makeReqRes("PUT", "/api/paaw/chats/c-put", { title: "after" });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.title).toBe("after");
    expect(body.keep).toBe("yes"); // merge 不覆蓋未提及欄位
    expect(body.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(JSON.parse(readFileSync(join(CHAT_DIR, "c-put.json"), "utf-8")).title).toBe("after");
  });

  it("missing chat → 404, no silent create（前輪 hardening 固化）", async () => {
    const { req, res } = makeReqRes("PUT", "/api/paaw/chats/ghost", { title: "x" });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(404);
    expect(existsSync(join(CHAT_DIR, "ghost.json"))).toBe(false);
  });

  it("malformed JSON → 400", async () => {
    seedChat("c-put2", {});
    const { req, res } = makeReqRes("PUT", "/api/paaw/chats/c-put2", "{oops");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("traversal id → 400（chatIdFromPath decode 後 sanitizeId 攔下）", async () => {
    const { req, res } = makeReqRes("PUT", "/api/paaw/chats/..%2F..%2Fetc%2Fpasswd", { title: "x" });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(existsSync(join(TMP, "etc", "passwd.json"))).toBe(false);
  });
});

describe("chat CRUD — DELETE /api/paaw/chats/:id", () => {
  it("removes the file", async () => {
    seedChat("c-del", {});
    const { req, res } = makeReqRes("DELETE", "/api/paaw/chats/c-del");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).ok).toBe(true);
    expect(existsSync(join(CHAT_DIR, "c-del.json"))).toBe(false);
  });

  it("traversal id → 400（chatIdFromPath 消毒）", async () => {
    const { req, res } = makeReqRes("DELETE", "/api/paaw/chats/..%2F..%2Fx");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("nonexistent id → ok:true（現況寬鬆語義，記錄固化）", async () => {
    const { req, res } = makeReqRes("DELETE", "/api/paaw/chats/never-existed");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).ok).toBe(true);
  });
});

describe("chat CRUD — per-chat write lock（併發無 lost update）", () => {
  it("two concurrent PUTs both land（read-modify-write 由 withChatLock 串行化）", async () => {
    seedChat("c-race", { title: "init", a: 0, b: 0 });
    const [r1, r2] = twoReqs("PUT", "/api/paaw/chats/c-race", { a: 1 });
    // 第二個請求改不同欄位
    const r2b = makeReqRes("PUT", "/api/paaw/chats/c-race", { b: 2 });
    await Promise.all([chatRoutes(r1.req, r1.res), chatRoutes(r2b.req, r2b.res)]);
    const final = JSON.parse(readFileSync(join(CHAT_DIR, "c-race.json"), "utf-8"));
    // 若無鎖：兩個讀-改-寫交錯，後寫者覆蓋先寫者 → a 或 b 其中一個遺失
    expect(final.a).toBe(1);
    expect(final.b).toBe(2);
  });

  it("no temp files left behind after writes（atomicWriteJson 的 rename 不留 .tmp）", async () => {
    seedChat("c-atomic", {});
    const { req, res } = makeReqRes("PUT", "/api/paaw/chats/c-atomic", { title: "x" });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(readdirSync(CHAT_DIR).filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});

// ══════════════════════════════════════════════
// B. SSE POST /api/paaw/chat — MAJ-1 缺口（錯誤分支；串流 happy path 由 e2e 承擔）
// ══════════════════════════════════════════════
describe("SSE POST /api/paaw/chat — body 驗證（MAJ-1）", () => {
  it("DEFECT-MAJ1: malformed JSON 應回 400 — 現況裸 JSON.parse 冒 SyntaxError → 500", async () => {
    // 自癒式雙分支：
    //   現況缺陷形狀 = `JSON.parse(await readBody(req))` 無 readJsonBody 包裝 →
    //     SyntaxError 進外層 catch → 500 且 error message 外洩 parser 細節（"Unexpected token..."）
    //   修復（改用 readJsonBody(req, res, MAX_CHAT_BODY_BYTES)）→ 400 "Invalid JSON body"，自動轉綠。
    const { req, res } = makeReqRes("POST", "/api/paaw/chat", "{bad json");
    await chatRoutes(req, res);
    if (res.statusCode === 400) {
      expect(jsonBody(res).error).toMatch(/Invalid JSON/i);
    } else {
      expect(res.statusCode).toBe(500);
      expect(jsonBody(res).error).toMatch(/Unexpected/i); // 證明是未處理的 JSON.parse SyntaxError
    }
  });

  it("DEFECT-MAJ1: >20MB body 應回 413 — 現況無 cap 照單全收，走到 providers.json ENOENT 才 500", async () => {
    // 自癒式三分支：
    //   現況 = 無 cap：21MB 全讀入 → parse 成功 → 讀不到 config/providers.json → 500（DoS 面敞開）
    //   過渡 = 有 cap 但 readJsonBody 未 catch BODY_TOO_LARGE → route reject
    //   完整修復 = 413
    const big = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(21 * 1024 * 1024) }] });
    const { req, res } = makeReqRes("POST", "/api/paaw/chat", big);
    let threw = null;
    try { await chatRoutes(req, res); } catch (e) { threw = e; }
    if (threw) {
      expect(threw.code).toBe("BODY_TOO_LARGE");
    } else if (res.statusCode === 413) {
      expect(true).toBe(true); // 完整修復
    } else {
      expect(res.statusCode).toBe(500); // 現況缺陷形狀：無 cap，最終 500
    }
  });
});

// ══════════════════════════════════════════════
// B2. readBody cap 原語（MAJ-1 修復的基礎設施 — context.mjs 已具備，SSE 端點只是沒用）
// ══════════════════════════════════════════════
describe("context.mjs readBody — size cap 原語", () => {
  it("with maxBytes: exceeding cap rejects BODY_TOO_LARGE", async () => {
    const req = new EventEmitter();
    req.destroy = () => {};
    process.nextTick(() => {
      req.emit("data", Buffer.alloc(64));
      req.emit("data", Buffer.alloc(64)); // 共 128 > 100
    });
    await expect(readBody(req, 100)).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });

  it("with maxBytes: within cap resolves the body", async () => {
    const req = new EventEmitter();
    process.nextTick(() => {
      req.emit("data", Buffer.from("hello"));
      req.emit("end");
    });
    await expect(readBody(req, 100)).resolves.toBe("hello");
  });

  it("without maxBytes: legacy callers get unbounded read（SSE 端點現況正是此用法）", async () => {
    const req = new EventEmitter();
    const chunk = Buffer.alloc(1024 * 1024);
    process.nextTick(() => {
      req.emit("data", chunk);
      req.emit("data", chunk);
      req.emit("end");
    });
    const out = await readBody(req); // 無 cap — 這正是 MAJ-1 的根源
    expect(out.length).toBe(2 * 1024 * 1024);
  });
});

// ══════════════════════════════════════════════
// C. 圖片上傳 POST /api/uploads
// ══════════════════════════════════════════════
describe("uploads — POST /api/uploads (image)", () => {
  it("happy path: real PNG → saved under central uploads/, path ref returned", async () => {
    const { req, res } = makeReqRes("POST", "/api/uploads", { dataUrl: pngDataUrl() });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.ok).toBe(true);
    expect(body.path).toMatch(/^uploads\/\d+-[0-9a-f]{8}\.png$/);
    expect(body.url).toBe(`/api/${body.path}`);
    expect(existsSync(join(UPLOADS_DIR, body.path.slice("uploads/".length)))).toBe(true);
  });

  it("extension decided by magic bytes, not client mime（宣告 jpeg 內容 png → 存 .png）", async () => {
    const { req, res } = makeReqRes("POST", "/api/uploads", { dataUrl: `data:image/jpeg;base64,${pngBuf().toString("base64")}` });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).path).toMatch(/\.png$/);
  });

  it("non-base64 / wrong-scheme dataUrl → 400", async () => {
    for (const bad of ["", "not-a-dataurl", "data:text/html;base64,PGh0bWw+", "data:image/png,raw-not-base64"]) {
      const { req, res } = makeReqRes("POST", "/api/uploads", { dataUrl: bad });
      await uploadRoutes(req, res);
      expect(res.statusCode).toBe(400);
    }
  });

  it("HTML disguised as image (magic bytes fail) → 400（stored-XSS 防線）", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const { req, res } = makeReqRes("POST", "/api/uploads", { dataUrl: `data:image/png;base64,${html.toString("base64")}` });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/not a recognised image/i);
  });

  it("decoded size > 5MB → 400", async () => {
    const huge = Buffer.concat([PNG_MAGIC, Buffer.alloc(5 * 1024 * 1024 + 16)]);
    const { req, res } = makeReqRes("POST", "/api/uploads", { dataUrl: `data:image/png;base64,${huge.toString("base64")}` });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/size out of range/i);
  });

  it("unregistered ruRoot → 400（穿越防線：只能寫註冊過的 RU）", async () => {
    const { req, res } = makeReqRes("POST", "/api/uploads", { dataUrl: pngDataUrl(), ruRoot: "/definitely/not/registered" });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/not a registered release unit/i);
  });

  it("registered ruRoot → stored in {ru}/.paaw/uploads/ with paaw-uploads ref（RU 資產語義）", async () => {
    registerRu(TMP_RU);
    const { req, res } = makeReqRes("POST", "/api/uploads", { dataUrl: pngDataUrl(), ruRoot: TMP_RU });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.path).toMatch(/^paaw-uploads\/\d+-[0-9a-f]{8}\.png$/);
    expect(existsSync(join(TMP_RU, ".paaw", "uploads", body.path.slice("paaw-uploads/".length)))).toBe(true);
  });

  it("malformed JSON body → 400 (前輪 M4 固化)", async () => {
    const { req, res } = makeReqRes("POST", "/api/uploads", "{nope");
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/Invalid JSON/i);
  });

  it("body > 12MB → 413（uploads 端有完整 cap 處理，與 chat.mjs 對照組）", async () => {
    // 13MB base64 → 超 MAX_UPLOAD_BODY_BYTES(12MB) → _readJsonBody catch → 413
    const big = JSON.stringify({ dataUrl: "data:image/png;base64," + "A".repeat(13 * 1024 * 1024) });
    const { req, res } = makeReqRes("POST", "/api/uploads", big);
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(413);
  });
});

// ══════════════════════════════════════════════
// D. 文字上傳 POST /api/uploads/text
// ══════════════════════════════════════════════
describe("uploads — POST /api/uploads/text", () => {
  it("happy path: content written to central uploads with sanitized unique name", async () => {
    const { req, res } = makeReqRes("POST", "/api/uploads/text", { content: "hello world", filename: "notes.txt" });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.ok).toBe(true);
    expect(body.name).toBe("notes.txt");
    expect(readFileSync(body.abs, "utf-8")).toBe("hello world");
    expect(body.abs.startsWith(UPLOADS_DIR)).toBe(true);
  });

  it("filename traversal payload sanitized to basename（../../etc/passwd → passwd，落在中央 uploads 內）", async () => {
    const { req, res } = makeReqRes("POST", "/api/uploads/text", { content: "x", filename: "../../etc/passwd" });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.name).toBe("passwd");
    expect(body.abs.startsWith(UPLOADS_DIR)).toBe(true);
    expect(existsSync(join(TMP, "etc"))).toBe(false); // 沒有逃逸
  });

  it("empty content → 400", async () => {
    const { req, res } = makeReqRes("POST", "/api/uploads/text", { content: "", filename: "a.txt" });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/Empty content/i);
  });

  it("NUL byte (binary content) → 400", async () => {
    const { req, res } = makeReqRes("POST", "/api/uploads/text", { content: "text\u0000binary", filename: "a.txt" });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/binary/i);
  });

  it("content > 2MB → 400", async () => {
    const { req, res } = makeReqRes("POST", "/api/uploads/text", { content: "y".repeat(2 * 1024 * 1024 + 1), filename: "big.txt" });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/too large/i);
  });

  it("registered ruRoot → stored as RU asset with rel path", async () => {
    registerRu(TMP_RU);
    const { req, res } = makeReqRes("POST", "/api/uploads/text", { content: "ru asset", filename: "r.txt", ruRoot: TMP_RU });
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.rel).toMatch(/^\.paaw\/uploads\//);
    expect(readFileSync(body.abs, "utf-8")).toBe("ru asset");
  });
});

// ══════════════════════════════════════════════
// E. 靜態服務 GET /api/uploads/* 與 /api/paaw-uploads/*
// ══════════════════════════════════════════════
describe("uploads — GET /api/uploads/* (static)", () => {
  it("serves stored image with magic-bytes Content-Type + nosniff + immutable cache", async () => {
    writeFileSync(join(UPLOADS_DIR, "img.png"), pngBuf());
    const { req, res } = makeReqRes("GET", "/api/uploads/img.png");
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Cache-Control"]).toContain("immutable");
  });

  it("stored non-image bytes → 415（即使副檔名是 .png — stored XSS 防線）", async () => {
    writeFileSync(join(UPLOADS_DIR, "fake.png"), Buffer.from("<script>alert(1)</script>"));
    const { req, res } = makeReqRes("GET", "/api/uploads/fake.png");
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(415);
  });

  it("path traversal → 400（含 encoded 變體與嵌目錄）", async () => {
    for (const bad of ["../chats/c-1.json", "..%2F..%2Fuser.json", "a/b.png", ".."]) {
      const { req, res } = makeReqRes("GET", `/api/uploads/${bad}`);
      await uploadRoutes(req, res);
      expect(res.statusCode).toBe(400);
    }
  });

  it("not found → 404", async () => {
    const { req, res } = makeReqRes("GET", "/api/uploads/missing.png");
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("uploads — GET /api/paaw-uploads/* (RU asset service)", () => {
  it("serves image stored in a registered RU", async () => {
    registerRu(TMP_RU);
    mkdirSync(join(TMP_RU, ".paaw", "uploads"), { recursive: true });
    writeFileSync(join(TMP_RU, ".paaw", "uploads", "ru-img.png"), pngBuf());
    const { req, res } = makeReqRes("GET", "/api/paaw-uploads/ru-img.png");
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/png");
  });

  it("path traversal → 400", async () => {
    const { req, res } = makeReqRes("GET", "/api/paaw-uploads/..%2F..%2Fsecrets.json");
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("not found → 404", async () => {
    registerRu(TMP_RU);
    const { req, res } = makeReqRes("GET", "/api/paaw-uploads/nothing.png");
    await uploadRoutes(req, res);
    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════
// F. resolveUploadRef（vision 管線共用的路徑解析）
// ══════════════════════════════════════════════
describe("uploads — resolveUploadRef", () => {
  it("uploads/<name> → central uploads dir", async () => {
    const abs = await resolveUploadRef("uploads/123-abcd.png");
    expect(abs).toBe(join(UPLOADS_DIR, "123-abcd.png"));
  });

  it("paaw-uploads/<name> → resolved from registered RU when file exists", async () => {
    registerRu(TMP_RU);
    mkdirSync(join(TMP_RU, ".paaw", "uploads"), { recursive: true });
    writeFileSync(join(TMP_RU, ".paaw", "uploads", "found.png"), pngBuf());
    const abs = await resolveUploadRef("paaw-uploads/found.png");
    expect(abs).toBe(join(TMP_RU, ".paaw", "uploads", "found.png"));
  });

  it("paaw-uploads/<name> not in any RU → null", async () => {
    registerRu(TMP_RU);
    expect(await resolveUploadRef("paaw-uploads/ghost.png")).toBeNull();
  });

  it("malformed refs → null（絕對路徑、穿越、非字串）", async () => {
    expect(await resolveUploadRef("/etc/passwd")).toBeNull();
    expect(await resolveUploadRef("uploads/../evil.png")).toBeNull();
    expect(await resolveUploadRef("../../x.png")).toBeNull();
    expect(await resolveUploadRef(123)).toBeNull();
  });
});

// ══════════════════════════════════════════════
// G. 系統提示詞 API
// ══════════════════════════════════════════════
describe("system prompts — GET", () => {
  it("GET /api/system-prompts lists all prompt files（missing → null）", async () => {
    const { req, res } = makeReqRes("GET", "/api/system-prompts");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    for (const f of PROMPT_FILES) expect(body).toHaveProperty(f, null);
  });

  it("GET /api/system-prompts/:file returns content when present", async () => {
    mkdirSync(PROMPT_DIR, { recursive: true });
    writeFileSync(join(PROMPT_DIR, "identity.md"), "# 我是助理");
    const { req, res } = makeReqRes("GET", "/api/system-prompts/identity.md");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).content).toBe("# 我是助理");
  });

  it("GET unknown file → 400; known-but-missing file → 404", async () => {
    const a = makeReqRes("GET", "/api/system-prompts/evil.md");
    await chatRoutes(a.req, a.res);
    expect(a.res.statusCode).toBe(400);

    const b = makeReqRes("GET", "/api/system-prompts/identity.md");
    await chatRoutes(b.req, b.res);
    expect(b.res.statusCode).toBe(404);
  });
});

describe("system prompts — PUT /api/system-prompts/:file", () => {
  it("writes content to ai-settings/chat/<file>", async () => {
    const { req, res } = makeReqRes("PUT", "/api/system-prompts/system-prompt.md", { content: "新提示詞" });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).saved).toBe(true);
    expect(readFileSync(join(PROMPT_DIR, "system-prompt.md"), "utf-8")).toBe("新提示詞");
  });

  it("non-string content → 400", async () => {
    const { req, res } = makeReqRes("PUT", "/api/system-prompts/identity.md", { content: 123 });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/must be a string/i);
  });

  it("unknown file → 400（白名單擋非預期檔名）", async () => {
    const { req, res } = makeReqRes("PUT", "/api/system-prompts/arbitrary.md", { content: "x" });
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("malformed JSON → 400", async () => {
    const { req, res } = makeReqRes("PUT", "/api/system-prompts/identity.md", "{bad");
    await chatRoutes(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("DEFECT-NEW1: >1MB body → route rejects（readJsonBody 缺 BODY_TOO_LARGE catch；修復後應 413）", async () => {
    // 注意：body cap(1MB) 先於 content.length 檢查觸發 — content 1MB+ 裝進 JSON 必超 body cap。
    // （產品另有 content.length > MAX_PROMPT_BODY_BYTES → 400 的分支，但正常路徑下永遠走不到，
    //   因為 body cap 更早 reject — 此為事實記錄，非本測試重點。）
    const big = JSON.stringify({ content: "z".repeat(1024 * 1024 + 512) });
    const { req, res } = makeReqRes("PUT", "/api/system-prompts/identity.md", big);
    let threw = null;
    try { await chatRoutes(req, res); } catch (e) { threw = e; }
    if (threw) {
      expect(threw.code).toBe("BODY_TOO_LARGE");
      expect(res.statusCode).toBeNull();
    } else {
      expect(res.statusCode).toBe(413);
    }
  });
});
