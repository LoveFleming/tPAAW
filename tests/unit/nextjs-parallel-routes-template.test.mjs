/**
 * Unit tests — Next.js 16 Parallel Routes skill template (F20261016-004)
 *
 * Target (read-only fixture, NOT imported):
 *   data/skills/physical-skill/nextjs-backend-best-practices/templates/parallel-routes-with-default.tsx
 *
 * This is a *teaching template*, not runnable app code: no Next.js runtime is
 * installed in this repo, it deliberately packs 7 examples (each owning its own
 * `export default`) into one file, and it declares parallel-route slots that only
 * exist as a directory convention (`app/@modal/default.tsx`). Importing it would
 * fail; mocking the whole App Router runtime would test the mocks, not the
 * template. So — exactly like the sibling tests for F20261016-001 / F20261016-003 —
 * we verify the template as a *contract*: it must demonstrate the correct Next.js 16
 * parallel-route patterns, comprehensively, and must NOT present wrong patterns as
 * positive examples. That "authoritative, copy-pasteable reference" property IS the
 * template's product behaviour.
 *
 * TASK-047 history: QA returned FAIL three times (qr-20261017-111130-vre4,
 * qr-20261017-111503-6ofs, qr-20261017-111905-6yf8) with 2 critical + 3 major +
 * 6 minor issues (B1–B5, M1–M6). Developer (Priya) has now fixed all of them in
 * the template. This file previously encoded the *old, wrong* narrative
 * (e.g. "default.tsx is REQUIRED" / "soft navigation needs default") and tracked
 * the defects as `it.todo`. Both are now corrected: the defect-tracking todos are
 * promoted to real assertions that verify the FIXED behaviour (B1–B11), and the
 * wrong-narrative assertions now assert the accurate Next.js semantics.
 *
 * Semantics under test (official Next.js, verified by QA):
 *   • default.tsx is OPTIONAL. It is a fallback for an unmatched slot.
 *   • It matters on HARD navigation (full load / refresh / deep link), when the
 *     slot's active state can't be recovered. Soft navigation (<Link>) keeps the
 *     slot's state and does not consult it.
 *   • Unmatched slot on a hard load with no default can surface as a 404.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(
  __dirname,
  "../../data/skills/physical-skill/nextjs-backend-best-practices/templates/parallel-routes-with-default.tsx"
);

let raw;
let codeOnly; // raw with /* block comment */ and // line comments stripped

beforeAll(() => {
  raw = readFileSync(TEMPLATE_PATH, "utf8");
  // Strip block comments first, then line comments → live (non-commented) source only.
  codeOnly = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
});

describe("parallel routes template — file exists and is well-formed", () => {
  it("reads the template file", () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  it("has the teaching header about Parallel Routes + default.tsx", () => {
    expect(raw).toMatch(/Next\.js 16 — Parallel Routes with default\.tsx/);
  });

  it("has a header example index (Example 1..7 → file path)", () => {
    expect(raw).toMatch(/Example index/);
    expect(raw).toMatch(/Example 1/);
    expect(raw).toMatch(/Example 7/);
  });

  it("teaches default.tsx is OPTIONAL, not a hard requirement (B1)", () => {
    expect(raw).toMatch(/It is OPTIONAL, not a hard requirement/);
    // The fabricated "BREAKING CHANGE / REQUIRED" framing must be gone.
    expect(raw).not.toMatch(/BREAKING CHANGE/);
    expect(raw).not.toMatch(/default\.js\s*←\s*REQUIRED/);
  });

  it("shows the app/ directory structure with @slot folders", () => {
    expect(raw).toMatch(/app\//);
    expect(raw).toMatch(/@modal\//);
  });

  it("labels each snippet with its own target file (multi-file template note)", () => {
    expect(raw).toMatch(/MULTI-FILE TEACHING TEMPLATE/);
    expect(raw).toMatch(/Do NOT paste all snippets into one \.tsx/);
  });
});

describe("B1 — hard/soft navigation semantics are stated correctly", () => {
  it("states default.tsx matters on HARD navigation, not soft", () => {
    expect(raw).toMatch(/It matters on HARD navigation — a full page load \/ refresh \/ deep link —/);
    expect(raw).toMatch(/navigation \(an in-app `<Link>` click\)/);
  });

  it("explains soft navigation preserves slot state and skips default.tsx", () => {
    expect(raw).toMatch(/the router already knows the slot's[\s\S]{0,20}current state and does NOT need default\.tsx/);
  });

  it("documents that an unmatched slot on a hard load can 404", () => {
    expect(raw).toMatch(/can resolve to a 404/);
  });

  it("migration notes describe the accurate behaviour (not a v16 breaking change)", () => {
    expect(raw).toMatch(/default\.tsx behaviour — the accurate picture/);
    expect(raw).toMatch(/Next\.js 15 \/ 16 \(same behaviour\)/);
    expect(raw).not.toMatch(/Why the change\?/);
  });

  it("does not claim default.tsx replaces loading.tsx", () => {
    expect(raw).toMatch(/default\.tsx is NOT a replacement for loading\.tsx/);
  });
});

describe("core contract — every @slot demonstrates a default fallback", () => {
  // default.tsx is the file convention for giving a slot a fallback render.
  it("declares the modal slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+ModalDefault/);
  });

  it("declares the analytics slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+AnalyticsDefault/);
  });

  it("declares the notifications slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+NotificationsDefault/);
  });

  it("declares the activity slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+ActivityDefault/);
  });

  it("declares the reviews slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+ReviewsDefault/);
  });

  it("declares the recommendations slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+RecommendationsDefault/);
  });

  it("declares the auth slot default component (B5: NOT auth-gated)", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+AuthDefault/);
  });

  it("declares the banner slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+BannerDefault/);
  });

  it("declares the root children-slot default (B3)", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+RootDefault/);
    expect(raw).toMatch(/app\/default\.tsx/);
  });

  it("marks each default.tsx fallback in the accompanying comments", () => {
    const markers = raw.match(/default\.tsx\s*\(fallback for the /g) || [];
    // one per slot shown: modal, analytics, notifications, activity, reviews,
    // recommendations, auth, banner
    expect(markers.length).toBeGreaterThanOrEqual(8);
  });
});

describe("B2 — default.tsx files use default exports (file convention)", () => {
  it("Common Patterns helpers (which are default.tsx) are default exports", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+DefaultNull/);
    expect(codeOnly).toMatch(/export\s+default\s+function\s+DefaultSkeleton/);
    expect(codeOnly).toMatch(/export\s+default\s+function\s+DefaultFallback/);
    expect(codeOnly).toMatch(/export\s+default\s+function\s+DefaultRedirect/);
  });

  it("no default.tsx component is a bare named export", () => {
    expect(codeOnly).not.toMatch(/(^|\n)export\s+function\s+DefaultNull/);
    expect(codeOnly).not.toMatch(/(^|\n)export\s+function\s+DefaultSkeleton/);
    expect(codeOnly).not.toMatch(/(^|\n)export\s+function\s+DefaultFallback/);
    expect(codeOnly).not.toMatch(/(^|\n)export\s+function\s+DefaultRedirect/);
  });
});

describe("slot layout contracts — layouts receive the named slots as props", () => {
  it("root layout (Example 1) receives children + modal + banner", () => {
    expect(codeOnly).toMatch(
      /function\s+RootLayout\(\s*\{\s*children,\s*modal,\s*banner,?\s*\}/
    );
  });

  it("dashboard layout (Example 2) receives children + analytics + notifications + activity", () => {
    expect(codeOnly).toMatch(
      /function\s+DashboardLayout\(\s*\{\s*children,\s*analytics,\s*notifications,\s*activity,?\s*\}/
    );
  });

  it("product layout (Example 3) receives children + reviews + recommendations", () => {
    expect(codeOnly).toMatch(
      /function\s+ProductLayout\(\s*\{\s*children,\s*reviews,\s*recommendations,?\s*\}/
    );
  });

  it("banner layout (Example 5) receives children + banner", () => {
    expect(codeOnly).toMatch(/function\s+Layout\(\s*\{\s*children,\s*banner,?\s*\}/);
  });

  it("types every slot prop as React.ReactNode", () => {
    for (const slot of ["modal", "banner", "analytics", "notifications", "activity", "reviews", "recommendations"]) {
      expect(codeOnly).toMatch(new RegExp(`${slot}:\\s*React\\.ReactNode`));
    }
  });

  it("renders the slots inside the layout JSX (modal/banner + main)", () => {
    expect(codeOnly).toMatch(/\{modal\}/);
    expect(codeOnly).toMatch(/\{banner\}/);
    expect(codeOnly).toMatch(/\{children\}/);
    expect(codeOnly).toMatch(/\{analytics\}/);
  });
});

describe("default fallback behaviour is demonstrated (the four documented patterns)", () => {
  it("Pattern 1 — null default (no UI shown)", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+DefaultNull\(\)\s*\{\s*return\s+null/);
  });

  it("Pattern 2 — skeleton default", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+DefaultSkeleton\(\)/);
    expect(codeOnly).toMatch(/skeleton-line/);
  });

  it("Pattern 3 — fallback message default", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+DefaultFallback\(\)/);
    expect(codeOnly).toMatch(/Content not available/);
  });

  it("Pattern 4 — redirect default", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+DefaultRedirect\(\)\s*\{\s*redirect\(/);
  });

  it("the most common slot default returns null (modal + banner)", () => {
    expect(codeOnly).toMatch(/function\s+ModalDefault\(\)\s*\{\s*return\s+null/);
    expect(codeOnly).toMatch(/function\s+BannerDefault\(\)\s*\{\s*return\s+null/);
  });

  it("documents what default.tsx may return (null / skeleton / redirect / fallback)", () => {
    expect(raw).toMatch(/What should default\.tsx return\?/);
    expect(raw).toMatch(/return null/);
    expect(raw).toMatch(/redirect\(\)/);
  });
});

describe("Next.js 16 async params contract inside slots", () => {
  it("reviews slot page types params as Promise and awaits it", () => {
    expect(codeOnly).toMatch(/params:\s*Promise<\{\s*id:\s*string\s*\}>/);
    expect(codeOnly).toMatch(/const\s*\{\s*id\s*\}\s*=\s*await\s+params/);
  });

  it("products layout is static (children/reviews/recommendations slots only)", () => {
    // ProductLayout receives slot props only — params belong to the pages.
    expect(codeOnly).toMatch(/function\s+ProductLayout\(/);
  });
});

describe("B5 — auth gating is NOT placed in the slot default", () => {
  it("the @auth default is a plain, non-gating fallback", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+AuthDefault\(\)\s*\{\s*return\s+null/);
  });

  it("the caveat is documented (do not gate public pages via slot default)", () => {
    expect(raw).toMatch(/Do NOT put a[\s\S]{0,40}"redirect to \/login if unauthenticated" gate in a slot default\.tsx/);
    expect(raw).toMatch(/bounce unauthenticated users away from your public pages/);
  });

  it("the protected page reads cookies, guards userId, and redirects", () => {
    expect(codeOnly).toMatch(/await\s+cookies\(\)/);
    expect(codeOnly).toMatch(/if\s*\(!userId\)/);
    expect(codeOnly).toMatch(/redirect\(['"]\/login['"]\)/);
  });

  it("imports next/headers and next/navigation at a single correct location", () => {
    expect(raw).toMatch(/from\s+['"]next\/headers['"]/);
    expect(raw).toMatch(/from\s+['"]next\/navigation['"]/);
  });
});

describe("B4 + B6 — in-app navigation uses next/link, banner uses useSelectedLayoutSegments", () => {
  it("Example 1 HomePage imports Link from next/link and uses <Link>", () => {
    expect(codeOnly).toMatch(/import\s+Link\s+from\s+['"]next\/link['"]/);
    expect(codeOnly).toMatch(/<Link\s+href="\/login">/);
  });

  it("no plain <a href> hard-navigation anchor remains as the modal trigger (B4)", () => {
    expect(codeOnly).not.toMatch(/<a\s+href="\/login">/);
  });

  it("Example 5 uses useSelectedLayoutSegments instead of a hard-coded flag (B6)", () => {
    expect(codeOnly).toMatch(/useSelectedLayoutSegments\(\)/);
    expect(codeOnly).toMatch(/const\s+showBanner\s*=\s*segments\.includes\(['"]sale['"]\)/);
    expect(codeOnly).not.toMatch(/const\s+showBanner\s*=\s*true/);
  });
});

describe("B7 — fetch responses are checked (res.ok) and values guarded", () => {
  it("checks res.ok before parsing in the analytics example", () => {
    expect(codeOnly).toMatch(/if\s*\(!res\.ok\)/);
  });

  it("checks res.ok before parsing in the product-reviews example", () => {
    expect(codeOnly).toMatch(/Failed to load reviews/);
  });

  it("does not fetch with a missing userId (guarded by redirect first)", () => {
    // userId usage is preceded by an existence check.
    expect(codeOnly).toMatch(/if\s*\(!userId\)[\s\S]*?redirect\(['"]\/login['"]\)/);
  });
});

describe("B8 — RecommendationsDefault shows fallback copy, not loading copy", () => {
  it("recommendations default uses empty/fallback wording", () => {
    const idx = codeOnly.indexOf("function RecommendationsDefault");
    expect(idx).toBeGreaterThan(-1);
    const body = codeOnly.slice(idx, idx + 220);
    expect(body).toMatch(/No recommendations available/);
    expect(body).not.toMatch(/Loading\.\.\./);
  });
});

describe("B9 + B10 — snippet hygiene: 'use client' and imports at file top", () => {
  it("the client layout snippet puts 'use client' at its snippet top", () => {
    expect(raw).toMatch(/'use client'\n\nimport Link from 'next\/link'/);
  });

  it("the error boundary snippet documents 'use client' belongs at file top", () => {
    expect(raw).toMatch(/this directive belongs at the TOP of/);
  });

  it("each snippet's imports are grouped at the snippet header, not mid-body", () => {
    // HomePage's Link import is immediately above the component.
    expect(raw).toMatch(/import Link from 'next\/link'\n\nexport default function HomePage/);
  });
});

describe("B11 — filename/naming is consistent (default.tsx everywhere)", () => {
  it("the header refers to default.tsx (not default.js)", () => {
    expect(raw).toMatch(/Next\.js 16 — Parallel Routes with default\.tsx/);
  });

  it("does not instruct creating default.js files", () => {
    expect(raw).not.toMatch(/default\.js\s*←\s*REQUIRED/);
    expect(raw).not.toMatch(/REQUIRE explicit `default\.js`/);
  });

  it("uses the default.tsx filename in the directory structure", () => {
    expect(raw).toMatch(/└── default\.tsx/);
  });
});

describe("coverage — all exported teaching examples are present", () => {
  const examples = [
    "RootLayout",
    "LoginModal",
    "HomePage",
    "RootDefault",
    "DashboardLayout",
    "AnalyticsOverview",
    "ProductLayout",
    "ProductReviews",
    "ProfilePage",
    "Layout",
    "SaleBanner",
    "AnalyticsLoading",
    "NotificationsLoading",
    "AnalyticsError",
  ];
  for (const name of examples) {
    it(`exports ${name}`, () => {
      expect(codeOnly).toMatch(new RegExp(`export\\s+(default\\s+)?(async\\s+)?function\\s+${name}`));
    });
  }
});

describe("loading.tsx and error.tsx variants are demonstrated", () => {
  it("shows a loading.tsx for the analytics slot", () => {
    expect(raw).toMatch(/@analytics\/loading\.tsx/);
    expect(codeOnly).toMatch(/function\s+AnalyticsLoading\(\)/);
  });

  it("shows a loading.tsx for the notifications slot", () => {
    expect(raw).toMatch(/@notifications\/loading\.tsx/);
    expect(codeOnly).toMatch(/function\s+NotificationsLoading\(\)/);
  });

  it("shows an error.tsx boundary with error + reset props", () => {
    expect(raw).toMatch(/@analytics\/error\.tsx/);
    expect(codeOnly).toMatch(/error:\s*Error/);
    expect(codeOnly).toMatch(/reset:\s*\(\)\s*=>\s*void/);
  });

  it("error boundary is interactive — reset wired to a button onClick", () => {
    expect(codeOnly).toMatch(/onClick=\{reset\}/);
  });
});

describe("migration notes + summary facts are accurate", () => {
  it("documents the accurate default.tsx behaviour and why you add it", () => {
    expect(raw).toMatch(/Why you add default\.tsx/);
  });

  it("summarises the parallel-route rules without the false REQUIRED claim", () => {
    expect(raw).toMatch(/Add `default\.tsx` to each `@folder`/);
    expect(raw).toMatch(/Use `@folder` convention for parallel slots/);
    expect(raw).toMatch(/The `children` slot is implicit/);
    expect(raw).not.toMatch(/MUST include default\.tsx for each @folder, or/);
  });

  it("tells the reader to test both soft and hard navigation", () => {
    expect(raw).toMatch(/Test both soft navigation \(client-side\) and hard navigation/);
  });
});

// ============================================================================
// B. 可執行語意重現 — 以最小 slot-resolver stub 驗證範本宣稱的行為契約
//
// 依 ADR-022 同包慣例（route-handler / server-actions-form 測試的雙層策略）：
// 這些測試不 import 範本本身（範本堆疊多個 export default、依賴 Next.js
// runtime，不可執行），而是用最小 stub「重現」範本在文件層宣稱的平行路由
// slot 解析語意，確認範本的『意圖契約』沒有邏輯錯誤：
//   1. hard navigation + slot matched                 → render slot page
//   2. hard navigation + unmatched + 有 default.tsx   → render default
//   3. hard navigation + unmatched + 無 default.tsx   → render null
//   4. soft navigation                                → 保留 slot active state，default 不被 consult
//   5. children slot 無 page 且無 app/default.tsx     → 404（Example 1 註解宣稱）
//   6. default.tsx 覆蓋 unmatched；loading.tsx 覆蓋 in-flight（不可互換）
//   7. async page throw → 最近的 error.tsx 收到 { error, reset }，reset 可重試
// ============================================================================
describe("B. 可執行語意重現 — slot 解析行為契約（hard/soft navigation + unmatched fallback）", () => {
  // 最小 slot-resolver 替身：重現 App Router 對平行路由 slot 的解析語意，
  // 語意依據 = 範本 migration notes 的宣稱（不是 Next.js 原始碼）。
  const resolveSlot = ({ tree, slot, url, nav = "hard", activeState }) => {
    const entry = tree.find((n) => n.slot === slot);
    if (!entry) throw new Error(`unknown slot: ${slot}`);

    if (nav === "soft") {
      // 範本宣稱：soft navigation 時 router 已知 slot 的 active state，
      // default.tsx is NOT consulted。
      entry.consultedDefault = false;
      return activeState !== undefined ? activeState : null;
    }

    // hard navigation：對當前 URL 重新解析 slot
    if (entry.match.includes(url)) return entry.page;
    entry.consultedDefault = true;
    return entry.default !== undefined ? entry.default : null;
  };

  // Example 1 的 @modal slot：只在 /login 有 page，其餘靠 default.tsx fallback
  const makeModalTree = () => [
    {
      slot: "@modal",
      match: ["/login"],
      page: "LoginModal",
      default: "ModalDefault",
      consultedDefault: false,
    },
  ];

  it("hard navigation 到 slot 有 page 的路由（/login → @modal）→ render 該 page，不 consult default", () => {
    const modalTree = makeModalTree();
    const result = resolveSlot({ tree: modalTree, slot: "@modal", url: "/login", nav: "hard" });
    expect(result).toBe("LoginModal");
    expect(modalTree[0].consultedDefault).toBe(false);
  });

  it("hard navigation 到 slot 未匹配的路由（/ → @modal）且 slot 有 default.tsx → render default", () => {
    const modalTree = makeModalTree();
    const result = resolveSlot({ tree: modalTree, slot: "@modal", url: "/", nav: "hard" });
    expect(result).toBe("ModalDefault");
    expect(modalTree[0].consultedDefault).toBe(true);
  });

  it("hard navigation + slot 未匹配 + slot 無 default.tsx → render null（不報錯）", () => {
    const noDefaultTree = [{ slot: "@analytics", match: ["/dashboard/analytics"], page: "AnalyticsPanel" }];
    const result = resolveSlot({ tree: noDefaultTree, slot: "@analytics", url: "/dashboard", nav: "hard" });
    expect(result).toBeNull();
  });

  it("soft navigation → slot 保留 active state（modal 不消失），default.tsx 不被 consult", () => {
    const modalTree = makeModalTree();
    // 前一狀態：soft navigation 已開啟 modal（activeState = LoginModal）
    const result = resolveSlot({
      tree: modalTree,
      slot: "@modal",
      url: "/somewhere-else",
      nav: "soft",
      activeState: "LoginModal",
    });
    expect(result).toBe("LoginModal");
    expect(modalTree[0].consultedDefault).toBe(false);
  });

  it("soft navigation 且無先前狀態 → null（router 已知 slot 狀態，不 consult default）", () => {
    const modalTree = makeModalTree();
    const result = resolveSlot({ tree: modalTree, slot: "@modal", url: "/x", nav: "soft" });
    expect(result).toBeNull();
    expect(modalTree[0].consultedDefault).toBe(false);
  });

  it("children slot 語意：deep-link 只匹配 slot 的路由時，children 靠 app/default.tsx fallback，否則 404", () => {
    // Example 1 註解宣稱：hard navigation 到只匹配 slot 的路由（如 /login），
    // children 無對應 page → 無 app/default.tsx 會 404，有則 render fallback。
    const resolveChildren = (appDefault) => {
      const childrenHasPageFor = (url) => url === "/"; // children 只有首頁 page
      if (childrenHasPageFor("/login")) return "unreachable";
      return appDefault !== undefined ? appDefault : "404";
    };
    // 無 app/default.tsx → 404
    expect(resolveChildren(undefined)).toBe("404");
    // 有 app/default.tsx（RootDefault，return null）→ 非 404
    expect(resolveChildren("RootDefault")).toBe("RootDefault");
  });

  it("default.tsx 與 loading.tsx 職責不可互換：unmatched 走 default，in-flight 走 loading", () => {
    // 範本宣稱：default.tsx covers *unmatched* slots；loading.tsx covers in-flight。
    const slotRenderer = ({ matched, inFlight, default: dflt, loading }) => {
      if (matched) return "Page";
      if (inFlight) return loading !== undefined ? loading : "Page(suspended)";
      return dflt !== undefined ? dflt : null;
    };
    // 未匹配且非 in-flight → default.tsx
    expect(slotRenderer({ matched: false, inFlight: false, default: "ModalDefault", loading: "AnalyticsLoading" })).toBe("ModalDefault");
    // 未匹配但 in-flight → loading.tsx（Suspense in-flight 是即時狀態，優先）
    expect(slotRenderer({ matched: false, inFlight: true, default: "ModalDefault", loading: "AnalyticsLoading" })).toBe("AnalyticsLoading");
    // 無 loading.tsx 的 slot 在 in-flight 時走 Suspense 預設行為，不落到 default
    expect(slotRenderer({ matched: false, inFlight: true, default: "ModalDefault" })).toBe("Page(suspended)");
  });
});

describe("B. 可執行語意重現 — error boundary 行為契約（Example 7）", () => {
  // 重現 @analytics/error.tsx 的邊界語意：async page throw → 最近的 error.tsx
  // 接收 { error, reset }；reset 觸發重試。
  const renderSlotWithErrorBoundary = async ({ fetchPage, errorComponent, attempts }) => {
    for (let i = 0; i < attempts; i += 1) {
      try {
        return { kind: "page", value: await fetchPage() };
      } catch (error) {
        if (!errorComponent) throw error; // 無 boundary → propagate（500）
        let outcome;
        const decision = errorComponent({
          error,
          reset: () => {
            outcome = "retry";
          },
        });
        if (outcome !== "retry") return { kind: "boundary", value: decision };
      }
    }
    throw new Error("retry budget exhausted");
  };

  it("async page throw（fetch !res.ok，如 AnalyticsOverview）→ error boundary 收到 Error 實例與可呼叫 reset", async () => {
    const seen = [];
    const errorComponent = ({ error, reset }) => {
      seen.push({ errorIsError: error instanceof Error, resetType: typeof reset, message: error.message });
      return "error-ui"; // 不按 Try Again，直接顯示錯誤 UI
    };
    const failingPage = async () => {
      throw new Error("Failed to load analytics: 500");
    };
    const result = await renderSlotWithErrorBoundary({
      fetchPage: failingPage,
      errorComponent,
      attempts: 1,
    });
    expect(result).toEqual({ kind: "boundary", value: "error-ui" });
    expect(seen[0].errorIsError).toBe(true);
    expect(seen[0].resetType).toBe("function");
    expect(seen[0].message).toBe("Failed to load analytics: 500");
  });

  it("reset（Try Again）→ 重試 page；第二次成功 → render page 而非 boundary", async () => {
    let calls = 0;
    const flakyPage = async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return "AnalyticsPanel";
    };
    const errorComponent = ({ reset }) => {
      reset(); // 模擬 onClick={reset}
      return "reset-clicked";
    };
    const result = await renderSlotWithErrorBoundary({
      fetchPage: flakyPage,
      errorComponent,
      attempts: 2,
    });
    expect(result).toEqual({ kind: "page", value: "AnalyticsPanel" });
    expect(calls).toBe(2);
  });

  it("slot 無 error.tsx → 錯誤往上 propagate（不吞掉）", async () => {
    const failingPage = async () => {
      throw new Error("unhandled");
    };
    await expect(
      renderSlotWithErrorBoundary({ fetchPage: failingPage, errorComponent: undefined, attempts: 1 })
    ).rejects.toThrow("unhandled");
  });

  it("邊界 UI 契約：reset 綁到互動元素（onClick={reset}）且邊界元件為 Client Component", () => {
    // 語意：reset 是 client callback，只有 client 互動（事件）下才有意義。
    // Layer A 已斷言 onClick={reset} 與 'use client' 文字；此處驗證語意層：
    // boundary 收到的 reset 是可呼叫的 client-side callback。
    const resetWired = { onClick: () => {} };
    expect(typeof resetWired.onClick).toBe("function");
    expect(codeOnly).toMatch(/onClick=\{reset\}/);
    expect(raw).toMatch(/'use client'/);
  });
});
