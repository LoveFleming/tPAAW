// Unit tests for packages/server/src/tools/index.mjs (F-007)
// Strategy:
//  - Real filesystem sandbox for DATA_HOME + PAAW_ROOT (mocked via vi.mock)
//  - fetch router stub for all REST-backed handlers
//  - Mocked heavy deps: domain-agent-registry, paaw-agent-loop, em-job-entrypoints
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

// ── Hoisted sandbox paths (vi.mock factories are hoisted) ──
const dirs = vi.hoisted(() => ({ dataHome: "", root: "", ws: "" }));
const fakeAgents = vi.hoisted(() => ({ registry: {} }));
const loopCtl = vi.hoisted(() => ({ result: null, error: null }));
const emCtl = vi.hoisted(() => ({
  runResult: null, runError: null,
  triageResult: null, triageError: null,
}));

vi.mock("@server/data-home.mjs", () => ({ get DATA_HOME() { return dirs.dataHome; } }));
vi.mock("@server/routes/shared.mjs", () => ({ get PAAW_ROOT() { return dirs.root; } }));
vi.mock("@server/lib/domain-agent-registry.mjs", () => ({
  getAgentByCrewId: (id) => fakeAgents.registry[id] || null,
  buildSystemPrompt: () => "SYS-PROMPT",
}));
vi.mock("@server/lib/paaw-agent-loop.mjs", () => ({
  runAgentLoop: vi.fn(async () => {
    if (loopCtl.error) throw loopCtl.error;
    return loopCtl.result ?? { ok: true, text: "loop done" };
  }),
}));
vi.mock("@server/lib/em-job-entrypoints.mjs", () => ({
  JOB_TYPE_META: {
    "cu-scan": { emoji: "🔍", label: "CU 掃描" },
    "security-fix": { emoji: "🔒", label: "安全修復" },
    "test-gen": { emoji: "🧪", label: "測試生成" },
    "release-prep": { emoji: "🚀", label: "發佈準備" },
  },
  triageToTickets: vi.fn(async () => {
    if (emCtl.triageError) throw emCtl.triageError;
    return emCtl.triageResult ?? { ok: true, tickets: [
      { id: "TASK-001", priority: "high", type: "bug", title: "Fix crash", reason: "found in scan" },
    ] };
  }),
  runJobEntrypoint: vi.fn(async () => {
    if (emCtl.runError) throw emCtl.runError;
    return emCtl.runResult ?? { ok: true, summary: "scan ok", durationMs: 100, findings: [] };
  }),
}));

// Module-level constants (APPS_DIR) snapshot DATA_HOME at import time, so the
// sandbox must exist BEFORE dynamically importing tools/index.mjs (single
// sandbox for the whole file; state is reset between tests instead).
let getToolsAndHandlers, invalidateCache, buildAppInstructionsMod;

// ── fetch router: map URL patterns to canned JSON responses ──
let routes = [];
const jsonRes = (status, body) => ({ ok: status < 400, status, json: async () => body });
const route = (method, pattern, handler) => {
  // later registration wins (override semantics for same method+pattern)
  routes = routes.filter(r => !(r.method === method && String(r.pattern) === String(pattern)));
  routes.push({ method, pattern, handler });
};
const notFound = () => jsonRes(404, { error: "not found" });

let fetchLog = [];
const fetchStub = vi.fn(async (url, init = {}) => {
  const method = (init.method || "GET").toUpperCase();
  fetchLog.push({ url: String(url), method });
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = String(url).match(r.pattern);
    if (m) return r.handler(m, init);
  }
  return notFound();
});

// ── App fixtures loaded from DATA_HOME/apps ──
const arrayApp = {
  id: "vocabulary", name: "單字卡", icon: "📘", description: "背單字",
  aiPrompt: "add words with word field",
  dataShape: "array",
  schema: {
    type: "object", required: ["word"],
    properties: {
      word: { type: "string", label: "單字" },
      level: { type: "string", enum: ["easy", "hard"] },
    },
  },
};
const objectApp = {
  id: "mood", name: "心情", icon: "🌈", description: "今日心情",
  dataShape: "object", aiPrompt: "record mood",
  schema: { type: "object", properties: { mood: { type: "string" } } },
};
const skillApp = {
  id: "translator", name: "翻譯", icon: "🌐", description: "翻譯文字",
  type: "skill-based", triggers: ["翻譯", "translate"], aiPrompt: "translate text",
};
const noneApp = {
  id: "readonly-dashboard", name: "看板", icon: "📊", description: "唯讀",
  dataShape: "none", tools: ["dash_view"], aiPrompt: "",
};

let tmpRootDir, wsDir;

function setupSandbox() {
  tmpRootDir = mkdtempSync(join(tmpdir(), "paaw-tools-test-"));
  dirs.dataHome = join(tmpRootDir, "data");
  dirs.root = join(tmpRootDir, "proj");
  dirs.ws = join(tmpRootDir, "ws");
  wsDir = dirs.ws;
  for (const app of [arrayApp, objectApp, skillApp, noneApp]) {
    const d = join(dirs.dataHome, "apps", app.id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "app.json"), JSON.stringify(app));
  }
  // Workspaces config
  mkdirSync(wsDir, { recursive: true });
  mkdirSync(join(wsDir, "src"));
  writeFileSync(join(wsDir, "README.md"), "# WS\nhello workspace");
  writeFileSync(join(wsDir, "src", "a.js"), "console.log(1);");
  mkdirSync(join(dirs.dataHome, "knowledge"), { recursive: true });
  writeFileSync(join(dirs.dataHome, "knowledge", "kb.md"), "# KB\nknowledge base content");
  mkdirSync(join(dirs.dataHome, "knowledge", "sub"));
  writeFileSync(join(dirs.dataHome, "knowledge", "sub", "b.md"), "sub doc");
  writeFileSync(
    join(dirs.dataHome, "workspaces.json"),
    JSON.stringify({ directories: [wsDir] })
  );
  // .paaw knowledge under project root
  mkdirSync(join(dirs.root, ".paaw", "issues"), { recursive: true });
  writeFileSync(
    join(dirs.root, ".paaw", "issues", "ISSUES.json"),
    JSON.stringify({ issues: [
      { id: "ISS-001", title: "First bug", status: "open", priority: "high", labels: ["bug"] },
      { id: "ISS-002", title: "Second task", status: "resolved", priority: "low", labels: ["chore"] },
    ]})
  );
  mkdirSync(join(dirs.root, ".paaw", "features"), { recursive: true });
  writeFileSync(
    join(dirs.root, ".paaw", "features", "FEATURES.json"),
    JSON.stringify({ features: [{ id: "F-001", name: "Core", codeFiles: ["a.mjs"] }] })
  );
  writeFileSync(join(dirs.root, "PROJECT.md"), "# Project\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10");
  // Memory sections
  mkdirSync(join(dirs.dataHome, "config"), { recursive: true });
  writeFileSync(join(dirs.dataHome, "config", "MEMORY.md"), "## prefs\n- dark mode\n");
  // Notes (FS) — second handlers.notes override is API-based, so these feed nothing
  // but keep the dir for file_list knowledge listing.
  mkdirSync(join(dirs.dataHome, "notes"), { recursive: true });
  writeFileSync(join(dirs.dataHome, "notes", "personal.json"),
    JSON.stringify({ id: "personal", name: "Personal", notes: [
      { id: "n1", title: "Groceries", content: "milk and eggs", sectionId: "default" },
    ]}));
}

function resetState() {
  routes = [];
  fetchLog = [];
  fakeAgents.registry = {};
  loopCtl.result = null; loopCtl.error = null;
  emCtl.runResult = null; emCtl.runError = null;
  emCtl.triageResult = null; emCtl.triageError = null;

  // Restore mutable sandbox files to pristine state (tests may have removed dirs)
  for (const d of [
    join(dirs.root, ".paaw", "issues"),
    join(dirs.root, ".paaw", "features"),
    join(dirs.dataHome, "config"),
    join(dirs.dataHome, "cron"),
    join(dirs.dataHome, "notes"),
    join(dirs.dataHome, "apps", "vocabulary"),
    join(dirs.dataHome, "apps", "mood"),
    join(dirs.dataHome, "apps", "translator"),
    join(dirs.dataHome, "apps", "readonly-dashboard"),
    join(dirs.dataHome, "knowledge", "sub"),
    wsDir ? join(wsDir, "src") : "",
  ]) { if (d) mkdirSync(d, { recursive: true }); }
  for (const app of [arrayApp, objectApp, skillApp, noneApp]) {
    writeFileSync(join(dirs.dataHome, "apps", app.id, "app.json"), JSON.stringify(app));
  }
  writeFileSync(join(dirs.ws, "README.md"), "# WS\nhello workspace");
  writeFileSync(join(dirs.ws, "src", "a.js"), "console.log(1);");
  writeFileSync(join(dirs.dataHome, "knowledge", "kb.md"), "# KB\nknowledge base content");
  writeFileSync(join(dirs.dataHome, "knowledge", "sub", "b.md"), "sub doc");
  writeFileSync(join(dirs.dataHome, "config", "MEMORY.md"), "## prefs\n- dark mode\n");
  rmSync(join(dirs.dataHome, "cron"), { recursive: true, force: true });
  rmSync(join(dirs.dataHome, "notes"), { recursive: true, force: true });
  mkdirSync(join(dirs.dataHome, "notes"), { recursive: true });
  writeFileSync(join(dirs.dataHome, "notes", "personal.json"),
    JSON.stringify({ id: "personal", name: "Personal", notes: [
      { id: "n1", title: "Groceries", content: "milk and eggs", sectionId: "default" },
    ]}));

  // Apps / projects / notes defaults
  route("GET", /\/api\/apps$/, () => jsonRes(200, [arrayApp, objectApp, skillApp, noneApp]));
  route("GET", /\/api\/projects$/, () => jsonRes(200, { projects: [
    { id: "p1", name: "Alpha", icon: "🚀", taskDone: 1, taskTotal: 2, taskPct: 50, milestonesDone: 0, milestonesTotal: 2 },
  ]}));
  route("GET", /\/api\/coding-crew\/running/, () => jsonRes(200, { running: false }));
}

let currentHandlers, currentTools, currentApps, currentInstructions;

async function loadTools() {
  invalidateCache();
  const r = await getToolsAndHandlers();
  currentTools = r.tools; currentHandlers = r.handlers; currentApps = r.apps; currentInstructions = r.appInstructions;
  return r;
}

beforeAll(async () => {
  setupSandbox();
  vi.stubGlobal("fetch", fetchStub);
  const mod = await import("@server/tools/index.mjs");
  getToolsAndHandlers = mod.getToolsAndHandlers;
  invalidateCache = mod.invalidateCache;
  buildAppInstructionsMod = mod.buildAppInstructions;
});

beforeEach(() => {
  resetState();
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (tmpRootDir) rmSync(tmpRootDir, { recursive: true, force: true });
});

const toolNames = () => currentTools.map(t => t.function.name);

describe("getToolsAndHandlers (cache + definitions)", () => {
  it("exposes tools/handlers/apps/appInstructions", async () => {
    const r = await loadTools();
    expect(Array.isArray(r.tools)).toBe(true);
    expect(typeof r.handlers.project_info).toBe("function");
    expect(currentApps.map(a => a.id).sort()).toEqual(["mood", "readonly-dashboard", "translator", "vocabulary"]);
    expect(currentInstructions).toContain("/api/app-data/{appId}");
  });

  it("caches within TTL (same object identity) and invalidateCache forces reload", async () => {
    const a = await getToolsAndHandlers();
    const b = await getToolsAndHandlers();
    expect(b).toBe(a);
    invalidateCache();
    const c = await getToolsAndHandlers();
    expect(c).not.toBe(a);
  });

  it("builds core + per-app tool definitions and skips dataShape:none apps", async () => {
    await loadTools();
    const names = toolNames();
    for (const core of ["notes", "app_list", "app_create", "app_edit", "file_list", "file_read",
      "memory_add", "memory_update", "memory_read", "task_create", "task_update", "task_list",
      "task_decompose", "dispatch_agent", "auto_dispatch", "em_job", "schedule_cronjob",
      "list_cronjobs", "update_cronjob", "delete_cronjob", "run_cronjob", "project_info",
      "project_edit", "project_status", "project_update_task"]) {
      expect(names, `missing core tool ${core}`).toContain(core);
    }
    // array app → 5 CRUD tools; object app → get/set; skill app → exec
    for (const t of ["vocabulary_add", "vocabulary_list", "vocabulary_get", "vocabulary_update", "vocabulary_delete",
      "mood_get", "mood_set", "translator_exec"]) {
      expect(names, `missing per-app tool ${t}`).toContain(t);
    }
    expect(names.some(n => n.startsWith("readonly-dashboard"))).toBe(false);
  });

  it("buildAppInstructions documents per-app tool sets", () => {
    const text = buildAppInstructionsMod([arrayApp, objectApp, skillApp, noneApp]);
    expect(text).toContain("vocabulary_add, vocabulary_list");
    expect(text).toContain("mood_get, mood_set");
    expect(text).toContain("translator_exec");
    expect(text).toContain("翻譯、translate");
    expect(text).toContain("dash_view");
  });
});

describe("project_info (filesystem-backed)", () => {
  it("lists issues with status/priority filters", async () => {
    await loadTools();
    const all = await currentHandlers.project_info({ category: "issues" });
    expect(String(all)).toContain("ISS-001");
    expect(String(all)).toContain("ISS-002");
    const open = await currentHandlers.project_info({ category: "issues", status: "open" });
    expect(String(open)).toContain("ISS-001");
    expect(String(open)).not.toContain("ISS-002");
    const high = await currentHandlers.project_info({ category: "issues", priority: "high" });
    expect(String(high)).toContain("First bug");
  });

  it("supports issue search and empty-result message", async () => {
    await loadTools();
    const hit = await currentHandlers.project_info({ category: "issues", search: "First" });
    expect(String(hit)).toContain("ISS-001");
    const miss = await currentHandlers.project_info({ category: "issues", search: "zzzz" });
    expect(String(miss)).toBeTruthy();
  });

  it("reads features with keyword search", async () => {
    await loadTools();
    const res = await currentHandlers.project_info({ category: "features", search: "Core" });
    expect(String(res)).toContain("F-001");
  });

  it("reads project context from PROJECT.md", async () => {
    await loadTools();
    const res = await currentHandlers.project_info({ category: "context" });
    expect(String(res)).toContain("# Project");
  });

  it("errors on unsupported category", async () => {
    await loadTools();
    const res = await currentHandlers.project_info({ category: "nope" });
    expect(String(res)).toBeTruthy();
  });
});

describe("project_edit (filesystem-backed)", () => {
  it("requires action", async () => {
    await loadTools();
    expect(await currentHandlers.project_edit({})).toContain("action");
  });

  it("creates issues sequentially and reports next id", async () => {
    await loadTools();
    const res = await currentHandlers.project_edit({ action: "issue_create", title: "New one", priority: "high", cwd: dirs.root });
    expect(res).toContain("ISS-003");
    const onDisk = JSON.parse(readFileSync(join(dirs.root, ".paaw", "issues", "ISSUES.json"), "utf-8"));
    expect(onDisk.issues).toHaveLength(3);
    expect(onDisk.issues[2].title).toBe("New one");
    const res2 = await currentHandlers.project_edit({ action: "issue_create", title: "One more", cwd: dirs.root });
    expect(res2).toContain("ISS-004");
  });

  it("issue_create without title errors", async () => {
    await loadTools();
    expect(await currentHandlers.project_edit({ action: "issue_create" })).toContain("title");
  });

  it("updates an existing issue", async () => {
    await loadTools();
    const res = await currentHandlers.project_edit({ action: "issue_update", id: "ISS-001", status: "closed", cwd: dirs.root });
    const onDisk = JSON.parse(readFileSync(join(dirs.root, ".paaw", "issues", "ISSUES.json"), "utf-8"));
    expect(onDisk.issues.find(i => i.id === "ISS-001").status).toBe("closed");
    expect(String(res)).toBeTruthy();
  });

  it("issue_update on missing file reports no tracking", async () => {
    await loadTools();
    rmSync(join(dirs.root, ".paaw", "issues"), { recursive: true, force: true });
    const res = await currentHandlers.project_edit({ action: "issue_update", id: "ISS-001", cwd: dirs.root });
    expect(String(res)).toContain("No issues");
  });
});

describe("app tools (REST-backed)", () => {
  it("app_list returns installed apps", async () => {
    await loadTools();
    const res = await currentHandlers.app_list();
    expect(res.text).toContain("單字卡");
    expect(res.text).toContain("翻譯文字");
    expect(res.apps.length).toBe(4);
  });

  it("app_create success / API failure / network failure", async () => {
    await loadTools();
    route("POST", /\/api\/apps$/, () => jsonRes(200, { ok: true, app: { id: "newapp", name: "NewApp" } }));
    const ok = await currentHandlers.app_create({ id: "newapp", name: "NewApp" });
    expect(ok.text).toContain("NewApp");
    route("POST", /\/api\/apps$/, () => jsonRes(200, { ok: false, error: "duplicate" }));
    const fail = await currentHandlers.app_create({ id: "newapp", name: "NewApp" });
    expect(fail.error).toBe(true);
    routes = routes.filter(r => !(r.method === "POST" && String(r.pattern).includes("apps")));
    const thrower = vi.fn(async () => { throw new Error("boom"); });
    routes.push({ method: "POST", pattern: /\/api\/apps$/, handler: thrower });
    const net = await currentHandlers.app_create({ id: "newapp", name: "NewApp" });
    expect(net.error).toBe(true);
    expect(net.text).toContain("建立失敗");
  });

  it("app_edit success and failure", async () => {
    await loadTools();
    route("PATCH", /\/api\/apps\/mood/, () => jsonRes(200, { ok: true, app: { id: "mood", name: "Mood2" } }));
    const ok = await currentHandlers.app_edit({ id: "mood", changes: { name: "Mood2" } });
    expect(ok.text).toContain("Mood2");
    route("PATCH", /\/api\/apps\/mood/, () => jsonRes(200, { ok: false, error: "denied" }));
    const fail = await currentHandlers.app_edit({ id: "mood", changes: {} });
    expect(fail.error).toBe(true);
  });

  it("per-app array CRUD: add/list/get/update/delete", async () => {
    await loadTools();
    route("POST", /\/api\/app-data\/vocabulary/, () => jsonRes(200, { id: "r1", word: "apple", type: "noun" }));
    const add = await currentHandlers.vocabulary_add({ word: "apple" });
    expect(add.text).toContain("apple");
    expect(add.record.id).toBe("r1");

    route("GET", /\/api\/app-data\/vocabulary$/, () => jsonRes(200, [
      { id: "r1", word: "apple", level: "easy" },
      { id: "r2", word: "banana", level: "hard" },
    ]));
    const list = await currentHandlers.vocabulary_list({ level: "easy" });
    expect(list.text).toContain("apple");
    expect(list.text).not.toContain("banana");
    const searched = await currentHandlers.vocabulary_list({ _search: "bana", _limit: 10 });
    expect(searched.records.map(r => r.id)).toEqual(["r2"]);
    const empty = await currentHandlers.vocabulary_list({ _search: "zzz" });
    expect(empty.records).toEqual([]);

    route("GET", /\/api\/app-data\/vocabulary\?id=r1/, () => jsonRes(200, { id: "r1", word: "apple" }));
    const got = await currentHandlers.vocabulary_get({ id: "r1" });
    expect(got.record.word).toBe("apple");

    route("PATCH", /\/api\/app-data\/vocabulary/, () => jsonRes(200, { ok: true, record: { id: "r1", word: "appel" } }));
    const upd = await currentHandlers.vocabulary_update({ id: "r1", word: "appel" });
    expect(String(upd.text)).toBeTruthy();

    route("DELETE", /\/api\/app-data\/vocabulary/, () => jsonRes(200, { ok: true }));
    const del = await currentHandlers.vocabulary_delete({ id: "r1" });
    expect(String(del.text)).toContain("r1");
  });

  it("array CRUD surfaces API errors gracefully", async () => {
    await loadTools();
    route("POST", /\/api\/app-data\/vocabulary/, () => jsonRes(400, { error: "bad payload" }));
    const add = await currentHandlers.vocabulary_add({});
    expect(add.error).toBe(true);
    route("GET", /\/api\/app-data\/vocabulary$/, () => jsonRes(200, { not: "array" }));
    const list = await currentHandlers.vocabulary_list({});
    expect(list.records).toEqual([]);
    route("PATCH", /\/api\/app-data\/vocabulary/, () => { throw new Error("net down"); });
    const upd = await currentHandlers.vocabulary_update({ id: "x" });
    expect(upd.error).toBe(true);
  });

  it("object-shape app get/set", async () => {
    await loadTools();
    route("GET", /\/api\/app-data\/mood/, () => jsonRes(200, { mood: "happy" }));
    const got = await currentHandlers.mood_get();
    expect(got.data.mood).toBe("happy");
    route("PUT", /\/api\/app-data\/mood/, () => jsonRes(200, { ok: true, data: { mood: "calm" } }));
    const set = await currentHandlers.mood_set({ mood: "calm" });
    expect(String(set.text)).toBeTruthy();
  });

  it("skill-based app exec returns parsed JSON result", async () => {
    await loadTools();
    route("POST", /\/api\/apps\/translator\/exec/, () => jsonRes(200, { output: '{"translation":"你好","extra":1}' }));
    const res = await currentHandlers.translator_exec({ text: "hello" });
    expect(res.text).toBe("你好");
    expect(res.data.translation).toBe("你好");
    expect(res.structured).toBe(true);
  });

  it("skill-based app exec falls back to raw text on non-JSON output", async () => {
    await loadTools();
    route("POST", /\/api\/apps\/translator\/exec/, () => jsonRes(200, { output: "PLAIN-TEXT-OUT" }));
    const res = await currentHandlers.translator_exec({ text: "hello" });
    expect(String(res.text || res)).toContain("PLAIN-TEXT-OUT");
  });

  it("skill-based app exec surfaces run errors", async () => {
    await loadTools();
    route("POST", /\/api\/apps\/translator\/exec/, () => jsonRes(200, { error: "skill crashed" }));
    const res = await currentHandlers.translator_exec({ text: "hello" });
    expect(res.error).toBe(true);
    expect(res.text).toContain("skill crashed");
  });
});

describe("auto_dispatch", () => {
  it("preview renders work list and excluded items", async () => {
    await loadTools();
    route("POST", /\/api\/coding-auto-dispatch\/preview/, () => jsonRes(200, {
      ok: true,
      workList: [{ priority: "P0", sourceRef: "F-001", task: "執行 developer：fix bug", agent: "developer" }],
      stats: { open: 1, inProgress: 0, done: 0 },
      excluded: [{ id: "T-9", title: "old", reason: "done" }],
    }));
    const res = await currentHandlers.auto_dispatch({ action: "preview", cwd: dirs.root });
    expect(res.text).toContain("派工範圍");
    expect(res.text).toContain("developer");
    expect(res.text).toContain("排除 1 項");
  });

  it("preview with no work returns the no-work reason", async () => {
    await loadTools();
    route("POST", /\/api\/coding-auto-dispatch\/preview/, () => jsonRes(200, { ok: true, workList: [], noWorkReason: "目前沒有 open task" }));
    const res = await currentHandlers.auto_dispatch({ action: "preview" });
    expect(res.text).toContain("目前沒有 open task");
  });

  it("preview propagates API failure", async () => {
    await loadTools();
    route("POST", /\/api\/coding-auto-dispatch\/preview/, () => jsonRes(500, { ok: false, error: "boom" }));
    const res = await currentHandlers.auto_dispatch({ action: "preview" });
    expect(res.text).toContain("preview 失敗");
  });

  it("start returns no-work message when nothing is open", async () => {
    await loadTools();
    route("POST", /\/api\/coding-auto-dispatch\/preview/, () => jsonRes(200, { ok: true, workList: [], noWorkReason: "無單" }));
    const res = await currentHandlers.auto_dispatch({ action: "start" });
    expect(res.text).toContain("沒單可以做");
  });

  it("start kicks off EM dispatch when tickets exist", async () => {
    await loadTools();
    route("POST", /\/api\/coding-auto-dispatch\/preview/, () => jsonRes(200, {
      ok: true,
      workList: [{ priority: "P0", sourceRef: "F-001", task: "t", agent: "qa" }],
      stats: { open: 1, inProgress: 0, done: 0 },
    }));
    let started = false;
    route("POST", /\/api\/coding-auto-dispatch\/start/, () => { started = true; return jsonRes(200, { ok: true }); });
    const res = await currentHandlers.auto_dispatch({ action: "start", taskId: "TASK-001" });
    expect(started).toBe(true);
    expect(res.text).toContain("已啟動 EM 派工");
  });

  it("stop reports interrupted state", async () => {
    await loadTools();
    route("POST", /\/api\/coding-auto-dispatch\/stop/, () => jsonRes(200, { ok: true }));
    const res = await currentHandlers.auto_dispatch({ action: "stop" });
    expect(res.text).toContain("已請求中斷");
  });

  it("rejects unknown action", async () => {
    await loadTools();
    const res = await currentHandlers.auto_dispatch({ action: "explode" });
    expect(res.text).toContain("preview / start / stop");
  });
});

describe("em_job", () => {
  it("validates action and job values", async () => {
    await loadTools();
    expect((await currentHandlers.em_job({ action: "nope" })).text).toContain("preview / run");
    expect((await currentHandlers.em_job({ action: "preview", job: "nope" })).text).toContain("cu-scan");
  });

  it("preview runs triage dry-run and reports findings", async () => {
    await loadTools();
    emCtl.runResult = { ok: true, summary: "S", durationMs: 100, findings: [{ id: "f1" }] };
    emCtl.triageResult = { ok: true, tickets: [{ id: "TASK-001", priority: "P1", type: "bug", title: "T", reason: "R" }] };
    const res = await currentHandlers.em_job({ action: "preview", job: "security-fix", cwd: dirs.root });
    expect(res.text).toContain("預覽，未寫檔");
    expect(res.text).toContain("TASK-001");
  });

  it("preview with zero findings reports clean", async () => {
    await loadTools();
    const res = await currentHandlers.em_job({ action: "preview", job: "cu-scan" });
    expect(res.text).toContain("掃描乾淨");
  });

  it("run delegates to the job entrypoint and writes tickets", async () => {
    await loadTools();
    emCtl.runResult = { ok: true, summary: "S", durationMs: 100, findings: [{ id: "f1" }] };
    emCtl.triageResult = { ok: true, tickets: [{ id: "TASK-001", priority: "P1", type: "bug", title: "T" }], skipped: 1 };
    const res = await currentHandlers.em_job({ action: "run", job: "test-gen", maxTickets: 2, cwd: dirs.root });
    expect(res.text).toContain("已開單");
    expect(res.text).toContain("TASK-001");
    expect(res.text).toContain("1 張重複跳過");
  });

  it("run surfaces entrypoint failure and entrypoint error result", async () => {
    await loadTools();
    emCtl.runResult = { ok: false, error: "scan blew up" };
    const res = await currentHandlers.em_job({ action: "run", job: "release-prep" });
    expect(res.text).toContain("入口失敗");
    emCtl.runError = new Error("entry crashed");
    const res2 = await currentHandlers.em_job({ action: "run", job: "release-prep" });
    expect(res2.error).toBe(true);
  });
});

describe("cron tools", () => {
  it("schedule_cronjob persists a job", async () => {
    await loadTools();
    const res = await currentHandlers.schedule_cronjob({
      name: "daily-standup", cron: "0 9 * * *", message: "hi", agentId: "coding.em",
    });
    expect(String(res.text)).toBeTruthy();
  });

  it("list_cronjobs returns registered jobs", async () => {
    await loadTools();
    await currentHandlers.schedule_cronjob({ name: "j1", cron: "* * * * *", message: "m", agentId: "coding.em" });
    const res = await currentHandlers.list_cronjobs();
    expect(String(res.text)).toBeTruthy();
  });

  it("update/delete/run cronjob handle missing ids", async () => {
    await loadTools();
    const upd = await currentHandlers.update_cronjob({ id: "nope", changes: {} });
    expect(String(upd.text || upd)).toBeTruthy();
    const del = await currentHandlers.delete_cronjob({ id: "nope" });
    expect(String(del.text || del)).toBeTruthy();
  });

  it("update_cronjob by job name and delete by real id", async () => {
    await loadTools();
    await currentHandlers.schedule_cronjob({ name: "named-job", cron: "0 0 * * *", message: "m", agentId: "coding.em" });
    const upd = await currentHandlers.update_cronjob({ name: "named-job", changes: { message: "m2" } });
    expect(String(upd.text || upd)).toBeTruthy();
  });

  it("run_cronjob triggers immediate execution", async () => {
    await loadTools();
    await currentHandlers.schedule_cronjob({ name: "runme", cron: "0 0 * * *", message: "m", agentId: "coding.em" });
    const res = await currentHandlers.run_cronjob({ name: "runme" });
    expect(String(res.text || res)).toBeTruthy();
  });
});

describe("memory tools (filesystem-backed)", () => {
  it("memory_read returns sections or whole file", async () => {
    await loadTools();
    const all = await currentHandlers.memory_read({});
    expect(String(all.text || all)).toBeTruthy();
    const sec = await currentHandlers.memory_read({ section: "prefs" });
    expect(String(sec.text || sec)).toBeTruthy();
    const miss = await currentHandlers.memory_read({ section: "ghost" });
    expect(String(miss.text || miss)).toBeTruthy();
  });

  it("memory_add creates new and appends to existing sections", async () => {
    await loadTools();
    const res = await currentHandlers.memory_add({ section: "tools", content: "likes vitest" });
    expect(String(res.text || res)).toBeTruthy();
    const again = await currentHandlers.memory_add({ section: "prefs", content: "light theme" });
    expect(String(again.text || again)).toBeTruthy();
    const onDisk = readFileSync(join(dirs.dataHome, "config", "MEMORY.md"), "utf-8");
    expect(onDisk).toContain("light theme");
  });

  it("memory_update replaces section content", async () => {
    await loadTools();
    const res = await currentHandlers.memory_update({ section: "prefs", content: "only this" });
    expect(String(res.text || res)).toBeTruthy();
    const onDisk = readFileSync(join(dirs.dataHome, "config", "MEMORY.md"), "utf-8");
    expect(onDisk).toContain("only this");
  });
});

describe("file_list / file_read", () => {
  it("file_list without workspace enumerates workspaces + knowledge", async () => {
    await loadTools();
    const res = await currentHandlers.file_list({});
    expect(res.text).toContain("可用工作區");
    expect(res.text).toContain("kb.md");
    expect(res.text).toContain("sub/b.md");
  });

  it("file_list with workspace=knowledge lists knowledge tree", async () => {
    await loadTools();
    const res = await currentHandlers.file_list({ workspace: "knowledge" });
    expect(res.text).toContain("kb.md");
  });

  it("file_list inside a matched workspace lists entries", async () => {
    await loadTools();
    const res = await currentHandlers.file_list({ path: ".", workspace: "ws" });
    expect(String(res.text || res)).toBeTruthy();
  });

  it("file_list errors on unknown workspace", async () => {
    await loadTools();
    const res = await currentHandlers.file_list({ workspace: "ghost-ws" });
    expect(String(res.text || res)).toContain("找不到工作區");
  });

  it("file_read reads workspace files and knowledge files", async () => {
    await loadTools();
    const ws = await currentHandlers.file_read({ path: "README.md", workspace: "ws" });
    expect(String(ws.text || ws)).toContain("hello workspace");
    const kb = await currentHandlers.file_read({ path: "kb.md", workspace: "knowledge" });
    expect(String(kb.text || kb)).toContain("knowledge base content");
  });

  it("file_read reports missing files", async () => {
    await loadTools();
    const res = await currentHandlers.file_read({ path: "nope.md", workspace: "ws" });
    expect(String(res.text || res)).toBeTruthy();
  });
});

describe("notes tool (REST-backed)", () => {
  it("requires an action", async () => {
    await loadTools();
    expect(await currentHandlers.notes({})).toContain("action");
  });

  it("search renders results and empty state", async () => {
    await loadTools();
    route("GET", /\/api\/notes\/search/, () => jsonRes(200, { results: [
      { id: "n1", title: "Groceries", notebookId: "personal", notebookName: "Personal", excerpt: "milk" },
    ]}));
    const hit = await currentHandlers.notes({ action: "search", q: "milk" });
    expect(hit.text).toContain("Groceries");
    route("GET", /\/api\/notes\/search/, () => jsonRes(200, { results: [] }));
    const miss = await currentHandlers.notes({ action: "search", q: "zzz" });
    expect(miss.text).toContain("找不到");
    expect((await currentHandlers.notes({ action: "search" })).text).toContain("關鍵字");
  });

  it("get returns a formatted note or not-found", async () => {
    await loadTools();
    route("GET", /\/api\/notes\/get/, () => jsonRes(200, { note: { id: "n1", title: "T", content: "<b>C</b>", notebookId: "personal", updatedAt: "2026-01-01" } }));
    const hit = await currentHandlers.notes({ action: "get", id: "n1" });
    expect(hit.text).toContain("T");
    route("GET", /\/api\/notes\/get/, () => jsonRes(200, {}));
    const miss = await currentHandlers.notes({ action: "get", id: "gone" });
    expect(miss.error).toBe(true);
    expect((await currentHandlers.notes({ action: "get" })).text).toContain("ID");
  });

  it("recent lists latest notes", async () => {
    await loadTools();
    route("GET", /\/api\/notes\/recent/, () => jsonRes(200, { notes: [
      { id: "n1", title: "A", notebookId: "personal", excerpt: "x", updatedAt: "2026-01-01" },
    ]}));
    const res = await currentHandlers.notes({ action: "recent", limit: 5 });
    expect(res.text).toContain("最近 1");
    route("GET", /\/api\/notes\/recent/, () => jsonRes(200, { notes: [] }));
    expect((await currentHandlers.notes({ action: "recent" })).text).toContain("沒有筆記");
  });

  it("create pipes through ai-write then create", async () => {
    await loadTools();
    route("POST", /\/api\/notes\/ai-write/, () => jsonRes(200, { ok: true, title: "AI title", content: "<p>body</p>", tags: ["t"] }));
    route("POST", /\/api\/notes\/create/, () => jsonRes(200, { ok: true, note: { id: "n9", title: "AI title", notebookId: "default" } }));
    route("GET", /\/api\/notes\/sections/, () => jsonRes(200, { sections: [{ id: "default", name: "Default" }] }));
    const res = await currentHandlers.notes({ action: "create", content: "raw note" });
    expect(res.text).toContain("已建立筆記");
    route("POST", /\/api\/notes\/ai-write/, () => jsonRes(200, { ok: false, error: "AI down" }));
    const fail = await currentHandlers.notes({ action: "create", content: "x" });
    expect(fail.error).toBe(true);
  });

  it("list_notebooks / list_sections / create_section", async () => {
    await loadTools();
    route("GET", /\/api\/notes\/notebooks/, () => jsonRes(200, { notebooks: [{ id: "personal", name: "Personal", noteCount: 3 }] }));
    const nbs = await currentHandlers.notes({ action: "list_notebooks" });
    expect(nbs.text).toContain("Personal");
    route("GET", /\/api\/notes\/sections/, () => jsonRes(200, { sections: [{ id: "default", name: "Default" }] }));
    const secs = await currentHandlers.notes({ action: "list_sections", notebook: "personal" });
    expect(secs.text).toContain("Default");
    route("POST", /\/api\/notes\/sections/, () => jsonRes(200, { ok: true }));
    const created = await currentHandlers.notes({ action: "create_section", notebook: "personal", name: "Ideas" });
    expect(created.text).toContain("Ideas");
    expect((await currentHandlers.notes({ action: "create_section", name: "x" })).error).toBe(true);
  });

  it("unknown action lists valid ones", async () => {
    await loadTools();
    const res = await currentHandlers.notes({ action: "explode" });
    expect(String(res)).toContain("search");
  });
});

describe("project board tools", () => {
  it("project_status lists all projects when no id given", async () => {
    await loadTools();
    const res = await currentHandlers.project_status({});
    expect(res.text).toContain("Alpha");
  });

  it("project_status details a single project with progress", async () => {
    await loadTools();
    route("GET", /\/api\/projects\/p1$/, () => jsonRes(200, { project: {
      id: "p1", name: "Alpha", icon: "🚀", description: "d",
      categories: [{ name: "C1", icon: "📁", tasks: [
        { name: "t1", status: "done" }, { name: "t2", status: "progress" },
      ]}],
      milestones: [{ name: "M1", status: "done", date: "2026-01-01" }],
    }}));
    const res = await currentHandlers.project_status({ projectId: "p1" });
    expect(res.text).toContain("50%");
    expect(res.project.pct).toBe(50);
    route("GET", /\/api\/projects\/ghost$/, () => jsonRes(200, {}));
    const miss = await currentHandlers.project_status({ projectId: "ghost" });
    expect(miss.error).toBeTruthy();
  });

  it("project_update_task succeeds and fails", async () => {
    await loadTools();
    route("PUT", /\/api\/projects\/p1\/tasks\/t1/, () => jsonRes(200, { ok: true, task: { name: "t1" } }));
    const ok = await currentHandlers.project_update_task({ projectId: "p1", taskId: "t1", status: "done" });
    expect(ok.text).toContain("t1");
    route("PUT", /\/api\/projects\/p1\/tasks\/t1/, () => jsonRes(200, { ok: false, error: "locked" }));
    const fail = await currentHandlers.project_update_task({ projectId: "p1", taskId: "t1", status: "done" });
    expect(fail.error).toBeTruthy();
  });
});

describe("task tools (REST-backed)", () => {
  it("task_create requires featureId and posts a well-formed payload", async () => {
    await loadTools();
    const missing = await currentHandlers.task_create({ title: "no feature" });
    expect(missing.error).toBe(true);
    expect(missing.text).toContain("featureId");

    let captured = null;
    route("POST", /\/api\/coding-tasks\?/, (_m, init) => {
      captured = JSON.parse(init.body);
      return jsonRes(200, { id: "TASK-101" });
    });
    const ok = await currentHandlers.task_create({ title: "Add tool X", featureId: "F-007", priority: "high", note: "from test" });
    expect(ok.text).toContain("TASK-101");
    expect(captured.featureId).toBe("F-007");
    expect(captured.priority).toBe("high");
    expect(captured.createdBy).toBe("agent");
    expect(captured.notes[0].content).toBe("from test");
  });

  it("task_create surfaces API error and network failure", async () => {
    await loadTools();
    route("POST", /\/api\/coding-tasks\?/, () => jsonRes(200, { error: "feature not found" }));
    const fail = await currentHandlers.task_create({ title: "T", featureId: "F-404" });
    expect(fail.error).toBe(true);
    expect(fail.text).toContain("feature not found");
    route("POST", /\/api\/coding-tasks\?/, async () => { throw new Error("net down"); });
    const net = await currentHandlers.task_create({ title: "T", featureId: "F-007" });
    expect(net.error).toBe(true);
    expect(net.text).toContain("net down");
  });

  it("task_update updates fields, appends note, and reports API errors", async () => {
    await loadTools();
    const seen = { put: null, note: null };
    route("PUT", /\/api\/coding-tasks\/TASK-1\?/, (_m, init) => { seen.put = JSON.parse(init.body); return jsonRes(200, {}); });
    route("POST", /\/api\/coding-tasks\/TASK-1\/notes\?/, (_m, init) => { seen.note = JSON.parse(init.body); return jsonRes(200, {}); });
    const res = await currentHandlers.task_update({ id: "TASK-1", status: "done", assignee: "priya", note: "LGTM" });
    expect(res.text).toContain("TASK-1 已更新");
    expect(res.text).toContain("狀態→done");
    expect(res.text).toContain("指派→priya");
    expect(seen.put.status).toBe("done");
    expect(seen.note.content).toBe("LGTM");

    route("PUT", /\/api\/coding-tasks\/TASK-2\?/, () => jsonRes(200, { error: "locked" }));
    const fail = await currentHandlers.task_update({ id: "TASK-2", status: "done" });
    expect(fail.error).toBe(true);
    expect(fail.text).toContain("locked");
  });

  it("task_list renders tasks with icons and forwards filters", async () => {
    await loadTools();
    let query = "";
    route("GET", /\/api\/coding-tasks\?/, () => {
      query = new URL(fetchLog[fetchLog.length - 1].url).searchParams;
      return jsonRes(200, { tasks: [
        { id: "TASK-1", title: "Fix bug", status: "open", type: "dev", priority: "high", assignee: "amy", executionResult: { success: true } },
        { id: "TASK-2", title: "Write docs", status: "close", type: "docs", priority: "low" },
      ]});
    });
    const res = await currentHandlers.task_list({ status: "open", search: "fix" });
    expect(res.text).toContain("📋 **Task 列表**（2 筆）");
    expect(res.text).toContain("TASK-1");
    expect(res.text).toContain("🌙✅");
    expect(query.get("status")).toBe("open");
    expect(query.get("search")).toBe("fix");

    route("GET", /\/api\/coding-tasks\?/, () => jsonRes(200, { tasks: [] }));
    expect((await currentHandlers.task_list({})).text).toContain("沒有符合條件的 Task");
  });

  it("task_decompose renders subtasks and reports failures", async () => {
    await loadTools();
    route("POST", /\/api\/coding-tasks\/decompose\?/, () => jsonRes(200, { subTasks: [
      { id: "TASK-11", title: "Sub one", type: "dev", assignee: "amy" },
      { id: "TASK-12", title: "Sub two", type: "test" },
    ]}));
    const ok = await currentHandlers.task_decompose({ parentId: "TASK-1", subTasks: [{ title: "Sub one" }] });
    expect(ok.text).toContain("已拆分為 2 個子任務");
    expect(ok.text).toContain("TASK-11");
    expect(ok.subTasks.length).toBe(2);

    route("POST", /\/api\/coding-tasks\/decompose\?/, () => jsonRes(200, { error: "parent closed" }));
    const fail = await currentHandlers.task_decompose({ parentId: "TASK-9", subTasks: [] });
    expect(fail.error).toBe(true);
  });
});

describe("dispatch_agent", () => {
  it("requires agentId and task", async () => {
    await loadTools();
    const res = await currentHandlers.dispatch_agent({});
    expect(res.text).toContain("agentId");
  });

  it("errors on unknown agent", async () => {
    await loadTools();
    const res = await currentHandlers.dispatch_agent({ agentId: "ghost", task: "do stuff" });
    expect(res.text).toContain("找不到 agent");
  });

  it("returns busy message when agent is already running", async () => {
    await loadTools();
    fakeAgents.registry["coding.qa"] = { id: "coding.qa", name: "QA" };
    route("GET", /\/api\/coding-crew\/running/, () => jsonRes(200, { running: true, elapsedS: 42 }));
    const res = await currentHandlers.dispatch_agent({ agentId: "qa", task: "review" });
    expect(res.text).toContain("正忙");
  });

  it("happy path runs the agent loop and reports result", async () => {
    await loadTools();
    fakeAgents.registry["coding.dev"] = { id: "coding.dev", name: "Dev" };
    route("PUT", /\/api\/coding-tasks\//, () => jsonRes(200, { ok: true }));
    loopCtl.result = { ok: true, text: "DEV-LOOP-DONE" };
    const res = await currentHandlers.dispatch_agent({ agentId: "dev", task: "implement X", taskId: "TASK-001" });
    expect(String(res.text || res)).toBeTruthy();
  });

  it("survives agent loop failure", async () => {
    await loadTools();
    fakeAgents.registry["coding.dev"] = { id: "coding.dev", name: "Dev" };
    loopCtl.error = new Error("loop exploded");
    const res = await currentHandlers.dispatch_agent({ agentId: "dev", task: "implement X" });
    expect(String(res.text || res)).toBeTruthy();
  });
});
