import { describe, it } from "vitest";
import { strict as assert } from "assert";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildPageInventory } from "../../packages/server/src/lib/page-inventory.mjs";

/** fixture：TanStack 型 file-based routes + alias import + SDK service + unit test + e2e spec */
function mkProject() {
  const root = mkdtempSync(join(tmpdir(), "pageinv-"));
  const mk = (p, c) => { const f = join(root, p); mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, c); };
  mk("frontend/src/routes/__root.tsx", `import { Footer } from "@/components/Footer";\nexport function Root(){ return null }\n`);
  mk("frontend/src/routes/_layout.tsx", `import AppSidebar from "@/components/AppSidebar";\n`);
  mk("frontend/src/routes/_layout/items.tsx", `import { ItemsService } from "@/client";\nimport { ItemList } from "@/components/ItemList";\nexport function Page(){ const d = ItemsService.list(); return null }\n`);
  mk("frontend/src/routes/_layout/admin.tsx", `import { UsersService } from "@/client";\nexport function Page(){ const d = UsersService.me(); return null }\n`);
  mk("frontend/src/components/ItemList.tsx", `export function ItemList(){ return null }\n`);
  mk("frontend/src/components/ItemList.test.tsx", `it("renders", () => {});\n`);
  mk("frontend/src/client/index.ts", `export { ItemsService, UsersService } from './sdk.gen';\n`);
  mk("frontend/src/client/sdk.gen.ts", `export class ItemsService {\n  static list(){ return client.get({ url: '/api/v1/items' }); }\n}\nexport class UsersService {\n  static me(){ return client.get({ url: '/api/v1/users/me' }); }\n}\n`);
  mk("e2e/items.spec.ts", `test("items page", async ({ page }) => { await page.goto("/items"); });\n`);
  return root;
}

describe("page-inventory (deterministic Page Route 盤點)", () => {
  it("TanStack file-based routes：發現 route + 參數段 + _layout 不貢獻路徑", () => {
    const root = mkProject();
    try {
      const inv = buildPageInventory(root, [], {});
      const routes = inv.rows.map((r) => r.route);
      assert.ok(routes.includes("/items"), `routes=${routes}`);
      assert.ok(routes.includes("/admin"));
      assert.ok(routes.includes("/"));
      assert.ok(!routes.some((r) => r.includes("_layout")), "_layout 不應出現在路徑");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("alias import（@/）解析：page → components 遞迴 + co-located unit test", () => {
    const root = mkProject();
    try {
      const inv = buildPageInventory(root, [], {});
      const items = inv.rows.find((r) => r.route === "/items");
      assert.ok(items.componentCount >= 2, `comp=${items.componentCount}`); // ItemList + client sdk
      assert.ok(items.unitTestedCount >= 1, "ItemList.test.tsx 應計入 unit");
      assert.ok(items.components.some((c) => c.endsWith("ItemList.tsx")));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("E2E 關聯：spec URL 命中 route", () => {
    const root = mkProject();
    try {
      const inv = buildPageInventory(root, [], {});
      const items = inv.rows.find((r) => r.route === "/items");
      assert.ok(items.e2eFiles.some((f) => f.includes("items.spec")));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("API 歸因：Service 呼叫 → SDK class url ↔ API Map（不全掛）", () => {
    const root = mkProject();
    try {
      const apis = [{ entry: "GET /api/v1/items" }, { entry: "GET /api/v1/users/me" }];
      const inv = buildPageInventory(root, apis, {});
      const items = inv.rows.find((r) => r.route === "/items");
      const admin = inv.rows.find((r) => r.route === "/admin");
      assert.ok(items.apiCalls.includes("GET /api/v1/items"), `items api=${items.apiCalls}`);
      assert.ok(!items.apiCalls.includes("GET /api/v1/users/me"), "items 沒用 UsersService 不應掛 users/me");
      assert.ok(admin.apiCalls.includes("GET /api/v1/users/me"), `admin api=${admin.apiCalls}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("垃圾 route 防護：副檔名/省略號/文件佔位不出現", () => {
    const root = mkProject();
    try {
      mk2(root, "docs/readme.md", "path: \"/kb.md\"\n<Route path=\"/...\" />\n");
      const inv = buildPageInventory(root, [], {});
      assert.ok(!inv.rows.some((r) => /\.(md|json)$/.test(r.route) || r.route.includes("...")), JSON.stringify(inv.rows.map(r=>r.route)));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("純前端 project：無 API Map 時 apiCalls 空、型態 frontend-only", () => {
    const root = mkProject();
    try {
      const inv = buildPageInventory(root, [], {});
      assert.equal(inv.frontendType, "frontend-only");
      assert.ok(inv.rows.every((r) => !r.apiCalls.length));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("無 router 的 tab-based UI：0 routes 是誠實結果", () => {
    const root = mkdtempSync(join(tmpdir(), "pageinv-"));
    try {
      const f = join(root, "App.tsx"); writeFileSync(f, `const routes = ["/kb.md"];\nexport default function App(){ return null }\n`);
      const inv = buildPageInventory(root, [], {});
      assert.equal(inv.summary.totalRoutes, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

function mk2(root, p, c) { const f = join(root, p); mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, c); }
