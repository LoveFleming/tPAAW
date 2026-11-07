/**
 * F-048 Release Unit 技能實例管理（Skill Instance Model）單元測試
 *
 * 受測：
 *   - packages/server/src/lib/ru-skills.mjs       — 實例引擎（provision/sync/status/remove/resolve）
 *   - packages/server/src/routes/coding-ru-skills.mjs — HTTP 路由（GET/sync/add/DELETE）
 *
 * 心智模型：skill 是 Release Unit 的資產。全域 data/skills/ 只是模板庫，
 * provision = 從模板 clone 進 {ru}/.paaw/skills/{skillId}/ + sidecar _paaw.json（記 templateHash）；
 * sync = 未客製就跟版、客製過不動；resolve（readRuSkillContent）只看 RU 內、無全域 fallback。
 *
 * 隔離策略：DATA_HOME 於模組載入時讀 PAAW_DATA_HOME → 先設 env 指向 temp 假全球模板庫，
 * 再動態 import。每個 test 各自建獨立 temp RU 目錄（不共用可變狀態）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 每個 test 自己建 temp 目錄，用 helper 統一管理
function mkTmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 建一個假全球模板 skill：{dataHome}/skills/physical-skill/{id}/{mainFile} */
function seedGlobalSkill(dataHome, id, { kind = "physical-skill", name, body = "hello template", extraFiles = {} } = {}) {
  const dir = join(dataHome, "skills", kind, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name || id}\n---\n${body}\n`);
  for (const [rel, content] of Object.entries(extraFiles)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

function mkProject() {
  const dir = mkTmp("ru-skills-proj-");
  mkdirSync(join(dir, ".paaw"), { recursive: true });
  return dir;
}

const cleanups = [];
function track(dir) { cleanups.push(dir); return dir; }

// ── 載入受測模組（DATA_HOME 由 env 決定） ──
let ru;         // lib/ru-skills.mjs
let routes;     // routes/coding-ru-skills.mjs
let dataHome;

beforeAll(async () => {
  dataHome = track(mkTmp("ru-skills-data-"));
  process.env.PAAW_DATA_HOME = dataHome;
  ru = await import("../../packages/server/src/lib/ru-skills.mjs");
  routes = (await import("../../packages/server/src/routes/coding-ru-skills.mjs")).default;
});

afterAll(() => {
  delete process.env.PAAW_DATA_HOME;
  for (const d of cleanups) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
});

// ── mock req/res（route handler 直接注入，不開 server） ──
function mockReq(method, url, body) {
  const bodyStr = body ? JSON.stringify(body) : "";
  return {
    method, url,
    on(ev, cb) {
      if (ev === "data" && bodyStr) cb(bodyStr);
      if (ev === "end") cb();
      if (ev === "error") cb();
    },
  };
}
function mockRes() {
  const r = { code: 0, body: null };
  r.writeHead = (c) => { r.code = c; return r; };
  r.end = (b) => { r.body = String(b || ""); return r; };
  return r;
}
async function callRoute(method, url, body) {
  const res = mockRes();
  await routes(mockReq(method, url, body), res, () => {});
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch {}
  return { code: r_code(res), body: parsed, raw: res.body };
}
function r_code(res) { return res.code; }

// ════════════════════════════════════════════════════════════════════
// 實例引擎：provision / sync / status / resolve / remove
// ════════════════════════════════════════════════════════════════════

describe("ru-skills — provision（從全域模板 clone 進 RU）", () => {
  it("clone 模板到 {ru}/.paaw/skills/{id}/ 並寫 sidecar _paaw.json", () => {
    const id = "prov-basic";
    seedGlobalSkill(dataHome, id, { name: "Prov Basic", body: "PROMPT-BODY" });
    const proj = track(mkProject());

    const r = ru.provisionRuSkill(proj, id);

    expect(r.ok).toBe(true);
    expect(r.alreadyExists).toBe(false);
    const dest = join(proj, ".paaw", "skills", id);
    expect(r.path).toBe(dest);
    // 主檔複製成功
    expect(existsSync(join(dest, "SKILL.md"))).toBe(true);
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toContain("PROMPT-BODY");
    // sidecar 落地 + 帶 templateHash
    const sidecar = JSON.parse(readFileSync(join(dest, "_paaw.json"), "utf-8"));
    expect(sidecar.sourceKind).toBe("physical");
    expect(typeof sidecar.templateHash).toBe("string");
    expect(sidecar.templateHash.length).toBeGreaterThan(0);
    expect(sidecar.syncedAt).toBeTruthy();
  });

  it("模板不存在 → { ok:false, reason:'template-not-found' }，不建目錄", () => {
    const proj = track(mkProject());
    const r = ru.provisionRuSkill(proj, "no-such-skill-xyz");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("template-not-found");
    expect(existsSync(join(proj, ".paaw", "skills", "no-such-skill-xyz"))).toBe(false);
  });

  it("已存在 → alreadyExists:true，不覆蓋既有內容", () => {
    const id = "prov-exists";
    seedGlobalSkill(dataHome, id);
    const proj = track(mkProject());

    ru.provisionRuSkill(proj, id);
    const dest = join(proj, ".paaw", "skills", id);
    writeFileSync(join(dest, "SKILL.md"), "LOCAL-EDITED"); // 使用者改過

    const r2 = ru.provisionRuSkill(proj, id);
    expect(r2.ok).toBe(true);
    expect(r2.alreadyExists).toBe(true);
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toBe("LOCAL-EDITED"); // 不被覆蓋
  });

  it("已存在但缺 sidecar（手動放的）→ 補 sidecar 對齊", () => {
    const id = "prov-nosidecar";
    seedGlobalSkill(dataHome, id);
    const proj = track(mkProject());
    const dest = join(proj, ".paaw", "skills", id);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), "---\nname: manual\n---\nbody\n");

    const r = ru.provisionRuSkill(proj, id);
    expect(r.alreadyExists).toBe(true);
    expect(existsSync(join(dest, "_paaw.json"))).toBe(true);
  });

  it("遞迴複製巢狀子目錄與檔案（非模板附件不該被視為模板檔）", () => {
    const id = "prov-nested";
    seedGlobalSkill(dataHome, id, { extraFiles: { "refs/a.md": "AAA", "refs/deep/b.md": "BBB" } });
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, id);
    const dest = join(proj, ".paaw", "skills", id);
    expect(readFileSync(join(dest, "refs", "a.md"), "utf-8")).toBe("AAA");
    expect(readFileSync(join(dest, "refs", "deep", "b.md"), "utf-8")).toBe("BBB");
  });

  it("provisionRuSkills 批次回報 provisioned / exists / missing 分類", () => {
    seedGlobalSkill(dataHome, "batch-a");
    seedGlobalSkill(dataHome, "batch-b");
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, "batch-a"); // 先放一個 → exists

    const res = ru.provisionRuSkills(proj, ["batch-a", "batch-b", "batch-missing"]);
    expect(res.exists).toContain("batch-a");
    expect(res.provisioned).toContain("batch-b");
    expect(res.missing).toContain("batch-missing");
  });
});

describe("ru-skills — sync（跟版，冪等）", () => {
  it("未客製 + 模板未變 → action 'synced'，內容不動", () => {
    const id = "sync-uptodate";
    seedGlobalSkill(dataHome, id, { body: "V1" });
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, id);

    const summary = ru.syncRuSkills(proj);
    const row = summary.find(s => s.id === id);
    expect(row.action).toBe("synced");
  });

  it("未客製 + 模板更新 → action 'updated'，重 copy 成新模板內容", () => {
    const id = "sync-updated";
    const gdir = seedGlobalSkill(dataHome, id, { body: "V1" });
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, id);
    const dest = join(proj, ".paaw", "skills", id);
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toContain("V1");

    // 模板更新
    writeFileSync(join(gdir, "SKILL.md"), "---\nname: sync-updated\n---\nV2\n");

    const summary = ru.syncRuSkills(proj);
    expect(summary.find(s => s.id === id).action).toBe("updated");
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toContain("V2");
  });

  it("客製過（本地 hash != 種入 hash）→ action 'customized'，不覆蓋", () => {
    const id = "sync-customized";
    const gdir = seedGlobalSkill(dataHome, id, { body: "V1" });
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, id);
    const dest = join(proj, ".paaw", "skills", id);
    writeFileSync(join(dest, "SKILL.md"), "---\nname: mine\n---\nLOCAL-CUSTOM\n");

    // 模板也更新（若無客製偵測，會被覆蓋）
    writeFileSync(join(gdir, "SKILL.md"), "---\nname: sync-customized\n---\nV2\n");

    const summary = ru.syncRuSkills(proj);
    expect(summary.find(s => s.id === id).action).toBe("customized");
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toContain("LOCAL-CUSTOM");
  });

  it("全域模板已消失 → action 'orphan'，RU 副本保留", () => {
    const id = "sync-orphan";
    seedGlobalSkill(dataHome, id);
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, id);
    // 移除全域模板
    rmSync(join(dataHome, "skills", "physical-skill", id), { recursive: true, force: true });

    const summary = ru.syncRuSkills(proj);
    expect(summary.find(s => s.id === id).action).toBe("orphan");
    expect(existsSync(join(proj, ".paaw", "skills", id, "SKILL.md"))).toBe(true);
  });

  it("RU 副本主檔被刪但模板還在 → action 'restored'，重建", () => {
    const id = "sync-broken";
    seedGlobalSkill(dataHome, id, { body: "RESTORE-ME" });
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, id);
    const dest = join(proj, ".paaw", "skills", id);
    rmSync(join(dest, "SKILL.md")); // 手動刪主檔

    const summary = ru.syncRuSkills(proj);
    expect(summary.find(s => s.id === id).action).toBe("restored");
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toContain("RESTORE-ME");
  });

  it("onlySkillId 只處理指定 skill", () => {
    seedGlobalSkill(dataHome, "only-a", { body: "A1" });
    seedGlobalSkill(dataHome, "only-b", { body: "B1" });
    const proj = track(mkProject());
    ru.provisionRuSkills(proj, ["only-a", "only-b"]);
    // 兩者模板都更新
    writeFileSync(join(dataHome, "skills", "physical-skill", "only-a", "SKILL.md"), "---\nname: only-a\n---\nA2\n");
    writeFileSync(join(dataHome, "skills", "physical-skill", "only-b", "SKILL.md"), "---\nname: only-b\n---\nB2\n");

    const summary = ru.syncRuSkills(proj, "only-a");
    expect(summary.map(s => s.id)).toEqual(["only-a"]);
    // only-b 未被處理 → 內容仍是 B1
    expect(readFileSync(join(proj, ".paaw", "skills", "only-b", "SKILL.md"), "utf-8")).toContain("B1");
  });

  it("無 {ru}/.paaw/skills 目錄 → 回空陣列（不 throw）", () => {
    const proj = track(mkProject());
    expect(ru.syncRuSkills(proj)).toEqual([]);
  });
});

describe("ru-skills — ruSkillStatus（UI 狀態清單）", () => {
  it("分類 status：synced / customized / behind / orphan / broken + available", () => {
    seedGlobalSkill(dataHome, "st-synced", { body: "S" });
    seedGlobalSkill(dataHome, "st-custom", { body: "S" });
    seedGlobalSkill(dataHome, "st-behind", { body: "S" });
    seedGlobalSkill(dataHome, "st-avail", { body: "S" });   // 未進 RU → available
    const proj = track(mkProject());

    ru.provisionRuSkills(proj, ["st-synced", "st-custom", "st-behind"]);

    // st-custom → 客製
    writeFileSync(join(proj, ".paaw", "skills", "st-custom", "SKILL.md"), "---\nname: c\n---\nCUSTOM\n");
    // st-behind → 模板更新成新版
    writeFileSync(join(dataHome, "skills", "physical-skill", "st-behind", "SKILL.md"), "---\nname: st-behind\n---\nNEW\n");

    const { skills, available } = ru.ruSkillStatus(proj, ["st-synced"]);
    const byId = Object.fromEntries(skills.map(s => [s.id, s]));
    expect(byId["st-synced"].status).toBe("synced");
    expect(byId["st-synced"].bound).toBe(true);
    expect(byId["st-custom"].status).toBe("customized");
    expect(byId["st-behind"].status).toBe("behind");
    expect(available.map(a => a.id)).toContain("st-avail");
    expect(available.map(a => a.id)).not.toContain("st-synced"); // 已在 RU 不列 available
  });

  it("RU 副本主檔不見 → status 'broken'；模板不存在 → 'orphan'", () => {
    seedGlobalSkill(dataHome, "st-broken", { body: "S" });
    seedGlobalSkill(dataHome, "st-orph", { body: "S" });
    const proj = track(mkProject());
    ru.provisionRuSkills(proj, ["st-broken", "st-orph"]);
    rmSync(join(proj, ".paaw", "skills", "st-broken", "SKILL.md"));
    rmSync(join(dataHome, "skills", "physical-skill", "st-orph"), { recursive: true, force: true });

    const { skills } = ru.ruSkillStatus(proj);
    const byId = Object.fromEntries(skills.map(s => [s.id, s]));
    expect(byId["st-broken"].status).toBe("broken");
    expect(byId["st-orph"].status).toBe("orphan");
  });

  it("無 skills 目錄 → skills:[] 且 available 為空或僅含全域（不 throw）", () => {
    const proj = track(mkProject());
    const res = ru.ruSkillStatus(proj);
    expect(Array.isArray(res.skills)).toBe(true);
    expect(res.skills).toEqual([]);
  });
});

describe("ru-skills — readRuSkillContent（resolve，單一路徑無全域 fallback）", () => {
  it("讀 RU 內 SKILL.md → 解析 name 與 body", () => {
    seedGlobalSkill(dataHome, "rd-md", { name: "Readable", body: "BODY-TEXT" });
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, "rd-md");

    const c = ru.readRuSkillContent(proj, "rd-md");
    expect(c.name).toBe("Readable");
    expect(c.prompt).toContain("BODY-TEXT");
    expect(c.skillDir).toContain(join(".paaw", "skills", "rd-md"));
  });

  it("RU 內無此 skill → 回 null（不做全域 fallback）", () => {
    seedGlobalSkill(dataHome, "rd-global-only", { body: "X" }); // 只在全域
    const proj = track(mkProject());
    expect(ru.readRuSkillContent(proj, "rd-global-only")).toBeNull();
  });

  it("skillId 含路徑分隔 → 回 null（防 traversal）", () => {
    const proj = track(mkProject());
    expect(ru.readRuSkillContent(proj, "../etc/passwd")).toBeNull();
    expect(ru.readRuSkillContent(proj, "a/b")).toBeNull();
  });

  it("inputs.json 型 skill → 從 description 取 prompt", () => {
    const dir = join(dataHome, "skills", "input-prompt", "rd-input");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "inputs.json"), JSON.stringify({ name: "InputSkill", description: "DESC-TEXT" }));
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, "rd-input");

    const c = ru.readRuSkillContent(proj, "rd-input");
    expect(c.name).toBe("InputSkill");
    expect(c.prompt).toBe("DESC-TEXT");
  });
});

describe("ru-skills — removeRuSkill", () => {
  it("移除 RU 內實例 → 目錄消失，回 ok:true", () => {
    seedGlobalSkill(dataHome, "rm-basic");
    const proj = track(mkProject());
    ru.provisionRuSkill(proj, "rm-basic");
    const dest = join(proj, ".paaw", "skills", "rm-basic");

    const r = ru.removeRuSkill(proj, "rm-basic");
    expect(r.ok).toBe(true);
    expect(existsSync(dest)).toBe(false);
  });

  it("不存在 → ok:false reason 'not-found'", () => {
    const proj = track(mkProject());
    const r = ru.removeRuSkill(proj, "rm-none");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not-found");
  });

  it("skillId 含斜線 → ok:false reason 'invalid-id'", () => {
    const proj = track(mkProject());
    expect(ru.removeRuSkill(proj, "a/b").ok).toBe(false);
    expect(ru.removeRuSkill(proj, "a/b").reason).toBe("invalid-id");
  });

  it("[QA-critical 登錄] skillId '..' → 應被擋下（不得刪到 .paaw 上層）", () => {
    // QA: removeRuSkill 只擋斜線不擋 '..'，可組合成 rmSync 移除 .paaw
    // 這是缺陷登錄：修好後此斷言應轉綠（目前實作 /[/\\]/ 不涵蓋 '..'）
    const proj = track(mkProject());
    mkdirSync(join(proj, ".paaw", "skills"), { recursive: true });
    const r = ru.removeRuSkill(proj, "..");
    expect(r.ok).toBe(false);            // 期望被視為 invalid-id
    expect(r.reason).toBe("invalid-id");
  });
});

// ════════════════════════════════════════════════════════════════════
// HTTP 路由層：GET / sync / add / DELETE
// ════════════════════════════════════════════════════════════════════

describe("coding-ru-skills route — GET 狀態清單 / 單一 skill 內容", () => {
  it("GET 帶 path → 回 ok + skills + available + boundCount", async () => {
    seedGlobalSkill(dataHome, "route-get", { body: "X" });
    const proj = track(mkProject());
    await callRoute("POST", "/api/coding-project/ru-skills/add", { path: proj, skillId: "route-get" });

    const r = await callRoute("GET", `/api/coding-project/ru-skills?path=${encodeURIComponent(proj)}`);
    expect(r.code).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.skills)).toBe(true);
    expect(r.body.skills.map(s => s.id)).toContain("route-get");
    expect(typeof r.body.boundCount).toBe("number");
  });

  it("GET 缺 path → 400", async () => {
    const r = await callRoute("GET", "/api/coding-project/ru-skills");
    expect(r.code).toBe(400);
  });

  it("GET 帶 skillId → 回 SKILL.md 原文", async () => {
    seedGlobalSkill(dataHome, "route-md", { body: "MD-CONTENT" });
    const proj = track(mkProject());
    await callRoute("POST", "/api/coding-project/ru-skills/add", { path: proj, skillId: "route-md" });

    const r = await callRoute("GET", `/api/coding-project/ru-skills?path=${encodeURIComponent(proj)}&skillId=route-md`);
    expect(r.code).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.content).toContain("MD-CONTENT");
  });

  it("GET skillId 不存在 → 404", async () => {
    const proj = track(mkProject());
    const r = await callRoute("GET", `/api/coding-project/ru-skills?path=${encodeURIComponent(proj)}&skillId=nope`);
    expect(r.code).toBe(404);
  });

  it("[防護] GET skillId 含 traversal → sanitizeId 擋下（4xx）", async () => {
    const proj = track(mkProject());
    const r = await callRoute("GET", `/api/coding-project/ru-skills?path=${encodeURIComponent(proj)}&skillId=${encodeURIComponent("../secret")}`);
    expect(r.code).toBeGreaterThanOrEqual(400);
    expect(r.code).toBeLessThan(500);
  });
});

describe("coding-ru-skills route — POST /add", () => {
  it("clone 成功 → 200 + ok + path", async () => {
    seedGlobalSkill(dataHome, "route-add", { body: "ADDED" });
    const proj = track(mkProject());
    const r = await callRoute("POST", "/api/coding-project/ru-skills/add", { path: proj, skillId: "route-add" });
    expect(r.code).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(existsSync(join(proj, ".paaw", "skills", "route-add", "SKILL.md"))).toBe(true);
  });

  it("模板不存在 → 404", async () => {
    const proj = track(mkProject());
    const r = await callRoute("POST", "/api/coding-project/ru-skills/add", { path: proj, skillId: "route-add-none" });
    expect(r.code).toBe(404);
  });

  it("缺 skillId → 400", async () => {
    const proj = track(mkProject());
    const r = await callRoute("POST", "/api/coding-project/ru-skills/add", { path: proj });
    expect(r.code).toBe(400);
  });

  it("缺 path → 400", async () => {
    const r = await callRoute("POST", "/api/coding-project/ru-skills/add", { skillId: "x" });
    expect(r.code).toBe(400);
  });
});

describe("coding-ru-skills route — POST /sync", () => {
  it("已 provision 後 sync → 200 + summary 陣列", async () => {
    seedGlobalSkill(dataHome, "route-sync", { body: "S" });
    const proj = track(mkProject());
    await callRoute("POST", "/api/coding-project/ru-skills/add", { path: proj, skillId: "route-sync" });

    const r = await callRoute("POST", "/api/coding-project/ru-skills/sync", { path: proj });
    expect(r.code).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.summary)).toBe(true);
    expect(r.body.summary.find(s => s.id === "route-sync")).toBeTruthy();
  });

  it("缺 path → 400", async () => {
    const r = await callRoute("POST", "/api/coding-project/ru-skills/sync", {});
    expect(r.code).toBe(400);
  });
});

describe("coding-ru-skills route — DELETE", () => {
  it("刪除實例 → 200 + ok，目錄消失", async () => {
    seedGlobalSkill(dataHome, "route-del", { body: "D" });
    const proj = track(mkProject());
    await callRoute("POST", "/api/coding-project/ru-skills/add", { path: proj, skillId: "route-del" });
    const dest = join(proj, ".paaw", "skills", "route-del");

    const r = await callRoute("DELETE", `/api/coding-project/ru-skills?path=${encodeURIComponent(proj)}&skillId=route-del`);
    expect(r.code).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(existsSync(dest)).toBe(false);
  });

  it("缺 skillId → 400", async () => {
    const proj = track(mkProject());
    const r = await callRoute("DELETE", `/api/coding-project/ru-skills?path=${encodeURIComponent(proj)}`);
    expect(r.code).toBe(400);
  });

  it("不存在 → 404", async () => {
    const proj = track(mkProject());
    const r = await callRoute("DELETE", `/api/coding-project/ru-skills?path=${encodeURIComponent(proj)}&skillId=nope`);
    expect(r.code).toBe(404);
  });

  it("刪除時同步從 crew 綁定解綁（不留 dangling binding）", async () => {
    seedGlobalSkill(dataHome, "route-unbind", { body: "U" });
    const proj = track(mkProject());
    await callRoute("POST", "/api/coding-project/ru-skills/add", { path: proj, skillId: "route-unbind" });

    // 先綁到某 agent
    const { updateAgentSkills, readJson, getConfigPath } = await import("../../packages/server/src/lib/project-crew.mjs");
    updateAgentSkills(proj, "coding.dev", ["route-unbind"]);

    // 刪除
    const r = await callRoute("DELETE", `/api/coding-project/ru-skills?path=${encodeURIComponent(proj)}&skillId=route-unbind`);
    expect(r.code).toBe(200);

    const cfg = readJson(getConfigPath(proj), null);
    expect(cfg?.skillBindings?.["coding.dev"] || []).not.toContain("route-unbind");
  });

  it("[防護] DELETE skillId 含 traversal → 不得刪到 RU 目錄外", async () => {
    const proj = track(mkProject());
    mkdirSync(join(proj, ".paaw", "skills"), { recursive: true });
    // 在 .paaw 放一個哨兵檔，確認沒被刪
    writeFileSync(join(proj, ".paaw", "SENTINEL.txt"), "keep");
    const r = await callRoute("DELETE", `/api/coding-project/ru-skills?path=${encodeURIComponent(proj)}&skillId=${encodeURIComponent("../")}`);
    // 不應 200 成功刪除上層
    expect(existsSync(join(proj, ".paaw", "SENTINEL.txt"))).toBe(true);
    expect(r.code).toBeGreaterThanOrEqual(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// 全流程：clone → (客製/存檔) → 移機 (copy 整個 RU) → 讀回
// ════════════════════════════════════════════════════════════════════

describe("Skill Instance Model — 端到端（技能跟著 RU 走）", () => {
  it("clone → 移機（複製整個 RU 目錄）→ 新機讀回同一 skill 內容", () => {
    seedGlobalSkill(dataHome, "e2e-travel", { name: "Traveler", body: "TRAVEL-PROMPT" });
    const srcProj = track(mkProject());
    ru.provisionRuSkill(srcProj, "e2e-travel");

    // 模擬「存檔 / 移機」：把 {ru}/.paaw/skills 整個複製到新 RU 目錄
    const dstProj = track(mkProject());
    _copyDir(join(srcProj, ".paaw", "skills"), join(dstProj, ".paaw", "skills"));

    // 新機讀回（單一路徑，無全域 fallback → 必須真的在 RU 內）
    const c = ru.readRuSkillContent(dstProj, "e2e-travel");
    expect(c).not.toBeNull();
    expect(c.name).toBe("Traveler");
    expect(c.prompt).toContain("TRAVEL-PROMPT");
  });

  it("客製副本移機後仍為客製（sync 不覆蓋）", () => {
    const id = "e2e-custom-move";
    const gdir = seedGlobalSkill(dataHome, id, { body: "V1" });
    const srcProj = track(mkProject());
    ru.provisionRuSkill(srcProj, id);
    // 客製
    writeFileSync(join(srcProj, ".paaw", "skills", id, "SKILL.md"), "---\nname: mine\n---\nMY-CUSTOM\n");

    // 移機
    const dstProj = track(mkProject());
    _copyDir(join(srcProj, ".paaw", "skills"), join(dstProj, ".paaw", "skills"));

    // 模板又更新 → 新機 sync 不該覆蓋客製
    writeFileSync(join(gdir, "SKILL.md"), "---\nname: e2e-custom-move\n---\nV2\n");
    const summary = ru.syncRuSkills(dstProj);
    expect(summary.find(s => s.id === id).action).toBe("customized");
    expect(readFileSync(join(dstProj, ".paaw", "skills", id, "SKILL.md"), "utf-8")).toContain("MY-CUSTOM");
  });
});

/** 跨平台複製目錄（純 node，不依賴 cp -r） */
function _copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name);
    const d = join(dest, e.name);
    if (e.isDirectory()) _copyDir(s, d);
    else writeFileSync(d, readFileSync(s));
  }
}
