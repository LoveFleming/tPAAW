// coding-ops.test.mjs — F-041「維運狀態與 Runbook 管理」測試（TASK-159 品質補強）
//
// 補足 QA 指出的零測試覆蓋（qr-20261017-010537-hrxs major）。
// 受測檔：packages/server/src/routes/coding-ops.mjs（3 端點）。
//
// 覆蓋面（對應 QA 6 issues）：
//   - runbook/save 畸形 JSON body → 400 而非 500（issue 1 / C1）
//   - runbook/save path 未指向既有目錄 → 400，不寫檔（issue 2 / C2，Arbitrary File Write）
//   - runbook id 含 '..' 或非法字元 → 400（issue 3 / C3，改用 sanitizeId）
//   - runbook/save 覆寫 source:human → 409，帶 overwrite:true 才可蓋（issue 4）
//   - status gitInfo 走 execFile（runGit）、不再依賴 shell |head；非 repo 時附 error（issue 5）
//   - status 四項內容齊備（deterministic）
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EventEmitter } from "events";

const opsRoutes = (await import("../../packages/server/src/routes/coding-ops.mjs")).default;

/** 建構最小 req（EventEmitter 支援 readBody）＋ 捕獲式 res；
 *  res 需自行提供 status().json()（真 server 由 paaw-server 裝飾，測試環境要自備）。 */
function makeReqRes(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {};
  const res = {
    statusCode: 200,
    body: "",
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = JSON.stringify(data); this.ended = true; return this; },
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(chunk) { if (chunk !== undefined) this.body = String(chunk); this.ended = true; return this; },
  };
  process.nextTick(() => {
    if (body !== undefined) req.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    req.emit("end");
  });
  return { req, res };
}

// 每個測試在 tmp 建一個獨立專案根；some 需要是「目錄」以通過 save 驗證
let PROJECT;
const RUNBOOK_DIR = () => join(PROJECT, ".paaw", "runbook");

beforeAll(() => {
  PROJECT = mkdtempSync(join(tmpdir(), "paaw-coding-ops-test-"));
});

beforeEach(() => {
  rmSync(join(PROJECT, ".paaw"), { recursive: true, force: true });
  mkdirSync(RUNBOOK_DIR(), { recursive: true });
  writeFileSync(join(PROJECT, "package.json"), JSON.stringify({ name: "demo", version: "1.2.3", scripts: { dev: "vite" } }));
});

afterAll(() => {
  rmSync(PROJECT, { recursive: true, force: true });
});

describe("coding-ops — GET /status", () => {
  it("非 coding-ops 路徑 → 交還 next（不處理）", async () => {
    const { req, res } = makeReqRes("GET", "/api/other");
    const handled = await opsRoutes(req, res, () => false);
    expect(handled).toBe(false);
  });

  it("缺 path → 400 { error }", async () => {
    const { req, res } = makeReqRes("GET", "/api/coding-ops/status");
    await opsRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/path required/);
  });

  it("path 不存在 → 400", async () => {
    const { req, res } = makeReqRes("GET", `/api/coding-ops/status?path=${encodeURIComponent(join(PROJECT, "nope"))}`);
    await opsRoutes(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("回傳四項內容齊備（git/overview/runbooks/scripts/releases），runbook 清單列出 .md 與來源", async () => {
    writeFileSync(join(RUNBOOK_DIR(), "deploy.md"), "# Deploy Runbook\nsource: human\n## Steps\n");
    writeFileSync(join(RUNBOOK_DIR(), "triage.md"), "# Triage\n## Checks\n");
    writeFileSync(join(RUNBOOK_DIR(), "ignore.txt"), "not a runbook");

    const { req, res } = makeReqRes("GET", `/api/coding-ops/status?path=${encodeURIComponent(PROJECT)}`);
    await opsRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json).toHaveProperty("git");
    expect(json).toHaveProperty("overview");
    expect(json).toHaveProperty("scripts");
    expect(json).toHaveProperty("releases");
    expect(json).toHaveProperty("checkedAt");
    expect(json.scripts.dev).toBe("vite");
    // 只有 .md，且來源偵測正確（deploy.md 檔頭 source: human → human）
    const ids = json.runbooks.map((r) => r.id).sort();
    expect(ids).toEqual(["deploy", "triage"]);
    const deploy = json.runbooks.find((r) => r.id === "deploy");
    expect(deploy.source).toBe("human");
    const triage = json.runbooks.find((r) => r.id === "triage");
    expect(triage.source).toBe("ai");
    // 人寫權威排最前
    expect(json.runbooks[0].id).toBe("deploy");
  });

  it("git 狀態：非 git repo 時 isRepo:false 且附可辨因的 error 欄位（issue 5）", async () => {
    const { req, res } = makeReqRes("GET", `/api/coding-ops/status?path=${encodeURIComponent(PROJECT)}`);
    await opsRoutes(req, res);
    const git = JSON.parse(res.body).git;
    expect(git.isRepo).toBe(false);
    // 不再靜默吞錯 — 有 error 可辨因
    expect(typeof git.error).toBe("string");
    expect(git.error.length).toBeGreaterThan(0);
  });

  it("deterministic：同一狀態連跑兩次，除去 checkedAt 外結果一致", async () => {
    const call = async () => {
      const { req, res } = makeReqRes("GET", `/api/coding-ops/status?path=${encodeURIComponent(PROJECT)}`);
      await opsRoutes(req, res);
      const j = JSON.parse(res.body);
      delete j.checkedAt;
      return j;
    };
    const a = await call();
    const b = await call();
    expect(a).toEqual(b);
  });
});

describe("coding-ops — GET /runbook", () => {
  it("缺 path 或缺 id → 400", async () => {
    for (const u of ["/api/coding-ops/runbook", `/api/coding-ops/runbook?path=${encodeURIComponent(PROJECT)}`, "/api/coding-ops/runbook?id=deploy"]) {
      const { req, res } = makeReqRes("GET", u);
      await opsRoutes(req, res);
      expect(res.statusCode, u).toBe(400);
    }
  });

  it("讀得回內容；不存在的 id → 404", async () => {
    writeFileSync(join(RUNBOOK_DIR(), "deploy.md"), "# Deploy\nhello");
    const ok = makeReqRes("GET", `/api/coding-ops/runbook?path=${encodeURIComponent(PROJECT)}&id=deploy`);
    await opsRoutes(ok.req, ok.res);
    expect(ok.res.statusCode).toBe(200);
    expect(JSON.parse(ok.res.body).content).toMatch(/hello/);

    const miss = makeReqRes("GET", `/api/coding-ops/runbook?path=${encodeURIComponent(PROJECT)}&id=nope`);
    await opsRoutes(miss.req, miss.res);
    expect(miss.res.statusCode).toBe(404);
  });

  it("id 含 '..' 或非法字元 → 400（路徑穿越防護，issue 3）", async () => {
    for (const bad of ["..", "../secret", "a/b", "a\\b", "..%2Fetc"]) {
      const { req, res } = makeReqRes("GET", `/api/coding-ops/runbook?path=${encodeURIComponent(PROJECT)}&id=${encodeURIComponent(bad)}`);
      await opsRoutes(req, res);
      expect(res.statusCode, `id=${bad}`).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/invalid id/);
    }
  });
});

describe("coding-ops — POST /runbook/save", () => {
  function post(body) {
    return makeReqRes("POST", "/api/coding-ops/runbook/save", body);
  }

  it("畸形 JSON body → 400 invalid JSON body（不 500、不外洩 SyntaxError，issue 1）", async () => {
    const { req, res } = post("not-json{");
    await opsRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invalid JSON body/);
  });

  it("缺欄位 → 400", async () => {
    const { req, res } = post({ id: "x", content: "y" });
    await opsRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/required/);
  });

  it("path 不存在/非目錄 → 400，且不建立任何目錄（Arbitrary File Write 防護，issue 2）", async () => {
    const evil = join(PROJECT, "..", "evil-target-" + Date.now());
    const { req, res } = post({ path: evil, id: "x", content: "pwn" });
    await opsRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/existing directory/);
    expect(existsSync(join(evil, ".paaw"))).toBe(false);
  });

  it("id 含 '..' → 400，不寫出 .paaw/runbook 之外（issue 3）", async () => {
    const { req, res } = post({ path: PROJECT, id: "../escaped", content: "pwn" });
    await opsRoutes(req, res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invalid id/);
  });

  it("正常寫入 → 200 { ok, file }，內容落盤，process.nextTick 後可讀", async () => {
    const { req, res } = post({ path: PROJECT, id: "deploy", content: "# Deploy\nsource: ai\n" });
    await opsRoutes(req, res);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.file).toBe(".paaw/runbook/deploy.md");
    expect(readFileSync(join(RUNBOOK_DIR(), "deploy.md"), "utf-8")).toMatch(/Deploy/);
  });

  it("可覆寫 AI 草稿（source:ai）不需 overwrite（issue 4 反面）", async () => {
    writeFileSync(join(RUNBOOK_DIR(), "triage.md"), "# Triage\nsource: ai\nold");
    const { req, res } = post({ path: PROJECT, id: "triage", content: "# Triage\nsource: ai\nnew" });
    await opsRoutes(req, res);
    expect(res.statusCode).toBe(200);
    expect(readFileSync(join(RUNBOOK_DIR(), "triage.md"), "utf-8")).toMatch(/new/);
  });

  it("覆寫 source:human 的人寫權威 → 409，除非帶 overwrite:true（issue 4）", async () => {
    writeFileSync(join(RUNBOOK_DIR(), "deploy.md"), "# Deploy\nsource: human\nauthoritative");
    const blocked = post({ path: PROJECT, id: "deploy", content: "# Deploy\nsource: ai\noverwritten" });
    await opsRoutes(blocked.req, blocked.res);
    expect(blocked.res.statusCode).toBe(409);
    // 原內容未被動
    expect(readFileSync(join(RUNBOOK_DIR(), "deploy.md"), "utf-8")).toMatch(/authoritative/);

    const forced = post({ path: PROJECT, id: "deploy", content: "# Deploy\nsource: human\nnew", overwrite: true });
    await opsRoutes(forced.req, forced.res);
    expect(forced.res.statusCode).toBe(200);
    expect(readFileSync(join(RUNBOOK_DIR(), "deploy.md"), "utf-8")).toMatch(/new/);
  });
});
