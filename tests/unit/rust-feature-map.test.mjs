/**
 * Rust feature map 測試（2026-10-23）
 *
 * 背景：Fleming 回報 Rust 專案（ai-gateway workspace）Code Understanding「正常跑完但 feature map 全空」。
 * 根因四層：
 *   ① tree-sitter-parser 不解 Rust use tree（壞 source 如 "opentelemetry::, }"）
 *   ② plain pub fn/struct 不進 exports → 無 api 進入點
 *   ③ axum .route() / actix #[get] 不進 routes → 無 http 進入點
 *   ④ code-graph 不解析 crate::/self::/super::/workspace-crate 模組路徑 → 邊全懸空（187 檔 4 邊）
 *   ⑤ feature-map v2 在 features=0 時 early return 空 map，LLM orphan 分組根本沒跑
 *
 * 本測試用最小 Rust workspace fixture 驗證全鏈：entries > 0、edges 解析、clusters > 0、空骨架保底。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PAAW_ROOT = process.cwd(); // repo root（vitest 從 root 跑）

let fixtureRoot;
beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "rust-fm-"));
  const w = (rel, content) => {
    const full = join(fixtureRoot, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  };
  // ── workspace crate 1：axum web 服務（有真 http 進入點）──
  w("crates/mock-gw/src/lib.rs", `
use axum::{routing::post, Router};
use crate::routes::openai::handler as oa_handler;
use crate::routes::anthropic::handler as an_handler;

pub fn build_router() -> Router {
    Router::new()
        .route("/v1/chat/completions", post(oa_handler))
        .route("/v1/messages", post(an_handler))
        .route("/health", get(health))
}
`);
  w("crates/mock-gw/src/routes/mod.rs", `pub mod openai;\npub mod anthropi_typo_guard;`);
  w("crates/mock-gw/src/routes/openai.rs", `
use crate::types::ChatRequest;

pub async fn handler(req: ChatRequest) -> String { format!("{:?}", req) }
`);
  w("crates/mock-gw/src/types.rs", `
#[derive(Debug)]
pub struct ChatRequest { pub model: String }
`);
  // ── workspace crate 2：純 library（無 route — pub fn 是 api 進入點）──
  w("libs/core-utils/src/lib.rs", `
pub mod balance;
pub use balance::pick_endpoint;
`);
  w("libs/core-utils/src/balance.rs", `
pub fn pick_endpoint<T: Clone>(eps: &[T]) -> T { eps[0].clone() }
fn internal_helper() {} // 非 pub — 不該進 exports
`);
  // ── actix 屬性 route（另一種常見 Rust web 慣例）──
  w("crates/actix-api/src/main.rs", `
#[get("/status")]
async fn status() -> &'static str { "ok" }

#[post("/submit")]
async fn submit() -> &'static str { "done" }

fn main() {}
`);
});

afterAll?.(() => { try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch {} });

describe("Rust tree-sitter 解析（根因①②③）", () => {
  it("use tree 遞迴出乾淨 leaf path（不再有壞 source）", async () => {
    const { parseProject } = await import("../../packages/server/src/lib/tree-sitter-parser.mjs");
    const parsed = await parseProject(fixtureRoot, PAAW_ROOT, { maxFiles: 0, maxBytes: 100_000 });
    const lib = parsed.files.find(f => f.file.endsWith("mock-gw/src/lib.rs"));
    expect(lib).toBeTruthy();
    const sources = lib.imports.map(i => i.source);
    expect(sources).toContain("axum::routing::post");
    expect(sources).toContain("axum::Router");
    expect(sources).toContain("crate::routes::openai::handler");
    expect(sources.some(s => /[{}]/.test(s))).toBe(false); // 巢狀 brace 清乾淨
  });

  it("axum .route() 抽成 http routes（method + path + handler）", async () => {
    const { parseProject } = await import("../../packages/server/src/lib/tree-sitter-parser.mjs");
    const parsed = await parseProject(fixtureRoot, PAAW_ROOT, { maxFiles: 0, maxBytes: 100_000 });
    const lib = parsed.files.find(f => f.file.endsWith("mock-gw/src/lib.rs"));
    expect(lib.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/v1/chat/completions", handler: "oa_handler" }),
        expect.objectContaining({ method: "POST", path: "/v1/messages" }),
        expect.objectContaining({ method: "GET", path: "/health", handler: "health" }),
      ])
    );
  });

  it("actix #[get]/#[post] 屬性巨集抽成 routes（handler 名取自 next sibling fn）", async () => {
    const { parseProject } = await import("../../packages/server/src/lib/tree-sitter-parser.mjs");
    const parsed = await parseProject(fixtureRoot, PAAW_ROOT, { maxFiles: 0, maxBytes: 100_000 });
    const main = parsed.files.find(f => f.file.endsWith("actix-api/src/main.rs"));
    expect(main.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/status", handler: "status" }),
        expect.objectContaining({ method: "POST", path: "/submit", handler: "submit" }),
      ])
    );
  });

  it("plain pub 進 exports；pub(crate)/私有不進", async () => {
    const { parseProject } = await import("../../packages/server/src/lib/tree-sitter-parser.mjs");
    const parsed = await parseProject(fixtureRoot, PAAW_ROOT, { maxFiles: 0, maxBytes: 100_000 });
    const balance = parsed.files.find(f => f.file.endsWith("core-utils/src/balance.rs"));
    expect(balance.exports.map(e => e.name)).toContain("pick_endpoint");
    expect(balance.exports.map(e => e.name)).not.toContain("internal_helper");
    const types = parsed.files.find(f => f.file.endsWith("mock-gw/src/types.rs"));
    expect(types.exports.map(e => e.name)).toContain("ChatRequest"); // pub struct
  });
});

describe("Rust module path 解析（根因④）", () => {
  it("crate:: 解析到同 crate 檔案（mod.rs 慣例 + 檔案模組）", async () => {
    const { parseProject } = await import("../../packages/server/src/lib/tree-sitter-parser.mjs");
    const { buildCodeGraph } = await import("../../packages/server/src/lib/code-graph.mjs");
    const parsed = await parseProject(fixtureRoot, PAAW_ROOT, { maxFiles: 0, maxBytes: 100_000 });
    const graph = buildCodeGraph(parsed);
    const libEdges = graph.edges.get("crates/mock-gw/src/lib.rs");
    expect([...libEdges]).toContain("crates/mock-gw/src/routes/openai.rs"); // crate::routes::openai::handler
    const openaiEdges = graph.edges.get("crates/mock-gw/src/routes/openai.rs");
    expect([...openaiEdges]).toContain("crates/mock-gw/src/types.rs"); // crate::types::ChatRequest
  });

  it("尾碼比對：crate 名 kebab-case（libs/core-utils）↔ use core_utils::…", async () => {
    const { parseProject } = await import("../../packages/server/src/lib/tree-sitter-parser.mjs");
    const { buildCodeGraph } = await import("../../packages/server/src/lib/code-graph.mjs");
    const parsed = await parseProject(fixtureRoot, PAAW_ROOT, { maxFiles: 0, maxBytes: 100_000 });
    const graph = buildCodeGraph(parsed);
    const lib = graph.edges.get("libs/core-utils/src/lib.rs");
    expect([...lib]).toContain("libs/core-utils/src/balance.rs"); // pub mod balance;
  });
});

describe("Rust deterministic feature map（整合）", () => {
  it("entries > 0 且 clusters > 0（不再是空骨架）", async () => {
    const { parseProject } = await import("../../packages/server/src/lib/tree-sitter-parser.mjs");
    const { buildDeterministicFeatureMap } = await import("../../packages/server/src/lib/code-graph.mjs");
    const parsed = await parseProject(fixtureRoot, PAAW_ROOT, { maxFiles: 0, maxBytes: 100_000 });
    const dm = buildDeterministicFeatureMap(parsed);
    expect(dm.stats.entries).toBeGreaterThan(0);
    expect(dm.stats.clusters).toBeGreaterThan(0);
    expect(dm.stats.files).toBeGreaterThan(4);
  });

  it("mock-gw 的 http routes 成為 feature 錨點（apis 帶 POST /v1/chat/completions）", async () => {
    const { parseProject } = await import("../../packages/server/src/lib/tree-sitter-parser.mjs");
    const { buildDeterministicFeatureMap } = await import("../../packages/server/src/lib/code-graph.mjs");
    const parsed = await parseProject(fixtureRoot, PAAW_ROOT, { maxFiles: 0, maxBytes: 100_000 });
    const dm = buildDeterministicFeatureMap(parsed);
    const allApis = dm.features.flatMap(f => f.apis);
    expect(allApis.some(a => a.method === "POST" && a.path === "/v1/chat/completions")).toBe(true);
  });
});

describe("空骨架保底（根因⑤ — v2 不再回空 map）", () => {
  // 2026-10-23 全新骨架：Label Propagation 100% 覆蓋 → 「無進入點」不再產生 orphan/空 map，
  // 檔案一律歸屬為 deterministic feature（不再走 orphan→utility 這條舊路）。
  it("無進入點的 repo → 檔案全數歸屬（grade=deterministic，不再空 map）", async () => {
    const { organizeFeatureMapV2 } = await import("../../packages/server/src/lib/feature-map-v2.mjs");
    // 無進入點 fixture：純私有 fns、無 route、無 pub（parse 仍收檔）
    const loneRoot = mkdtempSync(join(tmpdir(), "rust-lone-"));
    try {
      mkdirSync(join(loneRoot, "src"), { recursive: true });
      writeFileSync(join(loneRoot, "src", "alpha.rs"), "fn a1() {}\nfn a2() {}\n");
      writeFileSync(join(loneRoot, "src", "beta.rs"), "fn b1() {}\n");
      const progress = [];
      const res = await organizeFeatureMapV2(loneRoot, {
        paawRoot: PAAW_ROOT,
        callLLM: async () => ({ content: '```json\n{"orphanGroups":[{"name":"核心模組","description":"d","files":["src/alpha.rs","src/beta.rs"]}]}\n```' }),
        runFeatureAgent: async () => ({ content: '```json\n{"name":"核心模組","description":"測試","bizLogic":"無","tags":[]}\n```', turns: 1 }),
        onProgress: m => progress.push(m),
      });
      expect(res.features.length).toBeGreaterThan(0); // 舊版這裡是空
      expect(res.features[0].grade).toBe("deterministic"); // 新骨架：100% 覆蓋，不再有 orphan→utility
    } finally { rmSync(loneRoot, { recursive: true, force: true }); }
  });

  it("LLM 全掛 → 目錄決定論分組保底，map 仍不為空", async () => {
    const { organizeFeatureMapV2 } = await import("../../packages/server/src/lib/feature-map-v2.mjs");
    const loneRoot = mkdtempSync(join(tmpdir(), "rust-lone2-"));
    try {
      mkdirSync(join(loneRoot, "src"), { recursive: true });
      writeFileSync(join(loneRoot, "src", "alpha.rs"), "fn a1() {}\n");
      writeFileSync(join(loneRoot, "src", "beta.rs"), "fn b1() {}\n");
      const res = await organizeFeatureMapV2(loneRoot, {
        paawRoot: PAAW_ROOT,
        callLLM: async () => { throw new Error("LLM down"); },
        runFeatureAgent: async () => ({ content: "", turns: 0 }),
      });
      expect(res.features.length).toBeGreaterThan(0); // 保底分組
      expect(res.features[0].codeFiles.length).toBeGreaterThan(0);
    } finally { rmSync(loneRoot, { recursive: true, force: true }); }
  });
});
